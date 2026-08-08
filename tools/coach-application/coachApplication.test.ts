import assert from "node:assert/strict";
import test from "node:test";

import {
  CoachApplication,
  createInMemoryCoachApplication,
} from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

test("用户可以离线创建 CoachSession，并从本地事实得到 TodayPlan 卡片", async () => {
  let sequence = 0;
  const app = createInMemoryCoachApplication({
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  });

  const session = await app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-1",
    profile: { goal: "hypertrophy", trainingExperience: "beginner" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢推力量日",
      tasks: [
        { id: "bench", name: "杠铃卧推", sets: 4, reps: "8", loadKg: 62.5, targetRir: 2 },
        { id: "press", name: "坐姿肩推", sets: 3, reps: "10", loadKg: 22.5, targetRir: 2 },
      ],
    },
  });

  const result = await app.showTodayPlan({ sessionId: session.id, date: "2026-08-08" });

  assert.equal(session.status, "active");
  assert.equal(result.artifact.kind, "today_plan");
  assert.equal(result.card.renderer, "today-plan/v1");
  assert.equal(result.card.title, "上肢推力量日");
  assert.deepEqual(result.card.metrics, [
    { label: "预计组数", value: "7" },
    { label: "动作", value: "2" },
    { label: "主项目标", value: "RIR 2" },
  ]);
  assert.equal(result.card.actions[0]?.id, "start_workout");
  assert.deepEqual(app.runtimeStatus(), { mode: "local-only", remoteProviderRequests: 0 });
});

test("用户确认 typed Proposal 后原子生成新计划、回执与 Action Log，token 重放无副作用", async () => {
  let sequence = 0;
  const app = createInMemoryCoachApplication({
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  });
  const session = await app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-1",
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 7,
      effectiveDate: "2026-08-08",
      title: "上肢推力量日",
      tasks: [{ id: "bench", name: "杠铃卧推", sets: 4, reps: "8", loadKg: 60, targetRir: 2 }],
    },
  });

  const proposal = await app.proposePlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5, targetRir: 2 },
    reason: "最近两次在目标 RIR 内完成",
  });
  assert.equal(proposal.artifact.kind, "plan_change_proposal");
  assert.deepEqual(proposal.artifact.before, { loadKg: 60, targetRir: 2 });
  assert.deepEqual(proposal.artifact.after, { loadKg: 62.5, targetRir: 2 });
  assert.equal(proposal.card.actions.find((action) => action.id === "apply")?.enabled, true);

  const applied = await app.actOnArtifact({
    sessionId: session.id,
    artifactId: proposal.artifact.id,
    action: "apply",
    actionToken: proposal.actionToken,
    idempotencyKey: "tap-1",
  });
  const replay = await app.actOnArtifact({
    sessionId: session.id,
    artifactId: proposal.artifact.id,
    action: "apply",
    actionToken: proposal.actionToken,
    idempotencyKey: "tap-1",
  });

  assert.equal(applied.status, "applied");
  assert.equal(applied.receipt.kind, "action_receipt");
  assert.equal(replay.status, "idempotent");
  const projection = await app.readUserProjection("user-1");
  assert.equal(projection.plan.revision, 8);
  assert.equal(projection.plan.tasks[0]?.loadKg, 62.5);
  assert.equal(projection.actionLog.length, 1);
  assert.equal(projection.actionLog[0]?.action, "plan.change.applied");
  assert.deepEqual(projection.actionLog[0]?.before, { loadKg: 60, targetRir: 2 });
  assert.deepEqual(projection.actionLog[0]?.after, { loadKg: 62.5, targetRir: 2 });
});

test("apply 后重建应用仍可通过回执创建补偿 revision，旧 ActionEvent 保持可追溯", async () => {
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const ledger = new InMemoryCoachLedger();
  let app = new CoachApplication(ledger, runtime);
  const session = await app.startSession({
    userId: "user-undo",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-undo",
    profile: { goal: "strength", trainingExperience: "intermediate" },
    plan: {
      revision: 2,
      effectiveDate: "2026-08-08",
      title: "深蹲日",
      tasks: [{ id: "squat", name: "深蹲", sets: 3, reps: "5", loadKg: 100, targetRir: 2 }],
    },
  });
  const proposal = await app.proposePlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "squat", loadKg: 102.5 },
    reason: "按最小档位递增",
  });
  const applied = await app.actOnArtifact({
    sessionId: session.id,
    artifactId: proposal.artifact.id,
    action: "apply",
    actionToken: proposal.actionToken,
    idempotencyKey: "apply-squat",
  });
  assert.equal(applied.status, "applied");
  if (applied.status !== "applied") return;

  app = new CoachApplication(ledger, runtime);
  const undone = await app.undoPlanChange({
    sessionId: session.id,
    receiptArtifactId: applied.receipt.id,
    actionToken: applied.undoActionToken,
    idempotencyKey: "undo-squat",
  });
  const projection = await app.readUserProjection("user-undo");

  assert.equal(undone.status, "undone");
  assert.equal(undone.receipt.result, "undone");
  assert.equal(projection.plan.revision, 4);
  assert.equal(projection.plan.tasks[0]?.loadKg, 100);
  assert.equal(projection.actionLog.length, 2);
  assert.equal(projection.actionLog[0]?.action, "plan.change.applied");
  assert.equal(projection.actionLog[0]?.undoneBy, projection.actionLog[1]?.id);
  assert.equal(projection.actionLog[1]?.action, "plan.change.undone");
});

test("事实 revision 变化会让旧 Proposal 原位 stale，显式重算生成关联新 Artifact", async () => {
  let sequence = 0;
  const app = createInMemoryCoachApplication({
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  });
  const session = await app.startSession({
    userId: "user-stale",
    context: { kind: "today", ref: "2026-08-08" },
  });
  const profile = { goal: "hypertrophy" as const, trainingExperience: "intermediate" as const };
  await app.seedUserState({
    userId: "user-stale",
    profile,
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢推",
      tasks: [{ id: "bench", name: "杠铃卧推", sets: 4, reps: "8", loadKg: 60 }],
    },
  });
  const first = await app.proposePlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
    reason: "递增一个档位",
  });
  await app.seedUserState({
    userId: "user-stale",
    profile,
    plan: {
      revision: 2,
      previousRevision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢推",
      tasks: [{ id: "bench", name: "杠铃卧推", sets: 4, reps: "8", loadKg: 61 }],
    },
  });

  const stale = await app.inspectArtifact(first.artifact.id);
  const recomputed = await app.recomputePlanChange({
    sessionId: session.id,
    staleArtifactId: first.artifact.id,
  });

  assert.equal(stale.status, "stale");
  assert.equal(stale.card.actions.find((action) => action.id === "apply")?.enabled, false);
  assert.equal(recomputed.artifact.basePlanRevision, 2);
  assert.equal(recomputed.artifact.supersedesArtifactId, first.artifact.id);
  assert.notEqual(recomputed.artifact.hash, first.artifact.hash);
  assert.notEqual(recomputed.actionToken, first.actionToken);
});

test("typed HITL 在重建应用后仍可用同一 run/toolCall 显式恢复且只能消费一次", async () => {
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const ledger = new InMemoryCoachLedger();
  let app = new CoachApplication(ledger, runtime);
  const session = await app.startSession({
    userId: "user-hitl",
    context: { kind: "calendar", ref: "2026-W32" },
  });
  await app.seedUserState({
    userId: "user-hitl",
    profile: { goal: "fat_loss", trainingExperience: "beginner" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "全身训练",
      tasks: [{ id: "squat", name: "徒手深蹲", sets: 3, reps: "12" }],
    },
  });
  const suspended = await app.suspendForHumanInput({
    sessionId: session.id,
    kind: "choose_option",
    prompt: "周六和周日哪天更适合训练？",
    options: [
      { id: "sat", label: "周六" },
      { id: "sun", label: "周日" },
    ],
  });

  app = new CoachApplication(ledger, runtime);
  const restored = await app.readSession(session.id);
  const resumed = await app.resumeHumanInput({
    pendingActionId: suspended.pending.id,
    runId: suspended.pending.runId,
    toolCallId: suspended.pending.toolCallId,
    resumeToken: suspended.resumeToken,
    output: { kind: "selected", optionId: "sun" },
  });

  assert.equal(restored.status, "suspended");
  assert.equal(resumed.status, "resumed");
  assert.deepEqual(resumed.output, { kind: "selected", optionId: "sun" });
  await assert.rejects(
    () =>
      app.resumeHumanInput({
        pendingActionId: suspended.pending.id,
        runId: suspended.pending.runId,
        toolCallId: suspended.pending.toolCallId,
        resumeToken: suspended.resumeToken,
        output: { kind: "selected", optionId: "sat" },
      }),
    /pending_action_consumed/,
  );
});

test("Working Memory 跨 Session 保留、用户固定后 Agent 不可覆盖，且不改变事实规则输出", async () => {
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const ledger = new InMemoryCoachLedger();
  let app = new CoachApplication(ledger, runtime);
  const firstSession = await app.startSession({
    userId: "user-memory",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-memory",
    profile: { goal: "health", trainingExperience: "beginner" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "居家全身",
      tasks: [{ id: "pushup", name: "跪姿俯卧撑", sets: 3, reps: "10" }],
    },
  });
  const before = await app.showTodayPlan({ sessionId: firstSession.id, date: "2026-08-08" });
  const memory = await app.upsertMemory({
    userId: "user-memory",
    actor: "user",
    kind: "preference",
    content: "周末更喜欢上午训练",
    evidenceRefs: [],
    confidence: 1,
    sensitivity: "private",
    pinned: true,
  });

  app = new CoachApplication(ledger, runtime);
  await assert.rejects(
    () =>
      app.upsertMemory({
        userId: "user-memory",
        actor: "agent",
        id: memory.id,
        expectedVersion: memory.version,
        kind: "preference",
        content: "周末晚上训练",
        evidenceRefs: [],
        confidence: 0.7,
        sensitivity: "private",
      }),
    /pinned_memory/,
  );
  const secondSession = await app.startSession({
    userId: "user-memory",
    context: { kind: "today", ref: "2026-08-08" },
  });
  const after = await app.showTodayPlan({ sessionId: secondSession.id, date: "2026-08-08" });
  const memories = await app.listMemory("user-memory");

  assert.equal(memories.length, 1);
  assert.equal(memories[0]?.content, "周末更喜欢上午训练");
  assert.equal(memories[0]?.pinned, true);
  assert.equal(after.artifact.hash, before.artifact.hash);
});

test("manual/collaborative/managed 权限与 safety hold 在本地 PolicyGate 生效", async () => {
  let sequence = 0;
  const app = createInMemoryCoachApplication({
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  });
  const session = await app.startSession({
    userId: "user-policy",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-policy",
    profile: { goal: "strength", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "力量日",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "5", loadKg: 60 }],
    },
  });
  await app.setMandate({ userId: "user-policy", mode: "manual" });
  const advice = await app.proposePlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
    reason: "建议递增",
  });
  assert.equal(advice.artifact.executionPolicy, "advice_only");
  assert.equal(advice.card.actions.find((action) => action.id === "apply")?.enabled, false);
  await assert.rejects(
    () =>
      app.actOnArtifact({
        sessionId: session.id,
        artifactId: advice.artifact.id,
        action: "apply",
        actionToken: advice.actionToken,
        idempotencyKey: "manual-forbidden",
      }),
    /advice_only/,
  );

  await app.setMandate({ userId: "user-policy", mode: "managed" });
  const managed = await app.executeManagedPlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
    reason: "托管范围内递增",
    idempotencyKey: "managed-1",
  });
  assert.equal(managed.status, "applied");
  assert.equal((await app.readUserProjection("user-policy")).plan.tasks[0]?.loadKg, 62.5);

  await app.setSafetyHold({ userId: "user-policy", enabled: true });
  await assert.rejects(
    () =>
      app.proposePlanChange({
        sessionId: session.id,
        change: { kind: "adjust_task", taskId: "bench", loadKg: 65 },
        reason: "不应越过安全暂停",
      }),
    /safety_hold/,
  );
});

test("用户拒绝 Proposal 会生成可追溯回执但不修改 PlanRevision", async () => {
  let sequence = 0;
  const app = createInMemoryCoachApplication({
    now: () => "2026-08-08T08:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  });
  const session = await app.startSession({
    userId: "user-reject",
    context: { kind: "today", ref: "2026-08-08" },
  });
  await app.seedUserState({
    userId: "user-reject",
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 4,
      effectiveDate: "2026-08-08",
      title: "上肢推",
      tasks: [{ id: "bench", name: "卧推", sets: 4, reps: "8", loadKg: 60 }],
    },
  });
  const proposal = await app.proposePlanChange({
    sessionId: session.id,
    change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5 },
    reason: "递增",
  });

  const rejected = await app.actOnArtifact({
    sessionId: session.id,
    artifactId: proposal.artifact.id,
    action: "reject",
    actionToken: proposal.rejectActionToken,
    idempotencyKey: "reject-1",
  });
  const projection = await app.readUserProjection("user-reject");

  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.receipt.result, "rejected");
  assert.equal(projection.plan.revision, 4);
  assert.equal(projection.plan.tasks[0]?.loadKg, 60);
  assert.equal(projection.actionLog[0]?.action, "plan.change.rejected");
  await assert.rejects(
    () =>
      app.actOnArtifact({
        sessionId: session.id,
        artifactId: proposal.artifact.id,
        action: "apply",
        actionToken: proposal.actionToken,
        idempotencyKey: "apply-after-reject",
      }),
    /invalid_token/,
  );
});
