# 02 — 用户看到唯一的每日能量与宏量计算

**What to build:** 用户记录饮食、活动和训练后，获得计划无关的 Daily Health Ledger，包括已确认摄入、基础消耗、日常活动、训练、食物热效应、`摄入－消耗`热量差范围、蛋白质、碳水、脂肪、覆盖度和不确定性。无计划、计划、手动和 Coach 场景读取同一个正式结果。

**Blocked by:** 01 — 用户手动或由 Coach 代填同一份可信 Record.

**Status:** completed

## Existing foundation and required change

- 保留 Timeline 中已确认的饮食、活动、训练和身体 Records 作为唯一事实输入。
- 现有 NutritionDayLedger、每日能量预算和摄入预算不能共同充当唯一、计划无关的日计算结果；直接收敛为一个正式 Daily Health Ledger Module。
- 迁移 Record、Today、Plan、Coach 和后续规划消费者后，删除重复 TDEE、活动回补、计划专属日账本和任何旁路计算器。

## Acceptance criteria

- [x] 摄入只汇总用户确认的结构化数值；食物名称、份量或配方名不得触发 lookup、imputation 或模型估算。
- [x] 热量差统一为摄入减估算消耗，负值表示缺口、正值表示盈余，并以范围和不确定性展示。
- [x] 基础消耗、日常活动、训练和食物热效应分别可追溯；穿戴设备或用户报告消耗作为带误差证据处理。
- [x] no-log、partial 和 logged 保持不同；缺记录不按零摄入、零活动或未执行计算。
- [x] 摄入覆盖不足时能量与宏量结果显示 partial/unknown，不生成补全范围或伪精确总量。
- [x] 补录和 CorrectionEvent 生成新的有效 Ledger version，旧版本及其事实前沿仍可审计。
- [x] 同一日通过 Record、Today、Plan 和 Coach 查看时，能量与宏量结果完全一致。
- [x] 无 Goal、Plan 或 Nutrition strategy 时仍可使用；计划目标只是可选对照。
- [x] 固定时钟、事实前沿和规则版本可稳定重放部分记录、活动误差、修正和重启恢复场景。
- [x] 被替代的计算结构、调用入口和测试同次删除；全库不存在第二个正式能量或营养日账本。

