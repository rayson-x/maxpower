# 本地动作质量规则引擎：观测边界、证据表达与契约依据

日期：2026-08-13
状态：架构研究；不构成临床、生物力学测量或逐动作阈值标准

## 结论

单目二维骨架与可靠器械轨迹适合做深的是**运动学事实与同上下文比较**：Rep 阶段、实际反向点、返回端点、投影 ROM、阶段时长、器械路径、可见左右端点/时序差、重复间稳定性和组内漂移。它们可以支持接近线上教练的概率性提示，但不能直接升级为真实力量、肌肉激活、关节力矩或受伤风险。

因此本地规则引擎应把输出分为三层：

1. 观测事实：数值、单位、来源、时间范围、覆盖率和缺失原因；
2. 比较结论：相对标准参考、个人基线或当前组，分别 inside/outside/cannot-compare；
3. 教练推断：由多项持续证据触发，保留替代解释、适用限制和 `cannot_judge`。

原始 Rust 提案和后续人工纠正应是两个不可变、互相引用的实体。Profile、RulePack、引擎、输入证据和输出提案都应有版本与 content hash，历史报告 pin 生成它时使用的版本。

## 1. 单目二维与器械轨迹能支持什么

### 1.1 可以作为直接事实

在动作、变式和机位预先已知、主体与轨迹可靠的前提下，可以保存：

- Rep 的 start、实际 task extreme、return；
- 预期去程/回程的方向、时长、停顿和可见速度变化；
- 投影关节角、身体比例归一化位移、器械中心/轴线轨迹；
- 同步双侧动作的可见端点、ROM、反向时间和路径差；
- 相同机位下的 Rep-to-Rep 一致性、后程 ROM/节奏/路径漂移；
- 每项结果的 pose/equipment coverage、冲突和 `cannot_judge`。

器械路径对卧推、深蹲、硬拉、划船和哑铃动作尤其有价值，因为它直接描述外部负重的可见位移。骨架用于解释身体段如何配合完成该位移。二者是融合输入，不是互相覆盖的真假开关。

以专用光学设备测量杠铃平均向心速度可以达到可用效度与可靠性，但相关研究使用经过校准的设备并与三维 motion capture 对照；这不能直接外推为“任意手机单目 detector 已经能精确测速度”。它支持的产品结论是：器械位移/时间值得作为独立特征，并且必须在目标相机、视角和设备上单独校准误差。[Weakley 等，2020](https://pubmed.ncbi.nlm.nih.gov/32459410/)

### 1.2 不能从当前证据直接得到

- 实际左右力量分配；
- 关节净力矩、关节接触力或功率；
- 肌肉激活、肌肉力或“哪块肌肉发力多少”；
- 三维旋转、被遮挡的肩胛/脊柱状态；
- 疼痛、受伤风险、RPE 或 RIR。

OpenSim 的逆动力学工作流需要经过处理的运动学、个体模型以及外部载荷，静态优化还在动力学约束和目标函数下估计肌肉激活/力；它不是从二维点位直接读取这些变量。[OpenSim Inverse Dynamics](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics)，[OpenSim Static Optimization](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53085189/Working%20with%20Static%20Optimization)

OpenCap 的已发表验证也说明了这一区别：它用两台或更多手机、相机标定、多视角三角化、肌骨模型和物理模拟来估计三维运动学与动力学；实验室验证还使用 motion capture 与 force plate。由此可以合理推断，MaxPower 当前单目二维流不应把投影不对称命名为真实力量不对称，也不应把轨迹直接转换成力矩或肌肉激活。[Uhlrich 等，2023](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)

## 2. 规则如何表达证据

### 2.1 事实、比较、推断必须分开

推荐一条结论保存以下信息：

```text
observed fact
  feature id + value + unit + phase + source frames + source channels
comparison
  standard | personal | current_set + corridor ref + normalized delta
rule result
  rule id + status + confidence + cannot-judge reason
coach inference
  supporting evidence refs + alternatives + claim limits + cue
```

示例：

```text
事实：第 7 次杠铃垂直行程为 0.182 body-scale。
比较：个人稳定基线中位数为 0.213，下降 14.6%。
规则：ROM_DROP / observed_deviation。
提示：下一次先减轻重量并保持完整返回。
限制：个人基线不是标准动作；该结果没有测量左右力量或肌肉激活。
```

### 2.2 `cannot_judge` 是一等结果

每个维度独立判断证据是否足够。腕肘不可见不必让可靠杠铃阶段变成 unknown；反过来，可靠杠铃中心也不能支持肩部或躯干技术结论。缺标准参考时，个人一致性仍可 observed，但标准遵循必须 `cannot_judge`。

模型 score 与 claim confidence 必须分开：高 keypoint score 只表示模型对该观测更有把握，不等于规则对“力量不足”之类解释有证据。

### 2.3 推断要求持续、多特征证据

直接规则可以用一个同源、已校准的特征判断实际返回不完整或 ROM 下降。借力、刺激兼容性和首选提示需要更高门槛：

- exact action context 适用；
- 至少两个独立特征组；
- 在多帧或多 Rep 持续；
- 超过测量噪声和适用走廊；
- 保存替代解释；
- clean set 的误提示率经过冻结数据验证。

因此“躯干移动了一次”不能直接变成“借力”；“后 3 次躯干摆动、器械路径缩短且 ROM 下降”才可以触发“更像常见借力策略”的待审核提案。

## 3. Profile 与规则引擎的关系

Profile 应是规则引擎输入的数据，而不是与执行器混为一体：

- `RecognitionProfile`：找到 Rep 和边界，不代表标准动作；
- `ExecutionContract`：声明 exact context 的阶段语义、Feature IDs、可观测性和允许主张；
- `StandardReferenceProfile`：经审核标准走廊；
- `PersonalEndpointProfile`：用户审核的个人稳定基线和重量走廊；
- `ExecutionRulePack`：把事实/比较组合为结论的声明式规则。

本地 Rust 引擎负责验证这些数据是否互相兼容、提取特征、执行比较、应用规则并生成 proposal。客户端只安装一个已验证的 bundle，避免 caller 自己拼装五类版本。

## 4. 不可变提案与人工纠正

W3C PROV 把 entity、生成/使用它的 activity、负责的 agent 和 entity derivation 分开，并将 provenance 用于判断数据可靠性和可复用性。该模型支持本项目将 Canonical evidence、Rust proposal、人工 review event 和 materialized training label 保存为不同实体，通过“used/generated/derived from”关系关联，而不是让人工修改直接覆盖算法输出。[W3C PROV-DM Recommendation](https://www.w3.org/TR/prov-dm/)

推荐映射：

```text
Canonical evidence (Entity)
  used by Rust assessment run (Activity)
    generated RustQualityProposal (Entity)
      reviewed by human review activity (Activity + Agent)
        generated QualityReviewDecision (Entity)
          used by adjudication/materialization activity
            generated TrainingExample or PersonalEndpointProfile version (Entity)
```

这保证可以计算：原始算法准确率、哪条规则常被纠正、不同审核者一致性、哪版 Profile/RulePack 生成了历史报告。

## 5. Schema 与版本契约

JSON Schema Draft 2020-12 提供 `$schema`、`$id`、独立 vocabulary 和组合 schema 的标准机制，适合验证 `QLT1` 中仍在迭代的质量对象，并避免三端各写一套宽松字段检查。[JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)

建议：

1. 每类对象有稳定 `$id`/`schemaVersion`，例如 `maxpower-rust-quality-proposal/v1`。
2. 语义删除或重定义升 major；可忽略字段增加走 additive minor。
3. 每个 proposal pin 引擎、Feature schema、RecognitionProfile、ExecutionContract、ReferenceProfile、PersonalEndpointProfile、RulePack 和 packet 版本。
4. 每个不可变对象保存 canonicalized content hash；浮点先按 wire contract 量化。
5. review event 引用 proposal ID + hash，并用 optimistic revision 追加。
6. 未知版本或上下文绑定不匹配时 typed refusal，不降级到“最像的 Profile”。

## 6. 对当前设计的建议

1. 采用单个 Rust `ExecutionAssessmentEngine` 深模块；Profile/RulePack 通过一次 `configure(bundle)` 安装。
2. 对外只保留 configure、observe、finish_set；特征提取器、比较器、规则执行器和文本模板是内部 seam。
3. `MOTN/1.8` 以长度前缀 `QLT1` 携带 Rust 生成的 schema-validated proposal；TypeScript/Kotlin/Swift 不重算质量维度。
4. 第一版启用任务、三端点、ROM、返回、双侧运动学差和组内漂移；借力与刺激兼容性等人工质量金标具备后再启用。
5. 每条 claim 独立验收 precision/recall/cannot-judge/clean-set false cue，而不是合成一个识别率。

## 7. 主要来源

- [W3C PROV-DM Recommendation](https://www.w3.org/TR/prov-dm/)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [OpenSim: Getting Started with Inverse Dynamics](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics)
- [OpenSim: Working with Static Optimization](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53085189/Working%20with%20Static%20Optimization)
- [Uhlrich et al. 2023, OpenCap](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)
- [Weakley et al. 2020, optical barbell velocity validation](https://pubmed.ncbi.nlm.nih.gov/32459410/)
