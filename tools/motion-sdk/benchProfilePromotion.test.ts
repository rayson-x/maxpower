import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateBenchProfilePromotion,
  type BenchPromotionEvidenceStore,
  type BenchProfilePromotionManifest,
} from "../../src/motion/benchProfilePromotion";
import { selectBenchRecognitionProfile } from "../../src/motion/benchProfileSelector";

const hash = (character: string) => `sha256:${character.repeat(64)}` as const;

const stableProfile = {
  identity: "barbell_bench_press/screen-y/v3",
  version: "3.0.0",
  uri: "profiles/barbell-bench-screen-y-v3.json",
  sha256: hash("a"),
} as const;

const candidateProfile = {
  identity: "barbell_bench_press/local-motion/v1",
  version: "1.0.0",
  uri: "profiles/barbell-bench-local-motion-v1.json",
  sha256: hash("b"),
} as const;

const manifestRef = {
  uri: "promotions/barbell-bench-local-motion-v1.json",
  sha256: hash("c"),
} as const;

const coordinateContract = {
  schemaVersion: "maxpower-local-motion-coordinate/v1",
  uri: "contracts/local-motion-coordinate-v1.json",
  sha256: hash("d"),
} as const;

const preregistrationRef = { uri: "eval/preregistered-gate.json", sha256: hash("e") } as const;
const untouchedRef = { uri: "eval/untouched.json", sha256: hash("f") } as const;
const touchedRef = { uri: "eval/touched-regression.json", sha256: hash("1") } as const;
const crossViewRef = { uri: "eval/cross-view.json", sha256: hash("2") } as const;
const parityRef = { uri: "eval/runtime-parity.json", sha256: hash("3") } as const;
const performanceRef = { uri: "eval/runtime-performance.json", sha256: hash("4") } as const;

const requiredCoverageBuckets = [
  "aggregate",
  "front_oblique_left",
  "front_oblique_right",
  "mirror",
  "bar_occlusion",
  "wrist_forearm_occlusion",
  "competing_subject_or_reflection",
  "low_confidence",
  "camera_roll",
] as const;

const manifest: BenchProfilePromotionManifest = {
  schemaVersion: "maxpower-bench-profile-promotion/v1",
  manifestId: "barbell-bench-local-motion-v1",
  sha256: manifestRef.sha256,
  actionContext: {
    exerciseId: "barbell_bench_press",
    variation: "standard_variant",
    equipment: "barbell",
    trainingSide: "bilateral",
    capturePositions: ["front", "front_oblique_left", "front_oblique_right"],
  },
  stableProfile,
  candidateProfile,
  coordinateContract,
  gate: {
    schemaVersion: "maxpower-bench-promotion-gate/v1",
    repPrecisionMinimum: 0.95,
    repRecallMinimum: 0.95,
    fullEndpointAlignmentMinimum: 0.95,
    endpointToleranceMs: 250,
    requireNoRegression: true,
    requireStrictNormalizedImprovement: true,
    requiredCoverageBuckets,
    requiredRuntimePlatforms: ["web_wasm", "android_native", "ios_native"],
  },
  evidence: {
    preregistration: preregistrationRef,
    untouchedAcceptance: untouchedRef,
    touchedRegression: touchedRef,
    synchronizedCrossView: crossViewRef,
    runtimeParity: parityRef,
    runtimePerformance: performanceRef,
  },
};

const passingBucket = {
  candidate: {
    repPrecision: 0.97,
    repRecall: 0.96,
    fullEndpointAlignment: 0.96,
    exactSetRate: 0.96,
  },
  stable: {
    repPrecision: 0.95,
    repRecall: 0.95,
    fullEndpointAlignment: 0.95,
    exactSetRate: 0.95,
  },
} as const;

const evidenceStore: BenchPromotionEvidenceStore = {
  [preregistrationRef.sha256]: {
    schemaVersion: "maxpower-bench-promotion-preregistration/v1",
    sha256: preregistrationRef.sha256,
    candidateProfileSha256: candidateProfile.sha256,
    coordinateContractSha256: coordinateContract.sha256,
    gate: manifest.gate,
    frozenAt: "2026-08-14T00:00:00.000Z",
  },
  [untouchedRef.sha256]: {
    schemaVersion: "maxpower-bench-profile-comparison/v1",
    sha256: untouchedRef.sha256,
    runKind: "untouched_model_acceptance",
    candidateProfileSha256: candidateProfile.sha256,
    stableProfileSha256: stableProfile.sha256,
    coordinateContractSha256: coordinateContract.sha256,
    preregistrationSha256: preregistrationRef.sha256,
    frozenBeforeTruthReveal: true,
    thresholdsChangedAfterTruthReveal: false,
    sourceInfluence: {
      fitting: false,
      thresholdSelection: false,
      profileChoice: false,
      manualResultInspection: false,
    },
    endpointToleranceMs: 250,
    metricsByBucket: {
      aggregate: passingBucket,
      front_oblique_left: passingBucket,
      front_oblique_right: passingBucket,
    },
    coverage: {
      denominatorPolicy: "all_candidates_including_abstentions_and_rejections",
      includedBuckets: [...requiredCoverageBuckets],
      sampleCountByBucket: Object.fromEntries(requiredCoverageBuckets.map((bucket) => [bucket, 3])),
      abstentionCount: 2,
      rejectionCount: 1,
    },
  },
  [touchedRef.sha256]: {
    schemaVersion: "maxpower-bench-profile-comparison/v1",
    sha256: touchedRef.sha256,
    runKind: "touched_benchmark",
    candidateProfileSha256: candidateProfile.sha256,
    stableProfileSha256: stableProfile.sha256,
    coordinateContractSha256: coordinateContract.sha256,
    preregistrationSha256: preregistrationRef.sha256,
    frozenBeforeTruthReveal: false,
    thresholdsChangedAfterTruthReveal: false,
    sourceInfluence: {
      fitting: true,
      thresholdSelection: true,
      profileChoice: true,
      manualResultInspection: true,
    },
    endpointToleranceMs: 250,
    metricsByBucket: {
      aggregate: passingBucket,
      front_oblique_left: passingBucket,
      front_oblique_right: passingBucket,
    },
    coverage: {
      denominatorPolicy: "all_candidates_including_abstentions_and_rejections",
      includedBuckets: [...requiredCoverageBuckets],
      sampleCountByBucket: Object.fromEntries(requiredCoverageBuckets.map((bucket) => [bucket, 1])),
      abstentionCount: 0,
      rejectionCount: 0,
    },
  },
  [crossViewRef.sha256]: {
    schemaVersion: "maxpower-bench-cross-view-validation/v1",
    sha256: crossViewRef.sha256,
    runKind: "synchronized_cross_view_validation",
    candidateProfileSha256: candidateProfile.sha256,
    coordinateContractSha256: coordinateContract.sha256,
    preregistrationSha256: preregistrationRef.sha256,
    frozenBeforeTruthReveal: true,
    worstObliqueBucket: "front_oblique_right",
    disagreementByBucket: {
      aggregate: { rawScreenY: 0.18, normalized: 0.12 },
      front_oblique_left: { rawScreenY: 0.17, normalized: 0.11 },
      front_oblique_right: { rawScreenY: 0.21, normalized: 0.15 },
    },
  },
  [parityRef.sha256]: {
    schemaVersion: "maxpower-bench-runtime-parity/v1",
    sha256: parityRef.sha256,
    candidateProfileSha256: candidateProfile.sha256,
    coordinateContractSha256: coordinateContract.sha256,
    status: "passed",
    platforms: {
      web_wasm: "passed",
      android_native: "passed",
      ios_native: "passed",
    },
    discreteSemanticsMatch: true,
    timestampsMatch: true,
    provenanceAndReasonsMatch: true,
    normalizedFloatsWithinTolerance: true,
  },
  [performanceRef.sha256]: {
    schemaVersion: "maxpower-bench-runtime-performance/v1",
    sha256: performanceRef.sha256,
    candidateProfileSha256: candidateProfile.sha256,
    coordinateContractSha256: coordinateContract.sha256,
    status: "passed",
    platforms: {
      web_wasm: { status: "passed", singlePassCausal: true, boundedLatestFrame: true },
      android_native: { status: "passed", singlePassCausal: true, boundedLatestFrame: true },
      ios_native: { status: "passed", singlePassCausal: true, boundedLatestFrame: true },
    },
  },
};

const context = {
  exerciseId: "barbell_bench_press",
  variation: "standard_variant",
  equipment: "barbell",
  trainingSide: "bilateral" as const,
  capturePosition: "front_oblique_left" as const,
};

test("an eligible manifest remains on the stable profile until an explicit manual activation", () => {
  const evaluation = evaluateBenchProfilePromotion(manifest, evidenceStore);
  assert.deepEqual(evaluation, {
    status: "eligible_for_manual_promotion",
    candidateProfile,
    blockerCodes: [],
    evidenceRefs: [
      preregistrationRef.sha256,
      untouchedRef.sha256,
      touchedRef.sha256,
      crossViewRef.sha256,
      parityRef.sha256,
      performanceRef.sha256,
    ],
  });

  const withoutActivation = selectBenchRecognitionProfile({
    context,
    stableProfile,
    manifests: [{ ref: manifestRef, manifest }],
    evidenceStore,
  });
  assert.equal(withoutActivation.selectedProfile, stableProfile);
  assert.equal(withoutActivation.status, "stable");
  assert.deepEqual(withoutActivation.reasonCodes, ["manual_promotion_activation_required"]);

  const withActivation = selectBenchRecognitionProfile({
    context,
    stableProfile,
    manifests: [{ ref: manifestRef, manifest }],
    evidenceStore,
    activation: {
      schemaVersion: "maxpower-profile-activation/v1",
      decision: "activate",
      manifestSha256: manifestRef.sha256,
      profileSha256: candidateProfile.sha256,
      authorizedBy: "release-review:bench-v1",
      authorizedAt: "2026-08-14T02:00:00.000Z",
    },
  });
  assert.equal(withActivation.status, "promoted");
  assert.equal(withActivation.selectedProfile, candidateProfile);
  assert.deepEqual(withActivation.reasonCodes, []);
});

test("untouched precision, recall, and full endpoint alignment each fail closed below 95 percent", () => {
  for (const [metric, blockerCode] of [
    ["repPrecision", "untouched_aggregate_rep_precision_below_gate"],
    ["repRecall", "untouched_aggregate_rep_recall_below_gate"],
    ["fullEndpointAlignment", "untouched_aggregate_full_endpoint_alignment_below_gate"],
  ] as const) {
    const untouched = evidenceStore[untouchedRef.sha256];
    assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
    const aggregate = untouched.metricsByBucket.aggregate;
    assert.ok(aggregate);
    const failingStore: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [untouchedRef.sha256]: {
        ...untouched,
        metricsByBucket: {
          ...untouched.metricsByBucket,
          aggregate: {
            ...aggregate,
            candidate: { ...aggregate.candidate, [metric]: 0.9499 },
          },
        },
      },
    };

    const evaluation = evaluateBenchProfilePromotion(manifest, failingStore);
    assert.equal(evaluation.status, "shadow_only");
    assert.ok(evaluation.blockerCodes.includes(blockerCode), metric);
  }
});

test("touched or source-influenced acceptance evidence cannot satisfy the untouched gate", () => {
  const untouched = evidenceStore[untouchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");

  const touchedAsAcceptance: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      runKind: "touched_benchmark",
      sourceInfluence: {
        fitting: true,
        thresholdSelection: false,
        profileChoice: false,
        manualResultInspection: false,
      },
    },
  };
  assert.deepEqual(
    evaluateBenchProfilePromotion(manifest, touchedAsAcceptance).blockerCodes,
    ["untouched_acceptance_run_kind_invalid", "untouched_acceptance_source_influenced"],
  );

  const manuallyInspected: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      sourceInfluence: {
        ...untouched.sourceInfluence,
        manualResultInspection: true,
      },
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, manuallyInspected).blockerCodes
      .includes("untouched_acceptance_source_influenced"),
  );
});

test("missing, hash-mismatched, or non-preregistered evidence fails closed", () => {
  const missing = { ...evidenceStore };
  delete (missing as Record<string, unknown>)[untouchedRef.sha256];
  assert.deepEqual(
    evaluateBenchProfilePromotion(manifest, missing).blockerCodes,
    [`evidence_missing:${untouchedRef.sha256}`],
  );

  const untouched = evidenceStore[untouchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  const wrongPreregistration: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      preregistrationSha256: hash("9"),
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, wrongPreregistration).blockerCodes
      .includes("untouched_acceptance_preregistration_mismatch"),
  );

  const wrongContentHash: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: { ...untouched, sha256: hash("8") },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, wrongContentHash).blockerCodes
      .includes(`evidence_missing:${untouchedRef.sha256}`),
  );
});

test("aggregate and both oblique buckets cannot regress against the stable profile", () => {
  const untouched = evidenceStore[untouchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  const left = untouched.metricsByBucket.front_oblique_left;
  const right = untouched.metricsByBucket.front_oblique_right;
  assert.ok(left && right);

  const regressed: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      metricsByBucket: {
        ...untouched.metricsByBucket,
        front_oblique_left: {
          ...left,
          candidate: { ...left.candidate, exactSetRate: 0.94 },
        },
        front_oblique_right: {
          ...right,
          candidate: { ...right.candidate, fullEndpointAlignment: 0.94 },
        },
      },
    },
  };
  const evaluation = evaluateBenchProfilePromotion(manifest, regressed);
  assert.equal(evaluation.status, "shadow_only");
  assert.ok(evaluation.blockerCodes.includes("untouched_front_oblique_left_exact_set_rate_regressed"));
  assert.ok(evaluation.blockerCodes.includes("untouched_front_oblique_right_full_endpoint_alignment_regressed"));

  const missingRight: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      metricsByBucket: { ...untouched.metricsByBucket, front_oblique_right: undefined },
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, missingRight).blockerCodes
      .includes("untouched_front_oblique_right_metrics_missing"),
  );
});

test("normalized cross-view disagreement must strictly improve aggregate and worst oblique", () => {
  const crossView = evidenceStore[crossViewRef.sha256];
  assert.ok(crossView?.schemaVersion === "maxpower-bench-cross-view-validation/v1");

  for (const [bucket, blocker] of [
    ["aggregate", "normalized_aggregate_not_strictly_improved"],
    ["front_oblique_right", "normalized_worst_oblique_not_strictly_improved"],
  ] as const) {
    const current: { readonly rawScreenY: number; readonly normalized: number } | undefined =
      crossView.disagreementByBucket[bucket];
    assert.ok(current);
    const notImproved: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [crossViewRef.sha256]: {
        ...crossView,
        disagreementByBucket: {
          ...crossView.disagreementByBucket,
          [bucket]: { ...current, normalized: current.rawScreenY },
        },
      },
    };
    const evaluation = evaluateBenchProfilePromotion(manifest, notImproved);
    assert.equal(evaluation.status, "shadow_only");
    assert.ok(evaluation.blockerCodes.includes(blocker), bucket);
  }
});

test("mandatory stress buckets and every abstention or rejection remain in the denominator", () => {
  const untouched = evidenceStore[untouchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  const withoutMirror: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      coverage: {
        ...untouched.coverage,
        includedBuckets: untouched.coverage.includedBuckets.filter((bucket) => bucket !== "mirror"),
      },
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, withoutMirror).blockerCodes
      .includes("coverage_bucket_missing:mirror"),
  );

  const deletedCandidates: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      coverage: { ...untouched.coverage, denominatorPolicy: "confirmed_reps_only" },
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, deletedCandidates).blockerCodes
      .includes("coverage_denominator_excludes_abstentions_or_rejections"),
  );

  const emptyOcclusion: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      coverage: {
        ...untouched.coverage,
        sampleCountByBucket: { ...untouched.coverage.sampleCountByBucket, bar_occlusion: 0 },
      },
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, emptyOcclusion).blockerCodes
      .includes("coverage_bucket_empty:bar_occlusion"),
  );
});

test("runtime parity fails closed for every platform and semantic dimension", () => {
  const parity = evidenceStore[parityRef.sha256];
  assert.ok(parity?.schemaVersion === "maxpower-bench-runtime-parity/v1");

  for (const [mutation, blocker] of [
    [{ status: "platform_gated" as const }, "runtime_parity_not_passed"],
    [{ platforms: { ...parity.platforms, ios_native: "failed" as const } }, "runtime_parity_platform_not_passed:ios_native"],
    [{ discreteSemanticsMatch: false }, "runtime_parity_discrete_semantics_mismatch"],
    [{ timestampsMatch: false }, "runtime_parity_timestamp_mismatch"],
    [{ provenanceAndReasonsMatch: false }, "runtime_parity_provenance_or_reason_mismatch"],
    [{ normalizedFloatsWithinTolerance: false }, "runtime_parity_float_tolerance_failed"],
  ] as const) {
    const failingStore: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [parityRef.sha256]: { ...parity, ...mutation },
    };
    const evaluation = evaluateBenchProfilePromotion(manifest, failingStore);
    assert.equal(evaluation.status, "shadow_only");
    assert.ok(evaluation.blockerCodes.includes(blocker), blocker);
  }
});

test("runtime performance fails closed when any platform is gated or is not a causal bounded stream", () => {
  const performance = evidenceStore[performanceRef.sha256];
  assert.ok(performance?.schemaVersion === "maxpower-bench-runtime-performance/v1");

  for (const [mutation, blocker] of [
    [{ status: "platform_gated" as const }, "runtime_performance_not_passed"],
    [{
      platforms: {
        ...performance.platforms,
        android_native: { ...performance.platforms.android_native, status: "platform_gated" as const },
      },
    }, "runtime_performance_platform_not_passed:android_native"],
    [{
      platforms: {
        ...performance.platforms,
        web_wasm: { ...performance.platforms.web_wasm, singlePassCausal: false },
      },
    }, "runtime_performance_not_single_pass_causal:web_wasm"],
    [{
      platforms: {
        ...performance.platforms,
        ios_native: { ...performance.platforms.ios_native, boundedLatestFrame: false },
      },
    }, "runtime_performance_unbounded_backlog:ios_native"],
  ] as const) {
    const failingStore: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [performanceRef.sha256]: { ...performance, ...mutation },
    };
    const evaluation = evaluateBenchProfilePromotion(manifest, failingStore);
    assert.equal(evaluation.status, "shadow_only");
    assert.ok(evaluation.blockerCodes.includes(blocker), blocker);
  }
});

test("an activation cannot bypass manifest hash, profile hash, or exact-context gates", () => {
  for (const activation of [
    {
      schemaVersion: "maxpower-profile-activation/v1" as const,
      decision: "activate" as const,
      manifestSha256: hash("7"),
      profileSha256: candidateProfile.sha256,
      authorizedBy: "release-review:bench-v1",
      authorizedAt: "2026-08-14T02:00:00.000Z",
    },
    {
      schemaVersion: "maxpower-profile-activation/v1" as const,
      decision: "activate" as const,
      manifestSha256: manifestRef.sha256,
      profileSha256: hash("6"),
      authorizedBy: "release-review:bench-v1",
      authorizedAt: "2026-08-14T02:00:00.000Z",
    },
  ]) {
    const selection = selectBenchRecognitionProfile({
      context,
      stableProfile,
      manifests: [{ ref: manifestRef, manifest }],
      evidenceStore,
      activation,
    });
    assert.equal(selection.status, "data_gated");
    assert.equal(selection.selectedProfile, stableProfile);
    assert.ok(selection.reasonCodes.includes("promotion_activation_mismatch"));
  }

  const wrongContext = selectBenchRecognitionProfile({
    context: { ...context, equipment: "dumbbell" },
    stableProfile,
    manifests: [{ ref: manifestRef, manifest }],
    evidenceStore,
  });
  assert.equal(wrongContext.selectedProfile, stableProfile);
  assert.deepEqual(wrongContext.reasonCodes, ["promotion_manifest_missing"]);
});

test("explicit rollback selects the supplied previous stable profile without mutating history", () => {
  const selection = selectBenchRecognitionProfile({
    context,
    stableProfile,
    manifests: [{ ref: manifestRef, manifest }],
    evidenceStore,
    activation: {
      schemaVersion: "maxpower-profile-activation/v1",
      decision: "rollback",
      manifestSha256: manifestRef.sha256,
      profileSha256: stableProfile.sha256,
      authorizedBy: "release-review:bench-rollback",
      authorizedAt: "2026-08-14T03:00:00.000Z",
    },
  });
  assert.equal(selection.status, "rolled_back");
  assert.equal(selection.selectedProfile, stableProfile);
  assert.deepEqual(selection.reasonCodes, ["explicit_profile_rollback"]);
});

test("the manifest cannot weaken the fixed 95 percent and 250 millisecond policy", () => {
  for (const [gate, blocker] of [
    [{ ...manifest.gate, repPrecisionMinimum: 0.949 }, "promotion_gate_policy_mismatch"],
    [{ ...manifest.gate, repRecallMinimum: 0.949 }, "promotion_gate_policy_mismatch"],
    [{ ...manifest.gate, fullEndpointAlignmentMinimum: 0.949 }, "promotion_gate_policy_mismatch"],
    [{ ...manifest.gate, endpointToleranceMs: 251 }, "promotion_gate_policy_mismatch"],
  ] as const) {
    const weakened = { ...manifest, gate };
    const evaluation = evaluateBenchProfilePromotion(weakened, evidenceStore);
    assert.equal(evaluation.status, "shadow_only");
    assert.ok(evaluation.blockerCodes.includes(blocker));
  }
});

test("preregistration and every evidence artifact must bind the same immutable candidate and coordinate contract", () => {
  const preregistration = evidenceStore[preregistrationRef.sha256];
  const untouched = evidenceStore[untouchedRef.sha256];
  const crossView = evidenceStore[crossViewRef.sha256];
  const parity = evidenceStore[parityRef.sha256];
  const performance = evidenceStore[performanceRef.sha256];
  assert.ok(preregistration?.schemaVersion === "maxpower-bench-promotion-preregistration/v1");
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  assert.ok(crossView?.schemaVersion === "maxpower-bench-cross-view-validation/v1");
  assert.ok(parity?.schemaVersion === "maxpower-bench-runtime-parity/v1");
  assert.ok(performance?.schemaVersion === "maxpower-bench-runtime-performance/v1");

  for (const [ref, evidence, mutation, blocker] of [
    [preregistrationRef, preregistration, { candidateProfileSha256: hash("5") }, "preregistration_candidate_profile_mismatch"],
    [preregistrationRef, preregistration, { coordinateContractSha256: hash("5") }, "preregistration_coordinate_contract_mismatch"],
    [preregistrationRef, preregistration, { gate: { ...manifest.gate, endpointToleranceMs: 249 } }, "preregistration_gate_mismatch"],
    [untouchedRef, untouched, { candidateProfileSha256: hash("5") }, "untouched_acceptance_candidate_profile_mismatch"],
    [untouchedRef, untouched, { coordinateContractSha256: hash("5") }, "untouched_acceptance_coordinate_contract_mismatch"],
    [crossViewRef, crossView, { candidateProfileSha256: hash("5") }, "cross_view_candidate_profile_mismatch"],
    [crossViewRef, crossView, { coordinateContractSha256: hash("5") }, "cross_view_coordinate_contract_mismatch"],
    [parityRef, parity, { candidateProfileSha256: hash("5") }, "runtime_parity_candidate_profile_mismatch"],
    [performanceRef, performance, { coordinateContractSha256: hash("5") }, "runtime_performance_coordinate_contract_mismatch"],
  ] as const) {
    const failingStore: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [ref.sha256]: { ...evidence, ...mutation } as never,
    };
    const evaluation = evaluateBenchProfilePromotion(manifest, failingStore);
    assert.equal(evaluation.status, "shadow_only");
    assert.ok(evaluation.blockerCodes.includes(blocker), blocker);
  }
});

test("truth reveal, threshold retuning, or wrong evidence schemas keep the candidate shadow-only", () => {
  const untouched = evidenceStore[untouchedRef.sha256];
  const crossView = evidenceStore[crossViewRef.sha256];
  const touched = evidenceStore[touchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  assert.ok(crossView?.schemaVersion === "maxpower-bench-cross-view-validation/v1");
  assert.ok(touched?.schemaVersion === "maxpower-bench-profile-comparison/v1");

  for (const [ref, evidence, mutation, blocker] of [
    [untouchedRef, untouched, { frozenBeforeTruthReveal: false }, "untouched_acceptance_not_frozen_before_truth"],
    [untouchedRef, untouched, { thresholdsChangedAfterTruthReveal: true }, "untouched_acceptance_thresholds_changed_after_truth"],
    [untouchedRef, untouched, { endpointToleranceMs: 251 }, "untouched_acceptance_endpoint_tolerance_mismatch"],
    [crossViewRef, crossView, { frozenBeforeTruthReveal: false }, "cross_view_not_frozen_before_truth"],
    [touchedRef, touched, { runKind: "untouched_model_acceptance" }, "touched_regression_run_kind_invalid"],
  ] as const) {
    const failingStore: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [ref.sha256]: { ...evidence, ...mutation } as never,
    };
    assert.ok(evaluateBenchProfilePromotion(manifest, failingStore).blockerCodes.includes(blocker), blocker);
  }

  const wrongSchema = {
    ...evidenceStore,
    [parityRef.sha256]: {
      ...evidenceStore[parityRef.sha256],
      schemaVersion: "maxpower-bench-runtime-parity/v0",
    } as never,
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, wrongSchema).blockerCodes
      .includes("runtime_parity_evidence_invalid"),
  );
});

test("touched benchmarks can prove regression safety but never accuracy acceptance", () => {
  const touched = evidenceStore[touchedRef.sha256];
  assert.ok(touched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  const left = touched.metricsByBucket.front_oblique_left;
  assert.ok(left);
  const regressed: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [touchedRef.sha256]: {
      ...touched,
      metricsByBucket: {
        ...touched.metricsByBucket,
        front_oblique_left: {
          ...left,
          candidate: { ...left.candidate, repRecall: left.stable.repRecall - 0.01 },
        },
      },
    },
  };
  const evaluation = evaluateBenchProfilePromotion(manifest, regressed);
  assert.equal(evaluation.status, "shadow_only");
  assert.ok(evaluation.blockerCodes.includes("touched_front_oblique_left_rep_recall_regressed"));
});

test("non-finite, out-of-range, or structurally incomplete metrics fail closed", () => {
  const untouched = evidenceStore[untouchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  const aggregate = untouched.metricsByBucket.aggregate;
  assert.ok(aggregate);

  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
    const invalid: BenchPromotionEvidenceStore = {
      ...evidenceStore,
      [untouchedRef.sha256]: {
        ...untouched,
        metricsByBucket: {
          ...untouched.metricsByBucket,
          aggregate: {
            ...aggregate,
            candidate: { ...aggregate.candidate, repPrecision: value },
          },
        },
      },
    };
    assert.ok(
      evaluateBenchProfilePromotion(manifest, invalid).blockerCodes
        .includes("untouched_aggregate_candidate_metrics_invalid"),
      String(value),
    );
  }

  const invalidGate = {
    ...manifest,
    gate: { ...manifest.gate, repPrecisionMinimum: Number.NaN },
  };
  assert.ok(
    evaluateBenchProfilePromotion(invalidGate, evidenceStore).blockerCodes
      .includes("promotion_gate_policy_mismatch"),
  );
});

test("selector verifies the immutable manifest ref and supplied stable profile", () => {
  const wrongManifestRef = selectBenchRecognitionProfile({
    context,
    stableProfile,
    manifests: [{ ref: { ...manifestRef, sha256: hash("0") }, manifest }],
    evidenceStore,
  });
  assert.equal(wrongManifestRef.status, "data_gated");
  assert.deepEqual(wrongManifestRef.reasonCodes, ["promotion_manifest_hash_mismatch"]);

  const wrongStable = selectBenchRecognitionProfile({
    context,
    stableProfile: { ...stableProfile, sha256: hash("0") },
    manifests: [{ ref: manifestRef, manifest }],
    evidenceStore,
  });
  assert.equal(wrongStable.status, "data_gated");
  assert.deepEqual(wrongStable.reasonCodes, ["promotion_stable_profile_mismatch"]);
});

test("manual activation selects its exact versioned manifest instead of array order", () => {
  const olderInvalidManifest: BenchProfilePromotionManifest = {
    ...manifest,
    manifestId: "barbell-bench-local-motion-v0",
    sha256: hash("0"),
    candidateProfile: { ...candidateProfile, version: "0.9.0", sha256: hash("0") },
    evidence: {
      ...manifest.evidence,
      untouchedAcceptance: { ...untouchedRef, sha256: hash("0") },
    },
  };
  const selection = selectBenchRecognitionProfile({
    context,
    stableProfile,
    manifests: [
      { ref: { uri: "promotions/barbell-bench-local-motion-v0.json", sha256: hash("0") }, manifest: olderInvalidManifest },
      { ref: manifestRef, manifest },
    ],
    evidenceStore,
    activation: {
      schemaVersion: "maxpower-profile-activation/v1",
      decision: "activate",
      manifestSha256: manifestRef.sha256,
      profileSha256: candidateProfile.sha256,
      authorizedBy: "release-review:bench-v1",
      authorizedAt: "2026-08-14T02:00:00.000Z",
    },
  });
  assert.equal(selection.status, "promoted");
  assert.equal(selection.selectedProfile, candidateProfile);
});

test("camera roll is a mandatory non-empty promotion bucket", () => {
  const untouched = evidenceStore[untouchedRef.sha256];
  assert.ok(untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1");
  const withoutCameraRoll: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [untouchedRef.sha256]: {
      ...untouched,
      coverage: {
        ...untouched.coverage,
        includedBuckets: untouched.coverage.includedBuckets.filter((bucket) => bucket !== "camera_roll"),
      },
    },
  };
  assert.ok(
    evaluateBenchProfilePromotion(manifest, withoutCameraRoll).blockerCodes
      .includes("coverage_bucket_missing:camera_roll"),
  );
});

test("the report cannot hide the actual worst oblique bucket", () => {
  const crossView = evidenceStore[crossViewRef.sha256];
  assert.ok(crossView?.schemaVersion === "maxpower-bench-cross-view-validation/v1");
  const mislabeled: BenchPromotionEvidenceStore = {
    ...evidenceStore,
    [crossViewRef.sha256]: {
      ...crossView,
      worstObliqueBucket: "front_oblique_left",
    },
  };
  const evaluation = evaluateBenchProfilePromotion(manifest, mislabeled);
  assert.equal(evaluation.status, "shadow_only");
  assert.ok(evaluation.blockerCodes.includes("cross_view_worst_oblique_bucket_mismatch"));
});

test("rollback remains available after candidate evidence is revoked", () => {
  const revokedEvidence = { ...evidenceStore };
  delete (revokedEvidence as Record<string, unknown>)[untouchedRef.sha256];
  const selection = selectBenchRecognitionProfile({
    context,
    stableProfile,
    manifests: [{ ref: manifestRef, manifest }],
    evidenceStore: revokedEvidence,
    activation: {
      schemaVersion: "maxpower-profile-activation/v1",
      decision: "rollback",
      manifestSha256: manifestRef.sha256,
      profileSha256: stableProfile.sha256,
      authorizedBy: "release-review:bench-emergency-rollback",
      authorizedAt: "2026-08-14T04:00:00.000Z",
    },
  });
  assert.equal(selection.status, "rolled_back");
  assert.equal(selection.selectedProfile, stableProfile);
});
