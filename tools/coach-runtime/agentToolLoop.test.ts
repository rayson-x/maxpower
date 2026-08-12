import assert from "node:assert/strict";
import test from "node:test";

import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture(provider: ScriptedLLMProvider, actionToolsEnabled = false) {
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
  const collaborativeTools = collaborativeProvider.requests[0]?.toolManifest.map((tool) => tool.name) ?? [];
  assert.equal(collaborativeTools.includes("plan.show_today"), true);
  assert.equal(collaborativeTools.includes("plan.propose_change"), true);
  assert.equal(collaborativeTools.includes("nutrition.propose_change_from_timeline"), false);

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
