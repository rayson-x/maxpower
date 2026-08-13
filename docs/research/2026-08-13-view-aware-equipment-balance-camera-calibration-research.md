# 单目实时视频中的视角感知器械平衡与相机校正研究

> 日期：2026-08-13
> 状态：已完成
> 范围：客户端单目实时视频；预设机位、相机校正、器械轨迹与人体骨架融合；杠铃/双哑铃阶段、路径和持续左右不平衡判断。

## 1. 结论摘要

1. **不要把屏幕水平当作真实水平。** 在针孔模型中，像素纵坐标含有深度除法；相机 roll、端点深度差、相机 pitch/yaw、镜头畸变都能让“同一物理高度”的两点出现像素 `y` 差，也能掩盖真实高度差。OpenCV 对针孔投影的定义是先做世界到相机变换，再以相机深度相除并应用内参与畸变；`projectPoints` 正是这一映射的官方实现（[OpenCV calib3d](https://docs.opencv.org/master/d9/d0c/group__calib3d.html)、[OpenCV fisheye model](https://docs.opencv.org/4.x/db/d58/group__calib3d__fisheye.html)）。
2. **首版建议采用“预设机位 + roll 校正 + 视角感知的 2D/时序特征 + 可观测性门控”，而不是伪 3D。** front/front-oblique 优先判断左右端/左右哑铃的相对阶段与持续偏置；lateral 只可靠判断器械整体阶段和矢状面路径；rear/rear-oblique 可做左右比较，但解剖侧映射必须与镜像状态分离。
3. **产品采用纯视觉 roll 校正。** 调研确认原生端可以读取硬件重力/融合姿态，但本项目明确不把 IMU 作为识别输入。正式链路使用已知器械架/场景稳定线、线段与消失几何的跨帧共识；人体骨架方向只作低权重交叉检查。视觉证据不足或互相冲突时，输出弃权理由，不要求用户把手机佩戴在身体上，也不依赖传感器权限。
4. **杠铃与双哑铃不是同一个追踪问题。** 杠铃应建模为一个刚性轴和两个有序端点，避免把端点当两个自由物体；双哑铃则必须保留两个轨迹身份，并以手腕/前臂关联和时序门控维持身份，不能把画面左/右直接当作解剖左/右。
5. **“持续不平衡”必须是跨重复、跨阶段的统计结论。** 单帧差值只形成观测；一次重复形成候选事件；至少多次有效重复、同方向且超过个人噪声基线与测量误差后，才能报告 set drift 或持续偏置。标准参考定义动作目标，personal baseline 定义此人的可重复正常范围，set drift 检测本组内随疲劳出现的变化。
6. **检测、跟踪和骨架网络不提供几何真值。** YOLOX 是目标检测器（[论文](https://arxiv.org/abs/2107.08430)、[官方仓库](https://github.com/Megvii-BaseDetection/YOLOX)）；ByteTrack 通过关联检测框维持轨迹身份，并专门利用低分检测框减少轨迹碎裂（[论文](https://arxiv.org/abs/2110.06864)、[官方仓库](https://github.com/FoundationVision/ByteTrack)）；RTMPose 是实时 2D 人体姿态估计框架（[论文](https://arxiv.org/abs/2303.07399)、[官方仓库](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)）。它们分别产出框、轨迹 ID、2D 关键点及置信度，不自动产出真实水平、物理高度、重量、力、力矩或可靠的解剖侧。

## 2. 投影几何：像素端点 y 差为何不等于物理高度差

### 2.1 投影式直接说明了问题

设世界点 \(P_w=(X,Y,Z,1)^T\)，相机外参为 \([R\mid t]\)，内参为 \(K\)。理想针孔投影为：

\[
s\begin{bmatrix}u\\v\\1\end{bmatrix}
=K[R\mid t]P_w,
\qquad
u=f_x\frac{X_c}{Z_c}+c_x,
\qquad
v=f_y\frac{Y_c}{Z_c}+c_y.
\]

所以两个端点的像素纵差是：

\[
\Delta v=f_y\left(\frac{Y_{c,1}}{Z_{c,1}}-\frac{Y_{c,2}}{Z_{c,2}}\right),
\]

而不是 \(f_y(Y_{c,1}-Y_{c,2})\)，更不是世界重力方向上的物理高度差。OpenCV 的 `projectPoints` 用内参、外参和畸变参数把 3D 点投到图像，并可据此计算重投影误差；相机标定则估计内参和畸变（[OpenCV `projectPoints` / camera model](https://docs.opencv.org/master/d9/d0c/group__calib3d.html)、[OpenCV camera calibration tutorial](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html)）。

这带来四个直接后果：

- **roll：** 相机绕光轴转动会把世界竖直/水平同时旋进像素坐标，给所有线条增加系统性斜率。
- **深度差：** 即使两个杠端物理等高，只要一端更靠近相机，两个 \(Z_c\) 不同，像素 `y` 仍可能不同；front-oblique 尤其如此。
- **视角和动作平面：** 相机 pitch/yaw 以及杠轴不平行于像平面，会使世界水平线产生透视汇聚。roll 归零后，这个误差仍在。
- **畸变：** 径向畸变使直线在远离图像中心处弯曲，切向畸变也改变端点位置；OpenCV 明确将二者列为标定和去畸变对象（[OpenCV calibration](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html)）。

因此，`bar_endpoint_left.y - bar_endpoint_right.y` 只能叫 **raw image-space endpoint offset**，不能命名为 `height_difference`。校正后也应叫 `gravity_aligned_image_offset` 或 `plane_rectified_offset`，除非已具备可验证的世界尺度与深度约束。

### 2.2 何时可以作近似

只有同时满足以下条件，校正后的像素纵差才可作为“相对不平衡代理量”，且必须附带适用视角和置信度：

1. 相机固定，已去除或量化 roll，镜头畸变已校正或目标位于低畸变中心区域；
2. 两端深度近似相等（\(Z_{c,1}\approx Z_{c,2}\)），例如严格 front/rear 且杠轴近似平行像平面；
3. 动作和器械未明显离开预设平面，端点均可见且检测置信度足够；
4. 比较在同一相机、同一裁剪/缩放规则下进行，并用人体尺度、杠长投影或标定平面尺度归一化；
5. 输出是“哪侧在该视角下更早/更高的 2D 证据”，不是厘米级物理高度结论。

工程上还应计算 `depth_asymmetry_risk`：由预设机位（front-oblique 高于 front）、杠轴相对水平消失方向的偏差、人物/器械偏离标定区域等组成。风险超过门槛时，禁止把端点纵差升级为左右平衡判断。

## 3. Roll 校正：四种方法、平台可用性与失效条件

这里的 roll 指**图像绕光轴相对重力竖直方向的旋转**。它与设备 UI orientation、相机 yaw/pitch 不是同一变量。Android 官方特别说明传感器坐标始终基于设备自然方向；若要匹配屏幕显示，需要读取屏幕旋转并调用 `remapCoordinateSystem()`（[Android Sensors overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)、[`SensorManager`](https://developer.android.com/reference/android/hardware/SensorManager)）。所以不能把 portrait/landscape 枚举直接当 roll。

> **产品决策（2026-08-13）：只使用视觉输入。** 下表保留 IMU 是为了记录调研过的替代方案及其取舍，不代表实现计划。Web、Android、iOS 的正式算法都以视频画面中的场景锚点、稳定线和跨帧几何为依据；IMU 不进入 Rust 识别契约。

| 方法 | 原理与推荐用法 | Web | Android | iOS | 主要失效条件 |
|---|---|---|---|---|---|
| 1. 硬件重力 / 融合姿态 | 将重力向量变换进相机坐标，再投影到像平面求 roll；优先使用与视频帧近邻的时间戳。Android `TYPE_GRAVITY` 或 `TYPE_ROTATION_VECTOR`；iOS `CMDeviceMotion.gravity`/`attitude`。 | **条件可用。** Device Orientation 是浏览器提供的高层方向事件，不保证底层来源；只在安全上下文，权限和实现兼容性有限。 | **最佳。** `TYPE_ROTATION_VECTOR` 可转旋转矩阵；传感器轴要按屏幕旋转和相机传感器方向映射。 | **最佳。** Core Motion 给出设备坐标中的 gravity 和相对参考系 attitude；先检查 availability。 | 手机在支架中滑动；传感器到相机坐标外参错误；帧/IMU 时间不同步；强振动或启动瞬态；Web 权限拒绝/无事件；把屏幕方向当传感器方向。 |
| 2. 已知靶标 / 场景锚点 | 用标定板、已知竖直的 rack uprights、已知 3D 点做 PnP；或在已知平面上求 homography，得到世界竖直在图像中的方向。以重投影误差作为置信度。 | 可用（纯视觉） | 可用 | 可用 | 锚点尺寸/对应关系错误；点近共线；只用单一未知平面却声称完整 3D；遮挡；相机移动后仍复用旧外参。 |
| 3. 线段 + 消失几何 | 用 LSD/Hough 检出长线段，按方向与空间一致性聚类，经 RANSAC 求“场景竖直”消失点或在小透视条件下求主竖直方向；只选择 rack、墙柱等候选，不把杠铃本身当竖直参照。OpenCV 提供 `LineSegmentDetector` 和 `HoughLines/P`（[LSD API](https://docs.opencv.org/4.x/dd/d1a/group__imgproc__feature.html)、[Hough tutorial](https://docs.opencv.org/4.x/d9/db0/tutorial_hough_lines.html)）。 | 可用（WASM/JS 或后端视觉） | 可用 | 可用 | 没有足够长的真实竖线；镜面反射产生伪线；鱼眼畸变未校正；多组曼哈顿方向混淆；相机几乎正对竖直方向导致消失点数值不稳。 |
| 4. 骨架时序共识 | 在静止站立/锁定等受控阶段，用肩中点—髋中点、髋中点—踝中点等多段方向的稳健中值估计“人体竖直”，只作低权重回退或传感器交叉检查。RTMPose 提供 2D 关键点能力，但不提供重力真值（[RTMPose paper](https://arxiv.org/abs/2303.07399)）。 | 可用 | 可用 | 人体本身侧屈/倾斜；动作阶段不竖直；关键点遮挡或左右交换；front/rear 重叠；把人体姿势偏差错误吸收到相机 roll。 |

#### 平台约束细化

- **Android：** `TYPE_GRAVITY` 是重力估计，`TYPE_ROTATION_VECTOR` 表示设备相对参考坐标的轴角/四元数分量；官方提供 `getRotationMatrixFromVector` 转换矩阵（[Android `SensorEvent`](https://developer.android.com/reference/android/hardware/SensorEvent)、[`SensorManager`](https://developer.android.com/reference/android/hardware/SensorManager)）。优先保存原始 sensor timestamp、display rotation、camera sensor orientation 和最终 `camera_from_device` 变换，而不是只保存一个 Euler roll。
- **iOS：** `CMDeviceMotion` 分别给出设备参考系中的 gravity、userAcceleration 和 attitude；Core Motion 使用陀螺仪与加速度计区分重力和用户加速度。attitude 依赖所选 reference frame；默认 `xArbitraryZVertical` 的 z 轴垂直地面，但 x/y 取启动时方向（[CMDeviceMotion](https://developer.apple.com/documentation/coremotion/cmdevicemotion)、[processed device-motion data](https://developer.apple.com/documentation/coremotion/getting-processed-device-motion-data)）。应声明 `NSMotionUsageDescription`、检查可用性并在停止使用后关闭更新（[Core Motion](https://developer.apple.com/documentation/coremotion/)）。
- **Web：** W3C 规范把 `deviceorientation` 定义为高层事件，并要求 secure context、Permissions Policy/显式权限；事件字段是 Z-X′-Y″ 内禀 Tait–Bryan 角，不可把 `gamma` 无条件等同相机 roll（[W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/)）。MDN 将 `requestPermission()` 标为 limited availability，要求 HTTPS 和 transient user activation（[MDN `requestPermission`](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/requestPermission_static)）。因此 Web 首版必须允许 `imu_unavailable`，转用视觉/用户校正，不能把传感器设为硬依赖。

#### 融合策略

正式视觉方法输出同一契约：`roll_rad`、`variance_rad2`、`source`、`source_timestamp`、`valid_until`、`failure_reason`。在相机静止窗口内做跨帧稳健共识；已知 rack/场景锚点是强视觉证据，场景线是中等证据，骨架是弱证据。方法间差值过大时不做平均，而是标记 `calibration_conflict` 并降级。任何校正都保留原像素坐标，避免重复旋转和调试不可追溯。

## 4. 几何层级比较：roll-only、homography、PnP、monocular 3D

| 层级 | 已解决 | 仍未解决 | 所需输入 | 适合首版吗 |
|---|---|---|---|---|
| **Roll-only（1 DoF）** | 去掉绕光轴的全局画面旋转，使像素竖直尽量对齐重力投影。 | 深度透视、yaw/pitch、尺度、离面运动、畸变（除非另做去畸变）。 | 重力/姿态、场景竖线、锚点或骨架回退之一。 | **是，最低必需层。** 输出仍是 image-space proxy。 |
| **Planar homography（8 DoF，差一个全局尺度）** | 在一个明确平面与目标平面之间做透视校正；适合地面、墙面、标定板或近似固定的动作平面。OpenCV 明确说明 homography 只适用于平面结构（[OpenCV homography tutorial](https://docs.opencv.org/master/d9/dab/tutorial_homography.html)）。 | 不在该平面上的人体/器械点；离面动作；单独一张 homography 不恢复一般 3D。 | 至少四个可靠的非共线平面对应点；若要物理尺度还需已知距离。 | **有条件。** 仅在动作确实近似共面并可验证时启用。 |
| **PnP（相机 6 DoF pose）** | 由已知 3D 世界点与其 2D 像点、相机内参/畸变求世界到相机的旋转和平移；可用 `projectPoints` 做重投影验证。OpenCV 将 `solvePnP` 定义为从 3D–2D 对应求物体/相机姿态（[`solvePnP`](https://docs.opencv.org/master/d9/d0c/group__calib3d.html)）。 | 未知 3D 动点仍只对应一条相机射线；没有额外平面/长度/运动约束时，不能从单帧得到其深度。 | 稳定内参、畸变、已知 3D 锚点及可靠 2D 对应；非平面点通常条件更好。 | **第二阶段优先。** 若场地可布已知 rack/标记，价值高于直接上 learned 3D。 |
| **Learned monocular 3D** | 用人体形状、动作和时序先验，从 2D 图像/关键点推断相对 3D 姿态；例如 VideoPose3D 用 2D 关键点序列和膨胀时序卷积预测 3D 姿态（[CVPR 2019 paper](https://openaccess.thecvf.com/content_CVPR_2019/html/Pavllo_3D_Human_Pose_Estimation_in_Video_With_Temporal_Convolutions_and_CVPR_2019_paper.html)、[official implementation](https://github.com/facebookresearch/VideoPose3D)）。 | 单目固有多解、绝对尺度/根深度、跨域泛化、器械 3D、遮挡下可靠性；模型先验不是测量真值。原实现也明确说其野外推理入口仅供研究、非 production-ready（[VideoPose3D inference note](https://github.com/facebookresearch/VideoPose3D/blob/main/INFERENCE.md)）。 | 训练域匹配的模型、时序窗口、2D 关键点，通常还需相机/骨长约束和专项验证。 | **不是首版依赖。** 仅作后续离线实验，与标定真值比较后再决定。 |

推荐升级顺序是：**去畸变（若有参数） → roll-only → 可验证的平面 homography → 有已知 3D 锚点的 PnP → 单目 3D 实验**。这些层级不是互斥功能；每一层都必须记录其假设和有效域。尤其不能用 homography 去“矫正”任意 3D 杠铃轨迹，也不能因 PnP 得到相机 pose 就声称未知动点已有 3D 坐标。

## 5. 器械建模：barbell rigid-axis 与 dual-dumbbell tracking/identity

### 5.1 杠铃：一个刚体轴，不是两个自由端点

首版应把杠铃状态定义为一个带方向的刚体观测：`shaft_segment + endpoint_a + endpoint_b + center + confidence`。逐帧检测只产生候选，时序层再施加以下约束：

- 杠轴长度和方向在相邻帧中连续变化，端点不能无理由交换；
- 杠轴应与目标运动员的两侧腕/手区域保持合理关联，但腕点低置信度时不能反向污染器械实测；
- 杠铃整体中心和轴线参与阶段、端点和路径判断；两端相对状态仅在对应机位可观测时参与双侧判断；
- 遮挡期间可以短时预测，但必须输出 `predicted=true`、预测龄期和不确定度，不能伪装成检测实测。

YOLOX 只负责从图像产生目标候选；ByteTrack 的原始贡献是联合高分和低分检测框做数据关联、减少被遮挡目标的轨迹碎裂，而不是输出杠轴、真实高度或解剖左右（[YOLOX 论文](https://arxiv.org/abs/2107.08430)、[YOLOX 官方仓库](https://github.com/Megvii-BaseDetection/YOLOX)、[ByteTrack 论文](https://arxiv.org/abs/2110.06864)、[ByteTrack 官方仓库](https://github.com/FoundationVision/ByteTrack)）。因此可以复用其“检测后时序关联”的思想或实现，但必须在 Rust 契约中另建杠轴几何和观测来源；不能把普通 bounding-box ID 当作器械轨迹真值。

### 5.2 双哑铃：两个独立轨迹，需要解剖侧身份

双哑铃不能套用刚体杠轴。每一侧应有独立状态 `track_id + anatomical_side + center/extent + velocity + confidence`。身份分配建议在每帧做带门控的最小代价关联，代价至少包含：

1. 与上帧位置/速度预测的距离；
2. 与同侧腕、肘和前臂区域的距离；
3. 尺寸、外观或局部特征连续性；
4. 对交叉、遮挡和低分检测的惩罚；
5. `feed_mirrored` 纠正后的解剖侧一致性。

当两只哑铃交叉、腕点失真或器械被身体遮住时，可以维持暂态轨迹，但超过预测时限后必须转为 `identity_uncertain` 或 `track_lost`。在身份恢复前，整体阶段仍可判断，左右不平衡不得输出。

### 5.3 主体、镜中人和背景器械

检测器和跟踪器不会天然知道哪个人物是用户、哪个器械属于用户，也不会天然识别镜中反射。Rust 前置关联应使用预设机位和用户选择的动作上下文，将器械候选与主人体轨迹、腕部邻近、运动周期相关性和可用 ROI 联合评分。镜面场景中若真实人与反射轨迹竞争且无法稳定消歧，应输出 `subject_ambiguous`，而不是选最高置信框强行继续。这是由检测/跟踪输出边界推导出的工程门控，不是 YOLOX 或 ByteTrack 已提供的语义能力。

## 6. View-aware observability matrix

下表是**默认可观测性先验**，不是某个机位的永久能力声明。具体动作还要叠加身体朝向、器械类型、遮挡率、校正质量和该规则的验证证据。`高/中/低` 表示适合作为首版直接证据、需降置信/个人同机位基线、或默认弃权。

| 机位族 | 整体阶段/turnaround | 器械整体 ROM/路径重复性 | 杠铃端点物理高低 | 双侧时序 | 骨架关节/躯干 | 默认限制 |
|---|---|---|---|---|---|---|
| `front` | 高 | 高（图像空间归一化） | 中到高；仅 roll 校正、两端深度近似且轴线清晰时作为代理量 | 高 | 冠状面对称、支撑稳定较好；矢状面深度有限 | 不能恢复前后深度；镜面会制造竞争主体 |
| `front_oblique_45` | 高 | 高 | 低；roll-only 仍不能消除端点深度差，除非有已验证平面/几何校正 | 中到高，时间先后通常比像素高度更稳健 | 同时看到部分冠状面和矢状面，但远侧遮挡增加 | 左/右 45°共享规则族，但必须保留 handedness 并分别验证 |
| `lateral` | 高 | 高，尤其矢状面路径和 ROM | 不可判；杠轴多为近视线方向，两个端点常重叠 | 低，通常只能可靠观察近侧 | 近侧关节角、躯干前倾和路径较好；远侧低 | 默认 `view_not_observable`，不能报告杠铃左右水平差 |
| `rear_oblique_45` | 中到高，取决于动作和遮挡 | 中到高 | 低，原因同前斜 45° | 中 | 后侧支撑、肩胛/髋膝可见性可能更好，但面向相关关节变差 | 不能直接复用 front；需独立验证人体检测、左右映射和遮挡 |
| `rear` | 中到高 | 高（器械可见时） | 中到高；仍需 roll、深度近似和清晰端点 | 高 | 后侧冠状面对称较好，正面技术特征不可见 | 动作定义若依赖胸、面部或前侧接触点则需弃权 |

“左前 45°/右前 45°共享”和“左后 45°/右后 45°共享”的正确实现是：共享 `view_family`、特征定义和规则语义，同时用 `view_handedness` 完成坐标规范化；不是把两路原始 x 坐标直接共用。纯侧面不能靠镜像规则升级为可判断双侧平衡。

## 7. 镜像与左右语义：feed_mirrored / scene_has_mirror / anatomical_side

这三个字段必须相互独立：

- `feed_mirrored`：摄像头预览或输入像素是否被水平翻转。它改变画面 x 方向和画面左右，但不改变人的解剖左右；进入规范坐标前必须显式纠正。
- `scene_has_mirror`：现实场景里是否存在反射面。它意味着可能同时出现真实人与镜中人/器械，不等同于输入视频被翻转。
- `anatomical_side`：运动员自身左/右，是所有双侧质量结论的最终语义。

建议再保存 `view_family`（front/front-oblique/lateral/rear-oblique/rear）、`view_handedness`（left/right/center）、`subject_track_id` 和 `side_mapping_confidence`。处理顺序应为：选择真实主体 → 纠正 feed mirror → 根据主体朝向和机位建立画面点到解剖侧的映射 → 在规范坐标中计算特征。任何一步不确定都不得靠最后交换标签补救，应输出 `mirror_state_unknown`、`subject_ambiguous` 或 `anatomical_side_uncertain`。

## 8. Rust 因果处理顺序与建议字段

建议单次因果流固定为：

1. **ExecutionContext**：动作、变式、器械、机位族/handedness、feed mirror、场景镜子、主体选择策略。
2. **FrameGeometry**：原图尺寸、裁剪/旋转、相机内参/畸变（若有）、与视频帧同步的重力/姿态。
3. **SubjectAssociation**：主人体轨迹与镜面/旁人竞争状态。
4. **PoseObservation**：Halpe-26 原始点、置信度、measured/predicted 和来源。
5. **EquipmentObservation**：barbell rigid-axis 或 dual-dumbbell tracks；检测、跟踪、预测状态分开。
6. **CalibrationEstimate**：roll、可选 homography/PnP、方差、来源、适用区域、过期时间和失败原因。
7. **CanonicalObservation**：保留原始坐标，同时生成 gravity-aligned/plane-rectified 坐标和解剖左右；不得覆盖原观测。
8. **CausalFusion**：按动作契约融合器械阶段/端点与骨架策略；记录每个事实的独立证据 lineage，防止“器械修复的腕点”再反向作为独立器械证据。
9. **RepProposal**：start/turnaround/end 的发生时间、确认时间、因果延迟、每个端点的完整快照。
10. **QualityProposal**：逐维度输出 `value/confidence/evidence/abstain_reason`；只生成 `proposal_only`，人工审核后另存真值。
11. **SetAggregation**：封存 Rep 后计算持续偏置、组内漂移和提示候选，不回写或重解释旧 Rep。

核心字段建议至少包括：

```text
calibration: { method, roll_rad, variance, homography?, reprojection_error?, valid_region, status, reason }
view: { family, handedness, feed_mirrored, scene_has_mirror, side_mapping_confidence }
equipment: { topology, tracks[], measured, predicted, prediction_age_ms, identity_confidence }
endpoint: { occurred_at_ms, confirmed_at_ms, phase, pose_snapshot, equipment_snapshot, lineage }
quality_dimension: { value, confidence, evidence_refs[], observability, abstain_reason }
versions: { model, bundle, profile, feature_program, rule_pack, schema }
```

三端应向 Rust 传同一语义数据；传感器采集和相机坐标转换可以是平台适配层，但规则、特征、弃权和报告契约不能在 Web/Android/iOS 各写一套。

## 9. personal baseline、standard reference 与 set drift

三种参考必须并存，不能互相覆盖：

- `standard_reference`：定义所选动作/变式的任务、端点、主动与支撑特征以及哪些机位可观察；用于技术遵循和刺激兼容性，但无证据维度要弃权。
- `personal_endpoint_profile`：由用户审核通过的轻/中重量、相同动作/变式/器械/机位/侧别 Rep 建立，描述个人稳定 ROM、端点和轨迹走廊；用于发现相对个人稳定表现的退化，不得把长期错误习惯升级成标准动作。
- `set_baseline/set_drift`：使用本组前段有效 Rep 或稳健组内趋势，检测随重复出现的 ROM 下降、速度变化、提前反转和持续不对称；它说明“本组变化”，不说明生理原因。

质量规则应并列输出三种比较，例如“低于标准参考范围”“偏离个人稳定走廊”“本组从第 6 Rep 开始持续下降”，而不是压成一个分数。个人 profile 的纳入 Rep 必须由人工选择，并记录负重区间、机位、设备和版本；低置信或被判借力的 Rep 不能自动学习进基线。

## 10. 最小验证实验、真值与门槛

先验证观测和几何，再验证质量规则；每个实验只改变一个主变量。

| 实验 | 单一变量 | 真值获得方式 | 成功信号 | 失败信号/后续数据 |
|---|---|---|---|---|
| E1 roll 校正 | 固定场景下将相机 roll 设为约 -8°/0°/+8° | 数字水平仪读数 + 标定板/深蹲架真实竖线的人工几何真值 | 三端规范坐标残余 roll 的中位绝对误差 ≤1.5°，方法冲突能弃权 | 误差随场景、方向或遮挡变化；补更多视觉锚点和镜面负样本 |
| E2 斜视透视边界 | 相机 yaw：front、左/右 45°；杠铃由支架保持物理水平 | 杠铃实体水平仪/两端等高固定，人工标端点 | front 高置信帧不误报持续不平衡；45° roll-only 不被错误升级为物理高低 | 45°仍高频误报；禁止该维度或增加标定平面/PnP |
| E3 杠铃轨迹 | 只改变遮挡比例或镜面出现 | 逐帧人工端点/中心轨迹小样本 | 实测覆盖、轨迹误差、ID switch、predicted 比例分别报告；遮挡时不伪装 measured | 镜中杠铃夺轨、端点交换；补主体关联和镜面负样本 |
| E4 双哑铃身份 | 只改变双臂同步/交替及中线交叉 | 人工逐帧解剖左右轨迹 | 审核片段中 anatomical-side ID switch 接近 0；不确定时能弃权 | 交叉后换侧或把预测当实测；补腕部关联和身份恢复样本 |
| E5 Rep 端点 | 使用现有50条个人视频，逐 Rep 人工确认 turnaround | 新审核页保存 start/turnaround/end，而非旧 peak | 在冻结留出集统计 count precision/recall、exact-set、turnaround 误差和 causal latency | 旧来源不明 peak 与新真值冲突；旧报告相应声明失效 |
| E6 持续不平衡 | 同机位录制安全轻重量：对称组与受控的可见路径偏置组 | 教练双人审核 + 器械标记/安全限位，不用主观“力量不足”作真值 | 对称组低误报；偏置需跨多 Rep 同方向才触发；输出仅“不平衡” | 单帧触发或把相机角度当偏置；提高持续性门槛并分桶校准 |
| E7 镜面主体 | 同一机位只改变镜面可见/遮挡 | 人工主主体/反射框和器械归属 | 镜面出现不显著增加主体夺轨；不确定能给明确 reason | 反射轨迹被选择；补 mirror 负样本与 ROI/运动关联 |

这些门槛是首轮工程验收建议，不是文献中的普遍常数。最终门槛必须在新用户、新视频和新场地冻结测试中校准，并同时报告覆盖率、已判断准确率、错误提示率和弃权率。现有50条个人视频可用于 E3/E5 的预标与审核；E1/E2/E6/E7 需要少量受控新录制。

## 11. 单目 2D 不可声称的结论

即使检测和 Rep 对齐达到很高准确率，单目 2D 在没有额外标定/传感器/负重信息时也不能声称：

- 器械端点的厘米级真实三维高度、深度或完整空间路径；
- 关节力矩、肌肉激活、左右真实出力、最大力量或疼痛原因；
- 某侧轨迹更低就必然代表某侧“力量更强/更弱”；
- 从单帧判断疲劳、RPE/RIR、刺激落在哪块肌肉；
- front-oblique 的像素端点差经过 roll 校正后就等于物理高低差；
- learned monocular 3D 的估计就是测量真值；
- 只靠检测置信度即可百分之百排除镜中人、旁人和背景器械；
- 没有动作、变式、器械和机位上下文也能安全套用质量规则。

可以声称的是可审核的运动学观测，例如“在该机位和校正条件下，连续 4 个有效 Rep 出现同方向的两端时序差/规范图像偏置”“ROM 相对该用户同机位基线下降”“本组路径离散度增加”，并附上证据、置信度和限制。

## 12. 现在实现 / 后续实验 / 不建议

| 决策 | 内容 | 理由 |
|---|---|---|
| **现在实现** | ExecutionContext；镜像三字段；view family + handedness；原始/规范坐标并存；纯视觉 rack/场景稳定线 roll；barbell rigid-axis；逐维度 observability/abstain；个人同机位基线；跨 Rep 持续性；完整 lineage/version | 三端可实现、单次因果、无需平台传感器、能直接修复“屏幕水平=真实水平”和低置信强行判断问题 |
| **现在实现但只作 proposal** | start/turnaround/end、路径稳定、左右时序/不平衡、ROM/漂移和中性说明 | 当前缺逐 Rep turnaround 与质量真值，必须由审核页确认后才能形成真值 |
| **后续实验** | 标定平面 homography；已知 rack/靶标 PnP；dual-dumbbell producer/身份；rear/rear-oblique 专项规则；learned monocular 3D 离线对照 | 需要新增受控真值或当前生产者尚不存在，不能用接口设计冒充能力 |
| **不建议** | 在正式链路引入 IMU；跨机位统一像素阈值；侧面判断杠铃左右水平；用 homography 矫正任意 3D 点；把器械修复后的骨架再次作为独立证据；输出“右侧力量不足”；用旧 peak 当 turnaround 真值 | 超出纯视觉产品边界，或违反投影几何、证据独立性和当前数据治理边界，会产生平台差异或过度自信的错误建议 |

首版推荐是：**roll-aware + view-aware 2D causal fusion**。它不能提供完整 3D，但能在客户端可运行约束下，把可观察事实、机位限制、器械阶段、骨架策略、个人基线和多 Rep 持续性统一进 Rust，并通过弃权避免伪精确。

## 一手来源

- [OpenCV calib3d：相机模型、标定、projectPoints、solvePnP](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
- [OpenCV camera calibration tutorial](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html)
- [OpenCV homography tutorial](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)
- [OpenCV LineSegmentDetector](https://docs.opencv.org/4.x/dd/d1a/group__imgproc__feature.html)
- [OpenCV Hough line transform](https://docs.opencv.org/4.x/d9/db0/tutorial_hough_lines.html)
- [Android sensors overview](https://developer.android.com/develop/sensors-and-location/sensors/sensors_overview)
- [Android position sensors and orientation computation](https://developer.android.com/develop/sensors-and-location/sensors/sensors_position)
- [Android SensorManager reference](https://developer.android.com/reference/android/hardware/SensorManager)
- [Apple CMDeviceMotion](https://developer.apple.com/documentation/coremotion/cmdevicemotion)
- [Apple Core Motion processed device-motion data](https://developer.apple.com/documentation/coremotion/getting-processed-device-motion-data)
- [W3C Device Orientation and Motion](https://www.w3.org/TR/orientation-event/)
- [YOLOX paper](https://arxiv.org/abs/2107.08430) and [official repository](https://github.com/Megvii-BaseDetection/YOLOX)
- [ByteTrack paper](https://arxiv.org/abs/2110.06864) and [official repository](https://github.com/FoundationVision/ByteTrack)
- [RTMPose paper](https://arxiv.org/abs/2303.07399) and [official MMPose project](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)
- [VideoPose3D paper](https://openaccess.thecvf.com/content_CVPR_2019/html/Pavllo_3D_Human_Pose_Estimation_in_Video_With_Temporal_Convolutions_and_CVPR_2019_paper.html) and [official implementation](https://github.com/facebookresearch/VideoPose3D)
