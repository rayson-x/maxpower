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

export interface CoachLedger {
  read(): Promise<LedgerSnapshot>;
  replace(snapshot: LedgerSnapshot): Promise<void>;
  /** A restore may only switch in a pre-validated staging area if no writer changed its source. */
  swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void>;
  readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection>;
  diagnose(): Promise<CoachLedgerDiagnostics>;
  commit(input: DomainAtomicCommit): Promise<DomainCommandResult>;
  /** Apply a staged sequence atomically; either every recorded CAS succeeds or none is written. */
  commitBatch(inputs: readonly DomainAtomicCommit[]): Promise<readonly DomainCommandResult[]>;
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
  artifacts: [],
  presentations: [],
  runEvents: [],
  actionTokens: [],
  actionEvents: [],
  toolAudit: [],
  pendingHumanActions: [],
  workingMemory: [],
  domainEvents: [],
  aggregateRevisions: [],
  domainIdempotency: [],
  outbox: [],
  coachRecipes: [],
  scheduledJobs: [],
  jobAttempts: [],
  notificationIntents: [],
  notificationReceipts: [],
  healthImportStates: [],
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

  async commit(input: DomainAtomicCommit): Promise<DomainCommandResult> {
    const applied = applyDomainAtomicCommitTransition(this.snapshot, input);
    this.snapshot = applied.snapshot;
    return applied.result;
  }

  async commitBatch(inputs: readonly DomainAtomicCommit[]): Promise<readonly DomainCommandResult[]> {
    let next = this.snapshot;
    const results: DomainCommandResult[] = [];
    for (const input of inputs) {
      const applied = applyDomainAtomicCommitTransition(next, input);
      next = applied.snapshot;
      results.push(applied.result);
    }
    this.snapshot = next;
    return results;
  }
}

/** Private staging Ledger that records the exact validated commit sequence for atomic replay after cloud ACK. */
export class RecordingCoachLedger implements CoachLedger {
  private readonly delegate: InMemoryCoachLedger;
  private readonly recorded: DomainAtomicCommit[] = [];

  constructor(seed: LedgerSnapshot) { this.delegate = new InMemoryCoachLedger(seed); }
  read() { return this.delegate.read(); }
  replace(snapshot: LedgerSnapshot) { return this.delegate.replace(snapshot); }
  swapRestoredSnapshot(input: StagedLedgerRestore) { return this.delegate.swapRestoredSnapshot(input); }
  readDomainProjection(query: DomainProjectionQuery) { return this.delegate.readDomainProjection(query); }
  diagnose() { return this.delegate.diagnose(); }
  async commit(input: DomainAtomicCommit): Promise<DomainCommandResult> {
    const result = await this.delegate.commit(input);
    this.recorded.push(clone(input));
    return result;
  }
  async commitBatch(inputs: readonly DomainAtomicCommit[]): Promise<readonly DomainCommandResult[]> {
    const results = await this.delegate.commitBatch(inputs);
    this.recorded.push(...inputs.map((input) => clone(input)));
    return results;
  }
  recordedCommits(): readonly DomainAtomicCommit[] { return clone(this.recorded); }
}

export function applyCoachLedgerCommitTransition(
  snapshot: LedgerSnapshot,
  input: DomainAtomicCommit,
): { snapshot: LedgerSnapshot; result: DomainCommandResult } {
  return applyDomainAtomicCommitTransition(snapshot, input);
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
    readonly detail?: string,
  ) {
    super(detail ? `${code}:${detail}` : code);
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
  if (input.domainEvents.length === 0 && !hasRuntimeMutation(input)) {
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
      throw new LedgerConflictError(
        "stale_aggregate",
        `expected:${expected.kind}:${expected.id}:r${expected.revision}:current${current?.revision ?? 0}`,
      );
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
      throw new LedgerConflictError("stale_aggregate", `unexpected_event:${key}`);
    }
    const currentRevision = current?.revision ?? 0;
    if (event.aggregate.revision !== currentRevision + 1) {
      throw new LedgerConflictError(
        "stale_aggregate",
        `event_revision:${key}:r${event.aggregate.revision}:current${currentRevision}`,
      );
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
        (artifact.kind === "weekly_coach_report" || artifact.kind === "evidence_brief" || artifact.kind === "nutrition_observation_draft" || artifact.kind === "recovery_brief" || artifact.kind === "nutrition_strategy" || artifact.kind === "safety_hold") &&
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
  // A user may keep several independent Conversation sessions active, just
  // like separate Codex/ChatGPT threads.  The old page-bound sessions remain
  // single-active while they are being migrated, but they cannot evict a
  // conversation or vice versa.
  const activeByUser = resultingSessions.filter(
    (session) => session.userId === input.userId
      && session.status === "active"
      && session.context.kind !== "conversation",
  );
  if (activeByUser.length > 1) {
    throw new LedgerConflictError("stale_aggregate", "multiple_active_sessions");
  }

  const updatedRefs = input.domainEvents.map((event) => event.aggregate);
  const committedEventIds = [
    ...input.domainEvents.map((event) => event.id),
  ];
  const nextSnapshot = clone({
    ...snapshot,
    ledgerSchemaVersion: COACH_LEDGER_SNAPSHOT_SCHEMA_VERSION,
    domainEvents: [...snapshot.domainEvents, ...input.domainEvents],
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
    outbox: appendMissingById(snapshot.outbox, input.outbox ?? []),
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
    coachRecipes: snapshot.coachRecipes ?? [],
    scheduledJobs: snapshot.scheduledJobs ?? [],
    jobAttempts: snapshot.jobAttempts ?? [],
    notificationIntents: snapshot.notificationIntents ?? [],
    notificationReceipts: snapshot.notificationReceipts ?? [],
    healthImportStates: snapshot.healthImportStates ?? [],
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
  validateTimelinePayload(event);
  try {
    validateEventUnits(event);
  } catch (cause) {
    if (cause instanceof LedgerConflictError) throw cause;
    throw new LedgerConflictError("invalid_domain_event");
  }
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
  // profile. This keeps local activity/meal logging usable before planning
  // while still preventing every other aggregate from appearing
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
  const effectiveWorkoutPrescription = (workoutId: string) => {
    const events = availableEvents.filter(
      (candidate) => candidate.userId === userId && candidate.aggregate.kind === "workout_session" && candidate.aggregate.id === workoutId,
    );
    const revised = events.filter(
      (candidate): candidate is Extract<DomainEvent, { name: "workout.prescription_revised" }> => candidate.name === "workout.prescription_revised",
    ).at(-1);
    if (revised) return revised.payload.frozenPrescription;
    const start = events.find(
      (candidate): candidate is Extract<DomainEvent, { name: "workout.started" | "workout.prepared" }> => candidate.name === "workout.started" || candidate.name === "workout.prepared",
    );
    return start?.payload.frozenPrescription;
  };
  if (event.name === "plan.revised") {
    assertRef(event.payload.goalContractRef);
  } else if (event.name === "nutrition_strategy.created" || event.name === "nutrition_strategy.revised") {
    assertRef(event.payload.goalContractRef);
  } else if (event.name === "workout.prepared" || event.name === "workout.started") {
    const existing = availableEvents.some(
      (candidate) => candidate.aggregate.kind === "workout_session" && candidate.aggregate.id === event.aggregate.id,
    );
    if (existing) throw new LedgerConflictError("invalid_reference");
    if (event.payload.source.kind === "planned") {
      const ref = event.payload.source.plannedSessionRef;
      const planEvents = availableEvents.filter(
        (candidate) =>
          candidate.name === "plan.revised" &&
          candidate.userId === userId &&
          candidate.aggregate.id === ref.planId &&
          candidate.aggregate.revision === ref.planRevision,
      );
      const plan = planEvents.at(-1);
      if (!plan || plan.name !== "plan.revised") throw new LedgerConflictError("invalid_reference");
      const currentPlan = availableEvents
        .filter((candidate): candidate is Extract<DomainEvent, { name: "plan.revised" }> => candidate.name === "plan.revised" && candidate.userId === userId && candidate.aggregate.id === ref.planId)
        .sort((left, right) => right.aggregate.revision - left.aggregate.revision)[0];
      if (!currentPlan || currentPlan.aggregate.revision !== ref.planRevision || (currentPlan.payload.lifecycle && currentPlan.payload.lifecycle.state !== "active")) throw new LedgerConflictError("invalid_reference");
      const prescribed = plan.payload.sessions.find((session) => session.id === ref.sessionPrescriptionId);
      if (!prescribed || JSON.stringify(prescribed) !== JSON.stringify(event.payload.frozenPrescription)) {
        throw new LedgerConflictError("invalid_reference");
      }
    } else if (!event.payload.frozenPrescription.tasks.length) {
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
    const prescription = effectiveWorkoutPrescription(event.aggregate.id);
    if (!prescription) throw new LedgerConflictError("invalid_reference");
    const set = prescription.tasks
      .flatMap((task) => task.sets.map((item) => ({ task, item })))
      .find(({ item }) => item.id === event.payload.outcome.prescriptionSetId);
    if (!set || set.task.exerciseVariantId !== event.payload.outcome.exerciseVariantId) {
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
  const payload = event.payload as unknown;
  if (!isObjectRecord(payload) || !isObjectRecord(payload.entry) || !isObjectRecord(payload.fact)) {
    throw new LedgerConflictError("invalid_domain_event");
  }
  const entry = payload.entry;
  const fact = payload.fact;
  if (!isObjectRecord(entry.time) || !isObjectRecord(entry.actor) || !isObjectRecord(entry.provenance)) {
    throw new LedgerConflictError("invalid_domain_event");
  }
  const time = entry.time;
  const actor = entry.actor;
  const provenance = entry.provenance;
  const actorKinds = new Set(["user", "agent", "rule_engine", "sensor", "sync", "system"]);
  const factKinds = new Set(["training", "activity", "nutrition", "sleep", "body", "recovery", "symptom", "clinical_context", "subjective", "schedule", "rest"]);
  const origins = new Set(["manual", "healthkit", "health_connect", "smart_scale", "wearable", "canonical_motion_packet", "import", "professional_directive", "system"]);
  const recordingMethods = new Set(["manual_entry", "device_measurement", "platform_import", "canonical_packet", "professional_entry", "system_import"]);
  const dataStatuses = new Set(["available", "missing", "permission_denied", "not_supported", "stale", "partial", "estimated", "conflict"]);
  const confidences = new Set(["confirmed", "estimated", "unknown"]);
  const privacyClasses = new Set(["private", "sensitive", "provider_authorized"]);
  const provenanceOptionalStrings = ["sourceRecordId", "sourceRevision", "sourceAppId", "clientRecordId", "clientRecordVersion", "deviceId", "deviceManufacturer", "deviceModel", "deviceType", "sourceRecordingMethod", "measurementMethod", "algorithmVersion"];
  const validEvidenceRefs = Array.isArray(entry.evidenceRefs) && entry.evidenceRefs.every((ref) => isObjectRecord(ref) &&
    ref.kind === "canonical_packet" &&
    typeof ref.id === "string" && ref.id.length > 0 &&
    typeof ref.version === "number" && Number.isInteger(ref.version) && ref.version >= 0 &&
    typeof ref.hash === "string" && ref.hash.length > 0,
  );
  if (
    entry.schemaVersion !== 1 ||
    typeof entry.id !== "string" || !entry.id ||
    entry.factType !== fact.kind ||
    typeof fact.kind !== "string" || !factKinds.has(fact.kind) ||
    !validTimelineFactShape(fact) ||
    typeof entry.recordedAt !== "string" || !Number.isFinite(Date.parse(entry.recordedAt)) ||
    typeof actor.kind !== "string" || !actorKinds.has(actor.kind) ||
    typeof actor.id !== "string" || !actor.id ||
    !Array.isArray(entry.causalRefs) || entry.causalRefs.some((ref) => typeof ref !== "string" || !ref) ||
    !validEvidenceRefs ||
    (entry.layer !== "raw_observation" && entry.layer !== "canonical_projection") ||
    typeof time.startedAt !== "string" || !Number.isFinite(Date.parse(time.startedAt)) ||
    (time.endedAt !== undefined && (typeof time.endedAt !== "string" || !Number.isFinite(Date.parse(time.endedAt)))) ||
    (typeof time.endedAt === "string" && Date.parse(time.endedAt) < Date.parse(time.startedAt)) ||
    !Number.isInteger(time.timezoneOffsetMinutes) ||
    Number(time.timezoneOffsetMinutes) < -840 ||
    Number(time.timezoneOffsetMinutes) > 840 ||
    (time.endedTimezoneOffsetMinutes !== undefined &&
      (!Number.isInteger(time.endedTimezoneOffsetMinutes) ||
        Number(time.endedTimezoneOffsetMinutes) < -840 ||
        Number(time.endedTimezoneOffsetMinutes) > 840)) ||
    typeof provenance.origin !== "string" || !origins.has(provenance.origin) ||
    typeof provenance.recordingMethod !== "string" || !recordingMethods.has(provenance.recordingMethod) ||
    typeof provenance.dataStatus !== "string" || !dataStatuses.has(provenance.dataStatus) ||
    typeof provenance.confidence !== "string" || !confidences.has(provenance.confidence) ||
    provenanceOptionalStrings.some((field) => provenance[field] !== undefined && typeof provenance[field] !== "string") ||
    (provenance.lastModifiedAt !== undefined && (typeof provenance.lastModifiedAt !== "string" || !Number.isFinite(Date.parse(provenance.lastModifiedAt)))) ||
    typeof entry.privacyClass !== "string" || !privacyClasses.has(entry.privacyClass) ||
    (entry.valueStatus !== undefined && (typeof entry.valueStatus !== "string" || !dataStatuses.has(entry.valueStatus))) ||
    (entry.canonicalFromEventIds !== undefined && (!Array.isArray(entry.canonicalFromEventIds) || entry.canonicalFromEventIds.some((id) => typeof id !== "string" || !id)))
  ) {
    throw new LedgerConflictError("invalid_domain_event");
  }
}

function validTimelineFactShape(fact: Record<string, unknown>): boolean {
  const confirmedOrEstimated = fact.confidence === "confirmed" || fact.confidence === "estimated";
  const optionalString = (value: unknown): boolean => value === undefined || typeof value === "string";
  switch (fact.kind) {
    case "training":
      return confirmedOrEstimated && Boolean(fact.workoutSessionRef || fact.reportedSession || fact.historicalSet);
    case "activity":
      return confirmedOrEstimated && typeof fact.activityType === "string" && fact.activityType.length > 0;
    case "nutrition":
      return fact.confidence === "confirmed" && typeof fact.observationId === "string" && fact.observationId.length > 0 &&
        (fact.foods === undefined || Array.isArray(fact.foods)) &&
        (fact.nutrients === undefined || Array.isArray(fact.nutrients)) &&
        (fact.observationMode === undefined || fact.observationMode === "structured" || fact.observationMode === "descriptive") &&
        (fact.dayCoverage === undefined || fact.dayCoverage === "partial" || fact.dayCoverage === "complete") &&
        optionalString(fact.mealDescription) &&
        (fact.reportedEnergyDeviationKcal === undefined || typeof fact.reportedEnergyDeviationKcal === "number" && Number.isFinite(fact.reportedEnergyDeviationKcal));
    case "sleep":
      return confirmedOrEstimated && (fact.quality === undefined || typeof fact.quality === "number" && Number.isFinite(fact.quality));
    case "body":
      return confirmedOrEstimated && isObjectRecord(fact.measurement);
    case "recovery":
      return confirmedOrEstimated &&
        (fact.hrvMetric === undefined || fact.hrvMetric === "sdnn" || fact.hrvMetric === "rmssd") &&
        (fact.hrvUnit === undefined || fact.hrvUnit === "milliseconds") &&
        (fact.restingHeartRateUnit === undefined || fact.restingHeartRateUnit === "beats_per_minute");
    case "symptom":
      return confirmedOrEstimated && (fact.symptom === "soreness" || fact.symptom === "pain") && optionalString(fact.area) && optionalString(fact.note);
    case "clinical_context":
      return confirmedOrEstimated && ["diagnosed_condition", "medication", "pregnancy_or_postpartum", "eating_disorder_or_low_energy_risk", "recent_surgery_or_acute_injury", "other"].includes(String(fact.context)) && optionalString(fact.note);
    case "subjective":
      return confirmedOrEstimated && fact.metric === "physique_satisfaction" && typeof fact.value === "number" && Number.isFinite(fact.value) && optionalString(fact.note);
    case "schedule":
      return confirmedOrEstimated && ["availability_changed", "travel", "work_conflict", "other"].includes(String(fact.effect)) && optionalString(fact.note);
    case "rest":
      return confirmedOrEstimated && optionalString(fact.note);
    default:
      return false;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const validReportedTrainingSession = (
    session: Extract<import("./domain").TimelineFact, { kind: "training" }> ["reportedSession"] | undefined,
  ): boolean => {
    if (!session) return true;
    const hasContent = Boolean(
      session.executionStatus || session.summary?.trim() || session.note?.trim() || session.duration || session.exercises?.length,
    );
    if (!hasContent || !validDuration(session.duration)) return false;
    return (session.exercises ?? []).every((exercise) =>
      Boolean(exercise.name.trim()) &&
      (exercise.exerciseConceptId === undefined || Boolean(exercise.exerciseConceptId.trim())) &&
      (exercise.sets ?? []).every((set) =>
        (set.reps === undefined || Number.isInteger(set.reps) && set.reps >= 0) &&
        validMass(set.load) &&
        (set.rir === undefined || set.rir >= 0 && set.rir <= 10),
      ),
    );
  };
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
      if (!fact.workoutSessionRef && !fact.historicalSet && !fact.reportedSession) {
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
      if (!validReportedTrainingSession(fact.reportedSession)) {
        throw new LedgerConflictError("invalid_unit");
      }
    }
    if (
      (fact.kind === "activity" && (!validDuration(fact.duration) || !validEnergy(fact.energyExpenditure))) ||
      (fact.kind === "sleep" && !validDuration(fact.duration)) ||
      (fact.kind === "nutrition" && !validNutrientValues(fact.nutrients)) ||
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

function validNutrientValues(values: readonly import("../nutrition").NutrientValueData[] | undefined): boolean {
  if (!values) return true;
  const seen = new Set<string>();
  return values.every((value) => {
    const key = `${value.nutrientId}:${value.unit}`;
    if (seen.has(key) || !Number.isFinite(value.amount) || value.amount < 0 || !value.source.ref.trim()) return false;
    seen.add(key);
    if (value.nutrientId === "energy") return value.unit === "kcal" || value.unit === "kJ";
    return value.unit === "g" || value.unit === "mg" || value.unit === "mcg";
  });
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
