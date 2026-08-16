import {
  buildCoachProductProjection,
  type CalendarPresentationMode,
  type CoachProductProjection,
} from "../product";
import { HumanActionCoordinator } from "./hitl";
import { MemoryCurator, type UpsertMemoryInput } from "./memory";
import { planCoachStateSweep } from "./stateSweep";
import {
  type CoachLedger,
  type DomainAtomicCommit,
  InMemoryCoachLedger,
  LedgerConflictError,
  RecordingCoachLedger,
} from "./ledger";
import type {
  Artifact,
  ContextRef,
  EvidenceBriefArtifact,
  FactRef,
  HealthImportState,
  HealthMetric,
  LedgerSnapshot,
  PlanRevision,
  PresentationRef,
  RuntimeServices,
  TimelineEvent,
  UserProfile,
} from "./model";
import {
  BACKGROUND_TRACE_SESSION_ID,
  buildBehaviorDecisionRecord,
  traceUserPseudonym,
  type BehaviorDecisionTraceRecorder,
} from "../observability";
import {
  DOMAIN_EVENT_SCHEMA_VERSION,
  projectDomainEvents,
  validateBaselineIntake,
  type DomainCommand,
  type DomainCommandResult,
  type DomainAggregateKind,
  type DataLifecycleStatus,
  type DomainEvent,
  type DomainProjection,
  type DomainProjectionQuery,
  type OutboxEntry,
} from "./domain";
import {
  type LocalProductKernelPorts,
  type HealthDataPort,
  type HealthConnectionState,
  type HealthEvidencePage,
  type NormalizedHealthEvidence,
  type NotificationPort,
  type SecureCredentialPort,
} from "./ports";
import {
  buildPrivacySettingsOverview,
  ClientSidePortableBackupService,
  PortableDataService,
  type ClientSidePortableBackup,
  type PrivacySettingsOverview,
} from "../privacy";
import { clone, stableHash } from "./stable";
import { goalPathSignalSummary } from "./goalPathCopy";
import {
  createInstalledKnowledgePack,
  createKnowledgePackRegistry,
  KnowledgePackRegistry,
  type CustomExerciseVariantView,
  type ExerciseSearchInput,
  type KnowledgePackLoadResult,
  type KnowledgePackSourcePort,
  type MovementPattern,
  type SubstitutionInput,
} from "../knowledge";
import {
  buildPlanningOutcomeContext,
  assertFixedPlanSafety,
  deriveGoalEnergyGuardrail,
  validateAdaptivePlanCandidate,
  assessMuscleWeek,
  assessRecoveryContext,
  fatigueContributionsForExercise,
  type MuscleWeekReport,
  type AdaptivePlanCandidate,
  type PlanOutcome,
} from "../planning";
import {
  TrainingRulePackRegistry,
  type RuleDecision,
  type RuleEvaluationContext,
} from "../training-rules";
import {
  deriveBodyTrends,
  factHasNoCompletedClaim,
  selectPrimarySourceFacts,
  timelineActivityLog,
  timelineRange,
  timelineSourceIdentity,
  toTimelineSyncPayload,
  type PrimarySourcePreferences,
  type TimelineAppendInput,
  type TimelineCorrection,
  type TimelineExport,
  type TimelineFactEnvelope,
  type TimelineSourceMutation,
} from "../timeline";
import {
  applyUpcomingWorkoutPlanChange,
  assertOnlyUpcomingPlannedSessionChanged,
  deriveSessionOutcome,
  hasExpiredRecoveryWindow,
  newWorkoutState,
  remainingRestSeconds,
  transitionWorkoutState,
} from "../workout";
import {
  deriveRecoveryTimelineEvidence,
  deriveDailyEvaluation,
  evaluateRecovery,
  type RecoveryCheckIn,
  type RecoveryRulePack,
} from "../recovery";
import {
  createNutritionStrategy,
  assertNutrientValues,
  deriveNutritionDayPlan,
  type NutritionSafetyScreen,
  type NutritionStrategyRulePack,
} from "../nutrition";
import { projectDailyHealthLedger, projectHealthTrends } from "../health";
import { GoalPathModule, goalDeadlineForWeeks, goalPathAggregateRefs, negotiateGoalPaths, projectPlanExecutionEvidence, strengthTargetProgress, type GoalPathAssessment, type GoalPathOption } from "../goal-path";
import { defaultSuccessMetrics } from "../goal-path/plateauPolicy";
import {
  deriveMetricRegistry,
  weeklyCoachReport,
} from "../replanning";
import { LocalRecipeEngine } from "../scheduling";

const DEFAULT_KNOWLEDGE_REGISTRY = new KnowledgePackRegistry(createInstalledKnowledgePack());

export interface LocalProductKernelDependencies extends LocalProductKernelPorts {
  knowledgeRegistry?: KnowledgePackRegistry;
  /** 本地安装的知识包来源（ticket 02）；配置后按 内置兜底 + 数据包覆盖 加载。 */
  knowledgePackSource?: KnowledgePackSourcePort;
  /** 个人知识层（ticket 05）：实测休息等校准值的沉淀处；缺省不启用。 */
  personalKnowledge?: import("../knowledge/personalLayer").PersonalKnowledgeLayer;
  trainingRuleRegistry?: TrainingRulePackRegistry;
  /** Optional audit adapter; its failure must never block Timeline admission. */
  behaviorDecisionRecorder?: BehaviorDecisionTraceRecorder;
  /** Set only by AuthRoot's account-scoped runtime composition. */
  authenticatedAccountId?: string;
  /**
   * Product-only post-review ingress. The kernel first performs the fixed
   * GoalPath review; this callback may ask the conversation module to render
   * an already-material signal. Its failure never changes the accepted fact.
   */
  afterFixedGoalPathReview?(input: { userId: string; causationId: string }): Promise<void>;
}

export interface SeedDomainStateForTestInput {
  userId: string;
  profile: UserProfile;
  plan: PlanRevision;
  timeline?: readonly TimelineEvent[];
}

/**
 * Local owner of domain commands, projections and fixed decision engines.
 * Pi owns the Agent loop; mobile composition wires its narrow modules into
 * this local kernel rather than recreating a second application runtime.
 */
export class LocalProductKernel {
  private readonly humanActions: HumanActionCoordinator;
  private readonly memory: MemoryCurator;
  private readonly ledger: CoachLedger;
  private readonly runtime: RuntimeServices;
  private readonly health?: HealthDataPort;
  private readonly notifications?: NotificationPort;
  private readonly authenticatedAccountId?: string;
  private readonly credentials?: SecureCredentialPort;
  private readonly monotonicClock: NonNullable<LocalProductKernelPorts["monotonicClock"]>;
  private readonly knowledge: KnowledgePackRegistry;
  private knowledgePackLoad: KnowledgePackLoadResult | null;
  private readonly personalKnowledge?: import("../knowledge/personalLayer").PersonalKnowledgeLayer;
  private readonly trainingRules: TrainingRulePackRegistry;
  private readonly recipes: LocalRecipeEngine;
  private readonly goalPath: GoalPathModule;
  private readonly behaviorDecisionRecorder?: BehaviorDecisionTraceRecorder;
  private readonly portableData: PortableDataService;
  private readonly clientSideBackup?: ClientSidePortableBackupService;
  private readonly dependencies: LocalProductKernelDependencies;

  constructor(ledger: CoachLedger, runtime: RuntimeServices);
  constructor(dependencies: LocalProductKernelDependencies);
  constructor(first: CoachLedger | LocalProductKernelDependencies, second?: RuntimeServices) {
    const dependencies: LocalProductKernelDependencies = "ledger" in first
      ? first
      : { ledger: first, runtime: second ?? missingRuntime() };
    this.dependencies = dependencies;
    this.ledger = dependencies.ledger;
    this.runtime = dependencies.runtime;
    this.health = dependencies.health;
    this.notifications = dependencies.notifications;
    this.authenticatedAccountId = dependencies.authenticatedAccountId;
    this.credentials = dependencies.credentials;
    this.monotonicClock = dependencies.monotonicClock ?? { nowMs: () => Date.now() };
    this.personalKnowledge = dependencies.personalKnowledge;
    this.knowledgePackLoad = null;
    if (dependencies.knowledgeRegistry) {
      this.knowledge = dependencies.knowledgeRegistry;
    } else if (dependencies.knowledgePackSource) {
      const { registry, load } = createKnowledgePackRegistry(dependencies.knowledgePackSource);
      this.knowledge = registry;
      this.knowledgePackLoad = load;
    } else {
      this.knowledge = DEFAULT_KNOWLEDGE_REGISTRY;
    }
    this.trainingRules =
      dependencies.trainingRuleRegistry ?? new TrainingRulePackRegistry(this.knowledge.versionPins());
    const tokenPrimitive = dependencies.actionTokens ?? {
      issue: (claims: Parameters<NonNullable<LocalProductKernelPorts["actionTokens"]>["issue"]>[0]) =>
        stableHash(claims),
    };
    this.humanActions = new HumanActionCoordinator(
      this.ledger,
      this.runtime,
      tokenPrimitive,
      () => knowledgeRuleVersions(this.knowledge.versionPins()),
    );
    this.memory = new MemoryCurator(this.ledger, this.runtime);
    this.recipes = new LocalRecipeEngine(
      this.ledger,
      this.runtime,
      this.notifications,
      dependencies.backgroundScheduler,
      () => knowledgeRuleVersions(this.knowledge.versionPins()),
    );
    this.goalPath = new GoalPathModule();
    this.behaviorDecisionRecorder = dependencies.behaviorDecisionRecorder;
    this.portableData = new PortableDataService(this.ledger, this.runtime);
    this.clientSideBackup = dependencies.backupCrypto
      ? new ClientSidePortableBackupService(this.portableData, dependencies.backupCrypto)
      : undefined;
  }

  async readMetricRegistry(input: {
    userId: string;
    startDate: string;
    endDate: string;
  }): Promise<readonly import("../replanning").MetricEnvelope[]> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    return deriveMetricRegistry({ domain: projection, startDate: input.startDate, endDate: input.endDate, ruleVersion: "maxpower.metrics.v1" });
  }

  async createWeeklyCoachReport(input: {
    userId: string;
    weekStart: string;
    weekEnd: string;
    idempotencyKey: string;
  }): Promise<import("./model").WeeklyCoachReportArtifact> {
    const existing = await this.findPersistedWeeklyCoachReport(input.userId, input.idempotencyKey);
    if (existing) return existing;
    if (input.weekEnd < input.weekStart) throw new Error("invalid_weekly_report_window");
    const snapshot = await this.ledger.read();
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const frontier = await this.currentDomainFrontier(input.userId);
    const setOutcomeIds = new Set(
      snapshot.domainEvents
        .filter(
          (event): event is Extract<DomainEvent, { name: "workout.set_recorded" }> =>
            event.userId === input.userId &&
            event.name === "workout.set_recorded" &&
            occurredOnDate(event.occurredAt, input.weekStart, input.weekEnd),
        )
        .map((event) => event.payload.outcome.id),
    );
    const timelineEvents = projection.timeline.current.filter((event) =>
      occurredOnDate(event.occurredAt, input.weekStart, input.weekEnd),
    );
    const report = weeklyCoachReport({
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      plan: projection.plan?.value,
      workouts: projection.workouts,
      performedSetOutcomeIds: [...setOutcomeIds],
      timelineEventCount: timelineEvents.length,
      recoveryLevels: projection.recoveryConstraints.map((constraint) => constraint.value.level),
      nutritionStatus: projection.nutritionStrategies.at(-1)?.value.status,
      factRefs: frontierFactRefs(frontier),
    });
    const createdAt = this.runtime.now();
    const artifact: import("./model").WeeklyCoachReportArtifact = {
      id: `weekly-report-${stableHash({ userId: input.userId, weekStart: input.weekStart, weekEnd: input.weekEnd, frontier })}`,
      kind: "weekly_coach_report",
      userId: input.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt,
      contextRefs: [{ kind: "plan", ref: input.weekStart }],
      evidenceRefs: report.factRefs,
      missingness: report.dataCoverage === "complete" ? [] : ["week_data_coverage_incomplete"],
      capabilityBoundary: ["仅汇总已确认的训练与记录", "不推断训练有效性或健康状态"],
      hash: stableHash(report),
      knowledgePins: this.knowledge.versionPins(),
      report,
      window: { start: input.weekStart, end: input.weekEnd },
      idempotencyKey: input.idempotencyKey,
    };
    const result = await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "replanner",
      intent: "weekly.report",
      expectedRevisions: frontier,
      domainEvents: [],
      artifacts: [artifact],
      idempotencyKey: input.idempotencyKey,
      recordedAt: createdAt,
    });
    if (result.status === "idempotent") {
      const replay = await this.findPersistedWeeklyCoachReport(input.userId, input.idempotencyKey);
      if (replay) return replay;
      throw new Error("weekly_report_idempotency_artifact_missing");
    }
    return artifact;
  }

  /**
   * Closed weekly review entry point for a user action or a local recipe. The
   * report is an immutable summary; the separate replan evaluation can only
   * propose a diff through the ordinary mandate/policy path.
   */
  async runWeeklyReview(input: {
    userId: string;
    weekStart: string;
    weekEnd: string;
    idempotencyKey: string;
    timezoneOffsetMinutes?: number;
  }): Promise<{ report: import("./model").WeeklyCoachReportArtifact; assessment?: GoalPathAssessment }> {
    const report = await this.createWeeklyCoachReport({
      userId: input.userId,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      idempotencyKey: input.idempotencyKey,
    });
    const projection = await this.readDomainProjection({ userId: input.userId });
    const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? timezoneOffsetForInstant(this.runtime.now());
    const occurredAt = localNoonToIso(input.weekEnd, timezoneOffsetMinutes);
    const assessment = projection.profile && projection.goalContract && projection.mandate
      ? (await this.reviewAndDeliverGoalPath({
          userId: input.userId,
          trigger: "weekly",
          channel: "scheduled",
          idempotencyKey: `goal-path:weekly:${input.idempotencyKey}`,
          timezoneOffsetMinutes,
        })).assessment
      : undefined;
    await this.enqueueDefaultRecipe({
      userId: input.userId,
      kind: "weekly_review",
      occurredAt,
      causationId: report.id,
      idempotencyKey: `recipe:weekly_review:${input.idempotencyKey}`,
      timezoneOffsetMinutes,
    });
    return { report, assessment };
  }

  /** Shared typed Draft used by manual forms and Coach transcription before Timeline admission. */
  async createTimelineRecordDraft(input: {
    userId: string;
    idempotencyKey: string;
    fact: import("./domain").TimelineFact;
    occurredAt: string;
    source: "manual_form" | "user_statement";
  }): Promise<import("./model").TimelineRecordDraftArtifact> {
    const snapshot = await this.ledger.read();
    const existing = snapshot.artifacts.find((artifact): artifact is import("./model").TimelineRecordDraftArtifact => artifact.kind === "timeline_record_draft" && artifact.userId === input.userId && artifact.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const artifact = this.buildTimelineRecordDraftArtifact({ userId: input.userId, idempotencyKey: input.idempotencyKey, fact: input.fact, occurredAt: input.occurredAt, source: input.source, contextRefs: [{ kind: "today", ref: input.occurredAt.slice(0, 10) }], identity: {} });
    await this.ledger.commit({
      kind: "domain", userId: input.userId, actorId: input.userId, intent: "timeline.record_draft.create", expectedRevisions: [], domainEvents: [], artifacts: [artifact],
      presentations: [{ id: `presentation:${artifact.id}`, artifactId: artifact.id, renderer: "timeline_record_draft/1", status: "awaiting_user" }],
      idempotencyKey: input.idempotencyKey, recordedAt: this.runtime.now(),
    });
    return artifact;
  }

  private buildTimelineRecordDraftArtifact(input: {
    userId: string;
    idempotencyKey: string;
    fact: import("./domain").TimelineFact;
    occurredAt: string;
    source: "manual_form" | "user_statement";
    contextRefs: readonly ContextRef[];
    identity: { sessionId?: string; toolCallId?: string };
  }): import("./model").TimelineRecordDraftArtifact {
    const draft = { fact: input.fact, occurredAt: input.occurredAt, source: input.source };
    return {
      id: `timeline-record-draft:${stableHash({ ...input.identity, userId: input.userId, draft })}`,
      kind: "timeline_record_draft", userId: input.userId, idempotencyKey: input.idempotencyKey,
      schemaVersion: 1, renderVersion: 1, createdAt: this.runtime.now(), contextRefs: input.contextRefs,
      evidenceRefs: [], missingness: ["explicit_user_confirmation_required"],
      capabilityBoundary: ["确认后才会写入 Timeline。", "没有明确提供的数值保持未知；Agent 不得估算后复用这条确认路径写入。"],
      hash: stableHash(draft), knowledgePins: this.knowledge.versionPins(), draft,
    };
  }

  async confirmTimelineRecordDraft(input: {
    userId: string;
    artifactId: string;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (item): item is import("./model").TimelineRecordDraftArtifact =>
        item.id === input.artifactId && item.kind === "timeline_record_draft" && item.userId === input.userId,
    );
    if (!artifact) throw new Error("timeline_record_draft_not_found");
    const result = await this.recordTimelineFact({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      confirmedByUser: true,
      fact: artifact.draft.fact,
      envelope: {
        time: { startedAt: artifact.draft.occurredAt, timezoneOffsetMinutes: new Date(artifact.draft.occurredAt).getTimezoneOffset() * -1 },
        provenance: {
          origin: "manual",
          sourceRecordId: `timeline-record-draft:${artifact.id}`,
          recordingMethod: "manual_entry",
          dataStatus: "available",
          confidence: "confirmed",
        },
        privacyClass: "sensitive",
        causalRefs: [`timeline_record_draft:${artifact.id}`, "user_confirmed_record_draft"],
        evidenceRefs: [],
        layer: "raw_observation",
      },
    });
    await this.updateTimelineRecordDraftPresentation({ userId: input.userId, snapshot, artifactId: artifact.id, status: "applied", idempotencyKey: `${input.idempotencyKey}:presentation` });
    return result;
  }

  async rejectTimelineRecordDraft(input: {
    userId: string;
    artifactId: string;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (item): item is import("./model").TimelineRecordDraftArtifact =>
        item.id === input.artifactId && item.kind === "timeline_record_draft" && item.userId === input.userId,
    );
    if (!artifact) throw new Error("timeline_record_draft_not_found");
    const now = this.runtime.now();
    const projection = await this.readDomainProjection({ userId: input.userId });
    const presentation = snapshot.presentations.find((item) => item.artifactId === artifact.id && item.renderer === "timeline_record_draft/1");
    return this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "timeline.record_draft.reject",
      expectedRevisions: [],
      domainEvents: [],
      ...(presentation ? { presentations: [{ ...presentation, status: "rejected" as const }] } : {}),
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "user",
        action: "timeline.draft.rejected",
        targetType: "timeline",
        targetId: artifact.id,
        scope: "timeline:user_stated:confirmation_required",
        intent: "timeline.record_draft.reject",
        before: { artifactId: artifact.id, status: "draft" },
        after: { artifactId: artifact.id, status: "rejected" },
        evidenceRefs: [],
        beforeRefs: [],
        afterRefs: [],
        ruleVersions: knowledgeRuleVersions(this.knowledge.versionPins()),
        mandateRevision: projection.mandate?.revision ?? 0,
        result: "rejected",
        undoBoundary: "not_applicable",
        policyDecision: "allow",
        humanDecision: "rejected",
        causationId: artifact.id,
        correlationId: `timeline:${input.idempotencyKey}`,
        reversible: false,
      }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
  }

  private async updateTimelineRecordDraftPresentation(input: {
    userId: string;
    snapshot: Awaited<ReturnType<CoachLedger["read"]>>;
    artifactId: string;
    status: "applied" | "rejected";
    idempotencyKey: string;
  }): Promise<void> {
    const presentation = input.snapshot.presentations.find(
      (item) => item.artifactId === input.artifactId && item.renderer === "timeline_record_draft/1",
    );
    if (!presentation || presentation.status === input.status) return;
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "coach_kernel",
      intent: "timeline.record_draft.presentation",
      expectedRevisions: [],
      domainEvents: [],
      presentations: [{ ...presentation, status: input.status }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: this.runtime.now(),
    });
  }

  private async findPersistedWeeklyCoachReport(
    userId: string,
    idempotencyKey: string,
  ): Promise<import("./model").WeeklyCoachReportArtifact | undefined> {
    const snapshot = await this.ledger.read();
    const committed = snapshot.domainIdempotency.some(
      (record) =>
        record.userId === userId &&
        record.actorId === "replanner" &&
        record.intent === "weekly.report" &&
        record.key === idempotencyKey,
    );
    if (!committed) return undefined;
    return snapshot.artifacts.find(
      (artifact): artifact is import("./model").WeeklyCoachReportArtifact =>
        artifact.kind === "weekly_coach_report" &&
        artifact.userId === userId &&
        artifact.idempotencyKey === idempotencyKey,
    );
  }

  private async currentDomainFrontier(userId: string): Promise<import("./domain").DomainAggregateRef[]> {
    const snapshot = await this.ledger.read();
    return snapshot.aggregateRevisions
      .filter((item) => item.userId === userId)
      .map(({ kind, id, revision }) => ({ kind, id, revision }))
      .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  }

  evaluateTrainingRule(context: RuleEvaluationContext): RuleDecision {
    return this.trainingRules.evaluate(context);
  }

  /** Deterministic, non-diagnostic constraint assessment; it never edits a plan by itself. */
  evaluateRecoveryCheckIn(input: {
    userId: string;
    checkIn: RecoveryCheckIn;
    validUntil: string;
    factRefs?: readonly string[];
    rulePack?: RecoveryRulePack;
  }) {
    const now = this.runtime.now();
    return evaluateRecovery({
      id: this.runtime.nextId("recovery-constraint"),
      evaluatedAt: now,
      validUntil: input.validUntil,
      checkIn: input.checkIn,
      factRefs: input.factRefs,
      rulePack: input.rulePack,
    });
  }

  /**
   * Rebuilds a recovery evaluation exclusively from committed Timeline facts
   * plus an optional current user check-in.  Platform adapters never call
   * this directly: they only import normalized evidence, and the Facade owns
   * the later local rule evaluation.
   */
  async evaluateRecoveryFromTimeline(input: {
    userId: string;
    validUntil: string;
    checkIn?: RecoveryCheckIn;
    id?: string;
    rulePack?: RecoveryRulePack;
  }): Promise<{
    evidence: import("../recovery").RecoveryTimelineEvidence;
    decision: ReturnType<typeof evaluateRecovery>;
  }> {
    if (!Number.isFinite(Date.parse(input.validUntil))) throw new Error("invalid_recovery_valid_until");
    const now = this.runtime.now();
    if (!Number.isFinite(Date.parse(now))) throw new Error("invalid_recovery_evaluation_time");
    const projection = await this.readDomainProjection({ userId: input.userId });
    const evidence = deriveRecoveryTimelineEvidence({
      events: projection.timeline.events,
      now,
      primarySources: projection.profile?.value.primaryDataSources,
      ...(input.checkIn ? { checkIn: input.checkIn } : {}),
      ...(input.rulePack ? { rulePack: input.rulePack } : {}),
    });
    const performance = comparablePerformanceRecoveryEvidence(projection.workouts);
    const checkIn = {
      ...evidence.checkIn,
      ...(input.checkIn ?? {}),
      ...(input.checkIn?.comparablePerformanceDeclines === undefined && performance.declines > 0
        ? { comparablePerformanceDeclines: performance.declines }
        : {}),
    };
    const decision = evaluateRecovery({
      id: input.id ?? this.runtime.nextId("recovery-constraint"),
      evaluatedAt: now,
      validUntil: input.validUntil,
      checkIn,
      factRefs: [...evidence.factRefs, ...performance.factRefs],
      evidence: {
        ...evidence.attribution,
        corroboratingFactRefs: [...(evidence.attribution.corroboratingFactRefs ?? []), ...performance.factRefs],
      },
      ...(input.rulePack ? { rulePack: input.rulePack } : {}),
    });
    return { evidence, decision };
  }

  async evaluateDailyRecovery(input: {
    userId: string;
    date: string;
    validUntil: string;
    timezoneOffsetMinutes: number;
    checkIn?: RecoveryCheckIn;
    idempotencyKey?: string;
    rulePack?: RecoveryRulePack;
  }): Promise<{
    evaluation: import("../recovery").DailyEvaluation;
    evidence: import("../recovery").RecoveryTimelineEvidence;
    decision: ReturnType<typeof evaluateRecovery>;
  }> {
    const recovered = await this.evaluateRecoveryFromTimeline({
      userId: input.userId,
      validUntil: input.validUntil,
      ...(input.checkIn ? { checkIn: input.checkIn } : {}),
      ...(input.idempotencyKey ? { id: `recovery-constraint:${input.idempotencyKey}` } : {}),
      ...(input.rulePack ? { rulePack: input.rulePack } : {}),
    });
    const domain = await this.readDomainProjection({ userId: input.userId });
    const nutrition = await this.readNutritionDayLedger({
      userId: input.userId,
      date: input.date,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    });
    const session = domain.plan?.value.sessions.find((candidate) => candidate.scheduledFor === input.date);
    const workout = domain.workouts.find((candidate) => candidate.frozenPrescription.id === session?.id && (candidate.status === "active" || candidate.status === "paused"));
    const evaluation = deriveDailyEvaluation({
      id: input.idempotencyKey ? `daily-evaluation:${input.idempotencyKey}` : this.runtime.nextId("daily-evaluation"),
      date: input.date,
      recovery: recovered.decision,
      nutrition: nutrition.ledger,
      ...(session?.kind ? { plannedSessionKind: session.kind } : {}),
      hasStartedSet: Boolean(workout?.setOutcomes.length),
      factRefs: recovered.evidence.factRefs,
      nextReviewAt: input.validUntil,
    });
    return { evaluation, ...recovered };
  }

  /**
   * Bounded entry point for the native morning job. It only inspects already
   * imported local facts and creates a privacy-safe notification job; it does
   * not import Health data, call a Provider, evaluate a diagnosis, or commit a
   * recovery constraint. A missing fresh wearable series deliberately becomes
   * a simple user check-in prompt.
   */
  async triggerMorningRecoveryCheckIn(input: {
    userId: string;
    occurredAt?: string;
    timezoneOffsetMinutes?: number;
  }): Promise<{ recoveryEvidence: "available" | "unavailable" }> {
    const occurredAt = input.occurredAt ?? this.runtime.now();
    if (!Number.isFinite(Date.parse(occurredAt))) throw new Error("invalid_morning_recipe_time");
    const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? timezoneOffsetForInstant(occurredAt);
    const projection = await this.readDomainProjection({ userId: input.userId });
    const evidence = deriveRecoveryTimelineEvidence({
      events: projection.timeline.events,
      now: occurredAt,
      primarySources: projection.profile?.value.primaryDataSources,
    });
    const recoveryEvidence = evidence.series.some(
      (series) =>
        series.freshness === "fresh" &&
        (series.source.origin === "health_connect" || series.source.origin === "healthkit"),
    )
      ? "available" as const
      : "unavailable" as const;
    const localDate = localDateAtTimezoneOffset(occurredAt, timezoneOffsetMinutes);
    await this.enqueueDefaultRecipe({
      userId: input.userId,
      kind: "morning_check_in",
      occurredAt,
      causationId: `morning:${input.userId}:${localDate}`,
      idempotencyKey: `recipe:morning_check_in:${input.userId}:${localDate}`,
      timezoneOffsetMinutes,
      recoveryEvidence,
    });
    return { recoveryEvidence };
  }

  /**
   * Records the user's raw, non-diagnostic check-in before evaluating it. The
   * resulting constraint is a fact-derived input for the planner; it never
   * edits a plan or an in-progress set on its own.
   */
  async submitRecoveryCheckIn(input: {
    userId: string;
    idempotencyKey: string;
    occurredAt: string;
    validUntil: string;
    checkIn: RecoveryCheckIn;
    rulePack?: RecoveryRulePack;
    deviceId?: string;
  }): Promise<{
    timelineEventIds: readonly string[];
    decision: ReturnType<typeof evaluateRecovery>;
    constraintCommit: DomainCommandResult;
  }> {
    if (!Number.isFinite(Date.parse(input.occurredAt)) || !Number.isFinite(Date.parse(input.validUntil))) {
      throw new Error("invalid_recovery_checkin_time");
    }
    const baseEnvelope = {
      time: {
        startedAt: input.occurredAt,
        timezoneOffsetMinutes: new Date(input.occurredAt).getTimezoneOffset() * -1,
      },
      provenance: {
        origin: "manual" as const,
        recordingMethod: "manual_entry" as const,
        dataStatus: "available" as const,
        confidence: "confirmed" as const,
      },
      privacyClass: "sensitive" as const,
      causalRefs: ["recovery_checkin"],
      evidenceRefs: [],
      layer: "raw_observation" as const,
    };
    const recorded = await this.recordTimelineFact({
      userId: input.userId,
      idempotencyKey: `recovery-checkin:${input.idempotencyKey}:recovery`,
      deviceId: input.deviceId,
      fact: {
        kind: "recovery",
        ...(input.checkIn.perceivedRecovery !== undefined
          ? { perceivedRecovery: input.checkIn.perceivedRecovery }
          : {}),
        ...(input.checkIn.fatigue !== undefined ? { fatigue: input.checkIn.fatigue } : {}),
        confidence: "confirmed",
      },
      envelope: baseEnvelope,
    });
    const timelineEventIds = [...recorded.eventIds];
    if (input.checkIn.sleepDurationHours !== undefined) {
      const sleepRecorded = await this.recordTimelineFact({
        userId: input.userId,
        idempotencyKey: `recovery-checkin:${input.idempotencyKey}:sleep`,
        deviceId: input.deviceId,
        fact: {
          kind: "sleep",
          duration: { value: input.checkIn.sleepDurationHours, unit: "hours" },
          confidence: "confirmed",
        },
        envelope: {
          ...baseEnvelope,
          provenance: {
            ...baseEnvelope.provenance,
            sourceRecordId: `recovery-checkin:${input.idempotencyKey}:sleep`,
          },
          causalRefs: ["recovery_checkin", "subjective_sleep"],
        },
      });
      timelineEventIds.push(...sleepRecorded.eventIds);
    }
    if (input.checkIn.schedule?.availableMinutes !== undefined || input.checkIn.schedule?.location) {
      const scheduleRecorded = await this.recordTimelineFact({
        userId: input.userId,
        idempotencyKey: `recovery-checkin:${input.idempotencyKey}:availability`,
        deviceId: input.deviceId,
        fact: {
          kind: "schedule",
          effect: "availability_changed",
          note: JSON.stringify({
            ...(input.checkIn.schedule.availableMinutes === undefined
              ? {}
              : { availableMinutes: input.checkIn.schedule.availableMinutes }),
            ...(input.checkIn.schedule.location ? { location: input.checkIn.schedule.location } : {}),
          }),
          confidence: "confirmed",
        },
        envelope: {
          ...baseEnvelope,
          provenance: {
            ...baseEnvelope.provenance,
            sourceRecordId: `recovery-checkin:${input.idempotencyKey}:availability`,
          },
          causalRefs: ["recovery_checkin", "temporary_availability"],
        },
      });
      timelineEventIds.push(...scheduleRecorded.eventIds);
    }
    const symptoms = [
      input.checkIn.pain
        ? { kind: "pain" as const, value: input.checkIn.pain }
        : undefined,
      input.checkIn.soreness
        ? { kind: "soreness" as const, value: input.checkIn.soreness }
        : undefined,
    ].filter((item): item is { kind: "pain" | "soreness"; value: { area?: string; severity: number } } => item !== undefined);
    for (const symptom of symptoms) {
      const symptomRecorded = await this.recordTimelineFact({
        userId: input.userId,
        idempotencyKey: `recovery-checkin:${input.idempotencyKey}:symptom:${symptom.kind}`,
        deviceId: input.deviceId,
        fact: {
          kind: "symptom",
          symptom: symptom.kind,
          ...(symptom.value.area ? { area: symptom.value.area } : {}),
          severity: symptom.value.severity,
          confidence: "confirmed",
        },
        envelope: {
          ...baseEnvelope,
          provenance: {
            ...baseEnvelope.provenance,
            sourceRecordId: `recovery-checkin:${input.idempotencyKey}:symptom:${symptom.kind}`,
          },
          causalRefs: ["recovery_checkin", "subjective_symptom"],
        },
      });
      timelineEventIds.push(...symptomRecorded.eventIds);
    }
    const evaluation = await this.evaluateRecoveryFromTimeline({
      userId: input.userId,
      validUntil: input.validUntil,
      checkIn: input.checkIn,
      id: `recovery-constraint:${stableHash({ userId: input.userId, idempotencyKey: input.idempotencyKey })}`,
      ...(input.rulePack ? { rulePack: input.rulePack } : {}),
    });
    const decision = evaluation.decision;
    const constraintCommit = await this.commitRecoveryConstraint({
      userId: input.userId,
      constraint: decision.constraint,
      idempotencyKey: `recovery-checkin:${input.idempotencyKey}:constraint`,
    });
    return { timelineEventIds, decision, constraintCommit };
  }

  async commitRecoveryConstraint(input: {
    userId: string;
    constraint: import("./domain").RecoveryConstraintData;
    expectedRevision?: number;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const existing = projection.recoveryConstraints.find((item) => item.value.id === input.constraint.id);
    const result = await this.executeDomainCommand({
      type: "recovery_constraint.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      recoveryConstraintId: input.constraint.id,
      expectedRevision: input.expectedRevision ?? existing?.revision ?? 0,
      recoveryConstraint: input.constraint,
    });
    return result;
  }

  createNutritionStrategy(input: {
    id?: string;
    goalContractRef: import("./domain").NutritionStrategyData["goalContractRef"];
    phase: NonNullable<import("./domain").NutritionStrategyData["phase"]>;
    bodyMassKg?: number;
    estimatedMaintenanceKcal?: number;
    reviewWindow: NonNullable<import("./domain").NutritionStrategyData["reviewWindow"]>;
    safety: NutritionSafetyScreen;
    rulePack?: NutritionStrategyRulePack;
  }) {
    return createNutritionStrategy({
      ...input,
      id: input.id ?? this.runtime.nextId("nutrition-strategy"),
    });
  }

  async readDailyHealthLedger(input: {
    userId: string;
    date: string;
    timezoneOffsetMinutes: number;
  }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    return (await this.materializeDailyHealthLedgers(input.userId, projection, [input.date], input.timezoneOffsetMinutes))[input.date]!;
  }

  private projectDailyHealthLedgerFromDomain(
    projection: DomainProjection,
    date: string,
    timezoneOffsetMinutes: number,
    maintenanceCalibration?: { range: import("../health").ValueRange; version: string },
  ) {
    const strategy = [...projection.nutritionStrategies]
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0]?.value;
    const recoveryConstraint = [...projection.recoveryConstraints]
      .filter((item) => item.value.validUntil >= `${date}T00:00:00.000Z`)
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0]?.value;
    const nutritionPlan = deriveNutritionDayPlan({
      date,
      timezoneOffsetMinutes,
      ...(strategy ? { strategy } : {}),
      ...(this.plannedNutritionDayKind(projection, date, timezoneOffsetMinutes) ? { plannedDayKind: this.plannedNutritionDayKind(projection, date, timezoneOffsetMinutes) } : {}),
      ...(recoveryConstraint ? { recoveryConstraint } : {}),
    });
    return projectDailyHealthLedger({
      date,
      timezoneOffsetMinutes,
      timelineRevision: projection.timeline.revision,
      events: projection.timeline.current,
      nutritionPlan,
      ...(projection.profile ? { profile: projection.profile.value } : {}),
      ...(maintenanceCalibration ? { maintenanceCalibration } : {}),
    });
  }

  private plannedNutritionDayKind(projection: DomainProjection, date: string, timezoneOffsetMinutes: number): import("../nutrition").NutritionDayPlan["dayKind"] | undefined {
    if (projection.workouts.some((workout) => workout.outcome?.completedAt && localDateAtTimezoneOffset(workout.outcome.completedAt, timezoneOffsetMinutes) === date)) return "training";
    const session = projection.plan && (!projection.plan.value.lifecycle || projection.plan.value.lifecycle.state === "active")
      ? projection.plan.value.sessions.find((candidate) => candidate.scheduledFor === date)
      : undefined;
    if (session?.kind === "rest") return "rest";
    if (session?.kind === "recovery") return "recovery";
    if (session) return "training";
    const dates = projection.plan?.value.sessions.map((candidate) => candidate.scheduledFor).sort() ?? [];
    if (dates.length && date >= dates[0]! && date <= dates.at(-1)!) return "rest";
    return undefined;
  }

  private async materializeDailyHealthLedgers(
    userId: string,
    projection: DomainProjection,
    dates: readonly string[],
    timezoneOffsetMinutes: number,
  ): Promise<Readonly<Record<string, import("../health").DailyHealthLedger>>> {
    const uniqueDates = [...new Set(dates)].sort();
    const calibrations = this.personalEnergyCalibrationsForDates(projection, uniqueDates, timezoneOffsetMinutes);
    const ledgers = Object.fromEntries(uniqueDates.map((date) => [date, this.projectDailyHealthLedgerFromDomain(projection, date, timezoneOffsetMinutes, calibrations[date])])) as Record<string, import("../health").DailyHealthLedger>;
    const snapshot = await this.ledger.read();
    const known = new Set(snapshot.artifacts.flatMap((artifact) => artifact.kind === "daily_health_ledger" && artifact.userId === userId ? [artifact.ledger.version] : []));
    const createdAt = this.runtime.now();
    const artifacts = uniqueDates.flatMap((date) => {
      const ledger = ledgers[date]!;
      if (known.has(ledger.version)) return [];
      const artifact: import("./model").DailyHealthLedgerArtifact = {
        id: `daily-health-ledger:${userId}:${date}:${ledger.version}`,
        kind: "daily_health_ledger", userId, date, ledger, schemaVersion: 1, renderVersion: 1, createdAt,
        contextRefs: [{ kind: "today", ref: date }],
        evidenceRefs: projection.timeline.revision ? [{ aggregate: "timeline", id: `timeline.${userId}`, revision: projection.timeline.revision }] : [],
        missingness: Object.entries(ledger.coverage).flatMap(([field, status]) => status === "no_log" || status === "partial" ? [`${field}:${status}`] : []), capabilityBoundary: ["single_daily_health_ledger", "confirmed_structured_values_only", "missing_is_unknown"], hash: stableHash(ledger),
      };
      return [artifact];
    });
    if (artifacts.length) {
      await this.ledger.commit({ kind: "domain", userId, actorId: "daily_health_ledger", intent: "daily_health_ledger.materialize", expectedRevisions: [], domainEvents: [], artifacts, idempotencyKey: `daily-health-ledger:${stableHash(artifacts.map((artifact) => artifact.id))}`, recordedAt: createdAt });
    }
    return ledgers;
  }

  /** Projects an analysis window without turning every evaluated day into a durable artifact. */
  private projectHealthWindowFromDomain(
    projection: DomainProjection,
    startDate: string,
    endDate: string,
    timezoneOffsetMinutes: number,
  ) {
    const dates = datesBetween(startDate, endDate);
    const calibrations = this.personalEnergyCalibrationsForDates(projection, dates, timezoneOffsetMinutes);
    const ledgers = dates.map((date) => this.projectDailyHealthLedgerFromDomain(
      projection,
      date,
      timezoneOffsetMinutes,
      calibrations[date],
    ));
    return {
      ledgers,
      trends: projectHealthTrends({
        ledgers,
        timeline: projection.timeline.current,
        startDate,
        endDate,
        timezoneOffsetMinutes,
      }),
    };
  }

  private personalEnergyCalibrationsForDates(
    projection: DomainProjection,
    targetDates: readonly string[],
    timezoneOffsetMinutes: number,
  ): Readonly<Record<string, { range: import("../health").ValueRange; version: string }>> {
    if (!targetDates.length) return {};
    const sorted = [...new Set(targetDates)].sort();
    const rawStart = offsetDate(sorted[0]!, -28);
    const rawEnd = offsetDate(sorted.at(-1)!, -1);
    const raw = new Map(datesBetween(rawStart, rawEnd).map((date) => [date, this.projectDailyHealthLedgerFromDomain(projection, date, timezoneOffsetMinutes)]));
    return Object.fromEntries(sorted.flatMap((date) => {
      const startDate = offsetDate(date, -28);
      const endDate = offsetDate(date, -1);
      const ledgers = datesBetween(startDate, endDate).flatMap((candidate) => raw.get(candidate) ? [raw.get(candidate)!] : []);
      const trend = projectHealthTrends({ ledgers, timeline: projection.timeline.current, startDate, endDate, timezoneOffsetMinutes });
      return trend.calibration.status === "calibrated" && trend.calibration.maintenanceRange
        ? [[date, { range: trend.calibration.maintenanceRange, version: stableHash(trend.calibration) }] as const]
        : [];
    }));
  }

  async readNutritionDayLedger(input: {
    userId: string;
    date: string;
    timezoneOffsetMinutes: number;
  }) {
    const daily = await this.readDailyHealthLedger(input);
    return { plan: daily.nutritionPlan, ledger: daily.nutrition };
  }

  async readHealthTrends(input: {
    userId: string;
    startDate: string;
    endDate: string;
    timezoneOffsetMinutes: number;
  }) {
    if (input.endDate < input.startDate) throw new Error("health_trend_window_invalid");
    const dates = datesBetween(input.startDate, input.endDate);
    if (dates.length > 366) throw new Error("health_trend_window_too_large");
    const projection = await this.readDomainProjection({ userId: input.userId });
    return this.projectHealthWindowFromDomain(
      projection,
      input.startDate,
      input.endDate,
      input.timezoneOffsetMinutes,
    ).trends;
  }

  async reviewGoalPath(input: {
    userId: string;
    trigger?: GoalPathAssessment["trigger"];
    evaluatedAt?: string;
    timezoneOffsetMinutes?: number;
  }): Promise<GoalPathAssessment> {
    const snapshot = await this.assembleGoalPathSnapshot(input);
    return this.goalPath.review({ snapshot, trigger: input.trigger ?? "explicit_request" });
  }

  /**
   * The weekly muscle review is one structured artifact: UI renders it and the
   * Agent reads the same object. Only confirmed/imported completed sets enter
   * the ledger; planned data never does.
   */
  async readMuscleWeekReview(input: {
    userId: string;
    weekStartDate: string;
    weekEndDate: string;
  }): Promise<MuscleWeekReport> {
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const completedSets = domain.workouts
      .filter((workout) => workout.outcome?.completedAt)
      .map((workout) => ({
        completedAt: workout.outcome!.completedAt,
        outcomes: workout.setOutcomes,
      }));
    const wellnessNotes = domain.timeline.current
      .filter((event) => event.fact.kind === "wellness_note"
        && event.occurredAt.slice(0, 10) >= input.weekStartDate
        && event.occurredAt.slice(0, 10) <= input.weekEndDate)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
      .map((event) => {
        const fact = event.fact as Extract<typeof event.fact, { kind: "wellness_note" }>;
        return { occurredAt: event.occurredAt, note: fact.note, ...(fact.dimension ? { dimension: fact.dimension } : {}) };
      });
    return assessMuscleWeek({
      week: { startDate: input.weekStartDate, endDate: input.weekEndDate },
      completedSets,
      ...(domain.goalContract ? { goalContract: domain.goalContract.value } : {}),
      knowledgeVersion: this.knowledge.versionPins().exerciseCatalog.contentHash,
      exerciseById: (id) => this.knowledge.exerciseVariant(id),
      wellnessNotes,
    });
  }

  private async assembleGoalPathSnapshot(input: {
    userId: string;
    evaluatedAt?: string;
    timezoneOffsetMinutes?: number;
  }): Promise<import("../goal-path").GoalPathSnapshot> {
    const evaluatedAt = input.evaluatedAt ?? this.runtime.now();
    const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? 0;
    const endDate = new Date(Date.parse(evaluatedAt) + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
    const startDate = new Date(Date.parse(`${endDate}T00:00:00.000Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const nutritionStrategy = [...domain.nutritionStrategies]
      .filter((strategy) => !domain.goalContract || strategy.value.goalContractRef.id === domain.goalContract.value.id)
      .sort((left, right) => right.revision - left.revision)[0];
    const { trends } = this.projectHealthWindowFromDomain(domain, startDate, endDate, timezoneOffsetMinutes);
    return {
        userId: input.userId,
        evaluatedAt,
        domain,
        ...(domain.goalContract ? { goal: domain.goalContract } : {}),
        ...(domain.plan && domain.planStatus === "current" && (!domain.plan.value.lifecycle || domain.plan.value.lifecycle.state === "active") ? { plan: domain.plan } : {}),
        ...(nutritionStrategy ? { nutritionStrategy } : {}),
        ledgers: trends.daily,
        trends,
    };
  }

  async runDailyGoalPathReview(input: { userId: string; idempotencyKey: string; timezoneOffsetMinutes?: number }): Promise<GoalPathAssessment> {
    const delivered = await this.reviewAndDeliverGoalPath({
      userId: input.userId,
      trigger: "daily",
      channel: "scheduled",
      idempotencyKey: input.idempotencyKey,
      ...(input.timezoneOffsetMinutes !== undefined ? { timezoneOffsetMinutes: input.timezoneOffsetMinutes } : {}),
    });
    return delivered.assessment;
  }

  async readGoalPathAssessmentArtifacts(input: { userId: string }): Promise<readonly EvidenceBriefArtifact[]> {
    const snapshot = await this.ledger.read();
    return snapshot.artifacts.filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && artifact.userId === input.userId && Boolean(artifact.goalPathAssessment));
  }

  async readEvidenceBriefArtifact(input: { userId: string; artifactId: string }): Promise<EvidenceBriefArtifact> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief" && candidate.userId === input.userId && candidate.id === input.artifactId);
    if (!artifact) throw new Error("evidence_brief_not_found");
    return artifact;
  }

  /** The sole fixed input envelope consumed by first-plan and adjustment runs. */
  async readPlanningInput(input: {
    userId: string;
    mode: "first_plan" | "adjustment";
    evaluationDate?: string;
    sourceAssessment?: GoalPathAssessment;
  }): Promise<NonNullable<EvidenceBriefArtifact["planningInput"]>> {
    const evaluationDate = input.evaluationDate ?? this.runtime.now().slice(0, 10);
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const trendStartDate = offsetDate(evaluationDate, -27);
    const trends = this.projectHealthWindowFromDomain(domain, trendStartDate, evaluationDate, 0).trends;
    return this.planningInputFromEvidence({
      userId: input.userId,
      mode: input.mode,
      evaluationDate,
      domain,
      trends,
      artifacts: snapshot.artifacts,
      ...(input.sourceAssessment ? { sourceAssessment: input.sourceAssessment } : {}),
    });
  }

  /** 候选校验用的确定性恢复上下文（propose 与 confirm 双侧同一份）。 */
  private currentRecoveryContext(domain: DomainProjection): import("../planning").RecoveryContext {
    return assessRecoveryContext({
      evaluationDate: this.runtime.now().slice(0, 10),
      completedSets: domain.workouts
        .filter((workout) => workout.outcome?.completedAt)
        .map((workout) => ({ completedAt: workout.outcome!.completedAt, outcomes: workout.setOutcomes })),
      exerciseById: (id) => this.knowledge.exerciseVariant(id),
    });
  }

  /**
   * 只读：选中动作 + 组数/强度意图 → 各肌群主目标/协同/稳定肌相对负荷分列。
   * 关联未审校的动作列入 unknown，不猜测。永不写入。
   */
  estimateMuscleLoad(input: {
    userId: string;
    items: readonly { exerciseVariantId: string; workSets: number; effortIntent?: "low" | "moderate" | "high" }[];
  }): {
    policy: { id: string; version: string; evidenceTier: "D_product_policy"; unit: "relative_load" };
    perMuscle: readonly { muscleId: string; role: "primary_intent" | "secondary_intent" | "stabilizer"; relativeLoad: number }[];
    unknownExercises: readonly string[];
  } {
    const fatigueIntentOf = { low: "low", moderate: "medium", high: "high" } as const;
    const perMuscle = new Map<string, { role: "primary_intent" | "secondary_intent" | "stabilizer"; relativeLoad: number }>();
    const unknown: string[] = [];
    for (const item of input.items) {
      const exercise = this.knowledge.exerciseVariant(item.exerciseVariantId);
      if (!exercise || exercise.dataEligibility.expectedMuscleMetadata !== "reviewed") {
        unknown.push(item.exerciseVariantId);
        continue;
      }
      const contributions = fatigueContributionsForExercise({
        exercise,
        setCount: Math.max(0, Math.min(40, Math.round(item.workSets))),
        ...(item.effortIntent ? { fatigueIntent: fatigueIntentOf[item.effortIntent] } : {}),
      });
      for (const contribution of contributions) {
        const key = `${contribution.muscleId}:${contribution.role}`;
        const current = perMuscle.get(key) ?? { role: contribution.role, relativeLoad: 0 };
        perMuscle.set(key, { role: contribution.role, relativeLoad: Math.round((current.relativeLoad + contribution.relativeLoad) * 10) / 10 });
      }
    }
    return {
      policy: { id: "maxpower.relative-muscle-fatigue", version: "1.0.0", evidenceTier: "D_product_policy", unit: "relative_load" },
      perMuscle: [...perMuscle.entries()].map(([key, value]) => ({ muscleId: key.split(":")[0]!, ...value })),
      unknownExercises: unknown,
    };
  }

  /**
   * 只读：确认历史 + 可选草稿课次 → 逐日各肌群残差负荷与恢复窗提示。
   * 永不写入；草稿只是假设输入，不落账。
   */
  async forecastRecovery(input: {
    userId: string;
    horizonDays: number;
    draftSessions?: readonly { date: string; items: readonly { exerciseVariantId: string; workSets: number; effortIntent?: "low" | "moderate" | "high" }[] }[];
  }): Promise<{
    policy: { id: string; version: string };
    start: import("../planning").RecoveryContext;
    days: readonly { date: string; residualBefore: Readonly<Record<string, number>>; added: Readonly<Record<string, number>>; residualAfter: Readonly<Record<string, number>>; windowHints: readonly string[] }[];
  }> {
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const today = this.runtime.now().slice(0, 10);
    const completedSets = domain.workouts
      .filter((workout) => workout.outcome?.completedAt)
      .map((workout) => ({ completedAt: workout.outcome!.completedAt, outcomes: workout.setOutcomes }));
    const exerciseById = (id: string) => this.knowledge.exerciseVariant(id);
    const start = assessRecoveryContext({ evaluationDate: today, completedSets, exerciseById });
    const tierByMuscle = new Map(start.muscles.map((entry) => [entry.muscleId, entry]));
    const draftByDate = new Map((input.draftSessions ?? []).map((session) => [session.date, session]));
    const days: { date: string; residualBefore: Record<string, number>; added: Record<string, number>; residualAfter: Record<string, number>; windowHints: string[] }[] = [];
    let residual: Record<string, number> = Object.fromEntries(start.muscles.map((entry) => [entry.muscleId, entry.residualLoad]));
    const horizon = Math.max(1, Math.min(14, Math.round(input.horizonDays)));
    for (let index = 0; index < horizon; index += 1) {
      const date = index === 0 ? today : new Date(Date.parse(`${today}T00:00:00.000Z`) + index * 86_400_000).toISOString().slice(0, 10);
      const before: Record<string, number> = index === 0 ? { ...residual } : Object.fromEntries(Object.entries(residual).map(([muscle, value]): [string, number] => [muscle, Math.round(value * 0.62 * 10) / 10]).filter(([, value]) => value >= 0.1));
      const added: Record<string, number> = {};
      const draft = draftByDate.get(date);
      if (draft) {
        for (const item of draft.items) {
          const exercise = exerciseById(item.exerciseVariantId);
          if (!exercise || exercise.dataEligibility.expectedMuscleMetadata !== "reviewed") continue;
          const fatigueIntent = item.effortIntent === "low" ? "low" as const : item.effortIntent === "high" ? "high" as const : item.effortIntent === "moderate" ? "medium" as const : undefined;
          const contributions = fatigueContributionsForExercise({
            exercise,
            setCount: Math.max(0, Math.min(40, Math.round(item.workSets))),
            ...(fatigueIntent ? { fatigueIntent } : {}),
          });
          for (const contribution of contributions) {
            added[contribution.muscleId] = Math.round(((added[contribution.muscleId] ?? 0) + contribution.relativeLoad) * 10) / 10;
          }
        }
      }
      residual = { ...before };
      for (const [muscle, value] of Object.entries(added)) residual[muscle] = Math.round(((residual[muscle] ?? 0) + value) * 10) / 10;
      const windowHints = Object.keys(added).flatMap((muscle) => {
        const context = tierByMuscle.get(muscle);
        return context && before[muscle] !== undefined && before[muscle]! >= 60
          ? [`${muscle}: 残差 ${before[muscle]} RU 叠加新负荷（组均值窗 ${context.windowHours[0]}–${context.windowHours[1]}h）`]
          : [];
      });
      days.push({ date, residualBefore: before, added, residualAfter: { ...residual }, windowHints });
    }
    return {
      policy: { id: "maxpower.recovery-windows", version: "1.0.0" },
      start,
      days,
    };
  }

  private planningInputFromEvidence(input: {
    userId: string;
    mode: "first_plan" | "adjustment";
    evaluationDate: string;
    domain: DomainProjection;
    trends: ReturnType<typeof projectHealthTrends>;
    artifacts: readonly import("./model").Artifact[];
    sourceAssessment?: GoalPathAssessment;
  }): NonNullable<EvidenceBriefArtifact["planningInput"]> {
    const domain = input.domain;
    if (!domain.profile || !domain.goalContract || !domain.mandate) throw new Error("planning_facts_incomplete");
    const currentNutrition = [...domain.nutritionStrategies]
      .filter((strategy) => strategy.value.goalContractRef.id === domain.goalContract!.value.id)
      .sort((left, right) => right.revision - left.revision)[0];
    const latestLedger = [...input.trends.daily].filter((ledger) => ledger.date <= input.evaluationDate).sort((left, right) => right.date.localeCompare(left.date))[0];
    const allowedEnergyRange = deriveGoalEnergyGuardrail(domain.profile.value, domain.goalContract.value, input.trends.calibration.maintenanceRange);
    const sourceAssessment = input.sourceAssessment ?? (input.mode === "adjustment"
      ? [...input.artifacts]
          .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief" && artifact.userId === input.userId && Boolean(artifact.goalPathAssessment))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.goalPathAssessment?.assessment
      : undefined);
    return {
      mode: input.mode,
      evaluationDate: input.evaluationDate,
      profileRef: { id: domain.profile.value.id, revision: domain.profile.revision },
      goalContract: { revision: domain.goalContract.revision, value: domain.goalContract.value },
      mandate: { revision: domain.mandate.revision, planChangeAuthorization: domain.mandate.value.planChangeAuthorization },
      knowledgePins: this.knowledge.versionPins(),
      ...(domain.plan && domain.planStatus === "current" ? { planBase: { id: domain.plan.value.id, revision: domain.plan.revision } } : {}),
      ...(currentNutrition ? { nutritionStrategyBase: { id: currentNutrition.value.id, revision: currentNutrition.revision } } : {}),
      ...(allowedEnergyRange ? { allowedEnergyRange: { ...allowedEnergyRange, unit: "kcal" as const } } : {}),
      ...(latestLedger ? { latestLedger: { date: latestLedger.date, version: latestLedger.version, coverage: latestLedger.coverage, energyBalance: latestLedger.energyBalance } } : {}),
      ...(sourceAssessment ? { sourceAssessment: { id: sourceAssessment.id, state: sourceAssessment.state, diagnosis: sourceAssessment.diagnosis, reasonCodes: sourceAssessment.reasonCodes, nextValidationSignals: sourceAssessment.nextValidationSignals } } : {}),
      safetyBlocked: domain.safetyConstraints.some((constraint) => constraint.value.disposition !== "clear") || sourceAssessment?.materialSignal === "hard_safety",
      // 恢复上下文由确认记录 + 疲劳/恢复政策确定性注入——任何计划 run 必然
      // 携带它，不依赖模型自觉读取。
      recoveryContext: assessRecoveryContext({
        evaluationDate: input.evaluationDate,
        completedSets: domain.workouts
          .filter((workout) => workout.outcome?.completedAt)
          .map((workout) => ({ completedAt: workout.outcome!.completedAt, outcomes: workout.setOutcomes })),
        exerciseById: (id) => this.knowledge.exerciseVariant(id),
      }),
    };
  }

  /** One fixed review and delivery seam for Timeline hooks, Agent turns, and scheduled checks. */
  async reviewAndDeliverGoalPath(input: {
    userId: string;
    trigger: GoalPathAssessment["trigger"];
    channel: "agent_conversation" | "manual_home" | "scheduled";
    idempotencyKey: string;
    timezoneOffsetMinutes?: number;
    contextRef?: ContextRef;
  }): Promise<{ assessment: GoalPathAssessment; artifact: EvidenceBriefArtifact; delivered: boolean }> {
    const goalPathSnapshot = await this.assembleGoalPathSnapshot({
      userId: input.userId,
      ...(input.timezoneOffsetMinutes !== undefined ? { timezoneOffsetMinutes: input.timezoneOffsetMinutes } : {}),
    });
    const assessment = this.goalPath.review({ snapshot: goalPathSnapshot, trigger: input.trigger });
    const ledger = await this.ledger.read();
    const domain = projectDomainEvents(ledger.domainEvents, { userId: input.userId });
    const stale = stableHash(assessment.snapshotVersion.aggregateRefs) !== stableHash(goalPathAggregateRefs(domain));
    const decisionFingerprint = stableHash({
      snapshotVersion: assessment.snapshotVersion,
      state: assessment.state,
      diagnosis: assessment.diagnosis,
      reasons: assessment.reasonCodes,
      signal: assessment.materialSignal,
    });
    const previous = ledger.artifacts
      .filter((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief" && candidate.userId === input.userId && Boolean(candidate.goalPathAssessment))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const previousDecision = previous?.goalPathAssessment?.assessment;
    const duplicate = previousDecision ? stableHash({ snapshotVersion: previousDecision.snapshotVersion, state: previousDecision.state, diagnosis: previousDecision.diagnosis, reasons: previousDecision.reasonCodes, signal: previousDecision.materialSignal }) === decisionFingerprint : false;
    const sameStableState = previousDecision && previousDecision.state === assessment.state && previousDecision.diagnosis === assessment.diagnosis && stableHash(previousDecision.reasonCodes) === stableHash(assessment.reasonCodes);
    const cooldown = Boolean(sameStableState && Date.parse(assessment.evaluatedAt) - Date.parse(previous!.createdAt) < 7 * 86_400_000);
    const planInactive = !domain.plan || domain.plan.value.lifecycle?.state === "paused" || domain.plan.value.lifecycle?.state === "completed";
    const suppressionReason = stale
      ? "stale" as const
      : assessment.materialSignal === "none"
      ? "no_material_signal" as const
      : planInactive && assessment.materialSignal !== "hard_safety"
        ? "plan_inactive" as const
        : duplicate
          ? "duplicate" as const
          : cooldown && assessment.materialSignal !== "hard_safety"
            ? "cooldown" as const
            : undefined;
    const delivered = !suppressionReason;
    const delivery = suppressionReason
      ? "suppressed" as const
      : input.channel === "agent_conversation"
        ? "same_run" as const
        : input.channel === "manual_home"
          ? "home" as const
          : "notification" as const;
    const id = `goal-path-artifact:${stableHash({ decisionFingerprint, channel: input.channel, suppressionReason, key: input.idempotencyKey })}`;
    const planningInput = domain.profile && domain.goalContract && domain.mandate
      ? this.planningInputFromEvidence({
          userId: input.userId,
          mode: "adjustment",
          evaluationDate: goalPathSnapshot.evaluatedAt.slice(0, 10),
          domain: goalPathSnapshot.domain,
          trends: goalPathSnapshot.trends,
          artifacts: ledger.artifacts,
          sourceAssessment: assessment,
        })
      : undefined;
    const artifact: EvidenceBriefArtifact = {
      id,
      kind: "evidence_brief",
      userId: input.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: assessment.evaluatedAt,
      contextRefs: [input.contextRef ?? { kind: input.channel === "agent_conversation" ? "today" : "plan", ref: input.userId }],
      evidenceRefs: assessment.snapshotVersion.aggregateRefs.map((ref) => ({
        aggregate: factRefAggregateForDomainKind(ref.kind),
        id: ref.id,
        revision: ref.revision,
      })),
      missingness: assessment.state === "insufficient_evidence" ? assessment.nextValidationSignals : [],
      capabilityBoundary: ["deterministic_goal_path", "llm_explains_only", "confirmed_ledger_only", "no_food_inference"],
      hash: stableHash({ assessment, delivery, suppressionReason }),
      title: assessment.materialSignal === "hard_safety" ? "需要立即关注的安全信号" : assessment.state === "at_risk" ? "当前计划路径需要复核" : assessment.state === "on_path" ? "当前计划仍在路径上" : "需要更多记录再判断",
      summary: goalPathSignalSummary(assessment),
      goalPathAssessment: { assessment, channel: input.channel, delivery, ...(suppressionReason ? { suppressionReason } : {}) },
      ...(planningInput ? { planningInput } : {}),
      goalPathAudit: { status: stale ? "stale" : suppressionReason === "duplicate" ? "coalesced" : suppressionReason === "no_material_signal" ? "skipped" : suppressionReason ? "suppressed" : "evaluated", trigger: input.trigger, sourceAssessmentId: assessment.id, reasonCodes: suppressionReason ? [suppressionReason] : assessment.reasonCodes },
    };
    const expectedRevisions: DomainAtomicCommit["expectedRevisions"] = assessment.snapshotVersion.aggregateRefs;
    try {
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: "goal_path_engine",
        intent: `goal_path.${input.trigger}.${delivered ? "delivered" : "suppressed"}`,
        expectedRevisions,
        domainEvents: [],
        artifacts: [artifact],
        ...(delivered ? { presentations: [{ id: `presentation:${id}`, artifactId: id, renderer: "evidence_brief/1", status: "ready" as const }] } : {}),
        idempotencyKey: `goal-path-delivery:${input.idempotencyKey}`,
        recordedAt: assessment.evaluatedAt,
      });
    } catch (cause) {
      if (!(cause instanceof LedgerConflictError) || cause.code !== "stale_aggregate") throw cause;
      const staleArtifact: EvidenceBriefArtifact = {
        ...artifact,
        id: `${artifact.id}:stale`,
        hash: stableHash({ assessment, delivery: "suppressed", suppressionReason: "stale" }),
        goalPathAssessment: { assessment, channel: input.channel, delivery: "suppressed", suppressionReason: "stale" },
        goalPathAudit: { status: "stale", trigger: input.trigger, sourceAssessmentId: assessment.id, reasonCodes: ["stale"] },
      };
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: "goal_path_engine",
        intent: `goal_path.${input.trigger}.stale`,
        expectedRevisions: [],
        domainEvents: [],
        artifacts: [staleArtifact],
        idempotencyKey: `goal-path-stale:${input.idempotencyKey}`,
        recordedAt: assessment.evaluatedAt,
      });
      return { assessment, artifact: staleArtifact, delivered: false };
    }
    // Scheduled checks share the same material-signal ingress as a freshly
    // confirmed record. The fixed review has already persisted and deduped
    // the assessment above; only then may Pi open/resume a conversation to
    // explain it. A quiet daily check creates neither a Pi run nor provider
    // work.
    if (delivered && (input.trigger === "daily" || input.trigger === "weekly")) {
      try {
        await this.dependencies.afterFixedGoalPathReview?.({
          userId: input.userId,
          causationId: artifact.id,
        });
      } catch {
        // The fixed assessment remains durable if conversational delivery is
        // temporarily unavailable; the next local reconciliation can resume.
      }
    }
    if ((input.trigger === "daily" || input.trigger === "weekly") && domain.plan && domain.planStatus === "current" && !planInactive) {
      const observedThrough = assessment.evaluatedAt.slice(0, 10);
      const minimumDays = domain.plan.value.observationContract?.minimumObservationDays ?? 7;
      const observedDays = Math.floor((Date.parse(`${observedThrough}T00:00:00.000Z`) - Date.parse(`${domain.plan.value.effectiveFrom}T00:00:00.000Z`)) / 86_400_000) + 1;
      if (observedDays >= minimumDays) {
        const appliedCandidate = [...ledger.artifacts].reverse().find((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief" && candidate.userId === input.userId && candidate.adaptivePlanProposal?.status === "applied" && candidate.id.endsWith(`:applied:${domain.plan!.revision}`));
        try {
          await this.recordPlanOutcome({
            userId: input.userId,
            planId: domain.plan.value.id,
            planRevision: domain.plan.revision,
            observedFrom: domain.plan.value.effectiveFrom,
            observedThrough,
            timezoneOffsetMinutes: input.timezoneOffsetMinutes ?? 0,
            ...(appliedCandidate?.adaptivePlanProposal ? { candidateId: appliedCandidate.adaptivePlanProposal.candidate.id, candidateDecision: "accepted" as const } : {}),
            idempotencyKey: `plan-outcome:${domain.plan.value.id}:r${domain.plan.revision}:${observedThrough}`,
          });
        } catch {
          // The deterministic assessment remains valid; outcome capture is retried by the next scheduled review.
        }
      }
    }
    if (delivered && input.channel === "scheduled" && this.notifications) {
      try {
        const notification = { id: `notification:${id}`, at: assessment.evaluatedAt, title: artifact.title, body: artifact.summary.slice(0, 2).join("；") };
        await this.notifications.upsert({ ...notification, deepLink: "maxpower://plan" });
      } catch {
        await this.persistGoalPathAudit({ userId: input.userId, trigger: input.trigger, status: "failed", reasonCodes: ["notification_delivery_failed"], sourceAssessmentId: assessment.id, idempotencyKey: `notification-failed:${id}` });
      }
    }
    return { assessment, artifact, delivered };
  }

  private async persistGoalPathAudit(input: { userId: string; trigger: GoalPathAssessment["trigger"]; status: "failed" | "stale"; reasonCodes: readonly string[]; sourceAssessmentId?: string; idempotencyKey: string }): Promise<void> {
    const now = this.runtime.now();
    const artifact: EvidenceBriefArtifact = {
      id: `goal-path-audit:${stableHash(input)}`,
      kind: "evidence_brief",
      userId: input.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [{ kind: "plan", ref: input.userId }],
      evidenceRefs: [],
      missingness: [],
      capabilityBoundary: ["durable_goal_path_audit", "no_plan_mutation"],
      hash: stableHash(input),
      title: "计划路径检查记录",
      summary: [...input.reasonCodes],
      goalPathAudit: { status: input.status, trigger: input.trigger, ...(input.sourceAssessmentId ? { sourceAssessmentId: input.sourceAssessmentId } : {}), reasonCodes: input.reasonCodes },
    };
    await this.ledger.commit({ kind: "domain", userId: input.userId, actorId: "goal_path_engine", intent: `goal_path.${input.status}`, expectedRevisions: [], domainEvents: [], artifacts: [artifact], idempotencyKey: input.idempotencyKey, recordedAt: now });
  }

  async readPlanExecutionEvidence(input: { userId: string; startDate: string; endDate: string; timezoneOffsetMinutes: number }) {
    const [domain, trends] = await Promise.all([
      this.readDomainProjection({ userId: input.userId }),
      this.readHealthTrends(input),
    ]);
    if (!domain.plan || domain.planStatus !== "current") throw new Error("active_plan_not_found");
    return projectPlanExecutionEvidence({ domain, plan: domain.plan, ledgers: trends.daily });
  }

  async recordPlanOutcome(input: {
    userId: string;
    planId: string;
    planRevision: number;
    observedFrom: string;
    observedThrough: string;
    timezoneOffsetMinutes: number;
    candidateId?: string;
    candidateDecision?: "accepted" | "rejected";
    burden?: "acceptable" | "high" | "unknown";
    feedback?: string;
    preferenceSignals?: PlanOutcome["preferenceSignals"];
    idempotencyKey: string;
  }): Promise<PlanOutcome> {
    const domain = await this.readDomainProjection({ userId: input.userId });
    if (!domain.plan || domain.plan.value.id !== input.planId || domain.plan.revision !== input.planRevision) throw new Error("plan_outcome_revision_not_current");
    const [execution, assessment] = await Promise.all([
      this.readPlanExecutionEvidence({ userId: input.userId, startDate: input.observedFrom, endDate: input.observedThrough, timezoneOffsetMinutes: input.timezoneOffsetMinutes }),
      this.reviewGoalPath({ userId: input.userId, trigger: "explicit_request", timezoneOffsetMinutes: input.timezoneOffsetMinutes }),
    ]);
    const durationDays = Math.max(1, Math.floor((Date.parse(`${input.observedThrough}T00:00:00.000Z`) - Date.parse(`${input.observedFrom}T00:00:00.000Z`)) / 86_400_000) + 1);
    const bodyResponse: PlanOutcome["bodyResponse"] = assessment.materialSignal === "hard_safety" ? "adverse" : assessment.state === "on_path" ? "expected" : assessment.diagnosis === "plan_response_review" ? "insufficient" : "unknown";
    const now = this.runtime.now();
    const burden: PlanOutcome["burden"] = input.burden ?? (assessment.diagnosis === "plan_friction" ? "high" : "unknown");
    // Whole-plan completion cannot prove that each proposed behavior was liked
    // or avoided. Preference memory is admitted only from explicit feedback or
    // a separately confirmed behavior signal supplied by the caller.
    const observedPreferenceSignals: PlanOutcome["preferenceSignals"] = input.preferenceSignals ?? [];
    const outcome: PlanOutcome = {
      id: `plan-outcome:${stableHash({ userId: input.userId, planId: input.planId, planRevision: input.planRevision, observedFrom: input.observedFrom, observedThrough: input.observedThrough, candidateId: input.candidateId, candidateDecision: input.candidateDecision, burden, feedback: input.feedback, preferenceSignals: observedPreferenceSignals })}`,
      userId: input.userId,
      planId: input.planId,
      planRevision: input.planRevision,
      ...(input.candidateId ? { candidateId: input.candidateId } : {}),
      candidateDecision: input.candidateDecision ?? "not_recorded",
      observedFrom: input.observedFrom,
      observedThrough: input.observedThrough,
      durationDays,
      execution: { ...execution.confirmedExecution, ...(execution.coverage.ratio !== undefined ? { coverageRatio: execution.coverage.ratio } : {}) },
      burden,
      bodyResponse,
      ...(input.feedback ? { feedback: input.feedback } : {}),
      preferenceSignals: observedPreferenceSignals,
      sourceAssessment: assessment,
      createdAt: now,
    };
    const artifact: EvidenceBriefArtifact = {
      id: outcome.id, kind: "evidence_brief", userId: input.userId, schemaVersion: 1, renderVersion: 1, createdAt: now,
      contextRefs: [{ kind: "plan", ref: input.planId }],
      evidenceRefs: [{ aggregate: "plan", id: input.planId, revision: input.planRevision }, { aggregate: "timeline", id: `timeline.${input.userId}`, revision: domain.timeline.revision }],
      missingness: [], capabilityBoundary: ["explicit_plan_outcome", "behavior_does_not_mutate_profile", "food_preference_is_not_nutrient_fact"],
      hash: stableHash(outcome), title: "本阶段计划结果", summary: [assessment.state, burden, bodyResponse], planOutcome: outcome,
    };
    await this.ledger.commit({ kind: "domain", userId: input.userId, actorId: input.userId, intent: "plan_outcome.record", expectedRevisions: [{ kind: "plan", id: input.planId, revision: input.planRevision }], domainEvents: [], artifacts: [artifact], idempotencyKey: input.idempotencyKey, recordedAt: now });
    return outcome;
  }

  async readPlanningOutcomeContext(input: { userId: string }) {
    const snapshot = await this.ledger.read();
    const outcomes = snapshot.artifacts.flatMap((artifact) => artifact.kind === "evidence_brief" && artifact.userId === input.userId && artifact.planOutcome ? [artifact.planOutcome] : []);
    return buildPlanningOutcomeContext(outcomes);
  }

  async pausePlan(input: { userId: string; reason: "user_paused" | "coach_paused"; confirmedBy?: "user" | "agent_with_user_confirmation"; idempotencyKey: string }) {
    const domain = await this.readDomainProjection({ userId: input.userId });
    if (!domain.plan) throw new Error("active_plan_not_found");
    return this.executeDomainCommand({
      type: "plan.set_lifecycle",
      meta: { ...settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()), actor: input.reason === "coach_paused" ? { kind: "agent", id: "planning_agent" } : { kind: "user", id: input.userId } },
      planId: domain.plan.value.id,
      expectedRevision: domain.plan.revision,
      lifecycle: { state: "paused", changedAt: this.runtime.now(), reason: input.reason, confirmedBy: input.confirmedBy ?? "user" },
    });
  }

  async reopenPlanning(input: { userId: string; idempotencyKey: string }) {
    const domain = await this.readDomainProjection({ userId: input.userId });
    if (!domain.plan) throw new Error("plan_history_not_found");
    return this.executeDomainCommand({
      type: "plan.set_lifecycle", meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      planId: domain.plan.value.id, expectedRevision: domain.plan.revision,
      lifecycle: { state: "planning_required", changedAt: this.runtime.now(), reason: "replan_requested", confirmedBy: "user" },
    });
  }

  async proposeGoalCompletion(input: { userId: string; timezoneOffsetMinutes: number; idempotencyKey: string }): Promise<EvidenceBriefArtifact> {
    const domain = await this.readDomainProjection({ userId: input.userId });
    if (!domain.goalContract || !domain.plan || domain.planStatus !== "current") throw new Error("active_goal_plan_required");
    const assessment = await this.reviewGoalPath({ userId: input.userId, trigger: "explicit_request", timezoneOffsetMinutes: input.timezoneOffsetMinutes });
    if (assessment.state !== "on_path") throw new Error("goal_completion_conditions_not_met");
    const required = domain.goalContract.value.measurementPlan?.requiredMeasurements ?? [];
    const matchesMetric = (event: (typeof domain.timeline.current)[number], metric: (typeof required)[number]): boolean => {
      if (metric === "key_lift") return event.fact.kind === "training" && event.fact.confidence === "confirmed";
      if (event.fact.kind !== "body" || event.fact.confidence !== "confirmed") return false;
      if (metric === "body_weight") return event.fact.measurement.metric === "body_weight";
      if (metric === "body_fat_percentage") return event.fact.measurement.metric === "body_fat_percentage";
      if (metric === "waist_circumference" || metric === "shoulder_circumference") return event.fact.measurement.metric === "circumference" && event.fact.measurement.site.toLowerCase() === metric.replace("_circumference", "");
      return false;
    };
    const measurementEvents = domain.timeline.current
      .filter((event) => event.occurredAt.slice(0, 10) >= domain.plan!.value.effectiveFrom)
      .filter((event) => required.some((metric) => matchesMetric(event, metric)));
    for (const metric of required) {
      const matches = measurementEvents.filter((event) => matchesMetric(event, metric));
      const protocolGroups = new Map<string, typeof matches>();
      for (const event of matches) {
        const key = event.fact.kind === "body"
          ? [
              event.fact.measurement.metric,
              event.fact.measurement.metric === "circumference" ? event.fact.measurement.site.trim().toLowerCase() : "",
              "condition" in event.fact.measurement ? event.fact.measurement.condition?.trim().toLowerCase() ?? "unspecified" : "unspecified",
              event.envelope?.provenance.recordingMethod ?? "unknown",
            ].join(":")
          : event.fact.kind === "training"
            ? `training:${event.fact.reportedSession?.exercises?.map((exercise) => exercise.exerciseConceptId ?? exercise.name).sort().join("|") ?? "unknown"}`
            : "unsupported";
        protocolGroups.set(key, [...(protocolGroups.get(key) ?? []), event]);
      }
      if (![...protocolGroups.values()].some((events) => events.length >= 2)) throw new Error(`goal_completion_measurement_missing:${metric}`);
    }
    const bodyFacts = domain.timeline.current.filter((event) => event.fact.kind === "body" && event.fact.confidence === "confirmed").sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    const targets = domain.goalContract.value.targets;
    if (targets?.targetWeight) {
      const latest = bodyFacts.find((event) => event.fact.kind === "body" && event.fact.measurement.metric === "body_weight");
      if (!latest || latest.fact.kind !== "body" || latest.fact.measurement.metric !== "body_weight") throw new Error("goal_completion_target_weight_not_observed");
      const actualKg = latest.fact.measurement.quantity.unit === "kg" ? latest.fact.measurement.quantity.value : latest.fact.measurement.quantity.value * 0.45359237;
      const targetKg = targets.targetWeight.unit === "kg" ? targets.targetWeight.value : targets.targetWeight.value * 0.45359237;
      const reached = domain.goalContract.value.primaryGoal === "fat_loss_preserve_lean_mass" ? actualKg <= targetKg + 0.5 : actualKg >= targetKg - 0.5;
      if (!reached) throw new Error("goal_completion_target_weight_not_reached");
    }
    if (targets?.targetBodyFat) {
      const latest = bodyFacts.find((event) => event.fact.kind === "body" && event.fact.measurement.metric === "body_fat_percentage");
      if (!latest || latest.fact.kind !== "body" || latest.fact.measurement.metric !== "body_fat_percentage" || latest.fact.measurement.quantity.value > targets.targetBodyFat.value + 0.5) throw new Error("goal_completion_target_body_fat_not_reached");
    }
    if (targets?.targetWaist) {
      const latest = bodyFacts.find((event) => event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && event.fact.measurement.site.toLowerCase() === "waist");
      if (!latest || latest.fact.kind !== "body" || latest.fact.measurement.metric !== "circumference") throw new Error("goal_completion_target_waist_not_observed");
      const actualCm = latest.fact.measurement.quantity.unit === "cm" ? latest.fact.measurement.quantity.value : latest.fact.measurement.quantity.value * 2.54;
      const targetCm = targets.targetWaist.unit === "cm" ? targets.targetWaist.value : targets.targetWaist.value * 2.54;
      if (actualCm > targetCm + 0.5) throw new Error("goal_completion_target_waist_not_reached");
    }
    if (targets?.targetShoulder) {
      const latest = bodyFacts.find((event) => event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && event.fact.measurement.site.toLowerCase() === "shoulder");
      if (!latest || latest.fact.kind !== "body" || latest.fact.measurement.metric !== "circumference") throw new Error("goal_completion_target_shoulder_not_observed");
      const actualCm = latest.fact.measurement.quantity.unit === "cm" ? latest.fact.measurement.quantity.value : latest.fact.measurement.quantity.value * 2.54;
      const targetCm = targets.targetShoulder.unit === "cm" ? targets.targetShoulder.value : targets.targetShoulder.value * 2.54;
      if (actualCm < targetCm - 0.5) throw new Error("goal_completion_target_shoulder_not_reached");
    }
    if (targets?.targetShoulderWaistRatio) {
      const waist = bodyFacts.find((event) => event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && event.fact.measurement.site.toLowerCase() === "waist");
      const shoulder = bodyFacts.find((event) => event.fact.kind === "body" && event.fact.measurement.metric === "circumference" && event.fact.measurement.site.toLowerCase() === "shoulder");
      if (!waist || !shoulder || waist.fact.kind !== "body" || shoulder.fact.kind !== "body" || waist.fact.measurement.metric !== "circumference" || shoulder.fact.measurement.metric !== "circumference") throw new Error("goal_completion_shoulder_waist_ratio_not_observed");
      const waistCm = waist.fact.measurement.quantity.unit === "cm" ? waist.fact.measurement.quantity.value : waist.fact.measurement.quantity.value * 2.54;
      const shoulderCm = shoulder.fact.measurement.quantity.unit === "cm" ? shoulder.fact.measurement.quantity.value : shoulder.fact.measurement.quantity.value * 2.54;
      if (shoulderCm / Math.max(1, waistCm) + 0.01 < targets.targetShoulderWaistRatio) throw new Error("goal_completion_shoulder_waist_ratio_not_reached");
    }
    for (const target of strengthTargetProgress(domain, targets?.strength, domain.plan.value.effectiveFrom)) {
      if (target.latestKg === undefined) throw new Error(`goal_completion_strength_target_not_observed:${target.lift}`);
      if (!target.reached) throw new Error(`goal_completion_strength_target_not_reached:${target.lift}`);
    }
    const now = this.runtime.now();
    const proposal = { status: "awaiting_confirmation" as const, goalId: domain.goalContract.value.id, goalRevision: domain.goalContract.revision, planId: domain.plan.value.id, planRevision: domain.plan.revision, timelineRevision: domain.timeline.revision, sourceAssessmentId: assessment.id, measurementEventIds: measurementEvents.map((event) => event.eventId) };
    const artifact: EvidenceBriefArtifact = {
      id: `goal-completion:${stableHash(proposal)}`, kind: "evidence_brief", userId: input.userId, schemaVersion: 1, renderVersion: 1, createdAt: now,
      contextRefs: [{ kind: "plan", ref: domain.plan.value.id }], evidenceRefs: [{ aggregate: "goal", id: domain.goalContract.value.id, revision: domain.goalContract.revision }, { aggregate: "plan", id: domain.plan.value.id, revision: domain.plan.revision }, ...measurementEvents.map((event) => ({ aggregate: "timeline" as const, id: event.eventId, revision: domain.timeline.revision }))],
      missingness: [], capabilityBoundary: ["completion_is_candidate_only", "user_confirmation_required"], hash: stableHash({ proposal, assessment }), title: "目标完成候选", summary: ["测量协议和观察窗口已满足", "请由你确认完成、继续记录或建立新目标"], goalCompletionProposal: proposal,
    };
    await this.ledger.commit({ kind: "domain", userId: input.userId, actorId: "goal_path_engine", intent: "goal_completion.propose", expectedRevisions: [{ kind: "goal_contract", id: domain.goalContract.value.id, revision: domain.goalContract.revision }, { kind: "plan", id: domain.plan.value.id, revision: domain.plan.revision }], domainEvents: [], artifacts: [artifact], presentations: [{ id: `presentation:${artifact.id}`, artifactId: artifact.id, renderer: "evidence_brief/1", status: "awaiting_user" }], idempotencyKey: input.idempotencyKey, recordedAt: now });
    return artifact;
  }

  async resolveGoalCompletion(input: { userId: string; proposalId: string; resolution: "reject" | "confirm_and_record_only" | "confirm_and_maintain" | "confirm_and_request_new_goal"; idempotencyKey: string }) {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief" && candidate.id === input.proposalId && candidate.userId === input.userId);
    const proposal = artifact?.goalCompletionProposal;
    if (!artifact || !proposal || proposal.status !== "awaiting_confirmation") throw new Error("goal_completion_proposal_not_confirmable");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    if (!domain.goalContract || !domain.plan || domain.goalContract.revision !== proposal.goalRevision || domain.plan.revision !== proposal.planRevision || domain.timeline.revision !== proposal.timelineRevision || domain.timeline.current.some((event) => proposal.measurementEventIds.includes(event.eventId) && event.lifecycle !== "active")) throw new Error("goal_completion_proposal_stale");
    if (input.resolution === "reject") {
      const rejected = { ...artifact, id: `${artifact.id}:rejected`, createdAt: this.runtime.now(), hash: stableHash({ sourceProposalId: artifact.id, status: "rejected" }), goalCompletionProposal: { ...proposal, status: "rejected" as const } };
      await this.ledger.commit({ kind: "domain", userId: input.userId, actorId: input.userId, intent: "goal_completion.reject", expectedRevisions: [], domainEvents: [], artifacts: [rejected], presentations: [{ id: `presentation:${rejected.id}`, artifactId: rejected.id, renderer: "evidence_brief/1", status: "rejected" }], idempotencyKey: input.idempotencyKey, recordedAt: this.runtime.now() });
      return { status: "rejected" as const };
    }
    const completedAt = this.runtime.now();
    const next = input.resolution === "confirm_and_request_new_goal"
      ? "goal_negotiation" as const
      : input.resolution === "confirm_and_maintain"
        ? "maintenance_planning" as const
        : "record_first" as const;
    const completed: EvidenceBriefArtifact = { ...artifact, id: `${artifact.id}:completed`, createdAt: completedAt, hash: stableHash({ sourceProposalId: artifact.id, status: "completed", next }), goalCompletionProposal: { ...proposal, status: "completed" as const, next } };
    const result = await this.executeDomainCommandTransaction({ type: "plan.set_lifecycle", meta: settingsCommandMeta(input.userId, input.idempotencyKey, completedAt), planId: domain.plan.value.id, expectedRevision: domain.plan.revision, lifecycle: { state: "completed", changedAt: completedAt, reason: "goal_confirmed_complete", confirmedBy: "user" } }, {
      artifacts: [completed],
      presentations: [{ id: `presentation:${completed.id}`, artifactId: completed.id, renderer: "evidence_brief/1", status: "applied" }],
    });
    return { status: "completed" as const, next, result };
  }

  async previewGoalNegotiation(input: { userId: string; goal: import("./domain").GoalContractData; today?: string }) {
    const domain = await this.readDomainProjection({ userId: input.userId });
    return negotiateGoalPaths({ goal: input.goal, domain, ...(domain.profile ? { profile: domain.profile.value } : {}), today: input.today ?? this.runtime.now().slice(0, 10) });
  }

  async confirmGoalNegotiation(input: {
    userId: string;
    goal: import("./domain").GoalContractData;
    selectedOptionId: GoalPathOption["id"];
    planChangeAuthorization: NonNullable<import("./domain").CoachingMandateData["planChangeAuthorization"]>;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    const domain = await this.readDomainProjection({ userId: input.userId });
    if (!domain.profile || !domain.mandate) throw new Error("dossier_not_confirmed");
    const preview = negotiateGoalPaths({ goal: input.goal, profile: domain.profile.value, domain, today: this.runtime.now().slice(0, 10) });
    const selected = preview.options.find((option) => option.id === input.selectedOptionId);
    if (!selected) throw new Error("goal_path_option_not_found");
    if (!selected.feasible) throw new Error("goal_path_infeasible_under_guardrails");
    const today = this.runtime.now().slice(0, 10);
    const goal = {
      ...input.goal,
      executionTier: selected.executionTier,
      targetWeeks: selected.targetWeeks,
      horizon: { ...input.goal.horizon, endDate: goalDeadlineForWeeks(today, selected.targetWeeks) },
      // 判据体系默认值：围度/表现/训练执行优先，体重降级为周均趋势。
      // 模型没给 successMetrics 时按此生成，而不是裸体重目标。
      successMetrics: input.goal.successMetrics?.length ? input.goal.successMetrics : defaultSuccessMetrics(input.goal),
      status: "active" as const,
    };
    const result = await this.executeDomainCommand({
      type: "goal_contract.confirm",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      expectedGoalRevision: domain.goalContract?.revision ?? 0,
      goalContract: goal,
      expectedMandateRevision: domain.mandate.revision,
      mandate: { ...domain.mandate.value, planChangeAuthorization: input.planChangeAuthorization },
      authorization: input.authorization,
    });
    return { result, goal, selectedOption: selected };
  }

  async proposeAdaptivePlanCandidate(input: {
    userId: string;
    candidate: AdaptivePlanCandidate;
    attempt: 1 | 2;
    idempotencyKey: string;
  }): Promise<{ artifact?: EvidenceBriefArtifact; validation: import("../planning").AdaptivePlanValidation; autoApplied?: boolean }> {
    const ledgerSnapshot = await this.ledger.read();
    const domain = projectDomainEvents(ledgerSnapshot.domainEvents, { userId: input.userId });
    const planningContext = buildPlanningOutcomeContext(ledgerSnapshot.artifacts.flatMap((artifact) => artifact.kind === "evidence_brief" && artifact.userId === input.userId && artifact.planOutcome ? [artifact.planOutcome] : []));
    if (!domain.profile || !domain.goalContract || !domain.mandate) throw new Error("planning_facts_incomplete");
    const currentNutrition = [...domain.nutritionStrategies]
      .filter((strategy) => strategy.value.goalContractRef.id === domain.goalContract!.value.id)
      .sort((left, right) => right.revision - left.revision)[0];
    const goalPathSnapshot = domain.plan && domain.planStatus === "current" ? await this.assembleGoalPathSnapshot({ userId: input.userId }) : undefined;
    const assessment = goalPathSnapshot ? this.goalPath.review({ snapshot: goalPathSnapshot, trigger: "explicit_request" }) : undefined;
    const evaluationDate = this.runtime.now().slice(0, 10);
    const trendStartDate = new Date(Date.parse(`${evaluationDate}T00:00:00.000Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
    const personalEnergy = await this.readHealthTrends({ userId: input.userId, startDate: trendStartDate, endDate: evaluationDate, timezoneOffsetMinutes: 0 });
    if (assessment && stableHash(assessment.snapshotVersion.aggregateRefs) !== stableHash(goalPathAggregateRefs(domain))) throw new Error("adaptive_plan_snapshot_stale");
    const safetyBlocked = domain.safetyConstraints.some((constraint) => constraint.value.disposition !== "clear") || assessment?.materialSignal === "hard_safety";
    const counterfactual = domain.plan && domain.planStatus === "current" && assessment && input.candidate.nutritionStrategy
      ? this.goalPath.compareCandidate({
          snapshot: goalPathSnapshot!,
          assessment,
          goal: domain.goalContract.value,
          currentPlan: domain.plan.value,
          ...(currentNutrition ? { currentNutrition: currentNutrition.value } : {}),
          candidatePlan: input.candidate.planRevision,
          candidateNutrition: input.candidate.nutritionStrategy,
        })
      : undefined;
    const validation = validateAdaptivePlanCandidate({ knownExerciseVariantIds: this.knowledge.search({}).map((variant) => variant.id),
      candidate: input.candidate,
      goal: domain.goalContract,
      profile: domain.profile.value,
      mandate: domain.mandate.value,
      ...(domain.plan && domain.planStatus === "current" ? { currentPlan: domain.plan } : {}),
      ...(currentNutrition ? { currentNutrition } : {}),
      ...(assessment ? { assessment } : {}),
      ...(counterfactual ? { counterfactual } : {}),
      recoveryContext: this.currentRecoveryContext(domain),
      today: this.runtime.now().slice(0, 10),
      safetyBlocked,
      allowedEnergyRange: deriveGoalEnergyGuardrail(domain.profile.value, domain.goalContract.value, personalEnergy.calibration.maintenanceRange),
      allowedPreferenceRefs: [
        `profile:${domain.profile.value.id}`,
        ...planningContext.outcomes.map((outcome) => outcome.id),
        ...ledgerSnapshot.workingMemory.filter((memory) => memory.userId === input.userId && !memory.deletedAt && !memory.supersededBy).map((memory) => memory.id),
      ],
    });
    if (validation.status === "invalid") return { validation };
    const snapshot = {
      evaluationDate: this.runtime.now().slice(0, 10),
      profileRevision: domain.profile.revision,
      goalRevision: domain.goalContract.revision,
      planRevision: domain.plan?.revision ?? 0,
      nutritionStrategyRevision: currentNutrition?.revision ?? 0,
      timelineRevision: domain.timeline.revision,
      mandateRevision: domain.mandate.revision,
      readinessFingerprint: stableHash(domain.recoveryConstraints.map((constraint) => ({ id: constraint.value.id, revision: constraint.revision, validUntil: constraint.value.validUntil }))),
      safetyFingerprint: stableHash(domain.safetyConstraints.map((constraint) => ({ id: constraint.value.id, revision: constraint.revision, disposition: constraint.value.disposition }))),
      knowledgeHash: stableHash({ installed: this.knowledge.versionPins(), candidate: input.candidate.planRevision.knowledgePins }),
    };
    const now = this.runtime.now();
    const id = `adaptive-plan:${stableHash({ candidate: input.candidate, snapshot })}`;
    const artifact: EvidenceBriefArtifact = {
      id, kind: "evidence_brief", userId: input.userId, schemaVersion: 1, renderVersion: 1, createdAt: now,
      contextRefs: [{ kind: "plan", ref: domain.plan?.value.id ?? "first-plan" }],
      evidenceRefs: [
        { aggregate: "goal", id: domain.goalContract.value.id, revision: domain.goalContract.revision },
        ...(domain.plan ? [{ aggregate: "plan" as const, id: domain.plan.value.id, revision: domain.plan.revision }] : []),
        { aggregate: "timeline", id: `timeline.${input.userId}`, revision: domain.timeline.revision },
      ],
      missingness: [],
      capabilityBoundary: ["llm_generates_candidate", "fixed_engine_validates", "future_only", "no_food_lookup_or_nutrient_estimate"],
      hash: stableHash({ candidate: input.candidate, validation, snapshot }),
      knowledgePins: input.candidate.planRevision.knowledgePins,
      title: domain.plan ? "计划调整候选" : "当前阶段计划候选",
      summary: [...input.candidate.rationale, ...input.candidate.expectedTradeoffs],
      adaptivePlanProposal: { status: "awaiting_confirmation", candidate: input.candidate, validation, snapshot, ...(counterfactual ? { counterfactual } : {}) },
    };
    await this.ledger.commit({
      kind: "domain", userId: input.userId, actorId: "planning_agent", intent: "adaptive_plan.candidate.propose",
      expectedRevisions: [
        { kind: "goal_contract", id: domain.goalContract.value.id, revision: domain.goalContract.revision },
        { kind: "coaching_mandate", id: domain.mandate.value.id, revision: domain.mandate.revision },
        ...(domain.plan ? [{ kind: "plan" as const, id: domain.plan.value.id, revision: domain.plan.revision }] : []),
        ...(currentNutrition ? [{ kind: "nutrition_strategy" as const, id: currentNutrition.value.id, revision: currentNutrition.revision }] : []),
        ...(domain.timeline.revision ? [{ kind: "timeline" as const, id: `timeline.${input.userId}`, revision: domain.timeline.revision }] : []),
      ],
      domainEvents: [], artifacts: [artifact],
      presentations: [{ id: `presentation:${id}`, artifactId: id, renderer: "evidence_brief/1", status: validation.resolution === "confirmation_required" ? "awaiting_user" : "ready" }],
      idempotencyKey: input.idempotencyKey, recordedAt: now,
    });
    return { artifact, validation, autoApplied: false };
  }

  async confirmAdaptivePlanCandidate(input: { userId: string; proposalId: string; idempotencyKey: string }) {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief" && candidate.id === input.proposalId && candidate.userId === input.userId);
    const proposal = artifact?.adaptivePlanProposal;
    if (!artifact || !proposal || proposal.status !== "awaiting_confirmation") throw new Error("adaptive_plan_proposal_not_confirmable");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const currentNutrition = [...domain.nutritionStrategies].filter((strategy) => domain.goalContract && strategy.value.goalContractRef.id === domain.goalContract.value.id).sort((left, right) => right.revision - left.revision)[0];
    const currentSnapshot = {
      evaluationDate: this.runtime.now().slice(0, 10),
      profileRevision: domain.profile?.revision ?? 0,
      goalRevision: domain.goalContract?.revision ?? 0,
      planRevision: domain.plan?.revision ?? 0,
      nutritionStrategyRevision: currentNutrition?.revision ?? 0,
      timelineRevision: domain.timeline.revision,
      mandateRevision: domain.mandate?.revision ?? 0,
      readinessFingerprint: stableHash(domain.recoveryConstraints.map((constraint) => ({ id: constraint.value.id, revision: constraint.revision, validUntil: constraint.value.validUntil }))),
      safetyFingerprint: stableHash(domain.safetyConstraints.map((constraint) => ({ id: constraint.value.id, revision: constraint.revision, disposition: constraint.value.disposition }))),
      knowledgeHash: stableHash({ installed: this.knowledge.versionPins(), candidate: proposal.candidate.planRevision.knowledgePins }),
    };
    if (stableHash(currentSnapshot) !== stableHash(proposal.snapshot)) throw new Error("adaptive_plan_proposal_stale");
    if (!domain.goalContract || !domain.profile || !domain.mandate) throw new Error("planning_facts_incomplete");
    const planningContext = await this.readPlanningOutcomeContext({ userId: input.userId });
    const goalPathSnapshot = domain.plan && domain.planStatus === "current" ? await this.assembleGoalPathSnapshot({ userId: input.userId }) : undefined;
    const assessment = goalPathSnapshot ? this.goalPath.review({ snapshot: goalPathSnapshot, trigger: "explicit_request" }) : undefined;
    const evaluationDate = this.runtime.now().slice(0, 10);
    const trendStartDate = new Date(Date.parse(`${evaluationDate}T00:00:00.000Z`) - 27 * 86_400_000).toISOString().slice(0, 10);
    const personalEnergy = await this.readHealthTrends({ userId: input.userId, startDate: trendStartDate, endDate: evaluationDate, timezoneOffsetMinutes: 0 });
    const counterfactual = domain.plan && assessment && proposal.candidate.nutritionStrategy
      ? this.goalPath.compareCandidate({ snapshot: goalPathSnapshot!, assessment, goal: domain.goalContract.value, currentPlan: domain.plan.value, ...(currentNutrition ? { currentNutrition: currentNutrition.value } : {}), candidatePlan: proposal.candidate.planRevision, candidateNutrition: proposal.candidate.nutritionStrategy })
      : undefined;
    const validation = validateAdaptivePlanCandidate({ knownExerciseVariantIds: this.knowledge.search({}).map((variant) => variant.id), candidate: proposal.candidate, goal: domain.goalContract, profile: domain.profile.value, mandate: domain.mandate.value, ...(domain.plan ? { currentPlan: domain.plan } : {}), ...(currentNutrition ? { currentNutrition } : {}), ...(assessment ? { assessment } : {}), ...(counterfactual ? { counterfactual } : {}), recoveryContext: this.currentRecoveryContext(domain), today: this.runtime.now().slice(0, 10), safetyBlocked: domain.safetyConstraints.some((constraint) => constraint.value.disposition !== "clear") || assessment?.materialSignal === "hard_safety", allowedEnergyRange: deriveGoalEnergyGuardrail(domain.profile.value, domain.goalContract.value, personalEnergy.calibration.maintenanceRange), allowedPreferenceRefs: [`profile:${domain.profile.value.id}`, ...planningContext.outcomes.map((outcome) => outcome.id), ...snapshot.workingMemory.filter((memory) => memory.userId === input.userId && !memory.deletedAt && !memory.supersededBy).map((memory) => memory.id)] });
    if (validation.status !== "valid") throw new Error(`adaptive_plan_revalidation_failed:${validation.issues.map((issue) => issue.code).join(",")}`);
    const planId = domain.plan?.value.id ?? proposal.candidate.planRevision.id;
    const nextPlanRevision = (domain.plan?.revision ?? 0) + 1;
    const appliedAt = this.runtime.now();
    const appliedArtifact: EvidenceBriefArtifact = {
      ...artifact,
      id: `${artifact.id}:applied:${nextPlanRevision}`,
      createdAt: appliedAt,
      hash: stableHash({ sourceProposalId: artifact.id, status: "applied", appliedPlanRevision: nextPlanRevision }),
      adaptivePlanProposal: {
        ...proposal,
        status: "applied",
        appliedCommit: {
          plan: { id: planId, revision: nextPlanRevision },
          ...(proposal.candidate.nutritionStrategy ? {
            nutritionStrategy: {
              id: currentNutrition?.value.id ?? proposal.candidate.nutritionStrategy.id,
              revision: (currentNutrition?.revision ?? 0) + 1,
            },
          } : {}),
        },
      },
    };
    const acceptedOutcomeArtifact = planCandidateDecisionOutcomeArtifact({
      userId: input.userId,
      planId,
      planRevision: nextPlanRevision,
      candidateId: proposal.candidate.id,
      decision: "accepted",
      observedAt: appliedAt,
      ...(assessment ? { assessment } : {}),
    });
    const result = await this.executeDomainCommandTransaction({
      type: "plan.commit_candidate",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, appliedAt),
      planId,
      expectedPlanRevision: domain.plan?.revision ?? 0,
      revision: { ...proposal.candidate.planRevision, id: planId, baseRevision: domain.plan?.revision ?? 0, lifecycle: { state: "active", changedAt: appliedAt, reason: "candidate_committed", confirmedBy: validation.resolution === "auto_apply_eligible" || validation.resolution === "auto_apply_once_eligible" ? "system" : "user" } },
      ...(proposal.candidate.nutritionStrategy ? { nutrition: { strategyId: currentNutrition?.value.id ?? proposal.candidate.nutritionStrategy.id, expectedRevision: currentNutrition?.revision ?? 0, value: { ...proposal.candidate.nutritionStrategy, id: currentNutrition?.value.id ?? proposal.candidate.nutritionStrategy.id } } } : {}),
      ...(validation.resolution === "auto_apply_once_eligible" || domain.mandate.value.planChangeAuthorization === "ask_this_time" ? {
        mandate: {
          mandateId: domain.mandate.value.id,
          expectedRevision: domain.mandate.revision,
          value: {
            ...domain.mandate.value,
            planChangeAuthorization: validation.resolution === "auto_apply_once_eligible" ? "always_ask" as const : "deny" as const,
          },
        },
      } : {}),
    }, {
      artifacts: [appliedArtifact, acceptedOutcomeArtifact],
      presentations: [{ id: `presentation:${appliedArtifact.id}`, artifactId: appliedArtifact.id, renderer: "evidence_brief/1", status: "applied" }],
    });
    return { status: "applied" as const, result, artifact: appliedArtifact, planRevision: nextPlanRevision, nutritionStrategyRevision: proposal.candidate.nutritionStrategy ? (currentNutrition?.revision ?? 0) + 1 : undefined };
  }

  async rejectAdaptivePlanCandidate(input: { userId: string; proposalId: string; idempotencyKey: string }) {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact =>
      candidate.kind === "evidence_brief" && candidate.id === input.proposalId && candidate.userId === input.userId,
    );
    const proposal = artifact?.adaptivePlanProposal;
    if (!artifact || !proposal || proposal.status !== "awaiting_confirmation") {
      throw new Error("adaptive_plan_proposal_not_rejectable");
    }
    const rejected: EvidenceBriefArtifact = {
      ...artifact,
      id: `${artifact.id}:rejected`,
      createdAt: this.runtime.now(),
      hash: stableHash({ sourceProposalId: artifact.id, status: "rejected" }),
      adaptivePlanProposal: { ...proposal, status: "rejected" },
    };
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const rejectedOutcomeArtifact = domain.plan ? planCandidateDecisionOutcomeArtifact({
      userId: input.userId,
      planId: domain.plan.value.id,
      planRevision: domain.plan.revision,
      candidateId: proposal.candidate.id,
      decision: "rejected",
      observedAt: this.runtime.now(),
    }) : undefined;
    if (domain.mandate?.value.planChangeAuthorization === "ask_this_time") {
      await this.executeDomainCommandTransaction({
        type: "mandate.revise",
        meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
        mandateId: domain.mandate.value.id,
        expectedRevision: domain.mandate.revision,
        mandate: { ...domain.mandate.value, planChangeAuthorization: "deny" },
        authorization: { kind: "local_user_presence", verifiedAt: this.runtime.now(), nonce: input.idempotencyKey },
      }, {
        artifacts: [rejected, ...(rejectedOutcomeArtifact ? [rejectedOutcomeArtifact] : [])],
        presentations: [{ id: `presentation:${rejected.id}`, artifactId: rejected.id, renderer: "evidence_brief/1", status: "rejected" }],
      });
    } else {
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: input.userId,
        intent: "adaptive_plan.proposal.rejected",
        expectedRevisions: [],
        domainEvents: [],
        artifacts: [rejected, ...(rejectedOutcomeArtifact ? [rejectedOutcomeArtifact] : [])],
        presentations: [{ id: `presentation:${rejected.id}`, artifactId: rejected.id, renderer: "evidence_brief/1", status: "rejected" }],
        idempotencyKey: input.idempotencyKey,
        recordedAt: this.runtime.now(),
      });
    }
    return { status: "rejected" as const, artifact: rejected };
  }

  async undoAdaptivePlanCandidate(input: { userId: string; appliedArtifactId: string; idempotencyKey: string }) {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief" && candidate.id === input.appliedArtifactId && candidate.userId === input.userId);
    const proposal = artifact?.adaptivePlanProposal;
    if (!artifact || !proposal || proposal.status !== "applied" || proposal.snapshot.planRevision <= 0 || proposal.snapshot.nutritionStrategyRevision <= 0) throw new Error("adaptive_plan_adjustment_not_undoable");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const currentNutrition = [...domain.nutritionStrategies].filter((strategy) => domain.goalContract && strategy.value.goalContractRef.id === domain.goalContract.value.id).sort((left, right) => right.revision - left.revision)[0];
    if (!domain.plan || domain.plan.revision !== proposal.snapshot.planRevision + 1 || !currentNutrition || currentNutrition.revision !== proposal.snapshot.nutritionStrategyRevision + 1) throw new Error("adaptive_plan_undo_stale");
    const previousPlan = snapshot.domainEvents.find((event) => event.userId === input.userId && event.name === "plan.revised" && event.aggregate.id === domain.plan!.value.id && event.aggregate.revision === proposal.snapshot.planRevision);
    const previousNutrition = snapshot.domainEvents.find((event) => event.userId === input.userId && (event.name === "nutrition_strategy.created" || event.name === "nutrition_strategy.revised") && event.aggregate.id === currentNutrition.value.id && event.aggregate.revision === proposal.snapshot.nutritionStrategyRevision);
    if (!previousPlan || previousPlan.name !== "plan.revised" || !previousNutrition || (previousNutrition.name !== "nutrition_strategy.created" && previousNutrition.name !== "nutrition_strategy.revised")) throw new Error("adaptive_plan_undo_history_missing");
    const undoneAt = this.runtime.now();
    const undoneArtifact: EvidenceBriefArtifact = {
      ...artifact,
      id: `${artifact.id}:undone`,
      createdAt: undoneAt,
      hash: stableHash({ sourceAppliedArtifactId: artifact.id, status: "undone", currentPlanRevision: domain.plan.revision }),
      adaptivePlanProposal: { ...proposal, status: "undone" },
    };
    const result = await this.executeDomainCommandTransaction({
      type: "plan.commit_candidate",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, undoneAt),
      planId: domain.plan.value.id,
      expectedPlanRevision: domain.plan.revision,
      revision: { ...previousPlan.payload, id: domain.plan.value.id, baseRevision: domain.plan.revision, effectiveFrom: undoneAt.slice(0, 10), lifecycle: { state: "active", changedAt: undoneAt, reason: "candidate_reverted", confirmedBy: "user" } },
      nutrition: { strategyId: currentNutrition.value.id, expectedRevision: currentNutrition.revision, value: { ...previousNutrition.payload, id: currentNutrition.value.id } },
    }, {
      artifacts: [undoneArtifact],
      presentations: [{ id: `presentation:${undoneArtifact.id}`, artifactId: undoneArtifact.id, renderer: "evidence_brief/1", status: "undone" }],
    });
    return { status: "undone" as const, artifact: undoneArtifact, result, planRevision: domain.plan.revision + 1, nutritionStrategyRevision: currentNutrition.revision + 1 };
  }

  async confirmMealObservation(input: {
    userId: string;
    idempotencyKey: string;
    observation: import("../nutrition").MealObservation;
    draftArtifactId?: string;
  }): Promise<DomainCommandResult> {
    assertNutrientValues(input.observation.nutrients ?? []);
    if (input.observation.mode === "structured" && !input.observation.nutrients?.length) {
      throw new Error("nutrition_structured_value_required");
    }
    if (input.observation.nutrients?.some((value) => value.source.kind !== input.observation.provenance)) {
      throw new Error("nutrition_value_source_mismatch");
    }
    return this.recordTimelineFact({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      confirmedByUser: true,
      fact: {
        kind: "nutrition",
        observationId: input.observation.id,
        ...(input.observation.mealSlot ? { mealSlot: input.observation.mealSlot } : {}),
        ...(input.observation.foods ? { foods: input.observation.foods } : {}),
        ...(input.observation.nutrients?.length ? { nutrients: input.observation.nutrients } : {}),
        observationMode: input.observation.mode,
        ...(input.observation.dayCoverage ? { dayCoverage: input.observation.dayCoverage } : {}),
        ...(input.observation.description ? { mealDescription: input.observation.description } : {}),
        ...(input.observation.qualitative ? { qualitative: input.observation.qualitative } : {}),
        confidence: "confirmed",
      },
      envelope: {
        time: { startedAt: input.observation.occurredAt, timezoneOffsetMinutes: new Date(input.observation.occurredAt).getTimezoneOffset() * -1 },
        provenance: {
          origin: "manual",
          recordingMethod: "manual_entry",
          dataStatus: "available",
          confidence: "confirmed",
        },
        privacyClass: "sensitive",
        causalRefs: [
          `meal_observation:${input.observation.id}`,
          ...(input.draftArtifactId ? [`nutrition_draft:${input.draftArtifactId}`] : []),
        ],
        evidenceRefs: [],
        layer: "raw_observation",
      },
    });
  }

  async createNutritionObservationDraft(input: {
    userId: string;
    idempotencyKey: string;
    observation: import("../nutrition").MealObservation;
  }): Promise<import("./model").NutritionObservationDraftArtifact> {
    if (!input.observation.description?.trim() && !input.observation.foods?.length) throw new Error("nutrition_observation_input_required");
    assertNutrientValues(input.observation.nutrients ?? []);
    if (input.observation.mode === "structured" && !input.observation.nutrients?.length) throw new Error("nutrition_structured_value_required");
    if (input.observation.nutrients?.some((value) => value.source.kind !== input.observation.provenance)) {
      throw new Error("nutrition_value_source_mismatch");
    }
    const snapshot = await this.ledger.read();
    const existing = snapshot.artifacts.find(
      (artifact): artifact is import("./model").NutritionObservationDraftArtifact =>
        artifact.kind === "nutrition_observation_draft" &&
        artifact.userId === input.userId &&
        artifact.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;
    const now = this.runtime.now();
    const draft: import("../nutrition").NutritionObservationDraft = {
      id: this.runtime.nextId("nutrition-draft"),
      schemaVersion: 1,
      observation: input.observation,
      generatedAt: now,
      missing: input.observation.nutrients?.length ? [] : ["nutrient_values_not_provided"],
      clarificationRequired: true,
      status: "draft",
    };
    const artifact: import("./model").NutritionObservationDraftArtifact = {
      id: `nutrition-draft-${stableHash({ userId: input.userId, draft })}`,
      kind: "nutrition_observation_draft",
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [{ kind: "today", ref: input.observation.occurredAt.slice(0, 10) }],
      evidenceRefs: [],
      missingness: draft.missing ?? [],
      capabilityBoundary: ["Coach 只代填用户明确提供的字段", "确认前不会进入 Timeline", "未知营养值保持 unknown"],
      hash: stableHash(draft),
      knowledgePins: this.knowledge.versionPins(),
      draft,
    };
    await this.ledger.commit({
      kind: "domain", userId: input.userId, actorId: "nutrition_observation", intent: "nutrition.draft.create", expectedRevisions: [], domainEvents: [],
      artifacts: [artifact],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "agent",
        action: "assessment.created",
        targetType: "nutrition",
        targetId: artifact.id,
        scope: "nutrition_observation",
        intent: "nutrition.draft.create",
        before: {},
        after: {
          artifactId: artifact.id,
          nutrientValueCount: draft.observation.nutrients?.length ?? 0,
          source: draft.observation.provenance,
        },
        evidenceRefs: [],
        beforeRefs: [],
        afterRefs: [],
        ruleVersions: knowledgeRuleVersions(this.knowledge.versionPins()),
        mandateRevision: (await this.readDomainProjection({ userId: input.userId })).mandate?.revision ?? 0,
        result: "allowed",
        undoBoundary: "not_applicable",
        policyDecision: "require_confirmation",
        causationId: artifact.id,
        correlationId: `nutrition:${input.idempotencyKey}`,
        reversible: false,
      }],
      idempotencyKey: input.idempotencyKey, recordedAt: now,
    });
    return artifact;
  }

  /**
   * Read-only client seam for the nutrition review sheet. The returned
   * artifact remains immutable; callers must use the typed confirmation or
   * rejection actions rather than mutating an in-memory Draft.
   */
  async readNutritionObservationDraft(input: {
    userId: string;
    artifactId: string;
  }): Promise<import("./model").NutritionObservationDraftArtifact> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (item): item is import("./model").NutritionObservationDraftArtifact =>
        item.id === input.artifactId && item.kind === "nutrition_observation_draft" && item.userId === input.userId,
    );
    if (!artifact) throw new Error("nutrition_draft_not_found");
    return artifact;
  }

  async confirmNutritionObservationDraft(input: {
    userId: string;
    artifactId: string;
    idempotencyKey: string;
    observation?: import("../nutrition").MealObservation;
  }): Promise<DomainCommandResult> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (item): item is import("./model").NutritionObservationDraftArtifact =>
        item.id === input.artifactId && item.kind === "nutrition_observation_draft" && item.userId === input.userId,
    );
    if (!artifact) throw new Error("nutrition_draft_not_found");
    const observation = input.observation ?? artifact.draft.observation;
    const result = await this.confirmMealObservation({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      observation,
      draftArtifactId: artifact.id,
    });
    return result;
  }

  /** Rejecting a pending form is auditable and intentionally writes no nutrition fact. */
  async rejectNutritionObservationDraft(input: {
    userId: string;
    artifactId: string;
    idempotencyKey: string;
  }): Promise<import("./domain").DomainCommandResult> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (item): item is import("./model").NutritionObservationDraftArtifact =>
        item.id === input.artifactId && item.kind === "nutrition_observation_draft" && item.userId === input.userId,
    );
    if (!artifact) throw new Error("nutrition_draft_not_found");
    const now = this.runtime.now();
    const projection = await this.readDomainProjection({ userId: input.userId });
    const result = await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "nutrition.draft.reject",
      expectedRevisions: [],
      domainEvents: [],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "user",
        action: "nutrition.draft.rejected",
        targetType: "nutrition",
        targetId: artifact.id,
        scope: "nutrition_observation",
        intent: "nutrition.draft.reject",
        before: { artifactId: artifact.id, status: "draft" },
        after: { artifactId: artifact.id, status: "rejected" },
        evidenceRefs: [],
        beforeRefs: [],
        afterRefs: [],
        ruleVersions: knowledgeRuleVersions(this.knowledge.versionPins()),
        mandateRevision: projection.mandate?.revision ?? 0,
        result: "rejected",
        undoBoundary: "not_applicable",
        policyDecision: "allow",
        humanDecision: "rejected",
        causationId: artifact.id,
        correlationId: `nutrition:${input.idempotencyKey}`,
        reversible: false,
      }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return result;
  }

  async seedDomainStateForTest(input: SeedDomainStateForTestInput): Promise<void> {
    const goal = input.profile.goal === "fat_loss" ? "fat_loss_preserve_lean_mass" : input.profile.goal;
    if (goal !== "fat_loss_preserve_lean_mass" && goal !== "hypertrophy" && goal !== "strength") {
      throw new Error("seed_goal_not_supported");
    }
    const profileId = `profile:${input.userId}`;
    const goalId = `goal:${input.userId}`;
    const mandateId = `mandate:${input.userId}`;
    const planId = `plan:${input.userId}`;
    const occurredAt = this.runtime.now();
    const end = new Date(`${input.plan.effectiveDate}T00:00:00.000Z`);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    await this.executeDomainCommand({
      type: "user.bootstrap",
      meta: settingsCommandMeta(input.userId, `seed:${input.userId}:bootstrap`, occurredAt),
      profile: { id: profileId, locale: "zh-CN" },
      goalContract: { id: goalId, primaryGoal: goal, horizon: { startDate: input.plan.effectiveDate, endDate: end.toISOString().slice(0, 10) } },
      mandate: { id: mandateId, mode: "collaborative", planChangeAuthorization: "always_ask" },
    });
    const knowledgePins = input.plan.knowledgePins ?? this.knowledge.versionPins();
    const session = {
      id: `seed-session:${input.userId}:${input.plan.effectiveDate}`,
      title: input.plan.title,
      scheduledFor: input.plan.effectiveDate,
      knowledgePins,
      tasks: input.plan.tasks.map((task) => ({
        id: task.id,
        exerciseVariantId: task.exerciseVariantId ?? task.id,
        sets: Array.from({ length: task.sets }, (_, index) => ({
          id: `${task.id}:set:${index + 1}`,
          targetReps: parseSeedRepRange(task.reps),
          ...(task.loadKg !== undefined ? { targetLoad: { value: task.loadKg, unit: "kg" as const } } : {}),
          ...(task.targetRir !== undefined ? { targetRir: task.targetRir } : {}),
          ...(task.restSeconds !== undefined ? { rest: { value: task.restSeconds, unit: "seconds" as const } } : {}),
        })),
      })),
    };
    for (let revision = 0; revision < input.plan.revision; revision += 1) {
      await this.executeDomainCommand({
        type: "plan.revise",
        meta: settingsCommandMeta(input.userId, `seed:${input.userId}:plan:${revision + 1}`, occurredAt),
        planId,
        expectedRevision: revision,
        revision: {
          id: planId,
          goalContractRef: { kind: "goal_contract", id: goalId, revision: 1 },
          ...(revision ? { baseRevision: revision } : {}),
          effectiveFrom: input.plan.effectiveDate,
          lifecycle: { state: "active", changedAt: occurredAt, reason: "candidate_committed", confirmedBy: "user" },
          knowledgePins,
          sessions: [session],
        },
      });
    }
    for (const event of input.timeline ?? []) {
      if (event.kind !== "body" || typeof event.data.weightKg !== "number") continue;
      await this.recordTimelineFact({
        userId: input.userId,
        idempotencyKey: `seed:${input.userId}:timeline:${event.id}`,
        fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: event.data.weightKg, unit: "kg" } }, confidence: "confirmed" },
        envelope: {
          time: { startedAt: event.occurredAt, timezoneOffsetMinutes: 0 },
          provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
          privacyClass: "sensitive",
          causalRefs: [], evidenceRefs: [], layer: "raw_observation",
        },
      });
    }
  }

  async executeDomainCommand(command: DomainCommand): Promise<DomainCommandResult> {
    return this.executeDomainCommandTransaction(command);
  }

  private async executeDomainCommandTransaction(
    command: DomainCommand,
    attached: { artifacts?: readonly Artifact[]; presentations?: readonly PresentationRef[] } = {},
  ): Promise<DomainCommandResult> {
    assertTimelineCommandAuthority(command);
    const recordedAt = this.runtime.now();
    const currentSnapshot = await this.ledger.read();
    const beforeProjection = projectDomainEvents(currentSnapshot.domainEvents, {
      userId: command.meta.userId,
    });
    const usedIds = new Set([
      ...currentSnapshot.domainEvents.map((item) => item.id),
      ...currentSnapshot.outbox.map((item) => item.id),
      ...currentSnapshot.actionEvents.map((item) => item.id),
      ...currentSnapshot.toolAudit.map((item) => item.id),
    ]);
    const commandRuntime: RuntimeServices = {
      now: () => recordedAt,
      nextId: (prefix) => {
        let candidate = this.runtime.nextId(prefix);
        while (usedIds.has(candidate)) candidate = this.runtime.nextId(prefix);
        usedIds.add(candidate);
        return candidate;
      },
    };
    const correlationId = `command:${command.meta.userId}:${command.meta.idempotencyKey}`;
    const causationId = correlationId;
    const event = <T extends DomainEvent>(
      value: Omit<
        T,
        | "id"
        | "schemaVersion"
        | "userId"
        | "actor"
        | "deviceId"
        | "occurredAt"
        | "recordedAt"
        | "timezoneOffsetMinutes"
        | "provenance"
        | "evidenceRefs"
        | "causationId"
        | "correlationId"
      > & { evidenceRefs?: DomainEvent["evidenceRefs"] },
    ): T => ({
      ...value,
      id: command.meta.eventId ?? commandRuntime.nextId("domain-event"),
      schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
      userId: command.meta.userId,
      actor: command.meta.actor,
      deviceId: command.meta.deviceId,
      occurredAt: command.meta.occurredAt,
      recordedAt,
      timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
      provenance: {
        source: command.meta.actor.kind,
        confidence: command.meta.actor.kind === "user" ? "confirmed" : "unknown",
      },
      evidenceRefs: value.evidenceRefs ?? [],
      causationId,
      correlationId,
    }) as T;

    let events: readonly DomainEvent[];
    let expectedRevisions: DomainAtomicCommit["expectedRevisions"];
    switch (command.type) {
      case "user.bootstrap": {
        const demographics = command.profile.demographics;
        if (demographics?.ageYears !== undefined && demographics.height?.unit === "cm" && demographics.currentWeight?.unit === "kg") {
          // The domain boundary re-validates the Baseline intake contract; no
          // caller may persist out-of-contract baseline facts.
          validateBaselineIntake({ ageYears: demographics.ageYears, heightCm: demographics.height.value, weightKg: demographics.currentWeight.value });
        }
        expectedRevisions = [
          { kind: "user_profile", id: command.profile.id, revision: 0 },
          ...(command.goalContract ? [{ kind: "goal_contract" as const, id: command.goalContract.id, revision: 0 }] : []),
          { kind: "coaching_mandate", id: command.mandate.id, revision: 0 },
        ];
        events = [
          event({
            name: "user_profile.created",
            aggregate: { kind: "user_profile", id: command.profile.id, revision: 1 },
            payload: command.profile,
          }),
          ...(command.goalContract ? [event({
            name: "goal_contract.created",
            aggregate: { kind: "goal_contract", id: command.goalContract.id, revision: 1 },
            payload: command.goalContract,
          })] : []),
          event({
            name: "coaching_mandate.created",
            aggregate: { kind: "coaching_mandate", id: command.mandate.id, revision: 1 },
            payload: command.mandate,
          }),
        ];
        break;
      }
      case "profile.revise":
        expectedRevisions = [
          { kind: "user_profile", id: command.profileId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: command.expectedRevision === 0 ? "user_profile.created" : "user_profile.revised",
            aggregate: {
              kind: "user_profile",
              id: command.profileId,
              revision: command.expectedRevision + 1,
            },
            payload: command.profile,
          }),
        ];
        break;
      case "profile.correct":
        expectedRevisions = [
          { kind: "user_profile", id: command.profileId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "user_profile.corrected",
            aggregate: {
              kind: "user_profile",
              id: command.profileId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              profile: command.profile,
              correctsEventId: command.correctsEventId,
              reason: command.reason,
            },
          }),
        ];
        break;
      case "goal_contract.revise":
        assertGoalContractOriginalPathProtected(beforeProjection.goalContract?.value, command.goalContract);
        expectedRevisions = [
          {
            kind: "goal_contract",
            id: command.goalContractId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0 ? "goal_contract.created" : "goal_contract.revised",
            aggregate: {
              kind: "goal_contract",
              id: command.goalContractId,
              revision: command.expectedRevision + 1,
            },
            payload: command.goalContract,
          }),
        ];
        break;
      case "goal_contract.confirm":
        assertLocalSettingsAuthorization(command.authorization);
        assertGoalContractOriginalPathProtected(beforeProjection.goalContract?.value, command.goalContract);
        expectedRevisions = [
          { kind: "goal_contract", id: command.goalContract.id, revision: command.expectedGoalRevision },
          { kind: "coaching_mandate", id: command.mandate.id, revision: command.expectedMandateRevision },
        ];
        events = [
          event({
            name: command.expectedGoalRevision === 0 ? "goal_contract.created" : "goal_contract.revised",
            aggregate: { kind: "goal_contract", id: command.goalContract.id, revision: command.expectedGoalRevision + 1 },
            payload: command.goalContract,
          }),
          event({
            name: command.expectedMandateRevision === 0 ? "coaching_mandate.created" : "coaching_mandate.revised",
            aggregate: { kind: "coaching_mandate", id: command.mandate.id, revision: command.expectedMandateRevision + 1 },
            payload: command.mandate,
          }),
        ];
        break;
      case "mandate.revise":
        assertLocalSettingsAuthorization(command.authorization);
        expectedRevisions = [
          {
            kind: "coaching_mandate",
            id: command.mandateId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0
              ? "coaching_mandate.created"
              : "coaching_mandate.revised",
            aggregate: {
              kind: "coaching_mandate",
              id: command.mandateId,
              revision: command.expectedRevision + 1,
            },
            payload: command.mandate,
          }),
        ];
        break;
      case "timeline.append":
        expectedRevisions = [
          { kind: "timeline", id: command.timelineId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "timeline.fact_appended",
            aggregate: {
              kind: "timeline",
              id: command.timelineId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              fact: command.fact,
              entry: command.entry,
            },
            evidenceRefs: Array.isArray(command.entry?.evidenceRefs) ? command.entry.evidenceRefs : [],
          }),
        ];
        break;
      case "timeline.correct":
        expectedRevisions = [
          { kind: "timeline", id: command.timelineId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "timeline.fact_corrected",
            aggregate: {
              kind: "timeline",
              id: command.timelineId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              fact: command.fact,
              correctsEventId: command.correctsEventId,
              ...(command.reason ? { reason: command.reason } : {}),
              entry: command.entry,
            },
            evidenceRefs: Array.isArray(command.entry?.evidenceRefs) ? command.entry.evidenceRefs : [],
          }),
        ];
        break;
      case "timeline.source_mutate":
        expectedRevisions = [
          { kind: "timeline", id: command.timelineId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "timeline.source_mutated",
            aggregate: {
              kind: "timeline",
              id: command.timelineId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              fact: command.fact,
              sourceEventId: command.sourceEventId,
              reason: command.reason,
              entry: command.entry,
            },
            evidenceRefs: Array.isArray(command.entry?.evidenceRefs) ? command.entry.evidenceRefs : [],
          }),
        ];
        break;
      case "timeline.source_tombstone":
        expectedRevisions = [
          { kind: "timeline", id: command.timelineId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "timeline.source_tombstoned",
            aggregate: {
              kind: "timeline",
              id: command.timelineId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              sourceEventId: command.sourceEventId,
              reason: command.reason,
            },
          }),
        ];
        break;
      case "plan.revise":
        if (command.revision.id !== command.planId) throw new Error("plan_identity_mismatch");
        assertFixedPlanSafety(command.revision);
        this.knowledge.assertVersionPins(command.revision.knowledgePins);
        for (const session of command.revision.sessions) {
          this.knowledge.assertVersionPins(session.knowledgePins);
        }
        expectedRevisions = [
          { kind: "plan", id: command.planId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "plan.revised",
            aggregate: {
              kind: "plan",
              id: command.planId,
              revision: command.expectedRevision + 1,
            },
            payload: command.revision,
          }),
        ];
        break;
      case "plan.commit_candidate":
        if (command.revision.id !== command.planId) throw new Error("plan_identity_mismatch");
        assertFixedPlanSafety(command.revision, command.nutrition?.value);
        this.knowledge.assertVersionPins(command.revision.knowledgePins);
        for (const session of command.revision.sessions) this.knowledge.assertVersionPins(session.knowledgePins);
        expectedRevisions = [
          ...(beforeProjection.profile ? [{ kind: "user_profile" as const, id: beforeProjection.profile.value.id, revision: beforeProjection.profile.revision }] : []),
          ...(beforeProjection.goalContract ? [{ kind: "goal_contract" as const, id: beforeProjection.goalContract.value.id, revision: beforeProjection.goalContract.revision }] : []),
          ...(beforeProjection.timeline.revision ? [{ kind: "timeline" as const, id: `timeline.${command.meta.userId}`, revision: beforeProjection.timeline.revision }] : []),
          { kind: "plan", id: command.planId, revision: command.expectedPlanRevision },
          ...(command.nutrition ? [{ kind: "nutrition_strategy" as const, id: command.nutrition.strategyId, revision: command.nutrition.expectedRevision }] : []),
          ...(command.mandate ? [{ kind: "coaching_mandate" as const, id: command.mandate.mandateId, revision: command.mandate.expectedRevision }] : []),
        ];
        events = [
          event({ name: "plan.revised", aggregate: { kind: "plan", id: command.planId, revision: command.expectedPlanRevision + 1 }, payload: command.revision }),
          ...(command.nutrition ? [event({
            name: command.nutrition.expectedRevision === 0 ? "nutrition_strategy.created" : "nutrition_strategy.revised",
            aggregate: { kind: "nutrition_strategy", id: command.nutrition.strategyId, revision: command.nutrition.expectedRevision + 1 },
            payload: command.nutrition.value,
          })] : []),
          ...(command.mandate ? [event({
            name: "coaching_mandate.revised",
            aggregate: { kind: "coaching_mandate", id: command.mandate.mandateId, revision: command.mandate.expectedRevision + 1 },
            payload: command.mandate.value,
          })] : []),
        ];
        break;
      case "plan.set_lifecycle": {
        const current = projectDomainEvents(currentSnapshot.domainEvents, { userId: command.meta.userId }).plan;
        if (!current || current.value.id !== command.planId || current.revision !== command.expectedRevision) throw new Error("active_plan_revision_not_found");
        expectedRevisions = [{ kind: "plan", id: command.planId, revision: command.expectedRevision }];
        events = [event({
          name: "plan.revised",
          aggregate: { kind: "plan", id: command.planId, revision: command.expectedRevision + 1 },
          payload: { ...current.value, baseRevision: command.expectedRevision, lifecycle: command.lifecycle },
        })];
        break;
      }
      case "workout.start":
      case "workout.prepare":
      case "workout.prepare_freestyle": {
        let prescription: import("./domain").PlannedSessionData;
        let source: import("./domain").WorkoutSessionSource;
        if (command.type === "workout.prepare_freestyle") {
          prescription = command.frozenPrescription;
          this.knowledge.assertVersionPins(prescription.knowledgePins);
          source = { kind: "freestyle", authoredBy: command.authoredBy };
        } else {
          const snapshot = await this.ledger.read();
          const plan = snapshot.domainEvents.find(
            (candidate) =>
              candidate.name === "plan.revised" &&
              candidate.userId === command.meta.userId &&
              candidate.aggregate.id === command.prescriptionRef.planId &&
              candidate.aggregate.revision === command.prescriptionRef.planRevision,
          );
          if (!plan || plan.name !== "plan.revised") throw new Error("invalid_plan_reference");
          const currentPlan = projectDomainEvents(snapshot.domainEvents, { userId: command.meta.userId }).plan;
          if (!currentPlan || currentPlan.value.id !== command.prescriptionRef.planId || currentPlan.revision !== command.prescriptionRef.planRevision || (currentPlan.value.lifecycle && currentPlan.value.lifecycle.state !== "active")) throw new Error("plan_not_active");
          const planned = plan.payload.sessions.find(
            (session) => session.id === command.prescriptionRef.sessionPrescriptionId,
          );
          if (!planned) throw new Error("invalid_session_prescription_reference");
          prescription = planned;
          source = { kind: "planned", plannedSessionRef: command.prescriptionRef };
        }
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
        ];
        const targetStatus = command.type === "workout.start" ? "active" as const : "planned" as const;
        const policy = command.policy ?? {
          id: "default-session-policy",
          version: "1",
          resumeWindowHours: 24,
        };
        const state = {
          status: targetStatus,
          mode: command.mode ?? "record_only" as const,
          policy,
          transitions: [{
            from: "planned" as const,
            to: targetStatus,
            reason: command.type === "workout.start" ? "started" : "prepared",
            actor: command.meta.actor,
            occurredAt: command.meta.occurredAt,
            idempotencyKey: command.meta.idempotencyKey,
          }],
        } satisfies import("./domain").WorkoutExecutionState;
        events = [
          event({
            name: command.type === "workout.start" ? "workout.started" : "workout.prepared",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              source,
              ...(source.kind === "planned" ? { plannedSessionRef: source.plannedSessionRef } : {}),
              frozenPrescription: clone(prescription),
              state,
            },
          }),
        ];
        break;
      }
      case "workout.transition":
        expectedRevisions = [
          { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "workout.state_changed",
            aggregate: { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision + 1 },
            payload: { state: command.state },
          }),
        ];
        break;
      case "workout.save_draft_set":
        expectedRevisions = [
          { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "workout.draft_set_saved",
            aggregate: { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision + 1 },
            payload: { draft: command.draft },
          }),
        ];
        break;
      case "workout.retract_draft_set":
        expectedRevisions = [
          { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "workout.draft_set_retracted",
            aggregate: { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision + 1 },
            payload: { draftId: command.draftId, reason: command.reason },
          }),
        ];
        break;
      case "workout.revise_prescription":
        expectedRevisions = [
          { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision },
        ];
        events = [
          event({
            name: "workout.prescription_revised",
            aggregate: { kind: "workout_session", id: command.workoutId, revision: command.expectedRevision + 1 },
            payload: {
              frozenPrescription: command.frozenPrescription,
              reason: command.reason,
              scope: command.scope,
            },
          }),
        ];
        break;
      case "workout.record_set":
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: "workout.set_recorded",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: { outcome: command.outcome },
          }),
        ];
        break;
      case "workout.skip_set":
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: "workout.set_skipped",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: { skipped: command.skipped },
          }),
        ];
        break;
      case "workout.correct_set_outcome":
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: "workout.set_corrected",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: { correction: command.correction },
          }),
        ];
        break;
      case "workout.complete":
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
          ...(command.timeline ? [{
            kind: "timeline" as const,
            id: command.timeline.timelineId,
            revision: command.timeline.expectedRevision,
          }] : []),
        ];
        events = [
          event({
            name: "workout.completed",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              status: command.status,
              completedAt: command.meta.occurredAt,
              ...(command.outcome ? { outcome: command.outcome } : {}),
            },
          }),
          ...(command.timeline ? [event({
            name: "timeline.fact_appended",
            aggregate: {
              kind: "timeline" as const,
              id: command.timeline.timelineId,
              revision: command.timeline.expectedRevision + 1,
            },
            payload: {
              fact: command.timeline.fact,
              entry: command.timeline.entry,
            },
            evidenceRefs: command.timeline.entry.evidenceRefs,
          })] : []),
        ];
        break;
      case "workout.correct_session_outcome":
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: "workout.outcome_corrected",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: { correction: command.correction },
          }),
        ];
        break;
      case "equipment_profile.revise":
        expectedRevisions = [
          {
            kind: "equipment_profile",
            id: command.equipmentProfileId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0
              ? "equipment_profile.created"
              : "equipment_profile.revised",
            aggregate: {
              kind: "equipment_profile",
              id: command.equipmentProfileId,
              revision: command.expectedRevision + 1,
            },
            payload: command.equipmentProfile,
          }),
        ];
        break;
      case "recovery_constraint.revise":
        expectedRevisions = [
          {
            kind: "recovery_constraint",
            id: command.recoveryConstraintId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0
              ? "recovery_constraint.created"
              : "recovery_constraint.revised",
            aggregate: {
              kind: "recovery_constraint",
              id: command.recoveryConstraintId,
              revision: command.expectedRevision + 1,
            },
            payload: command.recoveryConstraint,
          }),
        ];
        break;
      case "nutrition_strategy.revise":
        if (beforeProjection.plan) assertFixedPlanSafety(beforeProjection.plan.value, command.nutritionStrategy);
        expectedRevisions = [
          {
            kind: "nutrition_strategy",
            id: command.nutritionStrategyId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0
              ? "nutrition_strategy.created"
              : "nutrition_strategy.revised",
            aggregate: {
              kind: "nutrition_strategy",
              id: command.nutritionStrategyId,
              revision: command.expectedRevision + 1,
            },
            payload: command.nutritionStrategy,
          }),
        ];
        break;
      case "custom_exercise.create":
        expectedRevisions = [
          { kind: "custom_exercise", id: command.customExerciseId, revision: 0 },
        ];
        events = [
          event({
            name: "custom_exercise.created",
            aggregate: {
              kind: "custom_exercise",
              id: command.customExerciseId,
              revision: 1,
            },
            payload: command.exercise,
          }),
        ];
        break;
      case "custom_exercise.revise":
        expectedRevisions = [
          {
            kind: "custom_exercise",
            id: command.customExerciseId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: "custom_exercise.revised",
            aggregate: {
              kind: "custom_exercise",
              id: command.customExerciseId,
              revision: command.expectedRevision + 1,
            },
            payload: command.exercise,
          }),
        ];
        break;
      case "permission_set.revise":
        assertLocalSettingsAuthorization(command.authorization);
        expectedRevisions = [
          {
            kind: "permission_set",
            id: command.permissionSetId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0 ? "permission_set.created" : "permission_set.revised",
            aggregate: {
              kind: "permission_set",
              id: command.permissionSetId,
              revision: command.expectedRevision + 1,
            },
            payload: command.permissionSet,
          }),
        ];
        break;
      case "safety_constraint.revise":
        expectedRevisions = [
          {
            kind: "safety_constraint",
            id: command.safetyConstraintId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0
              ? "safety_constraint.created"
              : "safety_constraint.revised",
            aggregate: {
              kind: "safety_constraint",
              id: command.safetyConstraintId,
              revision: command.expectedRevision + 1,
            },
            payload: command.safetyConstraint,
          }),
        ];
        break;
      case "user_profile.set_archived":
      case "custom_exercise.set_archived":
      case "equipment_profile.set_archived":
        expectedRevisions = [command.aggregateRef];
        events = [
          event({
            name: command.archived ? "aggregate.archived" : "aggregate.restored",
            aggregate: { ...command.aggregateRef, revision: command.aggregateRef.revision + 1 },
            payload: { ...(command.reason ? { reason: command.reason } : {}) },
          }),
        ];
        break;
    }

    const outbox: OutboxEntry[] = events.map((domainEvent) => ({
      id: commandRuntime.nextId("outbox"),
      userId: command.meta.userId,
      replicaId: `device:${command.meta.deviceId}`,
      deviceId: command.meta.deviceId,
      domainEventId: domainEvent.id,
      payloadHash: stableHash(domainEvent),
      status: "pending",
      createdAt: recordedAt,
    }));
    const actionEvents = domainCommandActionEvents(
      command,
      events,
      beforeProjection,
      recordedAt,
      commandRuntime,
      this.knowledge.versionPins(),
    );
    const staleTargetId = command.type === "timeline.correct"
      ? command.correctsEventId
      : command.type === "timeline.source_mutate" || command.type === "timeline.source_tombstone"
        ? command.sourceEventId
        : undefined;
    const correctedWorkoutId =
      command.type === "workout.correct_set_outcome" || command.type === "workout.correct_session_outcome"
        ? command.workoutId
        : undefined;
    const stalePresentations = (staleTargetId || correctedWorkoutId)
      ? currentSnapshot.presentations
          .filter((presentation) => presentation.status !== "stale")
          .filter((presentation) => {
            const artifact = currentSnapshot.artifacts.find((item) => item.id === presentation.artifactId);
            return artifact?.evidenceRefs.some(
              (ref) =>
                (staleTargetId !== undefined && ref.aggregate === "timeline") ||
                (correctedWorkoutId !== undefined && ref.aggregate === "workout" && ref.id === correctedWorkoutId),
            );
          })
          .map((presentation) => ({ ...presentation, status: "stale" as const }))
      : [];
    const result = await this.ledger.commit({
      kind: "domain",
      userId: command.meta.userId,
      actorId: command.meta.actor.id,
      intent: command.type,
      expectedRevisions,
      domainEvents: events,
      ...(actionEvents.length ? { actionEvents } : {}),
      ...(attached.artifacts?.length ? { artifacts: attached.artifacts } : {}),
      ...(stalePresentations.length || attached.presentations?.length ? { presentations: [...stalePresentations, ...(attached.presentations ?? [])] } : {}),
      outbox,
      idempotencyKey: command.meta.idempotencyKey,
      recordedAt,
    });
    if (result.status === "committed") {
      await this.dispatchGoalPathReviewForDomainCommand(command, result);
      await this.notifyFixedGoalPathReview(command, result);
      await this.dispatchPostCommitRecipes(command, beforeProjection);
    }
    return result;
  }

  private async dispatchGoalPathReviewForDomainCommand(command: DomainCommand, result: DomainCommandResult): Promise<void> {
    const relevant = new Set<DomainCommand["type"]>([
      "timeline.append", "timeline.correct", "timeline.source_mutate", "timeline.source_tombstone",
      "workout.complete", "workout.correct_set_outcome", "workout.correct_session_outcome",
      "goal_contract.revise", "goal_contract.confirm", "plan.revise", "plan.commit_candidate", "plan.set_lifecycle",
      "nutrition_strategy.revise", "recovery_constraint.revise", "mandate.revise",
    ]);
    if (!relevant.has(command.type)) return;
    const eventId = result.eventIds[0] ?? command.meta.idempotencyKey;
    try {
      await this.reviewAndDeliverGoalPath({
        userId: command.meta.userId,
        trigger: "frontier_changed",
        channel: command.meta.actor.kind === "agent" ? "agent_conversation" : "manual_home",
        idempotencyKey: `frontier:${eventId}`,
        timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
      });
    } catch (cause) {
      const reason = cause instanceof Error && cause.message.includes("stale") ? "goal_path_snapshot_stale" : "goal_path_review_failed";
      try {
        await this.persistGoalPathAudit({ userId: command.meta.userId, trigger: "frontier_changed", status: cause instanceof Error && cause.message.includes("stale") ? "stale" : "failed", reasonCodes: [reason], idempotencyKey: `goal-path-audit:${eventId}` });
      } catch {
        // The accepted domain fact remains authoritative even if audit storage is unavailable.
      }
    }
  }

  /** Keep the Pi ingress outside domain decisions and make it post-commit. */
  private async notifyFixedGoalPathReview(command: DomainCommand, result: DomainCommandResult): Promise<void> {
    const relevant = new Set<DomainCommand["type"]>([
      "timeline.append", "timeline.correct", "timeline.source_mutate", "timeline.source_tombstone",
      "workout.complete", "workout.correct_set_outcome", "workout.correct_session_outcome",
      "goal_contract.revise", "goal_contract.confirm", "plan.revise", "plan.commit_candidate", "plan.set_lifecycle",
      "nutrition_strategy.revise", "recovery_constraint.revise", "mandate.revise",
    ]);
    if (!relevant.has(command.type)) return;
    try {
      await this.dependencies.afterFixedGoalPathReview?.({
        userId: command.meta.userId,
        causationId: result.eventIds[0] ?? command.meta.idempotencyKey,
      });
    } catch {
      // A local conversation/provider failure cannot roll back a formal fact.
    }
  }

  /** Non-decision side effects run after the fixed GoalPath review. */
  private async dispatchPostCommitRecipes(
    command: DomainCommand,
    before: DomainProjection,
  ): Promise<void> {
    switch (command.type) {
      case "workout.complete":
        if (command.outcome) {
          await this.enqueueCompletedWorkoutRecipes({
            userId: command.meta.userId,
            workoutId: command.workoutId,
            outcome: command.outcome,
            timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
          });
        }
        return;
      case "recovery_constraint.revise":
        if (command.recoveryConstraint.level !== "normal") {
          const occurredAt = command.recoveryConstraint.evaluation?.evaluatedAt ?? command.meta.occurredAt;
          await this.enqueueDefaultRecipe({
            userId: command.meta.userId,
            kind: "recovery_changed",
            occurredAt,
            causationId: command.recoveryConstraint.id,
            idempotencyKey: `recipe:recovery_changed:${command.recoveryConstraint.id}:${command.expectedRevision + 1}`,
            timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
            recoveryEvidence: "available",
          });
        }
        return;
      case "goal_contract.revise":
        return;
      case "equipment_profile.revise":
        await this.enqueueDefaultRecipe({
          userId: command.meta.userId,
          kind: "schedule_or_equipment_changed",
          occurredAt: command.meta.occurredAt,
          causationId: `equipment_profile:${command.equipmentProfileId}:${command.expectedRevision + 1}`,
          idempotencyKey: `recipe:equipment_changed:${command.equipmentProfileId}:${command.expectedRevision + 1}`,
          timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
        });
        return;
      case "profile.revise":
      case "profile.correct":
        if (!profilePlanningAvailabilityChanged(before.profile?.value, command.profile)) return;
        await this.enqueueDefaultRecipe({
          userId: command.meta.userId,
          kind: "schedule_or_equipment_changed",
          occurredAt: command.meta.occurredAt,
          causationId: `user_profile:${command.profileId}:${command.expectedRevision + 1}`,
          idempotencyKey: `recipe:schedule_changed:${command.profileId}:${command.expectedRevision + 1}`,
          timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
        });
        return;
      case "plan.revise":
        // A PlanRevision is a committed fact, not an Agent suggestion. Only
        // later revisions can change a user's existing day-type arrangement;
        if (command.expectedRevision === 0) return;
        await this.enqueueDefaultRecipe({
          userId: command.meta.userId,
          kind: "today_plan_changed",
          occurredAt: command.meta.occurredAt,
          causationId: `${command.planId}:${command.expectedRevision + 1}`,
          idempotencyKey: `recipe:today_plan_changed:${command.planId}:${command.expectedRevision + 1}`,
          timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
        });
        return;
      default:
        return;
    }
  }

  /**
   * Workout completion is an immutable fact, while its follow-up notification
   * is only a best-effort local effect. Replaying the completion deliberately
   * reuses the same trigger identities so a crash after the fact commit can be
   * repaired without generating another job or notification intent.
   */
  private async enqueueCompletedWorkoutRecipes(input: {
    userId: string;
    workoutId: string;
    outcome: import("./domain").SessionOutcomeData;
    timezoneOffsetMinutes?: number;
  }): Promise<void> {
    const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? timezoneOffsetForInstant(input.outcome.completedAt);
    const common = {
      userId: input.userId,
      occurredAt: input.outcome.completedAt,
      causationId: input.workoutId,
      timezoneOffsetMinutes,
    };
    await this.enqueueDefaultRecipe({
      ...common,
      kind: "session_completed_assessment",
      idempotencyKey: `recipe:session_completed:${input.workoutId}:${input.outcome.completedAt}`,
    });
  }

  /**
   * Domain commits must remain durable even if a later best-effort scheduler
   * call cannot run. The closed Recipe registry makes the follow-up safe to
   * retry: its idempotency key and current fact frontier are persisted by the
   * LocalRecipeEngine, and neither path can call a Provider or alter a plan.
   */
  private async enqueueDefaultRecipe(input: {
    userId: string;
    kind: Exclude<import("./model").CoachRecipeKind, "fixed_reminder">;
    occurredAt: string;
    causationId: string;
    idempotencyKey: string;
    timezoneOffsetMinutes: number;
    recoveryEvidence?: "available" | "unavailable";
    trainingInProgress?: boolean;
  }): Promise<void> {
    try {
      await this.recipes.ensureDefaultEventRecipes(input.userId);
      await this.recipes.triggerRecipe({
        userId: input.userId,
        recipeId: `default-recipe:${input.kind}`,
        occurredAt: input.occurredAt,
        causationId: input.causationId,
        idempotencyKey: input.idempotencyKey,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        localDateIntent: localDateAtTimezoneOffset(input.occurredAt, input.timezoneOffsetMinutes),
        factFrontier: frontierFactRefs(await this.currentDomainFrontier(input.userId)),
        ...(input.recoveryEvidence ? { recoveryEvidence: input.recoveryEvidence } : {}),
        ...(input.trainingInProgress ? { trainingInProgress: true } : {}),
      });
    } catch {
      // Notification scheduling is intentionally outside the domain commit.
      // A subsequent idempotent replay may repair a failed post-commit enqueue.
    }
  }

  readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection> {
    return this.ledger.readDomainProjection(query);
  }

  /**
   * The shared mobile shell reads one canonical, rebuildable projection through
   * this facade. It intentionally exposes no Ledger, Planner, rule pack or
   * provider object to React components.
   */
  async readProductProjection(input: {
    userId: string;
    date: string;
    timezoneOffsetMinutes: number;
    calendarMode: CalendarPresentationMode;
    calendarAnchorDate: string;
  }): Promise<CoachProductProjection> {
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const sessionIds = new Set(snapshot.sessions.filter((session) => session.userId === input.userId).map((session) => session.id));
    const sessionArtifactIds = new Set(snapshot.runEvents.flatMap((event) =>
      sessionIds.has(event.sessionId) && event.type === "artifact-ready" ? [event.artifactRef.id] : [],
    ));
    const customExerciseNames = new Map(
      domain.customExercises.map((exercise) => [exercise.value.id, exercise.value.name]),
    );
    const productDates = datesBetween(offsetDate(input.date, -45), offsetDate(input.date, 45));
    const healthLedgers = await this.materializeDailyHealthLedgers(input.userId, domain, productDates, input.timezoneOffsetMinutes);
    return buildCoachProductProjection({
      domain,
      date: input.date,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      calendarMode: input.calendarMode,
      calendarAnchorDate: input.calendarAnchorDate,
      actions: snapshot.actionEvents.filter((event) => event.userId === input.userId),
      pendingHumanActions: snapshot.pendingHumanActions.filter((item) => item.userId === input.userId),
      // Product artifacts are durable user projections. Restricting this list
      // to artifacts announced by an Agent run loses rule-engine Signal,
      // completion decisions and scheduled reports that are committed directly
      // by the domain workflow.
      artifacts: snapshot.artifacts.filter((artifact) =>
        ("userId" in artifact && artifact.userId === input.userId) || sessionArtifactIds.has(artifact.id),
      ),
      healthImportStates: snapshot.healthImportStates.filter((state) => state.userId === input.userId),
      exerciseLabel: (exerciseVariantId) =>
        customExerciseNames.get(exerciseVariantId) ??
        this.knowledge.exerciseVariant(exerciseVariantId)?.displayName.zh ??
        exerciseVariantId,
      healthLedgers,
      muscleWeek: assessMuscleWeek({
        week: weekBoundsFor(input.date),
        completedSets: domain.workouts
          .filter((workout) => workout.outcome?.completedAt)
          .map((workout) => ({ completedAt: workout.outcome!.completedAt, outcomes: workout.setOutcomes })),
        ...(domain.goalContract ? { goalContract: domain.goalContract.value } : {}),
        knowledgeVersion: this.knowledge.versionPins().exerciseCatalog.contentHash,
        exerciseById: (id) => this.knowledge.exerciseVariant(id),
      }),
    });
  }

  async prepareWorkoutSession(input: {
    userId: string;
    workoutId: string;
    prescriptionRef: import("./domain").PlannedSessionRef;
    mode?: import("./domain").WorkoutExecutionMode;
    policy?: import("./domain").WorkoutSessionPolicy;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const now = this.runtime.now();
    await this.executeDomainCommand({
      type: "workout.prepare",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: 0,
      prescriptionRef: input.prescriptionRef,
      mode: input.mode ?? "record_only",
      policy: input.policy ?? defaultWorkoutSessionPolicy(),
    });
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  async prepareFreestyleWorkoutSession(input: {
    userId: string;
    workoutId: string;
    session: import("./domain").PlannedSessionData;
    authoredBy?: "user" | "agent";
    mode?: import("./domain").WorkoutExecutionMode;
    policy?: import("./domain").WorkoutSessionPolicy;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const now = this.runtime.now();
    await this.executeDomainCommand({
      type: "workout.prepare_freestyle",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: 0,
      frozenPrescription: input.session,
      authoredBy: input.authoredBy ?? "user",
      mode: input.mode ?? "record_only",
      policy: input.policy ?? defaultWorkoutSessionPolicy(),
    });
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  async activateWorkoutSession(input: {
    userId: string;
    workoutId: string;
    mode?: import("./domain").WorkoutExecutionMode;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    const now = this.runtime.now();
    const first = nextUnperformedSet(workout);
    const state = transitionWorkoutState({
      current: workout.state,
      to: "active",
      reason: "user_started_session",
      actor: { kind: "user", id: input.userId },
      occurredAt: now,
      idempotencyKey: input.idempotencyKey,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(first ? { currentTaskId: first.taskId, currentSetId: first.set.id } : {}),
    });
    await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      state,
    });
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  /** Record-only and coach-monitor modes share one WorkoutSession and one prescription. */
  async setWorkoutMonitoringMode(input: {
    userId: string;
    workoutId: string;
    enabled: boolean;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active" && workout.status !== "paused") throw new Error("workout_not_monitorable");
    const now = this.runtime.now();
    const state = transitionWorkoutState({
      current: workout.state,
      to: workout.status,
      reason: input.enabled ? "coach_monitor_enabled" : "coach_monitor_disabled",
      actor: { kind: "user", id: input.userId },
      occurredAt: now,
      idempotencyKey: input.idempotencyKey,
      mode: input.enabled ? "coach_monitor" : "record_only",
    });
    await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      state,
    });
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  /**
   * Selects an unresolved task in today's execution route without rewriting
   * the planned order or any completed/drafted fact.
   */
  async focusWorkoutTask(input: {
    userId: string;
    workoutId: string;
    taskId: string;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active" && workout.status !== "paused") throw new Error("workout_not_active");
    const task = workout.frozenPrescription.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task) throw new Error("workout_task_not_found");
    const resolved = new Set(resolvedWorkoutSetIds(workout));
    const set = task.sets.find((candidate) => !resolved.has(candidate.id));
    if (!set) throw new Error("workout_task_has_no_unresolved_set");
    const now = this.runtime.now();
    const state = transitionWorkoutState({
      current: workout.state,
      to: workout.status,
      reason: "user_selected_execution_route_task",
      actor: { kind: "user", id: input.userId },
      occurredAt: now,
      idempotencyKey: input.idempotencyKey,
      currentTaskId: task.id,
      currentSetId: set.id,
    });
    await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      state,
    });
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  async pauseWorkoutSession(input: {
    userId: string;
    workoutId: string;
    reason?: "user" | "background" | "schedule";
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    return this.transitionWorkout(input.userId, input.workoutId, "paused", input.reason ?? "user_paused", input.idempotencyKey);
  }

  /** This records a non-diagnostic stop condition and freezes automatic progression. */
  async pauseWorkoutForSafety(input: {
    userId: string;
    workoutId: string;
    signal: "new_sharp_pain" | "chest_discomfort" | "dizziness_or_fainting" | "unusual_breathing_difficulty" | "known_constraint";
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    return this.transitionWorkout(input.userId, input.workoutId, "paused", `safety_${input.signal}`, input.idempotencyKey);
  }

  async resumeWorkoutSession(input: {
    userId: string;
    workoutId: string;
    idempotencyKey: string;
    allowExpiredPartialResume?: boolean;
    acknowledgeSafetyPause?: boolean;
  }): Promise<
    | { status: "resumed"; workout: import("./domain").WorkoutProjection }
    | { status: "partial_proposal"; workout: import("./domain").WorkoutProjection }
  > {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    const now = this.runtime.now();
    if (workout.state.pauseReason === "safety" && !input.acknowledgeSafetyPause) {
      throw new Error("safety_confirmation_required");
    }
    if (!input.allowExpiredPartialResume && hasExpiredRecoveryWindow(workout, now)) {
      const partial = await this.transitionWorkout(input.userId, input.workoutId, "partial", "resume_window_elapsed", input.idempotencyKey);
      return { status: "partial_proposal", workout: partial };
    }
    const resumed = await this.transitionWorkout(input.userId, input.workoutId, "active", "user_resumed", input.idempotencyKey);
    return { status: "resumed", workout: resumed };
  }

  async saveCurrentSetDraft(input: {
    userId: string;
    workoutId: string;
    idempotencyKey: string;
    draft?: Partial<Omit<import("./domain").SetDraftData, "id" | "prescriptionSetId" | "exerciseVariantId" | "proposedFromPrescription" | "status" | "createdAt" | "updatedAt">>;
  }): Promise<import("./domain").SetDraftData> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active" && workout.status !== "paused") throw new Error("workout_not_active");
    const target = currentSet(workout);
    if (!target) throw new Error("no_current_set");
    const now = this.runtime.now();
    const existing = workout.drafts.find((draft) => draft.prescriptionSetId === target.set.id);
    const draft: import("./domain").SetDraftData = {
      id: existing?.id ?? this.runtime.nextId("set-draft"),
      prescriptionSetId: target.set.id,
      exerciseVariantId: target.task.exerciseVariantId,
      proposedFromPrescription: target.set,
      ...(input.draft ?? {}),
      status: "draft",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.executeDomainCommand({
      type: "workout.save_draft_set",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      draft,
    });
    return draft;
  }

  async retractCurrentSetDraft(input: {
    userId: string;
    workoutId: string;
    draftId: string;
    idempotencyKey: string;
  }): Promise<void> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (!workout.drafts.some((draft) => draft.id === input.draftId)) throw new Error("draft_not_found");
    await this.executeDomainCommand({
      type: "workout.retract_draft_set",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      draftId: input.draftId,
      reason: "user_retracted_unsubmitted_set",
    });
  }

  async confirmCurrentSet(input: {
    userId: string;
    workoutId: string;
    idempotencyKey: string;
    draftId?: string;
    /** Explicit tap only. It is never inferred from a plan or a camera packet. */
    confirmAsPlanned?: boolean;
  }): Promise<import("./domain").SetOutcomeData> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active") throw new Error("workout_not_active");
    const target = currentSet(workout);
    if (!target) throw new Error("no_current_set");
    const draft = input.draftId
      ? workout.drafts.find((item) => item.id === input.draftId)
      : workout.drafts.find((item) => item.prescriptionSetId === target.set.id);
    const now = this.runtime.now();
    // 实测休息（ticket 05）：有休息计时器时按单调钟实测经过时间；无计时器则不测，不编造。
    const restTimer = workout.state.restTimer;
    let measuredRestSeconds: number | undefined;
    if (restTimer) {
      const durationMs = restTimer.duration.unit === "seconds"
        ? restTimer.duration.value * 1_000
        : restTimer.duration.value * 60_000;
      const startedMs = restTimer.deadlineMonotonicMs - durationMs;
      measuredRestSeconds = Math.max(0, Math.round((this.monotonicClock.nowMs() - startedMs) / 1_000));
    }
    const plannedRestSeconds = target.set.rest
      ? target.set.rest.unit === "seconds" ? target.set.rest.value : target.set.rest.value * 60
      : undefined;
    const restDeviation =
      measuredRestSeconds !== undefined && plannedRestSeconds
        ? measuredRestSeconds < plannedRestSeconds * 0.5
          ? "too_short" as const
          : measuredRestSeconds > plannedRestSeconds * 1.5
            ? "too_long" as const
            : "within" as const
        : undefined;
    const outcome = {
      ...outcomeFromDraft({
        id: this.runtime.nextId("set-outcome"),
        target,
        draft,
        confirmAsPlanned: Boolean(input.confirmAsPlanned),
      }),
      recordedAt: now,
      ...(measuredRestSeconds !== undefined ? { measuredRestSeconds } : {}),
      ...(restDeviation ? { restDeviation } : {}),
    };
    await this.executeDomainCommand({
      type: "workout.record_set",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      outcome,
    });
    return outcome;
  }

  /**
   * Advance past one prescribed set without inventing a performed outcome.
   * The required user reason remains an append-only execution fact and the
   * skipped set stays frozen against later prescription edits.
   */
  async skipCurrentSet(input: {
    userId: string;
    workoutId: string;
    reason: string;
    idempotencyKey: string;
  }): Promise<import("./domain").SkippedSetData> {
    const reason = input.reason.trim();
    if (!reason) throw new Error("skip_reason_required");
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active") throw new Error("workout_not_active");
    const target = currentSet(workout);
    if (!target) throw new Error("no_current_set");
    const now = this.runtime.now();
    const skipped: import("./domain").SkippedSetData = {
      id: this.runtime.nextId("skipped-set"),
      prescriptionSetId: target.set.id,
      exerciseVariantId: target.task.exerciseVariantId,
      reason,
      skippedAt: now,
    };
    await this.executeDomainCommand({
      type: "workout.skip_set",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      skipped,
    });
    return skipped;
  }

  async reviseUpcomingWorkoutPlan(input: {
    userId: string;
    workoutId: string;
    frozenPrescription: import("./domain").PlannedSessionData;
    scope: "next_set" | "future_sets" | "future_tasks";
    reason: string;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    assertOnlyUpcomingPlannedSessionChanged({
      before: workout.frozenPrescription,
      after: input.frozenPrescription,
      completedPrescriptionSetIds: resolvedWorkoutSetIds(workout),
      currentSetId: workout.drafts.some((draft) => draft.prescriptionSetId === workout.state.currentSetId)
        ? workout.state.currentSetId
        : undefined,
    });
    await this.executeDomainCommand({
      type: "workout.revise_prescription",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      frozenPrescription: input.frozenPrescription,
      reason: input.reason,
      scope: input.scope,
    });
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  /**
   * The only public mutation surface for task-level edits during a running
   * workout.  Both the shared mobile UI and a registered Coach tool use this
   * command, so neither needs to manufacture a whole SessionPrescription.
   */
  async editUpcomingWorkoutPlan(input: {
    userId: string;
    workoutId: string;
    change: import("./domain").UpcomingWorkoutPlanChange;
    reason: string;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    const currentDraft = workout.drafts.find(
      (draft) => draft.prescriptionSetId === workout.state.currentSetId,
    );
    const applied = applyUpcomingWorkoutPlanChange({
      before: workout.frozenPrescription,
      change: input.change,
      completedPrescriptionSetIds: resolvedWorkoutSetIds(workout),
      ...(currentDraft ? { draftedPrescriptionSetId: currentDraft.prescriptionSetId } : {}),
    });
    if (input.change.kind === "add_task") {
      await this.assertKnownWorkoutExerciseVariant(input.userId, input.change.task.exerciseVariantId);
    } else if (input.change.kind === "replace_task_exercise" || input.change.kind === "replace_remaining_task") {
      await this.assertKnownWorkoutExerciseVariant(input.userId, input.change.replacementExerciseVariantId);
    }
    return this.reviseUpcomingWorkoutPlan({
      userId: input.userId,
      workoutId: input.workoutId,
      frozenPrescription: applied.frozenPrescription,
      scope: applied.scope,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
  }


  async startRestTimer(input: {
    userId: string;
    workoutId: string;
    setId?: string;
    duration: import("./domain").DurationQuantity;
    idempotencyKey: string;
  }): Promise<{ deadline: string; notificationScheduled: boolean }> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active" && workout.status !== "paused") throw new Error("workout_not_active");
    const now = this.runtime.now();
    const durationMs = durationToMilliseconds(input.duration);
    const deadline = new Date(Date.parse(now) + durationMs).toISOString();
    const state = {
      ...workout.state,
      restTimer: {
        id: this.runtime.nextId("rest-timer"),
        setId: input.setId ?? workout.state.currentSetId ?? "session",
        deadlineMonotonicMs: this.monotonicClock.nowMs() + durationMs,
        ...(this.monotonicClock.epochId ? { monotonicClockEpoch: this.monotonicClock.epochId() } : {}),
        deadlineWallClockAt: deadline,
        duration: input.duration,
        ...(this.notifications ? { notificationId: `rest:${input.workoutId}:${workout.revision}` } : {}),
      },
    };
    const committed = await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      state,
    });
    if (committed.status === "committed" && this.notifications && state.restTimer.notificationId) {
      await this.notifications.upsert({
        id: state.restTimer.notificationId,
        at: deadline,
        title: "休息结束",
        body: "可以开始下一组了",
      });
    }
    return { deadline, notificationScheduled: committed.status === "committed" && Boolean(this.notifications) };
  }

  async remainingWorkoutRest(input: { userId: string; workoutId: string }): Promise<number | null> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (!workout.state.restTimer) return null;
    return remainingRestSeconds({
      deadlineMonotonicMs: workout.state.restTimer.deadlineMonotonicMs,
      deadlineMonotonicClockEpoch: workout.state.restTimer.monotonicClockEpoch,
      deadlineWallClockAt: workout.state.restTimer.deadlineWallClockAt,
      nowMonotonicMs: this.monotonicClock.nowMs(),
      nowMonotonicClockEpoch: this.monotonicClock.epochId?.(),
      nowWallClockAt: this.runtime.now(),
    });
  }

  /**
   * Extends or shortens an active rest interval from the persisted deadline.
   * The platform notification is updated only after the new deadline commits.
   */
  async adjustWorkoutRest(input: {
    userId: string;
    workoutId: string;
    deltaSeconds: number;
    idempotencyKey: string;
  }): Promise<{ remainingSeconds: number | null; notificationScheduled: boolean }> {
    if (!Number.isInteger(input.deltaSeconds) || input.deltaSeconds === 0) {
      throw new Error("invalid_rest_adjustment");
    }
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    const timer = workout.state.restTimer;
    if (!timer) return { remainingSeconds: null, notificationScheduled: false };
    const remaining = remainingRestSeconds({
      deadlineMonotonicMs: timer.deadlineMonotonicMs,
      deadlineMonotonicClockEpoch: timer.monotonicClockEpoch,
      deadlineWallClockAt: timer.deadlineWallClockAt,
      nowMonotonicMs: this.monotonicClock.nowMs(),
      nowMonotonicClockEpoch: this.monotonicClock.epochId?.(),
      nowWallClockAt: this.runtime.now(),
    });
    const nextSeconds = Math.max(0, remaining + input.deltaSeconds);
    if (nextSeconds === 0) {
      await this.cancelWorkoutRest({
        userId: input.userId,
        workoutId: input.workoutId,
        idempotencyKey: input.idempotencyKey,
      });
      return { remainingSeconds: null, notificationScheduled: false };
    }
    const now = this.runtime.now();
    const deadline = new Date(Date.parse(now) + nextSeconds * 1_000).toISOString();
    const state = {
      ...workout.state,
      restTimer: {
        ...timer,
        deadlineMonotonicMs: this.monotonicClock.nowMs() + nextSeconds * 1_000,
        ...(this.monotonicClock.epochId ? { monotonicClockEpoch: this.monotonicClock.epochId() } : { monotonicClockEpoch: undefined }),
        deadlineWallClockAt: deadline,
        duration: { value: nextSeconds, unit: "seconds" as const },
      },
    };
    const committed = await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      state,
    });
    if (committed.status === "committed" && timer.notificationId && this.notifications) {
      const notification = {
        id: timer.notificationId,
        at: deadline,
        title: "休息结束",
        body: "可以开始下一组了",
      };
      await this.notifications.upsert(notification);
    }
    return {
      remainingSeconds: committed.status === "committed" ? nextSeconds : null,
      notificationScheduled: committed.status === "committed" && Boolean(timer.notificationId && this.notifications),
    };
  }

  /**
   * A rest timer is execution state, not an implicit delay in the UI.  Clear
   * its persisted deadline before asking a native adapter to cancel so an app
   * restart or a duplicated tap can never resurrect a cancelled rest period.
   */
  async cancelWorkoutRest(input: {
    userId: string;
    workoutId: string;
    idempotencyKey: string;
  }): Promise<{ cancelled: boolean }> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    const timer = workout.state.restTimer;
    if (!timer) return { cancelled: false };
    const committed = await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      state: { ...workout.state, restTimer: undefined },
    });
    if (committed.status === "committed" && timer.notificationId && this.notifications) {
      await this.notifications.cancel(timer.notificationId);
    }
    return { cancelled: committed.status === "committed" };
  }

  async completeWorkoutSession(input: {
    userId: string;
    workoutId: string;
    idempotencyKey: string;
    status?: "completed" | "partial";
  }): Promise<import("./domain").SessionOutcomeData> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status === "completed") {
      if (!workout.outcome) throw new Error("completed_workout_outcome_missing");
      await this.enqueueCompletedWorkoutRecipes({
        userId: input.userId,
        workoutId: input.workoutId,
        outcome: workout.outcome,
      });
      return workout.outcome;
    }
    if (workout.status !== "active" && workout.status !== "paused" && workout.status !== "partial") {
      throw new Error("workout_not_completable");
    }
    const now = this.runtime.now();
    const derived = deriveSessionOutcome(workout, now);
    const outcome = {
      ...derived,
      status: input.status ?? (derived.status === "completed" ? "completed" : "partial"),
    } satisfies import("./domain").SessionOutcomeData;
    const projection = await this.readDomainProjection({ userId: input.userId });
    await this.executeDomainCommand({
      type: "workout.complete",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      status: outcome.status === "completed" ? "completed" : "partial",
      outcome,
      timeline: {
        timelineId: `timeline.${input.userId}`,
        expectedRevision: projection.timeline.revision,
        fact: {
          kind: "training",
          workoutSessionRef: { kind: "workout_session", id: input.workoutId, revision: workout.revision + 1 },
          confidence: "confirmed",
        },
        entry: {
          id: this.runtime.nextId("timeline-entry"),
          schemaVersion: 1,
          factType: "training",
          time: { startedAt: now, timezoneOffsetMinutes: new Date(now).getTimezoneOffset() * -1 },
          recordedAt: now,
          actor: { kind: "user", id: input.userId },
          provenance: {
            origin: "manual",
            recordingMethod: "manual_entry",
            dataStatus: "available",
            confidence: "confirmed",
          },
          privacyClass: "sensitive",
          causalRefs: [`workout_session:${input.workoutId}`],
          evidenceRefs: [],
          layer: "canonical_projection",
        },
      },
    });
    // 数据桥（ticket 02）：user_confirmed 的组逐条写成 timeline historicalSet 事实，
    // 让 planner 的 history 不再为空——后续计划按真实表现进阶。
    for (const set of workout.setOutcomes) {
      if (set.source !== "user_confirmed" || !set.actualLoad || set.actualReps === undefined) continue;
      await this.recordTimelineFact({
        userId: input.userId,
        idempotencyKey: `${input.idempotencyKey}:historical-set:${set.id}`,
        fact: {
          kind: "training",
          historicalSet: {
            exerciseVariantId: set.exerciseVariantId,
            load: set.actualLoad,
            reps: set.actualReps,
            ...(set.actualRir !== undefined ? { rir: set.actualRir } : {}),
          },
          confidence: "confirmed",
        },
        envelope: {
          time: { startedAt: now, timezoneOffsetMinutes: new Date(now).getTimezoneOffset() * -1 },
          provenance: {
            origin: "manual",
            recordingMethod: "manual_entry",
            dataStatus: "available",
            confidence: "confirmed",
            sourceRecordId: `${input.workoutId}:set:${set.id}`,
          },
          privacyClass: "sensitive",
          evidenceRefs: [],
          layer: "canonical_projection",
          causalRefs: [`workout_session:${input.workoutId}`, `set_outcome:${set.id}`],
        },
      });
    }
    // 个人节奏校准（ticket 05）：实测休息中位数沉淀为 observed_calibration，供时长估算个性化
    if (this.personalKnowledge) {
      const measured = workout.setOutcomes.flatMap((set) =>
        set.measuredRestSeconds !== undefined ? [set.measuredRestSeconds] : []);
      if (measured.length) {
        const sorted = [...measured].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        const existing = (await this.personalKnowledge.list(input.userId))
          .find((entry) => entry.key === "rest_tempo_seconds");
        const next = {
          kind: "observed_calibration" as const,
          value: { medianRestSeconds: median },
          evidenceWindow: {
            from: workout.setOutcomes[0]?.recordedAt ?? now,
            to: now,
          },
          sourceFactRefs: workout.setOutcomes
            .filter((set) => set.measuredRestSeconds !== undefined)
            .map((set) => `set_outcome:${set.id}`),
        };
        if (existing) {
          await this.personalKnowledge.supersede({
            userId: input.userId,
            id: existing.id,
            expectedVersion: existing.version,
            next,
          });
        } else {
          await this.personalKnowledge.put({ userId: input.userId, key: "rest_tempo_seconds", ...next });
        }
      }
    }
    return outcome;
  }

  /**
   * A committed set is never edited in place.  This creates an immutable
   * compensating correction and keeps the original set event available for
   * replay, audit, and the user's history.
   */
  async correctRecordedSet(input: {
    userId: string;
    workoutId: string;
    outcomeId: string;
    patch: import("./domain").SetOutcomeCorrectionPatch;
    reason: string;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    const reason = input.reason.trim();
    if (!reason) throw new Error("correction_reason_required");
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    const original = workout.setOutcomes.find((outcome) => outcome.id === input.outcomeId);
    if (!original) throw new Error("set_outcome_not_found");
    const replacement = correctedSetOutcome(original, input.patch);
    if (stableHash(replacement) === stableHash(original)) throw new Error("set_outcome_correction_no_change");
    return this.executeDomainCommand({
      type: "workout.correct_set_outcome",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      correction: {
        id: this.runtime.nextId("set-outcome-correction"),
        correctsOutcomeId: original.id,
        replacement,
        reason,
      },
    });
  }

  /**
   * Outcome totals remain derived from the immutable set log.  This narrow
   * correction surface deliberately permits only a terminal-status or
   * subjective-feedback correction, never a destructive replacement of the
   * completed Session record.
   */
  async correctWorkoutSessionOutcome(input: {
    userId: string;
    workoutId: string;
    patch: import("./domain").SessionOutcomeCorrectionPatch;
    reason: string;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    const reason = input.reason.trim();
    if (!reason) throw new Error("correction_reason_required");
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (!workout.outcome || !["completed", "partial"].includes(workout.status)) {
      throw new Error("workout_outcome_not_found");
    }
    const outcome = correctedSessionOutcome(workout.outcome, input.patch);
    if (outcome.status === "completed" && outcome.incompletePrescriptionSetIds.length) {
      throw new Error("completed_outcome_requires_all_sets");
    }
    if (stableHash(outcome) === stableHash(workout.outcome)) {
      throw new Error("workout_outcome_correction_no_change");
    }
    return this.executeDomainCommand({
      type: "workout.correct_session_outcome",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      workoutId: input.workoutId,
      expectedRevision: workout.revision,
      correction: {
        id: this.runtime.nextId("session-outcome-correction"),
        outcome,
        reason,
      },
    });
  }

  /** Applies one validated workout state transition. */
  private async transitionWorkout(
    userId: string,
    workoutId: string,
    to: import("./domain").WorkoutSessionStatus,
    reason: string,
    idempotencyKey: string,
  ): Promise<import("./domain").WorkoutProjection> {
    const workout = await this.requireWorkoutProjection(userId, workoutId);
    const now = this.runtime.now();
    const state = transitionWorkoutState({
      current: workout.state,
      to,
      reason,
      actor: { kind: "user", id: userId },
      occurredAt: now,
      idempotencyKey,
    });
    await this.executeDomainCommand({
      type: "workout.transition",
      meta: settingsCommandMeta(userId, idempotencyKey, now),
      workoutId,
      expectedRevision: workout.revision,
      state,
    });
    return this.requireWorkoutProjection(userId, workoutId);
  }

  /** Read-only public seam for the shared workout workspace. */
  readWorkoutSession(input: { userId: string; workoutId: string }) {
    return this.requireWorkoutProjection(input.userId, input.workoutId);
  }

  private async requireWorkoutProjection(userId: string, workoutId: string) {
    const projection = await this.readDomainProjection({ userId });
    const workout = projection.workouts.find((item) => item.id === workoutId);
    if (!workout) throw new Error("workout_session_not_found");
    return workout;
  }

  /** Catalog entries and active user-owned variants are the only valid task identities. */
  private async assertKnownWorkoutExerciseVariant(userId: string, exerciseVariantId: string): Promise<void> {
    const projection = await this.readDomainProjection({ userId });
    const activeCustomIds = new Set(
      projection.customExercises
        .filter((exercise) => !projection.archivedAggregates.some(
          (archived) => archived.kind === "custom_exercise" && archived.id === exercise.value.id,
        ))
        .map((exercise) => exercise.value.id),
    );
    if (!this.knowledge.exerciseVariant(exerciseVariantId) && !activeCustomIds.has(exerciseVariantId)) {
      throw new Error("unknown_or_archived_workout_exercise_variant");
    }
  }

  async readDataLifecycleStatus(
    userId: string,
    aggregate: { kind: import("./domain").DomainAggregateKind; id: string },
  ): Promise<DataLifecycleStatus> {
    const snapshot = await this.ledger.read();
    const state = snapshot.aggregateRevisions.find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.kind === aggregate.kind &&
        candidate.id === aggregate.id,
    );
    const events = snapshot.domainEvents.filter(
      (event) =>
        event.userId === userId &&
        event.aggregate.kind === aggregate.kind &&
        event.aggregate.id === aggregate.id,
    );
    const outbox = snapshot.outbox.filter(
      (entry) => entry.userId === userId && events.some((event) => event.id === entry.domainEventId),
    );
    const evidence = events.flatMap((event) => event.evidenceRefs);
    return {
      aggregate: {
        kind: aggregate.kind,
        id: aggregate.id,
        revision: state?.revision ?? 0,
      },
      structuredData: state ? (state.archived ? "archived" : "active") : "missing",
      replicaReferences: {
        pending: outbox.filter((entry) => entry.status === "pending").length,
        acknowledged: outbox.filter((entry) => entry.status === "acknowledged").length,
        conflicts: outbox.filter((entry) => entry.status === "conflict").length,
      },
      evidenceReferences: {
        canonicalPackets: evidence.filter((ref) => ref.kind === "canonical_packet").length,
        disposition: evidence.length ? "retained" : "not_present",
      },
    };
  }

  async updateCoachingMandateFromSettings(input: {
    userId: string;
    mandateId: string;
    expectedRevision: number;
    mandate: import("./domain").CoachingMandateData;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    return this.executeDomainCommand({
      type: "mandate.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      mandateId: input.mandateId,
      expectedRevision: input.expectedRevision,
      mandate: input.mandate,
      authorization: input.authorization,
    });
  }

  async updateProfileFromSettings(input: {
    userId: string;
    expectedRevision: number;
    profile: import("./domain").UserProfileData;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    return this.executeDomainCommand({
      type: "profile.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      profileId: input.profile.id,
      expectedRevision: input.expectedRevision,
      profile: input.profile,
    });
  }

  async correctProfileFromSettings(input: {
    userId: string;
    expectedRevision: number;
    correctsEventId: string;
    reason: string;
    profile: import("./domain").UserProfileData;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    return this.executeDomainCommand({
      type: "profile.correct",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      profileId: input.profile.id,
      expectedRevision: input.expectedRevision,
      correctsEventId: input.correctsEventId,
      reason: input.reason,
      profile: input.profile,
    });
  }

  async updateGoalContractFromSettings(input: {
    userId: string;
    expectedRevision: number;
    goalContract: import("./domain").GoalContractData;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    return this.executeDomainCommand({
      type: "goal_contract.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      goalContractId: input.goalContract.id,
      expectedRevision: input.expectedRevision,
      goalContract: input.goalContract,
    });
  }

  async setProfileAggregateArchivedFromSettings(input: {
    userId: string;
    aggregate: import("./domain").DomainAggregateRef<"user_profile">;
    archived: boolean;
    reason?: string;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    return this.executeDomainCommand({
      type: "user_profile.set_archived",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      aggregateRef: input.aggregate,
      archived: input.archived,
      ...(input.reason ? { reason: input.reason } : {}),
    });
  }

  async updatePermissionFromSettings(input: {
    userId: string;
    expectedRevision: number;
    changes: Partial<Omit<import("./domain").PermissionSetData, "id">>;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    const projection = await this.readDomainProjection({ userId: input.userId });
    const current = projection.permissions;
    if (!current) throw new Error(`PermissionSet not found: ${input.userId}`);
    if (
      input.changes.notifications === "granted" &&
      current.value.notifications !== "granted" &&
      this.notifications?.requestAuthorization
    ) {
      // Only a foreground settings action reaches this method. A Recipe or
      // background catch-up never calls it, so platform permission prompts
      // cannot be caused by a scheduled task.
      const nativeStatus = await this.notifications.requestAuthorization();
      if (nativeStatus !== "granted") throw new Error("native_notification_permission_denied");
    }
    const next = { ...current.value, ...input.changes };
    if (next.remoteLlm === "granted" && !next.remoteLlmDisclosure) {
      next.remoteLlmDisclosure = {
        taskRelevantHealthTrainingNutritionSleepAndExperienceSent: true,
        directIdentityFieldsRemoved: [
          "name",
          "address",
          "contact_details",
          "precise_location",
          "external_account_id",
        ],
        consentedAt: this.runtime.now(),
      };
    }
    return this.executeDomainCommand({
      type: "permission_set.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      permissionSetId: current.value.id,
      expectedRevision: input.expectedRevision,
      permissionSet: next,
      authorization: input.authorization,
    });
  }

  inspectInstalledKnowledgePack() {
    return this.knowledge.inspect();
  }

  getInstalledKnowledgeVersionPins() {
    return this.knowledge.versionPins();
  }

  replayExerciseVariant(
    pin: ReturnType<KnowledgePackRegistry["versionPins"]>["exerciseCatalog"],
    exerciseVariantId: string,
  ) {
    return this.knowledge.replayExerciseVariant(pin, exerciseVariantId);
  }

  searchExerciseCatalog(input: ExerciseSearchInput) {
    return this.knowledge.search(input);
  }

  /**
   * Read-only installed coaching knowledge for the Pi conversation harness.
   * This is deliberately not the old artifact-presentation tool path: the
   * harness needs typed passages while it is composing a reply, whereas the
   * presentation layer owns user-visible cards. Food composition remains
   * outside the V1 capability boundary.
   */
  searchInstalledKnowledge(input: {
    query: string;
    topic?: "training" | "nutrition" | "recovery" | "exercise";
    limit?: number;
  }): {
    readonly kind: "found" | "unknown";
    readonly entries: readonly {
      id: string;
      title: string;
      text: string;
      passageRef: { passageId: string; contentHash: string; citationIds: readonly string[] };
    }[];
  } {
    if (isFoodCompositionLookup(input.query)) {
      throw new Error("food_composition_lookup_not_supported");
    }
    // 分层加载（skill 模式）：检索默认只回蒸馏层（L2 gist + L1 段落结论），
    // 原文永远在本机，agent 需要时按 passageId 下钻（readInstalledKnowledgePassage）。
    // 请求体预算由此与检索次数解耦（2026-08-16 413 复盘）。
    const layered = this.knowledge.searchKnowledgeLayered({
      query: input.query,
      limit: input.limit ?? 4,
      ...(input.topic ? { topic: input.topic } : {}),
    });
    return {
      kind: layered.entries.length ? "found" : "unknown",
      entries: layered.entries.map((entry) => {
        const firstPassageId = entry.gist.passageIds[0] ?? "";
        const firstPassage = firstPassageId ? this.knowledge.readKnowledgePassage(firstPassageId) : undefined;
        const points = entry.keypoints.map((keypoint) => keypoint.point);
        return {
          id: entry.gist.id,
          title: entry.gist.sectionKey.replace("::", " · "),
          text: [
            entry.gist.gist,
            ...points,
            `原文段落：${entry.gist.passageIds.join("、")}（需要全文用 knowledge.read_passage 按 id 读取）`,
          ].join("\n"),
          passageRef: {
            passageId: firstPassageId,
            contentHash: firstPassage?.contentHash ?? "",
            citationIds: entry.gist.citationRefs,
          },
        };
      }),
    };
  }

  /** 下钻 L0 原文段落（agent 判断蒸馏层不够时按需读取）。 */
  readInstalledKnowledgePassage(input: { passageId: string }): {
    readonly kind: "found" | "unknown";
    readonly id?: string;
    readonly title?: string;
    readonly text?: string;
    readonly citationIds?: readonly string[];
  } {
    const passage = this.knowledge.readKnowledgePassage(input.passageId);
    if (!passage) return { kind: "unknown" };
    return {
      kind: "found",
      id: passage.id,
      title: [passage.docTitle, ...passage.sectionPath].filter(Boolean).join(" · "),
      text: passage.text,
      citationIds: passage.citationRefs,
    };
  }

  resolveExerciseSubstitutions(input: SubstitutionInput) {
    const target = input.goalPack === "fat_loss"
      ? "fat_loss_preserve_lean_mass" as const
      : input.goalPack === "hypertrophy" || input.goalPack === "strength"
        ? input.goalPack
        : undefined;
    const policy = target ? this.trainingRules.substitutionPolicy(target) : undefined;
    return this.knowledge.resolveSubstitutions({
      ...input,
      ...(policy ? { rankingPolicy: { weights: policy.policy, ruleVersion: policy.rule } } : {}),
    });
  }

  resolveMotionCapabilities(input: { exerciseVariantId: string; cameraView: string }) {
    return this.knowledge.resolve(input);
  }

  /**
   * Location equipment is a user-owned fact. This proposal is deliberately
   * non-authoritative until the local user-presence action commits it.
   */
  proposeEquipmentProfileChange(input: {
    userId: string;
    profile: import("./domain").EquipmentProfileData;
    baseRevision: number;
    source?: "user" | "agent";
  }) {
    return Object.freeze({
      kind: "equipment_profile_proposal" as const,
      userId: input.userId,
      baseRevision: input.baseRevision,
      profile: clone(input.profile),
      source: input.source ?? "user",
      authority: "pending_local_user_confirmation" as const,
      changesFutureLocation: true as const,
      temporaryStateExcluded: true as const,
    });
  }

  async commitEquipmentProfileChange(input: {
    userId: string;
    expectedRevision: number;
    profile: import("./domain").EquipmentProfileData;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    validateEquipmentProfile(input.profile);
    return this.executeDomainCommand({
      type: "equipment_profile.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      equipmentProfileId: input.profile.id,
      expectedRevision: input.expectedRevision,
      equipmentProfile: input.profile,
    });
  }

  /** A temporary busy/broken state is only applied to this substitution request. */
  async resolveSubstitutionsAtLocation(input: {
    userId: string;
    equipmentProfileId: string;
    originalExerciseId: string;
    goalPack: SubstitutionInput["goalPack"];
    constraints: SubstitutionInput["constraints"];
    temporaryStates?: readonly import("./domain").TemporaryEquipmentStateData[];
    cameraView?: string;
  }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const profile = projection.equipmentProfiles.find(
      (item) => item.value.id === input.equipmentProfileId,
    );
    if (!profile) throw new Error(`EquipmentProfile not found: ${input.equipmentProfileId}`);
    const equipmentStates = profile.value.equipment?.map((item) => ({ id: item.id, status: item.status })) ??
      profile.value.equipmentIds.map((id) => ({ id, status: "available" as const }));
    const temporary = input.temporaryStates ?? [];
    const stateById = new Map(equipmentStates.map((item) => [item.id, item.status]));
    for (const state of temporary) stateById.set(state.equipmentId, state.status);
    return this.resolveExerciseSubstitutions({
      originalExerciseId: input.originalExerciseId,
      goalPack: input.goalPack,
      availableEquipment: [...stateById]
        .filter(([, status]) => status === "available")
        .map(([id]) => id),
      equipmentStates: [...stateById].map(([id, status]) => ({ id, status })),
      cameraView: input.cameraView,
      constraints: input.constraints,
    });
  }

  /** Explicitly saves a long-term preference or a mandate lock; temporary choices are never inferred. */
  async persistExerciseSelection(input: {
    userId: string;
    exerciseVariantId: string;
    scope: "future_preference" | "lock";
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    const projection = await this.readDomainProjection({ userId: input.userId });
    const now = this.runtime.now();
    if (input.scope === "future_preference") {
      if (!projection.profile) throw new Error(`Profile not found: ${input.userId}`);
      const preferences = [
        ...(projection.profile.value.exercisePreferences ?? []).filter(
          (item) => item.exerciseVariantId !== input.exerciseVariantId,
        ),
        {
          id: `exercise-preference.${stableHash({ userId: input.userId, exerciseVariantId: input.exerciseVariantId })}`,
          exerciseVariantId: input.exerciseVariantId,
          scope: "future_preference" as const,
          createdAt: now,
        },
      ];
      return this.executeDomainCommand({
        type: "profile.revise",
        meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
        profileId: projection.profile.value.id,
        expectedRevision: projection.profile.revision,
        profile: { ...projection.profile.value, exercisePreferences: preferences },
      });
    }
    if (!projection.mandate) throw new Error(`CoachingMandate not found: ${input.userId}`);
    const lockId = `exercise-lock.${stableHash({ userId: input.userId, exerciseVariantId: input.exerciseVariantId })}`;
    return this.executeDomainCommand({
      type: "mandate.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, now),
      mandateId: projection.mandate.value.id,
      expectedRevision: projection.mandate.revision,
      mandate: {
        ...projection.mandate.value,
        locks: [
          ...(projection.mandate.value.locks ?? []).filter((lock) => lock.id !== lockId),
          {
            id: lockId,
            field: "exercise" as const,
            scope: "future_sessions" as const,
            value: input.exerciseVariantId,
          },
        ],
      },
      authorization: input.authorization,
    });
  }

  async createCustomExerciseVariant(input: {
    userId: string;
    name: string;
    movement?: MovementPattern;
    prescriptionMode?: import("../knowledge").StimulusContract["prescriptionMode"];
    equipmentRequirement?: import("./domain").EquipmentRequirement;
    idempotencyKey: string;
  }): Promise<CustomExerciseVariantView> {
    const id = `custom.${stableHash({
      userId: input.userId,
      name: input.name.trim(),
      movement: input.movement,
      equipmentRequirement: input.equipmentRequirement ?? null,
    })}`;
    const now = this.runtime.now();
    await this.executeDomainCommand({
      type: "custom_exercise.create",
      meta: {
        userId: input.userId,
        actor: { kind: "user", id: input.userId },
        deviceId: "local-device",
        occurredAt: now,
        timezoneOffsetMinutes: new Date(now).getTimezoneOffset() * -1,
        idempotencyKey: input.idempotencyKey,
      },
      customExerciseId: id,
      exercise: {
        id,
        name: input.name.trim(),
        ...(input.movement ? { movement: input.movement } : {}),
        prescriptionMode: input.prescriptionMode ?? "weighted_reps",
        equipmentRequirement: input.equipmentRequirement ?? { kind: "unknown" },
        unknownFields: [
          "expected_muscles",
          "stimulus",
          "difficulty",
          "load_history",
          ...(input.equipmentRequirement ? [] : ["equipment" as const]),
          "motion_capability",
        ],
        motionCapability: "unknown",
      },
    });
    const projection = await this.readDomainProjection({ userId: input.userId });
    const custom = projection.customExercises.find((item) => item.value.id === id);
    if (!custom) throw new Error(`Custom exercise not found after commit: ${id}`);
    return {
      ...custom.value,
      userId: input.userId,
      createdAt: now,
      revision: custom.revision,
      status: "active",
    };
  }

  async reviseCustomExerciseVariant(input: {
    userId: string;
    customExerciseId: string;
    expectedRevision: number;
    patch: {
      name?: string;
      movement?: MovementPattern | null;
      prescriptionMode?: import("../knowledge").StimulusContract["prescriptionMode"];
      equipmentRequirement?: import("./domain").EquipmentRequirement;
    };
    idempotencyKey: string;
  }): Promise<CustomExerciseVariantView> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const current = projection.customExercises.find(
      (item) => item.value.id === input.customExerciseId,
    );
    if (!current || current.revision !== input.expectedRevision) {
      throw new Error(`Custom exercise revision mismatch: ${input.customExerciseId}`);
    }
    const movement = input.patch.movement === null ? undefined : input.patch.movement ?? current.value.movement;
    const equipmentRequirement = input.patch.equipmentRequirement ?? current.value.equipmentRequirement;
    const unknownFields = new Set(current.value.unknownFields);
    if (movement) unknownFields.delete("stimulus");
    else unknownFields.add("stimulus");
    if (equipmentRequirement.kind === "unknown") unknownFields.add("equipment");
    else unknownFields.delete("equipment");
    const next = {
      ...current.value,
      name: input.patch.name?.trim() || current.value.name,
      ...(movement ? { movement } : {}),
      prescriptionMode: input.patch.prescriptionMode ?? current.value.prescriptionMode,
      equipmentRequirement,
      unknownFields: [...unknownFields].sort(),
    };
    await this.executeDomainCommand({
      type: "custom_exercise.revise",
      meta: {
        userId: input.userId,
        actor: { kind: "user", id: input.userId },
        deviceId: "local-device",
        occurredAt: this.runtime.now(),
        timezoneOffsetMinutes: new Date(this.runtime.now()).getTimezoneOffset() * -1,
        idempotencyKey: input.idempotencyKey,
      },
      customExerciseId: input.customExerciseId,
      expectedRevision: input.expectedRevision,
      exercise: next,
    });
    const match = (await this.listCustomExerciseVariants(input.userId, { includeArchived: true }))
      .find((item) => item.id === input.customExerciseId);
    if (!match) throw new Error(`Custom exercise not found after revision: ${input.customExerciseId}`);
    return match;
  }

  async setCustomExerciseArchived(input: {
    userId: string;
    customExerciseId: string;
    expectedRevision: number;
    archived: boolean;
    idempotencyKey: string;
  }): Promise<void> {
    await this.executeDomainCommand({
      type: "custom_exercise.set_archived",
      meta: {
        userId: input.userId,
        actor: { kind: "user", id: input.userId },
        deviceId: "local-device",
        occurredAt: this.runtime.now(),
        timezoneOffsetMinutes: new Date(this.runtime.now()).getTimezoneOffset() * -1,
        idempotencyKey: input.idempotencyKey,
      },
      aggregateRef: {
        kind: "custom_exercise",
        id: input.customExerciseId,
        revision: input.expectedRevision,
      },
      archived: input.archived,
      reason: input.archived ? "user_archived_custom_exercise" : "user_restored_custom_exercise",
    });
  }

  proposeCustomExerciseMetadata(input: {
    customExerciseId: string;
    proposed: import("../knowledge").CustomExerciseMetadataProposal["proposed"];
    source?: "llm" | "user";
  }): import("../knowledge").CustomExerciseMetadataProposal {
    return {
      kind: "custom_exercise_metadata_proposal",
      customExerciseId: input.customExerciseId,
      proposed: clone(input.proposed),
      authority: "non_authoritative_pending_user_confirmation",
      source: input.source ?? "llm",
      unlocksPlannerEligibility: false,
      unlocksMotionCapability: false,
    };
  }

  async listCustomExerciseVariants(
    userId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<readonly CustomExerciseVariantView[]> {
    const snapshot = await this.ledger.read();
    const projection = await this.readDomainProjection({ userId });
    const archived = new Set(
      projection.archivedAggregates
        .filter((ref) => ref.kind === "custom_exercise")
        .map((ref) => ref.id),
    );
    return projection.customExercises.map((item) => {
      const created = snapshot.domainEvents.find(
        (event) => event.userId === userId && event.aggregate.id === item.value.id,
      );
      return {
        ...item.value,
        userId,
        createdAt: created?.recordedAt ?? "",
        revision: item.revision,
        status: archived.has(item.value.id) ? "archived" as const : "active" as const,
      };
    }).filter((item) => options.includeArchived || item.status === "active");
  }

  /**
   * UI-facing card action seam. The UI deliberately never receives or stores
   * an ActionToken: this facade resolves one scoped to the current local user,
   * then delegates to the one formal draft or adaptive-plan use case.
   */
  async invokeArtifactCardAction(input: {
    userId: string;
    artifactId: string;
    action: "apply" | "reject" | "undo" | "confirm" | "confirm_pause" | "complete_record_only" | "complete_maintain" | "complete_new_goal" | `select_goal_path:${GoalPathOption["id"]}`;
    idempotencyKey: string;
  }): Promise<DomainCommandResult | { status: "applied"; result: DomainCommandResult; artifact: EvidenceBriefArtifact; planRevision: number; nutritionStrategyRevision: number | undefined } | { status: "rejected"; artifact?: EvidenceBriefArtifact } | { status: "completed"; next: "goal_negotiation" | "maintenance_planning" | "record_first"; result: DomainCommandResult } | { status: "undone"; artifact: EvidenceBriefArtifact; result: DomainCommandResult; planRevision: number; nutritionStrategyRevision: number }> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate) => candidate.id === input.artifactId);
    if (!artifact) throw new Error("artifact_not_found");
    if (artifact.kind === "timeline_record_draft") {
      if (input.action === "confirm") {
        return this.confirmTimelineRecordDraft({
          userId: input.userId,
          artifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      if (input.action === "reject") {
        return this.rejectTimelineRecordDraft({
          userId: input.userId,
          artifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      throw new Error("artifact_action_not_supported");
    }
    if (artifact.kind === "nutrition_observation_draft") {
      if (input.action === "confirm") {
        return this.confirmNutritionObservationDraft({
          userId: input.userId,
          artifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      if (input.action === "reject") {
        return this.rejectNutritionObservationDraft({
          userId: input.userId,
          artifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      throw new Error("artifact_action_not_supported");
    }
    if (artifact.kind === "evidence_brief" && artifact.adaptivePlanProposal) {
      if (input.action === "apply" || input.action === "confirm") {
        return this.confirmAdaptivePlanCandidate({
          userId: input.userId,
          proposalId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      if (input.action === "reject") {
        return this.rejectAdaptivePlanCandidate({
          userId: input.userId,
          proposalId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      if (input.action === "undo") {
        return this.undoAdaptivePlanCandidate({
          userId: input.userId,
          appliedArtifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      throw new Error("artifact_action_not_supported");
    }
    if (artifact.kind === "evidence_brief" && artifact.planPauseProposal) {
      if (input.action === "confirm_pause") return this.pausePlan({ userId: input.userId, reason: "coach_paused", confirmedBy: "agent_with_user_confirmation", idempotencyKey: input.idempotencyKey });
      if (input.action === "reject") return { status: "rejected" as const };
      throw new Error("artifact_action_not_supported");
    }
    if (artifact.kind === "evidence_brief" && artifact.goalCompletionProposal) {
      const resolution = input.action === "complete_record_only" ? "confirm_and_record_only" as const : input.action === "complete_maintain" ? "confirm_and_maintain" as const : input.action === "complete_new_goal" ? "confirm_and_request_new_goal" as const : input.action === "reject" ? "reject" as const : undefined;
      if (!resolution) throw new Error("artifact_action_not_supported");
      return this.resolveGoalCompletion({ userId: input.userId, proposalId: artifact.id, resolution, idempotencyKey: input.idempotencyKey });
    }
    if (artifact.kind === "evidence_brief" && artifact.goalNegotiationProposal && input.action.startsWith("select_goal_path:")) {
      const selectedOptionId = input.action.slice("select_goal_path:".length) as GoalPathOption["id"];
      const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
      const confirmed = await this.confirmGoalNegotiation({ userId: input.userId, goal: artifact.goalNegotiationProposal.goal, selectedOptionId, planChangeAuthorization: domain.mandate?.value.planChangeAuthorization ?? "always_ask", authorization: { kind: "local_user_presence", verifiedAt: this.runtime.now(), nonce: input.idempotencyKey }, idempotencyKey: input.idempotencyKey });
      return confirmed.result;
    }
    throw new Error("artifact_action_not_supported");
  }

  /**
   * The only public Timeline write path. It accepts real/confirmed experiences
   * only, retains provenance and is safe to call while offline.
   */
  async recordTimelineFact(input: {
    userId: string;
    idempotencyKey: string;
    fact: import("./domain").TimelineFact;
    envelope: TimelineAppendInput["envelope"];
    timelineId?: string;
    actor?: import("./domain").DomainActor;
    deviceId?: string;
    /** Records explicitly confirmed by the user may be admitted for a delegated Coach. */
    confirmedByUser?: boolean;
    /** A clear current user statement may be recorded by their delegated Coach. */
    delegatedByUser?: boolean;
    /** Canonical packet ingestion is a deterministic, not conversational, source. */
    deterministicTool?: "canonical_motion_packet";
  }): Promise<DomainCommandResult> {
    if (!factHasNoCompletedClaim(input.fact)) throw new Error("timeline_fact_must_be_an_experience");
    const requestedActor = input.actor ?? { kind: "user" as const, id: input.userId };
    const userAuthorized = Boolean(input.confirmedByUser || input.delegatedByUser);
    const actor = requestedActor;
    const origin = input.envelope.provenance.origin;
    if (
      (actor.kind === "agent" || actor.kind === "rule_engine") &&
      !userAuthorized &&
      input.deterministicTool !== "canonical_motion_packet"
    ) {
      throw new Error("user_confirmation_required_for_agent_fact");
    }
    if (origin === "canonical_motion_packet" && input.deterministicTool !== "canonical_motion_packet") {
      throw new Error("canonical_packet_tool_required");
    }
    if (input.envelope.provenance.dataStatus === "missing" && hasMeasuredValue(input.fact)) {
      throw new Error("missing_status_cannot_carry_measured_value");
    }
    const now = this.runtime.now();
    const entry: TimelineFactEnvelope = {
      ...input.envelope,
      id: input.envelope.id ?? this.runtime.nextId("timeline-entry"),
      schemaVersion: 1,
      factType: input.fact.kind,
      recordedAt: now,
      actor,
      causalRefs: [
        ...input.envelope.causalRefs,
        ...(((actor.kind === "agent" || actor.kind === "rule_engine") && userAuthorized) ? [`${input.delegatedByUser ? "delegated_by" : "confirmed_by"}:${input.userId}`, `proposed_by:${requestedActor.kind}:${requestedActor.id}`] : []),
      ],
      time: { ...input.envelope.time },
    };
    const projection = await this.readDomainProjection({ userId: input.userId });
    const exactDuplicate = projection.timeline.current.find(
      (event) =>
        event.envelope &&
        timelineSourceIdentity(event.envelope) === timelineSourceIdentity(entry) &&
        stableHash(event.fact) === stableHash(input.fact) &&
        !isLaterSourceRevision(entry, event.envelope),
    );
    if (exactDuplicate) {
      return {
        status: "idempotent",
        eventIds: [exactDuplicate.eventId],
        aggregateRevisions: [{ kind: "timeline", id: input.timelineId ?? `timeline.${input.userId}`, revision: projection.timeline.revision }],
      };
    }
    const sourceRecordMatch = entry.provenance.sourceRecordId
      ? projection.timeline.current.find((event) => sameExternalSource(event.envelope, entry))
      : undefined;
    const commandMeta = {
      userId: input.userId,
      actor,
      deviceId: input.deviceId ?? entry.provenance.deviceId ?? "local-device",
      occurredAt: entry.time.startedAt,
      timezoneOffsetMinutes: entry.time.timezoneOffsetMinutes,
      idempotencyKey: input.idempotencyKey,
    } satisfies import("./domain").CommandMeta;
    if (sourceRecordMatch && isLaterSourceRevision(entry, sourceRecordMatch.envelope)) {
      return this.executeDomainCommand({
        type: "timeline.source_mutate",
        meta: commandMeta,
        timelineId: input.timelineId ?? `timeline.${input.userId}`,
        expectedRevision: projection.timeline.revision,
        sourceEventId: sourceRecordMatch.eventId,
        reason: "source_updated",
        fact: input.fact,
        entry,
      });
    }
    if (sourceRecordMatch) {
      return {
        status: "idempotent",
        eventIds: [sourceRecordMatch.eventId],
        aggregateRevisions: [{ kind: "timeline", id: input.timelineId ?? `timeline.${input.userId}`, revision: projection.timeline.revision }],
      };
    }
    return this.executeDomainCommand({
      type: "timeline.append",
      meta: commandMeta,
      timelineId: input.timelineId ?? `timeline.${input.userId}`,
      expectedRevision: projection.timeline.revision,
      fact: input.fact,
      entry,
    });
  }

  /** Committed Timeline facts are corrected append-only; direct edit is unavailable. */
  async correctTimelineFact(input: {
    userId: string;
    idempotencyKey: string;
    correction: TimelineCorrection;
    fact: import("./domain").TimelineFact;
    envelope: TimelineAppendInput["envelope"];
    timelineId?: string;
    deviceId?: string;
  }): Promise<DomainCommandResult> {
    if (!input.correction.reason.trim()) throw new Error("correction_reason_required");
    const projection = await this.readDomainProjection({ userId: input.userId });
    const original = projection.timeline.events.find((event) => event.eventId === input.correction.correctsEventId);
    if (!original) throw new Error("timeline_fact_not_found");
    const now = this.runtime.now();
    const entry: TimelineFactEnvelope = {
      ...input.envelope,
      id: input.envelope.id ?? this.runtime.nextId("timeline-entry"),
      schemaVersion: 1,
      factType: input.fact.kind,
      recordedAt: now,
      actor: input.correction.actor,
      time: { ...input.envelope.time },
    };
    return this.executeDomainCommand({
      type: "timeline.correct",
      meta: {
        userId: input.userId,
        actor: input.correction.actor,
        deviceId: input.deviceId ?? entry.provenance.deviceId ?? "local-device",
        occurredAt: entry.time.startedAt,
        timezoneOffsetMinutes: entry.time.timezoneOffsetMinutes,
        idempotencyKey: input.idempotencyKey,
      },
      timelineId: input.timelineId ?? `timeline.${input.userId}`,
      expectedRevision: projection.timeline.revision,
      correctsEventId: original.eventId,
      reason: input.correction.reason,
      fact: input.fact,
      entry,
    });
  }

  /**
   * Background entry point: it reads the newest durable Timeline frontier and
   * never turns a missing record into a failed action. Native scheduling is
   * intentionally outside this method; a worker invokes it with a stable key.
   */
  async tombstoneTimelineSource(input: {
    userId: string;
    idempotencyKey: string;
    mutation: TimelineSourceMutation;
    timelineId?: string;
    deviceId?: string;
  }): Promise<DomainCommandResult> {
    if (input.mutation.reason === "source_updated") {
      throw new Error("source_updated_requires_replacement_fact");
    }
    const projection = await this.readDomainProjection({ userId: input.userId });
    const source = projection.timeline.events.find((event) => event.eventId === input.mutation.sourceEventId);
    if (!source) throw new Error("timeline_fact_not_found");
    return this.executeDomainCommand({
      type: "timeline.source_tombstone",
      meta: {
        userId: input.userId,
        actor: input.mutation.actor,
        deviceId: input.deviceId ?? "local-device",
        occurredAt: source.occurredAt,
        timezoneOffsetMinutes: source.timezoneOffsetMinutes,
        idempotencyKey: input.idempotencyKey,
      },
      timelineId: input.timelineId ?? `timeline.${input.userId}`,
      expectedRevision: projection.timeline.revision,
      sourceEventId: source.eventId,
      reason: input.mutation.reason,
    });
  }

  async readActivityLog(input: { userId: string; date: string; timezoneOffsetMinutes: number }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    return timelineActivityLog(input.date, input.timezoneOffsetMinutes, projection.timeline.events);
  }

  async queryTimeline(input: {
    userId: string;
    range: "day" | "week" | "month" | "custom";
    anchorDate: string;
    endDate?: string;
    includeHistory?: boolean;
  }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const { startDate, endDate } = timelineRangeDates(input.range, input.anchorDate, input.endDate);
    return timelineRange(projection.timeline.events, { startDate, endDate, includeHistory: input.includeHistory });
  }

  async readBodyTrends(input: {
    userId: string;
    preferences?: PrimarySourcePreferences;
    windowDays?: number;
  }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    return deriveBodyTrends({ events: projection.timeline.events, preferences: input.preferences, windowDays: input.windowDays });
  }

  async setPrimaryDataSources(input: {
    userId: string;
    preferences: PrimarySourcePreferences;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    assertLocalSettingsAuthorization(input.authorization);
    const projection = await this.readDomainProjection({ userId: input.userId });
    if (!projection.profile) throw new Error("profile_required_for_primary_data_sources");
    return this.executeDomainCommand({
      type: "profile.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      profileId: projection.profile.value.id,
      expectedRevision: projection.profile.revision,
      profile: { ...projection.profile.value, primaryDataSources: input.preferences },
    });
  }

  async readPrimarySourceFacts(input: {
    userId: string;
    metric: import("../timeline").TimelineMetric;
  }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    return selectPrimarySourceFacts({
      events: projection.timeline.events,
      metric: input.metric,
      selector: projection.profile?.value.primaryDataSources?.[input.metric],
    });
  }

  async exportTimeline(userId: string): Promise<TimelineExport> {
    const projection = await this.readDomainProjection({ userId });
    return {
      schemaVersion: 1,
      userId,
      exportedAt: this.runtime.now(),
      events: timelineRange(projection.timeline.events, { startDate: "0000-01-01", endDate: "9999-12-31", includeHistory: true }),
      tombstones: projection.timeline.tombstones,
    };
  }

  /**
   * Deterministic local import/replay. Original timeline event IDs, source
   * provenance and correction chains remain intact; repeated imports no-op.
   */
  async importTimeline(input: {
    userId: string;
    archive: TimelineExport;
    idempotencyKey: string;
    timelineId?: string;
    deviceId?: string;
  }): Promise<{ importedEventIds: readonly string[]; skippedEventIds: readonly string[] }> {
    if (input.archive.schemaVersion !== 1 || input.archive.userId !== input.userId) {
      throw new Error("invalid_timeline_import");
    }
    const timelineId = input.timelineId ?? `timeline.${input.userId}`;
    const all = [
      ...input.archive.events.map((event) => ({ kind: "fact" as const, revision: event.revision, event })),
      ...input.archive.tombstones.map((tombstone) => ({ kind: "tombstone" as const, revision: tombstone.revision, tombstone })),
    ].sort((left, right) => left.revision - right.revision || (
      left.kind === "fact" ? left.event.eventId : left.tombstone.eventId
    ).localeCompare(right.kind === "fact" ? right.event.eventId : right.tombstone.eventId));
    const importedEventIds: string[] = [];
    const skippedEventIds: string[] = [];
    let projection = await this.readDomainProjection({ userId: input.userId });
    for (const item of all) {
      const eventId = item.kind === "fact" ? item.event.eventId : item.tombstone.eventId;
      if (
        projection.timeline.events.some((event) => event.eventId === eventId) ||
        projection.timeline.tombstones.some((event) => event.eventId === eventId)
      ) {
        skippedEventIds.push(eventId);
        continue;
      }
      if (item.kind === "fact") {
        const source = item.event;
        const actor = source.envelope.actor;
        const meta = {
          userId: input.userId,
          actor,
          deviceId: input.deviceId ?? source.envelope.provenance.deviceId ?? "timeline-import",
          occurredAt: source.occurredAt,
          timezoneOffsetMinutes: source.timezoneOffsetMinutes,
          idempotencyKey: `${input.idempotencyKey}:${eventId}`,
          eventId,
        } satisfies import("./domain").CommandMeta;
        if (source.correctsEventId) {
          await this.executeDomainCommand({
            type: "timeline.correct",
            meta,
            timelineId,
            expectedRevision: projection.timeline.revision,
            correctsEventId: source.correctsEventId,
            reason: "imported_correction",
            fact: source.fact,
            entry: source.envelope,
          });
        } else if (source.sourceMutationOfEventId) {
          await this.executeDomainCommand({
            type: "timeline.source_mutate",
            meta,
            timelineId,
            expectedRevision: projection.timeline.revision,
            sourceEventId: source.sourceMutationOfEventId,
            reason: "source_updated",
            fact: source.fact,
            entry: source.envelope,
          });
        } else {
          await this.executeDomainCommand({
            type: "timeline.append",
            meta,
            timelineId,
            expectedRevision: projection.timeline.revision,
            fact: source.fact,
            entry: source.envelope,
          });
        }
      } else {
        const source = item.tombstone;
        await this.executeDomainCommand({
          type: "timeline.source_tombstone",
          meta: {
            userId: input.userId,
            actor: { kind: "sync", id: "timeline-import" },
            deviceId: input.deviceId ?? "timeline-import",
            occurredAt: source.occurredAt,
            timezoneOffsetMinutes: 0,
            idempotencyKey: `${input.idempotencyKey}:${eventId}`,
            eventId,
          },
          timelineId,
          expectedRevision: projection.timeline.revision,
          sourceEventId: source.sourceEventId,
          reason: source.reason,
        });
      }
      importedEventIds.push(eventId);
      projection = await this.readDomainProjection({ userId: input.userId });
    }
    return { importedEventIds, skippedEventIds };
  }

  async createTimelineSyncPayload(userId: string) {
    const projection = await this.readDomainProjection({ userId });
    return toTimelineSyncPayload({ userId, events: projection.timeline.events, tombstones: projection.timeline.tombstones });
  }

  /** Marks fact-derived presentation output stale; recomputation is explicit and idempotent. */
  async markTimelineDependentsStale(input: { userId: string; timelineEventId: string; idempotencyKey: string }) {
    const snapshot = await this.ledger.read();
    const dependentArtifactIds = new Set(
      snapshot.artifacts
        .filter((artifact) => artifact.evidenceRefs.some((ref) => ref.aggregate === "timeline" && (
          ref.id === input.timelineEventId || ref.id === `timeline.${input.userId}`
        )))
        .map((artifact) => artifact.id),
    );
    const stalePresentations = snapshot.presentations
      .filter((item) => dependentArtifactIds.has(item.artifactId) && item.status !== "stale")
      .map((item) => ({ ...item, status: "stale" as const }));
    if (!stalePresentations.length) return { status: "idempotent" as const, presentationIds: [] as readonly string[] };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "timeline_projector",
      intent: "timeline.dependents_mark_stale",
      expectedRevisions: [],
      domainEvents: [],
      presentations: stalePresentations,
      idempotencyKey: input.idempotencyKey,
      recordedAt: this.runtime.now(),
    });
    return { status: "committed" as const, presentationIds: stalePresentations.map((item) => item.id) };
  }

  async listActionLog(
    userId: string,
    options: { changesOnly?: boolean } = {},
  ): Promise<readonly import("./model").ActionEvent[]> {
    const snapshot = await this.ledger.read();
    const events = snapshot.actionEvents.filter((event) => event.userId === userId);
    return options.changesOnly
      ? events.filter((event) =>
          [
            "plan.change.applied",
            "plan.change.undone",
            "profile.corrected",
            "timeline.corrected",
            "workout.corrected",
            "timeline.source_changed",
            "permission.changed",
            "mandate.changed",
            "data.lifecycle.changed",
          ].includes(event.action),
        )
      : events;
  }

  async listToolAudit(userId: string) {
    const snapshot = await this.ledger.read();
    const pseudonym = `local-${stableHash({ userId })}`;
    return snapshot.toolAudit.filter((item) => item.userPseudonym === pseudonym);
  }

  suspendForHumanInput(input: Parameters<HumanActionCoordinator["suspend"]>[0]) {
    return this.humanActions.suspend(input);
  }

  listPendingHumanActions(userId: string) {
    return this.humanActions.listPending(userId);
  }

  upsertMemory(input: UpsertMemoryInput) {
    return this.memory.upsert(input);
  }

  listMemory(userId: string) {
    return this.memory.list(userId);
  }

  forgetMemory(input: Parameters<MemoryCurator["forget"]>[0]) {
    return this.memory.forget(input);
  }

  setMemoryPinned(input: Parameters<MemoryCurator["setPinned"]>[0]) {
    return this.memory.setPinned(input);
  }

  supersedeMemory(input: Parameters<MemoryCurator["supersede"]>[0]) {
    return this.memory.supersede(input);
  }

  compactMemory(input: Parameters<MemoryCurator["compact"]>[0]) {
    return this.memory.compact(input);
  }

  adapterCapabilities(): {
    health: boolean;
    notifications: boolean;
    secureCredentials: boolean;
  } {
    return {
      health: Boolean(this.health),
      notifications: Boolean(this.notifications),
      secureCredentials: Boolean(this.credentials),
    };
  }

  readHealthFacts(userId: string, since: string) {
    if (!this.health) throw new Error("HealthDataPort is not configured");
    return this.health.readFacts(userId, since);
  }

  /**
   * The only mobile-facing entry for a platform health connection probe. It
   * does not read health observations, mutate Timeline, or expose an SDK type.
   */
  async getHealthConnectionState(input: {
    metricTypes: readonly HealthMetric[];
  }): Promise<HealthConnectionState> {
    if (!input.metricTypes.length || new Set(input.metricTypes).size !== input.metricTypes.length) {
      throw new Error("invalid_health_metric_types");
    }
    if (!this.health?.getConnectionState) {
      return {
        availability: "not_supported",
        permissionByMetric: Object.fromEntries(input.metricTypes.map((metric) => [metric, "not_supported"])),
        capabilityByMetric: Object.fromEntries(input.metricTypes.map((metric) => [metric, "not_supported"])),
      };
    }
    return this.health.getConnectionState({ metricTypes: input.metricTypes });
  }

  /**
   * A user-initiated feature-specific request. The native permission result is
   * mirrored into the local permission aggregate in the same Facade, so the
   * product never treats an in-app toggle as OS authorization.
   */
  async requestHealthConnectionPermissions(input: {
    userId: string;
    metricTypes: readonly HealthMetric[];
    expectedPermissionRevision: number;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }): Promise<HealthConnectionState> {
    if (!input.metricTypes.length || new Set(input.metricTypes).size !== input.metricTypes.length) {
      throw new Error("invalid_health_metric_types");
    }
    if (!this.health?.requestPermissions) throw new Error("health_permission_request_unavailable");
    const state = await this.health.requestPermissions({ metricTypes: input.metricTypes });
    const localStatus = state.availability === "available" ? "granted" :
      state.availability === "permission_denied_or_revoked" ? "denied" : "not_configured";
    const projection = await this.readDomainProjection({ userId: input.userId });
    if (!projection.permissions) throw new Error(`PermissionSet not found: ${input.userId}`);
    await this.updatePermissionFromSettings({
      userId: input.userId,
      expectedRevision: input.expectedPermissionRevision,
      changes: { health: localStatus },
      authorization: input.authorization,
      idempotencyKey: input.idempotencyKey,
    });
    return state;
  }

  /**
   * Imports one normalized platform page as a single local transaction. The
   * Adapter supplies observations and an opaque next cursor; only this facade
   * turns confirmed platform evidence into Timeline facts and advances the
   * cursor. A failed fact commit therefore leaves the provider cursor intact.
   */
  async importHealthEvidence(input: {
    userId: string;
    platform: HealthImportState["platform"];
    metricTypes: readonly HealthMetric[];
    idempotencyKey: string;
    adapterSchemaVersion?: string;
  }): Promise<{
    status: "committed" | "idempotent";
    availability: import("./model").HealthAdapterAvailability;
    importedEventIds: readonly string[];
    skippedSourceIds: readonly string[];
    state: HealthImportState;
  }> {
    if (!this.health?.readEvidencePage) throw new Error("health_evidence_page_unavailable");
    if (!input.metricTypes.length || new Set(input.metricTypes).size !== input.metricTypes.length) {
      throw new Error("invalid_health_metric_types");
    }
    const snapshot = await this.ledger.read();
    const projection = await this.readDomainProjection({ userId: input.userId });
    const stateId = `health-import:${input.userId}:${input.platform}`;
    const existingState = snapshot.healthImportStates.find(
      (candidate) => candidate.id === stateId && candidate.userId === input.userId,
    );
    const actorId = `health-import:${input.platform}`;
    const duplicate = snapshot.domainIdempotency.find(
      (record) =>
        record.userId === input.userId &&
        record.actorId === actorId &&
        record.intent === "health.import_page" &&
        record.key === input.idempotencyKey,
    );
    if (duplicate) {
      if (!existingState) throw new Error("health_import_state_missing_after_idempotent_replay");
      return {
        status: "idempotent",
        availability: existingState.availability ?? "available",
        importedEventIds: duplicate.eventIds,
        skippedSourceIds: [],
        state: existingState,
      };
    }
    const page = await this.health.readEvidencePage({
      userId: input.userId,
      ...(existingState?.cursor ? { cursor: existingState.cursor } : {}),
      metricTypes: input.metricTypes,
    });
    const now = this.runtime.now();
    const actor = { kind: "sync" as const, id: actorId };
    // A connection failure/absence must never be mistaken for a clean, empty
    // health page. In particular, do not tombstone previously imported facts
    // or advance a provider cursor merely because the SDK is unavailable.
    const selected = page.availability === "available"
      ? newestHealthEvidence(page.evidence, input.metricTypes)
      : [];
    const classified = classifyHealthEvidence(
      selected,
      projection.timeline.events,
      input.platform,
      now,
      actor,
    );
    const mutations = classified.mutations;
    let timelineRevision = projection.timeline.revision;
    const domainEvents: DomainEvent[] = mutations.map((mutation) => {
      timelineRevision += 1;
      return healthTimelineDomainEvent({
        id: this.runtime.nextId("domain-event"),
        userId: input.userId,
        actor,
        deviceId: `health:${input.platform}`,
        recordedAt: now,
        revision: timelineRevision,
        timelineId: `timeline.${input.userId}`,
        mutation,
        causationId: `health-import:${stateId}:${input.idempotencyKey}`,
      });
    });
    const state: HealthImportState = {
      id: stateId,
      userId: input.userId,
      platform: input.platform,
      version: (existingState?.version ?? 0) + 1,
      adapterSchemaVersion: input.adapterSchemaVersion ?? "1",
      metricTypes: [...input.metricTypes],
      ...(page.nextCursor ?? existingState?.cursor ? { cursor: page.nextCursor ?? existingState?.cursor } : {}),
      permissionByMetric: { ...page.permissionByMetric },
      capabilityByMetric: { ...page.capabilityByMetric },
      availability: page.availability,
      ...(page.hasMore ? { hasMore: true } : {}),
      ...(page.initialSyncPending ? { initialSyncPending: true } : {}),
      consentRevision: projection.permissions?.revision ?? 0,
      lastAttemptAt: now,
      ...(page.availability === "available"
        ? { lastSuccessfulImportAt: now }
        : existingState?.lastSuccessfulImportAt ? { lastSuccessfulImportAt: existingState.lastSuccessfulImportAt } : {}),
      ...(page.availability === "available" ? {} : { lastErrorCode: page.availability }),
    };
    const actionEvents = healthImportActionEvents({
      userId: input.userId,
      events: domainEvents,
      runtime: this.runtime,
      now,
      mandateRevision: projection.mandate?.revision ?? 0,
      causationId: `health-import:${stateId}:${input.idempotencyKey}`,
      correlationId: stateId,
    });
    const result = await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: actor.id,
      intent: "health.import_page",
      expectedRevisions: domainEvents.length
        ? [{ kind: "timeline", id: `timeline.${input.userId}`, revision: projection.timeline.revision }]
        : [],
      expectedHealthImportStateVersions: [{ id: stateId, version: existingState?.version ?? 0 }],
      domainEvents,
      healthImportStates: [state],
      ...(actionEvents.length ? { actionEvents } : {}),
      outbox: domainEvents.map((event) => ({
        id: this.runtime.nextId("outbox"),
        userId: input.userId,
        replicaId: `device:health:${input.platform}`,
        deviceId: `health:${input.platform}`,
        domainEventId: event.id,
        payloadHash: stableHash(event),
        status: "pending" as const,
        createdAt: now,
      })),
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    if (result.status === "idempotent") throw new Error("unexpected_health_import_idempotency_state");
    return {
      status: "committed",
      availability: page.availability,
      importedEventIds: domainEvents.map((event) => event.id),
      skippedSourceIds: classified.skippedSourceIds,
      state,
    };
  }

  /**
   * Performs a small, resumable sequence of HealthDataPort pages. Foreground
   * launch and OS background work deliberately call this same use case: every
   * page is still an independent AtomicCommit, so interruption never advances
   * a provider cursor beyond the facts that reached the local Timeline.
   */
  async catchUpHealthEvidence(input: {
    userId: string;
    platform: HealthImportState["platform"];
    metricTypes: readonly HealthMetric[];
    idempotencyKeyPrefix: string;
    adapterSchemaVersion?: string;
    /** A product budget, not a provider history limit. Defaults to 12 pages. */
    maxPages?: number;
  }): Promise<{
    pages: readonly Awaited<ReturnType<LocalProductKernel["importHealthEvidence"]>>[];
    stoppedBecause: "caught_up" | "unavailable" | "page_budget";
  }> {
    const maxPages = Math.max(1, Math.min(50, Math.floor(input.maxPages ?? 12)));
    const pages: Awaited<ReturnType<LocalProductKernel["importHealthEvidence"]>>[] = [];
    for (let index = 0; index < maxPages; index += 1) {
      const result = await this.importHealthEvidence({
        userId: input.userId,
        platform: input.platform,
        metricTypes: input.metricTypes,
        idempotencyKey: `${input.idempotencyKeyPrefix}:${index}`,
        ...(input.adapterSchemaVersion ? { adapterSchemaVersion: input.adapterSchemaVersion } : {}),
      });
      pages.push(result);
      if (result.availability !== "available") return { pages, stoppedBecause: "unavailable" };
      if (!result.state.hasMore && !result.state.initialSyncPending) return { pages, stoppedBecause: "caught_up" };
    }
    return { pages, stoppedBecause: "page_budget" };
  }

  /**
   * Safe, local-only disclosure for the mobile account/privacy screen. It is
   * deliberately read-only: this neither signs in nor starts a sync, and it
   * excludes credentials, external account IDs, sync payloads and media refs.
   */
  async readPrivacySettingsOverview(input: { userId: string }): Promise<PrivacySettingsOverview> {
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    return buildPrivacySettingsOverview({
      userId: input.userId,
      authenticatedAccountId: this.authenticatedAccountId ?? "",
      ...(domain.permissions ? { permissions: domain.permissions } : {}),
      backupCryptoAvailability: this.clientSideBackup
        ? await this.clientSideBackup.getAvailability()
        : "unavailable",
    });
  }

  async exportPortableData(userId: string) {
    const bundle = await this.portableData.exportUser(userId);
    const projection = await this.readDomainProjection({ userId });
    const now = this.runtime.now();
    // Export is a local lifecycle action. Keep only an opaque integrity
    // summary in the ActionLog; payload, media, credentials and paths never
    // cross this audit boundary.
    await this.ledger.commit({
      kind: "domain",
      userId,
      actorId: "user",
      intent: "portable.export",
      expectedRevisions: [],
      domainEvents: [],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId,
        occurredAt: now,
        actor: "user",
        action: "data.lifecycle.changed",
        targetType: "profile",
        targetId: userId,
        scope: "portable_export",
        intent: "portable.export",
        before: {},
        after: {
          contentHash: bundle.manifest.contentHash,
          eventCount: bundle.manifest.counts.domainEvents,
          mediaAvailability: "excluded",
        },
        evidenceRefs: [],
        beforeRefs: [],
        afterRefs: [],
        ruleVersions: {},
        mandateRevision: projection.mandate?.revision ?? 0,
        result: "applied",
        undoBoundary: "not_reversible",
        policyDecision: "allow",
        causationId: bundle.manifest.contentHash,
        correlationId: `portable-export:${bundle.manifest.contentHash}`,
        reversible: false,
      }],
      idempotencyKey: `portable-export:${bundle.manifest.contentHash}`,
      recordedAt: now,
    });
    return bundle;
  }

  /**
   * Creates a client-side encrypted wrapper around the same redacted portable
   * bundle. The passphrase-derived key is held only by the injected crypto
   * adapter while this call runs and is never written to the Ledger.
   */
  async createClientSidePortableBackup(input: { userId: string; passphrase: string }): Promise<ClientSidePortableBackup> {
    if (!this.clientSideBackup) throw new Error("client_side_backup_crypto_unavailable");
    if (await this.clientSideBackup.getAvailability() !== "available") {
      throw new Error("client_side_backup_crypto_unavailable");
    }
    const archive = await this.clientSideBackup.create(input);
    const projection = await this.readDomainProjection({ userId: input.userId });
    const now = this.runtime.now();
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "user",
      intent: "portable.backup.create",
      expectedRevisions: [],
      domainEvents: [],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "user",
        action: "data.lifecycle.changed",
        targetType: "profile",
        targetId: input.userId,
        scope: "client_side_backup",
        intent: "portable.backup.create",
        before: {},
        after: {
          structuredContentHash: archive.manifest.structuredContentHash,
          encryption: archive.manifest.encryption,
          kdf: archive.manifest.kdf.algorithm,
          cipher: archive.manifest.cipher.algorithm,
          mediaAvailability: "excluded",
        },
        evidenceRefs: [],
        beforeRefs: [],
        afterRefs: [],
        ruleVersions: {},
        mandateRevision: projection.mandate?.revision ?? 0,
        result: "applied",
        undoBoundary: "not_reversible",
        policyDecision: "allow",
        causationId: archive.manifest.structuredContentHash,
        correlationId: `portable-backup:${archive.manifest.structuredContentHash}`,
        reversible: false,
      }],
      idempotencyKey: `portable-backup:${archive.manifest.structuredContentHash}`,
      recordedAt: now,
    });
    return archive;
  }

  async inspectClientSidePortableBackup(input: { archive: ClientSidePortableBackup; passphrase: string }) {
    if (!this.clientSideBackup) throw new Error("client_side_backup_crypto_unavailable");
    return this.portableData.dryRun(await this.clientSideBackup.open(input));
  }

  async planClientSidePortableRestore(input: {
    archive: ClientSidePortableBackup;
    passphrase: string;
    mode: import("../privacy").PortableRestoreRequest["mode"];
    targetUserId?: string;
  }) {
    if (!this.clientSideBackup) throw new Error("client_side_backup_crypto_unavailable");
    const bundle = await this.clientSideBackup.open(input);
    return this.portableData.planRestore({ bundle, mode: input.mode, targetUserId: input.targetUserId });
  }

  async restoreClientSidePortableBackup(input: {
    archive: ClientSidePortableBackup;
    passphrase: string;
    mode: import("../privacy").PortableRestoreRequest["mode"];
    targetUserId?: string;
  }) {
    if (!this.clientSideBackup) throw new Error("client_side_backup_crypto_unavailable");
    const bundle = await this.clientSideBackup.open(input);
    return this.portableData.restore({ bundle, mode: input.mode, targetUserId: input.targetUserId });
  }

  inspectPortableRestore(bundle: import("../privacy").PortableExportBundle) {
    return this.portableData.dryRun(bundle);
  }

  planPortableRestore(input: import("../privacy").PortableRestoreRequest) {
    return this.portableData.planRestore(input);
  }

  restorePortableData(input: import("../privacy").PortableRestoreRequest) {
    return this.portableData.restore(input);
  }

  /**
   * Store only a verified notification lifecycle marker. Notification text,
   * platform response tokens, and user-entered action data are intentionally
   * outside the Action Log and Ledger receipt.
   */
  async recordNotificationReceipt(input: {
    userId: string;
    notificationIntentId: string;
    event: "delivered" | "tap" | "dismissed";
    occurredAt?: string;
  }): Promise<{ status: "recorded" | "ignored" | "idempotent" }> {
    const snapshot = await this.ledger.read();
    const intent = snapshot.notificationIntents.find(
      (candidate) => candidate.id === input.notificationIntentId && candidate.userId === input.userId,
    );
    if (!intent) return { status: "ignored" };
    const receiptId = `receipt-${stableHash({ intent: intent.id, event: input.event })}`;
    if (snapshot.notificationReceipts.some((receipt) => receipt.id === receiptId)) {
      return { status: "idempotent" };
    }
    const occurredAt = input.occurredAt ?? this.runtime.now();
    const notificationJob = input.event === "delivered"
      ? snapshot.scheduledJobs.find((job) => job.id === intent.jobId && job.userId === input.userId)
      : undefined;
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "notification_port",
      intent: `notification.${input.event}`,
      expectedRevisions: [],
      domainEvents: [],
      notificationReceipts: [{
        id: receiptId,
        userId: input.userId,
        notificationIntentId: intent.id,
        event: input.event,
        occurredAt,
      }],
      ...(notificationJob
        ? { scheduledJobs: [{ ...notificationJob, status: "delivered" as const, updatedAt: occurredAt }] }
        : {}),
      idempotencyKey: `notification-receipt:${intent.id}:${input.event}`,
      recordedAt: this.runtime.now(),
    });
    return { status: "recorded" };
  }

  upsertFixedReminder(input: import("../scheduling").FixedReminderInput) {
    return this.recipes.upsertFixedReminder(input);
  }

  /** Register one of the closed local-only event recipes. */
  upsertEventRecipe(input: import("../scheduling").EventRecipeInput) {
    return this.recipes.upsertEventRecipe(input);
  }

  ensureDefaultEventRecipes(userId: string) {
    return this.recipes.ensureDefaultEventRecipes(userId);
  }

  updateEventRecipe(input: import("../scheduling").UpdateEventRecipeInput) {
    return this.recipes.updateEventRecipe(input);
  }

  /** Queue a validated local event for best-effort deterministic evaluation. */
  triggerRecipe(input: import("../scheduling").RecipeTriggerInput) {
    return this.recipes.triggerRecipe(input);
  }

  async catchUpRecipes(userId: string, now?: string) {
    await this.sweepExpiredCoachState(userId);
    return this.recipes.catchUp(userId, now);
  }

  /**
   * 过期/孤儿状态清扫（ticket 03）：把崩溃遗留的非终态 run 终态化、过期
   * pending action/token/到期 working memory 显式化。幂等；每次清扫落 action log。
   * 在 catchUp 周期（前台打开/后台任务）中调用。
   */
  /** 知识包加载状态（内置/数据包覆盖/回退原因），供 UI 与审计展示。 */
  readKnowledgePackStatus(): { source: "builtin" | "installed"; rejectionReason?: string } {
    return this.knowledgePackLoad
      ? { source: this.knowledgePackLoad.source, ...(this.knowledgePackLoad.rejectionReason ? { rejectionReason: this.knowledgePackLoad.rejectionReason } : {}) }
      : { source: "builtin" };
  }

  async sweepExpiredCoachState(userId: string): Promise<{ swept: number }> {
    const now = this.runtime.now();
    const snapshot = await this.ledger.read();
    const plan = planCoachStateSweep(snapshot, userId, now);
    const swept =
      plan.runs.length +
      plan.pendingHumanActions.length +
      plan.actionTokens.length +
      plan.workingMemoryItems.length;
    if (swept === 0) return { swept: 0 };
    await this.ledger.commit({
      kind: "domain",
      userId,
      actorId: "rule_engine",
      intent: "coach_state.sweep",
      expectedRevisions: [],
      expectedPendingHumanActionStatuses: plan.expectedPendingHumanActionStatuses,
      expectedWorkingMemoryVersions: plan.expectedWorkingMemoryVersions,
      domainEvents: [],
      runs: plan.runs,
      pendingHumanActions: plan.pendingHumanActions,
      updateActionTokens: plan.actionTokens,
      workingMemoryItems: plan.workingMemoryItems,
      actionEvents: plan.actionEvents,
      idempotencyKey: stableHash({
        intent: "coach_state.sweep",
        userId,
        runIds: plan.runs.map((run) => run.id),
        pendingActionIds: plan.pendingHumanActions.map((action) => action.id),
        tokenIds: plan.actionTokens.map((token) => token.token),
        memoryIds: plan.workingMemoryItems.map((item) => item.id),
      }),
      recordedAt: now,
    });
    return { swept };
  }

  cancelRecipe(userId: string, recipeId: string) {
    return this.recipes.cancelRecipe(userId, recipeId);
  }

  listScheduledJobs(userId: string) {
    return this.recipes.listJobs(userId);
  }

  listCoachRecipes(userId: string) {
    return this.recipes.listRecipes(userId);
  }

}

function nutritionStrategyRevisionDomainEvent(input: {
  id: string;
  userId: string;
  strategy: import("./domain").NutritionStrategyData;
  revision: number;
  occurredAt: string;
  recordedAt: string;
  causationId: string;
  correlationId: string;
}): DomainEvent {
  return {
    id: input.id,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    name: "nutrition_strategy.revised",
    userId: input.userId,
    aggregate: { kind: "nutrition_strategy", id: input.strategy.id, revision: input.revision },
    actor: { kind: "user", id: input.userId },
    deviceId: "local-device",
    occurredAt: input.occurredAt,
    recordedAt: input.recordedAt,
    timezoneOffsetMinutes: new Date(input.occurredAt).getTimezoneOffset() * -1,
    provenance: { source: "user", confidence: "confirmed" },
    evidenceRefs: [],
    causationId: input.causationId,
    correlationId: input.correlationId,
    payload: clone(input.strategy),
  };
}

function outboxForDomainEvent(event: DomainEvent): OutboxEntry {
  return {
    id: `outbox-${stableHash({ eventId: event.id, payloadHash: stableHash(event) })}`,
    userId: event.userId,
    replicaId: `device:${event.deviceId}`,
    deviceId: event.deviceId,
    domainEventId: event.id,
    payloadHash: stableHash(event),
    status: "pending",
    createdAt: event.recordedAt,
  };
}

export function createInMemoryLocalProductKernel(runtime: RuntimeServices): LocalProductKernel {
  return new LocalProductKernel(new InMemoryCoachLedger(), runtime);
}

/** Only same-variant, user-confirmed load×reps totals form a performance series. */
function comparablePerformanceRecoveryEvidence(workouts: readonly import("./domain").WorkoutProjection[]): {
  declines: number;
  factRefs: readonly string[];
} {
  const series = new Map<string, { completedAt: string; score: number; ref: string }[]>();
  for (const workout of workouts) {
    if (!workout.outcome || !["completed", "partial"].includes(workout.status)) continue;
    for (const outcome of workout.setOutcomes) {
      if (outcome.source !== "user_confirmed" || !outcome.actualLoad || outcome.actualReps === undefined) continue;
      const key = `${outcome.exerciseVariantId}:${outcome.actualLoad.unit}`;
      const values = series.get(key) ?? [];
      values.push({
        completedAt: workout.outcome.completedAt,
        score: outcome.actualLoad.value * outcome.actualReps,
        ref: `workout_session:${workout.id}`,
      });
      series.set(key, values);
    }
  }
  let declines = 0;
  const refs = new Set<string>();
  for (const values of series.values()) {
    const bySession = new Map<string, { score: number; ref: string }>();
    for (const value of values) {
      const current = bySession.get(value.completedAt);
      bySession.set(value.completedAt, { score: (current?.score ?? 0) + value.score, ref: value.ref });
    }
    const ordered = [...bySession.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]![1];
      const current = ordered[index]![1];
      if (previous.score > 0 && current.score < previous.score * 0.9) {
        declines += 1;
        refs.add(previous.ref);
        refs.add(current.ref);
      }
    }
  }
  return { declines, factRefs: [...refs].sort() };
}

function missingRuntime(): never {
  throw new Error("RuntimeServices are required");
}

function assertLocalSettingsAuthorization(
  authorization: import("./domain").LocalSettingsAuthorization,
): void {
  if (
    authorization.kind !== "local_user_presence" ||
    !authorization.nonce ||
    !Number.isFinite(Date.parse(authorization.verifiedAt))
  ) {
    throw new Error("local_user_presence_required");
  }
}

function validateEquipmentProfile(profile: import("./domain").EquipmentProfileData): void {
  if (!profile.id || !profile.name.trim()) throw new Error("invalid_equipment_profile");
  const ids = profile.equipment?.map((item) => item.id) ?? profile.equipmentIds;
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error("invalid_equipment_profile");
  }
  for (const item of profile.equipment ?? []) {
    if (item.quantity !== undefined && (!Number.isInteger(item.quantity) || item.quantity < 1)) {
      throw new Error("invalid_equipment_profile");
    }
    if (item.discreteLoads && item.discreteLoads.some((load) => load.value < 0 || !Number.isFinite(load.value))) {
      throw new Error("invalid_equipment_profile");
    }
  }
}

function factRefAggregateForDomainKind(kind: DomainAggregateKind): FactRef["aggregate"] {
  switch (kind) {
    case "user_profile": return "profile";
    case "goal_contract": return "goal";
    case "coaching_mandate": return "mandate";
    case "plan": return "plan";
    case "workout_session": return "workout";
    case "timeline": return "timeline";
    case "equipment_profile":
    case "custom_exercise": return "equipment";
    case "recovery_constraint": return "recovery";
    case "nutrition_strategy": return "nutrition";
    case "permission_set": return "permission";
    case "safety_constraint": return "safety";
  }
}

function settingsCommandMeta(
  userId: string,
  idempotencyKey: string,
  occurredAt: string,
): import("./domain").CommandMeta {
  return {
    userId,
    actor: { kind: "user", id: userId },
    deviceId: "local-device",
    occurredAt,
    timezoneOffsetMinutes: new Date(occurredAt).getTimezoneOffset() * -1,
    idempotencyKey,
  };
}

type HealthImportMutation =
  | {
      kind: "append";
      fact: import("./domain").TimelineFact;
      entry: TimelineFactEnvelope;
    }
  | {
      kind: "source_mutate";
      sourceEventId: string;
      fact: import("./domain").TimelineFact;
      entry: TimelineFactEnvelope;
    }
  | {
      kind: "source_tombstone";
      sourceEventId: string;
      occurredAt: string;
      timezoneOffsetMinutes: number;
    };

function newestHealthEvidence(
  evidence: readonly NormalizedHealthEvidence[],
  requestedMetrics: readonly HealthMetric[],
): readonly NormalizedHealthEvidence[] {
  const requested = new Set(requestedMetrics);
  const newestBySource = new Map<string, NormalizedHealthEvidence>();
  for (const item of evidence) {
    const sourceTime = item.change === "delete" ? item.observedAt ?? item.occurredAt : item.occurredAt;
    if (!requested.has(item.metric) || !item.id || !sourceTime || !Number.isFinite(Date.parse(sourceTime))) {
      continue;
    }
    const key = [item.origin, item.metric, item.sourceRecordId ?? item.id, item.deviceId ?? ""].join("|");
    const existing = newestBySource.get(key);
    if (!existing || healthEvidenceModifiedAt(item) >= healthEvidenceModifiedAt(existing)) {
      newestBySource.set(key, item);
    }
  }
  return [...newestBySource.values()].sort(
    (left, right) => healthEvidenceModifiedAt(left) - healthEvidenceModifiedAt(right) || left.id.localeCompare(right.id),
  );
}

function healthEvidenceModifiedAt(item: NormalizedHealthEvidence): number {
  const timestamp = Date.parse(item.lastModifiedAt ?? item.observedAt ?? item.occurredAt ?? "");
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function classifyHealthEvidence(
  evidence: readonly NormalizedHealthEvidence[],
  events: readonly import("./domain").TimelineProjectionEvent[],
  platform: HealthImportState["platform"],
  recordedAt: string,
  actor: import("./domain").DomainActor,
): { mutations: readonly HealthImportMutation[]; skippedSourceIds: readonly string[] } {
  const mutations: HealthImportMutation[] = [];
  const skippedSourceIds: string[] = [];
  for (const item of evidence) {
    const sourceId = item.sourceRecordId ?? item.id;
    const matching = events
      .filter((event) => event.envelope && sameHealthSource(event.envelope, item))
      .sort((left, right) => right.revision - left.revision)[0];
    if (item.change === "delete") {
      if (!matching || matching.lifecycle === "tombstoned") {
        skippedSourceIds.push(sourceId);
        continue;
      }
      mutations.push({
        kind: "source_tombstone",
        sourceEventId: matching.eventId,
        // Health Connect DeletionChange supplies an ID but no source event
        // timestamp. Preserve that distinction: the correction is recorded at
        // the adapter-observed time rather than inventing the deleted record's
        // occurrence time.
        occurredAt: item.observedAt ?? item.occurredAt ?? recordedAt,
        timezoneOffsetMinutes: item.timezoneOffsetMinutes,
      });
      continue;
    }
    // HealthKit intentionally does not reveal per-type read grants. A user
    // initiated request is represented as `unknown`; successfully returned
    // samples are still real platform evidence, while an empty query remains
    // coverage-unknown rather than a fabricated denial.
    if (item.permission !== "granted" && item.permission !== "unknown") {
      skippedSourceIds.push(sourceId);
      continue;
    }
    const fact = healthEvidenceFact(item);
    if (!fact) {
      skippedSourceIds.push(sourceId);
      continue;
    }
    const entry = healthEvidenceEnvelope({ item, sourceId, platform, recordedAt, actor });
    if (matching?.envelope && !isLaterSourceRevision(entry, matching.envelope)) {
      skippedSourceIds.push(sourceId);
      continue;
    }
    if (matching) {
      mutations.push({ kind: "source_mutate", sourceEventId: matching.eventId, fact, entry });
    } else {
      mutations.push({ kind: "append", fact, entry });
    }
  }
  return { mutations, skippedSourceIds: [...new Set(skippedSourceIds)] };
}

function sameHealthSource(entry: TimelineFactEnvelope, item: NormalizedHealthEvidence): boolean {
  const origin = item.origin;
  const sameStableRecord = entry.factType === healthMetricFactType(item.metric) &&
    entry.provenance.origin === origin &&
    entry.provenance.sourceRecordId === (item.sourceRecordId ?? item.id) &&
    entry.causalRefs.includes(`health_metric:${item.metric}`);
  if (!sameStableRecord) return false;
  // Health Connect/HealthKit deletion notifications intentionally disclose only
  // a record identifier. They cannot be rejected merely because device or
  // recording-method metadata is absent; the stored platform record ID plus
  // metric is the durable deletion identity. For upserts those fields remain
  // part of the identity, so two sources are never silently coalesced.
  if (item.change === "delete") return true;
  return entry.provenance.deviceId === item.deviceId &&
    entry.provenance.recordingMethod === item.recordingMethod;
}

function healthMetricFactType(metric: HealthMetric): import("./domain").TimelineFact["kind"] {
  if (metric === "sleep") return "sleep";
  if (metric === "activity") return "activity";
  if (metric === "body_weight" || metric === "body_fat_percentage") return "body";
  return "recovery";
}

function healthEvidenceFact(item: NormalizedHealthEvidence): import("./domain").TimelineFact | undefined {
  const confidence = item.freshness === "partial" ? "estimated" as const : "confirmed" as const;
  switch (item.metric) {
    case "sleep":
      return {
        kind: "sleep",
        ...(healthDuration(item) ? { duration: healthDuration(item) } : {}),
        confidence,
      };
    case "activity":
      return {
        kind: "activity",
        activityType: "external_activity",
        ...(healthDuration(item) ? { duration: healthDuration(item) } : {}),
        intensity: "unknown",
        confidence,
      };
    case "hrv_sdnn":
    case "hrv_rmssd":
      if (!finiteNonNegative(item.value) || (item.unit !== undefined && item.unit !== "milliseconds")) return undefined;
      return {
        kind: "recovery",
        hrv: item.value,
        hrvMetric: item.metric === "hrv_sdnn" ? "sdnn" : "rmssd",
        hrvUnit: "milliseconds",
        confidence,
      };
    case "resting_heart_rate":
      if (!finiteNonNegative(item.value) || (item.unit !== undefined && item.unit !== "beats_per_minute")) return undefined;
      return {
        kind: "recovery",
        restingHeartRate: item.value,
        restingHeartRateUnit: "beats_per_minute",
        confidence,
      };
    case "body_weight":
      if (!finiteNonNegative(item.value) || (item.unit !== "kg" && item.unit !== "lb")) return undefined;
      return {
        kind: "body",
        measurement: {
          metric: "body_weight",
          quantity: { value: item.value, unit: item.unit },
          ...(item.measurementMethod ? { condition: item.measurementMethod } : {}),
        },
        confidence,
      };
    case "body_fat_percentage":
      if (!finiteNonNegative(item.value) || item.value > 100 || item.unit !== "percent") return undefined;
      return {
        kind: "body",
        measurement: {
          metric: "body_fat_percentage",
          quantity: { value: item.value, unit: "percent" },
          ...(item.measurementMethod ? { method: item.measurementMethod } : {}),
          ...(item.algorithmVersion ? { algorithmVersion: item.algorithmVersion } : {}),
        },
        confidence,
      };
  }
}

function healthDuration(item: NormalizedHealthEvidence): import("./domain").DurationQuantity | undefined {
  if (!finiteNonNegative(item.value)) return undefined;
  if (item.unit === "hours" || item.unit === "minutes" || item.unit === "seconds") {
    return { value: item.value, unit: item.unit };
  }
  return undefined;
}

function finiteNonNegative(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function healthEvidenceEnvelope(input: {
  item: NormalizedHealthEvidence;
  sourceId: string;
  platform: HealthImportState["platform"];
  recordedAt: string;
  actor: import("./domain").DomainActor;
}): TimelineFactEnvelope {
  const item = input.item;
  if (!item.occurredAt) throw new Error("health_upsert_missing_occurred_at");
  return {
    id: `health:${input.platform}:${item.origin}:${item.metric}:${input.sourceId}:${item.lastModifiedAt ?? item.occurredAt}`,
    schemaVersion: 1,
    factType: healthMetricFactType(item.metric),
    time: {
      startedAt: item.occurredAt,
      ...(item.endedAt ? { endedAt: item.endedAt } : {}),
      timezoneOffsetMinutes: item.timezoneOffsetMinutes,
      ...(item.endedAt ? { endedTimezoneOffsetMinutes: item.timezoneOffsetMinutes } : {}),
    },
    recordedAt: input.recordedAt,
    actor: input.actor,
    provenance: {
      origin: item.origin,
      sourceRecordId: input.sourceId,
      ...(item.sourceRevision ? { sourceRevision: item.sourceRevision } : {}),
      ...(item.sourceAppId ? { sourceAppId: item.sourceAppId } : {}),
      ...(item.clientRecordId ? { clientRecordId: item.clientRecordId } : {}),
      ...(item.clientRecordVersion ? { clientRecordVersion: item.clientRecordVersion } : {}),
      ...(item.deviceId ? { deviceId: item.deviceId } : {}),
      ...(item.deviceManufacturer ? { deviceManufacturer: item.deviceManufacturer } : {}),
      ...(item.deviceModel ? { deviceModel: item.deviceModel } : {}),
      ...(item.deviceType ? { deviceType: item.deviceType } : {}),
      ...(item.sourceRecordingMethod ? { sourceRecordingMethod: item.sourceRecordingMethod } : {}),
      ...(item.measurementMethod ? { measurementMethod: item.measurementMethod } : {}),
      recordingMethod: item.recordingMethod,
      ...(item.algorithmVersion ? { algorithmVersion: item.algorithmVersion } : {}),
      ...(item.lastModifiedAt ? { lastModifiedAt: item.lastModifiedAt } : {}),
      dataStatus: item.freshness === "fresh" ? "available" : item.freshness,
      confidence: item.freshness === "partial" ? "estimated" : "confirmed",
    },
    privacyClass: "sensitive",
    causalRefs: [`health_platform:${input.platform}`, `health_metric:${item.metric}`],
    evidenceRefs: [],
    layer: "raw_observation",
  };
}

function healthTimelineDomainEvent(input: {
  id: string;
  userId: string;
  actor: import("./domain").DomainActor;
  deviceId: string;
  recordedAt: string;
  timelineId: string;
  revision: number;
  mutation: HealthImportMutation;
  causationId: string;
}): DomainEvent {
  const mutation = input.mutation;
  const common = {
    id: input.id,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    userId: input.userId,
    aggregate: { kind: "timeline" as const, id: input.timelineId, revision: input.revision },
    actor: input.actor,
    deviceId: input.deviceId,
    occurredAt: mutation.kind === "source_tombstone" ? mutation.occurredAt : mutation.entry.time.startedAt,
    recordedAt: input.recordedAt,
    timezoneOffsetMinutes: mutation.kind === "source_tombstone"
      ? mutation.timezoneOffsetMinutes
      : mutation.entry.time.timezoneOffsetMinutes,
    provenance: { source: "sync" as const, confidence: "confirmed" as const },
    evidenceRefs: [],
    causationId: input.causationId,
    correlationId: input.causationId,
  };
  if (mutation.kind === "append") {
    return { ...common, name: "timeline.fact_appended", payload: { fact: mutation.fact, entry: mutation.entry } };
  }
  if (mutation.kind === "source_mutate") {
    return {
      ...common,
      name: "timeline.source_mutated",
      payload: { fact: mutation.fact, sourceEventId: mutation.sourceEventId, reason: "source_updated", entry: mutation.entry },
    };
  }
  return {
    ...common,
    name: "timeline.source_tombstoned",
    payload: { sourceEventId: mutation.sourceEventId, reason: "source_deleted" },
  };
}

function healthImportActionEvents(input: {
  userId: string;
  events: readonly DomainEvent[];
  runtime: RuntimeServices;
  now: string;
  mandateRevision: number;
  causationId: string;
  correlationId: string;
}): import("./model").ActionEvent[] {
  return input.events.map((event) => ({
    id: input.runtime.nextId("action"),
    userId: input.userId,
    occurredAt: input.now,
    actor: "sync" as const,
    action: event.name === "timeline.fact_appended" ? "fact.written" : "timeline.source_changed",
    targetType: "timeline" as const,
    targetId: event.aggregate.id,
    scope: "health_import",
    intent: "health.import_page",
    ...(event.aggregate.revision > 1 ? { beforeRevision: event.aggregate.revision - 1 } : {}),
    afterRevision: event.aggregate.revision,
    before: { revision: Math.max(0, event.aggregate.revision - 1) },
    after: { revision: event.aggregate.revision, eventId: event.id },
    evidenceRefs: [{ aggregate: "timeline" as const, id: event.id, revision: event.aggregate.revision }],
    beforeRefs: event.aggregate.revision > 1
      ? [{ aggregate: "timeline" as const, id: event.aggregate.id, revision: event.aggregate.revision - 1 }]
      : [],
    afterRefs: [{ aggregate: "timeline" as const, id: event.aggregate.id, revision: event.aggregate.revision }],
    ruleVersions: {},
    mandateRevision: input.mandateRevision,
    result: "applied" as const,
    undoBoundary: "not_applicable" as const,
    policyDecision: "allow" as const,
    causationId: input.causationId,
    correlationId: input.correlationId,
    reversible: false,
  }));
}

function sameExternalSource(
  existing: TimelineFactEnvelope | undefined,
  incoming: TimelineFactEnvelope,
): boolean {
  if (!existing || !incoming.provenance.sourceRecordId) return false;
  return existing.factType === incoming.factType &&
    existing.provenance.origin === incoming.provenance.origin &&
    existing.provenance.sourceRecordId === incoming.provenance.sourceRecordId &&
    existing.provenance.deviceId === incoming.provenance.deviceId &&
    existing.provenance.recordingMethod === incoming.provenance.recordingMethod;
}

function assertTimelineCommandAuthority(command: DomainCommand): void {
  if (
    command.type !== "timeline.append" &&
    command.type !== "timeline.correct" &&
    command.type !== "timeline.source_mutate" &&
    command.type !== "timeline.source_tombstone"
  ) {
    return;
  }
  if (command.type !== "timeline.source_tombstone" && command.fact.kind === "nutrition") {
    const allowed = new Set(["manual_form", "current_user_statement", "manually_transcribed_label"]);
    if (command.fact.nutrients?.some((value) => !allowed.has(value.source.kind))) throw new Error("nutrition_value_source_not_supported");
  }
  if (command.meta.actor.kind !== "agent" && command.meta.actor.kind !== "rule_engine") return;
  const entry = command.type === "timeline.source_tombstone" ? undefined : command.entry;
  const canonical = entry?.provenance?.origin === "canonical_motion_packet" &&
    Array.isArray(entry.evidenceRefs) && entry.evidenceRefs.some((ref) => ref.kind === "canonical_packet");
  const explicitlyDelegated = Array.isArray(entry?.causalRefs) && entry.causalRefs.some((ref) => ref === `delegated_by:${command.meta.userId}` || ref === `confirmed_by:${command.meta.userId}`);
  if (!canonical && !explicitlyDelegated) throw new Error("agent_cannot_write_unconfirmed_timeline_fact");
}

function isLaterSourceRevision(
  incoming: TimelineFactEnvelope,
  existing: TimelineFactEnvelope | undefined,
): boolean {
  if (!existing) return false;
  const incomingRevision = incoming.provenance.sourceRevision;
  const existingRevision = existing.provenance.sourceRevision;
  if (incomingRevision !== undefined && existingRevision !== undefined && incomingRevision !== existingRevision) {
    return compareRevisionToken(incomingRevision, existingRevision) > 0;
  }
  const incomingAt = Date.parse(incoming.provenance.lastModifiedAt ?? incoming.recordedAt);
  const existingAt = Date.parse(existing.provenance.lastModifiedAt ?? existing.recordedAt);
  return Number.isFinite(incomingAt) && (!Number.isFinite(existingAt) || incomingAt > existingAt);
}

function compareRevisionToken(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function hasMeasuredValue(fact: import("./domain").TimelineFact): boolean {
  switch (fact.kind) {
    case "body":
      return true;
    case "nutrition":
      return Boolean(fact.nutrients?.length);
    case "activity":
      return fact.duration !== undefined || fact.energyExpenditure !== undefined;
    case "sleep":
      return fact.duration !== undefined;
    case "recovery":
      return fact.perceivedRecovery !== undefined || fact.fatigue !== undefined || fact.hrv !== undefined || fact.restingHeartRate !== undefined;
    case "symptom":
      return fact.severity !== undefined;
    default:
      return false;
  }
}

function planCandidateDecisionOutcomeArtifact(input: {
  userId: string;
  planId: string;
  planRevision: number;
  candidateId: string;
  decision: "accepted" | "rejected";
  observedAt: string;
  assessment?: GoalPathAssessment;
}): EvidenceBriefArtifact {
  const day = input.observedAt.slice(0, 10);
  const outcome: PlanOutcome = {
    id: `plan-outcome:${stableHash(input)}`,
    userId: input.userId,
    planId: input.planId,
    planRevision: input.planRevision,
    candidateId: input.candidateId,
    candidateDecision: input.decision,
    observedFrom: day,
    observedThrough: day,
    durationDays: 1,
    execution: { completed: 0, partial: 0, missed: 0, failureDenominator: 0 },
    burden: "unknown",
    bodyResponse: "unknown",
    preferenceSignals: [],
    ...(input.assessment ? { sourceAssessment: input.assessment } : {}),
    createdAt: input.observedAt,
  };
  return {
    id: outcome.id,
    kind: "evidence_brief",
    userId: input.userId,
    schemaVersion: 1,
    renderVersion: 1,
    createdAt: input.observedAt,
    contextRefs: [{ kind: "plan", ref: input.planId }],
    evidenceRefs: [{ aggregate: "plan", id: input.planId, revision: input.planRevision }],
    missingness: ["execution_observation_pending", "burden_feedback_pending", "body_response_pending"],
    capabilityBoundary: ["explicit_candidate_decision", "later_behavior_updates_outcome", "profile_preferences_not_silently_mutated"],
    hash: stableHash(outcome),
    title: input.decision === "accepted" ? "已接受阶段计划" : "已拒绝计划候选",
    summary: [input.decision, input.candidateId],
    planOutcome: outcome,
  };
}

/**
 * 定性恢复组合的短时预览约束。它有意不调用 `submitRecoveryCheckIn`：用户没有
 * 给出数值评分，系统不能把“睡不好”冒充为 2/5 或把“腿酸”冒充为严重疼痛。
 */
function qualitativeSleepAndLocalizedSorenessConstraint(input: {
  id: string;
  now: string;
  validUntil: string;
}): import("./domain").RecoveryConstraintData {
  return {
    id: input.id,
    level: "slight_reduction",
    validUntil: input.validUntil,
    scope: "next_session",
    intentions: [
      { kind: "increase_rir", magnitude: 1 },
      { kind: "remove_optional_sets" },
      { kind: "extend_rest" },
      { kind: "warmup_check" },
    ],
    evaluation: {
      rulePackId: "maxpower.qualitative-recovery-preview",
      ruleVersion: "1.0.0",
      evaluatedAt: input.now,
      triggeringFactRefs: [],
      corroboratingFactRefs: [],
      contradictingFactRefs: [],
      missingOrStale: ["numeric_recovery_rating_not_reported"],
      reasonCodes: ["poor_sleep_user_report", "localized_lower_soreness_user_report", "upper_body_readiness_user_report", "transient_preview_only"],
      confirmationRequired: true,
    },
  };
}

function timelineRangeDates(
  range: "day" | "week" | "month" | "custom",
  anchorDate: string,
  endDate?: string,
): { startDate: string; endDate: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) throw new Error("invalid_timeline_date");
  if (range === "day") return { startDate: anchorDate, endDate: anchorDate };
  if (range === "custom") {
    if (!endDate || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < anchorDate) {
      throw new Error("invalid_timeline_range");
    }
    return { startDate: anchorDate, endDate };
  }
  const date = new Date(`${anchorDate}T00:00:00.000Z`);
  if (range === "week") {
    const weekday = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() - weekday + 1);
    const startDate = date.toISOString().slice(0, 10);
    date.setUTCDate(date.getUTCDate() + 6);
    return { startDate, endDate: date.toISOString().slice(0, 10) };
  }
  const startDate = `${anchorDate.slice(0, 7)}-01`;
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return { startDate, endDate: date.toISOString().slice(0, 10) };
}

function defaultWorkoutSessionPolicy(): import("./domain").WorkoutSessionPolicy {
  return { id: "default-session-policy", version: "1", resumeWindowHours: 24 };
}

function nextUnperformedSet(workout: import("./domain").WorkoutProjection): {
  taskId: string;
  task: import("./domain").PlannedExerciseTask;
  set: import("./domain").PlannedExerciseSet;
} | undefined {
  const resolved = new Set(resolvedWorkoutSetIds(workout));
  for (const task of workout.frozenPrescription.tasks) {
    for (const set of task.sets) {
      if (!resolved.has(set.id)) return { taskId: task.id, task, set };
    }
  }
  return undefined;
}

function currentSet(workout: import("./domain").WorkoutProjection) {
  const current = workout.state.currentSetId;
  const resolved = new Set(resolvedWorkoutSetIds(workout));
  if (current && !resolved.has(current)) {
    for (const task of workout.frozenPrescription.tasks) {
      const set = task.sets.find((item) => item.id === current);
      if (set) return { taskId: task.id, task, set };
    }
  }
  return nextUnperformedSet(workout);
}

function resolvedWorkoutSetIds(workout: import("./domain").WorkoutProjection): readonly string[] {
  return [
    ...workout.setOutcomes.map((outcome) => outcome.prescriptionSetId),
    ...(workout.skippedSets ?? []).map((skipped) => skipped.prescriptionSetId),
  ];
}

function outcomeFromDraft(input: {
  id: string;
  target: NonNullable<ReturnType<typeof nextUnperformedSet>>;
  draft?: import("./domain").SetDraftData;
  confirmAsPlanned: boolean;
}): import("./domain").SetOutcomeData {
  const draft = input.draft;
  if (!draft && !input.confirmAsPlanned) throw new Error("user_must_confirm_actual_set");
  const prescription = input.target.set;
  const actualReps = draft?.actualReps ?? (input.confirmAsPlanned ? prescription.targetReps?.max : undefined);
  const actualDuration = draft?.actualDuration ?? (input.confirmAsPlanned ? prescription.targetDuration : undefined);
  const actualDistance = draft?.actualDistance ?? (input.confirmAsPlanned ? prescription.targetDistance : undefined);
  if (actualReps === undefined && actualDuration === undefined && actualDistance === undefined) {
    throw new Error("prescription_requires_actual_confirmation_value");
  }
  return {
    id: input.id,
    prescriptionSetId: prescription.id,
    exerciseVariantId: input.target.task.exerciseVariantId,
    ...(draft?.actualLoad ? { actualLoad: draft.actualLoad } : input.confirmAsPlanned && prescription.targetLoad ? { actualLoad: prescription.targetLoad } : {}),
    ...(actualReps !== undefined ? { actualReps } : {}),
    ...(actualDuration ? { actualDuration } : {}),
    ...(actualDistance ? { actualDistance } : {}),
    ...(draft?.assistance ? { assistance: draft.assistance } : {}),
    ...(draft?.actualRir !== undefined ? { actualRir: draft.actualRir } : {}),
    ...(draft?.noviceFeedback ? { noviceFeedback: draft.noviceFeedback } : {}),
    ...(draft?.noviceFeedbackMappingVersion ? { noviceFeedbackMappingVersion: draft.noviceFeedbackMappingVersion } : {}),
    ...(draft?.note ? { note: draft.note } : {}),
    completedAs: input.confirmAsPlanned && !draft ? "confirmed_as_planned" : "user_edited",
    source: "user_confirmed",
  };
}

function correctedSetOutcome(
  original: import("./domain").SetOutcomeData,
  patch: import("./domain").SetOutcomeCorrectionPatch,
): import("./domain").SetOutcomeData {
  const allowed = new Set([
    "actualLoad",
    "actualReps",
    "actualDuration",
    "actualDistance",
    "assistance",
    "actualRir",
    "noviceFeedback",
    "note",
  ]);
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key))) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.actualLoad !== undefined && patch.actualLoad !== null &&
    (!Number.isFinite(patch.actualLoad.value) || patch.actualLoad.value < 0)) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.actualReps !== undefined && patch.actualReps !== null &&
    (!Number.isInteger(patch.actualReps) || patch.actualReps < 0)) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.actualRir !== undefined && patch.actualRir !== null &&
    (!Number.isFinite(patch.actualRir) || patch.actualRir < 0 || patch.actualRir > 10)) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.actualDuration !== undefined && patch.actualDuration !== null &&
    (!Number.isFinite(patch.actualDuration.value) || patch.actualDuration.value < 0)) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.actualDistance !== undefined && patch.actualDistance !== null &&
    (!Number.isFinite(patch.actualDistance.value) || patch.actualDistance.value < 0)) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.assistance !== undefined && patch.assistance !== null && !patch.assistance.trim()) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  if (patch.note !== undefined && patch.note !== null && !patch.note.trim()) {
    throw new Error("invalid_set_outcome_correction_patch");
  }
  const replacement: import("./domain").SetOutcomeData = {
    ...original,
    ...(patch.actualLoad === undefined ? {} : patch.actualLoad === null ? { actualLoad: undefined } : { actualLoad: { ...patch.actualLoad } }),
    ...(patch.actualReps === undefined ? {} : patch.actualReps === null ? { actualReps: undefined } : { actualReps: patch.actualReps }),
    ...(patch.actualDuration === undefined ? {} : patch.actualDuration === null ? { actualDuration: undefined } : { actualDuration: { ...patch.actualDuration } }),
    ...(patch.actualDistance === undefined ? {} : patch.actualDistance === null ? { actualDistance: undefined } : { actualDistance: { ...patch.actualDistance } }),
    ...(patch.assistance === undefined ? {} : patch.assistance === null ? { assistance: undefined } : { assistance: patch.assistance.trim() }),
    ...(patch.actualRir === undefined ? {} : patch.actualRir === null ? { actualRir: undefined } : { actualRir: patch.actualRir }),
    ...(patch.noviceFeedback === undefined ? {} : patch.noviceFeedback === null
      ? { noviceFeedback: undefined, noviceFeedbackMappingVersion: undefined }
      : { noviceFeedback: patch.noviceFeedback, noviceFeedbackMappingVersion: undefined }),
    ...(patch.note === undefined ? {} : patch.note === null ? { note: undefined } : { note: patch.note.trim() }),
    // The original event continues to hold any camera evidence. A user edit
    // must not continue to present a composite result as camera-confirmed.
    source: "user_confirmed",
    completedAs: "user_edited",
  };
  if (replacement.actualReps === undefined && replacement.actualDuration === undefined && replacement.actualDistance === undefined) {
    throw new Error("prescription_requires_actual_confirmation_value");
  }
  return replacement;
}

function correctedSessionOutcome(
  original: import("./domain").SessionOutcomeData,
  patch: import("./domain").SessionOutcomeCorrectionPatch,
): import("./domain").SessionOutcomeData {
  const allowed = new Set(["status", "subjectiveFeedback"]);
  if (!Object.keys(patch).length || Object.keys(patch).some((key) => !allowed.has(key))) {
    throw new Error("invalid_workout_outcome_correction_patch");
  }
  return {
    ...original,
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.subjectiveFeedback === undefined
      ? {}
      : patch.subjectiveFeedback === null
        ? { subjectiveFeedback: undefined }
        : { subjectiveFeedback: patch.subjectiveFeedback }),
  };
}

function durationToMilliseconds(duration: import("./domain").DurationQuantity): number {
  if (!Number.isFinite(duration.value) || duration.value < 0) throw new Error("invalid_rest_duration");
  return duration.value * (duration.unit === "seconds" ? 1_000 : duration.unit === "minutes" ? 60_000 : 3_600_000);
}

function timezoneOffsetForInstant(iso: string): number {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.getTimezoneOffset() * -1 : 0;
}

function offsetDate(localDate: string, days: number): string {
  const value = Date.parse(`${localDate}T12:00:00.000Z`);
  if (!Number.isFinite(value)) throw new Error("invalid_local_date");
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Monday–Sunday ISO week containing the given local date. */
function weekBoundsFor(localDate: string): { startDate: string; endDate: string } {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  const weekday = value.getUTCDay() || 7;
  return { startDate: offsetDate(localDate, 1 - weekday), endDate: offsetDate(localDate, 7 - weekday) };
}

function datesBetween(startDate: string, endDate: string): readonly string[] {
  const dates: string[] = [];
  for (let cursor = new Date(`${startDate}T00:00:00.000Z`); cursor.toISOString().slice(0, 10) <= endDate; cursor = new Date(cursor.getTime() + 86_400_000)) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (dates.length > 366) throw new Error("health_trend_window_too_large");
  }
  return dates;
}

function localDateAtTimezoneOffset(iso: string, timezoneOffsetMinutes: number): string {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant) || !Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 14 * 60) {
    throw new Error("invalid_recipe_local_date_context");
  }
  return new Date(instant + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function localNoonToIso(localDate: string, timezoneOffsetMinutes: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !Number.isInteger(timezoneOffsetMinutes) || Math.abs(timezoneOffsetMinutes) > 14 * 60) {
    throw new Error("invalid_recipe_local_date_context");
  }
  const localNoonUtc = Date.parse(`${localDate}T12:00:00.000Z`);
  if (!Number.isFinite(localNoonUtc)) throw new Error("invalid_recipe_local_date_context");
  return new Date(localNoonUtc - timezoneOffsetMinutes * 60_000).toISOString();
}

/**
 * A conservative product policy: only formal partial/abandoned outcomes in
 * the same rolling 14-day window count as a repeated miss. A skipped plan or
 * a chat message is never treated as an unperformed training fact.
 */
function frontierFactRefs(
  frontier: readonly import("./domain").DomainAggregateRef[],
): import("./model").FactRef[] {
  return frontier.flatMap((ref) => {
    const aggregate = factAggregate(ref.kind);
    return aggregate ? [{ aggregate, id: ref.id, revision: ref.revision }] : [];
  });
}

function occurredOnDate(occurredAt: string, startDate: string, endDate: string): boolean {
  const date = occurredAt.slice(0, 10);
  return date >= startDate && date <= endDate;
}

/** Calendar date only: input has already been assigned to the user's local Timeline day. */
function localCalendarWeek(date: string): { start: string; end: string } | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const value = new Date(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(value.getTime())) return undefined;
  const dayOffset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - dayOffset);
  const start = value.toISOString().slice(0, 10);
  value.setUTCDate(value.getUTCDate() + 6);
  return { start, end: value.toISOString().slice(0, 10) };
}

function profilePlanningAvailabilityChanged(
  before: import("./domain").UserProfileData | undefined,
  after: import("./domain").UserProfileData,
): boolean {
  return stableHash({ schedule: before?.schedule, locations: before?.locations }) !== stableHash({
    schedule: after.schedule,
    locations: after.locations,
  });
}

function knowledgeRuleVersions(
  pins: import("../knowledge").KnowledgeVersionPins | undefined,
): Record<string, string> {
  if (!pins) return {};
  return {
    knowledgePack: pins.knowledgePack.contentHash,
    exerciseCatalog: pins.exerciseCatalog.contentHash,
    ...Object.fromEntries(pins.rulePacks.map((pin) => [`rulePack:${pin.id}`, pin.contentHash])),
  };
}

/** Projects the exclusive Agent Knowledge candidate into the existing active-plan aggregate. */
function domainCommandActionEvents(
  command: DomainCommand,
  events: readonly DomainEvent[],
  before: DomainProjection,
  occurredAt: string,
  runtime: RuntimeServices,
  pins: import("../knowledge").KnowledgeVersionPins,
): import("./model").ActionEvent[] {
  const mandateRevision =
    command.type === "mandate.revise" ? command.expectedRevision : (before.mandate?.revision ?? 0);
  return events.map((event) => {
    const refs = domainEventFactRefs(event);
    const action: import("./model").ActionEvent["action"] =
      event.name === "user_profile.corrected"
        ? "profile.corrected"
        : event.name === "timeline.fact_corrected"
          ? "timeline.corrected"
          : event.name === "workout.set_corrected" || event.name === "workout.outcome_corrected"
            ? "workout.corrected"
            : event.name === "workout.set_skipped"
              ? "workout.set_skipped"
            : event.name === "timeline.source_mutated" || event.name === "timeline.source_tombstoned"
            ? "timeline.source_changed"
          : event.name.startsWith("permission_set.")
            ? "permission.changed"
            : event.name.startsWith("coaching_mandate.")
              ? "mandate.changed"
              : event.name === "aggregate.archived" || event.name === "aggregate.restored"
                ? "data.lifecycle.changed"
                : event.name === "plan.revised"
                  ? "plan.change.applied"
                  : "fact.written";
    const reversible =
      action === "profile.corrected" ||
      action === "timeline.corrected" ||
      action === "workout.corrected" ||
      action === "timeline.source_changed" ||
      action === "plan.change.applied" ||
      action === "data.lifecycle.changed" ||
      action === "permission.changed" ||
      action === "mandate.changed";
    return {
      id: runtime.nextId("action"),
      userId: command.meta.userId,
      occurredAt,
      actor:
        command.meta.actor.kind === "system"
          ? "rule_engine"
          : command.meta.actor.kind,
      action,
      targetType: actionTargetType(event.aggregate.kind),
      targetId: event.aggregate.id,
      scope: event.aggregate.kind,
      intent: command.type,
      ...(event.aggregate.revision > 1 ? { beforeRevision: event.aggregate.revision - 1 } : {}),
      afterRevision: event.aggregate.revision,
      before: { revision: Math.max(0, event.aggregate.revision - 1) },
      after: { revision: event.aggregate.revision, eventId: event.id },
      evidenceRefs: refs.after,
      beforeRefs: refs.before,
      afterRefs: refs.after,
      ruleVersions: knowledgeRuleVersions(pins),
      mandateRevision,
      result: "applied",
      undoBoundary: reversible ? "compensating_revision" : "not_applicable",
      policyDecision: "allow",
      ...(command.meta.actor.kind === "user" ? { humanDecision: "confirmed" as const } : {}),
      causationId: event.causationId,
      correlationId: event.correlationId,
      reversible,
    };
  });
}

function domainEventFactRefs(event: DomainEvent): {
  before: import("./model").FactRef[];
  after: import("./model").FactRef[];
} {
  const aggregate = factAggregate(event.aggregate.kind);
  if (!aggregate) return { before: [], after: [] };
  return {
    before:
      event.aggregate.revision > 1
        ? [{ aggregate, id: event.aggregate.id, revision: event.aggregate.revision - 1 }]
        : [],
    after: [{ aggregate, id: event.aggregate.id, revision: event.aggregate.revision }],
  };
}

/**
 * Coach cards derive a narrow read view from authoritative domain events.
 */
function localizedExerciseDisplayName(label: string): string {
  const tokenLabels: Record<string, string> = {
    band: "弹力带",
    barbell: "杠铃",
    bodyweight: "徒手",
    cable: "绳索",
    cardio_machine: "有氧器械",
    dumbbell: "哑铃",
    kettlebell: "壶铃",
    machine: "固定器械",
    none: "无器械",
    conventional: "传统式",
    breathing: "呼吸练习",
    body_saw: "身体锯",
    brisk: "快走",
    ankle: "踝部",
    easy: "轻松",
    easy_walk: "轻松步行",
    elbow_at_side: "肘贴体侧",
    forward: "前跨式",
    full_body: "全身",
    gentle_stretch: "轻柔拉伸",
    half_kneeling: "半跪姿",
    hip: "髋部",
    in_place: "原地",
    interval: "间歇",
    knee: "膝撑",
    knee_raise: "提膝",
    kneeling: "跪姿",
    lateral: "侧向",
    lean_away: "侧倾式",
    long_lever: "长杠杆",
    lying: "卧姿",
    ninety_degree: "90 度",
    overhead: "过顶式",
    paused: "停顿式",
    pushdown: "下压式",
    recumbent: "卧式",
    rear_foot_elevated: "后脚抬高",
    reverse: "后撤式",
    rest: "休息",
    rope: "绳索式",
    romanian: "罗马尼亚式",
    seated: "坐姿",
    side_left: "左侧",
    side_right: "右侧",
    spin: "动感单车",
    steady: "稳态",
    standing: "站姿",
    step_jack: "开合踏步",
    shoulder: "肩部",
    thoracic: "胸椎",
    walking: "行走式",
    wrist: "腕部",
    upright: "直立式",
  };
  return label
    .split(" · ")
    .filter((token) => token !== "standard")
    .map((token) => tokenLabels[token] ?? token)
    .join(" · ");
}

function prescriptionUnitLabel(unit: string): string {
  return ({ seconds: "秒", minutes: "分钟", hours: "小时", reps: "次" } as Record<string, string>)[unit] ?? unit;
}

function parseSeedRepRange(value: string): { min: number; max: number } {
  const [minimum, maximum = minimum] = value.split("-").map(Number);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || maximum < minimum) {
    throw new Error("seed_repetition_range_invalid");
  }
  return { min: minimum, max: maximum };
}

function factAggregate(
  kind: import("./domain").DomainAggregateKind,
): import("./model").FactRef["aggregate"] | undefined {
  const mapping: Partial<
    Record<import("./domain").DomainAggregateKind, import("./model").FactRef["aggregate"]>
  > = {
    user_profile: "profile",
    goal_contract: "goal",
    coaching_mandate: "mandate",
    plan: "plan",
    workout_session: "workout",
    timeline: "timeline",
    equipment_profile: "equipment",
    recovery_constraint: "recovery",
    nutrition_strategy: "nutrition",
    custom_exercise: "exercise",
    permission_set: "permission",
    safety_constraint: "safety",
  };
  return mapping[kind];
}

function actionTargetType(
  kind: import("./domain").DomainAggregateKind,
): import("./model").ActionEvent["targetType"] {
  const mapping: Record<
    import("./domain").DomainAggregateKind,
    import("./model").ActionEvent["targetType"]
  > = {
    user_profile: "profile",
    goal_contract: "goal",
    coaching_mandate: "mandate",
    plan: "plan",
    workout_session: "workout",
    timeline: "timeline",
    equipment_profile: "equipment",
    recovery_constraint: "recovery",
    nutrition_strategy: "nutrition",
    custom_exercise: "exercise",
    permission_set: "permission",
    safety_constraint: "safety",
  };
  return mapping[kind];
}

/** 知识工具的动作肌群摘要行：只呈现策展关联，unknown 时明示不得猜测。 */
function muscleSummaryLine(variant: import("../knowledge").ExerciseVariant): string {
  const association = variant.expectedMuscleAssociation;
  if (association.status === "unknown" || !association.associations.length) {
    return "肌群关联：未收录（unknown），不得猜测";
  }
  const primary = association.associations
    .filter((entry) => entry.role === "primary_intent")
    .map((entry) => entry.muscleId);
  const secondary = association.associations
    .filter((entry) => entry.role === "secondary_intent")
    .map((entry) => entry.muscleId);
  return `预计参与肌群（动作学策展，非当次激活观测）：主要 ${primary.join("、") || "未标注"}；次要 ${secondary.join("、") || "无"}`;
}

/** 数据桥（ticket 02）：从 workout 聚合组装 planner 的历史表现。 */


/**
 * 意愿推断规则表（版本化产品规则，非生理结论）：
 * 只从强信号推断默认值；用户显式选择永远优先；行为证据随后修正。
 */
function assertGoalContractOriginalPathProtected(
  previous: import("./domain").GoalContractData | undefined,
  next: import("./domain").GoalContractData,
): void {
  if (!previous?.targetMode) return;
  const consent = new Set(next.slowdownConsent?.allowedChanges ?? []);
  const deadlineChanged = previous.horizon.endDate !== next.horizon.endDate;
  const outcomeChanged =
    previous.primaryGoal !== next.primaryGoal ||
    previous.targetMode !== next.targetMode ||
    stableHash(previous.targets ?? {}) !== stableHash(next.targets ?? {});
  const burdenChanged =
    previous.executionTier !== next.executionTier ||
    previous.pace !== next.pace ||
    stableHash(previous.commitmentPreferences ?? {}) !== stableHash(next.commitmentPreferences ?? {});
  if (
    (deadlineChanged && !consent.has("deadline")) ||
    (outcomeChanged && !consent.has("target_outcome")) ||
    (burdenChanged && !consent.has("execution_burden"))
  ) {
    throw new Error("explicit_slowdown_consent_required");
  }
}

/** 本周已过去、计划了但未开始的训练日（顺延/缺席策略的输入）。 */

/** 文献引用的展示渲染（英文优先；PMID/PMC 一并给出以便核验）。 */
function renderCitation(
  citation: import("../knowledge/model").EvidenceCitation,
  locale: "en" | "zh",
): string {
  const title = locale === "zh" ? citation.titleZh : citation.titleEn;
  const cannot = locale === "zh" ? citation.cannotSupportZh : citation.cannotSupportEn;
  const identifier = citation.pmid ? `PMID: ${citation.pmid}` : citation.pmcid ?? "";
  const prefix = locale === "zh" ? "依据" : "Source";
  const caveat = locale === "zh" ? "不能推出" : "Does not support";
  return (
    `${prefix} [${citation.tier}] ${citation.authorsShort} (${citation.year})` +
    `${citation.venue ? `. ${citation.venue}` : ""}. ${title}` +
    `${identifier ? ` ${identifier}` : ""}${citation.url ? ` ${citation.url}` : ""}` +
    `（${caveat}：${cannot.join(locale === "zh" ? "；" : "; ")}）`
  );
}

/** PassageRefs may only support copy in the run whose local search produced them. */
function passageIdsForRun(snapshot: import("./model").LedgerSnapshot, runId: string): ReadonlySet<string> {
  const artifactIds = new Set(
    snapshot.runEvents
      .filter((event): event is Extract<import("./model").CoachRunEvent, { type: "artifact-ready" }> =>
        event.runId === runId && event.type === "artifact-ready",
      )
      .map((event) => event.artifactRef.id),
  );
  const passageIds = new Set<string>();
  for (const artifact of snapshot.artifacts) {
    if (!artifactIds.has(artifact.id) || artifact.kind !== "evidence_brief") continue;
    for (const ref of artifact.knowledgeSearch?.passageRefs ?? []) {
      // The passage itself is the traceable current-run evidence boundary.
      // Citation eligibility remains a knowledge-pack concern and is not
      // inferred by the language layer.
      passageIds.add(ref.passageId);
    }
  }
  return passageIds;
}

/**
 * V1 knowledge is for coaching principles, not a hidden food-composition
 * provider. A query that asks for a food's nutrients remains unknown until
 * the person supplies confirmed structured values.
 */
function isFoodCompositionLookup(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  const asksForComposition = /(?:营养成分|含多少|含量|多少(?:热量|卡路里|蛋白质|碳水|脂肪|纤维|钠|钾|钙|铁|镁)|每\s*100\s*(?:克|g)|calories?\s+(?:in|of)|nutrition\s+(?:facts|content)|(?:protein|carbs?|fat|fiber|sodium|potassium)\s+(?:in|of))/i.test(normalized);
  const identifiesFood = /(?:食物|食品|这顿|这餐|饭|菜|肉|鸡|鱼|蛋|奶|米|面|水果|蔬菜|配方|包装|标签|\d+\s*(?:克|g)\b|meal|food|recipe|chicken|rice|apple|banana|egg|milk)/i.test(normalized);
  return asksForComposition && identifiesFood;
}
