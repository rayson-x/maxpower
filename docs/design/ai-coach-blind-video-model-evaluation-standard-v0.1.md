# AI 教练视频模型盲测验收标准 v0.1

日期：2026-08-11  
状态：research gate；尚不授权生产 promotion。  
机器可读阈值：[ai-coach-blind-video-model-evaluation-standard-v0.1.json](./ai-coach-blind-video-model-evaluation-standard-v0.1.json)

## 1. 验收对象

验收的是训练完成后、面对未参与训练的视频时的输出能力，不是模板对同一录像的回放能力。系统必须分别回答：

1. YOLOX 是否持续选中前景本人；
2. RTMPose + Rust 是否给出可信且不过度补造的 Halpe-26 骨架；
3. 动作身份来自用户已声明的训练任务，还是模型自由识别；
4. Rust 是否正确输出 rep、start/peak/end 和不完整尝试；
5. 杠铃或哑铃是否被真实检测、跟踪并形成器械轨迹；
6. 运动轨迹与器械轨迹是否足以支持分维度动作质量判断；
7. Web、Android、iOS 是否消费同一版本的 Rust canonical 输出。

上述维度不得合成为一个“AI 准确率”。任一层失败都会污染下一层，所以每层可以独立 `cannot_judge`。

## 2. 盲测与随机抽查

隔离单位是 `participant × recording session × sourceCaptureId × device`。同一原视频的裁剪、镜像、重采样、pose 重提取和增强版本必须留在同一 split。

流程固定为：

```text
冻结数据清单与随机种子
  → 按 group key 分 train / validation / test
  → 只在 train 拟合，在 validation 选模型与阈值
  → 冻结模型、Rust 版本和推理配置
  → 对 test 生成不可变预测
  → 最后读取人工标注并评分
```

当个人语料较小时，对每个 `sourceCaptureId` 做 exhaustive leave-one-source-out：每次把一个原视频及其全部派生数据排除在训练外，再对它推理。这样 50 条视频会得到最多 50 次独立的 source-held-out 预测。

固定种子打乱后随机选择一条视频，适合在复核页做人工 spot check；它不参与最终通过判定。正式 95% 门槛必须聚合全部符合条件的留出视频，防止刚好抽到容易样本。

MM-Fit 不重新随机切分，必须保留官方 subject split；train 只用于拟合，validation 用于选择，test 和 unseen_test 在冻结后评分。

## 3. 三类核心误差

### 3.1 骨架识别

骨架准确率必须来自人工关键点真值，不能拿 RTMPose score、visibility 或 Rust canonical confidence 自证正确。

- required joints 的 `PCK@0.10 torso length ≥ 95%`；
- required-joint usable-frame rate ≥ 95%；
- 人工标为遮挡或歧义的点，被错误声明为可靠 `measured` 的比例 ≤ 1%；
- 无可靠观测时只允许有界的 fused/predicted，超过 150 ms 必须 unknown；
- 每个 exact action × view × equipment 至少人工标注 100 个分层抽样帧。

### 3.2 动作时间轴

- completed-rep precision ≥ 95%；
- completed-rep recall ≥ 95%；
- 每条 source video 的整组次数完全正确率 ≥ 95%；
- start/end 误差均 ≤ 500 ms 且 interval IoU ≥ 0.60 的 rep 比例 ≥ 95%；
- 至少 40 条冻结的 `peakSource=human_adjusted` peak 真值，且误差 ≤ 250 ms 的 rep 比例 ≥ 95%；
- clean setup/rest 中的误计 ≤ 0.05 次/组。

时间轴评分必须由训练时不可见的人工 `start/peak/end` 揭晓后计算。来源不明、算法候选或区间中点生成的 peak 均保留 provenance，但不得进入 peak 准确率；`equipmentExtremeMs`（例如杠铃最低点）和动作区间的 phase peak 也必须分字段保存。使用同录像人工 phase 模板的 `human_phase_exact_replay` 只能验证播放器和 Rust 链路，不能作为准确率。

### 3.3 动作质量

质量不是“与一条标准骨架的平均距离”。它按 ROM、阶段控制、躯干/骨盆、双侧时序、人体路径、器械路径、组内退化和 `cannot_judge` 分维度验收。

- 每个维度和偏差模式 macro F1 ≥ 95%；
- `cannot_judge` F1 ≥ 95%；
- 发出 coaching cue 的 precision ≥ 95%；
- clean set 的错误提示 ≤ 0.05 次/组；
- 每个 class × exact context 至少 30 个由两名独立专家一致标注的 gold examples。

没有人工质量、借力、代偿和不可判断标签时，该层必须显示 `blocked_no_gold_labels`。个人历史可以建立个人轨迹分布，但不能自动成为“标准动作”真值。

## 4. YOLO 器械轨迹

人体检测和器械检测是两项不同任务。当前 YOLOX HumanArt 人体模型不能因为名字里有 YOLO 就被当作杠铃/哑铃 detector。

器械训练至少需要：

- `barbell_shaft`：轴线两端、中心和可见/遮挡状态；
- `dumbbell_left` / `dumbbell_right`：实例框、中心、左右归属和遮挡；
- `machine_handle` / `weight_stack`：动作相关实例和轨迹点；
- setup、rack/unrack、休息、旁人器械和镜中器械 hard negatives。

验收包括 class detection F1、动作阶段内 track coverage、轨迹点误差和 set 内 identity switch。人体腕点只能作为融合证据，不能替代杠铃/哑铃真值；同理，器械轨迹可以在腕肘遮挡时辅助计次和 phase，但不得反向生成“实测手腕”或冒充骨架 PCK 真值。

## 5. Rust SDK 与三端

训练产物只有在 Rust Motion SDK 内成为版本化、可复现的运行时模型后，才算交付给客户端。Python 离线参考模型即使指标通过，也只能证明算法候选。

Web、Android、iOS 必须对同一 fixture 输出 byte-exact canonical packet；客户端只负责帧输入、渲染和呈现，不允许各自拥有第二套骨架、计数、阶段或动作质量判断。目标设备还需达到已声明的处理 FPS、backpressure 和热稳定门槛。

## 6. 当前数据能验收什么

- 50 条个人视频、54 个 evaluation window、464 条人工 rep ranges：可做 source-isolated rep 与时间轴验收；仍只有一个已知用户，不能证明跨用户泛化。
- 个人视频没有人工 Halpe-26 关键点真值：骨架点误差未测量。
- 当前 464 个 technique review item 全部 pending：动作质量、借力和代偿分类未训练、未测量。
- 当前没有杠铃/哑铃人工轨迹与 detector：器械路径未测量。
- MM-Fit 可支持动作身份、周期和 set-count 预训练/官方 split 评测，不能提供个人动作质量真值。

因此现阶段可以优化和验收“动作识别与时间轴”，但不能把它包装成“动作质量已正确分析”。后者的下一项必要工作是完成器械轨迹和专家 technique gold 标注。
