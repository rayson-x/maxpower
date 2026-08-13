import type { PoseVideoEvent } from "../../modules/pose-camera/src/types";
import type { CapturePosition } from "../pose/viewGating";

/**
 * A local-only video is reusable only after the native recorder has finalized
 * the file. `saving` deliberately prevents the caller from unmounting the
 * camera surface and racing the native finalization callback.
 */
export type TrainingVideoSaveState = "saving" | "saved" | "failed";

export interface RecordedVideoReplaySelection {
  exerciseId: string;
  capturePosition: CapturePosition;
  videoPath: string;
}

export function trainingVideoSaveState(
  recordingStopRequested: boolean,
  event: PoseVideoEvent | null,
): TrainingVideoSaveState | undefined {
  if (!recordingStopRequested) return undefined;
  if (event?.status === "saved" && event.path) return "saved";
  if (event?.status === "error") return "failed";
  return "saving";
}

export function replaySelectionFromRecordedVideo(input: {
  event: PoseVideoEvent;
  exerciseId: string;
  capturePosition: CapturePosition;
}): RecordedVideoReplaySelection | undefined {
  if (input.event.status !== "saved" || !input.event.path) return undefined;
  return {
    exerciseId: input.exerciseId,
    capturePosition: input.capturePosition,
    videoPath: input.event.path,
  };
}
