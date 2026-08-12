import type { GoalContractData, UserProfileData } from "../coach/domain";

/**
 * 有氧计划的产品层规则。它把可变的计划选择和不可越过的安全边界分开：
 * - “分钟/RPE/时机”是透明、可校准的起步规则（D），不是医学测量；
 * - 低血糖/相关用药风险时，不自动给空腹或间歇计划。
 */
export interface AerobicPlan {
  role: "health_baseline" | "fat_loss_acceleration" | "endurance_priority";
  sessionsPerWeek: number;
  minutesPerSession: number;
  placement: "after_strength" | "separate_session";
  intensity: "easy" | "moderate" | "vigorous";
  targetRpe: { min: number; max: number };
  talkTest: string;
  /** 空腹不用于“增效”，只有没有风险筛查命中时才是可选的耐受/偏好。 */
  fastedEligible: boolean;
  blockIntervals: boolean;
  safetyNote?: string;
  reasonCodes: readonly string[];
}

export function hasGlucoseRisk(profile: UserProfileData): boolean {
  const safety = profile.metabolicExerciseSafety;
  const knownDiabetes = safety?.diabetesType !== undefined && safety.diabetesType !== "unknown";
  return Boolean(
    safety?.usesInsulinOrSecretagogue ||
      safety?.hypoglycemiaHistory ||
      safety?.recentHypoglycemia ||
      knownDiabetes,
  );
}

/**
 * 先由目标决定“有氧做什么”，再由进食与日程决定“什么时候做”。
 * 未明确要加速减脂时，减脂主目标只得到一节渐进的健康基线，不暗中把恢复占满。
 */
export function aerobicPlanFor(input: {
  goal: GoalContractData;
  profile: UserProfileData;
}): AerobicPlan | undefined {
  const { goal, profile } = input;
  const modifiers = goal.modifiers ?? [];
  const requested = goal.aerobicPreference;
  const floorText = (goal.maintenanceFloors ?? []).join(" ");
  const explicitFloor = /有氧|aerobic|cardio|心肺/i.test(floorText);
  const role = requested?.role
    ?? (modifiers.includes("conditioning") ? "endurance_priority" : undefined)
    ?? (explicitFloor || modifiers.includes("health") || goal.primaryGoal === "fat_loss_preserve_lean_mass"
      ? "health_baseline"
      : undefined);
  if (!role) return undefined;

  const risk = hasGlucoseRisk(profile);
  const wantsIntervals = requested?.intensityPreference === "intervals";
  const timing = requested?.timingPreference;
  const intervalAllowed = wantsIntervals && !risk;
  const intensity = intervalAllowed ? "vigorous" : role === "health_baseline" ? "easy" : "moderate";
  const placement = timing === "separate_session" || role === "endurance_priority"
    ? "separate_session"
    : "after_strength";
  const sessionsPerWeek = role === "fat_loss_acceleration" || role === "endurance_priority" ? 2 : 1;
  const minutesPerSession = role === "health_baseline" ? 30 : 25;

  return {
    role,
    sessionsPerWeek,
    minutesPerSession,
    placement,
    intensity,
    targetRpe: intensity === "vigorous" ? { min: 7, max: 8 } : intensity === "moderate" ? { min: 3, max: 4 } : { min: 2, max: 3 },
    talkTest: intensity === "vigorous"
      ? "只能短句交流；若无法维持技术、头晕或异常不适则停止。"
      : intensity === "moderate"
        ? "能说完整短句、不能轻松唱歌。"
        : "能轻松完整交谈。",
    fastedEligible: !risk && intensity !== "vigorous" && placement === "separate_session",
    blockIntervals: risk,
    ...(risk
      ? { safetyNote: "已报告血糖相关风险：不自动安排空腹或间歇有氧；仅按既有临床运动与监测方案确认后执行。" }
      : {}),
    reasonCodes: [
      `aerobic_role_${role}`,
      `aerobic_placement_${placement}`,
      `aerobic_intensity_${intensity}`,
      ...(wantsIntervals && risk ? ["aerobic_intervals_blocked_glucose_risk"] : []),
      ...(risk ? ["aerobic_fasted_blocked_glucose_risk"] : []),
    ],
  };
}
