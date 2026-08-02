import type { PoseEstimate } from "./PoseEngine";

interface BuildRecordingFixtureInput {
  video: string;
  fallbackDurationSec: number;
  model: string;
  poses: readonly PoseEstimate[];
}

export interface RecordingFixture {
  video: string;
  durationSec: number;
  stepMs: number;
  model: string;
  poses: PoseEstimate[];
}

/** Builds the harness fixture shape, including valid zero-pose recordings. */
export function buildRecordingFixture({
  video,
  fallbackDurationSec,
  model,
  poses,
}: BuildRecordingFixtureInput): RecordingFixture[] {
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
      : poses.map((pose) => ({ ...pose, timestampMs: pose.timestampMs - firstTimestampMs }));

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
