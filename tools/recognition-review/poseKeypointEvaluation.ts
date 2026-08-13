import type {
  PoseJointTruth,
  PoseKeypointAcceptance,
  PoseKeypointEvaluationDataset,
  PoseKeypointEvaluationExample,
  PoseModelPoint,
} from "./poseKeypointReview";

export type PoseKeypointEvaluationStatus =
  | "blocked_incomplete_human_truth"
  | "blocked_insufficient_pck_evidence"
  | "fail"
  | "research_pass_single_person_only"
  | "pass";

interface RateMetric {
  readonly numerator: number;
  readonly denominator: number;
  readonly rate: number | null;
}

interface PoseLayerMetric {
  readonly finiteOrRenderable: RateMetric;
  readonly pckAtThreshold: RateMetric;
}

interface RustLayerMetric extends PoseLayerMetric {
  readonly usableJointFrameRate: RateMetric;
  readonly sourceCounts: Readonly<Record<string, number>>;
}

export interface PoseJointMetric {
  readonly index: number;
  readonly name: string;
  readonly visibleTruthFrameCount: number;
  readonly rawRtmpose: PoseLayerMetric;
  readonly rustCanonical: RustLayerMetric;
  readonly falseMeasuredOverclaim: RateMetric;
}

export interface PoseMetricSlice {
  readonly frameCount: number;
  readonly scorableTorsoFrameCount: number;
  readonly visibleTruthJointFrameCount: number;
  readonly occludedOrAmbiguousTruthJointFrameCount: number;
  readonly rawRtmpose: PoseLayerMetric;
  readonly rustCanonical: RustLayerMetric;
  readonly falseMeasuredOverclaim: RateMetric;
}

export interface PoseKeypointEvaluationReport {
  readonly schemaVersion: "maxpower-personal-pose-keypoint-evaluation/v1";
  readonly status: PoseKeypointEvaluationStatus;
  readonly researchMetricPass: boolean;
  readonly acceptanceEligible: boolean;
  readonly productionPromotion: false;
  readonly queueSha256: string;
  readonly split: "test";
  readonly trainerReadable: false;
  readonly modelFreeze: Readonly<Record<string, string>>;
  readonly thresholds: PoseKeypointAcceptance;
  readonly stats: {
    readonly queueItemCount: number;
    readonly humanReviewedItemCount: number;
    readonly disagreementCount: number;
    readonly exactContextCount: number;
    readonly minimumExactContextFrameCount: number;
    readonly sourceCaptureCount: number;
  };
  readonly metrics: PoseMetricSlice;
  readonly byJoint: readonly PoseJointMetric[];
  readonly bySourceCapture: Readonly<Record<string, PoseMetricSlice>>;
  readonly metricFailures: readonly string[];
  readonly blockedReasons: readonly string[];
  readonly interpretation: {
    readonly rawRtmpose: "diagnostic_only_not_canonical_output";
    readonly rustCanonical: "acceptance_target";
    readonly missingPredictionPolicy: "visible_truth_without_renderable_prediction_counts_as_pck_miss";
    readonly equipmentBoundary: "equipment_may_assist_phase_but_cannot_become_measured_human_keypoint_truth";
    readonly provisionalWhenIncomplete: true;
  };
}

interface JointAccumulator {
  visibleTruth: number;
  pckDenominator: number;
  rawFinite: number;
  rawPckCorrect: number;
  rustRenderable: number;
  rustUsable: number;
  rustPckCorrect: number;
  overclaimDenominator: number;
  overclaimNumerator: number;
  sourceCounts: Record<string, number>;
}

export function evaluatePoseKeypoints(dataset: PoseKeypointEvaluationDataset): PoseKeypointEvaluationReport {
  assertDataset(dataset);
  const contexts = countBy(dataset.examples.map(exactContextKey));
  const metricsWithJoints = computeSlice(dataset.examples, dataset.requiredJoints, dataset.acceptance.pckThresholdTorsoRatio);
  const bySourceCapture = Object.fromEntries(
    [...new Set(dataset.examples.map((example) => example.sourceCaptureId))]
      .sort()
      .map((sourceCaptureId) => [
        sourceCaptureId,
        computeSlice(
          dataset.examples.filter((example) => example.sourceCaptureId === sourceCaptureId),
          dataset.requiredJoints,
          dataset.acceptance.pckThresholdTorsoRatio,
        ).slice,
      ]),
  );
  const minimumExactContextFrameCount = contexts.size ? Math.min(...contexts.values()) : 0;
  const incompleteReasons = [
    ...(dataset.status !== "research_evaluable" ? ["evaluation_dataset_not_research_evaluable"] : []),
    ...(dataset.stats.eligibleItemCount !== dataset.stats.queueItemCount ? ["not_all_frozen_pose_frames_have_consensus_truth"] : []),
    ...(dataset.stats.disagreementCount ? ["pose_keypoint_review_disagreement"] : []),
  ];
  const evidenceReasons = [
    ...(minimumExactContextFrameCount < dataset.acceptance.minimumHumanKeypointFramesPerExactContext
      ? ["insufficient_human_keypoint_frames_per_exact_context"] : []),
    ...(metricsWithJoints.slice.scorableTorsoFrameCount < dataset.acceptance.minimumHumanKeypointFramesPerExactContext
      ? ["insufficient_torso_scaled_frames_for_pck"] : []),
  ];
  const rustPck = metricsWithJoints.slice.rustCanonical.pckAtThreshold.rate;
  const rustUsable = metricsWithJoints.slice.rustCanonical.usableJointFrameRate.rate;
  const overclaim = metricsWithJoints.slice.falseMeasuredOverclaim.rate;
  const minimumJointPck = minimumDefined(metricsWithJoints.byJoint.map((joint) => joint.rustCanonical.pckAtThreshold.rate));
  const minimumJointUsable = minimumDefined(metricsWithJoints.byJoint.map((joint) => joint.rustCanonical.usableJointFrameRate.rate));
  const computedMetricFailures = [
    ...(rustPck === null || rustPck < dataset.acceptance.requiredJointPckMinimum ? ["rust_required_joint_pck_below_minimum"] : []),
    ...(minimumJointPck === null || minimumJointPck < dataset.acceptance.requiredJointPckMinimum ? ["rust_per_joint_pck_below_minimum"] : []),
    ...(rustUsable === null || rustUsable < dataset.acceptance.requiredJointUsableFrameRateMinimum ? ["rust_required_joint_usable_frame_rate_below_minimum"] : []),
    ...(minimumJointUsable === null || minimumJointUsable < dataset.acceptance.requiredJointUsableFrameRateMinimum ? ["rust_per_joint_usable_frame_rate_below_minimum"] : []),
    ...(overclaim === null || overclaim > dataset.acceptance.occludedOrAmbiguousMeasuredOverclaimMaximum
      ? ["rust_false_measured_overclaim_above_maximum"] : []),
  ];
  const metricFailures = incompleteReasons.length || evidenceReasons.length ? [] : computedMetricFailures;
  const researchMetricPass = incompleteReasons.length === 0 && evidenceReasons.length === 0 && computedMetricFailures.length === 0;
  const singlePersonOnly = dataset.blockedReasons.includes("single_known_person_cannot_prove_cross_user_pose_generalization");
  const status: PoseKeypointEvaluationStatus = incompleteReasons.length
    ? "blocked_incomplete_human_truth"
    : evidenceReasons.length
      ? "blocked_insufficient_pck_evidence"
      : computedMetricFailures.length
        ? "fail"
        : singlePersonOnly
          ? "research_pass_single_person_only"
          : "pass";
  return {
    schemaVersion: "maxpower-personal-pose-keypoint-evaluation/v1",
    status,
    researchMetricPass,
    acceptanceEligible: status === "pass",
    productionPromotion: false,
    queueSha256: dataset.queueSha256,
    split: "test",
    trainerReadable: false,
    modelFreeze: dataset.modelFreeze,
    thresholds: dataset.acceptance,
    stats: {
      queueItemCount: dataset.stats.queueItemCount,
      humanReviewedItemCount: dataset.stats.eligibleItemCount,
      disagreementCount: dataset.stats.disagreementCount,
      exactContextCount: contexts.size,
      minimumExactContextFrameCount,
      sourceCaptureCount: new Set(dataset.examples.map((example) => example.sourceCaptureId)).size,
    },
    metrics: metricsWithJoints.slice,
    byJoint: metricsWithJoints.byJoint,
    bySourceCapture,
    metricFailures,
    blockedReasons: [...new Set([...dataset.blockedReasons, ...incompleteReasons, ...evidenceReasons])].sort(),
    interpretation: {
      rawRtmpose: "diagnostic_only_not_canonical_output",
      rustCanonical: "acceptance_target",
      missingPredictionPolicy: "visible_truth_without_renderable_prediction_counts_as_pck_miss",
      equipmentBoundary: "equipment_may_assist_phase_but_cannot_become_measured_human_keypoint_truth",
      provisionalWhenIncomplete: true,
    },
  };
}

function computeSlice(
  examples: readonly PoseKeypointEvaluationExample[],
  requiredJoints: PoseKeypointEvaluationDataset["requiredJoints"],
  threshold: number,
): { slice: PoseMetricSlice; byJoint: PoseJointMetric[] } {
  const accumulators = new Map<number, JointAccumulator>(requiredJoints.map((joint) => [joint.index, {
    visibleTruth: 0,
    pckDenominator: 0,
    rawFinite: 0,
    rawPckCorrect: 0,
    rustRenderable: 0,
    rustUsable: 0,
    rustPckCorrect: 0,
    overclaimDenominator: 0,
    overclaimNumerator: 0,
    sourceCounts: {},
  }]));
  let scorableTorsoFrameCount = 0;
  for (const example of examples) {
    const truth = new Map(example.joints.map((point) => [point.index, point]));
    const raw = new Map(example.rawRtmpose.requiredJoints.map((point) => [point.index, point]));
    const rust = new Map(example.rustCanonical.requiredJoints.map((point) => [point.index, point]));
    const torsoLength = torsoScale(truth);
    if (torsoLength !== null) scorableTorsoFrameCount += 1;
    for (const requiredJoint of requiredJoints) {
      const truthPoint = truth.get(requiredJoint.index)!;
      const rawPoint = raw.get(requiredJoint.index)!;
      const rustPoint = rust.get(requiredJoint.index)!;
      const accumulator = accumulators.get(requiredJoint.index)!;
      if (truthPoint.status === "visible") {
        accumulator.visibleTruth += 1;
        if (finitePoint(rawPoint)) accumulator.rawFinite += 1;
        if (finitePoint(rustPoint) && rustPoint.renderable === true) accumulator.rustRenderable += 1;
        if (finitePoint(rustPoint) && rustPoint.usable === true) accumulator.rustUsable += 1;
        accumulator.sourceCounts[rustPoint.source ?? "missing"] = (accumulator.sourceCounts[rustPoint.source ?? "missing"] ?? 0) + 1;
        if (torsoLength !== null) {
          accumulator.pckDenominator += 1;
          if (finitePoint(rawPoint) && normalizedDistance(rawPoint, truthPoint, torsoLength) <= threshold) accumulator.rawPckCorrect += 1;
          if (
            finitePoint(rustPoint) && rustPoint.renderable === true
            && normalizedDistance(rustPoint, truthPoint, torsoLength) <= threshold
          ) accumulator.rustPckCorrect += 1;
        }
      } else if (truthPoint.status === "occluded" || truthPoint.status === "ambiguous") {
        accumulator.overclaimDenominator += 1;
        if (finitePoint(rustPoint) && rustPoint.source === "measured" && rustPoint.usable === true) accumulator.overclaimNumerator += 1;
      }
    }
  }
  const byJoint = requiredJoints.map((joint): PoseJointMetric => jointMetric(joint, accumulators.get(joint.index)!));
  const total = sumAccumulators([...accumulators.values()]);
  return {
    slice: {
      frameCount: examples.length,
      scorableTorsoFrameCount,
      visibleTruthJointFrameCount: total.visibleTruth,
      occludedOrAmbiguousTruthJointFrameCount: total.overclaimDenominator,
      rawRtmpose: layerMetric(total.rawFinite, total.rawPckCorrect, total.visibleTruth, total.pckDenominator),
      rustCanonical: rustLayerMetric(total, total.visibleTruth, total.pckDenominator),
      falseMeasuredOverclaim: rate(total.overclaimNumerator, total.overclaimDenominator),
    },
    byJoint,
  };
}

function jointMetric(joint: { readonly index: number; readonly name: string }, value: JointAccumulator): PoseJointMetric {
  return {
    index: joint.index,
    name: joint.name,
    visibleTruthFrameCount: value.visibleTruth,
    rawRtmpose: layerMetric(value.rawFinite, value.rawPckCorrect, value.visibleTruth, value.pckDenominator),
    rustCanonical: rustLayerMetric(value, value.visibleTruth, value.pckDenominator),
    falseMeasuredOverclaim: rate(value.overclaimNumerator, value.overclaimDenominator),
  };
}

function layerMetric(finite: number, correct: number, visible: number, pckDenominator: number): PoseLayerMetric {
  return {
    finiteOrRenderable: rate(finite, visible),
    pckAtThreshold: rate(correct, pckDenominator),
  };
}

function rustLayerMetric(value: JointAccumulator, visible: number, pckDenominator: number): RustLayerMetric {
  return {
    finiteOrRenderable: rate(value.rustRenderable, visible),
    usableJointFrameRate: rate(value.rustUsable, visible),
    pckAtThreshold: rate(value.rustPckCorrect, pckDenominator),
    sourceCounts: Object.fromEntries(Object.entries(value.sourceCounts).sort(([left], [right]) => left.localeCompare(right))),
  };
}

function sumAccumulators(values: readonly JointAccumulator[]): JointAccumulator {
  const result: JointAccumulator = {
    visibleTruth: 0, pckDenominator: 0, rawFinite: 0, rawPckCorrect: 0,
    rustRenderable: 0, rustUsable: 0, rustPckCorrect: 0,
    overclaimDenominator: 0, overclaimNumerator: 0, sourceCounts: {},
  };
  for (const value of values) {
    result.visibleTruth += value.visibleTruth;
    result.pckDenominator += value.pckDenominator;
    result.rawFinite += value.rawFinite;
    result.rawPckCorrect += value.rawPckCorrect;
    result.rustRenderable += value.rustRenderable;
    result.rustUsable += value.rustUsable;
    result.rustPckCorrect += value.rustPckCorrect;
    result.overclaimDenominator += value.overclaimDenominator;
    result.overclaimNumerator += value.overclaimNumerator;
    for (const [source, count] of Object.entries(value.sourceCounts)) result.sourceCounts[source] = (result.sourceCounts[source] ?? 0) + count;
  }
  return result;
}

function torsoScale(points: ReadonlyMap<number, PoseJointTruth>): number | null {
  const leftShoulder = points.get(5), rightShoulder = points.get(6), leftHip = points.get(11), rightHip = points.get(12);
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every((point) => point?.status === "visible" && finitePoint(point))) return null;
  const shoulderX = (leftShoulder!.x! + rightShoulder!.x!) / 2;
  const shoulderY = (leftShoulder!.y! + rightShoulder!.y!) / 2;
  const hipX = (leftHip!.x! + rightHip!.x!) / 2;
  const hipY = (leftHip!.y! + rightHip!.y!) / 2;
  const distance = Math.hypot(shoulderX - hipX, shoulderY - hipY);
  return distance > 1e-6 ? distance : null;
}

function normalizedDistance(model: PoseModelPoint, truth: PoseJointTruth, scale: number): number {
  return Math.hypot(model.x! - truth.x!, model.y! - truth.y!) / scale;
}

function finitePoint(point: { readonly x: number | null; readonly y: number | null } | undefined): point is { readonly x: number; readonly y: number } {
  return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}

function rate(numerator: number, denominator: number): RateMetric {
  return { numerator, denominator, rate: denominator ? numerator / denominator : null };
}

function exactContextKey(example: PoseKeypointEvaluationExample): string {
  return [example.exerciseId, example.capturePosition, example.equipmentContext, example.mirrorPresent ? "mirror" : "no_mirror"].join("|");
}

function countBy(values: readonly string[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function minimumDefined(values: readonly (number | null)[]): number | null {
  return values.every((value) => value !== null) && values.length ? Math.min(...(values as number[])) : null;
}

function assertDataset(dataset: PoseKeypointEvaluationDataset): void {
  if (
    dataset.schemaVersion !== "maxpower-personal-pose-keypoint-evaluation-dataset/v1"
    || dataset.split !== "test"
    || dataset.trainerReadable !== false
    || dataset.productionPromotion !== false
    || !/^[a-f0-9]{64}$/.test(dataset.queueSha256)
    || dataset.requiredJoints.length !== 8
  ) throw new Error("unsupported pose keypoint evaluation dataset");
  const expected = dataset.requiredJoints.map((joint) => `${joint.index}:${joint.name}`).join("|");
  for (const example of dataset.examples) {
    if (example.split !== "test" || example.humanTruth !== true || example.trainerReadable !== false) throw new Error("pose evaluation supervision changed");
    const truth = example.joints.map((joint) => `${joint.index}:${joint.name}`).join("|");
    const raw = example.rawRtmpose.requiredJoints.map((joint) => `${joint.index}:${joint.name}`).join("|");
    const rust = example.rustCanonical.requiredJoints.map((joint) => `${joint.index}:${joint.name}`).join("|");
    if (truth !== expected || raw !== expected || rust !== expected) throw new Error("pose evaluation topology changed");
  }
}
