import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { projectDomainEvents } from "../../src/coach/domain";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";

/** S3 记录链路缝：口述好变化 → wellness_note 落 Timeline → 复盘回放；v1 不进风险引擎。 */

function assistant(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
  return {
    role: "assistant", content, api: "openai-completions", provider: "test", model: "test-model",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: 0,
  };
}
function stream(events: readonly AssistantMessageEvent[], final: AssistantMessage) {
  return { async *[Symbol.asyncIterator]() { yield* events; }, result: async () => final };
}
const MODEL = { id: "test-model", name: "Test", api: "openai-completions", provider: "test", baseUrl: "https://example.test", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1024, maxTokens: 512 } as Model<any>;

function callStream(name: string, args: Record<string, unknown>) {
  const call = assistant([{ type: "toolCall", id: `call-${name}`, name, arguments: args }], "toolUse");
  return stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call);
}
function textStream(text: string) {
  const final = assistant([{ type: "text", text }], "stop");
  return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: text, partial: final }, { type: "done", reason: "stop", message: final }], final);
}

test("口述好变化 → wellness_note 落 Timeline → 复盘回放可查询", async () => {
  let turn = 0;
  const streamFn = ((_model: Model<any>) => {
    turn += 1;
    if (turn === 1) return callStream("timeline.record_explicit", { kind: "wellness_note", note: "最近爬楼不喘了", dimension: "function" });
    return textStream("已记下这个好变化。");
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
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "wellness-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "最近爬楼不喘了", clientTurnId: "turn-wellness" });
  await conversation.whenIdle(opened.conversation.id);

  // 记录确认卡（mandate 未委托时确认后才入账）
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  if (projection.kind !== "conversation") return;
  const recordCard = projection.items.find((item) => item.card?.kind === "record_confirmation" && item.card.status === "awaiting_confirmation");
  assert.ok(recordCard, "记录确认卡必须在场");
  await conversation.execute({ kind: "resolve_record", userId: "u1", conversationId: opened.conversation.id, cardId: recordCard!.id, decision: "confirm" });

  // 落 Timeline（一等公民）
  const domain = projectDomainEvents((await ledger.read()).domainEvents, { userId: "u1" });
  const note = domain.timeline.current.find((event) => event.fact.kind === "wellness_note");
  assert.ok(note, "wellness_note 必须落 Timeline");
  assert.equal(note!.fact.kind === "wellness_note" ? note!.fact.note : undefined, "最近爬楼不喘了");
  assert.equal(note!.fact.kind === "wellness_note" ? note!.fact.dimension : undefined, "function");

  // 复盘回放（单一制品：UI 与 agent 共读 readMuscleWeekReview）
  const report = await kernel.readMuscleWeekReview({ userId: "u1", weekStartDate: "2026-08-10", weekEndDate: "2026-08-16" });
  assert.equal(report.wellnessNotes.length, 1);
  assert.equal(report.wellnessNotes[0]!.note, "最近爬楼不喘了");
  assert.equal(report.wellnessNotes[0]!.dimension, "function");
  // 周窗外不回放
  const empty = await kernel.readMuscleWeekReview({ userId: "u1", weekStartDate: "2026-08-03", weekEndDate: "2026-08-09" });
  assert.equal(empty.wellnessNotes.length, 0);
});

test("维度标签可选；未知维度被拒", async () => {
  const kernel = new LocalProductKernel({ ledger: new InMemoryCoachLedger(), runtime: { now: () => "2026-08-16T08:00:00.000+08:00", nextId: ((s => () => `id-${++s}`)(0)) as never } });
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "wellness-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  // 无维度直接落账
  await kernel.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "wellness-no-dim",
    fact: { kind: "wellness_note", note: "睡眠变好了", confidence: "confirmed" },
    envelope: { time: { startedAt: "2026-08-16T07:00:00.000+08:00", timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
  });
  const report = await kernel.readMuscleWeekReview({ userId: "u1", weekStartDate: "2026-08-10", weekEndDate: "2026-08-16" });
  assert.equal(report.wellnessNotes.length, 1);
  assert.equal(report.wellnessNotes[0]!.dimension, undefined);
});

test("v1 不进风险评估引擎：wellness_note 只允许出现在平台判定的软化方向", async () => {
  // 结构性断言（grep 守卫，防静默接入）：spec 允许主观信号缩短平台判定窗
  // （多信号 1–2 周），方向永远朝「不是平台/再观察」——不得用于升级风险结论。
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  for (const file of ["src/planning/recoveryWindows.ts", "src/planning/AdaptivePlanning.ts"]) {
    assert.ok(!readFileSync(resolve(file), "utf8").includes("wellness_note"), `${file} 不得消费 wellness_note（v2 才进风险引擎）`);
  }
  const goalPath = readFileSync(resolve("src/goal-path/GoalPathModule.ts"), "utf8");
  const uses = goalPath.split("\n").filter((line) => line.includes("wellness_note"));
  assert.ok(uses.length > 0 && uses.every((line) => line.includes("wellnessNotesInWindow")), `goal-path 只能经平台窗读取 wellness_note：${uses.join(" | ")}`);
  // plateauPolicy 里主观通道只参与「缩短窗口/不算平台」两个软化分支
  const policy = readFileSync(resolve("src/goal-path/plateauPolicy.ts"), "utf8");
  const declineBranch = policy.split("performance_decline_material")[1]?.slice(0, 300) ?? "";
  assert.ok(!declineBranch.includes("subjectivePresent"), "主观信号不得参与真信号升级分支");
});
