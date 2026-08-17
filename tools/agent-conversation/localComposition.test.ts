import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";

/**
 * Production-composition conversation tests: real LocalProductKernel, real
 * RecordModule and the real local adapters, with only the provider stream
 * replaced by a deterministic script (the same seam the mobile runtime uses).
 */

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

const MODEL = { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>;

function createProductionComposition(streamFn: StreamFn) {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
  let conversation!: PiAgentConversationModule;
  const kernel = new LocalProductKernel({
    ledger,
    runtime,
    afterFixedGoalPathReview: async ({ userId, causationId }) => {
      await conversation.execute({ kind: "reconcile", userId, causationId });
    },
  });
  const records = new RecordModule({
    createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
    confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
    createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
    confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
    correctTimelineFact: (input) => kernel.correctTimelineFact(input),
  });
  conversation = new PiAgentConversationModule({
    ledger,
    runtime,
    pi: { model: MODEL, streamFn },
    ...createLocalConversationAdapters({ kernel, records }),
  });
  return { ledger, kernel, records, conversation };
}

async function bootstrapUser(kernel: LocalProductKernel, userId: string): Promise<void> {
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId, actor: { kind: "user", id: userId }, deviceId: "composition-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap:${userId}` },
    profile: { id: `profile:${userId}`, locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: `mandate:${userId}`, mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}

test("a quiet fixed review never reaches the provider; a delivered hard-safety signal does, exactly once", async () => {
  let providerCalls = 0;
  const prompts: string[] = [];
  const final = assistant([{ type: "text", text: "这是需要你立即关注的安全信号，我们先暂停相关安排。" }], "stop");
  const streamFn = ((_model: Model<any>, context: { messages?: readonly { role?: unknown; content?: unknown }[] }) => {
    providerCalls += 1;
    const system = (context as { systemPrompt?: string }).systemPrompt ?? "";
    prompts.push(system + JSON.stringify(context.messages ?? []));
    return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "这是需要你立即关注的安全信号，我们先暂停相关安排。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const { kernel, records, conversation } = createProductionComposition(streamFn);
  await bootstrapUser(kernel, "u1");

  // A quiet daily check leaves a light audit only: no conversation, no Provider.
  await kernel.runDailyGoalPathReview({ userId: "u1", idempotencyKey: "daily:2026-08-16", timezoneOffsetMinutes: 480 });
  assert.equal(providerCalls, 0);
  const quietHistory = await conversation.read({ kind: "history", userId: "u1" });
  assert.equal(quietHistory.kind, "history");
  if (quietHistory.kind !== "history") return;
  assert.equal(quietHistory.conversations.length, 0);

  // A confirmed high-severity pain report is a formal Record.  The post-commit
  // fixed review delivers a hard-safety assessment, which must reach the same
  // conversation ingress as any other material signal.
  await records.recordFact({
    userId: "u1",
    idempotencyKey: "pain-1",
    occurredAt: "2026-08-16T07:30:00.000+08:00",
    source: "user_statement",
    fact: { kind: "symptom", symptom: "pain", area: "lower_back", severity: 8, confidence: "confirmed" },
  });
  const history = await conversation.read({ kind: "history", userId: "u1" });
  assert.equal(history.kind, "history");
  if (history.kind !== "history") return;
  assert.equal(history.conversations.length, 1);
  const conversationId = history.conversations[0]!.id;
  await conversation.whenIdle(conversationId);
  assert.equal(providerCalls, 1);
  assert.ok(prompts[0]?.includes("confirmed_high_severity_pain"), prompts[0]);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.detail?.startsWith("signal:")));
  assert.equal(projection.run?.status, "completed");

  // The same signal never starts duplicate Provider work, however often the
  // daily check or a post-commit hook reconciles again.
  await kernel.runDailyGoalPathReview({ userId: "u1", idempotencyKey: "daily:2026-08-16:retry", timezoneOffsetMinutes: 480 });
  await conversation.execute({ kind: "reconcile", userId: "u1", causationId: "manual-recheck" });
  assert.equal(providerCalls, 1);
});

function scriptedToolThenText(toolName: string, toolArguments: Record<string, unknown>, reply: string) {
  const call = assistant([{ type: "toolCall", id: `call-${toolName}`, name: toolName, arguments: toolArguments }], "toolUse");
  const final = assistant([{ type: "text", text: reply }], "stop");
  let count = 0;
  const requests: unknown[] = [];
  const streamFn = ((_model: Model<any>, context: unknown) => {
    requests.push(context);
    count += 1;
    return count === 1
      ? stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call)
      : stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: reply, partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  return { streamFn, requests };
}

test("a conversational record flows through the production adapters into the formal Timeline only after confirmation", async () => {
  const { streamFn } = scriptedToolThenText("timeline.record_explicit", { kind: "body_weight", valueKg: 75.4 }, "我把这条体重放在确认卡里。");
  const { kernel, conversation } = createProductionComposition(streamFn);
  await bootstrapUser(kernel, "u1");
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "今早体重 75.4 公斤", clientTurnId: "turn-weight" });
  await conversation.whenIdle(opened.conversation.id);
  // Staged, not written: the fixed confirmation boundary owns admission.
  let domain = await kernel.readDomainProjection({ userId: "u1" });
  assert.equal(domain.timeline.current.length, 0);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const confirmation = projection.items.find((item) => item.card?.kind === "record_confirmation");
  assert.ok(confirmation, JSON.stringify(projection.items.map((item) => item.card?.kind)));
  await conversation.execute({ kind: "resolve_record", userId: "u1", conversationId: opened.conversation.id, cardId: confirmation!.id, decision: "confirm" });
  domain = await kernel.readDomainProjection({ userId: "u1" });
  assert.equal(domain.timeline.current.length, 1);
  const fact = domain.timeline.current[0]!.fact;
  assert.equal(fact.kind, "body");
  assert.equal(fact.kind === "body" && fact.measurement.metric === "body_weight" ? fact.measurement.quantity.value : undefined, 75.4);
  // The receipt stays readable after a full process reconstruction.
  const restarted = new PiAgentConversationModule({
    ledger: (conversation as never as { dependencies: { ledger: InMemoryCoachLedger } }).dependencies.ledger,
    runtime: { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-restart` },
    pi: { model: MODEL, streamFn: (() => { throw new Error("not_called"); }) as unknown as StreamFn },
    ...createLocalConversationAdapters({ kernel, records: new RecordModule({
      createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
      confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
      createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
      confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
      correctTimelineFact: (input) => kernel.correctTimelineFact(input),
    }) }),
  });
  const recovered = await restarted.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(recovered.kind, "conversation");
  if (recovered.kind !== "conversation") return;
  const confirmedCard = recovered.items.find((item) => item.card?.kind === "record_confirmation");
  assert.equal(confirmedCard?.card?.kind === "record_confirmation" ? confirmedCard.card.status : undefined, "confirmed");
});

test("a delegated recording mandate writes an explicit statement immediately with an in-place receipt", async () => {
  const { streamFn } = scriptedToolThenText("timeline.record_explicit", { kind: "body_weight", valueKg: 75.4 }, "已记录。");
  const { kernel, conversation } = createProductionComposition(streamFn);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "composition-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "managed", planChangeAuthorization: "always_ask", scopes: { loadReps: "confirm", volume: "confirm", substitution: "confirm", schedule: "confirm", deload: "confirm", nutrition: "confirm", recording: "delegated" } },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "今早体重 75.4 公斤", clientTurnId: "turn-delegated" });
  await conversation.whenIdle(opened.conversation.id);
  const domain = await kernel.readDomainProjection({ userId: "u1" });
  assert.equal(domain.timeline.current.length, 1, "delegated mandate writes without a second confirmation");
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "体重"));
  assert.equal(projection.items.some((item) => item.card?.kind === "record_confirmation"), false);
});

test("a capability-narrowed run blocks a forged goal tool call and never writes", async () => {
  const { streamFn } = scriptedToolThenText("goal.propose_path", { primaryGoal: "hypertrophy", targetWeeks: 12, targetWeightKg: 80 }, "我需要先了解你的基础信息。");
  const { kernel, conversation } = createProductionComposition(streamFn);
  // No bootstrap at all: without a confirmed profile the goal capability is
  // unavailable, so the model's forged proposal must never become a card or a
  // Goal contract.
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "直接给我一个增肌目标", clientTurnId: "turn-denied" });
  await conversation.whenIdle(opened.conversation.id);
  const domain = await kernel.readDomainProjection({ userId: "u1" });
  assert.equal(domain.goalContract, undefined, "a blocked tool call can never become a Goal contract");
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.items.some((item) => item.card?.kind === "goal_path"), false);
});

test("confirmed facts outrank working memory in the assembled agent context", async () => {
  const { streamFn, requests } = scriptedToolThenText("coach.read_context", {}, "我已核对当前档案。");
  const { kernel, conversation } = createProductionComposition(streamFn);
  await bootstrapUser(kernel, "u1");
  await kernel.upsertMemory({
    userId: "u1", actor: "agent",
    kind: "strategy_note", content: "用户上次提到体重大约 90kg", evidenceRefs: [], confidence: 0.4, sensitivity: "private", idempotencyKey: "memory:weight-claim",
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "我的当前体重是多少", clientTurnId: "turn-authority" });
  await conversation.whenIdle(opened.conversation.id);
  assert.equal(requests.length, 2);
  const followUp = requests[1] as { messages?: readonly { role?: unknown; content?: unknown }[] };
  const toolResult = followUp.messages?.find((message) => message.role === "toolResult");
  assert.ok(toolResult, JSON.stringify(followUp.messages?.map((message) => message.role)));
  const blocks = toolResult.content as readonly { type?: string; text?: string }[];
  const text = Array.isArray(blocks) ? blocks.find((block) => block.type === "text")?.text : undefined;
  assert.ok(text, JSON.stringify(toolResult.content).slice(0, 200));
  const context = JSON.parse(text) as {
    profile?: { demographics?: { currentWeight?: { value?: number } } };
    workingMemory?: readonly { text?: string }[];
    authorityOrder?: readonly string[];
  };
  assert.equal(context.profile?.demographics?.currentWeight?.value, 75, "权威档案体重不受记忆内容影响");
  assert.ok(context.workingMemory?.some((item) => item.text?.includes("90kg")), "记忆保留但降权呈现");
  assert.equal(context.authorityOrder?.[0], "confirmed_domain_facts");
});

test("a nutrition record without explicit structured values is rejected before any card or write", async () => {
  // 行为级精度：纯描述（无数值）是合法的「描述性观察」——入确认卡、确认后落账、永远零数值。
  const { streamFn } = scriptedToolThenText("timeline.record_explicit", { kind: "nutrition", mealDescription: "一碗牛肉面" }, "已记下这餐。");
  const { kernel, records, conversation } = createProductionComposition(streamFn);
  await bootstrapUser(kernel, "u1");
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "中午吃了一碗牛肉面", clientTurnId: "turn-food-name" });
  await conversation.whenIdle(opened.conversation.id);
  let projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  if (projection.kind !== "conversation") return;
  const card = projection.items.find((item) => item.card?.kind === "record_confirmation" && item.card.status === "awaiting_confirmation");
  assert.ok(card, "描述性记录应进确认卡");
  await conversation.execute({ kind: "resolve_record", userId: "u1", conversationId: opened.conversation.id, cardId: card!.id, decision: "confirm" });
  const domain = await kernel.readDomainProjection({ userId: "u1" });
  const meal = domain.timeline.current.find((event) => event.fact.kind === "nutrition");
  assert.ok(meal, "确认后描述性观察落 Timeline");
  if (meal?.fact.kind === "nutrition") {
    assert.equal(meal.fact.observationMode, "descriptive");
    assert.equal((meal.fact.nutrients ?? []).length, 0, "描述性观察永不含数值——食物名称不推断营养");
  }
  // 完全没有内容（无数值且无描述）在模块参数层拒绝，不落卡
  const emptyStream = scriptedToolThenText("timeline.record_explicit", { kind: "nutrition" }, "没有可记录的内容。");
  const emptyComp = createProductionComposition(emptyStream.streamFn);
  await bootstrapUser(emptyComp.kernel, "u2");
  const opened2 = await emptyComp.conversation.execute({ kind: "new", userId: "u2" });
  if (opened2.kind !== "opened") return;
  await emptyComp.conversation.execute({ kind: "send", userId: "u2", conversationId: opened2.conversation.id, text: "记一下", clientTurnId: "turn-empty" });
  await emptyComp.conversation.whenIdle(opened2.conversation.id);
  const projection2 = await emptyComp.conversation.read({ kind: "conversation", userId: "u2", conversationId: opened2.conversation.id });
  if (projection2.kind !== "conversation") return;
  assert.equal(projection2.items.some((item) => item.card?.kind === "record_confirmation"), false, "空内容不得产生确认卡");
  // Mixed nutrient provenance is rejected at the production adapter boundary.
  const mixedSource = createLocalConversationAdapters({ kernel, records }).records?.recordExplicit?.({
    kind: "nutrition", userId: "u1", occurredAt: "2026-08-16T12:00:00.000+08:00", idempotencyKey: "mixed-source",
    nutrients: [
      { nutrientId: "energy", value: 500, unit: "kcal", source: "current_user_statement" },
      { nutrientId: "protein", value: 30, unit: "g", source: "manually_transcribed_label" },
    ],
  });
  await assert.rejects(
    mixedSource ?? Promise.reject(new Error("adapter_missing")),
    (cause: unknown) => cause instanceof Error && cause.message === "nutrition_source_must_be_uniform",
  );
});

test("manual and conversational entries admit equivalent facts while only the Agent path leaves a conversation trace", async () => {
  const { streamFn } = scriptedToolThenText("timeline.record_explicit", { kind: "body_weight", valueKg: 80 }, "已记录。");
  const { kernel, records, conversation } = createProductionComposition(streamFn);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "composition-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "managed", planChangeAuthorization: "always_ask", scopes: { loadReps: "confirm", volume: "confirm", substitution: "confirm", schedule: "confirm", deload: "confirm", nutrition: "confirm", recording: "delegated" } },
  });
  // Manual entry: the same RecordModule the record drawer uses.
  await records.recordFact({
    userId: "u1", idempotencyKey: "manual-weight", occurredAt: "2026-08-16T07:00:00.000+08:00", source: "manual_form",
    fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" }, condition: "manual" }, confidence: "confirmed" },
  });
  let ledgerSnapshot = await (conversation as never as { dependencies: { ledger: InMemoryCoachLedger } }).dependencies.ledger.read();
  assert.equal(ledgerSnapshot.messages.length, 0, "手动操作不产生伪造的 Agent 消息");
  assert.equal(ledgerSnapshot.toolCalls.length, 0, "手动操作不产生伪造的 Tool Activity");
  // Conversational entry for the same measurement.
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "体重 80 公斤", clientTurnId: "turn-equiv" });
  await conversation.whenIdle(opened.conversation.id);
  const domain = await kernel.readDomainProjection({ userId: "u1" });
  const weights = domain.timeline.current.map((event) => event.fact)
    .filter((fact) => fact.kind === "body" && fact.measurement.metric === "body_weight");
  assert.equal(weights.length, 2);
  for (const fact of weights) {
    assert.equal(fact.kind === "body" && fact.measurement.metric === "body_weight" ? fact.measurement.quantity.value : undefined, 80);
    assert.equal(fact.confidence, "confirmed");
  }
  ledgerSnapshot = await (conversation as never as { dependencies: { ledger: InMemoryCoachLedger } }).dependencies.ledger.read();
  const agentCalls = ledgerSnapshot.toolCalls.filter((call) => call.sessionId === opened.conversation.id);
  assert.equal(agentCalls.length, 1);
  assert.equal(agentCalls[0]!.toolName, "timeline.record_explicit");
});

test("a signal found by a background review without Pi ingress surfaces on the next foreground reconcile", async () => {
  // Background worker shape: the kernel runs the fixed review with NO
  // conversation ingress attached.
  const quietLedger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
  const kernel = new LocalProductKernel({ ledger: quietLedger, runtime });
  await bootstrapUser(kernel, "u1");
  const records = new RecordModule({
    createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
    confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
    createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
    confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
    correctTimelineFact: (input) => kernel.correctTimelineFact(input),
  });
  await records.recordFact({
    userId: "u1", idempotencyKey: "pain-bg", occurredAt: "2026-08-16T07:30:00.000+08:00", source: "user_statement",
    fact: { kind: "symptom", symptom: "pain", area: "lower_back", severity: 8, confidence: "confirmed" },
  });
  const background = await kernel.readGoalPathAssessmentArtifacts({ userId: "u1" });
  assert.ok(background.some((artifact) => artifact.goalPathAssessment?.assessment.materialSignal === "hard_safety" && artifact.goalPathAssessment.delivery !== "suppressed"));

  // Foreground startup: the conversation runtime is assembled over the same
  // Ledger and reconciles the durable signal exactly once.
  let providerCalls = 0;
  const final = assistant([{ type: "text", text: "安全优先，我们先调整。" }], "stop");
  const streamFn = (() => {
    providerCalls += 1;
    return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: "安全优先，我们先调整。", partial: final }, { type: "done", reason: "stop", message: final }], final);
  }) as unknown as StreamFn;
  const conversation = new PiAgentConversationModule({
    ledger: quietLedger,
    runtime,
    pi: { model: MODEL, streamFn },
    ...createLocalConversationAdapters({ kernel, records }),
  });
  const started = await conversation.execute({ kind: "reconcile", userId: "u1", causationId: "foreground-startup" });
  assert.equal(started.kind, "signal_started");
  if (started.kind !== "signal_started") return;
  await conversation.whenIdle(started.conversationId);
  assert.equal(providerCalls, 1);
  const again = await conversation.execute({ kind: "reconcile", userId: "u1", causationId: "foreground-startup-2" });
  assert.equal(again.kind, "stopped");
  assert.equal(providerCalls, 1);
});
