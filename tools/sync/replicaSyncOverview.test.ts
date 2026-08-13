import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { InMemoryReplicaTransport, type ReplicaTransportPort } from "../../src/sync";

function createApp(ledger: InMemoryCoachLedger, transport: ReplicaTransportPort, deviceId: string) {
  let sequence = 0;
  return new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-09T12:00:00.000+08:00",
      nextId: (prefix) => `${deviceId}-${prefix}-${++sequence}`,
    },
    replicaTransport: transport,
  });
}

async function bootstrap(app: CoachApplication, deviceId: string) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId,
      occurredAt: "2026-08-09T12:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-09", endDate: "2026-12-09" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
}

test("同步冲突概览只暴露可审阅的版本分支，要求人工创建下一版本而不泄露远端 payload", async () => {
  const transport = new InMemoryReplicaTransport("test-service", "service-device");
  const ledgerA = new InMemoryCoachLedger();
  const ledgerB = new InMemoryCoachLedger();
  const appA = createApp(ledgerA, transport, "phone-a");
  const appB = createApp(ledgerB, transport, "phone-b");
  await bootstrap(appA, "phone-a");
  await appA.synchronizeReplica("u1");
  await appB.synchronizeReplica("u1");

  await appA.executeDomainCommand({
    type: "goal_contract.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-a",
      occurredAt: "2026-08-10T12:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "goal-a",
    },
    goalContractId: "goal-1", expectedRevision: 1,
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-09", endDate: "2027-01-09" } },
  });
  await appB.executeDomainCommand({
    type: "goal_contract.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-b",
      occurredAt: "2026-08-10T13:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "goal-b",
    },
    goalContractId: "goal-1", expectedRevision: 1,
    goalContract: { id: "goal-1", primaryGoal: "strength", horizon: { startDate: "2026-08-09", endDate: "2026-12-09" } },
  });
  await appA.synchronizeReplica("u1");
  assert.equal((await appB.synchronizeReplica("u1")).status, "conflict");

  const overview = await appB.readReplicaSyncOverview("u1");
  assert.equal(overview.status, "conflict");
  assert.equal(overview.outbox.pending, 0);
  assert.equal(overview.conflicts.length, 1);
  assert.deepEqual(overview.conflicts[0], {
    id: overview.conflicts[0]?.id,
    aggregate: { kind: "goal_contract", id: "goal-1", localRevision: 2, incomingRevision: 2 },
    receivedAt: "2026-08-09T12:00:00.000+08:00",
    source: { device: "another_device", actor: "user" },
    change: "goal_contract_revised",
    resolution: "manual_new_revision_required",
  });
  assert.equal("payload" in overview.conflicts[0]!, false);
  assert.equal("event" in overview.conflicts[0]!, false);
  assert.equal(overview.retryAvailable, false);
});

test("未启用同步时，同步概览保持本地模式且不产生网络请求", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-09T12:00:00.000+08:00",
    nextId: (prefix) => prefix,
  });

  const overview = await app.readReplicaSyncOverview("u1");
  assert.deepEqual(overview, {
    status: "disabled",
    lastSucceededAt: undefined,
    lastAttemptAt: undefined,
    retryAvailable: false,
    outbox: { pending: 0, acknowledged: 0, conflicts: 0 },
    pendingDependencies: 0,
    rejected: 0,
    conflicts: [],
  });
});

test("一次同步失败不会抹去可见的最后成功时间，且只提供受控重试而不泄露底层错误", async () => {
  const peer = new InMemoryReplicaTransport("test-service", "service-device");
  let unavailable = false;
  const transport: ReplicaTransportPort = {
    mode: "enabled",
    replicaId: peer.replicaId,
    deviceId: peer.deviceId,
    async push(input) {
      if (unavailable) throw new Error("socket reset with user secret");
      return peer.push(input);
    },
    async pull(input) {
      if (unavailable) throw new Error("socket reset with user secret");
      return peer.pull(input);
    },
  };
  const ledger = new InMemoryCoachLedger();
  const app = createApp(ledger, transport, "phone-a");
  await bootstrap(app, "phone-a");
  assert.equal((await app.synchronizeReplica("u1")).status, "synchronized");

  unavailable = true;
  assert.equal((await app.synchronizeReplica("u1")).status, "partial");
  const overview = await app.readReplicaSyncOverview("u1");
  assert.equal(overview.status, "retry_needed");
  assert.equal(overview.lastSucceededAt, "2026-08-09T12:00:00.000+08:00");
  assert.equal(overview.retryAvailable, true);
  assert.equal("lastError" in overview, false);
  const stored = await ledger.read();
  const state = stored.replicaSyncStates.find((candidate) => candidate.userId === "u1");
  assert.equal(state?.lastError, "transport_error");
  assert.doesNotMatch(JSON.stringify(stored), /user secret/);
});
