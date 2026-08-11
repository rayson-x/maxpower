# Rust 人体—器械融合契约 v0.1

日期：2026-08-11  
状态：implemented interface / detector training blocked / not promoted

## 目的

当 RTMPose 在杠铃遮腕、仰卧透视或镜面健身房中无法可靠观察腕肘时，系统允许把真实杠铃、哑铃或器械把手作为第二路运动证据，用于辅助动作阶段、计次、路径和训练执行分析。器械观察不得反向伪造人体关键点，也不得冒充骨架准确率真值。

目标数据流：

```text
YOLOX/设备视觉 Adapter
  ├─ 人体候选 + RTMPose Halpe-26
  └─ 器械候选/跟踪观察
             ↓
Rust EquipmentFusionEngine
  ├─ 绑定已锁定前景主体
  ├─ 拒绝已标记镜像、静态架位和低置信度候选
  ├─ 分配稳定 equipment track id
  ├─ 可选关联可靠腕点，但不修改 canonical pose
  └─ 输出 observed 或 cannot_judge
             ↓
MOTN/1.7 CanonicalMotionOutput（EQP1）
             ↓
Web / Android / iOS / Client Agent
```

## 模块边界

`InferenceAdapter`/平台视觉 Adapter 只负责提交一帧的原始观察：人体候选、Halpe-26、器械类别、框、score、uncertainty、来源和明确的 reflection/static/occlusion 属性。Adapter 的 proposal id 只在当前帧有效。

`EquipmentFusionEngine` 是唯一的人体—器械关联模块，负责：

- 只关联 Rust 已锁定的前景主体；主体不确定时返回 `NoLockedSubject`；
- score 低于 0.5、非有限坐标、预测型输入或越出主体关联区域时拒绝发布；
- 不发布已由 Adapter 标记的镜像候选或静态架位器械；
- 用空间和时间连续性生成 Rust 稳定 track id，不信任 detector proposal 顺序；
- 仅用 `measured/fused + renderable` 的 Halpe-26 腕点做可选持握关联；腕点 unknown 时器械路径仍可 observed，但 `heldBy=unknown`；
- 当前帧没有器械时不外推假轨迹，输出 `NoEquipmentObservation`；内部 track 最多保留 500ms，只用于重新捕获身份。

`EquipmentFusionEngine` 不负责：

- 修改、补画或预测 Halpe-26 人体点；
- 从单帧直接判定 rep、动作质量或借力；
- 自动识别镜像/静态器械。v0.1 只执行 Adapter 提供的显式属性，时序 hard-negative 分类仍待训练；
- 把杠铃最低点等同于人工动作 phase peak。

## MOTN/1.7 输出

`EQP1` 与 canonical pose、主体、rep 和 lineage 同属一个不可变 packet。每帧输出：

- `status=observed | cannot_judge(reason)`；
- 锁定主体 id；
- reflection/static/invalid/outside-subject 拒绝计数；
- 每条器械 track 的稳定 id、原 proposal id、类别、框、中心、score、关联置信度、uncertainty、来源、持握侧和 `judgeablePath`。

`judgeablePath=true` 仅表示“当前帧存在与锁定主体关联的非预测器械观察”，不表示骨架、动作阶段或技术质量已经可判断。

## 当前诊断证据

个人正面卧推 20.8 秒冻结夹具中，YOLOX/Rust 选择前景 candidate 0；RTMPose 原始左右腕 score 为 0.324/0.290，左右肘为 0.482/0.464。当前 Rust 不再把这些点发布为可靠 `measured`。

6 条个人卧推的来源隔离姿态模型为 41/46 matched rep，人工区间对齐 30/46（65.22%）。独立水平杠铃轴可观测性原型为 46/46 matched rep、区间对齐 39/46（84.78%）。这证明器械是有效的第二观测源，也证明当前原型仍低于 95%。该原型不是训练后 detector 的独立盲测结果。

## 平台状态与停止条件

- Rust C/WASM ABI、Web wrapper、Android JNI 和 iOS `MPMotionBridge` 已通过同一个 pose+equipment 帧接口提交器械候选并解码 `EQP1`；
- Apple/Android 共享 Rust 库已包含 `MOTN/1.7`，无器械输入时必须传播 `cannot_judge`；
- Web 与 iOS Simulator 对真实镜面卧推 14 帧 pose + research-only 杠铃轴观察均保持原生 Rust packet 14/14 字节一致；Android 四 ABI 与 `pose-camera` C++/Kotlin debug AAR 已构建通过，但本轮没有连接真机，v1.7 真机 parity 未测；
- 实时 Android/iOS 相机目前仍向该接口提交空器械列表，因为设备端 detector 尚未训练和接入；接口完成不等于产品已能识别器械；
- 当前 `yolox-nano-humanart` 只检测人物，不能称为器械 detector。

在完成器械人工真值、来源隔离 detector 训练和冻结测试前，器械路径与依赖它的动作质量维度保持 `cannot_judge`，不进行生产 promotion。

## 后续验收

器械模型必须独立报告：class detection precision/recall/F1、动作阶段 track coverage、中心/轴线 PCK、identity switch、镜像/静态 hard-negative 误报率。融合后的动作模型仍须分别满足 completed-rep precision/recall、整组 exact-set、start/end+IoU、人工 peak 和 technique gold 指标；不得合并成一个模糊的“总识别率”。
