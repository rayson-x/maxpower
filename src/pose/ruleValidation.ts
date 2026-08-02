export type ValidationSplit = "tuning" | "validation";
export type GroundTruth = "positive" | "negative";
export type RuleDecision = "detected" | "not_detected" | "refused";

/** A rep-level, independently reviewed outcome for one candidate rule. */
export interface RuleValidationExample {
  /** Binds one tuning/validation pair for one promotion decision. */
  promotionCohortId: string;
  datasetId: string;
  split: ValidationSplit;
  subjectId: string;
  recordingBatchId: string;
  ruleId: string;
  ruleVersion: string;
  profileVersion: string;
  metricDefinitionId: string;
  thresholdVersion: string;
  groundTruth: GroundTruth;
  decision: RuleDecision;
}

export interface RuleValidationSummary {
  promotionCohortId: string;
  ruleId: string;
  ruleVersion: string;
  profileVersion: string;
  metricDefinitionId: string;
  thresholdVersion: string;
  datasetId: string;
  split: ValidationSplit;
  total: number;
  evaluated: number;
  refused: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number | null;
  recall: number | null;
  falsePositiveRate: number | null;
  refusalRate: number;
}

/**
 * Computes a transparent evaluation report. Refused reps remain in the
 * denominator for refusal rate but never pretend to be positive or negative.
 */
export function summarizeRuleValidation(
  examples: readonly RuleValidationExample[],
): RuleValidationSummary[] {
  const groups = new Map<string, RuleValidationExample[]>();
  for (const example of examples) {
    assertExample(example);
    const key = [
      example.promotionCohortId,
      example.datasetId,
      example.split,
      example.ruleId,
      example.ruleVersion,
      example.profileVersion,
      example.metricDefinitionId,
      example.thresholdVersion,
    ].join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), example]);
  }
  return [...groups.values()].map((group) => summarizeGroup(group));
}

/** Rejects a promotion dataset that leaks a person or acquisition batch across splits. */
export function validateIndependentSplits(
  examples: readonly RuleValidationExample[],
): string[] {
  const cohorts = new Map<
    string,
    {
      tuningSubjects: Set<string>;
      validationSubjects: Set<string>;
      tuningBatches: Set<string>;
      validationBatches: Set<string>;
      tuningDatasets: Set<string>;
      validationDatasets: Set<string>;
    }
  >();
  for (const example of examples) {
    assertExample(example);
    const cohort = cohorts.get(example.promotionCohortId) ?? {
      tuningSubjects: new Set<string>(),
      validationSubjects: new Set<string>(),
      tuningBatches: new Set<string>(),
      validationBatches: new Set<string>(),
      tuningDatasets: new Set<string>(),
      validationDatasets: new Set<string>(),
    };
    cohorts.set(example.promotionCohortId, cohort);
    const subjects = example.split === "tuning" ? cohort.tuningSubjects : cohort.validationSubjects;
    const batches = example.split === "tuning" ? cohort.tuningBatches : cohort.validationBatches;
    subjects.add(example.subjectId);
    batches.add(example.recordingBatchId);
    (example.split === "tuning" ? cohort.tuningDatasets : cohort.validationDatasets).add(
      example.datasetId,
    );
  }
  const errors: string[] = [];
  for (const [cohortId, cohort] of cohorts) {
    if (cohort.tuningDatasets.size === 0) errors.push(`promotion cohort has no tuning dataset: ${cohortId}`);
    if (cohort.validationDatasets.size === 0) errors.push(`promotion cohort has no validation dataset: ${cohortId}`);
    for (const datasetId of cohort.tuningDatasets) {
      if (cohort.validationDatasets.has(datasetId)) {
        errors.push(`dataset appears in both splits for ${cohortId}: ${datasetId}`);
      }
    }
    for (const subjectId of cohort.tuningSubjects) {
      if (cohort.validationSubjects.has(subjectId)) {
        errors.push(`subject appears in both splits for ${cohortId}: ${subjectId}`);
      }
    }
    for (const batchId of cohort.tuningBatches) {
      if (cohort.validationBatches.has(batchId)) {
        errors.push(`recording batch appears in both splits for ${cohortId}: ${batchId}`);
      }
    }
  }
  return errors;
}

function summarizeGroup(group: readonly RuleValidationExample[]): RuleValidationSummary {
  const first = group[0];
  const counts = {
    truePositive: 0,
    falsePositive: 0,
    trueNegative: 0,
    falseNegative: 0,
    refused: 0,
  };
  for (const example of group) {
    if (example.decision === "refused") {
      counts.refused += 1;
    } else if (example.groundTruth === "positive" && example.decision === "detected") {
      counts.truePositive += 1;
    } else if (example.groundTruth === "negative" && example.decision === "detected") {
      counts.falsePositive += 1;
    } else if (example.groundTruth === "negative") {
      counts.trueNegative += 1;
    } else {
      counts.falseNegative += 1;
    }
  }
  const evaluated = group.length - counts.refused;
  return {
    promotionCohortId: first.promotionCohortId,
    ruleId: first.ruleId,
    ruleVersion: first.ruleVersion,
    profileVersion: first.profileVersion,
    metricDefinitionId: first.metricDefinitionId,
    thresholdVersion: first.thresholdVersion,
    datasetId: first.datasetId,
    split: first.split,
    total: group.length,
    evaluated,
    ...counts,
    precision: ratio(counts.truePositive, counts.truePositive + counts.falsePositive),
    recall: ratio(counts.truePositive, counts.truePositive + counts.falseNegative),
    falsePositiveRate: ratio(counts.falsePositive, counts.falsePositive + counts.trueNegative),
    refusalRate: group.length === 0 ? 0 : counts.refused / group.length,
  };
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((numerator / denominator).toFixed(4));
}

function assertExample(example: RuleValidationExample): void {
  for (const [name, value] of Object.entries(example)) {
    if (typeof value === "string" && value.trim() === "") {
      throw new Error(`Rule validation example ${name} must not be empty`);
    }
  }
  if (example.split !== "tuning" && example.split !== "validation") {
    throw new Error(`Rule validation example split is invalid: ${example.split}`);
  }
  if (example.groundTruth !== "positive" && example.groundTruth !== "negative") {
    throw new Error(`Rule validation example groundTruth is invalid: ${example.groundTruth}`);
  }
  if (
    example.decision !== "detected" &&
    example.decision !== "not_detected" &&
    example.decision !== "refused"
  ) {
    throw new Error(`Rule validation example decision is invalid: ${example.decision}`);
  }
}
