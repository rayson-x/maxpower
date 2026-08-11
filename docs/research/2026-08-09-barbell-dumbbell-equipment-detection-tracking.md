# 杠铃、哑铃与握点的移动端离线检测、追踪和骨架融合方案

日期：2026-08-09
范围：技术验证；不修改生产代码；目标平台为 PC Web 与 Android 离线推理，Rust 继续拥有主体、连续性、动作阶段和计数事实。

## 结论

建议把现有系统从“单一人体骨架模型”改造成：

```text
同一帧 RGB
  ├─ person + equipment detector（RTMDet-tiny 首选，YOLOX-Nano 备选）
  │    ├─ person bbox → RTMPose top-down ROI
  │    └─ weight plate / dumbbell / optional bar segment / handle observations
  ├─ RTMPose → 多个人体候选
  └─ 器械检测间隔帧 → 光流/Kalman/轻量关联补帧
                         ↓
Rust：主体锁定 → 器械轨迹锁定 → 手-器械关联 → 约束 IK
                         ↓
CanonicalLandmark(Measured/Fused/Predicted/Unknown) → 现有 RepEngine
```

首个杠铃卧推原型不要把“细杆检测”作为唯一入口。现有视频中杠铃杆细、与机架横杆/立柱重叠，而左右彩色杠铃片中心更明显、运动更稳定。因此首版证据优先级应是：

1. 左右**动态杠铃片中心、半径和同步轨迹**；
2. 可见的杠铃轴段及方向；
3. 骨架手腕到杆轴的投影握点；
4. 肩点、骨长和时间连续性约束恢复的肘点。

静态挂片、镜中杠铃和其他人的器械不能仅凭检测分数过滤；必须利用“与已锁定主体手腕的距离 + 左右同步运动 + 当前动作阶段 + 轨迹连续性”完成关联。证据仍有二义性时，应输出 `Unknown`，而不是猜测一次动作或给出姿势纠正。

推荐栈如下：

| 环节 | 首选 | 备选/用途 | 选择理由 |
| --- | --- | --- | --- |
| 训练框架 | MMDetection 中的 RTMDet-tiny | 原版 YOLOX-Nano | 二者许可友好；RTMDet 与现有 RTMPose/OpenMMLab 路线一致，YOLOX-Nano 更轻 |
| Web 推理 | 现有 `onnxruntime-web` | WebGPU/WASM 降级 | 仓库已经具备 ONNX Runtime Web 和 RTMPose 适配 |
| Android 推理 | ONNX Runtime Mobile 先打通 | ncnn INT8/Vulkan 作为性能路线 | ORT 可先复用同一 ONNX；ncnn 对 ARM、INT8 和 Vulkan 有官方支持 |
| 人体关键点 | 现有 RTMPose | MediaPipe Heavy 对照 | detector 提供真实 person ROI，修复非中心人物和丢失重捕获 |
| 器械几何 | plate/dumbbell detector + 自定义少量关键点 | 可选实例分割 | 移动端运行时以中心/轴/握点为主，mask 主要服务训练和标注 |
| 视频关联 | Kalman + 几何/主体条件关联 | ByteTrack 思路、稀疏 LK 光流 | 不额外引入 ReID 模型；遮挡时保留低分检测但不无条件接纳 |
| 标注加速 | Grounding DINO + SAM 2 离线预标 | 全部人工复核 | 开放词汇模型适合发现和传播标注，不适合首版端侧运行 |

## 1. 为什么不能只换一个通用骨架模型

卧推失败发生在“人看得见、模型肘腕回归失败”的条件下。器械同时带来强直线、圆形片、遮挡、镜面倒影和前臂透视缩短。另一个通用人体模型可能改善部分帧，但仍没有直接观察杠铃轨迹和握点，无法把错误的腕点变成可靠事实。

相反，器械观测给出了骨架缺失时最需要的外部约束：

- 杠铃片中心的纵向运动可以直接提供次数与相位；
- 杆轴或两片中心可以给出杠铃方向和中心；
- 手腕投影到杆轴可得到握点候选；
- 肩点 + 握点 + 标定骨长可以通过二维约束 IK 得到两个肘候选，再用上一帧、关节范围和左右一致性消除二义性。

如果肩点和握点同时不可靠，骨长方程仍然欠约束。此时只能继续追踪杠铃完成计数，不能声称可靠纠正肘角。

## 2. 现有代码审计与应该改变的 seam

### 2.1 RTMPose 当前缺少真正的人体检测器

[`src/pose/RtmposeEngine.ts`](../../src/pose/RtmposeEngine.ts) 是 top-down RTMPose，但当前没有独立 person detector：

- 首帧使用画面中央、85% 高度的假设框；
- 后续用上一帧高分关键点生成 bbox；
- 少于三个可靠点时又回到中央框。

这会让非中心主体、卧姿人物和丢失后的重捕获不稳定。共享的 `person + equipment` detector 不只是增加器械能力，也应成为 RTMPose 的 acquisition/reacquisition 入口。MMPose 官方 RTMPose webcam 示例本身就是 `RTMDet person detector → RTMPose` 的 top-down 管线，并提供 ONNX、ncnn、ARM 等部署路径。[MMPose 发布说明](https://github.com/open-mmlab/mmpose/releases)

### 2.2 RTMPose 当前绕过 Rust 多候选主体锁

当前 Web 路径只对 MediaPipe `PoseEngine` 调用 `estimateCandidates/processCandidates`；`RtmposeEngine` 只返回一个 `PoseEstimate` 并走单候选 `process()`。因此 RTMPose 目前没有利用 Rust 已有的多候选主体连续性。

改造后应当：

- acquisition/refresh：detector 输出多个 person bbox，对合格 bbox 分别运行 RTMPose，并返回 `PoseCandidateEstimate[]`；
- locked：仅对 Rust 选中的 person ROI 跑 RTMPose；
- reacquire：恢复多 person 检测，不能回到硬编码中心框；
- 镜中人仍作为候选输入，但由 Rust 主体连续性、真实人物历史与器械关联共同决策。

### 2.3 Rust 输入应容纳器械观测，但计数权威不能外移

当前 [`InferenceResult`](../../rust/motion-sdk/src/lib.rs) 只有 `Vec<PoseCandidate>`；`CanonicalLandmark` 已有 `Measured/Fused/Predicted/Unknown`、置信度和不确定度。这是合适的基础，但还缺器械证据。

建议下一版契约概念如下：

```rust
struct FrameObservations {
    pose_candidates: Vec<PoseCandidate>,
    equipment: Vec<EquipmentObservation>,
}

struct EquipmentObservation {
    proposal_id: u64,
    kind: EquipmentKind,
    bbox: NormalizedRect,
    keypoints: Vec<EquipmentKeypointObservation>,
    score: f32,
    uncertainty_px: Option<f32>,
    source: EquipmentSource, // Detector / OpticalFlow / Geometry / Predicted
    attributes: EquipmentAttributes,
}
```

`EquipmentAttributes` 至少包含 `is_reflection_candidate`、`is_static_rack_candidate`、`occlusion`、`truncation`；真实稳定 `track_id`、所属主体和左右手关联由 Rust 决定，不直接信任检测器逐帧序号。

约束 IK 恢复出的肘/腕必须写成 `LandmarkSource::Fused`，并增加明确 reason，例如：

- `EquipmentConstrainedInverseKinematics`
- `EquipmentTrackPrediction`
- `AmbiguousGrip`
- `MirrorAssociationRejected`

不能把融合结果伪装成模型直接测得的 `Measured`。

### 2.4 调度器不要扩展成组合枚举

现有 `InferenceScheduler` 返回单一 `InferenceRequest::{AcquireMulti, TrackTarget, RefreshCandidates, SkipFrame}`，主体锁定时默认 500ms 刷新一次多候选。人体 ROI 更新和器械检测是两条正交频率：人体可能要每个可用 inference tick 更新，器械 detector 只需约 5–10Hz，再由 tracker 补帧。

建议使用可组合计划，而不是继续增加 `AcquirePersonAndDetectEquipment` 等组合枚举：

```rust
struct InferencePlan {
    pose: PoseInferenceRequest,
    equipment: EquipmentInferenceRequest,
}
```

具体 5–10Hz 是原型目标，不是已验证性能结论；最终频率必须由 Android 真机延迟、热稳定性和轨迹误差共同决定。

## 3. 数据来源与许可证审计

### 3.1 可以直接利用的数据

| 数据 | 器械内容 | bbox | mask | 器械关键点 | track ID / 视频 | 动作标签 | 许可证与限制 | 结论 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Open Images V7 | 官方 600 个 boxable 类含 `Dumbbell`，MID `/m/04h8sr`；未含 `Barbell`、`Weight plate` 专项类 | 是 | `Dumbbell` 也在 350 个 segmentation 类中 | 否 | 否，静态图 | 否 | annotations CC BY 4.0；图片列为 CC BY 2.0，但官方要求逐图核验 | 适合哑铃外观 warm-start，不足以训练握点/轨迹/杠铃 |
| MM-Fit | 多个哑铃动作，包括肩推、划船、三头伸展、弯举、侧平举 | 否 | 否 | 否 | 有同步 RGB-D 视频，但无器械 track ID | 有动作/人体 2D、3D pose | Zenodo RGB/depth 记录为 CC BY 4.0 | 适合抽帧后自行标注端到端哑铃视频 |
| FLEX | 20 个负重动作，杠铃与哑铃各半；38 人、5 机位、7,500+ 多视角记录 | 未公开 | 未公开 | 未公开 | 有视频，未文档化器械 track ID | 有动作、关键步骤、错误和反馈 | 访问申请；官方仓库明确 academic only、禁止商业使用 | 研究/对照价值高，不应直接进入商业产品训练集 |
| SA-V | 类别无关的任意对象视频 masklets | 否 | 是 | 否 | 51K 视频、643K masklets | 否 | CC BY 4.0 | 可研究视频分割/标注传播；没有器械语义，不能直接替代专项数据 |
| 本项目 confirmed captures | 6 条杠铃卧推：front 3、oblique45 3，共 46 个标注 rep | 待标 | 待标 | 待标 | 有完整视频和 rep phase | 是 | 自有数据 | 足以做首个可行性 prototype，不足以证明泛化 |

Open Images 官方说明 V7 有约 1,600 万框、600 类和约 280 万实例 mask、350 类，annotations 为 CC BY 4.0，图片许可需要逐图确认。[官方说明](https://storage.googleapis.com/openimages/web/factsfigures_v7.html)；[`Dumbbell` boxable class list](https://storage.googleapis.com/openimages/v5/class-descriptions-boxable.csv)；[`Dumbbell` segmentation MID list](https://storage.googleapis.com/openimages/v7/oidv7-classes-segmentation.txt)。它是静态图数据，不提供视频 track ID 或本项目需要的器械几何。

MM-Fit 官方说明包含 20 个 workout session 的同步 RGB-D 视频、2D/3D pose，并明确列出多种哑铃动作。[MM-Fit 官方页](https://mmfit.github.io/)；[Zenodo RGB/depth 记录](https://zenodo.org/records/7607736)；[Zenodo 官方 API 许可证元数据](https://zenodo.org/api/records/7607736)。其开源仓库的 MIT 文件针对 software；视频数据使用应以 Zenodo 数据记录的 CC BY 4.0 为准。

FLEX 对目标域很有价值，但官方仓库明确要求申请，并写明仅限学术用途、禁止商业开发；项目页说明 20 个负重动作在杠铃/哑铃间各半。[FLEX 项目页](https://haoyin116.github.io/FLEX_Dataset/)；[官方数据访问说明](https://github.com/HaoYin116/FLEX_AQA_Dataset)。因此它可以作为研究 benchmark 或在许可允许的内部实验中使用，不能默认合入产品权重。

SAM 2 官方 SA-V 数据含 51K 视频和 643K 时空 masklets，数据是 CC BY 4.0；它没有器械类别语义。[SA-V 官方说明](https://github.com/facebookresearch/sam2/blob/main/sav_dataset/README.md)

### 3.2 现有 6 条杠铃视频够不够

够完成：

- 验证“动态杠铃片中心是否比肘腕可靠”；
- 微调一个预训练 detector/keypoint student，而不是从零训练；
- 验证 detector 是否同时修复 RTMPose 首帧/重捕获；
- 在已知 46 reps 上追求 46/46 exact count；
- 做 front 与 oblique45 两个机位的开发对照。

不够完成：

- 跨人、跨场地、跨杠铃/杠铃片外观泛化；
- 镜面和无镜面泛化；
- 哑铃检测；
- 多人、静态挂片、空杆、Smith 杆、器械把手的 hard-negative 覆盖；
- 独立准确率或发布结论。

按帧随机切 train/test 会因相邻帧高度相关而造成严重泄漏。即使开发期做 4 视频训练、1 验证、1 测试，也只能称为 video holdout，不能称为 user/equipment/site holdout。

## 4. 器械的标注和运行时表示

### 4.1 杠铃

首版运行时目标：

```text
BarbellGroup
  ├─ plate_left:  center + visible_radius + confidence
  ├─ plate_right: center + visible_radius + confidence
  ├─ shaft: optional visible segment endpoints + confidence
  ├─ derived_center / axis
  └─ grip_left / grip_right: derived or measured, with uncertainty
```

推荐做法：

- detector 检测每个 `weight_plate`，不在模型输出中硬编码 left/right；左右和所属杠铃由 Rust 轨迹关联决定；
- 两片同步运动时，中心中点和连线给出杠铃中心/轴；
- 只看见一片时，使用该片轨迹 + 历史杆轴，不应无条件镜像补出另一片；
- 细杆只标“可见杆轴段端点”，不要要求标完整杆轮廓；
- 静态挂片必须完整标注为 `is_static_rack=true` hard negative，不能从训练集删掉；
- 镜中杠铃完整标注实例和 `is_reflection=true`，而不是把反射当背景随意忽略。

### 4.2 哑铃

每只哑铃单独一个实例：

```text
DumbbellInstance
  ├─ bbox / optional mask / optional rotated bbox
  ├─ handle_endpoint_a, handle_endpoint_b
  ├─ handle_center（可由端点派生）
  ├─ head_center_a, head_center_b
  ├─ long_axis
  └─ held_by_subject + hand(left/right/unknown)
```

检测 box 用于 acquisition，handle/head keypoints 用于握点和方向。实例 mask 对重叠哑铃、背景器械和标注传播有帮助，但首版移动端不应为 mask head 付出成本，除非 box+keypoint 的 held-hand association 无法通过验收。

Open Images 产品图和自然场景可以提供外观 warm-start，但健身动作里的哑铃常被手遮挡、运动模糊、透视旋转且成对交叉，必须用 MM-Fit 和自采动作视频继续微调。

### 4.3 固定器械把手

先复用同一 schema：`machine_handle` bbox + 轴端点/中心 + pivot 可选。它不应和哑铃共用动作轨迹 profile；固定器械可能有两条独立但约束运动的把手轨迹，关联需要设备组 id。

### 4.4 COCO 风格视频扩展 schema

训练文件使用 COCO image/annotation/category 主体格式，增加以下字段：

```json
{
  "video_id": "...",
  "frame_index": 123,
  "timestamp_ms": 4100,
  "track_id": "...",
  "equipment_group_id": "...",
  "category": "weight_plate | dumbbell | bar_segment | machine_handle | person",
  "keypoints": ["x", "y", "visibility"],
  "attributes": {
    "is_reflection": false,
    "is_static_rack": false,
    "occlusion": "none | partial | heavy",
    "truncated": false,
    "held_by_subject_id": "...",
    "hand": "left | right | both | unknown",
    "annotation_source": "human | teacher_verified"
  }
}
```

MMPose 官方支持把自定义关键点数据组织为 COCO 格式，定义任意 `keypoint_info`、`skeleton_info`、权重和 OKS sigma，适合训练器械关键点 RTMPose head。[MMPose 自定义数据官方文档](https://github.com/open-mmlab/mmpose/blob/main/docs/en/advanced_guides/customize_datasets.md)

每个视频的 metadata 还要记录：`subject_id/session_id/site_id`、机位 yaw/pitch/高度/距离、front/oblique45、镜面区域、设备类型与外观、分辨率/FPS、set 和 rep phase 时间边界。所有 split 必须按 subject/session/site/equipment 分组，禁止按帧随机拆分。

## 5. 视频追踪、遮挡和镜面处理

### 5.1 推荐时序

- camera 帧：30fps 或实际时间戳；
- detector：目标 5–10Hz；锁定失败、协方差升高或镜面二义时下一帧提前重检；
- plate/handle keypoints：在 detector 间隔使用 pyramidal LK optical flow 或局部模板跟踪；
- Kalman：维护中心、速度、轴方向、尺度和协方差；
- Rust：根据真实 timestamp 组合轨迹，不使用固定“帧数间隔”作为动作时间。

ByteTrack 的核心价值是不要丢弃所有低分检测，而是用已有 tracklet 关联低分框以恢复遮挡目标；官方实现是 MIT，并可接不同 detector。[ByteTrack 论文](https://arxiv.org/abs/2110.06864)；[官方仓库](https://github.com/FoundationVision/ByteTrack)。但它是在通用多目标框追踪上提出的，不能直接假定适用于细杆、交叉哑铃和镜面。首版应借用它的两阶段高/低分关联思路，并增加主体、手腕、轴方向和同步运动代价。

建议关联 cost：

```text
cost = bbox/center continuity
     + axis/scale continuity
     + distance to locked subject wrist(s)
     + motion correlation with paired plate or opposite hand
     + phase plausibility
     + reflection/static penalties
```

### 5.2 镜面和静态器械

- 画面最大/最清晰候选不一定是真人或真实杠铃，不能使用 dominance 单独决策；
- 先锁定真实主体，再选择与该主体双腕最近且运动同步的器械组；
- 镜像人/器械和静态挂片都作为显式 hard negatives 标注；
- `is_reflection` 可以由模型给 proposal，但最终 rejection 依赖时间与主体关联；
- 单目条件下仍可能无法区分真实/镜像，二义持续超过容忍窗口时输出 Unknown，禁止切轨后继续计数。

## 6. 握点推断和骨架融合

### 6.1 杠铃握点

1. 用两片中心或 shaft endpoints 求杆轴线段；
2. 将人体 left/right wrist 投影到杆轴；
3. 投影必须位于两内侧杠铃片之间，并满足 wrist-to-axis 最大距离；
4. 两握点应维持顺序、间距和时间连续性；
5. 如果使用 MediaPipe 手部附加点，可用 wrist/index/pinky 的掌心几何改善握点；RTMPose COCO-17 只有 wrist 时降低置信度；
6. 输出握点置信度取器械置信、腕点置信、投影残差和轨迹一致性的组合下界。

### 6.2 哑铃握点

- handle 可见：手腕投影到 handle segment；
- handle 被手遮挡但两个 head center 可靠：以二者中点和轴作为 `Fused` handle；
- 两只哑铃交叉或靠拢时，优先维持与左右手的历史绑定；无法区分时 `hand=unknown`，不交换 track id。

### 6.3 肘点 IK

已知肩点 `S`、握点 `G`、大臂长度 `L1`、前臂长度 `L2` 时，肘点是两个圆的交点候选。选择依据依次为：上一可靠肘点、关节活动范围、左右对称/合理差异、杆轴方向和当前相位。

输出必须包含不确定度；两个解都合理或输入端点低置信时，不生成姿势纠正。杠铃轨迹仍可用于计数，但不能把“杠铃完成一次”宣传为“肘关节动作标准”。

## 7. 模型、许可和移动端预算

### 7.1 首选 RTMDet-tiny

MMDetection 是 Apache-2.0；官方 RTMDet-tiny 640 配置为 4.8M 参数、8.1 GFLOPs，并支持静态 ONNX 转换。COCO 指标只是通用检测参考，不代表器械场景准确率。[RTMDet 官方模型表与部署说明](https://github.com/open-mmlab/mmdetection/tree/main/configs/rtmdet)；[MMDetection 许可](https://github.com/open-mmlab/mmdetection)

优势：

- 与现有 RTMPose/MMPose 工具链一致；
- 一个 detector 同时输出 person、plate、dumbbell、bar segment、handle；
- person bbox 同时解决 RTMPose acquisition/reacquisition；
- 可后续增加 RTMDet-Ins，但首版不需要移动端 mask head。

### 7.2 轻量备选 YOLOX-Nano

原版 YOLOX 是 Apache-2.0；官方 YOLOX-Nano 为 0.91M 参数、1.08 GFLOPs、416 输入，并列出 ONNX、ONNX Runtime 和 ncnn 部署。[YOLOX 官方仓库与模型表](https://github.com/Megvii-BaseDetection/YOLOX)

它的 weights-only 理论体积约为 FP32 3.6MB、INT8 0.9MB；RTMDet-tiny 理论约为 FP32 19.2MB、INT8 4.8MB。实际 ONNX/ncnn 文件还含图结构、常量和对齐，必须以导出物为准。YOLOX-Nano 可能难以学习细杆，所以其首版目标同样应是 plate center/dumbbell/person，而不是只检测杆轴。

### 7.3 为什么不以开放词汇模型作为端侧 detector

Grounding DINO 的官方实现为 Apache-2.0，可通过文本提示快速发现 `barbell / dumbbell / weight plate` 候选；SAM 2 的模型和训练代码也是 Apache-2.0并支持视频对象 mask 传播。[Grounding DINO 官方仓库](https://github.com/IDEA-Research/GroundingDINO)；[SAM 2 官方仓库](https://github.com/facebookresearch/sam2)

它们适合离线预标和 active learning，不适合第一版移动端常驻：模型和文本/视频记忆管线明显重于 0.9M–4.8M 的专项 student，并且开放词汇类别仍不给出握点和目标主体绑定。所有 teacher 标注必须人工复核。

Ultralytics 当前官方仓库是 AGPL-3.0，并提示商业用途申请 enterprise license；除非完成许可证决策，不应作为默认产品训练/运行栈。[Ultralytics 官方仓库](https://github.com/ultralytics/ultralytics)

### 7.4 Android/Web 部署

ONNX Runtime Mobile 官方支持 Android CPU、XNNPACK、NNAPI；官方建议量化模型先从 CPU EP 开始，非量化模型先测 XNNPACK，并以真机测 binary size、model size、latency 和 power。8-bit weights 通常使权重约缩小 4 倍，但准确率必须重新评估。[ORT Mobile 官方文档](https://onnxruntime.ai/docs/tutorials/mobile/)

ncnn 是 BSD-3-Clause、无第三方 runtime 依赖，支持 ARM NEON、Vulkan、FP16 与 INT8，并可由 ONNX/PyTorch 转换。[ncnn 官方仓库](https://github.com/Tencent/ncnn)。MMDeploy 官方平台矩阵也列出 Android ARM CPU/ncnn 和 Android Adreno GPU/ncnn，并支持 MMDetection/MMPose。[MMDeploy 官方仓库](https://github.com/open-mmlab/mmdeploy)

建议路径：

1. Web 先用现有 ONNX Runtime Web 完成准确率 prototype；
2. Android 先复用静态 ONNX + ORT Mobile，验证接口和真机预算；
3. 同一 golden corpus 比较 FP32/FP16/INT8；
4. 只有 ORT 未达标时再转换 ncnn，避免一开始同时维护两个未经验证的模型后处理。

## 8. 两阶段原型计划

### 阶段一：杠铃卧推可行性与共享 detector

目标：利用已有 6 视频/46 reps，在 PC Web 完成 detector、tracker、Rust sidecar replay，随后 Android 离线验证。

数据：

- 每个 rep 标 8–12 个相位帧，加 set 前后、卸杠/挂片、停顿和遮挡帧，预计约 500–800 个正负关键帧；
- 每条视频另标至少三个连续 1 秒片段，用于 track ID switch、光流漂移和镜面切轨评估；
- 全部标 person、真实/镜像、动态/静态 plate、optional bar segment、手腕关联；
- video-wise 4/1/1 开发拆分；报告中明确不是独立泛化测试。

实现切片：

1. 标注 plate centers/radii、person bbox、静态挂片和镜像 hard negatives；
2. 训练 RTMDet-tiny；并行训练/导出 YOLOX-Nano 只作为手机预算对照；
3. detector person bbox 接入 RTMPose，使 RTMPose 返回多 `PoseCandidateEstimate[]`；
4. detector 5–10Hz，plate center 用 LK/Kalman 补帧；
5. Rust 新增 EquipmentObservation、主体条件关联、杠铃中心轨迹；
6. 先用杠铃轨迹做 phase/count；之后才启用 grip + IK 恢复肘点；
7. 生成同一套 Web/Android/Rust replay golden sidecar。

阶段一通过并不意味着可以支持通用杠铃动作，只证明当前卧推机位和器械的技术可行性。

### 阶段二：哑铃与跨域泛化

数据：

- Open Images `Dumbbell` box+mask 作为外观 warm-start，并逐图核验图片许可；
- 从 MM-Fit 哑铃动作中按视频抽帧，补标 bbox、handle/head keypoints 和 track ID；
- 自采至少包含多用户、多哑铃外形/颜色、front/oblique45、镜面/无镜面、交叉/靠拢、过顶、落地和背景器械；
- 新杠铃数据必须补不同人、不同片色/大小、空杆、Smith、背景静态挂片和多人。

实现：

- detector 增加 `dumbbell`；
- 如 box 中点不够可靠，再增加独立 RTMPose-style equipment keypoint head；
- hand association、交叉时 track continuity、handle occlusion fusion；
- 最终按 person/site/equipment 全部留出评估。

FLEX 可以在获得许可后做非商业研究对照，但不能替代可用于产品的自有/许可明确数据。

## 9. 验收指标

不能只看 detector mAP；必须同时通过观测、轨迹、动作和真机四层指标。

### 9.1 已知开发语料硬门槛

- 当前 6 条杠铃视频：46/46 reps exact，6/6 sets 整组完全对齐；
- 所有人工标注 rest/负区间：0 false rep；
- 每组 0 次 reflection takeover、0 次 static-rack takeover；
- 每组 equipment track ID switch = 0；
- RTMPose 不再因主体非中心或丢失回中心框而永久失去真实主体；
- 任何 IK 恢复点都可追溯为 `Fused`，二义帧没有纠正 cue。

这是 in-sample/dev gate，不是泛化准确率。

### 9.2 留出数据门槛

- person acquisition recall ≥99%；
- 活跃 rep 窗口 plate/dumbbell center 有效覆盖 ≥98%；
- plate/handle center NME ≤5% shoulder width；
- 器械 track ID switch ≤0.1/组，且 reflection/static takeover 必须为 0；
- set exact count ≥95%，rep precision 与 recall 各 ≥98%；
- 握点/肘纠正单独报告 coverage 和误差，不能用计数通过率替代；
- 无法观测时的 `Unknown` 精度单独审计，禁止用长时间预测提高表面 coverage。

95% 只适用于真正按人、场地、器械实例留出的集合；不能用相邻帧或同一次 session 的切分声称达到。

### 9.3 移动端门槛

- detector 实际 5–10Hz，融合 equipment trajectory ≥15Hz；
- camera → fused observation p95 目标 <100ms，且不得出现 >200ms 的未标记证据空洞；
- 连续 8 分钟和两节连续 16 分钟分别测 FPS、p95 latency、内存、温升/降频和电量；
- FP32/FP16/INT8 都在同一 golden corpus 上回放；量化后已知语料 exact count 不得变化，留出 detection/track 指标下降不得超过 1 个百分点；
- 低、中、高至少三档真实 Android 设备评估；不能用桌面 ONNX 或旗舰单机结果替代。

这些数值是工程验收目标，不是当前已测结果。若 RTMDet-tiny 达不到预算，先降 detector 频率/输入和测试 YOLOX-Nano，再决定是否牺牲模型准确率；不应未经测量就把低质量器械轨迹交给计数器。

## 10. 最终建议

立即执行的最短路径：

1. 用现有 6 条卧推视频标动态杠铃片中心、静态挂片、镜像和 person bbox；
2. 训练一个 `person + weight_plate + optional bar_segment` 的 RTMDet-tiny；
3. 让 detector 同时为 RTMPose 提供多 person ROI，消除中心框假设并接回 Rust 多候选主体锁；
4. detector 低频运行，plate center 由光流/Kalman 补帧；
5. Rust 接受 EquipmentObservation，先实现器械轨迹计数，再实现握点和 IK；
6. 当前 46 reps 必须先做到 46/46 exact、负区间零误计，再扩展哑铃；
7. 哑铃使用 Open Images warm-start + MM-Fit/自采视频专项标注；FLEX 仅作许可受限的研究参考。

这条路线的关键不是“再加一个模型”，而是增加一个深的器械观测与融合模块：上层仍只消费 Rust 的 canonical landmarks、phase 和 sealed reps，不需要在 Web/Android 分别维护卧推计数逻辑。
