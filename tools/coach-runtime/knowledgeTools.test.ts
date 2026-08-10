import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { CoachToolRegistry, ToolSchemaError } from "../../src/coach/toolRegistry";

const NOW = "2026-08-08T08:00:00.000Z";

function fixture(options: { knowledgeToolsEnabled?: boolean } = {}) {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => NOW,
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
    ...(options.knowledgeToolsEnabled !== undefined
      ? { knowledgeToolsEnabled: options.knowledgeToolsEnabled }
      : {}),
  });
  return { app, ledger };
}

async function seedSession(app: CoachApplication) {
  await app.seedUserState({
    userId: "user-1",
    profile: { goal: "hypertrophy", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-08",
      title: "上肢推",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "8", loadKg: 60, targetRir: 2 }],
    },
  });
  return app.startSession({
    userId: "user-1",
    context: { kind: "today", ref: "2026-08-08" },
    title: "今天安排",
  });
}

test("知识工具默认禁用：不出现在 manifest，invoke 抛 unknown_tool", async () => {
  const registryOff = new CoachToolRegistry(stubHandlers(), {});
  assert.ok(!registryOff.manifest().some((tool) => tool.name.startsWith("knowledge.")));
  await assert.rejects(
    registryOff.invoke({
      sessionId: "s",
      runId: "r",
      call: { toolCallId: "t", toolName: "knowledge.lookup_exercise", input: { query: "俯卧撑" } },
    }),
    (error) => error instanceof ToolSchemaError && error.code === "unknown_tool",
  );

  const registryOn = new CoachToolRegistry(stubHandlers(), { knowledgeToolsEnabled: true });
  assert.ok(registryOn.manifest().some((tool) => tool.name === "knowledge.lookup_exercise"));
  assert.ok(registryOn.manifest().some((tool) => tool.name === "knowledge.explain_rule"));
});

test("lookup_exercise 命中：返回目录条目（肌群/器械/免责声明），带知识包版本钉", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: true });
  const session = await seedSession(app);
  const result = await app.lookupExerciseKnowledge({ sessionId: session.id, query: "俯卧撑" });
  const artifact = result.artifact as {
    kind: string;
    title: string;
    summary: readonly string[];
    missingness: readonly string[];
    knowledgePins: unknown;
  };
  assert.equal(artifact.kind, "evidence_brief");
  assert.match(artifact.title, /俯卧撑/);
  assert.ok(artifact.summary.some((line) => /chest|胸/.test(line)));
  assert.ok(artifact.summary.some((line) => line.includes("预计参与")));
  assert.equal(artifact.missingness.length, 0);
  assert.ok(artifact.knowledgePins);
});

test("lookup_exercise 未收录：typed unknown，不编造内容", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: true });
  const session = await seedSession(app);
  const result = await app.lookupExerciseKnowledge({ sessionId: session.id, query: "攀岩" });
  const artifact = result.artifact as { summary: readonly string[]; missingness: readonly string[] };
  assert.ok(artifact.missingness.includes("exercise_not_in_catalog"));
  assert.ok(artifact.summary.some((line) => line.includes("不在当前知识包")));
});

test("explain_rule 命中返回规则包条目与证据锚点，未命中返回 typed unknown", async () => {
  const { app } = fixture({ knowledgeToolsEnabled: true });
  const session = await seedSession(app);
  const hit = await app.explainKnowledgeRule({
    sessionId: session.id,
    ruleId: "maxpower.training.hypertrophy",
  });
  const hitArtifact = hit.artifact as { summary: readonly string[]; missingness: readonly string[] };
  assert.equal(hitArtifact.missingness.length, 0);
  assert.ok(hitArtifact.summary.some((line) => line.includes("performance_progression")));
  assert.ok(hitArtifact.summary.some((line) => line.includes("training-programming")));

  const miss = await app.explainKnowledgeRule({ sessionId: session.id, ruleId: "no.such.rule" });
  const missArtifact = miss.artifact as { missingness: readonly string[] };
  assert.ok(missArtifact.missingness.includes("rule_not_in_pack"));
});

function stubHandlers(): ConstructorParameters<typeof CoachToolRegistry>[0] {
  const notCalled = () => {
    throw new Error("not expected in this test");
  };
  return {
    showToday: notCalled,
    showCurrentPlan: notCalled,
    showWeeklyReport: notCalled,
    showMesocycleReview: notCalled,
    showGoalForecast: notCalled,
    showRecoveryBrief: notCalled,
    evaluateRecoveryTimeline: notCalled,
    showSafetyHold: notCalled,
    showNutritionStrategy: notCalled,
    proposeNutritionChangeFromTimeline: notCalled,
    proposeNutritionPlanCoordination: notCalled,
    proposePlanChange: notCalled,
    lookupExerciseKnowledge: notCalled,
    explainKnowledgeRule: notCalled,
  } as unknown as ConstructorParameters<typeof CoachToolRegistry>[0];
}
