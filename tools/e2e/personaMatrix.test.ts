import assert from "node:assert/strict";
import test from "node:test";

import { matrixCoverage, PERSONA_MATRIX } from "./personaMatrix";

/** 矩阵自检：档案必须真的覆盖声明的维度，且字段自洽。 */

test("矩阵覆盖声明的全部维度", () => {
  const coverage = matrixCoverage();
  assert.ok(coverage.personas >= 20, "至少 20 个人设");
  assert.ok(coverage.sexes.includes("male") && coverage.sexes.includes("female"));
  assert.ok(coverage.sexes.includes("prefer_not_to_say"), "含未填性别");
  assert.ok(coverage.ageRange[0] < 18 && coverage.ageRange[1] > 60, "含未成年与老年");
  assert.ok(coverage.bmiRange[0] < 19 && coverage.bmiRange[1] > 30, "含偏瘦与肥胖");
  assert.ok(coverage.goals.includes("fat_loss_preserve_lean_mass") && coverage.goals.includes("hypertrophy") && coverage.goals.includes("strength"));
  assert.ok(coverage.weeklyDays.includes(2) && coverage.weeklyDays.includes(6), "含 2 天与 6 天");
  assert.ok(coverage.sessionMinutes.includes(20) && coverage.sessionMinutes.includes(90), "含 20 与 90 分钟");
  assert.deepEqual(new Set(coverage.trainingCommitment.filter((item) => item !== "inferred")), new Set(["minimal", "standard", "high"]));
  assert.deepEqual(new Set(coverage.nutritionCommitment.filter((item) => item !== "inferred")), new Set(["flexible", "standard", "strict"]));
  assert.ok(coverage.trainingCommitment.includes("inferred"), "含未显式选择（走推断）的人设");
  assert.ok(coverage.withHardConstraints >= 3, "含硬约束人设");
  assert.ok(coverage.withProfessionalConstraints >= 3, "含专业约束人设");
  assert.ok(coverage.withStrengthBaseline >= 4, "含有力量基线的人设");
  assert.deepEqual(new Set(coverage.mandateModes), new Set(["collaborative", "managed", "manual"]));
});

test("每个人设字段自洽（id 唯一、自述非空、目标与档案方向一致）", () => {
  const ids = new Set<string>();
  for (const persona of PERSONA_MATRIX) {
    assert.ok(!ids.has(persona.id), `重复 id: ${persona.id}`);
    ids.add(persona.id);
    assert.ok(persona.selfDescription.length > 5, `${persona.id} 缺自述`);
    assert.ok(persona.watchFor.length > 0, `${persona.id} 缺验证点`);
    assert.ok(persona.profile.schedule, `${persona.id} 缺排程（规划必需）`);
    assert.ok(persona.profile.locations?.length, `${persona.id} 缺训练地点`);
    if (persona.goalContract.primaryGoal === "fat_loss_preserve_lean_mass") {
      assert.notEqual(persona.profile.bodyDirection, "gain_mass", `${persona.id} 目标与方向矛盾`);
    }
  }
});
