import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Context, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import type { GoalContractData } from "../../src/coach/domain";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { DOMAIN_EVENT_SCHEMA_VERSION } from "../../src/coach/domain";
import type { AdaptivePlanCandidate } from "../../src/planning";
import { RecordModule } from "../../src/records";

const allowAllConversationCapabilities = {
  capabilities: { allowed: async () => true },
};

/** Give a workbench fixture a confirmed profile so a send enters the everyday
 * scenario (the planning tools are only exposed outside intake). */
async function commitProfile(ledger: InMemoryCoachLedger, userId: string): Promise<void> {
  const now = "2026-08-16T07:00:00.000Z";
  await ledger.commit({
    kind: "domain", userId, actorId: userId, intent: "test.profile",
    expectedRevisions: [{ kind: "user_profile", id: `profile:${userId}`, revision: 0 }],
    domainEvents: [{
      id: `event-profile-${userId}`, schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION, name: "user_profile.created", userId,
      aggregate: { kind: "user_profile", id: `profile:${userId}`, revision: 1 },
      actor: { kind: "user", id: userId }, deviceId: "test", occurredAt: now, recordedAt: now, timezoneOffsetMinutes: 0,
      provenance: { source: "user", confidence: "confirmed" }, evidenceRefs: [], causationId: "test", correlationId: "test",
      payload: { id: `profile:${userId}`, locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    }],
    idempotencyKey: `test.profile:${userId}`, recordedAt: now,
  });
}

test("local conversation adapters own baseline and record admission outside mobile composition", async () => {
  let sequence = 0;
  const kernel = new LocalProductKernel(new InMemoryCoachLedger(), {
    now: () => "2026-08-16T08:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  const records = new RecordModule({
    createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
    confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
    createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
    confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
    correctTimelineFact: (input) => kernel.correctTimelineFact(input),
  });
  const adapters = createLocalConversationAdapters({ kernel, records });

  await adapters.profileSetup?.({ userId: "u-local", ageYears: 30, heightCm: 175, weightKg: 75, goalText: "先增肌" });
  const receipt = await adapters.records?.recordExplicit?.({
    kind: "body_weight",
    userId: "u-local",
    valueKg: 75.4,
    occurredAt: "2026-08-16T08:00:00.000+08:00",
    idempotencyKey: "weight",
  });
  assert.equal(receipt?.label, "体重");
  const domain = await kernel.readDomainProjection({ userId: "u-local" });
  assert.equal(domain.profile?.value.demographics?.currentWeight?.value, 75);
  assert.equal(domain.timeline.current.length, 1);
  assert.equal(domain.timeline.current[0]?.fact.kind, "body");
});

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: "openai-completions",
    provider: "test",
    model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason,
    timestamp: 0,
  };
}

function stream(events: readonly AssistantMessageEvent[], final: AssistantMessage) {
  return {
    async *[Symbol.asyncIterator]() { yield* events; },
    result: async () => final,
  };
}

test("Pi Conversation Module persists one conversation across real tool continuation and restart", async () => {
  const requests: unknown[] = [];
  const toolCall = assistant([{ type: "toolCall", id: "call-profile", name: "coach.read_profile", arguments: {} }], "toolUse");
  const final = assistant([{ type: "text", text: "我已经读取到你的当前档案。" }], "stop");
  const streamFn = ((_model: Model<any>, context: Context) => {
    requests.push(context);
    return requests.length === 1
      ? stream([{ type: "start", partial: toolCall }, { type: "toolcall_end", contentIndex: 0, toolCall: toolCall.content[0] as never, partial: toolCall }, { type: "done", reason: "toolUse", message: toolCall }], toolCall)
      : stream([{ type: "start", partial: final }, { type: "text_start", contentIndex: 0, partial: final }, { type: "text_delta", contentIndex: 0, delta: "我已经读取到你的当前档案。", partial: final }, { type: "text_end", contentIndex: 0, content: "我已经读取到你的当前档案。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const dependencies = {
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: {
      model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>,
      streamFn,
      getApiKey: () => undefined,
    },
  };

  const first = new PiAgentConversationModule(dependencies);
  const opened = await first.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await first.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "看看我的档案", clientTurnId: "turn-1" });
  await first.whenIdle(opened.conversation.id);

  const restarted = new PiAgentConversationModule(dependencies);
  const projection = await restarted.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.deepEqual(projection.items.filter((item) => item.kind !== "form").map((item) => item.kind), ["message", "message", "tool_activity", "message"]);
  assert.equal(projection.items.at(-1)?.content, "我已经读取到你的当前档案。");
  assert.equal(requests.length, 2);
  assert.match((requests[0] as { systemPrompt?: string }).systemPrompt ?? "", /Interaction soul/);
  assert.match((requests[0] as { systemPrompt?: string }).systemPrompt ?? "", /timeline\.record_explicit/);
});

test("a malformed tool loop stops at the local run budget and leaves a recoverable transcript", async () => {
  let streamCount = 0;
  const streamFn = (() => {
    streamCount += 1;
    const call = assistant([{ type: "toolCall", id: `profile-${streamCount}`, name: "coach.read_profile", arguments: {} }], "toolUse");
    return stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "不断读取档案", clientTurnId: "turn-loop" });
  await module.whenIdle(opened.conversation.id);
  assert.equal(streamCount, 12);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.run?.status, "completed");
  assert.equal(projection.items.filter((item) => item.kind === "tool_activity").length, 12);
});

test("a Pi transport failure is durable as failed rather than reported as a completed run", async () => {
  const failed = { ...assistant([], "error"), errorMessage: "pi_llm_service_unavailable" };
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: {
      model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>,
      streamFn: (() => stream([{ type: "error", reason: "error", error: failed }], failed)) as unknown as StreamFn,
    },
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "开始", clientTurnId: "turn-failure" });
  await module.whenIdle(opened.conversation.id);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.run?.status, "failed");
  assert.equal(projection.run?.terminalCode, "pi_llm_service_unavailable");
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "本轮未能完成"));
});

test("a material fixed signal caused during an active turn stays in that same Pi conversation", async () => {
  const final = assistant([{ type: "text", text: "我会继续看这条固定检查。" }], "stop");
  const streamFn = (() => ({
    async *[Symbol.asyncIterator]() {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      yield { type: "done", reason: "stop", message: final } as AssistantMessageEvent;
    },
    result: async () => final,
  })) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    signals: { latestMaterial: async () => ({ id: "assessment-1", state: "at_risk" as const, diagnosis: "execution_failure" as const, materialSignal: "review_recommended" as const, reasonCodes: ["execution_shortfall"], nextValidationSignals: ["next_completed_session"] }) },
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "记下今天的情况", clientTurnId: "turn-1" });
  const reconciled = await module.execute({ kind: "reconcile", userId: "user-1", conversationId: opened.conversation.id, causationId: "record-1" });
  assert.equal(reconciled.kind, "stopped");
  await module.whenIdle(opened.conversation.id);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.detail === "signal:assessment-1"));
  assert.equal((await ledger.read()).runs.filter((run) => run.sessionId === opened.conversation.id).length, 1);
});

test("Pi knowledge tool returns only installed passage references and persists its activity in the conversation", async () => {
  const call = assistant([{ type: "toolCall", id: "knowledge-sleep", name: "knowledge.search_installed", arguments: { query: "睡眠", topic: "recovery" } }], "toolUse");
  const final = assistant([{ type: "text", text: "我找到了本地的恢复资料。" }], "stop");
  let callCount = 0;
  const streamFn = (() => {
    callCount += 1;
    return callCount === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "我找到了本地的恢复资料。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    knowledge: {
      search: () => ({
        kind: "found",
        entries: [{ id: "sleep-passage", title: "恢复 · 睡眠", text: "已安装的恢复资料", passageRef: { passageId: "sleep-passage", contentHash: "hash-sleep", citationIds: ["citation-1"] } }],
      }),
    },
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "睡眠会影响训练吗？", clientTurnId: "turn-knowledge" });
  await module.whenIdle(opened.conversation.id);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const receipt = projection.items.find((item) => item.card?.kind === "receipt" && item.card.label === "已检索本地知识");
  assert.ok(receipt);
  assert.equal(receipt?.card?.kind === "receipt" ? receipt.card.detail : undefined, "恢复 · 睡眠");
  const toolCall = (await ledger.read()).toolCalls.find((item) => item.id === "knowledge-sleep");
  assert.equal(toolCall?.status, "output_available");
});

test("a long completed conversation saves deterministic recovery memory without granting it factual authority", async () => {
  const final = assistant([{ type: "text", text: "收到。" }], "stop");
  let sequence = 0;
  const summaries: { content: string; conversationId: string }[] = [];
  const module = new PiAgentConversationModule({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn: (() => stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "收到。", partial: final }, { type: "done", reason: "stop", message: final }], final)) as unknown as StreamFn },
    memory: { upsertConversationSummary: async (summary) => { summaries.push({ content: summary.content, conversationId: summary.conversationId }); } },
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  for (let index = 0; index < 33; index += 1) {
    await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: `需求 ${index}`, clientTurnId: `turn-${index}` });
    await module.whenIdle(opened.conversation.id);
  }
  assert.ok(summaries.length > 0);
  const latest = summaries.at(-1)!;
  assert.equal(latest.conversationId, opened.conversation.id);
  assert.match(latest.content, /Recent user requests:.*需求 32/);
  assert.match(latest.content, /Authority: this is recovery memory only/);
});

test("the production-shaped conversation chain keeps Baseline, Goal and first Plan in one Pi conversation", async () => {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const app = new LocalProductKernel(ledger, {
    now: () => "2026-08-16T08:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  let confirmedGoal: GoalContractData | undefined;
  const goalCall = assistant([{ type: "toolCall", id: "goal-path", name: "goal.propose_path", arguments: { primaryGoal: "hypertrophy", targetWeeks: 12, targetWeightKg: 82, acceptableCosts: ["每周 3 次训练", "每天记录主要饮食数值"] } }], "toolUse");
  const goalFinal = assistant([{ type: "text", text: "我把目标路径放在确认卡里。" }], "stop");
  const planningInputCall = assistant([{ type: "toolCall", id: "planning-input", name: "plan.read_fixed_input", arguments: {} }], "toolUse");
  const planFinal = assistant([{ type: "text", text: "当前阶段计划已准备好，请确认。" }], "stop");
  let streamCount = 0;
  const streamFn = ((_model: Model<any>, _context: Context) => {
    streamCount += 1;
    if (streamCount === 1) return stream([{ type: "start", partial: goalCall }, { type: "toolcall_end", contentIndex: 0, toolCall: goalCall.content[0] as never, partial: goalCall }, { type: "done", reason: "toolUse", message: goalCall }], goalCall);
    if (streamCount === 2) return stream([{ type: "start", partial: goalFinal }, { type: "text_delta", contentIndex: 0, delta: "我把目标路径放在确认卡里。", partial: goalFinal }, { type: "done", reason: "stop", message: goalFinal }], goalFinal);
    if (streamCount === 3) return stream([{ type: "start", partial: planningInputCall }, { type: "toolcall_end", contentIndex: 0, toolCall: planningInputCall.content[0] as never, partial: planningInputCall }, { type: "done", reason: "toolUse", message: planningInputCall }], planningInputCall);
    const goal = confirmedGoal;
    assert.ok(goal, "the Goal confirmation must precede first-plan composition");
    const candidate: AdaptivePlanCandidate = {
      id: "first-stage-candidate",
      generatedBy: { kind: "llm", runId: "fixture", model: "test-model" },
      planRevision: {
        id: "first-stage-plan",
        goalContractRef: { kind: "goal_contract", id: goal!.id, revision: 1 },
        effectiveFrom: "2026-08-17",
        knowledgePins: app.getInstalledKnowledgeVersionPins(),
        sessions: [{ id: "first-stage-session", title: "全身力量训练", scheduledFor: "2026-08-17", knowledgePins: app.getInstalledKnowledgeVersionPins(), tasks: [{ id: "first-stage-task", exerciseVariantId: "bench_press.dumbbell.flat.standard.bilateral.full_rom", sets: [{ id: "first-stage-set", targetReps: { min: 8, max: 12 }, targetRir: 3 }] }] }],
        observationContract: { requiredSignals: ["weekly_body_data", "planned_training_outcome", "representative_numeric_intake"], minimumObservationDays: 14, trackingSilenceReviewDays: 7, reviewCadenceDays: 7, successConditions: ["small_surplus_and_training_completed"], progressionConditions: ["reps_progress_with_recovery"], holdConditions: ["window_incomplete"], fallbackConditions: ["execution_friction"], stopConditions: ["safety_hold_or_recovery_decline"] },
      },
      nutritionStrategy: { id: "first-stage-nutrition", goalContractRef: { kind: "goal_contract", id: goal!.id, revision: 1 }, status: "active", phase: "hypertrophy", calorieRange: { min: { value: 2450, unit: "kcal" }, max: { value: 2650, unit: "kcal" } }, reviewWindow: { startsAt: "2026-08-17T00:00:00.000+08:00", endsAt: "2026-08-31T00:00:00.000+08:00", minimumWeightObservations: 3 } },
      behaviorChanges: [{ id: "first-stage-step", instruction: "先把每日加餐保留为一个固定、容易完成的小步骤", burden: "low", preferenceRefs: [] }],
      rationale: ["从当前目标与可执行负担开始，后续由真实记录调整。"],
      expectedTradeoffs: ["先建立可持续执行，再用趋势决定是否推进。"],
    };
    const { id: _id, generatedBy: _generatedBy, ...toolCandidate } = candidate;
    const planCall = assistant([{ type: "toolCall", id: "plan-candidate", name: "plan.propose_current_stage", arguments: { candidate: toolCandidate } }], "toolUse");
    if (streamCount === 4) return stream([{ type: "start", partial: planCall }, { type: "toolcall_end", contentIndex: 0, toolCall: planCall.content[0] as never, partial: planCall }, { type: "done", reason: "toolUse", message: planCall }], planCall);
    return stream([{ type: "start", partial: planFinal }, { type: "text_delta", contentIndex: 0, delta: "当前阶段计划已准备好，请确认。", partial: planFinal }, { type: "done", reason: "stop", message: planFinal }], planFinal);
  }) as unknown as StreamFn;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    profileSetup: async (baseline) => {
      await app.executeDomainCommand({
        type: "user.bootstrap",
        meta: { userId: baseline.userId, actor: { kind: "user", id: baseline.userId }, deviceId: "conversation-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap:${baseline.userId}` },
        profile: { id: `profile:${baseline.userId}`, locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: baseline.ageYears, sex: "male", height: { value: baseline.heightCm, unit: "cm" }, currentWeight: { value: baseline.weightKg, unit: "kg" } } },
        mandate: { id: `mandate:${baseline.userId}`, mode: "collaborative", planChangeAuthorization: "always_ask" },
      });
    },
    goals: {
      confirm: async (input) => {
        const result = await app.confirmGoalNegotiation({ userId: input.userId, goal: input.goal, selectedOptionId: input.selectedOptionId, planChangeAuthorization: "always_ask", authorization: { kind: "local_user_presence", verifiedAt: "2026-08-16T08:00:00.000+08:00", nonce: input.idempotencyKey }, idempotencyKey: input.idempotencyKey });
        confirmedGoal = result.goal;
        return { goal: result.goal };
      },
    },
    planning: {
      readInput: async ({ userId }) => app.readPlanningInput({ userId, mode: "first_plan" }),
      estimateMuscleLoad: async () => ({ policy: { id: "test", version: "0" }, perMuscle: [], unknownExercises: [] }),
      forecastRecovery: async () => ({ policy: { id: "test", version: "0" }, start: { status: "insufficient_history" as const, policy: { id: "test", version: "0" }, evaluatedAt: "2026-08-16", muscles: [], disclaimer: "group_mean_with_individual_signal_adjustment" as const }, days: [] }),
      propose: async ({ userId, candidate, idempotencyKey }) => {
        const result = await app.proposeAdaptivePlanCandidate({ userId, candidate: candidate as AdaptivePlanCandidate, attempt: 1, idempotencyKey });
        return result.artifact
          ? { status: "ready" as const, proposalId: result.artifact.id, title: result.artifact.title, summary: result.artifact.summary }
          : { status: "invalid" as const, title: "计划候选未通过固定校验", summary: result.validation.issues.map((issue) => issue.message) };
      },
      confirm: async ({ userId, proposalId, idempotencyKey }) => { await app.confirmAdaptivePlanCandidate({ userId, proposalId, idempotencyKey }); },
      reject: async ({ userId, proposalId, idempotencyKey }) => { await app.rejectAdaptivePlanCandidate({ userId, proposalId, idempotencyKey }); },
    },
  });
  const opened = await module.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "submit_baseline", userId: "u1", conversationId: opened.conversation.id, baseline: { ageYears: 28, heightCm: 180, weightKg: 80, goalText: "我想增肌" } });
  await module.whenIdle(opened.conversation.id);
  let projection = await module.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const goalCard = projection.items.find((item) => item.card?.kind === "goal_path");
  assert.ok(goalCard);
  const option = goalCard?.card?.kind === "goal_path" ? goalCard.card.options.find((candidate) => candidate.feasible) : undefined;
  assert.ok(option);
  await module.execute({ kind: "resolve_goal_path", userId: "u1", conversationId: opened.conversation.id, cardId: goalCard!.id, optionId: option!.id });
  await module.whenIdle(opened.conversation.id);
  projection = await module.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const planCard = projection.items.find((item) => item.card?.kind === "plan_candidate");
  assert.ok(planCard, JSON.stringify({ items: projection.items.map((item) => ({ kind: item.kind, content: item.content, card: item.card?.kind, status: item.card?.status })), toolCalls: (await ledger.read()).toolCalls }));
  await module.execute({ kind: "resolve_plan_candidate", userId: "u1", conversationId: opened.conversation.id, cardId: planCard!.id, decision: "confirm" });
  const domain = await app.readDomainProjection({ userId: "u1" });
  assert.equal(domain.plan?.value.id, "first-stage-plan");
  assert.equal(domain.nutritionStrategies[0]?.value.id, "first-stage-nutrition");
  const finalProjection = await module.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(finalProjection.kind, "conversation");
  if (finalProjection.kind !== "conversation") return;
  assert.equal(finalProjection.items.filter((item) => item.card?.kind === "plan_candidate").length, 1);
  assert.equal(finalProjection.items.find((item) => item.card?.kind === "plan_candidate")?.card?.status, "confirmed");
});

test("a plan candidate stays confirmable after a module restart (ledger restore)", async () => {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
  const app = new LocalProductKernel(ledger, runtime);
  let confirmedGoal: GoalContractData | undefined;
  const goalCall = assistant([{ type: "toolCall", id: "goal-path", name: "goal.propose_path", arguments: { primaryGoal: "hypertrophy", targetWeeks: 12, targetWeightKg: 82, acceptableCosts: ["每周 3 次训练"] } }], "toolUse");
  const goalFinal = assistant([{ type: "text", text: "我把目标路径放在确认卡里。" }], "stop");
  const planningInputCall = assistant([{ type: "toolCall", id: "planning-input", name: "plan.read_fixed_input", arguments: {} }], "toolUse");
  const planFinal = assistant([{ type: "text", text: "当前阶段计划已准备好，请确认。" }], "stop");
  let streamCount = 0;
  const streamFn = ((_model: Model<any>, _context: Context) => {
    streamCount += 1;
    if (streamCount === 1) return stream([{ type: "start", partial: goalCall }, { type: "toolcall_end", contentIndex: 0, toolCall: goalCall.content[0] as never, partial: goalCall }, { type: "done", reason: "toolUse", message: goalCall }], goalCall);
    if (streamCount === 2) return stream([{ type: "start", partial: goalFinal }, { type: "text_delta", contentIndex: 0, delta: "我把目标路径放在确认卡里。", partial: goalFinal }, { type: "done", reason: "stop", message: goalFinal }], goalFinal);
    if (streamCount === 3) return stream([{ type: "start", partial: planningInputCall }, { type: "toolcall_end", contentIndex: 0, toolCall: planningInputCall.content[0] as never, partial: planningInputCall }, { type: "done", reason: "toolUse", message: planningInputCall }], planningInputCall);
    const goal = confirmedGoal;
    assert.ok(goal, "the Goal confirmation must precede first-plan composition");
    const candidate: AdaptivePlanCandidate = {
      id: "first-stage-candidate",
      generatedBy: { kind: "llm", runId: "fixture", model: "test-model" },
      planRevision: {
        id: "first-stage-plan",
        goalContractRef: { kind: "goal_contract", id: goal!.id, revision: 1 },
        effectiveFrom: "2026-08-17",
        knowledgePins: app.getInstalledKnowledgeVersionPins(),
        sessions: [{ id: "first-stage-session", title: "全身力量训练", scheduledFor: "2026-08-17", knowledgePins: app.getInstalledKnowledgeVersionPins(), tasks: [{ id: "first-stage-task", exerciseVariantId: "bench_press.dumbbell.flat.standard.bilateral.full_rom", sets: [{ id: "first-stage-set", targetReps: { min: 8, max: 12 }, targetRir: 3 }] }] }],
        observationContract: { requiredSignals: ["weekly_body_data"], minimumObservationDays: 14, trackingSilenceReviewDays: 7, reviewCadenceDays: 7, successConditions: ["a"], progressionConditions: ["b"], holdConditions: ["c"], fallbackConditions: ["d"], stopConditions: ["e"] },
      },
      nutritionStrategy: { id: "first-stage-nutrition", goalContractRef: { kind: "goal_contract", id: goal!.id, revision: 1 }, status: "active", phase: "hypertrophy", calorieRange: { min: { value: 2450, unit: "kcal" }, max: { value: 2650, unit: "kcal" } }, reviewWindow: { startsAt: "2026-08-17T00:00:00.000+08:00", endsAt: "2026-08-31T00:00:00.000+08:00", minimumWeightObservations: 3 } },
      behaviorChanges: [{ id: "first-stage-step", instruction: "每天记录主要饮食", burden: "low", preferenceRefs: [] }],
      rationale: ["先建立基线。"],
      expectedTradeoffs: ["前期慢。"],
    };
    const { id: _id, generatedBy: _generatedBy, ...toolCandidate } = candidate;
    const planCall = assistant([{ type: "toolCall", id: "plan-candidate", name: "plan.propose_current_stage", arguments: { candidate: toolCandidate } }], "toolUse");
    if (streamCount === 4) return stream([{ type: "start", partial: planCall }, { type: "toolcall_end", contentIndex: 0, toolCall: planCall.content[0] as never, partial: planCall }, { type: "done", reason: "toolUse", message: planCall }], planCall);
    return stream([{ type: "start", partial: planFinal }, { type: "text_delta", contentIndex: 0, delta: "当前阶段计划已准备好，请确认。", partial: planFinal }, { type: "done", reason: "stop", message: planFinal }], planFinal);
  }) as unknown as StreamFn;
  const pi = { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn };
  const deps = {
    ledger,
    runtime,
    pi,
    profileSetup: async (baseline: { userId: string; ageYears: number; heightCm: number; weightKg: number; goalText?: string }) => {
      await app.executeDomainCommand({
        type: "user.bootstrap",
        meta: { userId: baseline.userId, actor: { kind: "user", id: baseline.userId }, deviceId: "conversation-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap:${baseline.userId}` },
        profile: { id: `profile:${baseline.userId}`, locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: baseline.ageYears, sex: "male", height: { value: baseline.heightCm, unit: "cm" }, currentWeight: { value: baseline.weightKg, unit: "kg" } } },
        mandate: { id: `mandate:${baseline.userId}`, mode: "collaborative", planChangeAuthorization: "always_ask" },
      });
    },
    goals: {
      confirm: async (input: { userId: string; goal: GoalContractData; selectedOptionId: "gradual" | "balanced" | "faster"; idempotencyKey: string }) => {
        const result = await app.confirmGoalNegotiation({ userId: input.userId, goal: input.goal, selectedOptionId: input.selectedOptionId, planChangeAuthorization: "always_ask", authorization: { kind: "local_user_presence", verifiedAt: "2026-08-16T08:00:00.000+08:00", nonce: input.idempotencyKey }, idempotencyKey: input.idempotencyKey });
        confirmedGoal = result.goal;
        return { goal: result.goal };
      },
    },
    planning: {
      readInput: async ({ userId }: { userId: string }) => app.readPlanningInput({ userId, mode: "first_plan" }),
      estimateMuscleLoad: async () => ({ policy: { id: "test", version: "0" }, perMuscle: [], unknownExercises: [] }),
      forecastRecovery: async () => ({ policy: { id: "test", version: "0" }, start: { status: "insufficient_history" as const, policy: { id: "test", version: "0" }, evaluatedAt: "2026-08-16", muscles: [], disclaimer: "group_mean_with_individual_signal_adjustment" as const }, days: [] }),
      propose: async ({ userId, candidate, idempotencyKey }: { userId: string; candidate: unknown; idempotencyKey: string }) => {
        const result = await app.proposeAdaptivePlanCandidate({ userId, candidate: candidate as AdaptivePlanCandidate, attempt: 1, idempotencyKey });
        return result.artifact
          ? { status: "ready" as const, proposalId: result.artifact.id, title: result.artifact.title, summary: result.artifact.summary }
          : { status: "invalid" as const, title: "计划候选未通过固定校验", summary: result.validation.issues.map((issue) => issue.message) };
      },
      confirm: async ({ userId, proposalId, idempotencyKey }: { userId: string; proposalId: string; idempotencyKey: string }) => { await app.confirmAdaptivePlanCandidate({ userId, proposalId, idempotencyKey }); },
      reject: async ({ userId, proposalId, idempotencyKey }: { userId: string; proposalId: string; idempotencyKey: string }) => { await app.rejectAdaptivePlanCandidate({ userId, proposalId, idempotencyKey }); },
    },
  } as const;
  const module = new PiAgentConversationModule(deps);
  const opened = await module.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "submit_baseline", userId: "u1", conversationId: opened.conversation.id, baseline: { ageYears: 28, heightCm: 180, weightKg: 80, goalText: "我想增肌" } });
  await module.whenIdle(opened.conversation.id);
  let projection = await module.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  if (projection.kind !== "conversation") return;
  const goalCard = projection.items.find((item) => item.card?.kind === "goal_path");
  const option = goalCard?.card?.kind === "goal_path" ? goalCard.card.options.find((candidate) => candidate.feasible) : undefined;
  assert.ok(option);
  await module.execute({ kind: "resolve_goal_path", userId: "u1", conversationId: opened.conversation.id, cardId: goalCard!.id, optionId: option!.id as "gradual" | "balanced" | "faster" });
  await module.whenIdle(opened.conversation.id);
  projection = await module.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  if (projection.kind !== "conversation") return;
  const planCard = projection.items.find((item) => item.card?.kind === "plan_candidate");
  assert.ok(planCard);

  // 重启路径上的后台簿记（每日目标路径复核/配方补齐）不得让待确认候选过期：
  const before = await app.runDailyGoalPathReview({ userId: "u1", idempotencyKey: "daily-goal-path:2026-08-16", timezoneOffsetMinutes: -480 });
  await app.catchUpRecipes("u1");
  await app.runDailyGoalPathReview({ userId: "u1", idempotencyKey: "daily-goal-path:2026-08-16", timezoneOffsetMinutes: -480 });
  void before;

  // 模拟应用重启：同一 ledger，全新 Kernel + 全新 Module（无任何内存状态）。
  const app2 = new LocalProductKernel(ledger, runtime);
  const deps2 = {
    ...deps,
    planning: {
      ...deps.planning,
      readInput: async ({ userId }: { userId: string }) => app2.readPlanningInput({ userId, mode: "first_plan" }),
      confirm: async ({ userId, proposalId, idempotencyKey }: { userId: string; proposalId: string; idempotencyKey: string }) => { await app2.confirmAdaptivePlanCandidate({ userId, proposalId, idempotencyKey }); },
      reject: async ({ userId, proposalId, idempotencyKey }: { userId: string; proposalId: string; idempotencyKey: string }) => { await app2.rejectAdaptivePlanCandidate({ userId, proposalId, idempotencyKey }); },
    },
  };
  const restarted = new PiAgentConversationModule(deps2);
  const restored = await restarted.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(restored.kind, "conversation");
  if (restored.kind !== "conversation") return;
  const restoredCard = restored.items.find((item) => item.card?.kind === "plan_candidate");
  assert.ok(restoredCard, "重启后计划候选卡仍在");
  assert.equal(restoredCard!.card?.kind === "plan_candidate" ? restoredCard!.card.status : undefined, "awaiting_confirmation");
  const confirmed = await restarted.execute({ kind: "resolve_plan_candidate", userId: "u1", conversationId: opened.conversation.id, cardId: restoredCard!.id, decision: "confirm" });
  assert.equal(confirmed.kind, "plan_candidate_confirmed");
  const domain = await app.readDomainProjection({ userId: "u1" });
  assert.equal(domain.plan?.value.id, "first-stage-plan");
});

test("a send immediately after stop starts a new run instead of steering the aborted one", async () => {
  const cancelled = assistant([], "aborted");
  const final = assistant([{ type: "text", text: "新消息已收到。" }], "stop");
  let streamCount = 0;
  const streamFn = ((_model: Model<any>, _context: Context, options?: { signal?: AbortSignal }) => {
    streamCount += 1;
    if (streamCount > 1) {
      return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "新消息已收到。", partial: final }, { type: "done", reason: "stop", message: final }], final);
    }
    return {
      async *[Symbol.asyncIterator]() {
        if (!options?.signal?.aborted) {
          await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        }
        yield { type: "error", reason: "aborted", error: cancelled } as AssistantMessageEvent;
      },
      result: async () => cancelled,
    };
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const conversation = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
  });
  const opened = await conversation.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "先分析", clientTurnId: "turn-1" });
  const stopped = await conversation.execute({ kind: "stop", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(stopped.kind, "stopped");
  // Deliberately no whenIdle here: the user sends the next message immediately.
  const sent = await conversation.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "换个方向", clientTurnId: "turn-2" });
  assert.equal(sent.kind, "started");
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.run?.status, "completed");
  assert.equal(projection.items.at(-1)?.content, "新消息已收到。");
  const runs = (await ledger.read()).runs.filter((run) => run.sessionId === opened.conversation.id);
  assert.equal(runs.length, 2);
  assert.equal(runs.find((run) => run.clientTurnId === "turn-1")?.status, "interrupted");
});

test("a running Pi conversation accepts steer, then terminates without losing submitted messages", async () => {
  const cancelled = assistant([], "aborted");
  const streamFn = ((_model: Model<any>, _context: Context, options?: { signal?: AbortSignal }) => {
    const events = {
      async *[Symbol.asyncIterator]() {
        if (!options?.signal?.aborted) {
          await new Promise<void>((resolve) => options?.signal?.addEventListener("abort", () => resolve(), { once: true }));
        }
        yield { type: "error", reason: "aborted", error: cancelled } as AssistantMessageEvent;
      },
      result: async () => cancelled,
    };
    return events;
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const conversation = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
  });
  const opened = await conversation.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  const started = await conversation.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "先分析", clientTurnId: "turn-1" });
  assert.equal(started.kind, "started");
  const steered = await conversation.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "先别分析，记下这个问题", clientTurnId: "turn-2" });
  assert.equal(steered.kind, "steered");
  const stopped = await conversation.execute({ kind: "stop", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(stopped.kind, "stopped");
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.deepEqual(projection.items.filter((item) => item.kind === "message").map((item) => item.content), ["你好，我是你的 Coach。先用三个基础信息建立档案；之后我们会在同一条对话里协商目标，或者直接开始记录。", "先分析", "先别分析，记下这个问题"]);
  assert.equal(projection.run?.status, "interrupted");
  assert.equal(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "本轮已停止"), true);
});

test("a new user gets a baseline form in the same conversation and submits it through the local profile boundary", async () => {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  let submitted: unknown;
  const final = assistant([{ type: "text", text: "基础信息已保存，我会基于这些信息继续和你确认目标。" }], "stop");
  const conversation = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: {
      model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>,
      streamFn: (() => stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "基础信息已保存，我会基于这些信息继续和你确认目标。", partial: final }, { type: "done", reason: "stop", message: final }], final)) as unknown as StreamFn,
    },
    profileSetup: async (input) => { submitted = input; },
  });
  const opened = await conversation.execute({ kind: "new", userId: "new-user" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  const before = await conversation.read({ kind: "conversation", userId: "new-user", conversationId: opened.conversation.id });
  assert.equal(before.kind, "conversation");
  if (before.kind !== "conversation") return;
  assert.equal(before.items.some((item) => item.kind === "form" && item.form?.kind === "baseline"), true);
  const result = await conversation.execute({ kind: "submit_baseline", userId: "new-user", conversationId: opened.conversation.id, baseline: { ageYears: 28, heightCm: 180, weightKg: 80, goalText: "增肌" } });
  assert.equal(result.kind, "baseline_submitted");
  await conversation.whenIdle(opened.conversation.id);
  assert.deepEqual(submitted, { userId: "new-user", ageYears: 28, heightCm: 180, weightKg: 80, goalText: "增肌" });
  const after = await conversation.read({ kind: "conversation", userId: "new-user", conversationId: opened.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  const submittedCard = after.items.find((item) => item.card?.kind === "baseline")?.card;
  assert.deepEqual(submittedCard?.kind === "baseline" ? submittedCard.submitted : undefined, { ageYears: 28, heightCm: 180, weightKg: 80, goalText: "增肌" });
  assert.equal(after.items.some((item) => item.role === "user" && item.content.includes("我的目标是")), false);
});

test("a new conversation prefills the latest unsubmitted baseline draft from any earlier conversation", async () => {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn: (() => { throw new Error("not_called"); }) as unknown as StreamFn },
  });
  const first = await module.execute({ kind: "new", userId: "new-user" });
  assert.equal(first.kind, "opened");
  if (first.kind !== "opened") return;
  await module.execute({ kind: "save_baseline_draft", userId: "new-user", conversationId: first.conversation.id, draft: { ageYears: "28", heightCm: "180" } });
  await module.execute({ kind: "save_baseline_draft", userId: "new-user", conversationId: first.conversation.id, draft: { ageYears: "28", heightCm: "180", weightKg: "80" } });
  const second = await module.execute({ kind: "new", userId: "new-user" });
  assert.equal(second.kind, "opened");
  if (second.kind !== "opened") return;
  const projection = await module.read({ kind: "conversation", userId: "new-user", conversationId: second.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  // The revision continues the user's draft chain instead of restarting a fork.
  assert.deepEqual(projection.items.find((item) => item.form?.kind === "baseline")?.form?.draft, { ageYears: "28", heightCm: "180", weightKg: "80", revision: 2 });
  // Saving in the new conversation continues the same provenance chain.
  await module.execute({ kind: "save_baseline_draft", userId: "new-user", conversationId: second.conversation.id, draft: { ageYears: "29", heightCm: "180", weightKg: "80" } });
  const after = await module.read({ kind: "conversation", userId: "new-user", conversationId: second.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  assert.deepEqual(after.items.find((item) => item.form?.kind === "baseline")?.form?.draft, { ageYears: "29", heightCm: "180", weightKg: "80", revision: 3 });
});

test("an unfinished baseline stays a local durable draft and prefills after reopening the conversation", async () => {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn: (() => { throw new Error("not_called"); }) as unknown as StreamFn },
  });
  const opened = await module.execute({ kind: "new", userId: "new-user" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "save_baseline_draft", userId: "new-user", conversationId: opened.conversation.id, draft: { ageYears: "28", heightCm: "180", goalText: "先增肌" } });
  const restarted = new PiAgentConversationModule({ ledger, runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-restart-${++sequence}` }, pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn: (() => { throw new Error("not_called"); }) as unknown as StreamFn } });
  const projection = await restarted.read({ kind: "conversation", userId: "new-user", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.deepEqual(projection.items.find((item) => item.form?.kind === "baseline")?.form?.draft, { ageYears: "28", heightCm: "180", goalText: "先增肌", revision: 1 });
});

test("Pi writes a durable record-only choice card and the user resolves it in the same conversation", async () => {
  const call = assistant([{ type: "toolCall", id: "record-only", name: "coach.choose_record_only", arguments: {} }], "toolUse");
  const final = assistant([{ type: "text", text: "你可以先仅记录。" }], "stop");
  let callCount = 0;
  const streamFn = ((_model: Model<any>, _context: Context) => {
    callCount += 1;
    return callCount === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "你可以先仅记录。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    goals: { confirm: async () => { throw new Error("not_used"); } },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "我还不想设目标", clientTurnId: "turn-record-only" });
  await module.whenIdle(opened.conversation.id);
  const before = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(before.kind, "conversation");
  if (before.kind !== "conversation") return;
  const card = before.items.find((item) => item.kind === "choice");
  assert.ok(card);
  const resolved = await module.execute({ kind: "choose_record_only", userId: "user-1", conversationId: opened.conversation.id, cardId: card!.id });
  assert.equal(resolved.kind, "record_only_selected");
  const after = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  assert.equal(after.items.some((item) => item.card?.kind === "receipt" && item.card.label === "仅记录"), true);
});

test("a structured plan candidate is validated behind a durable confirmation card", async () => {
  const call = assistant([{ type: "toolCall", id: "plan-candidate", name: "plan.propose_current_stage", arguments: { candidate: { planRevision: {}, nutritionStrategy: {}, behaviorChanges: [{ id: "step-1", instruction: "先减少 20% 零食", burden: "low", preferenceRefs: [] }], rationale: ["从当前行为开始"], expectedTradeoffs: ["进度更慢但可持续"] } } }], "toolUse");
  const final = assistant([{ type: "text", text: "候选已准备好。" }], "stop");
  let callCount = 0;
  const streamFn = ((_model: Model<any>, _context: Context) => {
    callCount += 1;
    return callCount === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "候选已准备好。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  let confirmed = false;
  let rejected = false;
  await commitProfile(ledger, "user-1");
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    planning: {
      readInput: async () => ({}),
      estimateMuscleLoad: async () => ({ policy: { id: "test", version: "0" }, perMuscle: [], unknownExercises: [] }),
      forecastRecovery: async () => ({ policy: { id: "test", version: "0" }, start: { status: "insufficient_history" as const, policy: { id: "test", version: "0" }, evaluatedAt: "2026-08-16", muscles: [], disclaimer: "group_mean_with_individual_signal_adjustment" as const }, days: [] }),
      propose: async () => ({
        status: "ready",
        proposalId: "proposal-1",
        title: "当前阶段计划候选",
        summary: ["固定验证通过"],
        details: {
          sessions: [{ date: "2026-08-17", title: "上肢训练", taskCount: 4, setCount: 12, durationMinutes: 50 }],
          nutrition: { calorieRange: { min: 2200, max: 2400, unit: "kcal" }, macronutrients: ["蛋白质 130–160 g"] },
          behaviorChanges: [{ instruction: "先减少 20% 零食", burden: "low" }],
          rationale: ["从当前行为开始"],
          tradeoffs: ["进度更慢但可持续"],
          observation: ["最少观察 7 天"],
          diff: ["建立首个当前阶段计划"],
          validation: { status: "valid", impact: "low", resolution: "confirmation_required", issues: [], advisories: [] },
        },
      }),
      confirm: async () => { confirmed = true; },
      reject: async () => { rejected = true; },
    },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "给我一个阶段计划", clientTurnId: "turn-plan" });
  await module.whenIdle(opened.conversation.id);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const card = projection.items.find((item) => item.card?.kind === "plan_candidate");
  assert.ok(card);
  assert.deepEqual(card?.card?.kind === "plan_candidate" ? card.card.details?.sessions : undefined, [{ date: "2026-08-17", title: "上肢训练", taskCount: 4, setCount: 12, durationMinutes: 50 }]);
  const storedCard = (await ledger.read()).artifacts.find((artifact) => artifact.id === card!.id);
  assert.deepEqual(storedCard?.kind === "evidence_brief" ? storedCard.conversationTrace : undefined, { sessionId: opened.conversation.id, runId: expectString(storedCard?.kind === "evidence_brief" ? storedCard.conversationTrace?.runId : undefined), toolCallId: "plan-candidate" });
  const cardCreatedAt = storedCard?.createdAt;
  await module.execute({ kind: "resolve_plan_candidate", userId: "user-1", conversationId: opened.conversation.id, cardId: card!.id, decision: "reject" });
  assert.equal(confirmed, false);
  assert.equal(rejected, true);
  const confirmedProjection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(confirmedProjection.kind, "conversation");
  if (confirmedProjection.kind !== "conversation") return;
  const planCards = confirmedProjection.items.filter((item) => item.card?.kind === "plan_candidate");
  assert.equal(planCards.length, 1);
  assert.equal(planCards[0]?.card?.kind === "plan_candidate" ? planCards[0].card.status : undefined, "rejected");
  const confirmedStoredCard = (await ledger.read()).artifacts.find((artifact) => artifact.id === card!.id);
  assert.equal(confirmedStoredCard?.kind === "evidence_brief" ? confirmedStoredCard.conversationTrace?.toolCallId : undefined, "plan-candidate");
  assert.equal(confirmedStoredCard?.createdAt, cardCreatedAt);
});

test("a factual invalidation makes the original conversation plan card non-actionable in place", async () => {
  const call = assistant([{ type: "toolCall", id: "stale-plan-candidate", name: "plan.propose_current_stage", arguments: { candidate: { planRevision: {}, nutritionStrategy: {}, behaviorChanges: [{ id: "step-1", instruction: "保留晚餐，先减少零食频率", burden: "low", preferenceRefs: [] }], rationale: ["从当前习惯开始"], expectedTradeoffs: ["变化较慢但更容易坚持"] } } }], "toolUse");
  const final = assistant([{ type: "text", text: "候选已准备好。" }], "stop");
  let calls = 0;
  const streamFn = (() => {
    calls += 1;
    return calls === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "候选已准备好。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  await commitProfile(ledger, "user-1");
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    planning: {
      readInput: async () => ({}),
      estimateMuscleLoad: async () => ({ policy: { id: "test", version: "0" }, perMuscle: [], unknownExercises: [] }),
      forecastRecovery: async () => ({ policy: { id: "test", version: "0" }, start: { status: "insufficient_history" as const, policy: { id: "test", version: "0" }, evaluatedAt: "2026-08-16", muscles: [], disclaimer: "group_mean_with_individual_signal_adjustment" as const }, days: [] }),
      propose: async () => ({ status: "ready" as const, proposalId: "proposal-stale", title: "当前阶段计划候选", summary: ["固定验证通过"], evidenceRefs: [{ aggregate: "timeline", id: "timeline.user-1", revision: 3 }] }),
      confirm: async () => undefined,
      reject: async () => undefined,
    },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "请给我一个阶段计划", clientTurnId: "turn-stale" });
  await module.whenIdle(opened.conversation.id);
  const before = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(before.kind, "conversation");
  if (before.kind !== "conversation") return;
  const item = before.items.find((candidate) => candidate.card?.kind === "plan_candidate");
  assert.ok(item);
  const presentation = (await ledger.read()).presentations.find((candidate) => candidate.artifactId === item!.id);
  assert.ok(presentation);
  await ledger.commit({
    kind: "domain", userId: "user-1", actorId: "fixed-engine", intent: "test.timeline_correction",
    expectedRevisions: [], domainEvents: [],
    presentations: [{ ...presentation!, status: "stale" }],
    idempotencyKey: "test.stale.plan-card", recordedAt: "2026-08-16T08:02:00.000Z",
  });
  const after = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  const invalidated = after.items.find((candidate) => candidate.id === item!.id);
  assert.equal(invalidated?.card?.kind === "plan_candidate" ? invalidated.card.status : undefined, "stale");
  assert.equal(invalidated?.state, "failed");
});

function expectString(value: string | undefined): string {
  assert.equal(typeof value, "string");
  return value!;
}

test("explicit nutrition values are recorded without food inference and receive a durable receipt", async () => {
  const call = assistant([{ type: "toolCall", id: "nutrition", name: "timeline.record_explicit", arguments: { kind: "nutrition", mealDescription: "包装标签", nutrients: [{ nutrientId: "energy", value: 420, unit: "kcal", source: "manually_transcribed_label" }], dayCoverage: "partial" } }], "toolUse");
  const final = assistant([{ type: "text", text: "已记录。" }], "stop");
  let callCount = 0;
  const streamFn = ((_model: Model<any>, _context: Context) => {
    callCount += 1;
    return callCount === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "已记录。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const writes: unknown[] = [];
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    records: { recordBodyWeight: async () => undefined, recordExplicit: async (record) => { writes.push(record); return { label: "营养显式数值" }; } },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "标签写了 420 千卡", clientTurnId: "turn-nutrition" });
  await module.whenIdle(opened.conversation.id);
  assert.deepEqual(writes, []);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const confirmation = projection.items.find((item) => item.card?.kind === "record_confirmation");
  assert.ok(confirmation);
  await module.execute({ kind: "resolve_record", userId: "user-1", conversationId: opened.conversation.id, cardId: confirmation!.id, decision: "confirm" });
  assert.deepEqual(writes, [{ kind: "nutrition", userId: "user-1", nutrients: [{ nutrientId: "energy", value: 420, unit: "kcal", source: "manually_transcribed_label" }], mealDescription: "包装标签", dayCoverage: "partial", occurredAt: "2026-08-16T08:00:00.000Z", idempotencyKey: "conversation:conversation-1:record:nutrition" }]);
});

test("an Agent training report keeps an explicit execution outcome instead of treating missing logs as failure", async () => {
  const call = assistant([{ type: "toolCall", id: "training-missed", name: "timeline.record_explicit", arguments: { kind: "training", executionStatus: "missed", summary: "本周原定训练没有完成" } }], "toolUse");
  const final = assistant([{ type: "text", text: "我已把这次未完成作为明确记录，先不把未记录的日子算进去。" }], "stop");
  let callCount = 0;
  const streamFn = (() => {
    callCount += 1;
    return callCount === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "我已把这次未完成作为明确记录，先不把未记录的日子算进去。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const writes: unknown[] = [];
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    records: { recordBodyWeight: async () => undefined, recordExplicit: async (record) => { writes.push(record); return { label: "训练记录" }; } },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "我没完成这周训练", clientTurnId: "turn-training" });
  await module.whenIdle(opened.conversation.id);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const confirmation = projection.items.find((item) => item.card?.kind === "record_confirmation");
  assert.ok(confirmation);
  await module.execute({ kind: "resolve_record", userId: "user-1", conversationId: opened.conversation.id, cardId: confirmation!.id, decision: "confirm" });
  assert.deepEqual(writes, [{ kind: "training", userId: "user-1", executionStatus: "missed", summary: "本周原定训练没有完成", occurredAt: "2026-08-16T08:00:00.000Z", idempotencyKey: "conversation:conversation-1:record:training-missed" }]);
});

test("an Agent correction stays in the thread and cannot bypass the explicit confirmation card", async () => {
  const call = assistant([{ type: "toolCall", id: "correct-weight", name: "timeline.correct_explicit", arguments: { targetEventId: "timeline-entry-1", reason: "刚才单位填错了", replacement: { kind: "body_weight", valueKg: 75 } } }], "toolUse");
  const final = assistant([{ type: "text", text: "我已把更正放在确认卡里。" }], "stop");
  let callCount = 0;
  const streamFn = (() => {
    callCount += 1;
    return callCount === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "我已把更正放在确认卡里。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const corrections: unknown[] = [];
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    records: {
      recordBodyWeight: async () => undefined,
      recordExplicit: async () => ({ label: "unused" }),
      correctExplicit: async (correction) => { corrections.push(correction); return { label: "已更正正式记录" }; },
    },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "刚才体重写错了，改成 75 公斤", clientTurnId: "turn-correct" });
  await module.whenIdle(opened.conversation.id);
  assert.deepEqual(corrections, []);
  const before = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(before.kind, "conversation");
  if (before.kind !== "conversation") return;
  const confirmation = before.items.find((item) => item.card?.kind === "record_confirmation");
  assert.ok(confirmation);
  await module.execute({ kind: "resolve_record", userId: "user-1", conversationId: opened.conversation.id, cardId: confirmation!.id, decision: "confirm" });
  assert.deepEqual(corrections, [{
    kind: "correction", userId: "user-1", correctsEventId: "timeline-entry-1", reason: "刚才单位填错了",
    replacement: { kind: "body_weight", userId: "user-1", valueKg: 75, occurredAt: "2026-08-16T08:00:00.000Z", idempotencyKey: "conversation:conversation-1:correction:correct-weight:replacement" },
    occurredAt: "2026-08-16T08:00:00.000Z", idempotencyKey: "conversation:conversation-1:correction:correct-weight",
  }]);
});

test("only a material fixed GoalPath signal starts Pi work, and the same signal is deduplicated", async () => {
  const planningCall = assistant([{ type: "toolCall", id: "signal-planning-input", name: "plan.read_fixed_input", arguments: {} }], "toolUse");
  const final = assistant([{ type: "text", text: "我会先根据固定证据复核，再决定是否需要调整。" }], "stop");
  let streamCount = 0;
  const streamFn = (() => {
    streamCount += 1;
    return streamCount === 1
      ? stream([{ type: "start", partial: planningCall }, { type: "toolcall_end", contentIndex: 0, toolCall: planningCall.content[0] as never, partial: planningCall }, { type: "done", reason: "toolUse", message: planningCall }], planningCall)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "我会先根据固定证据复核，再决定是否需要调整。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  let sequence = 0;
  let sourceAssessmentId: string | undefined;
  const module = new PiAgentConversationModule({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    signals: { latestMaterial: async () => ({ id: "goal-path:1", state: "at_risk" as const, diagnosis: "goal_plan_mismatch" as const, materialSignal: "review_recommended" as const, reasonCodes: ["deadline_tempo_insufficient"], nextValidationSignals: ["body_weight"] }) },
    planning: { readInput: async (input) => { sourceAssessmentId = input.sourceAssessmentId; return { sourceAssessmentId: input.sourceAssessmentId }; }, propose: async () => ({ status: "invalid", title: "unused", summary: [] }), confirm: async () => undefined, reject: async () => undefined, estimateMuscleLoad: async () => ({ policy: { id: "test", version: "0" }, perMuscle: [], unknownExercises: [] }), forecastRecovery: async () => ({ policy: { id: "test", version: "0" }, start: { status: "insufficient_history", policy: { id: "test", version: "0" }, evaluatedAt: "2026-08-16", muscles: [], disclaimer: "group_mean_with_individual_signal_adjustment" as const }, days: [] }) },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  const first = await module.execute({ kind: "reconcile", userId: "user-1", conversationId: opened.conversation.id, causationId: "timeline:1" });
  assert.equal(first.kind, "signal_started");
  await module.whenIdle(opened.conversation.id);
  assert.equal(sourceAssessmentId, "goal-path:1");
  const duplicate = await module.execute({ kind: "reconcile", userId: "user-1", conversationId: opened.conversation.id, causationId: "timeline:1" });
  assert.equal(duplicate.kind, "stopped");
  const second = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(second.kind, "opened");
  if (second.kind !== "opened") return;
  const crossConversationDuplicate = await module.execute({ kind: "reconcile", userId: "user-1", conversationId: second.conversation.id, causationId: "app-open" });
  assert.equal(crossConversationDuplicate.kind, "stopped");
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.items.some((item) => item.card?.kind === "receipt" && item.card.detail === "signal:goal-path:1"), true);
});

test("a background material Signal finds or creates one conversation only after the fixed gate passes", async () => {
  const final = assistant([{ type: "text", text: "固定检查发现需要一起复核。" }], "stop");
  let sequence = 0;
  let material = false;
  let providerCalls = 0;
  const ledger = new InMemoryCoachLedger();
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn: (() => { providerCalls += 1; return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "固定检查发现需要一起复核。", partial: final }, { type: "done", reason: "stop", message: final }], final); }) as unknown as StreamFn },
    signals: { latestMaterial: async () => material ? { id: "goal-path:background", state: "at_risk" as const, diagnosis: "execution_failure" as const, materialSignal: "review_recommended" as const, reasonCodes: ["execution_shortfall"], nextValidationSignals: ["completed_training"] } : undefined },
  });
  const quiet = await module.execute({ kind: "reconcile", userId: "user-1", causationId: "daily-quiet" });
  assert.equal(quiet.kind, "stopped");
  const quietHistory = await module.read({ kind: "history", userId: "user-1" });
  assert.equal(quietHistory.kind, "history");
  if (quietHistory.kind !== "history") return;
  assert.equal(quietHistory.conversations.length, 0);
  assert.equal(providerCalls, 0);
  material = true;
  const started = await module.execute({ kind: "reconcile", userId: "user-1", causationId: "daily-material" });
  assert.equal(started.kind, "signal_started");
  if (started.kind !== "signal_started") return;
  await module.whenIdle(started.conversationId);
  assert.equal(providerCalls, 1);
  const history = await module.read({ kind: "history", userId: "user-1" });
  assert.equal(history.kind, "history");
  if (history.kind !== "history") return;
  assert.equal(history.conversations.length, 1);
  const duplicate = await module.execute({ kind: "reconcile", userId: "user-1", causationId: "daily-material-retry" });
  assert.equal(duplicate.kind, "stopped");
  assert.equal(providerCalls, 1);
});

test("a run orphaned by process death becomes an explicit interrupted state with its partial content intact", async () => {
  // A provider stream that never completes simulates death mid-stream.
  const hanging = assistant([], "aborted");
  const streamFn = (() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: hanging } as AssistantMessageEvent;
      await new Promise<void>(() => undefined);
    },
    result: async () => hanging,
  })) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const crashed = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
  });
  const opened = await crashed.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await crashed.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "分析我的趋势", clientTurnId: "turn-crash" });
  // The process "dies" here: no dispose, no whenIdle, the Pi agent is abandoned.

  const restarted = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:05:00.000Z", nextId: (prefix: string) => `${prefix}-r-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
  });
  const reopened = await restarted.execute({ kind: "open", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(reopened.kind, "opened");
  const projection = await restarted.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.run?.status, "interrupted");
  assert.equal(projection.run?.terminalCode, "interrupted_after_restart");
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "本轮在关闭应用后中断"));
  // The orphan run never blocks the next message.
  const final = assistant([{ type: "text", text: "我们继续。" }], "stop");
  const recovered = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:06:00.000Z", nextId: (prefix: string) => `${prefix}-r2-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn: (() => stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "我们继续。", partial: final }, { type: "done", reason: "stop", message: final }], final)) as unknown as StreamFn },
  });
  const sent = await recovered.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "继续", clientTurnId: "turn-after-crash" });
  assert.equal(sent.kind, "started");
  await recovered.whenIdle(opened.conversation.id);
  const after = await recovered.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  assert.equal(after.run?.status, "completed");
});

test("an orderly app dispose terminates the active run durably as app_disposed", async () => {
  const hanging = assistant([], "aborted");
  const streamFn = (() => ({
    async *[Symbol.asyncIterator]() {
      yield { type: "start", partial: hanging } as AssistantMessageEvent;
      await new Promise<void>(() => undefined);
    },
    result: async () => hanging,
  })) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "开始分析", clientTurnId: "turn-dispose" });
  await module.dispose();
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.run?.status, "interrupted");
  assert.equal(projection.run?.terminalCode, "app_disposed");
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "本轮在关闭应用后中断"));
});

test("a validation-failed plan card stays visibly invalid, never disguised as stale", async () => {
  const call = assistant([{ type: "toolCall", id: "bad-candidate", name: "plan.propose_current_stage", arguments: { candidate: { planRevision: {}, nutritionStrategy: {}, behaviorChanges: [{ id: "s1", instruction: "先保持现状", burden: "low", preferenceRefs: [] }], rationale: ["依据"], expectedTradeoffs: ["代价"] } } }], "toolUse");
  const final = assistant([{ type: "text", text: "候选未通过校验。" }], "stop");
  let calls = 0;
  const streamFn = (() => {
    calls += 1;
    return calls === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "候选未通过校验。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  await commitProfile(ledger, "user-1");
  const module = new PiAgentConversationModule({
    ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000Z", nextId: (prefix: string) => `${prefix}-${++sequence}` },
    pi: { model: { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>, streamFn },
    planning: {
      readInput: async () => ({}),
      estimateMuscleLoad: async () => ({ policy: { id: "test", version: "0" }, perMuscle: [], unknownExercises: [] }),
      forecastRecovery: async () => ({ policy: { id: "test", version: "0" }, start: { status: "insufficient_history" as const, policy: { id: "test", version: "0" }, evaluatedAt: "2026-08-16", muscles: [], disclaimer: "group_mean_with_individual_signal_adjustment" as const }, days: [] }),
      propose: async () => ({ status: "invalid" as const, title: "计划候选未通过固定校验", summary: ["stimulus_slot_prescription_missing: 每个刺激槽位必须带固定训练剂量"] }),
      confirm: async () => undefined,
      reject: async () => undefined,
    },
    ...allowAllConversationCapabilities,
  });
  const opened = await module.execute({ kind: "new", userId: "user-1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await module.execute({ kind: "send", userId: "user-1", conversationId: opened.conversation.id, text: "给我一个阶段计划", clientTurnId: "turn-invalid" });
  await module.whenIdle(opened.conversation.id);
  const projection = await module.read({ kind: "conversation", userId: "user-1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const card = projection.items.find((item) => item.card?.kind === "plan_candidate");
  assert.ok(card);
  assert.equal(card?.card?.kind === "plan_candidate" ? card.card.status : undefined, "invalid");
  assert.equal(card?.state, "failed");
  const presentation = (await ledger.read()).presentations.find((candidate) => candidate.artifactId === card!.id);
  assert.equal(presentation?.status, "error", "校验失败不是事实过期：presentation 必须是 error 而不是 stale");
});
