import type { PoseEstimate, PoseLandmark } from "./PoseEngine";
import {
  BONES_COCO17,
  LandmarkTracker,
  type TrackedLandmark,
} from "./landmarkTracker";
import { PoseSmoother, type SmoothedPoint } from "./oneEuro";
import {
  WeakObservationFusion,
  type ContinuityJointEvidence,
} from "./weakObservationFusion";

export const CANONICAL_POSE_CONTRACT_VERSION =
  "canonical-pose-frame/v1" as const;
export const RAW_PASS_THROUGH_ALGORITHM_VERSION =
  "raw-pass-through/v1" as const;
export const LEGACY_WEB_TRACKER_ALGORITHM_VERSION =
  "legacy-web-tracker/v1" as const;
export const POSE_CONTINUITY_REFERENCE_ALGORITHM_VERSION =
  "pose-continuity-reference/v1" as const;
const RAW_PASS_THROUGH_MIN_VISIBILITY = 0.5;
const MAX_CONTINUITY_DT_MS = 1000;

export type PoseSchema = "blazepose33" | "coco17";
export type CanonicalLandmarkSource =
  | "measured"
  | "fused"
  | "predicted"
  | "interpolated"
  | "unknown";
export type CanonicalRepairFlag =
  | "smoothed"
  | "constrained"
  | "swap-corrected";
export type CanonicalContinuityReason =
  | "weak-observation-bone-fusion"
  | "short-gap-prediction"
  | "outlier-rejected-prediction"
  | "outlier-rejected-unknown"
  | "prediction-timeout"
  | "no-measurement-baseline"
  | "legacy-tracker-prediction"
  | null;

export interface CanonicalImageMetadata {
  widthPx: number;
  heightPx: number;
  rotationDegrees: 0 | 90 | 180 | 270;
  mirrored: boolean;
}

export interface CanonicalLandmark extends PoseLandmark {
  predicted: boolean;
  observationScore: number;
  canonicalConfidence: number;
  /** Null until this pass-through contract has a calibrated error model. */
  uncertainty: number | null;
  source: CanonicalLandmarkSource;
  repairFlags: CanonicalRepairFlag[];
  continuityReason: CanonicalContinuityReason;
  renderable: boolean;
  usable: boolean;
}

export interface CanonicalPoseFrame extends PoseEstimate {
  contractVersion: typeof CANONICAL_POSE_CONTRACT_VERSION;
  algorithmVersion:
    | typeof RAW_PASS_THROUGH_ALGORITHM_VERSION
    | typeof LEGACY_WEB_TRACKER_ALGORITHM_VERSION
    | typeof POSE_CONTINUITY_REFERENCE_ALGORITHM_VERSION;
  frameId: number;
  sequenceId: string;
  sourceTimestampMs: number;
  schema: PoseSchema;
  coordinateSpace: "image_normalized";
  worldCoordinateSpace: "meters";
  image: CanonicalImageMetadata;
  overallQuality: number;
  landmarks: CanonicalLandmark[];
  worldLandmarks: CanonicalLandmark[];
}

export interface PoseContinuitySessionConfig {
  sequenceId: string;
  schema: PoseSchema;
  image: CanonicalImageMetadata;
  stabilization?: "raw" | "legacy" | "fusion";
}

export interface PoseContinuitySession {
  process(observation: PoseEstimate): CanonicalPoseFrame;
}

export interface PoseContinuityDiagnostic {
  sequenceId: string;
  frameId: number;
  rawObservation: PoseEstimate;
  canonicalFrame: CanonicalPoseFrame;
}

class TypeScriptPoseContinuitySession implements PoseContinuitySession {
  private nextFrameId = 0;
  private readonly tracker: LandmarkTracker | null;
  private readonly smoother: PoseSmoother | null;
  private readonly fusion: WeakObservationFusion | null;
  private lastSourceTimestampMs: number | null = null;

  constructor(private readonly config: PoseContinuitySessionConfig) {
    const stabilized = config.stabilization === "legacy";
    this.tracker = stabilized
      ? new LandmarkTracker(
          config.schema === "coco17" ? BONES_COCO17 : undefined,
        )
      : null;
    this.smoother = stabilized ? new PoseSmoother() : null;
    this.fusion =
      config.stabilization === "fusion"
        ? new WeakObservationFusion(config.schema, config.image)
        : null;
  }

  process(observation: PoseEstimate): CanonicalPoseFrame {
    if (
      this.lastSourceTimestampMs !== null &&
      (observation.timestampMs <= this.lastSourceTimestampMs ||
        observation.timestampMs - this.lastSourceTimestampMs > MAX_CONTINUITY_DT_MS)
    ) {
      this.tracker?.reset();
      this.smoother?.reset();
      this.fusion?.reset();
    }
    this.lastSourceTimestampMs = observation.timestampMs;
    const tracked = this.tracker?.update(
      observation.landmarks,
      observation.timestampMs,
    );
    const smoothed = tracked
      ? this.smoother?.smooth(tracked, observation.timestampMs)
      : undefined;
    const fused = this.fusion?.process(
      observation.landmarks,
      observation.timestampMs,
    );
    const landmarks = tracked
      ? observation.landmarks.map((landmark, index) =>
          toLegacyCanonicalLandmark(
            landmark,
            tracked[index],
            smoothed?.[index],
          ),
        )
      : observation.landmarks.map((landmark, index) =>
          toCanonicalLandmark(landmark, fused?.get(index)),
        );
    const worldLandmarks = observation.worldLandmarks.map((landmark) =>
      toCanonicalLandmark(landmark),
    );
    const overallQuality =
      landmarks.length === 0
        ? 0
        : landmarks.reduce(
            (sum, landmark) => sum + landmark.canonicalConfidence,
            0,
          ) / landmarks.length;

    return {
      contractVersion: CANONICAL_POSE_CONTRACT_VERSION,
      algorithmVersion: tracked
        ? LEGACY_WEB_TRACKER_ALGORITHM_VERSION
        : fused
          ? POSE_CONTINUITY_REFERENCE_ALGORITHM_VERSION
          : RAW_PASS_THROUGH_ALGORITHM_VERSION,
      frameId: this.nextFrameId++,
      sequenceId: this.config.sequenceId,
      timestampMs: observation.timestampMs,
      sourceTimestampMs: observation.timestampMs,
      schema: this.config.schema,
      coordinateSpace: "image_normalized",
      worldCoordinateSpace: "meters",
      image: { ...this.config.image },
      overallQuality,
      landmarks,
      worldLandmarks,
    };
  }
}

export function createPoseContinuitySession(
  config: PoseContinuitySessionConfig,
): PoseContinuitySession {
  return new TypeScriptPoseContinuitySession(config);
}

/** Explicit opt-in raw/canonical pair for fixture replay and diagnostics only. */
export function createPoseContinuityDiagnostic(
  rawObservation: PoseEstimate,
  canonicalFrame: CanonicalPoseFrame,
): PoseContinuityDiagnostic {
  if (rawObservation.timestampMs !== canonicalFrame.sourceTimestampMs) {
    throw new Error(
      `Raw diagnostic timestamp mismatch: ${rawObservation.timestampMs} !== ${canonicalFrame.sourceTimestampMs}`,
    );
  }

  return {
    sequenceId: canonicalFrame.sequenceId,
    frameId: canonicalFrame.frameId,
    rawObservation,
    canonicalFrame,
  };
}

function toCanonicalLandmark(
  landmark: PoseLandmark,
  fused?: ContinuityJointEvidence,
): CanonicalLandmark {
  if (fused) {
    const renderable = fused.source !== "unknown";
    return {
      ...landmark,
      x: fused.x,
      y: fused.y,
      visibility: fused.canonicalConfidence,
      predicted: fused.source === "predicted",
      observationScore: landmark.visibility,
      canonicalConfidence: fused.canonicalConfidence,
      uncertainty: fused.uncertainty,
      source: fused.source,
      repairFlags: fused.source === "fused" ? ["constrained"] : [],
      continuityReason: fused.reason,
      renderable,
      usable: fused.source === "fused" && fused.uncertainty <= 0.04,
    };
  }
  const renderable =
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    landmark.visibility >= RAW_PASS_THROUGH_MIN_VISIBILITY;

  return {
    ...landmark,
    predicted: false,
    observationScore: landmark.visibility,
    canonicalConfidence: landmark.visibility,
    uncertainty: null,
    source: "measured",
    repairFlags: [],
    continuityReason: null,
    renderable,
    usable: renderable,
  };
}

function toLegacyCanonicalLandmark(
  observation: PoseLandmark,
  tracked: TrackedLandmark,
  smoothed: SmoothedPoint | undefined,
): CanonicalLandmark {
  const renderable =
    Number.isFinite(smoothed?.x ?? tracked.x) &&
    Number.isFinite(smoothed?.y ?? tracked.y) &&
    !tracked.predicted &&
    tracked.visibility >= RAW_PASS_THROUGH_MIN_VISIBILITY;

  return {
    ...observation,
    x: smoothed?.x ?? tracked.x,
    y: smoothed?.y ?? tracked.y,
    visibility: tracked.visibility,
    predicted: tracked.predicted,
    observationScore: observation.visibility,
    canonicalConfidence: tracked.visibility,
    uncertainty: null,
    source: tracked.predicted ? "predicted" : "measured",
    repairFlags: ["smoothed"],
    continuityReason: tracked.predicted ? "legacy-tracker-prediction" : null,
    renderable,
    usable: renderable,
  };
}
