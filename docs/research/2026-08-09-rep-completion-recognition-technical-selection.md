# MaxPower 动作完成度识别：原材料核验、技术方案与模型选型

> 日期：2026-08-09  
> 范围：单目 RGB 健身动作，重点是向心/离心阶段、躯干姿态、左右端点/高度/时序与运动学平衡。  
> 证据口径：论文原文、作者/官方仓库、Google AI Edge、OpenMMLab 与完整专利文本；本地能力以当前源码为准。本文不是法律意见或医疗/生物力学诊断。

## 结论先行

MaxPower 不需要先自研一个“111/113 点模型”，也不应为了点数替换当前底座。推荐选型是：

1. **移动端生产骨架继续使用 MediaPipe Pose Landmarker 33 点，默认 Lite；Full 仅在同机同视频 A/B 和真机性能通过后按设备分层启用。** 33 个稳定、可见性明确的身体点已经覆盖当前要求的肩、髋、肘、腕、膝、踝。BlazePose 原论文就是面向移动端的单人 33 点实时模型；当前 Pose Landmarker 也正式输出 33 点和 world landmarks。[BlazePose 原论文](https://arxiv.org/abs/2006.10204) · [Google PoseLandmark API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmark) · [Google PoseLandmarkerResult API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarkerResult)
2. **V1 不使用 HMM、端到端 GCN 或无限制 DTW 判定动作完成度。** 已知动作下，用 Rust 的唯一 rep 边界，把 `start → extreme → return` 映射到该 exact exercise profile 的“期望向心/期望离心”，再计算有方向、有端点、有时序的运动学证据。
3. **完成度不是总分。** 建议输出 `完整完成 / 完成但存在可观察偏差 / 部分完成 / 未完成 / 无法判断`，同时展示周期、行程、双侧、返回、节奏、躯干与观测可信度等独立证据。
4. **骨架可以判断运动学平衡，不能单独判断受力平衡。** 可以可靠描述“右侧行程较小、右侧晚到极值、左右底部高度不同、躯干在拉起阶段抬起”；不能据此断言“右侧力量不足、背部没有发力、左右负荷相同”。
5. **RTMPose/RTMW WholeBody 用作离线 evaluator，不是当前移动端替代。** 133 点主要增加脸、手和脚部细节，并不是 133 个都与健身主关节有关；点数本身不保证遮挡稳定或完成度准确。[MMPose 官方仓库](https://github.com/open-mmlab/mmpose) · [RTMPose 原论文](https://arxiv.org/abs/2303.07399)
6. **先建立自有 exact action × variation × equipment × view 数据。** 公共数据适合验证方法，但 Fitness-AQA 明确限非商业使用；Fit3D 的公开下载/商业训练授权不能从论文页面直接推出，商业使用前必须单独确认。[Fitness-AQA 作者仓库](https://github.com/ParitoshParmar/Fitness-AQA) · [Fit3D 官方页](https://fit3d.imar.ro/)

最终推荐管线：

```text
相机 + 设备姿态
  → MediaPipe 33 点 observed landmarks
  → Rust 主体锁定、canonical packet、唯一 rep 边界
  → exact CompletionProfile 的阶段语义与机位契约
  → sealed rep 内的 signed kinematic features
  → phase-normalized reference envelope / 个人基线
  → categorical RepCompletionEvidence + cannot_judge
  → 文本/语音提示
```

## 原材料核验表

| 原材料主张 | 结论 | 核验与修正 |
| --- | --- | --- |
| 不需要先训练 Kemtai 同款 111/113 点模型 | **正确** | 完成度依赖关键关节稳定性、阶段边界、同上下文参考和拒答能力，不由拓扑点数单独决定。现有 33 点已覆盖 V1 所需的大关节。 |
| BlazePose 是单目 RGB、33 点、移动端实时底座 | **正确** | 原论文明确为单人 33 点，并在 Pixel 2 上报告 Lite 超过 30 FPS；该数字不是 MaxPower 真机端到端承诺。[论文](https://arxiv.org/abs/2006.10204) |
| “BlazePose GHUM Holistic 增加近似 3D、手部和全身追踪” | **需修正称谓** | 论文名确为 *BlazePose GHUM Holistic*，从单目图像预测身体与双手 3D landmarks，并用 GHUM 输出身体 pose/shape；它不等于当前 33 点 Pose Landmarker，也不等于经典 MediaPipe Holistic 的 543 点组合管线。[GHUM Holistic 论文](https://arxiv.org/abs/2206.11678) · [MediaPipe Holistic 官方说明](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/holistic.md) |
| MediaPipe Pose Classification 提供归一化、kNN、EMA、进入/退出双阈值计数 | **正确，但只是 legacy 示例** | 官方示例使用躯干尺度/方向归一化、成对关节点距离、两阶段 kNN 搜索、EMA 概率平滑及进入阈值高于退出阈值的滞回；它演示深蹲/俯卧撑终态，不是动作质量模型。[官方 Pose Classification 文档](https://mediapipe.readthedocs.io/en/latest/solutions/pose_classification.html) |
| AIFit 做 rep 分割、标准动作建模、局部偏差和自然语言反馈 | **基本正确** | AIFit 从 3D pose 分割 rep，以角度特征形成签名，再与 instructor reference 比较；其标准主要来自单位 instructor reference，并非普适医学标准。[AIFit 论文](https://openaccess.thecvf.com/content/CVPR2021/html/Fieraru_AIFit_Automatic_3D_Human-Interpretable_Feedback_Models_for_Fitness_Training_CVPR_2021_paper.html) |
| AIFit 把特征分为“主动运动”和“相对稳定特征” | **正确但应译为 active/passive** | active 是 instructor 轨迹中能量较高、定义动作的角特征；passive 是低能量、应相对保持的特征。active 用 min/max/correlation 聚合，passive 用 mean/std，不是肌肉“主动/被动发力”。[AIFit PDF](https://openaccess.thecvf.com/content/CVPR2021/papers/Fieraru_AIFit_Automatic_3D_Human-Interpretable_Feedback_Models_for_Fitness_Training_CVPR_2021_paper.pdf) |
| Fit3D 超过 300 万图像、37 种重复动作 | **正确，数字需精确表述** | 官方页写 over 3 million images、37 repeated exercises；同时列出 611 个多视角序列、2,964,236 个高精度 3D skeletons。不能把“图像数”和“唯一骨架数”混为一个数字。[Fit3D 官方页](https://fit3d.imar.ro/) |
| Motion Sequence Alignment 使用“关节加权 DTW” | **错误/未被该论文支持** | 论文把每帧 7 个关节的 3D 坐标组成向量，以整体欧氏距离建 DTW cost，再做低延迟子序列终点检测；没有给各关节不同权重。[论文全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241306/) |
| 该论文解决用户与教练速度不同 | **正确** | 它把长练习拆为关键姿态间的子序列，用子序列 DTW 在线找局部最小终点并对齐参考；适合借鉴“先分段再对齐”，不直接提供正确性标准。[论文全文](https://pmc.ncbi.nlm.nih.gov/articles/PMC6241306/) |
| *3D Pose Based Feedback for Physical Exercises* 使用 GCN 识别错误并生成修正动作 | **正确但证据范围很小** | 两分支 GCN 分别做错误分类与修正序列生成；数据仅 3 个动作、4 名受试者、362 个序列。论文的 94.2%“纠正成功”是由同一系统的分类分支把生成结果判为 correct，不是独立教练盲评。[论文](https://arxiv.org/abs/2208.03257) |
| Fitness-AQA 代表真实健身房遮挡、机位与细微错误 | **正确** | 作者论文明确指出器械遮挡、服装、光照、机位和细微错误，并覆盖 BackSquat、BarbellRow、OverheadPress；官方仓库说明数据只可非商业使用。[论文](https://arxiv.org/abs/2202.14019) · [作者仓库](https://github.com/ParitoshParmar/Fitness-AQA) |
| RTMPose WholeBody 提供 133 点 | **正确** | MMPose 官方支持 COCO-WholeBody 133 点，RTMPose-l 论文报告了 WholeBody 性能；133 是 body/foot/face/hands 的合计拓扑，不等同于 133 个健身躯干关节。[MMPose](https://github.com/open-mmlab/mmpose) · [RTMPose](https://arxiv.org/abs/2303.07399) |
| Kemtai 专利是 US11727726B2，当前 active | **基本正确，状态需保留免责声明** | Google Patents 显示 2023-08-15 授权、assignee Kemtai Ltd、status Active；页面同时明确其状态字段不是法律结论。应在商业发布前由专利律师通过 USPTO file history 复核。[完整专利](https://patents.google.com/patent/US11727726B2/en) |
| 专利披露 MF：点距、X/Y 差、三点角度；加权 L1/欧氏距离 | **正确，属于说明书示例** | 说明书段落明确列出这些 MF 和距离函数，也说明不同 MF 可使用不同权重。独立 claim 1 没有限定这些具体特征/距离；dependent claim 10 写了点距与三点角度。[完整专利说明书与 claims](https://patents.google.com/patent/US11727726B2/en#claims) |
| 专利 HMM 有 match/insertion/deletion/fast/slow 五状态 | **正确，但五状态是说明书实施例** | 说明书给出五状态例子；独立 claim 1 更抽象地要求 matching + 多个 non-matching states，至少一个反映速度差。claims 5–7 进一步限定快/慢、missing/insertion 与进入/保持分数，claim 14 才限定 HMM。[claims](https://patents.google.com/patent/US11727726B2/en#claims) |
| 人工/半自动对齐大量视频估计状态概率 | **正确，属于说明书；claims 更抽象** | 说明书提出先启发式对齐再人工调整 hundreds of pairs，并从状态进入/保持频率估计分数；claim 8–9 仅保留“训练过程 + 基于规则确定状态/统计状态分数”的抽象约束。[专利](https://patents.google.com/patent/US11727726B2/en) |
| “骨架 → 几何特征 → 时序对齐 → 局部差异评分 → 反馈”就是 Kemtai 核心 | **合理概括，不是逐字 claim** | 可用于理解实现思路，但不可据此判断侵权或自由实施。独立权利要求的组合比某个具体五状态参数更抽象；正式商业化应做 claim mapping。 |

## 外部方法对 MaxPower 的真正价值

### BlazePose / MediaPipe：保留为生产观测层

BlazePose 的价值是低延迟 33 点身体观测，不是直接输出“动作正确”。当前 Pose Landmarker 的 world landmarks 可用作辅助，但单目深度仍有投影歧义；对于左右高度和躯干倾角，V1 应优先使用经过机位约束和相机 roll 校正的 2D/body-centric 特征，而不是把 `z` 当实验室 3D 真值。[Pose Landmarker 结果](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarkerResult)

经典 MediaPipe Holistic 是 33 pose + 468 face + 双手各 21 点的多阶段组合；GHUM Holistic 研究论文又是另一套 body+hands 3D/GHUM lifting 管线。除非动作确实依赖握姿、手掌方向或手指，MaxPower V1 不应为“全点数”承担额外推理、耗电和遮挡错误。[MediaPipe Holistic](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/holistic.md)

人脸/头部姿态可以辅助训练前机位判断，但身体朝向仍应以肩线、髋线和左右深度/投影关系为主：用户可能转头而身体不转，杠铃划船时也常自然低头。

### AIFit：借鉴可解释特征体系，不复制“单教练即标准”

AIFit 最值得复用的不是某个网络，而是：

- 从 instructor demonstrations 自动区分高能量 active features 与低能量 passive features；
- active 看端点和左右相关性，passive 看均值与波动；
- 每个 rep 形成局部可解释签名，而不是只输出全身总分；
- 把数值偏差、方向和部位翻译为反馈。

MaxPower 应将其改为多来源、严格同上下文的 reference envelope：动作变式、器械、机位、身体侧别、pose model 版本都一致；参考可以来自多名教练与普通用户的独立审核，而不是把某一位 instructor 的个人风格当普适标准。

### DTW：只做边界内诊断，不做 V1 正确性引擎

Kinect 论文证明子序列 DTW 能处理速度差和在线终点；Kemtai 专利也展示了更复杂的序列状态对齐。但是 MaxPower 已有 Rust `start/peak/end`，再让 DTW决定 rep 边界会产生第二计数器。无限制 warping 还可能把停顿、提前反转、离心突然加速“扭”成正常。

V1 应采用：

- canonical sealed rep 已知边界；
- `start→extreme` 与 `extreme→end` 分开线性归一化到 0%–100%；
- 保留真实阶段毫秒数、停顿、速度峰值和反向事件；
- pointwise median + empirical q10/q90/MAD reference；
- DTW 只允许在离线敏感性分析中使用窄窗并输出 warp audit，不参与 count、completion 或 technique cue。

这与当前高位下拉参考实现一致：固定 16 个 pull + 16 个 return 节点，缺失点保持 `null`，使用逐点 q10/q90，不跨 approved peak。[`referenceTrajectory.ts`](../../src/pose/referenceTrajectory.ts#L252-L365)

### GCN/TCN：V2 的错误分类器，不接管 rep 边界

3D Pose Based Feedback 证明学习式“错误标签 + 修正序列”可行，但它只有 4 人、3 动作，且纠正成功指标不是独立评审。MaxPower 应在自有错误标注达到足够跨人/设备覆盖后，再训练每个 exact action/view 的轻量 TCN 或 GCN：

- 输入 sealed rep 的 phase-normalized kinematic features；
- 输出具体错误类别或额外证据；
- 不输出第二套 rep 边界；
- 不覆盖 deterministic cannot_judge；
- 模型无把握时回退到已验证规则/参考带。

## 当前 MaxPower 能力与关键缺口

### 可以直接复用

- Rust `SealedRep` 已包含 immutable `start/peak/end`、`canonical_slice_hash`、profile identity/hash、disposition、evidence reason 与 observation findings，是唯一可信 rep 边界。[`rust/motion-sdk/src/lib.rs`](../../rust/motion-sdk/src/lib.rs#L1089-L1141)
- `KinematicsProfile.phaseSignal` 已能把 `toExtreme/fromExtreme` 映射为 `concentric/eccentric/unknown`；大多数上肢 profile 默认去程向心、回程离心，深蹲显式相反。[`kinematicsProfile.ts`](../../src/pose/kinematicsProfile.ts#L1-L46) · [profile builder](../../src/pose/kinematicsProfile.ts#L273-L338)
- Rust 已输出 primary/secondary range below expectation 和 cycle faster than expected；它们是描述性 findings，不是正确性分数。[`lib.rs`](../../rust/motion-sdk/src/lib.rs#L1134-L1141)
- reference trajectory 已有同机位、同上下文、缺失不插值、分相位固定节点和原始 timing 的正确基本合同。[`referenceTrajectory.ts`](../../src/pose/referenceTrajectory.ts#L264-L365)
- `MotionCapabilityResolver` 已要求 exact exercise×view/profile 的 approved validation 才开放 trajectory comparison 和 technique cue；这应继续作为 user-facing gate。[`MotionCapabilityResolver.ts`](../../src/motion/MotionCapabilityResolver.ts#L56-L115)

### 当前不能满足目标的地方

1. **现有左右指标信息不足。** `bilateralAsymmetryRatio` 只取左右一个逻辑关节的 2D `rangeX/rangeY` 合成幅度，再取绝对差比例；它丢掉哪一侧更小、端点方向、同一时刻高度以及到达极值的时间差。[`repMetricsExtractor.ts`](../../src/pose/repMetricsExtractor.ts#L207-L234)
2. **现有躯干指标只能抓“变化量”。** `torsoDriftDeg` 是整 rep 躯干角序列的 robust range；它看不到 ready 时已经过于直立，也不能区分向心阶段抬体和离心阶段恢复。[`repMetricsExtractor.ts`](../../src/pose/repMetricsExtractor.ts#L201-L205)
3. **当前 `PhaseMeaning` 只有 contraction label，没有证据语义。** `concentric/eccentric` 实际应表示 exact exercise/load 假设下的 expected contraction mode；骨架观察到的是 `toExtreme/fromExtreme` 运动学，不是肌肉张力。[`formRuleEngine.ts`](../../src/pose/formRuleEngine.ts#L8-L11)
4. **当前候选规则未经验证。** 左右不对称 `>0.25` 与躯干变化 `>18°` 均为 `validationSampleSize: 0` 的 candidate，不能作为正式标准。[`formRuleEngine.ts`](../../src/pose/formRuleEngine.ts#L132-L180)
5. **旧 TypeScript extractor 会自行重新分段。** `extractRepMetrics` 仍调用 `segmentRepsBySignal/segmentRepsAuto`；正式在线 Completion V1 不能沿用这条边界来源，必须消费 Rust sealed rep。[`repMetricsExtractor.ts`](../../src/pose/repMetricsExtractor.ts#L393-L436)
6. **当前 trajectory quality cards 明确缺少端点方向与肩线。** 所以无法区分行程不足/超范围，也不能从手腕不对称误推高低肩。[`trajectoryQualityEvidence.ts`](../../src/pose/trajectoryQualityEvidence.ts#L48-L105)
7. **真机性能仍是约束。** 当前唯一记录的 OnePlus PHK110 静态场景约 13 processed FPS，低于项目 15 FPS gate；因此不能依据模型论文 benchmark 假设换成 Full/133 点后仍实时。[Android 进展报告](../reports/android-client-mvp-progress-2026-08-08.md#真机物理证据与缺口)

## 目标能力的严格定义

### 向心与离心

骨架可以识别**运动阶段**，再由已知动作 profile 赋予**期望收缩语义**：

```text
观测：ready → toExtreme → extreme → fromExtreme → returned
语义：exact exercise profile 把两个运动段映射为 expected_concentric / expected_eccentric / unknown
```

例如常规杠铃划船的拉起段通常映射为期望向心、下放段映射为期望离心；深蹲下降相反。但这不证明目标肌肉当时确实处于张力下，也不覆盖无负重摆动、器械托举或特殊变式。因此字段应命名 `expectedContractionMode`，提示文案说“向心阶段轨迹/时长”，而不是“肌肉完成了向心收缩”。

每段至少保留：duration、normalized ROM、endpoint、mean/peak velocity、pause、reversal count、trajectory corridor excess 和 required-joint observability。

### 躯干

需要从一个无符号 drift 升级为：

- `torsoInclinationReadyDeg`：起始位相对重力/校正后画面竖直轴的绝对倾角；
- `torsoInclinationExtremeDeg`：极值位倾角；
- `torsoExcursionToExtremeDeg`：去程有符号变化；
- `torsoExcursionFromExtremeDeg`：回程有符号变化；
- `torsoLateralTiltDeg` 与 `torsoLateralShift`：正面/斜侧的左右倾斜和横移；
- `torsoPhaseCurve`：分阶段曲线与参考带。

杠铃划船要区分：

- ready 时已接近直立：selected variant 的 setup/context mismatch；
- ready 正常，但拉起时躯干明显抬起：观察到 torso extension strategy；
- 躯干前倾正常且稳定：该维度完成。

反馈可以说“当前起始躯干比所选俯身划船参考更直立，轨迹更接近向上提拉”或“拉起阶段躯干抬起 12°”；不能说“背部没发力，力量转移给斜方肌”。最多给证据标注的机械需求倾向，并要求结合动作变式和体感确认。

### 左右高度、端点和同步

左右不能再压缩成一个绝对幅度差。每个双侧 feature 至少要同时计算：

- `left/rightRange`：各自有符号 ROM；
- `left/rightEndpoint`：各自端点在 body-centric up axis 的位置；
- `simultaneousEndpointDelta`：canonical extreme 时左右高度差；
- `individualEndpointDelta`：左右各自最佳端点的高度差；
- `peakTimingOffsetMs`：左右到达各自极值的时间差；
- `phaseDurationDeltaMs`：左右去程/回程时差；
- `trajectoryCorrelation` 与 `velocityCorrelation`：整段同步性；
- `sideDominance`：明确 `left_lower/right_lower/left_less_range/right_less_range/left_lags/right_lags`。

同时测“canonical peak 同时高度”和“各侧自己的最佳高度”非常重要：前者低但后者一致，往往是同步问题；两者都低，才更像一侧行程不足。

### “平衡”的边界

| 能力 | 单目骨架能否判断 | 合适措辞 |
| --- | --- | --- |
| 左右行程、端点高度、到达时序、轨迹相关 | 可以，在匹配机位且双侧可见时 | 运动学对称/同步、左/右侧完成差异 |
| 躯干/骨盆横移与侧倾 | 可以，正面或斜侧且关键点可见时 | 观察到向左偏移/右侧下沉 |
| 2D 身体中心投影是否落在脚部支撑区 | 可做粗略代理，必须脚部入镜 | 身体投影偏移，不称压力中心 |
| 左右脚真实压力、关节力矩、杠铃两端受力 | 不可以 | 需要力板、双侧力传感器或器械数据 |
| 左右肌肉激活 | 不可以 | 需要 sEMG；EMG 也不等于肌肉力 |

因此产品术语统一为**运动学平衡/双侧完成度**，不要叫**受力平衡**。

## 推荐的模块 seam

### 1. `CaptureReadinessProfile`

它在 `begin_set` 前判断能否观察所选指标，不参与计数：

```ts
interface CaptureReadinessProfile {
  exactExerciseContext: string;
  preferredViews: readonly CaptureView[];
  allowedBodyYawDeg: readonly [number, number];
  allowedCameraRollDeg: readonly [number, number];
  allowedCameraPitchDeg?: readonly [number, number];
  requiredLandmarks: readonly LandmarkId[];
  requiresFeetVisible: boolean;
  requiresEquipmentVisible: boolean;
  setupFeatureRequirements: readonly SetupFeatureRequirement[];
}
```

身体 yaw 以肩线/髋线为主，人脸 yaw 只辅助；设备 IMU 用来校正 camera roll/pitch。readiness 不通过时提示移动手机、转身、后退或露出关节，不能进入完整 technique cue 能力。

### 2. `CompletionProfile`，与 `RecognitionProfile` 分离

`RecognitionProfile` 只负责“一个周期是否存在”；`CompletionProfile` 才定义 exact action/view 的可观察完成证据：

```ts
interface CompletionProfile {
  schemaVersion: string;
  identity: string;
  contentHash: string;
  exerciseVariantId: string;
  equipment: string;
  capturePosition: CapturePosition;
  poseTopology: "blazepose-33";
  phaseMap: {
    toExtreme: "expected_concentric" | "expected_eccentric" | "unknown";
    fromExtreme: "expected_concentric" | "expected_eccentric" | "unknown";
  };
  featureDefinitions: readonly KinematicFeatureDefinition[];
  referenceEnvelope?: ApprovedReferenceEnvelope;
  cueRules: readonly CompletionCueRule[];
  validationApprovalId?: string;
}
```

不可把 simulated recognition initializer 当标准参考；没有 exact approved envelope 时，可以输出周期与个人相对变化，但不输出“达到标准动作范围”。

### 3. 三类数据必须显式区分

```ts
interface ObservedLandmark {
  id: LandmarkId;
  coordinateSpace: "image_normalized" | "world_estimated";
  x: number; y: number; z?: number;
  visibility: number;
  sourceModel: string;
}

interface DerivedLandmark {
  id: "shoulder_mid" | "hip_mid" | "body_up_axis" | "body_right_axis";
  sourceLandmarks: readonly LandmarkId[];
  definitionVersion: string;
  value: readonly number[] | null;
  confidence: number;
  refusalReason?: string;
}

interface KinematicFeatureObservation {
  featureId: string;
  side: "left" | "right" | "bilateral" | "midline";
  phase: "ready" | "to_extreme" | "extreme" | "from_extreme" | "returned";
  value: number | null;
  unit: "deg" | "ms" | "normalized" | "ratio";
  direction?: "positive" | "negative" | "none";
  confidence: number;
  usableFrameRatio: number;
  requiredLandmarks: readonly LandmarkId[];
  refusalReason?: string;
}
```

派生点不能伪装成模型直接观测点；缺少来源 landmark 时保持 `null`，不得镜像、借用另一人或无依据插值。

### 4. `RepCompletionEvidence` 绑定 Rust sealed rep

```ts
interface RepCompletionEvidence {
  schemaVersion: string;
  subjectEpoch: number;
  repId: number;
  revision: number;
  canonicalSliceHash: string;
  recognitionProfileIdentity: string;
  recognitionProfileHash: string;
  completionProfileIdentity: string;
  completionProfileHash: string;
  dimensions: {
    cycle: CompletionDimension;
    range: CompletionDimension;
    bilateral: CompletionDimension;
    return: CompletionDimension;
    tempo: CompletionDimension;
    torso: CompletionDimension;
  };
  overall: "complete" | "complete_with_observed_deviation" |
    "partially_complete" | "not_complete" | "cannot_judge";
  observations: readonly KinematicFeatureObservation[];
  evidenceRefs: readonly string[];
}
```

生产实现优先把 measurement 与 categorical evidence 放入 Rust/packet 的版本化扩展，让 Android、iOS、Web review 消费同一个事实；TypeScript 只负责 copy/UI。若先在 TypeScript 原型，输入也必须是经 hash 验证的 canonical sealed slice，禁止再次调用 segmenter。

## 机位与可观测性选型

| 机位 | 最强能力 | 明显弱项 | V1 策略 |
| --- | --- | --- | --- |
| 侧面 | 躯干前倾、髋/膝/肘 sagittal ROM、前后轨迹 | 远侧遮挡，左右比较很弱 | 杠铃划船躯干、深蹲深度等优先 |
| 正面/后面 | 左右高度、双侧 ROM、侧倾/横移、同步 | 无法可靠判断 sagittal 前倾与杠铃前后路径 | 侧平举、肩推等双侧完成优先 |
| 斜侧 45° | 同时保留部分躯干和双侧信息 | 所有绝对角度都受投影影响，是折中而非“万能” | 同动作同机位校准后使用，并降低非主指标置信度 |

单个手机机位不能同时最大化 sagittal torso 与 bilateral symmetry。产品必须让每个 exact profile 声明“本机位可判断哪些维度”；若用户要求同时高可信判断两者，需要两次拍摄、第二机位或多相机，而不是让模型猜。

## 模型与算法选型

| 层级 | 选择 | 用途 | 不选/限制原因 |
| --- | --- | --- | --- |
| 移动端 pose | **MediaPipe Pose Lite** | 默认实时 33 点观测 | 当前真机只有约 13 FPS 证据，先守性能与稳定性 |
| 高性能设备 pose | **MediaPipe Full，条件启用** | 同拓扑、较高容量 | 必须按设备/动作/遮挡 A/B，不能用论文 latency 直接放行 |
| 离线 pose evaluator | **RTMPose/RTMW body 或 WholeBody** | 与 MediaPipe 同批比较、辅助人工标注、发现系统偏差 | 133 点不是完成度模型；移动端部署与历史阈值均需重做 |
| rep/phase | **现有 Rust FSM** | 唯一 start/extreme/end、count、continuity | 不增加第二套 kNN/HMM/TCN 边界 |
| V1 completion | **signed rules + phase reference envelope** | 行程、端点、同步、躯干、节奏、拒答 | 可解释、可按 exact context 验证 |
| alignment | **分相位线性归一化** | 比较快慢不同的完整 rep | 保留真实 timing；不吞掉停顿与反向 |
| offline alignment | **窄窗 DTW，仅诊断** | 敏感性/A-B 实验 | 不作为 count、completion 或 correctness 来源 |
| V2 error model | **小型 one-vs-rest TCN/GCN** | 已标注常见错误的补充分类证据 | 数据不足前不训练；永不覆盖拒答和 canonical boundary |
| 器械层 | **杠铃/器械关键物体跟踪** | 杠路径、触胸/终点、杠铃倾斜 | 人体骨架无法替代器械轨迹 |

## V1 实施范围

### V1.0：完成度语义和 sealed-rep 测量

1. 冻结 `CompletionProfile/v1` 与 `RepCompletionEvidence/v1`。
2. Rust sealed rep 是唯一输入边界；移除在线 Completion 对 TS re-segmentation 的依赖。
3. 先实现：
   - cycle closure 和 return completion；
   - phase duration 与 expected contraction mapping；
   - signed left/right range、endpoint、peak timing；
   - ready absolute torso inclination、phase-signed torso excursion；
   - observation confidence/cannot_judge。
4. 没有人群 reference 时允许个人相对基线：从同用户、同动作、同机位的一组稳定已确认 reps 取 median/MAD；不把第一 rep 自动当标准。
5. UI 只输出分类状态 + 证据 + 下一条可执行提示，不做 0–100 总分。

建议先验证两个互补 exact context：

- `barbell_row × selected variation × side/oblique45`：起始躯干倾角、拉起阶段躯干抬起、肘/腕行程、阶段时长；
- `lateral_raise` 或 `seated_shoulder_press × front`：左右端点高度、ROM、peak timing 和躯干侧倾。

不要一开始承诺 65 个动作全部 technique assessment；catalog 可选择、可计数、可做完成度是三种不同成熟度。

### V1.5：严格参考带和动作上下文匹配

- 多名教练和普通用户的 exact action×view 视频；
- 教练标注 start/extreme/end、动作变式匹配、常见可观察偏差；
- 每段独立建 pointwise median/q10/q90/MAD，同时保留 raw timing；
- setup mismatch 与 in-rep strategy deviation 分开；
- 通过 `ValidatedAnalysisRecord` 后才开放具体 technique cue。

### V2：学习模型与额外传感器

- 用 V1 已验证 features 训练轻量 TCN/GCN 做具体错误类别的附加证据；
- 用 RTMPose/RTMW 做离线 second opinion，不把模型分歧自动当真值；
- 卧推、杠铃划船、深蹲增加杠铃/器械跟踪；
- 若产品要说“左右受力”，增加双侧力传感器、力板或带传感器器械；若要说“肌肉激活”，增加 sEMG，并仍避免把 EMG 直接等同肌肉力；
- 多机位/深度只在确实需要消除单目投影歧义时引入。

## 数据与验证方案

### 数据分层

1. **公共数据只做方法探索和 evaluator benchmark。** Fit3D 可研究 3D 角特征、active/passive 和多视角；Fitness-AQA 可研究真实健身房遮挡和细微错误，但其数据明确非商业。任何模型训练前逐一保存数据条款快照和用途审计。
2. **产品阈值只来自自有、获授权、exact-context 数据。** 每条记录包含 action variation、equipment、load、view、lens、phone、pose model、主体、session、教练标签和 canonical packets。
3. **划分按主体/会话/设备隔离。** 不能从同一人的相邻 rep 随机切到 train/test；否则会严重高估泛化。
4. **错误要真实且可复核。** 不鼓励用户危险地故意做错；由教练在安全负荷下演示可观察偏差，或从正常训练中标注自然发生的偏差。

### Ground truth

- 两名合格教练独立标注：动作变式匹配、周期完整、ROM、左右、躯干和节奏；分歧仲裁；
- start/extreme/end 与左右 peak timestamps 做帧级标签；
- 躯干/关节角用校准视频、标记点或 mocap 子集建立数值真值；
- 力学结论必须有对应传感器，不用教练视觉标签伪造“真实左右力”。

### 评测指标

| 层级 | 指标 |
| --- | --- |
| Pose/观测 | required-joint usable frame ratio、landmark missing/outlier、left-right swap rate、normalized jitter、角度/端点 MAE、遮挡恢复时间 |
| Rep/phase | rep precision/recall/F1、exact count、start/extreme/end boundary MAE、phase transition MAE、rest false reps |
| 数值特征 | torso ready angle MAE、signed torso excursion MAE、left/right ROM MAE、endpoint delta MAE、peak timing offset MAE |
| Completion finding | 每类 precision/recall/F1、教练一致性、跨设备/机位性能、错误方向准确率 |
| 拒答 | coverage、answered-risk curve、低可见性下 false cue rate、cannot_judge 是否覆盖真正不可判样本 |
| 设备 | processed FPS、P50/P95 latency、掉帧/积压、温度、耗电、8 分钟稳定性 |

发布门槛应以**提示 precision 优先**：错误提示比漏提示更伤信任。建议工程目标是每个用户可见 technique cue 在 held-out exact context 上达到至少 90% precision，再逐步提高 recall；任何达不到的动作/机位保持 `measured_not_judged`。这是一项产品门槛建议，不是论文事实。

现有项目门槛继续保留：计数误差不超过 10%、start/stop 延迟不超过 1 秒、30 秒休息最多 1 个 false rep、有效帧至少 90%、processed FPS 至少 15、无失控 backlog，并补上 technique cue 的精确率与拒答指标。

## 拒答和反馈政策

### 必须 `cannot_judge`

- exact action/variation/equipment/view profile 不匹配；
- required landmarks 任一侧长期不可见或左右 swap；
- 相机 roll/pitch、距离或 body yaw 超出可校准范围；
- subject epoch 改变、canonical slice hash 不匹配、rep rejected；
- 侧面机位却要求左右高度，或正面机位却要求 sagittal 躯干前倾；
- reference 未批准，却请求“是否达到标准范围”；
- 设备掉帧使 peak timing/velocity 不可信。

### 允许的提示

- “右侧行程比左侧小，且右侧提前回程。”
- “本次左右各自最高点接近，但右侧晚 140ms 到达，主要是同步差异。”
- “拉起阶段躯干由 42° 变为 29°，观察到明显抬体。”
- “当前起始躯干比所选杠铃划船参考更直立，请确认动作变式或重新俯身设置。”
- “离心回程比你的稳定 reps 中位数快 24%；请在下一次保持可控回程。”

### 禁止的结论

- “右侧力量不足/左右发力不平衡”；
- “背部没发力，肩和斜方肌接管”；
- “肌肉疲劳 70%”；
- “这个角度一定受伤”；
- “MediaPipe 的 z 已证明真实 3D 关节角”。

可以提供条件性解释：某种可观察运动策略**可能**改变机械需求，但必须标为解释而非当前肌肉激活测量。

## 关于 Kemtai 专利的工程处理

可以阅读专利理解问题，但不建议实现“逐帧 trainer/trainee 全对全 MF 距离 + 五状态 HMM + 相同进入/保持概率训练 + 相似度评分”的同构管线。技术上，MaxPower 也不需要这条路线：canonical rep 已有边界，phase-normalized envelope 更容易审计且能保留真实 timing。

但“换掉 HMM”不自动等于规避权利要求；独立 claim 1 更抽象地组合了双视频 frame features、inter-frame similarity、含速度差的多状态分数、sequence alignment 和 evaluation score。正式商业化前应由专利律师按最终实现做 claim chart、检查 continuation/家族与 USPTO file history。本文只做技术事实核验，不提供 freedom-to-operate 结论。[US11727726B2 claims](https://patents.google.com/patent/US11727726B2/en#claims)

## 明确决策

**现在就选：MediaPipe 33 点 + Rust canonical FSM + exact CompletionProfile + signed phase features + phase reference envelope + strict refusal。**

不选：

- 为点数而自研 111/113 点骨架；
- 把 MediaPipe kNN 示例升级成 65 类正确性模型；
- 让 DTW/HMM/GCN 重新决定 rep 边界；
- 用一个左右幅度绝对值代表“平衡”；
- 用一个 torso robust range 代表“起始姿态 + 借力”；
- 用骨架输出肌肉激活或真实受力结论。

该方案能真实实现用户需要的四类判断：

1. 通过 exact profile 将 sealed rep 的运动段解释为期望向心/期望离心；
2. 分阶段判断行程、返回、节奏、停顿与反向；
3. 判断 ready 绝对躯干角和各阶段有符号躯干变化；
4. 判断左右端点高度、ROM、时序和运动学同步，并在机位或可见性不足时明确拒答。

它不能、也不应承诺只靠单目骨架判断真实左右受力或具体肌肉发力比例。把这个边界写进数据结构、提示文案和 validation gate，反而是让“动作完成度”达到可商用可信度的关键。
