# 03 — 每日营养账本与下一餐建议

**What to build:** 在既有客户端视觉与导航中新增唯一的新 UI 模块：每日能量与蛋白质、碳水、脂肪进度，早餐/午餐/晚餐/加餐列表和饮食录入。NutritionStrategy 与当天训练/恢复计划生成预算；用户确认餐食后更新账本与 Timeline，Agent 根据最新剩余额度和生活条件生成可编辑下一餐建议。

**Blocked by:** 01 — 用户档案到长期策略、周计划与今日计划

**Status:** wontfix

**Owner:** claude-agent-b（并行开发中，认领于 2026-08-09 18:35 CST）

- [ ] 开始实施前盘点现有 NutritionStrategy、Meal observation、ProductProjection 能力，只补每日产品闭环
- [ ] NutritionStrategy 保存阶段能量方向、protein/fat floors、carbohydrate allocation、训练/休息日模式、选择原因、假设、护栏和 review window
- [ ] NutritionPlan 根据 active phase、WeekPlan、当天 TrainingPlan 和 RecoveryConstraint 生成 energy、protein、carbohydrate、fat target
- [ ] NutritionDayLedger 按用户计划时区汇总 confirmed MealEntry，输出四项 target、consumed、remaining/overage 和 coverage
- [ ] Today 营养卡显示热量和三大营养素进度、剩余或超额，并使用既有卡片视觉语言
- [ ] 营养详情按早餐、午餐、晚餐和加餐展示 FoodEntry、份量、四项营养值、来源和确认状态
- [ ] FoodEntry 支持小型本地基础食物、自定义食物、营养标签、常用餐、历史复用和用户直接输入
- [ ] 一个 MealEntry 可包含多个 FoodEntry，并在确认前编辑食物、份量、餐次和营养范围
- [ ] 自然语言或照片只能产生带 provider/source/confidence/range 的 NutritionObservationDraft；生产照片识别不阻塞本票
- [ ] 用户确认实际吃过后才写 MealEntry 和 Timeline；推荐、草稿、未记录餐次和未确认估算不计入 consumed
- [ ] 新增、编辑、删除或更正餐食后账本确定性更新，CorrectionEvent 保留原事实
- [ ] 缺日志保持 unknown，不解释为零摄入或不诚实；超出目标显示 overage，不强行截断剩余值
- [ ] NextMealRecommendation 读取最新 Ledger revision、剩余四项、当前阶段、当天训练/恢复、时间、饮食限制、厨具、预算和历史常用餐
- [ ] 下一餐提供一至三个可编辑食物组合、建议份量、预计能量和三大营养素，并明确范围和未知
- [ ] 做饭、外食、外卖和便利食品只影响候选类别与组合规则；具体商户、价格、距离、库存只能来自注册工具结果
- [ ] 无实时商户工具时只给菜品类别和点餐原则，不能虚构餐厅、商品或价格
- [ ] 选择推荐只创建 MealDraft；确认吃过后才写 Timeline 并更新剩余额度
- [ ] 任一 MealEntry 或 NutritionPlan revision 变化使旧 NextMealRecommendation stale，重新打开按最新账本计算
- [ ] DailyEvaluation 可以移动尚未发生餐次的宏量分配，但不能覆盖已确认摄入或静默改变长期能量方向
- [ ] 只有足够体重趋势、摄入覆盖、执行和训练表现达到 review gate 时才提出 NutritionStrategy revision
- [ ] 营养建议显示用户事实、产品规则、研究依据、未知、替代组合和复核时间
- [ ] 完全离线时可查看目标、录入食物、汇总、生成本地下一餐候选和更正历史
- [ ] 重启后恢复当天账本、MealDraft、餐次、常用餐、stale 状态和 Timeline refs
- [ ] CoachApplication 场景跑通“记录两餐 → 查看剩余 → 推荐下一餐 → 编辑/确认 → 汇总更新 → 次日计划使用摄入事实”
- [ ] 新增 UI 仅限 NutritionDayLedger、餐次列表和录入/编辑 sheet，不重排既有 Today、Calendar、Plan、Progress、Profile 或 Coach Drawer

## Comments

- 这是本轮唯一新增的客户端 UI 面。
- 生产多模态 Provider 保持 deferred；手工和自定义输入必须独立完成闭环。

### 2026-08-09 — 实施前盘点（第 1 条验收）

与 01 并行开发。01 正在改 `src/onboarding/`、`src/planning/`、`src/coach/domain.ts`；本票只做**追加式**编辑，新逻辑集中在 `src/nutrition/` 与 `src/mobile/ui/`。

**Reused / already-green（不重建）**

| 能力 | 位置 | 覆盖的验收 |
| --- | --- | --- |
| NutritionStrategy 阶段方向、protein/fat floor、carb allocation、训练/休息日 dayTypes、review window、安全护栏、碳分配不改变周能量的不变量 | `src/nutrition/NutritionStrategyEngine.ts`；facade `createNutritionStrategy` / `proposeNutritionStrategyChange` / `proposeNutritionPlanCoordination` | 第 2 条 |
| 用户确认后才写 Timeline：`createManualMealObservation` → `confirmMealObservation` → `timeline.fact_appended {kind:"nutrition"}`；LLM 估算无 `confirmedByUser` 直接抛错 | `src/nutrition/ManualMealObservation.ts`、`createCoachApplication.ts:2567`、`:5860` | 第 9、10 条 |
| NutritionObservationDraft 带 provider/source/confidence/range，create/read/confirm/reject 且以 ledger artifact 持久化 | `createCoachApplication.ts:2612-2820` | 第 9 条 |
| CorrectionEvent 追加式更正 | `correctTimelineFact`、`src/product/timelineCorrection.ts` | 第 11 条（账本侧仍需接） |
| Review gate 证据（体重趋势、可比较性、最少观测数） | `deriveNutritionReviewEvidence` | 第 19 条 |

**Gap（本票实现范围）**

1. `NutritionPlan`：由 active phase + WeekPlan 当天 dayType + `RecoveryConstraint` 推出四项日目标 —— 无实现（第 3 条）
2. `NutritionDayLedger`：按计划时区分桶汇总 confirmed 事实，输出 target/consumed/remaining|overage/coverage —— 全仓库零命中（第 4 条）
3. 餐次（早/午/晚/加餐）与 `FoodEntry` 组合：`TimelineFact.nutrition` 目前只有单条 observation，无 mealSlot、无 food 明细（第 5、6、7、8 条）
4. 本地基础食物 / 自定义食物 / 常用餐 / 历史复用（第 7 条）
5. `NextMealRecommendation`、MealDraft、stale 重算（第 13–18 条）
6. 缺日志 = unknown 而非 0、超额显示 overage（第 12 条）
7. Today 营养卡 + 营养详情 + 录入 sheet（第 5、6、24 条）
8. 端到端场景与重启恢复（第 22、23 条）

**Deferred / 依赖 01 或 04**

- 第 3 条中的 WeekPlan/TodayPlan 引用等 01 落地后接上；在此之前 NutritionPlan 直接读 active NutritionStrategy 的 dayTypes。
- 第 17 条 DailyEvaluation 移动未发生餐次的宏量分配依赖 04 的 DailyEvaluation；本票只保证账本侧“不可覆盖已确认摄入”的不变量。
- 生产照片识别保持 deferred（票据 Comments 已声明）。
