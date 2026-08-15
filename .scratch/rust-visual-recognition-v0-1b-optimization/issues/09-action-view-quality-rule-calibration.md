# 09 — 交付 action×view 质量规则资产与质量准确率验收

**What to build:** 将人工质量真值训练/标注产出的 versioned `FeatureProgram`、`ReferencePolicy`、`RulePack` 和 `SetAggregationPolicy` 作为 Rust SDK 资产安装；SDK 只执行并解释，不在客户端或动作名称分支里生成质量规则。

**Blocked by:** 每 Rep、每质量维度、按 action×view 的人工质量真值和 source lineage 尚未交付。当前规则没有这些真值，因此 v0.1b 只发布事实、TaskCompletion、ObservationConfidence 与 `CannotJudge`。

**Status:** blocked

## Acceptance

- [ ] 质量资产携带 action、variation、equipment、laterality、view、pose contract、版本、source lineage 与内容哈希，并由 Rust 原子校验安装。
- [ ] 每个规则的 feature、比较、阈值和 set pattern 可在因果 Trace 中还原；规则不能反向改变已封存 Rep。
- [ ] 冻结验证集含 per-Rep/per-dimension 人工真值，单独报告质量 coverage、abstention、precision/recall 和错误归因。
- [ ] 任何缺少 exact asset 或 truth 的质量维度保持 `CannotJudge`/`NotApplicable`，不得回落到全目录通用 0.20/0.15 阈值。
