# 胸、腿训练的 `simulated_kinematic_prior`：单目 2D 相位与 identity 边界

日期：2026-08-04
范围：为接下来的腿部训练（优先深蹲、腿举、腿屈伸、腿弯举、罗马尼亚硬拉、臀推、提踵）和未来胸部训练（卧推、哑铃卧推、上斜哑铃卧推、器械推胸、绳索夹胸、俯卧撑）定义**可模拟、可观测、可由真实训练录像校准**的最小先验。本文不修改产品代码。

## 结论

可以先为这些动作建立 `simulated_kinematic_prior`，但第一版应只包含：

- 一个 rep 的**相位顺序**与反向回程；
- 同机位单目骨架中应出现的**方向关系**（例如膝角从屈曲走向伸展），以及关键点不可见时的 `unknown`；
- 不可静默合并的动作、器械、设置和机位 identity；
- 用于合成测试、状态机初始化及后续真实数据拟合的**无量纲轨迹族**。

它不是标准动作、临床建议、受伤风险模型或“姿势正确率”。原始研究直接说明 stance、脚角、负重、器械约束、膝/髋/躯干运动和 bench press 的轨迹会随条件改变；因此这些条件必须是 profile 的一部分，不能把某篇研究的均值或某次模拟的终点当作人体阈值。[Lorenzetti et al., 2018](https://doi.org/10.1186/s13102-018-0103-7)；[Escamilla et al., 2001](https://doi.org/10.1097/00005768-200109000-00020)；[Duffey & Challis, 2007](https://doi.org/10.1519/R-19885.1)。

优先顺序应与用户未来训练相符：**先建立明日实际要练的腿部 identity 和先验；录像进来后，用该次训练的人工 rep 边界校准同一 profile。** 胸部先得到未校准的模板，不再围绕已练过的背、肩动作扩展。

## 证据口径与单目边界

下文每项均标记为：

- **[证据]**：原始运动学/动力学研究或官方技术文档直接支持“该条件会改变运动/该测量存在”。它**不**给本产品的合格数值。
- **[实现假设]**：为让单目 2D 状态机可运行而作的方向、机位或特征选择；需要由本项目真实视频的 held-out capture 验证。
- **[不可观测]**：当前的 MediaPipe 单目关键点不能可靠给出的量。

MediaPipe Pose Landmarker 给出图像 landmark、推定 world landmark 以及 `visibility/presence`；官方并未把它定义为标记式 3D 真值或动作质量评分。[官方文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker) 所有文中的“膝角/髋角/肘角”因此只能是**图像投影代理**，不能伪装成按 ISB 关节坐标系报告的三维解剖角。[Wu et al., ISB 建议](https://doi.org/10.1016/j.jbiomech.2004.05.042)

共同规则：

1. 只在身份、机位和关键点可见性均匹配时比较；否则 `profile_mismatch` 或 `unknown`。
2. 方向使用相对量，不使用像素绝对值。除非 identity 锁定 `cameraUpright=true` 和近似侧视/正视，否则不能把 screen-y 当作世界垂直方向。
3. “下降/上升”“外展/内收”等二维符号取决于镜像与相机面；模板存储规范化的 body-local / image-local 方向，并将 `isMirrored` 写入 identity。
4. 关键点遮挡、出画或低 visibility 时保留缺失；禁止用模拟轨迹、另一侧肢体或插值填成观察真值。
5. 任何数值 ROM、速度、左右同步容差和停顿时长均为待校准参数，首版为 `null`，不是由论文或模拟器填入。

## 一套足够小的 2D 特征语言

以下是特征的定义建议，不是已上线实现。

| 特征 | 2D 定义（均归一化或无量纲） | 最适合机位 | 可支持的语义 | 不能支持的语义 |
|---|---|---|---|---|
| `knee_angle_2d` | `∠(hip, knee, ankle)` | 同侧近似侧视 | 膝屈/伸的相对阶段 | 膝内/外翻、真实关节载荷 |
| `hip_opening_angle_2d` | `∠(shoulder-or-torsoAnchor, hip, knee)` | 同侧近似侧视 | 髋由屈向伸的相对阶段 | 骨盆前/后倾、腰椎与髋的三维分工 |
| `elbow_angle_2d` | `∠(shoulder, elbow, wrist)` | 侧视或无遮挡的斜侧 | 肘屈/伸方向 | 前臂旋前/旋后、三维肩角 |
| `wrist_to_shoulder_xy` | wrist 相对同侧 shoulder 的局部向量 / torso length | 正视、侧视分别保存 | 手/把手的相对行程方向 | 杠铃、钢索或器械实际轨迹 |
| `wrist_pair_separation` | `|x(left wrist)-x(right wrist)| / shoulderWidth` | 正/后视 | 夹胸的开合方向 | 肩胛三维运动、是否“夹到位” |
| `pelvis_or_shoulder_height` | 中点相对固定脚踝/足部锚的 image-y，须相机竖直且近侧视 | 侧视 | 深蹲、臀推、俯卧撑、提踵的整体升降 | 世界高度、深度、外力 |
| `heel_to_forefoot_height` | heel 相对 toe/foot-index 的垂直代理 | 侧视 | 提踵的上升/下降 | 踝关节真实角、足内外翻 |
| `trunk_segment_pitch_2d` | shoulder-midpoint 到 hip-midpoint 的投影方向 | 侧视 | RDL / 深蹲的躯干方向变化 | 脊柱节段角、椎间载荷 |

`shoulderWidth`、`torsoLength` 只用作尺度归一化，不能推断身体成分、力量或医学状态。

## 动作级相位与最小可观测约束

“向心/离心”是该器械相对负载的运动语义；在视频里只将其实现成起点、相反方向的极值、回到起点三段，不能据此推断肌肉激活。表中的 `↑/↓` 指**该特征数值**，不是屏幕方向。

### 腿部

| 动作（精确 profile） | 一个 rep 的相位顺序 | 单目 2D 可用的方向约束 | 证据与实现边界 |
|---|---|---|---|
| 深蹲（指定高/低杠或徒手；指定站距、脚尖角） | 最小膝屈/顶部 → 下降 → 最大膝屈/底部 → 起立 → 最小膝屈/顶部 | 下降：`knee_angle_2d ↓`、`hip_opening_angle_2d ↓`；起立反向。锁定侧视时，pelvis/shoulder 相对足部先下降再上升。正视只允许左右可见性与膝-踝投影关系作辅助，不用来判断深度。 | **[证据]** 原始运动捕捉研究以最小膝屈→最大膝屈→最小膝屈定义 squat/leg-press cycle，因此“极值与反转”比固定角度更有依据。[Sjöberg et al.](https://doi.org/10.3389/fspor.2021.686335) 另一项 3D 实验说明站距、脚角、经验和负重会改变运动/负荷。[Lorenzetti et al.](https://doi.org/10.1186/s13102-018-0103-7) **[实现假设]** 用两个 2D 夹角及高度极值定义 rep。**[不可观测]** 膝内外翻、腰椎、剪力和疼痛风险。 |
| 腿举（45°/水平/垂直分别建档；指定 footplate 高度、站距） | 最小膝屈/顶部 → sled 向身体回程 → 最大膝屈/底部 → 推离 → 顶部 | 侧视且相机平面近似平行 sled rail：回程中 `knee_angle_2d ↓`、`hip_opening_angle_2d ↓`，推程反向；可用踝相对髋的沿轨道投影作冗余特征。 | **[证据]** 同一原始 motion-capture protocol 将腿举以最小/最大膝屈及反转划分 cycle。[Sjöberg et al.](https://doi.org/10.3389/fspor.2021.686335) 不同脚位和站距会改变腿举肌力/膝部动力学；腿举与深蹲的运动和负荷不应共享一条数值轨迹。[Escamilla et al.](https://doi.org/10.1097/00005768-200109000-00020)；[Jakobsen et al.](https://pubmed.ncbi.nlm.nih.gov/34423289/) **[实现假设]** 未检测 sled 时以人体关节方向计数。 |
| 腿屈伸（坐姿机器，指定轴位置、背垫角、单/双侧） | 膝屈的底部 → 膝伸的顶部 → 返回屈曲底部 | 近侧视：向心 `knee_angle_2d ↑`；小腿/踝相对膝沿 lever arc 远离髋；回程反向。 | **[证据]** 原始双透视研究将 seated knee extension 与闭链 squat 区分，并显示负重/开链条件改变膝胫骨运动。[Tsai et al.](https://doi.org/10.1016/j.medengphy.2022.103766) **[实现假设]** 用投影膝角方向做分段。不得把它用于 ACL/PFJ 风险结论。 |
| 腿弯举（俯卧/坐姿/站姿、单/双侧分别建档） | 膝接近伸展的底部 → 膝屈曲 peak → 返回伸展 | 近侧视：curl 中 `knee_angle_2d ↓`、ankle-to-hip 距离通常 ↓；return 反向。 | **[实现假设]** 这是由“knee flexion”动作语义导出的候选特征；本轮没有找到可直接转为单目阈值的目标器械逐帧公开原始数据。只可做方向先验，须优先用真实训练校准。坐姿/俯卧/站姿绝不共用 profile。 |
| 罗马尼亚硬拉（杠铃/双哑铃、双/单腿分别建档） | 直立顶部 → hip hinge 底部 → 髋伸展回顶部 | 近侧视：下降时 `hip_opening_angle_2d ↓`、`trunk_segment_pitch_2d` 向前俯；上升反向。`knee_angle_2d` 只记录为辅助，**不**强制其幅度。 | **[证据]** 3D 研究显示 conventional 与 Romanian deadlift 在下肢净关节力矩和肌电上不同；RDL 的膝/踝屈曲也更小，不能合并。[Camara et al.](https://doi.org/10.1016/j.jesf.2018.08.001) **[实现假设]** 以髋开合而非手腕 screen-y 作为主相位，因为杠铃/手与相机的投影不稳定。**[不可观测]** 脊柱曲率、杠铃离身体距离和腰部载荷。 |
| 传统硬拉（杠铃、起始高度、站距与握法分别建档） | 地面起始 → 离地与髋膝伸展 → 顶部锁定 → 受控回地面 | 固定侧视：离地至站直时 `hip_opening_angle_2d ↑`、`knee_angle_2d ↑`，躯干相对竖直的倾角总体减小；下放反向。膝角是与 RDL 区分的相位证据，不是锁死或深度的质量阈值。 | **[证据]** 同一 3D 研究显示 conventional 与 Romanian deadlift 的膝/踝运动及下肢关节力矩不同，因此不能复用 RDL profile。[Camara et al.](https://doi.org/10.1016/j.jesf.2018.08.001) **[实现假设]** 用髋角 + 膝角作为双主信号，躯干倾角作辅助。**[不可观测]** 杠铃贴身程度、脊柱曲率、地面离杆高度和腰部载荷。 |
| 杠铃臀推（bench height、肩背支撑、脚位、杠铃/机器分别建档） | 髋屈的底部 → 髋伸的顶部 → 回到底部 | 近侧视：向心 `hip_opening_angle_2d ↑`，pelvis 相对足部高度 ↑；回程反向。`knee_angle_2d` 仅作稳定性特征。 | **[证据]** 对 70% 1RM barbell hip thrust 的 3D 运动/动力学研究直接量测踝、膝、髋与 pelvis-trunk 关节，并以杠铃竖直速度开始、最大竖直位移结束定义 lifting phase。[Brazil et al.](https://doi.org/10.1371/journal.pone.0249307) **[实现假设]** 用 pelvis height + 髋投影角确定 peak。**[不可观测]** 后链肌肉分担和腰椎/骨盆真实三维角。 |
| 提踵（站姿/坐姿、台阶/平地、单/双侧分别建档） | 踝背屈/低点 → plantar-flexion/高点 → 回到低点 | 近侧视：向心 `heel_to_forefoot_height ↑`，踝的 plantar-flexion 投影代理朝指定方向；回程反向。必须保留 knee posture（直/屈），不以 2D 踝角作唯一判定。 | **[证据]** heel raise 研究直接测量踝膝髋初始角、踝屈伸 ROM 和 cycle timing，脚位会改变其他关节起始条件。[Sahagian et al.](https://pubmed.ncbi.nlm.nih.gov/27182353/) 另一项 3D 研究显示膝角会改变最大 heel-rise height/踝 ROM。[Jan et al.](https://pubmed.ncbi.nlm.nih.gov/23810663/) **[实现假设]** 以 heel height 主计数，因屏幕投影踝角脆弱。 |

### 胸部

| 动作（精确 profile） | 一个 rep 的相位顺序 | 单目 2D 可用的方向约束 | 证据与实现边界 |
|---|---|---|---|
| 平板杠铃卧推（平板、握距、无辅助者路径；训练式与 powerlifting 式分档） | 杠/腕在顶部 → 下放至底部 → 推至顶部 | 固定近侧视、画面竖直时：下放 `elbow_angle_2d ↓` 且 wrist 相对上躯干向下/向胸部接近；推起反向。双腕的平均轨迹优先于单腕；左右不对称只作 coverage 记录。 | **[证据]** 3D bench 研究发现组内疲劳会改变 bar path 与速度，且受试者差异很大；不能用一条“理想 J 曲线”。[Duffey & Challis](https://doi.org/10.1519/R-19885.1) **[实现假设]** 无杠铃 landmark 时用 wrist + elbow 代理 bar。**[不可观测]** 杠铃是否触胸、握距、肩胛运动、spotter 接触，除非单独检测。 |
| 平板哑铃卧推（中立/旋前握、双/单侧分别建档） | 双腕顶部 → 下放底部 → 双腕推回顶部 | 同侧/斜侧：每侧 `elbow_angle_2d` 在推程 ↑，wrist 相对肩的压向/离体方向反转；不要求两只哑铃完全同步。 | **[实现假设]** 只复用“上肢 press 相位”，不复用杠铃的横向路径/双手耦合；哑铃可独立运动，必须储存 `leftRightPhaseLag`。不存在可将杠铃研究数值直接迁移至此的证据。 |
| 上斜哑铃卧推（bench angle 分桶） | 双腕顶部 → 下放底部 → 推回顶部 | 与平板哑铃相同的肘伸方向；相对腕位应在**沿背垫坐标系**的 press axis 上比较，而非和水平平板共用 screen-y 阈值。 | **[实现假设]** 由于背垫角会改变相机投影和肩部初始位置，`benchAngleBand` 是硬 identity。不得从平板模板推断上斜“正确肩角”。 |
| 器械推胸（selectorized/plate-loaded、converging/non-converging、座椅/背垫/把手高度） | 把手近胸底部 → 前推 peak → 受控回近胸 | 近侧视：`elbow_angle_2d ↑`；wrist/hand 相对 shoulder 沿机器主推轴远离躯干，return 反向。若机器 lever 遮挡手腕，返回 `unknown`。 | **[实现假设]** “主推轴”必须由固定机位和机器型号/路径建立；不同器械的 handle path 不可共享。公开 bench-press 证据不等价于器械 path constraint。 |
| 绳索夹胸（立姿/坐姿；low-to-high、mid、high-to-low；单/双臂） | 手在开放位 → 向中线/相遇 peak → 受控打开 | 正/后视、双臂无遮挡：concentric `wrist_pair_separation ↓`，双肘可维持近似常角但不强制；return separation ↑。单臂 profile 改用 wrist-to-sternum-proxy 距离。 | **[实现假设]** 这是最适合以“手间距”而非肩角检测的动作；没有目标动作的可迁移 3D population corridor 时，开放位、肘屈角和高度只能留作参数范围。钢索高度、站距、身体朝向与交叉/不交叉是硬 identity。 |
| 俯卧撑（标准/跪姿/上斜/负重/把手分别建档） | 顶部支撑 → 身体下降底部 → 推回顶部 | 近侧视、足与手可见：下降 `elbow_angle_2d ↓` 且 shoulder/pelvis 相对足/手锚下降；推程反向。正视无法观察前后行程，不应单独用于完整 rep。 | **[证据]** 原始实验表明 hand 相对 shoulder、手臂运动平面、足位置和速度改变 push-up joint loading。[An et al.](https://pubmed.ncbi.nlm.nih.gov/2334780/) 训练者研究也以位移、时间、速度比较 push-up/bench press，但不产生姿势阈值。[van den Tillaar](https://doi.org/10.1055/a-1001-2526) **[实现假设]** 侧视的 shoulder height + elbow angle 是分段代理。**[不可观测]** 躯干是否“中立”、肩胛旋转或关节负荷。 |

## identity：必须分开，不能被“胸/腿大类”吞掉

沿用项目已有 `exerciseId / capturePosition / variation / trainingSide / equipment / coordinateSystem / featureSchemaId / poseModelVersion` 的 hard gate，并扩展为以下最小合同。每一项不一致都不是“调个参数试试”，而是新 profile 或 `profile_mismatch`。

```text
exerciseId                 # 例如 back_squat / leg_press / cable_fly
movementFamily             # squat / knee_extension / hip_hinge / horizontal_press … 仅检索用，不用于匹配
variation                  # high_bar / low_bar；flat / incline；prone / seated；bilateral / unilateral …
trainingSide               # bilateral / left / right；单侧不可借另一侧覆盖
equipment.family           # free_weight / selectorized / plate_loaded / cable / bodyweight
equipment.pathConstraint   # free / fixed_lever / converging_lever / sled_rail / pulley
equipment.handleOrBar      # straight bar / dumbbells / neutral handles / ankle pad …
equipment.modelOrGeometry  # 厂牌型号；未知至少记录 geometry class
setup.seatBackAngleBand    # 坐姿屈伸、器械推胸、上斜哑铃
setup.benchHeightBand      # 臀推
setup.footplateHeightBand  # 腿举
setup.stanceWidthBand
setup.footAngleBand
setup.pulleyHeightBand     # 绳索夹胸
setup.handSpacingBand      # 杠铃卧推；如未知，不能做强轨迹比较
setup.loadBand / tempoBand # 先作为 metadata；若声称数值 corridor，必须成为匹配字段
capturePosition            # left_side / right_side / front / rear / left_45 / right_45
cameraUpright / isMirrored / projectionClass
coordinateSystem / featureSchemaId / poseModelVersion
phaseStartConvention       # 每个动作明确从 top 还是 bottom 开始
```

特别容易错合并的边界：

- 深蹲的 high-bar、low-bar、前蹲、徒手深蹲；腿举的 45°、水平、垂直；腿弯举的俯卧、坐姿、站姿；提踵的站姿、坐姿、台阶。
- RDL 与 conventional deadlift；barbell 与 dumbbell RDL；barbell hip thrust 与机器臀推。
- 平板杠铃、平板哑铃、上斜哑铃；器械 fixed/converging press；cable fly 的拉力方向；普通、跪姿、上斜和负重俯卧撑。
- 侧视与正视。前者可以观察多数矢状面阶段，后者更适合双手开合/左右 visibility；两者绝不共享数值轨迹。

## 最小参数化轨迹模板

第一版不需要动力学仿真或唯一“标准曲线”。对单一精确 identity 生成 32 个节点（去程 16、回程 16）的特征模板即可：

```text
SimulatedKinematicPrior {
  identity: ExactProfileIdentity,
  source: "simulated_kinematic_prior",
  calibrationStatus: "uncalibrated",
  evidenceStatus: "phase_direction_only",
  phase: [start, extremum, end],
  features: {
    featureId: {
      start: null-or-symbolic-baseline,
      extremumDirection: +1 | -1 | "no_required_change",
      amplitude: parameterRangeWithoutAcceptanceMeaning,
      curve: monotone_smoothstep_out_and_back,
      visibilityContract: required_landmarks,
      evidence: [source URLs],
      status: evidence_backed_direction | implementation_assumption
    }
  },
  parameters: [phaseDurationRatio, dwellRatio, amplitude, leftRightPhaseLag,
               cameraNoise, dropoutMask],
  prohibitedClaims: [...]
}
```

对任一主特征 `f`，可使用纯运动学的分段曲线：

```text
f(u) = f0 + A · smoothstep(2u)          , 0 ≤ u ≤ 0.5
f(u) = f0 + A · smoothstep(2 - 2u)      , 0.5 < u ≤ 1
```

其中 `A` 只固定方向（正/负）；其范围在真实分段录像中估计。若是腿弯举、夹胸等未找到可直接导入的目标动作公开轨迹，`A` 只能是合成测试参数，不能当参考幅度。去程/回程可各自带 duration 与 dwell，禁止用无限制 DTW 把停顿、半程或反向动作压平。

每个 profile 至少有一个“主相位特征”（例如 squat 的 `knee_angle_2d`、RDL 的 `hip_opening_angle_2d`、cable fly 的 `wrist_pair_separation`）；其余特征只能辅助确认，不能在主特征 `unknown` 时伪造 rep。

## 从明日开始的校准与验证

1. 训练前先确定**实际动作和设备**；例如 `leg_press / 45_degree / plate_loaded / left_side` 和 `back_squat / high_bar / stance=shoulder_width / left_side`，不要只写“练腿”。
2. 每段视频人工标注 `start / extremum / end` 与非动作窗口；这些是 segmentation ground truth，不是姿势质量标签。
3. 仅用 identity 精确匹配的完整 rep，估计本 profile 的 `A`、相位时长、可见性、左右相位差和真实的 feature coverage；模拟模板只是初值/弱正则。
4. 按**整段 capture** 留出，而不是同一视频随机拆 rep，报告 rep precision/recall、边界误差、`unknown` 率与负窗口 FP。首次上线仍标 `provisional`。
5. 只有在独立训练录像和有资格的人工 form 标签都具备后，才讨论提示语；即使如此，提示也必须是 profile/机位特定的，不能升级为医疗判断。

## 明确禁止的主张

- 不能从这些 2D 模板判断膝内外翻、骨盆/脊柱三维位置、肩胛运动、关节力矩、肌肉激活比例、疼痛、损伤风险或“安全”。
- 不能把研究样本的平均 ROM、某台器械的轨迹、或模拟器输入的 endpoint 当成用户必须达到的标准。
- 不能把 rep 边界标注、普通训练录像或经模拟补全的关键点称为“专家参考轨迹”。
- 不能把 screen-y 变化当成世界垂直变化，除非该 profile 的机位、镜像和相机竖直性都符合 identity。
- 不能在手、足、髋或肩关键点不可见时以另一侧、模板或插值补成 observed value；应返回 `unknown`。

## 一手来源索引

- [MediaPipe Pose Landmarker 官方输出文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
- [Wu et al., 2005, ISB joint-coordinate-system recommendation](https://doi.org/10.1016/j.jbiomech.2004.05.042)
- [Lorenzetti et al., 2018, *How to squat?*（3D motion capture + force plates）](https://doi.org/10.1186/s13102-018-0103-7)
- [Sjöberg et al., 2021, squat/leg-press cycle 的原始运动捕捉定义](https://doi.org/10.3389/fspor.2021.686335)
- [Escamilla et al., 2001, squat/leg-press technique variations（kinetics/EMG）](https://doi.org/10.1097/00005768-200109000-00020)
- [Jakobsen et al., 2021, flywheel squat versus leg press biomechanics](https://pubmed.ncbi.nlm.nih.gov/34423289/)
- [Tsai et al., 2022, box squat versus seated knee extension（dual fluoroscopy）](https://doi.org/10.1016/j.medengphy.2022.103766)
- [Camara et al., 2019, conventional versus Romanian deadlift（3D motion analysis）](https://doi.org/10.1016/j.jesf.2018.08.001)
- [Brazil et al., 2021, barbell hip thrust comprehensive biomechanics](https://doi.org/10.1371/journal.pone.0249307)
- [Sahagian et al., 2016, heel raise with three foot positions（kinematics）](https://pubmed.ncbi.nlm.nih.gov/27182353/)
- [Jan et al., 2013, heel raise biomechanics at two knee positions](https://pubmed.ncbi.nlm.nih.gov/23810663/)
- [Duffey & Challis, 2007, bench-press bar kinematics under fatigue](https://doi.org/10.1519/R-19885.1)
- [An et al., 1990, push-up kinematic/kinetic analysis](https://pubmed.ncbi.nlm.nih.gov/2334780/)
- [van den Tillaar, 2019, push-up versus bench press kinematics/activation](https://doi.org/10.1055/a-1001-2526)

这些研究是特定受试者、器械和协议下的原始观测，不是本项目的动作质量标准；本文未发现可直接导入、逐帧公开且能建立上述每个胸/腿动作“合格范围”的商业可用 reference dataset。
