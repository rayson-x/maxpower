import type { NutritionGuardrailRule, ProgramStrategies } from "../knowledge/model";

/**
 * 特殊人群进食范围提醒（消费者，不是知识持有者）。
 *
 * 规则表在知识包（`programStrategies.nutritionGuardrails`），本文件只做匹配与组装。
 *
 * 定位（用户拍板）：第一版只做热量估算，但要能**提醒进食范围**。
 * 所以当用户记录食物、且其档案有健康状况时，命中的规则给出方向性提醒——
 * "这类食物要注意钠"、"这个和药物可能相互作用"——并附转介边界。
 * 我们不给精确克数（那需要个体化医嘱），也不做饮食治疗。
 *
 * 纪律：
 * - 规则全部来自临床指南（tier A 硬性要求）
 * - 没有档案健康状况 → 零提醒（不对健康用户制造焦虑）
 * - 每条提醒都带转介边界
 * - 药物相互作用单独标记（最高优先，用户最易踩坑）
 */

/** 用户档案里的健康状况（结构化集合）。 */
export type HealthCondition = NutritionGuardrailRule["condition"];

export interface NutritionReminder {
  ruleId: string;
  condition: HealthCondition;
  foodCategory: string;
  direction: "caution" | "limit" | "prefer";
  message: string;
  referralBoundary: string;
  citationRef: string;
  /** 是否为药物相互作用（需要最高优先级展示）。 */
  isDrugInteraction: boolean;
}

/** 判断某条提醒是否针对药物相互作用（药物是最易踩坑、最需突出的一类）。 */
function isDrugInteraction(rule: NutritionGuardrailRule): boolean {
  return rule.condition === "on_medication" || /药物|medication|华法林|warfarin|他汀|statin/i.test(rule.messageZh);
}

/**
 * 按用户健康状况与食物类别，匹配应提醒的规则。
 *
 * @param conditions 用户的健康状况集合（来自档案；空则零提醒）
 * @param foodCategories 该次记录里食物命中的类别标签（由食物分类器产生）
 * @param locale 展示语言（默认中文；海外英文）
 */
export function nutritionRemindersFor(input: {
  strategies: ProgramStrategies | undefined;
  conditions: readonly HealthCondition[];
  foodCategories: readonly string[];
  locale?: "en" | "zh";
}): readonly NutritionReminder[] {
  const rules = input.strategies?.nutritionGuardrails ?? [];
  if (!input.conditions.length || !rules.length) return [];
  const locale = input.locale ?? "zh";
  const matched = rules.filter(
    (rule) =>
      input.conditions.includes(rule.condition) && input.foodCategories.includes(rule.foodCategory),
  );
  // 药物相互作用排最前
  const sorted = [...matched].sort(
    (left, right) => Number(isDrugInteraction(right)) - Number(isDrugInteraction(left)),
  );
  return sorted.map((rule) => ({
    ruleId: rule.id,
    condition: rule.condition,
    foodCategory: rule.foodCategory,
    direction: rule.direction,
    message: locale === "zh" ? rule.messageZh : rule.messageEn,
    referralBoundary: locale === "zh" ? rule.referralBoundaryZh : rule.referralBoundaryEn,
    citationRef: rule.citationRef,
    isDrugInteraction: isDrugInteraction(rule),
  }));
}

/**
 * 把提醒渲染成用户可读文本（记录确认卡上的提醒区）。
 * 空提醒返回 undefined（无健康状况时不渲染该区域）。
 */
export function renderNutritionReminders(
  reminders: readonly NutritionReminder[],
  locale: "en" | "zh" = "zh",
): string[] | undefined {
  if (!reminders.length) return undefined;
  const disclaimer =
    locale === "zh"
      ? "以上是基于你档案里健康状况的通用提醒，不是个体化饮食处方；具体请遵医嘱。"
      : "These are general reminders based on your profile, not an individualized diet prescription; follow your clinician's guidance.";
  return [
    ...reminders.map((reminder) => {
      const flag = reminder.isDrugInteraction ? "⚠️ " : "";
      const boundary = locale === "zh" ? `（${reminder.referralBoundary}）` : ` (${reminder.referralBoundary})`;
      return `${flag}${reminder.message}${boundary}`;
    }),
    disclaimer,
  ];
}
