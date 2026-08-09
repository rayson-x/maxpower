# 04 — 恢复状态与每日联合评估

**What to build:** 复用既有 Today、Timeline 和 Coach 卡片，通过低负担手工 check-in 记录睡眠、疲劳、酸痛、主观恢复和可用时间。系统将它们与 active phase、训练表现、饮食和日程组合成 DailyEvaluation、RecoveryPlan 与 RecoveryConstraint，只调整尚未执行的当日内容，并为休息日生成可执行安排。

**Blocked by:** 01 — 用户档案到长期策略、周计划与今日计划

**Status:** ready-for-agent

- [ ] 开始实施前盘点现有 Timeline、Recovery、Replanner、Today projection 能力，只补公开产品缺口
- [ ] Today 使用既有交互收集睡眠时长/质量、疲劳、酸痛、主观恢复、疼痛和今日可用时间
- [ ] 原始回答作为带 occurredAt、source、method、confidence 和 provenance 的 Timeline facts 保存，不压成不可解释综合分数
- [ ] 缺失恢复数据保持 unknown；用户不填写时仍可执行原计划
- [ ] RecoveryStrategy 保存阶段睡眠/休息节奏、疲劳管理、deload intent、check-in cadence 和 review window
- [ ] RecoveryConstraint 使用 normal、slight_reduction、recovery_priority、pause_and_confirm 四级 canonical 语义
- [ ] DailyEvaluation 同时读取 active GoalCycle/PlanRevision、当天安排、近期 Workout、NutritionDayLedger、Recovery facts、日程和器材变化
- [ ] 一次普通睡眠或主观波动只产生 keep 或有界 DailyAdjustment，不取消整个训练或修改 GoalCycle
- [ ] 恢复明显下降时可以对尚未开始任务提出 reduce_load、reduce_volume、extend_rest、reschedule、recovery_day 或动作替代
- [ ] 已开始 set 和已完成事实不被 Recovery 写入覆盖；调整只发生在下一安全边界
- [ ] 疼痛或红旗走 pause_and_confirm，停止相关建议并请求用户确认；Agent 不诊断或生成康复治疗
- [ ] 休息日仍物化恢复任务、营养目标和 Activity Log 入口，不生成虚假的力量 Task List
- [ ] RecoveryPlan 展示今日任务、训练限制、使用事实、缺失信息、相对长期基线的 diff 和下一复核时间
- [ ] 用户可按 CoachingMandate 确认、拒绝和撤销普通调整；安全约束不能被 managed 模式覆盖
- [ ] 修改历史 check-in 通过 CorrectionEvent 追加并使依赖 RecoveryBrief、Today 和 Proposal stale
- [ ] 没有实质 diff 时 Coach 保持安静，只记录必要 evaluation audit
- [ ] Workout、Meal、Recovery、schedule/equipment change 和 user request 都能触发幂等 DailyEvaluation，但同一 frontier 不重复生成 Proposal
- [ ] 完全不接 HealthKit、Health Connect 或 wearable 时流程完整可用，且这些平台不成为依赖
- [ ] 重启后恢复当天 check-in、RecoveryPlan、pending Proposal、Timeline 和 Action Log
- [ ] CoachApplication 场景证明恢复事实能改变未开始训练和休息任务，但单日波动不能改变长期策略

## Comments

- 沿用原客户端 UI；如现有 check-in 缺字段，仅做必要状态接线，不建立新导航或页面体系。
