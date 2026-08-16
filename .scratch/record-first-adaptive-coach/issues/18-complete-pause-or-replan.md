# 18 — 用户确认完成、暂停或基于最新记录重新规划

**What to build:** 满足 Goal contract 测量条件后，系统只能提出完成候选，由用户最终确认。用户随后可选择维持、新目标或暂停规划；暂停立即回到 record-first 并停止普通计划提醒。重新开启规划时使用最新 User profile、Timeline 和 Daily Health Ledger，不能静默恢复旧 Plan revision。

**Blocked by:** 17 — 后续阶段从真实行为和结果中学习.

**Status:** completed

## Existing foundation and required change

- 保留 Goal revision、immutable Plan history、Proposal、Home projection 和 Timeline 历史不可变语义中符合生命周期的部分。
- 将 generic aggregate archive、phase transition 和 completion 概念替换为正式 Plan lifecycle command 与产品状态。
- 删除 generic archive 充当关闭 Plan、旧 Plan 静默恢复、强制 maintenance 和各入口自行切换 Home 的路径。

## Acceptance criteria

- [x] 单次测量、规则结果或 Agent 文案不能自动完成目标。
- [x] 完成候选必须满足 Goal contract 的测量协议、观察窗口和结果要求。
- [x] 用户最终确认后可选择维持、新 Goal contract 或暂停，不强制生成维持计划。
- [x] 手动关闭 Plan 与 Coach 代关闭使用同一 typed command、校验、审计和投影。
- [x] 暂停保留 Goal、Plan revisions、Nutrition strategies、Plan outcomes、Working memory 和 Timeline 历史。
- [x] 暂停后 Home 切回 record-first，并停止普通完成度、调整和执行提醒。
- [x] 不可忽略的 safety Signal 在暂停状态仍可显示。
- [x] 重新规划读取最新 Daily Health Ledger 和领域版本，不静默激活旧 Plan revision。
- [x] 旧 Proposal 在暂停、完成、新 Goal 或新事实后保持历史可见但不可提交。
- [x] 默认客户端覆盖完成候选、拒绝完成、维持、新目标、手动暂停、Coach 暂停、重启恢复和重新规划。
- [x] 删除 generic archive 业务旁路、旧 Plan restore、强制 maintenance、重复状态投影和兼容逻辑。
- [x] 01–17 的全部前置业务场景通过默认组合重放后，本 ticket 才能完成。

