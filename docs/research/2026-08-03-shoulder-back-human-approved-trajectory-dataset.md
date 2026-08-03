# 肩部与背部：人工审批驱动的轨迹数据集扩展方案

日期：2026-08-03  
范围：本机 `form-coach` 采集包、当前审批/轨迹样本 schema，以及将肩部和背部录像安全纳入后续轨迹识别训练的最小流程。本文是研究说明，不修改应用行为。

## 结论

**可行，但“标动作和次数”必须再加一层逐次边界确认，才可进入训练库。**

推荐的顺序是：

1. 导入一组完整的录像、关键点、metadata；
2. 运动员先确认动作、实体机位、训练侧和**实际次数**；
3. 把系统、历史标签和自动周期提供的分段都只当作候选，逐个确认或修正 `start → 动作相位点 → end`；
4. 以此次人工审批时的原始 pose、模型版本、机位和固定长度轨迹冻结为一个不可变样本；
5. 质量合格的样本进入该动作/机位/侧别的小型轨迹库；其余保留为“隔离样本”，用于改进采集或候选算法，**不训练**。

这比直接用当前计数或已有 `.labels.json` 训练安全得多：目前专项计数仍由单一相位信号分段，历史标签只是录制期生成的候选边界，尚没有运动员确认的全局实际次数。现有审批台已经要求选择候选并逐 rep 编辑边界，且高位下拉会在审批时冻结样本；应把同一审批合同泛化到肩部与其他背部动作，而不是为每个动作单独做一次“自动真值”。[当前审批实现](../../src/components/CaptureApprovalPanel.web.tsx)；[当前高位下拉样本 schema](../../src/pose/trajectoryDataset.ts)；[现有计数诊断](2026-08-03-rep-counting-trajectory-diagnosis.md)。

## 现有一手数据：可用什么，不能声称什么

以下盘点来自仓库内的 `public/field-captures` JSON，而非算法推断。

| 肌群 / 动作 | 有 metadata 的录制组 | 已有边界 labels | 其中 rep 边界数 | 机位事实 | 进入训练前还缺什么 |
| --- | ---: | ---: | ---: | --- | --- |
| 背 / 高位下拉 | — | 3 | 22 | `front` | 人工实际次数与逐次审批；首个正式轨迹库目标 |
| 背 / 杠铃划船 | — | 7 | 59 | `front`、`oblique45` | 同一动作按实体机位拆分审批；不能混合左右镜像 |
| 背 / 引体向上 | — | 2 | 19 | `front` | 实际次数与进入/离开杆的排除标记 |
| 背 / 坐姿划船 | — | 2 | 19 | `front`、`oblique45` | 不同机位分开建库 |
| 背 / 直臂下压 | — | 3 | 24 | `side`、`oblique45` | 不同机位分开建库；明确端点语义 |
| 肩 / 坐姿推肩 | 6 | 6 | 37 | 所录为 `front`；推荐机位是 `frontLeft45` | 实际次数与逐次审批；新增机位前不可把正面样本当 45°样本 |
| 肩 / 侧平举 | 7 | 7 | 56 | `front` | 实际次数与逐次审批 |
| 肩 / 后束飞鸟 | 4 | 0 | 0 | `front`、`rearLeft45` | 首次人工动作/次数/边界标注 |
| 肩 / 单臂绳索侧平举 | 4 | 0 | 0 | `frontLeft45` | 首次标注，且必须填 `trainingSide` |

“—”表示这轮盘点以 labels 目录为单位统计，不能由 labels 文件本身可靠反推对应 metadata 是否齐全；新样本的导入门必须实际校验同名视频、关键点与 metadata 三件套。

当前肩部 `.metadata.json` 已包含 `exerciseId`、`muscleGroup`、`trainingSide`、`cameraView`、精确的 `capturePosition`、profile 版本和 MediaPipe 模型；这是一条很好的可追溯起点。例如，[坐姿推肩 metadata](../../public/field-captures/shoulders/field-capture-2026-08-03T07-57-28-214Z.metadata.json) 写明 `seated_shoulder_press / front / mediapipe heavy`。相应 `.labels.json` 已有每次的 `startMs`、`extremeMs`、`endMs`，但其动作质量字段是 `unjudgeable`，并没有“运动员已确认整组实际次数”的证据；因此它们应显示为**建议边界**，而不是训练标签。[同组 labels](../../public/field-captures/shoulders/field-capture-2026-08-03T07-57-28-214Z.labels.json)。

## 人工标注合同：先让人决定什么

### 每一组必须确认的字段

| 字段 | 为什么不能由当前自动结果替代 | 校验规则 |
| --- | --- | --- |
| `exerciseId` | 拉、推、飞鸟有不同的相位与可比较轨迹 | 必填，来自注册表；一次审批只允许一个动作 |
| `actualCount` | 这是监督目标；候选算法可能多计、漏计 | 正整数，必须等于批准的 rep 数 |
| `capturePosition` | `front` / `oblique45` 是粗粒度分析视角，无法保留左、右、前后 45°差异 | 必填；仅同一实体机位或显式规范化的分桶可比较 |
| `trainingSide` | 单臂动作左右侧的骨架轨迹不可直接混用 | 单臂动作必填 `left` 或 `right`；双侧动作为 `bilateral` |
| `startMs`、`phaseEventMs`、`endMs`（每 rep） | 单一极值会把停顿、回弹和入镜动作误作重复 | 时间单调、在 keypoint 时间范围内、不得重叠；总数必须等于 `actualCount` |
| `annotationStatus` 与原因 | “看不清”不是“动作错误”，也不能成为训练正例 | `approved` / `quarantined` / `needs-recapture` 三态；隔离理由必填 |

现有 `extremeMs` 的名字不够动作中立：对高位下拉可解释为向心末端，对坐姿推肩则是顶部，对侧平举是抬起顶点。新通用 schema 应叫 `phaseEventMs`，并额外保存 `phaseEvent`（如 `concentric_end` 或 `top`）；读旧数据时可把 `extremeMs` 映射进去，但不要丢失原字段。这让数据集明确记录标注者“在标哪个相位”，而不是让训练代码猜极值方向。

### 各动作的可审批相位约定

| 首批动作 | `start` | `phaseEvent` | `end` | 额外必填 / 隔离条件 |
| --- | --- | --- | --- | --- |
| 高位下拉 | 手臂伸展、下一次下拉前稳定点 | 拉杆至下方的向心末端 | 回到稳定伸展点 | 双腕、双肘、双肩、双髋可见；入镜/调整座椅不入 rep |
| 坐姿划船、杠铃划船 | 手臂/把手远端稳定点 | 拉至躯干最近点 | 回到远端稳定点 | 器械或躯干遮挡关键臂段则隔离 |
| 引体向上 | 底部悬垂稳定点 | 顶部稳定点 | 返回底部稳定点 | 上杆、下杆、摆动未衰减部分不入 rep |
| 直臂下压 | 绳索/杆高位稳定点 | 低位向心末端 | 回到高位稳定点 | 肘部是否保持近伸展仅作为质量标签，不决定次数真值 |
| 坐姿推肩 | 肩旁/底部稳定点 | 过顶顶部稳定点 | 回到肩旁稳定点 | 以本次实际使用的器械版本作 `variation`；当前正面采集应单独分桶 |
| 侧平举 | 双臂自然下垂稳定点 | 最高抬臂点 | 回到下垂稳定点 | 双腕与肩应在峰值可见；耸肩/摆动另记质量标签，不能改变人类次数 |
| 后束飞鸟 | 手臂前方或合拢的稳定点 | 双臂后展最大点 | 回到起点 | 必须保留 `front` 与 `rearLeft45` 两个实体机位桶 |
| 单臂绳索侧平举 | 动作侧手臂低位稳定点 | 动作侧最高点 | 回到低位稳定点 | `trainingSide`、负重侧与绳索侧必填；左、右不混库 |

这是一份操作合同，不是医学“正确姿势”的裁决。人类审批的首要任务是可靠地给出**次数和时间边界**；质量标签应与它分开，避免把“幅度较小”误删成零次训练。

## 通用轨迹样本的最小 schema

当前高位下拉 v1 已正确采用：每次固定重采样 32 帧、躯干尺度归一化、保存来源模型和 `source-image/v1` 坐标系、检查峰值、覆盖率和连续缺失帧。[实现](../../src/pose/trajectoryDataset.ts)。扩展时应保留该原则，把“高位下拉专用 feature 列”变成按动作版本化的 `featureSchemaId`：

```text
trajectory-dataset/v2
  sampleId, schemaVersion, approvedAt, annotationRevision
  source:
    captureId, videoId, keypointsFile, model, profileVersion
    capturePosition, cameraView, coordinateSystem: "source-image/v1"
  exercise:
    exerciseId, variation, movementPattern, trainingSide
  annotation:
    actualCount, status, annotator: "local-athlete"
    reps: [{ repIndex, startMs, phaseEventMs, phaseEvent, endMs }]
  trajectories:
    featureSchemaId, framesPerRep: 32
    reps: [{ featureCoverage, peakFeatureAvailable, maxMissingFrameSpan, frames }]
  quality:
    eligibleForTraining, quarantinedReasons[]
```

具体要求：

- 原始 image 坐标一律不做 UI 镜像再保存；如果日后需要左右归一化，生成一个**派生**样本并记录 `transform`，保留原件。现有 8 机位表已经说明精确实体机位不能只折叠成 `CameraView`。[机位定义](../../src/pose/viewGating.ts)。
- 不把 `frontLeft45` 与 `frontRight45`、`left` 与 `right`、`rearLeft45` 与正面数据直接混合。它们可在验证证实镜像/坐标变换合理后，作为明确版本的派生集合合并。
- 训练和渲染继续从同一 canonical pose 帧生成；不得以视频重解码、截图或 UI 覆盖层重建一份不同的训练输入。这个约束能让用户审批的视频与模型学习的轨迹一一对应。
- `featureSchemaId` 至少包含动作、机位桶和特征版本，例如 `seated_shoulder_press/front/v1`。特征改变（肘角改为腕高，或添加躯干倾斜）必须升版本，旧样本不能静默拼接。

MediaPipe 的视频接口要求给每个视频帧提供毫秒时间戳，且相邻时间戳单调递增；该约束支持将人类标出的毫秒边界可靠地投射到保存的 pose 序列。[MediaPipe Pose Landmarker Web 指南](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js)；[官方 API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.poselandmarker)。其 `visibility` 代表关键点可见/遮挡或出画的分数，并不等价于“这个 rep 正确”，因此可见性只能用于质量隔离，不能替代人工次数。[Landmark 官方定义](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/components/containers/Landmark)。

## 质量门与训练顺序

### 放行门（每条都通过才是训练正例）

1. **包完整**：同名视频、pose JSON、metadata 均存在；pose 时间严格递增；模型与 feature schema 可识别。
2. **人工真值完整**：动作、实体机位、实际次数、训练侧（如适用）均已确认；批准 rep 数等于实际次数。
3. **边界有效**：每次 `start ≤ phaseEvent ≤ end`，不越过录像范围、不与下一次重叠；首尾的走入、调器械、上杆/下杆明确排除。
4. **轨迹可用**：固定长度重采样时，每个关键 rep 达到覆盖率门槛、峰值有真实关键点、没有长时间缺帧；不能用相距很远的最近帧伪造完整轨迹。
5. **分桶正确**：同一个训练原型只使用相同 `exerciseId + variation + capturePosition + trainingSide + featureSchemaId` 的批准样本。

任一失败应产生可导出的隔离记录而非丢弃视频。隔离数据很有价值：它可以回答“是标注错、遮挡、模型丢点、机位不适合，还是算法分段错误”，但绝不能被混入正例。

### 建议的增量路径

1. **先完成高位下拉闭环**：把目前审批后的样本积累到足够覆盖正常、慢速、底部停顿、轻摆动和入镜场景；离线比较人工次数与规则候选。不要用目前 3 组/22 个历史边界宣称准确率。
2. **肩部第一批只开两个桶**：`seated_shoulder_press/front/v1` 和 `lateral_raise/front/v1`。现有 13 组 / 93 个历史边界可作为审批起点，全部重新确认 `actualCount` 后才产出正例。
3. **再开未标注肩部动作**：后束飞鸟和单臂绳索侧平举先走完整人工首标；单臂动作先只训练一个侧别，另一个侧别独立留出验证，不做“自动镜像泛化”假设。
4. **背部按动作、机位独立扩展**：高位下拉之后，优先坐姿划船/直臂下压；杠铃划船和引体向上有更强的身体位移与遮挡风险，应保留更多“待确认”而不是强行计数。
5. **先训练候选拒绝器，不先训练端到端计数网络**：利用固定重采样多关节轨迹建立同桶的中位原型/相似度范围，只把异常候选标成“待人工确认”。达到足够人工集之后，才评估轻量时序模型是否优于该可解释基线。

研究文献同样支持先解决“整段上下文和周期一致性”，而非把每个局部弯曲阈值当次数：RepNet 将 temporal self-similarity 用作周期预测的中间表示，[Dwibedi et al., CVPR 2020](https://openaccess.thecvf.com/content_CVPR_2020/html/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.html)；另一项 CVPR 工作指出短片段不足以决定变速重复的周期，需要上下文。[Zhang et al., CVPR 2020](https://openaccess.thecvf.com/content_CVPR_2020/html/Zhang_Context-Aware_and_Scale-Insensitive_Temporal_Repetition_Counting_CVPR_2020_paper.html)。这些结论支持“人工边界 + 同桶轨迹一致性”的数据工程路线，但不构成当前小数据集直接微调深度视频模型的依据。

## 最小可验证实验与验收

每次只改变一个变量。例如：固定 `seated_shoulder_press/front/v1`、固定模型和特征 schema，先审批 6 组既有视频；然后只比较“单信号候选”与“人工确认边界 + 原型拒绝”的每组误差。记录：

- `actualCount` 与各候选 count 的绝对误差；
- 每个自动候选的接受、待确认、拒绝结果及原因；
- 质量隔离率和隔离原因分布；
- 首次审批和复审的一致率（同一录像二次查看是否得到相同边界/次数）。

成功信号不是“所有视频自动计数”，而是：已放入训练库的样本都能回指到同一视频、同一 pose 序列和一次明确的人类批准；不确定的视频会被保留和提示，而不会静默污染训练集。达到这个标准后，才把该动作/机位桶标为可做轨迹候选评分。
