# 适合持续自适应 Planner 的领域知识数据建设：MaxPower 架构调研

日期：2026-08-13
状态：探索结论；只做架构调研，不修改代码
研究边界：面向健身计划的非医疗 Planner；参考临床决策支持只为学习知识工程与执行架构，不把 MaxPower 定位为医疗器械或诊疗系统。

## 结论先行

MaxPower 的主要缺口不是某一种存储技术，而是缺少一套让 Planner 能依次完成 **快速理解/召回、适用性判断、计划构造、解释、持续调整** 的领域知识数据。核心是位于知识内容与具体计划之间、可确定性求值的 **Planning Decision Model**：它必须把领域知识拆成事实、规则、约束、目标、动作和结果观测，并明确缺失、冲突、不适用与不确定状态。

建议采用混合架构，而不是让一个统一知识库或一种数据模型承担全部任务：

1. `KnowledgePackRegistry` 继续保存版本化的证据、动作/刺激目录、检索索引和策略声明；新增一个可验证、可编译的决策知识 IR。
2. `Ledger + Timeline` 继续作为用户事实、事件顺序、来源和修正历史的唯一事实来源；不要迁入共享知识图。
3. 规则求值器把知识与当前用户状态结合，产出适用策略、硬约束、软偏好、缺失事实、行动候选和观测要求。
4. `GoalCyclePlanner` 采用 HTN 式分解生成计划骨架，再用约束满足/排序完成排期与动作配置。
5. 每次只确认和执行近期行动；Timeline 新事实到来后重新求值未来部分。这借鉴 JITAI 的“决策点—裁剪变量—行动—近端结果”结构和 receding-horizon 思路，但不声称控制理论本身证明了健身效果。
6. LLM 只负责事实提取候选、向用户解释和提问；不得凭自然语言段落生成未经验证的数值规则，也不得替代确定性求值器。

**Go / No-go：**

- **Go**：做一个版本化、JSON/TypeScript 表达的 DecisionPack IR。首版可以是 typed tables + rule dependencies，不必采用 nodes/edges；它应能编译成确定性规则与约束，并追溯到证据。
- **No-go（当前 MVP）**：引入 Neo4j、RDF store 或把 Ledger、Timeline、Plan 全面改成图数据库。
- **No-go**：让 LLM 或 Graph traversal 本身承担 Planner 的数值优化、状态转移与安全判断。

### 能力与数据形态的直接对应

| Planner 能力 | 主要数据 | 合适机制 | 不应依赖 |
|---|---|---|---|
| 快速理解/召回 | 术语、别名、主题、摘要、原文、citation | typed catalog + 分层 search index | LLM 记忆、全包塞入上下文 |
| 判断 | 适用条件、排除条件、缺失要求、证据边界、优先级 | typed decision tables / executable rules | 相似文本命中、模糊 `related_to` |
| 规划 | 任务分解方法、动作定义、资源、硬/软约束、目标函数 | HTN-like templates + constraint model + scorer | 纯 RAG、纯图遍历 |
| 解释 | 事实引用、命中规则、排除候选、证据、版本 | evaluation trace + provenance index | 保存模型思维链 |
| 持续调整 | 决策点、tailoring variables、近端/长期结果、观察窗口 | Timeline projection + event/timer triggers + policy reevaluation | 只看静态 Profile 或最终体重 |

因此建设顺序应从“Planner 要回答什么问题”反推数据，而不是先选 graph、vector database 或 rule engine。

---

## 一、按四象限原则确认问题

### 1. 共同已知：目标、背景、交付标准和边界

共同目标不是“能检索健身知识”，而是：同一套领域知识面对不同用户目标、训练水平、执行结果、恢复状态和偏好时，能生成不同、可解释、可回放的未来计划，并在新事实出现后稳定调整。

当前仓库已经具备重要基础：

- `KnowledgePack` 已将 manifest、版本 pin、动作目录、规则包声明、Wiki 与 `programStrategies` 放在一个版本化资产中（`src/knowledge/model.ts`）。
- `KnowledgePackRegistry` 已支持版本 pin、历史包回放、动作查询/替换和知识段落检索（`src/knowledge/KnowledgePackRegistry.ts`）。
- `PlannerFacts` 已把 Profile、GoalContract、Mandate、安全/器械/恢复/营养约束、Timeline 和先前计划分开（`src/planning/model.ts`）。
- Timeline envelope 已保存时间、来源、置信度、数据状态、因果和证据引用，并明确 `missing / stale / estimated / conflict` 等状态（`src/timeline/model.ts`）。
- Ledger 是事件和修订事实的原子提交边界，支持投影与冲突检测（`src/coach/ledger.ts`）。
- `PlannerTrace` 已保存输入指纹、分化选择、slot 选择、约束事件和周量，但还没有完整的规则求值、目标得分和观测闭环（`src/planning/model.ts`）。

本地包的实际形态也不是纯文本：当前构建产物约有 33 个 exercise concept、379 个 variant、33 个 stimulus contract、5 个 split rotation、5 个 diet strategy、263 个 passage、44 个 citation、5 个 executable rule pack manifest。数据规模很小，客户端内存索引足够；没有性能理由先引入图数据库。

本研究的验收标准：

- 必须区分 declarative knowledge、executable rules、state/facts、constraints、objectives/utilities、actions、observations/outcomes；
- 必须技术中立地比较 typed tables、search、rules、constraints、event ledger 与 Graph 的职责；
- 必须给出可映射到现有代码边界的接口和 trace；
- 必须允许 `unknown / insufficient_evidence / conflict / infeasible`，而不是用默认模板掩盖未知；
- 必须给出最小可逆实验，而不是先做全量迁移。

### 2. 用户已知、系统未知：应通过交互或记录获得，而不是由知识库猜测

以下信息本质上属于用户状态或偏好，不属于全局领域知识：

- 用户真正优先保护什么：目标日期、减脂速度、力量、肌肉量、社交饮食、训练体验或时间负担；
- 哪些是硬边界，哪些可以交易：每周训练天数、某天必须休息、动作锁、饮食方式、是否接受进度变慢；
- 当下状态：疼痛/酸痛、睡眠、主观恢复、可用时间、器械、外食和实际训练结果；
- 用户是否愿意执行某个行动，以及同一建议在现实生活里的成本；
- 视觉目标的主观优先级，例如“宽肩窄腰”中更在意腰围下降还是肩背改善。

系统应把缺失信息分为三类，而不是一律追问：

| 缺失类型 | 行为 |
|---|---|
| 会改变安全性或使候选计划不可行 | 阻止自动计划，最多提出关键问题 |
| 会改变多个合理方案的排序 | 给出候选和 trade-off，请用户选择 |
| 只影响小幅优化 | 采用标记过的保守默认值，计划中声明假设并安排观察 |

这与约束式推荐系统的基本结构一致：兼容性约束先决定哪些选项可行，utility/scoring rule 再决定呈现顺序；原始研究也提醒，错误的 scoring rules 会产生专家不接受的排序，而且修复耗时、易错。因此偏好权重必须版本化、可测试，不能藏在 prompt 或匿名分数里。[Felfernig et al., 2013，原始研究论文](https://doi.org/10.3233/AIC-120543)

### 3. 用户未知、系统已知：应由系统主动补充并进入 Planner

系统应掌握并结构化表达：

- 领域事实与证据边界：某项研究支持什么、不能推出什么、适用人群；
- 安全边界与转介条件；
- 计划构造方法：目标如何分解成阶段、周、训练日、刺激 slot、动作和组；
- 动作的前置条件、资源占用、疲劳/恢复影响及可替代关系；
- 训练、营养、恢复之间的耦合变量；
- 评估方法：何时观察、需要哪些可比数据、成功/失败/证据不足信号；
- 计划调整的最小有效动作及其副作用。

临床知识工程给出的关键启发不是医疗内容，而是 **定义与实例分离**。FHIR `PlanDefinition` 是可分享、可消费、可执行的定义资产；它本身不代表已决定对某个具体对象采取行动。应用 `$apply` 后才产生面向具体上下文的 request/action 实例。[HL7 FHIR R5 PlanDefinition，官方规范](https://hl7.org/fhir/plandefinition.html) MaxPower 应同样区分：知识包里的 `ActionDefinition` 不是用户计划，Planner 求值后生成的 `PlanRevision` 才是计划候选。

FHIR Clinical Reasoning 又将知识资产拆成 metadata、subject information model 和 logic，并用表达式语言对具体上下文求值。[HL7 FHIR Clinical Reasoning，官方规范](https://hl7.org/fhir/clinicalreasoning-module.html) 对 MaxPower 的直接映射是：Evidence/版本元数据、Timeline/Profile 状态模型、可执行规则三者不能混成一段 Markdown。

### 4. 共同未知：不能靠知识图“推出来”，必须转化为可验证假设

以下问题即使有高质量领域知识也不能预先确定：

- 某个用户对训练量、热量目标、有氧频率或提醒频率的个体反应；
- 某个短期体重变化来自能量平衡、测量噪声、水分还是执行偏差；
- 某个视觉目标映射的肌群优先级是否真的符合用户审美；
- 某个计划的成功概率及具体行动的因果贡献；
- 某位用户的主观恢复、训练表现和依从性之间是否存在稳定关系。

JITAI 将长期目标、近端目标、决策点、行动选项、随时间变化的 tailoring variables 和决策规则明确分开；它还把“什么都不做”视为合法行动选项，并强调变量应当能帮助判断哪种行动更可能改善近端结果。[Nahum-Shani et al., 2018，原始框架论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/) 这意味着 MaxPower 不应为每个 Timeline 变化都强制改计划，而应把“保留计划、继续观察”作为候选行动。

HeartSteps 的 micro-randomized trial 在每天多个决策点随机比较“发建议/不发建议”，并用建议后 30 分钟步数作为近端结果；这说明长期行为系统需要为规则绑定短期可观测结果，而不能只在数月后看最终体重。[Klasnja et al., 2019，原始试验论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC6401341/)

---

## 二、跨领域系统如何让知识真正进入 Planner

### 1. AI Planning：知识是状态转移模型，不是背景文章

PDDL 类规划把 domain 与 problem 分开：domain 描述谓词/函数、动作前置条件和效果，problem 提供当前初始状态与目标。PDDL 2.1 又增加持续动作、时间和数值 fluent，以处理资源和时间密集型问题。[Fox & Long, 2003，PDDL 2.1 原始论文](https://doi.org/10.1613/jair.1129)

MaxPower 可借鉴的不是 PDDL 语法本身，而是这种分离：

| Planning 构件 | MaxPower 映射 |
|---|---|
| domain state vocabulary | 训练/恢复/营养/器械/日程的结构化状态 |
| action preconditions | 动作可用器械、恢复阈值、安全许可、时间预算 |
| action effects | 计划刺激、预计疲劳、时间占用、能量需求；必须标为预测而非事实 |
| initial state | Ledger 投影出的当前用户状态 |
| goals | GoalContract 的目标、期限、护栏、测量计划 |
| plan | 待确认的未来 `PlanRevision` |

HTN/HDDL 进一步把复合任务通过方法分解成更小任务，直至可执行 primitive action；HDDL 的目标是为层级规划提供统一的领域/问题描述语言。[Höller et al., 2020，HDDL 原始论文](https://doi.org/10.1609/aaai.v34i06.6542) 这非常适合计划骨架：

```text
goal cycle
  -> phase strategy
    -> rolling week / rotation
      -> session intent
        -> stimulus slots
          -> exercise + sets + load calibration
```

但 HTN 方法只能表达“如何分解”，不能自动证明这些方法对某个用户有效；适用条件、证据、约束和结果观测仍需单独建模。

### 2. Constraint planning/configuration：先可行，再优化

约束规划适合从大量组合中找满足条件的可行方案；目标函数可以不存在，或在可行集合上进一步优化。Google OR-Tools 官方文档明确区分 constraint feasibility 与 objective optimization。[OR-Tools Constraint Optimization，官方开源文档](https://developers.google.com/optimization/cp/) MiniZinc 同样把 constraint satisfaction/optimization 作为高层、solver-independent 的模型。[MiniZinc Handbook，官方开源文档](https://docs.minizinc.dev/en/latest/)

对 MaxPower 应采用严格顺序：

1. **硬边界**：安全、许可、用户明确禁止、器械不可用、时间不可能、不能修改已经发生的历史；
2. **可行性约束**：周可用天、单课时长、动作先后依赖、恢复间隔、最小刺激/维持线；
3. **软偏好**：分化偏好、动作喜好、训练体验、外食自由度；
4. **目标/utility**：目标匹配、计划成功可能性代理、连续性、最小改动、负担、信息价值；
5. **候选与解释**：至少保留选中候选、被拒绝候选的主要原因和最小放宽项。

这也说明“图中一条 `PREFERS` 边”不够：偏好需要权重、适用范围、有效期、来源和相对于硬约束的优先级。

### 3. 临床路径：知识定义、上下文求值、行动实例、结果追踪分离

CPG-on-FHIR 将 recommendation 表达为 event-condition-action：何时求值、当前状态是否适用、要产生什么活动；同时要求 supporting documentation，并支持 evidence quality 与 recommendation strength。[HL7 CPG-on-FHIR Methodology，官方实施指南](https://www.hl7.org/fhir/uv/cpg/methodology.html)

该指南还区分：

- recommendation：一个事件—条件—动作规则；
- strategy：某个时间点执行的活动序列，可嵌套子流程；
- pathway：跨时间、具有多个时间/事件入口的总体活动；
- validation：检查半结构化、结构化和可执行知识是否仍与原意一致。

对 MaxPower 的启示是：一条“减脂平台期先检查依从性”的证据结论，不能直接等同于一份未来两周计划。它应先成为 RecommendationDefinition；多个建议经过冲突处理后组成 Strategy；Planner 再将其物化为具体 PlanRevision；Timeline 负责追踪行动和结果。

FHIR 不是 MaxPower 应采用的数据格式。其有用之处是生命周期和边界模式，而不是照搬医疗资源。

### 4. JITAI / DTR / receding horizon：持续规划必须绑定决策点和近端结果

动态治疗策略（DTR）被定义为随阶段、根据已有观察和中间反应选择后续行动的一组序贯决策规则。[Murphy & Bingham, 2009，原始方法论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC2892819/) 对 MaxPower 更重要的是形式：下一步决策要读取此前观察与行动，而不是只读静态 Profile。

JITAI 提供了更适合移动产品的字段：

| JITAI 元素 | MaxPower 映射 |
|---|---|
| distal outcome | 目标周期的体成分、力量或体型目标 |
| proximal outcome | 7/14 天体重与腰围趋势、下次训练完成/表现、恢复、步数完成 |
| decision point | Timeline 变化、课后、周复盘、风险触发、用户请求 |
| tailoring variable | 当前恢复、执行率、趋势、可用时间、器械、近期行动 |
| intervention options | 保持、简化、换课、调量、调活动、调整饮食目标、请求信息 |
| decision rule | 在何种状态下允许/阻止/排序这些行动 |

Model Predictive Control（MPC）以当前状态反复求解有限时域、带约束的控制问题，并采用 receding horizon；这是 MaxPower “物化近期、远期只保留意图、新事实到来后重算”很好的设计类比。[Mayne et al., 2000，原始综述论文](https://doi.org/10.1016/S0005-1098(99)00214-9) 但这里是软件设计类比，不是把人体简化为已知动力系统，更不能用模型预测替代真实观察。

---

## 三、必须明确区分的七类知识与数据

| 类别 | 定义 | 示例 | 应保存位置 | Planner 如何使用 |
|---|---|---|---|---|
| Declarative knowledge | 领域实体、关系、证据声明，不直接执行 | 卧推是水平推；某证据支持某范围，不支持个体承诺 | KnowledgePack catalog/evidence | 查询、解释、编译依赖 |
| Executable rules | 有封闭输入、条件、输出和 unknown 语义的确定性规则 | 日志覆盖不足时不得判定生理平台 | 新 DecisionPack IR | 求值适用性、产生约束/候选 |
| State / facts | 某位用户在某时刻的已知事实与来源 | 昨晚睡眠、昨日训练、当前计划修订 | Ledger/Timeline 投影 | 作为规则和 Planner problem 输入 |
| Constraints | 不得违反或应尽量满足的边界 | 疼痛动作禁用；每次 75 分钟；偏好四分化 | 规则求值输出 + Mandate/Goal | 硬过滤、可行性检查 |
| Objectives / utilities | 可行候选之间的排序目标 | 保目标路径、减少计划扰动、保护关键训练质量 | GoalContract + policy weights | 多目标排序、呈现 trade-off |
| Actions | 能改变未来计划或请求信息的受控操作 | 调整未来组数、换下一课、增加步数、继续观察 | Knowledge ActionDefinition；Plan 中为实例 | 生成候选，经确认后物化 |
| Observations / outcomes | 行动后的实际结果和可比测量 | 完成率、力量表现、体重趋势、腰围、主观恢复 | Timeline/Ledger | 校验规则、更新状态、触发重规划 |

关键纪律：Action 的“预计效果”不是 Observation。预计疲劳、预计消耗和成功概率必须与实际记录分开，并携带模型/规则版本和不确定范围。

---

## 四、数据表示与执行机制怎么选：Graph 只是候选之一

### 1. 先看 typed data、search、rules 与 constraints

MaxPower 当前最需要的不是新的通用存储，而是把已有数据按消费方式分层：

- typed catalog/table 负责稳定实体、枚举、参数、别名与版本；
- lexical/vector search 负责从 passage、gist、citation 中快速召回解释材料，但召回结果没有执行权限；
- decision table/rule 负责适用性、排除、unknown、优先级和发出候选；
- task template/method 负责把高层目标分解为计划骨架；
- constraint model/scorer 负责可行性、冲突、资源和候选排序；
- event ledger/projection 负责用户当前状态、历史、修正和反馈；
- Graph 仅在多跳关系、依赖和证据路径确实重要时提供关系索引或可视化。

### 2. Graph 合适的用途

Property graph 以带类型/属性的 vertex、edge 表达异构对象之间的显式关系，并通过 traversal 处理路径。[Apache TinkerPop Reference，官方开源文档](https://tinkerpop.apache.org/docs/current/reference/) 它适合 MaxPower 的：

- ExerciseVariant → StimulusContract → Muscle/Movement 的多跳关系；
- EvidenceClaim → Citation → Population/Limit 的出处链；
- Rule → RequiresFact / ProducesConstraint / EnablesAction 的依赖关系；
- Strategy → SubStrategy / ActionDefinition 的层级分解；
- 冲突、替代、优先于、阻止等显式关系；
- 构建期检查 dangling refs、循环依赖和未引用规则；
- 为用户解释“哪些事实和规则导致这个候选”。

RDF 把信息表达为 subject-predicate-object triples/datasets；它解决的是跨系统可识别语义和链接数据问题。[W3C RDF 1.1 Concepts，官方标准](https://www.w3.org/TR/rdf11-concepts/) SHACL 则用于描述和验证 RDF graph 的 shapes，并输出 validation report。[W3C SHACL，官方标准](https://www.w3.org/TR/shacl/) 如果未来要与多个机构的本体、外部标准和 SPARQL 生态互操作，RDF/SHACL 才有明确收益。

### 3. Graph 不合适或不足的用途

- **当前事实与时间序列**：Timeline 的修正、来源变更、时区、数据状态和事件顺序更适合不可变 event ledger；复制成图会产生双重真相。
- **原子提交与 Plan revision**：确认、幂等、冲突检测和回放是 Ledger 的职责，不是关系遍历问题。
- **数值约束与优化**：训练日排期、总时长、周量、恢复间隔和多目标排序更像 constraint/configuration model；Graph 只保存关系，不能自动给出可行最优计划。
- **状态转移**：`AFFECTS` 或 `CONTRIBUTES_FATIGUE_TO` 边不等于动作的前置条件、效果、持续时间和不确定性模型。
- **未知与非单调事实**：用户事实可能缺失、估计、过期或被纠正。普通 graph traversal 很容易把“没有边”误成“否”；必须使用显式三/多值状态语义。
- **规则执行安全**：SHACL 的核心规范是 validation；SHACL Advanced Features 虽描述 rule/condition 与衍生 triples，但它是扩展特性，仍不是计划优化器。[W3C SHACL Advanced Features，官方工作组文档](https://www.w3.org/TR/shacl-af/)
- **证据强度和推荐强度**：一条连接不表达 claim 能支持到什么程度、不能支持什么，也不表达产品政策与科研事实的差异。

W3C 的 RDF 1.2 draft 甚至明确提醒：graph structure 是符号结构基础，并不自动成为 conceptual model。[W3C RDF 1.2 Concepts，官方候选规范](https://www.w3.org/TR/rdf12-concepts/) 因此“把数据变成 nodes/edges”本身不会产生教练判断能力。

### 4. 各方案与 MaxPower 当前适配性

| 方案 | 最擅长 | 对当前数据的适配 | 主要代价/风险 | 判断 |
|---|---|---|---|---|
| Typed catalogs / tables | 稳定 schema、参数校验、客户端打包、IDE/编译器支持 | 与现有 TypeScript/JSON 高适配 | 跨表依赖需要显式索引和 lint | **Go / keep** |
| Layered search（gist/keypoint/passage） | 快速理解、回答、证据召回 | 当前已有 263 passages 与分层索引 | 命中不代表适用或可执行 | **Keep for recall/explanation only** |
| Decision tables / executable rules | 适用性、排除、unknown、动作候选 | 当前最大缺口 | 规则冲突、优先级和治理 | **Go** |
| HTN-like task methods | 目标到阶段/周/session/slot 的分解 | 与当前 Planner 层次高适配 | 方法错误仍会产生坏计划 | **Go incrementally** |
| Property graph DB | 异构关系、多跳路径、关系属性、探索查询 | 动作—刺激—肌群、证据—规则关系中等适配；规模太小 | 新数据库、同步、迁移、双重事实、客户端复杂度 | **No-go now** |
| RDF + SHACL | 跨组织语义互操作、本体、图验证 | 当前没有外部本体/SPARQL 需求 | 开放世界/闭世界边界、reification、工具链和学习成本 | **No-go now；未来互操作触发再评估** |
| Decision model IR（可选依赖 DAG） | 统一编译 rules、constraints、actions 与 trace | 与现有 KnowledgePack/version pin 高适配 | 需要表达式语义、循环/冲突检查和规则治理 | **Go** |
| Relational/event Ledger | 时间事实、修正、来源、事务、回放 | 与 Timeline、Plan revision 高适配，已实现 | 不适合自由知识路径查询 | **Keep as source of truth** |
| Constraint model / scorer | 排期、资源、可行性、硬/软约束、多目标排序 | 与 GoalCyclePlanner 高适配 | 权重治理、求解可解释性、过度形式化 | **Go incrementally** |

### 5. 当前数据的具体诊断

1. `ExerciseCatalogArtifact` 已经是规范化关系数据：variant 通过 ID 指向 concept、stimulus contract 和 expected muscle association。它可以投影成 graph，但无须改存储。
2. `ProgramStrategies` 当前混合了四种职责：检索段落/引用、策略声明、数值参数、规则表。这比纯文本好，但缺少统一的 rule applicability / unknown / priority / action / outcome contract。
3. `executableRulePacks` 目前主要是 manifest（版本、hash、scope、`executable: true`），并没有通用的可执行 rule body schema。
4. `GoalCyclePlanner` 直接读取 `programStrategies()`，又在 Planner 和多个 planning module 内实现领域判断；因此“知识在哪里结束、Planner 算法从哪里开始”不清晰。
5. `dietTrainingGraph.ts` 是一个值得保留的正确方向：它没有枚举 diet × training 组合，而是通过糖原、能量、蛋白和恢复等共享中间量做供需与约束匹配。它叫 graph，但实际是 typed functions + rule IDs + conflicts + resolutions；这说明关键是稳定的中间语义，不是图数据库。
6. `PlannerTrace` 能证明“选了哪个分化和动作”，但不足以证明：哪些规则被评估、为什么不适用、哪些关键事实缺失、硬/软约束分别是什么、各 objective 如何影响排序、后续用什么结果验证。

---

## 五、推荐的 MaxPower 架构

```text
KnowledgePackRegistry
  ├─ Evidence/Citations/Passages       # 解释与审计
  ├─ Exercise/Stimulus Catalog         # 领域实体与关系
  ├─ Strategy & Action Definitions     # 可选做法，不是用户计划
  └─ DecisionPack IR                   # 条件、未知语义、约束、目标、观测
                    │
Ledger + Timeline ──┴─> StateProjector
                            │ PlanningStateSnapshot
                            v
                   DecisionEvaluator
                  /         |          \
          hard constraints  candidates  missing/conflicts
                  \         |          /
             HTN-like Decomposer
                            │ plan skeletons
                            v
             Constraint Solver / Scorer
                            │ selected + alternatives + relaxations
                            v
                 GoalCyclePlanner proposal
                            │ user confirmation
                            v
                 PlanRevision + DecisionTrace
                            │ outcomes recorded
                            └──────────────> Timeline / next decision point
```

### 1. 决策知识 IR（示意，不是最终代码）

```ts
interface DecisionRuleDefinition {
  id: string;
  version: string;
  scope: "initial_plan" | "daily_adaptation" | "weekly_review" | "phase_review";
  trigger: readonly PlannerTrigger[];
  requires: readonly FactRequirement[];
  when: BooleanExpression;                // 显式 true/false/unknown
  unless?: BooleanExpression;
  priority: number;
  emits: readonly (
    | HardConstraintDefinition
    | SoftPreferenceDefinition
    | ObjectiveContribution
    | ActionCandidateDefinition
    | ObservationRequirement
    | MissingFactRequest
  )[];
  evidenceRefs: readonly string[];
  policyClassification: "evidence" | "product_policy" | "safety_boundary";
  cannotSupport: readonly string[];
}
```

动作定义必须与动作实例分离：

```ts
interface ActionDefinition {
  id: string;
  kind:
    | "keep_plan"
    | "request_information"
    | "change_future_session"
    | "change_future_volume"
    | "change_future_aerobic"
    | "change_future_energy_target"
    | "simplify_plan";
  preconditions: readonly FactRequirement[];
  allowedScopes: readonly ("next_session" | "next_7_days" | "phase")[];
  maxChangeEnvelope: unknown;
  predictedEffects: readonly PredictedEffect[];
  outcomeWindow: { minDays: number; maxDays: number };
  outcomeSignals: readonly OutcomeSignalDefinition[];
  requiresConfirmation: boolean;
}
```

### 2. Planner 只依赖一个窄接口

```ts
interface PlanningKnowledgeEvaluator {
  evaluate(input: {
    trigger: PlannerTrigger;
    state: PlanningStateSnapshot;
    goal: GoalContractData;
    currentPlan?: PlanRevisionData;
    scope: "initial_plan" | "future_plan";
  }): PlanningKnowledgeDecision;
}

interface PlanningKnowledgeDecision {
  disposition: "eligible" | "insufficient_evidence" | "blocked" | "requires_choice";
  strategyCandidates: readonly StrategyCandidate[];
  actionCandidates: readonly ActionCandidate[];
  hardConstraints: readonly EvaluatedConstraint[];
  softPreferences: readonly EvaluatedPreference[];
  objectives: readonly EvaluatedObjective[];
  missingFacts: readonly MissingFact[];
  conflicts: readonly KnowledgeConflict[];
  observationRequirements: readonly ObservationRequirement[];
  evaluationTrace: DecisionEvaluationTrace;
  knowledgePins: KnowledgeVersionPins;
}
```

`GoalCyclePlanner` 仍负责将这些结果物化为日期、session、slot、exercise 和 set；它不再自行发明“哪类用户适合什么策略”的领域判断。

### 3. 完整但非思维链的 Evaluation Trace

Trace 应是机器可验证的决策日志，不保存 LLM 隐式思维链：

```ts
interface DecisionEvaluationTrace {
  inputFingerprint: string;
  knowledgePins: KnowledgeVersionPins;
  factFrontier: readonly { aggregate: string; revision: number }[];
  evaluatedRules: readonly {
    ruleId: string;
    version: string;
    result: "matched" | "not_matched" | "unknown" | "blocked_by_higher_priority";
    inputFactRefs: readonly string[];
    missingFactKeys: readonly string[];
    emittedConstraintIds: readonly string[];
    emittedActionIds: readonly string[];
    evidenceRefs: readonly string[];
  }[];
  candidatePlans: readonly {
    id: string;
    feasible: boolean;
    rejectedBy: readonly string[];
    objectiveContributions: readonly { objectiveId: string; value: number; weightVersion: string }[];
  }[];
  selectedCandidateId?: string;
  minimumRelaxations: readonly { constraintId: string; consequence: string }[];
  expectedObservations: readonly { signalId: string; window: string; source: string }[];
}
```

这应扩展而不是替换现有 `PlannerTrace`：已有 slot/分化/周量 trace 继续属于 materialization trace；新增部分解释 knowledge evaluation 与 candidate selection。

### 4. 对当前模块的映射

| 当前模块 | 保留 | 需要演进的边界 |
|---|---|---|
| `KnowledgePackRegistry` | 校验、版本 pin、历史回放、目录/引用检索 | 暴露 `decisionPack()` 或 `evaluatePlanningKnowledge()`；不暴露内部图查询给 LLM |
| `programStrategies` | split、diet、cost model 等声明 | 拆出 evidence content、declarative strategy、executable decision rules；提供 legacy adapter 逐步迁移 |
| `GoalCyclePlanner` | 计划分解、排期、动作选择、diff、infeasible | 消费 `PlanningKnowledgeDecision`，不再承担分散的领域适用性判断 |
| `Timeline` | 原始/规范事实、来源、置信度、修正与时间 | 增加决策所需的派生 observation projection，但派生值必须保存算法版本和来源 |
| `Ledger` | 唯一事实源、Plan revision、原子确认、回放 | 保存 decision trace/pin；不要复制用户状态到共享知识图 |
| `dietTrainingGraph` | 共享中间量、typed conflict/resolution | 可作为首批编译到 DecisionPack 的范例；“graph”保持逻辑概念，不要求图 DB |

---

## 六、风险与替代路径

| 风险 | 后果 | 控制措施 |
|---|---|---|
| 把每篇文章、每句话都节点化 | 图很大但不能执行，关系语义模糊 | 只让审核后的 claim/rule/action 进入 IR；原文仍是 passage |
| Rule explosion | 新目标 × 新水平 × 新策略组合爆炸 | 使用共享中间量与 constraint composition，避免组合矩阵 |
| 把 absence 当 false | 缺数据时给出错误确定性 | 表达式必须返回 true/false/unknown；missing facts 进入结果 |
| 图循环或规则冲突 | 非确定结果、反复触发 | 构建期 DAG/循环检查；显式 priority 和 conflict policy |
| 隐藏权重 | 看似客观，实为产品偏好 | objective/weight 单独版本化，并输出 contribution trace |
| 预计效果冒充事实 | 成功概率虚高、错误学习 | predicted effect 与 observed outcome 分离；只从可比 observation 更新 |
| LLM 改写执行规则 | 漂移、不可回放、安全风险 | LLM 只能提议 draft；schema 校验、人工审核、fixture 回归后发布 |
| 个体反馈污染全局知识 | 一人经验影响所有人 | 全局 DecisionPack 与用户 learned parameter 分离 |
| 全图迁移 | 数据双写、客户端同步和恢复复杂 | 首版只新增 JSON IR；现有存储零迁移 |
| 过早引入 solver | 难调试且解释差 | 先沿用现有确定性 composer/scorer；候选空间明显增长后再接 solver |

替代路径：

- 如果规则数量长期少于几十条，可以直接采用 typed decision tables，不需要 graph-shaped IR。
- 如果核心只是计划排期而知识依赖很少，可以只做 constraint model + evidence metadata。
- 如果未来明确需要跨机构健康本体互操作，再把知识资产投影成 RDF/SHACL；投影不取代内部 IR。
- 如果未来个体响应数据足够，再研究 contextual bandit/RL；在此之前不应把专家规则伪装成学习到的成功概率。

---

## 七、最小可逆实验

### 实验：只迁移“有氧与力量并发安排”一个决策域，影子运行

**要验证的假设：** 相比 Planner 内散落的硬编码判断，版本化 DecisionPack IR 能在不改变 Composer、LLM prompt、Timeline 或 Ledger 的前提下，提高决策覆盖、未知处理和可解释性，而且不降低确定性与计划质量。

**唯一改变的变量：** 同一批固定 `PlannerRequest`，A 路径使用当前规则；B 路径仅把“有氧角色、时机、强度、并发疲劳与恢复限制”改由 DecisionPack evaluator 产出约束/候选。后续 session composer 和 scorer 完全相同。B 只影子运行，不写 Plan。

**固定输入场景：**

1. 进阶减脂、四分化、下肢课后、恢复正常；
2. 同条件但腿部酸痛；
3. 同条件但睡眠差、下次上肢课；
4. 低血糖风险或相关安全 flag；
5. 单课已占满 75 分钟；
6. 用户锁定“仅力量后有氧”；
7. 用户只说“想加速减脂”但没有有氧偏好；
8. 日程变化导致只能分离有氧；
9. 有量化活动记录与无记录；
10. 缺恢复/日程关键事实。

每个场景至少包含一次初次计划和一次 Timeline 变化后的未来计划重算。

**成功信号：**

- 100% 相同输入产生相同 B 输出和相同 trace hash；
- 100% 硬安全 fixture 无违规候选；
- 100% 关键事实缺失场景输出 `unknown/insufficient_evidence` 或保守行动，不把缺失当否定；
- 每个计划候选能追溯到输入 fact refs、规则 ID、约束、行动和 evidence refs；
- 专家盲评中，B 对“为什么这样排、为何不排另一种”的可理解性不低于 A；
- B 不增加首次计划的重大结构缺陷，且不修改已发生日期；
- 新增一种有氧策略只需增加声明/规则 fixture，不修改 GoalCyclePlanner 主流程。

**失败信号：**

- 为表达一个领域仍需在 evaluator 外加入用户类型特判；
- 规则冲突只能依赖数组顺序或 prompt 解决；
- Graph path 可以展示，但不能稳定生成 hard/soft constraints；
- 未知事实被隐式默认值吞掉；
- B 产生更多不可解释或质量更差的计划；
- trace 无法重放或版本 pin 不足以复现。

**需要收集的数据：**

- 每条规则的 matched/not-matched/unknown 次数；
- 缺失事实键及其是否真的改变候选；
- hard filter 数、候选数、目标分贡献、最终 diff；
- 规则冲突及优先级解决路径；
- A/B 计划结构差异；
- 专家质量评分和用户选择/拒绝原因；
- 后续完成率、训练表现、恢复和计划再次调整次数；
- evaluator 延迟和包体积。

**停止条件：** 若 DecisionPack 不能在不引入图数据库的情况下表达上述场景，先修 IR；不要用数据库迁移掩盖模型缺陷。只有当真实规则依赖查询频繁需要任意多跳、JSON 构建/校验已经成为瓶颈，且 profiling 证明内存索引不足时，才重新评估 property graph storage。

---

## 八、推荐落地顺序

1. 写 DecisionPack schema、closed vocabulary、三值逻辑和 lint 规则；不动 Planner。
2. 选择有氧并发域，把现有规则编译成 shadow evaluator，并生成 evaluation trace。
3. 建 fixture matrix，对比旧/新路径和专家验收；先验证知识模型，不验证数据库。
4. 让 `GoalCyclePlanner` 消费 DecisionPack 的 constraints/actions，但继续使用现有 composer/scorer。
5. 验收后依次迁移：平台期分类、不同水平训练量/频率、重组资格、增肌盈余、视觉目标、联合评估、依从性简化。
6. 再评估是否需要通用 solver；只有候选组合或约束冲突已经超过现有算法可维护性时引入。
7. 最后才评估 graph database/RDF，触发条件必须是互操作、任意关系查询或规模，而不是“知识听起来像图”。

## 最终判断

领域知识进入 Planner 的正确形式不是“检索到相关段落后让 LLM自由发挥”，也不是“所有东西存成图”。成熟领域共同采用的是：

> **定义知识与个体状态分离；把适用性和行动写成可执行规则；先满足硬约束，再按目标与偏好排序；只物化近期计划；用可比结果在明确决策点重新求值；全过程保存版本和决策 trace。**

对 MaxPower，推荐的目标模型是 **typed catalogs + layered search + executable DecisionPack + HTN-like decomposition + constraint/scoring + event feedback**。Ledger 仍然管事实，DecisionPack 管适用性与候选，constraint model 管可行性与排序，GoalCyclePlanner 管物化，Timeline 管反馈。Graph 如果以后引入，只是决策依赖和证据关系的一种索引/投影视图；它不是这套能力成立的前提。

## 主要一手来源

- [HL7 FHIR R5 PlanDefinition（官方规范）](https://hl7.org/fhir/plandefinition.html)
- [HL7 FHIR Clinical Reasoning（官方规范）](https://fhir.hl7.org/fhir/clinicalreasoning-module.html)
- [HL7 CPG-on-FHIR Methodology（官方实施指南）](https://www.hl7.org/fhir/uv/cpg/methodology.html)
- [Fox & Long 2003, PDDL 2.1（原始论文）](https://doi.org/10.1613/jair.1129)
- [Höller et al. 2020, HDDL（原始论文）](https://doi.org/10.1609/aaai.v34i06.6542)
- [MiniZinc Handbook（官方开源文档）](https://docs.minizinc.dev/en/latest/)
- [Google OR-Tools Constraint Optimization（官方开源文档）](https://developers.google.com/optimization/cp/)
- [Nahum-Shani et al. 2018, JITAI components（原始论文）](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/)
- [Murphy & Bingham 2009, Dynamic Treatment Regimes（原始论文）](https://pmc.ncbi.nlm.nih.gov/articles/PMC2892819/)
- [Klasnja et al. 2019, HeartSteps MRT（原始试验论文）](https://pmc.ncbi.nlm.nih.gov/articles/PMC6401341/)
- [Mayne et al. 2000, constrained MPC（原始综述论文）](https://doi.org/10.1016/S0005-1098(99)00214-9)
- [Felfernig et al. 2013, scoring rules in constraint-based recommenders（原始研究论文）](https://doi.org/10.3233/AIC-120543)
- [Apache TinkerPop Reference（官方开源文档）](https://tinkerpop.apache.org/docs/current/reference/)
- [W3C RDF 1.1 Concepts（官方标准）](https://www.w3.org/TR/rdf11-concepts/)
- [W3C SHACL（官方标准）](https://www.w3.org/TR/shacl/)
- [W3C SHACL Advanced Features（官方工作组文档）](https://www.w3.org/TR/shacl-af/)
