# 将 2D 骨架重复计数提高到 95% exact-set 的技术路径

日期：2026-08-09

## 结论

在“规定设备、规定机位、单人、全身可见、移动端离线、MediaPipe/BlazePose Heavy、Rust SDK 唯一计数源”的范围内，**95% 整组次数完全一致是值得验证的工程目标，但现有公开研究不能证明我们已经拥有一条可直接复用、必然达到 95% 的方案**。当前从 69.48% 提升到 95% 不能主要依赖继续搜索单信号阈值；需要同时改变数据口径、运行时准入、时序表示和 Rust 解码器。

一个关键对照是：MM-Fit 原论文在其同一语料上，用 skeleton modality 做峰值与自相关重复计数，报告的整组正确率就是 **69.81%**；我们的 616 组 Rust 回放为 **69.48%**，只差 0.33 个百分点。也就是说，目前结果很可能已经接近“单骨架信号 + 手工峰值规则”在这套弱标签与裁切协议下的原始基线，而不是再调几个阈值就能跨到 95%。要跨越这 25 个百分点，必须引入动作专用的因果时序相位模型、Rust 有约束状态图，以及由目标端同版本 MediaPipe 产生的数据。

建议采用的核心方案是：

> `同源 MediaPipe Heavy 骨架 + 动作专用多信号特征 + 轻量因果相位模型 + Rust 有约束状态图 + 开始/结束边界协议 + 个体自校准 + 可观测性拒识`

其中最值得直接借鉴的是 PoseRAC 的“两种显著姿态 + 滞回触发”思想、RepNet 的周期性/时序自相似交叉检查，以及 MS-TCN 的膨胀时序卷积与平滑损失；但不应把这些论文的完整视频模型直接搬到移动端，也不能把它们的 MAE、OBO 或动作分类准确率当作我们的 exact-set accuracy。

本调研还确认一个会影响当前 MM-Fit 结果的口径问题：**现有由肩髋轴估算的 `front/oblique45/side` 不是 MM-Fit 官方相机编号，而是身体相对骨架坐标的朝向代理。应停止把它直接映射成 `frontLeft45`、`left` 等真实采集机位。** 对俯卧撑和仰卧起坐，身体长轴接近水平，且 MM-Fit 的 3D 骨架是单目 2D pose lifting 的结果，该代理量更不能被当作经过验证的物理相机机位。

## 95% 到底意味着什么

这里的主指标必须继续使用：

```text
exact_set_accuracy = 预测次数完全等于真值次数的 set 数 / 全部 eligible set 数
```

如果系统允许拒识，还必须同时报告两个数，不能只报告接受样本上的准确率：

```text
accepted_exact_accuracy = 接受并输出计数的 set 中，整组完全一致的比例
coverage = 被系统接受并输出计数的 eligible set 比例
```

建议产品级目标定义为：

- 支持范围内的全部 eligible set：`exact_set_accuracy >= 95%`；
- 若引入拒识：同时要求 `accepted_exact_accuracy >= 97%` 且 `coverage >= 90%`，并单独报告拒识原因；
- 非当前动作、准备、休息、走动等负样本必须测每分钟误触发次数；
- 自有逐 rep 标签上继续测 start/peak/end 匹配，MM-Fit 只能测组级次数。

整组 exact 比逐次识别严苛得多。以每组 10 次、每次错误相互独立作直观估算，要让整组正确率达到 95%，每次周期决策正确率需约为 `0.95^(1/10) = 99.49%`；20 次一组时约为 99.74%。真实错误还会因遮挡、丢帧和错误初态成串出现，所以“逐 rep 95%”远不足以支持“整组 exact 95%”。

## 公开结果为什么不能直接类比

| 来源 | 论文/官方结果 | 与我们的 exact-set 的差异 |
|---|---|---|
| MediaPipe Pose | Heavy 在 Yoga/Dance/HIIT 上报告 17 个关键点的 PCK@0.2 为 96.4%/97.2%/97.5%，Pixel 3 GPU 延迟约 53 ms | 这是单帧关键点空间精度，不是动作识别、相位边界或整组次数。单个关键点落在容差内也不保证肘角极值稳定。[官方模型说明](https://chuoling.github.io/mediapipe/solutions/pose.html#pose-estimation-quality) |
| MM-Fit | 论文摘要报告未见参与者上的多模态活动识别准确率 96% | 这是窗口级动作类别识别，不是重复计数 exact。MM-Fit 的重复标签只有 set 起止和总次数。[MM-Fit 论文](https://vradu.uk/publications/UbiComp2020.pdf) |
| MM-Fit skeleton 计数 | 论文的 skeleton modality 整组重复计数正确率为 69.81%；我们的 616 组 Rust 回放为 69.48% | 这是最可比的公开基线，二者接近说明当前瓶颈不是一个偶然的阈值错误；但它使用 OpenPose/lifted pose 和论文自己的峰值流程，仍不是 MediaPipe Heavy 产品端结果。[MM-Fit 论文](https://vradu.uk/publications/UbiComp2020.pdf) |
| RepNet | QUVA 上 normalized MAE 0.104、OBO error 0.17；Countix test 为 0.3641/0.3034 | OBO 把“误差不超过 1 次”归入同一容差口径；论文明确将 MAE 除以真值次数。两者都不是次数必须完全相等。[CVPR 2020 论文](https://openaccess.thecvf.com/content_CVPR_2020/papers/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.pdf) |
| TransRAC | RepCount-A 的 OBO accuracy 0.2913、MAE 0.4431 | OBO 仍允许 ±1；模型还使用视频级特征和多尺度 Transformer，不能直接代表骨架移动端性能。[CVPR 2022 论文](https://openaccess.thecvf.com/content/CVPR2022/papers/Hu_TransRAC_Encoding_Multi-Scale_Temporal_Correlation_With_Transformers_for_Repetitive_Action_CVPR_2022_paper.pdf) |
| PoseRAC | RepCount-pose 上 MAE 0.236、OBO accuracy 0.560，报告每帧约 20 ms | 它最接近我们的骨架方案，但 OBO 仍不是 exact；公开测试包含多动作公开视频，且论文没有报告我们的整组 exact 指标。[论文](https://arxiv.org/abs/2303.08450)、[官方仓库](https://github.com/MiracleDance/PoseRAC) |
| MS-TCN | 在长视频上用多阶段膨胀 1D 卷积和 smoothing loss 减少过分割 | 它报告 action segmentation 的 frame accuracy、edit/F1 等，不是 rep exact；这里只借鉴轻量时序结构与平滑约束。[CVPR 2019 论文](https://openaccess.thecvf.com/content_CVPR_2019/html/Abu_Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.html) |

因此目前没有一手来源支持“采用某个公开模型即可达到 95% exact-set”。论文的价值是提供结构证据，不是提供可直接宣传的产品准确率。

## MM-Fit 相机与 pose 口径的修正

MM-Fit 官方论文说明：参与者在**两台** Orbbec Astra Pro 深度相机前运动，彩色和深度数据以两个 viewpoint 录制；但发布的 2D/3D pose 数据每个 workout 只有一份 `wXX_pose_2d.npy` 和一份 `wXX_pose_3d.npy`。论文还明确说明，3D pose 并不是双目三角化或深度真值，而是：

1. 从单个 RGB view 用 OpenPose 得到 2D pose；
2. 再用 Martinez 等人的 2D-to-3D 回归器 lift 成 3D pose。

这些事实见 [MM-Fit 论文第 3.1 节](https://vradu.uk/publications/UbiComp2020.pdf) 和 [官方数据页](https://mmfit.github.io/)。官方只说明每次 workout 的相机布置近似相同，没有给发布 pose 文件可用于恢复的 camera ID/extrinsic 元数据。

当前 `analyze_mmfit_view.py` 使用 3D 肩/髋左右轴在 x-z 平面的角度，并用 2D 肩宽/躯干长比复核。这个量最多能描述**身体横轴相对于该 pose 坐标系的投影朝向**，不能证明它是“Camera 1/Camera 2”或 MaxPower 的 `frontLeft45/left`。对站立动作，它可以作为 `bodyOrientationProxy`；对俯卧撑、仰卧起坐和明显躯干旋转动作，3D lifting 的深度歧义与姿态平面变化会削弱其含义。BlazePose GHUM 论文同样指出单目 3D 存在相同 2D 投影对应多个 3D 姿态的歧义。[BlazePose GHUM Holistic 论文](https://arxiv.org/abs/2206.11678)

立即建议：

- 将研究 artifact 中的 `cameraView` 重命名为 `bodyOrientationProxy`；
- 取消 `oblique45 → frontLeft45`、`side → left` 的自动映射；
- 在重跑基准前，MM-Fit profile 先按 `exercise × poseSource(OpenPose-18) × orientationProxy/unknown` 隔离，不能晋升为正式 MediaPipe profile；
- 抽样查看原始 RGB，人工确认站立动作的身体朝向；俯卧撑、仰卧起坐默认 `orientation=unknown`，除非从相机元数据或 RGB 验证；
- 最终要用同一个 MediaPipe Heavy 版本重新提取 MM-Fit RGB，才能评估其对移动端 profile 的迁移价值。

这个修正可能改变目前 69.48% 的分桶基准；旧结果不应继续被解释为“不同相机机位上的准确率”。

## 推荐的运行时架构

### 1. 先做动作专用可观测性门控

每个动作 profile 声明：

- 必需关节和可替代关节；
- 支持的身体相对相机朝向范围；
- 人体 bbox 尺寸和完整性；
- 必需关节的 visibility/presence 覆盖率；
- 需要观察的主要运动平面和最小有效幅度。

在进入计数前收集 1–2 秒稳定窗口。只有主体锁定、必需关节可见、动作信号可分辨时才进入 `ready`。MediaPipe 模型卡将 visibility 定义为关键点在画面内且未被身体或物体遮挡的概率；Tasks API 也提供 pose detection、presence、tracking 阈值和 world landmarks，这些信号应进入 Rust，而不是只传 x/y 坐标。[模型卡](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)、[Pose Landmarker options](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarkerOptions)、[结果结构](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarkerResult)

这会把类似当前某条正面卧推中肘/腕只有约 5%–7% 帧可见的输入，在开始前判定为“不可测”，而不是在结束后错误显示 0/4。拒识不能计作 exact，但能避免不可观察输入污染训练和用户信任。

### 2. 统一为身体坐标系的多信号特征

不要再为每个动作只挑一个角度或距离。Rust 前置特征层对同一帧输出一个小型、可解释的 feature vector：

- 2D 与 world landmark 的关节角；
- 以髋中点为原点、躯干长度/肩宽为尺度的有符号距离；
- 相对肩轴/髋轴旋转后的局部坐标；
- 一阶速度、方向变化和短窗幅度；
- 左右侧对称度以及“最可信侧/双侧一致”特征；
- 每个特征对应的 visibility/presence/missingness mask。

PoseRAC 的官方实现证明了 33×3 pose 可以先归一化再用极小的姿态分类器区分两种显著姿态；其官方代码随后用不同 enter/exit 阈值形成滞回，减少抖动误计。[PoseRAC 官方实现](https://github.com/MiracleDance/PoseRAC/blob/main/model.py) 但不建议照搬其“逐帧全骨架 min-max”归一化：关节缺失或画外点会使范围瞬间改变。对我们的受控动作，固定骨盆原点和躯干尺度更稳定，而且 missing 必须保留为 unknown，不能补零伪造。

### 3. 增加轻量因果相位头，不替换 Rust 计数器

建议为每个动作或相近动作族训练一个很小的 causal temporal head，输入 10–15 Hz 的上述 feature vector，窗口约覆盖最近 2–4 个预期周期。输出只提供证据，不直接加次数：

```text
P(background), P(ready), P(effort), P(peak), P(return)
periodicity_score
estimated_period
observation_confidence
```

首选原型是 2–4 层 depthwise/dilated 1D convolution + 小型 pointwise projection，而不是完整 TransRAC/RepNet。MS-TCN 证明膨胀 1D 卷积能以全时序分辨率捕获长程依赖，分类损失加 smoothing loss 能抑制短促的过分割；我们只取它的结构原则并做成因果、小通道版本。[MS-TCN 论文](https://openaccess.thecvf.com/content_CVPR_2019/papers/Abu_Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.pdf)

再增加一个很小的周期一致性分支。RepNet 的关键证据是 temporal self-similarity bottleneck 能显著改善跨动作/合成到真实数据的泛化，且论文用 per-frame period 与 periodicity 分开建模。[RepNet 论文](https://openaccess.thecvf.com/content_CVPR_2020/papers/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.pdf) 在我们的骨架特征维度很小的前提下，可以计算最近窗口与若干 lag 的归一化相似度或自相关，不需要复制其 ResNet-50 视频编码器和 Transformer。

### 4. Rust 用受约束状态图完成唯一计数

Rust SDK 保持唯一 rep lifecycle/count source。时序头只输出概率与周期证据，Rust 负责：

```text
unobservable
  ↓ 通过准入
ready --持续 effort--> effort --持续 peak--> peak --完整 return--> confirmed_rep
  ↑                          | missing/timeout/反向跳变
  └──────── return ──────────┴──────────────→ rejected_attempt
```

每条转移同时约束：

- enter/exit 双阈值与最短驻留时间；
- 与个体周期估计一致的最短/最长 rep 时长；
- 峰值前后的单调运动方向；
- 多信号至少两类证据一致，或一个强信号加高 periodicity；
- missingness 超限时暂停尝试，而不是沿用旧坐标；
- 一次完整 `ready → effort → peak → return` 才确认 rep。

PoseRAC 官方实现中的两显著姿态触发器与这种状态图非常接近；它的论文还报告 BlazePose 输入优于其 ViTPose 实验并且更快，但其 OBO 0.56 说明“两个姿态 + 简单触发”本身仍不够达到我们的 exact 目标。因此需要额外的持续时间、方向、周期和缺失数据约束。

### 5. 解决首尾周期，而不是在 finish 时补一次

MM-Fit 论文说明它只人工标注 set 的开始/结束帧和总次数，没有逐 rep 边界。现有大量 -1 可能混合了真实漏检和 clip 在周期中间裁切。为产品流与离线 benchmark 分别定义：

- **实时课程**：用户点击开始后，先等待稳定 `ready`；计数 UI 显示“准备”，不立即把首帧当作动作状态。点击结束后给予最多一个个体周期的 return grace，仅当完整回到 ready 才封存最后一次；否则记为 incomplete，不自动 +1。
- **离线训练/回放**：只对人工边界内的完整中间周期计算 phase；允许裁掉准备段和结束后的残余动作，但不得根据真值次数决定裁切位置。
- **MM-Fit**：总次数可用于 set-count loss/候选选择，但不能反推 10 个峰作为真值。若用动态规划在训练集生成 count-constrained pseudo-boundaries，必须标为 weak label，并只在未见 subject、推理时不提供次数的测试集上验收。

这保留了当前 Rust `finish_set` 不凭空合成 rep 的正确语义，同时消除真实产品流中“刚好从半程开始录像”的问题。

### 6. 做一次受限的个体自校准

课程开始前让用户按示范完成 2 次慢速校准 rep；Rust 从高置信完整周期估计：

- ready/peak 的个体分位数区间；
- ROM 与左右差异；
- 中位周期和允许速度范围；
- 哪一侧关节更稳定。

之后把全局 profile 与个人参数做有界融合，例如个人阈值最多偏移全局范围的固定比例，并在一个 set 内冻结，避免每次失败动作继续拖动阈值。校准 rep 与正式计数分开，不能既用它调参又把它算作独立测试结果。

### 7. 模型部署不降低 pose 等级

MediaPipe 官方基准显示 Heavy 比 Full/Lite 的关键点质量更高，但 Pixel 3 GPU 延迟也约为 53 ms；保持 Heavy、单人、latest-frame 是合理选择。[MediaPipe Pose 官方基准](https://chuoling.github.io/mediapipe/solutions/pose.html#pose-estimation-quality) 实时 API 允许为了降低延迟而丢输入帧，所以 Rust 必须使用真实单调 timestamp 和 `dt`，不能假定每一帧都到达。[Pose Landmarker live stream API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker)

轻量 temporal head 可以离线训练后量化；若采用 ONNX/ORT，官方建议 transformer/RNN 先尝试动态 8-bit、CNN 先尝试静态 8-bit，并明确要求对量化精度损失做调试；移动端文档还指出 8-bit 权重通常可把 32-bit 权重体积降约 4 倍，但 NNAPI/XNNPACK 性能取决于设备和算子分区。[ONNX Runtime 量化文档](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)、[移动端部署文档](https://onnxruntime.ai/docs/tutorials/mobile/) 这只说明部署路径，不保证计数准确度。无论采用原生 Rust 定点层或由 Rust 调用推理 runtime，**最终状态转移与次数仍只由 Rust SDK 产生**。

## 训练与验证计划

### 阶段 A：先修正基准和错误归因

1. 取消 MM-Fit inferred `cameraView → capturePosition` 映射，按 pose source 隔离；
2. 将 616 组重新按错误类型统计：初态未建立、末次未 return、峰值缺失、双峰、整段不可观察、错误动作 profile；
3. 对每组同时保存 pose coverage、有效 Hz、首尾状态、periodicity 与预测事件时间；
4. 先重跑当前 Rust FSM，得到修正分桶后的新基线。

通过条件：每个错误都能归到可解释类别，不能再用“调阈值”覆盖所有失败。

### 阶段 B：实现不含神经网络的高价值改动

1. action-specific observability gate；
2. 统一 body-frame 多信号与 visibility mask；
3. stable-ready 开始和 return-grace 结束协议；
4. 周期自相关作为 FSM 交叉检查；
5. 两次个体校准与 set 内参数冻结。

这些逻辑全部可直接进入 Rust，先验证能否消除系统性的 ±1。只有阶段 B 在未见参与者上仍明显低于目标时，再进入 temporal head。

### 阶段 C：训练轻量 causal phase head

这一步不是可选的“再加一个分类器”，而是从 MM-Fit 原论文约 69.81% 的手工 skeleton 峰值基线迈向 95% 的主要模型升级。目标模型必须是 **action-specific、causal、phase-aware**：按已知当前课程动作加载对应相位头，只看过去窗口，输出 ready/effort/peak/return 与 periodicity 证据；Rust state graph 保留唯一计数权。

监督来源分开处理：

- 自有 approved 数据：使用真实 start/peak/end 监督 phase 与 transition；备注中的半程、力竭、左右不均作为 attempt/disposition 标签；
- MM-Fit：只用 set 区间、动作和总数训练 periodicity/count consistency，不声称有逐 rep 相位真值；
- RepCount-pose：可用于两显著姿态预训练，但必须核查许可，且最终用相同 MediaPipe Heavy 版本重新抽 pose；
- 新自有采集：必须包含不同身材、速度、衣着、光照、允许机位边缘、半程、停顿、其他动作和空场负样本。

训练/validation/test 必须按 participant 隔离，profile、校准范围和拒识阈值都只能由 train/validation 决定。11 条 approved 视频已经参与选信号与阈值，只能做回归集，不能证明泛化。

### 阶段 D：95% 晋升门禁

每个 `exercise × supported body orientation × pose model/version` 独立晋升，再汇总：

| 门禁 | 建议要求 |
|---|---:|
| eligible set exact | ≥ 95% |
| accepted set exact | ≥ 97% |
| coverage | ≥ 90% |
| 每组误差 ±1 | ≥ 99% |
| 逐 rep peak 匹配 | ≥ 98%，且 false peak 单独受限 |
| 非动作误触发 | 必须在课程时长口径下接近 0，并报告每分钟值 |
| unseen participant | 必须单列，不能被 seen participant 汇总掩盖 |
| observable failure | 必须在开始前或中途暂停时明确拒识，不能输出猜测次数 |

统计上，单个桶只测十几条视频不足以证明 95%。例如若测试中零失败，要让 95% 单侧置信下界达到约 95%，至少需要约 59 个独立 set；若存在失败则需要更多。应以独立参与者和完整 set 为采样单位，避免把同一人的相邻 rep 当作大量独立样本。

## 优先级与预期判断

按当前证据，最有可能把 69.48% 推高的顺序是：

1. **修正 MM-Fit 伪 camera-view 分桶和首尾错误归因**：避免训练身份本身错误；
2. **可观察性准入 + stable-ready/return-grace**：直接处理不可见和 ±1 两大类系统性错误；
3. **多信号身体坐标特征 + 个体校准**：处理跨人 ROM、速度与左右侧差异；
4. **轻量 causal phase head + Rust constrained decoder**：处理半程、停顿、力竭和噪声造成的相位混淆；
5. **同源数据与未见参与者门禁**：决定改善是否能从 MM-Fit/OpenPose 迁移到真实 MediaPipe Heavy 移动端。

如果完成前四项后，某个动作在“必需关节持续可见”的未见用户数据上仍无法达到 95%，应缩小该动作支持的身体朝向或暂不支持，而不是进一步放宽 profile。95% 的可行路径本质上是：**在明确可测的范围内极少犯错，并对不可测输入诚实拒识**；不是让状态机对所有视频都给出一个次数。

## 一手来源

- [MM-Fit 官方论文](https://vradu.uk/publications/UbiComp2020.pdf)
- [MM-Fit 官方数据页](https://mmfit.github.io/)
- [MM-Fit 官方代码仓库](https://github.com/KDMStromback/mm-fit)
- [MediaPipe Pose 官方说明与基准](https://chuoling.github.io/mediapipe/solutions/pose.html)
- [BlazePose: On-device Real-time Body Pose Tracking](https://arxiv.org/abs/2006.10204)
- [BlazePose GHUM Holistic](https://arxiv.org/abs/2206.11678)
- [BlazePose GHUM 3D Model Card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- [Pose Landmarker 官方 API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarker)
- [RepNet / Counting Out Time](https://openaccess.thecvf.com/content_CVPR_2020/papers/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.pdf)
- [TransRAC](https://openaccess.thecvf.com/content/CVPR2022/papers/Hu_TransRAC_Encoding_Multi-Scale_Temporal_Correlation_With_Transformers_for_Repetitive_Action_CVPR_2022_paper.pdf)
- [PoseRAC 论文](https://arxiv.org/abs/2303.08450) 与 [官方实现](https://github.com/MiracleDance/PoseRAC)
- [MS-TCN](https://openaccess.thecvf.com/content_CVPR_2019/html/Abu_Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.html)
- [ONNX Runtime 量化](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html) 与 [移动端部署](https://onnxruntime.ai/docs/tutorials/mobile/)
