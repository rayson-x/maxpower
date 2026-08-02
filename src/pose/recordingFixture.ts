import type { PoseEstimate } from "./PoseEngine";

interface BuildRecordingFixtureInput<TPose extends PoseEstimate> {
  video: string;
  fallbackDurationSec: number;
  model: string;
  poses: readonly TPose[];
}

export interface RecordingFixture<TPose extends PoseEstimate = PoseEstimate> {
  video: string;
  durationSec: number;
  stepMs: number;
  model: string;
  poses: TPose[];
}

/** Builds the harness fixture shape, including valid zero-pose recordings. */
export function buildRecordingFixture<TPose extends PoseEstimate>({
  video,
  fallbackDurationSec,
  model,
  poses,
}: BuildRecordingFixtureInput<TPose>): RecordingFixture<TPose>[] {
  const firstTimestampMs = poses[0]?.timestampMs;
  const lastTimestampMs = poses[poses.length - 1]?.timestampMs;
  const hasPoseDuration =
    firstTimestampMs !== undefined && lastTimestampMs !== undefined && poses.length > 1;
  const durationSec = hasPoseDuration
    ? (lastTimestampMs - firstTimestampMs) / 1000
    : Math.max(0, fallbackDurationSec);
  const rebasedPoses =
    firstTimestampMs === undefined
      ? []
      : poses.map((pose) => rebasePose(pose, firstTimestampMs));

  return [
    {
      video,
      durationSec: Number(durationSec.toFixed(3)),
      stepMs: poses.length > 1 ? Number((durationSec * 1000 / (poses.length - 1)).toFixed(1)) : 0,
      model,
      poses: rebasedPoses,
    },
  ];
}

function rebasePose<TPose extends PoseEstimate>(
  pose: TPose,
  firstTimestampMs: number,
): TPose {
  const rebased = {
    ...pose,
    timestampMs: pose.timestampMs - firstTimestampMs,
  };

  if (
    "sourceTimestampMs" in pose &&
    typeof pose.sourceTimestampMs === "number"
  ) {
    return {
      ...rebased,
      sourceTimestampMs: pose.sourceTimestampMs - firstTimestampMs,
    } as TPose;
  }

  return rebased as TPose;
}
