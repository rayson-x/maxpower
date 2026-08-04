import {
  EXERCISE_REGISTRY,
  MUSCLE_GROUPS,
  type MuscleGroup,
} from "./exerciseRegistry";
import type { PoseEstimate, PoseLandmark } from "./PoseEngine";
import {
  CAPTURE_POSITIONS,
  type CapturePosition,
} from "./viewGating";

/**
 * A deterministic, SDK-portable motion prior. It deliberately models only
 * phase-relative signals, never a population-standard pose or medical claim.
 */
export const SIMULATED_KINEMATIC_PRIOR_SCHEMA =
  "form-coach-simulated-kinematic-prior/v1" as const;
export const SIMULATED_PRIOR_NODES_PER_PHASE = 16;
export const SIMULATED_PRIOR_NODE_COUNT = SIMULATED_PRIOR_NODES_PER_PHASE * 2;
export const MINIMUM_CALIBRATION_REPS = 6;
export const MINIMUM_REQUIRED_FEATURE_NODE_OBSERVATIONS = 4;

export type PriorFeature =
  | "elbowAngleDeg"
  | "kneeAngleDeg"
  | "hipAngleDeg"
  | "ankleAngleDeg"
  | "wristHeightRelativeShoulderY"
  | "wristLateralSpread"
  | "wristDistanceToShoulder"
  | "hipHeightRelativeAnkleY"
  | "heelHeightRelativeAnkleY"
  | "torsoLeanImageDeg"
  | "wristLateralRelativeElbow";

export type PriorTrend = "increase_to_extreme" | "decrease_to_extreme" | "hold";
export type PriorFeatureRole = "primary" | "secondary";
export type TrainingSide = "bilateral" | "left" | "right";
export type ProjectionClass = "upright-image-2d";

export interface SimulatedPriorIdentity {
  readonly exerciseId: string;
  readonly muscleGroup: MuscleGroup;
  readonly variation: string;
  readonly equipment: string;
  readonly capturePosition: CapturePosition;
  readonly trainingSide: TrainingSide;
  /** Canonical description or hash of bench, seat, footplate, pulley and stance setup. */
  readonly setupFingerprint: string;
  readonly coordinateSystem: "source-image/v1";
  readonly featureSchemaId: "simulated-kinematic-features/v1";
  /** Signed image-space features are valid only after orientation has been fixed. */
  readonly cameraUpright: boolean;
  readonly isMirrored: boolean;
  readonly projectionClass: ProjectionClass;
  readonly poseModelVersion: string;
}

export interface SimulatedFeatureConstraint {
  readonly feature: PriorFeature;
  readonly trend: PriorTrend;
  readonly role: PriorFeatureRole;
  /** A missing secondary signal is diagnostic-only; a missing primary signal refuses calibration. */
  readonly requiredForCalibration: boolean;
  /** Human-readable semantic, not a numerical form threshold. */
  readonly rationaleZh: string;
}

export interface SimulatedKinematicPriorTemplate {
  readonly schemaVersion: typeof SIMULATED_KINEMATIC_PRIOR_SCHEMA;
  readonly templateId: string;
  readonly version: "v1";
  readonly exerciseId: string;
  readonly muscleGroup: MuscleGroup;
  readonly primaryCapturePosition: CapturePosition;
  /** A separate identity bucket must be calibrated for each listed angle. */
  readonly supportedCapturePositions: readonly CapturePosition[];
  /** Bilateral averaging is forbidden when the action has one working side. */
  readonly supportedTrainingSides: readonly TrainingSide[];
  readonly phaseLabels: {
    readonly start: string;
    readonly extreme: string;
    readonly end: string;
  };
  readonly toExtremeMeaning: string;
  readonly fromExtremeMeaning: string;
  readonly features: readonly SimulatedFeatureConstraint[];
  readonly assumptions: readonly string[];
  readonly prohibitedClaims: readonly string[];
}

export interface SimulatedPriorNode {
  readonly nodeIndex: number;
  readonly phase: "to_extreme" | "from_extreme";
  readonly phaseProgress: number;
  /** Dimensionless latent amplitude (-1..1), never image coordinates or degrees. */
  readonly latentFeatureValues: Readonly<Record<PriorFeature, number | null>>;
}

export interface SimulatedKinematicPrior {
  readonly schemaVersion: typeof SIMULATED_KINEMATIC_PRIOR_SCHEMA;
  readonly source: "simulated_kinematic_prior";
  readonly evidenceStatus: "uncalibrated";
  readonly calibrationStatus: "uncalibrated";
  readonly generatorVersion: "piecewise-cosine/v1";
  readonly template: SimulatedKinematicPriorTemplate;
  readonly identity: SimulatedPriorIdentity;
  readonly nodes: readonly SimulatedPriorNode[];
  readonly qualityVerdict: null;
}

export interface ObservedPriorNode {
  readonly nodeIndex: number;
  readonly phase: "to_extreme" | "from_extreme";
  readonly phaseProgress: number;
  readonly values: Readonly<Record<PriorFeature, number | null>>;
}

/** A human-approved rep boundary, with raw pose observations retained as observations. */
export interface ObservedPriorRep {
  readonly source: "human_approved_segmentation";
  readonly identity: SimulatedPriorIdentity;
  readonly captureId: string;
  readonly repIndex: number;
  readonly startMs: number;
  readonly extremeMs: number;
  readonly endMs: number;
  readonly nodes: readonly ObservedPriorNode[];
}

export interface CalibratedFeatureCorridor {
  readonly feature: PriorFeature;
  readonly nodes: readonly {
    readonly nodeIndex: number;
    readonly nObserved: number;
    readonly median: number | null;
    readonly qLow: number | null;
    readonly qHigh: number | null;
  }[];
}

export interface CalibratedSimulatedPrior {
  readonly source: "simulated_kinematic_prior";
  readonly calibrationStatus: "observed_personal_provisional";
  readonly simulatedPrior: SimulatedKinematicPrior;
  readonly calibration: {
    readonly sourceCaptureIds: readonly string[];
    readonly sourceRepCount: number;
    readonly featureCorridors: readonly CalibratedFeatureCorridor[];
    readonly limitations: readonly string[];
  };
  readonly qualityVerdict: null;
}

export type InstantiatePriorResult =
  | { status: "ready"; prior: SimulatedKinematicPrior }
  | { status: "rejected"; reason: string };

export type ExtractObservedPriorResult =
  | { status: "ready"; rep: ObservedPriorRep }
  | { status: "rejected"; reason: string };

export type CalibratePriorResult =
  | { status: "ready"; calibrated: CalibratedSimulatedPrior }
  | { status: "rejected"; reason: string };

export interface PriorCaptureStep {
  readonly exerciseId: string;
  readonly muscleGroup: MuscleGroup;
  readonly capturePosition: CapturePosition;
  readonly trainingSide: TrainingSide;
  readonly role:
    | "primary_calibration"
    | "primary_held_out_validation"
    | "independent_profile_calibration"
    | "independent_profile_held_out_validation";
  readonly targetCompleteReps: number;
  readonly requiredMetadata: readonly (keyof Omit<SimulatedPriorIdentity, "exerciseId" | "muscleGroup">)[];
  readonly instructionsZh: string;
}

export interface FiveSplitPriorWorkflow {
  readonly schemaVersion: "form-coach-five-split-prior-workflow/v1";
  readonly source: "simulated_kinematic_prior";
  readonly groups: readonly {
    readonly muscleGroup: MuscleGroup;
    readonly labelZh: string;
    readonly steps: readonly PriorCaptureStep[];
  }[];
  readonly calibrationRules: readonly string[];
}

const ALL_FEATURES: readonly PriorFeature[] = [
  "elbowAngleDeg",
  "kneeAngleDeg",
  "hipAngleDeg",
  "ankleAngleDeg",
  "wristHeightRelativeShoulderY",
  "wristLateralSpread",
  "wristDistanceToShoulder",
  "hipHeightRelativeAnkleY",
  "heelHeightRelativeAnkleY",
  "torsoLeanImageDeg",
  "wristLateralRelativeElbow",
];

const primary = (
  feature: PriorFeature,
  trend: PriorTrend,
  rationaleZh: string,
): SimulatedFeatureConstraint => ({ feature, trend, role: "primary", requiredForCalibration: true, rationaleZh });
const secondary = (
  feature: PriorFeature,
  trend: PriorTrend,
  rationaleZh: string,
): SimulatedFeatureConstraint => ({ feature, trend, role: "secondary", requiredForCalibration: false, rationaleZh });

const COMMON_PROHIBITIONS = [
  "population_standard_claim",
  "form_quality_score",
  "medical_diagnosis",
  "injury_risk_prediction",
  "synthetic_coordinate_imputation",
] as const;

type TemplateInput = Omit<SimulatedKinematicPriorTemplate, "schemaVersion" | "version" | "templateId" | "supportedTrainingSides"> & {
  readonly supportedTrainingSides?: readonly TrainingSide[];
};

function template(input: TemplateInput): SimulatedKinematicPriorTemplate {
  const primaryCapturePosition = input.primaryCapturePosition;
  const supportedCapturePositions = [...new Set([primaryCapturePosition, ...input.supportedCapturePositions])];
  const supportedTrainingSides = input.supportedTrainingSides?.length
    ? [...new Set(input.supportedTrainingSides)]
    : ["bilateral"] as const;
  return {
    schemaVersion: SIMULATED_KINEMATIC_PRIOR_SCHEMA,
    version: "v1",
    templateId: `${input.exerciseId}/simulated-kinematic-prior/v1`,
    ...input,
    supportedCapturePositions,
    supportedTrainingSides,
  };
}

const TEMPLATES: readonly SimulatedKinematicPriorTemplate[] = [
  // Chest
  template({ exerciseId: "barbell_bench_press", muscleGroup: "chest", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "底部", extreme: "推起顶部", end: "回到底部" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "推起时肘部图像投影角总体趋向伸展。"), secondary("wristDistanceToShoulder", "increase_to_extreme", "器械推离躯干的相对距离可作辅助观察。")], assumptions: ["平板杠铃卧推；只比较同一凳面、握距和机位。"] , prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "dumbbell_bench_press", muscleGroup: "chest", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "底部", extreme: "推起顶部", end: "回到底部" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "推起时肘部图像投影角总体趋向伸展。"), secondary("wristDistanceToShoulder", "increase_to_extreme", "哑铃相对肩部距离可作辅助观察。")], assumptions: ["平板双哑铃；左右独立路径不被强制相同。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "incline_dumbbell_press", muscleGroup: "chest", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "底部", extreme: "斜向推起顶部", end: "回到底部" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "斜向推起时肘部图像投影角总体趋向伸展。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "在固定斜凳与斜前机位下，手腕总体上移只作辅助特征。")], assumptions: ["凳角、握法和手腕轨迹必须由真实数据单独校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "machine_chest_press", muscleGroup: "chest", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "握把靠近躯干", extreme: "推臂终点", end: "回到起点" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "推把时肘部图像投影角总体趋向伸展。"), secondary("wristDistanceToShoulder", "increase_to_extreme", "握把离肩距离只在同一器械几何下比较。")], assumptions: ["座椅高度和器械连杆路径是 identity 的一部分。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "cable_chest_fly", muscleGroup: "chest", primaryCapturePosition: "front", supportedCapturePositions: ["frontLeft45", "frontRight45"], phaseLabels: { start: "张开", extreme: "合拢", end: "回到张开" }, toExtremeMeaning: "adduction", fromExtremeMeaning: "controlled_return", features: [primary("wristLateralSpread", "decrease_to_extreme", "固定正面机位下，双腕横向间距在合拢时总体缩小。"), secondary("elbowAngleDeg", "hold", "肘部保持轻微弯曲仅作辅助稳定性观察。")], assumptions: ["滑轮高度与单/双手交叉方式必须单独建桶。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "push_up", muscleGroup: "chest", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "底部", extreme: "支撑顶部", end: "回到底部" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "推起时肘部图像投影角总体趋向伸展。"), secondary("hipHeightRelativeAnkleY", "decrease_to_extreme", "身体相对固定脚踝总体上移仅用于区分完整相位，不能替代躯干直线质量判断。")], assumptions: ["手距、斜板、跪姿和地面高度不可混入同一 profile。"], prohibitedClaims: COMMON_PROHIBITIONS }),

  // Back
  template({ exerciseId: "barbell_row", muscleGroup: "back", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "手臂伸展", extreme: "拉至躯干", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "拉动时肘部图像投影角总体趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "手腕靠近肩/躯干只作同机位辅助特征。")], assumptions: ["躯干前倾与杠铃高度不可用作合格姿势阈值。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "one_arm_dumbbell_row", muscleGroup: "back", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left", "right"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "工作臂伸展", extreme: "工作臂拉近", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "工作臂拉动时肘角趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "工作侧手腕靠近躯干作为辅助。")], assumptions: ["左右侧分别校准；支撑方式与长凳高度不可混合。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "chest_supported_row", muscleGroup: "back", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45"], phaseLabels: { start: "手臂伸展", extreme: "拉至胸托", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "拉动时肘角总体趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "手腕靠近上躯干作为辅助。")], assumptions: ["胸托角度和握把路径必须单独校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "seated_row", muscleGroup: "back", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "手臂伸展", extreme: "拉至躯干", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "拉动时肘角趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "握把靠近躯干作为辅助。")], assumptions: ["座椅、脚踏、把手与躯干摆动必须记录。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "single_arm_cable_row", muscleGroup: "back", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left", "right"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "工作臂伸展", extreme: "拉至躯干", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "工作臂肘角趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "工作侧手腕靠近躯干作为辅助。")], assumptions: ["左右侧与滑轮高度独立校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "pull_up", muscleGroup: "back", primaryCapturePosition: "front", supportedCapturePositions: ["frontLeft45", "frontRight45"], phaseLabels: { start: "悬垂", extreme: "身体上移顶点", end: "回到悬垂" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "上拉时肘角总体趋向屈曲。")], assumptions: ["握法、辅助弹力和摆动方式不能混用。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "assisted_pull_up", muscleGroup: "back", primaryCapturePosition: "front", supportedCapturePositions: ["frontLeft45", "frontRight45"], phaseLabels: { start: "辅助悬垂", extreme: "上移顶点", end: "回到起点" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "上拉时肘角总体趋向屈曲。")], assumptions: ["辅助配重、踏板和握法是 identity。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "lat_pulldown", muscleGroup: "back", primaryCapturePosition: "rear", supportedCapturePositions: ["rearLeft45", "rearRight45"], phaseLabels: { start: "顶部伸展", extreme: "下拉底部", end: "回到顶部" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "increase_to_extreme", "source-image 坐标中下拉时双腕相对肩总体向下。"), primary("elbowAngleDeg", "decrease_to_extreme", "下拉时肘角总体趋向屈曲。"), secondary("wristLateralSpread", "decrease_to_extreme", "双手横向间距的变化只作握法辅助。")], assumptions: ["直杆正握、后视机位和器械几何必须严格匹配。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "wide_grip_lat_pulldown", muscleGroup: "back", primaryCapturePosition: "rear", supportedCapturePositions: ["rearLeft45", "rearRight45"], phaseLabels: { start: "顶部宽握伸展", extreme: "下拉底部", end: "回到顶部" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "increase_to_extreme", "下拉时双腕相对肩总体向下。"), primary("elbowAngleDeg", "decrease_to_extreme", "下拉时肘角总体趋向屈曲。")], assumptions: ["宽握距离是独立 identity，不能借用直杆窄握数值。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "straight_arm_pulldown", muscleGroup: "back", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "手臂上方", extreme: "直臂下压终点", end: "回到上方" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "increase_to_extreme", "固定侧面 source-image 中下压时手腕总体向下。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "手腕靠近髋侧的趋势只作辅助。")], assumptions: ["肘部保持程度不作为自动质量结论。"], prohibitedClaims: COMMON_PROHIBITIONS }),

  // Legs
  template({ exerciseId: "bodyweight_squat", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "站立顶部", extreme: "下蹲底部", end: "站回顶部" }, toExtremeMeaning: "eccentric", fromExtremeMeaning: "concentric", features: [primary("kneeAngleDeg", "decrease_to_extreme", "下蹲时膝关节投影角总体趋向屈曲。"), primary("hipHeightRelativeAnkleY", "increase_to_extreme", "固定侧面中髋部相对脚踝总体下移。"), secondary("hipAngleDeg", "decrease_to_extreme", "髋部投影角可作辅助相位证据。")], assumptions: ["深度、足尖方向和躯干角不构成模拟先验的合格阈值。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "barbell_back_squat", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "站立顶部", extreme: "下蹲底部", end: "站回顶部" }, toExtremeMeaning: "eccentric", fromExtremeMeaning: "concentric", features: [primary("kneeAngleDeg", "decrease_to_extreme", "下蹲时膝角总体趋向屈曲。"), primary("hipHeightRelativeAnkleY", "increase_to_extreme", "髋部在固定侧面相对脚踝总体下移。"), secondary("hipAngleDeg", "decrease_to_extreme", "髋部投影角作辅助。")], assumptions: ["杆位、鞋跟、深度与躯干角分别记录，不共享徒手深蹲数值。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "leg_press", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "膝髋较伸展", extreme: "屈髋屈膝底部", end: "推回起点" }, toExtremeMeaning: "lowering", fromExtremeMeaning: "press", features: [primary("kneeAngleDeg", "decrease_to_extreme", "放下踏板时膝角总体趋向屈曲。"), secondary("hipAngleDeg", "decrease_to_extreme", "髋角作为同器械辅助相位信号。")], assumptions: ["靠背角、踏板高度和足位必须单独建桶。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "romanian_deadlift", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "髋伸展顶部", extreme: "髋铰链底部", end: "回到顶部" }, toExtremeMeaning: "hinge_lowering", fromExtremeMeaning: "hip_extension", features: [primary("hipAngleDeg", "decrease_to_extreme", "下放时髋部投影角总体趋向屈曲。"), primary("torsoLeanImageDeg", "increase_to_extreme", "固定侧面中躯干相对竖直的倾角总体增大。"), secondary("kneeAngleDeg", "hold", "膝关节小幅变化只作辅助，不设数值目标。")], assumptions: ["杠铃/哑铃、站距与膝部微屈需分开校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "walking_lunge", muscleGroup: "legs", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "步态顶部", extreme: "前腿底部", end: "下一步顶部" }, toExtremeMeaning: "lowering", fromExtremeMeaning: "rising", features: [primary("kneeAngleDeg", "decrease_to_extreme", "承重前腿膝角总体趋向屈曲。"), primary("hipHeightRelativeAnkleY", "increase_to_extreme", "骨盆相对工作侧脚踝总体下移。")], assumptions: ["左右步次必须分开记录；行走位移不是同一原地深蹲轨迹。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "bulgarian_split_squat", muscleGroup: "legs", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "顶部", extreme: "前腿底部", end: "回到顶部" }, toExtremeMeaning: "lowering", fromExtremeMeaning: "rising", features: [primary("kneeAngleDeg", "decrease_to_extreme", "前腿膝角总体趋向屈曲。"), primary("hipHeightRelativeAnkleY", "increase_to_extreme", "骨盆相对工作侧脚踝总体下移。")], assumptions: ["工作腿、长凳高度和前后脚距属于独立 identity。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "leg_extension", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "屈膝起点", extreme: "伸膝终点", end: "回到屈膝" }, toExtremeMeaning: "knee_extension", fromExtremeMeaning: "controlled_return", features: [primary("kneeAngleDeg", "increase_to_extreme", "伸膝时膝角总体趋向伸展。")], assumptions: ["座椅、靠背和滚筒起点是 identity。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "leg_curl", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "伸膝起点", extreme: "屈膝终点", end: "回到伸膝" }, toExtremeMeaning: "knee_flexion", fromExtremeMeaning: "controlled_return", features: [primary("kneeAngleDeg", "decrease_to_extreme", "屈膝时膝角总体趋向屈曲。")], assumptions: ["俯卧、坐姿、站姿腿弯举不可共享同一 profile。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "hip_thrust", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "髋屈曲底部", extreme: "髋伸展顶部", end: "回到底部" }, toExtremeMeaning: "hip_extension", fromExtremeMeaning: "controlled_return", features: [primary("hipAngleDeg", "increase_to_extreme", "顶髋时髋部投影角总体趋向伸展。"), primary("hipHeightRelativeAnkleY", "decrease_to_extreme", "固定侧面中髋部相对脚踝总体上移。")], assumptions: ["长凳高度、杆垫和足距必须单独校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "calf_raise", muscleGroup: "legs", primaryCapturePosition: "left", supportedCapturePositions: ["right", "frontLeft45"], phaseLabels: { start: "脚跟低点", extreme: "提踵高点", end: "回到低点" }, toExtremeMeaning: "plantarflexion", fromExtremeMeaning: "controlled_return", features: [primary("heelHeightRelativeAnkleY", "increase_to_extreme", "固定侧面中脚跟相对踝部总体上移。"), secondary("ankleAngleDeg", "increase_to_extreme", "踝部图像投影角只作辅助。")], assumptions: ["坐姿/站姿、台阶高度与器械类型不能混用。"], prohibitedClaims: COMMON_PROHIBITIONS }),

  // Shoulders
  template({ exerciseId: "seated_shoulder_press", muscleGroup: "shoulders", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "底部", extreme: "过顶顶部", end: "回到底部" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "decrease_to_extreme", "source-image 坐标中上推时手腕总体上移。"), primary("elbowAngleDeg", "increase_to_extreme", "上推时肘角总体趋向伸展。")], assumptions: ["哑铃、杠铃、机器、靠背角与握法必须分开校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "lateral_raise", muscleGroup: "shoulders", primaryCapturePosition: "front", supportedCapturePositions: ["frontLeft45", "frontRight45"], phaseLabels: { start: "手臂下方", extreme: "侧举顶部", end: "回到下方" }, toExtremeMeaning: "abduction", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "decrease_to_extreme", "侧举时手腕总体上移。"), primary("wristLateralSpread", "increase_to_extreme", "固定正面中双腕横向间距总体增大。")], assumptions: ["哑铃/绳索、肘部弯曲与站姿不可混用。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "rear_delt_fly", muscleGroup: "shoulders", primaryCapturePosition: "rearLeft45", supportedCapturePositions: ["rearRight45", "rear"], phaseLabels: { start: "手臂收拢", extreme: "后束展开", end: "回到收拢" }, toExtremeMeaning: "horizontal_abduction", fromExtremeMeaning: "controlled_return", features: [primary("wristLateralSpread", "increase_to_extreme", "固定后方机位中双腕横向间距总体增大。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "手臂抬高只作辅助。")], assumptions: ["反向蝴蝶机与俯身哑铃飞鸟不可共用数值。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "face_pull", muscleGroup: "shoulders", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "手臂伸展", extreme: "拉向面部", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "拉绳时肘角总体趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "手腕靠近上躯干仅作辅助。")], assumptions: ["滑轮高度、绳索长度和站距必须记录。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "front_raise", muscleGroup: "shoulders", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "手臂下方", extreme: "前举顶部", end: "回到下方" }, toExtremeMeaning: "flexion", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "decrease_to_extreme", "前举时手腕总体上移。"), secondary("wristDistanceToShoulder", "increase_to_extreme", "手腕相对肩部距离只作辅助。")], assumptions: ["哑铃/绳索和肘部弯曲必须分开校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "single_arm_cable_lateral_raise", muscleGroup: "shoulders", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left", "right"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "工作臂下方", extreme: "侧举顶部", end: "回到下方" }, toExtremeMeaning: "abduction", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "decrease_to_extreme", "工作臂上举时手腕总体上移。"), secondary("wristLateralRelativeElbow", "increase_to_extreme", "手腕相对肘部横向路径只作辅助。")], assumptions: ["滑轮侧、工作侧和起始张力分别建桶。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "landmine_press", muscleGroup: "shoulders", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left", "right"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "斜向底部", extreme: "斜向推起顶部", end: "回到底部" }, toExtremeMeaning: "press", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "斜向推起时工作肘总体趋向伸展。"), primary("wristHeightRelativeShoulderY", "decrease_to_extreme", "手腕总体上移作为辅助可观测路径。")], assumptions: ["单侧、地雷管角度和站姿必须单独校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "cable_y_raise", muscleGroup: "shoulders", primaryCapturePosition: "front", supportedCapturePositions: ["frontLeft45", "frontRight45"], phaseLabels: { start: "手臂下方", extreme: "Y 形顶部", end: "回到下方" }, toExtremeMeaning: "abduction", fromExtremeMeaning: "controlled_return", features: [primary("wristHeightRelativeShoulderY", "decrease_to_extreme", "双腕总体上移。"), primary("wristLateralSpread", "increase_to_extreme", "固定正面中双腕横向间距总体增大。")], assumptions: ["滑轮高度、交叉/不交叉绳索必须分开校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "cable_external_rotation", muscleGroup: "shoulders", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left", "right"], supportedTrainingSides: ["left", "right"], phaseLabels: { start: "前臂内收位", extreme: "外旋终点", end: "回到起点" }, toExtremeMeaning: "external_rotation", fromExtremeMeaning: "controlled_return", features: [primary("wristLateralRelativeElbow", "increase_to_extreme", "固定斜前机位中手腕相对肘部的横向位移作为相位候选。")], assumptions: ["单目二维对外旋可观测性有限，必须人工选定动作并严格按工作侧校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "rear_delt_row", muscleGroup: "shoulders", primaryCapturePosition: "rearLeft45", supportedCapturePositions: ["rearRight45", "rear"], phaseLabels: { start: "手臂伸展", extreme: "后束拉动终点", end: "回到伸展" }, toExtremeMeaning: "pull", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "拉动时肘角总体趋向屈曲。"), secondary("wristDistanceToShoulder", "decrease_to_extreme", "手腕靠近躯干作为辅助。")], assumptions: ["高位、低位和握距分别建桶。"], prohibitedClaims: COMMON_PROHIBITIONS }),

  // Arms
  template({ exerciseId: "barbell_biceps_curl", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "肘部伸展", extreme: "弯举顶部", end: "回到伸展" }, toExtremeMeaning: "elbow_flexion", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "弯举时肘角总体趋向屈曲。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "手腕上移只作辅助相位。")], assumptions: ["站姿/牧师凳、握距与杠铃类型不可混用。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "dumbbell_biceps_curl", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "肘部伸展", extreme: "弯举顶部", end: "回到伸展" }, toExtremeMeaning: "elbow_flexion", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "弯举时肘角总体趋向屈曲。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "手腕上移只作辅助相位。")], assumptions: ["交替/同时、站姿/坐姿分别校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "hammer_curl", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "肘部伸展", extreme: "锤式弯举顶部", end: "回到伸展" }, toExtremeMeaning: "elbow_flexion", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "弯举时肘角总体趋向屈曲。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "手腕上移只作辅助。")], assumptions: ["握法与交替节奏属于 identity。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "cable_biceps_curl", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "肘部伸展", extreme: "弯举顶部", end: "回到伸展" }, toExtremeMeaning: "elbow_flexion", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "decrease_to_extreme", "拉起时肘角总体趋向屈曲。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "手腕上移只作辅助。")], assumptions: ["滑轮高度、把手和站距需记录。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "triceps_pushdown", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "肘部屈曲", extreme: "下压终点", end: "回到起点" }, toExtremeMeaning: "elbow_extension", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "下压时肘角总体趋向伸展。"), primary("wristHeightRelativeShoulderY", "increase_to_extreme", "source-image 中手腕总体下移。")], assumptions: ["绳索/直杆、滑轮高度和站距分别校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "overhead_triceps_extension", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "front"], phaseLabels: { start: "肘部屈曲", extreme: "过顶伸肘终点", end: "回到起点" }, toExtremeMeaning: "elbow_extension", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "伸肘时肘角总体趋向伸展。"), secondary("wristHeightRelativeShoulderY", "decrease_to_extreme", "过顶手腕上移只作辅助。")], assumptions: ["绳索/哑铃、站姿/坐姿和头后路径需分开校准。"], prohibitedClaims: COMMON_PROHIBITIONS }),
  template({ exerciseId: "skull_crusher", muscleGroup: "arms", primaryCapturePosition: "frontLeft45", supportedCapturePositions: ["frontRight45", "left"], phaseLabels: { start: "肘部屈曲", extreme: "伸肘终点", end: "回到屈肘" }, toExtremeMeaning: "elbow_extension", fromExtremeMeaning: "controlled_return", features: [primary("elbowAngleDeg", "increase_to_extreme", "伸肘时肘角总体趋向伸展。"), secondary("wristDistanceToShoulder", "increase_to_extreme", "器械远离头肩的相对距离只作辅助。")], assumptions: ["凳角、EZ 杠/哑铃和肘部起点必须分别记录。"], prohibitedClaims: COMMON_PROHIBITIONS }),
];

const TEMPLATES_BY_EXERCISE = new Map(TEMPLATES.map((item) => [item.exerciseId, item]));

export function listSimulatedKinematicPriorTemplates(): readonly SimulatedKinematicPriorTemplate[] {
  return TEMPLATES;
}

export function getSimulatedKinematicPriorTemplate(exerciseId: string): SimulatedKinematicPriorTemplate | null {
  return TEMPLATES_BY_EXERCISE.get(exerciseId) ?? null;
}

export function instantiateSimulatedKinematicPrior(identity: SimulatedPriorIdentity): InstantiatePriorResult {
  const template = getSimulatedKinematicPriorTemplate(identity.exerciseId);
  if (!template) return { status: "rejected", reason: `动作 ${identity.exerciseId} 没有 simulated prior template。` };
  if (template.muscleGroup !== identity.muscleGroup) {
    return { status: "rejected", reason: "动作与肌群 identity 不一致。" };
  }
  if (!template.supportedCapturePositions.includes(identity.capturePosition)) {
    return { status: "rejected", reason: `${identity.capturePosition} 不是此动作 prior 支持的机位。` };
  }
  if (!template.supportedTrainingSides.includes(identity.trainingSide)) {
    return { status: "rejected", reason: `${identity.trainingSide} 不是此动作 prior 支持的训练侧。` };
  }
  if (!identity.variation.trim() || !identity.equipment.trim() || !identity.setupFingerprint.trim() || !identity.poseModelVersion.trim()) {
    return { status: "rejected", reason: "variation、equipment、setupFingerprint 和 poseModelVersion 必须显式记录，不能用模拟先验猜测。" };
  }
  if (!identity.cameraUpright || identity.projectionClass !== "upright-image-2d") {
    return { status: "rejected", reason: "必须先将画面规范为 upright-image-2d，再建立带符号图像轨迹。" };
  }
  const nodes = buildSimulatedNodes(template);
  return {
    status: "ready",
    prior: Object.freeze({
      schemaVersion: SIMULATED_KINEMATIC_PRIOR_SCHEMA,
      source: "simulated_kinematic_prior",
      evidenceStatus: "uncalibrated",
      calibrationStatus: "uncalibrated",
      generatorVersion: "piecewise-cosine/v1",
      template,
      identity: Object.freeze({ ...identity }),
      nodes,
      qualityVerdict: null,
    }),
  };
}

/**
 * Generates a deterministic fixture for tests, visualisation, and capture
 * planning. Its explicit simulation-only identity can never match a real
 * capture identity, so it cannot silently become a personal reference.
 */
export function buildNominalSimulatedKinematicPrior(
  template: SimulatedKinematicPriorTemplate,
  trainingSide: TrainingSide = template.supportedTrainingSides[0]!,
): SimulatedKinematicPrior {
  const result = instantiateSimulatedKinematicPrior({
    exerciseId: template.exerciseId,
    muscleGroup: template.muscleGroup,
    variation: "simulation-only/v1",
    equipment: "simulation-only",
    capturePosition: template.primaryCapturePosition,
    trainingSide,
    setupFingerprint: "simulation-only/setup/v1",
    coordinateSystem: "source-image/v1",
    featureSchemaId: "simulated-kinematic-features/v1",
    cameraUpright: true,
    isMirrored: false,
    projectionClass: "upright-image-2d",
    poseModelVersion: "simulation-only",
  });
  if (result.status === "rejected") {
    throw new Error(`Cannot build nominal simulated prior for ${template.exerciseId}: ${result.reason}`);
  }
  return result.prior;
}

export function buildObservedPriorRep(input: {
  readonly identity: SimulatedPriorIdentity;
  readonly captureId: string;
  readonly repIndex: number;
  readonly startMs: number;
  readonly extremeMs: number;
  readonly endMs: number;
  readonly poses: readonly PoseEstimate[];
}): ExtractObservedPriorResult {
  const instantiated = instantiateSimulatedKinematicPrior(input.identity);
  if (instantiated.status !== "ready") return instantiated;
  if (!input.captureId.trim() || !Number.isInteger(input.repIndex) || input.repIndex <= 0) {
    return { status: "rejected", reason: "captureId 和正整数 repIndex 是必填项。" };
  }
  if (!(input.startMs < input.extremeMs && input.extremeMs < input.endMs)) {
    return { status: "rejected", reason: "必须提供 start < extreme < end 的人工批准边界。" };
  }
  if (input.poses.length < 2 || input.poses.some((pose, index) => index > 0 && pose.timestampMs < input.poses[index - 1].timestampMs)) {
    return { status: "rejected", reason: "关键点帧不足或时间未排序。" };
  }
  if (input.startMs < input.poses[0].timestampMs || input.endMs > input.poses[input.poses.length - 1].timestampMs) {
    return { status: "rejected", reason: "人工边界超出关键点录像范围。" };
  }
  const nodes = instantiated.prior.nodes.map((node) => {
    const phaseStart = node.phase === "to_extreme" ? input.startMs : input.extremeMs;
    const phaseEnd = node.phase === "to_extreme" ? input.extremeMs : input.endMs;
    const targetMs = phaseStart + (phaseEnd - phaseStart) * node.phaseProgress;
    const pose = nearestPose(input.poses, targetMs);
    const values = pose && Math.abs(pose.timestampMs - targetMs) <= 180
      ? featureVector(pose, input.identity.trainingSide, input.identity.isMirrored)
      : emptyFeatures();
    return Object.freeze({
      nodeIndex: node.nodeIndex,
      phase: node.phase,
      phaseProgress: node.phaseProgress,
      values,
    });
  });
  return {
    status: "ready",
    rep: Object.freeze({
      source: "human_approved_segmentation",
      identity: Object.freeze({ ...input.identity }),
      captureId: input.captureId,
      repIndex: input.repIndex,
      startMs: input.startMs,
      extremeMs: input.extremeMs,
      endMs: input.endMs,
      nodes: Object.freeze(nodes),
    }),
  };
}

export function calibrateSimulatedKinematicPrior(
  prior: SimulatedKinematicPrior,
  reps: readonly ObservedPriorRep[],
): CalibratePriorResult {
  if (prior.source !== "simulated_kinematic_prior" || prior.calibrationStatus !== "uncalibrated") {
    return { status: "rejected", reason: "只能校准未校准的 simulated prior。" };
  }
  if (reps.length < MINIMUM_CALIBRATION_REPS) {
    return { status: "rejected", reason: `至少需要 ${MINIMUM_CALIBRATION_REPS} 个来自人工批准边界的真实 rep，单条轨迹不能发布 corridor。` };
  }
  const evidenceError = validateObservedEvidence(reps);
  if (evidenceError) return { status: "rejected", reason: evidenceError };
  if (reps.some((rep) => !sameIdentity(rep.identity, prior.identity))) {
    return { status: "rejected", reason: "真实 rep identity 与 prior 不一致；不同机位、器械、变式或模型不得混合。" };
  }
  if (reps.some((rep) => rep.nodes.length !== SIMULATED_PRIOR_NODE_COUNT)) {
    return { status: "rejected", reason: "真实 rep 节点数与模拟 prior 不一致。" };
  }
  const required = prior.template.features.filter((feature) => feature.requiredForCalibration);
  const featureCorridors = prior.template.features.map((constraint) => ({
    feature: constraint.feature,
    nodes: prior.nodes.map((node) => {
      const values = reps
        .map((rep) => rep.nodes[node.nodeIndex]?.values[constraint.feature] ?? null)
        .filter((value): value is number => value !== null && Number.isFinite(value))
        .sort((left, right) => left - right);
      return Object.freeze({
        nodeIndex: node.nodeIndex,
        nObserved: values.length,
        median: values.length ? round(percentile(values, 0.5)) : null,
        qLow: values.length ? round(percentile(values, 0.1)) : null,
        qHigh: values.length ? round(percentile(values, 0.9)) : null,
      });
    }),
  }));
  const insufficientRequired = required.some((constraint) =>
    featureCorridors
      .find((corridor) => corridor.feature === constraint.feature)!
      .nodes.some((node) => node.nObserved < MINIMUM_REQUIRED_FEATURE_NODE_OBSERVATIONS),
  );
  if (insufficientRequired) {
    return { status: "rejected", reason: `至少一个 primary feature 的节点少于 ${MINIMUM_REQUIRED_FEATURE_NODE_OBSERVATIONS} 次真实观测；必须保留 unknown，不能由模拟值补齐。` };
  }
  return {
    status: "ready",
    calibrated: Object.freeze({
      source: "simulated_kinematic_prior",
      calibrationStatus: "observed_personal_provisional",
      simulatedPrior: prior,
      calibration: Object.freeze({
        sourceCaptureIds: Object.freeze([...new Set(reps.map((rep) => rep.captureId))]),
        sourceRepCount: reps.length,
        featureCorridors: Object.freeze(featureCorridors.map((feature) => Object.freeze({
          feature: feature.feature,
          nodes: Object.freeze(feature.nodes),
        }))),
        limitations: Object.freeze([
          "人工 rep 边界验证分段，不等于专家认可的动作形式。",
          "走廊来自当前个人、器械和机位；不得外推为人群标准。",
          "unknown 特征保持 unknown，模拟先验不得填补真实测量缺口。",
        ]),
      }),
      qualityVerdict: null,
    }),
  };
}

function validateObservedEvidence(reps: readonly ObservedPriorRep[]): string | null {
  const repKeys = new Set<string>();
  for (const rep of reps) {
    if (rep.source !== "human_approved_segmentation") return "校准输入必须是 human_approved_segmentation，不能使用自动或模拟片段。";
    if (!rep.captureId.trim() || !Number.isInteger(rep.repIndex) || rep.repIndex <= 0) return "校准 rep 必须有 captureId 和正整数 repIndex。";
    const key = `${rep.captureId}\u0000${rep.repIndex}`;
    if (repKeys.has(key)) return "同一 captureId + repIndex 只能进入校准一次。";
    repKeys.add(key);
    if (!(Number.isFinite(rep.startMs) && Number.isFinite(rep.extremeMs) && Number.isFinite(rep.endMs) && rep.startMs < rep.extremeMs && rep.extremeMs < rep.endMs)) {
      return "校准 rep 的 start、extreme、end 必须是严格递增的有限时间。";
    }
    if (rep.nodes.length !== SIMULATED_PRIOR_NODE_COUNT) return "真实 rep 节点数与模拟 prior 不一致。";
    for (let index = 0; index < SIMULATED_PRIOR_NODE_COUNT; index += 1) {
      const node = rep.nodes[index];
      const expectedPhase = index < SIMULATED_PRIOR_NODES_PER_PHASE ? "to_extreme" : "from_extreme";
      const expectedProgress = round((index % SIMULATED_PRIOR_NODES_PER_PHASE) / (SIMULATED_PRIOR_NODES_PER_PHASE - 1));
      if (!node || node.nodeIndex !== index || node.phase !== expectedPhase || node.phaseProgress !== expectedProgress) {
        return "真实 rep 节点顺序、phase 或 phaseProgress 不符合固定 32 节点协议。";
      }
      for (const feature of ALL_FEATURES) {
        const value = node.values[feature];
        if (value !== null && !Number.isFinite(value)) return "真实 rep 含非法 feature 数值；缺失必须为 null。";
      }
    }
  }
  return null;
}

export function buildFiveSplitPriorWorkflow(): FiveSplitPriorWorkflow {
  const requiredMetadata: readonly (keyof Omit<SimulatedPriorIdentity, "exerciseId" | "muscleGroup">)[] = [
    "variation",
    "equipment",
    "capturePosition",
    "trainingSide",
    "setupFingerprint",
    "coordinateSystem",
    "featureSchemaId",
    "cameraUpright",
    "isMirrored",
    "projectionClass",
    "poseModelVersion",
  ];
  return Object.freeze({
    schemaVersion: "form-coach-five-split-prior-workflow/v1",
    source: "simulated_kinematic_prior",
    groups: Object.freeze(MUSCLE_GROUPS.map((group) => {
      const templates = TEMPLATES.filter((template) => template.muscleGroup === group.id);
      return Object.freeze({
        muscleGroup: group.id,
        labelZh: group.labelZh,
        steps: Object.freeze(templates.flatMap((prior) => prior.supportedCapturePositions.flatMap((capturePosition) =>
          prior.supportedTrainingSides.flatMap((trainingSide) => {
            const isPrimaryIdentity = capturePosition === prior.primaryCapturePosition;
            const label = isPrimaryIdentity ? "主 identity" : "独立机位 identity";
            return [
              Object.freeze({
                exerciseId: prior.exerciseId,
                muscleGroup: prior.muscleGroup,
                capturePosition,
                trainingSide,
                role: isPrimaryIdentity ? "primary_calibration" as const : "independent_profile_calibration" as const,
                targetCompleteReps: 8,
                requiredMetadata: Object.freeze([...requiredMetadata]),
                instructionsZh: `在${captureLabel(capturePosition)}录制 ${prior.exerciseId} 的${label}校准组（${trainingSide}）；标注 8 个连续完整 rep。`,
              }),
              Object.freeze({
                exerciseId: prior.exerciseId,
                muscleGroup: prior.muscleGroup,
                capturePosition,
                trainingSide,
                role: isPrimaryIdentity ? "primary_held_out_validation" as const : "independent_profile_held_out_validation" as const,
                targetCompleteReps: 6,
                requiredMetadata: Object.freeze([...requiredMetadata]),
                instructionsZh: `以相同 exact identity 另录一段 ${prior.exerciseId}（${trainingSide}）作整段留出验证；不得混入校准组。`,
              }),
            ];
          }),
        ))),
      });
    })),
    calibrationRules: Object.freeze([
      "先实例化 uncalibrated prior；它只能服务分段初始化、合成鲁棒性测试和 prior deviation。",
      "同一动作的不同器械、变式、训练侧、实体机位、setupFingerprint、镜像/投影语义和 pose model 必须创建不同 identity。",
      "每个 exact identity 必须先录 8-rep 校准 capture，再录同 identity 的独立 6-rep held-out capture；其他机位是新 identity，必须各自校准与留出。",
      "只使用人工批准的完整 rep 校准轨迹；准备、走动、休息和负窗口只用于抗干扰评估。",
      "没有专家 form 标签时，禁止输出标准姿势、动作正确率、医学或伤害风险结论。",
    ]),
  });
}

/** Hard fail if the five-split catalog and template registry diverge. */
export function validateFiveSplitPriorCoverage(): string[] {
  const errors: string[] = [];
  const catalog = EXERCISE_REGISTRY.exercises.filter((exercise) =>
    MUSCLE_GROUPS.some((group) => group.id === exercise.muscleGroup),
  );
  for (const exercise of catalog) {
    const template = getSimulatedKinematicPriorTemplate(exercise.id);
    if (!template) errors.push(`Missing simulated prior template for ${exercise.id}`);
    else if (template.muscleGroup !== exercise.muscleGroup) errors.push(`Wrong simulated prior muscle group for ${exercise.id}`);
  }
  for (const prior of TEMPLATES) {
    const exercise = EXERCISE_REGISTRY.get(prior.exerciseId);
    if (!exercise) errors.push(`Simulated prior references unknown exercise ${prior.exerciseId}`);
    else if (!prior.features.some((feature) => feature.role === "primary")) errors.push(`Simulated prior ${prior.exerciseId} has no primary observable feature`);
    if (!prior.supportedCapturePositions.includes(prior.primaryCapturePosition)) errors.push(`Simulated prior ${prior.exerciseId} omits its primary capture position`);
  }
  return errors;
}

function buildSimulatedNodes(template: SimulatedKinematicPriorTemplate): readonly SimulatedPriorNode[] {
  const phases: readonly SimulatedPriorNode["phase"][] = ["to_extreme", "from_extreme"];
  return Object.freeze(phases.flatMap((phase) =>
    Array.from({ length: SIMULATED_PRIOR_NODES_PER_PHASE }, (_, phaseIndex) => {
      const phaseProgress = round(phaseIndex / (SIMULATED_PRIOR_NODES_PER_PHASE - 1));
      const activation = phase === "to_extreme"
        ? Math.sin(phaseProgress * Math.PI / 2)
        : Math.cos(phaseProgress * Math.PI / 2);
      const values = Object.fromEntries(ALL_FEATURES.map((feature) => [feature, null])) as Record<PriorFeature, number | null>;
      for (const feature of template.features) {
        const sign = feature.trend === "increase_to_extreme" ? 1 : feature.trend === "decrease_to_extreme" ? -1 : 0;
        values[feature.feature] = round(sign * activation);
      }
      return Object.freeze({
        nodeIndex: phase === "to_extreme" ? phaseIndex : phaseIndex + SIMULATED_PRIOR_NODES_PER_PHASE,
        phase,
        phaseProgress,
        latentFeatureValues: Object.freeze(values),
      });
    }),
  ));
}

function featureVector(
  pose: PoseEstimate,
  side: TrainingSide,
  isMirrored: boolean,
): Readonly<Record<PriorFeature, number | null>> {
  const values = emptyFeatureRecord();
  const selectedSides = side === "left" ? ["left"] as const : side === "right" ? ["right"] as const : ["left", "right"] as const;
  const shoulder = midpoint(measurement(pose.landmarks[11]), measurement(pose.landmarks[12]));
  const hip = midpoint(measurement(pose.landmarks[23]), measurement(pose.landmarks[24]));
  const torsoScale = shoulder && hip ? distance(shoulder, hip) : null;
  const sideValues = <T>(read: (indices: { shoulder: number; elbow: number; wrist: number; hip: number; knee: number; ankle: number; heel: number }) => T | null): T[] =>
    selectedSides.map((selected) => read(selected === "left"
      ? { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29 }
      : { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30 },
    )).filter((value): value is T => value !== null);
  const average = (numbers: readonly number[]) => numbers.length ? round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length) : null;

  values.elbowAngleDeg = average(sideValues(({ shoulder: a, elbow: b, wrist: c }) => angle(measurement(pose.landmarks[a]), measurement(pose.landmarks[b]), measurement(pose.landmarks[c]))));
  values.kneeAngleDeg = average(sideValues(({ hip: a, knee: b, ankle: c }) => angle(measurement(pose.landmarks[a]), measurement(pose.landmarks[b]), measurement(pose.landmarks[c]))));
  values.hipAngleDeg = average(sideValues(({ shoulder: a, hip: b, knee: c }) => angle(measurement(pose.landmarks[a]), measurement(pose.landmarks[b]), measurement(pose.landmarks[c]))));
  values.ankleAngleDeg = average(sideValues(({ knee: a, ankle: b, heel: c }) => angle(measurement(pose.landmarks[a]), measurement(pose.landmarks[b]), measurement(pose.landmarks[c]))));
  if (shoulder && torsoScale && torsoScale >= 1e-6) {
    const wristHeights = sideValues(({ wrist }) => {
      const point = measurement(pose.landmarks[wrist]);
      return point ? (point.y - shoulder.y) / torsoScale : null;
    });
    values.wristHeightRelativeShoulderY = average(wristHeights);
    const wristDistances = sideValues(({ wrist }) => {
      const point = measurement(pose.landmarks[wrist]);
      return point ? distance(point, shoulder) / torsoScale : null;
    });
    values.wristDistanceToShoulder = average(wristDistances);
    const hipHeights = sideValues(({ hip: hipIndex, ankle: ankleIndex }) => {
      const hipPoint = measurement(pose.landmarks[hipIndex]);
      const anklePoint = measurement(pose.landmarks[ankleIndex]);
      return hipPoint && anklePoint ? (hipPoint.y - anklePoint.y) / torsoScale : null;
    });
    values.hipHeightRelativeAnkleY = average(hipHeights);
    if (hip) {
      const signedImageX = (shoulder.x - hip.x) * (isMirrored ? -1 : 1);
      values.torsoLeanImageDeg = round(Math.atan2(signedImageX, hip.y - shoulder.y) * 180 / Math.PI);
    }
    const heelHeights = sideValues(({ ankle, heel }) => {
      const anklePoint = measurement(pose.landmarks[ankle]);
      const heelPoint = measurement(pose.landmarks[heel]);
      return anklePoint && heelPoint ? (anklePoint.y - heelPoint.y) / torsoScale : null;
    });
    values.heelHeightRelativeAnkleY = average(heelHeights);
    const lateralElbow = sideValues(({ elbow, wrist }) => {
      const elbowPoint = measurement(pose.landmarks[elbow]);
      const wristPoint = measurement(pose.landmarks[wrist]);
      return elbowPoint && wristPoint ? Math.abs(wristPoint.x - elbowPoint.x) / torsoScale : null;
    });
    values.wristLateralRelativeElbow = average(lateralElbow);
  }
  const leftWrist = measurement(pose.landmarks[15]);
  const rightWrist = measurement(pose.landmarks[16]);
  const leftShoulder = measurement(pose.landmarks[11]);
  const rightShoulder = measurement(pose.landmarks[12]);
  if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
    const shoulderWidth = distance(leftShoulder, rightShoulder);
    values.wristLateralSpread = shoulderWidth >= 1e-6 ? round(Math.abs(leftWrist.x - rightWrist.x) / shoulderWidth) : null;
  }
  return Object.freeze(values);
}

function emptyFeatures(): Readonly<Record<PriorFeature, number | null>> {
  return Object.freeze(emptyFeatureRecord());
}

function emptyFeatureRecord(): Record<PriorFeature, number | null> {
  return Object.fromEntries(ALL_FEATURES.map((feature) => [feature, null])) as Record<PriorFeature, number | null>;
}

function measurement(point: PoseLandmark | undefined): { x: number; y: number } | null {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.visibility) && point.visibility >= 0.5
    ? { x: point.x, y: point.y }
    : null;
}

function midpoint(left: { x: number; y: number } | null, right: { x: number; y: number } | null): { x: number; y: number } | null {
  return left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : null;
}

function distance(left: { x: number; y: number }, right: { x: number; y: number }): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function angle(a: { x: number; y: number } | null, b: { x: number; y: number } | null, c: { x: number; y: number } | null): number | null {
  if (!a || !b || !c) return null;
  const first = { x: a.x - b.x, y: a.y - b.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
  if (denominator < 1e-6) return null;
  return Math.acos(Math.min(1, Math.max(-1, (first.x * second.x + first.y * second.y) / denominator))) * 180 / Math.PI;
}

function nearestPose(poses: readonly PoseEstimate[], timestampMs: number): PoseEstimate | null {
  return poses.reduce<PoseEstimate | null>((nearest, pose) =>
    !nearest || Math.abs(pose.timestampMs - timestampMs) < Math.abs(nearest.timestampMs - timestampMs)
      ? pose
      : nearest,
  null);
}

function sameIdentity(left: SimulatedPriorIdentity, right: SimulatedPriorIdentity): boolean {
  return left.exerciseId === right.exerciseId
    && left.muscleGroup === right.muscleGroup
    && left.variation === right.variation
    && left.equipment === right.equipment
    && left.capturePosition === right.capturePosition
    && left.trainingSide === right.trainingSide
    && left.setupFingerprint === right.setupFingerprint
    && left.coordinateSystem === right.coordinateSystem
    && left.featureSchemaId === right.featureSchemaId
    && left.cameraUpright === right.cameraUpright
    && left.isMirrored === right.isMirrored
    && left.projectionClass === right.projectionClass
    && left.poseModelVersion === right.poseModelVersion;
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value: number): number {
  const rounded = Number(value.toFixed(5));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function captureLabel(position: CapturePosition): string {
  return CAPTURE_POSITIONS.find((candidate) => candidate.id === position)?.label ?? position;
}
