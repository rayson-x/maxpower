import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { FixtureMotionRuntime } from "../../src/coach/adapters/motion";

test("ContextAssembler 去除直接身份但保留身体、睡眠、饮食、训练与经历，Provider 失败不改事实", async () => {
  let sequence = 0;
  const provider = new ScriptedLLMProvider([
    { type: "text-delta", delta: "今天按原计划执行。" },
    { type: "completed" },
  ]);
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-08T08:00:00.000Z",
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    llmProvider: provider,
  });
  const session = await app.startSession({
    userId: "user-provider",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-provider",
    profile: {
      goal: "fat_loss",
      trainingExperience: "beginner",
      name: "张三",
      address: "上海市某路 1 号",
      email: "zhang@example.com",
      phone: "13800000000",
    },
    plan: {
      revision: 3,
      effectiveDate: "2026-08-08",
      title: "全身训练",
      tasks: [{ id: "squat", name: "徒手深蹲", sets: 3, reps: "12" }],
    },
    timeline: [
      {
        id: "body-1",
        occurredAt: "2026-08-08T07:00:00.000Z",
        kind: "body",
        source: "user",
        status: "confirmed",
        data: {
          weightKg: 72.4,
          sleepHours: 7.5,
          proteinGrams: 130,
          exactLocation: "31.2304,121.4737",
          externalAccountId: "health-account-123",
        },
      },
    ],
  });

  const events = await app.sendCoachTurn({ sessionId: session.id, text: "今天怎么安排？" });
  const request = provider.requests[0];

  assert.equal(events.some((event) => event.type === "text-delta"), true);
  assert.equal(request?.context.profile.name, undefined);
  assert.equal(request?.context.profile.address, undefined);
  assert.equal(request?.context.timeline[0]?.data.weightKg, 72.4);
  assert.equal(request?.context.timeline[0]?.data.sleepHours, 7.5);
  assert.equal(request?.context.timeline[0]?.data.proteinGrams, 130);
  assert.equal(request?.context.timeline[0]?.data.exactLocation, "[redacted]");
  assert.equal(request?.context.timeline[0]?.data.externalAccountId, "[redacted]");
  assert.ok(request?.contextManifest.redactedPaths.includes("profile.name"));
  assert.equal((await app.readUserProjection("user-provider")).plan.revision, 3);

  provider.failWith(new Error("provider offline"));
  const fallback = await app.sendCoachTurn({ sessionId: session.id, text: "再解释一下" });
  assert.equal(fallback.some((event) => event.type === "run-error"), true);
  assert.equal(fallback.some((event) => event.type === "text-delta" && event.delta.includes("本地计划仍可用")), true);
  assert.equal((await app.readUserProjection("user-provider")).plan.revision, 3);
});

test("Fixture Motion 只把 confirmed 纳入正式次数，稳定更新 live cue 并 seal SetSummary", async () => {
  let sequence = 0;
  const motionRuntime = new FixtureMotionRuntime([
    {
      source: "rust_canonical_packet",
      packetRef: { id: "packet-1", version: 1, hash: "hash-1" },
      profileCode: 1,
      profileIdentity: "lat_pulldown/rear/v1",
      exactExecutableProfile: true,
      exerciseId: "lat_pulldown",
      sealed: false,
      reps: [{ id: "r1", disposition: "confirmed", findings: [] }],
    },
    {
      source: "rust_canonical_packet",
      packetRef: { id: "packet-2", version: 1, hash: "hash-2" },
      profileCode: 1,
      profileIdentity: "lat_pulldown/rear/v1",
      exactExecutableProfile: true,
      exerciseId: "lat_pulldown",
      sealed: false,
      reps: [
        { id: "r1", disposition: "confirmed", findings: [] },
        { id: "r2", disposition: "needs_review", findings: ["range_below_reference"] },
        { id: "r3", disposition: "rejected", findings: [] },
      ],
    },
    {
      source: "rust_canonical_packet",
      packetRef: { id: "packet-3", version: 1, hash: "hash-3" },
      profileCode: 1,
      profileIdentity: "lat_pulldown/rear/v1",
      exactExecutableProfile: true,
      exerciseId: "lat_pulldown",
      sealed: true,
      reps: [
        { id: "r1", disposition: "confirmed", findings: [] },
        { id: "r2", disposition: "needs_review", findings: ["range_below_reference"] },
        { id: "r3", disposition: "rejected", findings: [] },
      ],
    },
    {
      source: "rust_canonical_packet",
      packetRef: { id: "packet-4", version: 1, hash: "hash-4" },
      profileCode: 0,
      exactExecutableProfile: false,
      exerciseId: "unknown",
      sealed: true,
      reps: [],
    },
  ]);
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000Z",
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    motionRuntime,
  });
  const session = await app.startSession({
    userId: "user-motion",
    context: { kind: "workout", ref: "workout-1" },
  });
  await app.seedUserState({
    userId: "user-motion",
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "背部训练",
      tasks: [{ id: "pulldown", name: "高位下拉", sets: 3, reps: "10", loadKg: 40 }],
    },
  });

  const replay = await app.replayMotionRuntime({
    sessionId: session.id,
    setId: "set-1",
    userReported: { loadKg: 42.5, rir: 2 },
  });
  const [live1, live2, sealed, unsupported] = replay;

  assert.equal(live1?.presentationId, live2?.presentationId);
  assert.equal(sealed?.status, "sealed");
  if (!sealed || sealed.status !== "sealed") return;
  assert.equal(sealed.artifact.confirmedReps, 1);
  assert.equal(sealed.artifact.needsReviewReps, 1);
  assert.equal(sealed.artifact.rejectedReps, 1);
  assert.deepEqual(sealed.artifact.userReported, { loadKg: 42.5, rir: 2 });
  assert.deepEqual(sealed.artifact.packetRef, { id: "packet-3", version: 1, hash: "hash-3" });
  assert.equal(sealed.artifact.evidenceRefs[0]?.id, "packet-3");
  assert.ok(sealed.artifact.capabilityBoundary.some((line) => line.includes("RIR")));

  assert.equal(unsupported?.status, "sealed");
  if (unsupported?.status === "sealed") {
    assert.equal(unsupported.artifact.confirmedReps, 0);
    assert.deepEqual(unsupported.artifact.observationFindings, []);
  }
});

test("注册的 Provider ToolCall 只产生 typed Proposal Artifact，不直接修改计划", async () => {
  let sequence = 0;
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "provider-tool-1",
      toolName: "plan.propose_change",
      input: {
        change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
        reason: "完成历史支持最小档位递增",
      },
    },
    { type: "completed" },
  ]);
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-08T08:00:00.000Z",
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    llmProvider: provider,
  });
  const session = await app.startSession({
    userId: "user-tool",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-tool",
    profile: { goal: "strength", trainingExperience: "intermediate" },
    plan: {
      revision: 5,
      effectiveDate: "2026-08-08",
      title: "力量日",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "5", loadKg: 60 }],
    },
  });

  const events = await app.sendCoachTurn({ sessionId: session.id, text: "帮我安排下一次重量" });

  assert.equal(
    events.some(
      (event) => event.type === "tool-started" && event.toolCallId === "provider-tool-1",
    ),
    true,
  );
  assert.equal(
    events.some(
      (event) => event.type === "artifact-ready" && event.artifactRef.kind === "plan_change_proposal",
    ),
    true,
  );
  assert.equal((await app.readUserProjection("user-tool")).plan.revision, 5);
  const persisted = await app.readSessionProjection(session.id);
  const proposalEvents = persisted.runEvents.filter(
    (event) =>
      event.type === "artifact-ready" && event.artifactRef.kind === "plan_change_proposal",
  );
  assert.equal(proposalEvents.length, 1);
  const persistedReady = persisted.runEvents.find(
    (event) =>
      event.type === "artifact-ready" && event.artifactRef.kind === "plan_change_proposal",
  );
  assert.ok(persistedReady?.type === "artifact-ready");
  assert.equal(persistedReady.toolCallId, "provider-tool-1");
  const streamedReady = events.find((event) => event.type === "artifact-ready");
  assert.equal(persistedReady.runId, streamedReady?.runId);
});
