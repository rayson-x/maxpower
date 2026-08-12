import assert from "node:assert/strict";
import test from "node:test";

import { runAdaptiveCoachHarnessScenario } from "./adaptiveCoachHarness";

test("独立 Harness：稳定执行、聚餐偏差与恢复调整均走真实 Agent 闭环", async () => {
  const stable = await runAdaptiveCoachHarnessScenario({
    id: "stable-review",
    agentAction: "show_today",
    userText: "今天按计划训练，状态稳定，帮我看看今天安排。",
  });
  assert.equal(stable.initialPlan.confirmed, true);
  assert.deepEqual(stable.agent.toolNames, ["plan.show_today"]);
  assert.equal(stable.timeline.factKinds.length, 0);
  assert.equal(stable.planChanges.currentPlanChangedBeforeConfirmation, false);

  const recoveryRecord = await runAdaptiveCoachHarnessScenario({
    id: "recovery-record",
    agentAction: "record_recovery",
    userText: "昨晚睡眠不足，今天主观恢复一般。",
  });
  assert.deepEqual(recoveryRecord.agent.toolNames, ["timeline.record_user_report"]);
  assert.deepEqual(recoveryRecord.timeline.factKinds, ["recovery"]);
  assert.equal(recoveryRecord.risk.latest?.state, "insufficient_evidence");

  const dinner = await runAdaptiveCoachHarnessScenario({
    id: "dinner-deviation",
    agentAction: "energy_rebalance",
    userText: "今天聚餐确认比计划多了 700 千卡，想尽量按原日期完成。",
    confirmation: "confirm_latest",
  });
  assert.deepEqual(dinner.agent.toolNames, ["plan.propose_energy_rebalance"]);
  assert.deepEqual(dinner.timeline.factKinds, ["nutrition"]);
  assert.equal(dinner.risk.latest?.state, "at_risk");
  assert.equal(dinner.planChanges.currentPlanChangedBeforeConfirmation, false);
  assert.equal(dinner.planChanges.pendingFuturePreviews, 1);
  assert.equal(dinner.planChanges.confirmedFutureRevision, true);
  assert.equal(dinner.observability.boundaries.includes("tool_validation"), true);

  const recovery = await runAdaptiveCoachHarnessScenario({
    id: "recovery-change",
    agentAction: "recovery_adjustment",
    userText: "我昨天练腿，今天睡得不好，腿还酸但其他位置还行，可以换肩训练吗？",
    confirmation: "reject_latest",
  });
  assert.deepEqual(recovery.agent.toolNames, ["plan.adapt_from_user_report"]);
  // 定性“睡眠差 + 局部酸痛”只形成短期、可确认的恢复约束，不能伪装成
  // 用户报出的数值恢复事实，因此不会污染 Timeline。
  assert.deepEqual(recovery.timeline.factKinds, []);
  assert.equal(recovery.planChanges.currentPlanChangedBeforeConfirmation, false);
  assert.equal(recovery.planChanges.pendingFuturePreviews, 1);
  assert.equal(recovery.planChanges.rejectedFutureRevision, true);
});

test("独立 Harness：同一已确认聚餐事实在不同目标模式产生不同风险结论", async () => {
  const leanCut = await runAdaptiveCoachHarnessScenario({
    id: "lean-cut-dinner",
    agentAction: "energy_rebalance",
    userText: "聚餐确认比计划多了 700 千卡。",
  });
  const higherBodyMass = await runAdaptiveCoachHarnessScenario({
    id: "higher-body-mass-dinner",
    agentAction: "energy_rebalance",
    goalMode: "higher_body_mass_fat_loss",
    userText: "聚餐确认比计划多了 700 千卡。",
  });

  assert.equal(leanCut.risk.latest?.state, "at_risk");
  assert.equal(higherBodyMass.risk.latest?.state, "on_path");
  assert.equal(higherBodyMass.planChanges.pendingFuturePreviews, 1);
});
