import type { PlannedSessionData, WeeklyIntentData } from "../coach/domain";
import type { SplitRotationTemplate } from "../knowledge/model";
import type { ScheduleAvailability } from "./model";
import type { MuscleFatigueForecast } from "./muscleFatigue";
import type { CardioLoadForecast } from "./cardioLoad";

export interface ContinuousTrainingQueue {
  policy: {
    version: "1.0.0";
    /** 近端课程可执行，远端只是不早于该日期的条件化意图。 */
    futureSessionsAreConditional: true;
    rematerializeWhen: readonly ["session_completed", "recovery_constraint_changed", "schedule_changed", "equipment_changed"];
  };
  entries: readonly {
    sequence: number;
    earliestDate: string;
    status: "materialized" | "conditional";
    focusZh: string;
    movementPatterns: readonly string[];
    /** 仅近端已物化课锁定具体动作；远端保留动作模式，避免今天替未来锁死变式。 */
    exerciseVariantIds?: readonly string[];
    recoveryLoadBefore?: Readonly<Record<string, number>>;
    /** 有氧系统/下肢相对负荷单列，绝不伪装成力量组数。 */
    cardioLoadBefore?: { system: number; lowerBody: number; impact: "low" | "moderate" | "high" };
    readinessGates: readonly string[];
  }[];
}

function consumesRotation(session: PlannedSessionData | undefined): boolean {
  return Boolean(session && (session.kind === "weighted_reps" || session.kind === "bodyweight_reps") && session.tasks.length > 0);
}

function weekdayFor(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * 组合「已完成/已物化队列 + 可用日程 + 动作恢复负荷」。
 * 远端日期是最早可排窗口，不是承诺：一旦完成训练、恢复或日程事实变化就会重新物化。
 */
export function buildContinuousTrainingQueue(input: {
  currentDate: string;
  weeklyIntents: readonly WeeklyIntentData[];
  materializedSessions: readonly PlannedSessionData[];
  schedule: readonly ScheduleAvailability[];
  rotation: SplitRotationTemplate;
  startingTrainingOrdinal: number;
  fatigueForecast: MuscleFatigueForecast;
  cardioLoadForecast?: CardioLoadForecast;
}): ContinuousTrainingQueue {
  const sessionByDate = new Map(input.materializedSessions.map((session) => [session.scheduledFor, session]));
  const availability = new Set(input.schedule.map((item) => item.weekday));
  const fatigueByDate = new Map(input.fatigueForecast.days.map((day) => [day.date, day]));
  const cardioByDate = new Map(input.cardioLoadForecast?.days.map((day) => [day.date, day]) ?? []);
  const entries: ContinuousTrainingQueue["entries"][number][] = [];
  let ordinal = input.startingTrainingOrdinal;

  for (const week of input.weeklyIntents) {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(`${week.startDate}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      const scheduledFor = date.toISOString().slice(0, 10);
      if (scheduledFor < input.currentDate || !availability.has(weekdayFor(scheduledFor))) continue;
      const existing = sessionByDate.get(scheduledFor);
      if (existing && !consumesRotation(existing)) continue;
      const template = input.rotation.sessions[((ordinal % input.rotation.sessions.length) + input.rotation.sessions.length) % input.rotation.sessions.length]!;
      const fatigue = fatigueByDate.get(scheduledFor);
      const cardio = cardioByDate.get(scheduledFor);
      const materialized = consumesRotation(existing);
      entries.push({
        sequence: ordinal + 1,
        earliestDate: scheduledFor,
        status: materialized ? "materialized" : "conditional",
        focusZh: template.focusZh,
        movementPatterns: template.slots.map((slot) => slot.movementPattern),
        ...(materialized ? { exerciseVariantIds: existing!.tasks.map((task) => task.exerciseVariantId) } : {}),
        ...(fatigue && Object.keys(fatigue.residualBefore).length ? { recoveryLoadBefore: fatigue.residualBefore } : {}),
        ...(cardio && (cardio.systemLoadBefore > 0 || cardio.lowerBodyLoadBefore > 0)
          ? { cardioLoadBefore: { system: cardio.systemLoadBefore, lowerBody: cardio.lowerBodyLoadBefore, impact: cardio.impact } }
          : {}),
        readinessGates: materialized
          ? ["confirm_current_recovery_before_start"]
          : [
              "previous_session_completed_or_rescheduled",
              "recovery_check_in_not_downgraded",
              ...(template.slots.some((slot) => ["squat", "hip_hinge", "lunge", "knee_extension", "knee_flexion"].includes(slot.movementPattern)) && (cardio?.lowerBodyLoadBefore ?? 0) > 0
                ? ["cardio_lower_body_load_not_high_before_lower_body_session"]
                : []),
              "no_new_safety_or_schedule_constraint",
            ],
      });
      ordinal += 1;
    }
  }
  return {
    policy: {
      version: "1.0.0",
      futureSessionsAreConditional: true,
      rematerializeWhen: ["session_completed", "recovery_constraint_changed", "schedule_changed", "equipment_changed"],
    },
    entries,
  };
}
