import type {
  EnergyQuantity,
  NutritionStrategyData,
  PlanRevisionData,
  RecoveryConstraintData,
  TimelineProjectionEvent,
} from "../coach/domain";

export interface NutritionStrategyRulePack {
  id: string;
  version: string;
  proteinGramsPerKg: Record<"hypertrophy" | "strength_stable" | "fat_loss_preserve_lean_mass", { min: number; max: number }>;
  fatFloorPercent: number;
  review: {
    minimumWeightObservations: number;
    minimumComparableWeeks: number;
    /** Numeric energy changes need enough distinct days of precise logging. */
    minimumPreciseDaysPerWeek: number;
    maximumDailyAdjustmentKcal: number;
  };
}

export const DEFAULT_NUTRITION_RULE_PACK: NutritionStrategyRulePack = {
  id: "maxpower-nutrition",
  version: "1.0.0",
  proteinGramsPerKg: {
    hypertrophy: { min: 1.6, max: 2.2 },
    strength_stable: { min: 1.6, max: 2.0 },
    fat_loss_preserve_lean_mass: { min: 1.8, max: 2.2 },
  },
  fatFloorPercent: 20,
  review: { minimumWeightObservations: 3, minimumComparableWeeks: 2, minimumPreciseDaysPerWeek: 3, maximumDailyAdjustmentKcal: 200 },
};

export interface MealObservation {
  id: string;
  occurredAt: string;
  mode: "precise" | "simplified" | "estimated";
  description?: string;
  mealSlot?: import("./NutritionDayLedger").MealSlot;
  foods?: readonly import("./NutritionDayLedger").FoodEntryData[];
  energy?: EnergyQuantity;
  proteinGrams?: number;
  fatGrams?: number;
  carbohydrateGrams?: number;
  simplified?: {
    proteinCompletion: "none" | "partial" | "met";
    hunger: "low" | "moderate" | "high";
    deviation: "none" | "small" | "large";
  };
  /**
   * Kept only for an explicitly confirmed estimate. The ranges remain ranges:
   * they are not coerced into a fictitious measured calorie/macro value.
   */
  estimate?: {
    sourceDraftId?: string;
    estimates: readonly NutrientEstimate[];
    provider?: { id: string; modelVersion: string; processingScope: "text" | "photo" };
    userEdited?: boolean;
    /**
     * The immutable Draft remains in `estimates`; this is the explicit diff
     * accepted by the user. It must never be re-labelled as measured or label
     * data just because it contains a user correction.
     */
    userEdits?: NutritionObservationDraftEdits;
  };
  provenance: "manual" | "label" | "import" | "llm_estimate";
}

export interface NutrientEstimate {
  foodName: string;
  portionAssumption: string;
  energyRange?: { min: EnergyQuantity; max: EnergyQuantity };
  proteinGramsRange?: { min: number; max: number };
  fatGramsRange?: { min: number; max: number };
  carbohydrateGramsRange?: { min: number; max: number };
  assumptions: readonly string[];
  confidence: "low" | "medium" | "high";
}

/**
 * A user-visible adjustment to an immutable remote/local estimate. Candidate
 * entries retain their food, portion, unit-bound ranges and assumptions so a
 * confirmation is reviewable without treating it as a precise measurement.
 */
export interface NutritionObservationDraftEdits {
  description?: string;
  estimates?: readonly NutrientEstimate[];
}

export interface NutritionObservationDraft {
  id: string;
  schemaVersion: 1;
  observation: MealObservation;
  estimates: readonly NutrientEstimate[];
  provider?: { id: string; modelVersion: string; processingScope: "text" | "photo" };
  mediaConsent?: "not_requested" | "local_only" | "provider_authorized";
  redactionManifest?: readonly string[];
  inputMediaRefs?: readonly string[];
  generatedAt?: string;
  missing?: readonly string[];
  clarificationRequired?: boolean;
  status: "draft" | "confirmed" | "rejected";
}

export interface NutritionObservationRequest {
  text?: string;
  localMediaRefs?: readonly string[];
  /** The client preserves the origin of every input; a provider may not erase it. */
  inputProvenance?: readonly ("text" | "photo" | "nutrition_label" | "user_note")[];
  mediaConsent: "not_requested" | "local_only" | "provider_authorized";
  purpose: "meal_estimate";
  /** A visible user cancellation never becomes a background upload retry. */
  signal?: AbortSignal;
}

export interface NutritionObservationPort {
  /** Optional discovery surface; adapters must not expose provider SDK types. */
  capabilities?(): NutritionObservationCapabilities;
  estimate(input: NutritionObservationRequest): Promise<{
    candidates: readonly NutrientEstimate[];
    missing: readonly string[];
    provider: { id: string; modelVersion: string; processingScope: "text" | "photo" };
    /** Paths removed or transformed before an optional remote request. */
    redactionManifest?: readonly string[];
  }>;
}

/** Resolves a revocable user-scoped provider without leaking configuration into the domain. */
export interface NutritionObservationProviderResolver {
  resolve(input: {
    userId: string;
    request: NutritionObservationRequest;
  }): Promise<NutritionObservationPort | undefined>;
}

export interface NutritionObservationCapabilities {
  text: boolean;
  photo: boolean;
  nutritionLabel: boolean;
  cancellation: boolean;
  providerId?: string;
  modelVersion?: string;
}

export interface NutritionChangeProposal {
  kind: "nutrition_change_proposal";
  id: string;
  baseStrategyId: string;
  before: NutritionStrategyData;
  after: NutritionStrategyData;
  reasonCodes: readonly string[];
  evidenceWindow: { observedDays: number; comparableWeeks: number; adherence: "insufficient" | "qualitative" | "reliable" };
  expectedDirection: "increase" | "decrease" | "hold";
  /** A day-type alignment is high impact but never a hidden calorie change. */
  changeKind?: "energy_adjustment" | "day_type_coordination";
  requiresConfirmation: true;
  undo: "compensating_revision";
}

export interface NutritionPlanCoordination {
  dayTypes: NonNullable<NutritionStrategyData["dayTypes"]>;
  reasonCodes: readonly string[];
  missingness: readonly string[];
}

/**
 * Local evidence summary used to decide whether a nutrition RulePack may even
 * consider a bounded numeric change. It contains no TDEE claim and no intake
 * imputation: qualitative entries remain qualitative.
 */
export interface NutritionReviewEvidence {
  strategyId: string;
  observedDays: number;
  preciseDays: number;
  simplifiedDays: number;
  comparableWeeks: number;
  adherence: "insufficient" | "qualitative" | "reliable";
  trend: "too_low" | "too_high" | "on_target" | "unknown";
  weightObservations: number;
  missingness: readonly string[];
}

/**
 * Derives review inputs exclusively from confirmed Timeline facts and the
 * strategy's declared review window. It never turns missing days into zero
 * intake, a wearable calorie number into expenditure, or a single weigh-in
 * into a trend.
 */
export function deriveNutritionReviewEvidence(input: {
  strategy: NutritionStrategyData;
  timeline: readonly TimelineProjectionEvent[];
  now: string;
  rulePack?: NutritionStrategyRulePack;
}): NutritionReviewEvidence {
  const rules = input.rulePack ?? DEFAULT_NUTRITION_RULE_PACK;
  const window = input.strategy.reviewWindow;
  const startsAt = window?.startsAt;
  const effectiveEndsAt = window
    ? minInstant(window.endsAt, input.now)
    : input.now;
  const active = input.timeline
    .filter((event) => (event.lifecycle ?? "active") === "active")
    .filter((event) => !startsAt || event.occurredAt >= startsAt)
    .filter((event) => event.occurredAt <= effectiveEndsAt);
  const nutrition = active.filter((event) => event.fact.kind === "nutrition");
  const preciseDays = distinctLocalDays(
    nutrition.filter(
      (event) =>
        event.fact.kind === "nutrition" &&
        (event.fact.observationMode === "precise" || event.fact.observationMode === "user_confirmed_estimate"),
    ),
  );
  const simplifiedDays = distinctLocalDays(
    nutrition.filter((event) => event.fact.kind === "nutrition" && event.fact.observationMode === "simplified"),
  );
  const observedDays = distinctLocalDays(nutrition);
  const comparableWeeks = startsAt
    ? Math.max(0, Math.floor((Date.parse(effectiveEndsAt) - Date.parse(startsAt)) / (7 * 24 * 60 * 60_000)))
    : 0;
  const preciseCoverageRequired = rules.review.minimumPreciseDaysPerWeek * comparableWeeks;
  const adherence =
    comparableWeeks >= rules.review.minimumComparableWeeks && preciseDays >= preciseCoverageRequired
      ? "reliable"
      : observedDays > 0
        ? "qualitative"
        : "insufficient";
  const weights = comparableWeights(active, rules.review.minimumWeightObservations);
  const missingness = [
    ...(startsAt ? [] : ["nutrition_review_window_missing"]),
    ...(comparableWeeks < rules.review.minimumComparableWeeks ? ["nutrition_review_window_incomplete"] : []),
    ...(preciseDays < preciseCoverageRequired ? ["nutrition_precise_logging_coverage_insufficient"] : []),
    ...(weights.reason ? [weights.reason] : []),
  ];
  return {
    strategyId: input.strategy.id,
    observedDays,
    preciseDays,
    simplifiedDays,
    comparableWeeks,
    adherence,
    trend: adherence === "reliable" ? nutritionTrendFromWeights(input.strategy, weights) : "unknown",
    weightObservations: weights.points.length,
    missingness,
  };
}

export interface NutritionSafetyScreen {
  adultConfirmed: boolean;
  pregnancyOrLactation?: boolean;
  eatingDisorderOrExtremeRestriction?: boolean;
  diseaseSpecificDiet?: boolean;
  medicationOrSurgery?: boolean;
  professionalConflict?: boolean;
  rapidDehydrationOrWeightCut?: boolean;
  acuteSignal?: "chest_discomfort" | "fainting" | "severe_dizziness" | "rapid_unexplained_weight_change";
}

export interface MaintenanceEnergyEstimate {
  estimatedMaintenanceKcal: number;
  restingEnergyKcal: number;
  activityFactor: number;
  method: "mifflin_st_jeor_with_planned_training_factor";
  confidence: "provisional";
  assumptions: readonly string[];
}

/**
 * Produces an explicitly provisional starting point when the person supplied
 * all equation inputs but does not know a stable maintenance intake. Planned
 * training contributes only a bounded factor; ordinary daily movement remains
 * unknown and the result must be recalibrated from intake + weight trend.
 */
export function estimateMaintenanceEnergy(input: {
  ageYears?: number;
  sex?: "female" | "male" | "prefer_not_to_say" | "unknown";
  heightCm?: number;
  bodyMassKg?: number;
  weeklyTrainingFrequency?: number;
  sessionDurationMinutes?: number;
}): MaintenanceEnergyEstimate | undefined {
  const { ageYears, heightCm, bodyMassKg } = input;
  if (
    ageYears === undefined || ageYears < 18 || ageYears > 100 ||
    heightCm === undefined || heightCm < 120 || heightCm > 230 ||
    bodyMassKg === undefined || bodyMassKg < 35 || bodyMassKg > 300 ||
    (input.sex !== "female" && input.sex !== "male")
  ) return undefined;

  const frequency = clampEstimate(input.weeklyTrainingFrequency ?? 0, 0, 7);
  const sessionMinutes = clampEstimate(input.sessionDurationMinutes ?? 0, 0, 180);
  const weeklyTrainingMinutes = frequency * sessionMinutes;
  const activityFactor = Math.round((1.2 + Math.min(0.3, weeklyTrainingMinutes / 1_200)) * 100) / 100;
  const sexConstant = input.sex === "male" ? 5 : -161;
  const restingEnergyKcal = Math.round(10 * bodyMassKg + 6.25 * heightCm - 5 * ageYears + sexConstant);
  const estimatedMaintenanceKcal = Math.round((restingEnergyKcal * activityFactor) / 10) * 10;
  return {
    estimatedMaintenanceKcal,
    restingEnergyKcal,
    activityFactor,
    method: "mifflin_st_jeor_with_planned_training_factor",
    confidence: "provisional",
    assumptions: [
      "demographics_are_user_reported",
      "planned_training_factor_is_bounded",
      "non_training_daily_activity_is_unknown",
      "recalibrate_from_14_day_intake_and_weight_trend",
    ],
  };
}

export function createNutritionStrategy(input: {
  id: string;
  goalContractRef: NutritionStrategyData["goalContractRef"];
  phase: NonNullable<NutritionStrategyData["phase"]>;
  bodyMassKg?: number;
  estimatedMaintenanceKcal?: number;
  reviewWindow: NutritionStrategyData["reviewWindow"];
  safety: NutritionSafetyScreen;
  rulePack?: NutritionStrategyRulePack;
}): NutritionStrategyData {
  const safetyReason = nutritionSafetyBlockReason(input.safety);
  const rules = input.rulePack ?? DEFAULT_NUTRITION_RULE_PACK;
  const maintenance = input.estimatedMaintenanceKcal;
  const multiplier = input.phase === "hypertrophy" ? 1.05 : input.phase === "fat_loss_preserve_lean_mass" ? 0.85 : 1;
  const proteinRange = input.bodyMassKg
    ? {
        min: round(input.bodyMassKg * rules.proteinGramsPerKg[input.phase].min),
        max: round(input.bodyMassKg * rules.proteinGramsPerKg[input.phase].max),
      }
    : undefined;
  return {
    id: input.id,
    goalContractRef: input.goalContractRef,
    status: safetyReason ? "paused" : "active",
    phase: input.phase,
    ...(maintenance ? {
      calorieRange: {
        // A daily calorie target does not gain useful accuracy from decimal
        // kcal. Whole numbers make the provisional range easier to read while
        // preserving the exact same bounded rule.
        min: { value: Math.round(maintenance * multiplier * 0.95), unit: "kcal" },
        max: { value: Math.round(maintenance * multiplier * 1.05), unit: "kcal" },
      },
    } : {}),
    ...(proteinRange ? {
      macronutrientTargets: {
        proteinGrams: proteinRange,
        fatEnergyFloorPercent: rules.fatFloorPercent,
      },
    } : {}),
    reviewWindow: input.reviewWindow,
    ruleVersion: `${rules.id}@${rules.version}`,
    confidence: maintenance && input.bodyMassKg ? "provisional" : "low",
    evidenceRefs: safetyReason ? [safetyReason] : [],
  };
}

export function proposeNutritionChange(input: {
  id: string;
  strategy: NutritionStrategyData;
  observedDays: number;
  comparableWeeks: number;
  adherence: "insufficient" | "qualitative" | "reliable";
  trend: "too_low" | "too_high" | "on_target" | "unknown";
  safety: NutritionSafetyScreen;
  rulePack?: NutritionStrategyRulePack;
}): NutritionChangeProposal | { kind: "no_change"; reasonCodes: readonly string[] } {
  const safetyReason = nutritionSafetyBlockReason(input.safety);
  if (safetyReason) return { kind: "no_change", reasonCodes: [safetyReason] };
  const rules = input.rulePack ?? DEFAULT_NUTRITION_RULE_PACK;
  if (input.adherence !== "reliable" || input.comparableWeeks < rules.review.minimumComparableWeeks || input.trend === "unknown" || input.trend === "on_target" || !input.strategy.calorieRange) {
    return { kind: "no_change", reasonCodes: ["insufficient_or_on_target_evidence"] };
  }
  const direction = input.trend === "too_low" ? "increase" : "decrease";
  const delta = Math.min(rules.review.maximumDailyAdjustmentKcal, Math.round(input.strategy.calorieRange.max.value * 0.05));
  const after: NutritionStrategyData = {
    ...input.strategy,
    calorieRange: {
      min: { ...input.strategy.calorieRange.min, value: Math.max(0, input.strategy.calorieRange.min.value + (direction === "increase" ? delta : -delta)) },
      max: { ...input.strategy.calorieRange.max, value: Math.max(0, input.strategy.calorieRange.max.value + (direction === "increase" ? delta : -delta)) },
    },
    // The proposal itself carries the pending-review state. Once a person
    // confirms it, the revision remains an active strategy rather than
    // leaving an already-applied target permanently marked as pending.
    status: "active",
  };
  return {
    kind: "nutrition_change_proposal",
    id: input.id,
    baseStrategyId: input.strategy.id,
    before: input.strategy,
    after,
    reasonCodes: [`trend_${input.trend}`, "bounded_single_energy_variable_change"],
    evidenceWindow: { observedDays: input.observedDays, comparableWeeks: input.comparableWeeks, adherence: input.adherence },
    expectedDirection: direction,
    changeKind: "energy_adjustment",
    requiresConfirmation: true,
    undo: "compensating_revision",
  };
}

/**
 * Resolves the plan's already-materialized days into nutrition day types. It
 * deliberately leaves all energy and macro targets untouched: a training
 * cancellation, Deload or recovery-priority day cannot silently create a
 * deficit, crash diet or extra intake target.  A caller must still present a
 * confirmation-gated proposal before replacing a stored strategy.
 */
export function deriveNutritionPlanCoordination(input: {
  strategy: NutritionStrategyData;
  plan?: PlanRevisionData;
  currentDate: string;
  recoveryConstraints?: readonly Pick<RecoveryConstraintData, "level" | "validUntil">[];
  deloadWindow?: { startDate: string; endDate: string };
  missedSessionDates?: readonly string[];
}): NutritionPlanCoordination {
  if (!input.plan) {
    return { dayTypes: input.strategy.dayTypes ?? [], reasonCodes: ["nutrition_plan_unavailable"], missingness: ["current_plan"] };
  }
  if (input.missedSessionDates?.length) {
    return {
      dayTypes: input.strategy.dayTypes ?? [],
      reasonCodes: ["single_missed_session_keeps_nutrition_targets"],
      missingness: [],
    };
  }
  const activeRecovery = (input.recoveryConstraints ?? []).some((constraint) =>
    (constraint.level === "recovery_priority" || constraint.level === "pause_and_confirm") &&
    Date.parse(constraint.validUntil) >= Date.parse(`${input.currentDate}T00:00:00.000Z`),
  );
  const prior = new Map((input.strategy.dayTypes ?? []).map((day) => [day.date, day]));
  const sessions = [...input.plan.sessions]
    .filter((session) => session.scheduledFor >= input.currentDate)
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor) || left.id.localeCompare(right.id));
  const dayTypes = sessions.map((session) => {
    const current = prior.get(session.scheduledFor);
    const kind = session.kind === "rest"
      ? "rest" as const
      : inWindow(session.scheduledFor, input.deloadWindow)
        ? "deload" as const
        : session.kind === "recovery" || activeRecovery
          ? "recovery" as const
          : "training" as const;
    return {
      ...(current ?? {}),
      date: session.scheduledFor,
      kind,
      ...(kind === "training" || kind === "deload" ? { namedSessionId: session.id } : {}),
    };
  });
  const reasonCodes = [
    "nutrition_day_types_follow_materialized_plan",
    "protein_and_fat_floor_preserved",
    "weekly_energy_targets_unchanged",
    ...(input.deloadWindow ? ["deload_changes_distribution_not_weekly_energy"] : []),
    ...(activeRecovery ? ["recovery_priority_marks_future_days_without_numeric_energy_change"] : []),
  ];
  return { dayTypes, reasonCodes, missingness: [] };
}

/** Creates a confirmation-gated, non-numeric nutrition proposal from real plan state. */
export function proposeNutritionPlanCoordination(input: {
  id: string;
  strategy: NutritionStrategyData;
  plan?: PlanRevisionData;
  currentDate: string;
  recoveryConstraints?: readonly Pick<RecoveryConstraintData, "level" | "validUntil">[];
  deloadWindow?: { startDate: string; endDate: string };
  missedSessionDates?: readonly string[];
  safety: NutritionSafetyScreen;
}): NutritionChangeProposal | { kind: "no_change"; reasonCodes: readonly string[] } {
  const safetyReason = nutritionSafetyBlockReason(input.safety);
  if (safetyReason) return { kind: "no_change", reasonCodes: [safetyReason] };
  const coordination = deriveNutritionPlanCoordination(input);
  if (!input.plan || input.missedSessionDates?.length) {
    return { kind: "no_change", reasonCodes: coordination.reasonCodes };
  }
  const before = input.strategy.dayTypes ?? [];
  if (JSON.stringify(before) === JSON.stringify(coordination.dayTypes)) {
    return { kind: "no_change", reasonCodes: ["nutrition_day_types_already_aligned"] };
  }
  const after: NutritionStrategyData = { ...input.strategy, dayTypes: coordination.dayTypes, status: "active" };
  return {
    kind: "nutrition_change_proposal",
    id: input.id,
    baseStrategyId: input.strategy.id,
    before: input.strategy,
    after,
    reasonCodes: coordination.reasonCodes,
    evidenceWindow: { observedDays: 0, comparableWeeks: 0, adherence: "insufficient" },
    expectedDirection: "hold",
    changeKind: "day_type_coordination",
    requiresConfirmation: true,
    undo: "compensating_revision",
  };
}

export function assertCarbDistributionInvariant(input: {
  strategy: NutritionStrategyData;
  weeklyBaselineEnergyKcal: number;
}): void {
  const days = input.strategy.dayTypes ?? [];
  if (!days.length) return;
  const weekly = days.reduce((sum, day) => sum + (day.energy?.value ?? 0), 0);
  if (Math.round(weekly) !== Math.round(input.weeklyBaselineEnergyKcal)) {
    throw new Error("carb_distribution_cannot_change_weekly_energy");
  }
  if (input.strategy.macronutrientTargets?.fatEnergyFloorPercent !== undefined && input.strategy.macronutrientTargets.fatEnergyFloorPercent < 20) {
    throw new Error("automatic_fat_floor_violation");
  }
}

export function confirmNutritionDraft(input: {
  draft: NutritionObservationDraft;
  observation: MealObservation;
}): MealObservation {
  if (input.draft.status !== "draft") throw new Error("nutrition_draft_not_confirmable");
  return { ...input.observation, provenance: input.draft.observation.provenance === "llm_estimate" ? "llm_estimate" : input.observation.provenance };
}

function distinctLocalDays(events: readonly TimelineProjectionEvent[]): number {
  return new Set(events.map((event) => event.occurredAt.slice(0, 10))).size;
}

function minInstant(left: string, right: string): string {
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function comparableWeights(events: readonly TimelineProjectionEvent[], minimumObservations: number): {
  points: readonly { occurredAt: string; value: number }[];
  reason?: string;
} {
  const weights = events
    .filter(
      (event) =>
        event.fact.kind === "body" &&
        event.fact.measurement.metric === "body_weight" &&
        event.fact.confidence === "confirmed",
    )
    .map((event) => {
      if (event.fact.kind !== "body" || event.fact.measurement.metric !== "body_weight") {
        throw new Error("body_weight_filter_invariant");
      }
      return {
        occurredAt: event.occurredAt,
        value: event.fact.measurement.quantity.value,
        unit: event.fact.measurement.quantity.unit,
        condition: event.fact.measurement.condition ?? "",
      };
    })
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  if (weights.length < minimumObservations) return { points: weights, reason: "nutrition_weight_trend_insufficient" };
  const identity = new Set(weights.map((item) => `${item.unit}|${item.condition}`));
  if (identity.size !== 1) return { points: weights, reason: "nutrition_weight_measurement_not_comparable" };
  return { points: weights };
}

function nutritionTrendFromWeights(
  strategy: NutritionStrategyData,
  weights: ReturnType<typeof comparableWeights>,
): NutritionReviewEvidence["trend"] {
  if (weights.reason || weights.points.length < 2) return "unknown";
  const first = weights.points[0]!;
  const last = weights.points.at(-1)!;
  // The deadband avoids treating ordinary scale noise as a dietary failure.
  // It is a conservative product rule, not a claim that 0.25 kg is a
  // universal meaningful physiological threshold.
  const delta = last.value - first.value;
  const deadband = 0.25;
  if (strategy.phase === "fat_loss_preserve_lean_mass") {
    return delta > deadband ? "too_high" : delta < -deadband ? "on_target" : "unknown";
  }
  if (strategy.phase === "hypertrophy") {
    return delta < -deadband ? "too_low" : delta > deadband ? "on_target" : "unknown";
  }
  if (strategy.phase === "strength_stable") {
    return Math.abs(delta) <= deadband ? "on_target" : "unknown";
  }
  return "unknown";
}

/** Shared deterministic safety gate for creating and applying a strategy change. */
export function nutritionSafetyBlockReason(safety: NutritionSafetyScreen): string | undefined {
  if (!safety.adultConfirmed) return "nutrition_adult_confirmation_required";
  if (safety.pregnancyOrLactation) return "nutrition_pregnancy_or_lactation";
  if (safety.eatingDisorderOrExtremeRestriction) return "nutrition_disordered_eating_or_extreme_restriction";
  if (safety.diseaseSpecificDiet || safety.medicationOrSurgery) return "nutrition_medical_context";
  if (safety.professionalConflict) return "nutrition_professional_constraint";
  if (safety.rapidDehydrationOrWeightCut) return "nutrition_rapid_weight_cut";
  if (safety.acuteSignal) return `nutrition_${safety.acuteSignal}`;
  return undefined;
}

function round(value: number): number { return Math.round(value * 10) / 10; }

function clampEstimate(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inWindow(date: string, window: { startDate: string; endDate: string } | undefined): boolean {
  return Boolean(window && date >= window.startDate && date <= window.endDate);
}
