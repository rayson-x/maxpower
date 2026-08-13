import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { CoachApplication } from "../../coach";
import type { CoachStreamSnapshot } from "../../coach/ui";
import { MOTION_COPY, useT } from "../../i18n";
import type { RecordedVideoReplaySelection } from "../trainingVideo";
import { colors, radius } from "./theme";
import {
  closeWorkoutSetRealtime,
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
 * Safe fallback for a platform without the native pose surface. ProductShell
 * normally prevents entry before this is mounted; retaining this boundary
 * keeps an old/restored monitor-mode session recoverable instead of crashing.
 */
export function WorkoutMonitorWorkspace(props: WorkoutMonitorWorkspaceProps) {
  const t = useT(MOTION_COPY, props.locale);
  const exit = async () => {
    await closeWorkoutSetRealtime({
      application: props.application,
      userId: props.userId,
      workoutId: props.workoutId,
      reason: "unsupported",
      setId: props.setContext.setId,
      onClosed: props.onExit,
    });
  };
  return (
    <View style={styles.page}>
      <Text style={styles.title}>{t("capture.unsupported.title")}</Text>
      <Text style={styles.body}>{t("capture.unsupported.body")}</Text>
      <Pressable accessibilityRole="button" onPress={() => void exit()} style={styles.button}>
        <Text style={styles.buttonText}>{t("capture.unsupported.action")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", gap: 12, padding: 28 },
  title: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  body: { color: colors.ink2, fontSize: 14, lineHeight: 21, textAlign: "center" },
  button: { minHeight: 48, borderRadius: radius.chip, paddingHorizontal: 22, justifyContent: "center", backgroundColor: colors.dark, marginTop: 8 },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "900" },
});
