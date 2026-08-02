import assert from "node:assert/strict";
import test from "node:test";

import {
  CANDIDATE_ABSOLUTE_RULES_V1,
  EXPERIMENTAL_THRESHOLDS_V1,
  RULE_METRIC,
  scoreFormSet,
  type MetricObservation,
  type RuleEngineContext,
  type RuleEngineRepMetrics,
} from "../../src/pose/formRuleEngine";

function metric(value: number | null, overrides: Partial<MetricObservation> = {}): MetricObservation {
  return {
    value,
    unit: "normalized",
    confidence: 0.95,
    usableFrameRatio: 0.95,
    requiredJoints: ["leftWrist"],
    jointVisibility: { leftWrist: 0.95 },
    ...overrides,
  };
}

function rep(
  repIndex: number,
  values: {
    amplitude?: number;
    asymmetry?: number;
    torsoDrift?: number;
    toExtremeMs?: number;
    fromExtremeMs?: number;
  } = {},
): RuleEngineRepMetrics {
  return {
    repIndex,
    startMs: repIndex * 2_000,
    extremeMs: repIndex * 2_000 + 800,
    endMs: repIndex * 2_000 + 1_800,
    metrics: {
      [RULE_METRIC.amplitude]: metric(values.amplitude ?? 1),
      [RULE_METRIC.bilateralAsymmetryRatio]: metric(values.asymmetry ?? 0.05),
      [RULE_METRIC.torsoDriftDeg]: metric(values.torsoDrift ?? 4, { unit: "deg" }),
      [RULE_METRIC.toExtremeMs]: metric(values.toExtremeMs ?? 800, { unit: "ms" }),
      [RULE_METRIC.fromExtremeMs]: metric(values.fromExtremeMs ?? 1_000, { unit: "ms" }),
    },
    phaseSemantics: { toExtreme: "concentric", fromExtreme: "eccentric" },
  };
}

const userContext: RuleEngineContext = {
  cameraView: "side",
  exercise: { mode: "user", exerciseId: "barbell_row" },
};

const validatedApproval = {
  status: "validated" as const,
  decision: "promote" as const,
  model: "glm-5v-turbo" as const,
  validationSampleSize: 12,
  hallucinationRate: 0.08,
  tuningDatasetId: "field-calibration-v1",
  validationDatasetId: "held-out-validation-v1",
  evaluatedAt: "2026-08-02T12:00:00.000Z",
};

test("full score means no obvious issue was detected", () => {
  const result = scoreFormSet([rep(1), rep(2), rep(3)], userContext);
  assert.equal(result.status, "scored");
  assert.equal(result.score, 100);
  assert.equal(result.label, "未检出明显问题");
  assert.equal(result.thresholdStatus, "experimental");
  assert.equal(result.validationSampleSize, 0);
});

test("deducts a major relative amplitude drop only on the affected rep", () => {
  const result = scoreFormSet(
    [rep(1), rep(2), rep(3, { amplitude: 0.6 }), rep(4)],
    userContext,
  );
  assert.equal(result.reps[2].score, 85);
  assert.deepEqual(
    result.reps[2].deductions.map((item) => item.ruleId),
    ["relative_amplitude_drop"],
  );
  assert.equal(result.reps[0].score, 100);
  assert.equal(result.lowestRepIndex, 3);
});

test("low quality refuses only the unsupported field and suppresses the total score", () => {
  const unreliable = rep(2);
  unreliable.metrics[RULE_METRIC.amplitude] = metric(1, {
    confidence: 0.4,
    usableFrameRatio: 0.95,
  });
  const result = scoreFormSet([rep(1), unreliable, rep(3), rep(4)], userContext);
  const amplitude = result.reps[1].evaluations.find(
    (evaluation) => evaluation.ruleId === "relative_amplitude_drop",
  );
  assert.equal(result.status, "partial");
  assert.equal(result.score, null);
  assert.equal(result.reps[1].status, "partial");
  assert.equal(result.reps[1].score, null);
  assert.equal(amplitude?.status, "refused");
  assert.match(amplitude?.reason ?? "", /置信度/);
});

test("unknown phase semantics refuses the eccentric rule", () => {
  const reps = [rep(1), rep(2), rep(3)];
  for (const item of reps) item.phaseSemantics = { toExtreme: "unknown", fromExtreme: "unknown" };
  const result = scoreFormSet(reps, userContext);
  const evaluation = result.reps[0].evaluations.find(
    (item) => item.ruleId === "relative_eccentric_acceleration",
  );
  assert.equal(result.reps[0].status, "partial");
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /相位语义未知/);
});

test("deducts a relative eccentric acceleration only when phase meaning is known", () => {
  const result = scoreFormSet(
    [rep(1), rep(2), rep(3, { fromExtremeMs: 500 }), rep(4)],
    userContext,
  );
  assert.equal(result.reps[2].score, 90);
  assert.equal(result.reps[2].deductions[0].ruleId, "relative_eccentric_acceleration");
});

test("low-confidence auto recognition gates exercise-specific absolute rules", () => {
  const result = scoreFormSet(
    [rep(1), rep(2), rep(3)],
    {
      cameraView: "side",
      exercise: { mode: "auto", exerciseId: "barbell_row", confidence: 0.55 },
    },
    {
      absoluteRules: [
        {
          id: "barbell_row_min_amplitude",
          metric: RULE_METRIC.amplitude,
          operator: "lt",
          threshold: 1.1,
          unit: "normalized",
          deduction: 20,
          severity: "major",
          message: "绝对幅度不足",
          requiresExercise: ["barbell_row"],
          supportedViews: ["side", "oblique45"],
          approval: validatedApproval,
        },
      ],
    },
  );
  assert.equal(result.reps[0].status, "partial");
  assert.equal(result.reps[0].score, null);
  const evaluation = result.reps[0].evaluations.find(
    (item) => item.ruleId === "barbell_row_min_amplitude",
  );
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /自动动作识别置信度不足/);
});

test("user selection enables matching absolute rules", () => {
  const result = scoreFormSet([rep(1), rep(2), rep(3)], userContext, {
    absoluteRules: [
      {
        id: "barbell_row_min_amplitude",
        metric: RULE_METRIC.amplitude,
        operator: "lt",
        threshold: 1.1,
        unit: "normalized",
        deduction: 20,
        severity: "major",
        message: "绝对幅度不足",
        requiresExercise: ["barbell_row"],
        approval: validatedApproval,
      },
    ],
  });
  assert.equal(result.reps[0].score, 80);
  assert.equal(result.reps[0].deductions[0].ruleId, "barbell_row_min_amplitude");
});

test("returns not_scored when every field is unavailable", () => {
  const empty = rep(1);
  empty.metrics = {};
  const result = scoreFormSet([empty], userContext);
  assert.equal(result.status, "not_scored");
  assert.equal(result.score, null);
  assert.equal(result.reps[0].label, "数据不可信，未评分");
});

test("candidate absolute rules are observable but cannot deduct", () => {
  const result = scoreFormSet(
    [rep(1, { torsoDrift: 30 }), rep(2, { torsoDrift: 30 }), rep(3, { torsoDrift: 30 })],
    userContext,
    { absoluteRules: CANDIDATE_ABSOLUTE_RULES_V1 },
  );
  const candidate = result.reps[0].evaluations.find((evaluation) =>
    evaluation.ruleId === "torso_compensation_major_candidate",
  );
  assert.equal(result.reps[0].score, 100);
  assert.equal(candidate?.status, "not_applicable");
  assert.match(candidate?.reason ?? "", /尚未晋级/);
});

test("absolute rules refuse observations with incompatible units", () => {
  const result = scoreFormSet([rep(1), rep(2), rep(3)], userContext, {
    absoluteRules: [
      {
        id: "wrong_unit_rule",
        metric: RULE_METRIC.amplitude,
        operator: "lt",
        threshold: 20,
        unit: "deg",
        deduction: 50,
        severity: "major",
        message: "不应触发",
        requiresExercise: ["barbell_row"],
        approval: validatedApproval,
      },
    ],
  });
  const evaluation = result.reps[0].evaluations.find(
    (item) => item.ruleId === "wrong_unit_rule",
  );
  assert.equal(result.reps[0].status, "partial");
  assert.equal(result.reps[0].score, null);
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /单位/);
});

test("required joint visibility participates in field-level refusal", () => {
  const lowJoint = rep(2);
  lowJoint.metrics[RULE_METRIC.amplitude] = metric(1, {
    requiredJoints: ["leftWrist", "rightWrist"],
    jointVisibility: { leftWrist: 0.45, rightWrist: 0.95 },
  });
  const result = scoreFormSet([rep(1), lowJoint, rep(3), rep(4)], userContext);
  const evaluation = result.reps[1].evaluations.find(
    (item) => item.ruleId === "relative_amplitude_drop",
  );
  assert.equal(result.reps[1].status, "partial");
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /leftWrist 可见率/);
});

test("non-finite quality values are refused", () => {
  const invalidQuality = rep(2);
  invalidQuality.metrics[RULE_METRIC.amplitude] = metric(1, { confidence: Number.NaN });
  const result = scoreFormSet([rep(1), invalidQuality, rep(3), rep(4)], userContext);
  const evaluation = result.reps[1].evaluations.find(
    (item) => item.ruleId === "relative_amplitude_drop",
  );
  assert.equal(result.reps[1].status, "partial");
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /不是有效的/);
});

test("validated absolute rules require auditable, independent validation evidence", () => {
  const result = scoreFormSet([rep(1), rep(2), rep(3)], userContext, {
    absoluteRules: [
      {
        id: "invalid_promotion",
        metric: RULE_METRIC.amplitude,
        operator: "lt",
        threshold: 1.1,
        unit: "normalized",
        deduction: 20,
        severity: "major",
        message: "不应触发",
        requiresExercise: ["barbell_row"],
        approval: {
          ...validatedApproval,
          tuningDatasetId: "same-data",
          validationDatasetId: "same-data",
        },
      },
    ],
  });
  const evaluation = result.reps[0].evaluations.find(
    (item) => item.ruleId === "invalid_promotion",
  );
  assert.equal(result.reps[0].status, "partial");
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /独立调参与验证数据集/);
});

test("non-finite auto recognition confidence refuses exercise-dependent rules", () => {
  const result = scoreFormSet(
    [rep(1), rep(2), rep(3)],
    {
      cameraView: "side",
      exercise: { mode: "auto", exerciseId: "barbell_row", confidence: Number.NaN },
    },
  );
  const evaluation = result.reps[0].evaluations.find(
    (item) => item.ruleId === "relative_eccentric_acceleration",
  );
  assert.equal(result.status, "partial");
  assert.equal(result.score, null);
  assert.equal(evaluation?.status, "refused");
  assert.match(evaluation?.reason ?? "", /置信度不是有效/);
});

test("frozen thresholds carry their validation sample size", () => {
  assert.equal(EXPERIMENTAL_THRESHOLDS_V1.version, "form-rules-experimental-v1");
  assert.equal(EXPERIMENTAL_THRESHOLDS_V1.validationSampleSize, 0);
  assert.equal(EXPERIMENTAL_THRESHOLDS_V1.relativeAmplitude.majorRatio, 0.65);
});
