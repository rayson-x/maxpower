import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import {
  InMemoryCoachLedger,
  LedgerConflictError,
  type CoachLedger,
  type DomainAtomicCommit,
} from "../../src/coach/ledger";
import type { DomainEvent } from "../../src/coach/domain";
import {
  SQLITE_COACH_LEDGER_SCHEMA_VERSION,
  SQLiteCoachLedger,
  type SQLiteBindValue,
  type SQLiteDatabaseLike,
} from "../../src/coach/sqlite";

class NodeSQLiteDatabase implements SQLiteDatabaseLike {
  failNextSnapshotWrite = false;

  constructor(readonly database: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async getFirstAsync<T>(source: string, ...params: SQLiteBindValue[]): Promise<T | null> {
    return (this.database.prepare(source).get(...params) as T | undefined) ?? null;
  }

  async runAsync(source: string, ...params: SQLiteBindValue[]): Promise<unknown> {
    if (this.failNextSnapshotWrite && source.includes("INSERT INTO coach_ledger_snapshot")) {
      this.failNextSnapshotWrite = false;
      throw new Error("simulated_storage_interruption");
    }
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

interface LedgerFixture {
  ledger: CoachLedger;
  interruptNextWrite?(): void;
  dispose(): void;
}

const factories: readonly [string, () => LedgerFixture][] = [
  [
    "InMemoryCoachLedger",
    () => ({ ledger: new InMemoryCoachLedger(), dispose() {} }),
  ],
  [
    "SQLiteCoachLedger",
    () => {
      const database = new NodeSQLiteDatabase(new DatabaseSync(":memory:"));
      return {
        ledger: new SQLiteCoachLedger(database),
        interruptNextWrite: () => {
          database.failNextSnapshotWrite = true;
        },
        dispose: () => database.database.close(),
      };
    },
  ],
];

function runtime() {
  let sequence = 0;
  return {
    now: () => "2026-08-08T08:00:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
}

async function bootstrap(app: CoachApplication, userId = "user-1") {
  return app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: `${userId}-device`,
      occurredAt: "2026-08-08T07:55:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: `bootstrap-${userId}`,
    },
    profile: { id: `profile-${userId}`, trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: {
      id: `goal-${userId}`,
      primaryGoal: "strength",
      horizon: { startDate: "2026-08-08" },
    },
    mandate: { id: `mandate-${userId}`, mode: "collaborative" },
  });
}

for (const [name, createFixture] of factories) {
  test(`${name}: CoachApplication 完整事实链可重启重放`, async () => {
    const fixture = createFixture();
    try {
      const clock = runtime();
      let app = new CoachApplication(fixture.ledger, clock);
      const knowledgePins = app.getInstalledKnowledgeVersionPins();
      await bootstrap(app);
      const meta = (key: string, occurredAt: string) => ({
        userId: "user-1",
        actor: { kind: "user" as const, id: "user-1" },
        deviceId: "device-1",
        occurredAt,
        timezoneOffsetMinutes: 480,
        idempotencyKey: key,
      });
      const original = await app.executeDomainCommand({
        type: "timeline.append",
        meta: meta("body-original", "2026-08-08T07:00:00.000+08:00"),
        timelineId: "timeline-user-1",
        expectedRevision: 0,
        fact: {
          kind: "body",
          measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" } },
          confidence: "confirmed",
        },
      });
      await app.executeDomainCommand({
        type: "plan.revise",
        meta: meta("plan-1", "2026-08-08T07:10:00.000+08:00"),
        planId: "plan-1",
        expectedRevision: 0,
        revision: {
          id: "plan-revision-1",
          goalContractRef: { kind: "goal_contract", id: "goal-user-1", revision: 1 },
          effectiveFrom: "2026-08-08",
          knowledgePins,
          sessions: [
            {
              id: "session-1",
              title: "力量训练",
              scheduledFor: "2026-08-08",
              knowledgePins,
              tasks: [
                {
                  id: "task-1",
                  exerciseVariantId: "bench_press",
                  sets: [{ id: "set-1", targetReps: { min: 5, max: 5 } }],
                },
              ],
            },
          ],
        },
      });
      await app.executeDomainCommand({
        type: "workout.start",
        meta: meta("workout-start", "2026-08-08T08:00:00.000+08:00"),
        workoutId: "workout-1",
        expectedRevision: 0,
        prescriptionRef: {
          planId: "plan-1",
          planRevision: 1,
          sessionPrescriptionId: "session-1",
        },
      });
      await app.executeDomainCommand({
        type: "workout.record_set",
        meta: meta("workout-set", "2026-08-08T08:10:00.000+08:00"),
        workoutId: "workout-1",
        expectedRevision: 1,
        outcome: {
          id: "outcome-1",
          prescriptionSetId: "set-1",
          exerciseVariantId: "bench_press",
          actualLoad: { value: 60, unit: "kg" },
          actualReps: 5,
          actualRir: 2,
          source: "user_confirmed",
        },
      });
      await app.executeDomainCommand({
        type: "timeline.correct",
        meta: meta("body-correction", "2026-08-08T07:00:00.000+08:00"),
        timelineId: "timeline-user-1",
        expectedRevision: 1,
        correctsEventId: original.eventIds[0]!,
        fact: {
          kind: "body",
          measurement: { metric: "body_weight", quantity: { value: 79.8, unit: "kg" } },
          confidence: "confirmed",
        },
      });

      const beforeRestart = await app.readDomainProjection({ userId: "user-1" });
      app = new CoachApplication(fixture.ledger, clock);
      assert.deepEqual(await app.readDomainProjection({ userId: "user-1" }), beforeRestart);
      assert.equal(beforeRestart.timeline.current.length, 1);
      assert.equal(beforeRestart.workouts[0]?.setOutcomes[0]?.actualLoad?.value, 60);
    } finally {
      fixture.dispose();
    }
  });

  test(`${name}: command 幂等、聚合 revision 与 outbox 保持单写`, async () => {
    const fixture = createFixture();
    try {
      const app = new CoachApplication(fixture.ledger, runtime());
      const first = await bootstrap(app);
      const retry = await bootstrap(app);
      assert.equal(first.status, "committed");
      assert.equal(retry.status, "idempotent");
      assert.deepEqual(retry.eventIds, first.eventIds);

      const snapshot = await fixture.ledger.read();
      assert.equal(snapshot.domainEvents.length, 3);
      assert.equal(snapshot.aggregateRevisions.length, 3);
      assert.equal(snapshot.domainIdempotency.length, 1);
      assert.equal(snapshot.outbox.length, 3);
      assert.ok(snapshot.outbox.every((entry) => entry.status === "pending"));
    } finally {
      fixture.dispose();
    }
  });

  test(`${name}: stale revision、非法单位与跨用户引用零部分写入`, async () => {
    const fixture = createFixture();
    try {
      const app = new CoachApplication(fixture.ledger, runtime());
      const knowledgePins = app.getInstalledKnowledgeVersionPins();
      await bootstrap(app, "user-1");
      await bootstrap(app, "user-2");
      await app.executeDomainCommand({
        type: "timeline.append",
        meta: {
          userId: "user-1",
          actor: { kind: "user", id: "user-1" },
          deviceId: "device-1",
          occurredAt: "2026-08-08T08:00:00.000+08:00",
          timezoneOffsetMinutes: 480,
          idempotencyKey: "weight-1",
        },
        timelineId: "timeline-user-1",
        expectedRevision: 0,
        fact: {
          kind: "body",
          measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" } },
          confidence: "confirmed",
        },
      });
      const before = await fixture.ledger.read();

      await assert.rejects(
        app.executeDomainCommand({
          type: "timeline.append",
          meta: {
            userId: "user-1",
            actor: { kind: "user", id: "user-1" },
            deviceId: "device-1",
            occurredAt: "2026-08-08T08:01:00.000+08:00",
            timezoneOffsetMinutes: 480,
            idempotencyKey: "stale-weight",
          },
          timelineId: "timeline-user-1",
          expectedRevision: 0,
          fact: { kind: "rest", confidence: "confirmed" },
        }),
        (error: unknown) => error instanceof LedgerConflictError && error.code === "stale_aggregate",
      );
      await assert.rejects(
        app.executeDomainCommand({
          type: "timeline.append",
          meta: {
            userId: "user-1",
            actor: { kind: "user", id: "user-1" },
            deviceId: "device-1",
            occurredAt: "2026-08-08T08:02:00.000+08:00",
            timezoneOffsetMinutes: 480,
            idempotencyKey: "bad-unit",
          },
          timelineId: "timeline-user-1",
          expectedRevision: 1,
          fact: {
            kind: "body",
            measurement: {
              metric: "body_weight",
              quantity: { value: 80, unit: "stone" as never },
            },
            confidence: "confirmed",
          },
        }),
        (error: unknown) => error instanceof LedgerConflictError && error.code === "invalid_unit",
      );
      await assert.rejects(
        app.executeDomainCommand({
          type: "plan.revise",
          meta: {
            userId: "user-2",
            actor: { kind: "user", id: "user-2" },
            deviceId: "device-2",
            occurredAt: "2026-08-08T08:03:00.000+08:00",
            timezoneOffsetMinutes: 480,
            idempotencyKey: "cross-user-goal",
          },
          planId: "plan-user-2",
          expectedRevision: 0,
          revision: {
            id: "plan-revision-user-2",
            goalContractRef: { kind: "goal_contract", id: "goal-user-1", revision: 1 },
            effectiveFrom: "2026-08-08",
            knowledgePins,
            sessions: [],
          },
        }),
        (error: unknown) =>
          error instanceof LedgerConflictError && error.code === "cross_user_reference",
      );

      assert.deepEqual(await fixture.ledger.read(), before);
    } finally {
      fixture.dispose();
    }
  });

  test(`${name}: 未知 event schema 被拒绝且 diagnostics 不泄露 payload`, async () => {
    const fixture = createFixture();
    try {
      const app = new CoachApplication(fixture.ledger, runtime());
      await bootstrap(app);
      const before = await fixture.ledger.read();
      const source = before.domainEvents[0]!;
      const invalidEvent = {
        ...source,
        id: "invalid-schema-event",
        schemaVersion: 999,
        name: "user_profile.revised",
        aggregate: { ...source.aggregate, revision: 2 },
      } as unknown as DomainEvent;
      const commit: DomainAtomicCommit = {
        kind: "domain",
        userId: "user-1",
        actorId: "user-1",
        intent: "profile.revise",
        expectedRevisions: [{ kind: "user_profile", id: "profile-user-1", revision: 1 }],
        domainEvents: [invalidEvent],
        idempotencyKey: "invalid-schema",
        recordedAt: "2026-08-08T08:00:00.000+08:00",
      };
      await assert.rejects(
        fixture.ledger.commit(commit),
        (error: unknown) =>
          error instanceof LedgerConflictError && error.code === "invalid_domain_event",
      );
      assert.deepEqual(await fixture.ledger.read(), before);

      const diagnostics = await fixture.ledger.diagnose();
      assert.deepEqual(diagnostics.pendingMigrations, []);
      assert.equal(diagnostics.schemaVersion, SQLITE_COACH_LEDGER_SCHEMA_VERSION);
      assert.equal(diagnostics.outboxBacklog, 3);
      assert.equal(diagnostics.projectionLag, 0);
      assert.deepEqual(diagnostics.corruptEventIds, []);
      assert.equal(JSON.stringify(diagnostics).includes("trainingExperience"), false);
    } finally {
      fixture.dispose();
    }
  });

  if (name === "SQLiteCoachLedger") {
    test(`${name}: storage 中断回滚整个 domain commit`, async () => {
      const fixture = createFixture();
      try {
        const app = new CoachApplication(fixture.ledger, runtime());
        await bootstrap(app);
        const before = await fixture.ledger.read();
        fixture.interruptNextWrite?.();
        await assert.rejects(
          app.executeDomainCommand({
            type: "timeline.append",
            meta: {
              userId: "user-1",
              actor: { kind: "user", id: "user-1" },
              deviceId: "device-1",
              occurredAt: "2026-08-08T08:10:00.000+08:00",
              timezoneOffsetMinutes: 480,
              idempotencyKey: "interrupted-write",
            },
            timelineId: "timeline-user-1",
            expectedRevision: 0,
            fact: { kind: "rest", confidence: "confirmed" },
          }),
          /simulated_storage_interruption/,
        );
        assert.deepEqual(await fixture.ledger.read(), before);
      } finally {
        fixture.dispose();
      }
    });
  }
}

test("SQLiteCoachLedger: v1 JSON snapshot 有序迁移到当前 schema 且保留旧引用", async () => {
  const native = new DatabaseSync(":memory:");
  native.exec(`
    CREATE TABLE coach_ledger_snapshot (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      payload TEXT NOT NULL
    );
    PRAGMA user_version = 1;
  `);
  const legacy = {
    sessions: [
      {
        id: "legacy-session",
        userId: "user-1",
        status: "suspended",
        context: { kind: "today", ref: "2026-08-07" },
        createdAt: "2026-08-07T08:00:00.000Z",
        updatedAt: "2026-08-07T09:00:00.000Z",
      },
    ],
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
  native.prepare("INSERT INTO coach_ledger_snapshot (id, payload) VALUES (1, ?)").run(
    JSON.stringify(legacy),
  );
  const ledger = new SQLiteCoachLedger(new NodeSQLiteDatabase(native));

  const migrated = await ledger.read();
  assert.equal(migrated.sessions[0]?.id, "legacy-session");
  assert.equal(migrated.ledgerSchemaVersion, SQLITE_COACH_LEDGER_SCHEMA_VERSION);
  assert.deepEqual(migrated.domainEvents, []);
  assert.deepEqual(migrated.outbox, []);
  assert.equal(
    (native.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    SQLITE_COACH_LEDGER_SCHEMA_VERSION,
  );
  native.close();
});

test("CoachApplication: 权威聚合独立 revision，归档/恢复只追加补偿事件", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  await bootstrap(app);
  const meta = (key: string) => ({
    userId: "user-1",
    actor: { kind: "user" as const, id: "user-1" },
    deviceId: "device-1",
    occurredAt: "2026-08-08T08:00:00.000+08:00",
    timezoneOffsetMinutes: 480,
    idempotencyKey: key,
  });

  await app.executeDomainCommand({
    type: "goal_cycle.revise",
    meta: meta("goal-cycle-1"),
    goalCycleId: "cycle-1",
    expectedRevision: 0,
    goalCycle: {
      id: "cycle-1",
      goalContractRef: { kind: "goal_contract", id: "goal-user-1", revision: 1 },
      intent: "建立力量基础",
    },
  });
  await app.executeDomainCommand({
    type: "equipment_profile.revise",
    meta: meta("equipment-1"),
    equipmentProfileId: "equipment-1",
    expectedRevision: 0,
    equipmentProfile: { id: "equipment-1", name: "小区健身房", equipmentIds: ["barbell"] },
  });
  await app.executeDomainCommand({
    type: "equipment_profile.revise",
    meta: meta("equipment-2"),
    equipmentProfileId: "equipment-1",
    expectedRevision: 1,
    equipmentProfile: {
      id: "equipment-1",
      name: "小区健身房",
      equipmentIds: ["barbell", "cable"],
    },
  });
  await app.executeDomainCommand({
    type: "recovery_constraint.revise",
    meta: meta("recovery-1"),
    recoveryConstraintId: "recovery-1",
    expectedRevision: 0,
    recoveryConstraint: {
      id: "recovery-1",
      level: "slight_reduction",
      validUntil: "2026-08-09T08:00:00.000+08:00",
    },
  });
  await app.executeDomainCommand({
    type: "nutrition_strategy.revise",
    meta: meta("nutrition-1"),
    nutritionStrategyId: "nutrition-1",
    expectedRevision: 0,
    nutritionStrategy: {
      id: "nutrition-1",
      goalContractRef: { kind: "goal_contract", id: "goal-user-1", revision: 1 },
      calorieRange: {
        min: { value: 2200, unit: "kcal" },
        max: { value: 2400, unit: "kcal" },
      },
    },
  });
  await app.executeDomainCommand({
    type: "aggregate.archive",
    meta: meta("archive-equipment"),
    aggregateRef: { kind: "equipment_profile", id: "equipment-1", revision: 2 },
    reason: "不再使用该健身房",
  });
  const archived = await app.readDomainProjection({ userId: "user-1" });
  assert.deepEqual(archived.archivedAggregates, [
    { kind: "equipment_profile", id: "equipment-1", revision: 3 },
  ]);
  const lifecycle = await app.readDataLifecycleStatus("user-1", {
    kind: "equipment_profile",
    id: "equipment-1",
  });
  assert.equal(lifecycle.structuredData, "archived");
  assert.equal(lifecycle.replicaReferences.pending, 3);
  assert.equal(lifecycle.evidenceReferences.disposition, "not_present");
  await app.executeDomainCommand({
    type: "aggregate.restore",
    meta: meta("restore-equipment"),
    aggregateRef: { kind: "equipment_profile", id: "equipment-1", revision: 3 },
  });

  const projection = await app.readDomainProjection({ userId: "user-1" });
  assert.equal(projection.goalCycles[0]?.revision, 1);
  assert.equal(projection.equipmentProfiles[0]?.revision, 2);
  assert.equal(projection.recoveryConstraints[0]?.revision, 1);
  assert.equal(projection.nutritionStrategies[0]?.revision, 1);
  assert.deepEqual(projection.archivedAggregates, []);
});

test("CoachApplication: WorkoutSession 冻结启动时的训练安排，后续 PlanRevision 不回写", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  const knowledgePins = app.getInstalledKnowledgeVersionPins();
  await bootstrap(app);
  const meta = (key: string) => ({
    userId: "user-1",
    actor: { kind: "user" as const, id: "user-1" },
    deviceId: "device-1",
    occurredAt: "2026-08-08T08:00:00.000+08:00",
    timezoneOffsetMinutes: 480,
    idempotencyKey: key,
  });
  const session = (load: number) => ({
    id: "session-1",
    title: "力量训练",
    scheduledFor: "2026-08-08",
    knowledgePins,
    tasks: [
      {
        id: "task-1",
        exerciseVariantId: "bench_press",
        sets: [
          {
            id: "set-1",
            targetReps: { min: 5, max: 5 },
            targetLoad: { value: load, unit: "kg" as const },
          },
        ],
      },
    ],
  });
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: meta("plan-1"),
    planId: "plan-1",
    expectedRevision: 0,
    revision: {
      id: "plan-revision-1",
      goalContractRef: { kind: "goal_contract", id: "goal-user-1", revision: 1 },
      effectiveFrom: "2026-08-08",
      knowledgePins,
      sessions: [session(60)],
    },
  });
  await app.executeDomainCommand({
    type: "workout.start",
    meta: meta("workout-start"),
    workoutId: "workout-1",
    expectedRevision: 0,
    prescriptionRef: {
      planId: "plan-1",
      planRevision: 1,
      sessionPrescriptionId: "session-1",
    },
  });
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: meta("plan-2"),
    planId: "plan-1",
    expectedRevision: 1,
    revision: {
      id: "plan-revision-2",
      goalContractRef: { kind: "goal_contract", id: "goal-user-1", revision: 1 },
      effectiveFrom: "2026-08-08",
      knowledgePins,
      sessions: [session(62.5)],
    },
  });

  const projection = await app.readDomainProjection({ userId: "user-1" });
  assert.equal(projection.plan?.value.sessions[0]?.tasks[0]?.sets[0]?.targetLoad?.value, 62.5);
  assert.equal(
    projection.workouts[0]?.frozenPrescription.tasks[0]?.sets[0]?.targetLoad?.value,
    60,
  );
});
