import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DIMENSIONS = [
  "movementTaskCompletion",
  "techniqueAdherence",
  "visibleMovementStrategy",
  "stimulusCompatibility",
  "effortAndDoseContext",
  "range",
  "phaseControl",
  "supportStability",
  "bilateralCoordination",
  "trajectoryControl",
  "observationConfidence",
] as const;

type DimensionName = typeof DIMENSIONS[number];
type DimensionStatus = "observed_acceptable" | "observed_deviation" | "cannot_judge";
type TaskClassification = "valid_rep" | "not_a_rep" | "cannot_judge";

interface AgentOutput {
  schemaVersion: "maxpower-quality-agent-output/v1";
  arm: "multimodal_endpoint_frames" | "text_llm_rust_trajectory";
  cases: AgentCase[];
  limitations: unknown;
  noAggregateScore: true;
}

interface AgentCase {
  captureId: string;
  preset: Record<string, unknown>;
  reps: AgentRep[];
  setSummary: unknown;
}

interface AgentRep {
  repIndex: number;
  taskClassification: TaskClassification;
  dimensions: Record<DimensionName, { status: DimensionStatus; evidenceRefs?: unknown } & Record<string, unknown>>;
  visibleFacts: unknown;
  coachInferences: unknown;
  primaryCue: string | null;
  cannotJudgeReasons: unknown;
}

interface TimelineEvaluation {
  rows: Array<{
    captureId: string;
    reviewableEvaluation: {
      predictedSegments: unknown[];
      matches: Array<{ predictedIndex: number }>;
    };
  }>;
}

export function compareQualityAgentOutputs(
  armAInput: unknown,
  armBInput: unknown,
  timelineInput?: unknown,
) {
  const armA = validateOutput(armAInput, "multimodal_endpoint_frames");
  const armB = validateOutput(armBInput, "text_llm_rust_trajectory");
  assertSameRepUniverse(armA, armB);
  const timeline = timelineInput ? timelineInput as TimelineEvaluation : undefined;
  const dimensionAgreement = Object.fromEntries(DIMENSIONS.map((dimension) => {
    let compared = 0;
    let exact = 0;
    let bothJudgeable = 0;
    let aOnlyJudgeable = 0;
    let bOnlyJudgeable = 0;
    for (const pair of repPairs(armA, armB)) {
      const a = pair.a.dimensions[dimension].status;
      const b = pair.b.dimensions[dimension].status;
      compared += 1;
      if (a === b) exact += 1;
      const aJudgeable = a !== "cannot_judge";
      const bJudgeable = b !== "cannot_judge";
      if (aJudgeable && bJudgeable) bothJudgeable += 1;
      else if (aJudgeable) aOnlyJudgeable += 1;
      else if (bJudgeable) bOnlyJudgeable += 1;
    }
    return [dimension, {
      compared,
      exactAgreementCount: exact,
      exactAgreementRate: ratio(exact, compared),
      bothJudgeable,
      aOnlyJudgeable,
      bOnlyJudgeable,
    }];
  }));
  return {
    schemaVersion: "maxpower-quality-agent-ab-comparison/v1",
    arms: {
      multimodalEndpointFrames: summarizeArm(armA, timeline),
      textLlmRustTrajectory: summarizeArm(armB, timeline),
    },
    dimensionAgreement,
    claimBoundaryAudit: {
      multimodalEndpointFrames: claimBoundaryAudit(armA),
      textLlmRustTrajectory: claimBoundaryAudit(armB),
    },
    disagreements: repPairs(armA, armB).flatMap((pair) => {
      const differing = DIMENSIONS.filter((dimension) =>
        pair.a.dimensions[dimension].status !== pair.b.dimensions[dimension].status,
      );
      return pair.a.taskClassification !== pair.b.taskClassification || differing.length
        ? [{
          captureId: pair.captureId,
          repIndex: pair.a.repIndex,
          taskClassification: { armA: pair.a.taskClassification, armB: pair.b.taskClassification },
          differingDimensions: differing,
        }]
        : [];
    }),
    accuracyBoundary: {
      taskClassification: timeline ? "scored_against_human_rep_ranges_after_agent_outputs_frozen" : "not_scored_without_timeline_truth",
      actionQuality: "blocked_no_expert_quality_gold",
      reason: "existing labels contain rep timing but not expert quality, compensation, cue, or cannot-judge gold",
    },
    noAggregateWinnerScore: true,
  };
}

function claimBoundaryAudit(output: AgentOutput) {
  const reps = output.cases.flatMap((testCase) => testCase.reps);
  const judgeable = (dimension: DimensionName) =>
    reps.filter((rep) => rep.dimensions[dimension].status !== "cannot_judge").length;
  return {
    reviewedTechniqueReferenceAvailable: false,
    clientEquipmentTrackAvailable: false,
    techniqueClaimsWithoutReviewedReference: judgeable("techniqueAdherence"),
    stimulusClaimsWithoutReviewedReference: judgeable("stimulusCompatibility"),
    effortClaimsWithoutUserOrPlanContext: judgeable("effortAndDoseContext"),
    equipmentTrajectoryClaimsWithoutEquipmentTrack: judgeable("trajectoryControl"),
    stillImageContinuousPhaseClaims: output.arm === "multimodal_endpoint_frames" ? judgeable("phaseControl") : 0,
    researchCueCountNotAccuracyScored: reps.filter((rep) => typeof rep.primaryCue === "string" && rep.primaryCue.trim()).length,
  };
}

function summarizeArm(output: AgentOutput, timeline?: TimelineEvaluation) {
  const reps = output.cases.flatMap((testCase) => testCase.reps);
  const classifications = countBy(reps.map((rep) => rep.taskClassification));
  const dimensionCoverage = Object.fromEntries(DIMENSIONS.map((dimension) => {
    const statuses = reps.map((rep) => rep.dimensions[dimension].status);
    return [dimension, {
      judgeableCount: statuses.filter((status) => status !== "cannot_judge").length,
      cannotJudgeCount: statuses.filter((status) => status === "cannot_judge").length,
      observedDeviationCount: statuses.filter((status) => status === "observed_deviation").length,
    }];
  }));
  const taskTruth = timeline ? scoreTaskClassification(output, timeline) : null;
  return {
    arm: output.arm,
    caseCount: output.cases.length,
    repCount: reps.length,
    taskClassifications: classifications,
    cueCount: reps.filter((rep) => typeof rep.primaryCue === "string" && rep.primaryCue.trim()).length,
    dimensionCoverage,
    taskTruth,
  };
}

function scoreTaskClassification(output: AgentOutput, timeline: TimelineEvaluation) {
  let correct = 0;
  let scored = 0;
  let validTruth = 0;
  let falseTruth = 0;
  let validPredicted = 0;
  let validTruePositive = 0;
  let falseDetected = 0;
  for (const testCase of output.cases) {
    const row = timeline.rows.find((candidate) => candidate.captureId === testCase.captureId);
    if (!row || row.reviewableEvaluation.predictedSegments.length !== testCase.reps.length) {
      throw new Error(`timeline_rep_universe_mismatch:${testCase.captureId}`);
    }
    const matched = new Set(row.reviewableEvaluation.matches.map((match) => match.predictedIndex));
    for (const rep of testCase.reps) {
      const truth: Exclude<TaskClassification, "cannot_judge"> = matched.has(rep.repIndex - 1) ? "valid_rep" : "not_a_rep";
      if (truth === "valid_rep") validTruth += 1;
      else falseTruth += 1;
      if (rep.taskClassification === "valid_rep") validPredicted += 1;
      if (rep.taskClassification === "valid_rep" && truth === "valid_rep") validTruePositive += 1;
      if (rep.taskClassification === "not_a_rep" && truth === "not_a_rep") falseDetected += 1;
      if (rep.taskClassification !== "cannot_judge") {
        scored += 1;
        if (rep.taskClassification === truth) correct += 1;
      }
    }
  }
  return {
    candidateCount: validTruth + falseTruth,
    validRepTruthCount: validTruth,
    falseCandidateTruthCount: falseTruth,
    classifiedCount: scored,
    cannotJudgeCount: validTruth + falseTruth - scored,
    classifiedAccuracy: ratio(correct, scored),
    validRepPrecision: ratio(validTruePositive, validPredicted),
    validRepRecall: ratio(validTruePositive, validTruth),
    falseCandidateRecall: ratio(falseDetected, falseTruth),
    boundary: "scores_only_presented_rust_candidates_not_missed_truth_reps",
  };
}

function validateOutput(value: unknown, expectedArm: AgentOutput["arm"]): AgentOutput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("agent_output_not_object");
  const output = value as Partial<AgentOutput>;
  if (output.schemaVersion !== "maxpower-quality-agent-output/v1") throw new Error("agent_output_schema_mismatch");
  if (output.arm !== expectedArm) throw new Error(`agent_output_arm_mismatch:${expectedArm}`);
  if (output.noAggregateScore !== true) throw new Error("agent_output_total_score_forbidden");
  if (!Array.isArray(output.cases)) throw new Error("agent_output_cases_missing");
  for (const testCase of output.cases) {
    if (!testCase.captureId || !Array.isArray(testCase.reps)) throw new Error("agent_output_case_invalid");
    for (const rep of testCase.reps) {
      if (!Number.isInteger(rep.repIndex) || rep.repIndex < 1) throw new Error("agent_output_rep_index_invalid");
      if (!["valid_rep", "not_a_rep", "cannot_judge"].includes(rep.taskClassification)) {
        throw new Error("agent_output_task_classification_invalid");
      }
      for (const dimension of DIMENSIONS) {
        const status = rep.dimensions?.[dimension]?.status;
        if (!["observed_acceptable", "observed_deviation", "cannot_judge"].includes(status)) {
          throw new Error(`agent_output_dimension_invalid:${dimension}`);
        }
      }
    }
  }
  return output as AgentOutput;
}

function assertSameRepUniverse(armA: AgentOutput, armB: AgentOutput): void {
  const a = armA.cases.flatMap((testCase) => testCase.reps.map((rep) => `${testCase.captureId}:${rep.repIndex}`)).sort();
  const b = armB.cases.flatMap((testCase) => testCase.reps.map((rep) => `${testCase.captureId}:${rep.repIndex}`)).sort();
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("agent_arms_rep_universe_mismatch");
}

function repPairs(armA: AgentOutput, armB: AgentOutput) {
  return armA.cases.flatMap((testCase) => testCase.reps.map((rep) => {
    const otherCase = armB.cases.find((candidate) => candidate.captureId === testCase.captureId);
    const other = otherCase?.reps.find((candidate) => candidate.repIndex === rep.repIndex);
    if (!other) throw new Error(`agent_arm_rep_missing:${testCase.captureId}:${rep.repIndex}`);
    return { captureId: testCase.captureId, a: rep, b: other };
  }));
}

function countBy(values: readonly string[]) {
  const result: Record<string, number> = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

async function main(): Promise<void> {
  const [armAPath, armBPath, outputPath, timelinePath] = process.argv.slice(2);
  if (!armAPath || !armBPath || !outputPath) {
    throw new Error("usage: qualityAgentAbCompare <arm-a.json> <arm-b.json> <output.json> [timeline-evaluation.json]");
  }
  const armA = JSON.parse(await readFile(resolve(armAPath), "utf8"));
  const armB = JSON.parse(await readFile(resolve(armBPath), "utf8"));
  const timeline = timelinePath ? JSON.parse(await readFile(resolve(timelinePath), "utf8")) : undefined;
  const result = compareQualityAgentOutputs(armA, armB, timeline);
  await writeFile(resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(`${resolve(outputPath)}\n`);
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
