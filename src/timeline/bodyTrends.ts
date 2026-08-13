import type { TimelineProjectionEvent } from "../coach/domain";
import type { PrimarySourcePreferences, TimelineMetric, TimelineReadEvent, TimelineSourceSelector } from "./model";
import { projectTimelineEvent, stableTimelineOrder, timelineDayKey } from "./projector";

export interface BodyTrendPoint {
  eventId: string;
  date: string;
  value: number;
  unit: "kg" | "lb" | "percent";
  smoothedValue?: number;
  condition?: string;
  source: TimelineSourceSelector;
  confidence: "confirmed" | "estimated" | "low";
}

export interface BodyTrendSeries {
  metric: "body_weight" | "body_fat_percentage";
  source: TimelineSourceSelector;
  rawPoints: readonly BodyTrendPoint[];
  smoothedPoints: readonly BodyTrendPoint[];
  coverage: { observations: number; uniqueDays: number; windowDays: number };
  confounders: readonly string[];
  confidence: "confirmed" | "estimated" | "low";
  algorithm: "rolling_median_v1";
}

export interface BodyTrendReport {
  generatedFromTimelineRevision: number;
  weight: readonly BodyTrendSeries[];
  bodyFat: readonly BodyTrendSeries[];
  /** Trend output is descriptive only; it never edits a plan. */
  automaticPlanChange: false;
}

export function deriveBodyTrends(input: {
  events: readonly TimelineProjectionEvent[];
  preferences?: PrimarySourcePreferences;
  windowDays?: number;
}): BodyTrendReport {
  const active = stableTimelineOrder(
    input.events
      .filter((event) => (event.lifecycle ?? "active") === "active")
      .map(projectTimelineEvent),
  );
  const weights = bodyEvents(active, "body_weight");
  const bodyFat = bodyEvents(active, "body_fat_percentage");
  const windowDays = Math.max(2, input.windowDays ?? 7);
  return {
    generatedFromTimelineRevision: input.events.reduce((max, event) => Math.max(max, event.revision), 0),
    weight: createSeries(weights, "body_weight", input.preferences?.body_weight, windowDays, false),
    bodyFat: createSeries(bodyFat, "body_fat_percentage", input.preferences?.body_fat_percentage, windowDays, true),
    automaticPlanChange: false,
  };
}

function bodyEvents(
  events: readonly TimelineReadEvent[],
  metric: "body_weight" | "body_fat_percentage",
): TimelineReadEvent[] {
  return events.filter(
    (event) => event.fact.kind === "body" && event.fact.measurement.metric === metric,
  );
}

function createSeries(
  events: readonly TimelineReadEvent[],
  metric: "body_weight" | "body_fat_percentage",
  preferred: TimelineSourceSelector | undefined,
  windowDays: number,
  requireExactBodyFatIdentity: boolean,
): BodyTrendSeries[] {
  const groups = new Map<string, TimelineReadEvent[]>();
  for (const event of events) {
    const selector = selectorFor(event, metric);
    // A raw observation must keep its recorded unit. Converting a series is a
    // separate, explicit projection; until then a user changing a scale from
    // kg to lb cannot silently turn 80 kg and 176 lb into one median.
    const key = [
      sourceKey(selector, requireExactBodyFatIdentity),
      metric === "body_weight" ? bodyWeightUnit(event) : "",
    ].join("|");
    const group = groups.get(key) ?? [];
    group.push(event);
    groups.set(key, group);
  }
  const series = [...groups.values()].map((group) => buildSeries(group, metric, windowDays));
  if (!preferred) return series;
  const preferredMatches = series.filter((item) => selectorMatches(item.source, preferred));
  return preferredMatches.length ? preferredMatches : series;
}

function bodyWeightUnit(event: TimelineReadEvent): "kg" | "lb" {
  if (event.fact.kind !== "body" || event.fact.measurement.metric !== "body_weight") {
    throw new Error("Weight series requires body-weight observations");
  }
  return event.fact.measurement.quantity.unit;
}

function buildSeries(
  events: readonly TimelineReadEvent[],
  metric: "body_weight" | "body_fat_percentage",
  windowDays: number,
): BodyTrendSeries {
  const ordered = stableTimelineOrder(events);
  const first = ordered[0];
  if (!first || first.fact.kind !== "body") throw new Error("Body series requires body observations");
  const source = selectorFor(first, metric);
  const conditions = new Set<string>();
  const rawPoints: BodyTrendPoint[] = ordered.map((event, index) => {
    if (event.fact.kind !== "body") throw new Error("Body series requires body observations");
    const measurement = event.fact.measurement;
    const condition = measurement.condition;
    if (condition) conditions.add(condition);
    const comparable = ordered
      .slice(Math.max(0, index - windowDays + 1), index + 1)
      .filter((candidate) => {
        if (candidate.fact.kind !== "body") return false;
        return candidate.fact.measurement.condition === condition;
      })
      .map((candidate) => {
        if (candidate.fact.kind !== "body") throw new Error("Body series requires body observations");
        return candidate.fact.measurement.quantity.value;
      });
    if (measurement.metric !== metric) throw new Error("Body series metric mismatch");
    const quantity = measurement.quantity as { value: number; unit: "kg" | "lb" | "percent" };
    const confidence = event.envelope?.provenance.confidence === "estimated" ? "estimated" : "confirmed";
    return {
      eventId: event.eventId,
      date: timelineDayKey(event),
      value: quantity.value,
      unit: quantity.unit,
      smoothedValue: median(comparable),
      ...(condition ? { condition } : {}),
      source,
      confidence,
    };
  });
  const uniqueDays = new Set(rawPoints.map((point) => point.date)).size;
  const confounders = [
    ...(conditions.size > 1 ? ["measurement_conditions_mixed"] : []),
    ...(rawPoints.some((point) => point.confidence === "estimated") ? ["estimated_observation"] : []),
    ...(metric === "body_fat_percentage" ? ["consumer_body_fat_is_low_confidence"] : []),
  ];
  const confidence = metric === "body_fat_percentage" || confounders.length
    ? "low"
    : rawPoints.some((point) => point.confidence === "estimated")
      ? "estimated"
      : "confirmed";
  return {
    metric,
    source,
    rawPoints,
    smoothedPoints: rawPoints,
    coverage: { observations: rawPoints.length, uniqueDays, windowDays },
    confounders,
    confidence,
    algorithm: "rolling_median_v1",
  };
}

function selectorFor(
  event: TimelineReadEvent,
  metric: TimelineMetric,
): TimelineSourceSelector {
  const provenance = event.envelope?.provenance;
  const measurement = event.fact.kind === "body" ? event.fact.measurement : undefined;
  return {
    origin: provenance?.origin ?? "manual",
    ...(provenance?.deviceId ? { deviceId: provenance.deviceId } : {}),
    ...(provenance?.recordingMethod ? { recordingMethod: provenance.recordingMethod } : {}),
    ...(metric === "body_fat_percentage" && measurement?.metric === "body_fat_percentage" && measurement.method
      ? { method: measurement.method }
      : {}),
    ...(metric === "body_fat_percentage" && measurement?.metric === "body_fat_percentage" && measurement.algorithmVersion
      ? { algorithmVersion: measurement.algorithmVersion }
      : {}),
  };
}

function sourceKey(selector: TimelineSourceSelector, exact: boolean): string {
  return exact
    ? [selector.origin, selector.deviceId ?? "", selector.recordingMethod ?? "", selector.method ?? "", selector.algorithmVersion ?? ""].join("|")
    : [selector.origin, selector.deviceId ?? "", selector.recordingMethod ?? ""].join("|");
}

function selectorMatches(actual: TimelineSourceSelector, preferred: TimelineSourceSelector): boolean {
  return (actual.origin === preferred.origin) &&
    (!preferred.deviceId || actual.deviceId === preferred.deviceId) &&
    (!preferred.recordingMethod || actual.recordingMethod === preferred.recordingMethod) &&
    (!preferred.method || actual.method === preferred.method) &&
    (!preferred.algorithmVersion || actual.algorithmVersion === preferred.algorithmVersion);
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle];
}
