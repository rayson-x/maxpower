import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { MOTION_COPY, useT, getT } from "../../i18n";
import type { CaptureFileRef } from "../../motion/useCaptureSession";
import type { TrainingVideoSaveState } from "../trainingVideo";
import type { SetReport } from "../setReport";
import { colors } from "./theme";

/** 组后报告抽屉：从底部拉起，覆盖在拍摄页上。 */
export function ReportSheet(props: {
  report: SetReport;
  recognitionEnabled: boolean;
  savedFile: CaptureFileRef | null;
  savedVideo?: {
    status: "saved" | "error";
    path?: string;
    fileName?: string;
    durationMs?: number;
  } | null;
  /** Omitted for replay reports; live recording waits for native finalization. */
  videoSaveState?: TrainingVideoSaveState;
  onAgain: () => void;
  onDone: () => void;
  onOpenSavedVideo?: () => void;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}) {
  const { report } = props;
  const t = useT(MOTION_COPY, props.locale);
  const videoSavePending = props.videoSaveState === "saving";
  const videoSaveFailed = props.videoSaveState === "failed";
  const validRatio =
    report.processedFrames > 0
      ? Math.round((report.validFrames / report.processedFrames) * 100)
      : 0;

  // 每个 finding 标题只展示一次（附级别）
  const uniqueFindings = [
    ...new Map(
      report.reps.flatMap((rep) => rep.findings).map((finding) => [finding.title, finding]),
    ).values(),
  ];

  return (
    <View style={styles.overlay}>
      <View style={styles.dim} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <View style={styles.head}>
          <Text style={styles.title}>{t("setReport.title")}</Text>
          <Text style={styles.mono}>{(report.durationMs / 1000).toFixed(0)}s</Text>
        </View>

        {props.recognitionEnabled ? (
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{report.confirmedCount}</Text>
              <Text style={styles.statKey}>{t("setReport.stat.confirmedReps")}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>
                {validRatio}
                <Text style={styles.statUnit}>%</Text>
              </Text>
              <Text style={styles.statKey}>{t("setReport.stat.validFrames")}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>
                {report.processedFps.toFixed(0)}
                <Text style={styles.statUnit}>fps</Text>
              </Text>
              <Text style={styles.statKey}>{t("setReport.stat.decisionFps")}</Text>
            </View>
          </View>
        ) : (
          <View style={styles.recordedOnly}>
            <Text style={styles.recordedOnlyTitle}>{t("setReport.recordedOnly.title")}</Text>
            <Text style={styles.recordedOnlyDetail}>{t("setReport.recordedOnly.detail")}</Text>
          </View>
        )}

        <View style={styles.coachNote}>
          <View style={styles.coachHead}>
            <View style={styles.coachDot} />
            <Text style={styles.coachTitle}>{t("setReport.coachNote.title")}</Text>
            <Text style={styles.coachLocal}>{t("setReport.coachNote.local")}</Text>
          </View>
          <Text style={styles.coachText}>
            {props.recognitionEnabled
              ? report.coachNote
              : t("setReport.coachNote.noProfile")}
          </Text>
        </View>

        {props.recognitionEnabled && uniqueFindings.length > 0 && (
          <View style={styles.findings}>
            {uniqueFindings.map((finding) => (
              <View key={finding.title} style={styles.finding}>
                <View
                  style={[
                    styles.findingIcon,
                    finding.level === "warn" ? styles.findingIconWarn : styles.findingIconOk,
                  ]}
                >
                  <Text>{finding.level === "warn" ? "!" : "✓"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.findingTitle}>{finding.title}</Text>
                  <Text style={styles.findingDetail}>{finding.detail}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {props.recognitionEnabled && report.reps.length > 0 && (
          <>
            <View style={styles.repBars}>
              {report.reps.map((rep) => (
                <View
                  key={rep.repKey}
                  style={[
                    styles.repBar,
                    { height: `${Math.max(18, (rep.amplitudeRatio ?? 0.5) * 70)}%` },
                    rep.belowGroupMedian && styles.repBarLow,
                  ]}
                />
              ))}
            </View>
            <View style={styles.repCap}>
              <Text style={styles.repCapText}>{t("setReport.reps.normalized", { count: report.reps.length })}</Text>
              <Text style={styles.repCapText}>{t("setReport.reps.orangeLegend")}</Text>
            </View>
          </>
        )}

        {props.videoSaveState ? <View style={styles.saveArea}>
          <View style={styles.saveNote}>
            <View style={[styles.saveDot, videoSaveFailed && styles.saveDotFailed]} />
            <Text style={styles.saveText} numberOfLines={1}>
              {props.videoSaveState === "saved"
                ? t("setReport.video.saved", { duration: formatDuration(props.savedVideo?.durationMs, props.locale) })
                : videoSaveFailed
                  ? t("setReport.video.failed")
                  : t("setReport.video.saving")}
            </Text>
          </View>
          <Text style={styles.saveDetail} numberOfLines={1}>
            {props.videoSaveState === "saved"
              ? t("setReport.video.savedDetail")
              : props.savedFile
                ? t("setReport.video.skeletonStored")
                : t("setReport.video.skeletonSealing")}
          </Text>
        </View> : null}

        <View style={styles.ctaRow}>
          <TouchableOpacity disabled={videoSavePending} style={[styles.ghostBtn, videoSavePending && styles.buttonDisabled]} onPress={props.onAgain}>
            <Text style={styles.ghostBtnText}>{videoSavePending ? t("setReport.action.sealing") : t("setReport.action.again")}</Text>
          </TouchableOpacity>
          {props.onOpenSavedVideo && props.videoSaveState === "saved" ? (
            <TouchableOpacity style={styles.replayBtn} onPress={props.onOpenSavedVideo}>
              <Text style={styles.replayBtnText}>{t("setReport.action.replay")}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity disabled={videoSavePending} style={[styles.doneBtn, videoSavePending && styles.buttonDisabled]} onPress={props.onDone}>
            <Text style={styles.doneBtnText}>{videoSavePending ? t("setReport.action.saving") : t("setReport.action.done")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

function formatDuration(durationMs: number | undefined, locale?: string): string {
  const t = getT(MOTION_COPY, locale);
  if (!durationMs || durationMs <= 0) return t("setReport.video.reusable");
  return t("setReport.video.reusableWithDuration", { seconds: Math.max(1, Math.round(durationMs / 1000)) });
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  dim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(5,6,4,0.55)" },
  sheet: {
    height: "72%",
    backgroundColor: colors.paper,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 28,
  },
  handle: {
    width: 44, height: 5, borderRadius: 999, backgroundColor: colors.ink3,
    opacity: 0.35, alignSelf: "center", marginTop: 12, marginBottom: 4,
  },
  head: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "baseline",
    paddingHorizontal: 24, paddingTop: 10,
  },
  title: { fontSize: 24, fontWeight: "900", color: colors.ink, letterSpacing: 1 },
  mono: { fontFamily: "monospace", fontSize: 11, color: colors.ink3 },
  statRow: { flexDirection: "row", gap: 10, paddingHorizontal: 24, marginTop: 14 },
  stat: {
    flex: 1, backgroundColor: colors.white, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 14,
  },
  statValue: { fontSize: 24, fontWeight: "800", color: colors.ink },
  statUnit: { fontSize: 12, color: colors.ink3, fontWeight: "500" },
  statKey: { fontSize: 11, color: colors.ink2, marginTop: 2 },
  recordedOnly: { marginHorizontal: 24, marginTop: 14, backgroundColor: colors.white, borderRadius: 16, padding: 16 },
  recordedOnlyTitle: { fontSize: 15, fontWeight: "800", color: colors.ink },
  recordedOnlyDetail: { fontSize: 12, lineHeight: 19, color: colors.ink2, marginTop: 5 },
  coachNote: {
    marginHorizontal: 24, marginTop: 14, backgroundColor: colors.white, borderRadius: 16,
    padding: 16, borderLeftWidth: 4, borderLeftColor: colors.lime,
  },
  coachHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  coachDot: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.lime },
  coachTitle: { fontSize: 13, fontWeight: "700", color: colors.ink },
  coachLocal: {
    marginLeft: "auto", fontFamily: "monospace", fontSize: 9, color: colors.ink3,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
  },
  coachText: { fontSize: 13, lineHeight: 21, color: colors.ink2 },
  findings: { marginHorizontal: 24, marginTop: 14, gap: 8 },
  finding: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.white, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
  },
  findingIcon: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  findingIconOk: { backgroundColor: "rgba(198,241,53,0.2)" },
  findingIconWarn: { backgroundColor: colors.terraSoft },
  findingTitle: { fontSize: 13, fontWeight: "700", color: colors.ink },
  findingDetail: { fontSize: 11, color: colors.ink3, marginTop: 1 },
  repBars: {
    flexDirection: "row", gap: 4, alignItems: "flex-end", height: 44,
    paddingHorizontal: 24, marginTop: 16,
  },
  repBar: { flex: 1, borderRadius: 4, backgroundColor: colors.lime, minHeight: 8 },
  repBarLow: { backgroundColor: colors.terra, opacity: 0.85 },
  repCap: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 24, marginTop: 6 },
  repCapText: { fontFamily: "monospace", fontSize: 10, color: colors.ink3 },
  saveArea: { marginHorizontal: 24, marginTop: 12, gap: 3 },
  saveNote: { flexDirection: "row", alignItems: "center", gap: 8 },
  saveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime },
  saveDotFailed: { backgroundColor: colors.terra },
  saveText: { fontFamily: "monospace", fontSize: 10, color: colors.ink3, flex: 1 },
  saveDetail: { marginLeft: 16, fontSize: 10, color: colors.ink3 },
  ctaRow: { flexDirection: "row", gap: 10, paddingHorizontal: 24, paddingTop: 14 },
  ghostBtn: {
    flex: 1, height: 54, borderRadius: 16, backgroundColor: colors.white,
    borderWidth: 1.5, borderColor: colors.line, alignItems: "center", justifyContent: "center",
  },
  ghostBtnText: { fontWeight: "900", fontSize: 14, color: colors.ink },
  doneBtn: {
    flex: 1.4, height: 54, borderRadius: 16, backgroundColor: colors.ink,
    alignItems: "center", justifyContent: "center",
  },
  doneBtnText: { fontWeight: "900", fontSize: 14, color: colors.white },
  replayBtn: {
    flex: 1.2, height: 54, borderRadius: 16, backgroundColor: colors.lime,
    alignItems: "center", justifyContent: "center",
  },
  replayBtnText: { fontWeight: "900", fontSize: 14, color: colors.limeInk },
  buttonDisabled: { opacity: 0.45 },
});
