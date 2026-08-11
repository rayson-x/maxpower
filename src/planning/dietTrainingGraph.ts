import type { DietStrategyDeclaration } from "../knowledge/model";

/**
 * 饮食策略 × 训练计划的供需图（架构决策 2026-08-12）。
 *
 * **不建 diet × training 的组合矩阵**——那是组合爆炸且大部分格子无意义。
 * 训练与饮食不直接互相影响，它们通过四个**共享中间量**互相影响：
 *
 *   训练计划 ──产生需求──▶ ① 糖原需求 ② 能量消耗 ③ 蛋白需求 ④ 恢复负债
 *   饮食策略 ──提供供给──▶ 同四维：碳水可用性 / 能量摄入 / 蛋白供给 / 恢复支持
 *
 * 于是「新增一种饮食策略」= 只声明它在四维上提供什么（0 条训练规则），
 * 「新增一种训练模板」= 只声明它需要什么（0 条饮食规则）。
 * N 种饮食 + M 种训练 = **N+M 条声明**，不是 N×M 格。
 *
 * 「相互影响」的实现是**带优先级的约束满足**，不是对称求最优解：
 *   ① 安全边界 ② 用户饮食约束 ③ 目标所需最小有效刺激 ④ 训练最优化
 * 饮食优先于训练优化，因为饮食是生活方式选择（改动成本高、直接影响依从性），
 * 训练形式相对易调。自动解不了的冲突必须**显式摆出 trade-off 交用户选**。
 */

/** 单日的糖原需求等级（由当天训练内容算出，不是声明）。 */
export type GlycogenDemand = "none" | "low" | "moderate" | "high";

/** 一天的训练需求（供需图的"需求"侧）。 */
export interface DayTrainingDemand {
  date: string;
  glycogenDemand: GlycogenDemand;
  /** 高强度工作（≥高疲劳主项 或 间歇有氧）是否出现在这一天。 */
  hasHighIntensityWork: boolean;
  /** 该日直接组总数（容量代理指标）。 */
  directSets: number;
  aerobicMinutes: number;
}

/** 一周的训练需求汇总。 */
export interface WeeklyTrainingDemand {
  days: readonly DayTrainingDemand[];
  totalDirectSets: number;
  highIntensitySessions: number;
  aerobicMinutes: number;
  /** 高糖原需求日数量（决定高碳日配额）。 */
  highGlycogenDays: number;
}

/** 碳水日型（碳循环的形式化输出）。 */
export type CarbDayType = "high" | "moderate" | "low";

/** 冲突的严重度与处理方式。 */
export interface CouplingConflict {
  ruleId: string;
  severity: "blocking" | "tradeoff" | "advisory";
  /** 机器可读的冲突码（进 trace）。 */
  code: string;
  /** 用户可读的前因后果说明。 */
  explanation: string;
  /** 按优先级排列的可选解法（第一项是系统默认采用的）。 */
  resolutions: readonly {
    kind: "adjust_training_form" | "adjust_carb_timing" | "adjust_volume" | "inform_tradeoff" | "request_user_choice";
    description: string;
  }[];
  evidenceRefs: readonly string[];
}

export interface CouplingResult {
  /** 每天的碳水日型（按需供能的直接输出）。 */
  carbDayTypes: Readonly<Record<string, CarbDayType>>;
  conflicts: readonly CouplingConflict[];
  /** 需要写进 PlannerTrace 的边触发记录。 */
  traceEvents: readonly string[];
  /** 策略与目标的适配度（用于向用户说明取舍）。 */
  goalFit: "good" | "workable_with_tradeoffs" | "poor";
}

// ───────────────────────── 需求侧：从计划算出 ─────────────────────────

/**
 * 单日糖原需求（产品规则 D）：由该日的高强度工作、直接组数与有氧强度推导。
 * 依据方向：高强度与大容量抗阻工作依赖糖解供能；低强度有氧不依赖糖原
 * （Impey et al. 2018 fuel-for-the-work-required 框架）。
 */
export function glycogenDemandForDay(input: {
  directSets: number;
  hasHighIntensityWork: boolean;
  aerobicMinutes: number;
  aerobicIsHighIntensity: boolean;
}): GlycogenDemand {
  if (input.directSets === 0 && input.aerobicMinutes === 0) return "none";
  if (input.aerobicIsHighIntensity) return "high";
  if (input.directSets === 0) return "low"; // 只有低强度有氧
  if (input.hasHighIntensityWork && input.directSets >= 10) return "high";
  if (input.directSets >= 10 || input.hasHighIntensityWork) return "moderate";
  return "low";
}

/** 把一周的需求汇总（供冲突检测与碳水分配使用）。 */
export function summarizeWeeklyDemand(days: readonly DayTrainingDemand[]): WeeklyTrainingDemand {
  return {
    days,
    totalDirectSets: days.reduce((sum, day) => sum + day.directSets, 0),
    highIntensitySessions: days.filter((day) => day.hasHighIntensityWork).length,
    aerobicMinutes: days.reduce((sum, day) => sum + day.aerobicMinutes, 0),
    highGlycogenDays: days.filter((day) => day.glycogenDemand === "high").length,
  };
}

// ───────────────────────── 供给侧 × 需求侧：碳水分配 ─────────────────────────

/**
 * 碳水日型分配（C4 边的实现）：当日糖原需求决定当日碳水档位。
 *
 * 纪律：这是**在周总量内重新分配**，不增加总量——周总量由能量目标（赤字/盈余）决定。
 * 碳循环本身不产生额外减脂（等热量下低碳无优势），它的正当用途是按训练需求供能。
 */
export function assignCarbDayTypes(
  demand: WeeklyTrainingDemand,
  strategy: DietStrategyDeclaration,
): Readonly<Record<string, CarbDayType>> {
  const result: Record<string, CarbDayType> = {};
  for (const day of demand.days) {
    if (strategy.carbAvailability.pattern === "very_low") {
      // 极低碳策略没有"高碳日"概念；仍按需求区分是否给训练前少量碳水
      result[day.date] = day.glycogenDemand === "high" ? "moderate" : "low";
      continue;
    }
    if (strategy.carbAvailability.pattern === "constant") {
      result[day.date] = "moderate";
      continue;
    }
    // cycled：按糖原需求分三档
    result[day.date] =
      day.glycogenDemand === "high" ? "high"
      : day.glycogenDemand === "moderate" ? "moderate"
      : "low";
  }
  return result;
}

// ───────────────────────── 边：耦合规则 ─────────────────────────

/**
 * 耦合规则集（图的边）。每条规则：检测条件 → 冲突码 → 按优先级的解法 → 解释 → 证据。
 * 新增饮食策略不需要改这里；新增训练模板也不需要。
 */
export function evaluateCoupling(input: {
  demand: WeeklyTrainingDemand;
  strategy: DietStrategyDeclaration;
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass";
  /** 用户是否明确锁定了该饮食策略（锁定时不建议换策略）。 */
  dietLocked: boolean;
}): CouplingResult {
  const { demand, strategy, goal } = input;
  const conflicts: CouplingConflict[] = [];
  const traceEvents: string[] = [];

  // ── C1 糖原依赖型工作 vs 碳水可用性 ──
  if (demand.highIntensitySessions > 0 && strategy.supports.highIntensityWork !== "full") {
    const poor = strategy.supports.highIntensityWork === "poor";
    conflicts.push({
      ruleId: "C1_glycogen_demand_vs_carb_availability",
      severity: poor ? "tradeoff" : "advisory",
      code: `carb_availability_limits_high_intensity_work:${strategy.id}`,
      explanation:
        `你选的饮食策略（${strategy.nameZh}）碳水可用性${poor ? "很低" : "偏低"}，` +
        `而计划里有 ${demand.highIntensitySessions} 次依赖糖原的高强度工作。` +
        `高强度与大容量抗阻训练靠糖解供能，糖原不足时负荷与容量会掉——` +
        `而保住负荷正是保瘦体重的关键。默认处理：${
          input.dietLocked
            ? "保留你的饮食策略，改用较低次数保负荷并减少间歇有氧"
            : "改用较低次数保负荷并减少间歇有氧"
        }。`,
      resolutions: [
        { kind: "adjust_training_form", description: "高强度工作改为较低次数、较长休息（保负荷、降糖原消耗）" },
        { kind: "adjust_carb_timing", description: "训练前后集中安排少量碳水（局部供能），不改变周总量" },
        { kind: "inform_tradeoff", description: "告知：此策略下高强度容量会受限，进阶速度可能变慢" },
        ...(input.dietLocked ? [] : [{ kind: "request_user_choice" as const, description: "或改用允许周期性高碳日的策略" }]),
      ],
      evidenceRefs: ["impey_2018_fuel_for_the_work_required", "acsm_2026_resistance_training"],
    });
    traceEvents.push(`coupling:C1:${strategy.id}:high_intensity_sessions=${demand.highIntensitySessions}`);
  }

  // ── C2 能量赤字 vs 可恢复训练量 ──
  if (goal === "fat_loss_preserve_lean_mass" && demand.totalDirectSets > 0) {
    const highVolume = demand.totalDirectSets >= 60;
    if (highVolume && strategy.supports.highVolumeWork !== "full") {
      conflicts.push({
        ruleId: "C2_energy_deficit_vs_recoverable_volume",
        severity: "advisory",
        code: "deficit_limits_recoverable_volume",
        explanation:
          `减脂期的能量赤字会降低恢复能力，而本周计划有 ${demand.totalDirectSets} 个直接组。` +
          `减脂期的训练量应该**维持**而不是增加——赤字下加量通常适得其反。` +
          `默认处理：维持当前周量，不再上调；如果恢复信号变差，先减可选刺激。`,
        resolutions: [
          { kind: "adjust_volume", description: "维持周量不上调；恢复变差时先减可选/孤立动作" },
          { kind: "inform_tradeoff", description: "告知：赤字期以保住负荷为目标，不追加量" },
        ],
        evidenceRefs: ["murphy_koehler_2022_energy_deficiency"],
      });
      traceEvents.push(`coupling:C2:deficit_volume_cap:${demand.totalDirectSets}`);
    }
  }

  // ── C5 低碳状态下有氧强度 ──
  if (strategy.carbAvailability.pattern === "very_low" && demand.aerobicMinutes > 0) {
    traceEvents.push(`coupling:C5:low_carb_prefers_low_intensity_aerobic`);
    conflicts.push({
      ruleId: "C5_carb_availability_vs_aerobic_intensity",
      severity: "advisory",
      code: "low_carb_prefers_low_intensity_aerobic",
      explanation:
        `极低碳状态下高强度间歇的质量会明显下降，但低强度有氧**不依赖糖原**——` +
        `所以有氧安排在这个策略下应以低强度为主，这不是妥协，是匹配。`,
      resolutions: [
        { kind: "adjust_training_form", description: "有氧以低强度为主（说话测试：能连续说话、微喘）" },
      ],
      evidenceRefs: ["impey_2018_fuel_for_the_work_required"],
    });
  }

  // ── 策略 × 目标适配度 ──
  const fitKey = goal === "fat_loss_preserve_lean_mass" ? "fatLoss" : goal;
  const goalFit = strategy.goalFit[fitKey] ?? "workable_with_tradeoffs";
  if (goalFit === "poor") {
    conflicts.push({
      ruleId: "F1_strategy_goal_fit",
      severity: "tradeoff",
      code: `strategy_goal_fit_poor:${strategy.id}:${goal}`,
      explanation:
        `${strategy.nameZh}与你当前目标的适配度较低：${strategy.goalFitNote ?? "该组合下目标进展会明显变慢"}。` +
        `你可以坚持这个饮食策略（我会据此调训练），也可以换策略——这是你的选择，我把代价说清楚。`,
      resolutions: [
        { kind: "inform_tradeoff", description: "说明该组合的代价与预期进展速度" },
        { kind: "request_user_choice", description: "由用户决定是否更换饮食策略" },
      ],
      evidenceRefs: strategy.sourceRefs,
    });
    traceEvents.push(`coupling:F1:goal_fit_poor:${strategy.id}:${goal}`);
  }

  return {
    carbDayTypes: assignCarbDayTypes(demand, strategy),
    conflicts,
    traceEvents,
    goalFit,
  };
}
