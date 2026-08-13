# 本地动作轨迹规则引擎与数据契约 v0.1

日期：2026-08-13
状态：实施前设计草案
适用链路：`YOLOX + RTMPose Halpe-26 -> Rust Motion SDK -> Web / Android / iOS -> Realtime Agent`

## 1. 结论

MaxPower 应把动作理解实现为一个由 Rust 拥有的本地深模块：

> 视觉模型提供可追溯的观测，Rust 从单次因果轨迹中封存运动学事实，版本化 Profile 提供动作上下文和比较依据，确定性规则把事实转换成分维度结论，客户端与 Agent 只做展示和语言组织。

用户提出的“理解动作轨迹，再通过规则引擎转换为可理解内容”是正确方向。需要修正的一点是：**Profile 参与规则计算，但 Profile 不是规则引擎本身。**

- 引擎是稳定、通用、可测试的执行器。
- Profile 是版本化数据，告诉引擎当前动作、机位和变式要观察什么，以及可与什么比较。
- RulePack 是版本化知识数据，告诉引擎在什么证据条件下可以生成哪种结论。
- 人工审核是追加的纠正事件，不覆盖 Rust 原始提案。

这种分法使增加动作主要变成“新增并审核 Profile、参考数据和 RulePack”，而不是在 Web、Android、iOS 或 Rust 中分别新增动作专用逻辑。

## 2. 目标与明确边界

### 2.1 v0.1 必须做到

1. 单次因果流处理，不允许为了得到更好结果反复重跑视频。
2. 每个 Rep 封存 `start`、`actual_task_extreme`、`return` 三个端点的完整特征快照。
3. 同时保存端点之间的完整轨迹摘要，而不是只保存一个 peak。
4. 器械轨迹与骨架轨迹共同参与阶段、端点和运动策略理解。
5. 分别与标准参考、个人稳定基线、当前组前段比较；缺哪一种就明确标记不可比较。
6. 输出提前反转、ROM 下降、返回不完整、双侧端点差、组内漂移、回程控制等分维度结果。
7. Rust 先输出不可变的质量提案；用户可以接受、修改、拒绝或标记无法判断。
8. 同时输出结构化证据、面向人的文本和面向 Agent 的文本；不输出掩盖原因的总分。

### 2.2 v0.1 不声称

- 不从二维轨迹声称真实左右力量、肌肉激活、关节力矩或受伤风险。
- 不把个人轻重量基线称为标准动作。
- 不把 Recognition Profile 的计次阈值当作标准 ROM。
- 不用一次偶然差异直接声称借力或力量不足。
- 不让 LLM 创造 Rust 没有观察到的偏差、端点或 Rep。

## 3. 模块与 seam

推荐新增内部深模块 `ExecutionAssessmentEngine`。它的 seam 位于“Rust 已封存的 CanonicalMotionOutput”和“跨端 MotionPacket 输出”之间。最终推荐是两种设计的混合：外部 Interface 保持极小，内部用受限的 `FeatureProgram` 和 `ExecutionRulePack` 支持数据驱动扩展。

该模块的所有依赖都是 in-process：Canonical frame、器械证据、Rep 边界、Profile、RulePack 和组内历史。WebAssembly、JNI 和 Objective-C++ 只是现有 Rust ABI seam 上的 adapter，不拥有规则逻辑。

```text
Camera frame
  -> pose/equipment inference
  -> Rust canonical + equipment fusion
  -> Rust rep segmentation
  -> ExecutionAssessmentEngine
       1. trajectory fact extraction
       2. endpoint snapshots
       3. reference comparisons
       4. deterministic rules
       5. proposal/text projection
  -> MOTN/1.8 packet
  -> Web / Android / iOS projection
  -> Realtime Agent explanation
```

内部推荐接口只有三个操作：

```rust
pub struct ExecutionAssessmentEngine { /* hidden state */ }

impl ExecutionAssessmentEngine {
    pub fn configure(bundle: ExecutionAssessmentBundle)
        -> Result<Self, AssessmentConfigurationError>;

    pub fn observe(&mut self, observation: CanonicalAssessmentObservation<'_>)
        -> Vec<AssessmentOutput>;

    pub fn finish_set(&mut self, finished_at_ms: u64)
        -> SealedSetAssessment;
}
```

`observe` 接受的事件可以是 frame、sealed rep、pause 或 context update，但 caller 不需要调用端点提取、比较器或单条规则。接口保持小，复杂度留在模块实现内。

推荐实际把顺序事件定义为：

```rust
pub enum AssessmentEvent<'a> {
    Frame(&'a CanonicalAssessmentFrame),
    RepSealed(&'a SealedRep),
    SetFinished { ended_at_ms: u64 },
}
```

这可以把 `configure + observe` 保持为主要测试 surface；`finish_set` 是 host 生命周期的便利入口，内部仍转换为同一个 `SetFinished` 事件。

外部客户端继续使用现有 Motion SDK 生命周期：配置动作上下文、`begin_set`、提交帧、`finish_set`、读取同一个 MotionPacket。客户端不直接调用内部规则。

## 4. 五类 Profile/知识数据

### 4.1 RecognitionProfile

职责：Rep 分段、计次、抗干扰和方向状态机。
回答：动作周期是否存在，边界在哪里。
不回答：动作是否标准。

### 4.2 ExecutionContract

职责：声明 exact action context 下可观察的任务和特征。

绑定至少包括：

```text
exercise + variation + equipment + side mode + camera view + training intent
```

内容包括：

- 阶段语义以及实际端点的意义；
- 主动特征、应相对稳定的支撑特征；
- 器械和骨架各自可提供的证据；
- 每个维度的 observability 要求；
- 当前机位允许和禁止的主张；
- 支持的 Feature ID 和单位。

它不包含个人数据，也不自动包含数值标准。

### 4.2.1 FeatureProgram

职责：用一组 Rust 支持的强类型原语声明该 exact context 如何从轨迹中提取 Feature。它是 `ExecutionContract` 引用的可执行数据，不是任意代码，也不负责作出好坏判断。

第一版原语建议包括：

- canonical landmark、joint angle、器械中心/端点/轴线；
- 点距、投影角、水平/垂直距离；
- body/equipment scale normalization；
- 速度、方向反转、固定窗口 median/MAD/coverage；
- bilateral delta、endpoint delta；
- phase resampling、corridor distance、prior-rep trend。

FeatureProgram 必须非图灵完备：不允许任意脚本、I/O、无界循环或动态代码。安装时 Rust 将其验证并编译成索引化 DAG；引用不存在的点位、循环依赖、未知单位、超过资源上限或输出非有限值都会 typed refusal。

示例：

```json
{
  "id": "bench.bar_vertical_rom",
  "op": "difference",
  "inputs": [
    "endpoint.start.equipment.bar_center_y",
    "endpoint.actual_task_extreme.equipment.bar_center_y"
  ],
  "unit": "normalized_image"
}
```

这样新增动作通常只需新增/审核 FeatureProgram、Profile 和 RulePack。只有出现全新的视觉原语或传感器时才需要升级 Rust 实现。

### 4.3 StandardReferenceProfile

职责：提供经审核的、exact-context 的可接受特征走廊。
用途：判断是否符合所选标准变式。
要求：多人、多体型、教练审核、留出验证和适用范围声明。

标准参考不存在时，系统仍可描述事实和个人漂移，但 `standard_adherence` 必须为 `cannot_judge`。

### 4.4 PersonalEndpointProfile

职责：保存用户主动选择的轻/中重量稳定 Rep，建立同动作、同机位、同变式、相近重量下的个人端点和轨迹走廊。

它适合回答：

- 当前工作重量是否比个人稳定表现更早反转；
- ROM、返回端点或左右路径是否下降；
- 同一人的轨迹是否偏离自己的稳定模式。

它不能单独回答：该用户的稳定模式是否符合标准动作。

### 4.5 ExecutionRulePack

职责：把已计算的事实和比较结果映射为质量提案。

RulePack 只使用引擎支持的有限操作，不允许嵌入任意脚本：

- `feature_available`
- `outside_corridor`
- `relative_drop`
- `endpoint_gap`
- `trend_across_reps`
- `persistence`
- `all_of` / `any_of`

每条规则必须声明：

- 适用的动作、变式、机位和意图；
- 必需 Feature ID；
- 比较依据是 standard、personal 还是 current set；
- 最低观测覆盖率和置信度；
- 最少持续帧数或 Rep 数；
- 允许输出的 claim；
- 替代解释和 `cannot_judge` 条件；
- 文本模板、最多一个首选提示；
- 规则版本和来源。

## 5. 核心数据模型

### 5.1 ExecutionContext

```ts
interface ExecutionContext {
  schemaVersion: "maxpower-execution-context/v1";
  contextId: string;
  exerciseId: string;
  variation: string;
  equipment: string;
  sideMode: "bilateral" | "unilateral" | "alternating";
  capturePosition: string;
  trainingIntent: string;
  plannedRom: "standard_variant" | "full_available" | "partial_intent" | "personal";
  load: { value: number; unit: "kg" | "lb" } | null;
  tempoIntent: string | null;
  recognitionProfileRef: VersionedRef;
}
```

上下文必须在 `begin_set` 前固定。中途改变动作、机位、变式或 Profile 会结束当前 sequence，不能让旧帧进入新规则状态。

### 5.2 CanonicalTrajectoryFact

轨迹事实只描述看到了什么，不解释原因：

```ts
interface CanonicalTrajectoryFact {
  featureId: string;
  phase: "ready" | "to_extreme" | "turnaround" | "from_extreme" | "returned";
  value: number | readonly number[] | null;
  unit: "normalized_image" | "body_scale" | "degree" | "ms" | "ratio";
  observationStatus: "observed" | "cannot_judge";
  confidence: number;
  sourceChannels: readonly ("pose" | "equipment" | "user_context")[];
  sourceFrameRange: { startFrameId: string; endFrameId: string };
  refusalReason: string | null;
}
```

Feature ID 是稳定语义，例如：

```text
equipment.bar_center_y
equipment.axis_tilt
pose.left_elbow_angle
pose.right_elbow_angle
pose.wrist_height_gap
rep.primary_rom
rep.return_endpoint_gap
rep.eccentric_duration
rep.concentric_duration
rep.path_monotonicity
set.primary_rom_drift
```

### 5.3 RepEndpointSnapshot

```ts
interface RepEndpointSnapshot {
  schemaVersion: "maxpower-rep-endpoint-snapshot/v1";
  kind: "start" | "actual_task_extreme" | "return";
  frameId: string;
  occurredAtMs: string;
  confirmedAtMs: string;
  causalConfirmationLatencyMs: number;
  selectionWindowMs: { from: string; to: string };
  facts: readonly CanonicalTrajectoryFact[];
  poseCoverage: number;
  equipmentCoverage: number;
  observationStatus: "observed" | "cannot_judge";
  refusalReasons: readonly string[];
}
```

`actual_task_extreme` 是本次实际到达的因果反向点，不能命名为目标端点。目标端点来自参考 Profile，两者必须独立保存。

`occurredAtMs` 是反向实际发生的帧时刻，`confirmedAtMs` 是因果状态机获得足够后续证据、确认该端点的时刻。二者不能合并，否则离线看起来对齐，也无法评估实时提示延迟。

### 5.4 SealedRepTrajectoryEvidence

```ts
interface SealedRepTrajectoryEvidence {
  schemaVersion: "maxpower-sealed-rep-trajectory-evidence/v1";
  repRef: VersionedRepRef;
  endpoints: {
    start: RepEndpointSnapshot;
    actualTaskExtreme: RepEndpointSnapshot;
    return: RepEndpointSnapshot;
  };
  phaseFacts: readonly CanonicalTrajectoryFact[];
  pathSummary: {
    sampleCount: number;
    poseCoverage: number;
    equipmentCoverage: number;
    featureSeriesRefs: readonly string[];
  };
  lineage: AssessmentLineage;
}
```

原始 canonical samples 继续按现有策略保存；`pathSummary` 是规则运行和报告使用的固定摘要，不替代原始证据。

### 5.5 ComparisonEvidence

同一个事实可以有三种独立比较：

```ts
interface ComparisonEvidence {
  featureId: string;
  comparisonKind: "standard_reference" | "personal_baseline" | "current_set";
  status: "inside_corridor" | "outside_corridor" | "cannot_compare";
  observedValue: number | null;
  corridor: { low: number; median: number; high: number; unit: string } | null;
  normalizedDelta: number | null;
  confidence: number;
  referenceRef: VersionedRef | null;
  refusalReason: string | null;
}
```

三种比较不能互相替代：

- standard 支持标准变式遵循；
- personal 只支持个人一致性；
- current set 只支持组内变化。

### 5.6 RustQualityProposal

```ts
interface RustQualityProposal {
  schemaVersion: "maxpower-rust-quality-proposal/v1";
  proposalId: string;
  proposalHash: string;
  scope: { kind: "rep" | "set"; ref: string };
  generatedAtSourceTimestampMs: string;
  lineage: AssessmentLineage;
  trajectoryEvidenceRef: string;
  comparisons: readonly ComparisonEvidence[];
  dimensions: {
    taskCompletion: DimensionFinding;
    range: DimensionFinding;
    phaseControl: DimensionFinding;
    supportStability: DimensionFinding;
    bilateralCoordination: DimensionFinding;
    trajectoryControl: DimensionFinding;
    stimulusCompatibility: DimensionFinding;
    observationConfidence: DimensionFinding;
  };
  coachInferences: readonly CoachInference[];
  preferredCue: PreferredCue | null;
  humanText: { locale: "zh-CN"; summary: string; details: readonly string[] };
  agentText: { summary: string; evidenceRefs: readonly string[]; prohibitedClaims: readonly string[] };
  noAggregateStandardnessScore: true;
}
```

每个 `DimensionFinding` 的状态只允许：

```text
observed_acceptable
observed_deviation
cannot_judge
not_applicable
```

并必须带 Rule ID、证据引用、实际数值、比较依据、置信度和无法判断原因。`coachInferences` 与直接测量分开，至少包含支持证据、替代解释和适用限制。

### 5.7 QualityReviewDecision

```ts
interface QualityReviewDecision {
  schemaVersion: "maxpower-quality-review-decision/v1";
  eventId: string;
  proposalId: string;
  proposalHash: string;
  decision: "accepted" | "modified" | "rejected" | "cannot_judge";
  correctedDimensions: readonly CorrectedDimension[];
  correctedPreferredCue: PreferredCue | null;
  stablePersonalBaseline: "accepted" | "rejected" | "not_reviewed";
  loadContext: { value: number; unit: "kg" | "lb" } | null;
  reviewer: { id: string; role: string };
  note: string;
  recordedAt: string;
  expectedPriorReviewEventId: string | null;
}
```

审核事件永远不修改 `RustQualityProposal`。训练样本由 proposal、review decision 和 adjudication materialize 得到。

### 5.8 PersonalEndpointProfile

```ts
interface PersonalEndpointProfile {
  schemaVersion: "maxpower-personal-endpoint-profile/v1";
  profileId: string;
  subjectRef: string;
  contextBinding: ExactExecutionContextBinding;
  sourceProposalRefs: readonly string[];
  sourceReviewEventRefs: readonly string[];
  loadBands: readonly {
    bandId: string;
    minLoadKg: number;
    maxLoadKg: number;
    acceptedRepRefs: readonly string[];
    corridors: readonly FeatureCorridor[];
    sampleCount: number;
    status: "owner_reviewed_baseline" | "insufficient_samples";
  }[];
  createdAt: string;
  contentHash: string;
}
```

Profile 更新会创建新版本。旧报告继续 pin 旧版本，不能用新基线重写历史提案。

## 6. 规则计算顺序

引擎对每个 Rep 按固定顺序执行：

1. `observation_readiness`：主体、机位、时间戳、必要点位、器械覆盖率。
2. `endpoint_extraction`：封存三端点，保存实际极值而非目标极值。
3. `trajectory_feature_extraction`：ROM、阶段时间、路径、左右、支撑和控制特征。
4. `comparison`：分别对 standard、personal、current set 计算走廊关系。
5. `dimension_rules`：生成提前反转、ROM 下降、返回不完整、双侧端点差等直接结论。
6. `persistence_rules`：只有多帧或多 Rep 持续证据才生成借力倾向、组内漂移等教练级推断。
7. `cue_selection`：按严重度、可信度、可执行性和冷却时间最多选择一个提示。
8. `projection`：同一结果生成结构化对象、模板化人类文本和 Agent 文本。

第一 Rep 可以有端点和路径结论，但不能声称组内漂移。后续 Rep 只能与已经发生的 Rep 比较。`finish_set` 可以额外生成一个 set-level proposal 汇总持续模式，但不能修改已经封存的 per-rep proposal。

Current-set baseline 的更新顺序必须固定为：先用历史 Rep 比较并封存当前 proposal，再将当前 Rep 纳入后续比较。当前 Rep 不得与包含自己的走廊比较。

## 7. 首批规则的证据要求

| Rule ID | 必需证据 | 比较依据 | 输出限制 |
| --- | --- | --- | --- |
| `EARLY_TURNAROUND` | 实际极值、可靠主轨迹 | standard 或 personal | 仅 current set 不足以称为目标不足 |
| `ROM_DROP` | 当前 ROM、已发生的稳定 Rep | personal 或 current set | 表述为下降，不自动表述不标准 |
| `INCOMPLETE_RETURN` | start/return 同源特征 | execution contract + corridor | 器械/骨架冲突时 cannot_judge |
| `BILATERAL_ENDPOINT_GAP` | 双侧均可靠、同步动作 | noise floor + applicable corridor | 不解释为真实力量差 |
| `BILATERAL_TIMING_GAP` | 双侧反向时间 | applicable corridor | 单侧/交替动作不适用 |
| `RETURN_CONTROL_LOSS` | 返回阶段速度、单调性、路径覆盖 | personal/current set/tempo intent | “更快”本身不是错误 |
| `SET_EXECUTION_DRIFT` | 至少 3 个可比 Rep | current set + optional personal | 输出趋势和覆盖率 |
| `POSSIBLE_MOMENTUM_ASSISTANCE` | 两个独立特征组持续偏离 | exact-context RulePack | 只能输出可能性与替代解释 |

阈值不得凭空写成全动作通用常数。优先来源依次为：经过验证的标准走廊、用户审核的个人走廊、同组稳定前段以及明确标记为 provisional 的测量噪声阈值。

## 8. 器械与骨架融合原则

器械不是骨架失败后的简单 fallback；二者在已知动作上下文中承担不同且互补的语义：

- 杠铃/哑铃轨迹更直接地表达外部负重的去程、反向、回程、ROM、左右端点和路径稳定性。
- 骨架表达关节和身体段如何配合完成该负重轨迹。
- 阶段和任务端点可以以器械为主证据，同时使用骨架验证动作语义。
- 技术策略和可能借力需要关节、躯干、器械多个独立特征，不可仅凭器械轨迹。
- 两通道冲突时保存冲突事实并输出 needs-review/cannot-judge，不能静默选择看起来更好的结果。
- 器械可以约束短时低置信度点的运动走廊，但预测点必须继续标记 predicted，不能伪装 measured。

## 9. MOTN/1.8 契约

建议在现有 `ANG1`、`EQP1` 后增加长度前缀扩展：

```text
QLT1 | u32 byte_length | UTF-8 JSON
```

JSON 使用 `maxpower-rust-quality-proposal/v1`，只在 Rep 封存或 set 结束时携带完整提案；普通 frame 包含空列表，避免逐帧重复大对象。

选择长度前缀 JSON 的理由：

- 质量字段仍在快速迭代，固定二进制槽位会让每个新增 Feature 都修改三端 decoder；
- 权威生成者仍是 Rust，JSON 只是同一 packet 的 adapter 表示，不是第二套计算；
- 内容可以用 JSON Schema 校验并保留 unknown fields 的前向兼容；
- 原始 frame/landmark/equipment 继续使用紧凑二进制，不影响主要实时带宽。

兼容规则：

1. `MOTN/1.8` 只做 additive extension，不改变 COCO/Halpe 索引、Rep 边界或 `EQP1`。
2. 新 decoder 必须继续读取 1.7；1.7 decoder 可以忽略带长度的尾部扩展。
3. schema major 改变语义或删除字段；minor 只增加可忽略字段。
4. 所有 Profile、RulePack、proposal、review event 都有独立 schema version 和 content hash。
5. proposal ID 由输入 evidence refs、context/profile/rule hashes 和引擎版本确定性生成；浮点在 hash 前按契约量化。

## 10. 人类文本与 Agent 文本

规则输出首先是结构化事实；文本是同一规则结果的确定性 projection。

推荐每条规则保存：

```ts
{
  messageKey: "bench.rom_drop.personal_baseline",
  parameters: {
    repIndex: 7,
    observedRom: 0.182,
    baselineMedian: 0.213,
    dropPercent: 14.6
  },
  fallbackZh: "第 7 次的杠铃行程比个人稳定基线短 14.6%。",
  agentStatement: "Observed ROM decreased 14.6% versus the pinned personal baseline.",
  claimLimits: ["does_not_measure_force", "personal_baseline_is_not_standard_form"]
}
```

Realtime Agent 可以调整语气、结合训练计划提问或建议，但不得：

- 改写 actual values、Rule ID、comparison kind 或 confidence；
- 把运动学不对称说成真实力量差；
- 把个人偏离说成偏离标准；
- 在 `cannot_judge` 时补出结论；
- 创造第二套 Rep 或端点。

## 11. 数据从哪里来

### 11.1 自动预标

Rust 对现有全部视频按单次因果顺序输出：

- Rep 三端点快照；
- 全轨迹特征；
- standard/personal/current-set 比较状态；
- Rule findings、首选提示和拒绝原因。

这一步产生 `RustQualityProposal`，不是训练真值。

### 11.2 用户审核

页面显示视频、骨架、器械轨迹、端点、Rust 提案和数值依据。用户对每个 Rep：

- 接受、修改、拒绝或无法判断；
- 核对持续不对称、借力、回程控制和首选提示；
- 选择哪些轻/中重量 Rep 可进入个人稳定基线；
- 补录当时重量和必要上下文。

### 11.3 Profile 生成

只有被明确接受为个人稳定基线的 Rep 才进入 `PersonalEndpointProfile`。按 exact context 和重量区间生成中位数、MAD/分位数、测量覆盖率和样本量；样本不足时状态为 `insufficient_samples`，不强行给走廊。

质量训练集保留 Rust 原提案、人工纠正、审核者、上下文、证据引用和切分组。个人数据不能证明跨用户标准动作，标准 ReferenceProfile 必须单独收集与审核。

## 12. 实施顺序

### Phase A：事实与契约

- 新增三端点和完整轨迹证据类型。
- 定义并验证有限的 FeatureProgram 指令集和资源上限。
- 新增 `ExecutionAssessmentEngine`，先只输出 facts 和 cannot-judge。
- 增加 `MOTN/1.8 QLT1`，三端 decoder 只投影，不重算。
- 建立跨 native/WASM 的 packet golden tests。

### Phase B：组内与个人规则

- 实现 current-set baseline。
- 实现用户审核与稳定 baseline 选择事件。
- 生成/load `PersonalEndpointProfile` 和重量走廊。
- 实现首批七项直接规则，不启用“借力”推断。

### Phase C：标准与教练推断

- 收集 exact-context 标准与偏差审核集。
- 建立 `StandardReferenceProfile` 和 `DeviationEffectPattern`。
- 只有两个独立特征组、多 Rep 持续且精确率通过后，才启用借力/刺激兼容性推断。

### Phase D：Realtime Agent

- Agent 消费 Rust proposal，而不是 TypeScript 重新计算。
- 对照测试多模态端点截图 Agent 与 Rust 轨迹文本 Agent。
- 验收实时提示冷却、每次最多一个提示、训练后完整复盘和动态规划输入。

## 13. 验收标准

规则引擎不能只以“识别率”验收。每个 claim 独立测量：

- Rep 计数和边界对齐；
- 三端点时间误差；
- 骨架/器械 observation coverage 和冲突率；
- 每条规则的 precision、recall、cannot-judge coverage；
- clean Rep 的误提示率；
- 同组趋势方向准确率；
- proposal 与人工审核的一致率；
- Web/Android/iOS 对同一输入的结构化结果一致性；
- 单次因果流性能、丢帧、积压、温升和内存上限。

在没有标准 ReferenceProfile 和质量金标之前，可以验收任务、端点、轨迹事实、个人一致性和组内漂移；不能宣称已经达到“95% 标准动作判断”。95% 必须绑定具体 claim、数据切分、容差和 `cannot_judge` 口径。

## 14. 当前推荐决策

1. 采用一个 Rust `ExecutionAssessmentEngine` 深模块，外部 host 不接触单条规则。
2. 采用“极小 Interface + 内部 FeatureProgram/RulePack”的混合方案：Profile 作为版本化数据被引擎执行，不把 Profile 与引擎代码混在一起。
3. RecognitionProfile、ExecutionContract、ReferenceProfile、PersonalEndpointProfile、RulePack 分责，但通过一个 `ExecutionAssessmentBundle` 一次性安装，避免 caller 组合错误。
4. `RustQualityProposal` 和 `QualityReviewDecision` 永久分离并 append-only。
5. 首版先做可验证的端点、ROM、返回、左右和组内漂移；借力与刺激兼容性等到多特征审核数据具备后启用。
6. Rust 输出结构化结论与确定性 fallback 文本；Agent 负责表达和追问，不负责重算事实。

## 15. 三种 Interface 方案比较

本设计按 “Design It Twice” 比较了三个明显不同的 Interface。

### Alternative A：最小事件接口

```rust
new(ExecutionKnowledgeBundle) -> Engine
advance(AssessmentEvent) -> AssessmentEmission
```

优点是 Interface 最小、测试 surface 最集中、caller 几乎不可能错误组合内部步骤。缺点是安装 bundle 和运行事件的类型需要设计得非常清晰，否则一个 `advance` 会变成语义过宽的入口。

### Alternative B：数据驱动解释程序

```rust
prepare(program_bytes, context) -> Engine
observe(input) -> Delta
finish() -> SealedAssessment
```

核心优势是 `FeatureProgram + RulePack` 允许新增动作主要通过数据完成，长期扩展性最好。主要代价是必须维护安全指令集、安装验证器、资源上限和 explain trace。

### Alternative C：Set-first session

```rust
begin_set(selection)
observe(frame) -> LiveOutput
finish_set() -> TrainingExecutionReport
```

对 Web/Android/iOS caller 最直观，整个 set 的复杂度都藏在 Rust 后面。主要代价是它容易与现有 Motion SDK session 生命周期重叠；若另建一层公开 session，可能产生两个相似 Interface。

### 推荐混合

采用 A 的小 Interface、B 的内部数据驱动能力和 C 的 host 使用体验：

- 内部核心是 `ExecutionAssessmentEngine::configure + observe(event)`；
- `FeatureProgram + ExecutionRulePack` 只在模块内部执行；
- 现有 Motion SDK 的 `begin_set / frame / finish_set` 继续作为三端 caller Interface，不再增加一个平行 session；
- `WebRuntime`、native ABI 和 MotionPacket 只是 adapter；
- `finish_set` 必须幂等地返回第一次封存的同一 report，不重新分析得到新结论。

这个混合方案在 depth、locality、跨端 leverage 和长期动作扩展之间最平衡。
