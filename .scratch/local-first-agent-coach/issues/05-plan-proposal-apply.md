# 05 — PlanChangeProposal、原子应用与 ActionReceipt

**What to build:** 用户可以获得带依据和 before/after 的 PlanChangeProposal，并通过确定性按钮安全应用；本地 Plan 生成新 revision，卡片原位变为 applied，并展示 ActionReceipt。

**Blocked by:** 04 — 基础 SQLite Ledger 与 CoachSession 恢复

**Status:** completed

- [x] Agent 只能调用注册的 proposal Tool，不能提供任意 JSON Patch、最终处方字段或数据库写入指令
- [x] CoachKernel 基于事实 snapshot 生成包含 base revision、typed diff、evidence、missingness、reason、risk 与 execution policy 的 Proposal
- [x] Card action 进入 ActionBroker → PolicyGate → CoachKernel，不重新经过 LLM
- [x] 一次性 ActionToken 绑定 user/session/run/toolCall/artifact/version/action/Plan/Mandate revision/expiry/nonce
- [x] CoachLedger AtomicCommit 一次写入 PlanRevision、Presentation event、ActionEvent 与 token consumption，全部成功或全部失败
- [x] 成功后生成 ActionReceipt Artifact；重复 idempotencyKey/token 不产生第二次写入
- [x] 基础 manual/collaborative/managed 矩阵通过公开场景测试，完整 scope/limit 组合留后续规则票
