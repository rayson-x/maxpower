Status: approved / ticketed / in progress (Ticket 01 complete)

Current implementation state: Ticket 01 installs only `context_resolution_only` Bundles. Rust resolves action/view/equipment/Pose context and immutable eight-component lineage for the current corpus, while frame execution and quality-report claims remain fail-closed until Ticket 02 supplies the first real vertical tracer.

Delivery plan: [`issues/PLAN.md`](issues/PLAN.md)

# Rust 视频动作理解、整组质量与可追踪解释 vNext

> Last aligned: 2026-08-14
>
> 本规格实现 `docs/agents/rust-motion-trace-explainer-product-contract.md` 的 Rust 识别能力切片。当前轮只建设和验证 Rust 动作理解能力，不包含 Web、Android、iOS、Agent、正式用户页面、上传或跨端接入。

## 1. 为什么做

MaxPower 已有 Canonical packet、主体连续性、部分 RecognitionProfile、Rep 封存、杠铃局部坐标、基础器械融合和质量提案，但这些能力没有组成一条完整、可扩展的动作理解链。

当前主要问题不是“能不能显示骨架”，也不是“能不能数出几个 Rep”，而是：给定一段已知动作和机位的视频，Rust 还不能稳定地从真实人体和器械证据推导出动作完成情况、逐 Rep 质量事实、整组持续模式和可复现的因果关系。

本轮目标是先证明识别能力成立。Rep 次数只是整组动作质量报告的一个字段，不是最终交付目标。

## 2. 能力目标

对一个受支持的 exact action context，Rust 必须能够：

1. 在处理第一帧前解析视频动作上下文并冻结一个完整识别 Bundle；
2. 根据动作定义自动确定器械语义，不要求当前标注视频重复输入器械；
3. 从 Canonical pose 和适用器械 observation 建立动作局部坐标和独立运动事实；
4. 保留 pose/equipment 的一致、冲突、缺失、置信度和 provenance；
5. 封存 Rep 边界、阶段、完整/partial/rejected disposition；
6. 计算带单位、coverage、confidence、uncertainty 和 source range 的运动特征；
7. 明确特征使用 self geometry、set prefix、same-session 或 governed reference 中的哪种比较；
8. 通过有限、确定性的规则生成逐 Rep 和整组质量维度结论；
9. 在 `finish_set` 输出不可变 `SealedSetAssessment`；
10. 为每条结论保存可解析的 `EvidenceDerivationTrace`；
11. 在现有治理准入数据上报告真实可测的识别指标和无法测量的缺口。

## 3. 当前可复用基础

- Canonical pose packet、unknown landmark 和主体连续性；
- `MotionSession` 的 begin/process/pause/resume/finish 生命周期；
- `RepEngine`、RecognitionProfile、`SealedRep` 和 disposition；
- `EquipmentFusionEngine` 的主体关联、Track、镜面/静态拒绝和 typed cannot-judge；
- `LocalMotionCoordinateEstimator` 的因果冻结、独立 pose/equipment channel、冲突和降级语义；
- 当前 12 个动作的静态 assessment contract 和固定质量映射；
- `ExecutionAssessmentEngine` 的 configure/advance scaffold；
- 当前个人标注中的 54 条记录、12 个动作、7 类机位、464 个 Rep 范围和负例窗口。

这些是实现基础，不是完整动作质量能力的完成声明。

## 4. 视频识别输入契约

### 4.1 当前标注提供的权威上下文

当前治理准入的个人 Rep 标注为每条视频记录提供：

- `sourceCaptureId`；
- `exerciseId`；
- `capturePosition`；
- `expectedCount`；
- 人工 Rep start/end 范围；
- reviewed negative windows。

器械、动作变式和训练侧别不是当前标注的独立权威字段。

### 4.2 VideoRecognitionContext

视频识别任务在第一帧前至少固定：

- source/video identity；
- `exerciseId`；
- `capturePosition`；
- 图像尺寸、旋转、镜像和时间戳约定；
- Pose schema/runtime contract；
- workout/set identity；
- 可选的 set intent、计划负重和用户修改后的实际负重。

当前视频的预期器械语义由版本化 `ActionDefinition` 根据 `exerciseId` 自动解析。器械 detector 负责验证、定位和跟踪实际器械，不负责决定用户选择的动作。

### 4.3 当前动作—器械语义

| 动作 | 预期器械语义 |
| --- | --- |
| `barbell_bench_press` | rigid bar axis |
| `barbell_row` | rigid bar axis |
| `seated_shoulder_press` | rigid bar axis |
| `lat_pulldown` | cable bar / moving handle |
| `seated_row` | cable / moving handle |
| `straight_arm_pulldown` | cable bar |
| `single_arm_cable_lateral_raise` | unilateral cable handle；活动侧由运动证据建立 |
| `machine_chest_press` | machine handle / constrained lever |
| `rear_delt_fly` | machine handle / constrained lever |
| `lateral_raise` | two independent dumbbells |
| `push_up` | body-only pose evidence |
| `pull_up` | body relative to fixed support |

动作或机位无法精确解析、Bundle 不完整、版本不兼容或输入在一组中途变化时，Rust 返回 typed refusal，不借用相似动作或热切换 Bundle。

## 5. 核心深模块

`ExecutionAssessmentEngine` 是本轮最高识别 seam。调用方只知道：

```text
configure(versioned bundle catalog)
advance(lifecycle or canonical observation event)
→ LiveMotionFacts | SealedSetAssessment | TypedRefusal
```

FeatureProgram、Reference Runtime、Comparison Runtime、RulePack、Set Aggregator 和 Trace Builder 都是模块内部 seam。调用方不能跳过、重排或自行组合它们。

## 6. ExecutionAssessmentBundle

一个 exact-context Bundle 原子绑定：

- `RecognitionProfile`：Rep 周期、边界、阶段和抗干扰；
- `ExecutionContract`：动作任务、端点语义、可观察维度和允许主张；
- `LocalCoordinateStrategy`：身体锚点、器械轴/端点、原点、尺度和运动方向；
- `EquipmentAdapter`：当前动作实际追踪的器械或固定支撑语义；
- `FeatureProgram`：从不可变运动证据提取带单位事实；
- `ReferencePolicy`：允许的 self/set-prefix/session/governed comparison；
- `ExecutionRulePack`：Rep-scope 与 set-scope 的确定性结论规则；
- set aggregation policy；
- schema/version/content hash lineage。

Bundle 在启用前整体校验和编译。任何 schema、hash、单位、DAG cycle、未知 Feature、未知 rule operation、资源上限或 exact-context 不一致都会阻止该 context 启用。

## 7. 正确执行顺序

### 7.1 配置阶段

1. 从 `VideoRecognitionContext` 精确解析 `ActionDefinition`；
2. 解析并验证完整 Bundle；
3. 编译 FeatureProgram 和 RulePack；
4. `SetStarted` 冻结动作、机位、Bundle 和已有 Session Reference snapshot。

`ExecutionContract` 在配置时已经存在，它不是 RecognitionProfile 运行之后才加载的步骤。

### 7.2 逐帧阶段

1. Canonical pose 保留所有候选、置信度和 unknown；
2. EquipmentAdapter 根据动作语义关联实际杠轴、把手、摆臂、哑铃或固定支撑；
3. LocalCoordinateStrategy 建立动作局部坐标，不恢复世界 3D、重力或力量；
4. pose/equipment 先形成独立 motion facts，再产生 agreement/conflict/cannot-judge；
5. RecognitionProfile 推进状态机并累积 causal path evidence；
6. Trace Recorder 从 source observation 开始持续记录 lineage。

### 7.3 RepSealed 阶段

1. 封存 start、turnaround、end、完整路径和 disposition；
2. ExecutionContract 解释端点和阶段的当前动作语义；
3. 运行 Rep-level FeatureProgram；
4. 使用已经冻结的 self/set-prefix/session/governed reference 比较；
5. 运行 Rep-scope RulePack；
6. 封存不可变 Rep facts、comparisons 和 findings；
7. 当前 Rep 完成评价后，才可进入后续 Rep 的 set-prefix/reference 候选。

当前 Rep 永远不能与包含自己的 reference 比较。

### 7.4 finish_set 阶段

1. 处理最后才能确认的 Rep、partial 和 rejected candidate；
2. 运行 set FeatureProgram 和 Set Aggregator，形成趋势、持续性、后段变化和 disposition summary；
3. 计算 set-level comparison；
4. 运行 set-scope RulePack；
5. 对主要结论排序，但不生成掩盖各维度的不透明总分；
6. Trace Sealer 验证每条结论的完整 lineage、版本和 content hash；
7. 输出一次不可变 `SealedSetAssessment`；
8. 报告封存后，Reference Runtime 才决定本组是否可以更新后续 Session Reference。

重复 `finish_set` 必须返回相同 assessment identity、hash 和内容，不重新运行规则或更新参考。

## 8. 模块职责

### RecognitionProfile

回答动作周期是否发生、Rep 在哪里、阶段如何变化。它不判断动作是否正确，也不能因为质量差而移动或删除已发生的 Rep。

### ExecutionContract

声明当前 exact action context 的任务完成条件、端点语义、可观察关节/器械/支撑关系、当前机位允许的质量维度和禁止主张。

### FeatureProgram

使用有界、非图灵完备的强类型 DAG 计算数值事实。每个结果携带稳定 Feature ID、value、unit、status、coverage、confidence、uncertainty、provenance 和 source range。缺证据保持 unknown；FeatureProgram 不输出正确/错误。

### Reference 与 Comparison Runtime

明确区分：

- `self_geometry`；
- `set_prefix`；
- `session_reference`；
- `governed_reference`；
- `none`。

第一组没有 Session Reference 时，直接观察和 self-geometric 结论仍可输出；依赖缺失参考的维度必须 `cannot_judge`。

### ExecutionRulePack

只读取 Feature 和 Comparison evidence，支持有限阈值、corridor、ratio、delta、persistence、coverage gate、all/any 和 typed abstention。规则分 Rep scope 与 Set scope，并分别声明所需证据、结论维度、限制和替代解释。

### Set Aggregator

从不可变 Rep facts/findings 产生整组事实：持续 deviation、late-set drift、左右重复差异、完整/partial/rejected 分布和主要问题候选。它不回写 Rep 边界，也不把一次偶然差异包装成整组模式。

### Trace Builder

Trace Recorder 贯穿 source、normalization、fusion、Rep、Feature、Comparison、Rule 和 Set aggregation。最终 Trace Sealer 只负责解析检查、版本 pin、限制、排除证据和稳定 hash。断链结论不得进入报告。

## 9. SealedSetAssessment

整组报告至少包含：

- frozen video/action/view/equipment context；
- Bundle/Profile/FeatureProgram/RulePack lineage；
- Confirmed、Needs-review、Rejected counts；
- 每个 Rep 的 causal endpoints、disposition 和 facts；
- movement-task completion；
- visible ROM 和 return completeness；
- phase timing 和 control；
- pose/equipment trajectory control；
- support/trunk stability；
- bilateral endpoint/timing facts；
- late-set and persistent patterns；
- comparison kind、reference source 和 compatibility；
- 每个维度独立的 observed acceptable / observed deviation / cannot judge / not applicable；
- observation confidence、limitations 和 alternative explanations；
- 每条结论的 Trace root。

报告结构固定为“可验证观察 → 谨慎解释 → 限制/替代解释”。单目视频不能证明力、肌肉激活、疼痛原因、伤病风险或唯一疲劳机制。

## 10. 动作家族复用

本轮用以下纵向 Tracer 验证同一引擎：

1. 一个真实刚性杠铃 exact context 完整跑通所有阶段；
2. 扩展到当前杠铃动作家族；
3. 绳索杆/运动把手固定器械；
4. 机器约束摆臂；
5. 两个独立哑铃；
6. body-only 与固定支撑。

动作差异通过 ActionDefinition、Contract、Adapter、Profile、FeatureProgram 和 RulePack 表达。只有出现新的视觉原语或传感器语义时才扩展通用 Rust implementation。

## 11. 评估与数据边界

当前治理审计通过的个人监督可用于：

- action/view context；
- expected Rep count；
- Rep start/end；
- reviewed negative windows。

因此本轮可以正式报告：

- context/Bundle resolution coverage；
- Rep count error、precision/recall 和边界误差；
- negative-window false trigger；
- local-coordinate/fusion fact availability；
- non-empty set report generation rate；
- per-dimension judgeability；
- reference availability；
- trace completeness；
- cannot-judge reason distribution。

当前没有 traceable human phase endpoints、accepted equipment tracks 或正式 quality gold labels，所以阶段、器械轨迹和质量判断只能报告输出覆盖/拒绝情况，不能宣称准确率。Owner/touched 数据可以支持开发与回归，不能证明跨用户泛化。

用户未来标注不是 Ticket 01–07 的前置阻塞条件。新增数据在被训练或正式评估消费前仍必须通过独立 data-governance catalog 的 asset/admission 校验。

## 12. 不可违反的原则

1. 动作身份来自训练/标注上下文，不从自由运动猜测。
2. 当前视频器械语义由 ActionDefinition 推导；实际轨迹必须来自视觉证据。
3. Pose 与 equipment 保持独立来源，不能重复计证据。
4. Missing/unknown/conflict 不得被下一层猜测补齐。
5. Rep 边界由 RecognitionProfile/RepEngine 唯一拥有，质量规则不能改写。
6. 当前 Rep/Set 不得更新参考后再评价自己。
7. 每条整组结论必须有完整 Trace。
8. 结论按维度输出，不使用掩盖证据差异的不透明总分。
9. Ordinary user feedback 不是 annotation truth。
10. 未完成全链路的 exact context 不得声明质量支持。

## 13. 本轮范围外

- Web、Android、iOS 或 Agent 接入；
- 正式用户页面、结论优先 UI 或 Trace 展开交互；
- 跨端 packet parity 和 App 验收；
- 视频上传、保留授权、云同步和删除流程；
- 自动动作分类；
- 世界水平线、重力、metric 3D、力、力矩或肌肉激活推断；
- 医疗、伤病或唯一疲劳原因结论；
- 在线学习、自动改阈值或自动晋升规则；
- 在没有 governed evidence 时声称约 70 个动作已经达到同等识别质量。

长期目标仍是活动动作库的全部动作。当前纵向 Tracer 验证引擎和现有 12 个标注动作；后续动作按家族新增 exact-context Bundle 和冻结评估，而不是复制引擎。

## 14. 交付与完成标准

本规格由 `issues/PLAN.md` 中的 8 个纵向 Ticket 实现。Ticket 01 建立前置上下文和 Bundle seam；Ticket 02 跑通首条完整动作理解；Ticket 03–07 并行扩展动作家族；Ticket 08 汇总当前治理数据上的能力和可测指标。

一个动作家族 Ticket 只有在至少一个真实 exact context 完成以下链路时才完成：

```text
context
→ canonical pose/equipment evidence
→ local coordinate and fusion
→ Rep/phase
→ Feature
→ Comparison
→ Rep rules
→ Set aggregation
→ Set rules
→ Trace
→ SealedSetAssessment
```

只通过合成测试、只计 Rep、只产生空质量字段或只显示内部坐标都不算完成。
