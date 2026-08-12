import assert from "node:assert/strict";
import test from "node:test";

import type { PlannedSessionData } from "../../src/coach/domain";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { fatigueContributionsForExercise, forecastMuscleFatigue } from "../../src/planning/muscleFatigue";

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());

function scoreOf(entries: readonly { muscleId: string; relativeLoad: number }[], muscle: string): number {
  return entries.find((entry) => entry.muscleId === muscle)?.relativeLoad ?? 0;
}

function session(input: {
  date: string;
  exerciseVariantId: string;
  movementPattern: NonNullable<PlannedSessionData["stimulusSlots"]>[number]["intent"]["movementPattern"];
  fatigueIntent: "low" | "medium" | "high";
  sets?: number;
}): PlannedSessionData {
  const sets = input.sets ?? 3;
  return {
    id: `session-${input.date}`,
    title: "test",
    scheduledFor: input.date,
    knowledgePins: {} as PlannedSessionData["knowledgePins"],
    kind: "weighted_reps",
    tasks: [{
      id: `task-${input.date}`,
      exerciseVariantId: input.exerciseVariantId,
      stimulusSlotId: `slot-${input.date}`,
      mode: "weighted_reps",
      sets: Array.from({ length: sets }, (_, index) => ({
        id: `set-${input.date}-${index}`,
        targetRirRange: { min: 2, max: 2 },
      })),
    }],
    stimulusSlots: [{
      id: `slot-${input.date}`,
      intent: {
        movementPattern: input.movementPattern,
        muscleGroups: [],
        prescriptionMode: "weighted_reps",
        stability: "either",
        fatigueIntent: input.fatigueIntent,
        priority: "primary",
      },
      prescription: { setCount: sets },
      exerciseSlot: {
        status: "resolved", exerciseVariantId: input.exerciseVariantId,
        satisfiedContracts: [], deviatedContracts: [], requiredEquipment: [],
        performanceComparability: "cold_start", coldStart: true, sessionTimeImpactMinutes: 0,
        fatigueImpact: input.fatigueIntent, cameraCapability: "manual_only", reasonCodes: [],
      },
      lockedFields: [],
    }],
  };
}

test("卧推恢复负荷：胸主目标高，三头与前三角为可见的次级负荷，不混入直接组账本", () => {
  const bench = registry.exerciseVariant("bench_press.dumbbell.flat.close.bilateral.full_rom");
  assert.ok(bench);
  const load = fatigueContributionsForExercise({ exercise: bench, setCount: 3, fatigueIntent: "medium", rir: 2 });
  assert.equal(scoreOf(load, "chest"), 100);
  assert.equal(scoreOf(load, "triceps"), 45);
  assert.equal(scoreOf(load, "anterior_deltoid"), 45);
});

test("高疲劳硬拉会把背部作为次级恢复负荷记入；翌日背部计划能读到残余负荷", () => {
  const deadlift = "deadlift.dumbbell.standard.standard.bilateral.full_rom.conventional";
  const back = "lat_pulldown.machine.kneeling.neutral.bilateral.full_rom.supported";
  const deadliftVariant = registry.exerciseVariant(deadlift);
  assert.ok(deadliftVariant);
  const deadliftLoad = fatigueContributionsForExercise({ exercise: deadliftVariant, setCount: 3, fatigueIntent: "high", rir: 2 });
  assert.ok(scoreOf(deadliftLoad, "back") > 60, `硬拉背部次级负荷应可见：${JSON.stringify(deadliftLoad)}`);

  const forecast = forecastMuscleFatigue({
    history: [{ exerciseVariantId: deadlift, occurredAt: "2026-08-11T18:00:00.000Z", load: { value: 100, unit: "kg" }, reps: 5, rir: 2, confidence: "confirmed", evidenceRef: "test:deadlift" }],
    sessions: [session({ date: "2026-08-12", exerciseVariantId: back, movementPattern: "vertical_pull", fatigueIntent: "medium" })],
    exerciseById: (id) => registry.exerciseVariant(id),
  });
  const day = forecast.days[0];
  assert.ok((day?.residualBefore.back ?? 0) > 0, `翌日背部课前应保留硬拉的背部残余负荷：${JSON.stringify(day)}`);
  assert.ok((day?.addedByMuscle.back ?? 0) > 0, "背部课自身的主目标负荷也应单独可见");
});
