import type { PlannerFacts } from "./model";
import type { SplitRotationTemplate } from "../knowledge/model";

/**
 * 从训练历史推断轮转位置（2026-08-12 用户拍板：planner 要自己看记录排，不靠人告诉它）。
 *
 * 问题：此前每周的轮转序号从 0 重置，只看"缺席日"参数。用户周一练了腿、周二休息，
 * 周三打开应用时 planner 不知道腿已经练过，会从轮转第一课重新开始 —— 于是
 * 一周里腿练两次、背一次都没练。
 *
 * 做法：找最近一次力量训练记录，用它实际练到的肌群与轮转各课比对，
 * 重合度最高的那一课视为"上次做的"，下一课就从它之后接着排。
 *
 * 纪律：
 * - 只用**明确的训练记录**（用户报告或引导训练落账），不猜
 * - 匹配不到（记录太旧 / 无肌群信息 / 重合度不足）就返回 undefined，
 *   回落到默认从头排 —— 宁可保守也不要错排
 */

/** 超过这个天数的训练记录不再用于推断轮转位置（太旧了，视为新一轮）。 */
const HISTORY_LOOKBACK_DAYS = 10;

/** 重合度阈值：匹配到的肌群占该课直接肌群的比例下限。 */
const MIN_OVERLAP_RATIO = 0.4;

export interface RotationPosition {
  /** 下一次训练应使用的轮转序号（0-based）。 */
  nextSessionIndex: number;
  /** 依据的训练日期。 */
  matchedDate: string;
  /** 匹配到的轮转课序号。 */
  matchedSessionIndex: number;
  /** 匹配到的肌群（可解释）。 */
  matchedMuscles: readonly string[];
  /** 重合度。 */
  overlapRatio: number;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/**
 * 从一条训练记录提取练到的肌群。
 * 优先用引导训练落账的动作（有 exerciseVariantId → 可查肌群），
 * 其次用用户报告里的自由文本动作名做关键词匹配。
 */
function musclesFromTrainingEvent(
  fact: { kind: string; historicalSet?: { exerciseVariantId?: string }; reportedSession?: { summary?: string; exercises?: readonly { name: string }[] } },
  muscleLookup: (variantId: string) => readonly string[] | undefined,
): readonly string[] {
  const muscles = new Set<string>();
  const variantId = fact.historicalSet?.exerciseVariantId;
  if (variantId) {
    for (const muscle of muscleLookup(variantId) ?? []) muscles.add(muscle);
  }
  // 自由文本：用中英关键词映射到肌群（用户口述"练了腿"也要能识别）
  const text = [fact.reportedSession?.summary, ...(fact.reportedSession?.exercises ?? []).map((e) => e.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text) {
    const KEYWORDS: readonly [RegExp, readonly string[]][] = [
      [/腿|squat|深蹲|leg|lunge|弓步|硬拉|deadlift/, ["quadriceps", "hamstrings", "glutes"]],
      [/胸|bench|卧推|chest|飞鸟|fly|俯卧撑|push.?up/, ["chest", "triceps"]],
      [/背|row|划船|下拉|pulldown|引体|pull.?up|back/, ["back", "biceps"]],
      [/肩|shoulder|推举|press|平举|raise|delt/, ["deltoids"]],
      [/二头|biceps|弯举|curl/, ["biceps"]],
      [/三头|triceps|臂屈伸|extension/, ["triceps"]],
      [/臀|glute|臀推|hip.?thrust/, ["glutes"]],
      [/核心|core|腹|plank|平板/, ["core"]],
    ];
    for (const [pattern, list] of KEYWORDS) {
      if (pattern.test(text)) for (const muscle of list) muscles.add(muscle);
    }
  }
  return [...muscles];
}

/**
 * 推断下一次训练应该做轮转里的哪一课。
 *
 * @param muscleLookup 由动作变式 id 查直接肌群（planner 从知识包提供）
 */
export function rotationPositionFromHistory(input: {
  facts: PlannerFacts;
  rotation: SplitRotationTemplate;
  currentDate: string;
  muscleLookup: (variantId: string) => readonly string[] | undefined;
}): RotationPosition | undefined {
  const { facts, rotation, currentDate, muscleLookup } = input;
  if (!rotation.sessions.length) return undefined;

  // 最近一次力量训练（按日期倒序，只看回溯窗口内）
  const candidates = facts.timeline
    .filter((event: PlannerFacts["timeline"][number]) => event.fact.kind === "training")
    .map((event: PlannerFacts["timeline"][number]) => ({
      date: event.occurredAt.slice(0, 10),
      fact: event.fact as Parameters<typeof musclesFromTrainingEvent>[0],
    }))
    .filter((item) => {
      const gap = daysBetween(item.date, currentDate);
      return gap >= 0 && gap <= HISTORY_LOOKBACK_DAYS;
    })
    .sort((left, right) => right.date.localeCompare(left.date));
  if (!candidates.length) return undefined;

  // 同一天可能有多条记录（每组一条），合并同日肌群
  const latestDate = candidates[0]!.date;
  const sameDay = candidates.filter((item) => item.date === latestDate);
  const trained = new Set<string>();
  for (const item of sameDay) {
    for (const muscle of musclesFromTrainingEvent(item.fact, muscleLookup)) trained.add(muscle);
  }
  if (!trained.size) return undefined;

  // 与轮转各课比对：取重合度最高的一课
  let best: { index: number; ratio: number; matched: string[] } | undefined;
  rotation.sessions.forEach((session, index) => {
    const direct = new Set<string>();
    for (const slot of session.slots) {
      for (const muscle of slot.directMuscles ?? slot.muscleGroups) direct.add(muscle);
    }
    if (!direct.size) return;
    const matched = [...direct].filter((muscle) => trained.has(muscle));
    const ratio = matched.length / direct.size;
    if (!best || ratio > best.ratio) best = { index, ratio, matched };
  });
  if (!best || best.ratio < MIN_OVERLAP_RATIO) return undefined;

  return {
    nextSessionIndex: (best.index + 1) % rotation.sessions.length,
    matchedDate: latestDate,
    matchedSessionIndex: best.index,
    matchedMuscles: best.matched,
    overlapRatio: Math.round(best.ratio * 100) / 100,
  };
}
