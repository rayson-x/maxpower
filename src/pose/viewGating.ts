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
