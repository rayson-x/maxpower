import { getT, PLAN_REPORT_COPY } from "../../i18n";

export interface CalendarPlanRangeValue {
  startDate: string;
  endDate: string;
}

/** Pure copy projection shared by native UI and deterministic tests. */
export function describeCycleRange(today: string, range?: CalendarPlanRangeValue, locale?: string): string {
  const t = getT(PLAN_REPORT_COPY, locale);
  if (!range) return t("cycleRange.none");
  const untilStart = dayDifference(today, range.startDate);
  const untilEnd = dayDifference(today, range.endDate);
  if (untilStart > 0) return t("cycleRange.beforeStart", { untilStart, untilEnd });
  if (untilEnd < 0) return t("cycleRange.finished", { daysAgo: Math.abs(untilEnd) });
  return t("cycleRange.inProgress", { dayNumber: Math.abs(untilStart) + 1, untilEnd });
}

function dayDifference(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00.000Z`) - Date.parse(`${from}T12:00:00.000Z`)) / 86_400_000);
}
