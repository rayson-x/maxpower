# 多视角骨架轨迹可行性：能否由正面轨迹推导侧面/背面/斜面（2026-08-06）

## 问题

相机沿 360° 绕人转圈，只是角度不同、动作行程相同。能否根据**正面**动作的骨架轨迹，推测侧面（90°）、背面（180°）、正斜面（45°）、后斜面（135°）的轨迹？

## 结论先行

- **按当前项目的主流水线（纯 2D 图像坐标）：不能直接推。** 2D 投影丢掉了深度轴，侧面的水平位移恰恰是正面看不见的那个轴，任何"旋转 2D 坐标"的做法在数学上都不成立。
- **但项目里已经躺着一条 3D 数据通路**：MediaPipe 的 `worldLandmarks`（伪 3D，米制，原点髋中点）和图像坐标的 `z` 一直在被采集、封装、透传，只是几乎没人消费。理论上可以绕竖直轴做 yaw 旋转再正交投影，合成其他视角的近似 2D 轨迹——但 z 精度是项目自己标注过的未验证项（"伪3D实验"），合成结果只能当假设证据，不能直接当参考走廊。
- **另一条更稳的路**：不做视角合成，而是把关节角改用 worldLandmarks 在 3D 里算——3D 关节角天然与相机视角无关，一次计算全视角通用。这比"合成五个视角的 2D"更便宜、也更接近项目现有的证据纪律。
- **项目当前的既定架构决策是"每个机位独立建 identity、禁止跨机位套用"**，这个决策在纯 2D 条件下是正确的，本报告不建议推翻它，只建议在其之上增加 3D 实验通路。

## 项目概览

主项目为 [`maxpower`](../../)：Expo / React Native + Web 的健身动作姿态分析应用（`package.json`）。姿态来源有两条引擎：

- **MediaPipe Pose Landmarker（BlazePose-33）**：[`src/pose/PoseEngine.ts:45-63`](../../src/pose/PoseEngine.ts)，VIDEO 模式，最多 4 个 pose candidate。
- **RTMPose（COCO-17，ONNX）**：[`src/pose/RtmposeEngine.ts`](../../src/pose/RtmposeEngine.ts)，SimCC 输出，**纯 2D**——`z: 0`、`worldLandmarks: []`（`RtmposeEngine.ts:202-207, 223`），代码注释明确写着"RTMPose 无伪 3D 输出"（`RtmposeEngine.ts:209`）。

另有 Rust/WASM canonical motion SDK（`rust/motion-sdk/`）负责 rep 分段、计数与轨迹证据的不可变封装。

## 骨架轨迹计算现状

### 数据结构与坐标系

- `PoseLandmark = { x, y, z, visibility }`（[`PoseEngine.ts:6-13`](../../src/pose/PoseEngine.ts)）。
- `PoseEstimate` 同时携带两套坐标（[`PoseEngine.ts:15-21`](../../src/pose/PoseEngine.ts)）：
  - `landmarks`：图像归一化坐标 0..1，**z 是相对髋部的深度**（注释原文："Image-normalized coordinates (0..1, z relative to hips)"）；
  - `worldLandmarks`：注释原文 "Pseudo-3D world coordinates in meters, origin at hip center"。
- canonical 帧契约（[`canonicalPose.ts:78-83`](../../src/pose/canonicalPose.ts)）：`coordinateSpace: "image_normalized"`、`worldCoordinateSpace: "meters"`，两套 landmarks 都被封装进 `CanonicalPoseFrame` 透传。

### 轨迹特征全部只用 2D

[`src/pose/trajectory.ts:10`](../../src/pose/trajectory.ts) 开头写明："坐标为图像归一化坐标（y 向下）"。具体表现：

- 路径点 `Pt = { t, x, y }`，没有 z（`trajectory.ts:53-57`）；
- 关节角 `angleDeg` 是**二维投影角**（`trajectory.ts:59-67`）；
- 躯干尺度 `torsoScale` 是肩中点到髋中点的 **2D 距离**（`trajectory.ts:111-125`）；
- 路径形状（主轴、直线度、幅度）、逐 rep 一致性、周期性全部建立在 2D x/y 上（`trajectory.ts:182-212, 377-428`）。

### 全项目唯一的 3D 消费点

[`src/pose/viewGating.ts:171-196`](../../src/pose/viewGating.ts) 的 `torsoLeanDeg(worldLandmarks)`：用 worldLandmarks 的 x/y/z 算躯干轴与竖直方向夹角。它自己的注释写着 "z accuracy is the open question the research pass is verifying"（`viewGating.ts:167-170`），并在指标门控里登记为 `torso_lean_3d`，标签"躯干倾角(伪3D实验)"（`viewGating.ts:141-147`）。UI 里仅作展示调用（`CameraPoseView.web.tsx:1603`）。2026-08-05 的可观测性审查报告也明确：该指标在同步 3D 参考系统验证前只能留在实验界面（`docs/reports/2d-pose-observability-and-phase-alignment-2026-08-05.md`）。

## 预设动作骨架现状

项目里有两类"预设"，**都不是坐标形式的骨架**：

### 1. 模拟运动学先验（simulated kinematic prior）

[`src/pose/simulatedKinematicPrior.ts`](../../src/pose/simulatedKinematicPrior.ts)：45+ 个动作模板（`simulatedKinematicPrior.ts:248-306`），每个 rep 固定 16+16 相位节点，节点值是**无量纲隐变量 -1..1**，注释原文 "Dimensionless latent amplitude (-1..1), never image coordinates or degrees"（`simulatedKinematicPrior.ts:97-98`）。模板只声明特征趋势（如"下拉时肘角趋向屈曲"），不含任何关键点坐标。

关键约束：identity 强绑定 `capturePosition`（`simulatedKinematicPrior.ts:47`），`instantiateSimulatedKinematicPrior` 会拒绝模板不支持的机位（`simulatedKinematicPrior.ts:324-326`）；不同机位被视为**不同 identity，必须各自用真实 rep 校准**（`simulatedKinematicPrior.ts:583-590` 校准规则原文："其他机位是新 identity，必须各自校准与留出"）。

### 2. 参考轨迹走廊（reference trajectory profile）

[`src/pose/referenceTrajectory.ts`](../../src/pose/referenceTrajectory.ts)：以高位下拉为例，特征全是 2D 图像空间量——腕相对肩高度、肘投影角、上臂-躯干投影角、腕横向位置、躯干横移/倾角（`referenceTrajectory.ts:9-21`），由 2D 坐标直接计算（`referenceTrajectory.ts:765-907`）。

跨机位在这里是**硬性禁止**的：

- `matchLatPulldownTrajectory`：机位不匹配直接返回 `profile_mismatch`，理由原文 "capturePosition 不匹配，禁止跨机位套用二维走廊"（`referenceTrajectory.ts:549-556`）；
- `buildPersonalProvisionalReference`：同一个参考档案不允许混合实体机位（`referenceTrajectory.ts:373-375`）。

### 3. 机位体系

[`src/pose/viewGating.ts:3-34`](../../src/pose/viewGating.ts) 已定义 8 个机位（正前、左前45°、左侧、左后45°、正后、右后45°、右侧、右前45°），映射到 3 个分析视角（front/side/oblique45）。注意后方机位的 guidance 原文："当前仅保守输出对称与躯干观察，不做纵深轨迹评分"（`viewGating.ts:29-31`）。指标门控也直接承认 2D 的可观测性边界：`wrist_trajectory_rep` 在正面拒答，理由 "正面机位手腕纵深轨迹不可见"（`viewGating.ts:134-140`）。

全项目**不存在**任何 yaw/视角旋转/多视角合成代码（已检索 `yaw|rotat|multi-view|360`，只有图像旋转元数据 `rotationDegrees` 和序列轮换逻辑，与视角无关）。

## 能否从正面推其他角度：分两种情况

### 情况 A：纯 2D 坐标 —— 不能推

侧面的水平轴（画面 x）对应的是正面视角下的**深度轴 z**，而 2D 数据里这个维度在投影时已经丢失，无法恢复。例子：深蹲从侧面看，髋部前后移动和躯干前倾是主要信号；正面 2D 里髋部几乎只有上下分量，前后位移被压成不可见的微小透视缩放。反过来也一样：正面侧平举的双腕横向展开，在正面 2D 里很完整，但从正面数据推不出侧面看手腕在身体前方还是后方。

这正是项目现有设计反复声明的事实（"正面机位手腕纵深轨迹不可见"、"后方不做纵深轨迹评分"），数学上没有绕过的办法。

### 情况 B：带 z / worldLandmarks —— 可以合成，但有三层折扣

PoseEngine 已经在产出伪 3D 数据，所以"旋转合成"在数据上是可行的：

1. **数学上**：绕竖直轴 yaw 旋转 θ，再正交投影回 2D：`x' = x·cosθ − z·sinθ`，`y' = y`（重力轴不变），`z' = x·sinθ + z·cosθ`。θ = 45°/90°/135°/180° 即对应正斜面/侧面/后斜面/背面。用 worldLandmarks（米制）旋转后再按躯干尺度归一化，可比直接旋转带透视的图像 z 更干净。
2. **精度折扣**：MediaPipe 的 z 是相对髋中点的**推断深度**，尺度和精度有限，项目自己已把基于它的躯干倾角标为"伪3D实验"、待同步 3D 系统验证（`viewGating.ts:167-170`；`docs/reports/2d-pose-observability...md`）。旋转合成的轨迹误差会随角度放大，90° 侧面几乎完全由 z 决定——也就是误差最大的方向。
3. **可见性折扣**：换视角后自遮挡关系变了。正面可见的脸部/胸部点在背面不可见，侧面远侧肢体 visibility 塌掉；合成轨迹必须重新推导每个点在新视角下的可见性（近似规则：按朝向和肢体侧别），不能照搬正面 visibility。
4. **引擎折扣**：RTMPose 通路（COCO-17）完全没有 z（`RtmposeEngine.ts:205`），走这条引擎时情况 B 直接退化为情况 A。

另外要注意一个概念错配：**预设骨架不是坐标，是特征趋势**（见上文）。所以"旋转预设骨架"没有对象可转；真正能被旋转的是参考轨迹走廊所依赖的 2D 特征——而这些特征（横向间距、投影角、横移）本身就是视角相关的量，旋转后需要按新视角重新定义"横向"等语义，等于为每个视角重建特征 schema。这与项目现行"每机位独立 identity + 各自校准"的方案相比，并没有省掉真实数据校准这一步。

## 结论与建议

**一句话结论：当前纯 2D 主流水线无法由正面推其他视角；但借助已在采集的 MediaPipe worldLandmarks 做 yaw 旋转合成是可行方向，产物只能作为假设级（hypothesis）证据，不能替代各机位的真实校准。**

落地建议（按性价比排序）：

1. **优先做"3D 关节角"，而不是"多视角 2D 合成"**。真实 3D 关节角天然与机位无关——与其合成五个视角各算一遍 2D 投影角，不如直接用 worldLandmarks 算一次肘/膝/髋三维角，全视角通用。这是对现有 `torsoLeanDeg` 实验的自然推广，改动面小，且与"每机位独立 identity"架构不冲突（3D 角特征可以作为机位无关的新特征类另立 schema）。
2. **如果要做视角合成**：写一个 `rotateWorldLandmarks(poses, yawDeg)` 纯函数（绕 y 轴旋转 worldLandmarks 再正交投影、按 torsoScale 归一化），先用已归档的正后高位下拉 canonical sidecar（`public/archives/confirmed-captures/`）做验证：从正面/45° 合成 180° 轨迹，与同一人真实背面拍摄对比，量化误差后再决定它能进哪一层证据等级。输出保持项目惯例的 `evidenceStatus: "hypothesis"` 标注。
3. **验证纪律沿用现有报告标准**：2026-08-05 可观测性报告已要求 worldLandmarks 派生指标在同步 3D 参考验证前不进纠错/评分——合成视角轨迹应受同一约束，且不得绕过 `referenceTrajectory.ts` 现有的跨机位禁配逻辑去"借"正面走廊给背面用。
4. **明确 RTMPose 通路的边界**：该引擎无 z，视角合成对它不适用，文档与 UI 引导上应把"多视角合成"能力绑定到 MediaPipe 通路。
