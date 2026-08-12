import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-13T08:00:00.000Z",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    knowledgeToolsEnabled: true,
  });
  return { app, ledger };
}

async function seed(app: CoachApplication) {
  await app.seedUserState({
    userId: "planning-progress-user",
    profile: { goal: "fat_loss", trainingExperience: "intermediate" },
    plan: {
      revision: 3,
      effectiveDate: "2026-08-13",
      title: "四分化减脂计划",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60 }],
    },
  });
  return app.startSession({ userId: "planning-progress-user", context: { kind: "plan", ref: "active" } });
}

test("规划进度以稳定阶段和可渲染卡片持久化，不会在 proposal 前改动现行计划", async () => {
  const { app, ledger } = fixture();
  const session = await seed(app);

  const result = await app.presentPlannerProgress({
    sessionId: session.id,
    stage: "proposal_ready",
    factBasis: ["昨晚聚餐已记录", "本周已完成 3/4 次关键训练"],
    proposal: {
      tradeoffs: ["保持原截止日需要提高本周日常活动"],
      executionBurden: "本周额外增加两次 25 分钟低强度有氧",
      nextVerificationSignal: "三天后复核累计摄入与晨起体重趋势",
      confirmationStatus: "awaiting_confirmation",
      effectAfterConfirmation: "只调整未来两天活动；现行计划在确认前保持 r3",
    },
  });

  assert.equal(result.artifact.kind, "planner_progress");
  assert.equal(result.artifact.stage, "proposal_ready");
  assert.equal(result.card.renderer, "planner-progress/v1");
  assert.equal(result.card.status, "awaiting_user");
  assert.deepEqual(result.card.sections?.map((section) => section.title), [
    "事实依据",
    "取舍",
    "执行负担",
    "下次验证",
    "确认后的影响",
  ]);
  assert.equal((await app.readUserProjection("planning-progress-user")).plan.revision, 3);
  assert.equal((await ledger.read()).artifacts.some((artifact) => artifact.id === result.artifact.id), true);
  assert.equal(result.events.some((event) => event.type === "artifact-ready"), true);
});

test("专业主张只接受同一 run 的 knowledge.search PassageRef；缺失或跨 run 的引用会明确 cannot_judge", async () => {
  const { app } = fixture();
  const session = await seed(app);
  const run = { runId: "knowledge-run", toolCallId: "knowledge-search" } as const;
  const search = await app.searchKnowledgeBase({
    sessionId: session.id,
    query: "减脂 有氧",
    topic: "nutrition",
  }, run);
  const knownPassage = (search.artifact as { knowledgeSearch?: { passageRefs: readonly { passageId: string }[] } })
    .knowledgeSearch?.passageRefs[0];
  assert.ok(knownPassage, "fixture knowledge search should provide a current-run passage");

  const accepted = await app.presentPlannerProgress({
    sessionId: session.id,
    stage: "evaluating",
    factBasis: ["今日摄入已完成记录"],
    professionalClaims: [{
      text: "这项调整需要结合当前训练安排，而不是只看单日摄入。",
      passageIds: [knownPassage.passageId],
    }],
  }, { runId: run.runId, toolCallId: "planner-progress-accepted" });
  const acceptedArtifact = accepted.artifact as Extract<typeof accepted.artifact, { kind: "planner_progress" }>;
  assert.deepEqual(acceptedArtifact.professionalClaims.map((claim) => claim.text), [
    "这项调整需要结合当前训练安排，而不是只看单日摄入。",
  ]);
  assert.equal(acceptedArtifact.cannotJudge.length, 0);

  const rejected = await app.presentPlannerProgress({
    sessionId: session.id,
    stage: "evaluating",
    factBasis: ["今日摄入已完成记录"],
    professionalClaims: [{
      text: "不应展示的无证据主张",
      passageIds: ["not-returned-by-this-run"],
    }],
  }, { runId: "different-run", toolCallId: "planner-progress-rejected" });
  const rejectedArtifact = rejected.artifact as Extract<typeof rejected.artifact, { kind: "planner_progress" }>;
  assert.deepEqual(rejectedArtifact.professionalClaims, []);
  assert.deepEqual(rejectedArtifact.cannotJudge, ["专业解释缺少本轮知识检索依据，暂无法判断。"]);
  assert.equal(rejected.card.sections?.some((section) => section.items.includes("不应展示的无证据主张")), false);
});

test("未完成、暂停和失败都有稳定的用户可见阶段，不暴露内部推理", async () => {
  const { app } = fixture();
  const session = await seed(app);

  for (const [stage, title] of [
    ["started", "正在准备规划"],
    ["retrieving", "正在核对依据"],
    ["needs_input", "需要一项信息"],
    ["paused", "规划已暂停"],
    ["failed", "暂时无法完成规划"],
  ] as const) {
    const result = await app.presentPlannerProgress({
      sessionId: session.id,
      stage,
      factBasis: [],
      ...(stage === "needs_input" ? { requestedInformation: ["今早体重"] } : {}),
    });
    assert.equal(result.card.title, title);
    assert.equal(result.card.sections?.some((section) => section.title === "内部推理"), false);
  }
});
