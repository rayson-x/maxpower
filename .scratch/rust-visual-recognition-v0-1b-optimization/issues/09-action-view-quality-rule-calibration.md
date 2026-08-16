# 09 — 建立 action×view 质量规则资产安装合同

**What to build:** 让人工质量真值训练/标注未来产出的 versioned `FeatureProgram`、`ReferencePolicy`、`RulePack` 和 `SetAggregationPolicy` 可以作为 exact-context Rust SDK 资产原子安装；SDK 只执行并解释，不在客户端或动作名称分支里生成规则。

**Blocked by:** None for SDK implementation. 数值校准与质量准确率依赖的人工真值拆到 Ticket 13。

**Status:** complete — Rust 安装/校验/执行 seam 已完成；未校准维度继续 fail closed。

## Acceptance

- [x] 质量包携带 asset version、exact action/variation/equipment/laterality/view/pose contract、source lineage 与内容哈希；任一 exact-context 不一致时整包原子回滚。
- [x] 每个已执行规则保留 Feature→Comparison→Rule→SetPattern→Conclusion Trace，不能反向改变已封存 Rep。
- [x] 任何缺少 calibrated exact asset 的维度保持 `CannotJudge`/`NotApplicable`；全目录安装不会把 prototype 0.20/0.15 阈值发布为质量合格/偏差。

## Completion evidence

`QualityRuleAssetPackage` 现在绑定完整 `AssessmentExactContext` 与 `assetVersion`；合同测试覆盖跨变式、器械、侧别、机位或 pose contract 重贴标签的失败与原子回滚。运行时只在包被正确安装且证据可判时执行规则。人工 truth、阈值拟合和质量 precision/recall 不属于 SDK 实现完成度，统一由 Ticket 13 验收。
