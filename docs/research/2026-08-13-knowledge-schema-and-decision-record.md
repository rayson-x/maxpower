# MaxPower 可执行知识 Schema 与 DecisionRecord 调研和实施方案

日期：2026-08-13
状态：研究结论与实施设计；不包含功能代码修改
范围：本地优先的健身 Planner；云端只提供 LLM 调用，不承载知识判断或计划真相

## 0. 结论先行

MaxPower 不应该把文章、规则、Planner 参数和运行日志继续塞进同一个 `KnowledgePack` 大对象，也不应该把一次完整决策压缩成现有的 `BehaviorDecisionRecord`。

建议采用两个稳定契约：

1. **`KnowledgeRelease`**：一组经过审核、内容寻址、可整体激活和回放的知识制品。制品至少分为 `Claim / Policy / Rule / Method / Constraint / Objective / Action / Observation / Fixture`；原文和引用仍然保留，但不直接取得执行权限。
2. **`DecisionRecord`**：`decide()` 完成后产生的一份不可变、可重放的结构化决策收据；确认、拒绝、过期、提交和结果观察使用后续追加的 `DecisionLifecycleEvent`，不回写原记录。

在线链路应固定为：

```text
Fact Snapshot
  + pinned KnowledgeRelease
  -> deterministic retrieval
  -> tri-state evaluation
  -> candidate planning
  -> independent validation
  -> immutable DecisionRecord
  -> user confirmation bound to hashes/frontier
  -> append-only lifecycle event
  -> PlanRevision commit
```

几个关键裁决：

- **JSON Schema 只验证数据形状，不表达教练语义。** 规则语义必须由一个受限、版本化的表达式 AST 和命名计算器实现。
- **`unknown` 不是 `false`，`conflict` 也不是第四个布尔值。** `unknown` 是三值求值结果；`conflict` 是输入事实或规则效果之间无法解析的状态，必须单独上浮。
- **证据结论和产品政策必须分开。** “研究支持什么”不能和“产品选择什么默认值”共用一个 `tier` 或一段文案。
- **Plan、DecisionRecord、Trace 是三种不同数据。** Plan 是产品真相；DecisionRecord 是领域决策收据；Trace 是运行观测。三者只通过引用关联，不互相复制正文。
- **不保存 Chain of Thought。** 保存输入引用、规则结果、候选摘要、约束、分数、验证结果和原因码，已经足够重放、审计和生成解释。

---

## 1. 四象限一：共同已知

### 1.1 任务目标与交付标准

本次目标不是选择 Graph、规则引擎或数据库，而是定义一套能让 Planner：

- 快速、确定性地召回本次判断所需知识；
- 区分事实、证据、政策、规则、计划方法和行动权限；
- 对缺失、陈旧、冲突事实保持诚实；
- 生成可验证、需确认后才提交的未来计划差异；
- 精确说明当时用了哪个事实和哪个知识版本；
- 支持原版本回放和新知识差异回放；
- 不向远端日志泄露个人事实或对话正文。

交付物是 schema、生命周期、与现有代码的映射、迁移顺序和最小实验。当前不修改功能代码。

### 1.2 当前仓库的数据事实

当前实现已经有不少正确基础：

- `src/coach/domain.ts` 使用 append-only `DomainEvent` 和聚合修订，`Ledger / Timeline` 可以继续作为用户事实的唯一真相。
- `PlanRevisionData` 已经是版本化计划层级，包含计划周、训练日、肌群疲劳、有氧负荷、能量预算、滚动调整和知识版本钉；不需要迁移成知识图或 DecisionRecord。
- `KnowledgePackManifest` 已有 semantic version、content hash、发布时间、审核时间、兼容范围、来源和签名状态。
- `KnowledgeGist -> KnowledgeKeypoint -> KnowledgePassage -> EvidenceCitation` 已经适合作为解释层的渐进披露。
- `PlannerRequest / PlanProposal / PlannerTrace` 已有事实修订、知识钉、缺失项、冲突、计划差异、置信度和候选选择痕迹。
- `BehaviorDecisionRecord` 已明确禁止原始对话、prompt 和思维链，并通过 `TraceEnvelope` 进入本地/远程观测链路。

目前的断点是：

- `executableRulePacks` 只有 manifest 级描述，没有统一的规则正文、输入输出契约和 fixture；
- `programStrategies` 同时容纳解释材料、数值参数、局部规则、模板和产品默认值；
- Planner 直接读取整个 `programStrategies()`，知识定位、适用性判断和 Planner 组合没有稳定 seam；
- `EvidenceCitation.tier` 同时承担来源质量和产品可用性的暗示，虽已有 `claimStatus`，但还缺独立的 claim-level 映射；
- `PlannerTrace` 记录了 Planner 内部选择，却没有完整记录知识召回、规则求值、候选验证和确认/提交绑定；
- `BehaviorDecisionRecord` 是低基数观测记录，无法替代完整、可重放的领域 `DecisionRecord`。

### 1.3 明确边界

- 健身 Planner 不是医疗诊断系统；借鉴医疗 CDS 规范只为了复用“定义知识与个体行动分离、缺失信息、版本和来源”等结构。
- 本地 Ledger、Timeline 和 Plan 继续是产品数据真相。
- LLM 负责自然语言理解和表达，不拥有知识发布、规则编写、硬约束放宽或计划提交权限。
- 新 schema 第一阶段只覆盖一个纵向场景，不一次迁移整个知识库。

---

## 2. 一手先例：解决了什么，不能照搬什么

| 先例 | 真正解决的问题 | MaxPower 可借鉴 | 不能直接照搬 |
|---|---|---|---|
| JSON Schema 2020-12 | JSON 实例的结构验证、复用、方言和标准化验证输出 | `$id`、`$schema`、`$defs`、封闭叶子对象、构建期/运行时 validation report | 它不定义规则适用性、证据强度、冲突优先级或计划正确性；官方 validation spec 也明确区分 assertion 与 annotation。[Core](https://json-schema.org/draft/2020-12/json-schema-core.html) · [Validation](https://json-schema.org/draft/2020-12/json-schema-validation) |
| FHIR R5 PlanDefinition / ActivityDefinition / RequestOrchestration | 把可复用定义、具体活动模板和面向个体的行动请求分开 | `Method/Action` 是定义；应用到用户上下文后才产生 proposal；行动有输入、条件、时序和关联；proposal 与已执行事实分离 | FHIR 是医疗互操作资源，字段、术语和 workflow 状态远超健身 MVP，不应复制整套资源或扩展机制。[PlanDefinition](https://hl7.org/fhir/R5/plandefinition.html) · [ActivityDefinition](https://www.hl7.org/fhir/R5/activitydefinition.html) · [RequestOrchestration](https://hl7.org/fhir/R5/RequestOrchestration.html) |
| FHIR Library / Citation | 对可执行逻辑声明参数、数据需求、内容和相关证据；对引用做标准标识和关系 | 显式 `inputContract`、逻辑库/计算器版本、DOI/PMID/PMCID、source relation | `Citation` 是文献描述，不等于“这篇文献支持本产品这条结论”；仍需独立 Claim 映射。[Library](https://www.hl7.org/fhir/R5/library.html) · [Citation](https://www.hl7.org/fhir/R5/citation-definitions.html) |
| CQL / ELM | 将人可读逻辑转换为规范化、可执行逻辑模型，并完整处理缺失值 | 三值逻辑、typed null、命名参数、源码与可执行表示分离 | CQL 面向临床数据模型且表达能力较大；第一版不应嵌入 CQL，而应实现更小的 MaxPower AST。CQL 明确支持三值逻辑和 nullological operators。[Developer Guide](https://cql.hl7.org/03-developersguide.html) · [ELM](https://cql.hl7.org/elm.html) |
| OMG DMN 1.5 / FEEL | 把输入数据、业务知识、决策依赖和决策表分开，并声明 hit policy | 局部 Decision Table、显式依赖、`unique/priority/collect` 类冲突语义 | DMN XML/DI、完整 FEEL 和企业流程互操作对本地 MVP 过重；且规则表不能承担排期优化。[DMN 1.5](https://www.omg.org/spec/DMN/1.5/About-DMN) · [官方简介](https://www.omg.org/intro/DMN.pdf) |
| W3C PROV | 用 Entity、Activity、Agent 和派生/生成关系描述来源 | `derivedFrom`、`generatedBy`、`attributedTo`、审核/编译活动引用 | 不需要 RDF、OWL 或图数据库；在 JSON 中保存最小 PROV 子集即可。[PROV-O](https://www.w3.org/TR/prov-o/) |
| OPA bundles / decision logs | 发布和热加载一组版本化 policy/data；记录输入、bundle revision、路径和结果 | release manifest、精确 revision、激活失败不覆盖旧版本、决策 id、敏感字段遮蔽 | OPA 是策略授权引擎，不解决多目标计划、时序疲劳或科学证据；其原始 input decision log 对用户健康数据过于敏感。[Bundles](https://www.openpolicyagent.org/docs/management-bundles) · [Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs) |
| Cedar authorization diagnostics | 每条 permit/forbid policy 求值后返回最终决策、决定性 policy 和错误诊断 | 硬约束优先于普通允许；返回 deciding refs 和 evaluation errors | `allow/deny` 不是 Planner 的全部输出；`unknown`、多候选和目标排序不能被压成授权结果。[Authorization](https://docs.cedarpolicy.com/auth/authorization.html) |
| OpenTelemetry / W3C Trace Context | 跨模块传播 trace/span identity，记录 operation、links、events、status | `traceId/spanId`、父子阶段、异步 link、低基数 attributes | Trace 是观测载体，不是领域 DecisionRecord，也不保证能重放决定。OTel 明确把 Span 定义为 trace 中的一次 operation。[OTel Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/) · [W3C Trace Context](https://www.w3.org/TR/trace-context/) |
| CloudEvents | 为跨进程事件提供 `id/source/specversion/type/time/dataschema` 上下文 | 如果未来通过消息总线同步 decision lifecycle，可作为 transport envelope | 当前本地 Ledger 已有事件 envelope；不应为了 schema 再套一层。CloudEvents 也提醒敏感数据不要放在可被路由和记录的 context attributes。[CloudEvents](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md) |
| Unified Planning | 将 plan generation 和 plan validation 作为不同 operation mode，验证结果带 status、engine 和 metric evaluations | Validator 与 Planner 分开；保存验证器版本和 metric results | 通用规划框架不了解健身领域、证据或用户确认；它只提供职责分离先例。[Operation Modes](https://unified-planning.readthedocs.io/en/v1.2.0/operation_modes.html) |
| JITAI 原始框架 | 将长期目标、近端结果、决策点、行动选项、动态变量和决策规则拆开 | `Observation` 必须连接 proximal outcome、decision point 和下一次调整；不是计划发布后就结束 | JITAI 不自动证明某个阈值或干预有效；这些仍需领域证据和实验。原始框架明确列出六个要素。[Nahum-Shani et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/) |

跨这些先例的共同答案不是某个现成格式，而是四个分离：

```text
Definition ≠ Instance
Evidence ≠ Product Policy
Decision Receipt ≠ Runtime Trace
Plan Generation ≠ Plan Validation
```

---

## 3. 四象限二：用户已知、系统未知

现有上下文足以完成探索版本，不需要再次询问。以下假设若未来改变，会影响实现但不影响本版 schema 方向：

1. `KnowledgeRelease` 以本地 JSON 文件发布，运行时只读；第一阶段不要求云端知识控制面。
2. TypeScript 是运行时主要语言，但 JSON Schema 是跨工具的持久化契约；TS 类型由 schema 生成或在 CI 做双向一致性校验。
3. 当前 `Ledger / Timeline / PlanRevision` 继续作为事实和计划真相；DecisionRecord 不复制这些对象正文。
4. 第一版表达式只处理确定性逻辑和命名计算器，不执行 LLM、网络请求或任意 JavaScript。
5. 第一版知识审核角色可以只是本地稳定 actor id，不建设完整人员和组织系统。

后续最多需要产品明确三件事，但不阻塞设计：知识审核是单人还是双人；知识升级是否需要签名；DecisionRecord 的本地保留周期。

---

## 4. 四象限三：建议采用的知识数据模型

### 4.1 Schema 的物理形式

建议把 JSON Schema Draft 2020-12 作为持久化数据的规范来源：

```text
schemas/knowledge/v1/*.schema.json
schemas/decision/v1/*.schema.json
        ↓ build-time validation/codegen
TypeScript readonly types + runtime validators
        ↓ compile
KnowledgeRelease JSON + derived indexes
```

每个 schema 使用稳定 `$id`，共同类型放入 `$defs`；叶子制品默认 `unevaluatedProperties: false`，release manifest 可以保留受控 `extensions`。JSON Schema 只做结构检查，语义 lint 由单独 compiler 完成。官方规范将 validation assertions 和 annotations 分开，因此不能把“通过 JSON Schema”当作知识正确。[JSON Schema Validation](https://json-schema.org/draft/2020-12/json-schema-validation)

内容哈希建议定义为：

```text
sha256( RFC8785_canonical_json( artifact_without_contentHash_and_signature ) )
```

[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html) 的目的正是为哈希和签名提供不受属性顺序、空白影响的稳定 JSON 表示。当前 `fnv1a-32` 可继续服务普通缓存键，但不应作为知识制品的长期完整性身份。

### 4.2 共同标识和生命周期

```ts
type KnowledgeArtifactKind =
  | "claim"
  | "policy"
  | "rule"
  | "method"
  | "constraint"
  | "objective"
  | "action"
  | "observation"
  | "calculator"
  | "validator"
  | "fixture";

interface ArtifactRef {
  kind: KnowledgeArtifactKind;
  id: string;               // 跨版本稳定的逻辑身份
  version: string;          // 人类可读版本，不负责唯一性
  contentHash: string;      // sha256:...
}

type DecisionScope =
  | "initial_plan"
  | "daily_adjustment"
  | "pre_session"
  | "post_session"
  | "weekly_review"
  | "phase_review"
  | "realtime_cue"
  | "nutrition_adjustment";

interface ReleasePin {
  releaseId: string;
  semanticVersion: string;
  contentHash: string;
}

type KnowledgeReleasePin = ReleasePin;

type SourceOrArtifactRef =
  | { kind: "source"; sourceRef: string; version?: string; contentHash?: string }
  | ArtifactRef;

interface KnowledgeArtifactBase {
  schemaVersion: 1;
  kind: KnowledgeArtifactKind;
  id: string;
  version: string;
  contentHash: string;
  status: "draft" | "reviewed" | "shadow" | "active" | "deprecated" | "retired";
  title: { zh: string; en?: string };
  scope: readonly DecisionScope[];
  tags: readonly string[];
  effective: { from: string; until?: string };
  authoredAt: string;
  reviewedAt?: string;
  stewardRef: string;
  reviewerRefs: readonly string[];
  dependsOn: readonly ArtifactRef[];     // 求值必须存在
  derivedFrom: readonly SourceOrArtifactRef[]; // 来源关系，不代表运行依赖
  supersedes?: ArtifactRef;
  deprecation?: { reasonCode: string; replacement?: ArtifactRef };
}
```

三个关系不能合并：

- `dependsOn`：缺失就不能执行；
- `derivedFrom`：解释来源和编译链；
- `supersedes`：生命周期替代关系。

这相当于在普通 JSON 中使用 W3C PROV 的最小思想，而不是引入 RDF。[PROV-O](https://www.w3.org/TR/prov-o/)

规则所调用的计算器和 Validator 也必须是知识制品，否则语义仍会藏回未版本化代码：

```ts
interface ExecutableDefinition extends KnowledgeArtifactBase {
  kind: "calculator" | "validator";
  runtime: "builtin_typescript" | "builtin_rust" | "portable_wasm";
  entrypoint: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  deterministic: true;
  sideEffects: false;
  numericPolicyRef?: string;
}
```

第一阶段不允许运行时下载或执行 release 携带的任意代码；release 里的 ExecutableDefinition 只能 pin 已随客户端发布的实现。将来若采用 WASM，也要先增加独立的签名、资源和沙箱设计。

### 4.3 KnowledgeRelease

```ts
interface SourceRecord {
  id: string;
  sourceKind: "guideline" | "systematic_review" | "trial" | "observational" | "course" | "standard" | "product_analysis";
  title: string;
  identifiers: readonly { system: "doi" | "pmid" | "pmcid" | "isbn" | "uri"; value: string }[];
  canonicalUri?: string;
  publishedAt?: string;
  accessedAt: string;
  contentHash?: string;
  license?: string;
  currentState: "current" | "superseded" | "retracted" | "unknown";
}

interface KnowledgeRelease {
  schemaVersion: 1;
  releaseId: string;
  semanticVersion: string;
  contentHash: string;
  status: "built" | "shadow" | "active" | "deprecated" | "rejected";
  publishedAt: string;
  activatedAt?: string;
  schemaDialect: "https://json-schema.org/draft/2020-12/schema";
  compatibility: {
    minAppSchema: number;
    maxAppSchema: number;
    evaluatorContract: string;
    plannerContract: string;
  };
  artifacts: readonly ArtifactRef[];
  sources: readonly SourceRecord[];
  indexes: {
    buildVersion: string;
    contentHash: string;
    keys: readonly ("scope" | "trigger" | "goal" | "fact" | "entity" | "action")[];
  };
  fixtures: readonly ArtifactRef[];
  build: {
    compilerVersion: string;
    schemaValidation: "passed";
    semanticLint: "passed";
    fixtureSummaryHash: string;
  };
  previousRelease?: ReleasePin;
  signature?: { algorithm: string; keyId: string; value: string };
}
```

发布行为采用“构建完整 release → 校验 → shadow → 原子激活”，新 release 激活失败时继续使用旧 release。OPA bundles 对“政策和数据成组发布、用 revision 标记、验证失败不激活”提供了直接先例，但 MaxPower 不需要引入 OPA 本身。[OPA Bundles](https://www.openpolicyagent.org/docs/management-bundles)

### 4.4 EvidenceClaim 与 ProductPolicy 分离

```ts
interface ApplicabilityTerm {
  dimension: "population" | "goal" | "training_level" | "phase" | "setting" | "time_horizon";
  operator: "include" | "exclude";
  code: string;
  valueRange?: { min?: number; max?: number; unit?: string };
}

interface EvidenceClaim extends KnowledgeArtifactBase {
  kind: "claim";
  statement: { zh: string; en?: string };
  population: readonly ApplicabilityTerm[];
  context: readonly ApplicabilityTerm[];
  exposureOrIntervention?: readonly string[];
  supportedOutcomes: readonly {
    outcomeId: string;
    direction: "increase" | "decrease" | "no_material_difference" | "mixed" | "uncertain";
    horizon?: string;
  }[];
  cannotSupport: readonly string[];
  sourceMappings: readonly {
    sourceRef: string;
    relation: "supports" | "opposes" | "mixed" | "context_only";
    assessmentScheme: string;
    assessment: string;
    notesRef?: string;
  }[];
}

interface ProductPolicy extends KnowledgeArtifactBase {
  kind: "policy";
  policyClass: "safety" | "product_boundary" | "default" | "confirmation" | "privacy";
  statement: { zh: string; en?: string };
  rationaleCodes: readonly string[];
  evidenceContextRefs: readonly ArtifactRef[];
  userOverride: "forbidden" | "allowed_with_confirmation" | "allowed";
  ownerRef: string;
}
```

这样可以明确：

- Claim 回答“来源支持什么、对谁适用、不能推出什么”；
- Policy 回答“MaxPower 在证据和产品边界下选择怎么做”；
- Rule 可以同时引用 Claim 和 Policy，但解释时必须标出各自角色；
- 证据质量评级必须声明自己的 `assessmentScheme`，不能假设一个全局 A/B/C 能跨指南、系统综述、RCT 和产品规则比较。

FHIR Citation 能描述 DOI、PMID、PMCID、网页和分类，但它本身不完成“来源 → 产品结论”的映射，所以 MaxPower 仍需独立 Claim。[FHIR Citation](https://www.hl7.org/fhir/R5/citation-definitions.html)

### 4.5 输入事实契约与三值表达式

```ts
type FactAvailability = "known" | "estimated" | "unknown" | "stale" | "conflict";
type TriState = "true" | "false" | "unknown";

type ValueExpr =
  | { kind: "fact"; key: string }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "calculator_output"; evaluatorRef: ArtifactRef; outputPath: string };

interface FactRequirement {
  key: string;
  valueSchemaRef: string;
  acceptedAvailability: readonly FactAvailability[];
  freshness?: { maxAge: string; asOf: "decision_time" | "session_time" };
  cardinality: "one" | "optional" | "many";
  purposeCode: string;
}

type TriExpression =
  | { op: "all" | "any"; args: readonly TriExpression[] }
  | { op: "not"; arg: TriExpression }
  | { op: "exists"; fact: string }
  | { op: "availability_is"; fact: string; state: FactAvailability }
  | { op: "compare"; comparator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in"; left: ValueExpr; right: ValueExpr }
  | { op: "call"; evaluatorRef: ArtifactRef; args: readonly ValueExpr[] };

type DecisionEffect =
  | { kind: "add_constraint"; ref: ArtifactRef }
  | { kind: "add_objective"; ref: ArtifactRef }
  | { kind: "allow_action"; ref: ArtifactRef }
  | { kind: "require_observation"; ref: ArtifactRef }
  | { kind: "request_fact"; factKey: string }
  | { kind: "block"; reasonCode: string };
```

第一版表达式是数据 AST，不允许内联 JavaScript、prompt 或网络调用。所有 `call` 都必须指向发布 release 内的命名计算器，并声明输入输出类型和 content hash。

CQL/ELM 的价值在于提醒系统：缺失信息必须具有正式语义，`null` 可以穿过逻辑计算并通过 `IsNull/IsTrue/IsFalse/Coalesce` 显式处理。[CQL Logical Specification](https://cql.hl7.org/04-logicalspecification.html) MaxPower 不必复制 CQL，但应复制“unknown 不能静默变 false”的纪律。

需要明确区分：

```text
Fact conflict  -> 同一事实存在互斥候选，尚未解析
Tri unknown    -> 表达式无法在当前事实下判真或判假
Rule error     -> schema、类型、计算器或实现错误
Effect conflict-> 多条已匹配规则产生不可兼容效果
```

`conflict` 不是第四个布尔值。它必须进入 `DecisionOutcome.conflict` 或触发已声明的保守策略；`error` 必须失败并记录，不能伪装成 unknown。

### 4.6 DecisionRule

```ts
interface DecisionRule extends KnowledgeArtifactBase {
  kind: "rule";
  triggers: readonly PlannerTrigger[];
  inputContract: {
    required: readonly FactRequirement[];
    optional: readonly FactRequirement[];
  };
  logic: {
    language: "maxpower.expression-ast";
    languageVersion: 1;
    applicability: TriExpression;
  };
  unless?: TriExpression;
  priorityClass:
    | "hard_boundary"
    | "feasibility"
    | "protective_guardrail"
    | "objective"
    | "preference"
    | "advisory";
  precedence: number; // 只在同 priorityClass/conflictGroup 内比较
  conflictGroup?: string;
  onUnknown: "block" | "request_information" | "keep_current_plan" | "conservative_default";
  onConflict: "block" | "request_resolution" | "conservative_default";
  effects: readonly DecisionEffect[];
  basisRefs: readonly ArtifactRef[]; // Claim 和 Policy
  explanationTemplateRef: string;
}
```

规则集合可以声明 DMN 风格的 hit policy：

```ts
type HitPolicy = "unique" | "any_same_effect" | "priority" | "collect";
```

但不能用一个全局数字权重覆盖不同层级。求值顺序应是：

1. `hard_boundary` 直接裁剪；
2. `feasibility` 决定是否存在计划；
3. `protective_guardrail` 限制动作和剂量；
4. `objective` 进入候选排序；
5. `preference/advisory` 只能在可行候选中影响排序或解释。

Cedar 的 forbid-overrides 和 deciding-policy diagnostics 适合借鉴硬边界与诊断，但其简单 `Allow/Deny` 不能替代此分层结果。[Cedar Authorization](https://docs.cedarpolicy.com/auth/authorization.html)

### 4.7 PlanMethod

```ts
interface PlanMethod extends KnowledgeArtifactBase {
  kind: "method";
  goalKinds: readonly string[];
  inputContract: readonly FactRequirement[];
  applicabilityRuleRefs: readonly ArtifactRef[];
  decomposes: { from: string; to: readonly string[] };
  steps: readonly {
    id: string;
    operation: "derive" | "expand" | "schedule" | "select" | "dose" | "observe";
    requires: readonly string[];
    produces: readonly string[];
  }[];
  constraintRefs: readonly ArtifactRef[];
  objectiveRefs: readonly ArtifactRef[];
  actionRefs: readonly ArtifactRef[];
  observationRefs: readonly ArtifactRef[];
}
```

Method 定义搜索空间和专业分解顺序，例如 `GoalCycle -> Mesocycle -> Week -> Session -> StimulusSlot`。它不声称某个具体分化对所有用户最好，也不直接提交计划。FHIR 同样将 PlanDefinition 视为纯定义，应用到个体上下文后才形成具体 request orchestration。[FHIR PlanDefinition](https://hl7.org/fhir/R5/plandefinition.html)

### 4.8 Constraint 与 Objective

```ts
interface ConstraintDefinition extends KnowledgeArtifactBase {
  kind: "constraint";
  class: "hard" | "guardrail" | "soft";
  appliesTo: "candidate" | "session" | "day" | "week" | "cycle" | "plan_diff";
  predicate: TriExpression;
  violationCode: string;
  unknownHandling: "violation" | "needs_information" | "not_evaluable";
  relaxation?: {
    allowed: boolean;
    requiresConfirmation: boolean;
    actionRefs: readonly ArtifactRef[];
  };
  basisRefs: readonly ArtifactRef[];
}

interface ObjectiveDefinition extends KnowledgeArtifactBase {
  kind: "objective";
  metricId: string;
  direction: "maximize" | "minimize" | "target_range";
  tier: number; // lexicographic tier，低 tier 先满足
  normalizationRef: ArtifactRef;
  defaultWeight?: number;
  weightSource: "goal_contract" | "mandate" | "product_policy";
  missingHandling: "exclude_candidate" | "neutral" | "requires_choice";
  basisRefs: readonly ArtifactRef[];
}
```

硬约束、目标分数和用户偏好必须分开。Planner 可以优化 objective，但 Validator 再独立验证 constraint。Unified Planning 将 planning 与 validation 分为不同 operation mode，并让 validation result 返回状态、引擎和 metrics，这正是应复制的职责分离。[Unified Planning](https://unified-planning.readthedocs.io/en/v1.2.0/operation_modes.html)

### 4.9 ActionDefinition

```ts
interface ActionDefinition extends KnowledgeArtifactBase {
  kind: "action";
  actionKind: string;
  appliesTo: "plan" | "future_week" | "session" | "exercise" | "nutrition_target" | "observation";
  parameterSchemaRef: string;
  preconditions: readonly ArtifactRef[];
  permittedScopes: readonly ("this_session_only" | "future_plan" | "future_preference" | "lock")[];
  authority: "auto_reversible" | "notify_with_undo" | "confirmation_required" | "professional_only";
  mutationLimits: readonly {
    fieldPath: string;
    operation: "add" | "replace" | "remove" | "move";
    boundRef?: ArtifactRef;
  }[];
  predictedEffects: readonly {
    metricId: string;
    calculatorRef: ArtifactRef;
    uncertaintyRequired: boolean;
  }[];
  observationRefs: readonly ArtifactRef[];
  validatorRefs: readonly ArtifactRef[];
}
```

Action 是 Planner 的封闭行动世界。ActionDefinition 只是模板，具体参数化行动仍是 proposal；FHIR ActivityDefinition 的 `$apply` 也区分定义与面向具体上下文的活动实例。[FHIR ActivityDefinition](https://www.hl7.org/fhir/R5/activitydefinition.html)

### 4.10 ObservationDefinition

```ts
interface ObservationDefinition extends KnowledgeArtifactBase {
  kind: "observation";
  proximalOutcomeId: string;
  decisionPoint: {
    trigger: "after_session" | "daily" | "weekly" | "phase_review" | "event_driven";
    earliestAfter?: string;
    latestAfter?: string;
  };
  measures: readonly {
    factKey: string;
    sourcePolicyRef: ArtifactRef;
    aggregationRef?: ArtifactRef;
    comparisonWindow?: string;
  }[];
  comparabilityRequirements: readonly ArtifactRef[];
  evaluatorRef: ArtifactRef;
  outcomes: {
    success: string;
    failure: string;
    insufficientEvidence: string;
  };
  nextRuleRefs: readonly ArtifactRef[];
}
```

每个调整策略都必须说明“之后何时看什么、什么结果才允许继续判断”。JITAI 将 distal outcome、proximal outcome、decision point、intervention option、tailoring variable 和 decision rule 分开，能防止 Planner 只输出动作却没有学习闭环。[JITAI](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/)

### 4.11 ScenarioFixture

```ts
interface ScenarioFixture extends KnowledgeArtifactBase {
  kind: "fixture";
  scenario: string;
  syntheticFacts: readonly SyntheticFact[];
  request: DecisionRequestFixture;
  expected: {
    retrievalMustInclude: readonly ArtifactRef[];
    ruleResults: readonly { ruleRef: ArtifactRef; result: "matched" | "not_matched" | "unknown" }[];
    disposition: DecisionDisposition;
    allowedActionRefs: readonly ArtifactRef[];
    forbiddenActionRefs: readonly ArtifactRef[];
    requiredReasonCodes: readonly string[];
  };
  invariants: readonly string[];
  containsPersonalData: false;
}
```

其中 fixture 支撑类型保持最小且完全合成：

```ts
interface SyntheticFact {
  key: string;
  availability: FactAvailability;
  value?: unknown;
  observedAt?: string;
  source: "synthetic_fixture";
}

interface DecisionRequestFixture {
  trigger: string;
  scope: DecisionScope;
  asOf: string;
}

type DecisionDisposition =
  | "ready"
  | "no_action"
  | "no_change"
  | "requires_information"
  | "requires_choice"
  | "conflict"
  | "infeasible"
  | "unsupported"
  | "failed";
```

每个 Rule、Method、Action 至少关联：命中、不命中、unknown、conflict、边界值和旧/新 release 差异 fixture。Fixture 随 release 发布，不依赖 LLM 文案。

---

## 5. DecisionRecord：领域收据，不是 Trace

### 5.1 三层记录必须分开

| 数据 | 作用 | 保存内容 | 不保存内容 |
|---|---|---|---|
| `DecisionRecord` | 精确审计、回放、解释和知识升级 diff | 事实引用、知识版本、规则结果、候选摘要、验证和 proposal hash | CoT、完整 prompt、原始聊天、重复的 Plan/Fact 正文 |
| `BehaviorDecisionRecord` | 低基数产品行为观测 | boundary、outcome、reason code、pseudonym、duration、version pins | 完整候选和规则输入 |
| `TraceEnvelope` | 串联一次运行的阶段和耗时 | trace/span identity、parent/link、status、短 attributes | 领域语义和可执行计划 |

OpenTelemetry 明确把 span 定位为一次 operation 及其时间、属性、事件和状态；它不是业务决策模型。[OTel Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/) 因此现有 `BehaviorDecisionRecord -> TraceEnvelope` 应保留，但新 `DecisionRecord` 不能只是给它加更多 metadata。

### 5.2 建议 Schema

```ts
interface DecisionRecord {
  schemaVersion: 1;
  decisionId: string;
  recordHash: string;
  trace: { traceId: string; rootSpanId?: string; sessionId: string };
  subjectRef: string; // 本地 opaque ref，不是姓名、邮箱或原话
  actor: { kind: "agent" | "timer" | "timeline" | "realtime" | "system"; id: string };
  startedAt: string;
  completedAt: string;
  trigger: { kind: PlannerTrigger | string; causationRefs: readonly string[] };
  scope: DecisionScope;

  contracts: {
    decisionModule: string;
    factProjection: string;
    evaluator: string;
    planner: string;
    validator: string;
  };

  facts: {
    snapshotId: string;
    asOf: string;
    frontierHash: string;
    aggregateFrontier: readonly DomainAggregateRef[];
    timelineHighWatermark?: string;
    usedFactRefs: readonly string[];
    availabilitySummary: Readonly<Record<FactAvailability, number>>;
    omittedSensitiveValues: true;
  };

  deliveryContext?: {
    availability: { status: "available" | "unavailable" | "unknown"; reasonCodes: readonly string[] };
    receptivity: { status: "receptive" | "not_receptive" | "unknown"; reasonCodes: readonly string[] };
  };

  knowledge: {
    release: ReleasePin;
    artifactPins: readonly ArtifactRef[];
    indexPin: { buildVersion: string; contentHash: string };
  };

  retrieval: {
    structuredQueryHash: string;
    scopeKeys: readonly string[];
    mandatoryRefs: readonly ArtifactRef[];
    candidateRefs: readonly ArtifactRef[];
    excluded: readonly { ref: ArtifactRef; reasonCode: string }[];
    completeness: "complete_for_scope" | "model_invalid";
  };

  evaluations: readonly RuleEvaluationRecord[];
  conflicts: readonly ConflictRecord[];
  missingFacts: readonly MissingFactRecord[];

  planning: {
    status:
      | "solved_feasible"
      | "solved_optimal"
      | "infeasible_proven"
      | "unsolved_incomplete"
      | "timeout"
      | "resource_exhausted"
      | "unsupported"
      | "error"
      | "not_run";
    enginePin?: string;
    methodRefs: readonly ArtifactRef[];
    candidateCount: number;
    candidates: readonly CandidateDecisionRecord[];
    selectedCandidateId?: string;
  };

  validation: {
    validatorPins: readonly ArtifactRef[];
    status: "valid" | "invalid" | "unknown" | "error" | "not_run";
    schemaChecks: readonly {
      valid: boolean;
      schemaRef: string;
      instanceRef: string;
      errors: readonly {
        keywordLocation: string;
        absoluteKeywordLocation?: string;
        instanceLocation: string;
        error: string;
      }[];
    }[];
    checks: readonly {
      checkRef: ArtifactRef;
      status: "passed" | "failed" | "unknown" | "error";
      reasonCodes: readonly string[];
      metricValues?: Readonly<Record<string, number>>;
    }[];
  };

  disposition:
    | "ready"
    | "no_action"
    | "no_change"
    | "requires_information"
    | "requires_choice"
    | "conflict"
    | "infeasible"
    | "unsupported"
    | "failed";
  reasonCodes: readonly string[];

  proposal?: {
    proposalRef: string;
    proposalHash: string;
    basePlanRef: DomainAggregateRef<"plan">;
    factFrontierHash: string;
    knowledgeReleaseHash: string;
    requiresConfirmation: boolean;
    expiresAt?: string;
  };

  explanationRefs: readonly string[];
  replayability: {
    exact: "available" | "unavailable_missing_fact" | "unavailable_missing_release" | "unavailable_external_model";
    latestKnowledge: "available" | "unavailable";
  };
  privacy: {
    containsRawConversation: false;
    containsChainOfThought: false;
    remoteExportClass: "metadata_only" | "local_only";
  };
}
```

`recordHash` 使用和知识制品相同的 canonical JSON + SHA-256 规则，但计算时排除 `recordHash` 本身。`decisionId` 表示一次现实决策的身份，不由内容哈希替代：两个时间不同但输入相同的决策可以内容等价，却仍然是两个 decision point。

`no_action` 和 `no_change` 都是一等结论：前者表示在某个实时决策点有意识地不提供干预，后者表示评估后保持当前计划。两者都必须有 determining rule/policy refs，不能通过“没有输出”来暗示。JITAI 将 intervention options 视为每个 decision point 的显式候选，并讨论在不合适时不提供支持的必要性。[JITAI](https://pmc.ncbi.nlm.nih.gov/articles/PMC5364076/)

`infeasible_proven` 与 `unsolved_incomplete` 也不能合并：前者表示约束系统已经证明无可行解；后者只表示当前算法、时间或信息条件下没有找到，因此不能向用户声称“计划不可行”。Unified Planning 的结果类型同样区分 `UNSOLVABLE_PROVEN`、`UNSOLVABLE_INCOMPLETELY`、timeout、资源耗尽、unsupported 和 internal error。[Unified Planning results](https://unified-planning.readthedocs.io/en/latest/_modules/unified_planning/engines/results.html)

`schemaChecks` 借鉴 JSON Schema 的标准输出位置字段，使错误可以精确落到 schema keyword 和 instance location，而不是只返回一个无上下文的 `invalid`。[JSON Schema output schema](https://json-schema.org/draft/2020-12/output/schema)

关键子记录：

```ts
interface RuleEvaluationRecord {
  ruleRef: ArtifactRef;
  result: "matched" | "not_matched" | "unknown" | "error";
  inputFactRefs: readonly string[];
  missingFactKeys: readonly string[];
  staleFactKeys: readonly string[];
  conflictRefs: readonly string[];
  emittedEffectRefs: readonly string[];
  reasonCodes: readonly string[];
  durationMs?: number;
}

interface ConflictRecord {
  conflictId: string;
  kind: "fact" | "effect" | "knowledge_version" | "user_value";
  refs: readonly string[];
  resolution: "unresolved" | "conservative_default" | "requires_information" | "requires_choice";
  reasonCodes: readonly string[];
}

interface MissingFactRecord {
  factKey: string;
  requiredByRefs: readonly ArtifactRef[];
  reason: "not_observed" | "stale" | "conflict" | "permission_denied" | "source_unavailable";
  impact: "blocking" | "changes_ranking" | "explanation_only";
}

interface CandidateDecisionRecord {
  candidateId: string;
  artifactRef?: string; // 完整候选另存，不复制进 record
  contentHash: string;
  actionInstanceRefs: readonly string[];
  hardConstraintStatus: "passed" | "failed" | "unknown";
  objectiveVector: readonly { objectiveRef: ArtifactRef; normalizedValue: number; weight: number; sourceRef: string }[];
  rejectedBy: readonly { constraintRef: ArtifactRef; reasonCode: string }[];
}
```

这里不保存表达式逐步展开、模型 token 或自然语言“思考过程”。规则结果、输入引用、缺失项、效果、候选向量和验证检查已经是足够的可审计解释。

### 5.3 Fact frontier

`factFrontier` 不能只是若干字符串。确认时至少需要绑定：

```text
aggregate kind + id + revision
Timeline high-watermark / relevant event set digest
asOf timestamp
projection version
used fact refs
frontierHash
```

`usedFactRefs` 回答“真正读了什么”，`aggregateFrontier` 回答“当时看到哪个版本”，`frontierHash` 用于 compare-and-swap。任何与 proposal 相关的事实、GoalContract、Mandate 或 base Plan 发生变化，旧确认都必须返回 `stale`，重新 `decide()`。

### 5.4 确认、提交和结果不回写 DecisionRecord

```ts
type DecisionLifecycleEvent =
  | { type: "decision.confirmed"; decisionId: string; proposalHash: string; frontierHash: string; actorRef: string; occurredAt: string }
  | { type: "decision.rejected"; decisionId: string; reasonCode?: string; actorRef: string; occurredAt: string }
  | { type: "decision.stale"; decisionId: string; changedRefs: readonly string[]; occurredAt: string }
  | { type: "decision.commit_succeeded"; decisionId: string; planRef: DomainAggregateRef<"plan">; domainEventRefs: readonly string[]; occurredAt: string }
  | { type: "decision.commit_failed"; decisionId: string; reasonCode: string; occurredAt: string }
  | { type: "decision.outcome_observed"; decisionId: string; observationRef: ArtifactRef; factRefs: readonly string[]; outcome: "success" | "failure" | "insufficient_evidence"; occurredAt: string }
  | { type: "decision.superseded"; decisionId: string; byDecisionId: string; occurredAt: string };

interface DecisionView {
  record: DecisionRecord;
  events: readonly DecisionLifecycleEvent[];
  lifecycle: "proposed" | "confirmed" | "rejected" | "stale" | "committed" | "superseded";
  committedPlanRef?: DomainAggregateRef<"plan">;
  latestObservedOutcome?: "success" | "failure" | "insufficient_evidence";
}
```

这种设计避免了“用户确认后修改原记录导致 record hash 改变”。完整生命周期由 `DecisionRecord + ordered lifecycle events` 投影得到。Plan commit 本身仍进入现有 DomainEvent/PlanRevision 链，不迁移成 Decision event。

FHIR RequestOrchestration 的 `intent` 明确区分 proposal、plan、directive/order 等权限状态，说明“结构相似”并不代表“已经获得执行授权”。[RequestOrchestration definitions](https://www.hl7.org/fhir/R5/requestorchestration-definitions.html) MaxPower 对应地必须区分 proposal、confirmation 和 committed PlanRevision。

### 5.5 人工覆盖

人工覆盖必须是受控事件，而不是在 trace 里写一句原因：

```ts
interface DecisionOverrideEvent {
  type: "decision.override_requested" | "decision.override_applied" | "decision.override_denied";
  decisionId: string;
  targetRef: ArtifactRef | string;
  actorRef: string;
  authorityRef: string;
  reasonCode: string;
  noteRef?: string; // 本地单独加密保存；不进入远端 trace
  occurredAt: string;
}
```

硬安全政策的 `userOverride: forbidden` 不能被普通确认覆盖；仅偏好或已声明可放宽 guardrail 可以按 schema 产生 override。

### 5.6 隐私与观测映射

OPA 官方 decision log 文档明确提醒 policy input 可能含敏感数据，并提供 masking/drop 机制。[OPA Decision Logs](https://www.openpolicyagent.org/docs/management-decision-logs) MaxPower 应采取更小的数据面：

- 完整 DecisionRecord 默认本地保存；
- 远端 Trace 只发送 pseudonym、decision id、boundary、outcome、reason codes、版本钉、数量、duration 和 hash；
- 不发送 raw facts、体重/病史值、对话、prompt、候选完整计划；
- explanation 是从结构化记录和 evidence refs 生成的可丢弃 artifact，不是权威输入；
- 数据删除后允许 `exact replay = unavailable_missing_fact`，不能为了可回放无限保留敏感值。

CloudEvents 同样提醒 context attributes 可能被中间系统检查和记录，不应携带敏感信息。[CloudEvents Privacy](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md#privacy-and-security)

---

## 6. 与当前代码的落点

### 6.1 保留

- `src/coach/domain.ts` 的 DomainEvent、aggregate revision、Timeline projection；
- `PlanRevisionData` 和计划层级；
- `KnowledgeGist/Keypoint/Passage/Citation` 解释链；
- `KnowledgeVersionPins` 的 pin 思想；
- `PlannerDecision` 的 `proposal / no_change / infeasible` 基础 union；
- `BehaviorDecisionRecord` 和 `TraceEnvelope` 的隐私纪律与低基数 telemetry。

### 6.2 扩展或替换

1. `KnowledgePackManifest` 演进为 `KnowledgeRelease`，pin 使用 SHA-256 canonical content hash。
2. `RulePackArtifact` 从 manifest 变成真正包含 Rule/Method/Constraint/Objective/Action/Observation refs 的发布制品。
3. `ProgramStrategies` 通过兼容 Adapter 逐步拆出：
   - `splitRotations` → Method/Action templates；
   - `fastedTrainingRules` / `nutritionGuardrails` → Rule + Constraint + Policy；
   - `weeklyDirectSetTargets` / `setCostModel` → versioned Calculator/Policy；
   - `citations/passages/gists/keypoints` → Evidence/Explanation library，保持无执行权限。
4. `GoalCyclePlanner` 不再接收整个 `KnowledgePackRegistry`，改为消费已求值的 `DecisionBundle`。
5. 新增领域 `DecisionJournal` seam；`BehaviorDecisionRecord` 由 journal/decision pipeline 派生观测事件。

### 6.3 推荐深模块 seam

对主 Agent 维持小接口：

```ts
interface PlanningDecisionModule {
  decide(request: DecisionRequest): Promise<DecisionOutcome>;
  confirm(request: DecisionConfirmation): Promise<CommitOutcome>;
  readDecision(decisionId: string): Promise<DecisionView>;
}
```

内部有两个真正会变化的 Adapter 时才建 seam：

```ts
interface KnowledgeReleaseStore {
  active(): KnowledgeReleasePin;
  resolve(ref: ArtifactRef): KnowledgeArtifact;
  resolveDecisionContext(context: DecisionContext): DecisionBundle;
}

interface DecisionJournal {
  appendRecord(record: DecisionRecord): Promise<void>;
  appendEvent(event: DecisionLifecycleEvent): Promise<void>;
  read(decisionId: string): Promise<DecisionView>;
}
```

第一阶段可以只有 local JSON release Adapter 和 Ledger-backed journal Adapter。不要为尚不存在的云端实现提前设计一套远程 seam。

### 6.4 存储位置建议

`DecisionRecord` 属于运行决策账本，不属于用户 DomainEvent，也不属于远程 Trace。建议在 `LedgerSnapshot` 增加独立集合：

```ts
decisionRecords: readonly DecisionRecord[];
decisionLifecycleEvents: readonly DecisionLifecycleEvent[];
```

与它相关的 plan proposal、plan revision、facts 和 explanation 只保存 ref。未来如果 SQLite 化，可以独立成 append-only tables，但 interface 不变。

---

## 7. 分阶段实施方案

### Phase 0：契约冻结和词汇统一

产物：

- 为上述知识制品和决策记录创建 JSON Schema 2020-12；
- 定义 id、version、contentHash、effective/status 的统一语义；
- 定义 FactAvailability、TriState、RuleEvaluationResult、DecisionDisposition 的闭集；
- 定义 reason-code registry；
- 明确 EvidenceClaim 与 ProductPolicy 的 UI 标签和审核责任。

门禁：schema fixtures 全通过；TypeScript 类型与 JSON Schema 不漂移；当前 `KnowledgePack` 不受影响。

### Phase 1：Knowledge compiler，不改 Planner

产物：

- 把现有知识编译为 `KnowledgeRelease`；
- 构建确定性索引和 dependency closure；
- lint missing refs、cycle、未审核执行知识、过期制品、无 fixture 的 Rule/Action；
- 生成 SHA-256 content hashes 和 release manifest；
- 继续由旧 `KnowledgePackRegistry` 提供运行功能。

门禁：同输入构建 byte-equivalent release；任何制品缺依赖或 hash 不一致时不激活。

### Phase 2：DecisionRecord 与 DecisionJournal

产物：

- 新增不可变 DecisionRecord 和 lifecycle events；
- 将当前 PlannerTrace、BehaviorDecisionRecord 和 PlanProposal refs 映射到新 record；
- 实现 exact/latest-knowledge replay 的读取合同；
- 远端 telemetry 保持 metadata-only。

门禁：每个 proposal 都有 DecisionRecord；record hash 稳定；确认后原 record 不改变；旧 frontier 无法提交。

### Phase 3：一个纵向知识切片进入 shadow

首选场景：**力量与有氧并发安排**。原因是它同时覆盖 Claim、Policy、Rule、Method、Constraint、Objective、Action、Observation，但不会立即碰到整个动作库和所有分化策略。

管线：

```text
current planner output
       vs
new release -> retrieval -> evaluation -> candidate -> validator
```

新管线只写 DecisionRecord，不改变用户计划。

### Phase 4：Planner 消费 DecisionBundle

- 将纵向切片从 shadow 切到 proposal-only；
- Planner 只消费 resolved constraints/objectives/actions；
- Validator 使用独立 knowledge pins；
- 用户确认绑定 proposal hash、base plan revision、fact frontier 和 release hash；
- 通过后才写 PlanRevision。

### Phase 5：逐主题迁移

建议顺序：

1. 并发有氧；
2. 睡眠/恢复与课前调整；
3. 分化和训练量；
4. 肌群联动与连续排期；
5. 热量和滚动补偿；
6. 平台期；
7. 增肌、重组和体型目标；
8. 特殊人群和安全边界。

每次迁移一个决策 scope，不按文章目录批量迁移。

---

## 8. 四象限四：共同未知与最小实验

### 8.1 当前无法只靠设计确定的问题

1. 受限 AST 是否足以表达 80% 的教练规则，还是过早需要完整 DMN/FEEL。
2. DecisionRecord 记录全部被排除 rule refs 是否会太大；只记 counts/reason 是否又不足以审计。
3. exact replay 在本地数据删除、知识 release 清理和 LLM 参与事实提取时能达到什么等级。
4. objective weight 是否能稳定来自 GoalContract，还是大量场景最终需要用户选择。
5. `estimated/stale/conflict` 的真实发生率及其对提问频率的影响。

这些不是靠争论决定，应转为可测假设。

### 8.2 最小实验

**唯一改变变量：** 将“力量与有氧并发安排”的领域知识从现有代码/策略读取，替换为新 schema + resolver + DecisionRecord；事实、Planner 算法、UI 和 LLM provider 保持不变。

样本：

- 至少 30 个合成 fixture：训练目标、训练水平、训练日/休息日、有氧类型、时长、恢复状态、低血糖相关事实、known/unknown/stale/conflict 组合；
- 10 个历史匿名回放场景；
- 每个案例同时运行旧/新管线。

成功信号：

- 所有安全/硬约束 fixture 零违反；
- 同 facts + same release 产生相同结构化结果和 record hash；
- 每个 plan diff 都能回溯到 fact → rule/calculator → constraint/objective → action → validation；
- unknown 不会被记录为 false，conflict 不会被静默挑选；
- proposal 在 frontier 或 release 改变后不能提交；
- 解释能从 DecisionRecord 的 Claim/Policy refs 生成，并正确区分“证据结论”和“产品选择”；
- 远端 trace 不包含 raw facts、对话或计划正文；
- 领域审核者可以只看结构化 record 复核为何选择/拒绝候选，无需请求模型思维链。

失败信号：

- 新规则仍频繁依赖自由文本或 LLM 才能求值；
- 新增一个规则必须同时修改 Planner、Agent prompt 和多处调用方；
- fixture 为了通过不断添加用户类型特判；
- record 大到不得不保存整份 facts/plan，形成第二事实源；
- 规则优先级退化成一个全局分数；
- 相同 release 不能确定性回放；
- shadow 中大量差异无法归因到明确知识或旧实现缺陷。

### 8.3 实验期间要收的数据

- 每个 scope 的候选知识数量、强制规则数量、求值规则数量；
- matched/not_matched/unknown/error 比例；
- fact unknown/stale/conflict 频率和导致的提问数；
- unresolved effect conflicts；
- candidate 数量、硬约束淘汰比例、objective tie 比例；
- validator fail 原因；
- record 大小和阶段耗时；
- 新旧结果差异及其归因；
- 人工复核一致率；
- confirmation stale 率；
- 无知识引用的 plan diff 数量（目标必须为 0）。

---

## 9. 主要风险与防线

### 9.1 Schema 很完整，但语义仍藏在代码

防线：所有 calculator/evaluator 都有 ArtifactRef、输入输出 schema、hash 和 fixture；禁止出现未钉版本的函数名。

### 9.2 把文献引用数量误当证据强度

防线：Source、Claim mapping、assessment scheme 分开；同一 source 可以支持、反对、混合或只提供背景。

### 9.3 把产品默认包装成科学结论

防线：ProductPolicy 独立 kind；解释层强制标签；Rule 的 `basisRefs` 分角色渲染。

### 9.4 Rule explosion

防线：规则只做局部适用性和 effects；多变量组合交给 Method、Constraint 和 Objective，不复制成巨大树。

### 9.5 Hash 可重放但行为不可重放

防线：除了 knowledge hash，还 pin evaluator、planner、validator、projection、index 和 calculator contract；明确 `replayability`，不做虚假的 exact 声称。

### 9.6 DecisionRecord 变成隐蔽的 CoT 日志

防线：所有文本字段要么是 reason code，要么是 artifact ref；不提供 `reasoningText`、`prompt`、`rawInput`、`thoughts` 字段；自由说明单独存本地 note artifact，且无执行权限。

### 9.7 为可观测性泄露健康数据

防线：完整 record local-only；远端只投影低基数 metadata；敏感值不放 trace attributes。OpenTelemetry 也建议 span name 使用一般 operation 名称而不是带用户身份的高基数字符串。[OTel Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/)

---

## 10. 最终建议

下一步不是先选规则引擎，也不是把全部知识转成图，而是先完成三个可验收工件：

1. `knowledge-artifacts.schema.json`：覆盖 Claim/Policy/Rule/Method/Constraint/Objective/Action/Observation/Fixture；
2. `decision-record.schema.json` 与 `decision-lifecycle-event.schema.json`；
3. “力量与有氧并发安排”的完整 release fixture 和 shadow replay。

如果这条纵向切片不能做到确定召回、三值判断、候选验证、事实/知识版本绑定和无 CoT 审计，那么增加更多知识只会放大现有不稳定性。如果它能通过，后续知识建设就会从“往 prompt 和 Planner 代码里堆规则”转为“发布一个带 schema、来源、fixture 和观察闭环的新知识制品”。
