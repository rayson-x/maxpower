import assert from "node:assert/strict";
import test from "node:test";

import { stableHash } from "../../src/coach/stable";
import {
  buildTraceEnvelope,
  traceShortCode,
  traceUserPseudonym,
  validateTraceEnvelope,
  TraceEnvelopeValidationError,
  TRACE_ENVELOPE_SCHEMA_VERSION,
  TRACE_METADATA_VALUE_MAX_LENGTH,
  type TraceEnvelope,
  type TraceEnvelopeInput,
} from "../../src/observability/model";

function input(overrides: Partial<TraceEnvelopeInput> = {}): TraceEnvelopeInput {
  return {
    traceId: "coach-run-1",
    sessionId: "coach-session-9",
    kind: "llm",
    name: "provider.request",
    occurredAt: "2026-08-11T08:00:00.000Z",
    actor: "agent_runtime",
    userPseudonym: traceUserPseudonym("user-1", stableHash),
    deviceId: "phone-1",
    outcome: "started",
    metadata: { provider: "scripted", network: false },
    ...overrides,
  };
}

test("同一事实重复投影必得同一 eventId 与 orderKey，改一个字段就换一条事件", () => {
  const first = buildTraceEnvelope(input());
  const second = buildTraceEnvelope(input());
  assert.equal(first.eventId, second.eventId);
  assert.equal(first.orderKey, second.orderKey);
  assert.equal(first.schemaVersion, TRACE_ENVELOPE_SCHEMA_VERSION);

  const later = buildTraceEnvelope(input({ occurredAt: "2026-08-11T08:00:01.000Z" }));
  assert.notEqual(later.eventId, first.eventId);
});

test("orderKey 按行动分组、组内按时间；乱序到达也能靠字典序还原回放顺序", () => {
  const early = buildTraceEnvelope(input({ occurredAt: "2026-08-11T08:00:00.000Z" }));
  const late = buildTraceEnvelope(input({
    occurredAt: "2026-08-11T08:00:05.000Z",
    name: "provider.response",
  }));
  const otherRun = buildTraceEnvelope(input({ traceId: "coach-run-2" }));

  const replayed = [late, otherRun, early]
    .sort((left, right) => left.orderKey.localeCompare(right.orderKey))
    .map((envelope) => `${envelope.traceId}:${envelope.name}`);
  assert.deepEqual(replayed, [
    "coach-run-1:provider.request",
    "coach-run-1:provider.response",
    "coach-run-2:provider.request",
  ]);
});

test("嵌套事件的 orderKey 挂在父事件之下", () => {
  const parent = buildTraceEnvelope(input({ kind: "turn", name: "run.completed" }));
  const child = buildTraceEnvelope({
    ...input({ kind: "tool", name: "tool.execution", parentTraceId: "coach-run-1" }),
    parentOrderKey: parent.orderKey,
  });
  assert.ok(child.orderKey.startsWith(`${parent.orderKey}.`));
});

test("缺 traceId/sessionId 的事件被拒绝", () => {
  assert.throws(
    () => buildTraceEnvelope(input({ traceId: "" })),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "missing_identity",
  );
  assert.throws(
    () => buildTraceEnvelope(input({ sessionId: "" })),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "missing_identity",
  );
});

test("kind 是闭集，事件名必须是结构化标识而不是自由文本", () => {
  assert.throws(
    () => buildTraceEnvelope(input({ kind: "chat" as TraceEnvelope["kind"] })),
    (error: unknown) => error instanceof TraceEnvelopeValidationError && error.code === "unknown_kind",
  );
  assert.throws(
    () => buildTraceEnvelope(input({ name: "用户说今天肩膀疼" })),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "invalid_event_name",
  );
});

test("metadata 只允许 string/number/boolean，且不能塞下一段对话文本", () => {
  assert.throws(
    () =>
      buildTraceEnvelope(
        input({ metadata: { nested: { a: 1 } } as unknown as TraceEnvelope["metadata"] }),
      ),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "non_primitive_metadata",
  );
  assert.throws(
    () => buildTraceEnvelope(input({ metadata: { text: "话".repeat(TRACE_METADATA_VALUE_MAX_LENGTH + 1) } })),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "metadata_value_too_long",
  );
});

test("直接标识符不能冒充假名", () => {
  assert.throws(
    () => buildTraceEnvelope(input({ userPseudonym: "user-1" })),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "direct_identifier",
  );
  const envelope = buildTraceEnvelope(input());
  assert.equal(envelope.userPseudonym, traceUserPseudonym("user-1", stableHash));
  assert.equal(JSON.stringify(envelope).includes("user-1"), false);
});

test("已构造的 envelope 也能被独立校验（补发与回填路径复用同一把关）", () => {
  const envelope = buildTraceEnvelope(input());
  assert.doesNotThrow(() => validateTraceEnvelope(envelope));
  assert.throws(
    () => validateTraceEnvelope({ ...envelope, orderKey: "" }),
    (error: unknown) =>
      error instanceof TraceEnvelopeValidationError && error.code === "invalid_order_key",
  );
});

test("错误短码 = traceId 前 8 位 + sessionId 前 4 位（剥掉分隔符后取位）", () => {
  assert.equal(
    traceShortCode({ traceId: "coach-run-1732", sessionId: "coach-session-9" }),
    "COACHRUN-COAC",
  );
  assert.equal(
    traceShortCode({ traceId: "7f3a91c4d5e6", sessionId: "b81c2d" }),
    "7F3A91C4-B81C",
  );
});
