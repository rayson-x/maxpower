import type {
  DomainProjection,
  SessionPrescriptionData,
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
    | "onboarding_required"
    | "safety_hold"
    | "planner_hold"
    | "workout"
    | "activity"
    | "rest"
    | "completed";
  action: "start_workout" | "continue_workout" | "record_activity" | "open_onboarding" | "view_reason" | "view_summary";
  session?: ProductSession;
  activityLog: TimelineActivityLog;
  activeWorkout?: { id: string; status: WorkoutProjection["status"] };
  /** A factual outcome, kept separate from today's SessionPrescription. */
  completedWorkout?: WorkoutOutcomeProductSummary;
  reason?: string;
}

export interface ProductSession {
  id: string;
  title: string;
  kind: NonNullable<SessionPrescriptionData["kind"]>;
  scheduledFor: string;
  estimatedMinutes?: number;
  taskCount: number;
  totalSetCount: number;
  tasks: readonly ProductTask[];
}

export interface ProductTask {
  id: string;
  exerciseVariantId: string;
  label: string;
  mode: NonNullable<SessionPrescriptionData["tasks"]>[number]["mode"];
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
  plannedKind?: NonNullable<SessionPrescriptionData["kind"]>;
  planned: boolean;
  completed: boolean;
  partial: boolean;
  hasActivityLog: boolean;
}

export interface PlanProductProjection {
  status: "unavailable" | "stale" | "current";
  revision?: number;
  currentWeek: readonly ProductSession[];
  nextWeek: readonly ProductSession[];
  futureIntentCount: number;
  reasonCodes: readonly string[];
  strategySelection?: StrategySelection;
  appliedPhaseStrategy?: AppliedPhaseStrategy;
  forecasts: readonly AdaptiveForecastScenario[];
  explanation?: RecommendationExplanation;
  latestPlanningPreview?: EvidenceBriefArtifact;
}

export interface ProgressProductProjection {
  bodyTrends: BodyTrendReport;
  completedWorkoutCount: number;
  reportArtifacts: readonly Extract<Artifact, { kind: "weekly_coach_report" | "replan_evaluation" | "goal_forecast" | "mesocycle_review" }>[];
}

export interface ProfileProductProjection {
  onboardingComplete: boolean;
  trainingExperience?: DomainProjection["profile"] extends infer T ? T extends { value: infer V } ? V extends { trainingExperience: infer E } ? E : never : never : never;
  primaryGoal?: string;
  mandateMode?: string;
  locations: number;
  customExercises: number;
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
    cloudSync: string;
    mediaUpload: string;
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
}

/**
 * Pure projection for the shared mobile shell. It receives only canonical
 * domain values and deliberately cannot manufacture a plan or Timeline fact.
 */
export function buildCoachProductProjection(input: CoachProductProjectionInput): CoachProductProjection {
  const plan = input.domain.plan;
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
  const allSessions = plan?.value.sessions ?? [];
  const currentWeek = weekDates(input.date);
  const nextWeek = weekDates(addDays(currentWeek[0]!, 7));
  const reports = input.artifacts.filter(
    (artifact): artifact is Extract<Artifact, { kind: "weekly_coach_report" | "replan_evaluation" | "goal_forecast" | "mesocycle_review" }> =>
      artifact.kind === "weekly_coach_report" ||
      artifact.kind === "replan_evaluation" ||
      artifact.kind === "goal_forecast" ||
      artifact.kind === "mesocycle_review",
  ).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const supersededPlanningPreviewIds = new Set(
    input.artifacts
      .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && Boolean(artifact.planningPreview?.sourcePreviewId))
      .map((artifact) => artifact.planningPreview!.sourcePreviewId!),
  );
  const latestPlanningPreview = input.artifacts
    .filter((artifact): artifact is EvidenceBriefArtifact =>
      artifact.kind === "evidence_brief" &&
      Boolean(artifact.planningPreview) &&
      artifact.planningPreview?.status !== "confirmed" &&
      !supersededPlanningPreviewIds.has(artifact.id),
    )
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

  return {
    source: {
      userId: input.domain.userId,
      ...(plan ? { planId: plan.value.id } : {}),
      ...(plan ? { planRevision: plan.revision } : {}),
      timelineRevision: input.domain.timeline.revision,
    },
    today,
    calendar,
    plan: {
      status: !plan ? "unavailable" : input.domain.planStatus === "stale_goal_contract" ? "stale" : "current",
      ...(plan ? { revision: plan.revision } : {}),
      currentWeek: sessionsForDates(allSessions, currentWeek).map((session) => productSession(session, input.exerciseLabel)),
      nextWeek: sessionsForDates(allSessions, nextWeek).map((session) => productSession(session, input.exerciseLabel)),
      futureIntentCount: plan?.value.futureIntentRefs?.length ?? 0,
      reasonCodes: plan?.value.reasonCodes ?? [],
      ...(plan?.value.strategySelection ? { strategySelection: plan.value.strategySelection } : {}),
      ...(plan?.value.appliedPhaseStrategy ? { appliedPhaseStrategy: plan.value.appliedPhaseStrategy } : {}),
      forecasts: plan?.value.adaptiveForecasts ?? [],
      ...(plan?.value.explanation ? { explanation: plan.value.explanation } : {}),
      ...(latestPlanningPreview ? { latestPlanningPreview } : {}),
    },
    progress: {
      bodyTrends: deriveBodyTrends({
        events: input.domain.timeline.events,
        preferences: input.domain.profile?.value.primaryDataSources,
      }),
      completedWorkoutCount: input.domain.workouts.filter((workout) => workout.status === "completed").length,
      reportArtifacts: reports,
    },
    profile: {
      onboardingComplete: Boolean(input.domain.profile && input.domain.goalContract && input.domain.mandate),
      ...(input.domain.profile ? { trainingExperience: input.domain.profile.value.trainingExperience } : {}),
      ...(input.domain.goalContract ? { primaryGoal: input.domain.goalContract.value.primaryGoal } : {}),
      ...(input.domain.mandate ? { mandateMode: input.domain.mandate.value.mode } : {}),
      locations: input.domain.profile?.value.locations?.length ?? 0,
      customExercises: input.domain.customExercises.length,
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
    },
  };
}

function buildToday(input: {
  date: string;
  domain: DomainProjection;
  session?: SessionPrescriptionData;
  activeWorkout?: WorkoutProjection;
  completedWorkout?: WorkoutOutcomeProductSummary;
  activityLog: TimelineActivityLog;
  safetyReason?: string;
  exerciseLabel: (exerciseVariantId: string) => string;
}): TodayProductProjection {
  if (!input.domain.profile || !input.domain.goalContract || !input.domain.mandate) {
    return { date: input.date, state: "onboarding_required", action: "open_onboarding", activityLog: input.activityLog };
  }
  if (input.safetyReason) {
    return { date: input.date, state: "safety_hold", action: "view_reason", activityLog: input.activityLog, reason: input.safetyReason };
  }
  if (!input.domain.plan || input.domain.planStatus === "stale_goal_contract") {
    return {
      date: input.date,
      state: "planner_hold",
      action: "view_reason",
      activityLog: input.activityLog,
      reason: input.domain.planStatus === "stale_goal_contract" ? "当前目标已更新，需要重新生成计划" : "还没有可执行的今日计划",
    };
  }
  if (input.activeWorkout?.status === "completed" || input.activeWorkout?.status === "partial") {
    return {
      date: input.date,
      state: "completed",
      action: "view_summary",
      activityLog: input.activityLog,
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
        completedWorkout: input.completedWorkout,
      };
    }
    return { date: input.date, state: "rest", action: "record_activity", activityLog: input.activityLog };
  }
  const product = productSession(input.session, input.exerciseLabel);
  if (input.session.kind === "cardio") {
    return { date: input.date, state: "activity", action: "record_activity", activityLog: input.activityLog, session: product };
  }
  if (input.session.kind === "rest" || input.session.kind === "recovery") {
    return { date: input.date, state: "rest", action: "record_activity", activityLog: input.activityLog, session: product };
  }
  return {
    date: input.date,
    state: "workout",
    action: input.activeWorkout?.status === "active" || input.activeWorkout?.status === "paused" ? "continue_workout" : "start_workout",
    activityLog: input.activityLog,
    session: product,
    ...(input.activeWorkout ? { activeWorkout: { id: input.activeWorkout.id, status: input.activeWorkout.status } } : {}),
  };
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
  session: SessionPrescriptionData,
  exerciseLabel: (exerciseVariantId: string) => string,
): ProductSession {
  const tasks = session.tasks.map((task) => {
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
    ...(session.durationBudget ? { estimatedMinutes: durationMinutes(session.durationBudget) } : {}),
    taskCount: tasks.length,
    totalSetCount: session.tasks.reduce((sum, task) => sum + task.sets.length, 0),
    tasks,
  };
}

function durationMinutes(duration: { value: number; unit: string }): number | undefined {
  if (duration.unit === "minutes") return duration.value;
  if (duration.unit === "seconds") return Math.ceil(duration.value / 60);
  return undefined;
}

function sessionsForDate(sessions: readonly SessionPrescriptionData[], date: string): readonly SessionPrescriptionData[] {
  return sessions.filter((session) => session.scheduledFor === date);
}

function sessionsForDates(sessions: readonly SessionPrescriptionData[], dates: readonly string[]): readonly SessionPrescriptionData[] {
  const index = new Set(dates);
  return sessions.filter((session) => index.has(session.scheduledFor));
}

function workoutForSession(
  workouts: readonly WorkoutProjection[],
  sessionId: string | undefined,
): WorkoutProjection | undefined {
  if (!sessionId) return undefined;
  return [...workouts]
    .filter((workout) => workout.prescriptionRef.sessionPrescriptionId === sessionId)
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
    case "training": return "训练记录";
    case "activity": return fact.activityType;
    case "nutrition": return fact.mealDescription ?? "饮食记录";
    case "sleep": return "睡眠";
    case "body": return fact.measurement.metric === "body_weight" ? "体重" : fact.measurement.metric === "body_fat_percentage" ? "体脂" : fact.measurement.site;
    case "recovery": return "恢复记录";
    case "symptom": return "身体反馈";
    case "schedule": return "日程变更";
    case "rest": return "休息";
  }
}
