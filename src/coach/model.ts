import type { KnowledgeVersionPins } from "../knowledge/model";
import type { OnboardingDraftEvent } from "../onboarding/model";
import type { ContextManifest } from "./adapters/provider";
import type {
  AggregateRevisionState,
  DomainEvent,
  DomainIdempotencyRecord,
  OutboxEntry,
} from "./domain";

export type CoachSessionStatus = "active" | "suspended" | "completed" | "archived";
export type CoachContextKind = "today" | "calendar" | "plan" | "progress" | "workout" | "profile" | "onboarding";

export interface ContextRef {
  kind: CoachContextKind;
  ref: string;
}

export interface CoachSession {
  id: string;
  userId: string;
  status: CoachSessionStatus;
  context: ContextRef;
  taskKind?: "today_plan" | "workout_execution" | "plan_adjustment" | "weekly_report" | "onboarding" | "general";
  title?: string;
  revision?: number;
  contextRefs?: readonly ContextRef[];
  messageIds?: readonly string[];
  runIds?: readonly string[];
  toolCallIds?: readonly string[];
  artifactIds?: readonly string[];
  presentationIds?: readonly string[];
  pendingHumanActionIds?: readonly string[];
  workingMemoryIds?: readonly string[];
  createdAt: string;
  updatedAt: string;
}

export interface CoachMessage {
  id: string;
  sessionId: string;
  userId: string;
  role: "user" | "assistant" | "tool";
  content: string;
  runId?: string;
  toolCallId?: string;
  createdAt: string;
}

export interface CoachRunRecord {
  id: string;
  sessionId: string;
  userId: string;
  status: "streaming" | "suspended" | "resuming" | "completed" | "terminated" | "failed";
  factFrontier: readonly FactRef[];
  contextManifestHash: string;
  /** The selected local/remote language layer for replay and disclosure only. */
  provider?: {
    kind: string;
    model?: string;
    configurationFingerprint?: string;
  };
  /** Privacy-safe disclosure metadata, intentionally never the raw ProviderContext. */
  contextManifest?: ContextManifest;
  startedAt: string;
  updatedAt: string;
  terminalCode?: string;
  resume?: {
    pendingActionId: string;
    toolCallId: string;
    output: Readonly<Record<string, unknown>>;
  };
}

export interface CoachToolCallRecord {
  id: string;
  sessionId: string;
  runId: string;
  userId: string;
  toolName: string;
  inputSchemaVersion: number;
  inputHash: string;
  status: "input_available" | "suspended" | "output_available" | "output_error";
  artifactRef?: ArtifactRef;
  startedAt: string;
  updatedAt: string;
}

export interface UserProfile {
  goal: "hypertrophy" | "fat_loss" | "strength" | "conditioning" | "health";
  trainingExperience: "beginner" | "intermediate" | "advanced" | "unknown";
  name?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface PlanTask {
  id: string;
  name: string;
  exerciseVariantId?: string;
  stimulusContractIds?: readonly string[];
  sets: number;
  reps: string;
  loadKg?: number;
  targetRir?: number;
  restSeconds?: number;
}

export interface PlanRevision {
  revision: number;
  effectiveDate: string;
  title: string;
  tasks: readonly PlanTask[];
  previousRevision?: number;
  reason?: string;
  knowledgePins?: KnowledgeVersionPins;
}

export interface TimelineEvent {
  id: string;
  occurredAt: string;
  kind: "training" | "activity" | "nutrition" | "sleep" | "body" | "recovery";
  source: "user" | "motion" | "health" | "import";
  status: "draft" | "confirmed" | "corrected";
  data: Readonly<Record<string, unknown>>;
}

export interface UserState {
  userId: string;
  profile: UserProfile;
  profileRevision: number;
  plan: PlanRevision;
  timeline: readonly TimelineEvent[];
  timelineRevision: number;
  mandate: {
    mode: "manual" | "collaborative" | "managed";
    revision: number;
  };
  safetyHold: boolean;
}

export interface FactRef {
  aggregate:
    | "profile"
    | "plan"
    | "timeline"
    | "workout"
    | "memory"
    | "goal"
    | "permission"
    | "mandate"
    | "safety"
    | "recovery"
    | "nutrition"
    | "equipment"
    | "exercise"
    | "capability";
  id: string;
  revision: number;
}

export interface ArtifactRef {
  id: string;
  kind: ArtifactKind;
  schemaVersion: number;
  hash: string;
}

export interface PresentationRef {
  id: string;
  artifactId: string;
  renderer: string;
  status: PresentationStatus;
}

export type ArtifactKind =
  | "today_plan"
  | "plan_overview"
  | "plan_change_proposal"
  | "exercise_substitution"
  | "action_receipt"
  | "set_summary"
  | "replan_evaluation"
  | "goal_forecast"
  | "weekly_coach_report"
  | "mesocycle_review"
  | "evidence_brief"
  | "plan_trace"
  | "timeline_record_draft"
  | "nutrition_observation_draft"
  | "nutrition_change_proposal"
  | "timeline_risk_evaluation"
  | "planner_progress"
  | "recovery_brief"
  | "nutrition_strategy"
  | "safety_hold";

export interface ArtifactBase {
  id: string;
  kind: ArtifactKind;
  schemaVersion: 1;
  renderVersion: 1;
  createdAt: string;
  contextRefs: readonly ContextRef[];
  evidenceRefs: readonly FactRef[];
  missingness: readonly string[];
  capabilityBoundary: readonly string[];
  hash: string;
  knowledgePins?: KnowledgeVersionPins;
}

export interface TodayPlanArtifact extends ArtifactBase {
  kind: "today_plan";
  date: string;
  title: string;
  planRevision: number;
  tasks: readonly PlanTask[];
}

/** Read-only, week-scoped training and intake plan shown by Coach. */
export interface PlanOverviewArtifact extends ArtifactBase {
  kind: "plan_overview";
  userId: string;
  planRevision: number;
  strategy: string;
  window: { start: string; end: string };
  trainingDays: number;
  totalWorkSets: number;
  tasks: readonly (PlanTask & { scheduledFor: string; sessionTitle: string })[];
  nutrition?: {
    energyRange?: { min: number; max: number; unit: "kcal" };
    proteinGrams?: { min: number; max: number };
    fatEnergyFloorPercent?: number;
    reviewAt?: string;
    today?: {
      date: string;
      dayKind: import("../nutrition").DailyIntakeBudget["dayKind"];
      recommendedKcal?: number;
      recommendedRange?: { min: number; max: number };
      consumedKcal?: number;
      variancePercent?: number;
      status: import("../nutrition").DailyIntakeStatus;
      dayTypeAdjustmentKcal: number;
      activityAdjustmentKcal: number;
    };
    week?: readonly {
      date: string;
      dayKind: import("../nutrition").DailyIntakeBudget["dayKind"];
      recommendedKcal?: number;
    }[];
  };
}

export interface AdjustTaskChange {
  kind: "adjust_task";
  taskId: string;
  scope?: PlanEditScope;
  sets?: number;
  reps?: string;
  loadKg?: number;
  targetRir?: number;
  restSeconds?: number;
}

export type PlanEditScope = "this_session_only" | "future_preference" | "lock";

export interface AddTaskChange {
  kind: "add_task";
  task: PlanTask;
  index?: number;
  scope?: PlanEditScope;
}

export interface RemoveTaskChange {
  kind: "remove_task";
  taskId: string;
  scope?: PlanEditScope;
}

export interface ReplaceTaskChange {
  kind: "replace_task";
  taskId: string;
  replacement: PlanTask;
  preserveStimulusIntent: boolean;
  scope?: PlanEditScope;
}

export interface ReorderTaskChange {
  kind: "reorder_task";
  taskId: string;
  toIndex: number;
  scope?: PlanEditScope;
}

export type PlanEditChange =
  | AdjustTaskChange
  | AddTaskChange
  | RemoveTaskChange
  | ReplaceTaskChange
  | ReorderTaskChange;

export interface PlanChangeProposalArtifact extends ArtifactBase {
  kind: "plan_change_proposal";
  basePlanRevision: number;
  mandateRevision: number;
  change: PlanEditChange;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  reason: string;
  risk: "low" | "review" | "blocked";
  executionPolicy: "confirm" | "managed" | "advice_only";
  supersedesArtifactId?: string;
}

/**
 * A read-only ranked substitution explanation.  It never carries a copied
 * load: the chosen alternative is a new comparable-performance context.
 */
export interface ExerciseSubstitutionArtifact extends ArtifactBase {
  kind: "exercise_substitution";
  userId: string;
  sourceExerciseVariantId: string;
  candidates: readonly {
    exerciseVariantId: string;
    label: string;
    stimulusFit: "matches" | "partial" | "unknown";
    equipmentFit: "available" | "unavailable" | "unknown";
    comparableLoadHistory: "available" | "cold_start" | "not_comparable";
  }[];
}

export interface ActionReceiptArtifact extends ArtifactBase {
  kind: "action_receipt";
  action: "apply" | "reject" | "undo";
  targetArtifactId: string;
  /** Keeps a generic receipt renderable without guessing its source artifact. */
  targetKind?: "plan" | "nutrition";
  result: "applied" | "rejected" | "undone";
  beforeRevision?: number;
  afterRevision?: number;
}

export interface SetSummaryArtifact extends ArtifactBase {
  kind: "set_summary";
  exerciseId: string;
  packetRef: {
    id: string;
    version: number;
    hash: string;
  };
  profileIdentity?: string;
  confirmedReps: number;
  needsReviewReps: number;
  rejectedReps: number;
  observationFindings: readonly string[];
  userReported?: { loadKg?: number; rir?: number };
}

/** Immutable local result of a registered deterministic replanning trigger. */
export interface ReplanEvaluationArtifact extends ArtifactBase {
  kind: "replan_evaluation";
  userId: string;
  evaluation: import("../replanning").ReplanEvaluation;
}

/**
 * Immutable presentation of the three scenarios from an already-evaluated
 * local replan. It deliberately cannot create a new forecast: the registered
 * ReplanTrigger remains the sole route that evaluates one.
 */
export interface GoalForecastArtifact extends ArtifactBase {
  kind: "goal_forecast";
  userId: string;
  sourceEvaluationId?: string;
  evaluatedAt?: string;
  forecasts: readonly import("../replanning").GoalForecast[];
}

/** Immutable, evidence-linked summary of an already-ended calendar week. */
export interface WeeklyCoachReportArtifact extends ArtifactBase {
  kind: "weekly_coach_report";
  userId: string;
  report: import("../replanning").WeeklyCoachReport;
  window: { start: string; end: string };
  idempotencyKey: string;
}

/** A period-bound review; changing a plan still requires a linked Proposal. */
export interface MesocycleReviewArtifact extends ArtifactBase {
  kind: "mesocycle_review";
  userId: string;
  period: { start: string; end: string };
  status: "continue" | "adjust" | "complete" | "insufficient_data";
  summary: readonly string[];
  linkedProposalArtifactId?: string;
}

/** 规划推理链 artifact（ticket 04）：随 PlanRevision 幂等持久化，无 trace 不提交。 */
export interface PlanTraceArtifact extends ArtifactBase {
  kind: "plan_trace";
  userId: string;
  planId: string;
  trace: import("../planning").PlannerTrace;
}

/** Evidence-only explanation for a card or coach answer, never a fact write. */
export interface EvidenceBriefArtifact extends ArtifactBase {
  kind: "evidence_brief";
  userId: string;
  title: string;
  summary: readonly string[];
  /**
   * Durable output of the local knowledge.search tool. PassageRefs are not
   * generic citations: they may only support professional copy in this run.
   */
  knowledgeSearch?: {
    query: string;
    passageRefs: readonly {
      passageId: string;
      contentHash: string;
      citationIds: readonly string[];
    }[];
  };
  planningPreview?: {
    status: "awaiting_confirmation" | "stale" | "confirmed" | "rejected";
    proposal: import("../planning").PlanProposal;
    /** Complete replayable planner inputs. Confirmation must not silently drop a scheduling constraint. */
    request: {
      currentDate: string;
      trigger: import("../planning").PlannerTrigger;
      requestedScope?: import("../planning").PlannerRequest["requestedScope"];
      missedSessionDates?: readonly string[];
      transientRecoveryConstraint?: import("./domain").RecoveryConstraintData;
      transientNextSessionFocus?: import("../planning").PlannerRequest["transientNextSessionFocus"];
    };
    /** The durable Timeline risk evaluation that warranted this future-only preview. */
    sourceRiskEvaluationId?: string;
    /** Source Timeline events already represented by a user-requested future adjustment. */
    sourceTimelineEventIds?: readonly string[];
    sourcePreviewId?: string;
  };
  /** Initial Planner handoff uses the exclusive Agent Knowledge backend. */
  firstPlannerHandoff?: import("../onboarding").FirstPlannerHandoffProposal;
  phaseTransition?: import("../replanning").PhaseTransitionProposal;
}

export interface NutritionObservationDraftArtifact extends ArtifactBase {
  kind: "nutrition_observation_draft";
  userId: string;
  idempotencyKey: string;
  draft: import("../nutrition").NutritionObservationDraft;
}

/**
 * A typed record candidate assembled from a user statement when their Coach
 * mandate asks for a final tap before writing. The source statement remains
 * distinct from estimates and device-derived observations.
 */
export interface TimelineRecordDraftArtifact extends ArtifactBase {
  kind: "timeline_record_draft";
  userId: string;
  idempotencyKey: string;
  draft: {
    fact: import("./domain").TimelineFact;
    occurredAt: string;
    source: "user_statement" | "coach_estimate";
  };
}

/**
 * A durable admission/check record for the Timeline → risk seam. It does not
 * contain a risk score or a Plan proposal: those are supplied by the later
 * risk evaluator and PlannerHarness. Keeping the admission decision durable
 * makes an intentionally coalesced or skipped evaluation observable.
 */
export interface TimelineRiskEvaluationArtifact extends ArtifactBase {
  kind: "timeline_risk_evaluation";
  userId: string;
  phase: "timeline_changed" | "scheduled_check";
  disposition: "material" | "coalesced" | "skipped" | "stale" | "failed";
  outcome: "queued" | "review_due" | "no_review" | "insufficient_evidence" | "not_evaluated";
  timelineRevision: number;
  sourceFactRefs: readonly FactRef[];
  reasonCodes: readonly string[];
  causationIds: readonly string[];
  coalescesArtifactId?: string;
  /** Goal-aware assessment state when an evaluator has a configured Goal Contract. */
  achievabilityState?: import("./timelineRiskEvaluation").AchievabilityState;
}

/** A user-safe projection of a PlannerHarness lifecycle boundary. */
export interface PlannerProgressArtifact extends ArtifactBase {
  kind: "planner_progress";
  userId: string;
  stage: import("./planningProgress").PlannerProgressStage;
  factBasis: readonly string[];
  professionalClaims: readonly import("./planningProgress").VerifiedPlannerClaim[];
  cannotJudge: readonly string[];
  requestedInformation?: readonly string[];
  proposal?: import("./planningProgress").PlannerProgressProposalInput;
  message?: string;
}

/**
 * A version-pinned, confirmation-gated adjustment to a committed nutrition
 * strategy. It is an immutable proposal, never an intake record or a direct
 * strategy write.
 */
export interface NutritionChangeProposalArtifact extends ArtifactBase {
  kind: "nutrition_change_proposal";
  userId: string;
  nutritionStrategyId: string;
  baseStrategyRevision: number;
  mandateRevision: number;
  executionPolicy: "confirm" | "advice_only";
  proposal: import("../nutrition").NutritionChangeProposal;
}

/** A deterministic, non-diagnostic presentation of the latest local recovery constraint. */
export interface RecoveryBriefArtifact extends ArtifactBase {
  kind: "recovery_brief";
  userId: string;
  /** timeline_assessment is read-only and never pretends a proposal is a fact. */
  status: "active_constraint" | "no_active_constraint" | "expired_constraint" | "timeline_assessment";
  constraint?: import("./domain").RecoveryConstraintData;
  constraintRevision?: number;
}

/** A non-diagnostic, read-only presentation of an active local safety hold. */
export interface SafetyHoldArtifact extends ArtifactBase {
  kind: "safety_hold";
  userId: string;
  status: "active_hold" | "no_active_hold";
  constraint?: import("./domain").SafetyConstraintData;
  constraintRevision?: number;
}

/** Immutable presentation of a local NutritionStrategy; it never represents logged intake. */
export interface NutritionStrategyArtifact extends ArtifactBase {
  kind: "nutrition_strategy";
  userId: string;
  status: "active_strategy" | "paused_strategy" | "no_active_strategy";
  strategy?: import("./domain").NutritionStrategyData;
  strategyRevision?: number;
}

export type Artifact =
  | TodayPlanArtifact
  | PlanOverviewArtifact
  | PlanChangeProposalArtifact
  | ExerciseSubstitutionArtifact
  | ActionReceiptArtifact
  | SetSummaryArtifact
  | ReplanEvaluationArtifact
  | GoalForecastArtifact
  | WeeklyCoachReportArtifact
  | MesocycleReviewArtifact
  | EvidenceBriefArtifact
  | PlanTraceArtifact
  | TimelineRecordDraftArtifact
  | TimelineRiskEvaluationArtifact
  | PlannerProgressArtifact
  | NutritionObservationDraftArtifact
  | NutritionChangeProposalArtifact
  | RecoveryBriefArtifact
  | SafetyHoldArtifact
  | NutritionStrategyArtifact;

export type PresentationStatus =
  | "loading"
  | "ready"
  | "awaiting_user"
  | "applied"
  | "rejected"
  | "stale"
  | "undone"
  | "error";

/** Canonical identity supplied by the runtime that owns the current provider tool call. */
export interface ToolExecutionIdentity {
  runId: string;
  toolCallId: string;
}

export type CoachRunEvent =
  | {
      type: "tool-started";
      sessionId: string;
      runId: string;
      toolCallId: string;
      toolName: string;
      presentationId: string;
      occurredAt: string;
    }
  | {
      type: "tool-state";
      sessionId: string;
      runId: string;
      toolCallId: string;
      toolName: string;
      state: "input-streaming" | "input-available" | "output-available" | "output-error";
      occurredAt: string;
      errorCode?: string;
    }
  | {
      type: "artifact-ready";
      sessionId: string;
      runId: string;
      toolCallId: string;
      artifactRef: ArtifactRef;
      presentation: PresentationRef;
      occurredAt: string;
    }
  | {
      type: "artifact-updated";
      sessionId: string;
      runId: string;
      toolCallId: string;
      artifactRef: ArtifactRef;
      presentation: PresentationRef;
      occurredAt: string;
    }
  | {
      type: "text-delta";
      sessionId: string;
      runId: string;
      delta: string;
      occurredAt: string;
    }
  | {
      type: "run-completed";
      sessionId: string;
      runId: string;
      occurredAt: string;
    }
  | {
      type: "run-error";
      sessionId: string;
      runId: string;
      code:
        | "provider_error"
        | "invalid_tool_call"
        | "retryable"
        | "user_action_required"
        | "policy_rejected"
        | "stale"
        | "terminal_failure";
      message: string;
      /** 用户报错时口播/粘贴的短码；支持方按它拉出完整行为链（traceShortCode）。 */
      shortCode?: string;
      occurredAt: string;
    }
  | {
      type: "hitl-suspended" | "hitl-resumed";
      sessionId: string;
      runId: string;
      toolCallId: string;
      pendingActionId: string;
      presentationId: string;
      occurredAt: string;
    }
  | {
      type: "action-receipt";
      sessionId: string;
      runId: string;
      toolCallId: string;
      artifactRef: ArtifactRef;
      occurredAt: string;
    }
  | {
      type: "live-cue";
      sessionId: string;
      runId: string;
      presentationId: string;
      setId: string;
      message: string;
      occurredAt: string;
    };

export interface CardMetric {
  label: string;
  value: string;
}

export interface CardAction {
  id: string;
  label: string;
  enabled: boolean;
}

export interface ArtifactCardModel {
  renderer: string;
  eyebrow: string;
  artifactId: string;
  title: string;
  subtitle?: string;
  metrics: readonly CardMetric[];
  taskList: readonly PlanTask[];
  actions: readonly CardAction[];
  status: PresentationStatus;
  evidenceLabels: readonly string[];
  capabilityBoundary: readonly string[];
  /** Ordered, renderer-neutral content blocks for cards that need more than metrics. */
  sections?: readonly { title: string; items: readonly string[] }[];
}

export interface RuntimeServices {
  now(): string;
  nextId(prefix: string): string;
}

export interface ActionTokenRecord {
  token: string;
  userId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  artifactId: string;
  artifactHash: string;
  artifactSchemaVersion?: number;
  action: "apply" | "reject" | "undo" | "resume";
  expectedPlanRevision: number;
  expectedMandateRevision: number;
  expiresAt: string;
  nonce: string;
  pendingActionId?: string;
  consumedAt?: string;
  /** 过期清扫器标记的撤销时间；与真实消费（consumedAt）分开。 */
  revokedAt?: string;
}

export interface ActionEvent {
  id: string;
  userId: string;
  occurredAt: string;
  actor: "user" | "agent" | "rule_engine" | "sensor" | "sync";
  action:
    | "context.read"
    | "assessment.created"
    | "proposal.created"
    | "plan.change.applied"
    | "plan.change.rejected"
    | "plan.change.ignored"
    | "plan.change.undone"
    | "profile.corrected"
    | "timeline.corrected"
    | "workout.corrected"
    | "workout.set_skipped"
    | "memory.changed"
    | "timeline.source_changed"
    | "fact.written"
    | "timeline.draft.rejected"
    | "mandate.changed"
    | "data.lifecycle.changed"
    | "permission.changed"
    | "notification.scheduled"
    | "nutrition.draft.rejected"
    | "nutrition.strategy.proposed"
    | "nutrition.strategy.applied"
    | "nutrition.strategy.rejected"
    | "nutrition.strategy.undone";
  targetType:
    | "profile"
    | "goal"
    | "timeline"
    | "plan"
    | "workout"
    | "mandate"
    | "permission"
    | "safety"
    | "recovery"
    | "nutrition"
    | "equipment"
    | "exercise"
    | "notification"
    | "session"
    | "memory";
  targetId: string;
  scope: string;
  intent: string;
  beforeRevision?: number;
  afterRevision?: number;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly FactRef[];
  beforeRefs: readonly FactRef[];
  afterRefs: readonly FactRef[];
  ruleVersions: Readonly<Record<string, string>>;
  mandateRevision: number;
  result: "allowed" | "applied" | "rejected" | "undone" | "failed";
  undoBoundary: "compensating_revision" | "not_reversible" | "not_applicable";
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  policyDecision: "allow" | "deny" | "require_confirmation";
  humanDecision?: "confirmed" | "rejected";
  causationId: string;
  correlationId: string;
  reversible: boolean;
  undoneBy?: string;
}

export interface IdempotencyRecord {
  key: string;
  userId: string;
  resultArtifactId: string;
  occurredAt: string;
}

export interface HumanOption {
  id: string;
  label: string;
}

export interface PendingHumanAction {
  id: string;
  userId: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  kind: "choose_option";
  prompt: string;
  options: readonly HumanOption[];
  inputSchema?: Readonly<Record<string, unknown>>;
  allowedChoices?: readonly string[];
  factFrontier?: readonly FactRef[];
  evidenceRefs?: readonly FactRef[];
  capabilityVersions?: Readonly<Record<string, string>>;
  risk?: "low" | "review" | "high";
  presentationRef?: PresentationRef;
  expectedPlanRevision: number;
  expectedMandateRevision: number;
  resumeToken: string;
  status: "pending" | "resolved" | "stale" | "expired";
  createdAt: string;
  expiresAt: string;
  resolvedAt?: string;
  output?: { kind: "selected"; optionId: string };
}

export interface WorkingMemoryItem {
  id: string;
  userId: string;
  kind: "focus" | "hypothesis" | "open_question" | "strategy_note" | "preference";
  content: string;
  evidenceRefs: readonly FactRef[];
  provenance: {
    actor: "user" | "agent";
    sessionId?: string;
    runId?: string;
  };
  authority: "non_authoritative";
  confidence: number;
  version: number;
  expiresAt?: string;
  supersededBy?: string;
  sensitivity: "normal" | "private";
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ToolAuditRecord {
  id: string;
  userPseudonym: string;
  sessionId: string;
  runId: string;
  toolCallId?: string;
  phase:
    | "provider_request"
    | "provider_response"
    | "schema_validation"
    | "policy_decision"
    | "tool_execution"
    | "retry"
    | "internal_error";
  toolName?: string;
  outcome: "started" | "passed" | "rejected" | "failed" | "retryable";
  latencyMs?: number;
  metadata: Readonly<Record<string, string | number | boolean>>;
  occurredAt: string;
}

export type CoachRecipeKind =
  | "session_completed_assessment"
  | "morning_check_in"
  | "recovery_changed"
  | "today_plan_changed"
  | "missed_session_review"
  | "schedule_or_equipment_changed"
  | "weekly_review"
  | "deload_ended"
  | "fixed_reminder";

export type NotificationKind =
  | "today_plan_changed"
  | "next_workout_preview"
  | "missed_session_replan"
  | "recovery_change"
  | "deload_explanation"
  | "weekly_report"
  | "goal_deviation"
  | "record_reminder";

/**
 * User-owned notification controls. They are data only: the recipe registry
 * remains a closed set and no preference can introduce arbitrary background
 * work or a new message template.
 */
export interface RecipeNotificationSettings {
  /** Omitted means every notification kind supported by this recipe is enabled. */
  enabledNotificationKinds?: readonly NotificationKind[];
  /** A local-calendar cap for one recipe kind; defaults are registry-owned. */
  maxPerLocalDate?: number;
  /** Suppress delivery while the app has an active training context. */
  suppressDuringWorkout?: boolean;
  /** User-controlled local quiet window. It never overrides a system DND mode. */
  quietHours?: { start: string; end: string };
  /** A local product pause; system notification permissions remain separate. */
  doNotDisturb?: boolean;
}

export interface CoachRecipe {
  id: string;
  userId: string;
  kind: CoachRecipeKind;
  schemaVersion: 1;
  version: number;
  enabled: boolean;
  /** Only fixed reminders have a wall-clock schedule; other recipes are event-driven. */
  fixedReminder?: {
    localTime: string;
    timezoneOffsetMinutes: number;
    notificationKind: "record_reminder";
    quietHours?: { start: string; end: string };
  };
  notificationSettings?: RecipeNotificationSettings;
  createdAt: string;
  updatedAt: string;
}

export interface RecipeTrigger {
  id: string;
  recipeId: string;
  kind: CoachRecipeKind;
  occurredAt: string;
  causationId: string;
  idempotencyKey: string;
  factFrontier: readonly FactRef[];
  /** Version pins evaluated by deterministic local recipe steps. */
  ruleVersions: Readonly<Record<string, string>>;
  /**
   * Only a local health import may set `available`. `unavailable` deliberately
   * asks the template to fall back to a user check-in rather than implying a
   * recovery conclusion.
   */
  recoveryEvidence?: "available" | "unavailable";
  /** A trigger can carry local execution context, never arbitrary commands. */
  trainingInProgress?: boolean;
}

export interface ScheduledJob {
  id: string;
  userId: string;
  recipeId: string;
  recipeVersion: number;
  trigger: RecipeTrigger;
  earliestAt: string;
  latestAt: string;
  expiresAt: string;
  timezoneOffsetMinutes: number;
  localDateIntent: string;
  coalescingKey: string;
  /** `notification_scheduled` means handed to the OS, not delivered to the user. */
  status: "scheduled" | "running" | "notification_scheduled" | "delivered" | "skipped" | "expired" | "cancelled" | "failed";
  lastEvaluatedFrontier: readonly FactRef[];
  createdAt: string;
  updatedAt: string;
}

export interface JobAttempt {
  id: string;
  userId: string;
  jobId: string;
  attempt: number;
  startedAt: string;
  /** Omitted only while a platform scheduling call is in flight. */
  finishedAt?: string;
  outcome: "started" | "scheduled" | "delivered" | "skipped" | "expired" | "failed";
  reason: string;
  factFrontier: readonly FactRef[];
  causationId: string;
  correlationId: string;
}

export interface NotificationIntent {
  id: string;
  userId: string;
  jobId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  privacy: "lock_screen_safe";
  deepLink: { kind: "today" | "progress" | "workout"; ref: string };
  /** The local calendar date the user meant, independent of delivery timing. */
  localDateIntent: string;
  scheduledAt: string;
  status: "pending" | "scheduled" | "cancelled" | "failed";
  createdAt: string;
  updatedAt: string;
}

export interface NotificationReceipt {
  id: string;
  userId: string;
  notificationIntentId: string;
  event: "scheduled" | "delivered" | "tap" | "dismissed" | "cancelled" | "failed";
  occurredAt: string;
  errorCode?: string;
}

/**
 * Adapter-local import progress.  This is deliberately not a Timeline fact
 * and is never used as health evidence: it merely lets a provider resume a
 * page/anchor after an atomic local fact commit.
 */
export type HealthMetric =
  | "sleep"
  | "hrv_sdnn"
  | "hrv_rmssd"
  | "resting_heart_rate"
  | "activity"
  | "body_weight"
  | "body_fat_percentage";

export type HealthImportPlatform = "health_connect" | "healthkit" | "manual";
/**
 * `unknown` exists for privacy-preserving platforms such as HealthKit, which
 * deliberately do not reveal per-type read authorization. It must never be
 * displayed or treated as a positive grant; an actual query can still yield
 * no readable samples.
 */
export type HealthImportPermission = "granted" | "denied" | "not_supported" | "missing" | "unknown";

/**
 * Platform connection state, deliberately separate from per-metric consent.
 * A missing Health Connect provider is not evidence that the user has no
 * health history, while a running provider may still have no permission for a
 * particular record type.
 */
export type HealthAdapterAvailability =
  | "available"
  | "not_supported"
  | "provider_missing_or_update_required"
  | "permission_not_requested"
  | "permission_denied_or_revoked"
  | "temporarily_unavailable"
  | "query_error";

export interface HealthImportState {
  id: string;
  userId: string;
  platform: HealthImportPlatform;
  version: number;
  adapterSchemaVersion: string;
  metricTypes: readonly HealthMetric[];
  /** Opaque provider token/anchor; it is never placed in Timeline or prompts. */
  cursor?: string;
  permissionByMetric: Readonly<Partial<Record<HealthMetric, HealthImportPermission>>>;
  capabilityByMetric: Readonly<Partial<Record<HealthMetric, "supported" | "not_supported">>>;
  /** Last adapter outcome; omitted only for snapshots written before this contract. */
  availability?: HealthAdapterAvailability;
  /** Bounded provider-page state, retained so foreground/background catch-up can resume. */
  hasMore?: boolean;
  /** The adapter has not yet finished the stated bounded initial history window. */
  initialSyncPending?: boolean;
  consentRevision: number;
  lastAttemptAt: string;
  lastSuccessfulImportAt?: string;
  lastErrorCode?: string;
}

export interface LedgerSnapshot {
  ledgerSchemaVersion: number;
  sessions: readonly CoachSession[];
  messages: readonly CoachMessage[];
  runs: readonly CoachRunRecord[];
  toolCalls: readonly CoachToolCallRecord[];
  users: readonly UserState[];
  artifacts: readonly Artifact[];
  presentations: readonly PresentationRef[];
  runEvents: readonly CoachRunEvent[];
  actionTokens: readonly ActionTokenRecord[];
  actionEvents: readonly ActionEvent[];
  toolAudit: readonly ToolAuditRecord[];
  idempotency: readonly IdempotencyRecord[];
  pendingHumanActions: readonly PendingHumanAction[];
  workingMemory: readonly WorkingMemoryItem[];
  domainEvents: readonly DomainEvent[];
  aggregateRevisions: readonly AggregateRevisionState[];
  domainIdempotency: readonly DomainIdempotencyRecord[];
  outbox: readonly OutboxEntry[];
  onboardingDraftEvents: readonly OnboardingDraftEvent[];
  coachRecipes: readonly CoachRecipe[];
  scheduledJobs: readonly ScheduledJob[];
  jobAttempts: readonly JobAttempt[];
  notificationIntents: readonly NotificationIntent[];
  notificationReceipts: readonly NotificationReceipt[];
  healthImportStates: readonly HealthImportState[];
  replicaSyncStates: readonly import("../sync").ReplicaSyncState[];
  pendingReplicaEnvelopes: readonly import("../sync").PendingReplicaEnvelope[];
  /** 远程 trace 上报的离线 outbox；授权关闭时永远为空。 */
  traceOutbox: readonly import("../observability/model").TraceOutboxEntry[];
}
