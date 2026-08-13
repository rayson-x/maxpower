import { getT, PLAN_REPORT_COPY } from "../../i18n";
import type { PlannedSessionData } from "../../coach/domain";
import type { PlanProposal } from "../../planning";

/** planner token → i18n 键名。planner 只出 token，文案住在 PLAN_REPORT_COPY。 */
const PHRASE_KEYS: Record<string, string> = {
  "build lean mass with a small, observable surplus": "objective.leanMassSmallSurplus",
  "prioritize lean-mass retention during a bounded cut": "objective.retainLeanMassInCut",
  "reduce body fat while retaining training exposure": "objective.reduceFatKeepExposure",
  "hold a stable energy floor while improving composition and performance": "objective.stableEnergyFloor",
  "restore recovery and maintain essential exposure": "objective.restoreRecovery",
  progress_with_recovery_budget: "objective.progressWithRecoveryBudget",
  retain_primary_strength_and_effective_stimulus: "objective.retainPrimaryStrength",
  support_small_surplus_without_forcing_unknown_maintenance: "objective.supportSmallSurplusNoGuessing",
  support_goal_while_observing_real_intake: "objective.observeRealIntakeFirst",
  "keep_daily_variation inside a safe next-session boundary": "objective.dailyVariationBoundary",
  compare_exact_variant_history_when_available: "progression.compareVariantHistory",
  increase_one_decision_family_at_a_time: "progression.oneVariableAtATime",
  recovery_decline_reduces_optional_volume_before_primary_stimulus: "recovery.cutOptionalVolumeFirst",
  confirmed_goal_contract: "evidence.goalConfirmed",
  schedule_and_safety_reviewed: "evidence.scheduleAndSafetyConfirmed",
  weekly_review_window_complete: "evidence.weeklyReviewWindow",
  outcome_and_recovery_reviewed: "evidence.outcomeAndRecoveryReviewed",
  timeline_history: "evidence.timelineHistory",
  exact_variant_load_history: "evidence.variantLoadHistory",
  strength_baseline_missing_reps_rir: "missing.strengthBaselineRepsRir",
  current_recovery_constraint: "evidence.recentRecoveryTrend",
  nutrition_strategy: "evidence.nutritionBaseline",
  maintenance_energy: "evidence.maintenanceEnergy",
  unlogged_intake_is_not_zero: "guard.unloggedIntakeNotZero",
  actual_load_rir_and_maintenance_energy_are_unknown_without_user_facts: "uncertainty.loadRirMaintenanceUnknown",
  missing_measurements_remain_unknown: "uncertainty.missingStaysUnknown",
  single_day_change_cannot_switch_goal_cycle: "guard.singleDayCannotSwitchCycle",
  pain_or_red_flag_pauses_planning: "guard.painPausesPlanning",
  professional_clearance_required: "guard.professionalClearance",
  high_adherence: "requirement.highAdherence",
  weekly_recovery_review: "requirement.weeklyRecoveryReview",
  no_new_safety_signal: "requirement.noNewSafetySignal",
  record_comparable_trends: "requirement.recordComparableTrends",
  complete_weekly_review: "requirement.completeWeeklyReview",
  less_margin_for_missed_sessions: "tradeoff.lessMarginForMissedSessions",
  higher_recovery_demand: "tradeoff.higherRecoveryDemand",
  moderate_pace: "tradeoff.moderatePace",
  requires_consistent_logging: "tradeoff.requiresConsistentLogging",
  slower_target_progress: "tradeoff.slowerProgress",
  more_schedule_flexibility: "tradeoff.moreScheduleFlexibility",
  no_professional_history_provided: "uncertainty.noProfessionalHistory",
  phase_switch_requires_review_window_and_comparable_evidence: "guard.phaseSwitchNeedsEvidence",
  small_surplus: "energy.smallSurplus",
  small_deficit: "energy.smallDeficit",
  maintenance: "energy.maintenance",
  observe_then_adjust: "energy.observeThenAdjust",
  sleep: "signal.sleep",
  fatigue: "signal.fatigue",
  soreness: "signal.soreness",
  perceived_recovery: "signal.perceivedRecovery",
  available_time: "signal.availableTime",
  "general fitness planning": "population.generalFitness",
};

const STRATEGY_KEYS: Record<string, string> = {
  fat_loss_recomposition: "strategy.fatLossRecomposition",
  preserve_lean_mass_cut: "strategy.preserveLeanMassCut",
  final_cut: "strategy.finalCut",
  maintenance_recomposition: "strategy.maintenanceRecomposition",
  recovery_maintenance: "strategy.recoveryMaintenance",
  conservative_gain: "strategy.conservativeGain",
  stable_strength_gain: "strategy.stableStrengthGain",
  return_to_training: "strategy.returnToTraining",
  advanced_specialization_maintenance: "strategy.advancedSpecializationMaintenance",
  post_loss_consolidation_gain: "strategy.postLossConsolidationGain",
  diet_break: "strategy.dietBreak",
  deload_overlay: "strategy.deloadOverlay",
};

const GOAL_TYPE_KEYS: Record<string, string> = {
  hypertrophy: "goalType.hypertrophy",
  fat_loss: "goalType.fatLoss",
  strength: "goalType.strength",
  maintain: "goalType.maintain",
  return_to_training: "goalType.returnToTraining",
};

export interface PlanningReportSession {
  id: string;
  date: string;
  dayLabel: string;
  title: string;
  kind: "training" | "rest";
  detail: string;
  estimatedMinutes?: number;
}

export interface PlanningReportSummary {
  trainingDays: number;
  sessionDurationMinutes?: number;
  totalWorkSets: number;
  reviewAt: string;
  phaseDuration: string;
  confidencePercent: number;
  weekRange?: string;
  sessions: readonly PlanningReportSession[];
  missingFacts: readonly string[];
}

/**
 * Builds the small, user-facing facts used by the plan report. Keeping this
 * projection outside React prevents presentation copy from leaking planner
 * tokens or recomputing domain facts differently on each screen.
 */
export function buildPlanningReportSummary(proposal: PlanProposal, locale?: string): PlanningReportSummary {
  const t = getT(PLAN_REPORT_COPY, locale);
  const week = proposal.planRevision.materializedWeeks?.[0];
  const sessions = (week?.sessions ?? proposal.planRevision.sessions.slice(0, 7)).map((session) => toReportSession(session, locale));
  const training = sessions.filter((session) => session.kind === "training");
  const sourceSessions = week?.sessions ?? proposal.planRevision.sessions.slice(0, 7);
  const sessionDurationMinutes = sourceSessions.find((session) => isTrainingSession(session))?.durationBudget?.unit === "minutes"
    ? sourceSessions.find((session) => isTrainingSession(session))?.durationBudget?.value
    : undefined;
  const totalWorkSets = sourceSessions
    .filter(isResistanceSession)
    .reduce((sum, session) => sum + session.tasks.reduce((taskSum, task) => taskSum + task.sets.length, 0), 0);
  const phase = proposal.appliedPhaseStrategy;
  return {
    trainingDays: training.length,
    ...(sessionDurationMinutes !== undefined ? { sessionDurationMinutes } : {}),
    totalWorkSets,
    reviewAt: phase?.reviewAt ?? proposal.expectedReviewAt,
    phaseDuration: phase
      ? t("summary.phaseDuration.weeks", {
          min: phase.expectedDurationWeeks.min,
          max: phase.expectedDurationWeeks.max,
        })
      : t("summary.phaseDuration.weekly"),
    confidencePercent: Math.round(proposal.confidence * 100),
    ...(week ? { weekRange: `${shortDate(week.startDate, locale)}—${shortDate(week.endDate, locale)}` } : {}),
    sessions,
    missingFacts: unique(proposal.missing.map((value) => planningPhrase(value, locale))),
  };
}

export function planningPhrase(value: string, locale?: string): string {
  const t = getT(PLAN_REPORT_COPY, locale);
  const key = PHRASE_KEYS[value];
  if (key) return t(key);
  if (value.startsWith("goal_type:")) {
    return t("phrase.goalIs", { goal: goalTypeLabel(value.slice("goal_type:".length), locale) });
  }
  if (value.startsWith("strategy_catalog:")) {
    return t("phrase.strategyMatched", { strategy: strategyName(value.slice("strategy_catalog:".length), locale) });
  }
  if (value.startsWith("trigger:")) {
    return t(value === "trigger:initial_plan" ? "phrase.triggerInitialPlan" : "phrase.triggerFactChange");
  }
  if (value.startsWith("constraint_priority:")) return t("phrase.constraintPriority");
  if (value === "near_term_materialization:current_plus_next_week") return t("phrase.nearTermMaterialization");
  if (isKnownStrategy(value)) return strategyName(value, locale);
  return t("phrase.fallback");
}

export function strategyName(value: string, locale?: string): string {
  const key = STRATEGY_KEYS[value];
  return getT(PLAN_REPORT_COPY, locale)(key ?? "strategy.personalized");
}

export function goalTypeLabel(value: string, locale?: string): string {
  const key = GOAL_TYPE_KEYS[value];
  return getT(PLAN_REPORT_COPY, locale)(key ?? "goalType.improvePerformance");
}

export function forecastName(value: string, locale?: string): string {
  return getT(PLAN_REPORT_COPY, locale)(
    value === "strict_aggressive"
      ? "forecast.name.faster"
      : value === "balanced"
        ? "forecast.name.balanced"
        : "forecast.name.flexible",
  );
}

export function forecastEligibility(value: string, locale?: string): string {
  return getT(PLAN_REPORT_COPY, locale)(
    value === "eligible"
      ? "forecast.eligibility.available"
      : value === "degraded"
        ? "forecast.eligibility.degraded"
        : "forecast.eligibility.notRecommended",
  );
}

function toReportSession(session: PlannedSessionData, locale?: string): PlanningReportSession {
  const t = getT(PLAN_REPORT_COPY, locale);
  const training = isTrainingSession(session);
  const setCount = session.tasks.reduce((sum, task) => sum + task.sets.length, 0);
  const duration = session.durationBudget?.unit === "minutes" ? session.durationBudget.value : undefined;
  const estimatedMinutes = session.estimatedDuration?.unit === "minutes"
    ? session.estimatedDuration.value
    : undefined;
  return {
    id: session.id,
    date: session.scheduledFor,
    dayLabel: weekdayLabel(session.scheduledFor, locale),
    title: readableSessionTitle(session.title, locale),
    kind: training ? "training" : "rest",
    ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
    detail: training
      ? t("session.detail.training", {
          exercises: session.tasks.length,
          sets: setCount,
          duration: estimatedMinutes
            ? t("session.detail.estimatedMinutes", { minutes: estimatedMinutes })
            : duration
              ? t("session.detail.maxMinutes", { minutes: duration })
              : "",
        })
      : t("session.detail.rest"),
  };
}

function isTrainingSession(session: PlannedSessionData): boolean {
  return session.kind !== "rest" && session.tasks.length > 0;
}

function isResistanceSession(session: PlannedSessionData): boolean {
  return (session.kind === "weighted_reps" || session.kind === "bodyweight_reps") && session.tasks.length > 0;
}

function readableSessionTitle(title: string, locale?: string): string {
  const t = getT(PLAN_REPORT_COPY, locale);
  return title
    .replace("hypertrophy", t("sessionTitle.hypertrophy"))
    .replace("strength", t("sessionTitle.strength"))
    .replace("fat_loss_preserve_lean_mass", t("sessionTitle.fatLossPreserveLeanMass"));
}

function weekdayLabel(date: string, locale?: string): string {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  const t = getT(PLAN_REPORT_COPY, locale);
  return day >= 0 && day <= 6 ? t(`weekday.${day}`) : t("weekday.fallback");
}

function shortDate(value: string, locale?: string): string {
  return getT(PLAN_REPORT_COPY, locale)("date.short", {
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  });
}

function isKnownStrategy(value: string): boolean {
  return [
    "fat_loss_recomposition",
    "preserve_lean_mass_cut",
    "final_cut",
    "maintenance_recomposition",
    "recovery_maintenance",
    "conservative_gain",
    "stable_strength_gain",
    "return_to_training",
    "advanced_specialization_maintenance",
    "post_loss_consolidation_gain",
    "diet_break",
    "deload_overlay",
  ].includes(value);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
