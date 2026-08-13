# 从骨架与杠铃轨迹理解力量训练：零基础负责人知识地图与 Agent 审核手册

> 日期：2026-08-13
> 面向任务：用单目/多目普通相机，提取人体骨架轨迹与杠铃轨迹，识别、分段并有限度地理解力量训练动作；重点是判断系统是否真正泛化，而非只适配已有视频。
> 证据原则：正文中的外部事实只引用论文原文、官方数据集/项目文档、标准组织或官方技术文档。标为 **[推断]** 的内容是基于这些来源给出的产品/审核建议，不是来源原话。
> 一句话底线：**好看的叠加骨架只能证明程序跑通；只有对完全隔离的新人物、新拍摄和新环境的盲测，才能支持“学会了卧推”之类的结论。**

## 0. 先把“理解动作”拆开

“理解”不是一个可直接验收的指标。至少要拆成以下层级，并分别给真值和指标：

1. **看见**：这一帧中，人、关节、杠铃在哪里？
2. **连续地看见**：相邻帧中的关节/杠铃是否仍是同一个对象，遮挡后是否恢复正确？
3. **量出运动**：相对位移、角度、速度和时序是否准确？坐标属于图像、相机还是世界坐标系？
4. **切出结构**：一次动作从哪开始、到底部/触胸/锁定等阶段何时发生、何时结束？
5. **识别语义**：这是卧推还是其他动作？握距、停顿、节奏等可观察变体是什么？
6. **评价质量**：是否存在某个预先定义、由专家可重复标注的错误？
7. **解释生物力学**：关节力矩、肌肉力、伤病风险等是否有足够测量与模型支持？

前一层失败会污染后一层。动作类别识别正确，并不证明轨迹准确；重复计数正确，并不证明动作质量判断正确；骨架看起来合理，也不证明纵深坐标真实。

FineGym 将细粒度运动理解拆成多级语义和 action/sub-action 两级时间标注，并指出精细分析需要正确建模时序，稀疏抽帧不够；这是“先分段，再谈细粒度语义”的直接依据。[FineGym, CVPR 2020](https://openaccess.thecvf.com/content_CVPR_2020/html/Shao_FineGym_A_Hierarchical_Video_Dataset_for_Fine-Grained_Action_Understanding_CVPR_2020_paper.html) MS-TCN 则把长视频中的逐帧分类和时间分段作为独立任务，并使用 segmental edit 与 F1@IoU，原因之一是单纯逐帧准确率会被长动作主导、难以惩罚过度切段。[MS-TCN, CVPR 2019](https://openaccess.thecvf.com/content_CVPR_2019/html/Abu_Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.html)

**[推断] 产品负责人首先要逼 Agent 把“理解”改写成可失败的句子。**例如：“在固定侧面机位、单人、无遮挡的卧推视频上，检测每次杠铃最低点，事件时间误差中位数不超过 100 ms，且在未见过的人上保持该水平。”如果不能写成这种句子，Agent 还没有进入可验证工程。

---

## 1. 最低限度知识地图

不要求先成为计算机视觉研究员，但应能问清下面六组问题。

### 1.1 坐标、投影与可观测性

必须分清：

- **图像坐标**：像素或归一化的 `(x, y)`；只描述画面中的投影。
- **相机坐标**：以相机为参考的 `(X, Y, Z)`。
- **世界/场地坐标**：以地面、训练凳或平台为参考；跨相机、跨 session 比较前必须定义。
- **身体局部坐标**：相对骨盆、胸廓或某肢段；去掉全局位置后更适合比较姿态，但也可能掩盖全局轨迹误差。

针孔模型把 3D 点经内参、旋转和平移投影为 2D 像素；同一个 2D 投影可能来自不同的 3D 姿态。因此，从单目 2D 关键点“抬升”3D 是有歧义的。VideoPose3D 原论文明确写道多个 3D 姿态可映射到同一组 2D 关键点；它用时间上下文和训练先验缓解歧义，不是从单张图像获得唯一几何解。[VideoPose3D, CVPR 2019](https://openaccess.thecvf.com/content_CVPR_2019/papers/Pavllo_3D_Human_Pose_Estimation_in_Video_With_Temporal_Convolutions_and_CVPR_2019_paper.pdf)

相机标定要估计内参、畸变和外参；OpenCV 官方教程用重投影误差检查参数，但低重投影误差只说明标定点能被模型解释，不自动证明人体/杠铃 3D 轨迹准确。[OpenCV 相机标定教程](https://docs.opencv.org/5.0/py_tutorials/py_calib3d/py_calibration/py_calibration.html) 张正友标定法的原始方案要求从至少两个不同朝向观察已知平面图案，并显式建模径向畸变。[Microsoft Research 原始论文页面](https://www.microsoft.com/en-us/research/publication/a-flexible-new-technique-for-camera-calibration/)

多目三角测量需要：每个相机的投影矩阵、同一物理点的跨视角对应、以及时间同步。OpenCV 的 `triangulatePoints` 文档明确以两台相机的投影矩阵与成对 2D 点重建齐次 3D 点。[OpenCV 官方源码文档](https://github.com/opencv/opencv/blob/4.x/modules/calib3d/include/opencv2/calib3d.hpp)

**必须会问：**

- 输出的 z 是由真实双目几何测得，还是模型根据人体先验“猜”的？
- 坐标原点、单位、轴方向是什么？换手机、裁剪画面或变焦后还成立吗？
- 相机是否固定？若移动，如何估计相机自身运动？
- 双机位是否硬件/软件同步？同步误差如何量化？
- 是否报告标定重投影误差及工作空间覆盖，而不只给一个平均数？

### 1.2 2D/3D 人体姿态估计

2D 姿态估计输出的是一组预定义关键点及其置信度/可见性，不是骨骼、关节中心或肌肉的直接测量。COCO 关键点任务使用 17 类人体关键点与 OKS 指标；关键点拓扑应作为数据契约，而不能在模型间静默混用。[COCO 2017 Keypoints 官方材料](https://presentations.cocodataset.org/COCO17-Keypoints-Overview.pdf)

MediaPipe Pose Landmarker 的官方结果区分 normalized image landmarks 和 world landmarks，并提供可见性字段；字段叫 “world” 不等于在你的场地世界坐标中经过独立几何验证。[MediaPipe 官方 API](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/PoseLandmarkerResult)

3D 姿态常用 MPJPE（每关节平均位置误差）评估。必须同时问是否在对齐前还是刚体/尺度对齐后计算；对齐后的数字会移除一部分全局旋转、平移或尺度错误。VideoPose3D 官方结果将 Protocol 1 MPJPE 和刚体对齐后的 Protocol 2 分开报告；其野外推理文档还明确说明输出相对根关节、没有全局轨迹、位于相机坐标，且相机内参与训练域差异可能造成坏结果。[VideoPose3D 官方仓库](https://github.com/facebookresearch/VideoPose3D)、[野外推理限制](https://github.com/facebookresearch/VideoPose3D/blob/main/INFERENCE.md)

Human3.6M 有 360 万姿态，但来自 11 人、4 个视角和受控动作；大数字不等于健身房场景多样性。[Human3.6M 原始论文](https://pubmed.ncbi.nlm.nih.gov/26353306/) MPI-INF-3DHP 专门加入室内/室外条件以处理野外泛化问题。[MPI-INF-3DHP 官方页](https://vcai.mpi-inf.mpg.de/3dhp-dataset/) 3DPW 则包含移动手机拍摄的野外视频。[3DPW 官方页](https://virtualhumans.mpi-inf.mpg.de/3DPW/)

**必须会问：**

- 模型关键点定义与业务所需关节是否一致？腕点能否代表握杠点？肩点能否代表盂肱关节中心？
- 对遮挡、出画、低置信度是“未知”，还是用平滑器补成看似合理的轨迹？
- 3D 指标是否在卧推/力量训练目标域上测过，而不是只引用 Human3.6M？
- 报的是平均位置误差，还是也包含角度、速度、相位事件和失败率？

### 1.3 杠铃检测与跟踪

“检测”解决每帧在哪里；“跟踪”还要解决跨帧身份、遮挡与重新出现。PoseTrack 建立了视频姿态估计与 articulated tracking 的独立 benchmark，正因为现实视频中系统经常不能产生时间一致的轨迹。[PoseTrack, CVPR 2018](https://openaccess.thecvf.com/content_cvpr_2018/html/Andriluka_PoseTrack_A_Benchmark_CVPR_2018_paper.html)

对杠铃，业务所需几何量决定标签：

- 只计重复：可先用杠铃中心或两侧配重片中心的 2D 轨迹。
- 分析倾斜/不对称：需要两端点、杆轴方向，或多视角 3D 端点。
- 处理手、机架和配重片遮挡：要有显式 `visible/occluded/out-of-frame` 状态，不能把插值当观测。

DeepMind 的 TAP-Vid 官方定义同时预测每帧点位置与可见性，并明确其精度目标不同于框跟踪；这可作为设计杠铃端点跟踪评测的参考，但 TAP-Vid 的通用成绩不能替代杠铃域评测。[TAP-Vid/TAPIR 官方仓库](https://github.com/google-deepmind/tapnet)

HOTA 将检测、关联和定位分解后再综合，原因是单一跟踪指标可能过度偏重某一部分。[HOTA 原论文](https://www.cvlibs.net/publications/Luiten2020IJCV.pdf)

单机位杠铃轨迹可以在严格布置下有价值：一项杠铃自动跟踪验证研究用侧面远距离相机，与 3D 光学运动捕捉比较水平/垂直位移和速度；它并没有证明任意手机角度下都可靠。[PLOS ONE 原始验证研究](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0263224)

**必须会问：**

- 跟踪的是同一个物理点，还是每帧“看起来像杠铃的中心”？
- 遮挡帧是否从指标分母中偷偷删掉？失跟率、最长连续失跟时长、恢复错误是否报告？
- 有无相机运动补偿？若相机在动，画面里的杠铃移动不等于杠铃在场地里移动。
- 轨迹滤波是否造成最低点/锁定点的时间延迟与幅度削弱？

### 1.4 时序：重复、阶段、动作与质量

重复计数、阶段分割、动作分类和动作质量评价是四个任务：

- **重复计数**：可利用周期性；RepNet 的目标就是估计重复周期和次数，并不输出动作是否规范。[RepNet, CVPR 2020](https://openaccess.thecvf.com/content_CVPR_2020/html/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.html)
- **阶段分割**：对每帧或时间段标注准备、下降、底部/触胸、上升、锁定、结束等。
- **动作识别**：给时间段一个类别，如卧推、深蹲。
- **动作质量评价**：对预定义错误或分数给判断；它需要规则、专家真值与可靠性验证，不能从“像标准动作”自动推出。

AIFit/Fit3D 证明“3D 重建—重复分段—偏差反馈”可以被做成明确流水线；Fit3D 官方页给出 611 个多视角序列、每序列至少 5 次标注重复、37 种以上练习和约 296 万个 3D 骨架。[Fit3D 官方页](https://fit3d.imar.ro/)、[AIFit, CVPR 2021](https://openaccess.thecvf.com/content/CVPR2021/html/Fieraru_AIFit_Automatic_3D_Human-Interpretable_Feedback_Models_for_Fitness_Training_CVPR_2021_paper.html) FLAG3D 提供 60 类、18 万序列、MoCap 3D 姿态和专业语言指导，同时含自然环境手机视频，可用来研究跨域差距；但它也不是“所有杠铃动作质量”的现成真值。[FLAG3D, CVPR 2023](https://openaccess.thecvf.com/content/CVPR2023/html/Tang_FLAG3D_A_3D_Fitness_Activity_Dataset_With_Language_Instruction_CVPR_2023_paper.html)

**必须会问：**

- 每个 phase 的可操作定义是什么？两位教练看到同一视频能否独立标得接近？
- 起止边界容许误差多少帧/毫秒？只报逐帧准确率还是也报 boundary error、segmental F1、edit score？
- 模型遇到“不在标签集中的动作”、热身、调整握距、失败重复时，是输出 unknown，还是硬选一个已知类别？OpenTAL 指出闭集假设不能处理开放世界中的未知动作，并专门评估不确定性。[OpenTAL, CVPR 2022](https://openaccess.thecvf.com/content/CVPR2022/html/Bao_OpenTAL_Towards_Open_Set_Temporal_Action_Localization_CVPR_2022_paper.html)

### 1.5 运动学不等于动力学，更不等于伤病诊断

图像轨迹首先支持的是**运动学**：位置、角度、速度、加速度。要得到净关节力/力矩等**动力学**量，通常还要人体惯性参数和外力。OpenSim 官方文档说明，逆动力学用已知运动、模型与外载求净关节力/力矩；外载包括地面反作用力、力矩和压力中心，且微分会放大噪声，需滤波。[OpenSim 逆动力学官方文档](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063)

OpenCap 的原始验证使用两台手机、计算机视觉和肌骨仿真，并与实验室光学 MoCap 和力台比较。其两相机 HRNet 设置在所测活动上的平均 3D marker error 为 32 mm，18 个旋转自由度平均运动学 MAE 为 4.5°，范围 1.7–10.3°；这些是特定系统、任务和验证样本的结果，不可移植成“手机视觉普遍 4.5°”。[OpenCap 原始论文及完整方法/结果](https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1011462)

ISB 为关节坐标系和运动报告提出标准，是因为不同坐标定义会让“同一个关节角”不可直接比较。[ISB joint coordinate system 建议](https://pubmed.ncbi.nlm.nih.gov/11934426/)

**红线：**

- 仅由骨架与杠铃像素轨迹，不能直接声称测得肌肉激活、肌肉力、关节接触力或伤病概率。
- 不知道杠铃质量、人体尺度、帧率和真实空间标定时，不应把像素速度包装成 m/s、功率或负荷。
- “轨迹与某模式相关”不等于“该模式导致受伤”；医疗/伤病结论需要单独临床证据和适用范围。

### 1.6 评估、偏差与不确定性

平均分数会隐藏最危险的失败。至少按以下切片报告：

- 人：未见过的 subject；身高/体型/肤色、服装与能力水平覆盖。
- 拍摄：手机型号、分辨率、帧率、快门、焦距、距离、高度、角度、横竖屏。
- 环境：光照、背景、镜面、人群、机架和器械遮挡。
- 动作：负重、速度、停顿、完整/失败重复、握距、动作幅度。
- 可见性：完整、局部遮挡、严重遮挡、出画。

Human3.6M 的受试者和视角组成、3DPW 的移动手机场景、Fit3D/FLAG3D 的健身动作覆盖共同说明：数据集名字或总帧数不能代替目标人群与目标环境的覆盖说明。[Human3.6M](https://pubmed.ncbi.nlm.nih.gov/26353306/)、[3DPW](https://virtualhumans.mpi-inf.mpg.de/3DPW/)、[Fit3D](https://fit3d.imar.ro/)、[FLAG3D](https://openaccess.thecvf.com/content/CVPR2023/html/Tang_FLAG3D_A_3D_Fitness_Activity_Dataset_With_Language_Instruction_CVPR_2023_paper.html)

神经网络输出 0.9 不代表现实中 90% 正确。现代网络可能校准不良，应在独立验证集上检查 reliability diagram、ECE/Brier 等，并对产品阈值做校准。[Guo et al., ICML 2017](https://proceedings.mlr.press/v70/guo17a.html)

NIST AI RMF 要求性能评估伴随不确定性、benchmark 比较和正式记录；模型卡建议明确 intended use、评估过程、限制与不同群组条件下的表现。[NIST AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)、[Model Cards 原论文](https://doi.org/10.1145/3287560.3287596)

---

## 2. 最重要的审核：它记住了视频，还是学会了卧推？

### 2.1 四级能力边界

| 能力级别 | 它实际证明了什么 | 合格测试 | 不能声称什么 |
|---|---|---|---|
| L0 `seen-video fit` | 能拟合/回放已参与开发的视频 | 在已见视频上可视化、单元测试、轨迹自洽检查 | 不得称为泛化；不能称“识别卧推” |
| L1 `same-subject new capture` | 对同一个人重新拍摄仍工作 | 该人另一天/另一次 session 的原始视频，训练与调参时完全不可见 | 不能说明适用于新用户 |
| L2 `new-subject same context` | 在相同器械、机位和环境下适用于新用户 | subject-disjoint 测试；测试者从未出现在训练/验证集 | 不能说明换健身房、机位或手机仍工作 |
| L3 `cross-context exercise understanding` | 在预先声明的环境变化下仍识别相同动作语义/阶段 | 新 subject + 新 session + 新场景/设备/机位的外部盲测；按域分别报告 | 不能无限外推到未测试的动作、器械、视角、人群 |

**[推断] “学会卧推”至少应达到 L2；若产品允许用户自由放置手机，产品性主张通常需要 L3。** L0 只适合调试，L1 只适合个人校准型功能。

WILDS 原始研究显示训练分布与部署分布不同会显著降低性能，且标准训练的分布外表现普遍低于分布内表现。[WILDS, ICML 2021](https://proceedings.mlr.press/v139/koh21a.html) “shortcut learning”指模型使用在标准 benchmark 有效、但在更困难条件下不迁移的决策规则。[Geirhos et al., Nature Machine Intelligence 2020](https://www.nature.com/articles/s42256-020-00257-z)

在卧推里，捷径可能是：固定训练凳颜色、某人的衣服、视频边框、相机角度、固定片重颜色、教练出现、文件编码或“动作总在第 2 秒开始”。高准确率本身无法证明模型使用了骨架—杠铃关系。

### 2.2 数据切分的硬规则

每条原始素材至少要有以下 ID：

```text
subject_id      同一个人永久一致
capture_id      一次连续录制/一个原始文件
session_id      同一人同一天同一布置的一组 capture
site_id         场地/健身房
camera_id       设备与镜头
setup_id        机位、距离、高度、方向、器械配置
exercise_id     动作定义版本
rep_id          一次重复；只能从属于一个 capture
```

切分规则：

1. **禁止 frame-random split。** 同一视频相邻帧高度相关，不能一部分进训练、一部分进测试。
2. **最低要求 capture-disjoint。** 同一个 `capture_id` 的帧、clip、重复、增强版本和派生骨架全部只能属于一个 split。
3. **验证 L1 时 session-disjoint。** 同一个人不同 session 分开；同一天固定布置下连续按停止/开始得到的文件，保守视为同一 session。
4. **验证 L2 时 subject-disjoint。** 某人的所有视频与派生数据只能出现在 train、validation、test 之一。scikit-learn 官方文档指出，当同一生成过程产生相关组样本时 i.i.d. 假设不成立，应确保验证组在训练折中完全不出现；`GroupKFold` 就用于非重叠组。[官方 grouped cross-validation 文档](https://scikit-learn.org/stable/modules/cross_validation#cross-validation-iterators-for-grouped-data)
5. **验证 L3 时 domain-disjoint。** 至少留出一个未用于模型/阈值选择的 `site/setup/camera` 组合；最好由不同采集者独立采集。
6. **所有派生物继承源视频 split。** 裁剪、慢放、镜像、压缩版、骨架 JSON、人工修复轨迹不得跨 split。
7. **近重复去重在切分之前做。** 文件哈希、感知哈希、时间戳/元数据、骨架序列相似度均要查；任何来源不明的网路剪辑要防止同场比赛不同转载同时落入 train/test。
8. **测试集冻结。** 测试错误样本可看报告但不能反复拿来调规则/阈值；一旦参与改进，它就变成开发集，需另建新盲测集。

**交付物要求：** Agent 必须提供 split manifest（每个 asset 到 split 的唯一映射）、分组字段、去重报告、训练/验证/测试人物与 session 数量，而不只是帧数。

### 2.3 四组能揭穿“记住视频”的实验

#### A. 域梯度表

用完全相同模型依次测试 L0→L3，报告每一级同一组指标及 95% 置信区间：

```text
seen capture → same person/new session → new person/same setup → new person/new setup
```

**[推断]** 如果 L0 很高而 L1/L2 断崖下降，模型/规则主要适配了素材或个人；如果 L2 尚可而 L3 下降，问题是机位/环境域偏移。不要用一个聚合均值把梯度抹平。

#### B. 反事实/扰动测试

在不改变卧推语义的情况下改变潜在捷径：更换背景、衣服/杠铃片颜色、左右镜像、裁掉画面边缘、改变压缩、打乱非动作背景帧。再做相反测试：保留背景但换成非卧推动作或空凳。

**[推断]** 若预测随背景/颜色而非骨架—杠铃关系变化，应按 shortcut failure 记录；这不能单独证明“真正理解”，但能否证一批错误方向。

#### C. 模态消融

分别运行：RGB-only、skeleton-only、barbell-only、skeleton+barbell、遮掉人、遮掉杠铃。报告性能变化和失败例。

**[推断]** 声称依靠“骨架+杠铃关系”却在遮掉人体后几乎不掉分，说明证据与叙述不一致；但合理消融结果仍不是因果理解证明，只是机制证据。

#### D. 外部盲测

由未参与开发的人按预先写好的 protocol 采集并锁定标签；在模型版本、阈值、成功标准冻结后只运行一次。外部集必须列出新人物、新 session、新机位/手机和困难条件覆盖。

**[推断]** 这是 L3 主张最有说服力的证据。若 Agent 在看到外部集后继续调模型，就必须再换一份盲测集。

### 2.4 phase 真值怎么做才可信

先写 annotation manual，再标数据。以卧推为例，不能只写“下降/上升”，应给可观察事件定义及争议规则，例如：

- `unrack`：杠铃离开支撑并进入人体上方稳定控制；
- `descent_start`：稳定段之后杠铃垂直方向持续下降的首个时刻；
- `bottom_or_touch`：杠铃最低点；“触胸”若被遮挡则标 unknown，而不是由最低点代替；
- `ascent_start`：最低点后持续上升的首个时刻；停顿卧推允许 bottom 与 ascent 不同帧；
- `lockout`：达到动作定义要求的顶部稳定位置；仅靠腕点未必能判断肘关节锁定；
- `rerack`：杠铃重新由支架承重；
- `failed_rep`：上升后回落/辅助介入，按 protocol 定义。

每个事件标注应包含 `frame/time`、`visible/occluded/unknown`、标注者和版本。至少抽取一部分让两位合格标注者独立标；报告事件时间差分布和一致性，争议由第三人裁决并更新手册。FineGym 使用层级定义与人工时间标注，显示细粒度数据首先是一个明确 taxonomy 与质量控制问题。[FineGym 原论文](https://openaccess.thecvf.com/content_CVPR_2020/papers/Shao_FineGym_A_Hierarchical_Video_Dataset_for_Fine-Grained_Action_Understanding_CVPR_2020_paper.pdf)

**[推断]** 如果标注者自己不能稳定区分 phase，模型不可能被可靠地训练或验收；此时应合并 phase、改善机位，或允许 unknown，而不是让 Agent 发明更复杂模型。

### 2.5 样本覆盖、置信区间与诚实措辞

报告“多少帧”很容易制造规模幻觉。统计单位应跟主张一致：

- 用户泛化以 **subject** 为主要独立单位；
- 新拍摄泛化以 **session/capture** 为单位；
- 重复计数可报告 rep 级误差，但置信区间应按 subject/session 聚类重采样，避免把同一人的上千帧当上千个独立样本；
- 失败率/成功率同时给分子、分母和 95% 区间。NIST 手册给出二项比例 Wilson 等置信区间方法。[NIST/SEMATECH 置信区间](https://itl.nist.gov/div898/handbook/prc/section2/prc241.htm)

**[推断] 推荐报告格式：**

```text
新人物固定侧面机位：18/20 subjects 达到每组计数绝对误差 ≤1；
共 126 sessions、1,840 reps；subject-cluster bootstrap 95% CI = [..., ...]；
严重遮挡子集仅 6 subjects，结果为探索性，不支持产品承诺。
```

不接受：

- “准确率 95%”但不写任务、阈值、分母、split 和区间；
- 把同一视频的 10,000 帧说成 10,000 个独立测试样本；
- 只报最好的一次 seed/最好的一折；
- 只报均值，不给最差 subject、失败切片或覆盖表；
- 在测试集反复挑阈值后仍称其为独立测试。

---

## 3. 每一层该看什么指标

| 层 | 最低指标 | 必须补充的失败视图 |
|---|---|---|
| 2D 人体关键点 | OKS/AP 或按身体尺度归一化的关键点误差；可见/遮挡分别统计 | 每关节、每机位、遮挡、出画；左右交换率 |
| 杠铃检测 | center/end-point error、precision/recall、漏检率 | 机架混淆、配重片变化、手遮挡、运动模糊 |
| 轨迹跟踪 | localization error + association/连续性；HOTA 子指标或等价分解 | ID switch、最长断轨、遮挡恢复、伪造插值比例 |
| 3D 重建 | MPJPE（明确是否 root/scale/rigid aligned）、重投影误差 | 绝对尺度/全局轨迹误差、每轴尤其 z、跨视角一致性 |
| 轨迹/事件 | 位移/角度 MAE；最低点/触胸/锁定的时间误差 | 滤波延迟、快速/慢速/停顿/失败重复 |
| 重复计数 | 每视频/每组 count MAE、exact、off-by-one | 少 reps、多 reps、不完整 rep、辅助介入 |
| phase 分割 | boundary error、segmental F1@IoU、edit score；frame accuracy 仅作补充 | 过切、漏段、短暂停顿、unknown |
| 动作识别 | macro-F1、每类 precision/recall、confusion matrix | unknown/OOD、相似动作、类别与 subject 不平衡 |
| 动作质量 | 每个具体错误的 sensitivity/specificity/F1；与专家一致性 | 标注者分歧、不可见、严重错误漏报；不要只给总分相关性 |
| 实时产品 | 端到端延迟分位数、掉帧、耗电/温升、拒答率 | 设备型号、长时运行、低光、后台切换 |

注意：骨长稳定、轨迹平滑、重投影一致都只是 **sanity check**。错误 3D 也可以很平滑、骨长恒定并完美重投影到 2D；它们不能替代带 3D 真值的精度验证。

---

## 4. 审核 Agent 的工作是否走在正确方向

### 4.1 要求一张“主张—证据账本”

Agent 每次交付必须更新一行，而不是只写进展叙述：

| 字段 | 要求 |
|---|---|
| Claim ID | 稳定编号 |
| 精确主张 | 对谁、什么环境、做什么、达到什么阈值 |
| 能力级别 | L0/L1/L2/L3 |
| 可观测量 | 2D、标定 3D、模型推断 3D、外力等，不得混称 |
| Ground truth | 谁标、用什么设备/协议、误差/一致性 |
| Split unit | subject/session/capture/site；附 manifest |
| 数据覆盖 | 人数、session、reps 与困难切片，不只帧数 |
| Metric + threshold | 预先规定，写清聚合方式 |
| Uncertainty | 95% CI、跨 subject 分布、最差切片 |
| Artifact | 数据版本、代码 commit、模型 hash、配置、随机种子 |
| Reproduction | 一条可复现命令/流程与原始逐样本结果 |
| Status | hypothesis / L0 demo / internal validation / blind pass / rejected |

NIST AI RMF 的测量要求和 Model Cards 的用途/限制/分群评估思想支持这种记录方式。[NIST AI RMF](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)、[Model Cards](https://doi.org/10.1145/3287560.3287596)

### 4.2 五道闸门

#### 闸门 1：问题定义

通过条件：动作、phase、错误类型、目标用户、机位和拒答条件都写成版本化规范。
偏移信号：Agent 从“卧推计数”滑到“全身 3D 数字人”，从“运动学提示”滑到“伤病风险”。

#### 闸门 2：观测与数据

通过条件：每个输出都能追到原始资产、坐标定义、标注协议和 admission/split 状态。
偏移信号：拿公开视频、合成骨架或模型伪标签当真实目标域真值，却不标 provisional；只谈总帧数，不谈人物/session。

#### 闸门 3：基线与可证伪实验

通过条件：先有简单基线和失败阈值，再加复杂模型；每次改动有相同冻结测试协议和消融。
偏移信号：不断换最新模型但没有固定 test；展示几个成功视频代替指标；只保存渲染视频，不保存逐帧数值和错误。

#### 闸门 4：泛化

通过条件：按 2.1 的四级表报告；L2/L3 使用冻结的 subject/session/domain-disjoint 集与置信区间。
偏移信号：同一视频切 clip 随机划分；同一人的增强版跨 split；在 test 上调阈值；声称“跨用户”但测试人出现在训练集。

#### 闸门 5：产品安全边界

通过条件：低置信度/不可见/OOD 时拒答；UI 区分“观测”“推断”“不可判断”；不把运动学包装成动力学/医疗结论。
偏移信号：任何输入都输出肯定评分；置信度从不随遮挡下降；把插值帧显示为实测；用模糊的“AI 认为标准”。

### 4.3 识别过度承诺的问句

对 Agent 的每个结论连续问：

1. **这个句子里的名词有真值吗？** “标准”“稳定”“危险”如何被标注？
2. **传感器真的看得到吗？** 单侧手机看不到的远侧关节、纵深和接触是否被承认 unknown？
3. **测试对象是否独立？** 新帧不是新视频，新视频不是新 session，新 session 不是新用户。
4. **如果删掉背景/换人/换机位还成立吗？** 若未测，只能写 hypothesis。
5. **误差相对于什么？** 模型 A 与模型 B 一致，不等于二者与真实运动一致。
6. **失败样本在哪里？** 要逐样本表与代表性失败视频，不能只看平均数。
7. **数字能复现吗？** 数据版本、commit、模型 hash、配置和原始预测是否齐全？
8. **证据支持的最窄措辞是什么？** “20 名新用户固定侧面机位计数有效”不能改写成“理解所有力量训练动作”。

### 4.4 Agent “骗你”时常见的九种形态

不必判断它是否主观撒谎，只判断证据结构：

1. **Demo laundering**：把成功可视化称为验证。
2. **Metric substitution**：用姿态 benchmark AP 代替卧推 phase/质量准确率。
3. **Dataset laundering**：用通用人体数据集覆盖健身动作主张。
4. **Split leakage**：相邻帧、同一人或派生版本跨 split。
5. **Alignment hiding**：只报对齐后 3D 误差，掩盖全局轨迹/尺度错误。
6. **Average hiding**：总体均值掩盖某机位、遮挡或人群完全失败。
7. **Confidence theater**：把模型 softmax/visibility 直接叫“可靠度”。
8. **Physics inflation**：由位置轨迹跳到肌肉、力矩、功率或伤病结论。
9. **Scope drift**：未完成原目标的验证，转而搭数据平台、3D avatar 或更大模型。

**停止规则：** 一旦发现 split 泄漏、真值定义不成立或目标信号不可观测，应冻结新功能开发，先修评估；否则所有后续“提升”都不可解释。

---

## 5. 建议的正确技术路线（产品推断，不是论文结论）

以下均为 **[推断]**，用于控制风险与学习成本：

### 阶段 A：固定侧面单目，先做可观测的 2D MVP

只选一个动作（卧推）和一个业务目标（例如 rep + 下降/底部/上升阶段）。固定手机、相机不动、全身与杠铃入画。保存原始 2D 关键点、杠铃端点/中心、置信度、遮挡状态和时间戳。用归一化人体/器械相对量做简单可解释基线：

- 杠铃相对肩/胸的垂直轨迹；
- 腕—肘—肩的成像平面角度；
- 杠铃与双腕的相对关系；
- 轨迹速度符号与持续时间；
- 有限状态机做 phase 和 rep。

理由：这个范围最容易获得人工事件真值、发现遮挡问题和建立 L2 测试；不需要先相信单目 z。

### 阶段 B：把“新用户是否工作”变成第一优先级

在加 3D/Transformer 前，完成 subject/session-disjoint split、外部盲测和四级能力表。每次模型升级只在固定 protocol 上比较，记录 paired per-subject 差异与区间。

### 阶段 C：只在明确收益下增加多目/3D

若侧面 2D 无法区分目标错误（例如杠铃沿纵深偏移、双侧不对称），再引入同步双机位、标定、跨视角关联与三角测量。用带真值的小型同步验证集验证绝对 3D，而不是因 3D 渲染更漂亮就升级。

### 阶段 D：质量反馈只做可重复标注的窄规则

每个反馈独立定义、独立验证，并允许 unknown。例如“本次 rep 杠铃最低点比个人基线高”比“动作不标准”更可审计。涉及伤病、肌肉或关节负荷时，另立证据项目，不从轨迹模型顺延。

---

## 6. 一个可直接发给 Agent 的验收模板

```text
目标主张：
  在【目标用户】、【机位/设备/环境】下，系统能对【动作】输出【具体结果】，达到【阈值】。

能力级别：L0 / L1 / L2 / L3

观测边界：
  直接观测：
  几何计算：
  模型推断：
  不可判断：

数据与真值：
  subjects / sessions / captures / reps：
  标注协议版本：
  标注者一致性：
  数据来源与许可：

切分证明：
  split unit：subject + session + capture
  manifest：
  近重复检查：
  test 是否从未用于调参：是 / 否

指标：
  主指标与阈值：
  95% CI 方法：
  失败切片：
  最差 subject/domain：

反证：
  背景/服装/机位扰动：
  RGB/骨架/杠铃消融：
  unknown/OOD：
  遮挡与出画：

可复现证据：
  data version：
  code commit：
  model hash/config/seed：
  raw per-sample predictions：
  one-command reproduction：

结论（只能选一个）：
  hypothesis / L0 demo / L1 pass / L2 pass / L3 blind pass / rejected

尚不支持的主张：
```

---

## 7. 负责人学习顺序：够用，而非先学完整个领域

1. **第一周：学会识别坐标与不可观测量。** 能在任一输出旁写出“图像/相机/世界/身体局部坐标”和“直接观测/模型推断”。主读 OpenCV 标定教程与 VideoPose3D limitations。
2. **第二周：学会画流水线和失败传播。** 自己画 `视频→人体/杠铃检测→跟踪→轨迹→phase→动作/反馈`，每个箭头列一个真值和一个失败指标。
3. **第三周：学会审核数据切分。** 能看 split manifest，识别 subject/session/capture 泄漏；亲自检查十个随机测试资产的来源。
4. **第四周：学会读评估表。** 先看分母、独立单位、区间、最差切片，再看平均分；能解释 AP、MPJPE、count MAE、segmental F1 各自没有证明什么。
5. **第五周：亲自做一次盲测。** 冻结模型，找新人物/新 session 拍摄，先写成功阈值再运行；亲自看所有失败而不是精选 demo。

达到上述程度后，你未必会训练模型，但已经能判断大多数 Agent 工作是在积累可验证能力，还是只在堆“看起来先进”的组件。

---

## 8. 结论

1. **单目 3D 是带训练先验的歧义推断，不是天然的真实空间测量。** 先用严格机位下可观察的 2D 人—杠铃相对轨迹建立基线；需要纵深时再用同步、标定的多目和独立 3D 真值。
2. **泛化层级必须显式。** 已见视频、同人新拍、新人同环境、跨环境是四种不同能力；“学会卧推”至少需要 subject-disjoint，新用户自由拍摄通常还需跨环境盲测。
3. **split manifest 比模型名字重要。** 帧随机切分、同人/同 session/派生数据跨 split 会制造虚假高分；测试集参与调参后不再是独立测试。
4. **动作质量不是从骨架自然长出来的。** 先有可观察、可重复标注的 phase/错误定义和标注者一致性，才有可训练和可验收的目标；不可见就应 unknown。
5. **可信 Agent 必须交付反证与证据链。** 主张—真值—split—指标—区间—失败切片—版本化产物缺一不可。演示视频、benchmark 引用和模型置信度都不能替代目标域盲测。

## 一手来源索引

- 相机几何与标定：[OpenCV calibration](https://docs.opencv.org/5.0/py_tutorials/py_calib3d/py_calibration/py_calibration.html)；[Zhang calibration](https://www.microsoft.com/en-us/research/publication/a-flexible-new-technique-for-camera-calibration/)
- 2D/3D 姿态：[COCO Keypoints](https://presentations.cocodataset.org/COCO17-Keypoints-Overview.pdf)；[VideoPose3D](https://openaccess.thecvf.com/content_CVPR_2019/papers/Pavllo_3D_Human_Pose_Estimation_in_Video_With_Temporal_Convolutions_and_CVPR_2019_paper.pdf)；[Human3.6M](https://pubmed.ncbi.nlm.nih.gov/26353306/)；[MPI-INF-3DHP](https://vcai.mpi-inf.mpg.de/3dhp-dataset/)；[3DPW](https://virtualhumans.mpi-inf.mpg.de/3DPW/)
- 跟踪：[PoseTrack](https://openaccess.thecvf.com/content_cvpr_2018/html/Andriluka_PoseTrack_A_Benchmark_CVPR_2018_paper.html)；[TAP-Vid/TAPIR](https://github.com/google-deepmind/tapnet)；[HOTA](https://www.cvlibs.net/publications/Luiten2020IJCV.pdf)
- 时序与健身数据：[MS-TCN](https://openaccess.thecvf.com/content_CVPR_2019/html/Abu_Farha_MS-TCN_Multi-Stage_Temporal_Convolutional_Network_for_Action_Segmentation_CVPR_2019_paper.html)；[FineGym](https://openaccess.thecvf.com/content_CVPR_2020/html/Shao_FineGym_A_Hierarchical_Video_Dataset_for_Fine-Grained_Action_Understanding_CVPR_2020_paper.html)；[Fit3D/AIFit](https://fit3d.imar.ro/)；[FLAG3D](https://openaccess.thecvf.com/content/CVPR2023/html/Tang_FLAG3D_A_3D_Fitness_Activity_Dataset_With_Language_Instruction_CVPR_2023_paper.html)
- 生物力学：[ISB JCS](https://pubmed.ncbi.nlm.nih.gov/11934426/)；[OpenSim inverse dynamics](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063)；[OpenCap](https://journals.plos.org/ploscompbiol/article?id=10.1371%2Fjournal.pcbi.1011462)；[barbell auto-tracking validation](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0263224)
- 泛化与审计：[WILDS](https://proceedings.mlr.press/v139/koh21a.html)；[Shortcut Learning](https://www.nature.com/articles/s42256-020-00257-z)；[GroupKFold](https://scikit-learn.org/stable/modules/cross_validation#cross-validation-iterators-for-grouped-data)；[calibration of neural networks](https://proceedings.mlr.press/v70/guo17a.html)；[NIST AI RMF](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)；[Model Cards](https://doi.org/10.1145/3287560.3287596)
