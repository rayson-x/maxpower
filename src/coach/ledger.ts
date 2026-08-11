import type {
  ActionEvent,
  ActionTokenRecord,
  Artifact,
  CoachMessage,
  CoachRunRecord,
  CoachRunEvent,
  CoachSession,
  CoachToolCallRecord,
  LedgerSnapshot,
  PresentationRef,
  PendingHumanAction,
  CoachRecipe,
  ScheduledJob,
  JobAttempt,
  NotificationIntent,
  NotificationReceipt,
  ToolAuditRecord,
  UserState,
  WorkingMemoryItem,
} from "./model";
import {
  COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION,
  DOMAIN_EVENT_SCHEMA_VERSION,
  projectDomainEvents,
  type DomainAggregateRef,
  type DomainCommandResult,
  type DomainEvent,
  type DomainProjection,
  type DomainProjectionQuery,
  type OutboxEntry,
} from "./domain";
import { TRACE_OUTBOX_RETENTION, type TraceOutboxEntry } from "../observability/model";
import { clone, stableHash } from "./stable";
import {
  ONBOARDING_DRAFT_SCHEMA_VERSION,
  type OnboardingDraftEvent,
} from "../onboarding/model";

export interface CoachLedger {
  read(): Promise<LedgerSnapshot>;
  replace(snapshot: LedgerSnapshot): Promise<void>;
  /** A restore may only switch in a pre-validated staging area if no writer changed its source. */
  swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void>;
  readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection>;
  diagnose(): Promise<CoachLedgerDiagnostics>;
  commit(input: AtomicCommit): Promise<AtomicCommitResult>;
  commit(input: DomainAtomicCommit): Promise<DomainCommandResult>;
}

export interface StagedLedgerRestore {
  expectedSnapshotHash: string;
  nextSnapshot: LedgerSnapshot;
}

export const EMPTY_LEDGER_SNAPSHOT: LedgerSnapshot = {
  ledgerSchemaVersion: COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION,
  sessions: [],
  messages: [],
  runs: [],
  toolCalls: [],
  users: [],
  artifacts: [],
  presentations: [],
  runEvents: [],
  actionTokens: [],
  actionEvents: [],
  toolAudit: [],
  idempotency: [],
  pendingHumanActions: [],
  workingMemory: [],
  domainEvents: [],
  aggregateRevisions: [],
  domainIdempotency: [],
  outbox: [],
  onboardingDraftEvents: [],
  coachRecipes: [],
  scheduledJobs: [],
  jobAttempts: [],
  notificationIntents: [],
  notificationReceipts: [],
  healthImportStates: [],
  replicaSyncStates: [],
  pendingReplicaEnvelopes: [],
  traceOutbox: [],
};

export class InMemoryCoachLedger implements CoachLedger {
  private snapshot: LedgerSnapshot;

  constructor(seed: LedgerSnapshot = EMPTY_LEDGER_SNAPSHOT) {
    this.snapshot = normalizeLedgerSnapshot(seed);
  }

  async read(): Promise<LedgerSnapshot> {
    return clone(this.snapshot);
  }

  async replace(snapshot: LedgerSnapshot): Promise<void> {
    this.snapshot = normalizeLedgerSnapshot(snapshot);
  }

  async swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void> {
    if (stableHash(this.snapshot) !== input.expectedSnapshotHash) {
      throw new LedgerConflictError("stale_snapshot");
    }
    this.snapshot = normalizeLedgerSnapshot(input.nextSnapshot);
  }

  async readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection> {
    return projectDomainEvents(this.snapshot.domainEvents, query);
  }

  async diagnose(): Promise<CoachLedgerDiagnostics> {
    return diagnoseLedgerSnapshot(this.snapshot);
  }

  async commit(input: AtomicCommit): Promise<AtomicCommitResult>;
  async commit(input: DomainAtomicCommit): Promise<DomainCommandResult>;
  async commit(input: AtomicCommit | DomainAtomicCommit): Promise<AtomicCommitResult | DomainCommandResult> {
    const applied = isDomainAtomicCommit(input)
      ? applyDomainAtomicCommitTransition(this.snapshot, input)
      : applyAtomicCommitTransition(this.snapshot, input);
    this.snapshot = applied.snapshot;
    return applied.result;
  }
}

export function applyCoachLedgerCommitTransition(
  snapshot: LedgerSnapshot,
  input: AtomicCommit,
): { snapshot: LedgerSnapshot; result: AtomicCommitResult };
export function applyCoachLedgerCommitTransition(
  snapshot: LedgerSnapshot,
  input: DomainAtomicCommit,
): { snapshot: LedgerSnapshot; result: DomainCommandResult };
export function applyCoachLedgerCommitTransition(
  snapshot: LedgerSnapshot,
  input: AtomicCommit | DomainAtomicCommit,
): {
  snapshot: LedgerSnapshot;
  result: AtomicCommitResult | DomainCommandResult;
} {
  return isDomainAtomicCommit(input)
    ? applyDomainAtomicCommitTransition(snapshot, input)
    : applyAtomicCommitTransition(snapshot, input);
}

export function applyAtomicCommitTransition(
  snapshot: LedgerSnapshot,
  input: AtomicCommit,
): { snapshot: LedgerSnapshot; result: AtomicCommitResult } {
  const duplicate = snapshot.idempotency.find(
    (record) => record.userId === input.userId && record.key === input.idempotencyKey,
  );
  if (duplicate) {
    return {
      snapshot,
      result: { status: "idempotent", resultArtifactId: duplicate.resultArtifactId },
    };
  }
  const user = snapshot.users.find((candidate) => candidate.userId === input.userId);
  if (!user || user.plan.revision !== input.expectedPlanRevision) {
    throw new LedgerConflictError("stale_plan");
  }
  if (user.mandate.revision !== input.expectedMandateRevision) {
    throw new LedgerConflictError("stale_mandate");
  }
  if (
    input.session &&
    (snapshot.sessions.find((candidate) => candidate.id === input.session?.id)?.revision ?? 1) !==
      input.expectedSessionRevision
  ) {
    throw new LedgerConflictError("stale_aggregate");
  }
  const token = snapshot.actionTokens.find((candidate) => candidate.token === input.consumeToken);
  if (!token || token.consumedAt || token.userId !== input.userId) {
    throw new LedgerConflictError("invalid_token");
  }
  const resultArtifact = input.artifacts.at(-1);
  if (!resultArtifact) throw new Error("AtomicCommit requires a result artifact");
  const nextUser: UserState = { ...user, plan: clone(input.plan) };
  const tokensToClose = new Set([input.consumeToken, ...(input.invalidateTokens ?? [])]);
  const closedTokens: ActionTokenRecord[] = snapshot.actionTokens
    .filter((candidate) => tokensToClose.has(candidate.token))
    .map((candidate) => ({ ...candidate, consumedAt: input.occurredAt }));
  const next = clone({
    ...snapshot,
    users: [...snapshot.users.filter((candidate) => candidate.userId !== user.userId), nextUser],
    sessions: input.session ? upsertById(snapshot.sessions, [input.session]) : snapshot.sessions,
    artifacts: [
      ...snapshot.artifacts.filter(
        (existing) => !input.artifacts.some((artifact) => artifact.id === existing.id),
      ),
      ...input.artifacts,
    ],
    presentations: [
      ...snapshot.presentations.filter(
        (existing) => !input.presentations.some((item) => item.id === existing.id),
      ),
      ...input.presentations,
    ],
    runEvents: [...snapshot.runEvents, ...input.runEvents],
    actionTokens: [
      ...snapshot.actionTokens.filter((candidate) => !tokensToClose.has(candidate.token)),
      ...closedTokens,
      ...(input.issueTokens ?? []),
    ],
    actionEvents: [
      ...snapshot.actionEvents.filter(
        (existing) => !(input.updateActionEvents ?? []).some((event) => event.id === existing.id),
      ),
      ...(input.updateActionEvents ?? []),
      input.actionEvent,
    ],
    idempotency: [
      ...snapshot.idempotency,
      {
        key: input.idempotencyKey,
        userId: input.userId,
        resultArtifactId: resultArtifact.id,
        occurredAt: input.occurredAt,
      },
    ],
  });
  return {
    snapshot: next,
    result: { status: "committed", resultArtifactId: resultArtifact.id },
  };
}

export interface AtomicCommit {
  userId: string;
  expectedPlanRevision: number;
  expectedMandateRevision: number;
  plan: UserState["plan"];
  session?: CoachSession;
  expectedSessionRevision?: number;
  artifacts: readonly Artifact[];
  presentations: readonly PresentationRef[];
  runEvents: readonly CoachRunEvent[];
  actionEvent: ActionEvent;
  updateActionEvents?: readonly ActionEvent[];
  consumeToken: string;
  invalidateTokens?: readonly string[];
  issueTokens?: readonly ActionTokenRecord[];
  idempotencyKey: string;
  occurredAt: string;
}

export interface AtomicCommitResult {
  status: "committed" | "idempotent";
  resultArtifactId: string;
}

export interface DomainAtomicCommit {
  kind: "domain";
  userId: string;
  actorId: string;
  intent: string;
  expectedRevisions: readonly DomainAggregateRef[];
  expectedSessionRevisions?: readonly { id: string; revision: number }[];
  expectedWorkingMemoryVersions?: readonly { id: string; version: number }[];
  expectedPendingHumanActionStatuses?: readonly {
    id: string;
    status: PendingHumanAction["status"] | "missing";
  }[];
  domainEvents: readonly DomainEvent[];
  draftEvents?: readonly OnboardingDraftEvent[];
  artifacts?: readonly Artifact[];
  sessions?: readonly CoachSession[];
  messages?: readonly CoachMessage[];
  runs?: readonly CoachRunRecord[];
  toolCalls?: readonly CoachToolCallRecord[];
  presentations?: readonly PresentationRef[];
  runEvents?: readonly CoachRunEvent[];
  actionEvents?: readonly ActionEvent[];
  toolAudit?: readonly ToolAuditRecord[];
  workingMemoryItems?: readonly WorkingMemoryItem[];
  pendingHumanActions?: readonly PendingHumanAction[];
  consumeTokens?: readonly string[];
  issueTokens?: readonly ActionTokenRecord[];
  /** 既有 token 的受控更新（目前仅用于过期清扫器标记 revokedAt）。 */
  updateActionTokens?: readonly ActionTokenRecord[];
  outbox?: readonly OutboxEntry[];
  coachRecipes?: readonly CoachRecipe[];
  scheduledJobs?: readonly ScheduledJob[];
  jobAttempts?: readonly JobAttempt[];
  notificationIntents?: readonly NotificationIntent[];
  notificationReceipts?: readonly NotificationReceipt[];
  healthImportStates?: readonly import("./model").HealthImportState[];
  expectedHealthImportStateVersions?: readonly { id: string; version: number }[];
  /** Existing outbox entries can only be advanced by the local synchronizer. */
  updateOutbox?: readonly OutboxEntry[];
  replicaSyncStates?: readonly import("../sync").ReplicaSyncState[];
  pendingReplicaEnvelopes?: readonly import("../sync").PendingReplicaEnvelope[];
  /** 新入队的远程 trace 条目；已存在同 eventId 的条目会被忽略（插入即去重）。 */
  traceOutbox?: readonly TraceOutboxEntry[];
  /** 既有 trace 条目的状态推进；只有本地调度器可以写。 */
  updateTraceOutbox?: readonly TraceOutboxEntry[];
  idempotencyKey: string;
  recordedAt: string;
}

export interface CoachLedgerDiagnostics {
  schemaVersion: number;
  pendingMigrations: readonly number[];
  domainEventCount: number;
  aggregateCount: number;
  outboxBacklog: number;
  projectionLag: number;
  corruptEventIds: readonly string[];
  latestRecordedAt?: string;
  projectionRebuildable: boolean;
}

export class LedgerConflictError extends Error {
  constructor(
    readonly code:
      | "stale_plan"
      | "stale_mandate"
      | "invalid_token"
      | "stale_aggregate"
      | "invalid_domain_event"
      | "invalid_reference"
      | "cross_user_reference"
      | "duplicate_event"
      | "invalid_unit"
      | "stale_snapshot",
  ) {
    super(code);
    this.name = "LedgerConflictError";
  }
}

export function applyDomainAtomicCommitTransition(
  rawSnapshot: LedgerSnapshot,
  input: DomainAtomicCommit,
): { snapshot: LedgerSnapshot; result: DomainCommandResult } {
  const snapshot = normalizeLedgerSnapshot(rawSnapshot);
  const duplicate = snapshot.domainIdempotency.find(
    (record) =>
      record.userId === input.userId &&
      record.actorId === input.actorId &&
      record.intent === input.intent &&
      record.key === input.idempotencyKey,
  );
  if (duplicate) {
    return {
      snapshot: rawSnapshot,
      result: {
        status: "idempotent",
        eventIds: duplicate.eventIds,
        aggregateRevisions: duplicate.aggregateRevisions,
      },
    };
  }
  if (!input.userId || !input.actorId || !input.intent || !input.idempotencyKey) {
    throw new LedgerConflictError("invalid_domain_event");
  }
  if (input.domainEvents.length === 0 && !(input.draftEvents?.length) && !hasRuntimeMutation(input)) {
    throw new LedgerConflictError("invalid_domain_event");
  }

  validateRuntimeCas(snapshot, input);

  const expectedByAggregate = new Map(
    input.expectedRevisions.map((ref) => [aggregateKey(ref.kind, ref.id), ref.revision]),
  );
  const existingByAggregate = new Map(
    snapshot.aggregateRevisions.map((state) => [aggregateKey(state.kind, state.id), state]),
  );
  for (const expected of input.expectedRevisions) {
    const current = existingByAggregate.get(aggregateKey(expected.kind, expected.id));
    if (current && current.userId !== input.userId) {
      throw new LedgerConflictError("cross_user_reference");
    }
    if ((current?.revision ?? 0) !== expected.revision) {
      throw new LedgerConflictError("stale_aggregate");
    }
  }

  const knownEventIds = new Set(snapshot.domainEvents.map((event) => event.id));
  const batchEventIds = new Set<string>();
  const nextAggregateStates = new Map(existingByAggregate);
  const availableEvents: DomainEvent[] = [...snapshot.domainEvents];
  for (const event of input.domainEvents) {
    validateDomainEventEnvelope(event, input, knownEventIds, batchEventIds);
    const key = aggregateKey(event.aggregate.kind, event.aggregate.id);
    const current = nextAggregateStates.get(key);
    if (current && current.userId !== input.userId) {
      throw new LedgerConflictError("cross_user_reference");
    }
    if (!expectedByAggregate.has(key)) {
      throw new LedgerConflictError("stale_aggregate");
    }
    const currentRevision = current?.revision ?? 0;
    if (event.aggregate.revision !== currentRevision + 1) {
      throw new LedgerConflictError("stale_aggregate");
    }
    validateDomainEventState(event, current, nextAggregateStates, input.userId);
    validateDomainEventReferences(event, availableEvents, nextAggregateStates, input.userId);
    const archived = event.name === "aggregate.archived"
      ? true
      : event.name === "aggregate.restored"
        ? false
        : (current?.archived ?? false);
    nextAggregateStates.set(key, {
      kind: event.aggregate.kind,
      id: event.aggregate.id,
      userId: input.userId,
      revision: event.aggregate.revision,
      archived,
    });
    availableEvents.push(event);
    batchEventIds.add(event.id);
  }
  const knownDraftEventIds = new Set(snapshot.onboardingDraftEvents.map((event) => event.id));
  const batchDraftEventIds = new Set<string>();
  for (const draftEvent of input.draftEvents ?? []) {
    if (
      !draftEvent.id ||
      draftEvent.schemaVersion !== ONBOARDING_DRAFT_SCHEMA_VERSION ||
      draftEvent.userId !== input.userId ||
      !draftEvent.draftId ||
      !Number.isFinite(Date.parse(draftEvent.recordedAt))
    ) {
      throw new LedgerConflictError("invalid_domain_event");
    }
    if (knownDraftEventIds.has(draftEvent.id) || batchDraftEventIds.has(draftEvent.id)) {
      throw new LedgerConflictError("duplicate_event");
    }
    batchDraftEventIds.add(draftEvent.id);
  }

  const consumedTokens = new Set(input.consumeTokens ?? []);
  const tokenUpdates = new Map(
    (input.updateActionTokens ?? []).map((token) => [token.token, token] as const),
  );
  for (const tokenValue of consumedTokens) {
    const token = snapshot.actionTokens.find((candidate) => candidate.token === tokenValue);
    if (!token || token.userId !== input.userId || token.consumedAt) {
      throw new LedgerConflictError("invalid_token");
    }
  }
  for (const updatedToken of input.updateActionTokens ?? []) {
    const currentToken = snapshot.actionTokens.find(
      (candidate) => candidate.token === updatedToken.token,
    );
    if (
      !currentToken ||
      currentToken.userId !== input.userId ||
      updatedToken.userId !== input.userId ||
      currentToken.consumedAt ||
      currentToken.artifactId !== updatedToken.artifactId ||
      currentToken.artifactHash !== updatedToken.artifactHash ||
      currentToken.action !== updatedToken.action ||
      currentToken.nonce !== updatedToken.nonce
    ) {
      throw new LedgerConflictError("invalid_token");
    }
  }
  for (const outbox of input.outbox ?? []) {
    if (
      outbox.userId !== input.userId ||
      !batchEventIds.has(outbox.domainEventId) ||
      !outbox.id ||
      !outbox.replicaId ||
      !outbox.deviceId ||
      !outbox.payloadHash
    ) {
      throw new LedgerConflictError("invalid_reference");
    }
  }
  for (const updated of input.updateOutbox ?? []) {
    const current = snapshot.outbox.find((entry) => entry.id === updated.id);
    if (
      !current ||
      current.userId !== input.userId ||
      current.userId !== updated.userId ||
      current.replicaId !== updated.replicaId ||
      current.deviceId !== updated.deviceId ||
      current.domainEventId !== updated.domainEventId ||
      current.payloadHash !== updated.payloadHash ||
      (current.status !== "pending" && current.status !== updated.status) ||
      (updated.status === "pending" && current.status !== "pending")
    ) {
      throw new LedgerConflictError("invalid_reference");
    }
  }
  for (const entry of input.traceOutbox ?? []) {
    if (
      entry.userId !== input.userId ||
      entry.id !== entry.eventId ||
      entry.eventId !== entry.envelope.eventId ||
      !entry.payloadHash ||
      !entry.deviceId ||
      entry.status !== "pending"
    ) {
      throw new LedgerConflictError("invalid_reference");
    }
  }
  for (const updated of input.updateTraceOutbox ?? []) {
    const current = snapshot.traceOutbox.find((entry) => entry.id === updated.id);
    if (
      !current ||
      current.userId !== input.userId ||
      current.userId !== updated.userId ||
      current.eventId !== updated.eventId ||
      current.payloadHash !== updated.payloadHash ||
      current.deviceId !== updated.deviceId ||
      (current.status !== "pending" && current.status !== updated.status)
    ) {
      throw new LedgerConflictError("invalid_reference");
    }
  }
  if (
    (input.sessions ?? []).some((session) => session.userId !== input.userId) ||
    (input.artifacts ?? []).some(
      (artifact) =>
        (artifact.kind === "replan_evaluation" || artifact.kind === "goal_forecast" || artifact.kind === "weekly_coach_report" || artifact.kind === "mesocycle_review" || artifact.kind === "evidence_brief" || artifact.kind === "plan_trace" || artifact.kind === "exercise_substitution" || artifact.kind === "nutrition_observation_draft" || artifact.kind === "nutrition_change_proposal" || artifact.kind === "recovery_brief" || artifact.kind === "nutrition_strategy" || artifact.kind === "safety_hold") &&
        artifact.userId !== input.userId,
    ) ||
    (input.actionEvents ?? []).some((action) => action.userId !== input.userId) ||
    (input.workingMemoryItems ?? []).some((item) => item.userId !== input.userId) ||
    (input.coachRecipes ?? []).some((item) => item.userId !== input.userId) ||
    (input.scheduledJobs ?? []).some((item) => item.userId !== input.userId) ||
    (input.jobAttempts ?? []).some((item) => item.userId !== input.userId) ||
    (input.notificationIntents ?? []).some((item) => item.userId !== input.userId) ||
    (input.notificationReceipts ?? []).some((item) => item.userId !== input.userId) ||
    (input.healthImportStates ?? []).some((item) => item.userId !== input.userId) ||
    (input.updateOutbox ?? []).some((item) => item.userId !== input.userId) ||
    (input.replicaSyncStates ?? []).some((item) => item.userId !== input.userId) ||
    (input.pendingReplicaEnvelopes ?? []).some((item) => item.userId !== input.userId) ||
    (input.pendingHumanActions ?? []).some((pending) => pending.userId !== input.userId) ||
    (input.issueTokens ?? []).some((token) => token.userId !== input.userId)
  ) {
    throw new LedgerConflictError("cross_user_reference");
  }
  const sessionIds = new Set(
    [...snapshot.sessions, ...(input.sessions ?? [])]
      .filter((session) => session.userId === input.userId)
      .map((session) => session.id),
  );
  if ((input.runEvents ?? []).some((runEvent) => !sessionIds.has(runEvent.sessionId))) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (input.messages ?? []).some(
      (message) => message.userId !== input.userId || !sessionIds.has(message.sessionId),
    ) ||
    (input.runs ?? []).some(
      (run) => run.userId !== input.userId || !sessionIds.has(run.sessionId),
    ) ||
    (input.toolCalls ?? []).some(
      (call) => call.userId !== input.userId || !sessionIds.has(call.sessionId),
    )
  ) {
    throw new LedgerConflictError("cross_user_reference");
  }

  const resultingSessions = upsertById(snapshot.sessions, input.sessions ?? []);
  const activeByUser = resultingSessions.filter(
    (session) => session.userId === input.userId && session.status === "active",
  );
  if (activeByUser.length > 1) throw new LedgerConflictError("stale_aggregate");

  const updatedRefs = input.domainEvents.map((event) => event.aggregate);
  const committedEventIds = [
    ...input.domainEvents.map((event) => event.id),
    ...(input.draftEvents ?? []).map((event) => event.id),
  ];
  const nextSnapshot = clone({
    ...snapshot,
    ledgerSchemaVersion: COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION,
    domainEvents: [...snapshot.domainEvents, ...input.domainEvents],
    onboardingDraftEvents: [
      ...snapshot.onboardingDraftEvents,
      ...(input.draftEvents ?? []),
    ],
    aggregateRevisions: [...nextAggregateStates.values()],
    domainIdempotency: [
      ...snapshot.domainIdempotency,
      {
        userId: input.userId,
        actorId: input.actorId,
        intent: input.intent,
        key: input.idempotencyKey,
        eventIds: committedEventIds,
        aggregateRevisions: updatedRefs,
        recordedAt: input.recordedAt,
      },
    ],
    outbox: upsertById([...snapshot.outbox, ...(input.outbox ?? [])], input.updateOutbox ?? []),
    sessions: resultingSessions,
    messages: upsertById(snapshot.messages, input.messages ?? []),
    runs: upsertById(snapshot.runs, input.runs ?? []),
    toolCalls: upsertById(snapshot.toolCalls, input.toolCalls ?? []),
    artifacts: upsertById(snapshot.artifacts, input.artifacts ?? []),
    presentations: upsertById(snapshot.presentations, input.presentations ?? []),
    runEvents: [...snapshot.runEvents, ...(input.runEvents ?? [])],
    actionEvents: upsertById(snapshot.actionEvents, input.actionEvents ?? []),
    toolAudit: upsertById(snapshot.toolAudit, input.toolAudit ?? []),
    workingMemory: upsertById(snapshot.workingMemory, input.workingMemoryItems ?? []),
    pendingHumanActions: upsertById(
      snapshot.pendingHumanActions,
      input.pendingHumanActions ?? [],
    ),
    coachRecipes: upsertById(snapshot.coachRecipes, input.coachRecipes ?? []),
    scheduledJobs: upsertById(snapshot.scheduledJobs, input.scheduledJobs ?? []),
    jobAttempts: upsertById(snapshot.jobAttempts, input.jobAttempts ?? []),
    notificationIntents: upsertById(snapshot.notificationIntents, input.notificationIntents ?? []),
    notificationReceipts: upsertById(snapshot.notificationReceipts, input.notificationReceipts ?? []),
    healthImportStates: upsertById(snapshot.healthImportStates, input.healthImportStates ?? []),
    replicaSyncStates: upsertById(snapshot.replicaSyncStates, input.replicaSyncStates ?? []),
    pendingReplicaEnvelopes: upsertById(snapshot.pendingReplicaEnvelopes, input.pendingReplicaEnvelopes ?? []),
    traceOutbox: retainTraceOutbox(
      upsertById(
        appendMissingById(snapshot.traceOutbox, input.traceOutbox ?? []),
        input.updateTraceOutbox ?? [],
      ),
    ),
    actionTokens: snapshot.actionTokens.map((token) =>
      consumedTokens.has(token.token) ? { ...token, consumedAt: input.recordedAt } : token,
    ).concat(input.issueTokens ?? [])
    .map((token) => tokenUpdates.get(token.token) ?? token),
  });
  return {
    snapshot: nextSnapshot,
    result: {
      status: "committed",
      eventIds: committedEventIds,
      aggregateRevisions: updatedRefs,
    },
  };
}

export function normalizeLedgerSnapshot(snapshot: Partial<LedgerSnapshot>): LedgerSnapshot {
  const normalized = {
    ...EMPTY_LEDGER_SNAPSHOT,
    ...snapshot,
    ledgerSchemaVersion: COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION,
    domainEvents: snapshot.domainEvents ?? [],
    aggregateRevisions: snapshot.aggregateRevisions ?? [],
    domainIdempotency: snapshot.domainIdempotency ?? [],
    outbox: snapshot.outbox ?? [],
    onboardingDraftEvents: snapshot.onboardingDraftEvents ?? [],
    coachRecipes: snapshot.coachRecipes ?? [],
    scheduledJobs: snapshot.scheduledJobs ?? [],
    jobAttempts: snapshot.jobAttempts ?? [],
    notificationIntents: snapshot.notificationIntents ?? [],
    notificationReceipts: snapshot.notificationReceipts ?? [],
    healthImportStates: snapshot.healthImportStates ?? [],
    replicaSyncStates: snapshot.replicaSyncStates ?? [],
    pendingReplicaEnvelopes: snapshot.pendingReplicaEnvelopes ?? [],
    traceOutbox: snapshot.traceOutbox ?? [],
  };
  return clone(normalized);
}

export function diagnoseLedgerSnapshot(snapshot: LedgerSnapshot): CoachLedgerDiagnostics {
  const normalized = normalizeLedgerSnapshot(snapshot);
  const corruptEventIds = findCorruptEventIds(normalized.domainEvents);
  let projectionRebuildable = corruptEventIds.length === 0;
  try {
    for (const userId of new Set(normalized.domainEvents.map((event) => event.userId))) {
      projectDomainEvents(normalized.domainEvents, { userId });
    }
  } catch {
    projectionRebuildable = false;
  }
  return {
    schemaVersion: normalized.ledgerSchemaVersion,
    pendingMigrations: [],
    domainEventCount: normalized.domainEvents.length,
    aggregateCount: normalized.aggregateRevisions.length,
    outboxBacklog: normalized.outbox.filter((entry) => entry.status === "pending").length,
    projectionLag: calculateProjectionLag(normalized),
    corruptEventIds,
    ...(normalized.domainEvents.length
      ? { latestRecordedAt: normalized.domainEvents.at(-1)?.recordedAt }
      : {}),
    projectionRebuildable,
  };
}

function findCorruptEventIds(events: readonly DomainEvent[]): string[] {
  const corrupt = new Set<string>();
  const ids = new Set<string>();
  const revisions = new Map<string, number>();
  for (const event of events) {
    const key = aggregateKey(event.aggregate.kind, event.aggregate.id);
    const expectedRevision = (revisions.get(key) ?? 0) + 1;
    if (
      !event.id ||
      ids.has(event.id) ||
      event.schemaVersion !== DOMAIN_EVENT_SCHEMA_VERSION ||
      event.aggregate.revision !== expectedRevision ||
      !event.userId ||
      !event.recordedAt ||
      !event.occurredAt
    ) {
      corrupt.add(event.id || "<missing-event-id>");
    }
    ids.add(event.id);
    revisions.set(key, event.aggregate.revision);
  }
  return [...corrupt];
}

function calculateProjectionLag(snapshot: LedgerSnapshot): number {
  const projected = new Map<string, number>();
  for (const event of snapshot.domainEvents) {
    projected.set(aggregateKey(event.aggregate.kind, event.aggregate.id), event.aggregate.revision);
  }
  let lag = 0;
  for (const [key, revision] of projected) {
    const stored = snapshot.aggregateRevisions.find(
      (state) => aggregateKey(state.kind, state.id) === key,
    )?.revision ?? 0;
    lag += Math.max(0, revision - stored);
  }
  return lag;
}

function isDomainAtomicCommit(
  input: AtomicCommit | DomainAtomicCommit,
): input is DomainAtomicCommit {
  return "kind" in input && input.kind === "domain";
}

function validateDomainEventEnvelope(
  event: DomainEvent,
  input: DomainAtomicCommit,
  knownEventIds: ReadonlySet<string>,
  batchEventIds: Set<string>,
): void {
  if (
    event.schemaVersion !== DOMAIN_EVENT_SCHEMA_VERSION ||
    event.userId !== input.userId ||
    event.actor.id !== input.actorId ||
    !event.id ||
    !event.aggregate.id ||
    !event.deviceId ||
    !event.occurredAt ||
    !event.recordedAt ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    !Number.isFinite(Date.parse(event.recordedAt)) ||
    !Number.isInteger(event.timezoneOffsetMinutes) ||
    event.timezoneOffsetMinutes < -840 ||
    event.timezoneOffsetMinutes > 840 ||
    event.aggregate.revision < 1
  ) {
    throw new LedgerConflictError("invalid_domain_event");
  }
  if (knownEventIds.has(event.id) || batchEventIds.has(event.id)) {
    throw new LedgerConflictError("duplicate_event");
  }
  validateEventUnits(event);
  validateTimelinePayload(event);
}

function validateDomainEventState(
  event: DomainEvent,
  current: { userId: string; revision: number; archived: boolean } | undefined,
  aggregateStates: ReadonlyMap<string, { userId: string; revision: number; archived: boolean }>,
  userId: string,
): void {
  const expectedKind = aggregateKindForEvent(event.name);
  if (expectedKind !== "any" && event.aggregate.kind !== expectedKind) {
    throw new LedgerConflictError("invalid_domain_event");
  }
  const isCreate = event.name.endsWith(".created");
  if (isCreate && current) throw new LedgerConflictError("invalid_domain_event");
  if (event.name === "aggregate.archived") {
    if (!current || current.archived) throw new LedgerConflictError("invalid_reference");
  } else if (event.name === "aggregate.restored") {
    if (!current || !current.archived) throw new LedgerConflictError("invalid_reference");
  } else if (current?.archived) {
    throw new LedgerConflictError("invalid_reference");
  }
  // A user may begin with a confirmed Timeline fact before completing a
  // profile. This keeps local activity/meal logging usable during progressive
  // onboarding while still preventing every other aggregate from appearing
  // without an existing local identity or Timeline root.
  const opensTimelineBeforeProfile =
    event.aggregate.kind === "timeline" && event.name === "timeline.fact_appended";
  if (
    event.aggregate.kind !== "user_profile" &&
    !opensTimelineBeforeProfile &&
    ![...aggregateStates.values()].some(
      (state) => state.userId === userId && state.revision > 0,
    )
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "user_profile.created" ||
      event.name === "user_profile.revised" ||
      event.name === "user_profile.corrected") &&
    (event.name === "user_profile.corrected"
      ? event.payload.profile.id !== event.aggregate.id
      : event.payload.id !== event.aggregate.id)
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "goal_contract.created" || event.name === "goal_contract.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "coaching_mandate.created" || event.name === "coaching_mandate.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "goal_cycle.created" || event.name === "goal_cycle.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "equipment_profile.created" || event.name === "equipment_profile.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "recovery_constraint.created" || event.name === "recovery_constraint.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "nutrition_strategy.created" || event.name === "nutrition_strategy.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "custom_exercise.created" || event.name === "custom_exercise.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "permission_set.created" || event.name === "permission_set.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
  if (
    (event.name === "safety_constraint.created" || event.name === "safety_constraint.revised") &&
    event.payload.id !== event.aggregate.id
  ) {
    throw new LedgerConflictError("invalid_reference");
  }
}

function aggregateKindForEvent(name: DomainEvent["name"]): DomainEvent["aggregate"]["kind"] | "any" {
  if (name.startsWith("user_profile.")) return "user_profile";
  if (name.startsWith("goal_contract.")) return "goal_contract";
  if (name.startsWith("coaching_mandate.")) return "coaching_mandate";
  if (name.startsWith("goal_cycle.")) return "goal_cycle";
  if (name.startsWith("plan.")) return "plan";
  if (name.startsWith("workout.")) return "workout_session";
  if (name.startsWith("timeline.")) return "timeline";
  if (name.startsWith("equipment_profile.")) return "equipment_profile";
  if (name.startsWith("recovery_constraint.")) return "recovery_constraint";
  if (name.startsWith("nutrition_strategy.")) return "nutrition_strategy";
  if (name.startsWith("custom_exercise.")) return "custom_exercise";
  if (name.startsWith("permission_set.")) return "permission_set";
  if (name.startsWith("safety_constraint.")) return "safety_constraint";
  return "any";
}

function validateDomainEventReferences(
  event: DomainEvent,
  availableEvents: readonly DomainEvent[],
  aggregateStates: ReadonlyMap<string, { userId: string; revision: number; archived: boolean }>,
  userId: string,
): void {
  const assertRef = (ref: DomainAggregateRef): void => {
    const state = aggregateStates.get(aggregateKey(ref.kind, ref.id));
    if (!state || state.revision < ref.revision || state.archived) {
      throw new LedgerConflictError("invalid_reference");
    }
    if (state.userId !== userId) throw new LedgerConflictError("cross_user_reference");
  };
  if (event.name === "goal_cycle.created" || event.name === "goal_cycle.revised") {
    assertRef(event.payload.goalContractRef);
  } else if (event.name === "plan.revised") {
    assertRef(event.payload.goalContractRef);
  } else if (event.name === "nutrition_strategy.created" || event.name === "nutrition_strategy.revised") {
    assertRef(event.payload.goalContractRef);
  } else if (event.name === "workout.prepared" || event.name === "workout.started") {
    const existing = availableEvents.some(
      (candidate) => candidate.aggregate.kind === "workout_session" && candidate.aggregate.id === event.aggregate.id,
    );
    if (existing) throw new LedgerConflictError("invalid_reference");
    const planEvents = availableEvents.filter(
      (candidate) =>
        candidate.name === "plan.revised" &&
        candidate.userId === userId &&
        candidate.aggregate.id === event.payload.prescriptionRef.planId &&
        candidate.aggregate.revision === event.payload.prescriptionRef.planRevision,
    );
    const plan = planEvents.at(-1);
    if (!plan || plan.name !== "plan.revised") throw new LedgerConflictError("invalid_reference");
    const prescribed = plan.payload.sessions.find(
      (session) => session.id === event.payload.prescriptionRef.sessionPrescriptionId,
    );
    if (!prescribed || JSON.stringify(prescribed) !== JSON.stringify(event.payload.frozenPrescription)) {
      throw new LedgerConflictError("invalid_reference");
    }
  } else if (
    event.name === "workout.state_changed" ||
    event.name === "workout.draft_set_saved" ||
    event.name === "workout.draft_set_retracted" ||
    event.name === "workout.prescription_revised"
  ) {
    const started = availableEvents.some(
      (candidate) =>
        (candidate.name === "workout.started" || candidate.name === "workout.prepared") &&
        candidate.userId === userId &&
        candidate.aggregate.id === event.aggregate.id,
    );
    if (!started) throw new LedgerConflictError("invalid_reference");
  } else if (event.name === "workout.set_recorded") {
    const start = availableEvents.find(
      (candidate) =>
        (candidate.name === "workout.started" || candidate.name === "workout.prepared") &&
        candidate.userId === userId &&
        candidate.aggregate.id === event.aggregate.id,
    );
    if (!start || (start.name !== "workout.started" && start.name !== "workout.prepared")) {
      throw new LedgerConflictError("invalid_reference");
    }
    const set = start.payload.frozenPrescription.tasks
      .flatMap((task) => task.sets.map((item) => ({ task, item })))
      .find(({ item }) => item.id === event.payload.outcome.prescriptionSetId);
    if (!set || set.task.exerciseVariantId !== event.payload.outcome.exerciseVariantId) {
      throw new LedgerConflictError("invalid_reference");
    }
    if (event.payload.outcome.source === "camera_confirmed" && !event.payload.outcome.packetRef) {
      throw new LedgerConflictError("invalid_reference");
    }
  } else if (event.name === "workout.completed") {
    const started = availableEvents.some(
      (candidate) =>
        (candidate.name === "workout.started" || candidate.name === "workout.prepared") &&
        candidate.userId === userId &&
        candidate.aggregate.id === event.aggregate.id,
    );
    if (!started) throw new LedgerConflictError("invalid_reference");
  } else if (
    event.name === "timeline.fact_corrected" ||
    event.name === "timeline.source_mutated" ||
    event.name === "timeline.source_tombstoned"
  ) {
    const referencedEventId = event.name === "timeline.fact_corrected"
      ? event.payload.correctsEventId
      : event.payload.sourceEventId;
    const corrected = availableEvents.find(
      (candidate) =>
        candidate.id === referencedEventId &&
        (candidate.name === "timeline.fact_appended" ||
          candidate.name === "timeline.fact_corrected" ||
          candidate.name === "timeline.source_mutated"),
    );
    if (!corrected) throw new LedgerConflictError("invalid_reference");
    if (corrected.userId !== userId) throw new LedgerConflictError("cross_user_reference");
  } else if (event.name === "user_profile.corrected") {
    const corrected = availableEvents.find(
      (candidate) =>
        candidate.id === event.payload.correctsEventId &&
        candidate.userId === userId &&
        candidate.aggregate.kind === "user_profile" &&
        candidate.aggregate.id === event.aggregate.id,
    );
    if (!corrected) throw new LedgerConflictError("invalid_reference");
  }
}

function validateTimelinePayload(event: DomainEvent): void {
  if (
    event.name !== "timeline.fact_appended" &&
    event.name !== "timeline.fact_corrected" &&
    event.name !== "timeline.source_mutated"
  ) {
    return;
  }
  const entry = event.payload.entry;
  // Legacy imports are replayable without this newer envelope. All new
  // CoachApplication use cases write one and are validated here.
  if (!entry) return;
  const provenance = entry.provenance;
  if (
    entry.schemaVersion !== 1 ||
    !entry.id ||
    entry.factType !== event.payload.fact.kind ||
    !entry.recordedAt ||
    !entry.actor.id ||
    !Number.isFinite(Date.parse(entry.time.startedAt)) ||
    (entry.time.endedAt !== undefined && !Number.isFinite(Date.parse(entry.time.endedAt))) ||
    (entry.time.endedAt !== undefined && Date.parse(entry.time.endedAt) < Date.parse(entry.time.startedAt)) ||
    !Number.isInteger(entry.time.timezoneOffsetMinutes) ||
    entry.time.timezoneOffsetMinutes < -840 ||
    entry.time.timezoneOffsetMinutes > 840 ||
    (entry.time.endedTimezoneOffsetMinutes !== undefined &&
      (!Number.isInteger(entry.time.endedTimezoneOffsetMinutes) ||
        entry.time.endedTimezoneOffsetMinutes < -840 ||
        entry.time.endedTimezoneOffsetMinutes > 840)) ||
    !provenance.origin ||
    !provenance.recordingMethod ||
    !provenance.dataStatus ||
    !provenance.confidence ||
    !entry.privacyClass
  ) {
    throw new LedgerConflictError("invalid_domain_event");
  }
}

function validateEventUnits(event: DomainEvent): void {
  const validMass = (quantity: { value: number; unit: string } | undefined): boolean =>
    quantity === undefined ||
    (Number.isFinite(quantity.value) && quantity.value >= 0 && (quantity.unit === "kg" || quantity.unit === "lb"));
  const validEnergy = (quantity: { value: number; unit: string } | undefined): boolean =>
    quantity === undefined ||
    (Number.isFinite(quantity.value) && quantity.value >= 0 && (quantity.unit === "kcal" || quantity.unit === "kJ"));
  const validDuration = (quantity: { value: number; unit: string } | undefined): boolean =>
    quantity === undefined ||
    (Number.isFinite(quantity.value) &&
      quantity.value >= 0 &&
      (quantity.unit === "seconds" || quantity.unit === "minutes" || quantity.unit === "hours"));
  const validBodyMeasurement = (
    measurement: Extract<import("./domain").TimelineFact, { kind: "body" }>["measurement"],
  ): boolean => {
    if (measurement.metric === "body_weight") return validMass(measurement.quantity);
    if (measurement.metric === "body_fat_percentage") {
      return (
        measurement.quantity.unit === "percent" &&
        Number.isFinite(measurement.quantity.value) &&
        measurement.quantity.value >= 0 &&
        measurement.quantity.value <= 100
      );
    }
    return (
      Boolean(measurement.site.trim()) &&
      (measurement.quantity.unit === "cm" || measurement.quantity.unit === "in") &&
      Number.isFinite(measurement.quantity.value) &&
      measurement.quantity.value >= 0
    );
  };
  if (event.name === "plan.revised") {
    for (const set of event.payload.sessions.flatMap((session) => session.tasks.flatMap((task) => task.sets))) {
      const validReps =
        set.targetReps === undefined ||
        (Number.isInteger(set.targetReps.min) &&
          Number.isInteger(set.targetReps.max) &&
          set.targetReps.min >= 0 &&
          set.targetReps.max >= set.targetReps.min);
      const validDistance =
        set.targetDistance === undefined ||
        (Number.isFinite(set.targetDistance.value) &&
          set.targetDistance.value >= 0 &&
          (set.targetDistance.unit === "m" || set.targetDistance.unit === "km"));
      if (
        !validMass(set.targetLoad) ||
        !validDuration(set.rest) ||
        !validDuration(set.targetDuration) ||
        !validReps ||
        !validDistance ||
        (set.targetRir !== undefined && (set.targetRir < 0 || set.targetRir > 10))
      ) {
        throw new LedgerConflictError("invalid_unit");
      }
    }
  } else if (event.name === "workout.set_recorded") {
    const outcome = event.payload.outcome;
    const hasCompletedMeasure =
      outcome.actualReps !== undefined ||
      outcome.actualDuration !== undefined ||
      outcome.actualDistance !== undefined;
    const validDistance =
      outcome.actualDistance === undefined ||
      (Number.isFinite(outcome.actualDistance.value) &&
        outcome.actualDistance.value >= 0 &&
        (outcome.actualDistance.unit === "m" || outcome.actualDistance.unit === "km"));
    if (
      !validMass(outcome.actualLoad) ||
      !hasCompletedMeasure ||
      (outcome.actualReps !== undefined && (!Number.isInteger(outcome.actualReps) || outcome.actualReps < 0)) ||
      !validDuration(outcome.actualDuration) ||
      !validDistance ||
      (outcome.actualRir !== undefined && (outcome.actualRir < 0 || outcome.actualRir > 10))
    ) {
      throw new LedgerConflictError("invalid_unit");
    }
  } else if (
    (event.name === "timeline.fact_appended" ||
      event.name === "timeline.fact_corrected" ||
      event.name === "timeline.source_mutated") &&
    event.payload.fact.kind === "body" &&
    !validBodyMeasurement(event.payload.fact.measurement)
  ) {
    throw new LedgerConflictError("invalid_unit");
  } else if (
    event.name === "timeline.fact_appended" ||
    event.name === "timeline.fact_corrected" ||
    event.name === "timeline.source_mutated"
  ) {
    const fact = event.payload.fact;
    if (fact.kind === "training") {
      if (!fact.workoutSessionRef && !fact.historicalSet) {
        throw new LedgerConflictError("invalid_reference");
      }
      if (
        fact.historicalSet &&
        (!validMass(fact.historicalSet.load) ||
          !Number.isInteger(fact.historicalSet.reps) ||
          fact.historicalSet.reps < 0 ||
          (fact.historicalSet.rir !== undefined &&
            (fact.historicalSet.rir < 0 || fact.historicalSet.rir > 10)))
      ) {
        throw new LedgerConflictError("invalid_unit");
      }
    }
    if (
      (fact.kind === "activity" && (!validDuration(fact.duration) || !validEnergy(fact.energyExpenditure))) ||
      (fact.kind === "sleep" && !validDuration(fact.duration)) ||
      (fact.kind === "nutrition" && !validEnergy(fact.energy)) ||
      (fact.kind === "recovery" &&
        ((fact.perceivedRecovery !== undefined &&
          (fact.perceivedRecovery < 0 || fact.perceivedRecovery > 10)) ||
          (fact.fatigue !== undefined && (fact.fatigue < 0 || fact.fatigue > 10))))
    ) {
      throw new LedgerConflictError("invalid_unit");
    }
  } else if (event.name === "nutrition_strategy.created" || event.name === "nutrition_strategy.revised") {
    const range = event.payload.calorieRange;
    if (
      range &&
      (!validEnergy(range.min) ||
        !validEnergy(range.max) ||
        range.min.unit !== range.max.unit ||
        range.min.value > range.max.value)
    ) {
      throw new LedgerConflictError("invalid_unit");
    }
  }
}

function aggregateKey(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function hasRuntimeMutation(input: DomainAtomicCommit): boolean {
  return Boolean(
    input.sessions?.length ||
      input.messages?.length ||
      input.runs?.length ||
      input.toolCalls?.length ||
      input.artifacts?.length ||
      input.presentations?.length ||
      input.runEvents?.length ||
      input.actionEvents?.length ||
      input.toolAudit?.length ||
      input.workingMemoryItems?.length ||
      input.pendingHumanActions?.length ||
      input.coachRecipes?.length ||
      input.scheduledJobs?.length ||
      input.jobAttempts?.length ||
      input.notificationIntents?.length ||
      input.notificationReceipts?.length ||
      input.healthImportStates?.length ||
      input.updateOutbox?.length ||
      input.replicaSyncStates?.length ||
      input.pendingReplicaEnvelopes?.length ||
      input.traceOutbox?.length ||
      input.updateTraceOutbox?.length ||
      input.consumeTokens?.length ||
      input.issueTokens?.length,
  );
}

function validateRuntimeCas(snapshot: LedgerSnapshot, input: DomainAtomicCommit): void {
  const sessionExpected = new Map(
    (input.expectedSessionRevisions ?? []).map((item) => [item.id, item.revision]),
  );
  for (const incoming of input.sessions ?? []) {
    const current = snapshot.sessions.find((item) => item.id === incoming.id);
    const expected = sessionExpected.get(incoming.id);
    if (
      expected === undefined ||
      (current?.revision ?? 0) !== expected ||
      (incoming.revision ?? 0) !== expected + 1
    ) {
      throw new LedgerConflictError("stale_aggregate");
    }
  }

  const memoryExpected = new Map(
    (input.expectedWorkingMemoryVersions ?? []).map((item) => [item.id, item.version]),
  );
  for (const incoming of input.workingMemoryItems ?? []) {
    const current = snapshot.workingMemory.find((item) => item.id === incoming.id);
    const expected = memoryExpected.get(incoming.id);
    if (
      expected === undefined ||
      (current?.version ?? 0) !== expected ||
      incoming.version !== expected + 1
    ) {
      throw new LedgerConflictError("stale_aggregate");
    }
  }

  const pendingExpected = new Map(
    (input.expectedPendingHumanActionStatuses ?? []).map((item) => [item.id, item.status]),
  );
  for (const incoming of input.pendingHumanActions ?? []) {
    const current = snapshot.pendingHumanActions.find((item) => item.id === incoming.id);
    const expected = pendingExpected.get(incoming.id);
    if (expected === undefined || (current?.status ?? "missing") !== expected) {
      throw new LedgerConflictError("stale_aggregate");
    }
  }

  const healthStateExpected = new Map(
    (input.expectedHealthImportStateVersions ?? []).map((item) => [item.id, item.version]),
  );
  for (const incoming of input.healthImportStates ?? []) {
    const current = snapshot.healthImportStates.find((item) => item.id === incoming.id);
    const expected = healthStateExpected.get(incoming.id);
    if (
      expected === undefined ||
      (current?.version ?? 0) !== expected ||
      incoming.version !== expected + 1
    ) {
      throw new LedgerConflictError("stale_aggregate");
    }
  }

  const issuedValues = new Set<string>();
  for (const token of input.issueTokens ?? []) {
    if (
      issuedValues.has(token.token) ||
      snapshot.actionTokens.some((candidate) => candidate.token === token.token)
    ) {
      throw new LedgerConflictError("invalid_token");
    }
    issuedValues.add(token.token);
  }
}

function upsertById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const ids = new Set(incoming.map((item) => item.id));
  return [...current.filter((item) => !ids.has(item.id)), ...incoming];
}

/** 插入即去重：同一 eventId 重复入队（补发、崩溃回填）不产生第二条。 */
function appendMissingById<T extends { id: string }>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const known = new Set(current.map((item) => item.id));
  const added: T[] = [];
  for (const item of incoming) {
    if (known.has(item.id)) continue;
    known.add(item.id);
    added.push(item);
  }
  return [...current, ...added];
}

/**
 * 诊断数据不能无界增长：超出保留上限时先丢最旧的已终结条目，
 * 仍待补发的 pending 条目永远保留。
 */
function retainTraceOutbox(entries: readonly TraceOutboxEntry[]): TraceOutboxEntry[] {
  if (entries.length <= TRACE_OUTBOX_RETENTION) return [...entries];
  const settled = entries.filter((entry) => entry.status !== "pending");
  const dropped = new Set(
    [...settled]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, entries.length - TRACE_OUTBOX_RETENTION)
      .map((entry) => entry.id),
  );
  return entries.filter((entry) => !dropped.has(entry.id));
}

export function upsertSession(snapshot: LedgerSnapshot, session: CoachSession): LedgerSnapshot {
  return {
    ...snapshot,
    sessions: [...snapshot.sessions.filter((item) => item.id !== session.id), session],
  };
}

export function upsertUser(snapshot: LedgerSnapshot, user: UserState): LedgerSnapshot {
  return {
    ...snapshot,
    users: [...snapshot.users.filter((item) => item.userId !== user.userId), user],
  };
}

export function appendRunResult(
  snapshot: LedgerSnapshot,
  artifact: Artifact,
  presentation: PresentationRef,
  events: readonly CoachRunEvent[],
): LedgerSnapshot {
  const artifacts: Artifact[] = [
    ...snapshot.artifacts.filter((item) => item.id !== artifact.id),
    artifact,
  ];
  return {
    ...snapshot,
    artifacts,
    presentations: [
      ...snapshot.presentations.filter((item) => item.id !== presentation.id),
      presentation,
    ],
    runEvents: [...snapshot.runEvents, ...events],
  };
}
