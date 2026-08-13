import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  anatomicalSideForContext,
  applyBenchPolicyToFrame,
  buildReviewProposal,
  loadFrozenBenchAblationPolicyReport,
  materializeAssessmentProfile,
  releaseQualityProposalsForPolicy,
  reviewCapabilityForContext,
  resolveAppliedBenchPolicy,
  routeSourceFramesOnce,
} from "./rustFullDataProposalRunner.js";
import {
  actualProfileBundles,
  loadTouchedBenchmarkBenchProfiles,
  runFrozenTouchedBenchmarkPlan,
  sealTouchedBenchmarkPlan,
  TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
  writeTouchedBenchmarkPlan,
} from "./rustBlindProposalRunner.js";
import { validateSourceAwareLeakage } from "./blindEvaluation.js";
import {
  loadInputCatalog,
  measuredAxisToEquipmentObservation,
  pinInputBytes,
  rawObservationDerivativeId,
  submitRawFrameToRust,
} from "./runnerInputs.js";

test("motion-quality roles resolve through the authoritative governance catalog", async () => {
  const loaded = await loadInputCatalog("tools/motion-quality/data-governance-inputs.json");
  assert.equal(loaded.value.schemaVersion, "maxpower-motion-quality-input-catalog/v2");
  assert.equal(loaded.value.authorityCatalog.catalogId, "maxpower-motion-training-data-v1");
  assert.equal(loaded.pin.assetId, "motion-quality-runner-input-catalog");
  assert.equal(loaded.pin.admission, "protected");
  assert.match(loaded.pin.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(loaded.pin.catalogSha256, loaded.pin.sha256);

  const expectedAdmissions = {
    humanRanges: "label_allowed",
    rawHalpe26: "feature_only",
    benchBarbellAxis: "proposal_only",
    profileArtifact: "evaluation_only",
    blindPlan: "evaluation_only",
    rustWasm: "protected",
    sourceIndependentBenchProfile: "evaluation_only",
    fullDataRun: "evaluation_only",
  } as const;
  for (const [role, admission] of Object.entries(expectedAdmissions)) {
    const binding = loaded.value.assets[role as keyof typeof expectedAdmissions];
    assert.equal(binding.admission, admission);
    assert.ok(binding.authority.length > 0);
    assert.ok(binding.groupKey.length > 0);
    assert.ok(binding.location.path.length > 0);
  }

  const datasetPath = resolve("data/training/personal-golden-segmentation-v2.json");
  const datasetBytes = await readFile(datasetPath);
  const pin = pinInputBytes(loaded.value, "humanRanges", datasetPath, datasetBytes);
  assert.equal(pin.catalogSha256, pin.sha256);
  assert.equal(pin.location.path, "data/training/personal-golden-segmentation-v2.json");
  assert.throws(
    () => pinInputBytes(loaded.value, "humanRanges", datasetPath, Buffer.concat([datasetBytes, Buffer.from("drift")])),
    /authoritative SHA-256 mismatch/u,
  );
  assert.throws(
    () => pinInputBytes(loaded.value, "rustWasm", datasetPath, datasetBytes),
    /outside authoritative asset location/u,
  );
});

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

test("review capabilities stay inside the public four-state contract", () => {
  const capability = (input: Readonly<{
    actionId: string;
    capturePosition: string;
    anatomicalSide: "left" | "right" | null;
    profileIdentity: string;
  }>) => reviewCapabilityForContext(input);

  assert.equal(capability({
    actionId: "barbell_bench_press",
    capturePosition: "frontLeft45",
    anatomicalSide: null,
    profileIdentity: "barbell_bench_press/frontLeft45/bilateral/barbell/fixture-v1",
  }), "phase_supported");
  assert.equal(capability({
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    profileIdentity: "barbell_bench_press/front/bilateral/barbell/fixture-v1",
  }), "phase_supported");
  assert.equal(capability({
    actionId: "pull_up",
    capturePosition: "rearLeft45",
    anatomicalSide: null,
    profileIdentity: "pull_up/rearLeft45/bilateral/fixed_pull_up_bar/fixture-v1",
  }), "observation_only");
  assert.equal(capability({
    actionId: "unknown_action",
    capturePosition: "front",
    anatomicalSide: null,
    profileIdentity: "unknown_action/front/bilateral/bodyweight/fixture-v1",
  }), "unsupported");
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
    capability: "quality_supported",
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

test("applied review policy never mutates decoded Rust quality proposals", () => {
  const rustProposal = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposalId: "rust-proposal-immutable",
    repId: 1,
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    equipmentRole: "barbell_axis_phase_and_path",
    capability: "phase_supported" as const,
    ruleBundleVersion: "personal-motion-quality-rules/v1",
    profileIdentity: "barbell_bench_press/front/bilateral/barbell/fixture-v1",
    profileHash: "0000000000000001",
    canonicalSliceHash: "0000000000000002",
    endpoints: [],
    conclusions: [],
    contentHash: "0123456789abcdef",
  };
  const before = JSON.stringify(rustProposal);
  const released = releaseQualityProposalsForPolicy(
    [rustProposal],
    {
      status: "no_winner",
      candidate: "diagnostic_unselected_fused",
      claimEligibility: "diagnostic_only_not_frozen_policy_claim",
      reportDigest: "a".repeat(64),
    },
  );

  assert.equal(released[0], rustProposal);
  assert.equal(JSON.stringify(released[0]), before);
  assert.deepEqual(Object.keys(released[0]), Object.keys(rustProposal));
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

test("selected equipment-only policy preserves subject identity while withholding all 26 joints", async () => {
  const report = await loadFrozenBenchAblationPolicyReport(
    "data/workflows/motion-quality-review/bench-pose-equipment-touched-benchmark-v1.json",
  );
  const applied = resolveAppliedBenchPolicy(
    report,
    "barbell_bench_press",
    "frontLeft45",
  );
  assert.equal(applied.status, "selected");
  assert.equal(applied.candidate, "equipment_only");
  assert.equal(applied.claimEligibility, "frozen_exact_view_policy");
  assert.equal(applied.reportDigest, report.value.reportDigest);
  assert.match(report.sha256, /^[a-f0-9]{64}$/u);

  const frame = {
    frameNumber: 7,
    timestampMs: 100,
    selectedBbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    landmarks: Array.from({ length: 26 }, (_, index) => ({
      x: 0.2 + index / 100,
      y: 0.3,
      z: null,
      visibility: 0.9,
    })),
  };
  const equipment = measuredAxisToEquipmentObservation({
    source: "measured",
    confidence: 0.96,
    x1: 0.2,
    y1: 0.4,
    x2: 0.8,
    y2: 0.4,
    centerY: 0.4,
  }, 8);
  const prepared = applyBenchPolicyToFrame(frame, equipment, applied);
  assert.equal(prepared.candidates.length, 1);
  assert.equal(prepared.candidates[0].candidateId, 1);
  assert.deepEqual(prepared.candidates[0].bbox, frame.selectedBbox);
  assert.equal(prepared.candidates[0].landmarks.length, 26);
  assert.ok(prepared.candidates[0].landmarks.every((point) => (
    point.x === 0 && point.y === 0 && point.z === 0 && point.visibility === 0
  )));
  assert.equal(prepared.equipment, equipment);
});

test("front no-winner runs only an explicitly unselected fused diagnostic", async () => {
  const report = await loadFrozenBenchAblationPolicyReport(
    "data/workflows/motion-quality-review/bench-pose-equipment-touched-benchmark-v1.json",
  );
  const applied = resolveAppliedBenchPolicy(report, "barbell_bench_press", "front");
  assert.equal(applied.status, "no_winner");
  assert.equal(applied.candidate, "diagnostic_unselected_fused");
  assert.equal(applied.frozenPolicyCandidate, null);
  assert.equal(applied.policyHash, null);
  assert.equal(applied.claimEligibility, "diagnostic_only_not_frozen_policy_claim");

  const frame = {
    frameNumber: 1,
    timestampMs: 100,
    selectedBbox: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
    landmarks: Array.from({ length: 26 }, () => ({
      x: 0.4,
      y: 0.5,
      z: null,
      visibility: 0.8,
    })),
  };
  const equipment = measuredAxisToEquipmentObservation({
    source: "measured",
    confidence: 0.96,
    x1: 0.2,
    y1: 0.4,
    x2: 0.8,
    y2: 0.4,
    centerY: 0.4,
  }, 2);
  const prepared = applyBenchPolicyToFrame(frame, equipment, applied);
  assert.equal(prepared.candidates[0].landmarks[0].visibility, 0.8);
  assert.equal(prepared.equipment, equipment);

  const proposal = buildReviewProposal({
    captureId: "front-diagnostic",
    actionId: "barbell_bench_press",
    capturePosition: "front",
    anatomicalSide: null,
    sourceCaptureId: "front-source",
    videoRef: null,
    profileIdentity: "barbell_bench_press/front/bilateral/barbell/fixture-v1",
    profileHash: "0000000000000001",
    capability: "phase_supported",
    appliedPolicy: applied,
    rustProposals: [],
  });
  assert.equal(proposal.lineage.capability, "phase_supported");
  assert.deepEqual(proposal.lineage.appliedPolicy, applied);
});

test("touched bench threshold lineage excludes all six target captures", async () => {
  const expectedTouchedSources = [
    "839e233f09acd809593551b125645bf7",
    "a44741cba03352f1e689fd51276dfec5",
    "a51c8a692c2a5a5b40cda482065cc6d5",
    "b8af1ab860d6bbb43cd3f2cadc71506c",
    "bc29e11c23f97a4b1ccaf321ba1e9db7",
    "e963bc2e0819f5ef528561cc1260b7ef",
  ];
  const catalog = await loadInputCatalog("tools/motion-quality/data-governance-inputs.json");
  const loaded = await loadTouchedBenchmarkBenchProfiles(
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
      "touched-benchmark-provisional-v1",
    ]);
    assert.deepEqual(entry.fittedSourceIds, expectedTouchedSources);
    assert.deepEqual(
      entry.fittedDerivativeSourceIds,
      expectedTouchedSources.map(rawObservationDerivativeId),
    );
  }
  const bundles = actualProfileBundles({ schemaVersion: "profiles/v1", profiles: [] }, loaded.value);
  assert.equal(bundles.length, 3);
  assert.ok(bundles.every((bundle) => (
    expectedTouchedSources.every((sourceCaptureId) => bundle.fittedSourceIds.includes(sourceCaptureId))
  )));

  const directory = await mkdtemp(join(tmpdir(), "maxpower-touched-benchmark-plan-"));
  const plan = await writeTouchedBenchmarkPlan({
    datasetPath: "data/training/personal-golden-segmentation-v2.json",
    profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
    touchedBenchmarkBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
    governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
    outputPath: join(directory, "plan.json"),
    seed: "touched-benchmark-source-exclusion-test",
    runId: "touched-benchmark-source-exclusion-test",
  });
  const benchContexts = plan.sources.flatMap((source) => source.contexts.filter((context) => (
    context.actionId === "barbell_bench_press"
  )));
  assert.equal(plan.runKind, "touched_benchmark");
  assert.equal(benchContexts.length, 6);
  assert.ok(benchContexts.every((context) => (
    context.capability === "unsupported"
    && context.bundle === null
    && context.selection === "no_legal_bundle"
  )));
  assert.doesNotMatch(JSON.stringify(plan), /blind|generalization/iu);

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

test("unsupported touched-benchmark context still runs current Rust WASM over every raw frame", async (t) => {
  const directory = await mkdtemp(resolve(
    "data/workflows/motion-quality-review/.tmp-touched-benchmark-test-",
  ));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const planPath = join(directory, "plan.json");
  const outputPath = join(directory, "prediction.json");
  const sourceCaptureId = "1ffdb9483b96090c6caf40a2ca3e6c46";
  await writeFile(planPath, JSON.stringify(sealTouchedBenchmarkPlan({
    schemaVersion: "maxpower-motion-quality-touched-benchmark-plan/v1",
    runId: "unsupported-real-wasm-test",
    runKind: "touched_benchmark",
    seed: "test",
    claimBoundary: TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
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
  })));
  const frozen = await runFrozenTouchedBenchmarkPlan({
    planPath,
    rawObservationRoot: "data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
    benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
    profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
    touchedBenchmarkBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
    governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
    wasmPath: "public/motion-sdk/maxpower_motion_sdk.wasm",
    outputPath,
  });
  const context = frozen.contexts[0];
  assert.equal(frozen.runKind, "touched_benchmark");
  assert.equal(context.capability, "unsupported");
  assert.equal(context.versions.profileBundle, "none");
  assert.doesNotMatch(context.versions.rustEngine, /not_run/u);
  assert.match(context.versions.rustEngine, /rust-canonical/u);
  assert.deepEqual(context.reps, []);
  assert.equal(context.processing.sourceTimestampsMs.length, 6);
});
