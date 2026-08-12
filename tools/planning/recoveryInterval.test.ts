import assert from "node:assert/strict";
import test from "node:test";

import type { PlannedSessionData } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerFacts } from "../../src/planning";
import { historyByMuscleFrom, recoveryIntervalConflicts } from "../../src/planning/recoveryInterval";

function session(date: string, muscles: readonly string[], setCount = 3): PlannedSessionData {
  return {
    id: `session-${date}`,
    title: "test session",
    scheduledFor: date,
    knowledgePins: {} as PlannedSessionData["knowledgePins"],
    tasks: [],
    stimulusSlots: [{
      id: `slot-${date}`,
      intent: {
        movementPattern: "squat",
        muscleGroups: muscles,
        directMuscles: muscles,
        stability: "either",
        prescriptionMode: "weighted_reps",
        fatigueIntent: "medium",
        priority: "primary",
      },
      prescription: { setCount },
      exerciseSlot: {
        status: "resolved",
        satisfiedContracts: [],
        deviatedContracts: [],
        requiredEquipment: [],
        performanceComparability: "cold_start",
        coldStart: true,
        sessionTimeImpactMinutes: 0,
        fatigueImpact: "medium",
        cameraCapability: "manual_only",
        reasonCodes: [],
      },
      lockedFields: [],
    }],
  };
}

test("昨天直接训练腿部，今天计划腿部 → 按每块肌群报告恢复间隔冲突", () => {
  const conflicts = recoveryIntervalConflicts({
    sessions: [session("2026-08-12", ["quadriceps", "hamstrings", "glutes"])],
    historyByMuscle: {
      quadriceps: "2026-08-11",
      hamstrings: "2026-08-11",
      glutes: "2026-08-11",
    },
  });

  assert.deepEqual(conflicts, [
    {
      muscle: "quadriceps",
      previousDate: "2026-08-11",
      conflictDate: "2026-08-12",
      actualGapDays: 1,
      requiredGapDays: 2,
      previousFromHistory: true,
    },
    {
      muscle: "hamstrings",
      previousDate: "2026-08-11",
      conflictDate: "2026-08-12",
      actualGapDays: 1,
      requiredGapDays: 2,
      previousFromHistory: true,
    },
    {
      muscle: "glutes",
      previousDate: "2026-08-11",
      conflictDate: "2026-08-12",
      actualGapDays: 1,
      requiredGapDays: 2,
      previousFromHistory: true,
    },
  ]);
});

test("历史归约保留每块肌群最新训练日", () => {
  assert.deepEqual(
    historyByMuscleFrom({
      events: [
        { occurredAt: "2026-08-10T18:00:00.000Z", muscles: ["chest", "triceps"] },
        { occurredAt: "2026-08-11T18:00:00.000Z", muscles: ["chest"] },
      ],
    }),
    { chest: "2026-08-11", triceps: "2026-08-10" },
  );
});

test("精确历史动作也进入恢复检查，不只依赖用户自由文本", () => {
  const planner = new GoalCyclePlanner(new KnowledgePackRegistry(createInstalledKnowledgePack()));
  const historicalSet = (id: string, exerciseVariantId: string) => ({
    eventId: id,
    revision: 1,
    occurredAt: "2026-08-09T19:00:00.000Z",
    recordedAt: "2026-08-09T19:05:00.000Z",
    timezoneOffsetMinutes: 0,
    fact: {
      kind: "training" as const,
      confidence: "confirmed" as const,
      historicalSet: { exerciseVariantId, load: { value: 50, unit: "kg" as const }, reps: 8 },
    },
  });
  const facts: PlannerFacts = {
    userId: "recovery-history-user",
    profile: {
      revision: 1,
      value: {
        id: "profile", trainingExperience: "intermediate", locale: "zh-CN", adultConfirmed: true,
        demographics: {
          ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" },
        },
        schedule: { weeklyFrequency: 3, sessionDurationMinutes: 75 },
        locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
      },
    },
    goalContract: {
      revision: 1,
      value: {
        id: "goal", primaryGoal: "hypertrophy", goalType: "hypertrophy",
        successMetrics: ["adherence"], horizon: { startDate: "2026-08-10" }, status: "active",
      },
    },
    mandate: { revision: 1, value: { id: "mandate", mode: "collaborative" } },
    safetyConstraints: [], equipmentProfiles: [], recoveryConstraints: [], nutritionStrategies: [],
    timeline: [
      historicalSet("squat", "squat.barbell.shoulder_width.standard.bilateral.full_rom"),
      historicalSet("bench", "bench_press.barbell.flat.standard.bilateral.full_rom"),
      historicalSet("row", "row.band.bent_over.neutral.bilateral.full_rom"),
    ] as PlannerFacts["timeline"],
  };

  const decision = planner.plan({
    trigger: "initial_plan",
    currentDate: "2026-08-10",
    preferredSplitId: "full_body",
    schedule: [
      { weekday: 1, availableMinutes: 75, locationId: "gym" },
      { weekday: 2, availableMinutes: 75, locationId: "gym" },
      { weekday: 3, availableMinutes: 75, locationId: "gym" },
    ],
    facts,
  });

  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const conflicts = decision.planRevision.recoveryIntervalConflicts ?? [];
  assert.ok(
    conflicts.some((conflict) => conflict.previousFromHistory && conflict.previousDate === "2026-08-09"),
    `应报告来自精确历史动作的恢复冲突，实际：${JSON.stringify(conflicts)}`,
  );
  assert.ok(
    decision.planRevision.reasonCodes?.some((code) => code.endsWith(":after_training_history")),
    `恢复冲突码必须进入返回计划，实际：${JSON.stringify(decision.planRevision.reasonCodes)}`,
  );
});
