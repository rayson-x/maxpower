# 01 — 扩展可回放的行为决策审计

**What to build:** 为用户对话、Timeline、风险、规划、通知和实时提示建立同一条可回放因果链；开发者能解释每次行为为何执行、合并、跳过、失败或过期，而不记录模型思维链。

**Blocked by:** None — can start immediately.

**Status:** wontfix

- [ ] 每个决策边界产生带 causation、事实版本、版本钉和闭集 reason code 的行为记录，既有 trace/outbox 兼容。
- [ ] 任何异步后续行为可关联其触发事实；新事实会使旧提案/评估可审计地变为 stale。
- [ ] 可通过公开的 CoachApplication/trace seam 回放正向和负向决策，且不持久化原始思维链。
