import type { PoseEstimate, PoseLandmark } from "./PoseEngine";

/**
 * 轨迹特征:把关键点在时间轴上真正走过的"路"描述出来。
 *
 * 与 exerciseFeatures.ts 的区别——那里的 wristRangeX/Y 只是包围盒的宽高,
 * 描述不了路径形状。这里给出主轴方向、直线度、路径长度、逐 rep 一致性、
 * 左右路径分离度、周期性,以及"身体动还是手臂动"这类只有轨迹才能回答的问题。
 *
 * 坐标为图像归一化坐标(y 向下)。拓扑自适应 BlazePose-33 与 COCO-17。
 */

// ---------- 拓扑 ----------

export type Topology = "blazepose33" | "coco17";

export interface JointIndex {
  shoulderL: number; shoulderR: number;
  elbowL: number; elbowR: number;
  wristL: number; wristR: number;
  hipL: number; hipR: number;
  kneeL: number; kneeR: number;
  ankleL: number; ankleR: number;
}

export const JOINT_INDEX: Record<Topology, JointIndex> = {
  blazepose33: {
    shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
    hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28,
  },
  coco17: {
    shoulderL: 5, shoulderR: 6, elbowL: 7, elbowR: 8, wristL: 9, wristR: 10,
    hipL: 11, hipR: 12, kneeL: 13, kneeR: 14, ankleL: 15, ankleR: 16,
  },
};

export function detectTopology(poses: PoseEstimate[]): Topology | null {
  const sample = poses.find((p) => p.landmarks.length > 0);
  if (!sample) return null;
  if (sample.landmarks.length >= 33) return "blazepose33";
  if (sample.landmarks.length >= 17) return "coco17";
  return null;
}

// ---------- 基础工具 ----------

const MIN_VIS = 0.5;

function visible(l: PoseLandmark | undefined): l is PoseLandmark {
  return !!l && l.visibility >= MIN_VIS;
}

interface Pt {
  t: number;
  x: number;
  y: number;
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

function stdev(v: number[]): number | null {
  const m = mean(v);
  if (m === null || v.length < 2) return null;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function round(v: number | null, digits: number): number | null {
  return v === null || !Number.isFinite(v) ? null : Number(v.toFixed(digits));
}

function percentileOf(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * 稳健幅度:用 5%/95% 分位而不是 max-min。
 *
 * 单帧跟丢就能把肘角压到 0.4°、把膝角撑到 179.9°(实测),
 * 用原始极值算出来的 range 会被这种离群点撑满,进而让分期的滞回带过宽、
 * 真实的 rep 反而跨不过去 —— 分不出循环的根因就在这里。
 */
export function robustRange(values: number[], p = 0.05): {
  lo: number;
  hi: number;
  range: number;
} {
  const sorted = [...values].sort((a, b) => a - b);
  const lo = percentileOf(sorted, p);
  const hi = percentileOf(sorted, 1 - p);
  return { lo, hi, range: Number.isFinite(hi - lo) ? hi - lo : 0 };
}

/** 躯干尺度:肩中点到髋中点的距离,用来把像素幅度归一成"身位" */
export function torsoScale(p: PoseLandmark[], idx: JointIndex): number | null {
  const sl = p[idx.shoulderL];
  const sr = p[idx.shoulderR];
  const hl = p[idx.hipL];
  const hr = p[idx.hipR];
  const shoulders = [sl, sr].filter(visible);
  const hips = [hl, hr].filter(visible);
  if (!shoulders.length || !hips.length) return null;
  const sx = mean(shoulders.map((s) => s.x))!;
  const sy = mean(shoulders.map((s) => s.y))!;
  const hx = mean(hips.map((h) => h.x))!;
  const hy = mean(hips.map((h) => h.y))!;
  const d = Math.hypot(sx - hx, sy - hy);
  return d > 1e-3 ? d : null;
}

// ---------- 路径形状 ----------

export interface PathShape {
  /** 采样点数 */
  points: number;
  /** 路径总长(躯干长为单位) */
  pathLength: number;
  /** 首尾直线距离(躯干长为单位) */
  netDisplacement: number;
  /** 直线度 = net / path。1≈单向直线,→0≈往返或闭合回路 */
  straightness: number;
  /** 主轴与水平方向夹角:0°=水平,90°=垂直 */
  principalAxisDeg: number;
  /** 线性度 = 主特征值占比。1≈完美直线,0.5≈各向同性 */
  linearity: number;
  /** 主轴方向上的位移幅度(躯干长为单位) */
  primaryRange: number;
  /** 次轴方向上的位移幅度 —— 直线动作里这就是"跑偏量" */
  secondaryRange: number;
  rangeX: number;
  rangeY: number;
}

/** 2×2 协方差矩阵闭式特征分解 */
function principalAxis(pts: Pt[]): { deg: number; linearity: number; theta: number } {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  sxx /= n;
  syy /= n;
  sxy /= n;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const disc = Math.sqrt((sxx - syy) ** 2 + 4 * sxy * sxy);
  const l1 = (sxx + syy + disc) / 2;
  const l2 = (sxx + syy - disc) / 2;
  const total = l1 + l2;
  let deg = Math.abs((theta * 180) / Math.PI);
  if (deg > 90) deg = 180 - deg;
  return {
    deg,
    linearity: total > 1e-12 ? l1 / total : 0,
    theta,
  };
}

export function pathShape(pts: Pt[], scale: number): PathShape | null {
  if (pts.length < 3 || scale <= 0) return null;
  let pathLength = 0;
  for (let i = 1; i < pts.length; i += 1) {
    pathLength += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const net = Math.hypot(
    pts[pts.length - 1].x - pts[0].x,
    pts[pts.length - 1].y - pts[0].y,
  );
  const { deg, linearity, theta } = principalAxis(pts);
  // 投影到主/次轴,量出主方向幅度与垂直于主方向的跑偏量
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const proj = pts.map((p) => p.x * ux + p.y * uy);
  const perp = pts.map((p) => -p.x * uy + p.y * ux);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    points: pts.length,
    pathLength: Number((pathLength / scale).toFixed(3)),
    netDisplacement: Number((net / scale).toFixed(3)),
    straightness: Number((pathLength > 1e-6 ? net / pathLength : 0).toFixed(3)),
    principalAxisDeg: Number(deg.toFixed(1)),
    linearity: Number(linearity.toFixed(3)),
    primaryRange: Number(((Math.max(...proj) - Math.min(...proj)) / scale).toFixed(3)),
    secondaryRange: Number(((Math.max(...perp) - Math.min(...perp)) / scale).toFixed(3)),
    rangeX: Number(((Math.max(...xs) - Math.min(...xs)) / scale).toFixed(3)),
    rangeY: Number(((Math.max(...ys) - Math.min(...ys)) / scale).toFixed(3)),
  };
}

// ---------- 关节角度 ROM ----------

export type JointName = "elbow" | "shoulder" | "hip" | "knee";

export interface JointRom {
  joint: JointName;
  meanDeg: number;
  /** 5% 分位(抗离群) */
  p05Deg: number;
  /** 95% 分位(抗离群) */
  p95Deg: number;
  /** 稳健活动范围 = p95 - p05。判据一律用这个,不要用 rawMax-rawMin */
  rangeDeg: number;
  /** 原始极值,只用于诊断跟丢程度 */
  rawMinDeg: number;
  rawMaxDeg: number;
}

/** 每帧取可见性更好的一侧,返回该关节的角度序列 */
function jointAngleSeries(
  poses: PoseEstimate[],
  idx: JointIndex,
  joint: JointName,
): Array<{ t: number; v: number }> {
  const triplets: Record<JointName, Array<[number, number, number]>> = {
    // 肩-肘-腕
    elbow: [
      [idx.shoulderL, idx.elbowL, idx.wristL],
      [idx.shoulderR, idx.elbowR, idx.wristR],
    ],
    // 髋-肩-肘(上臂相对躯干的张角)
    shoulder: [
      [idx.hipL, idx.shoulderL, idx.elbowL],
      [idx.hipR, idx.shoulderR, idx.elbowR],
    ],
    // 肩-髋-膝
    hip: [
      [idx.shoulderL, idx.hipL, idx.kneeL],
      [idx.shoulderR, idx.hipR, idx.kneeR],
    ],
    // 髋-膝-踝
    knee: [
      [idx.hipL, idx.kneeL, idx.ankleL],
      [idx.hipR, idx.kneeR, idx.ankleR],
    ],
  };
  const out: Array<{ t: number; v: number }> = [];
  for (const p of poses) {
    let best: number | null = null;
    let bestVis = -1;
    for (const [a, b, c] of triplets[joint]) {
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
    if (best !== null) out.push({ t: p.timestampMs, v: best });
  }
  return out;
}

function romOf(series: Array<{ t: number; v: number }>, joint: JointName): JointRom | null {
  if (series.length < 3) return null;
  const vs = series.map((s) => s.v);
  const { lo, hi, range } = robustRange(vs);
  return {
    joint,
    meanDeg: Number(mean(vs)!.toFixed(1)),
    p05Deg: Number(lo.toFixed(1)),
    p95Deg: Number(hi.toFixed(1)),
    rangeDeg: Number(range.toFixed(1)),
    rawMinDeg: Number(Math.min(...vs).toFixed(1)),
    rawMaxDeg: Number(Math.max(...vs).toFixed(1)),
  };
}

// ---------- 周期性 ----------

/** 自相关求主周期。返回秒与强度(0-1),数据不足返回 null */
export function dominantPeriod(
  series: Array<{ t: number; v: number }>,
): { periodSec: number; strength: number } | null {
  if (series.length < 20) return null;
  const vs = series.map((s) => s.v);
  const m = mean(vs)!;
  const c = vs.map((v) => v - m);
  const denom = c.reduce((s, v) => s + v * v, 0);
  if (denom < 1e-9) return null;
  const spanMs = series[series.length - 1].t - series[0].t;
  if (spanMs <= 0) return null;
  const dtMs = spanMs / (series.length - 1);
  const minLag = Math.max(2, Math.round(400 / dtMs)); // 最快 0.4s 一个循环
  const maxLag = Math.min(Math.floor(vs.length / 2), Math.round(8000 / dtMs));
  if (maxLag <= minLag + 1) return null;

  // 先把整条自相关算出来
  const r: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let acc = 0;
    for (let i = 0; i + lag < c.length; i += 1) acc += c[i] * c[i + lag];
    r.push(acc / denom);
  }

  // 取**第一个局部极大**而不是全局最大:自相关随 lag 单调衰减,
  // 取全局最大会稳定地落在允许的最小 lag 上,得到 0.37s 这种荒谬的"周期"(实测)。
  // 真正的周期体现为衰减曲线上的第一个回升峰。
  let bestLag = -1;
  let bestVal = -Infinity;
  for (let i = 1; i < r.length - 1; i += 1) {
    if (r[i] > r[i - 1] && r[i] >= r[i + 1] && r[i] > bestVal) {
      bestVal = r[i];
      bestLag = minLag + i;
      break; // 第一个峰即基频;后面的峰是它的倍频
    }
  }
  if (bestLag < 0 || bestVal <= 0) return null;
  return {
    periodSec: Number(((bestLag * dtMs) / 1000).toFixed(2)),
    strength: Number(Math.min(1, bestVal).toFixed(3)),
  };
}

// ---------- 逐 rep 一致性 ----------

export interface RepConsistency {
  /** 参与比较的 rep 数 */
  reps: number;
  /** 各 rep 主轴幅度的标准差 / 均值 —— 越小越一致 */
  amplitudeCv: number | null;
  /** 各 rep 主轴方向的标准差(度) */
  axisStdDeg: number | null;
  /** 归一化时间重采样后,各 rep 路径两两平均偏差(躯干长为单位) */
  pathDeviation: number | null;
}

/** 按归一化时间把一段路径重采样成 n 个点 */
function resample(pts: Pt[], n: number): Pt[] {
  if (pts.length < 2) return [];
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  if (t1 <= t0) return [];
  const out: Pt[] = [];
  let j = 0;
  for (let i = 0; i < n; i += 1) {
    const target = t0 + ((t1 - t0) * i) / (n - 1);
    while (j < pts.length - 2 && pts[j + 1].t < target) j += 1;
    const a = pts[j];
    const b = pts[j + 1] ?? pts[j];
    const span = b.t - a.t;
    const w = span > 0 ? (target - a.t) / span : 0;
    out.push({ t: target, x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w });
  }
  return out;
}

const RESAMPLE_N = 16;

export function repConsistency(
  path: Pt[],
  segments: Array<{ startMs: number; endMs: number }>,
  scale: number,
): RepConsistency {
  const perRep = segments
    .map((seg) => path.filter((p) => p.t >= seg.startMs && p.t <= seg.endMs))
    .filter((pts) => pts.length >= 4);

  if (perRep.length < 2 || scale <= 0) {
    return { reps: perRep.length, amplitudeCv: null, axisStdDeg: null, pathDeviation: null };
  }

  const shapes = perRep
    .map((pts) => pathShape(pts, scale))
    .filter((s): s is PathShape => s !== null);
  const amps = shapes.map((s) => s.primaryRange);
  const axes = shapes.map((s) => s.principalAxisDeg);
  const ampMean = mean(amps);
  const ampSd = stdev(amps);

  // 路径偏差:每条 rep 路径按归一化时间重采样,减去各自起点后两两比较
  const curves = perRep
    .map((pts) => resample(pts, RESAMPLE_N))
    .filter((c) => c.length === RESAMPLE_N)
    .map((c) => c.map((p) => ({ ...p, x: p.x - c[0].x, y: p.y - c[0].y })));

  let deviation: number | null = null;
  if (curves.length >= 2) {
    let acc = 0;
    let pairs = 0;
    for (let i = 0; i < curves.length; i += 1) {
      for (let k = i + 1; k < curves.length; k += 1) {
        let d = 0;
        for (let s = 0; s < RESAMPLE_N; s += 1) {
          d += Math.hypot(curves[i][s].x - curves[k][s].x, curves[i][s].y - curves[k][s].y);
        }
        acc += d / RESAMPLE_N;
        pairs += 1;
      }
    }
    deviation = pairs ? acc / pairs / scale : null;
  }

  return {
    reps: perRep.length,
    amplitudeCv:
      ampMean && ampSd !== null && ampMean > 1e-6 ? Number((ampSd / ampMean).toFixed(3)) : null,
    axisStdDeg: round(stdev(axes), 1),
    pathDeviation: round(deviation, 3),
  };
}

// ---------- 主入口 ----------

export interface TrajectoryFeatures {
  topology: Topology | null;
  frames: number;
  /** 有躯干尺度可用的帧占比 */
  scaledFrameRatio: number;
  /** 各关节角度活动范围,按 rangeDeg 降序 */
  jointRom: JointRom[];
  /** 活动范围最大的关节 —— 膝主导/髋主导/肘主导/肩主导 */
  dominantJoint: JointName | null;
  /** 手腕路径。整段固定用同一侧,见 wristSide */
  wristPath: PathShape | null;
  /** wristPath 用的是哪一侧(画面左右) */
  wristSide: "left" | "right" | null;
  wristPathLeft: PathShape | null;
  wristPathRight: PathShape | null;
  /** 左右手腕路径重采样后的平均分离度(躯干长为单位) */
  bilateralPathGap: number | null;
  /** 髋中点路径 —— 身体本身有没有位移 */
  hipPath: PathShape | null;
  /** 肩中点路径 */
  shoulderPath: PathShape | null;
  /**
   * 身体位移占比 = 肩路径主轴幅度 / (肩 + 腕路径主轴幅度)。
   * 引体向上≈身体动(高),高位下拉≈手臂动(低) —— 包围盒特征区分不了这一对。
   */
  bodyTravelRatio: number | null;
  /** 主导信号的周期 */
  period: { periodSec: number; strength: number } | null;
  /** 逐 rep 路径一致性(需传入分段) */
  consistency: RepConsistency | null;
  /** 躯干相对画面竖直方向的倾角 */
  torsoAngle: { meanDeg: number; maxDeg: number; driftDeg: number } | null;
}

function midPath(
  poses: PoseEstimate[],
  a: number,
  b: number,
): Pt[] {
  const out: Pt[] = [];
  for (const p of poses) {
    const la = p.landmarks[a];
    const lb = p.landmarks[b];
    const pts = [la, lb].filter(visible);
    if (!pts.length) continue;
    out.push({
      t: p.timestampMs,
      x: mean(pts.map((l) => l.x))!,
      y: mean(pts.map((l) => l.y))!,
    });
  }
  return out;
}

function sidePath(poses: PoseEstimate[], index: number): Pt[] {
  const out: Pt[] = [];
  for (const p of poses) {
    const l = p.landmarks[index];
    if (!visible(l)) continue;
    out.push({ t: p.timestampMs, x: l.x, y: l.y });
  }
  return out;
}

/**
 * 画面坐标下躯干与竖直方向的夹角(不依赖 world landmarks)。
 * 导出供逐 rep 指标提取器复用同一份角度计算,按 rep 区间切片调用即可,
 * 不需要重新推导这个公式。
 */
export function torsoAngleSeries(poses: PoseEstimate[], idx: JointIndex): number[] {
  const out: number[] = [];
  for (const p of poses) {
    const sh = [p.landmarks[idx.shoulderL], p.landmarks[idx.shoulderR]].filter(visible);
    const hp = [p.landmarks[idx.hipL], p.landmarks[idx.hipR]].filter(visible);
    if (!sh.length || !hp.length) continue;
    const sx = mean(sh.map((l) => l.x))!;
    const sy = mean(sh.map((l) => l.y))!;
    const hx = mean(hp.map((l) => l.x))!;
    const hy = mean(hp.map((l) => l.y))!;
    // 躯干向量指向头部;与 -y(画面上方)的夹角
    const dx = sx - hx;
    const dy = sy - hy;
    const m = Math.hypot(dx, dy);
    if (m < 1e-6) continue;
    const cos = -dy / m;
    out.push((Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI);
  }
  return out;
}

export function computeTrajectoryFeatures(
  poses: PoseEstimate[],
  segments: Array<{ startMs: number; endMs: number }> = [],
): TrajectoryFeatures {
  const topology = detectTopology(poses);
  const empty: TrajectoryFeatures = {
    topology,
    frames: poses.length,
    scaledFrameRatio: 0,
    jointRom: [],
    dominantJoint: null,
    wristPath: null,
    wristSide: null,
    wristPathLeft: null,
    wristPathRight: null,
    bilateralPathGap: null,
    hipPath: null,
    shoulderPath: null,
    bodyTravelRatio: null,
    period: null,
    consistency: null,
    torsoAngle: null,
  };
  if (!topology) return empty;

  const idx = JOINT_INDEX[topology];
  const scales = poses
    .map((p) => torsoScale(p.landmarks, idx))
    .filter((s): s is number => s !== null);
  const scale = mean(scales);
  if (scale === null) return empty;
  empty.scaledFrameRatio = Number((scales.length / Math.max(poses.length, 1)).toFixed(2));

  // 关节 ROM
  const joints: JointName[] = ["elbow", "shoulder", "hip", "knee"];
  const series = new Map(joints.map((j) => [j, jointAngleSeries(poses, idx, j)]));
  const jointRom = joints
    .map((j) => romOf(series.get(j)!, j))
    .filter((r): r is JointRom => r !== null)
    .sort((a, b) => b.rangeDeg - a.rangeDeg);

  const leftPts = sidePath(poses, idx.wristL);
  const rightPts = sidePath(poses, idx.wristR);

  // 手腕路径:**整段固定一侧**。原来逐帧挑"可见性更好的一侧",
  // 遇到宽握(两手相距 2.4 个躯干长)时会在左右手之间来回跳,
  // 把两条垂直路径搅成一条主轴 3.5° 的"水平"路径(实测)。
  const sideScore = (pts: Pt[], index: number) => {
    if (pts.length === 0) return -1;
    const vis = poses
      .map((p) => p.landmarks[index])
      .filter(visible)
      .map((l) => l.visibility);
    return vis.length ? (vis.reduce((a, b) => a + b, 0) / vis.length) * pts.length : -1;
  };
  const useLeft = sideScore(leftPts, idx.wristL) >= sideScore(rightPts, idx.wristR);
  const wristPts = useLeft ? leftPts : rightPts;
  const wristSide: "left" | "right" = useLeft ? "left" : "right";
  const hipPts = midPath(poses, idx.hipL, idx.hipR);
  const shoulderPts = midPath(poses, idx.shoulderL, idx.shoulderR);

  const wristPath = pathShape(wristPts, scale);
  const shoulderPath = pathShape(shoulderPts, scale);

  // 左右路径分离度
  let bilateralPathGap: number | null = null;
  const lc = resample(leftPts, RESAMPLE_N);
  const rc = resample(rightPts, RESAMPLE_N);
  if (lc.length === RESAMPLE_N && rc.length === RESAMPLE_N) {
    let acc = 0;
    for (let i = 0; i < RESAMPLE_N; i += 1) {
      acc += Math.hypot(lc[i].x - rc[i].x, lc[i].y - rc[i].y);
    }
    bilateralPathGap = Number((acc / RESAMPLE_N / scale).toFixed(3));
  }

  // 身体位移占比:肩(身体)动得多还是腕(手臂)动得多
  let bodyTravelRatio: number | null = null;
  if (wristPath && shoulderPath) {
    const total = wristPath.primaryRange + shoulderPath.primaryRange;
    if (total > 1e-6) {
      bodyTravelRatio = Number((shoulderPath.primaryRange / total).toFixed(3));
    }
  }

  // 周期性:用 ROM 最大的关节角序列
  const dominantJoint = jointRom.length ? jointRom[0].joint : null;
  const period = dominantJoint ? dominantPeriod(series.get(dominantJoint)!) : null;

  const torsoVals = torsoAngleSeries(poses, idx);
  const torsoAngle = torsoVals.length
    ? {
        meanDeg: Number(mean(torsoVals)!.toFixed(1)),
        maxDeg: Number(Math.max(...torsoVals).toFixed(1)),
        driftDeg: Number((Math.max(...torsoVals) - Math.min(...torsoVals)).toFixed(1)),
      }
    : null;

  return {
    topology,
    frames: poses.length,
    scaledFrameRatio: empty.scaledFrameRatio,
    jointRom,
    dominantJoint,
    wristPath,
    wristSide,
    wristPathLeft: pathShape(leftPts, scale),
    wristPathRight: pathShape(rightPts, scale),
    bilateralPathGap,
    hipPath: pathShape(hipPts, scale),
    shoulderPath,
    bodyTravelRatio,
    period,
    consistency: segments.length >= 2 ? repConsistency(wristPts, segments, scale) : null,
    torsoAngle,
  };
}
