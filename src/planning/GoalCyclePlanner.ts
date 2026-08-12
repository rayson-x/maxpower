import type {
  CoachingMandateData,
  DomainAggregateRef,
  GoalContractData,
  EquipmentRequirement,
  ExerciseResolutionData,
  PlannedExerciseSet,
  PlannedExerciseTask,
  GoalAllocationData,
  GoalCycleData,
  MassQuantity,
  MesocycleData,
  PlanRevisionData,
  PlannedSessionData,
  StimulusBudgetData,
  StimulusIntentData,
  StimulusSlotData,
  UserProfileData,
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
import { activityFactorFor, estimateTdee } from "./bodyComposition";
import { dailyEnergyBudget, dayActivityFromPlan } from "./dailyEnergyBudget";
import { rotationPositionFromHistory } from "./rotationHistory";
import { estimateTimeToGoal } from "./goalTimeline";
import { tierPersona } from "./personTiering";
import { fuelingAdviceFor } from "./sessionFueling";
import {
  evaluateCoupling,
  glycogenDemandForDay,
  summarizeWeeklyDemand,
  type DayTrainingDemand,
} from "./dietTrainingGraph";
import {
  backfillThinSession,
  capWeeklyVolume,
  directExposuresPerCycle,
  selectSplitRotation,
  sessionTemplateFor,
  setsForSlot,
  simplifyForMinimalCommitment,
  trainingCommitmentTarget,
  weeklyDirectSetTarget,
  weeklyVolumeLedger,
  volumeLedgerFromSessions,
} from "./sessionComposer";

const DAY_MS = 86_400_000;
const DEFAULT_MESOCYCLE_WEEKS = 6;

/** 周期长度由 horizon 推导（4–12 周），无 endDate 时用默认值（TP-MESO-001：不固定 4–8 周）。 */
function mesocycleLengthFor(goal: GoalContractData): number {
  if (!goal.horizon.endDate) return DEFAULT_MESOCYCLE_WEEKS;
  const days = Math.round(
    (Date.parse(goal.horizon.endDate) - Date.parse(goal.horizon.startDate)) / DAY_MS,
  );
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_MESOCYCLE_WEEKS;
  return Math.max(4, Math.min(12, Math.round(days / 7)));
}
const MATERIALIZED_WEEKS = 2;
const DEFAULT_TRAINING_DAYS_BY_FREQUENCY: Readonly<Record<number, readonly number[]>> = {
  1: [3],
  2: [2, 5],
  3: [1, 3, 5],
  4: [1, 3, 5, 7],
  5: [1, 2, 4, 5, 7],
  6: [1, 2, 3, 5, 6, 7],
  7: [1, 2, 3, 4, 5, 6, 7],
};

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
  directMuscles?: readonly string[];
  priority: StimulusIntentData["priority"];
  fatigueIntent: StimulusIntentData["fatigueIntent"];
}

interface PlanningContext {
  request: PlannerRequest;
  facts: PlannerFacts;
  traceCollector: {
    slots: import("./model").PlannerTrace["slots"][number][];
    constraintEvents: string[];
    splitSelection?: import("./model").PlannerTrace["splitSelection"];
  };
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
    // 人群边界先于一切（未成年/孕期）：结构化判定，不生成可确认计划
    const boundary = this.evaluatePopulationBoundary(context);
    if (boundary) return boundary;
    const goalCycle = this.buildGoalCycle(context, frontier);
    let planRevision = this.materializeNearTerm(context, goalCycle);
    const unresolved = planRevision.sessions.flatMap((session) =>
      (session.stimulusSlots ?? []).filter((slot) => slot.exerciseSlot.status === "unresolved"),
    );
    if (unresolved.length) {
      // 局部限制不升级为整份计划不可行：丢弃无候选的 slot 并记录，保留可安全执行的训练。
      // 只有当一份计划里一个可执行动作都不剩时，才真的 infeasible。
      // 例外：用户显式锁定的动作不可用是真冲突——锁是用户的明确指令，
      // 不能静默替换或丢弃，必须回到用户手上解锁。
      const lockConflicts = unresolved.filter((slot) =>
        slot.exerciseSlot.reasonCodes.some((code) => code.includes("locked_exercise_unavailable")),
      );
      if (lockConflicts.length) {
        return this.infeasible(context, [
          "no_exercise_satisfies_hard_constraints",
          ...lockConflicts.map((slot) => `unresolved:${slot.intent.movementPattern}`),
        ]);
      }
      for (const slot of unresolved) {
        context.reasonCodes.push(`slot_dropped_no_candidate_under_hard_constraints:${slot.intent.movementPattern}`);
        context.traceCollector.constraintEvents.push(`slot_dropped_hard_constraint:${slot.intent.movementPattern}`);
      }
      const pruned = pruneUnresolvedSlots(planRevision);
      const remaining = pruned.sessions.reduce((sum, session) => sum + session.tasks.length, 0);
      if (remaining === 0) {
        return this.infeasible(context, [
          "no_exercise_satisfies_hard_constraints",
          ...unresolved.map((slot) => `unresolved:${slot.intent.movementPattern}`),
        ]);
      }
      planRevision = {
        ...pruned,
        reasonCodes: [...new Set([...(pruned.reasonCodes ?? []), ...context.reasonCodes])],
      };
    }

    const diff = computeDiff(request.facts.priorPlan?.value, planRevision, context.reasonCodes);
    if (request.facts.priorPlan && diff.length === 0) {
      // 无实质变化：session_completed 只更新 forecast，不重印计划
      if (request.trigger === "session_completed") {
        const confidence = clamp(
          0.35 + (context.history.length ? 0.2 : 0) + (context.facts.recoveryConstraints.length ? 0.1 : 0),
          0.2,
          0.8,
        );
        return {
          kind: "no_change",
          reasonCodes: ["typed_diff_empty", "single_session_outcome_updates_forecast_only"],
          factFrontier: frontier,
          forecastUpdate: {
            scenarios: forecastScenarios(request, goalCycle, confidence),
            reviewKind: reviewKind(request.currentDate, goalCycle),
            shouldProposeAdjustment: false,
          },
        };
      }
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
    if (!request.historicalPerformance?.length && hasStrengthBaseline(profile)) {
      missing.push("strength_baseline_missing_reps_rir");
    }
    if (!request.facts.recoveryConstraints.length) missing.push("current_recovery_constraint");
    if (!request.facts.nutritionStrategies.length) missing.push("nutrition_strategy");
    // 人口学缺失必须显式（禁止用推测值补齐能量/蛋白绝对量）
    const demographics = profile.demographics;
    if (!demographics?.currentWeight) missing.push("demographics_body_weight");
    if (!demographics?.height) missing.push("demographics_height");
    if (demographics?.ageYears === undefined) missing.push("demographics_age");
    return {
      request,
      facts: request.facts,
      traceCollector: { slots: [], constraintEvents: [] },
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

  /**
   * 结构化人群边界（产品决策 2026-08-11）：
   * 16 岁以下不自动生成计划（转介监护人+专业指导）；16-17 岁允许但保守标记；
   * 孕期不自动生成计划（转介产科）。这些是不可绕过的规划边界，不靠文本匹配。
   */
  private evaluatePopulationBoundary(context: PlanningContext): InfeasiblePlan | undefined {
    const profile = context.facts.profile.value;
    const age = profile.demographics?.ageYears;
    const pregnancy = (profile.professionalConstraints ?? []).some(
      (constraint) => constraint.instruction.includes("孕") || constraint.sourceDescription.includes("孕"),
    );
    if (pregnancy) {
      return {
        kind: "infeasible_plan",
        id: `infeasible-${stableHash({ boundary: "pregnancy", user: context.facts.userId })}`,
        reasonCodes: ["population_boundary_pregnancy_requires_professional_guidance"],
        suppressedGoals: [context.facts.goalContract.value.primaryGoal],
        hardConflicts: ["pregnancy_requires_obstetric_clearance"],
        minimumRelaxations: [{
          field: "professional_clearance",
          option: "obtain_obstetric_clearance_with_written_limits",
          impact: "取得产科许可与限制后可按其限制生成保守计划",
        }],
        evidenceRefs: [],
        knowledgePins: context.pins,
        referral: {
          audience: "obstetric_care_team",
          message: "孕期的训练与营养需要产科医生指导，我不会自动生成计划。可以带着你的目标去咨询，医生给出许可与限制后我再按它安排。",
        },
      };
    }
    if (age !== undefined && age < 16) {
      return {
        kind: "infeasible_plan",
        id: `infeasible-${stableHash({ boundary: "under_16", user: context.facts.userId })}`,
        reasonCodes: ["population_boundary_under_16_requires_guardian_and_professional"],
        suppressedGoals: [context.facts.goalContract.value.primaryGoal],
        hardConflicts: ["under_16_requires_guardian_and_supervision"],
        minimumRelaxations: [{
          field: "supervision",
          option: "guardian_consent_plus_qualified_youth_coach_onsite",
          impact: "监护人同意且有合格教练现场指导时，可另行评估",
        }],
        evidenceRefs: [],
        knowledgePins: context.pins,
        referral: {
          audience: "guardian_and_qualified_youth_coach",
          message: "16 岁以下我不自动生成训练计划。建议由监护人陪同、在合格教练现场指导下开始；我可以解释动作与原则，但不下计划。",
        },
      };
    }
    if (age !== undefined && age < 18) {
      context.reasonCodes.push("minor_conservative_progression_16_to_17");
    }
    return undefined;
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
    // TP-MESO-001：周期长度按 horizon 配置（4–12 周），不固定；TP-DELOAD-001：
    // 只有用户显式选择计划性恢复窗口时才排入，不按"第 N 周"强制 deload。
    const mesocycleWeeks = mesocycleLengthFor(goal);
    const recoveryWindowOrdinal =
      goal.plannedRecoveryEveryWeeks !== undefined
        ? Math.min(Math.max(1, Math.round(goal.plannedRecoveryEveryWeeks)), mesocycleWeeks)
        : undefined;
    const weeklyIntents: WeeklyIntentData[] = Array.from({ length: mesocycleWeeks }, (_, index) => {
      const startDate = addDays(cycleStart, index * 7);
      return {
        id: `week-intent-${stableHash({ goal: goal.id, revision: context.facts.goalContract.revision, index })}`,
        ordinal: index + 1,
        startDate,
        endDate: addDays(startDate, 6),
        intent: index + 1 === recoveryWindowOrdinal ? "planned_recovery_and_formal_review" : "accumulate_goal_aligned_stimulus",
        materialization: index < MATERIALIZED_WEEKS ? "materialized" : "intent_only",
        stimulusBudget,
      };
    });
    const mesocycle: MesocycleData = {
      id: `mesocycle-${stableHash({ goal: goal.id, revision: context.facts.goalContract.revision, cycleStart })}`,
      ordinal: 1,
      startDate: cycleStart,
      endDate: addDays(cycleStart, mesocycleWeeks * 7 - 1),
      intent: goal.primaryGoal,
      weeklyIntents,
      stimulusBudget,
      ...(recoveryWindowOrdinal !== undefined
        ? {
            plannedRecoveryWindow: {
              weekOrdinal: recoveryWindowOrdinal,
              intent: "reduce_fatigue_while_retaining_primary_skill_exposure",
            },
          }
        : {}),
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
    // 专业限制审计（每条医嘱都要在推理链里留痕：应用了/无法机器执行/已过期）
    for (const constraint of context.facts.profile.value.professionalConstraints ?? []) {
      const expired = constraint.validUntil !== undefined && constraint.validUntil < context.request.currentDate;
      const machineActionable = Boolean(
        constraint.restrictedPatterns?.length || constraint.romLimits?.length
          || constraint.lowImpactOnly || constraint.requiresClearance,
      );
      const outcome = expired
        ? "expired"
        : machineActionable
          ? "applied"
          : "not_machine_actionable_needs_structured_intake";
      context.traceCollector.constraintEvents.push(
        `professional_constraint:${constraint.id}:${constraint.scope.join("|")}:${outcome}`,
      );
      if (!expired && !machineActionable) {
        context.reasonCodes.push(`professional_constraint_context_only:${constraint.id}`);
      }
    }
    // 饮食 × 训练供需图（架构见 dietTrainingGraph.ts）：
    // 从计划算训练需求 → 按饮食策略算供给 → 检冲突 → 输出碳水日型与解释
    const coupling = this.evaluateDietTrainingCoupling(context, materializedWeeks);
    // 人群分层（recomp 可行性 / 赤字幅度分档 / 低冲击偏好）
    const tiering = tierPersona(context.facts.profile.value, context.facts.goalContract.value);
    const progressionPolicy = progressionPolicyFor(materializedWeeks);
    context.reasonCodes.push(...tiering.reasonCodes);
    for (const event of coupling?.traceEvents ?? []) {
      context.traceCollector.constraintEvents.push(event);
    }
    const reasonCodes = [...context.reasonCodes, ...(coupling?.reasonCodes ?? [])];
    if (progressionPolicy.phase === "calibration") {
      reasonCodes.push("calibration_phase_active_with_exit_criteria");
    }
    if (context.request.missedSessionDates?.length) {
      reasonCodes.push("missed_sessions_do_not_create_unbounded_debt");
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
      nutritionGuidance: nutritionGuidanceFor(context.facts, context.adaptive.nutrition.energyApproach, tiering),
      recoveryGuidance: recoveryGuidanceFor(context.facts),
      progressionPolicy,
      ...(coupling ? { dietTrainingCoupling: coupling.output } : {}),
      personaTieringNote: tiering.recompNoteZh,
      goalTimeline: estimateTimeToGoal(context.facts.profile.value, context.facts.goalContract.value),
      // 用户视角的滚动 7 天（跨日历周拼接；不参与引擎决策）
      upcomingSevenDays: upcomingSevenDaysFrom(materializedWeeks, context.request.currentDate),
      // 每日能量预算：按日型分解，不给周平均（训练日与休息日差 200-350 kcal）
      dailyEnergyBudgets: dailyEnergyBudgetsFor(
        context,
        upcomingSevenDaysFrom(materializedWeeks, context.request.currentDate),
        nutritionGuidanceFor(context.facts, context.adaptive.nutrition.energyApproach, tiering),
      ),
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

  /**
   * 饮食 × 训练耦合求解（供需图）。
   * 优先级：安全边界 > 用户饮食约束 > 目标所需最小刺激 > 训练最优化。
   * 冲突自动解不了时进 conflicts，由上层做成 trade-off 提案交用户选择。
   */
  private evaluateDietTrainingCoupling(
    context: PlanningContext,
    weeks: readonly WeekPlanData[],
  ): {
    output: NonNullable<PlanRevisionData["dietTrainingCoupling"]>;
    traceEvents: readonly string[];
    reasonCodes: readonly string[];
  } | undefined {
    const declarations = this.knowledge.programStrategies()?.dietStrategies;
    if (!declarations?.length) return undefined;
    const goal = context.facts.goalContract.value.primaryGoal;
    const requestedId = context.facts.goalContract.value.dietStrategyId;
    const strategy =
      declarations.find((item) => item.id === requestedId)
      ?? declarations.find((item) => item.id === defaultDietStrategyId(goal))
      ?? declarations[0]!;

    // 需求侧：逐日从计划内容算糖原需求
    const week = weeks[0];
    const days: DayTrainingDemand[] = (week?.sessions ?? []).map((session) => {
      const slots = session.stimulusSlots ?? [];
      const directSets = slots.reduce((sum, slot) => sum + slot.prescription.setCount, 0);
      const isAerobic = slots.some(
        (slot) => slot.intent.movementPattern === "cardio" || slot.intent.movementPattern === "locomotion",
      );
      const aerobicMinutes = isAerobic ? (session.estimatedDuration?.value ?? 0) : 0;
      const hasHighIntensityWork = slots.some(
        (slot) => slot.intent.priority === "primary" && slot.intent.fatigueIntent === "high",
      );
      return {
        date: session.scheduledFor,
        directSets: isAerobic ? 0 : directSets,
        hasHighIntensityWork,
        aerobicMinutes,
        // 有氧强度分级尚未建模（待办）：当前一律按低强度处理，不虚报高强度
        glycogenDemand: glycogenDemandForDay({
          directSets: isAerobic ? 0 : directSets,
          hasHighIntensityWork,
          aerobicMinutes,
          aerobicIsHighIntensity: false,
        }),
      };
    });
    const demand = summarizeWeeklyDemand(days);
    const result = evaluateCoupling({
      demand,
      strategy,
      goal,
      dietLocked: context.facts.goalContract.value.dietStrategyLocked === true,
    });
    return {
      output: {
        strategyId: strategy.id,
        strategyNameZh: strategy.nameZh,
        goalFit: result.goalFit,
        carbDayTypes: result.carbDayTypes,
        conflicts: result.conflicts.map((conflict) => ({
          ruleId: conflict.ruleId,
          severity: conflict.severity,
          code: conflict.code,
          explanation: conflict.explanation,
          defaultResolution: conflict.resolutions[0]?.description ?? "无自动解法，需用户选择",
        })),
      },
      traceEvents: result.traceEvents,
      reasonCodes: [
        `diet_strategy:${strategy.id}`,
        `diet_goal_fit:${result.goalFit}`,
        ...result.conflicts.map((conflict) => `diet_training_conflict:${conflict.code}`),
      ],
    };
  }

  private materializeWeek(context: PlanningContext, week: WeeklyIntentData): WeekPlanData {
    const sessionByWeekday = new Map(context.schedule.map((item) => [item.weekday, item]));
    // 轮转顺延（用户拍板 2026-08-11）：本周已错过的训练日不跳过内容，
    // 后续训练日的轮转序号前移——胸背腿一轮回，缺席一天整体后移。
    const missedThisWeek = new Set(
      (context.request.missedSessionDates ?? []).filter(
        (date) => date >= week.startDate && date <= week.endDate,
      ),
    );
    // 轮转起点：优先从训练历史推断（用户周一练了腿，周三就该接着排推/拉，
    // 而不是从轮转第一课重来）。推断不出来才回落到 0。
    // 直接算轮转，不能依赖 traceCollector.splitSelection——它要等第一个
    // trainingSession 才写入，materializeWeek 先执行会拿到 undefined（首周因此失效）。
    const strategies = this.knowledge.programStrategies();
    const activeRotation = strategies
      ? selectSplitRotation(strategies, context.schedule.length, context.request.preferredSplitId).rotation
      : undefined;
    const historyPosition = activeRotation
      ? rotationPositionFromHistory({
          facts: context.facts,
          rotation: activeRotation,
          currentDate: context.request.currentDate,
          muscleLookup: (variantId) =>
            this.knowledge
              .exerciseVariant(variantId)
              ?.expectedMuscleAssociation.associations.filter((item) => item.role === "primary_intent")
              .map((item) => item.muscleId),
        })
      : undefined;
    if (historyPosition) {
      context.reasonCodes.push(
        `rotation_resumed_from_history:${historyPosition.matchedDate}:next_${historyPosition.nextSessionIndex}`,
      );
    }
    let trainingOrdinal = historyPosition?.nextSessionIndex ?? 0;
    const sessions = Array.from({ length: 7 }, (_, dayOffset) => {
      const date = addDays(week.startDate, dayOffset);
      const availability = sessionByWeekday.get(dayOffset + 1);
      if (!availability || date < context.request.currentDate) {
        return this.restSession(context, week, date, date < context.request.currentDate);
      }
      const missedBefore = context.facts.goalContract.value.missedSessionPolicy === "shift"
        ? (context.request.missedSessionDates ?? []).filter(
            (missed) => missed >= week.startDate && missed < date,
          ).length
        : 0;
      const effectiveOrdinal = trainingOrdinal - missedBefore;
      const session = this.trainingSession(context, week, date, availability, effectiveOrdinal);
      if (!missedThisWeek.has(date)) trainingOrdinal += 1;
      return session;
    });
    // 有氧：目标需要时安排在非训练日，不占用力量日（验收标准 §1 有氧条）
    const withAerobic = this.injectAerobicSessions(context, week, sessions);
    // 主要肌群完全未覆盖时必须显式标注（器械缺口导致的 0 组不能静默）
    const coverage = volumeLedgerFromSessions(withAerobic);
    for (const muscle of ["chest", "back", "quadriceps"]) {
      if ((coverage[muscle] ?? 0) === 0) {
        context.reasonCodes.push(`muscle_group_uncovered_by_available_equipment:${muscle}`);
      }
    }
    // 周量硬上限：单肌群直接组数不得超过天花板（防 emphasis 等叠加超量）
    const capped = capWeeklyVolume(withAerobic);
    if (capped.cappedMuscles.length) {
      for (const muscle of capped.cappedMuscles) {
        context.reasonCodes.push(`volume_capped_at_weekly_cap:${muscle}`);
      }
    }
    return {
      id: `week-plan-${stableHash({ week: week.id })}`,
      ordinal: week.ordinal,
      startDate: week.startDate,
      endDate: week.endDate,
      sessions: capped.sessions,
      stimulusBudget: week.stimulusBudget,
      materializedAt: context.request.currentDate,
      weeklyDirectSets: volumeLedgerFromSessions(capped.sessions),
    };
  }

  /**
   * 有氧注入（验收标准 §1 有氧条 + WHO 2020 周量基线）。
   * 触发条件：减脂目标、conditioning/health 修饰、或显式有氧承诺 floor。
   * 安排在非训练日，绝不占用力量日；未达 WHO 周量时显式标注而非静默。
   */
  private injectAerobicSessions(
    context: PlanningContext,
    week: WeeklyIntentData,
    sessions: readonly PlannedSessionData[],
  ): readonly PlannedSessionData[] {
    const requirement = aerobicRequirement(context.facts);
    if (!requirement) return sessions;
    const existing = sessions.filter((session) =>
      (session.stimulusSlots ?? []).some((slot) =>
        slot.intent.movementPattern === "cardio" || slot.intent.movementPattern === "locomotion"),
    ).length;
    let toAdd = Math.max(0, requirement.sessionsPerWeek - existing);
    if (toAdd === 0) return sessions;

    // 低冲击约束：跑步/跳跃被硬约束时只给低冲击器械形式
    const lowImpactOnly = (context.facts.profile.value.exerciseConstraints ?? []).some(
      (constraint) =>
        (constraint.kind === "cannot_do" || constraint.kind === "do_not_recommend") &&
        constraint.movementPattern === "locomotion",
    );
    const minutes = Math.max(20, Math.min(45, Math.round(requirement.minutesPerSession)));
    // 从目录里选可执行的有氧变式：器械可行 + 低冲击约束时排除 moderate/high 冲击
    const location = context.facts.profile.value.locations?.[0];
    const aerobicVariant = [
      ...this.knowledge.search({ movementPattern: "cardio", limit: 100 }),
      ...this.knowledge.search({ movementPattern: "locomotion", limit: 100 }),
    ]
      .filter((variant) => variant.status === "active")
      .filter((variant) =>
        equipmentSatisfied(variant.equipment.requirement, context.availableEquipment, location?.environment))
      .filter((variant) => !lowImpactOnly || (variant.impact?.level ?? "low") === "low")
      .sort((left, right) => {
        // 低冲击优先，其次器械要求少者优先（家庭/户外可执行）
        const impactRank = (level?: string) => (level === "high" ? 2 : level === "moderate" ? 1 : 0);
        const byImpact = impactRank(left.impact?.level) - impactRank(right.impact?.level);
        if (byImpact !== 0) return byImpact;
        return equipmentItemIds(left.equipment.requirement).length - equipmentItemIds(right.equipment.requirement).length;
      })[0];
    if (!aerobicVariant) {
      context.reasonCodes.push("aerobic_required_but_no_feasible_modality");
      return sessions;
    }
    // 恢复保护：每周至少保留 1 天完全无结构化安排。
    // 有氧即使是低强度步行，排满 7 天也会压依从性与心理负担（尤其恢复意愿非 high 时）。
    const fillableRestDays = sessions.filter(
      (session) =>
        session.kind === "rest"
        && session.tasks.length === 0
        && session.scheduledFor >= context.request.currentDate,
    ).length;
    if (toAdd >= fillableRestDays && fillableRestDays > 0) {
      toAdd = Math.max(0, fillableRestDays - 1);
      context.reasonCodes.push("aerobic_capped_to_preserve_full_rest_day");
    }
    if (toAdd === 0) {
      // 恢复保护优先于有氧配额，但不足必须显式可见（不静默降级）：
      // 训练日已占满可用日程时，剩余有氧留给用户在力量日后自选。
      if (existing === 0) {
        context.reasonCodes.push("aerobic_below_public_health_baseline_rest_day_priority");
      }
      return sessions;
    }

    const result = sessions.map((session) => {
      if (toAdd === 0) return session;
      const isRest = session.kind === "rest" && session.tasks.length === 0;
      const elapsed = session.scheduledFor < context.request.currentDate;
      if (!isRest || elapsed) return session;
      toAdd -= 1;
      const slotId = `slot-${stableHash({ week: week.id, date: session.scheduledFor, kind: "aerobic" })}`;
      const slot: StimulusSlotData = {
        id: slotId,
        intent: {
          movementPattern: aerobicVariant.movementPattern,
          muscleGroups: ["cardiorespiratory"],
          directMuscles: ["cardiorespiratory"],
          stability: "either",
          prescriptionMode: "timed",
          fatigueIntent: "low",
          priority: "maintenance",
        },
        prescription: { setCount: 1, duration: { value: minutes, unit: "minutes" } },
        lockedFields: [],
        exerciseSlot: {
          status: "resolved",
          exerciseVariantId: aerobicVariant.id,
          satisfiedContracts: ["equipment", "location", "time", "impact_constraint"],
          deviatedContracts: [],
          requiredEquipment: equipmentItemIds(aerobicVariant.equipment.requirement),
          performanceComparability: "cold_start",
          coldStart: true,
          sessionTimeImpactMinutes: minutes,
          fatigueImpact: "low",
          cameraCapability: "manual_only",
          reasonCodes: [
            `aerobic_${requirement.reason}`,
            "moderate_intensity_talk_test",
            ...(lowImpactOnly ? ["low_impact_only_due_to_hard_constraint"] : []),
          ],
        },
      };
      const fueling = fuelingAdviceFor({
        strategies: this.knowledge.programStrategies(),
        workType: "low_intensity_aerobic",
        plannedMinutes: minutes,
        profile: context.facts.profile.value,
      });
      return {
        ...session,
        title: "有氧",
        kind: "cardio" as const,
        ...(fueling
          ? {
              fueling: {
                workType: fueling.workType,
                preferredState: fueling.preferredState,
                acceptableStates: fueling.acceptableStates,
                minMinutesAfterFullMeal: fueling.minMinutesAfterFullMeal,
                minMinutesAfterSnack: fueling.minMinutesAfterSnack,
                rationale: fueling.rationale,
                advantages: fueling.advantages,
                risks: fueling.risks,
                fastedEligible: fueling.fastedEligible,
                ...(fueling.fastedBlockers.length
                  ? {
                      fastedBlockers: fueling.fastedBlockers.map((blocker) => blocker.ruleId),
                      fastedNote: fueling.fastedBlockers
                        .map((blocker) => `${blocker.reason}${blocker.alternative ? ` ${blocker.alternative}` : ""}`)
                        .join(" "),
                    }
                  : {}),
                citations: fueling.citations.map((citation) => ({
                  id: citation.id,
                  tier: citation.tier,
                  label: citation.label,
                  ...(citation.url ? { url: citation.url } : {}),
                  claim: citation.claim,
                })),
              },
            }
          : {}),
        durationBudget: { value: minutes, unit: "minutes" as const },
        estimatedDuration: { value: minutes, unit: "minutes" as const },
        stimulusSlots: [slot],
        tasks: [{
          id: `task-${stableHash(slotId)}`,
          exerciseVariantId: aerobicVariant.id,
          stimulusSlotId: slotId,
          mode: "timed" as const,
          sets: [{
            id: `set-${stableHash({ slot: slotId, setIndex: 0 })}`,
            targetDuration: { value: minutes, unit: "minutes" as const },
          }],
        }],
      };
    });
    if (lowImpactOnly) context.reasonCodes.push("aerobic_low_impact_only_due_to_hard_constraint");
    const plannedMinutes = result
      .filter((session) => session.kind === "cardio")
      .reduce((sum, session) => sum + (session.estimatedDuration?.value ?? 0), 0);
    if (plannedMinutes < 150) {
      context.reasonCodes.push("aerobic_below_public_health_baseline_progressive_start");
    }
    return result;
  }

  private restSession(
    context: PlanningContext,
    week: WeeklyIntentData,
    date: string,
    elapsed = false,
  ): PlannedSessionData {
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
  ): PlannedSessionData {
    const goal = context.facts.goalContract.value.primaryGoal;
    const isDeloadWeek = week.intent === "planned_recovery_and_formal_review";
    // 有氧不再占用力量日（改为安排在非训练日，见 materializeWeek 的 aerobic 注入）
    const useCardio = false;
    const recovery = strongestRecovery(context.facts, context.request.currentDate);
    const useRecovery = recovery === "recovery_priority" || recovery === "pause_and_confirm";
    const strategies = this.knowledge.programStrategies();
    // 每个 slot 的组数由其直接肌群的真实暴露次数决定（不再按 priority 一刀切）
    let setsForTemplate: ((template: SlotTemplate) => number) | undefined;
    let templates: SlotTemplate[];
    if (useRecovery) {
      templates = [{ movementPattern: "recovery", muscleGroups: [], priority: "maintenance", fatigueIntent: "low" }];
    } else if (useCardio) {
      templates = [{ movementPattern: "cardio", muscleGroups: ["cardiorespiratory"], priority: "maintenance", fatigueIntent: "low" }];
    } else if (strategies) {
      // 组装器（ticket 03）：分化轮转 × 周量目标驱动，替代静态模板表
      const selection = selectSplitRotation(strategies, context.schedule.length, context.request.preferredSplitId);
      context.reasonCodes.push(selection.reasonCode);
      context.traceCollector.splitSelection = {
        rotationId: selection.rotation.id,
        exposuresPerWeek: selection.exposuresPerWeek,
        reasonCode: selection.reasonCode,
      };
      const sessionLocation = context.facts.profile.value.locations?.find(
        (item) => item.id === availability.locationId,
      );
      const trainingCommitment = context.facts.goalContract.value.commitmentPreferences?.training;
      if (trainingCommitment === "minimal") {
        context.reasonCodes.push("minimal_commitment_simplified_structure");
        context.traceCollector.constraintEvents.push(`minimal_commitment_simplified:${date}`);
      }
      const slotFeasible = (template: { movementPattern: MovementPattern }) =>
        this.knowledge
          .search({ movementPattern: template.movementPattern, limit: 500 })
          .some(
            (variant) =>
              variant.status === "active" &&
              equipmentSatisfied(variant.equipment.requirement, context.availableEquipment, sessionLocation?.environment),
          );
      templates = sessionTemplateFor(selection.rotation, ordinal).filter((template) => {
        // 器械不可行的 slot 丢弃并记录（如居家无水平拉的徒手变式），不让整份计划 infeasible
        const feasible = this.knowledge
          .search({ movementPattern: template.movementPattern, limit: 500 })
          .some(
            (variant) =>
              variant.status === "active" &&
              equipmentSatisfied(variant.equipment.requirement, context.availableEquipment, sessionLocation?.environment),
          );
        if (!feasible) {
          context.reasonCodes.push(`slot_dropped_no_feasible_variant:${template.movementPattern}`);
          context.traceCollector.constraintEvents.push(`slot_dropped_no_feasible_variant:${template.movementPattern}`);
        }
        return feasible;
      });
      // 单课内容地板：按可用时长决定下限（45 分钟只排 2 个动作是内容不足，
      // 20 分钟排 2 个才是合理的）。器械过滤后不足下限时从同轮转其他课回填可行 slot。
      const sessionMinutes = context.facts.profile.value.schedule?.sessionDurationMinutes ?? 60;
      const minSlotsForDuration = sessionMinutes <= 25 ? 2 : sessionMinutes <= 45 ? 3 : 4;
      const beforeBackfill = templates.length;
      templates = backfillThinSession(templates, selection.rotation, slotFeasible, minSlotsForDuration);
      if (templates.length > beforeBackfill) {
        context.reasonCodes.push("thin_session_backfilled_from_rotation");
      }
      const targetBand = weeklyDirectSetTarget(
        strategies,
        context.facts.profile.value.trainingExperience,
        context.facts.goalContract.value.primaryGoal,
      );
      const baseTarget = trainingCommitmentTarget(targetBand, context.facts.goalContract.value.commitmentPreferences?.training);
      // 局部侧重：emphasis 肌群的周量目标上调一档（其余保持，不挤掉）
      const emphasis = new Set(context.facts.goalContract.value.emphasisMuscles ?? []);
      if (emphasis.size) context.reasonCodes.push("emphasis_muscles_elevated_volume");
      const cyclesPerWeek = context.schedule.length / selection.rotation.sessions.length;
      const rotation = selection.rotation;
      const emphasisExposureBoost = new Set(
        [...emphasis].filter((muscle) => {
          // 只给"直接暴露不足"的 emphasis 肌群补 slot（glutes 只从 hip_hinge 来一次/周）
          const exposures = directExposuresPerCycle(rotation);
          // 周直接暴露 <2.5 次视为不足（恰好 2 次处在边缘，emphasis 肌群应补到明确充足）
          return (exposures[muscle] ?? 0) * cyclesPerWeek < 2.5;
        }),
      );
      setsForTemplate = (template) => {
        const isEmphasis = (template.directMuscles ?? template.muscleGroups).some((muscle) => emphasis.has(muscle));
        const target = isEmphasis ? Math.min(targetBand.max, baseTarget + 2) : baseTarget;
        return setsForSlot(template, target, rotation, cyclesPerWeek);
      };
      // emphasis 肌群直接暴露不足时，在该肌群主项课后追加一个孤立直接 slot
      if (emphasisExposureBoost.size) {
        templates = [...templates];
        const existingPatterns = new Set(templates.map((item) => item.movementPattern));
        for (const muscle of emphasisExposureBoost) {
          const isoPattern = emphasisIsolationPatternFor(muscle);
          // 只在该课完全没有这个模式的 slot 时补，避免叠在主项上导致过量
          if (isoPattern && !existingPatterns.has(isoPattern)) {
            templates.push({
              movementPattern: isoPattern,
              muscleGroups: [muscle],
              directMuscles: [muscle],
              priority: "maintenance",
              fatigueIntent: "low",
            });
            context.reasonCodes.push(`emphasis_added_isolation:${muscle}`);
          }
        }
      }
    } else {
      templates = sessionTemplates(goal, ordinal, isBodyweightOnly(context.availableEquipment));
    }
    const boundedTemplates = templates
      // TP-DELOAD-CONTENT-001：deload 周先删可选/低优先级刺激
      .filter((template) => !isDeloadWeek || template.priority !== "optional")
      .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));
    // ticket 03：时间不强制裁剪——完整推荐 + 预计时长；明显超预算时给档位标记，由用户选择
    if (!useRecovery && !useCardio && strategies) {
      const cost = strategies.setCostModel;
      const estimatedMinutes = cost.warmupMinutes + boundedTemplates.reduce((sum, template, index) => {
        const sets = setsForTemplate
          ? setsForTemplate(template)
          : template.priority === "primary" ? 3 : template.priority === "maintenance" ? 2 : 1;
        const restSeconds = template.fatigueIntent === "high" ? cost.restSecondsByPriority.high_fatigue : cost.restSecondsByPriority[template.priority];
        return sum + sets * (cost.workSetMinutes + restSeconds / 60) + (index > 0 ? cost.transitionMinutesPerSwitch : 0);
      }, 0);
      if (estimatedMinutes > availability.availableMinutes * 1.15) {
        context.reasonCodes.push("time_budget_exceeded_full_plan_kept");
        context.traceCollector.constraintEvents.push(`time_budget_exceeded:${date}`);
      } else if (estimatedMinutes < availability.availableMinutes * 0.7) {
        // 显式标记时长利用不足：周量目标已满足时不硬塞组数，
        // 但必须让用户看到"你报了 N 分钟，本课约 M 分钟"，由用户决定是否加内容。
        context.reasonCodes.push("session_time_under_utilized_volume_target_met");
        context.traceCollector.constraintEvents.push(
          `session_time_under_utilized:${date}:${estimatedMinutes}/${availability.availableMinutes}`,
        );
      }
    }
    const slots = boundedTemplates.map((template, slotIndex) =>
      this.resolveStimulusSlot(context, week, date, availability, ordinal, slotIndex, template, setsForTemplate?.(template)),
    );
    // TP-DELOAD-CONTENT-001：减组、远离力竭、保留主动作技术暴露；不写死固定减幅
    const deloadedSlots = isDeloadWeek
      ? slots.map((slot) => ({
          ...slot,
          prescription: {
            ...slot.prescription,
            setCount: Math.max(1, slot.prescription.setCount - 1),
            ...(slot.prescription.targetRirRange
              ? {
                  targetRirRange: {
                    min: Math.min(6, slot.prescription.targetRirRange.min + 1),
                    max: Math.min(6, slot.prescription.targetRirRange.max + 1),
                  },
                  targetRir: Math.min(6, (slot.prescription.targetRir ?? 2) + 1),
                }
              : {}),
          },
        }))
      : slots;
    const tasks = deloadedSlots.flatMap((slot) =>
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
      estimatedDuration: {
        value: estimateSessionMinutes(deloadedSlots, availability.availableMinutes),
        unit: "minutes",
      },
      stimulusSlots: deloadedSlots,
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
    plannedSetCount?: number,
  ): StimulusSlotData {
    const slotId = `stimulus-${stableHash({ week: week.id, date, sessionOrdinal, slotIndex, template })}`;
    const direct = directChoiceFor(context.request.directChoices ?? [], slotId, sessionOrdinal, slotIndex);
    const candidates = this.knowledge.search({ movementPattern: template.movementPattern, limit: 500 });
    const ranked = candidates
      .map((exercise) => this.rankExercise(context, exercise, direct, availability.locationId, template))
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
    const goal = context.facts.goalContract.value.primaryGoal;
    const hasHistory = context.history.some(
      (entry) => entry.exerciseVariantId === selected.exercise.id && entry.confidence === "confirmed",
    );
    // 负荷有锚点（精确历史 或 用户自报基线）即进入工作区间；
    // 校准区间只用于真正 unknown 的负荷，不应覆盖整份计划（验收标准 §1 RIR 条）。
    const baselineAnchor = strengthBaselineForExercise(context.facts.profile.value, selected.exercise);
    // 只有该动作的精确历史才构成负荷锚点。自报 1RM 缺少次数/RIR 上下文，
    // 只能给校准起点建议（不能伪造精确工作重量，也不能因此跳过校准 RIR）。
    const loadAnchored = hasHistory;
    if (baselineAnchor && !hasHistory) {
      context.reasonCodes.push("calibration_start_suggested_from_user_strength_baseline");
    }
    const prescription = prescriptionFor(
      mode,
      template.priority,
      template,
      goal,
      strongestRecovery(context.facts, context.request.currentDate),
      loadAnchored
        ? context.trainingRule.defaults.workingRir
        : context.trainingRule.defaults.calibrationRir,
      loadAnchored,
      availability.availableMinutes,
      context.request.personalRestTempoSeconds,
      plannedSetCount,
      // 首次暴露保守起点作用于第一周；次周起向周量目标推进（验收标准 L36：
      // 起始周量与熟练度/酸痛/依从性一起渐进，但不得永久化）。
      // deload 周例外：那一周本就该减量，不能借"推进"抬高组数。
      week.ordinal <= 1 || week.intent === "planned_recovery_and_formal_review"
        ? (context.facts.profile.value.trainingExperience === "beginner" ? 2 : 3)
        : Number.MAX_SAFE_INTEGER,
    );
    context.traceCollector.slots.push({
      slotId,
      date,
      movementPattern: template.movementPattern,
      selectedExerciseId: selected.exercise.id,
      selectedScore: selected.score,
      hardFilteredCount: candidates.length - ranked.length,
      dropReasons: selected.reasons,
      setCount: prescription.setCount,
      ...(prescription.repRange ? { repRange: prescription.repRange } : {}),
      ...(prescription.targetRirRange ? { targetRirRange: prescription.targetRirRange } : {}),
      loadStatus: hasHistory ? "anchored" : baselineAnchor ? "calibration" : "unknown",
    });
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
      sessionTimeImpactMinutes: estimateSlotMinutes(prescription),
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
    template: SlotTemplate,
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
    // 专业限制：优先消费结构化字段（restrictedPatterns / lowImpactOnly）；
    // 仅当没有结构化字段时才退回文本匹配（并在 trace 里标为不可机器执行）。
    const professionalConstraints = context.facts.profile.value.professionalConstraints ?? [];
    const professionalBlock = professionalConstraints.some((constraint) => {
      if (constraint.restrictedPatterns?.includes(exercise.movementPattern)) return true;
      if (constraint.lowImpactOnly && (exercise.impact?.level ?? "low") !== "low") return true;
      const structured = Boolean(
        constraint.restrictedPatterns?.length || constraint.romLimits?.length || constraint.lowImpactOnly,
      );
      if (structured) return false;
      return (
        constraint.scope.includes("exercise") &&
        mentionsExercise(constraint.instruction, exercise) &&
        /avoid|禁止|不要|不可|stop/i.test(constraint.instruction)
      );
    });
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
    const strengthBaseline = strengthBaselineForExercise(context.facts.profile.value, exercise);
    // 负荷可测量性：弹力带无法给出绝对负荷，双进阶与周量推进都无从追踪。
    // 器械可用时应优先可测量负荷；"器材条目少者优"只是可执行性的次要 tiebreaker，
    // 不能让弹力带在全套健身房里压过杠铃（真实缺陷，2026-08-11 修）。
    const measurableLoad = ["barbell", "dumbbell", "kettlebell", "machine", "cable"].includes(
      exercise.equipment.loadMode,
    );
    // 目标特异性：力量目标需要竞技动作模式（杠铃三大项及其变式）
    const goalNeedsBarbellSpecificity =
      context.facts.goalContract.value.primaryGoal === "strength" &&
      exercise.equipment.loadMode === "barbell";
    // 主项 slot 必须优先复合动作：孤立动作（飞鸟/侧平举/弯举）不该当主项。
    // 维持/可选 slot 反过来更适合孤立动作（三层架构：主项-辅助-孤立）。
    const mechanic = exercise.mechanic ?? "compound";
    const mechanicFit =
      template.priority === "primary"
        ? (mechanic === "compound" ? 300 : -400)
        : template.priority === "optional"
          ? (mechanic === "isolation" ? 80 : 0)
          : 0;
    const score =
      (directSelected ? 10_000 : 0) +
      mechanicFit +
      (explicitlyPreferred ? 250 : 0) +
      (exactHistory.length ? 500 : 0) +
      (strengthBaseline ? 200 : 0) +
      (goalNeedsBarbellSpecificity ? 200 : 0) +
      (measurableLoad ? 150 : 0) +
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
        ...(strengthBaseline && !exactHistory.length ? ["strength_baseline_missing_set_context"] : []),
      ],
      reasons: [
        "hard_filters_passed",
        `mechanic_${mechanic}_for_${template.priority}_slot`,
        ...(measurableLoad ? ["measurable_load_for_progression"] : ["load_not_measurable_progression_by_reps_only"]),
        ...(goalNeedsBarbellSpecificity ? ["barbell_specificity_for_strength_goal"] : []),
        exactHistory.length ? "exact_variant_continuity" : "cold_start_allowed_without_load_copy",
        ...(strengthBaseline ? ["user_strength_baseline_reference"] : []),
        directSelected ? `direct_choice:${direct?.scope}` : "goal_and_stimulus_fit",
        ...(explicitlyPreferred ? ["saved_future_preference"] : []),
        "camera_capability_is_bonus_only",
      ],
    };
  }

  private taskForSlot(context: PlanningContext, slot: StimulusSlotData): PlannedExerciseTask {
    const exerciseId = slot.exerciseSlot.exerciseVariantId!;
    const exactHistory = [...context.history]
      .filter((entry) => entry.exerciseVariantId === exerciseId && entry.confidence === "confirmed")
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
    const sets: PlannedExerciseSet[] = Array.from(
      { length: slot.prescription.setCount },
      (_, setIndex) => {
        const base: PlannedExerciseSet = {
          id: `set-${stableHash({ slot: slot.id, setIndex })}`,
          ...(slot.prescription.repRange ? { targetReps: slot.prescription.repRange } : {}),
          ...(slot.prescription.duration ? { targetDuration: slot.prescription.duration } : {}),
          ...(slot.prescription.distance ? { targetDistance: slot.prescription.distance } : {}),
          ...(slot.prescription.targetRir !== undefined
            ? { targetRir: slot.prescription.targetRir }
            : {}),
          ...(slot.prescription.targetRirRange
            ? { targetRirRange: slot.prescription.targetRirRange }
            : {}),
          ...(slot.prescription.rest ? { rest: slot.prescription.rest } : {}),
        };
        if (!exactHistory || base.targetReps === undefined) {
          // 用户自填力量基线：给出校准起点建议（负荷状态仍为 unknown，不伪造精确工作重量）
          const variant = this.knowledge.exerciseVariant(exerciseId);
          const baseline = variant
            ? strengthBaselineForExercise(context.facts.profile.value, variant)
            : undefined;
          if (baseline && base.targetReps !== undefined) {
            const increment = equipmentIncrement(variant?.equipment.requirement);
            const suggested = snapToIncrement(
              estimateWorkingLoadFromOneRepMax(baseline, base.targetReps.max),
              increment,
            );
            return {
              ...base,
              targetLoadStatus: "unknown",
              calibrationStartSuggestion: {
                load: suggested,
                basis: "user_reported_strength_baseline",
                evidenceRef: `profile:strength_baseline:${context.facts.profile.value.strengthBaseline?.measuredAt ?? "unknown"}`,
                note: `按你自报的 ${baseline.value}${baseline.unit} 估算的试做起点；第一组做完报次数与 RIR，我再据实调整`,
              },
              calibrationIntent:
                "start_from_the_suggested_calibration_load_then_confirm_reported_reps_and_RIR",
            };
          }
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
      trace: buildPlannerTrace(context, "plan_proposal", planRevision),
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
      { movementPattern: "knee_flexion", muscleGroups: ["hamstrings"], priority: "maintenance", fatigueIntent: "medium" },
      { movementPattern: "shoulder_abduction", muscleGroups: ["lateral_deltoid"], priority: "maintenance", fatigueIntent: "low" },
      { movementPattern: "elbow_flexion", muscleGroups: ["biceps"], priority: "optional", fatigueIntent: "low" },
    ],
    [
      { movementPattern: "vertical_push", muscleGroups: ["deltoids"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "hip_hinge", muscleGroups: ["posterior_chain"], priority: "primary", fatigueIntent: "high" },
      { movementPattern: "lunge", muscleGroups: ["quadriceps", "glutes"], priority: "maintenance", fatigueIntent: "medium" },
      { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "maintenance", fatigueIntent: "medium" },
      { movementPattern: "elbow_extension", muscleGroups: ["triceps"], priority: "optional", fatigueIntent: "low" },
    ],
    [
      { movementPattern: "horizontal_push", muscleGroups: ["chest"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "horizontal_pull", muscleGroups: ["back"], priority: "primary", fatigueIntent: "medium" },
      { movementPattern: "squat", muscleGroups: ["quadriceps", "glutes"], priority: "primary", fatigueIntent: "high" },
      { movementPattern: "hip_hinge", muscleGroups: ["posterior_chain"], priority: "maintenance", fatigueIntent: "medium" },
      { movementPattern: "vertical_pull", muscleGroups: ["back"], priority: "maintenance", fatigueIntent: "medium" },
      { movementPattern: "core_anti_extension", muscleGroups: ["core"], priority: "maintenance", fatigueIntent: "low" },
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
    // 用户粗粒度词汇（见 equipmentConceptCovers）
    "dumbbell",
    "machine",
    "cable",
  ];
  return !weightedEquipment.some((item) => available.has(item));
}


/** 休息建议：有个人实测节奏时在安全带宽内采用；否则用分级默认表。 */
/**
 * 组间休息（产品规则 D 级）。按目标分化：
 * 力量目标的主项需要更长恢复以维持相对负荷（ACSM 2009 建议大重量复合动作 3-5 分钟）；
 * 增肌主项 2-3 分钟；减脂/塑形的孤立动作可较短（代谢压力与时间效率）。
 * 个人实测节奏（rest_tempo_seconds）覆盖默认值，但不低于该优先级的下限。
 */
function restSecondsFor(
  template: SlotTemplate,
  priority: StimulusIntentData["priority"],
  personalRestTempoSeconds?: number,
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass" = "hypertrophy",
): number {
  const byGoal = (() => {
    if (goal === "strength") {
      return template.fatigueIntent === "high" ? 300 : priority === "primary" ? 240 : priority === "maintenance" ? 120 : 90;
    }
    if (goal === "fat_loss_preserve_lean_mass") {
      return template.fatigueIntent === "high" ? 150 : priority === "primary" ? 105 : priority === "maintenance" ? 75 : 60;
    }
    return template.fatigueIntent === "high" ? 180 : priority === "primary" ? 150 : priority === "maintenance" ? 90 : 75;
  })();
  if (personalRestTempoSeconds === undefined) return byGoal;
  const floor = priority === "primary" ? (goal === "strength" ? 120 : 60) : 45;
  return Math.round(Math.min(300, Math.max(floor, personalRestTempoSeconds)));
}

function prescriptionFor(
  mode: StimulusIntentData["prescriptionMode"],
  priority: StimulusIntentData["priority"],
  template: SlotTemplate,
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass",
  recovery: ReturnType<typeof strongestRecovery>,
  targetRirRange: { min: number; max: number },
  hasHistory: boolean,
  availableMinutes: number,
  personalRestTempoSeconds?: number,
  plannedSetCount?: number,
  noHistorySetCap = 2,
) {
  const reduction = recovery === "slight_reduction" ? 1 : recovery === "recovery_priority" || recovery === "pause_and_confirm" ? 2 : 0;
  const requestedSets = plannedSetCount !== undefined
    ? plannedSetCount
    : priority === "primary" ? 3 : priority === "maintenance" ? 2 : 1;
  // 无精确历史的保守起点：新手 2 组；有训练经验/力量基线者 3 组（负荷仍不锚定）
  const setCount = Math.max(1, Math.min(hasHistory ? requestedSets : noHistorySetCap, requestedSets) - reduction);
  // 标量中点仅为旧消费者兼容；区间才是计划的权威语义（TP-RIR-001）。
  const targetRir = Math.round((targetRirRange.min + targetRirRange.max) / 2);
  if (mode === "timed") {
    return {
      setCount: 1,
      duration: {
        value: Math.min(45, Math.max(20, Math.floor(availableMinutes * 0.65))),
        unit: "minutes" as const,
      },
      targetRir: undefined,
      targetRirRange: undefined,
      rest: undefined,
    };
  }
  if (mode === "distance") {
    return { setCount: 1, distance: { value: 2, unit: "km" as const }, targetRir: undefined, targetRirRange: undefined, rest: undefined };
  }
  return {
    setCount,
    repRange: repRangeFor(goal, template, hasHistory),
    targetRir,
    targetRirRange,
    rest: {
      value: restSecondsFor(template, priority, personalRestTempoSeconds, goal),
      unit: "seconds" as const,
    },
  };
}

function repRangeFor(
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass",
  template: SlotTemplate,
  hasHistory: boolean,
): { min: number; max: number } {
  if (template.priority !== "primary" || template.fatigueIntent === "low") return { min: 10, max: 15 };
  if (goal === "strength") return hasHistory ? { min: 4, max: 8 } : { min: 6, max: 10 };
  if (goal === "fat_loss_preserve_lean_mass") return { min: 6, max: 10 };
  return { min: 6, max: 12 };
}

function intentFrom(
  template: SlotTemplate,
  mode: StimulusIntentData["prescriptionMode"],
): StimulusIntentData {
  return {
    movementPattern: template.movementPattern,
    muscleGroups: template.muscleGroups,
    ...(template.directMuscles ? { directMuscles: template.directMuscles } : {}),
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
  const preferred = DEFAULT_TRAINING_DAYS_BY_FREQUENCY[frequency] ?? DEFAULT_TRAINING_DAYS_BY_FREQUENCY[3]!;
  return preferred.map((weekday) => ({ weekday, availableMinutes: minutes, locationId }));
}

function modeForExercise(exercise: ExerciseVariant): StimulusIntentData["prescriptionMode"] {
  if (exercise.movementPattern === "cardio") return exercise.identity.movement === "walk" ? "distance" : "timed";
  if (exercise.movementPattern === "recovery" || exercise.movementPattern === "mobility") return "timed";
  return exercise.equipment.loadMode === "bodyweight" ? "bodyweight_reps" : "weighted_reps";
}

/**
 * 器械概念展开（2026-08-12）：用户词汇 → 目录细粒度 id。
 *
 * 为什么需要：动作目录用细粒度 id（dumbbell_pair / cable_stack / row_machine），
 * 但用户在 onboarding 只会说"我有哑铃""健身房有器械"。此前这些粗粒度概念
 * 匹配不上任何变式，导致有全套器械的用户也只拿到徒手动作（划船/肩推全被丢弃）。
 *
 * 规则是产品映射（D 级），按"用户声明该概念时合理可用的器械"展开。
 */
function equipmentConceptCovers(declared: ReadonlySet<string>, requiredId: string): boolean {
  if (declared.has(requiredId)) return true;
  // "有器械/机械" → 任何机械（后缀规则自维护：目录新增机器自动覆盖）
  if (declared.has("machine") && requiredId.endsWith("_machine")) return true;
  // 哑铃：用户说"哑铃"即指一对
  if (declared.has("dumbbell") && requiredId === "dumbbell_pair") return true;
  // 龙门/拉索
  if (declared.has("cable") && (requiredId === "cable_stack" || requiredId === "cable_attachment")) return true;
  // 杠铃通常连带杠片
  if (declared.has("barbell") && requiredId === "weight_plates") return true;
  // 卧推凳可当可调凳用（保守：反向不成立）
  if (declared.has("bench") && requiredId === "adjustable_bench") return true;
  return false;
}

function equipmentSatisfied(
  requirement: EquipmentRequirement,
  available: ReadonlySet<string>,
  environment?: { space: "small" | "medium" | "large"; noise: "quiet" | "moderate" | "any" },
): boolean {
  if (available.has("full_gym")) return true;
  if (requirement.kind === "unknown") return false;
  if (requirement.kind === "item") return equipmentConceptCovers(available, requirement.id);
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


/**
 * 从用户自报 1RM 保守估算目标次数的工作负荷（产品规则 D 级，不是精确生理换算）。
 * 用 Epley 反解得到理论 nRM，再乘 0.9 保守折扣——自报 1RM 常偏高，
 * 且计划负荷宁低不高（首组确认后由校准阶梯上调）。
 */
function estimateWorkingLoadFromOneRepMax(oneRepMax: MassQuantity, targetReps: number): MassQuantity {
  const reps = Math.max(1, Math.min(20, targetReps));
  const theoretical = oneRepMax.value / (1 + reps / 30);
  return { value: Math.round(theoretical * 0.9 * 10) / 10, unit: oneRepMax.unit };
}

function hasStrengthBaseline(profile: UserProfileData): boolean {
  const baseline = profile.strengthBaseline;
  return Boolean(baseline?.squat || baseline?.benchPress || baseline?.deadlift);
}

function strengthBaselineForExercise(
  profile: UserProfileData,
  exercise: ExerciseVariant,
): MassQuantity | undefined {
  const baseline = profile.strengthBaseline;
  if (!baseline) return undefined;
  if (exercise.identity.movement === "bench_press") return baseline.benchPress;
  if (exercise.identity.movement === "squat") return baseline.squat;
  if (exercise.identity.movement === "deadlift") return baseline.deadlift;
  return undefined;
}

function strongestRecovery(
  facts: PlannerFacts,
  currentDate: string,
): "normal" | "slight_reduction" | "recovery_priority" | "pause_and_confirm" {
  const rank = { normal: 0, slight_reduction: 1, recovery_priority: 2, pause_and_confirm: 3 } as const;
  return facts.recoveryConstraints
    // 过期约束不生效（此前与 1970-01-01 比较导致任何约束永久生效）
    .filter((candidate) => candidate.value.validUntil >= currentDate)
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
    // goalCycle 的 id 由内容哈希决定；revision 是存储 provenance，不参与"计划是否变化"的判定
    goalCycleRef: plan.goalCycleRef
      ? { kind: plan.goalCycleRef.kind, id: plan.goalCycleRef.id }
      : undefined,
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

function estimateSlotMinutes(prescription: StimulusSlotData["prescription"]): number {
  if (prescription.duration) {
    return prescription.duration.unit === "minutes"
      ? Math.ceil(prescription.duration.value)
      : Math.ceil(prescription.duration.value / 60);
  }
  if (prescription.distance) return prescription.distance.unit === "km" ? Math.ceil(prescription.distance.value * 8) : 10;
  const restSeconds = prescription.rest?.unit === "seconds"
    ? prescription.rest.value
    : (prescription.rest?.value ?? 1) * 60;
  return Math.ceil(prescription.setCount * 1.25 + Math.max(0, prescription.setCount - 1) * (restSeconds / 60));
}

function estimateSessionMinutes(slots: readonly StimulusSlotData[], availableMinutes: number): number {
  const resistance = slots.some((slot) => slot.intent.prescriptionMode === "weighted_reps" || slot.intent.prescriptionMode === "bodyweight_reps");
  const preparation = resistance ? 10 : 5;
  const transitions = Math.max(0, slots.length - 1) * 2;
  const planned = preparation + transitions + slots.reduce(
    (sum, slot) => sum + slot.exerciseSlot.sessionTimeImpactMinutes,
    0,
  );
  return Math.min(availableMinutes, Math.ceil(planned));
}

function assertPlannerRequest(request: PlannerRequest): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.currentDate)) throw new Error("invalid_current_date");
  if (request.facts.goalContract.value.status === "draft") throw new Error("goal_contract_not_active");
  if (request.facts.goalContract.value.primaryGoal === undefined) throw new Error("primary_goal_required");
}


/** PlannerTrace 构建（ticket 04）：同一输入指纹必出同一计划，trace 随计划持久化。 */
function buildPlannerTrace(
  context: PlanningContext,
  kind: "plan_proposal" | "no_change" | "infeasible_plan",
  planRevision?: PlanRevisionData,
): import("./model").PlannerTrace {
  const weeklyVolume: Record<string, number> = {};
  for (const week of planRevision?.materializedWeeks ?? []) {
    for (const [muscle, sets] of Object.entries(week.weeklyDirectSets ?? {})) {
      weeklyVolume[muscle] = (weeklyVolume[muscle] ?? 0) + sets;
    }
  }
  return {
    inputFingerprint: stableHash({
      trigger: context.request.trigger,
      currentDate: context.request.currentDate,
      frontier: factFrontier(context.facts),
      history: context.history.map((entry) => entry.evidenceRef),
      pins: context.pins,
    }),
    historySummary: {
      count: context.history.length,
      exerciseIds: [...new Set(context.history.map((entry) => entry.exerciseVariantId))],
    },
    ...(context.traceCollector.splitSelection
      ? { splitSelection: context.traceCollector.splitSelection }
      : {}),
    slots: context.traceCollector.slots,
    constraintEvents: context.traceCollector.constraintEvents,
    weeklyVolume,
    outcome: { kind, reasonCodes: [...context.reasonCodes] },
  };
}


/**
 * 校准/进阶策略（验收标准 §1）：保守起点必须带明确的退出条件与进阶幅度，
 * 防止把校准期永久化。数值取自 ACSM 2009 progression model（超目标 1-2 次 → +2-10%），
 * 标注为产品规则：个人实际进阶速度由实测表现驱动。
 */

/**
 * 剪掉无候选的 slot（硬约束/专业限制导致），保留其余可执行内容。
 * 局部限制不应升级为"整份计划不可行"——那等于因为不能硬拉就不让练。
 */

/**
 * 有氧需求判定（产品规则）：减脂目标、conditioning/health 修饰、或显式有氧 floor。
 * 数值方向来自 WHO 2020（每周 150-300 分钟中等强度）——作为渐进目标而非硬门槛。
 */

/** 从 EquipmentRequirement 树里取出 item id 列表（用于展示与排序）。 */
function equipmentItemIds(requirement: import("../coach/domain").EquipmentRequirement): string[] {
  if (requirement.kind === "item") return [requirement.id];
  if (requirement.kind === "all" || requirement.kind === "any") {
    return requirement.items.flatMap((item: import("../coach/domain").EquipmentRequirement) => equipmentItemIds(item));
  }
  return [];
}

function aerobicRequirement(
  facts: PlannerFacts,
): { sessionsPerWeek: number; minutesPerSession: number; reason: string } | undefined {
  const goal = facts.goalContract.value;
  const modifiers = goal.modifiers ?? [];
  const floorText = (goal.maintenanceFloors ?? []).join(" ");
  const floorAsksAerobic = /有氧|aerobic|cardio|心肺/i.test(floorText);
  if (floorAsksAerobic) {
    return { sessionsPerWeek: 1, minutesPerSession: 30, reason: "explicit_user_aerobic_floor" };
  }
  if (modifiers.includes("conditioning")) {
    return { sessionsPerWeek: 2, minutesPerSession: 30, reason: "conditioning_modifier" };
  }
  if (goal.primaryGoal === "fat_loss_preserve_lean_mass" || modifiers.includes("health")) {
    return { sessionsPerWeek: 1, minutesPerSession: 30, reason: "fat_loss_or_health_goal" };
  }
  return undefined;
}

function pruneUnresolvedSlots(revision: PlanRevisionData): PlanRevisionData {
  const pruneSessions = <T extends { stimulusSlots?: readonly StimulusSlotData[]; tasks: readonly PlannedExerciseTask[] }>(
    sessions: readonly T[],
  ): T[] =>
    sessions.map((session) => {
      const kept = (session.stimulusSlots ?? []).filter((slot) => slot.exerciseSlot.status !== "unresolved");
      const keptIds = new Set(kept.map((slot) => slot.id));
      return {
        ...session,
        ...(session.stimulusSlots ? { stimulusSlots: kept } : {}),
        tasks: session.tasks.filter((task) => !task.stimulusSlotId || keptIds.has(task.stimulusSlotId)),
      };
    });
  const sessions = pruneSessions(revision.sessions);
  const weeks = revision.materializedWeeks?.map((week) => {
    const weekSessions = pruneSessions(week.sessions);
    return { ...week, sessions: weekSessions, weeklyDirectSets: volumeLedgerFromSessions(weekSessions) };
  });
  return { ...revision, sessions, ...(weeks ? { materializedWeeks: weeks } : {}) };
}


/** 目标对应的默认饮食策略（用户未选时）。可被用户显式选择覆盖。 */
/** emphasis 肌群对应的孤立动作模式（用于补直接暴露）。 */
function emphasisIsolationPatternFor(muscle: string): MovementPattern | undefined {
  const map: Record<string, MovementPattern> = {
    glutes: "hip_hinge",           // 髋主导（臀桥/臀推是 hip_hinge 变式）
    deltoids: "shoulder_abduction", // 侧平举
    chest: "horizontal_push",
    back: "horizontal_pull",
    quadriceps: "knee_extension",
    hamstrings: "knee_flexion",
    biceps: "elbow_flexion",
    triceps: "elbow_extension",
  };
  return map[muscle];
}

function defaultDietStrategyId(
  goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass",
): string {
  if (goal === "fat_loss_preserve_lean_mass") return "carb_cycling";
  if (goal === "strength") return "even_carbs";
  return "higher_carb_surplus";
}

function progressionPolicyFor(
  weeks: readonly WeekPlanData[],
): import("../coach/domain").ProgressionPolicyData {
  const sets = weeks.flatMap((week) => week.sessions).flatMap((session) => session.tasks).flatMap((task) => task.sets);
  const anchored = sets.filter((set) => set.targetLoadStatus === "predicted_target").length;
  const calibrating = sets.filter((set) => set.targetLoadStatus === "unknown").length;
  const phase = calibrating > anchored ? "calibration" as const : "working" as const;
  return {
    phase,
    exitCriteria: phase === "calibration"
      ? [
          "该动作完成一次用户确认的组（负荷+次数+RIR 均已记录）",
          "动作在目标次数区间内可稳定完成",
        ]
      : ["已锚定：按双进阶规则推进"],
    progressionRule: "同一负荷下能比目标次数多完成 1-2 次时，先加次数到区间上界；连续两次达上界后加最小器材档（不超过 +10%）",
    maxLoadIncrementPercent: 10,
    ruleVersion: "TP-PERF-001",
  };
}

/**
 * 计划级营养指导。
 * 方向的**唯一真源**是 adaptive 策略的 energyApproach——绝不按主目标重新推导，
 * 否则会出现"恢复维持策略 + 热量赤字文案"这类冲突（验收标准 §2）。
 * 饮食意愿只决定约束强度（记录负担），不决定方向。
 */

/**
 * 营养绝对量（产品规则 D；有体重才给，无体重不推测）。
 *
 * 维持热量：Mifflin-St Jeor × 活动系数（标为估算非测量，需 2-3 周体重趋势校准）。
 * 赤字/盈余按 weeklyRateTarget（%体重/周）换算成每日千卡（1kg 体脂 ≈ 7700 kcal）。
 * 三素分配：蛋白优先（上段）、脂肪下限约 25% 能量、碳水为平衡项。
 * 碳循环绝对量 = 该日型在周总量约束下的分配（不是加量）。
 */
function absoluteNutritionTargets(
  facts: PlannerFacts,
  calorieDirection: "small_surplus" | "maintenance" | "deficit",
  tiering?: ReturnType<typeof tierPersona>,
): Partial<import("../coach/domain").NutritionGuidanceData> {
  const demo = facts.profile.value.demographics;
  const weight = demo?.currentWeight?.value;
  const height = demo?.height?.value;
  const age = demo?.ageYears;
  if (!weight || !height || age === undefined) return {};
  const sex = demo?.sex ?? "male";

  // Mifflin-St Jeor
  const bmr = sex === "female"
    ? 10 * weight + 6.25 * height - 5 * age - 161
    : 10 * weight + 6.25 * height - 5 * age + 5;
  // TDEE：有日常活动水平时用分解法（训练与日常分开算），否则退单系数法
  const tdee = estimateTdee(facts.profile.value);
  const maintenance = tdee?.kcal ?? Math.round(bmr * activityFactorFor(facts.profile.value.schedule?.weeklyFrequency ?? 3));

  // 赤字/盈余换算：周降幅 %体重 → 每日千卡
  let dailyTarget: { min: number; max: number };
  if (calorieDirection === "deficit" && tiering?.weeklyRateTarget) {
    const weeklyDeficitMin = (tiering.weeklyRateTarget.min / 100) * weight * 7700;
    const weeklyDeficitMax = (tiering.weeklyRateTarget.max / 100) * weight * 7700;
    dailyTarget = {
      min: Math.round(maintenance - weeklyDeficitMax / 7),
      max: Math.round(maintenance - weeklyDeficitMin / 7),
    };
  } else if (calorieDirection === "small_surplus") {
    dailyTarget = { min: maintenance, max: Math.round(maintenance + 250) };
  } else {
    dailyTarget = { min: maintenance - 100, max: maintenance + 100 };
  }

  // 三素分配：蛋白上段、脂肪下限 ~25%、碳水为平衡项
  const proteinG = goal2ProteinPerKg(facts.goalContract.value.primaryGoal);
  const proteinMid = weight * ((proteinG.min + proteinG.max) / 2);
  // 脂肪：百分比法在低热量下会压穿营养下限，所以叠加按体重的绝对地板。
  // 依据：减脂期脂肪摄入不应低于约 0.6 g/kg（激素合成与脂溶性维生素吸收），
  // 常规推荐 0.8-1.0 g/kg。产品规则 D 级，方向有文献支撑。
  const fatFloorByEnergy = (dailyTarget.min * 0.25) / 9;
  const fatFloorByWeight = weight * 0.6;
  const fatFloor = Math.round(Math.max(fatFloorByEnergy, fatFloorByWeight));
  const fatCeil = Math.round(Math.max((dailyTarget.max * 0.3) / 9, weight * 0.9));

  // 碳循环各日型（按需供能）：高碳=糖原需求大的训练日，低碳=休息/低强度日
  const carbFor = (kcal: number, protein: number, fat: number, boost: number) =>
    Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4 * boost));
  const fatMid = Math.round((fatFloor + fatCeil) / 2);
  const carbByDayType = {
    high: { min: carbFor(dailyTarget.min, proteinMid, fatMid, 1.15), max: carbFor(dailyTarget.max, proteinMid, fatMid, 1.25) },
    moderate: { min: carbFor(dailyTarget.min, proteinMid, fatMid, 0.95), max: carbFor(dailyTarget.max, proteinMid, fatMid, 1.05) },
    low: { min: carbFor(dailyTarget.min, proteinMid, fatMid, 0.6), max: carbFor(dailyTarget.max, proteinMid, fatMid, 0.75) },
  };

  return {
    maintenanceKcalEstimate: maintenance,
    dailyEnergyTargetKcal: dailyTarget,
    fatGramsPerDay: { min: fatFloor, max: fatCeil },
    carbGramsByDayType: carbByDayType,
  };
}

function goal2ProteinPerKg(goal: "hypertrophy" | "strength" | "fat_loss_preserve_lean_mass"): { min: number; max: number } {
  return goal === "fat_loss_preserve_lean_mass" ? { min: 1.6, max: 2.2 } : { min: 1.4, max: 2.0 };
}


/**
 * 从物化周里取"从 currentDate 起的 7 天"（滚动窗口）。
 *
 * 为什么：materializedWeeks 按日历周组织（周量账本需要固定边界），
 * 但用户周三打开应用时期待看到完整一周，而不是本周剩余 4 天。
 */
function upcomingSevenDaysFrom(
  weeks: readonly import("../coach/domain").WeekPlanData[],
  currentDate: string,
): readonly import("../coach/domain").PlannedSessionData[] {
  const start = currentDate;
  const end = addDays(currentDate, 6);
  return weeks
    .flatMap((week) => week.sessions)
    .filter((session) => session.scheduledFor >= start && session.scheduledFor <= end)
    .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
}


/**
 * 为滚动 7 天逐日算能量预算（严格分解，不用周平均）。
 * 赤字取计划的每日目标与 TDEE 之差的中值；无营养目标时只给消耗不给摄入。
 */
function dailyEnergyBudgetsFor(
  context: PlanningContext,
  days: readonly import("../coach/domain").PlannedSessionData[],
  guidance: import("../coach/domain").NutritionGuidanceData,
): Readonly<Record<string, NonNullable<import("../coach/domain").PlanRevisionData["dailyEnergyBudgets"]>[string]>> | undefined {
  const profile = context.facts.profile.value;
  if (!profile.demographics?.currentWeight || !profile.demographics.height) return undefined;
  // 每日赤字：由维持热量与目标摄入的差推出（保持与营养指导一致）
  const maintenance = guidance.maintenanceKcalEstimate;
  const target = guidance.dailyEnergyTargetKcal;
  const dailyDeficit = maintenance !== undefined && target
    ? Math.round(maintenance - (target.min + target.max) / 2)
    : undefined;

  const result: Record<string, NonNullable<import("../coach/domain").PlanRevisionData["dailyEnergyBudgets"]>[string]> = {};
  for (const day of days) {
    const isCardio = day.kind === "cardio";
    const hasWork = day.tasks.length > 0;
    // 大重量日（主项休息 ≥150s）走 heavy MET，其余中等
    const heavy = (day.stimulusSlots ?? []).some(
      (slot) => slot.intent.priority === "primary" && (slot.prescription.rest?.value ?? 0) >= 150,
    );
    const budget = dailyEnergyBudget({
      profile,
      day: dayActivityFromPlan({
        kind: !hasWork ? "rest" : isCardio ? "cardio" : "strength",
        ...(hasWork ? { minutes: day.estimatedDuration?.value ?? profile.schedule?.sessionDurationMinutes ?? 60 } : {}),
        ...(heavy ? { intensity: "heavy" as const } : {}),
      }),
      ...(dailyDeficit !== undefined ? { dailyDeficitKcal: dailyDeficit } : {}),
    });
    if (budget) {
      result[day.scheduledFor] = {
        bmrKcal: budget.bmrKcal,
        neatKcal: budget.neatKcal,
        eatKcal: budget.eatKcal,
        tefKcal: budget.tefKcal,
        tdeeKcal: budget.tdeeKcal,
        ...(budget.intakeTargetKcal !== undefined ? { intakeTargetKcal: budget.intakeTargetKcal } : {}),
        uncertaintyKcal: budget.uncertaintyKcal,
      };
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function nutritionGuidanceFor(
  facts: PlannerFacts,
  energyApproach: import("./adaptiveStrategy").PlanningNutritionStrategy["energyApproach"],
  tiering?: ReturnType<typeof tierPersona>,
): import("../coach/domain").NutritionGuidanceData {
  const goal = facts.goalContract.value.primaryGoal;
  const commitment = facts.goalContract.value.commitmentPreferences?.nutrition ?? "standard";
  const committed = [...facts.nutritionStrategies].sort((a, b) => b.revision - a.revision)[0];
  const calorieDirection =
    energyApproach === "small_deficit" ? "deficit" as const
    : energyApproach === "small_surplus" ? "small_surplus" as const
    : "maintenance" as const;
  // 蛋白区间：ISSN 2017 健康运动者 1.4-2.0 g/kg；减脂保肌期取上段（产品规则 D 级）
  const perKgBand = goal === "fat_loss_preserve_lean_mass"
    ? { min: 1.6, max: 2.2 }
    : { min: 1.4, max: 2.0 };
  const bodyWeight = facts.profile.value.demographics?.currentWeight;
  const unknowns: string[] = [];
  if (!bodyWeight) unknowns.push("body_weight_unknown");
  const mode = commitment === "flexible" ? "minimal_constraint" as const : commitment === "strict" ? "full_targets" as const : "standard" as const;
  return {
    mode,
    proteinFloorPerKg: perKgBand.min,
    ...(bodyWeight
      ? {
          proteinGramsPerDay: {
            min: Math.round(bodyWeight.value * perKgBand.min),
            max: Math.round(bodyWeight.value * perKgBand.max),
          },
        }
      : {}),
    calorieDirection,
    ...absoluteNutritionTargets(facts, calorieDirection, tiering),
    ...(tiering?.weeklyRateTarget ? { weeklyRateTarget: tiering.weeklyRateTarget } : {}),
    ...(tiering?.bodyMassState === "high" || tiering?.bodyMassState === "very_high"
      ? { dailyStepTarget: 8000 }
      : tiering && calorieDirection === "deficit"
        ? { dailyStepTarget: 7000 }
        : {}),
    // 绝对热量需要体重与活动数据；缺任一项就不输出（禁止推测 TDEE）
    tracking:
      mode === "minimal_constraint"
        ? "只记蛋白是否达标+饱腹感（简化轨道）"
        : mode === "full_targets"
          ? "完整记录热量与宏量营养素"
          : "记录关键项（蛋白与趋势）",
    ...(committed ? { committedStrategyRef: { id: committed.value.id, revision: committed.revision } } : {}),
    ...(unknowns.length ? { unknowns } : {}),
    note: !bodyWeight
      ? "还不知道你的体重，蛋白目标只能给每公斤区间；告诉我体重后我给具体克数。不会凭猜测给热量数字。"
      : mode === "minimal_constraint"
        ? "先只保蛋白底线和能量方向，其他随习惯；想更精确随时说。弹性约束的长期依从性更好。"
        : mode === "full_targets"
          ? "按完整目标追踪；连续依从性差时自动降档为简化轨道。"
          : "按默认策略追踪，趋势不对再调整。",
  };
}

/** 计划级恢复指导。 */
function recoveryGuidanceFor(facts: PlannerFacts): import("../coach/domain").RecoveryGuidanceData {
  const hasActive = facts.recoveryConstraints.some((item) => item.value.level !== "normal");
  return {
    sleepNote: "规律睡眠是恢复主线；设备分数只做参考趋势",
    restDayIntent: hasActive ? "当前有恢复约束，优先执行降级安排" : "休息日可散步/轻活动；酸痛不单独决定减量",
    deloadPolicy: "减量由表现与恢复信号触发，不按日历强制",
  };
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
