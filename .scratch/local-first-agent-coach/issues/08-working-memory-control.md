# 08 — 跨 Session Working Memory 与用户控制

**What to build:** Coach 可以跨对话整理关注点、假设、开放问题与策略笔记，用户能查看、编辑、固定或删除；这些内容帮助组织上下文，但不能静默成为 Profile、Timeline 或 Plan 事实。

**Blocked by:** 04 — 基础 SQLite Ledger 与 CoachSession 恢复

**Status:** partial — follow-up required

- [x] WorkingMemoryItem 保存 kind、content、evidenceRefs、provenance、confidence、version、expiry、supersession、sensitivity 与创建 Run
- [ ] MemoryCurator 提供 typed upsert、supersede、forget、compact 与 propose-promotion，不接受整段自由文本覆盖
- [x] Working Memory 跨 CoachSession/restart 持久化，Run scratch 不进入长期 Memory
- [x] 用户可查看、编辑、删除和固定；用户项不被 Agent 覆盖
- [x] CoachKernel 规则不把 Working Memory 当权威事实
- [ ] Memory 升级为 Profile/Timeline 必须产生 typed Proposal 与 ActionEvent
- [ ] 并发编辑使用 revision/CAS，冲突不以 Agent 内容覆盖用户内容


Follow-up: `supersede`、`compact`、typed promotion → Profile/Timeline 的原子提交尚未实现；当前 CAS 在 Curator seam 校验，后续需下沉为 Ledger 原子命令以覆盖并发竞态。
