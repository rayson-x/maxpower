import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";

/** 对话链上的知识分层：search 给蒸馏摘要，read_passage 按需取原文，均只读留痕。 */

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

function callStream(name: string, args: Record<string, unknown>, id: string) {
  const call = assistant([{ type: "toolCall", id, name, arguments: args }], "toolUse");
  return stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call);
}

function textStream(text: string) {
  const final = assistant([{ type: "text", text }], "stop");
  return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: text, partial: final }, { type: "done", reason: "stop", message: final }], final);
}

test("knowledge.read_passage 经对话链返回原文并留痕，零写入", async () => {
  const requests: { tools?: readonly { name: string }[] }[] = [];
  let passageId = "";
  const streamFn = ((_model: Model<any>, context: { tools?: readonly { name: string }[] }) => {
    requests.push(context);
    const turn = requests.length;
    if (turn === 1) return callStream("knowledge.search_installed", { query: "恢复", topic: "recovery" }, "c-search");
    if (turn === 2) {
      return callStream("knowledge.read_passage", { passageId }, "c-read");
    }
    return textStream("已按原文回答。");
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
  // 先从蒸馏层拿到一个真实 passageId，再让脚本下钻
  const digest = kernel.searchInstalledKnowledge({ query: "恢复", topic: "recovery", limit: 1 });
  assert.equal(digest.kind, "found");
  passageId = digest.entries[0]!.passageRef.passageId;

  const conversation = new PiAgentConversationModule({
    ledger,
    runtime,
    pi: { model: MODEL, streamFn },
    ...createLocalConversationAdapters({ kernel, records }),
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "恢复窗口怎么算", clientTurnId: "turn-layered" });
  await conversation.whenIdle(opened.conversation.id);

  // read_passage 出现在工具清单（生产适配器提供 read）
  assert.ok(requests[0]?.tools?.some((tool) => tool.name === "knowledge.read_passage"));
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.ok(projection.items.some((item) => item.card?.kind === "receipt" && item.card.label === "已读取知识原文"));
  const toolCall = (await ledger.read()).toolCalls.find((call) => call.id === "c-read");
  assert.equal(toolCall?.status, "output_available");
  // 只读：除会话事件外零领域写入
  assert.equal((await ledger.read()).domainEvents.length, 0);
});
