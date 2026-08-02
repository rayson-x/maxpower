import { useCallback, useMemo, useRef, useState } from "react";
import {
  PermissionsAndroid,
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
import { RepCounter, type RepEvent } from "../pose/repCounter";

const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];

const POSE_MODELS = [
  { id: "lite", label: "lite (快)" },
  { id: "full", label: "full (均衡)" },
  { id: "heavy", label: "heavy (最准)" },
];

const VISIBILITY_THRESHOLD = 0.3;

interface Size {
  width: number;
  height: number;
}

export function CameraPoseView() {
  const counterRef = useRef(new RepCounter());
  const frameTimesRef = useRef<number[]>([]);

  const [permission, setPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [modelId, setModelId] = useState("heavy");
  const [event, setEvent] = useState<PoseEvent | null>(null);
  const [viewSize, setViewSize] = useState<Size>({ width: 1, height: 1 });
  const [fps, setFps] = useState(0);
  const [nativeError, setNativeError] = useState<string | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [reps, setReps] = useState<RepEvent[]>([]);

  const requestPermission = useCallback(async () => {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    setPermission(result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied");
  }, []);

  const onPose = useCallback(({ nativeEvent }: { nativeEvent: PoseEvent }) => {
    if (nativeEvent.error) {
      setNativeError(nativeEvent.error);
      return;
    }
    setEvent(nativeEvent);
    const now = Date.now();
    const window = frameTimesRef.current;
    window.push(now);
    while (window.length > 0 && window[0] < now - 1000) window.shift();
    setFps(window.length);

    const repEvent = counterRef.current.update({
      timestampMs: Math.round(nativeEvent.timestampMs),
      landmarks: nativeEvent.landmarks.map(([x, y, z, visibility]) => ({
        x,
        y,
        z,
        visibility,
      })),
      worldLandmarks: [],
    });
    if (repEvent) {
      setRepCount(repEvent.repIndex);
      setReps((previous) => [...previous, repEvent]);
    }
  }, []);

  const onLayout = useCallback((layoutEvent: LayoutChangeEvent) => {
    const { width, height } = layoutEvent.nativeEvent.layout;
    setViewSize({ width, height });
  }, []);

  // Map normalized frame coordinates onto the FIT_CENTER preview area.
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
      .filter((landmark) => landmark.visibility >= VISIBILITY_THRESHOLD);
  }, [event]);

  const pointOf = (index: number) => {
    const landmark = visibleLandmarks.find((entry) => entry.index === index);
    if (!landmark || !mapping) return null;
    return {
      x: mapping.offsetX + landmark.x * mapping.drawnWidth,
      y: mapping.offsetY + landmark.y * mapping.drawnHeight,
    };
  };

  if (permission === "unknown") {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>需要相机权限进行姿态识别</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.buttonText}>授权相机</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (permission === "denied") {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>相机权限被拒绝,请在系统设置中开启</Text>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <View style={styles.stage} onLayout={onLayout}>
        <NativePoseCameraView
          style={StyleSheet.absoluteFill}
          model={modelId}
          onPose={onPose}
        />
        <Svg
          style={StyleSheet.absoluteFill}
          viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
        >
          {mapping &&
            POSE_CONNECTIONS.map(([from, to]) => {
              const startPoint = pointOf(from);
              const endPoint = pointOf(to);
              if (!startPoint || !endPoint) return null;
              return (
                <Line
                  key={`${from}-${to}`}
                  x1={startPoint.x}
                  y1={startPoint.y}
                  x2={endPoint.x}
                  y2={endPoint.y}
                  stroke="#22c55e"
                  strokeWidth="2"
                />
              );
            })}
          {mapping &&
            visibleLandmarks.map((landmark) => {
              const point = pointOf(landmark.index);
              if (!point) return null;
              return (
                <Circle
                  key={landmark.index}
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  fill="#f97316"
                  opacity={Math.max(0.3, landmark.visibility)}
                />
              );
            })}
        </Svg>
        <View style={styles.hud}>
          <Text style={styles.hudText}>
            {fps} fps · {visibleLandmarks.length}/33 点 · {modelId}
          </Text>
        </View>
      </View>

      <View style={styles.toolbar}>
        {POSE_MODELS.map((model) => (
          <TouchableOpacity
            key={model.id}
            style={[styles.modelButton, modelId === model.id && styles.modelButtonActive]}
            onPress={() => setModelId(model.id)}
          >
            <Text style={modelId === model.id ? styles.buttonText : styles.modelButtonText}>
              {model.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {nativeError && <Text style={styles.errorText}>原生错误: {nativeError}</Text>}

      <View style={styles.repPanel}>
        <Text style={styles.text}>
          Rep 计数: {repCount}{"  "}
          <Text
            style={styles.link}
            onPress={() => {
              counterRef.current.reset();
              setRepCount(0);
              setReps([]);
            }}
          >
            重置
          </Text>
        </Text>
        {reps.slice(-6).map((rep) => (
          <Text key={rep.repIndex} style={styles.repLine}>
            #{rep.repIndex} · {(rep.durationMs / 1000).toFixed(1)}s · 幅度{" "}
            {rep.amplitude.toFixed(2)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#0f172a" },
  center: {
    flex: 1,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  stage: { flex: 1, backgroundColor: "#000" },
  hud: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(15,23,42,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  hudText: { color: "#e2e8f0", fontSize: 12 },
  toolbar: {
    flexDirection: "row",
    gap: 8,
    padding: 10,
    justifyContent: "center",
  },
  modelButton: {
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modelButtonActive: { backgroundColor: "#166534", borderColor: "#166534" },
  modelButtonText: { color: "#4ade80", fontSize: 13 },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: "#fff", fontSize: 13 },
  text: { color: "#e2e8f0", fontSize: 14 },
  link: { color: "#60a5fa" },
  errorText: { color: "#f87171", fontSize: 12, paddingHorizontal: 10 },
  repPanel: { padding: 10, borderTopWidth: 1, borderTopColor: "#1e293b" },
  repLine: { color: "#94a3b8", fontSize: 12, fontFamily: "monospace" as never },
});
