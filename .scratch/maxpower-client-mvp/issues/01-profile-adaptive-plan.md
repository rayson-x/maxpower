# 01 — 用户档案到长期策略、周计划与今日计划

**What to build:** 复用已经完成的 UserProfile、GoalContract、CoachingMandate、GoalCyclePlanner、RulePacks 和既有客户端页面，让用户通过基础或专业建档形成可信档案，获得可解释的多阶段长期路线、三档目标预测、当前阶段训练/饮食/恢复策略、未来一周与今日计划。高体脂、偏瘦增肌和平台期只是同一 Strategy Selection 的不同输入，不建立独立流程或页面。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 开始实施前盘点现有 Onboarding、GoalCyclePlanner、RulePack、KnowledgePack、Forecast、ProductProjection 的公开行为，仅为缺口写红测，不重建已完成基础
- [ ] 基础建档支持年龄、性别、身高、体重、主目标、训练经验、每周时间、单次时长、场地器材和饮食条件
- [ ] 专业选填支持深蹲/卧推/硬拉成绩、围度、体脂来源、往期计划、重量/次数/RIR、训练强度、饮食与恢复经历
- [ ] 围度体脂估算保存适用公式、输入、estimate range、测量时间与方法，并允许用户覆盖；估算不冒充原始事实或精确体脂
- [ ] 平台信息支持记录历史体重/体脂、先前策略、平台持续时间、执行情况、恢复变化和用户自述原因
- [ ] 未填写字段保持 unknown；系统不猜测实际重量、RIR、维护热量、体脂或训练能力
- [ ] 目标支持增肌、减脂、增力、维持和重返训练，并能表达目标体重、目标体脂、三大项、围度、期限与不可接受代价
- [ ] 同一 Strategy Selection 使用 Profile、Goal、HistoryModifiers、CurrentStateModifiers 和 RiskGuardrails 区分不同用户，不出现人物专属 Planner 或 UI
- [ ] Strategy Catalog 能表达减脂重组、保肌减脂、最后减脂、维持重组、恢复维持、保守增肌、稳定增力、停训回归、大幅减重后巩固、diet break 和 deload overlay
- [ ] 碳循环、低碳偏好、高碳训练支持和 refeed 只作为阶段 tactic，不能替代 GoalCycle 或宣称特殊减脂效果
- [ ] 初始规划生成有序 GoalCycle、当前 Applied Phase Strategy、TrainingStrategy、NutritionStrategy、RecoveryStrategy 和复核节点
- [ ] Goal Forecast 提供 strict_aggressive、balanced、flexible 三种情景，并显示 eligibility、earliest/latest、阶段路线、执行要求、tradeoffs、guardrails、置信度和 recalibrateAt
- [ ] 激进情景在数据不足、恢复恶化、final-cut 或安全护栏下被禁用或降级，不能由用户偏好绕过
- [ ] RecommendationExplanation 区分 UserEvidence、RuleReason、ResearchEvidence、Uncertainty 和 Alternative
- [ ] 文献引用只来自本地 Citation Registry，展示支持的 claim、适用人群和局限；LLM 不能生成不存在的引用
- [ ] 外部研究只返回 unreviewed KnowledgeCandidate，可用于比较但不能直接改变 RulePack、GoalCycle 或 Today
- [ ] 用户确认前只显示 immutable planning preview；确认时重读事实 revision、Mandate 和 guardrails，并原子提交 GoalCycle 与 PlanRevision
- [ ] 只有确认后的 GoalCycle/PlanRevision 能物化当前周、下一周和 Today；上游 revision 变化后旧 Today stale
- [ ] 既有 Plan 与 Today 页面读取真实 ProductProjection，不重新设计导航、卡片布局或 Coach Drawer
- [ ] 完全离线时可完成表单建档、路线生成、三档预测、本地引用、确认和 Week/Today 物化
- [ ] App 重启后恢复已确认 Profile、GoalCycle、Forecast、PlanRevision、Week 和 Today，不重复建档或创建第二份计划
- [ ] CoachApplication 场景使用同一 API 覆盖高体脂减脂、偏瘦增肌和大幅减重后平台 fixture，并断言差异来自结构化 modifiers 而非 LLM 文案
- [ ] 每次 preview、确认、拒绝、stale、recompute 和 commit 都产生可追溯 Artifact 与 Action Log/ToolAudit

## Comments

- 本票交付的是一套通用规划产品能力，不是三个用户流程。
- 原客户端 UI 是冻结基线；本票只把真实规划数据接入已有页面。
