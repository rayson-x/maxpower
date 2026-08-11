import assert from "node:assert/strict";
import test from "node:test";

import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerDecision, type PlannerFacts } from "../../src/planning";
import { PERSONA_MATRIX, type Persona } from "../e2e/personaMatrix";

/**
 * Planner 级计划质量验收。
 *
 * 断言来源：`docs/research/2026-08-11-healthy-adult-plan-and-nutrition-acceptance-standards.md`
 * 第 3 节六条候选规则 + 该文档的训练/营养标准表。
 *
 * 纪律：这些是**产品验收规则**（版本化、可人工审核），不是把文献数字直接当医疗处方。
 * 只对"健康成人"人设生效；未成年/孕期/伤病人设走单独的分流断言。
 */

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

/** 健康成人（可套用一般人群标准）。 */
const HEALTHY_ADULT = ["p01", "p02", "p03", "p04", "p07", "p10", "p11", "p12", "p13", "p16", "p18", "p19", "p20"];
/** 需要分流而非直接出计划的人设。 */
const NEEDS_TRIAGE = ["p09", "p17"];

function factsFor(persona: Persona): PlannerFacts {
  return {
    userId: "user-1",
    profile: { revision: 1, value: persona.profile },
    goalContract: { revision: 1, value: persona.goalContract },
    mandate: { revision: 1, value: persona.mandate },
    safetyConstraints: [],
    equipmentProfiles: [],
    recoveryConstraints: [],
    nutritionStrategies: [],
    timeline: [],
  };
}

function planFor(persona: Persona): PlannerDecision {
  return planner.plan({ trigger: "initial_plan", currentDate: "2026-08-03", facts: factsFor(persona) });
}

function personas(ids: readonly string[]): readonly Persona[] {
  return PERSONA_MATRIX.filter((persona) => ids.includes(persona.id.slice(0, 3)));
}

interface PlanShape {
  strengthSessions: readonly { date: string; taskCount: number; setCount: number }[];
  aerobicSessions: number;
  aerobicMinutes: number;
  directSets: Readonly<Record<string, number>>;
  rirRanges: readonly string[];
  loadStatuses: Readonly<Record<string, number>>;
  weeks: number;
}

function shapeOf(decision: PlannerDecision): PlanShape {
  if (decision.kind !== "plan_proposal") throw new Error(`not a proposal: ${decision.kind}`);
  const weeks = decision.planRevision.materializedWeeks ?? [];
  const week1 = weeks[0];
  const all = week1?.sessions ?? [];
  const isAerobic = (session: (typeof all)[number]) =>
    (session.stimulusSlots ?? []).some((slot) =>
      slot.intent.movementPattern === "cardio" || slot.intent.movementPattern === "locomotion");
  const strength = all.filter((session) => session.tasks.length > 0 && !isAerobic(session));
  const aerobic = all.filter(isAerobic);
  const sets = strength.flatMap((session) => session.tasks.flatMap((task) => task.sets));
  const loadStatuses: Record<string, number> = {};
  for (const set of sets) {
    const key = set.targetLoadStatus ?? "none";
    loadStatuses[key] = (loadStatuses[key] ?? 0) + 1;
  }
  return {
    strengthSessions: strength.map((session) => ({
      date: session.scheduledFor,
      taskCount: session.tasks.length,
      setCount: session.tasks.reduce((sum, task) => sum + task.sets.length, 0),
    })),
    aerobicSessions: aerobic.length,
    aerobicMinutes: aerobic.reduce((sum, session) => sum + (session.estimatedDuration?.value ?? 0), 0),
    directSets: week1?.weeklyDirectSets ?? {},
    rirRanges: [...new Set(sets.map((set) =>
      set.targetRirRange ? `${set.targetRirRange.min}-${set.targetRirRange.max}` : String(set.targetRir ?? "none")))],
    loadStatuses,
    weeks: weeks.length,
  };
}

// ───────────────────────── D1 ─────────────────────────
test("D1 · 有负荷锚点时进入工作 RIR；纯校准期必须显式标注并带退出/进阶条件", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const shape = shapeOf(decision);
    const onlyCalibration = shape.rirRanges.every((range) => range === "4-5" || range === "none");
    const policy = decision.planRevision.progressionPolicy;

    // 自报 1RM 不构成负荷锚点（缺次数/RIR 上下文），因此不要求工作 RIR——
    // 基线的影响体现在校准起点建议上（见 D2）。
    // 校准期本身是合理设计（标准 L70），但必须显式标注 + 有退出条件与进阶规则。
    if (onlyCalibration) {
      if (!policy) { offenders.push(`${persona.id.slice(0, 3)}(缺 progressionPolicy)`); continue; }
      if (policy.phase !== "calibration") offenders.push(`${persona.id.slice(0, 3)}(phase=${policy.phase} 与全校准不符)`);
      if (!policy.exitCriteria.length) offenders.push(`${persona.id.slice(0, 3)}(无退出条件)`);
      if (!policy.progressionRule) offenders.push(`${persona.id.slice(0, 3)}(无进阶规则)`);
      if (!decision.reasonCodes.includes("calibration_phase_active_with_exit_criteria")) {
        offenders.push(`${persona.id.slice(0, 3)}(校准期未标注)`);
      }
    }
  }
  assert.deepEqual(offenders, [], `RIR/校准期处理不合格：${offenders.join(", ")}`);
});

// ───────────────────────── D2 ─────────────────────────
test("D2 · 用户自填力量基线必须可见地影响输出（校准起点建议），但不得伪造精确工作重量", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    if (!persona.profile.strengthBaseline) continue;
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const sets = decision.planRevision.sessions.flatMap((s) => s.tasks).flatMap((t) => t.sets);
    const suggested = sets.filter((set) => set.calibrationStartSuggestion).length;
    if (suggested === 0) {
      offenders.push(`${persona.id.slice(0, 3)}(基线未影响任何一组)`);
      continue;
    }
    // 不得把自报 1RM 变成"预测目标负荷"（缺次数/RIR 上下文时是伪精确）
    const faked = sets.filter(
      (set) => set.calibrationStartSuggestion && set.targetLoadStatus === "predicted_target",
    ).length;
    if (faked > 0) offenders.push(`${persona.id.slice(0, 3)}(把基线当成精确目标负荷)`);
    if (!decision.reasonCodes.includes("calibration_start_suggested_from_user_strength_baseline")) {
      offenders.push(`${persona.id.slice(0, 3)}(基线影响未记录）`);
    }
  }
  assert.deepEqual(offenders, [], `力量基线处理不合格：${offenders.join(", ")}`);
});

// ───────────────────────── D3 ─────────────────────────
test("D3 · 一般健康/减脂/体能目标：有氧须入列，或显式标注未达公共健康周量", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const goal = persona.goalContract.goalType;
    const wantsAerobic = goal === "fat_loss" || goal === "maintain"
      || (persona.goalContract.modifiers ?? []).includes("conditioning")
      || (persona.goalContract.modifiers ?? []).includes("health");
    if (!wantsAerobic) continue;
    const decision = planFor(persona);
    const shape = shapeOf(decision);
    if (decision.kind !== "plan_proposal") continue;
    const flagged = decision.reasonCodes.some((code) => code.startsWith("aerobic_below_public_health_baseline"));
    if (shape.aerobicSessions === 0 && !flagged) offenders.push(persona.id.slice(0, 3));
  }
  assert.deepEqual(offenders, [], `需要有氧却零有氧且无标注：${offenders.join(", ")}`);
});

test("D3b · 明确写入 maintenanceFloors 的有氧承诺必须进入计划", () => {
  const persona = personas(["p19"])[0]!;
  assert.ok(persona.goalContract.maintenanceFloors?.length, "fixture 应含有氧 floor");
  const shape = shapeOf(planFor(persona));
  assert.ok(shape.aerobicSessions >= 1, `floor 要求每周至少一次有氧，实际 ${shape.aerobicSessions} 次`);
});

// ───────────────────────── D4 ─────────────────────────
test("D4 · 周量账本记直接组，不得把参与肌群按满组数重复计入", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const shape = shapeOf(planFor(persona));
    const values = Object.values(shape.directSets).filter((value) => value > 0);
    if (values.length < 2) continue;
    const max = Math.max(...values);
    const chest = shape.directSets.chest ?? 0;
    // 臀/腿被 squat+lunge+hinge 三处重复满记时，最大肌群会是胸的 3 倍以上
    if (chest > 0 && max >= chest * 3) {
      offenders.push(`${persona.id.slice(0, 3)}(max=${max} chest=${chest})`);
    }
  }
  assert.deepEqual(offenders, [], `周量分布疑似重复记账：${offenders.join(", ")}`);
});

test("D4b · 增肌目标的主要肌群周量应朝 ~10 组/周推进（稳态周中级以上不低于 8）", () => {
  // 首周保守起步是标准允许的（L36），因此这里检查稳态周（最后一个已物化周）。
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    if (persona.goalContract.goalType !== "hypertrophy") continue;
    if (persona.profile.trainingExperience === "beginner") continue;
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const weeks = decision.planRevision.materializedWeeks ?? [];
    const steady = weeks[weeks.length - 1];
    for (const muscle of ["chest", "back"]) {
      const sets = steady?.weeklyDirectSets?.[muscle] ?? 0;
      if (sets < 8) offenders.push(`${persona.id.slice(0, 3)}:${muscle}=${sets}`);
    }
  }
  assert.deepEqual(offenders, [], `中级以上增肌稳态周量不足 8 组：${offenders.join(", ")}`);
});

// ───────────────────────── D5 / D8 ─────────────────────────
test("D5 · 每节力量课不得只有 1 个动作；时长不足应减动作数而非把组数压到 1", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const shape = shapeOf(planFor(persona));
    for (const session of shape.strengthSessions) {
      if (session.taskCount <= 1) offenders.push(`${persona.id.slice(0, 3)}@${session.date}(${session.taskCount}动作)`);
    }
  }
  assert.deepEqual(offenders, [], `存在单动作力量课：${offenders.join(", ")}`);
});

/** 主要肌群（primary slot 服务的）必须过剂量地板；辅助/可选 slot 1 组是合理的。 */
const PRIMARY_MUSCLES = ["chest", "back", "quadriceps", "hamstrings", "glutes", "deltoids"];

test("D8 · 最低意愿也要有有效剂量地板：主要肌群每周 ≥2 直接组", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const shape = shapeOf(planFor(persona));
    const underDosed = PRIMARY_MUSCLES
      .filter((muscle) => (shape.directSets[muscle] ?? 0) === 1)
      .map((muscle) => `${muscle}=1`);
    if (underDosed.length) offenders.push(`${persona.id.slice(0, 3)}[${underDosed.join(",")}]`);
  }
  assert.deepEqual(offenders, [], `主要肌群低于有效剂量地板：${offenders.join(", ")}`);
});

// ───────────────────────── D6 / D7 ─────────────────────────
test("D6 · 营养方向必须与 adaptive 策略同源，恢复维持期不得并存热量赤字", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const adaptive = decision.nutritionStrategy?.energyApproach;
    const guidance = decision.planRevision.nutritionGuidance?.calorieDirection;
    if (!adaptive || !guidance) continue;
    const consistent =
      (adaptive === "small_deficit" && guidance === "deficit") ||
      (adaptive === "small_surplus" && guidance === "small_surplus") ||
      (adaptive === "maintenance" && guidance === "maintenance") ||
      (adaptive === "observe_then_adjust" && guidance === "maintenance");
    if (!consistent) offenders.push(`${persona.id.slice(0, 3)}(adaptive=${adaptive} guidance=${guidance})`);
  }
  assert.deepEqual(offenders, [], `营养方向与策略冲突：${offenders.join(", ")}`);
});

test("D7 · 蛋白建议须给出体重换算克数；无体重则显式标注信息不足", () => {
  const offenders: string[] = [];
  for (const persona of personas(HEALTHY_ADULT)) {
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const guidance = decision.planRevision.nutritionGuidance;
    if (!guidance) continue;
    const bodyWeight = persona.profile.demographics?.currentWeight?.value;
    if (bodyWeight) {
      if (!guidance.proteinGramsPerDay) offenders.push(`${persona.id.slice(0, 3)}(缺克数)`);
    } else if (!guidance.unknowns?.includes("body_weight_unknown")) {
      offenders.push(`${persona.id.slice(0, 3)}(无体重未标注)`);
    }
  }
  assert.deepEqual(offenders, [], `蛋白建议缺计算依据：${offenders.join(", ")}`);
});

// ───────────────────────── D9 ─────────────────────────
test("D9 · 人口学信息缺失须进 missing 并禁止输出绝对热量", () => {
  const persona = personas(["p18"])[0]!;
  const decision = planFor(persona);
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.missing.some((item) => item.includes("body_weight") || item.includes("demographics")),
    `缺体重未进 missing：${decision.missing.join(", ")}`,
  );
  assert.ok(!decision.planRevision.nutritionGuidance?.energyKcalPerDay, "无体重时不得输出绝对热量");
});

// ───────────────────────── 分流边界 ─────────────────────────
test("边界 · 16 岁以下拒绝、16-17 岁允许但保守、孕期拒绝", () => {
  const teen = personas(["p09"])[0]!;
  const teenDecision = planFor(teen);
  // 17 岁：允许出计划（用户决定：≥16 允许）
  assert.equal(teenDecision.kind, "plan_proposal", "17 岁应允许生成计划");
  if (teenDecision.kind === "plan_proposal") {
    assert.ok(
      teenDecision.reasonCodes.some((code) => code.startsWith("minor_conservative")),
      `未成年应有保守标记：${teenDecision.reasonCodes.join(", ")}`,
    );
  }

  // 15 岁：拒绝
  const child: Persona = {
    ...teen,
    id: "px1-child",
    profile: { ...teen.profile, demographics: { ...teen.profile.demographics, ageYears: 15 } },
  };
  const childDecision = planFor(child);
  assert.notEqual(childDecision.kind, "plan_proposal", "15 岁不应生成可确认计划");

  // 孕期：拒绝
  const pregnant = personas(["p17"])[0]!;
  const pregnantDecision = planFor(pregnant);
  assert.notEqual(pregnantDecision.kind, "plan_proposal", "孕期不应生成可确认计划");
});

test("局部硬约束不得升级为整份计划不可行（p05 腰伤限制髋铰链）", () => {
  const persona = PERSONA_MATRIX.find((item) => item.id.startsWith("p05"))!;
  const decision = planFor(persona);
  assert.equal(decision.kind, "plan_proposal", `局部约束不应导致 ${decision.kind}`);
  if (decision.kind !== "plan_proposal") return;
  assert.ok(
    decision.reasonCodes.some((code) => code.startsWith("slot_dropped")),
    "被限制的 slot 应被丢弃并记录",
  );
  const shape = shapeOf(decision);
  assert.ok(shape.strengthSessions.length > 0, "应保留可安全执行的训练");
});

// ───────────────── D10（2026-08-12 真实 E2E 发现）─────────────────

test("D10 · 器械概念展开：用户说「哑铃/器械/龙门」必须匹配到目录细粒度变式", () => {
  // 真实 bug：目录用 dumbbell_pair/cable_stack/row_machine，
  // 用户 onboarding 只说 dumbbell/cable/machine，此前完全匹配不上，
  // 导致有全套器械的用户也只拿到徒手动作（划船/肩推被全部丢弃）。
  const persona = personas(["p06"])[0]!;
  const equipment = persona.profile.locations?.[0]?.availableEquipment ?? [];
  assert.ok(equipment.includes("dumbbell") || equipment.includes("machine"), "fixture 应含粗粒度器械词");
  const decision = planFor(persona);
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const dropped = decision.reasonCodes.filter((code) => code.startsWith("slot_dropped_no_feasible_variant"));
  for (const pattern of ["horizontal_pull", "vertical_push", "elbow_flexion"]) {
    assert.ok(
      !dropped.some((code) => code.includes(pattern)),
      `有器械却丢弃 ${pattern}：${dropped.join(", ")}`,
    );
  }
});

test("D10b · 单课内容下限随可用时长：45 分钟的课不得只有 2 个动作", () => {
  const offenders: string[] = [];
  for (const persona of PERSONA_MATRIX) {
    const minutes = persona.profile.schedule?.sessionDurationMinutes ?? 60;
    const floor = minutes <= 25 ? 2 : minutes <= 45 ? 3 : 4;
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const seven = decision.planRevision.upcomingSevenDays ?? [];
    for (const session of seven.filter((s) => s.tasks.length > 0 && s.kind !== "cardio")) {
      if (session.tasks.length < floor) {
        offenders.push(`${persona.id.slice(0, 3)}(${minutes}min→${session.tasks.length}动作,应≥${floor})`);
        break;
      }
    }
  }
  assert.deepEqual(offenders, [], `单课内容不足：${offenders.join(", ")}`);
});

test("D10c · 主要肌群因器械缺口完全无覆盖时必须显式标注（不静默给 0 组）", () => {
  const offenders: string[] = [];
  for (const persona of PERSONA_MATRIX) {
    const decision = planFor(persona);
    if (decision.kind !== "plan_proposal") continue;
    const week = decision.planRevision.materializedWeeks?.[decision.planRevision.materializedWeeks.length - 1];
    const ledger = week?.weeklyDirectSets ?? {};
    for (const muscle of ["chest", "back", "quadriceps"]) {
      if ((ledger[muscle] ?? 0) > 0) continue;
      const flagged = decision.reasonCodes.some(
        (code) => code === `muscle_group_uncovered_by_available_equipment:${muscle}`,
      );
      if (!flagged) offenders.push(`${persona.id.slice(0, 3)}(${muscle} 零组未标注)`);
    }
  }
  assert.deepEqual(offenders, [], `肌群无覆盖必须留痕：${offenders.join(", ")}`);
});
