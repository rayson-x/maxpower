import type { KnowledgeVersionPins } from "../knowledge/model";
import type {
  AggregateRevisionState,
  DomainEvent,
  DomainIdempotencyRecord,
  OutboxEntry,
} from "./domain";

export type CoachSessionStatus = "active" | "suspended" | "completed" | "archived";
/**
 * A conversation is its own durable task identity. Product surfaces can be
 * attached to an individual turn, but must never become the session key.
 */
export type CoachContextKind = "conversation" | "today" | "calendar" | "plan" | "workout" | "profile";

export interface ContextRef {
  kind: CoachContextKind;
  ref: string;
}

export interface CoachSession {
  id: string;
  userId: string;
  status: CoachSessionStatus;
  context: ContextRef;
  taskKind?: "today_plan" | "workout_execution" | "plan_adjustment" | "weekly_report" | "general";
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
  /** Stable client command identity used to collapse retries of one turn. */
  clientTurnId?: string;
  status: "streaming" | "awaiting_user" | "resuming" | "completed" | "interrupted" | "failed";
  /** Pins the local behavioral contract for this run even when one durable thread crosses stages. */
  agentMode?: "planning";
  factFrontier: readonly FactRef[];
  contextManifestHash: string;
  /** The selected local/remote language layer for replay and disclosure only. */
  provider?: {
    kind: string;
    model?: string;
    configurationFingerprint?: string;
  };
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
  goal: "hypertrophy" | "fat_loss" | "strength" | "conditioning" | "health" | "physique" | "maintain" | "return_to_training";
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
  | "weekly_coach_report"
  | "evidence_brief"
  | "timeline_record_draft"
  | "nutrition_observation_draft"
  | "recovery_brief"
  | "nutrition_strategy"
  | "daily_health_ledger"
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

/** Immutable, evidence-linked summary of an already-ended calendar week. */
export interface WeeklyCoachReportArtifact extends ArtifactBase {
  kind: "weekly_coach_report";
  userId: string;
  report: import("../replanning").WeeklyCoachReport;
  window: { start: string; end: string };
  idempotencyKey: string;
}

/** Evidence-only explanation for a card or coach answer, never a fact write. */
export interface EvidenceBriefArtifact extends ArtifactBase {
  kind: "evidence_brief";
  userId: string;
  title: string;
  summary: readonly string[];
  /** Causal identity for a card emitted from the Pi conversation harness. */
  conversationTrace?: { sessionId: string; runId?: string; toolCallId?: string };
  /**
   * A bounded, interaction-first card emitted by the local Conversation
   * module.  It is deliberately data, not a route or a component command:
   * the mobile client renders it in the same durable thread and never lets a
   * model navigate the product.
   */
  conversationCard?:
    | {
        kind: "baseline";
        status: "ready" | "submitted" | "stale";
        /** Incomplete local form values; they become facts only when submitted. */
        draft?: { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string; revision: number };
        /** Confirmed values remain as a read-only card in the same thread. */
        submitted?: { ageYears: number; heightCm: number; weightKg: number; goalText?: string };
      }
    | {
        /** An Agent-composed dynamic intake form. fields come only from the
         * closed intake field registry; every field is optional, and submitted
         * values keep their provenance on this card. */
        kind: "intake_form";
        status: "ready" | "submitted" | "stale";
        reason: string;
        fields: readonly string[];
        values?: Readonly<Record<string, string>>;
      }
    | {
        kind: "choice";
        status: "ready" | "resolved" | "stale";
        prompt: string;
        options: readonly { id: string; label: string; detail?: string }[];
      }
    | {
        kind: "goal_path";
        status: "awaiting_confirmation" | "confirmed" | "rejected" | "stale";
        goal: import("./domain").GoalContractData;
        options: readonly {
          id: "gradual" | "balanced" | "faster";
          targetWeeks: number;
          behaviorBurden: "low" | "moderate" | "high";
          trainingBurden: "low" | "moderate" | "high";
          recordingBurden: "minimum_weekly" | "representative_days" | "high_coverage";
          feasible: boolean;
          conflictReasons: readonly string[];
        }[];
      }
    | {
        kind: "receipt";
        status: "recorded" | "confirmed" | "rejected";
        label: string;
        detail?: string;
        /** A written record offers an in-place correction entry. */
        correctable?: boolean;
      }
    | {
        kind: "record_confirmation";
        status: "awaiting_confirmation" | "confirmed" | "rejected" | "stale";
        record: unknown;
        label: string;
      }
    | {
        kind: "plan_candidate";
        status: "awaiting_confirmation" | "confirmed" | "rejected" | "stale" | "invalid";
        proposalId: string;
        title: string;
        summary: readonly string[];
        /**
         * A self-contained review payload. It deliberately contains rendered
         * facts rather than navigation targets so a confirmed proposal remains
         * understandable when the conversation is reopened later.
         */
        details?: {
          sessions: readonly {
            date: string;
            title: string;
            durationMinutes?: number;
            taskCount: number;
            setCount: number;
          }[];
          nutrition?: {
            calorieRange?: { min: number; max: number; unit: "kcal" };
            macronutrients?: readonly string[];
            nutrientTargets?: readonly string[];
            reviewWindow?: string;
          };
          behaviorChanges: readonly { instruction: string; burden: "low" | "moderate" | "high" }[];
          rationale: readonly string[];
          tradeoffs: readonly string[];
          observation: readonly string[];
          diff: readonly string[];
          validation: {
            status: "valid" | "invalid";
            impact: "low" | "high";
            resolution: "confirmation_required" | "auto_apply_once_eligible" | "auto_apply_eligible";
            issues: readonly string[];
          };
        };
      };
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
  /** Initial Planner handoff uses the exclusive Agent Knowledge backend. */
  /**
   * Fixed, typed input envelope for one planning run. The Agent may organize
   * a candidate from this data, but it cannot choose a different Goal,
   * maintenance baseline, safety state or source assessment.
   */
  planningInput?: {
    mode: "first_plan" | "adjustment";
    evaluationDate: string;
    profileRef: { id: string; revision: number };
    goalContract: { revision: number; value: import("./domain").GoalContractData };
    mandate: { revision: number; planChangeAuthorization: import("./domain").CoachingMandateData["planChangeAuthorization"] };
    knowledgePins: import("../knowledge/model").KnowledgeVersionPins;
    planBase?: { id: string; revision: number };
    nutritionStrategyBase?: { id: string; revision: number };
    allowedEnergyRange?: { min: number; max: number; unit: "kcal" };
    latestLedger?: {
      date: string;
      version: string;
      coverage: import("../health").DailyHealthLedger["coverage"];
      energyBalance: import("../health").DailyHealthLedger["energyBalance"];
    };
    sourceAssessment?: {
      id: string;
      state: import("../goal-path").GoalPathAssessment["state"];
      diagnosis: import("../goal-path").GoalPathAssessment["diagnosis"];
      reasonCodes: readonly string[];
      nextValidationSignals: readonly string[];
    };
    safetyBlocked: boolean;
  };
  adaptivePlanProposal?: {
    status: "awaiting_confirmation" | "stale" | "applied" | "rejected" | "undone";
    candidate: import("../planning").AdaptivePlanCandidate;
    validation: import("../planning").AdaptivePlanValidation;
    snapshot: {
      evaluationDate: string;
      profileRevision: number;
      goalRevision: number;
      planRevision: number;
      nutritionStrategyRevision: number;
      timelineRevision: number;
      mandateRevision: number;
      readinessFingerprint: string;
      safetyFingerprint: string;
      knowledgeHash: string;
    };
    counterfactual?: import("../goal-path").GoalPathCandidateCounterfactual;
    /** Exact aggregate revisions written by this applied proposal. */
    appliedCommit?: {
      plan: { id: string; revision: number };
      nutritionStrategy?: { id: string; revision: number };
    };
  };
  adaptivePlanCandidateFeedback?: {
    runId: string;
    attempt: 1 | 2;
    canRetry: boolean;
    issues: import("../planning").AdaptivePlanValidation["issues"];
  };
  /** Deterministic GoalPath output. Prose may explain it, but cannot replace or mutate it. */
  goalPathAssessment?: {
    assessment: import("../goal-path").GoalPathAssessment;
    channel: "agent_conversation" | "manual_home" | "scheduled";
    delivery: "same_run" | "home" | "notification" | "suppressed";
    suppressionReason?: "no_material_signal" | "duplicate" | "cooldown" | "plan_inactive" | "stale";
  };
  goalPathAudit?: {
    status: "evaluated" | "skipped" | "coalesced" | "suppressed" | "stale" | "failed";
    trigger: import("../goal-path").GoalPathAssessment["trigger"];
    sourceAssessmentId?: string;
    reasonCodes: readonly string[];
  };
  /** Durable, user-inspectable planning evidence; never a hidden preference profile. */
  planOutcome?: import("../planning").PlanOutcome;
  goalCompletionProposal?: {
    status: "awaiting_confirmation" | "rejected" | "completed" | "stale";
    goalId: string;
    goalRevision: number;
    planId: string;
    planRevision: number;
    timelineRevision: number;
    sourceAssessmentId: string;
    measurementEventIds: readonly string[];
    /** Durable post-completion route chosen by the user; survives restart. */
    next?: "record_first" | "maintenance_planning" | "goal_negotiation";
  };
  planPauseProposal?: {
    status: "awaiting_confirmation" | "confirmed" | "rejected";
    planId: string;
    planRevision: number;
    timelineRevision: number;
  };
  goalNegotiationProposal?: {
    status: "awaiting_confirmation" | "confirmed" | "rejected";
    goal: import("./domain").GoalContractData;
    options: readonly import("../goal-path").GoalPathOption[];
  };
}

export interface NutritionObservationDraftArtifact extends ArtifactBase {
  kind: "nutrition_observation_draft";
  userId: string;
  idempotencyKey: string;
  draft: import("../nutrition").NutritionObservationDraft;
}

/**
 * A typed record candidate assembled from a user statement when their Coach
 * mandate asks for a final tap before writing. Agent-created estimates are not
 * admitted through this boundary.
 */
export interface TimelineRecordDraftArtifact extends ArtifactBase {
  kind: "timeline_record_draft";
  userId: string;
  idempotencyKey: string;
  draft: {
    fact: import("./domain").TimelineFact;
    occurredAt: string;
    source: "manual_form" | "user_statement";
  };
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

/** Immutable, versioned result of the single formal daily calculation engine. */
export interface DailyHealthLedgerArtifact extends ArtifactBase {
  kind: "daily_health_ledger";
  userId: string;
  date: string;
  ledger: import("../health").DailyHealthLedger;
}

export type Artifact =
  | WeeklyCoachReportArtifact
  | EvidenceBriefArtifact
  | TimelineRecordDraftArtifact
  | NutritionObservationDraftArtifact
  | RecoveryBriefArtifact
  | SafetyHoldArtifact
  | DailyHealthLedgerArtifact
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
  deepLink: { kind: "today" | "plan" | "workout"; ref: string };
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
  artifacts: readonly Artifact[];
  presentations: readonly PresentationRef[];
  runEvents: readonly CoachRunEvent[];
  actionTokens: readonly ActionTokenRecord[];
  actionEvents: readonly ActionEvent[];
  toolAudit: readonly ToolAuditRecord[];
  pendingHumanActions: readonly PendingHumanAction[];
  workingMemory: readonly WorkingMemoryItem[];
  domainEvents: readonly DomainEvent[];
  aggregateRevisions: readonly AggregateRevisionState[];
  domainIdempotency: readonly DomainIdempotencyRecord[];
  outbox: readonly OutboxEntry[];
  coachRecipes: readonly CoachRecipe[];
  scheduledJobs: readonly ScheduledJob[];
  jobAttempts: readonly JobAttempt[];
  notificationIntents: readonly NotificationIntent[];
  notificationReceipts: readonly NotificationReceipt[];
  healthImportStates: readonly HealthImportState[];
  /** 远程 trace 上报的离线 outbox；授权关闭时永远为空。 */
  traceOutbox: readonly import("../observability/model").TraceOutboxEntry[];
}
