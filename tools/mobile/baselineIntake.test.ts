import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BASELINE_INTAKE_FIELDS,
  EMPTY_BASELINE_INTAKE,
  isBaselineIntakeComplete,
} from "../../src/mobile/ui/baselineIntake";

test("baseline intake exposes exactly the four user-required inputs with no defaults", () => {
  assert.deepEqual(
    BASELINE_INTAKE_FIELDS.map((field) => [field.id, field.control, field.unit]),
    [
      ["ageYears", "integer", "years"],
      ["heightCm", "decimal", "cm"],
      ["currentWeightKg", "decimal", "kg"],
      ["goalNarrative", "multiline_text", undefined],
    ],
  );
  assert.deepEqual(EMPTY_BASELINE_INTAKE, {
    ageYears: "",
    heightCm: "",
    currentWeightKg: "",
    goalNarrative: "",
  });
});

test("baseline intake is complete only when all four values were supplied", () => {
  assert.equal(isBaselineIntakeComplete(EMPTY_BASELINE_INTAKE), false);
  assert.equal(isBaselineIntakeComplete({
    ageYears: "30",
    heightCm: "179",
    currentWeightKg: "75",
    goalNarrative: "想把体脂率降到 12%，目前约 16%。",
  }), true);
});

test("新用户建档界面不再保留固定训练等级、地点或协作模式问卷入口", async () => {
  const source = await readFile(new URL("../../src/mobile/ui/ProductShell.tsx", import.meta.url), "utf8");
  const onboarding = source.slice(source.indexOf("function OnboardingScreen"), source.indexOf("function PlanningPreviewScreen"));

  assert.match(onboarding, /BaselineIntakeCard/);
  assert.match(onboarding, /DynamicOnboardingFormCard/);
  assert.doesNotMatch(onboarding, /你现在的训练起点/);
  assert.doesNotMatch(onboarding, /QUICK START/);
  assert.doesNotMatch(onboarding, /retiredFixedQuestionnaire/);
  assert.doesNotMatch(onboarding, /trainingExperience:\s*experience/);
});
