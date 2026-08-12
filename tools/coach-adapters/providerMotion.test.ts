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
  assert.equal(request?.contextManifest.providerKind, "scripted");
  assert.equal(request?.contextManifest.requestPurpose, "coach.today");
  assert.equal(request?.contextManifest.redactionPolicyVersion, "direct-identifiers-v1");
  assert.deepEqual(request?.contextManifest.mediaAttachments, []);
  assert.equal(request?.contextManifest.timeRange.latest, "2026-08-08T07:00:00.000Z");
  const run = (await ledger.read()).runs[0];
  assert.equal(run?.contextManifest?.providerKind, "scripted");
  assert.equal(run?.contextManifest?.factRefs.length, request?.contextManifest.factRefs.length);
  assert.equal((await app.readUserProjection("user-provider")).plan.revision, 3);

  provider.failWith(new Error("provider offline"));
  const fallback = await app.sendCoachTurn({ sessionId: session.id, text: "再解释一下" });
  assert.equal(fallback.some((event) => event.type === "run-error"), true);
  assert.equal(fallback.some(
    (event) => event.type === "text-delta" && event.delta === "云端 AI 服务暂时不可用，请稍后重试。",
  ), true);
  assert.equal((await app.readUserProjection("user-provider")).plan.revision, 3);
});

test("历史对话在每次远程上下文组装时继续移除姓名、地址、国际电话和邮箱", async () => {
  let sequence = 0;
  const provider = new ScriptedLLMProvider([
    { type: "text-delta", delta: "收到。" },
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
    userId: "user-history-redaction",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-history-redaction",
    profile: { goal: "strength", trainingExperience: "beginner" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "基础计划",
      tasks: [],
    },
  });

  await app.sendCoachTurn({
    sessionId: session.id,
    text: "姓名：Alice Example；地址：221B Baker Street；电话 +44 20 7946 0958；alice@example.com",
  });
  await app.sendCoachTurn({ sessionId: session.id, text: "继续" });

  const secondRequest = provider.requests[1];
  const conversation = JSON.stringify(secondRequest?.context.currentConversation);
  assert.doesNotMatch(conversation, /Alice Example|221B Baker Street|44 20 7946 0958|alice@example\.com/);
  assert.match(conversation, /已移除/);
  assert.ok(secondRequest?.contextManifest.redactedPaths.some((path) => path.startsWith("conversation.")));
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

  const persistedBeforeReplay = await app.readSessionProjection(session.id);
  const audit = await app.listToolAudit("user-motion");
  assert.equal(
    audit.some((entry) => entry.toolName === "motion.observe_canonical_packet" && entry.phase === "tool_execution"),
    true,
  );

  // A process/replay retry consumes the same immutable packet identity. It is
  // an idempotent observation, not another rep count or another card.
  const repeated = await app.replayMotionRuntime({
    sessionId: session.id,
    setId: "set-1",
    userReported: { loadKg: 42.5, rir: 2 },
  });
  assert.equal(repeated.filter((entry) => entry.status === "sealed").length, 2);
  const persistedAfterReplay = await app.readSessionProjection(session.id);
  assert.equal(
    persistedAfterReplay.artifacts.filter((artifact) => artifact.kind === "set_summary").length,
    persistedBeforeReplay.artifacts.filter((artifact) => artifact.kind === "set_summary").length,
  );
});

test("实时 Canonical 观察只在内存中稳定提示；封存的 confirmed 剂量才进入 Timeline 并触发既有风险链", async () => {
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-13T10:00:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const liveApp = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime,
    motionRuntime: new FixtureMotionRuntime([
      {
        source: "rust_canonical_packet",
        packetRef: { id: "live-packet-1", version: 1, hash: "live-hash-1" },
        profileCode: 1,
        profileIdentity: "lat_pulldown/rear/v1",
        exactExecutableProfile: true,
        exerciseId: "lat_pulldown",
        sealed: false,
        reps: [{ id: "r1", disposition: "confirmed", findings: ["primary_range_below_expectation"] }],
      },
      {
        source: "rust_canonical_packet",
        packetRef: { id: "live-packet-2", version: 1, hash: "live-hash-2" },
        profileCode: 1,
        profileIdentity: "lat_pulldown/rear/v1",
        exactExecutableProfile: true,
        exerciseId: "lat_pulldown",
        sealed: false,
        reps: [{ id: "r1", disposition: "confirmed", findings: ["primary_range_below_expectation"] }],
      },
    ]),
  });
  const liveSession = await liveApp.startSession({
    userId: "user-live-state",
    context: { kind: "workout", ref: "workout-live" },
  });
  const live = await liveApp.replayMotionRuntime({ sessionId: liveSession.id, setId: "set-live" });
  const secondLive = live[1];
  assert.equal(secondLive?.status, "live");
  if (!secondLive || secondLive.status !== "live") return;
  assert.equal(secondLive.event.type, "live-cue");
  if (secondLive.event.type !== "live-cue") return;
  assert.match(secondLive.event.message, /确认动作路径和当前负重仍可控/);
  assert.equal((await liveApp.readDomainProjection({ userId: "user-live-state" })).timeline.current.length, 0);
  assert.deepEqual(liveApp.readLiveMotionSession({ sessionId: liveSession.id, setId: "set-live" }), {
    sessionId: liveSession.id,
    setId: "set-live",
    latestPacketRef: { id: "live-packet-2", version: 1, hash: "live-hash-2" },
    stableFindingIds: ["primary_range_below_expectation"],
    deliveredFindingIds: ["primary_range_below_expectation"],
  });

  const finalizedApp = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime,
    motionRuntime: new FixtureMotionRuntime([
      {
        source: "rust_canonical_packet",
        packetRef: { id: "sealed-packet-1", version: 1, hash: "sealed-hash-1" },
        profileCode: 1,
        profileIdentity: "lat_pulldown/rear/v1",
        exactExecutableProfile: true,
        exerciseId: "lat_pulldown",
        sealed: true,
        reps: [
          { id: "r1", disposition: "confirmed", findings: [] },
          { id: "r2", disposition: "needs_review", findings: ["primary_range_below_expectation"] },
        ],
      },
    ]),
  });
  const finalizedSession = await finalizedApp.startSession({
    userId: "user-finalized-set",
    context: { kind: "workout", ref: "workout-finalized" },
  });
  const sealed = await finalizedApp.replayMotionRuntime({
    sessionId: finalizedSession.id,
    setId: "set-finalized",
    userReported: { loadKg: 42.5, rir: 2 },
  });
  assert.equal(sealed[0]?.status, "sealed");
  assert.equal(sealed[0]?.status === "sealed" && sealed[0].timelineFinalization, "recorded");
  const projection = await finalizedApp.readDomainProjection({ userId: "user-finalized-set" });
  assert.equal(projection.timeline.current.length, 1);
  const timelineFact = projection.timeline.current[0];
  assert.equal(timelineFact?.fact.kind, "training");
  assert.equal(timelineFact?.fact.kind === "training" && timelineFact.fact.reportedSession?.exercises?.[0]?.sets?.[0]?.reps, 1);
  assert.equal(timelineFact?.fact.kind === "training" && timelineFact.fact.reportedSession?.exercises?.[0]?.sets?.[0]?.load?.value, 42.5);
  assert.equal(timelineFact?.envelope?.provenance.origin, "canonical_motion_packet");
  assert.deepEqual(timelineFact?.envelope?.evidenceRefs, [{ kind: "canonical_packet", id: "sealed-packet-1", version: 1, hash: "sealed-hash-1" }]);
  const risk = await finalizedApp.readTimelineRiskEvaluations({ userId: "user-finalized-set" });
  assert.equal(risk.length, 1);
  assert.equal(risk[0]?.disposition, "material");
  assert.equal(risk[0]?.outcome, "queued");

  // Replaying the immutable sealed packet cannot create another long-horizon
  // training fact or another TimelineChanged evaluation.
  await finalizedApp.replayMotionRuntime({
    sessionId: finalizedSession.id,
    setId: "set-finalized",
    userReported: { loadKg: 42.5, rir: 2 },
  });
  assert.equal((await finalizedApp.readDomainProjection({ userId: "user-finalized-set" })).timeline.current.length, 1);
  assert.equal((await finalizedApp.readTimelineRiskEvaluations({ userId: "user-finalized-set" })).length, 1);
});

test("Needs-review 或未配置 profile 的封存结果不成为长期训练剂量", async () => {
  let sequence = 0;
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-13T10:00:00.000+08:00",
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    motionRuntime: new FixtureMotionRuntime([
      {
        source: "rust_canonical_packet",
        packetRef: { id: "review-only", version: 1, hash: "review-only-hash" },
        profileCode: 1,
        profileIdentity: "lat_pulldown/rear/v1",
        exactExecutableProfile: true,
        exerciseId: "lat_pulldown",
        sealed: true,
        reps: [{ id: "r1", disposition: "needs_review", findings: ["primary_range_below_expectation"] }],
      },
      {
        source: "rust_canonical_packet",
        packetRef: { id: "unsupported", version: 1, hash: "unsupported-hash" },
        profileCode: 0,
        exactExecutableProfile: false,
        exerciseId: "unknown",
        sealed: true,
        reps: [],
      },
    ]),
  });
  const session = await app.startSession({ userId: "user-no-dose", context: { kind: "workout", ref: "workout-no-dose" } });
  const results = await app.replayMotionRuntime({ sessionId: session.id, setId: "set-no-dose" });
  assert.equal(results[0]?.status === "sealed" && results[0].timelineFinalization, "not_recordable");
  assert.equal(results[1]?.status === "sealed" && results[1].timelineFinalization, "not_recordable");
  assert.equal((await app.readDomainProjection({ userId: "user-no-dose" })).timeline.current.length, 0);
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
