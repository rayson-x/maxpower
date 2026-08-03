# 重复次数为何多计：现有链路与轨迹计数诊断

日期：2026-08-03  
范围：Web 客户端当前实现、已保存的本地采集数据，以及可在设备端落地的近期改进路线。本文是研究结论，不改变实现。

## 先给结论

你的判断**基本正确**：当前已知动作的最终次数不是由一整段骨架轨迹的形状来判定，而是由一个动作专属的**一维信号**（关节角或手腕相对高度）经过平滑、滞回极值检测后得到。它不是“只要弯一下就算一次”的最早占位计数器，但也尚未做到“完整骨架轨迹通过一致性校验才算一次”。

因此，8 次训练被多计最可能是：进入/调整机位、摆动、半程回弹、跟踪跳点，恰好在这个一维信号上形成了“端点 → 另一端 → 回到端点”的形状。现行的时长和幅度门槛会滤掉一部分噪音，但不会检查每个候选是否与本组其余重复的完整骨架轨迹一致。

这不是建议立刻用大模型重做。第一版更合适的路线是：保留当前轻量、可解释的信号分期，给它加上“训练开始门 + 多特征有限状态机 + 轨迹一致性拒绝”。这能直接针对多计，且适合 Web 和后续移动端。

## 当前代码事实（不是外部推断）

### 1. 实时预览与保存的数据

- 每一个解码的视频帧先经过姿态模型，再进入 canonical frame；渲染、记录、分析消费者读取同一份 canonical frame。见 [`CameraPoseView.web.tsx`](../../src/components/CameraPoseView.web.tsx) 第 490–532 行。
- 录制结束后，原始 canonical pose 会先经过 `selectTrainingWindow()`，用躯干横向位移、躯干尺度变化和帧间隔，保守地选择一段连续、相对稳定的训练窗口。见 [`trainingWindow.ts`](../../src/pose/trainingWindow.ts) 第 1–156 行；它只排除进出机位等全身移动，**不会**判断一组内的摆动、半次或单次轨迹是否合格。

### 2. 已知动作的实际计数

已知动作会从 profile 取得一个 `phaseSignal`，然后调用 `segmentRepsBySignal()`；最终 `analysis.segments.length` 就是 UI 显示/导出的专项计数。调用关系见 [`repMetricsExtractor.ts`](../../src/pose/repMetricsExtractor.ts) 第 390–435 行及 [`poseSetAnalysis.ts`](../../src/pose/poseSetAnalysis.ts) 第 150–187 行。

当前 profile 的主信号如下：

| 动作例子 | 一维计数信号 | 事实来源 |
| --- | --- | --- |
| 高位下拉、引体 | `wrist_height`：手腕相对肩膀的 y 距离 | [`kinematicsProfile.ts`](../../src/pose/kinematicsProfile.ts) 第 73–92 行 |
| 杠铃划船、坐姿划船、面拉 | `elbow_angle`：肩–肘–腕夹角 | [`kinematicsProfile.ts`](../../src/pose/kinematicsProfile.ts) 第 62–102、176–188 行 |
| 直臂下拉、侧平举等 | `shoulder_angle`：髋–肩–腕夹角 | [`repSegmenter.ts`](../../src/pose/repSegmenter.ts) 第 92–125 行 |
| 深蹲 | `knee_angle`：髋–膝–踝夹角 | [`kinematicsProfile.ts`](../../src/pose/kinematicsProfile.ts) 第 113–133 行 |

具体过程是：

1. 固定整段中平均可见性较好的一侧；逐帧读取上述一个标量。见 [`repSegmenter.ts`](../../src/pose/repSegmenter.ts) 第 55–129、269–289 行。
2. 以 EMA（`alpha = 0.35`）平滑。见第 132–142 行。
3. 用 5%/95% 分位得到稳健幅度；以其 20% 作滞回带，找 min/max 的交替极值。见第 157–205、239–266 行。
4. 只有“静息端 → 发力端 → 静息端”、总时长 0.7–12 秒才构成一 rep。见第 208–232 行。

所以：**它已经是“带时序的单信号循环计数”，不是逐帧弯曲阈值；但尚不是多关节的轨迹验证计数。**

### 3. 轨迹目前做了什么、没做什么

`trajectory.ts` 确实会计算手腕路径的主轴、直线度、路径长度、左右差异、躯干运动比例、周期性和逐 rep 一致性。见 [`trajectory.ts`](../../src/pose/trajectory.ts) 第 1–15、620–637 行。

但轨迹只在自动动作建议、质量/动作特征和界面诊断中使用；`segmentRepsBySignal()` 的接受条件没有读取这些轨迹指标。因此“本次候选轨迹明显不像本组其它次数”目前仍然可能被计入。

另一个应修复的一致性问题：已知动作路径中的 `shoulder_angle` 是髋–肩–**腕**，自动路径里同名信号是髋–肩–**肘**；源代码已明确标为历史不一致。见 [`repSegmenter.ts`](../../src/pose/repSegmenter.ts) 第 88–102、411–423 行。这会让“自动候选”和“专项结果”难以公平比较。

### 4. 现有采集数据能说明什么

现有 18 组重放报告显示，多个组的“专项规则”与“自动周期”计数不一致；例如三段高位下拉的专项候选为 9/6/7，而自动周期候选为 8/7/6。详见 [`field-capture-replay-2026-08-03.md`](../reports/field-capture-replay-2026-08-03.md)。这证明当前两个候选机制会分歧，不能证明哪一个等于真实次数——历史 labels 也不是人工真值。

因此，若某段你实际做了 8 次而 UI 显示更多，现有资料足以判定这是需要修的算法风险；但在你为该段视频确认人工次数前，不能严谨地声称“算法多了 N 次”。

## 一手来源给出的可借鉴方法

### 姿态置信度与平滑不是 rep 语义

MediaPipe 官方说明 Pose 会输出 33 个 landmark（含 image/world 坐标和 visibility），并在视频模式由 detector-tracker 链路维持追踪；`min_tracking_confidence` 决定是否继续跟踪/重新检测，并不表示“这是一次合格训练动作”。旧 Pose API 的 `smooth_landmarks` 只用于降低 landmark jitter。[MediaPipe Pose 官方文档](https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose.md)；[Pose Landmarker 官方文档](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/index)。

官方实现中的 `LandmarksSmoothingCalculator` 还会在 landmark 为空时重置滤波器，并按照时间戳和 object scale 应用滤波；这意味着平滑有助于抗抖动，却不能填补丢失的动作相位，也不能判断一个边界是否应计数。[MediaPipe 源码](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/calculators/util/landmarks_smoothing_calculator.cc)。

### 不要只接受单个局部极值

Wang 等人的 skeleton repetition segmentation 先选择周期性运动参数并去噪，再从多个运动学参数的速度低谷生成候选边界；论文特别指出局部停顿会产生多个候选，需要在后续阶段合并/选择，否则会过分切段。这与“底部略停、回弹或 tracking jump 被多算一次”的症状直接对应。[作者原始论文](https://arxiv.org/abs/1512.04115)（方法 §4.2–4.3；[PDF](https://arxiv.org/pdf/1512.04115)）。

Levy 与 Wolf 的在线计数不假设视频已经恰好裁成一段重复动作；它通过滑动窗估计周期性并根据预测不确定性决定何时开始/停止计数。其产品启示是：从走到器械、调整姿势，到正式训练，应是独立的状态转换，不应只是同一条 rep 信号的前几帧。[ICCV 原始论文](https://openaccess.thecvf.com/content_iccv_2015/html/Levy_Live_Repetition_Counting_ICCV_2015_paper.html)（[PDF](https://openaccess.thecvf.com/content_iccv_2015/papers/Levy_Live_Repetition_Counting_ICCV_2015_paper.pdf)）。

### 完整时序上下文确实是计数的主问题

RepNet 用帧间 temporal self-similarity 作为中间表示来预测周期与周期性，而不是只看一个局部拐点。[Dwibedi 等，CVPR 2020 原始论文](https://openaccess.thecvf.com/content_CVPR_2020/html/Dwibedi_Counting_Out_Time_Class_Agnostic_Video_Repetition_Counting_in_the_CVPR_2020_paper.html)。Zhang 等也指出现实重复的 cycle 长度未知且可变，单一短片段不足以确定周期，需要更长的上下文。[CVPR 2020 原始论文](https://openaccess.thecvf.com/content_CVPR_2020/html/Zhang_Context-Aware_and_Scale-Insensitive_Temporal_Repetition_Counting_CVPR_2020_paper.html)。

这些论文支持“用整段轨迹/上下文核验”的方向，但**不建议当前直接引入它们的全视频深度网络**：我们尚没有足够人工真值来微调、模型也会破坏可解释性和 Web 首版的性能预算。

### 适合实时端的滤波器

1€ Filter 根据运动速度自适应截止频率：慢速时更平滑以减抖，快速时提高带宽以降低延迟，适合放在 landmark/特征层。但它只能改善输入稳定性，不会替代计数语义或轨迹准入。[Casiez 等人的作者页面与论文链接](https://gery.casiez.net/1euro/)（[DOI](https://doi.org/10.1145/2207676.2208639)）。

## 推荐的近期修复：不训练模型，先让“候选”变成“已确认次数”

### 计数状态机

对每个已知动作维护：`idle → arming → end-A → end-B → end-A`。

- `arming`：点击开始录制后，要求连续 0.6–1.0 秒“人体在机位、躯干尺度稳定、关键点可见、全身横移低”。未通过一律不计数。
- 两端状态：主信号必须分别跨越进入/退出阈值；阈值使用每组近期稳定幅度的中位/IQR，而不是只依赖整段 20% 固定比例。
- 每端增加很短的低速 dwell（例如 100–200 ms），防止一个抖点立即触发反向。
- 只有完整返回 `end-A` 才生成“rep 候选”，半程、停止在底部、录制裁断都不增加数字。

### 多特征准入，而不是把全部责任交给一条角度

每个动作定义 2–4 个按躯干尺度归一化的特征：主相位信号、相关关节角/位移、躯干漂移、必要关键点可见度。比如高位下拉的主信号可以继续是手腕相对肩高，但候选还须满足肘角与手腕路径同向变化、躯干横移未超限、手/肘/肩在关键相位可见。

这仍可完全在当前 TypeScript 中运行，也不会改变 canonical frame 是唯一渲染/保存/分析输入这一已建立约束。

### 轨迹一致性只负责“拒绝可疑候选”

对每个候选 rep，将多关节特征重采样为固定长度（例如 32 点 × 关键特征），与本组中位轨迹计算相关系数或受限 DTW 距离。前两次只建立参考；从第三次起，明显低于一致性门槛的候选标为“需确认”，不自动加到正式次数。

这样不会因为新手动作幅度不一致就悄悄丢掉训练量：UI 同时显示“已确认 8 / 待确认 1”，审批台可回放该候选的起点、底部和终点。

### 最小验证实验与验收标准

先只选择高位下拉一个动作、同一机位、每组口头或 UI 填写真实次数：收集至少 20 组，其中覆盖走入画面、底部停顿、摆动、慢速和正常节奏。离线重放 v1 与新状态机，冻结所有其他变量。

成功标准：

- 以人工视频审批为真值，比较每组绝对误差、漏计率、误计率；
- 新方案不得比 v1 增加误计；对“实际 8 次”组，目标首先是绝对误差为 0；
- 对低可见度或轨迹不一致的候选，宁可输出“待确认”，不能静默地加数；
- 输出给客户端、渲染骨架、导出的 pose 和审批证据均来自同一 canonical frame 序列。

达到上述真值规模前，不要宣称准确率；也不要把历史 `.labels.json` 当作真值。

## 建议的实施优先级

1. 先在控制台显示每个计数候选的：主信号曲线、两端阈值、关键点可见度、轨迹一致性、接受/拒绝原因。
2. 为高位下拉实现上述 FSM、多特征门和“待确认”状态；用保存的视频离线回放。
3. 用人工审批后的数据校准每动作阈值与轨迹门；再逐项推广到坐姿划船、引体等。
4. 只有积累到足够的人工分段真值后，再考虑轻量 TCN/自相似模型作为候选 gate；它应辅助而不是取代可解释的专项状态机。
