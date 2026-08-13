# 09 — NIDDK 体重管理知识包

**What to build:** 蒸馏 NIDDK 面向公众的体重管理、能量变化和现实预期资料，发布 Source Pages 与 Claim Pages，并更新“减脂平台期”“体重波动”和“目标预期”Topic Pages。群体模型和计算工具只能作为有假设的证据来源，不能成为个人精确预测。

**Blocked by:** 01. IUSCA 增肌来源端到端试点

**Status:** ready-for-human

- [x] 为使用的公众页面和计算工具分别发布 Source Page，登记版本、更新时间、公共领域状态、引用边界和内容哈希
- [ ] 发布体重变化、能量摄入、减重预期、平台期和长期维持的 Claim Pages
- [x] 将短期水分变化、测量噪声和长期脂肪变化拆为不同 Claim，并记录时间范围
- [x] 对计算模型记录输入假设、适用范围、误差来源和不能作为个人保证的限制
- [x] 更新“减脂平台期”“体重波动”和“目标预期”Topic Pages；与 ISSN 重复或冲突时建立显式关系
- [ ] 自动蒸馏内容经人工复核后再标 reviewed；Wiki 验证、链接检查和索引构建通过

## Comments

- 2026-08-13 原等待人工补源说明已被后续官方材料核查部分取代：NIDDK 托管的 Body Weight Planner 技术附录可定位最初数周的糖原伴随水分/细胞外液、脂肪与瘦体组织分区及趋近稳态的模型响应；NIDDK Central Repository 的 PRIDE 参与者手册可定位同一时间/同一台秤、日间波动及观察数周到数月模式。两者都不能提供个人平台日期、短期水重幅度、消费级体重秤误差或自动调热量阈值。
- 2026-08-13 冻结边界：`corpus_release.open-fitness.2026-08-13` 和 generated corpus release 已固定原有 2 Sources、4 reviewed Claims、3 Topics 的 revision/hash，因此本票没有覆盖这些 record 或修改 frozen pins。新增 3 Sources、5 `claim_extracted` Claims 和 2 draft Topics，作为下一版 Corpus Release 候选；旧 Topic 保持 revision 1。
- 2026-08-13 人工门禁：新增 Claims 全部 `review.status=pending_review`，explanation/planning/safety 均为 `excluded`；“发布 Claims”和“人工复核后再标 reviewed”均仍未完成，必须由人工 Evidence Reviewer 核对页级 locator、适用人群、许可与 `cannotSupport` 后才能转为 reviewed。

## 2026-08-13 一手材料审计

| 数据项 | 官方材料与精确 locator | 结果 | 证据边界 |
|---|---|---|---|
| 最初数周水分 | NIDDK 托管 `Hall_Lancet_Web_Appendix.pdf`，PDF page 2（printed page 1），`Early Phase of Weight Change` 开头及 equations (1)–(2) | 新增 `claim.weight.niddk-model-early-weight-includes-fluid` | 只描述成人模型的糖原伴随水分和 ECF；不预测个人方向、幅度或固定天数 |
| 较长期脂肪/瘦体组织 | 同附录 PDF page 3（printed page 2），`Energy Partitioning between Body Fat and Lean Tissue` equations (3)–(5)；PDF page 5（printed page 4）首段 | 新增 `claim.weight.niddk-model-long-term-fat-lean-separate` | 总体重不等于脂肪；模型分区不等于个体直接测量或保证 |
| 平台/预期 | 同附录 PDF pages 5–6（printed pages 4–5），`Characteristic Time Constant for Long Term Body Weight Change` equations (10)–(15) 及接近 steady state 的说明 | 新增 `claim.weight.niddk-model-response-approaches-steady-state` | 仅在指定阶跃输入与模型假设下非线性趋稳；不是现实平台期定义、阈值或诊断 |
| 测量噪声/观察 | NIDDK Central Repository PRIDE lessons，PDF page 11，Session 1 `Welcome to the PRIDE Program, page 4`，`To keep track of your weight` | 新增 `claim.weight.niddk-pride-use-weight-trend` | 仅为 PRIDE 特定人群的项目指导；承认波动但不给噪声幅度、原因分解或全人群频率建议 |
| 能量变化与维持 | NIDDK `Eating & Physical Activity to Lose or Maintain Weight`，`How can I maintain weight loss?` 开头，Last Reviewed May 2023 | 新增 `claim.weight.niddk-reduced-weight-needs-fewer-calories` | 定性说明较低体重需要更少热量及维持难度；不给个人维持热量或代谢适应效应量 |

## 下一版候选记录

- Sources：`source.weight.niddk-bwp-model-supplement`、`source.weight.niddk-loss-maintenance-guidance`、`source.weight.niddk-pride-weight-tracking-manual`
- Claims：`claim.weight.niddk-model-early-weight-includes-fluid`、`claim.weight.niddk-model-long-term-fat-lean-separate`、`claim.weight.niddk-model-response-approaches-steady-state`、`claim.weight.niddk-pride-use-weight-trend`、`claim.weight.niddk-reduced-weight-needs-fewer-calories`
- Topics：`topic.weight.niddk-dynamic-weight-components`、`topic.weight.niddk-reduced-weight-maintenance`
- 明确 unknown：个人水重幅度、消费级秤误差、体重波动的原因占比、平台持续时间/斜率阈值、个人维持热量、疾病/药物/训练状态分层。
