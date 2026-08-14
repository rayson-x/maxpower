import React, { useMemo } from "react";

import type { PoseVideoEvent } from "../../../modules/pose-camera/src/types";
import type { CoachApplication } from "../../coach";
import type { CoachStreamSnapshot } from "../../coach/ui";
import { recommendCapturePosition } from "../../pose/viewGating";
import { defaultLensFacing, resolveRecognitionCapability } from "../exerciseRecognition";
import {
  replaySelectionFromRecordedVideo,
  type RecordedVideoReplaySelection,
} from "../trainingVideo";
import { LiveScreen } from "./LiveScreen";
import {
  closeWorkoutSetRealtime,
  pauseWorkoutSetRealtimeForSafety,
  persistAndCloseWorkoutSetObservation,
  type WorkoutSetObservation,
  type WorkoutSetRealtimeContext,
} from "./workoutRealtime";

export interface WorkoutMonitorWorkspaceProps {
  application: CoachApplication;
  userId: string;
  workoutId: string;
  exerciseVariantId?: string;
  setContext: WorkoutSetRealtimeContext;
  coachStream: CoachStreamSnapshot;
  onSendToCoach: (text: string) => Promise<void> | void;
  onCoachCardAction: (actionId: string, artifactId: string) => Promise<void> | void;
  onCoachHumanAction: (pendingActionId: string, optionId: string) => Promise<void> | void;
  onExit: () => void;
  onObservationReady: (observation: WorkoutSetObservation) => void;
  onOpenSavedVideo?: (selection: RecordedVideoReplaySelection) => void;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}

/**
 * iOS records a local training video and preserves manual execution workflow.
 * Its capability payload explicitly disables canonical counting until the
 * shared Rust bridge is delivered, so no visual estimate becomes a performed
 * set or a Coach cue.
 */
export function WorkoutMonitorWorkspace(props: WorkoutMonitorWorkspaceProps) {
  const exerciseId = props.exerciseVariantId ?? "unknown";
  const config = useMemo(() => {
    const capturePosition = recommendCapturePosition(exerciseId)?.position ?? "front";
    return {
      exerciseId,
      capturePosition,
      lensFacing: defaultLensFacing(exerciseId),
      selectedEquipment: props.setContext.selectedEquipment ?? "none",
      recognition: resolveRecognitionCapability(exerciseId, capturePosition, "ios", {
        selectedEquipment: props.setContext.selectedEquipment,
      }),
    };
  }, [exerciseId, props.setContext.selectedEquipment]);
  const exit = async () => {
    await closeWorkoutSetRealtime({ application: props.application, userId: props.userId, workoutId: props.workoutId, reason: "exit", setId: props.setContext.setId, onClosed: props.onExit });
  };
  const openSavedVideo = async (video: PoseVideoEvent) => {
    const selection = replaySelectionFromRecordedVideo({
      event: video,
      exerciseId,
      capturePosition: config.capturePosition,
    });
    if (!selection) return;
    await closeWorkoutSetRealtime({ application: props.application, userId: props.userId, workoutId: props.workoutId, reason: "recorded_video", setId: props.setContext.setId, onClosed: () => props.onOpenSavedVideo?.(selection) });
  };
  const finishObservation = async (observation: WorkoutSetObservation) => {
    await persistAndCloseWorkoutSetObservation({ application: props.application, userId: props.userId, workoutId: props.workoutId, observation, onReady: props.onObservationReady });
  };
  const permissionDenied = () => closeWorkoutSetRealtime({ application: props.application, userId: props.userId, workoutId: props.workoutId, reason: "permission_denied", setId: props.setContext.setId, onClosed: props.onExit });
  const safetyPause = (signal: Parameters<typeof pauseWorkoutSetRealtimeForSafety>[0]["signal"]) => pauseWorkoutSetRealtimeForSafety({ application: props.application, userId: props.userId, workoutId: props.workoutId, signal, onPaused: props.onExit });
  return <LiveScreen config={config} setContext={props.setContext} coachStream={props.coachStream} onSendToCoach={props.onSendToCoach} onCoachCardAction={props.onCoachCardAction} onCoachHumanAction={props.onCoachHumanAction} onExit={() => void exit()} onPermissionDenied={permissionDenied} onSafetyPause={safetyPause} onSetObservationReady={finishObservation} onOpenSavedVideo={openSavedVideo} locale={props.locale} />;
}
