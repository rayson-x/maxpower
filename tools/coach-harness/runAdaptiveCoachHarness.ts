import { runAdaptiveCoachHarnessScenario } from "./adaptiveCoachHarness";

void (async () => {
  const reports = await Promise.all([
    runAdaptiveCoachHarnessScenario({
      id: "demo-stable",
      agentAction: "show_today",
      userText: "今天按计划训练，状态稳定，帮我看看今天安排。",
    }),
    runAdaptiveCoachHarnessScenario({
      id: "demo-dinner",
      agentAction: "energy_rebalance",
      userText: "今天聚餐确认比计划多了 700 千卡，想尽量按原日期完成。",
      confirmation: "confirm_latest",
    }),
    runAdaptiveCoachHarnessScenario({
      id: "demo-recovery",
      agentAction: "recovery_adjustment",
      userText: "我昨天练腿，今天睡得不好，腿还酸但其他位置还行，可以换肩训练吗？",
      confirmation: "reject_latest",
    }),
  ]);

  console.log(JSON.stringify(reports, null, 2));
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
