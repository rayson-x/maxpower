import assert from "node:assert/strict";
import test from "node:test";

import type { MassQuantity } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import {
  TRAINING_RULE_INPUT_SCHEMA_VERSION,
  InMemoryShadowRuleMetrics,
  TrainingRulePackRegistry,
  type ComparableExerciseContext,
  type ComparableSessionEvidence,
  type RuleEvaluationContext,
  type TrainingGoal,
} from "../../src/training-rules";

const knowledge = new KnowledgePackRegistry(createInstalledKnowledgePack());
const registry = new TrainingRulePackRegistry(knowledge.versionPins());

const comparable: ComparableExerciseContext = {
  exerciseVariantId: "bench-press:barbell:flat",
  performanceIdentity: "bench-flat-barbell-v1",
  equipmentId: "barbell-rack-1",
  loadMode: "barbell",
  setup: "flat_bench_standard_grip",
  rom: "user_confirmed_full_rom",
  prescriptionMode: "weighted_reps",
  setContext: "working",
};

function performed(
  id: string,
  options: {
    reps?: readonly number[];
    rir?: readonly (number | undefined)[];
    load?: MassQuantity;
    loadSource?: "user_confirmed" | "imported" | "camera" | "llm" | "wearable";
    rirSource?: "user_reported" | "llm" | "camera" | "wearable";
    context?: ComparableExerciseContext;
    stopSignals?: readonly string[];
    partial?: boolean;
  } = {},
): ComparableSessionEvidence {
  const reps = options.reps ?? [9, 9, 9];
  const rir = options.rir ?? [3, 3, 3];
  return {
    sessionId: id,
    occurredAt: `2026-08-${id.endsWith("2") ? "08" : "05"}T08:00:00.000Z`,
    context: options.context ?? comparable,
    sets: reps.map((actualReps, index) => ({
      setId: `${id}-set-${index}`,
      ...(options.load === undefined ? {} : { actualLoad: options.load }),
      ...(options.load === undefined
        ? {}
        : { actualLoadSource: options.loadSource ?? ("user_confirmed" as const) }),
      actualReps,
      ...(rir[index] === undefined ? {} : { actualRir: rir[index] }),
      ...(rir[index] === undefined
        ? {}
        : { rirSource: options.rirSource ?? ("user_reported" as const) }),
      completed: true,
    })),
    stopSignals: options.stopSignals ?? [],
    partial: options.partial ?? false,
    evidenceRefs: [{ aggregate: "workout", id, revision: 1 }],
  };
}

function context(
  overrides: Partial<RuleEvaluationContext> = {},
  goal: TrainingGoal = "hypertrophy",
): RuleEvaluationContext {
  return {
    schemaVersion: TRAINING_RULE_INPUT_SCHEMA_VERSION,
    userId: "user-1",
    goal,
    comparableContext: comparable,
    prescription: {
      load: { value: 100, unit: "kg" },
      repRange: { min: 8, max: 10 },
      targetRir: { min: 2, max: 4 },
      setCount: 3,
    },
    recentSessions: [performed("session-1", { load: { value: 100, unit: "kg" } })],
    equipment: {
      availableLoads: [
        { value: 95, unit: "kg" },
        { value: 100, unit: "kg" },
        { value: 102.5, unit: "kg" },
        { value: 110, unit: "kg" },
      ],
    },
    recoveryConstraint: "normal",
    safetyConstraints: [],
    supportSignals: [],
    plannedRecoveryWindow: false,
    mandate: {
      id: "mandate-1",
      mode: "managed",
      scopes: {
        loadReps: "managed_small_step",
        volume: "managed_small_step",
        substitution: "managed_small_step",
        schedule: "managed_small_step",
        deload: "confirm",
        nutrition: "advice_only",
      },
      limits: { maxLoadIncreasePercent: 10, maxWeeklySetChange: 1 },
    },
    locks: [],
    boundary: "session_complete",
    stableHistory: true,
    explicitLowRirPreference: false,
    exerciseCanSafelyStop: true,
    ...overrides,
  };
}

test("三个 RulePack 的 metadata、pin 和替换 interface 可验证；缺 pin 不回退", () => {
  for (const goal of ["hypertrophy", "strength", "fat_loss_preserve_lean_mass"] as const) {
    const loaded = registry.current(goal);
    assert.equal(loaded.status, "available");
    if (loaded.status !== "available") continue;
    assert.equal(loaded.pack.descriptor.goal, goal);
    assert.equal(loaded.pack.descriptor.defaults.calibrationRir.min, 4);
    assert.equal(loaded.pack.descriptor.unknownHandling, "hold_and_request_minimum_evidence");
    assert.ok(loaded.pack.descriptor.requiredEvidence.includes("user_confirmed_performed_sets"));
  }
  const missing = registry.load({ goal: "hypertrophy" });
  assert.equal(missing.status, "unavailable");
  if (missing.status === "unavailable") {
    assert.equal(missing.decision.decision, "unavailable");
    assert.ok(missing.decision.safetyBoundary.includes("no_unversioned_or_LLM_fallback"));
  }
});

test("首场无可靠 actual kg 只做 4–5 RIR 保守校准，三次后仍保持 unknown", () => {
  const noLoad = registry.evaluate(
    context({
      recentSessions: [performed("session-1", { reps: [8], rir: [5] })],
      stableHistory: false,
    }),
  );
  assert.equal(noLoad.decision, "calibrate_load");
  assert.deepEqual(noLoad.after.targetRir, { min: 4, max: 5 });
  assert.equal(noLoad.after.targetLoad, "unknown");
  assert.equal(noLoad.after.oneRmTest, false);

  const exhausted = registry.evaluate(
    context({ recentSessions: [], stableHistory: false, calibrationAttemptCount: 3 }),
  );
  assert.equal(exhausted.decision, "hold");
  assert.ok(exhausted.reasonCodes.includes("calibration_attempt_limit_reached_load_remains_unknown"));
});

test("camera/LLM/wearable 不能补 actual load 或 RIR", () => {
  const fakeLoad = registry.evaluate(
    context({
      recentSessions: [
        performed("session-1", {
          reps: [10, 10, 10],
          rir: [4, 4, 4],
          load: { value: 100, unit: "kg" },
          loadSource: "camera",
        }),
      ],
    }),
  );
  assert.equal(fakeLoad.states.performance, "INSUFFICIENT_EVIDENCE");
  assert.notEqual(fakeLoad.decision, "increase_load");

  const fakeRir = registry.evaluate(
    context({
      recentSessions: [
        performed("session-1", {
          reps: [10, 10, 10],
          rir: [4, 4, 4],
          rirSource: "llm",
          load: { value: 100, unit: "kg" },
        }),
      ],
    }),
  );
  assert.notEqual(fakeRir.states.performance, "TOO_EASY");
  assert.notEqual(fakeRir.decision, "increase_load");
});

test("双进阶先积累第二次次数证据，再只增加一个最小器材档位", () => {
  const easy1 = performed("session-1", {
    reps: [10, 10, 10], rir: [3, 3, 3], load: { value: 100, unit: "kg" },
  });
  const first = registry.evaluate(context({ recentSessions: [easy1] }));
  assert.equal(first.states.performance, "TOO_EASY");
  assert.equal(first.decision, "add_rep");
  assert.equal(first.change?.variable, "reps");

  const easy2 = performed("session-2", {
    reps: [10, 10, 10], rir: [3, 3, 3], load: { value: 100, unit: "kg" },
  });
  const second = registry.evaluate(context({ recentSessions: [easy1, easy2] }));
  assert.equal(second.decision, "increase_load");
  assert.deepEqual(second.change, { variable: "load", value: { value: 102.5, unit: "kg" } });
  assert.equal(second.after.reps, 8);
  assert.equal(Object.keys(second.change ?? {}).includes("sets"), false);
});

test("器材离散档位、microload、Mandate 上限与单位转换都约束自动加重", () => {
  const sessions = ["session-1", "session-2"].map((id) =>
    performed(id, { reps: [10], rir: [3], load: { value: 100, unit: "kg" } }),
  );
  const tooLarge = registry.evaluate(
    context({
      recentSessions: sessions,
      equipment: { availableLoads: [{ value: 100, unit: "kg" }, { value: 112.5, unit: "kg" }] },
    }),
  );
  assert.equal(tooLarge.decision, "hold");
  assert.ok(tooLarge.reasonCodes.includes("do_not_invent_intermediate_load"));

  const micro = registry.evaluate(
    context({
      recentSessions: sessions,
      mandate: { ...context().mandate, limits: { maxLoadIncreasePercent: 5, maxWeeklySetChange: 1 } },
      equipment: {
        availableLoads: [{ value: 100, unit: "kg" }, { value: 110, unit: "kg" }],
        configuredMicroloads: [{ value: 2.5, unit: "kg" }],
      },
    }),
  );
  assert.deepEqual(micro.change?.value, { value: 102.5, unit: "kg" });

  const lbSessions = ["session-1", "session-2"].map((id) =>
    performed(id, { reps: [10], rir: [3], load: { value: 220, unit: "lb" } }),
  );
  const converted = registry.evaluate(
    context({
      prescription: { ...context().prescription, load: { value: 220, unit: "lb" } },
      recentSessions: lbSessions,
      equipment: { availableLoads: [{ value: 220, unit: "lb" }, { value: 102.5, unit: "kg" }] },
    }),
  );
  assert.equal(converted.decision, "increase_load");
  assert.deepEqual(converted.change?.value, { value: 102.5, unit: "kg" });
});

test("动作、器材、setup 或 ROM 改变后建立新 baseline，不传递绝对重量", () => {
  const changed: ComparableExerciseContext = { ...comparable, exerciseVariantId: "incline-dumbbell-press" };
  const decision = registry.evaluate(
    context({
      comparableContext: changed,
      recentSessions: [
        performed("session-1", {
          reps: [10], rir: [4], load: { value: 100, unit: "kg" }, context: comparable,
        }),
      ],
    }),
  );
  assert.equal(decision.states.performance, "INSUFFICIENT_EVIDENCE");
  assert.equal(decision.after.targetLoad, "unknown");
});

test("VolumeProgression 独立于 Performance，一次只为一个肌群增加一个直接组", () => {
  const decision = registry.evaluate(
    context({
      recentSessions: [
        performed("session-1", { load: { value: 100, unit: "kg" } }),
        performed("session-2", { load: { value: 100, unit: "kg" } }),
      ],
      volume: {
        muscleGroup: "chest",
        comparableExposureCount: 2,
        plannedDirectSets: 6,
        completedDirectSets: 6,
        weeklyDataComplete: true,
        performanceTrend: "stable",
        repeatedUnrecoveredCount: 0,
        timeCapacityReached: false,
        supportiveSignals: [{ kind: "pump", value: "low", provenance: "user" }],
        evidenceRefs: [{ aggregate: "timeline", id: "week-1", revision: 1 }],
      },
    }),
  );
  assert.equal(decision.states.performance, "ON_TARGET");
  assert.equal(decision.states.volume, "ELIGIBLE_ADD_SET");
  assert.equal(decision.decision, "add_set");
  assert.deepEqual(decision.change, { variable: "sets", value: 7 });
  assert.ok(decision.reasonCodes.includes("no_same_week_load_and_volume_increase"));
});

test("RIR 或周量缺失时不判 TOO_EASY、不自动加重或加组", () => {
  const missingRir = registry.evaluate(
    context({
      recentSessions: [
        performed("session-1", { reps: [10, 10], rir: [undefined, undefined], load: { value: 100, unit: "kg" } }),
      ],
      volume: {
        muscleGroup: "chest",
        comparableExposureCount: 2,
        plannedDirectSets: 6,
        completedDirectSets: 6,
        weeklyDataComplete: false,
        performanceTrend: "stable",
        repeatedUnrecoveredCount: 0,
        timeCapacityReached: false,
        evidenceRefs: [],
      },
    }),
  );
  assert.equal(missingRir.states.performance, "ON_TARGET");
  assert.equal(missingRir.states.volume, "INSUFFICIENT_EVIDENCE");
  assert.equal(missingRir.decision, "hold");
});

test("STOP_SIGNAL、RecoveryConstraint 和当前 set 冻结高于所有 progression", () => {
  const stop = registry.evaluate(
    context({
      recentSessions: [
        performed("session-1", { load: { value: 100, unit: "kg" }, stopSignals: ["dizziness_or_fainting"] }),
      ],
    }),
  );
  assert.equal(stop.decision, "safety_stop");

  const paused = registry.evaluate(context({ recoveryConstraint: "pause_and_confirm" }));
  assert.equal(paused.decision, "hold");
  assert.equal(paused.requiresConfirmation, true);

  const hard = registry.evaluate(
    context({
      boundary: "current_set",
      recentSessions: [
        performed("session-1", { reps: [5], rir: [0], load: { value: 100, unit: "kg" } }),
      ],
    }),
  );
  assert.equal(hard.scope, "next_unstarted_set");
  assert.notDeepEqual(hard.after, { currentSet: "changed" });
});

test("单一 wearable/睡眠/RIR/DOMS 不触发 Deload，重复下降加独立信号才触发", () => {
  const declines = ["session-1", "session-2"].map((id) =>
    performed(id, { reps: [6, 6], rir: [1, 1], load: { value: 100, unit: "kg" } }),
  );
  const singleWearable = registry.evaluate(
    context({ recentSessions: declines, supportSignals: [{ kind: "single_low_hrv" }] }),
  );
  assert.notEqual(singleWearable.decision, "deload_proposal");

  const adaptive = registry.evaluate(
    context({
      recentSessions: declines,
      supportSignals: [
        { kind: "subjective_fatigue", evidenceRef: { aggregate: "timeline", id: "fatigue-1", revision: 1 } },
      ],
    }),
  );
  assert.equal(adaptive.decision, "deload_proposal");
  assert.equal(adaptive.change?.variable, "deload_strategy");
  assert.ok(adaptive.reasonCodes.includes("no_unvalidated_fixed_percentage"));
});

test("planned recovery window 可生成 Deload Proposal，且不会自动补回删除量", () => {
  const planned = registry.evaluate(context({ plannedRecoveryWindow: true }));
  assert.equal(planned.decision, "deload_proposal");
  assert.equal(planned.after.automaticMakeupVolume, false);
  assert.equal(planned.requiresConfirmation, true);
});

test("徒手节点先完成双进阶，再只走一个已审核相邻节点并重置 baseline", () => {
  const bodyContext: ComparableExerciseContext = {
    ...comparable,
    exerciseVariantId: "push-up-standard",
    performanceIdentity: "push-up-standard-v1",
    equipmentId: "floor",
    loadMode: "bodyweight",
    prescriptionMode: "bodyweight_reps",
  };
  const sessions = ["session-1", "session-2"].map((id) =>
    performed(id, { reps: [12, 12], rir: [4, 4], context: bodyContext }),
  );
  const progressed = registry.evaluate(
    context({
      comparableContext: bodyContext,
      prescription: { repRange: { min: 8, max: 12 }, targetRir: { min: 2, max: 4 }, setCount: 3 },
      recentSessions: sessions,
      bodyweight: {
        graph: {
          id: "push-up-difficulty",
          nodes: ["push-up-standard", "push-up-decline", "push-up-one-arm"],
          edges: [
            { from: "push-up-standard", to: "push-up-decline", direction: "progression", changes: ["body_angle"] },
            { from: "push-up-decline", to: "push-up-one-arm", direction: "progression", changes: ["unilateral"] },
          ],
        },
        currentNodeId: "push-up-standard",
        availableNodeIds: ["push-up-decline", "push-up-one-arm"],
        reviewedAdjacentNodeIds: ["push-up-decline", "push-up-one-arm"],
        canSafelyStop: true,
      },
    }),
  );
  assert.equal(progressed.decision, "bodyweight_progression");
  assert.equal(progressed.change?.value, "push-up-decline");
  assert.equal(progressed.after.baseline, "new_unknown");
  assert.deepEqual(progressed.after.targetRir, { min: 4, max: 5 });
});

test("减脂保肌先删辅助量并保留相对强度，趋势过快只生成复核", () => {
  const reduced = registry.evaluate(
    context(
      {
        recoveryConstraint: "slight_reduction",
        volume: {
          muscleGroup: "chest",
          comparableExposureCount: 2,
          plannedDirectSets: 6,
          completedDirectSets: 6,
          weeklyDataComplete: true,
          performanceTrend: "stable",
          repeatedUnrecoveredCount: 0,
          timeCapacityReached: false,
          evidenceRefs: [],
        },
      },
      "fat_loss_preserve_lean_mass",
    ),
  );
  assert.equal(reduced.decision, "remove_set");
  assert.ok(reduced.reasonCodes.includes("do_not_convert_to_high_rep_circuit"));

  const review = registry.evaluate(
    context(
      { supportSignals: [{ kind: "weight_trend_too_fast" }] },
      "fat_loss_preserve_lean_mass",
    ),
  );
  assert.equal(review.decision, "review_plan");
});

test("力量轻中重波动只对稳定历史开放，新手保持简单进阶且不猜 1RM", () => {
  const novice = registry.evaluate(
    context(
      {
        stableHistory: false,
        requestedLoadingPattern: "light_medium_heavy",
        recentSessions: [],
      },
      "strength",
    ),
  );
  assert.equal(novice.decision, "hold");
  assert.ok(novice.reasonCodes.includes("do_not_invent_one_rm_percentage"));

  const experienced = registry.evaluate(
    context(
      { stableHistory: true, requestedLoadingPattern: "light_medium_heavy" },
      "strength",
    ),
  );
  assert.equal(experienced.change?.variable, "loading_pattern");
  assert.equal(experienced.after.loadBasis, "confirmed_exact_context_history");
  assert.equal(experienced.after.failureTrainingDefault, false);
});

test("0–1 RIR 只有稳定历史、明确偏好且可安全停止时才允许", () => {
  const blocked = registry.evaluate(
    context({ prescription: { ...context().prescription, targetRir: { min: 0, max: 1 } } }),
  );
  assert.equal(blocked.decision, "hold");
  assert.ok(blocked.conflicts.includes("low_RIR_not_eligible"));

  const allowed = registry.evaluate(
    context({
      prescription: { ...context().prescription, targetRir: { min: 0, max: 1 } },
      explicitLowRirPreference: true,
      stableHistory: true,
      exerciseCanSafelyStop: true,
    }),
  );
  assert.equal(allowed.conflicts.includes("low_RIR_not_eligible"), false);
});

test("同一 snapshot + pins 离线 replay 完全一致，schema 不兼容 typed hold", () => {
  const input = context();
  assert.deepEqual(registry.evaluate(input), registry.evaluate(input));
  const invalid = registry.evaluate({ ...input, schemaVersion: 2 as 1 });
  assert.equal(invalid.decision, "unavailable");
  assert.equal(invalid.confidence, 0);
});

test("显式安装的历史 RulePack pin 可重放，未知 pin typed unavailable", () => {
  const currentPins = knowledge.versionPins();
  const archivedRule = {
    ...currentPins.rulePacks.find((pin) => pin.id === "maxpower.training.hypertrophy")!,
    semanticVersion: "0.9.0",
    contentHash: "archived-hypertrophy-rule-v0.9",
  };
  const archivedPins = {
    ...currentPins,
    rulePacks: currentPins.rulePacks.map((pin) =>
      pin.id === archivedRule.id ? archivedRule : pin,
    ),
  };
  const replayRegistry = new TrainingRulePackRegistry(currentPins, [archivedPins]);
  const archived = replayRegistry.load({ goal: "hypertrophy", pin: archivedRule });
  assert.equal(archived.status, "available");
  if (archived.status === "available") {
    assert.equal(archived.pack.evaluate(context()).rule.semanticVersion, "0.9.0");
  }
  const unknown = replayRegistry.load({
    goal: "hypertrophy",
    pin: { ...archivedRule, contentHash: "not-installed" },
  });
  assert.equal(unknown.status, "unavailable");
});

test("影子模式记录接受、修改、撤销、完成、RIR 偏差、下降与覆盖率", () => {
  const metrics = new InMemoryShadowRuleMetrics();
  const evaluated = registry.evaluate(context());
  metrics.recordProposal({ proposalId: "proposal-1", decision: evaluated, ruleCoverage: 0.8 });
  metrics.recordOutcome({
    proposalId: "proposal-1",
    accepted: true,
    modified: false,
    undone: true,
    completed: true,
    targetRirDeviation: -1,
    repeatedPerformanceDecline: false,
  });
  assert.deepEqual(metrics.summary(), {
    proposalCount: 1,
    acceptanceRate: 1,
    modificationRate: 0,
    undoRate: 1,
    completionRate: 1,
    meanAbsoluteTargetRirDeviation: 1,
    repeatedPerformanceDeclineRate: 0,
    meanRuleCoverage: 0.8,
  });
});

test("校准阶梯：试做 RIR≥6 上调一档、4–5 接受为首负荷、≤3 降档、超限保持 unknown", () => {
  const calibrationPrescription = {
    repRange: { min: 8, max: 10 },
    targetRir: { min: 4, max: 5 },
    setCount: 3,
  };
  const stepUp = registry.evaluate(
    context({
      prescription: calibrationPrescription,
      recentSessions: [performed("session-1", { reps: [8], rir: [7], load: { value: 100, unit: "kg" } })],
      stableHistory: false,
      calibrationAttemptCount: 1,
    }),
  );
  assert.equal(stepUp.decision, "increase_load");
  assert.deepEqual(stepUp.after.targetLoad, { value: 102.5, unit: "kg" });
  assert.ok(stepUp.reasonCodes.includes("calibration_trial_rir_above_target"));
  assert.equal(stepUp.requiresConfirmation, true);

  const accept = registry.evaluate(
    context({
      prescription: calibrationPrescription,
      recentSessions: [performed("session-1", { reps: [8], rir: [5], load: { value: 100, unit: "kg" } })],
      stableHistory: false,
      calibrationAttemptCount: 1,
    }),
  );
  assert.equal(accept.decision, "hold");
  assert.deepEqual(accept.after.targetLoad, { value: 100, unit: "kg" });
  assert.ok(accept.reasonCodes.includes("calibration_accepted_at_target_rir"));

  const stepDown = registry.evaluate(
    context({
      prescription: calibrationPrescription,
      recentSessions: [performed("session-1", { reps: [8], rir: [2], load: { value: 100, unit: "kg" } })],
      stableHistory: false,
      calibrationAttemptCount: 1,
    }),
  );
  assert.equal(stepDown.decision, "reduce_load");
  assert.deepEqual(stepDown.after.targetLoad, { value: 95, unit: "kg" });

  const exhausted = registry.evaluate(
    context({
      prescription: calibrationPrescription,
      recentSessions: [performed("session-1", { reps: [8], rir: [7], load: { value: 100, unit: "kg" } })],
      stableHistory: false,
      calibrationAttemptCount: 3,
    }),
  );
  assert.equal(exhausted.decision, "hold");
  assert.ok(exhausted.reasonCodes.includes("calibration_attempt_limit_reached_load_remains_unknown"));
});

test("校准阶梯不接管：已有稳定历史或计划已有负荷时走常规进阶逻辑", () => {
  const established = registry.evaluate(
    context({
      recentSessions: [
        performed("session-1", { reps: [10, 10, 10], rir: [7, 7, 7], load: { value: 100, unit: "kg" } }),
        performed("session-2", { reps: [10, 10, 10], rir: [7, 7, 7], load: { value: 100, unit: "kg" } }),
      ],
    }),
  );
  assert.notEqual(established.decision, "hold");
  assert.ok(!established.reasonCodes.includes("calibration_trial_rir_above_target"));
});
