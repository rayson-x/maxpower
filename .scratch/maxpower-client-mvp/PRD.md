Status: wontfix

Replaced for this product flow by `.scratch/record-first-adaptive-coach/PRD.md`. Existing code is retained only when it directly matches the new business model.

# MaxPower Client MVP — Adaptive Planning, Live Coach and Daily Management

## Problem Statement

MaxPower 已经拥有一份完整长期客户端规格、25 张能力票据、部分已完成的本地 Coach 架构，以及一套验证过的移动 UI Demo；随后又补充了训练与饮食联合策略、目标预测、长期阶段切换和本地知识库规划。但这些内容被分散在“完整能力”“核心数据闭环”“Planning-First”和单项实施票据中，交付队列也曾让账号、同步、加密备份、健康平台 Adapter 和多设备冲突抢在用户核心体验之前。

用户真正需要的第一个产品不是一组独立技术模块，也不是分别为高体脂、偏瘦或平台期编写的流程，而是一套统一客户端：用户建立档案和目标后，得到可解释的多阶段训练、饮食与恢复路线、未来一周和今日计划；训练时 AI 教练通过 Rust Motion SDK 观察真实骨架与动作完成情况，结合用户确认的重量、次数、RIR 和疼痛反馈调整下一组和剩余训练；用户持续记录饮食、睡眠、恢复、体重和围度，真实 Timeline 再驱动每日微调、周期复核和长期 PlanRevision。

Today、Calendar、Plan、Progress、Workout、Profile、Coach Drawer、Timeline、Action Log、Artifact cards、HITL、Working Memory、动作管理和 planned/performed/observed 边界都是已经确认的客户端交互与 UI 基线，必须原样保留。最新讨论主要定义数据如何生产：建档事实如何生成长期策略，Week/Today 如何物化，摄像头与用户输入如何生成 SetAssessment，Meal/Recovery/Body facts 如何进入 Timeline，以及这些事实如何触发重规划。它不重新设计导航、页面层级、卡片形态或 Coach Drawer。唯一新增的产品 UI 是每日能量与蛋白质/碳水/脂肪进度、餐次列表和饮食录入；其他页面只把 Demo/假数据替换为真实 `CoachApplication` projection。

## Solution

交付一个 Android 优先、共享 TypeScript 产品逻辑同时支持 iOS 的 MaxPower Client MVP。产品复用现有 `CoachApplication`、CoachLedger、ActionBroker、PolicyGate、GoalCyclePlanner、RulePacks、AgentRuntime、Artifact/Card Registry、Timeline、WorkoutSession、Working Memory 和 ProductProjection，不创建平行 Planner、用户类型流程或页面本地事实模型。

产品由八项稳定能力组成：

1. **User Profile & Goal：** 渐进建档、身体和训练基线、目标合同、平台历史、生活条件和 CoachingMandate；
2. **Adaptive Planning：** 多阶段 GoalCycle、Applied Phase Strategy、strict/aggressive、balanced、flexible 预测、WeekPlan、TodayPlan、解释与引用；
3. **Live Execution Coach：** 普通训练记录、Rust 骨架监控、实时短提示、SetAssessment、下一组和剩余训练调整；
4. **Nutrition Management：** 阶段营养策略、每日热量和三大营养素账本、餐次、剩余额度和下一餐推荐；
5. **Recovery Management：** 睡眠、疲劳、酸痛、主观恢复、日程和当天 RecoveryConstraint；
6. **Timeline & Replanning：** 多来源真实事实、CorrectionEvent、趋势指标、每日微调、平台审计和阶段切换；
7. **Agent Experience：** 上下文对话、typed tools、AI SDK 风格 stream、固定卡片、HITL、Action Log、撤销和本地知识；
8. **Inherited Mobile Product Surface：** 复用既有 Today、Calendar、Plan、Progress、Workout、Profile 和 Coach Drawer；本规格只接入真实数据，并新增每日营养素展示与记录。

核心产品闭环固定为：

```text
渐进建档与目标确认
  → Strategy Selection + 三档 Forecast
    → confirmed GoalCycle / Applied Phase Strategy
      → coordinated Training + Nutrition + Recovery Strategies
        → WeekPlan + TodayPlan
          → Workout / Meal / Recovery / Body facts
            → Timeline + SessionOutcome
              → DailyEvaluation + Trend Metrics
                → next-set / next-day adjustment
                  → PeriodicReview / PhaseTransitionProposal
                    → confirmed PlanRevision + new Week/Today
```

高体脂减脂、偏瘦增肌、大幅减重后平台、skinny-fat、增力、停训回归和高手维持都使用同一套能力。差异来自 UserProfile、GoalContract、HistoryModifiers、CurrentStateModifiers、RiskGuardrails 和 Strategy Catalog 的组合，不产生人物专属页面或 Planner。

当前实现与测试中已经存在的领域、规划、Timeline、Workout、Motion、Agent stream 和移动 UI 能力直接复用；新票据只覆盖尚未完成的用户可见闭环。账号、同步、加密备份和 Health 平台不在本 MVP 队列；后台通知和生产多模态营养识别也不阻塞当前闭环。

## User Stories

### 建档、目标与阶段路径

1. As a 新用户, I want 通过对话或表单渐进建档, so that 我可以按自己的知识水平开始
2. As a 新用户, I want 填写年龄、性别、身高和体重, so that Coach 有基础身体事实
3. As a 有经验用户, I want 选择性填写深蹲、卧推和硬拉成绩, so that 计划可以使用真实力量基线
4. As a 用户, I want 选择性填写腰围、颈围、臀围和其他围度, so that 我可以追踪身体变化
5. As a 用户, I want 根据适用围度公式看到可编辑的体脂估算区间与方法, so that 估算能辅助规划但不冒充精确真值
6. As a 用户, I want 录入自己测得的体脂率及测量方法, so that 后续趋势只比较可比数据
7. As a 用户, I want 选择性填写往期计划、训练强度、重量、次数和 RIR, so that Coach 不会把我当成零基础
8. As a 用户, I want 填写每周时间、单次时长、场地、器材和饮食条件, so that 方案符合现实生活
9. As a 用户, I want 选择增肌、减脂、增力、维持或重返训练目标, so that 主方向明确
10. As a 增肌用户, I want 设置目标体重、三大项、围度和可接受体脂变化, so that 路线同时考虑体型和表现
11. As a 减脂用户, I want 设置目标体脂、体重、围度和期望期限, so that Agent 可以评估可行性
12. As a 平台期用户, I want 描述之前体重、方案、平台时长和自认为的原因, so that 历史变化参与策略选择
13. As a 用户, I want 未填写信息保持 unknown, so that Agent 不会编造体脂、维护热量、重量或 RIR
14. As a 用户, I want 选择 manual、collaborative 或 managed 权限并按影响类型限制, so that Agent 的控制程度符合我的选择
15. As a 用户, I want 查看和修改已确认档案、目标、限制与偏好, so that 未来计划始终使用有效事实

### 适应性长期规划

16. As a 用户, I want 建档后先看到多阶段长期路线, so that 今日任务属于可理解的完整方向
17. As a 用户, I want 每个阶段显示目标、训练、饮食、恢复、预计周期和复核条件, so that 我知道为什么进入和离开该阶段
18. As a 用户, I want 高体脂目标被拆成减脂、维持/重组、必要的受控增肌和后续减脂阶段, so that 系统不会用一个长期低碳模板追到底
19. As a 大幅减重后用户, I want 历史反弹、饥饿、训练表现和维持经历改变当前策略, so that 我不会得到偏瘦新手的通用增肌方案
20. As a 偏瘦增肌用户, I want 获得动作学习、保守盈余、渐进超负荷和阶段复核路线, so that 体重与力量目标可以分阶段完成
21. As a 平台期用户, I want Coach 区分数据不足、执行问题、恢复问题和策略失效, so that 平台不会自动等同于继续砍热量
22. As a 用户, I want 比较 strict/aggressive、balanced 和 flexible 三种情景, so that 我能理解更快和更宽松分别要求什么
23. As a 用户, I want 每种情景显示预计完成区间、行为要求、代价、风险和失效条件, so that 预测不是保证
24. As a 用户, I want 激进情景不能绕过恢复和安全护栏, so that 选择更快不意味着无限加压
25. As a 用户, I want 预测在积累真实趋势后重新校准, so that 日期越来越符合我的响应
26. As a 用户, I want 当前阶段由 TrainingStrategy、NutritionStrategy 和 RecoveryStrategy 共同组成, so that 怎么练、怎么吃和怎么休息不会互相冲突
27. As a 用户, I want 只物化当前周和下一周, so that 远期路线保留方向但不会过早锁死
28. As a 用户, I want 确认长期路线后才获得可执行 WeekPlan 和 TodayPlan, so that 今日计划不能脱离上游策略
29. As a 用户, I want 每个推荐说明使用的个人事实、产品规则、研究证据、未知和替代方案, so that 计划不是黑箱
30. As a 用户, I want 推荐附带可打开的本地文献引用及适用范围, so that 我可以检查依据
31. As a 用户, I want Agent 在本地知识不足时联网比较其他方案, so that 我能了解新方法而不让搜索结果直接修改计划

### 继承的客户端交互与唯一新增营养 UI

32. As a 用户, I want Today 顶部显示紧凑 Coach 动态提示栏, so that 待确认、已执行和可撤销事项不会被埋在聊天中
33. As a 用户, I want Today 使用固定尺寸 Plan Summary 和卡内可滚动 Task List, so that 任务数量变化不会破坏布局
34. As a 力量或徒手用户, I want 使用同一 Task List 执行动作, so that 不同训练形式共享稳定模型
35. As a 有氧或休息日用户, I want 仍看到 Summary、饮食、恢复和 Activity Log, so that 非力量日不会成为空页面
36. As a 用户, I want Today 计划卡下方看到当天 Timeline 摘要, so that 计划与真实经历保持分离
37. As a 用户, I want Calendar 在周视图和月视图之间切换, so that 我可以管理近期和整月安排
38. As a 用户, I want 点击日期后按时间查看当天计划引用、事实和更正, so that 日历与 Timeline 按日期关联但不是同一个模型
39. As a 用户, I want Plan 页面管理动作和计划结构, so that 我可以新增、删除、修改、排序和配置动作
40. As a 用户, I want Progress 页面显示体重、围度、体脂方法、力量、执行率和阶段趋势, so that 长期变化拥有专门位置
41. As a 用户, I want Profile 页面管理档案、偏好、权限和 Coach 记忆, so that 配置不与执行页面混杂
42. As a 用户, I want Profile 默认不显示 Agent 入口, so that 无需 Coach 的页面不被常驻操作栏遮挡
43. As a 用户, I want Coach 从底部气泡连续扩展为约四分之五屏抽屉, so that 对话保持当前页面上下文而不跳转
44. As a 用户, I want 最小化和重新展开 Coach 时恢复同一 task-scoped CoachSession, so that 卡片和待确认操作不会丢失
45. As a 用户, I want Coach 卡片显示计划、推荐、进展、资料、报告和回执, so that 对话可以直接转化为产品操作
46. As a 用户, I want App 重启后恢复页面、计划、未完成训练和 CoachSession, so that 本地客户端真实可持续使用

上列 32–46 是从原客户端规格继承的验收基线，不代表本规格重新设计页面。32–46 中唯一新增的 UI 范围是营养入口与每日账本；其他事项只要求真实数据接线和状态完整性。

### Workout 与 AI 训练监控

47. As a 用户, I want 从 Today 开始或恢复唯一 WorkoutSession, so that 训练引用当前 SessionPrescription
48. As a 用户, I want 选择仅记录或 AI 教练监控, so that 相机不是训练前置条件
49. As a 用户, I want 在任意安全阶段进入或退出监控, so that 环境变化不会中断训练
50. As a 监控用户, I want 获得镜头、距离、方向和入框引导, so that 当前识别 Profile 获得合适输入
51. As a 用户, I want 摄像头帧只提交给 Rust Motion SDK, so that 客户端没有第二套骨架或动作分析真值
52. As a 用户, I want 看到 Rust 输出的骨架、动作阶段、可信计次、ROM、节奏、轨迹和稳定性, so that 训练反馈来自真实 canonical evidence
53. As a 用户, I want 当前动作显示实际启用和不支持的监控能力, so that 目录覆盖不会伪装成动作分析覆盖
54. As a 用户, I want 动作进行中至多收到一个最高优先级短提示, so that Coach 能改善动作而不会持续干扰
55. As a 用户, I want 识别不足、人体丢失或无 exact profile 时降级手工记录, so that 系统不会虚构完成度
56. As a 用户, I want 每组结束后确认实际重量、次数、RIR、疼痛和备注, so that 摄像头无法观察的信息由我提供
57. As a 用户, I want 组后 SetAssessment 合并 canonical observation、主观反馈、历史表现、阶段策略和恢复状态, so that 下一组建议不是单一动作分数
58. As a 用户, I want Coach 建议保持、加重量、加次数、加组、减重、减量、延长休息、替换或停止, so that 监控能真实调整剩余训练
59. As a 用户, I want 下一组建议显示触发事实、before/after、原因、未知和影响范围, so that 我可以判断是否接受
60. As a 用户, I want 当前组开始后处方冻结, so that Agent 不会在动作执行中重写目标
61. As a 用户, I want 调整只影响下一组、未开始动作或未来 Session, so that 已完成训练事实不会被覆盖
62. As a 增肌用户, I want Coach 根据次数区间、RIR、动作质量、周刺激和恢复判断冲次数、重量还是组数, so that 渐进超负荷保持可恢复
63. As a 减脂用户, I want Coach 优先保留主项相对强度并在恢复下降时先审查辅助量、赤字和训练日供能, so that 减脂训练不会变成盲目冲重量
64. As a 徒手用户, I want 通过次数、节奏、停顿、ROM 和动作难度进阶, so that 没有外部重量也能持续改善
65. As a 用户, I want 在训练中修改尚未开始的组和动作, so that 器材占用和现场表现不会阻断计划
66. As a 用户, I want 在监控页面同时展开 Coach 对话, so that 我可以实时询问重量、姿势、替换或压缩时长
67. As a 用户, I want 暂停、恢复、部分完成或提前结束训练, so that 现实中断不会丢失已完成 SetOutcome
68. As a 用户, I want 训练结束后看到计划与实际、动作证据、Agent 调整和下一步组成的训练日报, so that 训练质量进入长期闭环

### 营养与恢复管理

69. As a 用户, I want NutritionPlan 根据当前阶段和训练日类型给出热量与三大营养素目标, so that 饮食服务同一长期目标
70. As a 用户, I want Today 显示热量、蛋白质、碳水和脂肪的目标、已摄入、剩余或超额, so that 我知道今天还能吃多少
71. As a 用户, I want 按早餐、午餐、晚餐和加餐记录食物、份量和营养值, so that 汇总能回溯到真实餐次
72. As a 用户, I want 使用基础本地食物、自定义食物、营养标签、常用餐和历史复用, so that 首版不依赖完整商业数据库
73. As a 用户, I want 自然语言或照片结果只形成可编辑估算草稿, so that 模型估算不会直接成为摄入事实
74. As a 用户, I want 确认实际吃过后才写 MealEntry 和 Timeline, so that 推荐和摄入保持分离
75. As a 用户, I want Agent 根据最新剩余额度、阶段、训练、时间和饮食条件推荐下一餐, so that 推荐随当天真实摄入变化
76. As a 用户, I want 下一餐提供一至三个可编辑组合及份量和预计营养值, so that 建议可以直接执行
77. As a 用户, I want 自己做饭、外食、外卖和便利食品条件影响候选类别, so that 饮食方案适合生活方式
78. As a 用户, I want 真实商户或商品只能来自注册工具结果, so that Agent 不会虚构餐厅、价格和库存
79. As a 用户, I want 记录睡眠、疲劳、酸痛、主观恢复和今天可用时间, so that Coach 能生成恢复任务和训练限制
80. As a 用户, I want 缺失恢复数据保持 unknown, so that 不填写也能继续且不会获得假分数
81. As a 用户, I want 普通单日波动只产生当日微调, so that 长期阶段不会随一天状态漂移
82. As a 用户, I want 疼痛或红旗触发停止与确认而不是诊断, so that 产品保持健身管理边界

### Timeline、反馈与重规划

83. As a 用户, I want Timeline 聚合训练、饮食、睡眠、恢复、体重、围度、体脂和日常活动事实, so that Coach 使用完整真实经历
84. As a 用户, I want 每条 Timeline 事实保存时间、来源、方法、置信度和确认状态, so that 多来源数据不会混成同一种事实
85. As a 用户, I want 计划、Proposal、聊天和未确认估算不进入 Timeline, so that Timeline 始终代表真实经历
86. As a 用户, I want 更正历史时追加 CorrectionEvent, so that 原事实不被静默删除
87. As a 用户, I want 系统分别比较 planned、performed、observed 和 recommended, so that 动作观察、计划和实际完成不会互相覆盖
88. As a 用户, I want 每日评估结合训练、饮食、恢复、日程和器材, so that 第二天计划使用最新事实
89. As a 用户, I want 无实质差异时 Coach 保持安静, so that App 不制造无意义调整
90. As a 用户, I want 普通日波动只修改 Today 或下一安全边界, so that GoalCycle 保持稳定
91. As a 用户, I want 通过体重、围度、训练、饮食执行和恢复的可比较窗口判断平台, so that 单日变化不会触发长期切换
92. As a 用户, I want 数据不足时系统继续观察或询问最小必要信息, so that Agent 不会强行判断计划失败
93. As a 用户, I want 一次周期调整只改变一个主要 decision family, so that 后续可以判断哪项改变有效
94. As a 用户, I want 两次有界调整无响应后进入正式 phase review, so that 系统不会无限砍热量或堆训练
95. As a 用户, I want 达到目标、期限不可行、长期平台或恢复持续恶化时收到 PhaseTransitionProposal, so that 长期路线会主动复核
96. As a 用户, I want 阶段提案显示失败原因、候选路线、三档预测、依据和复核时间, so that 我不是盲目确认切换
97. As a 用户, I want 高影响阶段变化必须确认, so that Agent 不会静默把减脂改成增肌
98. As a 用户, I want 确认后生成新的 PlanRevision、WeekPlan 和 TodayPlan, so that 历史反馈真实改变未来安排

### Agent、知识、权限与追溯

99. As a 用户, I want Agent 通过 typed tools 读取档案、计划、Timeline、Workout、Nutrition 和 Recovery, so that 对话使用真实上下文
100. As a 用户, I want tool call 先显示无事实 loading shell并在完成后原位变成 Artifact 卡片, so that 流式过程不会重复或提前信任模型参数
101. As a 用户, I want 卡片按钮直接执行本地确定性 action, so that 确认、拒绝和撤销不依赖自然语言猜测
102. As a 用户, I want HITL 在收起、切页和重启后继续同一 CoachRun, so that 待确认操作是持久状态
103. As a 用户, I want stale 卡片保留可见但禁止应用, so that 旧建议不能覆盖新事实
104. As a 用户, I want Working Memory 记住经过确认的训练时间、动作和饮食偏好, so that Coach 越用越贴近生活
105. As a 用户, I want 查看、编辑、固定和忘记 Working Memory, so that 个性化不是隐藏黑箱
106. As a 用户, I want 每次读取、判断、提案、写入、拒绝和撤销进入 Action Log, so that Agent 操作完整可追溯
107. As a 用户, I want Action Log 显示 before/after、原因、证据、规则版本、影响范围和状态, so that 我知道具体改变了什么
108. As a 用户, I want 撤销创建补偿 revision 或 event, so that 历史保持完整且产品状态可以恢复
109. As a 用户, I want 完全离线时仍可建档、规划、训练、记录、评估和使用本地知识, so that App 不是远程服务外壳
110. As a 用户, I want 远程 LLM 故障时本地计划和事实不回滚, so that 对话失败不会破坏核心体验

## Implementation Decisions

- 本规格是当前客户端 MVP 的唯一交付权威。此前分散的规格和旧队列已退役；冲突时以本规格的产品范围、顺序和六张票据为准。
- 当前代码与测试已经实现的能力直接复用，不重新创建“基础架构”票。实现新票前先盘点现有公开行为与测试，只补未满足验收，不重写现有 Timeline、Workout、Motion、Agent stream 或 UI。
- 生产同步、账号、隐私/备份、Android Health Connect 和 iOS HealthKit 不在 MVP 队列，也不进入任何新票依赖。后台通知和生产多模态营养识别保留为未来增强，不阻塞当前闭环。
- 现有 UI Demo 与既有客户端交互是产品基线，不在本规格中重做视觉设计、导航结构或 Drawer 动画。实现只允许为真实状态、错误/空状态、可访问性和新增营养账本做必要改动；不能借“接数据”重排已确认页面。
- `CoachApplication` 是 UI、Agent tools 和最高层产品测试的唯一公开 Facade。UI 不直接调用 Ledger、Planner、RulePack、Motion store、Timeline store 或 platform adapter；所有写入继续经过 ActionBroker、PolicyGate 和 CoachLedger AtomicCommit。
- 所有 domain/application dependencies 继续由共享 TypeScript composition root 注入。Android 与 iOS 共享领域、计划、Agent、projection 和 card 协议；平台只注入 Camera、Rust bridge、storage 和其他确有需要的 native adapters。
- canonical 计划权威固定为 `UserProfile + GoalContract + CoachingMandate → GoalCycle/Mesocycle → Applied Phase Strategy → coordinated Training/Nutrition/Recovery Strategies → WeekPlan/PlanRevision → DailyEvaluation → TodayPlan`。Today 是派生 Artifact，不拥有长期计划。
- 用户类型不是领域类型。高体脂、偏瘦、大幅减重后平台、增力和高手等由统一输入、HistoryModifiers、CurrentStateModifiers、RiskGuardrails 和 Strategy Catalog 组合表达，不建立人物专属流程或 Planner。
- 初始规划先生成 immutable StrategySelection、GoalForecastScenarios 和 RecommendationExplanation；用户确认后才原子提交 GoalCycle/PlanRevision。上游事实或 revision 变化后旧 Today 和 Proposal stale，只能重算。
- Goal Forecast 固定提供 `strict_aggressive | balanced | flexible`，保存 eligibility、earliest/latest、phase route、执行假设、核心行为、tradeoffs、guardrails、置信度和 recalibrateAt。严格情景不能突破恢复与安全边界。
- Strategy Catalog 至少覆盖高体脂减脂重组、保肌减脂、最后减脂、维持重组、恢复维持、保守增肌、稳定体重增力、停训回归、高手专项维持、大幅减重后巩固增肌、diet break 和 deload overlay。碳循环、低碳和高碳支持是阶段 tactic，不是长期目标或特殊减脂保证。
- Plan 推荐的结构化解释固定包含 UserEvidence、RuleReason、ResearchEvidence、Uncertainty 和 Alternative。引用只能由本地 Citation Registry 解析；LLM 禁止虚构 DOI、作者、标题或 URL。联网结果保持 `unreviewed_external`，不能直接修改 RulePack 或正式计划。
- Timeline 与 Action Log 是两个独立模型。Timeline 只保存真实训练、Meal、Recovery、身体和活动事实及 CorrectionEvent；Action Log 保存 Agent、Rule、User 和 Tool 的读取、判断、Proposal、apply、reject、correction 与 undo。Calendar 只按日期查询 Timeline projection。
- planned、performed、observed 和 recommended 永不互相覆盖。SessionPrescription 冻结计划，SetOutcome 保存用户确认的实际表现，CanonicalMotionOutput 保存动作观察，Recommendation 保存未执行建议。
- 目标 motion 数据流固定为 `Client CameraInputStream → Rust Motion SDK → CanonicalMotionOutput → client projection/Coach tools`。客户端只负责相机权限、镜头、预览、orientation、frame lifecycle、bounded latest-frame/backpressure 和渲染，不拥有第二套骨架生成、补点、镜像推测、计次或动作分析真值。
- Motion capability 只由 exact action × variation × equipment × view × pose model × native bridge resolver 开启。`finish_set` 产生不可变 Canonical Set Observation；无 exact profile、低置信度或关键点缺失时降级手工记录。
- Live cue 是本地 transient presentation，按 safety/user stop、setup/lost tracking、current-rep actionable cue、pacing/status 排序，去重、限频且一次最多一个主要提示。组后才 seal 成稳定 SetSummary/SetAssessment Artifact。
- SetAssessment 合并 canonical observation、用户确认的 load/reps/RIR/pain、exact ExerciseVariant 历史、TrainingStrategy、RecoveryConstraint 和器材档位。骨架和 LLM 不得推断重量、RIR、疼痛、肌肉激活、伤害风险或不可见 3D 状态。
- 当前 set 开始后冻结 prescription。NextSetAdjustment 只能修改下一未开始 set、rest、remaining set count、未开始 ExerciseSlot、顺序或安全替代；已完成事实和 observation 不可修改。
- 增肌进阶依次考虑动作质量、目标次数区间、RIR、可比较表现、器材最小档位、周刺激和恢复；决定先加次数、重量或组数。减脂阶段优先保留主项相对强度和有效刺激，恢复下降时先审查辅助训练量、赤字、训练日供能和休息，而不是编码“必须冲重量”。
- NutritionDayLedger 按计划时区和餐次确定性汇总 confirmed MealEntry/FoodEntry，投影 energy/protein/carbohydrate/fat 的 target、consumed、remaining/overage 和 coverage。缺日志不是零摄入。
- NextMealRecommendation 读取最新 Ledger revision、当前阶段、训练/恢复安排、时间、已知食物营养、常用餐和用户生活条件。选择推荐只创建 MealDraft；确认吃过后才写 Timeline。真实商户、价格和库存只能来自注册工具。
- Recovery 首版使用手工 sleep/fatigue/soreness/perceived recovery/schedule facts，产生 `normal | slight_reduction | recovery_priority | pause_and_confirm` 约束；单日普通波动不切换 GoalCycle，疼痛或红旗只停止并请求确认，不做诊断。
- DailyEvaluation 只能修改 Today、下一安全边界或下一未开始 Session。阶段级变化必须由 PeriodicReview/PhaseTransitionProposal 产生，并默认 HITL 确认。
- Metric registry 至少包含 body_trend、training_trend、nutrition_adherence、recovery_trend、phase_progress 和 goal_feasibility。每个结果保存窗口、可比较日、confidence、evidence refs、confounders 和 missing；单点体重、体脂或单次训练不得触发长期切换。
- 普通阶段至少经过版本化最小观察窗才允许 outcome-based phase switch；高置信平台需要足够可比较日和覆盖审计。一次只改变一个主要 decision family；同 family 两次有界调整无响应后必须进入 REVIEW_PHASE，禁止继续同向 ratchet。
- Mobile Product Surface 继承原规格：Today、Calendar、Plan、Progress、Workout 和 Profile 的信息架构、Today 顶部 Coach 动态、固定 Plan Summary + 卡内滚动 Task List、下方 Timeline、Calendar 周/月、Plan 动作管理、Progress 趋势与 Profile 配置均保持不变。本规格只规定这些 surface 读取真实 projection，不再定义新的布局方案。
- Coach 入口出现在 Today、Calendar、Plan、Progress 和 Workout，Profile 默认不显示。入口从原底部气泡连续扩展为约四分之五屏前台 Drawer，可最小化并保留 page/date/plan/workout/set context；训练监控页也可同时展开。
- 唯一新增 UI 模块是 NutritionDayLedger surface：在 Today 和营养详情展示 energy/protein/carbohydrate/fat 的 target、consumed、remaining/overage、coverage，以及早餐/午餐/晚餐/加餐列表、Meal/Food 录入、编辑、确认和下一餐草稿。它使用既有卡片、抽屉、sheet、排版和导航语言，不建立新的视觉系统。
- canonical CoachRun events 投影为 AI SDK 风格 parts。tool input streaming 只显示无事实 loading shell；schema 校验和 tool result 完成后，固定 ArtifactCardRegistry 使用 immutable artifactRef 原位 reconciliation。禁止模型 HTML、任意组件树、JSON Patch 或第二份卡片数据。
- 卡片至少覆盖 GoalRoute/Forecast、TodayPlan、PlanChangeProposal、NextSetAdjustment、SetSummary/WorkoutReport、NextMealRecommendation、RecoveryBrief、PeriodicReview、Knowledge/Citation 和 ActionReceipt。确定性按钮直接进入 CoachApplication，不把按钮文字送回 LLM。
- Working Memory 保持非权威且用户可查看、编辑、固定和忘记。只有重复行为形成带 provenance 的 candidate，确认后才能影响后续 Strategy Selection；它不能替代 Timeline 或身体事实。
- 完全离线时建档、规划、Today、Workout、营养账本、恢复、metrics、周期复核、Action Log 和本地引用可工作。远程 LLM 只提供可替换对话/解释 Provider，远程研究只增加候选发现，不是计划正确性的依赖。

## Testing Decisions

- 唯一主要产品测试 seam 是 `CoachApplication`。测试通过公开 Command、Query 和 canonical application events 驱动产品，不断言私有 Planner 函数、SQLite 表、React state、provider chunk 或 Rust 内部算法。
- 新票据必须先盘点现有公开行为和测试，复用通过项，只为未完成的公开行为写红测；不得重新实现已完成基础。
- 主场景从同一 Facade 驱动：渐进建档 → 三档 Forecast 和 GoalCycle → 确认 Week/Today → 普通/监控 Workout → next-set adjustment → 两餐和 Recovery check-in → Day Summary → 多日趋势 → PhaseTransitionProposal → 新 PlanRevision/Today。
- 规划 fixture 使用相同能力覆盖三个人物：100 kg/约 30% 体脂目标 12%；60 kg 目标 80 kg/三大项 350 kg；有大幅减重史且长期平台。只断言统一 Strategy Selection 的不同组合结果，不测试三套流程。
- Live Coach 至少使用一个真实 validated-analysis exact profile 跑通 CameraInputStream → Rust SDK → rendered skeleton/rep/observation → user load/RIR → SetAssessment → next-set adjustment → SessionOutcome → next-session evaluation。静态骨架 Mock 或 TypeScript 二次计数不算产品验收。
- Motion contract 测试覆盖 frame envelope、orientation/mirroring、backpressure、begin/pause/resume/finish/reset、profile/version lineage、Confirmed/NeedsReview/Rejected 和 Android/iOS 结构 parity；不复刻 Rust 算法。
- 监控降级覆盖拒绝相机、无 exact profile、人体丢失、低置信度、切镜头/动作、进入后台和中途退出；每种情况保留同一 WorkoutSession 并能手工完成。
- 训练规则测试覆盖增肌时先加次数/最小档位加重/恢复足够时加组，减脂时保留主项并在恢复恶化时先减辅助量，徒手时通过次数/节奏/停顿/ROM/难度进阶；单次表现不得改变长期阶段。
- 营养场景覆盖四项 target/consumed/remaining/overage、餐次、MealDraft confirm/correction、缺失不按零、下一餐推荐 stale 和重启恢复。恢复场景覆盖 unknown、普通微调、休息日和疼痛 pause-and-confirm。
- Timeline 测试证明计划、实际、动作观察和推荐分离；CorrectionEvent 保留旧事实并使依赖 Proposal stale。Action Log 测试从 apply 到 undo，断言补偿历史和所有 projection 一致。
- ProductShell 回归场景覆盖既有 Today 固定卡和 Timeline、Calendar week/month/date detail、Plan 动作管理、Progress、Workout、Profile、Coach Drawer 展开/最小化/上下文恢复；这些断言用于防止数据接线破坏原交互，不要求重新实现已通过能力。新增 UI 测试只覆盖 NutritionDayLedger 的四项进度、餐次和录入流程。
- Stream/Card 测试覆盖 loading → ready 原位 reconciliation、同 toolCall/artifact/presentation identity、error/stale/applied/undone、unknown renderer fallback、HITL restart 和无重复卡片。
- RecommendationExplanation 测试断言 UserEvidence、RuleReason、ResearchEvidence、Uncertainty、Alternative、reviewAt 和 Citation refs 完整；引用来自 Registry，ProductPolicy 阈值不冒充论文结论。
- Restart 场景恢复 Profile、GoalCycle、PlanRevision、Today、Workout、Meal、Recovery、CoachSession、pending HITL、Working Memory 和 Action Log。Provider/Web 失败不回滚本地事实或确定性结果。
- Android 是首个真实设备验收平台；共享 TypeScript 和 iOS 组合必须保持同一公开 contract 和可编译路径。iOS 生产 HealthKit 不是当前门槛，但共享客户端不能写 Android 专属业务规则。
- MVP 完成以用户可见闭环和公开场景通过为准，不以票据总数、接口数量、文档状态、静态 UI Demo 或单一摄像头画面作为完成证明。

## Out of Scope

- 生产账号、云端用户数据库、ReplicaSynchronizer、客户端加密备份、多设备冲突和云端删除。
- Android Health Connect、iOS HealthKit、智能秤和穿戴设备生产接入；首版使用手工事实。
- Cloud Agent、服务端 Tool execution 或由服务器拥有 Planner/CoachKernel；未来云服务只能复用本地 Application contracts。
- 后台常驻 Agent、生产通知编排和任意定时任务不阻塞当前 MVP。
- 生产级食物照片精确识别、条码库、全国餐厅/外卖/菜场库存和价格；首版只要求手工、自定义、常用餐和可确认草稿。
- 200–400 个动作全部拥有视觉分析。首版要求动作可计划/记录，并至少有一个真实 validated-analysis exact profile 完成 AI 监控闭环；其他动作按能力降级。
- 从 2D pose 推断实际重量、RIR、疼痛原因、肌肉激活、伤害风险或真实 3D 生物力学。
- 医疗诊断、伤病康复处方、疾病特异饮食、极端低热量、快速脱水、药物或手术管理。
- 自动把互联网结果升级为 CitationRegistry 或 RulePack、模型生成 UI renderer、任意 JSON Patch/SQL/脚本和黑盒在线学习。
- 社区、课程市场、排行榜、真人教练后台、多学员管理和商业内容市场。
- 重新设计底部导航、Today/Calendar/Plan/Progress/Profile 信息架构、Coach Drawer 动画、卡片视觉语言或训练摄像头页面；这些沿用原客户端规格和 UI Demo，仅接入真实数据。

## Further Notes

- 本规格收敛此前确认的客户端交互、训练/饮食联合策略、Forecast、阶段规则、知识与 Live Coach 数据生产细节，并给出唯一当前交付边界。
- 原 UI Demo 的交互决策继续有效且视为冻结基线：Coach 动态在 Today 顶部；固定 Plan Summary + 卡内滚动 Task List；Today 下方 Timeline；Calendar 周/月切换；Plan 完整动作管理；Progress 长期趋势；Profile 无常驻 Agent；Coach 气泡连续扩展为约四分之五屏；训练监控中仍可对话。本规格新增的是背后的数据生产闭环，以及每日能量/三大营养素与餐次记录 UI。
- 当前代码已经完成部分领域、Ledger、KnowledgePack、Onboarding、CoachSession、Planner、RulePacks、Timeline、Workout、Motion、Nutrition、Recovery、Agent stream 和 Product UI。新票据必须以 gap audit 开始，但每张票最后仍要交付一个可演示的产品能力，而不是只写盘点报告。
- 策略研究基线是《训练与饮食联合策略：证据边界与 Agent 自适应决策框架》。研究文档和 Wiki 是 KnowledgePack 来源，不是自动可执行规则；正式行为仍需 typed/versioned/tested RulePack。
- 当前动作目录与 motion capability 必须诚实展示。MVP 的 AI 价值来自“真实观察 → 组后建议 → 剩余训练调整 → 长期反馈”闭环，不来自虚假动作评分或覆盖数量。
