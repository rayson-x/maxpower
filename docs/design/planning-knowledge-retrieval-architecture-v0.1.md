# Planner 知识召回架构 v0.1

日期：2026-08-13
状态：设计基线；尚未进入实现
关联设计：`planning-knowledge-decision-architecture-v0.1.md`

## 1. 结论

MaxPower 不应建立一个同时服务用户记忆、领域判断和知识问答的通用 RAG 模块。

召回应按权限和消费者拆成三条路径：

1. **State Recall**：从 Ledger / Timeline 生成当前用户状态和时间窗口特征；以结构化投影为主，不依赖语义搜索。
2. **Decision Recall**：为判断模块定位规则、方法、约束、目标、行动和观测定义；以确定性索引、依赖展开和适用性求值为主，不把结果交给 LLM 自由判断。
3. **Evidence Recall**：为 Agent 回答与解释召回 gist、keypoint、passage 和 citation；允许 lexical/vector 检索，但没有执行权限。

“分层蒸馏”适合 State Recall 的时间摘要和 Evidence Recall 的渐进披露，但不应替代 Decision Recall。可执行知识不是原文的更短摘要，而是经过审核、带封闭语义的知识制品。

## 2. 当前实现诊断

仓库已经有以下基础：

- `KnowledgeGist`：L2 一句话要点；
- `KnowledgeKeypoint`：L1 结论与边界；
- `KnowledgePassage`：L0 审核原文；
- gist/keypoint 可以下钻到 passage；
- `searchPassages()` 提供离线、确定性、可回放的关键词检索；
- `knowledge.search` 返回原文、引用、typed missing 和知识版本。

但当前存在两个断点：

1. `searchKnowledge()` 运行时只检索 `passages`，没有使用已经定义的 gist/keypoint 渐进召回。
2. `GoalCyclePlanner` 直接读取 `programStrategies()`；解释检索与 Planner 的领域判断是两条互不连接的路径。

所以不能简单把 passage 再摘要几层就认为 Planner 获得了判断能力。

## 3. 用户记忆与领域知识不是同一种分层

### 3.1 用户状态可以采用记忆式分层

```text
L0 Immutable Events
  原始训练、饮食、恢复、测量、用户修正
          ↓ 确定性投影
L1 Effective Facts
  当前有效事实，保留 known/estimated/stale/conflict
          ↓ 版本化计算
L2 Window Features / Episodes
  7/14/28 天完成率、趋势、连续失败、近期训练负荷
          ↓ 达到晋升条件
L3 Personal Priors
  稳定偏好、个人休息节奏、可重复的响应范围
```

约束：

- 上层永远保存下层 fact/event refs；
- L2/L3 必须保存计算器版本、窗口、置信度和失效条件；
- 摘要不能覆盖原始事实；
- 单次对话推测不得直接晋升为 L3；
- 查询必须声明 `asOf` 时间，避免用未来事实解释过去决定。

这部分与 Agent Memory 的抽象金字塔相似，但它服务的是“当前用户是什么状态”。

### 3.2 领域知识应采用编译链，而不是摘要金字塔

```text
Source / Citation
       ↓ 人工审核
Evidence Claim
       ↓ 领域建模与测试
Decision Rule / Plan Method / Constraint / Action / Observation
       ↓ 构建期校验与索引
Published DecisionPack
```

`Evidence Claim`、`Decision Rule` 和 `ActionDefinition` 不是 L0/L1/L2 的同义摘要。它们承担不同语义：

- Claim 说明来源支持什么、不能支持什么；
- Rule 说明什么输入下产生什么判断；
- Method 说明高层目标如何分解；
- Constraint 说明什么不能违反或应尽量满足；
- Action 说明 Planner 被允许修改什么；
- Observation 说明之后如何验证效果。

因此可执行知识必须编译和审核，不能由模型在召回时临时从 passage 蒸馏出来。

### 3.3 解释内容采用渐进披露

```text
L2 Gist       默认低 token 回答
  ↓ 需要细节
L1 Keypoint   完整结论与边界
  ↓ 需要证据或核验
L0 Passage    审核原文与 Citation
```

每层只允许确定性蒸馏，并必须能下钻到原文。该层级仅用于理解和解释，不改变领域判断结果。

## 4. 为什么需要三个召回模块

三类召回的正确性定义完全不同：

| 召回路径 | 正确性 | 主要失败 | 是否可用向量检索 |
|---|---|---|---|
| State Recall | 指定时间点事实正确、新鲜、冲突未丢失 | 用错时间窗、复活被修正事实、把缺失当正常 | 通常不需要 |
| Decision Recall | 所有强制规则和依赖均被纳入，适用性正确 | 漏安全规则、相关即适用、依赖不完整 | 只可辅助长尾候选，不可决定 |
| Evidence Recall | 相关、可读、可下钻、有有效引用 | 找不到同义表达、引用与结论不一致 | 可以 |

把三者合并成一个 `search(query)` 会形成浅模块：调用方必须自己理解结果类型、权限、缺失处理、适用性和版本，复杂性重新泄漏给 Agent 和 Planner。

## 5. Seam 设计

### 5.1 主 Agent 不直接访问 Decision Recall

主 Agent 继续使用高层的 `PlanningDecisionModule.decide()`。Decision Recall 是该深模块的内部实现，不能成为 LLM 的自由搜索工具。

```ts
interface PlanningDecisionModule {
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
  confirm(request: DecisionConfirmation): Promise<CommitOutcome>;
  readDecision(decisionId: string): Promise<DecisionRecord>;
}
```

这样删除知识索引、修改召回算法或换存储 Adapter 时，Agent 和 Planner 的外部 interface 不变。

### 5.2 内部 Decision Recall seam

判断模块内部使用一个入口：

```ts
interface DecisionKnowledgeResolver {
  resolve(context: DecisionContext): DecisionBundle;
}

interface DecisionContext {
  trigger: PlannerTrigger;
  scope: "initial_plan" | "daily_adjustment" | "weekly_review" | "phase_review";
  state: PlanningStateSnapshot;
  goal: GoalContractSnapshot;
  currentPlan?: PlanSnapshot;
  knowledgeRelease: KnowledgeReleasePin;
}
```

调用者不传关键词、不指定 top-k、不自己挑规则。Resolver 隐藏索引选择、实体展开、依赖闭包、适用性判断、token/size budget 和 trace。

```ts
interface DecisionBundle {
  disposition: "ready" | "insufficient_evidence" | "conflict" | "blocked";
  evaluatedRules: readonly EvaluatedRule[];
  methods: readonly PlanMethodRef[];
  hardConstraints: readonly EvaluatedConstraint[];
  softPreferences: readonly EvaluatedPreference[];
  objectives: readonly EvaluatedObjective[];
  actionDefinitions: readonly ActionDefinitionRef[];
  observationRequirements: readonly ObservationRequirement[];
  missingFacts: readonly MissingFact[];
  conflicts: readonly KnowledgeConflict[];
  evidenceRefs: readonly EvidenceRef[];
  knowledgePins: readonly VersionPin[];
  recallTrace: RecallTrace;
}
```

### 5.3 Agent 可访问 Evidence Recall

Agent 的知识问答工具只服务回答和解释：

```ts
interface EvidenceRecall {
  search(request: EvidenceQuery): EvidenceBrief;
  expand(request: EvidenceExpansion): EvidenceBrief;
}
```

两个入口的原因是调用语义确实不同：`search` 从自然语言找到知识，`expand` 从已命中的 gist/keypoint 或 decision trace 引用向下展开。

计划解释优先使用 `DecisionRecord.evidenceRefs` 做精确读取，而不是重新进行语义搜索。只有用户提出超出当前决定的新问题时才调用 `search`。

## 6. Decision Recall 在线管线

### 6.1 构造结构化 Context

触发来源可能是对话、Timeline change、训练完成、定时复盘或 Realtime finalization。主 Agent 只负责把自然语言转成带证据引用的 FactClaim；事实模块生成稳定的 `PlanningStateSnapshot`。

Resolver 从以下结构化字段开始，而不是从整句自然语言开始：

- trigger 与 decision scope；
- goal mode、deadline、guardrails、execution tier；
- training level 和当前 phase；
- 涉及的 exercise/muscle/session/measurement 实体；
- 当前计划和近端未来窗口；
- 事实可用性、新鲜度和冲突状态。

### 6.2 强制包含，不参与 Top-K

以下内容通过 scope 索引强制纳入：

- 相关领域的安全和 forbid 规则；
- 用户已确认的硬约束；
- 当前 GoalContract 的保护目标；
- 当前计划修订与已经完成的历史；
- 当前 action kind 的 Validator 规则。

安全规则不能因为相似度低或 token budget 被截断。

### 6.3 确定性候选过滤

按下列索引求交集或并集：

```text
byScope
byTrigger
byGoalMode
byPhase
byEntityType / byEntityId
byRequiredFactKey
byActionKind
byEffectiveVersion
```

规则可以被初步分为：必定相关、可能相关、不相关。这里只缩小候选，不决定适用性。

### 6.4 实体与关系展开

使用已审核的 Domain Catalog 做有限展开，例如：

```text
bench_press
  -> horizontal_push
  -> chest / triceps / anterior_deltoid participation
  -> fatigue and recovery constraints
  -> affected future session intents
```

展开必须有明确类型、方向、最大深度和允许关系集合，不能做任意 graph traversal。

### 6.5 依赖闭包

对候选规则加载其显式依赖：

- required facts；
- calculators；
- parent evidence claims；
- emitted constraints/objectives；
- enabled action definitions；
- observation definitions；
- Validator rules。

缺少依赖时返回 `model_invalid`，不能让 LLM 补齐。

### 6.6 三值适用性求值

每条规则必须返回：

```text
matched
not_matched
unknown
conflict
blocked_by_higher_priority
```

`unknown` 后的行为来自规则自己的 `unknownPolicy`，例如询问、保持计划、使用保守默认或阻断。没有统一的“unknown = false”。

### 6.7 分层冲突与排序

先按 priority class 处理，不使用一个全局相关性分数：

```text
hard boundary
feasibility
protective guardrail
objective
preference
advisory
```

只有同层的软候选才进入 scorer。排序依据可以包括目标匹配、计划扰动、恢复风险、执行负担和用户偏好，但权重必须版本化。

### 6.8 组装最小 DecisionBundle

Bundle 只包含本次 Planner 真正需要的规则结果和依赖。它不是 top-k 文档，也不是把所有知识塞入上下文。

LLM 通常不需要看到完整 Bundle；它读取最终 `DecisionOutcome` 和用户可见的结构化理由。

## 7. Evidence Recall 在线管线

### 7.1 查询分类

先区分：

- `explain_current_decision`：按 DecisionRecord 的 ID/ref 精确读取；
- `domain_question`：进行分层搜索；
- `source_verification`：直接下钻 citation/passage；
- `unsupported_question`：返回 typed missing。

### 7.2 逐层检索

对于一般领域问题：

1. 精确实体、主题、来源状态和语言过滤；
2. 在 gist 上做 lexical/hybrid search，返回较宽候选；
3. 对命中的 gist 加载关联 keypoint，检查结论边界；
4. 需要引用时加载 passage/citation；
5. 只输出 `curated` 且非 U 级的可支撑结论；
6. 将 `cannotSupport` 一同带给 Agent。

Embedding 只用于补充口语、长尾表达和跨语言召回。最终排序至少结合：

- exact entity/topic match；
- lexical score；
- optional semantic score；
- evidence mapping status；
- language/locale；
- recency/effective version；
- 与已引用 passage 的 drill-down 完整性。

### 7.3 不同预算下的渐进披露

- 默认回答：gist；
- 用户追问“为什么”：keypoint + 边界；
- 用户要求依据：passage + citation；
- Planner 解释：优先 trace 中已经固定的 evidence refs。

这才是当前 gist/keypoint/passage 三层真正适合发挥的地方。

## 8. State Recall 在线管线

Planner 不应该搜索用户全部历史文本。它请求一个 trigger-specific snapshot：

```ts
interface PlanningStateProjector {
  project(request: {
    userId: string;
    asOf: string;
    trigger: PlannerTrigger;
    horizon: { pastDays: number; futureDays: number };
  }): PlanningStateSnapshot;
}
```

内部按场景物化不同 view：

- 首次计划：档案、目标、安全、器械、日程和历史水平；
- 课前调整：最近训练、局部疲劳、恢复、下一课和相邻课；
- 聚餐事件：量化/估计摄入、滚动能量路径、目标刚性和后续日程；
- 周复盘：饮食覆盖、关键训练完成、连续失败、体重/腰围可比趋势；
- 平台期：测量质量、观察窗口、执行覆盖、能量路径和恢复。

L2/L3 摘要只是加速投影的物化视图。发生冲突或需要审计时必须能回到 L0 event refs。

## 9. 构建期索引

当前知识规模很小，首版使用随 `KnowledgePack` 发布的本地 JSON/TypeScript 索引即可，无需图数据库或向量数据库。

构建过程：

1. 校验所有稳定 ID、版本和引用；
2. 构建 trigger/scope/goal/phase/entity/fact/action 多列倒排索引；
3. 构建 rule dependency closure；
4. 检查循环、dangling refs、不可达 action；
5. 对决策表做 gap/overlap 和 hit-policy 检查；
6. 为 gist/keypoint/passage 构建 lexical index；
7. 可选构建本地 embedding index；
8. 运行 scenario fixtures；
9. 生成 content hashes 与 release manifest；
10. 原子激活新包，保留旧包供 exact replay。

只有当本地 profiling 证明检索规模或跨包查询成为瓶颈时，才考虑专用搜索引擎或向量数据库。

## 10. Recall Trace

每次 Decision Recall 保存：

```ts
interface RecallTrace {
  contextFingerprint: string;
  knowledgeRelease: VersionPin;
  mandatoryRuleIds: readonly string[];
  indexesUsed: readonly string[];
  candidateRuleIds: readonly string[];
  dependencyIds: readonly string[];
  evaluated: readonly {
    ruleId: string;
    result: "matched" | "not_matched" | "unknown" | "conflict";
    factRefs: readonly string[];
    missingFactKeys: readonly string[];
  }[];
  truncatedCandidates: readonly { id: string; reason: string }[];
  bundleHash: string;
}
```

Evidence Recall 另存 query、过滤条件、gist/keypoint/passage 命中、分数、索引版本和下钻路径。State Recall 保存 as-of、窗口、projection/calculator 版本及输入 event refs。

## 11. 验收指标

### State Recall

- as-of 回放正确；
- 已修正事实不会复活；
- stale/conflict 不被摘要吞掉；
- 所有派生值能返回输入事件和计算器版本。

### Decision Recall

- mandatory safety rule recall 必须为 100%；
- 相同 context + release 得到相同 bundle hash；
- 缺关键事实稳定返回 unknown/insufficient evidence；
- 所有 action 都有完整 rule/evidence/validator 依赖；
- 不能因 top-k 或 token budget 丢失硬规则；
- 新知识包可用历史场景做 recall/decision diff。

### Evidence Recall

- gist 命中后能正确下钻到 keypoint/passage；
- 所有用户可见 claim 有 curated citation；
- `cannotSupport` 不丢失；
- typed missing 时 Agent 不使用模型先验补答；
- 使用 Recall@K、nDCG、citation precision 评估语义检索，不把这些指标用于判断层。

## 12. 推荐落地顺序

1. 保留现有 `searchPassages()`，先让 runtime 真正使用 gist → keypoint → passage 渐进披露。
2. 定义 `PlanningStateSnapshot` 的 trigger-specific views，避免 Planner 搜索原始历史。
3. 定义 DecisionPack 的 trigger/scope/entity/required-fact 索引和三值规则结果。
4. 在 `PlanningDecisionModule` 内实现 `DecisionKnowledgeResolver`，不新增 Agent 可自由调用的决策搜索工具。
5. 让计划解释从 DecisionRecord 的 evidence refs 精确读取，减少自由搜索。
6. 用“力量与有氧并发安排”做影子召回：验证强制规则、unknown、依赖闭包、bundle hash 和 future-only repair。
7. 只有 lexical recall 明确无法覆盖长尾表达时，才增加本地 embedding adapter；它只改变 Evidence Recall 实现，不改变外部 interface。

## 13. 最终判断

可以借鉴 Agent Memory 的多层思想，但只能借鉴两点：减少在线上下文，以及每个上层摘要可回到下层事实。

不能照搬“底层事实、上层不断蒸馏，然后把最高层直接交给 Agent 判断”。对于 Planner：

- 用户历史需要 projection 和时间窗口；
- 领域知识需要审核后的可执行制品；
- 计划判断需要确定性适用性、依赖闭包和约束；
- 用户解释才需要 gist/keypoint/passage 渐进召回。

因此正确架构是 **分层记忆 + 知识编译 + 权限分离的多路召回**，而不是一个统一的向量记忆金字塔。
