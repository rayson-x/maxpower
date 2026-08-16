# 03 — 用户手填营养数值后看到完整营养汇总

**What to build:** 用户手工填写包装标签、自定义食物或配方中明确给出的营养数值后，可以查看能量、宏量、膳食纤维、钠、钾，以及数据存在时的钙、铁、镁和适用维生素。只有确认数值参与 Daily Health Ledger；食物名称和份量本身不产生营养值。

**Blocked by:** 02 — 用户看到唯一的每日能量与宏量计算.

**Status:** completed

## Existing foundation and required change

- 保留食物名称、份量、餐次、手动输入来源、确认和 CorrectionEvent 中符合新业务的部分。
- 将现有宏量闭集替换为可扩展 nutrient identifier、单位、数值类型和字段级来源结构，并接入唯一 Daily Health Ledger。
- 直接删除条码、OCR、图片理解、参考食物库、food-composition provider、`per100g` 自动推导、模型估算、自动配方营养计算及其 UI、配置和测试。

## Acceptance criteria

- [x] 能量、蛋白质、碳水、脂肪、纤维、钠、钾、钙、铁、镁及适用维生素使用同一可扩展营养结构。
- [x] 正式营养值的字段级来源只能是 manual form、current user statement 或 manually transcribed label，并可追溯到确认提交或用户 turn。
- [x] 用户可保存只有名称和份量的描述性食物 Record；所有未填写营养素保持 unknown。
- [x] 手工标签、自定义食物和用户明确提供的配方数值经过相同单位归一、校验、确认和汇总。
- [x] 缺失营养素不能转换为零，也不能从食物身份、份量、同类食物、配方或知识搜索猜测。
- [x] 部分记录不能产生缺钾、缺铁、缺维生素等结论；一般参考范围和个体计划目标明确分开。
- [x] 补录、更正和单位修改产生新的 Ledger version，并保留原确认快照。
- [x] 客户端不存在拍照、OCR、扫码、搜索食物库、Estimate 或自动营养计算入口。
- [x] 默认客户端覆盖手工标签、文本代填确认、自定义显式数值、unknown、partial、correction 和 replay。
- [x] 全部旧 nutrition lookup/vision/provider/library/estimate 结构和调用方同次删除，不保留禁用配置或转换 Adapter。
