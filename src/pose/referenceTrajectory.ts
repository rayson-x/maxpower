import type { PoseEstimate, PoseLandmark } from "./PoseEngine";
import type { CapturePosition } from "./viewGating";

export const PROVISIONAL_REFERENCE_REP_SCHEMA =
  "form-coach-provisional-reference-rep/v1" as const;
export const PROVISIONAL_REFERENCE_PROFILE_SCHEMA =
  "form-coach-provisional-reference-profile/v1" as const;

export const LAT_PULLDOWN_REFERENCE_FEATURES = [
  "leftWristHeight",
  "rightWristHeight",
  "leftElbowAngleDeg",
  "rightElbowAngleDeg",
  "leftUpperArmToTorsoDeg",
  "rightUpperArmToTorsoDeg",
  "leftWristLateral",
  "rightWristLateral",
  "bilateralWristHeightDelta",
  "torsoLateralShift",
  "torsoLateralTiltDeg",
] as const;

export type LatPulldownReferenceFeature =
  (typeof LAT_PULLDOWN_REFERENCE_FEATURES)[number];

/** Quality-card groupings are part of the fixed high-lat-pulldown feature schema. */
export const LAT_PULLDOWN_QUALITY_FEATURE_GROUPS = {
  trajectoryPath: [
    "leftWristHeight",
    "rightWristHeight",
    "leftElbowAngleDeg",
    "rightElbowAngleDeg",
  ],
  torsoStability: ["torsoLateralShift", "torsoLateralTiltDeg"],
} as const satisfies Record<string, readonly LatPulldownReferenceFeature[]>;

export type ReferenceSourceStatus =
  | "human_edited_draft"
  | "human_approved_segmentation"
  | "expert_approved_reference";

export interface ReferenceProfileContext {
  variation: string;
  trainingSide: "bilateral" | "left" | "right" | "alternating" | "unrecorded";
  equipment: string;
  coordinateSystem: "source-image/v1";
  poseModelVersion: string;
}

export interface ReferenceTrajectorySegment {
  repIndex: number;
  startMs: number;
  peakMs: number;
  endMs: number;
}

export interface NormalizedReferenceNode {
  nodeIndex: number;
  phase: "pull" | "return";
  phasePercent: number;
  targetTimestampMs: number;
  sourceTimestampMs: number | null;
  values: Array<number | null>;
  confidence: number[];
}

export interface BiomechanicalScreening {
  status:
    | "biomechanically_compatible_candidate"
    | "biomechanically_incompatible_candidate"
    | "unknown";
  /** Directional movement evidence only; never a medical or injury judgment. */
  evidenceStatus: "inferred";
  supportingSignals: string[];
  contradictingSignals: string[];
  limitations: string[];
}

export interface NormalizedLatPulldownReferenceRep {
  schemaVersion: typeof PROVISIONAL_REFERENCE_REP_SCHEMA;
  exerciseId: "lat_pulldown";
  captureId: string;
  capturePosition: CapturePosition;
  sourceStatus: ReferenceSourceStatus;
  profileContext: ReferenceProfileContext;
  segment: ReferenceTrajectorySegment;
  featureNames: readonly LatPulldownReferenceFeature[];
  nodes: NormalizedReferenceNode[];
  featureCoverage: Record<LatPulldownReferenceFeature, number>;
  rawTiming: {
    pullMs: number;
    returnMs: number;
    totalMs: number;
  };
  screening: BiomechanicalScreening;
}

export type ExtractNormalizedReferenceRepResult =
  | { status: "ready"; rep: NormalizedLatPulldownReferenceRep }
  | { status: "rejected"; reason: string };

export interface ExtractNormalizedLatPulldownRepInput {
  captureId: string;
  capturePosition: CapturePosition;
  sourceStatus: ReferenceSourceStatus;
  profileContext: ReferenceProfileContext;
  segment: ReferenceTrajectorySegment;
  poses: readonly PoseEstimate[];
  visibilityThreshold?: number;
  maximumSourceFrameDistanceMs?: number;
}

export interface PersonalReferenceIdentity {
  variation: string;
  trainingSide: "bilateral" | "left" | "right" | "alternating" | "unrecorded";
  equipment: string;
  coordinateSystem: "source-image/v1";
}

export interface ReferenceCorridorPoint {
  nObserved: number;
  nSessionsObserved: null;
  median: number | null;
  qLow: number | null;
  qHigh: number | null;
  medianAbsoluteDeviation: number | null;
  medianConfidence: number | null;
  coverageRate: number;
  evidenceStatus: "hypothesis";
}

export interface ReferenceCorridorNode {
  nodeIndex: number;
  phase: "pull" | "return";
  phasePercent: number;
  features: ReferenceCorridorPoint[];
}

export interface PersonalProvisionalReferenceProfile {
  schemaVersion: typeof PROVISIONAL_REFERENCE_PROFILE_SCHEMA;
  profileStatus: "personal_provisional_unreviewed" | "personal_provisional_expert_reviewed";
  identity: PersonalReferenceIdentity & {
    exerciseId: "lat_pulldown";
    capturePosition: CapturePosition;
    featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2";
    poseModelVersion: string;
  };
  intendedUse: "compare_observed_reps_to_personal_provisional_corridor";
  prohibitedUses: readonly string[];
  phaseModel: {
    normalization: "piecewise_linear_start_bottom_end";
    pullNodes: 16;
    returnNodes: 16;
    unrestrictedDtwAllowed: false;
    retainRawTiming: true;
  };
  featureNames: readonly LatPulldownReferenceFeature[];
  referencePopulation: {
    participantCount: 1;
    sessionCount: null;
    captureCount: number;
    repCount: number;
    sourceStatuses: ReferenceSourceStatus[];
    evidenceStatus: "hypothesis";
  };
  screeningSummary: {
    acceptedCandidateReps: number;
    incompatibleCandidateReps: number;
    unknownCandidateReps: number;
  };
  corridor: {
    method: "pointwise_median_empirical_q10_q90";
    nodes: ReferenceCorridorNode[];
    evidenceStatus: "hypothesis";
  };
  matchingPolicy: {
    minimumPointObservations: null;
    minimumComparableNodeRatio: null;
    sustainedOutsideNodes: null;
    maximumOutsideNodeRatio: null;
    minimumObservationConfidence: 0.5;
    unrestrictedDtwAllowed: false;
    decisionThresholdsCalibrated: false;
    evidenceStatus: "hypothesis";
  };
  provenance: {
    captureIds: string[];
    repIds: string[];
    generatedAt: string | null;
    notes: string[];
  };
}

export interface BuildPersonalProvisionalReferenceInput {
  capturePosition: CapturePosition;
  reps: readonly NormalizedLatPulldownReferenceRep[];
  identity: PersonalReferenceIdentity;
  generatedAt?: string | null;
}

export type BuildPersonalProvisionalReferenceResult =
  | { status: "ready"; profile: PersonalProvisionalReferenceProfile }
  | { status: "rejected"; reason: string };

export interface TrajectoryNodeComparison {
  nodeIndex: number;
  phase: "pull" | "return";
  status: "within_observed_band" | "outside_observed_band" | "unknown";
  value: number | null;
  qLow: number | null;
  qHigh: number | null;
  confidence: number;
  normalizedExcess: number | null;
}

export interface TrajectoryFeatureMatch {
  feature: LatPulldownReferenceFeature;
  status: "compared" | "unknown";
  comparableNodeCount: number;
  comparableNodeRatio: number;
  outsideNodeCount: number;
  outsideNodeRatio: number | null;
  maximumConsecutiveOutsideNodes: number;
  nodes: TrajectoryNodeComparison[];
  unknownReason: string | null;
}

export interface TrajectoryMatchResult {
  status:
    | "comparison_available"
    | "insufficient_observation"
    | "profile_mismatch";
  profileStatus: PersonalProvisionalReferenceProfile["profileStatus"];
  evidenceStatus: "hypothesis";
  calibrationStatus: "uncalibrated";
  qualityVerdict: null;
  features: TrajectoryFeatureMatch[];
  comparableFeatureCount: number;
  limitations: string[];
  mismatchReason: string | null;
}

const PULL_NODES = 16;
const RETURN_NODES = 16;
const DEFAULT_VISIBILITY_THRESHOLD = 0.5;
const DEFAULT_MAXIMUM_SOURCE_FRAME_DISTANCE_MS = 180;

interface FeatureVector {
  values: Array<number | null>;
  confidence: number[];
  torsoCenterX: number | null;
  torsoScale: number | null;
}

/**
 * Converts one manually segmented rep into a fixed 16-node pull + 16-node
 * return observation. Sampling never crosses the approved bottom event and
 * never invents an occluded joint: every feature carries its own null value.
 */
export function extractNormalizedLatPulldownRep(
  input: ExtractNormalizedLatPulldownRepInput,
): ExtractNormalizedReferenceRepResult {
  const { segment, poses } = input;
  if (
    !Number.isFinite(segment.startMs) ||
    !Number.isFinite(segment.peakMs) ||
    !Number.isFinite(segment.endMs) ||
    segment.startMs >= segment.peakMs ||
    segment.peakMs >= segment.endMs
  ) {
    return { status: "rejected", reason: "start / bottom / end 必须严格递增。" };
  }
  if (poses.length < 2) {
    return { status: "rejected", reason: "关键点帧不足，无法生成轨迹。" };
  }
  if (poses.some((pose, index) => index > 0 && pose.timestampMs < poses[index - 1].timestampMs)) {
    return { status: "rejected", reason: "关键点时间序列没有按时间排序。" };
  }
  if (segment.startMs < poses[0].timestampMs || segment.endMs > poses[poses.length - 1].timestampMs) {
    return { status: "rejected", reason: "动作边界超出关键点时间范围。" };
  }

  const visibilityThreshold = input.visibilityThreshold ?? DEFAULT_VISIBILITY_THRESHOLD;
  const maximumDistance =
    input.maximumSourceFrameDistanceMs ?? DEFAULT_MAXIMUM_SOURCE_FRAME_DISTANCE_MS;
  const targets = [
    ...phaseTargets(segment.startMs, segment.peakMs, PULL_NODES, "pull"),
    ...phaseTargets(segment.peakMs, segment.endMs, RETURN_NODES, "return"),
  ];
  const vectors: FeatureVector[] = [];
  const nodes = targets.map((target, nodeIndex): NormalizedReferenceNode => {
    const nearest = nearestPose(poses, target.timestampMs);
    const sourceObserved = nearest.distanceMs <= maximumDistance;
    const vector = sourceObserved
      ? featureVector(nearest.pose, visibilityThreshold)
      : emptyFeatureVector();
    vectors.push(vector);
    return {
      nodeIndex,
      phase: target.phase,
      phasePercent: target.phasePercent,
      targetTimestampMs: round(target.timestampMs),
      sourceTimestampMs: sourceObserved ? nearest.pose.timestampMs : null,
      values: [...vector.values],
      confidence: [...vector.confidence],
    };
  });

  // Lateral translation is only meaningful relative to the rep's own start;
  // absolute image x would make camera framing look like body movement.
  const torsoShiftIndex = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("torsoLateralShift");
  const baselineTorso = vectors.find(
    (vector) => vector.torsoCenterX !== null && vector.torsoScale !== null,
  );
  nodes.forEach((node, index) => {
    const current = vectors[index].torsoCenterX;
    node.values[torsoShiftIndex] =
      current !== null && baselineTorso?.torsoCenterX !== null && baselineTorso?.torsoScale
      ? round((current - baselineTorso.torsoCenterX) / baselineTorso.torsoScale)
      : null;
    node.confidence[torsoShiftIndex] = node.values[torsoShiftIndex] === null
      ? 0
      : vectors[index].confidence[LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("torsoLateralTiltDeg")];
  });

  const featureCoverage = Object.fromEntries(
    LAT_PULLDOWN_REFERENCE_FEATURES.map((feature, featureIndex) => [
      feature,
      round(nodes.filter((node) => node.values[featureIndex] !== null).length / nodes.length),
    ]),
  ) as Record<LatPulldownReferenceFeature, number>;
  const rep: NormalizedLatPulldownReferenceRep = {
    schemaVersion: PROVISIONAL_REFERENCE_REP_SCHEMA,
    exerciseId: "lat_pulldown",
    captureId: input.captureId,
    capturePosition: input.capturePosition,
    sourceStatus: input.sourceStatus,
    profileContext: { ...input.profileContext },
    segment: { ...segment },
    featureNames: [...LAT_PULLDOWN_REFERENCE_FEATURES],
    nodes,
    featureCoverage,
    rawTiming: {
      pullMs: segment.peakMs - segment.startMs,
      returnMs: segment.endMs - segment.peakMs,
      totalMs: segment.endMs - segment.startMs,
    },
    screening: screenBiomechanicalCompatibility(nodes),
  };
  return { status: "ready", rep };
}

/**
 * Builds a descriptive personal corridor from phase-compatible candidates.
 * The empirical q10/q90 band is intentionally labeled hypothesis: one athlete
 * and one environment cannot estimate population-level acceptable variation.
 */
export function buildPersonalProvisionalReference(
  input: BuildPersonalProvisionalReferenceInput,
): BuildPersonalProvisionalReferenceResult {
  if (input.reps.length === 0) {
    return { status: "rejected", reason: "没有可用于生成个人 provisional reference 的 rep。" };
  }
  if (input.reps.some((rep) => rep.capturePosition !== input.capturePosition)) {
    return { status: "rejected", reason: "同一个参考档案不能混合实体机位。" };
  }
  if (
    input.reps.some((rep) =>
      rep.profileContext.variation !== input.identity.variation ||
      rep.profileContext.trainingSide !== input.identity.trainingSide ||
      rep.profileContext.equipment !== input.identity.equipment ||
      rep.profileContext.coordinateSystem !== input.identity.coordinateSystem,
    )
  ) {
    return {
      status: "rejected",
      reason: "候选 rep 的 variation/equipment/trainingSide/coordinateSystem 不一致。",
    };
  }
  const poseModels = [...new Set(input.reps.map((rep) => rep.profileContext.poseModelVersion))];
  if (poseModels.length !== 1) {
    return { status: "rejected", reason: "同一个参考档案不能混合 pose model 版本。" };
  }
  const compatible = input.reps.filter(
    (rep) => rep.screening.status === "biomechanically_compatible_candidate",
  );
  if (compatible.length === 0) {
    return { status: "rejected", reason: "没有通过可观察运动方向筛选的候选 rep。" };
  }
  const nodeCount = compatible[0].nodes.length;
  if (
    compatible.some((rep) =>
      rep.nodes.length !== nodeCount ||
      rep.featureNames.join("|") !== LAT_PULLDOWN_REFERENCE_FEATURES.join("|"),
    )
  ) {
    return { status: "rejected", reason: "候选 rep 的相位节点或特征 schema 不一致。" };
  }

  const nodes: ReferenceCorridorNode[] = Array.from({ length: nodeCount }, (_, nodeIndex) => {
    const template = compatible[0].nodes[nodeIndex];
    return {
      nodeIndex,
      phase: template.phase,
      phasePercent: template.phasePercent,
      features: LAT_PULLDOWN_REFERENCE_FEATURES.map((_, featureIndex) => {
        const observations = compatible.flatMap((rep) => {
          const value = rep.nodes[nodeIndex].values[featureIndex];
          const confidence = rep.nodes[nodeIndex].confidence[featureIndex];
          return value === null ? [] : [{ value, confidence }];
        });
        const values = observations.map((observation) => observation.value).sort((a, b) => a - b);
        const confidences = observations.map((observation) => observation.confidence).sort((a, b) => a - b);
        const enough = values.length > 0;
        const center = enough ? percentile(values, 0.5) : null;
        const deviations = center === null
          ? []
          : values.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
        return {
          nObserved: values.length,
          nSessionsObserved: null,
          median: center === null ? null : round(center),
          qLow: enough ? round(percentile(values, 0.1)) : null,
          qHigh: enough ? round(percentile(values, 0.9)) : null,
          medianAbsoluteDeviation: enough ? round(percentile(deviations, 0.5)) : null,
          medianConfidence: enough ? round(percentile(confidences, 0.5)) : null,
          coverageRate: round(values.length / compatible.length),
          evidenceStatus: "hypothesis" as const,
        };
      }),
    };
  });

  const allExpertReviewed = compatible.every(
    (rep) => rep.sourceStatus === "expert_approved_reference",
  );
  const statuses = [...new Set(compatible.map((rep) => rep.sourceStatus))];
  const incompatibleCount = input.reps.filter(
    (rep) => rep.screening.status === "biomechanically_incompatible_candidate",
  ).length;
  const unknownCount = input.reps.filter((rep) => rep.screening.status === "unknown").length;
  return {
    status: "ready",
    profile: {
      schemaVersion: PROVISIONAL_REFERENCE_PROFILE_SCHEMA,
      profileStatus: allExpertReviewed
        ? "personal_provisional_expert_reviewed"
        : "personal_provisional_unreviewed",
      identity: {
        exerciseId: "lat_pulldown",
        capturePosition: input.capturePosition,
        ...input.identity,
        featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2",
        poseModelVersion: poseModels[0],
      },
      intendedUse: "compare_observed_reps_to_personal_provisional_corridor",
      prohibitedUses: [
        "population_standard_claim",
        "medical_diagnosis",
        "injury_risk_prediction",
        "automatic_promotion_of_unreviewed_user_reps",
      ],
      phaseModel: {
        normalization: "piecewise_linear_start_bottom_end",
        pullNodes: PULL_NODES,
        returnNodes: RETURN_NODES,
        unrestrictedDtwAllowed: false,
        retainRawTiming: true,
      },
      featureNames: [...LAT_PULLDOWN_REFERENCE_FEATURES],
      referencePopulation: {
        participantCount: 1,
        sessionCount: null,
        captureCount: new Set(compatible.map((rep) => rep.captureId)).size,
        repCount: compatible.length,
        sourceStatuses: statuses,
        evidenceStatus: "hypothesis",
      },
      screeningSummary: {
        acceptedCandidateReps: compatible.length,
        incompatibleCandidateReps: incompatibleCount,
        unknownCandidateReps: unknownCount,
      },
      corridor: {
        method: "pointwise_median_empirical_q10_q90",
        nodes,
        evidenceStatus: "hypothesis",
      },
      matchingPolicy: {
        minimumPointObservations: null,
        minimumComparableNodeRatio: null,
        sustainedOutsideNodes: null,
        maximumOutsideNodeRatio: null,
        minimumObservationConfidence: 0.5,
        unrestrictedDtwAllowed: false,
        decisionThresholdsCalibrated: false,
        evidenceStatus: "hypothesis",
      },
      provenance: {
        captureIds: [...new Set(compatible.map((rep) => rep.captureId))],
        repIds: compatible.map((rep) => `${rep.captureId}:rep-${rep.segment.repIndex}`),
        generatedAt: input.generatedAt ?? null,
        notes: [
          "Source reps passed observable phase-direction screening only; correct-form review is absent unless profileStatus says expert reviewed.",
          "Empirical q10/q90 is a personal descriptive band, not a population biomechanical acceptance threshold.",
        ],
      },
    },
  };
}

/**
 * Compares the same phase node to the same phase node. No time warping is
 * performed, so pauses, early reversals, and phase-duration evidence remain
 * available to the caller instead of being aligned away.
 */
export function matchLatPulldownTrajectory(
  profile: PersonalProvisionalReferenceProfile,
  observed: NormalizedLatPulldownReferenceRep,
): TrajectoryMatchResult {
  const base = {
    profileStatus: profile.profileStatus,
    evidenceStatus: "hypothesis" as const,
    calibrationStatus: "uncalibrated" as const,
    qualityVerdict: null,
    limitations: [
      "Outside the personal provisional corridor is an observed deviation, not proof of incorrect form.",
      "Occluded or unsupported metrics remain unknown and are not imputed.",
    ],
  };
  if (observed.exerciseId !== profile.identity.exerciseId) {
    return {
      ...base,
      status: "profile_mismatch",
      features: [],
      comparableFeatureCount: 0,
      mismatchReason: "exerciseId 不匹配。",
    };
  }
  if (observed.capturePosition !== profile.identity.capturePosition) {
    return {
      ...base,
      status: "profile_mismatch",
      features: [],
      comparableFeatureCount: 0,
      mismatchReason: "capturePosition 不匹配，禁止跨机位套用二维走廊。",
    };
  }
  const identityMismatch = [
    ["variation", observed.profileContext.variation, profile.identity.variation],
    ["trainingSide", observed.profileContext.trainingSide, profile.identity.trainingSide],
    ["equipment", observed.profileContext.equipment, profile.identity.equipment],
    ["coordinateSystem", observed.profileContext.coordinateSystem, profile.identity.coordinateSystem],
    ["poseModelVersion", observed.profileContext.poseModelVersion, profile.identity.poseModelVersion],
  ].find(([, observedValue, profileValue]) => observedValue !== profileValue);
  if (identityMismatch) {
    return {
      ...base,
      status: "profile_mismatch",
      features: [],
      comparableFeatureCount: 0,
      mismatchReason: `${identityMismatch[0]} 不匹配。`,
    };
  }
  if (
    observed.nodes.length !== profile.corridor.nodes.length ||
    observed.featureNames.join("|") !== profile.featureNames.join("|")
  ) {
    return {
      ...base,
      status: "profile_mismatch",
      features: [],
      comparableFeatureCount: 0,
      mismatchReason: "相位节点或 feature schema 不匹配。",
    };
  }
  if (
    !validReferencePhaseLayout(profile.corridor.nodes) ||
    profile.corridor.nodes.some((node) =>
      node.features.length !== profile.featureNames.length ||
      node.features.some((point) => !validReferenceCorridorPoint(point)),
    ) ||
    profile.corridor.nodes.some((node, index) => {
      const actual = observed.nodes[index];
      return node.phase !== actual.phase || Math.abs(node.phasePercent - actual.phasePercent) > 1e-4;
    })
  ) {
    return {
      ...base,
      status: "profile_mismatch",
      features: [],
      comparableFeatureCount: 0,
      mismatchReason: "相位顺序或阶段进度不匹配。",
    };
  }

  const features = LAT_PULLDOWN_REFERENCE_FEATURES.map((feature, featureIndex) => {
    const nodeComparisons: TrajectoryNodeComparison[] = [];
    let comparableNodeCount = 0;
    let outsideNodeCount = 0;
    let currentOutsideRun = 0;
    let maximumConsecutiveOutsideNodes = 0;
    let previousPhase: "pull" | "return" | null = null;
    for (let nodeIndex = 0; nodeIndex < observed.nodes.length; nodeIndex += 1) {
      const observedNode = observed.nodes[nodeIndex];
      const corridorNode = profile.corridor.nodes[nodeIndex];
      const point = corridorNode.features[featureIndex];
      const value = observedNode.values[featureIndex];
      const confidence = observedNode.confidence[featureIndex];
      if (previousPhase !== observedNode.phase) currentOutsideRun = 0;
      previousPhase = observedNode.phase;
      const comparable =
        value !== null &&
        Number.isFinite(value) &&
        Number.isFinite(confidence) &&
        confidence >= profile.matchingPolicy.minimumObservationConfidence &&
        point.qLow !== null &&
        point.qHigh !== null &&
        Number.isFinite(point.qLow) &&
        Number.isFinite(point.qHigh) &&
        point.qLow <= point.qHigh;
      if (!comparable) {
        currentOutsideRun = 0;
        nodeComparisons.push({
          nodeIndex,
          phase: observedNode.phase,
          status: "unknown",
          value,
          qLow: point.qLow,
          qHigh: point.qHigh,
          confidence,
          normalizedExcess: null,
        });
        continue;
      }
      comparableNodeCount += 1;
      const outside = value < point.qLow! || value > point.qHigh!;
      if (outside) {
        outsideNodeCount += 1;
        currentOutsideRun += 1;
        maximumConsecutiveOutsideNodes = Math.max(
          maximumConsecutiveOutsideNodes,
          currentOutsideRun,
        );
      } else {
        currentOutsideRun = 0;
      }
      nodeComparisons.push({
        nodeIndex,
        phase: observedNode.phase,
        status: outside ? "outside_observed_band" : "within_observed_band",
        value,
        qLow: point.qLow,
        qHigh: point.qHigh,
        confidence,
        normalizedExcess: outside ? normalizedExcess(value, point) : 0,
      });
    }
    const comparableNodeRatio = comparableNodeCount / observed.nodes.length;
    const outsideNodeRatio = comparableNodeCount > 0
      ? outsideNodeCount / comparableNodeCount
      : null;
    let status: TrajectoryFeatureMatch["status"] = "unknown";
    let unknownReason: string | null = "可比较节点不足。";
    if (comparableNodeCount > 0) {
      status = "compared";
      unknownReason = null;
    }
    return {
      feature,
      status,
      comparableNodeCount,
      comparableNodeRatio: round(comparableNodeRatio),
      outsideNodeCount,
      outsideNodeRatio: outsideNodeRatio === null ? null : round(outsideNodeRatio),
      maximumConsecutiveOutsideNodes,
      nodes: nodeComparisons,
      unknownReason,
    };
  });
  const comparable = features.filter((feature) => feature.status === "compared");
  const status: TrajectoryMatchResult["status"] = comparable.length === 0
    ? "insufficient_observation"
    : "comparison_available";
  return {
    ...base,
    status,
    features,
    comparableFeatureCount: comparable.length,
    mismatchReason: null,
  };
}

function validReferenceCorridorPoint(point: ReferenceCorridorPoint): boolean {
  const quantilesValid = point.qLow === null && point.qHigh === null
    ? true
    : point.qLow !== null &&
      point.qHigh !== null &&
      Number.isFinite(point.qLow) &&
      Number.isFinite(point.qHigh) &&
      point.qLow <= point.qHigh &&
      point.nObserved > 0;
  return quantilesValid && (
    point.medianAbsoluteDeviation === null ||
    (Number.isFinite(point.medianAbsoluteDeviation) && point.medianAbsoluteDeviation >= 0)
  );
}

function validReferencePhaseLayout(
  nodes: readonly Pick<ReferenceCorridorNode, "phase" | "phasePercent">[],
): boolean {
  const split = nodes.findIndex((node) => node.phase === "return");
  if (split < 2 || nodes.length - split < 2) return false;
  const valid = (
    phaseNodes: readonly Pick<ReferenceCorridorNode, "phase" | "phasePercent">[],
    phase: "pull" | "return",
  ) => phaseNodes.every((node, index) =>
    node.phase === phase &&
    Number.isFinite(node.phasePercent) &&
    node.phasePercent >= 0 &&
    node.phasePercent <= 100 &&
    (index === 0 || phaseNodes[index - 1].phasePercent <= node.phasePercent),
  ) && Math.abs(phaseNodes[0].phasePercent) <= 1e-4
    && Math.abs(phaseNodes[phaseNodes.length - 1].phasePercent - 100) <= 1e-4;
  return valid(nodes.slice(0, split), "pull") && valid(nodes.slice(split), "return");
}

function phaseTargets(
  startMs: number,
  endMs: number,
  count: number,
  phase: "pull" | "return",
): Array<{ timestampMs: number; phase: "pull" | "return"; phasePercent: number }> {
  return Array.from({ length: count }, (_, index) => {
    const phasePercent = index / (count - 1);
    return {
      timestampMs: startMs + (endMs - startMs) * phasePercent,
      phase,
      phasePercent: round(phasePercent * 100),
    };
  });
}

function nearestPose(
  poses: readonly PoseEstimate[],
  targetMs: number,
): { pose: PoseEstimate; distanceMs: number } {
  const pose = poses.reduce((nearest, candidate) =>
    Math.abs(candidate.timestampMs - targetMs) < Math.abs(nearest.timestampMs - targetMs)
      ? candidate
      : nearest,
  );
  return { pose, distanceMs: Math.abs(pose.timestampMs - targetMs) };
}

function featureVector(pose: PoseEstimate, visibilityThreshold: number): FeatureVector {
  const leftShoulder = pose.landmarks[11];
  const rightShoulder = pose.landmarks[12];
  const leftElbow = pose.landmarks[13];
  const rightElbow = pose.landmarks[14];
  const leftWrist = pose.landmarks[15];
  const rightWrist = pose.landmarks[16];
  const leftHip = pose.landmarks[23];
  const rightHip = pose.landmarks[24];
  const shoulders = measurement([leftShoulder, rightShoulder], visibilityThreshold);
  const hips = measurement([leftHip, rightHip], visibilityThreshold);
  const torso = shoulders && hips
    ? {
        shoulder: midpoint(leftShoulder, rightShoulder),
        hip: midpoint(leftHip, rightHip),
        confidence: Math.min(shoulders.confidence, hips.confidence),
      }
    : null;
  const scale = torso
    ? Math.hypot(torso.shoulder.x - torso.hip.x, torso.shoulder.y - torso.hip.y)
    : null;
  const usableScale = scale !== null && scale >= 1e-3 ? scale : null;

  const values: Array<number | null> = LAT_PULLDOWN_REFERENCE_FEATURES.map(() => null);
  const confidence = LAT_PULLDOWN_REFERENCE_FEATURES.map(() => 0);
  const set = (
    feature: LatPulldownReferenceFeature,
    value: number | null,
    featureConfidence: number,
  ) => {
    const index = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf(feature);
    values[index] = value !== null && Number.isFinite(value) ? round(value) : null;
    confidence[index] = values[index] === null ? 0 : round(featureConfidence);
  };

  if (torso && usableScale !== null) {
    for (const [side, wrist] of [
      ["left", leftWrist],
      ["right", rightWrist],
    ] as const) {
      const wristMeasurement = measurement([wrist], visibilityThreshold);
      if (!wristMeasurement) continue;
      const featureConfidence = Math.min(torso.confidence, wristMeasurement.confidence);
      set(
        side === "left" ? "leftWristHeight" : "rightWristHeight",
        (wrist.y - torso.shoulder.y) / usableScale,
        featureConfidence,
      );
      set(
        side === "left" ? "leftWristLateral" : "rightWristLateral",
        (wrist.x - torso.shoulder.x) / usableScale,
        featureConfidence,
      );
    }
    const leftHeight = values[LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("leftWristHeight")];
    const rightHeight = values[LAT_PULLDOWN_REFERENCE_FEATURES.indexOf("rightWristHeight")];
    if (leftHeight !== null && rightHeight !== null) {
      set(
        "bilateralWristHeightDelta",
        leftHeight - rightHeight,
        Math.min(leftWrist.visibility, rightWrist.visibility, torso.confidence),
      );
    }
    set(
      "torsoLateralTiltDeg",
      signedTorsoTiltDeg(torso.shoulder, torso.hip),
      torso.confidence,
    );
  }

  setJointAngle(
    "leftElbowAngleDeg",
    [leftShoulder, leftElbow, leftWrist],
    visibilityThreshold,
    set,
  );
  setJointAngle(
    "rightElbowAngleDeg",
    [rightShoulder, rightElbow, rightWrist],
    visibilityThreshold,
    set,
  );
  setJointAngle(
    "leftUpperArmToTorsoDeg",
    [leftHip, leftShoulder, leftElbow],
    visibilityThreshold,
    set,
  );
  setJointAngle(
    "rightUpperArmToTorsoDeg",
    [rightHip, rightShoulder, rightElbow],
    visibilityThreshold,
    set,
  );

  return {
    values,
    confidence,
    torsoCenterX: torso && usableScale !== null ? torso.shoulder.x : null,
    torsoScale: usableScale,
  };
}

function setJointAngle(
  feature: LatPulldownReferenceFeature,
  landmarks: [PoseLandmark, PoseLandmark, PoseLandmark],
  visibilityThreshold: number,
  set: (feature: LatPulldownReferenceFeature, value: number | null, confidence: number) => void,
): void {
  const observed = measurement(landmarks, visibilityThreshold);
  if (!observed) return;
  set(feature, angleDeg(...landmarks), observed.confidence);
}

function measurement(
  landmarks: Array<PoseLandmark | undefined>,
  visibilityThreshold: number,
): { confidence: number } | null {
  if (landmarks.some((landmark) => !landmark || landmark.visibility < visibilityThreshold)) {
    return null;
  }
  return { confidence: Math.min(...landmarks.map((landmark) => landmark!.visibility)) };
}

function midpoint(left: PoseLandmark, right: PoseLandmark): { x: number; y: number } {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function signedTorsoTiltDeg(
  shoulder: { x: number; y: number },
  hip: { x: number; y: number },
): number {
  return Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y) * 180 / Math.PI;
}

function angleDeg(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number | null {
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (denominator < 1e-6) return null;
  const cosine = (first.x * second.x + first.y * second.y) / denominator;
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;
}

function emptyFeatureVector(): FeatureVector {
  return {
    values: LAT_PULLDOWN_REFERENCE_FEATURES.map(() => null),
    confidence: LAT_PULLDOWN_REFERENCE_FEATURES.map(() => 0),
    torsoCenterX: null,
    torsoScale: null,
  };
}

function screenBiomechanicalCompatibility(
  nodes: readonly NormalizedReferenceNode[],
): BiomechanicalScreening {
  const supportingSignals: string[] = [];
  const contradictingSignals: string[] = [];
  const start = nodes[0];
  const bottom = nodes[PULL_NODES - 1];
  const end = nodes[nodes.length - 1];
  const direction = (
    feature: LatPulldownReferenceFeature,
    expectedPull: "increase" | "decrease",
  ) => {
    const index = LAT_PULLDOWN_REFERENCE_FEATURES.indexOf(feature);
    const startValue = start.values[index];
    const bottomValue = bottom.values[index];
    const endValue = end.values[index];
    if (startValue === null || bottomValue === null || endValue === null) return;
    const pullDelta = bottomValue - startValue;
    const returnDelta = endValue - bottomValue;
    const pullSupports = expectedPull === "increase" ? pullDelta > 0 : pullDelta < 0;
    const returnSupports = expectedPull === "increase" ? returnDelta < 0 : returnDelta > 0;
    if (pullSupports) supportingSignals.push(`${feature}:expected_pull_direction`);
    else if (pullDelta !== 0) contradictingSignals.push(`${feature}:opposite_pull_direction`);
    if (returnSupports) supportingSignals.push(`${feature}:expected_return_direction`);
    else if (returnDelta !== 0) contradictingSignals.push(`${feature}:opposite_return_direction`);
  };
  direction("leftWristHeight", "increase");
  direction("rightWristHeight", "increase");
  direction("leftElbowAngleDeg", "decrease");
  direction("rightElbowAngleDeg", "decrease");
  direction("leftUpperArmToTorsoDeg", "decrease");
  direction("rightUpperArmToTorsoDeg", "decrease");

  // Wrist travel is the primary observable phase signal for this profile.
  // Projected elbow/upper-arm angles remain useful evidence, but an oblique
  // projection may reverse or flatten them and therefore cannot veto an
  // otherwise complete pull-return cycle on its own.
  const wristSupporting = supportingSignals.filter((signal) => signal.includes("WristHeight"));
  const wristContradicting = contradictingSignals.filter((signal) => signal.includes("WristHeight"));
  let status: BiomechanicalScreening["status"] = "unknown";
  if (wristSupporting.length >= 2 && wristContradicting.length === 0) {
    status = "biomechanically_compatible_candidate";
  } else if (wristContradicting.length >= 2) {
    status = "biomechanically_incompatible_candidate";
  }
  return {
    status,
    evidenceStatus: "inferred",
    supportingSignals,
    contradictingSignals,
    limitations: [
      "This screening checks observable phase direction, not correct form.",
      "No medical, injury-risk, scapular, muscle-activation, or force inference is made.",
    ],
  };
}

function percentile(sorted: readonly number[], probability: number): number {
  if (sorted.length === 0) return Number.NaN;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function normalizedExcess(value: number, point: ReferenceCorridorPoint): number | null {
  if (point.qLow === null || point.qHigh === null) return null;
  const rawExcess = value < point.qLow
    ? point.qLow - value
    : value > point.qHigh
      ? value - point.qHigh
      : 0;
  const scaleCandidates = [
    point.qHigh - point.qLow,
    point.medianAbsoluteDeviation === null
      ? 0
      : point.medianAbsoluteDeviation * 1.4826,
  ].filter((candidate) => Number.isFinite(candidate) && candidate > 1e-9);
  if (scaleCandidates.length === 0) return null;
  return round(rawExcess / Math.max(...scaleCandidates));
}

function round(value: number): number {
  return Number(value.toFixed(5));
}
