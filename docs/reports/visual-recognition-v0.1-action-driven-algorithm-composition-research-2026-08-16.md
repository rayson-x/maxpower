# 视觉识别 v0.1 动作驱动算法组合方案：本地证据研究

日期：2026-08-16  
范围：只审阅本仓库的实现、测试、配置/契约和已生成诊断；未读取原始视频、人工标注或训练数据资产，未进入治理仓库，也未改动既有文件。  
判定口径：`支持`表示可由当前本地一手来源直接复核；`部分支持`表示现象成立但归因或收益尚未被隔离验证；`未证实`表示设计合理但没有量化实证。

## 结论先行

该修复方案的方向大体正确：以 exact action context 驱动、保持 Rust 单一 Rep/质量权威、将缺失证据显式化、把质量放在 `SealedRep` 之后，以及禁止用手腕伪造器械，均与现有产品契约和部分运行时结构相容（`docs/agents/rust-motion-trace-explainer-product-contract.md:17`、`docs/agents/rust-motion-trace-explainer-product-contract.md:46`、`rust/motion-sdk/tests/action_motion_plan_contract.rs:242`）。

不过它不是一份已经被评测证明有效的修复计划。最强的现有证据只证明：在 53 个已回放记录、455 个 Rep 真值的已知参与者/已知视频回归中，最终非拒绝预测仅匹配 16 个 Rep，且 194 个已封存候选中有 163 个被拒绝（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:17`、`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:57`、`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:79`）。它不能证明所提算法在 held-out 用户、设备或真实端上预算下会提升，也不能证明每个拒绝原因都是真实根因。

一个需要先修正的报告术语是：诊断中的 `candidatePrecision`/`candidateRecall` 由 `matched / predicted` 计算（`rust/motion-sdk/tests/execution_assessment_rigid_bar_family_contract.rs:2230`、`rust/motion-sdk/tests/execution_assessment_rigid_bar_family_contract.rs:2263`），而协议将 `confirmed` 与 `needs_review` 作为 counted dispositions（`rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_protocol.json:27`）。因此 51.61% / 3.52% 是 admission 后预测的匹配指标，不是 194 个原始 sealed candidate 的 proposal precision/recall；方案 P0 所要求的分层漏斗是必要的，现有聚合数字却不能代替它。

## 缺陷逐项核验

| 方案中的缺陷/判断 | 判定 | 本地证据与边界 |
| --- | --- | --- |
| 整体 Rep 召回、计数和边界不可用 | 支持 | 诊断记录 16/455 匹配、0/53 exact set、1/455 严格边界对齐、起/止 MAE 700.6/834.1 ms、IoU 0.330（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:48`、`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:57`）。匹配本身的最低条件却允许 IoU ≥0.10 或双端误差 ≤1500 ms，严格指标才是 IoU ≥0.60 且双端 ≤500 ms（`rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_protocol.json:33`），故不能把宽松匹配率解释为边界合格。 |
| 只改 admission 不足；proposal 与 boundary 也需要单列修复 | 支持，但不能量化各层贡献 | 194 个候选面对 455 个真值，数学上的原始候选召回上限为 42.64%；同时 admission 后仅 31 个预测、边界 MAE/IoU 也差（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:60`、`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:79`）。但发布物没有 raw candidate 与真值的逐个重叠匹配，不能归因出 proposal、admission、boundary 分别造成多少 FN。 |
| `ActionPrimaryDirectionMismatch` 是主拒绝问题，且正号检查与分段后端点不一致有关 | 部分支持 | 它确实是 97/163 个拒绝（59.51%）（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:84`）。局部周期校验要求 `turn - start` 为正，否则直接返回该原因（`rust/motion-sdk/src/lib.rs:3039`）；通用稳定周期机也以一个 `direction`、基线、反转迟滞和 ready return 驱动（`rust/motion-sdk/src/lib.rs:4539`、`rust/motion-sdk/src/lib.rs:4688`）。这支持“符号语义可能被过度耦合”的诊断，但没有逐候选标注证明 97 个中哪些是轴符号/端点采样问题、哪些是真实反向运动。 |
| `RequiredJointLoss` 语义过载，应拆分 | 支持“过载”，未证实具体四分类及迁移比例 | 枚举同时存在 `RequiredJointLoss`、`CoordinateProvisional`、`ActionPrimaryUnavailable` 等原因（`rust/motion-sdk/src/lib.rs:1600`），而 transition eligibility 失败直接报告 `RequiredJointLoss`（`rust/motion-sdk/src/lib.rs:4210`）。已有单测还显示中等缺失会 `NeedsReview`、较长缺失才会以该原因 `Rejected`（`rust/motion-sdk/tests/rep_contract.rs:553`）。因此需区分坐标未冻结、临时信号不可用、过渡证据弱和身份关系缺失是合理的；但当前产物没有按这些子因子重放统计，无法估计拆分后 FP、FN 与 disposition 的变化。 |
| 现有 view projection 没有真正表达机位可观察性 | 支持 | `project_definition` 仅按 operator 是否存在决定 `observable`，没有读取可见 relation、遮挡、禁止信号或侧别可见性（`rust/motion-sdk/src/action_motion.rs:722`）。当前编译器还会把所有 required identity relation 变为 `RequiredForRep`（`rust/motion-sdk/src/action_motion.rs:673`），并且完整动作库测试要求每叶动作的八个 view 都能编译（`rust/motion-sdk/tests/action_motion_plan_contract.rs:192`）。这与“不可见关系不应成为 RequiredForRep”的修复目标直接吻合。 |
| 所有动作共用往返状态机不够 | 支持 | 当前核心 phase 是固定的 `Ready → Effort → Peak → Return`（`rust/motion-sdk/src/lib.rs:1271`），通用 profile 驱动 stable cycle；README 也明确称 `ExerciseProfile` 配置 generic multi-joint state machine（`rust/motion-sdk/README.md:8`）。已有 `RepConsensusMode` 可以区分 shared/bilateral/unilateral/alternating（`rust/motion-sdk/src/action_motion.rs:315`），但没有 `hold_interval`、locomotion 或 multi-stage topology 的可执行选择器。 |
| 器械路径的主要瓶颈不是 tracker 帧率，而是关联/进入 canonical channel/consensus | 部分支持 | 诊断有约 29.7 Hz 视觉处理、30,520 tracker 输出帧、仅 1,289 local equipment channel 帧、0 rigid-bar rep（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:245`）。代码只在 `GripEstablished` 时设 `judgeable_path`（`rust/motion-sdk/src/equipment_fusion.rs:409`），且 admission 要求非 predicted、已握持建立、达到最少帧数的 track（`rust/motion-sdk/src/lib.rs:2925`、`rust/motion-sdk/src/lib.rs:2954`）。这支持关联与准入是直接阻塞点；但分量 Hz 不是端到端 p95/p99、CPU/GPU、内存或 thermal，不能证明“性能不是瓶颈”。 |
| person YOLOX 不能当成器械 detector | 支持 | v0.1 融合契约写明 `yolox-nano-humanart` 只检测人物，Android/iOS live adapter 当前提交空器械列表（`docs/design/rust-pose-equipment-fusion-contract-v0.1.md:68`、`docs/design/rust-pose-equipment-fusion-contract-v0.1.md:72`）；SDK README 同样声明没有已训练的设备端器械 detector（`rust/motion-sdk/README.md:36`）。Provider seam 已存在，且禁止由 pose 制造器械（`rust/motion-sdk/src/equipment_provider.rs:1`），但这不是 detector 准确率证据。 |
| 质量能力当前不能视为可用 | 支持 | 53 个记录中 Phase、Support、Bilateral、Trajectory、StandardVariant 五维都是 `CannotJudge`，诊断明确给出 `not_evaluable_no_human_quality_truth`（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:267`、`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:282`）。运行时的 feature 缺失会逐维降为 `CannotJudge`（`rust/motion-sdk/src/execution_assessment_engine.rs:4598`），符合产品契约的拒绝原则（`docs/agents/rust-motion-trace-explainer-product-contract.md:68`）。 |

## 对拟议算法的技术判断

### 可采用，但须收敛为可验证合同

- **编译后的 action×view 分析计划：有效且与现状连续。** 现有 `ActionMotionCompiler` 已校验定义、view、operator 输入类型和 identity source，输出带 `plan_hash` 的 `ActionObservationPlan`（`rust/motion-sdk/src/action_motion.rs:600`、`rust/motion-sdk/src/action_motion.rs:816`）；安装时 profile identity 也绑定 plan hash（`rust/motion-sdk/src/lib.rs:6177`）。扩展为 module registry、provider requirement、topology、rule-pack 和 plan refusal 是合理的。应避免把“资产全部可编译”误作“已验证可发布”：结构性编译测试覆盖 248×8 context（`rust/motion-sdk/tests/action_motion_plan_contract.rs:192`），而 v0.1 诊断只覆盖 24 个绑定/53 条回放记录（`rust/motion-sdk/tests/action_motion_plan_contract.rs:79`、`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:17`）。

- **静态适用性与动态可判定性分开：有效。** 现有 relation judgeability 只有 `RequiredForRep` 与 `DimensionScopedCannotJudge` 两档（`rust/motion-sdk/src/action_motion.rs:385`），不足以表达 proposed 的 `Applicable/NotApplicable/Invalid`、`RequiredForPlan/Rep/Dimension/Optional`。加入这两个正交维度可防止不可见 relation 误伤 Rep，也能保留缺失原因；但必须使 compile 阶段实际使用 view-observability 资产，而非继续仅验证 operator 注册。

- **按 topology 选择 Rep executor：有效，且是对当前泛化状态机的必要扩展。** 对往返动作保留“起点—反转—返回”校验并采用固定短缓冲的因果精修是可行的；`SealedRep` 已分离 peak timestamp 和 later confirmation timestamp（`rust/motion-sdk/src/lib.rs:1550`），provenance 也拒绝未来端点（`rust/motion-sdk/src/execution_assessment_engine.rs:3499`）。但单臂、交替、hold、步态和多阶段 executor 必须各有 synthetic contract test 与真实 action×view 回放，不能只把名字写入 assets。

- **将质量严格置于 sealed Rep 后：有效。** assessment 在收到 rep 后才计算 features/rules（`rust/motion-sdk/src/execution_assessment_engine.rs:1884`），而 `SealedRep` 的端点与 hash 都是明确的（`rust/motion-sdk/src/lib.rs:1550`）。应保留这个单向性，并增加“质量规则不能改变 Rep”回归测试。

- **独立器械 detector + measured-only lineage：技术上合理但尚未实证。** 当前 registry 的边界正是每帧原始观察、下游 Rust 关联和裁决（`rust/motion-sdk/src/equipment_provider.rs:69`、`rust/motion-sdk/src/equipment_provider.rs:123`），并已拒绝 predicted track 进入 consensus（`rust/motion-sdk/src/lib.rs:2925`）。因此可接入独立 detector/causal tracker；前提是新增类别、bbox/axis/track/grip 真值和端上预算，而不能把 tracker 输出次数当检测能力。

### 需要修改或降级的表述

- “方向校验改为无符号拓扑”不可无条件替代动作语义。对确有固定努力方向的动作，应让 action asset 声明 expected sign；对镜像或局部轴符号可变的 context，才使用 sign-invariant 的 departure/turnaround/return。不然会把真实反向或错误动作提升为 candidate。方案自身已提出这两种路径，应把它们变成 mutually exclusive 的资产字段与消融测试。

- “完整候选都应保留为 candidate”只适用于 raw proposal 输出；它不能绕开 set 内时序、主体变更、长连续性丢失和明确 equipment conflict。当前实现本来会对长 gap 产生 `LongContinuityLoss`（`rust/motion-sdk/src/lib.rs:4217`），这些拒绝不应被一概迁移成 `NeedsReview`。

- “吞吐足够”应改为“该诊断未显示 tracker 输出频率低”。Web/Android/iOS 的物理设备性能、热、throttle 与参与者准确率仍被 SDK README 明确标为未测量（`rust/motion-sdk/README.md:36`）。

## 缺失的可测证据与最低补齐项

1. **分层漏斗与根因归因。** 每个 action×view 输出 raw proposal、admission disposition、与人工 Rep 的 overlap、FP/FN、拒绝子原因和负窗口触发；当前 JSON 仅发布 `byAction`，没有 `byActionView`（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:123`）。
2. **隔离消融。** 对 sign policy、`RequiredJointLoss` 分类、view plan、provider/association、boundary buffer 分别在同一冻结输入上报告 matched、FP、reviewed-negative false trigger、Confirmed↔NeedsReview 迁移及每 context 净变化。当前前后对比只有 +1 matched、0 FP，但终点 MAE 与 IoU 变差（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:67`）。
3. **独立泛化。** 协议将评测明确为 known-participant/known-video 且 `generalizationClaimAllowed=false`（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:4`）；需要在按用户、源视频和设备隔离的 held-out 集上冻结一次最终评价，并报告置信区间。
4. **器械真值。** 需要 class detection PR/F1、bbox/axis PCK、track coverage、identity switch、grip/subject association、turnaround 误差与 hard-negative FP；这正是融合契约规定的停止条件（`docs/design/rust-pose-equipment-fusion-contract-v0.1.md:76`）。
5. **质量真值。** 每个启用 action×view×dimension 需要逐 Rep 人工标签、标注者一致率、agreement/F1、coverage 与 CannotJudge rate；当前协议明确禁止 technique-quality accuracy claim（`rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_protocol.json:61`）。
6. **端上性能。** 在 Web、Android、iOS 的目标设备上，按 pose、equipment detector、tracker、fusion、Rep 和 end-to-end 分别报告 p50/p95/p99 latency/age、FPS/drop、峰值内存与 thermal/throttle；目前只有组件频率，不能验证方案的 15 FPS、热稳态或第二模型不挤占 deadline 的目标。
7. **可复现实验边界。** 已生成诊断声明重复运行 core result 相同（`docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json:7`），但生成该结果的 governed replay test 被标为 ignore 且依赖本地私有 Halpe26 资产（`rust/motion-sdk/tests/execution_assessment_rigid_bar_family_contract.rs:2321`）。本次未运行它；后续应在授权的治理流程中复跑并将输入、代码 revision、资产 hash、输出 hash 一并冻结。

## 建议的实施验收顺序

先实施 P0，但把指标名纠正为 `rawProposal*`、`admittedPrediction*` 与 `boundary*`；随后只选择一个已有非零回放信号的 action×view 做 P1 的 sign/admission 消融。达到预先冻结的 precision、负窗口和边界不回归门槛后，再扩展 topology 与 view plan。器械 detector 和质量维度应各自保持独立验收，不应作为提高总体 Rep 数字的未经验证旁路。
