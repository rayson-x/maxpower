Status: completed

# Record-First Health Ledger and Adaptive Coach

## Problem Statement

MaxPower 当前已经具备 Timeline、训练计划、Nutrition strategy、部分每日能量预算、三大营养素账本、GoalCycle Planner、Agent 工具循环、风险判断、计划提案和移动客户端表面，但这些能力并未围绕一条真实业务主链组织。记录、营养计算、计划生成、风险评估和客户端展示存在多套平行实现；部分风险模块只能手工注入快照，默认客户端仍以减脂判断为主；营养记录主要停留在热量和三大营养素，不能稳定支持钠、钾、膳食纤维及其他营养素管理；用户没有计划时也缺少完整、独立的记录与自由训练体验。

用户需要的产品首先是一个长期可用的行为与健康记录工具。饮食、活动、训练、身体数据、睡眠和恢复应成为有来源、有置信度、可更正的 Timeline Records，并统一生成每日热量差、营养摄入、行动完成和数据覆盖等计算产物。用户即使不启用 Goal contract 或 Training plan，也应能记录、查看趋势和自行组织训练。目标和计划只能建立在这些记录和计算产物之上，不能拥有、复制或改写历史。

当用户选择自适应规划时，产品不能只给出一次计划后停止观察。系统需要持续区分：记录不足、实际未执行、计划负担不适合用户、观察时间不足、测量不可比、恢复受限、计划已执行但响应不足，以及目标在当前期限和健康护栏下不可达。Agent 应结合用户资料、长期实际行为、偏好、领域知识和受限工具灵活组织计划，并采用渐进的习惯改变，而不是突然要求极端节食、“干净饮食”或无法长期执行的训练模板。固定规则与计算引擎必须负责事实计算、趋势、硬护栏和候选验证；LLM 负责沟通、提出解释、生成计划和组织下一阶段，不能自行发明营养数值、覆盖伤病或极端控制风险，也不能给自己的计划自行判定安全有效。

现有横向 Ticket 容易交付彼此不连通的 evaluator、decorator、计算器和测试。新的规格必须按真实用户业务流程验收：后续能力必须调用前置能力的正式 Interface，并从真实记录入口一直到默认客户端可见结果。类型存在、孤立函数通过或测试手工注入快照均不代表产品完成。

## Solution

交付一套以记录为底座、计划为可选 Overlay 的 MaxPower 本地 Coach 体验：

1. 所有饮食、活动、训练、身体、睡眠和恢复事实先进入 append-only、provenance-bearing Timeline；补录和修正追加新事件，保留原始证据。
2. 单一 Daily Health Ledger Module 从 Timeline 生成版本化的每日和滚动计算产物，包括摄入、估算消耗、热量差、宏量与微量营养素、训练与活动、身体数据、数据覆盖和不确定性。
3. Record-only 是由当前目标状态动态产生的产品状态，而不是首次初始化中的固定模式选择器。用户没有已确认的 Active Goal 时进入记录首页、趋势和自由训练入口，不创建计划完成度，不因缺少计划记录提醒用户，也不主动生成 Plan revision。
4. 用户在对话中表达了可执行目标时，Agent 进入目标澄清与确认，根据期望结果、时间和愿意付出的代价展示较快、平衡、渐进等多种真实可达路径；用户确认后形成版本化 Goal contract 和 Coaching mandate，并继续首次规划。目标意图不明确时只询问最小必要问题。
5. Planning Agent 通过 typed tools 读取 User profile、Timeline、Daily Health Ledger、Goal contract、Readiness state、历史 Plan outcomes、版本化领域知识和权限，生成当前阶段的 Training plan、Nutrition strategy、习惯转变策略和观察合同。
6. 固定 Goal Path Engine 负责验证目标在期限和健康护栏内是否可达、当前计划是否仍在路径上、LLM 候选是否安全且能改善路径。未完成校准前只输出状态、驱动因素和证据质量，不向用户显示伪精确成功概率。
7. 每次有意义的 Timeline 或相关领域版本变化都先经过低成本规则检查；每日定时检查只观察长期无记录、明确未执行、连续失败、身体趋势、期限瓶颈和安全风险。没有 Signal 时不调用 LLM。
8. Agent 可对普通规划 Signal 提出解释、请求信息或生成计划候选；固定硬护栏不可覆盖。候选通过固定验证与 Coaching mandate 后，按用户长期授权偏好决定询问、允许一次或自动应用类似小调整。
9. 每个阶段只定义当前习惯改变、观察窗口、推进条件、保持条件和回退条件。后续阶段根据真实身体变化、任务完成度、恢复和用户反馈重新生成，不在首次规划时猜测全部未来细节。
10. 首页由固定产品状态决定展示记录、规划、今日计划、调整、完成或暂停卡片。LLM 只能填充经过验证的 Artifact 内容，不能决定页面事实状态。
11. 首次初始化使用一个专用全屏 Agent 对话。消息、动态表单、档案摘要、目标确认、计划路线和确认卡保持在同一连续 thread 中；提交后的卡片成为只读历史，不跳转为伪步骤页。
12. 档案确认后，Agent 根据同一 thread 中已经确认的目标状态动态分流：存在 Active Goal 时继续 Goal contract 与首次计划确认；没有目标时直接进入正常 App 的 record-only 体验；目标意图不明确时先做最小确认。系统不展示脱离用户目标的固定模式选择步骤，也不能在没有目标时默认创建计划。
13. 正常 App 的 Today、Calendar、Add/Record、Plan 和 Profile 都提供完整手动路径。Coach 是覆盖当前页面的可选对话 drawer；Agent 操作始终留在同一 conversation root，结构化内容以内嵌卡片展示，不能把聊天变成页面导航器。
14. 手动操作与 Coach 代操作共享同一 Draft、application command、validation、confirmation 和 canonical Record/Plan/Timeline 写入。两条入口只改变交互和送达，不产生第二套业务规则或事实。
15. V1 只接受文本对话和结构化表单。营养计算仅消费用户明确提供并确认的数值；不提供图片、音频、视频理解、OCR、条码或食物数据库查询，也不根据食物名称、份量、配方或模型常识推断营养。Realtime Agent 不在本轮实现范围内，只保留未来已确认 Workout Record 进入统一 Record admission 的接入口。

产品主链为：

```text
Capture
  → confirmed Record / correction
    → Timeline
      → Daily Health Ledger
        → record-only history and trends
        → optional Goal/Plan Overlay
          → deterministic rule check / scheduled review
            → Agent communication and Planning Agent
              → validated PlanCandidate
                → Coaching mandate / user confirmation
                  → immutable Plan revision and Nutrition strategy revision
                    → performed Records return to Timeline
```

## User Stories

### 记录模式与 Timeline

1. As a 用户, I want 不创建目标也能开始记录, so that 我可以先了解自己的真实生活而不被迫接受计划。
2. As a 用户, I want 在 record-only 与 adaptive planning 之间切换, so that Coach 的主动程度符合我当前需要。
3. As a 用户, I want 记录饮食、活动、训练、身体、睡眠和恢复, so that 健康与计划判断使用完整事实。
4. As a 用户, I want 每条记录保留时间、来源、方法、份量、置信度和确认状态, so that 我能理解计算依据。
5. As a 用户, I want 对话、表单、训练结果和导入产生等价的有效 Record, so that 输入方式不改变业务含义。
6. As a 用户, I want Agent 把我在文本中明确说出的记录字段填入同一份可编辑 Record draft, so that 对话代填不会绕过结构化确认。
7. As a 用户, I want 清晰表达且授权允许的记录能够直接执行, so that 每次简单记录不需要重复确认。
8. As a 用户, I want 模糊份量和缺失营养字段保持 unknown 并由我补填, so that 系统不会推断或编造摄入。
9. As a 用户, I want 补录过去的饮食、活动或身体数据, so that 忘记当天记录不会永久损失历史。
10. As a 用户, I want 修正错误记录时保留原记录和修正关系, so that 历史不会被静默重写。
11. As a 用户, I want 查看一天、一周和一个月的记录, so that 我能理解自己的长期模式。
12. As a 用户, I want 只记录部分饮食也能看到已记录结果, so that 不完整记录仍有价值。
13. As a 用户, I want 不完整记录明确显示覆盖不足, so that 部分摄入不会冒充全天摄入。
14. As a 用户, I want 没有记录不自动等于没有执行, so that 系统不会用缺失信息惩罚我。
15. As a 用户, I want 暂停规划后仍可继续记录, so that Timeline 不依赖 Active plan 存在。
16. As a 用户, I want 以后重新开启规划时复用已有历史, so that 长期记录能提高个体校准和计划可执行性。

### 食物、营养与 Daily Health Ledger

17. As a 用户, I want 记录食物名称、份量、餐次和我明确提供的营养数值, so that 记录可以回溯且只有确认数值参与计算。
18. As a 用户, I want 手工填写包装标签、自定义食物或配方中的结构化营养数值, so that 不依赖识别或数据库也能形成有来源记录。
19. As a 用户, I want Agent 只代填我在文本中明确提供的字段, so that Agent 不会根据食物名称、份量或常识生成营养数值。
20. As a 用户, I want 在共享表单中确认结构化字段后再写入 Timeline, so that 只有确认的营养数值参与正式计算。
21. As a 用户, I want 每日看到热量摄入和估算消耗, so that 我能理解当天的能量状态。
22. As a 用户, I want 看到摄入减去估算消耗形成的热量差范围, so that 我能区分缺口、维持和盈余。
23. As a 用户, I want 消耗估算拆分基础消耗、日常活动、训练和食物热效应, so that 单一数字不会隐藏来源和误差。
24. As a 用户, I want 步数、训练和穿戴设备消耗作为带误差证据, so that 设备估算不会被当作精确真实消耗。
25. As a 用户, I want 查看蛋白质、碳水和脂肪摄入, so that 我能理解宏量营养结构。
26. As a 用户, I want 查看膳食纤维、钠和钾摄入, so that 记录工具不只关注热量。
27. As a 用户, I want 在数据可用时查看钙、铁、镁和适用维生素, so that 长期营养管理覆盖关键微量营养素。
28. As a 用户, I want 每个营养素保留数值、单位、字段级来源和数据类型, so that 计算可以追溯到我的表单提交或明确陈述。
29. As a 用户, I want 手工录入的标签和营养数值保留确认快照, so that 后续修改不会静默改写历史 Timeline。
30. As a 用户, I want 修正营养数值时追加更正并生成新版投影, so that 最新分析能够改进而不破坏历史。
31. As a 用户, I want 不同营养素使用适合的观察周期, so that 一天波动不会被误判成长期不足。
32. As a 用户, I want 数据覆盖不足时看到无法评估, so that 系统不会声称我缺钾、缺铁或缺维生素。
33. As a 用户, I want 在资料和规则适用时查看一般营养参考范围, so that record-only 模式也能提供背景信息。
34. As a 用户, I want 一般参考范围与个体计划目标明确分开, so that 我不会把通用信息误认为医疗建议。
35. As a 用户, I want 查看每日与滚动热量差, so that 单日社交饮食不会自动等于计划失败。
36. As a 用户, I want 查看每日与滚动营养趋势, so that 我能理解持续模式而不是追求每天精确命中。
37. As a 用户, I want 身体趋势和高质量摄入记录逐步校准个人维持热量, so that 计算会随长期使用改善。
38. As a 用户, I want 只有覆盖、测量协议和观察期满足要求时才进行个人校准, so that 低质量数据不会越校越错。
39. As a 用户, I want 补录或修正后生成新版 Daily Health Ledger, so that 最新计算反映有效事实并保留旧版本。
40. As a 开发者, I want GoalPath、Planner、客户端和通知只消费同一个 Ledger, so that 产品不存在多套互相矛盾的营养计算器。

### 活动、自由训练与计划训练

41. As a record-only 用户, I want 从首页进入自由训练, so that 我可以自行编排动作而不需要 Training plan。
42. As a 自由训练用户, I want 选择动作、组数、重量、次数、RPE/RIR 和备注, so that 实际训练被完整记录。
43. As a 自由训练用户, I want Workout session 没有 Plan reference 也合法, so that 系统不会把自由训练称为计划外失败。
44. As a 计划用户, I want 从今日计划卡开始训练, so that Workout session 能引用当前 Plan revision。
45. As a 计划用户, I want 实际完成、部分完成、替换、跳过和提前结束分别记录, so that 计划与实际不会互相覆盖。
46. As a 用户, I want 计划训练和自由训练生成同一种 performed Record, so that Daily Health Ledger 不需要两套历史模型。
47. As a 用户, I want 记录步数、一般活动和主动运动, so that 日常行动参与能量与执行判断。
48. As a 用户, I want 记录体重、围度和其他约定身体测量, so that 身体趋势可以与计划和摄入比较。
49. As a 用户, I want 记录睡眠、疲劳、酸痛、恢复和可用时间, so that Agent 能理解计划执行环境。
50. As a 用户, I want 缺失恢复数据保持 unknown, so that 未记录不会自动变成恢复差。
51. As a 用户, I want record-only 首页显示记录摘要和自由训练入口, so that 没有计划时首页仍然完整可用。
52. As a 用户, I want 有 Active plan 时首页显示今日计划和记录摘要, so that planned 与 performed 同时可见但保持分离。

### 目标协商、授权与首页状态

53. As a 用户, I want Agent 根据我想要的结果分析时间和代价, so that 目标不是脱离现实的愿望。
54. As a 用户, I want 比较较快、平衡和渐进等多套路径, so that 我可以选择愿意付出的饮食、训练、记录和生活改变。
55. As a 用户, I want 每套路径说明预计期限、执行负担、健康护栏和不确定性, so that 我能知情选择。
56. As a 用户, I want 确认结果、期限、代价、测量方法和保护条件后形成 Goal contract, so that 后续规划有明确判断主语。
57. As a 用户, I want Goal contract 变化创建新 revision, so that Agent 不能静默改变目标或日期。
58. As a 用户, I want 选择类似 Coding Agent 的授权习惯, so that 自动调整程度符合我的使用方式。
59. As a 用户, I want 选择这一次询问、始终询问、允许一次或允许类似小调整, so that 我不需要理解复杂内部保护字段。
60. As a 用户, I want 授权偏好长期保存直到我修改, so that 每个阶段不需要重新学习同一种使用习惯。
61. As a 用户, I want 系统硬护栏始终有效, so that 自动权限不能跨越伤病、极端控制或健康风险。
62. As a 用户, I want 自动调整后看到原因、变化、预计效果、复核时间和撤销入口, so that 自动不等于静默。
63. As a 用户, I want planning 状态在首页显示规划进度或缺失信息, so that 计划生成不会看起来像卡住。
64. As a 用户, I want active-plan 状态显示今日计划卡, so that 我可以直接开始执行。
65. As a 用户, I want review-due 状态显示简洁调整卡, so that 我能理解进步变慢并决定保持或调整。
66. As a 用户, I want paused 或 completed 状态回到记录体验, so that 计划不是使用产品的前提。
67. As a 开发者, I want 首页卡片由固定产品状态投影决定, so that LLM 不能创造页面事实状态。

### Planning Agent 与固定候选验证

68. As a 用户, I want Agent 根据 User profile、Timeline 和长期实际行动规划, so that 方案反映真实生活而不是理想模板。
69. As a 用户, I want Agent 使用我确认的饮食、动作、时间、器械、预算和记录偏好, so that 计划更容易执行。
70. As a 用户, I want Agent 通过版本化领域知识和 typed tools 生成计划, so that 专业建议具有来源和确定性计算支持。
71. As a 用户, I want LLM 负责组织 Training plan、Nutrition strategy 和习惯改变, so that 计划能灵活适配个人情境。
72. As a 用户, I want 固定引擎负责目标可达性、健康护栏和计划验证, so that LLM 不给自己的计划自行判定安全有效。
73. As a 用户, I want 固定引擎先给出目标所需的安全热量差范围, so that LLM 不会随意发明固定缺口或盈余。
74. As a 用户, I want LLM 在允许范围内组织训练日、休息日、营养目标、日型和渐进行为, so that 周期目标可以适应我的日程和社交生活。
75. As a 用户, I want 固定引擎验证营养目标范围和已确认摄入数值, so that 未知食物不会被伪装成满足能量、宏量或微量约束的精确方案。
76. As a 用户, I want Agent 优先保留我已经能坚持的习惯, so that 计划不会一次推翻全部生活方式。
77. As a 长期高摄入用户, I want 从足以改善路径的较小改变开始, so that 我不会突然被要求极端限制或所谓干净饮食。
78. As a 用户, I want 当前阶段只改变少数高价值行为, so that 我能执行并判断什么真正有效。
79. As a 用户, I want 每个计划包含当前习惯基线、改变方向和本阶段行动, so that 计划代表习惯转变而不是临时菜单。
80. As a 用户, I want 每个计划包含观察窗口、成功信号、保持条件、推进条件和回退条件, so that 后续调整有明确依据。
81. As a 用户, I want 缺少可观察性的计划无法提交, so that Coach 以后能区分没执行和没效果。
82. As a 用户, I want 无效候选不展示为正式计划, so that 我只确认通过固定验证的方案。
83. As a 用户, I want LLM 在候选失败时收到结构化违规并有界返修, so that 计划可以灵活改进但不会无限循环。
84. As a 用户, I want 固定目标在健康护栏下不可达时看到时间与代价冲突, so that Agent 不会用更极端方案掩盖现实。
85. As a 用户, I want 修改目标或期限必须重新协商 Goal contract, so that Planning Agent 只能在已确认合同内工作。

### Timeline Hook、每日检查与沟通

86. As a 用户, I want 每次有意义的 Timeline 变化先经过固定规则检查, so that 需要及时处理的模式不会等到下周。
87. As a 用户, I want 单次普通波动通常只被观察, so that 一顿饭或一次缺训不会自动重做整个计划。
88. As a 用户, I want 累计高摄入、连续关键缺训和恶化趋势能形成 Signal, so that 长期路径问题会被发现。
89. As a 用户, I want 规则引擎先识别累计模式再调用 LLM, so that 每条记录不会产生不必要的模型成本。
90. As a 用户, I want 每日检查只观察长期无记录、明确未执行、连续失败、身体趋势、期限瓶颈和安全问题, so that 产品不会每天重复分析和打扰。
91. As a 用户, I want 没有新 Signal 时不调用 LLM也不通知, so that Coach 保持安静。
92. As a 用户, I want 同一状态只有在恶化、新原因、期限窗口或冷却策略允许时再次提醒, so that 通知不会重复轰炸。
93. As a 用户, I want Agent 对话写入的 Timeline Record 在同一 run 返回检查结果, so that 当前沟通不需要额外通知。
94. As a 用户, I want 手动填写后的 Signal 通过首页卡片或通知送达, so that 后台检查不会丢失。
95. As a 用户, I want 相同 Record 经不同入口得到相同固定计算结果, so that 来源只影响送达方式和证据质量。
96. As a 用户, I want 计划、Goal contract、Nutrition strategy 或 Readiness state 的实质变化也重新检查, so that 判断不会绑定旧版本。
97. As a 用户, I want 明确伤病风险、极端限制摄入或过度训练触发 hard stop, so that Agent 不会继续加码。
98. As a 用户, I want 普通进步变慢只显示当前趋势和调整建议, so that 我不需要阅读复杂置信度和诊断树。
99. As a 用户, I want Agent 可以对普通 Signal 选择继续观察, so that 产品不被固定阈值驱动成频繁调整机器。
100. As a 开发者, I want Agent 继续观察时记录原因、期限和下一触发条件, so that 灵活判断仍可审计。

### 记录覆盖、执行与计划效果诊断

101. As a 计划用户, I want 观察合同定义每周身体数据、训练完成度和部分饮食记录期望, so that 记录要求与计划强度相符。
102. As a 计划用户, I want 至少每周有身体数据、训练完成度和部分饮食证据, so that 长期路径可以被合理评估。
103. As a 用户, I want 未记录条目排除在执行率分母外, so that 缺失不会变成失败。
104. As a 用户, I want 长期缺少预期记录形成 tracking-silence Signal, so that Agent 可以确认是忘记、负担过高、暂停还是没有执行。
105. As a 用户, I want Agent 询问后的原因经我确认再写入 Timeline, so that 系统不会猜测我为什么没坚持。
106. As a 用户, I want 系统区分 execution aligned、strained、gap 和 unknown, so that 执行问题不是单一失败标签。
107. As a 用户, I want 任务完成度按近期性、关键性和剩余时间解释, so that 相同缺训次数在不同目标阶段有不同影响。
108. As a 用户, I want 执行不足时先调整时间、训练长度、动作、餐次或记录负担, so that 规划问题不会被简单归咎于我。
109. As a 用户, I want 记录覆盖充分但观察窗口未到时继续观察, so that 短期没有结果不会被称为计划无效。
110. As a 用户, I want 测量协议不可比时得到测量问题提示, so that 噪声不会驱动错误重规划。
111. As a 用户, I want 执行充分、观察期满足且身体无响应时进入计划响应复核, so that 真正无效的计划会被修改。
112. As a 用户, I want 恢复或表现下降时先降低不可持续负担, so that 系统不会用更多训练或更少饮食应对所有问题。
113. As a 用户, I want 每次诊断说明下一次需要观察什么, so that 调整能被验证。
114. As a 用户, I want 每次调整尽量只改变少数变量, so that 后续能判断变化效果。

### 渐进调整、个性化与长期学习

115. As a 用户, I want Agent 根据体重、围度、任务完成率和恢复决定下一阶段, so that 调整跟随真实趋势。
116. As a 用户, I want 进步符合路径时保持当前阶段, so that 系统不会为了显得主动而修改计划。
117. As a 用户, I want 完成度高但响应不足时生成下一阶段候选, so that 有证据支持的调整会及时发生。
118. As a 用户, I want 完成度低时先降低计划摩擦而不是继续加严, so that Agent 帮助我建立可持续习惯。
119. As a 用户, I want 恢复恶化时回退或降低负担, so that 自动调整不会越过健康护栏。
120. As a 用户, I want 后续阶段根据当时真实数据重新生成, so that 首次计划不会假装知道未来全部状态。
121. As a 用户, I want Agent 记录每次候选、接受、执行、身体响应和反馈, so that 个性化可以被验证。
122. As a 用户, I want 实际行动比很久以前的自述拥有更高规划预测权重, so that 计划更接近我真正能做到的行为。
123. As a 用户, I want 实际行动与表达偏好冲突时看到简短说明, so that Agent 不会静默改写我的偏好。
124. As a 用户, I want 稳定偏好只有经我确认后进入 User profile, so that 长期记忆仍由我控制。
125. As a 用户, I want 未确认的模式保留为可检查 Working memory, so that Agent 可以形成假设但不能冒充事实。
126. As a 用户, I want 查看、修改、固定和忘记 Agent 记住的信息, so that 越用越懂我不等于隐藏监控。
127. As a 用户, I want 删除偏好后下一次规划停止使用它, so that 记忆控制会真实影响产品。
128. As a 用户, I want 产品跟踪计划接受率、关键执行率、持续时间、执行负担和调整后响应, so that Agent 能学习什么对我有效。
129. As a 用户, I want 达到身体结果后由 Agent 询问继续维持、新目标或暂停, so that 产品不强制我进入维持计划。
130. As a 用户, I want 目标完成必须由系统评估并由我最终确认, so that 单次读数不能替我宣布完成。

### 目标模式、实时训练与安全

131. As a 减脂用户, I want 能量缺口、关键训练、恢复和期限共同决定路径, so that 一次吃多不会脱离目标与计划被判断。
132. As a 增肌用户, I want 能量盈余、目标肌群剂量、表现、围度和恢复共同决定路径, so that 体重上涨不会自动等于增肌成功。
133. As a 塑形用户, I want 使用约定围度、比例、表现和主观满意度, so that 系统不会依赖图片理解或承诺不可测量的审美结果。
134. As a 用户, I want 同一 Timeline 事件在不同 Goal contract 下得到不同目标判断, so that 风险标准真正随目标变化。
135. As a 开发者, I want 未来训练来源只能通过统一 Record admission 提交已确认的 performed Workout Record, so that 后续接入不会建立第二套历史。
136. As a 开发者, I want 当前 V1 不依赖任何 Realtime Agent、相机或动作识别能力, so that 本轮验收可以完全通过手动训练与文本 Coach 完成。
137. As a 开发者, I want 预留入口只接受正式 Workout Record 而不暴露实时内部状态, so that 未来能力仍自然进入 Timeline、Ledger 和 GoalPath。
138. As a 用户, I want 伤病、极端节食、过度训练和明显恢复风险停止自动加码, so that Agent 灵活性不能覆盖安全。
139. As a 用户, I want 涉及疾病、药物、孕期或特殊临床状态时进入专门流程, so that 通用 Agent 不会假装提供医疗营养管理。
140. As a 用户, I want 安全提示使用清晰非诊断语言并建议适当专业帮助, so that 产品保持健身与记录边界。

### 开发、验收与可追溯性

141. As a 开发者, I want CoachApplication 是最高业务验收 seam, so that 默认客户端完整组合而不是孤立模块代表产品完成。
142. As a 开发者, I want Timeline → Daily Health Ledger → optional Goal/Plan Overlay 是唯一主链, so that 新功能不会建立平行事实和计算路径。
143. As a 开发者, I want 每个后续功能调用前置功能的正式 Interface, so that Ticket 前后依赖形成真实联通体验。
144. As a 开发者, I want 后续 Ticket 重跑全部前置业务场景, so that 新目标或入口不会破坏既有体验。
145. As a 开发者, I want 手工注入 risk snapshot 的测试不能作为产品完成证据, so that 默认接线缺失不会被隐藏。
146. As a 开发者, I want 固定营养、能量、趋势和候选验证结果可以确定性重放, so that 回归和事故排查可复现。
147. As a 开发者, I want LLM 测试通过 ScriptedLLMProvider 穿过真实 ToolRegistry, so that 计划生成和结果回灌走生产 Interface。
148. As a 开发者, I want 每个判断记录事实前沿、规则版本、知识版本、原因和结果, so that 用户可见建议能够审计。
149. As a 开发者, I want evaluated、skipped、coalesced、stale、failed 和 completed 都可观察, so that 没有动作也能解释。
150. As a 开发者, I want 新路径启用后删除旧默认减脂接线和重复计算器, so that 未来不会恢复旁路。
151. As a 产品方, I want 每张 Ticket 从真实入口验收到客户端可见结果, so that 文件、类型或孤立函数不会被误认为功能完成。
152. As a 产品方, I want 文档、Ticket 状态、默认组合测试和旧路径清理同时完成, so that 规格状态与实际产品保持一致。

### AI-first 页面、对话卡片与手动操作

153. As a 新用户, I want 登录后在缺少确认档案时进入专用全屏 Agent 对话, so that 首次初始化拥有清晰且连续的入口。
154. As a 新用户, I want 建档消息、问题和结构化表单卡保留在同一个 conversation thread, so that 我不会在多个伪步骤页面之间迷失上下文。
155. As a 新用户, I want Agent 根据当前目标和已知事实展示需要的表单卡, so that 结构化输入与对话自然配合。
156. As a 新用户, I want 已提交的表单卡留在原位置并变为只读历史, so that 我能回看自己提供了什么且 thread 不会重排。
157. As a 新用户, I want 在同一 thread 查看档案摘要并确认, so that 建档结果在进入下一步前可检查。
158. As a 没有目标的新用户, I want 确认档案后直接进入正常 App, so that 不需要先选择模式或创建计划也能开始记录。
159. As an adaptive-planning 新用户, I want 在同一 thread 查看和确认首次计划, so that 规划不会跳到另一个临时页面。
160. As an adaptive-planning 新用户, I want 首次计划确认后进入正常 Home 且计划仍可在 Plan 和 Calendar 找到, so that 初始化提交是真实持久状态。
161. As a 正常 App 用户, I want Today、Calendar、Record、Plan 和 Profile 都能独立完成日常操作, so that 例行功能不要求打开 Coach。
162. As a 正常 App 用户, I want Coach 作为当前页面上的可选 drawer 打开, so that 对话不会夺走当前页面上下文。
163. As a Coach 用户, I want 整次对话保持同一个页面根, so that Agent 不会通过跳转页面来模拟完成任务。
164. As a Coach 用户, I want 表单、Timeline 回执、路线、周计划、营养、差异、确认和提交结果以内嵌卡片展示, so that 结构化内容可操作且仍属于对话。
165. As a Coach 用户, I want 卡片内部切换路线、日期或详情时保持 conversation root 和滚动位置, so that 查看结构化内容不会重置对话。
166. As a Coach 用户, I want 低风险明确记录执行后立即看到可更正事实回执, so that 我知道系统实际保存了什么。
167. As a Coach 用户, I want 模糊或推断内容通过可编辑表单卡确认, so that 对话便利性不会绕过事实确认。
168. As a Coach 用户, I want 计划改变以 before/after 差异卡展示, so that 我能在确认前理解具体变化。
169. As a Coach 用户, I want 确认后在同一 thread 看到不可混淆的提交回执, so that 提案和已提交状态不会混在一起。
170. As a Coach 用户, I want 确认计划变化后底层 Today、Calendar 或 Plan 投影更新而 conversation root 不被替换, so that 对话与正常产品状态真实联通。
171. As a Coach 用户, I want stale 提案卡保留历史但禁止提交, so that 新事实不会让旧建议静默覆盖当前状态。
172. As a 手动操作用户, I want 与 Coach 完成同一操作时使用相同草稿和校验, so that 两条路径得到相同 canonical Record 或 Plan revision。
173. As a 手动操作用户, I want 不打开对话也能记录、训练、修正、查看计划和管理偏好, so that Chat 不是应用导航或功能门槛。
174. As a 规划用户, I want 计划卡按目标与目标时间、阶段路线、近期一周和今天的时间层级组织, so that 我先理解长期方向再执行当前任务。
175. As a 规划用户, I want 训练、恢复、适应日、有氧和休息共享七天日历, so that 恢复不是与训练割裂的专业 Tab。
176. As a 规划用户, I want 营养作为与 Goal cycle 和训练日类型协调的独立详情卡, so that 它不是孤立菜单也不挤进训练日历。
177. As a 用户, I want 日常反馈只修改最小安全未来范围, so that 一天变化不会无故重写整个阶段或目标路线。
178. As a 用户, I want 解释紧邻相关卡片且简短具体, so that 我能理解安排原因而不阅读角色扮演式 Coach 长文。
179. As a 有明确目标的新用户, I want Agent 自动继续目标确认与首次规划流程, so that 我不需要再选择一个与目标重复的产品模式。
180. As a 没有明确目标的新用户, I want Agent 让我直接进入记录体验, so that 系统不会因为我完成建档就自动创建计划。
181. As a 正常 App 用户, I want 不打开 Agent 也能手动关闭 Active plan, so that 我可以随时回到只记录的使用方式。
182. As a Coach 用户, I want 通过对话关闭计划时与手动操作得到相同结果, so that 两条入口不会产生不同的计划状态。
183. As a 用户, I want 关闭计划后保留 Goal contract、旧 Plan revision 和全部 Timeline 历史, so that 停止执行不等于删除过去。
184. As a 用户, I want 关闭计划后首页立即切换为记录摘要和自由训练入口, so that 客户端不会继续展示待执行计划。
185. As a 用户, I want 关闭计划后停止普通计划完成度、调整和执行提醒, so that record-only 模式不会继续催促我执行旧计划。
186. As a 用户, I want 重新开启规划时基于最新记录重新验证或生成候选, so that 过期旧计划不会被直接恢复。

## Implementation Decisions

### Domain ownership and product layers

- Timeline remains the append-only, provenance-bearing owner of confirmed Records. Captures, Record drafts, model estimates, plans, proposals, derived ledgers and assessments are not Timeline facts.
- Planned, performed and observed data remain separate. A Workout session may optionally reference a Plan revision; absence of a Plan reference means freestyle execution, not failure.
- Daily Health Ledger is a versioned derived Artifact over a pinned Timeline fact frontier. Corrections produce a new effective projection and a new Ledger version; they never overwrite the original Record or previous Artifact.
- Goal contract, Plan revision, Nutrition strategy, Readiness state, Coaching mandate, User profile and Working memory retain their existing domain ownership. Goal/Plan logic consumes Timeline and Ledger references rather than copying their fields into a new fact store.
- Record-only is a first-class derived product state, not a separately persisted onboarding preference. It applies when no Goal contract is active or the user has paused the current goal-planning flow. It has no Active plan, no plan completion semantics and no automatic planning reminders. It may still surface user-requested trends and non-ignorable safety signals.
- First-time routing follows confirmed goal intent. An actionable goal continues into Goal contract negotiation and first planning; absence of a goal enters record-only; ambiguous intent produces only the minimum clarification needed to decide. Dossier completion alone never creates an Active Goal or Plan.
- Normal App exposes a manual close/deactivate-plan action without requiring Coach. Coach may invoke the same typed application command through tools. Both paths clear Active-plan status through the same validation and audit flow.
- Closing a plan is not deletion. It pauses the active goal-planning flow and returns the client to record-only while Goal contract history, immutable Plan revisions, Nutrition strategy history, Plan outcomes and Timeline Records remain available. Plan-completion semantics and ordinary planning reminders stop.
- Re-entering adaptive planning uses the latest User profile, Timeline and Daily Health Ledger to validate the old plan or generate a fresh proposal. A previously active Plan revision is never silently reactivated across a changed fact frontier.
- 云端只提供身份鉴权、文本 LLM 推理与内容无关的用量计量；Profile、Goal、Plan、Workout、Timeline、Ledger 和媒体均保留在本地。LLM transport 永远不拥有事实、营养计算或计划提交。

### Primary modules and seams

- CoachApplication remains the single highest external product and test seam. V1 conversation, manual input, scheduled review, free training and planned training all enter through its public behavior.
- Record admission uses the existing typed Timeline command seam for append, confirmation, correction and provenance. New input adapters must converge there rather than writing directly to a UI store or nutrition calculator.
- A deep Daily Health Ledger Module owns all deterministic daily and rolling accounting: food nutrients, energy intake, expenditure estimate, energy balance, activity, training, body measures, coverage, uncertainty and personal calibration. Callers receive a versioned Artifact and do not choose or compose calculators.
- A deep Goal Path Module owns composite snapshot assembly, deterministic trend and deadline projection, hard guardrails, current-plan assessment, candidate validation, materiality, scheduled review and stable reason codes. It consumes Ledger Artifacts and domain references; it never reimplements nutrition accounting.
- A Planning Agent Module owns LLM/tool planning. It retrieves user facts, Ledger projections, permissions, plan outcomes and knowledge; generates a structured current-phase candidate; consumes fixed validation results for bounded revision; and returns an immutable proposal. It does not decide hard safety or write a Plan revision.
- Goal-specific models for fat loss, hypertrophy and physique are internal adapters inside the Goal Path Module. The default client never selects or manually composes them. Adding a new goal mode must not expand the CoachApplication Interface.
- Home projection is deterministic. Record-only, planning, active-plan, review-due, paused, completion-candidate and completed states select which fixed card family appears. LLM output may populate validated content but may not choose the state.
- Realtime Agent, camera interpretation and live coaching are outside this V1. The Record admission boundary reserves a future source-neutral entry for an already finalized and confirmed Workout Record; V1 tickets neither implement nor depend on its upstream realtime behavior.

### Food, nutrient and energy accounting

- Food records may preserve a user-entered name, amount, unit and meal context for traceability, but only user-confirmed structured nutrient values participate in accounting. Formal nutrient fields carry a field-level source of `manual_form`, `current_user_statement` or `manually_transcribed_label` and point to the confirming submission or turn.
- The nutrient schema supports a comprehensive extensible nutrient identifier set from the first version. The initial client prioritizes energy, protein, carbohydrate, fat, fiber, sodium, potassium, calcium, iron, magnesium and applicable vitamins when reliable data exists.
- Missing nutrient values remain unknown. A food name, amount, recipe name or general knowledge cannot trigger lookup, imputation or inference, and partial dietary coverage cannot support a deficiency conclusion.
- General reference ranges, individual plan targets, acute upper guardrails and rolling adequacy windows are distinct rule concepts. Each range carries jurisdiction, population applicability, rule version and source references.
- V1 has no food-composition provider, barcode provider, OCR, image understanding, automatic recipe derivation or generic knowledge fallback. Future source acquisition and licensing work requires a separate specification and cannot be inferred from this schema.
- Energy balance uses the stable convention intake minus estimated expenditure: negative values represent a deficit and positive values a surplus. All inputs and outputs are ranges with uncertainty, not false-precision single measurements.
- Expenditure combines basal estimate, daily activity, planned/performed training and thermic-effect assumptions. Wearable or reported expenditure is evidence with an error model; it is not automatically accepted as measured expenditure or fully added back to intake allowance.
- Daily target balance is a plan-specific band derived from Goal contract, deadline and fixed health guardrails. Values such as a 500-kcal deficit or 200-kcal surplus are examples, never universal constants selected by the LLM.
- Rolling energy path is the primary progress basis. Day-type distribution may vary across training, rest and social days, but weekly/cycle conservation and daily hard guardrails must hold. The system never creates punitive exact calorie repayment or exercise compensation.
- Personal maintenance calibration uses sufficient intake coverage, comparable body measurements, minimum observation time and stable provenance. Low-quality evidence widens uncertainty and cannot silently move the estimate.

### Record coverage and observation contracts

- Absence of a Record is not an execution failure. Missing expected entries are excluded from completion denominators and represented in coverage separately.
- Every confirmed Plan revision includes an observation contract defining expected weekly body data, training completion evidence, representative nutrition evidence, measurement protocols, observation windows, success signals, progression signals, hold signals and stop/backoff signals.
- At minimum, active planning expects weekly body data, training-plan completion information and representative dietary evidence, but exact frequency is plan-specific. Record-only users have no implicit observation requirement.
- Repeated absence against an active observation contract creates a tracking-silence Signal. Agent communication must distinguish forgetting, excessive recording burden, deliberate pause, unknown execution and confirmed non-execution before a new fact is recorded.
- Plan response cannot be called ineffective unless coverage is sufficient, minimum key execution is met, the observation window has elapsed and the measurement protocol is comparable. Otherwise the result is insufficient evidence, execution gap, too early or measurement issue.

### Goal negotiation, permissions and planning

- Before creating an Active plan, Agent presents multiple feasible deadline/effort paths such as faster, balanced and gradual. Each path explains expected behavior burden, training time, tracking burden, safety constraints and uncertainty.
- User confirmation creates or revises the Goal contract. Outcome, deadline and health guardrails cannot be silently changed by Planning Agent. If the fixed engine finds no healthy path, Agent presents the conflict and requests explicit renegotiation.
- Coaching mandate exposes simple Coding-Agent-like user choices: ask this time, always ask, allow once, allow similar adjustments and deny. These are durable usage preferences rather than phase-scoped defaults; the user may change them at any time.
- Internal safety and protected-field enforcement remains automatic and is not exposed as a complex permission matrix. Injury risk, extreme restriction, medical constraints, Goal outcome, deadline and health guardrails remain outside silent automatic change.
- LLM generates the plan structure; deterministic tools provide target energy/macronutrient ranges, confirmed Ledger aggregation, scheduling, training dose, guardrails and validation results. They do not provide food lookup or meal estimation. A formal candidate includes coordinated Training plan and Nutrition strategy content, current habit transition, execution burden and observation contract.
- Food-level planning may remain qualitative or reuse values the user already confirmed. It cannot claim that an unknown food or exact portion satisfies energy, macro or micronutrient targets.
- The first phase starts with the smallest change that materially improves the path and remains compatible with the agreed deadline. A fixed 20% reduction is a possible candidate, not a universal rule.
- Only current-stage strategy and progression rules are created initially. Future stages are generated from later Timeline and Ledger evidence rather than fully materialized in advance.
- Candidate validation uses the same facts, rules, goal model and uncertainty model as current-path assessment. An invalid candidate remains an internal draft. After a bounded number of revisions, failure leaves the current plan unchanged.

### Incremental rules, scheduled review and Agent discretion

- Every accepted material Timeline change and every material revision of Goal contract, Active plan, Nutrition strategy or Readiness state emits a durable review trigger after the authoritative write. Analysis failure never rolls back the Record.
- A low-cost deterministic rule pass handles each trigger. It aggregates confirmed patterns and only requests Agent work for material review, evidence collection, proposal generation or hard safety action.
- A daily scheduled pass evaluates long-horizon state without inventing Timeline facts. It checks persistent tracking silence, confirmed non-execution, repeated execution failure, body trend, approaching bottleneck, recovery and safety.
- Daily review does not invoke LLM or notify when no new material Signal exists. Stable repeated states are suppressed until material worsening, new evidence, a new deadline window or policy cooldown.
- Signals have distinct authority. Hard-stop and guardrail-breach signals cannot be reduced by LLM. Review signals and weak observations may be interpreted by Agent, including a decision to monitor with a recorded reason, review time and next trigger.
- Agent may elevate a complex pattern to review-recommended, but cannot turn insufficient evidence into a factual cause or bypass deterministic candidate validation.
- User-facing communication is concise: what changed, what small adjustment is proposed, how long to try it, when it will be reviewed and how to undo. Detailed evidence, alternatives, confidence and version pins remain available to audit rather than being mandatory UI clutter.

### Habit adaptation and memory

- Plans optimize sustainable execution under a confirmed goal and health guardrails, not theoretical maximum speed. The product avoids moral labels such as clean/dirty food and treats behavior change as progressive replacement or reduction of obstructive patterns.
- Each habit transition records the baseline pattern, target direction, current small change, expected burden, observation window, progression condition, hold condition and backoff condition.
- High execution with expected response holds the phase. High execution with insufficient response after the observation window may request a new candidate. Low execution first triggers friction diagnosis. Recovery decline triggers backoff, not automatic intensification.
- Confirmed User profile preferences, derived execution patterns, Working memory hypotheses and immutable Plan outcome history remain distinct. Repeated actual behavior has stronger predictive value for executability than old self-report, but it does not silently rewrite a stated preference.
- Planning Agent links each proposal to user acceptance, actual execution, duration, burden, body response and feedback. Future planning uses this history to prefer strategies that the user both likes and actually executes.
- Users can view, edit, pin and forget Working memory and stable preferences. Removing information affects subsequent planning while leaving immutable historical Records intact.

### Completion, pause and continued recording

- Fixed evaluation may create a goal-completion candidate only after Goal contract measurement requirements are met. A user manually confirms completion; the system never completes a goal on the user's behalf.
- After confirmation, Agent offers continued maintenance, a new Goal contract or paused planning. Maintenance is optional rather than a mandatory automatic phase.
- Paused planning stops ordinary goal, execution and adjustment reminders and returns the client to record-first surfaces. New Records remain valid; non-ignorable safety signals may still be shown.

### Interaction architecture and manual/Agent parity

- First-time initialization and normal product use are separate lifecycle states. An account without a confirmed dossier enters one dedicated full-screen Coach conversation. It cannot rely on normal Home, Today or Plan projections that require confirmed facts.
- The initialization thread is append-preserving. Text, form cards, dossier summary, goal confirmation, planning progress, roadmap, week calendar, nutrition detail, confirmation and commit receipt are message items in one conversation root. Submitted cards remain read-only history instead of becoming separate step pages.
- After dossier confirmation, Agent routes from confirmed goal intent in the same thread. With an actionable goal, the thread continues through Goal contract and validated first-Plan confirmation before normal Home. Without a goal, it enters normal record-only Home. Ambiguous intent receives a minimal goal clarification rather than a generic mode chooser.
- Normal App manual paths are complete and primary-capable: Today, Calendar, Record/Add, Plan and Profile never require opening chat. Coach is an optional drawer over the current page and preserves the underlying route, task context and projection.
- Agent conversation is a single-surface interaction. Structured content is rendered by the fixed Artifact/card registry inside the thread. Card-local tab, date and detail interactions may update card state but must not replace the conversation root, reset scroll or navigate the user to simulate progress.
- Manual UI and Coach tool calls converge before business validation. They use the same Record draft or plan proposal representation, typed application command, provenance rules, Policy/Coaching mandate checks, deterministic validation, confirmation gate and canonical commit.
- Manual close-plan UI and Coach-assisted close-plan use the same deactivate command. Success removes the Active-plan projection, switches Home to record-first presentation and stops ordinary plan monitoring; it does not erase historical resources.
- Clear low-risk Records may return an immediate correctable fact receipt. Ambiguous captures require a form/confirmation card. Material plan changes require an immutable diff/proposal card and confirmation unless a valid durable authorization explicitly covers the change.
- Confirmation produces a committed receipt in the same thread and updates the underlying canonical projection. The receipt, proposal and current projection are distinct states; a stale proposal remains visible as history but is disabled.
- Planning information architecture is ordered by time horizon: goal and target time, dated stage roadmap, integrated near-term week and today. Training and recovery share a seven-day calendar; nutrition is a coordinated detail card rather than a professional-domain navigation tab.
- Explanations are brief, specific and adjacent to the decision or card. They state the arrangement and concrete reason without role-playing prose or exposing private reasoning.
- The existing browser prototype is interaction evidence only. Its hard-coded data, copy, state and demonstrated capabilities are not production facts and must not be transplanted as compatibility behavior.

### Delivery sequence and completion governance

- Implementation work is reorganized as functional, dependency-linked tickets rather than horizontal evaluator/calculator tickets. The planned sequence is: unified Records; Daily Health Ledger; explicit nutrient entry; record-only and freestyle training; trend/calibration; goal negotiation and permissions; safety; first-phase planning; planned execution; goal-mode evaluation; diagnosis; Timeline/manual delivery; daily long-term review; validated adjustment; learning; completion/pause.
- Every downstream ticket calls upstream production Interfaces and reruns upstream business scenarios. A downstream goal mode cannot introduce a parallel public evaluator, snapshot source, nutrition calculator or client path.
- Audit, replay, UI projection, default dependency composition and legacy-path deletion are Definition-of-Done requirements for every functional ticket, not isolated final tickets.
- Existing horizontal adaptive-coach tickets are superseded where they conflict with this flow. Their valid causal trace, bounded tool loop, knowledge citation, immutable proposal and replay requirements are retained and remapped to functional acceptance. Realtime implementation requirements are not carried into this ticket set.

## Testing Decisions

### What makes a good test

- Tests assert user-visible and durable behavior through the highest stable Interface: accepted Records, correction lineage, Daily Health Ledger values/ranges/coverage, home projection, GoalPath state, Agent tool calls, proposal state, permissions, immutable Plan revisions, notifications and trace results.
- Tests do not assert private prompt wording, model Chain of Thought, internal evaluator composition, regex routing, hidden calculator steps or a specific LLM prose formulation.
- Deterministic calculations use fixed clocks, pinned rules/reference data and explicit uncertainty fixtures. LLM workflows use ScriptedLLMProvider through the real Agent runtime and ToolRegistry.
- A test that manually injects a goal-specific risk snapshot or replaces default production composition does not prove a product feature complete.
- Each functional ticket includes at least one positive flow, one negative or insufficient-evidence flow, one stale/failure flow, a replay assertion and proof that prior confirmed state was not wrongly changed.

### Primary seam

- The primary acceptance seam is CoachApplication using real Timeline commands, default production module composition and ScriptedLLMProvider when language/planning is required.
- Mobile product acceptance consumes the same CoachApplication projection used by production home, record, training and Coach surfaces. UI-local fake facts cannot satisfy acceptance.
- Internal seams are reserved for deterministic math and normalization: explicit nutrient input, energy accounting, trend/calibration, goal-specific policy and plan invariant validation. Their tests complement but do not replace highest-seam scenarios.

### Required record and Ledger scenarios

- Record-only user logs partial food, activity, body and free-training data and receives a Daily Health Ledger without plan completion or goal warnings.
- Planned and freestyle Workout sessions generate the same performed Record shape, with only the planned session carrying a Plan revision reference.
- Manual form values, current user statements and manually transcribed labels preserve different field-level provenance while producing compatible nutrient projections.
- A food name or amount without explicit nutrient values creates a valid descriptive Record while all unavailable nutrient fields remain unknown.
- Missing nutrient fields remain unknown; partial meal logging reports partial coverage and cannot trigger a deficiency conclusion.
- Sodium, potassium, fiber and other supported nutrient totals survive corrections, late entry, unit normalization and Ledger versioning.
- Energy intake, basal estimate, activity, training and thermic-effect ranges produce a stable signed energy-balance range. Wearable data changes evidence quality rather than being blindly added back.
- A training-day/rest-day distribution can vary while the rolling target remains conserved and daily hard guardrails hold.
- Low-coverage data cannot recalibrate maintenance; sufficient comparable multiweek data may adjust the personal estimate and preserve prior versions.

### Required planning and adaptive scenarios

- Agent offers multiple deadline/effort paths; confirmation creates a Goal contract, while record-only users continue without one.
- Planning Agent uses confirmed facts, Ledger data, knowledge and tools to generate a coordinated current-phase candidate; deterministic validation rejects unsafe or non-improving candidates.
- A long-term high-intake user receives a smaller staged habit change rather than an immediate idealized diet replacement, provided the staged path remains compatible with the confirmed goal.
- Agent-added Record returns a review in the same conversation; the equivalent manual Record produces the same calculation and a background card/notification.
- A single excess-intake or missed-training Record monitors when buffer remains; repeated confirmed patterns create a review Signal; hard safety evidence creates a non-overridable hold.
- Missing expected logging lowers coverage and eventually prompts a tracking-silence conversation without entering the execution-failure denominator.
- High completion with insufficient elapsed time continues observation; high completion plus sufficient time and comparable non-response creates a plan-response review; low completion creates friction diagnosis instead.
- Daily scheduled review remains silent without a new material Signal and does not repeatedly call LLM for unchanged state.
- Similar small adjustments follow the user's durable authorization choice; hard guardrails and high-impact changes still require appropriate blocking or confirmation.
- Repeated plan outcomes affect future candidate selection; deleting a preference or Working memory item removes its use from future planning.
- Fat loss, hypertrophy and physique consume the same Ledger and review Interface but apply distinct target predicates to the same Timeline event.
- Goal completion requires both measurement-policy evidence and user confirmation; pause returns to record-only behavior without deleting history.

### Required integration, replay and migration scenarios

- Text conversation, manual input, scheduled review, free training and planned training all converge on the same Timeline → Ledger → optional GoalPath chain.
- Same pinned Timeline frontier, domain revisions, rule/reference versions and deterministic inputs reproduce the same Ledger, guardrail and candidate-validation result.
- LLM output may vary, but every formal candidate must pass the same fixed validation. Replay preserves the exact model input, tool results, candidate and validation trace without storing private reasoning.
- A new Timeline fact, Goal contract, Plan revision, Nutrition strategy or relevant readiness revision makes an older proposal stale before commit.
- Every material trigger has an evaluated, skipped, coalesced, stale or failed outcome and stable reason code; notification suppression is also observable.
- No production call site uses a duplicate TDEE, nutrient target, fat-loss-only default evaluator or goal-specific snapshot assembly after its replacement ticket completes.
- Downstream ticket suites execute all predecessor user flows through default composition before status may move to completed.

### Required interaction scenarios

- Login with no confirmed dossier opens one full-screen conversation root. Messages and submitted form cards remain in the same thread and preserve their order as later cards appear.
- Onboarding with no confirmed goal enters normal record-only Home without manufacturing a first Plan. Onboarding with an actionable goal remains in the same thread through Goal contract and first-plan confirmation, then exposes the committed Plan from normal Home, Plan and Calendar projections.
- The first-time thread dynamically identifies and confirms goal intent; it does not present record-only versus adaptive planning as an unrelated fixed mode-choice step, and no plan is generated merely because dossier confirmation succeeded.
- Switching roadmap, week, day and nutrition details changes only the relevant card-local state and preserves the conversation root and scroll position.
- A clear Agent-recorded fact returns a correctable fact receipt in the same thread; an ambiguous capture returns a form card and creates no Timeline fact before confirmation.
- A daily plan change displays a structured before/after proposal. Confirmation changes the canonical Today projection and adds a committed receipt without replacing the conversation root.
- The same manual and Coach-assisted operation produce equivalent command validation, canonical Record/Plan data and product projections. Manual operation completes without creating or opening a CoachSession.
- Manual close-plan and Coach-assisted close-plan produce the same inactive-plan projection, retain historical Goal/Plan/Timeline resources, remove the active Today plan card and stop ordinary plan reminders.
- Re-entering planning after new Records exist does not blindly restore the old Plan revision; it evaluates the latest Ledger and requires a valid current proposal or explicit confirmation.
- Opening Coach from Today, Calendar, Record, Plan or Profile preserves the underlying route and task context; closing and reopening restores the same task-scoped conversation and pending card state.
- A stale proposal remains visible and read-only, cannot commit, and points the user toward the updated current state.
- UI tests assert stable root identity, scroll continuity, card lifecycle and canonical projection changes rather than copying prototype CSS, hard-coded values or exact prose.

### Existing prior art

- CoachApplication and ScriptedLLMProvider lifecycle, tool-loop, proposal and confirmation tests.
- Timeline append/correction/provenance and risk-trigger coordinator tests.
- Daily intake budget, daily energy budget, Nutrition strategy and Nutrition day ledger tests.
- GoalCycle Planner trace, invariant and forecast scenario tests.
- Goal-specific risk, execution continuity and stagnation fixtures, retained as behavior references but migrated behind the new highest seam.
- Mobile record drawer, nutrition observation draft, product projection, home-flow and workout-session tests.
- Existing workout finalization contracts are prior art only; this V1 neither expands nor depends on Realtime Agent behavior.

## Out of Scope

- Displaying an uncalibrated numerical plan success probability or promising a personal outcome.
- Clinical diagnosis, eating-disorder diagnosis, injury diagnosis, medication management, pregnancy nutrition planning or individualized medical nutrition therapy. These require separate reviewed rules and appropriate professional escalation.
- Any food photo/image/audio/video understanding, OCR, barcode lookup, food-composition database lookup, automatic recipe derivation, LLM/tool meal estimation or food-name/portion nutrient inference. These capabilities are absent from V1 rather than available as low-confidence fallbacks.
- Claiming nutrient deficiency from incomplete dietary records or replacing laboratory/clinical assessment with intake estimates.
- Copying or using unlicensed Chinese food-composition or dietary-reference data. Source acquisition, licensing and evidence admission continue through the existing knowledge governance workflow.
- Requiring a commercial global branded-food inventory before the record-first Ledger can ship; the Interface must support future providers without changing Timeline ownership.
- Mandatory maintenance planning after goal completion. The user chooses maintenance, a new goal or paused planning.
- Making a plan mandatory for Timeline, nutrition accounting, trends, freestyle training or continued product use.
- Moving Agent orchestration, Timeline ownership, deterministic accounting, safety policy or plan commit authority into the remote LLM Gateway.
- Implementing or expanding Realtime Agent, camera, pose, rep, phase, trajectory or live-coaching behavior. V1 only reserves the source-neutral Record admission boundary for a future finalized Workout Record.
- Recording raw model Chain of Thought or exposing the full internal diagnosis tree as required user-facing copy.
- Proving causal effectiveness of an Agent recommendation from observational product data; the product records associations and outcomes for later evaluation.
- Treating the handoff prototype's hard-coded data, planning numbers, copy, persistence or simulated writes as completed production capability.
- Requiring Agent conversation for routine manual use, or using chat messages as an application navigation protocol.

## Further Notes

- This specification is intentionally record-first. “计划只做引用，记录是底座” is a non-negotiable architectural and acceptance invariant.
- Daily Health Ledger is a user-facing calculator Artifact and the sole nutrition/action accounting source. Goal and plan evaluation consume its versioned projections rather than recomputing intake, expenditure or nutrients.
- Information can improve accuracy only when it has provenance, comparable protocols and sufficient coverage. More unverified fields must widen uncertainty rather than create false precision.
- User-facing copy should avoid moralizing food as clean or dirty and avoid framing execution gaps as character failure. Progressive adaptation changes habits in steps while preserving honest deadline/effort trade-offs.
- The expected implementation follow-up is a new dependency-linked functional ticket set. Existing adaptive-coach and client-MVP requirements should be mapped to the new stories before any old ticket is marked completed or superseded.
- The `ready-for-agent` status means the product decisions and highest testing seam are settled. It does not mean nutrition reference licensing gaps, current code duplication or default-client integration are already complete.
- The AI-first interaction handoff is incorporated only as UI and interaction evidence: full-screen initialization, one continuous thread, inline structured cards, complete manual paths, optional normal-use Coach drawer and manual/Agent command parity. Its capability claims and prototype limitations do not establish implementation completion.
