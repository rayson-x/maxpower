# 07 — 补齐未被当前动作资产选中的通用拓扑执行器

**What to build:** 在不增加动作名称分支的前提下，为 `hold_interval/v1`、`locomotion_step_cycle/v1` 与 `multi_stage_cycle/v1` 实现真正的 Rust Rep executor，并让未来动作资产可只通过 `RepTopologyProfile` 选择它们。

**Blocked by:** 需要每类拓扑至少一个完整的 `ActionMotionDefinition`：identity-defining primary relation、各阶段边界、计次单位、左右脚/左右侧语义和最小合格观测样例。当前 248 个已安装动作 × 8 个机位只选择五种 cycle topology（bilateral synchronous、independent bilateral、unilateral、alternating、pose-primary）；没有任何已安装动作可诚实地验证这三种 executor。

**Status:** blocked

## Why this was split from Ticket 02

Ticket 02 的 shared-cycle 路径已由 `RepTopologyProfile` 驱动并覆盖当前所有已安装动作。为没有动作语义的 topology 预设“hold 何时开始/结束”、“一步如何配对”或“multi-stage 哪个阶段决定 Rep”会重新引入隐藏的通用猜测，违背 `ActionMotionDefinition` 是唯一语义权威的契约。这里的阻塞不是模型或客户端问题，而是缺少可编译、可验收的动作拓扑资产。

## Acceptance

- [ ] 每种 topology 有至少一个版本化 action×view asset，明确 primary relation、边界、计数单位和可观察性。
- [ ] `MotionSession` 基于资产而非 action ID 选择 executor；没有未选择 topology 的状态机运行。
- [ ] 各 topology 覆盖 Confirmed、NeedsReview、Rejected、未来帧截断、单侧/双侧冲突和正式训练量行为。
- [ ] 冻结回放按 action×view 验证候选、admission、FP/FN 与边界指标。
