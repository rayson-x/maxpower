import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  anatomicalSideForContext,
  buildReviewProposal,
  materializeAssessmentProfile,
  routeSourceFramesOnce,
} from "./rustFullDataProposalRunner.js";
import { actualProfileBundles, runFrozenBlindPlan } from "./rustBlindProposalRunner.js";
import { validateSourceAwareLeakage } from "./blindEvaluation.js";
import {
  loadInputCatalog,
  loadSourceIndependentBenchProfiles,
  measuredAxisToEquipmentObservation,
  rawObservationDerivativeId,
  submitRawFrameToRust,
} from "./runnerInputs.js";

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
      evidence: { sourceCaptureIds: ["source-a::left-window"] },
    }],
  });
  assert.equal(bundles.length, 1);
  assert.match(bundles[0].bundleHash, /^[a-f0-9]{64}$/u);
  assert.equal(bundles[0].capability, "quality_supported");
  assert.deepEqual(bundles[0].fittedSourceIds, ["source-a"]);
  assert.deepEqual(bundles[0].fittedDerivativeSourceIds, [rawObservationDerivativeId("source-a")]);
  assert.deepEqual(validateSourceAwareLeakage(
    "source-a",
    [rawObservationDerivativeId("source-a")],
    bundles[0],
  ), {
    valid: false,
    conflictingIds: ["personal-native-rtmpose-halpe26-observations/source-a", "source-a"],
  });
  assert.deepEqual(validateSourceAwareLeakage("source-b", [], bundles[0]), {
    valid: true,
    conflictingIds: [],
  });
});

test("measured axis becomes a geometry barbell observation submitted with raw candidates", () => {
  const equipment = measuredAxisToEquipmentObservation({
    source: "measured",
    confidence: 0.92,
    x1: 0.2,
    y1: 0.4,
    x2: 0.8,
    y2: 0.41,
    centerY: 0.405,
  }, 7);
  assert.equal(equipment.length, 1);
  assert.equal(equipment[0].kind, "barbell_shaft");
  assert.equal(equipment[0].source, "geometry");
  assert.ok(Math.abs(equipment[0].bbox.width - 0.6) < 1e-12);

  const calls: unknown[][] = [];
  const frame = {
    frameNumber: 3,
    timestampMs: 100.4,
    selectedBbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    landmarks: Array.from({ length: 26 }, () => ({
      x: 0.5, y: 0.5, z: null, visibility: 0.9,
    })),
  };
  submitRawFrameToRust({
    processCandidates(candidates, timestampMs, submittedEquipment) {
      calls.push([candidates, timestampMs, submittedEquipment]);
    },
  }, frame, equipment);
  assert.equal(calls.length, 1);
  assert.equal((calls[0][0] as unknown[]).length, 1);
  assert.equal(calls[0][1], 100);
  assert.equal(calls[0][2], equipment);
});

test("source-independent bench identity keeps barbell in the equipment segment", async () => {
  const catalog = await loadInputCatalog("tools/motion-quality/data-governance-inputs.json");
  const loaded = await loadSourceIndependentBenchProfiles(
    "tools/motion-quality/source-independent-bench-profiles.json",
    catalog.value,
  );
  assert.equal(loaded.value.length, 3);
  for (const entry of loaded.value) {
    assert.deepEqual(entry.profile.identity.split("/"), [
      "barbell_bench_press",
      entry.capturePosition,
      "bilateral",
      "barbell",
      "builtin-source-independent-provisional-v1",
    ]);
  }
  const bundles = actualProfileBundles({ schemaVersion: "profiles/v1", profiles: [] }, loaded.value);
  assert.equal(bundles.length, 3);
  assert.ok(bundles.every((bundle) => bundle.fittedSourceIds.length === 0));

  const bench = loaded.value[0].profile;
  const adaptedMachine = materializeAssessmentProfile({
    ...bench,
    identity: "machine_chest_press/front/bilateral/observed-tuned/v2-halpe26/cycle-aligned-client-candidate-v1",
  }, null);
  assert.deepEqual(adaptedMachine.identity.split("/").slice(0, 4), [
    "machine_chest_press", "front", "bilateral", "chest_press_machine",
  ]);
  assert.match(adaptedMachine.identity, /legacy-profile-adapter-v1-[a-f0-9]{16}$/u);
  assert.notEqual(adaptedMachine.contentHash, bench.contentHash);

  const adaptedUnilateral = materializeAssessmentProfile({
    ...bench,
    identity: "single_arm_cable_lateral_raise/frontLeft45/bilateral/observed-tuned/v2",
  }, "left");
  assert.equal(
    adaptedUnilateral.identity.split("/").slice(0, 4).join("/"),
    "single_arm_cable_lateral_raise/frontLeft45/left/cable_handle",
  );
});

test("unsupported context still runs current Rust WASM over every raw frame without a profile", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maxpower-motion-quality-"));
  const planPath = join(directory, "plan.json");
  const outputPath = join(directory, "prediction.json");
  const sourceCaptureId = "1ffdb9483b96090c6caf40a2ca3e6c46";
  await writeFile(planPath, JSON.stringify({
    schemaVersion: "maxpower-motion-quality-truth-free-plan/v1",
    runId: "unsupported-real-wasm-test",
    runKind: "blind_evaluation",
    seed: "test",
    planDigest: "a".repeat(64),
    sources: [{
      sourceCaptureId,
      videoRef: null,
      contexts: [{
        contextId: "unsupported-context",
        actionId: "machine_chest_press",
        capturePosition: "front",
        capability: "unsupported",
        bundle: null,
        selection: "no_legal_bundle",
        inputWindow: { fromTimestampMs: 0, untilTimestampMs: 500 },
      }],
    }],
  }));
  const frozen = await runFrozenBlindPlan({
    planPath,
    rawObservationRoot: "data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
    benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
    profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
    sourceIndependentBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
    governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
    wasmPath: "public/motion-sdk/maxpower_motion_sdk.wasm",
    outputPath,
  });
  const context = frozen.contexts[0];
  assert.equal(context.capability, "unsupported");
  assert.equal(context.versions.profileBundle, "none");
  assert.doesNotMatch(context.versions.rustEngine, /not_run/u);
  assert.match(context.versions.rustEngine, /rust-canonical/u);
  assert.deepEqual(context.reps, []);
  assert.equal(context.processing.sourceTimestampsMs.length, 6);
});
