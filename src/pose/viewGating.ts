import type { PoseLandmark } from "./PoseEngine";

export type CameraView = "front" | "side" | "oblique45";
export type CapturePosition =
  | "front"
  | "frontLeft45"
  | "left"
  | "rearLeft45"
  | "rear"
  | "rearRight45"
  | "right"
  | "frontRight45";

/**
 * Exact physical placements recorded with a set. `analysisView` deliberately
 * maps to the smaller, validated geometry vocabulary used by the rule engine.
 * Rear placements remain conservative: they do not unlock depth-dependent
 * wrist-trajectory scoring merely because eight choices are exposed in the UI.
 */
export const CAPTURE_POSITIONS: Array<{
  id: CapturePosition;
  label: string;
  analysisView: CameraView;
  guidance: string;
}> = [
  { id: "front", label: "正前", analysisView: "front", guidance: "镜头正对身体前方，适合左右对称观察。" },
  { id: "frontLeft45", label: "左前45°", analysisView: "oblique45", guidance: "左前方约45°，兼顾躯干与双侧可见性。" },
  { id: "left", label: "左侧", analysisView: "side", guidance: "身体左侧，适合行程和躯干角度。" },
  { id: "rearLeft45", label: "左后45°", analysisView: "front", guidance: "左后方：当前仅保守输出对称与躯干观察，不做纵深轨迹评分。" },
  { id: "rear", label: "正后", analysisView: "front", guidance: "镜头正对背部：当前仅保守输出对称与躯干观察。" },
  { id: "rearRight45", label: "右后45°", analysisView: "front", guidance: "右后方：当前仅保守输出对称与躯干观察，不做纵深轨迹评分。" },
  { id: "right", label: "右侧", analysisView: "side", guidance: "身体右侧，适合行程和躯干角度。" },
  { id: "frontRight45", label: "右前45°", analysisView: "oblique45", guidance: "右前方约45°，兼顾躯干与双侧可见性。" },
];

export interface CaptureRecommendation {
  position: CapturePosition;
  reason: string;
}

/**
 * Curated physical placements for a user-selected exercise. This is an
 * explicit default, not vision-based camera steering: the athlete may always
 * override it, and a recording stores the final chosen position.
 *
 * These defaults follow the local capture research: frontal views preserve
 * bilateral shoulder motion, side views preserve hinge/vertical travel, and
 * oblique views are the conservative all-purpose choice.
 */
const CAPTURE_RECOMMENDATIONS: Readonly<Record<string, CaptureRecommendation>> = {
  barbell_bench_press: { position: "frontLeft45", reason: "斜前 45° 可同时保留双腕轨迹与躯干稳定性。" },
  dumbbell_bench_press: { position: "frontLeft45", reason: "斜前 45° 可同时保留双腕轨迹与躯干稳定性。" },
  incline_dumbbell_press: { position: "frontLeft45", reason: "斜前 45° 便于看到上肢行程和凳上躯干。" },
  machine_chest_press: { position: "frontLeft45", reason: "斜前 45° 能看清握把、肘部和座椅支撑。" },
  cable_chest_fly: { position: "front", reason: "正前方最利于比较双臂对称的夹胸轨迹。" },
  push_up: { position: "frontLeft45", reason: "斜前 45° 同时保留躯干直线和肘部行程。" },
  barbell_row: { position: "frontLeft45", reason: "斜前 45° 是当前划船实验 profile 的推荐机位。" },
  one_arm_dumbbell_row: { position: "frontLeft45", reason: "斜前 45° 兼顾拉动侧手臂与躯干支撑。" },
  chest_supported_row: { position: "frontLeft45", reason: "斜前 45° 可见肘部行程且减少器械遮挡。" },
  seated_row: { position: "frontLeft45", reason: "斜前 45° 是当前坐姿划船实验 profile 的推荐机位。" },
  single_arm_cable_row: { position: "frontLeft45", reason: "斜前 45° 可区分单侧手臂与躯干旋转。" },
  pull_up: { position: "front", reason: "正前方最利于观察双臂与身体整体上移。" },
  assisted_pull_up: { position: "front", reason: "正前方可同时保留双臂、身体与辅助平台。" },
  lat_pulldown: { position: "front", reason: "正前方是当前高位下拉实验 profile 的推荐机位。" },
  wide_grip_lat_pulldown: { position: "front", reason: "正前方可保留宽握双手与左右对称。" },
  straight_arm_pulldown: { position: "left", reason: "正侧面最利于当前直臂下压的肩关节行程观察。" },
  bodyweight_squat: { position: "left", reason: "侧面是当前深蹲实验 profile 支持的机位。" },
  barbell_back_squat: { position: "frontLeft45", reason: "斜前 45° 兼顾杆位、膝轨迹和躯干。" },
  leg_press: { position: "left", reason: "侧面更容易保留腿举的膝髋行程。" },
  romanian_deadlift: { position: "left", reason: "侧面最利于记录髋铰链与躯干角度。" },
  walking_lunge: { position: "frontLeft45", reason: "斜前 45° 可分辨左右步次与躯干。" },
  bulgarian_split_squat: { position: "frontLeft45", reason: "斜前 45° 可保留前腿膝轨迹和后脚支撑。" },
  leg_extension: { position: "left", reason: "侧面可清楚记录膝伸展行程。" },
  leg_curl: { position: "left", reason: "侧面可清楚记录膝屈曲行程。" },
  hip_thrust: { position: "left", reason: "侧面最利于记录髋部上下行程。" },
  calf_raise: { position: "left", reason: "侧面可保留踝关节上下行程。" },
  seated_shoulder_press: { position: "frontLeft45", reason: "斜前 45° 是当前推肩 profile 的推荐机位。" },
  lateral_raise: { position: "front", reason: "正前方最利于比较双侧抬臂高度与耸肩。" },
  rear_delt_fly: { position: "rearLeft45", reason: "斜后 45° 可减少躯干遮挡后束飞鸟的手臂。" },
  face_pull: { position: "frontLeft45", reason: "斜前 45° 可绕开绳索遮挡并保留双肘。" },
  front_raise: { position: "frontLeft45", reason: "斜前 45° 可看到前举轨迹与躯干借力。" },
  single_arm_cable_lateral_raise: { position: "frontLeft45", reason: "斜前 45° 可保留单臂、绳索与躯干。" },
  landmine_press: { position: "frontLeft45", reason: "斜前 45° 可记录斜向推举路径与躯干稳定。" },
  cable_y_raise: { position: "front", reason: "正前方最利于保留 Y 形双臂轨迹。" },
  cable_external_rotation: { position: "frontLeft45", reason: "斜前 45° 可区分贴身肘与外旋手部路径。" },
  rear_delt_row: { position: "rearLeft45", reason: "斜后 45° 可保留后束方向的拉动轨迹。" },
  barbell_biceps_curl: { position: "frontLeft45", reason: "斜前 45° 可同时观察肘部与躯干借力。" },
  dumbbell_biceps_curl: { position: "frontLeft45", reason: "斜前 45° 可同时观察双臂与肘部固定。" },
  hammer_curl: { position: "frontLeft45", reason: "斜前 45° 可看清前臂与肘部行程。" },
  cable_biceps_curl: { position: "frontLeft45", reason: "斜前 45° 可同时保留绳索和肘部。" },
  triceps_pushdown: { position: "frontLeft45", reason: "斜前 45° 可看清肘部固定与下压行程。" },
  overhead_triceps_extension: { position: "frontLeft45", reason: "斜前 45° 能避免手臂完全遮脸并保留过顶行程。" },
  skull_crusher: { position: "frontLeft45", reason: "斜前 45° 可保留肘部与器械相对位置。" },
};

export function recommendCapturePosition(exerciseId: string): CaptureRecommendation | null {
  return CAPTURE_RECOMMENDATIONS[exerciseId] ?? null;
}

export const CAMERA_VIEWS: Array<{ id: CameraView; label: string; guidance: string }> = [
  {
    id: "front",
    label: "正面",
    guidance: "正面对镜头。适合看左右对称、身体侧倾;躯干前倾/后仰不可判断",
  },
  {
    id: "side",
    label: "正侧面",
    guidance: "身体与镜头垂直。适合看躯干角度、髋部发力、手腕轨迹;远侧肢体可能被遮挡",
  },
  {
    id: "oblique45",
    label: "45° 侧前(推荐)",
    guidance: "镜头在身体侧前方约 45°。兼顾侧面指标和双侧可见性,大多数动作的默认机位",
  },
];

export interface MetricGate {
  id: string;
  label: string;
  supportedViews: CameraView[];
  refusedReason: string;
}

/**
 * 指标 × 机位门控表:当前机位算不了的指标直接拒答,绝不硬算。
 * 这是 spec 中 CameraProfile 设计的最小实现。
 */
export const METRIC_GATES: MetricGate[] = [
  {
    id: "wrist_trajectory_rep",
    label: "手腕轨迹 rep 计数(占位算法)",
    supportedViews: ["side", "oblique45"],
    refusedReason: "正面机位手腕纵深轨迹不可见,无法可靠计数",
  },
  {
    id: "torso_lean_3d",
    label: "躯干倾角(伪3D实验)",
    supportedViews: ["front", "side", "oblique45"],
    refusedReason: "",
  },
];

export function isMetricSupported(metricId: string, view: CameraView): boolean {
  const gate = METRIC_GATES.find((g) => g.id === metricId);
  return gate ? gate.supportedViews.includes(view) : false;
}

export function refusedMetrics(view: CameraView): MetricGate[] {
  return METRIC_GATES.filter((g) => !g.supportedViews.includes(view));
}

// ---- Layer 3: world-landmark torso lean (pseudo-3D experiment) ----

const SHOULDER_LEFT = 11;
const SHOULDER_RIGHT = 12;
const HIP_LEFT = 23;
const HIP_RIGHT = 24;

/**
 * Angle between the torso axis (hip center → shoulder center) and vertical,
 * computed from MediaPipe world landmarks (meters, origin at hips).
 * Works from any camera view in principle — z accuracy is the open question
 * the research pass is verifying.
 */
export function torsoLeanDeg(worldLandmarks: PoseLandmark[]): number | null {
  // 侧视角远侧肩/髋不可靠:选可见性更高的一侧(肩+髋同侧配对)
  const sides = [
    { shoulder: worldLandmarks[SHOULDER_LEFT], hip: worldLandmarks[HIP_LEFT] },
    { shoulder: worldLandmarks[SHOULDER_RIGHT], hip: worldLandmarks[HIP_RIGHT] },
  ]
    .filter((side) => side.shoulder && side.hip)
    .map((side) => ({
      ...side,
      confidence: Math.min(side.shoulder.visibility, side.hip.visibility),
    }))
    .filter((side) => side.confidence >= 0.5)
    .sort((a, b) => b.confidence - a.confidence);
  const best = sides[0];
  if (!best) return null;
  const torso = {
    x: best.shoulder.x - best.hip.x,
    y: best.shoulder.y - best.hip.y,
    z: best.shoulder.z - best.hip.z,
  };
  const length = Math.hypot(torso.x, torso.y, torso.z);
  if (length < 1e-6) return null;
  // vertical in world coords is -y; angle vs vertical
  const cos = -torso.y / length;
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}
