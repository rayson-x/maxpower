import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { InMemoryReplicaTransport } from "../../src/sync";
import { stableHash } from "../../src/coach/stable";
import type { ReplicaTransportPort, ReplicaWireEnvelope } from "../../src/sync";

function createApp(ledger: InMemoryCoachLedger, transport: InMemoryReplicaTransport, deviceId: string) {
  let sequence = 0;
  return new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-08T12:00:00.000+08:00",
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
      occurredAt: "2026-08-08T12:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08", endDate: "2026-12-08" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
}

test("ReplicaSynchronizer 先确认本地事实，再通过 outbox 同步到第二设备并可幂等重放", async () => {
  const transport = new InMemoryReplicaTransport("test-service", "service-device");
  const sourceLedger = new InMemoryCoachLedger();
  const targetLedger = new InMemoryCoachLedger();
  const source = createApp(sourceLedger, transport, "phone-a");
  const target = createApp(targetLedger, transport, "phone-b");

  await bootstrap(source, "phone-a");
  assert.equal((await source.readDomainProjection({ userId: "u1" })).profile?.value.id, "profile-1");
  assert.equal((await target.readDomainProjection({ userId: "u1" })).profile, undefined);

  const pushed = await source.synchronizeReplica("u1");
  assert.equal(pushed.status, "synchronized");
  assert.equal(pushed.pushed.length, 3);
  assert.ok((await sourceLedger.read()).outbox.every((entry) => entry.status === "acknowledged"));

  const pulled = await target.synchronizeReplica("u1");
  assert.equal(pulled.status, "synchronized");
  assert.equal(pulled.applied.length, 3);
  const projection = await target.readDomainProjection({ userId: "u1" });
  assert.equal(projection.profile?.value.id, "profile-1");
  assert.equal(projection.goalContract?.value.id, "goal-1");
  assert.equal(projection.mandate?.value.mode, "collaborative");

  const replay = await target.synchronizeReplica("u1");
  assert.deepEqual(replay.applied, []);
  assert.equal((await targetLedger.read()).domainEvents.length, 3);
});

test("未配置账号 transport 时，Facade 不产生任何隐式网络同步", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T12:00:00.000+08:00",
    nextId: (prefix) => prefix,
  });
  const result = await app.synchronizeReplica("u1");
  assert.equal(result.status, "disabled");
  assert.equal(result.retryable, false);
});

test("并发聚合 revision 不会静默覆盖：保留本地事实并持久化显式 conflict", async () => {
  const transport = new InMemoryReplicaTransport("test-service", "service-device");
  const ledgerA = new InMemoryCoachLedger();
  const ledgerB = new InMemoryCoachLedger();
  const appA = createApp(ledgerA, transport, "phone-a");
  const appB = createApp(ledgerB, transport, "phone-b");
  await bootstrap(appA, "phone-a");
  await bootstrap(appB, "phone-b");

  await appB.synchronizeReplica("u1");
  const outcome = await appA.synchronizeReplica("u1");
  assert.equal(outcome.status, "conflict");
  assert.equal((await appA.readDomainProjection({ userId: "u1" })).profile?.value.id, "profile-1");
  const buffered = (await ledgerA.read()).pendingReplicaEnvelopes;
  assert.ok(buffered.some((entry) => entry.status === "conflict" && entry.reason === "concurrent_revision"));
});

test("乱序远端事件先持久化为 pending，依赖到达后才重放并标为 resolved", async () => {
  const sourceLedger = new InMemoryCoachLedger();
  let sourceSequence = 0;
  const source = new CoachApplication(sourceLedger, {
    now: () => "2026-08-08T12:00:00.000+08:00", nextId: (prefix) => `source-${prefix}-${++sourceSequence}`,
  });
  await bootstrap(source, "phone-a");
  await source.executeDomainCommand({
    type: "permission_set.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-a", occurredAt: "2026-08-08T12:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "permission" },
    permissionSetId: "permissions-1", expectedRevision: 0,
    permissionSet: { id: "permissions-1", camera: "not_configured", health: "not_configured", notifications: "not_configured", remoteLlm: "denied", cloudSync: "not_configured", mediaUpload: "not_configured" },
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-08T12:00:00.000+08:00", nonce: "settings" },
  });
  const sourceEvents = (await sourceLedger.read()).domainEvents;
  const asEnvelope = (event: (typeof sourceEvents)[number]): ReplicaWireEnvelope => ({
    schemaVersion: 1, userId: "u1", replicaId: "remote", deviceId: "phone-a", event,
    payloadHash: stableHash(event), hlc: `h:${event.id}`, causalParents: [event.causationId], scope: "domain",
  });
  const permission = sourceEvents.find((event) => event.name === "permission_set.created")!;
  const bootstrapEvents = sourceEvents.filter((event) => event.name !== "permission_set.created");
  let pullCount = 0;
  const transport: ReplicaTransportPort = {
    mode: "enabled", replicaId: "fixture", deviceId: "fixture",
    async push() { return { acknowledgedEventIds: [], rejected: [] }; },
    async pull() {
      pullCount += 1;
      if (pullCount === 1) return { envelopes: [asEnvelope(permission)], cursor: "1", hasMore: true };
      if (pullCount === 2) return { envelopes: bootstrapEvents.map(asEnvelope), cursor: "2", hasMore: false };
      return { envelopes: [], cursor: "2", hasMore: false };
    },
  };
  const targetLedger = new InMemoryCoachLedger();
  const target = new CoachApplication({
    ledger: targetLedger,
    runtime: { now: () => "2026-08-08T12:00:00.000+08:00", nextId: (prefix) => `target-${prefix}` },
    replicaTransport: transport,
  });
  assert.equal((await target.synchronizeReplica("u1")).pending.length, 1);
  // The first call now drains the second cursor page immediately. The pending
  // child is retried against the persisted parent on the next sync.
  const resolved = await target.synchronizeReplica("u1");
  assert.deepEqual(resolved.applied, [permission.id]);
  assert.equal((await target.readDomainProjection({ userId: "u1" })).permissions?.value.remoteLlm, "denied");
  assert.equal((await targetLedger.read()).pendingReplicaEnvelopes[0]?.status, "resolved");
});

test("单次同步会在有界范围内继续拉取所有 cursor 页面，而不是遗漏后一页事实", async () => {
  const sourceLedger = new InMemoryCoachLedger();
  let sourceSequence = 0;
  const source = new CoachApplication(sourceLedger, {
    now: () => "2026-08-08T12:00:00.000+08:00", nextId: (prefix) => `source-${prefix}-${++sourceSequence}`,
  });
  await bootstrap(source, "phone-a");
  const events = (await sourceLedger.read()).domainEvents;
  const asEnvelope = (event: (typeof events)[number]): ReplicaWireEnvelope => ({
    schemaVersion: 1, userId: "u1", replicaId: "remote", deviceId: "phone-a", event,
    payloadHash: stableHash(event), hlc: `h:${event.id}`, causalParents: [event.causationId], scope: "domain",
  });
  let pulls = 0;
  const transport: ReplicaTransportPort = {
    mode: "enabled", replicaId: "fixture", deviceId: "fixture",
    async push() { return { acknowledgedEventIds: [], rejected: [] }; },
    async pull() {
      pulls += 1;
      if (pulls === 1) return { envelopes: events.slice(0, 2).map(asEnvelope), cursor: "page-1", hasMore: true };
      return { envelopes: events.slice(2).map(asEnvelope), cursor: "page-2", hasMore: false };
    },
  };
  const target = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-08T12:00:00.000+08:00", nextId: (prefix) => `target-${prefix}` },
    replicaTransport: transport,
  });
  const result = await target.synchronizeReplica("u1");
  assert.equal(pulls, 2);
  assert.equal(result.status, "synchronized");
  assert.equal(result.applied.length, 3);
  assert.equal((await target.readDomainProjection({ userId: "u1" })).mandate?.value.mode, "collaborative");
});
