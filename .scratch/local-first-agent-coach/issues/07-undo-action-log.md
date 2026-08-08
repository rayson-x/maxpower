# 07 — 补偿撤销与用户 Action Log

**What to build:** 用户可以查看 Agent 的有意义读取、判断、提案与写入，并撤销最近可逆的计划修改；撤销创建新的补偿 revision 与回执，不删除旧记录。

**Blocked by:** 05 — PlanChangeProposal、原子应用与 ActionReceipt

**Status:** partial — read/proposal audit follow-up required

- [ ] Action Log 与 Timeline 分离；底层 provider/token telemetry 进入内部 Tool Audit
- [ ] 写 ActionEvent 引用 actor、before/after revision、typed diff、evidence、policy/human decision、versions 与 causal IDs
- [x] 用户可筛选全部操作与有变更操作
- [x] undo 通过 ActionBroker 与 AtomicCommit 创建补偿 PlanRevision、ActionEvent 和 ActionReceipt
- [x] 原 PlanRevision、Proposal 与 ActionEvent 不可变且仍可查询
- [x] 已 stale、已撤销或不可逆操作返回结构化不可执行状态
- [x] apply → restart → undo → restart 主 seam 场景通过且不存在计划/审计分裂状态

Follow-up: apply/reject/undo 的 append-only ActionEvent、筛选和补偿撤销已完成；有意义的 read/judgement/proposal 事件、独立 Tool Audit、rule/catalog/policy version 字段仍需补齐。
