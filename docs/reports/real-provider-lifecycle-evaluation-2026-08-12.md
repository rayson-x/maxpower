# 真实 Provider 生命周期评估（2026-08-12）

## 结论

本次通过 SSH 隧道连接 `cloud-developer` 的真实云端 Provider，以独立内存账本运行 AgentRuntime、ToolRegistry、Planner 与确认写入流程；未启动移动端。

规划与本地确定性闭环可靠，但云端 Provider 在连续多轮时多次返回“服务暂时不可用”或超时。因此不能将真实 LLM 的端到端可靠性标记为通过；当前状态为 **业务链路部分通过，Provider 可用性未达标**。

## 已验证的真实调用

| 场景 | 真实模型工具路由 | 事实/预览 | 确认结果 | 结论 |
| --- | --- | --- | --- | --- |
| 初始减脂规划（低依从白领） | 1 次工具调用，Provider run 完成 | 计划质量检查通过 | PlanRevision 落账 | 通过 |
| 稳定训练 + 严格饮食 | `timeline.record_user_report`、`nutrition.record_observation` | 训练与饮食写入 Timeline | 无需重排 | 通过 |
| 恢复 2/5、疲劳 9/10 | `plan.adapt_from_user_report` | 恢复事实、`recovery_downgraded` 预览 | 版本 1 → 2 | 通过 |
| 出差无法训练 | `plan.adapt_from_user_report` | 日程事实、`schedule_changed` 预览 | 版本 1 → 2 | 通过（修复后复测） |
| 聚餐多 650 kcal | `plan.propose_energy_rebalance`（一次可用 Provider 回合） | 饮食差额写入 | 当前计划无安全的力量后低冲击有氧容量时，无提案 | 正确地只记录；不能证明补偿分支 |

稳定场景中“汇总本周记录”的模型路由为 `plan.show_current`，并未选择专用周报工具。这是提示/工具选择质量缺口，需单独补充真实模型评估样本。

## 发现与修复

1. 出差调整预览原先未保存 `missedSessionDates`；确认阶段重放时丢失日期，导致 `planning_preview_stale`。现已将该字段持久化在 preview request，并在重算、确认、物化阶段完整回放。
2. 能量回调在没有可安全追加的力量后低冲击有氧容量时，Planner 返回 `typed_diff_empty`。现将其呈现为 `ready` 的记录回执，而非错误的“待确认调整”。
3. Provider 可能在工具已经写入结果后，文本流仍返回不可用/超时。工具层幂等键保持账本安全，但用户体验层需要把已生成的 artifact 优先展示，而不是只显示 Provider 错误。

## 可复跑命令

```bash
# 真实 Provider（需要本机隧道以及环境中的测试账号）
npm run e2e:real-provider-lifecycle

# 单独跑真实场景
MAXPOWER_E2E_SCENARIOS='recovery,schedule' \
MAXPOWER_E2E_REPORT_PATH=/tmp/maxpower-live-report.json \
npm run e2e:real-provider-lifecycle

# 无网络的完整确定性生命周期回归
npm run test:coach-lifecycle
```

## 本地回归

- `playbookEval` + `coachLifecycle`：22/22 通过。
- 出差预览确认回归：21/21 通过。
- `git diff --check` 通过。

## 下一步

1. 在 AgentRuntime 层把“工具已产出 artifact、Provider 文本流失败”变成部分成功状态并展示 artifact。
2. 为 `coach.show_weekly_report` 增加真实 LLM 路由样本和重复评估阈值。
3. 在 Provider 可用时，以有明确力量后有氧容量的人设重跑“已知 650 kcal 差额 → gentle_rebalance → 确认”的真实模型分支；当前分支已由确定性生命周期测试覆盖。
