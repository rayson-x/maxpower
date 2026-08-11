# 卧推场景骨架追踪失败的改造方案与替代模型评估

日期：2026-08-09  
范围：正面杠铃卧推、固定器械上斜卧推等仰卧/半仰卧场景；移动端离线推理；Rust SDK 继续作为主体追踪、连续性、动作状态与计数的唯一事实来源。

## 结论

当前问题不能简单归因于“视频里看不见手臂”，也不能靠降低 MediaPipe 置信度阈值解决。视频像素中手臂可见，但 MediaPipe Heavy 在正面仰卧、前臂沿相机光轴缩短、杠铃与器械遮挡、镜面出现第二个人形等条件叠加时，对肘和腕的定位会发生错误推断。低置信坐标并不是稍差的真值：在现有两条卧推视频中，强行接纳这些坐标会产生 8 次和 6 次伪周期，而人工标签均为 4 次。

最合适的改造不是立即替换整个骨架栈，而是按以下优先级推进：

1. 用当前 Rust 动态主体连续性重新提取失败视频，淘汰旧页面“整段固定 `candidateIndex`”的侧车数据。
2. 在完全相同的 RGB 帧和 Rust 计数器上，对 MediaPipe Heavy、RTMPose Body26、MoveNet Thunder 做离线 bakeoff。
3. 对卧推增加“人体骨架 + 杠铃/握点轨迹 + 骨长约束”的动作专用融合。正面机位以杠铃位移作为计数主信号，骨架用于主体、躯干和安全条件确认。
4. 若通用 RTMPose 仍无法稳定输出肘腕，则用卧推目标域数据微调 RTMPose-t/s，并单独训练轻量杠铃/握点检测器；不要继续堆阈值规则。
5. 正面机位若只能可靠看到杠铃轨迹，应只宣称“次数/节奏识别”；需要肘角、杠铃相对胸线和左右对称纠正时，要求 30–45° 斜前机位，或让可靠的设备观测参与融合。

## 已确认的失败机制

### 1. 像素可见不等于模型观测可靠

MediaPipe Pose 使用 detector + tracker 两阶段管线：检测器先确定人体 ROI，随后 landmark tracker 在裁剪后的 ROI 内回归关节点；只有追踪失败时才重新检测。其 `visibility` 表示模型认为关节点可见/未被遮挡的可能性，不是“这个像素是否存在”的客观判定。[MediaPipe Pose 官方说明](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)

卧推正面机位具有四个困难：

- 大臂与前臂存在强透视缩短，二维肘角对深度误差极敏感；
- 杠铃、握手和机架构成长直线及局部遮挡；
- 仰卧人体的朝向和训练集常见站立人体差异大；
- 镜面同时包含真实主体、倒影和杠铃倒影，可能影响人体检测和 ROI 连续性。

因此，肩点保持高置信而肘腕同时掉到极低置信，是 landmark 回归失效，而不是肢体真的离开画面。

### 2. 降低阈值会把错误坐标变成错误次数

现有两条失败视频的低置信肘腕坐标形成了明显错误轨迹。把它们的可见度强行提高到 0.5 后，当前计数逻辑分别产生 8 次和 6 次，而人工标注均为 4 次。世界坐标中的估算前臂长度也在约 0.03–0.35 m 间异常漂移，说明这些点不满足人体刚性骨段约束。

所以“置信度低时继续追踪”只适合短时、受约束预测；不能把低置信模型输出直接当作测量值。

### 3. 旧侧车存在固定候选人索引风险

旧的 `public/harness/archive-capture.html` 先对候选数组中的每个序号打分，再为整段视频固定使用一个 `candidateIndex`。多姿态检测器逐帧返回的数组序号不是稳定身份；镜面或多人物时，第 0/1 个候选可能换人。

当前 `src/pose/inboxVideoPoseExtractor.ts` 已经把每一帧的全部候选交给 `RustCanonicalWasmSession.processCandidates`，由 Rust 根据连续性选择主体。这才是应当用于重新生成和评估侧车的路径。重新提取可能不能单独修复肘腕回归，但它能先消除数据管线中的身份混淆变量。

## 替代骨架方案

| 方案 | 适合程度 | 优点 | 限制与判断 |
|---|---:|---|---|
| RTMPose-t/s/m Body26 | 首选 bakeoff | Apache-2.0；17/26 点；可微调；官方提供 ONNX、ncnn、ARM 和 Android 部署路径 | 公开数据集分数不能证明可解决卧推；仍须在同一视频盲测和目标域微调 |
| MoveNet Thunder | 对照基线 | 官方 TFLite；256 输入；17 点；手机部署简单 | 点数更少、没有 BlazePose world landmarks；适合作为独立模型对照，不是最可能的最终方案 |
| MediaPipe Heavy | 保留基线 | 33 点、移动端成熟、当前三端已有接入 | 当前失败已说明仅提高模型复杂度不够；ML Kit 也使用 BlazePose 家族，不构成真正独立替代 |
| 3D lifting（VideoPose3D/RTMW3D 等） | 暂不优先 | 可在可靠 2D 输入上补时间与深度先验 | 错误的 2D 肘腕仍是错误证据；计算更重、延迟更高，不能从欠约束观测恢复唯一真值 |
| 通用 YOLO Pose | 不作为默认 | 可导出多种移动端格式，也可自定义训练 | Ultralytics 默认 AGPL/商业许可路径需要单独处理；相对 RTMPose 没有足够优势 |

OpenMMLab 官方发布说明列出了 RTMPose 的 17/26 点人体模型以及 ONNX、ncnn、ARM、PoseTracker Android 演示；MMDeploy 的官方矩阵支持 MMPose 在 Android ARM CPU 上使用 ncnn，并可在 Adreno GPU 上使用 ncnn/SNPE。[MMPose 发布说明](https://github.com/open-mmlab/mmpose/releases) [MMDeploy](https://github.com/open-mmlab/mmdeploy)

MoveNet 官方提供 Lightning 与 Thunder 两类模型；Thunder 面向更高精度，TFLite 版本使用 256 输入并输出 17 个关节点。它适合快速建立一个不属于 BlazePose 家族的对照，但不能仅凭官方通用描述推断其在仰卧镜面场景更好。[MoveNet 官方教程](https://www.tensorflow.org/hub/tutorials/movenet)

## 推荐的深模块边界

不要在 Web、Android 或动作 profile 中各自增加一套卧推计数器。现有 Rust `InferenceAdapter` 已经是可替换骨架后端的真实 seam：不同模型只需要把候选人映射为统一 `PoseCandidate`；Rust 继续拥有主体身份、连续性、观测来源、动作阶段和计数结果。

建议扩展 Rust 输入，而不是扩散业务规则：

```rust
pub struct InferenceResult {
    pub pose_candidates: Vec<PoseCandidate>,
    pub equipment_candidates: Vec<EquipmentObservation>,
}

pub struct EquipmentObservation {
    pub kind: EquipmentKind,       // Barbell, LeftPlate, RightPlate, Grip
    pub track_id: Option<u64>,
    pub geometry: ObservationGeometry,
    pub confidence: f32,
}
```

Rust 内部新增一个动作无关的观测融合模块：

```text
模型适配器（MediaPipe / RTMPose / MoveNet）
                     + 杠铃/握点检测与跟踪
                              ↓
Rust 主体连续性 → 器械连续性 → 骨长/关节限位 IK → CanonicalLandmark
                                                    ↓
                              现有动作 phase/profile/RepEngine
```

融合得到的肘腕必须标记为 `LandmarkSource::Fused`，并新增类似 `EquipmentConstrainedInverseKinematics` 的原因；不能冒充 `Measured`。若肩和握点至少有一个也不可靠，IK 问题仍然欠约束，应输出 `Unknown`，而不是按预计节奏补出动作。

## 为什么杠铃轨迹对卧推更有效

正面卧推的产品目标应拆成两类：

- **计数/节奏**：杠铃或左右杠铃片的竖直位移通常比二维肘角更稳定。使用底部—顶部—底部的受约束状态机，加速度和最短驻留时间抑制抖动；主体骨架只确认用户仍在卧推位置。
- **动作纠正**：需要区分真实测得的肘、腕与器械约束推断。只有在可靠观测覆盖率足够时，才输出肘角、左右不对称或轨迹偏移反馈。正面机位深度信息不足时，应拒绝给出无法验证的纠正。

已知上臂与前臂长度时，如果肩点和握点可靠，肘点在几何上通常仍有两个候选解；可用上一帧连续性、肘关节限位和左右对称消歧。这可以补短时缺失，但不能在肩、腕/握点都错误时唯一恢复肘点。

## 验证计划

### 阶段 0：清理评估输入（1–2 天）

- 用当前 `inboxVideoPoseExtractor` + Rust 动态主体锁重新提取两条卧推视频；
- 诊断文件保留每帧全部候选、候选框、分数和最终主体，而不是只保存固定数组位置；
- 标出镜面、机架遮挡、肘腕低置信区间；
- 对已知两条视频建立不可变 golden case。

### 阶段 1：同帧模型 bakeoff（2–4 天）

- 输入：完全相同的 RGB 帧；
- 模型：MediaPipe Heavy、RTMPose-t/s/m Body26、MoveNet Thunder；
- 适配：都转换为同一 canonical schema，缺失的 BlazePose 点明确为 `Unknown`；
- 计数：都重放到同一个 Rust RepEngine，禁止模型专属计数逻辑。

除了每段总次数，还要在每次动作的起点、25%、极值、75%、终点附近人工标注肩、肘、腕和杠铃/握点。只标总次数无法判断模型是正确识别还是恰好数对。

建议指标：肘腕 PCK、有效关节点覆盖率、骨段长度变异系数、exact-set accuracy、误计数、漏计数、手机 FPS、模型体积与峰值内存。

### 阶段 2：杠铃融合原型

- 每 N 帧运行轻量检测器，帧间用光流/卡尔曼或学习型 tracker 保持杠铃、片和握点轨迹；
- 先实现杠铃中心/两端轨迹计数，再实现肩—握点—肘的约束 IK；
- 只在观测或融合置信度通过门槛时计数；长缺口必须进入 uncertain/lost，禁止按时间补次数。

### 阶段 3：目标域微调

如果通用 RTMPose 仍失败，标注的训练目标应包含肩、肘、腕、杠铃两端/握点，并把镜中倒影作为干扰负样本。训练/验证必须按人、健身房、器械和镜面场景切分，不能随机拆相邻视频帧。

优先微调 RTMPose-t/s 以满足移动端离线预算；通过后再导出 ncnn/ONNX 后端并接入同一个 Rust `InferenceAdapter` seam。

## 晋升门槛

已知两条视频只能作为回归门禁，要求：

- 每条均为 4/4；
- 审核过的静止、上杠、下架窗口零误计；
- 不依赖文件名、人工总数或固定时间间隔；
- 可输出每次计数采用的观测来源与置信度。

产品级门禁应使用未参与调参的人、环境和器械：

- 留出集 exact-set accuracy ≥ 95%；
- 单次 rep 匹配、误计/漏计和不可观测拒识率同时达标；
- 在目标 Android 真机达到约定 FPS、内存、功耗；
- 计数与姿势纠正分别验收，不能用“杠铃数对了”替代“肘腕识别对了”。

## 最终选择建议

短期不要“MediaPipe 换成 RTMPose”一刀切。先完成动态主体重抽和四模型同帧 bakeoff；如果 RTMPose 在肘腕 PCK/覆盖率上显著获胜，就把它作为第二个 `InferenceAdapter`，MediaPipe 继续覆盖普通站立动作。无论通用骨架模型结果如何，杠铃/固定器械动作都值得增加设备轨迹观测，因为它直接对应动作的主要运动自由度，也是正面机位下比肘腕更稳定的计数证据。

对首个技术验证版本，最稳妥的能力边界是：普通徒手动作继续使用全身骨架；正面卧推使用杠铃轨迹主计数 + 骨架确认；需要严格姿势纠正时引导用户采用 30–45° 斜前机位。这样既保留统一 Rust SDK，又不会让一个通用骨架模型承担它本身没有可靠观测的信息。
