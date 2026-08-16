Status: implemented-with-explicit-data-blocked-followups

# Rust 视觉识别 v0.1b：动作驱动算法组合与召回优化

> Last aligned: 2026-08-16
>
> 本规格是 Rust Motion SDK 的 v0.1b 识别优化切片。它承接已完成的动作专项语义、局部坐标、器械 Provider seam、Rep/质量 Trace 和全动作资产安装能力；只改进动作识别的候选生成、准入、边界与证据组合，不引入客户端实现、后台审核或 SDK 内部能力分级。

## Problem Statement

用户已经选择训练动作并提交视频，但当前 Rust 运行时不能可靠地输出 Rep 次数和后续质量解释。已冻结的 known-video 回放覆盖 53 组视频、455 个人工 Rep 和 237 个已复核负窗口；现有 admitted prediction 的 Precision 为 51.61%、Recall 为 3.52%，没有一组次数完全正确。

问题不只是质量规则尚未校准。运行时已经封存 194 个 Rep candidate，却拒绝了 163 个。`ActionPrimaryDirectionMismatch`、过载的 `RequiredJointLoss` 和 `EquipmentConsensusUnavailable` 把候选、动作身份、局部坐标暂态和器械证据不足混入同一条事后准入路径。与此同时，候选分段仍使用通用局部周期参数，`ActionMotionDefinition` 的动作语义尚未完整地下沉为 RepEngine 的真实运行时拓扑。

这使用户遇到两种同样不可接受的结果：真实完整动作没有被计数；或系统为了恢复计数而把手腕、预测轨迹、屏幕坐标方向或无关身体运动伪装成器械和动作主关系。用户需要的是：在所选 exact action context 下，以真实关节、身体关系和适用器械轨迹识别 Rep，保留不确定性，并在 Rep 完成后形成可解释的整组质量报告。

## Solution

Rust 在 set 开始前将已选择的 exact action context 编译为一份冻结的 `CompiledActionAnalysisPlan`。该计划由 `ActionMotionDefinition`、`ViewObservationPlan`、可用 Provider 和版本化资产共同生成，并直接配置唯一的 RepEngine，而不是让通用 RepEngine 先计数、再由动作计划事后否决。

计划选择可复用的 Rep topology、主关系、局部坐标策略、候选阈值、方向策略、证据依赖、admission 转移、边界精修和后续质量程序。动作资产决定“理解什么”；机位资产只决定“在该投影下能够观察什么”；Provider 只提供独立的 frame-local observation；Rust 保持 Canonical packet、Rep、phase、质量结论和因果 Trace 的唯一权威。

本轮的唯一高层运行时 seam 是一个由 Rust 所有的 set session：先编译上下文，再开始 set、处理帧并完成 set。Web、Android 和 iOS 只提交已选择的上下文和帧流，不能拼装算法、修改阈值、补全器械、重分段 Rep 或生成第二套质量解释。

资产安装仍是 SDK 的能力 seam：所有结构完整的动作资产进入相同的生命周期；Rust 不保存 reviewed/unreviewed、validated/unvalidated、可发布/未发布或准确率成熟度。静态的定义错误使安装原子失败；当前组中缺失、遮挡、冲突或暂态不足的观测只影响本次 candidate、Rep 或质量维度。

## User Stories

1. As a 训练用户, I want 系统按我选择的 exact action context 理解动作, so that 相似名称、器械或姿态不会借用错误的计次逻辑。
2. As a 训练用户, I want 每个完整往返动作依据离开、换向和返回来识别, so that 摄像头坐标正负号不会把正确动作拒绝成反方向。
3. As a 训练用户, I want 单侧、双侧同步、双独立负载、交替、保持和多阶段动作使用不同拓扑, so that 所有动作不会被压成同一种往返周期。
4. As a 训练用户, I want 系统把可疑但有界的完整候选显示为 needs-review 而不是静默丢失, so that 我能区分未计数与完全没观察到。
5. As a 训练用户, I want 缺失必要动作关系、明确冲突或不完整周期被明确拒绝, so that 正式训练量不会由不可靠动作虚增。
6. As a 训练用户, I want 临时坐标未冻结、短时信号丢失和转换证据较弱被解释为不同原因, so that `RequiredJointLoss` 不会掩盖真实问题。
7. As a 训练用户, I want 杠铃、哑铃和机器把手只由独立视觉器械 observation 证明, so that 手腕、手臂或预测线不会冒充器械。
8. As a 训练用户, I want 手腕仅参与主体归属和握持关联, so that 真实器械在接触前不会被错误地绑定到我身上。
9. As a 训练用户, I want 真实器械被遮挡时看到 evidence 不足或 conflict, so that 系统不会用手腕生成伪杠铃轨迹。
10. As a 训练用户, I want 已确认 Rep 的开始、换向、返回和确认时间可以被解释, so that 我能理解次数和阶段结论如何得出。
11. As a 训练用户, I want 边界精修只使用当前和过去帧, so that 直播与回放不会出现两套不同的 Rep 事实。
12. As a 训练用户, I want 质量结论只在 Rep 封存后计算, so that 质量不确定性不会移动、删除或伪造我的 Rep。
13. As a 训练用户, I want 缺少质量证据的维度明确显示 `CannotJudge`, so that 没有结论不会被误解为动作合格。
14. As a Rust SDK 使用方, I want 通过一个 Rust-owned set session 编译上下文、开始训练、处理帧并结束训练, so that 客户端无需了解内部 topology 或规则。
15. As a Rust SDK 使用方, I want 动作、变式、器械拓扑、侧别、机位和 pose contract 在 set 前冻结, so that 中途变化不会混入同一个 Rep 生命周期。
16. As a Rust SDK 使用方, I want 选择的 context 缺少结构必要资产时收到 typed plan refusal, so that 我不会以不完整合同开始训练。
17. As a Rust SDK 使用方, I want 当前帧没有可靠器械 observation 时得到运行时证据结果而非动作成熟度状态, so that SDK 不会把一次遮挡当成动作永久不支持。
18. As a 动作资产维护者, I want 新动作只通过定义、view observation、topology 参数和规则资产扩展, so that 增加动作不需要增加 action-name 分支。
19. As a 动作资产维护者, I want 每个 exact view 明确可观察、禁止和仅限质量维度的关系, so that 2D 中可计算不等于当前机位可用于动作身份。
20. As a 动作资产维护者, I want 一个事实有明确生产者、provenance、时钟、最大年龄和冲突策略, so that 编译出的依赖图是确定的而不是多个模块隐式竞争。
21. As a Rust SDK 维护者, I want `ActionMotionDefinition` 编译为实际的 runtime segmentation profile, so that 动作语义在 candidate proposal 前就约束 RepEngine。
22. As a Rust SDK 维护者, I want 方向策略显式区分 sign-invariant 拓扑和固定起始方向, so that 反向动作不会因放松正负号判断而被错误确认。
23. As a Rust SDK 维护者, I want candidate 和 admission 各自输出原因与 metrics, so that 修复一个门槛时不会把 proposal 缺失误报为 admission 改善。
24. As a 数据评估者, I want 每个 action×view 分别报告 raw proposal、confirmed-only、confirmed-plus-review、FP、FN、拒绝原因和边界指标, so that aggregate 改善不能掩盖特定动作退化。
25. As a 数据评估者, I want rejected candidates 与人工 Rep 做固定的一对一时间重叠归因, so that “方向不匹配”能够被证据证实或推翻。
26. As a 数据评估者, I want 每次单因子修改在同一冻结协议下重复回放, so that Precision、Recall 和负窗口变化可归因且可复现。
27. As a 产品负责人, I want 所有已安装动作都使用同一资产驱动生命周期, so that 全动作目录的扩展不依赖 SDK 内部验证等级。
28. As a 产品负责人, I want 真正的检测准确率、训练标签、held-out 评估和发布决策留在 Rust SDK 外, so that 运行时只执行给定资产而不携带后台治理职责。
29. As a 端上性能负责人, I want pose、器械 detection、tracker、融合和 Rep 都报告端到端延迟与证据年龄, so that 器械模块不会通过降低 Rep 可靠性来换取表面 FPS。
30. As a 质量规则维护者, I want v0.1b 保持完整因果 Trace 和维度级 `CannotJudge`, so that 后续获得人工质量真值时可以只交付规则资产而不重写识别生命周期。

## Implementation Decisions

- `CompiledActionAnalysisPlan` 是 set 前冻结的内部计划，至少包含完整 context key、definition/view lineage、module graph、provider requirements、local-coordinate plan、`RepTopologySpec`、admission policy、relation program、post-seal feature program、RulePack、set aggregation policy 和 plan hash。
- exact action context 固定包括 action、variation、equipment topology、laterality、camera view 和 pose contract。上下文解析只接受调用方已选择的动作和声明的捕获信息；Rust 不做开放集动作分类，也不通过画面猜测替换该选择。两个 action 可以复用同一通用 topology/operator program；`TaskCompletion` 只证明该资产声明为 required 的可观察任务关系完成，未被 relation 独立观测的握法、支撑、朝向或器械差异必须保留为受限声明，不能被解释为 Rust 已重新识别并验证动作身份。
- Rust 的高层运行时使用一个会话生命周期：`compile` 产生计划或 typed plan refusal；`begin_set` 冻结该计划；`process` 只接受该计划下的 frame observations；`finish_set` 封存唯一的 canonical output。任何 context、Provider contract、pose contract 或 plan hash 的变化都要求新 set。
- `ActionMotionDefinition` 是动作语义唯一权威。编译器必须把 TaskPrimary、主轨迹来源、rep boundary、phase 语义、rep consensus、topology 和方向策略物化为 RepEngine 使用的 runtime segmentation profile；仅把 plan hash 写入 profile identity，或在 SealedRep 后附加动作验证，不满足本规格。
- `RepTopologySpec` 是动作资产选择的通用执行器配置，而不是动作名称分支。v0.1b 至少支持 bilateral synchronous、independent bilateral、unilateral、alternating、pose primary、hold interval、locomotion step 和 multi-stage topology；未选择的 topology 不运行。
- 往返 topology 默认采用 sign-invariant 的 departure-turnaround-return 验证：行程必须超过 action-local 最小行程与合并不确定度，出程和回程必须方向相反，回归误差必须小于 action-local 容忍度与合并不确定度。只有动作定义显式声明起始状态和方向时，才允许固定 expected sign；屏幕 X/Y 或镜像状态不得隐式决定动作身份。
- Candidate proposal 追求完整周期召回，允许保留弱但有界的候选；它不得将 predicted、Unknown、另一个人的 landmark、手腕桥接或不属于当前动作定义的 relation 作为 start、turnaround 或 end 证据。
- Admission 明确拆分 `CoordinateNotFrozen`、`SignalTemporarilyUnavailable`、`TransitionEvidenceWeak`、`IdentityRelationMissing`、`EquipmentConsensusUnavailable`、`EquipmentConsensusConflict`、`IncompleteCycle` 和连续性原因。前 3 类只有在周期完整、缺失时长有界且没有身份冲突时才可进入 NeedsReview；Confirmed 是唯一进入正式训练量的 Rep。
- `RequiredForPlan` 只表示结构性依赖：资产、模块、schema、事实生产者或类型不闭合。Provider 没有在当前帧产生 observation、器械被遮挡或动态关联不足属于运行时 evidence 状态，而不是 SDK 内的动作能力或发布等级。
- `ViewObservationPlan` 是版本化资产，声明 relation visibility、禁止信号、遮挡风险、side/equipment/support observability、动作主锚点、局部轴方向和维度可用性。RepEngine 必须消费资产选中的髋、踝、单侧腕或器械主轨迹，不能因为都是 pose-primary 就统一改成肩中点/腕中点。无法在该 declared view 表达 identity-defining relation 时，Rust 产生语义明确的 context refusal；这不是 reviewed/unreviewed 或 accuracy-maturity 状态。
- `AlgorithmModuleDescriptor` 必须声明输入、输出、provenance、最大因果年龄、缺失策略、冲突策略、参数 schema、延迟预算和允许结论。每个 required fact 必须恰有一个 producer，或有显式的 typed merge/conflict rule；模块图必须无环并可由 plan hash 完整复现。
- 真实器械 observation 保持 detector、tracker/geometry、prediction 和 display estimate 的独立 provenance。预测和 display estimate 永远不是 judgeable equipment；手腕只能约束 subject/hand/grip association，不能产生 raw geometry、track identity、视觉长度或 Rep eligibility。
- Provider 的 Rust seam 保持一个 registry。barbell、dumbbell 和 machine-handle 的真实 detector/tracker 可以独立演进，但输出必须先进入同一 `EquipmentObservation → EquipmentFusionEngine → local coordinate → Rep topology` 链路。装备为 TaskPrimary 时缺失/冲突必须阻断 ConfirmedRep；装备只作佐证时，Provider 仍可由 Rust 自动选中，但不能劫持 pose-primary candidate。光流或几何 tracker 是否可作为 judgeable observation必须由其可追溯视觉来源、TTL、uncertainty、连续性和 association 合同明确决定，不能借用 `Predicted` 以外的宽松分类。
- 肩外旋和阿诺德推举使用版本化 `projected_shoulder_rotation`：计算肩—肘—腕方向相对躯干轴的二维有符号旋转，并要求离开、反转、返回。Arnold press 还必须由 `relative_vertical_offset` 证明手腕相对肩部的可见过顶位移在旋转换向附近成立，不能把肘角变化或普通肩推当成等价身份。两项都只是二维动作阶段/Rep 证据，不是真实三维肱骨轴角、肩胛运动或伤病判断；投影塌缩的 side view 保持 exact-context refusal。
- 史密斯动作的 `constrained_path_deviation` 必须读取独立测得的器械通道，并由 exact action×view 的 `maximumConstrainedPathDeviationMilli` 限制整次 Rep 的可见横轴跨度；它不恢复真实导轨几何，缺失或越界不能由骨架修补。
- 方向、坐标、signal 和 equipment 的动态拒绝都必须保留事实级子原因、时间范围、source lineage 和反事实可解释信息。Trace 只能连接实际被执行和读取的输入，不能用装饰性节点补齐线性链。
- 边界精修使用固定上限环形缓冲。turnaround 的 event timestamp 与更晚的 confirmation timestamp 分开保留；只能回看已经到达的因果缓冲。没有足够证据时不精修，质量模块也不得移动或删除 SealedRep。
- 后续质量继续只消费 SealedRep、relation facts 和 reference policy。没有人工真值和 calibrated RulePack 的质量维度保持 `CannotJudge` 或 `NotApplicable`；本轮不得以计次优化为理由发布质量正确性声明。
- 全部 accuracy evaluation、人工真值、训练数据、发布审核、灰度策略和动作开放决策仍在 SDK 外完成。离线流程可交付有 lineage/hash 的 action/view 资产与质量规则包，Rust 只做原子一致性验证。

## Testing Decisions

- 最高测试 seam 是 Rust-owned set session：给定同一 selected context、安装资产和 frame observation 流，测试其 `CanonicalMotionOutput`、Rep disposition、边界、dimension conclusion 和 Trace；测试不依赖客户端重算或私有实现状态。
- v0.1b 首先建立 action×view 漏斗评测。每个 context 都分别输出 raw proposal、confirmed-only、confirmed-plus-review、FP、FN、rejected-candidate overlap、reason、start/turn/end MAE、P95、IoU、exact-set rate 和 reviewed-negative-window false trigger。
- raw proposal、Confirmed 和 NeedsReview 使用稳定的一对一人工 Rep 匹配规则；同一预测不能同时匹配多个真值 Rep，rejected candidate 的重叠结果必须保留为聚合可审计诊断。
- 每次算法变更只改变一个 topology、direction、admission、Provider 或边界因素，并在同一协议、输入哈希、负窗口和匹配器下重复回放。已知视频只用于回归和诊断；调参后不可将同一数据称为 held-out 或泛化结果。
- Context compile 合同测试验证：结构不完整资产原子失败；identity-defining relation 在 declared view 不可表达时返回 typed refusal；未生产的 RulePack fact、多个无合并规则 producer、错误 provider/schema/plan lineage 都不能启动 set。
- Runtime 合同测试验证：计划与 runtime segmentation profile 的 action semantics 完全一致；故意替换为不同 topology、主关系、方向或边界 profile 时不得启动或不得封存 ConfirmedRep；不能只凭相同 plan hash 通过。
- Topology 测试验证每一种通用 topology 可以由兼容资产驱动，而非按 action name 选择；镜像、前后机位和局部轴反号的同一 sign-invariant 往返动作应保持同样 Rep 结果，真实违反已声明固定方向/起始状态的动作必须被拒绝。
- Admission 测试验证 CoordinateNotFrozen、短时 signal 缺失、transition evidence 弱、identity relation 缺失、设备共识不足、设备冲突和周期不完整分别产生规定 disposition；OptionalCorroboration 和 RequiredForDimension 的缺失不得反向否决 identity-complete Rep。
- Equipment 测试验证 detector raw geometry 与 wrist 输入独立；接触前、背景杆、握持建立、释放、短时遮挡、association conflict、视觉 track 丢失和 pose bridge 都不会生成伪器械 Rep。测试还验证 tracker provenance/TTL 不会把过期或预测 observation 变为 judgeable equipment。
- Causality 测试截断未来帧：Rep 的事件边界只能使用当时或更早证据；confirmation 可以较晚，但不得改写已发布的 SealedRep。质量模块不得创建、移动或删除 Rep。
- 性能测试分别报告 pose input、equipment detection、tracker output、local channel、fusion 和 canonical Rep 的帧率、evidence age、p50/p95/p99 延迟、drop、内存和热稳态。器械 tracker 的高输出频率不得掩盖 pose/Rep 输入频率不足。
- 质量回归测试保留当前维度级 Trace、`CannotJudge` 和无质量真值时的不宣称准确率行为。任何恢复 Rep Recall 的修改都不得通过删除质量证据、隐藏 conflict 或把 NeedsReview 计入正式训练量达成。

## Out of Scope

- Web、Android 或 iOS 的页面、相机 UI、视频上传、数据留存授权和后端审核/发布流程。
- 开放集动作分类、从自由视频自动选择动作、变式、器械或机位。
- 将单目 RGB 解释为真实 3D、力、关节力矩、肌肉激活、伤病风险或疲劳原因。
- 将 MIA、MuscleMap、OpenCap、OpenSim、Nimble 或其他非实时大优化器接入实时核心。
- 静默在线学习、运行时阈值自我校准、自动晋升动作资产或 SDK 内部成熟度状态。
- 没有训练权重、人工器械真值与端上预算证据时宣称 barbell/dumbbell/machine detector 已完成或准确。
- 在尚无逐 Rep、逐维度人工质量真值前宣布 Phase、Trajectory、Stability、Bilateral 或 Substitution 的质量准确率。
- 修改既有 v0.1 冻结回放结果、原始视频、canonical packet、人工标注或历史报告；每次优化产生新的不可变分析版本。

## Further Notes

- 修复前的 51.61% Precision / 3.52% Recall 是旧诊断中的 Confirmed 与 NeedsReview 合并 admission 指标，不是 raw proposal 指标；NeedsReview 增长不能当作正式训练量或产品计次改善。
- 修复前 194 个 raw candidate 面对 455 个人工 Rep，即使 admission 全部正确，Recall 上限也仅为 42.64%。最终 v0.1b 回放只形成 51 个 raw candidate，说明资产驱动语义基座已经替换旧路径，但候选恢复仍未完成，不能只放宽拒绝门槛。
- 2026-08-16 action-driven 固定实现的受治理回放已经完成：51 个 raw candidate（23 matched，Precision 45.10%、Recall 5.05%）、10 Confirmed、7 NeedsReview、34 Rejected；Confirmed+NeedsReview Precision 64.71%、Recall 2.42%，exact-set 0%。这证明语义/Trace 基座已运行，但 candidate 恢复未完成；数值结果是 failed acceptance，不能被“248 个动作资产可安装”覆盖。
- 同一回放中 local coordinate 只有 3,648/15,879 帧 Frozen，8,200 帧 Uninitialized；剩余识别恢复集中到 Ticket 15，依赖与最终评估隔离的 action×view calibration 数据和预先冻结的产品通过线。不得继续用当前 53 组评测视频选择阈值后再声称无偏改善。
- 当前方向拒绝、关节丢失和器械共识分布是聚合症状，不是已证实的逐 context 根因。P0 必须先完成 action×view、candidate×truth overlap 和事实子原因归因，再按单因子实施。
- 当前已安装动作资产都进入同一 Rust lifecycle；本规格中的 typed refusal 仅用于 malformed assets 或所选 exact visual context 无法表达 identity-defining relation，绝不能演变为 SDK 内部“未验证动作/未开放动作”的长期名单。
- 最终验收需要在新的 participant、source、session、device 和 view 隔离的 held-out 数据上同时验证 Rep count、边界、负窗口、端上性能和已启用质量维度。known-video 回放仍是回归诊断，不是泛化率。
