import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { EMPTY_LEDGER_SNAPSHOT, InMemoryCoachLedger } from "../../src/coach/ledger";
import type {
  ActionTokenRecord,
  CoachRunRecord,
  PendingHumanAction,
  WorkingMemoryItem,
} from "../../src/coach/model";
import { planCoachStateSweep } from "../../src/coach/stateSweep";

const NOW = "2026-08-08T08:00:00.000Z";
const PAST = "2026-08-07T08:00:00.000Z";
const FUTURE = "2026-08-09T08:00:00.000Z";

function runRecord(id: string, status: CoachRunRecord["status"]): CoachRunRecord {
  return {
    id,
    sessionId: "session-1",
    userId: "user-1",
    status,
    factFrontier: [],
    contextManifestHash: "hash",
    startedAt: PAST,
    updatedAt: PAST,
  };
}

function pendingAction(id: string, status: PendingHumanAction["status"], expiresAt: string): PendingHumanAction {
  return {
    id,
    userId: "user-1",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-1",
    kind: "choose_option",
    prompt: "选择",
    options: [{ id: "a", label: "A" }],
    expectedPlanRevision: 1,
    expectedMandateRevision: 1,
    resumeToken: `resume-${id}`,
    status,
    createdAt: PAST,
    expiresAt,
  };
}

function actionToken(token: string, expiresAt: string, consumedAt?: string): ActionTokenRecord {
  return {
    token,
    userId: "user-1",
    sessionId: "session-1",
    runId: "run-1",
    toolCallId: "tool-1",
    artifactId: "artifact-1",
    artifactHash: "hash",
    action: "apply",
    expectedPlanRevision: 1,
    expectedMandateRevision: 1,
    expiresAt,
    nonce: "nonce",
    ...(consumedAt ? { consumedAt } : {}),
  };
}

function memoryItem(id: string, expiresAt?: string, deletedAt?: string): WorkingMemoryItem {
  return {
    id,
    userId: "user-1",
    kind: "strategy_note",
    content: "笔记",
    evidenceRefs: [],
    provenance: { actor: "agent" },
    authority: "non_authoritative",
    confidence: 0.5,
    version: 1,
    sensitivity: "normal",
    pinned: false,
    createdAt: PAST,
    updatedAt: PAST,
    ...(expiresAt ? { expiresAt } : {}),
    ...(deletedAt ? { deletedAt } : {}),
  };
}

test("planCoachStateSweep 把 streaming/resuming 的孤儿 run 终态化为 process_lost，suspended 与终态不动", () => {
  const snapshot = {
    ...emptySnapshot(),
    runs: [
      runRecord("run-streaming", "streaming"),
      runRecord("run-resuming", "resuming"),
      runRecord("run-suspended", "suspended"),
      runRecord("run-completed", "completed"),
    ],
  };
  const plan = planCoachStateSweep(snapshot, "user-1", NOW);
  const swept = plan.runs.map((run) => run.id).sort();
  assert.deepEqual(swept, ["run-resuming", "run-streaming"]);
  for (const run of plan.runs) {
    assert.equal(run.status, "terminated");
    assert.equal(run.terminalCode, "process_lost");
    assert.equal(run.updatedAt, NOW);
  }
});

test("planCoachStateSweep 过期 pending human action 标记 expired，未过期与已处理不动", () => {
  const snapshot = {
    ...emptySnapshot(),
    pendingHumanActions: [
      pendingAction("pa-expired", "pending", PAST),
      pendingAction("pa-open", "pending", FUTURE),
      pendingAction("pa-resolved", "resolved", PAST),
    ],
  };
  const plan = planCoachStateSweep(snapshot, "user-1", NOW);
  assert.deepEqual(plan.pendingHumanActions.map((a) => a.id), ["pa-expired"]);
  assert.equal(plan.pendingHumanActions[0].status, "expired");
  assert.deepEqual(plan.expectedPendingHumanActionStatuses, [{ id: "pa-expired", status: "pending" }]);
});

test("planCoachStateSweep 过期未消费 action token 标记 revokedAt，已消费与未过期不动", () => {
  const snapshot = {
    ...emptySnapshot(),
    actionTokens: [
      actionToken("tok-expired", PAST),
      actionToken("tok-consumed", PAST, PAST),
      actionToken("tok-open", FUTURE),
    ],
  };
  const plan = planCoachStateSweep(snapshot, "user-1", NOW);
  assert.deepEqual(plan.actionTokens.map((t) => t.token), ["tok-expired"]);
  assert.equal(plan.actionTokens[0].revokedAt, NOW);
  assert.equal(plan.actionTokens[0].consumedAt, undefined);
});

test("planCoachStateSweep 到期 working memory 走 forget（deletedAt + version+1），无 expiresAt 与已删除不动", () => {
  const snapshot = {
    ...emptySnapshot(),
    workingMemory: [
      memoryItem("mem-expired", PAST),
      memoryItem("mem-open", FUTURE),
      memoryItem("mem-immortal"),
      memoryItem("mem-deleted", PAST, PAST),
    ],
  };
  const plan = planCoachStateSweep(snapshot, "user-1", NOW);
  assert.deepEqual(plan.workingMemoryItems.map((i) => i.id), ["mem-expired"]);
  assert.equal(plan.workingMemoryItems[0].deletedAt, NOW);
  assert.equal(plan.workingMemoryItems[0].version, 2);
  assert.deepEqual(plan.expectedWorkingMemoryVersions, [{ id: "mem-expired", version: 1 }]);
});

test("planCoachStateSweep 为每个被清扫实体产出 rule_engine 审计事件", () => {
  const snapshot = {
    ...emptySnapshot(),
    runs: [runRecord("run-1", "streaming")],
    pendingHumanActions: [pendingAction("pa-1", "pending", PAST)],
    actionTokens: [actionToken("tok-1", PAST)],
    workingMemory: [memoryItem("mem-1", PAST)],
  };
  const plan = planCoachStateSweep(snapshot, "user-1", NOW);
  assert.equal(plan.actionEvents.length, 4);
  for (const event of plan.actionEvents) {
    assert.equal(event.actor, "rule_engine");
    assert.equal(event.action, "data.lifecycle.changed");
  }
});

test("facade 清扫过期状态并可幂等重复执行", async () => {
  const { app, ledger } = fixture();
  await seed(app, "user-1");
  await ledger.commit(domainCommit({
    sessions: [sessionRecord("session-1")],
    expectedSessionRevisions: [{ id: "session-1", revision: 0 }],
    runs: [runRecord("run-orphan", "streaming")],
    pendingHumanActions: [pendingAction("pa-1", "pending", PAST)],
    expectedPendingHumanActionStatuses: [{ id: "pa-1", status: "missing" }],
    issueTokens: [actionToken("tok-1", PAST)],
    workingMemoryItems: [memoryItem("mem-1", PAST)],
    expectedWorkingMemoryVersions: [{ id: "mem-1", version: 0 }],
  }));

  const first = await app.sweepExpiredCoachState("user-1");
  assert.equal(first.swept, 4);
  const snapshot = await ledger.read();
  assert.equal(snapshot.runs.find((r) => r.id === "run-orphan")?.status, "terminated");
  assert.equal(snapshot.runs.find((r) => r.id === "run-orphan")?.terminalCode, "process_lost");
  assert.equal(snapshot.pendingHumanActions.find((a) => a.id === "pa-1")?.status, "expired");
  assert.equal(snapshot.actionTokens.find((t) => t.token === "tok-1")?.revokedAt, NOW);
  assert.equal(snapshot.workingMemory.find((m) => m.id === "mem-1")?.deletedAt, NOW);

  const auditCount = (await ledger.read()).actionEvents.length;
  const second = await app.sweepExpiredCoachState("user-1");
  assert.equal(second.swept, 0);
  assert.equal((await ledger.read()).actionEvents.length, auditCount);
});

test("catchUpRecipes 触发过期状态清扫", async () => {
  const { app, ledger } = fixture();
  await seed(app, "user-1");
  await ledger.commit(domainCommit({
    sessions: [sessionRecord("session-1")],
    expectedSessionRevisions: [{ id: "session-1", revision: 0 }],
    runs: [runRecord("run-orphan", "streaming")],
  }));
  await app.catchUpRecipes("user-1");
  assert.equal(
    (await ledger.read()).runs.find((r) => r.id === "run-orphan")?.status,
    "terminated",
  );
});

// --- helpers ---

function emptySnapshot() {
  return EMPTY_LEDGER_SNAPSHOT;
}

function fixture() {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const dependencies = {
    ledger,
    runtime: {
      now: () => NOW,
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
  };
  return { ledger, app: new CoachApplication(dependencies) };
}

async function seed(app: CoachApplication, userId: string) {
  await app.seedUserState({
    userId,
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢推",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60, targetRir: 2 }],
    },
  });
}

function sessionRecord(id: string) {
  return {
    id,
    userId: "user-1",
    status: "active" as const,
    revision: 1,
    context: { kind: "today" as const, ref: "2026-08-08" },
    createdAt: PAST,
    updatedAt: PAST,
  };
}

function domainCommit(extra: Record<string, unknown>) {
  return {
    kind: "domain" as const,
    userId: "user-1",
    actorId: "user-1",
    intent: "test.seed",
    expectedRevisions: [],
    domainEvents: [],
    idempotencyKey: `seed-${Math.random()}`,
    recordedAt: PAST,
    ...extra,
  };
}
