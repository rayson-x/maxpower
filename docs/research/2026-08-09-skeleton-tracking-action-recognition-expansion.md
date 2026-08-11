# 骨架追踪与动作识别扩展：当前能力、开源方案、数据与许可证调研

日期：2026-08-09  
研究范围：MaxPower 当前单目手机相机链路；骨架追踪、已选动作确认/分期/计数、自动动作分类、动作质量评估；重点核验 `motion-tracker` 同名项目、MediaPipe Pose Landmarker、RTMPose/MMPose、MMAction2/ST-GCN 及公开动作数据。  
证据口径：外部结论只使用官方文档、论文、作者仓库、数据集官网与许可文件；当前产品能力只以 2026-08-09 工作区源码和生成物为准。

> 本文把四件事分开：单帧关键点估计、跨帧主体身份维持、动作类别识别、动作质量/错误识别。画出连续骨架不等于已经识别动作；用户先选动作后的 profile 计数也不等于开放环境下自动识别 65 类动作。

## 结论先行

1. **当前骨架层足以继续扩动作，近期不需要先换基础 pose 模型。** MediaPipe Pose Landmarker 已提供端侧 33 点、visibility、图像坐标与髋中心世界坐标；官方模型就是为单人移动端健身与计次优化。但其深度来自 GHUM 合成拟合，不适合被解释为精确测距；多人身份锁、器械遮挡和目标健身机位仍需产品自己的验证。[Pose Landmarker 官方模型说明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/) · [BlazePose GHUM 模型卡](https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf)
2. **当前“65 个动作”是配置/引擎可执行覆盖，不是 65 类都被验证准确。** 2026-08-09 源码有 65 个目录动作，实际是 17 个 `experimental`、48 个 `catalog_only`；推荐机位可通过 built-in、observed 或 simulated initializer 解析出 65/65 个 Rust executable profile。可是当前人工观测 artifact 只有 5 个 exact action×view，覆盖 3 个动作，全部仍是 `provisional`；held-out validated 为 0。[当前动作目录](../../src/pose/exerciseRegistry.ts) · [当前人工观测 profile](../../public/archives/confirmed-captures/recognition-profiles.json)
3. **现有效果只能说“链路跑通并有弱的同批数据证据”，不能说达到生产准确率。** 现有 in-sample 回放在 73 个有 profile 的标注 rep 上确认 79 个、峰值匹配 60 个，匹配召回 82.2%、精度 75.9%；8 段可回放录像中只有 1 段 exact count。报告已明确这不是重新跑 pose，也不是独立测试。[当前观察回放](../reports/observed-profile-replay-2026-08-08.md)
4. **用户所说的 `motion-tracker` 很可能是 `MindDock/motion-tracker`，但这个仓库没有可复用训练数据，也没有动作识别模型。** 源码实际是 MediaPipe 单人 33 点、4 个用户预选动作的固定角度状态机和一个 DTW 舞蹈模板比较 demo；MIT 许可只覆盖代码，仓库没有被试视频、动作标签集、训练权重或可复核准确率。它适合参考接口和 demo，不值得作为 MaxPower 的算法或数据基线。[MindDock README](https://github.com/MindDock/motion-tracker/blob/main/README.md) · [4 动作状态机源码](https://github.com/MindDock/motion-tracker/blob/main/demos/fitness_trainer_demo.py) · [DTW demo](https://github.com/MindDock/motion-tracker/blob/main/demos/dance_coach_demo.py) · [MIT LICENSE](https://github.com/MindDock/motion-tracker/blob/main/LICENSE)
5. **扩展更多动作的首选路线仍是“生产 pose → 标准化时序 → action×view profile → 严格验证”，再按证据升级小模型。** 对用户已选动作，规则/profile 比通用 ST-GCN 更易解释、更省数据、更适合移动端。只有当多动作共享规则失效、相似动作混淆或时序形状无法用少量指标表达时，才增加 kNN/逻辑回归/小型 1D-TCN；ST-GCN/MMAction2 更适合离线研究和开放集原型，不应直接作为首版移动端依赖。
6. **公开数据可以参考标签和实验设计，但绝大多数不能直接变成商用训练集。** NTU RGB+D 明确仅限非商业学术研究；Fitness-AQA、FLEX 同样限制非商业/学术用途；Kinetics 是宽泛网络视频标签，只有少量粗粒度健身类且不含动作质量；UI-PRMD 虽为 PDDL 1.0，但仅 10 名健康人、康复动作和 Vicon/Kinect 骨架，和手机健身房视频域差很大。商业路线应以自有同意书覆盖的数据为主，公开集仅作原型、标签本体和基准参考。

一句话建议：**保留 MediaPipe 为产品默认骨架，RTMPose 作为同批视频 evaluator；先把 5–10 个优先动作做到跨人、跨 session、跨设备的 held-out 计数稳定，再扩目录；不要用 `motion-tracker` 的 README 或公开数据集 benchmark 替代本地验证。**

## 1. 当前能力：必须按证据等级记账

### 1.1 2026-08-09 源码快照

| 层级 | 当前事实 | 能宣称什么 | 不能宣称什么 |
| --- | --- | --- | --- |
| 动作目录 | 65 个；17 `experimental`、48 `catalog_only` | 产品有 65 个动作 identity 与推荐配置 | 65 个动作都识别准确 |
| 可执行 recognition profile | 推荐机位 65/65 可由 built-in / observed / simulated initializer 装载 | Rust 引擎能对已知动作运行分期、return、rep 逻辑 | 每个阈值都经真实人群校准 |
| 人工观测 profile | 5 个 exact action×view、3 个动作，全部 `provisional` | 这些 context 有本地人工分段数据形成的 profile | 5 个 context 已独立验证 |
| 自动动作分类 | 没有 65 类开放集分类器 | 用户预选动作后可走专用 profile | 相机能不经选择自动猜出正在做哪个动作 |
| 动作质量/纠错 | 无独立 validated 质量标签 | 可以输出测量值或谨慎的试验性提示 | “标准动作”“受伤风险”“医学判断” |
| held-out 证据 | 0 个 validated action×view | 目前仍处于技术验证 | 生产 precision/recall 或跨人泛化 |

当前 5 个 observed context 是：

- `barbell_bench_press/frontLeft45`
- `barbell_bench_press/frontRight45`
- `machine_chest_press/front`
- `machine_chest_press/frontRight45`
- `push_up/rearRight45`

这也说明旧文档中的“14 experimental / 51 catalog_only”和“8 个 observed context”已经过时；判断当前能力必须读取当前 [`exerciseRegistry.ts`](../../src/pose/exerciseRegistry.ts) 和 [`recognition-profiles.json`](../../public/archives/confirmed-captures/recognition-profiles.json)，不能沿用 2026-08-08 盘点中的旧数字。

### 1.2 当前识别效果如何

最新回放的可用数字是：

- 11 段归档录像，8 段有 exact profile 可回放；
- 有 profile 的机位共 73 个标注 rep；
- Rust 确认 79 个 rep，峰值匹配 60 个；
- 以峰值匹配口径计算，recall 82.2%、precision 75.9%；
- 8 段可回放录像只有 1 段计数完全一致；另有 21 个待复核 outcome、31 个拒绝 outcome。

这些数字证明 profile、Rust state machine、封装结果和人工峰值匹配链路能够工作，也暴露出当前误计/漏计仍明显。由于 profile 与回放来自同批录制，且回放使用人工关键点 sidecar 而不是重新运行手机端 pose，它不能回答：

- 新用户、新设备、新光照和新服装是否仍有效；
- 实时 MediaPipe 掉点、抖动和主体重获会造成多少额外误差；
- 同类相似动作、半程动作、调整器械和走入画面会不会误计；
- Android 长时温升、节流和帧率变化会不会改变阶段判断。

因此当前对外最准确的说法是：**3 个动作、5 个指定机位已有 provisional 实拍 profile；65 个目录动作在推荐机位技术上可运行，但没有 held-out 准确率。**

## 2. 骨架追踪：MediaPipe 与 RTMPose 能解决什么

### 2.1 MediaPipe Pose Landmarker

官方任务由 person detector 和 landmark model 组成，输出 33 个图像 landmarks 与 33 个 world landmarks；视频/直播模式使用上一帧 ROI 来降低重复检测成本。[官方模型说明](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/) [legacy detector-tracker 说明](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md#ml-pipeline)

BlazePose GHUM 模型卡给出三个非常重要的边界：

- Lite / Full / Heavy 的旧模型卡大小约为 3 / 6 / 26 MB；Pixel 3 上 CPU 约 44 / 18 / 4 FPS，GPU 约 49 / 40 / 19 FPS。这些是 Google 的特定旧设备和运行时结果，不是 MaxPower Android 的实测。[模型卡第 1 页](https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf)
- world coordinates 虽以米表示、髋中心为原点，但 3D 是用 GHUM 合成数据拟合到 2D annotation 得到；screen z 也不是精确的公制深度。模型卡明确把“要求 metric accurate depth”列为 out of scope。[模型卡输出与限制](https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf)
- 官方 tracking-mode 验证集是 1,400 张来自同一数据源的智能手机照片，指标为 2D PCK@0.2/PDJ；Lite / Full / Heavy 平均约 93.8% / 96.6% / 98.3%。这不是视频计数准确率，也不是健身房器械遮挡评测。[模型卡评测](https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf)

结论：MediaPipe 的优点是手机端成熟、33 点覆盖足、当前工程已集成；它的不足是单目伪 3D、复杂遮挡、多人重获和目标人身份需要应用层约束。现在没有证据说明替换基础模型比补数据和验证更优先。

### 2.2 RTMPose / MMPose

RTMPose 是 OpenMMLab 的高效 2D top-down pose 路线。论文报告 RTMPose-s 在 Snapdragon 865 上 72.2 COCO AP、70+ FPS；RTMPose-m 在 i7-11700 CPU 上 90+ FPS。该数字通常只反映论文指定 pipeline 和设备，不能直接代入当前 ONNX、浏览器或 Android 实现。[RTMPose 论文](https://arxiv.org/abs/2303.07399)

MMPose 的实际价值有两个：

1. **作为离线 evaluator。** 对同一批 MaxPower 视频同时跑 MediaPipe Lite/Full 与现有 RTMPose ONNX，比 required-joint coverage、jitter、最长连续掉点、峰值时间误差和最终 rep precision/recall；不要用 COCO AP 与 BlazePose PDJ 横向硬比。
2. **作为未来自定义关键点训练框架。** MMPose 官方支持把自有标注转为 COCO 格式，并定义 `keypoint_info`、左右 swap、`skeleton_info`、joint weights 和 OKS sigmas；若未来确实需要器械点、杠铃端点或新的脊柱点，可以在自有/商业授权数据上训练。[MMPose 自定义数据官方指南](https://mmpose.readthedocs.io/en/latest/advanced_guides/customize_datasets.html)

部署注意事项：RTMPose top-down 通常还需要 person detector、人体 crop、SimCC 解码和 tracking；论文的 pose head FPS 不能当整条相机链路 FPS。MMDeploy 支持 ONNX Runtime、ncnn、TensorRT、CoreML 等，Android ARM 常见是 ncnn；但当前 MaxPower 已有自定义 Expo/Rust/MediaPipe 链路，改成完整 MMDeploy stack 会增加 native 包、运算后端和维护面。[MMDeploy 官方仓库与平台矩阵](https://github.com/open-mmlab/mmdeploy)

代码许可方面，MMPose/RTMPose 为 Apache-2.0，MMPose 官方也说明 RTMPose 项目可商业使用；但**代码许可不自动清理 checkpoint 的训练数据许可**，权重与其训练数据仍应单独记录。[MMPose LICENSE](https://github.com/open-mmlab/mmpose/blob/main/LICENSE) · [MMPose 特殊算法许可表](https://github.com/open-mmlab/mmpose/blob/main/LICENSES.md)

## 3. `motion-tracker` 到底指哪个项目

`motion-tracker` 不是唯一项目名。最容易混淆的至少有三类：

| 项目 | 实际任务 | 有无骨架动作数据 | 许可与可借鉴内容 |
| --- | --- | --- | --- |
| [MindDock/motion-tracker](https://github.com/MindDock/motion-tracker) | MediaPipe 单人骨架、角度、4 个固定阈值计数、DTW 舞蹈模板 | **无**训练数据、被试数据和动作标签集 | MIT；可参考 backend 接口、角度与 demo，不能复用不存在的数据或验证结果 |
| [flochkristof/motiontracker](https://github.com/flochkristof/motiontracker) | OpenCV 多目标框跟踪、数值微分 GUI | 不是人体骨架动作识别数据 | GPL-3.0；适合一般目标轨迹研究，不适合直接扩健身动作类别 |
| [jakory/motion-tracker](https://github.com/jakory/motion-tracker) | 用运动轮廓估计画面整体 movement amount | 发布的是旧研究验证数据，不是关节拓扑和健身动作质量标签 | MIT；可参考运动量测量，不可替代关键点动作识别 |

最可能与本项目相关的是 MindDock 仓库。源码核验结果：

- `src/backends/` 只有 MediaPipe backend；README 所称 Apple Vision、YOLO11 backend 不在当前源码中。
- fitness demo 只有 squat、push-up、bicep curl、shoulder press；用户预先选择，单侧膝/肘角用固定阈值和 `idle/down/up` 状态机计数。[fitness demo](https://github.com/MindDock/motion-tracker/blob/main/demos/fitness_trainer_demo.py)
- `min_frames_between_reps=15` 按帧而不是按真实时间，掉帧或不同 FPS 会改变最短 rep 时长。
- dance demo 把 8 个关节角做朴素 DTW；它没有视角归一化、可见性 gate、受试者 holdout 或未知动作拒绝。[dance demo](https://github.com/MindDock/motion-tracker/blob/main/demos/dance_coach_demo.py)
- 仓库没有与 README “3–5°”“production-ready”“battle-tested”对应的真实被试评测集，相关陈述只能视为作者自述。

所以答案是：**可以参考其代码组织和 DTW 思路，但没有所谓可拿来扩展动作的 `motion-tracker` 训练数据或成熟 recognizer。MaxPower 当前 profile lineage、时间戳状态机、拒绝 outcome 和主体连续性已经明显比它深入。**

## 4. 从骨架到更多动作：三档方案

### A. 继续 action×view profile：近期首选

适用于“用户已选动作，系统确认阶段并计数”。每个动作定义：

- 支持/推荐机位与身体朝向；
- required joints、visibility/presence gate；
- 主信号、次信号、方向、ready、start amplitude、return hysteresis；
- 最短/最长 rep duration、最大掉点 gap；
- partial rep、uncertain、rejected 和 subject epoch 规则；
- profile identity、hash、数据来源、被试数、校准状态与版本。

优点是端侧几乎没有额外模型成本，失败可解释，易于逐动作上线。缺点是动作与机位增加时需要维护 profile，但这正是当前产品的显式安全边界，不应过早隐藏到黑盒模型里。

Google 官方 ML Kit 的 pose classification 指南也采用“先收目标 pose 样本 → torso/方向归一化 → pairwise landmark distance → kNN → 进入/离开终态阈值计数”；官方建议覆盖不同机位、环境、体型与变式，并称通常每个 pose class 约需 100 个样本才能开始工作。这个数字只适用于其静态 kNN 示例，不是 MaxPower 上线样本量保证。[Google Pose classification 指南](https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses)

### B. 标准化骨架 + 小型时序分类器：数据积累后的优先升级

适合解决：动作确认门控、相似动作区分、动态时序形状、规则阈值跨人体适配。建议顺序：

1. 逻辑回归 / GBDT：输入每 rep 的幅度、duration、速度、左右差、躯干漂移、required-joint coverage；
2. kNN / prototype matching：输入标准化的关键 pose 或 rep template；
3. 小型 1D-TCN / GRU：输入 32–100 帧的 canonical landmarks、骨向量、速度、visibility 和 phase mask；
4. 输出 one-vs-rest `matches_selected_action` 与 `unknown/insufficient`，保留现有 Rust profile 决定 rep 边界。

这条路线能复用当前 `onnxruntime`，模型可以只有几十到数百 KB；训练时还可以保留 profile 生成的相位和低维特征，方便故障分析。它比一开始训练 65 类 softmax 更适合当前证据规模，也更容易加入“其他动作/调整器械/走动/半程 rep”等 hard negatives。

### C. ST-GCN / MMAction2：开放集研究路线

MMAction2（Apache-2.0）官方支持 ST-GCN、2s-AGCN、STGCN++、CTRGCN、MSG3D 与 PoseC3D，并提供从视频跑 detector、pose、skeleton recognizer 的 demo。[MMAction2 官方仓库](https://github.com/open-mmlab/mmaction2) · [skeleton demo](https://github.com/open-mmlab/mmaction2/blob/main/demo/README.md#skeleton-based-action-recognition-demo)

但其开销与数据假设明显高于当前 profile：

- 官方 ST-GCN NTU60 2D 模型约 3.1M 参数、100 帧 joint stream 约 3.8 GFLOPs；two/four-stream 还要额外运行 bone 与 motion 分支。[ST-GCN 官方模型表](https://github.com/open-mmlab/mmaction2/blob/main/configs/skeleton/stgcn/README.md)
- PoseC3D 把关键点变成 3D heatmap，官方模型表中 FineGYM 配置约 14.6 GFLOPs，Kinetics400 配置约 19.1 GFLOPs；它更抗 pose 噪声，但不是轻量手机首选。[PoseC3D 官方模型表](https://github.com/open-mmlab/mmaction2/blob/main/configs/skeleton/posec3d/README.md)
- 官方 checkpoint 的 label space 是 NTU 或 Kinetics，不是 MaxPower 65 个 exact exercise identities、器械/握法/机位组合；直接加载只会输出原数据集类别。

因此 ST-GCN 最适合做离线 ablation：用同一自有 landmark dataset 比较 profile、TCN 与 GCN。如果在 subject-held-out、device-held-out 上有稳定增益，再导出一个削减通道和帧长的自定义 ONNX；不要先把完整 MMAction2 运行时嵌进 App。

## 5. 公开数据：能借鉴什么，许可是否允许

| 数据/项目 | 标签与规模 | 许可/获取 | 与 MaxPower 的域差距 | 建议用途 |
| --- | --- | --- | --- | --- |
| `MindDock/motion-tracker` | 无数据集；4 个规则动作和 DTW demo | MIT 仅覆盖仓库代码 | 没有视频、动作标签、训练权重 | 只读源码参考 |
| [NTU RGB+D / 120](https://rose1.ntu.edu.sg/dataset/actionRecognition/) | 60/120 类，RGB、depth、IR、3D skeleton；大量日常/交互动作 | 官方明确仅限非商业学术研究，禁止商业使用和衍生数据集 | 标签几乎不含健身器械动作；Kinect/实验室域 | 研究 ST-GCN 训练流程；不可作商业训练资产 |
| [Kinetics-400](https://github.com/cvdfoundation/kinetics-dataset) | 宽泛网络视频动作；MMAction label map 中与健身近似的仅 bench press、deadlift、lunge、pull-up、push-up、snatch、squat 等粗类 | 官方早期发布 YouTube ID/时间段，现有镜像托管视频；必须单独评估视频权利与权重来源 | 不区分器械变式、机位、rep 相位或动作质量 | 通用视频/骨架预训练研究；不直接对应 65 类 |
| [UI-PRMD](https://pmc.ncbi.nlm.nih.gov/articles/PMC5773117/) | 10 个康复动作；10 名健康人，每动作 10 次；Vicon/Kinect joint position/angle，含 optimal/non-optimal | 数据论文声明 ODC PDDL 1.0 | 无手机 RGB pose 噪声；小样本、康复而非器械健身 | 参考“正确/非最优”标签、subject split、骨架时序格式 |
| [Fitness-AQA](https://github.com/ParitoshParmar/Fitness-AQA) | BackSquat、BarbellRow、OverheadPress；真实网络视频与细粒度 form error | 作者仓明确仅限 non-commercial，并需申请 | 很接近健身房，但只有 3 动作、网络视频、数据不可商用 | 参考错误本体、器械遮挡与双教练标注；不可直接入商用训练 |
| [EgoExo-Fitness](https://github.com/iSEE-Laboratory/EgoExo-Fitness) | 12 种 fitness action、同步 ego/exo 多视角、两级时间边界、technical keypoint、自然语言反馈和质量分 | 代码仓 Apache-2.0，但数据需单独签 License Agreement；原始视频不等同于开源代码 | 多为自重/连续动作，摄像机形态与本产品不同 | 参考动作/子步骤/技术要点/质量四层 annotation schema |
| [FLEX](https://github.com/HaoYin116/FLEX_AQA_Dataset) | 20 个负重动作、38 人、5 视角、约 7,500 样本；3D pose、sEMG、错误、feedback、score | 官方申请页写 academic only / no commercial exploitation；代码仓当前无根级 license | 数据设计最接近，但 MoCap、多视角与商用限制明显 | 最值得参考采集协议、知识图谱、错误标签和 multi-view baseline |
| [KIMORE](https://u-pad.unimc.it/handle/11393/301719) | 78 人、5 个低背痛康复动作，RGB/depth/skeleton 与临床评分 | 原论文/数据需按提供方 EULA 获取；不可仅凭“free dataset”推定商用 | Kinect、康复患者、临床任务，远离一般健身动作 | 参考动作质量评分与临床标注分离 |

### 5.1 数据许可结论

必须分别记录四份权利链：

1. **代码许可证**：例如 MMPose Apache-2.0、MindDock MIT；
2. **模型权重许可证**：外层仓库 permissive 不代表下载 checkpoint 自动 permissive；
3. **训练数据条款**：NTU、Fitness-AQA、FLEX 明确非商业限制；
4. **原始视频中的著作权、肖像/隐私与同意范围**：从 YouTube ID 或公开视频抽帧不自动产生商用训练授权。

因此公开数据的合理角色是：

- 设计 label ontology、phase schema、hard-negative taxonomy；
- 在研究环境复现 MMAction2/ST-GCN；
- 预先筛选 architecture，避免在自有数据上盲试；
- **不在权利链未清时把其视频、骨架或训练权重放进商业发布模型。**

## 6. 推荐的扩动作流水线

### 阶段 0：先定义任务，不把三个 classifier 混在一起

每个动作分别回答：

1. `selected-action confirmation`：用户选了动作 A，当前序列是否像 A；
2. `phase/rep`：A 的 start → effort → peak → return 是否完成；
3. `form/error`：哪个可观测错误发生、发生在哪一相位；
4. `open-set recognition`：用户未选择时，在支持集里猜动作，并能拒绝 unknown。

近期只需要优先完成 1 和 2。动作质量和开放集分类使用不同标签、损失和风险门槛，不应借计数 profile 偷渡。

### 阶段 1：按动作族与可观测性选优先级

优先扩展全身可见、周期清晰、器械遮挡小、现有 33 点可直接表达的动作，例如 squat、lunge、lateral raise、curl、shoulder press、march/knee raise、step jack。卧推、固定器械、绳索遮挡和细握法放在困难集。

每个 action×view 先写 observation contract：必需点、可能遮挡、主/次信号、朝向、最小入镜比例、允许变式与拒绝原因。若可观测量不足，应明确 unsupported，而不是用阈值硬凑 65/65。

### 阶段 2：采集同分布数据

采集单位不是“一个动作视频”，而是：

```text
participant × session × device × cameraView × exercise × variation × load × executionType
```

每个 action×view 同时录制：完整标准 rep、慢/快节奏、半程、停顿、起始调整、结束离场、相似动作、遮挡、第二人走入和关键点不可见。标注至少包括：

- `subjectId`、`sessionId`、device、分辨率、实际 FPS 与 camera pose；
- action、variation、load/RPE、left/right/bilateral；
- 每个 rep 的 start、extreme、end；partial / complete / unjudgeable；
- required-joint visibility、occlusion、subject switch；
- 动作质量标签另用一套规范和至少两名合格标注者，不与计数标签合并。

Google 的 kNN 示例“每 pose class 约 100 张”只能作为最低原型量级。正式样本量应由 pilot 的 subject-to-subject 方差、目标错误率置信区间和最困难分层决定；不要把同一个人的相邻 rep 随机拆到训练和测试。

### 阶段 3：用生产 pose 生成 canonical dataset

所有训练/验证 landmark 应使用与产品相同的版本化 pose engine 生成，并保存：

- 原始 normalized image x/y/z、world x/y/z；
- visibility / presence，而不是把低置信点写成 `(0,0)`；
- timestamp、frame gap、subject epoch；
- torso-centered / scale-normalized / left-right canonical coordinates；
- derived joint angles、bone vectors、velocity、acceleration；
- pose model 名称、版本、asset hash、camera transform 和 preprocessing version。

若用 RTMPose 或公开 skeleton 预训练，需要显式做 17↔33 点 topology mapping，并在输入中保留 missing-joint mask。不能假设 COCO-17 与 BlazePose-33 的坐标、髋中心、深度和置信度可直接互换。

### 阶段 4：规则基线先行，再做小模型 ablation

对每个新动作冻结三组结果：

1. 现有 Rust profile；
2. profile + selected-action 小分类器；
3. TCN/ST-GCN 等时序模型。

模型只有在严格 holdout 上显著降低误计、漏计或拒答，并满足端侧延迟/包体/内存预算时才升级默认。否则继续使用 profile。模型输出应是概率和 unknown，不直接接管 rep counter；profile/state machine 仍负责真实时间、hysteresis、partial rep 和封装结果。

### 阶段 5：分层发布

建议每个 exact action×view 使用下列 maturity：

```text
unmeasured
  → synthetic_initializer
  → observed_provisional
  → subject_held_out_validated
  → device_and_session_validated
  → production_supported
```

UI 应显示“可试验”“已校准”“数据不足/调整机位”，不要把 `catalog_only` 或 simulated initializer 展示为同等可靠。

## 7. 验证与上线闸门

### 7.1 Pose 层

- required-joint detection/coverage rate；
- joint-specific PCK 或归一化误差；
- static jitter、velocity noise、最长连续掉点；
- 遮挡前后轨迹恢复误差；
- MediaPipe 与 RTMPose 同帧 disagreement；
- 按动作、机位、设备、光照、衣着、体型分层。

### 7.2 Subject tracking 层

- ID switch 次数；
- 路人进入后主用户保持率；
- 丢失重获时间和是否错误继承 rep state；
- ambiguous / lost 时暂停计数的正确率。

### 7.3 Recognition / rep 层

- 每 action×view 的 rep precision、recall、F1；
- 每段 set 的 count MAE、exact-count rate；
- start/extreme/end 时间误差；
- partial rep false positive；
- 相似动作和 non-exercise hard negative false positive；
- unknown / refusal rate 及其分层公平性；
- probability 模型的 calibration（Brier/ECE）。

拆分必须以 `subjectId` 为主，再做 session/device holdout；同一视频、同一人的相邻 rep 和同一原片的不同 crop 不能跨 split。测试集只在 profile/阈值/模型冻结后评一次。

### 7.4 移动端预算

至少记录中低高三档 Android 的：

- 模型/asset 下载与 APK 增量；
- 冷启动、首个 skeleton、每帧 pose latency；
- action model 每窗口 latency；
- 8 分钟与连续 16 分钟运行的 FPS、温升、降频、电量与内存；
- CPU/GPU/NPU fallback；
- 前后摄像头、横竖屏和实际 timestamp 稳定性。

MediaPipe Lite/Full/Heavy 和 RTMPose 的论文数字只能用于候选筛选；最后的部署决策必须以同一 App、同一设备、同一视频和同一 downstream rep 指标为准。

## 8. 建议的近期实施顺序

1. **冻结当前事实看板。** 65 catalog、65 executable、5 observed、0 held-out 分开显示；修正引用旧 8-profile / 14-experimental 数字的文档。
2. **对现有 5 个 observed context 做真正的端到端 held-out。** 新受试者、新 session、新设备重新跑 MediaPipe；当前 in-sample sidecar 回放只保留为回归测试。
3. **建立 MediaPipe Lite/Full 与 RTMPose 的同批 A/B evaluator。** 以 downstream peak/rep 改善作为选择依据，不用 COCO AP 代替。
4. **选 5–10 个易观测动作建立第一批 production dataset。** 每个动作先完成 exact view、required joints、hard negatives 和拒绝规范。
5. **规则/profile 先达到门槛；再训练 one-vs-rest 小型时序确认器。** 初期不训练 65 类通用 ST-GCN。
6. **把 Fitness-AQA、EgoExo-Fitness、FLEX 用作 annotation 设计参考。** 不导入非商业数据或来源不清的 checkpoint；若确实希望用，先取得书面商业许可。
7. **最后再评估自动动作发现。** 开放集 classifier 必须有 unknown 类、动作切换 debounce 和用户确认；它不应阻塞已选动作计数。

## 9. 最终判断

目前 MaxPower 的技术架构方向是对的：基础骨架模型已经够用，真正需要扩展的是**动作/机位事实源、同分布数据、标注协议和 held-out 验证**。`motion-tracker` 类开源项目证明“现成 pose + 角度/DTW/状态机”容易做出 demo，却没有提供能替代这些工作的训练数据或生产准确率。

最现实的路线不是“找一个开源 65 动作模型直接装上”，而是：

```text
保留 MediaPipe 产品主路径
  → RTMPose 同批离线对照
  → 自有 action×view 数据和 profile
  → subject/session/device holdout
  → 小型 selected-action 时序确认器
  → 有充分数据后才研究 ST-GCN / 自动 65 类
```

在达到独立验证前，当前能力应描述为：**5 个实拍机位已有 provisional recognition evidence；65 个目录动作在推荐机位可执行；生产准确率尚未建立。**

## 主要一手来源

- [MediaPipe Pose Landmarker 官方文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/)
- [BlazePose GHUM 3D 模型卡](https://developers.google.com/static/ml-kit/images/vision/pose-detection/pose_model_card.pdf)
- [Google ML Kit pose classification / rep counting 指南](https://developers.google.com/ml-kit/vision/pose-detection/classifying-poses)
- [RTMPose 论文](https://arxiv.org/abs/2303.07399)
- [MMPose 官方仓库](https://github.com/open-mmlab/mmpose)
- [MMPose 自定义数据官方指南](https://mmpose.readthedocs.io/en/latest/advanced_guides/customize_datasets.html)
- [MMDeploy 官方仓库](https://github.com/open-mmlab/mmdeploy)
- [MMAction2 官方仓库](https://github.com/open-mmlab/mmaction2)
- [MindDock/motion-tracker](https://github.com/MindDock/motion-tracker)
- [NTU RGB+D 官方数据页与条款](https://rose1.ntu.edu.sg/dataset/actionRecognition/)
- [UI-PRMD 原始数据论文](https://pmc.ncbi.nlm.nih.gov/articles/PMC5773117/)
- [Fitness-AQA 作者仓库与数据许可](https://github.com/ParitoshParmar/Fitness-AQA)
- [EgoExo-Fitness 作者仓库与 License Agreement](https://github.com/iSEE-Laboratory/EgoExo-Fitness)
- [FLEX 作者仓库与申请条款](https://github.com/HaoYin116/FLEX_AQA_Dataset)
