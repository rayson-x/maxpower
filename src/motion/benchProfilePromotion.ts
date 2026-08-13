export type Sha256 = `sha256:${string}`;

export interface ImmutableEvidenceRef {
  readonly uri: string;
  readonly sha256: Sha256;
}

export interface ImmutableRecognitionProfileRef extends ImmutableEvidenceRef {
  readonly identity: string;
  readonly version: string;
}

export type BenchPromotionBucket =
  | "aggregate"
  | "front_oblique_left"
  | "front_oblique_right"
  | "mirror"
  | "bar_occlusion"
  | "wrist_forearm_occlusion"
  | "competing_subject_or_reflection"
  | "low_confidence"
  | "camera_roll";

export type BenchRuntimePlatform = "web_wasm" | "android_native" | "ios_native";

type ComparisonMetricCode =
  | "rep_precision"
  | "rep_recall"
  | "full_endpoint_alignment"
  | "exact_set_rate";
type CoreComparisonBucket = "aggregate" | "front_oblique_left" | "front_oblique_right";

/** Stable machine-readable reasons; spelling changes are contract changes. */
export type BenchPromotionBlockerCode =
  | `evidence_missing:${Sha256}`
  | "promotion_gate_policy_mismatch"
  | "promotion_gate_required_bucket_missing"
  | "promotion_gate_required_runtime_missing"
  | "preregistration_candidate_profile_mismatch"
  | "preregistration_coordinate_contract_mismatch"
  | "preregistration_gate_mismatch"
  | "preregistration_evidence_invalid"
  | "untouched_acceptance_run_kind_invalid"
  | "untouched_acceptance_source_influenced"
  | "untouched_acceptance_preregistration_mismatch"
  | "untouched_acceptance_candidate_profile_mismatch"
  | "untouched_acceptance_stable_profile_mismatch"
  | "untouched_acceptance_coordinate_contract_mismatch"
  | "untouched_acceptance_not_frozen_before_truth"
  | "untouched_acceptance_thresholds_changed_after_truth"
  | "untouched_acceptance_endpoint_tolerance_mismatch"
  | "untouched_aggregate_rep_precision_below_gate"
  | "untouched_aggregate_rep_recall_below_gate"
  | "untouched_aggregate_full_endpoint_alignment_below_gate"
  | `untouched_${CoreComparisonBucket}_${"metrics_missing" | "candidate_metrics_invalid" | "stable_metrics_invalid"}`
  | `untouched_${CoreComparisonBucket}_${ComparisonMetricCode}_regressed`
  | "coverage_denominator_excludes_abstentions_or_rejections"
  | `coverage_bucket_${"missing" | "empty"}:${BenchPromotionBucket}`
  | "untouched_acceptance_evidence_invalid"
  | "touched_regression_run_kind_invalid"
  | "touched_regression_candidate_profile_mismatch"
  | "touched_regression_stable_profile_mismatch"
  | "touched_regression_coordinate_contract_mismatch"
  | "touched_regression_preregistration_mismatch"
  | `touched_${CoreComparisonBucket}_${"metrics_missing" | "metrics_invalid"}`
  | `touched_${CoreComparisonBucket}_${ComparisonMetricCode}_regressed`
  | "touched_regression_evidence_invalid"
  | "cross_view_run_kind_invalid"
  | "cross_view_candidate_profile_mismatch"
  | "cross_view_coordinate_contract_mismatch"
  | "cross_view_preregistration_mismatch"
  | "cross_view_not_frozen_before_truth"
  | "normalized_aggregate_not_strictly_improved"
  | "cross_view_worst_oblique_bucket_mismatch"
  | "normalized_worst_oblique_not_strictly_improved"
  | "cross_view_evidence_invalid"
  | "runtime_parity_candidate_profile_mismatch"
  | "runtime_parity_coordinate_contract_mismatch"
  | "runtime_parity_not_passed"
  | `runtime_parity_platform_not_passed:${BenchRuntimePlatform}`
  | "runtime_parity_discrete_semantics_mismatch"
  | "runtime_parity_timestamp_mismatch"
  | "runtime_parity_provenance_or_reason_mismatch"
  | "runtime_parity_float_tolerance_failed"
  | "runtime_parity_evidence_invalid"
  | "runtime_performance_candidate_profile_mismatch"
  | "runtime_performance_coordinate_contract_mismatch"
  | "runtime_performance_not_passed"
  | `runtime_performance_platform_not_passed:${BenchRuntimePlatform}`
  | `runtime_performance_not_single_pass_causal:${BenchRuntimePlatform}`
  | `runtime_performance_unbounded_backlog:${BenchRuntimePlatform}`
  | "runtime_performance_evidence_invalid";

export interface BenchPromotionGate {
  readonly schemaVersion: "maxpower-bench-promotion-gate/v1";
  readonly repPrecisionMinimum: number;
  readonly repRecallMinimum: number;
  readonly fullEndpointAlignmentMinimum: number;
  readonly endpointToleranceMs: number;
  readonly requireNoRegression: true;
  readonly requireStrictNormalizedImprovement: true;
  readonly requiredCoverageBuckets: readonly BenchPromotionBucket[];
  readonly requiredRuntimePlatforms: readonly BenchRuntimePlatform[];
}

export interface BenchProfilePromotionManifest {
  readonly schemaVersion: "maxpower-bench-profile-promotion/v1";
  readonly manifestId: string;
  readonly sha256: Sha256;
  readonly actionContext: {
    readonly exerciseId: "barbell_bench_press";
    readonly variation: string;
    readonly equipment: "barbell";
    readonly trainingSide: "bilateral";
    readonly capturePositions: readonly ("front" | "front_oblique_left" | "front_oblique_right")[];
  };
  readonly stableProfile: ImmutableRecognitionProfileRef;
  readonly candidateProfile: ImmutableRecognitionProfileRef;
  readonly coordinateContract: ImmutableEvidenceRef & { readonly schemaVersion: string };
  readonly gate: BenchPromotionGate;
  readonly evidence: {
    readonly preregistration: ImmutableEvidenceRef;
    readonly untouchedAcceptance: ImmutableEvidenceRef;
    readonly touchedRegression: ImmutableEvidenceRef;
    readonly synchronizedCrossView: ImmutableEvidenceRef;
    readonly runtimeParity: ImmutableEvidenceRef;
    readonly runtimePerformance: ImmutableEvidenceRef;
  };
}

interface ProfileMetrics {
  readonly repPrecision: number;
  readonly repRecall: number;
  readonly fullEndpointAlignment: number;
  readonly exactSetRate: number;
}

interface ComparisonBucket {
  readonly candidate: ProfileMetrics;
  readonly stable: ProfileMetrics;
}

export interface BenchProfileComparisonEvidence {
  readonly schemaVersion: "maxpower-bench-profile-comparison/v1";
  readonly sha256: Sha256;
  readonly runKind: "touched_benchmark" | "untouched_model_acceptance";
  readonly candidateProfileSha256: Sha256;
  readonly stableProfileSha256: Sha256;
  readonly coordinateContractSha256: Sha256;
  readonly preregistrationSha256: Sha256;
  readonly frozenBeforeTruthReveal: boolean;
  readonly thresholdsChangedAfterTruthReveal: boolean;
  readonly sourceInfluence: {
    readonly fitting: boolean;
    readonly thresholdSelection: boolean;
    readonly profileChoice: boolean;
    readonly manualResultInspection: boolean;
  };
  readonly endpointToleranceMs: number;
  readonly metricsByBucket: Partial<Record<BenchPromotionBucket, ComparisonBucket>>;
  readonly coverage: {
    readonly denominatorPolicy: string;
    readonly includedBuckets: readonly BenchPromotionBucket[];
    readonly sampleCountByBucket: Partial<Record<BenchPromotionBucket, number>>;
    readonly abstentionCount: number;
    readonly rejectionCount: number;
  };
}

export interface BenchPromotionPreregistrationEvidence {
  readonly schemaVersion: "maxpower-bench-promotion-preregistration/v1";
  readonly sha256: Sha256;
  readonly candidateProfileSha256: Sha256;
  readonly coordinateContractSha256: Sha256;
  readonly gate: BenchPromotionGate;
  readonly frozenAt: string;
}

export interface BenchCrossViewEvidence {
  readonly schemaVersion: "maxpower-bench-cross-view-validation/v1";
  readonly sha256: Sha256;
  readonly runKind: "synchronized_cross_view_validation";
  readonly candidateProfileSha256: Sha256;
  readonly coordinateContractSha256: Sha256;
  readonly preregistrationSha256: Sha256;
  readonly frozenBeforeTruthReveal: boolean;
  readonly worstObliqueBucket: "front_oblique_left" | "front_oblique_right";
  readonly disagreementByBucket: Partial<Record<
    "aggregate" | "front_oblique_left" | "front_oblique_right",
    { readonly rawScreenY: number; readonly normalized: number }
  >>;
}

export interface BenchRuntimeParityEvidence {
  readonly schemaVersion: "maxpower-bench-runtime-parity/v1";
  readonly sha256: Sha256;
  readonly candidateProfileSha256: Sha256;
  readonly coordinateContractSha256: Sha256;
  readonly status: "passed" | "failed" | "platform_gated";
  readonly platforms: Record<BenchRuntimePlatform, "passed" | "failed" | "platform_gated">;
  readonly discreteSemanticsMatch: boolean;
  readonly timestampsMatch: boolean;
  readonly provenanceAndReasonsMatch: boolean;
  readonly normalizedFloatsWithinTolerance: boolean;
}

export interface BenchRuntimePerformanceEvidence {
  readonly schemaVersion: "maxpower-bench-runtime-performance/v1";
  readonly sha256: Sha256;
  readonly candidateProfileSha256: Sha256;
  readonly coordinateContractSha256: Sha256;
  readonly status: "passed" | "failed" | "platform_gated";
  readonly platforms: Record<BenchRuntimePlatform, {
    readonly status: "passed" | "failed" | "platform_gated";
    readonly singlePassCausal: boolean;
    readonly boundedLatestFrame: boolean;
  }>;
}

export type BenchPromotionEvidence =
  | BenchPromotionPreregistrationEvidence
  | BenchProfileComparisonEvidence
  | BenchCrossViewEvidence
  | BenchRuntimeParityEvidence
  | BenchRuntimePerformanceEvidence;

export interface BenchPromotionEvidenceStore {
  readonly [sha256: string]: BenchPromotionEvidence | undefined;
}

export interface BenchPromotionEvaluation {
  readonly status: "eligible_for_manual_promotion" | "shadow_only";
  readonly candidateProfile: ImmutableRecognitionProfileRef;
  readonly blockerCodes: readonly BenchPromotionBlockerCode[];
  readonly evidenceRefs: readonly Sha256[];
}

export function evaluateBenchProfilePromotion(
  manifest: BenchProfilePromotionManifest,
  evidenceStore: BenchPromotionEvidenceStore,
): BenchPromotionEvaluation {
  const refs = [
    manifest.evidence.preregistration,
    manifest.evidence.untouchedAcceptance,
    manifest.evidence.touchedRegression,
    manifest.evidence.synchronizedCrossView,
    manifest.evidence.runtimeParity,
    manifest.evidence.runtimePerformance,
  ];
  const blockers: BenchPromotionBlockerCode[] = refs.flatMap((ref): BenchPromotionBlockerCode[] => {
    const evidence = evidenceStore[ref.sha256];
    return evidence?.sha256 === ref.sha256 ? [] : [`evidence_missing:${ref.sha256}`];
  });
  if (
    !isUnitInterval(manifest.gate.repPrecisionMinimum) || manifest.gate.repPrecisionMinimum < 0.95
    || !isUnitInterval(manifest.gate.repRecallMinimum) || manifest.gate.repRecallMinimum < 0.95
    || !isUnitInterval(manifest.gate.fullEndpointAlignmentMinimum)
    || manifest.gate.fullEndpointAlignmentMinimum < 0.95
    || !Number.isFinite(manifest.gate.endpointToleranceMs)
    || manifest.gate.endpointToleranceMs <= 0
    || manifest.gate.endpointToleranceMs > 250
    || manifest.gate.requireNoRegression !== true
    || manifest.gate.requireStrictNormalizedImprovement !== true
  ) {
    blockers.push("promotion_gate_policy_mismatch");
  }
  const mandatoryBuckets: readonly BenchPromotionBucket[] = [
    "aggregate",
    "front_oblique_left",
    "front_oblique_right",
    "mirror",
    "bar_occlusion",
    "wrist_forearm_occlusion",
    "competing_subject_or_reflection",
    "low_confidence",
    "camera_roll",
  ];
  if (mandatoryBuckets.some((bucket) => !manifest.gate.requiredCoverageBuckets.includes(bucket))) {
    blockers.push("promotion_gate_required_bucket_missing");
  }
  const mandatoryPlatforms: readonly BenchRuntimePlatform[] = ["web_wasm", "android_native", "ios_native"];
  if (mandatoryPlatforms.some((platform) => !manifest.gate.requiredRuntimePlatforms.includes(platform))) {
    blockers.push("promotion_gate_required_runtime_missing");
  }
  const preregistration = evidenceStore[manifest.evidence.preregistration.sha256];
  if (preregistration?.schemaVersion === "maxpower-bench-promotion-preregistration/v1") {
    if (preregistration.candidateProfileSha256 !== manifest.candidateProfile.sha256) {
      blockers.push("preregistration_candidate_profile_mismatch");
    }
    if (preregistration.coordinateContractSha256 !== manifest.coordinateContract.sha256) {
      blockers.push("preregistration_coordinate_contract_mismatch");
    }
    if (!sameGate(preregistration.gate, manifest.gate)) {
      blockers.push("preregistration_gate_mismatch");
    }
  } else if (preregistration?.sha256 === manifest.evidence.preregistration.sha256) {
    blockers.push("preregistration_evidence_invalid");
  }
  const untouched = evidenceStore[manifest.evidence.untouchedAcceptance.sha256];
  if (untouched?.schemaVersion === "maxpower-bench-profile-comparison/v1") {
    if (untouched.runKind !== "untouched_model_acceptance") {
      blockers.push("untouched_acceptance_run_kind_invalid");
    }
    if (Object.values(untouched.sourceInfluence).some(Boolean)) {
      blockers.push("untouched_acceptance_source_influenced");
    }
    if (untouched.preregistrationSha256 !== manifest.evidence.preregistration.sha256) {
      blockers.push("untouched_acceptance_preregistration_mismatch");
    }
    if (untouched.candidateProfileSha256 !== manifest.candidateProfile.sha256) {
      blockers.push("untouched_acceptance_candidate_profile_mismatch");
    }
    if (untouched.stableProfileSha256 !== manifest.stableProfile.sha256) {
      blockers.push("untouched_acceptance_stable_profile_mismatch");
    }
    if (untouched.coordinateContractSha256 !== manifest.coordinateContract.sha256) {
      blockers.push("untouched_acceptance_coordinate_contract_mismatch");
    }
    if (!untouched.frozenBeforeTruthReveal) {
      blockers.push("untouched_acceptance_not_frozen_before_truth");
    }
    if (untouched.thresholdsChangedAfterTruthReveal) {
      blockers.push("untouched_acceptance_thresholds_changed_after_truth");
    }
    if (untouched.endpointToleranceMs !== manifest.gate.endpointToleranceMs) {
      blockers.push("untouched_acceptance_endpoint_tolerance_mismatch");
    }
    const aggregate = untouched.metricsByBucket.aggregate?.candidate;
    if (!aggregate || aggregate.repPrecision < manifest.gate.repPrecisionMinimum) {
      blockers.push("untouched_aggregate_rep_precision_below_gate");
    }
    if (!aggregate || aggregate.repRecall < manifest.gate.repRecallMinimum) {
      blockers.push("untouched_aggregate_rep_recall_below_gate");
    }
    if (!aggregate || aggregate.fullEndpointAlignment < manifest.gate.fullEndpointAlignmentMinimum) {
      blockers.push("untouched_aggregate_full_endpoint_alignment_below_gate");
    }
    for (const bucket of ["aggregate", "front_oblique_left", "front_oblique_right"] as const) {
      const comparison = untouched.metricsByBucket[bucket];
      if (!comparison) {
        blockers.push(`untouched_${bucket}_metrics_missing`);
        continue;
      }
      if (!validProfileMetrics(comparison.candidate)) {
        blockers.push(`untouched_${bucket}_candidate_metrics_invalid`);
        continue;
      }
      if (!validProfileMetrics(comparison.stable)) {
        blockers.push(`untouched_${bucket}_stable_metrics_invalid`);
        continue;
      }
      for (const [field, code] of [
        ["repPrecision", "rep_precision"],
        ["repRecall", "rep_recall"],
        ["fullEndpointAlignment", "full_endpoint_alignment"],
        ["exactSetRate", "exact_set_rate"],
      ] as const) {
        if (comparison.candidate[field] < comparison.stable[field]) {
          blockers.push(`untouched_${bucket}_${code}_regressed`);
        }
      }
    }
    if (untouched.coverage.denominatorPolicy !== "all_candidates_including_abstentions_and_rejections") {
      blockers.push("coverage_denominator_excludes_abstentions_or_rejections");
    }
    for (const bucket of manifest.gate.requiredCoverageBuckets) {
      if (!untouched.coverage.includedBuckets.includes(bucket)) {
        blockers.push(`coverage_bucket_missing:${bucket}`);
      } else if (!untouched.coverage.sampleCountByBucket[bucket]) {
        blockers.push(`coverage_bucket_empty:${bucket}`);
      }
    }
  } else if (untouched?.sha256 === manifest.evidence.untouchedAcceptance.sha256) {
    blockers.push("untouched_acceptance_evidence_invalid");
  }
  const touched = evidenceStore[manifest.evidence.touchedRegression.sha256];
  if (touched?.schemaVersion === "maxpower-bench-profile-comparison/v1") {
    if (touched.runKind !== "touched_benchmark") blockers.push("touched_regression_run_kind_invalid");
    if (touched.candidateProfileSha256 !== manifest.candidateProfile.sha256) {
      blockers.push("touched_regression_candidate_profile_mismatch");
    }
    if (touched.stableProfileSha256 !== manifest.stableProfile.sha256) {
      blockers.push("touched_regression_stable_profile_mismatch");
    }
    if (touched.coordinateContractSha256 !== manifest.coordinateContract.sha256) {
      blockers.push("touched_regression_coordinate_contract_mismatch");
    }
    if (touched.preregistrationSha256 !== manifest.evidence.preregistration.sha256) {
      blockers.push("touched_regression_preregistration_mismatch");
    }
    for (const bucket of ["aggregate", "front_oblique_left", "front_oblique_right"] as const) {
      const comparison = touched.metricsByBucket[bucket];
      if (!comparison) {
        blockers.push(`touched_${bucket}_metrics_missing`);
        continue;
      }
      if (!validProfileMetrics(comparison.candidate) || !validProfileMetrics(comparison.stable)) {
        blockers.push(`touched_${bucket}_metrics_invalid`);
        continue;
      }
      for (const [field, code] of [
        ["repPrecision", "rep_precision"],
        ["repRecall", "rep_recall"],
        ["fullEndpointAlignment", "full_endpoint_alignment"],
        ["exactSetRate", "exact_set_rate"],
      ] as const) {
        if (comparison.candidate[field] < comparison.stable[field]) {
          blockers.push(`touched_${bucket}_${code}_regressed`);
        }
      }
    }
  } else if (touched?.sha256 === manifest.evidence.touchedRegression.sha256) {
    blockers.push("touched_regression_evidence_invalid");
  }
  const crossView = evidenceStore[manifest.evidence.synchronizedCrossView.sha256];
  if (crossView?.schemaVersion === "maxpower-bench-cross-view-validation/v1") {
    if (crossView.runKind !== "synchronized_cross_view_validation") {
      blockers.push("cross_view_run_kind_invalid");
    }
    if (crossView.candidateProfileSha256 !== manifest.candidateProfile.sha256) {
      blockers.push("cross_view_candidate_profile_mismatch");
    }
    if (crossView.coordinateContractSha256 !== manifest.coordinateContract.sha256) {
      blockers.push("cross_view_coordinate_contract_mismatch");
    }
    if (crossView.preregistrationSha256 !== manifest.evidence.preregistration.sha256) {
      blockers.push("cross_view_preregistration_mismatch");
    }
    if (!crossView.frozenBeforeTruthReveal) blockers.push("cross_view_not_frozen_before_truth");
    const aggregate = crossView.disagreementByBucket.aggregate;
    if (!aggregate || !(aggregate.normalized < aggregate.rawScreenY)) {
      blockers.push("normalized_aggregate_not_strictly_improved");
    }
    const left = crossView.disagreementByBucket.front_oblique_left;
    const right = crossView.disagreementByBucket.front_oblique_right;
    const actualWorst = left && right
      ? (left.normalized >= right.normalized ? "front_oblique_left" : "front_oblique_right")
      : null;
    if (!actualWorst || crossView.worstObliqueBucket !== actualWorst) {
      blockers.push("cross_view_worst_oblique_bucket_mismatch");
    }
    const worst = crossView.disagreementByBucket[crossView.worstObliqueBucket];
    if (!worst || !(worst.normalized < worst.rawScreenY)) {
      blockers.push("normalized_worst_oblique_not_strictly_improved");
    }
  } else if (crossView?.sha256 === manifest.evidence.synchronizedCrossView.sha256) {
    blockers.push("cross_view_evidence_invalid");
  }
  const parity = evidenceStore[manifest.evidence.runtimeParity.sha256];
  if (parity?.schemaVersion === "maxpower-bench-runtime-parity/v1") {
    if (parity.candidateProfileSha256 !== manifest.candidateProfile.sha256) {
      blockers.push("runtime_parity_candidate_profile_mismatch");
    }
    if (parity.coordinateContractSha256 !== manifest.coordinateContract.sha256) {
      blockers.push("runtime_parity_coordinate_contract_mismatch");
    }
    if (parity.status !== "passed") blockers.push("runtime_parity_not_passed");
    for (const platform of manifest.gate.requiredRuntimePlatforms) {
      if (parity.platforms[platform] !== "passed") {
        blockers.push(`runtime_parity_platform_not_passed:${platform}`);
      }
    }
    if (!parity.discreteSemanticsMatch) blockers.push("runtime_parity_discrete_semantics_mismatch");
    if (!parity.timestampsMatch) blockers.push("runtime_parity_timestamp_mismatch");
    if (!parity.provenanceAndReasonsMatch) blockers.push("runtime_parity_provenance_or_reason_mismatch");
    if (!parity.normalizedFloatsWithinTolerance) blockers.push("runtime_parity_float_tolerance_failed");
  } else if (parity?.sha256 === manifest.evidence.runtimeParity.sha256) {
    blockers.push("runtime_parity_evidence_invalid");
  }
  const performance = evidenceStore[manifest.evidence.runtimePerformance.sha256];
  if (performance?.schemaVersion === "maxpower-bench-runtime-performance/v1") {
    if (performance.candidateProfileSha256 !== manifest.candidateProfile.sha256) {
      blockers.push("runtime_performance_candidate_profile_mismatch");
    }
    if (performance.coordinateContractSha256 !== manifest.coordinateContract.sha256) {
      blockers.push("runtime_performance_coordinate_contract_mismatch");
    }
    if (performance.status !== "passed") blockers.push("runtime_performance_not_passed");
    for (const platform of manifest.gate.requiredRuntimePlatforms) {
      const result = performance.platforms[platform];
      if (!result || result.status !== "passed") {
        blockers.push(`runtime_performance_platform_not_passed:${platform}`);
      }
      if (!result?.singlePassCausal) {
        blockers.push(`runtime_performance_not_single_pass_causal:${platform}`);
      }
      if (!result?.boundedLatestFrame) {
        blockers.push(`runtime_performance_unbounded_backlog:${platform}`);
      }
    }
  } else if (performance?.sha256 === manifest.evidence.runtimePerformance.sha256) {
    blockers.push("runtime_performance_evidence_invalid");
  }
  return {
    status: blockers.length === 0 ? "eligible_for_manual_promotion" : "shadow_only",
    candidateProfile: manifest.candidateProfile,
    blockerCodes: blockers,
    evidenceRefs: refs.map((ref) => ref.sha256),
  };
}

function sameGate(left: BenchPromotionGate, right: BenchPromotionGate): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.repPrecisionMinimum === right.repPrecisionMinimum
    && left.repRecallMinimum === right.repRecallMinimum
    && left.fullEndpointAlignmentMinimum === right.fullEndpointAlignmentMinimum
    && left.endpointToleranceMs === right.endpointToleranceMs
    && left.requireNoRegression === right.requireNoRegression
    && left.requireStrictNormalizedImprovement === right.requireStrictNormalizedImprovement
    && sameStringSet(left.requiredCoverageBuckets, right.requiredCoverageBuckets)
    && sameStringSet(left.requiredRuntimePlatforms, right.requiredRuntimePlatforms);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validProfileMetrics(metrics: ProfileMetrics): boolean {
  return isUnitInterval(metrics.repPrecision)
    && isUnitInterval(metrics.repRecall)
    && isUnitInterval(metrics.fullEndpointAlignment)
    && isUnitInterval(metrics.exactSetRate);
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
