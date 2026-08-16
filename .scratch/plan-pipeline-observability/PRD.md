Status: wontfix

Remaining unfinished work is replaced by `.scratch/record-first-adaptive-coach/PRD.md`. Tickets already marked done remain historical evidence, not compatibility requirements.

# 计划流水线与全行为可观测性：planner 知识驱动改造 + trace 系统

> 来源：2026-08-10/11 设计拷问共识（两轮 grilling + 后续确认）、`docs/research/2026-08-09-fitness-coach-knowledge-domains.md`、`docs/research/2026-08-11-agent-observability-paradigms.md`、`docs/wiki/training-programming.md`（TP-* 规则）
> 遵循：ADR 0001（本地 Coach 拥有决策与事实）、ADR 0002（云端拥有已确认产品资源）、`CONTEXT.md` 全部不变量。

## Problem Statement

用户实测：planner 生成的训练计划不像教练排的——75 分钟的训练时间只排了 3 个动作各 2 组 6-12 下，肌群每周只练一次，组间休息写死，填写的时间与力量数据对输出毫无影响。根因有二：完成的训练记录永远到不了 planner（数据断桥），session 生成器是不消费知识规则的静态模板表。同时，agent 的一切行为（对话、工具、规划、过滤、后台任务）没有统一可观测链路——用户报错时无法在云端按 id 追踪，本地也无法回看"agent 为什么这么推理"。

## Solution

两条主线一次做全：

**A. 全行为 trace**：统一 TraceEnvelope（traceId=runId、sessionId 关联、对齐 OTel GenAI 语义），写入端口从第一天就是双写模式——本地 JSONL 文件 sink + 可插拔远程 sink（CloudWatch/SLS/OTLP-HTTP/通用 HTTP，配置切换、绝不写死）。只发元数据与哈希假名，不发文本；独立授权项默认关；离线 outbox 补发；崩溃窗口靠账本投影 reconcile 幂等回填。用户报错的错误短码 = traceId 前 8 位 + sessionId 前 4 位，客户端与云端都能按它拉出完整推理链。

**B. planner 知识驱动改造**：修通数据断桥（完成的训练组变成 planner 的 history）；session 生成从静态模板表换成知识驱动的组装器（周量目标 → 频率分化轮转 → 完整推荐 + 时长估算 → 逐动作安排，每步挂知识包规则；时间不强制裁剪）；首课计划统一走 Proposal + 确认，用户的修改成为水平证据；组间休息给目标区间、用动作识别时间戳实测、偏离时提醒不强制；每次规划产出 PlannerTrace（推理链 artifact），无 trace 不提交。

术语清理：全库"处方/prescription"改为正常"训练计划"语言（expand-contract 改名，注释/文档/用户文本先行）。

## User Stories

### Trace 系统

1. As a 开发者, I want agent 的每次行动（对话轮次、工具调用、策略决策、规划、过滤、后台任务）都产生结构化 trace 事件, so that 任何行为都能被追踪
2. As a 开发者, I want trace 事件同时写本地 JSONL 文件和远程日志服务（可配置）, so that 本地调试与云端分析都不缺数据
3. As a 开发者, I want 远程 sink 是适配器端口（CloudWatch/SLS/OTLP-HTTP/通用 HTTP 可配置切换）, so that 面向海外部署时换供应商不改代码
4. As a 用户, I want trace 上报需要我显式授权且默认关闭, so that 我的诊断数据不被静默上传
5. As a 用户, I want trace 只含元数据与假名引用、绝不含我的对话文本, so that 隐私不被诊断功能侵蚀
6. As a 用户, I want 报错时得到一个短码（traceId 前 8 位 + sessionId 前 4 位）, so that 支持方能按它找到完整行为链
7. As a 开发者, I want 断网时 trace 进本地 outbox、恢复后补发且按 eventId 去重, so that 离线优先不丢诊断数据
8. As a 开发者, I want 崩溃丢失的 trace 事件在启动时从账本投影幂等回填, so that 已提交事实的 trace 链完整
9. As a 开发者, I want 日志写失败只计数不阻断业务, so that 可观测性不会成为故障源
10. As a 开发者, I want trace 事件的 kind 分类对齐业界（agent/turn/llm/tool/guardrail/evaluator/plan/recipe/sync）, so that 检索习惯与 OTel/OpenInference 一致
11. As a 开发者, I want 嵌套 trace 有稳定排序键（dotted_order 式）, so that 回填与乱序事件的回放顺序确定

### Planner 数据桥

12. As a 用户, I want 我完成的每组训练（重量/次数/RIR）成为后续计划的历史依据, so that 计划按我的真实表现进阶而不是永远从空白开始
13. As a 用户, I want 完成训练后计划能随之更新（有实质变化才出新版）, so that 我的努力被计划看见
14. As a 用户, I want 过期的恢复约束不再永久压低我的训练量, so that 恢复后的训练安排恢复正常
15. As a 用户, I want 没开始的训练课也算缺席（不只算开始了又放弃的）, so that 计划知道我真实的出勤

### Session 组装器

16. As a 用户, I want 计划按周量目标排（增肌每肌群每周 4-8 直接组起步）, so that 训练量符合证据而不是随手写
17. As a 用户, I want 每周练 2-3 天时是全身训练（每肌群每周至少两次）, so that 频率符合 ACSM 证据
18. As a 用户, I want 计划按我的可用时间给出推荐方案与预计时长（估算）而不是被时间强制裁剪, so that 训练内容由我的目标决定、时间只是参考
19. As a 用户, I want 时间明显不够时能在完整版/精简版之间自己选, so that 取舍是我做的而不是系统替我做的
19. As a 用户, I want 组数/次数/休息按我的目标与经验查知识规则得出, so that 计划像教练开的而不是模板印的
20. As a 用户, I want 我的力量数据影响负荷锚定与起始量, so that 我填的表不是白填

### Proposal 化与水平推断

21. As a 用户, I want 首课计划是提案、我确认后才生效, so that 错误的计划不会擅自成为我的安排
22. As a 有经验的用户, I want 确认前能修改动作/组数/负荷, so that 计划从第一天就贴合我
23. As a 用户, I want 托管模式下首课自动生效但可撤销, so that 我不想要确认弹窗时也不被错误计划坑
24. As a 用户, I want agent 从我的修改和早期表现判断我的水平并据此调整后续计划, so that 计划越用越懂我

### 实测休息

25. As a 用户, I want 组间休息按我的真实动作时间记录（上一组最后一次识别到下一组第一次识别）, so that 休息评估基于事实不是估计
26. As a 用户, I want 休息超时收到继续提醒, so that 训练节奏不垮
27. As a 用户, I want 系统分析我的休息偏长还是偏短并纳入计划调整依据, so that 计划考虑我的真实节奏

### 可观测的规划

28. As a 开发者, I want 每次规划产出 PlannerTrace（输入钉、逐 slot 推理、约束事件、周量账本、结果与 diff）, so that 任何一份计划都能解释"为什么"
29. As a 开发者, I want 无 trace 的计划不允许提交, so that 可观测性是不变量不是装饰
30. As a 开发者, I want 同一输入指纹必出同一计划（确定性回放）, so that 错误结果永远可复现排查

## Implementation Decisions

### Trace 系统（写入与读取分离；本 spec 只做写入，读取器另立项）

- **统一事件模型 TraceEnvelope**：字段 `schemaVersion / traceId(=runId) / sessionId / parentTraceId? / kind / occurredAt / actor / outcome? / decisionCodes[] / artifactRefs[] / factRefs[] / durationMs? / metadata{string|number|boolean} / orderKey`（嵌套排序键，dotted_order 式）。kind 闭集：`agent / turn / llm / tool / guardrail / evaluator / plan / recipe / sync / error`。事件 id = stableHash(内容)（幂等去重）。
- **写入端口与双写**：`TraceSink` 端口；生产路径经 TraceRecorder 扇出——`LocalFileTraceSink`（JSONL，debug 开关控制，5MB 轮转保留 5 个）+ `RemoteTraceSink` 适配器（CloudWatchLogs / AliyunSLS / OTLP-HTTP / GenericHTTP，**部署配置选择，运行时无感，绝不写死**）。写入失败只计数不阻断。
- **隐私**：事件只含元数据与引用；假名用现有 userPseudonym 哈希；独立 `observability` 授权项（默认关，remoteLlm 授权是前提）；多设备 envelope 带 deviceId 防撞号。
- **可靠性**：先落账后写 trace（事件描述已提交事实）；启动 reconcile 从账本投影幂等回填崩溃窗口；远程 sink 走账本内 outbox（复用 pendingEnvelope 模式），重启不丢、at-least-once、服务端按 eventId 去重；退后台前在 catchUp 周期 flush。
- **字段命名对齐 OTel GenAI**（`gen_ai.conversation.id` 语义映射 sessionId；span kind 映射我们的 kind 闭集），不接 OTel SDK、不上 OTLP 协议栈——将来要接 Tempo/Collector 只加映射 sink。

### Planner 改造

- **数据桥**：`completeWorkoutSession` 把 user_confirmed 的组逐条写成 timeline `historicalSet` 事实（ledger 校验与 product 投影已支持）；四个 replan 入口（completed workout / weekly review / deload ended / recovery constraint）从 workout 聚合组装 `historicalPerformance` 传入；修 `strongestRecovery` 的 1970 过期比较（改为对比 request.currentDate）；missed-session 检测对照计划表 scheduledFor（未开始也算缺席）；session_completed 语义改为"历史更新后重算，diff 非空才出新 revision"。
- **Session 组装器**（替代静态 sessionTemplates 轮换表）：
  ```text
  ① 周量目标：TP-VOL-BASE-001 分档（onboarding 经验 + 是否回归者）——增肌默认每肌群每周 4-8 直接组（默认点 6）
  ② 分化方案（轮转模板库）：2-3 天/周 → 全身；4 天 → 上下肢；4-6 天 → PPL；
     偏好时三分化轮转（胸+三头/背+二头/肩+腿）；周量按真实轮转节奏换算
  ③ 时长估算（不裁剪）：按周量目标生成完整方案 + 预计时长（标注为估算）；
     时间明显不够给档位选项（完整/精简）由用户选择，不静默砍内容
  ④ 逐动作安排：次数区间/RIR/负荷锚定从规则包与历史查得；无历史走校准语义
  ```
- **休息引导（实测时间模型）**：组间与动作切换给出休息目标区间（主项/辅助/转场分级）；用 canonical packet 的 rep 识别时间戳实测实际休息（上一组最后识别完成到下一组首次识别开始）；偏离时提醒——过长提醒继续、过短建议延长，提醒不强制、不锁屏；实测休息沉淀为个人节奏校准值（个人知识层 observed_calibration），供下次时长估算使用。
- **首课 Proposal 化**：首课计划走与计划变更相同的 Proposal→确认→提交管线（ActionBroker/PolicyGate）；用户修改（增删动作/改组数负荷/锁定）逐项记录为带 provenance 的定制 diff；托管模式自动 apply 但保留 proposal artifact + 24h undo token。
- **水平推断**：定制行为 + 早期表现 → 个人知识层条目（system_inference，带置信度与证据窗；永不直接改规则）。
- **PlannerTrace**：每次规划产出结构化推理链 artifact（输入钉/逐 slot 推理/约束事件/周量账本/结果与逐项 diff），随 PlanRevision 幂等持久化；无 trace 不提交；同一输入指纹必出同一计划。
- **术语清理**："处方/prescription"全库改为"训练计划"语言——类型级改名走 expand-contract（新别名并行 → 迁移 → 删旧），注释/文档/用户文本立即清理。

### 场景与交互模型（一个大脑，多个工作台面）

- **拓扑**：单一 AgentRuntime + CoachApplication，按场景开 task-scoped 会话（首页/规划中/realtime 训练中/复盘/onboarding/后台）——不是多个 agent。场景切换 = 新会话 + 账本衔接。
- **共享（全场景一份）**：账本（唯一事实源）、知识包与规则包版本、统一 trace 流（按 sessionId 区分场景）、安全约束（任何场景写入的停止信号全场景立即生效）。
- **隔离（场景各自）**：对话历史、工具子集与 prompt 变体、延迟预算（realtime 亚秒、其余秒级）。
- **三种动作形态**（全部走 typed action + PolicyGate + trace，无第三种写入）：
  ① 代为操作（用户明确指令："帮我记录吃了X""把A换成B"——LLM 解析，引擎校验，mandate 内执行）
  ② 主动提案（agent 发起：realtime 偏差调整、趋势异常建议——用户同意才应用）
  ③ 场景升级（用户反馈驱动："状态没变化"→ 结构化上下文触发 replan → 进入规划场景）
- **计划变更五通道，同一出口**：用户定制 / 表现驱动（双进阶/降档/周量/deload）/ 事件重排（完成训练、恢复、漏练、周复盘）/ 对话驱动（平台期反馈）/ 知识包升级（迁移提案）——全部汇成 Proposal → PolicyGate → 新 PlanRevision（immutable、逐项 diff、PlanTrace、规则版本钉）。planned/performed/observed 永不互相覆盖；任何变更可补偿式撤销。
- **场景间影响只经账本事实传播**：realtime 历史/实测休息 → 下次编排输入，周结构问题挂起至训练后规划场景；首页反馈 → replan → Proposal 回首页；复盘 artifact → 首页卡片与阶段切换提案；后台通知 deepLink 落场景会话；onboarding 数据是全场景初始输入。

### 埋点范围（A 与 B 的交汇）

provider 请求/响应、工具调用、policy 决策、输出过滤（guardrail 类）、PlannerTrace（plan 类）、proposal/HITL、recipe 后台任务、同步事件、错误——全部进统一 trace 流。

## Testing Decisions

### 什么是好测试

只测外部行为：trace 事件内容、最终计划、账本状态、推理链输出。全部确定性运行（内存账本 / ScriptedLLMProvider / fixture 动作识别时间戳 / 内存 sink），不依赖网络与真实模型。

### 接缝（已与开发者确认）

| 接缝 | 测试内容 |
|---|---|
| TraceSink 端口（新，最高点） | 事件校验、JSONL 轮转/保留、无 sink 零成本 no-op、适配器可配置切换、outbox 补发与去重 |
| CoachApplication facade + ScriptedLLMProvider | 首课 Proposal→确认/定制→提交；完成训练→history→重排出新 revision；实测休息→规则评估 |
| GoalCyclePlanner 纯函数 | 周量达标、频率分化、时间求解、逐动作安排、PlannerTrace 完整性、同指纹同计划 |
| TrainingRulePackRegistry.evaluate | 实测休息偏长/偏短判定、周量规则消费 |
| InMemoryCoachLedger / SQLite 重启 | historicalSet 写入与回放、trace reconcile 幂等回填、PlanTrace artifact 幂等 |

### 既有先例

- `tools/coach-runtime/coachSessionRuntime.test.ts`（facade + 脚本化 provider 16 场景）
- `tools/planning/goalCyclePlanner.test.ts`（planner 纯函数）
- `tools/training-rules/trainingRulePacks.test.ts`（规则包评估）
- `tools/coach-runtime/coachStateSweep.test.ts`（账本清扫与幂等模式）

## Out of Scope

- **读取 provider**（debug 日志查看器/分析工具、产品级 trace 页面）——另立项，本 spec 只做写入。
- OTel SDK / OTLP 协议栈接入（只保留字段命名对齐；接 Tempo 时加映射 sink）。
- 动作筛查（FMS 式）、结构化筛查（PAR-Q）进 onboarding、特殊人群扩展、个人知识层接引擎消费者。
- 既有 MVP 已实现内容的重构。
- eval 套件与知识工具启用门槛（`.scratch/agent-knowledge-runtime/` tickets 07/08/10，独立推进）。

## Further Notes

- 业界范式校准：`docs/research/2026-08-11-agent-observability-paradigms.md`（OTel GenAI span 分类、Langfuse 反规范化单表、LangSmith dotted_order、batch+flush 纪律——本 spec 已吸收）。
- 可靠性语义：reconcile 保证"已提交事实不漏"，孤儿清扫保证"未提交行为不留盲区"，outbox+幂等保证云端"不重不丢"。
- 刻意不做：trace 不上传文本；LLM 不产生事实；推断不直接改规则；无 trace 不提交计划。
- 术语映射（新旧）：traceId = runId（行动）; sessionId = CoachSession id（长会话）; orderKey = dotted_order 式嵌套排序键。
