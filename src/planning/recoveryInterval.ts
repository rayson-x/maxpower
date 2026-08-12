import type { PlannedSessionData } from "../coach/domain";

/**
 * 肌群恢复间隔检查（2026-08-12）。
 *
 * 为什么需要：轮转顺序保证了"不连着练同一课"，但不保证**肌群层面**的恢复间隔。
 * 例如四分化里胸日有 vertical_push（肩前束）、肩日也有 vertical_push，
 * 两天相邻时肩连续受高强度刺激；又如用户昨天自己练了腿，今天计划又排腿。
 *
 * 做法：算出每个肌群相邻两次直接训练的实际间隔，低于该肌群的恢复窗口就报冲突。
 *
 * 纪律（这里只检测不自动重排）：
 * 重排会与轮转续接、器械过滤、内容回填互相牵连——之前擅自改排序引入了
 * "腿日从滚动 7 天消失"的更坏问题。所以先把冲突显式暴露给用户与上层，
 * 由用户决定是否调整；自动重排要等容量与恢复模型有依据后统一设计。
 */

/**
 * 各肌群的恢复窗口（天）。大肌群/高负荷动作恢复更慢。
 * 产品规则（D 级）；具体数值待认证体系方法论调研结果校准。
 */
const RECOVERY_DAYS: Readonly<Record<string, number>> = {
  quadriceps: 2,
  hamstrings: 2,
  glutes: 2,
  back: 2,
  chest: 2,
  deltoids: 1,
  lateral_deltoid: 1,
  rear_deltoid: 1,
  biceps: 1,
  triceps: 1,
  core: 1,
};

/** 默认恢复窗口（未列出的肌群）。 */
const DEFAULT_RECOVERY_DAYS = 1;

export interface RecoveryConflict {
  muscle: string;
  /** 前一次训练日期。 */
  previousDate: string;
  /** 冲突的训练日期。 */
  conflictDate: string;
  /** 实际间隔（天）。 */
  actualGapDays: number;
  /** 该肌群要求的恢复间隔（天）。 */
  requiredGapDays: number;
  /** 前一次是否来自用户已完成的训练记录（而非计划）。 */
  previousFromHistory: boolean;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/** 只统计有实际负荷的直接肌群（priority 为 primary/maintenance，跳过 optional）。 */
function directMusclesOf(session: PlannedSessionData): readonly string[] {
  const muscles = new Set<string>();
  for (const slot of session.stimulusSlots ?? []) {
    if (slot.intent.priority === "optional") continue;
    if (slot.prescription.setCount <= 0) continue;
    for (const muscle of slot.intent.directMuscles ?? slot.intent.muscleGroups) muscles.add(muscle);
  }
  return [...muscles];
}

/**
 * 检查计划中的肌群恢复间隔。
 *
 * @param sessions 计划中的训练日（按日期升序）
 * @param historyByMuscle 已完成训练的最近日期（来自 timeline，用户自己练的也算）
 */
export function recoveryIntervalConflicts(input: {
  sessions: readonly PlannedSessionData[];
  historyByMuscle?: Readonly<Record<string, string>>;
}): readonly RecoveryConflict[] {
  const conflicts: RecoveryConflict[] = [];
  // 每个肌群最近一次训练：先用历史打底，再随计划推进
  const lastTrained = new Map<string, { date: string; fromHistory: boolean }>();
  for (const [muscle, date] of Object.entries(input.historyByMuscle ?? {})) {
    lastTrained.set(muscle, { date, fromHistory: true });
  }

  const ordered = [...input.sessions].sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  for (const session of ordered) {
    for (const muscle of directMusclesOf(session)) {
      const previous = lastTrained.get(muscle);
      const required = RECOVERY_DAYS[muscle] ?? DEFAULT_RECOVERY_DAYS;
      if (previous) {
        const gap = daysBetween(previous.date, session.scheduledFor);
        if (gap >= 0 && gap < required) {
          conflicts.push({
            muscle,
            previousDate: previous.date,
            conflictDate: session.scheduledFor,
            actualGapDays: gap,
            requiredGapDays: required,
            previousFromHistory: previous.fromHistory,
          });
        }
      }
      lastTrained.set(muscle, { date: session.scheduledFor, fromHistory: false });
    }
  }
  return conflicts;
}

/**
 * 把 timeline 里的训练记录归约成"每个肌群最近训练日"。
 * 用于让计划尊重用户**自己**完成的训练（不只是我们排的）。
 */
export function historyByMuscleFrom(input: {
  events: readonly { occurredAt: string; muscles: readonly string[] }[];
}): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const event of input.events) {
    const date = event.occurredAt.slice(0, 10);
    for (const muscle of event.muscles) {
      if (!result[muscle] || date > result[muscle]!) result[muscle] = date;
    }
  }
  return result;
}
