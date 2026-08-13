import assert from "node:assert/strict";
import test from "node:test";

import { LocalCoachProvider, type LLMProviderRequest } from "../../src/coach/adapters/provider";
import { buildClientExecutionAssessment } from "./clientExecutionReport";

test("client report preserves five layers without inventing a form score", () => {
  const frames = [1_000, 1_200, 1_400, 1_600, 1_800].map((timestampMs, frameIndex) => ({
    timestampMs,
    frameValid: true,
    canonicalQuality: 0.82,
    rustCanonical: [
      point(5, 0.40, 0.30 + frameIndex * 0.001), point(6, 0.60, 0.30),
      point(9, 0.30 - frameIndex * 0.01, 0.45), point(10, 0.70 + frameIndex * 0.01, 0.45),
      point(11, 0.44, 0.62), point(12, 0.56, 0.62),
    ],
    rustJointAngles: [
      angle("elbow", "left", 91 + frameIndex), angle("elbow", "right", 94 + frameIndex),
      angle("shoulder", "left", 70 + frameIndex), angle("shoulder", "right", 74 + frameIndex),
    ],
  }));
  const report = buildClientExecutionAssessment({
    captureId: "capture-1",
    preset: { exerciseId: "lateral_raise", capturePosition: "front" },
    profileIdentity: "profile-1",
    runtime: {
      processedFrames: frames.length,
      effectiveObservationFps: 10,
      emptyCandidateFrames: 0,
      maximumInferenceMs: 80,
    },
    reps: [{
      repId: "1",
      startMs: "1000",
      peakMs: "1400",
      endMs: "1800",
      disposition: "confirmed",
      evidenceReason: null,
      observationFindings: [],
    }],
    frames,
  });

  assert.equal(report.noAggregateStandardnessScore, true);
  assert.equal(report.fiveLayers.movementTaskCompletion.confirmedRepCount, 1);
  assert.equal(report.fiveLayers.techniqueAdherence.judgementStatus, "cannot_judge");
  assert.equal(report.fiveLayers.stimulusCompatibility.judgementStatus, "cannot_judge");
  assert.equal(report.dimensions.phaseControl.semantics.startToPeak, "concentric");
  assert.equal(report.dimensions.supportStability.judgementStatus, "observed");
  assert.equal(report.dimensions.bilateralCoordination.judgementStatus, "observed");
  assert.equal(report.dimensions.trajectoryControl.judgementStatus, "observed");
  assert.equal(report.dimensions.trajectoryControl.equipmentPath.judgementStatus, "cannot_judge");
  assert.equal("totalScore" in report, false);
});

test("local Agent keeps the client preset when explaining Rust evidence", async () => {
  const assessment = buildClientExecutionAssessment({
    captureId: "capture-agent",
    preset: { exerciseId: "lat_pulldown", capturePosition: "rearLeft45" },
    profileIdentity: "profile-agent",
    runtime: {
      processedFrames: 10,
      effectiveObservationFps: 10,
      emptyCandidateFrames: 0,
      maximumInferenceMs: 70,
    },
    reps: [],
    frames: [],
  });
  const request = {
    sessionId: "session-agent",
    runId: "run-agent",
    userText: "复盘动作执行",
    context: {
      userPseudonym: "local-test",
      profile: {}, plan: {}, timeline: [], workingMemory: [], activeConstraints: [],
      nutritionStrategies: [], goalCycles: [],
      canonicalEvidence: [{
        kind: "training_execution_assessment",
        captureId: "capture-agent",
        rustOutcomes: { confirmed: 0, needsReview: 0, rejected: 0 },
        assessment,
      }],
      historicalSummaries: [], currentConversation: [], conversationSummaries: [],
    },
    contextManifest: {
      schemaVersion: 1,
      userPseudonym: "local-test",
      providerKind: "local-rule-coach",
      requestPurpose: "training_execution_review",
      assembledAt: "2026-08-12T00:00:00.000Z",
      factRefs: [], redactedPaths: [], includes: [],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [], summaryRefs: [], timeRange: {}, mediaAttachments: [],
      redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [],
  } satisfies LLMProviderRequest;

  let response = "";
  for await (const event of new LocalCoachProvider().stream(request)) {
    if (event.type === "text-delta") response += event.delta;
  }
  assert.match(response, /lat_pulldown（rearLeft45）/);
  assert.doesNotMatch(response, /undefined/);
});

test("local Agent reports every sealed rep and keeps observation risk separate from timeline status", async () => {
  const reps = Array.from({ length: 15 }, (_, index) => ({
    repId: String(index + 1),
    startMs: String(1_000 + index * 1_000),
    peakMs: String(1_400 + index * 1_000),
    endMs: String(1_800 + index * 1_000),
    disposition: "confirmed" as const,
    evidenceReason: null,
    observationFindings: [],
  }));
  const assessment = buildClientExecutionAssessment({
    captureId: "capture-long-set",
    preset: { exerciseId: "barbell_bench_press", capturePosition: "front" },
    profileIdentity: "profile-long-set",
    runtime: {
      processedFrames: 100,
      effectiveObservationFps: 10,
      emptyCandidateFrames: 10,
      maximumInferenceMs: 80,
    },
    reps,
    frames: [],
  });
  const request = {
    sessionId: "session-long-set",
    runId: "run-long-set",
    userText: "复盘动作执行",
    context: {
      userPseudonym: "local-test",
      profile: {}, plan: {}, timeline: [], workingMemory: [], activeConstraints: [],
      nutritionStrategies: [], goalCycles: [],
      canonicalEvidence: [{
        kind: "training_execution_assessment",
        captureId: "capture-long-set",
        rustOutcomes: { confirmed: 15, needsReview: 0, rejected: 0 },
        assessment,
      }],
      historicalSummaries: [], currentConversation: [], conversationSummaries: [],
    },
    contextManifest: {
      schemaVersion: 1,
      userPseudonym: "local-test",
      providerKind: "local-rule-coach",
      requestPurpose: "training_execution_review",
      assembledAt: "2026-08-13T00:00:00.000Z",
      factRefs: [], redactedPaths: [], includes: [],
      priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
      productionCompression: "none",
      retrievalFactRefs: [], summaryRefs: [], timeRange: {}, mediaAttachments: [],
      redactionPolicyVersion: "direct-identifiers-v1",
    },
    toolManifest: [],
  } satisfies LLMProviderRequest;

  let response = "";
  for await (const event of new LocalCoachProvider().stream(request)) {
    if (event.type === "text-delta") response += event.delta;
  }

  assert.match(response, /R15 confirmed/);
  assert.match(response, /骨架观测[^。]*不稳定/);
  assert.doesNotMatch(response, /时间轴证据不稳定/);
});

test("barbell bench report keeps equipment and pose evidence independent for every rep", () => {
  const ys = [0.24, 0.36, 0.52, 0.35, 0.25];
  const frames = ys.map((centerY, index) => ({
    timestampMs: 1_000 + index * 100,
    frameValid: true,
    canonicalQuality: 0.30,
    rustCanonical: [],
    rustJointAngles: [],
    rustEquipment: {
      status: { kind: "observed" as const, reason: null },
      tracks: [{
        kind: "barbell_shaft" as const,
        centerX: 0.5,
        centerY,
        bbox: { x: 0.2, y: centerY - 0.01, width: 0.6, height: 0.02 },
        observationScore: 0.88,
        associationConfidence: 0.90,
        source: "geometry" as const,
        judgeablePath: true,
      }],
    },
  }));
  const report = buildClientExecutionAssessment({
    captureId: "bench-equipment",
    preset: { exerciseId: "barbell_bench_press", capturePosition: "front" },
    profileIdentity: "bench-equipment-profile",
    runtime: {
      processedFrames: frames.length,
      effectiveObservationFps: 10,
      emptyCandidateFrames: 0,
      maximumInferenceMs: 80,
    },
    reps: [{
      repId: "1",
      startMs: "1000",
      peakMs: "1200",
      endMs: "1400",
      disposition: "confirmed",
      evidenceReason: null,
      observationFindings: ["equipment_primary_boundary", "pose_unavailable_at_turnaround"],
    }],
    frames,
  });

  const trajectory = report.reps[0].trajectoryControl;
  assert.equal(trajectory.equipmentPath.judgementStatus, "observed");
  if (trajectory.equipmentPath.judgementStatus !== "observed") {
    assert.fail("equipment trajectory should be observed");
  }
  assert.equal(trajectory.equipmentPath.observedFrameCount, 5);
  const verticalRom = trajectory.equipmentPath.verticalRomImageRatio;
  if (verticalRom === null) assert.fail("vertical ROM should be available");
  assert.ok(Math.abs(verticalRom - 0.28) < 1e-9);
  assert.equal(trajectory.equipmentPath.turnaroundOffsetMs, 0);
  assert.equal(trajectory.poseEquipmentAgreement.status, "pose_unavailable");
  assert.equal(report.dimensions.trajectoryControl.status, "equipment_and_pose_channels_reported");
});

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
