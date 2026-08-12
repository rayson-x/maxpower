import assert from "node:assert/strict";
import test from "node:test";

import { LocalCoachProvider, ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { ArtifactCardRegistry } from "../../src/coach/cards";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import type { CoachingMandateData } from "../../src/coach/domain";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { CoachToolManifest } from "../../src/coach/toolRegistry";

/**
 * 场景 playbook eval（ticket 06）：意图 → 工具序列 → 落账状态。
 * 用 ScriptedLLMProvider 确定性运行，不依赖真实模型。
 * 门槛：本套件全绿才允许翻转 actionToolsEnabled / knowledgeToolsEnabled。
 */

const NOW = "2026-08-03T10:00:00.000Z";

function fixture(options: { knowledgeToolsEnabled?: boolean; actionToolsEnabled?: boolean; localProvider?: boolean } = {}) {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => NOW, nextId: (prefix: string) => `${prefix}-${++sequence}` },
    knowledgeToolsEnabled: options.knowledgeToolsEnabled,
    actionToolsEnabled: options.actionToolsEnabled,
    ...(options.localProvider ? { llmProvider: new LocalCoachProvider() } : {}),
  });
  return { app, ledger };
}

async function bootstrap(app: CoachApplication, mandate: { mode: CoachingMandateData["mode"]; scopes?: Partial<NonNullable<CoachingMandateData["scopes"]>> } = { mode: "collaborative" }, weeklyFrequency = 3) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: {
      id: "profile-1",
      trainingExperience: "intermediate",
      locale: "zh-CN",
      schedule: { weeklyFrequency, sessionDurationMinutes: 75 },
      locations: [{ id: "gym-main", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      successMetrics: ["weekly_training_adherence"],
      horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
      status: "active",
    },
    mandate: {
      id: "mandate-1",
      mode: mandate.mode,
      ...(mandate.scopes ? {
        scopes: {
          loadReps: "confirm",
          volume: "confirm",
          substitution: "confirm",
          schedule: "confirm",
          deload: "confirm",
          nutrition: "confirm",
          ...mandate.scopes,
        },
      } : {}),
    },
    meta: {
      userId: "user-1", actor: { kind: "user", id: "user-1" }, deviceId: "phone",
      occurredAt: NOW, timezoneOffsetMinutes: 0, idempotencyKey: "bootstrap",
    },
  });
  await app.createPlanningPreview({
    userId: "user-1",
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    idempotencyKey: "preview-1",
  });
  const preview = (await app.readDomainProjection({ userId: "user-1" }));
  void preview;
  return app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-03" },
    title: "今天安排",
  });
}

async function runTurn(app: CoachApplication, sessionId: string, toolName: string, input: Record<string, unknown>) {
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: `call-${toolName}-${Math.random().toString(36).slice(2, 8)}`, toolName, input },
    { type: "completed" },
  ]);
  const appWithProvider = appWith(app, provider);
  return appWithProvider.sendCoachTurn({ sessionId, text: "意图输入" });
}

function appWith(app: CoachApplication, provider: ScriptedLLMProvider): CoachApplication {
  // 测试内重建带 provider 的 app，共享同一账本与原开关
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyApp = app as any;
  const deps = anyApp.dependencies ?? {};
  let seq = 100000; // 与原 app 的 id 序列错开，避免重复 id 冲突
  return new CoachApplication({
    ledger: deps.ledger,
    runtime: {
      now: deps.runtime.now,
      nextId: (prefix: string) => `${prefix}-alt-${++seq}`,
    },
    llmProvider: provider,
    knowledgeToolsEnabled: deps.knowledgeToolsEnabled ?? false,
    actionToolsEnabled: deps.actionToolsEnabled ?? false,
  });
}

test("manifest 包含全部新工具（启用后）", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  const provider = new ScriptedLLMProvider([{ type: "completed" }]);
  const app2 = appWith(app, provider);
  await app2.sendCoachTurn({ sessionId: session.id, text: "看看" });
  const manifest = provider.requests[0]?.toolManifest ?? [];
  const names = manifest.map((tool: CoachToolManifest) => tool.name);
  for (const expected of [
    "knowledge.lookup_exercise",
    "knowledge.explain_rule",
    "timeline.record_user_report",
    "nutrition.record_observation",
    "plan.propose_energy_rebalance",
    "plan.adapt_from_user_report",
    "plan.substitute_exercise",
    "workout.report_set",
    "plan.trigger_replan_with_context",
    "plan.adapt_from_user_report",
  ]) {
    assert.ok(names.includes(expected), `manifest 缺 ${expected}`);
  }
});

test("首页 Coach 上报聚餐后生成仅未来的动态调整预览，确认前不改已生效计划", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: {
      id: "energy-profile", trainingExperience: "intermediate", locale: "zh-CN", dailyActivityLevel: "sedentary",
      demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 },
      locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "energy-goal", primaryGoal: "fat_loss_preserve_lean_mass", goalType: "fat_loss", successMetrics: ["weekly_training_adherence"],
      horizon: { startDate: "2026-08-03" }, status: "active",
      aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
    },
    mandate: { id: "energy-mandate", mode: "collaborative" },
    meta: { userId: "energy-user", actor: { kind: "user", id: "energy-user" }, deviceId: "phone", occurredAt: NOW, timezoneOffsetMinutes: 0, idempotencyKey: "energy-bootstrap" },
  });
  await app.materializeGoalCycle({ userId: "energy-user", trigger: "initial_plan", currentDate: "2026-08-03", idempotencyKey: "energy-plan" });
  const before = await app.readDomainProjection({ userId: "energy-user" });
  const session = await app.startSession({ userId: "energy-user", context: { kind: "today", ref: "2026-08-03" } });
  await runTurn(app, session.id, "plan.propose_energy_rebalance", { description: "今天出去聚餐吃多了", excessKcal: 600 });
  const snapshot = await ledger.read();
  const preview = snapshot.artifacts.find((item) => item.kind === "evidence_brief" && "planningPreview" in item && item.planningPreview?.proposal.planRevision.rollingEnergyAdjustment?.status === "gentle_rebalance");
  assert.ok(preview, `Agent 应给出与计划页相同的待确认未来调整预览；实际：${JSON.stringify(snapshot.artifacts.map((item) => ({ kind: item.kind, title: "title" in item ? item.title : undefined, summary: "summary" in item ? item.summary : undefined, adjustment: item.kind === "evidence_brief" && item.planningPreview?.proposal.planRevision.rollingEnergyAdjustment?.status })))}`);
  const after = await app.readDomainProjection({ userId: "energy-user" });
  assert.equal(after.plan?.revision, before.plan?.revision, "确认前不得改已生效的 PlanRevision");
  const logged = after.timeline.current.find((event) => event.fact.kind === "nutrition" && event.fact.reportedEnergyDeviationKcal === 600);
  assert.ok(logged, "用户明确报告的热量差必须作为可追溯 Timeline 事实保存");
});

test("首页 Coach 把临时行程写入 Timeline，并为未来训练生成待确认调整", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: {
      id: "adaptive-profile", trainingExperience: "intermediate", locale: "zh-CN",
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: { id: "adaptive-goal", primaryGoal: "hypertrophy", successMetrics: ["weekly_training_adherence"], horizon: { startDate: "2026-08-03" }, status: "active", missedSessionPolicy: "shift" },
    mandate: { id: "adaptive-mandate", mode: "collaborative" },
    meta: { userId: "adaptive-user", actor: { kind: "user", id: "adaptive-user" }, deviceId: "phone", occurredAt: NOW, timezoneOffsetMinutes: 0, idempotencyKey: "adaptive-bootstrap" },
  });
  await app.materializeGoalCycle({ userId: "adaptive-user", trigger: "initial_plan", currentDate: "2026-08-03", idempotencyKey: "adaptive-plan" });
  const before = await app.readDomainProjection({ userId: "adaptive-user" });
  const session = await app.startSession({ userId: "adaptive-user", context: { kind: "today", ref: "2026-08-03" } });
  await runTurn(app, session.id, "plan.adapt_from_user_report", {
    kind: "schedule", summary: "8 月 5 日出差，无法去健身房", unavailableDates: ["2026-08-05"],
  });
  const after = await app.readDomainProjection({ userId: "adaptive-user" });
  assert.ok(after.timeline.current.some((event) => event.fact.kind === "schedule" && event.fact.note?.includes("出差")), "行程变化应以用户原话保存为 Timeline 事实");
  assert.equal(after.plan?.revision, before.plan?.revision, "确认前不得替换当前已生效计划");
  const snapshot = await ledger.read();
  const preview = snapshot.artifacts.find((item) => item.kind === "evidence_brief" && item.planningPreview?.status === "awaiting_confirmation");
  assert.ok(preview, "应给出仅未来生效的调整预览");
  await app.confirmPlanningPreview({ userId: "adaptive-user", previewId: preview.id, idempotencyKey: "confirm-travel-replan" });
  assert.ok((await app.readDomainProjection({ userId: "adaptive-user" })).plan!.revision > before.plan!.revision, "确认出差重排时必须重放受影响日期，而不是错误判为 stale");
});

test("离线首页 Agent 能从明确的日程自然语言进入通用调整闭环", async () => {
  const { app } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true, localProvider: true });
  const session = await bootstrap(app);
  await app.materializeGoalCycle({ userId: "user-1", trigger: "initial_plan", currentDate: "2026-08-03", idempotencyKey: "local-adaptive-plan" });
  await app.sendCoachTurn({ sessionId: session.id, text: "我 2026-08-05 出差，没时间去健身房" });
  const projection = await app.readDomainProjection({ userId: "user-1" });
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "schedule" && event.fact.note?.includes("出差")), "本地 Agent 应调用通用调整工具而非只回复文字");
});

test("首页 Agent 收到『睡得不好，能换肩训练吗』但无评分时先追问，不擅自执行或改计划", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true, localProvider: true });
  const session = await bootstrap(app);
  await app.materializeGoalCycle({ userId: "user-1", trigger: "initial_plan", currentDate: "2026-08-03", idempotencyKey: "local-recovery-plan" });
  const before = await app.readDomainProjection({ userId: "user-1" });
  await app.sendCoachTurn({ sessionId: session.id, text: "我今天睡得不好，可以换肩训练吗" });
  const after = await app.readDomainProjection({ userId: "user-1" });
  const snapshot = await ledger.read();
  const answer = [...snapshot.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  assert.match(answer, /恢复评分|疲劳评分/);
  assert.equal(snapshot.toolCalls.length, 0, "恢复严重度未知时不得替用户执行调整工具");
  assert.equal(after.plan?.revision, before.plan?.revision, "追问阶段不得改写当前计划");
});

test("首页 Agent 能用『腿酸、其他位置还行』生成保守肩日预览，但不把推断写成恢复评分", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true, localProvider: true });
  const session = await bootstrap(app, { mode: "collaborative" }, 4);
  await app.materializeGoalCycle({ userId: "user-1", trigger: "initial_plan", currentDate: "2026-08-03", idempotencyKey: "local-localized-recovery-plan" });
  const before = await app.readDomainProjection({ userId: "user-1" });
  await app.sendCoachTurn({ sessionId: session.id, text: "我就是睡得不好，你自己评估。前天练了腿，腿酸其他位置感觉还行" });
  const after = await app.readDomainProjection({ userId: "user-1" });
  const snapshot = await ledger.read();
  const answer = [...snapshot.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  assert.match(answer, /保守肩日/);
  const adaptiveCall = snapshot.toolCalls.find((call) => call.toolName === "plan.adapt_from_user_report");
  assert.ok(adaptiveCall, "应调用 Agent 的调整工具来创建预览");
  const preview = [...snapshot.artifacts].reverse().find(
    (artifact) => artifact.kind === "evidence_brief"
      && artifact.planningPreview?.status === "awaiting_confirmation"
      && artifact.planningPreview.request.trigger === "recovery_downgraded",
  );
  assert.ok(preview, "应生成待确认的未来计划调整预览");
  if (!preview || preview.kind !== "evidence_brief" || !preview.planningPreview) return;
  const nextTraining = preview.planningPreview.proposal.planRevision.sessions.find((session) => session.tasks.length > 0);
  assert.match(nextTraining?.title ?? "", /肩/, "用户明确想换肩时，预览必须把下一节实际改为肩部课，而不是只在文案里说可以练肩");
  const workingSets = nextTraining?.tasks.flatMap((task) => task.sets) ?? [];
  assert.ok(workingSets.some((set) => (set.targetRirRange?.min ?? 0) >= 4), "轻度恢复调整必须实际提高余力目标");
  assert.ok(workingSets.some((set) => (set.rest?.value ?? 0) >= 75), "轻度恢复调整必须实际延长组间休息");
  const card = new ArtifactCardRegistry().render(preview, "awaiting_user");
  assert.equal(card.title, "保守肩日调整待确认", "首页对话必须收到可操作的结构化调整卡，而不是仅 Markdown 文案");
  assert.equal(card.actions[0]?.id, "open_future_plan_preview");
  const totalSets = (plan: { sessions: readonly { tasks: readonly { sets: readonly unknown[] }[] }[] }) =>
    plan.sessions.flatMap((session) => session.tasks).reduce((sum, task) => sum + task.sets.length, 0);
  assert.ok(
    totalSets(preview.planningPreview.proposal.planRevision) < totalSets(before.plan!.value),
    `保守肩日预览必须实际减少工作组，而不是只改文案：before=${totalSets(before.plan!.value)}, proposed=${totalSets(preview.planningPreview.proposal.planRevision)}`,
  );
  assert.equal(after.plan?.revision, before.plan?.revision, "预览阶段不得改写当前计划");
  assert.equal(after.recoveryConstraints.length, before.recoveryConstraints.length, "定性判断不得伪造成已确认恢复评分或长期约束");
  await app.confirmPlanningPreview({ userId: "user-1", previewId: preview.id, idempotencyKey: "confirm-localized-recovery-preview" });
  const confirmed = await app.readDomainProjection({ userId: "user-1" });
  assert.ok(confirmed.plan!.revision > before.plan!.revision, "确认后才应物化保守恢复调整");
  assert.equal(confirmed.recoveryConstraints.length, before.recoveryConstraints.length, "确认短时调整也不得写成虚假的用户恢复评分");
});

test("首页 Agent 对常见的『睡眠差 + 局部腿酸 + 上肢可用 + 换肩』表达稳定触发待确认调整", async () => {
  const utterances = [
    "我就是睡得不好，你自己评估。前天练了腿，腿酸其他位置感觉还行",
    "昨晚没睡好，前天练腿现在腿还酸，但上肢状态没问题，今天换肩练。",
    "睡眠差，腿有点酸，其他部位还行，想练肩。",
    "我睡不好，腿部还在酸痛，其他位置感觉可以，安排肩部。",
  ];
  for (const [index, text] of utterances.entries()) {
    const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true, localProvider: true });
    const session = await bootstrap(app, { mode: "collaborative" }, 4);
    await app.materializeGoalCycle({ userId: "user-1", trigger: "initial_plan", currentDate: "2026-08-03", idempotencyKey: `stable-recovery-plan-${index}` });
    await app.sendCoachTurn({ sessionId: session.id, text });
    const snapshot = await ledger.read();
    const adaptiveCall = [...snapshot.toolCalls].reverse().find((call) => call.toolName === "plan.adapt_from_user_report");
    assert.ok(adaptiveCall, `表达 ${index + 1} 应由 Agent 调用计划调整工具：${text}`);
    const preview = [...snapshot.artifacts].reverse().find(
      (artifact) => artifact.kind === "evidence_brief"
        && artifact.planningPreview?.status === "awaiting_confirmation"
        && artifact.planningPreview.request.trigger === "recovery_downgraded",
    );
    assert.ok(preview, `表达 ${index + 1} 应产生待确认的恢复调整预览：${text}`);
    if (!preview || preview.kind !== "evidence_brief" || !preview.planningPreview) continue;
    const nextTraining = preview.planningPreview.proposal.planRevision.sessions.find((candidate) => candidate.tasks.length > 0);
    assert.match(nextTraining?.title ?? "", /肩/, `表达 ${index + 1} 的下一节必须实际换为肩部课`);
  }
});

test("协作授权下「记录饮食」→ nutrition.record_observation → 直接写入用户陈述", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "nutrition.record_observation", { items: ["两个鸡腿", "一碗米饭"], mealSlot: "lunch" });
  const snapshot = await ledger.read();
  assert.ok(snapshot.domainEvents.some((event) => event.name === "timeline.fact_appended" && event.payload.fact.kind === "nutrition"));
  assert.ok(snapshot.artifacts.some((item) => item.kind === "evidence_brief" && "title" in item && item.title === "已记录饮食"));
});

test("手动授权下「记录饮食」仍保留为确认草稿", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app, { mode: "manual" });
  await runTurn(app, session.id, "nutrition.record_observation", { items: ["两个鸡腿", "一碗米饭"], mealSlot: "lunch" });
  const snapshot = await ledger.read();
  const draft = snapshot.artifacts.find((item) => item.kind === "nutrition_observation_draft");
  assert.ok(draft, "草稿 artifact 落账");
  assert.ok(draft.missingness.includes("quantities_not_estimated_user_voice_record"));
  assert.equal(snapshot.domainEvents.some((event) => event.name === "timeline.fact_appended" && event.payload.fact.kind === "nutrition"), false);
});

test("协作授权下明确训练陈述可由 Coach 代记，并留下委托因果链", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "timeline.record_user_report", { kind: "training", summary: "胸背训练", durationMinutes: 75 });
  const projection = await app.readDomainProjection({ userId: "user-1" });
  const record = projection.timeline.current.find((event) => event.fact.kind === "training");
  assert.ok(record && record.fact.kind === "training");
  assert.equal(record.fact.reportedSession?.summary, "胸背训练");
  assert.ok(record.envelope?.causalRefs.includes("delegated_by:user-1"));
  assert.ok(ledger);
});

test("动作库外的明确力量训练可由 Coach 保留为自定义动作，不伪造成标准力量历史", async () => {
  const { app } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "timeline.record_user_report", {
    kind: "training",
    exercises: [{ name: "单臂绳索侧平举", sets: [{ reps: 12, loadKg: 7.5, rir: 2 }, { reps: 11, loadKg: 7.5, rir: 1 }] }],
  });
  const projection = await app.readDomainProjection({ userId: "user-1" });
  const record = projection.timeline.current.find((event) => event.fact.kind === "training");
  assert.ok(record && record.fact.kind === "training");
  const exercise = record.fact.reportedSession?.exercises?.[0];
  assert.equal(exercise?.name, "单臂绳索侧平举");
  assert.equal(exercise?.exerciseConceptId, undefined);
  assert.deepEqual(exercise?.sets?.map((set) => ({ reps: set.reps, loadKg: set.load?.value, rir: set.rir })), [{ reps: 12, loadKg: 7.5, rir: 2 }, { reps: 11, loadKg: 7.5, rir: 1 }]);
  assert.equal(record.fact.historicalSet, undefined);
});

test("Coach 估算的自定义有氧消耗即使已有代记授权也必须先确认", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "timeline.record_user_report", {
    kind: "activity", activityType: "室内抱石", durationMinutes: 60, intensity: "hard", energyEstimateKcal: 360,
  });
  let snapshot = await ledger.read();
  assert.equal(snapshot.domainEvents.some((event) => event.name === "timeline.fact_appended" && event.payload.fact.kind === "activity"), false);
  const draft = snapshot.artifacts.find((item) => item.kind === "timeline_record_draft");
  assert.ok(draft && draft.kind === "timeline_record_draft");
  assert.equal(draft.draft.source, "coach_estimate");
  assert.equal(draft.draft.fact.kind, "activity");
  assert.equal(draft.draft.fact.kind === "activity" ? draft.draft.fact.energyExpenditureSource : undefined, "agent_estimate");
  await app.invokeArtifactCardAction({ userId: "user-1", artifactId: draft.id, action: "confirm", idempotencyKey: "confirm-custom-cardio-estimate" });
  snapshot = await ledger.read();
  const fact = snapshot.domainEvents.find((event) => event.name === "timeline.fact_appended" && event.payload.fact.kind === "activity");
  assert.ok(fact && fact.name === "timeline.fact_appended" && fact.payload.fact.kind === "activity");
  assert.equal(fact.payload.fact.energyExpenditureSource, "agent_estimate");
  assert.equal(fact.payload.fact.confidence, "estimated");
});

test("记录范围要求确认时，Agent 不得代记明确陈述", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app, { mode: "collaborative", scopes: { recording: "confirm" } });
  await runTurn(app, session.id, "timeline.record_user_report", { kind: "activity", activityType: "跑步", durationMinutes: 30 });
  let snapshot = await ledger.read();
  assert.equal(snapshot.domainEvents.some((event) => event.name === "timeline.fact_appended" && event.payload.fact.kind === "activity"), false);
  const draft = snapshot.artifacts.find((item) => item.kind === "timeline_record_draft");
  assert.ok(draft && draft.kind === "timeline_record_draft");
  await app.invokeArtifactCardAction({
    userId: "user-1",
    artifactId: draft.id,
    action: "confirm",
    idempotencyKey: "confirm-user-report-draft",
  });
  snapshot = await ledger.read();
  assert.ok(snapshot.domainEvents.some((event) => event.name === "timeline.fact_appended" && event.payload.fact.kind === "activity"));
  assert.equal(snapshot.presentations.find((item) => item.artifactId === draft.id)?.status, "applied");
});

test("意图「换动作」→ substitute_exercise → 替换提案 artifact（负荷不复制）", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  const projection = await app.readDomainProjection({ userId: "user-1" });
  // bootstrap 后无已提交计划（preview 未确认）——先确认生成计划
  const previewArtifact = (await ledger.read()).artifacts.find(
    (item) => item.kind === "evidence_brief" && "planningPreview" in item && item.planningPreview,
  );
  assert.ok(previewArtifact);
  const decision = await app.confirmPlanningPreview({
    userId: "user-1",
    previewId: previewArtifact.id,
    idempotencyKey: "confirm-plan",
  });
  assert.equal(decision.kind, "plan_proposal");
  void projection;
  const plan = (await app.readDomainProjection({ userId: "user-1" })).plan?.value;
  const task = plan?.sessions.flatMap((item) => item.tasks)[0];
  assert.ok(task);
  await runTurn(app, session.id, "plan.substitute_exercise", { taskId: task.id, reason: "器械被占用" });
  const snapshot = await ledger.read();
  const substitution = snapshot.artifacts.find((item) => item.kind === "exercise_substitution");
  assert.ok(substitution, "替换提案 artifact 落账");
  assert.ok(substitution.capabilityBoundary.some((line: string) => line.includes("负荷不跨动作复制")));
});

test("意图「状态没变化」→ trigger_replan_with_context → 重排评估", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "plan.trigger_replan_with_context", { contextType: "progress_plateau", note: "四周没变化" });
  const snapshot = await ledger.read();
  const replanArtifact = snapshot.artifacts.find(
    (item) => item.kind === "evidence_brief" && "title" in item && item.title === "已带上下文触发重排",
  );
  assert.ok(replanArtifact, "重排 artifact 落账");
});

test("意图「查动作」→ lookup_exercise → 命中带免责声明；未收录 typed unknown", async () => {
  const { app, ledger } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "knowledge.lookup_exercise", { query: "俯卧撑" });
  let snapshot = await ledger.read();
  const hit = snapshot.artifacts.filter((item) => item.kind === "evidence_brief").at(-1);
  assert.ok(hit && "summary" in hit && hit.summary.some((line: string) => line.includes("预计参与")));

  await runTurn(app, session.id, "knowledge.lookup_exercise", { query: "攀岩" });
  snapshot = await ledger.read();
  const miss = snapshot.artifacts.filter((item) => item.kind === "evidence_brief").at(-1);
  assert.ok(miss && miss.missingness.includes("exercise_not_in_catalog"));
});

test("禁用开关关闭时新工具不可用", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: false, actionToolsEnabled: false });
  const session = await bootstrap(app);
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: "c1", toolName: "nutrition.record_observation", input: { items: ["鸡腿"] } },
    { type: "completed" },
  ]);
  const app2 = appWith(app, provider);
  await app2.sendCoachTurn({ sessionId: session.id, text: "记录" });
  // 禁用时 invoke 抛 unknown_tool，run 标记失败或降级——不断言崩溃
  const manifest = provider.requests[0]?.toolManifest ?? [];
  assert.ok(!manifest.some((tool: CoachToolManifest) => tool.name === "nutrition.record_observation"));
});

test("playbook 版本钉入 context manifest", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  const provider = new ScriptedLLMProvider([{ type: "completed" }]);
  const app2 = appWith(app, provider);
  await app2.sendCoachTurn({ sessionId: session.id, text: "看看" });
  const manifest = provider.requests[0]?.contextManifest;
  assert.equal(manifest?.playbookVersion, "playbook-2026-08-12/v4");
});

test("explain_rule 命中返回规则包与证据锚点，未命中 typed unknown", async () => {
  const { app, ledger } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "knowledge.explain_rule", { ruleId: "maxpower.training.hypertrophy" });
  let snapshot = await ledger.read();
  let brief = snapshot.artifacts.filter((item) => item.kind === "evidence_brief").at(-1);
  assert.ok(brief && "summary" in brief && brief.summary.some((line: string) => line.includes("performance_progression")));

  await runTurn(app, session.id, "knowledge.explain_rule", { ruleId: "no.such.rule" });
  snapshot = await ledger.read();
  brief = snapshot.artifacts.filter((item) => item.kind === "evidence_brief").at(-1);
  assert.ok(brief?.missingness.includes("rule_not_in_pack"));
});

test("意图「报组」→ workout.report_set → 组以 user_confirmed 落账", async () => {
  const { app, ledger } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  const previewArtifact = (await ledger.read()).artifacts.find(
    (item) => item.kind === "evidence_brief" && "planningPreview" in item && item.planningPreview,
  );
  await app.confirmPlanningPreview({ userId: "user-1", previewId: previewArtifact!.id, idempotencyKey: "confirm-plan" });
  const plan = (await app.readDomainProjection({ userId: "user-1" })).plan!.value;
  const trainingSession = plan.sessions.find((item) => item.tasks.length > 0)!;
  await app.prepareWorkoutSession({
    userId: "user-1",
    workoutId: "workout-rt",
    prescriptionRef: { planId: plan.id, planRevision: 1, sessionPrescriptionId: trainingSession.id },
    idempotencyKey: "prep-rt",
  });
  await app.activateWorkoutSession({ userId: "user-1", workoutId: "workout-rt", idempotencyKey: "act-rt" });
  await runTurn(app, session.id, "workout.report_set", { workoutId: "workout-rt", actualReps: 8, actualLoadKg: 60, actualRir: 3 });
  const workout = (await app.readDomainProjection({ userId: "user-1" })).workouts.find((item) => item.id === "workout-rt");
  assert.equal(workout?.setOutcomes[0]?.actualLoad?.value, 60);
  assert.equal(workout?.setOutcomes[0]?.source, "user_confirmed");
});

test("非法工具输入被 schema 拒绝", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: "bad-1", toolName: "nutrition.record_observation", input: { items: [] } },
    { type: "completed" },
  ]);
  const app2 = appWith(app, provider);
  await app2.sendCoachTurn({ sessionId: session.id, text: "记录" });
  const snapshot = await (app as unknown as { ledger: InMemoryCoachLedger }).ledger.read();
  const failed = snapshot.toolCalls.find((call) => call.id === "bad-1");
  assert.ok(!failed || failed.status === "output_error", "空 items 应被拒绝");
});

test("playbook 文本覆盖三形态路由（静态断言）", async () => {
  const { readFileSync } = await import("node:fs");
  const playbook = readFileSync("src/coach/playbook.ts", "utf8");
  for (const expected of [
    "nutrition.record_observation",
    "timeline.record_user_report",
    "plan.substitute_exercise",
    "workout.report_set",
    "plan.trigger_replan_with_context",
    "knowledge.lookup_exercise",
    "knowledge.explain_rule",
    "先查后答",
  ]) {
    assert.ok(playbook.includes(expected), `playbook 缺 ${expected}`);
  }
});

test("替换动作时可指定目标动作 id", async () => {
  const { app, ledger } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  const previewArtifact = (await ledger.read()).artifacts.find(
    (item) => item.kind === "evidence_brief" && "planningPreview" in item && item.planningPreview,
  );
  await app.confirmPlanningPreview({ userId: "user-1", previewId: previewArtifact!.id, idempotencyKey: "confirm-plan" });
  const plan = (await app.readDomainProjection({ userId: "user-1" })).plan!.value;
  const task = plan.sessions.flatMap((item) => item.tasks)[0]!;
  await runTurn(app, session.id, "plan.substitute_exercise", {
    taskId: task.id,
    replacementExerciseId: "dumbbell_bench_press.flat.standard",
    reason: "杠铃被占用",
  });
  const snapshot = await ledger.read();
  assert.ok(snapshot.artifacts.some((item) => item.kind === "exercise_substitution"));
});

test("带 note 的领域外提问不产生任何 artifact（静默读完）", async () => {
  const { app, ledger } = fixture({ knowledgeToolsEnabled: true, actionToolsEnabled: true });
  const session = await bootstrap(app);
  const provider = new ScriptedLLMProvider([
    { type: "text-delta", delta: "这个问题超出我的服务范围，建议咨询相关专业人士。" },
    { type: "completed" },
  ]);
  const app2 = appWith(app, provider);
  const before = (await ledger.read()).artifacts.length;
  await app2.sendCoachTurn({ sessionId: session.id, text: "帮我写个 Python 脚本" });
  const after = (await ledger.read()).artifacts.length;
  assert.equal(after, before, "纯文本回答不产生 artifact");
});
