# 13 — 质量规则校准与人工真值验收

**What to build:** 使用 per-Rep、per-dimension、action×view 的人工质量真值拟合并交付版本化质量资产，随后评估 coverage、abstention、precision/recall 与错误归因。

**Blocked by:** 当前还没有上述人工质量真值。用户反馈不是标注，不得把普通用户要求判断“标准/错误”；需要由受治理的专业标注流程交付 source lineage、标签定义和冻结切分。

**Status:** blocked-by-data — Rust 安装与解释合同已由 Ticket 09 完成。

## Acceptance

- [ ] 每个启用维度有清晰标签定义、标注者协议、一致性结果和 action×view 适用范围。
- [ ] train/calibration/evaluation 按 participant、source、session 隔离，所有字段解析到治理 asset ID 与 admission。
- [ ] 交付包通过 Ticket 09 exact-context、version、hash、lineage 原子安装合同。
- [ ] 分别报告质量 coverage、CannotJudge、precision/recall、混淆与错误因果；不能用 Rep 识别率替代质量准确率。
