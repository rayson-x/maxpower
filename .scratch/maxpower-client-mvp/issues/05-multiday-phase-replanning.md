# 05 — 多日趋势、平台审计与长期阶段切换

**What to build:** 将多日 Workout、Meal、Recovery、体重、围度、体脂和日程事实转为可比较指标，判断当前计划是否有效以及失败来自数据、执行、恢复还是策略。达到版本化复核条件时生成带解释、文献和三档预测的 PhaseTransitionProposal；用户确认后形成新的长期 PlanRevision、WeekPlan 和 TodayPlan。

**Blocked by:** 02 — AI 监控训练到组间与后续训练调整; 03 — 每日营养账本与下一餐建议; 04 — 恢复状态与每日联合评估

**Status:** wontfix

- [ ] 开始实施前盘点现有 Replanner、Forecast、Report、Working Memory、Action Log 行为，只补历史反馈闭环
- [ ] Timeline 同时保留当时 PlanRevision、performed Workout/Meal/Recovery facts、observed motion evidence 和 recommended Proposal，四者不互相覆盖
- [ ] Metric registry 至少提供 body_trend、training_trend、nutrition_adherence、recovery_trend、phase_progress 和 goal_feasibility
- [ ] 每个 metric envelope 保存窗口、可比较日、confidence、evidence refs、confounders、missing 和规则版本
- [ ] body_trend 只比较声明可比的体重、围度和同方法体脂；单点体脂或设备变化不触发长期切换
- [ ] training_trend 只比较 exact ExerciseVariant/performance identity 与用户确认的 load/reps/RIR；机位变化不抹掉训练身份，平替动作不继承绝对负荷
- [ ] nutrition_adherence 区分未记录、草稿、已确认、估算和真实超额；恢复趋势保留主观事实并将设备数据视为可选佐证
- [ ] DailyEvaluation 只产生 CONTINUE、DAILY_ADJUST、REVIEW_PHASE 或 SAFETY_PAUSE 之一，LLM 不能增加自由状态
- [ ] phase-exit 决策顺序固定为 Safety → 用户改目标/主动复核 → data-quality gate → minimum window → goal feasibility → bounded-change response → plateau audit → phase goal/exit → daily adjustment → continue
- [ ] 普通 outcome-based phase switch 需要版本化最小观察窗；高置信平台需要足够可比较日、记录覆盖和混杂审计
- [ ] 旅行、疾病、水分、月经周期、记录缺口和近期计划改变会降低置信度或延长观察，不编码成计划失败
- [ ] 一次普通复核只改变 energy、activity、resistance volume、resistance load、cardio dose、macro distribution、schedule 或 phase goal 中一个主要 decision family
- [ ] 同一 decision family 连续两次有界变化走完 review window 仍无响应后必须进入 REVIEW_PHASE，并拒绝第三次同向 ratchet
- [ ] 平台审计明确区分数据不足、执行不足、生活约束、测量噪声、恢复不足、策略不适配、阶段已完成和目标期限不可行
- [ ] 达到阶段目标、长期平台、恢复持续恶化、连续表现下降、期限不可行或用户请求时生成 PhaseTransitionProposal
- [ ] Proposal 显示 current/next phase、失败原因、before/after、候选路线、未改变项、strict/balanced/flexible 新预测、观察指标和 reviewAt
- [ ] RecommendationExplanation 引用具体 Timeline/Workout/Meal/Recovery evidence、RulePack 与 Citation Registry，区分产品阈值和研究证据
- [ ] cut、gain、maintenance、主目标和跨阶段 route 变化默认必须 HITL 确认，即使 CoachingMandate 为 managed
- [ ] 用户拒绝 Proposal 时保存理由并形成可审计 preference candidate；拒绝不修改事实或当前计划
- [ ] 用户确认时重读所有 revisions、Mandate 和 guardrails；stale Proposal 只能 recompute
- [ ] 确认后原子创建新的 PlanRevision、active phase、WeekPlan、TodayPlan 和 ActionReceipt，旧计划与预测保持不可变
- [ ] 撤销阶段变化创建补偿 revision，不删除旧 GoalCycle、PlanRevision、Artifact 或 Action Log
- [ ] Forecast 使用真实 14–21 天可比较趋势重新校准日期范围与置信度，旧 Forecast Artifact 保留
- [ ] 重复动作选择、训练时间、餐食偏好和计划接受/拒绝只形成 Working Memory candidate；用户确认后才影响下一轮规划
- [ ] 高体脂减脂、偏瘦增肌和大幅减重后平台 fixture 通过同一 CoachApplication 场景产生不同阶段组合和解释
- [ ] 完全离线时 metrics、平台审计、PhaseTransitionProposal、本地引用、确认和新计划都可运行
- [ ] App 重启后恢复 metric window、cooldown、pending PhaseTransition、knowledge pins、Working Memory 和新旧 PlanRevision

## Comments

- 三类人物仅是同一能力的验收 fixtures，不形成独立票据、页面或 Planner。
