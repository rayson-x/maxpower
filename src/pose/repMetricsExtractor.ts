/**
 * 逐 rep 指标提取器:把关键点序列变成 formRuleEngine 能直接打分的具名观测值。
 *
 * 本模块只做测量,不做判断——它唯一的价值判断是"这个数值有多可信",
 * 任何"这算不算错"的阈值都不在这里,归 formRuleEngine 所有。
 *
 * 契约(RuleEngineRepMetrics / MetricObservation)以 formRuleEngine.ts 为权威来源,
 * 本模块负责适配它,而不是定义一套新的。
 */

import {
  EXPERIMENTAL_THRESHOLDS_V1,
  RULE_JOINT,
  RULE_METRIC,
  type CameraView,
  type ExerciseSelection,
  type MetricObservation,
  type MetricUnit,
  type PhaseMeaning,
  type RuleEngineContext,
  type RuleEngineRepMetrics,
  type RuleExerciseId,
  type RuleJointId,
  type RuleMetricKey,
} from "./formRuleEngine";
import type { PoseEstimate, PoseLandmark } from "./PoseEngine";
import type { KinematicsProfile } from "./kinematicsProfile";
import {
  AUTO_SIGNAL_JOINTS,
  EXERCISE_SIGNAL,
  SIGNAL_JOINTS,
  segmentReps,
  segmentRepsBySignal,
  segmentRepsAuto,
  type AutoSignalKind,
  type ExerciseId,
  type LogicalJoint,
  type RepCycle,
  type RepSegment,
  type SignalKind,
} from "./repSegmenter";
import {
  detectTopology,
  JOINT_INDEX,
  robustRange,
  torsoAngleSeries,
  torsoScale,
  type JointIndex,
  type Topology,
} from "./trajectory";

const VISIBILITY_THRESHOLD = 0.5;

// ---------- 关节命名的两次翻译 ----------
// repSegmenter 用不分侧的逻辑名(LogicalJoint);trajectory 的 JointIndex 用侧向具体键(shoulderL/R);
// formRuleEngine 用侧向具体的 RuleJointId(leftShoulder/rightShoulder)。这里桥接三者。

const LOGICAL_TO_RULE_JOINT: Record<LogicalJoint, { left: RuleJointId; right: RuleJointId }> = {
  shoulder: { left: RULE_JOINT.leftShoulder, right: RULE_JOINT.rightShoulder },
  elbow: { left: RULE_JOINT.leftElbow, right: RULE_JOINT.rightElbow },
  wrist: { left: RULE_JOINT.leftWrist, right: RULE_JOINT.rightWrist },
  hip: { left: RULE_JOINT.leftHip, right: RULE_JOINT.rightHip },
  knee: { left: RULE_JOINT.leftKnee, right: RULE_JOINT.rightKnee },
  ankle: { left: RULE_JOINT.leftAnkle, right: RULE_JOINT.rightAnkle },
};

const LOGICAL_TO_INDEX_KEY: Record<LogicalJoint, { left: keyof JointIndex; right: keyof JointIndex }> = {
  shoulder: { left: "shoulderL", right: "shoulderR" },
  elbow: { left: "elbowL", right: "elbowR" },
  wrist: { left: "wristL", right: "wristR" },
  hip: { left: "hipL", right: "hipR" },
  knee: { left: "kneeL", right: "kneeR" },
  ankle: { left: "ankleL", right: "ankleR" },
};

// ---------- 逐关节可信度 ----------

interface JointQuality {
  requiredJoints: RuleJointId[];
  jointVisibility: Partial<Record<RuleJointId, number>>;
  confidence: number;
  usableFrameRatio: number;
}

/** 缺失关键点等同于可见度 0,分母始终是窗口内的总帧数(不是"有数据的帧数")。 */
function jointMeanVisibility(windowPoses: readonly PoseEstimate[], landmarkIndex: number): number {
  if (windowPoses.length === 0) return 0;
  const total = windowPoses.reduce(
    (sum, p) => sum + (p.landmarks[landmarkIndex]?.visibility ?? 0),
    0,
  );
  return total / windowPoses.length;
}

function frameUsableRatio(windowPoses: readonly PoseEstimate[], landmarkIndices: number[]): number {
  if (windowPoses.length === 0) return 0;
  const usable = windowPoses.filter((p) =>
    landmarkIndices.every((i) => (p.landmarks[i]?.visibility ?? 0) >= VISIBILITY_THRESHOLD),
  ).length;
  return usable / windowPoses.length;
}

/**
 * 挑"更可信的一侧",只报告那一侧的关节。
 *
 * 这是对 repSegmenter 内部按帧挑侧(bestSide)的一个简化近似:这里按整个 rep 窗口
 * 的平均可见度一次性选侧,而不是逐帧跟随。选择这个方向是刻意的——它比"要求两侧
 * 都可见"更宽松,不会让一个本来靠单侧数据就能可靠计算的指标被另一侧的遮挡拖累拒答。
 * 副作用是相对逐帧选侧的真实实现,这里报告的可信度是更乐观的上界。
 */
function resolveBestSideQuality(
  logicalJoints: readonly LogicalJoint[],
  windowPoses: readonly PoseEstimate[],
  idx: JointIndex,
  evidenceSide?: "left" | "right",
): JointQuality {
  const meansForSide = (side: "left" | "right") =>
    logicalJoints.map((joint) =>
      jointMeanVisibility(windowPoses, idx[LOGICAL_TO_INDEX_KEY[joint][side]]),
    );

  const leftMeans = meansForSide("left");
  const rightMeans = meansForSide("right");
  const leftScore = leftMeans.length ? Math.min(...leftMeans) : 0;
  const rightScore = rightMeans.length ? Math.min(...rightMeans) : 0;
  const useRight = evidenceSide ? evidenceSide === "right" : rightScore > leftScore;
  const chosenMeans = useRight ? rightMeans : leftMeans;
  const side: "left" | "right" = useRight ? "right" : "left";

  const requiredJoints = logicalJoints.map((joint) => LOGICAL_TO_RULE_JOINT[joint][side]);
  const jointVisibility: Partial<Record<RuleJointId, number>> = {};
  requiredJoints.forEach((ruleJoint, i) => {
    jointVisibility[ruleJoint] = chosenMeans[i];
  });
  const landmarkIndices = logicalJoints.map((joint) => idx[LOGICAL_TO_INDEX_KEY[joint][side]]);

  return {
    requiredJoints,
    jointVisibility,
    confidence: chosenMeans.length ? Math.min(...chosenMeans) : 0,
    usableFrameRatio: frameUsableRatio(windowPoses, landmarkIndices),
  };
}

/** 两侧都是必需的(左右对称性天生就需要两侧同时在场),不做择优。 */
function resolveBilateralQuality(
  logicalJoint: LogicalJoint,
  windowPoses: readonly PoseEstimate[],
  idx: JointIndex,
): JointQuality {
  const leftRuleJoint = LOGICAL_TO_RULE_JOINT[logicalJoint].left;
  const rightRuleJoint = LOGICAL_TO_RULE_JOINT[logicalJoint].right;
  const leftIndex = idx[LOGICAL_TO_INDEX_KEY[logicalJoint].left];
  const rightIndex = idx[LOGICAL_TO_INDEX_KEY[logicalJoint].right];
  const leftVis = jointMeanVisibility(windowPoses, leftIndex);
  const rightVis = jointMeanVisibility(windowPoses, rightIndex);

  return {
    requiredJoints: [leftRuleJoint, rightRuleJoint],
    jointVisibility: { [leftRuleJoint]: leftVis, [rightRuleJoint]: rightVis },
    confidence: Math.min(leftVis, rightVis),
    usableFrameRatio: frameUsableRatio(windowPoses, [leftIndex, rightIndex]),
  };
}

function toObservation(
  value: number | null,
  unit: MetricUnit,
  quality: JointQuality,
  refusalReason: string,
): MetricObservation {
  const observation: MetricObservation = {
    value,
    unit,
    confidence: quality.confidence,
    usableFrameRatio: quality.usableFrameRatio,
    requiredJoints: quality.requiredJoints,
    jointVisibility: quality.jointVisibility,
  };
  if (value === null) observation.refusalReason = refusalReason;
  return observation;
}

// ---------- 指标计算 ----------

function meanTorsoScale(windowPoses: readonly PoseEstimate[], idx: JointIndex): number | null {
  const scales = windowPoses
    .map((p) => torsoScale(p.landmarks, idx))
    .filter((s): s is number => s !== null);
  if (scales.length === 0) return null;
  return scales.reduce((a, b) => a + b, 0) / scales.length;
}

function computeTorsoDriftDeg(windowPoses: readonly PoseEstimate[], idx: JointIndex): number | null {
  const series = torsoAngleSeries(windowPoses as PoseEstimate[], idx);
  if (series.length < 2) return null;
  return robustRange(series).range;
}

function wristMotionMagnitude(
  windowPoses: readonly PoseEstimate[],
  wristIndex: number,
  scale: number,
): number | null {
  const points = windowPoses
    .map((p) => p.landmarks[wristIndex])
    .filter((l): l is PoseLandmark => !!l && l.visibility >= VISIBILITY_THRESHOLD);
  if (points.length < 3 || scale <= 0) return null;
  const rangeX = robustRange(points.map((l) => l.x)).range;
  const rangeY = robustRange(points.map((l) => l.y)).range;
  return Math.hypot(rangeX, rangeY) / scale;
}

function computeBilateralAsymmetryRatio(
  windowPoses: readonly PoseEstimate[],
  idx: JointIndex,
): number | null {
  const scale = meanTorsoScale(windowPoses, idx);
  if (scale === null) return null;
  const left = wristMotionMagnitude(windowPoses, idx.wristL, scale);
  const right = wristMotionMagnitude(windowPoses, idx.wristR, scale);
  if (left === null || right === null) return null;
  const maxMotion = Math.max(left, right);
  if (maxMotion < 1e-6) return 0;
  return Math.abs(left - right) / maxMotion;
}

// ---------- rep 边界归一化(已知动作 vs 自动分期两条来源统一形状) ----------

interface NormalizedCycle {
  repIndex: number;
  startMs: number;
  extremeMs: number;
  endMs: number;
  amplitude: number;
  evidenceSide?: "left" | "right";
}

function fromKnownSegments(segments: readonly RepSegment[]): NormalizedCycle[] {
  return segments.map((s) => ({
    repIndex: s.repIndex,
    startMs: s.startMs,
    extremeMs: s.peakMs,
    endMs: s.endMs,
    amplitude: s.amplitude,
    evidenceSide: s.evidenceSide,
  }));
}

function fromAutoCycles(cycles: readonly RepCycle[]): NormalizedCycle[] {
  return cycles.map((c) => ({
    repIndex: c.index,
    startMs: c.startMs,
    extremeMs: c.extremeMs,
    endMs: c.endMs,
    amplitude: c.amplitude,
  }));
}

function buildRepMetrics(
  cycle: NormalizedCycle,
  poses: readonly PoseEstimate[],
  idx: JointIndex,
  primaryJoints: readonly LogicalJoint[],
  phaseSemantics: { toExtreme: PhaseMeaning; fromExtreme: PhaseMeaning },
): RuleEngineRepMetrics {
  const windowPoses = poses.filter(
    (p) => p.timestampMs >= cycle.startMs && p.timestampMs <= cycle.endMs,
  );

  const primaryQuality = resolveBestSideQuality(
    primaryJoints,
    windowPoses,
    idx,
    cycle.evidenceSide,
  );
  const torsoQuality = resolveBestSideQuality(["shoulder", "hip"], windowPoses, idx);
  const wristQuality = resolveBilateralQuality("wrist", windowPoses, idx);

  const metrics: Partial<Record<RuleMetricKey, MetricObservation>> = {
    [RULE_METRIC.amplitude]: toObservation(cycle.amplitude, "normalized", primaryQuality, "无法计算幅度"),
    [RULE_METRIC.toExtremeMs]: toObservation(
      cycle.extremeMs - cycle.startMs,
      "ms",
      primaryQuality,
      "无法计算到极点耗时",
    ),
    [RULE_METRIC.fromExtremeMs]: toObservation(
      cycle.endMs - cycle.extremeMs,
      "ms",
      primaryQuality,
      "无法计算自极点耗时",
    ),
    [RULE_METRIC.torsoDriftDeg]: toObservation(
      computeTorsoDriftDeg(windowPoses, idx),
      "deg",
      torsoQuality,
      "肩、髋关键点不足以计算躯干角度",
    ),
    [RULE_METRIC.bilateralAsymmetryRatio]: toObservation(
      computeBilateralAsymmetryRatio(windowPoses, idx),
      "ratio",
      wristQuality,
      "手腕轨迹或躯干尺度不足以计算左右不对称",
    ),
  };

  return {
    repIndex: cycle.repIndex,
    startMs: cycle.startMs,
    extremeMs: cycle.extremeMs,
    endMs: cycle.endMs,
    metrics,
    phaseSemantics,
  };
}

// ---------- 动作模式判定 ----------

/**
 * 用户选定动作时,方向恒已知。自动识别时,只有置信度达到(与规则引擎同一个)门槛
 * 才当作已知——否则宁可退回"不知道是哪个动作",也不要在方向上蒙对了算数、蒙错了
 * 污染判定。门槛复用 formRuleEngine 已冻结的阈值,不在这里另定一份,避免两处判断
 * 各自漂移出不一致的行为。
 */
function resolveKnownExercise(
  exercise: ExerciseSelection,
  minAutoExerciseConfidence: number,
): RuleExerciseId | null {
  if (exercise.mode === "user") return exercise.exerciseId;
  if (
    exercise.exerciseId &&
    Number.isFinite(exercise.confidence) &&
    exercise.confidence >= minAutoExerciseConfidence
  ) {
    return exercise.exerciseId;
  }
  return null;
}

export interface RepMetricsExtractionOptions {
  cameraView: CameraView;
  exercise: ExerciseSelection;
  profile?: KinematicsProfile;
}

export interface RepMetricsExtraction {
  context: RuleEngineContext;
  reps: RuleEngineRepMetrics[];
  /** 分期实际用的信号,供界面/离线回放展示"选中了哪个信号"。分期失败时为 null。 */
  signal: SignalKind | AutoSignalKind | null;
}

/**
 * 关键点序列 → 可直接喂 formRuleEngine.scoreFormSet() 的逐 rep 观测值。
 *
 * 动作已知(用户选定,或自动识别且置信度达标)时用 segmentReps(),相位方向确定;
 * 否则用 segmentRepsAuto(),相位方向恒为 unknown——两条路径产出的形状完全一致,
 * 下游不需要为两种模式分别写分支。
 */
export function extractRepMetrics(
  poses: PoseEstimate[],
  options: RepMetricsExtractionOptions,
): RepMetricsExtraction {
  const context: RuleEngineContext = { cameraView: options.cameraView, exercise: options.exercise };
  const topology: Topology | null = detectTopology(poses);
  if (!topology) return { context, reps: [], signal: null };
  const idx = JOINT_INDEX[topology];

  const knownExercise = resolveKnownExercise(
    options.exercise,
    EXPERIMENTAL_THRESHOLDS_V1.minAutoExerciseConfidence,
  );

  if (knownExercise) {
    const exerciseId = knownExercise as ExerciseId;
    const signal = options.profile?.phaseSignal.kind ?? EXERCISE_SIGNAL[exerciseId];
    const segments = options.profile
      ? segmentRepsBySignal(poses, signal, options.profile.phaseSignal.effortExtreme)
      : segmentReps(poses, exerciseId);
    const phaseSemantics = options.profile
      ? {
          toExtreme: options.profile.phaseSignal.toExtreme,
          fromExtreme: options.profile.phaseSignal.fromExtreme,
        }
      : { toExtreme: "concentric" as const, fromExtreme: "eccentric" as const };
    const primaryJoints = options.profile?.metrics.amplitude.joints ?? SIGNAL_JOINTS[signal];
    const reps = fromKnownSegments(segments).map((cycle) =>
      buildRepMetrics(cycle, poses, idx, primaryJoints, phaseSemantics),
    );
    return { context, reps, signal };
  }

  const auto = segmentRepsAuto(poses);
  if (!auto.signal) return { context, reps: [], signal: null };
  const signal = auto.signal;
  const reps = fromAutoCycles(auto.cycles).map((cycle) =>
    buildRepMetrics(cycle, poses, idx, AUTO_SIGNAL_JOINTS[signal], {
      toExtreme: "unknown",
      fromExtreme: "unknown",
    }),
  );
  return { context, reps, signal };
}
