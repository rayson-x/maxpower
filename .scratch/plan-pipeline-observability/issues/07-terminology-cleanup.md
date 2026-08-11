# 07 — 术语清理："处方" → "训练计划"

**What to build:** 全库"处方/prescription"语义改为正常"训练计划"语言。注释、文档、用户可见文本立即清理；类型级改名走 expand-contract：先加新名（别名并行，旧名不破坏），分批迁移调用点（每批 CI 全绿），最后删除旧名。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 用户可见文本与注释不再出现"处方"语义（统一为训练计划/安排）
- [ ] 类型改名按 expand-contract 完成（新别名 → 分批迁移 → 删旧名），全程 CI 绿色
- [ ] 领域词汇表（CONTEXT.md 与设计文档）同步更新
