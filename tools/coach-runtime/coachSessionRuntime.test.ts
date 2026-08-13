import assert from "node:assert/strict";
import test from "node:test";

import {
  LocalCoachProvider,
  ProviderServiceError,
  ScriptedLLMProvider,
  type LLMProvider,
} from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function runtimeFixture(
  provider?: LLMProvider,
  options: { providerExecutionPolicy?: { idleTimeoutMs?: number } } = {},
) {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const dependencies = {
    ledger,
    runtime: {
      now: () => "2026-08-08T08:00:00.000Z",
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    ...(provider ? { llmProvider: provider } : {}),
    ...options,
  };
  return { ledger, dependencies, app: new CoachApplication(dependencies) };
}

async function seed(app: CoachApplication, userId: string) {
  await app.seedUserState({
    userId,
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢推",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60, targetRir: 2 }],
    },
  });
}

test("task-scoped CoachSession 只有一个前台 active，并可完成、归档、搜索和重新打开", async () => {
  const state = runtimeFixture();
  const today = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
    title: "今天安排",
  });
  const report = await state.app.startSession({
    userId: "user-1",
    context: { kind: "progress", ref: "2026-W32" },
    title: "第 32 周周报",
  });
  assert.equal((await state.app.readSession(today.id)).status, "suspended");
  assert.equal((await state.app.readSession(report.id)).status, "active");
  assert.equal((await state.app.listCoachSessions({ userId: "user-1", status: "active" })).length, 1);

  await state.app.setSessionStatus(report.id, "completed");
  await state.app.setSessionStatus(today.id, "active");
  assert.equal((await state.app.readSession(today.id)).taskKind, "today_plan");
  assert.equal(
    (await state.app.listCoachSessions({ userId: "user-1", query: "周报" }))[0]?.id,
    report.id,
  );
  await state.app.setSessionStatus(report.id, "archived");
  assert.equal(
    (await state.app.listCoachSessions({ userId: "user-1", status: "archived" }))[0]?.id,
    report.id,
  );
});

test("Provider 只能调用闭合周报工具，客户端保存 artifact 后以同一 tool identity 呈现", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "weekly-report-tool-1",
      toolName: "coach.show_weekly_report",
      input: { weekStart: "2026-08-03", weekEnd: "2026-08-09" },
    },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "progress", ref: "2026-W32" },
  });
  await seed(state.app, "user-1");
  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "看看本周情况" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "weekly-report-tool-1");
  assert.equal(ready.artifactRef.kind, "weekly_coach_report");
  const snapshot = await state.ledger.read();
  const report = snapshot.artifacts.find((artifact) => artifact.kind === "weekly_coach_report");
  assert.ok(report && report.kind === "weekly_coach_report");
  assert.equal(report.userId, "user-1");
  assert.equal(snapshot.presentations.find((item) => item.artifactId === report.id)?.renderer, "weekly_coach_report/1");
  const manifest = provider.requests[0]?.toolManifest;
  assert.ok(manifest?.some((tool) => tool.name === "coach.show_weekly_report" && tool.output === "artifact_ref"));
  assert.ok(manifest?.some((tool) => tool.name === "ui.request_choice" && tool.executionMode === "human_in_loop"));
  const choiceSchema = manifest?.find((tool) => tool.name === "ui.request_choice")?.inputSchema;
  const optionsSchema = (choiceSchema?.properties as Record<string, Record<string, unknown>> | undefined)?.options;
  assert.deepEqual((optionsSchema?.items as Record<string, unknown> | undefined)?.required, ["id", "label"]);
  assert.equal((optionsSchema?.items as Record<string, unknown> | undefined)?.additionalProperties, false);
  assert.equal(manifest?.every((tool) => tool.schemaVersion === 1 && tool.outputLimit === 1), true);
});

test("周期回顾工具只呈现本地周期事实，不能把 Provider 文本变成计划修改", async () => {
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: "mesocycle-review-tool-1", toolName: "coach.show_mesocycle_review", input: {} },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "period-user", actor: { kind: "user", id: "period-user" }, deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z", timezoneOffsetMinutes: 0, idempotencyKey: "period-bootstrap",
    },
    profile: {
      id: "period-profile", trainingExperience: "beginner", locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{ id: "period-home", kind: "home", environment: { space: "medium", noise: "quiet" }, availableEquipment: ["bodyweight", "floor_space"] }],
    },
    goalContract: { id: "period-goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08", endDate: "2026-09-19" }, status: "active" },
    mandate: { id: "period-mandate", mode: "collaborative" },
  });
  await state.app.materializeGoalCycle({ userId: "period-user", trigger: "initial_plan", currentDate: "2026-08-08", idempotencyKey: "period-plan" });
  const planEventsBefore = (await state.ledger.read()).domainEvents.filter((event) => event.name === "plan.revised").length;
  const session = await state.app.startSession({ userId: "period-user", context: { kind: "progress", ref: "2026-08" } });
  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "看一下我的训练周期" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "mesocycle-review-tool-1");
  assert.equal(ready.artifactRef.kind, "mesocycle_review");
  const snapshot = await state.ledger.read();
  const review = snapshot.artifacts.find((artifact) => artifact.kind === "mesocycle_review");
  assert.ok(review && review.kind === "mesocycle_review");
  assert.equal(snapshot.presentations.find((item) => item.artifactId === review.id)?.renderer, "mesocycle_review/1");
  assert.equal(snapshot.domainEvents.filter((event) => event.name === "plan.revised").length, planEventsBefore);
  assert.ok(provider.requests[0]?.toolManifest.some((tool) => tool.name === "coach.show_mesocycle_review" && tool.output === "artifact_ref"));
});

test("未完成的 Provider 工具参数只投影通用 loading，完成校验后才执行；取消保持同一 Run 终止", async () => {
  let entered: (() => void) | undefined;
  const provider: LLMProvider = {
    kind: "cancellable-fixture",
    usesNetwork: false,
    async *stream(request) {
      yield { type: "tool-input-delta", toolCallId: "streamed-today", toolName: "plan.show_today", delta: '{"date":' };
      yield { type: "tool-call", toolCallId: "streamed-today", toolName: "plan.show_today", input: { date: "2026-08-08" } };
      await new Promise<void>((resolve) => {
        entered = resolve;
        request.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      if (request.signal?.aborted) yield { type: "cancelled", reason: "user" };
      else yield { type: "completed" };
    },
  };
  const state = runtimeFixture(provider);
  await seed(state.app, "user-1");
  const session = await state.app.startSession({ userId: "user-1", context: { kind: "today", ref: "2026-08-08" } });
  const running = state.app.sendCoachTurn({ sessionId: session.id, text: "看今天计划" });
  while (!entered) await new Promise((resolve) => setTimeout(resolve, 0));

  const beforeCancel = await state.ledger.read();
  assert.ok(beforeCancel.runEvents.some((event) => event.type === "tool-state" && event.state === "input-streaming"));
  assert.ok(beforeCancel.artifacts.some((artifact) => artifact.kind === "today_plan"));
  const result = await state.app.cancelCoachRun({ sessionId: session.id });
  assert.equal(result.cancelled, true);
  await running;
  const afterCancel = await state.ledger.read();
  assert.equal(afterCancel.runs.find((run) => run.id === result.runId)?.status, "terminated");
  assert.equal(afterCancel.toolCalls.find((call) => call.id === "streamed-today")?.status, "output_available");
});

test("Provider 无事件超时会中止同一 Run 并阻止迟到的 ToolCall 写入", async () => {
  let aborted = false;
  const provider: LLMProvider = {
    kind: "timeout-fixture",
    usesNetwork: false,
    async *stream(request) {
      await new Promise<void>((resolve) => {
        request.signal?.addEventListener("abort", () => {
          aborted = true;
          resolve();
        }, { once: true });
      });
      // A misbehaving adapter can still produce data after cancellation. The
      // runtime must not turn that late event into a tool execution or card.
      yield {
        type: "tool-call",
        toolCallId: "late-timeout-tool",
        toolName: "plan.show_today",
        input: { date: "2026-08-08" },
      };
      yield { type: "completed" };
    },
  };
  const state = runtimeFixture(provider, { providerExecutionPolicy: { idleTimeoutMs: 5 } });
  await seed(state.app, "user-1");
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "看今天计划" });
  assert.equal(aborted, true);
  assert.equal(events.some((event) => event.type === "run-error" && event.code === "provider_error"), true);

  // Let the deliberately late fixture resume once. It must still be ignored.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const snapshot = await state.ledger.read();
  const run = snapshot.runs.find((candidate) => candidate.sessionId === session.id)!;
  assert.equal(run.status, "failed");
  assert.equal(run.terminalCode, "provider_timeout");
  assert.equal(snapshot.toolCalls.some((call) => call.id === "late-timeout-tool"), false);
  assert.equal(snapshot.artifacts.some((artifact) => artifact.kind === "today_plan"), false);
  const timeoutAudit = snapshot.toolAudit.find(
    (item) => item.runId === run.id && item.phase === "internal_error" && item.metadata.failureCode === "provider_timeout",
  );
  assert.ok(timeoutAudit);
  assert.equal(timeoutAudit.metadata.idleTimeoutMs, 5);
});

test("云端额度耗尽会停止 Run 并明确告知用户，不降级到本地语言模型", async () => {
  const provider: LLMProvider = {
    kind: "maxpower-cloud",
    usesNetwork: true,
    async *stream() {
      throw new ProviderServiceError("allowance_exhausted");
    },
  };
  const state = runtimeFixture(provider);
  await seed(state.app, "user-1");
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "继续" });
  assert.equal(events.some(
    (event) => event.type === "text-delta" && event.delta === "云端 AI 额度已用完，暂时无法继续使用 Agent。",
  ), true);
  const run = (await state.ledger.read()).runs.find((candidate) => candidate.sessionId === session.id);
  assert.equal(run?.status, "failed");
  assert.equal(run?.terminalCode, "provider_error");
});

test("恢复简报由本地恢复事实生成固定卡片，Provider 不能直接写计划", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "recovery-brief-tool-1",
      toolName: "recovery.show_brief",
      input: {},
    },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await seed(state.app, "user-1");
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "recovery-brief-bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  const decision = state.app.evaluateRecoveryCheckIn({
    userId: "user-1",
    validUntil: "2026-08-09T08:00:00.000Z",
    checkIn: { perceivedRecovery: 2, fatigue: 8, comparablePerformanceDeclines: 2 },
  });
  await state.app.commitRecoveryConstraint({
    userId: "user-1",
    constraint: decision.constraint,
    idempotencyKey: "recovery-brief-constraint",
  });
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "看看我今天的恢复安排" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "recovery-brief-tool-1");
  assert.equal(ready.artifactRef.kind, "recovery_brief");
  const snapshot = await state.ledger.read();
  const brief = snapshot.artifacts.find((artifact) => artifact.kind === "recovery_brief");
  assert.ok(brief && brief.kind === "recovery_brief");
  assert.equal(brief.status, "active_constraint");
  assert.equal(brief.constraint?.level, "recovery_priority");
  assert.equal(snapshot.users.find((user) => user.userId === "user-1")?.plan.revision, 1);
  assert.equal(snapshot.presentations.find((item) => item.artifactId === brief.id)?.renderer, "recovery_brief/1");
});

test("Provider 可调用只读 recovery timeline assessment，结果不会变成恢复事实或计划写入", async () => {
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: "recovery-evaluate-tool-1", toolName: "recovery.evaluate_timeline", input: {} },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await seed(state.app, "user-1");
  const session = await state.app.startSession({ userId: "user-1", context: { kind: "today", ref: "2026-08-08" } });
  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "根据记录看一下恢复" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "recovery-evaluate-tool-1");
  const snapshot = await state.ledger.read();
  const artifact = snapshot.artifacts.find((item) => item.id === ready.artifactRef.id);
  assert.ok(artifact && artifact.kind === "recovery_brief");
  assert.equal(artifact.status, "timeline_assessment");
  assert.equal(snapshot.domainEvents.some((event) => event.name === "recovery_constraint.created"), false);
  assert.equal(snapshot.users.find((user) => user.userId === "user-1")?.plan.revision, 1);
  assert.ok(provider.requests[0]?.toolManifest.some((tool) => tool.name === "recovery.evaluate_timeline" && tool.inputSchema.additionalProperties === false));
});

test("安全约束由固定 SafetyHold 卡片覆盖普通建议，Provider 不能绕过或修改限制", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "safety-hold-tool-1",
      toolName: "safety.show_hold",
      input: {},
    },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "safety-user",
      actor: { kind: "user", id: "safety-user" },
      deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "safety-bootstrap",
    },
    profile: { id: "safety-profile", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "safety-goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "safety-mandate", mode: "collaborative" },
  });
  await state.app.executeDomainCommand({
    type: "safety_constraint.revise",
    meta: {
      userId: "safety-user",
      actor: { kind: "user", id: "safety-user" },
      deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "safety-hold",
    },
    safetyConstraintId: "safety-hold-1",
    expectedRevision: 0,
    safetyConstraint: {
      id: "safety-hold-1",
      disposition: "pause_and_confirm",
      reasons: ["explicit_new_sharp_pain"],
      stopSignals: ["new_significant_pain"],
      professionalConstraints: [],
      validUntil: "2026-08-09T08:00:00.000Z",
    },
  });
  const session = await state.app.startSession({
    userId: "safety-user",
    context: { kind: "workout", ref: "workout-1" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "请看安全限制" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "safety-hold-tool-1");
  assert.equal(ready.artifactRef.kind, "safety_hold");
  const snapshot = await state.ledger.read();
  const hold = snapshot.artifacts.find((artifact) => artifact.kind === "safety_hold");
  assert.ok(hold && hold.kind === "safety_hold");
  assert.equal(hold.status, "active_hold");
  assert.equal(hold.constraint?.disposition, "pause_and_confirm");
  assert.equal(snapshot.domainEvents.filter((event) => event.name === "plan.revised").length, 0);
  assert.equal(snapshot.presentations.find((item) => item.artifactId === hold.id)?.renderer, "safety_hold/1");
});

test("营养策略卡只读取已提交策略，Provider 不可直接改写摄入或目标", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "nutrition-strategy-tool-1",
      toolName: "nutrition.show_strategy",
      input: {},
    },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "nutrition-user",
      actor: { kind: "user", id: "nutrition-user" },
      deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "nutrition-brief-bootstrap",
    },
    profile: { id: "nutrition-profile", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "nutrition-goal", primaryGoal: "fat_loss_preserve_lean_mass", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "nutrition-mandate", mode: "collaborative" },
  });
  const strategy = state.app.createNutritionStrategy({
    id: "nutrition-strategy-1",
    goalContractRef: { kind: "goal_contract", id: "nutrition-goal", revision: 1 },
    phase: "fat_loss_preserve_lean_mass",
    bodyMassKg: 70,
    estimatedMaintenanceKcal: 2200,
    reviewWindow: { startsAt: "2026-08-08", endsAt: "2026-08-22", minimumWeightObservations: 3 },
    safety: { adultConfirmed: true },
  });
  await state.app.commitNutritionStrategy({
    userId: "nutrition-user",
    strategy,
    idempotencyKey: "nutrition-strategy-commit",
  });
  const session = await state.app.startSession({
    userId: "nutrition-user",
    context: { kind: "today", ref: "2026-08-08" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "查看我目前的饮食安排" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "nutrition-strategy-tool-1");
  assert.equal(ready.artifactRef.kind, "nutrition_strategy");
  const snapshot = await state.ledger.read();
  const artifact = snapshot.artifacts.find((item) => item.kind === "nutrition_strategy");
  assert.ok(artifact && artifact.kind === "nutrition_strategy");
  assert.equal(artifact.strategy?.phase, "fat_loss_preserve_lean_mass");
  assert.equal(snapshot.domainEvents.filter((event) => event.name === "nutrition_strategy.revised").length, 0);
  assert.equal(snapshot.presentations.find((item) => item.artifactId === artifact.id)?.renderer, "nutrition_strategy/1");
});

test("目标路径卡只呈现最近一次本地重规划预测，Provider 不能重新计算或改写计划", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "goal-forecast-tool-1",
      toolName: "forecast.show_latest",
      input: {},
    },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "forecast-user",
      actor: { kind: "user", id: "forecast-user" },
      deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "forecast-bootstrap",
    },
    profile: {
      id: "forecast-profile",
      trainingExperience: "beginner",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{
        id: "forecast-home",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      }],
    },
    goalContract: {
      id: "forecast-goal",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08", endDate: "2026-09-19" },
      status: "active",
    },
    mandate: { id: "forecast-mandate", mode: "collaborative" },
  });
  await state.app.materializeGoalCycle({
    userId: "forecast-user",
    trigger: "initial_plan",
    currentDate: "2026-08-08",
    idempotencyKey: "forecast-initial-plan",
  });
  const evaluation = await state.app.evaluateLocalReplan({
    userId: "forecast-user",
    currentDate: "2026-08-08",
    trigger: {
      id: "forecast-session-completed",
      kind: "session_completed",
      actor: "rule_engine",
      occurredAt: "2026-08-08T08:00:00.000Z",
      causationId: "forecast-workout",
      idempotencyKey: "forecast-replan",
    },
    window: { start: "2026-08-08", end: "2026-08-14" },
  });
  const planEventsBefore = (await state.ledger.read()).domainEvents.filter(
    (event) => event.name === "plan.revised",
  ).length;
  const session = await state.app.startSession({
    userId: "forecast-user",
    context: { kind: "progress", ref: "2026-W32" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "查看我的目标路径" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "goal-forecast-tool-1");
  assert.equal(ready.artifactRef.kind, "goal_forecast");
  const snapshot = await state.ledger.read();
  const artifact = snapshot.artifacts.find((item) => item.kind === "goal_forecast");
  assert.ok(artifact && artifact.kind === "goal_forecast");
  assert.equal(artifact.sourceEvaluationId, evaluation.id);
  assert.deepEqual(artifact.forecasts.map((item) => item.scenario), ["conservative", "base", "aggressive"]);
  assert.equal(
    snapshot.presentations.find((item) => item.artifactId === artifact.id)?.renderer,
    "goal_forecast/1",
  );
  assert.equal(
    snapshot.domainEvents.filter((event) => event.name === "plan.revised").length,
    planEventsBefore,
  );
});

test("Agent 营养复核工具只请求本地 Timeline 评估，数据不足时返回依据卡而不接受模型传入的热量参数", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "nutrition-review-tool-1",
      toolName: "nutrition.propose_change_from_timeline",
      input: { nutritionStrategyId: "nutrition-review-strategy" },
    },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "nutrition-review-user", actor: { kind: "user", id: "nutrition-review-user" }, deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z", timezoneOffsetMinutes: 0, idempotencyKey: "nutrition-review-bootstrap",
    },
    profile: { id: "nutrition-review-profile", trainingExperience: "beginner", locale: "zh-CN", adultConfirmed: true },
    goalContract: { id: "nutrition-review-goal", primaryGoal: "fat_loss_preserve_lean_mass", horizon: { startDate: "2026-08-08" } },
    mandate: { id: "nutrition-review-mandate", mode: "collaborative" },
  });
  await state.app.commitNutritionStrategy({
    userId: "nutrition-review-user",
    strategy: state.app.createNutritionStrategy({
      id: "nutrition-review-strategy",
      goalContractRef: { kind: "goal_contract", id: "nutrition-review-goal", revision: 1 },
      phase: "fat_loss_preserve_lean_mass",
      bodyMassKg: 70,
      estimatedMaintenanceKcal: 2200,
      reviewWindow: { startsAt: "2026-08-08", endsAt: "2026-08-22", minimumWeightObservations: 3 },
      safety: { adultConfirmed: true },
    }),
    idempotencyKey: "nutrition-review-strategy-commit",
  });
  const session = await state.app.startSession({
    userId: "nutrition-review-user",
    context: { kind: "progress", ref: "nutrition-review" },
  });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "现在要调整饮食吗？" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "nutrition-review-tool-1");
  assert.equal(ready.artifactRef.kind, "evidence_brief");
  const snapshot = await state.ledger.read();
  assert.equal(snapshot.domainEvents.filter((event) => event.name === "nutrition_strategy.revised").length, 0);
  const manifest = provider.requests[0]?.toolManifest.find((tool) => tool.name === "nutrition.propose_change_from_timeline");
  assert.deepEqual(manifest?.inputSchema, {
    type: "object", additionalProperties: false, required: ["nutritionStrategyId"], properties: { nutritionStrategyId: { type: "string", minLength: 1 } },
  });
  assert.equal(manifest?.riskCeiling, "confirmation_required");
});

test("本地 Coach 能把训练日与休息日的饮食配合请求转成待确认的结构化策略卡", async () => {
  const state = runtimeFixture(new LocalCoachProvider());
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "nutrition-coordination-user", actor: { kind: "user", id: "nutrition-coordination-user" }, deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z", timezoneOffsetMinutes: 0, idempotencyKey: "nutrition-coordination-bootstrap",
    },
    profile: {
      id: "nutrition-coordination-profile", trainingExperience: "intermediate", locale: "zh-CN", adultConfirmed: true,
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{ id: "nutrition-coordination-gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: { id: "nutrition-coordination-goal", primaryGoal: "fat_loss_preserve_lean_mass", horizon: { startDate: "2026-08-08" }, status: "active" },
    mandate: { id: "nutrition-coordination-mandate", mode: "collaborative" },
  });
  await state.app.materializeGoalCycle({
    userId: "nutrition-coordination-user", currentDate: "2026-08-08", trigger: "initial_plan", idempotencyKey: "nutrition-coordination-plan",
  });
  await state.app.commitNutritionStrategy({
    userId: "nutrition-coordination-user",
    strategy: state.app.createNutritionStrategy({
      id: "nutrition-coordination-strategy",
      goalContractRef: { kind: "goal_contract", id: "nutrition-coordination-goal", revision: 1 },
      phase: "fat_loss_preserve_lean_mass",
      bodyMassKg: 80,
      estimatedMaintenanceKcal: 2500,
      reviewWindow: { startsAt: "2026-08-08", endsAt: "2026-08-22", minimumWeightObservations: 3 },
      safety: { adultConfirmed: true },
    }),
    idempotencyKey: "nutrition-coordination-strategy-commit",
  });
  const session = await state.app.startSession({
    userId: "nutrition-coordination-user",
    context: { kind: "today", ref: "2026-08-08" },
  });

  const events = await state.app.sendCoachTurn({
    sessionId: session.id,
    text: "训练日和休息日的碳水应该怎么配合？",
  });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.artifactRef.kind, "nutrition_change_proposal");
  const snapshot = await state.ledger.read();
  const proposal = snapshot.artifacts.find((artifact) => artifact.kind === "nutrition_change_proposal");
  assert.ok(proposal && proposal.kind === "nutrition_change_proposal");
  assert.equal(proposal.proposal.changeKind, "day_type_coordination");
  assert.equal(proposal.proposal.expectedDirection, "hold");
  assert.equal(
    snapshot.domainEvents.filter(
      (event) => event.name === "nutrition_strategy.created" || event.name === "nutrition_strategy.revised",
    ).length,
    1,
  );
  assert.equal(snapshot.presentations.find((item) => item.artifactId === proposal.id)?.status, "awaiting_user");
});

test("Coach 用同一张只读卡返回本周训练安排与已提交摄入范围", async () => {
  const provider = new ScriptedLLMProvider([
    { type: "tool-call", toolCallId: "current-plan-tool-1", toolName: "plan.show_current", input: {} },
    { type: "completed" },
  ]);
  const state = runtimeFixture(provider);
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "current-plan-user", actor: { kind: "user", id: "current-plan-user" }, deviceId: "phone",
      occurredAt: "2026-08-08T08:00:00.000Z", timezoneOffsetMinutes: 0, idempotencyKey: "current-plan-bootstrap",
    },
    profile: {
      id: "current-plan-profile", trainingExperience: "intermediate", locale: "zh-CN", adultConfirmed: true,
      demographics: { currentWeight: { value: 80, unit: "kg" } },
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{ id: "current-plan-home", kind: "home", environment: { space: "medium", noise: "quiet" }, availableEquipment: ["bodyweight", "floor_space"] }],
    },
    goalContract: { id: "current-plan-goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-03" }, status: "active" },
    mandate: { id: "current-plan-mandate", mode: "collaborative" },
  });
  await state.app.materializeGoalCycle({ userId: "current-plan-user", currentDate: "2026-08-03", trigger: "initial_plan", idempotencyKey: "current-plan-materialize" });
  await state.app.commitNutritionStrategy({
    userId: "current-plan-user",
    strategy: state.app.createNutritionStrategy({
      id: "current-plan-nutrition",
      goalContractRef: { kind: "goal_contract", id: "current-plan-goal", revision: 1 },
      phase: "hypertrophy",
      bodyMassKg: 80,
      estimatedMaintenanceKcal: 2500,
      reviewWindow: { startsAt: "2026-08-08", endsAt: "2026-08-22", minimumWeightObservations: 3 },
      safety: { adultConfirmed: true },
    }),
    idempotencyKey: "current-plan-nutrition-commit",
  });
  const session = await state.app.startSession({ userId: "current-plan-user", context: { kind: "plan", ref: "plan:1" } });

  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "给我完整的本周训练和摄入计划" });
  const ready = events.find((event) => event.type === "artifact-ready");
  assert.ok(ready && ready.type === "artifact-ready");
  assert.equal(ready.toolCallId, "current-plan-tool-1");
  assert.equal(ready.artifactRef.kind, "plan_overview");
  const snapshot = await state.ledger.read();
  const artifact = snapshot.artifacts.find((item) => item.kind === "plan_overview");
  assert.ok(artifact && artifact.kind === "plan_overview");
  assert.equal(artifact.trainingDays, 3);
  assert.ok(artifact.totalWorkSets > 0);
  assert.equal(artifact.tasks.some((task) => /bodyweight|band|standard|minutes/.test(`${task.name} ${task.reps}`)), false);
  assert.ok(artifact.capabilityBoundary.some((item) => item.includes("仍需校准") && item.includes("实际起始重量")));
  assert.ok(artifact.capabilityBoundary.some((item) => item.includes("高于 10% / 20%") && item.includes("不是越少越好")));
  assert.deepEqual(artifact.nutrition?.proteinGrams, { min: 128, max: 176 });
  assert.ok((artifact.nutrition?.today?.recommendedKcal ?? 0) > 0);
  assert.equal(artifact.nutrition?.week?.length, 7);
  const presentation = snapshot.presentations.find((item) => item.artifactId === artifact.id);
  assert.equal(presentation?.renderer, "plan_overview/1");
  assert.ok(provider.requests[0]?.toolManifest.some((tool) => tool.name === "plan.show_current"));
});

test("本地 Coach baseline 只解释本地事实，并通过闭合工具展示指定日期的计划", async () => {
  const state = runtimeFixture(new LocalCoachProvider());
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await seed(state.app, "user-1");
  const events = await state.app.sendCoachTurn({
    sessionId: session.id,
    text: "请查看 2026-08-08 的训练安排",
  });
  const card = events.find((event) => event.type === "artifact-ready");
  assert.ok(card && card.type === "artifact-ready");
  assert.equal(card.artifactRef.kind, "today_plan");
  assert.equal(state.app.runtimeStatus().mode, "local-only");
});

test("HITL 在重启后以原 runId/toolCallId 续跑 Provider，再完成 Proposal→apply→undo", async () => {
  const provider = new ScriptedLLMProvider(
    [
      {
        type: "tool-call",
        toolCallId: "choice-tool-1",
        toolName: "ui.request_choice",
        input: {
          prompt: "今天卧推是否按原重量执行？",
          options: [
            { id: "keep", label: "保持" },
            { id: "increase", label: "小幅增加" },
          ],
          risk: "review",
        },
      },
    ],
    [
      { type: "text-delta", delta: "已按你的选择生成调整建议。" },
      {
        type: "tool-call",
        toolCallId: "proposal-tool-1",
        toolName: "plan.propose_change",
        input: {
          change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
          reason: "用户确认采用保守的小幅递增",
        },
      },
      { type: "completed" },
    ],
  );
  const state = runtimeFixture(provider);
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await seed(state.app, "user-1");
  const initialEvents = await state.app.sendCoachTurn({
    sessionId: session.id,
    text: "根据今天表现帮我决定卧推重量",
  });
  const suspendedEvent = initialEvents.find((event) => event.type === "hitl-suspended");
  assert.ok(suspendedEvent && suspendedEvent.type === "hitl-suspended");
  const pending = (await state.app.listPendingHumanActions("user-1"))[0]!;
  assert.equal(pending.runId, suspendedEvent.runId);
  assert.equal(pending.toolCallId, "choice-tool-1");
  assert.equal((await state.app.readSession(session.id)).status, "suspended");

  const restarted = new CoachApplication(state.dependencies);
  const resumed = await restarted.resumeHumanInput({
    pendingActionId: pending.id,
    runId: pending.runId,
    toolCallId: pending.toolCallId,
    resumeToken: pending.resumeToken,
    output: { kind: "selected", optionId: "increase" },
  });
  assert.equal(resumed.status, "resumed");
  assert.equal(provider.resumeRequests[0]?.runId, pending.runId);
  assert.equal(provider.resumeRequests[0]?.continuation.toolCallId, pending.toolCallId);
  assert.deepEqual(provider.resumeRequests[0]?.continuation.output, {
    kind: "selected",
    optionId: "increase",
  });

  const snapshot = await state.ledger.read();
  const proposal = snapshot.artifacts.find((artifact) => artifact.kind === "plan_change_proposal");
  assert.ok(proposal && proposal.kind === "plan_change_proposal");
  const applyToken = snapshot.actionTokens.find(
    (token) => token.artifactId === proposal.id && token.action === "apply" && !token.consumedAt,
  );
  assert.ok(applyToken);
  const applied = await restarted.actOnArtifact({
    sessionId: session.id,
    artifactId: proposal.id,
    action: "apply",
    actionToken: applyToken.token,
    idempotencyKey: "apply-after-resume",
  });
  assert.equal(applied.status, "applied");
  if (applied.status !== "applied") return;
  const undone = await restarted.undoPlanChange({
    sessionId: session.id,
    receiptArtifactId: applied.receipt.id,
    actionToken: applied.undoActionToken,
    idempotencyKey: "undo-after-resume",
  });
  assert.equal(undone.status, "undone");
  assert.equal((await restarted.readUserProjection("user-1")).plan.tasks[0]?.loadKg, 60);

  const final = await state.ledger.read();
  assert.equal(final.runs.find((run) => run.id === pending.runId)?.status, "completed");
  assert.equal(final.pendingHumanActions.find((item) => item.id === pending.id)?.status, "resolved");
  assert.ok(final.actionTokens.find((token) => token.token === pending.resumeToken)?.consumedAt);
  assert.equal(
    final.runEvents.some(
      (event) => event.type === "hitl-resumed" && event.runId === pending.runId && event.toolCallId === pending.toolCallId,
    ),
    true,
  );
  assert.equal(final.toolAudit.some((item) => item.phase === "provider_request"), true);
  assert.equal(final.toolAudit.some((item) => item.phase === "tool_execution"), true);
  assert.equal(JSON.stringify(final.toolAudit).includes("根据今天表现"), false);
  const log = await restarted.listActionLog("user-1");
  assert.equal(log.some((item) => item.action === "proposal.created"), true);
  assert.equal(log.some((item) => item.action === "plan.change.applied"), true);
  assert.equal(log.some((item) => item.action === "plan.change.undone"), true);
  assert.equal(
    log.every(
      (item) =>
        item.scope &&
        item.intent &&
        item.ruleVersions &&
        Number.isInteger(item.mandateRevision) &&
        item.result &&
        item.undoBoundary,
    ),
    true,
  );
  const appliedAction = log.find((item) => item.action === "plan.change.applied")!;
  const replayedReceipt = await restarted.replayActionReceipt(appliedAction.id);
  assert.deepEqual(replayedReceipt.before, { loadKg: 60 });
  assert.deepEqual(replayedReceipt.after, { loadKg: 62.5 });
  assert.equal((await restarted.listToolAudit("user-1")).length, final.toolAudit.length);
});

test("WorkingMemory 使用 Ledger CAS，可固定、supersede、compact，且始终 non-authoritative", async () => {
  const state = runtimeFixture();
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await seed(state.app, "user-1");
  const first = await state.app.upsertMemory({
    userId: "user-1",
    sessionId: session.id,
    actor: "user",
    kind: "focus",
    content: "卧推稳定完成 3×8",
    evidenceRefs: [{ aggregate: "plan", id: "user-1", revision: 1 }],
    confidence: 0.8,
    sensitivity: "normal",
  });
  const pinned = await state.app.setMemoryPinned({
    userId: "user-1",
    id: first.id,
    expectedVersion: first.version,
    pinned: true,
  });
  await assert.rejects(
    state.app.supersedeMemory({
      userId: "user-1",
      actor: "agent",
      id: pinned.id,
      expectedVersion: pinned.version,
      content: "擅自改写",
      confidence: 0.9,
    }),
    /pinned_memory/,
  );
  const second = await state.app.upsertMemory({
    userId: "user-1",
    actor: "agent",
    runId: "run-1",
    kind: "open_question",
    content: "下一次是否适合增加 2.5kg",
    evidenceRefs: [],
    confidence: 0.5,
    sensitivity: "normal",
  });
  const third = await state.app.upsertMemory({
    userId: "user-1",
    actor: "agent",
    runId: "run-1",
    kind: "hypothesis",
    content: "恢复充分时可能可进阶",
    evidenceRefs: [],
    confidence: 0.4,
    sensitivity: "normal",
  });
  const compacted = await state.app.compactMemory({
    userId: "user-1",
    actor: "agent",
    sourceIds: [second.id, third.id],
    expectedVersions: { [second.id]: second.version, [third.id]: third.version },
    content: "需结合下一次热身表现决定是否进阶",
    confidence: 0.6,
    runId: "run-1",
  });
  assert.equal(compacted.authority, "non_authoritative");
  const memories = await state.app.listMemory("user-1");
  assert.equal(memories.find((item) => item.id === second.id)?.supersededBy, compacted.id);
  assert.equal(memories.find((item) => item.id === third.id)?.supersededBy, compacted.id);
  await assert.rejects(
    state.app.setMemoryPinned({
      userId: "user-1",
      id: second.id,
      expectedVersion: second.version + 1,
      pinned: true,
    }),
    /memory_superseded/,
  );
  assert.equal((await state.app.readUserProjection("user-1")).plan.revision, 1);
});

test("HITL resume 会重读 Safety/Fact frontier，变化后原位 stale 并消费一次性 token", async () => {
  const state = runtimeFixture();
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "calendar", ref: "2026-W32" },
  });
  await seed(state.app, "user-1");
  const meta = (key: string) => ({
    userId: "user-1",
    actor: { kind: "user" as const, id: "user-1" },
    deviceId: "local-device",
    occurredAt: "2026-08-08T08:00:00.000Z",
    timezoneOffsetMinutes: 0,
    idempotencyKey: key,
  });
  await state.app.executeDomainCommand({
    type: "user.bootstrap",
    meta: meta("domain-user"),
    profile: { id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN" },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-08" },
    },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await state.app.executeDomainCommand({
    type: "safety_constraint.revise",
    meta: meta("safety-clear"),
    safetyConstraintId: "safety-1",
    expectedRevision: 0,
    safetyConstraint: {
      id: "safety-1",
      disposition: "clear",
      reasons: [],
      stopSignals: [],
      professionalConstraints: [],
    },
  });
  const suspended = await state.app.suspendForHumanInput({
    sessionId: session.id,
    kind: "choose_option",
    prompt: "是否把训练移到晚上？",
    options: [
      { id: "yes", label: "移到晚上" },
      { id: "no", label: "保持原计划" },
    ],
  });
  await state.app.executeDomainCommand({
    type: "safety_constraint.revise",
    meta: meta("safety-stop"),
    safetyConstraintId: "safety-1",
    expectedRevision: 1,
    safetyConstraint: {
      id: "safety-1",
      disposition: "stop_and_seek_professional_guidance",
      reasons: ["new_significant_pain"],
      stopSignals: ["new_significant_pain"],
      professionalConstraints: [],
    },
  });
  await assert.rejects(
    state.app.resumeHumanInput({
      pendingActionId: suspended.pending.id,
      runId: suspended.pending.runId,
      toolCallId: suspended.pending.toolCallId,
      resumeToken: suspended.resumeToken,
      output: { kind: "selected", optionId: "yes" },
    }),
    /stale/,
  );
  const snapshot = await state.ledger.read();
  assert.equal(
    snapshot.pendingHumanActions.find((item) => item.id === suspended.pending.id)?.status,
    "stale",
  );
  assert.equal(
    snapshot.presentations.find((item) => item.id === suspended.pending.presentationRef?.id)?.status,
    "stale",
  );
  assert.ok(snapshot.actionTokens.find((token) => token.token === suspended.resumeToken)?.consumedAt);
});

test("resume 后 Provider 暂时中断保持同一 Run 可重试，不重复消费 HITL token", async () => {
  const provider = new ScriptedLLMProvider(
    [
      {
        type: "tool-call",
        toolCallId: "choice-tool-retry",
        toolName: "ui.request_choice",
        input: {
          prompt: "选择训练时段",
          options: [
            { id: "am", label: "上午" },
            { id: "pm", label: "晚上" },
          ],
        },
      },
    ],
    [
      { type: "text-delta", delta: "已记录时段。" },
      { type: "completed" },
    ],
  );
  const state = runtimeFixture(provider);
  const session = await state.app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await seed(state.app, "user-1");
  await state.app.sendCoachTurn({ sessionId: session.id, text: "安排训练" });
  const pending = (await state.app.listPendingHumanActions("user-1"))[0]!;
  provider.failWith(new Error("temporary transport disconnect"));
  const firstResume = await state.app.resumeHumanInput({
    pendingActionId: pending.id,
    runId: pending.runId,
    toolCallId: pending.toolCallId,
    resumeToken: pending.resumeToken,
    output: { kind: "selected", optionId: "am" },
  });
  assert.equal(firstResume.events.some((event) => event.type === "run-error" && event.code === "retryable"), true);
  assert.equal((await state.ledger.read()).runs.find((run) => run.id === pending.runId)?.status, "resuming");

  provider.clearFailure();
  const restarted = new CoachApplication(state.dependencies);
  const continued = await restarted.continueCoachRun(pending.runId);
  assert.equal(continued.some((event) => event.type === "run-completed"), true);
  assert.equal((await state.ledger.read()).runs.find((run) => run.id === pending.runId)?.status, "completed");
  assert.equal(provider.resumeRequests.length, 2);
  assert.equal(provider.resumeRequests[0]?.runId, provider.resumeRequests[1]?.runId);
});
