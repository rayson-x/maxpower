export type CoachSessionStatus = "active" | "suspended" | "completed" | "archived";
export type CoachContextKind = "today" | "calendar" | "progress" | "workout" | "profile";

export interface ContextRef {
  kind: CoachContextKind;
  ref: string;
}

export interface CoachSession {
  id: string;
  userId: string;
  status: CoachSessionStatus;
  context: ContextRef;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  goal: "hypertrophy" | "fat_loss" | "strength" | "conditioning" | "health";
  trainingExperience: "beginner" | "intermediate" | "advanced";
  name?: string;
  address?: string;
  email?: string;
  phone?: string;
}

export interface PlanTask {
  id: string;
  name: string;
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
  aggregate: "profile" | "plan" | "timeline" | "workout" | "memory";
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
  | "plan_change_proposal"
  | "action_receipt"
  | "set_summary";

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
}

export interface TodayPlanArtifact extends ArtifactBase {
  kind: "today_plan";
  date: string;
  title: string;
  planRevision: number;
  tasks: readonly PlanTask[];
}

export interface AdjustTaskChange {
  kind: "adjust_task";
  taskId: string;
  sets?: number;
  reps?: string;
  loadKg?: number;
  targetRir?: number;
  restSeconds?: number;
}

export interface PlanChangeProposalArtifact extends ArtifactBase {
  kind: "plan_change_proposal";
  basePlanRevision: number;
  mandateRevision: number;
  change: AdjustTaskChange;
  before: Readonly<Record<string, string | number | undefined>>;
  after: Readonly<Record<string, string | number | undefined>>;
  reason: string;
  risk: "low" | "review" | "blocked";
  executionPolicy: "confirm" | "managed" | "advice_only";
  supersedesArtifactId?: string;
}

export interface ActionReceiptArtifact extends ArtifactBase {
  kind: "action_receipt";
  action: "apply" | "reject" | "undo";
  targetArtifactId: string;
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

export type Artifact =
  | TodayPlanArtifact
  | PlanChangeProposalArtifact
  | ActionReceiptArtifact
  | SetSummaryArtifact;

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
      type: "artifact-ready";
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
      code: "provider_error" | "invalid_tool_call";
      message: string;
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
  action: "apply" | "reject" | "undo";
  expectedPlanRevision: number;
  expectedMandateRevision: number;
  expiresAt: string;
  nonce: string;
  consumedAt?: string;
}

export interface ActionEvent {
  id: string;
  userId: string;
  occurredAt: string;
  actor: "user" | "agent" | "rule_engine" | "sensor" | "sync";
  action: "plan.change.applied" | "plan.change.rejected" | "plan.change.undone";
  targetType: "plan";
  targetId: string;
  beforeRevision?: number;
  afterRevision?: number;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  evidenceRefs: readonly FactRef[];
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
    runId?: string;
  };
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

export interface LedgerSnapshot {
  sessions: readonly CoachSession[];
  users: readonly UserState[];
  artifacts: readonly Artifact[];
  presentations: readonly PresentationRef[];
  runEvents: readonly CoachRunEvent[];
  actionTokens: readonly ActionTokenRecord[];
  actionEvents: readonly ActionEvent[];
  idempotency: readonly IdempotencyRecord[];
  pendingHumanActions: readonly PendingHumanAction[];
  workingMemory: readonly WorkingMemoryItem[];
}
