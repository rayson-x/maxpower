import assert from "node:assert/strict";
import test from "node:test";

import {
  anatomicalSideForContext,
  buildReviewProposal,
  routeSourceFramesOnce,
} from "./rustFullDataProposalRunner.js";
import { actualProfileBundles } from "./rustBlindProposalRunner.js";
import { validateSourceAwareLeakage } from "./blindEvaluation.js";

test("one source frame is routed to at most one exact context window", () => {
  const routed = routeSourceFramesOnce(
    [{ timestampMs: 0 }, { timestampMs: 100 }, { timestampMs: 200 }, { timestampMs: 300 }],
    [
      { captureId: "left", startMs: 0, endMs: 199 },
      { captureId: "right", startMs: 200, endMs: 300 },
    ],
  );
  assert.deepEqual(routed.map((entry) => [entry.frame.timestampMs, entry.captureId]), [
    [0, "left"], [100, "left"], [200, "right"], [300, "right"],
  ]);
  assert.throws(
    () => routeSourceFramesOnce([{ timestampMs: 150 }], [
      { captureId: "a", startMs: 0, endMs: 200 },
      { captureId: "b", startMs: 100, endMs: 300 },
    ]),
    /overlapping exact-context windows/u,
  );
});

test("the admitted split unilateral windows preserve anatomical side", () => {
  assert.equal(anatomicalSideForContext("single_arm_cable_lateral_raise", "frontLeft45"), "left");
  assert.equal(anatomicalSideForContext("single_arm_cable_lateral_raise", "rearRight45"), "right");
  assert.equal(anatomicalSideForContext("barbell_bench_press", "front"), null);
});

test("review proposal preserves immutable Rust endpoints and eight conclusions", () => {
  const proposal = buildReviewProposal({
    captureId: "capture-a",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "source-a",
    videoRef: "chest/source-a.mp4",
    profileIdentity: "barbell_bench_press/front/bilateral/fixture/v1",
    profileHash: "0000000000000001",
    rustProposals: [{
      schemaVersion: "maxpower.motion-quality-proposal/v1",
      proposalId: "rust-proposal-1",
      repId: 1,
      actionId: "barbell_bench_press",
      capturePosition: "front",
      anatomicalSide: null,
      equipmentRole: "barbell_axis_phase_and_path",
      capability: "quality_supported",
      ruleBundleVersion: "personal-motion-quality-rules/v1",
      profileIdentity: "barbell_bench_press/front/bilateral/fixture/v1",
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
      })),
      conclusions: [
        "task_completion", "range_of_motion", "phase_control", "support_stability",
        "bilateral_coordination", "trajectory_control", "standard_variant_compatibility",
        "observation_confidence",
      ].map((dimension) => ({
        conclusionId: `rep:1:${dimension}`,
        dimension,
        state: "observed_fact",
        summary: "fact",
        evidence: [],
        reason: null,
        confidence: 0.8,
      })),
      contentHash: "0123456789abcdef",
    }],
  });
  assert.match(proposal.proposalHash, /^[a-f0-9]{64}$/u);
  assert.equal(proposal.reps.length, 1);
  assert.deepEqual(Object.keys(proposal.reps[0].endpoints), [
    "start_anchor", "primary_turnaround", "end_return",
  ]);
  assert.equal(proposal.reps[0].conclusions.length, 8);
  assert.equal(Object.isFrozen(proposal), true);
});

test("actual profile lineage excludes same-source bundles from blind inference", () => {
  const bundles = actualProfileBundles({
    schemaVersion: "profiles/v1",
    profiles: [{
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      profile: {
        identity: "barbell_bench_press/front/bilateral/fixture/v1",
        contentHash: "1",
      } as never,
      evidence: { sourceCaptureIds: ["source-a"] },
    }],
  });
  assert.equal(bundles.length, 1);
  assert.match(bundles[0].bundleHash, /^[a-f0-9]{64}$/u);
  assert.equal(bundles[0].capability, "quality_supported");
  assert.deepEqual(validateSourceAwareLeakage("source-a", [], bundles[0]), {
    valid: false,
    conflictingIds: ["source-a"],
  });
  assert.deepEqual(validateSourceAwareLeakage("source-b", [], bundles[0]), {
    valid: true,
    conflictingIds: [],
  });
});
