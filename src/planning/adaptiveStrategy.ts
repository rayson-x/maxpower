import type { GoalContractData, SafetyConstraintData, UserProfileData } from "../coach/domain";
import type { KnowledgeVersionPins } from "../knowledge/model";
import { PlanningCitationRegistry } from "../knowledge/planningEvidence";
import type { PlannerFacts } from "./model";

export const STRATEGY_CATALOG = [
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
] as const;

export type StrategyId = (typeof STRATEGY_CATALOG)[number];

export interface StrategySelection {
  catalogVersion: string;
  primary: StrategyId;
  overlays: readonly Extract<StrategyId, "diet_break" | "deload_overlay">[];
  historyModifiers: readonly string[];
  currentStateModifiers: readonly string[];
  riskGuardrails: readonly string[];
  tactic?: "balanced_carbohydrate_support" | "lower_carbohydrate_preference" | "higher_carbohydrate_training" | "refeed_as_adherence_tool";
}

export interface AppliedPhaseStrategy {
  id: string;
  phase: StrategyId;
  objective: string;
  expectedDurationWeeks: { min: number; max: number };
  entryCriteria: readonly string[];
  exitCriteria: readonly string[];
  reviewAt: string;
}

export interface TrainingStrategy {
  id: string;
  objective: string;
  progression: readonly string[];
  recoveryRules: readonly string[];
}

export interface PlanningNutritionStrategy {
  id: string;
  objective: string;
  energyApproach: "observe_then_adjust" | "small_deficit" | "small_surplus" | "maintenance";
  tactic?: StrategySelection["tactic"];
  unknowns: readonly string[];
}

export interface RecoveryStrategy {
  id: string;
  objective: string;
  dailyCheckIns: readonly string[];
  constraints: readonly string[];
}

export interface RecommendationExplanation {
  userEvidence: readonly string[];
  ruleReason: readonly string[];
  researchEvidence: readonly {
    citationId: string;
    claim: string;
    population: string;
    limitation: string;
  }[];
  uncertainty: readonly string[];
  alternative: readonly string[];
}

export interface AdaptiveForecastScenario {
  scenario: "strict_aggressive" | "balanced" | "flexible";
  eligibility: "eligible" | "degraded" | "ineligible";
  earliest: string;
  latest: string;
  phaseRoute: readonly string[];
  executionRequirements: readonly string[];
  tradeoffs: readonly string[];
  guardrails: readonly string[];
  confidence: { min: number; max: number };
  recalibrateAt: string;
}

export interface AdaptiveStrategyPlan {
  selection: StrategySelection;
  phase: AppliedPhaseStrategy;
  training: TrainingStrategy;
  nutrition: PlanningNutritionStrategy;
  recovery: RecoveryStrategy;
  explanation: RecommendationExplanation;
  forecasts: readonly AdaptiveForecastScenario[];
}

export function selectAdaptiveStrategy(input: {
  profile: UserProfileData;
  goal: GoalContractData;
  safety: readonly SafetyConstraintData[];
  currentDate: string;
  knowledgePins: KnowledgeVersionPins;
}): AdaptiveStrategyPlan {
  const goalType = goalTypeForPrimaryGoal(input.goal.primaryGoal);
  const history = input.profile.historyModifiers;
  const priorStrategies = history?.priorStrategies ?? history?.plateau?.priorStrategies;
  const historyModifiers = [
    ...(priorStrategies?.length ? ["prior_strategies"] : []),
    ...(history?.plateau ? ["plateau_history"] : []),
    ...(history?.plateau?.executionAdherence ? [`plateau_execution_${history.plateau.executionAdherence}`] : []),
    ...(history?.plateau?.suspectedReasons?.length ? ["plateau_reason_reported"] : []),
    ...(history?.majorWeightLossHistory ? ["major_weight_loss_history"] : []),
    ...(input.profile.returningStatus === "returning" ? ["returning_status"] : []),
  ];
  const currentStateModifiers = [
    ...(input.safety.some((item) => item.disposition !== "clear") ? ["active_safety_constraint"] : []),
    ...(history?.plateau?.recoveryChange === "worse" ? ["recovery_decline"] : []),
  ];
  const riskGuardrails = [
    "missing_measurements_remain_unknown",
    "single_day_change_cannot_replace_goal_contract",
    "pain_or_red_flag_pauses_planning",
  ];
  const primary = choosePrimaryStrategy(input.profile, goalType, history);
  const overlays: StrategySelection["overlays"] = [
    ...(history?.plateau?.recoveryChange === "worse" ? ["deload_overlay" as const] : []),
  ];
  const tactic = input.profile.nutritionPreferences?.find((item) =>
    item === "lower_carbohydrate_preference" || item === "higher_carbohydrate_training" || item === "refeed_as_adherence_tool",
  ) as StrategySelection["tactic"] | undefined;
  const selection: StrategySelection = {
    catalogVersion: input.knowledgePins.knowledgePack.semanticVersion,
    primary,
    overlays,
    historyModifiers,
    currentStateModifiers,
    riskGuardrails,
    ...(tactic ? { tactic } : {}),
  };
  const phase: AppliedPhaseStrategy = {
    id: `phase:${primary}`,
    phase: primary,
    objective: phaseObjective(primary),
    expectedDurationWeeks: primary === "final_cut" ? { min: 4, max: 8 } : { min: 6, max: 12 },
    entryCriteria: ["confirmed_goal_contract", "schedule_and_safety_reviewed"],
    exitCriteria: ["weekly_review_window_complete", "outcome_and_recovery_reviewed"],
    reviewAt: addDays(input.currentDate, 42),
  };
  const training: TrainingStrategy = {
    id: `training:${primary}`,
    objective: primary === "preserve_lean_mass_cut" || primary === "fat_loss_recomposition" ? "retain_primary_strength_and_effective_stimulus" : "progress_with_recovery_budget",
    progression: ["compare_exact_variant_history_when_available", "increase_one_decision_family_at_a_time"],
    recoveryRules: ["recovery_decline_reduces_optional_volume_before_primary_stimulus"],
  };
  const nutrition: PlanningNutritionStrategy = {
    id: `nutrition:${primary}`,
    objective: primary === "conservative_gain" || primary === "post_loss_consolidation_gain" ? "support_small_surplus_without_forcing_unknown_maintenance" : "support_goal_while_observing_real_intake",
    energyApproach: primary === "conservative_gain" || primary === "post_loss_consolidation_gain" ? "small_surplus" : primary === "maintenance_recomposition" || primary === "recovery_maintenance" ? "maintenance" : primary === "preserve_lean_mass_cut" || primary === "final_cut" || primary === "fat_loss_recomposition" ? "small_deficit" : "observe_then_adjust",
    ...(tactic ? { tactic } : {}),
    unknowns: ["maintenance_energy", "unlogged_intake_is_not_zero"],
  };
  const recovery: RecoveryStrategy = {
    id: `recovery:${primary}`,
    objective: "keep_daily_variation inside a safe next-session boundary",
    dailyCheckIns: ["sleep", "fatigue", "soreness", "perceived_recovery", "available_time"],
    constraints: riskGuardrails,
  };
  const explanation: RecommendationExplanation = {
    userEvidence: [
      `goal_type:${goalType}`,
      ...(historyModifiers.length ? historyModifiers : ["no_professional_history_provided"]),
    ],
    ruleReason: [
      `strategy_catalog:${primary}`,
      "phase_switch_requires_review_window_and_comparable_evidence",
    ],
    researchEvidence: [(() => {
      const citation = new PlanningCitationRegistry(input.knowledgePins).resolve("maxpower.exercise-wiki.v1");
      return { citationId: citation.id, claim: citation.claim, population: citation.population, limitation: citation.limitation };
    })()],
    uncertainty: ["actual_load_rir_and_maintenance_energy_are_unknown_without_user_facts"],
    alternative: ["maintenance_recomposition", "recovery_maintenance"].filter((item) => item !== primary),
  };
  const forecasts = buildForecasts({ selection, phase, safety: input.safety, currentDate: input.currentDate, hasHistory: historyModifiers.length > 0 });
  return { selection, phase, training, nutrition, recovery, explanation, forecasts };
}

function choosePrimaryStrategy(
  profile: UserProfileData,
  goalType: ReturnType<typeof goalTypeForPrimaryGoal>,
  history: UserProfileData["historyModifiers"],
): StrategyId {
  if (profile.returningStatus === "returning" || goalType === "return_to_training") return "return_to_training";
  if (history?.majorWeightLossHistory?.maintenanceExperience === "established") return "post_loss_consolidation_gain";
  if (history?.plateau) return history.plateau.recoveryChange === "worse" ? "recovery_maintenance" : "maintenance_recomposition";
  if (goalType === "fat_loss") return profile.bodyDirection === "decrease_body_fat" ? "preserve_lean_mass_cut" : "fat_loss_recomposition";
  if (goalType === "strength") return "stable_strength_gain";
  if (goalType === "maintain") return "maintenance_recomposition";
  return "conservative_gain";
}

function buildForecasts(input: {
  selection: StrategySelection;
  phase: AppliedPhaseStrategy;
  safety: readonly SafetyConstraintData[];
  currentDate: string;
  hasHistory: boolean;
}): AdaptiveForecastScenario[] {
  const blocked = input.safety.some((item) => item.disposition === "stop_and_seek_professional_guidance");
  const baseGuardrails = [...input.selection.riskGuardrails, ...(blocked ? ["professional_clearance_required"] : [])];
  return ([
    ["strict_aggressive", -14, 0.35, blocked ? "ineligible" : input.hasHistory && !input.selection.historyModifiers.includes("plateau_history") ? "eligible" : "degraded"],
    ["balanced", 0, 0.55, blocked ? "degraded" : "eligible"],
    ["flexible", 21, 0.7, blocked ? "degraded" : "eligible"],
  ] as const).map(([scenario, offset, confidence, eligibility]) => ({
    scenario,
    eligibility,
    earliest: addDays(input.currentDate, Math.max(14, 42 + offset)),
    latest: addDays(input.currentDate, Math.max(42, 84 + offset)),
    phaseRoute: [input.phase.phase, ...(input.selection.primary === "preserve_lean_mass_cut" ? ["maintenance_recomposition"] : [])],
    executionRequirements: scenario === "strict_aggressive" ? ["high_adherence", "weekly_recovery_review", "no_new_safety_signal"] : ["record_comparable_trends", "complete_weekly_review"],
    tradeoffs: scenario === "strict_aggressive" ? ["less_margin_for_missed_sessions", "higher_recovery_demand"] : scenario === "balanced" ? ["moderate_pace", "requires_consistent_logging"] : ["slower_target_progress", "more_schedule_flexibility"],
    guardrails: baseGuardrails,
    confidence: { min: Math.max(0.05, confidence - 0.2), max: Math.min(0.9, confidence) },
    recalibrateAt: input.phase.reviewAt,
  }));
}

function phaseObjective(strategy: StrategyId): string {
  const objectives: Record<StrategyId, string> = {
    fat_loss_recomposition: "reduce body fat while retaining training exposure",
    preserve_lean_mass_cut: "prioritize lean-mass retention during a bounded cut",
    final_cut: "finish a bounded cut only with adequate recovery evidence",
    maintenance_recomposition: "hold a stable energy floor while improving composition and performance",
    recovery_maintenance: "restore recovery and maintain essential exposure",
    conservative_gain: "build lean mass with a small, observable surplus",
    stable_strength_gain: "improve strength without trading away recovery",
    return_to_training: "rebuild tolerance and skill after a training interruption",
    advanced_specialization_maintenance: "specialize one priority while maintaining other patterns",
    post_loss_consolidation_gain: "consolidate post-loss maintenance before a cautious gain phase",
    diet_break: "temporarily reduce diet pressure while preserving routine",
    deload_overlay: "reduce fatigue while retaining skill exposure",
  };
  return objectives[strategy];
}

function goalTypeForPrimaryGoal(goal: GoalContractData["primaryGoal"]): "hypertrophy" | "fat_loss" | "strength" | "physique" | "maintain" | "return_to_training" {
  return goal === "fat_loss_preserve_lean_mass" ? "fat_loss" : goal;
}

function addDays(date: string, count: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + count);
  return parsed.toISOString().slice(0, 10);
}
