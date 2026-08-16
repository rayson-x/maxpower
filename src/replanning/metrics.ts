import type { DomainProjection } from "../coach/domain";

export type MetricName = "body_trend" | "training_trend" | "nutrition_adherence" | "recovery_trend" | "phase_progress" | "goal_feasibility";

export interface MetricEnvelope {
  name: MetricName;
  window: { start: string; end: string };
  comparableDays: number;
  confidence: "low" | "moderate" | "high";
  value: { direction: "improving" | "stable" | "declining" | "unknown"; score?: number };
  evidenceRefs: readonly string[];
  confounders: readonly string[];
  missing: readonly string[];
  ruleVersion: string;
}

export function deriveMetricRegistry(input: {
  domain: DomainProjection;
  startDate: string;
  endDate: string;
  ruleVersion?: string;
}): readonly MetricEnvelope[] {
  const events = input.domain.timeline.current.filter((event) => event.occurredAt.slice(0, 10) >= input.startDate && event.occurredAt.slice(0, 10) <= input.endDate);
  const evidence = (prefix: string, ids: readonly string[]) => ids.map((id) => `${prefix}:${id}`);
  const body = events.filter((event) => event.fact.kind === "body");
  const weight = body.filter((event) => event.fact.kind === "body" && event.fact.measurement.metric === "body_weight");
  const bodyFat = body.filter((event) => event.fact.kind === "body" && event.fact.measurement.metric === "body_fat_percentage");
  const nutrition = events.filter((event) => event.fact.kind === "nutrition");
  const confirmedNutrition = nutrition.filter((event) => event.fact.kind === "nutrition" && event.fact.confidence === "confirmed");
  const recovery = events.filter((event) => event.fact.kind === "recovery" || event.fact.kind === "sleep" || event.fact.kind === "symptom");
  const performed = input.domain.workouts.flatMap((workout) => workout.setOutcomes.filter((outcome) => outcome.source === "user_confirmed").map((outcome) => ({ workout, outcome })));
  const stage = input.domain.plan && input.domain.goalContract
    ? {
        startDate: input.domain.plan.value.effectiveFrom,
        endDate: input.domain.goalContract.value.horizon.endDate,
        planId: input.domain.plan.value.id,
        planRevision: input.domain.plan.revision,
        goalId: input.domain.goalContract.value.id,
        goalRevision: input.domain.goalContract.revision,
      }
    : undefined;
  const dayCount = (items: readonly { occurredAt: string }[]) => new Set(items.map((item) => item.occurredAt.slice(0, 10))).size;
  const directionFrom = (values: readonly number[]): MetricEnvelope["value"] => {
    if (values.length < 2) return { direction: "unknown" };
    const first = values[0]!;
    const last = values.at(-1)!;
    const delta = last - first;
    return { direction: Math.abs(delta) < Math.max(0.01, Math.abs(first) * 0.01) ? "stable" : delta < 0 ? "improving" : "declining", score: delta };
  };
  const common = (name: MetricName, comparableDays: number, confidence: MetricEnvelope["confidence"], value: MetricEnvelope["value"], refs: readonly string[], missing: readonly string[], confounders: readonly string[] = []): MetricEnvelope => ({
    name,
    window: { start: input.startDate, end: input.endDate },
    comparableDays,
    confidence,
    value,
    evidenceRefs: refs,
    confounders,
    missing,
    ruleVersion: input.ruleVersion ?? "maxpower.metrics.v1",
  });
  const bodyValues = weight.map((event) => event.fact.kind === "body" && event.fact.measurement.metric === "body_weight" ? event.fact.measurement.quantity.value : 0);
  const trainingValues = performed.map(({ outcome }) => outcome.actualReps ?? 0).filter((value) => value > 0);
  const lowRecovery = recovery.filter((event) => event.fact.kind === "recovery" && ((event.fact.perceivedRecovery ?? 10) <= 3 || (event.fact.fatigue ?? 0) >= 8)).length;
  const phaseDays = stage ? Math.max(0, Math.floor((Date.parse(`${input.endDate}T12:00:00Z`) - Date.parse(`${stage.startDate}T12:00:00Z`)) / 86_400_000) + 1) : 0;
  const phaseLength = stage ? Math.max(1, Math.floor((Date.parse(`${stage.endDate}T12:00:00Z`) - Date.parse(`${stage.startDate}T12:00:00Z`)) / 86_400_000) + 1) : 0;
  return [
    common("body_trend", Math.max(dayCount(weight), dayCount(bodyFat)), weight.length >= 2 ? "moderate" : "low", directionFrom(bodyValues), evidence("timeline", weight.map((item) => item.eventId)), weight.length < 2 ? ["minimum_comparable_body_observations"] : [], bodyFat.length === 1 ? ["single_body_fat_observation_not_comparable"] : []),
    common("training_trend", new Set(performed.map(({ workout }) => workout.id)).size, performed.length >= 2 ? "moderate" : "low", directionFrom(trainingValues), evidence("workout", performed.map(({ outcome }) => outcome.id)), performed.length < 2 ? ["minimum_confirmed_performance_observations"] : [], performed.some(({ outcome }) => outcome.completedAs === "imported") ? ["imported_performance"] : []),
    common("nutrition_adherence", dayCount(nutrition), confirmedNutrition.length >= 3 ? "moderate" : "low", confirmedNutrition.length === 0 ? { direction: "unknown" } : { direction: confirmedNutrition.length === nutrition.length ? "stable" : "unknown", score: confirmedNutrition.length / Math.max(1, nutrition.length) }, evidence("timeline", confirmedNutrition.map((item) => item.eventId)), confirmedNutrition.length === 0 ? ["no_confirmed_nutrition"] : [], nutrition.some((event) => event.fact.kind === "nutrition" && event.fact.observationMode === "descriptive") ? ["qualitative_meal_entries"] : []),
    common("recovery_trend", dayCount(recovery), recovery.length >= 2 ? "moderate" : "low", lowRecovery > 0 ? { direction: "declining", score: -lowRecovery } : recovery.length ? { direction: "stable", score: 0 } : { direction: "unknown" }, evidence("timeline", recovery.map((item) => item.eventId)), recovery.length === 0 ? ["no_recovery_facts"] : []),
    common("phase_progress", phaseDays, stage ? "moderate" : "low", stage ? { direction: phaseDays >= phaseLength ? "improving" : "stable", score: phaseDays / phaseLength } : { direction: "unknown" }, stage ? [`goal_contract:${stage.goalId}:${stage.goalRevision}`, `plan:${stage.planId}:${stage.planRevision}`] : [], stage ? [] : ["no_active_plan_stage"]),
    common("goal_feasibility", 0, input.domain.profile && input.domain.goalContract ? "moderate" : "low", input.domain.profile && input.domain.goalContract ? { direction: "unknown" } : { direction: "unknown" }, ["profile", "goal_contract"], input.domain.profile && input.domain.goalContract ? ["outcome_trend_not_yet_sufficient"] : ["profile_or_goal_missing"]),
  ];
}
