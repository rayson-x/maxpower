# 15 — 校准 action×view candidate 资产并恢复识别率

**What to build:** 使用与最终评估隔离的训练/校准视频，为每个已启用
action×view 交付版本化的 local-coordinate 与 `RepTopologyProfile` 参数资产，使
动作专项主关系能够稳定产生完整候选，再以 Ticket 10 的同一漏斗验证恢复效果。

**Blocked by:** 当前只有已经反复用于诊断的 53 组 known-video（455 Rep）。它可
用于定位失败，不能既用于选择阈值又被包装成无偏识别率验收。需要用户计划录制的
动作训练视频、Rep/负窗口范围、冻结 source/session 分组，以及在揭示评估切分前
确定的数值验收门槛。

**Status:** blocked-by-calibration-data-and-acceptance-target — 这是 Ticket 06
数值失败后拆出的真实剩余工作，不是继续放宽 admission 的代码缺口。

## Why this ticket exists

本轮受治理回放表明，旧诊断的 194 个 raw candidate 在 action-driven runtime 中
只剩 51 个；raw 流只有 23 个真值匹配（Recall 5.05%），
Confirmed+NeedsReview Precision 为 64.71%，Recall 为 2.42%。主要
瓶颈已经前移到 candidate/local-coordinate：8,200 帧保持 Uninitialized，只有
3,648 帧 Frozen；13 个候选因 CoordinateNotFrozen 被拒绝，12 个为
IncompleteCycle。继续放宽正式次数门槛只会制造假 Rep，不能恢复没有生成的候选。

## Required input contract

- 训练/校准与最终 evaluation 按 participant、source、session 隔离；所有字段解析
  到治理 asset ID、admission、authority、groupKey 与 immutable hash。
- 每个目标 action×view 至少提供人工 Rep start/end、reviewed negative windows、
  已锁定 action/view/pose contract；需要器械主轨迹的动作另需独立器械 observation
  truth 或明确只校准 skeleton-primary。
- 人工范围用于 Rep segmentation/calibration，不自动成为 turnaround、器械轨迹或
  动作质量 truth。
- 在评估切分揭示前冻结最低 Recall/Precision、negative-window guardrail、边界与
  exact-set 目标；SDK 不自行发明产品通过线。

## Acceptance

- [ ] 离线校准器按 action×view 输出版本化主关系、anchor/axis、方向策略、最小行程、滞回、返回容忍、最短阶段、最大 gap 与 uncertainty 参数；不产生 action-name 代码分支。
- [ ] Rust 原子安装这些参数并由 `CompiledActionAnalysisPlan` 直接配置 candidate executor；缺资产/上下文不匹配 fail closed。
- [ ] 同一冻结评估分别报告 raw、Confirmed、Confirmed+NeedsReview、Rejected、FP/FN、边界、负窗口和 typed 原因；正式训练量仍只计 Confirmed。
- [ ] 相对当前 digest `8b850852fa6cdba9819349c3fd3dcb64d5401ce96e3eb3f5a96fc260e18b9e6b` 证明 raw candidate 与 matched Rep 恢复，且达到预先签署的数值门槛；未达到则 ticket 保持数值失败。
- [ ] 结果只声明对应冻结 cohort；跨参与者、设备和机位泛化仍由 Ticket 14 验收。
