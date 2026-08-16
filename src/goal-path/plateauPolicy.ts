import type { GoalContractData } from "../coach/domain";

/**
 * 平台判定政策（版本化）。
 *
 * 来源：docs/research/fat-loss-plateau-2026-08-16.md（51/51 引用核验）+
 * 2026-08-16 grilling 裁定。核心证据点：
 * - 自由生活 2 周体重波动 SD ≈ 1.2kg；短期变化 84% 是水/糖原——单一体重读数不构成平台证据。
 * - 真实减脂 0.4kg/周时，3 周应减 1.2kg ≈ 1 个 SD——「3 周不动」刚刚够判，不宽裕。
 * - 多信号（围度/表现/主观）可以把判定窗缩到 1–2 周。
 * - 力量/做功下降不是平台问题，是恢复/缺口超标信号——直接触发调整评估，不等窗口。
 */
export const PLATEAU_POLICY = {
  id: "maxpower.plateau-verification",
  version: "plateau.v1 (2026-08-16 adjudicated)",
  /** 仅体重信号：至少需要 3 周（周均比较）才可判平台。 */
  weightOnlyMinDays: 21,
  /** 多信号齐备（体重 + 围度/表现/主观任一）时的最短判定窗（spec 区间 1–2 周取中）。 */
  multiSignalMinDays: 10,
  /** 周均变化低于该比例（相对体重/周）视为「不动」。 */
  flatWeeklyMeanRatio: 0.002,
  /** 表现趋势下降即真信号（不等判定窗）。 */
  performanceDeclineIsMaterial: true,
} as const;

export interface PlateauAssessment {
  readonly verdict: "not_a_plateau" | "window_too_short" | "plateau_suspected" | "performance_decline_material";
  readonly windowDays: number;
  readonly requiredDays: number;
  readonly signals: readonly string[];
  readonly reasonCode: string;
}

/** ISO 周（周一起）周均序列。 */
export function weeklyMeanWeights(series: readonly { occurredAt: string; valueKg: number }[]): readonly { weekStart: string; meanKg: number }[] {
  const byWeek = new Map<string, number[]>();
  for (const point of [...series].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const date = new Date(`${point.occurredAt.slice(0, 10)}T12:00:00.000Z`);
    const monday = new Date(date);
    monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    byWeek.set(key, [...(byWeek.get(key) ?? []), point.valueKg]);
  }
  return [...byWeek.entries()].map(([weekStart, values]) => ({
    weekStart,
    meanKg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000,
  }));
}

/**
 * 平台真伪判定。确定性、纯函数。
 * @param weeklyMeans 周均体重序列（按周排序）
 * @param circumferenceTrend 围度趋势（有则信号+1）
 * @param performanceTrend 力量/做功趋势（下降 = 真信号，直接 material）
 * @param evaluatedAt 评估日
 */
export function assessPlateau(input: {
  readonly weeklyMeans: readonly { weekStart: string; meanKg: number }[];
  readonly circumferenceTrend: "improving" | "stable" | "declining" | "unknown";
  readonly performanceTrend: "improving" | "stable" | "declining" | "unknown";
  /** 主观好变化（窗内 wellness_note 条数）——用户自述改善是合法信号通道。 */
  readonly wellnessNotesInWindow?: number;
  readonly evaluatedAt: string;
}): PlateauAssessment {
  const means = input.weeklyMeans;
  const first = means[0];
  const last = means.at(-1);
  const windowDays = first && last
    ? Math.round((Date.parse(`${last.weekStart}T00:00:00.000Z`) - Date.parse(`${first.weekStart}T00:00:00.000Z`)) / 86_400_000) + 7
    : 0;
  const subjectivePresent = (input.wellnessNotesInWindow ?? 0) > 0;
  const multiSignal = input.circumferenceTrend !== "unknown" || input.performanceTrend !== "unknown" || subjectivePresent;
  const requiredDays = multiSignal ? PLATEAU_POLICY.multiSignalMinDays : PLATEAU_POLICY.weightOnlyMinDays;

  // 力量/做功下降 = 真信号：与平台判定无关，直接触发调整评估。
  if (PLATEAU_POLICY.performanceDeclineIsMaterial && input.performanceTrend === "declining") {
    return { verdict: "performance_decline_material", windowDays, requiredDays: 0, signals: ["performance_declining"], reasonCode: "plateau_check_performance_decline_is_material" };
  }
  if (means.length < 2 || windowDays < requiredDays) {
    return { verdict: "window_too_short", windowDays, requiredDays, signals: [], reasonCode: multiSignal ? "plateau_check_window_short_multi_signal" : "plateau_check_window_short_weight_only" };
  }
  const weeklyDelta = (last!.meanKg - first!.meanKg) / Math.max(1, (windowDays - 7) / 7);
  const flat = Math.abs(weeklyDelta) < first!.meanKg * PLATEAU_POLICY.flatWeeklyMeanRatio;
  if (!flat) {
    return { verdict: "not_a_plateau", windowDays, requiredDays, signals: ["weight_trending"], reasonCode: "plateau_check_weight_still_moving" };
  }
  // 体重周均不动：多信号里有任何一个还在改善，就不是平台（判据体系：为围度/表现/主观变化庆祝）
  if (input.circumferenceTrend === "improving" || input.performanceTrend === "improving" || subjectivePresent) {
    return { verdict: "not_a_plateau", windowDays, requiredDays, signals: [subjectivePresent ? "subjective_improving" : "other_signals_improving"], reasonCode: "plateau_check_other_signals_progressing" };
  }
  return { verdict: "plateau_suspected", windowDays, requiredDays, signals: ["weight_flat", ...(input.circumferenceTrend !== "unknown" ? [`circumference_${input.circumferenceTrend}`] : []), ...(input.performanceTrend !== "unknown" ? [`performance_${input.performanceTrend}`] : [])], reasonCode: "plateau_check_multi_week_flat" };
}

/**
 * Goal contract successMetrics 默认值（判据体系 2026-08-16）：
 * 围度 / 训练表现 / 执行率是一等指标；体重只以周均趋势出现，永不以「减到 X 斤」
 * 或单日读数出现。模型给出的 successMetrics 优先；缺省时按主目标生成。
 */
export function defaultSuccessMetrics(goal: Pick<GoalContractData, "primaryGoal">): readonly string[] {
  switch (goal.primaryGoal) {
    case "fat_loss_preserve_lean_mass":
      return ["waist_circumference_trend", "key_lift_performance_maintenance", "weekly_weight_trend", "training_adherence"];
    case "hypertrophy":
      return ["target_muscle_circumference_trend", "key_lift_performance_progression", "training_adherence"];
    case "strength":
      return ["key_lift_performance_progression", "training_adherence", "weekly_weight_trend"];
    case "physique":
      return ["waist_shoulder_circumference_trend", "physique_satisfaction_trend", "training_adherence"];
    default:
      return ["training_adherence", "weekly_weight_trend", "subjective_wellbeing_notes"];
  }
}
