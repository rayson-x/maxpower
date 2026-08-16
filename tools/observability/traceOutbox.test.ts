import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { PermissionStatus } from "../../src/coach/domain";
import { stableHash } from "../../src/coach/stable";
import {
  buildTraceEnvelope,
  traceUserPseudonym,
  type TraceEnvelope,
  type TraceEnvelopeInput,
} from "../../src/observability/model";
import {
  LedgerTraceOutboxSink,
  LedgerTraceUploadAuthorization,
  TraceOutboxDispatcher,
  TRACE_DISPATCH_MAX_ATTEMPTS,
} from "../../src/observability/TraceOutbox";
import type { TraceTransport, TraceTransportResult } from "../../src/observability/RemoteTraceSink";

const USER = "user-1";
const CONTEXT = { userId: USER };
const NOW = "2026-08-11T08:00:00.000+08:00";

function runtime() {
  let sequence = 0;
  return { now: () => NOW, nextId: (prefix: string) => `${prefix}-${++sequence}` };
}

function envelope(overrides: Partial<TraceEnvelopeInput> = {}): TraceEnvelope {
  return buildTraceEnvelope({
    traceId: "coach-run-1",
    sessionId: "coach-session-1",
    kind: "llm",
    name: "provider.request",
    occurredAt: "2026-08-11T08:00:00.000Z",
    actor: "agent_runtime",
    userPseudonym: traceUserPseudonym(USER, stableHash),
    deviceId: "phone-1",
    ...overrides,
  });
}

async function bootstrap(
  ledger: InMemoryCoachLedger,
  permissions?: { remoteLlm: PermissionStatus; observability?: PermissionStatus },
): Promise<void> {
  const app = new LocalProductKernel(ledger, runtime());
  const meta = {
    userId: USER,
    actor: { kind: "user" as const, id: USER },
    deviceId: "phone-1",
    occurredAt: NOW,
    timezoneOffsetMinutes: 480,
  };
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { ...meta, idempotencyKey: "bootstrap" },
    profile: { id: "profile-1", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
    },
    mandate: { id: "mandate-1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  if (!permissions) return;
  await app.executeDomainCommand({
    type: "permission_set.revise",
    meta: { ...meta, idempotencyKey: "permission" },
    permissionSetId: "permissions-1",
    expectedRevision: 0,
    permissionSet: {
      id: "permissions-1",
      camera: "not_configured",
      health: "not_configured",
      notifications: "not_configured",
      remoteLlm: permissions.remoteLlm,
      ...(permissions.observability ? { observability: permissions.observability } : {}),
    },
    authorization: { kind: "local_user_presence", verifiedAt: NOW, nonce: "settings" },
  });
}

function scriptedTransport(results: readonly TraceTransportResult[]): TraceTransport & {
  batches: TraceEnvelope[][];
} {
  const batches: TraceEnvelope[][] = [];
  let index = 0;
  return {
    kind: "generic_http",
    batches,
    async send(batch) {
      batches.push([...batch]);
      return results[Math.min(index++, results.length - 1)] ?? { status: "accepted" };
    },
  };
}

test("observability 授权默认关闭：远程事件根本不入 outbox", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  assert.equal(await sink.flush(), 0);
  assert.deepEqual((await ledger.read()).traceOutbox, []);
  assert.equal(sink.stats().unauthorized, 1);
});

test("remoteLlm 授权是前提：只开 observability 也不上报", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "denied", observability: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  await sink.flush();
  assert.deepEqual((await ledger.read()).traceOutbox, []);
});

test("两项都授权后事件进 outbox，同一 eventId 重复入队不产生第二条", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted", observability: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  await sink.write(envelope({ name: "provider.response" }), CONTEXT);
  assert.equal(await sink.flush(), 2);

  await sink.write(envelope(), CONTEXT);
  await sink.flush();
  const entries = (await ledger.read()).traceOutbox;
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.envelope.name).sort(),
    ["provider.request", "provider.response"],
  );
  assert.ok(entries.every((entry) => entry.id === entry.eventId && entry.status === "pending"));
});

test("断网时条目留在 outbox，恢复后原样补发（at-least-once，服务端按 eventId 去重）", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted", observability: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  await sink.write(envelope({ name: "provider.response" }), CONTEXT);
  await sink.flush();

  const transport = scriptedTransport([
    { status: "unavailable", code: "transport_unreachable" },
    { status: "accepted" },
  ]);
  const dispatcher = new TraceOutboxDispatcher(ledger, transport, runtime());

  const offline = await dispatcher.dispatch(USER);
  assert.equal(offline.status, "deferred");
  assert.equal(offline.remaining, 2);
  assert.ok((await ledger.read()).traceOutbox.every((entry) => entry.status === "pending"));

  const online = await dispatcher.dispatch(USER);
  assert.equal(online.status, "sent");
  assert.equal(online.sent, 2);
  assert.ok((await ledger.read()).traceOutbox.every((entry) => entry.status === "sent"));

  // 补发过的条目不会被再发一次，但 eventId 仍留作去重索引。
  assert.deepEqual(await dispatcher.dispatch(USER), { status: "empty", sent: 0, remaining: 0 });
  assert.deepEqual(
    transport.batches.map((batch) => batch.map((item) => item.eventId)),
    [
      transport.batches[0]!.map((item) => item.eventId),
      transport.batches[0]!.map((item) => item.eventId),
    ],
  );
});

test("outbox 在重启后仍在：新调度器从账本读到未发送的条目", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted", observability: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  await sink.flush();

  const restarted = new InMemoryCoachLedger(await ledger.read());
  const transport = scriptedTransport([{ status: "accepted" }]);
  const result = await new TraceOutboxDispatcher(restarted, transport, runtime()).dispatch(USER);
  assert.equal(result.status, "sent");
  assert.equal(transport.batches[0]?.[0]?.name, "provider.request");
});

test("服务端明确拒收的条目被放弃，不会永久堵塞队列", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted", observability: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  await sink.flush();

  const dispatcher = new TraceOutboxDispatcher(
    ledger,
    scriptedTransport([{ status: "rejected", code: "http_400" }]),
    runtime(),
  );
  const result = await dispatcher.dispatch(USER);
  assert.equal(result.status, "rejected");
  assert.equal((await ledger.read()).traceOutbox[0]?.status, "abandoned");
  assert.deepEqual(await dispatcher.dispatch(USER), { status: "empty", sent: 0, remaining: 0 });
});

test("反复不可达的条目在上限次数后被放弃", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted", observability: "granted" });
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), new LedgerTraceUploadAuthorization(ledger));
  await sink.write(envelope(), CONTEXT);
  await sink.flush();

  const dispatcher = new TraceOutboxDispatcher(
    ledger,
    scriptedTransport([{ status: "unavailable", code: "transport_unreachable" }]),
    runtime(),
  );
  for (let attempt = 0; attempt < TRACE_DISPATCH_MAX_ATTEMPTS; attempt += 1) {
    await dispatcher.dispatch(USER);
  }
  assert.equal((await ledger.read()).traceOutbox[0]?.status, "abandoned");
});

test("授权撤销后新事件不再入队", async () => {
  const ledger = new InMemoryCoachLedger();
  await bootstrap(ledger, { remoteLlm: "granted", observability: "granted" });
  const authorization = new LedgerTraceUploadAuthorization(ledger);
  const sink = new LedgerTraceOutboxSink(ledger, runtime(), authorization);
  await sink.write(envelope(), CONTEXT);
  await sink.flush();

  const app = new LocalProductKernel(ledger, runtime());
  await app.executeDomainCommand({
    type: "permission_set.revise",
    meta: {
      userId: USER,
      actor: { kind: "user", id: USER },
      deviceId: "phone-1",
      occurredAt: NOW,
      timezoneOffsetMinutes: 480,
      idempotencyKey: "permission-revoke",
    },
    permissionSetId: "permissions-1",
    expectedRevision: 1,
    permissionSet: {
      id: "permissions-1",
      camera: "not_configured",
      health: "not_configured",
      notifications: "not_configured",
      remoteLlm: "granted",
      observability: "denied",
    },
    authorization: { kind: "local_user_presence", verifiedAt: NOW, nonce: "settings" },
  });
  authorization.invalidate(USER);

  await sink.write(envelope({ name: "provider.response" }), CONTEXT);
  await sink.flush();
  assert.deepEqual(
    (await ledger.read()).traceOutbox.map((entry) => entry.envelope.name),
    ["provider.request"],
  );
});
