import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function runtime() {
  let sequence = 0;
  return {
    now: () => "2026-08-09T12:00:00.000Z",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
}

async function seededApplication(provider: ScriptedLLMProvider) {
  const ledger = new InMemoryCoachLedger();
  const application = new CoachApplication({ ledger, runtime: runtime(), llmProvider: provider });
  const session = await application.startSession({ userId: "tool-user", context: { kind: "today", ref: "2026-08-09" } });
  await application.seedUserState({
    userId: "tool-user",
    profile: { goal: "strength", trainingExperience: "intermediate" },
    plan: {
      revision: 1,
      effectiveDate: "2026-08-09",
      title: "力量日",
      tasks: [{ id: "bench", name: "卧推", sets: 3, reps: "5", loadKg: 60 }],
    },
  });
  return { application, ledger, session };
}

test("Provider 不能通过 plan.propose_change 注入任意任务或未声明字段", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "bad-plan-change",
      toolName: "plan.propose_change",
      input: {
        change: {
          kind: "add_task",
          task: { id: "model-chosen", name: "模型不应直接新增动作", sets: 3, reps: "8" },
        },
        reason: "尝试注入未声明字段",
      },
    },
    { type: "completed" },
  ]);
  const { application, ledger, session } = await seededApplication(provider);

  const events = await application.sendCoachTurn({ sessionId: session.id, text: "调整今天安排" });

  assert.equal(events.some((event) => event.type === "tool-state" && event.state === "output-error" && event.errorCode === "invalid_tool_input"), true);
  assert.equal(events.some((event) => event.type === "run-error" && event.code === "invalid_tool_call"), true);
  const snapshot = await ledger.read();
  assert.equal(snapshot.artifacts.some((artifact) => artifact.kind === "plan_change_proposal"), false);
  assert.deepEqual((await application.readUserProjection("tool-user")).plan.tasks, [
    { id: "bench", name: "卧推", sets: 3, reps: "5", loadKg: 60 },
  ]);
});

test("Provider 的闭合计划工具仍可提出有界的下一步调整", async () => {
  const provider = new ScriptedLLMProvider([
    {
      type: "tool-call",
      toolCallId: "good-plan-change",
      toolName: "plan.propose_change",
      input: {
        change: { kind: "adjust_task", taskId: "bench", loadKg: 62.5, scope: "this_session_only" },
        reason: "已确认表现支持最小档位递增",
      },
    },
    { type: "completed" },
  ]);
  const { application, ledger, session } = await seededApplication(provider);

  const events = await application.sendCoachTurn({ sessionId: session.id, text: "建议下一组调整" });

  assert.equal(events.some((event) => event.type === "artifact-ready" && event.artifactRef.kind === "plan_change_proposal"), true);
  const proposal = (await ledger.read()).artifacts.find((artifact) => artifact.kind === "plan_change_proposal");
  assert.ok(proposal && proposal.kind === "plan_change_proposal");
  assert.deepEqual(proposal.change, { kind: "adjust_task", taskId: "bench", loadKg: 62.5, scope: "this_session_only" });
});
