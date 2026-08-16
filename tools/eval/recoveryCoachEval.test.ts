import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapWithGoal,
  callStream,
  evalComposition,
  recoveryEvalGatePassed,
  resolveRecoveryCoachToolsEnabled,
  runRecoveryCoachEval,
  textStream,
} from "./recoveryCoachEval";

/** 恢复 eval 上线门（issue 07）：套件全绿、flag 默认关、未达标拒绝翻转、达标后进清单。 */

const RECOVERY_TOOLS = ["plan.estimate_muscle_load", "plan.forecast_recovery"];

function manifestToolNames(requests: readonly unknown[]): readonly string[] {
  const first = requests[0] as { tools?: readonly { name: string }[] } | undefined;
  return first?.tools?.map((tool) => tool.name) ?? [];
}

test("eval 套件 CI 确定性全绿：工具选择 / 软建议话术 / 禁止声称各含正反", async () => {
  const report = await runRecoveryCoachEval();
  const failed = report.results.filter((result) => !result.passed);
  assert.deepEqual(failed.map((result) => `${result.id}:${result.detail}`), []);
  assert.ok(recoveryEvalGatePassed(report));
  for (const category of ["tool_selection", "soft_suggestion", "forbidden_claims"] as const) {
    assert.ok(report.results.some((result) => result.category === category), `缺少 ${category} 用例`);
  }
});

test("flag 默认关闭：工具不进 provider manifest，伪造调用不产生结果", async () => {
  const composition = evalComposition([
    () => callStream("plan.forecast_recovery", { horizonDays: 3 }),
    () => textStream("我现在没有恢复推演能力。"),
  ], { recoveryCoachTools: false });
  await bootstrapWithGoal(composition.kernel, "u1");
  const opened = await composition.conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await composition.conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "推演恢复", clientTurnId: "gate-off" });
  await composition.conversation.whenIdle(opened.conversation.id);
  const manifest = manifestToolNames(composition.requests);
  for (const name of RECOVERY_TOOLS) assert.equal(manifest.includes(name), false, `${name} 不应出现在清单`);
  const snapshot = await composition.ledger.read();
  assert.equal(snapshot.toolCalls.filter((call) => RECOVERY_TOOLS.includes(call.toolName) && call.status === "output_available").length, 0);
});

test("eval 达标后工具出现在 provider manifest", async () => {
  const composition = evalComposition([
    () => textStream("好的。"),
  ], { recoveryCoachTools: true });
  await bootstrapWithGoal(composition.kernel, "u1");
  const opened = await composition.conversation.execute({ kind: "new", userId: "u1" });
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  await composition.conversation.execute({ kind: "send", userId: "u1", conversationId: opened.conversation.id, text: "你好", clientTurnId: "gate-on" });
  await composition.conversation.whenIdle(opened.conversation.id);
  const manifest = manifestToolNames(composition.requests);
  for (const name of RECOVERY_TOOLS) assert.ok(manifest.includes(name), `${name} 应出现在清单`);
});

test("门槛未达标时 flag 保持关闭：翻转判定拒绝", async () => {
  assert.equal(resolveRecoveryCoachToolsEnabled({ requested: true, gatePassed: false }), false, "eval 未全绿不得翻转");
  assert.equal(resolveRecoveryCoachToolsEnabled({ requested: false, gatePassed: true }), false, "未请求不得默认打开");
  assert.equal(resolveRecoveryCoachToolsEnabled({ requested: true, gatePassed: true }), true);
  // 门判定本身：任何用例失败 → 不达标；空套件 → 不达标。
  assert.equal(recoveryEvalGatePassed({ results: [{ id: "x", category: "tool_selection", passed: false, detail: "boom" }], passedCount: 0, totalCount: 1 }), false);
  assert.equal(recoveryEvalGatePassed({ results: [], passedCount: 0, totalCount: 0 }), false);
});
