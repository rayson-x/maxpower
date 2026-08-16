# 通过骨架轨迹与关节夹角判断动作质量：研究结论与 MaxPower 设计建议

日期：2026-08-15
范围：单目 RGB 视频、Rust Motion SDK、已知动作与机位、Rep 与整组质量解释
性质：设计研究，不是实现 ticket，也不修改现有产品契约

## 结论先行

通过骨架轨迹与关节夹角判断动作质量是可行的，但不能采用“固定计算全身几个角度，再用一套通用阈值评分”的做法。更可靠的路线是：

1. 输入先确定 exact action context：动作、变式、器械、单双侧、机位和训练意图。
2. exact action 先解析唯一语义权威 `ActionMotionDefinition`；机位生成 `ViewProjectionPlan`，编译器再据此生成或验证 ExecutionContract、FeatureProgram、RecognitionProfile 与 RulePack，并封装为动作专项 `ActionObservationPlan`。
3. 计划只激活该动作真正需要的骨架关系、器械轨迹和约束点；不相关点不进入判断，但可继续保留为原始观测。
4. 先用主任务信号切 Rep 和阶段，再在每个 Rep 内计算轨迹、角度、端点、速度、稳定性、左右差异以及人体—器械协同。
5. 每个质量结论必须由 `观测事实 → 参考比较 → 规则 → Rep/整组模式 → 结论` 推导，并允许 `cannot_judge`。
6. 首版应采用“确定性特征与规则为主、学习模型为候选生成或时序识别增强”的混合路线。不要让一个端到端模型直接输出不可解释的总分。

最重要的产品含义是：**上半身动作可以不要求全部下肢点参与识别，但不能机械地关闭整个下半身。** 杠铃划船仍需要髋部/躯干作为代偿与姿势约束；推举可能需要髋、膝判断借力；只有被动作契约声明为无关的点才应退出本次计算。

## 1. 研究问题

本研究回答五个问题：

1. 骨架轨迹与关节角是否足以支持 Rep、阶段和动作质量判断？
2. 不同动作是否应该选择不同点位、角度和轨迹？
3. 杠铃划船与硬拉这类外观相似动作，如何通过局部动作语义区分？
4. 规则、参考轨迹和训练模型应该如何分工？
5. 当前 Rust SDK 已有什么，离目标设计还差什么？

## 2. 本地实现与已有契约

### 2.1 当前 Rust 已有能力

当前 [`rust/motion-sdk/src/lib.rs`](../../rust/motion-sdk/src/lib.rs) 已经发布每帧的投影关节角和置信度，并把器械证据、动作局部坐标证据、Rep 状态和已封存 Rep 放进同一个 `MotionPacket`。

现有角度固定为左右各四类：

- 肘：肩—肘—腕；
- 肩：髋—肩—肘；
- 髋：肩—髋—膝；
- 膝：髋—膝—踝。

计算值是**相机平面的二维投影角**。只有主体锁定、三点可渲染、最低置信度不低于 0.5、来源为 `Measured/Fused` 时才标记 `judgeable`。这个保守门控是正确方向。

现有不足是：

- 固定八个角不能表达动作专项的任意“点—关节—点”或“线段—线段”关系；
- 没有踝角、躯干倾角、骨盆—躯干关系等统一命名的动作特征；
- 这些角度是统一帧观测，不等于当前动作真正应该使用的质量特征；
- 一些 `RecognitionProfile` 仍直接绑定手腕高度或某个角度，尚未形成统一的动作专项观测计划；
- 投影角不能被命名为临床三维关节角，也不能单独推出关节力矩、肌肉激活或伤病风险。

### 2.2 当前设计契约已经提供正确分层

[`local-motion-execution-rule-engine-v0.1.md`](../design/local-motion-execution-rule-engine-v0.1.md) 已经明确：

- `RecognitionProfile`：周期是否存在、Rep 边界在哪里；
- `ExecutionContract`：exact context 下应该观察什么、允许声称什么；
- `FeatureProgram`：从轨迹怎样计算强类型事实；
- `ReferenceProfile`：与什么可接受走廊或个人基线比较；
- `RulePack`：哪些证据组合能下什么结论；
- `SetAggregator`：整组形成了什么持续模式；
- `TraceBuilder`：结论如何从输入一路推导出来。

这些执行资产继续分责，但不再是并列的动作语义来源。`ActionMotionDefinition` 是唯一动作语义权威；ExecutionContract、FeatureProgram、RecognitionProfile 与 RulePack 必须由它生成或逐字段验证一致。Rust 内部编译产物 `ActionObservationPlan` 把通过验证的资产解析成高效、确定、可审计的每帧/每 Rep 执行计划。

### 2.3 本地已有研究的一致结论

已有三份本地研究已经支持本报告的边界：

- [`local-motion-quality-rule-engine-contract-research.md`](2026-08-13-local-motion-quality-rule-engine-contract-research.md)：事实、比较、规则与谨慎推断必须分离；
- [`equipment-skeleton-biomechanics-fusion.md`](2026-08-12-equipment-skeleton-biomechanics-fusion.md)：器械和骨架是独立但互补的证据，器械不能由手腕替代；
- [`monocular-view-normalization-constrained-3d-motion-understanding.md`](2026-08-13-monocular-view-normalization-constrained-3d-motion-understanding.md)：目标是动作局部坐标中的可比较运动，不是从单目视频恢复完整真实物理世界。

## 3. 外部主来源告诉了我们什么

### 3.1 动作质量必须是“动作专项 + 阶段专项”

Pose Trainer 直接为不同动作选择不同几何量：弯举观察上臂相对躯干的稳定性和肘部最小夹角；前平举观察躯干摆动和手臂—躯干角；耸肩观察肩点位移与肘部弯曲；推举观察躯干、肘颈相对位置和肘角。它还用躯干长度归一化距离，并用 DTW 比较不等长序列。[Pose Trainer 原论文](https://arxiv.org/abs/2006.11718)

一个经过随机对照试验的深蹲应用也只选取与深蹲相关的身体点位，明确排除了对该任务作用较小的手臂、头和脚部输出；其输入是归一化后的关键点逐帧变化，而不是全身点位一视同仁。[JMIR 原论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC10523222/)

FineDiving 指出整段视频直接回归分数缺少透明度，改为先解析有顺序的动作步骤，再在对应步骤间比较。[FineDiving, CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/html/Xu_FineDiving_A_Fine-Grained_Dataset_for_Procedure-Aware_Action_Quality_Assessment_CVPR_2022_paper.html) EgoExo-Fitness 同样同时标注动作边界、子步骤边界、技术关键点、文字评价和质量分数。[EgoExo-Fitness, ECCV 2024](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/3057_ECCV_2024_paper.php)

由此可以推导：同一个“髋角偏移 12°”在不同动作、阶段和角色中含义不同。划船向心阶段髋角变化可能是躯干借力证据；硬拉向心阶段髋角变化却是主任务本身。角度没有脱离动作语义的统一好坏。

### 3.2 Rep 识别与质量评估是相关但不同的任务

RepNet 用时间自相似矩阵预测周期与周期长度，说明周期性可以跨动作迁移；但它只回答重复是否存在、周期多长，不回答动作是否标准。[RepNet, CVPR 2020](https://openaccess.thecvf.com/content_CVPR_2020/html/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.html)

力量训练中的 Rep 不能只依赖一个瞬时角度阈值。更稳妥的判定需要：主信号方向、最小运动幅度、端点停留/反转、阶段最短持续时间、周期上下文，以及骨架与器械是否一致。周期模型可以作为辅助证据，但 Rep 的语义仍由动作契约决定。

### 3.3 骨架应该按时空结构处理，而不是把点摊平成无意义数组

ST-GCN 把人体骨架建模为空间骨连接加同一关节的时间连接，让模型学习空间和时间模式。[ST-GCN, AAAI 2018](https://arxiv.org/abs/1801.07455) SU-EMD 在七种力量与体能动作上使用骨架度量学习，并展示少样本动作识别的可行性；但其 3D markerless 轨迹来自四机位三角化，并有 Vicon 对照，不能直接等同于单手机位 2D 能力。[SU-EMD, CVPRW 2023](https://openaccess.thecvf.com/content/CVPR2023W/CVSports/html/Deyzel_One-Shot_Skeleton-Based_Action_Recognition_on_Strength_and_Conditioning_Exercises_CVPRW_2023_paper.html)

Temporal Distance Matrices 把归一化 3D 骨架的关节间距离组织成时间矩阵，用于识别不同深蹲错误类型，说明“整条关系轨迹”比单帧阈值更有信息。[Temporal Distance Matrices, CVPRW 2019](https://openaccess.thecvf.com/content_CVPRW_2019/html/CVSports/Ogata_Temporal_Distance_Matrices_for_Squat_Classification_CVPRW_2019_paper.html)

工程上的含义不是必须立即引入 GCN，而是 FeatureProgram 至少要保留：

- 关节/线段的空间关系；
- 同一关系随时间的轨迹；
- 相邻关节的协同；
- 左右对应关系；
- 人体与器械的时间同步。

### 3.4 角度是重要且可解释的表示，但 2D 投影角不是完整三维生物力学角

基于国际生物力学标准的关节局部坐标研究表明，**从 3D 关键点构造的局部关节角**具有较强的人体尺度和全局旋转不变性，而且对细微动作差异有解释优势；角度与关键点组合通常优于单独一种表示。[Joint-angle representation 原论文](https://arxiv.org/abs/2406.17443)

这项结果不能直接套到当前单目 2D 点位上。当前 Rust 使用三点点积得到相机平面夹角，它会随出平面运动与机位变化而变化。因此报告名称应是 `projected_angle` 或 `camera_plane_angle`；只有在动作平面与相机平面近似一致且机位满足契约时，才可用于定量比较。

OpenCap 要使用两台或更多同步手机、相机标定、三角化、3D 运动学、肌骨模型和动态模拟，才能验证 3D 关节角、地面反作用力与关节力矩。[OpenCap, PLOS Computational Biology](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462) 这从反面划定了 MaxPower 单目路径的边界：可以描述可观察运动质量，不能把二维几何升级成真实力、肌肉激活或伤病诊断。

### 3.5 可解释质量评估适合“神经感知 + 符号规则”

Fitness-AQA 覆盖深蹲、杠铃划船和过顶推举，并由专家标注典型错误。研究发现真实健身房中的器械遮挡、机位、服装与光照会让通用 2D/3D pose 表示难以捕捉细微错误，因此使用动作领域的自监督表示，再用少量专家标注微调。[Fitness-AQA, ECCV 2022](https://arxiv.org/abs/2202.14019)

NS-AQA 则让神经网络先把视频抽象成可解释符号，再用规则评分和生成带视觉证据的报告；专家更偏好这种报告，而不是只有端到端分数。[NS-AQA, CVPRW 2024](https://arxiv.org/abs/2403.13798)

FLEX 将 20 个负重动作组织为“动作—关键步骤—错误类型—反馈”的知识图谱，用分阶段、分错误的惩罚累计得到总分，并保留从总分回到具体错误的路径。它同时提供五机位、3D pose、sEMG 和生理信号，证明结构化质量本体很有价值，但也说明高质量 ground truth 的采集成本远高于普通单目视频。[FLEX 项目页](https://haoyin116.github.io/FLEX_Dataset/) · [FLEX 论文](https://arxiv.org/html/2506.03198)

这与 MaxPower 当前的 `FeatureProgram + RulePack + TraceBuilder` 方向高度一致。

### 3.6 公开数据可以帮助定义问题，但不能直接替代本项目标注

- UI-PRMD 只有 10 名健康参与者、10 个康复动作，提供 Kinect/Vicon 的关节位置和角度，以及少量非最优示例；作者也明确指出规模和人群限制。[UI-PRMD 原始数据论文](https://www.mdpi.com/2306-5729/3/1/2)
- KIMORE 有 78 名参与者、五个康复动作、RGB/深度/骨架、医生定义特征和临床评分，但任务域是康复而非 72 个负重训练动作。[KIMORE 原始论文记录](https://pubmed.ncbi.nlm.nih.gov/31217121/)
- Fitness-AQA、FLEX、NS-AQA 官方发布均带非商业限制或非商业许可证，不能默认进入商业训练语料。[Fitness-AQA 官方仓库](https://github.com/ParitoshParmar/Fitness-AQA) · [FLEX 许可证](https://arxiv.org/html/2506.03198) · [NS-AQA 官方仓库](https://github.com/laurenok24/NSAQA)

它们适合帮助定义特征、错误本体、评价拆分与研究基线；真正的 MaxPower 规则和训练必须来自 exact action × view × equipment 的自有、可治理数据。

## 4. 推荐的计算流程

```text
已知动作上下文
  ↓
ActionMotionDefinition（先定义动作，不依赖机位）
  ├─ 主运动关节与身体线段
  ├─ 主人体/器械轨迹
  ├─ Rep 和阶段语义
  ├─ 应稳定的关节与代偿约束
  └─ 左右关系
  ↓
ViewProjectionPlan（再根据机位选择测量方法）
  ├─ 当前画面可计算的二维投影角
  ├─ 水平/垂直/动作局部轴轨迹代理
  ├─ 置信度、覆盖率和遮挡门控
  ├─ 当前机位不可观察的事实
  └─ 必须 CannotJudge 的质量主张
  ↓
从唯一动作语义生成/验证
  ExecutionContract + FeatureProgram + RecognitionProfile + RulePack
  ↓ 原子编译
ActionObservationPlan
  ↓
帧观测
  ├─ 原始/归一化骨架
  ├─ 投影关节角与线段关系
  ├─ 器械几何与轨迹
  ├─ 置信度、遮挡、主体关联、机位可观察性
  └─ 动作局部坐标
  ↓
动作专项主信号 + 器械/骨架共识
  ↓
Rep 边界与阶段：准备 → 离心/下降 → 反转 → 向心/上升 → 返回
  ↓
阶段归一化 Feature
  ├─ ROM / 端点 / 节奏
  ├─ 角度与角速度轨迹
  ├─ 稳定性 / 代偿 / 左右差
  ├─ 人体—器械耦合 / 时间滞后 / 路径偏移
  └─ 覆盖率与可判断性
  ↓
Reference Runtime
  ├─ 标准参考走廊（若存在）
  ├─ 当次训练前序稳定 Rep/组
  └─ 无参考
  ↓
RulePack：逐维度结论
  ↓
SetAggregator：整组趋势、后程退化、持续错误
  ↓
TraceBuilder：事实 → 比较 → 规则 → 模式 → 结论
```

这个顺序不能颠倒。动作先决定“需要理解什么”，机位只决定“当前画面如何测量、是否能测量”。机位不能把划船中的髋角从代偿约束改成主任务，也不能因为某个主关节在当前画面不可见，就切换到一个不相关的手腕轨迹继续发布肯定结论。

## 5. `ActionObservationPlan` 的建议数据模型

它应是 Rust 内部编译产物，不新增调用方责任：

```rust
struct ActionObservationPlan {
    context: ExactActionContext,
    motion_definition: ActionMotionDefinition,
    view_projection: ViewProjectionPlan,
    phases: Vec<PhaseSpec>,
    observations: Vec<ObservationSpec>,
    rep_consensus: RepConsensusSpec,
    quality_dimensions: Vec<QualityDimensionSpec>,
    observability: Vec<ObservabilityGate>,
}

struct ActionMotionDefinition {
    primary_joints: Vec<JointRelation>,
    primary_tracks: Vec<SemanticTrack>,
    corroborating_tracks: Vec<SemanticTrack>,
    stable_segments: Vec<SegmentRelation>,
    substitution_guards: Vec<JointOrSegmentRelation>,
    bilateral_relations: Vec<BilateralRelation>,
    equipment_roles: Vec<EquipmentRole>,
}

struct ViewProjectionPlan {
    projected_angles: Vec<ProjectedAngleDefinition>,
    local_axes: Vec<LocalAxisDefinition>,
    visible_track_proxies: Vec<TrackProjection>,
    observability_gates: Vec<ObservabilityGate>,
    forbidden_claims: Vec<ClaimId>,
}

struct ObservationSpec {
    id: FeatureId,
    role: ObservationRole,
    scope: FeatureScope,
    primitive: FeaturePrimitive,
    required_phases: PhaseMask,
    minimum_coverage: f32,
}

enum ObservationRole {
    TaskPrimary,
    TaskCorroborator,
    SubstitutionGuard,
    TechniqueConstraint,
    ContextAnchor,
}

enum FeatureScope {
    Frame,
    Phase,
    Rep,
    Set,
}

enum FeaturePrimitive {
    ProjectedJointAngle { a: Landmark, joint: Landmark, b: Landmark },
    SignedSegmentAngle { segment: Segment, reference: ReferenceAxis },
    NormalizedPointDistance { a: PointRef, b: PointRef, scale: ScaleRef },
    PointOrEquipmentTrajectory { source: TrackRef, axis: LocalAxis },
    RelativeTrajectory { a: TrackRef, b: TrackRef },
    BilateralDelta { left: FeatureId, right: FeatureId },
    PhaseStatistic { input: FeatureId, statistic: Statistic },
}
```

`ObservationRole` 很关键。它让同一个髋角在划船中成为 `SubstitutionGuard`，在硬拉中成为 `TaskPrimary`，不会因为复用同一计算原语而混淆语义。

## 6. 基础特征算法

### 6.1 二维投影角

对三点 `A-J-B`，令：

```text
u = A - J
v = B - J
θ = atan2(|cross2d(u, v)|, dot(u, v))
```

`atan2` 形式通常比先归一化再 `acos` 数值更稳定。若要表达方向，可保留 `cross2d` 符号，但符号语义必须由机位和左右侧契约固定。

每个角度事实至少带：

```text
value_degrees
projection_plane = camera_plane
input_landmarks
minimum_landmark_confidence
coverage
source = measured | fused | predicted | unknown
judgeability
```

不得只有一个裸 `f32`。

### 6.2 动作局部坐标与尺度

二维轨迹需要去掉画面位置、人体身高和拍摄距离的主要影响：

- 原点：髋中点、肩中点、器械起始中心或动作规定锚点；
- 纵轴：躯干轴、重力近似轴或经架上器械校准的轴；
- 横轴：肩线/髋线或与纵轴正交的图像平面轴；
- 尺度：躯干长度、肩宽、髋宽、器械直径或稳定多帧中位值；
- 归一化参数必须在组内冻结，并保留来源与置信度。

归一化的目标是“同一动作局部关系可比较”，不是宣称恢复真实米制世界坐标。

### 6.3 去噪与覆盖率

建议把低延迟和整组回顾分开：

- 流式层：短窗口中值 + 因果低通/One-Euro 类滤波，保留突变诊断；
- Rep 封存层：在已确定边界内重新计算稳健统计，如 median、MAD、分位数和阶段覆盖率；
- 缺失点不能无条件插值。短缺口可以 `Predicted` 补齐用于连续显示，但质量结论只能按契约决定是否接受；
- 任何 Feature 都应输出 `observed_frames / expected_frames` 和最长连续缺口。

### 6.4 Rep 与阶段

Rep 主信号由动作决定，不应固定为手腕：

- 杠铃动作优先使用已关联主体的器械轨迹作为主边界，骨架作独立佐证；
- 徒手/器械不可见动作可用关键角度或身体点位的局部轴投影；
- 相似外观动作必须使用不同的动作语义共识，而不是只找任意周期。

一个候选 Rep 至少通过：

1. 主信号完成规定方向变化；
2. 可见幅度超过动作 profile 的计次门槛；
3. 起点、反转点、终点满足滞回和最短持续时间；
4. 关键佐证信号在允许的时间容差内一致；
5. 出现骨架—器械冲突时保留冲突，不静默选一条链路。

Rep 封存后，把每一阶段重采样到固定的 0–100% 进度。这样不同速度的 Rep 可以比较轨迹形状，而不会把“做得慢”误判为“路径不同”。DTW 可以用作参考相似度，但不应替代可解释的端点、ROM、稳定性和代偿事实。

### 6.5 每 Rep 特征族

推荐第一版 FeatureProgram 支持：

| 特征族 | 代表量 | 适合回答 |
|---|---|---|
| 完整度 | 主信号 ROM、端点距离、反转位置 | 是否完成可见周期、后程 ROM 是否下降 |
| 阶段控制 | 离心/向心时长、停顿、速度峰值位置 | 节奏是否明显变化、是否失控反弹 |
| 轨迹 | 路径直线度、走廊距离、横向漂移、曲率 | 杠铃或关节路径是否偏离参考 |
| 角度 | 极值、ROM、阶段均值、角速度 | 关节活动与稳定关系 |
| 代偿 | 非主任务关节的变化范围、躯干/髋漂移 | 是否通过其他部位完成任务 |
| 协同 | 两关节相位差、人体—器械滞后、转折一致性 | 关节和器械是否共同完成 Rep |
| 对称 | 左右端点差、时序差、动态倾角变化 | 是否出现可见不对称 |
| 证据质量 | 覆盖率、遮挡、置信度、冲突率 | 当前结论能否判断 |

## 7. 动作专项示例

这些是观测职责示例，不是未经验证的“标准角度阈值”。

### 7.1 杠铃划船

```text
TaskPrimary:
  杠铃/双手相对躯干的回拉轨迹
  肘屈曲与肘部向后运动

TaskCorroborator:
  杠铃反转时间与双肘反转时间
  手腕—杠铃关联稳定性

SubstitutionGuard:
  髋角在 Rep 内的变化范围
  躯干倾角在 Rep 内的变化范围
  膝角的大幅屈伸

TechniqueConstraint:
  左右肘/器械端点时序差
  杠铃相对躯干的路径走廊
```

髋部不是“无关的下半身点”，而是区分严格划船与借助髋伸/躯干摆动的重要约束。本文采用严格杠铃划船语义：允许正常呼吸、稳定误差和小幅测量噪声，但如果髋角或躯干倾角在回拉阶段出现经过覆盖率与机位门控后仍成立的**大幅、同相移动**，应输出明确的 `NeedsAttention(excessive_hip_or_trunk_assistance)`，不能判断为标准动作。具体“大幅”的数值门槛仍需 exact-view 数据校准，不能先写成跨机位常量。

### 7.2 传统硬拉

```text
TaskPrimary:
  杠铃纵向位移
  髋伸与膝伸的阶段轨迹

TaskCorroborator:
  杠铃起离地面、越膝与锁定附近的阶段关系
  肩、髋和杠铃的时序协同

TechniqueConstraint:
  肘部保持近似伸直
  杠铃相对身体的水平距离和漂移
  左右器械端点同步
```

同样的髋角变化在这里是主任务证据；同样的肘角变化反而更像约束或异常。划船与硬拉的区别不是某个角度本身，而是角度在动作契约中的角色和与器械轨迹的时序关系。

### 7.3 杠铃卧推

```text
TaskPrimary:
  杠铃中心/端点的下降—反转—上升轨迹

TaskCorroborator:
  双肘屈伸、手腕—杠铃关联、反转时间一致性

TechniqueConstraint:
  左右端点滞后与动态倾斜变化
  手腕相对肘的投影位置
  杠铃路径相对肩/躯干锚点的漂移

ContextAnchor:
  肩线、躯干尺度、卧姿主体锁定
```

不能只看手腕，因为手腕可能被遮挡、姿态估计漂移，且手腕轨迹不是杠铃刚体轨迹。

### 7.4 侧平举

```text
TaskPrimary:
  上臂相对躯干的外展投影角
  哑铃/手腕相对肩的局部高度

SubstitutionGuard:
  躯干侧倾/后仰
  肘屈曲变化过大
  髋/膝明显借力（仅在可观察机位）

TechniqueConstraint:
  左右相位差与端点差
  哑铃和手腕轨迹一致性
```

### 7.5 深蹲

```text
TaskPrimary:
  髋、膝的屈伸轨迹和身体/杠铃纵向位移

TaskCorroborator:
  髋膝踝阶段协同、下降与上升反转一致性

TechniqueConstraint:
  躯干倾角、左右膝/髋差、杠铃横向漂移
  脚部与踝角只在足点清晰且机位允许时使用
```

当前 Rust 没有统一踝角，若 72 动作中要评价踝部活动，需要新增动作特征原语和相应可观察性门控，而不是把它硬塞进现有四类角度枚举。

## 8. 质量结论与评分

### 8.1 先输出维度结论，再决定是否给总分

每个维度建议使用强类型状态：

```text
ObservedAcceptable
NeedsAttention(severity)
CannotJudge(reason)
NotApplicable
```

典型维度：

- `task_completion`
- `range_and_endpoints`
- `phase_control`
- `trajectory_control`
- `support_stability`
- `bilateral_symmetry`
- `pose_equipment_coordination`
- `late_set_degradation`

总分只能是这些已判断维度的透明聚合：

```text
dimension_score = evidence-backed rule result
set_score = weighted aggregate(dimension_score)
```

必须同时显示 `evidence_coverage`。如果关键维度不可判断，不应简单重新分配权重后给出看起来完整的高分；应返回部分报告或明确“总分不可用”。

### 8.2 整组结论

整组不是逐 Rep 分数平均。`SetAggregator` 应识别：

- 后半组 ROM 持续下降；
- 向心时长持续增加或速度持续下降；
- 某种代偿在后程才出现；
- 左右滞后逐 Rep 扩大；
- 与本次训练前序稳定 Rep/热身组的偏离；
- 单次异常与持续模式的区别。

用户定义的“个人基线”应是同一次训练、相同机位和相近上下文的短期参考。它可以说明当前重量下动作相对前序稳定表现退化，不能自动证明前序动作符合通用标准。

### 8.3 因果解释链

用户默认看到结论，展开后看到：

```text
结论：后半组划船出现更多髋部借力
  ← SetPattern：Rep 7–10 的髋角变化连续高于 Rep 1–3
  ← Rule：髋角是本动作的 SubstitutionGuard，不是 TaskPrimary
  ← Comparison：后程中位变化 +11°，超过本次前序稳定走廊
  ← Feature：每 Rep 向心阶段髋投影角范围
  ← Rep/Phase：每次回拉的开始、反转和返回边界
  ← Fusion：肘与杠铃回拉一致；髋变化与回拉同相
  ← Coordinate：组内冻结的躯干轴与尺度
  ← Source：原始骨架点、器械轨迹、置信度、时间戳和版本
```

这里的“因果”是**本系统结论的推导因果**，不是生理学上“髋部导致某肌肉没有发力”的因果。

## 9. 规则与训练模型如何分工

### 9.1 不需要训练就能先做的

- 投影角、距离、速度、阶段时长、轨迹覆盖率；
- 动作局部坐标和尺度归一化；
- 由已知动作选择相关点位与器械证据；
- 基于动作 profile 的 Rep 状态机；
- 与本次训练前序 Rep 的稳健比较；
- 证据覆盖、冲突和 `cannot_judge`；
- 完整 trace。

这些能力应由 Rust 确定性实现，不应等待大量质量标注。

### 9.2 需要数据拟合或训练的

- 不同 action × view 下可接受特征走廊；
- 细微 form error 的分类器或候选生成器；
- 在遮挡和复杂背景下的动作专项表示；
- 多特征组合的权重与严重度校准；
- 更稳健的阶段边界、器械检测与关联；
- 不同体型、重量、速度和机位下的泛化。

模型输出应先落成带置信度的事实/候选，例如：

```text
candidate_error = excessive_torso_swing
confidence = 0.82
supporting_interval = rep_8.concentric[20%..70%]
```

然后由 RulePack 检查当前 action/view 是否允许该结论、关键骨架与器械事实是否支持、证据是否充分。不能让模型绕过 `ExecutionContract` 直接发布质量结论。

### 9.3 推荐迭代顺序

1. 确定性动作观测计划与 trace；
2. 用已有视频验证 Rep、阶段、角度和器械事实是否对齐；
3. 建立 action × view 的错误本体和可观察性；
4. 标注事实/阶段/错误，而不是只标“好/坏”；
5. 先拟合阈值、走廊和稳健统计；
6. 规则无法覆盖的细微组合错误，再训练动作专项模型；
7. 模型仍以提案形式进入现有证据链。

## 10. 标注与评价建议

### 10.1 最小标注层级

对每个视频至少需要：

```text
VideoContext:
  action / variation / equipment / view / side / weight

Temporal:
  set range
  rep start / turnaround / end
  optional phase boundaries

Observability:
  subject locked
  critical joint visible/occluded
  equipment visible/associated/ambiguous
  view acceptable or cannot judge

QualityFacts:
  action-specific fact labels
  error type
  affected phase/rep
  severity or confidence
  cannot_judge reason
```

用户反馈不是专家标注。用户可以反馈“报告有用/没用、结论看起来不对、漏了一次 Rep”，用于产品发现和样本回收；动作质量 ground truth 仍需按规则由有能力的审核者完成。

### 10.2 指标必须拆开

不能只发布一个“识别率”：

| 能力 | 建议指标 |
|---|---|
| Rep 计数 | count MAE、完全正确组比例 |
| Rep 边界 | boundary tolerance F1、时间误差 |
| 阶段 | turnaround/phase timestamp error |
| 器械关联 | precision、recall、identity switch、coverage |
| 事实特征 | 角度/端点误差、轨迹相关性、覆盖率 |
| 错误结论 | per-label precision/recall/F1，优先控制误报 |
| 不可判断 | risk–coverage、错误拒绝率、漏拒绝率 |
| 整组模式 | pattern precision/recall、起始 Rep 误差 |
| 解释链 | 每条结论是否存在完整、真实依赖路径 |

数据拆分至少按 subject-held-out 和 source-video-held-out；需要评估跨机位时再增加 view-held-out。训练和测试中同一原视频的裁剪片段、镜像或相邻 Rep 不能跨拆分泄漏。

## 11. 对当前 Rust SDK 的具体设计建议

### 保留

- `MotionPacket` 中原始骨架、器械、局部坐标、Rep 与评估证据并存；
- `judgeable`、来源类型和冲突保留；
- `RecognitionProfile / ExecutionContract / FeatureProgram / RulePack / SetAggregator / TraceBuilder` 分责，但前四者不得形成独立动作语义；
- exact-context、版本化资产和 fail-closed。

### 扩展

1. 将固定 `JointAngleKind` 保留为通用诊断快照，同时让 `FeatureProgram` 支持任意强类型三点角、线段角和相对轨迹。
2. 增加 `ActionObservationPlan` 编译层，显式记录每个 Feature 的动作角色和计算 scope。
3. Feature scope 从当前偏 Rep 后处理扩成 `Frame → Phase → Rep → Set`。
4. 让 Rep 主信号按动作选择：器械、关节角、局部点位或多信号共识，不能默认手腕。
5. 为踝、躯干、骨盆以及器械相对人体的关系提供通用原语，而不是继续扩充写死的动作枚举。
6. 每个动作包定义 `required / optional / forbidden claim`；相关点缺失时只影响依赖它的结论。
7. 质量报告同时输出维度状态、证据覆盖和完整 trace；总分是可选派生值。

### 不应做

- 不按动作区分而统一启用/关闭上、下半身；
- 用单帧角度阈值直接决定整次 Rep 好坏；
- 把手腕当作杠铃或哑铃轨迹；
- 把固定机位的 2D 投影角叫作真实 3D 关节角；
- 从骨架运动直接声称肌肉发力、关节载荷或伤病风险；
- 缺少关键点时用插值结果悄悄下结论；
- 用一个端到端分类概率替代可展开的事实与规则链。

## 12. 最终判断

用户提出的方向是正确的：**不同动作只计算它需要理解的身体与器械关系，再用这些关系的整条 Rep 轨迹和阶段变化判断质量。**

最合适的 MaxPower 路线不是“全身骨架识别器”或“角度打分器”，而是一个动作驱动的可解释执行引擎：

```text
动作上下文决定观察计划
→ 观察计划决定点位、角度、轨迹和器械证据
→ Rep/阶段提供时间语义
→ 参考与规则产生逐维度结论
→ 整组聚合发现持续模式
→ Trace 保留每个结论的推导链
```

这套结构既可以立即用现有 Rust 确定性能力搭出可行 demo，也为当前 registry 的 70 个动作以及计划扩充的动作逐步补充视频、标注、参考走廊和动作专项模型留出了稳定接口。

## 附录 A：当前全部动作的关节与轨迹需求

扩展后的叶级动作及其“应该运动 / 应该协同 / 应保持稳定 / 代偿关系 / 人体与器械轨迹 / Rep 边界”完整定义，见《[MaxPower 扩展动作运动契约：关节、人体轨迹、器械轨迹与稳定约束](./2026-08-15-expanded-action-motion-definitions.md)》。本附录保留当前 70 个 registry 动作的基线映射；扩展动作目录优先于基线父动作建立，随后才为叶级动作生成完整计算合同。

### A.1 目录固定点与解释规则

[`src/pose/exerciseRegistry.ts`](../../src/pose/exerciseRegistry.ts) 在 2026-08-15 实际登记 **70 个**动作，不是 72 个。本文只为这 70 个稳定 action ID 建立动作语义；若产品计划中确有 72 个，缺少的两个 ID 必须先进入 registry，不能在评估引擎中发明影子动作。

下列映射描述与机位无关的 `ActionMotionDefinition`。符号含义：

- `P`：`TaskPrimary`，Rep 与动作任务主证据；
- `C`：`TaskCorroborator`，Rep/阶段佐证；
- `G`：`SubstitutionGuard`，借力或代偿；
- `T`：`TechniqueConstraint`，路径、稳定性和左右关系；
- `A`：`ContextAnchor`，局部坐标、尺度或支撑锚点。

表中出现的“稳定”均指**该可观察投影关系在 Rep 内的变化**，不是医学上的脊柱中立、关节安全或肌肉发力判断。器械轨迹必须来自已关联主体的真实器械证据，不能用手腕轨迹冒充。

### A.2 移动类

#### 1. `march_in_place` 原地踏步

- `P`：左右髋屈曲、膝抬高；左右膝点纵向交替轨迹。
- `C`：踝点离地与左右周期。
- `G/T`：骨盆上下漂移、躯干侧倾、左右节奏差。

#### 2. `side_step_touch` 侧步并步

- `P`：髋外展；左右踝横向分离—合拢轨迹。
- `C`：膝点横向移动。
- `G/T`：骨盆旋转/侧倾、躯干稳定、左右步幅。

#### 3. `alternating_knee_raise` 慢速交替提膝

- `P`：髋屈曲；左右膝纵向交替轨迹。
- `C`：膝角与踝点同步抬升。
- `G/T`：躯干后仰、骨盆侧倾、左右高度与节奏。

#### 4. `step_jack` 低冲击开合

- `P`：髋外展与肩外展；踝和腕横向轨迹。
- `C`：左右侧交替打开—返回。
- `G/T`：躯干侧倾、膝控制、手脚时序。

#### 5. `jumping_jack` 开合跳

- `P`：双侧肩外展、髋外展；腕和踝对称开合轨迹。
- `C`：身体中心纵向跳跃周期。
- `G/T`：左右不同步、膝屈伸差、落地后的可见稳定性。

### A.3 核心屈曲

#### 6. `sit_up` 仰卧起坐

- `P`：躯干—大腿投影夹角；肩中点相对髋中点的弧形轨迹。
- `C`：躯干起身与返回反转。
- `G/T`：髋位置漂移、左右肩不对称、膝角稳定。
- 禁止：从普通稀疏骨架声称具体腰椎节段角度。

### A.4 水平拉

水平拉的共同主语义是肩伸展/水平外展、肘屈曲以及负载向躯干靠近；共同代偿候选是髋、膝或躯干替代手臂完成回拉。

#### 7. `barbell_row` 杠铃划船

- `P`：杠铃相对躯干的回拉轨迹、双肘屈曲/后移。
- `C`：杠铃与双肘反转时间。
- `G`：髋角、膝角、躯干倾角在 Rep 内的变化。
- `T`：杠铃路径、左右肘和杠铃端点同步。

#### 8. `seated_row` 坐姿划船

- `P`：绳索手柄向躯干轨迹、肘屈曲。
- `G`：躯干前后摆动。
- `T`：双肘路径、肩线稳定、左右同步。

#### 9. `face_pull` 绳索面拉

- `P`：手柄向面部轨迹、肘屈曲、肩水平外展。
- `C`：双腕靠近面部与双肘外展的时序。
- `G`：躯干后仰。
- `T`：左右肘高度、双侧手柄同步。

#### 10. `one_arm_dumbbell_row` 单臂哑铃划船

- `P`：活动侧哑铃、腕和肘向躯干回拉。
- `G`：躯干旋转、髋角变化、支撑肩塌陷的投影代理。
- `T`：活动侧肩—肘—腕路径。

#### 11. `standing_dumbbell_row` 站姿双哑铃划船

- `P`：左右哑铃轨迹和双肘后移。
- `G`：髋伸、膝伸、躯干摆动。
- `T`：左右端点与反转时间。

#### 12. `chest_supported_row` 胸托划船

- `P`：手柄/哑铃回拉、肘屈曲。
- `A`：胸托与躯干相对位置。
- `T`：肩线、左右肘路径；若可观察，检查躯干是否持续离开支撑面。

#### 13. `single_arm_cable_row` 单臂绳索划船

- `P`：活动侧手柄和肘回拉。
- `G`：躯干旋转与侧倾。
- `T`：活动肩相对髋的稳定。

#### 14. `rear_delt_row` 后束划船

- `P`：肩水平外展、高位肘后移。
- `C`：手柄/哑铃回拉轨迹。
- `G`：躯干摆动、肘部下沉。
- `T`：左右肘高度和轨迹。

#### 15. `t_bar_row` T 杠划船

- `P`：T 杠手柄中心和双肘回拉。
- `G`：髋伸、膝伸、躯干摆动。
- `T`：器械与双肘反转一致性。

### A.5 垂直拉

垂直拉的共同主语义是肩内收/伸展、肘屈曲，以及身体或手柄沿纵向移动；共同代偿候选是躯干摆动和下肢借力。

#### 16. `pull_up` 引体向上

- `P`：肩/身体中心相对固定横杆上升、双肘屈曲。
- `C`：腕—横杆相对关系。
- `G`：髋膝摆动。
- `T`：左右肩肘同步、身体前后摆动。

#### 17. `lat_pulldown` 高位下拉

- `P`：横杆向下轨迹、双肘向下后方运动。
- `G`：躯干后仰变化。
- `T`：左右肘与横杆端点同步。

#### 18. `straight_arm_pulldown` 直臂下压

- `P`：肩伸展、手柄向下弧形轨迹。
- `T`：肘角相对稳定。
- `G`：躯干屈伸与髋部借力。

#### 19. `wide_grip_lat_pulldown` 宽握高位下拉

- 继承 `lat_pulldown` 主语义。
- `T` 增加：宽杆两端、左右肘外展与同步关系。

#### 20. `assisted_pull_up` 辅助引体向上

- `P`：身体相对横杆上升。
- `C`：辅助平台/膝垫反向轨迹、双肘屈曲。
- `G/T`：身体摆动、左右差、平台与身体时序。

#### 21. `chin_up` 反手引体向上

- 继承 `pull_up` 的运动学语义。
- 正握/反握不能仅凭基础骨架可靠证明；握法必须来自 `ActionContext`。

### A.6 深蹲与弓步

共同主语义是髋、膝、踝屈伸，以及骨盆或负载的下降—反转—上升。脚踝和膝—脚关系只有在足点清晰且机位允许时才可判断。

#### 22. `bodyweight_squat` 徒手深蹲

- `P`：髋膝投影角、骨盆纵向轨迹。
- `C`：踝角和身体中心轨迹。
- `T`：躯干倾角、左右膝髋差、可见深度。

#### 23. `barbell_back_squat` 杠铃深蹲

- `P`：杠铃中心轨迹、髋膝踝屈伸。
- `C`：杠铃与骨盆反转一致性。
- `T`：杠铃横向漂移、左右端点、躯干倾角。

#### 24. `leg_press` 腿举

- `P`：膝髋屈伸、膝/踝相对座椅轨迹。
- `C`：踏板或负重轨迹（可见时）。
- `T`：骨盆离座的投影代理、左右膝同步、端点深度。

#### 25. `walking_lunge` 行走箭步蹲

- `P`：前腿髋膝踝、后腿膝髋；骨盆下降与前移。
- `C`：步幅与左右腿交替。
- `T`：躯干倾斜、左右稳定、膝—脚关系。

#### 26. `alternating_lunge` 原地交替弓步蹲

- `P`：单侧跨出—下降—返回中心。
- `C`：左右侧顺序。
- `T`：返回端点、骨盆稳定、左右差。

#### 27. `bulgarian_split_squat` 保加利亚分腿蹲

- `P`：前腿髋膝踝、骨盆纵向轨迹。
- `A`：后脚支撑点。
- `T`：骨盆旋转、躯干、前膝轨迹与平衡代理。

#### 28. `front_squat` 杠铃前蹲

- `P`：前置杠铃、髋膝踝屈伸。
- `T`：杠铃路径、躯干倾角、左右肘/杠铃端点。
- 前蹲与后蹲必须使用不同 `ReferenceProfile`。

#### 29. `goblet_squat` 高脚杯深蹲

- `P`：胸前负载中心、髋膝屈伸。
- `T`：负载相对躯干、躯干倾角、左右膝轨迹。

### A.7 垂直推

#### 30. `seated_shoulder_press` 杠铃坐姿推肩

- `P`：杠铃纵向轨迹、肩与肘伸展。
- `C`：腕—杠铃关联。
- `G`：躯干后仰。
- `T`：左右肘和杠铃端点同步。

#### 31. `landmine_press` 地雷管推举

- `P`：地雷管末端弧形轨迹、活动侧肩肘伸展。
- `G`：躯干旋转/侧倾、髋膝借力。
- `T`：手腕—杆端关联。

#### 32. `chest_dip` 双杠臂屈伸（胸部版）

- `P`：身体中心相对固定双杠下降—上升、肘屈伸。
- `C`：肩点纵向轨迹。
- `T`：躯干倾角、左右肘同步、髋膝摆动。

#### 33. `dumbbell_shoulder_press` 坐姿哑铃推肩

- `P`：左右哑铃轨迹、双肩肘伸展。
- `G`：躯干后仰。
- `T`：左右端点、时序与路径差。

#### 34. `arnold_press` 阿诺德推举

- `P`：肩部身份定义的轴向旋转序列与哑铃过顶推举共同完成。
- `C`：哑铃上升、肘伸展和腕—肘相对位置变化；这些二维轨迹不能替代旋转主关系。
- `T`：左右同步、躯干稳定。
- 当前普通单目 Feature operators 不能表达身份定义的肩轴向旋转，因此动作定义完整但计划必须 `PlanRefusal`；可以保留可见事实，不输出 Arnold press Rep。

### A.8 肩外展

#### 35. `lateral_raise` 侧平举

- `P`：上臂—躯干外展角、哑铃/腕相对肩轨迹。
- `G`：躯干侧倾/后仰、髋膝借力。
- `T`：肘角稳定、左右端点与相位。

#### 36. `single_arm_cable_lateral_raise` 单臂绳索侧平举

- `P`：活动侧肩外展、手柄轨迹。
- `G`：躯干侧倾。
- `T`：活动肘稳定、非活动侧身体锚点。

#### 37. `cable_y_raise` 绳索 Y 举

- `P`：双臂斜向上举轨迹、肩外展/屈曲组合。
- `T`：肘稳定、左右 Y 形轨迹对称。
- `G`：躯干借力；耸肩只能在具有足够肩带证据时判断。

#### 38. `upright_row` 直立划船

- `P`：杠铃/手柄上升、肩外展和肘屈曲。
- `C`：双肘与腕的投影高度关系。
- `G`：躯干后仰。
- `T`：左右肘高度和器械动态倾斜。

### A.9 肩水平外展

#### 39. `rear_delt_fly` 后束飞鸟

- `P`：双腕/哑铃向外轨迹、肩水平外展。
- `T`：肘角稳定、左右端点。
- `G`：躯干抬起、髋角变化。
- reverse pec deck 与 dumbbell 必须由 exact equipment context 选择器械轨迹。

### A.10 水平推与夹胸

#### 40. `barbell_bench_press` 杠铃卧推

- `P`：杠铃下降—反转—上升轨迹。
- `C`：双肘屈伸、腕—杠铃关联。
- `T`：左右端点滞后、动态倾斜、杠铃相对肩/躯干路径。

#### 41. `dumbbell_bench_press` 哑铃卧推

- `P`：左右哑铃独立轨迹、双肘屈伸。
- `T`：左右端点、路径和反转差。

#### 42. `incline_dumbbell_press` 上斜哑铃卧推

- 继承哑铃卧推的关节语义。
- 局部纵轴和参考走廊必须按上斜变式定义，不能直接沿用平板阈值。

#### 43. `machine_chest_press` 器械推胸

- `P`：左右手柄前推—返回、肘伸展。
- `A`：座椅和躯干。
- `T`：左右手柄同步、躯干离开靠背的投影代理。

#### 44. `cable_chest_fly` 绳索夹胸

- `P`：双手柄向身体中线汇合、肩水平内收。
- `T`：肘角稳定、左右路径对称。
- `G`：躯干前冲。

#### 45. `push_up` 俯卧撑

- `P`：肘屈伸、肩/胸相对地面下降—上升。
- `T`：肩—髋—踝投影身体线、左右肘同步。
- `G`：塌腰、撅髋的投影关系变化；不得升级为脊柱诊断。

#### 46. `decline_barbell_bench_press` 下斜杠铃卧推

- 继承杠铃卧推的关节与器械语义。
- 使用下斜局部坐标和独立 `ReferenceProfile`。

#### 47. `pec_deck_fly` 蝴蝶机夹胸

- `P`：机器手柄/前臂垫汇合、肩水平内收。
- `T`：左右同步、躯干固定、肘角稳定。

#### 48. `close_grip_bench_press` 窄握杠铃卧推

- `P`：杠铃轨迹、肘伸展。
- `T`：由 context 给出的较窄握距、肘路径、左右同步。
- 不与普通卧推共享未经验证的质量阈值。

### A.11 髋铰链

#### 49. `romanian_deadlift` 罗马尼亚硬拉

- `P`：髋屈伸、杠铃/哑铃纵向轨迹。
- `T`：膝角相对稳定、负载相对身体的水平距离。
- `G`：通过明显膝屈曲把动作改变为更接近下蹲的模式。
- 器械轨迹由 exact equipment context 决定。

#### 50. `conventional_deadlift` 传统硬拉

- `P`：杠铃上升、髋伸和膝伸。
- `C`：肩—髋—杠铃阶段协同。
- `T`：肘稳定、杠铃靠近身体、左右端点同步。
- 与划船的关键区别：髋膝在硬拉中是主任务，在划船中是代偿约束。

#### 51. `hip_thrust` 臀推

- `P`：髋伸、骨盆和杠铃纵向轨迹。
- `A`：肩部凳面支撑、脚部支撑。
- `T`：膝角、左右骨盆、杠铃—骨盆同步。

#### 52. `back_extension` 罗马椅背伸

- `P`：躯干相对大腿的髋伸展轨迹。
- `A`：髋垫和下肢支撑。
- `T`：膝稳定、左右肩髋关系。
- 禁止：由普通稀疏骨架区分腰椎逐节伸展与髋伸展。

#### 53. `glute_bridge` 臀桥

- `P`：骨盆上升和髋伸。
- `A`：肩、双脚地面支撑。
- `T`：膝角、左右骨盆高度、躯干—大腿关系。

### A.12 膝关节孤立动作

#### 54. `leg_extension` 腿屈伸

- `P`：膝伸展角、踝/滚轮垫弧形轨迹。
- `A`：髋和躯干在座椅中的位置。
- `T`：左右同步、髋部离座的投影代理。

#### 55. `leg_curl` 腿弯举

- 这是模糊父动作，同时包含坐姿和俯卧语义。
- 未解析 `seated/lying` variation 时，不得编译唯一的完整质量计划；可以拒绝配置，或仅发布两种变式共有且已验证的有限事实。

#### 56. `seated_leg_curl` 坐姿腿弯举

- `P`：膝屈曲、踝/滚轮垫向下后方轨迹。
- `A`：髋和躯干靠背。
- `T`：髋离座、左右同步。

#### 57. `lying_leg_curl` 俯卧腿弯举

- `P`：膝屈曲、踝/滚轮垫向上弧形轨迹。
- `A`：骨盆和躯干在卧垫上的位置。
- `T`：骨盆抬起、左右同步。

### A.13 踝跖屈

#### 58. `calf_raise` 提踵

- `P`：踝跖屈、脚跟相对前脚掌的纵向轨迹、身体/器械上升。
- `T`：膝角稳定、左右脚跟同步。
- seated 与 standing 必须作为 variation 解析；未解析时只能发布两者共有且机位可见的有限事实。

### A.14 肩屈曲

#### 59. `front_raise` 前平举

- `P`：上臂相对躯干前举角、哑铃/腕上升轨迹。
- `T`：肘角、左右端点。
- `G`：躯干后仰、髋膝借力。

### A.15 肩外旋

#### 60. `cable_external_rotation` 绳索外旋

- `P`：肱骨相对躯干/肩带的身份定义轴向外旋。
- `C`：腕绕肘的弧形轨迹、前臂方向和手柄变化；它们不能替代轴向外旋主关系。
- `A`：肘相对躯干固定。
- `G`：躯干旋转。
- 当前普通单目 Feature operators 不能表达身份定义的轴向外旋，因此计划必须 `PlanRefusal`，不得通过腕部周期输出该动作 Rep。

### A.16 肘屈曲

共同主语义是肘屈曲和负载向肩方向移动；共同代偿候选是肩前移、上臂摆动、躯干或髋部借力。

#### 61. `barbell_biceps_curl` 杠铃弯举

- `P`：双肘角和杠铃上升轨迹。
- `T`：上臂—躯干稳定、左右杠铃端点。

#### 62. `dumbbell_biceps_curl` 哑铃弯举

- `P`：左右肘角和独立哑铃轨迹。
- `T`：左右端点、上臂稳定。

#### 63. `alternating_dumbbell_biceps_curl` 交替哑铃弯举

- `P`：当前活动侧肘和哑铃轨迹。
- `C`：左右交替状态。
- `T`：非活动侧稳定、侧间质量差。

#### 64. `hammer_curl` 锤式弯举

- 继承哑铃弯举的可见运动学语义。
- 中立握法来自 `ActionContext`；普通骨架不能证明握法。

#### 65. `cable_biceps_curl` 绳索弯举

- `P`：肘屈曲和手柄轨迹。
- `T`：上臂、躯干、拉索手柄连续性。

#### 66. `preacher_curl` 牧师凳弯举

- `P`：肘屈曲和杠铃/手柄弧形轨迹。
- `A`：上臂在牧师凳上的支撑位置。
- `T`：肩部离开支撑、左右同步。

#### 67. `incline_dumbbell_curl` 上斜哑铃弯举

- `P`：肘屈曲和哑铃轨迹。
- `A`：上斜凳和躯干。
- `T`：上臂相对躯干稳定、左右差。

### A.17 肘伸展

#### 68. `triceps_pushdown` 绳索下压

- `P`：肘伸展、手柄向下轨迹。
- `T`：上臂相对躯干固定。
- `G`：躯干前压、肩部参与。

#### 69. `overhead_triceps_extension` 过顶臂屈伸

- `P`：肘伸展、负载/手柄过顶轨迹。
- `T`：上臂和肘位置稳定、左右同步。
- `G`：躯干后仰。
- cable/dumbbell 必须由 exact equipment context 选择轨迹。

#### 70. `skull_crusher` 仰卧臂屈伸

- `P`：肘伸展、杠铃/哑铃绕肘弧形轨迹。
- `A`：肩和躯干在卧推凳上的位置。
- `T`：上臂角稳定、左右负载同步。

### A.18 机位如何把动作语义转换为测量计划

机位层不重新定义动作，只将附录 A.2–A.17 的语义关系转换为当前画面的测量代理：

| 机位/可见平面 | 优先测量 | 主要限制 |
|---|---|---|
| 侧面/近矢状面 | 肘、髋、膝、踝屈伸；躯干倾角；负载纵向与身体前后距离 | 左右对称和器械两端高度差通常不可判断 |
| 正面/近冠状面 | 肩外展；左右同步；膝髋左右差；器械端点高度差和动态倾斜 | 前后距离、髋铰链深度和矢状面夹角不可靠 |
| 斜角 | 部分深度与左右证据的折中 | 所有数值仍是 exact oblique view 的投影值，不能套用正面/侧面阈值 |
| 动作平面出画面或关键点遮挡 | 只保留当前仍可观察的 Feature | 依赖缺失关系的结论必须 `CannotJudge`，不得换用无关信号 |

编译后的结构关系是：

```text
ActionMotionDefinition
  ├─ primary_joints
  ├─ primary_tracks
  ├─ corroborating_tracks
  ├─ stable_segments
  ├─ substitution_guards
  ├─ bilateral_relations
  └─ equipment_roles
          ↓ 与 exact camera view 合并
ViewProjectionPlan
  ├─ projected_angle_definitions
  ├─ local_axes
  ├─ visible_track_proxies
  ├─ confidence/coverage gates
  └─ forbidden claims
          ↓
ActionObservationPlan
```

### A.19 必须由 exact context 进一步消歧的目录项

下列 ID 本身包含多种器械或姿态，不能只用 action ID 选择完整计算计划：

| Action ID | 必须消歧的 context | 原因 |
|---|---|---|
| `leg_curl` | seated / lying | 踝部主轨迹方向、骨盆与座椅/卧垫锚点不同 |
| `calf_raise` | seated / standing | 膝稳定语义、身体/负载主轨迹不同 |
| `lateral_raise` | dumbbell / cable / machine | 器械轨迹与阻力端点不同 |
| `rear_delt_fly` | reverse pec deck / dumbbell | 手柄约束和躯干支撑不同 |
| `romanian_deadlift` | barbell / dumbbell | 单刚体与双独立负载轨迹不同 |
| `goblet_squat` | dumbbell / kettlebell | 负载中心检测器和关联方式不同 |
| `front_raise` | dumbbell / cable | 双独立负载与拉索手柄轨迹不同 |
| `overhead_triceps_extension` | cable / dumbbell | 器械轨迹、单双侧与握持关系不同 |
| `skull_crusher` | barbell / dumbbell | 单刚体端点与双独立轨迹不同 |
| `back_extension` | exact bench/setup | 支撑锚点与动作局部轴依赖器械结构 |

如果这些 context 没有解析，Rust 必须 fail closed：拒绝安装完整质量 Bundle，或者只发布所有候选变式共有且已经验证的有限事实。不得静默选择一个默认器械或姿态。

### A.20 已确认的审核决定

1. **严格杠铃划船接受髋与躯干代偿识别。** 髋角和躯干倾角是 `SubstitutionGuard`。当它们在回拉阶段出现可靠的大幅同相运动时，结论必须为动作不标准/需要关注；不能因为杠铃和肘完成了周期就仍判为合格。
2. **深蹲必须继续拆分。** 不同杠位、支撑方式、器械路径和站姿会改变躯干参考、关节协同、负载轨迹与可观察性，不能只依赖一个通用 `squat` 质量规则。
3. **旋转动作不能用相关端点代理身份主运动。** 阿诺德推举与绳索外旋的身份定义包含当前普通单目 Feature operators 无法表达的肩轴向旋转。动作定义保持完整，但动作评估计划必须 `PlanRefusal`；系统可以保留哑铃、肘腕和躯干观察事实，却不能输出对应动作 Rep。只有新增并验证真实旋转 Feature operator 后才能开放。
4. **姿态差异优先拆成独立动作。** 坐姿、站姿、俯卧、仰卧、胸托等如果改变支撑锚点或代偿空间，应建立独立动作身份。
5. **器械拓扑差异优先拆成独立动作。** 杠铃是一个刚体，哑铃是左右两个独立负载，固定器械是受约束路径；三者需要不同的 Rep 共识、器械关联和左右规则，因此不能只作为显示名称差异。
6. **动作拆分优先于宽泛复用。** 允许复用底层角度和轨迹原语，但 `ActionMotionDefinition` 是细粒度动作的唯一语义权威；ExecutionContract、RecognitionProfile、FeatureProgram 与 RulePack 必须从它生成或验证一致，ReferenceProfile 只提供比较依据。

### A.21 动作身份的拆分规则

只要以下任一项发生变化，就应建立独立 action ID 或至少独立、不可回退的 exact variation identity：

- 主运动关节或主任务轨迹改变；
- 单刚体、双独立负载、绳索手柄、固定器械路径之间发生变化；
- 坐姿、站姿、俯卧、仰卧、胸托等支撑锚点改变；
- 可使用的代偿部位改变，例如站姿推举允许观察髋膝借力，坐姿推举主要观察躯干与靠背；
- 动作局部坐标、端点语义或 Rep 方向改变；
- 需要不同的标准参考走廊；
- 推荐机位或当前机位的可观察性契约改变。

只有在计算图、支撑锚点、器械拓扑和质量参考都相同，仅名称或不影响测量的训练提示不同时，才适合共享同一个动作身份。

### A.22 深蹲动作建议扩展

当前 registry 已有徒手深蹲、杠铃后蹲、杠铃前蹲、高脚杯深蹲、腿举和三种弓步/分腿蹲。建议继续细分：

| 建议 action ID | 中文动作 | 与其他深蹲不同的计算重点 |
|---|---|---|
| `bodyweight_air_squat` | 徒手深蹲 | 骨盆主轨迹；无负载轨迹；躯干与左右膝髋 |
| `high_bar_back_squat` | 高杠位杠铃后蹲 | 杠铃中心、髋膝踝协同、相对更直立的 exact-reference 躯干走廊 |
| `low_bar_back_squat` | 低杠位杠铃后蹲 | 杠铃中心、髋主导协同、独立躯干倾角与髋后移走廊 |
| `front_barbell_squat` | 杠铃前蹲 | 前置杠铃、肘部支撑代理、独立躯干与杠铃路径 |
| `goblet_squat` | 高脚杯深蹲 | 单一胸前负载中心、负载—躯干距离 |
| `smith_machine_back_squat` | 史密斯机后蹲 | 受约束杠铃路径、身体相对固定导轨的位置 |
| `hack_squat_machine` | 哈克深蹲 | 肩背垫与踏板锚点、受约束机身轨迹、髋膝同步 |
| `pendulum_squat_machine` | 钟摆深蹲 | 器械弧形轨迹、身体与背垫关系、髋膝端点 |
| `belt_squat` | 腰带深蹲 | 骨盆附近负载轨迹、躯干相对自由、髋膝屈伸 |
| `box_squat` | 箱式深蹲 | 可见下降端停顿、下降端点、停顿后重新上升；没有箱面观测时不声称物理接触 |
| `sumo_squat` | 相扑深蹲 | 宽站距 context、髋膝左右关系、负载中心（若有） |
| `landmine_squat` | 地雷管深蹲 | 杆端弧形轨迹、负载相对躯干、髋膝屈伸 |

弓步和分腿蹲继续保持独立，不并入通用深蹲：

- `walking_lunge`：持续向前移动；
- `alternating_reverse_lunge`：向后跨步并返回中心；
- `alternating_forward_lunge`：向前跨步并返回中心；
- `stationary_split_squat`：双脚固定、骨盆垂直运动；
- `bulgarian_split_squat`：后脚抬高支撑；
- `smith_machine_split_squat`：固定导轨负载；
- `machine_single_leg_press`：固定器械单腿轨迹。

这些动作可以复用 `hip/knee/ankle flexion` 等原语，但不能共享未经验证的深度、躯干、负载路径或左右规则。

### A.23 推肩动作建议扩展

“坐姿推肩”不能同时代表杠铃、哑铃和固定器械。建议至少拆为：

| 建议 action ID | 中文动作 | 主轨迹与约束差异 |
|---|---|---|
| `seated_barbell_shoulder_press` | 坐姿杠铃推肩 | 单一杠铃刚体；杠铃端点倾斜、双肘与杠铃同步 |
| `seated_dumbbell_shoulder_press` | 坐姿哑铃推肩 | 左右独立负载；分别计算端点、路径与反转 |
| `seated_machine_shoulder_press` | 坐姿固定器械推肩 | 受约束手柄路径；靠背/座椅锚点、左右手柄同步 |
| `standing_barbell_overhead_press` | 站姿杠铃推举 | 杠铃刚体；增加髋膝借力、躯干后仰和身体整体稳定 |
| `standing_dumbbell_shoulder_press` | 站姿哑铃推肩 | 双独立负载；增加髋膝和左右身体稳定 |
| `smith_machine_shoulder_press` | 史密斯机推肩 | 固定导轨轨迹；身体相对导轨和座椅/站姿 context |
| `seated_arnold_press` | 坐姿阿诺德推举 | 肩轴向旋转是身份主关系；当前 operator 不支持，计划能力拒绝 |
| `standing_arnold_press` | 站姿阿诺德推举 | 同上；髋膝与躯干只保留为观察事实，不能恢复动作 Rep |
| `single_arm_landmine_press` | 单臂地雷管推举 | 单侧杆端斜向弧线、躯干旋转与侧倾 |
| `bilateral_landmine_press` | 双手地雷管推举 | 单一杆端、双手关联、躯干与髋膝协同 |

### A.24 全动作族扩展矩阵

动作细分要求适用于**全部动作**，不是只扩展深蹲和推肩。下面的矩阵覆盖当前 70 个动作所属的全部运动族；每个建议项都应作为独立目录动作或 exact、不可回退的动作身份审核。

本节是扩展范围清单；每个扩展动作的具体主运动、稳定关系、追踪对象、Rep 边界和代偿条件，以《[扩展动作运动契约](./2026-08-15-expanded-action-motion-definitions.md)》为准。

#### A.24.1 胸部推举、卧推与夹胸

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 自由杠铃卧推 | 平板杠铃卧推、上斜杠铃卧推、下斜杠铃卧推、窄握杠铃卧推、宽握杠铃卧推（若产品需要） |
| 史密斯机卧推 | 史密斯平板卧推、史密斯上斜卧推、史密斯下斜卧推、史密斯窄握卧推 |
| 哑铃卧推 | 平板哑铃卧推、上斜哑铃卧推、下斜哑铃卧推、单臂哑铃卧推、交替哑铃卧推 |
| 固定器械推胸 | 坐姿水平推胸、上斜器械推胸、下斜器械推胸、单臂器械推胸、独立双臂器械推胸、联动式器械推胸 |
| 绳索推胸 | 站姿双臂绳索推胸、分腿站姿绳索推胸、单臂绳索推胸、仰卧绳索推胸 |
| 飞鸟/夹胸 | 站姿绳索夹胸、上斜绳索夹胸、下斜绳索夹胸、平板哑铃飞鸟、上斜哑铃飞鸟、蝴蝶机夹胸、单臂器械夹胸 |
| 徒手推 | 标准俯卧撑、跪姿俯卧撑、上斜俯卧撑、下斜俯卧撑、窄距俯卧撑、宽距俯卧撑、双杠胸部臂屈伸、辅助双杠臂屈伸 |

拆分原因：自由杠铃是单刚体；哑铃是左右独立负载；史密斯是固定直线；固定器械可能是联动或独立双臂；不同凳角会改变动作局部轴、肘肩关系和参考走廊。

#### A.24.2 水平拉与划船

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 俯身杠铃划船 | 正手杠铃划船、反手杠铃划船（若握法进入质量契约）、宽握杠铃划船、史密斯机划船 |
| 哑铃划船 | 单臂支撑哑铃划船、单臂无支撑哑铃划船、站姿双哑铃划船、胸托双哑铃划船、上斜凳胸托哑铃划船 |
| 绳索划船 | 坐姿双臂绳索划船、坐姿单臂绳索划船、站姿绳索划船、高位绳索划船、低位绳索划船 |
| 固定器械划船 | 胸托联动划船、胸托独立双臂划船、单臂器械划船、坐姿无胸托器械划船 |
| T 杠/地雷管划船 | 胸托 T 杠划船、自由 T 杠划船、窄握地雷管划船、宽握地雷管划船 |
| 后束拉 | 绳索面拉、绳索后束划船、哑铃后束划船、固定器械后束划船 |

胸托版本降低了髋和躯干可用的代偿空间；站姿与俯身版本则必须计算髋、膝和躯干。两者不能共享完整质量规则。

#### A.24.3 垂直拉

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 自重引体 | 正手引体、反手引体、中立握引体、宽握引体、窄握引体 |
| 辅助引体 | 弹力带辅助引体、跪垫辅助引体机、站台辅助引体机 |
| 高位下拉 | 正手宽握下拉、正手中握下拉、反手下拉、中立握下拉、单臂高位下拉、独立双臂器械下拉 |
| 直臂下拉 | 站姿绳索直臂下拉、跪姿绳索直臂下拉、单臂直臂下拉、固定器械直臂下拉 |

握法若无法由视觉可靠确认，应由 ActionContext 输入；不同辅助装置必须分别定义身体与平台/弹力带的轨迹关系。

#### A.24.4 深蹲、腿举、弓步与分腿蹲

除 A.22 已列动作外，全部继续按自由杠铃、史密斯、固定器械、徒手、哑铃/壶铃以及单双腿拆分：

- 高杠后蹲、低杠后蹲、前蹲、箱式深蹲、相扑深蹲；
- 史密斯高杠深蹲、史密斯前蹲、史密斯分腿蹲；
- 哈克深蹲、钟摆深蹲、腰带深蹲、地雷管深蹲；
- 高脚杯深蹲、双哑铃深蹲、徒手深蹲；
- 双腿腿举、单腿腿举、窄站距腿举、宽站距腿举（站距进入质量契约时）；
- 行走箭步、原地前跨箭步、原地后撤箭步、固定分腿蹲、保加利亚分腿蹲、史密斯分腿蹲。

#### A.24.5 硬拉与髋铰链

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 传统硬拉 | 传统杠铃硬拉、相扑杠铃硬拉、陷阱杠硬拉、史密斯机硬拉 |
| 罗马尼亚硬拉 | 杠铃 RDL、史密斯 RDL、双哑铃 RDL、单腿哑铃 RDL、绳索 RDL |
| 臀推/臀桥 | 杠铃臀推、史密斯臀推、固定器械臀推、单腿臀推、徒手臀桥、负重臀桥、单腿臀桥 |
| 背伸 | 45 度罗马椅背伸、水平罗马椅背伸、固定器械背伸、负重背伸 |

陷阱杠、直杠、史密斯、哑铃和绳索具有不同负载中心与路径约束；单腿版本还增加骨盆旋转和左右稳定需求。

#### A.24.6 推肩与过顶推举

采用 A.23 的完整拆分，并继续区分：坐姿/站姿、杠铃/史密斯/哑铃/固定器械、单臂/双臂、阿诺德/普通推举、单臂/双手地雷管推举。

#### A.24.7 肩外展、前举与后束飞鸟

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 侧平举 | 站姿双哑铃侧平举、坐姿双哑铃侧平举、单臂哑铃侧平举、单臂绳索侧平举、双臂绳索侧平举、固定器械侧平举 |
| 前平举 | 站姿双哑铃前平举、交替哑铃前平举、坐姿哑铃前平举、杠铃前平举、杠铃片前平举、单臂绳索前平举、双臂绳索前平举、固定器械前平举 |
| Y 举 | 站姿绳索 Y 举、上斜凳哑铃 Y 举、俯卧 Y 举、固定器械 Y 举 |
| 后束飞鸟 | 俯身哑铃后束飞鸟、坐姿俯身哑铃后束飞鸟、胸托哑铃后束飞鸟、反向蝴蝶机飞鸟、站姿双臂绳索后束飞鸟、单臂绳索后束飞鸟 |
| 直立划船 | 杠铃直立划船、史密斯直立划船、绳索直立划船、双哑铃直立划船 |

坐姿、胸托和固定器械版本会减少下肢/躯干代偿；自由站姿版本必须保留这些代偿检测。

#### A.24.8 肩外旋

- 站姿肘贴身绳索外旋；
- 站姿肩外展位绳索外旋；
- 侧卧哑铃外旋；
- 坐姿肘部支撑哑铃外旋；
- 固定器械肩外旋；
- 单臂与双臂版本。

不同版本的肘部锚点和运动平面不同，但肩轴向外旋仍是身份定义主关系。当前普通单目 Feature operators 只能保留腕肘与器械观察事实，不能生成这些动作的 Rep；计划必须能力拒绝，直到真实旋转 operator 获得验证。

#### A.24.9 肘屈曲与弯举

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 杠铃弯举 | 直杠站姿弯举、EZ 杠站姿弯举、史密斯弯举、宽握/窄握弯举（若进入契约） |
| 哑铃弯举 | 站姿双臂弯举、站姿交替弯举、坐姿双臂弯举、上斜凳弯举、锤式弯举、交叉锤式弯举、单臂集中弯举 |
| 绳索弯举 | 站姿直杆绳索弯举、绳索锤式弯举、单臂绳索弯举、高位绳索弯举 |
| 支撑弯举 | EZ 杠牧师凳弯举、哑铃牧师凳弯举、固定器械牧师弯举、单臂牧师凳弯举 |

#### A.24.10 肘伸展与臂屈伸

| 基础动作族 | 建议拆分的独立动作 |
|---|---|
| 下压 | 直杆绳索下压、绳索下压、V 杆下压、单臂绳索下压、固定器械下压 |
| 过顶伸展 | 站姿绳索过顶臂屈伸、坐姿绳索过顶臂屈伸、坐姿单哑铃过顶臂屈伸、站姿单哑铃过顶臂屈伸、单臂绳索过顶伸展 |
| 仰卧伸展 | EZ 杠仰卧臂屈伸、直杠仰卧臂屈伸、双哑铃仰卧臂屈伸、单臂哑铃仰卧臂屈伸、上斜凳仰卧臂屈伸 |
| 双杠臂屈伸 | 胸部版双杠臂屈伸、三头版直立双杠臂屈伸、辅助双杠臂屈伸、固定器械臂屈伸 |

#### A.24.11 膝屈伸与腿弯举

- 双腿坐姿腿屈伸、单腿坐姿腿屈伸、独立双侧器械腿屈伸；
- 坐姿双腿腿弯举、坐姿单腿腿弯举；
- 俯卧双腿腿弯举、俯卧单腿腿弯举；
- 站姿单腿腿弯举；
- 绳索站姿腿弯举（若产品目录支持）。

姿态改变会直接改变踝部主轨迹方向、骨盆锚点与可检测代偿，必须分开。

#### A.24.12 提踵

- 站姿固定器械提踵、史密斯站姿提踵、站姿自由负重提踵；
- 坐姿固定器械提踵、坐姿自由负重提踵；
- 腿举机提踵、哈克机提踵；
- 单腿徒手提踵、单腿负重提踵。

#### A.24.13 核心与背伸

- 地面仰卧起坐、斜板仰卧起坐、负重仰卧起坐；
- 卷腹与完整仰卧起坐必须拆分，因为髋与躯干端点不同；
- 45 度背伸、水平背伸、固定器械背伸、负重背伸；
- 若后续加入转体、侧屈、抗旋转，它们必须作为不同运动模式，不能复用 `core_flexion`。

#### A.24.14 移动与热身动作

- 原地踏步与负重踏步；
- 慢速交替提膝与快速高抬腿；
- 低冲击 step jack 与跳跃 jumping jack；
- 侧步并步、弹力带侧步、交叉侧步（若目录支持）；
- 动作速度、是否腾空、是否负重改变 Rep 周期和质量约束时应拆分。

### A.25 统一的动作身份字段

为了支持大量细分动作而不让 Rust 变成巨型 `if/else`，每个对用户独立展示的 action ID 还应具有结构化、可验证的组成字段：

```text
movement_family
posture = standing | seated | supine | prone | kneeling | chest_supported | split_stance
support = free | bench | backrest | chest_pad | floor | rack | machine_pad
equipment_topology = bodyweight | rigid_bar | dual_free_load | single_free_load |
                     cable_handle | smith_guided_bar | selectorized_machine |
                     plate_loaded_machine | lever_arm | fixed_station
path_constraint = free_3d | guided_linear | guided_arc | cable_arc | body_relative
laterality = bilateral | unilateral | alternating | independent_bilateral
setup = flat | incline | decline | high_bar | low_bar | wide_stance | narrow_stance | exact_variant
```

这些字段不是让调用方自由拼装一个未经审核的动作。每一个允许组合仍必须对应 registry 中的稳定 action identity 和完整 Bundle。它们的作用是：

- 让不同动作复用 FeatureProgram 原语和 family template；
- 让编译器验证动作身份与器械、姿态是否一致；
- 防止 `barbell_bench_press` 在运行时静默接受哑铃或史密斯输入；
- 明确为什么两个中文上相似的动作需要不同 Rep 和质量规则。

### A.26 避免无意义组合，但默认倾向细分

“全部动作都考虑扩展”不等于生成所有字段的笛卡尔积。只有现实中存在、产品准备支持，并且具有明确动作语义的组合才进入 registry。但在以下选择之间，应默认倾向拆分而不是合并：

- 自由杠铃 vs 史密斯杠铃；
- 杠铃 vs 哑铃；
- 自由重量 vs 固定器械；
- 固定器械联动双臂 vs 独立双臂；
- 坐姿 vs 站姿；
- 俯卧/仰卧 vs 站姿；
- 胸托 vs 无胸托；
- 双侧同步 vs 单侧 vs 交替；
- 平板 vs 上斜 vs 下斜；
- 主轨迹、支撑锚点或代偿空间不同的任何变式。

上述建议身份不代表已经获得 `RecognitionProfile`、`ReferenceProfile` 或训练证据。目录扩展、能力实现和证据开放必须分开管理；新增动作可以先 `catalog_only`，但不能借用父动作的质量结论假装已支持。

## 主要来源

- [Pose Trainer: Correcting Exercise Posture using Pose Estimation](https://arxiv.org/abs/2006.11718)
- [Domain Knowledge-Informed Self-Supervised Representations for Workout Form Assessment](https://arxiv.org/abs/2202.14019)
- [Counting Out Time: Class Agnostic Video Repetition Counting in the Wild](https://openaccess.thecvf.com/content_CVPR_2020/html/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.html)
- [Spatial Temporal Graph Convolutional Networks for Skeleton-Based Action Recognition](https://arxiv.org/abs/1801.07455)
- [Temporal Distance Matrices for Squat Classification](https://openaccess.thecvf.com/content_CVPRW_2019/html/CVSports/Ogata_Temporal_Distance_Matrices_for_Squat_Classification_CVPRW_2019_paper.html)
- [FineDiving: A Fine-Grained Dataset for Procedure-Aware Action Quality Assessment](https://openaccess.thecvf.com/content/CVPR2022/html/Xu_FineDiving_A_Fine-Grained_Dataset_for_Procedure-Aware_Action_Quality_Assessment_CVPR_2022_paper.html)
- [Hierarchical NeuroSymbolic Approach for Comprehensive and Explainable AQA](https://arxiv.org/abs/2403.13798)
- [EgoExo-Fitness](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/3057_ECCV_2024_paper.php)
- [FLEX Dataset](https://arxiv.org/html/2506.03198)
- [One-Shot Skeleton-Based Action Recognition on Strength and Conditioning Exercises](https://openaccess.thecvf.com/content/CVPR2023W/CVSports/html/Deyzel_One-Shot_Skeleton-Based_Action_Recognition_on_Strength_and_Conditioning_Exercises_CVPRW_2023_paper.html)
- [Using joint angles based on international biomechanical standards](https://arxiv.org/abs/2406.17443)
- [OpenCap: Human movement dynamics from smartphone videos](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)
- [UI-PRMD](https://www.mdpi.com/2306-5729/3/1/2)
- [KIMORE](https://pubmed.ncbi.nlm.nih.gov/31217121/)
- [AI Exercise Coaching Mobile App RCT](https://pmc.ncbi.nlm.nih.gov/articles/PMC10523222/)
