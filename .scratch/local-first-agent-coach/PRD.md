Status: ready-for-agent

# Local-first Agent Coach Harness 与首个客户端垂直切片

## Problem Statement

用户希望 Form Coach 不只是记录动作或展示一个聊天框，而是一名能够长期理解目标、计划、训练表现、饮食、睡眠、恢复、器材和日程的健身 Coach：它既能服务第一次居家徒手训练的新手，也能服务需要精确重量、次数、RIR、周量和减量周管理的健身房用户。

当前客户端已经拥有 Rust canonical packet、部分 Android/iOS 原生工程、动作识别与报告能力，以及一份覆盖 Today、Calendar、Progress、Workout 和 Agent 抽屉的交互原型，但 Agent 能力仍是远程 LLM 直调或原型假数据。项目没有可持久化的 CoachSession、Plan Revision、Timeline、Working Memory、Typed Tool Registry、Artifact Card、Human-in-the-loop、Action Log、原子提交或撤销协议。LLM 目前不能安全地读取完整上下文、产生可信卡片或在受控权限下真正修改计划。

如果继续把计划事实、UI 卡片、LLM tool call 和数据库写入混在一起，会出现以下用户问题：计划和真实经历相互覆盖；旧提案修改新计划；模型生成看似专业但无法追溯的重量与组数；关闭抽屉后等待状态丢失；自动修改无法撤销；Android 与 iOS 形成两套行为；离线时 Coach 退化成不可用的壳。

## Solution

建立一个完全运行在客户端本地的 `CoachApplication` 深模块，作为 UI、测试和未来 Recipe 的唯一高层入口。它通过依赖注入组合 `AgentRuntime`、`ActionBroker`、纯确定性的 `CoachKernel`、`PolicyGate`、`ContextAssembler`、`MemoryCurator` 和 typed Tool Registry；通过稳定 Port 替换 SQLite/In-memory、远程或端侧 LLM、HealthKit/Health Connect、同步、通知和 Motion Runtime 实现。

用户事实继续归 `UserProfile`、`Timeline`、`PlanRevision` 和 `WorkoutSession` 所有。`CoachSession` 只保存连续交互、CoachRun、ToolCall、Artifact 引用和等待中的 Human-in-the-loop。Agent 的结构化输出先成为不可变 Artifact，再由客户端固定 Card Registry 渲染；确定性卡片动作不重新交给 LLM，而是经过 `ActionBroker → PolicyGate → CoachKernel → CoachLedger atomic commit`。每次写入都同时保存 revision、Action Log 和一次性 ActionToken 消费；撤销产生补偿 revision，不删除历史。

第一交付切片把这套架构接到客户端 Agent 抽屉，并跑通一条可观察的闭环：读取本地事实并展示 TodayPlan；生成 PlanChangeProposal；等待用户确认或根据 scoped Mandate 自动提交；展示 ActionReceipt；支持 stale、reject 和 undo；跨抽屉收起、页面切换和进程重启恢复 CoachSession、Working Memory 与待处理动作。其余健身规则、健康平台、同步和营养能力沿用同一架构逐步加入。

## User Stories

### 首次使用、目标与权限

1. As a 新用户, I want 不注册账号也能开始使用, so that 断网和隐私偏好不会阻止核心训练体验
2. As a 新手用户, I want 选择增肌、减脂、增力、提升体能或保持健康等目标, so that Coach 能建立明确的 Goal Contract
3. As a 用户, I want 填写目标期限、成功指标、训练经验和可训练频率, so that 路径预测和计划编排有稳定依据
4. As a 居家用户, I want 声明空间、噪音和徒手或小器械条件, so that 计划不会包含无法执行的动作
5. As a 健身房用户, I want 为不同地点记录器材、附件、重量范围和实际档位, so that 动作替代和负荷建议符合真实条件
6. As a 用户, I want 记录不喜欢、不会做、明确排除或必须保留的动作, so that Coach 不会反复建议错误内容
7. As a 用户, I want 记录身体限制、疼痛和需要专业复核的风险信息, so that 系统优先安全降级
8. As a 用户, I want 选择记录、协作或托管模式, so that Coach 的写入权限符合我的控制偏好
9. As a 用户, I want 分别授权相机、健康数据、通知、远程 LLM 和同步, so that 数据读取权与计划执行权不会被一个总开关混淆
10. As a 用户, I want 修改目标和授权时产生新 revision, so that 旧计划不会静默继续使用过期约束

### 计划生成与管理

11. As a 新手用户, I want Coach 根据目标、经验、时间、器材和限制生成第一份可执行计划, so that 我不需要先学习专业编排
12. As a 用户, I want 计划同时表达周期、周安排和单次训练意图, so that 今日任务不会脱离长期目标
13. As a 居家用户, I want 获得由徒手、计时、保持和左右侧任务组成的计划, so that 无器械也能完整训练
14. As a 健身房用户, I want 计划包含精确 Exercise Variant、组数、次数范围、负荷、目标 RIR 和休息, so that 可以进行结构化增肌或增力训练
15. As a 用户, I want 看到训练日、自由有氧日和休息日的不同安排, so that 非力量训练日不会出现错误的空任务列表
16. As a 用户, I want 查看计划选择动作和参数的依据、缺失信息与不确定性, so that 计划不是黑箱
17. As a 用户, I want 新增、编辑、删除、排序和替换计划动作, so that 计划能够响应现实变化
18. As a 用户, I want 从动作库选择精确变式、器材和设置, so that 近邻动作不会被错误合并
19. As a 用户, I want 创建具有独立身份和记录方式的自定义动作, so that 未收录动作也能进入计划和历史
20. As a 用户, I want 锁定动作、训练日或关键参数, so that Agent 不会越过我明确保留的内容
21. As a 用户, I want 查看每次计划修改的 before/after、依据、版本与执行者, so that 当前计划可以追溯
22. As a 用户, I want 恢复到旧计划的等效状态, so that 不满意的修改可以通过补偿 revision 撤销
23. As a 用户, I want 时间、地点、器材或日程变化时获得保持 Stimulus Contract 的 typed diff, so that 临时变化不会破坏训练意图
24. As a 用户, I want 数据不足或冲突时看到 hold, so that 系统不会为了显得智能而编造精确计划

### Today、Calendar 与 Progress

25. As a 用户, I want 首页第一眼看到唯一的今日安排主卡, so that 可以直接执行而不是先聊天
26. As a 用户, I want 今日卡使用固定高度的 Plan Summary 与可滚动 Task List, so that 动作数量不会撑破布局
27. As a 休息日用户, I want 看到简洁的恢复日状态和记录入口, so that 没有训练任务时页面仍然有意义
28. As a 自由活动日用户, I want 记录跑步、骑行、散步或其他活动, so that 计划外活动也成为事实
29. As a 用户, I want 在首页顶部看到简洁的 Coach 动态提示, so that 待确认、已执行和可撤销行为不会被埋在聊天中
30. As a 用户, I want 从 Coach 动态直接确认、查看或撤销, so that 简单决策不需要重新经过自然语言理解
31. As a 用户, I want 在今日卡下方看到当天真实经历的有序投影, so that 计划与实际发生内容不会混淆
32. As a 用户, I want 快速声明时间不足、器材不可用、疲劳或疼痛, so that 常见调整不需要写长消息
33. As a 用户, I want 在周视图查看当前周计划和完成状态, so that 可以安排短期训练
34. As a 用户, I want 在月视图查看整月计划、休息日和有记录的日期, so that 可以理解长期节奏
35. As a 用户, I want 选择任意日期查看该日计划和真实事件顺序, so that 日期关联不会把计划和事实混成同一对象
36. As a 用户, I want 区分 Planned、Completed、Skipped、Rescheduled 和 Unplanned, so that 日历不会把未来计划当作完成事实
37. As a 用户, I want 移动训练时看到对周量和恢复间隔的影响, so that 改日期不是简单拖动文本
38. As a 用户, I want 查看体重、体脂、围度、训练表现和完成趋势, so that 长期目标不由单一指标决定
39. As a 用户, I want 查看目标预计完成时间及其不确定范围, so that 预测不会伪装成承诺
40. As a 用户, I want 查看预测所用事实、规则版本和缺失数据, so that 可以补录或纠正

### 训练执行与监控

41. As a 用户, I want 开始训练时选择 Coach 监控或仅记录模式, so that 相机不是强制要求
42. As a 用户, I want 在训练任意阶段开启或退出监控, so that 能适应健身房环境和隐私变化
43. As a 摄像头用户, I want 在动作前看到精确机位与入框引导, so that 不会录制不可用数据
44. As a 用户, I want 看到当前 Exercise Variant 支持计数、只支持观察还是不支持视觉分析, so that 动作库覆盖不会被误解为视觉能力覆盖
45. As a 用户, I want 已支持动作使用 canonical packet 显示确认次数、阶段与可解释 finding, so that 实时与复盘使用同一证据
46. As a 用户, I want 不支持的动作仍能手工记录重量、次数、时间和 RIR, so that 计划覆盖不受视觉白名单限制
47. As a 用户, I want 区分目标值、下一安全边界待执行值和实际完成值, so that 调整不会重写历史
48. As a 用户, I want 在组间修改下一组的动作、重量、次数、RIR 目标和休息, so that 训练可以响应真实表现
49. As a 用户, I want 当前组只接受停止、跳过和安全提示, so that 执行中的处方不会半组变化
50. As a 用户, I want 跳过、重排或增加动作并记录原因, so that 器材占用不会阻断训练
51. As a 用户, I want 组后确认或修正实际次数、重量和主观 RIR, so that 摄像头事实与用户事实能够并存
52. As a 用户, I want 查看 confirmed、needs-review 和 rejected candidate 的不同处理, so that 不可靠观测不会自动进入正式训练量
53. As a 用户, I want 使用组间休息计时和下一组预览, so that 专业训练不依赖另一个计时器
54. As a 用户, I want 在训练中通过文本或语音与 Coach 沟通体感, so that 无需退出摄像头或记录页面
55. As a 用户, I want 组后看到 Set Summary 和至多一张下一组决策卡, so that 建议不会堆成卡片墙
56. As a 用户, I want 中断、切后台或重启后恢复未完成 WorkoutSession, so that 本地训练不会因生命周期事件丢失
57. As a 用户, I want 结束训练后看到完成情况、证据覆盖、主观反馈和下一次 Proposal, so that 当日结果进入后续闭环
58. As a 用户, I want 报告疼痛后立即停止受影响路径, so that Recovery 或托管权限不能覆盖安全事实

### Coach 抽屉、Stream、Artifact 与 HITL

59. As a 用户, I want Coach 从现有底部入口以气泡扩展到约四分之五屏, so that 仍能感知当前页面上下文
60. As a 用户, I want 收起和重新展开抽屉后保留对话、卡片和等待选择, so that 关闭 UI 不等于结束 CoachSession
61. As a 用户, I want 在 Today、Calendar、Progress 和 Workout 中使用上下文 Coach, so that 不必反复解释正在查看的对象
62. As a 用户, I want “我的”页面不显示常驻 Agent 输入框, so that 个人配置不被无关操作遮挡
63. As a 用户, I want 训练中的 Coach 抽屉叠在摄像头或记录页上, so that 可以实时沟通而不切换模式
64. As a 用户, I want Tool 执行显示读取、计算、等待确认、完成或失败状态, so that 知道系统是否真的修改了内容
65. As a 用户, I want Agent 输出计划、建议、进展、依据、报告与回执的固定卡片, so that 业务信息不只存在于自然语言
66. As a 用户, I want 同一个 Artifact 的 Presentation 原位更新, so that 不会出现重复 loading、proposal 和 result 卡
67. As a 用户, I want stale Proposal 保持可见但禁止提交, so that 旧事实不会修改新计划
68. As a 用户, I want 从 stale 卡片显式重新计算, so that 新旧 Artifact 的因果关系可以追溯
69. As a 用户, I want 卡片按钮直接执行确定性动作, so that 应用、撤销和保持不会被 LLM 误解
70. As a 用户, I want 只有解释、补充信息和多轮推理进入对话, so that 操作和聊天职责清楚
71. As a 用户, I want HITL 请求在切页、收起抽屉或重启后恢复, so that 等待状态不是临时 UI
72. As a 用户, I want 每次回复最多出现一张主要决策卡与折叠依据, so that 决策焦点清晰

### Timeline、Action Log 与 Working Memory

73. As a 用户, I want 每天默认拥有 Timeline, so that 训练日和休息日都能保存真实经历
74. As a 用户, I want Timeline 汇聚训练、活动、饮食、睡眠、身体状态和恢复, so that Coach 能使用完整日常事实
75. As a 用户, I want 每条 Timeline 事件显示时间、来源和估计或确认状态, so that 不同证据不会被压成无来源分数
76. As a 用户, I want 用文字、语音、表单或照片创建待确认记录, so that 记录成本足够低
77. As a 用户, I want 外部数据或 Agent 推断先成为 Timeline Draft, so that 不确定内容不会直接成为事实
78. As a 用户, I want 系统识别并合并重复训练或活动来源, so that 不会重复累计负荷
79. As a 用户, I want 更正事实时保留旧值、来源和更正记录, so that 历史不会被静默改写
80. As a 用户, I want 查看 Agent 的重要读取、判断、Proposal 和写入, so that 每次有意义的操作都有来路
81. As a 用户, I want 写操作显示 before/after、证据、作用域、执行者和规则版本, so that 可以审计
82. As a 用户, I want 撤销产生新的补偿记录而不删除旧操作, so that 同步与历史保持一致
83. As a 用户, I want 筛选全部操作和有变更操作, so that 技术读取不会淹没重要行为
84. As a 用户, I want 查看 Coach 记住了什么, so that 长期个性化不是隐藏黑箱
85. As a 用户, I want 修改、删除或固定 WorkingMemoryItem, so that Agent 不能覆盖我明确确认的偏好
86. As a 用户, I want 推断和策略笔记明确区别于 Profile、Timeline 和 Plan 事实, so that Working Memory 不会静默成为处方依据
87. As a 用户, I want Agent 把有价值的推断作为 Profile 或 Timeline 更新 Proposal, so that 事实升级经过 typed action

### 本地、Provider、同步与跨平台

88. As a 离线用户, I want 无网络时仍可读取计划、记录事实、应用本地 Proposal、查看卡片和撤销, so that 本地版本不是缓存壳
89. As a 用户, I want 远程 LLM 不可用时降级到本地模型或确定性解释, so that 计划和安全逻辑不被 Provider 故障阻断
90. As a 用户, I want 远程 LLM 获得任务所需的完整训练、身体、饮食、睡眠、Timeline 与经历语义, so that 输出不会因隐藏领域事实而失真
91. As a 用户, I want 姓名、地址、联系方式、精确位置和外部账户 ID 在发送前去标识, so that 直接身份信息不离开本机
92. As a 用户, I want 查看当前 Provider、发送上下文清单与其数据策略, so that 可以理解远程推理边界
93. As a 用户, I want 云同步是可选 Adapter 而不是事实裁判, so that 本地计划在断网时仍可执行
94. As a 多设备用户, I want 同步冲突阻止旧 Proposal 覆盖新 revision, so that 设备间不会静默丢数据
95. As a 用户, I want 导出、备份和恢复本地事实及审计记录, so that 设备损坏不会永久丢失历史
96. As an iOS 用户, I want 与 Android 获得相同领域行为、计划结果和卡片协议, so that 平台差异不改变 Coach 决策

## Implementation Decisions

### 架构权威与覆盖关系

- 本 Spec 是 Agent Coach 客户端架构的实现权威。旧研究文档仍作为规则与证据来源，但下列新决定覆盖旧设计：
  - `CoachKernel` 改为纯确定性领域模块，只读取事实快照并返回 Decision/Domain Change，不调用 LLM、不持久化、不承担审计或通知。
  - `ActionBroker` 是全部 UI、Agent、Recipe 和卡片写操作的唯一应用层入口。
  - `CoachLedger.commit(AtomicCommit)` 是唯一原子持久化提交 seam；Tool SDK 的 before/after hooks 不得成为权限、事务或审计安全边界。
  - 不实现 Cloud Agent 或服务端 Tool execution；云端只允许作为可替换 LLM Provider 或未来 Sync Adapter。
  - 远程 Provider 接收任务相关的完整领域语义；身体、训练、饮食、睡眠和经历不按类别删减。仅去除直接身份标识；历史超出上下文窗口时使用带 FactRef 的分层压缩与按需读取。
- `CoachApplication` 是 UI 和高层测试唯一公开 Facade。UI 不分别调用 AgentRuntime、ActionBroker、CoachKernel 或具体 Store。

### 深模块、Ports 与依赖注入

- 共享 TypeScript Composition Root 是唯一知道具体 Adapter 的位置。iOS 和 Android 只提供平台 Adapter，不分别组装业务规则。
- 深模块为：`CoachApplication`、`AgentRuntime`、`ActionBroker`、`CoachKernel`、`ContextAssembler`、`MemoryCurator` 与 Motion Runtime Bridge。
- `PolicyGate` 是无副作用的权限、风险与安全策略；它不记录审计、不通知、不提交事实。
- 稳定 Port 最小化为：`CoachLedger`、`LLMProvider`、`MotionRuntime`、`HealthDataPort`、`NotificationPort`、`SyncPort` 与 `MediaBlobStore`。Clock、ID 和 token primitives 作为组合后的 deterministic runtime services 注入，不使用隐式全局时间或随机数。
- 不为每条规则、每个实体 Repository、每种卡片或每个平台建立公开 interface。纯领域函数、PolicyGate、Artifact 值对象、Plan diff 和 Card renderer registry 不 interface 化。
- Provider SDK 类型只存在于 LLM Adapter；AI SDK 类型只存在于 UI Stream Adapter；SQLite 类型只存在于 SQLite Adapter；MediaPipe、RTMPose、ONNX 和平台相机类型只存在于 Motion/Media Adapter。

### 领域所有权与术语

- `CoachSession` 是交互容器，拥有 messages、CoachRun、ToolCall、Artifact/Presentation refs 和 PendingHumanAction。生命周期为 `active → suspended → completed → archived`；系统允许零个或至多一个 active CoachSession。
- `CoachRun` 是一次可 stream、suspend 和 resume 的 Agent 执行；恢复复用 runId，但 transport stream 可以更新。
- `WorkoutSession`、`SessionPrescription`、`SessionOutcome` 和 `SetOutcome` 是训练领域事实，不属于 CoachSession。
- `UserProfile`、`GoalContract`、`CoachingMandate`、`Timeline`、`PlanRevision`、`WorkoutSession` 和 canonical evidence 是权威事实。Proposal、Assessment、聊天文字和 Working Memory 不是事实。
- 事实读取优先级固定为：权威事实与 canonical evidence → active constraints/locks → Working Memory → 当前对话。
- `Activity Log` 只作为“记录活动”的 UI 动作名称，不建立第二个持久化事实模型。真实经历进入 Timeline；系统操作进入 Action Log；底层 Provider/tool telemetry 进入内部 Tool Audit。
- `Artifact` 是不可变、版本化、typed 的可信输出；`Presentation` 只保存它在某个页面、消息或 slot 中的显示状态。Presentation 状态变化不得改写 Artifact payload。

### 本地持久化与原子提交

- `CoachLedger` 统一本地数据库的原子提交边界，但不同聚合仍保持独立 revision 和生命周期。
- `AtomicCommit` 必须能在一个事务中提交 expected aggregate revisions、domain/session/memory/presentation events、一个 ActionEvent、一次性 ActionToken 消费和必要的 outbox 条目；全部成功或全部失败。
- 计划写入使用 optimistic concurrency。HITL suspend 期间不持有事务或写锁；恢复时重读事实并校验 expected revisions。
- stale Proposal 保持可见、禁止应用；显式重新计算产生新的 linked Artifact，不能覆盖旧 Proposal。
- 每个写命令具有 actor、deviceId、idempotencyKey、expected revision、mandate revision、reason、causationId 和 correlationId。重复调用返回同一结果，不生成重复事实或通知。
- Action Log append-only。撤销创建补偿 PlanRevision/DomainEvent 和新的 ActionEvent，不删除或篡改历史。
- 媒体、原始视频和完整 packet 流进入 MediaBlobStore，通过 content hash 与 ledger 事实关联。

### Working Memory

- Working Memory 跨 CoachSession 持久化，但永远不是确定性规则的事实来源。
- 每个 WorkingMemoryItem 至少拥有 kind、content、evidenceRefs、provenance、confidence、version、createdByRunId、expiry、supersession、sensitivity、pinnedByUser 和 userEdited 标识。
- MemoryCurator 提供 upsert、supersede、forget、compact 和 propose-promotion 等高层意图。LLM 只能提议，最终写入由本地策略校验。
- 用户编辑或固定的内容 Agent 不得覆盖；Agent 可以新增解释或提出 supersede Proposal。
- 将 Memory 升级为 Profile/Timeline 事实必须经过 typed Proposal、ActionBroker 和 Action Log。

### LLM Provider 与 Context

- Agent Runtime、Tool loop、Tool execution、Policy、事实提交和 Action Log 全部在本地。远程端只实现 `LLMProvider`。
- ContextAssembler 组装完整任务相关领域上下文；不得因为数据属于身体、饮食、睡眠或历史经历就删除。
- 发送前必须去除或稳定假名化姓名、地址、联系方式、精确位置和外部账户 ID，并生成可审计的 context manifest 与 redaction version。
- 上下文超窗时，确定性地生成带 FactRef、时间范围和缺失说明的层级摘要；Agent 可以通过只读 Tool 获取原始相关片段。压缩不得把 unknown 变成推断事实。
- 原始媒体和完整 packet 仅在当前任务确实需要并具有明确用户授权时作为 provider input；发送必须出现在 context manifest 中。
- 替换 Provider 不得改变 CoachKernel 的 proposal、PlanRevision、ActionEvent 或 Artifact hash。Provider 只影响意图解析和自然语言表达。

### Tool、Stream 与 Card Registry

- Agent 只看到注册的高层 typed Tool。Tool schema 使用封闭 union、枚举 ID、单位校验、`additionalProperties: false` 和输出大小限制；不提供 SQL、任意 JSON Patch、任意卡片 JSON、任意 URL handler 或 canonical packet 解码工具。
- Tool input delta 在 schema 完成验证前只能显示通用 loading，不得提前渲染重量、次数、恢复状态等业务事实。
- Tool 的可信结果是 immutable `artifactRef` 或结构化只读结果。UI Stream Adapter 把 canonical CoachRunEvent 投影为 AI SDK 风格 tool/data part；AI SDK UIMessage 不是 Session 或事实存储。
- 同一 toolCallId、presentationId 和 artifactId 的状态原位 reconciliate。重新计算产生新 artifactId；applied、rejected、stale、undone 更新 Presentation。
- 首批必须可渲染的 Artifact：TodayPlan、PlanChangeProposal、SetSummary、RecoveryBrief、ActionReceipt。第一交付切片实际接通 TodayPlan、PlanChangeProposal 和 ActionReceipt；SetSummary、RecoveryBrief 先完成协议与 fallback renderer。
- `data-live-cue` 是 transient presentation，不进入对话历史；组结束后 seal 为稳定 SetSummary Artifact。
- 一次 Agent 回复最多有一张需要用户决策的卡；只读摘要与依据卡可折叠展示。
- 未知 schema/version 使用安全 fallback card，展示类型、版本、状态和不可操作提示，不崩溃也不猜测字段。

### Human-in-the-loop 与权限

- 确定性卡片动作直接调用 ActionBroker，不重新经过 LLM。询问原因、要求替代或继续讨论才创建新的 CoachRun。
- 只有 Agent 必须等待用户输入才能继续推理时才 suspend/resume；普通 Proposal 可以独立 pending，不阻塞只读对话。
- ActionToken 是本地一次性能力，绑定 user、CoachSession、run、toolCall、artifact/version、allowed action、expected Plan/Mandate revision、expiry 和 nonce，并在 AtomicCommit 中消费。
- 权限模式为记录、协作和托管，并由 versioned CoachingMandate 细分 load/reps、volume、exercise substitution、schedule、deload 和 nutrition scope、limits、locks 与有效期。
- 模式降级立即生效。未提交 Proposal 保留但不再允许自动提交。
- Safety hold、目标变更、用户锁、trajectory calibration 和越过 mandate limits 的修改不能因为托管模式而静默执行。

### Timeline、计划与运动证据

- Timeline 记录每天真实发生的训练、活动、饮食、睡眠、身体和休息事件，保留时间、来源、provenance、confidence 和 correction chain。未来计划和 Agent 推理不得进入 Timeline。
- Planned、performed 和 observed 永不互相覆盖。用户更正与 canonical observation 可以共存；projection 可优先显示用户修正，但证据不删除。
- 当前 WorkoutSession 的 SessionPrescription 在执行时冻结；普通修改仅在下一安全边界应用。当前 set 只能停止、跳过或 safety hold。
- Rust canonical packet 是 rendering、recording、rep boundary 与轨迹证据的唯一运动事实来源。只有 Confirmed rep 进入 camera-confirmed formal volume；Needs-review 在用户批准前排除；Rejected 永远排除。
- 无 exact executable profile 的动作不得从摄像头生成 rep、phase、form 或 correctness。用户仍可手工记录实际完成。
- 骨架不能推断实际重量、RIR、肌肉激活、疼痛原因、真实三维关节状态或伤害风险，也不能单独触发加重。

### Coach 规则边界

- 计划合成优先级固定为：疼痛与安全 → Goal/Mandate/locks → 器材、地点、日程与时间 → RecoveryConstraint → mesocycle 与 weekly stimulus → Exercise-specific performance → preference、continuity 与 novelty。
- Recovery 只输出 typed RecoveryConstraint，不直接输出 sets、reps、load 或具体动作；CoachKernel 根据 constraint 与训练规则生成 Proposal。
- 单日良好 Recovery 不自动增加重量、组数或频率；单日低 Recovery 或单一 HRV 不自动取消整个周期。
- 增肌规则分离 PerformanceProgression 与 VolumeProgression；一次主要推进一个变量；周量变化受 mandate 限制；deload 与 rule-pack digest 版本化。
- 具体营养、碳循环和长期热量调整需要独立规则 Spec；本切片只预留 scope、Timeline 数据和 Artifact 类型。

### 客户端 UI 集成与第一交付切片

- Agent 抽屉只在 Today、Calendar、Progress 和 Workout 上下文提供；Me/Profile 不显示常驻 Agent 输入入口。
- 抽屉从底部操作入口连续扩展到约四分之五屏，保持页面背景和上下文感知；不是跳转到独立聊天页。
- CoachSession 可以跨支持页面持续存在，但每个 Run 和 Artifact 保存其原始 context refs，切页不能静默重解释旧卡片。
- 第一交付切片包含：共享 Composition Root；CoachApplication Facade；In-memory 与基础 SQLite CoachLedger；Scripted 与现有远程 LLM Provider Adapter；CoachSession/Run persistence；Working Memory；ActionBroker/PolicyGate/CoachKernel；AI SDK 风格 stream projection；Artifact/Card Registry；TodayPlan → PlanChangeProposal → apply/reject/stale/undo → ActionReceipt 闭环；独立且可复用的 Agent 抽屉客户端演示面。
- 第一切片使用确定性种子事实和保守本地 rule fixture 验证行为，不声称已交付完整自动训练算法。后续 progression、recovery、nutrition 和 sync tickets 在同一 seam 上加入。
- iOS 与 Android 使用同一 TypeScript domain/application/UI contract；平台差异只通过 Adapter 和原生 bridge 注入。
- 本轮 ContextAssembler 交付可测试的 fixture/stub 级语义组装、身份脱敏 contract 和 context manifest；生产级长历史分层压缩、token 优化与按需检索属于后续实现。
- 本轮 MotionRuntime 交付稳定 Port、FixtureAdapter、canonical event bridge contract 与 SetSummary 演示闭环；生产 Adapter 未来包装现有原生 capture/JNI 主循环，本轮不重写或替换该管线。
- 本轮 iOS/Android parity 交付共享代码与 fixture contract parity，不宣称完成 iOS 真机客户端集成或构建验收。
- 当前工作区包含用户未提交的 capture、motion、原生和依赖改动。实施必须保留这些改动，优先新增隔离模块；现有应用入口与 capture 主循环保持不变。确需修改重叠文件时必须先检查 diff 并做最小合并，禁止覆盖或回退用户内容。

## Testing Decisions

- 好测试只观察公开行为，不断言内部函数调用、私有状态、SQLite 表形状、Provider SDK chunk 或 React 组件实现细节。
- 唯一主要产品 seam 是 `CoachApplication`。场景测试通过它创建/恢复 CoachSession、发送用户输入、推送事实或 motion observation、消费 CoachRunEvents、执行卡片动作并读取 projection。
- 主 seam 测试注入 InMemoryCoachLedger、ScriptedLLMProvider、FixtureMotionRuntime、Fake Health/Clock/ID/Token/Sync，断言 Artifact、Timeline/Plan revisions、Working Memory、ActionEvents 和可观察 stream 状态。
- `CoachKernel` 的确定性 rule pack保留少量 golden/property tests；不为内部每条规则建立镜像单测。
- AI SDK Stream Adapter 使用 contract tests：同一 canonical CoachRunEvent 序列必须得到相同 tool/data part 生命周期、原位 reconciliation 和 fallback renderer；不在这些测试中验证 LLM 内容质量。
- SQLite/In-memory CoachLedger 运行同一 conformance suite，覆盖 atomic commit、CAS、idempotency、token single-use、restart/replay、migration 和 crash point。
- 远程/Scripted LLMProvider、native/Fixture MotionRuntime 和 platform/fake adapters 运行各自最小 contract suite；Adapter 只能翻译和传输，不能改变领域结果。
- 复用仓库现有“最高 seam + fixture replay”先例：canonical packet、CaptureStore、mobile data layer 和 Rust/WASM/native parity。Agent Spec 不重复测试姿态算法内部数学。
- 必测场景：
  - Local-only 模式除显式配置的远程 LLM Provider 外网络调用为零；Provider 故障仍能读取计划、应用本地规则、记录和撤销。
  - 替换 LLMProvider 不改变 Proposal、PlanRevision、ActionEvent 或 Artifact hash。
  - managed/collaborative/manual 与每个 scoped limit 的行为正确；safety hold 不能被 LLM、良好 Recovery 或托管绕过。
  - HITL suspend 后切页、收起抽屉和重启仍可恢复；pending HITL 不持有写锁，也不阻塞只读 Run。
  - ActionToken 只能消费一次；重放、过期、artifact 版本错误、Plan/Mandate revision 变化均被拒绝。
  - stale Proposal 保留但不可应用；recompute 创建 linked 新 Artifact。
  - apply Proposal 在一个事务中提交 PlanRevision、Presentation status、ActionEvent 和 token consumption；任一失败不显示成功回执。
  - undo 生成补偿 revision 和新 ActionEvent，原历史仍可查询。
  - Working Memory 跨 CoachSession 持久化；用户编辑/固定后 Agent 不覆盖；Memory 不能直接改变事实或规则输出。
  - Timeline draft、确认、更正和多来源去重保留 provenance；计划不进入 Timeline。
  - confirmed/needs-review/rejected 与 Tier 2/profile code 0 的 formal-volume gate 永不破坏。
  - 当前 WorkoutSession 不被新 PlanRevision 改写；next-set 修改只在下一安全边界生效。
  - iOS/Android/in-memory 对相同 fact frontier、rule/catalog versions 和 command 产生相同结构化结果。
  - Prompt injection、任意 patch、虚构 ID、非法单位、额外字段和越权 ToolCall 被 schema 或 PolicyGate 拒绝。

## Out of Scope

- 生产 Cloud Agent、服务端 Tool execution 或服务端成为第二套计划真值。
- 生产多设备同步后端、端到端加密、密钥恢复与完整冲突解决 UI；本轮只定义 SyncPort、Disabled/In-memory Adapter 与冲突契约。
- HealthKit、Health Connect、wearable、日历和生产通知 Adapter；本轮使用 Port 与 fake/manual inputs。
- 完整端侧 LLM 模型包下载、量化、内存性能、多语言与 tool-call 正确率交付。
- 完整营养处方、碳循环、生酮、食谱、食物照片与医疗营养规则；本轮只预留事实、权限和 Artifact scope。
- Superset、circuit、drop set、AMRAP 等全部高级 set-style 自动调整；第一切片以 straight sets 和清晰安全边界为准。
- 新增、训练或校准 Rust recognition profile；修改 canonical packet、rep segmentation、trajectory 或既有 motion roadmap。
- 从 2D pose 推断负重、RIR、肌肉激活、疼痛原因、伤病、睡眠障碍、过度训练或真实三维 biomechanics。
- 医疗诊断、康复处方、未成年人、孕产期、进食障碍或复杂疾病的自动计划。
- 开放用户脚本、任意循环、SQL、数据库浏览、任意 JSON Patch 或模型生成 renderer。
- 社区、课程市场、排行榜、真人教练后台、多学员权限或教练市场。
- 复制 RP、Fitbod、WHOOP 的未公开阈值或 Recovery 百分比。
- 在自有专家 shadow plan、4/8/12 周研究前承诺 Agent 优于标准计划、提升表现或预防伤害。

## Further Notes

- 视觉与交互参考继续以现有 Agent Coach prototype 为准，但原型中的“技术评分”“动作稳定 86%”“骨架推断 RIR”等 mock 表达不属于验收事实，必须替换成可审计的观测覆盖、confirmed reps、用户报告或 unknown。
- 本 Spec 的 `Complete context` 指完成当前任务所需的完整领域语义上下文，不等于无条件发送整个数据库、直接身份信息或所有媒体 bytes。
- `CoachApplication` 通过 deletion test：若删除它，Session/HITL、Tool/Artifact、Policy/Action、Memory/Context 和 UI stream 编排会重新散落到页面与平台代码中。
- `CoachLedger` 通过 deletion test：若删除它，跨 aggregate 原子性、CAS、ActionToken、ActionLog、idempotency 和 restart replay 会重新散落到 Store 与应用服务中。
- 第一交付切片完成后，再通过独立 tickets 扩展完整 workout generation、hypertrophy progression、recovery interpreter、nutrition coordination、health platform 和 sync；这些扩展不得增加第二套事实或第二个写入口。
