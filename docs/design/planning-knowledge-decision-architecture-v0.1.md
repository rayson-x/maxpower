# Planner 知识判断架构 v0.1

日期：2026-08-13
状态：设计基线；尚未进入实现
范围：领域知识如何被主 Agent、判断模块与 Planner 消费；不选择具体数据库或规则引擎。

## 1. 设计结论

MaxPower 不建立一棵覆盖全部场景的总决策树，也不把按相关性排序的知识段落交给 LLM 自由判断。

采用混合架构：

1. 主 Agent 负责自然语言交互、事实候选提取、关键澄清、工具调用、解释和取得确认。
2. 事实模块负责把候选事实规范化为 `known / estimated / unknown / stale / conflict`，并保留来源、时间和修订。
3. 知识判断模块负责定位适用知识、执行三值规则、产生硬约束、软偏好、行动候选、缺失信息和观测要求。
4. Planner 负责目标分解、排期、动作和剂量组合、候选排序及最小计划差异。
5. 独立 Validator 负责验证候选计划，不允许 Planner 或 LLM 绕过硬约束。
6. 用户确认后才提交未来 `PlanRevision`；Timeline 新事实或定时决策点触发未来部分重算。

LLM 是语言入口和表达层，不是领域权威、规则作者、资格裁判或计划验证器。

## 2. 三条系统不变量

### 2.1 No Fabricated Authority

任何影响计划的领域断言必须引用已发布的知识制品、规则或计算器版本。LLM 生成的知识、阈值、证据等级和因果解释没有执行权限。

### 2.2 Closed Action World

Planner 能提出的变更来自已审核的 `ActionDefinition` 封闭集合。LLM 不得创造新的训练、营养、恢复或安全行动。未覆盖的需求返回 `unsupported` 或进入知识建设流程。

### 2.3 Every Diff Has a Decision Path

每一项计划差异必须能反向追溯到：输入事实 → 求值规则/计算器 → 约束或目标贡献 → ActionDefinition → Planner 候选 → Validator 结果。无法形成完整路径的差异不得展示或提交。

## 3. 为什么不使用总决策树

局部决策树或决策表适合：

- 安全停止与转介分流；
- 必要资料门禁；
- 封闭输入下的资格分级；
- 明确的权限和确认规则。

总决策树不适合同时处理目标、水平、训练量、肌群疲劳联动、有氧、营养、恢复、时间、器械、依从性和偏好。新增一个维度会复制大量分支，冲突规则只能依赖隐含顺序，并且难以做全局排期。

因此将问题拆为：局部规则判断、专业任务分解、约束组合和多目标排序。

## 4. 责任与权限

| 模块 | 可以做 | 不可以做 |
|---|---|---|
| 主 Agent | 判断用户意图；提取带原文引用的事实候选；提出模块返回的问题；调用 Planner；解释结构化结果；取得确认 | 发明领域结论、阈值或动作；覆盖硬约束；直接写计划 |
| Fact Admission | 类型/单位/时间规范化；来源和新鲜度判断；冲突识别；生成事实快照 | 把缺失当正常；把模型猜测升级为用户事实 |
| Knowledge Retrieval | 按 scope、目标、阶段、实体、输入要求和版本缩小候选；为解释召回原文 | 将语义相似度当作适用性或执行许可 |
| Decision Evaluator | 三值求值；安全门控；规则冲突处理；输出约束、行动候选和缺失项 | 生成具体周计划；修改 Ledger |
| Planner | 目标分解；候选计划构造；排期、剂量、疲劳和变动成本计算；输出 plan diff | 偷偷放宽硬约束；提交计划 |
| Validator | 独立检查 schema、前置条件、硬约束、周量、时间、恢复和历史冻结 | 用文案解释替代验证 |
| User | 确认价值取舍、可放宽约束和计划变更 | 覆盖系统不能提供的安全许可 |

## 5. 价值取舍由谁决定

1. 有明确硬边界：规则或 Validator 决定，不能选择。
2. 用户已在 `GoalContract` / `Mandate` 中明确优先级：版本化 objective/scorer 决定。
3. 多个候选在硬约束内，但差异取决于尚未表达的价值偏好：返回 `requires_choice`，由用户选择。
4. 证据或关键事实不足：返回 `insufficient_evidence`，请求信息、采用已声明的保守默认值或保持计划。
5. LLM 不替用户做未声明的价值判断，也不在同层冲突知识中静默选边。

## 6. 知识数据建设

知识不按文章目录直接进入 Planner，而要形成以下可独立版本化的制品。

### 6.1 Domain Catalog

稳定实体、术语、别名和关系：动作、变式、动作模式、肌群、器械、目标、指标、观测方法和替代关系。

### 6.2 Evidence Claim

审核后的领域声明，必须包含：

- 支持的结论；
- 适用人群和上下文；
- 不能支持的推论；
- 证据等级及其来源；
- 版本、审核和失效信息。

原文 `passage/gist/keypoint` 用于理解、解释和审核，不直接获得执行权限。

### 6.3 Decision Rule

用于资格、分级、门控和局部判断：

```ts
interface DecisionRuleDefinition {
  id: string;
  version: string;
  scope: DecisionScope;
  triggers: readonly TriggerKind[];
  requires: readonly FactRequirement[];
  when: TriStateExpression;
  unless?: TriStateExpression;
  hitPolicy: "unique" | "any_same_output" | "priority" | "collect";
  priorityClass:
    | "hard_boundary"
    | "feasibility"
    | "protective_guardrail"
    | "objective"
    | "preference"
    | "advisory";
  emits: readonly DecisionEffect[];
  unknownPolicy: "block" | "ask" | "keep_plan" | "conservative_default";
  evidenceRefs: readonly string[];
  cannotSupport: readonly string[];
}
```

### 6.4 Plan Method

表达教练通常如何把目标分解成阶段、滚动周、训练日、刺激槽位和动作。它定义搜索空间，不证明某种分解一定适用于用户；适用性由 Decision Rule 判断。

### 6.5 Constraint / Objective

- `HardConstraint`：安全、历史冻结、器械、时间和不可违反的计划条件；
- `SoftConstraint`：用户偏好、体验、最小变动；
- `ObjectiveDefinition`：目标效果、训练质量、恢复风险、依从性负担和信息价值；
- 权重必须版本化，不能藏在 prompt 中。

### 6.6 Action Definition

定义 Planner 可以实例化的未来行动及其前置条件、允许作用范围、最大改动幅度、预测影响、不确定性、确认要求和后续观察。

### 6.7 Observation Definition

定义行动之后看什么、如何保证可比、观察窗口、成功/失败/证据不足信号，以及何时允许再次判断。预测效果和实际观察必须分开保存。

### 6.8 Scenario Fixture

每条规则、方法和行动随知识包发布测试场景，包括命中、不命中、unknown、冲突、安全边界和知识升级差异。

## 7. 快速召回不等于判断

在线流程按以下顺序执行：

1. 根据 trigger、scope、目标模式、阶段、实体、版本和数据要求做确定性过滤；
2. 通过别名和实体索引定位领域对象；
3. 仅在长尾表达和解释材料中使用 lexical/vector search；
4. 对候选规则执行 applicability 和三值判断；
5. 扩展被命中规则依赖的 method、constraint、action 和 observation；
6. 生成最小 `DecisionBundle` 给 Planner，而不是把 Top-K 文档塞给 LLM。

语义召回可以帮助找到候选，但只有经过规则求值和版本验证的知识才有执行权限。

## 8. 深模块 Interface

对主 Agent 暴露一个小而完整的 seam：

```ts
interface PlanningDecisionModule {
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
  confirm(request: DecisionConfirmation): Promise<CommitOutcome>;
  readDecision(decisionId: string): Promise<DecisionRecord>;
}
```

`decide` 内部完成事实解析、知识版本冻结、规则求值、Planner 构造和 Validator 复核，但不修改生效计划。

```ts
type DecisionOutcome =
  | { kind: "ready"; action: "create" | "adjust" | "keep"; proposal?: PlanProposal }
  | { kind: "requires_information"; questions: readonly ClarifyingQuestion[] }
  | { kind: "requires_choice"; choices: readonly ValueTradeoff[] }
  | { kind: "conflict"; conflicts: readonly DecisionConflict[] }
  | { kind: "infeasible"; core: readonly ConstraintRef[]; relaxations: readonly Relaxation[] }
  | { kind: "unsupported"; missingCapability: string };
```

确认必须绑定 `proposalHash + basePlanRevision + factFrontier + knowledgePins`。任何一项变动即返回 `stale` 并重新判断。

## 9. 内部判断管线

```text
user message / timer / Timeline change
  -> intent + FactClaim extraction
  -> Fact Admission and State Snapshot
  -> knowledge candidate retrieval
  -> tri-state Decision Rules
  -> hard guardrail and eligibility
  -> Plan Methods produce skeleton candidates
  -> constraints and objectives compose/sort candidates
  -> independent Validator
  -> DecisionOutcome + DecisionRecord
  -> Agent explanation / question / confirmation
  -> atomic future PlanRevision commit
  -> outcome observations return to Timeline
```

## 10. Decision Record

不保存隐式思维链，保存可重放的结构化日志：

```ts
interface DecisionRecord {
  decisionId: string;
  triggerRef: string;
  inputSnapshotId: string;
  factFrontier: readonly RevisionRef[];
  knowledgePins: readonly VersionPin[];
  retrieval: { query: StructuredQuery; candidates: readonly KnowledgeRef[] };
  evaluations: readonly {
    ruleRef: KnowledgeRef;
    result: "matched" | "not_matched" | "unknown" | "conflict";
    inputFactRefs: readonly string[];
    missingFactKeys: readonly string[];
    emittedRefs: readonly string[];
  }[];
  candidatePlans: readonly CandidateTrace[];
  validation: ValidationResult;
  selectedCandidateId?: string;
  proposalHash?: string;
  confirmation?: ConfirmationRecord;
  committedPlanRevision?: number;
}
```

支持两种回放：

- `exact`：使用原事实、知识、规则和模型版本复现当时判断；
- `latest_knowledge`：固定原事实，使用最新知识评估哪些结论会改变。

## 11. 两个场景的正确语义

### 11.1 “今天睡得不好，可以换肩训练吗？”

1. Agent 只提取睡眠差、腿部酸痛、其他部位主观正常、换课请求等事实候选；不能自行推导具体风险或阈值。
2. Fact Admission 根据原文、时间和用户确认生成当前快照；关键程度不清时返回最多几个真正改变决策的问题。
3. Decision Evaluator 求值已审核的恢复、局部疲劳、相邻课联动和换课规则。
4. Planner 只从允许的 ActionDefinition 生成保持、低扰动调整或换课候选，并检查后续胸/背/肩联动。
5. 如果用户价值偏好已明确，scorer 可选择；否则返回 trade-off 让用户选择。
6. Agent 解释规则结果和计划差异，不能补充未被知识制品支持的风险断言。

### 11.2 “减脂期昨天聚餐吃多了”

1. 分清量化摄入和模糊估计；模糊陈述不能伪装成精确 1000 kcal。
2. 规则判断单次事件是否实质影响当前目标路径，而不是一律补偿或一律忽略。
3. GoalContract 的目标期限、保护目标、执行档位和减速许可决定调整刚性。
4. Planner 只能在可接受的饮食、活动和训练质量护栏内生成未来候选；不得用惩罚性运动或破坏关键训练来“还债”。
5. 候选需要说明估计区间、计划影响、改动代价和观察窗口；用户确认后才修改未来计划。

## 12. 独立方案比较与裁决

### ACPX Claude 初版

优点：正确提出硬约束 veto、适用性门控、事实生命周期和候选计划。
问题：在没有资料的情况下，直接发明睡眠阈值、动作风险结论和 evidence 等级，并让 LLM 从 Top-K 候选中选择。这证明“让 LLM 成为领域裁判”会把流畅表达误当权威。

Claude 在二次审视后修订为：LLM 不拥有领域候选选择权；任何领域断言必须来自审核记录；动作集合封闭；价值取舍交给明确 objective 或用户。

### 最小接口方案

优点：`decide / confirm / readRecord` 形成深模块；unknown/conflict/infeasible 是正式结果；确认绑定 proposal hash 和计划修订，防止旧确认覆盖新计划。
采用：作为外部 seam 基线。

### 高扩展性方案

优点：支持规则、公式、决策表、概率模型、scorer 和 solver 共存；强调 exact/latest-knowledge 双回放、知识发布生命周期和分层测试。
采用：作为内部实现与知识治理基线。

### 最终裁决

采用二者的混合：外部保持最小 interface，内部允许多种受治理的判断机制。主 Agent 可以决定何时调用模块并管理对话流程，但不得自行产生领域结论或选择未由目标合同决定的价值取舍。

## 13. 公开先例支持

- FHIR PlanDefinition/CQL：知识定义、个体上下文和行动提案分离；条件支持三值逻辑；提案不自动执行。
- DMN/FEEL：规则命中冲突由显式 hit policy 处理，不依赖模型临场判断。
- HTN/HDDL：领域方法把高层目标分解为可执行任务。
- CP-SAT/Z3：负责排期、资源、硬约束、软目标和不可行状态。
- OPA/Cedar：适合安全 `forbid-overrides`、默认拒绝和结构化 decision log。
- Unified Planning：计划生成、验证、重规划与计划修复是不同 interface。
- JITAI：以 decision point、时变 tailoring variable、行动选项和近端结果形成持续调整闭环。
- LLM+P：LLM 做自然语言到结构化 problem 的翻译，固定领域模型和 planner 决定计划；也暴露了“入口事实翻译错误”仍会污染正确 solver 的风险。
- SayCan/Voyager：说明语言相关性、技能召回和现实可执行性必须分开，但其概率选择或试错机制不足以直接承担健身安全决策。

详细来源与逐项比较见：

- `docs/research/2026-08-13-domain-knowledge-for-adaptive-planning.md`
- `docs/research/2026-08-13-knowledge-to-decision-planning-prior-art.md`

## 14. 最小验证切片

先实现一个纵向切片，不迁移整个知识库：

1. 一个版本化知识声明；
2. 一个带 unknown 语义的资格规则；
3. 一个硬约束和一个软目标；
4. 两个封闭 ActionDefinition；
5. 一个短 horizon 计划候选与独立验证；
6. 一次 Timeline 事实变化后的 future-only plan repair；
7. 一份可 exact replay 的 DecisionRecord。

优先选择“力量与有氧并发安排”作为切片，因为它同时覆盖目标优先级、课时、训练质量、疲劳、安全筛查、用户偏好和动态排程，又不会迫使首版解决全部营养与体重预测问题。

成功标准：相同快照和知识版本产生相同结构结果；关键事实缺失不会变成默认正常；所有 plan diff 有完整 decision path；硬约束 fixture 零违规；旧确认无法提交新提案；知识升级能通过 latest-knowledge replay 展示差异。
