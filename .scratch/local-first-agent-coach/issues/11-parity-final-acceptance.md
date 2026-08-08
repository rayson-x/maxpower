# 11 — 离线、共享代码与 Spec 最终验收

**What to build:** 同一组 fixture 可以证明 TodayPlan、Proposal、HITL、Memory、Action Log、undo 和 SetSummary 行为在 In-memory、SQLite 与共享客户端合同中一致，并逐条回查 PRD 和前置 tickets。

**Blocked by:** 03 — Coach Drawer 演示面与 Stream Projection; 06 — HITL 恢复、stale 与重新计算; 07 — 补偿撤销与用户 Action Log; 08 — 跨 Session Working Memory 与用户控制; 09 — Provider Port 与 Context contract; 10 — Fixture Live SetSummary 与安全边界

**Status:** partial — final production conformance follow-up required

- [x] 主 seam 覆盖 TodayPlan → Proposal → apply/reject/stale/recompute → ActionReceipt → undo 完整 replay
- [ ] In-memory/SQLite、Scripted/remote-thin Provider 与 Fixture Motion contract suites 通过
- [x] Local-only 除显式 remote LLM 外网络调用为零，Provider 故障不阻断本地计划、记录和撤销
- [x] 共享 TypeScript contract 对相同 frontier/versions/command 产生相同结构化结果；iOS 真机构建不在本轮声明内
- [x] prompt injection、非法 schema、虚构 ID、单位错误、任意 patch、token 重放与越权不产生事实写入
- [ ] restart/crash-point、idempotency、CAS、stale、token single-use 与补偿撤销通过
- [x] UI 不展示通用技术评分、骨架推断 RIR 或无证据 correctness；卡片展示来源、missingness 与 capability boundary
- [x] 逐条核对 PRD 与 01–10，未完成的生产 Adapter/算法只记录为明确 out-of-scope，不伪称完成

Follow-up: 真实 remote-thin Provider contract suite、系统化 crash-point fault injection、Ledger 级 Memory CAS 与完整跨 Adapter replay 尚未完成；本轮不宣称 iOS 真机构建或生产 Motion/Health/Sync Adapter。
