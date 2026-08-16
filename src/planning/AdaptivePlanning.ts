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
  issues: readonly { code: string; field: string; message: string }[];
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
  today: string;
  safetyBlocked: boolean;
  allowedPreferenceRefs?: readonly string[];
  allowedEnergyRange?: { min: number; max: number };
}): AdaptivePlanValidation {
  const issues: { code: string; field: string; message: string }[] = [];
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
  if (candidate.planRevision.goalContractRef.id !== input.goal.value.id || candidate.planRevision.goalContractRef.revision !== input.goal.revision) issues.push(issue("goal_ref_mismatch", "planRevision.goalContractRef", "候选必须绑定当前目标版本"));
  if (candidate.planRevision.sessions.some((session) => session.scheduledFor < input.today)) issues.push(issue("candidate_not_future_only", "planRevision.sessions", "候选不能修改过去"));
  if (!candidate.planRevision.sessions.length) issues.push(issue("executable_session_missing", "planRevision.sessions", "当前阶段至少需要一个可执行训练安排"));
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
      if (!values.length) issues.push(issue(`observation_${field}_missing`, `observationContract.${field}`, "观察、推进、保持、回退与停止条件都必须明确"));
    }
  }
  const nutrition = candidate.nutritionStrategy;
  if (!nutrition) issues.push(issue("nutrition_strategy_missing", "nutritionStrategy", "正式阶段候选必须同时定义协调后的营养策略；未知目标保持 unknown，不能省略正式领域对象"));
  if (nutrition?.calorieRange) {
    const min = nutrition.calorieRange.min.value;
    const max = nutrition.calorieRange.max.value;
    if (min < 1_200 || max > 5_000 || min > max) issues.push(issue("energy_guardrail_invalid", "nutritionStrategy.calorieRange", "能量范围超出通用安全边界或顺序错误"));
    if (input.allowedEnergyRange && (min < input.allowedEnergyRange.min || max > input.allowedEnergyRange.max)) issues.push(issue("goal_energy_path_outside_guardrail", "nutritionStrategy.calorieRange", "能量目标超出当前 Goal 与个人资料允许的安全路径"));
    if (input.goal.value.primaryGoal === "fat_loss_preserve_lean_mass" && min === max) issues.push(issue("energy_range_required", "nutritionStrategy.calorieRange", "减脂能量目标必须保留不确定性范围"));
  }
  for (const [nutrientId, range] of Object.entries(nutrition?.nutrientTargets ?? {})) {
    if (!range) continue;
    const values = [range.minimum, range.maximum, range.target].filter((value): value is number => value !== undefined);
    if (!values.length || values.some((value) => !Number.isFinite(value) || value < 0) || (range.minimum !== undefined && range.maximum !== undefined && range.minimum > range.maximum)) issues.push(issue("nutrient_target_invalid", `nutritionStrategy.nutrientTargets.${nutrientId}`, "营养素目标必须是有效且有序的明确范围"));
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
  return { status: issues.length ? "invalid" : "valid", issues, impact, resolution };
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

function issue(code: string, field: string, message: string) { return { code, field, message }; }
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
