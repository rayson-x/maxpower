/**
 * 饮食记录精度档位（版本化词表，非计算规则）。
 *
 * 来源：AGENTS.md §2「饮食精度 = max(计划强度要求, 个人状态基线)」（2026-08-16 定稿）
 * + 2026-08-17 作者裁定两则：
 * 1. 执行严格度（executionTier）与饮食精度正交——「计划强度」指目标本身的精度需求
 *    （如 10% 体脂目标不管时间线都需精确控制），不是 deadline 压力。
 * 2. **档位判断由 agent 做**（它读得懂「10% 体脂」的语义），固定侧只做词表与边界，
 *    不做阈值表/硬编码规则。
 *
 * 固定侧边界（不经模型自觉的部分）：
 * - 候选的 nutritionStrategy 必须显式携带 trackingPrecision（缺失 = blocking）。
 * - 档位只许取这三个值（封闭词表）。
 * - 选择必须带 rationale（为什么这个人是这个精度）。
 */
export const TRACKING_PRECISION_POLICY = {
  id: "maxpower.tracking-precision",
  version: "tracking-precision.v1 (2026-08-17)",
  tiers: ["behavioral", "magnitude", "precise"] as const,
} as const;

export type TrackingPrecision = (typeof TRACKING_PRECISION_POLICY.tiers)[number];

/** 档位语义（工具描述与校验信息共用，防止两处漂移）。 */
export const TRACKING_PRECISION_TIER_TEXT: Record<TrackingPrecision, string> = {
  behavioral: "行为级：一句话描述即可入账（「晚饭半碗米饭+清蒸鱼」），零计算负担",
  magnitude: "量级级：大概量（「~2000 kcal、蛋白~120g」），允许估算",
  precise: "精确级：结构化数值（结构化营养观察），接近生理极限的目标恒为此档",
};
