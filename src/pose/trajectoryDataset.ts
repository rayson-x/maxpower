import type { CameraView } from "./formRuleEngine";
import type { PoseEstimate, PoseLandmark } from "./PoseEngine";
import { CAPTURE_POSITIONS, type CapturePosition } from "./viewGating";

export const LAT_PULLDOWN_TRAJECTORY_SCHEMA = "maxpower-trajectory-sample/v1" as const;
const FRAMES_PER_REP = 32;
const MIN_FEATURE_COVERAGE = 0.8;
const MAX_CONSECUTIVE_MISSING_FRAMES = 4;
// A nearest-neighbour resample is only evidence when the source frame is
// genuinely close to the target time. Without this guard, two sparse poses can
// be copied across a full rep and masquerade as a complete trajectory.
const MAX_SOURCE_FRAME_DISTANCE_MS = 180;

export const LAT_PULLDOWN_FEATURE_NAMES = [
  "leftWristHeight",
  "rightWristHeight",
  "leftElbowAngle",
  "rightElbowAngle",
  "leftWristLateral",
  "rightWristLateral",
  "torsoLean",
] as const;

export interface ApprovedTrajectorySegment {
  repIndex: number;
  startMs: number;
  peakMs: number;
  endMs: number;
}

export interface LatPulldownTrajectoryRep {
  repIndex: number;
  startMs: number;
  peakMs: number;
  endMs: number;
  /** Fraction of 32 resampled frames with every required joint present. */
  featureCoverage: number;
  /** The pull-to-bottom landmark must be observed, not inferred from neighbours. */
  peakFeatureAvailable: boolean;
  /** Long blank runs make trajectory shape ambiguous even if total coverage looks high. */
  maxMissingFrameSpan: number;
  /** Fixed-shape, torso-normalized multi-joint trajectory. */
  frames: Array<Array<number | null>>;
}

export interface LatPulldownTrajectorySample {
  schemaVersion: typeof LAT_PULLDOWN_TRAJECTORY_SCHEMA;
  sampleId: string;
  exerciseId: "lat_pulldown";
  /** These athlete recordings teach repetition boundaries, never a form ideal. */
  intendedUse: "rep_segmentation_observation";
  formReference: "not_labeled";
  cameraView: CameraView;
  approvedAt: string;
  source: {
    captureId: string;
    model: string | null;
    /** Physical placement, retained separately from the coarse rule-engine view. */
    capturePosition: CapturePosition | null;
    /** Coordinates stay in the original image orientation; UI mirroring is never baked in. */
    coordinateSystem: "source-image/v1";
  };
  actualCount: number;
  framesPerRep: number;
  featureNames: readonly (typeof LAT_PULLDOWN_FEATURE_NAMES)[number][];
  reps: LatPulldownTrajectoryRep[];
  quality: {
    meanFeatureCoverage: number;
    eligibleForSegmentationTraining: boolean;
    reason: string | null;
  };
}

export type TrajectorySampleBuildResult =
  | { status: "ready"; sample: LatPulldownTrajectorySample }
  | { status: "rejected"; reason: string };

export interface ApprovedLatPulldownTrajectoryInput {
  captureId: string;
  exerciseId: string;
  cameraView: CameraView;
  approvedAt: string;
  expectedCount: string;
  approvedSegments: readonly ApprovedTrajectorySegment[];
  poses: readonly PoseEstimate[];
  model?: string | null;
  capturePosition?: CapturePosition | null;
}

/**
 * Converts an explicitly approved high-pulldown set into a portable trajectory
 * sample. This is deliberately separate from count candidates: a candidate
 * becomes training data only when its boundaries agree with the athlete's
 * approved count.
 */
export function buildApprovedLatPulldownTrajectorySample(
  input: ApprovedLatPulldownTrajectoryInput,
): TrajectorySampleBuildResult {
  if (input.exerciseId !== "lat_pulldown") {
    return { status: "rejected", reason: "只有已确认的高位下拉可进入首个轨迹库。" };
  }
  const actualCount = Number(input.expectedCount);
  if (!Number.isInteger(actualCount) || actualCount <= 0) {
    return { status: "rejected", reason: "请填写大于 0 的人工实际次数。" };
  }
  if (actualCount !== input.approvedSegments.length) {
    return {
      status: "rejected",
      reason: `人工次数 ${actualCount} 与批准边界数 ${input.approvedSegments.length} 不一致；请先选择或修正 rep 边界。`,
    };
  }
  if (input.poses.length < 2) {
    return { status: "rejected", reason: "关键点帧不足，不能建立轨迹样本。" };
  }
  const segmentError = validateSegments(input.approvedSegments, input.poses);
  if (segmentError) return { status: "rejected", reason: segmentError };

  const reps = input.approvedSegments.map((segment) => buildRep(input.poses, segment));
  const meanFeatureCoverage = reps.reduce((sum, rep) => sum + rep.featureCoverage, 0) / reps.length;
  const lowCoverage = reps.some((rep) => rep.featureCoverage < MIN_FEATURE_COVERAGE);
  const missingPeak = reps.some((rep) => !rep.peakFeatureAvailable);
  const longMissingSpan = reps.some((rep) => rep.maxMissingFrameSpan > MAX_CONSECUTIVE_MISSING_FRAMES);
  const capturePosition = validCapturePosition(input.capturePosition) ? input.capturePosition : null;
  const missingCapturePosition = !capturePosition;
  const eligibleForSegmentationTraining = !lowCoverage && !missingPeak && !longMissingSpan && !missingCapturePosition;
  return {
    status: "ready",
    sample: {
      schemaVersion: LAT_PULLDOWN_TRAJECTORY_SCHEMA,
      sampleId: `${input.captureId}:lat_pulldown:${input.approvedAt}`,
      exerciseId: "lat_pulldown",
      intendedUse: "rep_segmentation_observation",
      formReference: "not_labeled",
      cameraView: input.cameraView,
      approvedAt: input.approvedAt,
      source: {
        captureId: input.captureId,
        model: input.model ?? null,
        capturePosition,
        coordinateSystem: "source-image/v1",
      },
      actualCount,
      framesPerRep: FRAMES_PER_REP,
      featureNames: [...LAT_PULLDOWN_FEATURE_NAMES],
      reps,
      quality: {
        meanFeatureCoverage: round(meanFeatureCoverage),
        eligibleForSegmentationTraining,
        reason: eligibleForSegmentationTraining ? null : [
          lowCoverage ? `至少一个 rep 的关键特征覆盖低于 ${Math.round(MIN_FEATURE_COVERAGE * 100)}%。` : null,
          missingPeak ? "至少一个 rep 在动作峰值缺少完整关键特征。" : null,
          longMissingSpan ? `至少一个 rep 连续缺少超过 ${MAX_CONSECUTIVE_MISSING_FRAMES} 帧的关键特征。` : null,
          missingCapturePosition ? "缺少实体机位 metadata，不能混入角度专属轨迹库。" : null,
        ].filter(Boolean).join(" "),
      },
    },
  };
}

function buildRep(
  poses: readonly PoseEstimate[],
  segment: ApprovedTrajectorySegment,
): LatPulldownTrajectoryRep {
  const frames: Array<Array<number | null>> = [];
  let usable = 0;
  let missingRun = 0;
  let maxMissingFrameSpan = 0;
  for (let index = 0; index < FRAMES_PER_REP; index += 1) {
    const progress = index / (FRAMES_PER_REP - 1);
    const targetMs = segment.startMs + (segment.endMs - segment.startMs) * progress;
    const nearest = nearestPose(poses, targetMs);
    const vector = nearest.distanceMs <= MAX_SOURCE_FRAME_DISTANCE_MS ? vectorFor(nearest.pose) : null;
    if (vector) {
      usable += 1;
      missingRun = 0;
    } else {
      missingRun += 1;
      maxMissingFrameSpan = Math.max(maxMissingFrameSpan, missingRun);
    }
    frames.push(vector ?? LAT_PULLDOWN_FEATURE_NAMES.map(() => null));
  }
  const peakNearest = nearestPose(poses, segment.peakMs);
  const peakFeatureAvailable = peakNearest.distanceMs <= MAX_SOURCE_FRAME_DISTANCE_MS && !!vectorFor(peakNearest.pose);
  return {
    repIndex: segment.repIndex,
    startMs: segment.startMs,
    peakMs: segment.peakMs,
    endMs: segment.endMs,
    featureCoverage: round(usable / FRAMES_PER_REP),
    peakFeatureAvailable,
    maxMissingFrameSpan,
    frames,
  };
}

function validateSegments(
  segments: readonly ApprovedTrajectorySegment[],
  poses: readonly PoseEstimate[],
): string | null {
  if (poses.some((pose, index) => index > 0 && pose.timestampMs < poses[index - 1].timestampMs)) {
    return "关键点时间序列未按时间排序，不能建立轨迹样本。";
  }
  const startBound = poses[0].timestampMs;
  const endBound = poses[poses.length - 1].timestampMs;
  let previousEnd = -Infinity;
  let previousRepIndex = 0;
  for (const segment of segments) {
    const times = [segment.startMs, segment.peakMs, segment.endMs];
    if (!Number.isInteger(segment.repIndex) || segment.repIndex <= 0 || !times.every(Number.isFinite)) {
      return "批准边界包含无效的 rep 编号或时间戳。";
    }
    if (
      segment.startMs < startBound ||
      segment.startMs > segment.peakMs ||
      segment.peakMs > segment.endMs ||
      segment.endMs > endBound ||
      segment.startMs < previousEnd ||
      segment.repIndex <= previousRepIndex
    ) {
      return "批准边界未按时间顺序落在关键点录像范围内。";
    }
    previousEnd = segment.endMs;
    previousRepIndex = segment.repIndex;
  }
  return null;
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

function vectorFor(pose: PoseEstimate): number[] | null {
  const leftShoulder = pose.landmarks[11];
  const rightShoulder = pose.landmarks[12];
  const leftElbow = pose.landmarks[13];
  const rightElbow = pose.landmarks[14];
  const leftWrist = pose.landmarks[15];
  const rightWrist = pose.landmarks[16];
  const leftHip = pose.landmarks[23];
  const rightHip = pose.landmarks[24];
  const required = [
    leftShoulder, rightShoulder, leftElbow, rightElbow, leftWrist, rightWrist, leftHip, rightHip,
  ];
  if (!required.every(visible)) return null;

  const shoulder = midpoint(leftShoulder, rightShoulder);
  const hip = midpoint(leftHip, rightHip);
  const scale = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (!Number.isFinite(scale) || scale < 1e-3) return null;
  const torsoLean = Math.atan2(hip.x - shoulder.x, hip.y - shoulder.y) / Math.PI;
  const vector = [
    (leftWrist.y - shoulder.y) / scale,
    (rightWrist.y - shoulder.y) / scale,
    angleDeg(leftShoulder, leftElbow, leftWrist) / 180,
    angleDeg(rightShoulder, rightElbow, rightWrist) / 180,
    (leftWrist.x - shoulder.x) / scale,
    (rightWrist.x - shoulder.x) / scale,
    torsoLean,
  ];
  return vector.every(Number.isFinite) ? vector.map(round) : null;
}

function visible(landmark: PoseLandmark | undefined): landmark is PoseLandmark {
  return !!landmark && landmark.visibility >= 0.5;
}

function midpoint(left: PoseLandmark, right: PoseLandmark): { x: number; y: number } {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function angleDeg(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (denominator < 1e-6) return Number.NaN;
  const cosine = (first.x * second.x + first.y * second.y) / denominator;
  return Math.acos(Math.min(1, Math.max(-1, cosine))) * 180 / Math.PI;
}

function round(value: number): number {
  return Number(value.toFixed(5));
}

function validCapturePosition(value: unknown): value is CapturePosition {
  return CAPTURE_POSITIONS.some((position) => position.id === value);
}
