# 器械轨迹 × 人体骨架：负重动作生物力学融合研究与 Rust 因果规格

日期：2026-08-12
状态：工程研究报告；用于确定下一版数据契约与最小验证，不是临床、动力学或生产阈值标准。

## 1. 先给结论

1. **器械不是次要或 fallback 通道。** 对负重动作，器械轨迹是离心、换向、向心、行程和外部负荷路径的中心证据；骨架解释人体通过哪些关节与节段策略生成该轨迹。两者应共同估计一个潜在动作阶段，而不是执行“骨架优先”或“器械优先”的硬规则。【产品约束；工程结论】

2. **融合的对象不是两条最终答案，而是两组独立原始观测。** `raw_pose` 与 `raw_equipment` 必须独立保存、独立质控，再共同产生 `latent_phase`、分维度指标和可选的 `equipment_conditioned_pose`。【工程规格】

3. **器械约束修复后的骨架不是第二份独立骨架证据。** 它继承器械与原始骨架的全部 provenance；若再与器械轨迹相互“佐证”，就是循环证据和置信度双计数。【工程规格】

4. **融合提高的是运动学解释，不自动升级为动力学。** 视频可以测位置、方向、时序、投影角度和速度代理；准确关节净力/力矩仍要求个体模型、惯性参数及所有重要外力。OpenSim 的逆动力学输入要求明确支持这一边界（[OpenSim](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics)）。【引用事实】

5. **接触是约束，不是已测得的力。** “双手握同一刚性杠”“单手握一只哑铃”“脚接触地面”“背部接触凳面”可以缩小几何可行域，但不能从单目 RGB 唯一恢复双手受力分配、地面反作用力、摩擦力、关节力矩或肌肉贡献。【力学推论】

6. **杠铃与双哑铃必须使用不同的观测拓扑。** 杠铃提供跨双手的共享刚体位置、方向与同步约束；成对哑铃是两个可独立运动、独立遮挡、独立换向的负重对象，不能强制成一条“虚拟杠”。【工程结论】

7. **产品输出仍是 dimensions + `cannot_judge`，不是总分。** 同一 rep 可以阶段完整、器械路径偏离、骨架双侧不可判、动力学不适用；一个分数会掩盖这些不同证据状态（[现有评估标准](../design/ai-coach-training-execution-assessment-standard-v0.1.md)）。【本地产品标准】

8. **生产路径应固定为客户端视觉观测 → Rust 因果融合。** 人体通道已经是 YOLOX person + RTMPose Halpe-26；器械通道当前已有因果 LSD 杠轴检测与 alpha-beta 追踪原型，但还没有接入 Android/iOS/Web 摄像头逐帧生产端，也不是已经训练好的 YOLOX 杠铃/哑铃类别。Python 只用于现有离线原型、回放、标注辅助和验收；正式产品必须将经过验证的器械观测生产器移植或训练为客户端可运行实现，再与人体观测一起送入 Rust。【当前仓库事实；产品约束；工程结论】

9. **当前个人卧推链路已经证明既有六条视频上的 Rep/阶段精度，但尚未证明泛化与骨架像素精度。** Web 单次因果链路的可观察通道找回 46/46 Rep，turnaround ±250 ms 为 97.8%；pose-only 消融 recall 仅 21.7%。由于没有新用户/新场地留出和独立关键点像素真值，仍不能直接晋升生产（[当前卧推报告](../reports/current-barbell-bench-recognition.md)）。【本地实验事实】

### 1.1 当前实现与目标设计不能混称

| 能力 | 当前状态 | 证据/边界 |
| --- | --- | --- |
| 杠轴逐帧识别与追踪 | 已实现研究原型 | LSD 横向杠轴候选 + 因果背景 + alpha-beta path；不读未来帧或 rep 标签，已经生成连续叠图和 sidecar |
| Rust 器械 observation、主体关联和稳定 track id | 已实现 | `equipment_fusion.rs` 接受 detector/geometry observation，拒绝已声明镜像/静态架候选，并关联锁定主体 |
| Rust 卧推杠铃 phase/rep | 已实现实验图 | `barbell_phase.rs` 以当前杠轴轨迹识别 ready、下放、换向和返回，并把 pose 作为可选对照；它仍是器械边界主导逻辑，不是第 6 节提出的联合 latent-phase 模型 |
| Native/WASM 器械输入 ABI | 已实现 | 同一个 source timestamp 的 pose/equipment 数组可以一起进入 Rust |
| Android 摄像头实时器械观测生产 | 未接通 | 当前 `PoseCameraView.kt` 只传 YOLOX person + RTMPose Halpe-26；`equipmentIds/equipmentMetadata` 仍为空 |
| iOS/Web 摄像头实时器械观测生产 | 未验收 | 已有 ABI/回放接口不等于实际摄像头生产端已经运行 |
| YOLOX 杠铃/哑铃类别模型 | 未实现/未训练 | 当前 HumanArt YOLOX 是人物检测；不可把 LSD 原型称为 YOLOX 器械检测 |
| 两只哑铃独立检测、身份和逐侧 phase | 未实现 | MM-Fit 队列仍把腕部 ROI 当标注建议，不是器械真值；没有训练好的 dumbbell detector |
| raw/derived provenance 去重与联合 phase posterior | 目标设计，未完成 | 当前 Rust 能保留部分 source/status，但没有 EvidenceRoot DAG、correlation group 或联合后验 |

因此，“已经实现杠铃识别”和“尚未完成客户端实时融合”可以同时成立：前者指已有因果杠轴算法、轨迹叠图和 Rust 消费实验；后者指摄像头每帧的器械视觉生产端及联合融合尚未闭环。【审查后澄清】

## 2. 生物力学边界：运动学、动力学与接触约束

### 2.1 运动学不等于动力学

**运动学（kinematics）**描述“怎么动”：位置、位移、角度、速度、加速度、阶段、端点、路径和时序。

**动力学/动力学量（kinetics）**描述“什么力造成运动”：外力、净关节力与力矩、功、冲量、接触力和可能的肌肉力分配。

OpenSim 的逆动力学用运动学、带惯性参数的个体模型和外部载荷求解净关节广义力；其文档强调，为准确计算关节力和力矩，需要测量、施加或建模全部外力及作用点（[OpenSim](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics)）。【引用事实】

因此，单目器械 + 骨架融合可以输出：

- 器械和关节的 2D/弱 3D 轨迹、速度与时序；
- rep、阶段、实际极值、返回端点和停顿；
- 器械相对人体的路径、双侧同步与动作策略；
- 已知质量、可靠尺度和可靠 3D 轨迹时的外部机械量代理。

它不能仅凭这些输出：

- 左右手或左右脚真实受力；
- 净关节力矩、脊柱载荷或关节接触力；
- 单块肌肉激活、肌肉力或刺激百分比；
- 腹压、疼痛原因、RPE/RIR 或伤病概率。

Ray3D 将单目绝对 3D 姿态明确描述为病态问题，并展示相机内参与外参变化会影响绝对定位泛化。由此推导出的产品要求是：所有度量保留机位、尺度和校准置信度，而不把模型 3D 当测量真值；具体校准策略仍须由本系统验证（[Ray3D](https://openaccess.thecvf.com/content/CVPR2022/html/Zhan_Ray3D_Ray-Based_3D_Human_Pose_Estimation_for_Monocular_Absolute_3D_CVPR_2022_paper.html)）。【引用支持的工程推论】

### 2.2 接触约束能提供什么

接触关系可形成运动学可行域：【工程假设】

- **手—杠铃：**可靠握持期间，双手应邻近同一杠体；一般负重下可用中心、轴线与端点描述共享对象状态。重载下的杠体弹性形变/振动是边界条件，端点高度差不能未经验证直接归因于人体双侧不对称；杠型和可观察形变应进入动作合同。
- **手—哑铃：**每只手只约束对应哑铃；左右对象可不同步、不同路径、不同可见性。
- **脚—地面：**支撑期脚点应相对地面近似稳定；走步弓步则必须显式建模接触建立与解除。
- **背—凳：**卧推中凳面可约束整体支撑几何，但普通骨架不能可靠恢复肩胛接触、胸椎形态或接触压力。
- **杠—地面/身体：**硬拉盘片触地、卧推触胸只有接触区域真正可见且检测器经过验证时才可确认；接近不等于接触。

接触约束仍不能确定：【力学边界】

- 接触力大小、方向和左右分配；
- 手是否滑动、脚底压力中心或摩擦裕量；
- 遮挡下的真实接触，或由“标准动作先验”补造出的接触；
- 多个肌肉和关节如何共同满足同一器械轨迹。

### 2.3 器械能确定与不能确定的内容

| 器械证据可直接支持 | 与骨架融合后可条件化支持 | 仍不能确定 |
| --- | --- | --- |
| 对象身份、中心/端点、方向、投影位移、速度、换向、停顿、共享或独立负重拓扑 | 阶段语义、相对躯干路径、关节—器械同步、ROM、策略漂移、双侧运动学差异 | 外力分配、地面反作用力、净关节力矩、肌肉激活、疼痛、努力和训练效果百分比 |

关键工程含义是：器械轨迹回答“外部负重如何移动”，骨架回答“人体如何组织运动”；任何一方都不是另一方的附属替代物。【工程结论】

## 3. 预期离心、换向、向心的联合定义

这些标签是 **exercise semantics**：在动作变式、负重模式、起始状态和训练意图已知时，对通常克服或顺应外部阻力阶段的命名；它们不是肌纤维长度或激活的直接测量（[既有研究定义](./2026-08-09-training-purpose-biomechanics-ai-coach-completion.md)）。【本地产品标准】

### 3.1 通用状态

- `expected_eccentric`：器械沿该动作定义的受控返回/下放方向运动，同时相关骨架关节按变式预期协调；允许器械或骨架短暂缺失，但必须反映不确定性。
- `turnaround`：器械主运动速度接近零并改变符号，且骨架的相关关节速度/角度也出现相容转换；它可以包含计划停顿。
- `expected_concentric`：器械沿该动作定义的克服外部阻力方向运动，同时相关骨架关节按变式预期协调。
- `hold`：器械与关键身体段均处于意图允许的低速度区间，但不自动等于肌肉等长收缩。
- `unknown`：动作身份、方向、可见性、连续性或通道冲突不足以支持上述语义。

联合阶段是潜变量，而非屏幕 `y` 方向规则：【工程规格】

```text
P(phase_t | phase_<t, intent, raw_equipment_<=t, raw_pose_<=t,
            view, visibility, continuity, channel_calibration)
```

对同一个 `turnaround_ms`，系统只能在后续帧到达后以 `confirmed_at_ms` 确认；实时预测与事后确认必须保留不同 provenance（[卧推实时契约](../design/barbell-bench-press-realtime-assessment-contract-v0.1.md)）。【本地产品标准】

### 3.2 动作语义示例

| 动作合同 | `expected_eccentric` | `turnaround` | `expected_concentric` |
| --- | --- | --- | --- |
| 平板卧推，从锁定端开始 | 杠向躯干移动 + 肘屈曲增加 | 实际最低点/计划停顿，随后方向反转 | 杠离开躯干 + 肘伸展增加 |
| 深蹲，从站立开始 | 负重与髋下降 + 髋膝屈曲增加 | 实际深度极值/停顿 | 负重与髋上升 + 髋膝伸展增加 |
| 地面硬拉 | 通常先向心：杠离地 + 髋膝伸展 | 顶端锁定/返回转换 | 返回时为离心：杠下降 + 髋膝按合同屈曲；状态顺序由合同声明 |
| RDL，从站立开始 | 杠沿腿下降 + 髋屈曲主导、膝角相对稳定 | 计划下端/实际可控极值 | 杠上升 + 髋伸展主导 |
| 弓步/分腿蹲 | 负重和骨盆下降 + 支撑腿关节屈曲 | 最低点/步态转换 | 负重和骨盆上升 + 支撑腿伸展 |
| 过顶推举，从肩位开始 | 首阶段通常不是离心；回程时负重下降 + 肘屈曲 | 肩位或顶端转换，依 rep 边界合同 | 负重上升 + 肘伸展/上臂抬高 |
| 划船/弯举，从伸臂端开始 | 回程时器械远离向心终点 + 肘伸展增加 | 伸臂端或收缩端转换 | 器械接近目标终点 + 肘屈曲增加 |

动作合同必须显式声明 `phase_order`，否则把所有 rep 强制为“离心→向心”会误判地面硬拉、过顶推举、划船和弯举。【工程结论】

## 4. 杠铃与成对哑铃

### 4.1 杠铃：共享刚体约束

杠铃应建模为一个对象轨迹：`center + axis/endpoints + orientation + scale + confidence + deformation_status`。【工程规格】

- 双手与同一对象接触，杠轴方向和两端高度可支持动态倾斜、共享换向与双侧时序。
- 共享刚体能帮助识别某个腕点漂移，但修复结果必须标为 `equipment_conditioned`。
- 杠铃相同不代表两侧受力相同；双侧力分配在单目视频中通常不可辨识。
- 杠型是动作合同的一部分。直杠与六角杠硬拉可产生不同运动学和关节力矩分布（[Swinton et al., PMID 21659894](https://pubmed.ncbi.nlm.nih.gov/21659894/)）；传统杠与安全深蹲杠也产生不同髋膝角度和关节力矩结果（[Johansson et al., PMID 38595263](https://pubmed.ncbi.nlm.nih.gov/38595263/)）。【引用事实】

### 4.2 成对哑铃：两个独立负重对象

成对哑铃应建模为 `left_equipment_track` 与 `right_equipment_track`，每个对象具有独立的存在概率、轨迹、换向与遮挡状态。【工程规格】

- 可以比较左右位移、速度曲线、端点和换向时差。
- 不应将两只哑铃平均后生成“虚拟杠”；这样会消除真正的单侧差异，并在一侧遮挡时伪造同步。
- 哑铃携带侧本身改变动作上下文。分腿蹲/走步弓步中，同侧与对侧持铃条件包含不同的髋膝 ROM 与 EMG 表现（[Stastny et al., PMID 25968228](https://pubmed.ncbi.nlm.nih.gov/25968228/)）。【引用事实】
- 每只哑铃还可具有独立方向和绕轴旋转；只有检测器与机位能可靠观察时才输出该特征，否则 orientation/rotation 应为 `cannot_judge`，不能由腕部朝向补造。
- 一只哑铃缺失时，另一只仍可支持其对应侧器械维度；双侧比较必须 `cannot_judge`，不能用骨架腕点补成第二只哑铃后宣称器械对称。

## 5. 分动作证据映射

表中“融合指标”与拒判规则是工程假设，必须经第 8 节实验验证；引用只支持动作相关的生物力学差异，不提供产品阈值。

| 动作 | 器械可观察 | 骨架可观察 | 融合指标 | `cannot_judge` | 机位限制 |
| --- | --- | --- | --- | --- | --- |
| 卧推 | 杠中心/轴线/端点、下降/上升、最低点、速度、动态倾斜、相对躯干路径 | 腕肘肩、肘屈伸、左右时序、肩髋整体漂移 | 联合 phase、实际底点与确认延迟、肘—杠同步、左右换向差、rep 内路径与组内漂移 | 杠或双肘持续遮挡；无法验证触胸；不能判断肩胛、左右力量、关节力矩；凳面/胸廓/拱背上下文不足时不把绝对杠行程直接等同肩关节 ROM | 脚端正面利于双侧；侧面/验证过的 45° 才适合前后杠路与触点。疲劳组中杠速和杠路会变化（[Duffey & Challis, PMID 17530967](https://pubmed.ncbi.nlm.nih.gov/17530967/)）；ROM 会改变速度关系和 sticking region（[Martínez-Cava et al., PMID 31827348](https://pubmed.ncbi.nlm.nih.gov/31827348/)） |
| 深蹲 | 杠/安全杠或双哑铃的垂直行程、倾斜、相对脚/躯干投影 | 髋膝踝、躯干、小腿、骨盆和左右时序 | 下降—底部—上升、深度代理、杠—躯干协调、髋膝时序、路径漂移 | 脚或髋缺失；杠位遮挡；不能判断 GRF、COM、脊柱载荷和真实力矩 | 侧面看矢状策略，正面看左右差。限制膝过脚会同时改变膝 ROM 与躯干运动（[List et al., PMID 22990570](https://pubmed.ncbi.nlm.nih.gov/22990570/)）；杠型必须入合同（[Johansson et al.](https://pubmed.ncbi.nlm.nih.gov/38595263/)） |
| 硬拉 | 杠离地、上升/下降、贴身距离代理、顶端与地面端、路径水平漂移 | 髋膝角、躯干角、肩髋同步、锁定姿态 | 地面接触→向心→锁定→返回；杠—胫/股相对路径；髋膝贡献的运动学代理 | 盘片/地面接触不可见；膝髋遮挡；不能判断腰椎/髋净力矩 | 侧面优先，正面只补双侧。DL 与 good morning 可有相似躯干运动但显著不同膝髋运动与力矩（[Schellenberg et al., PMID 24314057](https://pmc.ncbi.nlm.nih.gov/articles/PMC3878967/)）；直杠与六角杠不可共用合同（[Swinton et al.](https://pubmed.ncbi.nlm.nih.gov/21659894/)） |
| RDL | 杠从顶端沿腿下降、下端换向、返回、与腿距离 | 髋屈伸主导、膝角稳定范围、躯干—骨盆策略 | 离心下放→下端→向心返回；杠—髋同步；膝漂移；是否变成更蹲式或 good-morning 式策略 | 杠/髋/膝不可见；不能从外观判断腘绳肌张力或腰椎载荷 | 侧面/45° 优先。DL 与 GM 研究说明必须联合关节与负重语义识别动作，而非只看躯干（[Schellenberg et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC3878967/)） |
| 前弓步 | 每只哑铃/杠的下降、上升、左右持载位置与路径 | 跨步、脚接触、前后腿髋膝踝、骨盆和躯干 | 接触建立→离心下降→最低点→向心推进；负重侧与支撑侧绑定；步长和关节 ROM | 脚接触或负重侧未知；不能判断各腿受力和关节功 | 45° 或侧面看步态与深度，正面补额状差。增加负重可在峰值关节角变化不大时显著改变关节机械功，说明仅看姿态不足（[Riemann et al., PMID 22889652](https://pubmed.ncbi.nlm.nih.gov/22889652/)） |
| 分腿蹲 | 杠或左右哑铃的周期路径、持载侧 | 固定错步站姿、前后腿 ROM、骨盆/躯干、左右时序 | 下降—换向—上升、支撑脚稳定、同侧/对侧持铃条件、负重—骨盆同步 | 持载侧或前后脚身份不可靠；不能判断真实负重分配与 EMG | 侧/45° 主视角；携带位置是合同字段，不能忽略（[Stastny et al.](https://pubmed.ncbi.nlm.nih.gov/25968228/)） |
| 过顶推举 | 杠或两哑铃从肩位到顶端的路径、头部绕行、左右端点/换向 | 肩肘腕、上臂抬高、躯干后仰/侧移、膝髋是否参与 | 肩位→向心→顶端→离心返回；肘—器械同步；strict/借力策略；双哑铃独立协调 | 头/器械重叠；肩位端点不可见；不能判断肩胛运动、肌肉激活或脊柱载荷 | 正面看双侧，侧面看躯干和前后杠路。杠铃、机器、前后颈变式的 EMG 不同，设备/变式必须入合同（[Coratella et al., PMID 35936912](https://pmc.ncbi.nlm.nih.gov/articles/PMC9354811/)） |
| 俯身划船 | 杠/哑铃相对躯干的靠近、远离、端点、左右路径 | 肘屈、肩伸代理、躯干角与摆动、肩线 | 向心拉近→顶端→离心返回；器械—肘同步；strict 约束；借助髋/躯干的时序 | 器械或肘不可见；不能判断实际背阔肌/斜方肌贡献 | 侧面/45° 较适合器械—躯干关系；本行是待验证工程假设，所列主来源没有直接 row 研究 |
| 弯举 | 杠或左右哑铃的弧形轨迹、端点、换向与左右差 | 肘屈伸、上臂漂移、躯干/髋先行加速 | 向心弯举→顶端→离心返回；器械—肘同步；strict/cheat 合同；双哑铃独立时序 | 肘或器械遮挡；不能判断肱二头肌激活、肘力矩或 RIR | 侧面/45°；本行是待验证工程假设，所列主来源没有直接 curl 研究 |

Pearson 等在 12 名有力量训练经验的精英男性帆船运动员、10–100% 1RM 负荷范围内比较卧推/卧拉的力、速度和功率，结果随动作与负荷而变；这支持产品只有在负荷和器械轨迹可靠时才讨论外部输出代理，而不能从骨架速度单独命名为功率。该小样本和人群不能直接外推到初学者或其他人群（[PMID 19891202](https://pubmed.ncbi.nlm.nih.gov/19891202/)）。【引用事实；范围有限】

## 6. Rust 因果融合规格

### 6.1 运行时边界

```text
camera frame
  ├─ YOLOX person → RTMPose Halpe-26 raw keypoints
  └─ equipment observation producer
       ├─ current research: causal LSD bar-axis + tracker
       └─ product candidate: client port or trained barbell/dumbbell detector + tracker
                    ↓ same frame_id / capture timestamp
            Rust causal observation buffer
                    ↓
       independent feature likelihoods
                    ↓
            latent phase filter
          ├─ dimension assessments
          ├─ provisional/confirmed events
          └─ equipment-conditioned pose (derived output only)
```

Python 可消费同一序列做回放、标注建议和指标计算，但生产行为以 Rust 对“截至当前帧”的结果为准。【工程规格】

当前 Android 尚未实现图中第二条摄像头分支，页面回放读取的是原型生成的逐帧 sidecar；这不否定已有杠铃识别，只说明尚未完成真实客户端闭环。【当前实现边界】

### 6.2 最小数据类型

```rust
struct RawPoseFrame {
    frame_id: u64,
    captured_at_ms: i64,
    person_track_id: u32,
    halpe26: [Keypoint2d; 26],
    detector_confidence: f32,
    model_version: ModelVersion,
}

struct RawEquipmentFrame {
    frame_id: u64,
    captured_at_ms: i64,
    tracks: Vec<EquipmentTrack>, // barbell: one rigid track; dumbbells: two tracks
    model_version: ModelVersion,
}

enum Phase { Ready, ExpectedEccentric, Turnaround, ExpectedConcentric, Hold, Unknown }
enum Judgement { Meets, PartiallyMeets, Deviates, CannotJudge, NotApplicable }
enum Channel { RawPose, RawEquipment, Intent, Camera, HumanLabel }

struct EvidenceRoot {
    id: EvidenceId,
    channel: Channel,
    frame_id: Option<u64>,
    transform: TransformId,
}

struct Derived<T> {
    value: T,
    confidence: f32,
    uncertainty: Uncertainty,
    roots: SmallVec<[EvidenceId; 8]>,
    correlation_group: CorrelationGroupId,
}
```

### 6.3 独立通道与潜在阶段

`raw_pose` 特征只从 Halpe-26 原始点与其质量产生；`raw_equipment` 特征只从 YOLOX/器械几何和对象跟踪产生。任何修复点不得进入这两组 likelihood。【工程不变量】

推荐使用受动作合同约束的因果状态滤波器，而不是硬优先级：【工程假设】

```text
log posterior(phase_t)
  = transition_prior(phase_t | phase_t-1, exercise_contract)
  + reliability_equipment × log L(raw_equipment_features | phase_t)
  + reliability_pose      × log L(raw_pose_features | phase_t)
  - conflict_penalty
```

权重来自分通道可见性、连续性、对象身份、机位适配和校准结果；不是固定“器械 > 骨架”或“骨架 > 器械”。

上式是目标模型而非当前 `barbell_phase.rs` 的描述。当前实现以杠轴位移确定边界、以 pose extreme 做可选对照；迁移时应先实现可校准的 evidence score/state filter，再决定是否需要完整概率后验。若两通道存在共享根证据，不能假设条件独立，必须用 `correlation_group` 去重或联合建模。【审查后工程约束】

### 6.4 置信度与不确定性

每个输出至少分开保存：【工程规格】

- `observation_confidence`：检测和跟踪是否可靠；
- `phase_posterior`：状态后验分布，而非只有 argmax；
- `event_time_interval_ms`：换向/端点时间的不确定区间；
- `calibration_bucket`：动作 × 器械 × 机位 × 设备条件下的校准桶；
- `judgement`：允许 `cannot_judge`，不能用低置信数值伪装答案。

整体模型高置信不等于每个维度可判断。比如杠轨迹可靠可以确认 phase，但肘遮挡时 `elbow_rom = cannot_judge`。【工程不变量】

### 6.5 缺失数据

- 通道短暂缺失：保留最后状态分布并扩大不确定性；只允许有限 TTL，不做无限外推。
- 器械缺失：骨架可以支持部分 phase，但所有依赖真实器械路径的维度拒判。
- 骨架缺失：器械仍可支持外部轨迹和 phase，但人体策略、关节 ROM 和代偿拒判。
- 成对哑铃缺一侧：保留可见侧；双侧器械比较拒判。
- 两通道都不足：`phase = Unknown`，不封装 rep，不生成技术 cue。

### 6.6 冲突处理

冲突包括方向相反、时间戳错位、错误人物—器械绑定、腕—器械距离不可能、杠刚体几何破坏、左右哑铃 identity switch。【工程规格】

处理顺序：

1. 检查时间同步、镜像、坐标变换和 track identity；
2. 给冲突生成独立事件与 provenance；
3. 扩大阶段不确定性；
4. 仅输出仍有独立证据支持的维度；
5. 不选择“更符合标准动作”的通道补造事实；必要时 `cannot_judge`。

### 6.7 器械条件化骨架与禁止循环证据

`equipment_conditioned_pose` 可用于叠图、轨迹连续化和明确声明过的派生指标，但必须满足：【工程不变量】

```text
equipment_conditioned_pose.roots
  = union(raw_pose.roots, raw_equipment.roots, contact_constraint.roots)
```

- 字段名不得叫 `raw_pose` 或 `measured_pose`；
- 每个修复点保存原始值、修复值、位移量、约束类型和根证据；
- 证据聚合器按 root 集合去重；根集合重叠的派生量不得作为独立 corroboration；
- `latent_phase` 不得再读取由该 `latent_phase` 参与生成的修复点；
- 渲染层可以显示修复结果，评估层必须可回放独立原始通道。

建议把 provenance 实现为只允许从 raw roots 指向 derived nodes 的 DAG，并在 Rust 单元/属性测试中拒绝环和重复根计数。移动端热路径可使用紧凑 root bitset / correlation id，仅在 sealed rep 或 full diagnostics 中物化完整 DAG，避免为每帧分配大量 `EvidenceId` 容器。【工程建议】

### 6.8 分维度输出

```rust
struct RepAssessment {
    phase_execution: DimensionAssessment,
    equipment_path: DimensionAssessment,
    joint_rom: DimensionAssessment,
    torso_pelvis_strategy: DimensionAssessment,
    bilateral_kinematics: DimensionAssessment,
    tempo: DimensionAssessment,
    contact_visibility: DimensionAssessment,
    stimulus_compatibility: DimensionAssessment,
    measurement_limits: Vec<LimitCode>,
}
```

每个 `DimensionAssessment` 保存 `judgement`、置信度、证据根、替代解释和适用机位；不得生成 0–100 总分。【产品不变量】

## 7. 低负担标注方案

沿用现有 rep `start_ms` / `end_ms`，不要求逐帧重画骨架或器械。【工程建议】

本节描述的是下一版审核流程，不是当前 MM-Fit 工具已经具备的能力：现有 dumbbell review queue 仍是 set-count 粒度、`repBounds` 为空，腕 ROI 只是标注建议，并明确记录 `no_dumbbell_detector_trained`。【当前实现边界】

每个已切分 rep 自动给出：

- `proposed_turnaround_ms` 与不确定区间；
- `proposed_phase_order`；
- 原始器械轨迹与原始骨架轨迹的分层叠图；
- 通道冲突、遮挡和当前 `cannot_judge` 原因。

审核者只做一次主操作：【工程建议】

1. `confirm`：换向正确；
2. `adjust`：拖动到正确帧；
3. `reject/cannot_judge`：没有可靠换向，并选择遮挡、错绑、错误 rep、刻意停顿或其他原因。

额外只确认四个 rep 级上下文：动作变式、杠铃/双哑铃拓扑、主机位、是否刻意 partial/停顿。其余字段从训练合同继承。

标签必须保存：`human_confirmed_at_ms`、审核者、原提案、最终值、原始通道版本和 overlay 版本；自动提案不能覆盖人工标签，也不能被当作独立真值。【工程不变量】

对当前卧推 46 个 Rep，应增加一个小型独立 spot-check：人工标杠轴中心/方向和可见腕点，而非继续扩大自动生成标签。它直接检验现有“Rep/阶段已对齐但未证实像素精度”的缺口（[当前卧推报告](../reports/current-barbell-bench-recognition.md)）。【直接建议】

## 8. 可证伪的最小实验

所有实验先冻结动作合同、参与者划分、指标和阈值；每项只改变一项变量。

| 实验 | 唯一改变变量 | 其余固定 | 必需数据 | 成功信号 | 失败信号 |
| --- | --- | --- | --- | --- | --- |
| E1 联合 phase | 输入从“最佳单通道”改为“独立双通道融合” | 同一模型版本、视频、因果窗口、rep 标签 | ≥3 动作、每动作≥100 个独立人工换向；含遮挡 | 相对最佳单通道，换向 MAE 降低≥20%，rep F1 不降>1 个百分点，ECE 不恶化>0.02 | 误差无改善、仅置信度升高，或冲突样本更差 |
| E2 器械拓扑 | `shared_barbell` 改为 `paired_dumbbells` | 同一动作、机位、参与者、标注方法 | 双哑铃卧推或推举，逐侧换向与对象 identity 真值 | 逐侧换向 MAE/identity switch 优于虚拟杠基线；真实异步不会被抹平 | 两模型无差异，或独立拓扑增加错误配对 |
| E3 可控遮挡 | 只改变器械通道的人工遮挡窗口 | 同一原始序列和算法 | 有完整真值的 clean clips；随机遮挡 300–800 ms | 不生成虚假器械证据，受影响维度 `cannot_judge` recall≥95%，未受影响 pose 维度保持 | 用腕点伪造器械、封装错误 rep 或拒判蔓延到无关维度 |
| E4 禁止双计数 | 只改变聚合器：provenance 去重 vs 把 repaired pose 当独立证据 | 同一预测与标签 | 专门包含 pose—equipment 冲突的 rep | 去重版在正确率相当时 Brier/ECE 更好，且冲突置信度更低 | 去重无校准收益，或 DAG 仍出现重复根 |
| E5 机位 | 只改变同步相机机位：正面、侧面、45° | 同一 rep、负重、参与者和时间 | 同步多视角采集及同一事件真值 | 各维度按预注册机位排序；不适合机位能正确拒判 | 所有机位给相同高置信结果，或 view contract 不能预测误差 |
| E6 检测器晋级 | 只改变器械检测：当前 classical prototype vs YOLOX 路径 | 同帧、同跟踪器、同因果滤波 | ≥500 帧独立杠轴/哑铃框标注，按视频留出 | 中心/轴误差、覆盖与 identity 指标达到预注册门槛且跨视频泛化 | 只在原 6 视频有效，或覆盖高但像素误差/错绑不合格 |
| E7 Rust 因果一致性 | 只改变实现：冻结离线参考 vs Rust causal | 相同逐帧模型输出和配置 | 记录的 YOLOX + Halpe-26 流，含乱序/丢帧 | phase、事件和 provenance 在容差内一致；确认延迟、内存和帧预算达标 | Rust 依赖未来帧、事件时间漂移、丢帧时不拒判或 provenance 不一致 |

E1、E3、E4 是融合正确性的最小门禁；E6、E7 是从原型进入产品链路前的最小门禁。统计阈值属于工程假设，应在采集前锁定，不能看结果后调整。【工程建议】

## 9. 直接建议与停止事项

### 9.1 直接建议

1. 新建一个版本化 `EquipmentPoseFusionContract`，把 `exercise_variant × equipment_topology × phase_order × required_view × dimensions` 固化为 Rust 可读配置。
2. 先实现 raw 通道、时间同步、provenance DAG、`cannot_judge` 和因果事件；再实现设备条件化骨架。
3. 每个负重动作把器械 phase likelihood 与骨架 articulation likelihood 同时送入潜在阶段滤波器。
4. 杠铃和双哑铃使用不同对象拓扑、不同缺失策略和不同双侧指标。
5. 将器械检测质量与评估质量分开验收：像素/identity/coverage 通过后，才评价 phase 和 coaching。
6. 先执行 E1、E3、E4；通过后再扩展动作和提示文案。
7. 将人工工作集中在换向确认、冲突和小型独立器械/腕点真值，不做大规模逐帧重标。
8. 对 row/curl 只开放运动学维度；在补充直接主来源和动作数据前，不开放肌群/动力学主张。
9. 保留并复用现有因果 LSD 杠轴原型作为客户端移植候选和 detector baseline；不要因为未来可能训练 YOLOX 器械类别就丢弃已经验证过的杠轴几何能力。
10. 若 E1 证明某个动作 × 机位下某一通道对 phase 没有增益，允许融合器把该 likelihood 权重校准到接近零；但仍保留另一通道独立支持的器械路径或人体策略维度，不能退回全局硬优先级。

### 9.2 停止做

- 停止把器械称为骨架失败后的 fallback。
- 停止用固定通道优先级替代联合概率与冲突处理。
- 停止用腕点充当已测得的杠铃/哑铃轨迹。
- 停止把 equipment-conditioned repaired pose 再算作独立 pose corroboration。
- 停止让潜在 phase 读取由自身生成的修复点。
- 停止用屏幕向上/向下直接命名向心/离心。
- 停止把不同杠型、机器、双哑铃和动作变式放进同一标准 envelope。
- 停止用 Python 离线平滑、未来帧或回放速度代表产品运行时。
- 停止输出一个“标准度/完成度总分”；保留 dimensions、证据、限制和 `cannot_judge`。
- 停止从器械 + 骨架轨迹宣称左右力量、净关节力矩、肌肉激活、刺激百分比或伤病因果。

## 10. 来源

### 本地产品与原型资料

1. [AI 教练训练执行评估标准 v0.1](../design/ai-coach-training-execution-assessment-standard-v0.1.md)。
2. [从训练目的与生物力学定义 AI 健身教练的动作完成度](./2026-08-09-training-purpose-biomechanics-ai-coach-completion.md)。
3. [平板杠铃卧推实时轨迹与训练执行评估契约 v0.1](../design/barbell-bench-press-realtime-assessment-contract-v0.1.md)。
4. [Current barbell bench recognition](../reports/current-barbell-bench-recognition.md)。

### Primary sources

1. OpenSim. [Getting Started with Inverse Dynamics](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics).
2. Duffey MJ, Challis JH. [Fatigue effects on bar kinematics during the bench press](https://pubmed.ncbi.nlm.nih.gov/17530967/). PMID 17530967.
3. Pearson SN, Cronin JB, Hume PA, Slyfield D. [Kinematics and kinetics of the bench-press and bench-pull exercises in a strength-trained sporting population](https://pubmed.ncbi.nlm.nih.gov/19891202/). PMID 19891202.
4. Martínez-Cava A, et al. [Range of Motion and Sticking Region Effects on the Bench Press Load-Velocity Relationship](https://pubmed.ncbi.nlm.nih.gov/31827348/). PMID 31827348.
5. Schellenberg F, et al. [Kinetic and kinematic differences between deadlifts and goodmornings](https://pmc.ncbi.nlm.nih.gov/articles/PMC3878967/). PMID 24314057; PMCID PMC3878967.
6. Swinton PA, et al. [A biomechanical analysis of straight and hexagonal barbell deadlifts using submaximal loads](https://pubmed.ncbi.nlm.nih.gov/21659894/). PMID 21659894.
7. List R, et al. [Kinematics of the trunk and the lower extremities during restricted and unrestricted squats](https://pubmed.ncbi.nlm.nih.gov/22990570/). PMID 22990570.
8. Johansson DG, et al. [A Biomechanical Comparison Between the Safety-Squat Bar and Traditional Barbell Back Squat](https://pubmed.ncbi.nlm.nih.gov/38595263/). PMID 38595263.
9. Riemann BL, et al. [Biomechanical analysis of the anterior lunge during 4 external-load conditions](https://pubmed.ncbi.nlm.nih.gov/22889652/). PMID 22889652.
10. Stastny P, et al. [Does the Dumbbell-Carrying Position Change the Muscle Activity in Split Squats and Walking Lunges?](https://pmc.ncbi.nlm.nih.gov/articles/PMC4640053/). PMID 25968228; PMCID PMC4640053.
11. Coratella G, et al. [Front vs Back and Barbell vs Machine Overhead Press](https://pmc.ncbi.nlm.nih.gov/articles/PMC9354811/). PMID 35936912; PMCID PMC9354811.
12. Zhan Y, et al. [Ray3D: Ray-Based 3D Human Pose Estimation for Monocular Absolute 3D Localization](https://openaccess.thecvf.com/content/CVPR2022/html/Zhan_Ray3D_Ray-Based_3D_Human_Pose_Estimation_for_Monocular_Absolute_3D_CVPR_2022_paper.html). CVPR 2022.

来源核对说明：用户提供的作者简称与 PMID 有两处不一致；PMID 17530967 实际索引为 Duffey & Challis，PMID 19891202 实际索引为 Pearson et al.。本报告按 PMID 对应的原始记录引用，避免错误归属。

## 11. 独立审查状态

本报告已由 ACPX Claude 与独立工程 subagent 分别进行只读审查，并由主代理回到原始论文摘要、仓库代码和运行时接口逐条复核。审查记录见 [器械—骨架融合研究独立审查](../reports/equipment-skeleton-biomechanics-fusion-independent-review-2026-08-12.md)。
