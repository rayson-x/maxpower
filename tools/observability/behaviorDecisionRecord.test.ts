import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { stableHash } from "../../src/coach/stable";
import {
  BehaviorDecisionTraceRecorder,
  buildBehaviorDecisionRecord,
  behaviorDecisionTraceEnvelope,
  LedgerTraceOutboxSink,
  TraceRecorder,
  traceUserPseudonym,
  type BehaviorDecisionRecordInput,
  type TraceEnvelope,
} from "../../src/observability";

const NOW = "2026-08-13T08:00:00.000Z";
const USER = "user-1";

function input(overrides: Partial<BehaviorDecisionRecordInput> = {}): BehaviorDecisionRecordInput {
  return {
    traceId: "coach-run-1",
    sessionId: "coach-session-1",
    occurredAt: NOW,
    actor: "risk_evaluator",
    userPseudonym: traceUserPseudonym(USER, stableHash),
    deviceId: "phone-1",
    boundary: "risk_evaluation",
    outcome: "evaluated",
    causationIds: ["timeline-event-1"],
    factFrontier: ["timeline:timeline-1:4"],
    versionPins: {
      goal_contract: "goal-1:2",
      plan: "plan-1:7",
      policy: "risk-policy-v1",
    },
    inputRefs: ["timeline:timeline-1:4", "goal_contract:goal-1:2"],
    reasonCodes: ["risk_at_risk"],
    expectedSignal: "user_confirmation",
    ...overrides,
  };
}

test("行为决策以因果、事实前沿、版本钉和闭集原因码生成可回放 trace", async () => {
  const record = buildBehaviorDecisionRecord(input());
  assert.ok(record.decisionId.startsWith("bdr-"));
  assert.deepEqual(record.causationIds, ["timeline-event-1"]);
  assert.deepEqual(record.factFrontier, ["timeline:timeline-1:4"]);
  assert.equal(record.versionPins.plan, "plan-1:7");

  const written: TraceEnvelope[] = [];
  const recorder = new BehaviorDecisionTraceRecorder(
    new TraceRecorder([{ name: "memory", async write(event) { written.push(event); } }]),
  );
  const envelope = await recorder.record(record, { userId: USER });

  assert.ok(envelope);
  assert.equal(envelope.name, "decision.risk_evaluation.evaluated");
  assert.equal(envelope.kind, "evaluator");
  assert.equal(envelope.decisionId, record.decisionId);
  assert.deepEqual(envelope.causationIds, ["timeline-event-1"]);
  assert.deepEqual(envelope.factRefs, ["timeline:timeline-1:4"]);
  assert.deepEqual(envelope.inputRefs, ["timeline:timeline-1:4", "goal_contract:goal-1:2"]);
  assert.deepEqual(envelope.versionPins, record.versionPins);
  assert.deepEqual(envelope.decisionCodes, ["risk_at_risk"]);
  assert.equal(envelope.metadata?.expectedSignal, "user_confirmation");
  assert.equal(written.length, 1);
});

test("相同决策输入可幂等回放，新的事实前沿会产生不同决策和 trace", () => {
  const first = buildBehaviorDecisionRecord(input());
  const replayed = buildBehaviorDecisionRecord(input());
  const stale = buildBehaviorDecisionRecord(
    input({
      outcome: "stale",
      factFrontier: ["timeline:timeline-1:5"],
      reasonCodes: ["stale_fact_frontier"],
      expectedSignal: "none",
    }),
  );

  assert.equal(replayed.decisionId, first.decisionId);
  assert.notEqual(stale.decisionId, first.decisionId);
  assert.equal(stale.outcome, "stale");
  assert.ok(stale.reasonCodes.includes("stale_fact_frontier"));
});

test("行为决策复用既有 TraceOutbox，异步消费者可保留触发事实和 stale 结论", async () => {
  const ledger = new InMemoryCoachLedger();
  const outbox = new LedgerTraceOutboxSink(
    ledger,
    { now: () => NOW, nextId: (prefix) => `${prefix}-1` },
    { async isAuthorized() { return true; } },
  );
  const recorder = new BehaviorDecisionTraceRecorder(new TraceRecorder([outbox]));
  const stale = buildBehaviorDecisionRecord(
    input({
      outcome: "stale",
      factFrontier: ["timeline:timeline-1:5"],
      reasonCodes: ["stale_fact_frontier"],
      expectedSignal: "none",
    }),
  );

  await recorder.record(stale, { userId: USER });
  await outbox.flush();

  const [entry] = (await ledger.read()).traceOutbox;
  assert.ok(entry);
  assert.equal(entry.envelope.decisionId, stale.decisionId);
  assert.deepEqual(entry.envelope.causationIds, ["timeline-event-1"]);
  assert.equal(entry.envelope.name, "decision.risk_evaluation.stale");
  assert.ok(entry.envelope.decisionCodes?.includes("stale_fact_frontier"));
});

test("行为记录拒绝自由文本原因码与缺少因果来源，避免把思维链写入 trace", () => {
  assert.throws(
    () => buildBehaviorDecisionRecord(input({ reasonCodes: ["因为昨晚聚餐吃多了，所以需要调整"] as never })),
    /behavior_decision_unknown_reason_code/,
  );
  assert.throws(
    () => buildBehaviorDecisionRecord(input({ causationIds: [] })),
    /behavior_decision_missing_causation/,
  );
  const freeTextReference = buildBehaviorDecisionRecord(
    input({ inputRefs: ["user said he ate too much at dinner"] }),
  );
  assert.throws(
    () => behaviorDecisionTraceEnvelope(freeTextReference),
    /trace_envelope_invalid_trace_reference/,
  );
});
