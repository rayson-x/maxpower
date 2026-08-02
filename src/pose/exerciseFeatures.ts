import type { PoseEstimate, PoseLandmark } from "../pose/PoseEngine";
import { torsoLeanDeg } from "../pose/viewGating";

export interface ExerciseFeatures {
  frameCount: number;
  validFrameRatio: number;
  posture: "seated" | "standing" | "unknown";
  torsoLeanAvgDeg: number | null;
  torsoLeanMaxDeg: number | null;
  wristRangeX: number | null;
  wristRangeY: number | null;
  dominantWristAxis: "horizontal" | "vertical" | null;
  wristAboveShoulderRatio: number | null;
  elbowAngleMeanDeg: number | null;
  elbowAngleRangeDeg: number | null;
}

const NOSE = 0;
const SHOULDER_L = 11;
const SHOULDER_R = 12;
const ELBOW_L = 13;
const ELBOW_R = 14;
const WRIST_L = 15;
const WRIST_R = 16;
const HIP_L = 23;
const HIP_R = 24;
const KNEE_L = 25;
const KNEE_R = 26;

function visible(l: PoseLandmark | undefined, min = 0.5): l is PoseLandmark {
  return !!l && l.visibility >= min;
}

function angleDeg(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (m1 < 1e-6 || m2 < 1e-6) return NaN;
  return (Math.acos(Math.min(1, Math.max(-1, dot / (m1 * m2)))) * 180) / Math.PI;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

/**
 * Extract classification features from a window of pose frames.
 * 只用可见性高的关节,侧视角自动偏向近侧——与指标门控同一原则。
 */
export function computeExerciseFeatures(poses: PoseEstimate[]): ExerciseFeatures {
  const valid = poses.filter((p) => p.landmarks.length === 33);

  const torsoLeans = valid
    .map((p) => torsoLeanDeg(p.worldLandmarks))
    .filter((v): v is number => v !== null);

  // 坐姿 vs 站姿:坐姿时髋膝图像 y 接近,站姿时膝明显低于髋(y 更大)
  const hipKneeGaps = valid.flatMap((p) => {
    const pairs = [
      { hip: p.landmarks[HIP_L], knee: p.landmarks[KNEE_L] },
      { hip: p.landmarks[HIP_R], knee: p.landmarks[KNEE_R] },
    ].filter((pair) => visible(pair.hip) && visible(pair.knee));
    return pairs.map((pair) => pair.knee.y - pair.hip.y);
  });
  const avgGap = mean(hipKneeGaps);
  const posture =
    avgGap === null ? "unknown" : avgGap < 0.08 ? "seated" : "standing";

  // 手腕轨迹:逐帧取可见性更高的手腕
  const wristPoints = valid.flatMap((p) => {
    const candidates = [p.landmarks[WRIST_L], p.landmarks[WRIST_R]].filter((w) =>
      visible(w),
    );
    if (!candidates.length) return [];
    const best =
      candidates.length === 1
        ? candidates[0]
        : candidates[0].visibility >= candidates[1].visibility
          ? candidates[0]
          : candidates[1];
    return [{ x: best.x, y: best.y, shoulderY: bestShoulderY(p) }];
  });
  const xs = wristPoints.map((w) => w.x);
  const ys = wristPoints.map((w) => w.y);
  const rangeX = xs.length ? Math.max(...xs) - Math.min(...xs) : null;
  const rangeY = ys.length ? Math.max(...ys) - Math.min(...ys) : null;
  const dominantWristAxis =
    rangeX === null || rangeY === null
      ? null
      : rangeY >= rangeX
        ? "vertical"
        : "horizontal";

  // 手腕高于肩的比例:引体/高位下拉的起始位特征
  const aboveFrames = wristPoints.filter(
    (w) => w.shoulderY !== null && w.y < w.shoulderY - 0.05,
  ).length;
  const wristAboveShoulderRatio = wristPoints.length
    ? aboveFrames / wristPoints.length
    : null;

  // 肘角(肩-肘-腕):直臂下压几乎不变,划船/引体变化大
  const elbowAngles = valid.flatMap((p) => {
    const sides = [
      { s: p.landmarks[SHOULDER_L], e: p.landmarks[ELBOW_L], w: p.landmarks[WRIST_L] },
      { s: p.landmarks[SHOULDER_R], e: p.landmarks[ELBOW_R], w: p.landmarks[WRIST_R] },
    ].filter((side) => visible(side.s) && visible(side.e) && visible(side.w));
    return sides.map((side) => angleDeg(side.s, side.e, side.w)).filter((a) => !isNaN(a));
  });
  const elbowMean = mean(elbowAngles);
  const elbowRange =
    elbowAngles.length > 1 ? Math.max(...elbowAngles) - Math.min(...elbowAngles) : null;

  return {
    frameCount: poses.length,
    validFrameRatio: poses.length ? valid.length / poses.length : 0,
    posture,
    torsoLeanAvgDeg: torsoLeans.length ? mean(torsoLeans) : null,
    torsoLeanMaxDeg: torsoLeans.length ? Math.max(...torsoLeans) : null,
    wristRangeX: rangeX !== null ? Number(rangeX?.toFixed(3)) : null,
    wristRangeY: rangeY !== null ? Number(rangeY?.toFixed(3)) : null,
    dominantWristAxis,
    wristAboveShoulderRatio:
      wristAboveShoulderRatio !== null ? Number(wristAboveShoulderRatio.toFixed(2)) : null,
    elbowAngleMeanDeg: elbowMean !== null ? Number(elbowMean.toFixed(1)) : null,
    elbowAngleRangeDeg: elbowRange !== null ? Number(elbowRange.toFixed(1)) : null,
  };
}

function bestShoulderY(p: PoseEstimate): number | null {
  const shoulders = [p.landmarks[SHOULDER_L], p.landmarks[SHOULDER_R]].filter((s) =>
    visible(s),
  );
  if (!shoulders.length) return null;
  return shoulders.reduce((sum, s) => sum + s.y, 0) / shoulders.length;
}
