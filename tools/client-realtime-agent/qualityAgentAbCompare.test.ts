import assert from "node:assert/strict";
import test from "node:test";

import { compareQualityAgentOutputs } from "./qualityAgentAbCompare";

test("A/B comparison scores task candidates but keeps action quality blocked without expert gold", () => {
  const dimensions = Object.fromEntries([
    "movementTaskCompletion", "techniqueAdherence", "visibleMovementStrategy", "stimulusCompatibility",
    "effortAndDoseContext", "range", "phaseControl", "supportStability", "bilateralCoordination",
    "trajectoryControl", "observationConfidence",
  ].map((name) => [name, { status: "cannot_judge", evidenceRefs: [] }]));
  const output = (arm: string, taskClassification: string) => ({
    schemaVersion: "maxpower-quality-agent-output/v1",
    arm,
    cases: [{
      captureId: "capture", preset: {}, setSummary: {},
      reps: [{ repIndex: 1, taskClassification, dimensions, visibleFacts: [], coachInferences: [], primaryCue: null, cannotJudgeReasons: [] }],
    }],
    limitations: [],
    noAggregateScore: true,
  });
  const result = compareQualityAgentOutputs(
    output("multimodal_endpoint_frames", "valid_rep"),
    output("text_llm_rust_trajectory", "cannot_judge"),
    { rows: [{ captureId: "capture", reviewableEvaluation: { predictedSegments: [{}], matches: [{ predictedIndex: 0 }] } }] },
  );
  const multimodalTruth = result.arms.multimodalEndpointFrames.taskTruth;
  const trajectoryTruth = result.arms.textLlmRustTrajectory.taskTruth;
  assert.ok(multimodalTruth);
  assert.ok(trajectoryTruth);
  assert.equal(multimodalTruth.validRepRecall, 1);
  assert.equal(trajectoryTruth.cannotJudgeCount, 1);
  assert.equal(result.accuracyBoundary.actionQuality, "blocked_no_expert_quality_gold");
  assert.equal(result.claimBoundaryAudit.multimodalEndpointFrames.stillImageContinuousPhaseClaims, 0);
  assert.equal(result.noAggregateWinnerScore, true);
});
