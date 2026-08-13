import type { RecoveryConstraintData, TimelineProjectionEvent } from "../coach/domain";
import type { PrimarySourcePreferences, TimelineReadEvent, TimelineSourceSelector } from "../timeline";
import { projectTimelineEvent, stableTimelineOrder } from "../timeline";

export interface RecoveryRulePack {
  id: string;
  version: string;
  schemaVersion: 1;
  baseline: {
    minimumComparablePerformanceEvents: number;
    wearableBaselineSamples: number;
    freshnessHours: number;
    /** Product-policy deviation from a personal median, never a medical threshold. */
    meaningfulWearableDeviationFraction: number;
  };
}

export const DEFAULT_RECOVERY_RULE_PACK: RecoveryRulePack = {
  id: "maxpower-recovery",
  version: "1.0.0",
  schemaVersion: 1,
  baseline: {
    minimumComparablePerformanceEvents: 2,
    wearableBaselineSamples: 7,
    freshnessHours: 36,
    meaningfulWearableDeviationFraction: 0.1,
  },
};

export interface RecoveryCheckIn {
  perceivedRecovery?: number;
  fatigue?: number;
  soreness?: { area?: string; severity: number };
  pain?: { area?: string; severity: number; isNewSharp?: boolean };
  systemicSignal?: "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty";
  sleepDurationHours?: number;
  comparablePerformanceDeclines?: number;
  hrv?: {
    metric: "sdnn" | "rmssd";
    baselineMature: boolean;
    direction: "lower" | "normal" | "higher";
    permission: "granted" | "denied" | "missing" | "not_supported";
    freshness?: "fresh" | "stale" | "missing";
  };
  restingHeartRate?: {
    baselineMature: boolean;
    direction: "higher" | "normal" | "lower";
    permission: "granted" | "denied" | "missing" | "not_supported";
    freshness?: "fresh" | "stale" | "missing";
  };
  schedule?: { availableMinutes?: number; location?: string };
}

/**
 * Read-only provenance carried from Timeline into a rule evaluation.  The
 * rule engine deliberately receives facts, not a platform SDK response or a
 * vendor readiness score.
 */
export interface RecoveryEvidenceAttribution {
  triggeringFactRefs?: readonly string[];
  corroboratingFactRefs?: readonly string[];
  contradictingFactRefs?: readonly string[];
  missingOrStale?: readonly string[];
}

export interface RecoverySignalSeries {
  signal: "hrv_sdnn" | "hrv_rmssd" | "resting_heart_rate";
  source: TimelineSourceSelector;
  sourceIdentity: string;
  eventIds: readonly string[];
  currentEventId?: string;
  baselineMature: boolean;
  freshness: "fresh" | "stale" | "missing";
  direction: "lower" | "normal" | "higher";
  /** Other legitimate sources are retained as evidence rather than averaged. */
  competingEventIds: readonly string[];
}

/**
 * A deterministic bridge between the facts layer and RecoveryRulePack.  It
 * neither scores readiness nor changes a plan; it simply turns a selected,
 * compatible source series into an explicit check-in context and audit refs.
 */
export interface RecoveryTimelineEvidence {
  checkIn: RecoveryCheckIn;
  factRefs: readonly string[];
  attribution: RecoveryEvidenceAttribution;
  series: readonly RecoverySignalSeries[];
}

export interface RecoveryDecision {
  constraint: RecoveryConstraintData;
  explanation: {
    tone: "neutral" | "cautious";
    displayLabel: "按原计划" | "稍微放缓" | "优先恢复" | "暂停并确认";
    message: string;
  };
}

export function evaluateRecovery(input: {
  id: string;
  evaluatedAt: string;
  validUntil: string;
  checkIn: RecoveryCheckIn;
  factRefs?: readonly string[];
  evidence?: RecoveryEvidenceAttribution;
  rulePack?: RecoveryRulePack;
}): RecoveryDecision {
  const rules = input.rulePack ?? DEFAULT_RECOVERY_RULE_PACK;
  const refs = input.factRefs ?? [];
  const check = input.checkIn;
  const hardStop = Boolean(check.systemicSignal) || Boolean(check.pain?.isNewSharp);
  if (hardStop) {
    return decision(input, rules, {
      level: "pause_and_confirm",
      scope: "remaining_session",
      intentions: [{ kind: "pause" }],
      reasons: [check.systemicSignal ? `explicit_${check.systemicSignal}` : "explicit_new_sharp_pain"],
      triggering: refs,
      confirmationRequired: true,
      label: "暂停并确认",
      message: "先暂停当前训练；如症状持续、加重或令你担心，请寻求合适的专业帮助。",
    });
  }
  const subjectiveLow = (check.perceivedRecovery ?? 10) <= 3 || (check.fatigue ?? 0) >= 8;
  const localSorenessHigh = (check.soreness?.severity ?? 0) >= 7 || (check.pain?.severity ?? 0) >= 5;
  // 局部高不适不等于全身不能训练；把部位显式交给 Planner，供其移除
  // 涉及该肌群的动作或改排，而不是把所有课程一律停掉。
  const avoidAffectedArea = localSorenessHigh && (check.soreness?.area ?? check.pain?.area)
    ? [{ kind: "avoid_area" as const, area: check.soreness?.area ?? check.pain?.area }]
    : [];
  const repeatedDecline = (check.comparablePerformanceDeclines ?? 0) >= rules.baseline.minimumComparablePerformanceEvents;
  const wearableSupport = Boolean(
    (check.hrv?.baselineMature && check.hrv.direction === "lower" && check.hrv.permission === "granted" && check.hrv.freshness !== "stale") ||
    (check.restingHeartRate?.baselineMature && check.restingHeartRate.direction === "higher" && check.restingHeartRate.permission === "granted" && check.restingHeartRate.freshness !== "stale"),
  );
  if ((subjectiveLow && repeatedDecline) || (subjectiveLow && localSorenessHigh && wearableSupport)) {
    return decision(input, rules, {
      level: "recovery_priority",
      scope: "next_session",
      intentions: [
        { kind: "increase_rir", magnitude: 2 },
        { kind: "remove_optional_sets" },
        { kind: "extend_rest" },
        ...avoidAffectedArea,
      ],
      reasons: ["subjective_recovery_low", ...(repeatedDecline ? ["repeated_comparable_performance_decline"] : []), ...(wearableSupport ? ["wearable_context_supports"] : [])],
      triggering: refs,
      confirmationRequired: true,
      label: "优先恢复",
      message: "今天的反馈值得保守安排；可以降低非核心训练量，完成热身后再决定是否继续。",
    });
  }
  if (subjectiveLow || localSorenessHigh || repeatedDecline) {
    return decision(input, rules, {
      level: "slight_reduction",
      scope: "remaining_session",
      intentions: [{ kind: "increase_rir", magnitude: 1 }, { kind: "extend_rest" }, ...avoidAffectedArea],
      reasons: [
        ...(subjectiveLow ? ["subjective_recovery_low"] : []),
        ...(localSorenessHigh ? ["local_feedback_high"] : []),
        ...(repeatedDecline ? ["repeated_comparable_performance_decline"] : []),
      ],
      triggering: refs,
      confirmationRequired: false,
      label: "稍微放缓",
      message: "可以把今天的强度留一点余量，优先保持动作和节奏稳定。",
    });
  }
  const subjectiveGood = (check.perceivedRecovery ?? 0) >= 7 && (check.fatigue ?? 10) <= 3;
  const wearableAbnormal = Boolean(
    (check.hrv?.baselineMature && check.hrv.direction === "lower" && check.hrv.permission === "granted" && check.hrv.freshness !== "stale") ||
    (check.restingHeartRate?.baselineMature && check.restingHeartRate.direction === "higher" && check.restingHeartRate.permission === "granted" && check.restingHeartRate.freshness !== "stale"),
  );
  if (subjectiveGood && wearableAbnormal) {
    return decision(input, rules, {
      level: "normal",
      scope: "next_session",
      intentions: [{ kind: "warmup_check" }],
      reasons: ["subjective_feedback_preserves_plan", "wearable_context_requires_warmup_check_only"],
      triggering: refs,
      confirmationRequired: false,
      label: "按原计划",
      message: "先按原计划完成热身；设备趋势只作为需要留意的背景，不单独改变训练安排。",
    });
  }
  return decision(input, rules, {
    level: "normal",
    scope: "next_session",
    intentions: [],
    reasons: ["no_multi_signal_recovery_constraint"],
    triggering: [],
    confirmationRequired: false,
    label: "按原计划",
    message: "当前信息不足以支持调整计划；按原安排开始，并在热身后留意自己的状态。",
  });
}

function decision(
  input: Parameters<typeof evaluateRecovery>[0],
  rules: RecoveryRulePack,
  value: {
    level: RecoveryConstraintData["level"];
    scope: NonNullable<RecoveryConstraintData["scope"]>;
    intentions: NonNullable<RecoveryConstraintData["intentions"]>;
    reasons: readonly string[];
    triggering: readonly string[];
    confirmationRequired: boolean;
    label: RecoveryDecision["explanation"]["displayLabel"];
    message: string;
  },
): RecoveryDecision {
  const missingOrStale = [
    ...(input.checkIn.hrv?.permission !== "granted" ? ["hrv_unavailable_or_untrusted"] : []),
    ...(input.checkIn.restingHeartRate?.permission !== "granted" ? ["rhr_unavailable_or_untrusted"] : []),
    ...(input.checkIn.hrv?.freshness === "stale" ? ["hrv_stale"] : []),
    ...(input.checkIn.restingHeartRate?.freshness === "stale" ? ["rhr_stale"] : []),
    ...(input.evidence?.missingOrStale ?? []),
  ];
  return {
    constraint: {
      id: input.id,
      level: value.level,
      validUntil: input.validUntil,
      scope: value.scope,
      ...(input.checkIn.schedule ? { availability: input.checkIn.schedule } : {}),
      intentions: value.intentions,
      evaluation: {
        rulePackId: rules.id,
        ruleVersion: rules.version,
        evaluatedAt: input.evaluatedAt,
        triggeringFactRefs: uniqueRefs(value.triggering, input.evidence?.triggeringFactRefs),
        corroboratingFactRefs: uniqueRefs(input.evidence?.corroboratingFactRefs),
        contradictingFactRefs: uniqueRefs(input.evidence?.contradictingFactRefs),
        missingOrStale: uniqueRefs(missingOrStale),
        reasonCodes: value.reasons,
        confirmationRequired: value.confirmationRequired,
      },
    },
    explanation: {
      tone: value.level === "pause_and_confirm" ? "cautious" : "neutral",
      displayLabel: value.label,
      message: value.message,
    },
  };
}

/**
 * Builds one signal series per exact metric/source/device/algorithm identity.
 * SDNN/RMSSD and different device or algorithm generations never share a
 * baseline.  With several sources and no user choice, the signal is marked
 * ambiguous rather than silently averaging a vendor score.
 */
export function deriveRecoveryTimelineEvidence(input: {
  events: readonly TimelineProjectionEvent[];
  now: string;
  primarySources?: PrimarySourcePreferences;
  checkIn?: RecoveryCheckIn;
  rulePack?: RecoveryRulePack;
}): RecoveryTimelineEvidence {
  const rules = input.rulePack ?? DEFAULT_RECOVERY_RULE_PACK;
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid_recovery_evaluation_time");
  const active = stableTimelineOrder(
    input.events
      .filter((event) => (event.lifecycle ?? "active") === "active")
      .map(projectTimelineEvent),
  );
  const explicit = input.checkIn ?? {};
  const hrv = selectWearableSeries({
    events: active,
    nowMs,
    signal: "hrv",
    selector: input.primarySources?.hrv,
    rules,
  });
  const rhr = selectWearableSeries({
    events: active,
    nowMs,
    signal: "resting_heart_rate",
    selector: input.primarySources?.resting_heart_rate,
    rules,
  });
  const subjective = latestSubjectiveFacts(active, nowMs, rules.baseline.freshnessHours);
  const sleep = latestSleepFact(active, nowMs, rules.baseline.freshnessHours);
  const series = [
    ...(hrv.series ? [hrv.series] : []),
    ...(rhr.series ? [rhr.series] : []),
  ];
  const allRefs = uniqueRefs(
    ...subjective.factRefs,
    ...sleep.factRefs,
    ...series.flatMap((item) => [...item.eventIds, ...item.competingEventIds].map(timelineFactRef)),
  );
  const wearableContradictions = [
    ...(hrv.series?.competingEventIds ?? []),
    ...(rhr.series?.competingEventIds ?? []),
  ].map(timelineFactRef);
  const hrvCheckIn = hrv.checkIn && "metric" in hrv.checkIn ? hrv.checkIn : undefined;
  const rhrCheckIn = rhr.checkIn && !("metric" in rhr.checkIn) ? rhr.checkIn : undefined;
  const attribution: RecoveryEvidenceAttribution = {
    triggeringFactRefs: uniqueRefs(
      ...subjective.triggeringRefs,
      ...(explicit.perceivedRecovery !== undefined || explicit.fatigue !== undefined || explicit.pain || explicit.soreness || explicit.systemicSignal
        ? []
        : []),
    ),
    corroboratingFactRefs: uniqueRefs(
      ...sleep.factRefs,
      ...series
        .filter((item) => item.freshness === "fresh" && item.baselineMature && item.direction !== "normal")
        .flatMap((item) => item.currentEventId ? [timelineFactRef(item.currentEventId)] : []),
    ),
    contradictingFactRefs: uniqueRefs(...wearableContradictions),
    missingOrStale: uniqueRefs(...hrv.missingOrStale, ...rhr.missingOrStale, ...sleep.missingOrStale),
  };
  const derived: RecoveryCheckIn = {
    ...subjective.checkIn,
    ...sleep.checkIn,
    ...(hrvCheckIn ? { hrv: hrvCheckIn } : {}),
    ...(rhrCheckIn ? { restingHeartRate: rhrCheckIn } : {}),
    ...explicit,
    ...(explicit.hrv ? { hrv: explicit.hrv } : hrvCheckIn ? { hrv: hrvCheckIn } : {}),
    ...(explicit.restingHeartRate
      ? { restingHeartRate: explicit.restingHeartRate }
      : rhrCheckIn ? { restingHeartRate: rhrCheckIn } : {}),
  };
  // A user reporting good recovery while the selected wearable context is
  // abnormal is useful disagreement, not a reason to overwrite their answer.
  if ((explicit.perceivedRecovery ?? 10) >= 7 &&
    [derived.hrv?.direction === "lower", derived.restingHeartRate?.direction === "higher"].some(Boolean)) {
    attribution.contradictingFactRefs = uniqueRefs(
      ...(attribution.contradictingFactRefs ?? []),
      ...series.flatMap((item) => item.currentEventId ? [timelineFactRef(item.currentEventId)] : []),
    );
  }
  return { checkIn: derived, factRefs: allRefs, attribution, series };
}

function latestSubjectiveFacts(
  events: readonly TimelineReadEvent[],
  nowMs: number,
  freshnessHours: number,
): { checkIn: RecoveryCheckIn; factRefs: readonly string[]; triggeringRefs: readonly string[] } {
  const cutoff = nowMs - freshnessHours * 60 * 60 * 1000;
  const fresh = events.filter((event) => Date.parse(event.occurredAt) >= cutoff && Date.parse(event.occurredAt) <= nowMs);
  const latestRecovery = [...fresh].reverse().find((event) => event.fact.kind === "recovery" &&
    (event.fact.perceivedRecovery !== undefined || event.fact.fatigue !== undefined));
  const latestPain = [...fresh].reverse().find((event) => event.fact.kind === "symptom" && event.fact.symptom === "pain");
  const latestSoreness = [...fresh].reverse().find((event) => event.fact.kind === "symptom" && event.fact.symptom === "soreness");
  const checkIn: RecoveryCheckIn = {
    ...(latestRecovery?.fact.kind === "recovery" && latestRecovery.fact.perceivedRecovery !== undefined
      ? { perceivedRecovery: latestRecovery.fact.perceivedRecovery }
      : {}),
    ...(latestRecovery?.fact.kind === "recovery" && latestRecovery.fact.fatigue !== undefined
      ? { fatigue: latestRecovery.fact.fatigue }
      : {}),
    ...(latestPain?.fact.kind === "symptom"
      ? { pain: { ...(latestPain.fact.area ? { area: latestPain.fact.area } : {}), severity: latestPain.fact.severity ?? 0 } }
      : {}),
    ...(latestSoreness?.fact.kind === "symptom"
      ? { soreness: { ...(latestSoreness.fact.area ? { area: latestSoreness.fact.area } : {}), severity: latestSoreness.fact.severity ?? 0 } }
      : {}),
  };
  const factRefs = [latestRecovery, latestPain, latestSoreness].filter((item): item is TimelineReadEvent => Boolean(item)).map((item) => timelineFactRef(item.eventId));
  const triggeringRefs = [
    latestRecovery?.fact.kind === "recovery" && ((latestRecovery.fact.perceivedRecovery ?? 10) <= 3 || (latestRecovery.fact.fatigue ?? 0) >= 8) ? timelineFactRef(latestRecovery.eventId) : undefined,
    latestPain?.fact.kind === "symptom" && (latestPain.fact.severity ?? 0) >= 5 ? timelineFactRef(latestPain.eventId) : undefined,
    latestSoreness?.fact.kind === "symptom" && (latestSoreness.fact.severity ?? 0) >= 7 ? timelineFactRef(latestSoreness.eventId) : undefined,
  ].filter((item): item is string => Boolean(item));
  return { checkIn, factRefs, triggeringRefs };
}

function latestSleepFact(
  events: readonly TimelineReadEvent[],
  nowMs: number,
  freshnessHours: number,
): { checkIn: RecoveryCheckIn; factRefs: readonly string[]; missingOrStale: readonly string[] } {
  const sleep = [...events].reverse().find((event) => event.fact.kind === "sleep" && event.fact.duration !== undefined);
  if (!sleep || sleep.fact.kind !== "sleep" || !sleep.fact.duration) {
    return { checkIn: {}, factRefs: [], missingOrStale: ["sleep_unavailable"] };
  }
  const occurredMs = Date.parse(sleep.envelope?.time.endedAt ?? sleep.occurredAt);
  const fresh = Number.isFinite(occurredMs) && occurredMs >= nowMs - freshnessHours * 60 * 60 * 1000 && occurredMs <= nowMs;
  const duration = sleep.fact.duration;
  const hours = duration.unit === "hours" ? duration.value : duration.unit === "minutes" ? duration.value / 60 : duration.value / 3600;
  return {
    checkIn: fresh ? { sleepDurationHours: hours } : {},
    factRefs: [timelineFactRef(sleep.eventId)],
    missingOrStale: fresh ? [] : ["sleep_stale"],
  };
}

function selectWearableSeries(input: {
  events: readonly TimelineReadEvent[];
  nowMs: number;
  signal: "hrv" | "resting_heart_rate";
  selector?: TimelineSourceSelector;
  rules: RecoveryRulePack;
}): {
  series?: RecoverySignalSeries;
  checkIn?: NonNullable<RecoveryCheckIn["hrv"]> | NonNullable<RecoveryCheckIn["restingHeartRate"]>;
  missingOrStale: readonly string[];
} {
  const candidates = input.events.filter((event) => isWearableFact(event, input.signal));
  if (!candidates.length) {
    return { missingOrStale: [input.signal === "hrv" ? "hrv_unavailable_or_untrusted" : "rhr_unavailable_or_untrusted"] };
  }
  const groups = new Map<string, TimelineReadEvent[]>();
  for (const event of candidates) {
    const key = wearableIdentity(event, input.signal);
    const current = groups.get(key) ?? [];
    current.push(event);
    groups.set(key, current);
  }
  const allGroups = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right));
  const matchingGroups = allGroups
    .filter(([, group]) => !input.selector || sourceMatches(group[0]!, input.selector))
    .sort(([left], [right]) => left.localeCompare(right));
  if (!matchingGroups.length) {
    return { missingOrStale: [input.signal === "hrv" ? "hrv_primary_source_unavailable" : "rhr_primary_source_unavailable"] };
  }
  if (!input.selector && matchingGroups.length > 1) {
    return {
      missingOrStale: [input.signal === "hrv" ? "hrv_primary_source_not_selected" : "rhr_primary_source_not_selected"],
      series: ambiguousSeries(input.signal, matchingGroups),
    };
  }
  const [sourceIdentity, sourceEvents] = matchingGroups
    .sort(([, left], [, right]) => latestTime(right) - latestTime(left))[0]!;
  const ordered = stableTimelineOrder(sourceEvents);
  const current = ordered[ordered.length - 1]!;
  const value = wearableValue(current, input.signal);
  const occurredMs = Date.parse(current.occurredAt);
  const fresh = Number.isFinite(occurredMs) && occurredMs <= input.nowMs && occurredMs >= input.nowMs - input.rules.baseline.freshnessHours * 60 * 60 * 1000 && current.envelope?.provenance.dataStatus !== "stale";
  const baselineValues = ordered.slice(0, -1).map((event) => wearableValue(event, input.signal)).filter((candidate): candidate is number => candidate !== undefined);
  const baselineMature = baselineValues.length >= input.rules.baseline.wearableBaselineSamples;
  const baseline = median(baselineValues);
  const direction = wearableDirection(value, baseline, input.rules.baseline.meaningfulWearableDeviationFraction);
  const source = sourceSelector(current);
  const series: RecoverySignalSeries = {
    signal: input.signal === "hrv" && current.fact.kind === "recovery" && current.fact.hrvMetric === "sdnn" ? "hrv_sdnn" :
      input.signal === "hrv" ? "hrv_rmssd" : "resting_heart_rate",
    source,
    sourceIdentity,
    eventIds: ordered.map((event) => event.eventId),
    currentEventId: current.eventId,
    baselineMature,
    freshness: fresh ? "fresh" : "stale",
    direction,
    competingEventIds: allGroups.filter(([key]) => key !== sourceIdentity).flatMap(([, group]) => group.map((event) => event.eventId)),
  };
  if (input.signal === "hrv") {
    const metric = current.fact.kind === "recovery" && current.fact.hrvMetric === "sdnn" ? "sdnn" : "rmssd";
    return {
      series,
      checkIn: { metric, baselineMature, direction, permission: "granted", freshness: fresh ? "fresh" : "stale" },
      missingOrStale: fresh ? [] : ["hrv_stale"],
    };
  }
  return {
    series,
    checkIn: { baselineMature, direction, permission: "granted", freshness: fresh ? "fresh" : "stale" },
    missingOrStale: fresh ? [] : ["rhr_stale"],
  };
}

function ambiguousSeries(
  signal: "hrv" | "resting_heart_rate",
  groups: readonly [string, TimelineReadEvent[]][],
): RecoverySignalSeries {
  const all = stableTimelineOrder(groups.flatMap(([, group]) => group));
  const latest = all[all.length - 1];
  return {
    signal: signal === "hrv" && latest?.fact.kind === "recovery" && latest.fact.hrvMetric === "sdnn" ? "hrv_sdnn" : signal === "hrv" ? "hrv_rmssd" : "resting_heart_rate",
    source: latest ? sourceSelector(latest) : { origin: "manual" },
    sourceIdentity: "ambiguous",
    eventIds: [],
    baselineMature: false,
    freshness: "missing",
    direction: "normal",
    competingEventIds: all.map((event) => event.eventId),
  };
}

function isWearableFact(event: TimelineReadEvent, signal: "hrv" | "resting_heart_rate"): boolean {
  return event.fact.kind === "recovery" && (signal === "hrv" ? event.fact.hrv !== undefined : event.fact.restingHeartRate !== undefined);
}

function wearableValue(event: TimelineReadEvent, signal: "hrv" | "resting_heart_rate"): number | undefined {
  if (event.fact.kind !== "recovery") return undefined;
  return signal === "hrv" ? event.fact.hrv : event.fact.restingHeartRate;
}

function wearableIdentity(event: TimelineReadEvent, signal: "hrv" | "resting_heart_rate"): string {
  const provenance = event.envelope?.provenance;
  const metric = signal === "hrv" && event.fact.kind === "recovery" ? event.fact.hrvMetric ?? "unknown_hrv_metric" : "resting_heart_rate";
  return [metric, provenance?.origin ?? "manual", provenance?.deviceId ?? "", provenance?.recordingMethod ?? "manual_entry", provenance?.algorithmVersion ?? ""].join("|");
}

function sourceSelector(event: TimelineReadEvent): TimelineSourceSelector {
  const provenance = event.envelope?.provenance;
  return {
    origin: provenance?.origin ?? "manual",
    ...(provenance?.deviceId ? { deviceId: provenance.deviceId } : {}),
    ...(provenance?.recordingMethod ? { recordingMethod: provenance.recordingMethod } : {}),
    ...(provenance?.algorithmVersion ? { algorithmVersion: provenance.algorithmVersion } : {}),
  };
}

function sourceMatches(event: TimelineReadEvent, selector: TimelineSourceSelector): boolean {
  const actual = sourceSelector(event);
  return actual.origin === selector.origin &&
    (!selector.deviceId || actual.deviceId === selector.deviceId) &&
    (!selector.recordingMethod || actual.recordingMethod === selector.recordingMethod) &&
    (!selector.algorithmVersion || actual.algorithmVersion === selector.algorithmVersion);
}

function latestTime(events: readonly TimelineReadEvent[]): number {
  const last = stableTimelineOrder(events)[events.length - 1];
  const value = last ? Date.parse(last.occurredAt) : Number.NEGATIVE_INFINITY;
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function wearableDirection(current: number | undefined, baseline: number | undefined, fraction: number): "lower" | "normal" | "higher" {
  if (current === undefined || baseline === undefined || baseline <= 0) return "normal";
  if (current <= baseline * (1 - fraction)) return "lower";
  if (current >= baseline * (1 + fraction)) return "higher";
  return "normal";
}

function median(values: readonly number[]): number | undefined {
  if (!values.length) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function timelineFactRef(eventId: string): string {
  return `timeline_event:${eventId}`;
}

function uniqueRefs(...groups: (readonly (string | undefined)[] | string | undefined)[]): string[] {
  return [...new Set(groups
    .flatMap((group) => typeof group === "string" ? [group] : group ?? [])
    .filter((item): item is string => Boolean(item)))].sort();
}
