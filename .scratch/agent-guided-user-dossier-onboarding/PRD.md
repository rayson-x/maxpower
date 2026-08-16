Status: wontfix

Replaced for this product flow by `.scratch/record-first-adaptive-coach/PRD.md`. The old mandatory-goal and mandatory-first-plan flow must not be preserved as compatibility behavior.

# 对话式用户档案建立、教练评估与首次计划交接

> 来源：2026-08-13 新用户建档流程、Agent Soul、动态表单、训练水平评估和首次规划讨论。
> 遵循：ADR 0001（本地 Coach 拥有决策、工具与事实提案）、ADR 0002（确认后的产品资源由 Cloud ProductData 持久化）、`CONTEXT.md` 的 User profile、User dossier、Onboarding draft、Baseline intake、Training background、Coaching level assessment、Readiness state、Goal contract、Timeline 与确认边界。

## Problem Statement

新用户登录 MaxPower 后，目前会进入一张固定建档表。表单要求用户自行选择“训练起点”、枚举主目标、每周次数、时长、场地和 Agent 协作模式，并用默认值补齐若干尚未确认的信息。这与真实教练了解用户的方式相反：用户被迫先判断自己的训练等级，目标原话被压缩成枚举，已经在对话中说过的事实仍可能被重复询问，而未被询问的默认值又可能悄悄进入首次计划。

用户真正愿意在开始时稳定提供的只有年龄、身高、当前体重和自由语言目标。其余信息并非统一问卷里的“必填项”；哪些信息值得收集，取决于目标、现有证据、知识边界以及即将执行的具体动作。例如，日常活动未知不应阻止建立基础档案，但会阻止系统声称已经得出可信的每日能量目标；训练安全信息不足可以不妨碍保存草稿，却必须阻止相关训练能力在证据不足时继续。

系统还把 Training background、Coaching level assessment 和 Readiness state 混成一个由用户自选的 beginner/intermediate/advanced 字段。训练年限、近期连续性、某个动作的熟悉度、可比力量表现、自我调节能力和今天的恢复状态本来是不同维度。把它们合并会直接导致错误分化、错误训练量或对有经验用户重复进行新手教学。

用户期望的建档不是聊天和表单二选一，而是一段由同一个 Agent 主动推进的教练咨询：Agent 先给出简洁问候和四项 Baseline intake；用户可以填卡片，也可以直接说；Agent 从自然语言中提取有意义的信息、自动更新同一份 Onboarding draft、基于证据评估训练水平和当前状态，并仅在某个未知项会改变下一步判断时，组合合适的小表单继续询问。完成时，用户先确认完整档案草稿，再单独确认 Planner 生成的首个计划提案。

## Solution

在登录/注册之后增加明确的档案状态门控。没有完成 User dossier 的账号进入专门的对话式建档场景，完成档案后才进入 App 主页；已有档案的账号直接进入主页，普通档案修正走后续编辑或 Timeline correction，而不是重跑首次建档。

建档场景继续使用产品唯一、公共的 Agent Soul。用户面对的仍然是同一个“我”，不会出现一个持久的 Onboarding Agent 或 Planner 人格。场景差异由本地 Scenario Harness 组装：建档提示、可用工具、Field Catalog、当前草稿、Agent Knowledge、行动门槛和输出约束。云端 LLM 只接收本地组装后的模型输入和工具声明，不拥有档案规则、字段定义、工具执行或写入权限。

首次交互由自然问候、流程提示和一张 Baseline intake 卡片构成。卡片只有四项用户必填：年龄、身高、当前体重和自由语言目标。用户可以直接填写，也可以用自然语言一次说完。目标原话必须保留；其中可明确映射的当前值和目标值同时进入草稿。例如“想把体脂降到12%，目前16%”保留原始目标叙述，并分别捕获目标体脂 12% 和当前自报体脂 16%，后者作为带时间和来源的测量草稿，测量方法保持 unknown，不能被系统改写成计算值。

四项完成后进入目标驱动的信息收集循环。产品提供版本化 Field Catalog，定义允许写入的字段、领域所有者、类型、单位、校验、来源要求、敏感性、展示方式和 `requiredFor` 行动门槛。Agent 可以根据当前目标自由选择、组合和排序目录里的字段，生成当前最有信息价值的小表单；Agent 不能发明新的字段语义、单位、校验或写入目标。对话输入与表单输入写入同一条 append-only Onboarding draft 事件流，并立即成为彼此的下一轮上下文。

Agent 不再询问用户“你是初级、中级还是高级”。它从用户明确提供的 Training background、近期 Timeline、动作记录和行为证据中生成版本化、可复核的 Coaching level assessment，并把当天或近期的状态单独形成有时间窗的 Readiness state。评估是 Planner 输入，不是用户事实；每个判断必须带支持证据、反证、未知项、适用动作/维度、评估时间和重新评估条件。证据已经足够时不再追问；证据不足但不影响首次方案时，以保守起点和后续校准代替问卷；只有缺失信息会实质改变当前计划、安全门槛或目标可达性时才问一个具体问题。

当 Agent 判断已有信息足以建立档案并请求首次计划时，展示一份按领域组织的 User dossier 草稿摘要，明确区分用户事实、目标、Agent 评估、当前状态、未知项和将因此受限的能力。用户可以通过对话或卡片修正，最终进行一次档案确认。确认后，CoachApplication 在最新 draft revision/fact frontier 上校验并提交对应的 User Profile、Goal Contract、Coaching Mandate、Permission Set、Safety Constraint 和 Timeline 基线；正式资源只有在 ProductData 接受后才显示为已完成。

档案提交成功后，PlannerHarness 作为短生命周期内部任务读取确认后的 User dossier、Goal Contract、Coaching level assessment、Readiness state、Agent Knowledge 和本地规则，生成首个计划提案。档案确认不等于计划确认；计划必须展示关键依据、未知带来的保守项和后续校准点，并经过独立确认后才能成为活动计划。

## User Stories

1. As a 新注册用户, I want 登录成功后自动检查我是否已有完成档案, so that 我不会在没有基础上下文时误入主页或开始规划。
2. As a 新注册用户, I want 没有档案时进入专门的建档流程, so that 我能在使用其他功能前完成一次有上下文的教练咨询。
3. As a 已有档案用户, I want 登录后直接进入主页, so that 我不会被重复要求建档。
4. As a 回访用户, I want 未完成的建档草稿能够恢复到上次进度, so that 网络中断或退出 App 不会让我重填。
5. As a 用户, I want 建档和主页对话使用同一个 Agent 身份与说话风格, so that 产品不会像在不同机器人之间跳转。
6. As a 用户, I want 建档开始时听到简短自然的问候和流程说明, so that 我知道接下来会发生什么而不会感到系统化审问。
7. As a 用户, I want 第一张卡片只要求年龄、身高、当前体重和自由语言目标, so that 我能用最低负担开始建立档案。
8. As a 用户, I want 年龄、身高和体重都支持明确单位及本地校验, so that 单位误解不会进入计划。
9. As a 用户, I want 年龄按采集日期保存其时间语义, so that 系统不会把多年以前的年龄永久当成当前事实。
10. As a 用户, I want 系统根据年龄推算出生年份时只保留候选范围, so that 未知生日不会被猜成确认事实。
11. As a 用户, I want 目标字段允许我直接说“体脂降到12%”“宽肩窄腰”或“减脂时保持卧推”, so that 我的真实目标不会被迫塞进一个粗糙枚举。
12. As a 用户, I want 目标原话与消息来源被保留, so that 后续结构化解释仍可追溯我的真实表达。
13. As a 用户, I want 一句话中的多个明确信息被一次吸收, so that 我不必按系统问题逐项重复回答。
14. As a 用户, I want “目标体脂12%、目前16%”分别进入目标和当前测量草稿, so that Planner 不会混淆起点与终点。
15. As a 用户, I want 自报体脂的方法未知时继续标记 unknown, so that 系统不会假装这个数字具有不存在的测量精度。
16. As a 用户, I want 我可以选择填写卡片或直接说出答案, so that 交互适应我当时更方便的输入方式。
17. As a 用户, I want 我在对话里提供的信息自动预填到表单草稿, so that 对话和表单不会成为两套重复流程。
18. As a 用户, I want 我在表单中修改的信息立即进入下一轮对话上下文, so that Agent 不会继续基于旧值说话。
19. As a 用户, I want 所有输入都进入同一份可恢复的 Onboarding draft, so that 任一界面看到的档案状态一致。
20. As a 用户, I want Agent 能根据我的目标动态组合下一张小表单, so that 减脂、增肌、力量和体型目标不会走同一套僵化问卷。
21. As a 用户, I want 动态表单只出现产品已定义且能解释的字段, so that 模型不会临时发明含义不明的数据项。
22. As a 用户, I want 表单字段的标签、单位、选项和校验在不同会话中保持一致, so that 同一个事实不会因模型措辞而改变语义。
23. As a 用户, I want Agent 先使用我已经说过的内容再追问, so that 我不会因为场景切换而重复回答。
24. As a 用户, I want 未知但暂时不影响下一步的信息保持为空, so that 我不必为了“完整度”填写无意义的答案。
25. As a 用户, I want 明确说“不知道”后系统不立即重复追问, so that unknown 被当成有效状态而不是输入失败。
26. As a 用户, I want 只有当某项缺失会改变具体计划、安全或计算结果时才被追问, so that 每个问题都值得我回答。
27. As a 用户, I want Agent 说明某个问题将影响什么决定, so that 我能判断是否愿意补充或暂时跳过。
28. As a 用户, I want 跳过非基础字段时看到受影响的具体能力而不是被阻止完成全部建档, so that 我仍能逐步开始使用产品。
29. As a 用户, I want 安全相关证据不足时只暂停相关高风险能力, so that 系统既不越过边界，也不把所有档案功能锁死。
30. As a 用户, I want Agent 不要求我自己选择 beginner/intermediate/advanced, so that 教练判断不会被转嫁给我。
31. As a 有训练经验的用户, I want Agent 从训练年限、近期分化和可比训练组理解我的背景, so that 我不会被默认安排新手两分化或全身训练。
32. As a 回归训练用户, I want 累计训练年限和近期连续性分别评估, so that 过去经验不会掩盖当前需要重新校准的事实。
33. As a 用户, I want 不同动作的熟悉度分别评估, so that 熟悉卧推不会被错误扩展为熟悉所有自由重量动作。
34. As a 用户, I want 力量记录同时保留动作变式、重量、次数、RIR/RPE、日期和条件, so that Planner 只比较真正可比的表现。
35. As a 用户, I want Agent 把训练编排理解、动作熟悉度、当前表现、连续性、自我调节和执行稳定性分开判断, so that “训练水平”不会被压成一个误导性标签。
36. As a 用户, I want Agent 不仅凭我会不会说 RIR、分化等术语判断水平, so that 复制术语或表达习惯不会造成错误计划。
37. As a 用户, I want Coaching level assessment 明确标记为系统评估而非我的事实, so that 我可以理解并纠正它依据的记录。
38. As a 用户, I want Agent 已有足够证据时不再问“你练了多久”等低价值问题, so that 对话接近真实教练而不是固定问卷。
39. As a 用户, I want 证据不足但风险不高时从保守方案开始并通过首几次训练校准, so that 我无需在训练前回答所有可能的问题。
40. As a 用户, I want 今天的睡眠、疲劳、酸痛和时间可用性形成独立 Readiness state, so that 它们不会永久改变我的稳定档案。
41. As a 用户, I want Readiness state 到期或出现新事实时重新评估, so that 昨天睡差不会长期给我贴标签。
42. As a 用户, I want 临时日程和当天状态进入 Timeline 而不是稳定 Profile, so that 长期档案与短期现实保持清晰边界。
43. As a 用户, I want 冲突的新旧表述被并列展示并让我选择, so that 系统不会静默覆盖真实历史。
44. As a 用户, I want 单位换算或枚举归一化结果可以在卡片中复核, so that Agent 的结构化理解有错时容易纠正。
45. As a 用户, I want 计算值、估计值和我明确说出的值使用不同状态展示, so that 推断不会伪装成事实。
46. As a 用户, I want 无法映射但可能有用的线索暂存在非权威 Working Memory, so that 内容不会丢失也不会直接驱动计划。
47. As a 用户, I want 档案完成前看到按领域组织的完整草稿摘要, so that 我能一次检查系统到底理解了什么。
48. As a 用户, I want 摘要区分事实、目标、Agent 评估、当前状态和未知项, so that 不同可信度的内容不会混在一起。
49. As a 用户, I want 在最终确认前通过对话或表单修改任意草稿项, so that 我不用退回流程重新开始。
50. As a 用户, I want 档案确认只提交我看到的最新版本, so that 并发更新或旧卡片不会写入过期数据。
51. As a 用户, I want 云端确认失败时保留本地草稿并明确未完成, so that App 不会把未持久化的数据谎称为已保存。
52. As a 用户, I want 档案完成后自动进入首次计划准备, so that 我不必重新向主页 Agent 复述目标。
53. As a 用户, I want Planner 使用确认档案、训练水平评估、当前状态和审核知识生成计划, so that 首次计划不是仅按四个数字套模板。
54. As a 用户, I want 首次计划解释关键安排依据和仍待校准的未知项, so that 我知道为什么这样练以及何时会调整。
55. As a 用户, I want 档案确认和计划确认是两个独立动作, so that 接受系统对我的理解不等于接受一份具体计划。
56. As a 用户, I want 在我确认前任何计划提案都不成为活动计划, so that 错误或不满意的方案不会悄悄执行。
57. As a 用户, I want 计划被拒绝或修改后档案仍保持完成, so that 我不用重复建档才能比较新方案。
58. As a 用户, I want 完成建档后进入主页并继续与同一个“我”对话, so that 首次流程自然衔接日常教练体验。
59. As a 开发者, I want 每个草稿字段都带来源、状态和版本, so that 可以回放它为何出现并安全处理更正。
60. As a 开发者, I want 记录 Agent 选择了哪些字段、为何展示表单以及用户是否填写, so that 可以分析问题价值和建档流失而不记录思维链。
61. As a 开发者, I want 隐藏或无权调用的工具在执行时仍被拒绝, so that 模型不能绕过当前建档场景的能力边界。
62. As a 开发者, I want 每次模型调用钉住 Soul、场景、Field Catalog、知识、规则和能力清单版本, so that 建档行为可以确定性审计和回归。
63. As a 开发者, I want LLM 工具结果回灌同一 run 后再生成回复, so that Agent 不会在不知道保存或校验结果时声称成功。
64. As a 产品方, I want 看见四项基础字段完成率、有效追问率、重复提问率、冲突率、确认率和首次计划接受率, so that 能判断建档体验是否真的像教练而不是更复杂的表单。
65. As a 产品方, I want 观察不同目标下的追问数量和首次计划质量, so that 动态收集不会对某类用户形成隐性长问卷。
66. As a 产品方, I want 云端模型看不到未被本地 Harness 明确装配的档案上下文, so that 远端只承担语言生成而不拥有产品判断。

## Implementation Decisions

### 场景入口与身份

- 认证完成后，产品壳先读取当前账号的 User dossier completion projection。状态为 `completed` 才进入主页；`not_started`、`in_progress`、`ready_for_confirmation`、`commit_pending` 或 `safety_hold` 进入对应建档状态。
- 主页面对话、首次建档、训练观察和定时检查共用一个版本化 Agent Soul。场景由 Scenario Harness 的 task kind、目标、输入投影、能力清单、输出协议和完成条件区分；不创建对用户可见的长期子人格。
- Onboarding 是任务作用域的对话会话。Planner 是档案确认后由主 Harness 启动的短生命周期内部任务；它不拥有独立用户聊天历史或提交权限。
- 建档开始回复必须短、自然、面向当前任务，不出现“AI”“系统提示”“数据不足所以不会猜”等模板化自我说明。未知处理通过行为体现，只有影响用户选择时才解释。

### 四项 Baseline intake

- 全局固定的用户必填字段恰好为四项：年龄、身高、当前体重、自由语言目标。产品不得通过其他名称重新增加固定必填问卷。
- 年龄保存为 `ageYears + observedAt`；若用户愿意提供生日或出生年，可另存其精度。由年龄倒推的出生年份是候选区间，不是确认事实。
- 身高和体重必须带规范单位、允许用户常用单位输入并在本地归一化。任何默认身高、默认体重或根据外观估计的值都禁止进入草稿。
- 目标同时保留 raw narrative/message reference 和结构化 Goal draft。目标分类、目标指标、保护指标、当前起点、视觉意图和时间要求可以从同一段话分别捕获，但原文始终可追溯。
- 初始卡片是四项 Baseline intake 的结构化入口，不是唯一输入方式。用户自然语言提供的相同字段必须写入同一草稿并实时反映在卡片上。

### Field Catalog 与动态表单

- 建立由产品拥有、版本化的 Field Catalog。每个字段定义稳定 ID、领域所有者、值类型、单位、范围/组合校验、允许来源、敏感级别、展示控件、写入命令、依赖关系和 `requiredFor` 行动门槛。
- Field Catalog 覆盖可进入 User Profile、Goal Contract、Coaching Mandate、Permission Set、Safety Constraint、Timeline baseline、Nutrition Strategy 和 Working Memory 的候选字段，但目录存在不代表必须在首次建档收集。
- Agent 可请求一个动态 Form Card，并从当前 Field Catalog 自由选择字段 ID、主题、排序和本轮焦点。卡片渲染器只接受目录中字段，不接受模型生成的新 schema、枚举、单位、校验或写入目标。
- 每个 Field Catalog 条目同时拥有交互定义：自由叙述使用单行/多行文本，精确量值使用数字与单位输入，互斥枚举使用单选，可并存条件使用多选，日期时间使用原生选择器；只有具备明确上下界、允许近似表达的主观连续量才可使用分段或滑动控件。滑动控件必须显示数值、刻度、步长并提供可访问的增减替代；重量、围度、热量和训练组表现不得使用会损失精度的滑动输入。
- 复合事实使用产品定义的字段组而不是拼接文本。例如训练组以动作变式、重量、次数、RIR/RPE、日期和条件共同构成，并作为一次可校验提交写入草稿。
- Agent 对字段的选择必须基于当前目标、已知草稿、Agent Knowledge 返回的 intake requirements、具体 `requiredFor` 门槛和最近问题历史。选择结果带闭集 reason code，例如 `goal_disambiguation`、`planning_gate`、`safety_gate`、`measurement_quality`、`schedule_feasibility` 或 `conflict_resolution`。
- 每张后续卡片应围绕一个连贯主题，并默认保持小规模。一次用户回答包含多个主题时全部吸收，不强制按卡片顺序重问。
- `ui.request_choice` 继续用于真正阻塞的离散选择或最终确认，不承载持续表单草稿。动态表单使用可持久化、可编辑的 Onboarding draft 投影。

### Onboarding draft 与来源

- 对话捕获和表单提交追加到同一条草稿事件流。草稿投影按字段解析当前值，保留历史、来源、冲突和 supersession；不使用会覆盖整个嵌套 section 的浅合并。
- 每个字段至少支持 `empty`、`captured_explicit`、`normalized_needs_review`、`estimated_needs_review`、`confirmed`、`invalid`、`conflicted` 和 `explicit_unknown` 状态。
- 用户直接陈述或表单输入是 explicit capture，可自动预填草稿；它仍要在最终档案确认中整体确认。自然语言到产品枚举、范围或规范单位的映射是 normalized capture，并显示可编辑的人类标签。
- 公式、模型、区间估计或 Agent 判断是 estimated/assessment，不得覆盖 explicit capture。所有计算必须记录 calculator/normalizer 版本和输入引用。
- 新事实与旧值矛盾时追加 conflict 事件并要求用户选择或解释。不得静默最后写入获胜，也不得删除旧来源。
- 用户明确不知道或不愿提供时记录 `explicit_unknown`，并抑制同一上下文中的重复追问。只有门槛变化或用户随后提供新线索时才能重新提出。
- 无法映射到权威字段的线索只能进入 Working Memory，标记非权威、来源和过期条件；不得直接成为 Planner 数值输入或正式档案事实。

### 目标驱动的追问和知识使用

- Baseline intake 完成后，Harness 调用审核过的 Agent Knowledge，召回与目标模式、身体/训练背景、计划动作和安全边界相关的 Decision/Intake requirements。知识返回的是候选事实需求、适用条件、unknown 行为和证据引用，不直接替用户下判断。
- 追问的判定标准是“缺失信息是否会改变下一步可观察决策”。单纯提高档案完整度、满足旧完成校验或方便模型发挥都不能成为追问理由。
- 一个未知项可以阻止特定行动而不阻止建档。例如日常活动未知可以阻止可靠能量目标；确切训练日未知可以阻止排定日期但不阻止生成训练结构草案；相关安全状态未知可以阻止空腹有氧、HIIT 或具体训练执行。
- 若信息不会改变首计划，Agent 应使用明确的保守默认策略或建立首阶段校准任务，而不是追问。保守策略属于计划假设，不能反写为用户事实。
- 用户已提供足够事实时，Agent 不得重复询问同义问题。问题生成前必须查询当前草稿、历史来源、explicit unknown 和冲突状态。
- 一轮可以自然询问一个主题，也可以发送一张相应卡片；不要求每次提问都产生卡片。需要准确单位、多个选项、批量编辑或最终复核时优先卡片。

### Training background、Coaching level assessment 与 Readiness state

- 移除用户自选训练等级作为首次计划的权威输入。旧 `trainingExperience` 可保留为历史数据，但新建档流不再采集，也不得作为 Planner 选择分化、训练量或动作复杂度的唯一依据。
- Training background 保存用户可确认的事实：累计训练时间范围、最近连续训练窗口、停训、近期分化、常用动作、可比训练组、训练场景、可用器械、日程和既往执行情况。
- Coaching level assessment 是独立、版本化的评估制品，不写成 User Profile 事实。它按训练编排理解、exact exercise familiarity、当前可比表现、训练连续性、自我调节能力和执行稳定性分别输出 `supported`、`provisional`、`unknown` 或 `contradicted`，并携带证据引用、评估时间、适用范围和复核条件。
- 术语熟练度只能作为弱证据，不能单独提升任何维度。训练年限也不能单独证明动作质量、当前负荷承受能力或执行稳定性。
- Readiness state 是带起止时间/有效期的当前状态，来源于近期睡眠、疲劳、局部酸痛/疼痛、表现、压力和可用时间。它进入 Timeline/Recovery 风险投影，不作为永久档案字段。
- Planner 同时读取 Training background、Coaching level assessment 和 Readiness state。分化、动作复杂度、起始训练量和校准速度必须说明依赖了哪类证据，不能退化为单一等级映射。
- 首两次或首个短周期训练是正式校准窗口。新完成记录、用户修正和实时最终剂量可以更新 assessment/readiness，但不得改写原始背景事实。

### User dossier 所有权与完成

- User dossier 是组合投影，不新增万能 Profile aggregate。稳定个人事实进入 User Profile；目标、期限、成功指标和取舍进入 Goal Contract；授权进入 Coaching Mandate；系统权限进入 Permission Set；可执行安全边界进入 Safety Constraint；体重、围度、体脂、睡眠、恢复和训练表现等时序事实进入 Timeline。
- 当前体重和当前体脂等测量由 Timeline 拥有，User dossier 只投影最新可用值。Goal Contract 可以引用某个 baseline fact 作为目标起点，但不能复制后形成第二个权威值。
- Baseline intake 四项齐全只代表进入动态评估的最低条件，不代表首个计划一定可生成。后续阻塞必须由明确的 `requiredFor` 行动门槛产生，而不是另一张固定完成清单。
- 建档完成前展示可编辑摘要，至少分组呈现：用户事实、目标合同、训练背景、Agent 评估、当前状态、授权/权限、安全限制、未知项及其影响。
- 最终确认针对一个不可变 draft revision 和 fact frontier。确认过程中草稿发生变化时，旧确认变 stale，系统展示差异并重新确认。
- CoachApplication 是完成命令的事务 seam。它校验来源、门槛、权限、授权、冲突和版本后产生正式资源提案；LLM、表单组件和移动端页面都不能直接写正式资源。
- 按 ADR 0002，确认后的 Profile/Goal 等产品资源只有得到 Cloud ProductData 的 revision/idempotency acknowledgement 才成为 durable `completed`。提交失败保留本地草稿及确认意图，显示 `commit_pending` 或失败，不伪造完成。

### 首次计划交接

- 档案完成事件触发主 Harness 启动 PlannerHarness 的首次规划任务，并传入确认后的 User dossier refs、Goal Contract、Coaching level assessment、Readiness state、当前 Agent Knowledge/规则版本和 fact frontier。
- PlannerHarness 可以检索知识、比较方案和调用确定性 PlanningEngine，但不能直接提交计划、写 Timeline 或独立与用户维持会话。
- 首次计划必须通过目标、恢复、动作联动/疲劳、训练水平、日程、器械、营养/有氧和安全约束验证。信息不足时返回 `needs_input` 或带明确校准项的保守 proposal，而不是补造事实。
- 首次计划以 proposal 展示，与档案确认分离。用户确认计划时再次校验 Goal Contract、事实前沿、规则和知识版本；过期提案必须重算。
- 计划确认成功后才进入主页活动计划体验。用户拒绝或要求修改计划不会撤销已经确认的档案。

### 本地 Harness、云端与可观测性

- 本地 Scenario Harness 组装 Soul、场景提示、Field Catalog、知识片段、草稿投影、权限、能力清单和输出协议。云端 LLM Gateway 只做认证、配额、路由和流传输。
- 工具由本地 capability assembly 暴露，LLM 自行选择；执行时 ToolRegistry 再校验当前 manifest、权限、mandate、schema、来源和幂等，隐藏工具即使被模型点名也必须拒绝。
- 工具执行结果必须回灌同一 Agent run。Agent 只有读取真实的保存、校验、冲突、确认或 Planner 结果后才能向用户声称相应状态。
- 每轮记录 Soul version、scenario version、Field Catalog version、knowledge/rule pins、draft revision、fact frontier、可见能力、工具选择/拒绝、字段捕获来源、动态表单字段及 reason code、评估证据、确认与 commit 结果。
- 可观测性只保存结构化行为决策和因果引用，不保存模型 Chain of Thought。产品可以回答“为什么问这个字段、为什么没问、为什么不能生成计划”，但不暴露或持久化私有推理。
- 关键产品指标包括 Baseline intake 完成率、每用户动态问题数、重复问题率、问题跳过率、explicit unknown 复问率、自动捕获接受/修正率、冲突率、档案确认率、首次计划 needs-input 率、计划接受率和建档至首计划时长。

## Testing Decisions

### 什么是好测试

- 测试只断言用户或外部端口可观察到的行为：登录后的路由、对话文本类别、展示字段、草稿事件和来源、摘要、确认状态、正式资源、Planner proposal、活动计划和审计记录。不得断言 prompt 原文、模型思维过程、私有评分公式或内部类调用顺序。
- 确定性场景使用 Scripted LLM Provider 产生明确 Tool Calls，同时用真实 ToolRegistry、Onboarding draft、CoachApplication、Field Catalog、知识后端和本地/云 ProductData 测试替身。真实 Provider 测试只用于评估表达变体下的工具选择和不必要追问，不替代确定性验收。
- 测试必须证明 unknown 不等于 false、估计不等于事实、assessment 不等于 Profile、档案确认不等于计划确认，以及 plan proposal 不等于活动计划。

### 主验收 seam

- 主要且最高层的验收 seam 是 CoachApplication 驱动的一次完整 Onboarding scenario：空档案账号登录 → 专门建档场景 → 四项 Baseline intake → 自然语言自动捕获 → 目标驱动动态表单 → 多维水平/状态评估 → 档案摘要与确认 → durable resource acknowledgement → Planner 首次提案 → 独立计划确认。
- 同一个 seam 必须能接受“用户填卡片”和“用户直接说”两种输入，并证明相同明确事实形成等价领域结果和来源不同的审计记录。
- 移动端只对这个产品 seam 做薄投影：验证未建档不能进入主页、动态字段正确渲染/编辑、恢复草稿、最终摘要、错误状态和确认交接。业务判断不在 UI 测试中复制。

### 必测场景

- 新账号、已有档案账号、未完成草稿、提交中断后重启和账号切换的路由隔离。
- 初始四项分别通过卡片、单条自然语言、混合输入和一次性长回答完成；缺项、非法单位、边界值和更正可恢复。
- “想把体脂率降到12%，目前16%”保留原话，并生成目标体脂与当前自报体脂两个不同所有者/状态的草稿项；方法保持 unknown。
- 用户自然说明四分化、深蹲 100×3、卧推 80×5、硬拉 110×4 后不再被要求自选训练等级，也不被默认安排普通新手训练；exact variant、RIR 或连续性仅在确实影响当前计划时追问。
- 相同用户目标下，已知近期连续性与未知连续性产生不同的 assessment 或校准项，但不会把 unknown 自动判为 novice。
- 昨晚睡差、局部腿酸等输入进入 Readiness state/Timeline，并在有效期后重新评估，不永久改变 Training background。
- explicit user fact、normalized mapping、calculator estimate、Agent assessment、import 和 explicit unknown 在摘要中状态/来源不同；估计不会覆盖自报值。
- 新旧体重、目标期限或训练记录冲突时生成冲突状态；用户选择后以追加事件解决，旧证据仍可回放。
- 用户一次说出训练场景、频率、时长和饮食情况时全部捕获，后续问题不重复已知项。
- 非必要字段为空仍可进入摘要；缺少 daily activity 时档案可完成，但可靠能量目标返回 needs-input；缺少特定安全事实时仅相关能力被门控。
- Agent 请求未注册字段、隐藏工具、错误单位写入或无来源正式提交时被本地拒绝并留下结构化审计。
- 动态表单只含 Field Catalog 字段；目录版本变化不会改变已有草稿事件语义，旧卡片提交按版本校验。
- 文本、数字+单位、单选、多选、日期时间、允许近似值的分段/滑动和复合训练记录均有数据往返测试；验证显示精度、unknown、来源和可访问替代交互不会在提交/恢复后丢失。
- 最终确认使用旧 draft revision 时失败并展示变化；同一确认命令重试幂等。
- ProductData 未 acknowledgement 时 completion projection 不变为 completed；恢复后重试不产生重复资源。
- 档案确认后 Planner 得到正确 refs 与版本钉；计划确认前活动计划不变，拒绝提案不删除档案，事实更新令旧提案 stale。
- LLM 断流、ToolResult 失败、App 重启和恢复对话时不重复写草稿或正式资源，也不出现“已保存/已生成”虚假文案。
- 同一事实档案以不同自然语言表达时，Field Catalog 结果、assessment 证据、Planner 硬约束和正式资源语义一致；不要求回复逐字一致。
- 可观测性能够从最终计划回溯到档案确认、字段来源、assessment、知识/规则版本和 Planner 验证，且任何记录都不包含 Chain of Thought。

### 既有先例与补充测试

- 复用现有 CoachApplication facade、Onboarding draft/service、Scripted LLM Provider、ToolResult loop、HITL confirmation、ProductData revision/idempotency、Planner proposal/confirmation 和行为 trace/outbox 测试方式。
- Field Catalog 校验、字段事件 reducer、单位归一化和 assessment evidence closure 可以增加少量纯契约测试，但不得成为取代主场景验收的第二套业务真相。
- 真机 E2E 在功能通过确定性主 seam 后执行，使用真实登录账号和真实云 LLM transport，验证首次安装、登录、动态卡片、键盘/中断恢复、档案提交、首次计划展示与确认；真机测试不得依赖开发机本地服务器。

## Out of Scope

- 收集一份“完整健身教练问卷”，或把 Field Catalog 中所有字段都塞进首次建档。
- 让用户自选 beginner/intermediate/advanced 作为权威训练水平，或设计一个公开的单一训练等级分数。
- 允许 LLM 在运行时发明档案字段、JSON schema、单位、校验、领域所有权或数据库列。
- 用对话推断疾病、伤病诊断、饮食失调诊断、体脂真值、动作质量真值或医学结论。
- 自动确认档案、自动提交首次计划或把用户允许协作理解为放弃确认。
- 把 Planner 建成第二个持久可见人格、独立聊天线程或远端服务 Agent。
- 重做主页日常调整、实时训练观察、定时风险检查的完整行为；本 spec 只定义同一 Soul 的场景边界与建档后的交接。
- 本轮完成所有目标模式的 Agent Knowledge 内容建设；本 spec 只要求使用已审核、版本化的 intake requirements 和规划知识。
- 迁移所有历史 Profile 数据到新评估模型；旧字段可读取作证据，但新路径不做双写兼容或以旧枚举兜底。
- 照片体型评估、动作视频水平评估、Health Connect/HealthKit 自动导入和多设备草稿实时协作。
- 向用户展示模型 Chain of Thought、内部置信公式或未经校准的成功概率。
- 改变 ADR 0002 的云端确认资源所有权，或让 LLM Gateway 执行档案/计划写入。

## Further Notes

- 本 spec 的关键边界是“只有四项全局固定必填”不等于“只用四项就能科学生成所有计划”。其他信息只能由具体行动的 `requiredFor` 门槛临时要求；门槛必须可解释、最小化，并允许用户看见跳过的后果。
- “Agent 自动评估水平”不是凭语言风格猜一个标签。它是从可引用事实形成多维、会过期和可更新的 Coaching level assessment；没有证据的维度保持 unknown，并通过保守计划和后续真实执行校准。
- 首次计划质量的主要反例是：有一定训练年限且已有四分化/可比力量记录的用户，被仅凭目标枚举重新安排成普通新手两分化。该案例应成为主 E2E 的长期固定回归样本。
- 当前固定表单路径与新路径是替换关系，不做两个同时接入的兼容模式。旧数据可以作为来源读取，旧页面和用户自选等级不得继续成为新用户默认入口或 Planner 的隐式 fallback。
- 交互语气由公共 Agent Soul 负责，建档 Harness 只提供任务约束和当前上下文。用户可以在未来定义 Agent 称呼或外观，但本轮不让产品反复强调 Agent 自己的名字。
- 当需求无法仅靠现有信息确定时，将它转为可验证假设：例如首周训练量采用保守起点，观察两次可比完成、RIR、酸痛和恢复；成功信号与复核时间写进计划，而不是为了避免未知继续增加问卷。
- 推荐上线前对三组档案做同条件回放：明确有经验且稳定训练、曾有经验但近期回归、信息很少的新手。比较追问数量、错误等级判断、首计划适配、用户修正率和完成时长，再决定动态表单每轮字段上限。
