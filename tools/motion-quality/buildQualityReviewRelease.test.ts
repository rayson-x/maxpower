import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  assembleQualityReviewRelease as assembleQualityReviewReleaseImpl,
  computeRustQualityProposalContentHash,
} from "./buildQualityReviewRelease.js";
import { buildReviewProposal } from "./rustFullDataProposalRunner.js";

type ReviewReleaseInput = Parameters<typeof assembleQualityReviewReleaseImpl>[0];

function withFrozenFullDataRun(input: ReviewReleaseInput): ReviewReleaseInput {
  const provided = input.fullDataRun as unknown as Record<string, unknown>;
  const sources = (provided.sources as Array<Record<string, unknown>>).map((source) => ({
    sourceVideoSha256: sha256("fixture-video"),
    ...source,
  }));
  const semantic = {
    schemaVersion: "maxpower-motion-quality-rust-full-data-proposals/v1" as const,
    frozen: true as const,
    acceptanceEligible: false as const,
    runtime: {
      visualInferenceRuntime: "offline_python_onnx_reference_only" as const,
      pythonVisionUsed: true as const,
      clientVisualAcceptanceEligible: false as const,
    },
    limitations: [] as string[],
    reproducibility: {},
    ...provided,
    sources,
  };
  delete (semantic as Record<string, unknown>).frozenDigest;
  return {
    ...input,
    fullDataRun: {
      ...semantic,
      frozenDigest: sha256(stableStringify(semantic)),
    },
  } as unknown as ReviewReleaseInput;
}

function assembleQualityReviewRelease(input: unknown): ReturnType<typeof assembleQualityReviewReleaseImpl> {
  return assembleQualityReviewReleaseImpl(withFrozenFullDataRun(input as ReviewReleaseInput));
}

test("review release keeps human start/end separate from immutable Rust proposal", () => {
  const rustProposal = rustQualityProposalFixture("phase_supported");
  const reviewProposal = buildReviewProposal({
    captureId: "context-a",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "source-a",
    videoRef: "chest/source-a.mp4",
    profileIdentity: rustProposal.profileIdentity,
    profileHash: rustProposal.profileHash,
    capability: "phase_supported",
    rustProposals: [rustProposal],
  });
  const evidence = {
    schemaVersion: "maxpower-current-rust-context-evidence/v1" as const,
    packetSchema: "MOTN/1.8+QLT1",
    producer: "current_rust_single_pass" as const,
    frames: [{
      timestampMs: 1_000,
      landmarks: [],
      inputPose: {
        source: "rtmpose_halpe26_input" as const,
        landmarks: [{ x: 0.4, y: 0.5, visibility: 0.9 }],
      },
      inputEquipmentAxes: [{
        kind: "barbell_shaft",
        source: "geometry_input",
        confidence: 0.9,
        x1: 0.1,
        y1: 0.38,
        x2: 0.9,
        y2: 0.42,
      }],
      equipment: [{ centerX: 0.5, centerY: 0.4, source: "geometry" }],
    }],
  };
  const release = assembleQualityReviewRelease({
    releaseId: "release-a",
    frozenAt: "2026-08-13T10:30:00.000Z",
    fullDataRun: {
      runId: "full-a",
      runKind: "full_data_proposal",
      frozenDigest: "a".repeat(64),
      sources: [{
        sourceCaptureId: "source-a",
        videoRef: "chest/source-a.mp4",
        contexts: [{
          captureId: "context-a",
          actionId: "barbell_bench_press",
          capturePosition: "front",
          capability: "phase_supported",
          qualityProposals: [rustProposal],
          reviewProposal,
          currentRustEvidence: {
            ...evidence,
            evidenceHash: sha256(stableStringify(evidence)),
          },
        }],
      }],
    },
    frozenEvaluationRun: frozenEvaluationRun(),
    records: [{
      captureId: "context-a",
      sourceCaptureId: "source-a",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      expectedCount: 1,
      evaluationWindow: { startMs: 0, endMs: 2_000 },
      segments: [{ startMs: 500, peakMs: 1_000, endMs: 1_500 }],
      source: { video: "chest/source-a.mp4", durationMs: 2_000 },
    }],
  });
  assert.equal(release.schemaVersion, "maxpower-motion-quality-review-release/v1");
  assert.match(release.releaseHash, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(release.items[0].humanSegments, [{ startMs: 500, endMs: 1_500 }]);
  assert.equal("peakMs" in release.items[0].humanSegments[0], false);
  assert.equal(release.items[0].proposal.proposalHash, reviewProposal.proposalHash);
  assert.equal(
    release.items[0].proposal.lineage.visualInput,
    "offline_python_onnx_reference_observations",
  );
  assert.equal(
    release.visualObservationProvenance.visualInferenceRuntime,
    "offline_python_onnx_reference_only",
  );
  assert.equal(release.visualObservationProvenance.clientVisualAcceptanceEligible, false);
  assert.equal(release.items[0].videoSha256, sha256("fixture-video"));
  assert.equal(release.items[0].evidence.source, "current_rust_single_pass");
  assert.equal(release.items[0].evidence.equipmentTrajectories[0].points[0].y, 0.4);
  assert.equal(release.items[0].evidence.frames[0].inputPose?.landmarks.length, 1);
  assert.equal(release.items[0].evidence.frames[0].inputEquipmentAxes?.[0]?.y2, 0.42);
  const reviewEvidence = release.items[0].evidence as typeof release.items[0]["evidence"] & {
    lineage?: Readonly<{ sourceEvidenceHash: string }>;
  };
  assert.equal(
    reviewEvidence.lineage?.sourceEvidenceHash,
    sha256(stableStringify(evidence)),
  );
  const { evidenceHash: reviewEvidenceHash, ...reviewEvidenceSemantic } = reviewEvidence;
  assert.notEqual(reviewEvidenceHash, reviewEvidence.lineage?.sourceEvidenceHash);
  assert.equal(reviewEvidenceHash, sha256(stableStringify(reviewEvidenceSemantic)));
  const tamperedEvidence = JSON.parse(JSON.stringify(reviewEvidenceSemantic)) as {
    frames: Array<{ timestampMs: number }>;
  };
  tamperedEvidence.frames[0].timestampMs += 1;
  assert.notEqual(reviewEvidenceHash, sha256(stableStringify(tamperedEvidence)));
  assert.deepEqual(
    release.evidenceRuns.benchmark.frozenPredictions,
    frozenEvaluationRun(),
  );
  assert.equal(release.evidenceRuns.benchmark.acceptanceEligible, false);
  assert.equal(release.evidenceRuns.benchmark.truthStatus, "withheld_from_inference");
  assert.equal(release.evidenceRuns.calibration.runKind, "full_data_proposal");
  assert.equal(release.items[0].evidenceLinks.benchmarkContextId, "context-a");
  assert.equal(Object.isFrozen(release), true);
});

test("review release rejects a changed full-data run with a stale frozen digest", () => {
  const rustProposal = rustQualityProposalFixture("phase_supported");
  const reviewProposal = buildReviewProposal({
    captureId: "context-stale-full-digest",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "source-stale-full-digest",
    videoRef: null,
    profileIdentity: rustProposal.profileIdentity,
    profileHash: rustProposal.profileHash,
    capability: "phase_supported",
    rustProposals: [rustProposal],
  });
  const valid = withFrozenFullDataRun(proposalIntegrityReleaseInput(
    rustProposal,
    reviewProposal,
    "stale-full-digest",
  ));
  const tampered = {
    ...valid,
    fullDataRun: { ...valid.fullDataRun, runId: "changed-after-freeze" },
  };
  assert.throws(
    () => assembleQualityReviewReleaseImpl(tampered),
    /full-data frozen digest mismatch/u,
  );
});

test("review release rejects a digest-valid full-data run that omits human contexts", () => {
  const rustProposal = rustQualityProposalFixture("phase_supported");
  const reviewProposal = buildReviewProposal({
    captureId: "context-truncated-run",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "source-truncated-run",
    videoRef: null,
    profileIdentity: rustProposal.profileIdentity,
    profileHash: rustProposal.profileHash,
    capability: "phase_supported",
    rustProposals: [rustProposal],
  });
  const valid = withFrozenFullDataRun(proposalIntegrityReleaseInput(
    rustProposal,
    reviewProposal,
    "truncated-run",
  ));
  const { frozenDigest: _digest, ...fullSemantic } = valid.fullDataRun;
  const truncatedSemantic = { ...fullSemantic, sources: [] };
  const truncated = {
    ...valid,
    fullDataRun: {
      ...truncatedSemantic,
      frozenDigest: sha256(stableStringify(truncatedSemantic)),
    },
  };
  assert.throws(
    () => assembleQualityReviewReleaseImpl(truncated),
    /do not exactly cover/u,
  );
});

test("review release rejects a context capability outside the public contract", () => {
  const evidence = {
    schemaVersion: "maxpower-current-rust-context-evidence/v1" as const,
    packetSchema: "MOTN/1.8+QLT1",
    producer: "current_rust_single_pass" as const,
    frames: [],
  };
  const input = {
    releaseId: "release-invalid-capability",
    frozenAt: "2026-08-13T10:30:00.000Z",
    fullDataRun: {
      runId: "full-invalid-capability",
      runKind: "full_data_proposal",
      frozenDigest: "a".repeat(64),
      sources: [{
        sourceCaptureId: "source-invalid-capability",
        videoRef: null,
        contexts: [{
          captureId: "context-invalid-capability",
          actionId: "barbell_bench_press",
          capturePosition: "front",
          capability: "profile_defined",
          qualityProposals: [],
          reviewProposal: {
            schemaVersion: "maxpower.motion-quality-proposal/v1",
            proposalHash: "b".repeat(64),
            lineage: { runKind: "full_data_proposal" },
            reps: [],
          },
          currentRustEvidence: {
            ...evidence,
            evidenceHash: sha256(stableStringify(evidence)),
          },
        }],
      }],
    },
    frozenEvaluationRun: frozenEvaluationRun(),
    records: [{
      captureId: "context-invalid-capability",
      sourceCaptureId: "source-invalid-capability",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      source: { durationMs: 2_000 },
    }],
  } as unknown as Parameters<typeof assembleQualityReviewRelease>[0];

  assert.throws(
    () => assembleQualityReviewRelease(input),
    /context-invalid-capability: invalid review capability/u,
  );
});

test("review release rejects a Rust proposal changed after its review projection was sealed", () => {
  const originalProposal = rustQualityProposalFixture("phase_supported");
  const reviewProposal = buildReviewProposal({
    captureId: "context-proposal-integrity",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "source-proposal-integrity",
    videoRef: null,
    profileIdentity: originalProposal.profileIdentity,
    profileHash: originalProposal.profileHash,
    capability: "phase_supported",
    rustProposals: [originalProposal],
  });
  const changedProposalWithoutHash = {
    ...originalProposal,
    capability: "quality_supported" as const,
    contentHash: "",
  };
  const changedProposal = {
    ...changedProposalWithoutHash,
    contentHash: computeRustQualityProposalContentHash(changedProposalWithoutHash),
  };
  const evidence = {
    schemaVersion: "maxpower-current-rust-context-evidence/v1" as const,
    packetSchema: "MOTN/1.8+QLT1",
    producer: "current_rust_single_pass" as const,
    frames: [],
  };

  assert.throws(() => assembleQualityReviewRelease({
    releaseId: "release-proposal-integrity",
    frozenAt: "2026-08-13T10:30:00.000Z",
    fullDataRun: {
      runId: "full-proposal-integrity",
      runKind: "full_data_proposal",
      frozenDigest: "a".repeat(64),
      sources: [{
        sourceCaptureId: "source-proposal-integrity",
        videoRef: null,
        contexts: [{
          captureId: "context-proposal-integrity",
          actionId: "barbell_bench_press",
          capturePosition: "front",
          capability: "phase_supported",
          qualityProposals: [changedProposal],
          reviewProposal,
          currentRustEvidence: {
            ...evidence,
            evidenceHash: sha256(stableStringify(evidence)),
          },
        }],
      }],
    },
    frozenEvaluationRun: frozenEvaluationRun(),
    records: [{
      captureId: "context-proposal-integrity",
      sourceCaptureId: "source-proposal-integrity",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      source: { durationMs: 2_000 },
    }],
  }), /context-proposal-integrity: Rust proposal content mismatch/u);
});

test("Rust proposal content hash matches the serde-order FNV-1a contract", () => {
  const proposal = rustQualityProposalFixture("phase_supported");

  assert.equal(proposal.contentHash, "06abc55235eb0f7b");
  assert.equal(computeRustQualityProposalContentHash(proposal), proposal.contentHash);
});

test("review release rejects a format-valid but incorrect Rust content hash", () => {
  const originalProposal = rustQualityProposalFixture("phase_supported");
  const wrongHashProposal = {
    ...originalProposal,
    contentHash: "0123456789abcdef",
  };
  const reviewProposal = buildReviewProposal({
    captureId: "context-wrong-rust-hash",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "source-wrong-rust-hash",
    videoRef: null,
    profileIdentity: wrongHashProposal.profileIdentity,
    profileHash: wrongHashProposal.profileHash,
    capability: "phase_supported",
    rustProposals: [wrongHashProposal],
  });

  assert.throws(
    () => assembleQualityReviewRelease(proposalIntegrityReleaseInput(
      wrongHashProposal,
      reviewProposal,
      "wrong-rust-hash",
    )),
    /context-wrong-rust-hash: Rust proposal content hash mismatch/u,
  );
});

function rustQualityProposalFixture(
  capability: "quality_supported" | "phase_supported" | "observation_only" | "unsupported",
) {
  const proposal = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposalId: "rust-proposal-fixture",
    repId: 1,
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    equipmentRole: "barbell_axis_phase_and_path",
    capability,
    ruleBundleVersion: "personal-motion-quality-rules/v1",
    profileIdentity: "barbell_bench_press/front/bilateral/barbell/fixture-v1",
    profileHash: "0000000000000001",
    canonicalSliceHash: "0000000000000002",
    endpoints: ["start_anchor", "primary_turnaround", "end_return"].map((kind, index) => ({
      kind,
      occurredFrameId: index + 1,
      occurredTimestampMs: 100 + index * 100,
      causalConfirmedTimestampMs: 300,
      phaseBefore: "ready",
      phaseAfter: "eccentric",
      confidence: 0.8,
      evidenceChannels: ["pose_measured"],
      normalizedFeatures: {
        schemaVersion: "maxpower-local-motion-coordinate/v1",
        coordinateFrameId: 1,
        sourceTimestampMs: 100 + index * 100,
        state: "uninitialized",
        reason: "no_measured_bar_axis",
        primaryAxis: null,
        crossAxis: null,
        origin: null,
        scale: null,
        scaleSource: null,
        equipmentTrackId: null,
        rawBarAxis: null,
        coarseView: "front",
        canonicalFeedMirrored: null,
        endpointOrderMapping: "screen_ordered_anatomy_unknown",
        anatomicalSideMapping: "unknown",
        equipment: null,
        pose: null,
        channelAgreement: "cannot_judge",
        endpointOneProgress: null,
        endpointTwoProgress: null,
        anatomicalLeftEndpointProgress: null,
        anatomicalRightEndpointProgress: null,
        rawBarAngleRadians: null,
        baselineCorrectedBarAngleRadians: null,
        confidence: 0,
      },
    })),
    conclusions: [
      "task_completion", "range_of_motion", "phase_control", "support_stability",
      "bilateral_coordination", "trajectory_control", "standard_variant_compatibility",
      "observation_confidence",
    ].map((dimension) => ({
      conclusionId: `rep:1:${dimension}`,
      dimension,
      state: "observed_acceptable",
      summary: "fact",
      evidence: [],
      reason: null,
      confidence: 0.8,
    })),
    contentHash: "",
  };
  return {
    ...proposal,
    contentHash: computeRustQualityProposalContentHash(proposal),
  };
}

function proposalIntegrityReleaseInput(
  proposal: Readonly<Record<string, unknown>>,
  reviewProposal: ReturnType<typeof buildReviewProposal>,
  suffix: string,
): ReviewReleaseInput {
  const contextId = `context-${suffix}`;
  const sourceId = `source-${suffix}`;
  const evidence = {
    schemaVersion: "maxpower-current-rust-context-evidence/v1" as const,
    packetSchema: "MOTN/1.8+QLT1",
    producer: "current_rust_single_pass" as const,
    frames: [],
  };
  return {
    releaseId: `release-${suffix}`,
    frozenAt: "2026-08-13T10:30:00.000Z",
    fullDataRun: {
      schemaVersion: "maxpower-motion-quality-rust-full-data-proposals/v1",
      runId: `full-${suffix}`,
      runKind: "full_data_proposal",
      frozen: true,
      acceptanceEligible: false,
      frozenDigest: "a".repeat(64),
      runtime: {
        visualInferenceRuntime: "offline_python_onnx_reference_only",
        pythonVisionUsed: true,
        clientVisualAcceptanceEligible: false,
      },
      limitations: [],
      reproducibility: {},
      sources: [{
        sourceCaptureId: sourceId,
        sourceVideoSha256: sha256("fixture-video"),
        videoRef: null,
        contexts: [{
          captureId: contextId,
          actionId: "barbell_bench_press",
          capturePosition: "front",
          capability: "phase_supported",
          qualityProposals: [proposal],
          reviewProposal,
          currentRustEvidence: {
            ...evidence,
            evidenceHash: sha256(stableStringify(evidence)),
          },
        }],
      }],
    },
    frozenEvaluationRun: frozenEvaluationRun(),
    records: [{
      captureId: contextId,
      sourceCaptureId: sourceId,
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      source: { durationMs: 2_000 },
    }],
  };
}

function frozenEvaluationRun() {
  const semantic = {
    schemaVersion: "maxpower-motion-quality-touched-benchmark-predictions/v1" as const,
    state: "frozen_before_truth" as const,
    runId: "benchmark-a",
    runKind: "touched_benchmark",
    planDigest: "c".repeat(64),
    contexts: [{
      runKind: "touched_benchmark",
      sourceCaptureId: "source-a",
      contextId: "context-a",
      processing: {
        chronologicalMonotonic: true as const,
        singlePass: true as const,
        sourceTimestampsMs: [0, 1_000, 2_000],
      },
      packetHash: "d".repeat(64),
      proposalHash: "e".repeat(64),
      versions: {
        visualModel: "rtmpose-halpe26",
        rustEngine: "motion-sdk",
        packetSchema: "MOTN/1.8+QLT1",
        profileBundle: "bench-v1",
        rulePack: "quality-v1",
      },
      reps: [{
        repId: "rep-1",
        startTimestampMs: 500,
        turnaroundTimestampMs: 1_000,
        endTimestampMs: 1_500,
        disposition: "confirmed",
      }],
      qualityConclusions: [],
      actionId: "barbell_bench_press",
      capturePosition: "front",
      capability: "quality_supported",
      bundleHash: "f".repeat(64),
    }],
  };
  return {
    ...semantic,
    frozenDigest: sha256(stableStringify(semantic)),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
