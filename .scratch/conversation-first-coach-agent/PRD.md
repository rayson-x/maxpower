Status: completed — issues 01–07 accepted 2026-08-16 (tests + Web E2E); Android 真机录屏验收拆分为 issue 08

## Implementation Notes (2026-08-16)

验收后 code review 确认的 V1 取舍（有意决策，非遗漏）：

- **Run 状态词汇**：已迁移为 streaming / awaiting_user / resuming / completed / interrupted / failed（terminated、suspended 存储名已一次性移除）。更细终态（blocked_safety、insufficient_evidence、stale、failed_retryable 等）通过 `terminalCode` + 卡片状态表达，不再增加顶层 Run 状态。
- **Steer**：采用 Pi 原生 same-run steer（串行化、无并发写入）；被 steer 的消息不为它另建 Run identity。
- **Capability 收窄**：写能力按 goal / planning / record 三族动态收窄并执行时再校验；只读与知识工具刻意始终可见（只读本地事实无写入风险）。
- **Orphan Run 恢复**：V1 一律安全终态化并提供重试入口；不做 Provider continuation 续跑。
- **Conversation Item 渲染桶**：message / tool_activity / form / choice / goal_path / receipt 六桶从更细的卡片联合类型映射，Structured Result / Decision / Error Recovery 由卡片 kind 区分。
- **Working Memory 候选工具**与**历史列表待处理标记**未进 V1；Working Memory 当前由用户管理 + 确定性压缩摘要。
- **场景化 Harness**：日常 / 建档 / 规划三个入口共用同一 Pi runtime，分别注入不同 system prompt 段、工具清单与（规划场景）固定事实包。建档入口新增 `intake.request_form` 动态表单工具：字段只来自闭合注册表（`src/coach/intakeFields.ts`），全可选，Agent 按领域知识反推要收集什么。
- **云端可靠性修复**（真实 Provider E2E 中发现）：上游 45s 绝对超时改为 120s 空闲 + 15min 总上限（server openai-compatible adapter）；网关 maxOutputTokens 上限 4096 → 16384（reasoning 模型的 reasoning_content 共享 completion 预算）；客户端对"零可见内容即死"的轮次做一次幂等重试；固定校验器对模型残缺结构产出可读领域 issue（不再漏 JS TypeError）。

# Conversation-First Coach Agent

## Problem Statement

MaxPower 已有持久化 Coach session、Run、Tool Call、Artifact、Pending Human Action、Working Memory、本地 Ledger 和行为 trace，但客户端仍把 Coach 组织成依附于 Today、Plan、Workout、Profile 等页面上下文的抽屉。当前页面的 `ContextRef` 会参与选择或恢复会话，新建会话可能暂停另一条 active session，部分 Agent 卡片还承担跳转页面、打开独立表单或进入业务工作区的职责。用户看到的是聊天外观，实际使用体验仍由页面流程控制。

这不符合用户期望的 GPT/Codex 式 Agent 体验。用户希望每次从 Coach 顶层入口开始时面对一条新的空白对话；历史对话可以在历史列表中恢复和继续；新对话又不应让 Agent 失忆，因为当前 User profile、Goal contract、Timeline Records、Plan、Working Memory，以及与当前问题相关的旧对话内容仍应成为可追溯上下文。页面只能为某一轮消息提供可选附件，不能决定 Conversation identity，也不能在页面切换时替换正在进行的任务。

Agent 的能力也应属于对话本身。用户要求 Agent 读取数据、分析目标、填写记录、组织计划或提出调整时，工具选择、执行状态、结构化结果、确认请求、失败、打断和恢复都必须留在同一条会话内。卡片用于渲染 typed Tool Result 或需要用户交互的结构化内容；它不是健身页面缩略版，也不是导航入口。普通解释用消息，结构化结果用卡片，填写、选择、确认和重试是结构化卡片的交互变体。

首次建档同样不应重新成为独立页面、固定问卷或阶段状态机。建档本质上只是一个固定的 Conversation opening：当权威 User profile 尚未建立时，新对话先展示欢迎消息和 Baseline intake 表单卡；用户提交个人基础信息后，普通 Agent 接管后续交流，根据目标、已确认事实、缺失证据、知识和工具自由决定下一步提问或卡片。固定的只有开头，不存在固定的第二页、第三页或必须按顺序完成的后续清单。

当前实现具备许多可复用的底层事实和安全结构，但缺少一个高层、单一的 Conversation Module 来拥有完整用户体验。若继续在 Product shell、Drawer、Agent runtime、工具卡和页面回调之间分散编排，会再次产生“局部能力存在、真实流程没有联通”的假完成。

## Solution

建立一个本地、账户作用域的 Agent Conversation Module，作为创建对话、发送消息、打断 Run、响应结构化卡片、恢复历史会话和读取用户可见执行轨迹的唯一正式 Interface。Pi 是唯一 Agent loop；本地 Product Kernel 拥有工具执行、政策、正式事实与审计。移动客户端只调用 Conversation Module，不自行组装 Session、Run、Artifact 或 Pending Human Action。

用户从 Coach 顶层入口进入且没有显式历史 Session reference 时，客户端创建一条新的空白 Coach session。收起再展开同一会话不会创建新会话；点击“新对话”会立即创建新会话；从历史列表选择旧会话会按 Session identity 恢复原消息、结构化卡片、Run 状态、待确认动作和回执。页面切换不会创建、暂停、替换或归档会话。Today、Plan、Workout 或 Profile 只能作为某一轮消息的可选 Context attachment，帮助 Agent 理解用户在看什么。

新对话的 Agent Context 由四类信息组成，并保持不同权威等级：当前领域事实始终来自本地 Ledger；Working Memory 提供用户可查看和管理的长期偏好；旧对话通过本地检索返回与当前用户消息相关的 Conversation summary 或消息片段；当前 Conversation 的最近消息保持原文窗口。旧对话和 Working Memory 都不能覆盖权威事实，也不能因模型复述自动成为事实。上下文预算不足时，系统必须保留有语义的任务摘要和引用，不能把旧对话压缩成只有消息数量和时间的统计。

Conversation 由稳定、有序、可持久化的 Conversation Items 组成。普通用户和 Agent 语言输出使用 Message Item；Agent 执行工具时使用可折叠的 Tool Activity Item；固定工具或计算引擎返回结构化结果时使用 Structured Result Item；需要用户输入时使用 Form Item；需要用户选择或批准时使用 Decision Item；中断、过期、冲突或失败时使用 Error Recovery Item。每个 Item 都拥有稳定 identity，并在 loading、ready、awaiting_user、submitted、applied、rejected、stale、interrupted、failed 等状态之间原位更新，而不是追加互相矛盾的重复卡片。

卡片只能由版本化、闭合的客户端 Renderer Registry 渲染 typed Tool Result。LLM 可以选择已声明的工具、组织自然语言解释并提供允许范围内的结构化参数；它不能创建任意组件、决定导航、伪造计算结果、绕过输入 Schema 或直接提交领域事实。Read-only 结构化结果可以是非交互卡片；Form、Choice、Confirmation 和 Retry 是带操作的结构化卡片。卡片允许在会话内展开详情，但不得通过 Agent action 自动切换产品页面、关闭 Conversation surface 或打开另一套建档流程。

当用户在 Agent Run 进行中点击停止，Run 必须立即进入 terminal interrupted/terminated 状态，保留已显示文本、已完成 Tool Activity、已提交的原子领域动作和所有 Action receipts，不执行尚未开始的后续步骤。当用户在 Run 进行中发送新的消息时，客户端将其视为 steer：先终止或安全收束当前 Run，再在同一 Coach session 创建新 Run 处理新意图。用户输入框不能仅因为 Agent 正在工作而永久禁用。

进程关闭、断网、Provider 失败和客户端重启都必须产生明确的恢复结果。启动恢复会扫描 orphan streaming/resuming Run：可以安全继续且 Provider continuation contract 仍有效的 Run 显示“继续”；不能继续的 Run 原位变成“已中断，可重新开始这一步”；已消费 Tool Call 和 ActionToken 不得重复执行。Pending Human Action、Form draft、Decision card、部分输出、错误短码和操作回执都由 Ledger 恢复。新打开的空白 Conversation 不会被旧的 pending Run 劫持，但历史入口和轻量待处理标记必须让用户找到它。

首次建档由一个极薄的 Profile Setup Harness 配置普通 Conversation opening。当权威 User profile 缺失时，Conversation Starter 无需调用 LLM，直接追加固定欢迎 Message Item 和版本化 Baseline intake Form Item。表单至少采集领域词汇定义的年龄、身高和当前体重，并允许用户同时提供自由语言目标。表单字段、单位、校验和来源由本地 Schema Registry 所有；用户提交后写入可恢复、provenance-bearing Onboarding draft。该 Draft 只承载结构化输入和版本冲突，不拥有页面、阶段、下一步路由或完成清单。

Baseline intake 成功提交后，Conversation Starter 触发普通 Agent Run。Agent 根据目标原话、当前 Onboarding draft、权威领域事实、Working Memory、相关旧对话、知识、固定工具和行动门槛自由决定是否继续自然交流、请求小型表单、提出目标路径、进入 record-only、生成当前阶段计划候选或说明证据不足。Agent 可以选择允许的字段和卡片类型，但字段含义、单位、校验、敏感性、事实所有者、确认要求和安全护栏仍由本地系统决定。

普通 Agent Run 必须以 `@mariozechner/pi-agent-core` 作为唯一 production Agent runtime。Conversation Agent Harness 在 Pi Agent Core 外组织本地上下文、工具 Adapter、领域权限、持久化卡片和 trace；Pi Agent Core 负责标准 Agent loop、消息/工具生命周期、steer、follow-up、abort 和 continuation。不得再维护一套自研 Agent loop，也不得只使用 `pi-ai` 的消息类型却声称产品“基于 Pi”。Harness 不是固定问卷、建档阶段机或另一套业务规则：LLM 可以自由决定如何交流、何时追问、需要读取什么、是否检索知识以及如何组织计划候选；本地 Harness 阻止模型伪造事实、调用无权工具或绕过固定验证。

Pi Agent 的内存状态不是产品权威。每次创建或恢复 Run 时，Conversation Module 从本地 Ledger 读取 durable Conversation Items、当前 Fact frontier、待处理动作和能力集合，构造 Pi `Agent`；Pi 生命周期事件再通过同一个 Module 持久化为 Message、Tool Activity、Structured Result、Decision 和 Error Recovery Items。进程重启时按 Ledger 重建，而不是序列化或信任 Pi 内部对象。本地 Product Kernel 继续拥有领域事实、权限、安全、ActionToken、Artifact 和 commit validity。

Harness 的能力按读取、记录、目标与计划、知识、对话交互五类注册。读取工具提供当前档案、Goal contract、Timeline、Daily Ledger、趋势、Plan、执行结果、恢复/安全状态、Working Memory 和相关历史；记录工具提交用户明确陈述的 Timeline、营养、训练、身体和执行反馈；目标与计划工具负责协商目标、读取固定 planning input、提交当前阶段候选、暂停和完成评估；知识工具查询已安装领域知识；对话交互工具请求表单、选择、确认和重试。停止、恢复、steer、幂等和 stale 处理属于 Harness 控制面，不作为模型可以任意调用的业务工具。

Harness 只向 Provider 暴露当前事实、Safety、Coaching mandate 和 Pending action 允许的最小能力集合，并在执行时再次校验。用户明确陈述的低风险已发生 Record 默认可以自动写入，并立即在 Conversation 中显示内容、来源和可撤销 correction 入口；Goal、Plan 和 Nutrition strategy 的创建或变更默认要求确认。用户可以像 Coding Agent 权限一样随时选择始终询问、仅本次允许、允许同类低风险调整或拒绝；任何模式都不能跨越受伤、极端限制和其他硬安全边界。

用户反馈由 Agent 结合语义和当前上下文判断，Harness 负责验证最终动作。明确表示已经发生的行为、测量或用户提供的结构化营养数值可以记录；确定部分可以记录、未知部分保持 unknown；无法区分已发生与准备执行、对象或单位含糊、或者写入后果不清时应追问或发送小型表单；建议请求、假设和未来意图不得写成已发生 Record；执行困难先记录真实 outcome，再交给固定 GoalPath 判断是否需要调整；纠错创建 correction，不覆盖历史；疼痛、受伤、极端限制或危险补偿停止相关自动行动并进入安全说明。

知识调用遵循分层权威。当前 Ledger、固定 Calculator、GoalPath、安全规则和领域 validator 优先于知识文本；已安装知识用于解释动作、规则、方法和计划设计依据。知识检索无结果时，Agent 可以在低风险教育或一般性交流中使用模型的一般知识，但必须明确其为一般信息且没有本地知识引用；涉及营养数值、训练剂量、医学或受伤风险、目标可达性、固定结论以及可提交的 Goal/Plan/Nutrition 变更时，不得以模型先验补缺，必须说明证据不足或无法确认。

Working Memory 用于长期个性化，但不成为隐蔽事实库。Agent 可以根据明确表达或重复正式行为生成 Memory candidate；明确偏好或多次实际行动支持后才可提交，且保留来源、置信度和复查信息。记忆始终可以查看、修改、固定或删除；敏感身份、医学结论、食物营养和仅由模型推断出的属性不得自动保存。实际完成、跳过和选择的长期证据优先于一次口头偏好，但冲突时应保留不确定性并与用户沟通。

用户从独立 Record、Workout、Plan 或 Profile UI 手动操作时，仍调用相同的本地领域命令和校验，但这些操作不能伪装为 Agent 对话或 Agent Tool Call。下一轮 Agent 可以从正式 Record 或当前领域投影中读取结果。相反，凡是由 Agent 发起的读取、草稿、计划候选、调整、确认或失败，都必须在发起它的 Conversation 内留下可恢复的结构化 Item 和用户可理解的执行轨迹。

云端继续只提供身份与 text-only LLM inference。Conversation、消息、Tool Call、Artifact、Working Memory、历史检索索引、Pending Human Action、ActionToken、领域事实和 trace 的本地权威不得迁移到云端，也不增加 Cloud ProductData、媒体、Replica 或兼容双写路径。

## User Stories

1. As a 已登录用户, I want 从 Coach 顶层入口进入时看到一条新的空白对话, so that 我可以像使用 GPT 一样开始新的问题。
2. As a 用户, I want 收起并再次展开当前 Coach 时仍停留在同一条对话, so that 一个临时 UI 动作不会创建重复 Session。
3. As a 用户, I want 明确点击“新对话”时立即获得新的 Coach session, so that 不同任务不会混在同一段上下文里。
4. As a 用户, I want 从历史列表中打开任意旧对话, so that 我可以恢复之前未完成或需要复查的任务。
5. As a 用户, I want 历史对话显示标题、更新时间、状态和待处理标记, so that 我能快速找到需要继续的会话。
6. As a 用户, I want 新对话不自动显示旧对话的全部消息, so that 每个任务保持清晰且不会被无关历史淹没。
7. As a 用户, I want 新对话中的 Agent 仍了解我的当前档案和目标, so that 我不需要反复介绍自己。
8. As a 用户, I want Agent 使用我已确认的 Timeline Records、Plan 和 Nutrition strategy, so that 回答建立在最新正式事实上。
9. As a 用户, I want Agent 使用 Working Memory 中我允许保留的偏好和习惯, so that 长期相处后建议更符合我的实际生活。
10. As a 用户, I want Agent 按当前问题检索相关旧对话摘要或片段, so that 我能跨对话延续之前的重要讨论。
11. As a 用户, I want Agent 告诉我某项信息来自档案、记录、记忆还是旧对话, so that 我能判断它的权威程度。
12. As a 用户, I want 查看、修改、固定或删除 Working Memory, so that 长期记忆始终受我控制。
13. As a 用户, I want 旧对话中的模型推断保持非权威状态, so that 一次错误回答不会变成事实。
14. As a 用户, I want 页面切换不替换当前 Conversation, so that 我查看计划或记录时不会丢失正在进行的讨论。
15. As a 用户, I want 当前页面可以作为本轮消息的可选上下文附件, so that Agent 知道我正在询问哪一天或哪份计划。
16. As a 用户, I want 页面上下文不会成为 Session identity, so that 同一任务能够跨 Today、Plan 和 Profile 继续。
17. As a 用户, I want 普通解释以自然语言消息显示, so that 对话保持简洁、连贯和易读。
18. As a 用户, I want 能量、营养、趋势、目标路径或计划差异等结构化结果使用卡片显示, so that 复杂结果不被压成难读的长文本。
19. As a 用户, I want Read-only 结构化卡片可以在会话内展开或收起, so that 我能按需查看细节而不离开对话。
20. As a 用户, I want Agent 需要补充资料时发送表单卡, so that 我可以准确填写有单位和校验的字段。
21. As a 用户, I want Agent 需要我选择目标期限或方案时发送选择卡, so that 选项、时间与代价可以并列比较。
22. As a 用户, I want Agent 提议写入记录时发送确认卡, so that 未确认的推断不会进入 Timeline。
23. As a 用户, I want Agent 提议计划或调整时发送确认卡, so that 我能看清摘要、差异、依据、代价和护栏结果。
24. As a 用户, I want 工具失败、冲突或过期时看到恢复卡, so that 我知道可以重试、重新生成还是必须补充信息。
25. As a 用户, I want 卡片在执行过程中从 loading 原位更新为结果, so that 同一个 Tool Call 不会生成多张重复卡片。
26. As a 用户, I want 已确认卡片原位显示 applied 回执, so that 我能核实系统真正写入了什么。
27. As a 用户, I want 被拒绝的卡片保留 rejected 状态, so that 历史对话不会假装提案从未存在。
28. As a 用户, I want 依赖事实变化后的旧卡片显示 stale, so that 我不会确认已经基于过期信息生成的结果。
29. As a 用户, I want Agent 卡片始终留在当前对话, so that 交互不会突然把我送到另一页。
30. As a 用户, I want 卡片操作不自动打开 Plan、Workout、Profile 或独立建档页面, so that 对话保持唯一工作台。
31. As a 用户, I want 确认计划后由正式 Plan 投影自然更新计划页, so that 对话与业务页面共享同一事实而不互相控制导航。
32. As a 用户, I want 查看 Agent 当前正在读取、计算或校验什么, so that 等待过程不是黑盒。
33. As a 用户, I want 完成的 Tool Activity 可以折叠而不是完全消失, so that 我需要时能够追踪 Agent 行为。
34. As a 用户, I want Tool Activity 使用可理解的产品语言而不是内部函数名, so that 追踪信息不会变成开发日志。
35. As a 用户, I want Agent 说明结构化结果使用了哪些事实和规则, so that 我能验证结论来源。
36. As a 用户, I want Agent 不展示隐含思维链, so that 行为追踪聚焦可验证操作、依据与结果。
37. As a 用户, I want Agent 工作时始终有停止按钮, so that 我可以立即结束不再需要的处理。
38. As a 用户, I want 停止后保留已生成内容和已完成动作回执, so that 打断不会伪造回滚或抹掉历史。
39. As a 用户, I want Agent 工作时仍可以发送新消息, so that 我能够改变方向或补充关键事实。
40. As a 用户, I want 新消息安全终止或收束旧 Run 后在同一 Conversation 启动新 Run, so that 打断不会并发写入互相冲突的结果。
41. As a 用户, I want 原子工具动作一旦提交就显示明确回执, so that 停止 Agent 不会让我误以为已经发生的写入被取消。
42. As a 用户, I want App 关闭或进程被回收后仍能恢复历史消息和卡片, so that 会话不会因客户端生命周期丢失。
43. As a 用户, I want orphan streaming Run 在重启后变成明确的可继续或已中断状态, so that 会话不会永久卡在“处理中”。
44. As a 用户, I want 可安全恢复的 Provider continuation 使用同一个 Run identity, so that 工具和确认不会重复执行。
45. As a 用户, I want 不能安全继续的 Run 提供“重新开始这一步”, so that 我能恢复任务而不重放已提交动作。
46. As a 用户, I want 待确认表单和 Decision card 在重启后仍处于正确状态, so that 我可以稍后继续。
47. As a 用户, I want 新对话不会自动接管旧对话的 Pending Human Action, so that 不同任务的操作不会混淆。
48. As a 用户, I want 历史入口提示哪些旧对话仍等待我确认, so that 待处理事项不会静默丢失。
49. As a 新用户, I want 首次进入 Coach 时先看到固定欢迎消息, so that 我知道 Agent 将如何协助我。
50. As a 新用户, I want 欢迎消息后直接看到个人基础信息表单卡, so that 我不需要进入独立建档页面。
51. As a 新用户, I want 基础表单至少支持年龄、身高和当前体重, so that 系统拥有领域定义的 Baseline intake。
52. As a 新用户, I want 可以在基础表单中同时写自由语言目标, so that 我的目标不会一开始就被压缩成枚举。
53. As a 新用户, I want 基础表单明确单位、校验、必填与可选字段, so that 我不会提交含义不清的数据。
54. As a 新用户, I want 表单提交后在当前 Conversation 原位显示已保存内容, so that 我能立即核对输入。
55. As a 新用户, I want 未提交的基础表单在关闭 App 后可以恢复, so that 建档不必一次完成。
56. As a 新用户, I want 新对话中的基础表单读取当前 Onboarding draft, so that 已填写内容不会被重复询问。
57. As a 新用户, I want Baseline intake 提交后由普通 Coach Agent 接管, so that 后续体验与正常对话是同一个 Agent。
58. As a 新用户, I want Agent 根据我的目标自由决定下一项最有价值的问题, so that 我不会经历固定问卷。
59. As a 新用户, I want Agent 可以使用普通消息追问简单问题, so that 每个问题不必都变成表单。
60. As a 新用户, I want Agent 需要多个结构化字段时组合一张小型表单卡, so that 输入准确但不形成页面阶段。
61. As a 新用户, I want Agent 只能选择产品声明过的字段、单位和校验, so that 自由发挥不会创造错误数据模型。
62. As a 新用户, I want 已经通过对话提供的信息自动反映到后续表单卡, so that Agent 不会重复询问。
63. As a 新用户, I want 不影响当前目标或安全的未知信息可以保持 unknown, so that 建档不会被不必要字段阻塞。
64. As a 新用户, I want 安全相关缺口在真正影响动作时触发明确确认, so that Agent 的灵活性不能跨越硬护栏。
65. As a 无明确目标的用户, I want Agent 接受我只使用记录功能, so that 建档不会强迫创建 Goal contract 或 Plan。
66. As a 有明确目标的用户, I want Agent 讨论目标结果、时间和付出代价, so that Goal contract 是沟通后的协议。
67. As a 有明确目标的用户, I want 多套目标路径使用结构化比较卡展示, so that 我可以比较渐进、平衡或更快方案。
68. As a 有明确目标的用户, I want 当前阶段计划候选在对话中展示并确认, so that 首次计划不会出现在另一套页面流程。
69. As a 用户, I want Agent 根据长期行为和偏好调整后续提问与方案, so that 相处越久建议越容易执行。
70. As a 用户, I want 手动记录和 Agent 代操作使用同一领域校验, so that 两种入口不会产生不同事实语义。
71. As a 用户, I want 手动操作不被伪装为 Agent Tool Call, so that Action log 能准确区分行为来源。
72. As a 用户, I want Agent 发起的每个领域变更都能回到具体 Conversation、Run、Tool Call 和确认, so that 任何结果都有完整因果链。
73. As a 支持人员, I want 用户可见错误短码关联本地完整 trace, so that 我能定位失败而不要求用户上传对话内容。
74. As a 开发者, I want 每个 Run 记录 Provider、Context manifest hash、Fact frontier、工具和终态, so that 行为可以重放和审计。
75. As a 开发者, I want Tool Call 输入经过 Schema 与能力校验后才执行, so that 模型输出不能直接成为本地动作。
76. As a 开发者, I want Run、Tool Call、Artifact、Presentation、Pending Human Action 和 Action receipt 使用稳定 identity, so that UI 重放不会产生重复内容。
77. As a 开发者, I want 新旧 Conversation 的上下文检索带来源引用和预算记录, so that Agent 的跨会话记忆可以验证。
78. As a 隐私敏感用户, I want 旧对话检索和 Working Memory 保持本地, so that 云端只收到当前运行所需的最小文本上下文。
79. As a 隐私敏感用户, I want 远程 trace 不包含用户原话、直接身份或未脱敏表单值, so that 行为观测不会复制健康数据。
80. As a 产品负责人, I want 真实客户端入口完成新建、结构化卡片、打断、恢复和建档场景的端到端验收, so that 局部测试通过不能再次伪装为完整体验。
81. As a 用户, I want Agent 根据当前对话自由决定回答、追问或调用工具, so that Coach 不会退化成固定问题清单。
82. As a 用户, I want Agent 只看到当前允许且有意义的工具, so that 无关或未授权能力不会干扰对话。
83. As a 用户, I want 工具在真正执行时再次检查权限、安全和事实版本, so that 陈旧上下文或模型输出不能绕过本地控制。
84. As a 用户, I want 我明确报告的低风险已发生行为可以直接进入记录并显示回执, so that 日常记录不被重复确认拖慢。
85. As a 用户, I want 自动记录提供明确的 correction/撤销入口而不是删除历史, so that 我可以纠错且事实链仍可审计。
86. As a 用户, I want Goal、Plan 和 Nutrition strategy 的创建或变更默认要求确认, so that Agent 不会未经同意改变我的目标和安排。
87. As a 用户, I want 随时配置始终询问、仅本次允许、允许同类调整或拒绝, so that Agent 权限符合我当前的信任程度。
88. As a 用户, I want 授权模式不能跨越受伤和极端行为等硬护栏, so that 自动化不会扩大健康风险。
89. As a 用户, I want 我报告已经完成的行为时 Agent 能正确记录, so that 对话可以推进 Timeline。
90. As a 用户, I want 我表达未来计划、假设或咨询时 Agent 不把它当成已经发生, so that Timeline 不会产生虚假事实。
91. As a 用户, I want 信息只有一部分确定时系统记录确定部分并保留其余 unknown, so that 不完整不等于猜测或全部丢弃。
92. As a 用户, I want 已发生与未来意图无法区分时 Agent 先澄清, so that 写入语义保持准确。
93. As a 用户, I want 执行困难先被记录为真实 outcome 再评估计划, so that 一次反馈不会直接触发随意重规划。
94. As a 用户, I want 疼痛、受伤、极端限制或危险补偿停止相关行动, so that 对话便利性不能覆盖安全。
95. As a 用户, I want 结构化结果、表单、选择、比较、确认和错误恢复使用明确卡片, so that 我能分辨信息、输入和待确认动作。
96. As a 用户, I want 卡片只来自已注册 Tool Result 或 Artifact, so that 模型不能凭文本伪造可交互产品状态。
97. As a 用户, I want 普通解释继续使用自然语言消息, so that 不需要交互或固定结构的内容不会被过度卡片化。
98. As a 用户, I want Agent 在需要专业依据时调用已安装知识并显示引用, so that 训练和计划解释可以验证。
99. As a 用户, I want 固定计算器和正式记录优先于知识文章, so that 热量、营养和目标判断拥有唯一计算来源。
100. As a 用户, I want 知识库没有结果时低风险解释可以明确标注为一般信息, so that Agent 仍可交流但不会伪装成已验证结论。
101. As a 用户, I want 高风险或可提交结论缺少固定依据时 Agent 明确说无法确认, so that 模型常识不能补写训练剂量、营养数值或安全结论。
102. As a 用户, I want Agent 根据明确偏好和重复实际行为逐渐学习, so that 长期建议更符合我的生活习惯。
103. As a 用户, I want 新的长期记忆保留来源、置信度并可以管理, so that 个性化透明且可纠正。
104. As a 用户, I want 实际完成和跳过的行为证据优先于一次口头偏好, so that Agent 学到的是我真正能坚持的方案。
105. As a 用户, I want Agent 在完成回答、等待输入、遇到安全阻断或被我停止时明确结束当前 Run, so that 会话不会无止境运行。
106. As a 用户, I want 工具连续失败、没有进展或事实已过期时看到可恢复结果, so that Agent 不会静默循环或继续使用旧结论。
107. As a 用户, I want 没有 material signal 的每日规则检查不启动 LLM, so that 长期观察保持低成本且不会频繁打扰。
108. As a 开发者, I want 每个 Run 的可见能力、Tool Call、知识引用、权限决定、停止原因和回执都可追踪, so that Agent 行为可以审计和复现。
## Implementation Decisions

- 新建 Agent Conversation Module。它是客户端和测试使用的最高层、唯一 Conversation seam，拥有 Session 创建、Thread snapshot、Turn 提交、Run 打断、Card response、历史恢复和 Pending work 查询。
- Product shell 只负责显示 Conversation surface 和传递可选 Context attachment。它不读取 Ledger 来选择 Session，不按页面 kind/ref 复用会话，不自行组装 Stream projection，也不持有 Run 生命周期规则。
- Coach 顶层入口在没有显式 Session reference 时创建新的空白 Coach session。收起/展开保持当前 session；“新对话”显式创建新 session；历史选择按稳定 session id 恢复。
- 同一账户允许多条可恢复 Coach session。不得再用“全账户只能有一条 active session”表达前台选择；前台 attached/visible 是 Product shell presentation state，Session lifecycle 与前台显示分离。
- ContextRef 从 Session identity 降为 Turn attachment。一个 Coach session 可以包含多个 ContextRef，且页面变化本身不修改当前 Session。
- Conversation Items 形成唯一用户可见投影，至少包含 Message、Tool Activity、Structured Result、Form、Decision、Error Recovery 六类。每类 Item 均有版本化 schema、稳定 id、causation refs、run id、状态和发生时间。
- Tool Activity 展示用户安全的动作名称、阶段、依据类别和结果，不展示 raw provider arguments、内部对象、敏感值或模型思维链。完成的工具活动默认折叠但不可从历史中删除。
- Structured Result card 是 typed Tool Result 的正式 Renderer。Read-only card 可以无操作；Form、Choice、Confirmation、Retry 是带动作的结构化结果类型，不另建一套页面协议。
- Renderer Registry 是闭合且版本化的。未知 renderer、schema/hash 不一致或 stale presentation 只能显示不可操作的安全 fallback。
- 卡片动作只允许提交当前 Card contract 定义的字段、选择、确认、拒绝、撤销或重试。Agent Card action 不得包含 route、screen、deep link、open page、dismiss conversation 或任意组件指令。
- 结构化卡片可以在 Conversation 内展开详情。计划确认后 Plan 投影自然更新；训练、记录和 Profile 页面仍可由用户自主进入，但 Agent 不通过卡片强制导航。
- 消息发送使用稳定 clientTurnId。重复点击、网络重试或进程恢复不得创建第二个 Run。
- Run lifecycle 收敛为 queued、streaming、awaiting_user、resuming、completed、interrupted、failed。旧 suspended/terminated 等存储名若仍是当前未发布实现的一部分，应一次性迁移到正式语义，不保留双模型或兼容映射。
- 用户点击停止会终止当前 Provider stream，并把尚未开始的后续步骤标 interrupted。已提交的领域命令保持有效并生成 Action receipt；未提交草稿保持可恢复但不成为事实。
- 用户在 streaming 时发送新消息属于 steer。Module 负责串行化：停止或安全收束旧 Run，再为同一 session 创建新 Run。客户端不能直接并发调用 Provider 或工具。
- 原子本地 Tool execution 不允许在事务中间被部分取消。打断作用于 Run 的后续编排；已经提交或明确拒绝的动作由 Action log 表达。
- 启动恢复扫描 orphan streaming/resuming Run。只有具有有效 Provider continuation、未过期 token、相同能力版本和未变化 Fact frontier 的工作可以继续；其余原位转为 interrupted/stale 并提供安全重试动作。
- Pending Human Action 和表单提交继续使用一次性 ActionToken、过期时间、能力版本和 Fact frontier/CAS。恢复或重试不得再次消费已使用 token。
- Agent Context 分离四种来源：权威领域事实、Working Memory、相关旧 Conversation recall、当前 Conversation window。Context manifest 必须记录每类来源、版本引用、压缩状态和遗漏范围。
- 旧 Conversation recall 使用本地索引。它返回可追溯的 Conversation summary 或最小相关消息片段；不把所有旧原文无条件发送给模型，也不把摘要当成事实。
- Conversation summary 是非权威 Artifact，必须引用来源 Session/Run/Message。仅包含消息数量或时间范围的统计不能替代语义摘要。
- Working Memory 保持非权威、provenance-bearing、可查看、可编辑、可固定、可删除。偏好或习惯只有在用户确认或正式 Plan outcome 支持时才可进入长期记忆。
- 当前 User profile、Goal contract、Timeline、Plan、Nutrition strategy、Safety constraint 和 Readiness state 始终来自本地 Ledger 的当前投影，不从旧对话摘要恢复。
- Profile Setup Harness 只是 Conversation Starter 配置，不是长期 Agent 人格、页面路由或状态机。它只负责无权威 User profile 时追加固定欢迎 Message 和 Baseline intake Form，然后触发普通 Agent。
- Baseline intake 使用领域词汇定义的年龄、身高、当前体重，并允许自由语言目标。目标可保持 unknown/未提供；缺少目标不得阻止 record-only。
- Onboarding draft 被收窄为 append-only、provenance-bearing 的结构化输入草稿。它拥有 field value、source、card/schema version、submission 和 conflict；不拥有 stage、screen、next route、mandatory section 或首次计划完成状态。
- 表单 Schema Registry 定义允许字段、类型、单位、校验、敏感性、领域所有者、确认要求和适用行动。LLM 只能选择、组合和排序已声明字段。
- Baseline intake 后由普通 Agent 自由组织交流，但“自由”受闭合 Tool manifest、字段 Registry、Coaching mandate、固定安全护栏、目标可达性规则和 typed local execution 约束。
- Conversation Agent Harness 位于 Agent Conversation Module 内，是 Agent runtime 的唯一正式入口。它必须通过 `@mariozechner/pi-agent-core` 的 `Agent`/agent loop 执行 model/tool continuation、steer、follow-up、abort 和生命周期事件；本地 Module 拥有 Context assembly、动态 Capability manifest、card projection、durable recovery 和 trace。Product shell、Profile Setup、Provider adapter 和 Local Product Kernel 不得各自实现第二套 Agent loop。
- `@mariozechner/pi-agent-core` 是明确的 production dependency，不是测试类型依赖。正式 composition 必须直接构造 Pi `Agent`，使用 Pi `AgentEvent` 驱动 Conversation Items，并把现有 text-only MaxPower Pi stream function、model alias 和动态 access token 注入 Pi。
- `@mariozechner/pi-ai` 继续提供 text message、tool schema、model 和 streaming contract；云端 MaxPower API 仍只是 Pi stream function 使用的 text LLM transport。不得把 Pi Agent runtime 移到云端。
- Pi `transformContext` 接收本地 Context assembly 的结果，`convertToLlm` 只保留允许进入模型的 user/assistant/tool-result 内容并排除 UI-only Items，`beforeToolCall` 调用本地 capability/policy/Safety/stale preflight，`afterToolCall` 将最小 Artifact ref、错误和停止提示送回 Agent loop。所有领域写工具使用 sequential execution；只有被证明相互独立的 read tools 才允许 parallel。
- Pi `Agent.subscribe` 是 Run 生命周期进入 Ledger 的唯一事件入口。agent/turn/message/tool start、update、end 和 error 必须映射到稳定 Session/Run/ToolCall/ConversationItem identity；监听器写入完成属于当前 Run settlement，客户端不得从 Provider stream 另建旁路投影。
- Pi Agent state 只存在于当前进程和当前 Run。Ledger 是会话历史、Pending Human Action、Artifact、回执和终态的唯一 durable authority；重启恢复通过 durable transcript/context/tool results 重建新的 Pi Agent instance。
- 物理删除现有自研 `AgentRuntime`、自定义 Provider tool-loop、`ProviderEvent` 再解释层以及仅为自研 loop 存在的 continuation/status 分支。`MaxPowerPiCoachProvider` 若只负责把 Pi 事件转回自研 ProviderEvent，也必须删除；正式路径直接把 `MaxPowerPiLlmProvider` 暴露的 Pi `model`、`streamFn` 和 `getApiKey` 交给 Pi Agent Core。不保留双运行时、fallback 或兼容开关。
- Harness 不持有固定建档问题、固定下一步或健身业务判断。LLM 根据当前目标和证据选择自然语言、读取、追问、知识、草稿或方案；固定领域 Module 决定事实 admission、计算、安全、GoalPath 和提交有效性。
- V1 capability registry 分为 `read`、`record`、`goal_plan`、`knowledge` 和 `interaction`。每个 capability 声明 input/output schema、required fact refs、Safety/Mandate 条件、read/write effect、confirmation policy、allowed renderer 和用户安全名称。
- Read capabilities 必须覆盖当前 User profile、Goal contract、Timeline、Daily Health Ledger、日周月趋势、Active Plan、Nutrition strategy、Plan outcomes、Recovery/Safety、Working Memory 和相关 Conversation recall。不得要求模型从未经版本化的 prompt 文本猜测这些状态。
- 现有 `plan.show_current`、`plan.show_today`、`plan.show_outcome_context`、`plan.show_planning_input`、`nutrition.show_strategy`、`recovery.show_brief`、`recovery.evaluate_timeline`、`safety.show_hold` 和 `coach.show_weekly_report` 可迁入 read family；没有正式 reader 的 Profile、Goal、Ledger、Trends、Working Memory 和 Conversation recall 必须增加 typed capability，而不是添加兼容 prompt 拼接。
- Record capabilities 包含 Timeline user report、explicit Nutrition observation、Workout result、body measurement、Plan outcome 和 correction。所有写入串行执行、带 Session/Run/ToolCall causation、使用相同领域 admission/CAS，并返回 Action receipt。
- 用户明确陈述且语义完整的低风险已发生 Record 默认允许自动提交。Conversation 原位显示写入内容、来源、时间和 correction action；所谓撤销通过正式 correction/retraction 表达，不物理抹除历史。
- 事实语义不完整但存在可安全记录的确定部分时，保存确定字段并将其余字段保持 unknown。若无法确定事件是否已经发生、主体、单位或写入目标，Agent 必须先使用消息或 FormCard 澄清。
- 未来意图、假设、方案讨论、建议请求和模型推断不能进入 Timeline。计划执行困难先形成 Plan outcome/Record，再由固定 GoalPath 判断；LLM 只解释结果或基于正式 planning input 生成候选。
- Goal/Plan capabilities 包含 Goal negotiation、Goal completion review、Plan pause、读取 fixed planning input 和提交 current-stage candidate。Goal、Plan 和 Nutrition strategy 的创建/变更默认生成 ConfirmationCard，确认后仍执行完整 validator 与 Fact frontier CAS。
- Coaching mandate 的正式授权选项为 `always_ask`、`ask_this_time`、`allow_similar` 和 `deny`，用户可以从 Conversation 或 Profile 随时修改。`ask_this_time` 使用后恢复到非授权状态；`allow_similar` 只适用于 validator 认定的同类低风险变更；Safety hold 和受保护动作永远不接受授权绕过。
- Knowledge capabilities 包含 exercise lookup、rule explanation 和 passage search，只读取已安装、带版本的知识。返回值包含 Passage refs、适用范围和知识版本，不执行领域写入，也不提供食物成分查询、营养估算或固定计算结果。
- Knowledge policy 的权威顺序为 Ledger/Calculator/GoalPath/Safety/Validator，高于 installed passages，高于明确标记的一般模型知识。模型一般知识仅可用于低风险教育和非执行性说明，并必须在无 Passage 支持时使用清晰限定语。
- 营养数值、训练剂量、医学/受伤判断、目标可达性、安全边界和任何可提交变更不得使用一般模型知识填补。所需固定结果或 Passage 不存在时返回 evidence/knowledge insufficient，不得把通顺文本当作依据。
- Interaction capabilities 至少包含 `request_form`、`request_choice`、`request_confirmation` 和 `request_retry`。模型只能引用客户端 Schema/Action Registry 中已声明的字段和动作，不能内联任意组件、任意 JSON Schema、导航或页面指令。
- Harness 只把本轮 eligible capabilities 暴露给 Provider。资格由当前 Context、Fact frontier、Safety、Coaching mandate、pending action 和 capability prerequisites 计算；Tool executor 在实际调用时再次验证，防止 Provider 缓存、stale Run 或伪造 tool name 绕过控制。
- Conversation renderer registry 的正式业务卡片为 `StructuredResultCard`、`FormCard`、`ChoiceCard`、`ComparisonCard`、`ConfirmationCard` 和 `ErrorRecoveryCard`。Tool Activity 是可折叠执行轨迹，不是让模型承载业务内容的通用卡片。
- `StructuredResultCard` 用于能量、营养、趋势、GoalPath、恢复或其他 typed result；`FormCard` 收集已注册字段；`ChoiceCard` 和 `ComparisonCard` 展示可选项与取舍；`ConfirmationCard` 展示将发生的领域变化；`ErrorRecoveryCard` 表达 retry、stale、证据不足或不可继续。普通解释仍使用 Message Item。
- 每张卡必须来自 Tool Result/Artifact，包含稳定 item/artifact id、renderer/schema version、Session/Run/ToolCall refs、Fact frontier 和状态。所有卡禁止 route、screen、deepLink、openPage、自动 dismiss 或任意页面生命周期指令。
- Working Memory candidate 可以来自用户明确偏好或重复正式行为；提交要求来源 refs、confidence、review/expiry policy。明确偏好可直接形成候选，多次真实完成/跳过证据可提高或纠正其置信度；单次模型推断、敏感身份、医学结论和食物营养不得自动保存。
- Working Memory 冲突时不静默覆盖。实际行为与口头偏好同时保留来源，Agent 在它们影响方案时说明差异并请求用户确认；用户可以查看、修改、固定、删除或禁止某类记忆。
- Harness tool continuation loop 有固定最大步数，并检测相同工具、规范化输入和未变化事实前沿下的无进展重复。只读且相互独立的调用可以并行；所有写入、确认和依赖前一步输出的调用必须串行。
- Run 必须以 completed、awaiting_user、interrupted、blocked_safety、insufficient_evidence、stale、failed_retryable 或 failed_terminal 之一明确结束。用户 stop/steer、等待表单/选择/确认、硬安全边界、权限拒绝、事实前沿变化、无可用依据、工具连续失败、无进展循环、Provider 取消/超时和任务超出领域都必须停止当前 continuation，而不是静默悬挂。
- Timeline hook 与每日检查先由固定规则引擎判断 material signal。没有 Signal 时只留下轻量审计，不创建 Agent Run 或 LLM 请求；产生正式 Signal、需要用户确认或用户主动对话时才进入 Harness。
- Agent 生成计划候选或目标路径时，LLM 负责组织方案和解释；固定计算/规则负责 Ledger、目标可达性、安全和候选验证。验证结果以 Structured Result/Decision card 返回同一 Conversation。
- 用户手动 UI 和 Agent Tool 使用相同领域命令、校验和数据结构。手动动作的 actor/causation 保持 user/manual，不产生伪造 Agent Message 或 Tool Activity。
- Agent 发起的每个工具动作必须关联 Session、Run、Tool Call、Context manifest、Artifact/Presentation、Action receipt 和行为 trace。用户可见轨迹与开发 trace 使用同一 identity，但用户轨迹只含安全摘要。
- Conversation surface 使用适合长列表的虚拟化消息列表、稳定 item key、增量原位更新、键盘安全区域和可访问性焦点恢复。不得继续用 ScrollView 映射无限历史。
- Conversation surface 是全高工作面；现有视觉、Composer、消息气泡、历史列表、卡片样式和 Focus transition 可以复用，但业务编排必须改为消费 Agent Conversation Module snapshot。
- 本地 Ledger 仍是 Conversation 和产品事实的唯一持久化权威。Product shell presentation store 只保存可安全恢复的 attached session reference、前台状态和无事实 UI 选择。
- 云端仍只提供 identity 和 text-only LLM inference；不新增 Conversation cloud store、ProductData、Media、Replica、跨设备恢复或双写兼容。
- 实现时同步更新领域文档中 Coach session、Onboarding draft、Baseline intake 和 Conversation recall 的正式定义，删除与页面式建档或单 active session 冲突的词义。
- 旧的页面式 `agent-guided-user-dossier-onboarding` PRD 和 tickets 已是 wontfix；本 Spec 是 Conversation interaction 与 Profile Setup Harness 的唯一锚定产物，不得从旧流程复制兼容结构。

## Testing Decisions

- 测试只验证外部可观察行为：Conversation snapshot、可见 Items、Run 终态、领域写入、Action receipts、恢复结果和 trace identity。不得通过断言私有函数、文件名、样式键或手工注入内部 Snapshot 来证明完成。
- 最高层且首要验收 seam 是 Agent Conversation Module 的 production composition。测试从账户级客户端入口创建新对话，经过真实 Module、Agent runtime、Tool Registry、Ledger、Renderer projection 和领域命令，读取最终 Conversation snapshot。
- 为最高 seam 提供两个真实 Adapter：生产 SQLite Ledger/产品组合与 In-memory Ledger/确定性 Provider fixture。测试和正式客户端必须调用同一 Interface。
- 新对话验收：没有显式 session ref 时创建新 session；收起/展开不创建；点击新对话创建；页面切换不改变；历史选择恢复指定 session。
- 跨会话上下文验收：新 session 不显示旧消息，但 Agent context 包含当前领域事实、Working Memory 和与当前首条消息相关的旧 Conversation refs；无关旧对话不进入 Context manifest。
- 权威等级验收：旧对话或 Working Memory 与当前领域事实冲突时，正式事实胜出；LLM 摘要不能生成领域写入。
- 语义压缩验收：长对话超出预算后，恢复的摘要仍包含任务目标、已确认决定、待处理事项和来源 refs，而不是仅有消息数量统计。
- 卡片验收：Read-only Structured Result、Form、Choice、Confirmation、Retry 都由闭合 Renderer Registry 渲染；未知 renderer/hash/schema fail closed。
- 原位更新验收：同一 Tool Call 的 loading、ready、awaiting_user、submitted、applied/rejected/stale 使用同一 Conversation Item id，不追加重复卡片。
- 无导航验收：任何 Agent card action 都不能调用页面 route、关闭 Conversation、打开独立建档 Screen/Sheet 或自动启动 Workout。确认后的领域投影可以被用户稍后在业务页面读取。
- Tool ownership 验收：每张 Agent 结构化卡都可回溯至同一 Session、Run 和 Tool Call；不存在没有 Tool Result/Artifact identity 的模型自造卡。
- 打断验收：streaming 时点击停止，Provider 收到 abort，Run 变 interrupted/terminated，迟到 Tool Call 被拒绝，部分文本和已完成工具回执保留。
- steer 验收：streaming 时发送新消息不会得到 `conversation_turn_in_progress`；旧 Run 先结束，新 Run 后开始，两个 Run 不并发提交领域命令。
- 原子动作验收：在打断前已提交的领域写入保留且显示 Action receipt；尚未提交的提案保持 draft/interrupted，不产生部分事实。
- 进程恢复验收：在 text streaming、tool loading、awaiting form、awaiting confirmation、Provider retry、完成提交后分别模拟进程死亡并重新构造 production application；每种状态产生明确且幂等的恢复结果。
- orphan Run 验收：进程死亡留下 streaming Run 后，下一次启动不会永久阻塞发送；Run 被安全继续或转 interrupted，并提供可用恢复动作。
- HITL 验收：Pending Human Action 重启后恢复；Fact frontier、Safety、Mandate 或能力版本变化使旧卡 stale；ActionToken 只消费一次。
- 首次建档验收：空档案账户打开新 Conversation 后直接出现欢迎 Message 和 Baseline intake Form；不存在独立 Onboarding route、Screen 或阶段页。
- Baseline intake 验收：年龄、身高、当前体重和可选目标通过卡片或清晰自然语言进入同一 Onboarding draft；单位、来源和版本正确；重新打开新对话可预填最新 draft。
- Agent 自由推进验收：Baseline intake 后，确定性 Provider 根据不同目标调用不同允许工具/字段卡；无固定问题顺序；已提供字段不重复问；unknown 只阻塞真正依赖它的动作。
- Harness production composition 验收：真实 Conversation 入口经过 Context assembly、eligible capability manifest、Provider continuation、Tool executor、领域 Module、Artifact renderer 和 trace；不能通过直接调用内部 handler 证明 Harness 完成。
- Pi runtime 验收：production composition 必须真实构造 `@mariozechner/pi-agent-core` Agent，并验证 prompt → assistant stream → tool execution → tool result → follow-up answer 的完整事件序列；仅测试 `pi-ai` transport 或自定义 Provider adapter 不算完成。
- Pi lifecycle 验收：使用 Pi 原生 steer、follow-up、abort、beforeToolCall、afterToolCall、sequential write tool 和 parallel independent reads，证明这些事件全部映射为同一 durable Conversation；不得由第二套自研 loop 模拟预期结果。
- Pi restart 验收：在 message streaming、tool execution、awaiting confirmation 和 tool-result continuation 后分别终止进程；重建 application 时从 Ledger 恢复 Conversation，并按允许状态重建或终止 Pi Run，不序列化 Pi 内存对象、不重复执行工具。
- 唯一 runtime 清理验收：生产源码搜索不到自研 `AgentRuntime` construction、`conversation_turn_in_progress`、自定义 ProviderEvent tool-loop 或 Pi 事件转回旧 runtime 的 Adapter；`pi-agent-core` 不得只出现在 package、测试或类型引用中。
- 动态能力验收：同一用户请求在 record-only、有 Goal、GoalPath at-risk、Safety hold、不同 Coaching mandate 和 stale Fact frontier 下获得不同最小工具集合；不可见工具的伪造调用在 executor 再校验时仍被拒绝。
- Feedback 语义表驱动验收：明确已发生事件、未来意图、建议请求、部分确定数据、对象/单位含糊、偏好、执行困难、纠错和安全事件分别只产生允许结果；未来意图不写 Record，部分数据不被补零，纠错不覆盖历史。
- 自动记录验收：明确、低风险、已发生的 Timeline/Nutrition/Workout/body/outcome 数据可按默认权限自动提交，并在同一 Conversation 原位显示 receipt 与 correction action；重试不重复写入。
- 授权验收：Goal/Plan/Nutrition strategy 默认确认；always_ask、ask_this_time、allow_similar、deny 均从真实客户端可配置并影响真实 Tool execution；一次性授权被正确消费，硬 Safety 永远拒绝越权。
- 卡片矩阵验收：Structured Result、Form、Choice、Comparison、Confirmation 和 Error Recovery 均从真实 typed Artifact 渲染；普通解释不被强制卡片化；未知 renderer/schema、任意字段和导航 action fail closed。
- 知识分层验收：专业解释可检索 installed passages 并显示 refs；Ledger/Calculator 结果不被知识文本覆盖；空搜索允许低风险一般说明但必须标注无本地引用；高风险、数值和可提交动作在无固定依据时只能返回 insufficient。
- Memory 学习验收：明确偏好生成带来源 candidate；重复完成/跳过可以改变置信度；口头偏好与实际行为冲突时不静默覆盖；敏感推断和食物营养不自动写入；查看、修改、固定和删除通过真实客户端闭环。
- Stop/loop 验收：完成、等待用户、用户 stop、steer、安全阻断、权限拒绝、stale、依据不足、工具连续失败、无进展重复、步数上限和 Provider timeout 分别产生唯一 Run 终态与正确恢复界面。
- Hook 成本验收：无 material signal 的 Timeline change 和每日检查不产生 Provider request；正式 Signal 只触发一次 Harness work，并与产生 Signal 的事实和 Conversation/notification entry 建立因果链。
- Record-only 验收：用户没有目标或明确只记录时，不生成 Goal contract 或 Plan；Agent 仍可解释记录能力。
- 首次计划验收：有目标的用户在同一 Conversation 中完成目标澄清、结构化路径比较、候选生成、固定验证、确认和回执；没有任何强制页面跳转。
- 手动/Agent 等价验收：两种入口对同一确认数据产生等价领域事实；actor、causation 和 Conversation trace 保持不同且正确。
- 行为追踪验收：Provider request/response、tool validation/execution、policy decision、Artifact、HITL、领域写入和 Run terminal event 共用同一 trace/session/run identity；用户可见 Item 不泄露原始敏感值或 CoT。
- 客户端交互验收使用真实 React Native Conversation surface，而不是只测 stream reducer。覆盖长列表虚拟化、键盘、Android back、停止按钮、历史切换、屏幕旋转/进程恢复、待处理标记和卡片可访问性。
- 物理 Android 验收从全新本地账户开始：首次打开 → Baseline card → Agent 自由追问 → 结构化卡 → 中途停止 → 新消息 steer → 关闭 App → 重启 → 历史恢复 → 完成确认。整个流程录制可审阅证据并关联本地 trace short code。
- 保留并迁移现有 Coach Session runtime、Stream projection、HITL stale/CAS、Artifact Renderer、Working Memory、Trace instrumentation 和 SQLite persistence 测试作为先例；它们只能作为下层回归，不能替代最高 seam 场景。
- 完成标准必须同时包括 production composition 测试、真实客户端 E2E、关键负向场景、无旧 page-context Session 编排搜索结果，以及旧导航卡行为的物理删除。

## Out of Scope

- 图片、照片、OCR、语音、视频或其他多模态 Conversation input。
- 食物识别、食物成分数据库、条码查询、营养估算或根据名称/份量推断营养值。
- Realtime Agent、训练动作识别、Camera、Motion SDK 或当前组实时指导；只允许未来通过 typed result 接入 Conversation。
- 云端 Conversation/ProductData/Media 存储、跨设备 Session 同步或云端工具执行。
- 在本 Spec 中重新定义 Daily Health Ledger、GoalPath、Nutrition strategy、WorkoutSession 或 Plan safety 算法。
- 多 Agent 人格、Agent 之间委派、公开 Agent 选择器或面向用户的 Agent marketplace。
- 展示模型 Chain of Thought、raw prompt、raw tool arguments、Provider token 或内部安全策略细节。
- 使用一般模型知识填补营养数值、训练剂量、医学/受伤判断、目标可达性、安全结论或可提交领域变更。
- 允许 LLM 创建任意 React Native 组件、任意 Form schema、任意字段、任意导航或任意领域命令。
- 为旧页面式 Onboarding、单 active session、context-keyed session、导航型 Agent cards 或旧 cloud product sync 保留兼容层。
- 保留自研 Agent loop、Pi 与旧 Runtime 双写、Pi 失败后回退旧 Runtime，或只使用 `pi-ai` transport 而不运行 `pi-agent-core`。
- 后台无限时长 Agent 任务；V1 只保证本地前台 Run、可中断状态和重启后的安全恢复/重试。
- 重新设计普通用户自主使用的 Record、Plan、Workout 或 Profile 页面；本 Spec 只规定 Agent 不通过卡片接管其导航。

## Further Notes

- 本 Spec 采用当前领域定义的 User profile、User dossier、Goal contract、Onboarding draft、Baseline intake、Working Memory、Coach session、Artifact、Action log 和 Record，并收紧 Conversation 所需语义。
- “打开就是新对话”指从 Coach 顶层入口或点击新对话且没有显式历史 Session reference。收起/展开当前 Conversation 不应意外创建新 Session。
- “Agent 可以从旧对话获取信息”不等于把全部历史原文自动注入模型。正式要求是本地、相关性受控、带引用、受预算限制的 recall，且权威事实始终来自当前 Ledger。
- “Agent 自由发挥”指由 LLM 根据当前目标和证据选择沟通与声明过的工具，不表示模型拥有字段语义、计算、安全、确认或写入权限。
- Harness 是 Agent 的运行环境和能力边界，不是第二个固定业务流程。它应允许 Agent 根据用户目标灵活组织交流，同时把事实、权限、安全、知识来源、提交和恢复固定在本地可验证协议中。
- “Pi 作为 Agent 底座”明确指 production Run 由 `pi-agent-core` 执行，而不是只使用 `pi-ai` 类型、把云端接口命名为 Pi、或在测试里引用 `AgentOptions`。本地 Conversation Module 和 Local Product Kernel 是 Pi 周围的产品权威，不是 Pi 的替代运行时。
- 低风险自动记录与 Goal/Plan 默认确认是有意的不对称：前者减少日常记录摩擦并提供 correction，后者保护会改变未来行为的长期合同。用户仍可以通过 Coaching mandate 修改两类行为，但不能修改硬安全边界。
- “模型一般知识”只是一种低权威、不可执行的信息来源。凡是会改变正式计划、记录数值或安全判断的内容，必须回到固定工具、已安装知识或 evidence-insufficient 状态。
- 卡片的产品定义是 typed structured content renderer。是否可交互只是卡片状态与 contract 的属性；卡片不是页面导航模型。
- 当前代码中可复用的基础包括本地 Session/Run/Tool Call/Artifact/Pending Human Action、Tool Registry、Renderer Registry、HITL CAS、Working Memory、Context manifest、Action log 和 Trace。需要替换的是页面 context 决定 Session、客户端自行 hydrate/组装 Stream、隐藏完成工具轨迹、发送期间拒绝 steer，以及导航型 Card action。
