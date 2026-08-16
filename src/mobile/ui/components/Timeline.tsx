import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { canCorrectTimelineEntry, timelineSummary, type CoachProductProjection } from "../../../product";
import type { TimelineReadEvent } from "../../../timeline";
import { uiColors, uiType } from "../../ui-kit";
import { mobileT } from "../../../i18n";


type TimelineEntry = CoachProductProjection["today"]["activityLog"]["entries"][number];

/**
 * Renders only confirmed historical facts.  Recommendation surfaces never
 * reuse this module, which keeps calendar history and today's guidance from
 * being visually or semantically mixed together.
 */
export function Timeline({
  entries,
  compact = false,
  onCorrect,
}: {
  entries: readonly TimelineEntry[];
  compact?: boolean;
  onCorrect?(entry: TimelineReadEvent): void;
}) {
  if (!entries.length) return null;

  return (
    <View style={[styles.timeline, compact && styles.timelineCompact]}>
      {entries.map((entry) => (
        <View key={entry.eventId} style={styles.row}>
          <Text style={styles.time}>{entry.occurredAt.slice(11, 16)}</Text>
          <View style={styles.dot} />
          <View style={styles.body}>
            <Text style={styles.title}>{timelineSummary(entry)}</Text>
            <Text style={styles.meta}>
              {entry.envelope?.provenance.confidence === "estimated" ? mobileT("mobile.ui.components.timeline.b73b8f52b0") : mobileT("mobile.ui.components.timeline.d9fea67ad2")}
              {" · "}
              {entry.envelope?.provenance.origin ?? mobileT("mobile.ui.components.timeline.e8666c377c")}
            </Text>
          </View>
          {onCorrect && canCorrectTimelineEntry(entry) ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={mobileT("mobile.ui.components.timeline.7272ec1719", { value0: timelineSummary(entry) })}
              hitSlop={8}
              onPress={() => onCorrect(entry)}
              style={({ pressed }) => [styles.correct, pressed && styles.correctPressed]}
            >
              <Text style={styles.correctText}>{mobileT("mobile.ui.components.timeline.193dc7f1dc")}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  timeline: { gap: 0 },
  timelineCompact: { gap: 0 },
  row: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: uiColors.line,
  },
  time: { width: 36, color: uiColors.inkFaint, fontFamily: uiType.mono, fontSize: 10, fontWeight: "800" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: uiColors.limeDeep },
  body: { flex: 1, minWidth: 0 },
  title: { color: uiColors.ink, fontFamily: uiType.body, fontSize: 13, fontWeight: "800" },
  meta: { marginTop: 3, color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 10 },
  correct: { minHeight: 30, justifyContent: "center", paddingHorizontal: 8, borderRadius: 10, backgroundColor: uiColors.paper },
  correctPressed: { opacity: 0.62 },
  correctText: { color: uiColors.inkMuted, fontFamily: uiType.body, fontSize: 11, fontWeight: "800" },
});
