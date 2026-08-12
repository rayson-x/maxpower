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
  /** 直接组归属（周量记账）；缺省退回 muscleGroups。 */
  directMuscles?: readonly string[];
  priority: StimulusIntentData["priority"];
  fatigueIntent: StimulusIntentData["fatigueIntent"];
  /**
   * 期望的力学类型（compound 复合 / isolation 孤立）。
   * 用于在同一肌群内组出"主项 + 不同刺激角度的辅助"（卧推 + 上斜 + 夹胸），
   * 而不是靠换肌群凑动作数。
   */
  preferMechanic?: "compound" | "isolation";
  /** 期望的动作角度（flat / incline / decline），同肌群换角度覆盖不同区域。 */
  preferAngle?: string;
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

/**
 * 每个肌群在一圈轮转里的**真实**直接暴露次数。
 * 不能用轮转的名义 exposuresPerCycle：全身轮转里胸只出现在部分课，
 * 用名义值会把胸的每次组数除得过小（周量不足的真根因）。
 */
export function directExposuresPerCycle(rotation: SplitRotationTemplate): Readonly<Record<string, number>> {
  const counts = new Map<string, number>();
  for (const session of rotation.sessions) {
    for (const slot of session.slots) {
      for (const muscle of slot.directMuscles ?? slot.muscleGroups) {
        counts.set(muscle, (counts.get(muscle) ?? 0) + 1);
      }
    }
  }
  return Object.fromEntries(counts);
}

/** 该 slot 的每次组数：按其直接肌群在本周的真实暴露次数反推。 */
export function setsForSlot(
  slot: ComposerSlotTemplate,
  weeklyTarget: number,
  rotation: SplitRotationTemplate,
  cyclesPerWeek: number,
): number {
  if (slot.priority === "optional") return 1;
  const exposures = directExposuresPerCycle(rotation);
  const direct = slot.directMuscles ?? slot.muscleGroups;
  // 该 slot 的组数由"最受限"的直接肌群决定（暴露最多的那个，避免叠加超量）
  const weeklyExposures = Math.max(
    1,
    ...direct.map((muscle) => (exposures[muscle] ?? 1) * cyclesPerWeek),
  );
  const raw = Math.ceil(weeklyTarget / weeklyExposures);
  // 剂量地板（D8）：主要 slot 至少 2 组，维持 slot 至少 1 组
  const floor = slot.priority === "primary" ? 2 : 1;
  const cap = slot.priority === "primary" ? 6 : 4;
  return Math.max(floor, Math.min(cap, raw));
}

/**
 * 周量目标（直接组/肌群/周）：TP-VOL-BASE 分档（D 级产品规则）。
 * 目标影响档位：增肌的群体证据方向是每肌群 ~≥10 组/周（ACSM 2026 综述），
 * 所以增肌取分档上段；力量更依赖相对负荷而非周量，取默认段。
 * 新手仍从保守起点渐进——"~10"是方向不是首周硬门槛。
 */
export function weeklyDirectSetTarget(
  strategies: ProgramStrategies,
  experience: "beginner" | "intermediate" | "advanced",
  goal?: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass",
): { min: number; default: number; max: number } {
  const band = strategies.weeklyDirectSetTargets[experience];
  if (goal === "hypertrophy" && experience !== "beginner") {
    return { ...band, default: band.max };
  }
  return band;
}

/**
 * 训练意愿调制（分领域意愿向量的训练轴；用户自选、随时可改、不由系统推断）：
 * high 用周量上限、standard 用默认、minimal 用下限。
 */
export function trainingCommitmentTarget(
  target: { min: number; default: number; max: number },
  commitment: "minimal" | "standard" | "high" | undefined,
): number {
  if (commitment === "high") return target.max;
  if (commitment === "minimal") return target.min;
  return target.default;
}

/** minimal 意愿的结构简化：每课保留主项 + 1 辅助（最少负担，先练起来）。 */
export function simplifyForMinimalCommitment(slots: ComposerSlotTemplate[]): ComposerSlotTemplate[] {
  const kept: ComposerSlotTemplate[] = [];
  let maintenanceKept = 0;
  for (const slot of slots) {
    if (slot.priority === "primary") kept.push(slot);
    else if (slot.priority === "maintenance" && maintenanceKept < 1) {
      kept.push(slot);
      maintenanceKept += 1;
    }
  }
  return kept.length ? kept : slots.slice(0, 1);
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
  const count = rotation.sessions.length;
  const session = rotation.sessions[((trainingDayOrdinal % count) + count) % count]!;
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

/**
 * 周量硬上限（产品规则 D）：单肌群每周直接组数的天花板。
 * 防"侧重肌群被堆到 20+ 组"——无论上游逻辑怎么叠加都不能超。
 * 超出的肌群按"从低到高优先级"减组（optional → maintenance），保住主项。
 */
export const WEEKLY_DIRECT_SETS_HARD_CAP = 14;

/**
 * 记账上合并计入上限的肌群族（2026-08-12 真实缺陷）。
 *
 * 肩被拆成 deltoids / lateral_deltoid / rear_deltoid 三个记账单位，各自 ≤14 时
 * 合计可达 42 组——上限被完全绕过，会给出危险的过量计划。
 * 同族肌群的周量必须合并后再受上限约束（生理上它们共享恢复预算）。
 */
export const MUSCLE_FAMILIES: Readonly<Record<string, string>> = {
  deltoids: "shoulder",
  lateral_deltoid: "shoulder",
  rear_deltoid: "shoulder",
  front_deltoid: "shoulder",
};

/** 族上限：肩整体不应超过这个量（比单一肌群上限略高，因为分三束）。 */
export const FAMILY_HARD_CAP: Readonly<Record<string, number>> = {
  shoulder: 20,
};

function familyOf(muscle: string): string | undefined {
  return MUSCLE_FAMILIES[muscle];
}

export function capWeeklyVolume<
  T extends {
    stimulusSlots?: readonly {
      id: string;
      intent: { muscleGroups: readonly string[]; directMuscles?: readonly string[]; priority: string };
      prescription: { setCount: number };
    }[];
    tasks?: readonly { stimulusSlotId?: string; sets: readonly unknown[] }[];
  },
>(sessions: readonly T[], cap = WEEKLY_DIRECT_SETS_HARD_CAP): { sessions: T[]; cappedMuscles: string[] } {
  const totals = new Map<string, number>();
  for (const session of sessions) {
    for (const slot of session.stimulusSlots ?? []) {
      for (const muscle of slot.intent.directMuscles ?? slot.intent.muscleGroups) {
        totals.set(muscle, (totals.get(muscle) ?? 0) + slot.prescription.setCount);
      }
    }
  }
  // 每个肌群的目标量：默认单肌群上限；族超限时按比例下调
  const targets = new Map<string, number>();
  for (const [muscle, total] of totals) targets.set(muscle, Math.min(total, cap));
  // 族超限（肩三束合并）：把该族里量最大的肌群也纳入裁剪
  const familyTotals = new Map<string, number>();
  for (const [muscle, total] of totals) {
    const family = familyOf(muscle);
    if (family) familyTotals.set(family, (familyTotals.get(family) ?? 0) + total);
  }
  for (const [family, familyTotal] of familyTotals) {
    const familyCap = FAMILY_HARD_CAP[family];
    if (familyCap === undefined) continue;
    // 用当前目标量求族总量（可能已被单肌群上限压过）
    const members = [...totals.keys()].filter((muscle) => familyOf(muscle) === family);
    const currentFamilyTotal = members.reduce((sum, muscle) => sum + (targets.get(muscle) ?? 0), 0);
    if (currentFamilyTotal <= familyCap) continue;
    // 按当前占比等比下调，保证族总量达标且各束不为 0
    const scale = familyCap / currentFamilyTotal;
    for (const muscle of members) {
      const current = targets.get(muscle) ?? 0;
      targets.set(muscle, Math.max(1, Math.floor(current * scale)));
    }
    void familyTotal;
  }
  const over = [...totals.entries()]
    .filter(([muscle, total]) => total > (targets.get(muscle) ?? total))
    .map(([muscle]) => muscle);
  if (!over.length) return { sessions: [...sessions], cappedMuscles: [] };

  const result = sessions.map((session) => ({
    ...session,
    stimulusSlots: (session.stimulusSlots ?? []).map((slot) => ({ ...slot, prescription: { ...slot.prescription } })),
    tasks: (session.tasks ?? []).map((task) => ({ ...task, sets: [...task.sets] })),
  })) as T[];
  for (const muscle of over) {
    let excess = (totals.get(muscle) ?? 0) - (targets.get(muscle) ?? cap);
    const slotsFlat: { session: T; slotIndex: number; slot: NonNullable<T["stimulusSlots"]>[number] }[] = [];
    for (const session of result) {
      (session.stimulusSlots ?? []).forEach((slot, slotIndex) => {
        if ((slot.intent.directMuscles ?? slot.intent.muscleGroups).includes(muscle)) {
          slotsFlat.push({ session, slotIndex, slot });
        }
      });
    }
    slotsFlat.sort((a, b) => {
      const rank = (p: string) => (p === "optional" ? 0 : p === "maintenance" ? 1 : 2);
      return rank(a.slot.intent.priority) - rank(b.slot.intent.priority);
    });
    for (const { session, slotIndex, slot } of slotsFlat) {
      if (excess <= 0) break;
      const floor = slot.intent.priority === "primary" ? 2 : 1;
      const removable = Math.min(excess, slot.prescription.setCount - floor);
      if (removable <= 0) continue;
      const newCount = slot.prescription.setCount - removable;
      ((session.stimulusSlots as unknown) as { prescription: { setCount: number } }[])[slotIndex]!.prescription.setCount = newCount;
      const task = ((session.tasks as unknown) as { stimulusSlotId?: string; sets: unknown[] }[]).find(
        (candidate) => candidate.stimulusSlotId === slot.id,
      );
      if (task) task.sets = task.sets.slice(0, newCount);
      excess -= removable;
    }
  }
  return { sessions: result, cappedMuscles: over };
}

/** 从物化后的 session 内容求和周量账本（真实产出，而非计划意图）。 */
export function volumeLedgerFromSessions(
  sessions: readonly { stimulusSlots?: readonly { intent: { muscleGroups: readonly string[]; directMuscles?: readonly string[] }; prescription: { setCount: number } }[] }[],
): Readonly<Record<string, number>> {
  const ledger = new Map<string, number>();
  for (const session of sessions) {
    for (const slot of session.stimulusSlots ?? []) {
      for (const muscle of slot.intent.directMuscles ?? slot.intent.muscleGroups) {
        ledger.set(muscle, (ledger.get(muscle) ?? 0) + slot.prescription.setCount);
      }
    }
  }
  return Object.fromEntries(ledger);
}

/**
 * 单课内容地板（验收标准 §1：需检查主要肌群覆盖与可学性）。
 * 器械过滤后若一节课只剩 <2 个 slot，从同轮转其他课回填**可行**的 slot，
 * 避免"一节课只有一个动作"这种不合格输出。
 */
export function backfillThinSession(
  kept: ComposerSlotTemplate[],
  rotation: SplitRotationTemplate,
  isFeasible: (slot: ComposerSlotTemplate) => boolean,
  minSlots = 2,
): ComposerSlotTemplate[] {
  if (kept.length >= minSlots) return kept;
  const usedPatterns = new Set(kept.map((slot) => slot.movementPattern));
  const candidates = rotation.sessions
    .flatMap((session) => session.slots)
    .filter((slot) => !usedPatterns.has(slot.movementPattern))
    .filter((slot) => isFeasible(slot))
    // 主项优先，其次维持项
    .sort((left, right) => {
      const rank = (priority: string) => (priority === "primary" ? 0 : priority === "maintenance" ? 1 : 2);
      return rank(left.priority) - rank(right.priority);
    });
  // 优先在**本课已有肌群内**换角度/力学补齐（卧推 → 上斜 → 夹胸），
  // 而不是从其他课借动作。此前胸日不足会回填垂直拉——胸日练背，解剖上不合理。
  const result = [...kept];
  const ownMuscles = new Set(kept.flatMap((slot) => slot.directMuscles ?? slot.muscleGroups));
  for (const slot of kept) {
    if (result.length >= minSlots) break;
    const muscles = slot.directMuscles ?? slot.muscleGroups;
    // 同模式同肌群，但改用孤立动作补一个不同刺激角度
    const alreadyIsolation = result.some(
      (item) => item.movementPattern === slot.movementPattern && item.preferMechanic === "isolation",
    );
    if (alreadyIsolation) continue;
    const complement: ComposerSlotTemplate = {
      movementPattern: slot.movementPattern,
      muscleGroups: [...muscles],
      directMuscles: [...muscles],
      priority: "maintenance",
      fatigueIntent: "low",
      preferMechanic: "isolation",
    };
    if (isFeasible(complement)) {
      result.push(complement);
      continue;
    }
    // 孤立动作不可行时换角度（上斜/下斜），仍保持同肌群
    const angled: ComposerSlotTemplate = { ...complement, preferMechanic: undefined, preferAngle: "incline" };
    if (isFeasible(angled)) result.push(angled);
  }
  for (const candidate of candidates) {
    if (result.length >= minSlots) break;
    if (usedPatterns.has(candidate.movementPattern)) continue;
    // 跨课回填时也要避免拉进与本课肌群完全无关的动作（除非实在补不满）
    const candidateMuscles = candidate.directMuscles ?? candidate.muscleGroups;
    const shareMuscle = candidateMuscles.some((muscle) => ownMuscles.has(muscle));
    if (!shareMuscle && result.length >= Math.max(2, minSlots - 1)) continue;
    usedPatterns.add(candidate.movementPattern);
    result.push({ ...candidate });
  }
  return result;
}
