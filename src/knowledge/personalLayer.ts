/**
 * 个人知识层骨架（ticket 05）。
 *
 * 全局知识包提供群体证据与保守先验；本层沉淀"这个用户身上校准出的知识"——
 * 引擎把它当输入约束读，但它的内容永不回流修改全局规则。
 *
 * 四类条目（与设计决策一致）：
 * - observed_calibration：从 Timeline 事实蒸馏的校准值（如实测维持热量），带证据窗与来源事实
 * - user_preference：用户确认过的偏好，可锁定
 * - system_inference：系统推断模式（n=1），强制带置信度与证据窗，永不当生理事实
 * - unknown：显式未知，禁止携带数值
 *
 * 本轮只提供条目模型与读写接口，不接任何引擎消费者（有测试断言）。
 */
export interface PersonalKnowledgeRuntime {
  now(): string;
  nextId(prefix: string): string;
}

export type PersonalKnowledgeEntryKind =
  | "observed_calibration"
  | "user_preference"
  | "system_inference"
  | "unknown";

export interface PersonalKnowledgeEntry {
  id: string;
  userId: string;
  key: string;
  kind: PersonalKnowledgeEntryKind;
  /** unknown 条目禁止携带 value（校验强制）。 */
  value?: Readonly<Record<string, unknown>>;
  /** system_inference 必填，区间 (0,1)。 */
  confidence?: number;
  /** observed_calibration / system_inference 必填。 */
  evidenceWindow?: { from: string; to: string };
  /** 产生该条目的 Timeline 事实引用；correction 失效钩子的依据。 */
  sourceFactRefs?: readonly string[];
  confirmedAt?: string;
  locked?: boolean;
  version: number;
  status: "active" | "invalidated" | "forgotten";
  supersededBy?: string;
  forgottenAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class PersonalKnowledgeValidationError extends Error {
  constructor(readonly code: "inference_needs_evidence" | "unknown_forbids_value") {
    super(code);
    this.name = "PersonalKnowledgeValidationError";
  }
}

export class PersonalKnowledgeConflictError extends Error {
  constructor() {
    super("personal_knowledge_conflict");
    this.name = "PersonalKnowledgeConflictError";
  }
}

/** 存储端口：骨架轮的默认实现是内存；接引擎时再迁 ledger。 */
export interface PersonalKnowledgeStore {
  list(userId: string): Promise<readonly PersonalKnowledgeEntry[]>;
  put(entry: PersonalKnowledgeEntry): Promise<void>;
}

export class InMemoryPersonalKnowledgeStore implements PersonalKnowledgeStore {
  private readonly entries = new Map<string, PersonalKnowledgeEntry>();

  async list(userId: string): Promise<readonly PersonalKnowledgeEntry[]> {
    return [...this.entries.values()].filter((entry) => entry.userId === userId);
  }

  async put(entry: PersonalKnowledgeEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }
}

type PutInput =
  | {
      userId: string;
      key: string;
      kind: "observed_calibration";
      value: Readonly<Record<string, unknown>>;
      evidenceWindow: { from: string; to: string };
      sourceFactRefs: readonly string[];
    }
  | {
      userId: string;
      key: string;
      kind: "user_preference";
      value: Readonly<Record<string, unknown>>;
      confirmedAt: string;
      locked: boolean;
    }
  | {
      userId: string;
      key: string;
      kind: "system_inference";
      value: Readonly<Record<string, unknown>>;
      confidence: number;
      evidenceWindow: { from: string; to: string };
      sourceFactRefs: readonly string[];
    }
  | { userId: string; key: string; kind: "unknown" };

export class PersonalKnowledgeLayer {
  constructor(
    private readonly store: PersonalKnowledgeStore,
    private readonly runtime: PersonalKnowledgeRuntime,
  ) {}

  async put(input: PutInput): Promise<PersonalKnowledgeEntry> {
    validateInput(input);
    const now = this.runtime.now();
    const entry: PersonalKnowledgeEntry = {
      id: this.runtime.nextId("personal-knowledge"),
      userId: input.userId,
      key: input.key,
      kind: input.kind,
      ...("value" in input && input.value !== undefined ? { value: input.value } : {}),
      ...(input.kind === "system_inference" ? { confidence: input.confidence } : {}),
      ...("evidenceWindow" in input ? { evidenceWindow: input.evidenceWindow } : {}),
      ...("sourceFactRefs" in input ? { sourceFactRefs: input.sourceFactRefs } : {}),
      ...(input.kind === "user_preference"
        ? { confirmedAt: input.confirmedAt, locked: input.locked }
        : {}),
      version: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(entry);
    return entry;
  }

  async get(userId: string, id: string): Promise<PersonalKnowledgeEntry | undefined> {
    return (await this.store.list(userId)).find((entry) => entry.id === id);
  }

  async list(userId: string): Promise<readonly PersonalKnowledgeEntry[]> {
    return (await this.store.list(userId)).filter((entry) => entry.status !== "forgotten");
  }

  async supersede(input: {
    userId: string;
    id: string;
    expectedVersion: number;
    next: {
      kind: PersonalKnowledgeEntryKind;
      value?: Readonly<Record<string, unknown>>;
      confidence?: number;
      evidenceWindow?: { from: string; to: string };
      sourceFactRefs?: readonly string[];
      confirmedAt?: string;
      locked?: boolean;
    };
  }): Promise<PersonalKnowledgeEntry> {
    const current = await this.requireEntry(input.userId, input.id, input.expectedVersion);
    validateParts(input.next);
    const now = this.runtime.now();
    const next: PersonalKnowledgeEntry = {
      ...current,
      kind: input.next.kind,
      ...(input.next.value !== undefined ? { value: input.next.value } : {}),
      ...(input.next.confidence !== undefined ? { confidence: input.next.confidence } : {}),
      ...(input.next.evidenceWindow ? { evidenceWindow: input.next.evidenceWindow } : {}),
      ...(input.next.sourceFactRefs ? { sourceFactRefs: input.next.sourceFactRefs } : {}),
      ...(input.next.confirmedAt ? { confirmedAt: input.next.confirmedAt } : {}),
      ...(input.next.locked !== undefined ? { locked: input.next.locked } : {}),
      version: current.version + 1,
      status: "active",
      updatedAt: now,
    };
    await this.store.put({ ...current, status: "forgotten", supersededBy: next.id, updatedAt: now });
    await this.store.put(next);
    return next;
  }

  async forget(input: { userId: string; id: string; expectedVersion: number }): Promise<void> {
    const current = await this.requireEntry(input.userId, input.id, input.expectedVersion);
    const now = this.runtime.now();
    await this.store.put({ ...current, status: "forgotten", forgottenAt: now, updatedAt: now });
  }

  /** Timeline correction 钩子：引用被更正事实的条目标记 invalidated，等待重建。 */
  async invalidateEntriesCiting(userId: string, correctedFactRefs: readonly string[]): Promise<readonly string[]> {
    const now = this.runtime.now();
    const invalidated: string[] = [];
    for (const entry of await this.store.list(userId)) {
      if (entry.status !== "active" || !entry.sourceFactRefs?.length) continue;
      if (!entry.sourceFactRefs.some((ref) => correctedFactRefs.includes(ref))) continue;
      await this.store.put({ ...entry, status: "invalidated", updatedAt: now });
      invalidated.push(entry.id);
    }
    return invalidated;
  }

  private async requireEntry(
    userId: string,
    id: string,
    expectedVersion: number,
  ): Promise<PersonalKnowledgeEntry> {
    const current = await this.get(userId, id);
    if (!current || current.version !== expectedVersion || current.status === "forgotten") {
      throw new PersonalKnowledgeConflictError();
    }
    return current;
  }
}

function validateInput(input: PutInput): void {
  validateParts(input);
}

function validateParts(parts: {
  kind: PersonalKnowledgeEntryKind;
  value?: Readonly<Record<string, unknown>>;
  confidence?: number;
  evidenceWindow?: { from: string; to: string };
  sourceFactRefs?: readonly string[];
}): void {
  if (parts.kind === "unknown") {
    if (parts.value !== undefined) {
      throw new PersonalKnowledgeValidationError("unknown_forbids_value");
    }
    return;
  }
  if (parts.kind === "system_inference") {
    if (
      typeof parts.confidence !== "number" ||
      Number.isNaN(parts.confidence) ||
      parts.confidence <= 0 ||
      parts.confidence >= 1
    ) {
      throw new PersonalKnowledgeValidationError("inference_needs_evidence");
    }
  }
  if (parts.kind === "system_inference" || parts.kind === "observed_calibration") {
    if (!parts.evidenceWindow || !parts.sourceFactRefs?.length) {
      throw new PersonalKnowledgeValidationError("inference_needs_evidence");
    }
  }
}
