# 单目 2D 骨架与杠铃轨迹：视角归一化、虚拟正面与受约束 3D

> 日期：2026-08-13
> 状态：调研完成；尚未实现或完成准确率验收
> 范围：预设动作与机位下，使用单个普通 RGB 摄像头采集的 RTMPose Halpe-26 二维骨架、杠铃轴线和时间轨迹；Web、Android、iOS 共用 Rust 算法核心。

## 1. 结论先行

**目前业界有从单目 2D 骨架序列估计 3D 人体姿态的能力，也有用两个以上手机经过标定和三角化获得更可信 3D 运动学的能力；但 MaxPower 当前链路还没有把 2D 骨架与杠铃重建为真实 3D，也不能把 45° 图像无损地转换成正面。**

用户提出的问题其实包含两个不同目标：

1. **在 45° 机位下正确判断动作。** 不一定需要完整 3D。首选视角感知的 2D/2.5D：保留真实斜杠轴、校正相机 roll、使用同机位基线与时间变化，并对不可观测维度弃权。
2. **估算“如果从正面拍会看到什么”。** 这是新视角重投影问题。除非目标点都在一个已知平面上，否则必须先估计 3D，再投影到虚拟正面相机；不能只把二维点或杠铃线旋转 45°。

因此推荐的产品路线不是立刻用一个黑盒“3D 模型”替换现有链路，而是分三层：

- **现在可做：视角归一化 2D（view-normalized 2D）**，用于 Rep、阶段、同机位 ROM、路径稳定和持续投影不对称。
- **卧推等近似平面动作可实验：动作平面矫正（2.5D planar rectification）**，只矫正已标定的杠铃扫掠平面，不能拿同一变换矫正全身。
- **需要跨机位统一或虚拟正面时：受约束单目 3D**，把时序 2D→3D 模型与骨长、刚性杠铃、双手关联、动作平面和重投影误差共同优化；结果必须带不确定性。

真正需要厘米级世界坐标或可作为 3D 真值的能力，首选**同步双机位/多机位标定与三角化**。OpenCap 的已发表系统就是用两个或更多手机、相机内外参标定、同步 2D 关键点和三角化，再经过时序模型与肌骨约束得到 3D 运动学，而不是从一个 45° 视频直接“转正面”。[OpenCap, PLOS Computational Biology, 2023](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)

## 2. 为什么 45° 下的杠铃天然可能是斜的

针孔相机将三维点投影为二维点：

\[
s\,p=K[R\mid t]P,
\]

其中三维点 \(P\) 先经相机外参 \(R,t\) 变换，再按深度除法投影，并应用相机内参 \(K\) 与镜头畸变。OpenCV 的相机模型、`projectPoints`、标定和 PnP 都使用这套关系。[OpenCV calib3d](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)

所以 45° 画面中一根现实里水平的杠铃出现图像斜率，可能同时来自：

- 相机绕光轴的 roll；
- 左右杠端到相机的深度不同和透视缩短；
- 相机 yaw/pitch；
- 杠铃在运动中真实旋转或两端不同步；
- 镜头畸变、滚动快门、遮挡和端点检测噪声。

**单帧的一条二维线无法唯一分离这些原因。** 因此：

- UI 应绘制检测到的真实 \(x_1,y_1,x_2,y_2\)，不能为了“看起来正确”强行画水平线；
- 规则不能把原始 `y1 - y2` 命名为真实左右高度差；
- 即使减去准备位的静态斜率，也只消除了静态偏差。杠铃向胸部移动时深度改变，动态透视仍可能改变斜率。

正确名称应是 `image_space_bar_angle`、`baseline_corrected_angle` 或 `view_normalized_endpoint_residual`；没有完成 3D 标定前，不应叫 `world_height_difference`。

## 3. 哪些转换可行，哪些不成立

| 方法 | 能解决什么 | 不能解决什么 | 对 MaxPower 的建议 |
|---|---|---|---|
| 画面旋转/仿射变换 | 修正相机 roll、裁剪和缩放 | 不能恢复深度，也不能把 45° 变成真实正面 | 必做的预处理，但不是 3D |
| 同机位基线差分 | 消除固定机位下的静态杠轴斜率和个人起始差异 | 不能完全消除随深度变化的动态透视 | 立即用于 2D 质量特征 |
| 平面 homography | 把一个已知三维平面矫正到正视图 | 人体各关节和杠铃通常不共面；离开标定平面就失效 | 可实验性用于卧推杠铃扫掠平面，不用于全身统一矫正 |
| 单目时序 2D→3D lifting | 根据人体运动先验，从二维关键点序列估计相机相对 3D | 单目深度本来多解；训练域外、遮挡和仰卧动作可能错误，不是测量真值 | 候选模型，必须用健身域同步多视角真值验证 |
| 单目 3D + 刚体/骨长/动作约束 | 减少多解、抑制骨架突变，让骨架和杠铃互相约束 | 约束不能凭空创造被投影丢失的信息；强先验也可能“合理但错误” | 推荐的中期研究路线 |
| 标定双机位/多机位三角化 | 物理锚定的 3D 关键点和杠端轨迹 | 需要两台设备、同步和标定，不是单摄 MVP | 用于建立真值与高等级能力 |
| 深度相机/RGB-D | 直接增加深度观测 | 设备覆盖、功耗、平台与传感器差异 | 可选增强，不作为三端统一最低能力 |

OpenCV 明确说明 homography 关联的是两个平面；只有目标在一个平面上，才可用该平面变换做透视矫正。相机姿态求解则需要已知三维物点、对应二维像点、相机内参和畸变参数。[OpenCV homography tutorial](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)

因此只知道“这是左前 45°”还不够。45° 是一个粗机位类别，不包含焦距、精确 yaw/pitch/roll、相机位置、主体距离和镜头畸变。仅凭杠铃两个共线端点和已知杠长，也不能唯一恢复完整三维姿态；它们可以形成约束，但不满足一般 PnP 所需的充分三维—二维对应关系。

## 4. 单目 3D 已经发展到什么程度

### 4.1 2D 骨架序列可以被“抬升”为 3D

VideoPose3D 展示了用时间卷积把连续 2D 关键点抬升为 3D 人体姿态；MotionBERT 则从有噪声、部分缺失的 2D 观测中学习 3D 人体运动表示。它们说明“2D 视频→3D 姿态估计”是现实能力，不是必须先有深度相机。[VideoPose3D, CVPR 2019](https://openaccess.thecvf.com/content_CVPR_2019/html/Pavllo_3D_Human_Pose_Estimation_in_Video_With_Temporal_Convolutions_and_CVPR_2019_paper.html)，[MotionBERT, ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Zhu_MotionBERT_A_Unified_Perspective_on_Learning_Human_Motion_Representations_ICCV_2023_paper.html)

MMPose 官方推理文档也提供 `human3d`（MotionBERT）两阶段链路：先做 2D pose，再做 2D-to-3D lifting；MMPose 还已发布 RTMW3D 这类实时 3D whole-body 模型。[MMPose inference guide](https://github.com/open-mmlab/mmpose/blob/main/docs/en/user_guides/inference.md)，[MMPose official repository](https://github.com/open-mmlab/mmpose)

但这里的“3D”需要区分：

- 模型常输出 root-relative 或 camera-relative 3D；
- 它不自动知道健身房世界坐标、真实重力、真实厘米尺度或虚拟正面相机；
- 从一个 2D 投影恢复 3D 天然存在多解，模型用训练数据中的人体与动作先验选择一个可能解；
- 常用数据集以站立、行走和日常动作居多，正面仰卧卧推、杠铃遮挡、镜面和大重量慢速 Rep 是明显域偏移，必须专项微调或验证。

因此，单目 3D 输出应是 `estimated_3d`，并附带重投影误差、关键点置信度、时序稳定性和假设不确定性；不能直接晋升为 `measured_world_3d`。

### 4.2 2D 骨架和杠铃应做联合约束，而不是简单替代

对于已知动作为杠铃卧推，人体和器械提供了很强的结构先验：

- 左右手在持杠阶段应靠近同一根刚性轴；
- 杠铃实体长度在时间上不变；
- 人体骨段长度在一个 session 内基本不变；
- 肩、肘、腕和杠端运动连续，不应逐帧突然换成另一个合理人体；
- 杠铃中心和腕部运动的阶段、反向点应高度相关；
- 卧推的主要运动可近似发生在有限的动作平面/走廊内，但真实动作允许少量前后路径。

这些约束适合放进一个滑动窗口优化器或状态空间模型：它同时最小化 2D 重投影误差、骨长变化、杠长变化、手—杠关联误差和不合理加速度，并保留多个可能的深度假设。器械不是把低置信腕点直接“改成”杠铃点，而是参与对整段三维轨迹的联合估计。

这正是比“骨架优先/器械优先”更合理的融合方式。但它仍然只能提高估计一致性，不能绕过单目多解。

## 5. “转成正面”在数学上需要哪些步骤

如果最终确实需要输出一个虚拟正面骨架/杠铃轨迹，完整链路应为：

1. **相机内参**：焦距、主点、镜头畸变；至少按设备/分辨率建近似标定。
2. **相机外参或动作坐标系**：估计相机相对卧推凳、深蹲架或人体标准坐标系的 yaw/pitch/roll 和位置。
3. **三维重建**：由 2D 时序模型估计人体 3D，同时用刚性杠铃、手—杠、骨长与动作先验优化。
4. **定义虚拟正面相机**：固定其朝向、距离、焦距和画面尺度。
5. **重新投影**：把估计的三维人体点与杠端投影到虚拟正面相机。
6. **不确定性门控**：如果多个 3D 解都能解释输入 2D，却在虚拟正面相差很大，则不能输出唯一“正面真相”。

对于确实近似共面的杠铃扫掠面，可用经过标定的 homography 把步骤 3–5 简化成平面到平面的映射。但这个 homography 只适用于该杠铃运动平面，不能同时拿来矫正肩、肘、髋、膝等不同深度的人体点。

产品层面更稳的选择通常不是先生成一段“正面视频”，而是先生成**相机尽量不变的规范特征**：

- 杠铃中心沿动作轴的规范位移；
- 左右端点相对各自基线的位移与反向时差；
- 杠轴相对该机位参考轴的残差；
- 肩—肘—腕的相对角度和时序；
- 多 Rep 的持续偏置、轨迹离散度和组内漂移；
- 每个特征是 raw 2D、view-normalized 2D、plane-rectified 还是 estimated 3D。

规则引擎比较这些规范特征，比先合成虚拟正面、再从合成结果重新提特征少一层误差。

## 6. MaxPower 当前真实能力与缺口

代码检查得到以下事实：

1. 当前客户端 RTMPose Halpe-26 是 **2D 模型**。`RtmposeEngine.ts` 将每个点的 `z` 写为 `0`，并输出空 `worldLandmarks`。因此 Halpe-26 的 26 个点不等于 26 个三维点。
2. 当前 Rust 视觉杠铃追踪器内部保留 `x1,y1,x2,y2`、斜率和 `center_y`，所以它能够表示 45° 画面中的斜杠轴，而不是只能表示水平线。
3. 但现有离线质量输入适配器 `measuredAxisToEquipmentObservation` 会把测量轴压成以 `centerY` 为中心的水平轴对齐 bbox，丢掉 `y1/y2` 斜率。审核证据另行保留原始端点，Rust visual-axis ABI 也能读取端点；这意味着**显示数据和通用质量规则实际消费的数据还不完全一致**。
4. 现有动作契约已经区分 `front`、`frontLeft45`、`frontRight45`，具备按机位选择规则/Profile 的基础；但尚未发现相机内外参、动作坐标系、单目 3D lifter、三维杠铃状态或虚拟正面重投影模块。
5. 当前 45° 卧推冻结策略中的 `equipment_only` 是某次评估策略，不代表 RTMPose 已经提供 3D；原始 2D Halpe-26 仍只在审核证据中保留。

结论是：**MaxPower 当前属于“view-aware 2D + 2D 杠铃轴 + 时序 Rust 规则”，还不是“2D 骨架和杠铃联合恢复真实 3D”。**

相关代码位置：

- [`src/pose/RtmposeEngine.ts`](../../src/pose/RtmposeEngine.ts)
- [`rust/motion-sdk/src/visual_equipment.rs`](../../rust/motion-sdk/src/visual_equipment.rs)
- [`tools/motion-quality/runnerInputs.ts`](../../tools/motion-quality/runnerInputs.ts)
- [`tools/motion-quality/rustFullDataProposalRunner.ts`](../../tools/motion-quality/rustFullDataProposalRunner.ts)
- [已有视角感知器械与相机校正研究](./2026-08-13-view-aware-equipment-balance-camera-calibration-research.md)
- [已有多视角轨迹研究](./2026-08-06-multi-view-trajectory-from-front.md)

## 7. 推荐的数据契约

不应让一种“规范坐标”覆盖原始观测；每层都应保留来源和不确定性：

```text
CameraContext
  camera_model_id
  intrinsics? / distortion?
  view_bucket                  # front/frontLeft45/frontRight45...
  estimated_yaw/pitch/roll?
  calibration_source
  calibration_confidence

BarAxis2D
  x1/y1/x2/y2
  center_x/center_y
  image_angle
  measured/predicted
  confidence/uncertainty

ViewNormalizedFrame
  coordinate_frame_id
  roll_corrected_points
  baseline_bar_angle
  bar_angle_residual
  left_endpoint_delta
  right_endpoint_delta
  center_path
  observability

Estimated3DFrame
  body_points_3d
  bar_endpoints_3d
  frame = camera_relative | exercise_relative | world_metric
  scale_status
  reprojection_error
  hypothesis_count
  covariance/uncertainty
  constraint_residuals

VirtualFrontProjection
  source_3d_frame_id
  virtual_camera_id
  projected_pose/bar_axis
  projection_uncertainty
```

Rust 应负责规范特征、约束融合、状态估计、可观测性和规则输出；Web/Android/iOS 只负责同语义的模型推理与相机适配。任何 learned 3D 模型必须能导出并在三端目标运行时执行，Python 只能作为离线对照。

## 8. 建议实施顺序

### 阶段 A：先修正 2D 语义，不等待 3D

1. 全链路保留杠铃 `x1,y1,x2,y2`，规则输入不得再压成水平 bbox。
2. 显示原始杠轴；另行显示 roll-corrected 或 baseline-corrected 轴，颜色和标签必须区分。
3. 建立相同动作、变式、器械、机位、镜像状态和设备方向的基线。
4. 用每侧相对自身准备位的位移，而不是原始两端像素 y 差：

   \[
   \Delta y_L(t)=y_L(t)-\operatorname{median}(y_L^{ready}),
   \quad
   \Delta y_R(t)=y_R(t)-\operatorname{median}(y_R^{ready}).
   \]

5. 比较 `ΔyL/ΔyR` 的反向时间、行程、跨 Rep 持续残差，并把结果命名为“该机位下的投影不对称”。
6. 用杠铃中心轨迹判阶段，用骨架解释身体策略；不把杠铃轴线强制改写成人体腕肘点。

这层足以改进当前 45° 卧推 Rep、离心/向心、路径稳定和持续偏置，不需要先完整 3D。

### 阶段 B：卧推动作平面矫正实验

1. 固定相机和卧推凳，采集一次标定板或已知 rack/bench 几何。
2. 估计杠铃主要扫掠平面到规范正面的 homography。
3. 只矫正杠端与杠中心；骨架继续用 exact-view 2D 或另走 3D。
4. 当杠铃明显离开平面、相机移动或重投影误差过高时弃权。

### 阶段 C：受约束单目 3D 候选

1. 评估 MotionBERT、RTMW3D 或更小的因果时序 lifter；明确其点位拓扑、是否需要未来帧、相机坐标定义、ONNX 导出与三端延迟。
2. 训练/微调健身域，至少覆盖仰卧、45°、镜面、杠铃遮挡、不同体型和力竭慢速 Rep。
3. 在 Rust 中加入骨长、杠长、双手关联、动作平面和时序约束优化。
4. 输出相机相对 3D 与不确定性；在未完成标定前不输出厘米级世界结论。

### 阶段 D：决定是否可以正式“转正面”

只有同步正面真值测试通过后，才允许把受约束 3D 投影为虚拟正面并用于跨机位统一标准。否则继续采用 exact-view Profile 或 view-normalized 特征。

## 9. 最小可验证实验

共同未知的问题应转成一个单变量实验：**固定同一动作和相机，只改变视角归一化方法。**

### 采集

- 同一组卧推同时用正面、左前 45°、右前 45° 三台固定相机录制；至少正面与一个 45° 同步。
- 录制前拍一次 checkerboard/标定板，保存相机内外参。
- 在杠铃两端添加易识别但不影响安全的视觉标记；人工审核每帧端点小样本和每 Rep 的 start/turnaround/end。
- 覆盖轻重量标准组、受控左右时序差、正常杠路径前后变化、遮挡和镜面；不要用“力量不足”作为真值。

### 三个候选仅用 45° 输入

1. raw 2D；
2. roll + 同机位基线 + 动作平面矫正；
3. 受约束单目 3D → 虚拟正面。

### 对照真值

- 实际同步正面视频回答“正面会看到什么”；
- 标定双视角/三视角三角化回答三维杠端和人体关键点；
- 人工端点只回答 Rep 阶段，不冒充 3D 真值。

### 指标

- 虚拟正面杠端和骨架的 2D 重投影误差；
- 杠轴角度误差、左右端点相对位移误差；
- turnaround 时间误差与 Rep exact-set；
- 3D MPJPE/杠端三维误差（仅多视角真值可用时）；
- 覆盖率、弃权率、镜面/遮挡最差分桶；
- clean set 的错误不对称提示率。

成功信号不是“生成的骨架看起来像人”，而是候选 3 相对候选 2 在冻结同步测试中稳定降低正面重投影和阶段误差，且不会增加 clean set 错误提示。如果 2.5D 已达到同样质量，就没有必要为 MVP 承担完整 3D 的模型、延迟和域偏移成本。

## 10. 最终决策

对当前问题的直接答案是：

- **45° 下直接理解原始斜轨迹确实有问题，但不等于必须先做完整 3D。**
- 当前首要缺口是把“原始 2D、机位校正后的 2D、估计 3D”分层，并让全链路保留真实杠轴端点。
- Rep 与离心/向心主要可由 2D 杠铃中心时序可靠完成；同机位稳定度可用视角归一化 2D 完成。
- 想把左/右 45° 合并为同一个物理标准，或回答“正面看应该怎样”，就需要动作平面标定或受约束 3D；不能靠把 2D 坐标旋转、镜像或画水平线。
- 对整个骨架做虚拟正面，推荐“时序单目 3D + 人体/杠铃联合约束 + 相机标定 + 重投影”，并用同步真实正面/多视角三角化验收。
- 在该验收完成前，产品应该输出“该机位下持续出现的投影轨迹差异”，不应输出“真实三维右端低了多少”或由此直接推断某侧力量。

## 11. 一手来源

- [OpenCV calib3d：相机模型、标定、投影、PnP 与三角化](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html)
- [OpenCV：Homography 基础与适用平面](https://docs.opencv.org/4.x/d9/dab/tutorial_homography.html)
- [Pavllo et al., VideoPose3D, CVPR 2019](https://openaccess.thecvf.com/content_CVPR_2019/html/Pavllo_3D_Human_Pose_Estimation_in_Video_With_Temporal_Convolutions_and_CVPR_2019_paper.html)
- [Zhu et al., MotionBERT, ICCV 2023](https://openaccess.thecvf.com/content/ICCV2023/html/Zhu_MotionBERT_A_Unified_Perspective_on_Learning_Human_Motion_Representations_ICCV_2023_paper.html)
- [MMPose 官方 2D/3D 推理文档](https://github.com/open-mmlab/mmpose/blob/main/docs/en/user_guides/inference.md)
- [MMPose 官方仓库与 RTMW3D 发布信息](https://github.com/open-mmlab/mmpose)
- [Uhlrich et al., OpenCap, PLOS Computational Biology 2023](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)
