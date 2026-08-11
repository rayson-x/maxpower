import { ArtifactCardRegistry } from "./cards";
import {
  buildCoachProductProjection,
  type CalendarPresentationMode,
  type CoachProductProjection,
} from "../product";
import {
  ActionBroker,
  type ArtifactActionResult,
  type PlanChangeProposalResult,
  type ProposePlanChangeInput,
  type UndoActionResult,
} from "./actions";
import { decideTodayPlan } from "./kernel";
import { HumanActionCoordinator } from "./hitl";
import { MemoryCurator, type UpsertMemoryInput } from "./memory";
import {
  MotionCoordinator,
} from "./adapters/motion";
import { AgentRuntime } from "./agentRuntime";
import { planCoachStateSweep } from "./stateSweep";
import {
  type CoachLedger,
  type DomainAtomicCommit,
  InMemoryCoachLedger,
  upsertUser,
} from "./ledger";
import type {
  ArtifactCardModel,
  CoachSession,
  ContextRef,
  EvidenceBriefArtifact,
  HealthImportState,
  HealthMetric,
  PlanRevision,
  RuntimeServices,
  TimelineEvent,
  ToolExecutionIdentity,
  UserProfile,
  UserState,
} from "./model";
import {
  DOMAIN_EVENT_SCHEMA_VERSION,
  projectDomainEvents,
  type DomainCommand,
  type DomainCommandResult,
  type DataLifecycleStatus,
  type DomainEvent,
  type DomainProjection,
  type DomainProjectionQuery,
  type OutboxEntry,
} from "./domain";
import {
  disabledSyncPort,
  type CoachApplicationPorts,
  type HealthDataPort,
  type HealthConnectionState,
  type HealthEvidencePage,
  type NormalizedHealthEvidence,
  type MediaBlobStore,
  type NotificationPort,
  type SecureCredentialPort,
  type SyncPort,
} from "./ports";
import { ReplicaSynchronizer, buildReplicaSyncOverview } from "../sync";
import {
  buildPrivacySettingsOverview,
  ClientSidePortableBackupService,
  PortableDataService,
  type ClientSidePortableBackup,
  type PrivacySettingsOverview,
} from "../privacy";
import { clone, stableHash } from "./stable";
import { CoachToolRegistry } from "./toolRegistry";
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
import { OnboardingService } from "../onboarding/OnboardingService";
import type {
  OnboardingPatch,
  OnboardingSection,
} from "../onboarding/model";
import { evaluateOnboardingPolicy } from "../onboarding/policy";
import {
  GoalCyclePlanner,
  type PlannerDecision,
  type PlannerRequest,
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
  toNextSetRecommendation,
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
  deriveNextMealRecommendation,
  deriveNutritionDayPlan,
  projectNutritionDayLedger,
  deriveNutritionReviewEvidence,
  nutritionSafetyBlockReason,
  proposeNutritionPlanCoordination,
  proposeNutritionChange,
  type NutritionSafetyScreen,
  type NutritionObservationPort,
  type NutritionObservationProviderResolver,
  type NutritionObservationRequest,
  type NutritionStrategyRulePack,
  type NextMealRecommendation,
} from "../nutrition";
import {
  evaluateReplan,
  deriveMetricRegistry,
  derivePhaseTransitionProposal,
  weeklyCoachReport,
  type ReplanTrigger,
} from "../replanning";
import { LocalRecipeEngine } from "../scheduling";

const DEFAULT_KNOWLEDGE_REGISTRY = new KnowledgePackRegistry(createInstalledKnowledgePack());

export interface CoachApplicationDependencies extends CoachApplicationPorts {
  knowledgeRegistry?: KnowledgePackRegistry;
  /** 本地安装的知识包来源（ticket 02）；配置后按 内置兜底 + 数据包覆盖 加载。 */
  knowledgePackSource?: KnowledgePackSourcePort;
  /** 知识检索工具开关（ticket 06）：默认禁用，由 eval 门槛（ticket 10）翻转。 */
  knowledgeToolsEnabled?: boolean;
  /** 个人知识层（ticket 05）：实测休息等校准值的沉淀处；缺省不启用。 */
  personalKnowledge?: import("../knowledge/personalLayer").PersonalKnowledgeLayer;
  trainingRuleRegistry?: TrainingRulePackRegistry;
  /** Set only by AuthRoot's account-scoped runtime composition. */
  authenticatedAccountId?: string;
}

export type StagedOnboardingApplication = Pick<
  CoachApplication,
  | "startOnboarding"
  | "saveOnboardingProgress"
  | "completeOnboarding"
  | "createNutritionStrategy"
  | "commitNutritionStrategy"
>;

export interface StagedOnboardingMutation<T> {
  value: T;
  domain: DomainProjection;
  /** Publishes the staged Ledger only if no concurrent local writer advanced it. */
  commit(): Promise<void>;
}

export interface StartSessionInput {
  userId: string;
  context: ContextRef;
  taskKind?: NonNullable<CoachSession["taskKind"]>;
  title?: string;
  /** Optional caller identity for a durable task-session creation. */
  idempotencyKey?: string;
}

export interface SeedUserStateInput {
  userId: string;
  profile: UserProfile;
  plan: PlanRevision;
  timeline?: readonly TimelineEvent[];
}

export interface ShowTodayPlanResult {
  artifact: ReturnType<typeof decideTodayPlan>;
  card: ArtifactCardModel;
  events: readonly import("./model").CoachRunEvent[];
}

export interface ShowArtifactResult {
  artifact: import("./model").Artifact;
  card: ArtifactCardModel;
  events: readonly import("./model").CoachRunEvent[];
}

export type NutritionStrategyProposalResult =
  | {
      status: "proposal";
      artifact: import("./model").NutritionChangeProposalArtifact;
      card: ArtifactCardModel;
    }
  | { status: "no_change"; reasonCodes: readonly string[] };

export interface NutritionStrategyProposalInspection {
  artifact: import("./model").NutritionChangeProposalArtifact;
  status: "awaiting_user" | "stale" | "applied" | "rejected" | "undone";
  card: ArtifactCardModel;
}

export interface NutritionStrategyActionResult {
  status: "applied" | "rejected" | "undone" | "idempotent";
  receipt: import("./model").ActionReceiptArtifact;
  card: ArtifactCardModel;
}

export class CoachApplication {
  private readonly cards = new ArtifactCardRegistry();
  private readonly actions: ActionBroker;
  private readonly humanActions: HumanActionCoordinator;
  private readonly memory: MemoryCurator;
  private readonly ledger: CoachLedger;
  private readonly runtime: RuntimeServices;
  private readonly agentRuntime: AgentRuntime;
  private readonly motion: MotionCoordinator;
  private readonly health?: HealthDataPort;
  private readonly notifications?: NotificationPort;
  private readonly sync: SyncPort;
  private readonly media?: MediaBlobStore;
  private readonly authenticatedAccountId?: string;
  private readonly credentials?: SecureCredentialPort;
  private readonly monotonicClock: NonNullable<CoachApplicationPorts["monotonicClock"]>;
  private readonly knowledge: KnowledgePackRegistry;
  private knowledgePackLoad: KnowledgePackLoadResult | null;
  private readonly personalKnowledge?: import("../knowledge/personalLayer").PersonalKnowledgeLayer;
  private readonly onboarding: OnboardingService;
  private readonly planner: GoalCyclePlanner;
  private readonly trainingRules: TrainingRulePackRegistry;
  private readonly recipes: LocalRecipeEngine;
  private readonly nutritionObservation?: NutritionObservationPort;
  private readonly nutritionObservationResolver?: NutritionObservationProviderResolver;
  private readonly replicaSynchronizer?: ReplicaSynchronizer;
  private readonly portableData: PortableDataService;
  private readonly clientSideBackup?: ClientSidePortableBackupService;
  private readonly dependencies: CoachApplicationDependencies;

  constructor(ledger: CoachLedger, runtime: RuntimeServices);
  constructor(dependencies: CoachApplicationDependencies);
  constructor(first: CoachLedger | CoachApplicationDependencies, second?: RuntimeServices) {
    const dependencies: CoachApplicationDependencies = "ledger" in first
      ? first
      : { ledger: first, runtime: second ?? missingRuntime() };
    this.dependencies = dependencies;
    this.ledger = dependencies.ledger;
    this.runtime = dependencies.runtime;
    this.health = dependencies.health;
    this.notifications = dependencies.notifications;
    this.sync = dependencies.sync ?? disabledSyncPort;
    this.media = dependencies.media;
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
    this.onboarding = new OnboardingService(this.ledger, this.runtime);
    this.trainingRules =
      dependencies.trainingRuleRegistry ?? new TrainingRulePackRegistry(this.knowledge.versionPins());
    this.planner = new GoalCyclePlanner(this.knowledge, this.trainingRules);
    const tokenPrimitive = dependencies.actionTokens ?? {
      issue: (claims: Parameters<NonNullable<CoachApplicationPorts["actionTokens"]>["issue"]>[0]) =>
        stableHash(claims),
    };
    this.actions = new ActionBroker(
      this.ledger,
      this.runtime,
      this.cards,
      () => this.knowledge.versionPins(),
      undefined,
      tokenPrimitive,
    );
    this.humanActions = new HumanActionCoordinator(
      this.ledger,
      this.runtime,
      tokenPrimitive,
      () => knowledgeRuleVersions(this.knowledge.versionPins()),
    );
    this.memory = new MemoryCurator(this.ledger, this.runtime);
    this.motion = new MotionCoordinator(
      this.ledger,
      this.runtime,
      this.cards,
      dependencies.motionRuntime,
    );
    this.recipes = new LocalRecipeEngine(
      this.ledger,
      this.runtime,
      this.notifications,
      dependencies.backgroundScheduler,
      () => knowledgeRuleVersions(this.knowledge.versionPins()),
    );
    this.nutritionObservation = dependencies.nutritionObservation;
    this.nutritionObservationResolver = dependencies.nutritionObservationResolver;
    this.replicaSynchronizer = dependencies.replicaTransport
      ? new ReplicaSynchronizer(this.ledger, this.runtime, dependencies.replicaTransport)
      : undefined;
    this.portableData = new PortableDataService(this.ledger, this.runtime);
    this.clientSideBackup = dependencies.backupCrypto
      ? new ClientSidePortableBackupService(this.portableData, dependencies.backupCrypto)
      : undefined;
    const tools = new CoachToolRegistry(
      {
        showToday: (input, execution) => this.showTodayPlan(input, execution),
        showCurrentPlan: (input, execution) => this.showCurrentPlanOverview(input, execution),
        showWeeklyReport: (input, execution) => this.showWeeklyCoachReport(input, execution),
        showMesocycleReview: (input, execution) => this.showLatestMesocycleReview(input, execution),
        showGoalForecast: (input, execution) => this.showGoalForecast(input, execution),
        showRecoveryBrief: (input, execution) => this.showRecoveryBrief(input, execution),
        evaluateRecoveryTimeline: (input, execution) => this.evaluateRecoveryTimelineForTool(input, execution),
        showSafetyHold: (input, execution) => this.showSafetyHold(input, execution),
        showNutritionStrategy: (input, execution) => this.showNutritionStrategy(input, execution),
        proposeNutritionChangeFromTimeline: (input, execution) => this.proposeNutritionStrategyChangeForTool(input, execution),
        proposeNutritionPlanCoordination: (input, execution) => this.proposeNutritionPlanCoordinationForTool(input, execution),
        proposePlanChange: (input, execution) =>
          this.actions.proposePlanChange(input, undefined, execution),
        lookupExerciseKnowledge: (input, execution) => this.lookupExerciseKnowledge(input, execution),
        explainKnowledgeRule: (input, execution) => this.explainKnowledgeRule(input, execution),
      },
      { knowledgeToolsEnabled: dependencies.knowledgeToolsEnabled ?? false },
    );
    this.agentRuntime = new AgentRuntime(
      this.ledger,
      this.runtime,
      dependencies.llmProvider,
      undefined,
      tools,
      this.humanActions,
      dependencies.providerExecutionPolicy,
      dependencies.llmProviderResolver,
      this.knowledge.safetyLexicon()?.forbiddenClaims ?? [],
    );
  }

  async previewGoalCycle(
    input: Omit<PlannerRequest, "facts"> & { userId: string },
  ): Promise<PlannerDecision> {
    const snapshot = await this.ledger.read();
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    if (!projection.profile || !projection.goalContract || !projection.mandate) {
      throw new Error("Planner requires confirmed Profile, GoalContract and CoachingMandate");
    }
    const priorGoalCycle = [...projection.goalCycles].sort(
      (left, right) => right.revision - left.revision,
    )[0];
    // 数据桥（ticket 02）：从 workout 聚合组装 planner 的历史表现（所有 replan 入口统一受益）
    const historicalPerformance = assembleHistoricalPerformance(projection.workouts);
    // 个人节奏校准（ticket 05）：实测休息中位数个性化休息建议与时长估算
    const tempoEntry = this.personalKnowledge
      ? (await this.personalKnowledge.list(input.userId)).find(
          (entry) => entry.key === "rest_tempo_seconds" && entry.status === "active",
        )
      : undefined;
    const personalRestTempoSeconds =
      typeof tempoEntry?.value?.medianRestSeconds === "number"
        ? (tempoEntry.value.medianRestSeconds as number)
        : undefined;
    return this.planner.plan({
      ...input,
      ...(personalRestTempoSeconds !== undefined ? { personalRestTempoSeconds } : {}),
      facts: {
        userId: input.userId,
        profile: projection.profile,
        goalContract: projection.goalContract,
        mandate: projection.mandate,
        safetyConstraints: projection.safetyConstraints,
        equipmentProfiles: projection.equipmentProfiles,
        recoveryConstraints: projection.recoveryConstraints,
        nutritionStrategies: projection.nutritionStrategies,
        timeline: projection.timeline.current,
        ...(priorGoalCycle ? { priorGoalCycle } : {}),
        ...(projection.plan ? { priorPlan: projection.plan } : {}),
      },
      ...(historicalPerformance.length ? { historicalPerformance } : {}),
    });
  }

  /** Persist an immutable, local planning preview without materializing any plan facts. */
  async createPlanningPreview(
    input: Omit<PlannerRequest, "facts"> & { userId: string; idempotencyKey: string; recomputeOf?: string; phaseTransition?: import("../replanning").PhaseTransitionProposal },
  ): Promise<EvidenceBriefArtifact> {
    const { phaseTransition, ...plannerInput } = input;
    const decision = await this.previewGoalCycle(plannerInput);
    const now = this.runtime.now();
    const artifactId = `planning-preview-${stableHash({
      userId: input.userId,
      request: {
        currentDate: input.currentDate,
        trigger: input.trigger,
        ...(input.requestedScope ? { requestedScope: input.requestedScope } : {}),
      },
      ...(input.recomputeOf ? { recomputeOf: input.recomputeOf } : {}),
      decision,
      ...(phaseTransition ? { phaseTransition } : {}),
    })}`;
    const existing = (await this.ledger.read()).artifacts.find(
      (artifact): artifact is import("./model").EvidenceBriefArtifact =>
        artifact.id === artifactId && artifact.kind === "evidence_brief" && artifact.userId === input.userId,
    );
    if (existing) return existing;
    const summary = decision.kind === "plan_proposal"
      ? [
          `strategy:${decision.strategySelection?.primary ?? "unknown"}`,
          `forecasts:${decision.adaptiveForecasts?.length ?? 0}`,
          "确认前不写入 GoalCycle、PlanRevision 或 Today",
        ]
      : decision.kind === "infeasible_plan"
        ? decision.reasonCodes
        : decision.reasonCodes;
    const traceArtifact: import("./model").PlanTraceArtifact | undefined =
      decision.kind === "plan_proposal"
        ? {
            id: `plan-trace-${decision.trace.inputFingerprint}`,
            kind: "plan_trace",
            userId: input.userId,
            schemaVersion: 1,
            renderVersion: 1,
            createdAt: now,
            contextRefs: [{ kind: "today", ref: input.currentDate }],
            evidenceRefs: decision.evidenceRefs,
            missingness: decision.missing,
            capabilityBoundary: ["规划推理链只读展示，不构成事实写入"],
            hash: stableHash({ trace: decision.trace }),
            knowledgePins: decision.knowledgePins,
            planId: decision.planRevision.id,
            trace: decision.trace,
          }
        : undefined;
    const artifact: EvidenceBriefArtifact = {
      id: artifactId,
      kind: "evidence_brief",
      userId: input.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [{ kind: "today", ref: input.currentDate }],
      evidenceRefs: decision.kind === "plan_proposal" || decision.kind === "infeasible_plan" ? decision.evidenceRefs : [],
      missingness: decision.kind === "plan_proposal" ? decision.missing : decision.kind === "infeasible_plan" ? decision.reasonCodes : [],
      capabilityBoundary: ["immutable_preview_only", "local_rule_engine_only", "unknown_facts_are_not_inferred"],
      hash: stableHash({ artifactId, decision, ...(phaseTransition ? { phaseTransition } : {}) }),
      ...(decision.kind === "plan_proposal" || decision.kind === "infeasible_plan" ? { knowledgePins: decision.knowledgePins } : {}),
      title: "长期计划预览",
      summary,
      ...(decision.kind === "plan_proposal"
        ? {
            planningPreview: {
              status: "awaiting_confirmation" as const,
              proposal: decision,
              request: {
                currentDate: input.currentDate,
                trigger: input.trigger,
                ...(input.requestedScope ? { requestedScope: input.requestedScope } : {}),
              },
              ...(input.recomputeOf ? { sourcePreviewId: input.recomputeOf } : {}),
            },
          }
        : {}),
      ...(phaseTransition ? { phaseTransition } : {}),
    };
    const refs = decision.kind === "plan_proposal" ? decision.baseRevisions : [];
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: input.recomputeOf ? "planning.preview.recompute" : "planning.preview",
      expectedRevisions: refs,
      domainEvents: [],
      artifacts: traceArtifact ? [artifact, traceArtifact] : [artifact],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "user",
        action: "proposal.created",
        targetType: "plan",
        targetId: artifact.id,
        scope: "planning_preview",
        intent: input.recomputeOf ? "planning.preview.recompute" : "planning.preview",
        before: {},
        after: { artifactId: artifact.id, status: artifact.planningPreview?.status ?? "infeasible" },
        evidenceRefs: artifact.evidenceRefs,
        beforeRefs: artifact.evidenceRefs,
        afterRefs: artifact.evidenceRefs,
        ruleVersions: knowledgeRuleVersions(artifact.knowledgePins),
        mandateRevision: refs.find((ref) => ref.kind === "coaching_mandate")?.revision ?? 0,
        result: "applied",
        undoBoundary: "not_reversible",
        policyDecision: "allow",
        causationId: artifact.id,
        correlationId: artifact.id,
        reversible: false,
      }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return artifact;
  }

  async recomputePlanningPreview(input: {
    userId: string;
    previewId: string;
    idempotencyKey: string;
  }): Promise<EvidenceBriefArtifact> {
    const snapshot = await this.ledger.read();
    const preview = snapshot.artifacts.find(
      (artifact): artifact is EvidenceBriefArtifact =>
        artifact.id === input.previewId && artifact.kind === "evidence_brief" && artifact.userId === input.userId,
    );
    if (!preview?.planningPreview) throw new Error("planning_preview_not_found");
    return this.createPlanningPreview({
      userId: input.userId,
      currentDate: preview.planningPreview.request.currentDate,
      trigger: preview.planningPreview.request.trigger,
      ...(preview.planningPreview.request.requestedScope ? { requestedScope: preview.planningPreview.request.requestedScope } : {}),
      idempotencyKey: input.idempotencyKey,
      recomputeOf: preview.id,
    });
  }

  async createPhaseTransitionPreview(input: {
    userId: string;
    currentDate: string;
    trigger: "goal_reached" | "plateau" | "recovery_decline" | "deadline_infeasible" | "user_requested";
    idempotencyKey: string;
  }): Promise<EvidenceBriefArtifact> {
    const metrics = await this.readMetricRegistry({ userId: input.userId, startDate: offsetDate(input.currentDate, -20), endDate: input.currentDate });
    const domain = await this.readDomainProjection({ userId: input.userId });
    const currentPhase = [...domain.goalCycles].sort((left, right) => right.revision - left.revision)[0]?.value.phasePath?.find((phase) => phase.startDate <= input.currentDate && input.currentDate <= phase.endDate);
    const decision = await this.previewGoalCycle({ userId: input.userId, currentDate: input.currentDate, trigger: "user_requested", requestedScope: "future_plan" });
    const proposal = derivePhaseTransitionProposal({
      id: `phase-transition:${stableHash({ userId: input.userId, currentDate: input.currentDate, trigger: input.trigger, metrics, decision })}`,
      metrics,
      ...(currentPhase ? { currentPhaseId: currentPhase.id } : {}),
      ...(domain.plan ? { currentPlanRevision: domain.plan.revision } : {}),
      candidate: decision,
      trigger: input.trigger,
      reviewAt: `${input.currentDate}T12:00:00.000Z`,
    });
    if (proposal.status !== "eligible") throw new Error("phase_transition_gate_blocked");
    return this.createPlanningPreview({
      userId: input.userId,
      currentDate: input.currentDate,
      trigger: "user_requested",
      requestedScope: "future_plan",
      idempotencyKey: input.idempotencyKey,
      phaseTransition: proposal,
    });
  }

  /** Re-reads the fact frontier before confirmation; stale previews never commit. */
  async confirmPlanningPreview(input: {
    userId: string;
    previewId: string;
    idempotencyKey: string;
    deviceId?: string;
    /** 确认前定制（ticket 04）：调整/删除动作任务，每处修改记录 provenance。 */
    edits?: readonly import("./model").PlanEditChange[];
  }): Promise<PlannerDecision> {
    const snapshot = await this.ledger.read();
    const preview = snapshot.artifacts.find(
      (artifact): artifact is import("./model").EvidenceBriefArtifact =>
        artifact.id === input.previewId && artifact.kind === "evidence_brief" && artifact.userId === input.userId,
    );
    if (!preview?.planningPreview) throw new Error("planning_preview_not_found");
    if (preview.planningPreview.status !== "awaiting_confirmation") throw new Error("planning_preview_not_confirmable");
    // ticket 04：无 trace 不提交
    if (preview.planningPreview.status === "awaiting_confirmation") {
      const expectedTraceId = `plan-trace-${preview.planningPreview.proposal.trace.inputFingerprint}`;
      if (!snapshot.artifacts.some((item) => item.id === expectedTraceId && item.kind === "plan_trace")) {
        throw new Error("plan_trace_missing");
      }
    }
    const current = await this.previewGoalCycle({
      userId: input.userId,
      currentDate: preview.planningPreview.request.currentDate,
      trigger: preview.planningPreview.request.trigger,
      ...(preview.planningPreview.request.requestedScope ? { requestedScope: preview.planningPreview.request.requestedScope } : {}),
    });
    if (stableHash(current) !== stableHash(preview.planningPreview.proposal)) {
      const stale: EvidenceBriefArtifact = {
        ...preview,
        id: `${preview.id}:stale:${stableHash(current)}`,
        createdAt: this.runtime.now(),
        hash: stableHash({ preview: preview.id, current }),
        summary: ["上游事实已变化，需要重新生成预览"],
        planningPreview: {
          status: "stale",
          proposal: preview.planningPreview.proposal,
          request: preview.planningPreview.request,
        },
      };
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: input.userId,
        intent: "planning.preview.stale",
        expectedRevisions: [],
        domainEvents: [],
        artifacts: [stale],
        actionEvents: [{
          id: this.runtime.nextId("action"),
          userId: input.userId,
          occurredAt: stale.createdAt,
          actor: "rule_engine",
          action: "assessment.created",
          targetType: "plan",
          targetId: stale.id,
          scope: "planning_preview",
          intent: "planning.preview.stale",
          before: { previewId: preview.id, status: "awaiting_confirmation" },
          after: { previewId: stale.id, status: "stale" },
          evidenceRefs: stale.evidenceRefs,
          beforeRefs: stale.evidenceRefs,
          afterRefs: stale.evidenceRefs,
          ruleVersions: knowledgeRuleVersions(stale.knowledgePins),
          mandateRevision: 0,
          result: "applied",
          undoBoundary: "not_reversible",
          policyDecision: "allow",
          causationId: stale.id,
          correlationId: stale.id,
          reversible: false,
        }],
        idempotencyKey: `${input.idempotencyKey}:stale`,
        recordedAt: stale.createdAt,
      });
      throw new Error("planning_preview_stale");
    }
    return this.materializeGoalCycle({
      userId: input.userId,
      currentDate: preview.planningPreview.request.currentDate,
      trigger: preview.planningPreview.request.trigger,
      ...(preview.planningPreview.request.requestedScope ? { requestedScope: preview.planningPreview.request.requestedScope } : {}),
      idempotencyKey: input.idempotencyKey,
      confirmedPreview: preview,
      ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      ...(input.edits?.length ? { customizations: input.edits } : {}),
    });
  }

  async rejectPlanningPreview(input: {
    userId: string;
    previewId: string;
    idempotencyKey: string;
  }): Promise<import("./model").EvidenceBriefArtifact> {
    const snapshot = await this.ledger.read();
    const preview = snapshot.artifacts.find(
      (artifact): artifact is import("./model").EvidenceBriefArtifact =>
        artifact.id === input.previewId && artifact.kind === "evidence_brief" && artifact.userId === input.userId,
    );
    if (!preview?.planningPreview) throw new Error("planning_preview_not_found");
    if (preview.planningPreview.status !== "awaiting_confirmation") throw new Error("planning_preview_not_rejectable");
    const rejected: EvidenceBriefArtifact = {
      ...preview,
      id: `${preview.id}:rejected`,
      createdAt: this.runtime.now(),
      hash: stableHash({ preview: preview.id, status: "rejected" }),
      summary: ["你保留了当前状态，尚未物化新计划"],
      planningPreview: { ...preview.planningPreview, status: "rejected" },
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "planning.preview.reject",
      expectedRevisions: [],
      domainEvents: [],
      artifacts: [rejected],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: rejected.createdAt,
        actor: "user",
        action: "plan.change.rejected",
        targetType: "plan",
        targetId: rejected.id,
        scope: "planning_preview",
        intent: "planning.preview.reject",
        before: { previewId: preview.id, status: "awaiting_confirmation" },
        after: { previewId: rejected.id, status: "rejected" },
        evidenceRefs: rejected.evidenceRefs,
        beforeRefs: rejected.evidenceRefs,
        afterRefs: rejected.evidenceRefs,
        ruleVersions: knowledgeRuleVersions(rejected.knowledgePins),
        mandateRevision: 0,
        result: "rejected",
        undoBoundary: "not_reversible",
        policyDecision: "allow",
        causationId: rejected.id,
        correlationId: rejected.id,
        reversible: false,
      }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: rejected.createdAt,
    });
    return rejected;
  }

  /**
   * Commits the deterministic initial/replanned cycle as one local fact
   * transaction. A mobile screen never serializes planner output into domain
   * events itself, and sync sees the cycle and its plan revision together.
   */
  async materializeGoalCycle(input: Omit<PlannerRequest, "facts"> & {
    userId: string;
    idempotencyKey: string;
    deviceId?: string;
    confirmedPreview?: EvidenceBriefArtifact;
    customizations?: readonly import("./model").PlanEditChange[];
  }): Promise<PlannerDecision> {
    const { confirmedPreview, ...plannerInput } = input;
    const rawDecision = await this.previewGoalCycle(plannerInput);
    if (rawDecision.kind !== "plan_proposal") return rawDecision;
    const recordedAtEarly = this.runtime.now();
    const decision = input.customizations?.length
      ? { ...rawDecision, planRevision: applyPlanEditChanges(rawDecision.planRevision, input.customizations, recordedAtEarly) }
      : rawDecision;
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const existingCycle = domain.goalCycles.find((cycle) => cycle.value.id === decision.goalCycle.id);
    const expectedPlanRevision = domain.plan?.revision ?? 0;
    const expectedCycleRevision = existingCycle?.revision ?? 0;
    const recordedAt = this.runtime.now();
    const deviceId = input.deviceId ?? "local-device";
    const actor = { kind: "rule_engine" as const, id: "goal-cycle-planner" };
    const correlationId = `planner:${input.userId}:${input.idempotencyKey}`;
    const events: DomainEvent[] = [
      {
        id: this.runtime.nextId("domain-event"),
        schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
        name: expectedCycleRevision === 0 ? "goal_cycle.created" : "goal_cycle.revised",
        aggregate: {
          kind: "goal_cycle",
          id: decision.goalCycle.id,
          revision: expectedCycleRevision + 1,
        },
        userId: input.userId,
        actor,
        deviceId,
        occurredAt: recordedAt,
        recordedAt,
        timezoneOffsetMinutes: new Date(recordedAt).getTimezoneOffset() * -1,
        provenance: { source: "rule_engine", confidence: "unknown" },
        evidenceRefs: [],
        causationId: correlationId,
        correlationId,
        payload: decision.goalCycle,
      },
      {
        id: this.runtime.nextId("domain-event"),
        schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
        name: "plan.revised",
        aggregate: {
          kind: "plan",
          id: decision.planRevision.id,
          revision: expectedPlanRevision + 1,
        },
        userId: input.userId,
        actor,
        deviceId,
        occurredAt: recordedAt,
        recordedAt,
        timezoneOffsetMinutes: new Date(recordedAt).getTimezoneOffset() * -1,
        provenance: { source: "rule_engine", confidence: "unknown" },
        evidenceRefs: [],
        causationId: correlationId,
        correlationId,
        payload: decision.planRevision,
      },
    ];
    const outbox: OutboxEntry[] = events.map((event) => ({
      id: this.runtime.nextId("outbox"),
      userId: input.userId,
      replicaId: `device:${deviceId}`,
      deviceId,
      domainEventId: event.id,
      payloadHash: stableHash(event),
      status: "pending",
      createdAt: recordedAt,
    }));
    const confirmedArtifact = confirmedPreview?.planningPreview
      ? {
          ...confirmedPreview,
          id: `${confirmedPreview.id}:confirmed`,
          createdAt: recordedAt,
          hash: stableHash({ preview: confirmedPreview.id, status: "confirmed", planRevision: decision.planRevision }),
          summary: ["已确认长期路线，并物化当前周与下一周计划"],
          planningPreview: {
            ...confirmedPreview.planningPreview,
            status: "confirmed" as const,
            sourcePreviewId: confirmedPreview.id,
          },
        }
      : undefined;
    const expectedRevisions = [
      ...decision.baseRevisions.filter((ref) => ref.kind !== "goal_cycle" && ref.kind !== "plan"),
      { kind: "goal_cycle" as const, id: decision.goalCycle.id, revision: expectedCycleRevision },
      { kind: "plan" as const, id: decision.planRevision.id, revision: expectedPlanRevision },
    ];
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: actor.id,
      intent: "goal_cycle.materialize",
      expectedRevisions,
      domainEvents: events,
      outbox,
      artifacts: confirmedArtifact ? [confirmedArtifact] : [],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: recordedAt,
        actor: "rule_engine",
        action: "assessment.created",
        targetType: "plan",
        targetId: decision.planRevision.id,
        scope: "goal_cycle",
        intent: "goal_cycle.materialize",
        beforeRevision: expectedPlanRevision || undefined,
        afterRevision: expectedPlanRevision + 1,
        before: { planRevision: expectedPlanRevision },
        after: { planRevision: expectedPlanRevision + 1, goalCycleId: decision.goalCycle.id },
        evidenceRefs: [],
        beforeRefs: domain.plan ? [{ aggregate: "plan", id: domain.plan.value.id, revision: domain.plan.revision }] : [],
        afterRefs: [
          { aggregate: "goal", id: decision.goalCycle.id, revision: expectedCycleRevision + 1 },
          { aggregate: "plan", id: decision.planRevision.id, revision: expectedPlanRevision + 1 },
        ],
        ruleVersions: knowledgeRuleVersions(this.knowledge.versionPins()),
        mandateRevision: domain.mandate?.revision ?? 0,
        result: "applied",
        undoBoundary: "compensating_revision",
        policyDecision: "allow",
        causationId: correlationId,
        correlationId,
        reversible: true,
      }, ...(confirmedArtifact ? [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: recordedAt,
        actor: "user" as const,
        action: "plan.change.applied" as const,
        targetType: "plan" as const,
        targetId: decision.planRevision.id,
        scope: "planning_preview",
        intent: "planning.preview.confirm",
        before: { previewId: confirmedPreview!.id, status: "awaiting_confirmation" },
        after: { artifactId: confirmedArtifact.id, status: "confirmed", planRevision: expectedPlanRevision + 1 },
        evidenceRefs: confirmedArtifact.evidenceRefs,
        beforeRefs: confirmedArtifact.evidenceRefs,
        afterRefs: confirmedArtifact.evidenceRefs,
        ruleVersions: knowledgeRuleVersions(confirmedArtifact.knowledgePins),
        mandateRevision: domain.mandate?.revision ?? 0,
        result: "applied" as const,
        undoBoundary: "compensating_revision" as const,
        policyDecision: "allow" as const,
        causationId: confirmedPreview!.id,
        correlationId,
        reversible: false,
      }] : [])],
      idempotencyKey: input.idempotencyKey,
      recordedAt,
    });
    // A first plan is part of onboarding, not an interruption. Later materialized
    // revisions are explicit, durable plan changes and may surface one local
    // "today" notification through the closed Recipe registry.
    if (expectedPlanRevision > 0) {
      await this.enqueueDefaultRecipe({
        userId: input.userId,
        kind: "today_plan_changed",
        occurredAt: recordedAt,
        causationId: `${decision.planRevision.id}:${expectedPlanRevision + 1}`,
        idempotencyKey: `recipe:today_plan_changed:${decision.planRevision.id}:${expectedPlanRevision + 1}`,
        timezoneOffsetMinutes: events[1]!.timezoneOffsetMinutes,
      });
      await this.proposeNutritionPlanCoordinationForCommittedPlanRevision({
        userId: input.userId,
        planId: decision.planRevision.id,
        planRevision: expectedPlanRevision + 1,
        occurredAt: recordedAt,
        timezoneOffsetMinutes: events[1]!.timezoneOffsetMinutes,
      });
    }
    return decision;
  }

  /** Registered local facts may trigger deterministic replanning; LLM text may not. */
  async evaluateLocalReplan(input: Omit<PlannerRequest, "facts" | "trigger"> & {
    userId: string;
    trigger: ReplanTrigger;
    window: { start: string; end: string };
  }) {
    const existing = await this.findPersistedReplanEvaluation(input.userId, input.trigger.idempotencyKey);
    if (existing) return existing.evaluation;
    const candidate = await this.previewGoalCycle({
      userId: input.userId,
      currentDate: input.currentDate,
      ...(input.schedule ? { schedule: input.schedule } : {}),
      ...(input.equipmentProfileId ? { equipmentProfileId: input.equipmentProfileId } : {}),
      ...(input.temporaryExerciseAvailability ? { temporaryExerciseAvailability: input.temporaryExerciseAvailability } : {}),
      ...(input.directChoices ? { directChoices: input.directChoices } : {}),
      ...(input.historicalPerformance ? { historicalPerformance: input.historicalPerformance } : {}),
      ...(input.consecutiveDeviationCount !== undefined ? { consecutiveDeviationCount: input.consecutiveDeviationCount } : {}),
      ...(input.missedSessionDates ? { missedSessionDates: input.missedSessionDates } : {}),
      ...(input.requestedScope ? { requestedScope: input.requestedScope } : {}),
      trigger: plannerTriggerForReplan(input.trigger.kind),
    });
    const projection = await this.readDomainProjection({ userId: input.userId });
    const frontier = await this.currentDomainFrontier(input.userId);
    const evaluatedAt = this.runtime.now();
    // Stability is derived only from immutable, local replan artifacts. It is
    // deliberately not working memory, chat wording or a notification record:
    // all callers replay the same history through the same RulePack policy.
    const priorEvaluations = await this.listPersistedReplanEvaluations(input.userId);
    const evaluation = evaluateReplan({
      id: `replan-${stableHash({ userId: input.userId, triggerId: input.trigger.id, frontier })}`,
      trigger: input.trigger,
      evaluatedAt,
      currentPlan: projection.plan?.value,
      candidate,
      frontier,
      window: input.window,
      ruleVersion: stableHash(this.knowledge.versionPins()),
      priorEvaluations,
    });
    const artifact: import("./model").ReplanEvaluationArtifact = {
      id: evaluation.id,
      kind: "replan_evaluation",
      userId: input.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: evaluatedAt,
      contextRefs: [{ kind: "today", ref: input.window.end }],
      evidenceRefs: frontierFactRefs(frontier),
      missingness: replanMissingness(evaluation),
      capabilityBoundary: ["仅使用本地事实与版本化规则", "预测描述方向与条件，不保证结果"],
      hash: stableHash(evaluation),
      knowledgePins: this.knowledge.versionPins(),
      evaluation,
    };
    const result = await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "replanner",
      intent: "replan.evaluate",
      expectedRevisions: frontier,
      domainEvents: [],
      artifacts: [artifact],
      idempotencyKey: input.trigger.idempotencyKey,
      recordedAt: evaluatedAt,
    });
    if (result.status === "idempotent") {
      const replay = await this.findPersistedReplanEvaluation(input.userId, input.trigger.idempotencyKey);
      if (replay) return replay.evaluation;
      throw new Error("replan_idempotency_artifact_missing");
    }
    return evaluation;
  }

  async readReplanEvaluation(userId: string, id: string): Promise<import("./model").ReplanEvaluationArtifact | undefined> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (candidate): candidate is import("./model").ReplanEvaluationArtifact =>
        candidate.id === id && candidate.kind === "replan_evaluation",
    );
    return artifact?.userId === userId ? artifact : undefined;
  }

  /** Read-only progress seam; it never creates a trigger or recomputes a path. */
  async readLatestReplanEvaluation(userId: string): Promise<import("./model").ReplanEvaluationArtifact | undefined> {
    const snapshot = await this.ledger.read();
    return snapshot.artifacts
      .filter(
        (artifact): artifact is import("./model").ReplanEvaluationArtifact =>
          artifact.kind === "replan_evaluation" && artifact.userId === userId,
      )
      .sort(
        (left, right) =>
          right.evaluation.trigger.occurredAt.localeCompare(left.evaluation.trigger.occurredAt) ||
          right.evaluation.evaluatedAt.localeCompare(left.evaluation.evaluatedAt) ||
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      )[0];
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
      contextRefs: [{ kind: "progress", ref: input.weekStart }],
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
  }): Promise<{ report: import("./model").WeeklyCoachReportArtifact; evaluation?: import("../replanning").ReplanEvaluation }> {
    const report = await this.createWeeklyCoachReport({
      userId: input.userId,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      idempotencyKey: input.idempotencyKey,
    });
    const projection = await this.readDomainProjection({ userId: input.userId });
    const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? timezoneOffsetForInstant(this.runtime.now());
    const occurredAt = localNoonToIso(input.weekEnd, timezoneOffsetMinutes);
    const evaluation = projection.profile && projection.goalContract && projection.mandate
      ? await this.evaluateLocalReplan({
          userId: input.userId,
          currentDate: input.weekEnd,
          trigger: {
            id: `weekly-review:${input.userId}:${input.weekStart}:${input.weekEnd}`,
            kind: "weekly_review_due",
            actor: "system",
            occurredAt,
            causationId: report.id,
            idempotencyKey: `replan:weekly_review:${input.idempotencyKey}`,
          },
          window: { start: input.weekStart, end: input.weekEnd },
        })
      : undefined;
    await this.enqueueDefaultRecipe({
      userId: input.userId,
      kind: "weekly_review",
      occurredAt,
      causationId: report.id,
      idempotencyKey: `recipe:weekly_review:${input.idempotencyKey}`,
      timezoneOffsetMinutes,
    });
    return { report, evaluation };
  }

  /**
   * Materializes one immutable, local period review. It intentionally stops at
   * an assessment: any actual plan change is a separate, mandate-governed
   * proposal rather than a side effect of opening a report.
   */
  async createMesocycleReview(input: {
    userId: string;
    mesocycleId: string;
    idempotencyKey: string;
  }): Promise<import("./model").MesocycleReviewArtifact> {
    const existing = await this.findPersistedMesocycleReview(input.userId, input.idempotencyKey);
    if (existing) return existing;
    const snapshot = await this.ledger.read();
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const cycle = [...projection.goalCycles]
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0];
    const mesocycle = cycle?.value.phasePath?.find((candidate) => candidate.id === input.mesocycleId);
    if (!cycle || !mesocycle) throw new Error("mesocycle_not_found");

    const frontier = await this.currentDomainFrontier(input.userId);
    const plannedSetCount = (projection.plan?.value.sessions ?? [])
      .filter((session) => session.scheduledFor >= mesocycle.startDate && session.scheduledFor <= mesocycle.endDate)
      .reduce((count, session) => count + session.tasks.reduce((total, task) => total + task.sets.length, 0), 0);
    const outcomes = projection.workouts
      .filter((workout) => {
        const completedAt = workout.outcome?.completedAt;
        return completedAt !== undefined && occurredOnDate(completedAt, mesocycle.startDate, mesocycle.endDate);
      });
    const performedSetCount = outcomes.reduce((count, workout) => count + workout.setOutcomes.length, 0);
    const partialSessions = outcomes.filter((workout) => workout.outcome?.status !== "completed").length;
    const recoveryLimited = projection.recoveryConstraints.some((constraint) =>
      constraint.value.level !== "normal" && constraint.value.validUntil >= this.runtime.now(),
    );
    const activeNutrition = projection.nutritionStrategies.at(-1)?.value;
    const reviewDate = this.runtime.now().slice(0, 10);
    const status: import("./model").MesocycleReviewArtifact["status"] =
      plannedSetCount === 0 || performedSetCount === 0
        ? "insufficient_data"
        : recoveryLimited || partialSessions >= 2
          ? "adjust"
          : reviewDate >= mesocycle.endDate
            ? "complete"
            : "continue";
    const summary = [
      plannedSetCount === 0
        ? "当前周期还没有可比较的已物化训练组。"
        : `已记录 ${performedSetCount} / ${plannedSetCount} 个计划工作组。`,
      partialSessions
        ? `${partialSessions} 次训练以部分完成结束；保留未完成项，不创建训练债务。`
        : "本周期没有已记录的部分完成训练。",
      recoveryLimited
        ? "当前有效恢复约束仍在；任何后续调整需要先尊重该边界。"
        : "没有有效的非正常恢复约束。",
      activeNutrition
        ? `饮食策略状态：${activeNutrition.status ?? "active"}。`
        : "尚无已提交的饮食策略；不会推断能量或摄入趋势。",
    ];
    const createdAt = this.runtime.now();
    const artifact: import("./model").MesocycleReviewArtifact = {
      id: `mesocycle-review-${stableHash({ userId: input.userId, cycle: cycle.value.id, mesocycle: mesocycle.id, frontier })}`,
      kind: "mesocycle_review",
      userId: input.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt,
      contextRefs: [{ kind: "progress", ref: mesocycle.id }],
      evidenceRefs: frontierFactRefs(frontier),
      missingness: plannedSetCount === 0 || performedSetCount === 0
        ? [plannedSetCount === 0 ? "no_materialized_training_sets" : "no_performed_set_outcomes"]
        : [],
      capabilityBoundary: [
        "仅汇总已确认的本地训练、恢复与饮食策略状态",
        "不会自动改变周期、营养策略或训练计划",
      ],
      hash: stableHash({ mesocycle, plannedSetCount, performedSetCount, partialSessions, recoveryLimited, nutritionStatus: activeNutrition?.status, status, summary, frontier }),
      knowledgePins: this.knowledge.versionPins(),
      period: { start: mesocycle.startDate, end: mesocycle.endDate },
      status,
      summary,
    };
    const result = await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: "replanner",
      intent: "mesocycle.review",
      expectedRevisions: frontier,
      domainEvents: [],
      artifacts: [artifact],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: createdAt,
        actor: "rule_engine",
        action: "assessment.created",
        targetType: "plan",
        targetId: cycle.value.id,
        scope: `mesocycle:${mesocycle.id}`,
        intent: "mesocycle.review",
        before: {},
        after: { artifactId: artifact.id, status, plannedSetCount, performedSetCount },
        evidenceRefs: artifact.evidenceRefs,
        beforeRefs: artifact.evidenceRefs,
        afterRefs: artifact.evidenceRefs,
        ruleVersions: knowledgeRuleVersions(this.knowledge.versionPins()),
        mandateRevision: projection.mandate?.revision ?? 0,
        result: "allowed",
        undoBoundary: "not_applicable",
        policyDecision: "allow",
        causationId: mesocycle.id,
        correlationId: input.idempotencyKey,
        reversible: false,
      }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: createdAt,
    });
    if (result.status === "idempotent") {
      const replay = await this.findPersistedMesocycleReview(input.userId, input.idempotencyKey);
      if (replay) return replay;
      throw new Error("mesocycle_review_idempotency_artifact_missing");
    }
    return artifact;
  }

  /**
   * The only Deload-end route into the Replanner. A local recipe or explicit
   * user action must prove that the period's configured recovery week has
   * ended; natural-language input cannot manufacture this trigger.
   */
  async evaluateDeloadEndedReplan(input: {
    userId: string;
    mesocycleId: string;
    occurredOn: string;
    idempotencyKey: string;
    timezoneOffsetMinutes?: number;
  }): Promise<import("../replanning").ReplanEvaluation | undefined> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)) throw new Error("invalid_deload_end_date");
    const projection = await this.readDomainProjection({ userId: input.userId });
    if (!projection.profile || !projection.goalContract || !projection.mandate) return undefined;
    const cycle = [...projection.goalCycles]
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0];
    const mesocycle = cycle?.value.phasePath?.find((candidate) => candidate.id === input.mesocycleId);
    const recoveryWeek = mesocycle?.weeklyIntents.find(
      (week) => week.ordinal === mesocycle.plannedRecoveryWindow?.weekOrdinal,
    );
    if (!cycle || !mesocycle || !recoveryWeek) throw new Error("mesocycle_recovery_window_not_found");
    if (input.occurredOn < recoveryWeek.endDate) throw new Error("deload_not_yet_ended");
    const timezoneOffsetMinutes = input.timezoneOffsetMinutes ?? timezoneOffsetForInstant(this.runtime.now());
    const occurredAt = localNoonToIso(input.occurredOn, timezoneOffsetMinutes);
    const evaluation = await this.evaluateLocalReplan({
      userId: input.userId,
      currentDate: input.occurredOn,
      trigger: {
        id: `deload-ended:${cycle.value.id}:${mesocycle.id}:${recoveryWeek.endDate}`,
        kind: "deload_ended",
        actor: "system",
        occurredAt,
        causationId: `${mesocycle.id}:${recoveryWeek.id}`,
        idempotencyKey: `replan:deload_ended:${input.idempotencyKey}`,
      },
      window: { start: recoveryWeek.startDate, end: recoveryWeek.endDate },
    });
    await this.enqueueDefaultRecipe({
      userId: input.userId,
      kind: "deload_ended",
      occurredAt,
      causationId: `${mesocycle.id}:${recoveryWeek.id}`,
      idempotencyKey: `recipe:deload_ended:${input.idempotencyKey}`,
      timezoneOffsetMinutes,
    });
    return evaluation;
  }

  async showWeeklyCoachReport(
    input: { sessionId: string; weekStart: string; weekEnd: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const artifact = await this.createWeeklyCoachReport({
      userId: session.userId,
      weekStart: input.weekStart,
      weekEnd: input.weekEnd,
      idempotencyKey: `weekly-report:${session.userId}:${input.weekStart}:${input.weekEnd}`,
    });
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "coach.show_weekly_report",
      execution,
      artifact,
      scope: `week:${input.weekStart}:${input.weekEnd}`,
    });
  }

  /** Read-only Agent tool for the current (or most recently ended) local phase. */
  async showLatestMesocycleReview(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: session.userId });
    const cycle = [...domain.goalCycles]
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0];
    const date = this.runtime.now().slice(0, 10);
    const mesocycle = cycle?.value.phasePath
      ?.find((candidate) => candidate.startDate <= date && date <= candidate.endDate) ??
      cycle?.value.phasePath?.at(-1);
    if (!mesocycle) throw new Error("mesocycle_not_found");
    const artifact = await this.createMesocycleReview({
      userId: session.userId,
      mesocycleId: mesocycle.id,
      idempotencyKey: `mesocycle-review:${session.userId}:${mesocycle.id}`,
    });
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "coach.show_mesocycle_review",
      execution,
      artifact,
      scope: `mesocycle:${mesocycle.id}`,
    });
  }

  /**
   * Displays the newest registered local replan forecast. This intentionally
   * never evaluates the Planner: an LLM question is not a ReplanTrigger.
   */
  async showGoalForecast(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const source = snapshot.artifacts
      .filter(
        (artifact): artifact is import("./model").ReplanEvaluationArtifact =>
          artifact.kind === "replan_evaluation" && artifact.userId === session.userId,
      )
      .sort(
        (left, right) =>
          right.evaluation.trigger.occurredAt.localeCompare(left.evaluation.trigger.occurredAt) ||
          right.evaluation.evaluatedAt.localeCompare(left.evaluation.evaluatedAt) ||
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      )[0];
    const now = this.runtime.now();
    const candidate: import("./model").GoalForecastArtifact = {
      id: `goal-forecast-${stableHash({
        userId: session.userId,
        sourceEvaluationId: source?.id,
        sourceHash: source?.hash,
      })}`,
      kind: "goal_forecast",
      userId: session.userId,
      ...(source
        ? {
            sourceEvaluationId: source.id,
            evaluatedAt: source.evaluation.evaluatedAt,
            forecasts: source.evaluation.forecasts,
          }
        : { forecasts: [] }),
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: source?.evidenceRefs ?? [],
      missingness: source?.missingness ?? ["no_local_replan_evaluation"],
      capabilityBoundary: [
        "只呈现注册触发器已完成的本地预测；提问本身不会重新计算路径",
        "预测仅表达范围、方向和条件，不承诺完成日期、身体指标或表现结果",
        "不会修改计划、目标、营养策略或任何已完成训练记录",
      ],
      hash: stableHash({
        sourceEvaluationId: source?.id,
        sourceHash: source?.hash,
        forecasts: source?.evaluation.forecasts ?? [],
        knowledgePins: this.knowledge.versionPins(),
      }),
      knowledgePins: this.knowledge.versionPins(),
    };
    const artifact = snapshot.artifacts.find(
      (stored): stored is import("./model").GoalForecastArtifact =>
        stored.kind === "goal_forecast" && stored.id === candidate.id && stored.userId === session.userId,
    ) ?? candidate;
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "forecast.show_latest",
      execution,
      artifact,
      scope: source ? `forecast:${source.id}` : "forecast:no_local_evaluation",
    });
  }

  /** Shows only the latest valid local recovery constraint; the card is never a plan mutation. */
  async showRecoveryBrief(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: session.userId });
    const now = this.runtime.now();
    const constraints = [...domain.recoveryConstraints]
      .sort((left, right) => {
        const leftAt = left.value.evaluation?.evaluatedAt ?? "";
        const rightAt = right.value.evaluation?.evaluatedAt ?? "";
        return rightAt.localeCompare(leftAt) || right.revision - left.revision;
      });
    const active = constraints.find((candidate) => {
      const validUntil = Date.parse(candidate.value.validUntil);
      return Number.isFinite(validUntil) && validUntil >= Date.parse(now);
    });
    const newest = constraints[0];
    const selected = active ?? undefined;
    const status = selected
      ? "active_constraint" as const
      : newest
        ? "expired_constraint" as const
        : "no_active_constraint" as const;
    const artifact: import("./model").RecoveryBriefArtifact = {
      id: `recovery-brief-${stableHash({
        userId: session.userId,
        status,
        constraintId: selected?.value.id,
        constraintRevision: selected?.revision,
      })}`,
      kind: "recovery_brief",
      userId: session.userId,
      status,
      ...(selected ? { constraint: selected.value, constraintRevision: selected.revision } : {}),
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: selected
        ? [{ aggregate: "recovery", id: selected.value.id, revision: selected.revision }]
        : [],
      missingness: selected ? [] : ["no_valid_recovery_constraint"],
      capabilityBoundary: [
        "只呈现本地已确认的恢复约束，不诊断健康状况",
        "不会直接修改训练计划、已完成记录或正在执行的组",
      ],
      hash: stableHash({
        status,
        constraint: selected?.value,
        constraintRevision: selected?.revision,
        knowledgePins: this.knowledge.versionPins(),
      }),
      knowledgePins: this.knowledge.versionPins(),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "recovery.show_brief",
      execution,
      artifact,
      scope: selected ? `recovery:${selected.value.id}` : "recovery:no_active_constraint",
    });
  }

  /**
   * 知识检索工具（ticket 06）：只读查询当前安装的知识包。
   * 查无结果返回 typed unknown（missingness 标记），绝不返回空内容让模型自由发挥。
   */
  async lookupExerciseKnowledge(
    input: { sessionId: string; query: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const now = this.runtime.now();
    const knowledgePins = this.knowledge.versionPins();
    const matches = this.knowledge.search({ query: input.query, limit: 3 });
    const first = matches[0];
    const artifact: import("./model").EvidenceBriefArtifact = first
      ? {
          id: `knowledge-exercise-${stableHash({ id: first.id, pins: knowledgePins })}`,
          kind: "evidence_brief",
          userId: session.userId,
          title: `动作：${first.displayName.zh}（${first.displayName.en}）`,
          summary: [
            `动作模式：${first.movementPattern}；负荷方式：${first.equipment.loadMode}`,
            muscleSummaryLine(first),
            ...first.aliases.length ? [`别名：${first.aliases.join("、")}`] : [],
            ...matches.length > 1
              ? [`其他相近条目：${matches.slice(1).map((variant) => variant.displayName.zh).join("、")}`]
              : [],
            "肌群关联是动作学参考的策展结论（预计参与），摄像头无法测量肌肉实际激活",
          ],
          schemaVersion: 1,
          renderVersion: 1,
          createdAt: now,
          contextRefs: [session.context],
          evidenceRefs: [{ aggregate: "exercise", id: first.id, revision: 1 }],
          missingness: first.expectedMuscleAssociation.status === "unknown" ? ["muscle_association_unknown"] : [],
          capabilityBoundary: [
            "只呈现当前知识包已审核的目录内容",
            "肌群关联为预计参与，不是当次激活观测",
            "不提供负荷建议；负荷只来自用户确认的表现历史",
          ],
          hash: stableHash({ id: first.id, pins: knowledgePins }),
          knowledgePins,
        }
      : {
          id: `knowledge-exercise-unknown-${stableHash({ query: input.query, pins: knowledgePins })}`,
          kind: "evidence_brief",
          userId: session.userId,
          title: `未收录：${input.query}`,
          summary: [
            `"${input.query}" 不在当前知识包目录中`,
            "不要凭模型一般知识编造该动作的细节、肌群或负荷建议",
          ],
          schemaVersion: 1,
          renderVersion: 1,
          createdAt: now,
          contextRefs: [session.context],
          evidenceRefs: [],
          missingness: ["exercise_not_in_catalog"],
          capabilityBoundary: ["知识库未收录时必须明示不知道，不得编造"],
          hash: stableHash({ query: input.query, unknown: true, pins: knowledgePins }),
          knowledgePins,
        };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "knowledge.lookup_exercise",
      execution,
      artifact,
      scope: first ? `knowledge:exercise:${first.id}` : "knowledge:exercise:not_in_catalog",
    });
  }

  async explainKnowledgeRule(
    input: { sessionId: string; ruleId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const now = this.runtime.now();
    const knowledgePins = this.knowledge.versionPins();
    const inspection = this.knowledge.inspect();
    const rulePack = inspection.executableRulePacks.find((candidate) => candidate.id === input.ruleId);
    const sourceTitles = rulePack
      ? rulePack.sourceRefs.map((refId) => {
          const source = inspection.manifest.sourceRefs.find((candidate) => candidate.id === refId);
          return source ? `${source.title}（${source.uri}）` : refId;
        })
      : [];
    const artifact: import("./model").EvidenceBriefArtifact = rulePack
      ? {
          id: `knowledge-rule-${stableHash({ id: rulePack.id, hash: rulePack.contentHash })}`,
          kind: "evidence_brief",
          userId: session.userId,
          title: `规则包：${rulePack.id} v${rulePack.semanticVersion}`,
          summary: [
            `覆盖范围：${rulePack.scope.join("、")}`,
            `审核时间：${rulePack.reviewedAt}`,
            ...sourceTitles.length ? [`证据锚点：${sourceTitles.join("；")}`] : [],
            "可执行逻辑在本地确定性规则包；此处只呈现清单与证据锚点，具体数值以规则包产出为准",
          ],
          schemaVersion: 1,
          renderVersion: 1,
          createdAt: now,
          contextRefs: [session.context],
          evidenceRefs: [{ aggregate: "exercise", id: rulePack.id, revision: 1 }],
          missingness: [],
          capabilityBoundary: [
            "只呈现知识包中已审核的规则清单与证据锚点",
            "规则数值是产品默认值，不是被研究验证的唯一生理最优",
          ],
          hash: stableHash({ id: rulePack.id, hash: rulePack.contentHash }),
          knowledgePins,
        }
      : {
          id: `knowledge-rule-unknown-${stableHash({ ruleId: input.ruleId, pins: knowledgePins })}`,
          kind: "evidence_brief",
          userId: session.userId,
          title: `未收录规则：${input.ruleId}`,
          summary: [
            `规则 "${input.ruleId}" 不在当前知识包中`,
            "不要凭模型一般知识编造规则数值或阈值",
          ],
          schemaVersion: 1,
          renderVersion: 1,
          createdAt: now,
          contextRefs: [session.context],
          evidenceRefs: [],
          missingness: ["rule_not_in_pack"],
          capabilityBoundary: ["知识库未收录时必须明示不知道，不得编造"],
          hash: stableHash({ ruleId: input.ruleId, unknown: true, pins: knowledgePins }),
          knowledgePins,
        };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "knowledge.explain_rule",
      execution,
      artifact,
      scope: rulePack ? `knowledge:rule:${rulePack.id}` : "knowledge:rule:not_in_pack",
    });
  }

  /**
   * Read-only recovery assessment for a Coach run.  It consumes only already
   * committed Timeline/Profile facts and intentionally does not create a
   * RecoveryConstraint, a plan revision, or an ActionToken.
   */
  async evaluateRecoveryTimelineForTool(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const now = this.runtime.now();
    const nowMs = Date.parse(now);
    if (!Number.isFinite(nowMs)) throw new Error("invalid_recovery_evaluation_time");
    const evaluation = await this.evaluateRecoveryFromTimeline({
      userId: session.userId,
      validUntil: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
      id: `recovery-timeline-assessment:${stableHash({ userId: session.userId, at: now })}`,
    });
    const projection = await this.readDomainProjection({ userId: session.userId });
    const artifact: import("./model").RecoveryBriefArtifact = {
      id: `recovery-timeline-brief:${stableHash({
        userId: session.userId,
        evaluatedAt: evaluation.decision.constraint.evaluation?.evaluatedAt,
        constraint: evaluation.decision.constraint,
      })}`,
      kind: "recovery_brief",
      userId: session.userId,
      status: "timeline_assessment",
      constraint: evaluation.decision.constraint,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: projection.timeline.revision > 0
        ? [{ aggregate: "timeline", id: `timeline.${session.userId}`, revision: projection.timeline.revision }]
        : [],
      missingness: evaluation.decision.constraint.evaluation?.missingOrStale ?? [],
      capabilityBoundary: [
        "基于本地已确认 Timeline 与用户已选择的来源进行非诊断性复核",
        "不会写入恢复约束、修改计划、暂停正在执行的组或替代用户主观反馈",
      ],
      hash: stableHash({
        constraint: evaluation.decision.constraint,
        evidence: evaluation.evidence,
        knowledgePins: this.knowledge.versionPins(),
      }),
      knowledgePins: this.knowledge.versionPins(),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "recovery.evaluate_timeline",
      execution,
      artifact,
      scope: "recovery:timeline_assessment",
    });
  }

  /** Safety Hold is factual, non-diagnostic and always takes precedence in the fixed UI registry. */
  async showSafetyHold(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: session.userId });
    const now = this.runtime.now();
    const active = [...domain.safetyConstraints]
      .filter((candidate) => {
        if (candidate.value.disposition === "clear") return false;
        const until = candidate.value.validUntil;
        return !until || until >= now;
      })
      .sort((left, right) => right.revision - left.revision)[0];
    const artifact: import("./model").SafetyHoldArtifact = {
      id: `safety-hold-${stableHash({
        userId: session.userId,
        constraintId: active?.value.id,
        constraintRevision: active?.revision,
      })}`,
      kind: "safety_hold",
      userId: session.userId,
      status: active ? "active_hold" : "no_active_hold",
      ...(active ? { constraint: active.value, constraintRevision: active.revision } : {}),
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: active
        ? [{ aggregate: "safety", id: active.value.id, revision: active.revision }]
        : [],
      missingness: active ? [] : ["no_active_safety_constraint"],
      capabilityBoundary: [
        "只呈现已确认的本地安全限制；不诊断症状、伤病或风险概率",
        "不会以动作平替、恢复建议或对话绕过当前限制",
        "不会修改训练计划、已完成记录或安全限制本身",
      ],
      hash: stableHash({
        constraint: active?.value,
        constraintRevision: active?.revision,
        knowledgePins: this.knowledge.versionPins(),
      }),
      knowledgePins: this.knowledge.versionPins(),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "safety.show_hold",
      execution,
      artifact,
      scope: active ? `safety:${active.value.id}` : "safety:no_active_hold",
    });
  }

  /** Shows the current local nutrition strategy without treating it as an intake record or a mutation. */
  async showNutritionStrategy(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: session.userId });
    const strategy = [...domain.nutritionStrategies]
      .sort((left, right) => right.revision - left.revision)[0];
    const now = this.runtime.now();
    const artifact: import("./model").NutritionStrategyArtifact = {
      id: `nutrition-strategy-${stableHash({
        userId: session.userId,
        strategyId: strategy?.value.id,
        strategyRevision: strategy?.revision,
      })}`,
      kind: "nutrition_strategy",
      userId: session.userId,
      status: strategy?.value.status === "paused"
        ? "paused_strategy"
        : strategy
          ? "active_strategy"
          : "no_active_strategy",
      ...(strategy ? { strategy: strategy.value, strategyRevision: strategy.revision } : {}),
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: strategy
        ? [{ aggregate: "nutrition", id: strategy.value.id, revision: strategy.revision }]
        : [],
      missingness: strategy ? [] : ["no_active_nutrition_strategy"],
      capabilityBoundary: [
        "只呈现已提交的本地饮食策略，不代表真实摄入或测得消耗",
        "不会直接修改热量目标、历史饮食记录或训练计划",
      ],
      hash: stableHash({
        strategy: strategy?.value,
        strategyRevision: strategy?.revision,
        knowledgePins: this.knowledge.versionPins(),
      }),
      knowledgePins: this.knowledge.versionPins(),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "nutrition.show_strategy",
      execution,
      artifact,
      scope: strategy ? `nutrition:${strategy.value.id}` : "nutrition:no_active_strategy",
    });
  }

  /** Presents the committed week plan and intake targets through one read-only Agent card. */
  async showCurrentPlanOverview(
    input: { sessionId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: session.userId });
    const plan = domain.plan;
    const currentDate = this.runtime.now().slice(0, 10);
    const fallbackWindow = localCalendarWeek(currentDate) ?? { start: currentDate, end: currentDate };
    const materializedWeek = plan?.value.materializedWeeks?.find((week) => week.startDate <= currentDate && week.endDate >= currentDate)
      ?? plan?.value.materializedWeeks?.[0];
    const window = materializedWeek
      ? { start: materializedWeek.startDate, end: materializedWeek.endDate }
      : fallbackWindow;
    const scheduled = materializedWeek?.sessions
      ?? plan?.value.sessions.filter((candidate) => candidate.scheduledFor >= window.start && candidate.scheduledFor <= window.end)
      ?? [];
    const nutrition = [...domain.nutritionStrategies]
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0];
    const timezoneOffsetMinutes = [...domain.timeline.events]
      .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt))
      .at(-1)?.timezoneOffsetMinutes ?? 0;
    const product = await this.readProductProjection({
      userId: session.userId,
      date: currentDate,
      timezoneOffsetMinutes,
      calendarMode: "week",
      calendarAnchorDate: currentDate,
    });
    const todayBudget = product.today.nutrition.budget;
    const tasks = scheduled.flatMap((plannedSession) => plannedSession.tasks.map((task) => {
      const firstSet = task.sets[0];
      const reps = firstSet?.targetReps
        ? firstSet.targetReps.min === firstSet.targetReps.max
          ? String(firstSet.targetReps.min)
          : `${firstSet.targetReps.min}–${firstSet.targetReps.max}`
        : firstSet?.targetDuration
          ? `${firstSet.targetDuration.value} ${prescriptionUnitLabel(firstSet.targetDuration.unit)}`
          : firstSet?.targetDistance
            ? `${firstSet.targetDistance.value} ${prescriptionUnitLabel(firstSet.targetDistance.unit)}`
            : "待校准";
      const restSeconds = firstSet?.rest
        ? firstSet.rest.unit === "seconds"
          ? firstSet.rest.value
          : firstSet.rest.unit === "minutes"
            ? firstSet.rest.value * 60
            : firstSet.rest.value * 3600
        : undefined;
      return {
        id: task.id,
        name: localizedExerciseDisplayName(this.knowledge.exerciseVariant(task.exerciseVariantId)?.displayName.zh ?? task.exerciseVariantId),
        exerciseVariantId: task.exerciseVariantId,
        sets: task.sets.length,
        reps,
        ...(firstSet?.targetLoad?.unit === "kg" ? { loadKg: firstSet.targetLoad.value } : {}),
        ...(firstSet?.targetRir !== undefined ? { targetRir: firstSet.targetRir } : {}),
        ...(restSeconds !== undefined ? { restSeconds } : {}),
        scheduledFor: plannedSession.scheduledFor,
        sessionTitle: plannedSession.title,
      };
    }));
    const trainingDays = scheduled.filter((candidate) => candidate.kind !== "rest" && candidate.tasks.length > 0).length;
    const totalWorkSets = tasks.reduce((sum, task) => sum + task.sets, 0);
    const nutritionReviewAt = nutrition?.value.reviewWindow?.endsAt;
    const calibrationBoundaries = [
      ...(tasks.length ? ["仍需校准：每个动作的实际起始重量、实际完成次数与实际余力；首周训练记录后再调整"] : []),
      ...(nutrition?.value.calorieRange
        ? [`摄入范围已给出；${nutritionReviewAt ? `在 ${nutritionReviewAt} 前` : "进入复核前"}至少记录 3 次同条件体重，并结合真实饮食与训练表现复核`]
        : ["仍需校准：个人维持热量；先记录 7 天真实饮食，不使用人群平均值代填"]),
      ...(!nutrition?.value.macronutrientTargets ? ["仍需补充体重，才能把蛋白质来源换算为每日克数"] : []),
    ];
    const now = this.runtime.now();
    const artifact: import("./model").PlanOverviewArtifact = {
      id: `plan-overview-${stableHash({ userId: session.userId, planRevision: plan?.revision ?? 0, window, nutritionRevision: nutrition?.revision, todayBudget, intakeWeek: product.plan.intakeWeek })}`,
      kind: "plan_overview",
      userId: session.userId,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: [
        ...(plan ? [{ aggregate: "plan" as const, id: plan.value.id, revision: plan.revision }] : []),
        ...(nutrition ? [{ aggregate: "nutrition" as const, id: nutrition.value.id, revision: nutrition.revision }] : []),
      ],
      missingness: [
        ...(!plan ? ["current_plan"] : []),
        ...(!nutrition ? ["nutrition_strategy"] : []),
        ...(!nutrition?.value.calorieRange ? ["maintenance_energy"] : []),
        ...(!nutrition?.value.macronutrientTargets ? ["body_mass"] : []),
      ],
      capabilityBoundary: [
        "只读取当前已确认的训练版本与饮食范围，不代表实际完成或真实摄入",
        "每日摄入目标会按训练日、休息日和已确认运动做有界分配；额外运动补给最多增加 200 kcal，不等同于声称测得消耗",
        "建议值上下 10% 视为正常区间；高于 10% / 20% 分级提醒，明显偏低同样需要解释，减脂不是越少越好",
        ...calibrationBoundaries,
        "未知值保持未知；Agent 不可自行补造",
      ],
      hash: stableHash({ plan: plan?.value, planRevision: plan?.revision, window, nutrition: nutrition?.value, nutritionRevision: nutrition?.revision, todayBudget, intakeWeek: product.plan.intakeWeek }),
      knowledgePins: this.knowledge.versionPins(),
      planRevision: plan?.revision ?? 0,
      strategy: plan?.value.strategySelection?.primary ?? "unavailable",
      window,
      trainingDays,
      totalWorkSets,
      tasks,
      ...(nutrition ? {
        nutrition: {
          ...(nutrition.value.calorieRange ? { energyRange: { min: nutrition.value.calorieRange.min.value, max: nutrition.value.calorieRange.max.value, unit: "kcal" as const } } : {}),
          ...(nutrition.value.macronutrientTargets ? {
            proteinGrams: nutrition.value.macronutrientTargets.proteinGrams,
            fatEnergyFloorPercent: nutrition.value.macronutrientTargets.fatEnergyFloorPercent,
          } : {}),
          ...(nutrition.value.reviewWindow?.endsAt ? { reviewAt: nutrition.value.reviewWindow.endsAt } : {}),
          today: {
            date: todayBudget.date,
            dayKind: todayBudget.dayKind,
            ...(todayBudget.recommendedKcal === undefined ? {} : { recommendedKcal: todayBudget.recommendedKcal }),
            ...(todayBudget.recommendedRange ? { recommendedRange: todayBudget.recommendedRange } : {}),
            ...(todayBudget.consumedKcal === undefined ? {} : { consumedKcal: todayBudget.consumedKcal }),
            ...(todayBudget.variancePercent === undefined ? {} : { variancePercent: todayBudget.variancePercent }),
            status: todayBudget.status,
            dayTypeAdjustmentKcal: todayBudget.dayTypeAdjustmentKcal,
            activityAdjustmentKcal: todayBudget.activityAdjustmentKcal,
          },
          week: product.plan.intakeWeek.map((budget) => ({
            date: budget.date,
            dayKind: budget.dayKind,
            ...(budget.recommendedKcal === undefined ? {} : { recommendedKcal: budget.recommendedKcal }),
          })),
        },
      } : {}),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "plan.show_current",
      execution,
      artifact,
      scope: plan ? `plan:${plan.value.id}:r${plan.revision}` : "plan:unavailable",
    });
  }

  private async findPersistedReplanEvaluation(
    userId: string,
    idempotencyKey: string,
  ): Promise<import("./model").ReplanEvaluationArtifact | undefined> {
    const snapshot = await this.ledger.read();
    const committed = snapshot.domainIdempotency.some(
      (record) =>
        record.userId === userId &&
        record.actorId === "replanner" &&
        record.intent === "replan.evaluate" &&
        record.key === idempotencyKey,
    );
    if (!committed) return undefined;
    return snapshot.artifacts.find(
      (artifact): artifact is import("./model").ReplanEvaluationArtifact =>
        artifact.kind === "replan_evaluation" &&
        artifact.userId === userId &&
        artifact.evaluation.trigger.idempotencyKey === idempotencyKey,
    );
  }

  private async listPersistedReplanEvaluations(
    userId: string,
  ): Promise<readonly import("../replanning").ReplanEvaluation[]> {
    const snapshot = await this.ledger.read();
    return snapshot.artifacts
      .filter(
        (artifact): artifact is import("./model").ReplanEvaluationArtifact =>
          artifact.kind === "replan_evaluation" && artifact.userId === userId,
      )
      .map((artifact) => artifact.evaluation)
      .sort(
        (left, right) =>
          left.evaluatedAt.localeCompare(right.evaluatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  private async presentArtifactForTool(input: {
    sessionId: string;
    toolName: string;
    execution?: ToolExecutionIdentity;
    artifact: import("./model").Artifact;
    presentationStatus?: import("./model").PresentationStatus;
    scope: string;
  }): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const now = this.runtime.now();
    const runId = input.execution?.runId ?? this.runtime.nextId("local-run");
    const toolCallId = input.execution?.toolCallId ?? this.runtime.nextId("local-tool-call");
    const previousPresentation = snapshot.presentations.find(
      (candidate) => candidate.artifactId === input.artifact.id && candidate.renderer === `${input.artifact.kind}/${input.artifact.renderVersion}`,
    );
    const presentation: import("./model").PresentationRef = previousPresentation
      ? { ...previousPresentation, status: input.presentationStatus ?? previousPresentation.status }
      : {
          id: this.runtime.nextId("presentation"),
          artifactId: input.artifact.id,
          renderer: `${input.artifact.kind}/${input.artifact.renderVersion}`,
          status: input.presentationStatus ?? "ready",
        };
    const events: readonly import("./model").CoachRunEvent[] = [
      {
        type: "tool-started",
        sessionId: session.id,
        runId,
        toolCallId,
        toolName: input.toolName,
        presentationId: presentation.id,
        occurredAt: now,
      },
      {
        type: "artifact-ready",
        sessionId: session.id,
        runId,
        toolCallId,
        artifactRef: {
          id: input.artifact.id,
          kind: input.artifact.kind,
          schemaVersion: input.artifact.schemaVersion,
          hash: input.artifact.hash,
        },
        presentation,
        occurredAt: now,
      },
    ];
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: session.userId });
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: "coach_kernel",
      intent: `${input.toolName}.present`,
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      domainEvents: [],
      sessions: [{
        ...session,
        revision: (session.revision ?? 1) + 1,
        runIds: [...new Set([...(session.runIds ?? []), runId])],
        toolCallIds: [...new Set([...(session.toolCallIds ?? []), toolCallId])],
        artifactIds: [...new Set([...(session.artifactIds ?? []), input.artifact.id])],
        presentationIds: [...new Set([...(session.presentationIds ?? []), presentation.id])],
        updatedAt: now,
      }],
      artifacts: [input.artifact],
      presentations: [presentation],
      runEvents: events,
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: session.userId,
        occurredAt: now,
        actor: "agent",
        action: "context.read",
        targetType: "session",
        targetId: session.id,
        scope: input.scope,
        intent: input.toolName,
        before: {},
        after: { artifactId: input.artifact.id },
        evidenceRefs: input.artifact.evidenceRefs,
        beforeRefs: input.artifact.evidenceRefs,
        afterRefs: input.artifact.evidenceRefs,
        ruleVersions: knowledgeRuleVersions(input.artifact.knowledgePins),
        mandateRevision: domain.mandate?.revision ?? 0,
        result: "allowed",
        undoBoundary: "not_applicable",
        sessionId: session.id,
        runId,
        toolCallId,
        policyDecision: "allow",
        causationId: toolCallId,
        correlationId: session.id,
        reversible: false,
      }],
      idempotencyKey: `present:${runId}:${toolCallId}:${input.artifact.id}`,
      recordedAt: now,
    });
    return { artifact: input.artifact, card: this.cards.render(input.artifact, presentation.status), events };
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

  private async findPersistedMesocycleReview(
    userId: string,
    idempotencyKey: string,
  ): Promise<import("./model").MesocycleReviewArtifact | undefined> {
    const snapshot = await this.ledger.read();
    const committed = snapshot.domainIdempotency.some(
      (record) =>
        record.userId === userId &&
        record.actorId === "replanner" &&
        record.intent === "mesocycle.review" &&
        record.key === idempotencyKey,
    );
    if (!committed) return undefined;
    const action = snapshot.actionEvents.find(
      (event) => event.userId === userId && event.intent === "mesocycle.review" && event.correlationId === idempotencyKey,
    );
    const artifactId = typeof action?.after.artifactId === "string" ? action.after.artifactId : undefined;
    return snapshot.artifacts.find(
      (artifact): artifact is import("./model").MesocycleReviewArtifact =>
        artifact.kind === "mesocycle_review" && artifact.userId === userId && artifact.id === artifactId,
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

  /** An actual local recovery downgrade is a closed replan trigger; green days are not. */
  private async evaluateRecoveryConstraintReplan(input: {
    userId: string;
    constraint: import("./domain").RecoveryConstraintData;
  }): Promise<void> {
    if (input.constraint.level === "normal") return;
    const projection = await this.readDomainProjection({ userId: input.userId });
    if (!projection.profile || !projection.goalContract || !projection.mandate) return;
    const occurredAt = input.constraint.evaluation?.evaluatedAt ?? this.runtime.now();
    const currentDate = occurredAt.slice(0, 10);
    const window = localCalendarWeek(currentDate);
    if (!window) return;
    await this.evaluateLocalReplan({
      userId: input.userId,
      currentDate,
      trigger: {
        id: `recovery-constraint:${input.constraint.id}:${input.constraint.evaluation?.evaluatedAt ?? occurredAt}`,
        kind: "recovery_constraint_changed",
        actor: "rule_engine",
        occurredAt,
        causationId: input.constraint.id,
        idempotencyKey: `replan:recovery_constraint:${input.constraint.id}:${input.constraint.evaluation?.evaluatedAt ?? occurredAt}`,
      },
      window,
    });
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

  async readNutritionDayLedger(input: {
    userId: string;
    date: string;
    timezoneOffsetMinutes: number;
  }) {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const strategy = [...projection.nutritionStrategies]
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0]?.value;
    const recoveryConstraint = [...projection.recoveryConstraints]
      .filter((item) => item.value.validUntil >= `${input.date}T00:00:00.000Z`)
      .sort((left, right) => right.revision - left.revision || right.value.id.localeCompare(left.value.id))[0]?.value;
    const plan = deriveNutritionDayPlan({
      date: input.date,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      ...(strategy ? { strategy } : {}),
      ...(recoveryConstraint ? { recoveryConstraint } : {}),
    });
    return { plan, ledger: projectNutritionDayLedger({ plan, events: projection.timeline.current }) };
  }

  async createNextMealRecommendation(input: {
    userId: string;
    date: string;
    timezoneOffsetMinutes: number;
    mealSlot: NextMealRecommendation["mealSlot"];
    conditions?: { cooking?: "home" | "takeaway" | "convenience"; dietaryNotes?: readonly string[] };
  }): Promise<NextMealRecommendation> {
    const day = await this.readNutritionDayLedger(input);
    return deriveNextMealRecommendation({
      plan: day.plan,
      ledger: day.ledger,
      mealSlot: input.mealSlot,
      now: this.runtime.now(),
      ...(input.conditions ? { conditions: input.conditions } : {}),
    });
  }

  /** Selection persists a MealDraft as the existing immutable nutrition draft artifact. */
  async selectNextMealRecommendation(input: {
    userId: string;
    recommendation: NextMealRecommendation;
    candidateId: string;
    idempotencyKey: string;
  }): Promise<import("./model").NutritionObservationDraftArtifact> {
    const current = await this.createNextMealRecommendation({
      userId: input.userId,
      date: input.recommendation.date,
      timezoneOffsetMinutes: input.recommendation.timezoneOffsetMinutes,
      mealSlot: input.recommendation.mealSlot,
    });
    if (current.ledgerFingerprint !== input.recommendation.ledgerFingerprint) throw new Error("next_meal_recommendation_stale");
    const candidate = input.recommendation.candidates.find((item) => item.id === input.candidateId);
    if (!candidate) throw new Error("next_meal_candidate_not_found");
    const now = this.runtime.now();
    const observation: import("../nutrition").MealObservation = {
      id: this.runtime.nextId("meal-draft"),
      occurredAt: `${input.recommendation.date}T12:00:00.000Z`,
      mode: "simplified",
      description: candidate.title,
      mealSlot: input.recommendation.mealSlot,
      foods: candidate.foods,
      provenance: "manual",
    };
    const draft: import("../nutrition").NutritionObservationDraft = {
      id: observation.id,
      schemaVersion: 1,
      observation,
      estimates: [],
      generatedAt: now,
      missing: ["user_has_not_confirmed_meal", "candidate_nutrition_values_unknown_until_food_is_confirmed"],
      clarificationRequired: true,
      status: "draft",
    };
    const artifact: import("./model").NutritionObservationDraftArtifact = {
      id: `meal-draft-${stableHash({ userId: input.userId, recommendation: input.recommendation.id, candidateId: input.candidateId })}`,
      kind: "nutrition_observation_draft",
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: now,
      contextRefs: [{ kind: "today", ref: input.recommendation.date }],
      evidenceRefs: [],
      missingness: draft.missing ?? [],
      capabilityBoundary: ["推荐不会计入摄入", "确认实际吃过并补充可量化信息后才进入 Timeline"],
      hash: stableHash(draft),
      knowledgePins: this.knowledge.versionPins(),
      draft,
    };
    const existing = (await this.ledger.read()).artifacts.find((item) => item.id === artifact.id);
    if (existing?.kind === "nutrition_observation_draft") return existing;
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "nutrition.meal_draft.create",
      expectedRevisions: [],
      domainEvents: [],
      artifacts: [artifact],
      actionEvents: [],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return artifact;
  }

  proposeNutritionStrategyChange(input: Parameters<typeof proposeNutritionChange>[0]) {
    return proposeNutritionChange(input);
  }

  /**
   * Creates a local, immutable nutrition adjustment proposal. This is a
   * deliberate boundary: RulePack output can explain a bounded change, but it
   * cannot revise the strategy until a person uses the card action below.
   */
  async proposeNutritionStrategyChangeArtifact(input: {
    userId: string;
    nutritionStrategyId: string;
    observedDays: number;
    comparableWeeks: number;
    adherence: "insufficient" | "qualitative" | "reliable";
    trend: "too_low" | "too_high" | "on_target" | "unknown";
    safety: NutritionSafetyScreen;
    rulePack?: NutritionStrategyRulePack;
    idempotencyKey: string;
  }): Promise<NutritionStrategyProposalResult> {
    const snapshot = await this.ledger.read();
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const strategy = projection.nutritionStrategies.find(
      (candidate) => candidate.value.id === input.nutritionStrategyId,
    );
    if (!strategy) throw new Error("nutrition_strategy_not_found");
    if (!projection.mandate) throw new Error("nutrition_mandate_required");
    const decision = proposeNutritionChange({
      id: `nutrition-change-${stableHash({
        userId: input.userId,
        nutritionStrategyId: strategy.value.id,
        strategyRevision: strategy.revision,
        observedDays: input.observedDays,
        comparableWeeks: input.comparableWeeks,
        adherence: input.adherence,
        trend: input.trend,
        rulePack: input.rulePack?.version,
      })}`,
      strategy: strategy.value,
      observedDays: input.observedDays,
      comparableWeeks: input.comparableWeeks,
      adherence: input.adherence,
      trend: input.trend,
      safety: input.safety,
      rulePack: input.rulePack,
    });
    if (decision.kind === "no_change") {
      return { status: "no_change", reasonCodes: decision.reasonCodes };
    }
    return this.persistNutritionStrategyProposal({
      snapshot,
      projection,
      strategy,
      proposal: decision,
      idempotencyKey: input.idempotencyKey,
      intent: "nutrition_strategy.propose",
    });
  }

  /**
   * Produces a confirmation-gated proposal that only aligns stored day types
   * with the currently materialized training plan.  It has no Provider input
   * and cannot alter any numeric target on its own.
   */
  async proposeNutritionPlanCoordinationArtifact(input: {
    userId: string;
    nutritionStrategyId: string;
    currentDate: string;
    idempotencyKey: string;
    disclosedSafety?: NutritionSafetyScreen;
  }): Promise<NutritionStrategyProposalResult> {
    const snapshot = await this.ledger.read();
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const strategy = projection.nutritionStrategies.find((candidate) => candidate.value.id === input.nutritionStrategyId);
    if (!strategy) throw new Error("nutrition_strategy_not_found");
    if (!projection.mandate) throw new Error("nutrition_mandate_required");
    const goalCycle = strategy.value.goalCycleRef
      ? projection.goalCycles.find((candidate) => candidate.value.id === strategy.value.goalCycleRef!.id)
      : projection.goalCycles[0];
    const plannedWindow = goalCycle?.value.phasePath
      ?.flatMap((phase) => phase.weeklyIntents.filter((week) => week.intent === "planned_recovery_and_formal_review"))
      .find((week) => input.currentDate >= week.startDate && input.currentDate <= week.endDate);
    const decision = proposeNutritionPlanCoordination({
      id: `nutrition-plan-coordination-${stableHash({
        userId: input.userId,
        nutritionStrategyId: strategy.value.id,
        strategyRevision: strategy.revision,
        planRevision: projection.plan?.revision,
        currentDate: input.currentDate,
      })}`,
      strategy: strategy.value,
      plan: projection.plan?.value,
      currentDate: input.currentDate,
      recoveryConstraints: projection.recoveryConstraints.map((item) => item.value),
      ...(plannedWindow ? { deloadWindow: { startDate: plannedWindow.startDate, endDate: plannedWindow.endDate } } : {}),
      safety: mergeNutritionSafetyScreens(
        input.disclosedSafety ?? { adultConfirmed: true },
        nutritionSafetyScreenFromProjection(projection, this.runtime.now()),
      ),
    });
    if (decision.kind === "no_change") return { status: "no_change", reasonCodes: decision.reasonCodes };
    return this.persistNutritionStrategyProposal({
      snapshot,
      projection,
      strategy,
      proposal: decision,
      idempotencyKey: input.idempotencyKey,
      intent: "nutrition_strategy.coordinate_plan_day_types",
    });
  }

  private async persistNutritionStrategyProposal(input: {
    snapshot: Awaited<ReturnType<CoachLedger["read"]>>;
    projection: DomainProjection;
    strategy: import("./domain").Revisioned<import("./domain").NutritionStrategyData>;
    proposal: import("../nutrition").NutritionChangeProposal;
    idempotencyKey: string;
    intent: "nutrition_strategy.propose" | "nutrition_strategy.coordinate_plan_day_types";
  }): Promise<NutritionStrategyProposalResult> {
    if (!input.projection.mandate) throw new Error("nutrition_mandate_required");
    const executionPolicy = nutritionProposalExecutionPolicy(input.projection.mandate.value, this.runtime.now());
    const now = this.runtime.now();
    const artifactId = `nutrition-proposal-${stableHash({
      userId: input.projection.userId,
      nutritionStrategyId: input.strategy.value.id,
      baseStrategyRevision: input.strategy.revision,
      mandateRevision: input.projection.mandate.revision,
      proposal: input.proposal,
      idempotencyKey: input.idempotencyKey,
    })}`;
    const existing = input.snapshot.artifacts.find(
      (candidate): candidate is import("./model").NutritionChangeProposalArtifact =>
        candidate.id === artifactId && candidate.kind === "nutrition_change_proposal",
    );
    if (existing) {
      const status = nutritionProposalPresentationStatus(input.snapshot, existing, input.projection);
      return { status: "proposal", artifact: existing, card: this.cards.render(existing, status) };
    }
    const artifactSemantic = {
      kind: "nutrition_change_proposal" as const,
      userId: input.projection.userId,
      nutritionStrategyId: input.strategy.value.id,
      baseStrategyRevision: input.strategy.revision,
      mandateRevision: input.projection.mandate.revision,
      executionPolicy,
      proposal: input.proposal,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      createdAt: now,
      contextRefs: [{ kind: "progress" as const, ref: `nutrition:${input.strategy.value.id}` }],
      evidenceRefs: [
        { aggregate: "nutrition" as const, id: input.strategy.value.id, revision: input.strategy.revision },
        { aggregate: "mandate" as const, id: input.projection.mandate.value.id, revision: input.projection.mandate.revision },
        ...(input.projection.plan ? [{ aggregate: "plan" as const, id: input.projection.plan.value.id, revision: input.projection.plan.revision }] : []),
      ],
      missingness: [],
      capabilityBoundary: [
        "策略范围是估算，不代表设备测得的真实维持热量",
        "确认前不会改写饮食安排或历史摄入",
      ],
      knowledgePins: this.knowledge.versionPins(),
    };
    const artifact: import("./model").NutritionChangeProposalArtifact = Object.freeze({
      id: artifactId,
      ...artifactSemantic,
      hash: stableHash(artifactSemantic),
    });
    const presentation: import("./model").PresentationRef = {
      id: `presentation-${stableHash({ artifactId, renderer: "nutrition-change-proposal/1" })}`,
      artifactId,
      renderer: "nutrition-change-proposal/1",
      status: "awaiting_user",
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.projection.userId,
      actorId: "nutrition_rule_pack",
      intent: input.intent,
      expectedRevisions: [
        { kind: "nutrition_strategy", id: input.strategy.value.id, revision: input.strategy.revision },
        { kind: "coaching_mandate", id: input.projection.mandate.value.id, revision: input.projection.mandate.revision },
      ],
      domainEvents: [],
      artifacts: [artifact],
      presentations: [presentation],
      actionEvents: [nutritionStrategyActionEvent({
        id: this.runtime.nextId("action"),
        userId: input.projection.userId,
        occurredAt: now,
        actor: "rule_engine",
        action: "nutrition.strategy.proposed",
        targetId: input.strategy.value.id,
        intent: input.intent,
        before: nutritionStrategyActionView(input.strategy.value),
        after: nutritionStrategyActionView(input.proposal.after),
        evidenceRefs: artifact.evidenceRefs,
        beforeRefs: [{ aggregate: "nutrition", id: input.strategy.value.id, revision: input.strategy.revision }],
        afterRefs: [{ aggregate: "nutrition", id: input.strategy.value.id, revision: input.strategy.revision }],
        mandateRevision: input.projection.mandate.revision,
        ruleVersions: nutritionRuleVersions(artifact),
        result: "allowed",
        undoBoundary: "not_applicable",
        policyDecision: executionPolicy === "advice_only" ? "deny" : "require_confirmation",
        causationId: artifact.id,
        correlationId: artifact.id,
        reversible: false,
      })],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return { status: "proposal", artifact, card: this.cards.render(artifact, "awaiting_user") };
  }

  /**
   * Agent/UI-safe proposal path: review evidence is derived from committed
   * Timeline facts, never supplied by a prompt or a card payload.
   */
  async proposeNutritionStrategyChangeFromTimeline(input: {
    userId: string;
    nutritionStrategyId: string;
    idempotencyKey: string;
    disclosedSafety?: NutritionSafetyScreen;
    rulePack?: NutritionStrategyRulePack;
  }): Promise<NutritionStrategyProposalResult> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const strategy = projection.nutritionStrategies.find(
      (candidate) => candidate.value.id === input.nutritionStrategyId,
    );
    if (!strategy) throw new Error("nutrition_strategy_not_found");
    const review = deriveNutritionReviewEvidence({
      strategy: strategy.value,
      timeline: projection.timeline.current,
      now: this.runtime.now(),
      rulePack: input.rulePack,
    });
    return this.proposeNutritionStrategyChangeArtifact({
      userId: input.userId,
      nutritionStrategyId: input.nutritionStrategyId,
      observedDays: review.observedDays,
      comparableWeeks: review.comparableWeeks,
      adherence: review.adherence,
      trend: review.trend,
      safety: mergeNutritionSafetyScreens(
        input.disclosedSafety ?? { adultConfirmed: true },
        nutritionSafetyScreenFromProjection(projection, this.runtime.now()),
      ),
      rulePack: input.rulePack,
      idempotencyKey: input.idempotencyKey,
    });
  }

  async evaluateNutritionStrategyReview(input: {
    userId: string;
    nutritionStrategyId: string;
    rulePack?: NutritionStrategyRulePack;
  }): Promise<import("../nutrition").NutritionReviewEvidence> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const strategy = projection.nutritionStrategies.find(
      (candidate) => candidate.value.id === input.nutritionStrategyId,
    );
    if (!strategy) throw new Error("nutrition_strategy_not_found");
    return deriveNutritionReviewEvidence({
      strategy: strategy.value,
      timeline: projection.timeline.current,
      now: this.runtime.now(),
      rulePack: input.rulePack,
    });
  }

  /** Closed Agent tool handler: all review inputs are read from local facts. */
  async proposeNutritionStrategyChangeForTool(
    input: { sessionId: string; nutritionStrategyId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const result = await this.proposeNutritionStrategyChangeFromTimeline({
      userId: session.userId,
      nutritionStrategyId: input.nutritionStrategyId,
      idempotencyKey: `nutrition-tool:${session.id}:${execution?.runId ?? "local"}:${execution?.toolCallId ?? "local"}`,
    });
    if (result.status === "proposal") {
      return this.presentArtifactForTool({
        sessionId: session.id,
        toolName: "nutrition.propose_change_from_timeline",
        execution,
        artifact: result.artifact,
        presentationStatus: "awaiting_user",
        scope: `nutrition:${result.artifact.nutritionStrategyId}`,
      });
    }
    const now = this.runtime.now();
    const artifactSemantic = {
      kind: "evidence_brief" as const,
      userId: session.userId,
      title: "当前饮食安排保持不变",
      summary: result.reasonCodes,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: [],
      missingness: result.reasonCodes,
      capabilityBoundary: [
        "数据不足时不会猜测热量缺口或改写饮食安排",
        "补充已确认的记录后可重新进行本地复核",
      ],
      knowledgePins: this.knowledge.versionPins(),
    };
    const artifact: import("./model").EvidenceBriefArtifact = {
      id: `nutrition-review-brief-${stableHash({ userId: session.userId, strategy: input.nutritionStrategyId, reasonCodes: result.reasonCodes })}`,
      ...artifactSemantic,
      hash: stableHash(artifactSemantic),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "nutrition.propose_change_from_timeline",
      execution,
      artifact,
      scope: `nutrition:${input.nutritionStrategyId}`,
    });
  }

  /** Closed Agent path for a plan/day-type proposal; current date comes from local runtime, never the model. */
  async proposeNutritionPlanCoordinationForTool(
    input: { sessionId: string; nutritionStrategyId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowArtifactResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error("coach_session_not_found");
    const now = this.runtime.now();
    const currentDate = now.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) throw new Error("invalid_local_runtime_date");
    const result = await this.proposeNutritionPlanCoordinationArtifact({
      userId: session.userId,
      nutritionStrategyId: input.nutritionStrategyId,
      currentDate,
      idempotencyKey: `nutrition-plan-tool:${session.id}:${execution?.runId ?? "local"}:${execution?.toolCallId ?? "local"}`,
    });
    if (result.status === "proposal") {
      return this.presentArtifactForTool({
        sessionId: session.id,
        toolName: "nutrition.propose_plan_coordination",
        execution,
        artifact: result.artifact,
        presentationStatus: "awaiting_user",
        scope: `nutrition:${result.artifact.nutritionStrategyId}:plan-day-types`,
      });
    }
    const artifactSemantic = {
      kind: "evidence_brief" as const,
      userId: session.userId,
      title: "当前饮食安排保持不变",
      summary: result.reasonCodes,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      createdAt: now,
      contextRefs: [session.context],
      evidenceRefs: [],
      missingness: result.reasonCodes,
      capabilityBoundary: [
        "单次漏训或缺少已物化计划时，不会自动削减热量或改变营养目标",
        "训练日类型需要通过本地确认卡写入，历史摄入保持不变",
      ],
      knowledgePins: this.knowledge.versionPins(),
    };
    const artifact: import("./model").EvidenceBriefArtifact = {
      id: `nutrition-plan-coordination-brief-${stableHash({ userId: session.userId, strategy: input.nutritionStrategyId, reasonCodes: result.reasonCodes, currentDate })}`,
      ...artifactSemantic,
      hash: stableHash(artifactSemantic),
    };
    return this.presentArtifactForTool({
      sessionId: session.id,
      toolName: "nutrition.propose_plan_coordination",
      execution,
      artifact,
      scope: `nutrition:${input.nutritionStrategyId}:plan-day-types`,
    });
  }

  async inspectNutritionStrategyChangeProposal(input: {
    userId: string;
    artifactId: string;
  }): Promise<NutritionStrategyProposalInspection> {
    const snapshot = await this.ledger.read();
    const artifact = findNutritionChangeProposal(snapshot, input.userId, input.artifactId);
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const status = nutritionProposalPresentationStatus(snapshot, artifact, projection);
    return { artifact, status, card: this.cards.render(artifact, status) };
  }

  async applyNutritionStrategyChangeProposal(input: {
    userId: string;
    artifactId: string;
    idempotencyKey: string;
    safety: NutritionSafetyScreen;
  }): Promise<NutritionStrategyActionResult> {
    const snapshot = await this.ledger.read();
    const proposal = findNutritionChangeProposal(snapshot, input.userId, input.artifactId);
    const receiptId = nutritionReceiptId({
      userId: input.userId,
      action: "apply",
      targetArtifactId: proposal.id,
      idempotencyKey: input.idempotencyKey,
    });
    const existing = findNutritionReceipt(snapshot, receiptId);
    if (existing) return { status: "idempotent", receipt: existing, card: this.cards.render(existing, "ready") };
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const status = nutritionProposalPresentationStatus(snapshot, proposal, projection);
    if (status === "stale") {
      await this.updateNutritionProposalPresentation({ snapshot, proposal, status: "stale", idempotencyKey: `nutrition-stale:${proposal.id}` });
      throw new Error("nutrition_proposal_stale");
    }
    if (status !== "awaiting_user") throw new Error("nutrition_proposal_not_actionable");
    if (proposal.executionPolicy === "advice_only") throw new Error("nutrition_proposal_advice_only");
    const safetyReason = nutritionSafetyBlockReason(
      mergeNutritionSafetyScreens(input.safety, nutritionSafetyScreenFromProjection(projection, this.runtime.now())),
    );
    if (safetyReason) throw new Error(safetyReason);
    const mandate = projection.mandate;
    const strategy = projection.nutritionStrategies.find((candidate) => candidate.value.id === proposal.nutritionStrategyId);
    if (!mandate || !strategy) throw new Error("nutrition_proposal_stale");
    if (hasActiveNutritionLock(mandate.value, this.runtime.now())) throw new Error("nutrition_proposal_locked");
    const now = this.runtime.now();
    const receipt = nutritionActionReceipt({
      id: receiptId,
      now,
      action: "apply",
      result: "applied",
      targetArtifactId: proposal.id,
      beforeRevision: strategy.revision,
      afterRevision: strategy.revision + 1,
      contextRefs: proposal.contextRefs,
      evidenceRefs: proposal.evidenceRefs,
      knowledgePins: proposal.knowledgePins ?? this.knowledge.versionPins(),
    });
    const domainEvent = nutritionStrategyRevisionDomainEvent({
      id: this.runtime.nextId("domain-event"),
      userId: input.userId,
      strategy: proposal.proposal.after,
      revision: strategy.revision + 1,
      occurredAt: now,
      recordedAt: now,
      causationId: proposal.id,
      correlationId: receipt.id,
    });
    const proposalPresentation = nutritionProposalPresentation(snapshot, proposal.id);
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "nutrition_strategy.proposal.apply",
      expectedRevisions: [
        { kind: "nutrition_strategy", id: strategy.value.id, revision: strategy.revision },
        { kind: "coaching_mandate", id: mandate.value.id, revision: mandate.revision },
      ],
      domainEvents: [domainEvent],
      outbox: [outboxForDomainEvent(domainEvent)],
      artifacts: [receipt],
      presentations: [
        { ...proposalPresentation, status: "applied" },
        { id: `presentation-${stableHash({ artifactId: receipt.id, renderer: "action-receipt/v1" })}`, artifactId: receipt.id, renderer: "action-receipt/v1", status: "ready" },
      ],
      actionEvents: [nutritionStrategyActionEvent({
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "user",
        action: "nutrition.strategy.applied",
        targetId: strategy.value.id,
        intent: "nutrition_strategy.proposal.apply",
        before: nutritionStrategyActionView(strategy.value),
        after: nutritionStrategyActionView(proposal.proposal.after),
        evidenceRefs: proposal.evidenceRefs,
        beforeRefs: [{ aggregate: "nutrition", id: strategy.value.id, revision: strategy.revision }],
        afterRefs: [{ aggregate: "nutrition", id: strategy.value.id, revision: strategy.revision + 1 }],
        mandateRevision: mandate.revision,
        ruleVersions: nutritionRuleVersions(proposal),
        result: "applied",
        undoBoundary: "compensating_revision",
        policyDecision: "require_confirmation",
        humanDecision: "confirmed",
        causationId: proposal.id,
        correlationId: receipt.id,
        reversible: true,
      })],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return { status: "applied", receipt, card: this.cards.render(receipt, "ready") };
  }

  async rejectNutritionStrategyChangeProposal(input: {
    userId: string;
    artifactId: string;
    idempotencyKey: string;
  }): Promise<NutritionStrategyActionResult> {
    const snapshot = await this.ledger.read();
    const proposal = findNutritionChangeProposal(snapshot, input.userId, input.artifactId);
    const receiptId = nutritionReceiptId({ userId: input.userId, action: "reject", targetArtifactId: proposal.id, idempotencyKey: input.idempotencyKey });
    const existing = findNutritionReceipt(snapshot, receiptId);
    if (existing) return { status: "idempotent", receipt: existing, card: this.cards.render(existing, "ready") };
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const status = nutritionProposalPresentationStatus(snapshot, proposal, projection);
    if (status === "stale") {
      await this.updateNutritionProposalPresentation({ snapshot, proposal, status: "stale", idempotencyKey: `nutrition-stale:${proposal.id}` });
      throw new Error("nutrition_proposal_stale");
    }
    if (status !== "awaiting_user") throw new Error("nutrition_proposal_not_actionable");
    if (!projection.mandate) throw new Error("nutrition_proposal_stale");
    const now = this.runtime.now();
    const receipt = nutritionActionReceipt({
      id: receiptId,
      now,
      action: "reject",
      result: "rejected",
      targetArtifactId: proposal.id,
      contextRefs: proposal.contextRefs,
      evidenceRefs: proposal.evidenceRefs,
      knowledgePins: proposal.knowledgePins ?? this.knowledge.versionPins(),
    });
    const proposalPresentation = nutritionProposalPresentation(snapshot, proposal.id);
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "nutrition_strategy.proposal.reject",
      expectedRevisions: [
        { kind: "nutrition_strategy", id: proposal.nutritionStrategyId, revision: proposal.baseStrategyRevision },
        { kind: "coaching_mandate", id: projection.mandate.value.id, revision: projection.mandate.revision },
      ],
      domainEvents: [],
      artifacts: [receipt],
      presentations: [
        { ...proposalPresentation, status: "rejected" },
        { id: `presentation-${stableHash({ artifactId: receipt.id, renderer: "action-receipt/v1" })}`, artifactId: receipt.id, renderer: "action-receipt/v1", status: "ready" },
      ],
      actionEvents: [nutritionStrategyActionEvent({
        id: this.runtime.nextId("action"),
        userId: input.userId,
        occurredAt: now,
        actor: "user",
        action: "nutrition.strategy.rejected",
        targetId: proposal.nutritionStrategyId,
        intent: "nutrition_strategy.proposal.reject",
        before: nutritionStrategyActionView(proposal.proposal.before),
        after: nutritionStrategyActionView(proposal.proposal.before),
        evidenceRefs: proposal.evidenceRefs,
        beforeRefs: [{ aggregate: "nutrition", id: proposal.nutritionStrategyId, revision: proposal.baseStrategyRevision }],
        afterRefs: [{ aggregate: "nutrition", id: proposal.nutritionStrategyId, revision: proposal.baseStrategyRevision }],
        mandateRevision: projection.mandate.revision,
        ruleVersions: nutritionRuleVersions(proposal),
        result: "rejected",
        undoBoundary: "not_reversible",
        policyDecision: "allow",
        humanDecision: "rejected",
        causationId: proposal.id,
        correlationId: receipt.id,
        reversible: false,
      })],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return { status: "rejected", receipt, card: this.cards.render(receipt, "ready") };
  }

  async undoNutritionStrategyChangeProposal(input: {
    userId: string;
    receiptArtifactId: string;
    idempotencyKey: string;
    safety: NutritionSafetyScreen;
  }): Promise<NutritionStrategyActionResult> {
    const snapshot = await this.ledger.read();
    const appliedReceipt = findNutritionReceipt(snapshot, input.receiptArtifactId);
    if (!appliedReceipt || appliedReceipt.action !== "apply" || appliedReceipt.result !== "applied") {
      throw new Error("nutrition_receipt_not_undoable");
    }
    const proposal = findNutritionChangeProposal(snapshot, input.userId, appliedReceipt.targetArtifactId);
    const receiptId = nutritionReceiptId({ userId: input.userId, action: "undo", targetArtifactId: appliedReceipt.id, idempotencyKey: input.idempotencyKey });
    const existing = findNutritionReceipt(snapshot, receiptId);
    if (existing) return { status: "idempotent", receipt: existing, card: this.cards.render(existing, "ready") };
    const projection = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    const mandate = projection.mandate;
    const strategy = projection.nutritionStrategies.find((candidate) => candidate.value.id === proposal.nutritionStrategyId);
    if (!mandate || !strategy || mandate.revision !== proposal.mandateRevision || strategy.revision !== appliedReceipt.afterRevision || stableHash(strategy.value) !== stableHash(proposal.proposal.after)) {
      throw new Error("nutrition_proposal_stale");
    }
    const safetyReason = nutritionSafetyBlockReason(
      mergeNutritionSafetyScreens(input.safety, nutritionSafetyScreenFromProjection(projection, this.runtime.now())),
    );
    if (safetyReason) throw new Error(safetyReason);
    const now = this.runtime.now();
    const receipt = nutritionActionReceipt({
      id: receiptId,
      now,
      action: "undo",
      result: "undone",
      targetArtifactId: appliedReceipt.id,
      beforeRevision: strategy.revision,
      afterRevision: strategy.revision + 1,
      contextRefs: proposal.contextRefs,
      evidenceRefs: proposal.evidenceRefs,
      knowledgePins: proposal.knowledgePins ?? this.knowledge.versionPins(),
    });
    const domainEvent = nutritionStrategyRevisionDomainEvent({
      id: this.runtime.nextId("domain-event"),
      userId: input.userId,
      strategy: proposal.proposal.before,
      revision: strategy.revision + 1,
      occurredAt: now,
      recordedAt: now,
      causationId: appliedReceipt.id,
      correlationId: receipt.id,
    });
    const proposalPresentation = nutritionProposalPresentation(snapshot, proposal.id);
    const appliedPresentation = nutritionProposalPresentation(snapshot, appliedReceipt.id);
    const appliedAction = snapshot.actionEvents.find(
      (event) => event.action === "nutrition.strategy.applied" && event.causationId === proposal.id && event.correlationId === appliedReceipt.id,
    );
    const undoActionId = this.runtime.nextId("action");
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "nutrition_strategy.proposal.undo",
      expectedRevisions: [
        { kind: "nutrition_strategy", id: strategy.value.id, revision: strategy.revision },
        { kind: "coaching_mandate", id: mandate.value.id, revision: mandate.revision },
      ],
      domainEvents: [domainEvent],
      outbox: [outboxForDomainEvent(domainEvent)],
      artifacts: [receipt],
      presentations: [
        { ...proposalPresentation, status: "undone" },
        { ...appliedPresentation, status: "undone" },
        { id: `presentation-${stableHash({ artifactId: receipt.id, renderer: "action-receipt/v1" })}`, artifactId: receipt.id, renderer: "action-receipt/v1", status: "ready" },
      ],
      actionEvents: [
        ...(appliedAction ? [{ ...appliedAction, undoneBy: undoActionId }] : []),
        nutritionStrategyActionEvent({
          id: undoActionId,
          userId: input.userId,
          occurredAt: now,
          actor: "user",
          action: "nutrition.strategy.undone",
          targetId: strategy.value.id,
          intent: "nutrition_strategy.proposal.undo",
          before: nutritionStrategyActionView(strategy.value),
          after: nutritionStrategyActionView(proposal.proposal.before),
          evidenceRefs: proposal.evidenceRefs,
          beforeRefs: [{ aggregate: "nutrition", id: strategy.value.id, revision: strategy.revision }],
          afterRefs: [{ aggregate: "nutrition", id: strategy.value.id, revision: strategy.revision + 1 }],
          mandateRevision: mandate.revision,
          ruleVersions: nutritionRuleVersions(proposal),
          result: "undone",
          undoBoundary: "not_reversible",
          policyDecision: "allow",
          humanDecision: "confirmed",
          causationId: appliedReceipt.id,
          correlationId: receipt.id,
          reversible: false,
        }),
      ],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
    return { status: "undone", receipt, card: this.cards.render(receipt, "ready") };
  }

  private async updateNutritionProposalPresentation(input: {
    snapshot: Awaited<ReturnType<CoachLedger["read"]>>;
    proposal: import("./model").NutritionChangeProposalArtifact;
    status: "stale";
    idempotencyKey: string;
  }): Promise<void> {
    const presentation = nutritionProposalPresentation(input.snapshot, input.proposal.id);
    if (presentation.status === input.status) return;
    await this.ledger.commit({
      kind: "domain",
      userId: input.proposal.userId,
      actorId: "nutrition_rule_pack",
      intent: "nutrition_strategy.proposal.stale",
      expectedRevisions: [],
      domainEvents: [],
      presentations: [{ ...presentation, status: input.status }],
      idempotencyKey: input.idempotencyKey,
      recordedAt: this.runtime.now(),
    });
  }

  async commitNutritionStrategy(input: {
    userId: string;
    strategy: import("./domain").NutritionStrategyData;
    expectedRevision?: number;
    idempotencyKey: string;
  }): Promise<DomainCommandResult> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const existing = projection.nutritionStrategies.find((item) => item.value.id === input.strategy.id);
    return this.executeDomainCommand({
      type: "nutrition_strategy.revise",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      nutritionStrategyId: input.strategy.id,
      expectedRevision: input.expectedRevision ?? existing?.revision ?? 0,
      nutritionStrategy: input.strategy,
    });
  }

  async confirmMealObservation(input: {
    userId: string;
    idempotencyKey: string;
    observation: import("../nutrition").MealObservation;
    source?: "manual" | "label" | "import" | "llm_estimate";
    /** Links a confirmed estimate to its immutable, pre-confirmation artifact. */
    draftArtifactId?: string;
  }): Promise<DomainCommandResult> {
    const now = this.runtime.now();
    return this.recordTimelineFact({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      confirmedByUser: true,
      fact: {
        kind: "nutrition",
        observationId: input.observation.id,
        ...(input.observation.mealSlot ? { mealSlot: input.observation.mealSlot } : {}),
        ...(input.observation.foods ? { foods: input.observation.foods } : {}),
        ...(input.observation.energy ? { energy: input.observation.energy } : {}),
        ...(input.observation.proteinGrams !== undefined ? { proteinGrams: input.observation.proteinGrams } : {}),
        ...(input.observation.fatGrams !== undefined ? { fatGrams: input.observation.fatGrams } : {}),
        ...(input.observation.carbohydrateGrams !== undefined ? { carbohydrateGrams: input.observation.carbohydrateGrams } : {}),
        observationMode: input.observation.mode === "estimated" ? "user_confirmed_estimate" : input.observation.mode,
        ...(input.observation.description ? { mealDescription: input.observation.description } : {}),
        ...(input.observation.simplified ? { simplified: input.observation.simplified } : {}),
        ...(input.observation.estimate ? { estimate: input.observation.estimate } : {}),
        confidence: input.observation.provenance === "llm_estimate" ? "estimated" : "confirmed",
      },
      envelope: {
        time: { startedAt: input.observation.occurredAt, timezoneOffsetMinutes: new Date(input.observation.occurredAt).getTimezoneOffset() * -1 },
        provenance: {
          origin: timelineOriginForMeal(input.source ?? input.observation.provenance),
          recordingMethod: input.observation.provenance === "llm_estimate" ? "llm_estimate" : "manual_entry",
          dataStatus: input.observation.provenance === "llm_estimate" ? "estimated" : "available",
          confidence: input.observation.provenance === "llm_estimate" ? "estimated" : "confirmed",
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
    occurredAt: string;
    request: NutritionObservationRequest;
  }): Promise<import("./model").NutritionObservationDraftArtifact> {
    if (!input.request.text?.trim() && !input.request.localMediaRefs?.length) {
      throw new Error("nutrition_observation_input_required");
    }
    const snapshot = await this.ledger.read();
    const existing = snapshot.artifacts.find(
      (artifact): artifact is import("./model").NutritionObservationDraftArtifact =>
        artifact.kind === "nutrition_observation_draft" &&
        artifact.userId === input.userId &&
        artifact.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return existing;
    // A local-only photo is useful as an attachment to a manual record, but
    // must never become an implicit upload or a fabricated estimate. Keep it
    // as a clarification-gated draft and wait for the user's meal details.
    const localOnlyMedia = Boolean(
      input.request.localMediaRefs?.length && input.request.mediaConsent !== "provider_authorized",
    );
    const result = localOnlyMedia
      ? undefined
      : await (async () => {
          const provider = this.nutritionObservation ?? await this.nutritionObservationResolver?.resolve({
            userId: input.userId,
            request: input.request,
          });
          if (!provider) throw new Error("nutrition_observation_provider_unavailable");
          const estimated = await provider.estimate(input.request);
          assertNutritionObservationResult(estimated, input.request);
          return estimated;
        })();
    const now = this.runtime.now();
    const draft: import("../nutrition").NutritionObservationDraft = {
      id: this.runtime.nextId("nutrition-draft"),
      schemaVersion: 1,
      observation: {
        id: this.runtime.nextId("meal-observation"),
        occurredAt: input.occurredAt,
        mode: result ? "estimated" : "simplified",
        ...(input.request.text ? { description: input.request.text } : {}),
        provenance: result ? "llm_estimate" : "manual",
      },
      estimates: result?.candidates ?? [],
      ...(result ? { provider: result.provider } : {}),
      mediaConsent: input.request.mediaConsent,
      ...(result?.redactionManifest?.length ? { redactionManifest: result.redactionManifest } : {}),
      ...(input.request.localMediaRefs ? { inputMediaRefs: [...input.request.localMediaRefs] } : {}),
      generatedAt: now,
      missing: result?.missing ?? ["local_media_requires_user_description"],
      clarificationRequired:
        !result ||
        result.missing.length > 0 ||
        result.candidates.some((candidate) => candidate.confidence === "low"),
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
      contextRefs: [{ kind: "today", ref: input.occurredAt.slice(0, 10) }],
      evidenceRefs: [],
      missingness: result?.missing ?? ["local_media_requires_user_description"],
      capabilityBoundary: ["估算需要用户确认", "未确认内容不会进入 Timeline 或修改营养策略"],
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
          candidateCount: draft.estimates.length,
          provider: draft.provider?.id,
          modelVersion: draft.provider?.modelVersion,
          inputKinds: input.request.inputProvenance ?? defaultNutritionInputKinds(input.request),
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
    /**
     * Editable card input. The immutable Draft remains preserved separately in
     * Timeline provenance; a confirmation is still an estimate, never a
     * nutrition-label or measured record.
     */
    edits?: import("../nutrition").NutritionObservationDraftEdits;
  }): Promise<DomainCommandResult> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find(
      (item): item is import("./model").NutritionObservationDraftArtifact =>
        item.id === input.artifactId && item.kind === "nutrition_observation_draft" && item.userId === input.userId,
    );
    if (!artifact) throw new Error("nutrition_draft_not_found");
    if (artifact.draft.clarificationRequired && !input.observation && !input.edits) throw new Error("nutrition_draft_requires_clarification");
    const edits = input.edits ? normalizeNutritionObservationDraftEdits(input.edits) : undefined;
    const suppliedObservation = input.observation ?? (edits
      ? {
          ...artifact.draft.observation,
          ...(edits.description ? { description: edits.description } : {}),
        }
      : undefined);
    const observation = suppliedObservation ?? artifact.draft.observation;
    const estimated = artifact.draft.observation.provenance === "llm_estimate";
    const confirmedEstimate = estimated
      ? {
          sourceDraftId: artifact.id,
          estimates: artifact.draft.estimates,
          ...(artifact.draft.provider ? { provider: artifact.draft.provider } : {}),
          ...(suppliedObservation ? { userEdited: true } : {}),
          ...(edits ? { userEdits: edits } : {}),
        }
      : undefined;
    return this.confirmMealObservation({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      observation: estimated
        ? { ...observation, mode: "estimated", provenance: "llm_estimate", estimate: confirmedEstimate }
        : observation,
      source: estimated ? "llm_estimate" : observation.provenance,
      draftArtifactId: artifact.id,
    });
  }

  /** Rejecting an estimate is auditable but intentionally writes no nutrition fact. */
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

  async startSession(input: StartSessionInput): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const now = this.runtime.now();
    const existingActive = snapshot.sessions.find(
      (session) => session.userId === input.userId && session.status === "active",
    );
    const suspended = existingActive
      ? {
          ...existingActive,
          status: "suspended" as const,
          revision: (existingActive.revision ?? 1) + 1,
          updatedAt: now,
        }
      : undefined;
    const session: CoachSession = {
      id: this.runtime.nextId("coach-session"),
      userId: input.userId,
      status: "active",
      context: input.context,
      taskKind: input.taskKind ?? taskKindForContext(input.context.kind),
      title: input.title ?? input.context.ref,
      revision: 1,
      contextRefs: [input.context],
      messageIds: [],
      runIds: [],
      toolCallIds: [],
      artifactIds: [],
      presentationIds: [],
      pendingHumanActionIds: [],
      workingMemoryIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.userId,
      actorId: input.userId,
      intent: "coach_session.start",
      expectedRevisions: [],
      expectedSessionRevisions: [
        ...(existingActive ? [{ id: existingActive.id, revision: existingActive.revision ?? 1 }] : []),
        { id: session.id, revision: 0 },
      ],
      domainEvents: [],
      sessions: [...(suspended ? [suspended] : []), session],
      idempotencyKey: input.idempotencyKey ?? `start:${session.id}`,
      recordedAt: now,
    });
    return session;
  }

  async seedUserState(input: SeedUserStateInput): Promise<void> {
    const snapshot = await this.ledger.read();
    await this.ledger.replace(
      upsertUser(snapshot, {
        userId: input.userId,
        profile: input.profile,
        profileRevision: 1,
        plan: {
          ...input.plan,
          knowledgePins: input.plan.knowledgePins ?? this.knowledge.versionPins(),
        },
        timeline: input.timeline ?? [],
        timelineRevision: input.timeline?.length ? 1 : 0,
        mandate: { mode: "collaborative", revision: 1 },
        safetyHold: false,
      }),
    );
  }

  async executeDomainCommand(command: DomainCommand): Promise<DomainCommandResult> {
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
      case "user.bootstrap":
        expectedRevisions = [
          { kind: "user_profile", id: command.profile.id, revision: 0 },
          { kind: "goal_contract", id: command.goalContract.id, revision: 0 },
          { kind: "coaching_mandate", id: command.mandate.id, revision: 0 },
        ];
        events = [
          event({
            name: "user_profile.created",
            aggregate: { kind: "user_profile", id: command.profile.id, revision: 1 },
            payload: command.profile,
          }),
          event({
            name: "goal_contract.created",
            aggregate: { kind: "goal_contract", id: command.goalContract.id, revision: 1 },
            payload: command.goalContract,
          }),
          event({
            name: "coaching_mandate.created",
            aggregate: { kind: "coaching_mandate", id: command.mandate.id, revision: 1 },
            payload: command.mandate,
          }),
        ];
        break;
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
      case "goal_cycle.revise":
        expectedRevisions = [
          {
            kind: "goal_cycle",
            id: command.goalCycleId,
            revision: command.expectedRevision,
          },
        ];
        events = [
          event({
            name: command.expectedRevision === 0 ? "goal_cycle.created" : "goal_cycle.revised",
            aggregate: {
              kind: "goal_cycle",
              id: command.goalCycleId,
              revision: command.expectedRevision + 1,
            },
            payload: command.goalCycle,
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
              ...(command.entry ? { entry: command.entry } : {}),
            },
            evidenceRefs: command.entry?.evidenceRefs,
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
              ...(command.entry ? { entry: command.entry } : {}),
            },
            evidenceRefs: command.entry?.evidenceRefs,
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
            evidenceRefs: command.entry.evidenceRefs,
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
      case "workout.start":
      case "workout.prepare": {
        const snapshot = await this.ledger.read();
        const plan = snapshot.domainEvents.find(
          (candidate) =>
            candidate.name === "plan.revised" &&
            candidate.userId === command.meta.userId &&
            candidate.aggregate.id === command.prescriptionRef.planId &&
            candidate.aggregate.revision === command.prescriptionRef.planRevision,
        );
        if (!plan || plan.name !== "plan.revised") throw new Error("invalid_plan_reference");
        const prescription = plan.payload.sessions.find(
          (session) => session.id === command.prescriptionRef.sessionPrescriptionId,
        );
        if (!prescription) throw new Error("invalid_session_prescription_reference");
        expectedRevisions = [
          {
            kind: "workout_session",
            id: command.workoutId,
            revision: command.expectedRevision,
          },
        ];
        const targetStatus = command.type === "workout.prepare" ? "planned" as const : "active" as const;
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
            reason: command.type === "workout.prepare" ? "prepared" : "started",
            actor: command.meta.actor,
            occurredAt: command.meta.occurredAt,
            idempotencyKey: command.meta.idempotencyKey,
          }],
        } satisfies import("./domain").WorkoutExecutionState;
        events = [
          event({
            name: command.type === "workout.prepare" ? "workout.prepared" : "workout.started",
            aggregate: {
              kind: "workout_session",
              id: command.workoutId,
              revision: command.expectedRevision + 1,
            },
            payload: {
              prescriptionRef: command.prescriptionRef,
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
            evidenceRefs: command.outcome.packetRef
              ? [{ kind: "canonical_packet", ...command.outcome.packetRef }]
              : [],
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
              ...(command.timeline.entry ? { entry: command.timeline.entry } : {}),
            },
            evidenceRefs: command.timeline.entry?.evidenceRefs,
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
      case "aggregate.archive":
      case "aggregate.restore":
        expectedRevisions = [command.aggregateRef];
        events = [
          event({
            name: command.type === "aggregate.archive" ? "aggregate.archived" : "aggregate.restored",
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
                (staleTargetId !== undefined && ref.aggregate === "timeline" && ref.id === staleTargetId) ||
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
      ...(stalePresentations.length ? { presentations: stalePresentations } : {}),
      outbox,
      idempotencyKey: command.meta.idempotencyKey,
      recordedAt,
    });
    await this.dispatchRegisteredReplanForDomainCommand(command, beforeProjection);
    return result;
  }

  /**
   * Platform imports and sync replay use the generic command path too. Keep
   * registered fact triggers here so no screen, chat turn or memory item can
   * invent a new replan cause.
   */
  private async dispatchRegisteredReplanForDomainCommand(
    command: DomainCommand,
    before: DomainProjection,
  ): Promise<void> {
    switch (command.type) {
      case "workout.complete":
        if (command.outcome) {
          const replanKind = await this.evaluateCompletedWorkoutReplan({
            userId: command.meta.userId,
            workoutId: command.workoutId,
            outcome: command.outcome,
          });
          await this.enqueueCompletedWorkoutRecipes({
            userId: command.meta.userId,
            workoutId: command.workoutId,
            outcome: command.outcome,
            replanKind,
            timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
          });
        }
        return;
      case "recovery_constraint.revise":
        await this.evaluateRecoveryConstraintReplan({
          userId: command.meta.userId,
          constraint: command.recoveryConstraint,
        });
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
        await this.evaluatePlanningFactReplan({
          userId: command.meta.userId,
          kind: "goal_contract_revised",
          sourceId: `goal_contract:${command.goalContractId}:${command.expectedRevision + 1}`,
          occurredAt: command.meta.occurredAt,
        });
        return;
      case "equipment_profile.revise":
        await this.evaluatePlanningFactReplan({
          userId: command.meta.userId,
          kind: "equipment_changed",
          sourceId: `equipment_profile:${command.equipmentProfileId}:${command.expectedRevision + 1}`,
          occurredAt: command.meta.occurredAt,
        });
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
        await this.evaluatePlanningFactReplan({
          userId: command.meta.userId,
          kind: "schedule_changed",
          sourceId: `user_profile:${command.profileId}:${command.expectedRevision + 1}`,
          occurredAt: command.meta.occurredAt,
        });
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
        // initial onboarding continues to be deliberately quiet.
        if (command.expectedRevision === 0) return;
        await this.enqueueDefaultRecipe({
          userId: command.meta.userId,
          kind: "today_plan_changed",
          occurredAt: command.meta.occurredAt,
          causationId: `${command.planId}:${command.expectedRevision + 1}`,
          idempotencyKey: `recipe:today_plan_changed:${command.planId}:${command.expectedRevision + 1}`,
          timezoneOffsetMinutes: command.meta.timezoneOffsetMinutes,
        });
        await this.proposeNutritionPlanCoordinationForCommittedPlanRevision({
          userId: command.meta.userId,
          planId: command.planId,
          planRevision: command.expectedRevision + 1,
          occurredAt: command.meta.occurredAt,
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
    replanKind?: Extract<ReplanTrigger["kind"], "session_completed" | "repeated_missed_sessions">;
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
    if (input.replanKind === "repeated_missed_sessions") {
      await this.enqueueDefaultRecipe({
        ...common,
        kind: "missed_session_review",
        idempotencyKey: `recipe:repeated_missed:${input.workoutId}:${input.outcome.completedAt}`,
      });
    }
  }

  /**
   * A real later PlanRevision can make the stored training/rest/Deload day
   * labels stale. Re-evaluate that mapping only from the committed local plan
   * and only for an active strategy linked to the same goal. This creates a
   * normal NutritionChangeProposal card; it never writes a strategy, energy
   * target or historical intake by itself.
   *
   * It deliberately runs after the plan transaction. A scheduling/proposal
   * failure therefore cannot roll back a valid PlanRevision, and replay uses a
   * stable revision-scoped key to repair the best-effort follow-up safely.
   */
  private async proposeNutritionPlanCoordinationForCommittedPlanRevision(input: {
    userId: string;
    planId: string;
    planRevision: number;
    occurredAt: string;
    timezoneOffsetMinutes: number;
  }): Promise<void> {
    try {
      const projection = await this.readDomainProjection({ userId: input.userId });
      const plan = projection.plan;
      if (!plan || plan.value.id !== input.planId || plan.revision !== input.planRevision) return;
      const currentDate = localDateAtTimezoneOffset(input.occurredAt, input.timezoneOffsetMinutes);
      const strategies = projection.nutritionStrategies.filter((strategy) =>
        (strategy.value.status === undefined || strategy.value.status === "active") &&
        strategy.value.goalContractRef.id === plan.value.goalContractRef.id &&
        (!strategy.value.goalCycleRef || (
          plan.value.goalCycleRef !== undefined &&
          strategy.value.goalCycleRef.id === plan.value.goalCycleRef.id
        )),
      );
      for (const strategy of strategies) {
        await this.proposeNutritionPlanCoordinationArtifact({
          userId: input.userId,
          nutritionStrategyId: strategy.value.id,
          currentDate,
          idempotencyKey: `nutrition-plan-revision:${plan.value.id}:${plan.revision}:${strategy.value.id}:${strategy.revision}`,
        });
      }
    } catch {
      // This is a local, best-effort card generation follow-up. A later
      // foreground/read replay can repeat the same revision-scoped request;
      // the confirmation boundary is enforced by the proposal action itself.
    }
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

  private async evaluatePlanningFactReplan(input: {
    userId: string;
    kind: Extract<ReplanTrigger["kind"], "goal_contract_revised" | "equipment_changed" | "schedule_changed">;
    sourceId: string;
    occurredAt: string;
  }): Promise<void> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    if (!projection.profile || !projection.goalContract || !projection.mandate) return;
    const currentDate = input.occurredAt.slice(0, 10);
    const window = localCalendarWeek(currentDate);
    if (!window) return;
    await this.evaluateLocalReplan({
      userId: input.userId,
      currentDate,
      trigger: {
        id: `planning-fact:${input.kind}:${input.sourceId}`,
        kind: input.kind,
        actor: "rule_engine",
        occurredAt: input.occurredAt,
        causationId: input.sourceId,
        idempotencyKey: `replan:${input.kind}:${input.sourceId}`,
      },
      window,
    });
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
    const sessionIds = new Set(
      snapshot.sessions
        .filter((session) => session.userId === input.userId)
        .map((session) => session.id),
    );
    const artifactIds = new Set(
      snapshot.runEvents
        .filter((event) => sessionIds.has(event.sessionId))
        .filter((event): event is Extract<import("./model").CoachRunEvent, { type: "artifact-ready" }> => event.type === "artifact-ready")
        .map((event) => event.artifactRef.id),
    );
    // Period reports are durable progress projections, not merely transient
    // chat presentations. They remain discoverable after their originating
    // CoachSession has been archived or when a local recipe created them.
    const durableProgressArtifactIds = new Set(
      snapshot.artifacts
        .filter((artifact): artifact is Extract<import("./model").Artifact, { kind: "weekly_coach_report" | "replan_evaluation" | "goal_forecast" | "mesocycle_review" }> =>
          artifact.kind === "weekly_coach_report" ||
          artifact.kind === "replan_evaluation" ||
          artifact.kind === "goal_forecast" ||
          artifact.kind === "mesocycle_review",
        )
        .filter((artifact) => artifact.userId === input.userId)
        .map((artifact) => artifact.id),
    );
    const planningPreviewArtifactIds = new Set(
      snapshot.artifacts
        .filter((artifact): artifact is EvidenceBriefArtifact =>
          artifact.kind === "evidence_brief" &&
          artifact.userId === input.userId &&
          Boolean(artifact.planningPreview),
        )
        .map((artifact) => artifact.id),
    );
    const customExerciseNames = new Map(
      domain.customExercises.map((exercise) => [exercise.value.id, exercise.value.name]),
    );
    return buildCoachProductProjection({
      domain,
      date: input.date,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      calendarMode: input.calendarMode,
      calendarAnchorDate: input.calendarAnchorDate,
      actions: snapshot.actionEvents.filter((event) => event.userId === input.userId),
      pendingHumanActions: snapshot.pendingHumanActions.filter((item) => item.userId === input.userId),
      artifacts: snapshot.artifacts.filter(
        (artifact) => artifactIds.has(artifact.id) || durableProgressArtifactIds.has(artifact.id) || planningPreviewArtifactIds.has(artifact.id),
      ),
      healthImportStates: snapshot.healthImportStates.filter((state) => state.userId === input.userId),
      exerciseLabel: (exerciseVariantId) =>
        customExerciseNames.get(exerciseVariantId) ??
        this.knowledge.exerciseVariant(exerciseVariantId)?.displayName.zh ??
        exerciseVariantId,
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
    if (
      input.enabled &&
      workout.state.currentSetId &&
      workout.drafts.some((draft) => draft.prescriptionSetId === workout.state.currentSetId)
    ) {
      throw new Error("current_set_draft_requires_completion_or_retraction");
    }
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
   * Opens the one task-scoped CoachSession for an in-progress WorkoutSession.
   *
   * This is deliberately separate from a generic chat start: record-only and
   * monitor mode are two views over one execution aggregate, so they must
   * resume the same Coach context rather than create a parallel conversation
   * whenever the user opens the training bubble. A completed workout is no
   * longer an execution workspace and therefore cannot be reopened here.
   */
  async ensureWorkoutCoachSession(input: {
    userId: string;
    workoutId: string;
    /** Retained at the public command boundary for caller-level operation identity. */
    idempotencyKey: string;
  }): Promise<CoachSession> {
    const workout = await this.requireWorkoutProjection(input.userId, input.workoutId);
    if (workout.status !== "active" && workout.status !== "paused") {
      throw new Error("workout_not_coachable");
    }
    const snapshot = await this.ledger.read();
    const existing = snapshot.sessions.find(
      (session) =>
        session.userId === input.userId &&
        session.taskKind === "workout_execution" &&
        session.context.kind === "workout" &&
        session.context.ref === input.workoutId &&
        session.status !== "completed" &&
        session.status !== "archived",
    );
    if (existing?.status === "active") return existing;
    if (existing) return this.setSessionStatus(existing.id, "active");
    return this.startSession({
      userId: input.userId,
      context: { kind: "workout", ref: input.workoutId },
      taskKind: "workout_execution",
      title: workout.frozenPrescription.title,
      idempotencyKey: `workout-coach:${input.idempotencyKey}`,
    });
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
    packetRef?: { id: string; version: number; hash: string };
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
        ...(input.packetRef ? { packetRef: input.packetRef } : {}),
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
    } else if (input.change.kind === "replace_task_exercise") {
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

  /**
   * Read-only, deterministic assessment at the boundary after a confirmed
   * set.  It returns no card-worthy diff unless the installed RulePack has a
   * concrete next-unstarted-set edit based on user-confirmed performance.
   */
  async recommendNextWorkoutSet(input: {
    userId: string;
    workoutId: string;
    sourceOutcomeId?: string;
  }): Promise<import("../workout").WorkoutNextSetRecommendation> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    const workout = projection.workouts.find((candidate) => candidate.id === input.workoutId);
    if (!workout) throw new Error("workout_session_not_found");
    const evaluatedAt = this.runtime.now();
    const source = input.sourceOutcomeId
      ? workout.setOutcomes.find((outcome) => outcome.id === input.sourceOutcomeId)
      : workout.setOutcomes.at(-1);
    const target = source ? findWorkoutPrescriptionSet(workout.frozenPrescription, source.prescriptionSetId) : undefined;
    const next = nextUnperformedSet(workout);
    const finalize = async (recommendation: import("../workout").WorkoutNextSetRecommendation) => {
      await this.recordNextSetRuleAssessment({
        recommendation,
        mandateRevision: projection.mandate?.revision ?? 0,
        evaluatedAt,
      });
      return recommendation;
    };
    const unavailable = (reason: string) => toNextSetRecommendation({
      userId: input.userId,
      workoutId: input.workoutId,
      baseWorkoutRevision: workout.revision,
      sourceOutcomeId: source?.id ?? "missing",
      sourceExerciseVariantId: target?.task.exerciseVariantId ?? "unknown",
      ...(next ? { next: { task: next.task, set: next.set } } : {}),
      decision: unavailableWorkoutRuleDecision(reason),
    });
    if (!source || !target || !next) return finalize(unavailable(!source ? "confirmed_set_outcome_required" : "no_unstarted_set"));
    if (!projection.goalContract || !projection.mandate) return finalize(unavailable("active_goal_and_mandate_required"));
    if (!target.set.targetReps || target.set.targetRir === undefined) {
      return finalize(unavailable("rep_target_and_target_rir_required_for_next_set_progression"));
    }
    const variant = this.knowledge.exerciseVariant(target.task.exerciseVariantId);
    if (!variant) return finalize(unavailable("exact_catalog_variant_required"));
    const prescriptionMode = target.task.mode ?? (
      variant.identity.loadMeasurement === "bodyweight_node" ? "bodyweight_reps" : "weighted_reps"
    );
    if (prescriptionMode !== "weighted_reps" && prescriptionMode !== "bodyweight_reps") {
      return finalize(unavailable("next_set_progression_not_available_for_this_prescription_mode"));
    }
    const now = evaluatedAt;
    const comparableContext = {
      exerciseVariantId: target.task.exerciseVariantId,
      performanceIdentity: variant.performanceIdentity,
      equipmentId: variant.identity.equipmentConfiguration,
      loadMode: variant.identity.loadMode,
      setup: variant.identity.setup,
      rom: variant.identity.romContext,
      prescriptionMode,
      setContext: "working" as const,
    };
    const recentSessions = comparableWorkoutSessions({
      workouts: projection.workouts,
      currentWorkoutId: workout.id,
      currentOutcome: source,
      comparableContext,
      currentAt: now,
      currentWorkoutRevision: workout.revision,
    });
    const recovery = activeRecoveryConstraint(projection.recoveryConstraints, now);
    const context: RuleEvaluationContext = {
      schemaVersion: 1,
      userId: input.userId,
      goal: projection.goalContract.value.primaryGoal,
      comparableContext,
      prescription: {
        ...(target.set.targetLoad ? { load: target.set.targetLoad } : {}),
        repRange: target.set.targetReps,
        targetRir: target.set.targetRirRange ?? { min: target.set.targetRir, max: target.set.targetRir },
        setCount: target.task.sets.length,
      },
      recentSessions,
      equipment: { availableLoads: availableWorkoutLoads(projection, target.set, next.set) },
      recoveryConstraint: recovery,
      safetyConstraints: projection.safetyConstraints.filter((constraint) => !constraint.value.validUntil || constraint.value.validUntil >= now).map((constraint) => constraint.value),
      supportSignals: [],
      plannedRecoveryWindow: false,
      mandate: projection.mandate.value,
      locks: activeWorkoutLocks(projection.mandate.value, now),
      boundary: "between_sets",
      stableHistory: recentSessions.filter((session) => !session.partial).length >= 2,
      explicitLowRirPreference: false,
      exerciseCanSafelyStop: false,
    };
    return finalize(toNextSetRecommendation({
      userId: input.userId,
      workoutId: input.workoutId,
      baseWorkoutRevision: workout.revision,
      sourceOutcomeId: source.id,
      sourceExerciseVariantId: target.task.exerciseVariantId,
      next: { task: next.task, set: next.set },
      decision: this.trainingRules.evaluate(context),
    }));
  }

  /** A recommendation is immutable evidence; application fails closed when its frontier moved. */
  async applyNextWorkoutSetRecommendation(input: {
    recommendation: import("../workout").WorkoutNextSetRecommendation;
    idempotencyKey: string;
  }): Promise<import("./domain").WorkoutProjection> {
    if (input.recommendation.status !== "proposal" || !input.recommendation.change) {
      throw new Error("next_set_recommendation_not_applicable");
    }
    const workout = await this.requireWorkoutProjection(input.recommendation.userId, input.recommendation.workoutId);
    if (workout.revision !== input.recommendation.baseWorkoutRevision) {
      throw new Error("stale_next_set_recommendation");
    }
    return this.editUpcomingWorkoutPlan({
      userId: input.recommendation.userId,
      workoutId: input.recommendation.workoutId,
      change: input.recommendation.change,
      reason: `rulepack_${input.recommendation.decision.rule.id}_${input.recommendation.decision.decision}`,
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
      await this.notifications.schedule({
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
      if (this.notifications.upsert) await this.notifications.upsert(notification);
      else await this.notifications.schedule(notification);
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
      const replanKind = await this.evaluateCompletedWorkoutReplan({
        userId: input.userId,
        workoutId: input.workoutId,
        outcome: workout.outcome,
      });
      await this.enqueueCompletedWorkoutRecipes({
        userId: input.userId,
        workoutId: input.workoutId,
        outcome: workout.outcome,
        replanKind,
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
          evidenceRefs: outcome.motionPacketRefs.map((packet) => ({ kind: "canonical_packet" as const, ...packet })),
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

  /**
   * A sealed WorkoutSession is one of the registered fact triggers. It runs
   * after the outcome + Timeline commit so the forecast has a true performed
   * frontier. Replaying the completion reuses the same idempotency key, which
   * also repairs the narrow crash window between those two local commits.
   */
  private async evaluateCompletedWorkoutReplan(input: {
    userId: string;
    workoutId: string;
    outcome: import("./domain").SessionOutcomeData;
  }): Promise<Extract<ReplanTrigger["kind"], "session_completed" | "repeated_missed_sessions"> | undefined> {
    const projection = await this.readDomainProjection({ userId: input.userId });
    if (!projection.profile || !projection.goalContract || !projection.mandate) return undefined;
    const currentDate = input.outcome.completedAt.slice(0, 10);
    const window = localCalendarWeek(currentDate);
    if (!window) return undefined;
    const missedSessionDates = recentPartialWorkoutDates(
      projection.workouts,
      input.outcome.completedAt,
      projection.plan,
    );
    const activeGoalCycle = projection.goalCycles
      .filter((cycle) => cycle.value.goalContractRef.id === projection.goalContract?.value.id)
      .sort((left, right) => right.revision - left.revision)[0];
    const repeatThreshold = activeGoalCycle?.value.reviewCadence?.midCycleRequiresConsecutiveDeviation ?? 2;
    const repeatedMiss = input.outcome.status !== "completed" && missedSessionDates.length >= repeatThreshold;
    const triggerKind: ReplanTrigger["kind"] = repeatedMiss ? "repeated_missed_sessions" : "session_completed";
    await this.evaluateLocalReplan({
      userId: input.userId,
      currentDate,
      trigger: {
        id: `workout-completed:${input.workoutId}:${input.outcome.completedAt}`,
        kind: triggerKind,
        actor: "rule_engine",
        occurredAt: input.outcome.completedAt,
        causationId: input.workoutId,
        idempotencyKey: `replan:${triggerKind}:${input.workoutId}:${input.outcome.completedAt}`,
      },
      window,
      ...(repeatedMiss
        ? {
            consecutiveDeviationCount: missedSessionDates.length,
            missedSessionDates,
          }
        : {}),
    });
    return triggerKind;
  }

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

  private async recordNextSetRuleAssessment(input: {
    recommendation: import("../workout").WorkoutNextSetRecommendation;
    mandateRevision: number;
    evaluatedAt: string;
  }): Promise<void> {
    const { recommendation } = input;
    await this.ledger.commit({
      kind: "domain",
      userId: recommendation.userId,
      actorId: "rule_engine",
      intent: "workout.next_set_rule_assessment",
      expectedRevisions: [],
      domainEvents: [],
      actionEvents: [{
        id: this.runtime.nextId("action"),
        userId: recommendation.userId,
        occurredAt: input.evaluatedAt,
        actor: "rule_engine",
        action: "assessment.created",
        targetType: "workout",
        targetId: recommendation.workoutId,
        scope: "next_unstarted_set",
        intent: "workout.next_set_rule_assessment",
        beforeRevision: recommendation.baseWorkoutRevision,
        afterRevision: recommendation.baseWorkoutRevision,
        before: { sourceOutcomeId: recommendation.sourceOutcomeId },
        after: {
          status: recommendation.status,
          nextSetId: recommendation.nextSetId,
          decision: recommendation.decision.decision,
          reasonCodes: recommendation.decision.reasonCodes,
          ...(recommendation.change ? { change: recommendation.change } : {}),
        },
        evidenceRefs: recommendation.decision.evidenceRefs,
        beforeRefs: recommendation.decision.evidenceRefs,
        afterRefs: recommendation.decision.evidenceRefs,
        ruleVersions: {
          training_rule: `${recommendation.decision.rule.id}@${recommendation.decision.rule.semanticVersion}#${recommendation.decision.rule.contentHash}`,
        },
        mandateRevision: input.mandateRevision,
        result: "allowed",
        undoBoundary: "not_applicable",
        policyDecision: recommendation.decision.requiresConfirmation ? "require_confirmation" : "allow",
        causationId: recommendation.sourceOutcomeId,
        correlationId: `next-set:${recommendation.workoutId}:${recommendation.sourceOutcomeId}`,
        reversible: false,
      }],
      idempotencyKey: `next-set-assessment:${recommendation.workoutId}:${recommendation.sourceOutcomeId}:${recommendation.baseWorkoutRevision}`,
      recordedAt: input.evaluatedAt,
    });
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
        media: evidence.filter((ref) => ref.kind === "media").length,
        disposition: evidence.length ? "retained" : "not_present",
      },
    };
  }

  startOnboarding(input: { userId: string; depth: "basic" | "professional" }) {
    return this.onboarding.start(input);
  }

  saveOnboardingProgress(input: {
    draftId: string;
    inputMode: "form" | "conversation";
    patch: OnboardingPatch;
    confirmedSections: readonly OnboardingSection[];
    idempotencyKey: string;
  }) {
    return this.onboarding.save(input);
  }

  readOnboardingProgress(draftId: string) {
    return this.onboarding.read(draftId);
  }

  completeOnboarding(input: { draftId: string; idempotencyKey: string }) {
    return this.onboarding.complete(input);
  }

  /**
   * Runs only Ledger-backed onboarding writes against a private staging copy.
   * The caller may send `domain` to the cloud and invoke `commit` only after
   * the canonical server ACK; a concurrent local writer makes commit fail CAS.
   */
  async stageOnboardingMutation<T>(input: {
    userId: string;
    mutate(application: StagedOnboardingApplication): Promise<T>;
  }): Promise<StagedOnboardingMutation<T>> {
    const before = await this.ledger.read();
    const stagedLedger = new InMemoryCoachLedger(before);
    const stagedApplication = new CoachApplication({
      ...this.dependencies,
      ledger: stagedLedger,
    });
    const value = await input.mutate(stagedApplication);
    const domain = await stagedApplication.readDomainProjection({ userId: input.userId });
    const nextSnapshot = await stagedLedger.read();
    const expectedSnapshotHash = stableHash(before);
    let committed = false;
    return {
      value,
      domain,
      commit: async () => {
        if (committed) return;
        await this.ledger.swapRestoredSnapshot({ expectedSnapshotHash, nextSnapshot });
        committed = true;
      },
    };
  }

  async evaluateOnboardingPolicy(userId: string) {
    const projection = await this.readDomainProjection({ userId });
    if (!projection.profile || !projection.mandate) {
      throw new Error(`Onboarding facts are incomplete: ${userId}`);
    }
    return evaluateOnboardingPolicy({
      profile: projection.profile.value,
      mandate: projection.mandate.value,
      safety: projection.safetyConstraints.map((item) => item.value),
    });
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

  async setOnboardingAggregateArchivedFromSettings(input: {
    userId: string;
    aggregate: import("./domain").DomainAggregateRef;
    archived: boolean;
    reason?: string;
    authorization: import("./domain").LocalSettingsAuthorization;
    idempotencyKey: string;
  }) {
    assertLocalSettingsAuthorization(input.authorization);
    return this.executeDomainCommand({
      type: input.archived ? "aggregate.archive" : "aggregate.restore",
      meta: settingsCommandMeta(input.userId, input.idempotencyKey, this.runtime.now()),
      aggregateRef: input.aggregate,
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
      type: input.archived ? "aggregate.archive" : "aggregate.restore",
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

  async showTodayPlan(
    input: { sessionId: string; date: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowTodayPlanResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((item) => item.id === input.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${input.sessionId}`);
    const user = snapshot.users.find((item) => item.userId === session.userId)
      ?? todayPlanUserFromDomain(
        snapshot,
        session.userId,
        input.date,
        (exerciseVariantId) => this.knowledge.exerciseVariant(exerciseVariantId)?.displayName.zh ?? exerciseVariantId,
      );
    if (!user) throw new Error(`User facts not found: ${session.userId}`);
    const now = this.runtime.now();
    const runId = execution?.runId ?? this.runtime.nextId("coach-run");
    const toolCallId = execution?.toolCallId ?? this.runtime.nextId("tool-call");
    const presentationId = this.runtime.nextId("presentation");
    const artifact = decideTodayPlan({
      artifactId: this.runtime.nextId("artifact"),
      createdAt: now,
      date: input.date,
      context: session.context,
      user,
      knowledgePins: this.knowledge.versionPins(),
    });
    const presentation = {
      id: presentationId,
      artifactId: artifact.id,
      renderer: "today-plan/v1",
      status: "ready" as const,
    };
    const events = [
      {
        type: "tool-started" as const,
        sessionId: session.id,
        runId,
        toolCallId,
        toolName: "plan.show_today",
        presentationId,
        occurredAt: now,
      },
      {
        type: "artifact-ready" as const,
        sessionId: session.id,
        runId,
        toolCallId,
        artifactRef: {
          id: artifact.id,
          kind: artifact.kind,
          schemaVersion: artifact.schemaVersion,
          hash: artifact.hash,
        },
        presentation,
        occurredAt: now,
      },
    ];
    const updatedSession = {
      ...session,
      revision: (session.revision ?? 1) + 1,
      runIds: [...new Set([...(session.runIds ?? []), runId])],
      toolCallIds: [...new Set([...(session.toolCallIds ?? []), toolCallId])],
      artifactIds: [...new Set([...(session.artifactIds ?? []), artifact.id])],
      presentationIds: [...new Set([...(session.presentationIds ?? []), presentation.id])],
      updatedAt: now,
    };
    const ruleVersions = knowledgeRuleVersions(artifact.knowledgePins);
    await this.ledger.commit({
      kind: "domain",
      userId: user.userId,
      actorId: "coach_kernel",
      intent: "today_plan.assess",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      domainEvents: [],
      sessions: [updatedSession],
      artifacts: [artifact],
      presentations: [presentation],
      runEvents: events,
      actionEvents: [
        {
          id: this.runtime.nextId("action"),
          userId: user.userId,
          occurredAt: now,
          actor: "agent",
          action: "context.read",
          targetType: "session",
          targetId: session.id,
          scope: `today:${input.date}`,
          intent: "assemble_today_plan_context",
          before: {},
          after: {},
          evidenceRefs: artifact.evidenceRefs,
          beforeRefs: artifact.evidenceRefs,
          afterRefs: artifact.evidenceRefs,
          ruleVersions,
          mandateRevision: user.mandate.revision,
          result: "allowed",
          undoBoundary: "not_applicable",
          sessionId: session.id,
          runId,
          toolCallId,
          policyDecision: "allow",
          causationId: toolCallId,
          correlationId: session.id,
          reversible: false,
        },
        {
          id: this.runtime.nextId("action"),
          userId: user.userId,
          occurredAt: now,
          actor: "rule_engine",
          action: "assessment.created",
          targetType: "plan",
          targetId: user.userId,
          scope: `today:${input.date}`,
          intent: "present_today_plan",
          beforeRevision: user.plan.revision,
          afterRevision: user.plan.revision,
          before: {},
          after: { artifactId: artifact.id },
          evidenceRefs: artifact.evidenceRefs,
          beforeRefs: artifact.evidenceRefs,
          afterRefs: artifact.evidenceRefs,
          ruleVersions,
          mandateRevision: user.mandate.revision,
          result: "allowed",
          undoBoundary: "not_applicable",
          sessionId: session.id,
          runId,
          toolCallId,
          policyDecision: "allow",
          causationId: toolCallId,
          correlationId: session.id,
          reversible: false,
        },
      ],
      idempotencyKey: `today-plan:${artifact.id}`,
      recordedAt: now,
    });
    return { artifact, card: this.cards.render(artifact, "ready"), events };
  }

  runtimeStatus(): {
    mode: "local-only" | "remote-provider";
    remoteProviderRequests: number;
  } {
    return this.agentRuntime.status();
  }

  proposePlanChange(input: ProposePlanChangeInput): Promise<PlanChangeProposalResult> {
    return this.actions.proposePlanChange(input);
  }

  inspectArtifact(artifactId: string) {
    return this.actions.inspectArtifact(artifactId);
  }

  recomputePlanChange(input: { sessionId: string; staleArtifactId: string }) {
    return this.actions.recomputePlanChange(input);
  }

  actOnArtifact(input: {
    sessionId: string;
    artifactId: string;
    action: "apply" | "reject";
    actionToken: string;
    idempotencyKey: string;
  }): Promise<ArtifactActionResult> {
    return input.action === "reject" ? this.actions.reject(input) : this.actions.apply(input);
  }

  undoPlanChange(input: {
    sessionId: string;
    receiptArtifactId: string;
    actionToken: string;
    idempotencyKey: string;
  }): Promise<UndoActionResult> {
    return this.actions.undo(input);
  }

  /**
   * UI-facing card action seam. The UI deliberately never receives or stores
   * an ActionToken: this facade resolves one scoped to the current local user,
   * then delegates to ActionBroker (or the nutrition confirmation use case).
   */
  async invokeArtifactCardAction(input: {
    userId: string;
    artifactId: string;
    action: "apply" | "reject" | "undo" | "confirm";
    idempotencyKey: string;
  }): Promise<ArtifactActionResult | UndoActionResult | DomainCommandResult | NutritionStrategyActionResult> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate) => candidate.id === input.artifactId);
    if (!artifact) throw new Error("artifact_not_found");
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
    if (artifact.kind === "nutrition_change_proposal") {
      if (input.action === "apply" || input.action === "confirm") {
        return this.applyNutritionStrategyChangeProposal({
          userId: input.userId,
          artifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
          safety: nutritionSafetyScreenFromProjection(await this.readDomainProjection({ userId: input.userId }), this.runtime.now()),
        });
      }
      if (input.action === "reject") {
        return this.rejectNutritionStrategyChangeProposal({
          userId: input.userId,
          artifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
        });
      }
      throw new Error("artifact_action_not_supported");
    }
    if (artifact.kind === "action_receipt" && input.action === "undo") {
      const target = snapshot.artifacts.find((candidate) => candidate.id === artifact.targetArtifactId);
      if (target?.kind === "nutrition_change_proposal" && target.userId === input.userId) {
        return this.undoNutritionStrategyChangeProposal({
          userId: input.userId,
          receiptArtifactId: artifact.id,
          idempotencyKey: input.idempotencyKey,
          safety: nutritionSafetyScreenFromProjection(await this.readDomainProjection({ userId: input.userId }), this.runtime.now()),
        });
      }
    }
    const expectedAction = input.action === "confirm" ? undefined : input.action;
    const token = snapshot.actionTokens.find(
      (candidate) =>
        candidate.userId === input.userId &&
        candidate.artifactId === artifact.id &&
        candidate.action === expectedAction &&
        !candidate.consumedAt,
    );
    if (!token) throw new Error("artifact_action_unavailable");
    const session = snapshot.sessions.find(
      (candidate) => candidate.id === token.sessionId && candidate.userId === input.userId,
    );
    if (!session) throw new Error("artifact_action_session_mismatch");
    if (input.action === "undo") {
      return this.undoPlanChange({
        sessionId: session.id,
        receiptArtifactId: artifact.id,
        actionToken: token.token,
        idempotencyKey: input.idempotencyKey,
      });
    }
    if (input.action === "apply" || input.action === "reject") {
      return this.actOnArtifact({
        sessionId: session.id,
        artifactId: artifact.id,
        action: input.action,
        actionToken: token.token,
        idempotencyKey: input.idempotencyKey,
      });
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
    /** Required for an LLM-derived food estimate; text alone is never a fact. */
    confirmedByUser?: boolean;
    /** Canonical packet ingestion is a deterministic, not conversational, source. */
    deterministicTool?: "canonical_motion_packet";
  }): Promise<DomainCommandResult> {
    if (!factHasNoCompletedClaim(input.fact)) throw new Error("timeline_fact_must_be_an_experience");
    const requestedActor = input.actor ?? { kind: "user" as const, id: input.userId };
    const actor =
      (requestedActor.kind === "agent" || requestedActor.kind === "rule_engine") && input.confirmedByUser
        ? ({ kind: "user" as const, id: input.userId })
        : requestedActor;
    const origin = input.envelope.provenance.origin;
    if (origin === "llm_estimate" && !input.confirmedByUser) {
      throw new Error("user_confirmation_required_for_llm_estimate");
    }
    if (
      (actor.kind === "agent" || actor.kind === "rule_engine") &&
      !input.confirmedByUser &&
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
        ...((actor !== requestedActor) ? [`confirmed_by:${input.userId}`, `proposed_by:${requestedActor.kind}:${requestedActor.id}`] : []),
      ],
      time: { ...input.envelope.time },
    };
    const projection = await this.readDomainProjection({ userId: input.userId });
    const exactDuplicate = projection.timeline.events.find(
      (event) =>
        event.envelope &&
        timelineSourceIdentity(event.envelope) === timelineSourceIdentity(entry) &&
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
      ? projection.timeline.events.find((event) => sameExternalSource(event.envelope, entry))
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
        const actor = source.envelope?.actor ?? { kind: "sync" as const, id: "timeline-import" };
        const meta = {
          userId: input.userId,
          actor,
          deviceId: input.deviceId ?? source.envelope?.provenance.deviceId ?? "timeline-import",
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
            ...(source.envelope ? { entry: source.envelope } : {}),
          });
        } else if (source.sourceMutationOfEventId) {
          if (!source.envelope) throw new Error("timeline_import_mutation_requires_envelope");
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
            ...(source.envelope ? { entry: source.envelope } : {}),
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
        .filter((artifact) => artifact.evidenceRefs.some((ref) => ref.aggregate === "timeline" && ref.id === input.timelineEventId))
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

  /** A stale fact never silently regenerates advice. The caller explicitly asks for a new result. */
  async recomputeTimelineDependent(input: {
    userId: string;
    sessionId: string;
    staleArtifactId: string;
  }): Promise<
    | { status: "recomputed"; artifact: import("./model").PlanChangeProposalArtifact; actionToken: string }
    | { status: "requires_new_coach_turn"; reason: "artifact_not_recomputable" | "artifact_not_stale" }
  > {
    const inspected = await this.inspectArtifact(input.staleArtifactId);
    if (inspected.status !== "stale") return { status: "requires_new_coach_turn", reason: "artifact_not_stale" };
    if (inspected.artifact.kind !== "plan_change_proposal") {
      return { status: "requires_new_coach_turn", reason: "artifact_not_recomputable" };
    }
    const result = await this.recomputePlanChange({
      sessionId: input.sessionId,
      staleArtifactId: input.staleArtifactId,
    });
    return { status: "recomputed", artifact: result.artifact, actionToken: result.actionToken };
  }

  async readUserProjection(userId: string): Promise<{
    plan: PlanRevision;
    actionLog: readonly import("./model").ActionEvent[];
  }> {
    const snapshot = await this.ledger.read();
    const user = snapshot.users.find((candidate) => candidate.userId === userId);
    if (!user) throw new Error(`User facts not found: ${userId}`);
    return {
      plan: user.plan,
      actionLog: snapshot.actionEvents.filter(
        (event) => event.userId === userId && event.action.startsWith("plan.change."),
      ),
    };
  }

  async readSession(sessionId: string): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    return session;
  }

  async readSessionProjection(sessionId: string): Promise<{
    session: CoachSession;
    messages: readonly import("./model").CoachMessage[];
    runs: readonly import("./model").CoachRunRecord[];
    toolCalls: readonly import("./model").CoachToolCallRecord[];
    artifacts: readonly import("./model").Artifact[];
    workingMemory: readonly import("./model").WorkingMemoryItem[];
    runEvents: readonly import("./model").CoachRunEvent[];
    presentations: readonly import("./model").PresentationRef[];
    pendingHumanActions: readonly import("./model").PendingHumanAction[];
  }> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    const artifactIds = new Set(
      snapshot.runEvents
        .filter(
          (event): event is Extract<import("./model").CoachRunEvent, { type: "artifact-ready" | "action-receipt" }> =>
            event.sessionId === sessionId && (event.type === "artifact-ready" || event.type === "action-receipt"),
        )
        .map((event) => event.artifactRef.id),
    );
    return {
      session,
      messages: snapshot.messages.filter((item) => item.sessionId === sessionId),
      runs: snapshot.runs.filter((item) => item.sessionId === sessionId),
      toolCalls: snapshot.toolCalls.filter((item) => item.sessionId === sessionId),
      artifacts: snapshot.artifacts.filter((item) => artifactIds.has(item.id)),
      workingMemory: snapshot.workingMemory.filter(
        (item) => item.provenance.sessionId === sessionId,
      ),
      runEvents: snapshot.runEvents.filter((event) => event.sessionId === sessionId),
      presentations: snapshot.presentations.filter((item) => artifactIds.has(item.artifactId)),
      pendingHumanActions: snapshot.pendingHumanActions.filter(
        (pending) => pending.sessionId === sessionId,
      ),
    };
  }

  async setSessionStatus(
    sessionId: string,
    status: CoachSession["status"],
  ): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    const now = this.runtime.now();
    const updated = {
      ...session,
      status,
      revision: (session.revision ?? 1) + 1,
      updatedAt: now,
    };
    const sessions = snapshot.sessions.map((candidate) => {
      if (candidate.id === session.id) return updated;
      if (status === "active" && candidate.userId === session.userId && candidate.status === "active") {
        return {
          ...candidate,
          status: "suspended" as const,
          revision: (candidate.revision ?? 1) + 1,
          updatedAt: now,
        };
      }
      return candidate;
    }).filter((candidate) =>
      candidate.id === session.id ||
      (status === "active" && candidate.userId === session.userId && candidate.status === "suspended" &&
        snapshot.sessions.find((source) => source.id === candidate.id)?.status === "active"),
    );
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: session.userId,
      intent: `coach_session.${status}`,
      expectedRevisions: [],
      expectedSessionRevisions: sessions.map((candidate) => ({
        id: candidate.id,
        revision: (candidate.revision ?? 1) - 1,
      })),
      domainEvents: [],
      sessions,
      idempotencyKey: `${session.id}:${status}:${session.revision ?? 1}`,
      recordedAt: now,
    });
    return updated;
  }

  async setSessionContext(sessionId: string, context: ContextRef): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    const now = this.runtime.now();
    const updated: CoachSession = {
      ...session,
      context,
      contextRefs: [...new Map([...(session.contextRefs ?? [session.context]), context].map((item) => [
        `${item.kind}:${item.ref}`,
        item,
      ])).values()],
      revision: (session.revision ?? 1) + 1,
      updatedAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: session.userId,
      intent: "coach_session.change_context",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      domainEvents: [],
      sessions: [updated],
      idempotencyKey: `${session.id}:context:${context.kind}:${context.ref}:${session.revision ?? 1}`,
      recordedAt: now,
    });
    return updated;
  }

  async listCoachSessions(input: {
    userId: string;
    status?: CoachSession["status"];
    taskKind?: NonNullable<CoachSession["taskKind"]>;
    query?: string;
  }): Promise<readonly CoachSession[]> {
    const snapshot = await this.ledger.read();
    const query = input.query?.trim().toLocaleLowerCase();
    return snapshot.sessions
      .filter((session) => session.userId === input.userId)
      .filter((session) => !input.status || session.status === input.status)
      .filter((session) => !input.taskKind || session.taskKind === input.taskKind)
      .filter(
        (session) =>
          !query ||
          (session.title ?? "").toLocaleLowerCase().includes(query) ||
          session.context.ref.toLocaleLowerCase().includes(query),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

  async replayActionReceipt(actionEventId: string) {
    const snapshot = await this.ledger.read();
    const action = snapshot.actionEvents.find((event) => event.id === actionEventId);
    if (!action) throw new Error(`ActionEvent not found: ${actionEventId}`);
    const receipt = snapshot.artifacts.find(
      (artifact) =>
        artifact.kind === "action_receipt" &&
        (artifact.targetArtifactId === action.causationId || artifact.targetArtifactId === action.id),
    );
    if (!receipt || receipt.kind !== "action_receipt") {
      throw new Error(`ActionReceipt not found for: ${actionEventId}`);
    }
    return {
      action,
      receipt,
      before: action.before,
      after: action.after,
      card: this.cards.render(receipt, "ready"),
    };
  }

  async setMandate(input: {
    userId: string;
    mode: "manual" | "collaborative" | "managed";
    authorization: import("./domain").LocalSettingsAuthorization;
  }): Promise<void> {
    assertLocalSettingsAuthorization(input.authorization);
    const snapshot = await this.ledger.read();
    const user = snapshot.users.find((candidate) => candidate.userId === input.userId);
    if (!user) throw new Error(`User facts not found: ${input.userId}`);
    const next = {
        ...user,
        mandate: { mode: input.mode, revision: user.mandate.revision + 1 },
      };
    const now = this.runtime.now();
    const updated = upsertUser(snapshot, next);
    await this.ledger.replace({
      ...updated,
      actionEvents: [
        ...updated.actionEvents,
        {
          id: this.runtime.nextId("action"),
          userId: input.userId,
          occurredAt: now,
          actor: "user",
          action: "mandate.changed",
          targetType: "mandate",
          targetId: input.userId,
          scope: "legacy_coaching_mandate",
          intent: "settings.change_mandate",
          beforeRevision: user.mandate.revision,
          afterRevision: next.mandate.revision,
          before: { mode: user.mandate.mode },
          after: { mode: next.mandate.mode },
          evidenceRefs: [],
          beforeRefs: [{ aggregate: "mandate", id: input.userId, revision: user.mandate.revision }],
          afterRefs: [{ aggregate: "mandate", id: input.userId, revision: next.mandate.revision }],
          ruleVersions: knowledgeRuleVersions(this.knowledge.versionPins()),
          mandateRevision: next.mandate.revision,
          result: "applied",
          undoBoundary: "compensating_revision",
          policyDecision: "allow",
          humanDecision: "confirmed",
          causationId: input.authorization.nonce,
          correlationId: input.userId,
          reversible: true,
        },
      ],
    });
  }

  async setSafetyHold(input: { userId: string; enabled: boolean }): Promise<void> {
    const snapshot = await this.ledger.read();
    const user = snapshot.users.find((candidate) => candidate.userId === input.userId);
    if (!user) throw new Error(`User facts not found: ${input.userId}`);
    await this.ledger.replace(upsertUser(snapshot, { ...user, safetyHold: input.enabled }));
  }

  async executeManagedPlanChange(
    input: ProposePlanChangeInput & { idempotencyKey: string },
  ): Promise<ArtifactActionResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    const user = snapshot.users.find((candidate) => candidate.userId === session?.userId);
    if (!session || !user) throw new Error("CoachSession or user facts not found");
    if (user.mandate.mode !== "managed") throw new Error("managed_mode_required");
    const proposal = await this.proposePlanChange(input);
    return this.actOnArtifact({
      sessionId: input.sessionId,
      artifactId: proposal.artifact.id,
      action: "apply",
      actionToken: proposal.actionToken,
      idempotencyKey: input.idempotencyKey,
    });
  }

  suspendForHumanInput(input: Parameters<HumanActionCoordinator["suspend"]>[0]) {
    return this.humanActions.suspend(input);
  }

  resumeHumanInput(input: Parameters<HumanActionCoordinator["resume"]>[0]) {
    return this.agentRuntime.resumeHumanAction(input);
  }

  /** UI-facing HITL seam. Resume credentials remain in the local ledger. */
  async respondToPendingHumanAction(input: {
    userId: string;
    pendingActionId: string;
    optionId: string;
  }) {
    const snapshot = await this.ledger.read();
    const pending = snapshot.pendingHumanActions.find(
      (candidate) =>
        candidate.id === input.pendingActionId &&
        candidate.userId === input.userId &&
        candidate.status === "pending",
    );
    if (!pending) throw new Error("pending_human_action_unavailable");
    return this.resumeHumanInput({
      pendingActionId: pending.id,
      runId: pending.runId,
      toolCallId: pending.toolCallId,
      resumeToken: pending.resumeToken,
      output: { kind: "selected", optionId: input.optionId },
    });
  }

  continueCoachRun(runId: string) {
    return this.agentRuntime.continueRun(runId);
  }

  terminateCoachRun(runId: string) {
    return this.agentRuntime.terminate(runId);
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

  async sendCoachTurn(input: {
    sessionId: string;
    text: string;
  }): Promise<readonly import("./model").CoachRunEvent[]> {
    return this.agentRuntime.sendTurn(input);
  }

  /** Stops the newest active provider run without replacing it with a fake continuation. */
  async cancelCoachRun(input: { sessionId: string }): Promise<{ cancelled: boolean; runId?: string }> {
    const session = await this.readSession(input.sessionId);
    const snapshot = await this.ledger.read();
    const run = [...snapshot.runs]
      .filter((candidate) => candidate.sessionId === session.id && ["streaming", "resuming"].includes(candidate.status))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || right.id.localeCompare(left.id))[0];
    if (!run) return { cancelled: false };
    await this.agentRuntime.terminate(run.id);
    return { cancelled: true, runId: run.id };
  }

  replayMotionRuntime(input: Parameters<MotionCoordinator["replay"]>[0]) {
    return this.motion.replay(input);
  }

  scheduleSetAdjustment(input: Parameters<MotionCoordinator["scheduleAdjustment"]>[0]) {
    return this.motion.scheduleAdjustment(input);
  }

  adapterCapabilities(): {
    health: boolean;
    notifications: boolean;
    sync: "disabled" | "enabled";
    media: boolean;
    secureCredentials: boolean;
  } {
    return {
      health: Boolean(this.health),
      notifications: Boolean(this.notifications),
      sync: this.sync.mode,
      media: Boolean(this.media),
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
    pages: readonly Awaited<ReturnType<CoachApplication["importHealthEvidence"]>>[];
    stoppedBecause: "caught_up" | "unavailable" | "page_budget";
  }> {
    const maxPages = Math.max(1, Math.min(50, Math.floor(input.maxPages ?? 12)));
    const pages: Awaited<ReturnType<CoachApplication["importHealthEvidence"]>>[] = [];
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

  synchronize() {
    return this.sync.synchronize();
  }

  /** Account sync is opt-in; all writes have already committed locally before this runs. */
  async synchronizeReplica(userId: string) {
    const permissions = (await this.readDomainProjection({ userId })).permissions?.value;
    if (!this.replicaSynchronizer || (permissions && permissions.cloudSync !== "granted")) {
      return Promise.resolve({
        status: "disabled" as const,
        pushed: [], pulled: [], applied: [], pending: [], conflicts: [], rejected: [], retryable: false,
      });
    }
    return this.replicaSynchronizer.synchronize(userId);
  }

  /**
   * Read-only sync and conflict facade for settings/merge UI. It never talks
   * to the network, exposes no remote event payload, and cannot choose a
   * branch; resolving a conflict remains an ordinary user-authored revision.
   */
  async readReplicaSyncOverview(userId: string): Promise<import("../sync").ReplicaSyncOverview> {
    const snapshot = await this.ledger.read();
    const permissions = projectDomainEvents(snapshot.domainEvents, { userId }).permissions?.value;
    return buildReplicaSyncOverview({
      snapshot,
      userId,
      enabled: Boolean(this.replicaSynchronizer && (!permissions || permissions.cloudSync === "granted")),
    });
  }

  /**
   * Safe, local-only disclosure for the mobile account/privacy screen. It is
   * deliberately read-only: this neither signs in nor starts a sync, and it
   * excludes credentials, external account IDs, sync payloads and media refs.
   */
  async readPrivacySettingsOverview(input: { userId: string }): Promise<PrivacySettingsOverview> {
    const snapshot = await this.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: input.userId });
    let media = [] as readonly import("../privacy").MediaBlobReference[];
    let mediaUnavailable = false;
    if (this.media) {
      try {
        media = await this.media.list({ userId: input.userId });
      } catch {
        // Avoid rendering a low-level filesystem error or any raw attachment
        // metadata on the disclosure surface.
        mediaUnavailable = true;
      }
    }
    return buildPrivacySettingsOverview({
      userId: input.userId,
      authenticatedAccountId: this.authenticatedAccountId ?? "",
      replica: {
        configured: Boolean(this.replicaSynchronizer),
        overview: await this.readReplicaSyncOverview(input.userId),
      },
      ...(domain.permissions ? { permissions: domain.permissions } : {}),
      media: {
        configured: Boolean(this.media),
        ...(mediaUnavailable ? { unavailable: true } : {}),
        references: media,
      },
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

  scheduleNotification(input: { id: string; at: string; title: string; body: string }) {
    if (!this.notifications) throw new Error("NotificationPort is not configured");
    return this.notifications.schedule(input);
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

  putMedia(input: { userId: string; mimeType: string; bytes: Uint8Array }) {
    if (!this.media) throw new Error("MediaBlobStore is not configured");
    return this.media.put(input);
  }

  getMedia(input: { userId: string; id: string }) {
    if (!this.media) throw new Error("MediaBlobStore is not configured");
    return this.media.get(input);
  }

  listMedia(input: { userId: string; lifecycle?: import("../privacy").MediaBlobReference["lifecycle"] }) {
    if (!this.media) throw new Error("MediaBlobStore is not configured");
    return this.media.list(input);
  }

  deleteMedia(input: { userId: string; id: string }) {
    if (!this.media) throw new Error("MediaBlobStore is not configured");
    return this.media.delete(input);
  }
}

function findNutritionChangeProposal(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  userId: string,
  artifactId: string,
): import("./model").NutritionChangeProposalArtifact {
  const artifact = snapshot.artifacts.find(
    (candidate): candidate is import("./model").NutritionChangeProposalArtifact =>
      candidate.id === artifactId && candidate.kind === "nutrition_change_proposal" && candidate.userId === userId,
  );
  if (!artifact) throw new Error("nutrition_proposal_not_found");
  return artifact;
}

function findNutritionReceipt(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  receiptId: string,
): import("./model").ActionReceiptArtifact | undefined {
  const receipt = snapshot.artifacts.find(
    (candidate): candidate is import("./model").ActionReceiptArtifact =>
      candidate.id === receiptId && candidate.kind === "action_receipt",
  );
  return receipt;
}

function nutritionProposalPresentation(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  artifactId: string,
): import("./model").PresentationRef {
  const presentation = snapshot.presentations.find((candidate) => candidate.artifactId === artifactId);
  if (!presentation) throw new Error("nutrition_proposal_presentation_missing");
  return presentation;
}

function nutritionProposalPresentationStatus(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  proposal: import("./model").NutritionChangeProposalArtifact,
  projection: DomainProjection,
): NutritionStrategyProposalInspection["status"] {
  const presentation = nutritionProposalPresentation(snapshot, proposal.id);
  if (
    presentation.status === "applied" ||
    presentation.status === "rejected" ||
    presentation.status === "undone"
  ) {
    return presentation.status;
  }
  const strategy = projection.nutritionStrategies.find(
    (candidate) => candidate.value.id === proposal.nutritionStrategyId,
  );
  const planEvidence = proposal.evidenceRefs.find((ref) => ref.aggregate === "plan");
  if (
    !strategy ||
    strategy.revision !== proposal.baseStrategyRevision ||
    !projection.mandate ||
    projection.mandate.revision !== proposal.mandateRevision ||
    (planEvidence !== undefined && (
      !projection.plan ||
      projection.plan.value.id !== planEvidence.id ||
      projection.plan.revision !== planEvidence.revision
    ))
  ) {
    return "stale";
  }
  return "awaiting_user";
}

function nutritionProposalExecutionPolicy(
  mandate: import("./domain").CoachingMandateData,
  now: string,
): "confirm" | "advice_only" {
  if (mandate.validUntil && Date.parse(mandate.validUntil) < Date.parse(now)) return "advice_only";
  if (mandate.mode === "manual" || mandate.scopes?.nutrition === "advice_only") return "advice_only";
  // Nutrition target changes remain a confirmation-boundary even in a managed
  // mandate: a small daily energy delta can still be high-impact over time.
  return "confirm";
}

function hasActiveNutritionLock(
  mandate: import("./domain").CoachingMandateData,
  now: string,
): boolean {
  return (mandate.locks ?? []).some(
    (lock) => lock.scope === "nutrition" && (!lock.expiresAt || Date.parse(lock.expiresAt) >= Date.parse(now)),
  );
}

/**
 * Card actions cannot accept a caller-supplied safety object. Rebuild the
 * safety screen from committed profile/constraint facts so an old card cannot
 * bypass a newly recorded professional restriction or stop signal.
 */
function nutritionSafetyScreenFromProjection(projection: DomainProjection, nowIso: string): NutritionSafetyScreen {
  const now = Date.parse(nowIso);
  const activeConstraints = projection.safetyConstraints
    .map((item) => item.value)
    .filter((item) => !item.validUntil || Date.parse(item.validUntil) >= now);
  const nutritionProfessionalConstraint = [
    ...(projection.profile?.value.professionalConstraints ?? []),
    ...activeConstraints.flatMap((item) => item.professionalConstraints),
  ].some((constraint) => constraint.scope.includes("nutrition"));
  const urgentSignal = activeConstraints.some(
    (constraint) => constraint.disposition === "stop_and_seek_professional_guidance" || constraint.stopSignals.length > 0,
  );
  return {
    adultConfirmed: projection.profile?.value.adultConfirmed === true,
    professionalConflict: nutritionProfessionalConstraint || urgentSignal,
  };
}

/** A caller may add disclosed context, but can never relax committed safety facts. */
function mergeNutritionSafetyScreens(
  supplied: NutritionSafetyScreen,
  committed: NutritionSafetyScreen,
): NutritionSafetyScreen {
  return {
    adultConfirmed: supplied.adultConfirmed && committed.adultConfirmed,
    pregnancyOrLactation: Boolean(supplied.pregnancyOrLactation || committed.pregnancyOrLactation),
    eatingDisorderOrExtremeRestriction: Boolean(
      supplied.eatingDisorderOrExtremeRestriction || committed.eatingDisorderOrExtremeRestriction,
    ),
    diseaseSpecificDiet: Boolean(supplied.diseaseSpecificDiet || committed.diseaseSpecificDiet),
    medicationOrSurgery: Boolean(supplied.medicationOrSurgery || committed.medicationOrSurgery),
    professionalConflict: Boolean(supplied.professionalConflict || committed.professionalConflict),
    rapidDehydrationOrWeightCut: Boolean(supplied.rapidDehydrationOrWeightCut || committed.rapidDehydrationOrWeightCut),
    acuteSignal: supplied.acuteSignal ?? committed.acuteSignal,
  };
}

function nutritionReceiptId(input: {
  userId: string;
  action: "apply" | "reject" | "undo";
  targetArtifactId: string;
  idempotencyKey: string;
}): string {
  return `nutrition-receipt-${stableHash(input)}`;
}

function nutritionActionReceipt(input: {
  id: string;
  now: string;
  action: "apply" | "reject" | "undo";
  result: "applied" | "rejected" | "undone";
  targetArtifactId: string;
  beforeRevision?: number;
  afterRevision?: number;
  contextRefs: readonly ContextRef[];
  evidenceRefs: readonly import("./model").FactRef[];
  knowledgePins: import("../knowledge").KnowledgeVersionPins;
}): import("./model").ActionReceiptArtifact {
  const semantic = {
    kind: "action_receipt" as const,
    schemaVersion: 1 as const,
    renderVersion: 1 as const,
    action: input.action,
    targetArtifactId: input.targetArtifactId,
    targetKind: "nutrition" as const,
    result: input.result,
    ...(input.beforeRevision === undefined ? {} : { beforeRevision: input.beforeRevision }),
    ...(input.afterRevision === undefined ? {} : { afterRevision: input.afterRevision }),
    contextRefs: input.contextRefs,
    evidenceRefs: input.evidenceRefs,
    missingness: [],
    capabilityBoundary: ["撤销会创建补偿版本，不删除历史饮食安排"],
    knowledgePins: input.knowledgePins,
  };
  return Object.freeze({ id: input.id, createdAt: input.now, ...semantic, hash: stableHash(semantic) });
}

function nutritionRuleVersions(
  artifact: import("./model").NutritionChangeProposalArtifact,
): Record<string, string> {
  return {
    ...(artifact.knowledgePins ? knowledgeRuleVersions(artifact.knowledgePins) : {}),
    nutritionStrategy: artifact.proposal.after.ruleVersion ?? "unknown",
  };
}

function nutritionStrategyActionView(
  strategy: import("./domain").NutritionStrategyData,
): Readonly<Record<string, unknown>> {
  return clone(strategy) as unknown as Readonly<Record<string, unknown>>;
}

function nutritionStrategyActionEvent(input: {
  id: string;
  userId: string;
  occurredAt: string;
  actor: import("./model").ActionEvent["actor"];
  action: Extract<
    import("./model").ActionEvent["action"],
    | "nutrition.strategy.proposed"
    | "nutrition.strategy.applied"
    | "nutrition.strategy.rejected"
    | "nutrition.strategy.undone"
  >;
  targetId: string;
  intent: string;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly import("./model").FactRef[];
  beforeRefs: readonly import("./model").FactRef[];
  afterRefs: readonly import("./model").FactRef[];
  mandateRevision: number;
  ruleVersions: Readonly<Record<string, string>>;
  result: import("./model").ActionEvent["result"];
  undoBoundary: import("./model").ActionEvent["undoBoundary"];
  policyDecision: import("./model").ActionEvent["policyDecision"];
  humanDecision?: import("./model").ActionEvent["humanDecision"];
  causationId: string;
  correlationId: string;
  reversible: boolean;
}): import("./model").ActionEvent {
  return {
    ...input,
    targetType: "nutrition",
    scope: "nutrition_strategy",
  };
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

export function createInMemoryCoachApplication(runtime: RuntimeServices): CoachApplication {
  return new CoachApplication(new InMemoryCoachLedger(), runtime);
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
  if (command.meta.actor.kind !== "agent" && command.meta.actor.kind !== "rule_engine") return;
  const entry = command.type === "timeline.source_tombstone" ? undefined : command.entry;
  const canonical = entry?.provenance.origin === "canonical_motion_packet" &&
    entry.evidenceRefs.some((ref) => ref.kind === "canonical_packet");
  if (!canonical) throw new Error("agent_cannot_write_unconfirmed_timeline_fact");
}

function isLaterSourceRevision(
  incoming: TimelineFactEnvelope,
  existing: TimelineFactEnvelope | undefined,
): boolean {
  if (!existing) return false;
  const incomingAt = Date.parse(incoming.provenance.lastModifiedAt ?? incoming.recordedAt);
  const existingAt = Date.parse(existing.provenance.lastModifiedAt ?? existing.recordedAt);
  return Number.isFinite(incomingAt) && (!Number.isFinite(existingAt) || incomingAt > existingAt);
}

function hasMeasuredValue(fact: import("./domain").TimelineFact): boolean {
  switch (fact.kind) {
    case "body":
      return true;
    case "nutrition":
      return fact.energy !== undefined;
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

function unavailableWorkoutRuleDecision(reason: string): RuleDecision {
  return {
    decision: "unavailable",
    scope: "next_session",
    states: { performance: "INSUFFICIENT_EVIDENCE", volume: "INSUFFICIENT_EVIDENCE" },
    reasonCodes: [reason],
    evidenceRefs: [],
    missing: [reason],
    conflicts: [],
    before: {},
    after: {},
    rule: { id: "maxpower.training.unavailable", semanticVersion: "1", contentHash: stableHash(reason) },
    confidence: 0,
    requiresConfirmation: true,
    reviewBoundary: "between_sets",
    safetyBoundary: ["no_unversioned_or_llm_progression"],
    explanation: "当前记录不足以对下一组生成确定性调整，保持当前训练计划。",
  };
}

function findWorkoutPrescriptionSet(
  prescription: import("./domain").PlannedSessionData,
  setId: string,
): { task: import("./domain").PlannedExerciseTask; set: import("./domain").PlannedExerciseSet } | undefined {
  for (const task of prescription.tasks) {
    const set = task.sets.find((candidate) => candidate.id === setId);
    if (set) return { task, set };
  }
  return undefined;
}

function comparableWorkoutSessions(input: {
  workouts: readonly import("./domain").WorkoutProjection[];
  currentWorkoutId: string;
  currentOutcome: import("./domain").SetOutcomeData;
  comparableContext: RuleEvaluationContext["comparableContext"];
  currentAt: string;
  currentWorkoutRevision: number;
}): RuleEvaluationContext["recentSessions"] {
  const historical = input.workouts
    .filter((workout) => workout.id !== input.currentWorkoutId)
    .map((workout) => ({
      sessionId: workout.id,
      occurredAt: workout.outcome?.completedAt ?? workout.state.transitions.at(-1)?.occurredAt ?? "",
      context: input.comparableContext,
      sets: workout.setOutcomes
        .filter((outcome) => outcome.exerciseVariantId === input.comparableContext.exerciseVariantId)
        .map(performedSetEvidence),
      stopSignals: [],
      partial: workout.status !== "completed",
      evidenceRefs: [{ aggregate: "workout" as const, id: workout.id, revision: workout.revision }],
    }))
    .filter((session) => session.sets.length && session.occurredAt);
  // A sealed set is a completed comparable exposure for the narrow
  // `between_sets` boundary. It is deliberately not used as a full-session
  // volume assessment, which remains unavailable without weekly evidence.
  return [
    ...historical,
    {
      sessionId: `${input.currentWorkoutId}:${input.currentOutcome.id}`,
      occurredAt: input.currentAt,
      context: input.comparableContext,
      sets: [performedSetEvidence(input.currentOutcome)],
      stopSignals: [],
      partial: false,
      evidenceRefs: [{ aggregate: "workout" as const, id: input.currentWorkoutId, revision: input.currentWorkoutRevision }],
    },
  ];
}

function performedSetEvidence(outcome: import("./domain").SetOutcomeData) {
  return {
    setId: outcome.id,
    ...(outcome.actualLoad ? { actualLoad: outcome.actualLoad, actualLoadSource: "user_confirmed" as const } : {}),
    ...(outcome.actualReps !== undefined ? { actualReps: outcome.actualReps } : {}),
    ...(outcome.actualRir !== undefined ? { actualRir: outcome.actualRir, rirSource: "user_reported" as const } : {}),
    completed: true,
  };
}

function activeRecoveryConstraint(
  constraints: readonly import("./domain").Revisioned<import("./domain").RecoveryConstraintData>[],
  now: string,
): import("./domain").RecoveryConstraintData["level"] {
  const rank: Record<import("./domain").RecoveryConstraintData["level"], number> = {
    normal: 0,
    slight_reduction: 1,
    recovery_priority: 2,
    pause_and_confirm: 3,
  };
  return constraints
    .filter((constraint) => constraint.value.validUntil >= now)
    .map((constraint) => constraint.value.level)
    .sort((left, right) => rank[right] - rank[left])[0] ?? "normal";
}

function activeWorkoutLocks(
  mandate: import("./domain").CoachingMandateData,
  now: string,
): RuleEvaluationContext["locks"] {
  return (mandate.locks ?? [])
    .filter((lock) => !lock.expiresAt || lock.expiresAt >= now)
    .map((lock) => lock.field)
    .filter((field): field is "load" | "sets" | "exercise" | "week_structure" =>
      field === "load" || field === "sets" || field === "exercise" || field === "week_structure",
    );
}

function availableWorkoutLoads(
  projection: import("./domain").DomainProjection,
  source: import("./domain").PlannedExerciseSet,
  next: import("./domain").PlannedExerciseSet,
): readonly import("./domain").MassQuantity[] {
  const configured = projection.equipmentProfiles.flatMap((profile) =>
    (profile.value.equipment ?? [])
      .filter((item) => item.status === "available")
      .flatMap((item) => [
        ...(item.discreteLoads ?? []),
        ...(item.loadRange ? [item.loadRange.min, item.loadRange.max] : []),
      ]),
  );
  const values = [...configured, ...(source.targetLoad ? [source.targetLoad] : []), ...(next.targetLoad ? [next.targetLoad] : [])];
  return values.filter((value, index) => values.findIndex((candidate) => candidate.unit === value.unit && candidate.value === value.value) === index);
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
  packetRef?: { id: string; version: number; hash: string };
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
    ...(input.packetRef ? { packetRef: input.packetRef } : {}),
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
    packetRef: undefined,
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

function timelineOriginForMeal(source: "manual" | "label" | "import" | "llm_estimate"): import("../timeline").TimelineOrigin {
  if (source === "llm_estimate") return "llm_estimate";
  if (source === "import") return "import";
  return "manual";
}

function plannerTriggerForReplan(
  trigger: import("../replanning").ReplanTriggerKind,
): import("../planning").PlannerTrigger {
  const mapping: Record<import("../replanning").ReplanTriggerKind, import("../planning").PlannerTrigger> = {
    session_completed: "session_completed",
    recovery_constraint_changed: "recovery_downgraded",
    repeated_missed_sessions: "repeated_missed_sessions",
    schedule_changed: "schedule_changed",
    equipment_changed: "equipment_changed",
    goal_contract_revised: "goal_changed",
    deload_ended: "deload_ended",
    weekly_review_due: "user_requested",
    user_requested: "user_requested",
  };
  return mapping[trigger];
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
function recentPartialWorkoutDates(
  workouts: readonly import("./domain").WorkoutProjection[],
  completedAt: string,
  plan?: import("./domain").Revisioned<import("./domain").PlanRevisionData>,
): readonly string[] {
  const end = Date.parse(completedAt);
  const start = end - 14 * 24 * 60 * 60 * 1_000;
  const partialDates = workouts
    .flatMap((workout) => workout.outcome ? [workout.outcome] : [])
    .filter((outcome) => outcome.status === "partial" || outcome.status === "abandoned")
    .filter((outcome) => {
      const occurred = Date.parse(outcome.completedAt);
      return Number.isFinite(occurred) && occurred >= start && occurred <= end;
    })
    .map((outcome) => outcome.completedAt.slice(0, 10));
  // ticket 02：计划了但从未开始的课也算缺席（scheduledFor 在窗口内、早于完成日、无对应 workout）
  const startedSessionIds = new Set(
    workouts.map((workout) => workout.prescriptionRef?.sessionPrescriptionId).filter(Boolean),
  );
  const neverStartedDates = (plan?.value.sessions ?? [])
    .filter((session) => session.tasks.length > 0)
    .filter((session) => {
      const day = Date.parse(`${session.scheduledFor}T23:59:59.000Z`);
      return Number.isFinite(day) && day >= start && day < end;
    })
    .filter((session) => !startedSessionIds.has(session.id))
    .map((session) => session.scheduledFor);
  return [...partialDates, ...neverStartedDates]
    .filter((date, index, values) => values.indexOf(date) === index)
    .sort();
}

function frontierFactRefs(
  frontier: readonly import("./domain").DomainAggregateRef[],
): import("./model").FactRef[] {
  return frontier.flatMap((ref) => {
    const aggregate = factAggregate(ref.kind);
    return aggregate ? [{ aggregate, id: ref.id, revision: ref.revision }] : [];
  });
}

function replanMissingness(
  evaluation: import("../replanning").ReplanEvaluation,
): readonly string[] {
  const decision = evaluation.plannerDecision;
  if (decision.kind === "plan_proposal") return decision.missing;
  if (decision.kind === "infeasible_plan") return decision.reasonCodes;
  return [];
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

function taskKindForContext(
  kind: ContextRef["kind"],
): NonNullable<CoachSession["taskKind"]> {
  if (kind === "today") return "today_plan";
  if (kind === "workout") return "workout_execution";
  if (kind === "calendar" || kind === "plan") return "plan_adjustment";
  if (kind === "progress") return "weekly_report";
  return "general";
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

function defaultNutritionInputKinds(input: NutritionObservationRequest): readonly ("text" | "photo")[] {
  return [
    ...(input.text?.trim() ? ["text" as const] : []),
    ...(input.localMediaRefs?.length ? ["photo" as const] : []),
  ];
}

function assertNutritionObservationResult(
  result: Awaited<ReturnType<NutritionObservationPort["estimate"]>>,
  request: NutritionObservationRequest,
): void {
  if (!result || !Array.isArray(result.candidates) || !Array.isArray(result.missing)) {
    throw new Error("nutrition_observation_invalid_result");
  }
  if (!result.provider?.id || !result.provider.modelVersion) {
    throw new Error("nutrition_observation_invalid_provider");
  }
  if (request.localMediaRefs?.length && result.provider.processingScope !== "photo") {
    throw new Error("nutrition_observation_invalid_provider_scope");
  }
  if (!result.candidates.length) throw new Error("nutrition_observation_empty_result");
  for (const candidate of result.candidates) {
    assertNutritionEstimateCandidate(candidate);
  }
}

/**
 * Normalizes explicit card edits before a Timeline commit. This is deliberately
 * the same range/assumption boundary required of a Provider result: a user can
 * correct a candidate, but cannot turn an estimate into a false-precision
 * single number or leave an unlabelled, unauditable edit.
 */
function normalizeNutritionObservationDraftEdits(
  input: import("../nutrition").NutritionObservationDraftEdits,
): import("../nutrition").NutritionObservationDraftEdits {
  const description = input.description?.trim();
  if (input.description !== undefined && !description) throw new Error("nutrition_observation_invalid_edit");
  if (input.estimates !== undefined) {
    if (!input.estimates.length) throw new Error("nutrition_observation_invalid_edit");
    input.estimates.forEach(assertNutritionEstimateCandidate);
  }
  if (!description && input.estimates === undefined) throw new Error("nutrition_observation_invalid_edit");
  return {
    ...(description ? { description } : {}),
    ...(input.estimates ? {
      estimates: input.estimates.map((candidate) => ({
        ...candidate,
        assumptions: [...candidate.assumptions],
        ...(candidate.energyRange ? { energyRange: { min: { ...candidate.energyRange.min }, max: { ...candidate.energyRange.max } } } : {}),
        ...(candidate.proteinGramsRange ? { proteinGramsRange: { ...candidate.proteinGramsRange } } : {}),
        ...(candidate.fatGramsRange ? { fatGramsRange: { ...candidate.fatGramsRange } } : {}),
        ...(candidate.carbohydrateGramsRange ? { carbohydrateGramsRange: { ...candidate.carbohydrateGramsRange } } : {}),
      })),
    } : {}),
  };
}

function assertNutritionEstimateCandidate(candidate: import("../nutrition").NutrientEstimate): void {
  const hasRange = Boolean(
    candidate.energyRange || candidate.proteinGramsRange || candidate.fatGramsRange || candidate.carbohydrateGramsRange,
  );
  if (!candidate.foodName?.trim() || !candidate.portionAssumption?.trim() || !candidate.assumptions?.length || !hasRange) {
    throw new Error("nutrition_observation_invalid_estimate");
  }
  assertEstimateRange(candidate.energyRange?.min.value, candidate.energyRange?.max.value);
  assertEstimateRange(candidate.proteinGramsRange?.min, candidate.proteinGramsRange?.max);
  assertEstimateRange(candidate.fatGramsRange?.min, candidate.fatGramsRange?.max);
  assertEstimateRange(candidate.carbohydrateGramsRange?.min, candidate.carbohydrateGramsRange?.max);
  if (candidate.energyRange && candidate.energyRange.min.unit !== candidate.energyRange.max.unit) {
    throw new Error("nutrition_observation_invalid_estimate");
  }
}

function assertEstimateRange(min: number | undefined, max: number | undefined): void {
  if (min === undefined && max === undefined) return;
  if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min > max) {
    throw new Error("nutrition_observation_invalid_estimate");
  }
}

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
 * The event-sourced onboarding/planner path no longer writes the legacy
 * `snapshot.users` projection. Read-only Coach cards still accept UserState,
 * so derive that narrow view from authoritative domain events when needed.
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

function todayPlanUserFromDomain(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  userId: string,
  date: string,
  exerciseLabel: (exerciseVariantId: string) => string = (exerciseVariantId) => exerciseVariantId,
): UserState | undefined {
  const domain = projectDomainEvents(snapshot.domainEvents, { userId, date });
  if (!domain.profile || !domain.plan) return undefined;
  const scheduled = domain.plan.value.sessions.find((item) => item.scheduledFor === date);
  const primaryGoal = domain.goalContract?.value.primaryGoal;
  const goal: UserProfile["goal"] = primaryGoal === "fat_loss_preserve_lean_mass"
    ? "fat_loss"
    : primaryGoal ?? "health";
  return {
    userId,
    profile: {
      goal,
      trainingExperience: domain.profile.value.trainingExperience,
    },
    profileRevision: domain.profile.revision,
    plan: {
      revision: domain.plan.revision,
      effectiveDate: domain.plan.value.effectiveFrom,
      title: scheduled?.title ?? "休息与记录",
      tasks: (scheduled?.tasks ?? []).map((task) => {
        const firstSet = task.sets[0];
        const targetReps = firstSet?.targetReps;
        const reps = targetReps
          ? targetReps.min === targetReps.max
            ? String(targetReps.min)
            : `${targetReps.min}-${targetReps.max}`
          : firstSet?.targetDuration
            ? `${firstSet.targetDuration.value} ${prescriptionUnitLabel(firstSet.targetDuration.unit)}`
            : firstSet?.targetDistance
              ? `${firstSet.targetDistance.value} ${prescriptionUnitLabel(firstSet.targetDistance.unit)}`
              : "待记录";
        const restSeconds = firstSet?.rest
          ? firstSet.rest.unit === "seconds"
            ? firstSet.rest.value
            : firstSet.rest.unit === "minutes"
              ? firstSet.rest.value * 60
              : firstSet.rest.value * 3600
          : undefined;
        return {
          id: task.id,
          name: localizedExerciseDisplayName(exerciseLabel(task.exerciseVariantId)),
          exerciseVariantId: task.exerciseVariantId,
          sets: task.sets.length,
          reps,
          ...(firstSet?.targetLoad?.unit === "kg" ? { loadKg: firstSet.targetLoad.value } : {}),
          ...(firstSet?.targetRir !== undefined ? { targetRir: firstSet.targetRir } : {}),
          ...(restSeconds !== undefined ? { restSeconds } : {}),
        };
      }),
      ...(domain.plan.value.baseRevision !== undefined ? { previousRevision: domain.plan.value.baseRevision } : {}),
      ...(domain.plan.value.reasonCodes?.length ? { reason: domain.plan.value.reasonCodes.join(", ") } : {}),
      knowledgePins: domain.plan.value.knowledgePins,
    },
    timeline: [],
    timelineRevision: domain.timeline.revision,
    mandate: {
      mode: domain.mandate?.value.mode ?? "collaborative",
      revision: domain.mandate?.revision ?? 0,
    },
    safetyHold: domain.safetyConstraints.some((item) => item.value.disposition !== "clear"),
  };
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
    goal_cycle: "goal",
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
function assembleHistoricalPerformance(
  workouts: readonly import("./domain").WorkoutProjection[],
): import("../planning").HistoricalPerformance[] {
  return workouts
    .filter((workout) => workout.status === "completed" || workout.status === "partial")
    .flatMap((workout) =>
      workout.setOutcomes
        .filter((set) => set.source === "user_confirmed" && set.actualLoad && set.actualReps !== undefined)
        .map((set) => ({
          exerciseVariantId: set.exerciseVariantId,
          occurredAt:
            workout.outcome?.completedAt ?? `${workout.frozenPrescription.scheduledFor}T00:00:00.000Z`,
          load: set.actualLoad!,
          reps: set.actualReps!,
          ...(set.actualRir !== undefined ? { rir: set.actualRir } : {}),
          confidence: "confirmed" as const,
          evidenceRef: `workout:${workout.id}:set:${set.id}`,
        })),
    );
}

/** 确认前定制应用（ticket 04）：调整/删除任务，每处修改带 provenance 记录进 revision。 */
function applyPlanEditChanges(
  revision: import("./domain").PlanRevisionData,
  edits: readonly import("./model").PlanEditChange[],
  appliedAt: string,
): import("./domain").PlanRevisionData {
  let sessions = revision.sessions.map((session) => ({ ...session, tasks: [...session.tasks] }));
  for (const edit of edits) {
    if (edit.kind === "remove_task") {
      sessions = sessions.map((session) => ({
        ...session,
        tasks: session.tasks.filter((task) => task.id !== edit.taskId),
      }));
      continue;
    }
    if (edit.kind === "adjust_task") {
      sessions = sessions.map((session) => ({
        ...session,
        tasks: session.tasks.map((task) => {
          if (task.id !== edit.taskId) return task;
          let sets = task.sets;
          if (edit.sets !== undefined) {
            const count = Math.max(1, Math.min(20, edit.sets));
            const last = sets.at(-1);
            sets = Array.from({ length: count }, (_, index) =>
              sets[index] ?? { ...last!, id: `${last?.id ?? "set"}-ext${index}` });
          }
          return {
            ...task,
            sets: sets.map((set) => ({
              ...set,
              ...(edit.reps ? { targetReps: parseRepRangeText(edit.reps) ?? set.targetReps } : {}),
              ...(edit.loadKg !== undefined ? { targetLoad: { value: edit.loadKg, unit: "kg" as const } } : {}),
              ...(edit.targetRir !== undefined
                ? { targetRir: edit.targetRir, targetRirRange: { min: edit.targetRir, max: edit.targetRir } }
                : {}),
              ...(edit.restSeconds !== undefined
                ? { rest: { value: edit.restSeconds, unit: "seconds" as const } }
                : {}),
            })),
          };
        }),
      }));
    }
  }
  return {
    ...revision,
    id: `${revision.id}:custom-${stableHash(edits).slice(0, 16)}`,
    sessions,
    customizations: [
      ...(revision.customizations ?? []),
      ...edits.map((change) => ({ change, appliedAt })),
    ],
  };
}

function parseRepRangeText(reps: string): { min: number; max: number } | undefined {
  const match = reps.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return undefined;
  return { min: Number(match[1]), max: Number(match[2] ?? match[1]) };
}
