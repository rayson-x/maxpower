import assert from "node:assert/strict";
import test from "node:test";

import { LocalCoachProvider, type LLMProviderRequest } from "../../src/coach/adapters/provider";
import type {
  DecodedLocalMotionCoordinate,
  DecodedRustQualityProposal,
  MotionAssessmentDimension,
  MotionQualityConclusionState,
} from "../../src/motion/motionPacket";
import { buildClientExecutionAssessment } from "./clientExecutionReport";

test("client report projects Rust proposals and preserves all five layers and dimensions", () => {
  const report = buildClientExecutionAssessment(clientCase({
    qualityProposals: [qualityProposal()],
  }));

  assert.equal(report.noAggregateStandardnessScore, true);
  assert.equal(report.lineage.packetContract, "MOTN/1.10");
  assert.equal(report.fiveLayers.movementTaskCompletion.judgementStatus, "observed");
  assert.equal(report.fiveLayers.techniqueAdherence.judgementStatus, "cannot_judge");
  assert.equal(report.fiveLayers.visibleMovementStrategy.judgementStatus, "observed");
  assert.equal(report.fiveLayers.stimulusCompatibility.judgementStatus, "cannot_judge");
  assert.equal(report.fiveLayers.effortAndDoseContext.judgementStatus, "cannot_judge");
  assert.deepEqual(Object.keys(report.dimensions), [
    "task",
    "range",
    "phaseControl",
    "supportStability",
    "bilateralCoordination",
    "trajectoryControl",
    "stimulusCompatibility",
    "observationConfidence",
  ]);
  assert.equal(report.dimensions.range.reps[0].rustConclusion?.summary, "Rust range proposal");
  assert.equal(report.dimensions.phaseControl.semantics?.startToPeak, "eccentric");
  assert.equal(report.dimensions.phaseControl.semantics?.peakToEnd, "concentric");
  assert.equal(report.reps[0].endpoints.primaryTurnaround?.occurredTimestampMs, 1_400);
  assert.equal(
    report.reps[0].endpoints.primaryTurnaround?.normalizedFeatures?.equipment?.alongAxisProgress,
    0.84,
  );
  assert.equal(report.reps[0].trajectoryControl.equipmentPath.judgementStatus, "observed");
  assert.equal("totalScore" in report, false);
});

test("frame landmarks joint angles and screen centerY cannot create Agent quality facts", () => {
  const report = buildClientExecutionAssessment(clientCase({
    qualityProposals: [],
    frames: [1_000, 1_200, 1_400, 1_600, 1_800].map((timestampMs, frameIndex) => ({
      timestampMs,
      frameValid: true,
      canonicalQuality: 0.99,
      rustCanonical: [
        point(5, 0.40, 0.30 + frameIndex * 0.02), point(6, 0.60, 0.30),
        point(9, 0.30 - frameIndex * 0.05, 0.45), point(10, 0.70 + frameIndex * 0.05, 0.45),
        point(11, 0.44, 0.62), point(12, 0.56, 0.62),
      ],
      rustJointAngles: [
        angle("elbow", "left", 60 + frameIndex * 20),
        angle("elbow", "right", 120 - frameIndex * 10),
      ],
      rustEquipment: {
        status: { kind: "observed" as const, reason: null },
        tracks: [{
          kind: "barbell_shaft" as const,
          centerX: 0.5,
          centerY: [0.2, 0.4, 0.8, 0.4, 0.2][frameIndex],
          bbox: { x: 0.2, y: 0.2, width: 0.6, height: 0.02 },
          observationScore: 0.99,
          associationConfidence: 0.99,
          source: "geometry" as const,
          judgeablePath: true,
        }],
      },
    })),
  }));

  assert.equal(report.fiveLayers.movementTaskCompletion.judgementStatus, "cannot_judge");
  assert.equal(report.fiveLayers.visibleMovementStrategy.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.task.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.range.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.phaseControl.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.supportStability.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.bilateralCoordination.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.trajectoryControl.judgementStatus, "cannot_judge");
  assert.equal(report.reps[0].qualityProposal.judgementStatus, "cannot_judge");
  assert.equal(report.reps[0].trajectoryControl.equipmentPath.judgementStatus, "cannot_judge");
  assert.equal("verticalRomImageRatio" in report.reps[0].trajectoryControl.equipmentPath, false);
  assert.equal("jointAngleDeltas" in report.reps[0].bilateralCoordination, false);
  assert.equal("torsoTiltRangeDeg" in report.reps[0].supportStability, false);
});

test("local Agent keeps the client preset when explaining Rust evidence", async () => {
  const assessment = buildClientExecutionAssessment(clientCase({
    captureId: "capture-agent",
    preset: { exerciseId: "lat_pulldown", capturePosition: "rearLeft45" },
    reps: [],
    frames: [],
    qualityProposals: [],
  }));
  const request = agentRequest("capture-agent", assessment);

  let response = "";
  for await (const event of new LocalCoachProvider().stream(request)) {
    if (event.type === "text-delta") response += event.delta;
  }
  assert.match(response, /lat_pulldown（rearLeft45）/);
  assert.doesNotMatch(response, /undefined/);
});

test("local Agent reports every sealed rep while Rust proposals remain the only quality facts", async () => {
  const reps = Array.from({ length: 15 }, (_, index) => ({
    repId: String(index + 1),
    startMs: String(1_000 + index * 1_000),
    peakMs: String(1_400 + index * 1_000),
    endMs: String(1_800 + index * 1_000),
    disposition: "confirmed" as const,
    evidenceReason: null,
    observationFindings: [],
  }));
  const assessment = buildClientExecutionAssessment(clientCase({
    captureId: "capture-long-set",
    reps,
    frames: [],
    qualityProposals: [],
  }));
  const request = agentRequest("capture-long-set", assessment, 15);

  let response = "";
  for await (const event of new LocalCoachProvider().stream(request)) {
    if (event.type === "text-delta") response += event.delta;
  }

  assert.match(response, /R15 confirmed/);
  assert.doesNotMatch(response, /骨架步长 P90/);
  assert.doesNotMatch(response, /躯干中心最大位移/);
  assert.doesNotMatch(response, /角度差的较高分位/);
});

function clientCase(overrides: Record<string, unknown> = {}) {
  return {
    captureId: "capture-1",
    preset: { exerciseId: "barbell_bench_press", capturePosition: "front" },
    profileIdentity: "barbell_bench_press/front/bilateral/barbell/v1",
    runtime: {
      processedFrames: 5,
      effectiveObservationFps: 10,
      emptyCandidateFrames: 0,
      maximumInferenceMs: 80,
    },
    reps: [{
      repId: "1",
      startMs: "1000",
      peakMs: "1400",
      endMs: "1800",
      disposition: "confirmed" as const,
      evidenceReason: null,
      observationFindings: [],
    }],
    frames: [],
    qualityProposals: [],
    ...overrides,
  };
}

function qualityProposal(): DecodedRustQualityProposal {
  const dimensions: MotionAssessmentDimension[] = [
    "task_completion",
    "range_of_motion",
    "phase_control",
    "support_stability",
    "bilateral_coordination",
    "trajectory_control",
    "standard_variant_compatibility",
    "observation_confidence",
  ];
  const stateFor = (dimension: MotionAssessmentDimension): MotionQualityConclusionState => {
    if (dimension === "range_of_motion") return "observed_deviation";
    if (["support_stability", "bilateral_coordination", "standard_variant_compatibility"].includes(dimension)) {
      return "cannot_judge";
    }
    return "observed_acceptable";
  };
  return {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposalId: "profile:rep:1:revision:1",
    repId: 1,
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    equipmentRole: "barbell_axis_phase_and_path",
    capability: "phase_supported",
    ruleBundleVersion: "personal-motion-quality-rules/v1",
    profileIdentity: "barbell_bench_press/front/bilateral/barbell/v1",
    profileHash: "1111111111111111",
    canonicalSliceHash: "2222222222222222",
    endpoints: [
      endpoint("start_anchor", 1_000, "ready", "eccentric", 0.08),
      endpoint("primary_turnaround", 1_400, "eccentric", "concentric", 0.84),
      endpoint("end_return", 1_800, "concentric", "ready", 0.10),
    ],
    conclusions: dimensions.map((dimension) => ({
      conclusionId: `rep:1:${dimension}`,
      dimension,
      state: stateFor(dimension),
      summary: dimension === "range_of_motion" ? "Rust range proposal" : `Rust ${dimension} proposal`,
      evidence: [`rust:${dimension}`],
      reason: stateFor(dimension) === "cannot_judge" ? `rust_missing:${dimension}` : null,
      confidence: stateFor(dimension) === "cannot_judge" ? 0 : 0.88,
    })),
    contentHash: "3333333333333333",
  };
}

function endpoint(
  kind: "start_anchor" | "primary_turnaround" | "end_return",
  timestampMs: number,
  phaseBefore: string,
  phaseAfter: string,
  progress: number,
) {
  return {
    kind,
    occurredFrameId: timestampMs / 100,
    occurredTimestampMs: timestampMs,
    causalConfirmedTimestampMs: timestampMs + (kind === "primary_turnaround" ? 100 : 0),
    phaseBefore,
    phaseAfter,
    confidence: 0.88,
    evidenceChannels: ["equipment_measured" as const],
    normalizedFeatures: localCoordinate(timestampMs, progress),
  };
}

function localCoordinate(timestampMs: number, progress: number): DecodedLocalMotionCoordinate {
  return {
    schemaVersion: "maxpower-local-motion-coordinate/v1",
    coordinateFrameId: 7,
    sourceTimestampMs: timestampMs,
    state: "frozen",
    reason: null,
    primaryAxis: [0, 1],
    crossAxis: [1, 0],
    origin: [0.5, 0.3],
    scale: 0.6,
    scaleSource: "projected_bar_length",
    equipmentTrackId: 9,
    rawBarAxis: [0.2, 0.4, 0.8, 0.42],
    coarseView: "front",
    canonicalFeedMirrored: false,
    endpointOrderMapping: "screen_ordered_anatomy_unknown",
    anatomicalSideMapping: "endpoint_one_anatomical_left",
    equipment: {
      alongAxisProgress: progress,
      crossAxisDisplacement: 0.02,
      confidence: 0.9,
      coverage: 0.95,
      uncertainty: 0.03,
      provenance: "equipment_measured",
    },
    pose: null,
    channelAgreement: "equipment_only",
    endpointOneProgress: progress - 0.01,
    endpointTwoProgress: progress + 0.01,
    anatomicalLeftEndpointProgress: progress - 0.01,
    anatomicalRightEndpointProgress: progress + 0.01,
    rawBarAngleRadians: 0.03,
    baselineCorrectedBarAngleRadians: 0.01,
    confidence: 0.88,
  };
}

function agentRequest(
  captureId: string,
  assessment: ReturnType<typeof buildClientExecutionAssessment>,
  confirmed = 0,
) {
  return {
    sessionId: `session-${captureId}`,
    runId: `run-${captureId}`,
    userText: "复盘动作执行",
    context: {
      userPseudonym: "local-test",
      profile: {}, plan: {}, timeline: [], workingMemory: [], activeConstraints: [],
      nutritionStrategies: [], goalCycles: [],
      canonicalEvidence: [{
        kind: "training_execution_assessment",
        captureId,
        rustOutcomes: { confirmed, needsReview: 0, rejected: 0 },
        assessment,
      }],
      historicalSummaries: [], currentConversation: [], conversationSummaries: [],
    },
    contextManifest: {
      schemaVersion: 1,
      userPseudonym: "local-test",
      providerKind: "local-rule-coach",
      requestPurpose: "training_execution_review",
      assembledAt: "2026-08-14T00:00:00.000Z",
      factRefs: [], redactedPaths: [], includes: [],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [], summaryRefs: [], timeRange: {}, mediaAttachments: [],
      redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [],
  } satisfies LLMProviderRequest;
}

function point(index: number, x: number, y: number) {
  return { index, x, y, confidence: 0.9, source: "measured", renderable: true };
}

function angle(
  kind: "elbow" | "shoulder" | "hip" | "knee",
  side: "left" | "right",
  valueDeg: number,
) {
  return { kind, side, valueDeg, confidence: 0.9, source: "measured", judgeable: true };
}
