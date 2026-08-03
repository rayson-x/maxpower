# 人工整组次数导出：动作识别与轨迹库的可用性评估

日期：2026-08-03  
范围：`/Users/Ruihan/Documents/power/field-capture-approvals-2026-08-03.json`、项目中与之同 ID 的视频/`canonical pose`，以及当前 Web 分段代码。本文是研究结论，不修改客户端算法。

## 结论先行

这批数据**已经可以开始优化“某组视频里有多少次”的识别能力**，但不能称为已完成的“轨迹训练集”，更不能用于学习或判定正确动作。

原因很具体：导出中有 39 组人工填写的动作、机位和整组实际次数（共 380 次），但 `approvals` 为 0、39 组都仍是 `drafts`，全部 `draftSegments` 为空。因此它提供的是 **set-level count label（整组弱监督）**，而不是每次动作的 `start / peak / end` 真值。它可以校准计数器的参数和比较算法版本；它不能监督边界检测，也不能把任何训练者的动作轨迹当成标准模板。

第一步应实现并离线验证一个“**多特征运动学周期计数器**”：检测一个完整的 A→B→A 周期才计一次，用人工整组次数选参数。首个真正的轨迹库仍应从高位下拉开始，但必须在审核页逐 rep 批准边界后再写入；不要用这 39 组的自动切段伪造轨迹真值。

## 导出盘点

导出版本为 `capture-approval/v2`，时间为 `2026-08-03T10:59:04.738Z`。39 个 capture ID 都可在项目中找到保存的 canonical pose JSON；21 组另有 metadata，30 组有历史 labels sidecar。历史 sidecar 不是人工真值，不纳入本结论的标签来源。

| 动作 | 人工整组次数 | 组数 | `cameraView` / 实体机位 | 当前可作的用途 |
| --- | ---: | ---: | --- | --- |
| 杠铃划船 | 68 | 7 | front/front ×1；front/rearLeft45 ×1；front/rearRight45 ×2；oblique45/frontLeft45 ×2；oblique45/frontRight45 ×1 | 弱监督计数校准；机位过于分散，不能合并成一条轨迹 |
| 高位下拉 | 28 | 4 | front/rear ×1；front/rearLeft45 ×3 | 可作为第一个“逐 rep 审核”的轨迹库桶；仅四组，尚不能自动学习参数 |
| 侧平举 | 67 | 7 | front/front ×7 | 当前最完整的单机位弱监督桶；适合先做离线参数选择 |
| 坐姿推肩 | 44 | 6 | front/front ×6 | 可作为第二个弱监督桶；动作/机位不应同侧平举混训 |
| 后束飞鸟 | 50 | 4 | front/front ×4 | 当前 profile 只支持 oblique45；其中两组明确记录手腕落点未拍到，先隔离 |
| 单臂绳索侧平举 | 70 | 4 | front/front ×4 | 中途换边且画面由前转后；应先拆成左右/机位连续片段，不能作为一个静态机位样本 |
| 直臂下拉 | 24 | 3 | oblique45/frontLeft45 ×1；oblique45/frontRight45 ×2 | 弱监督计数校准；样本小 |
| 坐姿划船 | 16 | 2 | front/rearLeft45 ×1；oblique45/frontLeft45 ×1 | 仅作保留验证，不调参 |
| 引体 | 5 | 1 | front/rearLeft45 ×1 | 仅作保留验证，不调参 |
| 未标动作 | 8 | 1 | side/right ×1 | 必须先补动作标签 |

**39 组 / 380 次**都保留，但不同质量状态必须分桶：

- 39 组中没有一组有逐 rep 边界，故可用于 count loss，不能用于 boundary loss、DTW template 或 trajectory prototype。
- 四组单臂绳索侧平举含“中途转身、从左手换到右手”的备注；必须切成两个稳定片段、带 `side` 和实体机位，再进入任何训练/评估。
- 两组后束飞鸟明确“机位过高，手腕落到底未录到”；不可插值补臂，也不可作为轨迹库样本。
- 一组侧平举标记为力竭后变形、两组杠铃划船标记左右不平衡、一组杠铃划船帧数低、一组引体末段力竭。这些都是**真实训练观测**，可以保留用来测试计数鲁棒性，但绝不可作为“标准姿势”参考。
- 物理 `capturePosition` 比粗粒度 `cameraView` 更重要。现有数据中“front”粗粒度视角下含 rear、rearLeft45 等实体机位；镜像显示也不得写入 pose 坐标。训练与评估必须按 `exerciseId + capturePosition + coordinateSystem` 分桶。

## 当前基线：有价值，但不能过度解读

以导出中的人工整组次数为标签，把同一份项目 canonical pose 传入当前 `analyzePoseSet()` 进行离线重放：38 组有动作名中，当前版本精确命中 13/38，MAE 为 4.13。这个总数不能直接作为产品准确率：四组单臂绳索侧平举没有当前 profile，四组后束飞鸟的 front 机位也不在当前 profile 的支持范围，都会自然输出 0。

仅看当前 profile 声明支持的 30 组（252 次），基线为：精确命中 13/30、MAE 1.23；12 组多计、5 组少计。按动作的重放摘要如下：

| 动作 | 组数 | 当前 MAE | 精确命中 | 解释 |
| --- | ---: | ---: | ---: | --- |
| 侧平举（front/front） | 7 | 0.29 | 5/7 | 最适合先以整组次数做参数选择 |
| 高位下拉 | 4 | 0.50 | 2/4 | 已表现为轻微多计；样本量不足以学习，适合优先补逐 rep 边界 |
| 直臂下拉 | 3 | 0.00 | 3/3 | 保留为未参与调参的回归集 |
| 坐姿推肩 | 6 | 2.50 | 1/6 | 需先做多特征周期门，不能只调一个阈值 |
| 杠铃划船 | 7 | 2.00 | 2/7 | 机位与左右不平衡混杂，按实体机位拆分 |
| 坐姿划船 | 2 | 1.50 | 0/2 | 数据不足，保留验证 |
| 引体 | 1 | 1.00 | 0/1 | 数据不足，保留验证 |

这只是同一位训练者、同一采集环境的回放，不代表新用户、新设备或正确姿势的表现。它证明现有整组标签足以发现和量化多计/漏计，不证明任何动作轨迹“正确”。

## 首个增量算法：弱监督校准的多特征周期计数器

不建议当前微调深度网络，也不建议采用 DTW 模板。DTW 的原始定义就是将观测序列与一个参考模式对齐；若把某条训练录像当参考，就会把“这位训练者当时怎么做”误变成“正确动作”。[Sakoe–Chiba 原始论文](https://doi.org/10.1109/TASSP.1978.1163055)

推荐的 v1 计数器只学习**周期的可观测性、幅度、节律和边界**，不学习姿势优劣：

1. **可用帧门。** 从与渲染、录制、导出完全相同的 canonical pose 读取 33 个 landmark、world landmark 和 visibility；按真实 `timestampMs` 处理，保留断帧而非补点。MediaPipe 官方说明输出含 image/world coordinates 与每点 visibility，且 VIDEO 推理按视频帧和 timestamp 处理。[Pose Landmarker Web 文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)
2. **按动作/实体机位选 2–4 个运动特征。** 全部相对躯干尺度归一化：主相位信号、一个相关关节角、其速度/方向、躯干漂移和关键点可见度。例如高位下拉用手腕相对肩的高度、肘角、手腕高度速度、躯干横移；侧平举用肩角、手腕相对肩横向/垂直位移、躯干漂移。每个特征必须明确左右侧与使用的坐标系。
3. **滤波但不造点。** 对连续、可用样本作时间感知的轻量低通/1€ 平滑；缺失、低 visibility 或长时间间隔立即中断候选。MediaPipe 源码把 landmark smoothing 定义为跨帧稳定化组件，而不是丢失 landmark 的语义修复。[LandmarksSmoothingCalculator 源码](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/landmarks_smoothing_calculator.cc)；1€ filter 的设计目标是低速减抖、高速降低延迟。[Casiez 等原始说明与论文](https://gery.casiez.net/1euro/)
4. **状态机，而非“一个拐点算一次”。** `idle → armed-at-A → traveling-to-B → dwell-at-B → returning-to-A`；只有完整 A→B→A 才发出一次 rep。端点要同时满足主信号滞回、速度死区、最小幅度、最短/最长时间和多特征同向性。人从镜头走到器械、调整姿势时保持 `idle`。该设计与在线重复计数需先判断周期性/开始停止而非假定整个视频全是动作的观察一致。[Levy & Wolf，ICCV 2015 原始论文](https://openaccess.thecvf.com/content_iccv_2015/html/Levy_Live_Repetition_Counting_ICCV_2015_paper.html)
5. **轨迹一致性只做“待审核”证据。** 将候选 rep 的多特征向量重采样（如 32 点）后，仅与本组近期已接受 rep 的鲁棒中位数/IQR 比较。若幅度、持续时间、特征相关性或躯干漂移偏离，标 `needs_review`，不要静默少计，也不要给出“姿势错误”结论。多维运动学参数、速度过零和合并多个候选是有先例的分段路径；原研究也特别指出阶段停顿会产生多个候选边界，需要后续整合。[Wang et al., *Unsupervised Temporal Segmentation of Repetitive Human Actions*, 原始论文](https://arxiv.org/abs/1512.04115)

### 用这份导出“训练”什么

对每一个 `exerciseId + capturePosition` 桶离线网格选择以下**计数参数**：平滑强度、速度死区、端点滞回比例、最小 ROM、dwell、最短/最长周期和多特征一致性门。给定一组录像，计数器独立输出 `predictedCount`，再以人工 `expectedCount` 计算 `abs(predictedCount - expectedCount)`。

参数选择须遵守：

- 每次留出一整组录像做验证（不得把同组的帧或 rep 同时放进调参与验证）。
- 参数是“动作 + 实体机位”的共享配置，绝不能为某个视频/次数量身定制。
- 只有同一桶至少约 5 组且约 50 次时才允许选择专用参数；不足时保留人工先验并只报告结果。当前满足这个量级的是侧平举 front/front（7 组、67 次）；坐姿推肩 front/front 为 6 组、44 次，接近但仍应作为探索性结果。高位下拉的 rearLeft45 只有 3 组、20 次，**不能**做自动参数学习。
- 这份导出里的字段仍是 draft；导入后应显示为“人工整组标签，待批准”，在明确批准前不要写进不可变训练库。

这就是一种有限、可解释的弱监督：标签只告诉算法“这组应有 N 个完整周期”，不告诉算法某一帧的姿势应长什么样，也不把 N 个候选的具体轨迹宣布为正确。

## 轨迹库的正确下一步：从高位下拉补边界

高位下拉可以先行，但它应是**边界标注流程**，不是用四组数据训练模型：

1. 在审核页导入四组，显示 v1 计数器的候选 A/peak/B 以及可见度/缺帧条。
2. 审核者对每次真正完成的 rep 选择或修正 `startMs / peakMs / endMs`，并批准；底部手臂消失、走入画面、半程停顿或无从判断的片段标为 `unknown`/`exclude`，不强填。
3. 仅保存通过覆盖率、时间连续性、实体机位和边界顺序校验的向量为 `rep_segmentation_observation`；同时固定 `formReference: not_labeled`。
4. 收集至少 10–20 组、多个节奏和明确的干扰片段后，才可把轨迹一致性由“仅提示”升级为“拒绝并送审核”。仍不得把它升级成 form score。

## 验收与报告口径

在有且只有整组次数标签的阶段，报告：

- 以整组为单位的 MAE、中位绝对误差、精确命中率；多计率和漏计率必须分开报告。
- `unknown/needs_review` 比例；低可见度、进出画面、机位错误、力竭/换边分别分层。计数器不得用静默丢弃换取表面准确率。
- 固定 baseline 与候选版本，在完全相同的 capture-level 留出切分上比较；直臂下拉可先作为不参与调参的回归集。
- Web 实时延迟、主线程阻塞和掉帧率。官方文档明确 `detectForVideo()` 同步阻塞主线程，生产实现应移到 Web Worker 或降低推理频率；计数器依真实时间戳工作，绝不可依赖固定帧率。[MediaPipe Web 文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)

待有逐 rep 边界后，才增加边界指标：在人工批准的 `start / peak / end` 周围设定预先声明的时间容差（建议 `min(250 ms, rep 时长的 15%)`），报告 boundary precision/recall/F1、峰值 MAE 和每组 count error。阈值必须在评估前固定。

## 产品与安全边界

- **计数不等于动作质量。** 本文算法只判断“一个可观测运动周期是否完成”；不能说动作标准、不能用于医疗/康复建议，也不能因幅度小或力竭变形而自动否认训练次数。
- **不插值伪造丢失肢体。** 对低 visibility、时间缺口或机位遮挡，输出 `unknown`/待审核；平滑只能降抖。
- **不混合机位、左右和镜像。** 必须保留实体机位、side 与 source-image 坐标；中途换边的视频必须分段。
- **不宣称泛化准确率。** 当前数据来自有限环境与训练者；未按人员、设备、机位独立验证前，任何“准确率”都只适用于这批回放。
- **输出一致性不变。** 渲染骨架、客户端计数、保存的 pose、审核证据和离线回放必须读取同一 canonical frame 序列；不得另用服务端或镜像后的数据给出不同结果。

## 建议实施顺序

1. 导入这份 JSON 为“人工整组次数弱标签”，不自动升级为批准的边界真值。
2. 为侧平举 front/front 实现离线参数搜索与 capture-level 留一验证；将直臂下拉留作回归检查。
3. 为高位下拉实现审核候选、边界持久化和 `unknown` 标记，累积逐 rep 真值后再建立首个轨迹数据库桶。
4. 将同一计数器逐动作/机位推广到坐姿推肩、划船等；后束飞鸟和单臂绳索侧平举先解决机位/分段定义，再比较算法。

