import assert from "node:assert/strict";
import test from "node:test";

import type { AssistantMessage, AssistantMessageEvent, Model } from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

import { PiAgentConversationModule, createLocalConversationAdapters } from "../../src/agent-conversation";
import { INTAKE_FIELD_REGISTRY, intakeField, validateIntakeFieldValue } from "../../src/coach/intakeFields";
import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { RecordModule } from "../../src/records";

/** Scenario harness tests: distinct intake/planning/general entries through the real composition. */

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

function toolCallMessage(id: string, name: string, args: Record<string, unknown>): AssistantMessage {
  return assistant([{ type: "toolCall", id, name, arguments: args }], "toolUse");
}

function callStream(call: AssistantMessage) {
  return stream([{ type: "start", partial: call }, { type: "toolcall_end", contentIndex: 0, toolCall: call.content[0] as never, partial: call }, { type: "done", reason: "toolUse", message: call }], call);
}

function textStream(final: AssistantMessage, text: string) {
  return stream([{ type: "start", partial: final }, { type: "text_delta", contentIndex: 0, delta: text, partial: final }, { type: "done", reason: "stop", message: final }], final);
}

function composition(script: readonly ((turn: number) => ReturnType<typeof stream>)[]) {
  const requests: { systemPrompt?: string; messages?: unknown }[] = [];
  let turn = 0;
  const streamFn = ((_model: Model<any>, context: { systemPrompt?: string }) => {
    turn += 1;
    requests.push(context);
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
    ...createLocalConversationAdapters({ kernel, records }),
  });
  return { kernel, records, conversation, requests, ledger };
}

test("intake mode: the Agent grounds the next step in installed knowledge and composes a small optional form", async () => {
  const knowledgeCall = toolCallMessage("k1", "knowledge.search_installed", { query: "增肌 新手", topic: "training" });
  const formCall = toolCallMessage("f1", "intake.request_form", { fieldIds: ["training_years", "equipment_access"], reason: "训练背景和器械决定第一阶段安排" });
  const final = assistant([{ type: "text", text: "这两个信息能帮我把第一阶段安排得更合适。" }], "stop");
  const { conversation, requests } = composition([
    () => callStream(knowledgeCall),
    () => callStream(formCall),
    () => textStream(final, "这两个信息能帮我把第一阶段安排得更合适。"),
  ]);
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "submit_baseline", userId: "u1", conversationId: opened.conversation.id, baseline: { ageYears: 28, heightCm: 180, weightKg: 80, goalText: "我想增肌" } });
  await conversation.whenIdle(opened.conversation.id);
  // The intake scenario prompt drove this run.
  assert.match(requests[0]?.systemPrompt ?? "", /Intake mode/);
  assert.match(requests[0]?.systemPrompt ?? "", /knowledge\.search_installed/);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const form = projection.items.find((item) => item.card?.kind === "intake_form");
  assert.ok(form, JSON.stringify(projection.items.map((item) => item.card?.kind)));
  assert.equal(form?.state, "ready");
  assert.deepEqual(form?.card?.kind === "intake_form" ? form.card.fields : undefined, ["training_years", "equipment_access"]);
});

test("an intake form accepts partial answers, admits a clinical note formally, and is never re-asked", async () => {
  const formCall = toolCallMessage("f1", "intake.request_form", { fieldIds: ["training_years", "equipment_access", "injury_or_condition"], reason: "安全与器械决定安排" });
  const reaskCall = toolCallMessage("f2", "intake.request_form", { fieldIds: ["training_years"], reason: "不应再问" });
  const final = assistant([{ type: "text", text: "收到。" }], "stop");
  const { kernel, conversation, requests } = composition([
    () => callStream(formCall),
    () => textStream(final, "收到。"),
    () => callStream(reaskCall),
    () => textStream(final, "收到。"),
  ]);
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "submit_baseline", userId: "u1", conversationId: opened.conversation.id, baseline: { ageYears: 28, heightCm: 180, weightKg: 80, goalText: "增肌" } });
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const form = projection.items.find((item) => item.card?.kind === "intake_form");
  assert.ok(form);
  // Partial answers only: one field deliberately left unknown.
  const submitted = await conversation.execute({
    kind: "submit_intake_form", userId: "u1", conversationId: opened.conversation.id, cardId: form!.id,
    values: { training_years: "2", injury_or_condition: "左肩旧伤" },
  });
  assert.equal(submitted.kind, "intake_form_submitted");
  await conversation.whenIdle(opened.conversation.id);
  // The clinical note became a formal clinical_context fact.
  const domain = await kernel.readDomainProjection({ userId: "u1" });
  assert.ok(domain.timeline.current.some((event) => event.fact.kind === "clinical_context" && event.fact.note === "左肩旧伤"));
  const after = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  const submittedCard = after.items.find((item) => item.card?.kind === "intake_form" && item.id === form!.id);
  assert.equal(submittedCard?.card?.kind === "intake_form" ? submittedCard.card.status : undefined, "submitted");
  assert.deepEqual(submittedCard?.card?.kind === "intake_form" ? submittedCard.card.values : undefined, { training_years: "2", injury_or_condition: "左肩旧伤" });
  // The follow-up run re-requested an answered field: no second card was created.
  assert.match(requests.at(-2)?.systemPrompt ?? "", /Intake mode/);
  const forms = after.items.filter((item) => item.card?.kind === "intake_form");
  assert.equal(forms.length, 1, "already-answered fields never produce a duplicate form");
});

test("planning mode: the fixed facts pack is injected before the first token", async () => {
  const final = assistant([{ type: "text", text: "安全优先。" }], "stop");
  const { kernel, records, conversation, requests } = composition([() => textStream(final, "安全优先。")]);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "scenario-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal:u1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-01", endDate: "2026-12-01" } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  await records.recordFact({
    userId: "u1", idempotencyKey: "pain-1", occurredAt: "2026-08-16T07:30:00.000+08:00", source: "user_statement",
    fact: { kind: "symptom", symptom: "pain", area: "lower_back", severity: 8, confidence: "confirmed" },
  });
  // The post-commit review delivered a hard-safety assessment but this kernel
  // has no ingress wired; reconcile picks it up as a planning-scenario run.
  const started = await conversation.execute({ kind: "reconcile", userId: "u1", causationId: "test" });
  assert.equal(started.kind, "signal_started");
  if (started.kind !== "signal_started") return;
  await conversation.whenIdle(started.conversationId);
  const prompt = requests[0]?.systemPrompt ?? "";
  assert.match(prompt, /Planning mode/);
  assert.match(prompt, /Fixed planning facts pack/);
  assert.ok(prompt.includes("goal:u1"), "facts pack carries the confirmed goal contract");
  assert.ok(prompt.includes("\"safetyBlocked\":true"), "facts pack carries the safety state");
});

test("everyday mode: no intake or planning framing, record tools still work", async () => {
  const recordCall = toolCallMessage("r1", "timeline.record_explicit", { kind: "body_weight", valueKg: 80 });
  const final = assistant([{ type: "text", text: "我把这条放在确认卡里。" }], "stop");
  const { kernel, conversation, requests } = composition([
    () => callStream(recordCall),
    () => textStream(final, "我把这条放在确认卡里。"),
  ]);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "scenario-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "今早体重 80", clientTurnId: "turn-general" });
  await conversation.whenIdle(opened.conversation.id);
  const prompt = requests[0]?.systemPrompt ?? "";
  assert.match(prompt, /Everyday mode/);
  assert.doesNotMatch(prompt, /Intake mode/);
  assert.doesNotMatch(prompt, /Fixed planning facts pack/);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  assert.ok(projection.items.some((item) => item.card?.kind === "record_confirmation"));
});

test("the intake field registry validates values and never invents fields", () => {
  assert.ok(INTAKE_FIELD_REGISTRY.length >= 8);
  for (const field of INTAKE_FIELD_REGISTRY) {
    assert.ok(field.label.length > 0);
    assert.ok(field.knowledgeTopic);
    assert.equal(intakeField(field.id), field);
  }
  const years = intakeField("training_years")!;
  assert.equal(validateIntakeFieldValue(years, "2"), "2");
  assert.equal(validateIntakeFieldValue(years, ""), undefined);
  assert.throws(() => validateIntakeFieldValue(years, "abc"), /intake_field_not_a_number/);
  assert.throws(() => validateIntakeFieldValue(years, "99"), /intake_field_out_of_range/);
  const equipment = intakeField("equipment_access")!;
  assert.equal(validateIntakeFieldValue(equipment, "home_dumbbell"), "home_dumbbell");
  assert.throws(() => validateIntakeFieldValue(equipment, "spaceship"), /intake_field_option_unknown/);
});

test("every run pins its fact frontier and context manifest for audit", async () => {
  const final = assistant([{ type: "text", text: "收到。" }], "stop");
  const { kernel, conversation, ledger } = composition([() => textStream(final, "收到。")]);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "scenario-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "你好", clientTurnId: "turn-audit" });
  await conversation.whenIdle(opened.conversation.id);
  const run = (await ledger.read()).runs.find((candidate) => candidate.sessionId === opened.conversation.id);
  assert.ok(run);
  assert.ok(run!.factFrontier.some((ref) => ref.aggregate === "profile" && ref.id === "profile:u1" && ref.revision === 1));
  assert.ok(run!.factFrontier.some((ref) => ref.aggregate === "timeline"));
  assert.ok(run!.contextManifestHash.length > 8);
  assert.ok(run!.contextManifestHash !== "conversation-v1");
});

test("a turn-level page attachment reaches the run context without touching session identity", async () => {
  const final = assistant([{ type: "text", text: "我看到你在看计划页。" }], "stop");
  const { kernel, conversation, requests, ledger } = composition([() => textStream(final, "我看到你在看计划页。")]);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "scenario-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "这个计划怎么样", clientTurnId: "turn-attach", attachment: { kind: "plan", ref: "2026-08-16" } });
  await conversation.whenIdle(opened.conversation.id);
  assert.ok((requests[0]?.systemPrompt ?? "").includes("\"turnAttachment\":{\"kind\":\"plan\",\"ref\":\"2026-08-16\"}"));
  const session = (await ledger.read()).sessions.find((candidate) => candidate.id === opened.conversation.id);
  assert.ok(session?.contextRefs?.some((ref) => ref.kind === "plan" && ref.ref === "2026-08-16"));
  assert.equal(session?.context.kind, "conversation", "附件永远不构成会话 identity");
});

test("an auto-written record receipt offers a correction entry that starts an Agent-driven correction", async () => {
  const recordCall = toolCallMessage("r1", "timeline.record_explicit", { kind: "body_weight", valueKg: 80 });
  const final = assistant([{ type: "text", text: "已记录。" }], "stop");
  const correctionReply = assistant([{ type: "text", text: "哪里记错了？告诉我正确的数值。" }], "stop");
  const { kernel, conversation } = composition([
    () => callStream(recordCall),
    () => textStream(final, "已记录。"),
    () => textStream(correctionReply, "哪里记错了？告诉我正确的数值。"),
  ]);
  await kernel.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "scenario-test", occurredAt: "2026-08-16T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap:u1" },
    profile: { id: "profile:u1", locale: "zh-CN", adultConfirmed: true, dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate:u1", mode: "managed", planChangeAuthorization: "always_ask", scopes: { loadReps: "confirm", volume: "confirm", substitution: "confirm", schedule: "confirm", deload: "confirm", nutrition: "confirm", recording: "delegated" } },
  });
  const opened = await conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "今早体重 80", clientTurnId: "turn-receipt" });
  await conversation.whenIdle(opened.conversation.id);
  const projection = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(projection.kind, "conversation");
  if (projection.kind !== "conversation") return;
  const receipt = projection.items.find((item) => item.card?.kind === "receipt" && item.card.correctable);
  assert.ok(receipt, "自动写入的 receipt 必须带更正入口");
  const started = await conversation.execute({ kind: "request_correction", userId: "u1", conversationId: opened.conversation.id, cardId: receipt!.id });
  assert.equal(started.kind, "started");
  await conversation.whenIdle(opened.conversation.id);
  const after = await conversation.read({ kind: "conversation", userId: "u1", conversationId: opened.conversation.id });
  assert.equal(after.kind, "conversation");
  if (after.kind !== "conversation") return;
  assert.ok(after.items.some((item) => item.role === "assistant" && item.content === "哪里记错了？告诉我正确的数值。"));
});
