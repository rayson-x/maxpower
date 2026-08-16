import type { DomainAggregateRef, DomainProjection, GoalContractData, NutritionStrategyData, PlanRevisionData } from "../coach/domain";
import { stableHash } from "../coach/stable";
import type { DailyHealthLedger } from "../health/DailyHealthLedger";
import type { HealthTrendProjection } from "../health/HealthTrends";
import { estimateBodyFat } from "../planning/bodyComposition";
import { strengthTargetProgress } from "./StrengthGoalEvidence";
import { strengthProgressFraction } from "./GoalNegotiation";

export type GoalPathState = "on_path" | "at_risk" | "infeasible_under_guardrails" | "insufficient_evidence";
export type GoalPathDiagnosis =
  | "tracking_silence"
  | "execution_failure"
  | "plan_friction"
  | "observation_too_early"
  | "measurement_not_comparable"
  | "recovery_limited"
  | "plan_response_review"
  | "goal_plan_mismatch"
  | "none";

export interface GoalPathSnapshotVersion {
  evaluationDate: string;
  aggregateRefs: readonly DomainAggregateRef[];
  ledgerVersions: readonly string[];
  ruleVersion: "goal-path.v1";
  knowledgeHash?: string;
}

export interface GoalPathAssessment {
  id: string;
  evaluatedAt: string;
  trigger: "frontier_changed" | "daily" | "weekly" | "explicit_request";
  state: GoalPathState;
  diagnosis: GoalPathDiagnosis;
  evidenceQuality: "high" | "partial" | "low";
  reasonCodes: readonly string[];
  nextValidationSignals: readonly string[];
  reviewAfter: string;
  materialSignal: "hard_safety" | "review_recommended" | "monitor" | "none";
  snapshotVersion: GoalPathSnapshotVersion;
  fingerprint: string;
}

export interface GoalPathSnapshot {
  userId: string;
  evaluatedAt: string;
  domain: DomainProjection;
  plan?: { revision: number; value: PlanRevisionData };
  goal?: { revision: number; value: GoalContractData };
  nutritionStrategy?: { revision: number; value: NutritionStrategyData };
  ledgers: readonly DailyHealthLedger[];
  trends: HealthTrendProjection;
}

export interface GoalPathCandidateCounterfactual {
  materiallyImproves: boolean;
  reasonCodes: readonly string[];
  currentPathFingerprint: string;
  candidatePathFingerprint: string;
}

/**
 * Deterministic Goal + current Plan evaluator. It never generates prose,
 * guesses food nutrients, or writes a Plan. Missing evidence remains missing.
 */
export class GoalPathModule {
  review(input: { snapshot: GoalPathSnapshot; trigger: GoalPathAssessment["trigger"] }): GoalPathAssessment {
    const { snapshot } = input;
    const version = snapshotVersion(snapshot);
    const decision = evaluate(snapshot);
    const reviewAfter = addDays(snapshot.evaluatedAt, decision.reviewDays);
    const decisionCore = {
      state: decision.state,
      diagnosis: decision.diagnosis,
      evidenceQuality: decision.evidenceQuality,
      reasonCodes: decision.reasonCodes,
      nextValidationSignals: decision.nextValidationSignals,
      reviewAfter,
      materialSignal: decision.materialSignal,
      snapshotVersion: version,
    };
    const fingerprint = stableHash(decisionCore);
    return { id: `goal-path:${fingerprint}`, evaluatedAt: snapshot.evaluatedAt, trigger: input.trigger, ...decisionCore, fingerprint };
  }

  /**
   * Fixed current-vs-candidate gate. It consumes the same assessment frontier
   * and goal predicate as review(); prose generation never participates.
   */
  compareCandidate(input: {
    snapshot: GoalPathSnapshot;
    assessment: GoalPathAssessment;
    goal: GoalContractData;
    currentPlan: PlanRevisionData;
    currentNutrition?: NutritionStrategyData;
    candidatePlan: PlanRevisionData;
    candidateNutrition: NutritionStrategyData;
  }): GoalPathCandidateCounterfactual {
    const replayed = this.review({ snapshot: input.snapshot, trigger: input.assessment.trigger });
    const candidateSnapshot: GoalPathSnapshot = {
      ...input.snapshot,
      plan: {
        revision: (input.snapshot.plan?.revision ?? input.candidatePlan.baseRevision ?? 0) + 1,
        value: { ...input.candidatePlan, id: input.currentPlan.id, baseRevision: input.snapshot.plan?.revision ?? input.candidatePlan.baseRevision ?? 0 },
      },
      nutritionStrategy: { revision: input.snapshot.nutritionStrategy?.revision ?? 1, value: input.candidateNutrition },
    };
    const candidateAssessment = this.review({ snapshot: candidateSnapshot, trigger: input.assessment.trigger });
    const current = pathFeatures(input.currentPlan, input.currentNutrition);
    const candidate = pathFeatures(input.candidatePlan, input.candidateNutrition);
    const reasons: string[] = [];
    if (replayed.fingerprint !== input.assessment.fingerprint) reasons.push("candidate_counterfactual_frontier_stale");
    if (candidateAssessment.state === "infeasible_under_guardrails") reasons.push("candidate_fails_goal_path_guardrails");
    if (candidateAssessment.diagnosis === "goal_plan_mismatch") reasons.push("candidate_goal_path_context_mismatch");
    if (input.assessment.state === "on_path") reasons.push("current_plan_still_on_path");
    if (input.assessment.state === "insufficient_evidence") reasons.push("candidate_not_supported_by_evidence");
    if (input.assessment.state === "infeasible_under_guardrails") reasons.push("hard_guardrail_cannot_be_improved_by_normal_candidate");
    if (input.assessment.state === "at_risk") {
      if (input.assessment.diagnosis === "plan_friction" || input.assessment.diagnosis === "execution_failure") {
        if (candidate.weeklyBurdenMinutes >= current.weeklyBurdenMinutes * 0.9 && candidate.sessionCount >= current.sessionCount) reasons.push("candidate_does_not_reduce_execution_friction");
      } else if (input.assessment.diagnosis === "recovery_limited") {
        if (candidate.weeklyBurdenMinutes >= current.weeklyBurdenMinutes * 0.85) reasons.push("candidate_does_not_backoff_recovery_burden");
      } else if (input.assessment.diagnosis === "plan_response_review") {
        const direction = input.goal.primaryGoal;
        const energyDelta = candidate.energyMidpoint - current.energyMidpoint;
        const doseChanged = stableHash(candidate.muscleDose) !== stableHash(current.muscleDose);
        if (direction === "fat_loss_preserve_lean_mass" && !(energyDelta <= -50 && energyDelta >= -250) && !doseChanged) reasons.push("candidate_does_not_improve_fat_loss_response_path");
        if (direction === "hypertrophy" && !(energyDelta >= 50 && energyDelta <= 250) && !doseChanged) reasons.push("candidate_does_not_improve_hypertrophy_response_path");
        if (direction === "strength" && !doseChanged) reasons.push("candidate_does_not_change_strength_stimulus");
      } else if (input.assessment.diagnosis === "goal_plan_mismatch") {
        reasons.push("goal_tradeoff_must_be_renegotiated_before_candidate");
      }
    }
    const shapeChanged = stableHash(current) !== stableHash(candidate);
    if (!shapeChanged) reasons.push("candidate_path_unchanged");
    return {
      materiallyImproves: reasons.length === 0,
      reasonCodes: reasons.length ? reasons : ["candidate_materially_improves_current_path"],
      currentPathFingerprint: stableHash({ assessment: replayed.fingerprint, snapshot: replayed.snapshotVersion, features: current }),
      candidatePathFingerprint: stableHash({ assessment: candidateAssessment.fingerprint, snapshot: candidateAssessment.snapshotVersion, facts: input.snapshot.domain.timeline.current.map((event) => [event.eventId, event.revision]), ledgers: input.snapshot.ledgers.map((ledger) => ledger.version), features: candidate }),
    };
  }
}

interface Decision {
  state: GoalPathState;
  diagnosis: GoalPathDiagnosis;
  evidenceQuality: GoalPathAssessment["evidenceQuality"];
  reasonCodes: readonly string[];
  nextValidationSignals: readonly string[];
  materialSignal: GoalPathAssessment["materialSignal"];
  reviewDays: number;
}

function evaluate(snapshot: GoalPathSnapshot): Decision {
  const safety = evaluateSafety(snapshot);
  if (safety) return safety;
  if (!snapshot.goal || !snapshot.plan) {
    return insufficient("goal_plan_mismatch", [!snapshot.goal ? "active_goal_missing" : "active_plan_missing"], ["confirm_goal_and_current_stage_plan"]);
  }
  if (snapshot.plan.value.goalContractRef.id !== snapshot.goal.value.id || snapshot.plan.value.goalContractRef.revision !== snapshot.goal.revision) {
    return risk("goal_plan_mismatch", ["active_plan_goal_revision_mismatch"], ["generate_plan_for_confirmed_goal"], "review_recommended");
  }
  const deadline = evaluateDeadlineFeasibility(snapshot);
  if (deadline) return deadline;

  const contract = snapshot.plan.value.observationContract;
  const activeDays = daysBetween(snapshot.plan.value.effectiveFrom, snapshot.evaluatedAt.slice(0, 10)) + 1;
  const ledgers = snapshot.ledgers.filter((ledger) => ledger.date >= snapshot.plan!.value.effectiveFrom);
  const latestFactAt = latestActiveFactAt(snapshot.domain);
  const silenceDays = latestFactAt ? daysBetween(latestFactAt.slice(0, 10), snapshot.evaluatedAt.slice(0, 10)) : activeDays;
  if (contract && silenceDays >= contract.trackingSilenceReviewDays) {
    return insufficient("tracking_silence", ["observation_contract_tracking_silence"], contract.requiredSignals, "review_recommended");
  }

  const execution = executionEvidence(snapshot, ledgers);
  if (execution.confirmedAttempts >= 2 && execution.failureRate >= 0.5) {
    const friction = planFriction(snapshot.plan.value, execution);
    return risk(friction ? "plan_friction" : "execution_failure", [friction ? "confirmed_execution_friction_high" : "confirmed_execution_failure_rate_high"], ["confirm_time_preference_or_environment_constraint", "observe_next_two_planned_attempts"], "review_recommended");
  }

  const recovery = recentRecovery(snapshot);
  if (recovery === "degraded") {
    return risk("recovery_limited", ["recovery_guardrail_degraded"], ["confirm_recovery_improves_before_progression"], "review_recommended");
  }

  const minimumDays = contract?.minimumObservationDays ?? 14;
  if (activeDays < minimumDays) {
    return {
      state: "insufficient_evidence", diagnosis: "observation_too_early", evidenceQuality: evidenceQuality(ledgers),
      reasonCodes: ["minimum_observation_window_not_complete"], nextValidationSignals: contract?.requiredSignals ?? ["continue_confirmed_records"], materialSignal: "monitor", reviewDays: Math.max(1, minimumDays - activeDays),
    };
  }

  if (bodyMeasurementRequired(snapshot.goal.value) && snapshot.trends.calibration.evidenceWindow.comparableWeightObservations < 2 && comparableBodySeries(snapshot.domain).length < 2) {
    return insufficient("measurement_not_comparable", ["required_comparable_measurement_missing"], ["record_comparable_body_measurement"]);
  }

  const trajectory = evaluateRemainingTrajectory(snapshot);
  if (trajectory) return trajectory;

  const quality = evidenceQuality(ledgers);
  const goalDecision = evaluateGoalPredicate(snapshot, ledgers, execution);
  if (goalDecision) return goalDecision;
  return { state: "on_path", diagnosis: "none", evidenceQuality: quality, reasonCodes: ["current_plan_path_supported"], nextValidationSignals: contract?.requiredSignals ?? ["continue_current_stage_observation"], materialSignal: "none", reviewDays: contract?.reviewCadenceDays ?? 7 };
}

function evaluateGoalPredicate(snapshot: GoalPathSnapshot, ledgers: readonly DailyHealthLedger[], execution: ReturnType<typeof executionEvidence>): Decision | undefined {
  const goal = snapshot.goal!.value;
  const completeBalance = ledgers.filter((ledger): ledger is DailyHealthLedger & { energyBalance: { status: "complete"; range: { min: number; max: number }; convention: "intake_minus_expenditure" } } => ledger.energyBalance.status === "complete");
  const meanBalance = completeBalance.length ? mean(completeBalance.map((ledger) => midpoint(ledger.energyBalance.range))) : undefined;
  const deadline = goal.horizon.endDate;
  if (deadline && deadline < snapshot.evaluatedAt.slice(0, 10)) {
    return { state: "infeasible_under_guardrails", diagnosis: "goal_plan_mismatch", evidenceQuality: evidenceQuality(ledgers), reasonCodes: ["goal_deadline_elapsed_without_confirmed_completion"], nextValidationSignals: ["renegotiate_goal_deadline_or_outcome"], materialSignal: "review_recommended", reviewDays: 1 };
  }
  if (goal.primaryGoal === "physique") {
    const waist = comparableCircumferenceSeries(snapshot.domain, "waist", snapshot.plan!.value.effectiveFrom);
    const shoulder = comparableCircumferenceSeries(snapshot.domain, "shoulder", snapshot.plan!.value.effectiveFrom);
    const needsWaist = Boolean(goal.targets?.targetWaist || goal.targets?.targetShoulderWaistRatio);
    const needsShoulder = Boolean(goal.targets?.targetShoulder || goal.targets?.targetShoulderWaistRatio);
    if (needsWaist && waist.length < 2 || needsShoulder && shoulder.length < 2) {
      return insufficient("measurement_not_comparable", ["physique_proxy_measurements_insufficient"], ["record_comparable_waist_and_shoulder_measurements"]);
    }
    if (execution.confirmedAttempts > 0 && execution.completedRate < 0.6) {
      return risk("plan_friction", ["physique_target_training_dose_not_executable"], ["reduce_session_friction_before_changing_target_strategy"], "review_recommended");
    }
    if (goal.successMetrics?.some((metric) => metric.toLowerCase().includes("satisfaction"))) {
      const satisfaction = snapshot.domain.timeline.current.filter((event) => event.fact.kind === "subjective" && event.fact.metric === "physique_satisfaction" && event.fact.confidence === "confirmed").sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      if (satisfaction.length < 2) return insufficient("measurement_not_comparable", ["physique_subjective_satisfaction_insufficient"], ["record_physique_satisfaction_on_same_scale"]);
      const firstSatisfaction = satisfaction[0]!.fact;
      const latestSatisfaction = satisfaction.at(-1)!.fact;
      if (firstSatisfaction.kind === "subjective" && latestSatisfaction.kind === "subjective" && latestSatisfaction.value <= firstSatisfaction.value) return risk("plan_response_review", ["physique_subjective_satisfaction_not_improving"], ["review_confirmed_proxy_and_behavior_tradeoffs"], "review_recommended");
    }
    return undefined;
  }
  if (goal.primaryGoal === "fat_loss_preserve_lean_mass") {
    const weights = comparableWeightSeries(snapshot.domain, snapshot.plan!.value.effectiveFrom);
    const weightDirection = weights.length >= 2 ? weights.at(-1)!.valueKg - weights[0]!.valueKg : undefined;
    if (meanBalance === undefined && weightDirection === undefined) return insufficient("tracking_silence", ["fat_loss_confirmed_energy_and_comparable_weight_path_unknown"], ["record_representative_numeric_intake", "record_comparable_body_weight"]);
    if (completeBalance.length < 3 && weightDirection === undefined) return insufficient("tracking_silence", ["fat_loss_representative_energy_coverage_insufficient"], ["record_representative_numeric_intake", "record_comparable_body_weight"]);
    if (meanBalance === undefined && weightDirection !== undefined && weightDirection >= 0) return risk("plan_response_review", ["fat_loss_observed_weight_path_not_declining"], ["record_representative_numeric_intake", "review_current_stage_response"], "review_recommended");
    if ((meanBalance !== undefined && meanBalance > -100) && (weightDirection === undefined || weightDirection >= -0.1)) return risk("plan_response_review", ["fat_loss_current_path_not_in_deficit"], ["observe_weight_and_waist_under_confirmed_execution"], "review_recommended");
    const mode = goal.targetMode ?? "lean_mass_preserving_fat_loss";
    if (mode === "higher_body_mass_fat_loss" && weightDirection !== undefined && weightDirection >= 0) return risk("plan_response_review", ["higher_body_mass_cut_weight_path_not_declining"], ["use_small_confirmed_behavior_reduction_and_reobserve"], "review_recommended");
    if (mode === "lean_mass_preserving_fat_loss") {
      const proteinDays = ledgers.filter((ledger) => ledger.nutrition.nutrients.protein.intakeKnown).length;
      if (proteinDays < 3) return insufficient("tracking_silence", ["lean_mass_protection_protein_coverage_insufficient"], ["record_confirmed_protein_on_representative_days"]);
      if (execution.confirmedAttempts > 0 && execution.completedRate < 0.7) return risk("execution_failure", ["lean_mass_protection_training_below_floor"], ["complete_key_strength_sessions"], "review_recommended");
    }
    if (mode === "strength_priority_cut") {
      const performance = comparablePerformanceTrend(snapshot.domain);
      if (performance === "unknown") return insufficient("measurement_not_comparable", ["strength_priority_cut_key_lift_trend_missing"], ["record_comparable_key_lift_sets"]);
      if (performance === "declining") return risk("plan_response_review", ["strength_priority_cut_performance_declining"], ["protect_key_lift_dose_or_reduce_deficit"], "review_recommended");
    }
    if (goal.guardrails?.requiredTrainingCompletion === "key_sessions" && execution.confirmedAttempts > 0 && execution.completedRate < 0.6) {
      return risk("execution_failure", ["fat_loss_lean_mass_protection_training_below_floor"], ["complete_key_strength_sessions"], "review_recommended");
    }
    return undefined;
  }
  if (goal.primaryGoal === "hypertrophy") {
    if (meanBalance === undefined) return insufficient("tracking_silence", ["hypertrophy_confirmed_energy_path_unknown"], ["record_representative_numeric_intake"]);
    if (completeBalance.length < 3) return insufficient("tracking_silence", ["hypertrophy_representative_energy_coverage_insufficient"], ["record_representative_numeric_intake"]);
    if (meanBalance < 50) return risk("plan_response_review", ["hypertrophy_energy_surplus_not_supported"], ["observe_confirmed_small_surplus_and_target_training_dose"], "review_recommended");
    if (meanBalance > 650) return risk("plan_response_review", ["hypertrophy_energy_surplus_above_bounded_path"], ["confirm_body_trend_and_reduce_only_small_behavior_step"], "review_recommended");
    if (execution.confirmedAttempts > 0 && execution.completedRate < 0.6) return risk("plan_friction", ["hypertrophy_target_training_dose_not_executable"], ["reduce_session_friction_before_adding_dose"], "review_recommended");
    const targetMuscles = goal.emphasisMuscles ?? [];
    if (targetMuscles.length) {
      const planned = plannedMuscleDose(snapshot.plan!.value);
      const performed = performedMuscleDose(snapshot.domain);
      const missingPlanned = targetMuscles.filter((muscle) => (planned[muscle] ?? 0) <= 0);
      if (missingPlanned.length) return risk("goal_plan_mismatch", ["hypertrophy_target_muscle_missing_from_plan", ...missingPlanned.map((muscle) => `missing_target_muscle:${muscle}`)], ["generate_target_muscle_dose"], "review_recommended");
      const unobserved = targetMuscles.filter((muscle) => (performed[muscle] ?? 0) <= 0);
      if (unobserved.length) return insufficient("measurement_not_comparable", ["hypertrophy_target_muscle_execution_unobserved"], ["confirm_target_muscle_sets"]);
    }
    const performance = comparablePerformanceTrend(snapshot.domain);
    const circumference = targetMusclesCircumferenceTrend(snapshot.domain, goal.emphasisMuscles ?? []);
    if (performance === "unknown" && circumference === "unknown") return insufficient("measurement_not_comparable", ["hypertrophy_performance_and_circumference_response_missing"], ["record_comparable_key_sets_or_target_circumference"]);
    if (performance === "declining" && circumference !== "improving") return risk("plan_response_review", ["hypertrophy_performance_and_size_path_not_improving"], ["hold_execution_then_review_stimulus_and_recovery"], "review_recommended");
    return undefined;
  }
  if (goal.primaryGoal === "strength") {
    if (execution.confirmedAttempts > 0 && execution.completedRate < 0.6) return risk("plan_friction", ["strength_key_session_completion_low"], ["reduce_schedule_or_session_friction"], "review_recommended");
    const performance = comparablePerformanceTrend(snapshot.domain, snapshot.plan!.value.effectiveFrom);
    if (performance === "unknown") return insufficient("measurement_not_comparable", ["strength_performance_path_missing"], ["record_comparable_key_lift_sets"]);
    const targetProgress = strengthTargetProgress(snapshot.domain, goal.targets?.strength, snapshot.plan!.value.effectiveFrom);
    if (targetProgress.some((target) => target.latestKg === undefined)) return insufficient("measurement_not_comparable", ["strength_target_lift_evidence_missing"], ["record_comparable_target_lift_sets"]);
    if (targetProgress.some((target) => !target.reached) && performance !== "improving") return risk("plan_response_review", ["strength_target_path_not_improving"], ["review_strength_stimulus_recovery_and_deadline"], "review_recommended");
    if (performance === "declining") return risk("plan_response_review", ["strength_performance_path_declining"], ["review_stimulus_recovery_and_goal_timeline"], "review_recommended");
    return undefined;
  }
  if (goal.primaryGoal === "maintain") {
    if (execution.confirmedAttempts === 0 && meanBalance === undefined) {
      return insufficient("tracking_silence", ["maintenance_execution_and_energy_path_unknown"], ["record_representative_numeric_intake_or_confirm_planned_training"]);
    }
    if (execution.confirmedAttempts > 0 && execution.completedRate < 0.6) {
      return risk("plan_friction", ["maintenance_plan_completion_low"], ["reduce_session_friction_or_confirm_record_only"], "review_recommended");
    }
    if (meanBalance !== undefined && Math.abs(meanBalance) > 350) {
      return risk("plan_response_review", ["maintenance_energy_path_outside_bounded_range"], ["review_confirmed_intake_and_body_trend"], "review_recommended");
    }
    return undefined;
  }
  if (goal.primaryGoal === "return_to_training") {
    if (execution.confirmedAttempts === 0) {
      return insufficient("tracking_silence", ["return_to_training_execution_unobserved"], ["confirm_first_low_burden_training_session"]);
    }
    if (execution.completedRate < 0.6) {
      return risk("plan_friction", ["return_to_training_plan_not_yet_executable"], ["reduce_session_burden_and_reobserve"], "review_recommended");
    }
    return undefined;
  }
  return { state: "insufficient_evidence", diagnosis: "goal_plan_mismatch", evidenceQuality: "low", reasonCodes: ["unsupported_goal_policy"], nextValidationSignals: ["define_supported_goal_contract"], materialSignal: "review_recommended", reviewDays: 1 };
}

function evaluateSafety(snapshot: GoalPathSnapshot): Decision | undefined {
  const hard = snapshot.domain.safetyConstraints.find((constraint) => constraint.value.disposition === "stop_and_seek_professional_guidance");
  if (hard) return { state: "infeasible_under_guardrails", diagnosis: "recovery_limited", evidenceQuality: "high", reasonCodes: ["hard_safety_constraint_active", ...hard.value.reasons], nextValidationSignals: ["seek_appropriate_professional_guidance"], materialSignal: "hard_safety", reviewDays: 1 };
  const pain = snapshot.domain.timeline.current.find((event) => event.fact.kind === "symptom" && event.fact.confidence === "confirmed" && event.fact.symptom === "pain" && (event.fact.severity ?? 0) >= 7);
  if (pain) return { state: "infeasible_under_guardrails", diagnosis: "recovery_limited", evidenceQuality: "high", reasonCodes: ["confirmed_high_severity_pain"], nextValidationSignals: ["stop_risky_training_and_confirm_professional_review"], materialSignal: "hard_safety", reviewDays: 1 };
  const clinical = snapshot.domain.timeline.current.find((event) => event.fact.kind === "clinical_context" && event.fact.confidence === "confirmed");
  if (clinical?.fact.kind === "clinical_context") return { state: "infeasible_under_guardrails", diagnosis: "recovery_limited", evidenceQuality: "high", reasonCodes: [`clinical_boundary:${clinical.fact.context}`], nextValidationSignals: ["seek_appropriate_professional_guidance_before_general_planning"], materialSignal: "hard_safety", reviewDays: 1 };
  const extreme = snapshot.ledgers.filter((ledger) => ledger.energyBalance.status === "complete" && ledger.energyBalance.range.max <= -1_000).length;
  if (extreme >= 3) return { state: "infeasible_under_guardrails", diagnosis: "recovery_limited", evidenceQuality: "high", reasonCodes: ["repeated_extreme_energy_restriction"], nextValidationSignals: ["stop_extreme_restriction_and_confirm_safe_intake_path"], materialSignal: "hard_safety", reviewDays: 1 };
  const sevenDaysAgo = new Date(Date.parse(snapshot.evaluatedAt) - 7 * 86_400_000).toISOString();
  const recentWorkouts = snapshot.domain.workouts.filter((workout) => workout.outcome?.completedAt && workout.outcome.completedAt >= sevenDaysAgo);
  const weeklySets = recentWorkouts.reduce((total, workout) => total + workout.setOutcomes.length, 0);
  if (recentWorkouts.length > 7 || weeklySets > 120 || recentWorkouts.some((workout) => workout.setOutcomes.length > 40)) {
    return { state: "infeasible_under_guardrails", diagnosis: "recovery_limited", evidenceQuality: "high", reasonCodes: ["confirmed_training_dose_above_hard_safety_boundary"], nextValidationSignals: ["stop_progression_and_confirm_recovery_before_resuming"], materialSignal: "hard_safety", reviewDays: 1 };
  }
  return undefined;
}

function evaluateDeadlineFeasibility(snapshot: GoalPathSnapshot): Decision | undefined {
  const goal = snapshot.goal?.value;
  const deadline = goal?.horizon.endDate;
  const targets = goal?.targets;
  if (!goal || !deadline || !targets) return undefined;
  const remainingWeeks = Math.max(1 / 7, daysBetween(snapshot.evaluatedAt.slice(0, 10), deadline) / 7);
  const requiredWeeks: { target: string; weeks: number }[] = [];
  const missing: string[] = [];
  const latestWeight = comparableWeightSeries(snapshot.domain).at(-1)?.valueKg
    ?? massKg(snapshot.domain.profile?.value.demographics?.currentWeight);
  const targetWeight = massKg(targets.targetWeight);
  if (targetWeight !== undefined) {
    if (latestWeight === undefined || latestWeight <= 0) missing.push("current_body_weight_missing_for_deadline");
    else {
      const rate = goal.primaryGoal === "fat_loss_preserve_lean_mass" ? latestWeight * 0.01 : goal.primaryGoal === "hypertrophy" ? latestWeight * 0.005 : latestWeight * 0.0025;
      requiredWeeks.push({ target: "weight", weeks: Math.abs(targetWeight - latestWeight) / Math.max(0.1, rate) });
    }
  }
  const targetBodyFat = targets.targetBodyFat?.value;
  if (targetBodyFat !== undefined) {
    const currentBodyFat = comparableBodyFatSeries(snapshot.domain).at(-1)?.value
      ?? targets.currentBodyFat?.value
      ?? (snapshot.domain.profile ? estimateBodyFat({ profile: snapshot.domain.profile.value })?.percent : undefined);
    if (currentBodyFat === undefined) missing.push("current_body_fat_missing_for_deadline");
    else requiredWeeks.push({ target: "body_fat", weeks: Math.abs(targetBodyFat - currentBodyFat) / (targetBodyFat < currentBodyFat ? 0.75 : 0.25) });
  }
  const latestWaist = comparableCircumferenceSeries(snapshot.domain, "waist").at(-1)?.valueCm
    ?? lengthCm(snapshot.domain.profile?.value.demographics?.currentCircumferences?.waist);
  const targetWaist = lengthCm(targets.targetWaist);
  if (targetWaist !== undefined) {
    if (latestWaist === undefined) missing.push("current_waist_missing_for_deadline");
    else requiredWeeks.push({ target: "waist", weeks: Math.abs(targetWaist - latestWaist) / (targetWaist < latestWaist ? 1 : 0.25) });
  }
  const latestShoulder = comparableCircumferenceSeries(snapshot.domain, "shoulder").at(-1)?.valueCm
    ?? lengthCm(snapshot.domain.profile?.value.demographics?.currentCircumferences?.shoulder);
  const targetShoulder = lengthCm(targets.targetShoulder);
  if (targetShoulder !== undefined) {
    if (latestShoulder === undefined) missing.push("current_shoulder_missing_for_deadline");
    else requiredWeeks.push({ target: "shoulder", weeks: Math.abs(targetShoulder - latestShoulder) / (targetShoulder > latestShoulder ? 0.25 : 1) });
  }
  if (targets.targetShoulderWaistRatio !== undefined) {
    if (latestWaist === undefined || latestShoulder === undefined) missing.push("current_shoulder_waist_measurements_missing_for_deadline");
    else requiredWeeks.push({ target: "shoulder_waist_ratio", weeks: Math.abs(targets.targetShoulderWaistRatio - latestShoulder / Math.max(1, latestWaist)) / 0.015 });
  }
  const strength = strengthTargetProgress(snapshot.domain, targets.strength);
  for (const progress of strength) {
    const current = progress.latestKg ?? profileStrengthBaselineKg(snapshot, progress.lift);
    if (current === undefined) missing.push(`current_strength_missing_for_deadline:${progress.lift}`);
    else if (progress.targetKg > current) {
      const fraction = strengthProgressFraction(snapshot.domain.profile?.value);
      requiredWeeks.push({ target: `strength:${progress.lift}`, weeks: (progress.targetKg - current) / Math.max(0.5, current * fraction) });
    }
  }
  if (missing.length) return insufficient("measurement_not_comparable", ["goal_deadline_baseline_missing", ...missing], missing.map((code) => `confirm_${code}`));
  const beyond = requiredWeeks.filter((entry) => entry.weeks > remainingWeeks + 0.01);
  if (beyond.length) {
    return { state: "infeasible_under_guardrails", diagnosis: "goal_plan_mismatch", evidenceQuality: "partial", reasonCodes: ["target_deadline_requires_rate_beyond_guardrail", ...beyond.map((entry) => `deadline_target:${entry.target}`)], nextValidationSignals: ["renegotiate_deadline_outcome_or_behavior_burden"], materialSignal: "review_recommended", reviewDays: 1 };
  }
  const tightest = Math.max(0, ...requiredWeeks.map((entry) => entry.weeks));
  if (remainingWeeks <= 2 && tightest > remainingWeeks * 0.75) return risk("goal_plan_mismatch", ["deadline_bottleneck_entered"], ["review_goal_tradeoffs_before_deadline"], "review_recommended");
  return undefined;
}

/** Compare the observed comparable trend with the rate still required by the confirmed contract. */
function evaluateRemainingTrajectory(snapshot: GoalPathSnapshot): Decision | undefined {
  const goal = snapshot.goal!.value;
  const deadline = goal.horizon.endDate;
  if (!deadline) return undefined;
  const remainingDays = daysBetween(snapshot.evaluatedAt.slice(0, 10), deadline);
  if (remainingDays <= 0) return undefined;
  const weights = comparableWeightSeries(snapshot.domain, snapshot.plan!.value.effectiveFrom);
  const targetWeight = goal.targets?.targetWeight;
  const targetKg = targetWeight?.unit === "kg" ? targetWeight.value : targetWeight?.unit === "lb" ? targetWeight.value * 0.45359237 : undefined;
  if (targetKg !== undefined) {
    if (weights.length < 2) return insufficient("measurement_not_comparable", ["goal_weight_trajectory_insufficient"], ["record_comparable_body_weight"]);
    const first = weights[0]!;
    const latest = weights.at(-1)!;
    const observedDays = daysBetween(first.occurredAt.slice(0, 10), latest.occurredAt.slice(0, 10));
    if (observedDays < 7) return insufficient("observation_too_early", ["weight_trajectory_window_too_short"], ["continue_comparable_weight_measurements"]);
    const observedPerDay = (latest.valueKg - first.valueKg) / observedDays;
    const requiredPerDay = (targetKg - latest.valueKg) / remainingDays;
    const directionMatches = requiredPerDay < 0 ? observedPerDay < 0 : requiredPerDay > 0 ? observedPerDay > 0 : true;
    const paceRatio = Math.abs(requiredPerDay) <= 0.001 ? 1 : Math.abs(observedPerDay) / Math.abs(requiredPerDay);
    if (!directionMatches || paceRatio < 0.75) return risk("plan_response_review", ["observed_weight_trend_below_required_goal_path"], ["review_execution_plan_response_and_goal_tradeoffs"], "review_recommended");
  }
  if (goal.targets?.targetBodyFat) {
    const bodyFat = comparableBodyFatSeries(snapshot.domain, snapshot.plan!.value.effectiveFrom);
    if (bodyFat.length < 2) return insufficient("measurement_not_comparable", ["goal_body_fat_trajectory_insufficient"], ["record_comparable_body_fat_percentage"]);
    const first = bodyFat[0]!;
    const latest = bodyFat.at(-1)!;
    const observedDays = daysBetween(first.occurredAt.slice(0, 10), latest.occurredAt.slice(0, 10));
    if (observedDays < 14) return insufficient("observation_too_early", ["body_fat_trajectory_window_too_short"], ["continue_comparable_body_fat_measurements"]);
    const observedPerDay = (latest.value - first.value) / observedDays;
    const requiredPerDay = (goal.targets.targetBodyFat.value - latest.value) / remainingDays;
    const directionMatches = requiredPerDay < 0 ? observedPerDay < 0 : requiredPerDay > 0 ? observedPerDay > 0 : true;
    if (!directionMatches || Math.abs(observedPerDay) < Math.abs(requiredPerDay) * 0.75) return risk("plan_response_review", ["observed_body_fat_trend_below_required_goal_path"], ["review_execution_plan_response_and_goal_tradeoffs"], "review_recommended");
  }
  if (goal.primaryGoal === "physique" && goal.targets?.targetWaist) {
    const waist = comparableCircumferenceSeries(snapshot.domain, "waist", snapshot.plan!.value.effectiveFrom);
    if (waist.length < 2) return insufficient("measurement_not_comparable", ["physique_waist_trajectory_insufficient"], ["record_comparable_waist_measurements"]);
    const targetCm = goal.targets.targetWaist.unit === "cm" ? goal.targets.targetWaist.value : goal.targets.targetWaist.value * 2.54;
    const first = waist[0]!;
    const latest = waist.at(-1)!;
    const observedDays = daysBetween(first.occurredAt.slice(0, 10), latest.occurredAt.slice(0, 10));
    if (observedDays < 7) return insufficient("observation_too_early", ["physique_trajectory_window_too_short"], ["continue_comparable_waist_measurements"]);
    const observedPerDay = (latest.valueCm - first.valueCm) / observedDays;
    const requiredPerDay = (targetCm - latest.valueCm) / remainingDays;
    if (requiredPerDay < 0 && (observedPerDay >= 0 || Math.abs(observedPerDay) < Math.abs(requiredPerDay) * 0.75)) return risk("plan_response_review", ["observed_physique_trend_below_required_goal_path"], ["review_execution_and_current_stage_response"], "review_recommended");
  }
  if (goal.primaryGoal === "physique" && goal.targets?.targetShoulder) {
    const shoulder = comparableCircumferenceSeries(snapshot.domain, "shoulder", snapshot.plan!.value.effectiveFrom);
    if (shoulder.length < 2) return insufficient("measurement_not_comparable", ["physique_shoulder_trajectory_insufficient"], ["record_comparable_shoulder_measurements"]);
    const targetCm = lengthCm(goal.targets.targetShoulder)!;
    const first = shoulder[0]!;
    const latest = shoulder.at(-1)!;
    const observedDays = daysBetween(first.occurredAt.slice(0, 10), latest.occurredAt.slice(0, 10));
    if (observedDays < 14) return insufficient("observation_too_early", ["physique_shoulder_trajectory_window_too_short"], ["continue_comparable_shoulder_measurements"]);
    const observedPerDay = (latest.valueCm - first.valueCm) / observedDays;
    const requiredPerDay = (targetCm - latest.valueCm) / remainingDays;
    if (requiredPerDay > 0 && (observedPerDay <= 0 || observedPerDay < requiredPerDay * 0.75)) return risk("plan_response_review", ["observed_shoulder_trend_below_required_goal_path"], ["review_execution_and_current_stage_response"], "review_recommended");
  }
  if (goal.primaryGoal === "physique" && goal.targets?.targetShoulderWaistRatio) {
    const waist = comparableCircumferenceSeries(snapshot.domain, "waist", snapshot.plan!.value.effectiveFrom);
    const shoulder = comparableCircumferenceSeries(snapshot.domain, "shoulder", snapshot.plan!.value.effectiveFrom);
    if (waist.length < 2 || shoulder.length < 2) return insufficient("measurement_not_comparable", ["physique_ratio_trajectory_insufficient"], ["record_comparable_waist_and_shoulder_measurements"]);
    const firstAt = waist[0]!.occurredAt > shoulder[0]!.occurredAt ? waist[0]!.occurredAt : shoulder[0]!.occurredAt;
    const latestAt = waist.at(-1)!.occurredAt < shoulder.at(-1)!.occurredAt ? waist.at(-1)!.occurredAt : shoulder.at(-1)!.occurredAt;
    const observedDays = daysBetween(firstAt.slice(0, 10), latestAt.slice(0, 10));
    if (observedDays < 7) return insufficient("observation_too_early", ["physique_ratio_trajectory_window_too_short"], ["continue_comparable_waist_and_shoulder_measurements"]);
    const firstRatio = shoulder[0]!.valueCm / Math.max(1, waist[0]!.valueCm);
    const latestRatio = shoulder.at(-1)!.valueCm / Math.max(1, waist.at(-1)!.valueCm);
    const observedPerDay = (latestRatio - firstRatio) / observedDays;
    const requiredPerDay = (goal.targets.targetShoulderWaistRatio - latestRatio) / remainingDays;
    if (requiredPerDay > 0 && (observedPerDay <= 0 || observedPerDay < requiredPerDay * 0.75)) return risk("plan_response_review", ["observed_physique_ratio_trend_below_required_goal_path"], ["review_execution_and_current_stage_response"], "review_recommended");
  }
  const strength = strengthTargetProgress(snapshot.domain, goal.targets?.strength, snapshot.plan!.value.effectiveFrom);
  for (const target of strength) {
    if (target.reached) continue;
    if (target.observations.length < 2 || target.latestKg === undefined) return insufficient("measurement_not_comparable", ["strength_target_trajectory_insufficient"], ["record_comparable_target_lift_sets"]);
    const first = target.observations[0]!;
    const latest = target.observations.at(-1)!;
    const observedDays = daysBetween(first.occurredAt.slice(0, 10), latest.occurredAt.slice(0, 10));
    if (observedDays < 7) return insufficient("observation_too_early", ["strength_trajectory_window_too_short"], ["continue_comparable_target_lift_measurements"]);
    const observedPerDay = (latest.estimatedOneRepMaxKg - first.estimatedOneRepMaxKg) / observedDays;
    const requiredPerDay = (target.targetKg - latest.estimatedOneRepMaxKg) / remainingDays;
    if (requiredPerDay > 0 && (observedPerDay <= 0 || observedPerDay < requiredPerDay * 0.75)) return risk("plan_response_review", ["observed_strength_trend_below_required_goal_path", `strength_target:${target.lift}`], ["review_execution_stimulus_recovery_and_goal_tradeoffs"], "review_recommended");
  }
  return undefined;
}

function executionEvidence(snapshot: GoalPathSnapshot, ledgers: readonly DailyHealthLedger[]) {
  const startDate = snapshot.plan!.value.effectiveFrom;
  const planId = snapshot.plan!.value.id;
  const planRevision = snapshot.plan!.revision;
  const attemptEvents = snapshot.domain.timeline.current.filter((event) => {
    if (event.occurredAt.slice(0, 10) < startDate || event.fact.kind !== "training" || event.fact.confidence !== "confirmed") return false;
    const ref = event.fact.reportedSession?.plannedSessionRef;
    return ref?.planId === planId && ref.planRevision === planRevision && (event.fact.reportedSession?.executionStatus === "completed" || event.fact.reportedSession?.executionStatus === "missed");
  });
  const completed = attemptEvents.filter((event) => event.fact.kind === "training" && event.fact.reportedSession?.executionStatus === "completed").length;
  const missed = attemptEvents.filter((event) => event.fact.kind === "training" && event.fact.reportedSession?.executionStatus === "missed").length;
  // Freestyle workouts without a plan ref never enter the current plan's
  // execution denominator; their Ledger coverage remains visible.
  const attempts = completed + missed;
  return { completed, missed, confirmedAttempts: attempts, failureRate: attempts ? missed / attempts : 0, completedRate: attempts ? completed / attempts : 1 };
}
function planFriction(plan: PlanRevisionData, execution: ReturnType<typeof executionEvidence>): boolean { return execution.missed >= 2 && plan.sessions.some((session) => (session.estimatedDuration?.unit === "minutes" ? session.estimatedDuration.value : session.durationBudget?.unit === "minutes" ? session.durationBudget.value : 0) > 75); }
function recentRecovery(snapshot: GoalPathSnapshot): "adequate" | "degraded" | "unknown" {
  const recent = snapshot.domain.timeline.current.filter((event) => event.fact.kind === "recovery" && event.fact.confidence === "confirmed").sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 3);
  const scores = recent.flatMap((event) => event.fact.kind === "recovery" && event.fact.perceivedRecovery !== undefined ? [event.fact.perceivedRecovery] : []);
  return !scores.length ? "unknown" : mean(scores) <= 2 ? "degraded" : "adequate";
}
function evidenceQuality(ledgers: readonly DailyHealthLedger[]): "high" | "partial" | "low" { const complete = ledgers.filter((ledger) => ledger.nutrition.nutrients.energy.intakeKnown).length; return complete >= 10 ? "high" : complete >= 3 ? "partial" : "low"; }
function bodyMeasurementRequired(goal: GoalContractData): boolean {
  return Boolean(
    goal.measurementPlan?.requiredMeasurements.some((measurement) => measurement !== "key_lift")
    || goal.targets?.targetWeight
    || goal.targets?.targetBodyFat
    || goal.targets?.circumferences
    || goal.targets?.targetWaist
    || goal.targets?.targetShoulder
    || goal.targets?.targetShoulderWaistRatio,
  );
}
function comparableBodySeries(domain: DomainProjection) { return bestProtocolBodySeries(domain, () => true); }
function comparableCircumferenceSeries(domain: DomainProjection, site: "waist" | "shoulder", startDate?: string) {
  return bestProtocolBodySeries(domain, (event) => event.occurredAt.slice(0, 10) >= (startDate ?? "") && event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && event.fact.measurement.site.toLowerCase() === site)
    .map((event) => {
      if (event.fact.kind !== "body" || event.fact.measurement.metric !== "circumference") throw new Error("circumference_fact_expected");
      return { occurredAt: event.occurredAt, valueCm: event.fact.measurement.quantity.unit === "cm" ? event.fact.measurement.quantity.value : event.fact.measurement.quantity.value * 2.54 };
    })
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
}
function bestProtocolBodySeries(
  domain: DomainProjection,
  predicate: (event: DomainProjection["timeline"]["current"][number]) => boolean,
) {
  const groups = new Map<string, DomainProjection["timeline"]["current"]>();
  for (const event of domain.timeline.current) {
    if (event.fact.kind !== "body" || event.fact.confidence !== "confirmed" || !predicate(event)) continue;
    const measurement = event.fact.measurement;
    const site = measurement.metric === "circumference" ? measurement.site.trim().toLowerCase() : "";
    const condition = "condition" in measurement ? measurement.condition?.trim().toLowerCase() ?? "unspecified" : "unspecified";
    const method = event.envelope?.provenance.recordingMethod ?? "unknown";
    const key = `${measurement.metric}:${site}:${condition}:${method}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()]
    .sort((left, right) => right.length - left.length || (right.at(-1)?.occurredAt ?? "").localeCompare(left.at(-1)?.occurredAt ?? ""))[0]
    ?.slice()
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)) ?? [];
}
function comparableWeightSeries(domain: DomainProjection, startDate?: string) {
  return bestProtocolBodySeries(domain, (event) => event.occurredAt.slice(0, 10) >= (startDate ?? "") && event.fact.kind === "body" && event.fact.measurement.metric === "body_weight")
    .map((event) => {
      if (event.fact.kind !== "body" || event.fact.measurement.metric !== "body_weight") throw new Error("weight_fact_expected");
      return { occurredAt: event.occurredAt, valueKg: event.fact.measurement.quantity.unit === "kg" ? event.fact.measurement.quantity.value : event.fact.measurement.quantity.value * 0.45359237 };
    });
}
function comparableBodyFatSeries(domain: DomainProjection, startDate?: string) {
  return bestProtocolBodySeries(domain, (event) => event.occurredAt.slice(0, 10) >= (startDate ?? "") && event.fact.kind === "body" && event.fact.measurement.metric === "body_fat_percentage")
    .map((event) => {
      if (event.fact.kind !== "body" || event.fact.measurement.metric !== "body_fat_percentage") throw new Error("body_fat_fact_expected");
      return { occurredAt: event.occurredAt, value: event.fact.measurement.quantity.value };
    });
}
function massKg(quantity?: { value: number; unit: "kg" | "lb" }): number | undefined { return quantity ? quantity.unit === "kg" ? quantity.value : quantity.value * 0.45359237 : undefined; }
function lengthCm(quantity?: { value: number; unit: "cm" | "in" }): number | undefined { return quantity ? quantity.unit === "cm" ? quantity.value : quantity.value * 2.54 : undefined; }
function profileStrengthBaselineKg(snapshot: GoalPathSnapshot, lift: ReturnType<typeof strengthTargetProgress>[number]["lift"]): number | undefined {
  const baseline = snapshot.domain.profile?.value.strengthBaseline;
  if (!baseline) return undefined;
  const e1rm = (quantity?: { value: number; unit: "kg" | "lb" }, reps?: number) => {
    const kg = massKg(quantity);
    return kg === undefined ? undefined : kg * (1 + (reps ?? 1) / 30);
  };
  if (lift === "squat") return e1rm(baseline.squat, baseline.squatReps);
  if (lift === "benchPress") return e1rm(baseline.benchPress, baseline.benchPressReps);
  if (lift === "deadlift") return e1rm(baseline.deadlift, baseline.deadliftReps);
  const values = [e1rm(baseline.squat, baseline.squatReps), e1rm(baseline.benchPress, baseline.benchPressReps), e1rm(baseline.deadlift, baseline.deadliftReps)];
  return values.every((value) => value !== undefined) ? values.reduce<number>((total, value) => total + value!, 0) : undefined;
}
function plannedMuscleDose(plan: PlanRevisionData): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const session of plan.sessions) {
    for (const slot of session.stimulusSlots ?? []) {
      for (const muscle of slot.intent.directMuscles ?? slot.intent.muscleGroups) totals[muscle] = (totals[muscle] ?? 0) + slot.prescription.setCount;
    }
  }
  return totals;
}
function performedMuscleDose(domain: DomainProjection): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const workout of domain.workouts) {
    const slotById = new Map((workout.frozenPrescription.stimulusSlots ?? []).map((slot) => [slot.id, slot]));
    const taskBySetId = new Map(workout.frozenPrescription.tasks.flatMap((task) => task.sets.map((set) => [set.id, task] as const)));
    for (const outcome of workout.setOutcomes) {
      const task = taskBySetId.get(outcome.prescriptionSetId);
      const slot = task?.stimulusSlotId ? slotById.get(task.stimulusSlotId) : undefined;
      for (const muscle of slot?.intent.directMuscles ?? slot?.intent.muscleGroups ?? []) totals[muscle] = (totals[muscle] ?? 0) + 1;
    }
  }
  return totals;
}
function comparablePerformanceTrend(domain: DomainProjection, startDate?: string): "improving" | "stable" | "declining" | "unknown" {
  const byExercise = new Map<string, { at: string; score: number }[]>();
  for (const workout of domain.workouts) {
    for (const outcome of workout.setOutcomes) {
      if (!outcome.actualLoad || outcome.actualReps === undefined) continue;
      const kg = outcome.actualLoad.unit === "kg" ? outcome.actualLoad.value : outcome.actualLoad.value * 0.45359237;
      const at = outcome.recordedAt ?? workout.outcome?.completedAt;
      if (!at) continue;
      if (startDate && at.slice(0, 10) < startDate) continue;
      byExercise.set(outcome.exerciseVariantId, [...(byExercise.get(outcome.exerciseVariantId) ?? []), { at, score: kg * (1 + outcome.actualReps / 30) }]);
    }
  }
  const comparable = [...byExercise.values()].filter((sets) => sets.length >= 2).map((sets) => sets.sort((left, right) => left.at.localeCompare(right.at)));
  if (!comparable.length) return "unknown";
  const changes = comparable.map((sets) => sets.at(-1)!.score / Math.max(1, sets[0]!.score) - 1);
  const average = mean(changes);
  return average > 0.02 ? "improving" : average < -0.02 ? "declining" : "stable";
}
function targetMusclesCircumferenceTrend(domain: DomainProjection, muscles: readonly string[]): "improving" | "stable" | "declining" | "unknown" {
  const normalized = new Set(muscles.map((muscle) => muscle.trim().toLowerCase()));
  const values = bestProtocolBodySeries(domain, (event) => event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && (!normalized.size || normalized.has(event.fact.measurement.site.trim().toLowerCase())))
    .map((event) => {
      if (event.fact.kind !== "body" || event.fact.measurement.metric !== "circumference") throw new Error("circumference_fact_expected");
      return event.fact.measurement.quantity.unit === "cm" ? event.fact.measurement.quantity.value : event.fact.measurement.quantity.value * 2.54;
    });
  if (values.length < 2) return "unknown";
  const change = values.at(-1)! - values[0]!;
  return change > 0.3 ? "improving" : change < -0.3 ? "declining" : "stable";
}
function pathFeatures(plan: PlanRevisionData, nutrition: NutritionStrategyData | undefined) {
  const energy = nutrition?.calorieRange;
  return {
    sessionCount: plan.sessions.length,
    weeklyBurdenMinutes: plan.sessions.reduce((total, session) => total + (session.estimatedDuration?.unit === "minutes" ? session.estimatedDuration.value : session.durationBudget?.unit === "minutes" ? session.durationBudget.value : 45), 0),
    energyMidpoint: energy ? (energy.min.value + energy.max.value) / 2 : 0,
    muscleDose: plannedMuscleDose(plan),
    observationContract: plan.observationContract,
  };
}
function latestActiveFactAt(domain: DomainProjection): string | undefined { return [...domain.timeline.current].filter((event) => event.fact.confidence === "confirmed").sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]?.occurredAt; }

function snapshotVersion(snapshot: GoalPathSnapshot): GoalPathSnapshotVersion {
  return {
    evaluationDate: snapshot.evaluatedAt.slice(0, 10),
    aggregateRefs: goalPathAggregateRefs(snapshot.domain),
    ...(snapshot.plan ? { knowledgeHash: stableHash(snapshot.plan.value.knowledgePins) } : {}),
    ledgerVersions: snapshot.ledgers.map((ledger) => ledger.version), ruleVersion: "goal-path.v1",
  };
}

/** Every mutable aggregate read by the fixed GoalPath decision, in deterministic order. */
export function goalPathAggregateRefs(domain: DomainProjection): readonly DomainAggregateRef[] {
  const activePlan = domain.plan && domain.planStatus === "current" && (!domain.plan.value.lifecycle || domain.plan.value.lifecycle.state === "active")
    ? domain.plan
    : undefined;
  const nutrition = [...domain.nutritionStrategies]
    .filter((strategy) => !domain.goalContract || strategy.value.goalContractRef.id === domain.goalContract.value.id)
    .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0];
  return [
    { kind: "timeline" as const, id: `timeline.${domain.userId}`, revision: domain.timeline.revision },
    ...(domain.profile ? [{ kind: "user_profile" as const, id: domain.profile.value.id, revision: domain.profile.revision }] : []),
    ...(domain.goalContract ? [{ kind: "goal_contract" as const, id: domain.goalContract.value.id, revision: domain.goalContract.revision }] : []),
    ...(activePlan ? [{ kind: "plan" as const, id: activePlan.value.id, revision: activePlan.revision }] : []),
    ...(nutrition ? [{ kind: "nutrition_strategy" as const, id: nutrition.value.id, revision: nutrition.revision }] : []),
    ...(domain.mandate ? [{ kind: "coaching_mandate" as const, id: domain.mandate.value.id, revision: domain.mandate.revision }] : []),
    ...domain.workouts.map((workout) => ({ kind: "workout_session" as const, id: workout.id, revision: workout.revision })),
    ...domain.recoveryConstraints.map((constraint) => ({ kind: "recovery_constraint" as const, id: constraint.value.id, revision: constraint.revision })),
    ...domain.safetyConstraints.map((constraint) => ({ kind: "safety_constraint" as const, id: constraint.value.id, revision: constraint.revision })),
  ].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}
function insufficient(diagnosis: GoalPathDiagnosis, reasons: readonly string[], next: readonly string[], signal: GoalPathAssessment["materialSignal"] = "monitor"): Decision { return { state: "insufficient_evidence", diagnosis, evidenceQuality: "low", reasonCodes: reasons, nextValidationSignals: next, materialSignal: signal, reviewDays: 7 }; }
function risk(diagnosis: GoalPathDiagnosis, reasons: readonly string[], next: readonly string[], signal: GoalPathAssessment["materialSignal"]): Decision { return { state: "at_risk", diagnosis, evidenceQuality: "partial", reasonCodes: reasons, nextValidationSignals: next, materialSignal: signal, reviewDays: 7 }; }
function midpoint(range: { min: number; max: number }): number { return (range.min + range.max) / 2; }
function mean(values: readonly number[]): number { return values.length ? sum(values) / values.length : 0; }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function daysBetween(left: string, right: string): number { return Math.max(0, Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86_400_000)); }
function addDays(iso: string, days: number): string { return new Date(Date.parse(iso) + days * 86_400_000).toISOString(); }
