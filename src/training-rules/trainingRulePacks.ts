import { stableHash } from "../coach/stable";
import type { MassQuantity } from "../coach/domain";
import type { VersionPin } from "../knowledge/model";
import type {
  ComparableSessionEvidence,
  PerformanceProgressionState,
  RuleDecision,
  RuleEvaluationContext,
  TrainingGoal,
  TrainingRulePack,
  TrainingRulePackDescriptor,
  VolumeProgressionState,
} from "./model";
import { TRAINING_RULE_INPUT_SCHEMA_VERSION } from "./model";

const RULE_IDS: Record<TrainingGoal, string> = {
  hypertrophy: "maxpower.training.hypertrophy",
  strength: "maxpower.training.strength",
  fat_loss_preserve_lean_mass: "maxpower.training.fat_loss_preserve_lean_mass",
};

const SUPPORTED = [
  "unavailable",
  "safety_stop",
  "calibrate_load",
  "hold",
  "add_rep",
  "increase_load",
  "reduce_load",
  "add_set",
  "remove_set",
  "bodyweight_progression",
  "deload_proposal",
  "review_plan",
] as const;

export function createTrainingRulePacks(pins: readonly VersionPin[]): readonly TrainingRulePack[] {
  return (Object.keys(RULE_IDS) as TrainingGoal[]).map((goal) => {
    const id = RULE_IDS[goal];
    const pin = pins.find((candidate) => candidate.id === id);
    const descriptor = descriptorFor(goal, pin);
    return new DeterministicTrainingRulePack(descriptor);
  });
}

function descriptorFor(goal: TrainingGoal, pin: VersionPin | undefined): TrainingRulePackDescriptor {
  const content = {
    id: RULE_IDS[goal],
    goal,
    population: ["healthy_adults", "general_fitness_resistance_training"],
    scope: [
      "performance_progression",
      "volume_progression",
      "bodyweight_progression",
      "planned_and_adaptive_deload",
    ],
    semanticVersion: pin?.semanticVersion ?? "1.0.0",
    schemaVersion: 1 as const,
    requiredEvidence: [
      "exact_comparable_exercise_context",
      "user_confirmed_performed_sets",
      "actual_reps",
    ],
    optionalEvidence: [
      "user_reported_RIR",
      "complete_weekly_direct_sets",
      "independent_recovery_or_schedule_signal",
    ],
    safetyExclusions: [
      "stop_signal",
      "clinical_rehabilitation",
      "competition_peak_or_taper",
      "disease_specific_training",
    ],
    defaults: {
      calibrationRir: { min: 4 as const, max: 5 as const },
      workingRir: { min: 2, max: 4 },
      maxAutomaticLoadIncreasePercent: 10,
      ...(goal === "hypertrophy" ? { conservativeWeeklyDirectSets: 6 } : {}),
    },
    substitutionRanking: substitutionRankingFor(goal),
    unknownHandling: "hold_and_request_minimum_evidence" as const,
    supportedDecisionTypes: SUPPORTED,
  };
  return { ...content, contentHash: pin?.contentHash ?? stableHash(content) };
}

function substitutionRankingFor(goal: TrainingGoal): import("./model").SubstitutionRankingPolicy {
  const common = {
    sameMovement: 100,
    sameMovementPattern: 50,
    sameLoadMode: 20,
    sameStimulusContract: 10,
    exactHistory: 8,
    mastery: 4,
    explicitPreference: 3,
    unknownEquipmentPenalty: -25,
    cameraCapabilityBonus: 1,
    cardioOrLocomotionBonus: 0,
    recoveryActivityBonus: 0,
  } as const;
  if (goal === "strength") return { ...common, sameMovement: 110, sameLoadMode: 30, cardioOrLocomotionBonus: -20 };
  if (goal === "fat_loss_preserve_lean_mass") {
    return { ...common, sameMovement: 90, sameLoadMode: 10, cardioOrLocomotionBonus: 5 };
  }
  return { ...common, cardioOrLocomotionBonus: -10 };
}

class DeterministicTrainingRulePack implements TrainingRulePack {
  constructor(readonly descriptor: TrainingRulePackDescriptor) {}

  evaluate(context: RuleEvaluationContext): RuleDecision {
    if (context.schemaVersion !== TRAINING_RULE_INPUT_SCHEMA_VERSION || context.goal !== this.descriptor.goal) {
      return decision(this.descriptor, context, {
        decision: "unavailable",
        performance: "INSUFFICIENT_EVIDENCE",
        volume: "INSUFFICIENT_EVIDENCE",
        reasonCodes: ["rule_input_schema_or_goal_mismatch"],
        missing: ["compatible_rule_input"],
        confidence: 0,
        requiresConfirmation: true,
        explanation: "规则输入版本或目标不兼容，保持当前训练计划并等待可用规则包。",
      });
    }

    const performance = evaluatePerformance(context);
    const volume = evaluateVolume(context, performance.state);
    const safety = activeSafety(context);
    if (safety.length || performance.state === "STOP_SIGNAL") {
      return decision(this.descriptor, context, {
        decision: "safety_stop",
        performance: "STOP_SIGNAL",
        volume: "HOLD",
        reasonCodes: ["safety_constraint_precedes_progression", ...safety],
        evidenceRefs: performance.evidenceRefs,
        conflicts: safety,
        confidence: 1,
        requiresConfirmation: true,
        explanation: "检测到用户明确停止信号或本地安全约束，暂停自动进阶。",
      });
    }

    if (context.syncConflict) {
      return decision(this.descriptor, context, {
        decision: "hold",
        performance: performance.state,
        volume: "HOLD",
        reasonCodes: ["sync_conflict_freezes_automatic_commit"],
        evidenceRefs: performance.evidenceRefs,
        conflicts: ["sync_conflict"],
        confidence: 0.9,
        requiresConfirmation: true,
        explanation: "存在并发修改，先保留当前训练计划并由用户确认分支。",
      });
    }

    const lowRirConflict =
      context.prescription.targetRir.min < 2 &&
      !(context.stableHistory && context.explicitLowRirPreference && context.exerciseCanSafelyStop);
    if (lowRirConflict) {
      return decision(this.descriptor, context, {
        decision: "hold",
        performance: performance.state,
        volume: volume.state,
        reasonCodes: ["zero_to_one_RIR_requires_stable_history_preference_and_safe_stop"],
        conflicts: ["low_RIR_not_eligible"],
        confidence: 0.95,
        requiresConfirmation: true,
        explanation: "当前证据不足以安排 0–1 RIR，训练计划保持更大的余力。",
        after: { targetRir: this.descriptor.defaults.workingRir },
      });
    }

    if (
      this.descriptor.goal === "strength" &&
      context.requestedLoadingPattern === "light_medium_heavy"
    ) {
      if (!context.stableHistory || performance.state === "INSUFFICIENT_EVIDENCE") {
        return decision(this.descriptor, context, {
          decision: "hold",
          performance: performance.state,
          volume: volume.state,
          reasonCodes: [
            "strength_wave_requires_reliable_history_and_stable_context",
            "new_or_returning_user_keeps_simple_progression",
            "do_not_invent_one_rm_percentage",
          ],
          missing: ["stable_exact_context_history"],
          confidence: 0.9,
          requiresConfirmation: true,
          explanation: "没有可靠负荷历史时保持稳定动作与简单进阶，不生成伪 1RM 百分比。",
        });
      }
      return decision(this.descriptor, context, {
        decision: "review_plan",
        performance: performance.state,
        volume: volume.state,
        reasonCodes: [
          "strength_simple_light_medium_heavy_pattern_eligible",
          "retain_main_exercise_priority",
          "use_confirmed_load_history_not_invented_one_rm",
        ],
        evidenceRefs: performance.evidenceRefs,
        confidence: 0.7,
        requiresConfirmation: true,
        scope: "week",
        change: { variable: "loading_pattern", value: "light_medium_heavy" },
        after: {
          loadingPattern: "simple_light_medium_heavy",
          loadBasis: "confirmed_exact_context_history",
          failureTrainingDefault: false,
        },
        explanation: "稳定历史允许简单轻/中/重暴露变化；主动作优先，负荷锚点仍来自用户确认历史。",
      });
    }

    if (context.plannedRecoveryWindow) {
      return deloadDecision(this.descriptor, context, performance.state, volume.state, "planned_recovery_window");
    }
    if (performance.state === "UNDERPERFORMANCE" && hasIndependentDeloadSupport(context)) {
      return deloadDecision(this.descriptor, context, performance.state, volume.state, "adaptive_deload_repeated_decline_plus_independent_signal");
    }

    if (
      this.descriptor.goal === "fat_loss_preserve_lean_mass" &&
      context.supportSignals.some(
        (signal) => signal.kind === "weight_trend_too_fast" || signal.kind === "energy_availability_concern",
      )
    ) {
      return decision(this.descriptor, context, {
        decision: "review_plan",
        performance: performance.state,
        volume: "HOLD",
        reasonCodes: ["fat_loss_trend_requires_training_and_nutrition_review_not_more_volume"],
        evidenceRefs: collectEvidence(context),
        confidence: 0.7,
        requiresConfirmation: true,
        explanation: "连续趋势提示需要复核训练与营养，不根据单次体重或穿戴消耗增加训练量。",
      });
    }

    if (context.recoveryConstraint === "pause_and_confirm") {
      return decision(this.descriptor, context, {
        decision: "hold",
        performance: performance.state,
        volume: "HOLD",
        reasonCodes: ["recovery_pause_and_confirm"],
        confidence: 0.95,
        requiresConfirmation: true,
        explanation: "恢复约束要求暂停并确认，规则不会自动进阶。",
      });
    }

    if (performance.state === "INSUFFICIENT_EVIDENCE") {
      const exhausted = (context.calibrationAttemptCount ?? 0) >= 3;
      return decision(this.descriptor, context, {
        decision: exhausted ? "hold" : "calibrate_load",
        performance: performance.state,
        volume: volume.state,
        reasonCodes: [
          exhausted ? "calibration_attempt_limit_reached_load_remains_unknown" : "conservative_first_session_calibration",
          "no_population_or_cross_variant_load_guess",
        ],
        evidenceRefs: performance.evidenceRefs,
        missing: performance.missing,
        confidence: exhausted ? 0.4 : 0.55,
        requiresConfirmation: true,
        explanation: exhausted
          ? "有限试做后仍无法定位可靠重量，保持 unknown。"
          : "先用容易停止的动作和轻负荷熟悉组，在 4–5 RIR 处由用户确认实际重量。",
        after: {
          targetLoad: "unknown",
          targetRir: this.descriptor.defaults.calibrationRir,
          oneRmTest: false,
          maxCalibrationIncreases: 3,
        },
      });
    }

    const calibration = calibrationLadder(this.descriptor, context, performance);
    if (calibration) return calibration;

    if (performance.state === "TOO_HARD" || performance.state === "UNDERPERFORMANCE") {
      const reduced = nextLowerLoad(context);
      if (reduced && !context.locks.includes("load")) {
        return decision(this.descriptor, context, {
          decision: "reduce_load",
          performance: performance.state,
          volume: volume.state,
          reasonCodes: ["local_performance_regression", "change_one_primary_variable"],
          evidenceRefs: performance.evidenceRefs,
          confidence: 0.75,
          requiresConfirmation: mandateRequiresConfirmation(context.mandate, "loadReps"),
          scope:
            context.boundary === "between_sets" || context.boundary === "current_set"
              ? "next_unstarted_set"
              : "next_session",
          change: { variable: "load", value: reduced },
          after: { load: reduced },
          explanation: "下一安全边界只回退一个真实器材档位，不改当前正在进行的组。",
        });
      }
      return decision(this.descriptor, context, {
        decision: "review_plan",
        performance: performance.state,
        volume: volume.state,
        reasonCodes: ["repeated_underperformance_requires_review", "load_locked_or_no_lower_equipment_step"],
        evidenceRefs: performance.evidenceRefs,
        conflicts: context.locks.includes("load") ? ["load_locked"] : ["lower_equipment_step_unavailable"],
        confidence: 0.7,
        requiresConfirmation: true,
        explanation: "表现连续下降但无法安全自动回退，生成复核建议而非惩罚性加量。",
      });
    }

    if (performance.state === "TOO_EASY") {
      if (performance.consecutiveTooEasy < 2) {
        return decision(this.descriptor, context, {
          decision: "add_rep",
          performance: performance.state,
          volume: "HOLD",
          reasonCodes: ["first_upper_range_exposure_accumulates_evidence", "reps_before_load"],
          evidenceRefs: performance.evidenceRefs,
          confidence: 0.65,
          requiresConfirmation: mandateRequiresConfirmation(context.mandate, "loadReps"),
          change: { variable: "reps", value: "remain_at_upper_range_for_second_comparable_session" },
          after: { reps: context.prescription.repRange.max },
          explanation: "先在次数上界重复一次可比表现，再考虑最小档位加重。",
        });
      }
      if (context.comparableContext.prescriptionMode === "bodyweight_reps") {
        return bodyweightDecision(this.descriptor, context, volume.state, performance.evidenceRefs);
      }
      return loadIncreaseDecision(this.descriptor, context, volume.state, performance.evidenceRefs);
    }

    if (
      volume.state === "ELIGIBLE_ADD_SET" &&
      this.descriptor.goal === "hypertrophy" &&
      context.recoveryConstraint === "normal"
    ) {
      const allowed = !context.locks.includes("sets") && mandateAllowsWeeklySet(context.mandate);
      return decision(this.descriptor, context, {
        decision: allowed ? "add_set" : "hold",
        performance: performance.state,
        volume: volume.state,
        reasonCodes: [
          allowed ? "two_comparable_exposures_support_one_direct_set" : "set_progression_locked_or_above_mandate",
          "one_muscle_one_direct_set_per_week",
          "no_same_week_load_and_volume_increase",
        ],
        evidenceRefs: [...performance.evidenceRefs, ...(context.volume?.evidenceRefs ?? [])],
        conflicts: allowed ? [] : ["volume_mandate_or_lock"],
        confidence: 0.7,
        requiresConfirmation:
          !allowed || mandateRequiresConfirmation(context.mandate, "volume"),
        scope: "week",
        ...(allowed
          ? {
              change: { variable: "sets" as const, value: context.volume!.plannedDirectSets + 1 },
              after: { directSets: context.volume!.plannedDirectSets + 1 },
            }
          : {}),
        explanation: allowed
          ? "只为一个肌群增加一个直接工作组；支持性泵感或酸痛不会单独触发。"
          : "证据支持加量，但用户锁或授权上限要求保持/确认。",
      });
    }

    if (
      volume.state === "REDUCE_VOLUME" ||
      (this.descriptor.goal === "fat_loss_preserve_lean_mass" && context.recoveryConstraint !== "normal")
    ) {
      const nextSets = Math.max(1, (context.volume?.plannedDirectSets ?? context.prescription.setCount) - 1);
      return decision(this.descriptor, context, {
        decision: "remove_set",
        performance: performance.state,
        volume: "REDUCE_VOLUME",
        reasonCodes: [
          this.descriptor.goal === "fat_loss_preserve_lean_mass"
            ? "preserve_familiar_intensity_remove_low_priority_auxiliary_volume_first"
            : "repeated_unrecovered_or_time_capacity",
          "do_not_convert_to_high_rep_circuit",
        ],
        evidenceRefs: collectEvidence(context),
        confidence: 0.72,
        requiresConfirmation: mandateRequiresConfirmation(context.mandate, "volume"),
        scope: "week",
        change: { variable: "sets", value: nextSets },
        after: { directSets: nextSets },
        explanation: "优先删减一个低优先级直接组并保留熟悉动作与相对强度。",
      });
    }

    return decision(this.descriptor, context, {
      decision: "hold",
      performance: performance.state,
      volume: volume.state,
      reasonCodes: ["on_target_or_conflicting_evidence_hold"],
      evidenceRefs: collectEvidence(context),
      missing: [...performance.missing, ...volume.missing],
      confidence: performance.state === "ON_TARGET" ? 0.75 : 0.55,
      requiresConfirmation: false,
      explanation: "当前证据支持保持；不把单次主观感受或穿戴分数转换成自动加量。",
    });
  }
}

function evaluatePerformance(context: RuleEvaluationContext): {
  state: PerformanceProgressionState;
  consecutiveTooEasy: number;
  evidenceRefs: RuleDecision["evidenceRefs"];
  missing: string[];
} {
  const comparable = context.recentSessions
    .filter((session) => isComparable(session, context))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const evidenceRefs = comparable.flatMap((session) => session.evidenceRefs);
  if (
    context.safetyConstraints.some((item) => item.disposition !== "clear") ||
    comparable.some((session) => session.stopSignals.length)
  ) {
    return { state: "STOP_SIGNAL", consecutiveTooEasy: 0, evidenceRefs, missing: [] };
  }
  const latest = comparable.at(-1);
  if (!latest || latest.partial || latest.sets.length === 0) {
    return {
      state: "INSUFFICIENT_EVIDENCE",
      consecutiveTooEasy: 0,
      evidenceRefs,
      missing: ["complete_comparable_session"],
    };
  }
  const reliableLoad =
    context.comparableContext.prescriptionMode === "bodyweight_reps" ||
    latest.sets.every(
      (set) => set.actualLoad !== undefined && set.actualLoadSource === "user_confirmed",
    );
  const repsComplete = latest.sets.every(
    (set) => set.actualReps !== undefined && set.completed,
  );
  if (!reliableLoad || !repsComplete) {
    return {
      state: "INSUFFICIENT_EVIDENCE",
      consecutiveTooEasy: 0,
      evidenceRefs,
      missing: [
        ...(!reliableLoad ? ["user_confirmed_actual_load"] : []),
        ...(!repsComplete ? ["actual_reps_and_completed_sets"] : []),
      ],
    };
  }
  const belowRange = latest.sets.some(
    (set) => (set.actualReps ?? 0) < context.prescription.repRange.min,
  );
  const rirTooHard = latest.sets.some(
    (set) =>
      set.actualRir !== undefined &&
      set.rirSource === "user_reported" &&
      set.actualRir <= context.prescription.targetRir.min - 2,
  );
  const repeatedDecline = comparable.slice(-2).length === 2 && comparable.slice(-2).every((session) =>
    session.sets.some((set) => (set.actualReps ?? 0) < context.prescription.repRange.min),
  );
  if (repeatedDecline) {
    return { state: "UNDERPERFORMANCE", consecutiveTooEasy: 0, evidenceRefs, missing: [] };
  }
  if (belowRange || rirTooHard) {
    return { state: "TOO_HARD", consecutiveTooEasy: 0, evidenceRefs, missing: [] };
  }
  const isTooEasy = (session: ComparableSessionEvidence): boolean =>
    !session.partial &&
    session.sets.length > 0 &&
    session.sets.every(
      (set) =>
        set.completed &&
        set.actualReps !== undefined &&
        set.actualReps >= context.prescription.repRange.max &&
        set.actualRir !== undefined &&
        set.rirSource === "user_reported" &&
        set.actualRir >= context.prescription.targetRir.min &&
        (context.comparableContext.prescriptionMode === "bodyweight_reps" ||
          (set.actualLoad !== undefined && set.actualLoadSource === "user_confirmed")),
    );
  const consecutiveTooEasy = [...comparable].reverse().findIndex((session) => !isTooEasy(session));
  const count = consecutiveTooEasy === -1 ? comparable.length : consecutiveTooEasy;
  if (isTooEasy(latest)) return { state: "TOO_EASY", consecutiveTooEasy: count, evidenceRefs, missing: [] };
  return {
    state: "ON_TARGET",
    consecutiveTooEasy: 0,
    evidenceRefs,
    missing: latest.sets.some((set) => set.actualRir === undefined || set.rirSource !== "user_reported")
      ? ["user_reported_RIR_for_too_easy_classification"]
      : [],
  };
}

function evaluateVolume(
  context: RuleEvaluationContext,
  performance: PerformanceProgressionState,
): { state: VolumeProgressionState; missing: string[] } {
  const volume = context.volume;
  if (!volume || !volume.weeklyDataComplete || volume.completedDirectSets < 0) {
    return { state: "INSUFFICIENT_EVIDENCE", missing: ["complete_direct_weekly_set_data"] };
  }
  if (
    volume.repeatedUnrecoveredCount >= 2 ||
    volume.performanceTrend === "declining" ||
    volume.timeCapacityReached
  ) {
    return { state: "REDUCE_VOLUME", missing: [] };
  }
  if (
    volume.comparableExposureCount >= 2 &&
    volume.completedDirectSets >= volume.plannedDirectSets &&
    (performance === "ON_TARGET" || performance === "TOO_EASY") &&
    context.recoveryConstraint === "normal"
  ) {
    return { state: "ELIGIBLE_ADD_SET", missing: [] };
  }
  return { state: "HOLD", missing: [] };
}

function loadIncreaseDecision(
  descriptor: TrainingRulePackDescriptor,
  context: RuleEvaluationContext,
  volume: VolumeProgressionState,
  evidenceRefs: RuleDecision["evidenceRefs"],
): RuleDecision {
  if (context.locks.includes("load")) {
    return decision(descriptor, context, {
      decision: "hold",
      performance: "TOO_EASY",
      volume: "HOLD",
      reasonCodes: ["load_locked", "reps_progression_exhausted"],
      evidenceRefs,
      conflicts: ["load_locked"],
      confidence: 0.85,
      requiresConfirmation: true,
      explanation: "负荷已锁定，保持次数上界并等待用户调整锁。",
    });
  }
  const current = latestConfirmedLoad(context);
  if (!current) {
    return decision(descriptor, context, {
      decision: "hold",
      performance: "INSUFFICIENT_EVIDENCE",
      volume: "HOLD",
      reasonCodes: ["no_user_confirmed_actual_load_no_progression"],
      missing: ["user_confirmed_actual_load"],
      confidence: 0.95,
      requiresConfirmation: true,
      explanation: "没有用户确认的实际重量，不能加重。",
    });
  }
  const maximumPercent = Math.min(
    descriptor.defaults.maxAutomaticLoadIncreasePercent,
    context.mandate.limits?.maxLoadIncreasePercent ?? descriptor.defaults.maxAutomaticLoadIncreasePercent,
  );
  const candidate = smallestHigherLoad(context, current, maximumPercent);
  if (!candidate) {
    return decision(descriptor, context, {
      decision: "hold",
      performance: "TOO_EASY",
      volume: "HOLD",
      reasonCodes: ["available_equipment_step_exceeds_cautious_limit", "do_not_invent_intermediate_load"],
      evidenceRefs,
      conflicts: ["equipment_increment_too_large"],
      confidence: 0.85,
      requiresConfirmation: true,
      explanation: "真实器材的下一档超过自动上限；继续次数表现或由用户选择微负重/平替。",
      alternatives: ["continue_reps_progression", "configure_microload", "propose_adjacent_variant"],
    });
  }
  return decision(descriptor, context, {
    decision: "increase_load",
    performance: "TOO_EASY",
    volume: "HOLD",
    reasonCodes: ["two_comparable_upper_range_sessions", "smallest_available_equipment_step", "reset_reps_to_range_bottom", "change_one_primary_variable"],
    evidenceRefs,
    confidence: 0.82,
    requiresConfirmation: mandateRequiresConfirmation(context.mandate, "loadReps"),
    change: { variable: "load", value: candidate },
    after: { load: candidate, reps: context.prescription.repRange.min },
    explanation: "两次可比表现达到次数上界；只增加一个最小可用档位，并把次数回到范围下部。",
  });
}

function bodyweightDecision(
  descriptor: TrainingRulePackDescriptor,
  context: RuleEvaluationContext,
  volume: VolumeProgressionState,
  evidenceRefs: RuleDecision["evidenceRefs"],
): RuleDecision {
  const bodyweight = context.bodyweight;
  if (!bodyweight || !bodyweight.canSafelyStop || context.locks.includes("exercise")) {
    return decision(descriptor, context, {
      decision: "hold",
      performance: "TOO_EASY",
      volume: "HOLD",
      reasonCodes: ["bodyweight_progression_disabled_without_reviewed_safe_context"],
      evidenceRefs,
      conflicts: [!bodyweight ? "difficulty_graph_missing" : !bodyweight.canSafelyStop ? "unsafe_stop" : "exercise_locked"],
      confidence: 0.9,
      requiresConfirmation: true,
      explanation: "没有可审核、安全且相邻的难度路径，保持当前节点。",
    });
  }
  if (bodyweight.minimumAddedLoad) {
    return decision(descriptor, context, {
      decision: "increase_load",
      performance: "TOO_EASY",
      volume: "HOLD",
      reasonCodes: ["bodyweight_same_node_reps_complete", "configured_minimum_added_load_before_node_change"],
      evidenceRefs,
      confidence: 0.75,
      requiresConfirmation: true,
      change: { variable: "load", value: bodyweight.minimumAddedLoad },
      after: { addedLoad: bodyweight.minimumAddedLoad, reps: context.prescription.repRange.min },
      explanation: "先在同一徒手节点使用用户已配置的最小附加负重，不跨难度节点。",
    });
  }
  const adjacent = bodyweight.graph.edges
    .filter((edge) => edge.from === bodyweight.currentNodeId && edge.direction === "progression")
    .map((edge) => edge.to)
    .find(
      (node) =>
        bodyweight.availableNodeIds.includes(node) &&
        bodyweight.reviewedAdjacentNodeIds.includes(node),
    );
  if (!adjacent) {
    return decision(descriptor, context, {
      decision: "hold",
      performance: "TOO_EASY",
      volume: "HOLD",
      reasonCodes: ["no_reviewed_available_adjacent_bodyweight_node"],
      evidenceRefs,
      confidence: 0.9,
      requiresConfirmation: true,
      explanation: "动作库没有已审核且可用的相邻节点，不自动跨级。",
    });
  }
  return decision(descriptor, context, {
    decision: "bodyweight_progression",
    performance: "TOO_EASY",
    volume: "HOLD",
    reasonCodes: ["single_reviewed_adjacent_node", "new_node_resets_baseline", "no_multi_node_jump"],
    evidenceRefs,
    confidence: 0.72,
    requiresConfirmation: true,
    change: { variable: "exercise_difficulty", value: adjacent },
    after: {
      exerciseVariantId: adjacent,
      targetRir: descriptor.defaults.calibrationRir,
      setCount: Math.max(1, context.prescription.setCount - 1),
      baseline: "new_unknown",
    },
    explanation: "只提议一个已审核相邻节点；新节点回到 4–5 RIR 并建立独立基线。",
  });
}

function deloadDecision(
  descriptor: TrainingRulePackDescriptor,
  context: RuleEvaluationContext,
  performance: PerformanceProgressionState,
  volume: VolumeProgressionState,
  reason: string,
): RuleDecision {
  return decision(descriptor, context, {
    decision: "deload_proposal",
    performance,
    volume,
    reasonCodes: [reason, "retain_familiar_main_technique_exposure", "reduce_sets_and_move_away_from_failure", "do_not_auto_repay_removed_volume", "no_unvalidated_fixed_percentage"],
    evidenceRefs: collectEvidence(context),
    confidence: reason === "planned_recovery_window" ? 0.9 : 0.76,
    requiresConfirmation: mandateRequiresConfirmation(context.mandate, "deload"),
    scope: "week",
    change: {
      variable: "deload_strategy",
      value: {
        reduceWorkingSets: true,
        removeLowPriorityAccessoriesFirst: true,
        increaseRirBuffer: true,
        retainFamiliarMainExercise: true,
      },
    },
    after: {
      strategy: "lower_training_stress_without_unvalidated_fixed_percentage",
      automaticMakeupVolume: false,
    },
    explanation: "建议降低训练压力：先减工作组和辅助动作、远离力竭，同时保留熟悉主项技术暴露。",
  });
}

function decision(
  descriptor: TrainingRulePackDescriptor,
  context: RuleEvaluationContext,
  input: {
    decision: RuleDecision["decision"];
    performance: PerformanceProgressionState;
    volume: VolumeProgressionState;
    reasonCodes: readonly string[];
    evidenceRefs?: RuleDecision["evidenceRefs"];
    missing?: readonly string[];
    conflicts?: readonly string[];
    confidence: number;
    requiresConfirmation: boolean;
    explanation: string;
    scope?: RuleDecision["scope"];
    change?: RuleDecision["change"];
    after?: RuleDecision["after"];
    alternatives?: RuleDecision["alternatives"];
  },
): RuleDecision {
  return {
    decision: input.decision,
    scope: input.scope ?? (context.boundary === "between_sets" || context.boundary === "current_set" ? "next_unstarted_set" : "next_session"),
    states: { performance: input.performance, volume: input.volume },
    reasonCodes: [...new Set(input.reasonCodes)],
    evidenceRefs: dedupeEvidence(input.evidenceRefs ?? []),
    missing: [...new Set(input.missing ?? [])],
    conflicts: [...new Set(input.conflicts ?? [])],
    before: {
      load: context.prescription.load ?? "unknown",
      reps: context.prescription.repRange,
      targetRir: context.prescription.targetRir,
      setCount: context.prescription.setCount,
      exerciseVariantId: context.comparableContext.exerciseVariantId,
    },
    after: input.after ?? {},
    ...(input.change ? { change: input.change } : {}),
    rule: {
      id: descriptor.id,
      semanticVersion: descriptor.semanticVersion,
      contentHash: descriptor.contentHash,
    },
    confidence: input.confidence,
    requiresConfirmation: input.requiresConfirmation,
    reviewBoundary: context.boundary,
    safetyBoundary: descriptor.safetyExclusions,
    explanation: input.explanation,
    ...(input.alternatives ? { alternatives: input.alternatives } : {}),
  };
}

function isComparable(session: ComparableSessionEvidence, context: RuleEvaluationContext): boolean {
  return stableHash(session.context) === stableHash(context.comparableContext);
}

function activeSafety(context: RuleEvaluationContext): string[] {
  return context.safetyConstraints
    .filter((item) => item.disposition !== "clear")
    .flatMap((item) => item.reasons.length ? item.reasons : [item.disposition]);
}

function hasIndependentDeloadSupport(context: RuleEvaluationContext): boolean {
  if (context.recoveryConstraint === "recovery_priority" || context.recoveryConstraint === "pause_and_confirm") return true;
  return context.supportSignals.some((signal) =>
    [
      "multiple_muscles_unrecovered",
      "subjective_fatigue",
      "training_motivation_decline",
      "user_requested",
      "time_constraint",
    ].includes(signal.kind),
  );
}

function collectEvidence(context: RuleEvaluationContext) {
  return dedupeEvidence([
    ...context.recentSessions.flatMap((session) => session.evidenceRefs),
    ...(context.volume?.evidenceRefs ?? []),
    ...context.supportSignals.flatMap((signal) => signal.evidenceRef ? [signal.evidenceRef] : []),
  ]);
}

function dedupeEvidence<T extends { aggregate: string; id: string; revision: number }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.aggregate}:${item.id}:${item.revision}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function latestConfirmedLoad(context: RuleEvaluationContext): MassQuantity | undefined {
  return [...context.recentSessions]
    .filter((session) => isComparable(session, context))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0]
    ?.sets.find((set) => set.actualLoad && set.actualLoadSource === "user_confirmed")
    ?.actualLoad;
}

function smallestHigherLoad(
  context: RuleEvaluationContext,
  current: MassQuantity,
  maximumPercent: number,
): MassQuantity | undefined {
  const currentKg = toKg(current);
  const microloads = (context.equipment.configuredMicroloads ?? []).map((increment) => ({
    value: current.value + convert(increment, current.unit).value,
    unit: current.unit,
  }));
  return [...context.equipment.availableLoads, ...microloads]
    .filter((candidate) => toKg(candidate) > currentKg + 1e-8)
    .filter((candidate) => ((toKg(candidate) - currentKg) / currentKg) * 100 <= maximumPercent + 1e-8)
    .sort((left, right) => toKg(left) - toKg(right))[0];
}

/**
 * 校准阶梯（TP-LOAD-CAL-001 第 4 步）：无可靠负荷历史时的首场试做分支。
 * 只在"无稳定历史 + 处方负荷 unknown + 最近一次可比记录含用户确认负荷与 RIR"时接管；
 * 其余情况返回 undefined，走常规进阶逻辑。
 * - 试做 RIR ≥ 6：充分休息后上调一个器材档位（最多 3 次试做）
 * - 试做 RIR 4–5：接受为首个工作负荷（低置信基线）
 * - 试做 RIR ≤ 3：下调一个档位；无更低档则停止校准并请用户确认
 */
function calibrationLadder(
  descriptor: TrainingRulePackDescriptor,
  context: RuleEvaluationContext,
  performance: {
    state: PerformanceProgressionState;
    evidenceRefs: RuleDecision["evidenceRefs"];
    missing: readonly string[];
  },
): RuleDecision | undefined {
  if (context.stableHistory || context.prescription.load !== undefined) return undefined;
  if (
    performance.state !== "ON_TARGET" &&
    performance.state !== "TOO_EASY" &&
    performance.state !== "TOO_HARD"
  ) {
    return undefined;
  }
  const latest = context.recentSessions
    .filter((session) => isComparable(session, context))
    .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    .at(-1);
  const trial = latest?.sets
    .filter(
      (set) =>
        set.completed &&
        set.actualLoad !== undefined &&
        set.actualLoadSource === "user_confirmed" &&
        set.actualRir !== undefined,
    )
    .at(-1);
  if (!latest || !trial || trial.actualRir === undefined || !trial.actualLoad) return undefined;
  const attempts = context.calibrationAttemptCount ?? 1;
  const rir = trial.actualRir;

  if (rir >= 6) {
    if (attempts >= 3) {
      return decision(descriptor, context, {
        decision: "hold",
        performance: performance.state,
        volume: "HOLD",
        reasonCodes: ["calibration_attempt_limit_reached_load_remains_unknown"],
        evidenceRefs: latest.evidenceRefs,
        confidence: 0.4,
        requiresConfirmation: true,
        after: { targetLoad: "unknown" },
        explanation: "三次试做仍未定位可靠重量，保持 unknown，由用户或教练后续确认。",
      });
    }
    const next = nextHigherLoad(context, trial.actualLoad);
    if (!next || context.locks.includes("load")) {
      return decision(descriptor, context, {
        decision: "hold",
        performance: performance.state,
        volume: "HOLD",
        reasonCodes: ["calibration_trial_rir_above_target", "step_up_unavailable"],
        evidenceRefs: latest.evidenceRefs,
        conflicts: [context.locks.includes("load") ? "load_locked" : "higher_equipment_step_unavailable"],
        confidence: 0.5,
        requiresConfirmation: true,
        explanation: "试做余量充足但没有可用的更高器材档位（或负荷被锁定），保持当前试做重量。",
      });
    }
    return decision(descriptor, context, {
      decision: "increase_load",
      performance: performance.state,
      volume: "HOLD",
      reasonCodes: ["calibration_trial_rir_above_target", "one_equipment_increment_per_trial"],
      evidenceRefs: latest.evidenceRefs,
      confidence: 0.6,
      requiresConfirmation: true,
      change: { variable: "load", value: next.value },
      after: { targetLoad: next, calibrationAttempt: attempts + 1 },
      explanation: `试做仍有 6 次以上余量；充分休息后上调一个器材档位（第 ${attempts + 1}/3 次试做）。`,
    });
  }

  if (rir >= 4) {
    return decision(descriptor, context, {
      decision: "hold",
      performance: performance.state,
      volume: "HOLD",
      reasonCodes: [
        "calibration_accepted_at_target_rir",
        "first_baseline_requires_two_comparable_sessions_before_progression",
      ],
      evidenceRefs: latest.evidenceRefs,
      confidence: 0.6,
      requiresConfirmation: true,
      after: { targetLoad: trial.actualLoad, baseline: "first_working_load_low_confidence" },
      explanation: "试做落在 4–5 RIR，接受为首个工作负荷；这是低置信基线，至少两个可比训练记录后才允许自动进阶。",
    });
  }

  const lower = nextLowerLoad(context);
  if (lower && !context.locks.includes("load")) {
    return decision(descriptor, context, {
      decision: "reduce_load",
      performance: performance.state,
      volume: "HOLD",
      reasonCodes: ["calibration_trial_too_hard_step_down"],
      evidenceRefs: latest.evidenceRefs,
      confidence: 0.65,
      requiresConfirmation: true,
      change: { variable: "load", value: lower.value },
      after: { targetLoad: lower, calibrationAttempt: attempts + 1 },
      explanation: "试做过于吃力（RIR ≤ 3），下调一个器材档位后再试。",
    });
  }
  return decision(descriptor, context, {
    decision: "hold",
    performance: performance.state,
    volume: "HOLD",
    reasonCodes: ["calibration_trial_too_hard_no_lower_step", "stop_and_confirm_with_user"],
    evidenceRefs: latest.evidenceRefs,
    conflicts: [context.locks.includes("load") ? "load_locked" : "lower_equipment_step_unavailable"],
    confidence: 0.5,
    requiresConfirmation: true,
    explanation: "试做过于吃力且没有更低档位可用，停止该校准，请用户确认或选择更容易停止的动作。",
  });
}

function nextHigherLoad(
  context: RuleEvaluationContext,
  current: MassQuantity,
): MassQuantity | undefined {
  const currentKg = toKg(current);
  return [...context.equipment.availableLoads]
    .filter((candidate) => toKg(candidate) > currentKg + 1e-8)
    .sort((left, right) => toKg(left) - toKg(right))[0];
}

function nextLowerLoad(context: RuleEvaluationContext): MassQuantity | undefined {
  const current = latestConfirmedLoad(context);
  if (!current) return undefined;
  const currentKg = toKg(current);
  return [...context.equipment.availableLoads]
    .filter((candidate) => toKg(candidate) < currentKg - 1e-8)
    .sort((left, right) => toKg(right) - toKg(left))[0];
}

function toKg(quantity: MassQuantity): number {
  return quantity.unit === "kg" ? quantity.value : quantity.value * 0.45359237;
}

function convert(quantity: MassQuantity, unit: MassQuantity["unit"]): MassQuantity {
  if (quantity.unit === unit) return quantity;
  return unit === "kg"
    ? { value: quantity.value * 0.45359237, unit }
    : { value: quantity.value / 0.45359237, unit };
}

function mandateRequiresConfirmation(
  mandate: RuleEvaluationContext["mandate"],
  scope: "loadReps" | "volume" | "deload",
): boolean {
  return mandate.mode !== "managed" || mandate.scopes?.[scope] !== "managed_small_step";
}

function mandateAllowsWeeklySet(mandate: RuleEvaluationContext["mandate"]): boolean {
  return (mandate.limits?.maxWeeklySetChange ?? 1) >= 1;
}
