import { getT, PLAN_REPORT_COPY } from "../../i18n";

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
  single_day_change_cannot_replace_goal_contract: "guard.singleDayCannotReplaceGoalContract",
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
