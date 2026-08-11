import assert from "node:assert/strict";
import test from "node:test";

import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { CoachToolManifest } from "../../src/coach/toolRegistry";

/**
 * 场景 playbook eval（ticket 06）：意图 → 工具序列 → 落账状态。
 * 用 ScriptedLLMProvider 确定性运行，不依赖真实模型。
 * 门槛：本套件全绿才允许翻转 actionToolsEnabled / knowledgeToolsEnabled。
 */

const NOW = "2026-08-03T10:00:00.000Z";

function fixture(options: { knowledgeToolsEnabled?: boolean; actionToolsEnabled?: boolean } = {}) {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => NOW, nextId: (prefix: string) => `${prefix}-${++sequence}` },
    knowledgeToolsEnabled: options.knowledgeToolsEnabled,
    actionToolsEnabled: options.actionToolsEnabled,
  });
  return { app, ledger };
}

async function bootstrap(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: {
      id: "profile-1",
      trainingExperience: "intermediate",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 75 },
      locations: [{ id: "gym-main", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      successMetrics: ["weekly_training_adherence"],
      horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
      status: "active",
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
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
  return new CoachApplication({
    ledger: deps.ledger,
    runtime: deps.runtime,
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
    "nutrition.record_observation",
    "plan.substitute_exercise",
    "workout.report_set",
    "plan.trigger_replan_with_context",
  ]) {
    assert.ok(names.includes(expected), `manifest 缺 ${expected}`);
  }
});

test("意图「记录饮食」→ nutrition.record_observation → 草稿 artifact", async () => {
  const { app, ledger } = fixture({ actionToolsEnabled: true, knowledgeToolsEnabled: true });
  const session = await bootstrap(app);
  await runTurn(app, session.id, "nutrition.record_observation", { items: ["两个鸡腿", "一碗米饭"], mealSlot: "lunch" });
  const snapshot = await ledger.read();
  const draft = snapshot.artifacts.find((item) => item.kind === "nutrition_observation_draft");
  assert.ok(draft, "草稿 artifact 落账");
  assert.ok(draft.missingness.includes("quantities_not_estimated_user_voice_record"));
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
  assert.equal(manifest?.playbookVersion, "playbook-2026-08-11/v1");
});
