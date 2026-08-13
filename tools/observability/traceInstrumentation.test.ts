import assert from "node:assert/strict";
import test from "node:test";

import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger, type CoachLedger } from "../../src/coach/ledger";
import {
  createTraceWriter,
  InMemoryTraceFileSystem,
  TraceRecorder,
  traceShortCode,
  TracingCoachLedger,
  type TraceEnvelope,
  type TraceFetch,
} from "../../src/observability";

const USER = "user-1";
const NOW = "2026-08-11T08:00:00.000+08:00";
const SECRET = "我上周肩膀拉伤了，别让我做卧推";

function runtime() {
  let sequence = 0;
  return { now: () => NOW, nextId: (prefix: string) => `${prefix}-${++sequence}` };
}

interface Fixture {
  app: CoachApplication;
  ledger: InMemoryCoachLedger;
  files: InMemoryTraceFileSystem;
  writer: ReturnType<typeof createTraceWriter>;
  uploads: TraceEnvelope[];
  written(): Promise<readonly TraceEnvelope[]>;
}

function fixture(options: { provider?: ScriptedLLMProvider; offline?: boolean } = {}): Fixture {
  const ledger = new InMemoryCoachLedger();
  const files = new InMemoryTraceFileSystem();
  const uploads: TraceEnvelope[] = [];
  const fetchLike: TraceFetch = async (_url, init) => {
    if (options.offline) throw new Error("network down");
    uploads.push(...(JSON.parse(init.body) as { events: TraceEnvelope[] }).events);
    return { ok: true, status: 200 };
  };
  const writer = createTraceWriter({
    ledger,
    runtime: runtime(),
    files,
    fetch: fetchLike,
    config: {
      deviceId: "phone-1",
      localFile: { directory: "/trace" },
      remote: { kind: "generic_http", endpoint: "https://logs.example/ingest" },
    },
  });
  const app = new CoachApplication({
    ledger: writer.ledger,
    runtime: runtime(),
    ...(options.provider ? { llmProvider: options.provider } : {}),
  });
  return {
    app,
    ledger,
    files,
    writer,
    uploads,
    async written() {
      const content = await files.read("/trace/trace.jsonl");
      return content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as TraceEnvelope);
    },
  };
}

async function bootstrap(app: CoachApplication, observability: "granted" | "denied"): Promise<void> {
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
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
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
      cloudSync: "not_configured",
      mediaUpload: "not_configured",
      remoteLlm: "granted",
      observability,
    },
    authorization: { kind: "local_user_presence", verifiedAt: NOW, nonce: "settings" },
  });
}

function weeklyReportProvider(): ScriptedLLMProvider {
  return new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "weekly-report-tool-1",
      toolName: "coach.show_weekly_report",
      input: { weekStart: "2026-08-03", weekEnd: "2026-08-09" },
    },
    { type: "text-delta", delta: "这是本周安排。" },
    { type: "completed" },
  ]);
}

test("一轮对话产出 provider 请求/响应、工具调用与 turn 事件，全部挂在同一 traceId 下", async () => {
  const state = fixture({ provider: weeklyReportProvider() });
  await bootstrap(state.app, "granted");
  const session = await state.app.startSession({ userId: USER, context: { kind: "today", ref: "2026-08-11" } });
  await state.app.sendCoachTurn({ sessionId: session.id, text: SECRET });

  const events = await state.written();
  const names = new Set(events.map((event) => event.name));
  for (const expected of ["provider.request", "provider.response", "tool.execution", "run.completed"]) {
    assert.ok(names.has(expected), `缺少埋点：${expected}`);
  }
  const kinds = new Set<string>(
    events.filter((event) => event.traceId.startsWith("coach-run")).map((event) => event.kind),
  );
  for (const expected of ["llm", "tool", "turn"]) assert.ok(kinds.has(expected), `缺少 kind：${expected}`);

  const runIds = new Set(
    events.filter((event) => event.name === "provider.request").map((event) => event.traceId),
  );
  assert.equal(runIds.size, 1);
  const runId = [...runIds][0]!;
  assert.ok(
    events
      .filter((event) => event.traceId === runId)
      .every((event) => event.orderKey.startsWith(`${runId.replace(/[^a-zA-Z0-9]/g, "")}#0.`)),
  );
});

test("policy 决策、proposal/HITL 与领域计划变更都进同一条 trace 流", async () => {
  const state = fixture();
  await bootstrap(state.app, "granted");
  const events = await state.written();
  const byKind = new Map<string, number>();
  for (const event of events) byKind.set(event.kind, (byKind.get(event.kind) ?? 0) + 1);
  assert.ok((byKind.get("agent") ?? 0) > 0, "缺少 action/proposal 埋点");
  assert.ok(
    events.some((event) => event.name.startsWith("action.")),
    "缺少 typed action 埋点",
  );
  assert.ok(
    events.some((event) => event.decisionCodes?.some((code) => code.startsWith("policy:"))),
    "缺少 policy 决策码",
  );
});

test("trace 事件只带元数据与引用：用户原话与 userId 都不在事件里", async () => {
  const state = fixture({ provider: weeklyReportProvider() });
  await bootstrap(state.app, "granted");
  const session = await state.app.startSession({ userId: USER, context: { kind: "today", ref: "2026-08-11" } });
  await state.app.sendCoachTurn({ sessionId: session.id, text: SECRET });

  const serialized = JSON.stringify(await state.written());
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes("肩膀"), false);
  assert.equal(serialized.includes(`"${USER}"`), false);
  assert.ok(serialized.includes("local-"));
});

test("授权关闭时本地 JSONL 照写，远程 outbox 一条不进", async () => {
  const state = fixture({ provider: weeklyReportProvider() });
  await bootstrap(state.app, "denied");
  const session = await state.app.startSession({ userId: USER, context: { kind: "today", ref: "2026-08-11" } });
  await state.app.sendCoachTurn({ sessionId: session.id, text: "今天该怎么练？" });

  assert.ok((await state.written()).length > 0);
  assert.deepEqual((await state.ledger.read()).traceOutbox, []);
  assert.deepEqual(await state.writer.dispatch(USER), { status: "empty", sent: 0, remaining: 0 });
});

test("授权打开后事件排队并在补发时上传；断网只是推迟不丢", async () => {
  const offline = fixture({ provider: weeklyReportProvider(), offline: true });
  await bootstrap(offline.app, "granted");
  const session = await offline.app.startSession({ userId: USER, context: { kind: "today", ref: "2026-08-11" } });
  await offline.app.sendCoachTurn({ sessionId: session.id, text: "今天该怎么练？" });
  const deferred = await offline.writer.dispatch(USER);
  assert.equal(deferred.status, "deferred");
  assert.ok(deferred.remaining > 0);

  const online = fixture({ provider: weeklyReportProvider() });
  await bootstrap(online.app, "granted");
  const onlineSession = await online.app.startSession({
    userId: USER,
    context: { kind: "today", ref: "2026-08-11" },
  });
  await online.app.sendCoachTurn({ sessionId: onlineSession.id, text: "今天该怎么练？" });
  const sent = await online.writer.dispatch(USER);
  assert.equal(sent.status, "sent");
  assert.ok(online.uploads.length > 0);
  assert.equal(new Set(online.uploads.map((item) => item.eventId)).size, online.uploads.length);
});

test("崩溃丢掉的 trace 在启动时从账本投影回填，重放不产生重复事件", async () => {
  // 不装配任何 sink：模拟「事实已落账、trace 还没来得及写」的崩溃窗口。
  const ledger = new InMemoryCoachLedger();
  const silent = new CoachApplication({
    ledger,
    runtime: runtime(),
    llmProvider: weeklyReportProvider(),
  });
  await bootstrap(silent, "granted");
  const session = await silent.startSession({ userId: USER, context: { kind: "today", ref: "2026-08-11" } });
  await silent.sendCoachTurn({ sessionId: session.id, text: SECRET });

  const files = new InMemoryTraceFileSystem();
  const writer = createTraceWriter({
    ledger,
    runtime: runtime(),
    files,
    fetch: async () => ({ ok: true, status: 200 }),
    config: {
      deviceId: "phone-1",
      localFile: { directory: "/trace" },
      remote: { kind: "generic_http", endpoint: "https://logs.example/ingest" },
    },
  });

  const first = await writer.reconcile();
  assert.ok(first.backfilled > 0);
  assert.equal(first.skipped, 0);
  const afterFirst = (await files.read("/trace/trace.jsonl")).trim().split("\n");
  assert.ok(afterFirst.some((line) => line.includes("provider.request")));

  const second = await writer.reconcile();
  assert.equal(second.backfilled, 0);
  assert.equal(second.skipped, first.backfilled);
  const afterSecond = (await files.read("/trace/trace.jsonl")).trim().split("\n");
  assert.deepEqual(afterSecond, afterFirst);
  assert.equal(
    new Set((await ledger.read()).traceOutbox.map((entry) => entry.eventId)).size,
    (await ledger.read()).traceOutbox.length,
  );
});

test("走旧 AtomicCommit 通道的 proposal 决策同样进 trace 流", async () => {
  const written: TraceEnvelope[] = [];
  const recorder = new TraceRecorder([{ name: "memory", async write(item) { written.push(item); } }]);
  const inner = {
    async commit() {
      return { status: "committed" as const, resultArtifactId: "artifact-1" };
    },
  } as unknown as CoachLedger;
  const ledger = new TracingCoachLedger(inner, { recorder, context: { deviceId: "phone-1" } });

  await ledger.commit({
    userId: USER,
    expectedPlanRevision: 1,
    expectedMandateRevision: 1,
    plan: { revision: 2, effectiveDate: "2026-08-11", title: "上肢推", tasks: [] },
    artifacts: [],
    presentations: [],
    runEvents: [],
    actionEvent: {
      id: "action-1",
      userId: USER,
      occurredAt: NOW,
      actor: "user",
      action: "plan.change.applied",
      targetType: "plan",
      targetId: "plan-1",
      scope: "plan",
      intent: "apply_proposal",
      before: { secret: SECRET },
      after: { secret: SECRET },
      evidenceRefs: [],
      beforeRefs: [],
      afterRefs: [],
      ruleVersions: {},
      mandateRevision: 1,
      result: "applied",
      undoBoundary: "compensating_revision",
      sessionId: "coach-session-1",
      runId: "coach-run-1",
      policyDecision: "require_confirmation",
      humanDecision: "confirmed",
      causationId: "cause-1",
      correlationId: "correlation-1",
      reversible: true,
    },
    consumeToken: "token-1",
    idempotencyKey: "apply-1",
    occurredAt: NOW,
  });

  const applied = written.find((event) => event.name === "action.plan.change.applied");
  assert.ok(applied, "proposal 应用未产生 trace 事件");
  assert.equal(applied.kind, "guardrail");
  assert.equal(applied.traceId, "coach-run-1");
  assert.ok(applied.decisionCodes?.includes("policy:require_confirmation"));
  assert.ok(applied.decisionCodes?.includes("human:confirmed"));
  // before/after 是任意内容，永远不进 envelope。
  assert.equal(JSON.stringify(applied).includes(SECRET), false);
});

test("一个 sink 都没配时账本不被包装，业务路径零额外成本", async () => {
  const ledger = new InMemoryCoachLedger();
  const writer = createTraceWriter({ ledger, runtime: runtime(), config: { deviceId: "phone-1" } });
  assert.equal(writer.ledger, ledger);
  assert.equal(writer.recorder.enabled, false);
  assert.deepEqual(await writer.reconcile(), { backfilled: 0, skipped: 0 });
});

test("报错时用户拿到的短码能在 trace 里定位到那次行动", async () => {
  const state = fixture({
    provider: new ScriptedLLMProvider([{ type: "cancelled", reason: "transport" }]),
  });
  await bootstrap(state.app, "granted");
  const session = await state.app.startSession({ userId: USER, context: { kind: "today", ref: "2026-08-11" } });
  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "今天该怎么练？" });
  const failure = events.find((event) => event.type === "run-error");
  assert.ok(failure);

  const shortCode = traceShortCode({ traceId: failure.runId, sessionId: failure.sessionId });
  assert.equal(failure.shortCode, shortCode);
  const traced = (await state.written()).filter(
    (event) => traceShortCode({ traceId: event.traceId, sessionId: event.sessionId }) === shortCode,
  );
  assert.ok(traced.length > 0);
  assert.ok(traced.some((event) => event.kind === "error" || event.outcome === "failed"));
});
