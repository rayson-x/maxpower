import assert from "node:assert/strict";
import test from "node:test";

import type { SetOutcomeData } from "../../src/coach/domain";
import type { ExerciseVariant } from "../../src/knowledge/model";
import { createInstalledKnowledgePack } from "../../src/knowledge";
import { assessMuscleWeek, WEEKLY_DIRECT_SET_TARGETS } from "../../src/planning/MuscleWeekReview";

const pack = createInstalledKnowledgePack();
const variants = new Map(pack.exerciseCatalog.variants.map((variant) => [variant.id, variant]));

const BENCH = "bench_press.barbell.decline.close.bilateral.full_rom";
const UNREVIEWED = "mobility_flow.none.gentle.standard.bilateral.full_rom.ankle";

function outcome(exerciseVariantId: string, overrides?: Partial<SetOutcomeData>): SetOutcomeData {
  return {
    id: `o-${exerciseVariantId}-${Math.random().toString(36).slice(2, 8)}`,
    prescriptionSetId: "p1",
    exerciseVariantId,
    source: "user_confirmed",
    ...overrides,
  } as SetOutcomeData;
}

function exerciseById(id: string): ExerciseVariant | undefined {
  return variants.get(id);
}

const WEEK = { startDate: "2026-08-10", endDate: "2026-08-16" };

test("复合动作确认组展开为主目标直接组与协同相对负荷，事实链可展开到动作与日期", () => {
  const report = assessMuscleWeek({
    week: WEEK,
    completedSets: [{ completedAt: "2026-08-12T10:00:00.000+08:00", outcomes: [outcome(BENCH, { actualRir: 2 }), outcome(BENCH, { actualRir: 2 }), outcome(BENCH, { actualRir: 2 })] }],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "intermediate",
    exerciseById,
  });
  const chest = report.perMuscle.find((row) => row.muscleId === "chest");
  assert.ok(chest);
  assert.equal(chest!.directSets, 3);
  assert.equal(chest!.targetGap, "low", "3 个直接组低于 intermediate 4–10 带");
  const triceps = report.perMuscle.find((row) => row.muscleId === "triceps");
  assert.ok(triceps, "卧推必须给三头带来协同负荷");
  assert.equal(triceps!.directSets, 0, "协同角色不产生直接组");
  assert.ok(triceps!.relativeLoad > 0);
  assert.ok(chest!.contributions.every((entry) => entry.exerciseVariantId === BENCH && entry.date === "2026-08-12"));
  assert.equal(report.disclaimer, "relative_load_not_strength_or_activation");
  assert.equal(report.policy.version, "1.0.0");
  assert.equal(report.targetPolicy.version, WEEKLY_DIRECT_SET_TARGETS.version);
  assert.equal(report.knowledgeVersion, "test-pack@v1");
});

test("未确认来源与计划内组永远不进入账本", () => {
  const report = assessMuscleWeek({
    week: WEEK,
    completedSets: [{
      completedAt: "2026-08-12T10:00:00.000+08:00",
      outcomes: [
        outcome(BENCH, { actualRir: 2 }),
        { ...outcome(BENCH), source: "sensor_inferred" as never },
      ],
    }],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "intermediate",
    exerciseById,
  });
  const chest = report.perMuscle.find((row) => row.muscleId === "chest");
  assert.equal(chest?.directSets, 1, "只有 user_confirmed/imported 来源计入");
  assert.equal(report.rirMissing.totalSets, 1);
});

test("RIR 缺失按 0.85 保守折算并显式标注缺失比例", () => {
  const withRir = assessMuscleWeek({
    week: WEEK,
    completedSets: [{ completedAt: "2026-08-12T10:00:00.000+08:00", outcomes: [outcome(BENCH, { actualRir: 2 }), outcome(BENCH, { actualRir: 2 }), outcome(BENCH, { actualRir: 2 })] }],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "intermediate",
    exerciseById,
  });
  const missing = assessMuscleWeek({
    week: WEEK,
    completedSets: [{ completedAt: "2026-08-12T10:00:00.000+08:00", outcomes: [outcome(BENCH), outcome(BENCH), outcome(BENCH)] }],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "intermediate",
    exerciseById,
  });
  const chestWith = withRir.perMuscle.find((row) => row.muscleId === "chest")!;
  const chestMissing = missing.perMuscle.find((row) => row.muscleId === "chest")!;
  assert.ok(chestMissing.relativeLoad < chestWith.relativeLoad, "缺 RIR 必须按保守值折算得更低");
  assert.equal(missing.rirMissing.sets, 3);
  assert.equal(missing.rirMissing.totalSets, 3);
  assert.equal(missing.rirMissing.share, 1);
  assert.ok(missing.limitations.some((line) => line.includes("0.85")));
});

test("肌群关联未审校的动作计为 unknown 并列入限制，不猜测归属", () => {
  const report = assessMuscleWeek({
    week: WEEK,
    completedSets: [{ completedAt: "2026-08-12T10:00:00.000+08:00", outcomes: [outcome(UNREVIEWED, { actualRir: 1 }), outcome(BENCH, { actualRir: 2 })] }],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "intermediate",
    exerciseById,
  });
  assert.ok(report.unknownExercises.some((entry) => entry.exerciseVariantId === UNREVIEWED && entry.sets === 1));
  assert.ok(report.limitations.some((line) => line.includes("未审校")));
  assert.equal(report.perMuscle.every((row) => row.contributions.every((entry) => entry.exerciseVariantId !== UNREVIEWED)), true);
  assert.equal(report.confidence, "partial");
});

test("周界之外的确认组不计入；空周给出低置信与明确限制", () => {
  const report = assessMuscleWeek({
    week: WEEK,
    completedSets: [{ completedAt: "2026-08-01T10:00:00.000+08:00", outcomes: [outcome(BENCH, { actualRir: 2 })] }],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "beginner",
    exerciseById,
  });
  assert.equal(report.perMuscle.length, 0);
  assert.equal(report.confidence, "low");
  assert.ok(report.limitations.some((line) => line.includes("没有已确认的训练组")));
});

test("同一周内多日同一动作的贡献聚合且日期保持可展开", () => {
  const report = assessMuscleWeek({
    week: WEEK,
    completedSets: [
      { completedAt: "2026-08-11T10:00:00.000+08:00", outcomes: [outcome(BENCH, { actualRir: 2 }), outcome(BENCH, { actualRir: 2 })] },
      { completedAt: "2026-08-14T10:00:00.000+08:00", outcomes: [outcome(BENCH, { actualRir: 1 }), outcome(BENCH, { actualRir: 1 })] },
    ],
    knowledgeVersion: "test-pack@v1",
    trainingLevel: "intermediate",
    exerciseById,
  });
  const chest = report.perMuscle.find((row) => row.muscleId === "chest")!;
  assert.equal(chest.directSets, 4);
  assert.deepEqual([...new Set(chest.contributions.map((entry) => entry.date))], ["2026-08-11", "2026-08-14"]);
  assert.ok(report.explanations.some((line) => line.includes("chest") && line.includes("4 直接组")));
});
