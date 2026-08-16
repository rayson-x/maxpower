import type { GoalContractData, UserProfileData } from "../coach/domain";
import { copy, type LocalizedText, type Locale } from "./copy";
import { estimateBodyFat } from "./bodyComposition";

/**
 * 目标 → 时间反推（数据自适应版，2026-08-12 用户拍板）。
 *
 * 核心原则：**数据可得性决定规划的精细度**。
 *   用户提供了精确数据（当前体脂率 + 目标体脂率）→ 给精确反推（天数 + 三档）
 *   没有 → 退回体重趋势兜底（周降幅区间 + 每周自校准），绝不编造起点
 *
 * 诚实性约束：
 * - 用户可能不愿/不能提供体脂率、围度、骨架、照片。唯一低成本可靠的输入是体重趋势。
 * - 无精确数据时给**区间**和"取决于执行"，不给假精确的单点周数。
 * - 目标优先用可观察状态（"能看到腹肌轮廓"）而非必须仪器的数字。
 */

export const KCAL_PER_KG_FAT = 7700;

function bodyMassStateOf(profile: UserProfileData): { state: "low" | "normal" | "high" | "very_high"; bmi?: number } {
  const height = profile.demographics?.height;
  const weight = profile.demographics?.currentWeight;
  if (!height || !weight) return { state: "normal" };
  const heightCm = height.unit === "cm" ? height.value : height.value * 2.54;
  const weightKg = weight.unit === "kg" ? weight.value : weight.value * 0.45359237;
  if (heightCm <= 0 || weightKg <= 0) return { state: "normal" };
  const bmi = weightKg / (heightCm / 100) ** 2;
  return {
    state: bmi < 19 ? "low" : bmi < 25 ? "normal" : bmi < 30 ? "high" : "very_high",
    bmi: Math.round(bmi * 10) / 10,
  };
}

export function maxDailyDeficitKcal(state: "low" | "normal" | "high" | "very_high"): number {
  switch (state) {
    case "very_high": return 900;
    case "high": return 700;
    case "normal": return 500;
    case "low": return 350;
  }
}

export function fatToLoseKg(input: {
  weightKg: number;
  currentBodyFatPercent?: number;
  targetBodyFatPercent?: number;
}): number | undefined {
  const { weightKg, currentBodyFatPercent, targetBodyFatPercent } = input;
  if (currentBodyFatPercent === undefined || targetBodyFatPercent === undefined) return undefined;
  if (targetBodyFatPercent >= currentBodyFatPercent) return 0;
  const currentFatKg = weightKg * (currentBodyFatPercent / 100);
  const leanKg = weightKg - currentFatKg;
  const targetWeight = leanKg / (1 - targetBodyFatPercent / 100);
  return Math.max(0, weightKg - targetWeight);
}

export interface GoalTimeline {
  /** 数据精细度：精确反推 / 体重趋势兜底。 */
  precision: "precise" | "weight_trend_fallback";
  // ── 精确模式（用户给了体脂率，或由围度/身高体重估算）──
  /** 当前体脂率的来源与置信度（估算必须让用户看见是估算）。 */
  bodyFatSource?: {
    percent: number;
    method: "navy" | "deurenberg_yap" | "navy_bmi_blend" | "user_reported";
    confidence: "high" | "medium" | "low";
    estimated: boolean;
  };
  fatToLoseKg?: number;
  totalDeficitKcal?: number;
  fastestDays?: number;
  paceOptions?: readonly {
    pace: "aggressive" | "standard" | "gentle";
    dailyDeficitKcal: number;
    days: number;
    weeks: number;
    note: LocalizedText;
  }[];
  // ── 兜底模式（只有体重）──
  /** 每周体重变化目标（%体重/周）。 */
  weeklyWeightChangeTarget?: { min: number; max: number };
  /** 给用户的诚实说明（区间 + 取决于执行）；多语言资源，按 locale 解析。 */
  fallbackNote?: LocalizedText;
  /** 缺什么精确数据（补齐后可升级为精确模式）。 */
  upgradableWith?: LocalizedText;
}

/**
 * 目标时间反推。有精确数据→精确；没有→体重趋势兜底。
 */
export function estimateTimeToGoal(
  profile: UserProfileData,
  goal: GoalContractData,
): GoalTimeline {
  const { state } = bodyMassStateOf(profile);
  const maxDeficit = maxDailyDeficitKcal(state);
  const weightKg = profile.demographics?.currentWeight?.value;
  const targetBf = goal.targets?.targetBodyFat?.value;
  // 当前体脂：用户自报优先；没有就从围度/身高体重估算（不要求用户自报）
  const estimate = goal.targets?.currentBodyFat?.value === undefined
    ? estimateBodyFat({ profile })
    : undefined;
  const currentBf = goal.targets?.currentBodyFat?.value ?? estimate?.percent;

  const hasPrecise = weightKg !== undefined && currentBf !== undefined && targetBf !== undefined;

  if (hasPrecise) {
    const fatKg = fatToLoseKg({ weightKg, currentBodyFatPercent: currentBf, targetBodyFatPercent: targetBf }) ?? 0;
    const totalDeficit = fatKg * KCAL_PER_KG_FAT;
    const options = (["aggressive", "standard", "gentle"] as const).map((pace) => {
      const dailyDeficit =
        pace === "aggressive" ? maxDeficit : pace === "standard" ? Math.round(maxDeficit * 0.7) : Math.round(maxDeficit * 0.45);
      const days = Math.ceil(totalDeficit / dailyDeficit);
      return {
        pace,
        dailyDeficitKcal: dailyDeficit,
        days,
        weeks: Math.ceil(days / 7),
        note:
          pace === "aggressive"
            ? copy({
                en: "Fastest path: max safe daily deficit; requires strict load retention, high protein and a circuit-breaker",
                zh: "最快路径：每天顶到安全赤字上限，需严格保负荷+高蛋白+熔断机制",
              })
            : pace === "standard"
              ? copy({
                  en: "Balanced path: moderate deficit, better lean-mass protection and adherence",
                  zh: "平衡路径：赤字适中，瘦体重保护更好，依从性更高",
                })
              : copy({
                  en: "Gentle path: smallest deficit, minimal impact on training performance",
                  zh: "稳健路径：赤字最小，几乎不影响训练表现",
                }),
      };
    });
    return {
      precision: "precise",
      ...(estimate
        ? {
            bodyFatSource: {
              percent: estimate.percent,
              method: estimate.method,
              confidence: estimate.confidence,
              estimated: true,
            },
          }
        : { bodyFatSource: { percent: currentBf, method: "user_reported" as const, confidence: "high" as const, estimated: false } }),
      fatToLoseKg: Math.round(fatKg * 10) / 10,
      totalDeficitKcal: Math.round(totalDeficit),
      fastestDays: Math.ceil(totalDeficit / maxDeficit),
      paceOptions: options,
    };
  }

  // 兜底：只有体重（甚至体重也可能缺），给周降幅区间 + 诚实说明
  const weeklyTarget = (() => {
    switch (state) {
      case "very_high": return { min: 0.5, max: 1.0 };
      case "high": return { min: 0.4, max: 0.8 };
      case "normal": return { min: 0.3, max: 0.6 };
      case "low": return { min: 0.2, max: 0.4 };
    }
  })();
  const weeklyKg = weightKg
    ? {
        minKg: Math.round((weeklyTarget.min / 100) * weightKg * 10) / 10,
        maxKg: Math.round((weeklyTarget.max / 100) * weightKg * 10) / 10,
      }
    : undefined;

  return {
    precision: "weight_trend_fallback",
    weeklyWeightChangeTarget: weeklyTarget,
    fallbackNote: copy({
      en:
        "I won't invent a precise timeline without body-fat data. " +
        `For your build, a reasonable rate is ${weeklyTarget.min}-${weeklyTarget.max}% of body weight per week` +
        (weeklyKg ? ` (about ${weeklyKg.minKg}-${weeklyKg.maxKg} kg)` : "") +
        ". Set your goal by a state you can see yourself (e.g. 'visible ab outline'), and we track progress with real weekly weight trends — how far and how fast depends on execution, and we calibrate as we go. Tell me your current and target body fat for a more precise estimate.",
      zh:
        "没有体脂率数据，我不给你编一个精确周数。" +
        `按你的体型，合理的速度是每周掉体重的 ${weeklyTarget.min}-${weeklyTarget.max}%` +
        (weeklyKg ? `（约 ${weeklyKg.minKg}-${weeklyKg.maxKg} kg）` : "") +
        "。目标用你能自己看到的状态来定（比如「能看到腹肌轮廓」），" +
        "每周用真实体重趋势看进展——能持续多久、到什么程度，取决于执行，我们边走边校准。" +
        "如果你能告诉我当前体脂率和目标，我可以给出更精确的时间估算。",
    }),
    upgradableWith: copy({ en: "current + target body-fat %", zh: "当前体脂率 + 目标体脂率" }),
  };
}
