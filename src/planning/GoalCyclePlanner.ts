import type {
  CoachingMandateData,
  DomainAggregateRef,
  EquipmentRequirement,
  ExerciseResolutionData,
  ExerciseSetPrescription,
  ExerciseTaskPrescription,
  GoalAllocationData,
  GoalCycleData,
  MassQuantity,
  MesocycleData,
  PlanRevisionData,
  SessionPrescriptionData,
  StimulusBudgetData,
  StimulusIntentData,
  StimulusSlotData,
  WeekPlanData,
  WeeklyIntentData,
} from "../coach/domain";
import { stableHash } from "../coach/stable";
import { KnowledgePackRegistry } from "../knowledge/KnowledgePackRegistry";
import type {
  ExerciseConstraintState,
  ExerciseVariant,
  MovementPattern,
  StimulusContract,
} from "../knowledge/model";
import type {
  HistoricalPerformance,
  InfeasiblePlan,
  PathForecastScenario,
  PlanDiffEntry,
  PlannerDecision,
  PlannerFacts,
  PlannerManualChoice,
  PlannerRequest,
  PlanProposal,
  ScheduleAvailability,
} from "./model";
import {
  TrainingRulePackRegistry,
  type TrainingRulePackDescriptor,
} from "../training-rules";
import { selectAdaptiveStrategy, type AdaptiveStrategyPlan } from "./adaptiveStrategy";

const DAY_MS = 86_400_000;
const MESOCYCLE_WEEKS = 6;
const MATERIALIZED_WEEKS = 2;
const DEFAULT_TRAINING_DAYS = [1, 3, 5] as const;

export const PLANNER_CONSTRAINT_PRIORITY = [
  "safety_and_professional_directive",
  "goal_mandate_and_user_locks",
  "equipment_location_schedule_and_time",
  "recovery_constraint",
  "mesocycle_and_weekly_stimulus_intent",
  "exercise_performance",
  "preference_continuity_novelty_and_camera_bonus",
] as const;

interface SlotTemplate {
  movementPattern: MovementPattern;
  muscleGroups: readonly string[];
  priority: StimulusIntentData["priority"];
  fatigueIntent: StimulusIntentData["fatigueIntent"];
}

interface PlanningContext {
  request: PlannerRequest;
  facts: PlannerFacts;
  pins: ReturnType<KnowledgePackRegistry["versionPins"]>;
  availableEquipment: ReadonlySet<string>;
  schedule: readonly ScheduleAvailability[];
  history: readonly HistoricalPerformance[];
  missing: string[];
  conflicts: string[];
  reasonCodes: string[];
  trainingRule: TrainingRulePackDescriptor;
  adaptive: AdaptiveStrategyPlan;
}

export class GoalCyclePlanner {
  private readonly trainingRules: TrainingRulePackRegistry;

  constructor(
    private readonly knowledge: KnowledgePackRegistry,
    trainingRules?: TrainingRulePackRegistry,
  ) {
    this.trainingRules = trainingRules ?? new TrainingRulePackRegistry(knowledge.versionPins());
  }

  plan(request: PlannerRequest): PlannerDecision {
    assertPlannerRequest(request);
    const pins = this.knowledge.versionPins();
    const frontier = factFrontier(request.facts);
    const hardFailure = this.evaluateGlobalHardConstraints(request, pins);
    if (hardFailure) return hardFailure;
    const trainingRule = this.trainingRules.current(request.facts.goalContract.value.primaryGoal);
    if (trainingRule.status !== "available") {
      return {
        kind: "infeasible_plan",
        id: `infeasible-${stableHash({ userId: request.facts.userId, reason: trainingRule.reason })}`,
        reasonCodes: ["versioned_training_rule_pack_unavailable", trainingRule.reason],
        suppressedGoals: [request.facts.goalContract.value.primaryGoal],
        hardConflicts: ["compatible_training_rule_pack_required"],
        minimumRelaxations: [],
        evidenceRefs: factEvidence(request.facts),
        knowledgePins: pins,
      };
    }

    const context = this.context(request, pins, trainingRule.pack.descriptor);
    const goalCycle = this.buildGoalCycle(context, frontier);
    if (
      request.trigger === "session_completed" &&
      (request.consecutiveDeviationCount ?? 0) < 2 &&
      request.facts.priorPlan
    ) {
      const confidence = clamp(
        0.35 + (context.history.length ? 0.2 : 0) + (context.facts.recoveryConstraints.length ? 0.1 : 0),
        0.2,
        0.8,
      );
      return {
        kind: "no_change",
        reasonCodes: ["single_session_outcome_updates_forecast_only"],
        factFrontier: frontier,
        forecastUpdate: {
          scenarios: forecastScenarios(request, goalCycle, confidence),
          reviewKind: reviewKind(request.currentDate, goalCycle),
          shouldProposeAdjustment: false,
        },
      };
    }
    const planRevision = this.materializeNearTerm(context, goalCycle);
    const unresolved = planRevision.sessions.flatMap((session) =>
      (session.stimulusSlots ?? []).filter((slot) => slot.exerciseSlot.status === "unresolved"),
    );
    if (unresolved.length) {
      return this.infeasible(context, [
        "no_exercise_satisfies_hard_constraints",
        ...unresolved.map((slot) => `unresolved:${slot.intent.movementPattern}`),
      ]);
    }

    const diff = computeDiff(request.facts.priorPlan?.value, planRevision, context.reasonCodes);
    if (request.facts.priorPlan && diff.length === 0) {
      return { kind: "no_change", reasonCodes: ["typed_diff_empty"], factFrontier: frontier };
    }

    return this.proposal(context, frontier, goalCycle, planRevision, diff);
  }

  private context(
    request: PlannerRequest,
    pins: ReturnType<KnowledgePackRegistry["versionPins"]>,
    trainingRule: TrainingRulePackDescriptor,
  ): PlanningContext {
    const profile = request.facts.profile.value;
    const selectedEquipment = request.equipmentProfileId
      ? request.facts.equipmentProfiles.find(
          (candidate) => candidate.value.id === request.equipmentProfileId,
        )?.value.equipmentIds
      : undefined;
    const defaultLocation = profile.locations?.[0];
    const availableEquipment = new Set([
      "bodyweight",
      "floor_space",
      "none",
      ...(selectedEquipment ?? defaultLocation?.availableEquipment ?? []),
    ]);
    const schedule = normalizeSchedule(request.schedule, profile);
    const missing: string[] = [];
    if (!request.facts.timeline.length) missing.push("timeline_history");
    if (!request.historicalPerformance?.length) missing.push("exact_variant_load_history");
    if (!request.facts.recoveryConstraints.length) missing.push("current_recovery_constraint");
    if (!request.facts.nutritionStrategies.length) missing.push("nutrition_strategy");
    return {
      request,
      facts: request.facts,
      pins,
      availableEquipment,
      schedule,
      history: [...(request.historicalPerformance ?? deriveHistory(request.facts))],
      missing,
      conflicts: [],
      reasonCodes: [
        `trigger:${request.trigger}`,
        `constraint_priority:${stableHash(PLANNER_CONSTRAINT_PRIORITY)}`,
        "near_term_materialization:current_plus_next_week",
      ],
      trainingRule,
      adaptive: selectAdaptiveStrategy({
        profile,
        goal: request.facts.goalContract.value,
        safety: request.facts.safetyConstraints.map((item) => item.value),
        currentDate: request.currentDate,
        knowledgePins: pins,
      }),
    };
  }

  private evaluateGlobalHardConstraints(
    request: PlannerRequest,
    pins: ReturnType<KnowledgePackRegistry["versionPins"]>,
  ): InfeasiblePlan | undefined {
    const activeSafety = request.facts.safetyConstraints.filter(
      (candidate) =>
        !candidate.value.validUntil || candidate.value.validUntil >= request.currentDate,
    );
    const stop = activeSafety.find(
      (candidate) => candidate.value.disposition === "stop_and_seek_professional_guidance",
    );
    if (stop) {
      return {
        kind: "infeasible_plan",
        id: `infeasible-${stableHash({ userId: request.facts.userId, stop })}`,
        reasonCodes: ["safety_stop"],
        suppressedGoals: [request.facts.goalContract.value.primaryGoal],
        hardConflicts: stop.value.reasons,
        minimumRelaxations: [
          {
            field: "safety_constraint",
            option: "obtain_professional_clearance_or_resolve_stop_signal",
            impact: "planning remains paused; no training session is generated",
          },
        ],
        evidenceRefs: [
          { aggregate: "safety", id: stop.value.id, revision: stop.revision },
        ],
        knowledgePins: pins,
      };
    }

    const profile = request.facts.profile.value;
    if ((profile.schedule?.weeklyFrequency ?? 0) > 0 && normalizeSchedule(request.schedule, profile).length === 0) {
      return {
        kind: "infeasible_plan",
        id: `infeasible-${stableHash({ userId: request.facts.userId, schedule: request.schedule })}`,
        reasonCodes: ["schedule_infeasible"],
        suppressedGoals: [request.facts.goalContract.value.primaryGoal],
        hardConflicts: ["no_day_has_enough_time_for_the_minimum_session"],
        minimumRelaxations: [
          {
            field: "schedule",
            option: "add_one_day_with_at_least_20_minutes",
            impact: "enables a minimum full-body maintenance session",
          },
          {
            field: "session_duration",
            option: "allow_a_20_minute_session",
            impact: "reduces optional stimulus while retaining primary intent",
          },
        ],
        evidenceRefs: factEvidence(request.facts),
        knowledgePins: pins,
      };
    }
    return undefined;
  }

  private buildGoalCycle(
    context: PlanningContext,
    frontier: readonly DomainAggregateRef[],
  ): GoalCycleData {
    const goal = context.facts.goalContract.value;
    const cycleStart = mondayOf(context.request.currentDate);
    const allocations = goalAllocations(goal.primaryGoal, goal.modifiers);
    const stimulusBudget = goalStimulusBudget(goal.primaryGoal);
    const weeklyIntents: WeeklyIntentData[] = Array.from({ length: MESOCYCLE_WEEKS }, (_, index) => {
      const startDate = addDays(cycleStart, index * 7);
      return {
        id: `week-intent-${stableHash({ goal: goal.id, revision: context.facts.goalContract.revision, index })}`,
        ordinal: index + 1,
        startDate,
        endDate: addDays(startDate, 6),
        intent: index === MESOCYCLE_WEEKS - 1 ? "planned_recovery_and_formal_review" : "accumulate_goal_aligned_stimulus",
        materialization: index < MATERIALIZED_WEEKS ? "materialized" : "intent_only",
        stimulusBudget,
      };
    });
    const mesocycle: MesocycleData = {
      id: `mesocycle-${stableHash({ goal: goal.id, revision: context.facts.goalContract.revision, cycleStart })}`,
      ordinal: 1,
      startDate: cycleStart,
      endDate: addDays(cycleStart, MESOCYCLE_WEEKS * 7 - 1),
      intent: goal.primaryGoal,
      weeklyIntents,
      stimulusBudget,
      plannedRecoveryWindow: {
        weekOrdinal: MESOCYCLE_WEEKS,
        intent: "reduce_fatigue_while_retaining_primary_skill_exposure",
      },
      scheduleConstraints: {
        weeklyFrequency: context.schedule.length,
        sessionDurationMinutes: Math.min(
          ...context.schedule.map((entry) => entry.availableMinutes),
        ),
        allowedWeekdays: context.schedule.map((entry) => entry.weekday),
      },
      progressionStrategy: `${goal.primaryGoal}:versioned_rulepack_decides_load_and_volume`,
    };
    return {
      id: `goal-cycle-${stableHash({ goal: goal.id, revision: context.facts.goalContract.revision })}`,
      goalContractRef: {
        kind: "goal_contract",
        id: goal.id,
        revision: context.facts.goalContract.revision,
      },
      intent: `prioritize_${goal.primaryGoal}_without_violating_maintenance_floors`,
      allocations,
      phasePath: [mesocycle],
      successMetrics: goal.successMetrics ?? [],
      forecastAssumptions: [
        "adherence_is_not_guaranteed",
        "future_loads_are_not_fixed_without_exact_variant_history",
        "recovery_and_schedule_changes_may_trigger_a_new_revision",
      ],
      reviewCadence: {
        weekly: true,
        mesocycleEnd: true,
        midCycleRequiresConsecutiveDeviation: 2,
      },
      knowledgePins: context.pins,
      createdFromFactFrontier: frontier,
      strategySelection: context.adaptive.selection,
      appliedPhaseStrategy: context.adaptive.phase,
    };
  }

  private materializeNearTerm(
    context: PlanningContext,
    goalCycle: GoalCycleData,
  ): PlanRevisionData {
    const mesocycle = goalCycle.phasePath?.[0];
    if (!mesocycle) throw new Error("GoalCycle has no Mesocycle");
    const materializedWeeks = mesocycle.weeklyIntents
      .filter((week) => week.materialization === "materialized")
      .map((week) => this.materializeWeek(context, week));
    const sessions = materializedWeeks.flatMap((week) => week.sessions);
    const reasonCodes = [...context.reasonCodes];
    if (context.request.missedSessionDates?.length) {
      reasonCodes.push("missed_sessions_do_not_create_unbounded_debt");
      if (context.request.missedSessionDates.length > context.schedule.length) {
        reasonCodes.push("low_priority_stimulus_removed_for_capacity");
      }
    }
    if (context.facts.recoveryConstraints.some((item) => item.value.level !== "normal")) {
      reasonCodes.push("active_recovery_constraint_applied_after_hard_constraints");
    }
    const planId = context.facts.priorPlan?.value.id ?? `plan-${stableHash(context.facts.userId)}`;
    return {
      id: planId,
      goalContractRef: goalCycle.goalContractRef,
      goalCycleRef: {
        kind: "goal_cycle",
        id: goalCycle.id,
        revision: context.facts.priorGoalCycle?.revision ?? 0,
      },
      baseRevision: context.facts.priorPlan?.revision ?? 0,
      effectiveFrom: context.request.currentDate,
      knowledgePins: context.pins,
      materializedWeeks,
      futureIntentRefs: mesocycle.weeklyIntents
        .filter((week) => week.materialization === "intent_only")
        .map((week) => week.id),
      reasonCodes,
      strategySelection: context.adaptive.selection,
      appliedPhaseStrategy: context.adaptive.phase,
      trainingStrategy: context.adaptive.training,
      nutritionStrategy: context.adaptive.nutrition,
      recoveryStrategy: context.adaptive.recovery,
      explanation: context.adaptive.explanation,
      adaptiveForecasts: context.adaptive.forecasts,
      sessions,
    };
  }

  private materializeWeek(context: PlanningContext, week: WeeklyIntentData): WeekPlanData {
    const sessionByWeekday = new Map(context.schedule.map((item) => [item.weekday, item]));
    let trainingOrdinal = 0;
    const sessions = Array.from({ length: 7 }, (_, dayOffset) => {
      const date = addDays(week.startDate, dayOffset);
      const availability = sessionByWeekday.get(dayOffset + 1);
      if (!availability || date < context.request.currentDate) {
        return this.restSession(context, week, date, date < context.request.currentDate);
      }
      const session = this.trainingSession(context, week, date, availability, trainingOrdinal);
      trainingOrdinal += 1;
      return session;
    });
    return {
      id: `week-plan-${stableHash({ week: week.id, frontier: factFrontier(context.facts) })}`,
      ordinal: week.ordinal,
      startDate: week.startDate,
      endDate: week.endDate,
      sessions,
      stimulusBudget: week.stimulusBudget,
      materializedAt: context.request.currentDate,
    };
  }

  private restSession(
    context: PlanningContext,
    week: WeeklyIntentData,
    date: string,
    elapsed = false,
  ): SessionPrescriptionData {
    return {
      id: `session-${stableHash({ week: week.id, date, kind: "rest" })}`,
      title: elapsed ? "已过日期 · 以 Timeline 为准" : "休息与记录",
      scheduledFor: date,
      knowledgePins: context.pins,
      kind: "rest",
      durationBudget: { value: 0, unit: "minutes" },
      stimulusSlots: [],
      status: "planned",
      tasks: [],
    };
  }

  private trainingSession(
    context: PlanningContext,
    week: WeeklyIntentData,
    date: string,
    availability: ScheduleAvailability,
    ordinal: number,
  ): SessionPrescriptionData {
    const goal = context.facts.goalContract.value.primaryGoal;
    const useCardio = goal === "fat_loss_preserve_lean_mass" && ordinal === context.schedule.length - 1;
    const recovery = strongestRecovery(context.facts);
    const useRecovery = recovery === "recovery_priority" || recovery === "pause_and_confirm";
    const templates = useRecovery
      ? ([{ movementPattern: "recovery", muscleGroups: [], priority: "maintenance", fatigueIntent: "low" }] satisfies SlotTemplate[])
      : useCardio
        ? ([{ movementPattern: "cardio", muscleGroups: ["cardiorespiratory"], priority: "maintenance", fatigueIntent: "low" }] satisfies SlotTemplate[])
        : sessionTemplates(goal, ordinal, isBodyweightOnly(context.availableEquipment));
    const maxSlots = Math.max(1, Math.floor(availability.availableMinutes / 12));
    const boundedTemplates = templates
      .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
      .slice(0, maxSlots);
    if (boundedTemplates.length < templates.length) context.reasonCodes.push("time_capacity_removed_optional_stimulus");
    const slots = boundedTemplates.map((template, slotIndex) =>
      this.resolveStimulusSlot(context, week, date, availability, ordinal, slotIndex, template),
    );
    const tasks = slots.flatMap((slot) =>
      slot.exerciseSlot.exerciseVariantId ? [this.taskForSlot(context, slot)] : [],
    );
    const kind = useRecovery
      ? "recovery"
      : useCardio
        ? "cardio"
        : tasks.some((task) => task.mode === "weighted_reps")
          ? "weighted_reps"
          : "bodyweight_reps";
    return {
      id: `session-${stableHash({ week: week.id, date, ordinal, kind })}`,
      title: useRecovery ? "恢复安排" : useCardio ? "有氧安排" : `${goal} · 训练 ${ordinal + 1}`,
      scheduledFor: date,
      knowledgePins: context.pins,
      kind,
      locationId: availability.locationId,
      durationBudget: { value: availability.availableMinutes, unit: "minutes" },
      stimulusSlots: slots,
      status: "planned",
      tasks,
    };
  }

  private resolveStimulusSlot(
    context: PlanningContext,
    week: WeeklyIntentData,
    date: string,
    availability: ScheduleAvailability,
    sessionOrdinal: number,
    slotIndex: number,
    template: SlotTemplate,
  ): StimulusSlotData {
    const slotId = `stimulus-${stableHash({ week: week.id, date, sessionOrdinal, slotIndex, template })}`;
    const direct = directChoiceFor(context.request.directChoices ?? [], slotId, sessionOrdinal, slotIndex);
    const candidates = this.knowledge.search({ movementPattern: template.movementPattern, limit: 500 });
    const ranked = candidates
      .map((exercise) => this.rankExercise(context, exercise, direct, availability.locationId))
      .filter((candidate) => candidate.hardSatisfied)
      .sort((left, right) => right.score - left.score || left.exercise.id.localeCompare(right.exercise.id));
    const selected = ranked[0];
    if (direct?.scope === "lock" && selected?.exercise.id !== direct.exerciseVariantId) {
      context.conflicts.push(`locked_exercise_unavailable:${direct.exerciseVariantId}`);
      return unresolvedSlot(slotId, template, "locked_exercise_unavailable");
    }
    if (!selected) return unresolvedSlot(slotId, template, "no_hard_constraint_candidate");
    const contract = selected.exercise.stimulusContractIds
      .map((id) => this.knowledge.stimulusContract(id))
      .find((candidate): candidate is StimulusContract => candidate !== undefined);
    const mode = contract?.prescriptionMode ?? modeForExercise(selected.exercise);
    const hasHistory = context.history.some(
      (entry) => entry.exerciseVariantId === selected.exercise.id && entry.confidence === "confirmed",
    );
    const prescription = prescriptionFor(
      mode,
      template.priority,
      strongestRecovery(context.facts),
      hasHistory
        ? Math.round(
            (context.trainingRule.defaults.workingRir.min +
              context.trainingRule.defaults.workingRir.max) /
              2,
          )
        : context.trainingRule.defaults.calibrationRir.max,
      hasHistory,
    );
    const lockedFields = context.facts.mandate.value.locks
      ?.filter((lock) => lock.field === "exercise" || lock.field === "sets" || lock.field === "load")
      .map((lock) => lock.field) ?? [];
    const resolution: ExerciseResolutionData = {
      status: "resolved",
      exerciseVariantId: selected.exercise.id,
      satisfiedContracts: [
        "safety",
        "professional_directive",
        "user_cannot_do",
        "equipment",
        "location",
        "schedule",
        "time",
        "mode",
        ...(contract ? [contract.id] : []),
      ],
      deviatedContracts: selected.deviations,
      requiredEquipment: equipmentIds(selected.exercise.equipment.requirement),
      performanceComparability: context.history.some(
        (entry) => entry.exerciseVariantId === selected.exercise.id && entry.confidence === "confirmed",
      )
        ? "exact_variant"
        : "cold_start",
      coldStart: !context.history.some(
        (entry) => entry.exerciseVariantId === selected.exercise.id && entry.confidence === "confirmed",
      ),
      sessionTimeImpactMinutes: estimateSlotMinutes(prescription.setCount, prescription.rest?.value),
      fatigueImpact: template.fatigueIntent,
      cameraCapability:
        this.knowledge.resolve({ exerciseVariantId: selected.exercise.id, cameraView: "front" }).countPhase ===
        "available"
          ? "available"
          : "manual_only",
      reasonCodes: selected.reasons,
    };
    return { id: slotId, intent: intentFrom(template, mode), prescription, exerciseSlot: resolution, lockedFields };
  }

  private rankExercise(
    context: PlanningContext,
    exercise: ExerciseVariant,
    direct: PlannerManualChoice | undefined,
    locationId: string,
  ): {
    exercise: ExerciseVariant;
    hardSatisfied: boolean;
    score: number;
    deviations: string[];
    reasons: string[];
  } {
    const temporary = context.request.temporaryExerciseAvailability?.find(
      (item) => item.exerciseVariantId === exercise.id,
    );
    const constraints = context.facts.profile.value.exerciseConstraints ?? [];
    const hardUserBlock = constraints.some(
      (constraint) =>
        (constraint.kind === "cannot_do" || constraint.kind === "temporary_unavailable" || constraint.kind === "do_not_recommend") &&
        constraintTargets(constraint, exercise),
    );
    const professionalBlock = (context.facts.profile.value.professionalConstraints ?? []).some(
      (constraint) =>
        constraint.scope.includes("exercise") &&
        mentionsExercise(constraint.instruction, exercise) &&
        /avoid|禁止|不要|不可|stop/i.test(constraint.instruction),
    );
    const location = context.facts.profile.value.locations?.find((item) => item.id === locationId);
    const equipmentOk = equipmentSatisfied(
      exercise.equipment.requirement,
      context.availableEquipment,
      location?.environment,
    );
    const lock = context.facts.mandate.value.locks?.find(
      (candidate) => candidate.field === "exercise" && candidate.scope !== "next_unstarted_set",
    );
    const lockOk = !lock || lock.value === exercise.id;
    const directOk = direct?.scope === "lock" ? direct.exerciseVariantId === exercise.id : true;
    const hardSatisfied =
      !hardUserBlock &&
      !professionalBlock &&
      equipmentOk &&
      lockOk &&
      directOk &&
      temporary?.status !== "unavailable" &&
      temporary?.status !== "busy";
    const exactHistory = context.history.filter(
      (entry) => entry.exerciseVariantId === exercise.id && entry.confidence === "confirmed",
    );
    const disliked = constraints.some(
      (constraint) => constraint.kind === "dislike" && constraintTargets(constraint, exercise),
    );
    const directSelected = direct?.exerciseVariantId === exercise.id;
    const explicitlyPreferred = (context.facts.profile.value.exercisePreferences ?? []).some(
      (preference) => preference.exerciseVariantId === exercise.id,
    );
    const sameLocationHistory = context.facts.timeline.some(
      (event) => event.fact.kind === "training" && event.fact.historicalSet?.exerciseVariantId === exercise.id,
    );
    const score =
      (directSelected ? 10_000 : 0) +
      (explicitlyPreferred ? 250 : 0) +
      (exactHistory.length ? 500 : 0) +
      (sameLocationHistory ? 100 : 0) +
      (exercise.equipment.loadMode === "bodyweight" && locationId.includes("home") ? 40 : 0) -
      (disliked ? 300 : 0) -
      equipmentIds(exercise.equipment.requirement).length;
    return {
      exercise,
      hardSatisfied,
      score,
      deviations: [
        ...(disliked ? ["soft_preference_dislike"] : []),
        ...(exactHistory.length ? [] : ["load_history_cold_start"]),
      ],
      reasons: [
        "hard_filters_passed",
        exactHistory.length ? "exact_variant_continuity" : "cold_start_allowed_without_load_copy",
        directSelected ? `direct_choice:${direct?.scope}` : "goal_and_stimulus_fit",
        ...(explicitlyPreferred ? ["saved_future_preference"] : []),
        "camera_capability_is_bonus_only",
      ],
    };
  }

  private taskForSlot(context: PlanningContext, slot: StimulusSlotData): ExerciseTaskPrescription {
    const exerciseId = slot.exerciseSlot.exerciseVariantId!;
    const exactHistory = [...context.history]
      .filter((entry) => entry.exerciseVariantId === exerciseId && entry.confidence === "confirmed")
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
    const sets: ExerciseSetPrescription[] = Array.from(
      { length: slot.prescription.setCount },
      (_, setIndex) => {
        const base: ExerciseSetPrescription = {
          id: `set-${stableHash({ slot: slot.id, setIndex })}`,
          ...(slot.prescription.repRange ? { targetReps: slot.prescription.repRange } : {}),
          ...(slot.prescription.duration ? { targetDuration: slot.prescription.duration } : {}),
          ...(slot.prescription.distance ? { targetDistance: slot.prescription.distance } : {}),
          ...(slot.prescription.targetRir !== undefined
            ? { targetRir: slot.prescription.targetRir }
            : {}),
          ...(slot.prescription.rest ? { rest: slot.prescription.rest } : {}),
        };
        if (!exactHistory || base.targetReps === undefined) {
          return {
            ...base,
            targetLoadStatus: "unknown",
            calibrationIntent:
              "use_a_conservative_warmup_and_confirm_the_user_reported_load_and_RIR",
          };
        }
        const increment = equipmentIncrement(
          this.knowledge.exerciseVariant(exerciseId)?.equipment.requirement,
        );
        const target = snapToIncrement(exactHistory.load, increment);
        return {
          ...base,
          targetLoad: target,
          targetLoadStatus: "predicted_target",
          targetLoadBasis: {
            source: "exact_variant_history",
            evidenceRef: exactHistory.evidenceRef,
            ...(increment ? { equipmentIncrement: increment } : {}),
            upperBound: exactHistory.load,
            confidence: 0.65,
          },
        };
      },
    );
    return {
      id: `task-${stableHash(slot.id)}`,
      exerciseVariantId: exerciseId,
      stimulusSlotId: slot.id,
      mode: slot.intent.prescriptionMode,
      sets,
    };
  }

  private proposal(
    context: PlanningContext,
    frontier: readonly DomainAggregateRef[],
    goalCycle: GoalCycleData,
    planRevision: PlanRevisionData,
    diff: readonly PlanDiffEntry[],
  ): PlanProposal {
    const executionClass = classifyExecution(
      context.facts.mandate.value,
      context.request.trigger,
      context.conflicts,
    );
    const confidence = clamp(
      0.35 +
        (context.history.length ? 0.2 : 0) +
        (context.facts.recoveryConstraints.length ? 0.1 : 0) +
        (context.request.schedule?.length ? 0.1 : 0),
      0.2,
      0.8,
    );
    const forecasts = forecastScenarios(context.request, goalCycle, confidence);
    const payload = {
      goalCycle,
      planRevision,
      diff,
      frontier,
      pins: context.pins,
      trigger: context.request.trigger,
    };
    return {
      kind: "plan_proposal",
      id: `plan-proposal-${stableHash(payload)}`,
      baseRevisions: frontier,
      goalCycle,
      planRevision,
      diff,
      scope: context.request.requestedScope ?? "future_plan",
      reasonCodes: [...new Set(planRevision.reasonCodes ?? context.reasonCodes)],
      evidenceRefs: factEvidence(context.facts),
      missing: [...new Set(context.missing)],
      conflicts: [...new Set(context.conflicts)],
      knowledgePins: context.pins,
      confidence,
      requiresConfirmation: executionClass === "confirmation_required",
      executionClass,
      expectedReviewAt: addDays(mondayOf(context.request.currentDate), 7),
      forecasts,
      adaptiveForecasts: context.adaptive.forecasts,
      strategySelection: context.adaptive.selection,
      appliedPhaseStrategy: context.adaptive.phase,
      trainingStrategy: context.adaptive.training,
      nutritionStrategy: context.adaptive.nutrition,
      recoveryStrategy: context.adaptive.recovery,
      explanation: context.adaptive.explanation,
    };
  }

  private infeasible(context: PlanningContext, reasons: readonly string[]): InfeasiblePlan {
    const conflict = context.conflicts[0] ?? reasons[0] ?? "unknown_hard_conflict";
    return {
      kind: "infeasible_plan",
      id: `infeasible-${stableHash({ userId: context.facts.userId, reasons, conflict })}`,
      reasonCodes: [...new Set(reasons)],
      suppressedGoals: [context.facts.goalContract.value.primaryGoal],
      hardConflicts: [...new Set([...context.conflicts, conflict])],
      minimumRelaxations: [
        {
          field: conflict.startsWith("locked_exercise") ? "exercise_lock" : "equipment_or_schedule",
          option: conflict.startsWith("locked_exercise")
            ? "unlock_or_choose_an_available_equivalent"
            : "add_required_equipment_or_allow_a_bodyweight_equivalent",
          impact: "may reduce continuity or require cold-start calibration; primary stimulus remains explicit",
        },
      ],
      evidenceRefs: factEvidence(context.facts),
      knowledgePins: context.pins,
    };
  }
}

function goalAllocations(
  primary: GoalAllocationData["goal"],
  modifiers: readonly ("conditioning" | "health")[] | undefined,
): GoalAllocationData[] {
  const secondary = [...new Set(modifiers ?? [])];
  if (!secondary.length) return [{ goal: primary, role: "primary", budgetShare: 1 }];
  const remainder = 0.2;
  return [
    { goal: primary, role: "primary", budgetShare: 1 - remainder },
    ...secondary.map((goal) => ({
      goal,
      role: "secondary" as const,
      budgetShare: remainder / secondary.length,
      maintenanceFloor: "must_not_reduce_primary_goal_stimulus_or_recovery_budget",
    })),
  ];
}

function goalStimulusBudget(goal: GoalAllocationData["goal"]): StimulusBudgetData[] {
  const base: StimulusBudgetData[] = [
    { key: "push", movementPattern: "horizontal_push", targetExposure: 2, priority: "primary" },
    { key: "pull", movementPattern: "horizontal_pull", targetExposure: 2, priority: "primary" },
    { key: "squat", movementPattern: "squat", targetExposure: 1, priority: "primary" },
    { key: "hinge", movementPattern: "hip_hinge", targetExposure: 1, priority: "primary" },
  ];
  if (goal === "strength") return base.map((item) => ({ ...item, targetExposure: item.targetExposure + 1 }));
  if (goal === "fat_loss_preserve_lean_mass") {
    return [
      ...base,
      { key: "conditioning", movementPattern: "cardio", targetExposure: 1, priority: "maintenance" },
    ];
  }
  return [
    ...base,
    { key: "deltoids", muscleGroup: "deltoids", targetExposure: 2, priority: "maintenance" },
    { key: "arms", muscleGroup: "arms", targetExposure: 2, priority: "optional" },
  ];
}

function sessionTemplates(
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass",
  ordinal: number,
  bodyweightOnly: boolean,
): SlotTemplate[] {
  if (bodyweightOnly) {
    const homeRotations: readonly SlotTemplate[][] = [
      [
        { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
        { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "medium" },
        { movementPattern: "core_anti_extension", muscleGroups: ["core"], priority: "maintenance", fatigueIntent: "low" },
      ],
      [
        { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
        { movementPattern: "hip_hinge", muscleGroups: ["glutes", "hamstrings"], priority: "primary", fatigueIntent: "medium" },
        { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
      ],
      [
        { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
        { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "medium" },
        { movementPattern: "core_flexion", muscleGroups: ["core"], priority: "maintenance", fatigueIntent: "low" },
      ],
    ];
    return [...homeRotations[ordinal % homeRotations.length]!];
  }
  const rotations: readonly SlotTemplate[][] = [
    [
      { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "high" },
      { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], priority: "optional", fatigueIntent: "low" },
    ],
    [
      { movementPattern: "vertical_push", muscleGroups: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "hip_hinge", muscleGroups: ["posterior_chain"], priority: "primary", fatigueIntent: "high" },
      { movementPattern: "elbow_extension", muscleGroups: ["triceps"], priority: "optional", fatigueIntent: "low" },
    ],
    [
      { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], priority: "optional", fatigueIntent: "low" },
    ],
  ];
  const selected = [...rotations[ordinal % rotations.length]!];
  if (goal === "strength") return selected.map((item) => ({ ...item, fatigueIntent: item.priority === "primary" ? "high" : item.fatigueIntent }));
  return selected;
}

function isBodyweightOnly(available: ReadonlySet<string>): boolean {
  const weightedEquipment = [
    "full_gym",
    "barbell",
    "weight_plates",
    "dumbbell_pair",
    "kettlebell",
    "cable_stack",
    "resistance_band",
  ];
  return !weightedEquipment.some((item) => available.has(item));
}

function prescriptionFor(
  mode: StimulusIntentData["prescriptionMode"],
  priority: StimulusIntentData["priority"],
  recovery: ReturnType<typeof strongestRecovery>,
  targetRir: number,
  hasHistory: boolean,
) {
  const reduction = recovery === "slight_reduction" ? 1 : recovery === "recovery_priority" || recovery === "pause_and_confirm" ? 2 : 0;
  const requestedSets = priority === "primary" ? 3 : priority === "maintenance" ? 2 : 1;
  const setCount = Math.max(1, Math.min(hasHistory ? requestedSets : 2, requestedSets) - reduction);
  if (mode === "timed") {
    return { setCount: 1, duration: { value: 20, unit: "minutes" as const }, targetRir: undefined, rest: undefined };
  }
  if (mode === "distance") {
    return { setCount: 1, distance: { value: 2, unit: "km" as const }, targetRir: undefined, rest: undefined };
  }
  return {
    setCount,
    repRange: { min: 6, max: 12 },
    targetRir,
    rest: { value: priority === "primary" ? 120 : 75, unit: "seconds" as const },
  };
}

function intentFrom(
  template: SlotTemplate,
  mode: StimulusIntentData["prescriptionMode"],
): StimulusIntentData {
  return {
    movementPattern: template.movementPattern,
    muscleGroups: template.muscleGroups,
    stability: "either",
    prescriptionMode: mode,
    fatigueIntent: template.fatigueIntent,
    priority: template.priority,
  };
}

function unresolvedSlot(
  id: string,
  template: SlotTemplate,
  reason: string,
): StimulusSlotData {
  return {
    id,
    intent: intentFrom(template, template.movementPattern === "cardio" || template.movementPattern === "recovery" ? "timed" : "weighted_reps"),
    prescription: { setCount: 0 },
    exerciseSlot: {
      status: "unresolved",
      satisfiedContracts: [],
      deviatedContracts: [reason],
      requiredEquipment: [],
      performanceComparability: "cold_start",
      coldStart: true,
      sessionTimeImpactMinutes: 0,
      fatigueImpact: template.fatigueIntent,
      cameraCapability: "manual_only",
      reasonCodes: [reason],
    },
    lockedFields: [],
  };
}

function normalizeSchedule(
  provided: readonly ScheduleAvailability[] | undefined,
  profile: PlannerFacts["profile"]["value"],
): ScheduleAvailability[] {
  if (provided) {
    return provided
      .filter((item) => Number.isInteger(item.weekday) && item.weekday >= 1 && item.weekday <= 7)
      .filter((item) => item.availableMinutes >= 20)
      .sort((left, right) => left.weekday - right.weekday);
  }
  const frequency = Math.min(Math.max(profile.schedule?.weeklyFrequency ?? 3, 1), 7);
  const minutes = profile.schedule?.sessionDurationMinutes ?? 45;
  const locationId = profile.locations?.[0]?.id ?? "location-unspecified";
  const preferred = [...DEFAULT_TRAINING_DAYS, 2, 4, 6, 7].slice(0, frequency).sort();
  return preferred.map((weekday) => ({ weekday, availableMinutes: minutes, locationId }));
}

function modeForExercise(exercise: ExerciseVariant): StimulusIntentData["prescriptionMode"] {
  if (exercise.movementPattern === "cardio") return exercise.identity.movement === "walk" ? "distance" : "timed";
  if (exercise.movementPattern === "recovery" || exercise.movementPattern === "mobility") return "timed";
  return exercise.equipment.loadMode === "bodyweight" ? "bodyweight_reps" : "weighted_reps";
}

function equipmentSatisfied(
  requirement: EquipmentRequirement,
  available: ReadonlySet<string>,
  environment?: { space: "small" | "medium" | "large"; noise: "quiet" | "moderate" | "any" },
): boolean {
  if (available.has("full_gym")) return true;
  if (requirement.kind === "unknown") return false;
  if (requirement.kind === "item") return available.has(requirement.id);
  if (requirement.kind === "all") {
    return requirement.items.every((item) => equipmentSatisfied(item, available, environment));
  }
  if (requirement.kind === "any") {
    return requirement.items.some((item) => equipmentSatisfied(item, available, environment));
  }
  if (!environment) return false;
  const spaceRank = { small: 0, medium: 1, large: 2 } as const;
  const noiseRank = { quiet: 0, moderate: 1, any: 2 } as const;
  return (
    spaceRank[environment.space] >= spaceRank[requirement.space] &&
    noiseRank[environment.noise] >= noiseRank[requirement.noise]
  );
}

function equipmentIds(requirement: EquipmentRequirement): string[] {
  if (requirement.kind === "unknown") return [];
  if (requirement.kind === "item") return [requirement.id];
  if (requirement.kind === "all" || requirement.kind === "any") {
    return [...new Set(requirement.items.flatMap(equipmentIds))];
  }
  return [`environment:${requirement.space}:${requirement.noise}:${requirement.floorImpact}`];
}

function equipmentIncrement(
  requirement: EquipmentRequirement | undefined,
): MassQuantity | undefined {
  if (!requirement) return undefined;
  if (requirement.kind === "item") return requirement.loadRange?.increment;
  if (requirement.kind === "all" || requirement.kind === "any") {
    return requirement.items.map(equipmentIncrement).find((item) => item !== undefined);
  }
  return undefined;
}

function snapToIncrement(load: MassQuantity, increment: MassQuantity | undefined): MassQuantity {
  if (!increment || increment.unit !== load.unit || increment.value <= 0) return load;
  return { value: Math.floor(load.value / increment.value) * increment.value, unit: load.unit };
}

function constraintTargets(constraint: ExerciseConstraintState, exercise: ExerciseVariant): boolean {
  const target = constraint as ExerciseConstraintState & {
    exerciseVariantId?: string;
    movementPattern?: MovementPattern;
  };
  return (
    target.exerciseVariantId === exercise.id ||
    target.movementPattern === exercise.movementPattern ||
    (!target.exerciseVariantId &&
      !target.movementPattern &&
      mentionsExercise(
        constraint.kind === "do_not_recommend" ? constraint.reasonCode : constraint.reason ?? "",
        exercise,
      ))
  );
}

function mentionsExercise(text: string, exercise: ExerciseVariant): boolean {
  const normalized = text.toLocaleLowerCase();
  return [exercise.id, exercise.displayName.zh, exercise.displayName.en, ...exercise.aliases].some(
    (candidate) => normalized.includes(candidate.toLocaleLowerCase()),
  );
}

function directChoiceFor(
  choices: readonly PlannerManualChoice[],
  slotId: string,
  sessionOrdinal: number,
  slotIndex: number,
): PlannerManualChoice | undefined {
  return choices.find(
    (choice) =>
      choice.stimulusSlotId === slotId ||
      choice.stimulusSlotId === `session-${sessionOrdinal}:slot-${slotIndex}`,
  );
}

function deriveHistory(facts: PlannerFacts): HistoricalPerformance[] {
  return facts.timeline.flatMap((event) => {
    const set = event.fact.kind === "training" ? event.fact.historicalSet : undefined;
    return set
      ? [
          {
            exerciseVariantId: set.exerciseVariantId,
            occurredAt: event.occurredAt,
            load: set.load,
            reps: set.reps,
            ...(set.rir !== undefined ? { rir: set.rir } : {}),
            confidence: event.fact.confidence,
            evidenceRef: `timeline:${event.eventId}:r${event.revision}`,
          } satisfies HistoricalPerformance,
        ]
      : [];
  });
}

function strongestRecovery(facts: PlannerFacts): "normal" | "slight_reduction" | "recovery_priority" | "pause_and_confirm" {
  const rank = { normal: 0, slight_reduction: 1, recovery_priority: 2, pause_and_confirm: 3 } as const;
  return facts.recoveryConstraints
    .filter((candidate) => candidate.value.validUntil >= new Date(0).toISOString().slice(0, 10))
    .map((candidate) => candidate.value.level)
    .sort((left, right) => rank[right] - rank[left])[0] ?? "normal";
}

function classifyExecution(
  mandate: CoachingMandateData,
  trigger: PlannerRequest["trigger"],
  conflicts: readonly string[],
): PlanProposal["executionClass"] {
  if (conflicts.length || mandate.mode !== "managed") return "confirmation_required";
  if (trigger === "initial_plan" || trigger === "goal_changed" || trigger === "user_requested") {
    return "confirmation_required";
  }
  if (trigger === "session_completed") return "silent_eligible";
  return "notify_with_undo";
}

function computeDiff(
  previous: PlanRevisionData | undefined,
  next: PlanRevisionData,
  reasonCodes: readonly string[],
): PlanDiffEntry[] {
  if (!previous) {
    return [{ path: "plan", before: undefined, after: next, reasonCode: "initial_plan" }];
  }
  const before = comparablePlan(previous);
  const after = comparablePlan(next);
  if (stableHash(before) === stableHash(after)) return [];
  return [
    {
      path: "materialized_weeks",
      before,
      after,
      reasonCode: reasonCodes[0] ?? "planner_trigger",
    },
  ];
}

function comparablePlan(plan: PlanRevisionData) {
  return {
    goalContractRef: plan.goalContractRef,
    goalCycleRef: plan.goalCycleRef,
    materializedWeeks: plan.materializedWeeks,
    futureIntentRefs: plan.futureIntentRefs,
    sessions: plan.sessions,
    knowledgePins: plan.knowledgePins,
  };
}

function forecastScenarios(
  request: PlannerRequest,
  goalCycle: GoalCycleData,
  confidence: number,
): PathForecastScenario[] {
  const mesocycle = goalCycle.phasePath?.[0];
  const reviewDate = mesocycle?.endDate ?? addDays(request.currentDate, 41);
  const coverage = clamp(
    (request.historicalPerformance?.length ? 0.35 : 0.1) +
      (request.facts.timeline.length ? 0.25 : 0) +
      (request.facts.recoveryConstraints.length ? 0.2 : 0) +
      (request.schedule?.length ? 0.2 : 0),
    0,
    1,
  );
  return ([
    ["conservative", -0.15, "assumes_lower_adherence_or_more_recovery_constraints"],
    ["base", 0, "assumes_planned_adherence_and_stable_constraints"],
    ["aggressive", 0.1, "assumes_high_adherence_without_safety_or_recovery_tradeoffs"],
  ] as const).map(([scenario, shift, assumption]) => ({
    scenario,
    milestones: [{ reviewDate, description: "formal_mesocycle_review_and_path_reassessment" }],
    assumptions: [assumption, ...(goalCycle.forecastAssumptions ?? [])],
    dataCoverage: coverage,
    confidenceRange: {
      min: clamp(confidence - 0.2 + shift, 0.05, 0.85),
      max: clamp(confidence + 0.1 + shift, 0.1, 0.9),
    },
    deviation: "actual_path_is_recomputed_from_weekly_outcomes_not_promised_by_date",
    disclaimer: "directional_not_guaranteed",
  }));
}

function reviewKind(
  currentDate: string,
  goalCycle: GoalCycleData,
): "session_outcome" | "weekly" | "mesocycle_end" {
  const mesocycleEnd = goalCycle.phasePath?.[0]?.endDate;
  if (mesocycleEnd && currentDate >= mesocycleEnd) return "mesocycle_end";
  const day = new Date(`${currentDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? "weekly" : "session_outcome";
}

function factFrontier(facts: PlannerFacts): DomainAggregateRef[] {
  return [
    { kind: "user_profile", id: facts.profile.value.id, revision: facts.profile.revision },
    { kind: "goal_contract", id: facts.goalContract.value.id, revision: facts.goalContract.revision },
    { kind: "coaching_mandate", id: facts.mandate.value.id, revision: facts.mandate.revision },
    ...facts.safetyConstraints.map((item) => ({ kind: "safety_constraint" as const, id: item.value.id, revision: item.revision })),
    ...facts.equipmentProfiles.map((item) => ({ kind: "equipment_profile" as const, id: item.value.id, revision: item.revision })),
    ...facts.recoveryConstraints.map((item) => ({ kind: "recovery_constraint" as const, id: item.value.id, revision: item.revision })),
    ...facts.nutritionStrategies.map((item) => ({ kind: "nutrition_strategy" as const, id: item.value.id, revision: item.revision })),
    ...(facts.priorGoalCycle ? [{ kind: "goal_cycle" as const, id: facts.priorGoalCycle.value.id, revision: facts.priorGoalCycle.revision }] : []),
    ...(facts.priorPlan ? [{ kind: "plan" as const, id: facts.priorPlan.value.id, revision: facts.priorPlan.revision }] : []),
  ];
}

function factEvidence(facts: PlannerFacts) {
  return factFrontier(facts).map((ref) => ({
    aggregate: aggregateFactKind(ref.kind),
    id: ref.id,
    revision: ref.revision,
  }));
}

function aggregateFactKind(kind: DomainAggregateRef["kind"]): "profile" | "goal" | "mandate" | "safety" | "equipment" | "recovery" | "nutrition" | "plan" {
  switch (kind) {
    case "user_profile": return "profile";
    case "goal_contract": return "goal";
    case "coaching_mandate": return "mandate";
    case "safety_constraint": return "safety";
    case "equipment_profile": return "equipment";
    case "recovery_constraint": return "recovery";
    case "nutrition_strategy": return "nutrition";
    default: return "plan";
  }
}

function priorityRank(priority: SlotTemplate["priority"]): number {
  return priority === "primary" ? 0 : priority === "maintenance" ? 1 : 2;
}

function estimateSlotMinutes(sets: number, restSeconds = 60): number {
  return Math.ceil(sets * (1.25 + restSeconds / 60));
}

function assertPlannerRequest(request: PlannerRequest): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.currentDate)) throw new Error("invalid_current_date");
  if (request.facts.goalContract.value.status === "draft") throw new Error("goal_contract_not_active");
  if (request.facts.goalContract.value.primaryGoal === undefined) throw new Error("primary_goal_required");
}

function mondayOf(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const day = parsed.getUTCDay() || 7;
  parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: string, count: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + count * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
