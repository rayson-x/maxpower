import assert from "node:assert/strict";
import test from "node:test";

import { stableHash } from "../../src/coach/stable";
import {
  InMemoryTraceFileSystem,
  LocalFileTraceSink,
} from "../../src/observability/LocalFileTraceSink";
import {
  buildTraceEnvelope,
  traceUserPseudonym,
  type TraceEnvelope,
  type TraceEnvelopeInput,
} from "../../src/observability/model";
import {
  createTraceTransport,
  traceTransportRequest,
  type TraceFetch,
  type TraceTransportConfig,
} from "../../src/observability/RemoteTraceSink";
import { TraceRecorder, type TraceSink } from "../../src/observability/TraceRecorder";

const CONTEXT = { userId: "user-1" };

function envelope(overrides: Partial<TraceEnvelopeInput> = {}): TraceEnvelope {
  return buildTraceEnvelope({
    traceId: "coach-run-1",
    sessionId: "coach-session-1",
    kind: "tool",
    name: "tool.execution",
    occurredAt: "2026-08-11T08:00:00.000Z",
    actor: "agent_runtime",
    userPseudonym: traceUserPseudonym("user-1", stableHash),
    deviceId: "phone-1",
    outcome: "ok",
    ...overrides,
  });
}

test("没有配置 sink 时 record 是零成本 no-op", async () => {
  const recorder = new TraceRecorder();
  assert.equal(recorder.enabled, false);
  assert.equal(
    await recorder.record(
      {
        traceId: "coach-run-1",
        sessionId: "coach-session-1",
        kind: "llm",
        name: "provider.request",
        occurredAt: "2026-08-11T08:00:00.000Z",
        actor: "agent_runtime",
        userPseudonym: traceUserPseudonym("user-1", stableHash),
        deviceId: "phone-1",
      },
      CONTEXT,
    ),
    undefined,
  );
  assert.deepEqual(recorder.stats(), { recorded: 0, rejected: 0, duplicates: 0, failures: {} });
});

test("同一事实被重复投影时只写一次（eventId 是内容哈希）", async () => {
  const written: TraceEnvelope[] = [];
  const recorder = new TraceRecorder([
    { name: "memory", async write(item) { written.push(item); } },
  ]);
  await recorder.writeEnvelope(envelope(), CONTEXT);
  await recorder.writeEnvelope(envelope(), CONTEXT);
  await recorder.writeEnvelope(envelope({ name: "tool.schema_validation" }), CONTEXT);
  assert.deepEqual(written.map((item) => item.name), ["tool.execution", "tool.schema_validation"]);
  assert.equal(recorder.stats().duplicates, 1);
});

test("校验不通过的事件被丢弃并计数，不抛进业务路径", async () => {
  const written: TraceEnvelope[] = [];
  const sink: TraceSink = { name: "memory", async write(item) { written.push(item); } };
  const recorder = new TraceRecorder([sink]);
  await recorder.record(
    {
      traceId: "",
      sessionId: "coach-session-1",
      kind: "llm",
      name: "provider.request",
      occurredAt: "2026-08-11T08:00:00.000Z",
      actor: "agent_runtime",
      userPseudonym: traceUserPseudonym("user-1", stableHash),
      deviceId: "phone-1",
    },
    CONTEXT,
  );
  assert.deepEqual(written, []);
  assert.equal(recorder.stats().rejected, 1);
});

test("sink 写入失败只计数不阻断业务：另一个 sink 照常写完", async () => {
  const written: TraceEnvelope[] = [];
  const failing: TraceSink = {
    name: "broken",
    async write() {
      throw new Error("disk_full");
    },
  };
  const healthy: TraceSink = { name: "memory", async write(item) { written.push(item); } };
  const recorder = new TraceRecorder([failing, healthy]);
  await recorder.writeEnvelope(envelope(), CONTEXT);
  assert.equal(written.length, 1);
  assert.deepEqual(recorder.stats(), {
    recorded: 1,
    rejected: 0,
    duplicates: 0,
    failures: { broken: 1 },
  });
});

test("本地 sink 建目录、按行写 JSONL", async () => {
  const files = new InMemoryTraceFileSystem();
  const sink = new LocalFileTraceSink(files, { directory: "/trace" });
  await sink.write(envelope());
  await sink.write(envelope({ name: "tool.schema_validation" }));
  const lines = (await files.read("/trace/trace.jsonl")).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(
    lines.map((line) => (JSON.parse(line) as TraceEnvelope).name),
    ["tool.execution", "tool.schema_validation"],
  );
});

test("超过单文件上限时轮转，且最多保留配置的文件数", async () => {
  const files = new InMemoryTraceFileSystem();
  const sink = new LocalFileTraceSink(files, { directory: "/trace", maxBytes: 400, maxFiles: 3 });
  for (let index = 0; index < 12; index += 1) {
    await sink.write(envelope({ occurredAt: `2026-08-11T08:00:${String(index).padStart(2, "0")}.000Z` }));
  }
  const present = await files.list("/trace");
  assert.deepEqual(present, ["trace.1.jsonl", "trace.2.jsonl", "trace.jsonl"]);
  assert.equal(present.length, 3);
  for (const name of present) {
    assert.ok((await files.size(`/trace/${name}`)) <= 400);
  }
  // 轮转丢掉的是最旧的一批，最新事件一定还在当前文件里。
  assert.ok((await files.read("/trace/trace.jsonl")).includes("08:00:11"));
});

const BATCH = [envelope()];

test("远程适配器由部署配置选择：换供应商只改配置，调用方代码不变", async () => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchLike: TraceFetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    return { ok: true, status: 200 };
  };
  const configs: readonly TraceTransportConfig[] = [
    { kind: "generic_http", endpoint: "https://logs.example/ingest" },
    {
      kind: "cloudwatch_logs",
      endpoint: "https://logs.us-east-1.amazonaws.com",
      logGroupName: "maxpower",
      logStreamName: "trace",
    },
    { kind: "aliyun_sls", endpoint: "https://cn.log.aliyuncs.com", project: "mp", logstore: "trace" },
    { kind: "otlp_http", endpoint: "https://collector.example" },
  ];
  for (const config of configs) {
    const transport = createTraceTransport(config, fetchLike);
    assert.equal(transport.kind, config.kind);
    assert.deepEqual(await transport.send(BATCH), { status: "accepted" });
  }
  assert.deepEqual(calls.map((call) => call.url), [
    "https://logs.example/ingest",
    "https://logs.us-east-1.amazonaws.com",
    "https://cn.log.aliyuncs.com/logstores/trace/track",
    "https://collector.example/v1/logs",
  ]);
  assert.equal(calls[1]?.headers["x-amz-target"], "Logs_20140328.PutLogEvents");
  assert.equal(calls[2]?.headers["x-log-project"], "mp");
});

test("OTLP 适配器把 sessionId 映射到 gen_ai.conversation.id 语义", () => {
  const request = traceTransportRequest({ kind: "otlp_http", endpoint: "https://collector" }, BATCH);
  const body = JSON.parse(request.body) as {
    resourceLogs: { scopeLogs: { logRecords: { attributes: { key: string; value: { stringValue: string } }[] }[] }[] }[];
  };
  const attributes = body.resourceLogs[0]!.scopeLogs[0]!.logRecords[0]!.attributes;
  const byKey = new Map(attributes.map((item) => [item.key, item.value.stringValue]));
  assert.equal(byKey.get("gen_ai.conversation.id"), "coach-session-1");
  assert.equal(byKey.get("maxpower.trace.id"), "coach-run-1");
  assert.equal(byKey.get("enduser.pseudo.id"), traceUserPseudonym("user-1", stableHash));
});

test("5xx/429 是暂时不可用（留在队列），4xx 是明确拒收（不该无限重试）", async () => {
  const responses = [
    { status: 503, expected: "unavailable" },
    { status: 429, expected: "unavailable" },
    { status: 400, expected: "rejected" },
  ] as const;
  for (const { status, expected } of responses) {
    const transport = createTraceTransport(
      { kind: "generic_http", endpoint: "https://logs.example" },
      async () => ({ ok: false, status }),
    );
    assert.equal((await transport.send(BATCH)).status, expected);
  }
  const offline = createTraceTransport({ kind: "generic_http", endpoint: "https://logs.example" }, async () => {
    throw new Error("network down");
  });
  assert.deepEqual(await offline.send(BATCH), {
    status: "unavailable",
    code: "transport_unreachable",
  });
});
