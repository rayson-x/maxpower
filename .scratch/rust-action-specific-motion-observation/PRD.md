Status: ready-for-agent

# Rust 动作专项关节、轨迹与细粒度动作身份规格

> Last aligned: 2026-08-15
>
> 本规格实现 Rust motion understanding 产品契约中的全动作扩展切片。当前轮只建设 Rust SDK 的动作语义、机位投影、动作观测计划和可解释质量能力，不包含客户端产品接入。

## Problem Statement

用户需要 MaxPower 理解所选择的训练动作，而不是使用手腕高度或一套固定的全身关节角去处理所有动作。杠铃划船、硬拉、卧推、深蹲、侧平举、推肩和固定器械动作虽然都包含周期运动，但它们的主运动关节、器械轨迹、代偿部位、阶段语义和允许结论并不相同。

当前 Rust 已能输出统一的肘、肩、髋和膝二维投影角，也已有 Canonical packet、动作局部坐标、器械融合、Rep、Feature、Rule、整组聚合和 Trace 基础。但固定八个诊断角度还不能表达动作专项的任意关节关系、躯干与骨盆关系、踝部运动、器械相对人体轨迹，也没有一个统一机制从已知动作决定本次真正需要计算的点位与轨迹。

当前动作目录也存在过宽身份：坐姿与站姿、自由杠铃与史密斯、杠铃与哑铃、自由重量与固定器械、联动双臂与独立双臂、平板与上斜/下斜可能共用一个父动作或模糊 equipment 字段。它们会改变主轨迹、支撑锚点、左右规则、可用代偿和参考走廊，不能共享一个完整识别与质量契约。

当前刚体杠视觉链还把“画面中存在一条可能的杠轴”“该杠轴属于锁定主体”“双手已经建立握持”“该轨迹可以参与 Rep”压缩成近似的单帧双腕距离判断。双腕附近的横线可能在手尚未接触杠铃时就成为 `Measured`、`held_by=Both` 和 Rep 换向可用证据；反过来，手腕搜索窗口、候选评分和发布长度也可能过度支配视觉杠轴。这既会把背景横杆或架上杠错误关联给用户，也会让准备、接近和离杠动作产生额外 Rep。

如果继续按宽泛动作名或固定信号实现，会产生以下用户问题：

- Rep 可能被一个与动作任务无关的手腕周期触发；
- 划船中的髋伸借力可能被当作正常动作，而硬拉中的髋伸又可能被错误视为代偿；
- 杠铃刚体、左右哑铃和固定器械手柄可能被错误地当作同一种器械轨迹；
- 当前机位看不到关键运动时，系统可能改用无关证据继续给出肯定结论；
- 一个动作名称存在于目录中，却没有可解释、可验证的 Rep 和质量能力；
- 用户只能看到一个不透明总分，无法知道系统计算了哪些关节、轨迹和规则。

## Solution

第一步先扩展并冻结细粒度动作目录。系统把现实中计算方式不同的动作拆成独立 exact exercise variant，包括姿态、支撑方式、器械拓扑、路径约束、单双侧、凳面角度、杠位和站距等会改变计算图的条件。宽泛父动作只用于浏览或归类，不能直接承载完整识别和质量契约。

本轮器械观测能力只实现三类 Adapter：刚体杠、一个或两个独立哑铃、固定器械的用户接触把手。刚体杠 Adapter 同时服务自由杠铃与史密斯杠，复用杠轴、中心和端点追踪；史密斯仍是独立 exact identity，并额外声明导轨约束，不能复用自由杠铃的质量规则或参考走廊。固定器械把手可以是联动双侧、独立双侧或单侧，但本轮只追踪用户实际握持并运动的把手，不推断整台机器的隐藏连杆、配重或力学状态。绳索/滑轮/绳头、地雷管/T 杠支点、陷阱杠、壶铃、弹力带以及其他器械拓扑本轮不建设识别 Adapter。

器械视觉检测、主体归属、接触/握持和 Rep 资格是四个独立阶段。Adapter 可以在用户接触前保留一根真实杠轴作为未归属 raw observation，但手腕只能为主体关联和握持状态提供证据，不能生成 `Measured` 器械几何、替代视觉长度或仅凭单帧距离建立握持。只有经过持续接触、稳定相对距离、人体—器械共同运动和释放迟滞验证的 track，才能从 `unassociated/contact_candidate` 晋升为 `grip_established` 并参与融合、换向和 Rep；释放或证据冲突后必须退出 Rep 资格。短时遮挡可以在既有 track identity 上保留明确的 continuity evidence，但手腕桥接和预测永远不能重新建立器械身份、握持或 `Measured` provenance。

刚体杠的 raw geometry 必须由当前视频帧中的真实视觉证据独立产生。动作/人体可以限定宽松 ROI、排除其他人物和验证候选，但 detector 不得以双腕连线作为候选轴、要求横线必须穿过双腕、按双腕截断视觉长度，或在没有视觉 shaft evidence 时把 pose bridge 放进 raw equipment channel。输出明确区分 `VisualMeasuredSegment`、`TrackPrediction` 和 `PoseBridgeDisplayEstimate`；后两者不是杠铃识别，只能保持界面连续性。单目画面只报告当前可见轴段和不确定度，不把握距扩展线声称为真实杠铃全长。

不受支持的器械变式仍必须保留独立叶级身份和完整动作定义，以防止错误复用。若器械本身是 identity-defining required primary，则返回强类型 `UnsupportedEquipmentTopology`、保持 `catalog-only`，不进入计划编译。若完整动作定义明确存在不依赖器械几何、足以确认动作身份与 Rep 的人体 required motion，则可以编译受限的 pose-supported 计划；它不得生成器械轨迹、人体—器械协同或器械支持的质量结论，对这些维度输出带原因的 `cannot_judge`，并且不得计入 supported-equipment coverage。徒手或无需器械主轨迹的动作不属于器械识别范围，其能否执行只由骨架 Feature 与机位能力决定。

第二步才为每个已经确定的细粒度动作身份建立与机位无关的 `ActionMotionDefinition`，分别声明该动作的主运动关节、主人体/器械轨迹、Rep/阶段语义、稳定线段、代偿约束、左右关系和器械角色。关节与轨迹从 exact action 派生，不能先定义一套通用关节轨迹再通过器械或姿态参数修补。

Rust 在第一帧前接收已知的 exact exercise variant，而不是从自由运动猜动作。只有成功解析到支持的细粒度身份后，才能继续建立动作观测与评估计划。

Rust 随后根据 exact camera view 解析 `ViewProjectionPlan`，把动作语义转换为当前画面可计算的二维投影角、局部轴轨迹和可观察性门控。机位只决定如何测量及是否能测量，不改变关节在动作中的语义角色。

编译器必须先确认当前 Feature operators 与 exact camera view 能够表达动作的必要主运动。如果必要主运动依赖当前无法表达的真实三维关系或在该机位必然出平面，则拒绝生成识别计划；不得使用腕部或其他相关但不等价的运动替代。成功计划运行后若实际帧缺少必要主体/器械证据，只能保留缺失/冲突事实并拒绝封存该 Rep，不能回退主信号。如果必要主运动足以识别 Rep，只是非身份定义的次级质量维度不可观察，则仍可生成完整的有限能力计划，并把这些维度预先声明为 `cannot_judge`。

`ActionMotionDefinition` 是 exact exercise variant 唯一的动作语义来源。`ViewProjectionPlan` 只能把这套语义绑定到 exact camera view；编译器再据此生成或验证 `ExecutionContract`、`FeatureProgram`、`RecognitionProfile` 和 RulePack。后四者是受约束的执行资产，不得重新定义冲突的 TaskPrimary、Rep/阶段、稳定、代偿或结论语义。器械 Adapter 只提供观察能力，Reference policy 只提供比较依据，两者也不拥有动作语义。

经过上述生成与一致性验证的执行资产才与动作定义原子封装为内部 `ActionObservationPlan`。客户端仍只配置动作上下文并提交视频帧；它不选择关节、不计算特征，也不拥有第二套 Rep 或质量逻辑。

动作与机位由调用方在首帧前提供；器械拓扑、Adapter、主轨迹和质量维度由 Rust 从受治理的叶级动作身份派生。调用方不额外猜测器械，也不能用运行时画面分类覆盖用户选择的动作身份。

底层 Feature 原语与动作族模板可以复用，但它们只能在动作身份确定后被选入该动作的计算计划。executable Bundle、参考和质量结论始终绑定 exact identity。

Rust 通过动作专项主信号和独立佐证识别 Rep 与阶段，在 Rep 内计算投影角、局部轨迹、端点、ROM、阶段节奏、稳定性、代偿、左右差和人体—器械协同。报告按维度输出 `observed_acceptable`、`observed_deviation`、`cannot_judge` 或 `not_applicable`，并保存从 source observation 到结论的完整推导 Trace。

本规格采用双层基线：动作语义、计划编译、证据状态和因果链以本规格为架构基线；准确率以实现前冻结且受治理的 v11 known-video regression 为数值回归基线。known-video 结果只用于回归诊断，不能用于反复调参后声称 held-out 或跨用户准确率。正式晋升必须使用按 participant、source、session 和 view 隔离的新冻结评估证据。

本规格的研究依据来自《[通过骨架轨迹与关节夹角判断动作质量：研究结论与 MaxPower 设计建议](../../docs/research/2026-08-15-skeleton-trajectory-joint-angle-exercise-quality-assessment.md)》；扩展后的叶级动作、主运动、稳定关系、人体/器械轨迹、Rep 边界和代偿条件以《[MaxPower 扩展动作运动契约](../../docs/research/2026-08-15-expanded-action-motion-definitions.md)》为逐动作定义来源。研究文档保存动作与算法细节；本规格规定哪些内容必须进入 Rust 契约、如何验证以及何时可以对外开放。

## User Stories

1. As a 训练用户, I want 系统根据我选择的具体动作决定要观察的关节和器械, so that 不同动作不会共用错误的识别信号。
2. As a 训练用户, I want 杠铃动作优先使用真实杠铃轨迹而不是手腕替代, so that 遮挡或手腕漂移不会被误当成杠铃运动。
3. As a 训练用户, I want 哑铃动作分别理解左右两个负载, so that 左右不同步和单侧失败不会被一个合并轨迹掩盖。
4. As a 训练用户, I want 固定器械动作理解受约束的手柄或摆臂路径, so that 它不会被当作自由重量动作评价。
5. As a 训练用户, I want 坐姿、站姿、俯卧、仰卧和胸托动作分别处理, so that 支撑方式改变后的代偿规则仍然正确。
6. As a 训练用户, I want 平板、上斜和下斜推举分别处理, so that 动作局部轴和参考路径符合当前凳面变式。
7. As a 训练用户, I want 自由杠铃与史密斯机动作分别处理, so that 固定导轨和自由路径不会共享错误规则。
8. As a 训练用户, I want 杠铃划船把髋和躯干的大幅同相移动识别为代偿, so that 只完成杠铃回拉不会被错误判断为标准动作。
9. As a 训练用户, I want 硬拉把髋伸和膝伸作为主任务, so that 它不会继承划船的代偿语义。
10. As a 训练用户, I want 不同深蹲变式拥有独立的关节协同和负载路径, so that 高杠、低杠、前蹲、史密斯和固定器械深蹲不会共用一个通用标准。
11. As a 训练用户, I want 坐姿杠铃、坐姿哑铃和坐姿固定器械推肩是不同动作, so that 单刚体、双负载和受约束手柄得到正确分析。
12. As a 训练用户, I want 站姿推肩额外观察髋膝和躯干借力, so that 站姿动作不会套用坐姿靠背条件。
13. As a 训练用户, I want 当前系统无法计算阿诺德推举的身份定义旋转时明确拒绝动作评估但保留可见事实, so that 普通肩推轨迹不会被冒充为阿诺德推举 Rep。
14. As a 训练用户, I want 绳索外旋的轴向外旋无法计算时不输出动作 Rep, so that 腕绕肘或手柄移动不会被冒充为肩外旋完成。
15. As a 训练用户, I want 腿弯举区分坐姿、俯卧和站姿单腿版本, so that 踝部轨迹和骨盆锚点符合实际动作。
16. As a 训练用户, I want 提踵区分站姿、坐姿、腿举机和单腿版本, so that 膝部稳定与身体/负载轨迹得到正确解释。
17. As a 训练用户, I want 单侧、双侧同步和交替动作分别计次, so that 一侧完整周期不会依赖另一侧按固定顺序运动。
18. As a 训练用户, I want 每个 Rep 显示完成度、端点、阶段、轨迹、稳定和左右关系, so that 我能理解质量结论的具体来源。
19. As a 训练用户, I want 整组报告识别后程 ROM 下降、节奏变化和代偿增加, so that 质量退化不会被整组平均值掩盖。
20. As a 训练用户, I want 系统区分一次偶然偏差和持续整组模式, so that 单个噪声 Rep 不会立即变成训练建议。
21. As a 训练用户, I want 关键关节被遮挡时只影响相关维度, so that 其他仍可观察的 Rep 和质量事实可以继续使用。
22. As a 训练用户, I want 关键动作关系不可观察时看到具体的无法判断原因, so that 系统不会用猜测填补缺失证据。
23. As a 训练用户, I want 默认先看到结论并可以展开推导过程, so that 报告既易读又可以审核。
24. As a 训练用户, I want 个人比较只使用本次训练中相同动作和机位的前序稳定表现, so that 后程退化比较不会混入长期或不同机位数据。
25. As a 训练用户, I want 系统把个人短期参考与通用标准参考分开, so that 我的稳定动作不会自动被声称为普遍标准。
26. As a 教练审核者, I want 每个动作明确主任务、佐证、代偿、技术约束和坐标锚点, so that 规则语义可以逐动作审核。
27. As a 教练审核者, I want 同一个髋角在划船和硬拉中拥有不同角色, so that 特征复用不会改变动作含义。
28. As a 教练审核者, I want 质量门槛绑定 exact action×equipment×posture×view, so that 一个机位或变式调出的阈值不会扩散到其他动作。
29. As a 教练审核者, I want `cannot_judge` 和 `not_applicable` 分开, so that 看不清证据与该维度本来无关不会混淆。
30. As a Rust SDK 使用方, I want 只提交 exact action context 和帧流, so that 客户端不需要理解内部关节索引或规则组合。
31. As a Rust SDK 使用方, I want 中途动作、器械、姿态或机位变化被拒绝, so that 一组训练不会混合两个计算计划。
32. As a Rust SDK 使用方, I want 相似名称不能自动回退到父动作, so that 未支持变式不会借用错误的质量结论。
33. As a Rust SDK 使用方, I want 宽泛父动作可以存在于目录但不能伪装为可执行质量动作, so that 目录完整度与识别能力不会混为一谈。
34. As a Rust SDK 维护者, I want 动作定义通过受验证的数据和动作族模板复用, so that 增加细分动作不需要继续扩展巨型条件分支。
35. As a Rust SDK 维护者, I want FeatureProgram 支持任意强类型关节和线段关系, so that 新动作不受固定八个诊断角度限制。
36. As a Rust SDK 维护者, I want 动作定义先于机位投影编译, so that 机位不会反向改变动作语义。
37. As a Rust SDK 维护者, I want 每个 Feature 带单位、scope、coverage、confidence、source range 和 judgeability, so that RulePack 不会把“数值存在”误当成“动作合格”。
38. As a Rust SDK 维护者, I want pose 与 equipment 保持独立证据再融合, so that 同一器械观察不会通过预测点被重复计权。
39. As a Rust SDK 维护者, I want 骨架与器械冲突成为 typed evidence, so that 引擎不会静默选择更方便的一条轨迹。
40. As a Rust SDK 维护者, I want 每个结论具有真实而非装饰性的依赖链, so that Trace 可以复现实际计算原因。
41. As a 动作目录维护者, I want 每个动作身份带有姿态、支撑、器械拓扑、路径约束、单双侧和 setup 字段, so that 目录可以验证细粒度动作是否自洽。
42. As a 动作目录维护者, I want 自由杠铃、史密斯、哑铃、绳索和固定器械默认分别建模, so that 器械差异不会藏在模糊字符串里。
43. As a 动作目录维护者, I want 新动作先以 catalog-only 状态加入再逐步获得 Bundle, so that 目录可以扩展但不会提前声明识别能力。
44. As a 数据评估者, I want 每个 exact context 分别报告 Rep、阶段、Feature、结论和拒绝指标, so that 一个混合识别率不能掩盖弱动作。
45. As a 数据评估者, I want 按 participant、source、session 和 view 隔离评估, so that 同视频或同人的轨迹不会泄漏到验证结果。
46. As a 产品负责人, I want 当前 70 个动作全部具有明确的动作语义定义, so that 长期全目录能力有一致扩展入口。
47. As a 产品负责人, I want 新增细分动作同样遵守 exact-context 与证据开放规则, so that 扩充目录不会降低产品可信度。
48. As a 产品负责人, I want Rust 保持 Web、Android 和 iOS 的唯一识别 Provider, so that 客户端不会出现三套动作理解逻辑。
49. As a 训练用户, I want 当前机位看不到动作必要主运动时系统直接说明不能识别, so that 无关的手腕或身体晃动不会产生虚假 Rep。
50. As a 训练用户, I want Rep 可以识别但部分质量维度不可见时仍获得有限报告, so that 一个不可见维度不会抹掉其他可靠事实。
51. As a 训练用户, I want 有限报告明确标记每个 `cannot_judge` 维度及原因, so that 我不会把缺少判断误解为动作合格。
52. As a 训练用户, I want 系统只把真实器械轨迹用于器械主运动, so that 腕部轨迹不会冒充杠铃、哑铃、绳索或机器手柄。
53. As a Rust SDK 使用方, I want 计划编译明确返回完整计划或强类型拒绝, so that 客户端不需要猜测一个半有效计划是否可用。
54. As a Rust SDK 使用方, I want 拒绝结果说明动作、机位、器械、合同或视觉能力中的具体原因, so that 我可以给用户准确的拍摄或配置提示。
55. As a Rust SDK 维护者, I want 新动作通过动作定义、Feature组合、Reference和RulePack加入, so that Rust 不会积累按动作名称分支的专用算法。
56. As a Rust SDK 维护者, I want FeatureProgram 使用受治理的强类型计算图, so that 任意关节、线段和轨迹可以组合而不允许无单位或无来源公式。
57. As a Rust SDK 维护者, I want 每个成功计划都包含所有合同维度的可计算或不可判断状态, so that 必要主运动和质量约束不会被静默遗漏。
58. As a 产品负责人, I want 动作目录中的每个叶级动作都获得计划或明确拒绝结果, so that 目录覆盖不会被误报成识别覆盖。
59. As a Rust SDK 维护者, I want ActionMotionDefinition 成为唯一动作语义来源, so that ExecutionContract、FeatureProgram、RecognitionProfile 和 RulePack 不会形成多套 Rep 与质量真相。
60. As a 产品负责人, I want 不完整动作定义直接阻止规格构建通过, so that 尚未实现的动作不能用拒绝结果伪装成已完成能力。
61. As a 训练用户, I want 身份定义所必需的旋转无法计算时不产生该动作 Rep, so that 相关的负载或腕部轨迹不会冒充真正完成了旋转动作。
62. As a Rust SDK 维护者, I want 仅增加一个动作资产就能运行新的动作, so that 数据驱动扩展可以被实际证明而不是只依赖代码约定。
63. As a 训练用户, I want 系统在我接触杠铃前可以看见架上的杠但不能把它认作我正在握持的器械, so that 准备动作不会产生额外 Rep。
64. As a 训练用户, I want 握持通过持续接触与共同运动建立并在释放后失效, so that 单帧靠近或经过杠轴不会获得 Rep 资格。
65. As a Rust SDK 维护者, I want 原始器械检测、主体关联、握持状态和 Rep eligibility 分别保留 typed evidence, so that Trace 能说明器械何时以及为何开始参与动作计算。
66. As a Rust SDK 维护者, I want 手腕只约束关联而不能生成 `Measured` 杠轴或覆盖真实视觉长度, so that pose 漂移与张手动作不会制造器械轨迹。
67. As a 数据评估者, I want 单独评价器械检测、主体关联、握持建立/释放和 Rep eligibility, so that 一个 equipment coverage 数字不能掩盖错误归属。
68. As a 产品负责人, I want 架构覆盖与准确率成熟度使用不同基线和晋升门槛, so that 完成 248 个定义不会被误报成动作识别已经准确。
69. As a 训练用户, I want 页面中的真实杠铃轨迹只来自画面测量, so that 手腕桥接线不会被展示成系统已经识别到的杠铃。
70. As a Rust SDK 维护者, I want 相同视频帧的 raw 杠轴不因手腕位置改变而改变, so that detector 与 pose association 可以分别测试和改进。

## Implementation Decisions

- 本规格的最高运行时 seam 继续使用 `ExecutionAssessmentEngine` 的整组生命周期：配置完整 Bundle、开始一组、提交有序 canonical observations、封存一组并读取不可变 assessment。调用方不直接调用 ActionMotionDefinition、ViewProjectionPlan 或单个 Feature/Rule。
- 实现顺序固定为：冻结受治理的分任务数值回归基线 → 扩展并治理细粒度 Action Catalog → 冻结 exact action identity → 为该 identity 定义 ActionMotionDefinition → 根据 exact view 编译 ViewProjectionPlan → 原子编译 ActionObservationPlan/Bundle → 运行 Rep、Feature、Rule、Set Aggregation 与 Trace。后续阶段不能反向替代前置阶段。
- Action Catalog 扩展是关节与轨迹设计的前置条件。只要姿态、支撑、器械拓扑、路径约束、单双侧、凳面角度、杠位或站距改变主轨迹、Rep 边界、代偿空间或参考走廊，就先建立独立动作身份。
- 禁止先为宽泛父动作建立一套完整关节/轨迹规则，再以 equipment、posture 或 setup 条件分支模拟细分动作。父动作可以组织目录，但 executable 计算必须从叶级 exact identity 开始。
- 动作身份在第一帧前由用户选择或训练计划提供。当前轮不从自由运动自动分类动作，也不从画面猜测器械变式。
- 当前具备器械观测资格的范围固定为 `FreeRigidBarbell`、`SmithGuidedBar`、`IndependentDumbbell` 和 `ConstrainedMachineHandle`。`FreeRigidBarbell` 与 `SmithGuidedBar` 复用刚体杠观测 Adapter 和杠轴/中心/端点原语；Smith 计划额外绑定导轨路径约束，并保持独立动作身份、Rep 合同、质量规则与参考资产。哑铃按单侧、双侧同步或交替保存独立轨迹；固定器械只观察联动或独立的用户接触把手。
- `CableHandle/Pulley`、`Landmine/TBarPivot`、trap bar、kettlebell、resistance band 及其他未列出的器械拓扑本轮没有设备 Adapter。器械是身份定义必要主运动时，它们保持 `catalog-only`；人体 required motion 足以确认身份与 Rep 时，只允许明确的 pose-supported limited plan，所有器械相关事实和结论保持 `cannot_judge`。两者都不得统计为 supported-equipment coverage，也不得把手腕轨迹声明成器械轨迹。
- 徒手或无需器械主轨迹的动作不需要虚构 equipment observation；它们是否可执行由身份主运动、骨架 operator 和 exact view 独立决定。
- 每个 executable action identity 必须是 exact exercise variant，而不是宽泛运动名称。身份至少固定 movement family、posture、support、equipment topology、path constraint、laterality 和 setup。
- `ActionMotionDefinition` 只能在 exact action identity 冻结后建立，并先于任何机位处理。它声明该具体动作的主关节、主人体/器械轨迹、佐证轨迹、稳定线段、代偿约束、左右关系、器械角色和 Rep/阶段语义。
- `ActionMotionDefinition` 是唯一动作语义权威。`ExecutionContract`、`RecognitionProfile`、`FeatureProgram` 和 RulePack 必须由编译器从它生成，或作为受治理资产逐字段验证与它一致。任何下游资产新增、删除或改变 TaskPrimary、Rep boundary、phase semantics、stability/substitution role 或允许结论，都属于构建冲突并拒绝 Bundle admission。
- 动作语义与数值校准严格分开：`ActionMotionDefinition` 决定观察关系、角色、方向、阶段和允许结论，不生成未经证据支持的角度、幅度、时长、相似度或走廊阈值。`RecognitionProfile`、Reference 与 RulePack 保存 exact-context 校准参数及其 evidence lineage；缺少校准时只能使用明确的 provisional recognition initializer 或 typed abstention，不能因定义完整而自动产生质量合格门槛。
- `ViewProjectionPlan` 只把动作语义投影为当前画面可观察的二维角、局部轴轨迹和置信门控。它不能改变 Feature 的动作角色，也不能用无关信号替代不可观察的主关系。
- 构建期与运行计划编译必须分开：缺失或冲突的 action identity、`ActionMotionDefinition`、器械拓扑、Feature dependency、Rep/阶段或 Rule mapping 是 `DefinitionBuildFailure`，必须使本规格构建/验收失败；它不是合法 `PlanRefusal`，也不能计入已完成能力。
- 只有完整动作定义通过构建与 admission 后才能进入计划解析。受支持器械、无需器械主轨迹，或明确拥有独立人体 identity-defining required motion 的 unsupported-equipment 动作，可以成功产生完整或显式 limited `ActionObservationPlan`；当前视觉表达/机位无法观察 Identity-defining TaskPrimary 时产生强类型 `PlanRefusal`。不支持器械且器械为必要主运动时返回 `UnsupportedEquipmentTopology`；任何路径都不得用手腕代理生成半有效计划。
- 成功 `ActionObservationPlan` 中，所有 identity-defining TaskPrimary、必要主轨迹和 Rep boundary 必须可计算，不能标记为 `cannot_judge` 或 `not_applicable`。只有非身份定义的 coordinated motion、stability relation、substitution relation 和次级质量维度可以预先标记为带原因的 `cannot_judge`；真正不适用该叶级动作的维度才可为 `not_applicable`。
- 合法 `PlanRefusal` 只能来自完整定义经过 exact view/capability 分析后确认的限制，例如 Identity-defining motion 依赖当前无法表达的轴向旋转、出平面关系或缺少任何适用机位。动作/器械/姿态输入与 exact identity 不匹配属于 context validation failure；定义或资产不完整属于 build failure，二者均不能作为能力覆盖的合法拒绝。
- 如果叶级动作属于本轮支持的器械范围或无需器械主轨迹，且 Identity-defining TaskPrimary 可以由本规格要求的二维投影角、动作局部坐标、人体/器械轨迹、相对轨迹和 Rep primitives 表达，则该动作必须至少有一个受治理 exact view 成功编译并运行；对所有机位统一返回 `PlanRefusal` 属于未实现，不是合法能力边界。
- 如果必要主运动可观察并足以形成 Rep，只是非身份定义的次级质量维度依赖当前不可观察的轴向旋转、出平面关系或真实三维关系，编译器可以成功生成有限能力计划；对应维度必须在计划中预先固定为 `cannot_judge`，不能等到规则运行时静默缺失。
- 任何代理信号只有在 `ActionMotionDefinition` 明确把它列为等价的 required/corroborating relation 且有独立证据依据时才可参与计划。空间相关或通常同时运动不构成等价性；腕部轨迹默认不是杠铃、哑铃、绳索手柄或机器手柄轨迹。
- `ActionObservationPlan` 是 Rust 内部编译产物，不是新的客户端配置资产。它以 `ActionMotionDefinition` 为语义权威、以 `ViewProjectionPlan` 为机位投影，再封装经过生成/一致性验证的 ExecutionContract、FeatureProgram、RecognitionProfile、EquipmentAdapter、ReferencePolicy 和 RulePack。
- `ActionObservationPlan` 必须声明各证据通道独立的时间基准、最大因果年龄、背压和缺帧策略。视频/器械观察可以按相机帧率运行，Pose 只在真实 Pose observation timestamp 更新；器械-only 帧不得复制、插值或重新提交一个虚构 Pose observation，也不得重复推进 Pose Rep 状态机。
- Bundle 安装必须验证动作身份、器械拓扑、姿态、机位、Feature DAG、单位、规则依赖、版本和 content hash。缺少或冲突时拒绝启用，不回退到父动作、相邻机位或相似器械。
- 现有统一肘、肩、髋、膝投影角继续作为 canonical diagnostic snapshots。动作专项质量通过 FeatureProgram 的任意三点投影角、线段角、躯干倾角、骨盆—躯干关系、踝角和相对轨迹扩展，不继续扩大一个写死动作枚举。
- `FeatureProgram` 从有限的预制 Feature 清单扩展为强类型通用计算图，但仍只能组合受治理的 Feature operator。每个 operator 固定输入类型、输出类型、单位规则、scope、证据来源要求和 judgeability 传播；不允许任意文本公式、无单位数值或越过 provenance 的动态代码。
- 新动作只能通过叶级动作身份、完整 `ActionMotionDefinition`、FeatureProgram 组合、Reference policy 和 RulePack 增加。Rust 可以新增跨动作复用的通用 Feature/operator 或器械拓扑 Adapter，但不得新增以 action ID/name 为条件的动作专用分支。
- Feature scope 包含 Frame、Phase、Rep 和 Set。Frame 事实可支持 Rep 状态；Rep 封存后计算阶段归一化轨迹；Set scope 只聚合不可变 Rep facts。
- Feature 角色固定为 TaskPrimary、TaskCorroborator、SubstitutionGuard、TechniqueConstraint 和 ContextAnchor。同一原语可复用，但角色由 exact action identity 决定。
- Rep 主信号由动作定义选择。自由杠铃使用已经建立主体归属与握持的刚体杠轴/中心/端点轨迹；哑铃使用已建立握持的单侧或独立左右 tracks；固定器械使用已建立接触的用户把手轨迹；徒手动作使用动作定义的身体关系。Pose 提供独立佐证，手腕不是通用器械替代，固定器械把手也不能被扩展解释为整台机器的隐藏运动。
- 器械 Adapter 必须输出 `RawDetected → Unassociated → ContactCandidate → GripEstablished → Released/Conflict` 或等价强类型生命周期。单帧手腕距离只能产生 ContactCandidate；GripEstablished 至少要求受治理时间窗内的连续接近、相对几何稳定和人体—器械共同运动。只有 `GripEstablished` 的非预测、非手腕生成 observation 才能设置 fusion/turnaround/Rep eligibility。短时遮挡 continuity 只能延续既有 track，不能创建或重新建立 grip。
- `Measured` 器械几何只能来自视觉/传感器 observation。手腕可以限定主体关联、检查残差或在已经建立 grip 后提供 display-only continuity，但不得生成 `Measured` axis、决定完整视觉轴长度、把背景横线升级为用户器械，或单独建立 `held_by`。视觉检测即使使用动作上下文缩小搜索范围，也必须保存不依赖手腕生成的候选分数与几何 provenance。
- EquipmentAdapter 输出独立的 `RawGeometryEvidence` 与 `AssociationEvidence`。Raw detector 可以使用动作局部人体 ROI 排除无关区域，但不得读取手腕来生成/移动/旋转/裁剪 shaft candidate；相同图像与 ROI 下，改变手腕坐标只能改变 association/grip 结果，不能改变 raw measured geometry。若实现需要 pose-guided second pass，它必须作为独立 proposal source 保存，不能冒充 image-only measurement。
- `PoseBridgeDisplayEstimate` 与 `TrackPrediction` 只能引用先前已经存在的视觉 track ID，并带最大年龄、来源帧和 uncertainty growth。Rust 输出必须让客户端能把它与真实 `VisualMeasuredSegment` 分开显示；默认质量报告、Reference、Rule、Rep 和设备准确率统计全部忽略 display estimate。没有真实视觉 observation 时系统报告“杠铃轨迹暂不可测”，而不是把手腕线称为杠铃识别。
- RepEngine 必须在 set 内区分 setup、working-cycle 和 release/rack。需要器械握持的计划只有在 GripEstablished 且工作周期 activation gate 满足后才可 armed；接近、抓握、解铃、出架、回架和释放不得单独形成 ConfirmedRep。ExecutionContract 声明 setup/activation/release 语义，RecognitionProfile 只校准其 exact-context 时间和幅度参数。
- Rep 识别要求动作方向、最小可见幅度、滞回、最短阶段持续时间、端点/反转和关键佐证共识。骨架—器械冲突必须保留为 typed conflict。
- Rep 封存后，阶段轨迹按相对进度重采样以比较形状。速度和轨迹质量保持不同 Feature；DTW 或学习表示只能作为相似度/候选事实，不能取代 RepEngine 或直接发布正确性。
- 第一版 Feature 原语至少覆盖投影角、signed segment angle、normalized distance、动作局部轴轨迹、器械中心/端点/轴线、relative trajectory、bilateral delta、phase statistic、ROM、endpoint、velocity、reversal、coverage、corridor distance、pose-equipment lag 和 prior-Rep/set trend。
- 所有 Feature 结果包含稳定 ID、unit、status、coverage、confidence、uncertainty、source range 和 provenance。存在一个有限数值只证明可观察，不证明质量合格。
- 质量输出按 task completion、range/endpoints、phase control、trajectory control、support stability、bilateral symmetry、pose-equipment coordination 和 late-set degradation 分维度产生。
- 每个维度使用 observed acceptable、observed deviation、cannot judge 或 not applicable。关键维度不可判断时不能通过重分配权重伪造完整高分；若将来输出派生分数，必须同时暴露覆盖率和组成维度。
- strict barbell row 把髋角与躯干倾角作为 SubstitutionGuard。可靠的大幅同相运动必须产生 excessive hip/trunk assistance deviation；具体阈值由 exact-view、held-out evidence 校准，不设跨机位常量。
- conventional deadlift 把髋伸和膝伸作为 TaskPrimary，把肘稳定和杠铃靠近身体作为 TechniqueConstraint。它不继承划船的髋/躯干代偿规则。
- 旋转相关动作按 identity-defining semantics 判断，不按动作名称特殊放宽。Arnold press 属于哑铃范围，但如果肩轴向旋转是区分该叶级动作的 TaskPrimary，而当前 Feature operators 只能观察哑铃、肘腕或腕绕肘的二维相关轨迹，则编译器必须返回 `PlanRefusal`，不得输出该动作的 ConfirmedRep。Cable external rotation 本轮先因绳索拓扑不受支持而保持 `catalog-only`；在未来引入绳索 Adapter 后仍必须重新通过旋转可表达性验收。
- 旋转动作被拒绝时，canonical packet 仍可保留哑铃、手腕、肘部和躯干等可见观察事实，但这些事实只能作为诊断证据，不能降格为旋转 TaskPrimary、Rep boundary 或动作质量结论。只有引入并验证能表达身份定义旋转的 Feature operator 后，相关叶级动作才能生成成功计划。
- 同次训练个人参考仅使用此前已封存、同一 exact context 的稳定 Rep/组，并保留 source set/rep provenance。它不自动成为 StandardReferenceProfile。
- Reference Runtime 明确区分 self geometry、set prefix、same-session reference、governed standard reference 和 no reference。依赖缺失参考的结论必须 abstain。
- Trace 的真实依赖顺序为 SourceObservation、CoordinateEvidence、FusionEvidence、Rep/Phase、FeatureFact、ReferenceComparison、RuleEvaluation、SetPattern 和 Conclusion。没有参与计算的 Feature 不得作为装饰性因果节点。
- Trace 固定 packet lineage、algorithm/config/inference/diagnostic versions、Bundle asset/hash、exact context、timestamps、units、reference provenance、rule identity 和 refusal/conflict reason。
- 当前 registry 的 70 个动作是目录扩展的输入基线，而不是最终粒度。必须先依据姿态、器械与执行差异拆分或确认叶级 exact identities，再为这些身份建立结构化 ActionMotionDefinition；结构覆盖不等于每个 context 已获得 executable quality Bundle。
- 配套研究报告附录 A.2–A.18 的当前 70 动作矩阵提供动作族初始语义，附录 A.21–A.26 提供细分与扩展规则。实现必须先据此得到扩展后的 exact action catalog，再为每个叶级动作转换主关节、主轨迹、Rep 主信号、佐证、代偿观察和技术约束；不得把父动作矩阵直接视为最终可执行定义。
- 配套研究报告附录 A.20 的已确认审核决定属于本规格的动作语义约束，包括 strict barbell row 的髋/躯干代偿、深蹲变式拆分，以及旋转动作在身份定义 TaskPrimary 不可表达时必须能力拒绝。
- 配套研究报告附录 A.21–A.26 是扩展动作身份与动作族拆分依据。扩展项必须进入目录规划并使用结构化 identity fields，但只有具备 exact-context Bundle、适用证据和验收结果后才能从 catalog-only 晋升为 executable。
- 配套研究报告第 4–8 节及附录 A 中的动作判定条件用于定义 Rep/phase、Feature、SubstitutionGuard、TechniqueConstraint、ReferenceComparison 与 RulePack。定性的判定关系是实现要求；尚未由 exact-view held-out evidence 校准的角度、距离、时长或相似度数值不得直接写成跨机位生产阈值。
- 《扩展动作运动契约》第 5 节的每个叶级动作必须物化为完整 `ActionMotionDefinition`。其中 required motion、coordinated motion、stability relation、substitution relation、primary/corroborating tracks、Rep boundary 和 limited claims 都必须完整定义；不能只保存动作到关节名称的简单关联。支持器械范围内或无需器械主轨迹的动作进入 operator-resolution，身份主关系找不到 operator 时保留该关系并产生视觉能力拒绝；不支持器械拓扑的动作保留完整定义，器械为必要主运动时停止在 `catalog-only`，独立人体主运动充分时只能进入 pose-supported limited resolution，不能删除字段、用代理降级或冒充完整器械能力。
- 全动作目录统一执行细分审计，不只扩展深蹲或推肩。自由杠铃、史密斯、哑铃、绳索、selectorized machine、plate-loaded machine、lever/landmine 和 bodyweight 是不同 equipment topology。
- 上述目录细分不等于本轮全部器械可执行。本轮只有自由刚体杠铃、复用刚体杠追踪的史密斯杠、独立哑铃和固定器械用户接触把手进入器械观测与融合；其余器械身份不能获得器械能力，其中器械必要主运动保持 catalog-only，人体主运动独立充分者最多获得 pose-supported limited plan，等待后续 Adapter 规格。
- 胸部推举至少区分自由杠铃/史密斯/哑铃/固定器械/绳索、平板/上斜/下斜、双侧/单侧/交替以及联动/独立双臂。
- 水平拉至少区分俯身/坐姿/胸托/站姿、杠铃/史密斯/哑铃/绳索/T 杠/固定器械以及双侧/单侧。
- 垂直拉至少区分自重/辅助/绳索/固定器械、握法 context、双侧/单侧以及辅助平台拓扑。
- 深蹲至少区分徒手、高杠、低杠、前蹲、高脚杯、史密斯、哈克、钟摆、腰带、箱式、相扑和地雷管；弓步、分腿蹲、保加利亚分腿蹲和腿举保持独立。
- 髋铰链至少区分传统/相扑/陷阱杠/史密斯硬拉，杠铃/史密斯/哑铃/单腿/绳索 RDL，以及杠铃/史密斯/固定器械/单腿臀推或臀桥。
- 推肩至少区分坐姿/站姿、杠铃/史密斯/哑铃/固定器械、普通/阿诺德、单臂/双臂和地雷管拓扑。
- 肩部动作分别细分站姿/坐姿/胸托、哑铃/杠铃/绳索/固定器械、单臂/双臂，并为 lateral raise、front raise、Y raise、rear-delt fly、upright row 和 external rotation 保留独立运动语义。
- 手臂动作分别细分站姿/坐姿/上斜/牧师凳/仰卧/过顶、杠铃/EZ 杠/史密斯/哑铃/绳索/固定器械和单臂/双臂/交替。
- 膝与踝孤立动作分别细分坐姿/俯卧/站姿、双腿/单腿、固定器械/史密斯/自由负重/腿举机。宽泛 leg curl 和 calf raise 父身份不直接获得完整质量 Bundle。
- 核心和移动动作同样执行细分：卷腹与完整 sit-up、不同背伸支撑、低冲击与跳跃、徒手与负重在计算图或周期语义变化时建立独立身份。
- 细分不生成无意义的笛卡尔积。只有现实存在、产品准备支持且拥有明确语义的组合进入 registry；但遇到器械拓扑、姿态、支撑、单双侧或 setup 改变时默认倾向拆分。
- 父动作和新增细分动作可以先为 catalog-only。只有 exact context 拥有 executable RecognitionProfile、质量规则、trace completeness 和适用 evidence 后才能开放用户能力。
- 规则与确定性 Feature 可以先实现，不等待用户完成质量标注。学习模型后续可生成阶段或错误候选，但输出仍必须通过 ExecutionContract、可观察性和 RulePack 才能成为结论。
- 实现前先冻结受治理的数值回归基线和失败分类。known-video baseline 只允许检测回归和定位问题，不允许在 truth reveal 后继续选择阈值再声称 held-out；每个 accuracy promotion 使用新的 source/participant/session 隔离评估。Rep、boundary、phase、equipment detection/association/grip、Feature 与 quality 分别报告，缺少人类真值的任务固定为 `not_evaluable`。
- Rust 是 Web、Android 和 iOS 的唯一 Motion Provider。客户端只负责相机生命周期、用户上下文、显示和上传同意；不选择关节、不重算 Rep、不生成质量解释。
- Python 仅可用于离线研究或治理后的评估，不是产品 runtime、SDK interface 或正式跨端识别链。
- 单目结果只称 camera-plane/projected angle 和 action-local trajectory。禁止声称真实世界 3D、米制轨迹、力、关节力矩、肌肉激活、疼痛原因、伤病风险或医学诊断。

## Testing Decisions

- 动作语义与评估的最高测试 seam 只有一个：安装一个完整 exact-context Bundle，通过真实 `ExecutionAssessmentEngine` set lifecycle 提交按时间排序的 canonical observations，调用 finish set，并检查公开的 sealed Rep、维度报告和 EvidenceDerivationTrace。需要验证 raw 视频器械检测时，使用公开 Rust EquipmentAdapter/Provider seam 提交视频帧，再把其 typed output 送入同一 canonical→ExecutionAssessmentEngine 生命周期；这不是第二套 Rep 或质量 harness。测试不直接锁定私有算子实现。
- Baseline gate 在任何行为改动前解析受治理的 v11 known-video regression 资产、验证 admission 与 SHA-256，并冻结 aggregate 和 exact action×view 的 Rep precision/recall、exact-set、boundary、negative-window false trigger 与当前 `not_evaluable` 状态。后续 ticket 必须报告相对变化，不能只给全目录混合数字。
- 复用现有 action-context、Bundle resolution、rigid-bar family、equipment family、bodyweight family、tracer、native/WASM parity 和 set-lifecycle contract tests，不建立第二套动作评估 harness。
- Expansion-catalog test 是动作语义测试的前置验收。它必须先对照配套研究报告附录 A.21–A.26，验证扩展动作拥有唯一结构化 leaf identity，所有宽泛父动作均为显式 non-executable parent，并确保 catalog-only 项不会被报告为 executable 能力。
- Catalog contract test 枚举当前 70 个基线动作及其扩展结果，要求每个基线动作都解析到一个或多个受治理的叶级 identity，或给出显式的不拆分/拒绝决定；不得借用相邻动作或依赖模糊 equipment 字符串。
- Research-mapping contract test 只在扩展目录通过后运行。它必须对照配套研究报告附录 A.2–A.18 与 A.21–A.26，证明每个叶级 exact action 的主关节、主轨迹、Rep 信号、佐证、代偿和技术约束均有稳定资产映射或显式拒绝记录。
- Leaf-motion-definition contract test 必须逐项对照《扩展动作运动契约》第 5 节，证明每个叶级动作的应动、应稳、器械/人体轨迹、Rep 边界、代偿和有限结论均已物化；只关联关节名称、只继承宽泛父动作或返回 incomplete-definition refusal 都不能通过。
- Judgment-condition behavior tests 必须从配套研究报告第 4–8 节和附录 A 的动作判定条件生成代表性正例、偏差例与不可判断例；测试公开结论与真实 Trace，不把报告中的说明文字或未经校准的候选阈值硬编码为内部结构断言。
- Variant identity tests 验证自由杠铃、史密斯、哑铃和固定器械不会解析到同一 executable identity；平板、上斜、下斜以及坐姿、站姿、胸托也不会静默共享 Bundle。
- Exact-context refusal tests 验证动作、器械拓扑、姿态、机位或单双侧不匹配时在首帧前失败，并保留具体 refusal reason。
- Definition-completeness gate 在运行计划测试之前枚举本规格覆盖的全部叶级动作，要求 action identity、ActionMotionDefinition、器械拓扑、Feature dependencies、Rep/phase mapping 和 Rule mapping 完整且一致；任何 `DefinitionBuildFailure` 直接使规格验收失败，不能转成 `PlanRefusal`。
- Equipment-scope tests 在计划编译前把叶级动作分为自由刚体杠铃、史密斯导轨杠、独立哑铃、固定器械用户接触把手、无需器械主轨迹和 unsupported equipment topology。自由杠铃与史密斯复用刚体杠 Adapter，但必须解析为不同 exact identity 与路径约束；unsupported 项如果器械是身份定义必要主运动则保持 catalog-only，人体 required motion 独立充分时只允许 pose-supported limited plan，并验证所有器械维度为 `cannot_judge`。
- Plan-compiler totality tests 只枚举已经通过 definition-completeness gate 且属于支持器械范围或无需器械主轨迹的叶级动作与 exact view，要求编译明确返回完整 `ActionObservationPlan` 或由 Identity-defining motion 视觉限制导致的强类型 `PlanRefusal`；不允许空计划、缺字段计划、父动作回退或第三种隐式状态。
- Mandatory-success coverage tests 对支持器械范围内或无需器械主轨迹、且可由必备 Feature operators 表达 Identity-defining TaskPrimary 的叶级动作，至少选择一个适用 exact view，要求成功编译并通过完整 `ExecutionAssessmentEngine` set lifecycle 输出 Rep、质量维度和 Trace。任何这类动作在全部机位均拒绝都会使本规格验收失败。
- Capability-refusal admissibility tests 验证拒绝所引用的 Identity-defining relation 确实无法由当前受治理 operator catalog 与 exact view 表达；如果同一关系可由必备 operator 解析，拒绝不得计入通过。当前明确的拒绝候选是缺少真实轴向旋转 operator 的 M21/M24 合同，不允许用模糊的 unsupported reason 扩大范围。
- Required-motion refusal tests 构造 Identity-defining TaskPrimary 出平面或当前 Feature operators 无法表达的完整动作定义，验证在任何帧处理前返回能力拒绝且不产生 Rep。器械拓扑缺失、动作定义不完整和下游资产冲突分别断言为 context/build failure，不能通过此测试获得合法拒绝。
- Limited-plan tests 构造必要主运动可观察但次级质量维度不可观察的 context，验证计划成功、Rep 可计算、可见维度正常运行，并且不可见维度从计划创建开始就是带原因的 `cannot_judge`。
- No-unrelated-proxy tests 验证缺失杠铃、哑铃或固定器械把手主轨迹时，腕部或其他相关身体轨迹不能自动接管 Rep；只有动作合同显式授权且证据等价的 corroborating relation 可以参与共识。
- Pre-contact association regression 使用冻结 v11 记录 `a44741cba03352f1e689fd51276dfec5` 的 5400 ms / frame 162 作为已知失败样例：画面可以保留 raw bar candidate，但在双手尚未接触杠铃时必须是 unassociated/contact-candidate，`fusionEligible=false`、`turnaroundEligible=false`，且不能推进或创建 Rep。该样例只能用于回归诊断，不成为训练或阈值选择标签。
- Equipment-contact lifecycle tests 覆盖远处真实杠、双腕经过背景横杆、逐步接近、持续接触、共同运动、短时遮挡、单手脱离、双手释放、回架和再次握持；断言 detection、association、grip 与 Rep eligibility 分开变化，单帧距离永远不能跳过 lifecycle。
- Provider-to-assessment integration tests 从真实/fixture 视频帧进入公开 Rust EquipmentAdapter/Provider，保留 raw geometry、association、grip 与 cadence provenance，再通过 canonical packet 进入 `ExecutionAssessmentEngine`；禁止测试直接伪造一个已握持 equipment track 来绕过本轮核心能力。
- Wrist-independence tests 验证移除或扰动手腕不会改变同一视觉帧的 raw measured shaft geometry；手腕只改变关联/握持状态。视觉缺失时由手腕桥接的轴必须是 display-only/predicted provenance，不能成为 `Measured`、不能建立 grip、不能参与规则或 Rep。
- Visual-geometry differential tests 固定相同图像与人体 ROI、改变手腕位置，要求 raw shaft candidate 的轴、可见长度和视觉置信度不变；再固定手腕、改变/移除画面真实杠轴，要求 raw detection 随视觉证据变化。测试分别覆盖架杆、镜面横线、器械横梁、杠片遮挡和斜杠轴。
- Pose-bridge honesty regression 使用冻结 v11 记录 `field-capture-2026-08-02T18-34-19-006Z` 的 16609 ms / frame 498：允许输出带历史 track ID 的 `PoseBridgeDisplayEstimate`，但不得把它命名为真实杠铃轨迹，不得进入 raw/canonical equipment observation、fusion、turnaround、Rep、Reference 或质量结论。该帧只用于回归诊断，不是杠轴标注真值。
- Multi-rate tests 以独立时间戳提交约 30 Hz 视频/器械帧和约 10 Hz Pose observation，验证每个视频帧最多推进一次器械 tracker、每个 Pose timestamp 最多推进一次 Pose/Rep 状态；不得用 equipment-only 帧复制 Pose，且行为在 native/WASM 等价。
- Asset-only extension conformance test 只增加一个外部动作资产，使用测试运行时生成、Rust 源码中不存在的叶级 action identity，并组合已有 Feature operators、Reference policy 与 RulePack；不得修改 Rust 源码、重新增加 operator 或增加 action-specific registration。测试必须发现该资产、编译计划、运行完整 `ExecutionAssessmentEngine` set lifecycle，并输出 sealed Rep、质量维度和完整 Trace。
- Data-driven-extension tests 继续通过统一 Catalog→ActionMotionDefinition→FeatureProgram→RulePack 路径检查全部动作；除公开计划、拒绝与评估结果外，验收还要求真实新增动作资产的变更不包含 Rust engine/action-name 分支。通用 operator 或器械 Adapter 的独立新增必须按跨动作能力单独评审，不能夹带在动作资产中。
- Semantic-order tests 验证相同动作换机位时 ObservationRole 不变；机位只能改变 projected primitive 和 judgeability。
- Row/deadlift contract tests 验证 hip/trunk 在 strict barbell row 是 SubstitutionGuard，在 conventional deadlift 是 TaskPrimary；规则依赖和 trace 必须反映真实角色。
- Strict-row behavior tests 使用相同 Rep 主轨迹，改变髋/躯干同相移动，验证可靠大幅代偿产生 deviation，而低覆盖或不可观察条件产生 cannot judge；阈值必须来自 exact-view Bundle。
- Bench topology tests 分别验证 free rigid bar、smith guided bar、dual dumbbell 和 constrained machine handles 的 Rep consensus、左右关系与器械 provenance 不可互换；自由杠铃与史密斯可以共享刚体杠 observation，但不得共享未声明的路径约束、质量规则或参考走廊。
- Shoulder-press topology tests 分别验证 seated barbell、seated dumbbell、seated machine 和 standing press 的支撑锚点、负载拓扑和代偿要求。
- Squat-family tests 验证 high-bar、low-bar、front squat、smith、machine squat、lunge 和 split squat 使用不同 exact identity，即使复用髋膝踝原语也不能共享未经声明的参考走廊。
- Ambiguous-parent tests 验证 generic leg curl、calf raise 和其他多姿态/多器械父动作不能安装完整质量 Bundle，直到 variation 与 equipment 被精确解析。
- Rotation-identity tests 验证 Arnold press 的身份定义旋转无法由当前 Feature operators 表达时返回 `PlanRefusal`，不输出该动作 Rep；哑铃、腕、肘和躯干事实可以保留，但不得出现在 TaskPrimary 或 Rep boundary 的因果路径中。Cable external rotation 本轮验证为 `UnsupportedEquipmentTopology`，不进入视觉旋转拒绝测试。
- Feature contract tests 验证任意关节角、线段角、踝角、躯干/骨盆关系、器械轨迹和相对轨迹携带单位、coverage、confidence、source range、scope 和 provenance。
- Presence-is-not-quality tests 验证 Feature 有值但没有适用 comparison/rule 时不能产生 observed acceptable。
- Rep tests 验证主轨迹、佐证、滞回、最小幅度、阶段最短持续和端点规则；骨架与器械冲突不能静默改变边界。
- Bilateral tests 覆盖单刚体两端、双独立哑铃、机器独立手柄、unilateral 和 alternating；不得假设所有双侧动作共享一个合并轨迹。
- View tests 验证侧面优先矢状投影且不声称杠铃两端平衡，正面优先左右差且不声称可靠前后距离，斜角只使用 exact-view reference。
- Missing/occlusion tests 验证缺失关节只使依赖维度 cannot judge，其他可观察事实继续保留；Predicted 点不能在禁止的规则中冒充 Measured/Fused。
- Reference tests 验证 first-set no-reference、compare-before-update、same-session source set/rep provenance、exact-context isolation 和 governed reference hash。
- Set aggregation tests 验证 late-set ROM reduction、phase slowing、persistent compensation、bilateral drift 和 isolated outlier 的外部报告差异。
- Trace tests 验证每个用户结论具有真实 source→coordinate→fusion→Rep/phase→Feature→Comparison→Rule→SetPattern→Conclusion 路径；删除任一真实依赖必须使结论拒绝封存。
- Lineage tests 验证 packet、algorithm、config、inference、diagnostic、Bundle、FeatureProgram、Reference 和 RulePack versions/hashes 全部冻结并可解析。
- Idempotence tests 验证重复 finish set 返回相同 assessment identity、内容和 hash，不重跑规则或更新参考。
- Cross-runtime golden tests 验证 Web/WASM 与 native Rust 对相同 canonical stream 输出等价的动作身份、Rep、Feature status、质量维度和 trace semantics。
- Evaluation tests 按 exact action×variant×equipment×view 报告 context coverage、Rep count/boundary、phase、Feature availability/error、quality precision/recall、cannot-judge risk–coverage、set-pattern 和 trace completeness，不允许一个全目录混合识别率。
- Data-split tests 按 participant、source video 和 session 隔离；同视频裁剪、镜像和相邻 Rep 不能跨训练/验证分割。任何正式消费的数据仍需通过治理资产和 admission 校验。
- Good tests 只断言公开生命周期、sealed outputs、refusal 和 trace semantics，不断言内部 struct 布局、DAG 索引或私有函数调用顺序。

## Out of Scope

- Web、Android 或 iOS 的产品页面、相机接入、导航、上传和媒体保留流程。
- 绳索/滑轮/绳头、地雷管/T 杠支点、陷阱杠、壶铃、弹力带及其他未列出的器械识别 Adapter、器械轨迹融合与器械支持的质量开放。若动作存在独立充分的人体 required motion，本规格允许的 pose-supported limited Rep 不表示这些器械 Adapter 已受支持。
- 自动动作分类、自动器械变式猜测或自动机位识别；调用方必须在首帧前提供 exact context。
- 一次性为所有建议细分动作提供经过 held-out evidence 验证的准确率、成熟度或用户开放声明。本规格覆盖的叶级动作定义、通用计算能力、成功计划或合法视觉能力拒绝仍是必须完成的范围，不能以本条为由延期。
- 因为动作进入目录就自动复制父动作 RecognitionProfile、ReferenceProfile、RulePack 或质量结论。
- 为了提高目录通过率而允许缺少必要主运动的半有效计划、无关代理回退或运行时猜测动作语义。
- 在本规格中完成全部用户视频标注。确定性框架和结构化动作定义不依赖新标注开始实现。
- Ordinary user feedback 直接成为质量标签、训练 truth 或运行时阈值更新。
- Runtime 在线学习、自动校准、自动规则改写或自动 Bundle promotion。
- Python、服务端或客户端拥有另一套生产 Rep、关节、器械、质量或 trace 真相。
- 恢复真实物理世界地平线、重力、绝对尺度或通用 3D 人体模型。
- 输出肌肉激活、实际力量、关节力矩、疼痛原因、伤病风险或医学建议。
- 一个跨动作、跨机位、跨器械的通用“标准角度”或不透明总分。
- 对不可观察的肩轴向旋转、脊柱节段或被遮挡关节作确定性判断。
- 为现实中不存在或产品不准备支持的所有字段组合生成笛卡尔积动作。

## Further Notes

- 当前 Rust 固定点仍把 RecognitionProfile、ExecutionContract、FeatureProgram 和 RulePack 作为独立 Bundle 资产加载，并未存在 `ActionMotionDefinition` / `ActionObservationPlan` 代码类型；现有校验主要检查资产之间的字段与维度一致性。因此“唯一动作语义权威并生成/验证下游资产”是本规格必须实现的迁移目标，不是已完成能力。
- 当前 v11 刚体杠 Provider 已实现视频帧约 30 Hz、Pose 约 10 Hz 的独立 cadence，但这个多帧率事实只存在于具体 EquipmentAdapter 资产和实现中，尚未成为通用 ActionObservationPlan 契约。本规格必须保留并泛化该能力，不能把两个通道重新压回一个 packet cadence。
- 当前冻结回放已证明至少一个 pre-contact frame 被升级为 `Measured + canonicalAccepted + fusionEligible`。根因边界是缺少独立的器械归属/握持 lifecycle，而不是页面显示错误；后续实现必须保留 raw detection，同时禁止未建立 grip 的 observation 进入 Rep 因果链。
- 本规格的研究依据是《[通过骨架轨迹与关节夹角判断动作质量：研究结论与 MaxPower 设计建议](../../docs/research/2026-08-15-skeleton-trajectory-joint-angle-exercise-quality-assessment.md)》。第 4–8 节描述计算与判定方法；附录 A.2–A.18 映射当前 70 个动作；附录 A.20 保存已确认审核决定；附录 A.21–A.26 定义动作拆分规则、扩展动作矩阵和统一身份字段。
- 《[MaxPower 扩展动作运动契约](../../docs/research/2026-08-15-expanded-action-motion-definitions.md)》是叶级动作计算定义目录。它明确每个扩展动作哪些关系应该动、哪些应该保持、追踪什么人体/器械轨迹、如何形成 Rep，以及哪些单目结论必须拒绝。
- 当前动作运动契约固定点包含 30 个动作族合同和 248 个无重复叶级动作定义。这个数量描述设计目录而不是已开放能力；后续只能通过受审核的目录变更增加、合并或移除身份，不能由编译器临时生成组合。
- 248 个叶级动作都必须先通过 definition-completeness gate。属于当前支持器械范围或无需器械主轨迹的动作，只有在完整定义证明 Identity-defining motion 超出当前单目/Feature 表达能力时才允许以 `PlanRefusal` 完成能力边界；不支持的器械拓扑若依赖器械必要主运动则保持 `catalog-only` 并返回 `UnsupportedEquipmentTopology`，若独立人体主运动充分则只能获得 pose-supported limited capability，不能伪装成器械支持或视觉拒绝。
- 除经 admissibility test 证明超出当前视觉表达能力的动作外，当前支持的自由杠铃、史密斯杠、哑铃、固定器械把手及无需器械主轨迹动作都必须至少有一个成功机位。其他器械动作本轮只完成定义与能力边界，不声称 Rep 或质量支持。
- 当前 70 个 registry 动作的矩阵只提供动作族起点。实现必须先应用报告中的全动作族扩展矩阵，形成细粒度叶级动作目录，再为叶级动作建立版本化关节、轨迹和判定资产，而不是把父动作中文说明逐条硬编码进通用引擎。
- 全动作族扩展矩阵覆盖卧推/推胸、水平拉、垂直拉、深蹲/弓步、髋铰链、推肩、肩部孤立、肘屈伸、膝屈伸、提踵、核心和移动动作，并先于这些动作的关节与轨迹规则落地。
- 约束优先级为 authoritative Rust motion product contract → 本规格 → 扩展动作运动契约 → 研究报告。配套文档补充逐动作与算法明细，但不得放宽 exact-context、证据可追溯、typed abstention、单一 Rust Provider 或能力晋升要求；发生冲突时必须更新文档并显式解决，不能由实现自行选择。
- 当前 70 个动作结构覆盖与用户可见质量支持是两个指标。一个动作只有 catalog definition 时仍可能无法计次或评价；产品必须诚实展示 capability state。
- 细粒度动作身份是用户可见目录概念，结构化 identity fields 是内部验证和复用机制。调用方不能自由组合字段创建未审核动作。
- strict barbell row 的“大幅髋/躯干移动”语义已经确认，但数值门槛仍需在 exact camera view 与 held-out evidence 上确定。实现可以先完成 Feature、Trace、typed abstention 和规则资产接口，不得先发明跨机位常量。
- 本规格与已有 motion-understanding vNext 的关系是扩展而非替代：vNext 已建立完整引擎和当前 24 exact contexts，本规格要求把动作选择从有限静态 Bundle 推进为全目录结构化动作语义与细粒度 variant 体系。
- 本规格不削弱 authoritative Rust motion product contract 的全目录、证据、拒绝、Trace 和单一 Provider 原则。
