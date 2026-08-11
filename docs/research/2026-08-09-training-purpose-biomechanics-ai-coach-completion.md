# 从训练目的与生物力学定义 AI 健身教练的动作完成度

日期：2026-08-09  
状态：研究与产品定义草案，不是临床诊断标准，也不是逐动作阈值表

## 1. 结论

产品不应把“动作完成度”定义为用户骨架与标准视频的相似度，也不应先按 70 个动作逐一堆规则。更合理的定义是：

> 在已知训练目标、动作变式、器械与机位的前提下，判断用户是否完成了预期的运动任务，关键运动学约束是否满足，训练刺激的可观察代理是否符合目标，以及证据是否足以支持反馈。

动作完成度应是一组分维度证据，而不是单一总分：

1. 任务与周期是否完成。
2. 目标 ROM 是否达到。
3. 预期向心、离心、停顿和返回阶段是否完整、连续、受控。
4. 躯干、骨盆、关节和器械轨迹是否符合该动作变式的目标约束。
5. 左右侧的高度、ROM、速度、端点时序和轨迹是否出现非预期差异。
6. 同组内是否出现速度、ROM、稳定性或路径的持续退化。
7. 摄像头是否真正看得到上述证据。

单目视频可以支持“健身房教练/线上教练级”的概率推断。例如，当多个独立特征同时偏离，系统可以提示“更像常见借力模式”“目标刺激可能偏离预期”。但必须与直接测量区分：视频没有直接测到肌力、肌电、腹压、关节力矩或具体肌肉获得了多少刺激。

## 2. 必须先修正的前提

### 2.1 向心和离心不是单纯的骨架运动方向

向心、离心描述的是肌肉—肌腱单元在产生张力时的缩短或延长。摄像头直接看到的是身体节段和负重的位移，不是肌纤维长度和激活。

在动作、器械阻力方向和主要作用肌语义已知时，产品可以定义：

- `expected_concentric_phase`：该动作变式中通常对应克服外部阻力的阶段。
- `expected_eccentric_phase`：该动作变式中通常对应受控返回的阶段。
- `transition_or_hold_phase`：反向、停顿或等长保持阶段。

这是一种动作语义标注，不等于直接测量肌肉收缩模式。多关节动作、双关节肌、弹力带、飞轮、惯性摆动和器械凸轮都会使“骨架方向 = 某块肌肉向心/离心”的映射变得不唯一。

### 2.2 左右运动学不对称不等于左右力量不平衡

单目骨架可以测量：

- 左右端点高度差。
- 左右 ROM 差。
- 左右达到极值的时间差。
- 左右速度和轨迹形状差。
- 躯干侧屈、旋转和骨盆偏移的可见代理。

这些可以统称为“运动学不对称”。真正的左右力量差还受外部负荷分配、地面反作用力、支撑条件、握距和肌肉共同收缩影响，不能只凭关键点确认。

### 2.3 躯干角度可以识别技术变式和代偿倾向，不能单独证明刺激肌群

以杠铃划船为例，躯干角度偏离目标变式确实会改变关节几何、负重力臂和可能采用的动作策略。若同时出现肩胛抬高、肘路改变、杠铃路径偏离、ROM 缩短或躯干摆动，系统可以给出概率性反馈：

> 当前动作更像由肩带或上背主导的常见借力模式，目标刺激可能偏离预期。

但不能只根据“躯干更直立”就断言“背部没有发力”或“力量已经转移到斜方肌”。相似运动学下可以存在明显不同的肌电活动和肌肉共同收缩策略。[Shapiro 等的受控研究](https://pubmed.ncbi.nlm.nih.gov/15730947/)发现，相似运动学条件下，同一肌肉作为主动肌或拮抗肌时，EMG 可相差约两倍，建模收缩力矩冲量也可明显不同。

### 2.4 ROM 不是越大越好，而是相对目标、能力与约束是否完成

ROM 会影响力量和肌肥大适应，但不存在跨动作、跨人群的统一“最大 ROM = 最标准”。[Bloomquist 等的深蹲研究](https://doi.org/10.1007/s00421-013-2642-7)显示不同训练 ROM 会产生不同适应，但该结果来自特定动作和小样本，不能直接外推成所有动作的通用阈值。

因此 ROM 目标必须由以下内容共同决定：

- 训练目标。
- 动作变式与器械结构。
- 个人基线活动度和无痛可控范围。
- 训练阶段及教练处方。
- 摄像头能否可靠观察端点。

### 2.5 动作完成不等于训练刺激充足，也不要求力竭

一个技术完整的 rep 可能因负荷、训练量或努力程度不足而不适合某个训练目标；反过来，未做到力竭也不能被判为未完成。[ACSM 2026 官方立场声明](https://pubmed.ncbi.nlm.nih.gov/41843416/)指出，力量、肌肥大、功率和功能的最佳处方变量不同，训练至瞬时肌肉疲劳并未对所有结果表现出一致优势。[Sampson 与 Groeller](https://pubmed.ncbi.nlm.nih.gov/25809472/)在特定肘屈训练中也未发现力竭相对于非力竭方案带来额外适应。

产品必须把“单次动作完成度”和“整组训练刺激适配度”分开。

## 3. 训练目的决定完成度含义

[ACSM 2026 阻力训练处方立场声明](https://pubmed.ncbi.nlm.nih.gov/41843416/)综合了 137 篇系统综述、超过 30,000 名参与者的数据。它表明完成度不能脱离目标讨论：

| 训练目的 | 主要处方变量 | AI 教练可观察的执行证据 | 必须额外获得的信息 |
| --- | --- | --- | --- |
| 力量 | 较高负荷、足够 ROM、组数与频率 | 目标 ROM、路径、稳定性、速度退化 | 实际负荷、处方组次、RPE/RIR |
| 肌肥大 | 较高周训练量、有效负荷与努力程度，离心过载可能有益 | 向心/离心阶段完整性、ROM、控制、组内退化 | 负荷、周训练量、RPE/RIR、恢复信息 |
| 功率 | 中等负荷、快速向心意图、低至中等训练量 | 向心速度、加速趋势、路径和技术保持 | 实际负荷、用户是否被要求快速发力 |
| 局部耐力 | 较轻至中等负荷、较多重复 | 动作周期、后程速度/ROM/技术保持 | 负荷、目标次数、休息时间 |
| 技术学习 | 可控负荷、稳定一致的运动模式 | 阶段、端点、轨迹、躯干、左右一致性 | 目标变式、个体化技术约束 |
| 康复/功能 | 症状、能力与临床目标个体化 | 可控 ROM、动作策略、左右差和趋势 | 临床处方、疼痛与禁忌；不能由产品擅自决定 |

所以产品开始训练前至少要知道：`goal`、`exercise_variant`、`equipment`、`intended_rom`、`tempo_or_intent`、`external_load`（若有）、`unilateral_or_bilateral` 和个体限制。

## 4. 推荐的动作完成度判断模型

### 4.1 第一层：事实观测

这是摄像头或用户输入直接提供的数据：

- 视频帧、时间戳和相机参数。
- MediaPipe 33 点、visibility/presence、跟踪连续性。
- 2D 坐标及模型输出的近似 3D 坐标。
- 人脸/躯干朝向和机位适配度。
- 可检测到的器械、杠铃或支撑面位置。
- 用户输入的重量、动作变式、目标节奏、RPE/RIR。

这一层不能包含“借力”“刺激转移”“核心没收紧”等解释。

### 4.2 第二层：运动学证据

从可靠观测中计算：

- 动作阶段、循环边界和 rep 完整性。
- 关节角、节段角和相对距离。
- 实际 ROM 与个体目标 ROM。
- 阶段时长、停顿、反向点和速度曲线。
- 躯干/骨盆角度与稳定性。
- 左右 ROM、高度、速度、时序和轨迹差。
- 同组内上述指标的趋势退化。

这是当前单目产品最应该做深、做准的层。

### 4.3 第三层：动作约束判断

把运动学证据放入具体的 `目标 × 动作 × 变式 × 机位 × 人群限制` 上下文：

- 是否完成预期周期。
- 是否达到目标端点和返回端点。
- 是否保持该变式要求的躯干或关节约束。
- 左右差是否为动作设计的一部分，还是非预期偏差。
- 向心/离心/停顿是否符合处方。
- 偏差是否持续，是否超过个体基线与测量噪声。

输出必须是分维度状态：`meets_target`、`partially_meets_target`、`deviates`、`cannot_judge`，不能强制合成总分。

### 4.4 第四层：教练级概率推断

用户允许系统达到健身房或线上教练常用的推断水平。这一层可以存在，但必须满足：

1. 至少两个以上相互独立的可见特征共同支持。
2. 特征与动作阶段、变式和器械语义一致。
3. 偏差持续多个可靠帧或多个 rep，而非单帧抖动。
4. 明确输出概率、证据和替代解释。
5. 文案使用“更像”“可能”“常见于”，不使用确定性的生理测量措辞。

示例：

```text
观察：目标划船变式要求稳定俯身；连续 3 次 rep 中躯干逐渐直立，
     肩胛持续抬高，肘路上移，杠铃路径缩短。

推断：较高概率出现肩带/上背主导的借力策略，
     目标动作刺激分配可能偏离预期。

提示：减轻重量并保持目标躯干角度；若无法稳定保持，请结束该组。

限制：系统没有直接测量肌电、肌力或关节负荷。
```

禁止的输出：

- “你的背阔肌只发力了 30%。”
- “左侧力量比右侧弱 18%。”
- “你的腹压不足。”
- “这个角度一定会受伤。”
- “刺激已经从背阔肌转移到了斜方肌。”

### 4.5 第五层：不可直接判断和升级测量

以下内容需要更强传感器或实验真值：

| 目标 | 单目视频能力 | 更合适的升级路径 |
| --- | --- | --- |
| 外部负荷与杠铃速度 | 可做视觉估计，但受遮挡、尺度和相机影响 | 用户录入重量、器械识别、线性编码器/IMU |
| 左右受力 | 不能由高度差直接确定 | 双侧力台、压力垫、器械传感器 |
| 关节力矩/关节载荷 | 不能由骨架直接确定 | 多视角 3D、外力、个体惯性模型、逆动力学 |
| 肌肉激活/共同收缩 | 不能直接确定 | 表面 EMG，或经验证的肌骨模型估计 |
| 呼吸 | 可识别部分明显周期和屏息迹象 | 麦克风、胸腹呼吸带、气流传感器 |
| 腹压 | 不可直接判断 | 压力传感器；研究级测量具有侵入性 |

[OpenSim 官方逆动力学文档](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics)要求运动学、个体模型、惯性参数以及全部外力，才能准确计算关节净力和力矩。[OpenSim 静态优化文档](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53085189/Working%20with%20Static%20Optimization)进一步说明，肌肉激活和肌肉力需要通过带假设的优化求解，存在肌肉冗余和非唯一解。

## 5. 重点维度的判断标准

### 5.1 周期和动作任务

必须确认：

- 起始准备状态成立。
- 预期运动阶段按合理顺序出现。
- 到达目标反向点。
- 返回起始端点或规定终点。
- 中途没有长时间丢点、换主体或器械遮挡。

未完成周期应输出 `incomplete_rep`，不应为了凑次数自动封口。

### 5.2 ROM

应同时保存：

- 主导关节和器械/肢段的实际行程。
- 起始端缺失量。
- 末端缺失量。
- 左右各自 ROM。
- 与个人基线、当前处方和组内历史的差异。

判断单位应优先是角度、身体比例归一化位移和相对个人基线百分比，而不是只保存一个 ROM 分数。

### 5.3 阶段与节奏

至少区分：预期向心、预期离心、转换、停顿和不可判定。判断内容包括：

- 阶段是否存在。
- 各阶段持续时间和比例。
- 反向点是否稳定。
- 离心返回是否受控，还是出现自由下落/轨迹丢失倾向。
- 处方要求快速向心时是否保留了加速意图。

“速度慢”不是自动错误。它可能来自大负荷、疲劳、刻意慢速处方、疼痛或器械阻力曲线。

### 5.4 左右平衡

双侧动作比较：

- 端点高度差。
- ROM 差。
- 反向点时间差。
- 峰值速度和速度曲线差。
- 轨迹形状差。
- 躯干侧移/旋转是否伴随发生。

只有当动作本来要求双侧同步、双方都可靠可见、差异超过测量噪声并持续存在时，才提示非预期运动学不对称。单侧动作、交替动作、错步站姿或刻意偏重不适用同一标准。

### 5.5 躯干、骨盆与代偿

判断不应只有单一躯干角，而应组合：

- 躯干相对地面或大腿的目标角度。
- 躯干角在 rep 内的漂移。
- 骨盆前后倾、侧移和旋转的可见代理。
- 肩线与骨盆线相对关系。
- 负重/肢段轨迹是否同步偏离。
- 偏差发生在哪个动作阶段。

代偿是对多特征模式的概率解释，而不是任一角度超过阈值就自动成立。

### 5.6 努力程度与疲劳趋势

[Pareja-Blanco 等的研究](https://pubmed.ncbi.nlm.nih.gov/27038416/)表明组内速度损失会影响训练适应，因此速度趋势值得采集。但产品只能在相同动作、相同设备、相同负荷和相近 ROM 条件下做相对比较。

推荐输出：

- `velocity_retention`：相对本组早期可靠 rep 的速度保持率。
- `rom_retention`：相对早期可靠 rep 的 ROM 保持率。
- `technique_retention`：关键约束是否随 rep 退化。
- `effort_context`：用户 RPE/RIR、负荷和目标。

不要输出“肌肉疲劳 72%”或“发力下降 20%”。

### 5.7 呼吸与支撑

[Hagins 等](https://pubmed.ncbi.nlm.nih.gov/15094544/)使用经鼻进入胃内的微型压力传感器测量腹压，发现呼吸方式和负荷会影响腹压，吸气后屏息产生较高峰值。这恰好说明腹压不是骨架可直接观察量。

产品可以给出呼吸节奏提醒或提示明显长时间屏息，但应把“呼吸模式”“躯干外观稳定”和“腹压”作为三个不同变量。

## 6. 单目识别与可观测性标准

[Ray3D](https://openaccess.thecvf.com/content/CVPR2022/html/Zhan_Ray3D_Ray-Based_3D_Human_Pose_Estimation_for_Monocular_Absolute_3D_CVPR_2022_paper.html)明确指出，从单目 2D 姿态恢复绝对 3D 是病态问题，相机内外参变化会影响泛化。即使 MediaPipe 输出 world landmarks，也不能取消遮挡、深度歧义和机位依赖。

每个完成度维度必须带：

- `required_landmarks`。
- `required_view`。
- `visibility_confidence`。
- `tracking_continuity`。
- `camera_alignment_confidence`。
- `equipment_visibility`。
- `judgement_status`。

`judgement_status` 至少包括：

- `observed`：直接可见且可靠。
- `inferred`：由多个可靠特征进行概率推断。
- `cannot_judge`：证据不足。
- `not_applicable`：该动作或训练目标不适用。

## 7. 对数据采集与训练的要求推导

这份研究不是具体采集计划，但可以先确定训练数据必须覆盖的语义范围。

### 7.1 每段数据必须携带的上下文

- 训练目标：力量、增肌、功率、耐力、技术或康复。
- 动作、动作变式和单/双侧属性。
- 器械、外部负荷、组次与休息。
- 目标 ROM、节奏、速度意图和允许的技术变体。
- 用户训练经验、个体限制和无痛活动范围。
- 机位、相机参数、手机型号、MediaPipe 模型版本和实际 delegate。
- 用户 RPE/RIR；不能用视觉自动生成后当作真值。

### 7.2 标注层级

1. **观测真值**：关键点/器械位置、可见性、遮挡、机位。
2. **运动学真值**：rep 边界、阶段边界、ROM、角度、速度、左右时序。
3. **任务判断**：完整、部分完整、偏离、不可判断。
4. **教练推断**：常见借力/代偿模式及置信度，并标注支持证据和可能替代解释。
5. **仪器真值子集**：IMU/编码器、力台、EMG、呼吸或多视角 3D，用于校准代理指标，不能把模型输出回填成真值。

### 7.3 训练任务应解耦

- 动作类别与变式识别。
- 周期、rep 和阶段识别。
- 可观测性与拒判。
- 运动学量估计与平滑。
- 分维度完成度判断。
- 多特征代偿模式的概率分类。
- set-level 速度/ROM/技术退化趋势。

不能使用一个端到端总分替代这些任务，否则难以知道模型是在识别真正的技术证据，还是利用背景、服装、教练身份或视频来源等捷径。

### 7.4 MM-Fit 的位置

[MM-Fit 官方数据集](https://mmfit.github.io/)提供同步多视角 RGB-D、2D/3D 姿态，以及手机、手表、耳机 IMU，适合动作分类、周期表征、次数和多模态预训练。

它不能直接提供本标准所需的目标肌刺激、逐 rep 技术质量、腹压、关节力矩和教练错误类型真值。因此它应作为底层运动识别数据，而不是完整动作完成度标签来源。

## 8. 替代与升级路径

如果单目能力达到上限，优先级建议是：

1. 让用户输入真实重量、目标和 RPE/RIR，成本最低、价值很高。
2. 增加器械/杠铃检测和视觉速度跟踪。
3. 利用手机、手表或器械 IMU 校验节奏、速度和左右轨迹。
4. 提供第二手机高级分析模式，减少深度歧义。
5. 对少量标定数据使用力台、线性编码器、EMG 和呼吸传感器建立代理指标边界。

[OpenCap 原始验证研究](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462)展示了两台以上同步、校准手机结合多视角三角化、肌骨模型和物理模拟的路径，并使用光学动捕、力台和 EMG 进行验证。它证明更高层动力学估计有可行路径，但不能直接证明当前单目实时方案具有同等能力。

## 9. 产品输出建议

每次 rep 输出应类似：

```json
{
  "rep_status": "completed",
  "goal": "hypertrophy",
  "exercise_variant": "barbell_row_target_variant",
  "dimensions": {
    "rom": { "status": "partially_meets_target", "confidence": 0.91 },
    "phase_control": { "status": "deviates", "confidence": 0.84 },
    "trunk_constraint": { "status": "deviates", "confidence": 0.93 },
    "bilateral_kinematics": { "status": "cannot_judge", "confidence": 0.31 }
  },
  "coach_inference": {
    "label": "likely_compensation_pattern",
    "probability": 0.78,
    "evidence": ["trunk_angle_drift", "shoulder_elevation", "shortened_path"],
    "alternative_explanations": ["load_too_high", "intended_variant_mismatch"]
  },
  "measurement_limits": ["muscle_activation_not_measured", "joint_force_not_measured"]
}
```

LLM 只能解释这些结构化证据，不能凭视频描述重新发明第二套计数、阶段或生理判断。

## 10. 风险与最终边界

- **目标缺失风险**：不知道训练目的和动作变式时，“标准度”没有唯一答案。
- **把运动学当动力学**：高度、速度和角度差不能直接变成力量、力矩或肌肉激活。
- **过度统一 ROM**：统一追求最大 ROM 会误判变式、个体限制和康复处方。
- **把慢速当错误**：大负荷、刻意节奏和疲劳都可能造成慢速。
- **把对称当绝对标准**：单侧、交替、错步和刻意偏重动作本来就不对称。
- **隐藏不可观测性**：模型补全的遮挡关节不能作为高置信纠正证据。
- **伤病因果过度承诺**：可提示可见技术偏差和停止条件，不能仅由姿态宣称一定受伤或诊断疼痛来源。
- **教练推断失去限定词**：允许概率推断，不代表可以伪装成仪器测量；反馈必须保留置信度、证据和替代解释。

最终边界可以概括为：

> 单目 AI 教练应把可见运动学做到准确、连续、分阶段且可拒判；把多特征代偿与刺激倾向作为透明的概率推断；把肌力、肌电、腹压和关节载荷留给额外传感器或经验证的动力学模型。

## 11. 主要来源

1. Currier BS, et al. [ACSM Position Stand: Resistance Training Prescription for Muscle Function, Hypertrophy, and Physical Performance in Healthy Adults](https://pubmed.ncbi.nlm.nih.gov/41843416/). 2026.
2. Pareja-Blanco F, et al. [Effects of velocity loss during resistance training on athletic performance, strength gains and muscle adaptations](https://pubmed.ncbi.nlm.nih.gov/27038416/). 2017.
3. Bloomquist K, et al. [Effect of range of motion in heavy load squatting on muscle and tendon adaptations](https://doi.org/10.1007/s00421-013-2642-7). 2013.
4. Sampson JA, Groeller H. [Is repetition failure critical for the development of muscle hypertrophy and strength?](https://pubmed.ncbi.nlm.nih.gov/25809472/). 2016.
5. Shapiro MB, et al. [Muscle activation is different when the same muscle acts as an agonist or an antagonist during voluntary movement](https://pubmed.ncbi.nlm.nih.gov/15730947/). 2005.
6. OpenSim. [Getting Started with Inverse Dynamics](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53090063/Getting%2BStarted%2Bwith%2BInverse%2BDynamics).
7. OpenSim. [Working with Static Optimization](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim/pages/53085189/Working%20with%20Static%20Optimization).
8. Hagins M, et al. [The effects of breath control on intra-abdominal pressure during lifting tasks](https://pubmed.ncbi.nlm.nih.gov/15094544/). 2004.
9. Zhan Y, et al. [Ray3D: Ray-Based 3D Human Pose Estimation for Monocular Absolute 3D Localization](https://openaccess.thecvf.com/content/CVPR2022/html/Zhan_Ray3D_Ray-Based_3D_Human_Pose_Estimation_for_Monocular_Absolute_3D_CVPR_2022_paper.html). CVPR 2022.
10. Uhlrich SD, et al. [OpenCap: Human movement dynamics from smartphone videos](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1011462). 2023.
11. Strömbäck D, et al. [MM-Fit: Multimodal Deep Learning for Automatic Exercise Logging Across Sensing Devices](https://mmfit.github.io/). IMWUT 2020.
