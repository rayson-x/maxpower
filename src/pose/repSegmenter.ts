import type { PoseEstimate, PoseLandmark } from "./PoseEngine";
import {
  detectTopology,
  dominantPeriod,
  JOINT_INDEX,
  robustRange,
  torsoScale,
  type JointIndex,
  type Topology,
} from "./trajectory";

/**
 * 动作专属的 rep 分割:选对信号 → 平滑 → 滞后阈值找极值交替 → 分段。
 * 替换之前"手腕 y 拐点"的占位计数器(它把视频循环都算成了 9-11s 的假 rep)。
 *
 * 两种用法:
 * - segmentRepsBySignal(poses, signal, extreme) —— profile 已知时分期;
 * - segmentRepsAuto(poses) —— 不知道动作,自动挑周期性最强的信号,
 *   只给出"一端极值 → 另一端极值 → 回到起点"的循环,**不声称哪半程是向心**。
 */

export interface RepSegment {
  repIndex: number;
  startMs: number;
  /** 发力极点(收缩最深)时间 */
  peakMs: number;
  endMs: number;
  durationMs: number;
  /** 向心(发力)阶段时长 */
  concentricMs: number;
  /** 离心(还原)阶段时长 */
  eccentricMs: number;
  /** 信号幅度(归一化) */
  amplitude: number;
  /** Side used for both the phase signal and its downstream quality evidence. */
  evidenceSide?: "left" | "right";
}

interface Sample {
  t: number;
  v: number;
}

const SHOULDER_L = 11;
const ELBOW_L = 13;
const WRIST_L = 15;
const HIP_L = 23;
const KNEE_L = 25;
const ANKLE_L = 27;

function visible(l: PoseLandmark | undefined): l is PoseLandmark {
  return !!l && l.visibility >= 0.5;
}

/** 每帧取可见性更高的一侧,返回该侧关节三元组 */
function bestSide(
  p: PoseEstimate,
  a: number,
  b: number,
  c: number,
  forcedSide?: "left" | "right",
) {
  const left = [p.landmarks[a], p.landmarks[b], p.landmarks[c]];
  // BlazePose 左右对称索引:11/12, 13/14, 15/16 — 调用方传左侧索引
  const right = [p.landmarks[a + 1], p.landmarks[b + 1], p.landmarks[c + 1]];
  const score = (triple: typeof left) =>
    triple.every(visible) ? Math.min(...triple.map((l) => l.visibility)) : -1;
  if (forcedSide === "left") return left;
  if (forcedSide === "right") return right;
  return score(left) >= score(right) ? left : right;
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

export type SignalKind = "elbow_angle" | "wrist_height" | "shoulder_angle" | "knee_angle";

/** 不分左右的逻辑关节名,供需要报告"这个数值依赖哪些关节"的消费方使用。 */
export type LogicalJoint = "shoulder" | "elbow" | "wrist" | "hip" | "knee" | "ankle";

/**
 * extractSignal() 实际读取的关节,与其代码逐一对应,是消费方(逐 rep 指标提取器)
 * 报告数据可信度时唯一权威的关节依赖来源。
 *
 * 注意 shoulder_angle 这里是 hip-shoulder-**wrist**(见 extractSignal 的 else 分支),
 * 与 AUTO_SIGNAL_JOINTS 里同名的 shoulder_angle(hip-shoulder-elbow)不是同一个三元组——
 * 已知动作路径与自动路径对"shoulder_angle"的定义本就不同,这是既有实现里的一处历史不一致,
 * 本次不改动任何一边的行为,只是如实各自导出。
 */
export const SIGNAL_JOINTS: Record<SignalKind, readonly LogicalJoint[]> = {
  elbow_angle: ["shoulder", "elbow", "wrist"],
  knee_angle: ["hip", "knee", "ankle"],
  wrist_height: ["shoulder", "wrist"],
  shoulder_angle: ["hip", "shoulder", "wrist"],
};

function extractSignal(
  poses: PoseEstimate[],
  kind: SignalKind,
  forcedSide?: "left" | "right",
): Sample[] {
  const samples: Sample[] = [];
  for (const p of poses) {
    if (p.landmarks.length < 25) continue;
    let v = NaN;
    if (kind === "elbow_angle") {
      const [s, e, w] = bestSide(p, SHOULDER_L, ELBOW_L, WRIST_L, forcedSide);
      if (visible(s) && visible(e) && visible(w)) v = angleDeg(s, e, w);
    } else if (kind === "wrist_height") {
      const [s, , w] = bestSide(p, SHOULDER_L, ELBOW_L, WRIST_L, forcedSide);
      // 手腕低于肩的垂直距离(向下为正,下拉动作拉到最低时值最大)
      if (visible(s) && visible(w)) v = w.y - s.y;
    } else if (kind === "knee_angle") {
      const [h, k, a] = bestSide(p, HIP_L, KNEE_L, ANKLE_L, forcedSide);
      if (visible(h) && visible(k) && visible(a)) v = angleDeg(h, k, a);
    } else {
      const [h, s, w] = bestSide(p, HIP_L, SHOULDER_L, WRIST_L, forcedSide);
      if (visible(h) && visible(s) && visible(w)) v = angleDeg(h, s, w);
    }
    if (!isNaN(v)) samples.push({ t: p.timestampMs, v });
  }
  return samples;
}

function smooth(samples: Sample[], alpha = 0.35): Sample[] {
  if (samples.length === 0) return samples;
  const out: Sample[] = [{ ...samples[0] }];
  for (let i = 1; i < samples.length; i += 1) {
    out.push({
      t: samples[i].t,
      v: alpha * samples[i].v + (1 - alpha) * out[i - 1].v,
    });
  }
  return out;
}

const MIN_REP_MS = 700;
/**
 * 一个循环的时长上限。原来 8s 太紧:慢速引体/下拉单次接近甚至超过 8s,
 * 循环会被整个丢弃,分期结果为空(实测视频 1 就是这样)。放宽到 12s。
 */
const MAX_REP_MS = 12_000;

interface Extremum {
  t: number;
  v: number;
  type: "min" | "max";
}

/**
 * 滞后阈值找交替极值。滞回带 = 全幅度 × hysteresisRatio,滤掉抖动造成的假极值。
 */
function findExtrema(samples: Sample[], hysteresis: number): Extremum[] {
  const extrema: Extremum[] = [];
  let trend: "up" | "down" | null = null;
  let candidate: Extremum = { t: samples[0].t, v: samples[0].v, type: "min" };

  // 定向之前必须**分别**记住走过的最低点和最高点。
  // 早先这里只维护一个 candidate,并且"只要当前样本更小就当最小、更大就当最大",
  // 于是 candidate 一直追着信号跑,和当前值的差永远接近 0、跨不过滞回带,
  // trend 永远停在 null —— 整段信号只产出 1 个极值,循环自然一个都切不出来。
  let runMin = { t: samples[0].t, v: samples[0].v };
  let runMax = { t: samples[0].t, v: samples[0].v };

  for (const s of samples) {
    if (trend === null) {
      if (s.v < runMin.v) runMin = { t: s.t, v: s.v };
      if (s.v > runMax.v) runMax = { t: s.t, v: s.v };
      if (s.v - runMin.v > hysteresis) {
        // 从最低点起涨了一个滞回带 → 已确认那是个极小值
        extrema.push({ ...runMin, type: "min" });
        trend = "up";
        candidate = { t: s.t, v: s.v, type: "max" };
      } else if (runMax.v - s.v > hysteresis) {
        extrema.push({ ...runMax, type: "max" });
        trend = "down";
        candidate = { t: s.t, v: s.v, type: "min" };
      }
    } else if (trend === "up") {
      if (s.v > candidate.v) {
        candidate = { t: s.t, v: s.v, type: "max" };
      } else if (candidate.v - s.v > hysteresis) {
        extrema.push(candidate);
        trend = "down";
        candidate = { t: s.t, v: s.v, type: "min" };
      }
    } else {
      if (s.v < candidate.v) {
        candidate = { t: s.t, v: s.v, type: "min" };
      } else if (s.v - candidate.v > hysteresis) {
        extrema.push(candidate);
        trend = "up";
        candidate = { t: s.t, v: s.v, type: "max" };
      }
    }
  }
  extrema.push(candidate);
  return extrema;
}

/** rep = 相邻两个"伸展极值"夹一个"收缩极值" */
function buildCycles(
  extrema: Extremum[],
  effortType: "min" | "max",
  range: number,
): Array<{ startMs: number; peakMs: number; endMs: number; amplitude: number }> {
  const restType = effortType === "min" ? "max" : "min";
  const out: Array<{ startMs: number; peakMs: number; endMs: number; amplitude: number }> = [];
  for (let i = 1; i < extrema.length - 1; i += 1) {
    const prev = extrema[i - 1];
    const curr = extrema[i];
    const next = extrema[i + 1];
    if (curr.type !== effortType || prev.type !== restType || next.type !== restType) {
      continue;
    }
    const durationMs = next.t - prev.t;
    if (durationMs < MIN_REP_MS || durationMs > MAX_REP_MS) continue;
    out.push({
      startMs: prev.t,
      peakMs: curr.t,
      endMs: next.t,
      amplitude: Number((Math.abs(curr.v - (prev.v + next.v) / 2) / range).toFixed(3)),
    });
  }
  return out;
}

/**
 * 分割 reps:收缩极点 = 信号最小值(肘角/肩角)或最大值(手腕高度)。
 */
/** Profile-driven segmentation seam; the legacy exercise-id API delegates here. */
export function segmentRepsBySignal(
  poses: PoseEstimate[],
  kind: SignalKind,
  effortExtreme: "min" | "max",
): RepSegment[] {
  const evidenceSide = resolveSignalSide(poses, kind);
  const raw = extractSignal(poses, kind, evidenceSide);
  if (raw.length < 10) return [];
  const samples = smooth(raw);

  const values = samples.map((s) => s.v);
  // 稳健幅度:单帧跟丢会把 max-min 撑满,滞回带随之过宽,真实 rep 反而跨不过去
  const range = robustRange(values).range;
  if (range <= 0) return [];

  // effort 在信号低端(肘角小=收缩)还是高端(手腕低于肩最多=收缩)
  const extrema = findExtrema(samples, range * 0.2);
  return buildCycles(extrema, effortExtreme, range).map((c, i) => ({
    repIndex: i + 1,
    startMs: c.startMs,
    peakMs: c.peakMs,
    endMs: c.endMs,
    durationMs: c.endMs - c.startMs,
    concentricMs: c.peakMs - c.startMs,
    eccentricMs: c.endMs - c.peakMs,
    amplitude: c.amplitude,
    evidenceSide,
  }));
}

function resolveSignalSide(
  poses: readonly PoseEstimate[],
  kind: SignalKind,
): "left" | "right" {
  const leftIndices =
    kind === "elbow_angle"
      ? [SHOULDER_L, ELBOW_L, WRIST_L]
      : kind === "wrist_height"
        ? [SHOULDER_L, WRIST_L]
        : kind === "knee_angle"
          ? [HIP_L, KNEE_L, ANKLE_L]
        : [HIP_L, SHOULDER_L, WRIST_L];
  const score = (offset: 0 | 1) =>
    Math.min(
      ...leftIndices.map((index) => {
        const values = poses.map((pose) => pose.landmarks[index + offset]?.visibility ?? 0);
        return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
      }),
    );
  return score(1) > score(0) ? "right" : "left";
}

// ---------- 动作无关的自动分期 ----------

/**
 * 一个运动循环。**刻意不叫 concentric/eccentric** —— 还不知道是什么动作时,
 * 无法判断哪半程是发力:划船是"拉近=发力",深蹲却是"下蹲=离心"。
 * 谁是向心留给知道动作之后再定。
 */
export interface RepCycle {
  index: number;
  /** 循环起点(信号在一端的极值) */
  startMs: number;
  /** 行程另一端的极值 —— 动作的"顶点/最深处" */
  extremeMs: number;
  /** 回到起始端 */
  endMs: number;
  durationMs: number;
  /** 归一化幅度 */
  amplitude: number;
}

export type AutoSignalKind =
  | "elbow_angle"
  | "knee_angle"
  | "hip_angle"
  | "shoulder_angle"
  | "wrist_height"
  | "hip_height";

export interface AutoSegmentation {
  signal: AutoSignalKind | null;
  /** 该信号的自相关周期强度 0-1 */
  periodStrength: number | null;
  periodSec: number | null;
  cycles: RepCycle[];
  /** 极值在信号低端还是高端 */
  extremeAtLow: boolean;
  /** 候选信号的评分排名,用于诊断"为什么选了这个信号" */
  ranking: Array<{ signal: AutoSignalKind; score: number; normRange: number; strength: number }>;
}

function autoSignalSeries(
  poses: PoseEstimate[],
  idx: JointIndex,
  kind: AutoSignalKind,
): { samples: Sample[]; norm: number } {
  const samples: Sample[] = [];
  // 角度信号按 180° 归一;位置信号按躯干长归一
  const angleTriplets: Partial<Record<AutoSignalKind, Array<[number, number, number]>>> = {
    elbow_angle: [
      [idx.shoulderL, idx.elbowL, idx.wristL],
      [idx.shoulderR, idx.elbowR, idx.wristR],
    ],
    knee_angle: [
      [idx.hipL, idx.kneeL, idx.ankleL],
      [idx.hipR, idx.kneeR, idx.ankleR],
    ],
    hip_angle: [
      [idx.shoulderL, idx.hipL, idx.kneeL],
      [idx.shoulderR, idx.hipR, idx.kneeR],
    ],
    shoulder_angle: [
      [idx.hipL, idx.shoulderL, idx.elbowL],
      [idx.hipR, idx.shoulderR, idx.elbowR],
    ],
  };

  const triplets = angleTriplets[kind];
  const scales: number[] = [];

  for (const p of poses) {
    const s = torsoScale(p.landmarks, idx);
    if (s !== null) scales.push(s);

    if (triplets) {
      let best: number | null = null;
      let bestVis = -1;
      for (const [a, b, c] of triplets) {
        const la = p.landmarks[a];
        const lb = p.landmarks[b];
        const lc = p.landmarks[c];
        if (!visible(la) || !visible(lb) || !visible(lc)) continue;
        const vis = Math.min(la.visibility, lb.visibility, lc.visibility);
        const v = angleDeg(la, lb, lc);
        if (!Number.isNaN(v) && vis > bestVis) {
          best = v;
          bestVis = vis;
        }
      }
      if (best !== null) samples.push({ t: p.timestampMs, v: best });
      continue;
    }

    if (kind === "wrist_height") {
      const sh = [p.landmarks[idx.shoulderL], p.landmarks[idx.shoulderR]].filter(visible);
      const wr = [p.landmarks[idx.wristL], p.landmarks[idx.wristR]].filter(visible);
      if (!sh.length || !wr.length) continue;
      const sy = sh.reduce((a, l) => a + l.y, 0) / sh.length;
      const wy = wr.reduce((a, l) => a + l.y, 0) / wr.length;
      samples.push({ t: p.timestampMs, v: wy - sy });
    } else {
      const hp = [p.landmarks[idx.hipL], p.landmarks[idx.hipR]].filter(visible);
      if (!hp.length) continue;
      samples.push({ t: p.timestampMs, v: hp.reduce((a, l) => a + l.y, 0) / hp.length });
    }
  }

  const meanScale = scales.length ? scales.reduce((a, b) => a + b, 0) / scales.length : 0;
  const norm = triplets ? 180 : meanScale > 1e-3 ? meanScale : 0;
  return { samples, norm };
}

const AUTO_SIGNALS: AutoSignalKind[] = [
  "elbow_angle",
  "knee_angle",
  "hip_angle",
  "shoulder_angle",
  "wrist_height",
  "hip_height",
];

/**
 * autoSignalSeries() 实际读取的关节,与 SIGNAL_JOINTS 是两张独立的表——
 * 见 SIGNAL_JOINTS 上的注释:这里的 shoulder_angle 是 hip-shoulder-**elbow**,
 * 与已知动作路径的同名信号不是同一个三元组。
 */
export const AUTO_SIGNAL_JOINTS: Record<AutoSignalKind, readonly LogicalJoint[]> = {
  elbow_angle: ["shoulder", "elbow", "wrist"],
  knee_angle: ["hip", "knee", "ankle"],
  hip_angle: ["shoulder", "hip", "knee"],
  shoulder_angle: ["hip", "shoulder", "elbow"],
  wrist_height: ["shoulder", "wrist"],
  hip_height: ["hip"],
};

/** 幅度太小的信号不可能是主导动作,直接淘汰(角度<15°,位置<0.15 躯干长) */
const MIN_NORM_RANGE = 15 / 180;

/**
 * 不知道动作是什么时,自动挑出周期性最强、幅度最大的信号来分期。
 * 用途:在识别动作**之前**就能定位"起始位 / 中间位 / 顶点"三个相位,
 * 好按相位抽取截图交给识别环节。
 */
/** 单个候选信号的完整诊断结果 —— harness 用它离线比较,不必开浏览器。 */
export interface SignalDiagnosis {
  signal: AutoSignalKind;
  /** 归一化幅度(角度按 180°,位置按躯干长) */
  normRange: number;
  periodSec: number | null;
  /** 自相关强度 0-1 */
  strength: number;
  score: number;
  /** 极值在信号低端还是高端 */
  extremeAtLow: boolean;
  /** 交替极值个数 —— 太少说明滞回带过宽 */
  extremaCount: number;
  /** 用当前策略真正切出来的循环 */
  cycles: RepCycle[];
  /** 平滑后的信号序列,供 harness 导出 CSV 画图 */
  samples: Sample[];
  /** 被淘汰的原因;通过则为 null */
  rejected: string | null;
}

function buildCyclesFor(samples: Sample[]): {
  extremeAtLow: boolean;
  extremaCount: number;
  cycles: RepCycle[];
} {
  const range = robustRange(samples.map((s) => s.v)).range;
  if (range <= 0) return { extremeAtLow: true, extremaCount: 0, cycles: [] };
  const extrema = findExtrema(samples, range * 0.2);
  // 极点在低端还是高端:用两端极值数量投票,相同则默认低端(角度类信号收缩即变小)
  const minCount = extrema.filter((e) => e.type === "min").length;
  const maxCount = extrema.filter((e) => e.type === "max").length;
  const extremeAtLow = minCount >= maxCount;
  const cycles = buildCycles(extrema, extremeAtLow ? "min" : "max", range).map((c, i) => ({
    index: i + 1,
    startMs: c.startMs,
    extremeMs: c.peakMs,
    endMs: c.endMs,
    durationMs: c.endMs - c.startMs,
    amplitude: c.amplitude,
  }));
  return { extremeAtLow, extremaCount: extrema.length, cycles };
}

/**
 * 对**每个**候选信号都完整跑一遍分期。
 * segmentRepsAuto 用它来选信号;harness 用它来离线诊断"为什么选了这个/为什么切不出循环"。
 */
export function diagnoseSignals(poses: PoseEstimate[]): SignalDiagnosis[] {
  const topology: Topology | null = detectTopology(poses);
  if (!topology || poses.length < 12) return [];
  const idx = JOINT_INDEX[topology];

  const out: SignalDiagnosis[] = [];
  for (const kind of AUTO_SIGNALS) {
    const { samples: raw, norm } = autoSignalSeries(poses, idx, kind);
    if (raw.length < 12 || norm <= 0) {
      out.push({
        signal: kind, normRange: 0, periodSec: null, strength: 0, score: 0,
        extremeAtLow: true, extremaCount: 0, cycles: [], samples: [],
        rejected: raw.length < 12 ? `样本不足(${raw.length})` : "无法归一化(躯干尺度缺失)",
      });
      continue;
    }
    const samples = smooth(raw);
    const normRange = robustRange(samples.map((s) => s.v)).range / norm;
    const period = dominantPeriod(samples);
    const strength = period?.strength ?? 0;
    // 幅度决定"这个关节是否参与",周期性决定"这个信号是否稳定可分期"
    const score = normRange * (0.3 + 0.7 * strength);
    const tooSmall = normRange < MIN_NORM_RANGE;
    const built = tooSmall
      ? { extremeAtLow: true, extremaCount: 0, cycles: [] as RepCycle[] }
      : buildCyclesFor(samples);
    out.push({
      signal: kind,
      normRange: Number(normRange.toFixed(3)),
      periodSec: period?.periodSec ?? null,
      strength: Number(strength.toFixed(3)),
      score: Number(score.toFixed(3)),
      extremeAtLow: built.extremeAtLow,
      extremaCount: built.extremaCount,
      cycles: built.cycles,
      samples,
      rejected: tooSmall ? `幅度过小(${normRange.toFixed(3)} < ${MIN_NORM_RANGE.toFixed(3)})` : null,
    });
  }
  return out;
}

/** 一个信号至少要切出这么多循环,才算"真的能分期" */
const MIN_USABLE_CYCLES = 2;

/**
 * 不知道动作是什么时,自动挑信号来分期。
 *
 * 选法是**先看结果再看分数**:先只在"真能切出 >=2 个循环"的信号里挑分最高的。
 * 早先只按分数挑,结果在实测视频里选中了幅度最大但周期性最差的 wrist_height
 * (幅度 1.338 / 周期性 0.136),而周期性明显更干净的 elbow_angle(0.387)被压掉,
 * 于是一个循环都切不出来。分数只是先验,能不能分期是可以直接验证的事实。
 */
export function segmentRepsAuto(poses: PoseEstimate[]): AutoSegmentation {
  const diagnoses = diagnoseSignals(poses);
  const ranking = diagnoses
    .map((d) => ({
      signal: d.signal,
      score: d.score,
      normRange: d.normRange,
      strength: d.strength,
    }))
    .sort((a, b) => b.score - a.score);

  const empty: AutoSegmentation = {
    signal: null,
    periodStrength: null,
    periodSec: null,
    cycles: [],
    extremeAtLow: true,
    ranking,
  };
  if (diagnoses.length === 0) return empty;

  const usable = diagnoses.filter(
    (d) => !d.rejected && d.cycles.length >= MIN_USABLE_CYCLES,
  );
  const pool = usable.length > 0 ? usable : diagnoses.filter((d) => !d.rejected);
  if (pool.length === 0) return empty;

  const best = pool.reduce((a, b) => (b.score > a.score ? b : a));
  return {
    signal: best.signal,
    periodStrength: best.strength,
    periodSec: best.periodSec,
    cycles: best.cycles,
    extremeAtLow: best.extremeAtLow,
    ranking,
  };
}

/**
 * 从循环里挑一个"最有代表性"的:幅度最接近中位数的那个,
 * 避开第一个(常含起势)和最后一个(常被截断)。
 */
export function representativeCycle(cycles: RepCycle[]): RepCycle | null {
  if (cycles.length === 0) return null;
  const pool = cycles.length >= 3 ? cycles.slice(1, -1) : cycles;
  const sorted = [...pool].sort((a, b) => a.amplitude - b.amplitude);
  return sorted[Math.floor(sorted.length / 2)];
}
