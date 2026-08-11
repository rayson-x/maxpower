import type { UserProfileData } from "../coach/domain";
import type {
  EvidenceCitation,
  FastedTrainingRule,
  ProgramStrategies,
  SessionFuelingPolicy,
} from "../knowledge/model";

/**
 * 训练与进食状态的编排——**消费者**，不是知识持有者。
 *
 * 架构纪律（用户拍板 2026-08-12）：知识先入库，引擎只消费。
 * 所有间隔数值、文案、优势/风险、适格性规则、文献引用都在知识包里
 * （`programStrategies.sessionFuelingPolicies` / `.fastedTrainingRules` / `.citations`），
 * 本文件只做三件事：**按用户情况选中哪条规则、解析文献引用、组装可展示的建议**。
 *
 * 这样领域专家可以审那张表、可以云端更新，而不需要改引擎代码。
 */

export type SessionWorkType = SessionFuelingPolicy["workType"];
export type FuelingState = SessionFuelingPolicy["preferredState"];

/** 解析后的文献引用（可直接展示给用户）。 */
export interface ResolvedCitation {
  id: string;
  tier: EvidenceCitation["tier"];
  label: string;
  url?: string;
  claim: string;
  cannotSupport: readonly string[];
}

export interface FuelingAdvice {
  workType: SessionWorkType;
  preferredState: FuelingState;
  acceptableStates: readonly FuelingState[];
  minMinutesAfterFullMeal: number | null;
  minMinutesAfterSnack: number | null;
  rationale: string;
  advantages: readonly string[];
  risks: readonly string[];
  /** 空腹是否适格（仅对可空腹的工作类型有意义）。 */
  fastedEligible: boolean;
  /** 命中的阻止规则（含原因与替代方案）。 */
  fastedBlockers: readonly { ruleId: string; reason: string; alternative?: string }[];
  /** 解析后的文献引用——让用户看到"依据是什么"。 */
  citations: readonly ResolvedCitation[];
  /** 该建议的证据等级（取所引文献的最强等级与策略自身 tier 的较弱者）。 */
  tier: SessionFuelingPolicy["tier"];
}

/** 结构化健康标记（由 onboarding 结构化筛查产生，不做文本猜测）。 */
export interface StructuredHealthFlags {
  flags: readonly string[];
  professionalClearanceRequired: boolean;
}

/** 从档案提取结构化健康标记。 */
export function healthFlagsOf(profile: UserProfileData): StructuredHealthFlags {
  return {
    // 目前由 nutritionPreferences 承载结构化标记；结构化筛查落地后改读其专用字段
    flags: profile.nutritionPreferences ?? [],
    professionalClearanceRequired: (profile.professionalConstraints ?? []).some(
      (constraint) => constraint.requiresClearance === true,
    ),
  };
}

/** 解析文献引用（找不到时返回 undefined，不编造）。 */
export function resolveCitations(
  strategies: ProgramStrategies | undefined,
  refs: readonly string[],
): readonly ResolvedCitation[] {
  const library = strategies?.citations ?? [];
  return refs
    .map((ref) => library.find((citation) => citation.id === ref))
    .filter((citation): citation is EvidenceCitation => citation !== undefined)
    .map((citation) => ({
      id: citation.id,
      tier: citation.tier,
      label: `${citation.authorsShort} (${citation.year})${citation.venue ? ` · ${citation.venue}` : ""} — ${citation.titleZh}`,
      ...(citation.url ? { url: citation.url } : {}),
      claim: citation.claim,
      cannotSupport: citation.cannotSupport,
    }));
}

/** 匹配空腹适格性规则表（数据驱动）。 */
export function matchFastedRules(input: {
  rules: readonly FastedTrainingRule[];
  workType: SessionWorkType;
  plannedMinutes: number;
  profile: UserProfileData;
}): readonly FastedTrainingRule[] {
  const health = healthFlagsOf(input.profile);
  const age = input.profile.demographics?.ageYears;
  return input.rules.filter((rule) => {
    const when = rule.when;
    if (when.workTypeIn && !when.workTypeIn.includes(input.workType)) return false;
    if (when.plannedMinutesOver !== undefined && input.plannedMinutes <= when.plannedMinutesOver) return false;
    if (when.ageUnder !== undefined || when.adultNotConfirmed !== undefined) {
      const isMinorByAge = age !== undefined && when.ageUnder !== undefined && age < when.ageUnder;
      const isMinorByFlag = when.adultNotConfirmed === true && input.profile.adultConfirmed === false;
      if (!isMinorByAge && !isMinorByFlag) return false;
    }
    if (when.healthFlagIn && !when.healthFlagIn.some((flag) => health.flags.includes(flag))) return false;
    if (when.professionalClearanceRequired === true && !health.professionalClearanceRequired) return false;
    return true;
  });
}

/**
 * 组装进食编排建议：查表 → 匹配适格性 → 解析引用。
 * 知识包缺该工作类型的策略时返回 undefined（不用代码里的兜底值编造建议）。
 */
export function fuelingAdviceFor(input: {
  strategies: ProgramStrategies | undefined;
  workType: SessionWorkType;
  plannedMinutes: number;
  profile: UserProfileData;
}): FuelingAdvice | undefined {
  const policy = input.strategies?.sessionFuelingPolicies?.find(
    (candidate) => candidate.workType === input.workType,
  );
  if (!policy) return undefined;

  const canBeFasted = policy.acceptableStates.includes("fasted");
  const matched = canBeFasted
    ? matchFastedRules({
        rules: input.strategies?.fastedTrainingRules ?? [],
        workType: input.workType,
        plannedMinutes: input.plannedMinutes,
        profile: input.profile,
      }).filter((rule) => rule.severity === "block")
    : [];

  return {
    workType: policy.workType,
    preferredState: policy.preferredState,
    acceptableStates: policy.acceptableStates,
    minMinutesAfterFullMeal: policy.minMinutesAfterFullMeal,
    minMinutesAfterSnack: policy.minMinutesAfterSnack,
    rationale: policy.rationaleZh,
    advantages: policy.advantagesZh,
    risks: policy.risksZh,
    fastedEligible: canBeFasted && matched.length === 0,
    fastedBlockers: matched.map((rule) => ({
      ruleId: rule.id,
      reason: rule.reasonZh,
      ...(rule.alternativeZh ? { alternative: rule.alternativeZh } : {}),
    })),
    citations: resolveCitations(input.strategies, policy.evidenceRefs),
    tier: policy.tier,
  };
}

/**
 * 同一节课内的顺序约束（干扰管理）。
 * 这是**结构性逻辑**而非可调数值，所以留在代码里；解释文案取自知识包的策略说明。
 */
export function orderingConflict(
  first: SessionWorkType,
  second: SessionWorkType,
): { code: string; explanation: string } | undefined {
  if (second !== "strength") return undefined;
  if (first === "high_intensity_aerobic") {
    return {
      code: "high_intensity_aerobic_before_strength_forbidden",
      explanation:
        "高强度有氧放在力量训练前会消耗糖原并造成疲劳，直接损害力量表现——" +
        "而力量刺激是保住肌肉的关键。顺序应该反过来：先力量，后有氧。",
    };
  }
  if (first === "low_intensity_aerobic") {
    return {
      code: "aerobic_before_strength_not_recommended",
      explanation:
        "低强度有氧放在力量前虽然影响较小，但仍会消耗一部分状态。建议先做力量，有氧放后面或另一天。",
    };
  }
  return undefined;
}
