import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import {
  PoseCameraView as NativePoseCameraView,
  type PoseEvent,
  type PoseVideoEvent,
} from "../../../modules/pose-camera/src/PoseCameraView";
import { decodeMotionPacket, type DecodedMotionPacket } from "../../motion/motionPacket";
import { buildJointAngleArc } from "../../motion/jointAngleOverlay";
import { useCaptureSession, type CaptureFileRef } from "../../motion/useCaptureSession";
import { assessFraming } from "../frameGating";
import { HALPE26_CONNECTIONS } from "../../pose/halpe26";
import { liveObservationLine, phaseLabel } from "../findingsCopy";
import { getT, MOTION_COPY, useT } from "../../i18n";
import { assembleSetReport, type SetReport } from "../setReport";
import { trainingVideoSaveState } from "../trainingVideo";
import type { SessionConfig } from "./SetupScreen";
import { ReportSheet } from "./ReportSheet";
import { colors } from "./theme";
import type { CoachStreamSnapshot } from "../../coach/ui";
import { buildWorkoutSetObservation, projectLatestCanonicalRepRevisions, type CanonicalRepRevisionPacket, type WorkoutSafetySignal, type WorkoutSetObservation, type WorkoutSetRealtimeContext } from "./workoutRealtime";
import {
  projectCameraCoachPresentation,
  type CameraCoachAction,
} from "./cameraCoachPresentation";

function emptyCoachStream(locale?: string): CoachStreamSnapshot {
  return {
    status: "empty",
    parts: [],
    emptyMessage: getT(MOTION_COPY, locale)("capture.coach.emptyStream"),
  };
}

const RTMPOSE_MODEL = "rtmpose-m-halpe26";

interface Size {
  width: number;
  height: number;
}

/** 实时识别屏：骨架叠加 + HUD + 自动录制 + 组后报告抽屉。 */
export function LiveScreen(props: {
  config: SessionConfig;
  setContext?: WorkoutSetRealtimeContext;
  coachStream?: CoachStreamSnapshot;
  onSendToCoach?: (text: string) => Promise<void> | void;
  onCoachCardAction?: (actionId: string, artifactId: string) => Promise<void> | void;
  onCoachHumanAction?: (pendingActionId: string, optionId: string) => Promise<void> | void;
  onExit: () => void;
  onPermissionDenied?: () => Promise<void> | void;
  onSafetyPause?: (signal: WorkoutSafetySignal) => Promise<void> | void;
  onSetObservationReady?: (observation: WorkoutSetObservation) => Promise<void> | void;
  onOpenSavedVideo?: (video: PoseVideoEvent) => Promise<void> | void;
  /** From profile.locale; falls back to English when unknown. */
  locale?: string;
}) {
  const { config } = props;
  const locale = props.locale;
  const t = useT(MOTION_COPY, locale);
  const capture = useCaptureSession();
  const recognitionAvailable = config.recognition.canRunRustRecognition;

  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">(
    Platform.OS === "android" ? "unknown" : "granted",
  );

  // 挂载时先查权限：已授权就直接进相机，不打扰
  useEffect(() => {
    if (Platform.OS !== "android") return;
    PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA).then((granted) => {
      if (granted) setPermission("granted");
    });
  }, []);
  const [active, setActive] = useState(false);
  const [event, setEvent] = useState<PoseEvent | null>(null);
  const [packet, setPacket] = useState<DecodedMotionPacket | null>(null);
  const [viewSize, setViewSize] = useState<Size>({ width: 1, height: 1 });
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [report, setReport] = useState<SetReport | null>(null);
  const [savedFile, setSavedFile] = useState<CaptureFileRef | null>(null);
  const [savedVideo, setSavedVideo] = useState<PoseVideoEvent | null>(null);
  const [videoStopRequested, setVideoStopRequested] = useState(false);
  const [lensFacing, setLensFacing] = useState<"front" | "back">(config.lensFacing);
  const [lensSwitching, setLensSwitching] = useState(false);
  const [coachComposerOpen, setCoachComposerOpen] = useState(false);
  const [coachMessage, setCoachMessage] = useState("");
  const [lastUserMessage, setLastUserMessage] = useState<string>();
  const [coachSending, setCoachSending] = useState(false);
  const [coachNotice, setCoachNotice] = useState<string>();
  const [safetyChoicesOpen, setSafetyChoicesOpen] = useState(false);
  const lensSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const packetsRef = useRef<DecodedMotionPacket[]>([]);
  const latestRepRevisionsRef = useRef(new Map<string, CanonicalRepRevisionPacket>());
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [phase, setPhase] = useState<string>(() => phaseLabel("ready", locale));
  const [latestFindings, setLatestFindings] = useState<string>(() => getT(MOTION_COPY, locale)("live.waitingForMotion"));
  const startedAtRef = useRef(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const framingRef = useRef({ ok: true, hintText: null as string | null });
  const [framing, setFraming] = useState(framingRef.current);

  useEffect(() => {
    setLensFacing(config.lensFacing);
  }, [config.lensFacing]);
  useEffect(() => () => {
    if (lensSwitchTimerRef.current) clearTimeout(lensSwitchTimerRef.current);
  }, []);

  const requestPermission = useCallback(async () => {
    if (Platform.OS !== "android") return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    const next = result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
    setPermission(next);
    if (next === "denied") await props.onPermissionDenied?.();
  }, [props.onPermissionDenied]);

  const onPose = useCallback(
    ({ nativeEvent }: { nativeEvent: PoseEvent }) => {
      if (nativeEvent.error) {
        setNativeError(nativeEvent.error);
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
        if (active) {
          packetsRef.current.push(decoded);
          capture.ingestPoseEvent(nativeEvent);
        }
        setPhase(phaseLabel(decoded.repState.phase, locale) ?? decoded.repState.phase);
        if (active) {
          for (const rep of decoded.completedReps) {
            const key = `${decoded.subjectEpoch}:${rep.repId}`;
            const previous = latestRepRevisionsRef.current.get(key)?.completedReps[0];
            if (previous && previous.revision > rep.revision) continue;
            // Refresh insertion order so the latest revised confirmed rep owns
            // the one live observation line.
            latestRepRevisionsRef.current.delete(key);
            latestRepRevisionsRef.current.set(key, {
              subjectEpoch: decoded.subjectEpoch,
              completedReps: [rep],
            });
          }
          const reps = projectLatestCanonicalRepRevisions([...latestRepRevisionsRef.current.values()]);
          setConfirmedCount(reps.confirmedCount);
          setLatestFindings(reps.confirmedCount > 0
            ? liveObservationLine(reps.latestConfirmedFindings, locale)
            : t("live.waitingForMotion"));
        }
        // 入框校验：按 canonical 坐标，节流为状态变化时才 setState
        const assessment = assessFraming(
          decoded.canonical.map((l) => ({
            x: l.x,
            y: l.y,
            visibility: l.canonicalConfidence,
          })),
          nativeEvent.poseSchema,
          locale,
        );
        if (
          assessment.ok !== framingRef.current.ok ||
          assessment.hintText !== framingRef.current.hintText
        ) {
          framingRef.current = { ok: assessment.ok, hintText: assessment.hintText };
          setFraming(framingRef.current);
        }
        if (active && startedAtRef.current > 0) {
          setElapsedSec(Math.round((Date.now() - startedAtRef.current) / 1000));
        }
      } catch (error) {
        setPacket(null);
        setNativeError(error instanceof Error ? error.message : String(error));
      }
    },
    [active, capture, locale, t],
  );

  const startSet = useCallback(() => {
    packetsRef.current = [];
    latestRepRevisionsRef.current.clear();
    setConfirmedCount(0);
    setReport(null);
    setSavedFile(null);
    setSavedVideo(null);
    setVideoStopRequested(false);
    setLatestFindings(
      recognitionAvailable ? t("live.waitingForMotion") : t("live.recordOnly"),
    );
    startedAtRef.current = Date.now();
    setElapsedSec(0);
    capture.startRecording({
      exerciseId: config.exerciseId,
      capturePosition: config.capturePosition,
      lensFacing,
      model: RTMPOSE_MODEL,
      startedAtMs: Date.now(),
    });
    setActive(true);
  }, [capture, config.capturePosition, config.exerciseId, lensFacing, recognitionAvailable]);

  const endSet = useCallback(async () => {
    if (!active) return;
    setActive(false);
    setVideoStopRequested(true);
    const last = event;
    const assembled = assembleSetReport(packetsRef.current, {
      processedFrames: last?.processedFrames ?? 0,
      validFrames: last?.validFrames ?? 0,
      processedFps: last?.processedFps ?? 0,
    }, locale);
    try {
      const ref = await capture.stopRecording();
      setSavedFile(ref);
    } catch (cause) {
      setNativeError(cause instanceof Error ? cause.message : t("capture.error.skeletonNotSaved"));
    }
    if (props.onSetObservationReady && props.setContext && packetsRef.current.length) {
      try {
        await props.onSetObservationReady(buildWorkoutSetObservation({
          context: props.setContext,
          packets: packetsRef.current,
          report: assembled,
          observedAt: new Date().toISOString(),
        }));
      } catch (cause) {
        setNativeError(cause instanceof Error ? cause.message : "观察结果未能保存，已返回手动记录。");
        props.onExit();
      }
      return;
    }
    if (props.setContext && packetsRef.current.length === 0) {
      props.onExit();
      return;
    }
    setReport(assembled);
  }, [active, capture, event, locale, props.onSetObservationReady, props.setContext]);

  const onLayout = useCallback((layoutEvent: LayoutChangeEvent) => {
    const { width, height } = layoutEvent.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  const onVideo = useCallback(({ nativeEvent }: { nativeEvent: PoseVideoEvent }) => {
    setSavedVideo(nativeEvent);
    if (nativeEvent.status === "error") {
      setNativeError(nativeEvent.error ?? t("capture.error.videoNotSaved"));
      if (nativeEvent.error === "camera_permission_denied") {
        setPermission("denied");
        void Promise.resolve(props.onPermissionDenied?.()).catch(() => props.onExit());
      }
      return;
    }
  }, [props.onExit, props.onPermissionDenied, t]);

  const videoSaveState = trainingVideoSaveState(videoStopRequested, savedVideo);
  const exitCamera = useCallback(() => {
    // Do not unmount a live camera recording: request its finalization first.
    if (active) {
      void endSet();
      return;
    }
    props.onExit();
  }, [active, endSet, props]);
  const safetyPause = useCallback(async (signal: WorkoutSafetySignal) => {
    if (active) {
      setActive(false);
      setVideoStopRequested(true);
      try {
        await capture.stopRecording();
      } catch {
        // Safety takes precedence over retaining an incomplete local capture.
      }
    }
    await props.onSafetyPause?.(signal);
  }, [active, capture, props.onSafetyPause]);
  const openSavedVideo = useCallback(() => {
    if (!savedVideo || savedVideo.status !== "saved" || !savedVideo.path || !props.onOpenSavedVideo) return;
    void Promise.resolve(props.onOpenSavedVideo(savedVideo)).catch((cause: unknown) => {
      setNativeError(cause instanceof Error ? cause.message : t("capture.error.videoNotOpened"));
    });
  }, [props, savedVideo]);

  const switchLens = useCallback(() => {
    if (lensSwitching) return;
    const next = lensFacing === "front" ? "back" : "front";
    setLensSwitching(true);
    setLensFacing(next);
    setCoachNotice(t(next === "front" ? "capture.lens.switchingToFront" : "capture.lens.switchingToBack"));
    if (lensSwitchTimerRef.current) clearTimeout(lensSwitchTimerRef.current);
    lensSwitchTimerRef.current = setTimeout(() => {
      setLensSwitching(false);
      setCoachNotice(undefined);
    }, 900);
  }, [lensFacing, lensSwitching]);

  const submitCoachMessage = useCallback(async () => {
    const trimmed = coachMessage.trim();
    if (!trimmed || coachSending) return;
    if (!props.onSendToCoach) {
      setCoachNotice(t("capture.coach.notConnected"));
      return;
    }
    setLastUserMessage(trimmed);
    setCoachMessage("");
    setCoachComposerOpen(false);
    setCoachSending(true);
    setCoachNotice(t("capture.coach.readingContext"));
    Keyboard.dismiss();
    try {
      await props.onSendToCoach(trimmed);
      setCoachNotice(undefined);
    } catch (cause) {
      setCoachNotice(cause instanceof Error ? cause.message : t("capture.coach.didNotFinish"));
    } finally {
      setCoachSending(false);
    }
  }, [coachMessage, coachSending, props]);

  const performCoachAction = useCallback(async (action: CameraCoachAction) => {
    try {
      setCoachNotice(t("capture.coach.submitting"));
      if (action.kind === "artifact") {
        await props.onCoachCardAction?.(action.id, action.artifactId);
      } else {
        await props.onCoachHumanAction?.(action.pendingActionId, action.id);
      }
      setCoachNotice(t("capture.coach.submitted"));
    } catch (cause) {
      setCoachNotice(cause instanceof Error ? cause.message : t("capture.coach.submitFailed"));
    }
  }, [props]);

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

  const equipmentAxis = useMemo(() => packet?.equipment.tracks.find(
    (track) => track.kind === "barbell_shaft" && track.axis !== null,
  ) ?? null, [packet]);

  const pointOf = (index: number) => {
    const landmark = visibleLandmarks.find((entry) => entry.index === index);
    if (!landmark || !mapping) return null;
    return {
      x: mapping.offsetX + (event?.previewMirrored ? 1 - landmark.x : landmark.x) * mapping.drawnWidth,
      y: mapping.offsetY + landmark.y * mapping.drawnHeight,
    };
  };
  const anglePresentations = (packet?.jointAngles ?? []).flatMap((angle) => {
    const presentation = buildJointAngleArc(angle, pointOf, 28);
    return presentation ? [presentation] : [];
  });
  const coachPresentation = useMemo(() => projectCameraCoachPresentation({
    stream: props.coachStream ?? emptyCoachStream(locale),
    localCue: latestFindings,
    userMessage: lastUserMessage,
    ...(locale ? { locale } : {}),
  }), [lastUserMessage, latestFindings, locale, props.coachStream]);
  const compactWorkoutView = props.setContext !== undefined;
  const visibleCaptions = compactWorkoutView && active
    ? coachPresentation.captions.filter((line) => line.state !== "previous").slice(-1)
    : coachPresentation.captions;

  if (permission === "unknown") {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>{t("capture.permission.required")}</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>{t("capture.permission.grant")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (permission === "denied") {
    return (
      <View style={styles.center}>
        <Text style={styles.centerText}>{t("capture.permission.denied")}</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={props.onExit}>
          <Text style={styles.permissionBtnText}>返回手动记录</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.stage} onLayout={onLayout}>
        <NativePoseCameraView
          style={StyleSheet.absoluteFill}
          model={RTMPOSE_MODEL}
          recognitionProfile={config.recognition.nativeProfileJson}
          lensFacing={lensFacing}
          recognitionActive={active && recognitionAvailable && !lensSwitching}
          videoRecording={active}
          onPose={onPose}
          onVideo={onVideo}
        />
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}>
          {!compactWorkoutView && mapping && equipmentAxis?.axis && (
            <Line
              x1={mapping.offsetX + (event?.previewMirrored ? 1 - equipmentAxis.axis.x1 : equipmentAxis.axis.x1) * mapping.drawnWidth}
              y1={mapping.offsetY + equipmentAxis.axis.y1 * mapping.drawnHeight}
              x2={mapping.offsetX + (event?.previewMirrored ? 1 - equipmentAxis.axis.x2 : equipmentAxis.axis.x2) * mapping.drawnWidth}
              y2={mapping.offsetY + equipmentAxis.axis.y2 * mapping.drawnHeight}
              stroke={equipmentAxis.source === "geometry" ? "#FFD23F" : "#FF8A3D"}
              strokeWidth="4"
              strokeLinecap="round"
            />
          )}
          {!compactWorkoutView && mapping && HALPE26_CONNECTIONS.map(([from, to]) => {
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
          {!compactWorkoutView && anglePresentations.map((angle) => (
            <Path
              key={`angle:${angle.key}`}
              d={angle.path}
              fill="rgba(198,241,53,0.16)"
              stroke={colors.lime}
              strokeWidth="2"
            />
          ))}
          {!compactWorkoutView && mapping && visibleLandmarks.map((landmark) => {
            const point = pointOf(landmark.index);
            return point ? (
              <Circle key={landmark.index} cx={point.x} cy={point.y} r="4" fill={colors.jointDot} />
            ) : null;
          })}
          {!compactWorkoutView && anglePresentations.map((angle) => (
            <SvgText
              key={`angle-label:${angle.key}`}
              x={angle.label.x}
              y={angle.label.y}
              fill={colors.lime}
              stroke="rgba(14,16,14,0.9)"
              strokeWidth="0.8"
              fontSize="12"
              fontWeight="900"
              textAnchor="middle"
              alignmentBaseline="middle"
            >
              {angle.valueText}
            </SvgText>
          ))}
        </Svg>

        {/* 顶部信息永远覆盖在相机上，不参与 CameraView 布局。 */}
        <View style={styles.hudTop}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.exerciseLabel}>‹ {cameraExerciseLabel(config.exerciseId)}</Text>
            {props.setContext ? <Text numberOfLines={1} style={styles.setContextLabel}>第 {props.setContext.setIndex} 组{props.setContext.executionLoad ? ` · ${props.setContext.executionLoad.value}${props.setContext.executionLoad.unit}` : " · 重量待确认"}{props.setContext.targetReps !== undefined ? ` · 目标 ${props.setContext.targetReps} 次` : ""}</Text> : null}
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t(lensFacing === "front" ? "capture.lens.switchToBack" : "capture.lens.switchToFront")} disabled={lensSwitching} onPress={switchLens} style={styles.lensButton}>
            <Text style={styles.lensButtonText}>{t(lensFacing === "front" ? "capture.lens.front" : "capture.lens.back")} ↻</Text>
          </TouchableOpacity>
          <View style={[styles.recChip, !active && styles.recChipIdle]}>
            <View style={[styles.recDot, !active && styles.recDotIdle]} />
            <Text style={[styles.recText, !active && styles.recTextIdle]}>
              {active
                ? `${String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:${String(elapsedSec % 60).padStart(2, "0")}`
                : "READY"}
            </Text>
          </View>
        </View>

        <View style={[styles.frameBanner, (lensSwitching || recognitionAvailable && !framing.ok) && styles.frameBannerWarn]}>
          <Text style={[styles.frameBannerText, (lensSwitching || recognitionAvailable && !framing.ok) && styles.frameBannerTextWarn]}>
            {lensSwitching
              ? t("framing.status.lensSwitching")
              : recognitionAvailable
                ? framing.ok
                  ? `✓ ${t("framing.status.inFrame")} · ${active ? t("framing.status.counting") : t("framing.status.ready")}`
                  : `⚠ ${framing.hintText ?? t("framing.hint.adjustCamera")}`
                : t("framing.status.recordOnly")}
          </Text>
        </View>

        {config.recognition.canCount && (
          <View style={styles.repCluster}>
            <Text style={styles.repNum}>{String(confirmedCount).padStart(2, "0")}{props.setContext?.targetReps !== undefined ? ` / ${props.setContext.targetReps}` : ""}</Text>
            <Text style={styles.repLabel}>{compactWorkoutView ? "REPS" : `REPS · ${config.recognition.canEmitPhase ? phase.toUpperCase() : "OBSERVING"}`}</Text>
          </View>
        )}

        <View pointerEvents="box-none" style={[styles.captionLane, coachComposerOpen && styles.captionLaneComposerOpen]}>
          {coachNotice || coachPresentation.statusLabel ? (
            <View style={styles.coachStatusRow}>
              <View style={styles.coachStatusDot} />
              <Text numberOfLines={1} style={styles.coachStatusText}>{coachNotice ?? coachPresentation.statusLabel}</Text>
            </View>
          ) : null}
          {visibleCaptions.map((line) => (
            <View key={line.id} style={[styles.captionRow, line.state === "previous" && styles.captionPrevious]}>
              <Text style={[styles.captionLabel, line.source === "coach" && styles.captionLabelCoach, line.source === "user" && styles.captionLabelUser, line.source === "system" && styles.captionLabelError]}>{line.label}</Text>
              <Text numberOfLines={line.state === "previous" ? 1 : 2} style={[styles.captionText, line.state === "streaming" && styles.captionTextStreaming]}>
                {line.text}{line.state === "streaming" ? "  ▍" : ""}
              </Text>
            </View>
          ))}
          {!compactWorkoutView || !active ? coachPresentation.actionPrompt ? <Text numberOfLines={2} style={styles.actionPrompt}>{coachPresentation.actionPrompt}</Text> : null : null}
          {(!compactWorkoutView || !active) && coachPresentation.actions.length ? (
            <View style={styles.captionActions}>
              {coachPresentation.actions.slice(0, 2).map((action) => {
                const enabled = action.kind === "artifact" ? Boolean(props.onCoachCardAction) : Boolean(props.onCoachHumanAction);
                return (
                  <TouchableOpacity key={`${action.kind}:${action.id}`} accessibilityRole="button" disabled={!enabled} onPress={() => void performCoachAction(action)} style={[styles.captionAction, action.id === "apply" && styles.captionActionPrimary, !enabled && styles.captionActionDisabled]}>
                    <Text style={[styles.captionActionText, action.id === "apply" && styles.captionActionTextPrimary]}>{action.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          {(!compactWorkoutView || !active) && coachPresentation.receipt ? (
            <View style={styles.receiptRow}><View style={styles.receiptDot} /><Text numberOfLines={1} style={styles.receiptText}>{t("capture.coach.receiptHint", { title: coachPresentation.receipt.title })}</Text></View>
          ) : null}
        </View>

        {!active && coachComposerOpen ? (
          <View style={styles.cameraComposer}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("capture.coach.voiceUnavailable")} onPress={() => setCoachNotice(t("capture.coach.voiceReserved"))} style={styles.cameraComposerMic}>
              <Text style={styles.cameraComposerMicText}>{t("capture.coach.micButton")}</Text>
            </TouchableOpacity>
            <TextInput accessibilityLabel={t("capture.coach.composerLabel")} autoFocus blurOnSubmit onChangeText={setCoachMessage} onSubmitEditing={() => void submitCoachMessage()} placeholder={t("capture.coach.composerPlaceholder")} placeholderTextColor="rgba(255,255,255,0.42)" returnKeyType="send" style={styles.cameraComposerInput} value={coachMessage} />
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("capture.coach.send")} disabled={!coachMessage.trim() || coachSending} onPress={() => void submitCoachMessage()} style={[styles.cameraComposerSend, (!coachMessage.trim() || coachSending) && styles.cameraComposerSendDisabled]}>
              <Text style={styles.cameraComposerSendText}>↑</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.hudBottom}>
          {!active ? <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("capture.coach.openComposer")} style={[styles.iconBtn, coachComposerOpen && styles.iconBtnActive]} onPress={() => setCoachComposerOpen((open) => !open)}>
            <Text style={[styles.iconBtnText, coachComposerOpen && styles.iconBtnTextActive]}>{t(coachComposerOpen ? "capture.coach.composerOpenGlyph" : "capture.coach.composerClosedGlyph")}</Text>
          </TouchableOpacity> : <View style={styles.iconBtn} />}
          <TouchableOpacity
            style={[styles.endBtn, active && styles.endBtnActive]}
            onPress={active ? endSet : startSet}
          >
            <Text style={[styles.endBtnText, active && styles.endBtnTextActive]}>
              {t(active ? "capture.set.finish" : "capture.set.start")}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t(active ? "capture.exitWhileActive" : "capture.exit")} style={styles.iconBtn} onPress={exitCamera}>
            <Text style={styles.iconBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        {props.onSafetyPause ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="安全暂停" onPress={() => setSafetyChoicesOpen(true)} style={styles.safetyPause}>
            <Text style={styles.safetyPauseText}>安全暂停</Text>
          </TouchableOpacity>
        ) : null}
        {safetyChoicesOpen ? (
          <View style={styles.safetySheet}>
            <Text style={styles.safetyTitle}>立即停止本组并安全暂停</Text>
            {([
              ["new_sharp_pain", "新出现的尖锐疼痛"],
              ["chest_discomfort", "胸部不适"],
              ["dizziness_or_fainting", "眩晕或接近晕厥"],
              ["unusual_breathing_difficulty", "异常呼吸困难"],
            ] as const).map(([signal, label]) => (
              <TouchableOpacity key={signal} accessibilityRole="button" onPress={() => void safetyPause(signal)} style={styles.safetyChoice}>
                <Text style={styles.safetyChoiceText}>{label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity accessibilityRole="button" onPress={() => setSafetyChoicesOpen(false)} style={styles.safetyCancel}><Text style={styles.safetyCancelText}>继续当前组</Text></TouchableOpacity>
          </View>
        ) : null}

        {nativeError && (
          <View style={styles.errorBanner}><Text style={styles.errorText}>{nativeError}</Text></View>
        )}
      </View>

      {report && (
        <ReportSheet
          report={report}
          recognitionEnabled={recognitionAvailable}
          savedFile={savedFile}
          savedVideo={savedVideo}
          videoSaveState={videoSaveState}
          onAgain={() => { setReport(null); startSet(); }}
          onDone={props.onExit}
          onOpenSavedVideo={savedVideo?.status === "saved" && savedVideo.path ? openSavedVideo : undefined}
          locale={locale}
        />
      )}
    </View>
  );
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function cameraExerciseLabel(exerciseId: string): string {
  const labels: Record<string, string> = {
    barbell_bench_press: "杠铃卧推",
    bench_press: "卧推",
    back_squat: "深蹲",
    deadlift: "硬拉",
    overhead_press: "肩上推举",
  };
  return labels[exerciseId] ?? exerciseId.replace(/[_-]+/g, " ");
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.dark },
  stage: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: colors.dark, alignItems: "center", justifyContent: "center", gap: 12 },
  centerText: { color: "#e2e8f0", fontSize: 14 },
  permissionBtn: { backgroundColor: colors.lime, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 12 },
  permissionBtnText: { color: colors.limeInk, fontWeight: "900", fontSize: 14 },
  safetyPause: { position: "absolute", top: 104, right: 16, minHeight: 40, borderRadius: 20, paddingHorizontal: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(142,35,26,0.88)" },
  safetyPauseText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  safetySheet: { position: "absolute", left: 16, right: 16, bottom: 104, borderRadius: 18, padding: 16, gap: 8, backgroundColor: "rgba(14,16,14,0.96)", borderWidth: 1, borderColor: "rgba(255,255,255,0.18)" },
  safetyTitle: { color: colors.white, fontSize: 15, fontWeight: "900", marginBottom: 4 },
  safetyChoice: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, justifyContent: "center", backgroundColor: "rgba(232,92,58,0.2)" },
  safetyChoiceText: { color: "#FFB5A3", fontSize: 13, fontWeight: "800" },
  safetyCancel: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  safetyCancelText: { color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: "800" },
  hudTop: {
    position: "absolute", top: 15, left: 16, right: 16,
    minHeight: 36, flexDirection: "row", alignItems: "center", gap: 9,
  },
  exerciseLabel: { flex: 1, minWidth: 0, color: "rgba(255,255,255,0.88)", fontSize: 11, fontWeight: "900" },
  setContextLabel: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700", marginTop: 3 },
  lensButton: {
    minWidth: 72, minHeight: 34, borderRadius: 17, paddingHorizontal: 12,
    backgroundColor: "rgba(22,24,22,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.22)",
    alignItems: "center", justifyContent: "center",
  },
  lensButtonText: { color: colors.white, fontSize: 10, fontWeight: "900" },
  recChip: {
    flexDirection: "row", alignItems: "center", gap: 7,
    minHeight: 34, backgroundColor: "rgba(232,92,58,0.18)", borderWidth: 1, borderColor: "rgba(232,92,58,0.5)",
    paddingHorizontal: 10, borderRadius: 17,
  },
  recChipIdle: { backgroundColor: "rgba(14,16,14,0.52)", borderColor: "rgba(255,255,255,0.13)" },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.terra },
  recDotIdle: { backgroundColor: "rgba(255,255,255,0.28)" },
  recText: { color: "#FF8A6B", fontSize: 10, fontWeight: "900", fontFamily: "monospace" },
  recTextIdle: { color: "rgba(255,255,255,0.48)" },
  frameBanner: {
    position: "absolute", top: 61, left: 16, right: 16,
    minHeight: 34, backgroundColor: "rgba(24,46,22,0.72)", borderWidth: 1, borderColor: "rgba(198,241,53,0.48)",
    borderRadius: 17, paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
  },
  frameBannerWarn: { backgroundColor: "rgba(58,42,14,0.76)", borderColor: "rgba(241,186,53,0.58)" },
  frameBannerText: { color: colors.lime, fontSize: 10, fontWeight: "900" },
  frameBannerTextWarn: { color: "#F3C865" },
  repCluster: { position: "absolute", left: 20, bottom: 304 },
  repNum: { fontSize: 76, fontWeight: "900", color: colors.lime, lineHeight: 78, letterSpacing: -3 },
  repLabel: { color: "rgba(255,255,255,0.58)", fontSize: 9, marginTop: 3, fontFamily: "monospace", letterSpacing: 1.3 },
  captionLane: {
    position: "absolute", left: 0, right: 0, bottom: 96,
    backgroundColor: "rgba(5,7,5,0.86)", borderTopWidth: 1, borderTopColor: "rgba(198,241,53,0.08)",
  },
  captionLaneComposerOpen: { bottom: 160 },
  coachStatusRow: { minHeight: 25, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 18, backgroundColor: "rgba(198,241,53,0.06)" },
  coachStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.lime },
  coachStatusText: { flex: 1, color: "#AFCC51", fontSize: 9, fontWeight: "800" },
  captionRow: { minHeight: 50, justifyContent: "center", paddingHorizontal: 18, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.08)" },
  captionPrevious: { minHeight: 38, opacity: 0.34 },
  captionLabel: { color: colors.lime, fontSize: 8, fontFamily: "monospace", fontWeight: "900", letterSpacing: 1 },
  captionLabelCoach: { color: "#B9EE1B" },
  captionLabelUser: { color: "#FF8568" },
  captionLabelError: { color: "#F3C865" },
  captionText: { color: colors.white, fontSize: 17, lineHeight: 22, fontWeight: "800", marginTop: 4 },
  captionTextStreaming: { color: "#F4F6EE" },
  actionPrompt: { color: "rgba(255,255,255,0.68)", fontSize: 11, lineHeight: 16, paddingHorizontal: 18, paddingTop: 9 },
  captionActions: { flexDirection: "row", gap: 9, paddingHorizontal: 18, paddingVertical: 10 },
  captionAction: { flex: 1, minHeight: 42, borderRadius: 21, borderWidth: 1, borderColor: "rgba(255,255,255,0.22)", backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  captionActionPrimary: { borderColor: colors.lime, backgroundColor: colors.lime },
  captionActionDisabled: { opacity: 0.38 },
  captionActionText: { color: colors.white, fontSize: 11, fontWeight: "900" },
  captionActionTextPrimary: { color: colors.limeInk },
  receiptRow: { minHeight: 30, marginHorizontal: 18, marginBottom: 8, borderRadius: 15, backgroundColor: "rgba(198,241,53,0.14)", borderWidth: 1, borderColor: "rgba(198,241,53,0.38)", flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 10 },
  receiptDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.lime },
  receiptText: { flex: 1, color: colors.lime, fontSize: 9, fontWeight: "800" },
  cameraComposer: {
    position: "absolute", left: 14, right: 14, bottom: 96, minHeight: 56,
    borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(9,11,9,0.95)",
    flexDirection: "row", alignItems: "center", paddingHorizontal: 7, gap: 7,
  },
  cameraComposerMic: { width: 40, height: 40, borderRadius: 15, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  cameraComposerMicText: { color: colors.lime, fontSize: 11, fontWeight: "900" },
  cameraComposerInput: { flex: 1, minWidth: 0, color: colors.white, fontSize: 13, paddingVertical: 9 },
  cameraComposerSend: { width: 40, height: 40, borderRadius: 15, backgroundColor: colors.lime, alignItems: "center", justifyContent: "center" },
  cameraComposerSendDisabled: { opacity: 0.35 },
  cameraComposerSendText: { color: colors.limeInk, fontSize: 20, fontWeight: "900" },
  hudBottom: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    paddingHorizontal: 18, paddingBottom: 20, flexDirection: "row", alignItems: "center", gap: 12,
  },
  iconBtn: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center",
  },
  iconBtnActive: { backgroundColor: colors.lime, borderColor: colors.lime },
  iconBtnText: { color: colors.white, fontSize: 15, fontWeight: "900" },
  iconBtnTextActive: { color: colors.limeInk },
  endBtn: { flex: 1, height: 54, borderRadius: 27, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  endBtnActive: { backgroundColor: colors.terra },
  endBtnText: { color: colors.ink, fontWeight: "900", fontSize: 14, letterSpacing: 1 },
  endBtnTextActive: { color: colors.white },
  errorBanner: { position: "absolute", top: 104, left: 16, right: 16, borderRadius: 13, backgroundColor: "rgba(80,24,16,0.82)", padding: 9 },
  errorText: { color: "#FFB09D", fontSize: 10, textAlign: "center" },
});
