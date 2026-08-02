import type { AutoSegmentation } from "./repSegmenter";
import type { ExerciseId } from "./repSegmenter";
import type { TrajectoryFeatures } from "./trajectory";

/**
 * 链路 A:纯本地、确定性的动作识别。
 *
 * 不调用任何模型。每条判据都是可读的规则,命中即加权计分,
 * 并把命中理由原样带出来 —— 识别错了能立刻看出是哪条规则错了。
 *
 * 关键在于用**轨迹**判据,而不是包围盒:
 * 引体向上和高位下拉的手腕包围盒几乎一样(都是垂直大幅度),
 * 真正的区别是引体时**身体在动**、下拉时**手臂在动** —— 即 bodyTravelRatio。
 */

export interface RuleHit {
  rule: string;
  weight: number;
  detail: string;
}

export interface CandidateScore {
  id: ExerciseId;
  score: number;
  hits: RuleHit[];
  misses: string[];
}

export interface LocalClassification {
  id: ExerciseId | "unknown";
  confidence: "high" | "medium" | "low";
  /** 第一名与第二名的分差,归一化到 0-1 */
  margin: number;
  reasons: string[];
  scores: CandidateScore[];
  /** 数据质量问题;非空时置信度自动降级 */
  dataIssues: string[];
}

export interface ClassifierInput {
  trajectory: TrajectoryFeatures;
  segmentation: AutoSegmentation;
  /** 来自 exerciseFeatures 的坐姿/站姿推断 */
  posture: "seated" | "standing" | "unknown";
}

/** 一条判据:给定输入返回是否命中 + 说明;不适用返回 null */
interface Rule {
  name: string;
  weight: number;
  /** 对哪些动作加分 */
  supports: ExerciseId[];
  evaluate: (input: ClassifierInput) => { hit: boolean; detail: string } | null;
}

const ALL: ExerciseId[] = [
  "barbell_row",
  "pull_up",
  "lat_pulldown",
  "seated_row",
  "straight_arm_pulldown",
];

function elbowRange(t: TrajectoryFeatures): number | null {
  return t.jointRom.find((r) => r.joint === "elbow")?.rangeDeg ?? null;
}

function elbowMean(t: TrajectoryFeatures): number | null {
  return t.jointRom.find((r) => r.joint === "elbow")?.meanDeg ?? null;
}

const RULES: Rule[] = [
  {
    name: "手臂近乎伸直且肘角几乎不变",
    weight: 3,
    supports: ["straight_arm_pulldown"],
    evaluate: ({ trajectory }) => {
      const range = elbowRange(trajectory);
      const meanDeg = elbowMean(trajectory);
      if (range === null || meanDeg === null) return null;
      const hit = range < 40 && meanDeg > 135;
      return {
        hit,
        detail: `肘角均值 ${meanDeg}°、活动范围 ${range}°(判据:范围<40° 且均值>135°)`,
      };
    },
  },
  {
    name: "肘角大幅屈伸",
    weight: 2,
    supports: ["barbell_row", "seated_row", "pull_up", "lat_pulldown"],
    evaluate: ({ trajectory }) => {
      const range = elbowRange(trajectory);
      if (range === null) return null;
      return { hit: range >= 50, detail: `肘角活动范围 ${range}°(判据:≥50°)` };
    },
  },
  {
    name: "身体在动而非手臂在动",
    weight: 3,
    supports: ["pull_up"],
    evaluate: ({ trajectory }) => {
      const r = trajectory.bodyTravelRatio;
      if (r === null) return null;
      return {
        hit: r >= 0.35,
        detail: `身体位移占比 ${r}(肩位移/(肩+腕位移),判据:≥0.35 表示身体在移动)`,
      };
    },
  },
  {
    name: "手臂在动而身体基本不动",
    weight: 2,
    supports: ["lat_pulldown", "seated_row", "straight_arm_pulldown", "barbell_row"],
    evaluate: ({ trajectory }) => {
      const r = trajectory.bodyTravelRatio;
      if (r === null) return null;
      return { hit: r < 0.25, detail: `身体位移占比 ${r}(判据:<0.25 表示身体基本固定)` };
    },
  },
  {
    name: "手腕轨迹以垂直方向为主",
    weight: 2,
    supports: ["pull_up", "lat_pulldown", "straight_arm_pulldown"],
    evaluate: ({ trajectory }) => {
      const axis = trajectory.wristPath?.principalAxisDeg;
      if (axis === undefined || axis === null) return null;
      return { hit: axis >= 55, detail: `手腕路径主轴 ${axis}°(0=水平,90=垂直;判据:≥55°)` };
    },
  },
  {
    name: "手腕轨迹以水平方向为主",
    weight: 2,
    supports: ["barbell_row", "seated_row"],
    evaluate: ({ trajectory }) => {
      const axis = trajectory.wristPath?.principalAxisDeg;
      if (axis === undefined || axis === null) return null;
      return { hit: axis < 55, detail: `手腕路径主轴 ${axis}°(判据:<55° 偏水平)` };
    },
  },
  {
    name: "躯干明显前倾",
    weight: 3,
    supports: ["barbell_row"],
    evaluate: ({ trajectory }) => {
      const lean = trajectory.torsoAngle?.meanDeg;
      if (lean === undefined || lean === null) return null;
      return { hit: lean >= 30, detail: `躯干与竖直方向夹角均值 ${lean}°(判据:≥30°)` };
    },
  },
  {
    name: "躯干接近直立",
    weight: 2,
    supports: ["pull_up", "lat_pulldown", "seated_row"],
    evaluate: ({ trajectory }) => {
      const lean = trajectory.torsoAngle?.meanDeg;
      if (lean === undefined || lean === null) return null;
      return { hit: lean < 25, detail: `躯干夹角均值 ${lean}°(判据:<25°)` };
    },
  },
  {
    name: "坐姿",
    weight: 2,
    supports: ["seated_row", "lat_pulldown"],
    evaluate: ({ posture }) => {
      if (posture === "unknown") return null;
      return { hit: posture === "seated", detail: `姿势推断为 ${posture}` };
    },
  },
  {
    name: "站姿/悬垂",
    weight: 1,
    supports: ["barbell_row", "pull_up", "straight_arm_pulldown"],
    evaluate: ({ posture }) => {
      if (posture === "unknown") return null;
      return { hit: posture === "standing", detail: `姿势推断为 ${posture}` };
    },
  },
  {
    name: "肩关节大幅张合(上臂相对躯干)",
    weight: 2,
    supports: ["straight_arm_pulldown"],
    evaluate: ({ trajectory }) => {
      const shoulder = trajectory.jointRom.find((r) => r.joint === "shoulder");
      const elbow = trajectory.jointRom.find((r) => r.joint === "elbow");
      if (!shoulder || !elbow) return null;
      // 直臂下压:肩的活动范围应该明显大于肘
      return {
        hit: shoulder.rangeDeg > elbow.rangeDeg * 1.5,
        detail: `肩 ${shoulder.rangeDeg}° vs 肘 ${elbow.rangeDeg}°(判据:肩>肘×1.5)`,
      };
    },
  },
];

function confidenceOf(margin: number, issues: string[]): "high" | "medium" | "low" {
  if (issues.length > 0) return margin >= 0.35 ? "medium" : "low";
  if (margin >= 0.3) return "high";
  if (margin >= 0.12) return "medium";
  return "low";
}

function collectDataIssues(input: ClassifierInput): string[] {
  const issues: string[] = [];
  const { trajectory, segmentation } = input;
  if (trajectory.topology === null) issues.push("没有可用的骨架数据");
  if (trajectory.scaledFrameRatio < 0.6) {
    issues.push(`只有 ${Math.round(trajectory.scaledFrameRatio * 100)}% 的帧能算出躯干尺度(肩或髋不可见)`);
  }
  if (!trajectory.wristPath) issues.push("手腕路径不可用");
  if (segmentation.cycles.length === 0) issues.push("没有分出完整的动作循环");
  if (segmentation.periodStrength !== null && segmentation.periodStrength < 0.3) {
    issues.push(`动作周期性弱(自相关 ${segmentation.periodStrength}),可能不是在重复做同一个动作`);
  }
  return issues;
}

/** 链路 A:轨迹特征 → 规则打分 → 动作。全程本地,无网络。 */
export function classifyLocally(input: ClassifierInput): LocalClassification {
  const dataIssues = collectDataIssues(input);

  const scores: CandidateScore[] = ALL.map((id) => ({ id, score: 0, hits: [], misses: [] }));
  const byId = new Map(scores.map((s) => [s.id, s]));

  for (const rule of RULES) {
    const result = rule.evaluate(input);
    if (result === null) continue;
    for (const id of rule.supports) {
      const entry = byId.get(id);
      if (!entry) continue;
      if (result.hit) {
        entry.score += rule.weight;
        entry.hits.push({ rule: rule.name, weight: rule.weight, detail: result.detail });
      } else {
        entry.misses.push(`${rule.name}(${result.detail})`);
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1];
  const totalWeight = RULES.reduce((s, r) => s + r.weight, 0);
  const margin = totalWeight > 0 ? (top.score - (second?.score ?? 0)) / totalWeight : 0;

  const confidence = confidenceOf(margin, dataIssues);
  const noEvidence = top.score <= 0;

  return {
    id: noEvidence || dataIssues.includes("没有可用的骨架数据") ? "unknown" : top.id,
    confidence: noEvidence ? "low" : confidence,
    margin: Number(margin.toFixed(3)),
    reasons: top.hits.map((h) => `${h.rule} — ${h.detail}`),
    scores,
    dataIssues,
  };
}
