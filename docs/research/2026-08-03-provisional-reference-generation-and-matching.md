# 高位下拉 provisional reference 生成与轨迹匹配：一手证据审计

日期：2026-08-03
范围：研究“生物力学约束 + 单个训练者已分段骨架数据”能否生成高位下拉临时参考走廊，以及用户轨迹如何做缺失感知匹配。本文不训练模型、不修改识别算法、不把单人录像定义为标准动作，也不输出医疗或损伤风险。

## 结论先行

1. **[evidence_backed] 单个训练者的许多 rep 不是许多独立人员。**它们可以估计该训练者在已采集 `variation + equipment + capturePosition + session protocol` 下的中心轨迹和重复性；不能估计人群可接受范围、跨身材/器械/握法泛化或“正确动作”的自然变异。把同一人的 rep 当作人群样本属于独立单位不足/伪重复问题。[Hurlbert, 1984, DOI 10.2307/1942661](https://doi.org/10.2307/1942661)
2. **[inferred] 可以发布 `provisional_single_subject` 档案，但不能命名为 population standard/reference corridor。**若只有一次会话，它只描述 session 内重复性；有多个日期的会话后才可估计该人的跨会话复测差异。它最合理的用途是流程验证、同人历史比较和采集/机位压力测试。
3. **[evidence_backed] `start → bottom → end` 的 landmark registration 能把相位变异和幅值变异分开；但任何时间配准都会改变时间轴。**v1 应只在 `start→bottom` 与 `bottom→end` 内做分段线性重采样，并保留真实时长、底部停顿和速度。DTW 原论文正是时间扭曲算法，并提出 slope constraints 以限制 warping；无限制 DTW 会使“形状相似”与“执行时序合理”混为一谈。[Ramsay & Li, 1998, DOI 10.1111/1467-9868.00129](https://doi.org/10.1111/1467-9868.00129)；[Sakoe & Chiba, 1978, DOI 10.1109/TASSP.1978.1163055](https://doi.org/10.1109/TASSP.1978.1163055)
4. **[inferred] 单人 v1 的首选走廊是逐机位、逐相位、逐特征的 `median + empirical quantiles + nObserved`。**MAD 可作鲁棒尺度，但 MAD 为 0 或样本少时不得强造 z-score。functional depth 适合给完整 rep 做“中心到外围”的描述性排序；其 50% central region 不是自动具备 50% 未来覆盖保证。鲁棒协方差只适合低维 phase summaries；直接对“节点 × 特征”的高维向量做 MCD 会在小样本下不可识别/不稳定。[Sun & Genton, 2011, DOI 10.1198/jcgs.2011.09224](https://doi.org/10.1198/jcgs.2011.09224)；[Rousseeuw & Van Driessen, 1999, DOI 10.1080/00401706.1999.10485670](https://doi.org/10.1080/00401706.1999.10485670)
5. **[evidence_backed] MediaPipe 的 landmark、visibility/presence 与内置平滑只是观测层输出。**官方 Pose Landmarker 输出图像坐标和估计的 world coordinates；legacy 文档把 visibility 定义为点可见（在画面内且未遮挡）的可能性，并提供跨帧降抖。它们不是位置误差概率、动作合格概率或标记式 3D 真值。[MediaPipe Pose Landmarker 官方文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)；[官方 Pose 输出定义](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
6. **[inferred] 匹配必须先判断“能否比较”，再计算距离。**身份不匹配返回 `incompatible_profile`；核心点不足返回 `unknown`；部分指标可见返回 `partial` 并同时报告 coverage，不能用较少的可见指标换取更高分。正后、左后 45°和右后 45°只共享特征语义，不共享数值走廊。
7. **[hypothesis] 未校准前，系统应输出 `matchingDistance` 而不是 0–100“动作质量分”。**持续超界可用最短持续时间、双阈值 hysteresis 或 CUSUM 类累积证据减少单帧抖动，但进入/退出阈值、持续时长和特征权重都必须在独立会话与专家标注 challenge set 上校准。[Page, 1954, DOI 10.1093/biomet/41.1-2.100](https://doi.org/10.1093/biomet/41.1-2.100)
8. **[evidence_backed] 合成数据可以扩增成像条件，不能自行创造动作正确性。**域随机化和合成人体论文支持随机化视角、纹理、光照、体型、遮挡与标签几何；OpenSim Moco 可在显式目标、动力学和约束下生成/跟踪运动，但官方论文明确要求用适当实验数据验证每个具体模型、cost 和 constraint。模拟器输出最多是“满足所编码假设”，不是独立专家事实。[Tobin et al., 2017, DOI 10.1109/IROS.2017.8202133](https://doi.org/10.1109/IROS.2017.8202133)；[Dembia et al., 2020, DOI 10.1371/journal.pcbi.1008493](https://doi.org/10.1371/journal.pcbi.1008493)

## 证据状态与对象命名

- `evidence_backed`：一手论文、ISB 标准或官方代码/文档直接支持。
- `inferred`：由一手资料与投影/统计原理合理推导，但没有本项目高位下拉数据直接验证。
- `hypothesis`：需要本项目实验、专家审核或同步真值验证。
- `unavailable`：当前没有可信资料支持，或现有输入原则上不足。

本文件使用四个不同对象，禁止混名：

| 对象 | 含义 | 能否代表标准 |
| --- | --- | --- |
| `observed_trajectory` | 单个训练者实际动作的骨架/特征序列 | 否 |
| `segmentation_ground_truth` | 人工批准的 `start / bottom / end` | 否；只是真实边界 |
| `provisional_single_subject_corridor` | 同一训练者、同一档案条件下的经验中心与重复范围 | 否；只供研究/同人比较 |
| `population_reference_corridor` | 多人、多会话、明确协议、专业审核且外部验证的可接受范围 | 当前不可由单人数据获得 |

## 1. 单个训练者的数据能估计什么

### 能估计

| 量 | 前提 | 状态与限制 |
| --- | --- | --- |
| 同人、同会话中心曲线 | rep 已正确分段；profile 身份完全一致 | **[evidence_backed + inferred]** 中位数是稳健位置摘要；这里只是条件于该会话的经验中心，不是生物力学 optimum。 |
| 同人、同会话 pointwise 离散度 | 每节点有足够真实观测；不插值遮挡点 | **[inferred]** 可用 empirical quantile/MAD 描述观察到的 repeatability；小样本尾部分位数很粗糙。 |
| 同人的阶段时长、停顿、速度分布 | 原始时间戳保留，未被配准覆盖 | **[inferred]** 只能描述该协议/负重下的节奏。 |
| 同人跨会话稳定性 | 至少两个独立日期/重新架机的会话 | **[evidence_backed + inferred]** 重复测量必须保留受试者/会话层级；不能把相关重复测量当独立个体。[Bland & Altman, 1999, DOI 10.1177/096228029900800204](https://doi.org/10.1177/096228029900800204) |
| 同一机位的遮挡/coverage 模式 | 保留逐点 visibility 与人工可见性真值 | **[inferred]** 可以找出 bottom 或远侧肢体的系统性盲区。 |
| 同一训练者后续 rep 与个人 baseline 的偏离 | 未来会话仍符合 profile，阈值由独立会话校准 | **[hypothesis]** 这是个体化 drift/deviation 检测，不是动作正确性判断。 |

### 不能估计

| 声称 | 状态 | 原因 |
| --- | --- | --- |
| 人群正常/可接受分位数 | **unavailable** | 人员数 `nParticipant=1`；增加 rep 不增加人群独立单位。 |
| 任意新用户的正确轨迹 | **unavailable** | 没有身材、经验、性别、活动度和策略之间的变异。 |
| 跨器械/握法/座椅设置的共享走廊 | **evidence_backed（不可共享）** | 高位下拉机器自由度会改变腕垂直位移、肩内收/外展和肘屈伸。[Koyama et al., 2010, DOI 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y) |
| 单人中心就是“最佳”或“安全” | **unavailable** | 观测中心不等于生理 optimum；没有外部 outcome 或专家接受标签。 |
| 自动分段正确即动作正确 | **unavailable** | segmentation 只识别事件时点，不赋予姿势语义。 |
| 肩胛三维姿态、盂肱旋转、关节力矩 | **unavailable** | Pose 33 点缺乏肩胛标志与外力；单目投影/估计 world landmarks 不补足这些测量。 |

**审计要求 [inferred]：**档案必须显式保存 `participantCount=1`、`sessionCount`、`repCount`。UI 文案使用“与该示范者临时基线的相似度”，不得写“标准度”“正确率”或“安全评分”。

## 2. 生物力学约束只能筛选候选，不能自动认证

高位下拉的直接证据提供三类约束：

- **[evidence_backed] 协议/方向约束：**宽握旋前前拉的起点为杆在头顶、肘伸展；pull 期间肩带/肩/肘共同运动，杆向胸骨上部方向下降；return 受控回到肘伸展。双手应距杆中心相等、杆保持水平、躯干保持协议姿势。[Ronai, 2019, DOI 10.1249/FIT.0000000000000469](https://doi.org/10.1249/FIT.0000000000000469)
- **[evidence_backed] 条件依赖约束：**器械自由度会改变腕、肩、肘的运动与速度时序；负重变化会改变脊柱/肩运动的观测 ROM。约束和档案必须携带 equipment/load protocol，不能使用一个全局走廊。[Koyama et al., 2010](https://doi.org/10.1007/s00421-010-1421-y)；[Lorenzetti et al., 2017, DOI 10.3390/jfmk2030033](https://doi.org/10.3390/jfmk2030033)
- **[evidence_backed] 坐标定义约束：**肩、肘、腕的研究级三维角度应声明解剖局部轴和 joint coordinate system；二维图像夹角不能标成 ISB 盂肱角。[ISB shoulder/elbow/wrist recommendation, DOI 10.1016/j.jbiomech.2004.05.042](https://doi.org/10.1016/j.jbiomech.2004.05.042)

### 候选状态机

```text
observed
  → segmentation_approved
  → profile_identity_matched
  → observability_passed
  → protocol_constraint_passed
  → biomechanical_direction_screened
  → provisional_candidate
  → heldout_same_subject_validated
```

每一步保存 `passed | failed | unknown` 与 evidence/provenance：

| 筛选 | 可以自动做什么 | 不得推导什么 | 状态 |
| --- | --- | --- | --- |
| `profile_identity_matched` | 精确比对 variation、equipment、capturePosition、trainingSide、coordinateSystem | 相近名字可共用数值 | **evidence_backed + inferred** |
| `observability_passed` | 检查核心点/时间戳/身体尺度是否真实可用 | 低 visibility 坐标是真实肢体 | **evidence_backed**；MediaPipe visibility 语义见[官方文档](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md) |
| `protocol_constraint_passed` | 检查 A→B→A 顺序、总体方向、回到上端、握法/设备 metadata | 协议通过即动作正确 | **inferred** |
| `biomechanical_direction_screened` | 排除与论文直接矛盾的阶段方向或错误对象 | 从论文均值产生合格阈值 | **evidence_backed for constraint；unavailable for threshold** |
| `provisional_candidate` | 进入单人经验统计池 | 升级为 population reference | **hypothesis**；若没有专业人员审核，只能保留 provisional |

必要条件不是充分条件。例如，“pull 中肘总体屈曲”可排除分段反向样本，却不能证明肩胛、躯干、负重和控制均合理。

## 3. 相位分段归一化：保留停顿、借力和真实节奏

### 推荐的 v1 表示

```text
raw time:      start -------- bottom -------- end
pull local:      0% --------- 100%
return local:                  0% ----------- 100%
```

1. **[evidence_backed + inferred]** `start / bottom / end` 使用已有人工批准边界；自动极值只能产生候选。
2. **[inferred]** `start→bottom`、`bottom→end` 分别做单调线性插值到固定少量节点。固定节点数是部署参数，不是论文阈值。
3. **[evidence_backed]** 另外保存 `pullDurationMs`、`bottomDwellMs`、`returnDurationMs`、原始速度/加速度候选和相位内反向次数。功能数据配准的目的正是分离 phase 与 amplitude；因此这些被配准移除的 phase 信息必须独立保留。[Ramsay & Li, 1998](https://doi.org/10.1111/1467-9868.00129)
4. **[inferred]** bottom 停顿不能通过重复同一端点制造多个归一节点；停顿长度作为真实毫秒特征比较。
5. **[inferred]** 任何跨 `bottom` 的 warping 都禁止，因为它可把 pull 和 return 的局部异常互相匹配。

### DTW 的允许边界

| 使用 | 处理 | 状态 |
| --- | --- | --- |
| v1 在线评分 | 不使用 DTW；只用批准 landmark 的分段线性归一化 | **inferred**，审计最简单 |
| 离线敏感性分析 | 可用窄 Sakoe–Chiba band、固定端点、单调路径、预注册 slope constraint | **evidence_backed**：原始算法明确研究 slope constraint；具体 band 宽度 **hypothesis/null**。[Sakoe & Chiba](https://doi.org/10.1109/TASSP.1978.1163055) |
| 输出审计 | 保存 warp path、累计 warp amount、每点映射和无 warp 基线差异 | **inferred** |
| 合格性来源 | 禁止；DTW 距离只表示在给定代价/约束下的序列相似 | **unavailable** for correctness |

**失败信号 [hypothesis]：**开启受限 DTW 后，刻意长停顿、躯干借力或阶段内反向样本反而更接近 provisional center。出现即关闭 DTW，改用未配准 timing/derivative 特征。

## 4. robust center 与 corridor 的选择

### v1：逐点 median + empirical quantiles

每个 `phase × node × feature` 保存：

```text
nObserved
nSessionsObserved
median
qLow
qHigh
MAD
missingRate
```

- **[evidence_backed]** 中位数/MAD 是稳健位置/尺度思想；Hampel 的原始 influence-curve 论文建立了分析估计量局部鲁棒性的框架，并讨论了中位数/MAD 类稳健估计。[Hampel, 1974, DOI 10.1080/01621459.1974.10482962](https://doi.org/10.1080/01621459.1974.10482962)
- **[inferred]** `qLow/qHigh` 只描述单人经验分布。分位水平在校准前为 `null`；不得把 5–95%、10–90% 或 `median ± k·MAD` 写成文献支持的动作阈值。
- **[inferred]** `MAD=0`、有效 rep 太少或节点只来自一次会话时，robust standardized residual 为 `unknown`，不使用 epsilon 伪造极小方差。
- **[inferred]** pointwise quantiles 不是整条曲线 simultaneous prediction band；“每个点大多在带内”不等于“整条未来 rep 以同一概率在带内”。

### functional depth / functional boxplot

- **[evidence_backed]** band depth 给函数样本建立中心向外排序；functional boxplot 用 deepest curve、50% central region envelope 和非离群 envelope 描述函数样本。[López-Pintado & Romo, 2009, DOI 10.1198/jasa.2009.0108](https://doi.org/10.1198/jasa.2009.0108)；[Sun & Genton, 2011](https://doi.org/10.1198/jcgs.2011.09224)
- **[inferred]** 可把它用于完整、同机位、同特征的 rep 级“典型性”排序，帮助审核中心 rep，而不是替代专家正确性标签。
- **[inferred]** 低 visibility 曲线不能靠插值后参与 depth 排序；缺失模式不同的 rep 应分层或返回不可比较。
- **[unavailable]** functional boxplot 的经验 1.5×规则不是高位下拉可接受阈值，也不自动给未来用户的标称覆盖率。

### robust covariance / multivariate distance

- **[evidence_backed]** MCD/FAST-MCD 是高 breakdown 的 multivariate location/scatter 估计；Mahalanobis 型距离利用协方差结构。[Rousseeuw & Van Driessen, 1999](https://doi.org/10.1080/00401706.1999.10485670)
- **[evidence_backed]** 当维度接近或超过样本量时，普通 MCD 受限；MRCD 通过将子集协方差和 target matrix 凸组合得到良态估计。[Boudt et al., 2020, DOI 10.1007/s11222-019-09869-x](https://doi.org/10.1007/s11222-019-09869-x)
- **[inferred]** 单人 provisional profile 只对预注册的低维 phase summaries 使用，例如 pull ROM、return ROM、duration、最大横移、p90 pointwise excess；不对完整节点向量直接估 covariance。
- **[hypothesis]** 只有 leave-one-session-out 下 covariance/距离排序稳定，才启用 multivariate distance。否则保留逐特征可解释结果。
- **[unavailable]** MCD/MRCD 距离阈值本身不代表动作正确性；阈值必须通过 held-out 专家 challenge set 校准。

## 5. 机位专属特征与 `partial / unknown`

图像角度是三维运动的机位投影；ISB 三维 joint coordinate system 与图像夹角不是同一测量对象。[ISB recommendation](https://doi.org/10.1016/j.jbiomech.2004.05.042) 因此以下特征只与**同机位档案**比较：

| 特征 | 正后 `rear` | 左后 45° `rearLeft45` | 右后 45° `rearRight45` | 状态 |
| --- | --- | --- | --- | --- |
| 双腕相对肩 x/y、杆水平代理 | 优先；bottom 遮挡逐点 unknown | 可用，左侧通常为近侧 | 可用，右侧通常为近侧 | **inferred**；腕位移是直接生物力学变量，但可接受范围 unavailable。[Koyama et al.](https://doi.org/10.1007/s00421-010-1421-y) |
| 2D 肘角 | 双侧投影候选；前臂朝相机时误差增大 | 左侧优先，右侧允许 unknown | 右侧优先，左侧允许 unknown | **inferred**；不能命名为三维 elbow JCS angle |
| 上臂—躯干 2D 角 | 冠状/肩胛面代理较好 | 混合平面 | 混合平面 | **inferred**；只同机位比较 |
| 左右同步/相位差 | 两侧均可见时最佳 | 远侧缺失时 partial | 远侧缺失时 partial | **hypothesis**；允许差值阈值 null |
| 躯干横向偏移 | 最佳代理 | 有透视缩放 | 有透视缩放 | **inferred**；相机 roll 需校准 |
| 躯干后仰 | `unknown` | 图像平面代理，需校准 | 图像平面代理，需校准 | **inferred/unavailable**；正后缺乏深度敏感性 |
| 肩胛三维运动、轴向旋转、力矩 | `unknown` | `unknown` | `unknown` | **unavailable** from current skeleton |

### 指标级可比性

```text
comparable_full     所有核心指标达到校准后的可见/覆盖要求
comparable_partial  至少一个预注册子集可比较，同时报告缺失指标
unknown             没有足够核心证据
incompatible_profile variation/equipment/view/coordinate schema 不匹配
```

- **[evidence_backed]** MediaPipe 输出 33 个近似人体 landmark；visibility 只表示可见/未遮挡可能性。[官方 Pose 文档](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)
- **[evidence_backed + inferred]** 遮挡通常不是随机缺失：bottom、远侧臂和器械遮挡与相位/机位相关。缺失机制会影响推断，不能默认 missing completely at random。[Rubin, 1976, DOI 10.1093/biomet/63.3.581](https://doi.org/10.1093/biomet/63.3.581)
- **[inferred]** 可借鉴 Gower coefficient 的“只对共同可用变量计权”思想做 partial distance，但必须同时输出 coverage 和 missing pattern，且核心指标缺失不能靠重归一化掩盖。[Gower, 1971, DOI 10.2307/2528823](https://doi.org/10.2307/2528823)
- **[inferred]** 平滑只作用于连续真实观测，不跨 `unknown` 段插值。显示层可以画断线；评分层禁止镜像另一侧或使用模型低 visibility 坐标补 limb。

## 6. 可审计 matching distance 与状态输出

### 第一步：身份与可用性门

必须完全匹配：

```text
exerciseId
capturePosition
variation
trainingSide
equipment
coordinateSystem
featureSchemaVersion
poseModelVersion
```

不匹配就停止，不搜索“最像”的其他 profile。每个特征以自身所需 landmark、visibility、timestamp、scale 和 camera support 决定 `observed | unknown`。

### 第二步：逐点 excess

只有当 profile 已冻结描述性 `qLow/qHigh` 和非零 `robustScale` 时，才对已观察的特征 `j`、相位节点 `t` 计算：

```text
inside interval:  excess(j,t) = 0
below qLow:       excess(j,t) = (qLow - x) / robustScale
above qHigh:      excess(j,t) = (x - qHigh) / robustScale
unknown:          excess(j,t) = null
```

- **[inferred]** `robustScale` 优先为可用且非零的 MAD/IQR 派生尺度；尺度不可识别时只报告 raw deviation 与 `scale_unknown`。
- **[inferred]** `qLow/qHigh` 尚未冻结时，只输出 `x - median`、绝对距离和 empirical rank；`outside_candidate=unknown`。不能为了让公式可运行而临时填一个分位水平。
- **[inferred]** 分别计算 pull/return；左右侧分别保留，最后才形成 bilateral summary。
- **[hypothesis]** phase summary 同时保留 `weightedMedianExcess` 和 `p90Excess`：前者不被单点噪声支配，后者不让局部明显偏离被平均掉。权重在校准前为 `null/equal`，不能按主观重要性宣称已验证。
- **[inferred]** timing distance（duration、dwell、反向次数）单独计算，不进入已归一形状曲线。

### 第三步：只在低维稳定时增加协同距离

```text
phaseSummaryVector
  → robust center/scatter
  → robust Mahalanobis-like distance
```

输出必须列出贡献最大的可观察 summary；不得只返回黑箱总分。若 covariance 未通过跨会话稳定性检查，`multivariateDistance=null`。

### 第四步：状态，不先伪造概率

建议 v0 输出：

```text
comparisonStatus
shapeDistanceByPhase
timingDistanceByPhase
constraintResults[]
observedCoverageByFeature
unknownFeatures[]
profileScope = provisional_single_subject
calibrationStatus = uncalibrated | within_subject_calibrated
```

**[hypothesis]** 若产品必须显示 0–100，可定义单调映射，例如 `100 × exp(-a × distance)`；但 `a`、截断和权重在 held-out 校准前必须为 `null`。这个数只是“与 provisional baseline 的匹配分”，不是正确率或风险概率。

## 7. 持续超界、hysteresis 与单帧抖动

单点出界可能来自姿态估计噪声；持续偏离才更像动作事件。但所有时间规则都需要目标误报率校准。

### 两种可审计方案

1. **连续时长规则 [hypothesis]**：在原始时间轴上，`excess > enterThreshold` 持续 `enterDurationMs` 才进入 `outside_candidate`；只有 `excess < exitThreshold` 持续 `exitDurationMs` 才退出，其中 `enterThreshold > exitThreshold`。四个参数初始为 `null`。
2. **CUSUM 类累积证据 [evidence_backed + hypothesis]**：对正 excess 累积，小回落逐步抵消，超过 decision limit 才触发。CUSUM 的顺序累积检测来自 Page；reference excess 的 reference value/decision limit 必须由本项目校准，不照搬工业阈值。[Page, 1954](https://doi.org/10.1093/biomet/41.1-2.100)

### 审计输出

- 触发的原始起止毫秒、相位百分比和特征；
- 每帧 excess、可见状态与状态机转换；
- `enter/exit` 参数版本；
- 若相位内出现 `unknown`，说明计时是暂停、重置还是终止；v1 建议终止该指标的连续性证据，避免跨遮挡拼接；**[hypothesis]**。

不得只在相位归一节点上定义“连续 3 点”等规则，因为不同 rep 的 3 个节点对应不同真实毫秒。

## 8. confidence：观测可信度、匹配证据和正确性概率要分开

| 层 | 含义 | 推荐输出 | 状态 |
| --- | --- | --- | --- |
| `landmarkVisibility` | MediaPipe 的可见/未遮挡评分 | 原值 + model/version | **evidence_backed**，不是坐标准确率 |
| `landmarkErrorConfidence` | 给定机位/相位/遮挡下，坐标误差低于容差的经验概率 | 未校准时 `null` | **hypothesis**，需同步 2D/3D 真值 |
| `segmentationConfidence` | start/bottom/end 边界误差的经验分布 | ms 或 frame interval | **hypothesis**，需人工重复标注 |
| `comparisonEvidence` | 本次匹配有多少核心特征和时间被真实观察 | coverage + missing pattern | **inferred** |
| `referenceStability` | 单人走廊在跨会话 bootstrap/留出中的稳定程度 | curve/quantile drift | **hypothesis** |
| `correctnessProbability` | 动作在专业 rubric 下可接受的概率 | 当前必须 `null` | **unavailable** without labeled calibration population |

现代网络分数通常需要单独校准；人类姿态估计研究也发现常用 keypoint confidence 可能失准。[Guo et al., 2017, PMLR primary paper](https://proceedings.mlr.press/v70/guo17a.html)；[Gu et al., 2024, *On the Calibration of Human Pose Estimation*](https://proceedings.mlr.press/v235/gu24a.html) 因此不能把多个 visibility 相乘或平均后称为“匹配置信度”。

**[hypothesis]** 最小 confidence 校准实验：同步单目与人工 2D/标记式 3D；按 `capturePosition × landmark × phase × occlusionReason` 统计坐标误差/coverage curve；只在独立会话评估。校准方法可以是预注册的 isotonic/temperature scaling，但模型选择本身必须在 held-out 数据验证。[Zadrozny & Elkan, 2002, DOI 10.1145/775047.775151](https://doi.org/10.1145/775047.775151)

## 9. 校准与最小验证实验

### 实验 A：单人 reference stability

- 单一变化：采集会话/日期；动作 variation、设备、负重区间、机位和口令固定。
- 拟合：早期会话建立 provisional center/corridor。
- 测试：完整留出后续会话，禁止随机按 rep 切分。
- 成功信号：center、quantile、unknown rate、phase duration 在预注册容差内稳定。
- 失败信号：跨会话漂移接近或大于 corridor 宽度，或换一次架机即系统偏移。
- **状态：hypothesis。**若只有单会话数据，该实验 `unavailable`，档案只能是 `session_specific_demo`。

### 实验 B：约束筛选与 matching challenge set

- 由专业人员设计并审核一组只改变单一因素的样本：停顿、回程速度、躯干摆动、左右不同步、ROM 缩短、机位/遮挡；不把故意变式用于医疗风险推断。
- 分开报告：segmentation error、shape distance、timing distance、constraint failure、unknown。
- 成功信号：停顿不会被配准消失；遮挡优先变为 unknown；单因素变化主要影响预期指标。
- 失败信号：缺失反而提高总分，或不合理样本因 DTW 更接近中心。
- **状态：hypothesis。**需要至少两名审核者和分歧裁决；单教练既生成 baseline 又独自定测试标签会产生循环验证。

### 实验 C：机位/pose 真值

- 同一次 rep 同步 `rear + rearLeft45 + rearRight45`，子集同步标记式 3D 或经验证多相机重建。
- 测试每个机位的 keypoint error、2D feature error、visibility calibration 和远/近侧遮挡。
- 左右 45°镜像等价只作为可证伪假设；通过前不合并走廊。
- **状态：hypothesis。**OpenSim IK 可作为 marker-to-model 处理工具；其官方 IK 是逐帧加权最小二乘“最佳匹配”，不是正确动作判别器。[OpenSim IK 官方文档](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim33/pages/53674149)

### 实验 D：阈值与 coverage 校准

- 校准单位至少是 session block；如果以后加入多人，则按 participant 完整留出。
- 对每个候选阈值报告 false alert、miss、unknown、partial coverage、触发延迟和 subgroup/view 分层结果。
- split conformal 可在满足 exchangeability 的校准样本上构造有限样本边际覆盖，但同人连续 reps 的依赖使“随机 rep conformal”保证不成立；先按 session block 设计并把保证范围写清。[Lei et al., 2018, DOI 10.1080/01621459.2017.1307116](https://doi.org/10.1080/01621459.2017.1307116)
- **状态：evidence_backed for conformal assumptions；hypothesis for this application。**单人校准最多支持同人条件下的经验性能，不支持新人群。

## 10. 合成数据的合法作用边界

### 可以扩增/压力测试

| 因素 | 用途 | 状态 |
| --- | --- | --- |
| 相机 yaw/pitch/roll、距离、焦距、裁切 | 测试 feature 对机位误差的敏感性 | **evidence_backed + inferred**；domain randomization 支持随机渲染因素。[Tobin et al.](https://doi.org/10.1109/IROS.2017.8202133) |
| 光照、背景、衣物/肤色纹理 | pose 观测压力测试 | **evidence_backed**；SURREAL 随机视角、服装、光照并提供 pose/depth/segmentation GT。[Varol et al., 2017, CVPR primary paper](https://openaccess.thecvf.com/content_cvpr_2017/papers/Varol_Learning_From_Synthetic_CVPR_2017_paper.pdf) |
| 运动模糊、压缩、rolling shutter | 移动端视频压力测试 | **inferred**；扰动分布必须由目标设备真实视频拟合，不能假设合成分布代表产品环境 |
| 体型/肢段长度 | 测试身体尺度归一化与投影 | **evidence_backed + inferred**；仍需真人验证 |
| landmark jitter、dropout、self/equipment occlusion mask | 验证 unknown、partial、hysteresis 不会崩溃 | **inferred**；噪声分布需由真实误差拟合 |
| 时间伸缩、已知停顿、阶段内反向 | 单元测试 timing features 与 DTW 失败模式 | **inferred**；不得作为真实动作分布 |
| OpenSim/Moco 参数、目标、约束敏感性 | 研究“若假设 X 改变，模拟如何变化” | **evidence_backed** for tool capability；必须实验验证。[OpenSim Moco](https://doi.org/10.1371/journal.pcbi.1008493) |

### 不能提供

- **[unavailable]** 新的专家“正确/可接受”标签；渲染和运动都继承源轨迹/目标函数的语义。
- **[unavailable]** 人群自然协同、疲劳、训练经验或疼痛相关变异，除非这些机制已经被真实数据验证并明确建模。
- **[unavailable]** MediaPipe 在真实器械遮挡、服装和移动端相机上的真实误差分布；必须 real-world held-out test。
- **[evidence_backed]** OpenSim/Moco 的最优解只对指定 model、cost、constraint 与数值求解成立；Moco 原论文明确说其验证不保证用户自己的应用产生有意义结果，需与适当实验数据比较。[Dembia et al.](https://doi.org/10.1371/journal.pcbi.1008493)
- **[evidence_backed]** 用于拟合/校准的同一数据不能再充当独立验证证据。[Hicks et al., 2015, DOI 10.1115/1.4029304](https://doi.org/10.1115/1.4029304)

## 11. 推荐的 provisional profile 最小合同

```text
profileStatus = provisional_single_subject | session_specific_demo
participantCount = 1
sessionCount
repCount
exerciseId
capturePosition
variation
trainingSide
equipment
coordinateSystem
poseModelVersion
featureSchemaVersion
segmentationSource
biomechanicalConstraintVersion
corridorMethod
calibrationStatus
prohibitedClaim = population_standard | correctness_probability | injury_risk
```

每项 feature/node 保存：

```text
value | null
observationState = observed | unknown | not_applicable
unknownReason
visibilityRaw
calibratedLandmarkConfidence | null
nObserved
nSessionsObserved
median | null
qLow | null
qHigh | null
MAD | null
evidenceStatus
provenance[]
```

## 12. 当前应做与不应做

### 可以立即做

1. **[inferred]** 冻结一个 front/wide-pronated、固定器械和固定后方机位的 profile identity。
2. **[inferred]** 对已分段单人数据做分相位线性重采样，同时保留真实 timing。
3. **[inferred]** 生成逐点 median、MAD、经验分布/排序统计，但明确标 `provisional_single_subject`；`qLow/qHigh` 的分位水平与报警阈值保持 `null`，直到分析协议冻结并完成留出校准。
4. **[inferred]** 实现指标级 observed/partial/unknown 审计表和 view-specific feature coverage 报告。
5. **[hypothesis]** 用后续独立会话和专业 challenge set 校准 matchingDistance、持续超界和 confidence。

### 当前禁止

1. **[unavailable]** 把单人范围称为标准动作、人群可接受范围或正确率。
2. **[unavailable]** 用论文 ROM 均值、MediaPipe 默认 confidence 0.5、functional boxplot 1.5×规则或任意 `k·MAD` 直接生成产品阈值。
3. **[inferred]** 用无限制 DTW、遮挡插值或远侧镜像填补来提高相似度。
4. **[unavailable]** 把 MediaPipe world landmarks、OpenSim IK/Moco 或合成数据当独立生物力学正确性 oracle。
5. **[unavailable]** 输出医疗、疼痛来源或损伤风险判断。

## 一手资料索引

- [Hurlbert (1984), *Pseudoreplication and the Design of Ecological Field Experiments*, DOI 10.2307/1942661](https://doi.org/10.2307/1942661)
- [Bland & Altman (1999), *Measuring agreement in method comparison studies*（含 repeated measurements 扩展）, DOI 10.1177/096228029900800204](https://doi.org/10.1177/096228029900800204)
- [Ramsay & Li (1998), *Curve Registration*, DOI 10.1111/1467-9868.00129](https://doi.org/10.1111/1467-9868.00129)
- [Sakoe & Chiba (1978), *Dynamic Programming Algorithm Optimization for Spoken Word Recognition*, DOI 10.1109/TASSP.1978.1163055](https://doi.org/10.1109/TASSP.1978.1163055)
- [López-Pintado & Romo (2009), *On the Concept of Depth for Functional Data*, DOI 10.1198/jasa.2009.0108](https://doi.org/10.1198/jasa.2009.0108)
- [Sun & Genton (2011), *Functional Boxplots*, DOI 10.1198/jcgs.2011.09224](https://doi.org/10.1198/jcgs.2011.09224)
- [Hampel (1974), *The Influence Curve and its Role in Robust Estimation*, DOI 10.1080/01621459.1974.10482962](https://doi.org/10.1080/01621459.1974.10482962)
- [Rousseeuw & Van Driessen (1999), *A Fast Algorithm for the Minimum Covariance Determinant Estimator*, DOI 10.1080/00401706.1999.10485670](https://doi.org/10.1080/00401706.1999.10485670)
- [Boudt et al. (2020), *The Minimum Regularized Covariance Determinant Estimator*, DOI 10.1007/s11222-019-09869-x](https://doi.org/10.1007/s11222-019-09869-x)
- [Gower (1971), *A General Coefficient of Similarity and Some of Its Properties*, DOI 10.2307/2528823](https://doi.org/10.2307/2528823)
- [Rubin (1976), *Inference and Missing Data*, DOI 10.1093/biomet/63.3.581](https://doi.org/10.1093/biomet/63.3.581)
- [Page (1954), *Continuous Inspection Schemes*, DOI 10.1093/biomet/41.1-2.100](https://doi.org/10.1093/biomet/41.1-2.100)
- [Lei et al. (2018), *Distribution-Free Predictive Inference for Regression*, DOI 10.1080/01621459.2017.1307116](https://doi.org/10.1080/01621459.2017.1307116)
- [Wu et al. (2005), ISB shoulder/elbow/wrist joint coordinate recommendation, DOI 10.1016/j.jbiomech.2004.05.042](https://doi.org/10.1016/j.jbiomech.2004.05.042)
- [Ronai (2019), *The Lat Pulldown*, DOI 10.1249/FIT.0000000000000469](https://doi.org/10.1249/FIT.0000000000000469)
- [Koyama et al. (2010), lat-pulldown machine kinematics, DOI 10.1007/s00421-010-1421-y](https://doi.org/10.1007/s00421-010-1421-y)
- [Lorenzetti et al. (2017), pulling-exercise 3D kinematics, DOI 10.3390/jfmk2030033](https://doi.org/10.3390/jfmk2030033)
- [MediaPipe Pose Landmarker official guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker), [official Pose output/configuration](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md), [BlazePose GHUM 3D model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf)
- [OpenSim official inverse-kinematics documentation](https://opensimconfluence.atlassian.net/wiki/spaces/OpenSim33/pages/53674149)
- [Dembia et al. (2020), *OpenSim Moco*, DOI 10.1371/journal.pcbi.1008493](https://doi.org/10.1371/journal.pcbi.1008493)
- [Hicks et al. (2015), musculoskeletal-model verification and validation, DOI 10.1115/1.4029304](https://doi.org/10.1115/1.4029304)
- [Tobin et al. (2017), domain randomization, DOI 10.1109/IROS.2017.8202133](https://doi.org/10.1109/IROS.2017.8202133)
- [Varol et al. (2017), *Learning from Synthetic Humans*](https://openaccess.thecvf.com/content_cvpr_2017/papers/Varol_Learning_From_Synthetic_CVPR_2017_paper.pdf)
- [Guo et al. (2017), *On Calibration of Modern Neural Networks*](https://proceedings.mlr.press/v70/guo17a.html)
- [Gu et al. (2024), *On the Calibration of Human Pose Estimation*](https://proceedings.mlr.press/v235/gu24a.html)
- [Zadrozny & Elkan (2002), score calibration, DOI 10.1145/775047.775151](https://doi.org/10.1145/775047.775151)
