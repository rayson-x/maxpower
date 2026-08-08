# 06 — HITL 恢复、stale 与重新计算

**What to build:** Agent 真正缺少用户选择时可以暂停并在稍后恢复；等待期间事实变化会让旧 Proposal 保持可见但不可提交，用户可显式重新计算关联的新 Artifact。

**Blocked by:** 05 — PlanChangeProposal、原子应用与 ActionReceipt

**Status:** partial — Agent run continuation follow-up required

- [ ] typed suspend/resume/output payload 分别校验并以同一 runId/toolCallId 关联
- [x] 收起 Drawer、切换 context 和 restart 后 PendingHumanAction 仍可恢复
- [x] pending HITL 不持有事务或写锁，也不阻塞新的只读 Run
- [x] resume 时重读并校验 Plan、Mandate、Artifact 与 evidence revisions
- [x] stale Proposal 原位禁用提交；recompute 生成 linked 新 Artifact 与新 token
- [x] 模式降级立即使等待中的自动提交失效，但 Proposal 仍可查看
- [x] safety hold、用户锁和越权 action 不能通过 resume 绕过

Follow-up: pending payload、single-use、revision 校验与 restart 枚举已完成；resume 目前返回 typed output 并恢复 Session，但尚未把 output 继续送入原 AgentRuntime/provider tool loop，因此不宣称完整的同-run continuation。
