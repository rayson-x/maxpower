export const PROFESSIONAL_TERM_CATALOG_VERSION = "professional-terms/v1" as const;

export type ProfessionalTermId = "rir" | "rpe" | "one_rm" | "estimated_one_rm" | "bmr" | "tdee" | "tef" | "hiit" | "deload";

export interface ProfessionalTermDefinition {
  readonly id: ProfessionalTermId;
  readonly label: string;
  readonly fullName: string;
  readonly plainMeaning: string;
  readonly scaleDirection: string;
  readonly example: string;
  readonly boundary: string;
  readonly catalogVersion: typeof PROFESSIONAL_TERM_CATALOG_VERSION;
}

export type ProfessionalTermTextPart =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "term"; readonly text: string; readonly termId: ProfessionalTermId };

const PROFESSIONAL_TERMS: Readonly<Record<ProfessionalTermId, ProfessionalTermDefinition>> = {
  rir: {
    id: "rir",
    label: "RIR",
    fullName: "Repetitions in Reserve｜剩余次数",
    plainMeaning: "完成这一组后，你感觉保持相同动作质量还能再完成多少次。",
    scaleDirection: "数值越低，越接近力竭；RIR 0 表示你认为已经没有余力再做一次。",
    example: "例如 RIR 2：做完这组后，你估计还能再完成约 2 次。",
    boundary: "它是你的主观估计，不由相机推断，也不等于疼痛、动作质量或肌肉刺激程度。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  rpe: {
    id: "rpe",
    label: "RPE",
    fullName: "Rating of Perceived Exertion｜主观用力程度",
    plainMeaning: "用一个量表描述这一组或这段运动主观感觉有多用力。",
    scaleDirection: "本产品使用 1–10 分；数值越高，表示主观感觉越吃力。",
    example: "例如 RPE 8：整体感觉很吃力，但通常还没有到完全无法继续。",
    boundary: "RPE 与 RIR 相关但含义不同，不能脱离动作、时长和训练情境机械换算。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  one_rm: {
    id: "one_rm", label: "1RM", fullName: "One-Repetition Maximum｜单次最大重量",
    plainMeaning: "在动作标准和条件明确时，你最多只能完成 1 次的重量。",
    scaleDirection: "它描述特定动作的最大力量表现，不是所有动作通用的个人等级。",
    example: "例如卧推 1RM 100 kg，表示在当时条件下最多能标准完成 1 次 100 kg。",
    boundary: "不必为了建档专门测试极限；多次数训练记录可以用于估算，但估算值不是实测值。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  estimated_one_rm: {
    id: "estimated_one_rm", label: "e1RM", fullName: "Estimated One-Repetition Maximum｜估算单次最大重量",
    plainMeaning: "根据一次训练的重量、次数和余力等信息估算出的 1RM。",
    scaleDirection: "更适合比较同一动作、相近条件下的趋势，不代表当天一定能完成该重量。",
    example: "例如用 80 kg 完成 5 次，可形成一个 e1RM 参考值来观察力量趋势。",
    boundary: "不同公式和训练状态会产生不同结果，不能把 e1RM 当成实测 1RM。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  bmr: {
    id: "bmr", label: "BMR", fullName: "Basal Metabolic Rate｜基础代谢率",
    plainMeaning: "身体在严格静息条件下维持呼吸、循环等基本生命活动所需的能量。",
    scaleDirection: "它是全天消耗的一部分，不是你一天实际会消耗的全部热量。",
    example: "计划可以用身高、体重、年龄和性别估算 BMR，再结合日常活动建立能量范围。",
    boundary: "公式值是估算，不应直接把 BMR 当作每日摄入目标。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  tdee: {
    id: "tdee", label: "TDEE", fullName: "Total Daily Energy Expenditure｜每日总能量消耗",
    plainMeaning: "一天里基础代谢、日常活动、训练和消化食物等部分合计的能量消耗。",
    scaleDirection: "它会随活动、训练和体重变化，不是一个永远固定的数字。",
    example: "居家办公日和力量加有氧日，可以有不同的 TDEE 估算。",
    boundary: "穿戴设备和公式都有误差，需要结合连续体重、围度和记录逐步校准。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  tef: {
    id: "tef", label: "TEF", fullName: "Thermic Effect of Food｜食物热效应",
    plainMeaning: "身体消化、吸收和处理食物时消耗的能量。",
    scaleDirection: "它已经属于每日总能量消耗的一部分，不应被重复加算。",
    example: "估算 TDEE 时若模型已经包含 TEF，就不能再额外增加一遍。",
    boundary: "不同营养素和饮食组成会影响它，单日无法精确测量。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  hiit: {
    id: "hiit", label: "HIIT", fullName: "High-Intensity Interval Training｜高强度间歇训练",
    plainMeaning: "高强度工作段与恢复段交替进行的训练方式。",
    scaleDirection: "强度和恢复需求通常高于轻中强度稳态有氧，但具体负荷取决于动作和结构。",
    example: "例如短时间高强度骑行与低强度恢复交替完成多轮。",
    boundary: "出汗多或感觉累不等于 HIIT；睡眠、恢复和健康限制会改变是否适合安排。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
  deload: {
    id: "deload", label: "Deload", fullName: "训练减量期",
    plainMeaning: "暂时降低训练压力，让疲劳下降，同时尽量保留动作和训练节奏。",
    scaleDirection: "可以减少组数、负重、接近力竭程度或训练频率，具体方式取决于疲劳来源。",
    example: "例如保留主要动作，但减少工作组并留出更多余力。",
    boundary: "它不必按固定日历强制发生，应结合表现、恢复和连续记录判断。",
    catalogVersion: PROFESSIONAL_TERM_CATALOG_VERSION,
  },
};

const TERM_ALIASES: readonly { readonly alias: string; readonly termId: ProfessionalTermId }[] = [
  { alias: "e1RM", termId: "estimated_one_rm" }, { alias: "1RM", termId: "one_rm" },
  { alias: "RIR", termId: "rir" }, { alias: "RPE", termId: "rpe" },
  { alias: "TDEE", termId: "tdee" }, { alias: "BMR", termId: "bmr" }, { alias: "TEF", termId: "tef" },
  { alias: "HIIT", termId: "hiit" }, { alias: "Deload", termId: "deload" },
];
const TERM_ALIAS_BY_LOWERCASE = new Map(TERM_ALIASES.map((item) => [item.alias.toLowerCase(), item.termId]));
const TERM_PATTERN = new RegExp(`\\b(${TERM_ALIASES.map((item) => item.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "giu");

export function readProfessionalTerm(termId: ProfessionalTermId): ProfessionalTermDefinition {
  return PROFESSIONAL_TERMS[termId];
}

export function annotateProfessionalTerms(text: string): readonly ProfessionalTermTextPart[] {
  const result: ProfessionalTermTextPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(TERM_PATTERN)) {
    const index = match.index;
    if (index > cursor) result.push({ kind: "text", text: text.slice(cursor, index) });
    const matchedText = match[0];
    const termId = TERM_ALIAS_BY_LOWERCASE.get(matchedText.toLowerCase());
    if (!termId) continue;
    result.push({ kind: "term", text: matchedText, termId });
    cursor = index + matchedText.length;
  }
  if (cursor < text.length || result.length === 0) result.push({ kind: "text", text: text.slice(cursor) });
  return result;
}
