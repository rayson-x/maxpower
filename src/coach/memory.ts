import type { CoachLedger } from "./ledger";
import { LedgerConflictError } from "./ledger";
import type { ActionEvent, FactRef, RuntimeServices, WorkingMemoryItem } from "./model";
import { stableHash } from "./stable";

export class MemoryConflictError extends Error {
  constructor(
    readonly code:
      | "memory_not_found"
      | "memory_conflict"
      | "memory_superseded"
      | "pinned_memory"
      | "invalid_memory",
  ) {
    super(code);
    this.name = "MemoryConflictError";
  }
}

export interface UpsertMemoryInput {
  id?: string;
  expectedVersion?: number;
  userId: string;
  actor: "user" | "agent";
  sessionId?: string;
  runId?: string;
  kind: WorkingMemoryItem["kind"];
  content: string;
  evidenceRefs: readonly FactRef[];
  confidence: number;
  expiresAt?: string;
  sensitivity: WorkingMemoryItem["sensitivity"];
  pinned?: boolean;
  idempotencyKey?: string;
}

export class MemoryCurator {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
  ) {}

  async upsert(input: UpsertMemoryInput): Promise<WorkingMemoryItem> {
    validateMemoryInput(input.content, input.confidence);
    const snapshot = await this.ledger.read();
    assertUserExists(snapshot, input.userId);
    const existing = input.id
      ? snapshot.workingMemory.find((item) => item.id === input.id && item.userId === input.userId)
      : undefined;
    if (input.id && !existing) throw new MemoryConflictError("memory_not_found");
    if (existing && input.expectedVersion !== existing.version) {
      throw new MemoryConflictError("memory_conflict");
    }
    if (existing?.supersededBy) throw new MemoryConflictError("memory_superseded");
    if (existing?.pinned && input.actor === "agent") throw new MemoryConflictError("pinned_memory");
    const now = this.runtime.now();
    const item: WorkingMemoryItem = {
      id: existing?.id ?? this.runtime.nextId("memory"),
      userId: input.userId,
      kind: input.kind,
      content: input.content.trim(),
      evidenceRefs: input.evidenceRefs,
      provenance: {
        actor: input.actor,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
      },
      authority: "non_authoritative",
      confidence: input.confidence,
      version: (existing?.version ?? 0) + 1,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      sensitivity: input.sensitivity,
      pinned: input.actor === "user" ? (input.pinned ?? existing?.pinned ?? false) : false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const session = input.sessionId
      ? snapshot.sessions.find(
          (candidate) => candidate.id === input.sessionId && candidate.userId === input.userId,
        )
      : undefined;
    if (input.sessionId && !session) throw new MemoryConflictError("memory_not_found");
    const updatedSession = session
      ? {
          ...session,
          revision: (session.revision ?? 1) + 1,
          workingMemoryIds: [...new Set([...(session.workingMemoryIds ?? []), item.id])],
          updatedAt: now,
        }
      : undefined;
    try {
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: input.actor,
        intent: "working_memory.upsert",
        expectedRevisions: [],
        expectedWorkingMemoryVersions: [{ id: item.id, version: existing?.version ?? 0 }],
        ...(session
          ? { expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }] }
          : {}),
        domainEvents: [],
        workingMemoryItems: [item],
        actionEvents: [memoryAction({
          runtime: this.runtime,
          item,
          before: existing,
          actor: input.actor,
          intent: "working_memory.upsert",
        })],
        ...(updatedSession ? { sessions: [updatedSession] } : {}),
        idempotencyKey:
          input.idempotencyKey ??
          stableHash({ intent: "working_memory.upsert", item, expected: existing?.version ?? 0 }),
        recordedAt: now,
      });
    } catch (error) {
      if (error instanceof LedgerConflictError) throw new MemoryConflictError("memory_conflict");
      throw error;
    }
    return item;
  }

  async list(userId: string): Promise<readonly WorkingMemoryItem[]> {
    const snapshot = await this.ledger.read();
    return snapshot.workingMemory.filter((item) => item.userId === userId && !item.deletedAt);
  }

  async forget(input: { userId: string; id: string; expectedVersion: number }): Promise<void> {
    const snapshot = await this.ledger.read();
    const existing = findEditable(snapshot.workingMemory, input);
    const now = this.runtime.now();
    await this.commitItems({
      userId: input.userId,
      actor: "user",
      intent: "working_memory.forget",
      expected: [{ id: existing.id, version: existing.version }],
      items: [{ ...existing, version: existing.version + 1, deletedAt: now, updatedAt: now }],
      now,
    });
  }

  async setPinned(input: {
    userId: string;
    id: string;
    expectedVersion: number;
    pinned: boolean;
  }): Promise<WorkingMemoryItem> {
    const snapshot = await this.ledger.read();
    const existing = findEditable(snapshot.workingMemory, input);
    const now = this.runtime.now();
    const item = { ...existing, pinned: input.pinned, version: existing.version + 1, updatedAt: now };
    await this.commitItems({
      userId: input.userId,
      actor: "user",
      intent: "working_memory.pin",
      expected: [{ id: existing.id, version: existing.version }],
      items: [item],
      now,
    });
    return item;
  }

  async supersede(input: {
    userId: string;
    actor: "user" | "agent";
    id: string;
    expectedVersion: number;
    content: string;
    confidence: number;
    runId?: string;
  }): Promise<WorkingMemoryItem> {
    validateMemoryInput(input.content, input.confidence);
    const snapshot = await this.ledger.read();
    const existing = findEditable(snapshot.workingMemory, input);
    if (existing.pinned && input.actor === "agent") throw new MemoryConflictError("pinned_memory");
    const now = this.runtime.now();
    const replacement: WorkingMemoryItem = {
      ...existing,
      id: this.runtime.nextId("memory"),
      content: input.content.trim(),
      confidence: input.confidence,
      provenance: { actor: input.actor, ...(input.runId ? { runId: input.runId } : {}) },
      pinned: input.actor === "user" ? existing.pinned : false,
      version: 1,
      createdAt: now,
      updatedAt: now,
      supersededBy: undefined,
      deletedAt: undefined,
    };
    const superseded = {
      ...existing,
      supersededBy: replacement.id,
      version: existing.version + 1,
      updatedAt: now,
    };
    await this.commitItems({
      userId: input.userId,
      actor: input.actor,
      intent: "working_memory.supersede",
      expected: [
        { id: existing.id, version: existing.version },
        { id: replacement.id, version: 0 },
      ],
      items: [superseded, replacement],
      now,
    });
    return replacement;
  }

  async compact(input: {
    userId: string;
    actor: "user" | "agent";
    sourceIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
    content: string;
    confidence: number;
    runId?: string;
  }): Promise<WorkingMemoryItem> {
    validateMemoryInput(input.content, input.confidence);
    if (input.sourceIds.length < 2 || new Set(input.sourceIds).size !== input.sourceIds.length) {
      throw new MemoryConflictError("invalid_memory");
    }
    const snapshot = await this.ledger.read();
    const sources = input.sourceIds.map((id) =>
      findEditable(snapshot.workingMemory, {
        userId: input.userId,
        id,
        expectedVersion: input.expectedVersions[id] ?? -1,
      }),
    );
    if (input.actor === "agent" && sources.some((item) => item.pinned)) {
      throw new MemoryConflictError("pinned_memory");
    }
    const now = this.runtime.now();
    const compactedId = this.runtime.nextId("memory");
    const compacted: WorkingMemoryItem = {
      id: compactedId,
      userId: input.userId,
      kind: "strategy_note",
      content: input.content.trim(),
      evidenceRefs: dedupeEvidence(sources.flatMap((item) => item.evidenceRefs)),
      provenance: { actor: input.actor, ...(input.runId ? { runId: input.runId } : {}) },
      authority: "non_authoritative",
      confidence: input.confidence,
      version: 1,
      sensitivity: sources.some((item) => item.sensitivity === "private") ? "private" : "normal",
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    const superseded = sources.map((item) => ({
      ...item,
      supersededBy: compactedId,
      version: item.version + 1,
      updatedAt: now,
    }));
    await this.commitItems({
      userId: input.userId,
      actor: input.actor,
      intent: "working_memory.compact",
      expected: [
        ...sources.map((item) => ({ id: item.id, version: item.version })),
        { id: compacted.id, version: 0 },
      ],
      items: [...superseded, compacted],
      now,
    });
    return compacted;
  }

  private async commitItems(input: {
    userId: string;
    actor: "user" | "agent";
    intent: string;
    expected: readonly { id: string; version: number }[];
    items: readonly WorkingMemoryItem[];
    now: string;
  }): Promise<void> {
    try {
      const before = await this.ledger.read();
      const previousById = new Map(
        before.workingMemory
          .filter((item) => item.userId === input.userId)
          .map((item) => [item.id, item] as const),
      );
      await this.ledger.commit({
        kind: "domain",
        userId: input.userId,
        actorId: input.actor,
        intent: input.intent,
        expectedRevisions: [],
        expectedWorkingMemoryVersions: input.expected,
        domainEvents: [],
        workingMemoryItems: input.items,
        actionEvents: input.items.map((item) => memoryAction({
          runtime: this.runtime,
          item,
          before: previousById.get(item.id),
          actor: input.actor,
          intent: input.intent,
        })),
        idempotencyKey: stableHash({ intent: input.intent, expected: input.expected, items: input.items }),
        recordedAt: input.now,
      });
    } catch (error) {
      if (error instanceof LedgerConflictError) throw new MemoryConflictError("memory_conflict");
      throw error;
    }
  }
}

function findEditable(
  items: readonly WorkingMemoryItem[],
  input: { userId: string; id: string; expectedVersion: number },
): WorkingMemoryItem {
  const existing = items.find(
    (item) => item.userId === input.userId && item.id === input.id && !item.deletedAt,
  );
  if (!existing) throw new MemoryConflictError("memory_not_found");
  if (existing.supersededBy) throw new MemoryConflictError("memory_superseded");
  if (existing.version !== input.expectedVersion) throw new MemoryConflictError("memory_conflict");
  return existing;
}

function validateMemoryInput(content: string, confidence: number): void {
  if (!content.trim() || content.trim().length > 1000 || confidence < 0 || confidence > 1) {
    throw new MemoryConflictError("invalid_memory");
  }
}

function assertUserExists(snapshot: Awaited<ReturnType<CoachLedger["read"]>>, userId: string): void {
  if (
    !snapshot.domainEvents.some(
      (event) => event.userId === userId && event.aggregate.kind === "user_profile",
    )
  ) {
    throw new MemoryConflictError("memory_not_found");
  }
}

function dedupeEvidence(evidence: readonly FactRef[]): FactRef[] {
  const seen = new Set<string>();
  return evidence.filter((ref) => {
    const key = `${ref.aggregate}:${ref.id}:${ref.revision}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Memory content can be private; the Action Log records its lifecycle, not its text. */
function memoryAction(input: {
  runtime: RuntimeServices;
  item: WorkingMemoryItem;
  before?: WorkingMemoryItem;
  actor: "user" | "agent";
  intent: string;
}): ActionEvent {
  const beforeRef = input.before
    ? [{ aggregate: "memory" as const, id: input.before.id, revision: input.before.version }]
    : [];
  const afterRef = [{ aggregate: "memory" as const, id: input.item.id, revision: input.item.version }];
  const status = input.item.deletedAt
    ? "deleted"
    : input.item.supersededBy
      ? "superseded"
      : input.before
        ? "updated"
        : "created";
  return {
    id: input.runtime.nextId("action"),
    userId: input.item.userId,
    occurredAt: input.item.updatedAt,
    actor: input.actor,
    action: "memory.changed",
    targetType: "memory",
    targetId: input.item.id,
    scope: "working_memory",
    intent: input.intent,
    ...(input.before ? { beforeRevision: input.before.version } : {}),
    afterRevision: input.item.version,
    before: input.before
      ? { kind: input.before.kind, pinned: input.before.pinned, sensitivity: input.before.sensitivity }
      : {},
    after: {
      status,
      kind: input.item.kind,
      pinned: input.item.pinned,
      sensitivity: input.item.sensitivity,
      authority: "non_authoritative",
    },
    evidenceRefs: input.item.evidenceRefs,
    beforeRefs: beforeRef,
    afterRefs: afterRef,
    ruleVersions: {},
    mandateRevision: 0,
    result: "applied",
    undoBoundary: "not_reversible",
    ...(input.item.provenance.sessionId ? { sessionId: input.item.provenance.sessionId } : {}),
    ...(input.item.provenance.runId ? { runId: input.item.provenance.runId } : {}),
    policyDecision: "allow",
    ...(input.actor === "user" ? { humanDecision: "confirmed" as const } : {}),
    causationId: input.item.id,
    correlationId: stableHash({ intent: input.intent, id: input.item.id, version: input.item.version }),
    reversible: false,
  };
}
