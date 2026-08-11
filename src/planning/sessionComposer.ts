import type { ProgramStrategies, SplitRotationTemplate } from "../knowledge/model";
import type { StimulusIntentData } from "../coach/domain";

/**
 * Session 组装器（ticket 03）：替代静态轮换表。
 * 分化轮转与周量目标来自知识包 programStrategies（版本化数据）；
 * 所有换算规则是版本化产品规则（标注 D），不是生理精确值。
 */

export interface ComposerSlotTemplate {
  movementPattern: StimulusIntentData["movementPattern"];
  muscleGroups: readonly string[];
  priority: StimulusIntentData["priority"];
  fatigueIntent: StimulusIntentData["fatigueIntent"];
}

export interface SplitSelection {
  rotation: SplitRotationTemplate;
  /** 每肌群每周实际暴露次数（按用户可用天数 × 轮转结构换算）。 */
  exposuresPerWeek: number;
  reasonCode: string;
}

/** 按可用天数与偏好选分化轮转（策略集 §1：等训练量下分化无优劣，按可执行性分配）。 */
export function selectSplitRotation(
  strategies: ProgramStrategies,
  weeklyDays: number,
  preferredRotationId?: string,
): SplitSelection {
  const rotations = strategies.splitRotations;
  if (preferredRotationId) {
    const preferred = rotations.find((rotation) => rotation.id === preferredRotationId);
    if (preferred) {
      return {
        rotation: preferred,
        exposuresPerWeek: exposuresFor(preferred, weeklyDays),
        reasonCode: "split_user_preference_honored",
      };
    }
  }
  const suitable = rotations
    .filter((rotation) => weeklyDays >= rotation.suitableWeeklyDays[0] && weeklyDays <= rotation.suitableWeeklyDays[1])
    .sort((left, right) => right.exposuresPerCycle / right.sessions.length - left.exposuresPerCycle / left.sessions.length);
  // 天数低于所有模板下限时，全身训练永远可执行（每天一次全身，频率随天数）
  const rotation = suitable[0] ?? rotations.find((candidate) => candidate.id === "full_body") ?? rotations[0]!;
  return {
    rotation,
    exposuresPerWeek: exposuresFor(rotation, weeklyDays),
    reasonCode: suitable.length ? "split_by_executability_max_frequency" : "split_fallback_full_body",
  };
}

function exposuresFor(rotation: SplitRotationTemplate, weeklyDays: number): number {
  // 每周完成 cycles = weeklyDays / 每周转数；每 cycle 每肌群 exposuresPerCycle 次
  const cyclesPerWeek = weeklyDays / rotation.sessions.length;
  return rotation.exposuresPerCycle * cyclesPerWeek;
}

/** 周量目标（直接组/肌群/周）：TP-VOL-BASE 分档（D 级产品规则）。 */
export function weeklyDirectSetTarget(
  strategies: ProgramStrategies,
  experience: "beginner" | "intermediate" | "advanced",
): { min: number; default: number; max: number } {
  return strategies.weeklyDirectSetTargets[experience];
}

/** 每个 slot 的组数：周量目标 ÷ 实际暴露次数（上限 5，下限 1）。 */
export function setsPerSlot(
  weeklyTarget: number,
  exposuresPerWeek: number,
  priority: ComposerSlotTemplate["priority"],
): number {
  if (priority === "optional") return 1;
  const primary = Math.max(1, Math.min(5, Math.ceil(weeklyTarget / Math.max(1, exposuresPerWeek))));
  return priority === "primary" ? primary : Math.max(1, primary - 1);
}

/** 该轮转的某一次训练（按训练日序数轮转）。 */
export function sessionTemplateFor(
  rotation: SplitRotationTemplate,
  trainingDayOrdinal: number,
): ComposerSlotTemplate[] {
  const session = rotation.sessions[trainingDayOrdinal % rotation.sessions.length]!;
  return session.slots.map((slot) => ({ ...slot }));
}

/** 周量账本：每肌群本周直接组数（按计划组数 × 暴露结构求和）。 */
export function weeklyVolumeLedger(
  rotation: SplitRotationTemplate,
  weeklyDays: number,
  setsByPriority: { primary: number; maintenance: number; optional: number },
): Readonly<Record<string, number>> {
  const ledger = new Map<string, number>();
  const daysUsed = Math.min(weeklyDays, rotation.sessions.length * Math.ceil(weeklyDays / rotation.sessions.length));
  for (let day = 0; day < weeklyDays; day += 1) {
    const session = rotation.sessions[day % rotation.sessions.length]!;
    for (const slot of session.slots) {
      for (const muscle of slot.muscleGroups) {
        ledger.set(muscle, (ledger.get(muscle) ?? 0) + setsByPriority[slot.priority]);
      }
    }
  }
  void daysUsed;
  return Object.fromEntries(ledger);
}

/** 从物化后的 session 内容求和周量账本（真实产出，而非计划意图）。 */
export function volumeLedgerFromSessions(
  sessions: readonly { stimulusSlots?: readonly { intent: { muscleGroups: readonly string[] }; prescription: { setCount: number } }[] }[],
): Readonly<Record<string, number>> {
  const ledger = new Map<string, number>();
  for (const session of sessions) {
    for (const slot of session.stimulusSlots ?? []) {
      for (const muscle of slot.intent.muscleGroups) {
        ledger.set(muscle, (ledger.get(muscle) ?? 0) + slot.prescription.setCount);
      }
    }
  }
  return Object.fromEntries(ledger);
}
