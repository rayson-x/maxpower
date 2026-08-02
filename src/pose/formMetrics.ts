import type { PoseEstimate, PoseLandmark } from "../pose/PoseEngine";

/**
 * 左右对称性与轨迹指标:为"左高右低/发力不均/轨迹异常"类指正提供数据证据。
 * 坐标为图像归一化坐标(y 向下);left/right 是画面左右,背面机位时与人的左右相反,
 * 提示词里已说明,由 agent 负责措辞。
 */
export interface SymmetryMetrics {
  /** 肩:画面左肩 y - 右肩 y(负=左肩更高),单位归一化 */
  shoulderDeltaYMean: number | null;
  shoulderDeltaYMax: number | null;
  /** 手腕同上 */
  wristDeltaYMean: number | null;
  wristDeltaYMax: number | null;
  /** 双手腕轨迹幅度分离度:左右手腕各自 y 幅度差 */
  wristAmplitudeAsymmetry: number | null;
  /** 左右肘角均值差(度):发力不对称信号 */
  elbowAngleAsymmetryDeg: number | null;
  /** 数据有效度:双侧同时可见的帧占比 */
  bilateralFrameRatio: number;
}

const SHOULDER_L = 11;
const SHOULDER_R = 12;
const ELBOW_L = 13;
const ELBOW_R = 14;
const WRIST_L = 15;
const WRIST_R = 16;

function visible(l: PoseLandmark | undefined, min = 0.5): l is PoseLandmark {
  return !!l && l.visibility >= min;
}

function angleDeg(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 < 1e-6 || m2 < 1e-6) return NaN;
  const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

function mean(v: number[]): number | null {
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

function round(v: number | null, digits: number): number | null {
  return v === null ? null : Number(v.toFixed(digits));
}

export function computeSymmetryMetrics(poses: PoseEstimate[]): SymmetryMetrics {
  const valid = poses.filter((p) => p.landmarks.length >= 17);
  const bilateral = valid.filter(
    (p) =>
      visible(p.landmarks[SHOULDER_L]) &&
      visible(p.landmarks[SHOULDER_R]) &&
      visible(p.landmarks[WRIST_L]) &&
      visible(p.landmarks[WRIST_R]),
  );

  const shoulderDeltas = bilateral.map(
    (p) => p.landmarks[SHOULDER_L].y - p.landmarks[SHOULDER_R].y,
  );
  const wristDeltas = bilateral.map(
    (p) => p.landmarks[WRIST_L].y - p.landmarks[WRIST_R].y,
  );

  const wristLYs = bilateral.map((p) => p.landmarks[WRIST_L].y);
  const wristRYs = bilateral.map((p) => p.landmarks[WRIST_R].y);
  const ampL = wristLYs.length ? Math.max(...wristLYs) - Math.min(...wristLYs) : null;
  const ampR = wristRYs.length ? Math.max(...wristRYs) - Math.min(...wristRYs) : null;

  const elbowL = valid
    .filter(
      (p) =>
        visible(p.landmarks[SHOULDER_L]) &&
        visible(p.landmarks[ELBOW_L]) &&
        visible(p.landmarks[WRIST_L]),
    )
    .map((p) =>
      angleDeg(p.landmarks[SHOULDER_L], p.landmarks[ELBOW_L], p.landmarks[WRIST_L]),
    )
    .filter((a) => !isNaN(a));
  const elbowR = valid
    .filter(
      (p) =>
        visible(p.landmarks[SHOULDER_R]) &&
        visible(p.landmarks[ELBOW_R]) &&
        visible(p.landmarks[WRIST_R]),
    )
    .map((p) =>
      angleDeg(p.landmarks[SHOULDER_R], p.landmarks[ELBOW_R], p.landmarks[WRIST_R]),
    )
    .filter((a) => !isNaN(a));

  const elbowLMean = mean(elbowL);
  const elbowRMean = mean(elbowR);

  return {
    shoulderDeltaYMean: round(mean(shoulderDeltas), 3),
    shoulderDeltaYMax: shoulderDeltas.length
      ? round(Math.max(...shoulderDeltas.map(Math.abs)), 3)
      : null,
    wristDeltaYMean: round(mean(wristDeltas), 3),
    wristDeltaYMax: wristDeltas.length
      ? round(Math.max(...wristDeltas.map(Math.abs)), 3)
      : null,
    wristAmplitudeAsymmetry:
      ampL !== null && ampR !== null ? round(Math.abs(ampL - ampR), 3) : null,
    elbowAngleAsymmetryDeg:
      elbowLMean !== null && elbowRMean !== null
        ? round(Math.abs(elbowLMean - elbowRMean), 1)
        : null,
    bilateralFrameRatio: valid.length
      ? Number((bilateral.length / valid.length).toFixed(2))
      : 0,
  };
}
