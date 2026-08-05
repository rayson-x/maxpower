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
  MUSCLE_GROUPS,
  type ExerciseMaturity,
} from "../pose/exerciseRegistry";
import { RULE_METRIC } from "../pose/formRuleEngine";
import { createWebMotionPacket, routeWebMotionPacket } from "../motion/webMotionPacket";
import { CanonicalActiveDurationAccumulator } from "../motion/canonicalActiveDuration";
import {
  InferenceCompletionGate,
  type InferenceCompletionDropReason,
} from "../motion/inferenceCompletionGate";
import {
  MotionPerformanceDegradationController,
  type MotionDegradationLevel,
} from "../motion/performanceDegradation";
import { resolveRustExerciseProfile } from "../motion/rustProfileResolver";
import {
  loadObservedRecognitionProfiles,
  resolveObservedRecognitionProfile,
} from "../motion/observedRecognitionProfiles";
import { resolveSimulatedRecognitionProfile } from "../motion/simulatedRecognitionProfile";
import { buildSimulatedTrajectoryBaseline } from "../motion/simulatedTrajectoryBaseline";
import {
  createPoseContinuitySession,
  type CanonicalPoseFrame,
  type PoseContinuitySession,
  type PoseSchema,
} from "../pose/canonicalPose";
import { buildCanonicalPosePresentation } from "../pose/canonicalPosePresentation";
import {
  INITIAL_TRACKER_READINESS,
  updateTrackerReadiness,
  type TrackerReadinessInput,
} from "../pose/trackerReadiness";
import { classifyLocally, type LocalClassification } from "../pose/localClassifier";
import { buildLabeledSetFixtureTemplate } from "../pose/labeledSetFixture";
import {
  loadLocalCapture,
  listLocalCaptures,
  saveLocalCapture,
  type LocalCaptureSummary,
} from "../pose/localCaptureStore";
import { PoseEngine, type PoseEstimate } from "../pose/PoseEngine";
import { buildRecordingFixture } from "../pose/recordingFixture";
import { selectTrainingWindow } from "../pose/trainingWindow";
import {
  analyzePoseSet,
  type PoseSetAnalysisResult,
} from "../pose/poseSetAnalysis";
import {
  representativeCycle,
  segmentRepsAuto,
  type AutoSegmentation,
  type RepSegment,
} from "../pose/repSegmenter";
import { computeTrajectoryFeatures, type TrajectoryFeatures } from "../pose/trajectory";
import { RtmposeEngine } from "../pose/RtmposeEngine";
import {
  CAPTURE_POSITIONS,
  recommendCapturePosition,
  torsoLeanDeg,
  type CapturePosition,
  type CameraView,
} from "../pose/viewGating";
import { CHAMFER, CHAMFER_SM, cornerBrackets, HUD, injectHudTheme } from "./hudTheme";
import { CaptureApprovalPanel } from "./CaptureApprovalPanel.web";
import {
  loadRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustCandidateDiagnostic,
  type RustReferenceComparison,
  type RustReferenceComparisonEvidence,
  type RustReferenceRuntimeContext,
  type RustRepState,
  type RustSealedRep,
  type RustSetLifecycle,
  type RustTargetSnapshot,
} from "../motion/rustCanonicalWasm";
import { buildLatPulldownQualityEvidence } from "../pose/trajectoryQualityEvidence";
import { buildSimulatedLatPulldownReference } from "../pose/simulatedLatPulldownReference";
import {
  buildVideoLibraryFromConfirmedCaptures,
  parseConfirmedCaptureManifest,
  type VideoLibraryEntry,
} from "../pose/videoLibrary";

injectHudTheme();

const NO_REVIEWED_REFERENCE: RustReferenceComparison = Object.freeze({
  status: "unavailable",
  reason: "no-installed-reviewed-profile",
  profileIdentity: null,
  qualityVerdict: null,
});

function referenceComparisonKey(comparison: RustReferenceComparison): string {
  return comparison.status === "unavailable"
    ? `${comparison.status}:${comparison.reason}:${comparison.profileIdentity ?? "none"}`
    : `${comparison.status}:${comparison.repId}:${comparison.canonicalSliceHash}:${comparison.profileHash}`;
}

function serializeReferenceComparison(comparison: RustReferenceComparison) {
  if (comparison.status === "unavailable") return { ...comparison };
  return {
    ...comparison,
    repId: comparison.repId.toString(),
    profileHash: comparison.profileHash.toString(),
    canonicalSliceHash: comparison.canonicalSliceHash.toString(),
    features: comparison.features.map((feature) => ({ ...feature })),
  };
}

function phaseTimingForReferenceRep(
  rep: RustSealedRep | undefined,
): { toExtremeMs: number; fromExtremeMs: number } | null {
  if (!rep) return null;
  return {
    toExtremeMs: Number(rep.peakTimestampMs - rep.startTimestampMs),
    fromExtremeMs: Number(rep.endTimestampMs - rep.peakTimestampMs),
  };
}

function qualityEvidenceForComparison(
  comparison: RustReferenceComparison,
  reps: readonly RustSealedRep[],
) {
  if (comparison.status === "unavailable") {
    return buildLatPulldownQualityEvidence(null, null);
  }
  const rep = reps.find((candidate) =>
    candidate.repId === comparison.repId && candidate.revision === comparison.repRevision,
  );
  return buildLatPulldownQualityEvidence(comparison, phaseTimingForReferenceRep(rep));
}

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
type WorkspacePage = "training" | "home-workout" | "console" | "review";
const HOME_WORKOUT_FLOW_ACTIONS = [
  {
    id: "march_in_place",
    step: "01",
    label: "原地踏步",
    labelEn: "MARCH",
    cue: "左右交替抬腿，单脚落地算一次完整周期。",
  },
  {
    id: "side_step_touch",
    step: "02",
    label: "侧步并步",
    labelEn: "SIDE STEP",
    cue: "向侧方迈开，再并步回到起始位置。",
  },
  {
    id: "alternating_knee_raise",
    step: "03",
    label: "交替提膝",
    labelEn: "KNEE RAISE",
    cue: "左右膝交替抬高，每次抬起并回落算一轮。",
  },
  {
    id: "step_jack",
    step: "04",
    label: "低冲击开合",
    labelEn: "STEP JACK",
    cue: "侧向迈步，同时完成双臂打开与回收。",
  },
] as const;
const HOME_WORKOUT_FLOW_IDS = new Set<string>(
  HOME_WORKOUT_FLOW_ACTIONS.map((action) => action.id),
);
const HOME_REP_PHASE_LABEL: Record<RustRepState["phase"], string> = {
  ready: "等待动作",
  effort: "动作进行中",
  peak: "到达动作顶点",
  return: "正在回到起点",
  frozen: "本轮已封装",
};
const ENGINE_KINDS: Array<{ id: EngineKind; label: string }> = [
  { id: "mediapipe", label: "MediaPipe" },
  { id: "rtmpose", label: "RTMPose-m" },
];
const RTMPOSE_MODEL_PATH = "/models/rtmpose-m-simcc-256x192.onnx";
const STAGE_ASPECT = 16 / 9;

function readWorkspacePage(): WorkspacePage {
  if (typeof window === "undefined") return "training";
  const view = new URLSearchParams(window.location.search).get("view");
  if (view === "review") return "review";
  if (view === "home-workout") return "home-workout";
  return "training";
}

function poseSchemaForEngine(kind: EngineKind): PoseSchema {
  return kind === "rtmpose" ? "coco17" : "blazepose33";
}

function rustProfileForContext(
  exerciseId: string,
  capturePosition: CapturePosition,
  trainingSide: TrainingSide,
  variation: string,
): ReturnType<typeof resolveRustExerciseProfile> {
  return resolveRustExerciseProfile({ exerciseId, capturePosition, trainingSide, variation });
}

function referenceRuntimeContextFor(
  exerciseId: string,
  capturePosition: CapturePosition,
  trainingSide: TrainingSide,
  variation: string,
  modelPath: string,
): RustReferenceRuntimeContext | null {
  const activeProfile = rustProfileForContext(
    exerciseId,
    capturePosition,
    trainingSide,
    variation,
  );
  const explicitStraightBar = ["cable straight bar", "绳索直杆", "直杆"]
    .includes(variation.trim().toLowerCase());
  if (
    !["lat_pulldown", "lat_pulldown_rear_left_45"].includes(activeProfile ?? "")
    || !explicitStraightBar
    || modelPath !== "/models/pose_landmarker_heavy.task"
  ) {
    return null;
  }
  return {
    exerciseId: "lat_pulldown",
    capturePosition: activeProfile === "lat_pulldown" ? "rear" : "rearLeft45",
    variation: "front_bar_pronated",
    trainingSide: "bilateral",
    equipment: "cable_lat_pulldown/straight_bar",
    coordinateSystem: "source-image/v1",
    featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2",
    poseModelVersion: "mediapipe-pose-heavy",
  };
}

function configureRustExerciseProfile(
  session: RustCanonicalWasmSession,
  exerciseId: string,
  capturePosition: CapturePosition,
  trainingSide: TrainingSide,
  variation: string,
  modelPath: string,
): void {
  const context = { exerciseId, capturePosition, trainingSide, variation } as const;
  const builtInProfile = resolveRustExerciseProfile(context);
  const observedProfile = resolveObservedRecognitionProfile(context);
  // The current high-pulldown normative trajectory binding is deliberately
  // sealed to its built-in profile. Do not make an observed counting profile
  // silently replace the reference-compatible profile until that binding is
  // upgraded as one atomic contract.
  const keepsBuiltInReferenceBinding = ["lat_pulldown", "lat_pulldown_rear_left_45"]
    .includes(builtInProfile ?? "");
  const simulatedProfile = !builtInProfile && !observedProfile
    ? resolveSimulatedRecognitionProfile(context)
    : null;
  const dataProfile = observedProfile && !keepsBuiltInReferenceBinding
    ? observedProfile
    : simulatedProfile;
  if (dataProfile) {
    session.installExerciseProfileData(dataProfile);
    // Recognition profiles, whether sourced from reviewed observations or a
    // simulated prior, may receive the same broad descriptive corridor. The
    // baseline never participates in cycle sealing; it only explains a
    // sealed motion's phase path to the user.
    const baseline = buildSimulatedTrajectoryBaseline(
      context,
      dataProfile,
      modelPath.includes("heavy") ? "mediapipe-pose-heavy" : "mediapipe-pose-provisional",
    );
    if (baseline) session.installSimulatedTrajectoryBaseline(baseline);
  } else {
    session.setExerciseProfile(builtInProfile);
  }
  const referenceContext = referenceRuntimeContextFor(
    exerciseId,
    capturePosition,
    trainingSide,
    variation,
    modelPath,
  );
  if (referenceContext) session.setReferenceRuntimeContext(referenceContext);
  if (
    referenceContext
    && (referenceContext.capturePosition === "rear" || referenceContext.capturePosition === "rearLeft45")
  ) {
    session.installReferenceProfile({
      profile: buildSimulatedLatPulldownReference(referenceContext),
    });
  }
}

const EXERCISE_MATURITY_LABEL: Record<ExerciseMaturity, string> = {
  catalog_only: "仅目录",
  experimental: "实验评分",
  validated: "已验证",
  suspended: "已暂停",
};

type AnyPoseEngine = PoseEngine | RtmposeEngine;

interface RecordingResult {
  videoUrl: string;
  videoName: string;
  keypointsUrl: string;
  keypointsName: string;
  annotationUrl: string | null;
  annotationName: string | null;
  metadataUrl: string;
  metadataName: string;
  poseCount: number;
  durationSec: number;
}

interface CaptureFrameDiagnostic {
  timestampMs: number;
  hasPose: boolean;
  canonicalFrameValid?: boolean;
  inferenceMs: number;
  rustCoreMs?: number;
  decodeMs?: number;
  routeMs?: number;
  repPhase?: string | null;
  sealedRepCount?: number;
  completedRepCount?: number;
  schedulerDecision?: "acquire-multi" | "track-target" | "refresh-candidates" | "skip-frame";
  dataGap?: boolean;
  canonicalContentHash?: string;
  processingError?: string;
  staleCompletionReason?: InferenceCompletionDropReason;
}

interface MotionFrameDiagnostic {
  frameId: number;
  timestampMs: number;
  algorithmVersion: CanonicalPoseFrame["algorithmVersion"];
  schedulerDecision: CaptureFrameDiagnostic["schedulerDecision"];
  target: RustTargetSnapshot | null;
  candidates: readonly RustCandidateDiagnostic[];
  activeProfile: string | null;
  landmarkIssues: readonly {
    index: number;
    source: CanonicalPoseFrame["landmarks"][number]["source"];
    uncertainty: number | null;
    reason: string | null;
  }[];
  measured: number;
  fused: number;
  predicted: number;
  unknown: number;
  inferenceMs: number;
  rustCoreMs: number;
  decodeMs: number;
  routeMs: number;
  renderMs: number;
  recordMs: number;
  analyzeMs: number;
  packetAgeMs: number;
  processingMultiplier: number;
  diagnosticMode: "normal" | "full";
  droppedFrames: number;
  usedJsHeapBytes: number | null;
  repPhase: string | null;
  sealedRepCount: number;
  completedRepCount: number;
  completedRepIds: readonly string[];
  tsRustFirstSourceDivergence: number | null;
  tsRustMaxCoordinateDelta: number | null;
  canonicalContentHash: string;
  degradationLevel: MotionDegradationLevel;
  degradationReason: string;
}

interface RustReferenceEvidenceRecord {
  readonly subjectEpoch: bigint;
  readonly comparison: RustReferenceComparisonEvidence;
}

interface MotionPerformanceModeSummary {
  frameCount: number;
  inferenceMsP50: number | null;
  inferenceMsP95: number | null;
  rustCoreMsP50: number | null;
  rustCoreMsP95: number | null;
  decodeMsP50: number | null;
  decodeMsP95: number | null;
  routeMsP50: number | null;
  routeMsP95: number | null;
  packetAgeMsP50: number | null;
  packetAgeMsP95: number | null;
  processingMultiplierP50: number | null;
  processingMultiplierP95: number | null;
  droppedFrames: number;
  maxUsedJsHeapBytes: number | null;
}

function readUsedJsHeapBytes(): number | null {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  }).memory;
  return Number.isFinite(memory?.usedJSHeapSize) ? memory!.usedJSHeapSize! : null;
}

function summarizeMotionPerformance(
  frames: readonly MotionFrameDiagnostic[],
): Record<"normal" | "full", MotionPerformanceModeSummary> {
  const summarize = (mode: "normal" | "full"): MotionPerformanceModeSummary => {
    const values = frames.filter((frame) => frame.diagnosticMode === mode);
    const percentile = (select: (frame: MotionFrameDiagnostic) => number, ratio: number) => {
      if (values.length === 0) return null;
      const sorted = values.map(select).sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
    };
    const heap = values
      .map((frame) => frame.usedJsHeapBytes)
      .filter((value): value is number => value !== null);
    return {
      frameCount: values.length,
      inferenceMsP50: percentile((frame) => frame.inferenceMs, 0.5),
      inferenceMsP95: percentile((frame) => frame.inferenceMs, 0.95),
      rustCoreMsP50: percentile((frame) => frame.rustCoreMs, 0.5),
      rustCoreMsP95: percentile((frame) => frame.rustCoreMs, 0.95),
      decodeMsP50: percentile((frame) => frame.decodeMs, 0.5),
      decodeMsP95: percentile((frame) => frame.decodeMs, 0.95),
      routeMsP50: percentile((frame) => frame.routeMs, 0.5),
      routeMsP95: percentile((frame) => frame.routeMs, 0.95),
      packetAgeMsP50: percentile((frame) => frame.packetAgeMs, 0.5),
      packetAgeMsP95: percentile((frame) => frame.packetAgeMs, 0.95),
      processingMultiplierP50: percentile((frame) => frame.processingMultiplier, 0.5),
      processingMultiplierP95: percentile((frame) => frame.processingMultiplier, 0.95),
      droppedFrames: values.at(-1)?.droppedFrames ?? 0,
      maxUsedJsHeapBytes: heap.length > 0 ? Math.max(...heap) : null,
    };
  };
  return { normal: summarize("normal"), full: summarize("full") };
}

function loadSettings(): AgentSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as AgentSettings;
      // 早前默认凭据是空字符串,当时保存过设置的浏览器会把这个空值存进 localStorage
      // 并从此沿用下去——即使后来在 defaultCredentials.ts 里补上了真实 key 也不会生效,
      // 因为这里只在"localStorage 里什么都没有"时才会去读默认值。只要保存的是空 key
      // 就当作没配置,回退到当前默认值,不让一次性的空值被永久记住。
      if (saved.apiKey) return saved;
      return { ...saved, apiKey: ZHIPU_DEFAULTS.apiKey };
    }
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
type TrainingSide = "bilateral" | "left" | "right";

interface SignalSample {
  t: number;
  v: number;
}

interface VideoFrameMetadata {
  mediaTime: number;
}

interface VideoFrameCallbackSupport {
  requestVideoFrameCallback?: (
    callback: (now: number, metadata: VideoFrameMetadata) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
}

type FrameCallbackVideo = Omit<
  HTMLVideoElement,
  "requestVideoFrameCallback" | "cancelVideoFrameCallback"
> & VideoFrameCallbackSupport;

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

/** Browser downloads stay as a fallback link in the UI if multi-download permission is denied. */
function requestCaptureDownloads(files: ReadonlyArray<{ url: string; name: string }>): void {
  for (const [index, file] of files.entries()) {
    window.setTimeout(() => {
      const download = document.createElement("a");
      download.href = file.url;
      download.download = file.name;
      download.style.display = "none";
      document.body.appendChild(download);
      download.click();
      download.remove();
    }, index * 150);
  }
}

function recordingResultFiles(result: RecordingResult): Array<{ url: string; name: string }> {
  return [
    { url: result.videoUrl, name: result.videoName },
    { url: result.keypointsUrl, name: result.keypointsName },
    ...(result.annotationUrl && result.annotationName
      ? [{ url: result.annotationUrl, name: result.annotationName }]
      : []),
    { url: result.metadataUrl, name: result.metadataName },
  ];
}

function revokeRecordingResultUrls(result: RecordingResult): void {
  URL.revokeObjectURL(result.videoUrl);
  URL.revokeObjectURL(result.keypointsUrl);
  if (result.annotationUrl) URL.revokeObjectURL(result.annotationUrl);
  URL.revokeObjectURL(result.metadataUrl);
}

function candidateEvidenceLabel(reason: RustSealedRep["evidenceReason"]): string {
  if (!reason) return "未说明原因";
  const labels: Record<NonNullable<RustSealedRep["evidenceReason"]>, string> = {
    short_continuity_recovery: "短暂丢点后恢复",
    long_continuity_loss: "长时间丢点",
    subject_changed: "追踪主体切换",
    incomplete_cycle: "未完成完整动作周期",
    anti_interference_filter: "整体移动干扰",
    duration_exceeded: "动作时长超出上限",
    required_joint_loss: "关键关节不可用",
  };
  return labels[reason] ?? "未说明原因";
}

function observationFindingLabel(finding: RustSealedRep["observationFindings"][number]): string {
  return {
    primary_range_below_expectation: "主要动作行程偏小",
    secondary_range_below_expectation: "辅助关节参与幅度偏小",
    cycle_faster_than_expected: "动作节奏偏快，控制信息不足",
  }[finding];
}

export function CameraPoseView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<AnyPoseEngine | null>(null);
  const engineKindRef = useRef<EngineKind>("mediapipe");
  const rafRef = useRef(0);
  const videoFrameCallbackRef = useRef<number | null>(null);
  const loopGenerationRef = useRef(0);
  const fpsWindowRef = useRef<number[]>([]);
  const modeRef = useRef<SourceMode>("camera");
  const lastTimestampRef = useRef(-1);
  const lastProcessedMediaTimeRef = useRef(-1);
  const modelPathRef = useRef(POSE_MODELS[2].path);
  const cameraViewRef = useRef<CameraView>("oblique45");
  const exerciseChoiceRef = useRef("");
  const capturePositionRef = useRef<CapturePosition>("frontLeft45");
  const variationRef = useRef("");
  const trainingSideRef = useRef<TrainingSide>("bilateral");
  // The evidence-based continuity fusion is the Web default. Keep the legacy
  // tracker behind an explicit toggle while its product path is contracted.
  const filterEnabledRef = useRef(false);
  const poseBufferRef = useRef<CanonicalPoseFrame[]>([]);
  const frameCountRef = useRef(0);
  const keyframesRef = useRef<Array<{ t: number; jpeg: string }>>([]);
  const lastCaptureRef = useRef(0);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canonicalSessionRef = useRef<PoseContinuitySession | null>(null);
  const canonicalShadowRef = useRef<PoseContinuitySession | null>(null);
  const rustWasmRef = useRef<MotionWasmExports | null>(null);
  const rustTargetRef = useRef<RustTargetSnapshot | null>(null);
  const trackerReadinessRef = useRef(INITIAL_TRACKER_READINESS);
  const rustSetLifecycleRef = useRef<RustSetLifecycle>("idle");
  const activeDurationRef = useRef(new CanonicalActiveDurationAccumulator());
  const referenceComparisonKeyRef = useRef(referenceComparisonKey(NO_REVIEWED_REFERENCE));
  const sequenceCounterRef = useRef(0);
  // 实时信号曲线(肘角),驱动左下角曲线图
  const signalRef = useRef<SignalSample[]>([]);

  // 现场采集留存:与 poseBufferRef(实时分析用的滚动环形缓冲,有上限)不同,
  // 这里是录制期间不设上限的 canonical 会话缓冲,只在 recordingActiveRef 为 true 时累积。
  const recordingActiveRef = useRef(false);
  const finalizingRecordingRef = useRef(false);
  const isUnmountedRef = useRef(false);
  const recordedPosesRef = useRef<CanonicalPoseFrame[]>([]);
  const captureDiagnosticsRef = useRef<CaptureFrameDiagnostic[]>([]);
  const motionDiagnosticsRef = useRef<MotionFrameDiagnostic[]>([]);
  const rustSealedRepsRef = useRef<RustSealedRep[]>([]);
  const rustNeedsReviewRepsRef = useRef<RustSealedRep[]>([]);
  const rustRejectedRepsRef = useRef<RustSealedRep[]>([]);
  const rustReferenceEvidenceRef = useRef<RustReferenceEvidenceRecord[]>([]);
  const droppedFramesRef = useRef(0);
  const captureDroppedFramesRef = useRef(0);
  const inferenceCompletionGateRef = useRef(new InferenceCompletionGate());
  const staleCompletionDiagnosticsRef = useRef<Array<{
    timestampMs: number;
    reason: InferenceCompletionDropReason;
  }>>([]);
  const degradationControllerRef = useRef(new MotionPerformanceDegradationController());
  const droppedFramesByModeRef = useRef<Record<"normal" | "full", number>>({
    normal: 0,
    full: 0,
  });
  const engineLoadEpochRef = useRef(0);
  const engineLoadPromiseRef = useRef<Promise<AnyPoseEngine> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordingStartMsRef = useRef(0);
  const recordingStopMsRef = useRef(0);
  const recordingMetadataRef = useRef<{
    exerciseChoice: string;
    cameraView: CameraView;
    capturePosition: CapturePosition;
    variation: string;
    trainingSide: TrainingSide;
  } | null>(null);
  const recordingResultRef = useRef<RecordingResult | null>(null);

  const [status, setStatus] = useState<EngineStatus>("idle");
  const [workspacePage, setWorkspacePage] = useState<WorkspacePage>(readWorkspacePage);
  const workspacePageRef = useRef<WorkspacePage>(workspacePage);
  const [hasVisitedReview, setHasVisitedReview] = useState(() => readWorkspacePage() === "review");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SourceMode>("camera");
  const [videoName, setVideoName] = useState<string | null>(null);
  const [videoLibrary, setVideoLibrary] = useState<readonly VideoLibraryEntry[]>([]);
  const [selectedLibraryVideoId, setSelectedLibraryVideoId] = useState("");
  const [selectedLibraryVideoNeedsPosition, setSelectedLibraryVideoNeedsPosition] = useState(false);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [modelId, setModelId] = useState(POSE_MODELS[2].id);
  const [engineKind, setEngineKind] = useState<EngineKind>("mediapipe");
  const [modelLoading, setModelLoading] = useState(false);
  const [cameraView, setCameraView] = useState<CameraView>("oblique45");
  const [capturePosition, setCapturePosition] = useState<CapturePosition>("frontLeft45");
  const [exerciseChoice, setExerciseChoice] = useState<string>("");
  const [variation, setVariation] = useState("");
  const [trainingSide, setTrainingSide] = useState<TrainingSide>("bilateral");
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
  const [isFinalizingRecording, setIsFinalizingRecording] = useState(false);
  const [recordingResult, setRecordingResult] = useState<RecordingResult | null>(null);
  const [localCaptures, setLocalCaptures] = useState<LocalCaptureSummary[]>([]);
  const [localCaptureError, setLocalCaptureError] = useState<string | null>(null);
  const [rustSdkStatus, setRustSdkStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [rustTarget, setRustTarget] = useState<RustTargetSnapshot | null>(null);
  const [trackerReadiness, setTrackerReadiness] = useState(INITIAL_TRACKER_READINESS);
  const [diagnosticsVersion, setDiagnosticsVersion] = useState(0);
  const [referenceComparison, setReferenceComparison] = useState<RustReferenceComparison>(
    NO_REVIEWED_REFERENCE,
  );
  const [simulatedBaselineComparison, setSimulatedBaselineComparison] = useState<RustReferenceComparison>(
    NO_REVIEWED_REFERENCE,
  );
  const [referenceEvidenceVersion, setReferenceEvidenceVersion] = useState(0);
  const [rustSealedRepCount, setRustSealedRepCount] = useState(0);
  const [rustNeedsReviewRepCount, setRustNeedsReviewRepCount] = useState(0);
  const [rustRejectedRepCount, setRustRejectedRepCount] = useState(0);
  const [rustSetLifecycle, setRustSetLifecycle] = useState<RustSetLifecycle>("idle");
  const [rustActiveDurationMs, setRustActiveDurationMs] = useState(0);
  const [observedProfilesReady, setObservedProfilesReady] = useState(false);
  const stopRef = useRef<() => void>(() => undefined);

  const syncRustSetCommandPacket = (session: RustCanonicalWasmSession) => {
    // Recording commands produce immutable Rust snapshots too; never mirror a
    // lifecycle or terminal rejection in TypeScript state by hand.
    const packet = session.lastDecodedPacket;
    if (!packet) return;
    rustSetLifecycleRef.current = session.lastSetLifecycle;
    setRustSetLifecycle(session.lastSetLifecycle);
    const confirmed = packet.completedReps.filter((rep) => rep.disposition === "confirmed");
    const needsReview = packet.completedReps.filter((rep) => rep.disposition === "needs_review");
    const rejected = packet.completedReps.filter((rep) => rep.disposition === "rejected");
    rustSealedRepsRef.current.push(...confirmed);
    rustNeedsReviewRepsRef.current.push(...needsReview);
    rustRejectedRepsRef.current.push(...rejected);
    setRustSealedRepCount(rustSealedRepsRef.current.length);
    setRustNeedsReviewRepCount(rustNeedsReviewRepsRef.current.length);
    setRustRejectedRepCount(rustRejectedRepsRef.current.length);
  };

  const currentReferenceQualityEvidence = qualityEvidenceForComparison(
    referenceComparison,
    rustSealedRepsRef.current,
  );
  const simulatedNominalReferenceConfigured = referenceRuntimeContextFor(
    exerciseChoice,
    capturePosition,
    trainingSide,
    variation,
    POSE_MODELS.find((model) => model.id === modelId)?.path ?? POSE_MODELS[2]!.path,
  ) !== null;
  const simulatedRecognitionBaseline = resolveSimulatedRecognitionProfile({
    exerciseId: exerciseChoice,
    capturePosition,
    trainingSide,
    variation,
  } as const);

  useEffect(() => {
    const syncWorkspacePage = () => {
      const nextPage = readWorkspacePage();
      if (nextPage !== workspacePageRef.current) stopRef.current();
      workspacePageRef.current = nextPage;
      setWorkspacePage(nextPage);
    };
    window.addEventListener("popstate", syncWorkspacePage);
    return () => window.removeEventListener("popstate", syncWorkspacePage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadObservedRecognitionProfiles()
      .then(() => {
        if (!cancelled) setObservedProfilesReady(true);
      })
      .catch((loadError) => {
        // The field artifact is local-only in the current prototype. Its absence
        // must leave the reviewed/built-in profile path usable.
        console.warn("Observed recognition profiles unavailable", loadError);
      });
    return () => { cancelled = true; };
  }, []);

  // A session can be created while the local observed-profile artifact is
  // still loading. Reinstall the exact context once it is ready so a video
  // never keeps an accidental simulated fallback for its whole replay.
  useEffect(() => {
    if (!observedProfilesReady) return;
    const session = canonicalSessionRef.current;
    if (!(session instanceof RustCanonicalWasmSession)) return;
    configureRustExerciseProfile(
      session,
      exerciseChoiceRef.current,
      capturePositionRef.current,
      trainingSideRef.current,
      variationRef.current,
      modelPathRef.current,
    );
  }, [observedProfilesReady]);

  useEffect(() => {
    if (workspacePage === "review") setHasVisitedReview(true);
  }, [workspacePage]);

  useEffect(() => {
    if (workspacePage !== "home-workout") return;
    trainingSideRef.current = "bilateral";
    setTrainingSide("bilateral");
    variationRef.current = "";
    setVariation("");
    capturePositionRef.current = "front";
    setCapturePosition("front");
    cameraViewRef.current = "front";
    setCameraView("front");
    if (!HOME_WORKOUT_FLOW_IDS.has(exerciseChoiceRef.current)) {
      exerciseChoiceRef.current = "";
      setExerciseChoice("");
    }
  }, [workspacePage]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/archives/confirmed-captures/manifest.json", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("已确认档案清单不可用");
        const archive = parseConfirmedCaptureManifest(await response.json());
        const loadedLabels = await Promise.all(archive.captures.map(async (capture) => {
          if (!capture.labels) return [capture.id, null] as const;
          const labelResponse = await fetch(`/archives/confirmed-captures/${capture.labels}`, { cache: "no-store" });
          if (!labelResponse.ok) throw new Error(`无法读取已标注视频：${capture.id}`);
          return [capture.id, await labelResponse.json()] as const;
        }));
        return buildVideoLibraryFromConfirmedCaptures(archive, Object.fromEntries(loadedLabels));
      })
      .then((manifest) => {
        if (!cancelled) setVideoLibrary(manifest.videos);
      })
      .catch((libraryError) => {
        if (!cancelled) setError(libraryError instanceof Error ? libraryError.message : String(libraryError));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRustMotionWasm()
      .then((wasm) => {
        if (cancelled) return;
        rustWasmRef.current = wasm;
        setRustSdkStatus("ready");
      })
      .catch((loadError) => {
        if (cancelled) return;
        console.warn("Rust motion SDK unavailable; using diagnostic TS fallback", loadError);
        setRustSdkStatus("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyCapturePosition = (positionId: CapturePosition) => {
    const physicalPosition = CAPTURE_POSITIONS.find((position) => position.id === positionId);
    if (!physicalPosition) return;
    setCapturePosition(physicalPosition.id);
    capturePositionRef.current = physicalPosition.id;
    setSelectedLibraryVideoNeedsPosition(false);
    setCameraView(physicalPosition.analysisView);
    cameraViewRef.current = physicalPosition.analysisView;
    if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
      configureRustExerciseProfile(
        canonicalSessionRef.current,
        exerciseChoiceRef.current,
        capturePositionRef.current,
        trainingSideRef.current,
        variationRef.current,
        modelPathRef.current,
      );
      rustSealedRepsRef.current = [];
      rustNeedsReviewRepsRef.current = [];
      rustRejectedRepsRef.current = [];
      setRustSealedRepCount(0);
      setRustNeedsReviewRepCount(0);
      setRustRejectedRepCount(0);
    }
  };

  const selectExercise = (nextExerciseId: string) => {
    exerciseChoiceRef.current = nextExerciseId;
    setExerciseChoice(nextExerciseId);
    // Variation/equipment is action-specific. Carrying the previous action's
    // free text into a new action can select the wrong profile even when every
    // other field matches.
    variationRef.current = "";
    setVariation("");
    const recommendation = recommendCapturePosition(nextExerciseId);
    if (recommendation) {
      applyCapturePosition(recommendation.position);
    } else if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
      configureRustExerciseProfile(
        canonicalSessionRef.current,
        nextExerciseId,
        capturePositionRef.current,
        trainingSideRef.current,
        variationRef.current,
        modelPathRef.current,
      );
      rustSealedRepsRef.current = [];
      rustNeedsReviewRepsRef.current = [];
      rustRejectedRepsRef.current = [];
      setRustSealedRepCount(0);
      setRustNeedsReviewRepCount(0);
      setRustRejectedRepCount(0);
    }
  };

  const selectWorkspacePage = (nextPage: WorkspacePage) => {
    if (nextPage !== workspacePageRef.current) stopRef.current();
    if (nextPage === "home-workout") {
      trainingSideRef.current = "bilateral";
      setTrainingSide("bilateral");
      variationRef.current = "";
      setVariation("");
      applyCapturePosition("front");
      if (!HOME_WORKOUT_FLOW_IDS.has(exerciseChoiceRef.current)) selectExercise("");
    }
    workspacePageRef.current = nextPage;
    setWorkspacePage(nextPage);
    const url = new URL(window.location.href);
    url.searchParams.set("view", nextPage);
    window.history.replaceState(null, "", url);
  };

  const applyVideoLibraryContext = (entry: VideoLibraryEntry) => {
    const nextExerciseId = entry.exerciseId ?? "";
    if (nextExerciseId) {
      if (!EXERCISE_REGISTRY.get(nextExerciseId)) {
        setError(`视频库动作未在目录中注册：${entry.exerciseId}`);
        return false;
      }
    }
    // Every library switch replaces, rather than inherits, its analysis
    // context. An unclassified clip must never quietly reuse the previous
    // clip's action or reference profile.
    exerciseChoiceRef.current = nextExerciseId;
    setExerciseChoice(nextExerciseId);
    variationRef.current = entry.variation ?? "";
    setVariation(entry.variation ?? "");
    trainingSideRef.current = entry.trainingSide ?? "bilateral";
    setTrainingSide(entry.trainingSide ?? "bilateral");
    setSelectedLibraryVideoNeedsPosition(!entry.capturePosition);
    if (entry.capturePosition) {
      applyCapturePosition(entry.capturePosition);
    } else if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
      configureRustExerciseProfile(
        canonicalSessionRef.current,
        exerciseChoiceRef.current,
        capturePositionRef.current,
        trainingSideRef.current,
        variationRef.current,
        modelPathRef.current,
      );
      rustSealedRepsRef.current = [];
      rustNeedsReviewRepsRef.current = [];
      rustRejectedRepsRef.current = [];
      setRustSealedRepCount(0);
      setRustNeedsReviewRepCount(0);
      setRustRejectedRepCount(0);
    }
    return true;
  };

  const ensureEngine = useCallback(async () => {
    if (engineRef.current) return engineRef.current;
    if (engineLoadPromiseRef.current) return engineLoadPromiseRef.current;
    const epoch = engineLoadEpochRef.current;
    const engineKindAtDispatch = engineKindRef.current;
    const modelPathAtDispatch = modelPathRef.current;
    setModelLoading(true);
    const pending = engineKindAtDispatch === "rtmpose"
      ? RtmposeEngine.create(RTMPOSE_MODEL_PATH)
      : PoseEngine.create(modelPathAtDispatch);
    engineLoadPromiseRef.current = pending;
    try {
      const created = await pending;
      if (
        epoch !== engineLoadEpochRef.current
        || engineKindAtDispatch !== engineKindRef.current
        || modelPathAtDispatch !== modelPathRef.current
      ) {
        created.close();
        throw new Error("stale model completion dropped");
      }
      engineRef.current = created;
      return created;
    } finally {
      if (engineLoadPromiseRef.current === pending) {
        engineLoadPromiseRef.current = null;
      }
      if (epoch === engineLoadEpochRef.current) setModelLoading(false);
    }
  }, []);

  const publishTrackerReadiness = useCallback((input: TrackerReadinessInput) => {
    const previous = trackerReadinessRef.current;
    const next = updateTrackerReadiness(previous, input);
    if (
      next.phase !== previous.phase
      || next.stableFrameCount !== previous.stableFrameCount
    ) {
      trackerReadinessRef.current = next;
      setTrackerReadiness(next);
    }
    return next;
  }, []);

  const trackerAssetsReady =
    rustSdkStatus === "ready" && !modelLoading && engineRef.current !== null;

  // Load both tracking runtimes before asking for camera permission. Opening
  // the camera is then only a source transition, rather than an opaque model
  // download followed by a delayed first result.
  useEffect(() => {
    if (workspacePage === "review") return;
    let cancelled = false;
    void ensureEngine().catch((loadError) => {
      if (cancelled || loadError instanceof Error && loadError.message === "stale model completion dropped") {
        return;
      }
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    });
    return () => {
      cancelled = true;
    };
  }, [engineKind, ensureEngine, modelId, workspacePage]);

  useEffect(() => {
    if (!trackerAssetsReady) {
      publishTrackerReadiness({
        assetsReady: false,
        sourceOpen: status === "running",
        targetLocked: false,
        usableLandmarkRatio: 0,
      });
      setPose(null);
      return;
    }
    publishTrackerReadiness({
      assetsReady: true,
      sourceOpen: status === "running",
      targetLocked: false,
      usableLandmarkRatio: 0,
    });
  }, [publishTrackerReadiness, status, trackerAssetsReady]);

  const startCanonicalSequence = useCallback(() => {
    inferenceCompletionGateRef.current.resetSequence();
    referenceComparisonKeyRef.current = referenceComparisonKey(NO_REVIEWED_REFERENCE);
    setReferenceComparison(NO_REVIEWED_REFERENCE);
    setSimulatedBaselineComparison(NO_REVIEWED_REFERENCE);
    if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
      canonicalSessionRef.current.close();
    }
    const video = videoRef.current;
    const sequenceNumber = sequenceCounterRef.current++;
    const config = {
      sequenceId: `web:${engineKindRef.current}:${sequenceNumber}`,
      schema: poseSchemaForEngine(engineKindRef.current),
      image: {
        widthPx: Math.max(1, video?.videoWidth ?? 0),
        heightPx: Math.max(1, video?.videoHeight ?? 0),
        rotationDegrees: 0,
        mirrored: modeRef.current === "camera",
      },
      stabilization: filterEnabledRef.current ? "legacy" : "fusion",
    } as const;
    if (rustWasmRef.current) {
      const session = new RustCanonicalWasmSession(
        {
          ...config,
          setLifecycleMode: modeRef.current === "camera" ? "preview" : "replay",
        },
        rustWasmRef.current,
      );
      session.setDegradationLevel(degradationControllerRef.current.currentLevel());
      configureRustExerciseProfile(
        session,
        exerciseChoiceRef.current,
        capturePositionRef.current,
        trainingSideRef.current,
        variationRef.current,
        modelPathRef.current,
      );
      canonicalSessionRef.current = session;
      canonicalShadowRef.current = createPoseContinuitySession({ ...config, stabilization: "fusion" });
    } else {
      // Rust is the only product canonical source. The TypeScript
      // implementation is retained exclusively as a shadow comparator while
      // Rust is active; it must never silently become renderer/recorder input.
      canonicalSessionRef.current = null;
      canonicalShadowRef.current = null;
    }
  }, []);

  const resetCanonicalConsumers = useCallback(() => {
    poseBufferRef.current = [];
    frameCountRef.current = 0;
    signalRef.current = [];
    setPose(null);
    setSignalCurve([]);
    rustSealedRepsRef.current = [];
    rustNeedsReviewRepsRef.current = [];
    rustRejectedRepsRef.current = [];
    rustReferenceEvidenceRef.current = [];
    setRustSealedRepCount(0);
    setRustNeedsReviewRepCount(0);
    setRustRejectedRepCount(0);
    setReferenceEvidenceVersion((version) => version + 1);
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
      if (kind !== "mediapipe") {
        setError("Rust 正式识别链当前只接受 MediaPipe BlazePose33；RTMPose/COCO17 尚未完成索引映射，已拒绝切换。");
        return;
      }
      engineKindRef.current = kind;
      engineLoadEpochRef.current += 1;
      engineLoadPromiseRef.current = null;
      inferenceCompletionGateRef.current.replaceModel();
      setEngineKind(kind);
      engineRef.current?.close();
      engineRef.current = null;
      if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
        canonicalSessionRef.current.close();
      }
      canonicalSessionRef.current = null;
      canonicalShadowRef.current = null;
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
      engineLoadEpochRef.current += 1;
      engineLoadPromiseRef.current = null;
      inferenceCompletionGateRef.current.replaceModel();
      setModelId(id);
      modelPathRef.current = next.path;
      engineRef.current?.close();
      engineRef.current = null;
      if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
        canonicalSessionRef.current.close();
      }
      canonicalSessionRef.current = null;
      canonicalShadowRef.current = null;
      if (status === "running") {
        await ensureEngine();
        rotateCanonicalSequence();
      }
    },
    [ensureEngine, rotateCanonicalSequence, status],
  );

  const startLoop = useCallback(() => {
    const generation = ++loopGenerationRef.current;
    cancelAnimationFrame(rafRef.current);
    const previousVideo = videoRef.current as FrameCallbackVideo | null;
    if (videoFrameCallbackRef.current !== null) {
      previousVideo?.cancelVideoFrameCallback?.(videoFrameCallbackRef.current);
      videoFrameCallbackRef.current = null;
    }
    // Keep MediaPipe's inference clock monotonic for the lifetime of the
    // engine. Source media time may restart after a seek, loop, or new file;
    // canonical sequence rotation handles that discontinuity separately.
    lastProcessedMediaTimeRef.current = -1;
    rotateCanonicalSequence();
    let lastCurveUpdate = 0;
    let lastDiagnosticUpdate = 0;
    const processDecodedFrame = (sourceTimestampMs: number, now: number) => {
      const frameProcessingStartedAt = performance.now();
      const diagnosticMode = recordingActiveRef.current || workspacePageRef.current === "console"
        ? "full" as const
        : "normal" as const;
      const recordDroppedFrame = () => {
        droppedFramesRef.current += 1;
        if (recordingActiveRef.current) captureDroppedFramesRef.current += 1;
        droppedFramesByModeRef.current[diagnosticMode] += 1;
      };
      const engine = engineRef.current;
      const currentVideo = videoRef.current;
      if (engine && currentVideo) {
        // MediaPipe receives a strictly increasing packet timestamp, while
        // canonical/render/export data keeps the source media time. This
        // callback is reached once per decoded frame, not per display refresh.
        const mediaTimestampMs = Math.max(0, Math.round(sourceTimestampMs));
        const inferenceTimestampMs = Math.max(Math.round(now), lastTimestampRef.current + 1);
        lastTimestampRef.current = inferenceTimestampMs;
        let processingStage: "inference" | "rust-core" | "packet-routing" = "inference";
        try {
          if (!canonicalSessionRef.current) startCanonicalSequence();
          if (!canonicalSessionRef.current) {
            if (recordingActiveRef.current) {
              captureDiagnosticsRef.current.push({
                timestampMs: mediaTimestampMs,
                hasPose: false,
                inferenceMs: 0,
                dataGap: true,
                processingError: "rust-core: authoritative Rust SDK unavailable",
              });
            }
            return;
          }
          const schedulerDecision = canonicalSessionRef.current instanceof RustCanonicalWasmSession
            ? canonicalSessionRef.current.schedule(mediaTimestampMs)
            : "track-target";
          if (schedulerDecision === "skip-frame") {
            recordDroppedFrame();
            if (recordingActiveRef.current) {
              captureDiagnosticsRef.current.push({
                timestampMs: mediaTimestampMs,
                hasPose: false,
                inferenceMs: 0,
                schedulerDecision,
                dataGap: true,
              });
            }
            return;
          }
          const inferenceStartedAt = performance.now();
          const inferenceToken = inferenceCompletionGateRef.current.begin();
          const candidates = engine instanceof PoseEngine
            ? engine.estimateCandidates(currentVideo, inferenceTimestampMs)
            : null;
          const estimate = candidates
            ? candidates[0] ?? {
                timestampMs: inferenceTimestampMs,
                landmarks: [],
                worldLandmarks: [],
              }
            : engine.estimate(currentVideo, inferenceTimestampMs);
          const inferenceMs = performance.now() - inferenceStartedAt;
          const completion = inferenceCompletionGateRef.current.accept(inferenceToken);
          if (!completion.accepted) {
            recordDroppedFrame();
            staleCompletionDiagnosticsRef.current.push({
              timestampMs: mediaTimestampMs,
              reason: completion.reason!,
            });
            if (staleCompletionDiagnosticsRef.current.length > 100) {
              staleCompletionDiagnosticsRef.current.shift();
            }
            if (recordingActiveRef.current) {
              captureDiagnosticsRef.current.push({
                timestampMs: mediaTimestampMs,
                hasPose: false,
                inferenceMs: Number(inferenceMs.toFixed(2)),
                dataGap: true,
                staleCompletionReason: completion.reason!,
              });
            }
            return;
          }
          if (estimate) {
            estimate.timestampMs = mediaTimestampMs;
            processingStage = "rust-core";
            const rustStartedAt = performance.now();
            const canonicalFrame =
              canonicalSessionRef.current instanceof RustCanonicalWasmSession && candidates
                ? canonicalSessionRef.current.processCandidates(candidates, mediaTimestampMs)
                : canonicalSessionRef.current!.process(estimate);
            const rustTotalMs = performance.now() - rustStartedAt;
            const rustTiming = canonicalSessionRef.current instanceof RustCanonicalWasmSession
              ? canonicalSessionRef.current.lastTiming
              : { coreMs: rustTotalMs, decodeMs: 0 };
            const rustCoreMs = rustTiming.coreMs;
            const decodeMs = rustTiming.decodeMs;
            if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
              const nextTarget = canonicalSessionRef.current.lastTarget;
              const previousTarget = rustTargetRef.current;
              rustTargetRef.current = nextTarget;
              if (
                previousTarget?.state !== nextTarget.state
                || previousTarget?.candidateCount !== nextTarget.candidateCount
                || previousTarget?.selectedCandidateId !== nextTarget.selectedCandidateId
                || previousTarget?.subjectEpoch !== nextTarget.subjectEpoch
              ) {
                setRustTarget(nextTarget);
              }
            }
            let tsRustFirstSourceDivergence: number | null = null;
            let tsRustMaxCoordinateDelta: number | null = null;
            if (
              canonicalShadowRef.current
              && canonicalSessionRef.current instanceof RustCanonicalWasmSession
              && canonicalSessionRef.current.lastTarget.state === "locked"
            ) {
              const selectedId = canonicalSessionRef.current.lastTarget.selectedCandidateId;
              const selected = candidates?.find((candidate) =>
                selectedId !== null && BigInt(candidate.candidateId) === selectedId,
              ) ?? estimate;
              const shadow = canonicalShadowRef.current.process({
                ...selected,
                timestampMs: mediaTimestampMs,
              });
              for (let index = 0; index < canonicalFrame.landmarks.length; index += 1) {
                const rustLandmark = canonicalFrame.landmarks[index];
                const tsLandmark = shadow.landmarks[index];
                if (!rustLandmark || !tsLandmark) continue;
                if (
                  tsRustFirstSourceDivergence === null
                  && rustLandmark.source !== tsLandmark.source
                ) {
                  tsRustFirstSourceDivergence = index;
                }
                if (
                  Number.isFinite(rustLandmark.x)
                  && Number.isFinite(rustLandmark.y)
                  && Number.isFinite(tsLandmark.x)
                  && Number.isFinite(tsLandmark.y)
                ) {
                  const delta = Math.hypot(
                    rustLandmark.x - tsLandmark.x,
                    rustLandmark.y - tsLandmark.y,
                  );
                  tsRustMaxCoordinateDelta = Math.max(tsRustMaxCoordinateDelta ?? 0, delta);
                }
              }
            }
            const diagnostic: MotionFrameDiagnostic = {
              frameId: canonicalFrame.frameId,
              timestampMs: canonicalFrame.sourceTimestampMs,
              algorithmVersion: canonicalFrame.algorithmVersion,
              schedulerDecision,
              target: rustTargetRef.current,
              candidates: canonicalSessionRef.current instanceof RustCanonicalWasmSession
                ? canonicalSessionRef.current.lastCandidateDiagnostics
                : [],
              activeProfile: canonicalSessionRef.current instanceof RustCanonicalWasmSession
                ? canonicalSessionRef.current.lastDecodedPacket?.lineage.activeProfileIdentity ?? null
                : null,
              landmarkIssues: canonicalFrame.landmarks
                .map((landmark, index) => ({
                  index,
                  source: landmark.source,
                  uncertainty: landmark.uncertainty,
                  reason: landmark.continuityReason,
                }))
                .filter((landmark) => landmark.source !== "measured"),
              measured: canonicalFrame.landmarks.filter((landmark) => landmark.source === "measured").length,
              fused: canonicalFrame.landmarks.filter((landmark) => landmark.source === "fused").length,
              predicted: canonicalFrame.landmarks.filter((landmark) => landmark.source === "predicted").length,
              unknown: canonicalFrame.landmarks.filter((landmark) => landmark.source === "unknown").length,
              inferenceMs: Number(inferenceMs.toFixed(2)),
              rustCoreMs: Number(rustCoreMs.toFixed(3)),
              decodeMs: Number(decodeMs.toFixed(3)),
              routeMs: 0,
              renderMs: 0,
              recordMs: 0,
              analyzeMs: 0,
              packetAgeMs: performance.now() - frameProcessingStartedAt,
              processingMultiplier: 0,
              diagnosticMode,
              droppedFrames: droppedFramesByModeRef.current[diagnosticMode],
              usedJsHeapBytes: readUsedJsHeapBytes(),
              repPhase: canonicalSessionRef.current instanceof RustCanonicalWasmSession
                ? canonicalSessionRef.current.lastRepState.phase
                : null,
              sealedRepCount: rustSealedRepsRef.current.length + (
                canonicalSessionRef.current instanceof RustCanonicalWasmSession
                  ? canonicalSessionRef.current.lastCompletedReps.length
                  : 0
              ),
              completedRepCount: canonicalSessionRef.current instanceof RustCanonicalWasmSession
                ? canonicalSessionRef.current.lastCompletedReps.length
                : 0,
              completedRepIds: canonicalSessionRef.current instanceof RustCanonicalWasmSession
                ? canonicalSessionRef.current.lastCompletedReps.map((rep) => rep.repId.toString())
                : [],
              tsRustFirstSourceDivergence,
              tsRustMaxCoordinateDelta,
              canonicalContentHash: canonicalSessionRef.current instanceof RustCanonicalWasmSession
                ? canonicalSessionRef.current.lastCanonicalHash.toString()
                : "0",
              degradationLevel: degradationControllerRef.current.currentLevel(),
              degradationReason: "within-budget",
            };
            motionDiagnosticsRef.current.push(diagnostic);
            if (!recordingActiveRef.current && motionDiagnosticsRef.current.length > 500) {
              motionDiagnosticsRef.current.shift();
            }
            if (now - lastDiagnosticUpdate >= 500) {
              lastDiagnosticUpdate = now;
              setDiagnosticsVersion((version) => version + 1);
            }
            const rustSession = canonicalSessionRef.current instanceof RustCanonicalWasmSession
              ? canonicalSessionRef.current
              : null;
            if (rustSession?.lastDecodedPacket) {
              setRustActiveDurationMs(activeDurationRef.current.update(
                rustSession.lastDecodedPacket.sourceTimestampMs,
                rustSession.lastDecodedPacket.setState.lifecycle,
              ));
            }
            if (rustSession && rustSession.lastSetLifecycle !== rustSetLifecycleRef.current) {
              rustSetLifecycleRef.current = rustSession.lastSetLifecycle;
              setRustSetLifecycle(rustSession.lastSetLifecycle);
            }
            const usableLandmarkCount = canonicalFrame.landmarks.filter((landmark) =>
              landmark.source !== "unknown"
              && Number.isFinite(landmark.x)
              && Number.isFinite(landmark.y)
            ).length;
            const nextTrackerReadiness = publishTrackerReadiness({
              assetsReady: Boolean(engineRef.current && rustWasmRef.current),
              sourceOpen: true,
              targetLocked: rustSession?.lastTarget.state === "locked",
              usableLandmarkRatio: canonicalFrame.landmarks.length > 0
                ? usableLandmarkCount / canonicalFrame.landmarks.length
                : 0,
            });
            const motionPacket = createWebMotionPacket({
              canonical: canonicalFrame,
              canonicalContentHash: rustSession?.lastCanonicalHash ?? 0n,
              target: rustSession?.lastTarget ?? null,
              repState: rustSession?.lastRepState ?? null,
              completedReps: rustSession?.lastCompletedReps ?? [],
              rustPacket: rustSession?.lastDecodedPacket ?? null,
              referenceComparison: rustSession?.referenceComparison ?? {
                status: "unavailable",
                reason: "no-installed-reviewed-profile",
                profileIdentity: null,
                qualityVerdict: null,
              },
            });
            const nextReferenceKey = referenceComparisonKey(motionPacket.referenceComparison);
            if (nextReferenceKey !== referenceComparisonKeyRef.current) {
              referenceComparisonKeyRef.current = nextReferenceKey;
              setReferenceComparison(motionPacket.referenceComparison);
            }
            if (rustSession) {
              setSimulatedBaselineComparison(rustSession.simulatedBaselineComparison);
            }
            processingStage = "packet-routing";
            const routeTiming = routeWebMotionPacket(motionPacket, {
              render: (packet) => {
                const frame = packet.canonical;
                setPose(usableLandmarkCount > 0 ? frame : null);
              },
              count: (packet) => {
                const frame = packet.canonical;
                if (packet.completedReps.length > 0) {
                  const confirmed = packet.completedReps.filter((rep) => rep.disposition === "confirmed");
                  const needsReview = packet.completedReps.filter((rep) => rep.disposition === "needs_review");
                  const rejected = packet.completedReps.filter((rep) => rep.disposition === "rejected");
                  rustSealedRepsRef.current.push(...confirmed);
                  rustNeedsReviewRepsRef.current.push(...needsReview);
                  rustRejectedRepsRef.current.push(...rejected);
                  setRustSealedRepCount(rustSealedRepsRef.current.length);
                  setRustNeedsReviewRepCount(rustNeedsReviewRepsRef.current.length);
                  setRustRejectedRepCount(rustRejectedRepsRef.current.length);
                  if (packet.target && packet.referenceComparison.status !== "unavailable") {
                    const record: RustReferenceEvidenceRecord = Object.freeze({
                      subjectEpoch: packet.target.subjectEpoch,
                      comparison: packet.referenceComparison,
                    });
                    const key = `${record.subjectEpoch}:${record.comparison.repId}:${record.comparison.repRevision}`;
                    const exists = rustReferenceEvidenceRef.current.some((existing) =>
                      `${existing.subjectEpoch}:${existing.comparison.repId}:${existing.comparison.repRevision}` === key,
                    );
                    if (!exists) {
                      rustReferenceEvidenceRef.current.push(record);
                      setReferenceEvidenceVersion((version) => version + 1);
                    }
                  }
                }
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
              record: (packet) => {
                const frame = packet.canonical;
                if (recordingActiveRef.current) {
                  recordedPosesRef.current.push(frame);
                  captureDiagnosticsRef.current.push({
                    timestampMs: frame.timestampMs,
                    hasPose: frame.landmarks.length > 0,
                    canonicalFrameValid: rustSession?.lastFrameValid ?? false,
                    inferenceMs: Number(inferenceMs.toFixed(2)),
                    rustCoreMs: Number(rustCoreMs.toFixed(3)),
                    decodeMs: Number(decodeMs.toFixed(3)),
                    repPhase: packet.repState?.phase ?? null,
                    sealedRepCount: rustSealedRepsRef.current.length,
                    completedRepCount: packet.completedReps.length,
                    schedulerDecision,
                    canonicalContentHash: packet.canonicalContentHash.toString(),
                  });
                }
              },
              analyze: (packet) => {
                const frame = packet.canonical;
                frameCountRef.current += 1;
                if (frameCountRef.current % 3 !== 0) return;
                const buffer = poseBufferRef.current;
                buffer.push(frame);
                // 采集窗口拉长到 30s 后,每 3 帧取 1 约 15 样本/秒 → 至少要 450 才装得下整窗
                if (buffer.length > 900) buffer.shift();
              },
            });
            diagnostic.routeMs = Number(routeTiming.totalMs.toFixed(3));
            diagnostic.renderMs = Number(routeTiming.renderMs.toFixed(3));
            diagnostic.recordMs = Number(routeTiming.recordMs.toFixed(3));
            diagnostic.analyzeMs = Number(routeTiming.analyzeMs.toFixed(3));
            diagnostic.packetAgeMs = Number((performance.now() - frameProcessingStartedAt).toFixed(3));
            diagnostic.processingMultiplier = Number((
              (inferenceMs + rustCoreMs + decodeMs + routeTiming.totalMs) / (1_000 / 30)
            ).toFixed(3));
            const degradation = degradationControllerRef.current.observe(
              diagnostic.processingMultiplier,
            );
            diagnostic.degradationLevel = degradation.level;
            diagnostic.degradationReason = degradation.reason;
            if (degradation.changed && rustSession) {
              rustSession.setDegradationLevel(degradation.level);
            }
            const lastCaptureDiagnostic = captureDiagnosticsRef.current.at(-1);
            if (lastCaptureDiagnostic?.timestampMs === canonicalFrame.timestampMs) {
              lastCaptureDiagnostic.routeMs = diagnostic.routeMs;
            }
            setTorsoLean(torsoLeanDeg(canonicalFrame.worldLandmarks));
          }
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : String(caught);
          console.warn(`Motion frame processing failed at ${processingStage}`, caught);
          publishTrackerReadiness({
            assetsReady: Boolean(engineRef.current && rustWasmRef.current),
            sourceOpen: true,
            targetLocked: false,
            usableLandmarkRatio: 0,
          });
          setPose(null);
          if (recordingActiveRef.current) {
            captureDiagnosticsRef.current.push({
              timestampMs: mediaTimestampMs,
              hasPose: false,
              inferenceMs: 0,
              dataGap: true,
              processingError: `${processingStage}: ${message}`,
            });
          }
          // A Rust ABI/runtime failure must be visible and must not stall the
          // capture loop. Rotate the next frame to the explicit TS diagnostic
          // fallback; a full reload can try the freshly built WASM again.
          if (
            processingStage === "rust-core"
            && canonicalSessionRef.current instanceof RustCanonicalWasmSession
          ) {
            rustWasmRef.current = null;
            canonicalSessionRef.current.close();
            canonicalSessionRef.current = null;
            canonicalShadowRef.current = null;
            rustTargetRef.current = null;
            setRustTarget(null);
            setRustSdkStatus("fallback");
          }
        }
        const frameNow = now;
        const window = fpsWindowRef.current;
        window.push(frameNow);
        while (window.length > 0 && window[0] < frameNow - 1000) window.shift();
        setFps(window.length);
        if (frameNow - lastCaptureRef.current > 400 && currentVideo.readyState >= 2) {
          lastCaptureRef.current = frameNow;
          const jpeg = captureFrame(currentVideo, captureCanvasRef);
          if (jpeg) {
            const buffer = keyframesRef.current;
            buffer.push({ t: mediaTimestampMs, jpeg });
            // 每 400ms 一张,30s 窗口需要 75 张;留余量到 90,否则相位取图会落到窗口尾部
            if (buffer.length > 90) buffer.shift();
          }
        }
      }
    };
    const scheduleNextFrame = () => {
      if (loopGenerationRef.current !== generation) return;
      const currentVideo = videoRef.current as FrameCallbackVideo | null;
      if (!currentVideo) return;
      if (currentVideo.requestVideoFrameCallback) {
        videoFrameCallbackRef.current = currentVideo.requestVideoFrameCallback((now, metadata) => {
          videoFrameCallbackRef.current = null;
          if (loopGenerationRef.current !== generation) return;
          const mediaTime = metadata.mediaTime;
          // A looping file starts a new source sequence; never connect that
          // repeated clip to the previous tracker history.
          if (modeRef.current === "file" && mediaTime + 0.05 < lastProcessedMediaTimeRef.current) {
            rotateCanonicalSequence();
          }
          lastProcessedMediaTimeRef.current = mediaTime;
          processDecodedFrame(mediaTime * 1000, now);
          scheduleNextFrame();
        });
        return;
      }

      // Fallback for browsers without requestVideoFrameCallback: rAF is only
      // a scheduler and dedupes on media time, so duplicate pixels never reach
      // VIDEO-mode tracking with fabricated time advancement.
      rafRef.current = requestAnimationFrame((now) => {
        if (loopGenerationRef.current !== generation) return;
        const fallbackVideo = videoRef.current;
        if (fallbackVideo) {
          const mediaTime = fallbackVideo.currentTime;
          if (modeRef.current === "file" && mediaTime + 0.05 < lastProcessedMediaTimeRef.current) {
            rotateCanonicalSequence();
          }
          if (mediaTime !== lastProcessedMediaTimeRef.current) {
            lastProcessedMediaTimeRef.current = mediaTime;
            processDecodedFrame(mediaTime * 1000, now);
          }
        }
        scheduleNextFrame();
      });
    };
    scheduleNextFrame();
    setStatus("running");
  }, [publishTrackerReadiness, rotateCanonicalSequence, startCanonicalSequence]);

  const stopCameraTracks = () => {
    const video = videoRef.current;
    if (video?.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
  };

  /** Publishes the finished local capture to the same deterministic + coach path as manual analysis. */
  const publishRecordedAnalysis = useCallback(
    async (
      analysis: PoseSetAnalysisResult | null,
      local: LocalClassification | null,
      auto: AutoSegmentation | null,
      trajectoryResult: TrajectoryFeatures | null,
      cameraViewForRecording: CameraView,
    ) => {
      setAnalysisStage("analyzing");
      setError(null);
      setLocalResult(local);
      setAutoSeg(auto);
      setTrajectory(trajectoryResult);
      setFormExplanation(null);
      setFormExplanationError(null);
      if (!analysis || !analysis.extraction || !analysis.score) {
        setSetAnalysis(analysis);
        setSegments(analysis?.segments ?? []);
        setFormExplanationError(analysis?.reason ?? "采集到的可用姿态数据不足，无法生成动作结论");
        setAnalysisStage("done");
        return;
      }

      setSetAnalysis(analysis);
      setSegments(analysis.segments);
      if (analysis.score.reps.length === 0) {
        setAnalysisStage("done");
        return;
      }

      setAnalysisStage("rendering");
      const exerciseLabel = EXERCISE_REGISTRY.get(analysis.profile?.exerciseId ?? "")?.nameZh ?? "力量训练动作";
      try {
        setFormExplanation(
          await explainFormScore(settings, {
            exerciseLabel,
            cameraView: cameraViewForRecording,
            score: analysis.score,
          }),
        );
      } catch (caught) {
        setFormExplanationError(caught instanceof Error ? caught.message : String(caught));
      }
      setAnalysisStage("done");
    },
    [settings],
  );

  /** 录制结束后把视频和关键点 fixture 固化到本机采集库，并暴露导出链接。 */
  const finalizeRecording = useCallback(async () => {
    if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
      canonicalSessionRef.current.finishSet();
      syncRustSetCommandPacket(canonicalSessionRef.current);
    }
    recordingActiveRef.current = false;
    const chunks = recordedChunksRef.current;
    const poses = recordedPosesRef.current;
    const diagnostics = captureDiagnosticsRef.current;
    const recordingTimelineOriginMs = poses[0]?.timestampMs ?? 0;
    const rebaseRepTimestamp = (timestamp: bigint) =>
      Math.max(0, Number(timestamp) - recordingTimelineOriginMs);
    const rustSealedReps = rustSealedRepsRef.current.map((rep) => ({
      repId: rep.repId.toString(),
      startFrameId: rep.startFrameId.toString(),
      startTimestampMs: rebaseRepTimestamp(rep.startTimestampMs),
      peakFrameId: rep.peakFrameId.toString(),
      peakTimestampMs: rebaseRepTimestamp(rep.peakTimestampMs),
      endFrameId: rep.endFrameId.toString(),
      endTimestampMs: rebaseRepTimestamp(rep.endTimestampMs),
      revision: rep.revision,
      canonicalSliceHash: rep.canonicalSliceHash.toString(),
      profileHash: rep.profileHash.toString(),
      profileMaturity: rep.profileMaturity,
      profileIdentity: rep.profileIdentity,
      qualityVerdict: rep.qualityVerdict,
      recoveredAcrossGap: rep.recoveredAcrossGap,
      disposition: rep.disposition,
      evidenceReason: rep.evidenceReason,
      observationFindings: rep.observationFindings,
    }));
    const rustNeedsReviewReps = rustNeedsReviewRepsRef.current.map((rep) => ({
      repId: rep.repId.toString(),
      startFrameId: rep.startFrameId.toString(),
      startTimestampMs: rebaseRepTimestamp(rep.startTimestampMs),
      peakFrameId: rep.peakFrameId.toString(),
      peakTimestampMs: rebaseRepTimestamp(rep.peakTimestampMs),
      endFrameId: rep.endFrameId.toString(),
      endTimestampMs: rebaseRepTimestamp(rep.endTimestampMs),
      disposition: rep.disposition,
      evidenceReason: rep.evidenceReason,
      observationFindings: rep.observationFindings,
      canonicalSliceHash: rep.canonicalSliceHash.toString(),
    }));
    const rustRejectedReps = rustRejectedRepsRef.current.map((rep) => ({
      repId: rep.repId.toString(),
      startFrameId: rep.startFrameId.toString(),
      startTimestampMs: rebaseRepTimestamp(rep.startTimestampMs),
      peakFrameId: rep.peakFrameId.toString(),
      peakTimestampMs: rebaseRepTimestamp(rep.peakTimestampMs),
      endFrameId: rep.endFrameId.toString(),
      endTimestampMs: rebaseRepTimestamp(rep.endTimestampMs),
      evidenceReason: rep.evidenceReason,
      observationFindings: rep.observationFindings,
      canonicalSliceHash: rep.canonicalSliceHash.toString(),
    }));
    const referenceComparisons = rustReferenceEvidenceRef.current.map((record) => {
      return {
        subjectEpoch: record.subjectEpoch.toString(),
        comparison: serializeReferenceComparison(record.comparison),
        qualityEvidence: qualityEvidenceForComparison(
          record.comparison,
          rustSealedRepsRef.current,
        ),
      };
    });
    const activeReferenceComparison = canonicalSessionRef.current instanceof RustCanonicalWasmSession
      ? canonicalSessionRef.current.referenceComparison
      : NO_REVIEWED_REFERENCE;
    const activeReferenceQualityEvidence = qualityEvidenceForComparison(
      activeReferenceComparison,
      rustSealedRepsRef.current,
    );
    const activeSimulatedBaselineComparison = canonicalSessionRef.current instanceof RustCanonicalWasmSession
      ? canonicalSessionRef.current.simulatedBaselineComparison
      : NO_REVIEWED_REFERENCE;
    recordedChunksRef.current = [];
    captureDiagnosticsRef.current = [];
    if (isUnmountedRef.current) {
      recordedPosesRef.current = [];
      return;
    }
    if (chunks.length === 0) {
      finalizingRecordingRef.current = false;
      setIsFinalizingRecording(false);
      return;
    }

    const previous = recordingResultRef.current;
    if (previous) revokeRecordingResultUrls(previous);

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
      diagnostics,
    });
    const keypointsWriteStartedAt = performance.now();
    const keypointsJson = JSON.stringify(fixture);
    const keypointsBlob = new Blob([keypointsJson], { type: "application/json" });
    const keypointsWritePreparationMs = performance.now() - keypointsWriteStartedAt;
    const recordingMetadata = recordingMetadataRef.current;
    const recordedPoses = fixture[0].poses;
    const rustProductProfile = rustProfileForContext(
      recordingMetadata?.exerciseChoice ?? "",
      recordingMetadata?.capturePosition ?? "frontLeft45",
      recordingMetadata?.trainingSide ?? "bilateral",
      recordingMetadata?.variation ?? "",
    );
    const rustProfileContext = {
      exerciseId: recordingMetadata?.exerciseChoice ?? "",
      capturePosition: recordingMetadata?.capturePosition ?? "frontLeft45",
      trainingSide: recordingMetadata?.trainingSide ?? "bilateral",
      variation: recordingMetadata?.variation ?? "",
    } as const;
    // Built-in, observed and simulated recognition profiles all execute in
    // Rust. Once one is active, downstream analysis must consume its sealed
    // boundaries rather than quietly re-segmenting in TypeScript.
    const usesRustSealedBoundaries = rustProductProfile !== null
      || resolveObservedRecognitionProfile(rustProfileContext) !== null
      || resolveSimulatedRecognitionProfile(rustProfileContext) !== null;
    const rustSegments: RepSegment[] = rustSealedReps.map((rep, index) => ({
      repIndex: index + 1,
      startMs: rep.startTimestampMs,
      peakMs: rep.peakTimestampMs,
      endMs: rep.endTimestampMs,
      durationMs: rep.endTimestampMs - rep.startTimestampMs,
      concentricMs: rep.peakTimestampMs - rep.startTimestampMs,
      eccentricMs: rep.endTimestampMs - rep.peakTimestampMs,
      // The TS metric layer measures amplitude from the canonical frames
      // inside these immutable Rust boundaries; it never re-segments them.
      amplitude: 0,
    }));
    // 原始关键点完整保留在 fixture；下游所有面向用户的推理共用这一段过滤后的
    // canonical 序列，避免“渲染一个数据、导出/计数另一份数据”。
    const trainingWindow = selectTrainingWindow(recordedPoses);
    const analysisPoses = usesRustSealedBoundaries ? recordedPoses : trainingWindow.poses;
    const hasEnoughPoses = analysisPoses.length >= 20;
    const auto = hasEnoughPoses && !usesRustSealedBoundaries
      ? segmentRepsAuto(analysisPoses)
      : null;
    const trajectoryCycles = usesRustSealedBoundaries
      ? rustSegments.map((segment) => ({
          index: segment.repIndex,
          startMs: segment.startMs,
          extremeMs: segment.peakMs,
          endMs: segment.endMs,
          durationMs: segment.durationMs,
          amplitude: segment.amplitude,
        }))
      : auto?.cycles ?? [];
    const trajectoryResult = trajectoryCycles.length > 0
      ? computeTrajectoryFeatures(analysisPoses, trajectoryCycles)
      : null;
    const local = trajectoryResult && auto
      ? classifyLocally({
          trajectory: trajectoryResult,
          segmentation: auto,
          posture: computeExerciseFeatures(analysisPoses).posture,
        })
      : null;
    const localConfidenceValue = local ? { high: 0.9, medium: 0.6, low: 0.3 }[local.confidence] : 0;
    const exercise = recordingMetadata
      ? recordingMetadata.exerciseChoice && recordingMetadata.exerciseChoice !== "auto"
        ? { mode: "user" as const, exerciseId: recordingMetadata.exerciseChoice }
        : {
            mode: "auto" as const,
            exerciseId: local?.id === "unknown" ? null : local?.id ?? null,
            confidence: localConfidenceValue,
          }
      : null;
    const analysis = exercise && recordingMetadata
      ? analyzePoseSet({
          poses: analysisPoses,
          cameraView: recordingMetadata.cameraView,
          exercise,
          sealedSegments: usesRustSealedBoundaries ? rustSegments : undefined,
          autoSuggestion: {
            exerciseId: local?.id === "unknown" ? null : local?.id ?? null,
            confidence: localConfidenceValue,
          },
        })
      : null;
    const annotation =
      analysis?.profile && analysis.segments.length > 0 && recordingMetadata
        ? buildLabeledSetFixtureTemplate({
            videoId: fixture[0].video,
            keypointsFile: `${baseName}.json`,
            exerciseId: analysis.profile.exerciseId,
            cameraView: recordingMetadata.cameraView,
            ruleVersion: analysis.versions.rule,
            thresholdVersion: analysis.versions.rule,
            segments: analysis.segments,
          })
        : null;
    const annotationBlob = annotation
      ? new Blob([JSON.stringify(annotation, null, 2)], { type: "application/json" })
      : null;
    const selectedExercise = recordingMetadata?.exerciseChoice && recordingMetadata.exerciseChoice !== "auto"
      ? EXERCISE_REGISTRY.get(recordingMetadata.exerciseChoice) ?? null
      : analysis?.profile ? EXERCISE_REGISTRY.get(analysis.profile.exerciseId) ?? null : null;
    const rustLineage = canonicalSessionRef.current instanceof RustCanonicalWasmSession
      ? canonicalSessionRef.current.lastDecodedPacket?.lineage ?? null
      : null;
    const processedFrameCount = diagnostics.filter((frame) =>
      frame.canonicalContentHash !== undefined && !frame.processingError).length;
    const validFrameCount = diagnostics.filter((frame) =>
      frame.canonicalFrameValid && !frame.processingError).length;
    // This sidecar exists even for catalog-only exercises, unlike the labelled
    // rep template which correctly requires a validated-by-sampling profile.
    const captureMetadata = {
      schemaVersion: "form-coach-capture-metadata/v1",
      videoId: fixture[0].video,
      keypointsFile: `${baseName}.json`,
      exerciseId: selectedExercise?.id ?? null,
      muscleGroup: selectedExercise?.muscleGroup ?? null,
      exerciseMaturity: selectedExercise?.maturity ?? null,
      variation: recordingMetadata?.variation || null,
      trainingSide: recordingMetadata?.trainingSide ?? "bilateral",
      cameraView: recordingMetadata?.cameraView ?? "oblique45",
      capturePosition: recordingMetadata?.capturePosition ?? "frontLeft45",
      analysisStatus: analysis?.score ? "available" : "unavailable",
      profileVersion: analysis?.profile?.version ?? null,
      model: fixture[0].model,
      authoritativeMotionAlgorithm: poses[0]?.algorithmVersion ?? "rust-canonical-wasm/v1",
      motionVersions: rustLineage ? {
        contract: rustLineage.contract,
        algorithm: rustLineage.algorithmVersion,
        config: rustLineage.configVersion,
        inference: rustLineage.inferenceVersion,
        diagnostic: rustLineage.diagnosticVersion,
        activeProfileIdentity: rustLineage.activeProfileIdentity,
        activeProfileHash: rustLineage.activeProfileHash?.toString() ?? null,
      } : null,
      browserWriteTelemetry: {
        keypointsSerializationAndBlobMs: Number(keypointsWritePreparationMs.toFixed(3)),
        diskCompletionObservable: false,
        reason: "Browser download APIs do not expose OS disk-flush completion",
      },
      offlineRuntimeMetrics: {
        processedFrames: processedFrameCount,
        validFrames: validFrameCount,
        processedFps: fixture[0].durationSec > 0 ? processedFrameCount / fixture[0].durationSec : 0,
        droppedFrames: captureDroppedFramesRef.current,
        maxBacklogFrames: 1,
        activeDurationMs: activeDurationRef.current.value(),
      },
      rustSealedReps,
      rustNeedsReviewReps,
      rustRejectedReps,
      referenceComparison: serializeReferenceComparison(
        activeReferenceComparison,
      ),
      simulatedBaselineComparison: serializeReferenceComparison(
        activeSimulatedBaselineComparison,
      ),
      referenceComparisons,
      qualityEvidence: activeReferenceQualityEvidence,
    };
    const metadataBlob = new Blob([JSON.stringify(captureMetadata, null, 2)], { type: "application/json" });
    const videoUrl = URL.createObjectURL(videoBlob);
    const keypointsUrl = URL.createObjectURL(keypointsBlob);
    const annotationUrl = annotationBlob ? URL.createObjectURL(annotationBlob) : null;
    const metadataUrl = URL.createObjectURL(metadataBlob);

    const result: RecordingResult = {
      videoUrl,
      videoName: `${baseName}.${videoExt}`,
      keypointsUrl,
      keypointsName: `${baseName}.json`,
      annotationUrl,
      annotationName: annotationBlob ? `${baseName}.labels.json` : null,
      metadataUrl,
      metadataName: `${baseName}.metadata.json`,
      poseCount: poses.length,
      durationSec: fixture[0].durationSec,
    };
    recordingResultRef.current = result;
    setRecordingResult(result);

    void publishRecordedAnalysis(
      analysis,
      local,
      auto,
      trajectoryResult,
      recordingMetadata?.cameraView ?? "oblique45",
    );

    try {
      const saved = await saveLocalCapture({
        id: baseName,
        createdAt: new Date(recordingStartMsRef.current).toISOString(),
        videoName: result.videoName,
        keypointsName: result.keypointsName,
        poseCount: result.poseCount,
        durationSec: result.durationSec,
        analysisStatus: analysis?.score ? "available" : "unavailable",
        cameraView: recordingMetadata?.cameraView ?? "oblique45",
        capturePosition: recordingMetadata?.capturePosition ?? "frontLeft45",
        exerciseId: selectedExercise?.id ?? null,
        muscleGroup: selectedExercise?.muscleGroup ?? null,
        videoBlob,
        keypointsJson: JSON.stringify(fixture),
        labelTemplateJson: annotation ? JSON.stringify(annotation, null, 2) : null,
        analysisJson: analysis ? JSON.stringify(analysis) : null,
        metadataJson: JSON.stringify(captureMetadata, null, 2),
      });
      if (!isUnmountedRef.current) {
        setLocalCaptures((previousCaptures) => [saved, ...previousCaptures.filter((item) => item.id !== saved.id)]);
        setLocalCaptureError(null);
      }
    } catch (caught) {
      if (!isUnmountedRef.current) {
        setLocalCaptureError(caught instanceof Error ? caught.message : String(caught));
      }
    } finally {
      finalizingRecordingRef.current = false;
      if (!isUnmountedRef.current) setIsFinalizingRecording(false);
    }

    requestCaptureDownloads(recordingResultFiles(result));
    recordedPosesRef.current = [];
  }, [publishRecordedAnalysis]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recordingActiveRef.current) {
      recordingStopMsRef.current = Date.now();
      if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
        // Stop is the semantic set boundary, not the later MediaRecorder blob
        // callback. This prevents a late video frame from sealing a rep.
        canonicalSessionRef.current.finishSet();
        syncRustSetCommandPacket(canonicalSessionRef.current);
      }
    }
    if (recorder && recorder.state !== "inactive") {
      finalizingRecordingRef.current = true;
      setIsFinalizingRecording(true);
      recorder.stop();
    } else {
      if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
        canonicalSessionRef.current.finishSet();
        syncRustSetCommandPacket(canonicalSessionRef.current);
      }
      recordingActiveRef.current = false;
      finalizingRecordingRef.current = false;
      setIsFinalizingRecording(false);
    }
    setIsRecording(false);
  }, []);

  const stop = useCallback(() => {
    loopGenerationRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    const frameCallbackVideo = videoRef.current as FrameCallbackVideo | null;
    if (videoFrameCallbackRef.current !== null) {
      frameCallbackVideo?.cancelVideoFrameCallback?.(videoFrameCallbackRef.current);
      videoFrameCallbackRef.current = null;
    }
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
    if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
      canonicalSessionRef.current.close();
    }
    canonicalSessionRef.current = null;
    canonicalShadowRef.current = null;
  }, [stopRecording]);
  stopRef.current = stop;

  const start = useCallback(async () => {
    if (
      recordingActiveRef.current
      || finalizingRecordingRef.current
      || !trackerAssetsReady
    ) return;
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

      // Preview/tracking is intentionally independent from recording: the user
      // can walk into position with the camera already open, then start a clean
      // set explicitly.  No preview frames are written to the capture artifact.
      startLoop();
    } catch (caught) {
      stopCameraTracks();
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("error");
    }
  }, [ensureEngine, startLoop, trackerAssetsReady]);

  const startRecording = useCallback(() => {
    const video = videoRef.current;
    const stream = video?.srcObject;
    if (
      status !== "running" ||
      modeRef.current !== "camera" ||
      !(stream instanceof MediaStream) ||
      recordingActiveRef.current ||
      finalizingRecordingRef.current ||
      trackerReadinessRef.current.phase !== "ready"
    ) {
      return;
    }
    try {
      // beginSet is the exact capture boundary. Keep the calibrated tracking
      // session alive so pressing record cannot discard the verified subject
      // lock; preview frames are still excluded from the capture artifact.
      const rustSession = canonicalSessionRef.current;
      if (rustSession instanceof RustCanonicalWasmSession) {
        rustSession.beginSet();
        syncRustSetCommandPacket(rustSession);
      }
      activeDurationRef.current.reset();
      setRustActiveDurationMs(0);
      rustSealedRepsRef.current = [];
      rustNeedsReviewRepsRef.current = [];
      rustRejectedRepsRef.current = [];
      setRustSealedRepCount(0);
      setRustNeedsReviewRepCount(0);
      setRustRejectedRepCount(0);
      recordedPosesRef.current = [];
      captureDiagnosticsRef.current = [];
      captureDroppedFramesRef.current = 0;
      recordedChunksRef.current = [];
      recordingStartMsRef.current = Date.now();
      recordingStopMsRef.current = recordingStartMsRef.current;
      recordingMetadataRef.current = { exerciseChoice, cameraView, capturePosition, variation, trainingSide };
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        void finalizeRecording();
      };
      mediaRecorderRef.current = recorder;
      recordingActiveRef.current = true;
      recorder.start();
      setIsRecording(true);
      setAnalysisStage("collecting");
      setSetAnalysis(null);
      setFormExplanation(null);
      setFormExplanationError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [cameraView, capturePosition, exerciseChoice, finalizeRecording, status, trainingSide, variation]);

  const startUrl = useCallback(
    async (url: string, name: string) => {
      if (recordingActiveRef.current || finalizingRecordingRef.current) return;
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

  const reopenLocalAnalysis = useCallback(
    async (captureId: string) => {
      try {
        const capture = await loadLocalCapture(captureId);
        if (!capture?.analysisJson) throw new Error("该组录制没有可用的已保存分析数据");
        const analysis = JSON.parse(capture.analysisJson) as PoseSetAnalysisResult;
        await publishRecordedAnalysis(analysis, null, null, null, capture.cameraView);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    },
    [publishRecordedAnalysis],
  );

  const exportLocalCapture = useCallback(async (captureId: string) => {
    try {
      const capture = await loadLocalCapture(captureId);
      if (!capture) throw new Error("找不到本地采集记录");
      const videoUrl = URL.createObjectURL(capture.videoBlob);
      const keypointsUrl = URL.createObjectURL(new Blob([capture.keypointsJson], { type: "application/json" }));
      const analysisUrl = capture.analysisJson
        ? URL.createObjectURL(new Blob([capture.analysisJson], { type: "application/json" }))
        : null;
      const labelsUrl = capture.labelTemplateJson
        ? URL.createObjectURL(new Blob([capture.labelTemplateJson], { type: "application/json" }))
        : null;
      const metadataUrl = capture.metadataJson
        ? URL.createObjectURL(new Blob([capture.metadataJson], { type: "application/json" }))
        : null;
      requestCaptureDownloads([
        { url: videoUrl, name: capture.videoName },
        { url: keypointsUrl, name: capture.keypointsName },
        ...(labelsUrl ? [{ url: labelsUrl, name: `${capture.id}.labels.json` }] : []),
        ...(analysisUrl ? [{ url: analysisUrl, name: `${capture.id}.analysis.json` }] : []),
        ...(metadataUrl ? [{ url: metadataUrl, name: `${capture.id}.metadata.json` }] : []),
      ]);
      window.setTimeout(() => {
        URL.revokeObjectURL(videoUrl);
        URL.revokeObjectURL(keypointsUrl);
        if (analysisUrl) URL.revokeObjectURL(analysisUrl);
        if (labelsUrl) URL.revokeObjectURL(labelsUrl);
        if (metadataUrl) URL.revokeObjectURL(metadataUrl);
      }, 10_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    isUnmountedRef.current = false;
    void listLocalCaptures()
      .then(setLocalCaptures)
      .catch((caught) => setLocalCaptureError(caught instanceof Error ? caught.message : String(caught)));
    return () => {
      isUnmountedRef.current = true;
      loopGenerationRef.current += 1;
      cancelAnimationFrame(rafRef.current);
      const video = videoRef.current;
      if (videoFrameCallbackRef.current !== null) {
        (video as FrameCallbackVideo | null)?.cancelVideoFrameCallback?.(videoFrameCallbackRef.current);
        videoFrameCallbackRef.current = null;
      }
      if (video?.srcObject instanceof MediaStream) {
        video.srcObject.getTracks().forEach((track) => track.stop());
      }
      if (mediaRecorderRef.current?.state !== "inactive") {
        recordingStopMsRef.current = Date.now();
        mediaRecorderRef.current?.stop();
      }
      if (recordingResultRef.current) revokeRecordingResultUrls(recordingResultRef.current);
      engineRef.current?.close();
      if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
        canonicalSessionRef.current.close();
      }
      canonicalSessionRef.current = null;
      canonicalShadowRef.current = null;
    };
  }, []);

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

      const rawBuffer = poseBufferRef.current;
      const trainingWindow = selectTrainingWindow(rawBuffer);
      const buffer = trainingWindow.poses;
      if (buffer.length < 20) throw new Error("采集到的有效姿态数据太少,请确认画面中有人且已站定");
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
        `本地建议: ${local.id}(${local.confidence}) | 分期采用: ${exerciseId === "unknown" ? "未确定" : exerciseId}${trainingWindow.trimmed ? ` | 已排除 ${trainingWindow.excludedPoseCount} 帧进/离场噪音` : ""}`,
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
  const isConsole = workspacePage === "console";
  const isHomeWorkout = workspacePage === "home-workout";
  const isReview = workspacePage === "review";
  const selectedHomeWorkout = HOME_WORKOUT_FLOW_ACTIONS.find((action) => action.id === exerciseChoice);
  const trackerReadinessPresentation = rustSdkStatus === "fallback"
    ? {
        title: "追踪器加载失败",
        detail: "Rust 骨架识别内核不可用，请刷新后重试。",
        color: HUD.danger,
      }
    : trackerReadiness.phase === "loading"
      ? {
          title: "正在加载追踪器",
          detail: "正在准备 MediaPipe 与 Rust 骨架识别内核，请稍候。",
          color: HUD.amber,
        }
      : trackerReadiness.phase === "loaded"
        ? {
            title: "追踪器已加载",
            detail: "打开相机后将进行人物校准。",
            color: HUD.primary,
          }
        : trackerReadiness.phase === "calibrating"
          ? {
              title: "正在校准人物",
              detail: "请保持全身入镜；稳定识别前不会显示骨架或允许录制。",
              color: HUD.amber,
            }
          : trackerReadiness.phase === "interrupted"
            ? {
                title: "追踪暂时中断",
                detail: "请保持在画面内；有可用骨架时继续预览，重新锁定前暂停计数。",
                color: HUD.amber,
              }
            : {
                title: "骨架识别已就绪",
                detail: "人物已稳定锁定，可以开始本组录制。",
                color: HUD.primary,
              };
  const cameraStartBlocked =
    isFinalizingRecording
    || !trackerAssetsReady
    || (isHomeWorkout && !selectedHomeWorkout);
  const liveRustSession = canonicalSessionRef.current instanceof RustCanonicalWasmSession
    ? canonicalSessionRef.current
    : null;
  const homeRepPhase = liveRustSession?.lastRepState.phase ?? "ready";
  const homeRecognitionStatus = rustSdkStatus !== "ready"
    ? "识别内核未就绪"
    : status !== "running"
      ? trackerReadinessPresentation.detail
      : trackerReadiness.phase !== "ready"
        ? trackerReadinessPresentation.detail
        : !isRecording
          ? "预览就绪，点击开始本组录制"
          : rustSetLifecycle === "arming"
            ? "正在稳定锁定身体"
            : rustSetLifecycle === "paused"
              ? "动作中断，等待恢复"
              : HOME_REP_PHASE_LABEL[homeRepPhase];
  const videoViewport = fitVideoIntoStage(videoAspect);

  return (
    <div style={{ ...styles.page, ...(isReview ? styles.reviewRoot : null) }}>
      {/* ===== 顶部:品牌 + 全局状态 ===== */}
      <header style={styles.header} className="range-header">
        <div style={styles.brand}>
          <span style={styles.brandLogo}>FORM·RANGE</span>
          <span style={styles.brandSub} className="range-brand-sub">
            {workspacePage === "review"
              ? "审核标注 / VIDEO ANNOTATION"
              : isHomeWorkout
                ? "居家跟练 / HOME MOTION LAB"
                : "训练页 / LIVE TRAINING"}
          </span>
        </div>
        <nav style={styles.pageSwitch} aria-label="页面模式">
          <button
            type="button"
            style={{ ...styles.pageSwitchButton, ...(workspacePage === "training" ? styles.pageSwitchButtonActive : null) }}
            aria-pressed={workspacePage === "training"}
            onClick={() => selectWorkspacePage("training")}
          >
            训练页
          </button>
          <button
            type="button"
            style={{ ...styles.pageSwitchButton, ...(isHomeWorkout ? styles.pageSwitchButtonActiveHome : null) }}
            aria-pressed={isHomeWorkout}
            onClick={() => selectWorkspacePage("home-workout")}
          >
            居家验证
          </button>
          <button
            type="button"
            style={{ ...styles.pageSwitchButton, ...(workspacePage === "review" ? styles.pageSwitchButtonActive : null) }}
            aria-pressed={workspacePage === "review"}
            onClick={() => selectWorkspacePage("review")}
          >
            审核标注
          </button>
        </nav>
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
          {rustTarget && (
            <span style={styles.headerStatusText}>
              TARGET · {rustTarget.state.toUpperCase()} · {rustTarget.candidateCount}
            </span>
          )}
          <span style={styles.headerStatusText}>
            {rustSdkStatus === "ready"
              ? "RUST SDK · ACTIVE"
              : rustSdkStatus === "loading"
                ? "RUST SDK · LOADING"
                : "TS FALLBACK · DIAGNOSTIC"}
          </span>
        </div>
      </header>

      {!isReview && (
        <>
      <div style={styles.body} className="range-body">
        <main style={styles.main} className="range-main">
          {isHomeWorkout && (
            <section style={styles.homeFlowRail} className="home-flow-rail hud-reveal hud-reveal-1" aria-label="居家动作验证流程">
              <div style={styles.homeFlowIntro}>
                <span style={styles.homeFlowEyebrow}>TECHNICAL VALIDATION · 仅验证识别链路</span>
                <strong style={styles.homeFlowTitle}>正面站立动作识别</strong>
              </div>
              {[
                { index: "1", label: "选择动作", active: Boolean(selectedHomeWorkout), done: Boolean(selectedHomeWorkout) },
                { index: "2", label: "打开相机", active: status === "running", done: status === "running" },
                { index: "3", label: "本组录制", active: isRecording, done: Boolean(recordingResult) && !isRecording },
              ].map((step) => (
                <div
                  key={step.index}
                  style={{
                    ...styles.homeFlowStep,
                    ...(step.active ? styles.homeFlowStepActive : null),
                    ...(step.done ? styles.homeFlowStepDone : null),
                  }}
                >
                  <span style={styles.homeFlowStepIndex}>{step.done ? "✓" : step.index}</span>
                  <span>{step.label}</span>
                </div>
              ))}
            </section>
          )}
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
                onDoubleClick={(event) => {
                  if (!isConsole || !(canonicalSessionRef.current instanceof RustCanonicalWasmSession)) return;
                  const bounds = event.currentTarget.getBoundingClientRect();
                  let x = (event.clientX - bounds.left) / bounds.width;
                  const y = (event.clientY - bounds.top) / bounds.height;
                  if (mode === "camera") x = 1 - x;
                  if (canonicalSessionRef.current.selectSubjectAt(x, y)) {
                    syncRustSetCommandPacket(canonicalSessionRef.current);
                  }
                }}
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
                      ? "正在加载追踪器…"
                      : status === "starting-camera"
                        ? "正在打开相机…"
                        : isHomeWorkout
                          ? selectedHomeWorkout
                            ? `已选择 ${selectedHomeWorkout.label}，请打开相机`
                            : "请先在右侧选择一个居家动作"
                          : "选择输入源,开始追踪"}
                  </div>
                </div>
              )}
              {status === "running" && mode === "camera" && trackerReadiness.phase !== "ready" && (
                <div style={styles.trackerStageNotice} role="status" aria-live="polite">
                  <strong style={{ color: trackerReadinessPresentation.color }}>
                    {trackerReadinessPresentation.title}
                  </strong>
                  <span>{trackerReadinessPresentation.detail}</span>
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

          {(workspacePage === "training" || isHomeWorkout) ? (
            <section style={styles.trainingReadout} className="range-training-readout hud-reveal hud-reveal-2">
              <div>
                <span style={styles.panelKicker}>LIVE SESSION</span>
                <h2 style={styles.panelTitle}>
                  {exerciseChoice && exerciseChoice !== "auto"
                    ? EXERCISE_REGISTRY.require(exerciseChoice).nameZh
                    : "选择动作后开始本组训练"}
                </h2>
              </div>
              <div style={styles.trainingStats}>
                <span style={styles.trainingStat}>
                  <strong style={styles.trainingStatValue}>{rustSdkStatus === "ready" ? rustSealedRepCount : "—"}</strong>
                  已识别次数
                </span>
                {rustNeedsReviewRepCount > 0 && (
                  <span style={styles.trainingStat}>
                    <strong style={styles.trainingStatValue}>{rustNeedsReviewRepCount}</strong>
                    待审核动作
                  </span>
                )}
                {rustRejectedRepCount > 0 && (
                  <span style={styles.trainingStat}>
                    <strong style={styles.trainingStatValue}>{rustRejectedRepCount}</strong>
                    已过滤候选
                  </span>
                )}
                <span style={styles.trainingStat}>
                  <strong style={styles.trainingStatValue}>{fps || "—"}</strong>
                  当前 FPS
                </span>
                <span style={styles.trainingStat}>
                  <strong style={styles.trainingStatValue}>{(rustActiveDurationMs / 1000).toFixed(1)}s</strong>
                  Canonical 有效时间
                </span>
                <span style={styles.trainingStat}>
                  <strong style={styles.trainingStatValue}>{
                    isRecording
                      ? ({ arming: "稳定锁定中", active: "识别中", paused: "暂停中", finished: "已完成", idle: "准备中" }[rustSetLifecycle])
                      : status === "running" ? "预览中" : "待机"
                  }</strong>
                  本组状态
                </span>
              </div>
              <p style={styles.trainingHint}>
                {isHomeWorkout
                  ? "与健身采集使用同一流程：打开相机后只预览；点击“开始本组录制”才开始计数和录像，点击“停止并保存本组”后自动保存并继续预览。"
                  : "从视频库选择素材即可在此页查看骨架识别、次数与质量证据；只有点击“开始本组录制”才会写入新的本机训练档案。"}
                {rustSdkStatus !== "ready" ? " Rust SDK 未就绪时只显示骨架预览，不回退到旧计数器写入正式次数。" : ""}
              </p>
              {(rustNeedsReviewRepCount > 0 || rustRejectedRepCount > 0) && (
                <p style={styles.trainingHint}>
                  候选证据：
                  {rustNeedsReviewRepsRef.current.map((rep) => `待审核 #${rep.repId.toString()}（${candidateEvidenceLabel(rep.evidenceReason)}）`).join("；")}
                  {rustNeedsReviewRepCount > 0 && rustRejectedRepCount > 0 ? "；" : ""}
                  {rustRejectedRepsRef.current.map((rep) => `已过滤 #${rep.repId.toString()}（${candidateEvidenceLabel(rep.evidenceReason)}）`).join("；")}
                </p>
              )}
              {[...rustSealedRepsRef.current, ...rustNeedsReviewRepsRef.current]
                .some((rep) => rep.observationFindings.length > 0) && (
                <p style={styles.trainingHint}>
                  本组改进提示：
                  {[...rustSealedRepsRef.current, ...rustNeedsReviewRepsRef.current]
                    .filter((rep) => rep.observationFindings.length > 0)
                    .map((rep) => `#${rep.repId.toString()}（${rep.observationFindings.map(observationFindingLabel).join("、")}）`)
                    .join("；")}
                  。这些动作已经被识别；提示仅用于和当前参考动作对照，不是失败判定。
                </p>
              )}
              {setAnalysis?.score && (
                <p style={styles.trainingScore}>
                  最近结果：{setAnalysis.score.score === null ? setAnalysis.score.label : `${setAnalysis.score.score} 分`}
                </p>
              )}
              {!isHomeWorkout && <div style={styles.trainingHint}>
                <strong>轨迹质量证据</strong>
                {simulatedNominalReferenceConfigured && (
                  <div>
                    当前参考：模拟标准轨迹基线（未校准）。带外表示“与模拟相位路径有偏离”，用于复核与纠正，不是总分或医学结论；你后续的同机位标注视频会用于校准它。
                  </div>
                )}
                {!simulatedNominalReferenceConfigured && simulatedRecognitionBaseline && rustSealedRepCount > 0 && (
                  <div>
                    当前动作使用 Rust 内的模拟运动学 baseline（未校准）：它对同一 Rust 已封装 rep 的主/副信号相位做描述性比对，绝不改变正式次数，也不输出“标准/正确”评分。请用同机位审核资料建立独立的轨迹比较 profile。
                  </div>
                )}
                {simulatedBaselineComparison.status !== "unavailable" && (
                  <div>
                    模拟 baseline · rep {simulatedBaselineComparison.repId.toString()} · {simulatedBaselineComparison.status}
                    {simulatedBaselineComparison.features.map((feature) => (
                      ` · ${feature.feature} 可比 ${feature.comparableNodeCount}/32，带外 ${feature.outsideNodeCount}`
                    )).join("")}
                    。仅供复核，不是质量评分。
                  </div>
                )}
                {currentReferenceQualityEvidence.map((card) => (
                  <div key={card.id}>{card.title}：{card.detail}（{card.evidence}）</div>
                ))}
              </div>}
            </section>
          ) : (
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
                      {(() => {
                        // 有问题的 rep 直接列出来;没问题的收进折叠区,默认不占地方——
                        // 不确定该归哪边时(比如查不到对应 repScore)算作"有问题",
                        // 宁可多显示一条也不要把真正需要注意的 rep 藏起来。
                        const repScoreByIndex = new Map(
                          (setAnalysis?.score?.reps ?? []).map((r) => [r.repIndex, r]),
                        );
                        const needsAttention = (repIndex: number) => {
                          const repScore = repScoreByIndex.get(repIndex);
                          if (!repScore) return true;
                          return repScore.deductions.length > 0 || repScore.status !== "scored";
                        };
                        const flagged = formExplanation.perRep.filter((item) =>
                          needsAttention(item.repIndex),
                        );
                        const clear = formExplanation.perRep.filter(
                          (item) => !needsAttention(item.repIndex),
                        );
                        return (
                          <>
                            {flagged.length > 0 && (
                              <ul style={styles.agentList}>
                                {flagged.map((item) => (
                                  <li key={item.repIndex}>
                                    第 {item.repIndex} 下：{item.note}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {clear.length > 0 && (
                              <details style={{ marginTop: flagged.length > 0 ? 6 : 0 }}>
                                <summary style={styles.reportMeta}>
                                  {flagged.length > 0
                                    ? `另外 ${clear.length} 下没问题（点击查看）`
                                    : `查看每一下的点评（共 ${clear.length} 下）`}
                                </summary>
                                <ul style={styles.agentList}>
                                  {clear.map((item) => (
                                    <li key={item.repIndex}>
                                      第 {item.repIndex} 下：{item.note}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </>
                        );
                      })()}
                    </>
                  ) : setAnalysis?.score ? (
                    // 大白话点评还没生成或生成失败时,先展示规则引擎已经算好的确定性分数——
                    // 这部分不依赖 LLM,不该因为点评那一步失败就让用户什么结论都看不到。
                    <div style={styles.agentHeadline}>
                      {setAnalysis.score.score === null
                        ? setAnalysis.score.label
                        : `${setAnalysis.score.score} 分`}
                    </div>
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
                      大白话点评暂时没生成（{formExplanationError}），上面是规则引擎算好的分数，下面仍是原始数值。
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
          )}
        </main>

        <aside style={styles.sidebar} className="range-sidebar">
          <div
            style={{
              ...styles.sideSection,
              ...(isHomeWorkout ? styles.homeCaptureOrder : null),
              ...(isHomeWorkout ? { order: selectedHomeWorkout ? 1 : 2 } : null),
            }}
            className="hud-reveal hud-reveal-1"
          >
            <div style={styles.sideTitle}>{isHomeWorkout ? "02 · 采集输入" : "01 · 采集输入"}</div>
            <section
              data-tracker-phase={rustSdkStatus === "fallback" ? "error" : trackerReadiness.phase}
              style={{
                ...styles.trackerReadinessPanel,
                borderColor: trackerReadinessPresentation.color,
              }}
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden="true"
                style={{
                  ...styles.trackerReadinessDot,
                  background: trackerReadinessPresentation.color,
                  boxShadow: `0 0 10px ${trackerReadinessPresentation.color}`,
                }}
              />
              <span style={styles.trackerReadinessCopy}>
                <strong style={{ color: trackerReadinessPresentation.color }}>
                  {trackerReadinessPresentation.title}
                </strong>
                <small>{trackerReadinessPresentation.detail}</small>
              </span>
            </section>
            <div style={styles.btnRow}>
              {status === "running" ? (
                <button style={{ ...styles.btn, background: "#4c1d1d", color: "#fca5a5" }} onClick={stop}>
                  ■ 关闭相机
                </button>
              ) : (
                <button
                  disabled={cameraStartBlocked}
                  style={{
                    ...styles.btn,
                    background: HUD.primaryDim,
                    color: "#eafff2",
                    opacity: cameraStartBlocked ? 0.35 : 1,
                    cursor: cameraStartBlocked ? "not-allowed" : "pointer",
                  }}
                  onClick={start}
                >
                  {isFinalizingRecording
                    ? "保存中…"
                    : !trackerAssetsReady
                      ? rustSdkStatus === "fallback"
                        ? "追踪器不可用"
                        : "正在加载追踪器…"
                    : isHomeWorkout && !selectedHomeWorkout
                      ? "请先选择动作"
                      : "▶ 打开相机"}
                </button>
              )}
              {!isHomeWorkout && (
              <label
                style={{
                  ...styles.btn,
                  background: HUD.panel2,
                  border: `1px solid ${HUD.line}`,
                  textAlign: "center",
                  opacity: isRecording || isFinalizingRecording ? 0.3 : 1,
                  pointerEvents: isRecording || isFinalizingRecording ? "none" : "auto",
                }}
              >
                导入视频
                <input
                  type="file"
                  disabled={isRecording || isFinalizingRecording}
                  accept="video/webm,video/mp4,video/quicktime,.webm,.mp4,.mov"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void startFile(file);
                    event.currentTarget.value = "";
                  }}
                />
              </label>
              )}
            </div>
            {status === "running" && mode === "camera" && (
              <div style={styles.btnRow}>
                {isRecording ? (
                  <button
                    style={{ ...styles.btn, background: "#7f1d1d", color: "#fee2e2" }}
                    onClick={stopRecording}
                  >
                    ■ 停止并保存本组
                  </button>
                ) : (
                  <button
                    disabled={isFinalizingRecording || trackerReadiness.phase !== "ready"}
                    style={{
                      ...styles.btn,
                      background: HUD.primaryDim,
                      color: "#eafff2",
                      opacity: isFinalizingRecording || trackerReadiness.phase !== "ready" ? 0.45 : 1,
                      cursor: isFinalizingRecording || trackerReadiness.phase !== "ready"
                        ? "not-allowed"
                        : "pointer",
                    }}
                    onClick={startRecording}
                  >
                    {isFinalizingRecording
                      ? "保存中…"
                      : trackerReadiness.phase === "ready"
                        ? "● 开始本组录制"
                        : "等待骨架识别就绪"}
                  </button>
                )}
                {!isRecording && !isFinalizingRecording && (
                  <span style={styles.recordingResultMeta}>
                    预览中，未写入本组数据
                  </span>
                )}
              </div>
            )}
            {isHomeWorkout && (
              <section style={styles.homeRecognitionPanel} aria-label="实时识别反馈">
                <div style={styles.homeRecognitionHeader}>
                  <span>实时识别反馈</span>
                  <span style={{
                    ...styles.homeRecognitionBadge,
                    color: isRecording && trackerReadiness.phase === "ready" ? HUD.primary : HUD.amber,
                    borderColor: isRecording && trackerReadiness.phase === "ready" ? HUD.primaryDim : "#5a4215",
                  }}>
                    {isRecording
                      ? "RECOGNIZING"
                      : status === "running"
                        ? trackerReadiness.phase === "ready" ? "PREVIEW" : "CALIBRATING"
                        : "STANDBY"}
                  </span>
                </div>
                <div style={styles.homeCountRow}>
                  <div style={styles.homeCountPrimary}>
                    <strong style={styles.homeCountValue}>{rustSdkStatus === "ready" ? rustSealedRepCount : "—"}</strong>
                    <span>已识别次数</span>
                  </div>
                  <div style={styles.homeCountSecondary}>
                    <strong style={styles.homeCountSecondaryValue}>{rustNeedsReviewRepCount}</strong>
                    <span>待确认动作</span>
                  </div>
                </div>
                <p style={styles.homeRecognitionMessage}>{homeRecognitionStatus}</p>
                <div style={styles.homeRecognitionFacts}>
                  <span style={styles.homeRecognitionFact}>动作阶段<strong>{isRecording ? HOME_REP_PHASE_LABEL[homeRepPhase] : "未开始"}</strong></span>
                  <span style={styles.homeRecognitionFact}>骨架有效<strong>{trackerReadiness.phase === "ready" ? "是" : "否"}</strong></span>
                  <span style={styles.homeRecognitionFact}>人物锁定<strong>{rustTarget?.state === "locked" ? "是" : "否"}</strong></span>
                  <span style={styles.homeRecognitionFact}>视频录制状态<strong>{isFinalizingRecording ? "正在保存" : isRecording ? "正在录制" : recordingResult ? "已保存" : "未开始"}</strong></span>
                </div>
                {isRecording && rustRejectedRepCount > 0 && (
                  <p style={styles.homeRecognitionNote}>已过滤 {rustRejectedRepCount} 个不完整或干扰动作，不计入正式次数。</p>
                )}
              </section>
            )}
            {!isHomeWorkout && <label style={styles.field}>
              视频库
              <select
                value={selectedLibraryVideoId}
                disabled={isRecording || isFinalizingRecording || videoLibrary.length === 0}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedLibraryVideoId(id);
                  const selected = videoLibrary.find((entry) => entry.id === id);
                  if (selected && applyVideoLibraryContext(selected)) {
                    void startUrl(`/${selected.video}`, selected.label);
                  }
                }}
              >
                <option value="">{videoLibrary.length ? "选择已标注视频…" : "已标注视频库加载中…"}</option>
                {videoLibrary.map((entry) => {
                  const exerciseName = entry.exerciseId
                    ? EXERCISE_REGISTRY.get(entry.exerciseId)?.nameZh ?? entry.exerciseId
                    : "未命名动作";
                  return <option key={entry.id} value={entry.id}>{exerciseName} · {entry.label}</option>;
                })}
              </select>
            </label>}
            {!isHomeWorkout && selectedLibraryVideoNeedsPosition && (
              <p style={styles.agentWarning}>
                此旧档案有动作与 rep 标注，但未保存实际八向机位；请在下方确认机位后再解读质量结果。
              </p>
            )}
            {isRecording && (
              <p style={styles.recordingBadge}>
                ● 正在录制本组 —— 停止本组后自动保存视频、关键点与标注模板
              </p>
            )}
            {isFinalizingRecording && (
              <p style={styles.recordingBadge}>● 正在保存本地采集文件…</p>
            )}
            {recordingResult && !isRecording && (
              <div style={styles.recordingResult}>
                <p style={styles.recordingResultMeta}>
                  视频已保存：{recordingResult.durationSec.toFixed(1)}s · {recordingResult.poseCount} 帧
                </p>
                <p style={styles.recordingResultMeta}>
                  文件只保留在本机；若未自动下载，可点“导出全部”或逐个保存。
                </p>
                <div style={styles.btnRow}>
                  <button
                    style={{ ...styles.btnSmall, background: HUD.primaryDim, color: "#eafff2" }}
                    onClick={() => requestCaptureDownloads(recordingResultFiles(recordingResult))}
                  >
                    ⇩ 导出全部
                  </button>
                  <a
                    href={recordingResult.videoUrl}
                    download={recordingResult.videoName}
                    style={{ ...styles.btnSmall, textDecoration: "none", textAlign: "center" }}
                  >
                    ↓ 下载录制视频
                  </a>
                  <a
                    href={recordingResult.keypointsUrl}
                    download={recordingResult.keypointsName}
                    style={{ ...styles.btnSmall, textDecoration: "none", textAlign: "center" }}
                  >
                    ↓ 关键点(可直接喂 harness)
                  </a>
                  {recordingResult.annotationUrl && recordingResult.annotationName && (
                    <a
                      href={recordingResult.annotationUrl}
                      download={recordingResult.annotationName}
                      style={{ ...styles.btnSmall, textDecoration: "none", textAlign: "center" }}
                    >
                      ↓ rep 标注模板
                    </a>
                  )}
                  <a
                    href={recordingResult.metadataUrl}
                    download={recordingResult.metadataName}
                    style={{ ...styles.btnSmall, textDecoration: "none", textAlign: "center" }}
                  >
                    ↓ 动作元数据
                  </a>
                </div>
              </div>
            )}
            {isConsole && localCaptureError && <p style={styles.agentWarning}>本地采集库：{localCaptureError}</p>}
            {isConsole && localCaptures.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={styles.recordingResultMeta}>
                  本机已保存 {localCaptures.length} 组采集记录
                </summary>
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  {localCaptures.slice(0, 8).map((capture) => (
                    <div key={capture.id} style={styles.recordingResult}>
                      <p style={styles.recordingResultMeta}>
                        {new Date(capture.createdAt).toLocaleString()} · {capture.durationSec.toFixed(1)}s · {capture.poseCount} 帧
                        <br />
                        {capture.exerciseId ?? "未确认动作"} · {capture.analysisStatus === "available" ? "已保存分析" : "仅原始数据"}
                      </p>
                      <div style={styles.btnRow}>
                        <button
                          disabled={capture.analysisStatus !== "available"}
                          style={{ ...styles.btnSmall, opacity: capture.analysisStatus === "available" ? 1 : 0.35 }}
                          onClick={() => void reopenLocalAnalysis(capture.id)}
                        >
                          继续分析
                        </button>
                        <button
                          style={styles.btnSmall}
                          onClick={() => void exportLocalCapture(capture.id)}
                        >
                          导出
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <div
            style={{
              ...styles.sideSection,
              ...(isHomeWorkout ? styles.homeActionOrder : null),
              ...(isHomeWorkout ? { order: selectedHomeWorkout ? 2 : 1 } : null),
            }}
            className="hud-reveal hud-reveal-2"
          >
            <div style={styles.sideTitle}>{isHomeWorkout ? "01 · 选择居家动作" : "02 · 动作配置"}</div>
            {isHomeWorkout ? (
              <>
                <p style={styles.homeActionLead}>选择本轮只识别的动作。四项都要求正面机位、全身入镜。</p>
                <div style={styles.homeActionGrid}>
                  {HOME_WORKOUT_FLOW_ACTIONS.map((action) => {
                    const active = action.id === exerciseChoice;
                    return (
                      <button
                        key={action.id}
                        type="button"
                        aria-pressed={active}
                        disabled={isRecording || isFinalizingRecording}
                        style={{
                          ...styles.homeActionCard,
                          ...(active ? styles.homeActionCardActive : null),
                          opacity: isRecording || isFinalizingRecording ? 0.45 : 1,
                        }}
                        onClick={() => selectExercise(action.id)}
                      >
                        <span style={styles.homeActionIndex}>{action.step}</span>
                        <span style={styles.homeActionCopy}>
                          <strong style={styles.homeActionName}>{action.label}</strong>
                          <span style={styles.homeActionEnglish}>{action.labelEn}</span>
                          <span style={styles.homeActionCue}>{action.cue}</span>
                        </span>
                        <span style={styles.homeActionState}>{active ? "已选择" : "选择"}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={styles.homeLockedContext}>
                  <span>机位</span><strong>正前</strong>
                  <span>空间</span><strong>全身入镜</strong>
                  <span>模式</span><strong>双侧 / 徒手</strong>
                </div>
                {selectedHomeWorkout && (
                  <p style={styles.homeSelectionReady}>
                    READY · 已选择 {selectedHomeWorkout.label}。下一步打开相机，站到全身可见的位置。
                  </p>
                )}
                <div style={styles.telemetryRow}>
                  <span>FPS <strong>{fps}</strong></span>
                  <span>POINTS <strong>{measuredLandmarks.size}/{landmarkTotal}</strong></span>
                  <span>REPS <strong>{rustSealedRepCount}</strong></span>
                </div>
              </>
            ) : (
            <>
            <label style={styles.exerciseField}>
              <span>训练动作</span>
              <select
                style={styles.exerciseSelect}
                value={exerciseChoice}
                disabled={isRecording || isFinalizingRecording}
                onChange={(event) => selectExercise(event.target.value)}
              >
                <option value="">请选择本次训练动作</option>
                {MUSCLE_GROUPS.map((group) => (
                  <optgroup key={group.id} label={`${group.labelZh}部`}>
                    {EXERCISE_REGISTRY.exercises
                      .filter((exercise) => exercise.muscleGroup === group.id)
                      .map((exercise) => (
                        <option key={exercise.id} value={exercise.id}>
                          {exercise.nameZh} · {EXERCISE_MATURITY_LABEL[exercise.maturity]}
                        </option>
                      ))}
                  </optgroup>
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
                  肌群：{MUSCLE_GROUPS.find((group) => group.id === selected.muscleGroup)?.labelZh} · 成熟度：{EXERCISE_MATURITY_LABEL[selected.maturity]}
                  {selected.variationOf
                    ? ` · 变式来源：${EXERCISE_REGISTRY.require(selected.variationOf).nameZh}`
                    : ""}
                </p>
              ) : null;
            })()}
            <div style={styles.captureDetailsRow}>
              <label style={styles.exerciseField}>
                <span>变式 / 器械</span>
                <input
                  style={styles.exerciseSelect}
                  value={variation}
                  disabled={isRecording || isFinalizingRecording}
                  onChange={(event) => {
                    const next = event.target.value;
                    variationRef.current = next;
                    setVariation(next);
                    if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
                      configureRustExerciseProfile(
                        canonicalSessionRef.current,
                        exerciseChoiceRef.current,
                        capturePositionRef.current,
                        trainingSideRef.current,
                        next,
                        modelPathRef.current,
                      );
                      rustSealedRepsRef.current = [];
                      rustNeedsReviewRepsRef.current = [];
                      rustRejectedRepsRef.current = [];
                      setRustSealedRepCount(0);
                      setRustNeedsReviewRepCount(0);
                      setRustRejectedRepCount(0);
                    }
                  }}
                  placeholder="例如：哑铃、单臂、宽握"
                />
              </label>
              <label style={styles.exerciseField}>
                <span>侧别</span>
                <select
                  style={styles.exerciseSelect}
                  value={trainingSide}
                  disabled={isRecording || isFinalizingRecording}
                  onChange={(event) => {
                    const next = event.target.value as TrainingSide;
                    trainingSideRef.current = next;
                    setTrainingSide(next);
                    if (canonicalSessionRef.current instanceof RustCanonicalWasmSession) {
                      configureRustExerciseProfile(
                        canonicalSessionRef.current,
                        exerciseChoiceRef.current,
                        capturePositionRef.current,
                        next,
                        variationRef.current,
                        modelPathRef.current,
                      );
                      rustSealedRepsRef.current = [];
                      rustNeedsReviewRepsRef.current = [];
                      rustRejectedRepsRef.current = [];
                      setRustSealedRepCount(0);
                      setRustNeedsReviewRepCount(0);
                      setRustRejectedRepCount(0);
                    }
                  }}
                >
                  <option value="bilateral">双侧 / 同步</option>
                  <option value="left">左侧</option>
                  <option value="right">右侧</option>
                </select>
              </label>
            </div>
            <div style={styles.subsectionLabel}>拍摄机位</div>
            <div style={styles.btnRow}>
              {CAPTURE_POSITIONS.map((position) => (
                <button
                  key={position.id}
                  disabled={isRecording || isFinalizingRecording}
                  style={{
                    ...styles.btnSmall,
                    ...(capturePosition === position.id ? styles.btnSmallActiveAmber : null),
                  }}
                  onClick={() => {
                    applyCapturePosition(position.id);
                  }}
                >
                  {position.label}
                </button>
              ))}
            </div>
            <p style={styles.guidance}>
              {CAPTURE_POSITIONS.find((position) => position.id === capturePosition)?.guidance}
            </p>
            {exerciseChoice && exerciseChoice !== "auto" && recommendCapturePosition(exerciseChoice) && (
              <p style={styles.recommendation}>
                已按 {EXERCISE_REGISTRY.require(exerciseChoice).nameZh} 自动推荐：{CAPTURE_POSITIONS.find((position) => position.id === recommendCapturePosition(exerciseChoice)?.position)?.label} · {recommendCapturePosition(exerciseChoice)?.reason}
              </p>
            )}
            <div style={styles.telemetryRow}>
              <span>FPS <strong>{fps}</strong></span>
              <span>POINTS <strong>{measuredLandmarks.size}/{landmarkTotal}</strong></span>
              <span>LEAN <strong>{torsoLean === null ? "—" : `${torsoLean.toFixed(0)}°`}</strong></span>
            </div>
            </>
            )}
          </div>

          {isConsole && (
          <div style={styles.sideSection} className="hud-reveal hud-reveal-3">
            <div style={styles.sideTitle}>03 · 模型选择</div>
            <div style={styles.btnRow}>
              {ENGINE_KINDS.map((engine) => (
                <button
                  key={engine.id}
                  disabled={isRecording || engine.id !== "mediapipe"}
                  title={engine.id !== "mediapipe"
                    ? "Rust 正式链尚未支持 COCO17 索引，避免静默误识别"
                    : undefined}
                  style={{
                    ...styles.btnSmall,
                    ...(engineKind === engine.id ? styles.btnSmallActive : null),
                    opacity: isRecording || engine.id !== "mediapipe" ? 0.3 : 1,
                  }}
                  onClick={() => void switchEngine(engine.id)}
                >
                  {engine.label}
                </button>
              ))}
            </div>
            <div style={styles.btnRow}>
              {POSE_MODELS.map((model) => {
                const disabled = engineKind !== "mediapipe" || isRecording || modelLoading;
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
          )}

          {isConsole && (() => {
            const latest = motionDiagnosticsRef.current.at(-1);
            const performanceSummary = summarizeMotionPerformance(motionDiagnosticsRef.current);
            const activePerformance = performanceSummary.full.frameCount > 0
              ? performanceSummary.full
              : performanceSummary.normal;
            const events = motionDiagnosticsRef.current
              .filter((frame) =>
                frame.unknown > 0
                || frame.tsRustFirstSourceDivergence !== null
                || (frame.target !== null && frame.target.state !== "locked")
                || frame.completedRepCount > 0,
              )
              .slice(-8)
              .reverse();
            return (
              <div style={styles.sideSection} key={diagnosticsVersion}>
                <div style={styles.sideTitle}>04 · Rust 错误分析</div>
                <div style={styles.telemetryRow}>
                  <span>TARGET <strong>{latest?.target?.state ?? "—"}</strong></span>
                  <span>CANDIDATES <strong>{latest?.target?.candidateCount ?? 0}</strong></span>
                  <span>EPOCH <strong>{latest?.target?.subjectEpoch.toString() ?? "0"}</strong></span>
                </div>
                <div style={styles.telemetryRow}>
                  <span>MEASURED <strong>{latest?.measured ?? 0}</strong></span>
                  <span>FUSED <strong>{latest?.fused ?? 0}</strong></span>
                  <span>PREDICTED <strong>{latest?.predicted ?? 0}</strong></span>
                  <span>UNKNOWN <strong>{latest?.unknown ?? 0}</strong></span>
                  <span>PHASE <strong>{latest?.repPhase ?? "—"}</strong></span>
                  <span>REPS <strong>{latest?.sealedRepCount ?? 0}</strong></span>
                  <span>TS/RUST Δ <strong>{latest?.tsRustMaxCoordinateDelta?.toFixed(4) ?? "—"}</strong></span>
                </div>
                <p style={styles.catalogMeta}>
                  {latest?.algorithmVersion ?? "等待帧"} · {latest?.schedulerDecision ?? "—"} · MediaPipe {latest?.inferenceMs ?? 0}ms · Rust {latest?.rustCoreMs ?? 0}ms · decode {latest?.decodeMs ?? 0}ms · route {latest?.routeMs ?? 0}ms
                  <br />P95 MediaPipe {activePerformance.inferenceMsP95?.toFixed(1) ?? "—"}ms / Rust {activePerformance.rustCoreMsP95?.toFixed(2) ?? "—"}ms / decode {activePerformance.decodeMsP95?.toFixed(2) ?? "—"}ms · age {activePerformance.packetAgeMsP95?.toFixed(1) ?? "—"}ms · drop {activePerformance.droppedFrames}
                  <br />PROFILE {latest?.activeProfile ?? "none"} · provisional
                  <br />REFERENCE {referenceComparison.status} · {referenceComparison.reason ?? "descriptive evidence"} · verdict null
                  <br />SIMULATED BASELINE {simulatedBaselineComparison.status} · descriptive only · verdict null
                </p>
                {referenceComparison.status !== "unavailable" && (
                  <div style={styles.catalogMeta}>
                    <div>
                      REF REP {referenceComparison.repId.toString()} r{referenceComparison.repRevision}
                      {` · slice ${referenceComparison.canonicalSliceHash.toString()} · profile ${referenceComparison.profileHash.toString()}`}
                    </div>
                    {referenceComparison.features.map((feature) => (
                      <div key={feature.feature}>
                        {feature.feature}: comparable {feature.comparableNodeCount}
                        {` · unknown ${feature.unknownNodeCount} · outside ${feature.outsideNodeCount}`}
                        {` · max-run ${feature.maximumConsecutiveOutsideNodes}`}
                      </div>
                    ))}
                  </div>
                )}
                {simulatedBaselineComparison.status !== "unavailable" && (
                  <div style={styles.catalogMeta}>
                    <div>
                      SIMULATED REP {simulatedBaselineComparison.repId.toString()} r{simulatedBaselineComparison.repRevision}
                      {` · slice ${simulatedBaselineComparison.canonicalSliceHash.toString()} · profile ${simulatedBaselineComparison.profileHash.toString()}`}
                    </div>
                    {simulatedBaselineComparison.features.map((feature) => (
                      <div key={feature.feature}>
                        {feature.feature}: comparable {feature.comparableNodeCount}
                        {` · unknown ${feature.unknownNodeCount} · outside ${feature.outsideNodeCount}`}
                        {` · max-run ${feature.maximumConsecutiveOutsideNodes}`}
                      </div>
                    ))}
                  </div>
                )}
                <div style={styles.catalogMeta}>
                  <div>QUALITY EVIDENCE · descriptive only · no score</div>
                  {currentReferenceQualityEvidence.map((card) => (
                    <div key={card.id}>
                      {card.title} · {card.status}
                      <br />{card.detail}
                      <br />{card.evidence}
                    </div>
                  ))}
                </div>
                {rustReferenceEvidenceRef.current.length > 0 && (
                  <div style={styles.catalogMeta} key={referenceEvidenceVersion}>
                    SAVED REFERENCE EVIDENCE {rustReferenceEvidenceRef.current.length}
                    {rustReferenceEvidenceRef.current.slice(-5).reverse().map((record) => (
                      <div key={`${record.subjectEpoch}:${record.comparison.repId}:${record.comparison.repRevision}`}>
                        epoch {record.subjectEpoch.toString()} · rep {record.comparison.repId.toString()}
                        {` r${record.comparison.repRevision} · ${record.comparison.status}`}
                      </div>
                    ))}
                  </div>
                )}
                {latest?.candidates.map((candidate) => (
                  <p key={candidate.candidateId} style={styles.catalogMeta}>
                    C{candidate.candidateId}{candidate.selected ? " · SELECTED" : ""} · bbox [{candidate.bbox.x.toFixed(2)}, {candidate.bbox.y.toFixed(2)}, {candidate.bbox.width.toFixed(2)}, {candidate.bbox.height.toFixed(2)}]
                    {` · dominance ${candidate.dominanceScore.toFixed(3)} · continuity ${candidate.continuityCost?.toFixed(3) ?? "n/a"}`}
                    <br />{candidate.decision} · landmarks {candidate.continuityComponents.landmarks?.toFixed(3) ?? "n/a"} / center {candidate.continuityComponents.center?.toFixed(3) ?? "n/a"} / color {candidate.continuityComponents.color?.toFixed(3) ?? "n/a"} · switch {candidate.switchThreshold.toFixed(2)} / {candidate.switchConfirmMs.toFixed(0)}ms
                  </p>
                ))}
                {latest && latest.landmarkIssues.length > 0 && (
                  <p style={styles.catalogMeta}>
                    JOINTS {latest.landmarkIssues.slice(0, 12).map((joint) =>
                      `J${joint.index}:${joint.source}/${joint.reason ?? "none"}/${joint.uncertainty?.toFixed(3) ?? "n/a"}`,
                    ).join(" · ")}
                    {latest.landmarkIssues.length > 12 ? ` · +${latest.landmarkIssues.length - 12}` : ""}
                  </p>
                )}
                <div style={styles.btnRow}>
                  {events.map((frame) => (
                    <button
                      key={`${frame.frameId}:${frame.timestampMs}`}
                      type="button"
                      style={styles.btnSmall}
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = frame.timestampMs / 1000;
                      }}
                    >
                      {(frame.timestampMs / 1000).toFixed(1)}s · {frame.target?.state ?? "frame"}
                      {frame.unknown ? ` · U${frame.unknown}` : ""}
                      {frame.tsRustFirstSourceDivergence !== null
                        ? ` · ΔJ${frame.tsRustFirstSourceDivergence}`
                        : ""}
                      {frame.completedRepIds.length > 0 ? ` · S${frame.completedRepIds.join(",")}` : ""}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  style={styles.btnSmall}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify({
                      schemaVersion: "form-coach-motion-diagnostics/v1",
                      exportedAt: new Date().toISOString(),
                      performance: summarizeMotionPerformance(motionDiagnosticsRef.current),
                      staleInferenceCompletions: staleCompletionDiagnosticsRef.current,
                      frames: motionDiagnosticsRef.current,
                    }, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    requestCaptureDownloads([{ url, name: `motion-diagnostics-${Date.now()}.json` }]);
                    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
                  }}
                >
                  导出诊断
                </button>
              </div>
            );
          })()}

          {isConsole && <button
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
          </button>}

          {error && <p style={styles.errorText}>{error}</p>}

          {isConsole && (
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
          )}
        </aside>
      </div>
        </>
      )}
      {hasVisitedReview && (
        <div style={{ display: isReview ? "block" : "none" }} aria-hidden={!isReview}>
          <div style={styles.reviewPage}>
            <CaptureApprovalPanel compact />
          </div>
        </div>
      )}
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
  const openMappedId = open
    ? EXERCISE_REGISTRY.matchText(`${open.name} ${open.nameEn}`)?.id ?? null
    : null;
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
  reviewRoot: { overflow: "auto" },
  reviewPage: { width: "min(1180px, 100%)", margin: "0 auto", padding: "18px 22px 34px", boxSizing: "border-box" },
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
  pageSwitch: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: 3,
    border: `1px solid ${HUD.line}`,
    background: "#08100b",
  },
  pageSwitchButton: {
    border: "none",
    background: "transparent",
    color: HUD.dim,
    cursor: "pointer",
    padding: "7px 10px",
    fontFamily: HUD.mono,
    fontSize: 11,
    letterSpacing: 1,
  },
  pageSwitchButtonActive: {
    background: HUD.primaryDim,
    color: "#eafff2",
  },
  pageSwitchButtonActiveHome: {
    background: "#6b470d",
    color: "#fff1cd",
    boxShadow: `inset 0 0 0 1px ${HUD.amber}66`,
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
  homeFlowRail: {
    display: "grid",
    gridTemplateColumns: "minmax(230px, 1.4fr) repeat(3, minmax(105px, .55fr))",
    alignItems: "stretch",
    gap: 1,
    flexShrink: 0,
    border: `1px solid ${HUD.line}`,
    background: HUD.line,
  },
  homeFlowIntro: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    padding: "11px 14px",
    background: "#0c130e",
  },
  homeFlowEyebrow: {
    color: HUD.amber,
    fontSize: 8,
    letterSpacing: 1.5,
  },
  homeFlowTitle: {
    color: HUD.text,
    fontSize: 14,
    letterSpacing: 0.4,
  },
  homeFlowStep: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "10px 8px",
    background: HUD.panel,
    color: HUD.dim,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  homeFlowStepActive: {
    background: "rgba(255, 178, 36, .10)",
    color: "#ffe6b3",
  },
  homeFlowStepDone: {
    color: HUD.primary,
  },
  homeFlowStepIndex: {
    display: "inline-flex",
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${HUD.lineBright}`,
    color: "inherit",
    fontWeight: 700,
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
  trackerStageNotice: {
    position: "absolute",
    left: "50%",
    bottom: 22,
    zIndex: 5,
    display: "flex",
    width: "min(520px, calc(100% - 36px))",
    boxSizing: "border-box",
    transform: "translateX(-50%)",
    flexDirection: "column",
    gap: 5,
    padding: "12px 15px",
    border: `1px solid ${HUD.lineBright}`,
    background: "rgba(5, 12, 8, .92)",
    color: HUD.dim,
    fontSize: 11,
    lineHeight: 1.5,
    textAlign: "center",
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
  trainingReadout: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1.15fr) repeat(3, minmax(110px, .55fr))",
    gap: 14,
    alignItems: "center",
    background: "#09120d",
    border: `1px solid ${HUD.primaryDim}`,
    padding: 16,
  },
  trainingStats: {
    display: "contents",
  },
  trainingStat: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
    color: HUD.dim,
    fontSize: 10,
    letterSpacing: 1,
  },
  trainingStatValue: {
    overflow: "hidden",
    color: HUD.primary,
    fontFamily: HUD.mono,
    fontSize: 18,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  trainingHint: {
    gridColumn: "1 / -1",
    margin: 0,
    paddingTop: 10,
    borderTop: `1px solid ${HUD.line}`,
    color: HUD.dim,
    fontSize: 11,
    lineHeight: 1.55,
  },
  trainingScore: {
    gridColumn: "1 / -1",
    margin: 0,
    color: HUD.primary,
    fontSize: 13,
    fontFamily: HUD.mono,
    fontWeight: 700,
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
  homeActionOrder: { order: 1, borderColor: "#5a4215" },
  homeCaptureOrder: { order: 2 },
  sideTitle: {
    fontSize: 10,
    letterSpacing: 2,
    color: HUD.dim,
    marginBottom: 10,
    fontWeight: 600,
  },
  trackerReadinessPanel: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    gap: 9,
    alignItems: "start",
    marginBottom: 10,
    padding: "9px 10px",
    border: "1px solid",
    background: "rgba(5, 12, 8, .72)",
  },
  trackerReadinessDot: {
    width: 7,
    height: 7,
    marginTop: 4,
    borderRadius: "50%",
  },
  trackerReadinessCopy: {
    display: "flex",
    minWidth: 0,
    flexDirection: "column",
    gap: 3,
    fontSize: 10,
    letterSpacing: 0.6,
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
  homeActionLead: {
    margin: "-2px 0 10px",
    color: HUD.dim,
    fontSize: 11,
    lineHeight: 1.6,
  },
  homeActionGrid: {
    display: "grid",
    gap: 7,
  },
  homeActionCard: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 9,
    padding: "10px 9px",
    border: `1px solid ${HUD.line}`,
    background: "#09100c",
    color: HUD.text,
    textAlign: "left",
    cursor: "pointer",
    fontFamily: HUD.mono,
  },
  homeActionCardActive: {
    borderColor: HUD.amber,
    background: "linear-gradient(90deg, rgba(255, 178, 36, .15), rgba(255, 178, 36, .03))",
    boxShadow: "inset 3px 0 0 #ffb224",
  },
  homeActionIndex: {
    color: HUD.amber,
    fontSize: 11,
    letterSpacing: 1,
  },
  homeActionCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  homeActionName: { color: HUD.text, fontSize: 13 },
  homeActionEnglish: { color: HUD.dim, fontSize: 8, letterSpacing: 1.5 },
  homeActionCue: { color: HUD.dim, fontSize: 9, lineHeight: 1.45, marginTop: 3 },
  homeActionState: {
    color: HUD.amber,
    border: "1px solid #5a4215",
    padding: "4px 6px",
    fontSize: 9,
    whiteSpace: "nowrap",
  },
  homeLockedContext: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "5px 10px",
    marginTop: 10,
    padding: 9,
    border: `1px solid ${HUD.line}`,
    color: HUD.dim,
    fontSize: 9,
    letterSpacing: 0.8,
  },
  homeSelectionReady: {
    margin: "9px 0 0",
    padding: "8px 9px",
    borderLeft: `2px solid ${HUD.primary}`,
    background: "rgba(87, 255, 142, .06)",
    color: HUD.primary,
    fontSize: 10,
    lineHeight: 1.55,
  },
  homeRecognitionPanel: {
    marginTop: 10,
    padding: 11,
    border: `1px solid ${HUD.lineBright}`,
    background: "#07100a",
  },
  homeRecognitionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    color: HUD.text,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.2,
  },
  homeRecognitionBadge: {
    border: "1px solid",
    padding: "3px 5px",
    fontSize: 8,
    letterSpacing: 1,
  },
  homeCountRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, .65fr)",
    gap: 8,
    marginTop: 10,
  },
  homeCountPrimary: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: "9px 11px",
    borderLeft: `3px solid ${HUD.primary}`,
    background: "rgba(87, 255, 142, .06)",
    color: HUD.dim,
    fontSize: 9,
    letterSpacing: 1,
  },
  homeCountSecondary: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    padding: "9px 10px",
    borderLeft: `2px solid ${HUD.amber}`,
    background: "rgba(255, 178, 36, .05)",
    color: HUD.dim,
    fontSize: 9,
    letterSpacing: 0.7,
  },
  homeCountValue: {
    color: HUD.primary,
    fontFamily: HUD.mono,
    fontSize: 32,
    lineHeight: 1,
  },
  homeCountSecondaryValue: {
    color: HUD.amber,
    fontFamily: HUD.mono,
    fontSize: 20,
    lineHeight: 1.2,
  },
  homeRecognitionMessage: {
    margin: "9px 0 0",
    color: HUD.primary,
    fontSize: 11,
    lineHeight: 1.5,
  },
  homeRecognitionFacts: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 5,
    marginTop: 9,
  },
  homeRecognitionFact: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
    paddingTop: 6,
    borderTop: `1px solid ${HUD.line}`,
    color: HUD.dim,
    fontSize: 8,
    lineHeight: 1.35,
  },
  homeRecognitionNote: {
    margin: "8px 0 0",
    color: HUD.amber,
    fontSize: 9,
    lineHeight: 1.5,
  },
  captureDetailsRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, .9fr)",
    gap: 8,
  },
  catalogMeta: {
    margin: "-5px 0 12px",
    color: HUD.dim,
    fontFamily: HUD.mono,
    fontSize: 10,
    lineHeight: 1.6,
  },
  recommendation: {
    margin: "-4px 0 12px",
    padding: "7px 8px",
    borderLeft: `2px solid ${HUD.amber}`,
    background: "rgba(255, 181, 67, .07)",
    color: HUD.amber,
    fontFamily: HUD.mono,
    fontSize: 10,
    lineHeight: 1.55,
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
