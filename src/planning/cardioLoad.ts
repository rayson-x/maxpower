import type { PlannedSessionData, TimelineProjectionEvent } from "../coach/domain";

/**
 * 有氧恢复负荷（v1）。这是一个用于排序与复盘的相对单位，不是 kcal、伤病风险、
 * 心率区间或医学“恢复完成度”。实际 RPE、完成时长和症状优先于计划值。
 */
export const CARDIO_LOAD_POLICY = {
  id: "maxpower.relative-cardio-load",
  version: "1.0.0",
  evidenceTier: "D_product_policy" as const,
  dailyResidualMultiplier: 0.55,
} as const;

export interface CardioLoadDayForecast {
  date: string;
  systemLoadBefore: number;
  lowerBodyLoadBefore: number;
  addedSystemLoad: number;
  addedLowerBodyLoad: number;
  impact: "low" | "moderate" | "high";
  sources: readonly ("actual_activity" | "planned_cardio")[];
}

export interface CardioLoadForecast {
  policy: { id: string; version: string; evidenceTier: "D_product_policy"; unit: "relative_load" };
  days: readonly CardioLoadDayForecast[];
}

type LoadItem = {
  date: string;
  minutes: number;
  intensity: "easy" | "moderate" | "vigorous";
  modality: string;
  source: "actual_activity" | "planned_cardio";
};

function dateOf(value: string): string { return value.slice(0, 10); }
function round(value: number): number { return Math.round(value * 10) / 10; }
function intensityFactor(intensity: LoadItem["intensity"]): number {
  return intensity === "vigorous" ? 2 : intensity === "moderate" ? 1.2 : 0.65;
}
function impactFor(modality: string): "low" | "moderate" | "high" {
  const text = modality.toLowerCase();
  if (/run|jog|跳绳|rope|跑步|球类|basketball|football|tennis/.test(text)) return "high";
  if (/stair|爬楼|incline|坡|rower|划船机/.test(text)) return "moderate";
  return "low";
}
function lowerBodyFactor(modality: string): number {
  const impact = impactFor(modality);
  return impact === "high" ? 1 : impact === "moderate" ? 0.75 : 0.45;
}
function rankImpact(items: readonly LoadItem[]): CardioLoadDayForecast["impact"] {
  const ranks = items.map((item) => impactFor(item.modality));
  return ranks.includes("high") ? "high" : ranks.includes("moderate") ? "moderate" : "low";
}

function actualItems(events: readonly TimelineProjectionEvent[]): LoadItem[] {
  return events.flatMap((event) => {
    if (event.fact.kind !== "activity" || !event.fact.duration || event.fact.duration.unit !== "minutes") return [];
    const minutes = event.fact.duration.value;
    if (!Number.isFinite(minutes) || minutes <= 0) return [];
    // 实际 RPE 优先；没有则保留用户选择的粗强度，绝不凭消耗反推强度。
    const rpe = event.fact.perceivedExertion;
    const intensity = rpe !== undefined ? (rpe >= 7 ? "vigorous" : rpe >= 4 ? "moderate" : "easy")
      : event.fact.intensity === "hard" ? "vigorous"
        : event.fact.intensity === "moderate" ? "moderate"
          : "easy";
    return [{ date: dateOf(event.occurredAt), minutes, intensity, modality: event.fact.activityType, source: "actual_activity" as const }];
  });
}

function plannedItems(sessions: readonly PlannedSessionData[]): LoadItem[] {
  return sessions.flatMap((session) => {
    const block = session.aerobicBlock;
    if (!block) return [];
    const task = session.tasks.find((item) => item.mode === "timed");
    return [{
      date: session.scheduledFor,
      minutes: block.minutes,
      intensity: block.intensity === "vigorous" ? "vigorous" : block.intensity,
      modality: task?.exerciseVariantId ?? "planned_cardio",
      source: "planned_cardio" as const,
    }];
  });
}

/** 从实际活动和计划有氧一起建立滚动负荷；同日真实记录不会被计划重复计入。 */
export function forecastCardioLoad(input: {
  timeline: readonly TimelineProjectionEvent[];
  sessions: readonly PlannedSessionData[];
}): CardioLoadForecast {
  const actual = actualItems(input.timeline);
  const actualDates = new Set(actual.map((item) => item.date));
  const items = [...actual, ...plannedItems(input.sessions).filter((item) => !actualDates.has(item.date))];
  const byDate = new Map<string, LoadItem[]>();
  for (const item of items) byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  // 也为每个即将排程的日期产生一行，才能让第二天腿课读到前一天的残余有氧负荷。
  const dates = [...new Set([...byDate.keys(), ...input.sessions.map((session) => session.scheduledFor)])].sort();
  const days: CardioLoadDayForecast[] = [];
  let system = 0;
  let lowerBody = 0;
  let previousDate: string | undefined;
  for (const date of dates) {
    const entries = byDate.get(date) ?? [];
    const elapsed = previousDate ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previousDate}T00:00:00Z`)) / 86_400_000) : 0;
    system = round(system * CARDIO_LOAD_POLICY.dailyResidualMultiplier ** Math.max(0, elapsed));
    lowerBody = round(lowerBody * CARDIO_LOAD_POLICY.dailyResidualMultiplier ** Math.max(0, elapsed));
    const addedSystem = round(entries.reduce((sum, item) => sum + item.minutes * intensityFactor(item.intensity), 0));
    const addedLower = round(entries.reduce((sum, item) => sum + item.minutes * intensityFactor(item.intensity) * lowerBodyFactor(item.modality), 0));
    days.push({
      date,
      systemLoadBefore: system,
      lowerBodyLoadBefore: lowerBody,
      addedSystemLoad: addedSystem,
      addedLowerBodyLoad: addedLower,
      impact: entries.length ? rankImpact(entries) : "low",
      sources: [...new Set(entries.map((item) => item.source))],
    });
    system = round(system + addedSystem);
    lowerBody = round(lowerBody + addedLower);
    previousDate = date;
  }
  return { policy: { ...CARDIO_LOAD_POLICY, unit: "relative_load" }, days };
}
