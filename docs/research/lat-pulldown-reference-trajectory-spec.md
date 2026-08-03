# 高位下拉可接受轨迹走廊规范

日期：2026-08-03
状态：研究规范，不修改现有识别算法；不用于医疗、康复或损伤风险判断。

## 结论先行

当前没有找到一套可合法直接用于本项目、同时满足“高位下拉 + 逐帧 3D 关节坐标 + 多人 + 专家确认合理动作 + 可商业使用”的标准轨迹数据。因此 v1 不能写入任何未经本项目验证的角度阈值。

最小可行方案是建立一个**分桶、分相位、带缺失语义的统计参考档案**：

1. 只从经过双人专业审核并最终裁决为“在本档案定义下可接受”的 rep 构建 `reference trajectory`；普通训练录像只能是 `observed trajectory`，人工确认的 `start / bottom / end` 只能是 `segmentation ground truth`。
2. 档案键至少是 `exerciseId + capturePosition + variation + trainingSide + equipment + coordinateSystem + featureSchemaId`。器械不能省略：Koyama 等人的三种高位下拉机器实验中，机器自由度改变了手腕垂直位移、肩内收/外展行程及肘屈伸行程（7 名男性、30% 1RM、特殊 BML 技术），证明不同机器上的轨迹不能默认共用。[原始论文，DOI: 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y)
3. 每个 rep 以人工批准的 `start → bottom → end` 作**分段线性**归一化；pull 与 return 分开比较。禁止无限制 DTW 把停顿、借力或错误相位顺序“对齐掉”。DTW 的作用本来就是用时间扭曲匹配序列，不提供动作正确性。[Sakoe & Chiba，DOI: 10.1109/TASSP.1978.1163055](https://doi.org/10.1109/TASSP.1978.1163055)
4. v1 走廊优先保存逐相位的中位轨迹与分位区间；样本足够后才增加低维鲁棒协方差。MCD/MRCD 是鲁棒位置和散布估计方法，但同样不产生“标准动作”的语义。[MRCD 原始方法，DOI: 10.1007/s11222-019-09869-x](https://doi.org/10.1007/s11222-019-09869-x)
5. 单目 MediaPipe 只负责观测。官方定义的 `visibility` 是点可见或遮挡的评分，不是位置准确率或动作质量；低可见、出画、杆/手臂遮挡时相应指标必须为 `unknown`。[MediaPipe Landmark 官方定义](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/components/containers/Landmark)

文中结论使用以下证据状态：

- `evidence_backed`：一手资料直接支持。
- `inferred`：由一手资料与成像几何合理推导，尚无高位下拉直接轨迹验证。
- `hypothesis`：需要本项目的同步录像、动作捕捉或专业审核实验验证。
- `unavailable`：目前没有可信资料支持。

## 三种数据对象必须物理隔离

| 对象 | 最小含义 | 谁能批准 | 能否进入参考走廊 |
| --- | --- | --- | --- |
| `observed trajectory` | 某人某次实际动作的 pose/特征时间序列 | 采集流程确认来源即可 | 否；可用于计数、可观测性和压力测试 |
| `segmentation ground truth` | 每次 `start / bottom / end` 的人工批准边界 | 经过标注培训的审核者 | 否；只监督分段 |
| `reference trajectory` | 与明确档案条件一致、经两名专业审核者独立接受并裁决的 rep 集合及其统计走廊 | 两名审核者 + 分歧裁决 | 是 |

Fit3D/AIFit 清楚地把人工 rep 时间戳、训练者观测和教练参考拆开：数据集中只有一名持证教练被当作参考，其他人是 trainees；论文用角度特征比较两者。[AIFit / Fit3D 原始论文](https://openaccess.thecvf.com/content/CVPR2021/html/Fieraru_AIFit_Automatic_3D_Human-Interpretable_Feedback_Models_for_Fitness_Training_CVPR_2021_paper.html) 该设计证明“参考”和“观测”应分层，但**单一教练也只是单一参考，不能代表人群可接受走廊**；而且 Fit3D 使用哑铃、杠铃、弹力带等物体，公开说明没有高位下拉器械动作。[Fit3D 官方数据页](https://fit3d.imar.ro/fit3d)

## 参考档案身份与变式边界

### 必填身份

```text
exerciseId           = lat_pulldown
capturePosition      = rear | rearLeft45 | rearRight45 | ...
variation            = grip width + forearm orientation + pull direction
trainingSide         = bilateral | left | right
equipment            = cable/machine family + handle + path constraints
coordinateSystem     = source-image/v1（或明确版本的相机/身体坐标系）
featureSchemaId      = lat_pulldown/<capturePosition>/<variation>/<version>
referencePopulation  = 审核规则、纳入人群与采集批次
```

`cameraView` 可以保留作粗粒度 UI 属性，但不能代替实体 `capturePosition`。

### 不能默认合并的条件

| 条件 | 处理 | 状态与依据 |
| --- | --- | --- |
| 宽握正握、肩宽正握、窄中立握、反握 | 分开建档；数据证明等价后才能派生合并档 | `inferred`。研究把握宽与前臂朝向作为不同条件；Lusk 等以 biacromial distance 定义窄握，以 carrying width 定义宽握，并发现肌电响应随前臂朝向变化。[DOI: 10.1519/JSC.0b013e3181ddb0ab](https://doi.org/10.1519/JSC.0b013e3181ddb0ab) 肌电不等于轨迹，但明确说明 variation 不是可丢弃元数据。 |
| 直杆、V 把、独立把手、固定轨迹/发散式机器 | 分开建档 | `evidence_backed`：器械自由度改变实际关节与手腕运动。[DOI: 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y) |
| 杆前下拉与颈后下拉 | 分开动作变式；v1 只做杆前 | `evidence_backed`：原始研究把 wide anterior / wide posterior 明确作为不同条件。[DOI: 10.1519/1533-4287(2002)016%3C0539:ACEIOM%3E2.0.CO;2](https://doi.org/10.1519/1533-4287(2002)016%3C0539:ACEIOM%3E2.0.CO;2) |
| 座椅高度、大腿垫、身体相对滑轮的前后距离 | 必须记录；首轮固定设置规则，不足时分桶 | `inferred`：它们改变身体与力线的相对几何；尚无可直接转成阈值的多人轨迹数据。 |
| 负重与节奏 | 保存连续值/协议；首轮限制在预先定义范围 | `inferred`。论文中的 30% 1RM、70% 1RM、2 s + 2 s 是实验条件，不是正确动作阈值。[Koyama 等](https://doi.org/10.1007/s00421-010-1421-y)；[Lusk 等](https://doi.org/10.1519/JSC.0b013e3181ddb0ab) |

### 数值证据边界

文献中的以下数值只可记录为“研究条件”，不得写成 v1 合格门槛：

- `1 × biacromial distance`、`1.5 × biacromial distance`：部分握宽研究的条件定义，不是普遍合格区间；`evidence_backed` for protocol，`unavailable` for acceptance threshold。
- 躯干后仰 `30°`：近年肌电研究的实验变式，不是“最佳”或“最大允许”后仰；`evidence_backed` for protocol，`unavailable` for acceptance threshold。[原始研究，DOI: 10.3390/jfmk10030345](https://doi.org/10.3390/jfmk10030345)
- `2 s concentric + 2 s eccentric`：Lusk 等人的控制节奏，不是正常训练的唯一合理节奏；`evidence_backed` for protocol，`unavailable` for acceptance threshold。
- 任意肘角、上臂—躯干角、手腕落点、左右差、速度或后仰阈值：`unavailable`，在专家参考队列完成前必须为 `null`。

## 运动平面、关节与可见代偿

针对 v1 的**杆前、双侧、正握高位下拉**：

- 主要动作是肩关节内收（并可包含伸展/水平外展分量）与肘屈，肩胛胸廓关节参与下旋/后缩，回程方向相反；`evidence_backed`。[Ronai，DOI: 10.1249/FIT.0000000000000469](https://doi.org/10.1249/FIT.0000000000000469)
- 宽正握更接近额状面/肩胛面代理，窄中立握或反握会增加矢状面成分；后一句是 `inferred`，也是握法不可共用轨迹档案的原因之一。
- 主要关节：盂肱关节、肘关节；辅助/协同：肩胛胸廓复合体、前臂旋前/旋后与腕/手抓握；躯干和髋/骨盆主要承担稳定。`evidence_backed` for involved regions，精确三维协同范围 `unavailable`。

单目视频可可靠**候选观察**而非直接判错的代偿包括：

- 正后/正前：左右腕或肘事件明显不同步、身体横向漂移、双侧幅度差、手臂出画；`inferred`。
- 侧面/斜后 45°：随 pull 明显改变的图像平面躯干后仰、反复前后摆动、近侧手腕/肘路径突然反向；`inferred`。
- 全机位：相位内长停顿、A→B 未返回 A、关键点低可见或器械遮挡；`inferred`。

这些输出只能写成 `observed deviation` 或 `outside_reference`；在没有专家阈值和三维校准前，不能写成“错误动作”或损伤风险。正后机位的前后摆动、斜后机位的远侧肢体幅度，以及任何肩胛运动均可能不可判断，应输出 `unknown`。

## 相位模型

### 事件定义

| 事件/相位 | 操作定义 | 可用信号 | 证据状态 |
| --- | --- | --- | --- |
| `start` | 手臂位于本 rep 上端，随后开始连续向下；排除上器械、调握与第一次预拉 | 双腕相对肩的高度、肘角、速度符号；人工批准 | `inferred`。高位下拉是肩带/肩/肘参与的开链动作。[Ronai，DOI: 10.1249/FIT.0000000000000469](https://doi.org/10.1249/FIT.0000000000000469) |
| `pull` | 从 `start` 后首次持续向下运动至 `bottom`；预期伴随肘屈与上臂相对躯干下降 | 双腕高度速度、肘角变化、上臂—躯干角变化 | `evidence_backed` for joint involvement/direction；轨迹范围 `unavailable` |
| `bottom` | 向心末端；腕部下降转为停顿/回程，肘屈与上臂下降到该 rep 的末端状态 | 人工事件；多信号局部极值仅作候选 | `inferred`；没有可信的通用角度阈值 |
| `return` | 从 `bottom` 至手臂受控回到下一上端 | pull 的反向多关节变化；保留速度和停顿 | `evidence_backed` for eccentric return；走廊数值 `unavailable` |
| `end` | 回到上端并完成本次 A→B→A；与下一次 `start` 可同帧，但必须保存事件语义 | 腕高/肘角回到本次上端邻域；人工批准 | `inferred` |

### 时间归一化

每次保存原始毫秒时间、两相位时长和分段归一化表示：

```text
raw:      startMs -------- bottomMs -------- endMs
global:      0%               50%             100%
pullLocal:   0%              100%
returnLocal:                   0%              100%
```

规则：

1. `start→bottom` 与 `bottom→end` 各自做单调线性重采样，例如每相位 16 个节点；这只是统一数组形状。
2. 同时保存 `pullDurationMs`、`bottomDwellMs`、`returnDurationMs`、`bottomFractionRaw=(bottom-start)/(end-start)`，避免归一化掩盖真实节奏。
3. 不跨相位做 DTW；如用于离线探索，只允许预注册的窄 Sakoe–Chiba band，并且不得改变事件顺序、吞掉停顿或作为正确性来源。
4. 自动极值只能产生 `segmentation candidate`。reference 数据的三个事件必须来自人工批准。

## 多关节特征

所有连续特征同时携带 `value | null`、`visibility`、`confidence`、`status=observed|unknown` 和 `unknownReason`。身体尺度优先使用同帧肩中点—髋中点长度；该尺度不可用时，不得换用跨人固定像素比例。

| 特征 | 定义 | 推荐坐标 | 用途 | 状态 |
| --- | --- | --- | --- | --- |
| `wristRelativeToShoulder.left/right` | `(wrist - shoulderCenter) / torsoLength` 的 x/y；z 只保留实验字段 | source image 2D；可另存 world experimental | 主轨迹、ROM、同步 | `inferred`；机器会改变 wrist displacement 的事实有直接支持，但无参考范围 |
| `elbowAngle.left/right` | shoulder–elbow–wrist 夹角 | 机位内 2D；3D 只作验证支路 | pull 时总体趋向屈曲、return 时趋向伸展 | 方向 `evidence_backed`，逐时点范围 `unavailable` |
| `upperArmToTorso.left/right` | 上臂向量与同侧肩—髋躯干向量夹角 | 2D 机位内 | 肩内收/伸展的可观察代理 | `inferred`；不能称盂肱三维角 |
| `bilateralWristPhaseLag` | 两腕主相位信号的事件时间差或局部相关滞后 | 同一相机时基 | 左右同步性 | `hypothesis`；阈值必须由同步真值实验确定 |
| `bilateralAmplitudeDifference` | 左右腕/肘的相位内幅度差，按身体尺度归一化 | 2D | 左右不对称候选 | `hypothesis`；透视差先校准 |
| `torsoLeanImagePlane` | 肩中点—髋中点相对图像竖直的角度 | 侧面或斜后 45° | 后仰变化代理 | `inferred`；正后机位不可辨后仰 |
| `torsoLateralShift` | 肩/髋中点相对 rep 起点或座椅锚点的水平位移 / torsoLength | 正后最佳 | 横向偏移/借力候选 | `inferred`；相机滚转和裁切需校准 |
| `phaseVelocity` | 对可靠、连续、时间戳化的上述信号求导 | 按真实 ms | 检测停顿、反向和速度峰 | `inferred`；平滑参数需要验证 |
| `shoulderElbowWristPeakOrder` | 肩、肘、腕速度峰的顺序 | 多关节时间序列 | 仅器械/技术特定的协同探索 | `hypothesis`。Koyama 在 Type-3+BML 条件观察到肩→肘→腕，不能推广为普通高位下拉标准。 |

MediaPipe/BlazePose 输出 33 点并适合移动端实时运行，但其论文明确指出姿势多自由度与遮挡会带来挑战；visibility 分类器是为了标识遮挡/预测不可靠，而不是给出动作质量。[BlazePose 原始论文](https://arxiv.org/abs/2006.10204) 因此本规范不试图从 MediaPipe 肩点推断肩胛后缩、下沉、上旋或盂肱外旋。

## 机位模型

### 指标可观测性

| 指标 | 正后 `rear` | 左后 45° `rearLeft45` | 右后 45° `rearRight45` | 正侧面 | 正前 |
| --- | --- | --- | --- | --- | --- |
| 双腕 x/y 轨迹与同步 | 最佳候选，杆/手遮挡时 unknown | 可用，近侧优先 | 可用，近侧优先 | 远侧常遮挡 | 可用但器械/脸可能遮挡 |
| 双肘 2D 角 | 双侧可用候选 | 近侧较可信，远侧可 unknown | 近侧较可信，远侧可 unknown | 近侧可用 | 双侧可用候选 |
| 上臂—躯干 2D 角 | 冠状面代理较好 | 混合平面，只与同机位档案比较 | 混合平面，只与同机位档案比较 | 矢状面代理 | 冠状面代理 |
| 左右横向偏移 | 最佳候选 | 可用但有透视 | 可用但有透视 | 不适合 | 可用候选 |
| 躯干后仰 | `unknown` | 近似代理，待校准 | 近似代理，待校准 | 最佳 2D 代理 | `unknown` |
| 肩胛运动/肩关节旋转 | `unknown` | `unknown` | `unknown` | `unknown` | `unknown` |
| 手柄/杆相对胸部纵深 | `unknown` | 仅粗略代理 | 仅粗略代理 | 若完整可见则候选 | `unknown` |

### 三个后方机位能否共享

- 可以共享：特征名称、单位、相位语义、缺失规则、审核表；`evidence_backed/inferred`。
- 不可直接共享：数值中位曲线、分位走廊或阈值。45° 投影改变幅度，且左右 45° 的近/远侧遮挡不同；`inferred`。
- 可验证的合并假设：`rearLeft45` 与 `rearRight45` 在 source 坐标中按明确左右交换与 x 轴反射后，分布等价；`hypothesis`。必须用同步三机位录像检验，不能以 UI 镜像作为数据变换。
- `rear` 与两个 45° 档案只有在逐特征误差和覆盖率达到预注册标准后，才允许建立一个**派生共享档案**；原始档案永远保留。

## 缺失点与 `unknown`

### 底部遮挡规则

按指标拒答，不必把整个 rep 一律丢弃：

1. 腕、肘或肩任一点在 `bottom` 邻域不可见/出画/被杆遮挡，则依赖该点的腕轨迹、肘角、上臂角、左右同步在该节点输出 `unknown`。
2. 只有双肩与双髋仍可靠时，躯干横移/图像平面倾角可以继续输出；不得因手臂缺失而伪造手臂，也不得因手臂缺失而无条件丢弃可观察的躯干事实。
3. 不以线性、样条、前后最近帧或镜像另一侧填补被遮挡的 `bottom`。短时平滑仅对连续的真实观测降抖；1€ filter 的原始目标是在 jitter 与 lag 间折中，并不恢复缺失语义。[Casiez 等，DOI: 10.1145/2207676.2208639](https://doi.org/10.1145/2207676.2208639)
4. `visibility` 门槛本身是工程参数，必须由本项目真值标注校准；在校准前 schema 中为 `null`，不能把 MediaPipe 常见默认值误称为正确性证据。
5. 若 `start`、`bottom`、`end` 任一事件缺少该档案的核心特征，则该 rep 可保留为 observed/segmentation 数据，但不得进入该核心特征的 reference 走廊。

推荐的缺失原因枚举：

```text
low_visibility | out_of_frame | self_occlusion | equipment_occlusion |
far_side_occlusion | timestamp_gap | scale_unavailable | view_unsupported |
model_disagreement | not_annotated
```

## 轨迹走廊表示

### v1：逐特征分位走廊

对一个严格同桶的 reference rep 集合，在每个相位节点、每个特征上保存：

```text
nObserved
median
qLow
qHigh
medianAbsoluteDeviation（可选）
coverageRate
```

`qLow/qHigh` 的具体分位数在首轮数据冻结前为 `null`。原因是选择 10–90%、5–95% 或其他区间是产品容忍度/验证问题，不是现有高位下拉论文给出的事实。

v1 评分分成三层：

1. `availability`：此指标是否有足够真实观测；否则 `unknown`。
2. `phase evidence`：相位顺序、持续时间、停顿、方向是否可评估；只描述观察，不作医疗判断。
3. `corridor comparison`：在同档案下逐相位报告 `within_reference | outside_reference | unknown`，并指出具体特征与相位；不合成为“标准分”或“受伤风险”。

### v2：鲁棒多变量走廊

只有每个档案的**独立人员数大于特征维度所需规模**且留人验证稳定后，才对少量预注册特征做降维和 MCD/MRCD 鲁棒协方差。不要对 `32 nodes × many features` 的原始高维数组直接估协方差；小样本必然奇异或不稳定。v2 仍需保留逐特征分位带，保证可审计。

### 档案版本与可追溯性

每次发布应保存：

- 原始 reference sample ID 列表及内容哈希；
- 两名审核者、分歧和裁决记录（可用去标识化 ID）；
- 采集设备、相机参数/位置、器械、握法、负重协议、座椅设置；
- pose 模型文件哈希与版本、特征代码版本、坐标系；
- 纳入/排除规则、分位数定义和冻结日期；
- 人员级训练/验证/测试切分；
- `evidenceStatus` 与来源链接。

## 单目不可可靠判断的指标

以下在 v1 必须 `unknown` 或明确标成实验字段：

- 肩胛骨真实三维上/下旋、前/后倾、内/外旋和肩胛后缩/下沉；MediaPipe 没有肩胛解剖标志点。`unavailable`。
- 盂肱关节内外旋、肱骨头平移、肩峰下间隙、关节力矩、肌力与肌肉激活。`unavailable`。
- 正后机位的躯干前后倾与手柄相对胸部的纵深距离。`inferred` from projection geometry。
- 遮挡时的真实腕/肘位置；模型给出的低 visibility 坐标不是可审计真值。`evidence_backed` for visibility semantics。
- 负重、钢索张力、座椅/大腿垫接触力、主动/被动肩胛控制。`unavailable` without extra sensors/metadata。
- 任何医疗诊断、疼痛来源或损伤风险。超出范围。

## 验证实验

以下样本量是本项目的**预注册工程假设**，不是文献证明的通用充分样本量。

### 实验 0：可观测性与机位等价性（先做）

- 单一变量：机位；动作、器械、握法、负重、座椅设置和同一次 rep 不变。
- 采集：同步 `rear + rearLeft45 + rearRight45`，最好另加一套标记式/经验证多相机 3D 作为子样本真值。
- 起步规模：1 个动作、1 个变式、1 种器械；12–15 人 × 2 次会话 × 每次 5–8 个审核可接受 rep = 120–240 个独立人体 rep（每个 rep 同步产生 3 个机位视频）。
- 审核：两名有资质且经过同一 rubric 培训的专业人员独立判断；分歧由第三人或共识会议裁决。记录通过/拒绝/unknown，不强迫二元结论。
- 成功信号：核心点覆盖率、事件定位一致性、同机位复测误差和镜像变换后的左右 45°误差均达到**采集前预注册**的标准。
- 失败信号：底部系统性遮挡、左右 45°不可通过镜像校准、同人跨会话漂移接近或大于人与人差异。
- 后续数据：每点人工可见标注、相机参数、真实时间戳、3D/标记真值子集、审核分歧原因。

### 实验 1：首个探索走廊

- 固定一个通过实验 0 的机位、一个器械几何和一个握法；不要同时扩展所有变式。
- 12–15 人数据只可发布 `exploratory` 档案；人员级 bootstrap 检查中位曲线和候选分位带的稳定性。
- 将 participant 完整留出，不允许同一人的 rep 同时进入拟合和验证。
- 专门采集未批准但可清楚观察的对照片段（刻意停顿、躯干摆动、不同 ROM、单侧不同步），只作 challenge set，不进入 reference。

### 实验 2：泛化声明前

- 在没有基于目标误差率/覆盖率的正式功效或精度计算前，保守工程前验为每个最终档案 50–100 名独立参与者、每人两次会话、每次至少 5 个审核可接受 rep；覆盖预先定义的性别、身高/臂展、训练经验区间。
- 至少 2–3 个场地/器械实例；如果机器几何不同，应先视为不同 equipment 桶，再检验是否可合并。
- 必须做 participant-held-out 和 site/equipment-held-out 验证，并报告 `unknown` 率，而不仅是对已成功追踪帧的误差。
- 上述规模只能支持**被实际覆盖的人群、器械、变式与机位**的有限泛化声明；不能外推到儿童、临床人群、未采集的握法或任意机器。

## 当前最小发布档案

建议第一张档案只做：

```text
lat_pulldown
variation: front_bar__pronated__one_biacromial_or_protocol_defined
equipment: one explicitly identified cable/machine geometry
trainingSide: bilateral
capturePosition: rear（若实验 0 证明底部覆盖可接受；否则选覆盖率更好的一个 45°）
coordinateSystem: source-image/v1
features: wristRelativeToShoulder.xy, elbowAngle2d,
          upperArmToTorso2d, torsoLateralShift, bilateral event lag
```

它不包含肩胛、肩关节旋转、肌肉激活、力矩、损伤风险，也不包含任何未经 reference 队列估计与冻结的数值阈值。

## 开源方法的合法角色

| 方法 | 可以做什么 | 不能做什么 | 许可证/风险 |
| --- | --- | --- | --- |
| MediaPipe Pose Landmarker | 端侧关键点观测、visibility、时间序列输入 | 不提供动作标准、遮挡真值或医学判断 | 官方仓库 Apache-2.0；模型/包仍应逐版本留档。[官方仓库](https://github.com/google-ai-edge/mediapipe) |
| MediaPipe landmark smoothing / 1€ filter | 对连续真实点降抖 | 不得补造缺失肢体或证明动作合理 | MediaPipe Apache-2.0；1€ 具体实现需核对对应仓库许可证，论文只说明算法 |
| AIFit segmentation | 借鉴基于 3D pose 的 rep 切分与角度特征思路 | 其 trainer signature 不能直接作为高位下拉标准 | Fit3D 数据为非商业科研许可；商业用途需联系 IMAR。[官方条款](https://fit3d.imar.ro/legal) |
| RepNet | 周期/次数候选 | 没有姿势正确性语义，不提供 start-bottom-end 专业真值 | Google Research 代码 Apache-2.0；权重/下载资产发布时另做清单。[官方代码](https://github.com/google-research/google-research/tree/master/repnet) |
| DTW | 受限的离线相似性/对齐实验 | 不得用无限时间扭曲掩盖停顿、借力、顺序错误，也不产生标准 | 算法本身来自论文；具体库许可证逐一审计 |
| MCD/MRCD | 样本足够时估计鲁棒位置/散布 | 不决定哪些 rep 有资格进入 reference | 方法论；实现许可证逐一审计 |

## 最终问题的直接回答

1. **是否存在可直接使用的高位下拉标准三维轨迹数据？** 目前未找到。最接近的原始论文是多人高位下拉运动学/肌电研究，但没有公开、专家标注、多变式且商业可用的逐帧 3D reference corridor。Fit3D、FLAG3D、MM-Fit 和 FLEX 也不能填这个缺口：它们要么不含高位下拉机器动作，要么是观察/识别数据、研究用途受限，或没有“可接受走廊”标签。尤其 FLEX 虽有 38 人、20 个负重动作、五机位、3D pose 和专业标注，但官方说明 20 个动作只使用杠铃/哑铃，数据仅限学术用途，不能当作高位下拉商业 reference。[FLEX 官方项目页](https://haoyin116.github.io/FLEX_Dataset/)；[FLEX 官方访问条款](https://github.com/HaoYin116/FLEX_AQA_Dataset)
2. **论文能约束什么？** 能约束动作涉及肩带/肩/肘、多关节方向、器械/握法必须分层、某些实验条件和观测到的器械差异。**必须自行建立什么？** 所有角度/位移/速度/同步/后仰的可接受数值走廊、机位投影校准、visibility 门槛和专家纳入规则。
3. **最小可行模型是什么？** 同档案分桶 + 人工 `start/bottom/end` + pull/return 分段线性归一化 + 身体尺度归一化的 2D 多关节特征 + 逐节点 median/quantile + 指标级 visibility/confidence/unknown；暂不使用无界 DTW或高维深度模型。
4. **多少数据能开始/能泛化？** 可观测性探索可从 1 动作、1 变式、1 器械、3 个同步后方机位、12–15 人、2 会话、每会话 5–8 个审核合格 rep 开始。有限泛化声明前，在没有正式功效/精度计算时，保守工程前验是每个最终档案 50–100 人、两会话、每会话至少 5 个合格 rep，并做跨人和跨场地/器械留出。两个数字均为待验证的工程假设。
5. **哪些方案只可用于处理而非标准？** MediaPipe/BlazePose、其平滑器、1€ filter、RepNet、AIFit 的分段模块、DTW、MCD/MRCD 都只提供观测、平滑、分段、对齐或统计工具；它们都不自动提供高位下拉标准姿势。
6. **下一步最值得采什么？** 同一 rep 的 `rear + rearLeft45 + rearRight45` 同步视频、完整 metadata、人工逐 rep 三事件边界、两名专业审核者的独立可接受/拒绝/unknown 判断，以及一小部分同步标记式 3D 真值。先证明“看得见、量得准、机位能否转换”，再扩大人群或训练模型。
