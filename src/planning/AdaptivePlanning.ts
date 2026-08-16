import type { CoachingMandateData, GoalContractData, NutritionStrategyData, PlanRevisionData, UserProfileData } from "../coach/domain";
import type { GoalPathAssessment, GoalPathCandidateCounterfactual } from "../goal-path";
import { stableHash } from "../coach/stable";
import { dailyEnergyBudget, dayActivityFromPlan } from "./dailyEnergyBudget";

export interface AdaptivePlanCandidate {
  id: string;
  generatedBy: { kind: "llm"; runId: string; model: string };
  planRevision: PlanRevisionData;
  nutritionStrategy?: NutritionStrategyData;
  behaviorChanges: readonly { id: string; instruction: string; burden: "low" | "moderate" | "high"; preferenceRefs: readonly string[] }[];
  rationale: readonly string[];
  expectedTradeoffs: readonly string[];
  sourceAssessmentId?: string;
}

export interface AdaptivePlanValidation {
  status: "valid" | "invalid";
  issues: readonly { code: string; field: string; message: string; severity: "blocking" | "advisory" }[];
  impact: "low" | "high";
  resolution: "confirmation_required" | "auto_apply_once_eligible" | "auto_apply_eligible";
}

/** Domain-command invariant: no caller can bypass these fixed plan/nutrition limits. */
export function assertFixedPlanSafety(plan: PlanRevisionData, nutrition?: NutritionStrategyData): void {
  const sessionsByDay = new Map<string, number>();
  const weekly = new Map<string, { count: number; minutes: number }>();
  for (const session of plan.sessions) {
    const minutes = session.estimatedDuration?.unit === "minutes" ? session.estimatedDuration.value : session.durationBudget?.unit === "minutes" ? session.durationBudget.value : 45;
    // Model-supplied structure is untrusted: a slot without a prescription is a
    // domain validation failure, never a raw TypeError.
    const sets = (session.stimulusSlots ?? []).reduce((total, slot) => {
      if (!slot.prescription || !Number.isInteger(slot.prescription.setCount)) throw new Error("plan_stimulus_slot_prescription_missing");
      return total + slot.prescription.setCount;
    }, 0);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 150 || sets > 40) throw new Error("plan_training_dose_outside_guardrail");
    const week = weekStart(session.scheduledFor);
    const currentWeek = weekly.get(week) ?? { count: 0, minutes: 0 };
    weekly.set(week, { count: currentWeek.count + 1, minutes: currentWeek.minutes + minutes });
    sessionsByDay.set(session.scheduledFor, (sessionsByDay.get(session.scheduledFor) ?? 0) + 1);
  }
  if ([...weekly.values()].some((value) => value.count > 7 || value.minutes > 600) || [...sessionsByDay.values()].some((count) => count > 2)) throw new Error("plan_weekly_training_dose_outside_guardrail");
  if (nutrition?.calorieRange && (nutrition.calorieRange.min.value < 1_200 || nutrition.calorieRange.max.value > 5_000 || nutrition.calorieRange.min.value > nutrition.calorieRange.max.value)) throw new Error("plan_energy_guardrail_invalid");
  for (const [id, range] of Object.entries(nutrition?.nutrientTargets ?? {})) {
    if (!range) continue;
    const values = [range.minimum, range.maximum, range.target].filter((value): value is number => value !== undefined);
    const ceiling = id === "sodium" ? 5_000 : id === "potassium" ? 7_000 : id === "fiber" ? 100 : id === "protein" ? 400 : undefined;
    if (values.some((value) => !Number.isFinite(value) || value < 0 || (ceiling !== undefined && value > ceiling))) throw new Error("plan_nutrient_target_outside_guardrail");
  }
}

/** Fixed validator behind the LLM candidate boundary. */
export function validateAdaptivePlanCandidate(input: {
  candidate: AdaptivePlanCandidate;
  goal: { revision: number; value: GoalContractData };
  profile: UserProfileData;
  mandate: CoachingMandateData;
  currentPlan?: { revision: number; value: PlanRevisionData };
  currentNutrition?: { revision: number; value: NutritionStrategyData };
  assessment?: GoalPathAssessment;
  counterfactual?: GoalPathCandidateCounterfactual;
  /** 确定性恢复上下文：有则对候选自动计算恢复 advisory（不经模型自觉）。 */
  recoveryContext?: import("./recoveryWindows").RecoveryContext;
  today: string;
  safetyBlocked: boolean;
  /** 已安装目录的 variant id 全集（kernel 注入）；候选任务引用目录外 id 即拦截。 */
  knownExerciseVariantIds?: readonly string[];
  allowedPreferenceRefs?: readonly string[];
  allowedEnergyRange?: { min: number; max: number };
}): AdaptivePlanValidation {
  const issues: { code: string; field: string; message: string; severity: "blocking" | "advisory" }[] = [];
  const candidate = input.candidate;
  try {
    assertFixedPlanSafety(candidate.planRevision, candidate.nutritionStrategy);
  } catch (cause) {
    issues.push(issue(cause instanceof Error ? cause.message : "fixed_plan_safety_failed", "candidate", "候选未通过固定训练与营养安全边界"));
  }
  if (candidate.generatedBy.kind !== "llm") issues.push(issue("candidate_not_llm_generated", "generatedBy", "正式候选必须来自有界 LLM run"));
  const allowedPreferenceRefs = new Set(input.allowedPreferenceRefs ?? []);
  for (const change of candidate.behaviorChanges) {
    for (const ref of change.preferenceRefs) if (!allowedPreferenceRefs.has(ref)) issues.push(issue("unverified_preference_ref", `behaviorChanges.${change.id}.preferenceRefs`, "候选只能引用正式 Plan outcome、Profile 或可管理 Working memory"));
  }
  if (input.safetyBlocked) issues.push(issue("safety_hold_active", "candidate", "安全处置期间不能提交普通计划"));
  // 结构护栏：缺 pins 的候选会在确认后的策略选择里才炸（TypeError），必须拦在提交时。
  const pins = candidate.planRevision.knowledgePins;
  if (!pins?.knowledgePack?.contentHash || !pins.exerciseCatalog?.contentHash) {
    issues.push(issue("knowledge_pins_missing", "planRevision.knowledgePins", "候选必须原样携带固定输入里的 knowledgePins（plan.read_fixed_input 返回的 knowledgePins 对象整体复制到 planRevision.knowledgePins）"));
  }
  for (const session of candidate.planRevision.sessions) {
    if (!session.knowledgePins?.knowledgePack?.contentHash) {
      issues.push(issue("knowledge_pins_missing", `planRevision.sessions.${session.id}.knowledgePins`, "每个 session 也必须原样携带固定输入里的 knowledgePins"));
      break;
    }
  }
  for (const session of candidate.planRevision.sessions) {
    // title 是 UI 的一等输入（Today/计划页直接渲染）；模型偶发给 null——拦在提交时。
    if (typeof session.title !== "string" || !session.title.trim()) {
      issues.push(issue("session_title_missing", `planRevision.sessions.${session.id}.title`, "每个 session 必须有非空 title（如「胸+肩推」），它会直接显示在今日与计划页"));
    }
  }
  // goalContractRef 必须是完整聚合引用（含 kind）——缺 kind 的引用能过 id/revision 比对，
  // 但会在领域事件引用校验（aggregateKey(kind,id)）处炸成提交失败。
  const expectedGoalRef = `goalContractRef = { kind: "goal_contract", id: "${input.goal.value.id}", revision: ${input.goal.revision} }（含 kind，原样复制）`;
  const goalRef = candidate.planRevision.goalContractRef;
  if (!goalRef || goalRef.kind !== "goal_contract" || goalRef.id !== input.goal.value.id || goalRef.revision !== input.goal.revision) {
    issues.push(issue("goal_ref_mismatch", "planRevision.goalContractRef", `候选必须绑定当前目标版本：${expectedGoalRef}`));
  }
  const nutritionGoalRef = candidate.nutritionStrategy?.goalContractRef;
  if (candidate.nutritionStrategy && (!nutritionGoalRef || nutritionGoalRef.kind !== "goal_contract" || nutritionGoalRef.id !== input.goal.value.id || nutritionGoalRef.revision !== input.goal.revision)) {
    issues.push(issue("goal_ref_mismatch", "nutritionStrategy.goalContractRef", `营养策略同样必须绑定当前目标版本：${expectedGoalRef}`));
  }
  if (candidate.planRevision.sessions.some((session) => session.scheduledFor < input.today)) issues.push(issue("candidate_not_future_only", "planRevision.sessions", "候选不能修改过去"));
  if (!candidate.planRevision.sessions.length) issues.push(issue("executable_session_missing", "planRevision.sessions", "当前阶段至少需要一个可执行训练安排"));
  if (input.knownExerciseVariantIds) {
    const known = new Set(input.knownExerciseVariantIds);
    const unknown = [...new Set(candidate.planRevision.sessions.flatMap((session) => session.tasks.map((task) => task.exerciseVariantId)).filter((id): id is string => typeof id === "string" && id.length > 0))].filter((id) => !known.has(id));
    if (unknown.length) {
      issues.push(issue("exercise_variant_unknown", "planRevision.sessions.tasks.exerciseVariantId", `任务引用了目录里不存在的动作变体：${unknown.slice(0, 6).join("、")}${unknown.length > 6 ? " 等" : ""}。用 knowledge.search_installed 查真实 variant id（目录条目有官方 id），不要自行编造`));
    }
  }
  const unsafeText = /(?:\b(?:starv(?:e|ing)|fast(?:ing)?|purge|vomit|laxative|dehydrat(?:e|ion))\b|禁食|绝食|不吃东西|催吐|泻药|脱水|断水)/iu;
  if ([...candidate.behaviorChanges.map((change) => change.instruction), ...candidate.rationale, ...candidate.expectedTradeoffs].some((text) => unsafeText.test(text))) {
    issues.push(issue("unsafe_behavior_instruction", "candidate", "固定安全规则拒绝极端节食、催吐、脱水或其他危险行为"));
  }
  if (candidate.behaviorChanges.some((change) => !change.instruction.trim())) issues.push(issue("behavior_instruction_missing", "behaviorChanges", "行为调整必须给出可执行说明"));
  if (!candidate.rationale.length || !candidate.expectedTradeoffs.length) issues.push(issue("candidate_explanation_missing", "candidate", "候选必须解释依据与代价"));
  const sessionsByDay = new Map<string, number>();
  const weekly = new Map<string, { count: number; minutes: number }>();
  for (const session of candidate.planRevision.sessions) {
    const minutes = session.estimatedDuration?.unit === "minutes" ? session.estimatedDuration.value : session.durationBudget?.unit === "minutes" ? session.durationBudget.value : 45;
    const week = weekStart(session.scheduledFor);
    const currentWeek = weekly.get(week) ?? { count: 0, minutes: 0 };
    weekly.set(week, { count: currentWeek.count + 1, minutes: currentWeek.minutes + minutes });
    sessionsByDay.set(session.scheduledFor, (sessionsByDay.get(session.scheduledFor) ?? 0) + 1);
    const setCount = (session.stimulusSlots ?? []).reduce((total, slot) => total + (slot.prescription && Number.isInteger(slot.prescription.setCount) ? slot.prescription.setCount : 0), 0);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 150 || setCount > 40) issues.push(issue("training_dose_outside_guardrail", `planRevision.sessions.${session.id}`, "单次训练时长或训练组数超出固定安全边界"));
    for (const slot of session.stimulusSlots ?? []) {
      // Untrusted model structure gets a domain issue, never a raw TypeError.
      if (!slot.prescription || !Number.isInteger(slot.prescription.setCount) || slot.prescription.setCount < 1) {
        issues.push(issue("stimulus_slot_prescription_missing", `planRevision.sessions.${session.id}.stimulusSlots.${slot.id}`, "每个刺激槽位必须带固定训练剂量：prescription.setCount（组数）、repRange（次数区间）、targetRir、rest"));
        continue;
      }
      const executableSetCount = session.tasks
        .filter((task) => task.stimulusSlotId === slot.id)
        .reduce((total, task) => total + (Array.isArray(task.sets) ? task.sets.length : 0), 0);
      if (executableSetCount !== slot.prescription.setCount) {
        issues.push(issue(
          "stimulus_slot_task_set_mismatch",
          `planRevision.sessions.${session.id}.stimulusSlots.${slot.id}`,
          "展示给用户的动作组数必须与固定训练剂量中的刺激槽位一致",
        ));
      }
    }
  }
  if ([...weekly.values()].some((value) => value.count > 7 || value.minutes > 600) || [...sessionsByDay.values()].some((count) => count > 2)) issues.push(issue("weekly_training_dose_outside_guardrail", "planRevision.sessions", "每周训练频率、总时长或单日安排超出固定安全边界"));
  const contract = candidate.planRevision.observationContract;
  if (!contract) issues.push(issue("observation_contract_missing", "planRevision.observationContract", "候选缺少观察合同"));
  else {
    if (contract.minimumObservationDays < 7) issues.push(issue("observation_window_too_short", "observationContract.minimumObservationDays", "观察窗口不能短于 7 天"));
    for (const [field, values] of Object.entries({ requiredSignals: contract.requiredSignals, successConditions: contract.successConditions, progressionConditions: contract.progressionConditions, holdConditions: contract.holdConditions, fallbackConditions: contract.fallbackConditions, stopConditions: contract.stopConditions })) {
      // 结构护栏：模型偶发把条件字段给成字符串/对象，先给可读问题码，不让 TypeError 漏给用户。
      if (!Array.isArray(values)) {
        issues.push(issue("observation_contract_condition_not_array", `observationContract.${field}`, "观察合同的每个条件字段都必须是字符串数组"));
        continue;
      }
      if (!values.length) issues.push(issue(`observation_${field}_missing`, `observationContract.${field}`, "观察、推进、保持、回退与停止条件都必须明确"));
    }
  }
  const nutrition = candidate.nutritionStrategy;
  if (!nutrition) issues.push(issue("nutrition_strategy_missing", "nutritionStrategy", "正式阶段候选必须同时定义协调后的营养策略；未知目标保持 unknown，不能省略正式领域对象"));
  if (nutrition?.calorieRange) {
    const min = nutrition.calorieRange.min?.value;
    const max = nutrition.calorieRange.max?.value;
    // 结构护栏：模型偶发把 calorieRange 给成 {min: 2500, max: 2800} 纯数字。
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      issues.push(issue("energy_guardrail_invalid", "nutritionStrategy.calorieRange", "calorieRange 形状：{ min: { value: number, unit: \"kcal\" }, max: { value: number, unit: \"kcal\" } }，value 是纯数字"));
    } else {
      if (min < 1_200 || max > 5_000 || min > max) issues.push(issue("energy_guardrail_invalid", "nutritionStrategy.calorieRange", "能量范围超出通用安全边界或顺序错误"));
      if (input.allowedEnergyRange && (min < input.allowedEnergyRange.min || max > input.allowedEnergyRange.max)) issues.push(issue("goal_energy_path_outside_guardrail", "nutritionStrategy.calorieRange", "能量目标超出当前 Goal 与个人资料允许的安全路径"));
      if (input.goal.value.primaryGoal === "fat_loss_preserve_lean_mass" && min === max) issues.push(issue("energy_range_required", "nutritionStrategy.calorieRange", "减脂能量目标必须保留不确定性范围"));
    }
  }
  for (const [nutrientId, range] of Object.entries(nutrition?.nutrientTargets ?? {})) {
    if (!range) continue;
    const values = [range.minimum, range.maximum, range.target].filter((value): value is number => value !== undefined);
    if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0) || (range.minimum !== undefined && range.maximum !== undefined && range.minimum > range.maximum)) issues.push(issue("nutrient_target_invalid", `nutritionStrategy.nutrientTargets.${nutrientId}`, "营养素目标形状：{ minimum?: number, maximum?: number, target?: number }，纯数字（单位由营养素约定），至少一个有限非负值且 minimum ≤ maximum；不要用 value/unit 嵌套对象"));
    if (nutrientId === "sodium" && range.unit !== "mg" || nutrientId === "potassium" && range.unit !== "mg" || nutrientId === "fiber" && range.unit !== "g") issues.push(issue("nutrient_target_unit_invalid", `nutritionStrategy.nutrientTargets.${nutrientId}.unit`, "钠/钾使用 mg，膳食纤维使用 g"));
    const ceiling = nutrientId === "sodium" ? 5_000 : nutrientId === "potassium" ? 7_000 : nutrientId === "fiber" ? 100 : nutrientId === "protein" ? 400 : undefined;
    if (ceiling !== undefined && values.some((value) => value > ceiling)) issues.push(issue("nutrient_target_outside_guardrail", `nutritionStrategy.nutrientTargets.${nutrientId}`, "营养素目标超出固定健康边界"));
  }
  const currentEnergy = input.currentNutrition?.value.calorieRange;
  const nextEnergy = nutrition?.calorieRange;
  const energyDelta = currentEnergy && nextEnergy ? Math.abs(midpointEnergy(nextEnergy) - midpointEnergy(currentEnergy)) : 0;
  const sessionDelta = input.currentPlan ? Math.abs(candidate.planRevision.sessions.length - input.currentPlan.value.sessions.length) : candidate.planRevision.sessions.length;
  const impact: "low" | "high" = energyDelta > 200 || sessionDelta > 1 || candidate.behaviorChanges.some((change) => change.burden === "high") ? "high" : "low";
  if (input.currentPlan && input.assessment?.state === "on_path") issues.push(issue("current_plan_still_on_path", "candidate", "当前计划仍在路径上，不应为了主动而调整"));
  if (input.currentPlan && input.assessment?.state === "insufficient_evidence") issues.push(issue("candidate_not_supported_by_evidence", "candidate", "证据不足时不能改写计划"));
  if (input.currentPlan && input.assessment && !candidate.sourceAssessmentId) issues.push(issue("source_assessment_missing", "sourceAssessmentId", "调整候选必须引用正式诊断"));
  if (input.currentPlan && input.assessment && candidate.sourceAssessmentId !== input.assessment.id) issues.push(issue("source_assessment_mismatch", "sourceAssessmentId", "候选引用了过期诊断"));
  if (input.currentPlan) {
    if (candidate.planRevision.id !== input.currentPlan.value.id) issues.push(issue("plan_identity_mismatch", "planRevision.id", "调整必须延续当前 Plan identity，不能用新 id 切断历史执行证据"));
    if (candidate.planRevision.baseRevision !== input.currentPlan.revision) issues.push(issue("plan_base_revision_mismatch", "planRevision.baseRevision", "调整候选必须显式基于当前 Plan revision"));
    const planChanged = stableHash(executablePlanShape(candidate.planRevision)) !== stableHash(executablePlanShape(input.currentPlan.value));
    const nutritionChanged = stableHash(candidate.nutritionStrategy ?? null) !== stableHash(input.currentNutrition?.value ?? null);
    if (!planChanged && !nutritionChanged && candidate.behaviorChanges.length === 0) {
      issues.push(issue("candidate_has_no_material_change", "candidate", "候选没有改变任何可执行的未来变量"));
    }
    if (input.assessment?.diagnosis === "plan_friction") {
      const currentBurden = planBurden(input.currentPlan.value);
      const nextBurden = planBurden(candidate.planRevision);
      if (nextBurden >= currentBurden && !candidate.behaviorChanges.some((change) => change.burden === "low")) {
        issues.push(issue("friction_not_reduced", "candidate", "低执行诊断必须优先降低计划摩擦"));
      }
    }
    if (input.assessment?.diagnosis === "recovery_limited" && planBurden(candidate.planRevision) >= planBurden(input.currentPlan.value)) {
      issues.push(issue("recovery_backoff_missing", "candidate", "恢复受限时候选必须降低近期负担"));
    }
    if (!input.counterfactual) issues.push(issue("candidate_counterfactual_missing", "candidate", "调整候选必须经过同一 GoalPath 的 current-vs-candidate 比较"));
    else if (!input.counterfactual.materiallyImproves) {
      for (const code of input.counterfactual.reasonCodes) issues.push(issue(code, "candidate", "候选没有在同一目标、事实和护栏下实质改善当前路径"));
    }
  }
  // 恢复 advisory：候选把残差偏高或仍在恢复窗内的肌群排为主目标时产出软
  // 提示。确定、可审计，且永不阻断提交或授权。
  if (input.recoveryContext?.status === "ok") {
    const contextByMuscle = new Map(input.recoveryContext.muscles.map((entry) => [entry.muscleId, entry]));
    const flagged = new Set<string>();
    for (const session of candidate.planRevision.sessions) {
      for (const slot of session.stimulusSlots ?? []) {
        if (slot.intent.priority === "optional") continue;
        for (const muscle of slot.intent.directMuscles ?? slot.intent.muscleGroups) {
          const context = contextByMuscle.get(muscle);
          if (!context || flagged.has(`${session.id}:${muscle}`)) continue;
          const gapHours = context.lastTrainedDate
            ? (Date.parse(`${session.scheduledFor.slice(0, 10)}T12:00:00Z`) - Date.parse(`${context.lastTrainedDate}T12:00:00Z`)) / 3_600_000
            : Number.POSITIVE_INFINITY;
          if (context.overlapHint === "elevated") {
            flagged.add(`${session.id}:${muscle}`);
            issues.push(advisory("recovery_overlap_elevated", `planRevision.sessions.${session.id}`, `${muscle} 目前残差负荷偏高（组均值政策，非个体测量）；如需连续训练可确认继续`));
          } else if (gapHours < context.windowHours[0]) {
            flagged.add(`${session.id}:${muscle}`);
            issues.push(advisory("recovery_window_short_for_dose", `planRevision.sessions.${session.id}`, `${muscle} 距上次训练约 ${Math.round(gapHours)} 小时，低于 ${context.windowHours[0]}–${context.windowHours[1]} 小时的组均值窗；如需连续训练可确认继续`));
          }
        }
      }
    }
  }
  const autoReversible = Boolean(input.currentPlan && input.currentNutrition);
  if (input.mandate.planChangeAuthorization === "deny") {
    issues.push(issue("plan_change_authorization_denied", "mandate", "用户当前授权禁止提出或应用计划调整"));
  }
  // An invalid candidate can never be auto-apply eligible: resolution only
  // acquires meaning after every fixed issue has been cleared.
  const resolution = issues.length ? "confirmation_required"
    : autoReversible && impact === "low" && input.mandate.planChangeAuthorization === "allow_similar_small"
    ? "auto_apply_eligible"
    : autoReversible && impact === "low" && input.mandate.planChangeAuthorization === "allow_once"
      ? "auto_apply_once_eligible"
      : "confirmation_required";
  return { status: issues.some((entry) => entry.severity === "blocking") ? "invalid" : "valid", issues, impact, resolution };
}

/** Deterministic provisional energy envelope shared by proposal and revalidation. */
export function deriveGoalEnergyGuardrail(profile: UserProfileData, goal: GoalContractData, calibratedMaintenance?: { min: number; max: number }): { min: number; max: number } | undefined {
  const maintenance = dailyEnergyBudget({ profile, day: dayActivityFromPlan({ kind: "rest" }) });
  if (!maintenance && !calibratedMaintenance) return undefined;
  const [minimumRatio, maximumRatio] = goal.primaryGoal === "fat_loss_preserve_lean_mass"
    ? [0.7, 0.95]
    : goal.primaryGoal === "hypertrophy"
      ? [1, 1.2]
      : [0.85, 1.15];
  const maintenanceRange = calibratedMaintenance ?? { min: maintenance!.tdeeKcal - maintenance!.uncertaintyKcal, max: maintenance!.tdeeKcal + maintenance!.uncertaintyKcal };
  return { min: Math.round(maintenanceRange.min * minimumRatio), max: Math.round(maintenanceRange.max * maximumRatio) };
}

function issue(code: string, field: string, message: string) { return { code, field, message, severity: "blocking" as const }; }
/** 恢复类提示永为 advisory：出现在候选摘要与确认卡片，但永不翻 invalid、
 * 不阻断 auto_apply。用户的选择权优先于训练规划规则。 */
function advisory(code: string, field: string, message: string) { return { code, field, message, severity: "advisory" as const }; }
function midpointEnergy(range: NonNullable<NutritionStrategyData["calorieRange"]>) { return (range.min.value + range.max.value) / 2; }
function executablePlanShape(plan: PlanRevisionData) {
  return { sessions: plan.sessions, observationContract: plan.observationContract, lifecycle: plan.lifecycle, effectiveFrom: plan.effectiveFrom };
}
function planBurden(plan: PlanRevisionData): number {
  return plan.sessions.reduce((total, session) => total + (session.estimatedDuration?.unit === "minutes" ? session.estimatedDuration.value : session.durationBudget?.unit === "minutes" ? session.durationBudget.value : 45), 0);
}
function weekStart(date: string): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - weekday + 1);
  return value.toISOString().slice(0, 10);
}
