import {
  applyDomainAtomicCommitTransition,
  diagnoseLedgerSnapshot,
  normalizeLedgerSnapshot,
  type CoachLedger,
} from "../coach/ledger";
import type {
  ActionEvent,
  Artifact,
  CoachMessage,
  CoachRunEvent,
  CoachRunRecord,
  CoachSession,
  CoachToolCallRecord,
  LedgerSnapshot,
  PresentationRef,
  RuntimeServices,
  WorkingMemoryItem,
} from "../coach/model";
import { projectDomainEvents, type DomainEvent } from "../coach/domain";
import { stableHash } from "../coach/stable";
import type { RestoreConflict, RestorePlan } from "./model";

export const PORTABLE_EXPORT_SCHEMA_VERSION = 1 as const;

export interface ExportManifest {
  schemaVersion: typeof PORTABLE_EXPORT_SCHEMA_VERSION;
  userId: string;
  createdAt: string;
  includes: readonly (
    | "domain_events"
    | "coach_sessions"
    | "working_memory"
    | "artifacts"
    | "action_log"
  )[];
  excludes: readonly (
    | "credentials"
    | "action_tokens"
    | "tool_audit"
    | "provider_raw_input"
    | "media_bytes"
    | "outbox"
  )[];
  counts: Readonly<Record<string, number>>;
  contentHash: string;
}

export interface PortableExportBundle {
  manifest: ExportManifest;
  payload: PortableExportPayload;
}

/** Structured, versioned data only. Secrets, pending authority and media bytes stay out of the bundle. */
export interface PortableExportPayload {
  domainEvents: readonly LedgerSnapshot["domainEvents"][number][];
  sessions: readonly LedgerSnapshot["sessions"][number][];
  messages: readonly LedgerSnapshot["messages"][number][];
  runs: readonly LedgerSnapshot["runs"][number][];
  toolCalls: readonly LedgerSnapshot["toolCalls"][number][];
  artifacts: readonly LedgerSnapshot["artifacts"][number][];
  presentations: readonly LedgerSnapshot["presentations"][number][];
  runEvents: readonly LedgerSnapshot["runEvents"][number][];
  actionEvents: readonly LedgerSnapshot["actionEvents"][number][];
  workingMemory: readonly LedgerSnapshot["workingMemory"][number][];
}

export interface RestoreDryRun {
  status: "ready" | "invalid";
  userId?: string;
  eventCount?: number;
  sessionCount?: number;
  mediaAvailability: "excluded";
  warnings: readonly string[];
  errors: readonly string[];
}

export interface PortableRestoreRequest {
  bundle: PortableExportBundle;
  mode: "merge" | "empty_profile";
  /** User identities are immutable facts. A cross-user import is not a rename operation. */
  targetUserId?: string;
}

export interface PortableRestoreReceipt {
  plan: RestorePlan;
  importedEventCount: number;
  importedSessionCount: number;
  actionEventId: string;
}

export class PortableRestoreError extends Error {
  constructor(readonly plan: RestorePlan) {
    super("portable_restore_not_ready");
    this.name = "PortableRestoreError";
  }
}

/**
 * Portable export/restore deliberately keeps the Ledger as the source of
 * truth. Restore first builds a separately validated staged snapshot by
 * replaying domain events, then asks the ledger to atomically install it only
 * if the source snapshot has not changed underneath it.
 */
export class PortableDataService {
  constructor(private readonly ledger: CoachLedger, private readonly runtime: RuntimeServices) {}

  async exportUser(userId: string): Promise<PortableExportBundle> {
    const snapshot = await this.ledger.read();
    const payload = payloadForUser(snapshot, userId);
    const contentHash = stableHash(payload);
    return {
      manifest: {
        schemaVersion: PORTABLE_EXPORT_SCHEMA_VERSION,
        userId,
        createdAt: this.runtime.now(),
        includes: ["domain_events", "coach_sessions", "working_memory", "artifacts", "action_log"],
        excludes: ["credentials", "action_tokens", "tool_audit", "provider_raw_input", "media_bytes", "outbox"],
        counts: {
          domainEvents: payload.domainEvents.length,
          sessions: payload.sessions.length,
          artifacts: payload.artifacts.length,
          actionEvents: payload.actionEvents.length,
          workingMemory: payload.workingMemory.length,
        },
        contentHash,
      },
      payload,
    };
  }

  dryRun(bundle: PortableExportBundle): RestoreDryRun {
    const errors = validateBundle(bundle);
    const warnings: string[] = [];
    if (!bundle.payload.domainEvents.length) warnings.push("no_domain_events");
    warnings.push("media_bytes_excluded");
    return errors.length
      ? { status: "invalid", mediaAvailability: "excluded", warnings, errors }
      : {
          status: "ready",
          userId: bundle.manifest.userId,
          eventCount: bundle.payload.domainEvents.length,
          sessionCount: bundle.payload.sessions.length,
          mediaAvailability: "excluded",
          warnings,
          errors,
        };
  }

  async planRestore(input: PortableRestoreRequest): Promise<RestorePlan> {
    return createRestorePlan({
      request: input,
      current: await this.ledger.read(),
      id: this.runtime.nextId("restore-plan"),
    });
  }

  async restore(input: PortableRestoreRequest): Promise<PortableRestoreReceipt> {
    const current = await this.ledger.read();
    const plan = createRestorePlan({
      request: input,
      current,
      id: this.runtime.nextId("restore-plan"),
    });
    if (!plan.canRestore) throw new PortableRestoreError(plan);

    const staged = buildRestoredSnapshot({ current, request: input, runtime: this.runtime });
    const diagnostics = diagnoseLedgerSnapshot(staged);
    if (!diagnostics.projectionRebuildable || diagnostics.corruptEventIds.length) {
      throw new PortableRestoreError({
        ...plan,
        canRestore: false,
        errors: [...plan.errors, "projection_rebuild_failed"],
      });
    }
    // Ensure the imported user's projection can actually be reconstructed
    // before touching the persisted snapshot.
    projectDomainEvents(staged.domainEvents, { userId: plan.userId });

    await this.ledger.swapRestoredSnapshot({
      expectedSnapshotHash: stableHash(current),
      nextSnapshot: staged,
    });
    return {
      plan,
      importedEventCount: countNewById(current.domainEvents, input.bundle.payload.domainEvents),
      importedSessionCount: countNewById(current.sessions, input.bundle.payload.sessions),
      actionEventId: restoreActionId(input.bundle.manifest.contentHash, input.mode),
    };
  }
}

function validateBundle(bundle: PortableExportBundle): string[] {
  const errors: string[] = [];
  if (bundle.manifest.schemaVersion !== PORTABLE_EXPORT_SCHEMA_VERSION) errors.push("unsupported_export_schema");
  if (!bundle.manifest.userId) errors.push("missing_user_id");
  if (stableHash(bundle.payload) !== bundle.manifest.contentHash) errors.push("content_hash_mismatch");
  const allUserIds = [
    ...bundle.payload.domainEvents.map((item) => item.userId),
    ...bundle.payload.sessions.map((item) => item.userId),
    ...bundle.payload.messages.map((item) => item.userId),
    ...bundle.payload.runs.map((item) => item.userId),
    ...bundle.payload.toolCalls.map((item) => item.userId),
    ...bundle.payload.actionEvents.map((item) => item.userId),
    ...bundle.payload.workingMemory.map((item) => item.userId),
    ...bundle.payload.artifacts.flatMap((item) => ("userId" in item ? [item.userId] : [])),
  ];
  if (allUserIds.some((id) => id !== bundle.manifest.userId)) errors.push("cross_user_payload");
  return errors;
}

function createRestorePlan(input: {
  request: PortableRestoreRequest;
  current: LedgerSnapshot;
  id: string;
}): RestorePlan {
  const { request, current } = input;
  const dryRun = validateBundle(request.bundle);
  const targetUserId = request.targetUserId ?? request.bundle.manifest.userId;
  const conflicts: RestoreConflict[] = [];
  const errors = [...dryRun];
  if (targetUserId !== request.bundle.manifest.userId) errors.push("user_id_remap_not_supported");
  if (!dryRun.length && targetUserId === request.bundle.manifest.userId) {
    if (request.mode === "empty_profile" && hasUserData(current, targetUserId)) {
      conflicts.push("target_profile_not_empty");
    }
    if (request.mode === "merge") {
      conflicts.push(...findMergeConflicts(current, request.bundle.payload, targetUserId));
    }
  }
  const warnings = ["media_bytes_excluded"];
  if (request.bundle.payload.sessions.some((session) => session.status === "active" || session.status === "suspended")) {
    warnings.push("pending_agent_work_restored_as_history_only");
  }
  const schemaStatus = request.bundle.manifest.schemaVersion === PORTABLE_EXPORT_SCHEMA_VERSION
    ? "compatible"
    : "unsupported";
  return {
    id: input.id,
    mode: request.mode,
    userId: targetUserId,
    schemaStatus,
    eventCount: request.bundle.payload.domainEvents.length,
    sessionCount: request.bundle.payload.sessions.length,
    mediaAvailability: "excluded",
    conflicts: unique(conflicts),
    requiredMigrations: [],
    estimatedStorageBytes: JSON.stringify(request.bundle.payload).length,
    warnings,
    errors,
    canRestore: schemaStatus === "compatible" && errors.length === 0 && conflicts.length === 0,
  };
}

function findMergeConflicts(
  current: LedgerSnapshot,
  payload: PortableExportPayload,
  userId: string,
): RestoreConflict[] {
  const conflicts: RestoreConflict[] = [];
  const restoredPayload: PortableExportPayload = {
    ...payload,
    sessions: payload.sessions.map(sanitizeRestoredSession),
    runs: payload.runs.map(sanitizeRestoredRun),
  };
  const knownEvents = new Map(current.domainEvents.map((event) => [event.id, event]));
  const aggregateRevisions = new Map(
    current.aggregateRevisions.map((item) => [`${item.kind}:${item.id}`, item.revision]),
  );
  for (const event of restoredPayload.domainEvents) {
    const existing = knownEvents.get(event.id);
    if (existing) {
      if (stableHash(existing) !== stableHash(event)) conflicts.push("domain_event_id_mismatch");
      continue;
    }
    const key = `${event.aggregate.kind}:${event.aggregate.id}`;
    const currentRevision = aggregateRevisions.get(key) ?? 0;
    if (event.aggregate.revision !== currentRevision + 1) {
      conflicts.push("domain_revision_diverged");
      continue;
    }
    aggregateRevisions.set(key, event.aggregate.revision);
  }
  for (const group of runtimeGroups(restoredPayload)) {
    const local = runtimeGroupForSnapshot(current, group.name);
    for (const item of group.items) {
      if ("userId" in item && item.userId !== userId) conflicts.push("cross_user_reference");
      const existing = local.find((candidate) => candidate.id === item.id);
      if (existing && stableHash(existing) !== stableHash(item)) conflicts.push("runtime_record_diverged");
    }
  }
  const localActive = current.sessions.find((session) => session.userId === userId && session.status === "active");
  const importedActive = restoredPayload.sessions.find((session) => session.status === "active" && session.id !== localActive?.id);
  if (localActive && importedActive) conflicts.push("active_session_conflict");
  return unique(conflicts);
}

function buildRestoredSnapshot(input: {
  current: LedgerSnapshot;
  request: PortableRestoreRequest;
  runtime: RuntimeServices;
}): LedgerSnapshot {
  const userId = input.request.bundle.manifest.userId;
  let staged = normalizeLedgerSnapshot(input.current);
  for (const event of input.request.bundle.payload.domainEvents) {
    const existing = staged.domainEvents.find((candidate) => candidate.id === event.id);
    if (existing) continue;
    const aggregate = staged.aggregateRevisions.find(
      (candidate) => candidate.kind === event.aggregate.kind && candidate.id === event.aggregate.id,
    );
    staged = applyDomainAtomicCommitTransition(staged, {
      kind: "domain",
      userId,
      // Domain replay validates that the commit actor and immutable event
      // envelope agree. Preserve the source event actor; the separate restore
      // ActionLog entry below records who initiated this local import.
      actorId: event.actor.id,
      intent: "portable_restore.replay",
      expectedRevisions: [{
        kind: event.aggregate.kind,
        id: event.aggregate.id,
        revision: aggregate?.revision ?? 0,
      }],
      domainEvents: [event],
      idempotencyKey: `portable-restore:${input.request.bundle.manifest.contentHash}:${event.id}`,
      recordedAt: input.runtime.now(),
    }).snapshot;
  }

  const payload = input.request.bundle.payload;
  const restoredSessions = payload.sessions.map(sanitizeRestoredSession);
  const restoredRuns = payload.runs.map(sanitizeRestoredRun);
  validateRuntimeReferences(staged, {
    ...payload,
    sessions: restoredSessions,
    runs: restoredRuns,
  }, userId);
  staged = {
    ...staged,
    sessions: appendNewById(staged.sessions, restoredSessions),
    messages: appendNewById(staged.messages, payload.messages),
    runs: appendNewById(staged.runs, restoredRuns),
    toolCalls: appendNewById(staged.toolCalls, payload.toolCalls),
    artifacts: appendNewById(staged.artifacts, payload.artifacts),
    presentations: appendNewById(staged.presentations, payload.presentations),
    runEvents: appendNewByHash(staged.runEvents, payload.runEvents),
    actionEvents: appendNewById(staged.actionEvents, payload.actionEvents),
    workingMemory: appendNewById(staged.workingMemory, payload.workingMemory),
  };
  const actionEvent = restoredActionEvent({
    userId,
    bundle: input.request.bundle,
    mode: input.request.mode,
    occurredAt: input.runtime.now(),
    mandateRevision: staged.aggregateRevisions.find((item) => item.kind === "coaching_mandate")?.revision ?? 0,
  });
  staged = {
    ...staged,
    actionEvents: appendNewById(staged.actionEvents, [actionEvent]),
  };
  return normalizeLedgerSnapshot(staged);
}

function sanitizeRestoredSession(session: CoachSession): CoachSession {
  if (session.status !== "active" && session.status !== "suspended") return session;
  return { ...session, status: "suspended" };
}

function sanitizeRestoredRun(run: CoachRunRecord): CoachRunRecord {
  if (run.status === "completed" || run.status === "interrupted" || run.status === "failed") return run;
  return { ...run, status: "interrupted", terminalCode: "restore_requires_new_turn" };
}

function validateRuntimeReferences(
  snapshot: LedgerSnapshot,
  payload: PortableExportPayload,
  userId: string,
): void {
  const sessions = new Set([
    ...snapshot.sessions.filter((item) => item.userId === userId).map((item) => item.id),
    ...payload.sessions.map((item) => item.id),
  ]);
  const artifacts = new Set([...snapshot.artifacts.map((item) => item.id), ...payload.artifacts.map((item) => item.id)]);
  if (
    payload.sessions.some((item) => item.userId !== userId) ||
    payload.messages.some((item) => item.userId !== userId || !sessions.has(item.sessionId)) ||
    payload.runs.some((item) => item.userId !== userId || !sessions.has(item.sessionId)) ||
    payload.toolCalls.some((item) => item.userId !== userId || !sessions.has(item.sessionId)) ||
    payload.runEvents.some((item) => !sessions.has(item.sessionId)) ||
    payload.actionEvents.some((item) => item.userId !== userId) ||
    payload.workingMemory.some((item) => item.userId !== userId) ||
    payload.presentations.some((item) => !artifacts.has(item.artifactId))
  ) {
    throw new Error("portable_restore_invalid_runtime_reference");
  }
}

function restoredActionEvent(input: {
  userId: string;
  bundle: PortableExportBundle;
  mode: "merge" | "empty_profile";
  occurredAt: string;
  mandateRevision: number;
}): ActionEvent {
  const id = restoreActionId(input.bundle.manifest.contentHash, input.mode);
  return {
    id,
    userId: input.userId,
    occurredAt: input.occurredAt,
    actor: "user",
    action: "data.lifecycle.changed",
    targetType: "profile",
    targetId: input.userId,
    scope: "portable_restore",
    intent: `portable_restore.${input.mode}`,
    before: { contentHash: input.bundle.manifest.contentHash },
    after: { eventCount: input.bundle.payload.domainEvents.length, mediaAvailability: "excluded" },
    evidenceRefs: [],
    beforeRefs: [],
    afterRefs: [],
    ruleVersions: {},
    mandateRevision: input.mandateRevision,
    result: "applied",
    undoBoundary: "not_reversible",
    policyDecision: "allow",
    causationId: input.bundle.manifest.contentHash,
    correlationId: id,
    reversible: false,
  };
}

function restoreActionId(hash: string, mode: "merge" | "empty_profile"): string {
  return `portable-restore:${mode}:${hash}`;
}

function payloadForUser(snapshot: LedgerSnapshot, userId: string): PortableExportPayload {
  const sessions = snapshot.sessions.filter((item) => item.userId === userId);
  const sessionIds = new Set(sessions.map((item) => item.id));
  const artifactIds = new Set([
    ...sessions.flatMap((item) => item.artifactIds ?? []),
    ...snapshot.artifacts
      .filter((item) => "userId" in item && item.userId === userId)
      .map((item) => item.id),
  ]);
  return {
    domainEvents: snapshot.domainEvents.filter((item) => item.userId === userId),
    sessions,
    messages: snapshot.messages
      .filter((item) => item.userId === userId && sessionIds.has(item.sessionId))
      .map(sanitizePortableMessage),
    runs: snapshot.runs.filter((item) => item.userId === userId && sessionIds.has(item.sessionId)),
    toolCalls: snapshot.toolCalls.filter((item) => item.userId === userId && sessionIds.has(item.sessionId)),
    artifacts: snapshot.artifacts.filter((item) => artifactIds.has(item.id)),
    presentations: snapshot.presentations.filter((item) => artifactIds.has(item.artifactId)),
    runEvents: snapshot.runEvents
      .filter((item) => sessionIds.has(item.sessionId))
      .map(sanitizePortableRunEvent),
    actionEvents: snapshot.actionEvents
      .filter((item) => item.userId === userId)
      .map(sanitizePortableActionEvent),
    workingMemory: snapshot.workingMemory
      .filter((item) => item.userId === userId)
      .map(sanitizePortableMemory),
  };
}

/**
 * Portable bundles retain session structure but are not a vehicle for direct
 * identifiers copied into chat. Local session history remains untouched; this
 * is a one-way, export-only redaction so a recipient cannot recover the text.
 */
function sanitizePortableMessage(message: CoachMessage): CoachMessage {
  return { ...message, content: redactPortableText(message.content) };
}

function sanitizePortableRunEvent(event: CoachRunEvent): CoachRunEvent {
  return event.type === "text-delta"
    ? { ...event, delta: redactPortableText(event.delta) }
    : event;
}

function sanitizePortableMemory(item: WorkingMemoryItem): WorkingMemoryItem {
  return { ...item, content: redactPortableText(item.content) };
}

/**
 * Action Log remains useful after export because its identity, causal chain,
 * rule versions and revisions are intact. Only its free-form payload values
 * are redacted: these are the fields where a user or provider can have copied
 * a direct identifier into an otherwise structured audit record.
 */
function sanitizePortableActionEvent(event: ActionEvent): ActionEvent {
  return {
    ...event,
    intent: redactPortableText(event.intent),
    before: redactPortableRecord(event.before),
    after: redactPortableRecord(event.after),
  };
}

function redactPortableRecord(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactPortableValue(item)]),
  );
}

function redactPortableValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPortableText(value);
  }
  if (Array.isArray(value)) {
    return value.map(redactPortableValue);
  }
  if (value && typeof value === "object") {
    return redactPortableRecord(value as Readonly<Record<string, unknown>>);
  }
  return value;
}

function redactPortableText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g, "[redacted-phone]")
    .replace(/(?:姓名|地址|住址)\s*[:：]\s*[^，。；;\n]+/g, "[redacted-direct-identity]");
}

const runtimeGroupNames = [
  "sessions",
  "messages",
  "runs",
  "toolCalls",
  "artifacts",
  "presentations",
  "actionEvents",
  "workingMemory",
] as const;

type RuntimeGroupName = typeof runtimeGroupNames[number];
type RuntimeRecord =
  | CoachSession
  | CoachMessage
  | CoachRunRecord
  | CoachToolCallRecord
  | Artifact
  | PresentationRef
  | ActionEvent
  | WorkingMemoryItem;

function runtimeGroups(payload: PortableExportPayload): readonly { name: RuntimeGroupName; items: readonly RuntimeRecord[] }[] {
  return runtimeGroupNames.map((name) => ({ name, items: payload[name] as readonly RuntimeRecord[] }));
}

function runtimeGroupForSnapshot(snapshot: LedgerSnapshot, name: RuntimeGroupName): readonly RuntimeRecord[] {
  return snapshot[name] as readonly RuntimeRecord[];
}

function appendNewById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const existing = new Map(current.map((item) => [item.id, item]));
  const appended: T[] = [];
  for (const item of incoming) {
    const present = existing.get(item.id);
    if (!present) {
      existing.set(item.id, item);
      appended.push(item);
    } else if (stableHash(present) !== stableHash(item)) {
      throw new Error("portable_restore_runtime_conflict");
    }
  }
  return [...current, ...appended];
}

function appendNewByHash<T>(current: readonly T[], incoming: readonly T[]): T[] {
  const known = new Set(current.map((item) => stableHash(item)));
  return [...current, ...incoming.filter((item) => {
    const hash = stableHash(item);
    if (known.has(hash)) return false;
    known.add(hash);
    return true;
  })];
}

function countNewById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): number {
  const known = new Set(current.map((item) => item.id));
  return incoming.filter((item) => !known.has(item.id)).length;
}

function hasUserData(snapshot: LedgerSnapshot, userId: string): boolean {
  return snapshot.domainEvents.some((item) => item.userId === userId) ||
    snapshot.sessions.some((item) => item.userId === userId) ||
    snapshot.messages.some((item) => item.userId === userId) ||
    snapshot.runs.some((item) => item.userId === userId) ||
    snapshot.toolCalls.some((item) => item.userId === userId) ||
    snapshot.actionEvents.some((item) => item.userId === userId) ||
    snapshot.workingMemory.some((item) => item.userId === userId);
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
