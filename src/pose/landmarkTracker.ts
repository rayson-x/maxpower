/**
 * 轨迹预测器:对逐帧视觉识别结果做"预测-验证-拒绝或采纳"。
 *
 * 人体关节在 30fps 下不会瞬移,骨长也是常数。
 * 满足以下任一条件的测量值被拒绝,用恒定速度外推顶替:
 *  - 位移超过物理门限(跳点)
 *  - 所属骨链长度偏离基线过多(解剖上不可能,如肘部缩进躯干)
 *  - 置信度太低
 * 连续丢失超过 maxMissing 帧后该点消失,不再硬画。
 */

export interface TrackedLandmark {
  x: number;
  y: number;
  /** 采纳的真实测量为原始 visibility;外推预测随丢失帧数衰减 */
  visibility: number;
  /** true = 这一帧是预测值,不是视觉测量 */
  predicted: boolean;
}

interface TrackState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastMs: number;
  missing: number;
}

const MIN_VISIBILITY = 0.5;
// 位移门限(归一化坐标/秒):人体关节峰值速度很少超过每秒 1.5 个身位
const MAX_SPEED_PER_SEC = 1.5;
// 速度更新平滑系数
const VELOCITY_EMA = 0.4;
const MAX_MISSING = 8;
// 骨长偏离基线比例上限
const BONE_LENGTH_TOLERANCE = 0.35;

const BONES_BLAZEPOSE33: Array<{ name: string; from: number; to: number }> = [
  { name: "upper_arm_l", from: 11, to: 13 },
  { name: "upper_arm_r", from: 12, to: 14 },
  { name: "forearm_l", from: 13, to: 15 },
  { name: "forearm_r", from: 14, to: 16 },
  { name: "thigh_l", from: 23, to: 25 },
  { name: "thigh_r", from: 24, to: 26 },
];

/** COCO-17 拓扑(RTMPose):肩5/6 肘7/8 腕9/10 髋11/12 膝13/14 */
export const BONES_COCO17: Array<{ name: string; from: number; to: number }> = [
  { name: "upper_arm_l", from: 5, to: 7 },
  { name: "upper_arm_r", from: 6, to: 8 },
  { name: "forearm_l", from: 7, to: 9 },
  { name: "forearm_r", from: 8, to: 10 },
  { name: "thigh_l", from: 11, to: 13 },
  { name: "thigh_r", from: 12, to: 14 },
];

interface Landmark {
  x: number;
  y: number;
  visibility: number;
}

export class LandmarkTracker {
  private tracks = new Map<number, TrackState>();
  private boneBaselines = new Map<string, number>();

  constructor(
    private readonly bones: Array<{ name: string; from: number; to: number }> = BONES_BLAZEPOSE33,
  ) {}

  update(landmarks: Landmark[], timestampMs: number): TrackedLandmark[] {
    const implausible = this.implausibleJoints(landmarks);
    return landmarks.map((landmark, index) =>
      this.trackOne(index, landmark, timestampMs, implausible.has(index)),
    );
  }

  private trackOne(
    index: number,
    landmark: Landmark,
    timestampMs: number,
    boneImplausible: boolean,
  ): TrackedLandmark {
    const state = this.tracks.get(index);
    const measured = landmark.visibility >= MIN_VISIBILITY && !boneImplausible;

    if (!state) {
      if (!measured) {
        return { x: landmark.x, y: landmark.y, visibility: 0, predicted: true };
      }
      this.tracks.set(index, {
        x: landmark.x,
        y: landmark.y,
        vx: 0,
        vy: 0,
        lastMs: timestampMs,
        missing: 0,
      });
      return { x: landmark.x, y: landmark.y, visibility: landmark.visibility, predicted: false };
    }

    const dt = Math.max((timestampMs - state.lastMs) / 1000, 1e-3);
    const predictedX = state.x + state.vx * dt;
    const predictedY = state.y + state.vy * dt;

    if (measured) {
      const jump = Math.hypot(landmark.x - predictedX, landmark.y - predictedY);
      const teleported = jump > MAX_SPEED_PER_SEC * dt;
      // 高置信度的瞬移(人确实可能快速移动)放宽:只拒绝中低置信度的跳点
      if (teleported && landmark.visibility < 0.75) {
        return this.predict(state, predictedX, predictedY, timestampMs);
      }
      const ivx = (landmark.x - state.x) / dt;
      const ivy = (landmark.y - state.y) / dt;
      state.vx = VELOCITY_EMA * ivx + (1 - VELOCITY_EMA) * state.vx;
      state.vy = VELOCITY_EMA * ivy + (1 - VELOCITY_EMA) * state.vy;
      state.x = landmark.x;
      state.y = landmark.y;
      state.lastMs = timestampMs;
      state.missing = 0;
      return { x: state.x, y: state.y, visibility: landmark.visibility, predicted: false };
    }

    return this.predict(state, predictedX, predictedY, timestampMs);
  }

  private predict(
    state: TrackState,
    x: number,
    y: number,
    timestampMs: number,
  ): TrackedLandmark {
    state.missing += 1;
    if (state.missing > MAX_MISSING) {
      this.tracks.delete(stateKey(this.tracks, state));
      return { x, y, visibility: 0, predicted: true };
    }
    // 预测时速度衰减,避免外推越走越远
    state.vx *= 0.8;
    state.vy *= 0.8;
    state.x = x;
    state.y = y;
    state.lastMs = timestampMs;
    return {
      x,
      y,
      visibility: 0.35 * (1 - state.missing / MAX_MISSING),
      predicted: true,
    };
  }

  /** 用高置信帧建立骨长基线,返回骨长突变不可信的关节索引 */
  private implausibleJoints(landmarks: Landmark[]): Set<number> {
    const bad = new Set<number>();
    for (const bone of this.bones) {
      const from = landmarks[bone.from];
      const to = landmarks[bone.to];
      if (!from || !to || from.visibility < MIN_VISIBILITY || to.visibility < MIN_VISIBILITY) {
        continue;
      }
      const length = Math.hypot(from.x - to.x, from.y - to.y);
      const baseline = this.boneBaselines.get(bone.name);
      if (baseline === undefined) {
        if (from.visibility > 0.7 && to.visibility > 0.7 && length > 1e-3) {
          this.boneBaselines.set(bone.name, length);
        }
        continue;
      }
      if (Math.abs(length - baseline) / baseline > BONE_LENGTH_TOLERANCE) {
        // 骨长突变:端点里置信度较低的那个不可信
        bad.add(from.visibility <= to.visibility ? bone.from : bone.to);
      } else {
        // 缓慢更新基线(允许远近变化带来的缩放)
        this.boneBaselines.set(bone.name, baseline * 0.98 + length * 0.02);
      }
    }
    return bad;
  }

  reset(): void {
    this.tracks.clear();
    this.boneBaselines.clear();
  }
}

function stateKey(tracks: Map<number, TrackState>, target: TrackState): number {
  for (const [key, state] of tracks) {
    if (state === target) return key;
  }
  return -1;
}
