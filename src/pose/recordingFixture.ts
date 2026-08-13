import type { PoseEstimate } from "./PoseEngine";
import type { CanonicalPoseFrame } from "./canonicalPose";

/** Compact inference evidence; landmark visibility remains on each pose frame. */
export interface RecordingFrameDiagnostic {
  timestampMs: number;
  hasPose: boolean;
  inferenceMs: number;
}

interface BuildRecordingFixtureInput<TPose extends PoseEstimate> {
  video: string;
  fallbackDurationSec: number;
  model: string;
  poses: readonly TPose[];
  diagnostics?: readonly RecordingFrameDiagnostic[];
}

export interface RecordingFixture<TPose extends PoseEstimate = PoseEstimate> {
  video: string;
  durationSec: number;
  stepMs: number;
  model: string;
  poses: TPose[];
  diagnostics?: RecordingFrameDiagnostic[];
}

/** Builds the harness fixture shape, including valid zero-pose recordings. */
export function buildRecordingFixture(
  input: BuildRecordingFixtureInput<CanonicalPoseFrame>,
): RecordingFixture<CanonicalPoseFrame>[];
export function buildRecordingFixture(
  input: BuildRecordingFixtureInput<PoseEstimate>,
): RecordingFixture<PoseEstimate>[];
export function buildRecordingFixture({
  video,
  fallbackDurationSec,
  model,
  poses,
  diagnostics = [],
}: BuildRecordingFixtureInput<PoseEstimate>): RecordingFixture<PoseEstimate>[] {
  assertSingleCanonicalSequence(poses);
  const firstTimestampMs = poses[0]?.timestampMs;
  const lastTimestampMs = poses[poses.length - 1]?.timestampMs;
  const hasPoseDuration =
    firstTimestampMs !== undefined && lastTimestampMs !== undefined && poses.length > 1;
  const poseDurationSec = hasPoseDuration
    ? (lastTimestampMs - firstTimestampMs) / 1000
    : 0;
  const mediaDurationSec = Number.isFinite(fallbackDurationSec)
    ? Math.max(0, fallbackDurationSec)
    : 0;
  // The pose span describes analysis coverage, not the source media length.
  // Keeping the larger bound prevents a throttled/backgrounded extractor from
  // collapsing a full recording into only the frames it managed to process.
  const durationSec = Math.max(mediaDurationSec, poseDurationSec);
  const rebasedPoses =
    firstTimestampMs === undefined
      ? []
      : poses.map((pose) => rebasePose(pose, firstTimestampMs));

  return [
    {
      video,
      durationSec: Number(durationSec.toFixed(3)),
      stepMs: poses.length > 1 ? Number((poseDurationSec * 1000 / (poses.length - 1)).toFixed(1)) : 0,
      model,
      poses: rebasedPoses,
      ...(diagnostics.length > 0
        ? {
            diagnostics: diagnostics.map((diagnostic) => ({
              ...diagnostic,
              timestampMs: firstTimestampMs === undefined
                ? diagnostic.timestampMs
                : diagnostic.timestampMs - firstTimestampMs,
            })),
          }
        : {}),
    },
  ];
}

function rebasePose(
  pose: CanonicalPoseFrame,
  firstTimestampMs: number,
): CanonicalPoseFrame;
function rebasePose(
  pose: PoseEstimate,
  firstTimestampMs: number,
): PoseEstimate;
function rebasePose(
  pose: PoseEstimate,
  firstTimestampMs: number,
): PoseEstimate {
  const rebased = {
    ...pose,
    timestampMs: pose.timestampMs - firstTimestampMs,
  };

  if (
    "sourceTimestampMs" in pose &&
    typeof pose.sourceTimestampMs === "number"
  ) {
    const rebasedSourcePose = {
      ...rebased,
      sourceTimestampMs: pose.sourceTimestampMs - firstTimestampMs,
    };
    return rebasedSourcePose;
  }

  return rebased;
}

function assertSingleCanonicalSequence(poses: readonly PoseEstimate[]): void {
  const canonicalFrames = poses.filter(isCanonicalPoseFrame);
  if (canonicalFrames.length === 0) return;

  const first = canonicalFrames[0];
  const isMixed =
    canonicalFrames.length !== poses.length ||
    canonicalFrames.some(
      (frame) =>
        frame.sequenceId !== first.sequenceId ||
        frame.schema !== first.schema ||
        frame.algorithmVersion !== first.algorithmVersion,
    );
  if (isMixed) {
    throw new Error("Recording contains mixed canonical sequences");
  }
}

function isCanonicalPoseFrame(pose: PoseEstimate): pose is CanonicalPoseFrame {
  return (
    "contractVersion" in pose &&
    pose.contractVersion === "canonical-pose-frame/v1"
  );
}
