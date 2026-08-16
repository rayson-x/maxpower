import assert from "node:assert/strict";
import test from "node:test";

import { detectRedLine, RED_LINE_POLICY } from "../../src/coach/redLines";
import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";
import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

/** S01 输入侧确定性检测：红线命中 → run 上下文注入固定转介指令；非红线 → 无注入。 */

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant", content, api: "openai-completions", provider: "test", model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: 0,
  };
}
function textStream(text: string) {
  const final = assistant([{ type: "text", text }], "stop");
  return { async *[Symbol.asyncIterator]() { yield { type: "start", partial: final } as AssistantMessageEvent; yield { type: "text_delta", contentIndex: 0, delta: text, partial: final } as AssistantMessageEvent; yield { type: "done", reason: "stop", message: final } as AssistantMessageEvent; }, result: async () => final };
}
const MODEL = { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>;

function composition() {
  const requests: { systemPrompt?: string }[] = [];
  const streamFn = ((_model: Model<any>, context: { systemPrompt?: string }) => {
    requests.push(context);
    return textStream("建议尽快就医评估，这个超出训练调整能解决的范围。");
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
  const conversation = new PiAgentConversationModule({ ledger, runtime, pi: { model: MODEL, streamFn }, ...createLocalConversationAdapters({ kernel, records }) });
  return { kernel, conversation, requests };
}

test("红线输入 → run 系统提示含固定转介指令；普通输入 → 无注入", async () => {
  const { kernel, conversation, requests } = composition();
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "s01-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "我膝盖不训练的时候也持续疼，还能练腿吗", clientTurnId: "turn-red" });
  await conversation.whenIdle(opened.conversation.id);
  assert.ok(requests[0]?.systemPrompt?.includes(RED_LINE_POLICY.instruction), "红线命中必须注入固定转介指令");
  assert.ok(requests[0]?.systemPrompt?.includes("MUST NOT name, guess"), "注入指令必须禁止推测病名");

  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "我今天练了胸，卧推 60kg 8 次", clientTurnId: "turn-normal" });
  await conversation.whenIdle(opened.conversation.id);
  assert.ok(!requests[1]?.systemPrompt?.includes(RED_LINE_POLICY.instruction), "非红线输入不得注入");
});

test("红线词表逐条正反（S01 语料六类全覆盖）", () => {
  const hits: readonly [string, string][] = [
    ["severe_pain", "我肩膀剧痛"],
    ["severe_pain", "深蹲时腰部剧烈疼痛"],
    ["pain_limits_daily_function", "现在疼到走路都费劲"],
    ["joint_mechanical", "膝盖有卡住的感觉"],
    ["swelling", "脚踝明显肿胀"],
    ["neurological", "腿麻，刺痛放射到小腿"],
    ["pain_at_rest", "不训练的时候也持续疼"],
    ["trauma_history", "我去年韧带撕裂过，现在又开始疼了"],
  ];
  for (const [id, text] of hits) assert.ok(detectRedLine(text).includes(id), `未命中 ${id}: ${text}`);
  // 非红线：正常训练酸痛/疲劳表述不误伤
  for (const safe of ["练完胸有点酸", "今天感觉疲劳", "深蹲后大腿酸了两天", "我睡眠不太好", "我去年韧带撕裂过", "今天走神了差点摔倒"]) {
    assert.deepEqual(detectRedLine(safe), [], `误伤: ${safe}`);
  }
});
