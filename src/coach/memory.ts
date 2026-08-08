import type { CoachLedger } from "./ledger";
import type { FactRef, RuntimeServices, WorkingMemoryItem } from "./model";

export class MemoryConflictError extends Error {
  constructor(readonly code: "memory_not_found" | "memory_conflict" | "pinned_memory" | "invalid_memory") {
    super(code);
    this.name = "MemoryConflictError";
  }
}

export interface UpsertMemoryInput {
  id?: string;
  expectedVersion?: number;
  userId: string;
  actor: "user" | "agent";
  runId?: string;
  kind: WorkingMemoryItem["kind"];
  content: string;
  evidenceRefs: readonly FactRef[];
  confidence: number;
  expiresAt?: string;
  sensitivity: WorkingMemoryItem["sensitivity"];
  pinned?: boolean;
}

export class MemoryCurator {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
  ) {}

  async upsert(input: UpsertMemoryInput): Promise<WorkingMemoryItem> {
    const content = input.content.trim();
    if (!content || content.length > 1000 || input.confidence < 0 || input.confidence > 1) {
      throw new MemoryConflictError("invalid_memory");
    }
    const snapshot = await this.ledger.read();
    if (!snapshot.users.some((user) => user.userId === input.userId)) {
      throw new MemoryConflictError("memory_not_found");
    }
    const existing = input.id
      ? snapshot.workingMemory.find((item) => item.id === input.id && item.userId === input.userId)
      : undefined;
    if (input.id && !existing) throw new MemoryConflictError("memory_not_found");
    if (existing && input.expectedVersion !== existing.version) {
      throw new MemoryConflictError("memory_conflict");
    }
    if (existing?.pinned && input.actor === "agent") {
      throw new MemoryConflictError("pinned_memory");
    }
    const now = this.runtime.now();
    const item: WorkingMemoryItem = {
      id: existing?.id ?? this.runtime.nextId("memory"),
      userId: input.userId,
      kind: input.kind,
      content,
      evidenceRefs: input.evidenceRefs,
      provenance: { actor: input.actor, ...(input.runId ? { runId: input.runId } : {}) },
      confidence: input.confidence,
      version: (existing?.version ?? 0) + 1,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      sensitivity: input.sensitivity,
      pinned: input.actor === "user" ? (input.pinned ?? existing?.pinned ?? false) : false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.ledger.replace({
      ...snapshot,
      workingMemory: [
        ...snapshot.workingMemory.filter((candidate) => candidate.id !== item.id),
        item,
      ],
    });
    return item;
  }

  async list(userId: string): Promise<readonly WorkingMemoryItem[]> {
    const snapshot = await this.ledger.read();
    return snapshot.workingMemory.filter((item) => item.userId === userId && !item.deletedAt);
  }

  async forget(input: { userId: string; id: string; expectedVersion: number }): Promise<void> {
    const snapshot = await this.ledger.read();
    const existing = snapshot.workingMemory.find(
      (item) => item.userId === input.userId && item.id === input.id && !item.deletedAt,
    );
    if (!existing) throw new MemoryConflictError("memory_not_found");
    if (existing.version !== input.expectedVersion) throw new MemoryConflictError("memory_conflict");
    await this.ledger.replace({
      ...snapshot,
      workingMemory: [
        ...snapshot.workingMemory.filter((item) => item.id !== existing.id),
        {
          ...existing,
          version: existing.version + 1,
          deletedAt: this.runtime.now(),
          updatedAt: this.runtime.now(),
        },
      ],
    });
  }
}
