# 标准运动轨迹参考数据：一手资料与可用性审计

日期：2026-08-03
范围：第一优先级为高位下拉；坐姿推肩、侧平举、后束飞鸟、绳索面拉、坐姿划船、杠铃划船、引体向上仅做证据可用性审计。本文不修改识别算法，不把任何用户录像宣布为标准动作，也不作医疗或损伤风险判断。

## 结论先行

1. **[unavailable] 没有找到可直接导入、逐帧公开、许可允许本项目使用、并且已经建立“可接受范围”的高位下拉标准 3D 轨迹数据集。**最接近的直接证据是 ETH Zürich 的实验室研究：15 名熟悉动作的健康受试者在 Vicon 22 相机、100 Hz、77 个身体/背部标记点下完成高位下拉；论文发布了分组 ROM、脊柱曲率和肩关节动力学摘要，但未发布可下载的逐帧个体轨迹，也没有把样本建立为专家审核后的可接受走廊。[Lorenzetti et al., 2017, DOI 10.3390/jfmk2030033](https://doi.org/10.3390/jfmk2030033)
2. **[evidence_backed] 论文能约束的是动作语义、阶段、主要关节、可观察变量以及必须分档的条件；不能从论文摘要值反推产品阈值。**例如，专业动作说明明确区分下拉的向心阶段和回程的离心阶段，并要求双手等距、杆保持水平、躯干稳定；实验研究则证明器械自由度和负重会改变腕位移、肩/肘运动及躯干 ROM。因此器械、握法、负重条件和机位不能被静默混入同一数值参考档案。[Ronai, 2019, DOI 10.1249/FIT.0000000000000469](https://doi.org/10.1249/FIT.0000000000000469)；[Koyama et al., 2010, DOI 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y)
3. **[inferred] 当前最小可行模型不是一条“标准曲线”，而是同一 `exerciseId + variation + equipment + capturePosition + trainingSide + coordinateSystem` 桶内，经专家批准 rep 的分阶段、多特征、带缺失状态的参考走廊。**每次 rep 用 `start → bottom/peak → end` 分成 pull 和 return，再分别重采样到相位百分比；角度和躯干相对坐标用中位数与分位区间表达，必要时用鲁棒多变量距离，但阈值必须由独立验证集确定。
4. **[evidence_backed] 普通训练数据、动作分段真值和参考轨迹必须是三张不同的表。**MM-Fit 明确说明仅向参与者演示动作、采集时“不纠正动作形式”，所以其 RGB-D、2D/3D pose 和活动标签只能算 observed trajectory/segmentation 数据；Fit3D 虽把一名持证教练的记录称为 `Reference3D`，但只有一名教练，仍不足以形成群体可接受区间。[MM-Fit paper, DOI 10.1145/3432701](https://doi.org/10.1145/3432701)；[AIFit/Fit3D paper](https://fit3d.imar.ro/sites/default/files/public/pdf/Fieraru_2021_CVPR.pdf)
5. **[evidence_backed] 单目 MediaPipe 可提供 33 个关键点、坐标、presence/visibility 和内置时间平滑，但它不是动作正确性模型。**官方定义中，visibility 只是关键点在画面内且未被遮挡的概率；单目输出不包含杠杆、绳索、胸骨标记、肩胛骨或真实外力。遮挡的手腕/肘部必须使依赖指标返回 `unknown`，不能用轨迹插值“补出”肢体。[MediaPipe Pose 官方输出定义](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)；[BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
6. **[hypothesis] 可先用 12–15 人、每人两次会话、每会话 5–8 个专家批准 rep、三台同步相机，仅建立一个高位下拉 variation 的可行性走廊。**这与文献中的实验规模相近，只足以测试流程，不足以声称泛化。泛化规模没有现成论文给出“魔法人数”；应以人而不是 rep 为独立样本做预注册功效/精度分析，并至少在独立人员、独立会话、独立器械/场地上验证。一个保守的产品前验是每个最终档案先覆盖 50–100 人、至少两类器械/两个场地，但该数字是工程假设，不是已证实阈值。

## 审计口径

本文严格使用以下三类数据名称：

| 类别 | 定义 | 可否直接成为标准走廊 |
| --- | --- | --- |
| `observed trajectory` | 普通受试者、训练者或患者实际完成动作时采集的逐帧坐标/角度 | 否；可用于发现变异、遮挡和候选特征 |
| `segmentation ground truth` | 人工批准的每次 `start / extreme-or-peak / end` 边界 | 否；只回答“哪一段是一 rep” |
| `reference trajectory` | 对动作 variation 有明确协议，由生物力学证据和合格专业人员审核，能表达群体可接受范围的轨迹 | 是；但必须保留来源、分档、证据状态和适用边界 |

证据标记：

- `evidence_backed`：一手论文、官方数据卡、官方代码或专业组织资料直接支持。
- `inferred`：由一手资料合理推导，但没有直接的目标动作轨迹数据。
- `hypothesis`：需要本项目的同步录像、运动捕捉或专家复核实验验证。
- `unavailable`：当前未找到可信的一手资料支持。

文献中的“正确动作”、教练单次示范、参与者听过动作说明，都不会自动升级为 population reference corridor。

## 高位下拉：证据审计

### 1. 直接生物力学证据能说明什么

#### 实验室 3D 观测

**[evidence_backed]** Lorenzetti 等人采集 8 男 7 女（23 ± 2 岁）在可调钢索设备上的高位下拉、45° 高位下拉、坐姿划船和直立划船。每个动作按两个负重条件各做 8 次；标准高位下拉为 25% 和 50% 体重负重。系统为 22 台红外相机、100 Hz，55 个四肢/躯干标记加 22 个背部标记，并有串联负载传感器。论文把每个 cycle 定义为从“目标肌肉最短位置”起步，因此其 cycle 顺序是 eccentric 后 concentric，和本项目希望从手臂高位开始的 `start → pull → bottom → return` 顺序相反；导入任何论文曲线前必须重定义相位零点。[原文](https://www.mdpi.com/2411-5142/2/3/33)

论文报告的标准高位下拉观测摘要包括：

| 观测量 | 25% BW | 50% BW | 审计结论 |
| --- | ---: | ---: | --- |
| 腰椎相对胸椎 sagittal ROM | 5.2 ± 1.2° | 9.6 ± 4.5° | [evidence_backed] 负重条件会改变观察分布；**不能**把均值±SD当合格阈值 |
| 同一相对运动 frontal ROM | 2.1 ± 0.7° | 2.6 ± 1.0° | [evidence_backed] 横向躯干运动可作为特征；没有论文批准阈值 |
| 同一相对运动 transverse ROM | 1.4 ± 0.4° | 2.1 ± 0.5° | [evidence_backed] 旋转是 3D 变量；单目后视无法可靠恢复真实轴向旋转 |
| 肩关节 sagittal ROM | 172.9 ± 9.6° | 158.9 ± 15.3° | [evidence_backed] 是协议相关的 observed ROM，不是目标端点角度或参考走廊 |
| 肩关节 frontal ROM | 88.4 ± 10.6° | 86.7 ± 11.0° | 同上 |
| 肩关节 transverse ROM | 90.5 ± 13.4° | 85.1 ± 18.6° | 同上 |

这些值只能用于以下审计结论：动作是多平面、多关节的；负重和执行条件应入 metadata；躯干和肩运动应保留为时间序列。它们不能产生“超过 X° 就错”的规则，因为论文没有提供逐帧个体曲线、专家合格标签、受试者间分位数或外部验证。

**[evidence_backed]** Koyama 等人比较 1、2、3 个运动自由度的三种高位下拉机，7 名男性的腕垂直位移、肩内收/外展位移、肘屈伸位移和肩→肘→腕峰值速度顺序随器械改变。结论是 `equipment` 和机器约束自由度必须进入参考档案；不同机器的腕轨迹不能直接共用数值走廊。[DOI 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y)

#### 专业动作协议

**[evidence_backed]** ACSM 的同行评审 `Do It Right` 文章针对“前拉、宽握、旋前”variation 给出可审计动作语义：

- 起始：杆在头顶、肘伸展、双手距杆中心相等；宽握为约 1.5–2 倍肩峰宽；膝部稳定垫固定身体。
- pull：肩胛带、肩关节、肘关节共同运动；肘位于躯干略前的肩胛平面；杆向下到大致胸骨顶部高度；短暂停顿。
- return：受控回到头顶，肘在 rep 结束时重新伸直。
- 可观察常见偏差包括猛拉、躯干来回摆、未完成协议要求的 ROM、杆不水平、臀部离座、头颈随动作明显移动。
- 教练观察可从前、后、侧或前/后 45°进行；文章并未声称这些机位的数值特征可以共享。

来源：[Ronai, 2019, full text](https://sacredheart.elsevierpure.com/ws/portalfiles/portal/39994737/The_Lat_Pulldown.9%20%281%29.pdf)，[DOI](https://doi.org/10.1249/FIT.0000000000000469)。文中的宽度和位置是该特定 variation 的动作协议，不是跨握法的普适轨迹阈值。

**[evidence_backed]** Andersen 等人把旋前握距定义为 1、1.5、2 倍肩峰宽，15 名男性在三种握距做 6RM；负重能力和 EMG 随握距改变。该研究没有发布逐帧关节轨迹，但直接支持握宽不能作为未记录的隐变量。[DOI 10.1097/JSC.0000000000000232](https://doi.org/10.1097/JSC.0000000000000232)

### 2. 本项目的阶段模型

以下阶段边界是把上述专业协议映射为可标注事件，不是新增的角度阈值：

| 阶段/事件 | 操作定义 | 证据状态 | 自动候选信号 | 人工批准要求 |
| --- | --- | --- | --- | --- |
| `start` | 本次向下拉动前，双臂处于高位、肘接近该人的伸展端且短时稳定 | evidence_backed + inferred | 双腕相对肩部的垂直位置达到局部高位，肘角接近局部最大 | 排除抓杆、调座和上一 rep 尚未稳定的帧 |
| `pull` | 从 `start` 到向心末端；手腕/杆向下，肘屈曲，上臂相对躯干下降 | evidence_backed | 双腕向下速度与肘屈曲方向一致 | 停顿与借力仍属于该 rep，不得被无约束 DTW吞掉 |
| `bottom` | 杆/手到达该 rep 的下方端点并可能短暂停顿 | evidence_backed | 双腕相对肩部局部低点 + 肘角局部小值的联合事件 | 只有手腕/肘真实可见时才批准；不能只靠一侧遮挡后的预测 |
| `return` | 从 `bottom` 受控回到高位，肘重新伸展 | evidence_backed | 双腕向上、肘角增大 | 必须保留时长、反向峰值速度和停顿信息 |
| `end` | 回到高位稳定点；通常也是下一 rep 的 `start` 候选 | evidence_backed + inferred | 高位局部平台 | 连续 reps 可共享时间点，但边界语义必须固定 |

**[inferred]** 在计算上，把 `start→bottom` 和 `bottom→end` 分别归一化到各自的 0–100%，同时保留原始毫秒时长、底部停顿和速度峰值。不得使用无限制 DTW 把明显停顿、猛拉或回程加速重新扭成正常速度。

### 3. 主要平面、关节和协同关系

| 项目 | 审计结果 |
| --- | --- |
| 主要运动平面 | **[evidence_backed]** 宽握前拉的肘/上臂位于肩胛平面，肩发生内收并伴随肩胛运动；实验室 3D 结果同时显示肩 sagittal、frontal、transverse 均有大 ROM。不能把动作压成纯 frontal 或纯 sagittal 一条曲线；命名还受关节坐标系影响。 |
| 主要关节 | **[evidence_backed]** 肩胛胸廓复合运动、盂肱关节、肘屈伸；手腕/手负责握持。 |
| 可观察协同 | **[evidence_backed]** 双手等距、杆保持水平；pull 中肩/肘/腕有时序关系，且器械自由度会改变该关系。 |
| 单目骨架缺失 | **[evidence_backed]** MediaPipe 有肩、肘、腕、髋，但没有肩胛骨、胸骨、杆、拉索、座垫压力或负载传感器关键点；因此肩胛上/下回旋、杆触胸骨、真实外力和固定状态不能由该骨架直接测得。 |

### 4. 可落地特征与证据等级

所有坐标先转换到**未镜像的 source-image 坐标**；角度用 torso-relative 定义，位置用肩宽或躯干长度归一化。下表中的“可落地”表示适合收集和比较，不表示已有合格阈值。

| 特征 | 轻量定义 | 最适机位 | 证据状态 | 数值状态 |
| --- | --- | --- | --- | --- |
| 左/右腕相对肩的二维轨迹 | `(wrist - ipsilateralShoulder) / shoulderWidth`；分别保存 x、y | 正后、45° | evidence_backed | 文献支持“腕位移重要且受机器影响”；可接受分位数 **null** |
| 腕相对躯干中线 | 腕到 `midShoulder→midHip` 轴的带符号距离 | 正后 | inferred | 适合观察两手张开/收拢和横向不对称；阈值 **null** |
| 左/右肘角 | `angle(shoulder, elbow, wrist)` | 后 45°、侧面 | evidence_backed | 肘是主要运动关节且器械改变 ROM；逐相位走廊 **null** |
| 上臂相对躯干角 | `angle(elbow-shoulder, midHip-midShoulder)`，明确是二维投影还是 3D 世界坐标 | 正后用于外展投影，45°用于屈伸/内收混合 | evidence_backed + inferred | 可以比较形状；不可把不同机位的角直接拼接 |
| 左右同步性 | 左右腕 y、肘角的相位差；杆可见时另做杆倾斜 | 正后 | evidence_backed + inferred | “杆保持水平”有专业协议支持；最大允许相位差 **null** |
| 躯干横向偏移 | `midShoulder.x - midHip.x` 除以肩宽，或 torso axis 相对画面竖直投影 | 正后 | evidence_backed + inferred | Lorenzetti 报告小但非零 frontal ROM；接受阈值 **null** |
| 躯干后仰 | torso axis 对画面竖直的角度变化；必须是侧面/已标定 45°投影 | 侧面、后 45° | evidence_backed + inferred | 专业协议要求动作中躯干稳定；纯后视对深度后仰不敏感；阈值 **null** |
| 速度与节奏 | 对真实时间求腕/肘/上臂特征的一阶差分，分别保存 pull/return 峰值和停顿 | 所有可见机位 | evidence_backed + inferred | 研究观察到近端到远端峰值顺序；个体接受范围 **null** |
| 臀部离座 | 髋关键点相对座位/画面静态基准上移；没有座位 keypoint 时只输出候选 | 后 45°、侧面 | evidence_backed + hypothesis | 专业协议列为常见偏差；MediaPipe 单独不能确认接触状态 |
| 肩胛运动 | 需要肩胛标记、骨针/专门模型或清晰体表标志 | 多相机/实验室 | unavailable（单目 MediaPipe） | 禁止由肩点轨迹伪装成肩胛上回旋/后倾 |
| 盂肱轴向旋转、前臂旋前/旋后、腕屈伸 | MediaPipe Pose 缺少足够局部刚体标记 | 多相机/专用手臂模型 | unavailable（当前输入） | 对握法只读 metadata，不从普通视频精确反演 |
| 力矩、负重分配、疼痛或损伤风险 | 需外力、人体参数和受验证的动力学模型；疼痛需临床信息 | 实验室 | unavailable | 产品不得输出医疗/损伤风险判断 |

### 5. 握法、器械、座椅与 variation 分档

| 条件 | 是否独立档案 | 依据 |
| --- | --- | --- |
| 宽握旋前 vs 中等旋前 vs 窄握旋前 | 是 | [evidence_backed] 握宽影响可举负重和肌电；专业协议对宽握给出独立定义。 |
| 旋前 vs 中立 vs 旋后 | 是 | [evidence_backed] 专业资料把它们列为不同 variation；当前没有可共享轨迹的证据。 |
| 固定直杆 vs 独立把手/V 把 vs plate-loaded lever | 是 | [evidence_backed] 机器自由度会显著改变腕、肩、肘位移。 |
| selectorized cable vs 弹力带 | 是 | [evidence_backed + inferred] 阻力实现和可用路径不同；至少 `equipment` 不得相同。 |
| 座高、膝垫高度、滑轮高度 | 先保存原始设置；是否另分桶由实验决定 | [hypothesis] 设置会改变起始可达位置和身体固定，但未找到直接的参考轨迹分桶研究。 |
| 负重水平/接近力竭程度 | 必须保存；先按实验协议限制范围 | [evidence_backed] 25%/50% BW 条件下躯干 ROM 分布不同；没有跨负重不变性证据。 |

### 6. 机位模型与不可共享边界

| 机位 | 可优先观察 | 不可靠/不可判断 | 是否与其他机位共享数值走廊 |
| --- | --- | --- | --- |
| 正后 | 双腕高度、杆水平、左右肘/腕同步、上臂外展投影、躯干横移 | 深度方向后仰、前后肘位、真实肘屈伸可能因前臂朝镜头缩短 | 否；可共享特征名称，不共享参数 |
| 左后 45° | 左侧肩–肘–腕几何、肘角、躯干后仰投影，同时保留部分左右对称信息 | 右臂更易被躯干/杆遮挡 | 与右后 45°仅可做待验证的镜像映射 |
| 右后 45° | 与上行相反 | 左臂更易遮挡 | 同上 |
| 侧面 | 躯干后仰、近侧肘角、腕垂直行程 | 双侧同步、远侧臂 | 不共享 |
| 正面 | 双侧同步、杆水平、头/躯干横移 | 杆到胸前时手腕、肘和胸部互相遮挡；后仰深度 | 不共享 |

**[evidence_backed]** Ronai 只证明这些角度都可用于人工观察；**[unavailable]** 没有一手资料证明正后、左后 45°和右后 45°的 MediaPipe 特征具有同一误差分布。实现应把 `capturePosition` 作为必填条件。左右 45°镜像必须保存原机位和变换历史，并用同步多机位数据验证后才可合并。

### 7. 遮挡、visibility 和 `unknown`

MediaPipe 的 `visibility` 是“关键点在画面内且未被身体或物体遮挡”的模型概率，`presence` 只表示在画面内。[官方 model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)。因此：

- **[evidence_backed]** 若腕、肘、肩任一点在一个指标所需帧上低 confidence/visibility，该指标必须是 `unknown`，不能仅因为模型仍返回坐标就当作可见真值。
- **[inferred]** bottom 附近若手腕被杆、头或躯干遮挡：腕轨迹、肘角、左右同步、bottom 事件均按各自依赖关系返回 `unknown`；躯干横移若肩/髋仍可见，可继续输出。
- **[inferred]** 短缺帧可用于显示层平滑，但参考评分不得用插值后的点冒充真实观测。需要保留 `observed / smoothed / missing` mask；走廊训练只吃满足覆盖门的真实观测。
- **[hypothesis]** visibility 门槛和允许缺失长度必须由同步 Vicon/多机位实验标定；官方默认 detection/tracking confidence 0.5 不是动作指标的合格阈值。

## 第二优先动作：现有证据能支持的最小结论

下表只写一手资料可支持的内容。没有目标动作逐帧标准数据时，不补写角度阈值。

| 动作 | 平面、阶段和主要关节 | 可观察/机位 | 必须分档 | 数据与结论 |
| --- | --- | --- | --- | --- |
| 坐姿推肩 | **[evidence_backed]** bottom→press→top→return；肩与肘为主要关节，多平面肩运动。 | 正面适合双腕/肘同步和横向偏移；后 45°/侧面适合肘角、腕垂直轨迹和躯干；远侧遮挡为 unknown。 | 杠铃/双哑铃/机器、握宽、靠背角、是否独立手柄必须分档。 | 2025 年 11 名受训男性的坐姿杠铃推肩研究显示窄握增加负重及肩/肘 ROM，握宽影响整段水平杆力和前 64% 向心阶段的关节动力学；没有标准走廊。[DOI 10.1080/14763141.2025.2590028](https://doi.org/10.1080/14763141.2025.2590028)。MM-Fit 有坐姿哑铃推肩 observed RGB-D/pose，但采集时不纠正形式。 |
| 侧平举 | **[evidence_backed]** 以肩外展/肩胛平面抬臂为主，肘通常作为辅助；down→raise→top→lower。 | 正面/后面适合双腕高度、左右相位、躯干横移；45°适合上臂–躯干和肘投影；肩胛姿态不可由 MediaPipe 肩点直接判断。 | 坐/站、哑铃/钢索/机器、直臂/屈肘、单/双臂分档。 | MM-Fit 有坐姿哑铃侧平举 observed pose；Fit3D 论文用侧平举展示单教练左右上臂相位参考；UI-PRMD 有 standing shoulder abduction 的 Vicon/Kinect correct/incorrect 康复数据。三者均不能直接形成本项目器械 variation 的人群标准。 |
| 后束飞鸟 | **[inferred]** 起点合拢→肩水平外展到 peak→回程；肩为主，肘角和躯干姿态为辅助。 | 后面/后 45°适合左右腕/肘展开、躯干横移；侧面适合躯干角；手臂与躯干重叠时返回 unknown。 | 俯身/胸托/反向飞鸟机、哑铃/钢索、坐/站、握法分档。 | **[unavailable]** 未找到公开、逐帧、专家审核的目标动作参考轨迹；只有一般健身动作库/EMG 不能给数值走廊。 |
| 绳索面拉 | **[inferred]** 远端→拉向面部→近端 peak→回程；肩水平外展/外旋、肘屈曲、肩胛运动协同。 | 正面适合绳两端同步与横移；侧面/45°适合手到面部的投影距离和躯干；真实肩外旋、肩胛后倾不可由 Pose 33 点可靠判断。 | 绳高、站/跪/坐、握法、双/单钢索和训练侧分档。 | **[unavailable]** 未找到目标动作标准 2D/3D 轨迹数据；不得用训练机构文章填角度。 |
| 坐姿划船 | **[evidence_backed]** 远端伸臂→拉近躯干→近端→受控回程；肩、肘、肩胛带，躯干为稳定/协同段。 | 侧面/45°适合手–躯干距离、肘角和躯干摆动；正后适合左右同步和横移。 | 窄/宽把、胸托/无胸托、钢索/lever、握法、脚/座椅设置分档。 | Lorenzetti 以同一 Vicon 协议采到 15 人坐姿划船并证明其肩/脊柱 ROM 与其他拉类动作不同；是 observed aggregate，不是标准轨迹。[DOI 10.3390/jfmk2030033](https://doi.org/10.3390/jfmk2030033)。另有专项 kinetics/kinematics 论文 [Cronin et al., DOI 10.1519/R-21246.1](https://doi.org/10.1519/R-21246.1)。 |
| 杠铃划船 | **[inferred]** 垂臂→拉杆向躯干→近端→下降；肩、肘与躯干/髋等长或动态协同。 | 侧面/45°观察躯干角、杆/腕路径、肘角；正后观察杆水平与横向不对称。MediaPipe 无杆 keypoint，必须另做器械检测或把杆指标设 unknown。 | 正/反握、Pendlay/连续、躯干角、杆触点、负重和脚位分档。 | MM-Fit 只有 standing dumbbell rows observed data，不是杠铃划船；Fit3D 包含 barbell 类动作但公开页未证明有该目标 variation 的群体标准。**[unavailable]** 无可直接导入的标准走廊。 |
| 引体向上 | **[evidence_backed]** 悬垂→上拉→顶部→下降；相对固定杆移动身体，肩/肘/肩胛带和躯干参与。 | 侧面/45°适合肘角和躯干摆；正面/后面适合左右同步；杆/下巴过杆需杆和脸部检测，Pose 关键点本身不够。 | 旋前/旋后/中立、握宽、严格/摆动、负重与否分档。 | Doma 等人比较引体与高位下拉的背、肩、C7 运动和 EMG，证明两动作运动学不同，不能共享走廊。[DOI 10.1080/14763141.2012.760204](https://doi.org/10.1080/14763141.2012.760204)。专项 pull-up 3D 肌骨建模同样是 observed experiment，不是公开标准数据。[Urbanczyk et al., DOI 10.1111/sms.13780](https://doi.org/10.1111/sms.13780)。 |

## 数据源清单与许可证审计

“值得导入”仅表示可作为研究/验证输入；不代表可进入商业产品训练或成为 reference trajectory。

| 数据源 | URL/DOI | 动作 | 2D/3D | 人数/样本 | 逐帧关节坐标 | 标准还是观测 | 许可证 | 商业风险 | 是否值得导入 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Lorenzetti et al. Pulling Exercises | [10.3390/jfmk2030033](https://doi.org/10.3390/jfmk2030033) | 高位下拉、45°下拉、坐姿划船、直立划船 | Vicon 3D + 力 | 15 人；每动作每负重 8 reps；标准 LP 两负重约 240 observed reps | 采集过，但未公开下载；论文仅给聚合曲线/ROM | observed trajectory，统一口令，不是合格范围 | 论文 CC BY 4.0；原始数据无公开数据许可证 | 高：不能从文章许可推定原始坐标可商用 | **高价值约束源；不可直接导入原始轨迹** |
| Koyama et al. Enhancing the weight training experience | [10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y) | 三种自由度高位下拉机 | 运动学 + EMG | 7 男；可访问摘要未给可下载试次文件 | 否 | observed comparison | 出版物版权；无数据许可证 | 高 | **导入结论，不导入数据**；证明 equipment 分档 |
| LiftRight | [10.1016/j.smhl.2020.100115](https://doi.org/10.1016/j.smhl.2020.100115) | 高位下拉、卧推、过顶推举 | 上臂佩戴 IMU，50 Hz；非 2D/3D 关节坐标 | 8 人、26 周、约 4,000 reps（3 动作合计） | 否；逐帧惯性信号和派生 ROM/速度 | observed trajectory + rep/phase segmentation；没有专家标准轨迹 | 出版物版权；未找到公开可下载数据集及数据许可证 | 高 | **导入方法结论，不导入轨迹**；可借鉴 rep/phase 分段及 ROM/速度指标，但不能提供姿势走廊 |
| Doma et al. chin-up vs lat-pulldown | [10.1080/14763141.2012.760204](https://doi.org/10.1080/14763141.2012.760204) | 引体、高位下拉 | 运动学 + EMG | 可访问记录未提供公开逐帧样本 | 否 | observed comparison | 出版物版权；无数据许可证 | 高 | **导入结论，不导入数据** |
| Fit3D / AIFit | [dataset card](https://fit3d.imar.ro/fit3d)，[paper](https://fit3d.imar.ro/sites/default/files/public/pdf/Fieraru_2021_CVPR.pdf) | 47 类热身、杠铃、哑铃、自重；设备清单无高位下拉机 | 4-view RGB + Vicon 3D + GHUM/SMPL-X | 13 人（1 教练、12 trainees）；611 多视角序列；每序列 ≥5 reps；2,964,236 帧 | 是，25 joints/50 Hz；有人工 rep intervals | `Trainees3D` observed；`Reference3D` 只有 1 名教练，不能视为群体走廊；segmentation GT 独立可用 | [仅非商业科研，禁止商用训练；商业许可另询](https://fit3d.imar.ro/legal) | **极高** | 只在获许可的内部研究中评估分段/表示；不要用于商业模型或冒充高位下拉标准 |
| FLAG3D | [project](https://andytang15.github.io/FLAG3D/)，[paper](https://openaccess.thecvf.com/content/CVPR2023/papers/Tang_FLAG3D_A_3D_Fitness_Activity_Dataset_With_Language_Instruction_CVPR_2023_paper.pdf) | 60 类健身；当前审计未确认包含器械高位下拉 | Vicon 3D、合成多视角、手机 2D | 10 MoCap 人员 × 3 次 × 60 动作；经 4 次 retarget 为 7,200 motion seq；总计 180K 视频 | MoCap skeleton/markers：是 | 参与者按说明执行；没有动作级可接受走廊 | [仅科学研究、禁止商业和再分发、须签协议](https://andytang15.github.io/FLAG3D/License_FLAG3D.pdf) | **极高** | 研究动作表示可用；先审计动作表，不能作为产品参考数据 |
| MM-Fit | [project](https://mmfit.github.io/)，[paper DOI 10.1145/3432701](https://doi.org/10.1145/3432701)，[Zenodo 10.5281/zenodo.7607736](https://doi.org/10.5281/zenodo.7607736) | 坐姿哑铃推肩、坐姿侧平举、站姿哑铃划船等 10 类；无高位下拉 | 两路 RGB-D、2D/3D pose estimate、IMU | 10 人、21 workout sessions；每 session 三组、每动作每组约 10 reps；>800 分钟 | 是，但为视觉/深度推定，不是 marker GT | observed；论文明确“演示但不纠正 form”；含活动区间/计数标注 | [starter code MIT](https://github.com/KDMStromback/mm-fit/blob/master/LICENCE.txt)；Zenodo 数据记录的 Rights 字段未标明许可证 | **高/不明确**：不可把代码 MIT 推定给数据 | 可用于非产品的分段和遮挡研究；使用数据前书面确认许可 |
| FLEX AQA Dataset | [official project](https://haoyin116.github.io/FLEX_Dataset/)，[arXiv 2506.03198](https://arxiv.org/abs/2506.03198)，[official repo/access terms](https://github.com/HaoYin116/FLEX_AQA_Dataset) | 20 类杠铃/哑铃负重动作，含坐姿哑铃推肩、杠铃俯身划船等；不含高位下拉机 | 5-view RGB、markerless 3D pose、点云、sEMG、生理信号 | 38 人（10 专家、8 业余、20 新手）× 20 动作 × 10 reps；7,512 samples、>40 小时 | 是，3D pose；另有阶段、错误类型和反馈注释 | 质量评估观测 + 专家规则/错误注释；比普通录像更接近 reference evidence，但不是按机位/器械/人群发布的轨迹分位走廊 | 官方 repo：须申请，仅限 academic purposes，禁止 commercial exploitation | **极高** | 值得在获准的纯研究环境审计标注结构和多机位误差；目标设备不含高位下拉，不能直接导入产品或替代本项目参考库 |
| UI-PRMD | [paper/data descriptor DOI 10.3390/data3010002](https://doi.org/10.3390/data3010002) | 10 个康复动作，含 standing shoulder abduction/scaption；不含目标高位下拉 | Vicon 3D 100 Hz + Kinect | 10 人 × 10 动作 × 正确/模拟错误 × 各 10 reps；每动作约 200 episodes | 是；位置与角度 | 协议内 correct/incorrect 康复演示，可作质量评估研究；不是健身器械走廊 | [ODC PDDL 1.0](https://opendatacommons.org/licenses/pddl/1-0/) | 低（仍须保留伦理/来源审计） | 值得导入以验证 schema、相位和 missing mask；不要迁移数值到高位下拉/负重侧平举 |
| MediaPipe Pose Landmarker | [official guide/model table](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/)，[repo](https://github.com/google-ai-edge/mediapipe) | 通用人体 pose，不含动作正确性 | 单目 2D + 推定 world landmarks | 模型，不是动作数据集；33 landmarks | 每帧输出坐标、visibility/presence | pose observation tool；不是 segmentation GT 或 reference | Apache-2.0（代码/官方包；发布时仍应锁版本并保留 notices） | 低到中：模型/包版本和第三方 notices 需单独清点 | 适合端侧提特征和轻量平滑；不能提供标准姿势 |

### 许可证特别结论

- **[evidence_backed]** Fit3D 和 FLAG3D 的数据许可证明确禁止商业使用；不能因为配套代码是 MIT 就把数据或由其训练的产品模型当可商用。
- **[evidence_backed]** MM-Fit GitHub 代码是 MIT，但官方 Zenodo 数据记录没有给出明确 Rights；在获得数据所有者书面澄清前，按商业高风险处理。
- **[evidence_backed]** CMU OpenPose 官方许可仅允许学术/非营利非商业研究；如果产品将其列作替代方案，需要单独商业授权。[官方 LICENSE](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/LICENSE)
- **[evidence_backed]** MediaPipe 官方仓库为 Apache-2.0，适合 Web/移动端技术验证；但它只产生 pose observations，不产生动作参考标签。[官方仓库](https://github.com/google-ai-edge/mediapipe)

## 开源方法能做什么、不能做什么

| 方案 | 可以做 | 不能做 | 证据/许可 |
| --- | --- | --- | --- |
| MediaPipe Pose | 端侧关键点、visibility/presence、视频跟踪、可选跨帧平滑 | 证明动作“标准”、输出肩胛/外力、给出医学风险 | [官方输出与 smoothLandmarks](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)，Apache-2.0 |
| AIFit rep segmentation | 从 3D pose 自相关初始化并优化 rep 区间；提供人工 segmentation GT 的数据格式范例 | 把普通 trainee 动作变成标准；其“reference”只有一位教练 | [CVPR 2021 paper](https://fit3d.imar.ro/sites/default/files/public/pdf/Fieraru_2021_CVPR.pdf)；工具代码 MIT、数据非商用 |
| AIFit angular feature signature | 使用身体坐标轴和角度降低身材/全局朝向影响；区分 active/passive feature | 直接给高位下拉的可接受分位区间；单教练统计不能替代群体走廊 | 同上 |
| MM-Fit activity segmentation/repetition counting | 训练识别“何时在做哪项动作”、计数候选 | 提供正确动作或标准轨迹；其采集明确不纠正 form | [DOI 10.1145/3432701](https://doi.org/10.1145/3432701) |
| LiftRight IMU segmentation/metrics | 从单个上臂 IMU 检出 set/rep/phase，计算 ROM、速度等 performance metrics | 恢复肩/肘/腕 2D/3D 轨迹；把观测分布升级为专家标准姿势 | [DOI 10.1016/j.smhl.2020.100115](https://doi.org/10.1016/j.smhl.2020.100115)；未找到可导入数据许可证 |
| FLEX AQA baselines/knowledge graph | 研究多机位、3D pose、阶段和专家错误注释如何组合做动作质量评估 | 为高位下拉提供参考走廊；在商业产品中直接使用受限数据/模型 | [official project](https://haoyin116.github.io/FLEX_Dataset/)，[academic-only access terms](https://github.com/HaoYin116/FLEX_AQA_Dataset) |
| OpenPose | 2D 多人关键点提取 | 3D 标准、动作正确性、商业产品免费使用 | [论文](https://arxiv.org/abs/1812.08008)，[非商业许可](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/LICENSE) |
| DTW/时间重采样 | 对已批准 rep 做有限、可审计的长度归一化或辅助对齐 | 用无约束 warping 掩盖停顿、借力、反向运动；把相似度变成正确性 | [inferred] 算法只定义距离/对齐，参考合法性仍来自审核数据 |

## 最小可行参考模型

### 数据合同

**[inferred]** 每个参考 profile 至少携带：

```text
exerciseId
capturePosition
variation
trainingSide
equipment
coordinateSystem
featureSchemaVersion
sourceProtocol
expertApprovalRevision
```

每个 feature 每个相位点携带 `value | null`、`visibility`、`confidence`、`observationState`；`observationState` 至少区分 `observed / missing / not_applicable`。任何需要的关键点不足时，值为 `null`/`unknown`。

### 走廊

**[inferred]** 对每个已批准 rep：

1. 保留原始时间，人工确认 `start / bottom / end`。
2. pull 和 return 分开按相位重采样；保留各相原始 duration、停顿和速度峰值。
3. 先使用单变量 `median + quantile band`；有效样本足够且 missing-aware 验证完成后，才增加阶段内鲁棒协方差/多变量距离。
4. rep 是一个观测，**人**才是泛化的主要独立单位；构建分位区间时应先在人员内汇总或用层级 bootstrap，避免一个人做很多 reps 主导走廊。
5. 阈值、分位数选择、最小 visibility、最大缺失跨度全部为 profile 版本的一部分，只能由训练/验证分离的实验确定。

这个模型轻量、可解释，也能部署到 Web/移动端；它没有依赖无限制 DTW或端到端大模型。

## 最小实验、泛化声明与共同未知

### 可行性实验

**[hypothesis]** 先只做一个档案：`lat_pulldown / front-wide-pronated / selectorized-cable / bilateral`。

- 人员：12–15 名无当前疼痛、熟悉动作的成人；尽量覆盖性别、身高、臂长和训练经验。
- 会话：每人至少 2 次、不同日期；每次 5–8 个专家接受 rep。
- 机位：同步正后、左后 45°、右后 45°；相机固定、记录内外参与时间同步。
- 条件：先固定握宽、直杆、座椅/膝垫设置规则、负重区间和动作口令；不要在首轮同时测试多握法。
- 标注：两名合格教练独立批准 `start/bottom/end` 和动作是否进入参考库；分歧复核。`observed`、`segmentation`、`reference approval` 分开存。
- 成功信号：同一 profile 的特征在跨会话复测中稳定；一台机位遮挡时能正确返回 unknown；三机位各自走廊对 held-out 人员不过度拒绝；借力/停顿样本不被相位归一化抹掉。
- 失败信号：机位间数值映射不稳定、bottom 大面积遮挡、专家一致性低、同人跨会话漂移与人际差异同量级。失败时优先调整机位/特征，不增加假阈值。

12–15 人与现有直接研究规模相近，只能声称“流程和特征可行”。

### 何时才能谈泛化

**[unavailable]** 没有一手资料为“健身动作参考走廊”规定统一人数或 rep 数。必须为主要误差率/覆盖率预注册样本量，并报告置信区间。

**[hypothesis]** 在没有更精确功效分析前，产品层面至少应满足：

- 每个最终 `variation + equipment` 档案有 50–100 名独立人员，而不是用同一人的大量 reps 补人数；
- 每人至少两次会话、每会话 5 个批准 rep；
- 至少两个场地、两台同类但不同设备实例；
- 独立留出人员，若声称跨设备则还要留出设备/场地；
- 分性别/身材/经验报告覆盖率和 unknown 率，不只报告总体平均；
- 若要合并左右 45°，需预先定义镜像变换，并在未用于拟合的人上验证等价性。

50–100 人是用于启动严肃验证的工程前验，仍不能替代基于目标置信区间的样本量计算，也不能被描述为论文认证标准。

### 最值得采集的数据

1. **同一次 rep 的三机位 RGB + 实验室 3D/标记式 mocap 子集。**它能直接回答后视/45°的角度偏差、visibility 与真实遮挡、左右镜像是否成立。
2. **专家批准的 front-wide-pronated 高位下拉。**先固定机器和设置，获得真正的 reference approvals，而不是扩大普通训练录像数量。
3. **设备和设置 metadata。**直杆/独立把手、滑轮类型、座高、膝垫、握距（相对肩峰宽）、负重、节奏、会话、场地。
4. **困难样本的明确 unknown 标签。**bottom 手臂遮挡、出画、杆遮腕、深色衣物、快速 rep；记录每个 feature 的可观测性。
5. **跨会话复测与跨设备留出。**这比同一人同一日多录几十次更能判断泛化。

## 最终问题的直接回答

### 1. 是否存在可以直接使用的高位下拉标准三维轨迹数据？

**否。[unavailable]** 有高位下拉 3D 实验研究，但没有找到兼具逐帧公开、专家/生物力学可接受范围、可审计分档和适用商业许可的数据集。Lorenzetti 的 Vicon 研究最接近，但公开的是聚合结果，不是可下载标准轨迹。

### 2. 如果不存在，哪些部分能由论文约束，哪些必须由专家审核录像建立？

论文可约束阶段语义、主要关节、宽握旋前协议、双手/杆同步、躯干稳定、器械/握法/负重必须记录，以及哪些变量单目不可见。专家审核数据必须建立：逐相位分位走廊、允许的自然变异、visibility 门槛、最大可接受停顿/速度变化、机位映射、左右 45°镜像等价性和所有实际阈值。

### 3. 当前项目最小可行模型是什么？

一个 profile-specific、phase-specific 的轻量多特征走廊：人工批准 `start/bottom/end`，pull/return 分开归一化；使用身体尺度归一角度和躯干相对坐标；中心用中位数、范围用分位带；保留原始时长/速度/停顿；所有指标带 visibility/confidence 和 unknown；禁止跨 variation/equipment/capturePosition 静默合并。

### 4. 多少人、机位和 rep 可以开始，多少才能声称泛化？

可行性：12–15 人、2 次会话、每次 5–8 个批准 rep、三同步机位、一个固定 variation。泛化没有已发表统一 N；工程前验为每个最终档案 50–100 个独立人员、每人至少两会话和每会话 ≥5 reps、两场地/两设备实例，并做 person/site/equipment 留出。两组数字均为假设，后者仍需功效/精度计算。

### 5. 哪些开源方案只能用于平滑、对齐或分段，不能提供标准姿势？

MediaPipe、OpenPose、AIFit 的 rep segmentation、MM-Fit 的 activity segmentation/repetition counting，以及 DTW/时间重采样都属于这一类。AIFit 的单教练 `Reference3D` 可研究参考表示，但不能直接当群体标准走廊。

### 6. 下一步最值得采集什么？

固定一种高位下拉 variation，采集同步正后/左右后 45°、完整设备设置和负重 metadata、两次会话、双专家独立批准边界/参考资格；其中一小批同步 Vicon 或其他标记式 3D 用来校准单目误差和 unknown 规则。这比继续积累没有专家审核的普通录像更有价值。

## 一手资料索引

- [Lorenzetti, Dayer, Plüss, List (2017), *Pulling Exercises for Strength Training and Rehabilitation: Movements and Loading Conditions*, DOI 10.3390/jfmk2030033](https://doi.org/10.3390/jfmk2030033)
- [Koyama et al. (2010), *Enhancing the weight training experience: a comparison of limb kinematics and EMG activity on three machines*, DOI 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y)
- [Ronai (2019), *The Lat Pulldown*, DOI 10.1249/FIT.0000000000000469](https://doi.org/10.1249/FIT.0000000000000469)
- [Andersen et al. (2014), *Effects of grip width on muscle strength and activation in the lat pull-down*, DOI 10.1097/JSC.0000000000000232](https://doi.org/10.1097/JSC.0000000000000232)
- [Doma, Deakin, Ness (2013), *Kinematic and electromyographic comparisons between chin-ups and lat-pull down exercises*, DOI 10.1080/14763141.2012.760204](https://doi.org/10.1080/14763141.2012.760204)
- [Milanko, Jain (2020), *LiftRight: Quantifying strength training performance using a wearable sensor*, DOI 10.1016/j.smhl.2020.100115](https://doi.org/10.1016/j.smhl.2020.100115)
- [Gundersen et al. (2025), *The impact of grip width on kinetics and kinematics in the shoulder press among resistance-trained men*, DOI 10.1080/14763141.2025.2590028](https://doi.org/10.1080/14763141.2025.2590028)
- [Fieraru et al. (CVPR 2021), *AIFit: Automatic 3D Human-Interpretable Feedback Models for Fitness Training*](https://fit3d.imar.ro/sites/default/files/public/pdf/Fieraru_2021_CVPR.pdf)
- [Fit3D official dataset card](https://fit3d.imar.ro/fit3d) and [official legal terms](https://fit3d.imar.ro/legal)
- [Tang et al. (CVPR 2023), *FLAG3D: A 3D Fitness Activity Dataset with Language Instruction*](https://openaccess.thecvf.com/content/CVPR2023/papers/Tang_FLAG3D_A_3D_Fitness_Activity_Dataset_With_Language_Instruction_CVPR_2023_paper.pdf) and [official license](https://andytang15.github.io/FLAG3D/License_FLAG3D.pdf)
- [Yin et al. (2025), *FLEX: A Largescale Multimodal, Multiview Dataset for Learning Structured Representations for Fitness Action Quality Assessment*, arXiv 2506.03198](https://arxiv.org/abs/2506.03198), [official project](https://haoyin116.github.io/FLEX_Dataset/), [official access terms](https://github.com/HaoYin116/FLEX_AQA_Dataset)
- [Strömbäck, Huang, Radu (2020), *MM-Fit*, DOI 10.1145/3432701](https://doi.org/10.1145/3432701), [official project](https://mmfit.github.io/), [official repository](https://github.com/KDMStromback/mm-fit)
- [Vakanski et al. (2018), *A Data Set of Human Body Movements for Physical Rehabilitation Exercises*, DOI 10.3390/data3010002](https://doi.org/10.3390/data3010002)
- [MediaPipe Pose official documentation](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md), [Pose Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/), [BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), [Apache-2.0 repository](https://github.com/google-ai-edge/mediapipe)
- [CMU OpenPose official repository/license](https://github.com/CMU-Perceptual-Computing-Lab/openpose/blob/master/LICENSE)
