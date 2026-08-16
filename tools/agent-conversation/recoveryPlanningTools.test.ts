import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";

/** 恢复感知工具的对话契约测试：真实 composition，仅 Provider 流是确定性的。 */

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

function composition(script: readonly ((turn: number) => ReturnType<typeof stream>)[]) {
  let turn = 0;
  const requests: unknown[] = [];
  const streamFn = ((_model: Model<any>, context: unknown) => {
    requests.push(context);
    turn += 1;
    return script[Math.min(turn - 1, script.length - 1)](turn);
  }) as unknown as StreamFn;
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = { now: () => "2026-08-16T08:00:00.000+08:00", nextId: (prefix: string) => `${prefix}-${++sequence}` };
  const kernel = new LocalProductKernel({ ledger, runtime });
  const records = new RecordModule({
    createTimelineDraft: (input) => kernel.createTimelineRecordDraft(input),
    confirmTimelineDraft: (input) => kernel.confirmTimelineRecordDraft(input),
    createNutritionDraft: (input) => kernel.createNutritionObservationDraft(input),
    confirmNutritionDraft: (input) => kernel.confirmNutritionObservationDraft(input),
    correctTimelineFact: (input) => kernel.correctTimelineFact(input),
  });
  const conversation = new PiAgentConversationModule({
    ledger,
    runtime,
    pi: { model: MODEL, streamFn },
    // 工具契约测试针对「eval 门已达标」的配置：flag 显式打开。
    featureFlags: { recoveryCoachTools: true },
    ...createLocalConversationAdapters({ kernel, records }),
  });
  return { kernel, conversation, requests, ledger };
}

function callStream(name: string, args: Record<string, unknown>) {
  const call = assistant([{ type: "toolCall", id: `call-${name}`, name, arguments: args }], "toolUse");
  return stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call);
}

function textStream(text: string) {
  const final = assistant([{ type: "text", text }], "stop");
  return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: text, partial: final }, { type: "done", reason: "stop", message: final }], final);
}

async function bootstrapWithGoal(kernel: LocalProductKernel, userId: string): Promise<void> {
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId, actor: { kind: "user", id: userId }, deviceId: "tool-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: `bootstrap:${userId}` },
    profile: { id: `profile:${userId}`, locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: `goal:${userId}`, primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" } },
    mandate: { id: `mandate:${userId}`, mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}

test("plan.estimate_muscle_load 经对话链返回肌群分列并留痕卡片，零写入", async () => {
  const { kernel, conversation, ledger } = composition([
    () => callStream("plan.estimate_muscle_load", { items: [{ exerciseVariantId: "bench_press.barbell.decline.close.bilateral.full_rom", workSets: 3, effortIntent: "moderate" }] }),
    () => textStream("胸是主目标，三头有协同负荷。"),
  ]);
  await bootstrapWithGoal(kernel, "u1");
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "卧推 3 组对各肌群多少负荷", clientTurnId: "turn-estimate" });
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "已估算肌群负荷"));
  const domainEvents = (await ledger.read()).domainEvents.filter((event) => event.userId === "u1");
  assert.equal(domainEvents.filter((event) => !["user_profile.created", "goal_contract.created", "coaching_mandate.created"].includes(event.name)).length, 0, "只读工具不产生任何领域写入");
});

test("关联未审校的动作返回 typed unknown，不编造负荷", async () => {
  const { kernel, conversation } = composition([
    () => callStream("plan.estimate_muscle_load", { items: [{ exerciseVariantId: "mobility_flow.none.gentle.standard.bilateral.full_rom.ankle", workSets: 2 }] }),
    () => textStream("这个动作的肌群关联还未审校。"),
  ]);
  await bootstrapWithGoal(kernel, "u1");
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "这个动作呢", clientTurnId: "turn-unknown" });
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const receipt = projection.items.find((item) => item.card?.kind === "receipt" && item.card.label === "已估算肌群负荷");
  assert.ok(receipt?.card?.kind === "receipt" && receipt.card.detail?.includes("未审校"), JSON.stringify(projection.items.map((item) => item.card)));
});

test("plan.forecast_recovery 返回逐日残差并显式标注历史不足", async () => {
  const { kernel, conversation } = composition([
    () => callStream("plan.forecast_recovery", { horizonDays: 3 }),
    () => textStream("历史不足，先记录再推演。"),
  ]);
  await bootstrapWithGoal(kernel, "u1");
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "帮我推演三天恢复", clientTurnId: "turn-forecast" });
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const receipt = projection.items.find((item) => item.card?.kind === "receipt" && item.card.label === "已推演恢复窗口");
  assert.ok(receipt);
});

test("planning capability 不可用时伪造调用被拦截", async () => {
  // 无 goal contract：planning 能力关闭，工具既不出现在清单也不被执行。
  const { kernel, conversation, ledger } = composition([
    () => callStream("plan.estimate_muscle_load", { items: [{ exerciseVariantId: "bench_press.barbell.decline.close.bilateral.full_rom", workSets: 3 }] }),
    () => textStream("我现在没有编排权限。"),
  ]);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "tool-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "估算负荷", clientTurnId: "turn-denied" });
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.equal(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "已估算肌群负荷"), false);
  assert.equal((await ledger.read()).toolCalls.filter((call) => call.status === "output_available").length, 0);
});
