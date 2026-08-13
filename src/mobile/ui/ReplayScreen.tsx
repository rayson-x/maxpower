import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

import {
  PoseCameraView as NativePoseCameraView,
  type PoseEvent,
} from "../../../modules/pose-camera/src/PoseCameraView";
import { decodeMotionPacket, type DecodedMotionPacket } from "../../motion/motionPacket";
import { EXERCISE_REGISTRY } from "../../pose/exerciseRegistry";
import type { CapturePosition } from "../../pose/viewGating";
import { resolveRecognitionCapability } from "../exerciseRecognition";
import { liveObservationLine, phaseLabel } from "../findingsCopy";
import { getT, MOTION_COPY, useT } from "../../i18n";
import { assembleSetReport, type SetReport } from "../setReport";
import { ReportSheet } from "./ReportSheet";
import { colors } from "./theme";
import { HALPE26_CONNECTIONS } from "../../pose/halpe26";

const RTMPOSE_MODEL = "rtmpose-m-halpe26";

interface Size {
  width: number;
  height: number;
}

function exerciseName(exerciseId: string): string {
  try {
    return EXERCISE_REGISTRY.require(exerciseId).nameZh;
  } catch {
    return exerciseId;
  }
}

/**
 * 视频回放屏：Android/iOS 都把设备上的训练视频跑过
 * YOLOX + RTMPose + Rust 管线。回放预览不镜像
 *（previewMirrored=false），播完自动出组后报告。
 */
export function ReplayScreen(props: {
  exerciseId: string;
  capturePosition: CapturePosition;
  videoPath: string;
  onExit: () => void;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}) {
  const locale = props.locale;
  const t = useT(MOTION_COPY, locale);
  const recognition = useMemo(
    () => resolveRecognitionCapability(props.exerciseId, props.capturePosition, mobileRecognitionPlatform()),
    [props.exerciseId, props.capturePosition],
  );
  const [event, setEvent] = useState<PoseEvent | null>(null);
  const [packet, setPacket] = useState<DecodedMotionPacket | null>(null);
  const [viewSize, setViewSize] = useState<Size>({ width: 1, height: 1 });
  const [paused, setPaused] = useState(false);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [report, setReport] = useState<SetReport | null>(null);
  // 进度条：replayPositionMs / replayDurationMs
  const [progress, setProgress] = useState({ positionMs: 0, durationMs: 0 });
  // 重播时通过 key 强制原生视图重建（replayPath 重新生效）
  const [sessionKey, setSessionKey] = useState(0);

  const packetsRef = useRef<DecodedMotionPacket[]>([]);
  const seenRepIds = useRef(new Set<string>());
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [phase, setPhase] = useState<string>(() => phaseLabel("ready", locale));
  const [latestFindings, setLatestFindings] = useState<string>(() => getT(MOTION_COPY, locale)("live.waitingForVideo"));

  const finishReplay = useCallback((nativeEvent: PoseEvent) => {
    const assembled = assembleSetReport(packetsRef.current, {
      processedFrames: nativeEvent.processedFrames ?? 0,
      validFrames: nativeEvent.validFrames ?? 0,
      processedFps: nativeEvent.processedFps ?? 0,
    }, locale);
    setReport(assembled);
  }, [locale]);

  const onPose = useCallback(
    ({ nativeEvent }: { nativeEvent: PoseEvent }) => {
      if (nativeEvent.error) {
        setNativeError(nativeEvent.error);
        return;
      }
      if (nativeEvent.replayDurationMs !== undefined) {
        setProgress({
          positionMs: nativeEvent.replayPositionMs ?? 0,
          durationMs: nativeEvent.replayDurationMs,
        });
      }
      if (nativeEvent.replayEnded) {
        finishReplay(nativeEvent);
        return;
      }
      if (!nativeEvent.packetBase64) {
        setPacket(null);
        setEvent(nativeEvent);
        return;
      }
      try {
        const decoded = decodeMotionPacket(decodeBase64(nativeEvent.packetBase64));
        setPacket(decoded);
        setEvent(nativeEvent);
        packetsRef.current.push(decoded);
        setPhase(phaseLabel(decoded.repState.phase, locale) ?? decoded.repState.phase);
        for (const rep of decoded.completedReps) {
          if (rep.disposition !== "confirmed") continue;
          const key = `${decoded.subjectEpoch}:${rep.repId}:${rep.revision}`;
          if (!seenRepIds.current.has(key)) {
            seenRepIds.current.add(key);
            setConfirmedCount(seenRepIds.current.size);
            setLatestFindings(liveObservationLine(rep.observationFindings, locale));
          }
        }
      } catch (error) {
        setPacket(null);
        setNativeError(error instanceof Error ? error.message : String(error));
      }
    },
    [finishReplay, locale],
  );

  const replayAgain = useCallback(() => {
    packetsRef.current = [];
    seenRepIds.current = new Set();
    setConfirmedCount(0);
    setReport(null);
    setPaused(false);
    setProgress({ positionMs: 0, durationMs: 0 });
    setLatestFindings(t("live.waitingForVideo"));
    setEvent(null);
    setPacket(null);
    setSessionKey((key) => key + 1);
  }, [t]);

  const onLayout = useCallback((layoutEvent: LayoutChangeEvent) => {
    const { width, height } = layoutEvent.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);


  const mapping = useMemo(() => {
    if (!event || event.width === 0 || event.height === 0) return null;
    const scale = Math.min(viewSize.width / event.width, viewSize.height / event.height);
    return {
      offsetX: (viewSize.width - event.width * scale) / 2,
      offsetY: (viewSize.height - event.height * scale) / 2,
      drawnWidth: event.width * scale,
      drawnHeight: event.height * scale,
    };
  }, [event, viewSize]);

  const visibleLandmarks = useMemo(() => {
    if (!packet) return [];
    return packet.canonical
      .map((landmark, index) => ({
        index,
        x: landmark.x ?? Number.NaN,
        y: landmark.y ?? Number.NaN,
        visibility: landmark.canonicalConfidence,
      }))
      .filter((l) => Number.isFinite(l.x) && Number.isFinite(l.y) && l.visibility >= 0.3);
  }, [packet]);

  const pointOf = (index: number) => {
    const landmark = visibleLandmarks.find((entry) => entry.index === index);
    if (!landmark || !mapping) return null;
    return {
      x: mapping.offsetX + (event?.previewMirrored ? 1 - landmark.x : landmark.x) * mapping.drawnWidth,
      y: mapping.offsetY + landmark.y * mapping.drawnHeight,
    };
  };

  const progressRatio =
    progress.durationMs > 0 ? Math.min(1, progress.positionMs / progress.durationMs) : 0;
  const videoName = props.videoPath.split("/").pop() ?? props.videoPath;
  const replayAnalysisAvailable = recognition.canRunRustRecognition;

  return (
    <View style={styles.page}>
      <View style={styles.stage} onLayout={onLayout}>
        <NativePoseCameraView
          key={sessionKey}
          style={StyleSheet.absoluteFill}
          model={RTMPOSE_MODEL}
          recognitionProfile={recognition.nativeProfileJson}
          lensFacing="back"
          recognitionActive={replayAnalysisAvailable}
          replayPath={props.videoPath}
          replayPaused={paused}
          onPose={onPose}
        />
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}>
          {mapping && event?.equipmentAxis && (
            <Line
              x1={mapping.offsetX + event.equipmentAxis.x1 * mapping.drawnWidth}
              y1={mapping.offsetY + event.equipmentAxis.y1 * mapping.drawnHeight}
              x2={mapping.offsetX + event.equipmentAxis.x2 * mapping.drawnWidth}
              y2={mapping.offsetY + event.equipmentAxis.y2 * mapping.drawnHeight}
              stroke={event.equipmentAxis.source === "measured" ? "#FFD23F" : "#FF8A3D"}
              strokeWidth="4"
              strokeLinecap="round"
            />
          )}
          {mapping && HALPE26_CONNECTIONS.map(([from, to]) => {
            const start = pointOf(from);
            const end = pointOf(to);
            if (!start || !end) return null;
            return (
              <Line
                key={`${from}-${to}`}
                x1={start.x} y1={start.y} x2={end.x} y2={end.y}
                stroke={colors.skeletonStroke}
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          })}
          {mapping && visibleLandmarks.map((landmark) => {
            const point = pointOf(landmark.index);
            return point ? (
              <Circle key={landmark.index} cx={point.x} cy={point.y} r="4" fill={colors.jointDot} />
            ) : null;
          })}
        </Svg>

        {/* 顶部：相位 + 回放标识 */}
        <View style={styles.hudTop}>
          <View style={styles.phasePill}>
            <View style={styles.phasePulse} />
            <Text style={styles.phaseText}>
              {replayAnalysisAvailable
                ? recognition.canEmitPhase ? phase : t("replay.noProfileForAngle")
                : t("replay.localPlayback")}
            </Text>
          </View>
          <View style={styles.replayChip}>
            <Text style={styles.replayChipText}>{t(replayAnalysisAvailable ? "replay.chip.analyzing" : "replay.chip.localOnly")}</Text>
          </View>
        </View>

        {recognition.canCount && (
          <View style={styles.repCluster}>
            <Text style={styles.repNum}>{String(confirmedCount).padStart(2, "0")}</Text>
            <Text style={styles.repLabel}>REPS</Text>
          </View>
        )}

        {/* agent 便签条 */}
        <View style={styles.agentStrip}>
          <View style={styles.agentDot}><Text style={{ fontSize: 12 }}>⚡</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.agentText}>{latestFindings}</Text>
            <Text style={styles.agentSub}>
              {replayAnalysisAvailable ? exerciseName(props.exerciseId) : t("replay.playbackOnly")} · {videoName}
            </Text>
          </View>
        </View>

        {/* 进度条 + 底部控制 */}
        <View style={styles.hudBottom}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { flex: progressRatio }]} />
            <View style={{ flex: 1 - progressRatio }} />
          </View>
          <View style={styles.controls}>
            <TouchableOpacity style={styles.iconBtn} onPress={props.onExit}>
              <Text style={styles.iconBtnText}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pauseBtn} onPress={() => setPaused((value) => !value)}>
              <Text style={styles.pauseBtnText}>{t(paused ? "replay.resume" : "replay.pause")}</Text>
            </TouchableOpacity>
            <View style={styles.timeBox}>
              <Text style={styles.timeText}>
                {formatMs(progress.positionMs)} / {formatMs(progress.durationMs)}
              </Text>
            </View>
          </View>
        </View>

        {nativeError && (
          <View style={styles.errorBanner}><Text style={styles.errorText}>{nativeError}</Text></View>
        )}
      </View>

      {report && (
        <ReportSheet
          report={report}
          recognitionEnabled={recognition.canRunRustRecognition}
          savedFile={null}
          onAgain={replayAgain}
          onDone={props.onExit}
          locale={locale}
        />
      )}
    </View>
  );
}

function mobileRecognitionPlatform(): "android" | "ios" | "web" {
  return Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(totalSec / 60)).padStart(2, "0")}:${String(totalSec % 60).padStart(2, "0")}`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.dark },
  stage: { flex: 1, backgroundColor: "#000" },
  hudTop: {
    position: "absolute", top: 58, left: 20, right: 20,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  phasePill: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(14,16,14,0.65)", borderWidth: 1, borderColor: "rgba(198,241,53,0.3)",
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999,
  },
  phasePulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime },
  phaseText: { color: colors.lime, fontSize: 13, fontWeight: "900" },
  replayChip: {
    backgroundColor: "rgba(255,255,255,0.12)", borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
  },
  replayChipText: { color: colors.white, fontSize: 12, fontWeight: "900" },
  repCluster: { position: "absolute", left: 24, bottom: 190 },
  repNum: { fontSize: 96, fontWeight: "900", color: colors.lime, lineHeight: 96 },
  repLabel: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 8, fontFamily: "monospace", letterSpacing: 2 },
  agentStrip: {
    position: "absolute", left: 20, right: 20, bottom: 132,
    backgroundColor: "rgba(14,16,14,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    borderLeftWidth: 4, borderLeftColor: colors.lime, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", gap: 12, alignItems: "center",
  },
  agentDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
  agentText: { color: colors.white, fontSize: 13, fontWeight: "700" },
  agentSub: { color: "rgba(255,255,255,0.4)", fontSize: 10, fontFamily: "monospace", marginTop: 2 },
  hudBottom: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 24, paddingBottom: 34, gap: 14,
  },
  progressTrack: {
    height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.18)",
    flexDirection: "row", overflow: "hidden",
  },
  progressFill: { backgroundColor: colors.lime, borderRadius: 3 },
  controls: { flexDirection: "row", alignItems: "center", gap: 14 },
  iconBtn: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  iconBtnText: { color: colors.white, fontSize: 18 },
  pauseBtn: { flex: 1, height: 56, borderRadius: 18, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  pauseBtnText: { color: colors.ink, fontWeight: "900", fontSize: 15, letterSpacing: 2 },
  timeBox: { minWidth: 96, alignItems: "flex-end" },
  timeText: { color: "rgba(255,255,255,0.75)", fontSize: 12, fontFamily: "monospace" },
  errorBanner: { position: "absolute", bottom: 220, left: 20, right: 20 },
  errorText: { color: "#f87171", fontSize: 12, textAlign: "center" },
});
