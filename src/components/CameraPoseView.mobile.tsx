import { useCallback, useMemo, useRef, useState } from "react";
import {
  PermissionsAndroid,
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
} from "../../modules/pose-camera/src/PoseCameraView";
import { decodeMotionPacket, type DecodedMotionPacket } from "../motion/motionPacket";
import { CanonicalActiveDurationAccumulator } from "../motion/canonicalActiveDuration";
import { resolveRecognitionCapability } from "../mobile/exerciseRecognition";
import { HALPE26_CONNECTIONS, HALPE26_KEYPOINT_COUNT } from "../pose/halpe26";

const ACTIONS = [
  { id: "march_in_place", label: "原地踏步" },
  { id: "side_step_touch", label: "侧步并步" },
  { id: "alternating_knee_raise", label: "交替提膝" },
  { id: "step_jack", label: "低冲击开合" },
] as const;

const RTMPOSE_MODEL = "rtmpose-m-halpe26";

interface Size {
  width: number;
  height: number;
}

export function CameraPoseView() {
  const seenRepIds = useRef(new Set<string>());
  const activeDurationRef = useRef(new CanonicalActiveDurationAccumulator());
  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">(
    Platform.OS === "android" ? "unknown" : "granted",
  );
  const [exerciseId, setExerciseId] = useState<(typeof ACTIONS)[number]["id"]>("march_in_place");
  const [recognitionActive, setRecognitionActive] = useState(false);
  const [event, setEvent] = useState<PoseEvent | null>(null);
  const [packet, setPacket] = useState<DecodedMotionPacket | null>(null);
  const [viewSize, setViewSize] = useState<Size>({ width: 1, height: 1 });
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [activeDurationMs, setActiveDurationMs] = useState(0);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const recognition = useMemo(
    () => resolveRecognitionCapability(exerciseId, "front"),
    [exerciseId],
  );

  const requestPermission = useCallback(async () => {
    if (Platform.OS !== "android") return;
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied");
  }, []);

  const resetSession = useCallback(() => {
    setRecognitionActive(false);
    seenRepIds.current.clear();
    activeDurationRef.current.reset();
    setConfirmedCount(0);
    setActiveDurationMs(0);
    setPacket(null);
  }, []);

  const onPose = useCallback(({ nativeEvent }: { nativeEvent: PoseEvent }) => {
    if (nativeEvent.error) {
      setNativeError(nativeEvent.error);
      return;
    }
    if (!nativeEvent.packetBase64) {
      setEvent(nativeEvent);
      return;
    }
    try {
      const decoded = decodeMotionPacket(decodeBase64(nativeEvent.packetBase64));
      setPacket(decoded);
      setEvent({
        ...nativeEvent,
        landmarks: decoded.canonical.map((landmark) => [
          landmark.x ?? Number.NaN,
          landmark.y ?? Number.NaN,
          landmark.z ?? Number.NaN,
          landmark.canonicalConfidence,
        ] as [number, number, number, number]),
      });
      for (const rep of decoded.completedReps) {
        if (rep.disposition !== "confirmed") continue;
        const key = `${decoded.subjectEpoch}:${rep.repId}:${rep.revision}`;
        if (!seenRepIds.current.has(key)) {
          seenRepIds.current.add(key);
          setConfirmedCount(seenRepIds.current.size);
        }
      }
      setActiveDurationMs(activeDurationRef.current.update(
        decoded.sourceTimestampMs,
        decoded.setState.lifecycle,
      ));
    } catch (error) {
      setNativeError(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const onLayout = useCallback((layoutEvent: LayoutChangeEvent) => {
    const { width, height } = layoutEvent.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  const mapping = useMemo(() => {
    if (!event || event.width === 0 || event.height === 0) return null;
    const scale = Math.min(viewSize.width / event.width, viewSize.height / event.height);
    const drawnWidth = event.width * scale;
    const drawnHeight = event.height * scale;
    return {
      offsetX: (viewSize.width - drawnWidth) / 2,
      offsetY: (viewSize.height - drawnHeight) / 2,
      drawnWidth,
      drawnHeight,
    };
  }, [event, viewSize]);

  const visibleLandmarks = useMemo(() => {
    if (!event) return [];
    return event.landmarks
      .map(([x, y, , visibility], index) => ({ index, x, y, visibility }))
      .filter((landmark) => Number.isFinite(landmark.x) && Number.isFinite(landmark.y) && landmark.visibility >= 0.3);
  }, [event]);

  const pointOf = (index: number) => {
    const landmark = visibleLandmarks.find((entry) => entry.index === index);
    if (!landmark || !mapping) return null;
    return {
      x: mapping.offsetX + (event?.previewMirrored ? 1 - landmark.x : landmark.x) * mapping.drawnWidth,
      y: mapping.offsetY + landmark.y * mapping.drawnHeight,
    };
  };

  if (permission === "unknown") {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>需要相机权限进行离线姿态识别</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.buttonText}>授权相机</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (permission === "denied") {
    return <View style={styles.center}><Text style={styles.text}>请在系统设置中开启相机权限</Text></View>;
  }

  return (
    <View style={styles.page}>
      <View style={styles.stage} onLayout={onLayout}>
        <NativePoseCameraView
          style={StyleSheet.absoluteFill}
          model={RTMPOSE_MODEL}
          recognitionProfile={recognition.nativeProfileJson}
          recognitionActive={recognitionActive}
          onPose={onPose}
        />
        <Svg style={StyleSheet.absoluteFill} viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}>
          {mapping && event?.equipmentAxis && (
            <Line
              x1={mapping.offsetX + (event.previewMirrored ? 1 - event.equipmentAxis.x1 : event.equipmentAxis.x1) * mapping.drawnWidth}
              y1={mapping.offsetY + event.equipmentAxis.y1 * mapping.drawnHeight}
              x2={mapping.offsetX + (event.previewMirrored ? 1 - event.equipmentAxis.x2 : event.equipmentAxis.x2) * mapping.drawnWidth}
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
            return <Line key={`${from}-${to}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#22c55e" strokeWidth="2" />;
          })}
          {mapping && visibleLandmarks.map((landmark) => {
            const point = pointOf(landmark.index);
            return point ? <Circle key={landmark.index} cx={point.x} cy={point.y} r="4" fill="#f97316" /> : null;
          })}
        </Svg>
        <View style={styles.hud}>
          <Text style={styles.hudText}>
            {(event?.processedFps ?? 0).toFixed(1)} FPS · {event?.delegate ?? "…"} · infer {(event?.inferenceMs ?? 0).toFixed(0)}ms · prep {(event?.preprocessMs ?? 0).toFixed(0)}ms · {visibleLandmarks.length}/{HALPE26_KEYPOINT_COUNT} · {packet?.repState.phase ?? "ready"}
          </Text>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.actionRow}>
          {ACTIONS.map((action) => (
            <TouchableOpacity
              key={action.id}
              disabled={recognitionActive}
              style={[styles.actionButton, exerciseId === action.id && styles.actionButtonActive]}
              onPress={() => { resetSession(); setExerciseId(action.id); }}
            >
              <Text style={styles.buttonText}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.text}>次数 {confirmedCount}</Text>
          <Text style={styles.text}>有效时间 {(activeDurationMs / 1000).toFixed(1)}s</Text>
          <Text style={styles.text}>有效帧 {event?.validFrames ?? 0}/{event?.processedFrames ?? 0}</Text>
        </View>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryButton, recognitionActive && styles.stopButton]}
            onPress={() => setRecognitionActive((value) => !value)}
          >
            <Text style={styles.buttonText}>{recognitionActive ? "停止识别" : "开始识别"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionButton} onPress={resetSession}>
            <Text style={styles.buttonText}>重置</Text>
          </TouchableOpacity>
        </View>
        {nativeError && <Text style={styles.errorText}>{nativeError}</Text>}
      </View>
    </View>
  );
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0f172a" },
  stage: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", gap: 12 },
  hud: { position: "absolute", top: 8, left: 8, backgroundColor: "rgba(15,23,42,0.75)", padding: 8, borderRadius: 8 },
  hudText: { color: "#e2e8f0", fontSize: 12 },
  controls: { padding: 10, gap: 10 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "center" },
  summaryRow: { flexDirection: "row", gap: 14, justifyContent: "center" },
  actionButton: { backgroundColor: "#334155", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  actionButtonActive: { backgroundColor: "#166534" },
  primaryButton: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  stopButton: { backgroundColor: "#b91c1c" },
  buttonText: { color: "#fff", fontSize: 13 },
  text: { color: "#e2e8f0", fontSize: 13 },
  errorText: { color: "#f87171", fontSize: 12, textAlign: "center" },
});
