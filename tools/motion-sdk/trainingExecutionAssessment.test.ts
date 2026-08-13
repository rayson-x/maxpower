import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAgentConsumableAssessment,
  buildAgentTrainingExecutionAssessment,
  type TrainingExecutionAssessment,
} from "../../src/motion/trainingExecutionAssessment";

function lineage(status: "validated" | "failed" = "validated"): TrainingExecutionAssessment["lineage"] {
  return {
    observationPipeline: "yolox-nano-humanart+rtmpose-m-halpe26",
    poseSchema: "halpe26",
    canonicalOwner: "rust-motion-sdk",
    packetContract: "MOTN/1.7",
    runtimeValidation: {
      status,
      platform: "web",
      runtime: "wasm",
      reportSha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
    trajectoryDatabase: {
      databaseId: "maxpower-native-halpe26-trajectories-v2",
      status: "research_candidate_not_promoted",
      manifestSha256: "a5b479526284cb8e81b4ed989906748b980a708477f72fbcecca61c2c122cdcf",
    },
  };
}

function fixture(): TrainingExecutionAssessment {
  return {
    schemaVersion: "maxpower-training-execution-assessment/v1",
    sequenceId: "fixture",
    lineage: lineage(),
    intent: {
      goal: "technique",
      exerciseVariant: "strict_barbell_row",
      equipmentAndResistanceMode: "barbell",
      targetMuscles: ["latissimus_dorsi"],
      expectedJointActions: ["shoulder_extension", "elbow_flexion"],
      plannedRom: "protocol",
      allowedStrategyEnvelope: ["reviewed_strict_torso_envelope"],
    },
    evidence: [
      { id: "torso", level: "E1", feature: "torso_drift", source: "rust_canonical", confidence: 0.9 },
      { id: "path", level: "E4", feature: "bar_path_shift", source: "equipment_observation", confidence: 0.8 },
    ],
    observation: { status: "sufficient", reasons: [] },
    movementTask: { status: "meets_target", judgementStatus: "observed", confidence: 0.9, evidenceRefs: ["torso"], details: {} },
    techniqueAdherence: { status: "deviates", judgementStatus: "inferred", confidence: 0.82, evidenceRefs: ["torso", "path"], details: {} },
    movementStrategy: [{ id: "strategy", observation: "躯干与器械路径同步偏移", phase: "to_extreme", evidenceRefs: ["torso", "path"] }],
    stimulusCompatibility: { status: "possible_strategy_shift", judgementStatus: "inferred", explanation: "动作策略可能偏离严格划船意图", evidenceRefs: ["torso", "path"], claimLevel: "coach_inference" },
    coachConclusion: { standardExecution: "completed_with_strategy_shift", likelyTrainingEffect: ["可能增加辅助身体段参与"], inferenceBasis: ["torso", "path"] },
    coachInferences: [{ label: "momentum_assistance", probability: 0.8, evidenceRefs: ["torso", "path"], independentFeatureGroups: ["torso", "equipment_path"], alternativeExplanations: ["selected_variant_mismatch"], claimLevel: "coach_inference" }],
    effortAndDose: { status: "unknown" },
    measurementLimits: ["muscle_activation_not_measured"],
  };
}

test("agent assessment accepts a multi-feature bounded coaching inference", () => {
  assert.doesNotThrow(() => assertAgentConsumableAssessment(fixture()));
});

test("agent assessment rejects a one-feature compensation inference", () => {
  const assessment = fixture();
  assessment.coachInferences = [{ ...assessment.coachInferences[0], evidenceRefs: ["torso"], independentFeatureGroups: ["torso"] }];
  assert.throws(() => assertAgentConsumableAssessment(assessment), /two independent feature groups/);
});

test("agent assessment rejects pseudo-precise muscle activation claims", () => {
  const assessment = fixture();
  assessment.coachConclusion.likelyTrainingEffect = ["背阔肌激活 72%"];
  assert.throws(() => assertAgentConsumableAssessment(assessment), /Unsupported physiology claim/);
});

test("task completion never becomes standard-form without reviewed technique evidence", () => {
  const assessment = buildAgentTrainingExecutionAssessment({
    sequenceId: "live:set-1",
    lineage: lineage(),
    intent: fixture().intent,
    evidence: [
      { id: "rep", level: "E1", feature: "confirmed_rep_cycle", source: "rust_canonical", confidence: 0.96 },
    ],
    observation: { status: "sufficient", reasons: [] },
    movementTask: { completed: true, confidence: 0.96, evidenceRefs: ["rep"] },
    technique: { referenceStatus: "unavailable", confidence: 0, evidenceRefs: [] },
    measurementLimits: ["no_reviewed_technique_reference"],
  });

  assert.equal(assessment.movementTask.status, "meets_target");
  assert.equal(assessment.techniqueAdherence.status, "cannot_judge");
  assert.equal(assessment.coachConclusion.standardExecution, "cannot_judge");
});

test("two independent observable groups can support a bounded strategy-shift cue", () => {
  const assessment = buildAgentTrainingExecutionAssessment({
    sequenceId: "live:set-2",
    lineage: lineage(),
    intent: fixture().intent,
    evidence: fixture().evidence,
    observation: { status: "sufficient", reasons: [] },
    movementTask: { completed: true, confidence: 0.9, evidenceRefs: ["torso"] },
    technique: { referenceStatus: "unavailable", confidence: 0, evidenceRefs: [] },
    movementStrategies: [{
      id: "momentum_assistance",
      observation: "躯干与器械路径同步偏移",
      phase: "to_extreme",
      evidenceRefs: ["torso", "path"],
      independentFeatureGroups: ["torso", "equipment_path"],
      probability: 0.8,
      alternativeExplanations: ["selected_variant_mismatch"],
      primaryCue: "先降低负荷，保持躯干位置，再完成目标关节运动。",
    }],
  });

  assert.equal(assessment.coachConclusion.standardExecution, "completed_with_strategy_shift");
  assert.equal(assessment.coachInferences.length, 1);
  assert.match(assessment.coachConclusion.primaryCue ?? "", /降低负荷/);
});

test("a failed current runtime validation propagates cannot_judge despite rep evidence", () => {
  const assessment = buildAgentTrainingExecutionAssessment({
    sequenceId: "live:failed-runtime",
    lineage: lineage("failed"),
    intent: fixture().intent,
    evidence: [
      { id: "rep", level: "E1", feature: "confirmed_rep_cycle", source: "rust_canonical", confidence: 0.99 },
    ],
    observation: { status: "sufficient", reasons: [] },
    movementTask: { completed: true, confidence: 0.99, evidenceRefs: ["rep"] },
  });

  assert.equal(assessment.observation.status, "insufficient");
  assert.match(assessment.observation.reasons.join(" "), /runtime_validation_failed/);
  assert.equal(assessment.movementTask.status, "cannot_judge");
  assert.equal(assessment.coachConclusion.standardExecution, "cannot_judge");
});
