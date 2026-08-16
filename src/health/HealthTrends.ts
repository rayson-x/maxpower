import type { TimelineProjectionEvent } from "../coach/domain";
import { stableHash } from "../coach/stable";
import type { DailyHealthLedger, ValueRange } from "./DailyHealthLedger";

export interface HealthTrendBucket {
  key: string;
  dayCount: number;
  completeEnergyDays: number;
  energyBalance?: ValueRange;
  nutrients: Readonly<Record<string, { amount: number; unit: string; confirmedDays: number }>>;
  activityMinutes: number;
  trainingCompleted: number;
  trainingMissed: number;
  bodyObservationCount: number;
  recoveryObservationCount: number;
}

export interface PersonalEnergyCalibration {
  status: "calibrated" | "insufficient_evidence";
  maintenanceRange?: ValueRange;
  evidenceWindow: { startDate: string; endDate: string; observedDays: number; completeEnergyDays: number; comparableWeightObservations: number };
  factFrontier: readonly { eventId: string; revision: number }[];
  ruleVersion: "personal-energy-calibration.v1";
  uncertaintyKcal?: number;
  missing: readonly string[];
}

export interface HealthTrendProjection {
  schemaVersion: 1;
  version: string;
  startDate: string;
  endDate: string;
  daily: readonly DailyHealthLedger[];
  weekly: readonly HealthTrendBucket[];
  monthly: readonly HealthTrendBucket[];
  calibration: PersonalEnergyCalibration;
}

/** Rolls the canonical daily ledgers up without re-reading or imputing facts. */
export function projectHealthTrends(input: {
  ledgers: readonly DailyHealthLedger[];
  timeline: readonly TimelineProjectionEvent[];
  startDate: string;
  endDate: string;
  timezoneOffsetMinutes: number;
}): HealthTrendProjection {
  const daily = [...input.ledgers].sort((left, right) => left.date.localeCompare(right.date));
  const calibration = calibratePersonalEnergy({ ...input, ledgers: daily });
  const projection = {
    schemaVersion: 1 as const,
    startDate: input.startDate,
    endDate: input.endDate,
    daily,
    weekly: buckets(daily, (date) => weekKey(date)),
    monthly: buckets(daily, (date) => date.slice(0, 7)),
    calibration,
  };
  return { ...projection, version: stableHash(projection) };
}

function buckets(ledgers: readonly DailyHealthLedger[], keyFor: (date: string) => string): HealthTrendBucket[] {
  const grouped = new Map<string, DailyHealthLedger[]>();
  for (const ledger of ledgers) grouped.set(keyFor(ledger.date), [...(grouped.get(keyFor(ledger.date)) ?? []), ledger]);
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, days]) => {
    const complete = days.filter((day): day is DailyHealthLedger & { energyBalance: { status: "complete"; range: ValueRange; convention: "intake_minus_expenditure" } } => day.energyBalance.status === "complete");
    const nutrients: Record<string, { amount: number; unit: string; confirmedDays: number }> = {};
    for (const day of days) {
      for (const [id, value] of Object.entries(day.nutrition.nutrients)) {
        if (!value) continue;
        if (!value.intakeKnown) continue;
        const current = nutrients[id] ?? { amount: 0, unit: value.unit, confirmedDays: 0 };
        nutrients[id] = { amount: current.amount + value.consumedLogged, unit: value.unit, confirmedDays: current.confirmedDays + 1 };
      }
    }
    return {
      key,
      dayCount: days.length,
      completeEnergyDays: complete.length,
      ...(complete.length ? { energyBalance: { min: sum(complete.map((day) => day.energyBalance.range.min)), max: sum(complete.map((day) => day.energyBalance.range.max)) } } : {}),
      nutrients,
      activityMinutes: sum(days.map((day) => day.activity.totalDurationMinutes ?? 0)),
      trainingCompleted: sum(days.map((day) => day.training.confirmedCompletedCount)),
      trainingMissed: sum(days.map((day) => day.training.confirmedMissedCount)),
      bodyObservationCount: sum(days.map((day) => day.body.recordedCount)),
      recoveryObservationCount: sum(days.map((day) => day.recovery.recordedCount)),
    };
  });
}

function calibratePersonalEnergy(input: { ledgers: readonly DailyHealthLedger[]; timeline: readonly TimelineProjectionEvent[]; startDate: string; endDate: string; timezoneOffsetMinutes: number }): PersonalEnergyCalibration {
  const complete = input.ledgers.filter((day) => day.nutrition.nutrients.energy.intakeKnown);
  const weights = input.timeline
    .filter((event) => (event.lifecycle ?? "active") === "active" && event.fact.kind === "body" && event.fact.confidence === "confirmed" && event.fact.measurement.metric === "body_weight")
    .filter((event) => {
      const date = localDate(event.occurredAt, input.timezoneOffsetMinutes);
      return date >= input.startDate && date <= input.endDate;
    })
    .map((event) => ({ date: localDate(event.occurredAt, input.timezoneOffsetMinutes), kg: event.fact.kind === "body" ? (event.fact.measurement.quantity.unit === "kg" ? event.fact.measurement.quantity.value : event.fact.measurement.quantity.value * 0.45359237) : 0, condition: event.fact.kind === "body" ? event.fact.measurement.condition : undefined, method: event.envelope?.provenance.recordingMethod ?? "unknown" }))
    .sort((left, right) => left.date.localeCompare(right.date));
  const comparable = comparableWeights(weights);
  const observedDays = input.ledgers.length;
  const missing = [
    ...(observedDays < 14 ? ["observation_window_too_short"] : []),
    ...(complete.length < 10 ? ["confirmed_energy_coverage_insufficient"] : []),
    ...(comparable.length < 3 ? ["comparable_weight_measurements_insufficient"] : []),
  ];
  const factFrontier = [...new Map(input.ledgers.flatMap((day) => day.factFrontier).map((fact) => [`${fact.eventId}:${fact.revision}`, fact])).values()]
    .sort((left, right) => left.eventId.localeCompare(right.eventId));
  const base = { evidenceWindow: { startDate: input.startDate, endDate: input.endDate, observedDays, completeEnergyDays: complete.length, comparableWeightObservations: comparable.length }, factFrontier, ruleVersion: "personal-energy-calibration.v1" as const, missing };
  if (missing.length) return { status: "insufficient_evidence", ...base };
  const spanDays = Math.max(1, daysBetween(comparable[0]!.date, comparable.at(-1)!.date));
  const weightChangeKg = comparable.at(-1)!.kg - comparable[0]!.kg;
  const meanIntake = sum(complete.map((day) => day.nutrition.nutrients.energy.consumedLogged)) / complete.length;
  const maintenance = meanIntake - (weightChangeKg * 7_700) / spanDays;
  const uncertaintyKcal = Math.max(120, Math.round(360 / Math.sqrt(complete.length)));
  return { status: "calibrated", ...base, maintenanceRange: { min: Math.round(maintenance - uncertaintyKcal), max: Math.round(maintenance + uncertaintyKcal) }, uncertaintyKcal };
}

function comparableWeights(values: readonly { date: string; kg: number; condition?: string; method: string }[]) {
  const conditions = values.map((value) => `${value.condition ?? "unspecified"}:${value.method}`);
  if (!conditions.length) return values;
  const counts = new Map<string, number>();
  for (const condition of conditions) counts.set(condition, (counts.get(condition) ?? 0) + 1);
  const selected = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  return values.filter((value) => `${value.condition ?? "unspecified"}:${value.method}` === selected);
}

function weekKey(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  const weekday = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() - weekday + 1);
  return value.toISOString().slice(0, 10);
}
function localDate(iso: string, offset: number): string { return new Date(Date.parse(iso) + offset * 60_000).toISOString().slice(0, 10); }
function daysBetween(left: string, right: string): number { return Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86_400_000); }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
