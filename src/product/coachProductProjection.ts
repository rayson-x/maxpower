import type {
  DomainProjection,
  MassQuantity,
  NutritionStrategyData,
  PlanRevisionData,
  PlannedSessionData,
  TimelineProjectionEvent,
  WorkoutProjection,
} from "../coach/domain";
import type {
  ActionEvent,
  Artifact,
  EvidenceBriefArtifact,
  HealthImportState,
  PendingHumanAction,
} from "../coach/model";
import {
  deriveBodyTrends,
  timelineActivityLog,
  timelineDayKey,
  type BodyTrendReport,
  type TimelineActivityLog,
  type TimelineReadEvent,
} from "../timeline";
import type {
  AdaptiveForecastScenario,
  AppliedPhaseStrategy,
  RecommendationExplanation,
  StrategySelection,
} from "../planning";
import { deriveMetricRegistry, type MetricEnvelope } from "../replanning";
import type { NutritionDayLedger, NutritionDayPlan } from "../nutrition";
import { projectHealthTrends, type DailyHealthLedger, type HealthTrendProjection } from "../health";

export type CalendarPresentationMode = "week" | "month";

export interface CoachProductProjectionInput {
  domain: DomainProjection;
  date: string;
  timezoneOffsetMinutes: number;
  calendarMode: CalendarPresentationMode;
  calendarAnchorDate: string;
  actions: readonly ActionEvent[];
  pendingHumanActions: readonly PendingHumanAction[];
  artifacts: readonly Artifact[];
  healthImportStates: readonly HealthImportState[];
  exerciseLabel: (exerciseVariantId: string) => string;
  healthLedgers: Readonly<Record<string, DailyHealthLedger>>;
}

export interface CoachProductProjection {
  source: {
    userId: string;
    planId?: string;
    planRevision?: number;
    timelineRevision: number;
  };
  today: TodayProductProjection;
  calendar: CalendarProductProjection;
  plan: PlanProductProjection;
  progress: ProgressProductProjection;
  profile: ProfileProductProjection;
  coach: CoachStatusProjection;
}

export interface TodayProductProjection {
  date: string;
  state:
    | "record_first"
    | "safety_hold"
    | "planner_hold"
    | "workout"
    | "activity"
    | "rest"
    | "completed";
  action: "start_workout" | "continue_workout" | "record_activity" | "view_reason" | "view_summary";
  session?: ProductSession;
  activityLog: TimelineActivityLog;
  nutrition: NutritionProductProjection;
  recovery: RecoveryProductProjection;
  activeWorkout?: { id: string; status: WorkoutProjection["status"] };
  /** A factual outcome, kept separate from today's SessionPrescription. */
  completedWorkout?: WorkoutOutcomeProductSummary;
  reason?: string;
  /** Latest fixed GoalPath signal delivered to the manual Home channel. */
  goalPathSignal?: EvidenceBriefArtifact;
}

export interface RecoveryProductProjection {
  level: "normal" | "slight_reduction" | "recovery_priority" | "pause_and_confirm";
  validUntil?: string;
  reasons: readonly string[];
  missing: readonly string[];
}

export interface NutritionProductProjection {
  plan: NutritionDayPlan;
  ledger: NutritionDayLedger;
  /** The sole formal daily energy/nutrition result used by every product surface. */
  healthLedger: DailyHealthLedger;
}

export interface ProductSession {
  id: string;
  title: string;
  kind: NonNullable<PlannedSessionData["kind"]>;
  scheduledFor: string;
  estimatedMinutes?: number;
  taskCount: number;
  totalSetCount: number;
  /** 用户在本计划中可执行、可记录的行动，而非医疗或教练处方。 */
  actions: readonly PlanAction[];
  aerobicBlock?: PlannedSessionData["aerobicBlock"];
}

export interface PlanAction {
  id: string;
  exerciseVariantId: string;
  label: string;
  mode: NonNullable<PlannedSessionData["tasks"]>[number]["mode"];
  summary: string;
  targetRir?: number;
}

/**
 * The minimum durable performed-workout detail needed by Today and Calendar.
 * It is intentionally an outcome summary, never a second local copy of a
 * WorkoutSession or a claim that the scheduled prescription was performed.
 */
export interface WorkoutOutcomeProductSummary {
  id: string;
  title: string;
  scheduledFor: string;
  status: "completed" | "partial" | "abandoned";
  completedAt: string;
  completedWorkSets: number;
  incompleteSetCount: number;
  dataCompleteness: "complete" | "partial" | "manual_only";
}

export interface CalendarProductProjection {
  mode: CalendarPresentationMode;
  anchorDate: string;
  selectedDate: string;
  dates: readonly CalendarDayProjection[];
  selected: {
    date: string;
    session?: ProductSession;
    activityLog: TimelineActivityLog;
    completedWorkout?: { id: string; status: WorkoutProjection["status"] };
    /** Real outcomes on the selected local date, in occurrence order. */
    performedWorkouts: readonly WorkoutOutcomeProductSummary[];
  };
}

export interface CalendarDayProjection {
  date: string;
  plannedKind?: NonNullable<PlannedSessionData["kind"]>;
  planned: boolean;
  completed: boolean;
  partial: boolean;
  hasActivityLog: boolean;
}

export interface PlanProductProjection {
  status: "unavailable" | "stale" | "current";
  revision?: number;
  effectiveFrom?: string;
  lifecycleState?: NonNullable<PlanRevisionData["lifecycle"]>["state"];
  horizon?: { startDate: string; endDate: string };
  currentWeek: readonly ProductSession[];
  nextWeek: readonly ProductSession[];
  futureIntentCount: number;
  reasonCodes: readonly string[];
  strategySelection?: StrategySelection;
  appliedPhaseStrategy?: AppliedPhaseStrategy;
  forecasts: readonly AdaptiveForecastScenario[];
  explanation?: RecommendationExplanation;
  trainingStrategy?: import("../planning").TrainingStrategy;
  planningNutritionStrategy?: import("../planning").PlanningNutritionStrategy;
  recoveryStrategy?: import("../planning").RecoveryStrategy;
  nutritionTarget?: NutritionStrategyData;
  rollingEnergyAdjustment?: import("../planning/rollingEnergyAdjustment").RollingEnergyAdjustment;
  intakeWeek: readonly DailyHealthLedger[];
  latestAdaptivePlanProposal?: EvidenceBriefArtifact;
}

export interface ProgressProductProjection {
  bodyTrends: BodyTrendReport;
  strengthTrends: StrengthTrendProjection;
  completedWorkoutCount: number;
  reportArtifacts: readonly Extract<Artifact, { kind: "weekly_coach_report" }>[];
  metrics: readonly MetricEnvelope[];
  /** Plan-independent day/week/month rollups used by record-first and planned users alike. */
  healthTrends: HealthTrendProjection;
}

export interface StrengthTrendPoint {
  date: string;
  valueKg: number;
  source: "profile_baseline" | "confirmed_set";
}

export interface StrengthTrendSeries {
  id: "squat" | "bench_press" | "deadlift";
  label: string;
  points: readonly StrengthTrendPoint[];
  latestKg?: number;
  changePercent?: number;
}

export interface StrengthTrendProjection {
  lifts: readonly StrengthTrendSeries[];
  composite: readonly { date: string; index: number }[];
}

export interface ProfileProductProjection {
  profileReady: boolean;
  /** Drives client-side i18n only; absent until the user has a profile. */
  locale?: string;
  primaryGoal?: string;
  mandateMode?: string;
  planAuthorization?: {
    revision: number;
    mandate: NonNullable<DomainProjection["mandate"]>["value"];
  };
  locations: number;
  customExercises: number;
  /** Input to local cardio estimates; this is not a second health-data record. */
  referenceWeightKg?: number;
  /**
   * Adapter-local connection status only. Raw health values remain Timeline
   * facts and are deliberately not duplicated in the profile projection.
   */
  healthSources: readonly HealthSourceProductProjection[];
  actionLog: {
    total: number;
    recent: readonly {
      id: string;
      action: ActionEvent["action"];
      intent: string;
      actor: ActionEvent["actor"];
      result: ActionEvent["result"];
      occurredAt: string;
      reversible: boolean;
    }[];
  };
  permissions?: {
    revision: number;
    camera: string;
    health: string;
    notifications: string;
    remoteLlm: string;
  };
}

export interface HealthSourceProductProjection {
  platform: HealthImportState["platform"];
  availability: NonNullable<HealthImportState["availability"]>;
  metricTypes: readonly HealthImportState["metricTypes"][number][];
  grantedMetricTypes: readonly HealthImportState["metricTypes"][number][];
  /** Requested-but-uninspectable HealthKit read types remain distinct from grants. */
  unknownPermissionMetricTypes: readonly HealthImportState["metricTypes"][number][];
  lastSuccessfulImportAt?: string;
  lastAttemptAt: string;
}

export interface CoachStatusProjection {
  pending?: {
    id: string;
    prompt: string;
    risk?: PendingHumanAction["risk"];
  };
  latestUndoableAction?: {
    id: string;
    action: ActionEvent["action"];
    occurredAt: string;
  };
  goalCompletionNext?: "record_first" | "maintenance_planning" | "goal_negotiation";
}

/**
 * Pure projection for the shared mobile shell. It receives only canonical
 * domain values and deliberately cannot manufacture a plan or Timeline fact.
 */
export function buildCoachProductProjection(input: CoachProductProjectionInput): CoachProductProjection {
  const plan = input.domain.plan && (!input.domain.plan.value.lifecycle || input.domain.plan.value.lifecycle.state === "active")
    ? input.domain.plan
    : undefined;
  const allSessions = plan?.value.sessions ?? [];
  const currentWeek = weekDates(input.date);
  const nextWeek = weekDates(addDays(currentWeek[0]!, 7));
  const currentWeekSessions = sessionsForDates(allSessions, currentWeek);
  const nutritionTarget = [...input.domain.nutritionStrategies]
    .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0]?.value;
  const dateSessions = sessionsForDate(plan?.value.sessions ?? [], input.date);
  const todaySession = dateSessions[0];
  const activeWorkout = workoutForSession(input.domain.workouts, todaySession?.id);
  const selectedPerformedWorkouts = performedWorkoutsForDate(
    input.domain.workouts,
    input.date,
    input.timezoneOffsetMinutes,
  );
  const activityLog = timelineActivityLog(
    input.date,
    input.timezoneOffsetMinutes,
    input.domain.timeline.events,
  );
  const safetyHold = input.domain.safetyConstraints.find(
    (constraint) => constraint.value.disposition !== "clear",
  );
  const today = buildToday({
    date: input.date,
    domain: input.domain,
    session: todaySession,
    activeWorkout,
    completedWorkout: selectedPerformedWorkouts[0],
    activityLog,
    safetyReason: safetyHold?.value.reasons[0],
    exerciseLabel: input.exerciseLabel,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    healthLedger: requireHealthLedger(input.healthLedgers, input.date),
  });
  const visibleCalendarDates = calendarRangeDates(input.calendarMode, input.calendarAnchorDate);
  const calendar = {
    mode: input.calendarMode,
    anchorDate: input.calendarAnchorDate,
    selectedDate: input.date,
    dates: visibleCalendarDates.map((date) => calendarDay({
      domain: input.domain,
      date,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    })),
    selected: {
      date: input.date,
      ...(todaySession ? { session: productSession(todaySession, input.exerciseLabel) } : {}),
      activityLog,
      performedWorkouts: selectedPerformedWorkouts,
      ...(activeWorkout?.status === "completed" || activeWorkout?.status === "partial"
        ? { completedWorkout: { id: activeWorkout.id, status: activeWorkout.status } }
        : {}),
    },
  } satisfies CalendarProductProjection;
  const intakeWeek = currentWeek.map((date) => {
    const session = sessionsForDate(allSessions, date)[0];
    const completedWorkout = performedWorkoutsForDate(
      input.domain.workouts,
      date,
      input.timezoneOffsetMinutes,
    )[0];
    return buildNutritionProductProjection({ healthLedger: requireHealthLedger(input.healthLedgers, date) });
  });
  const reports = input.artifacts.filter(
    (artifact): artifact is Extract<Artifact, { kind: "weekly_coach_report" }> =>
      artifact.kind === "weekly_coach_report",
  ).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const resolvedAdaptiveProposalIds = new Set(input.artifacts.flatMap((artifact) => artifact.kind === "evidence_brief" && artifact.adaptivePlanProposal && artifact.adaptivePlanProposal.status !== "awaiting_confirmation" ? [artifact.id.replace(/:(?:applied:\d+|rejected)$/, "")] : []));
  const latestAdaptivePlanProposal = input.artifacts
    .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && Boolean(artifact.adaptivePlanProposal) && artifact.adaptivePlanProposal?.status === "awaiting_confirmation" && !resolvedAdaptiveProposalIds.has(artifact.id))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const latestGoalPathDecision = input.artifacts
    .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && artifact.userId === input.domain.userId && Boolean(artifact.goalPathAssessment))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const latestHomeGoalPathSignal = latestGoalPathDecision?.goalPathAssessment?.channel === "manual_home" && latestGoalPathDecision.goalPathAssessment.delivery === "home"
    ? latestGoalPathDecision
    : undefined;
  const latestCompletedGoal = input.artifacts
    .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && artifact.userId === input.domain.userId && artifact.goalCompletionProposal?.status === "completed" && Boolean(artifact.goalCompletionProposal.next))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const pending = input.pendingHumanActions
    .filter((item) => item.status === "pending")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const latestUndoable = input.actions
    .filter((action) => action.reversible && !action.undoneBy && action.result === "applied")
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))[0];
  const recentActions = [...input.actions]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 3)
    .map((action) => ({
      id: action.id,
      action: action.action,
      intent: action.intent,
      actor: action.actor,
      result: action.result,
      occurredAt: action.occurredAt,
      reversible: action.reversible && !action.undoneBy,
    }));
  const healthSources = input.healthImportStates
    .filter((state) => state.userId === input.domain.userId)
    .sort((left, right) => {
      const leftAt = left.lastSuccessfulImportAt ?? left.lastAttemptAt;
      const rightAt = right.lastSuccessfulImportAt ?? right.lastAttemptAt;
      return rightAt.localeCompare(leftAt);
    })
    .map((state) => ({
      platform: state.platform,
      availability: state.availability ?? "available",
      metricTypes: [...state.metricTypes],
      grantedMetricTypes: state.metricTypes.filter(
        (metric) => state.permissionByMetric[metric] === "granted",
      ),
      unknownPermissionMetricTypes: state.metricTypes.filter(
        (metric) => state.permissionByMetric[metric] === "unknown",
      ),
      ...(state.lastSuccessfulImportAt ? { lastSuccessfulImportAt: state.lastSuccessfulImportAt } : {}),
      lastAttemptAt: state.lastAttemptAt,
    }));
  const strengthTrends = deriveStrengthTrendProjection({
    events: input.domain.timeline.events,
    profile: input.domain.profile?.value,
    fallbackDate: input.date,
    exerciseLabel: input.exerciseLabel,
  });
  const trendStartDate = addDays(input.date, -29);
  const trendLedgers = datesBetween(trendStartDate, input.date).map((date) => requireHealthLedger(input.healthLedgers, date));
  const healthTrends = projectHealthTrends({
    ledgers: trendLedgers,
    timeline: input.domain.timeline.current,
    startDate: trendStartDate,
    endDate: input.date,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
  });

  return {
    source: {
      userId: input.domain.userId,
      ...(plan ? { planId: plan.value.id } : {}),
      ...(plan ? { planRevision: plan.revision } : {}),
      timelineRevision: input.domain.timeline.revision,
    },
    today: { ...today, ...(latestHomeGoalPathSignal ? { goalPathSignal: latestHomeGoalPathSignal } : {}) },
    calendar,
    plan: {
      status: !plan || (plan.value.lifecycle && plan.value.lifecycle.state !== "active") ? "unavailable" : input.domain.planStatus === "stale_goal_contract" ? "stale" : "current",
      ...(input.domain.plan ? { revision: input.domain.plan.revision, effectiveFrom: input.domain.plan.value.effectiveFrom, ...(input.domain.plan.value.lifecycle ? { lifecycleState: input.domain.plan.value.lifecycle.state } : {}) } : {}),
      ...(input.domain.goalContract?.value.horizon.endDate ? { horizon: {
        startDate: input.domain.goalContract.value.horizon.startDate,
        endDate: input.domain.goalContract.value.horizon.endDate,
      } } : {}),
      currentWeek: currentWeekSessions.map((session) => productSession(session, input.exerciseLabel)),
      nextWeek: sessionsForDates(allSessions, nextWeek).map((session) => productSession(session, input.exerciseLabel)),
      futureIntentCount: plan?.value.futureIntentRefs?.length ?? 0,
      reasonCodes: plan?.value.reasonCodes ?? [],
      ...(plan?.value.strategySelection ? { strategySelection: plan.value.strategySelection } : {}),
      ...(plan?.value.appliedPhaseStrategy ? { appliedPhaseStrategy: plan.value.appliedPhaseStrategy } : {}),
      ...(plan?.value.trainingStrategy ? { trainingStrategy: plan.value.trainingStrategy } : {}),
      ...(plan?.value.nutritionStrategy ? { planningNutritionStrategy: plan.value.nutritionStrategy } : {}),
      ...(plan?.value.recoveryStrategy ? { recoveryStrategy: plan.value.recoveryStrategy } : {}),
      ...(nutritionTarget ? { nutritionTarget } : {}),
      ...(plan?.value.rollingEnergyAdjustment ? { rollingEnergyAdjustment: plan.value.rollingEnergyAdjustment } : {}),
      intakeWeek: intakeWeek.map((nutrition) => nutrition.healthLedger),
      forecasts: plan?.value.adaptiveForecasts ?? [],
      ...(plan?.value.explanation ? { explanation: plan.value.explanation } : {}),
      ...(latestAdaptivePlanProposal ? { latestAdaptivePlanProposal } : {}),
    },
    progress: {
      bodyTrends: deriveBodyTrends({
        events: input.domain.timeline.events,
        preferences: input.domain.profile?.value.primaryDataSources,
      }),
      strengthTrends,
      completedWorkoutCount: input.domain.workouts.filter((workout) => workout.status === "completed").length,
      reportArtifacts: reports,
      metrics: deriveMetricRegistry({
        domain: input.domain,
        startDate: addDays(input.date, -20),
        endDate: input.date,
        ruleVersion: "maxpower.metrics.v1",
      }),
      healthTrends,
    },
    profile: {
      profileReady: Boolean(input.domain.profile && input.domain.mandate),
      ...(input.domain.profile?.value.locale ? { locale: input.domain.profile.value.locale } : {}),
      ...(input.domain.goalContract ? { primaryGoal: input.domain.goalContract.value.primaryGoal } : {}),
      ...(input.domain.mandate ? { mandateMode: input.domain.mandate.value.mode } : {}),
      ...(input.domain.mandate ? { planAuthorization: { revision: input.domain.mandate.revision, mandate: input.domain.mandate.value } } : {}),
      locations: input.domain.profile?.value.locations?.length ?? 0,
      customExercises: input.domain.customExercises.length,
      ...(profileWeightKg(input.domain.profile?.value.demographics?.currentWeight) !== undefined ? { referenceWeightKg: profileWeightKg(input.domain.profile?.value.demographics?.currentWeight) } : {}),
      healthSources,
      actionLog: { total: input.actions.length, recent: recentActions },
      ...(input.domain.permissions ? {
        permissions: {
          revision: input.domain.permissions.revision,
          ...input.domain.permissions.value,
        },
      } : {}),
    },
    coach: {
      ...(pending ? { pending: { id: pending.id, prompt: pending.prompt, ...(pending.risk ? { risk: pending.risk } : {}) } } : {}),
      ...(latestUndoable
        ? { latestUndoableAction: { id: latestUndoable.id, action: latestUndoable.action, occurredAt: latestUndoable.occurredAt } }
        : {}),
      ...(latestCompletedGoal?.goalCompletionProposal?.next ? { goalCompletionNext: latestCompletedGoal.goalCompletionProposal.next } : {}),
    },
  };
}

export function deriveStrengthTrendProjection(input: {
  events: readonly TimelineProjectionEvent[];
  profile?: NonNullable<DomainProjection["profile"]>["value"];
  fallbackDate: string;
  exerciseLabel(exerciseVariantId: string): string;
}): StrengthTrendProjection {
  const definitions = [
    { id: "squat" as const, label: "深蹲" },
    { id: "bench_press" as const, label: "卧推" },
    { id: "deadlift" as const, label: "硬拉" },
  ];
  const buckets = new Map<StrengthTrendSeries["id"], StrengthTrendPoint[]>(
    definitions.map((definition) => [definition.id, []]),
  );
  const baseline = input.profile?.strengthBaseline;
  const baselineDate = baseline?.measuredAt?.slice(0, 10) ?? input.fallbackDate;
  const baselineValues: Record<StrengthTrendSeries["id"], MassQuantity | undefined> = {
    squat: baseline?.squat,
    bench_press: baseline?.benchPress,
    deadlift: baseline?.deadlift,
  };
  definitions.forEach((definition) => {
    const quantity = baselineValues[definition.id];
    if (quantity) buckets.get(definition.id)!.push({
      date: baselineDate,
      valueKg: round1(massInKg(quantity.value, quantity.unit)),
      source: "profile_baseline",
    });
  });

  input.events.forEach((event) => {
    if (event.fact.kind !== "training" || !event.fact.historicalSet) return;
    const set = event.fact.historicalSet;
    const category = strengthCategory(set.exerciseVariantId, input.exerciseLabel(set.exerciseVariantId));
    if (!category) return;
    const loadKg = massInKg(set.load.value, set.load.unit);
    const estimatedOneRepMax = loadKg * (1 + set.reps / 30);
    buckets.get(category)!.push({
      date: timelineDayKey(event),
      valueKg: round1(estimatedOneRepMax),
      source: "confirmed_set",
    });
  });

  const lifts = definitions.map((definition): StrengthTrendSeries => {
    const byDate = new Map<string, StrengthTrendPoint>();
    buckets.get(definition.id)!.sort((left, right) => left.date.localeCompare(right.date)).forEach((point) => {
      const current = byDate.get(point.date);
      if (!current || point.valueKg >= current.valueKg || current.source === "profile_baseline") byDate.set(point.date, point);
    });
    const points = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    const first = points[0]?.valueKg;
    const latest = points.at(-1)?.valueKg;
    return {
      id: definition.id,
      label: definition.label,
      points,
      ...(latest !== undefined ? { latestKg: latest } : {}),
      ...(first !== undefined && latest !== undefined && first > 0 && points.length > 1
        ? { changePercent: round1(((latest - first) / first) * 100) }
        : {}),
    };
  });

  const dates = [...new Set(lifts.flatMap((lift) => lift.points.map((point) => point.date)))].sort();
  const latestByLift = new Map<StrengthTrendSeries["id"], number>();
  const firstComplete = new Map<StrengthTrendSeries["id"], number>();
  const composite: { date: string; index: number }[] = [];
  dates.forEach((date) => {
    lifts.forEach((lift) => {
      const point = lift.points.find((candidate) => candidate.date === date);
      if (point) latestByLift.set(lift.id, point.valueKg);
    });
    if (latestByLift.size !== lifts.length) return;
    lifts.forEach((lift) => {
      if (!firstComplete.has(lift.id)) firstComplete.set(lift.id, latestByLift.get(lift.id)!);
    });
    const currentTotal = lifts.reduce((sum, lift) => sum + latestByLift.get(lift.id)!, 0);
    const baselineTotal = lifts.reduce((sum, lift) => sum + firstComplete.get(lift.id)!, 0);
    composite.push({ date, index: round1((currentTotal / baselineTotal) * 100) });
  });
  return { lifts, composite };
}

function strengthCategory(exerciseVariantId: string, label: string): StrengthTrendSeries["id"] | undefined {
  const value = `${exerciseVariantId} ${label}`.toLocaleLowerCase();
  if (/bench|卧推/.test(value)) return "bench_press";
  if (/deadlift|硬拉/.test(value)) return "deadlift";
  if (/squat|深蹲/.test(value)) return "squat";
  return undefined;
}

function massInKg(value: number, unit: string): number {
  return unit === "lb" || unit === "lbs" ? value * 0.45359237 : value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildToday(input: {
  date: string;
  domain: DomainProjection;
  session?: PlannedSessionData;
  activeWorkout?: WorkoutProjection;
  completedWorkout?: WorkoutOutcomeProductSummary;
  activityLog: TimelineActivityLog;
  safetyReason?: string;
  exerciseLabel: (exerciseVariantId: string) => string;
  timezoneOffsetMinutes: number;
  healthLedger: DailyHealthLedger;
}): TodayProductProjection {
  const recoveryConstraint = [...input.domain.recoveryConstraints]
    .filter((item) => item.value.validUntil >= `${input.date}T00:00:00.000Z`)
    .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0]?.value;
  const recovery = {
    level: recoveryConstraint?.level ?? "normal",
    ...(recoveryConstraint?.validUntil ? { validUntil: recoveryConstraint.validUntil } : {}),
    reasons: recoveryConstraint?.evaluation?.reasonCodes ?? ["no_active_recovery_constraint"],
    missing: recoveryConstraint?.evaluation?.missingOrStale ?? ["check_in_optional"],
  } satisfies RecoveryProductProjection;
  const nutrition = buildNutritionProductProjection(input);
  if (!input.domain.profile || !input.domain.mandate) {
    return { date: input.date, state: "record_first", action: "record_activity", activityLog: input.activityLog, nutrition, recovery };
  }
  if (input.safetyReason) {
    return { date: input.date, state: "safety_hold", action: "view_reason", activityLog: input.activityLog, nutrition, recovery, reason: input.safetyReason };
  }
  if (!input.domain.goalContract) {
    return { date: input.date, state: "record_first", action: "record_activity", activityLog: input.activityLog, nutrition, recovery };
  }
  if (input.domain.plan?.value.lifecycle && input.domain.plan.value.lifecycle.state !== "active") {
    return { date: input.date, state: "record_first", action: "record_activity", activityLog: input.activityLog, nutrition, recovery };
  }
  if (!input.domain.plan || input.domain.planStatus === "stale_goal_contract") {
    return {
      date: input.date,
      state: "planner_hold",
      action: "view_reason",
      activityLog: input.activityLog,
      nutrition,
      recovery,
      reason: input.domain.planStatus === "stale_goal_contract" ? "当前目标已更新，需要重新生成计划" : "还没有可执行的今日计划",
    };
  }
  if (input.activeWorkout?.status === "completed" || input.activeWorkout?.status === "partial") {
    return {
      date: input.date,
      state: "completed",
      action: "view_summary",
      activityLog: input.activityLog,
      nutrition,
      recovery,
      ...(input.session ? { session: productSession(input.session, input.exerciseLabel) } : {}),
      activeWorkout: { id: input.activeWorkout.id, status: input.activeWorkout.status },
      ...(completedWorkoutSummary(input.activeWorkout)
        ? { completedWorkout: completedWorkoutSummary(input.activeWorkout)! }
        : {}),
    };
  }
  if (!input.session) {
    if (input.completedWorkout) {
      return {
        date: input.date,
        state: "completed",
        action: "view_summary",
        activityLog: input.activityLog,
        nutrition,
        recovery,
        completedWorkout: input.completedWorkout,
      };
    }
    return { date: input.date, state: "rest", action: "record_activity", activityLog: input.activityLog, nutrition, recovery };
  }
  const product = productSession(input.session, input.exerciseLabel);
  if (input.session.kind === "cardio") {
    return { date: input.date, state: "activity", action: "record_activity", activityLog: input.activityLog, nutrition, recovery, session: product };
  }
  if (input.session.kind === "rest" || input.session.kind === "recovery") {
    return { date: input.date, state: "rest", action: "record_activity", activityLog: input.activityLog, nutrition, recovery, session: product };
  }
  return {
    date: input.date,
    state: "workout",
    action: input.activeWorkout?.status === "active" || input.activeWorkout?.status === "paused" ? "continue_workout" : "start_workout",
    activityLog: input.activityLog,
    nutrition,
    recovery,
    session: product,
    ...(input.activeWorkout ? { activeWorkout: { id: input.activeWorkout.id, status: input.activeWorkout.status } } : {}),
  };
}

function buildNutritionProductProjection(input: { healthLedger: DailyHealthLedger }): NutritionProductProjection {
  const { healthLedger } = input;
  return {
    plan: healthLedger.nutritionPlan,
    ledger: healthLedger.nutrition,
    healthLedger,
  };
}

function requireHealthLedger(ledgers: Readonly<Record<string, DailyHealthLedger>>, date: string): DailyHealthLedger {
  const ledger = ledgers[date];
  if (!ledger) throw new Error(`daily_health_ledger_missing:${date}`);
  return ledger;
}

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function planMaterializesDate(domain: DomainProjection, date: string): boolean {
  const plan = domain.plan?.value;
  if (!plan) return false;
  if (plan.materializedWeeks?.some((week) => week.startDate <= date && date <= week.endDate)) return true;
  const dates = new Set(weekDates(date));
  return plan.sessions.some((session) => dates.has(session.scheduledFor));
}

function calendarDay(input: {
  domain: DomainProjection;
  date: string;
  timezoneOffsetMinutes: number;
}): CalendarDayProjection {
  const session = sessionsForDate(input.domain.plan?.value.sessions ?? [], input.date)[0];
  const performedWorkouts = performedWorkoutsForDate(
    input.domain.workouts,
    input.date,
    input.timezoneOffsetMinutes,
  );
  const hasActivityLog = input.domain.timeline.current.some(
    (event) => timelineDayKey(event) === input.date,
  );
  return {
    date: input.date,
    ...(session?.kind ? { plannedKind: session.kind } : {}),
    planned: Boolean(session),
    completed: performedWorkouts.some((workout) => workout.status === "completed"),
    partial: performedWorkouts.some((workout) => workout.status === "partial" || workout.status === "abandoned"),
    hasActivityLog,
  };
}

function performedWorkoutsForDate(
  workouts: readonly WorkoutProjection[],
  date: string,
  timezoneOffsetMinutes: number,
): readonly WorkoutOutcomeProductSummary[] {
  return workouts
    .map(completedWorkoutSummary)
    .filter((summary): summary is WorkoutOutcomeProductSummary => summary !== undefined)
    .filter((summary) => localDateForTimezone(summary.completedAt, timezoneOffsetMinutes) === date)
    .sort((left, right) => left.completedAt.localeCompare(right.completedAt));
}

function completedWorkoutSummary(workout: WorkoutProjection): WorkoutOutcomeProductSummary | undefined {
  const outcome = workout.outcome;
  if (!outcome || (workout.status !== "completed" && workout.status !== "partial" && workout.status !== "abandoned")) {
    return undefined;
  }
  return {
    id: workout.id,
    title: workout.frozenPrescription.title,
    scheduledFor: workout.frozenPrescription.scheduledFor,
    status: outcome.status,
    completedAt: outcome.completedAt,
    completedWorkSets: outcome.completedWorkSets,
    incompleteSetCount: outcome.incompletePrescriptionSetIds.length,
    dataCompleteness: outcome.dataCompleteness,
  };
}

function localDateForTimezone(occurredAt: string, timezoneOffsetMinutes: number): string {
  const timestamp = Date.parse(occurredAt);
  if (!Number.isFinite(timestamp)) return occurredAt.slice(0, 10);
  return new Date(timestamp + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function productSession(
  session: PlannedSessionData,
  exerciseLabel: (exerciseVariantId: string) => string,
): ProductSession {
  const actions = session.tasks.map((task) => {
    const first = task.sets[0];
    const reps = first?.targetReps ? `${first.targetReps.min}–${first.targetReps.max} 次` : undefined;
    const duration = first?.targetDuration ? `${first.targetDuration.value} ${first.targetDuration.unit}` : undefined;
    const distance = first?.targetDistance ? `${first.targetDistance.value} ${first.targetDistance.unit}` : undefined;
    const summary = [`${task.sets.length} 组`, reps ?? duration ?? distance ?? "待记录"].join(" · ");
    return {
      id: task.id,
      exerciseVariantId: task.exerciseVariantId,
      label: exerciseLabel(task.exerciseVariantId),
      mode: task.mode ?? "weighted_reps",
      summary,
      ...(first?.targetRir !== undefined ? { targetRir: first.targetRir } : {}),
    };
  });
  return {
    id: session.id,
    title: session.title,
    kind: session.kind ?? "weighted_reps",
    scheduledFor: session.scheduledFor,
    ...(session.estimatedDuration || session.durationBudget
      ? { estimatedMinutes: durationMinutes(session.estimatedDuration ?? session.durationBudget!) }
      : {}),
    taskCount: actions.length,
    totalSetCount: session.tasks.reduce((sum, task) => sum + task.sets.length, 0),
    actions,
    ...(session.aerobicBlock ? { aerobicBlock: session.aerobicBlock } : {}),
  };
}

function durationMinutes(duration: { value: number; unit: string }): number | undefined {
  if (duration.unit === "minutes") return duration.value;
  if (duration.unit === "seconds") return Math.ceil(duration.value / 60);
  return undefined;
}

function profileWeightKg(weight: MassQuantity | undefined): number | undefined {
  if (!weight || !Number.isFinite(weight.value) || weight.value <= 0) return undefined;
  return weight.unit === "kg" ? weight.value : weight.value * 0.45359237;
}

function sessionsForDate(sessions: readonly PlannedSessionData[], date: string): readonly PlannedSessionData[] {
  return sessions.filter((session) => session.scheduledFor === date);
}

function sessionsForDates(sessions: readonly PlannedSessionData[], dates: readonly string[]): readonly PlannedSessionData[] {
  const index = new Set(dates);
  return sessions.filter((session) => index.has(session.scheduledFor));
}

function workoutForSession(
  workouts: readonly WorkoutProjection[],
  sessionId: string | undefined,
): WorkoutProjection | undefined {
  if (!sessionId) return undefined;
  return [...workouts]
    .filter((workout) => workout.source.kind === "planned" && workout.source.plannedSessionRef.sessionPrescriptionId === sessionId)
    .sort((left, right) => right.revision - left.revision)[0];
}

function calendarRangeDates(mode: CalendarPresentationMode, anchorDate: string): readonly string[] {
  if (mode === "week") return weekDates(anchorDate);
  const start = new Date(`${anchorDate.slice(0, 7)}-01T12:00:00.000Z`);
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index + 1));
    return date.toISOString().slice(0, 10);
  });
}

function weekDates(anchorDate: string): readonly string[] {
  const anchor = new Date(`${anchorDate}T12:00:00.000Z`);
  const weekday = (anchor.getUTCDay() + 6) % 7;
  const monday = addDays(anchorDate, -weekday);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

function addDays(date: string, amount: number): string {
  const parsed = new Date(`${date}T12:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function timelineSummary(entry: TimelineReadEvent | TimelineProjectionEvent): string {
  const fact = entry.fact;
  switch (fact.kind) {
    case "training": return fact.reportedSession?.summary?.trim() || fact.reportedSession?.exercises?.[0]?.name || "训练记录";
    case "activity": return fact.activityType;
    case "nutrition": return fact.mealDescription ?? "饮食记录";
    case "sleep": return "睡眠";
    case "body": return fact.measurement.metric === "body_weight" ? "体重" : fact.measurement.metric === "body_fat_percentage" ? "体脂" : fact.measurement.site;
    case "recovery": return "恢复记录";
    case "symptom": return "身体反馈";
    case "clinical_context": return "健康边界";
    case "subjective": return "主观反馈";
    case "schedule": return "日程变更";
    case "rest": return "休息";
  }
}
