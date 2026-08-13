# 从领域知识到可执行决策与计划：公开实现与范式调研

调研日期：2026-08-13
范围：公开论文、正式标准、官方工程文档与开源源码。为避免方案锚定，本调研没有读取本项目代码。
问题：领域知识如何被用于 Agent 的召回、确定性判断、约束规划、动态调整与可追溯解释？

## 结论先行

公开 prior art 并不支持“把所有知识检索进 prompt，再让一个 LLM 同时判断、规划和解释”这一做法。真正相似、且已经形成工程语义的系统普遍把职责拆开：

1. **召回只缩小候选集，不赋予决策权。** Voyager 用向量库召回可复用技能；FHIR 知识制品用稳定标识、版本、主题和依赖组织；SayCan 把语言相关性与当前状态下的可执行性分开评分。召回错误不应直接变成执行决定。
2. **确定性判断由显式语义承担。** CQL/FEEL、DMN hit policy、Rego/Cedar、动作前置条件和 solver 约束都把“何时适用、多个规则同时命中怎么办、缺数据怎么办”放进可测试的执行语义，而不是交给模型临场解释。
3. **结构知识与组合优化是两类不同知识。** HTN/PlanDefinition 擅长表达“专业人员通常怎样分解任务、阶段之间有什么关系”；CP-SAT/Z3 擅长在硬约束和软目标下决定具体排期与取舍。两者组合比单独使用任何一类更接近健身计划。
4. **unknown、conflict、unsat 必须是一等结果。** CQL/FEEL 有三值逻辑；DMN 对重叠命中定义 hit policy；OPA/Cedar 明确未定义、错误、deny/forbid 的合并；求解器区分 `INFEASIBLE` 与 `UNKNOWN`，并能给出冲突核心。把这些都压成布尔值会丢掉关键安全信息。
5. **动态调整应是“带状态的重新求解”，不是全文重写。** Unified Planning 的 Replanner/PlanRepairer、JITAI 的 decision point、以及 receding-horizon 思路都要求用最新状态重新决策，同时保留已完成前缀、原目标、修改原因和版本。
6. **解释应由决策过程产生，而不是事后生成。** 可追溯解释至少需要：输入快照、知识版本、候选召回、命中/排除规则、冲突合并方式、solver 状态与目标值、最终选择、人工覆盖及原因。LLM 可以把这份 trace 转成自然语言，但不能替代 trace。

对健身 Planner 最合适的技术中立结论是：采用**版本化知识制品 + 显式三值状态 + 分层规则/约束 + 滚动重规划 + 决策账本**的架构；LLM 位于自然语言边界和解释层，而安全门槛、可行性和跨日程组合由确定性组件负责。

## 相似度总览

| 范式/项目 | 主要解决的问题 | 知识数据形态 | 最终判断者 | unknown / conflict | 动态调整 | 对健身 Planner 的相似度 |
|---|---|---|---|---|---|---|
| HL7 FHIR PlanDefinition + CQL + CDS Hooks | 把临床指南应用到个体上下文 | 版本化计划、动作层次、条件表达式、数据需求、来源 | CQL/FHIRPath 引擎与应用器；人可覆盖 | CQL 三值逻辑；跨服务冲突未统一规定 | 可按新上下文再次 `$apply`，但标准本身不是增量 planner | 很高：知识制品、适用性、证据、人工覆盖 |
| DMN/FEEL + Drools | 业务规则与决策表 | 决策需求图、表格规则、FEEL 表达式、hit policy | DMN/规则引擎 | `null`；Unique/Any/Priority/First/Collect 明确处理重叠 | 每次输入可重评；不是跨期计划修复 | 很高：资格、分级、互斥选择、冲突语义 |
| HTN / SHOP2 / HDDL | 用领域方法把高层目标分解为动作 | task、method、operator、前置条件、效果、顺序约束 | 符号 planner | 无分解/无计划；经典建模多假定已知状态 | 通常由外层执行器触发重规划 | 高：训练阶段与课表模板的层次分解 |
| PDDL + Unified Planning | 严格生成、验证、修复动作序列 | fluents、actions、goals、metrics、plan | planner/validator | 可建模未定义/不确定；结果区分无解、超时、错误 | 原生 Replanner、PlanRepairer、ActionSelector | 高：计划状态机、验证、增量修改 |
| OR-Tools CP-SAT / Z3 | 资源、排期、容量和偏好优化 | 变量、域、硬约束、软约束、目标函数 | solver | `INFEASIBLE` 与 `UNKNOWN` 分开；unsat core/assumption core | 更新输入后重求解，可 warm start/保留解 | 很高：周排期、恢复间隔、器械/时间限制 |
| OPA / Cedar | 守住不能跨越的策略边界 | Rego/Cedar 规则、结构化输入、实体、bundle/schema | policy engine | OPA `undefined`/conflict error；Cedar error diagnostics、default deny、forbid-overrides | 策略/数据可热更新；不负责生成计划 | 很高：安全 guardrail 与权限式门控 |
| FeatureIDE / 产品配置 | 从大量选项中形成一致配置并解释冲突 | feature tree、mandatory/optional、cross-tree constraints、selection | SAT/CSP/配置器 | 不一致配置、冲突解释、修复建议 | 用户每次选择后传播与修复 | 高：动作/训练法选择与兼容性传播 |
| JITAI / HeartSteps | 根据时变个体状态在正确时点干预 | decision point、tailoring variables、options、decision rules、dose | 规则或学习策略；availability 先门控 | 不可用则不干预；缺失语义由具体实现定义 | 核心能力，每个 decision point 重新决策 | 很高： readiness、负荷、依从性和即时调整 |
| Knowledge Compilation | 把昂贵推理前移，支持大量快速查询 | CNF/逻辑理论编译为 OBDD/d-DNNF 等电路 | 编译后查询算法 | 显式逻辑不一致；不天然管理现实世界缺失数据 | 可 conditioning；重编译成本可能很高 | 中：稳定规则的低延迟资格/兼容性查询 |
| SayCan | 在语言相关性与现实可执行性之间选技能 | 自然语言技能描述 + learned affordance/value | LLM 分数 × value function | 没有正式冲突语义；原版闭环反馈有限 | 逐步选择，但原版对失败后反馈有限 | 中高：候选动作相关性与当前能力分离 |
| LLM+P | 自然语言问题交给经典 planner | 固定 PDDL domain + LLM 生成 problem + planner plan | planner 决定可行/最优；LLM 只翻译 | 错译可导致无解；无原生 unknown 语义 | 论文实现为一次性规划 | 高：LLM 不做最终规划的混合范式 |
| Voyager | 召回已验证技能并根据执行反馈修复程序 | 可执行代码、LLM 生成描述、向量索引、执行反馈 | LLM 生成；环境与 critic 验证 | 没有形式化冲突合并 | 有限轮迭代修复，成功后入库 | 中：技能召回和经验闭环；安全性不足 |

### LLM 权限边界与 plan validation 的真实实现

| 类别 | 系统 | LLM 实际权限 | validation 的真实来源 |
|---|---|---|---|
| 不需要 LLM | FHIR/CQL、DMN、HTN/PDDL、CP-SAT/Z3、OPA/Cedar、FeatureIDE、JITAI | 标准/核心实现中没有 LLM；可另加语言入口或解释器 | 表达式求值、hit policy、planner/validator、solver satisfiability、policy evaluator、SAT/CSP 或 decision rule |
| LLM 只做结构化翻译/表达 | LLM+P | 把自然语言 initial state/goal 写成 PDDL problem，并把 plan 翻回自然语言；固定 domain 与搜索不由 LLM 决定 | Fast Downward 等 classical planner 生成 plan；PDDL/VAL 或独立 validator 检查。主要残余风险是 problem 被 LLM 错译 |
| LLM 参与逐步 action 选择 | SayCan | LLM 为候选 skill 对任务的相关性打分；与 learned affordance/value 相乘后选择下一 skill | affordance 只估计当前状态成功概率，不是硬可行性证明；原版失败后的闭环反馈有限 |
| LLM 生成可执行 action/program | Voyager | LLM 生成/修复代码，critic 也可由 LLM 承担；向量召回的 skill 进入 prompt | 游戏环境返回 execution errors/state，critic 做 success check；没有符号 plan validator、完备冲突语义或安全证明 |

因此，公开系统中“LLM 可以选 action”与“action 被确定性验证”是两个独立维度。SayCan/Voyager 展示了可用的研究闭环，却不能支持“LLM 选了就等于合法”；LLM+P 反而把最终计划搜索交给外部 planner，但也证明了入口状态错译会让正确 planner 对错误问题给出错误结论。

## 1. 临床决策支持：FHIR PlanDefinition、CQL 与 CDS Hooks

这是最接近“专家知识制品 → 个体条件判断 → 生成建议/计划 → 人工覆盖 → 可审计反馈”的公开范式。

### 知识形态与执行边界

FHIR `PlanDefinition` 是一个可共享、可消费、可执行的定义资源，能表达 order set、protocol、event-condition-action rule 和 workflow definition。动作可以形成层次结构，引用 `ActivityDefinition`，携带触发器、适用条件、动作关系、目标和动态值；`$apply` 把定义应用到患者/机构等具体上下文，产生 `RequestOrchestration` 等“提议执行的动作”，结果本身不自动落库或执行。参见 [FHIR R5 PlanDefinition](https://hl7.org/fhir/R5/plandefinition.html) 与 [PlanDefinition `$apply`](https://hl7.org/fhir/R5/plandefinition-operation-apply.html)。

HL7 Clinical Practice Guidelines 实施指南进一步规定：recommendation 可建模为 event-condition-action，strategy/pathway 可建模为 workflow/protocol；动作在数组中的先后顺序不代表执行顺序，必须用关系显式表达。参见 [CPG Methods of Implementation](https://build.fhir.org/ig/HL7/cqf-recommendations/en/documentation-approach-09-methods-of-implementation.html)。这与“不要从文档段落顺序猜计划语义”高度相关。

可执行条件通常引用 CQL 或 FHIRPath。CQL 的 `and`/`or` 使用三值逻辑，结果可为 `true`、`false` 或 `null`；例如 `true and null = null`、`false and null = false`。参见 [CQL Logical Specification](https://cql.hl7.org/2020May/04-logicalspecification.html#logical-operators) 与 [CQL Reference](https://cql.hl7.org/09-b-cqlreference.html#logical-operators)。因此“未测量”不必被错误地当成“不满足”。

### 谁做判断

- LLM：标准中没有 LLM 的必需角色；可以辅助把自然语言映射到结构化输入或生成面向人的说明。
- 规则/表达式引擎：决定 action condition 是否适用，并计算 dynamic value。
- 应用器：根据 action grouping、selection behavior 和 related action 生成具体请求。
- 人：某些 action choice 明确可能需要用户输入；`$apply` 输出是 proposal，由调用者决定是否执行。

### unknown、conflict 与覆盖

- **unknown**：CQL 原生保留 `null`。应用层仍必须规定 `null` 对每种安全条件意味着“询问、延迟、降级还是禁止”，FHIR 不替应用做这个决定。
- **conflict**：PlanDefinition 能表达单个计划内部的选择和关系，但 FHIR 明确不规定多个独立 CDS 服务的建议如何统一优先级。CDS Hooks 也提醒同一个 hook 可能收到多个服务的多个卡片，而规范不解决这些卡片之间的优先顺序。参见 [CDS Hooks 2.0](https://cds-hooks.hl7.org/2.0/)。
- **人工覆盖**：CDS Hooks 的卡片可带建议、来源、严重度、`overrideReasons`；反馈接口可记录 accepted/overridden、被接受的 suggestion、覆盖原因、自由文本和时间戳。相同规范还要求在取不到执行决策所需 FHIR 数据时可返回 `412 Precondition Failed`，而不是伪造“无建议”。

### 动态重规划与解释

对新上下文再次 `$apply` 可以得到新的 proposal，且 CPG 可以通过触发器反复调用；但标准没有定义“尽量保留旧计划”的增量修复目标。可追溯性来自 canonical URL/version、`instantiatesCanonical`、action link、来源、输入/输出 data requirements，以及 CDS Hooks 的 card UUID/feedback。

### 可借鉴 / 不能照搬

可借鉴：

- 把**定义**、**个体状态**、**实例化计划**分成三层；定义不是计划实例，计划实例也不是执行事实。
- 每条知识有稳定 ID、版本、适用条件、输入需求、输出、来源和解释材料。
- 把缺少关键数据作为显式结果；把人工覆盖及原因写回反馈流。

不能照搬：

- FHIR 的医疗互操作 schema 很重，健身产品不需要复制完整资源体系。
- PlanDefinition 不是全局优化器，也没有解决跨指南冲突；仍需独立的冲突和排期层。
- `$apply` 是生成 proposal，不等于自动执行或持续重规划。

## 2. 决策表与规则引擎：DMN/FEEL、Drools

### 知识形态与判断

OMG DMN 把 decision requirements graph、input data、decision、knowledge source 和 boxed expression/decision table 建模为可交换模型；规范入口见 [OMG DMN 1.5](https://www.omg.org/spec/DMN/1.5/About-DMN)。决策表每行是条件到输出的规则，FEEL 是表达式语言。最终判断由 DMN 引擎完成，不需要 LLM。

DMN 最值得借鉴的是 **hit policy 是模型的一部分**：

- `Unique`：只能一个规则匹配；重叠即错误。
- `Any`：可多个匹配，但输出必须相同；不同即错误。
- `Priority`：按显式输出优先级选一个。
- `First`：按规则顺序取第一个。
- `Collect`：收集或用 sum/min/max/count 聚合。

Apache KIE/Drools 官方文档同时说明 FEEL 使用 `true/false/null` 三值逻辑，并可在构建时静态分析 decision table 的 gap 与 overlap。参见 [Drools DMN](https://kie.apache.org/docs/10.1.x/drools/drools/DMN/index.html)。

Drools 原生规则引擎则维护 working memory、production memory 和 agenda：事实变化会激活规则，agenda 用 conflict resolution strategy 排序并执行。Spreadsheet decision table 会编译成 DRL 规则。参见 [Drools Rule Engine](https://kie.apache.org/docs/10.0.x/drools/drools/rule-engine/index.html) 与 [Rule Language / Spreadsheet Decision Tables](https://kie.apache.org/docs/10.0.x/drools/drools/language-reference/index.html#decision-tables-spreadsheets-con)。

### unknown、conflict、动态与解释

- **unknown**：FEEL `null` 是正式值，不等同于 `false`。
- **conflict**：DMN 通过 hit policy 显式定义；Drools 通过 agenda/conflict resolution 和 salience 等机制处理，但规则副作用与执行顺序更难推理。
- **动态**：输入或 working memory 变化后可重新求值；这适合“今天是否允许深蹲、训练量分级”，但不自动给出一周计划的全局最优修复。
- **解释**：表格行天然可读；Camunda 的 decision result 对 decision table 每个匹配规则产生对应 result entry，参见 [Camunda `DmnDecisionResult`](https://docs.camunda.org/manual/latest/reference/javadoc/org/camunda/bpm/dmn/engine/DmnDecisionResult.html)。生产实现仍应保存 decision ID、table version、matched rule IDs 和 input snapshot。

### 可借鉴 / 不能照搬

可借鉴：用 DMN 式 hit policy 表达冲突，不用隐含“规则排在前面就赢”；为每个资格判断表做 gap/overlap 静态分析；用三值输入测试缺失数据分支。

不能照搬：决策表适合局部、有限维度的判断；当跨多天的负荷、恢复、器械、时间窗彼此耦合时，表会组合爆炸，应把组合问题交给 solver。Drools 的前向链规则若大量修改 working memory，也容易出现难以解释的执行顺序，不宜直接成为训练计划总调度器。

## 3. 分层与经典规划：SHOP2/HDDL、PDDL、Unified Planning

### HTN：把专业过程写成“如何分解”

SHOP2 是 ordered task decomposition 的 HTN planner。其知识库包含 primitive operators、compound tasks 和 decomposition methods；它按将来执行的顺序生成步骤，因此规划每一步时知道当前状态，并允许 method 的 subtasks 部分有序。参见 [SHOP2 原论文（JAIR 2003）](https://s.aaai.org/Papers/JAIR/Vol20/JAIR-2013.pdf)。HDDL 把 task、method 和 task network 加到 PDDL 式语言中，形成多 planner 可共享的层次规划输入。参见 [HDDL 论文（AAAI 2020）](https://ojs.aaai.org/index.php/AAAI/article/view/6542)。

对健身计划，HTN 的相似之处是：`建立力量基础` 可按人群与阶段分解为 `每周三次全身训练`，再分成热身、主动作、辅助动作、冷却；method 的前置条件可以表达器械、经验和恢复状态。

**判断者**是 HTN planner；LLM 可帮助把自然语言目标映射为 task 或建议 method，但不负责证明可分解性。**unknown/conflict** 通常不作为领域值存在：如果前置条件无法证明或没有可用 method，就不能完成分解。经典 HTN 也常假定领域模型正确、状态已知。**动态调整**通常需要执行器观察新状态后重新调用 planner；SHOP2 本身不是持续监控框架。

### PDDL/Unified Planning：动作语义、验证与修复

PDDL 把 domain 与 problem 分开：domain 定义 predicates、actions、preconditions/effects；problem 定义对象、初始状态和 goals。PDDL2.1 又加入时间与数值资源，参见 [Fox & Long, PDDL2.1](https://doi.org/10.1613/jair.1129)。Fast Downward 将 PDDL 翻译为 SAS+ 再搜索，并可调用 VAL 验证计划，参见 [Fast Downward Planner Usage](https://www.fast-downward.org/HEAD/documentation/planner-usage/)。

Unified Planning（UP）在同一 API 下明确区分：

- `OneshotPlanner`：返回 satisfying/optimal plan，或 `UNSOLVABLE_PROVEN`、`TIMEOUT`、`MEMOUT`、`INTERNAL_ERROR`。
- `PlanValidator`：独立验证 plan 为 `VALID` 或 `INVALID`。
- `SequentialSimulator`：检查动作在状态中是否 applicable 并计算 successor。
- `Replanner`：可更新初始 fluent、增加/删除 action 或 goal 后再次 `resolve()`，并允许引擎复用上次计算。
- `PlanRepairer`：以可能已经失效的旧 plan 为 seed，寻找接近它的新 plan。
- `ActionSelector`：闭环执行中每次选一个动作，再用 observation 更新内部状态。

参见 [Unified Planning Operation Modes](https://unified-planning.readthedocs.io/en/latest/operation_modes.html)。UP 也显式支持 `UNDEFINED_INITIAL_SYMBOLIC/NUMERIC`、conformant 与 contingent planning；contingent plan 是根据过去 observations 决定下一步的策略。参见 [Unified Planning Problem Representation](https://unified-planning.readthedocs.io/en/latest/problem_representation.html)。

### 可借鉴 / 不能照搬

可借鉴：

- 用 HTN 表达专业的阶段/模板骨架；用 action preconditions/effects 表达可执行状态迁移。
- 把计划生成与计划验证做成两个接口，允许不同实现交叉检查。
- 重规划时显式更新 initial state/goals，并把“尽量少改原计划”作为 repair 目标，而不是每次清空重写。

不能照搬：

- 经典 closed-world 建模会把未陈述事实当 false；UP 官方示例也明确称 `default_initial_value=False` 为 closed-world assumption。参见 [UP Basic Example](https://unified-planning.readthedocs.io/en/stable/notebooks/01-basic-example.html)。健康/疲劳数据缺失时这种默认不安全。
- 编写完整、无歧义的 PDDL/HTN domain 成本高；训练适应也不总是确定性状态迁移。
- HTN 方法会把作者的习惯固化为搜索空间；若领域知识本身有争议，单一 method tree 会产生假确定性。

## 4. 约束求解：OR-Tools CP-SAT 与 Z3

### 知识形态与判断

Constraint Programming 把问题表示为变量、变量域和约束，在巨大候选空间中寻找可行解；排班是官方列出的典型场景。参见 [Google OR-Tools Constraint Optimization](https://developers.google.com/optimization/cp/)。对健身计划可自然表示：某日是否训练、动作选择、组数、时间、相邻训练间恢复、每周动作模式覆盖、器械/场地可用性、总时长和偏好损失。

- **硬约束**：绝不能违反，例如禁忌动作、同一时段冲突、最低恢复间隔。
- **软约束/目标**：尽量满足，例如偏好时间、动作多样性、计划稳定性、周目标接近度。
- **判断者**：CP-SAT/SMT/MaxSMT solver，而不是 LLM。

Z3 可以直接 `maximize`/`minimize`，也支持带权 `assert-soft`，多个目标可用 lexicographic、Pareto 或独立方式组合。参见 [Z3 Optimization](https://microsoft.github.io/z3guide/docs/optimization/intro/) 与 [Soft Constraints](https://microsoft.github.io/z3guide/docs/optimization/softconstraints/)。

### unknown、conflict 与解释

CP-SAT 的状态区分：`OPTIMAL`、`FEASIBLE`、`INFEASIBLE`、`MODEL_INVALID`、`UNKNOWN`。其中 `UNKNOWN` 表示停止前既未找到解，也未证明 infeasible，不能报告成“没有可行计划”。参见 [CP-SAT Solver Status](https://developers.google.com/optimization/cp/cp_solver)。Z3 同样区分 `sat/unsat/unknown`，并能提供 `reason_unknown`。参见 [Z3 Solver API](https://z3prover.github.io/api/html/ml/Z3.Solver.html)。

冲突解释可通过 assumptions 把每条业务约束绑定到可追溯 literal；infeasible 时返回 sufficient assumptions/core。OR-Tools 官方说明该集合“足以导致 infeasible”，但不保证是最小冲突集；若要 minimal unsatisfiable set 需要额外优化。参见 [OR-Tools：Debugging Infeasible Models](https://github.com/google/or-tools/blob/stable/ortools/sat/docs/troubleshooting.md)。Z3 的 unsat core 同样是导致 `unsat` 的 assumptions 子集。参见 [Z3 Python API `unsat_core`](https://z3prover.github.io/api/html/z3.z3.html)。

### 动态重规划

solver 一般不自带业务级“何时重规划”，但输入变化后可重新求解；可用旧解作为 hint/warm start，并在目标函数中惩罚修改已发布计划。真正的滚动计划需要外层控制器：固定已完成部分，只优化尚未执行的 horizon。

### 可借鉴 / 不能照搬

可借鉴：硬/软约束分离；显式目标优先级；状态不能只返回成功/失败；每条约束带 `rule_id/source/version` 以映射 unsat core；重规划加入 change cost，避免对用户产生不必要的计划抖动。

不能照搬：solver 只忠实执行模型；错误阈值会得到“数学上正确、现实中错误”的计划。unsat core 不是自然语言因果解释，也不一定最小；必须映射回领域概念。CP-SAT 对连续生理过程只是离散近似，不应伪装成医学预测器。

## 5. 策略引擎：OPA 与 Cedar

### OPA：结构化输入上的独立政策决策

OPA 用 Rego 对 JSON 等结构化数据进行声明式判断。policy 与 data 可打包为 versioned bundle；bundle 可携带 revision，签名验证失败时不会激活新 bundle，而继续使用旧版本。参见 [OPA Bundles](https://www.openpolicyagent.org/docs/management-bundles)。

OPA 的完整 document 若产生多个不同值会报 conflict error；未命中的查询可为 `undefined`，可用 default 明确补值。参见 [OPA Policy Language](https://www.openpolicyagent.org/docs/policy-language)。策略更新和 delta data bundle 提供动态性，但 OPA 每次只回答 query，不生成跨日动作序列。

OPA 的 decision log 可以记录 `decision_id`、`trace_id`、输入、结果、policy path、bundle revision，以及成功求值的规则 annotation IDs/labels；这是一种可直接借鉴的决策账本。参见 [OPA Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs)。

### Cedar：默认拒绝与 forbid-overrides

Cedar 的请求由 principal、action、resource、context 组成；policy effect 是 `permit` 或 `forbid`。授权算法是：任一 `forbid=true` 则 Deny；否则任一 `permit=true` 则 Allow；否则 default Deny。返回还包含 determining policies 与错误 diagnostics。参见 [Cedar Authorization](https://docs.cedarpolicy.com/auth/authorization.html)。

Cedar 特别值得注意的错误语义是 **skip-on-error**：单条 policy 求值错误不会直接决定结果，但错误 policy ID 会进入 diagnostics，调用应用可以据此采取更严格行为。这说明“policy engine 的默认错误策略”不能未经审视就变成健康安全策略。

### 可借鉴 / 不能照搬

可借鉴：

- 用 `forbid-overrides` 表达不可跨越的安全边界；允许规则不能抵消禁用规则。
- safety decision 使用 default deny/request-more-data；policy errors 必须进入 diagnostics。
- 知识热更新采用签名/校验、原子激活和旧版本回退；每次决定记录 bundle revision。

不能照搬：OPA/Cedar 是 policy decision point，不是 scheduler/optimizer。Cedar 的 skip-on-error 对授权系统有理由，但健身安全 gate 应由调用端检查 diagnostics 后 fail closed。把每个训练偏好都建成 deny/permit 会过度二值化，应把偏好留给软约束。

## 6. 推荐与配置系统：FeatureIDE、产品配置冲突修复

Feature model 把一个产品域表示成 feature tree、mandatory/optional/alternative 关系与 cross-tree constraints；用户逐步选择 feature，配置器传播强制选择与排除，最终只允许合法配置。FeatureIDE 是开源实现，支持 feature model、constraint wizard、configuration editor 和产品生成。参见 [FeatureIDE 官方站](https://featureide.de/) 与 [FeatureIDE 论文](https://www.cs.cmu.edu/~ckaestne/pdf/SCP12.pdf)。

这比泛化推荐系统更接近健身动作选择：动作/方法是 feature；器械、经验、疼痛部位、目标和时间是约束；某些选择隐含必需的辅助内容或排除不兼容内容。

产品配置研究通常把冲突编码为 CSP，并在过严的用户要求导致无可行配置时，建议删除/增加组件或选择最符合用户偏好的修复。参见 [A Constraint Satisfaction Approach to Resolving Product Configuration Conflicts](https://doi.org/10.1016/j.aei.2012.03.008)。SAP 官方配置文档也将 conflict 定义为配置不一致，并提供 conflict explanation 与自动修复建议；参见 [SAP Conflict Handling](https://help.sap.com/docs/PRODUCT_ID/dc1d869a338140e480792bd6c3b097c4/48737ae2711272d7e10000000a42189c.html)。

**判断者**是 SAT/CSP/configurator；**unknown** 通常表现为 undecided feature，而不是 false；**conflict** 是当前选择集合无一致扩展；**动态**是用户每次增删选择后重新传播；**解释**可指向导致冲突的 constraints，并给最小改动建议。

可借鉴：将“尚未选择”与“明确排除”分开；实时传播隐含选择；发生冲突时给出最小撤销/替换方案，而不是只说无解。

不能照搬：产品 feature 多是离散、静态兼容关系；训练负荷有时间、剂量和不确定反馈，必须另有时序/优化模型。配置器也不能决定某项知识是否科学可靠。

## 7. JITAI 与 HeartSteps：时变状态下的健身干预

JITAI（Just-in-Time Adaptive Intervention）几乎直接对应“在用户当下状态下，何时给什么训练/活动建议”。经典框架有四个核心组件：

1. decision points：何时做决定；
2. intervention options：可选择的干预，包括“不做任何事”；
3. tailoring variables：位置、活动量、疲劳、可接收性等时变信息；
4. decision rules：tailoring variables 的值/阈值如何映射到 option。

另有 proximal outcome 与 distal outcome，分别用于短期反馈和长期目标。参见 [Nahum-Shani et al., JITAI Key Components and Design Principles](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/) 与 [Micro-randomized Trials overview](https://pmc.ncbi.nlm.nih.gov/articles/PMC9755932/)。

HeartSteps 的个性化算法把当前地点、前 30 分钟步数、昨日步数、温度、过去一周同一时点的活动模式等作为特征；同时把“用户当前是否 available”和干预 dosage/burden 纳入决策。参见 [Personalized HeartSteps](https://pmc.ncbi.nlm.nih.gov/articles/PMC8439432/) 与 [ClinicalTrials.gov HeartSteps Study](https://clinicaltrials.gov/study/NCT03225521)。

### 谁做判断、unknown/conflict、动态与解释

- 判断者可以是预设 decision rule，也可以是 contextual bandit/RL policy；LLM 不是 JITAI 的必要组件。
- availability 是先于推荐效果排序的门控：不可接收时 option 是“不干预”。这与“今天不排训练也是合法决策”一致。
- JITAI 框架本身没有统一的 missing-data/conflict 语义；每项 tailoring variable 必须另行规定观测有效期、缺失处理和可信度。
- 动态调整是核心：每个 decision point 用最新 tailoring variables 重新决策，而不是一次生成永久计划。
- 解释至少应记录 decision point、available、特征快照、policy/rule 版本、选中 option、发送/不发送理由和 proximal outcome。

### 可借鉴 / 不能照搬

可借鉴：用决策时点驱动，而不是聊天触发；先判断 availability/receptivity；把“不行动”和“降低强度”当正式 option；区分短期信号和长期目标；把干预负担作为成本。

不能照搬：微随机试验中的随机化是为了因果估计，不等于面向单个用户的最佳决策；在线 RL 也不能绕过硬安全规则。HeartSteps 主要选择短消息/活动建议，不解决完整多周力量训练编排。

## 8. Knowledge Compilation：把稳定知识预编译成快速查询结构

Knowledge Compilation 的核心是把通用命题理论在离线阶段编译成某种目标语言，再在线回答大量查询。Darwiche 与 Marquis 的 map 用两个维度比较目标语言：表示是否简洁，以及哪些 queries/transformations 可在多项式时间完成。参见 [A Knowledge Compilation Map（JAIR 2002）](https://doi.org/10.1613/JAIR.989)。DNNF 的 satisfiability 等查询可线性完成；d-DNNF 还能支持高效 model counting，参见 [Compiling Knowledge into DNNF](https://www.ijcai.org/Proceedings/99-1/Papers/042.pdf)。

**知识形态**是逻辑公式编译成 OBDD、DNNF/d-DNNF 等 DAG/circuit；**判断者**是确定性的电路查询算法；**unknown** 不来自编译器，而来自输入命题是否给定；可用 conditioning 注入观测。**conflict** 是 conditioned theory 不可满足。**动态**适合频繁改变少量 evidence；规则结构频繁大改可能需要昂贵重编译。**解释**不是自动获得，但针对 d-DNNF 等语言已有可高效计算解释的研究，参见 [Efficient Explanations for Knowledge Compilation Languages](https://arxiv.org/abs/2107.01654)。

可借鉴：把稳定、频繁查询的资格/兼容性逻辑离线编译，运行时只 conditioning 个体事实；用编译后的结构做候选枚举、可行性检查或解释。

不能照搬：规则集规模不大或频繁变化时，编译成本和实现复杂度未必值得；它也不解决连续剂量、跨期优化和知识来源治理。不要把“编译后快”误解为“原始规则正确”。

## 9. SayCan：语言相关性 × 当前可执行性

SayCan 的关键不是普通 RAG，而是把一个候选 skill 的分数拆成两部分：LLM 判断该 skill 对高层指令是否有助益；与 skill 绑定的 value/affordance function 判断它在当前状态下成功的可能性。两者结合后选动作，执行后继续选下一步。参见 [SayCan 项目页](https://say-can.github.io/) 与 [Google Research 官方博客](https://research.google/blog/towards-helpful-robots-grounding-language-in-robotic-affordances/)。

**知识形态**是自然语言 skill 描述、预训练 skill policy 和状态相关 value function。**判断者**是 LLM score 与 learned affordance 的组合，不是确定性规则或 solver。**unknown/conflict** 没有正式语义；低 affordance 只是分数低，不等同于被证明不可行。项目作者也明确说明原版只在当前 decision step 通过 value function 接收环境反馈，skill 失败或环境变化时所需反馈可能不可用，闭环改进由后续 Inner Monologue 工作补上。

可借鉴：候选相关性与可执行性必须分层；知识“看起来适合”不代表用户当下能做。对健身可把语义相关度限制在召回层，把可执行性替换为显式资格规则/约束，而不是照搬 learned value。

不能照搬：概率乘积不提供硬安全保证；skill value 的训练分布之外没有可靠语义；原版不提供完备冲突解释或计划修复。

## 10. LLM+P：让 LLM 写问题，让 planner 解问题

LLM+P 将自然语言 planning problem 转成 PDDL problem，把它与人类专家预先提供、固定的 PDDL domain 一起交给经典 planner，再把 planner 的计划翻回自然语言。论文的核心分工是：LLM 做语言翻译；domain 文件定义动作、前置条件与效果；planner 找可行或最优 plan。参见 [LLM+P 论文](https://arxiv.org/abs/2304.11477) 与 [官方开源仓库](https://github.com/Cranial-XIX/llm-pddl)。

**unknown/conflict**：论文实现没有正式的 unknown 类型；最重要的失败恰恰来自 LLM 生成的 problem 文件漏掉初始条件或错误连接，planner 因而收到一个错误但形式合法的问题并返回无解。论文结果明确指出，LLM+P 的失败多数来自 mis-specified problem files，而不是 planner 推理错误。

**动态**：论文管线是一次性规划，没有状态观测或 repair loop。**解释**：PDDL problem、domain、planner 输出 plan 都可保存和验证，但自然语言回译仍可能偏离结构化计划，必须以结构化计划为审计真相。

可借鉴：只让 LLM 负责自然语言到受限 schema 的映射；由独立 validator 检查输入完整性与 plan；固定、人工审查的 domain knowledge 不由 LLM 即时生成。

不能照搬：如果用户状态抽取错了，solver 的正确性没有帮助；PDDL 对数值剂量、不确定恢复和偏好优化的表达/求解成本可能过高。LLM 生成的结构化输入必须保留 evidence spans、置信度和未解析字段，不能“成功 parse 即可信”。

## 11. Voyager：可执行技能库、向量召回与执行反馈

Voyager 在 Minecraft 中维护不断增长的可执行 JavaScript skill library；成功技能被存储供未来复用，迭代 prompting 纳入环境反馈、执行错误和 critic 的 self-verification。参见 [Voyager 论文/项目](https://voyager.minedojo.org/) 与 [官方仓库](https://github.com/MineDojo/Voyager)。

源码中的 `SkillManager` 为每段程序生成自然语言 description，将 description 写入 Chroma vector store；`retrieve_skills()` 对 query 做 similarity search，默认最多返回 5 个 skill 的代码。参见 [Voyager `skill.py`](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py)。这是一种清晰的“描述用于召回、代码用于执行”分离。

**判断者**仍主要是 LLM action agent 与 critic，环境只提供执行错误和状态反馈；没有形式化的 unknown、规则冲突或硬安全证明。**动态**表现为有限轮程序修复和下一任务再规划；成功后才把 skill 入库。**解释**来自代码、description、错误和 critique，但没有标准化 decision provenance。

可借鉴：知识库保存已执行通过的 procedure，不只保存文字；描述索引与执行 artifact 分离；只在验证成功后提升为可复用技能；召回记录 top-k 和分数。

不能照搬：embedding top-k 不是适用性证明；LLM 生成代码在游戏中可试错，在健康场景不可用同等代价试错；critic 仍可能是 LLM，不足以担任安全判断者。用户明确编辑过的知识、专家规则和系统自学 skill 也不应混在同一信任等级。

## 跨范式可复用设计

### A. 知识数据不应只有“文本块”

一个技术中立的最小知识单元应能同时服务召回、执行和审计：

```yaml
knowledge_id: stable-id
version: semver-or-content-hash
kind: fact | eligibility_rule | decision_table | plan_method | constraint | scoring_term
scope: user-segment / goal / phase / exercise / schedule
inputs:
  - field: knee_pain
    type: tri_state
    freshness: 24h
logic: structured, executable representation
effect: allow | forbid | require | prefer | decompose | score
priority_or_hit_policy: explicit
source:
  uri: ...
  section: ...
  evidence_level: ...
validity:
  effective_from: ...
  review_due: ...
explanation_template: ...
tests: ...
```

文本说明可以与它绑定，但不应是唯一可执行内容。

### B. 召回管线：先确定性过滤，再语义排序

1. 用 `kind/scope/version/effective date/data requirements` 过滤。
2. 用 entity/code/goal/phase 做精确匹配。
3. 必要时用 embedding 对剩余候选做语义 top-k。
4. 把召回结果交给规则/solver；不要把相似度当适用度。
5. 记录 query、filters、候选 IDs、分数、被截断项和索引版本。

这综合了 FHIR 的可发现知识制品与 Voyager 的 skill retrieval，同时避免 SayCan/纯 RAG 中“相关即正确”的风险。

### C. 建议的确定性决策层次

按语义而非实现技术分层：

1. **数据有效性层**：类型、单位、时间戳、来源、观测新鲜度；输出 known/unknown/stale/conflicting。
2. **安全 guardrail 层**：`forbid-overrides`；缺关键安全数据时 request-more-data 或 fail closed。
3. **资格/分级层**：DMN 式表格与三值表达式；每张表声明 hit policy。
4. **结构分解层**：HTN/PlanDefinition 式阶段、模板、动作关系。
5. **全局组合层**：solver 处理时间、恢复、容量、偏好和 change cost。
6. **验证层**：独立模拟/validator 检查动作前置条件、周约束和输出 schema。
7. **表达层**：LLM 只将结构化决定转成个性化、可理解的自然语言。

### D. unknown 与 conflict 的统一语义

至少保留以下结果，不能只用布尔：

| 状态 | 含义 | 默认处理 |
|---|---|---|
| `true/eligible` | 有充分事实支持 | 可进入下一层 |
| `false/ineligible` | 有充分事实反证 | 排除并记录 rule ID |
| `unknown` | 关键事实未观测或不够新鲜 | 请求信息、降级或延迟；不能自动当 false |
| `conflicting_input` | 同一事实有不兼容来源 | 按来源/时间政策解析或人工确认 |
| `rule_conflict` | 多条规则得出不兼容结论 | 用显式 hit policy；安全 forbid 优先 |
| `infeasible` | 已证明所有候选都违反硬约束 | 给冲突核心和最小放宽方案 |
| `unknown_solver_status` | 超时/资源限制，未证明无解 | 不宣称无解；可使用已验证 feasible incumbent 或降级 |
| `model_invalid/error` | 知识或问题模型错误 | 阻断并告警，不向用户伪装为个体不适用 |

### E. 动态重规划：事件驱动的滚动 horizon

适合触发重规划的事件包括：session 完成/跳过、疼痛或不适、readiness 明显变化、可用时间/器械变化、表现偏离、人工覆盖、知识版本更新。重规划应：

1. 冻结已经完成和正在执行的部分；
2. 用最新但经过 freshness 检查的状态替换旧输入；
3. 重新执行 guardrail 与资格判断；
4. 对剩余 horizon 重新求解；
5. 在 objective 中惩罚不必要的改动；
6. 输出 plan delta，而非只输出新全文；
7. 保存触发事件、旧/新计划 ID、改变的约束、目标值与原因。

这比“每次聊天都生成新计划”更接近 UP Replanner/PlanRepairer、JITAI decision points 与 receding-horizon 控制的共同结构。

### F. 可追溯解释：决策账本而非文案

每次 plan/adjustment 建议产生不可变 decision record：

```yaml
decision_id: ...
timestamp: ...
input_snapshot_id: ...
knowledge_versions: [...]
retrieval:
  query: ...
  candidate_ids: [...]
evaluation:
  matched_rules: [...]
  excluded_by: [...]
  unknowns: [...]
  conflict_policy: ...
planning:
  solver_status: feasible | optimal | infeasible | unknown
  hard_constraints: [...]
  soft_objectives: [{id: ..., value: ...}]
  unsat_core: [...]
output_plan_id: ...
supersedes_plan_id: ...
human_override:
  outcome: ...
  reason_code: ...
  comment: ...
```

自然语言“为什么这样安排”应从这份记录生成，并能下钻到 rule/constraint/source；不能让 LLM 事后猜原因。OPA decision logs、Cedar determining policies、CDS Hooks feedback、solver core 和 FHIR canonical/version 共同支持这一结论。

## 适合健身 Planner 的技术中立方案边界

### 值得采用的组合

- **知识注册表**：版本化、可测试、可追溯的 facts/rules/methods/constraints；正文用于解释，结构化逻辑用于执行。
- **LLM 边界层**：意图与状态抽取、候选知识语义召回、结构化 trace 的自然语言呈现；所有抽取保留原始证据、置信度和 unresolved fields。
- **规则层**：三值资格判断，显式 hit policy；安全规则使用 forbid-overrides，偏好不冒充安全规则。
- **计划层**：领域模板/HTN 提供训练结构，约束优化器完成具体排期与剂量组合，独立 validator 验证。
- **调整层**：按事件和固定 decision points 运行滚动重规划，优化目标包含效果、负担和计划稳定性。
- **审计层**：完整 decision ledger，支持知识版本回放、人工覆盖、冲突解释和计划 delta。

### 不宜做的事情

- 不让向量检索结果直接决定适用性。
- 不让 LLM 同时充当知识作者、资格裁判、solver 和解释者。
- 不把 missing/stale/conflicting 数据折叠成 false 或默认正常。
- 不把所有知识都写成规则；层次结构、硬约束、软偏好和经验评分有不同语义。
- 不在 infeasible 时偷偷放松硬约束；应显示冲突核心，并只让用户/专家对被声明为可放松的约束做选择。
- 不把“找到 feasible”描述成“已证明 optimal”，也不把 solver `UNKNOWN` 描述成“无解”。
- 不把 JITAI 的探索性随机化、Voyager 的试错或 SayCan 的概率 affordance 直接用于安全相关训练决策。
- 不把 FHIR、PDDL、DMN、OPA 或某个 solver 当成必须采用的技术栈；真正应复制的是其明确语义和责任分离。

## 最终判断

对健身 Planner，最接近成熟 prior art 的不是一个现成 Agent 框架，而是四类系统的组合范式：

1. **FHIR/CQL/DMN 式知识制品与确定性适用性判断**；
2. **HTN/PlanDefinition 式专业结构分解**；
3. **CP/SMT/PDDL 式可行性、排期、验证与修复**；
4. **JITAI/rolling-horizon 式状态反馈和重复决策**。

LLM+P、SayCan 和 Voyager 提供的共同启示，是让 LLM 负责语言和候选，而让外部世界模型、规则、validator 或 solver 对“能不能、该不该、是否成功”负责。健身领域还应比这些研究系统更严格：自学知识不能未经审核提升为安全规则，所有关键缺失数据与人工覆盖都要进入可回放的决策记录。

如果只能先实现一条纵向切片，应优先做：**一个版本化知识单元 → 一个三值资格规则 → 一个带硬/软约束的短 horizon 计划 → 一次状态变化后的 plan repair → 一份可回放 decision trace**。这条切片能验证核心语义，且不绑定任何具体规则引擎、planner 或 solver。
