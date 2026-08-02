import { useCallback, useEffect, useRef, useState } from "react";

import {
  explainFormScore,
  ZHIPU_DEFAULTS,
  type AgentSettings,
  type FormScoreExplanation,
  type OpenRecognition,
} from "../agent/coach";
import { computeExerciseFeatures } from "../pose/exerciseFeatures";
import {
  EXERCISE_REGISTRY,
  type ExerciseMaturity,
} from "../pose/exerciseRegistry";
import { RULE_METRIC } from "../pose/formRuleEngine";
import { routeCanonicalFrame } from "../pose/canonicalFrameRouter";
import {
  createPoseContinuitySession,
  type CanonicalPoseFrame,
  type PoseContinuitySession,
  type PoseSchema,
} from "../pose/canonicalPose";
import { buildCanonicalPosePresentation } from "../pose/canonicalPosePresentation";
import { classifyLocally, type LocalClassification } from "../pose/localClassifier";
import { PoseEngine, type PoseEstimate } from "../pose/PoseEngine";
import { buildRecordingFixture } from "../pose/recordingFixture";
import {
  analyzePoseSet,
  type PoseSetAnalysisResult,
} from "../pose/poseSetAnalysis";
import {
  guessExerciseId,
  representativeCycle,
  segmentRepsAuto,
  type AutoSegmentation,
  type RepSegment,
} from "../pose/repSegmenter";
import { computeTrajectoryFeatures, type TrajectoryFeatures } from "../pose/trajectory";
import { RtmposeEngine } from "../pose/RtmposeEngine";
import {
  CAMERA_VIEWS,
  torsoLeanDeg,
  type CameraView,
} from "../pose/viewGating";
import { CHAMFER, CHAMFER_SM, cornerBrackets, HUD, injectHudTheme } from "./hudTheme";

injectHudTheme();

// BlazePose-33 拓扑(MediaPipe)
const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
  [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];

// COCO-17 拓扑(RTMPose):鼻/眼/耳/肩/肘/腕/髋/膝/踝
const COCO17_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [0, 2], [1, 3], [2, 4], [0, 5], [0, 6],
  [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
  [5, 11], [6, 12], [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
];

// 肘角信号用的关节索引(肩/肘/腕),随拓扑切换
const ELBOW_TRIPLETS = {
  mediapipe: { left: [11, 13, 15], right: [12, 14, 16] },
  rtmpose: { left: [5, 7, 9], right: [6, 8, 10] },
} as const;

const PROVIDER_DEFAULTS: Record<string, string> = {
  zhipu: ZHIPU_DEFAULTS.modelId,
  anthropic: "claude-3-5-haiku-20241022",
  openai: "gpt-4.1-mini",
  google: "gemini-2.0-flash",
  deepseek: "deepseek-v4-flash",
  openrouter: "openai/gpt-4.1-mini",
};

const STORAGE_KEY = "form-coach-agent-settings-v2";

/** 单次分析的采集窗口上限。要装得下至少两个完整循环,分期才能切出 rep。 */
const COLLECT_MAX_MS = 30_000;

const SAMPLE_VIDEOS = [
  "ecc14b0bdcd3e1116465edfe08f33368.mp4",
  "6e26dae721570a61cc5c9873d18c9380.mp4",
  "ebcc8df556ca000ecf8c026d920f1daf.mp4",
  "f4a69088e395df62a33e7272f9e78192.mp4",
];

const ANALYSIS_STAGE_LABELS: Record<string, string> = {
  collecting: "⏺ 采集动作数据中…",
  classifying: "⏺ 识别动作中…",
  analyzing: "⏺ 结构化分析中…",
  rendering: "⏺ 生成报告中…",
  done: "✓ 分析完成,重新分析",
};

const POSE_MODELS = [
  { id: "lite", label: "lite", path: "/models/pose_landmarker_lite.task" },
  { id: "full", label: "full", path: "/models/pose_landmarker_full.task" },
  { id: "heavy", label: "heavy", path: "/models/pose_landmarker_heavy.task" },
];

type EngineKind = "mediapipe" | "rtmpose";
const ENGINE_KINDS: Array<{ id: EngineKind; label: string }> = [
  { id: "mediapipe", label: "MediaPipe" },
  { id: "rtmpose", label: "RTMPose-m" },
];
const RTMPOSE_MODEL_PATH = "/models/rtmpose-m-simcc-256x192.onnx";
const STAGE_ASPECT = 16 / 9;

function poseSchemaForEngine(kind: EngineKind): PoseSchema {
  return kind === "rtmpose" ? "coco17" : "blazepose33";
}

const EXERCISE_MATURITY_LABEL: Record<ExerciseMaturity, string> = {
  catalog_only: "仅目录",
  experimental: "实验评分",
  validated: "已验证",
  suspended: "已暂停",
};

type AnyPoseEngine = PoseEngine | RtmposeEngine;

function loadSettings(): AgentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AgentSettings;
  } catch {
    /* ignore */
  }
  return {
    provider: ZHIPU_DEFAULTS.provider,
    modelId: ZHIPU_DEFAULTS.modelId,
    baseUrl: ZHIPU_DEFAULTS.baseUrl,
    apiKey: ZHIPU_DEFAULTS.apiKey,
  };
}

type EngineStatus = "idle" | "loading-model" | "starting-camera" | "running" | "error";
type SourceMode = "camera" | "file";

interface SignalSample {
  t: number;
  v: number;
}

function angleDeg(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 < 1e-6 || m2 < 1e-6) return NaN;
  const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** Fits a source video inside the fixed player while keeping the pose overlay aligned. */
function fitVideoIntoStage(sourceAspect: number): React.CSSProperties {
  const aspect = Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : STAGE_ASPECT;
  if (aspect >= STAGE_ASPECT) {
    const height = (STAGE_ASPECT / aspect) * 100;
    return { position: "absolute", left: 0, top: `${(100 - height) / 2}%`, width: "100%", height: `${height}%` };
  }
  const width = (aspect / STAGE_ASPECT) * 100;
  return { position: "absolute", left: `${(100 - width) / 2}%`, top: 0, width: `${width}%`, height: "100%" };
}

export function CameraPoseView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<AnyPoseEngine | null>(null);
  const engineKindRef = useRef<EngineKind>("mediapipe");
  const rafRef = useRef(0);
  const fpsWindowRef = useRef<number[]>([]);
  const modeRef = useRef<SourceMode>("camera");
  const epochRef = useRef(0);
  const lastTimestampRef = useRef(-1);
  const modelPathRef = useRef(POSE_MODELS[2].path);
  const cameraViewRef = useRef<CameraView>("oblique45");
  // The evidence-based continuity fusion is the Web default. Keep the legacy
  // tracker behind an explicit toggle while its product path is contracted.
  const filterEnabledRef = useRef(false);
  const poseBufferRef = useRef<CanonicalPoseFrame[]>([]);
  const frameCountRef = useRef(0);
  const keyframesRef = useRef<Array<{ t: number; jpeg: string }>>([]);
  const lastCaptureRef = useRef(0);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canonicalSessionRef = useRef<PoseContinuitySession | null>(null);
  const sequenceCounterRef = useRef(0);
  // 实时信号曲线(肘角),驱动左下角曲线图
  const signalRef = useRef<SignalSample[]>([]);

  // 现场采集留存:与 poseBufferRef(实时分析用的滚动环形缓冲,有上限)不同,
  // 这里是录制期间不设上限的 canonical 会话缓冲,只在 recordingActiveRef 为 true 时累积。
  const recordingActiveRef = useRef(false);
  const recordedPosesRef = useRef<CanonicalPoseFrame[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartMsRef = useRef(0);
  const recordingStopMsRef = useRef(0);

  const [status, setStatus] = useState<EngineStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SourceMode>("camera");
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [modelId, setModelId] = useState(POSE_MODELS[2].id);
  const [engineKind, setEngineKind] = useState<EngineKind>("mediapipe");
  const [modelLoading, setModelLoading] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("oblique45");
  const [exerciseChoice, setExerciseChoice] = useState<string>("");
  const [filterEnabled, setFilterEnabled] = useState(false);
  const [torsoLean, setTorsoLean] = useState<number | null>(null);
  const [pose, setPose] = useState<CanonicalPoseFrame | null>(null);
  const [fps, setFps] = useState(0);
  const [signalCurve, setSignalCurve] = useState<SignalSample[]>([]);
  const [segments, setSegments] = useState<RepSegment[]>([]);
  const [settings, setSettings] = useState<AgentSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [classified, setClassified] = useState<string | null>(null);
  const [stageTimes, setStageTimes] = useState<Record<string, number>>({});
  const [localResult, setLocalResult] = useState<LocalClassification | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryFeatures | null>(null);
  const [autoSeg, setAutoSeg] = useState<AutoSegmentation | null>(null);
  const [phaseFrames, setPhaseFrames] = useState<
    Array<{ phase: string; dataUrl: string; timestampMs: number }>
  >([]);
  const [linkTimes, setLinkTimes] = useState<{ local: number; open: number } | null>(null);
  // 逐 rep 指标 + 规则引擎评分(现场标定:先看数值,不代表最终判定 UI 已经打磨)
  const [setAnalysis, setSetAnalysis] = useState<PoseSetAnalysisResult | null>(null);
  // 大白话点评(表达层,失败不影响上面已经算好的分数)
  const [formExplanation, setFormExplanation] = useState<FormScoreExplanation | null>(null);
  const [formExplanationError, setFormExplanationError] = useState<string | null>(null);
  // 现场采集留存
  const [isRecording, setIsRecording] = useState(false);
  const [recordingResult, setRecordingResult] = useState<{
    videoUrl: string;
    videoName: string;
    keypointsUrl: string;
    keypointsName: string;
    poseCount: number;
    durationSec: number;
  } | null>(null);

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      setModelLoading(true);
      try {
        engineRef.current =
          engineKindRef.current === "rtmpose"
            ? await RtmposeEngine.create(RTMPOSE_MODEL_PATH)
            : await PoseEngine.create(modelPathRef.current);
      } finally {
        setModelLoading(false);
      }
    }
    return engineRef.current;
  }, []);

  const startCanonicalSequence = useCallback(() => {
    const video = videoRef.current;
    const sequenceNumber = sequenceCounterRef.current++;
    canonicalSessionRef.current = createPoseContinuitySession({
      sequenceId: `web:${engineKindRef.current}:${sequenceNumber}`,
      schema: poseSchemaForEngine(engineKindRef.current),
      image: {
        widthPx: Math.max(1, video?.videoWidth ?? 0),
        heightPx: Math.max(1, video?.videoHeight ?? 0),
        rotationDegrees: 0,
        mirrored: modeRef.current === "camera",
      },
      stabilization: filterEnabledRef.current ? "legacy" : "fusion",
    });
  }, []);

  const resetCanonicalConsumers = useCallback(() => {
    poseBufferRef.current = [];
    frameCountRef.current = 0;
    signalRef.current = [];
    setPose(null);
    setSignalCurve([]);
  }, []);

  const rotateCanonicalSequence = useCallback(() => {
    if (recordingActiveRef.current) return false;
    resetCanonicalConsumers();
    startCanonicalSequence();
    return true;
  }, [resetCanonicalConsumers, startCanonicalSequence]);

  const switchEngine = useCallback(
    async (kind: EngineKind) => {
      if (kind === engineKindRef.current) return;
      if (recordingActiveRef.current) return;
      engineKindRef.current = kind;
      setEngineKind(kind);
      engineRef.current?.close();
      engineRef.current = null;
      canonicalSessionRef.current = null;
      if (status === "running") {
        await ensureEngine();
        rotateCanonicalSequence();
      }
    },
    [ensureEngine, rotateCanonicalSequence, status],
  );

  const switchModel = useCallback(
    async (id: string) => {
      const next = POSE_MODELS.find((model) => model.id === id);
      if (!next || next.path === modelPathRef.current) return;
      if (recordingActiveRef.current) return;
      setModelId(id);
      modelPathRef.current = next.path;
      engineRef.current?.close();
      engineRef.current = null;
      canonicalSessionRef.current = null;
      if (status === "running") {
        await ensureEngine();
        rotateCanonicalSequence();
      }
    },
    [ensureEngine, rotateCanonicalSequence, status],
  );

  const startLoop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    lastTimestampRef.current = -1;
    rotateCanonicalSequence();
    let lastCurveUpdate = 0;
    const loop = () => {
      const engine = engineRef.current;
      const currentVideo = videoRef.current;
      if (engine && currentVideo) {
        let timestampMs: number;
        if (modeRef.current === "file") {
          timestampMs = epochRef.current + currentVideo.currentTime * 1000;
          if (timestampMs <= lastTimestampRef.current) {
            epochRef.current = lastTimestampRef.current + 1 - currentVideo.currentTime * 1000;
            timestampMs = lastTimestampRef.current + 1;
          }
        } else {
          timestampMs = performance.now();
        }
        lastTimestampRef.current = timestampMs;
        try {
          const estimate = engine.estimate(currentVideo, timestampMs);
          if (estimate) {
            if (!canonicalSessionRef.current) startCanonicalSequence();
            const canonicalFrame = canonicalSessionRef.current!.process(estimate);
            routeCanonicalFrame(canonicalFrame, {
              render: (frame) => {
                setPose(frame);
              },
              count: (frame) => {
                const elbow = bestElbowAngle(frame, engineKindRef.current);
                if (elbow === null) return;
                const signal = signalRef.current;
                signal.push({ t: frame.timestampMs, v: elbow });
                if (signal.length > 200) signal.shift();
                if (frame.timestampMs - lastCurveUpdate > 250) {
                  lastCurveUpdate = frame.timestampMs;
                  setSignalCurve([...signal]);
                }
              },
              record: (frame) => {
                if (recordingActiveRef.current) {
                  recordedPosesRef.current.push(frame);
                }
              },
              analyze: (frame) => {
                frameCountRef.current += 1;
                if (frameCountRef.current % 3 !== 0) return;
                const buffer = poseBufferRef.current;
                buffer.push(frame);
                // 采集窗口拉长到 30s 后,每 3 帧取 1 约 15 样本/秒 → 至少要 450 才装得下整窗
                if (buffer.length > 900) buffer.shift();
              },
            });
            setTorsoLean(torsoLeanDeg(canonicalFrame.worldLandmarks));
          }
        } catch {
          // 单帧失败不致命
        }
        const now = performance.now();
        const window = fpsWindowRef.current;
        window.push(now);
        while (window.length > 0 && window[0] < now - 1000) window.shift();
        setFps(window.length);
        if (now - lastCaptureRef.current > 400 && currentVideo.readyState >= 2) {
          lastCaptureRef.current = now;
          const jpeg = captureFrame(currentVideo, captureCanvasRef);
          if (jpeg) {
            const buffer = keyframesRef.current;
            buffer.push({ t: timestampMs, jpeg });
            // 每 400ms 一张,30s 窗口需要 75 张;留余量到 90,否则相位取图会落到窗口尾部
            if (buffer.length > 90) buffer.shift();
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    setStatus("running");
  }, [rotateCanonicalSequence, startCanonicalSequence]);

  const stopCameraTracks = () => {
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  };

  /** 录制结束后把视频和关键点 fixture 固化成可下载的 URL。 */
  const finalizeRecording = useCallback(() => {
    recordingActiveRef.current = false;
    const chunks = recordedChunksRef.current;
    const poses = recordedPosesRef.current;
    recordedChunksRef.current = [];
    if (chunks.length === 0) return;

    setRecordingResult((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous.videoUrl);
        URL.revokeObjectURL(previous.keypointsUrl);
      }

      const mimeType = mediaRecorderRef.current?.mimeType || "video/webm";
      const videoBlob = new Blob(chunks, { type: mimeType });
      const stamp = new Date(recordingStartMsRef.current).toISOString().replace(/[:.]/g, "-");
      const baseName = `field-capture-${stamp}`;
      const videoExt = mimeType.includes("mp4") ? "mp4" : "webm";

      // 与 tools/harness/capture.html 产出的 fixture 同形状。即使模型整段未检出姿态,
      // 也导出一个空 poses fixture,保留原始视频以便排查机位或模型初始化问题。
      const fixture = buildRecordingFixture({
        video: `${baseName}.${videoExt}`,
        fallbackDurationSec: (recordingStopMsRef.current - recordingStartMsRef.current) / 1000,
        model: `${engineKindRef.current}:${modelPathRef.current}`,
        poses,
      });
      const keypointsBlob = new Blob([JSON.stringify(fixture)], { type: "application/json" });

      return {
        videoUrl: URL.createObjectURL(videoBlob),
        videoName: `${baseName}.${videoExt}`,
        keypointsUrl: URL.createObjectURL(keypointsBlob),
        keypointsName: `${baseName}.json`,
        poseCount: poses.length,
        durationSec: fixture[0].durationSec,
      };
    });
    recordedPosesRef.current = [];
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recordingActiveRef.current) recordingStopMsRef.current = Date.now();
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      recordingActiveRef.current = false;
    }
    setIsRecording(false);
  }, []);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    stopRecording();
    stopCameraTracks();
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    setStatus("idle");
    setPose(null);
    setFps(0);
    setVideoName(null);
    setSignalCurve([]);
    signalRef.current = [];
    canonicalSessionRef.current = null;
  }, [stopRecording]);

  const start = useCallback(async () => {
    setError(null);
    try {
      await ensureEngine();
      setStatus("starting-camera");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) throw new Error("video element missing");
      video.srcObject = stream;
      video.loop = false;
      await video.play();
      modeRef.current = "camera";
      setMode("camera");
      startLoop();

      // 录制与摄像头会话同生共死:开摄像头即开始录,关摄像头即结束录 —— 现场
      // 不会有人忘记单独按下"开始录制",这个动作本来就该和"打开相机"是同一件事。
      recordedPosesRef.current = [];
      recordedChunksRef.current = [];
      recordingStartMsRef.current = Date.now();
      recordingStopMsRef.current = recordingStartMsRef.current;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = finalizeRecording;
      mediaRecorderRef.current = recorder;
      recordingActiveRef.current = true;
      recorder.start();
      setIsRecording(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }, [ensureEngine, startLoop, finalizeRecording]);

  const startUrl = useCallback(
    async (url: string, name: string) => {
      if (recordingActiveRef.current) return;
      setError(null);
      try {
        await ensureEngine();
        const video = videoRef.current;
        if (!video) throw new Error("video element missing");
        stopCameraTracks();
        video.src = url;
        video.loop = true;
        video.muted = true;
        await video.play();
        modeRef.current = "file";
        epochRef.current = performance.now() - video.currentTime * 1000;
        setMode("file");
        setVideoName(name);
        startLoop();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("error");
      }
    },
    [ensureEngine, startLoop],
  );

  const startFile = useCallback(
    async (file: File) => {
      await startUrl(URL.createObjectURL(file), file.name);
    },
    [startUrl],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      const video = videoRef.current;
      if (video?.srcObject instanceof MediaStream) {
        video.srcObject.getTracks().forEach((track) => track.stop());
      }
      if (mediaRecorderRef.current?.state !== "inactive") {
        recordingStopMsRef.current = Date.now();
        mediaRecorderRef.current?.stop();
      }
      engineRef.current?.close();
      canonicalSessionRef.current = null;
    },
    [],
  );

  // 组件卸载时回收上一轮录制产物的 object URL,避免内存泄漏
  useEffect(
    () => () => {
      setRecordingResult((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous.videoUrl);
          URL.revokeObjectURL(previous.keypointsUrl);
        }
        return previous;
      });
    },
    [],
  );

  const updateSettings = (patch: Partial<AgentSettings>) => {
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  /** 一键完整分析:采集 → 本地分期 → 逐 rep 指标 → 确定性规则评分。 */
  const runFullAnalysis = async () => {
    setAnalysisStage("collecting");
    setClassified(null);
    setSegments([]);
    setError(null);
    setLocalResult(null);
    setTrajectory(null);
    setAutoSeg(null);
    setPhaseFrames([]);
    setLinkTimes(null);
    setSetAnalysis(null);
    setFormExplanation(null);
    setFormExplanationError(null);
    try {
      const video = videoRef.current;
      if (video && modeRef.current === "file") {
        video.currentTime = 0;
        await video.play();
      }
      // The await above may let the previous sequence publish one last frame.
      // File analysis starts a new sequence; live-camera analysis stays inside the
      // recording sequence but gets a fresh analysis/signal window.
      keyframesRef.current = [];
      if (recordingActiveRef.current) {
        resetCanonicalConsumers();
      } else {
        rotateCanonicalSequence();
      }
      // 采集窗口:原来固定 10s,装不下一个完整的慢速循环(实测慢速引体单次接近 8s,
      // 而分期需要"静息→极点→静息"整段,至少要两个静息端)。文件模式尽量放完整段视频,
      // 相机模式给 30s。
      const collectMs =
        video && video.duration > 0
          ? Math.min((video.duration - 0.2) * 1000, COLLECT_MAX_MS)
          : COLLECT_MAX_MS;
      await new Promise((resolve) => setTimeout(resolve, Math.max(collectMs, 3000)));

      const buffer = poseBufferRef.current;
      if (buffer.length < 20) throw new Error("采集到的姿态数据太少,请确认画面中有人");
      const times: Record<string, number> = {};
      setStageTimes({});

      setAnalysisStage("classifying");
      let stageStart = performance.now();
      const features = computeExerciseFeatures(buffer);

      // 1) 动作无关的自动分期 —— 还不知道是什么动作,先把运动循环找出来
      const auto = segmentRepsAuto(buffer);
      setAutoSeg(auto);
      const cycle = representativeCycle(auto.cycles);

      // 2) 轨迹特征:两条链路共用同一份输入,保证对比是公平的
      const traj = computeTrajectoryFeatures(buffer, auto.cycles);
      setTrajectory(traj);

      // 3) 按相位抽三张图:起始位 / 中间位 / 顶点
      const picked = cycle
        ? pickPhaseFrames(keyframesRef.current, cycle)
        : pickEvenFrames(keyframesRef.current);
      setPhaseFrames(
        picked.map((p) => ({
          phase: p.phase,
          dataUrl: `data:image/jpeg;base64,${p.jpeg}`,
          timestampMs: p.t,
        })),
      );

      // 4) 本地动作建议只服务于分期；它不能替代用户选择，也不会决定评分。
      const localStart = performance.now();
      const local = classifyLocally({
        trajectory: traj,
        segmentation: auto,
        posture: features.posture,
      });
      const localMs = performance.now() - localStart;
      setLocalResult(local);

      // 5) 逐 rep 指标提取 + 规则引擎评分。用户明确选择时直接采用它;
      // 自动模式只使用本地分类器的结果，绝不借用 LLM 判断或猜测一个动作，避免把方向判反。
      // local.confidence 是三档字符串，这里的数值映射只是把本地分类结果适配到既有契约。
      if (exerciseChoice === "") {
        throw new Error("请先选择训练动作，或启用自动识别模式");
      }
      const localConfidenceValue = { high: 0.9, medium: 0.6, low: 0.3 }[local.confidence];
      const analysis = analyzePoseSet({
        poses: buffer,
        cameraView,
        exercise:
          exerciseChoice === "auto"
            ? {
                mode: "auto",
                exerciseId: local.id === "unknown" ? null : local.id,
                confidence: localConfidenceValue,
              }
            : { mode: "user", exerciseId: exerciseChoice },
        autoSuggestion: {
          exerciseId: local.id === "unknown" ? null : local.id,
          confidence: localConfidenceValue,
        },
      });
      if (!analysis.extraction || !analysis.score) {
        throw new Error(analysis.reason ?? "当前动作没有可运行的运动学 profile");
      }
      setSetAnalysis(analysis);
      const computedScore = analysis.score;

      setLinkTimes({ local: localMs, open: 0 });
      times["本地分期"] = performance.now() - stageStart;

      const exerciseId = exerciseChoice === "auto" ? local.id : exerciseChoice;
      setClassified(
        `本地建议: ${local.id}(${local.confidence}) | 分期采用: ${exerciseId === "unknown" ? "未确定" : exerciseId}`,
      );

      setSegments(analysis.segments);

      // 表达层:把规则引擎已经判定好的结果翻译成大白话。这一步失败不影响上面已经
      // 算好的分数和逐 rep 表——用户依然能看到技术性的原始数值,只是少一段点评。
      if (computedScore.reps.length > 0) {
        setAnalysisStage("rendering");
        const exerciseLabel =
          (exerciseId === "unknown" ? undefined : EXERCISE_REGISTRY.get(exerciseId)?.nameZh) ??
          "力量训练动作";
        try {
          const explanationStart = performance.now();
          const explanation = await explainFormScore(settings, {
            exerciseLabel,
            cameraView,
            score: computedScore,
          });
          setFormExplanation(explanation);
          times["大白话点评"] = performance.now() - explanationStart;
        } catch (caught) {
          setFormExplanationError(caught instanceof Error ? caught.message : String(caught));
        }
      }

      setStageTimes(times);
      setAnalysisStage("done");
    } catch (caught) {
      setAnalysisStage(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const poseConnections = engineKind === "rtmpose" ? COCO17_CONNECTIONS : POSE_CONNECTIONS;
  const landmarkTotal = engineKind === "rtmpose" ? 17 : 33;
  const posePresentation = buildCanonicalPosePresentation(pose, poseConnections);
  const {
    renderableLandmarks,
    measuredLandmarks,
    repairedLandmarks,
    usableLandmarks,
  } = posePresentation;

  const trackingOk = usableLandmarks.size >= landmarkTotal * 0.6;
  const analyzing = analysisStage !== null && analysisStage !== "done";
  const videoViewport = fitVideoIntoStage(videoAspect);

  return (
    <div style={styles.page}>
      {/* ===== 顶部:品牌 + 全局状态 ===== */}
      <header style={styles.header} className="range-header">
        <div style={styles.brand}>
          <span style={styles.brandLogo}>FORM·RANGE</span>
          <span style={styles.brandSub} className="range-brand-sub">动作分析靶场 / POSE TELEMETRY CONSOLE</span>
        </div>
        <div style={styles.headerStatus}>
          <span
            style={{
              ...styles.led,
              background: status === "running" ? (trackingOk ? HUD.primary : HUD.amber) : HUD.dim,
              animation: status === "running" ? "hud-blink 2.4s infinite" : "none",
            }}
          />
          <span style={styles.headerStatusText}>
            {status === "running"
              ? trackingOk
                ? "TRACKING · 追踪锁定"
                : "WEAK LOCK · 追踪偏弱"
              : "STANDBY · 待机"}
          </span>
        </div>
      </header>

      <div style={styles.body} className="range-body">
        <main style={styles.main} className="range-main">
          <div style={styles.stageWrap} className="hud-reveal hud-reveal-1">
            <div style={{ ...styles.stage, aspectRatio: String(STAGE_ASPECT) }} className="hud-scanline">
              {cornerBrackets(trackingOk && status === "running" ? HUD.primary : HUD.lineBright).map(
                (style, index) => (
                  <div key={index} style={style} />
                ),
              )}
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                playsInline
                muted
                onLoadedMetadata={(event) => {
                  const v = event.currentTarget;
                  if (v.videoWidth > 0 && v.videoHeight > 0) {
                    setVideoAspect(v.videoWidth / v.videoHeight);
                  }
                }}
                style={{ ...styles.video, ...videoViewport, ...(mode === "camera" ? styles.mirror : null) }}
              />
              <svg
                style={{ ...styles.overlay, ...videoViewport, ...(mode === "camera" ? styles.mirror : null) }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                data-canonical-frame-id={pose?.frameId}
              >
                {posePresentation.edges.map((edge) => {
                  return (
                    <line
                      key={`${edge.fromIndex}-${edge.toIndex}`}
                      data-pose-edge={`${edge.fromIndex}-${edge.toIndex}`}
                      data-pose-repaired={edge.repaired ? "true" : "false"}
                      x1={edge.start.x * 100}
                      y1={edge.start.y * 100}
                      x2={edge.end.x * 100}
                      y2={edge.end.y * 100}
                      stroke={edge.repaired ? "#9ca3af" : HUD.primary}
                      strokeWidth="0.5"
                      strokeDasharray={edge.repaired ? "1.5 1" : undefined}
                      opacity={edge.repaired ? 0.7 : 1}
                    />
                  );
                })}
                {[...measuredLandmarks.entries()].map(([index, landmark]) => (
                  <circle
                    key={index}
                    cx={landmark.x * 100}
                    cy={landmark.y * 100}
                    r="0.7"
                    fill={HUD.amber}
                    opacity={Math.max(0.3, landmark.canonicalConfidence)}
                  />
                ))}
                {[...repairedLandmarks.entries()].map(([index, landmark]) => (
                  <circle
                    key={`r${index}`}
                    cx={landmark.x * 100}
                    cy={landmark.y * 100}
                    r="0.6"
                    fill="#9ca3af"
                    opacity={Math.max(0.35, landmark.canonicalConfidence)}
                  />
                ))}
              </svg>
              {status !== "running" && (
                <div style={styles.stagePlaceholder}>
                  <div style={styles.placeholderReticle}>◎</div>
                  <div>
                    {status === "loading-model" || modelLoading
                      ? "模型加载中…"
                      : status === "starting-camera"
                        ? "正在打开相机…"
                        : "选择输入源,开始追踪"}
                  </div>
                </div>
              )}
              <div style={styles.hud}>
                <span style={styles.hudItem}>
                  <span style={styles.hudLabel}>FPS</span>
                  <span style={styles.hudValue}>{fps}</span>
                </span>
                <span style={styles.hudItem}>
                  <span style={styles.hudLabel}>PTS</span>
                  <span style={styles.hudValue}>
                    {renderableLandmarks.size}/{landmarkTotal}
                  </span>
                </span>
                {videoName && (
                  <span style={styles.hudItem}>
                    <span style={styles.hudLabel}>SRC</span>
                    <span style={styles.hudValue}>{videoName}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div style={styles.outputGrid} className="range-output-grid">
            <section style={styles.dataPanel} className="hud-reveal hud-reveal-2">
              <div style={styles.panelHeader}>
                <div>
                  <span style={styles.panelKicker}>DATA OUTPUT</span>
                  <h2 style={styles.panelTitle}>动作数据</h2>
                </div>
                <span style={styles.panelStat}>
                  {setAnalysis?.reps.length ?? 0} REPS
                </span>
              </div>
              <div style={styles.signalStrip}>
                <div style={styles.curveTitle}>
                  <span>OSC · 肘角信号</span>
                  <span style={styles.curveValue}>
                    {signalCurve.length > 0 ? `${signalCurve[signalCurve.length - 1].v.toFixed(0)}°` : "——"}
                  </span>
                </div>
                <SignalCurve samples={signalCurve} />
              </div>
              {setAnalysis?.extraction && setAnalysis.score ? (
                <RepMetricsPanel
                  analysis={setAnalysis}
                  onSeek={(timestampMs) => {
                    if (videoRef.current) videoRef.current.currentTime = timestampMs / 1000;
                  }}
                  embedded
                />
              ) : (
                <p style={styles.emptyOutput}>等待采集后生成逐 rep 行程、左右差和规则评分。</p>
              )}
            </section>

            <section
              style={styles.agentPanel}
              className={`hud-reveal hud-reveal-3${analyzing ? " hud-scanning" : ""}`}
            >
              <div style={styles.panelHeader}>
                <div>
                  <span style={styles.panelKicker}>COACH AGENT</span>
                  <h2 style={styles.panelTitle}>训练观察</h2>
                </div>
                <span
                  style={{
                    ...styles.agentStatus,
                    color: analyzing ? HUD.amber : localResult ? HUD.primary : HUD.dim,
                    borderColor: analyzing ? HUD.amber : localResult ? HUD.primaryDim : HUD.line,
                  }}
                >
                  {analyzing ? "ANALYZING" : localResult ? "READY" : "STANDBY"}
                </span>
              </div>
              {analyzing ? (
                <p style={styles.reportStage}>{ANALYSIS_STAGE_LABELS[analysisStage ?? ""] ?? "正在分析"}</p>
              ) : localResult ? (
                <>
                  {formExplanation ? (
                    <>
                      <div style={styles.agentHeadline}>{formExplanation.summary}</div>
                      {setAnalysis?.score && (
                        <p style={styles.reportMeta}>
                          {setAnalysis.score.score === null
                            ? setAnalysis.score.label
                            : `${setAnalysis.score.score} 分`}
                        </p>
                      )}
                      <ul style={styles.agentList}>
                        {formExplanation.perRep.map((item) => (
                          <li key={item.repIndex}>
                            第 {item.repIndex} 下：{item.note}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <>
                      <div style={styles.agentHeadline}>
                        {classified?.split("|")[0].replace("本地建议:", "") ?? "动作分析完成"}
                      </div>
                      {classified && <p style={styles.reportMeta}>{classified}</p>}
                    </>
                  )}
                  {formExplanationError && (
                    <p style={styles.agentWarning}>
                      大白话点评暂时没生成（{formExplanationError}），下面仍是规则引擎算好的原始数值。
                    </p>
                  )}
                  <details style={{ marginTop: 8 }}>
                    <summary style={styles.reportMeta}>本地识别依据（技术细节）</summary>
                    <ul style={styles.agentList}>
                      {localResult.reasons.slice(0, 4).map((reason) => (
                        <li key={reason}>{reason}</li>
                      ))}
                    </ul>
                    {localResult.dataIssues.length > 0 && (
                      <p style={styles.agentWarning}>数据提醒：{localResult.dataIssues.join("；")}</p>
                    )}
                  </details>
                </>
              ) : (
                <p style={styles.emptyOutput}>选择动作并完成一段采集后，这里会固定呈现本地动作识别与训练提示。</p>
              )}
              {Object.keys(stageTimes).length > 0 && (
                <p style={styles.timingLine}>
                  T+ {Object.entries(stageTimes).map(([key, value]) => `${key} ${(value / 1000).toFixed(1)}s`).join(" · ")}
                </p>
              )}
            </section>
          </div>
        </main>

        <aside style={styles.sidebar} className="range-sidebar">
          <div style={styles.sideSection} className="hud-reveal hud-reveal-1">
            <div style={styles.sideTitle}>01 · 采集输入</div>
            <div style={styles.btnRow}>
              {status === "running" ? (
                <button style={{ ...styles.btn, background: "#4c1d1d", color: "#fca5a5" }} onClick={stop}>
                  ■ 停止
                </button>
              ) : (
                <button style={{ ...styles.btn, background: HUD.primaryDim, color: "#eafff2" }} onClick={start}>
                  ▶ 相机
                </button>
              )}
              <label
                style={{
                  ...styles.btn,
                  background: HUD.panel2,
                  border: `1px solid ${HUD.line}`,
                  textAlign: "center",
                  opacity: isRecording ? 0.3 : 1,
                  pointerEvents: isRecording ? "none" : "auto",
                }}
              >
                本地视频
                <input
                  type="file"
                  disabled={isRecording}
                  accept="video/mp4,video/quicktime,.mp4,.mov"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void startFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
            </div>
            <div style={styles.btnRow}>
              {SAMPLE_VIDEOS.map((sample, index) => (
                <button
                  key={sample}
                  disabled={isRecording}
                  style={{
                    ...styles.btnSmall,
                    ...(videoName === `视频 ${index + 1}` ? styles.btnSmallActive : null),
                    opacity: isRecording ? 0.3 : 1,
                  }}
                  onClick={() => void startUrl(`/videos/${sample}`, `视频 ${index + 1}`)}
                >
                  V{index + 1}
                </button>
              ))}
            </div>
            {isRecording && (
              <p style={styles.recordingBadge}>● 录制中 —— 停止相机即产出视频与关键点文件</p>
            )}
            {recordingResult && !isRecording && (
              <div style={styles.recordingResult}>
                <p style={styles.recordingResultMeta}>
                  上次录制:{recordingResult.durationSec.toFixed(1)}s · {recordingResult.poseCount} 帧
                </p>
                <div style={styles.btnRow}>
                  <a
                    href={recordingResult.videoUrl}
                    download={recordingResult.videoName}
                    style={{ ...styles.btnSmall, textDecoration: "none", textAlign: "center" }}
                  >
                    ↓ 视频
                  </a>
                  <a
                    href={recordingResult.keypointsUrl}
                    download={recordingResult.keypointsName}
                    style={{ ...styles.btnSmall, textDecoration: "none", textAlign: "center" }}
                  >
                    ↓ 关键点(可直接喂 harness)
                  </a>
                </div>
              </div>
            )}
          </div>

          <div style={styles.sideSection} className="hud-reveal hud-reveal-2">
            <div style={styles.sideTitle}>02 · 动作配置</div>
            <label style={styles.exerciseField}>
              <span>训练动作</span>
              <select
                style={styles.exerciseSelect}
                value={exerciseChoice}
                onChange={(event) => setExerciseChoice(event.target.value)}
              >
                <option value="">请选择本次训练动作</option>
                {EXERCISE_REGISTRY.exercises.map((exercise) => (
                  <option key={exercise.id} value={exercise.id}>
                    {exercise.nameZh} · {EXERCISE_MATURITY_LABEL[exercise.maturity]}
                  </option>
                ))}
                <option value="auto">自动识别（不确定时仅输出数据）</option>
              </select>
            </label>
            {exerciseChoice !== "" && exerciseChoice !== "auto" && (() => {
              const selected = EXERCISE_REGISTRY.get(exerciseChoice);
              return selected ? (
                <p style={styles.catalogMeta}>
                  {selected.nameEn} · {selected.movementPattern} · {selected.equipment.join(" / ")}
                  <br />
                  成熟度：{EXERCISE_MATURITY_LABEL[selected.maturity]}
                  {selected.variationOf
                    ? ` · 变式来源：${EXERCISE_REGISTRY.require(selected.variationOf).nameZh}`
                    : ""}
                </p>
              ) : null;
            })()}
            <div style={styles.subsectionLabel}>拍摄机位</div>
            <div style={styles.btnRow}>
              {CAMERA_VIEWS.map((view) => (
                <button
                  key={view.id}
                  style={{
                    ...styles.btnSmall,
                    ...(cameraView === view.id ? styles.btnSmallActiveAmber : null),
                  }}
                  onClick={() => {
                    setCameraView(view.id);
                    cameraViewRef.current = view.id;
                  }}
                >
                  {view.label.replace("(推荐)", "")}
                </button>
              ))}
            </div>
            <p style={styles.guidance}>
              {CAMERA_VIEWS.find((view) => view.id === cameraView)?.guidance}
            </p>
            <div style={styles.telemetryRow}>
              <span>FPS <strong>{fps}</strong></span>
              <span>POINTS <strong>{measuredLandmarks.size}/{landmarkTotal}</strong></span>
              <span>LEAN <strong>{torsoLean === null ? "—" : `${torsoLean.toFixed(0)}°`}</strong></span>
            </div>
          </div>

          <div style={styles.sideSection} className="hud-reveal hud-reveal-3">
            <div style={styles.sideTitle}>03 · 模型选择</div>
            <div style={styles.btnRow}>
              {ENGINE_KINDS.map((engine) => (
                <button
                  key={engine.id}
                  disabled={isRecording}
                  style={{
                    ...styles.btnSmall,
                    ...(engineKind === engine.id ? styles.btnSmallActive : null),
                    opacity: isRecording ? 0.3 : 1,
                  }}
                  onClick={() => void switchEngine(engine.id)}
                >
                  {engine.label}
                </button>
              ))}
            </div>
            <div style={styles.btnRow}>
              {POSE_MODELS.map((model) => {
                const disabled = engineKind !== "mediapipe" || isRecording;
                const active = !disabled && modelId === model.id;
                return (
                  <button
                    key={model.id}
                    disabled={disabled}
                    style={{
                      ...styles.btnSmall,
                      ...(active ? styles.btnSmallActive : null),
                      opacity: disabled ? 0.3 : 1,
                    }}
                    onClick={() => void switchModel(model.id)}
                  >
                    {model.label}
                  </button>
                );
              })}
              <button
                disabled={isRecording}
                style={{
                  ...styles.btnSmall,
                  ...(filterEnabled ? styles.btnSmallActive : null),
                  opacity: isRecording ? 0.3 : 1,
                }}
                onClick={() => {
                  if (recordingActiveRef.current) return;
                  const next = !filterEnabledRef.current;
                  filterEnabledRef.current = next;
                  setFilterEnabled(next);
                  rotateCanonicalSequence();
                }}
              >
                算法：{filterEnabled ? "旧版" : "融合"}
              </button>
            </div>
          </div>

          <button
            style={{
              ...styles.analyzeBtn,
              ...(analyzing ? styles.analyzeBtnBusy : null),
            }}
            className={analyzing ? "hud-scanning" : undefined}
            disabled={analyzing || status !== "running"}
            onClick={runFullAnalysis}
          >
            {analysisStage
              ? ANALYSIS_STAGE_LABELS[analysisStage] ?? analysisStage
              : "▶ 一键完整分析"}
          </button>

          {error && <p style={styles.errorText}>{error}</p>}

          <div style={styles.sideSection}>
            <button
              style={styles.settingsToggle}
              onClick={() => setSettingsOpen((open) => !open)}
            >
              05 · LLM 设置 {settingsOpen ? "▲" : "▼"}
              <span style={styles.settingsHint}>
                {settings.provider}/{settings.modelId.slice(0, 16)}
              </span>
            </button>
            {settingsOpen && (
              <div style={{ marginTop: 8 }}>
                <label style={styles.field}>
                  PROVIDER
                  <select
                    value={settings.provider}
                    onChange={(event) => {
                      const provider = event.target.value;
                      updateSettings({
                        provider,
                        modelId: PROVIDER_DEFAULTS[provider] ?? "",
                        ...(provider === "zhipu"
                          ? {
                              baseUrl: ZHIPU_DEFAULTS.baseUrl,
                              apiKey: settings.apiKey || ZHIPU_DEFAULTS.apiKey,
                            }
                          : { baseUrl: undefined }),
                      });
                    }}
                  >
                    {Object.keys(PROVIDER_DEFAULTS).map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.field}>
                  MODEL
                  <input
                    value={settings.modelId}
                    onChange={(event) => updateSettings({ modelId: event.target.value })}
                  />
                </label>
                {settings.provider === "zhipu" && (
                  <label style={styles.field}>
                    BASE URL
                    <input
                      value={settings.baseUrl ?? ""}
                      onChange={(event) => updateSettings({ baseUrl: event.target.value })}
                    />
                  </label>
                )}
                <label style={styles.field}>
                  API KEY
                  <input
                    type="password"
                    value={settings.apiKey}
                    onChange={(event) => updateSettings({ apiKey: event.target.value })}
                  />
                </label>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** 取可见性更高一侧的肘角 */
function bestElbowAngle(pose: PoseEstimate, kind: EngineKind): number | null {
  const triplets = ELBOW_TRIPLETS[kind === "rtmpose" ? "rtmpose" : "mediapipe"];
  const sides = [triplets.left, triplets.right]
    .map(([s, e, w]) => {
      const shoulder = pose.landmarks[s];
      const elbow = pose.landmarks[e];
      const wrist = pose.landmarks[w];
      if (!shoulder || !elbow || !wrist) return null;
      const confidence = Math.min(shoulder.visibility, elbow.visibility, wrist.visibility);
      if (confidence < 0.5) return null;
      return { angle: angleDeg(shoulder, elbow, wrist), confidence };
    })
    .filter((v): v is { angle: number; confidence: number } => v !== null);
  if (sides.length === 0) return null;
  return sides.sort((a, b) => b.confidence - a.confidence)[0].angle;
}

/** 肘角信号曲线(SVG 折线) */
const CONFIDENCE_COLOR: Record<string, string> = {
  high: HUD.primary,
  medium: HUD.amber,
  low: HUD.danger,
};

/** 双链路识别对比:同一份数据,本地规则 vs LLM 自主判断 */
function RecognitionCompare({
  local,
  open,
  openError,
  trajectory,
  autoSeg,
  phaseFrames,
  linkTimes,
}: {
  local: LocalClassification | null;
  open: OpenRecognition | null;
  openError: string | null;
  trajectory: TrajectoryFeatures | null;
  autoSeg: AutoSegmentation | null;
  phaseFrames: Array<{ phase: string; dataUrl: string; timestampMs: number }>;
  linkTimes: { local: number; open: number } | null;
}) {
  if (!local && !open && !openError) return null;

  // 一致性:把 LLM 的自由文本名映射回内部 id 后比对
  const openMappedId = open ? guessExerciseId(`${open.name} ${open.nameEn}`) : null;
  const agree = local && openMappedId ? local.id === openMappedId : null;

  return (
    <div style={compareStyles.wrap}>
      <div style={compareStyles.header}>
        <span style={compareStyles.headerTitle}>动作识别 · 双链路对比</span>
        {agree !== null && (
          <span
            style={{
              ...compareStyles.badge,
              background: "transparent",
              border: `1px solid ${agree ? HUD.primaryDim : HUD.danger}`,
              color: agree ? HUD.primary : HUD.danger,
            }}
          >
            {agree ? "✓ 两条链路一致" : "✗ 两条链路不一致"}
          </span>
        )}
        {linkTimes && (
          <span style={compareStyles.timing}>
            本地 {linkTimes.local.toFixed(0)}ms · LLM {(linkTimes.open / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* 送给 LLM 的三张相位图 */}
      {phaseFrames.length > 0 && (
        <div style={compareStyles.frameRow}>
          {phaseFrames.map((frame) => (
            <div key={frame.phase} style={compareStyles.frameCell}>
              <img src={frame.dataUrl} alt={frame.phase} style={compareStyles.frameImg} />
              <div style={compareStyles.frameLabel}>
                {frame.phase}
                <span style={compareStyles.frameTime}>
                  {(frame.timestampMs / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={compareStyles.columns}>
        {/* ---- 链路 A ---- */}
        <div style={compareStyles.col}>
          <div style={compareStyles.colTitle}>链路 A · 本地规则(无网络)</div>
          {local ? (
            <>
              <div style={compareStyles.answer}>
                {local.id === "unknown" ? "无法确定" : local.id}
                <span
                  style={{
                    ...compareStyles.conf,
                    color: CONFIDENCE_COLOR[local.confidence],
                  }}
                >
                  {local.confidence} · 领先度 {local.margin}
                </span>
              </div>
              {local.dataIssues.length > 0 && (
                <div style={compareStyles.issues}>
                  ⚠ {local.dataIssues.join("；")}
                </div>
              )}
              <ul style={compareStyles.list}>
                {local.reasons.map((reason) => (
                  <li key={reason} style={compareStyles.listItem}>
                    {reason}
                  </li>
                ))}
              </ul>
              <details>
                <summary style={compareStyles.summary}>各候选得分</summary>
                <pre style={compareStyles.pre}>
                  {local.scores
                    .map((s) => `${s.score.toString().padStart(2)}  ${s.id}`)
                    .join("\n")}
                </pre>
              </details>
            </>
          ) : (
            <div style={compareStyles.muted}>未运行</div>
          )}
        </div>

        {/* ---- 链路 B ---- */}
        <div style={compareStyles.col}>
          <div style={compareStyles.colTitle}>链路 B · LLM 自主判断(不给选项)</div>
          {open ? (
            <>
              <div style={compareStyles.answer}>
                {open.name}
                <span
                  style={{ ...compareStyles.conf, color: CONFIDENCE_COLOR[open.confidence] }}
                >
                  {open.confidence}
                  {open.uncertain ? " · 自述不确定" : ""}
                </span>
              </div>
              <div style={compareStyles.meta}>
                {open.nameEn && `${open.nameEn} · `}
                器械 {open.equipment} · 体位 {open.bodyPosition}
                {openMappedId && ` · 映射到 ${openMappedId}`}
              </div>
              {open.reasoning && <p style={compareStyles.reasoning}>{open.reasoning}</p>}
              <ul style={compareStyles.list}>
                {open.evidence.map((e) => (
                  <li key={e} style={compareStyles.listItem}>
                    {e}
                  </li>
                ))}
              </ul>
              {open.alternatives.length > 0 && (
                <details>
                  <summary style={compareStyles.summary}>排除的候选</summary>
                  <pre style={compareStyles.pre}>
                    {open.alternatives.map((a) => `${a.name} — ${a.whyNot}`).join("\n")}
                  </pre>
                </details>
              )}
              {open.cannotTell.length > 0 && (
                <div style={compareStyles.issues}>
                  骨架看不出:{open.cannotTell.join("；")}
                </div>
              )}
            </>
          ) : (
            <div style={compareStyles.muted}>{openError ? `失败:${openError}` : "未运行"}</div>
          )}
        </div>
      </div>

      <details style={{ marginTop: 8 }}>
        <summary style={compareStyles.summary}>轨迹特征与自动分期(两条链路的共同输入)</summary>
        {autoSeg && (
          <pre style={compareStyles.pre}>
            {`选中信号: ${autoSeg.signal ?? "无"}  周期 ${autoSeg.periodSec ?? "-"}s  强度 ${autoSeg.periodStrength ?? "-"}
循环数: ${autoSeg.cycles.length}
候选信号排名:
${autoSeg.ranking.map((r) => `  ${r.signal.padEnd(15)} score=${r.score}  幅度=${r.normRange}  周期性=${r.strength}`).join("\n")}`}
          </pre>
        )}
        <pre style={compareStyles.pre}>{JSON.stringify(trajectory, null, 2)}</pre>
      </details>
    </div>
  );
}

/** 每个指标一列的格式化;value 为 null 时统一显示 "—"(与 0 区分开)。 */
function formatMetricValue(value: number | null | undefined, digits: number): string {
  return value === null || value === undefined ? "—" : value.toFixed(digits);
}

const REP_STATUS_LABEL: Record<string, string> = {
  scored: "已评分",
  partial: "部分未判定",
  not_scored: "未评分",
};

/**
 * 逐 rep 原始数值 + 规则引擎评分。
 *
 * 现场标定用:只展示测量值,不做任何"这算不算错"的额外包装——那是规则引擎的判断,
 * 这里只是如实呈现它的输出。"未判定"与"判定为没问题"必须区分显示,不能把前者
 * 显示成后者,否则用户会把"这条规则没跑"误读成"这条规则说你没问题"。
 */
function RepMetricsPanel({
  analysis,
  onSeek,
  embedded = false,
}: {
  analysis: PoseSetAnalysisResult;
  onSeek?: (timestampMs: number) => void;
  embedded?: boolean;
}) {
  const { extraction, score } = analysis;
  if (!extraction || !score) return null;

  return (
    <div
      style={
        embedded
          ? { ...compareStyles.wrap, background: "transparent", border: "none", padding: 0, marginBottom: 0 }
          : compareStyles.wrap
      }
    >
      <div style={compareStyles.header}>
        <span style={compareStyles.headerTitle}>逐 REP 指标 · 规则引擎评分</span>
        <span style={compareStyles.timing}>
          分期信号 {extraction.signal ?? "无"} · 阈值 {score.thresholdStatus}(验证样本 {score.validationSampleSize})
        </span>
      </div>

      <p style={compareStyles.meta}>
        {analysis.exercise.nameZh ?? analysis.exercise.id ?? "自动分期"} · 机位 {extraction.context.cameraView} ·
        profile {analysis.versions.profile ?? "auto/unprofiled"} · rule {analysis.versions.rule}
      </p>

      <p style={compareStyles.meta}>
        整组:{score.score === null ? "—" : `${score.score} 分`} · {score.label} ·{" "}
        {score.scoredRepCount}/{score.totalRepCount} 个 rep 已评分 · 覆盖 {analysis.coverage.eligibleEvaluations}/
        {analysis.coverage.totalEvaluations} · 拒答 {analysis.coverage.refused}
      </p>
      <p style={compareStyles.meta}>
        规则四态：通过 {analysis.coverage.passed} · 扣分 {analysis.coverage.deducted} · 拒答{" "}
        {analysis.coverage.refused} · 不适用 {analysis.coverage.notApplicable}
      </p>

      {extraction.reps.length === 0 ? (
        <div style={compareStyles.muted}>本次未能切出 rep(检查分期信号是否选中、机位是否稳定)</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={repTableStyles.table}>
            <thead>
              <tr>
                {["#", "时间 / 定位", "幅度", "不对称", "躯干漂移°", "→极点ms", "极点→ms", "分数", "状态"].map((h) => (
                  <th key={h} style={repTableStyles.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {score.reps.map((repScore) => {
                const rep = extraction.reps.find((r) => r.repIndex === repScore.repIndex);
                return (
                  <tr key={repScore.repIndex}>
                    <td style={repTableStyles.td}>{repScore.repIndex}</td>
                    <td style={repTableStyles.td}>
                      <button
                        type="button"
                        style={repTableStyles.seekButton}
                        onClick={() => rep && onSeek?.(rep.startMs)}
                        disabled={!rep || !onSeek}
                      >
                        {rep ? `${(rep.startMs / 1000).toFixed(1)}–${(rep.endMs / 1000).toFixed(1)}s` : "—"}
                      </button>
                    </td>
                    <td style={repTableStyles.td}>
                      {formatMetricValue(rep?.metrics[RULE_METRIC.amplitude]?.value, 3)}
                    </td>
                    <td style={repTableStyles.td}>
                      {formatMetricValue(rep?.metrics[RULE_METRIC.bilateralAsymmetryRatio]?.value, 3)}
                    </td>
                    <td style={repTableStyles.td}>
                      {formatMetricValue(rep?.metrics[RULE_METRIC.torsoDriftDeg]?.value, 1)}
                    </td>
                    <td style={repTableStyles.td}>
                      {formatMetricValue(rep?.metrics[RULE_METRIC.toExtremeMs]?.value, 0)}
                    </td>
                    <td style={repTableStyles.td}>
                      {formatMetricValue(rep?.metrics[RULE_METRIC.fromExtremeMs]?.value, 0)}
                    </td>
                    <td style={repTableStyles.td}>
                      {repScore.score === null ? "—" : repScore.score}
                    </td>
                    <td
                      style={{
                        ...repTableStyles.td,
                        color:
                          repScore.status === "scored"
                            ? HUD.primary
                            : repScore.status === "partial"
                              ? HUD.amber
                              : HUD.dim,
                      }}
                    >
                      {REP_STATUS_LABEL[repScore.status] ?? repScore.status}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={compareStyles.summary}>每条判据的详细依据(命中/拒答原因)</summary>
        <pre style={compareStyles.pre}>
          {score.reps
            .map((repScore) => {
              const rep = extraction.reps.find((candidate) => candidate.repIndex === repScore.repIndex);
              const quality = Object.entries(rep?.metrics ?? {})
                .map(
                  ([metric, observation]) =>
                    `  ${metric}: 可用帧 ${(observation.usableFrameRatio * 100).toFixed(0)}% · ` +
                    `置信度 ${observation.confidence.toFixed(2)} · 所需关节 ${observation.requiredJoints.join(", ")}`,
                )
                .join("\n");
              const rules = repScore.evaluations
                .map((e) => `  ${e.ruleId}: ${e.status}${e.reason ? ` — ${e.reason}` : ""}${e.deduction ? ` — ${e.deduction.message}(${e.deduction.evidence})` : ""}`)
                .join("\n");
              return `rep ${repScore.repIndex} (${REP_STATUS_LABEL[repScore.status] ?? repScore.status}):\n${quality}\n${rules}`;
            })
            .join("\n\n")}
        </pre>
      </details>
    </div>
  );
}

const repTableStyles: Record<string, React.CSSProperties> = {
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontFamily: HUD.mono,
    fontSize: 11,
  },
  th: {
    textAlign: "left",
    padding: "4px 8px",
    color: HUD.dim,
    borderBottom: `1px solid ${HUD.line}`,
    fontWeight: 700,
    letterSpacing: 1,
  },
  td: {
    padding: "4px 8px",
    color: HUD.text,
    borderBottom: `1px solid ${HUD.line}`,
    whiteSpace: "nowrap",
  },
  seekButton: {
    border: `1px solid ${HUD.line}`,
    background: "transparent",
    color: HUD.primary,
    fontFamily: HUD.mono,
    fontSize: 10,
    cursor: "pointer",
    padding: "2px 5px",
  },
};

const compareStyles: Record<string, React.CSSProperties> = {
  wrap: {
    background: HUD.panel2,
    border: `1px solid ${HUD.line}`,
    padding: 12,
    marginBottom: 12,
  },
  header: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  headerTitle: { fontSize: 12, fontWeight: 700, color: HUD.text, letterSpacing: 2 },
  badge: { fontSize: 11, fontWeight: 700, padding: "2px 8px", fontFamily: HUD.mono },
  timing: { marginLeft: "auto", fontSize: 11, color: HUD.dim, fontFamily: HUD.mono },
  frameRow: { display: "flex", gap: 6, marginBottom: 10 },
  frameCell: { flex: 1 },
  frameImg: {
    width: "100%",
    // 竖屏视频不加高度约束会把整个对比面板撑到上千像素高。
    // 这三张只是给人核对相位用的缩略图,不需要看清细节。
    height: 190,
    objectFit: "cover",
    objectPosition: "center 30%",
    display: "block",
    border: `1px solid ${HUD.line}`,
  },
  frameLabel: {
    fontSize: 10,
    color: HUD.dim,
    marginTop: 3,
    display: "flex",
    justifyContent: "space-between",
    fontFamily: HUD.mono,
  },
  frameTime: { color: HUD.dim },
  columns: { display: "flex", gap: 10, alignItems: "flex-start" },
  col: {
    flex: 1,
    minWidth: 0,
    background: "#050705",
    border: `1px solid ${HUD.line}`,
    padding: 10,
  },
  colTitle: { fontSize: 10, color: HUD.dim, marginBottom: 6, fontWeight: 700, letterSpacing: 1.5 },
  answer: { fontSize: 16, fontWeight: 700, color: HUD.primary, lineHeight: 1.3, fontFamily: HUD.mono },
  conf: { fontSize: 11, fontWeight: 600, marginLeft: 8 },
  meta: { fontSize: 11, color: HUD.dim, marginTop: 4, fontFamily: HUD.mono },
  reasoning: { fontSize: 12, color: HUD.text, margin: "6px 0", lineHeight: 1.55 },
  list: { margin: "6px 0 0", paddingLeft: 16 },
  listItem: { fontSize: 12, color: HUD.dim, marginBottom: 3, lineHeight: 1.5 },
  issues: {
    fontSize: 11,
    color: HUD.amber,
    marginTop: 6,
    background: "#1c1405",
    border: `1px solid #4a3510`,
    padding: "5px 7px",
    lineHeight: 1.5,
  },
  summary: { fontSize: 11, color: HUD.dim, cursor: "pointer", marginTop: 6 },
  pre: {
    fontSize: 11,
    color: HUD.dim,
    background: "#030503",
    border: `1px solid ${HUD.line}`,
    padding: 8,
    overflowX: "auto",
    maxHeight: 260,
    margin: "4px 0 0",
    fontFamily: HUD.mono,
  },
  muted: { fontSize: 12, color: HUD.danger },
};

function SignalCurve({ samples }: { samples: SignalSample[] }) {
  if (samples.length < 2) {
    return <div style={curveStyles.empty}>等待动作数据…</div>;
  }
  const w = 100;
  const h = 100;
  const values = samples.map((s) => s.v);
  const min = Math.min(...values) - 5;
  const max = Math.max(...values) + 5;
  const range = Math.max(max - min, 1);
  const points = samples
    .map((s, i) => {
      const x = (i / (samples.length - 1)) * w;
      const y = h - ((s.v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={curveStyles.svg}>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1="0"
          y1={h * ratio}
          x2={w}
          y2={h * ratio}
          stroke={HUD.line}
          strokeWidth="0.4"
        />
      ))}
      <polyline points={points} fill="none" stroke={HUD.primary} strokeWidth="1.6" />
    </svg>
  );
}

const curveStyles: Record<string, React.CSSProperties> = {
  svg: { width: "100%", height: 72, display: "block" },
  empty: { color: HUD.dim, fontSize: 11, padding: "22px 0", textAlign: "center", letterSpacing: 2 },
};

/** 挑一个浏览器支持的录制格式;都不支持时回退给 MediaRecorder 自己的默认值。 */
const RECORDER_MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

function pickRecorderMimeType(): string | null {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return null;
  return RECORDER_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** 抓取视频当前帧为缩略 JPEG(base64,不带前缀)。 */
function captureFrame(
  video: HTMLVideoElement,
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
): string | null {
  if (!canvasRef.current) {
    canvasRef.current = document.createElement("canvas");
  }
  const canvas = canvasRef.current;
  const maxW = 480;
  const scale = Math.min(1, maxW / video.videoWidth);
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.6);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

/** 从环缓冲里均匀挑 N 张关键帧 */
interface PhaseFrame {
  phase: string;
  jpeg: string;
  t: number;
}

/** 从关键帧缓冲里取时间上最接近 targetMs 的一张 */
function nearestFrame(
  buffer: Array<{ t: number; jpeg: string }>,
  targetMs: number,
): { t: number; jpeg: string } | null {
  if (buffer.length === 0) return null;
  let best = buffer[0];
  let bestDelta = Math.abs(buffer[0].t - targetMs);
  for (const frame of buffer) {
    const delta = Math.abs(frame.t - targetMs);
    if (delta < bestDelta) {
      best = frame;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * 按动作相位取三张图:起始位 / 中间位 / 顶点。
 * 中间位取起点到极点的中途 —— 三张图落在同一次行程上,才能看出动作方向。
 */
function pickPhaseFrames(
  buffer: Array<{ t: number; jpeg: string }>,
  cycle: { startMs: number; extremeMs: number },
): PhaseFrame[] {
  const targets: Array<{ phase: string; t: number }> = [
    { phase: "起始位", t: cycle.startMs },
    { phase: "中间位", t: (cycle.startMs + cycle.extremeMs) / 2 },
    { phase: "顶点", t: cycle.extremeMs },
  ];
  const out: PhaseFrame[] = [];
  for (const target of targets) {
    const frame = nearestFrame(buffer, target.t);
    if (frame) out.push({ phase: target.phase, jpeg: frame.jpeg, t: frame.t });
  }
  return out;
}

/** 分不出循环时的回落:整段均匀取三张,并如实标注相位未知 */
function pickEvenFrames(buffer: Array<{ t: number; jpeg: string }>): PhaseFrame[] {
  if (buffer.length === 0) return [];
  const labels = ["片段开头(相位未知)", "片段中部(相位未知)", "片段结尾(相位未知)"];
  const step = (buffer.length - 1) / 2;
  return labels.map((phase, i) => {
    const frame = buffer[Math.round(i * step)];
    return { phase, jpeg: frame.jpeg, t: frame.t };
  });
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    display: "flex",
    flexDirection: "column",
    fontFamily: `${HUD.mono}, ${HUD.sans}`,
    background: HUD.bg,
    backgroundImage: `linear-gradient(${HUD.line}18 1px, transparent 1px), linear-gradient(90deg, ${HUD.line}18 1px, transparent 1px)`,
    backgroundSize: "48px 48px",
    color: HUD.text,
    width: "100vw",
    minHeight: "100vh",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 18px",
    borderBottom: `1px solid ${HUD.line}`,
    background: HUD.panel,
    flexShrink: 0,
  },
  brand: { display: "flex", alignItems: "baseline", gap: 12 },
  brandLogo: {
    fontFamily: HUD.display,
    fontSize: 17,
    letterSpacing: 3,
    color: HUD.primary,
    textShadow: `0 0 14px ${HUD.primary}55`,
  },
  brandSub: {
    fontSize: 10,
    letterSpacing: 2,
    color: HUD.dim,
  },
  headerStatus: { display: "flex", alignItems: "center", gap: 8 },
  led: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    display: "inline-block",
  },
  headerStatusText: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: HUD.text,
  },
  body: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(300px, 340px)",
    gap: 14,
    padding: "14px clamp(14px, 2vw, 30px) 26px",
    overflow: "hidden",
    minHeight: 0,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    paddingRight: 2,
  },
  stageWrap: {
    flexShrink: 0,
    display: "flex",
    justifyContent: "center",
  },
  stage: {
    position: "relative",
    width: "100%",
    maxWidth: 1120,
    background: "#000",
    border: `1px solid ${HUD.line}`,
    overflow: "hidden",
  },
  stagePlaceholder: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    color: HUD.dim,
    fontSize: 13,
    letterSpacing: 2,
    background: HUD.panel,
  },
  placeholderReticle: {
    fontSize: 44,
    color: HUD.lineBright,
    animation: "hud-blink 2.4s infinite",
  },
  video: {
    width: "100%",
    height: "100%",
    objectFit: "fill",
    display: "block",
  },
  mirror: { transform: "scaleX(-1)" },
  overlay: {
    width: "100%",
    height: "100%",
  },
  hud: {
    position: "absolute",
    top: 10,
    left: 14,
    display: "flex",
    gap: 18,
    zIndex: 4,
  },
  hudItem: { display: "flex", alignItems: "baseline", gap: 6 },
  hudLabel: {
    fontSize: 9,
    letterSpacing: 2,
    color: HUD.dim,
  },
  hudValue: {
    fontSize: 15,
    fontWeight: 700,
    fontFamily: HUD.mono,
    color: HUD.primary,
    textShadow: `0 0 10px ${HUD.primary}44`,
  },
  outputGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)",
    gap: 12,
    alignItems: "stretch",
  },
  dataPanel: {
    minWidth: 0,
    minHeight: 260,
    background: HUD.panel,
    border: `1px solid ${HUD.line}`,
    padding: 14,
  },
  agentPanel: {
    minWidth: 0,
    minHeight: 260,
    background: "#0a110d",
    border: `1px solid ${HUD.lineBright}`,
    padding: 14,
  },
  panelHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 11,
    marginBottom: 10,
    borderBottom: `1px solid ${HUD.line}`,
  },
  panelKicker: { display: "block", color: HUD.dim, fontSize: 9, letterSpacing: 2.2, marginBottom: 4 },
  panelTitle: { margin: 0, color: HUD.text, fontSize: 16, fontWeight: 700, letterSpacing: 0 },
  panelStat: { color: HUD.primary, fontSize: 10, letterSpacing: 1.3, fontFamily: HUD.mono, paddingTop: 8 },
  signalStrip: { borderBottom: `1px solid ${HUD.line}`, marginBottom: 10, paddingBottom: 4 },
  curveTitle: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: 10,
    letterSpacing: 2,
    color: HUD.dim,
    marginBottom: 4,
  },
  curveValue: {
    fontFamily: HUD.mono,
    fontSize: 14,
    fontWeight: 700,
    color: HUD.primary,
  },
  reportStage: { color: HUD.amber, fontSize: 13, margin: 0, letterSpacing: 1 },
  reportMeta: { color: HUD.dim, fontSize: 12, margin: "0 0 10px", fontFamily: HUD.mono },
  emptyOutput: { color: HUD.dim, fontSize: 12, lineHeight: 1.7, margin: "28px 0 0", maxWidth: 360 },
  agentStatus: {
    border: "1px solid",
    fontSize: 9,
    fontFamily: HUD.mono,
    letterSpacing: 1.3,
    padding: "4px 6px",
    whiteSpace: "nowrap",
  },
  agentHeadline: { color: HUD.primary, fontFamily: HUD.mono, fontWeight: 700, fontSize: 17, margin: "2px 0 8px" },
  agentList: { margin: "10px 0 0", paddingLeft: 17, color: HUD.text },
  agentWarning: {
    color: HUD.amber,
    borderTop: `1px solid #4a3510`,
    margin: "12px 0 0",
    paddingTop: 8,
    fontSize: 11,
    lineHeight: 1.6,
  },
  funReport: {
    margin: 0,
    whiteSpace: "pre-wrap",
    fontSize: 14,
    lineHeight: 1.75,
    fontFamily: HUD.sans,
    color: HUD.text,
  },
  detailsSummary: { color: HUD.dim, fontSize: 11, cursor: "pointer", letterSpacing: 1 },
  jsonBlock: {
    background: "#050705",
    border: `1px solid ${HUD.line}`,
    padding: 10,
    fontSize: 11,
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    fontFamily: HUD.mono,
    color: HUD.dim,
  },
  timingLine: { color: HUD.dim, fontSize: 11, margin: "12px 0 0", fontFamily: HUD.mono },
  sidebar: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    overflowY: "auto",
    minWidth: 0,
    paddingRight: 2,
  },
  sideSection: {
    background: HUD.panel,
    border: `1px solid ${HUD.line}`,
    padding: 12,
  },
  sideTitle: {
    fontSize: 10,
    letterSpacing: 2,
    color: HUD.dim,
    marginBottom: 10,
    fontWeight: 600,
  },
  exerciseField: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    marginBottom: 12,
    color: HUD.text,
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.2,
  },
  exerciseSelect: {
    width: "100%",
    minHeight: 38,
    borderColor: HUD.primaryDim,
    color: HUD.text,
    fontWeight: 700,
    background: "#0c1610",
  },
  catalogMeta: {
    margin: "-5px 0 12px",
    color: HUD.dim,
    fontFamily: HUD.mono,
    fontSize: 10,
    lineHeight: 1.6,
  },
  subsectionLabel: {
    color: HUD.dim,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 7,
  },
  btnRow: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 },
  btn: {
    flex: 1,
    border: "none",
    clipPath: CHAMFER,
    padding: "13px 10px",
    fontSize: 14,
    fontWeight: 700,
    fontFamily: HUD.mono,
    color: HUD.text,
    cursor: "pointer",
    letterSpacing: 1,
  },
  btnSmall: {
    border: `1px solid ${HUD.line}`,
    background: HUD.panel2,
    clipPath: CHAMFER_SM,
    padding: "8px 13px",
    fontSize: 12,
    fontFamily: HUD.mono,
    color: HUD.text,
    cursor: "pointer",
    letterSpacing: 0.5,
  },
  btnSmallActive: {
    background: HUD.primaryDim,
    borderColor: HUD.primary,
    color: "#eafff2",
  },
  btnSmallActiveAmber: {
    background: "#5c3d0a",
    borderColor: HUD.amber,
    color: "#ffe9c2",
  },
  guidance: { color: HUD.dim, fontSize: 11, margin: "2px 0 0", lineHeight: 1.55 },
  recordingBadge: {
    color: HUD.danger,
    fontSize: 11,
    margin: "6px 0 0",
    letterSpacing: 1,
  },
  recordingResult: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: `1px solid ${HUD.line}`,
  },
  recordingResultMeta: {
    color: HUD.dim,
    fontSize: 11,
    margin: "0 0 6px",
    fontFamily: HUD.mono,
  },
  telemetryRow: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 6,
    marginTop: 10,
    color: HUD.dim,
    fontSize: 9,
    letterSpacing: 0.7,
  },
  analyzeBtn: {
    border: "none",
    clipPath: CHAMFER,
    padding: "17px 12px",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: HUD.mono,
    letterSpacing: 2,
    color: "#1a1000",
    background: HUD.amber,
    cursor: "pointer",
    position: "relative",
  },
  analyzeBtnBusy: { background: "#8a6a1c", cursor: "wait", color: "#2b1f05" },
  settingsToggle: {
    width: "100%",
    border: "none",
    background: "none",
    color: HUD.dim,
    fontSize: 10,
    letterSpacing: 2,
    fontFamily: HUD.mono,
    textAlign: "left",
    cursor: "pointer",
    padding: 0,
  },
  settingsHint: { float: "right", color: HUD.dim, fontSize: 10, letterSpacing: 0 },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    fontSize: 10,
    letterSpacing: 2,
    marginBottom: 8,
    color: HUD.dim,
  },
  errorText: { color: HUD.danger, fontSize: 12, margin: 0, fontFamily: HUD.mono },
};
