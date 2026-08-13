# 实时健身动作识别替代方案研究：镜面、遮挡、器械轨迹与端侧部署

日期：2026-08-12
状态：研究结论；用于选择实验，不授权 production promotion

## 1. 结论

MaxPower 当前不应因为识别率不稳定就立刻整体替换 RTMPose，也不应继续只调 recognition profile。更可靠的路线是把问题拆成四个可单独验收的模块：

1. 前景人体身份与人体关键点；
2. 器械检测、连续身份和几何轨迹；
3. 动作阶段与 rep 边界；
4. 技术偏差与教练判断。

现阶段推荐顺序是：

1. **主线保留 YOLOX + RTMPose Halpe-26，先完成 120 帧关键点真值并测 PCK。**没有人工点位真值前，无法区分 RTMPose 错、Rust 接纳低置信度点错误，还是仅渲染/时间同步错误。
2. **器械侧训练专用 detector，并加入连续 tracker。**ByteTrack 类方法适合把逐帧检测框关联为连续 ID，但不能替代器械检测、镜像判断或杠铃端点定位。[ByteTrack 官方实现与论文](https://github.com/FoundationVision/ByteTrack)
3. **阶段识别改为小型因果时序模型，profile 退回上下文和安全门禁。**MS-TCN 证明多阶段时序卷积可用于逐帧动作分割；MaxPower 仍需在自己的因果、流式和视频级留出协议下验证。[MS-TCN 原论文](https://openaccess.thecvf.com/content_CVPR_2019/html/Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.html)
4. **把 RTMO 和 MoveNet 作为 A/B 候选，而不是直接替换。**RTMO 是单阶段多人姿态方案，MoveNet 是端侧 17 点方案；二者都不会天然判断“真人还是镜中人”。[RTMO 官方论文](https://openaccess.thecvf.com/content/CVPR2024/html/Lu_RTMO_Towards_High-Performance_One-Stage_Real-Time_Multi-Person_Pose_Estimation_CVPR_2024_paper.html) [MoveNet 官方教程](https://www.tensorflow.org/hub/tutorials/movenet)
5. **SAM 2、CoTracker/TAPIR、ViTPose 更适合作为离线教师和标注加速器。**它们可生成更密集的候选轨迹或高质量伪标签，但当前没有证据证明能在 MaxPower 的 Web、Android、iOS 设备预算内替代实时主链。[SAM 2 官方仓库](https://github.com/facebookresearch/sam2) [CoTracker 官方仓库](https://github.com/facebookresearch/co-tracker) [TAPIR 官方仓库](https://github.com/google-deepmind/tapnet) [ViTPose 官方仓库](https://github.com/ViTAE-Transformer/ViTPose)
6. **手表/手机 IMU 是最有价值的独立增强信号。**MM-Fit 本身包含同步手机、手表、耳机 IMU 与 RGB-D，说明它适合动作识别、周期和计次的多模态研究；它仍不能提供逐 rep 技术标准、借力或代偿真值。[MM-Fit 官方网站与论文入口](https://mmfit.github.io/)

最重要的边界是：**真正“看懂动作”不是一个模型的单一准确率，而是感知、身份、时间轴和教练标签四个门禁同时通过。**

## 2. 共同已知、假设与边界

### 2.1 已知目标

- 真实健身房、镜面、多人物、遮挡、正面卧推等场景；
- 连续摄像头输入，而不是离散截图演示；
- 需要人体与杠铃/哑铃轨迹共同进入 Rust canonical 输出；
- 目标是计次、动作起止、ROM、轨迹和可观察技术偏差；
- Web、Android、iOS 最终共享同一证据语义；
- 生产验收目标至少 95%，且必须使用视频级或人员级独立留出。

### 2.2 本研究采用的合理假设

- 第一阶段优先解决 `barbell_bench_press × front/oblique45 × mirror`，不同时扩展所有动作；
- 允许训练专用小模型，但不允许将测试真值泄漏到训练、阈值或人工挑选；
- 个人模型可以先服务同一用户，但不能因此声称跨用户泛化；
- 缺失点必须保持 unknown，器械轨迹不能回填成“人体实测关键点”；
- 当前任务不修改 production profile、不上传私有视频、不做 production promotion。

### 2.3 当前证据快照

- 个人轨迹数据已有 50 个源视频、465 个预期 rep、464 条人工时间区间；独立留出时间区间对齐为 332/445（74.6%），整段计次完全正确 18/50（36%）。见 `data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/diagnostics/personal-cycle-state-halpe26-v1-loo.json`。
- 个人技术训练集 `eligibleGoldRepCount=0`，因此不能训练或验收 standardness、compensation、stimulus compatibility。见 `data/workflows/action-trajectory-database/native-halpe26-v2/manifest.json`。
- 120 帧卧推关键点冻结队列目前没有人工共识真值；PCK、可用率和 Rust 过度声明率均不可测。见 `data/pose-validation/front-bench-halpe26-v1/pose-keypoint-evaluation-v1.json`。
- 杠铃 554 帧、哑铃 1,036 帧的训练队列当前均无人工提交，因而不存在已训练、已密封评测的器械 detector。
- 当前 Web 单次因果链路在同 6 条视频上，以杠铃阶段轨迹主导并结合 Halpe-26 骨架，经 Rust 输出达到 46/46 可观察 Rep、97.8% turnaround ±250 ms；pose-only 消融 recall 仅 21.7%。这证明器械信号对当前卧推阶段识别是核心观测，但仍不是新用户或新场地的独立留出结果。见 `docs/reports/current-barbell-bench-recognition.md`。

## 3. 可能错误的前提

1. **“训练视频随机打乱后随机抽一条”不是泛化验收。**如果被抽视频已参与训练，结果只能证明记忆或同源拟合。必须在训练前按完整视频、拍摄批次或人员冻结 split。
2. **时序平滑不能修复错误身份。**当腕点来自镜中人物、旁人或错误肢体时，One Euro、Kalman、TCN 只会把错误变得更平滑。
3. **RTMO/MoveNet 不会天然解决镜面。**多人姿态模型可以输出更多候选，但“哪个是真正目标用户”仍需要目标锁定、连续 ID、镜面/区域证据和拒判。
4. **器械路径不能成为人体点位真值。**杠铃可辅助判断阶段、触底/极值和左右端路径，但不能证明被遮挡手腕的真实位置。
5. **MM-Fit 不是技术质量数据集。**官方数据提供同步 RGB-D、pose 与多设备 IMU，主要标签支持活动分割、识别和计次；不能把 set count 解释成标准动作、借力或逐 rep phase truth。[MM-Fit 官方说明](https://mmfit.github.io/)
6. **从 50 个视频端到端训练一个通用“健身教练视频模型”不现实。**这些视频足以微调小型阶段头或个性化模型，但不足以覆盖跨人、跨器械、跨机位和多种错误模式。

## 4. 候选方案矩阵

| 方案 | 能解决 | 不能解决 | 标注需求 | 实时/端侧 | 镜面适配 | MaxPower 建议 |
| --- | --- | --- | --- | --- | --- | --- |
| YOLOX + RTMPose Halpe-26 | top-down 前景裁剪、26 点、现有三端与 Rust 链路 | 低置信度腕肘、器械轨迹、阶段学习 | pose PCK 真值；困难帧微调集 | 已有 ONNX 链路，仍需真机测量 | 依赖人体框与 Rust 主体锁定 | 主线保留，先验收再决定微调 |
| RTMO | 一阶段多人姿态，取消独立人体检测器；官方报告面向实时多人姿态 | 不自动区分真人/镜像；常用 body 模型是 COCO 前缀，不直接提供 Halpe-26 全部点 | 同一冻结 PCK 集；镜像 ID 标签 | 官方 MMPose 支持部署研究，但 MaxPower 的 ONNX/移动算子与速度仍需实测 | 输出所有候选后仍需主体锁定 | 最高优先 A/B 候选 [官方实现](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmo) |
| MoveNet Lightning/Thunder | 17 点端侧快速基线；官方提供 TFLite/TF Hub，并称现代手机可实时 | 无 Halpe 足部附加点；不自动解决镜面、卧推遮挡或器械 | 同一冻结 PCK 集 | 移动端成熟；Web/Android/iOS 若分别使用 TF.js/TFLite 会增加运行时分叉 | 单人模型尤其需要目标 ROI | 延迟/回退基线，不先假定精度更高 [官方教程](https://www.tensorflow.org/hub/tutorials/movenet) |
| ViTPose | 高质量 top-down 姿态教师；可在相同人体框上与 RTMPose 隔离比较 | 模型较重；没有时序、器械和镜面身份语义 | pose 训练/验证/测试点位 | 官方仓库不是 MaxPower 端侧性能证明 | 仍依赖正确人体框 | 离线教师、难例伪标签、上限对照 [官方仓库](https://github.com/ViTAE-Transformer/ViTPose) |
| ByteTrack | 将逐帧检测框关联成稳定轨迹，利用低分检测减少遮挡断轨 | 不检测器械、不输出杠铃端点、不判断镜像/静态架杆 | 连续框、track ID、遮挡状态 | 算法简单；需在自有视频和目标端 benchmark | 需要前景关联与硬负样本 | 器械 tracker 首选基线 [官方仓库](https://github.com/FoundationVision/ByteTrack) |
| SAM 2 视频分割 | 提示后传播物体 mask；适合生成密集器械 masklet | 需要提示/初始化；不是类别 detector；移动端实时未由当前项目验证 | 少量首帧提示 + 人工修正 | 官方实现依赖 PyTorch/GPU 路径，不能直接视为手机方案 | 提示错误可跟到镜像 | 离线标注加速与 teacher，不作为实时主链 [官方仓库](https://github.com/facebookresearch/sam2) |
| CoTracker3 | 在线/离线任意点跟踪；可跟踪杠铃端点、杆上点或器械轮廓点 | 不理解对象类别；点可能落在手、镜像或背景；不能独立重识别目标器械 | 初始点、可见性、轨迹复核 | 官方在线模型存在，但主要是 GPU/PyTorch研究路径 | 必须由 detector/人工初始化正确点 | 密集轨迹伪标签与离线对照 [官方仓库](https://github.com/facebookresearch/co-tracker) |
| Online TAPIR | 因果任意点跟踪和遮挡恢复；官方提供实时 GPU demo | 官方示例约 17 FPS/480×480/Quadro RTX 4000，不等于手机实时；不理解杠铃类别 | 查询点 + 轨迹可见性复核 | GPU 研究可行，端侧需另做模型转换和 benchmark | 初始化到镜像就会稳定跟错 | 离线/桌面轨迹 oracle 候选 [官方仓库](https://github.com/google-deepmind/tapnet) |
| PoseC3D | 从姿态热图学习时空动作特征，官方报告对 pose noise 更稳 | 主要解决动作识别，不天然输出精确起止、器械路径或教练真值 | 动作/片段标签；质量任务还需质量金标 | 3D CNN 成本高于小型 TCN；需另做因果化 | 错身份仍会污染热图 | 离线教师或动作身份辅助 [官方文档](https://mmaction2.readthedocs.io/en/dev-1.x/model_zoo/skeleton.html) |
| MoViNet | 官方支持流式逐帧 RGB 视频分类和迁移学习 | 分类可利用背景捷径；不产生可信关节或器械几何 | 视频类别/阶段标签 | 有流式模型；仍需移动端模型大小和延迟验证 | 镜面背景可能变成错误捷径 | 仅作 RGB 辅助置信度，不拥有 canonical truth [官方教程](https://www.tensorflow.org/hub/tutorials/movinet) |
| RepNet | 类别无关周期性和重复次数先验 | 不提供健身动作身份、准确 rep 边界、标准性或器械关系 | 视频 count/周期标签 | 可作离线 baseline；不是现有 Rust 流式输出 | 周期性可能同时来自镜像或背景 | 诊断/弱监督，不替代阶段模型 [官方项目](https://sites.google.com/view/repnet/home) |
| 相机 + 手机/手表 IMU | 遮挡时仍有独立周期、方向和速度变化；MM-Fit 可用于预训练 | 不提供肘腕几何、杠铃路径、ROM 或标准技术真值 | 同步时间、设备位置、动作/rep 标签 | 手机和手表传感器适合实时，但需时钟同步和佩戴约束 | 不受镜面视觉污染 | 最有价值的产品级增强路径 [MM-Fit 官方网站](https://mmfit.github.io/) |
| 双机位/深度 | 减少单目深度歧义和遮挡，可形成更可靠 3D | 增加设备、同步和标定负担；不适合所有实时用户 | 多视角同步与标定真值 | 更适合高级分析/离线 | 从不同视角绕开镜面遮挡 | 高阶模式，不是基础单机位替代 [OpenCap 验证研究](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462) |

## 5. 推荐排序

### 5.1 主方案：保留姿态主链，补齐器械与因果时序

```text
camera frames
  -> person candidates + RTMPose Halpe-26
  -> trained equipment detector
  -> equipment tracker + foreground-person association
  -> causal temporal fusion model
  -> Rust canonical packet / refusal / rep / phase / evidence
```

理由：

- 当前三端和 Rust 已接受 Halpe-26；先换掉整个姿态主链会同时改变坐标、置信度、性能和时间轴，无法定位收益来源。
- 现有卧推器械原型已显示明显增益，但器械 detector 和 tracker 尚未训练；这是当前最高价值缺口。
- 50 个个人源视频和 464 条人工区间更适合微调小型时序头，不适合训练大型 RGB foundation model。
- Rust 已经有 subject/equipment association 和明确拒判语义，新的 detector/tracker 可以沿现有 observation seam 接入。

### 5.2 姿态 A/B：RTMO 与 MoveNet

- **RTMO**优先于 MoveNet作为替换候选，因为它直接面向实时多人姿态，可测试是否减少 YOLOX person detector 与 pose crop 的耦合错误。
- **MoveNet Thunder**作为速度、包体和故障模式基线；如果卧推 PCK 并不优于 RTMPose，就不迁移。
- 两者的 0–16 COCO 点可以放入 Halpe-26 前缀，17–25 必须保持 unknown；禁止伪造 neck、hip center、toe、heel。

### 5.3 离线 teacher 与标注加速

- ViTPose：同一 YOLOX 人体框上的高质量姿态 teacher；
- SAM 2：杠铃/哑铃 mask 传播和人工修正；
- CoTracker/TAPIR：杠铃端点与杆上点的密集轨迹候选；
- teacher 输出只能成为 proposal，经过人工复核后才是 truth。

### 5.4 多模态增强

- 若产品允许手表或手机固定佩戴，优先融合 IMU 的周期和方向证据；
- RGB 继续负责人体/器械几何，IMU 负责遮挡时序和动作段落；
- 两个模态不一致时输出 `cannot_judge` 或 needs-review，而不是选一个凑答案。

### 5.5 暂不采用

- 从 50 个视频直接端到端微调大型视频模型；
- 仅增加平滑或预测点位来掩盖错误身份；
- 仅用腕点代替杠铃轨迹；
- 用同视频回放或随机帧拆分报告 95%；
- 让 RGB 分类模型、LLM 或 profile 产生没有人工质量标签的“借力/标准”结论。

## 6. Rust 与三端接入约束

### 6.1 可复用的边界

- Web/Android/iOS Adapter 负责模型推理，Rust 负责目标主体、连续性、器械关联、canonical packet、phase 和 rep；见 `rust/motion-sdk/README.md`。
- 任何输出 COCO-17 的替代姿态后端都可以在 Adapter 中转换为 26 槽 Halpe packet，新增点保持 unknown，从而避免立即增加第三种 Rust pose schema。
- 器械 detector/tracker 可通过现有 `RustEquipmentObservation` 输入 bbox、score、source、occlusion、reflection/static flags；见 `src/motion/rustCanonicalWasm.ts` 和 `rust/motion-sdk/src/web_abi.rs`。

### 6.2 当前必须显式接受的限制

- 当前 equipment ABI/packet 只保存 bbox、center、score、source 和 flags，不保存杠铃两端点、轴线角度或分割 mask；见 `src/motion/motionPacket.ts::DecodedEquipmentTrack`。
- 若不改 ABI，可先使用 bbox center 训练和验收垂直轨迹、速度和 rep 极值；无法严谨判断杠铃倾斜、左右端不同步或杆轴旋转。
- 若产品主张需要精确杆轴，必须单独设计 packet 新版本（例如新的 equipment geometry extension），并按 handoff stop condition 获得 Rust ABI/packet 修改授权。
- 当前 Web/Android 的实现是在每个 processed frame 上运行 YOLOX person detection；PRD 中的 `det_frequency=10` 不是当前实现事实。设备优化必须基于真机 profiler，而不是文档中的桌面间隔策略。

### 6.3 模型部署门禁

- 候选模型必须先导出 ONNX，再使用 ONNX Runtime 的 mobile usability checker 检查 NNAPI/CoreML 支持；工具只能判断算子适配，不能替代真机精度、热量和延迟测试。[ORT Mobile usability checker](https://onnxruntime.ai/docs/tutorials/mobile/helpers/model-usability-checker.html)
- Web、Android、iOS 必须使用同一模型 hash、预处理、后处理和坐标合同；否则 packet 语义相同也不能证明视觉结果一致。
- 每个模型至少测：冷启动、p50/p95 延迟、有效处理 FPS、掉帧/积压、15 分钟热稳定、模型大小和峰值内存。

## 7. 最小可验证实验

### 实验 1：RTMPose 原始输出还是 Rust 接纳逻辑出错

- **单一变量：**比较 raw RTMPose 与 Rust canonical；模型、输入帧、人体框全部冻结。
- **输入：**当前 120 帧卧推冻结队列的人工肩/肘/腕/髋真值。
- **前置数据：**完成 120/120 人工共识标注。
- **成功信号：**raw 与 Rust 必要关节 PCK@0.1 torso、每关节 PCK、usable rate 均达到 95%，false measured overclaim 不超过 1%。
- **解释：**raw 通过而 Rust 失败，修 Rust；raw 失败才进入姿态微调或替换。

### 实验 2：RTMO 是否优于现有 YOLOX + RTMPose

- **单一变量：**替换完整 pose backend 为 RTMO；Rust 后处理、冻结视频、评分代码不变。
- **输入：**同一 120 帧关键点测试集，加 6 条完整卧推视频的 subject-switch 回放。
- **输出映射：**COCO 0–16 写入 Halpe 前缀，17–25 unknown。
- **成功信号：**必要关节 PCK至少提高 2 个百分点或达到 95%，镜像/旁人错误主体切换不增加，端侧 p95 延迟仍满足处理 FPS 门禁。
- **失败信号：**仅多人 benchmark 更好，但卧推腕肘 PCK、镜像切换或端侧延迟不改善。

### 实验 3：ViTPose teacher 能否证明 RTMPose 存在可学习误差

- **单一变量：**同一冻结 YOLOX 人体框，仅把 pose head 从 RTMPose 改成 ViTPose。
- **输入：**120 帧人工真值；不使用测试帧做 fine-tuning。
- **成功信号：**ViTPose 在相同框上显著提高腕肘 PCK，且失败集中在 RTMPose；这支持建立独立 train/validation pose 集并微调 RTMPose。
- **失败信号：**两个模型在同一帧同时失败，优先调查人体框、遮挡、分辨率和 2D 可观测性，不做盲目微调。

### 实验 4：连续 tracker 是否真正改善器械轨迹

- **单一变量：**固定相同的器械 detector detections，只替换当前最近中心关联与 ByteTrack 类关联器。
- **输入：**至少 3 条连续卧推视频，以不低于 15 FPS 标注杠铃 bbox/中心；镜像、架杆、遮挡和出画单独标记。
- **成功信号：**track coverage ≥95%，hard-negative false-positive ≤1%，identity switch=0，轨迹中心 PCK ≥95%。
- **失败信号：**tracker 在 detector 漏检或镜像误检时仍漂移；说明应先提高 detector/hard-negative 数据，而不是继续调 tracker。

### 实验 5：器械融合是否提高独立留出时间轴

- **单一变量：**在同一冻结 pose canonical 输入和同一因果时序模型上，只增加经过验收的器械 track 特征。
- **输入：**按完整视频隔离的卧推 train/validation/test；测试视频在训练前冻结。
- **成功信号：**测试集 rep precision、recall、人工区间对齐、整段 exact count 均 ≥95%，并且组前/组后器械动作误检不增加。
- **失败信号：**只改善计次但边界仍低于 95%，说明需要阶段标签/时序模型，而不是更多器械平滑。

### 实验 6：IMU 是否能补偿视觉遮挡

- **单一变量：**固定 RGB pose、equipment 和时序模型结构，只增加同步腕部/手机 IMU 通道。
- **输入：**同一批带人工时间轴的遮挡、镜面与非遮挡视频；设备位置固定并记录。
- **成功信号：**遮挡子集边界与计次提高，非遮挡子集不退化；时钟漂移和缺包有明确 refusal。
- **失败信号：**只在同一佩戴位置有效或跨设备明显退化；限制为个性化/特定设备能力。

## 8. 数据采集与微调策略

### 8.1 先标什么

1. 120 帧 pose 测试真值：决定是否需要姿态微调；
2. 554 帧杠铃 detector/tracker 真值：先打通卧推；
3. 连续密集杠铃轨迹子集：用于 track ID 和轨迹验收；
4. 1,036 帧哑铃真值：扩展 MM-Fit 与哑铃动作；
5. 技术质量 gold reps：标准、ROM 不足、路径偏移、反弹/失控、双侧不同步、身体代偿、cannot_judge。

### 8.2 如何微调姿态

- 120 帧冻结测试集永不进入训练；
- 从不同源视频建立独立 train/validation，优先选择低置信度、镜面、遮挡和大跳变帧；
- 使用 RTMPose/ViTPose 预标，人工只校正困难关节；
- 先冻结大部分 backbone 微调 head，再按 validation 决定是否解冻后层；
- 每次只比较一个模型版本，报告 raw 与 Rust 两层 PCK，不用“骨架看起来更顺”作为结论。

### 8.3 如何训练阶段模型

- MM-Fit 用于动作类别、周期和 set count 预训练；
- 个人 464 条 start/end 区间用于动作阶段和 rep 边界微调；
- split 单位是 source video/participant，不是 frame；
- 输入使用 pose confidence mask、unknown、equipment confidence 和观测来源；
- 模型必须因果化，禁止使用完整序列分位数等未来信息；
- 技术判断头在 `eligibleGoldRepCount > 0` 且视频级留出成立前保持关闭。

## 9. 决策门

```text
120-frame human pose truth complete?
  no  -> stop: cannot choose pose backend
  yes -> raw RTMPose PCK >= 95%?
           yes -> keep RTMPose; inspect Rust/temporal/equipment
           no  -> ViTPose same-box oracle materially better?
                    yes -> fine-tune RTMPose, then A/B RTMO
                    no  -> detector/crop/observability problem; do not smooth it away

trained equipment detector + dense sealed trajectory truth complete?
  no  -> cannot claim live equipment tracking
  yes -> detector gate -> tracker gate -> temporal fusion gate

technique gold labels available?
  no  -> output motion evidence only; no standard/borrowing claim
  yes -> train per-deviation head and validate per class
```

## 10. 立即执行建议

1. 不替换生产 RTMPose；先完成 120 帧 pose truth 并跑已有 PCK 门禁。
2. 同时完成杠铃 `TRAIN → high priority`，随后覆盖所有 train/validation/sealed test。
3. 将连续器械标注页作为下一项工具建设：视频播放、关键帧轴线/框、插值草稿、逐帧修正、track ID 与遮挡状态。
4. 在不改 Rust ABI 的第一轮只验收 bbox center 轨迹；精确杠铃轴角作为单独 packet 设计议题。
5. 第一个模型 A/B 只做 RTMPose vs RTMO；MoveNet、ViTPose作为速度/teacher 对照。
6. 只有感知和 tracker 独立通过后，才训练 pose + equipment causal TCN。
7. 95% 必须分别达到关键点、器械、时间轴和动作质量门禁；不能合并成一个平均数掩盖失败层。

## 11. 第一方来源

- OpenMMLab, [RTMO 官方实现](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmo) 与 [CVPR 2024 论文](https://openaccess.thecvf.com/content/CVPR2024/html/Lu_RTMO_Towards_High-Performance_One-Stage_Real-Time_Multi-Person_Pose_Estimation_CVPR_2024_paper.html)
- TensorFlow, [MoveNet 官方教程和模型入口](https://www.tensorflow.org/hub/tutorials/movenet)
- ViTAE Transformer, [ViTPose 官方实现](https://github.com/ViTAE-Transformer/ViTPose)
- FoundationVision, [ByteTrack 官方实现与论文入口](https://github.com/FoundationVision/ByteTrack)
- Meta AI, [SAM 2 官方实现](https://github.com/facebookresearch/sam2)
- Meta AI, [CoTracker3 官方实现](https://github.com/facebookresearch/co-tracker)
- Google DeepMind, [TAPIR/TAPNet 官方实现](https://github.com/google-deepmind/tapnet)
- Google Research/DeepMind, [RepNet 官方项目](https://sites.google.com/view/repnet/home)
- TensorFlow, [MoViNet 流式动作识别官方教程](https://www.tensorflow.org/hub/tutorials/movinet)
- OpenMMLab MMAction2, [PoseC3D 官方模型文档](https://mmaction2.readthedocs.io/en/dev-1.x/model_zoo/skeleton.html)
- MM-Fit, [官方数据集、设备、模态和论文入口](https://mmfit.github.io/)
- ONNX Runtime, [移动部署流程](https://onnxruntime.ai/docs/tutorials/mobile/) 与 [model usability checker](https://onnxruntime.ai/docs/tutorials/mobile/helpers/model-usability-checker.html)
- OpenCap, [多视角手机运动学验证研究](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)
