import assert from "node:assert/strict";
import test from "node:test";

import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

/**
 * Headless Coach lifecycle matrix.
 *
 * This runs the production AgentRuntime → ToolRegistry → Ledger → Planner
 * path without mounting the mobile client and without a remote model.  The
 * scripted provider is only the deterministic stand-in for language intent
 * extraction; every tool, fact write, preview and confirmation is real.
 */

const USER_ID = "lifecycle-user";

interface HeadlessHarness {
  readonly ledger: InMemoryCoachLedger;
  readonly app: (provider?: ScriptedLLMProvider) => CoachApplication;
  now: string;
  turn: number;
}

function harness(): HeadlessHarness {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const state: HeadlessHarness = {
    ledger,
    now: "2026-08-03T10:00:00.000Z",
    turn: 0,
    app: (provider?: ScriptedLLMProvider) => new CoachApplication({
      ledger,
      runtime: {
        now: () => state.now,
        nextId: (prefix: string) => `lifecycle:${prefix}-${++sequence}`,
      },
      ...(provider ? { llmProvider: provider } : {}),
      knowledgeToolsEnabled: true,
      actionToolsEnabled: true,
    }),
  };
  return state;
}

async function bootstrap(h: HeadlessHarness) {
  const app = h.app();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: {
      id: "lifecycle-profile",
      locale: "zh-CN",
      trainingExperience: "intermediate",
      dailyActivityLevel: "sedentary",
      demographics: {
        ageYears: 30,
        sex: "male",
        height: { value: 178, unit: "cm" },
        currentWeight: { value: 75, unit: "kg" },
      },
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "lifecycle-goal",
      primaryGoal: "fat_loss_preserve_lean_mass",
      goalType: "fat_loss",
      successMetrics: ["weekly_training_adherence"],
      horizon: { startDate: "2026-08-03" },
      status: "active",
      missedSessionPolicy: "shift",
      aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
    },
    mandate: { id: "lifecycle-mandate", mode: "collaborative" },
    meta: {
      userId: USER_ID,
      actor: { kind: "user", id: USER_ID },
      deviceId: "headless-e2e",
      occurredAt: h.now,
      timezoneOffsetMinutes: 480,
      idempotencyKey: "lifecycle-bootstrap",
    },
  });
  const initial = await app.createPlanningPreview({
    userId: USER_ID,
    currentDate: h.now.slice(0, 10),
    trigger: "initial_plan",
    idempotencyKey: "lifecycle-initial-preview",
  });
  assert.ok(initial.planningPreview, "首次规划必须形成待确认预览");
  await app.confirmPlanningPreview({ userId: USER_ID, previewId: initial.id, idempotencyKey: "lifecycle-initial-confirm" });
  const session = await app.startSession({ userId: USER_ID, context: { kind: "today", ref: h.now.slice(0, 10) }, title: "headless lifecycle" });
  return session.id;
}

async function agentTool(
  h: HeadlessHarness,
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  text = "测试场景上报",
) {
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: `tool:${toolName}:${++h.turn}`, toolName, input },
    { type: "completed" },
  ]);
  await h.app(provider).sendCoachTurn({ sessionId, text });
}

async function confirmNewestPlanPreview(h: HeadlessHarness, key: string) {
  const snapshot = await h.ledger.read();
  const preview = [...snapshot.artifacts].reverse().find(
    (artifact) => artifact.kind === "evidence_brief" && artifact.planningPreview?.status === "awaiting_confirmation",
  );
  assert.ok(preview && preview.kind === "evidence_brief", `${key}: 应存在待确认的未来计划预览`);
  return h.app().confirmPlanningPreview({ userId: USER_ID, previewId: preview.id, idempotencyKey: `lifecycle:${key}:confirm` });
}

function planRevision(projection: Awaited<ReturnType<CoachApplication["readDomainProjection"]>>) {
  assert.ok(projection.plan, "计划应已确认并落账");
  return projection.plan.revision;
}

async function runStrictConsistent() {
  const h = harness();
  const sessionId = await bootstrap(h);
  h.now = "2026-08-04T19:00:00.000Z";
  await agentTool(h, sessionId, "timeline.record_user_report", {
    kind: "training", summary: "按计划完成上肢推训练", durationMinutes: 72,
    exercises: [{ name: "卧推", sets: [{ reps: 8, loadKg: 72.5, rir: 2 }] }],
  });
  await agentTool(h, sessionId, "timeline.record_user_report", { kind: "sleep", durationMinutes: 450, quality: 4 });
  await agentTool(h, sessionId, "timeline.record_user_report", { kind: "body", metric: "body_weight", value: 74.8 });
  await agentTool(h, sessionId, "nutrition.record_observation", { items: ["鸡胸肉", "米饭", "西兰花"], mealSlot: "dinner", note: "按计划完成" });
  h.now = "2026-08-09T10:00:00.000Z";
  await agentTool(h, sessionId, "coach.show_weekly_report", { weekStart: "2026-08-03", weekEnd: "2026-08-09" });
  const projection = await h.app().readDomainProjection({ userId: USER_ID });
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "training"));
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "sleep"));
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "nutrition"));
  const snapshot = await h.ledger.read();
  assert.ok(snapshot.artifacts.some((artifact) => artifact.kind === "weekly_coach_report"), "严格稳定场景应产出记录汇总分析");
  return { scenario: "训练稳定 + 饮食严格", revision: planRevision(projection), facts: projection.timeline.current.length };
}

async function runTrainingUnstable() {
  const h = harness();
  const sessionId = await bootstrap(h);
  const before = planRevision(await h.app().readDomainProjection({ userId: USER_ID }));
  h.now = "2026-08-04T08:00:00.000Z";
  await agentTool(h, sessionId, "plan.adapt_from_user_report", {
    kind: "recovery", summary: "昨晚睡差，今天恢复 2/5，疲劳 9/10", perceivedRecovery: 2, fatigue: 9,
  });
  const afterReport = await h.app().readDomainProjection({ userId: USER_ID });
  assert.ok(afterReport.recoveryConstraints.some((item) => item.value.level !== "normal"), "不稳定训练应先形成可追溯恢复约束");
  await confirmNewestPlanPreview(h, "recovery");
  const after = await h.app().readDomainProjection({ userId: USER_ID });
  assert.ok(planRevision(after) > before, "确认后才应写入恢复适配后的新计划版本");
  return { scenario: "训练不稳定 + 恢复下降", revision: planRevision(after), facts: after.timeline.current.length };
}

async function runLooseNutritionNoFalseCompensation() {
  const h = harness();
  const sessionId = await bootstrap(h);
  h.now = "2026-08-05T20:00:00.000Z";
  await agentTool(h, sessionId, "nutrition.record_observation", {
    items: ["外卖盖饭"], mealSlot: "dinner", note: "今天没有精确记录热量，感觉偏多",
  });
  const projection = await h.app().readDomainProjection({ userId: USER_ID });
  const nutrition = projection.timeline.current.find((event) => event.fact.kind === "nutrition");
  assert.ok(nutrition && nutrition.fact.kind === "nutrition");
  assert.equal(nutrition.fact.reportedEnergyDeviationKcal, undefined, "不知道热量差时不得伪造可用于补偿的数值");
  return { scenario: "训练相对稳定 + 饮食不严格但差额未知", revision: planRevision(projection), facts: projection.timeline.current.length };
}

async function runOccasionalIndulgence() {
  const h = harness();
  const sessionId = await bootstrap(h);
  const before = planRevision(await h.app().readDomainProjection({ userId: USER_ID }));
  h.now = "2026-08-06T21:00:00.000Z";
  await agentTool(h, sessionId, "plan.propose_energy_rebalance", { description: "聚餐后比当天计划多吃约 650 kcal", excessKcal: 650 });
  const unconfirmed = await h.app().readDomainProjection({ userId: USER_ID });
  assert.equal(planRevision(unconfirmed), before, "预览出现时不能静默修改已确认计划");
  assert.ok(unconfirmed.timeline.current.some((event) => event.fact.kind === "nutrition" && event.fact.reportedEnergyDeviationKcal === 650));
  await confirmNewestPlanPreview(h, "energy");
  const after = await h.app().readDomainProjection({ userId: USER_ID });
  assert.ok(planRevision(after) > before, "用户确认后才将温和能量回调写为新计划版本");
  return { scenario: "偶尔放纵 + 已知热量差", revision: planRevision(after), facts: after.timeline.current.length };
}

test("headless Agent 生命周期矩阵：首次规划 → 日常记录 → 汇总/动态调整 → 确认", async () => {
  const results = [
    await runStrictConsistent(),
    await runTrainingUnstable(),
    await runLooseNutritionNoFalseCompensation(),
    await runOccasionalIndulgence(),
  ];
  console.log("COACH_LIFECYCLE_E2E=" + JSON.stringify(results));
  assert.equal(results.length, 4);
});
