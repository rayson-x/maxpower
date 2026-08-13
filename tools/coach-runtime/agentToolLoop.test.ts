import assert from "node:assert/strict";
import test from "node:test";

import { LocalCoachProvider, ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { BehaviorDecisionTraceRecorder, TraceRecorder } from "../../src/observability";

function fixture<T extends ScriptedLLMProvider | LocalCoachProvider>(provider: T, actionToolsEnabled = false) {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-13T08:00:00.000Z",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    llmProvider: provider,
    actionToolsEnabled,
  });
  return { app, ledger };
}

async function seed(app: CoachApplication, userId: string) {
  await app.seedUserState({
    userId,
    profile: { goal: "fat_loss", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-13",
      title: "上肢推",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60, targetRir: 2 }],
    },
  });
}

test("同一 Agent run 会将本地 typed ToolResult 回灌模型，再生成可见解释", async () => {
  const provider = new ScriptedLLMProvider(
    [
      {
        type: "tool-call",
        toolCallId: "today-plan-tool",
        toolName: "plan.show_today",
        input: { date: "2026-08-13" },
      },
      { type: "completed" },
    ],
    [],
    [[
      { type: "text-delta", delta: "我已读取今天的计划卡片；卧推安排为 3 组。" },
      { type: "completed" },
    ]],
  );
  const { app, ledger } = fixture(provider);
  const session = await app.startSession({ userId: "tool-loop-user", context: { kind: "today", ref: "2026-08-13" } });
  await seed(app, "tool-loop-user");

  const events = await app.sendCoachTurn({ sessionId: session.id, text: "今天练什么？" });

  const snapshot = await ledger.read();
  const todayPlan = snapshot.artifacts.find((artifact) => artifact.kind === "today_plan");
  assert.ok(todayPlan);
  assert.equal(provider.requests.length, 1);
  assert.equal(provider.resumeRequests.length, 1);
  assert.deepEqual(provider.resumeRequests[0]?.continuation, {
    toolCallId: "today-plan-tool",
    toolName: "plan.show_today",
    output: {
      kind: "artifact_ref",
      artifactRef: todayPlan && { id: todayPlan.id, kind: todayPlan.kind, schemaVersion: 1, hash: todayPlan.hash },
      presentation: snapshot.presentations.find((presentation) => presentation.artifactId === todayPlan?.id),
    },
  });
  assert.equal(events.some((event) => event.type === "text-delta" && event.delta.includes("3 组")), true);
  assert.equal(snapshot.messages.some((message) => message.role === "assistant" && message.content.includes("3 组")), true);
  assert.equal(snapshot.runs.at(-1)?.status, "completed");
});

test("本地能力合同会同时根据事实与 Coaching mandate 装配可见工具", async () => {
  const collaborativeProvider = new ScriptedLLMProvider([{ type: "completed" }]);
  const collaborative = fixture(collaborativeProvider, true);
  const collaborativeSession = await collaborative.app.startSession({ userId: "collaborative-user", context: { kind: "plan", ref: "active" } });
  await seed(collaborative.app, "collaborative-user");
  await collaborative.app.sendCoachTurn({ sessionId: collaborativeSession.id, text: "帮我看看当前状态" });
  const collaborativeManifest = collaborativeProvider.requests[0]?.toolManifest ?? [];
  const collaborativeTools = collaborativeManifest.map((tool) => tool.name);
  assert.equal(collaborativeTools.includes("plan.show_today"), true);
  assert.equal(collaborativeTools.includes("plan.propose_change"), true);
  assert.equal(collaborativeTools.includes("nutrition.propose_change_from_timeline"), false);
  assert.match(
    collaborativeManifest.find((tool) => tool.name === "plan.adapt_from_user_report")?.description ?? "",
    /unavailable-date\/schedule.*Prefer this over plan\.show_today\/current/,
  );

  const manualProvider = new ScriptedLLMProvider([{ type: "completed" }]);
  const manual = fixture(manualProvider, true);
  const manualSession = await manual.app.startSession({ userId: "manual-user", context: { kind: "plan", ref: "active" } });
  await seed(manual.app, "manual-user");
  const snapshot = await manual.ledger.read();
  await manual.ledger.replace({
    ...snapshot,
    users: snapshot.users.map((user) => user.userId === "manual-user"
      ? { ...user, mandate: { ...user.mandate, mode: "manual" } }
      : user),
  });
  await manual.app.sendCoachTurn({ sessionId: manualSession.id, text: "帮我看看当前状态" });
  const manualTools = manualProvider.requests[0]?.toolManifest.map((tool) => tool.name) ?? [];
  assert.equal(manualTools.includes("plan.show_today"), true);
  assert.equal(manualTools.includes("plan.propose_change"), false);
  assert.equal(manualTools.includes("timeline.record_user_report"), false);
});

test("Provider 不能绕过当前能力合同调用被隐藏的工具", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "hidden-plan-change",
      toolName: "plan.propose_change",
      input: {
        reason: "尝试绕过手动模式",
        change: { kind: "adjust_task", taskId: "bench", sets: 2 },
      },
    },
    { type: "completed" },
  ]);
  const { app, ledger } = fixture(provider, true);
  const session = await app.startSession({ userId: "manual-bypass-user", context: { kind: "plan", ref: "active" } });
  await seed(app, "manual-bypass-user");
  const snapshot = await ledger.read();
  await ledger.replace({
    ...snapshot,
    users: snapshot.users.map((user) => user.userId === "manual-bypass-user"
      ? { ...user, mandate: { ...user.mandate, mode: "manual" } }
      : user),
  });

  const events = await app.sendCoachTurn({ sessionId: session.id, text: "试试改计划" });

  assert.equal(events.some((event) => event.type === "run-error" && event.message === "capability_not_available"), true);
  assert.equal((await ledger.read()).artifacts.some((artifact) => artifact.kind === "plan_change_proposal"), false);
});

test("能力可见性、工具选择与校验写入结构化决策记录而非模型思维链", async () => {
  const envelopes: import("../../src/observability").TraceEnvelope[] = [];
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: "trace-today", toolName: "plan.show_today", input: { date: "2026-08-13" } },
    { type: "completed" },
  ], [], [[{ type: "completed" }]]);
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => "2026-08-13T08:00:00.000Z", nextId: (prefix) => `${prefix}-${++sequence}` },
    llmProvider: provider,
    behaviorDecisionRecorder: new BehaviorDecisionTraceRecorder(new TraceRecorder([{
      name: "capture",
      async write(envelope) { envelopes.push(envelope); },
    }])),
  });
  const session = await app.startSession({ userId: "trace-tool-user", context: { kind: "today", ref: "2026-08-13" } });
  await seed(app, "trace-tool-user");
  await app.sendCoachTurn({ sessionId: session.id, text: "看看今天计划" });

  assert.deepEqual(envelopes.map((item) => item.metadata?.decisionBoundary), [
    "capability_visibility", "tool_selection", "tool_validation",
  ]);
  assert.equal(envelopes.every((item) => !JSON.stringify(item).includes("看看今天计划")), true);
});

test("建档场景把 Agent 选择的临时表单写入同一草稿；其它场景看不到建档工具", async () => {
  const provider = new ScriptedLLMProvider(
    [{
      type: "tool-call",
      toolCallId: "onboarding-form",
      toolName: "onboarding.request_form",
      input: {
        topic: "goal_based_intake",
        fieldIds: ["training.cumulative_months", "training.recent_continuity", "training.recent_split", "training.environment", "training.equipment", "training.execution_stability", "profile.training_schedule", "safety.activity_restrictions", "mandate.plan_adjustment_authority", "profile.sex", "timeline.daily_activity", "nutrition.usual_intake", "goal.target_horizon", "profile.body_measurement_method"],
        reasonCode: "planning_gate",
        requiredFor: "initial_plan",
      },
    }, { type: "completed" }],
    [],
    [[{ type: "text-delta", delta: "填完这张卡继续，我会按新的信息重新判断下一步。" }, { type: "completed" }]],
  );
  const { app } = fixture(provider, true);
  const draft = await app.startOrResumeBaselineIntake({ userId: "onboarding-agent-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline" };
  await app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-13T08:00:00.000Z", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      goalNarrative: { text: "想减脂，保持力量", observedAt: "2026-08-13T08:00:00.000Z", source },
    },
  });
  const session = await app.startSession({ userId: draft.userId, context: { kind: "onboarding", ref: draft.id } });
  await app.sendCoachTurn({ sessionId: session.id, text: "我每周大概练四次，每次一个小时。" });

  const card = await app.readActiveOnboardingDynamicForm({ draftId: draft.id });
  assert.ok((card?.fieldIds.length ?? 0) > 3);
  assert.equal(card?.fieldIds.includes("training.recent_continuity"), true);
  assert.equal(provider.requests[0]?.toolManifest?.some((tool) => tool.name === "onboarding.request_form"), true);
  assert.match(provider.requests[0]?.modelInput?.systemPrompt ?? "", /Onboarding scenario/);
  assert.equal((provider.requests[0]?.context.onboardingDraft as { id?: string } | undefined)?.id, draft.id);

  const nonOnboarding = new ScriptedLLMProvider([{ type: "completed" }]);
  const other = fixture(nonOnboarding, true);
  await seed(other.app, "other-user");
  const otherSession = await other.app.startSession({ userId: "other-user", context: { kind: "profile", ref: "profile" } });
  await other.app.sendCoachTurn({ sessionId: otherSession.id, text: "你好" });
  assert.equal(nonOnboarding.requests[0]?.toolManifest.some((tool) => tool.name === "onboarding.request_form"), false);
});

test("建档 Agent 从自然语言回合保存训练背景，再创建多维评估而非训练等级", async () => {
  const provider = new ScriptedLLMProvider(
    [{
      type: "tool-call",
      toolCallId: "capture-background",
      toolName: "onboarding.capture_training_background",
      input: {
        cumulativeTrainingMonths: { minimum: 18, maximum: 36 },
        recentContinuity: { consecutiveWeeks: 12, usualSessionsPerWeek: 4 },
        recentSplit: ["胸", "背", "腿", "肩"],
        environments: ["gym"],
        availableEquipment: ["full_gym"],
        schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
        executionStability: "reported_consistent",
      },
    }, { type: "completed" }],
    [],
    [[{ type: "tool-call", toolCallId: "assess-background", toolName: "onboarding.assess_training_context", input: {} }, { type: "completed" }], [{ type: "text-delta", delta: "训练背景已记下，接下来按已知情况继续校准。" }, { type: "completed" }]],
  );
  const { app } = fixture(provider, true);
  const draft = await app.startOrResumeBaselineIntake({ userId: "onboarding-background-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline" };
  await app.saveBaselineIntake({
    draftId: draft.id, inputMode: "form", idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-13T08:00:00.000Z", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      goalNarrative: { text: "减脂保肌", observedAt: "2026-08-13T08:00:00.000Z", source },
    },
  });
  const session = await app.startSession({ userId: draft.userId, context: { kind: "onboarding", ref: draft.id } });
  await app.sendCoachTurn({ sessionId: session.id, text: "我练两年了，一周四练，最近胸背腿肩，在健身房练，频率很稳定。" });

  const progress = await app.readOnboardingProgress(draft.id);
  assert.deepEqual(progress.patch.trainingBackground?.schedule, { weeklyFrequency: 4, sessionDurationMinutes: 75 });
  assert.deepEqual(progress.patch.trainingBackground?.recentSplit, ["胸", "背", "腿", "肩"]);
  assert.equal(progress.coachingLevelAssessments?.at(-1)?.priority, "multi_dimensional_assessment");
  assert.equal(progress.patch.profile?.trainingExperience, undefined);
});

test("基线完成后由 Agent 主动开始同一份草稿的下一回合，不伪造用户消息", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "opening-form",
      toolName: "onboarding.request_form",
      input: {
        topic: "goal_based_intake",
        fieldIds: [
          "training.cumulative_months", "training.recent_continuity", "training.recent_split",
          "training.environment", "training.equipment", "training.execution_stability",
          "profile.training_schedule", "safety.activity_restrictions", "mandate.plan_adjustment_authority",
          "profile.sex", "timeline.daily_activity", "nutrition.usual_intake", "goal.target_horizon", "profile.body_measurement_method",
        ],
        reasonCode: "planning_gate",
        requiredFor: "initial_plan",
      },
    },
    { type: "completed" },
  ], [], [[{ type: "text-delta", delta: "我把当前会影响计划的内容整理在卡片里，填完会继续判断。" }, { type: "completed" }]]);
  const { app, ledger } = fixture(provider, true);
  const draft = await app.startOrResumeBaselineIntake({ userId: "onboarding-opening-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline" };
  await app.saveBaselineIntake({
    draftId: draft.id, inputMode: "form", idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-13T08:00:00.000Z", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      goalNarrative: { text: "想减脂，保持力量", observedAt: "2026-08-13T08:00:00.000Z", source },
    },
  });

  await app.startOnboardingAgentTurn({ userId: draft.userId, draftId: draft.id });

  const snapshot = await ledger.read();
  assert.equal(snapshot.messages.some((message) => message.role === "user" && message.content.includes("开始建档")), false);
  assert.equal(snapshot.messages.some((message) => message.role === "assistant" && message.content.includes("整理在卡片里")), true);
  assert.ok(((await app.readActiveOnboardingDynamicForm({ draftId: draft.id }))?.fieldIds.length ?? 0) > 3);
  assert.match(provider.requests[0]?.modelInput?.systemPrompt ?? "", /Onboarding scenario/);
  assert.match(provider.requests[0]?.modelInput?.systemPrompt ?? "", /decision tree/);
});

test("建档 Agent 把用户已经说出的动态字段写入同一草稿，标记为待确认而非伪装明确填写", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "capture-activity",
      toolName: "onboarding.capture_fields",
      input: { captures: [{ fieldId: "timeline.daily_activity", value: "sedentary_remote_work" }] },
    },
    { type: "completed" },
  ], [], [[{ type: "completed" }]]);
  const { app } = fixture(provider, true);
  const draft = await app.startOrResumeBaselineIntake({ userId: "onboarding-conversation-field-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline" };
  await app.saveBaselineIntake({
    draftId: draft.id, inputMode: "form", idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-13T08:00:00.000Z", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      goalNarrative: { text: "想减脂", observedAt: "2026-08-13T08:00:00.000Z", source },
    },
  });
  const session = await app.startSession({ userId: draft.userId, context: { kind: "onboarding", ref: draft.id } });
  await app.sendCoachTurn({ sessionId: session.id, text: "我平时居家办公，白天基本坐着。" });

  const capture = (await app.readOnboardingProgress(draft.id)).patch.dynamicFields?.["timeline.daily_activity"];
  assert.equal(capture?.value, "sedentary_remote_work");
  assert.equal(capture?.state, "normalized_needs_review");
  assert.equal(capture?.source.kind, "conversation_message");
});

test("离线 Agent 也能从目标前沿完成训练背景→评估→下一张卡，而不会卡在联网同意", async () => {
  const { app } = fixture(new LocalCoachProvider(), true);
  const draft = await app.startOrResumeBaselineIntake({ userId: "offline-onboarding-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline" };
  await app.saveBaselineIntake({
    draftId: draft.id, inputMode: "form", idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-13T08:00:00.000Z", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      goalNarrative: { text: "想减脂", observedAt: "2026-08-13T08:00:00.000Z", source },
    },
  });
  const events = await app.startOnboardingAgentTurn({ userId: draft.userId, draftId: draft.id });
  assert.equal(events.some((event) => event.type === "tool-started" && event.toolName === "onboarding.request_form"), true);
  assert.equal(events.some((event) => event.type === "text-delta" && event.delta.includes("先说说你最近怎么练")), false);
  assert.ok(((await app.readActiveOnboardingDynamicForm({ draftId: draft.id }))?.fieldIds.length ?? 0) > 3);
});

test("建档前沿需要输入时，Harness 拒绝只有文字问题而没有表单工具的模型输出", async () => {
  const provider = new ScriptedLLMProvider([
    { type: "text-delta", delta: "你最近一周练几次？" },
    { type: "completed" },
  ]);
  const { app, ledger } = fixture(provider, true);
  const draft = await app.startOrResumeBaselineIntake({ userId: "onboarding-form-gate-user" });
  const source = { kind: "form_submission" as const, submissionId: "baseline" };
  await app.saveBaselineIntake({
    draftId: draft.id, inputMode: "form", idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-13T08:00:00.000Z", source },
      height: { value: { value: 178, unit: "cm" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-13T08:00:00.000Z", source },
      goalNarrative: { text: "想减脂", observedAt: "2026-08-13T08:00:00.000Z", source },
    },
  });
  const events = await app.startOnboardingAgentTurn({ userId: draft.userId, draftId: draft.id });
  const snapshot = await ledger.read();
  assert.equal(events.some((event) => event.type === "run-error"), true);
  assert.equal(snapshot.messages.some((message) => message.role === "assistant" && message.content.includes("最近一周练几次")), false);
  assert.equal(await app.readActiveOnboardingDynamicForm({ draftId: draft.id }), undefined);
});
