import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizeRuleValidation,
  validateIndependentSplits,
  type RuleValidationExample,
} from "../../src/pose/ruleValidation";

const example = (patch: Partial<RuleValidationExample>): RuleValidationExample => ({
  promotionCohortId: "torso-promotion-v1",
  datasetId: "validation-2026-08",
  split: "validation",
  subjectId: "subject-02",
  recordingBatchId: "batch-02",
  ruleId: "torso_compensation_major_candidate",
  ruleVersion: "form-rules-experimental-v1",
  profileVersion: "barbell-row-kinematics/v1",
  metricDefinitionId: "barbell-row/v1/torso-drift",
  thresholdVersion: "form-rules-experimental-v1",
  groundTruth: "negative",
  decision: "not_detected",
  ...patch,
});

test("rule validation reports precision, recall, false-positive and refusal rates separately", () => {
  const summary = summarizeRuleValidation([
    example({ groundTruth: "positive", decision: "detected" }),
    example({ groundTruth: "positive", decision: "not_detected" }),
    example({ groundTruth: "negative", decision: "detected" }),
    example({ groundTruth: "negative", decision: "not_detected" }),
    example({ groundTruth: "positive", decision: "refused" }),
  ])[0];

  assert.deepEqual(
    {
      total: summary.total,
      evaluated: summary.evaluated,
      refused: summary.refused,
      precision: summary.precision,
      recall: summary.recall,
      falsePositiveRate: summary.falsePositiveRate,
      refusalRate: summary.refusalRate,
    },
    {
      total: 5,
      evaluated: 4,
      refused: 1,
      precision: 0.5,
      recall: 0.5,
      falsePositiveRate: 0.5,
      refusalRate: 0.2,
    },
  );
});

test("validation rejects split leakage by subject and acquisition batch", () => {
  const rows = [
    example({ split: "tuning", datasetId: "tuning-2026-08", subjectId: "subject-01" }),
    example({ split: "validation", subjectId: "subject-01", recordingBatchId: "batch-02" }),
    example({ split: "validation", subjectId: "subject-03", recordingBatchId: "batch-01" }),
  ];
  const errors = validateIndependentSplits(rows);
  assert.match(errors.join("\n"), /subject appears in both splits/);
  assert.match(errors.join("\n"), /recording batch appears in both splits/);
});

test("validation summary cannot mix metric or threshold versions", () => {
  const summaries = summarizeRuleValidation([
    example({ metricDefinitionId: "barbell-row/v1/torso-drift" }),
    example({ metricDefinitionId: "barbell-row/v2/torso-drift" }),
    example({ thresholdVersion: "form-rules-experimental-v2" }),
  ]);
  assert.equal(summaries.length, 3);
});

test("independent promotion cohorts do not block one another", () => {
  const errors = validateIndependentSplits([
    example({ promotionCohortId: "rule-a", split: "tuning", subjectId: "subject-01", recordingBatchId: "rule-a-tuning" }),
    example({ promotionCohortId: "rule-a", split: "validation", datasetId: "validation-rule-a", subjectId: "subject-02", recordingBatchId: "rule-a-validation" }),
    example({ promotionCohortId: "rule-b", split: "tuning", datasetId: "tuning-rule-b", subjectId: "subject-01", recordingBatchId: "rule-b-tuning" }),
    example({ promotionCohortId: "rule-b", split: "validation", datasetId: "validation-rule-b", subjectId: "subject-03", recordingBatchId: "rule-b-validation" }),
  ]);
  assert.deepEqual(errors, []);
});

test("promotion cohort requires distinct tuning and validation datasets", () => {
  const errors = validateIndependentSplits([
    example({ split: "tuning", datasetId: "same-dataset" }),
    example({ split: "validation", datasetId: "same-dataset", subjectId: "subject-03" }),
    example({ promotionCohortId: "missing-tuning", split: "validation", datasetId: "validation-only" }),
  ]);
  assert.match(errors.join("\n"), /dataset appears in both splits/);
  assert.match(errors.join("\n"), /no tuning dataset/);
});

test("validation rejects enum values that could arrive from an untyped import", () => {
  assert.throws(
    () => summarizeRuleValidation([example({ decision: "maybe" as never })]),
    /decision is invalid/,
  );
});
