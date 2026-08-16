import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

test("一次明确漏训只归属精确引用的计划课次，不误伤同日其它课次", async () => {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), {
    now: () => "2026-08-15T20:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN" },
    goalContract: { id: "goal", primaryGoal: "strength", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" }, status: "active" },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const knowledgePins = app.getInstalledKnowledgeVersionPins();
  await app.executeDomainCommand({
    type: "plan.revise",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:05:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "plan" },
    planId: "plan",
    expectedRevision: 0,
    revision: {
      id: "plan",
      goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 },
      effectiveFrom: "2026-08-01",
      knowledgePins,
      sessions: [
        { id: "morning", title: "上午训练", scheduledFor: "2026-08-15T09:00:00.000+08:00", knowledgePins, tasks: [] },
        { id: "evening", title: "晚上训练", scheduledFor: "2026-08-15T19:00:00.000+08:00", knowledgePins, tasks: [] },
      ],
    },
  });
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "miss-morning",
    fact: {
      kind: "training",
      confidence: "confirmed",
      reportedSession: {
        executionStatus: "missed",
        plannedSessionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: "morning" },
        summary: "用户确认上午训练未完成",
      },
    },
    envelope: {
      time: { startedAt: "2026-08-15T09:00:00.000+08:00", timezoneOffsetMinutes: 480 },
      provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" },
      privacyClass: "sensitive",
      causalRefs: [],
      evidenceRefs: [],
      layer: "raw_observation",
    },
  });

  const evidence = await app.readPlanExecutionEvidence({ userId: "u1", startDate: "2026-08-15", endDate: "2026-08-15", timezoneOffsetMinutes: 480 });
  assert.equal(evidence.sessions.find((session) => session.sessionId === "morning")?.outcome, "explicitly_missed");
  assert.equal(evidence.sessions.find((session) => session.sessionId === "evening")?.outcome, "unknown");
  assert.deepEqual(evidence.confirmedExecution, { completed: 0, partial: 0, missed: 1, failureDenominator: 1 });
});
