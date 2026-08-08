import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  InMemoryCoachLedger,
  type AtomicCommit,
  type CoachLedger,
} from "../../src/coach/ledger";
import type { LedgerSnapshot } from "../../src/coach/model";
import {
  RecoverableCoachLedgerMigrationError,
  SQLITE_COACH_LEDGER_SCHEMA_VERSION,
  SQLiteCoachLedger,
  type SQLiteBindValue,
  type SQLiteDatabaseLike,
} from "../../src/coach/sqlite";

const EMPTY: LedgerSnapshot = {
  sessions: [],
  users: [],
  artifacts: [],
  presentations: [],
  runEvents: [],
  actionTokens: [],
  actionEvents: [],
  idempotency: [],
  pendingHumanActions: [],
  workingMemory: [],
};

const SNAPSHOT: LedgerSnapshot = {
  sessions: [
    {
      id: "session-active",
      userId: "user-1",
      status: "active",
      context: { kind: "workout", ref: "workout-1" },
      createdAt: "2026-08-08T08:20:00.000Z",
      updatedAt: "2026-08-08T08:20:00.000Z",
    },
    {
      id: "session-1",
      userId: "user-1",
      status: "suspended",
      context: { kind: "today", ref: "2026-08-08" },
      createdAt: "2026-08-08T08:00:00.000Z",
      updatedAt: "2026-08-08T08:15:00.000Z",
    },
    {
      id: "session-completed",
      userId: "user-1",
      status: "completed",
      context: { kind: "progress", ref: "week-31" },
      createdAt: "2026-08-07T08:00:00.000Z",
      updatedAt: "2026-08-07T09:00:00.000Z",
    },
    {
      id: "session-archived",
      userId: "user-1",
      status: "archived",
      context: { kind: "calendar", ref: "2026-07" },
      createdAt: "2026-07-01T08:00:00.000Z",
      updatedAt: "2026-07-31T08:00:00.000Z",
    },
  ],
  users: [],
  artifacts: [
    {
      id: "artifact-1",
      kind: "today_plan",
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: "2026-08-08T08:01:00.000Z",
      contextRefs: [{ kind: "today", ref: "2026-08-08" }],
      evidenceRefs: [{ aggregate: "plan", id: "user-1", revision: 3 }],
      missingness: [],
      capabilityBoundary: ["没有实时恢复数据"],
      hash: "fnv1a-known",
      date: "2026-08-08",
      title: "上肢推力量日",
      planRevision: 3,
      tasks: [{ id: "bench", name: "杠铃卧推", sets: 4, reps: "8", loadKg: 62.5 }],
    },
  ],
  presentations: [
    {
      id: "presentation-1",
      artifactId: "artifact-1",
      renderer: "today-plan/v1",
      status: "ready",
    },
  ],
  runEvents: [
    {
      type: "artifact-ready",
      sessionId: "session-1",
      runId: "run-1",
      toolCallId: "tool-1",
      artifactRef: {
        id: "artifact-1",
        kind: "today_plan",
        schemaVersion: 1,
        hash: "fnv1a-known",
      },
      presentation: {
        id: "presentation-1",
        artifactId: "artifact-1",
        renderer: "today-plan/v1",
        status: "ready",
      },
      occurredAt: "2026-08-08T08:01:00.000Z",
    },
  ],
  actionTokens: [],
  actionEvents: [],
  idempotency: [],
  pendingHumanActions: [],
  workingMemory: [],
};

const ATOMIC_SEED: LedgerSnapshot = {
  ...EMPTY,
  users: [
    {
      userId: "user-1",
      profile: { goal: "strength", trainingExperience: "intermediate" },
      profileRevision: 1,
      plan: {
        revision: 1,
        effectiveDate: "2026-08-08",
        title: "力量日",
        tasks: [{ id: "bench", name: "杠铃卧推", sets: 3, reps: "5", loadKg: 60 }],
      },
      timeline: [],
      timelineRevision: 0,
      mandate: { mode: "collaborative", revision: 1 },
      safetyHold: false,
    },
  ],
  actionTokens: [
    {
      token: "token-1",
      userId: "user-1",
      sessionId: "session-1",
      runId: "run-1",
      toolCallId: "tool-1",
      artifactId: "proposal-1",
      artifactHash: "fnv1a-proposal",
      action: "apply",
      expectedPlanRevision: 1,
      expectedMandateRevision: 1,
      expiresAt: "2026-08-08T09:00:00.000Z",
      nonce: "nonce-1",
    },
  ],
};

const ATOMIC_COMMIT: AtomicCommit = {
  userId: "user-1",
  expectedPlanRevision: 1,
  expectedMandateRevision: 1,
  plan: {
    revision: 2,
    previousRevision: 1,
    effectiveDate: "2026-08-08",
    title: "力量日",
    reason: "上一组余力充足",
    tasks: [{ id: "bench", name: "杠铃卧推", sets: 3, reps: "5", loadKg: 62.5 }],
  },
  artifacts: [
    {
      id: "receipt-1",
      kind: "action_receipt",
      schemaVersion: 1,
      renderVersion: 1,
      createdAt: "2026-08-08T08:30:00.000Z",
      contextRefs: [{ kind: "workout", ref: "workout-1" }],
      evidenceRefs: [{ aggregate: "plan", id: "user-1", revision: 1 }],
      missingness: [],
      capabilityBoundary: [],
      hash: "fnv1a-receipt",
      action: "apply",
      targetArtifactId: "proposal-1",
      result: "applied",
      beforeRevision: 1,
      afterRevision: 2,
    },
  ],
  presentations: [],
  runEvents: [],
  actionEvent: {
    id: "event-1",
    userId: "user-1",
    occurredAt: "2026-08-08T08:30:00.000Z",
    actor: "user",
    action: "plan.change.applied",
    targetType: "plan",
    targetId: "user-1",
    beforeRevision: 1,
    afterRevision: 2,
    before: { loadKg: 60 },
    after: { loadKg: 62.5 },
    evidenceRefs: [{ aggregate: "plan", id: "user-1", revision: 1 }],
    policyDecision: "require_confirmation",
    humanDecision: "confirmed",
    causationId: "proposal-1",
    correlationId: "run-1",
    reversible: true,
  },
  consumeToken: "token-1",
  idempotencyKey: "apply-proposal-1",
  occurredAt: "2026-08-08T08:30:00.000Z",
};

class NodeSQLiteDatabase implements SQLiteDatabaseLike {
  constructor(private readonly database: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async getFirstAsync<T>(source: string, ...params: SQLiteBindValue[]): Promise<T | null> {
    return (this.database.prepare(source).get(...params) as T | undefined) ?? null;
  }

  async runAsync(source: string, ...params: SQLiteBindValue[]): Promise<unknown> {
    return this.database.prepare(source).run(...params);
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function registerLedgerConformance(
  name: string,
  createLedger: () => Promise<{ ledger: CoachLedger; dispose(): Promise<void> }>,
): void {
  test(`${name}: 空存储返回规范空快照`, async () => {
    const fixture = await createLedger();
    try {
      assert.deepEqual(await fixture.ledger.read(), EMPTY);
    } finally {
      await fixture.dispose();
    }
  });

  test(`${name}: 会无损保存并隔离返回的 Session、上下文、Run 与 Presentation`, async () => {
    const fixture = await createLedger();
    try {
      await fixture.ledger.replace(SNAPSHOT);
      const first = await fixture.ledger.read();
      assert.deepEqual(first, SNAPSHOT);

      first.sessions[0]!.context.ref = "mutated-by-caller";
      const second = await fixture.ledger.read();
      assert.equal(second.sessions[0]!.context.ref, "workout-1");
      assert.equal(second.artifacts[0]!.hash, "fnv1a-known");
    } finally {
      await fixture.dispose();
    }
  });

  test(`${name}: 原子提交只消费一次 token，并让重复请求幂等`, async () => {
    const fixture = await createLedger();
    try {
      await fixture.ledger.replace(ATOMIC_SEED);
      assert.deepEqual(await fixture.ledger.commit(ATOMIC_COMMIT), {
        status: "committed",
        resultArtifactId: "receipt-1",
      });
      assert.deepEqual(await fixture.ledger.commit(ATOMIC_COMMIT), {
        status: "idempotent",
        resultArtifactId: "receipt-1",
      });

      const stored = await fixture.ledger.read();
      assert.equal(stored.users[0]!.plan.revision, 2);
      assert.equal(stored.actionTokens[0]!.consumedAt, "2026-08-08T08:30:00.000Z");
      assert.equal(stored.actionEvents.length, 1);
      assert.equal(stored.idempotency.length, 1);
    } finally {
      await fixture.dispose();
    }
  });
}

registerLedgerConformance("InMemoryCoachLedger", async () => ({
  ledger: new InMemoryCoachLedger(),
  async dispose() {},
}));

registerLedgerConformance("SQLiteCoachLedger", async () => {
  const database = new DatabaseSync(":memory:");
  return {
    ledger: new SQLiteCoachLedger(new NodeSQLiteDatabase(database)),
    async dispose() {
      database.close();
    },
  };
});

test("SQLiteCoachLedger: 应用重启后恢复本地 Session 与待展示状态", async () => {
  const directory = await mkdtemp(join(tmpdir(), "form-coach-ledger-"));
  const path = join(directory, "coach.db");
  try {
    const beforeRestart = new DatabaseSync(path);
    await new SQLiteCoachLedger(new NodeSQLiteDatabase(beforeRestart)).replace(SNAPSHOT);
    beforeRestart.close();

    const afterRestart = new DatabaseSync(path);
    const restored = await new SQLiteCoachLedger(new NodeSQLiteDatabase(afterRestart)).read();
    afterRestart.close();

    assert.deepEqual(restored, SNAPSHOT);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("相同种子在 In-memory 与 SQLite 中保留同一 TodayPlan Artifact hash", async () => {
  const database = new DatabaseSync(":memory:");
  try {
    const memory = new InMemoryCoachLedger();
    const sqlite = new SQLiteCoachLedger(new NodeSQLiteDatabase(database));
    await memory.replace(SNAPSHOT);
    await sqlite.replace(SNAPSHOT);

    const memoryArtifact = (await memory.read()).artifacts.find(
      (artifact) => artifact.kind === "today_plan",
    );
    const sqliteArtifact = (await sqlite.read()).artifacts.find(
      (artifact) => artifact.kind === "today_plan",
    );
    assert.equal(sqliteArtifact?.hash, memoryArtifact?.hash);
    assert.equal(sqliteArtifact?.hash, "fnv1a-known");
  } finally {
    database.close();
  }
});

test("SQLiteCoachLedger: 不支持的 schema 版本返回可恢复迁移错误", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`PRAGMA user_version = ${SQLITE_COACH_LEDGER_SCHEMA_VERSION + 1}`);
  const ledger = new SQLiteCoachLedger(new NodeSQLiteDatabase(database));

  await assert.rejects(
    ledger.read(),
    (error: unknown) =>
      error instanceof RecoverableCoachLedgerMigrationError &&
      error.code === "COACH_LEDGER_MIGRATION_RECOVERY_REQUIRED" &&
      error.foundVersion === SQLITE_COACH_LEDGER_SCHEMA_VERSION + 1,
  );
  database.close();
});
