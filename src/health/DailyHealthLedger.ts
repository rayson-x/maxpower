import type { TimelineProjectionEvent, UserProfileData } from "../coach/domain";
import { stableHash } from "../coach/stable";
import {
  projectNutritionDayLedger,
  type NutritionDayLedger,
  type NutritionDayPlan,
} from "../nutrition/NutritionDayLedger";
import {
  dailyEnergyBudget,
  type ActivityKind,
  type DailyEnergyBudget,
  type DayActivity,
} from "../planning/dailyEnergyBudget";

export interface ValueRange {
  min: number;
  max: number;
}

export interface DailyHealthLedger {
  schemaVersion: 1;
  date: string;
  timezoneOffsetMinutes: number;
  version: string;
  timelineRevision: number;
  factFrontier: readonly { eventId: string; revision: number }[];
  nutritionPlan: NutritionDayPlan;
  nutrition: NutritionDayLedger;
  expenditure: {
    status: "complete" | "unknown";
    basal: { range?: ValueRange; source: "profile_formula" | "unknown" };
    dailyActivity: { range?: ValueRange; source: DailyEnergyBudget["neatSource"] | "unknown" };
    training: { range?: ValueRange; source: "timeline" | "unknown" };
    thermicEffect: { range?: ValueRange; source: "rule_estimate" | "unknown" };
    total: { range: ValueRange; source: "profile_formula" | "personal_calibration"; calibrationVersion?: string } | { range?: undefined; source: "unknown" };
    missing: readonly string[];
  };
  energyBalance:
    | { status: "complete"; range: ValueRange; convention: "intake_minus_expenditure" }
    | { status: "partial" | "unknown"; range?: undefined; convention: "intake_minus_expenditure"; missing: readonly string[] };
  activity: {
    recordedCount: number;
    totalDurationMinutes?: number;
  };
  training: {
    recordedCount: number;
    confirmedCompletedCount: number;
    confirmedMissedCount: number;
  };
  body: { recordedCount: number };
  recovery: { recordedCount: number };
  coverage: {
    nutrition: NutritionDayLedger["coverage"];
    activity: "no_log" | "logged";
    training: "no_log" | "logged";
    body: "no_log" | "logged";
    recovery: "no_log" | "logged";
  };
}

export function projectDailyHealthLedger(input: {
  date: string;
  timezoneOffsetMinutes: number;
  timelineRevision: number;
  events: readonly TimelineProjectionEvent[];
  nutritionPlan: NutritionDayPlan;
  profile?: UserProfileData;
  maintenanceCalibration?: { range: ValueRange; version: string };
}): DailyHealthLedger {
  const events = input.events
    .filter((event) => event.lifecycle === "active")
    .filter((event) => localDate(event.occurredAt, input.timezoneOffsetMinutes) === input.date);
  const nutrition = projectNutritionDayLedger({ plan: input.nutritionPlan, events });
  const confirmed = events.filter((event) => event.fact.confidence === "confirmed");
  const activities = confirmed.filter((event) => event.fact.kind === "activity");
  const training = confirmed.filter((event) => event.fact.kind === "training");
  const body = confirmed.filter((event) => event.fact.kind === "body");
  const recovery = confirmed.filter((event) => event.fact.kind === "recovery" || event.fact.kind === "sleep");
  const dayActivity = deriveDayActivity(activities, training);
  const budget = input.profile ? dailyEnergyBudget({ profile: input.profile, day: dayActivity }) : undefined;
  const expenditure = expenditureProjection(budget, training.length > 0, input.maintenanceCalibration);
  const energy = nutrition.nutrients.energy;
  const energyBalance = energy.intakeKnown && expenditure.total.range
    ? {
        status: "complete" as const,
        range: {
          min: energy.consumedLogged - expenditure.total.range.max,
          max: energy.consumedLogged - expenditure.total.range.min,
        },
        convention: "intake_minus_expenditure" as const,
      }
    : {
        status: nutrition.coverage === "no_log" ? "unknown" as const : "partial" as const,
        convention: "intake_minus_expenditure" as const,
        missing: [
          ...(!energy.intakeKnown ? ["complete_energy_intake_unavailable"] : []),
          ...(!expenditure.total.range ? ["expenditure_unavailable"] : []),
        ],
      };
  const factFrontier = events
    .map((event) => ({ eventId: event.eventId, revision: event.revision }))
    .sort((left, right) => left.eventId.localeCompare(right.eventId) || left.revision - right.revision);
  const totalDurationMinutes = activities.reduce((total, event) => {
    if (event.fact.kind !== "activity" || event.fact.duration?.unit !== "minutes") return total;
    return total + event.fact.duration.value;
  }, 0);

  const ledgerWithoutVersion = {
    schemaVersion: 1 as const,
    date: input.date,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    timelineRevision: input.timelineRevision,
    factFrontier,
    nutritionPlan: input.nutritionPlan,
    nutrition,
    expenditure,
    energyBalance,
    activity: {
      recordedCount: activities.length,
      ...(totalDurationMinutes > 0 ? { totalDurationMinutes } : {}),
    },
    training: {
      recordedCount: training.length,
      confirmedCompletedCount: training.filter((event) => event.fact.kind === "training" && event.fact.reportedSession?.executionStatus === "completed").length,
      confirmedMissedCount: training.filter((event) => event.fact.kind === "training" && event.fact.reportedSession?.executionStatus === "missed").length,
    },
    body: { recordedCount: body.length },
    recovery: { recordedCount: recovery.length },
    coverage: {
      nutrition: nutrition.coverage,
      activity: activities.length ? "logged" as const : "no_log" as const,
      training: training.length ? "logged" as const : "no_log" as const,
      body: body.length ? "logged" as const : "no_log" as const,
      recovery: recovery.length ? "logged" as const : "no_log" as const,
    },
  };
  return {
    ...ledgerWithoutVersion,
    version: stableHash(ledgerWithoutVersion),
  };
}

function expenditureProjection(
  budget: DailyEnergyBudget | undefined,
  hasTraining: boolean,
  calibration?: { range: ValueRange; version: string },
): DailyHealthLedger["expenditure"] {
  if (!budget) {
    return {
      status: "unknown",
      basal: { source: "unknown" },
      dailyActivity: { source: "unknown" },
      training: { source: "unknown" },
      thermicEffect: { source: "unknown" },
      total: { source: "unknown" },
      missing: ["profile_energy_inputs_missing"],
    };
  }
  const uncertaintyRatio = budget.uncertaintyKcal / Math.max(1, budget.tdeeKcal);
  const range = (value: number, ratio = uncertaintyRatio): ValueRange => ({
    min: Math.max(0, Math.round(value * (1 - ratio))),
    max: Math.round(value * (1 + ratio)),
  });
  return {
    status: "complete",
    basal: { range: range(budget.bmrKcal, 0.05), source: "profile_formula" },
    dailyActivity: { range: range(budget.neatKcal), source: budget.neatSource },
    training: { range: range(budget.eatKcal), source: hasTraining ? "timeline" : "unknown" },
    thermicEffect: { range: range(budget.tefKcal, 0.2), source: "rule_estimate" },
    total: calibration
      ? { range: calibration.range, source: "personal_calibration", calibrationVersion: calibration.version }
      : { range: { min: Math.max(0, budget.tdeeKcal - budget.uncertaintyKcal), max: budget.tdeeKcal + budget.uncertaintyKcal }, source: "profile_formula" },
    missing: [],
  };
}

function deriveDayActivity(
  activities: readonly TimelineProjectionEvent[],
  training: readonly TimelineProjectionEvent[],
): DayActivity {
  const reportedActivityKcal = activities.reduce((total, event) => {
    if (event.fact.kind !== "activity" || !event.fact.energyExpenditure) return total;
    const energy = event.fact.energyExpenditure;
    return total + (energy.unit === "kcal" ? energy.value : energy.value / 4.184);
  }, 0);
  const sessions: { kind: ActivityKind; minutes: number }[] = [];
  for (const event of activities) {
    if (event.fact.kind !== "activity" || event.fact.duration?.unit !== "minutes") continue;
    sessions.push({
      kind: event.fact.intensity === "hard" ? "cardio_vigorous" : event.fact.intensity === "easy" ? "walk_easy" : "cardio_moderate",
      minutes: event.fact.duration.value,
    });
  }
  for (const event of training) {
    if (event.fact.kind !== "training") continue;
    const duration = event.fact.reportedSession?.duration;
    if (duration?.unit === "minutes") sessions.push({ kind: "resistance_moderate", minutes: duration.value });
  }
  return {
    ...(sessions.length ? { sessions } : {}),
    ...(reportedActivityKcal > 0 ? { reportedActivityKcal } : {}),
  };
}

function localDate(iso: string, offsetMinutes: number): string {
  return new Date(Date.parse(iso) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
