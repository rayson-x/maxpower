# AI 教练证据、采集、训练与人工标注标准 v0.1

**Status:** Data contract / collection planning  
**Date:** 2026-08-09

## 1. Start from claims, not datasets

数据计划的最小单位不是“一个动作”或“一段视频”，而是一个待发布判断：

```text
exercise variant
× training intent
× equipment/resistance mode
× camera view
× deviation-effect pattern
× output claim
```

例如“杠铃划船”不是一项完整需求。“标准连续俯身杠铃划船 × 肌肥大/技术目的 × 杠铃 × 左前 45° × 躯干借力 × 实时提示”才是可训练、可标注、可验证的 claim。

每个 claim 在采集前必须声明：

- 要输出的原始观测、动作约束判断和教练推断；
- required landmarks / equipment / temporal window；
- 合法变式和容易混淆的替代解释；
- 支持的机位与必须拒答的机位；
- 对应 cue、恢复条件、持久性和 cooldown；
- 验证指标与错误成本。

## 2. What is actually trained

MM-Fit 不能“训练 MediaPipe 多看出几个点”。MediaPipe Pose Landmarker 是上游点位模型；本项目应把原始 RGB 重新送入目标 Android 同版本、同模型档位的 Pose Landmarker，得到原生 33 点、visibility/presence 和时间戳，再训练或校准下游能力：

| Capability | 输入 | 训练/产物 | Canonical owner |
|---|---|---|---|
| Action evidence | 33 点时序 + 可选 RGB/物体特征 | 已知候选中的动作类别/匹配概率 | Learned model 提交证据，课程/用户确认动作身份 |
| Causal phase evidence | 过去窗口的归一化 33 点时序 | ready / outbound / endpoint / return / hold 概率 | Rust 状态图确认阶段和唯一 rep 边界 |
| Observability | 点位质量、遮挡、主体连续性、视角、设备运行信息 | per-claim usable / cannot-judge | Rust/coach gate |
| Kinematic features | canonical landmarks + exact context | 角度、相对距离、ROM、时序、对称、轨迹 | Deterministic canonical analysis |
| Standard envelope | 专家认可和正常个体变异样本 | phase-normalized feature distribution | Versioned exercise coaching profile |
| Deviation event | 运动学窗口 + intent + profile | 具体偏差模式的 one-vs-rest 证据 | Coach matcher; no second rep counter |
| Equipment path | RGB/检测结果 + body anchors | 杠/哑铃/把手轨迹与质量 | Equipment adapter → canonical evidence |
| Coach inference/cue | 已确认偏差 + reviewed knowledge | 条件影响与提示选择 | Deterministic knowledge/policy; LLM only phrases |

不建议让一个端到端网络同时输出“动作、次数、标准度、刺激肌群和提示”。这种模型难以定位错误、无法可靠拒答，也会与 Rust canonical counter 冲突。

## 3. Source allocation

| 数据来源 | 最有价值的用途 | 可以提供的标签 | 必须补的处理 | 不能承担的职责 |
|---|---|---|---|---|
| MM-Fit raw RGB | 10 类动作的动作识别、粗周期/组次数一致性、多人和多设备域预训练、遮挡/方向失败分析、哑铃外观样本 | action、set start/end、set total count；同步 pose/IMU 可作辅助研究 | 用 exact target MediaPipe model 重跑 RGB；保留 source camera/session；对需要的子集补逐 rep 与偏差标注 | 不能提供标准动作、逐 rep 真值、真实 MaxPower 机位、纠错标签或刺激效果真值 |
| MM-Fit published pose | 快速研究基线、OpenPose→target-domain 迁移对照 | COCO-18/17 时序、组级标签 | 只把共有真实关节映射到 33 slots，其余保持 unknown；标记 pose source | 不是原生 MediaPipe 33，不可填造 face/hand/foot 点，也不可晋升生产 profile |
| RepCount-A / PoseRAC | in-the-wild 逐 rep 边界、背景/速度/裁切鲁棒性测试 | 类别、cycle bounds，部分 pose | 重跑 exact target pose；逐视频核对动作 identity、许可和边界语义 | 不提供标准 form 或本项目 exact variation 的可接受 envelope |
| MaxPower 自有视频 | 目标手机域、真实 UI 机位、精确变式、标准/偏差/反例、cannot-judge、个体基线和设备性能 | 可设计全部所需 metadata 与事件 | 明确同意、不可变原视频、canonical extraction、专家标注与 holdout | 不能用同一个人的同一 session 同时训练和证明泛化 |
| 人工标注 | rep/phase、可见偏差、合法变式、替代解释、cue、cannot-judge 和专家知识 | 分层标签与 adjudication | 双人独立标注、分歧仲裁、版本化指南 | 标注员主观印象不能变成肌电/受力真值；不得按模型输出照抄 |
| 教练标准示范 | 构建标准执行特征候选、cue 示例和合法策略范围 | intent、phase、feature role、acceptable variation | 多名教练、多体型、多设置；与普通用户和偏差样本分开 | 单名教练单次演示不是人群标准走廊 |
| 可选仪器子集 | 校准更高证据等级或验证代理 | 物体速度、IMU、双侧受力、EMG、多视角 3D 等 | 与视频严格同步并声明测量误差 | 非 V1 教练级轨迹提示的前置要求；不同传感器不可互相替代 |

## 4. MM-Fit intake standard

### 4.1 What we already know

当前本地研究覆盖 21 个 session、616 个 set、6,160 个组级 repetition。官方标签只有 set 起止、动作和整组次数，没有逐 rep 边界。发布 pose 是 OpenPose/COCO topology，不是目标移动端 MediaPipe 33。当前 research-only 映射回放为 428/616 exact-set（69.48%），不能当生产准确率或完成度能力。

MM-Fit 采集时向参与者演示动作但不纠正动作形式，因此它天然包含真实执行变化，却没有告诉我们哪些变化是可接受、哪些属于何种偏差。这正适合做 representation / action / periodicity 预训练和发现候选偏差，不适合直接学习“标准”。

### 4.2 Required reprocessing

对 MM-Fit RGB 的正式使用必须：

1. 保存原始记录 ID、参与者、session、官方 split、camera stream、原始时间戳与官方标签。
2. 用计划部署的 exact Pose Landmarker asset 分别重跑 `lite/full/heavy` 中实际需要评估的档位；保存 model version、delegate、input resolution、orientation/mirror 和 extraction code version。
3. 输出原生 33 点、visibility/presence、world landmarks（若模型提供）和每帧处理状态，不从 COCO pose 补缺点。
4. 把现有 COCO-18 映射结果保留为独立 `pose_source=mmfit_openpose18_mapped` 基线，禁止与 native 33 混桶。
5. 官方 set count 只用于 count-consistency loss 或 set-level evaluation。任何由总次数约束得到的逐 rep 边界必须标记 `weak_pseudo_label`。
6. 从 RGB 抽取的人工逐 rep/偏差标签另建版本，不能回写为官方标签。
7. 重新核对所使用 Zenodo record 的数据许可、署名义务、人物肖像/隐私和商业训练权限；不得把 starter code 的 MIT 许可自动套到视频数据。

### 4.3 MM-Fit tasks

适合：

- 10 类已知课程动作的 action evidence；
- causal phase model 的弱监督预训练；
- set-level count consistency；
- 跨参与者、真实速度变化、遮挡和背景鲁棒性；
- 哑铃检测的候选帧抽样；
- 找出需要自采的 failure modes。

不适合：

- 直接产生 `standard_envelope`；
- 把原始动作都标成“正确”；
- 训练左右力量、肌肉激活或刺激转移标签；
- 为它没有精确覆盖的器械/变式（如杠铃划船、高位下拉）外推标准；
- 用人体朝向代理冒充 `frontLeft45/left/rear` 等产品机位。

## 5. Own-video collection contract

### 5.1 Capture metadata

每段视频在录制前冻结：

```ts
interface CaptureIdentity {
  participantId: string;
  sessionId: string;
  deviceId: string;
  cameraLens: "front" | "back";
  requestedModelTier: string;
  effectivePoseModelId: string;
  effectiveDelegate: string;
  resolution: { width: number; height: number };
  fpsTarget: number;
  exerciseId: string;
  variationId: string;
  equipmentId: string;
  resistanceMode: string;
  trainingIntentId: string;
  sideMode: "bilateral" | "left" | "right" | "alternating";
  capturePosition: string;
  load?: { value: number; unit: "kg" | "lb" };
  plannedRom: string;
  tempoIntent?: string;
  consentVersion: string;
}
```

组内不得切换 pose model、delegate、resolution、exercise profile、camera view 或 training intent。变化必须开始新 capture/session lineage。

### 5.2 Required capture strata per claim

每个 claim 都必须覆盖语义类别，具体数量由 pilot 的变异和置信区间反推，不能先拍一个任意固定数字：

| Stratum | 必须包含什么 | Why |
|---|---|---|
| Reviewed standard | 多名教练/熟练者、不同体型下的可接受执行，不同自然节奏与合法路径 | 形成可接受 envelope，而不是复制单个模板 |
| Normal user variation | 普通用户在无需纠正时的自然差异 | 控制 clean-set false cue |
| Isolated deviation | 一次只刻意呈现一个 pattern，并有轻/中/明显程度 | 学习该偏差的主证据与 onset |
| Combined deviation | 常见共现，如躯干摆动 + ROM 缩短 | 训练 cue priority，不让多个提示同时轰炸 |
| Intentional variant | partial、pause、slow eccentric、power、allowed cheat 等 | 防止把训练计划误判为错误 |
| Hard negative | 相邻动作/变式、准备、休息、整理器械、入画离画 | 防止动作和 rep 假阳性 |
| Cannot judge | 遮挡、错误机位、出框、低光、宽松衣物、器械挡点、多人、相机抖动 | 训练拒答，不用猜测填补 |
| Fatigue/set drift | 同组前中后、不同负重/RPE/RIR（由用户报告） | 识别执行漂移，不把它自动归因肌肉疲劳 |
| Device domain | 目标低/中/高档 Android、front/back lens、CPU/GPU fallback | 验证 runtime tier 与性能/点位质量 |

### 5.3 Camera coverage

机位按 claim 选，不按动作只选一个万能视角：

- 正面/后面：左右端点、对称、横向路径、骨盆/肩线。
- 侧面：矢状面 ROM、躯干俯仰、髋膝协同、器械纵向路径。
- 45°：兼顾肘膝角、躯干与器械遮挡，常是移动端实用折中。
- 第二机位或上传视频：用于验证单目推断和高价值器械动作，不要求 V1 实时同时运行双相机。

采集前的 UI 指引必须说明全身/关键器械入镜、相机高度/距离、横竖屏、是否镜像、光照与支撑面。人脸可辅助估计朝向，但不能替代身体轴和实际 required landmarks 的可见性。

## 6. Annotation standard

### 6.1 Label layers

标注必须把“看见什么”和“认为意味着什么”分开：

| Layer | 标签 | 谁标 |
|---|---|---|
| Source | frame/time, capture identity, consent, provenance | 系统/数据工程 |
| Observation quality | subject, occlusion, required landmarks, equipment visibility, camera suitability | 受训标注员 + 自动预标 |
| Activity/set | action identity, set start/end, setup/rest/transition | 标注员 |
| Rep/phase | rep start, outbound, endpoint, return, hold, completed/incomplete | 双人独立标注，分歧仲裁 |
| Kinematic event | endpoint reached, trunk drift onset, bilateral gap, path deviation, support change | 受训标注员，按可见事实 |
| Deviation pattern | pattern ID, applicable phase, severity band, persistence, intentional/not intentional | 健身知识审核员/教练 |
| Coach inference | likely effect, alternative explanations, confidence, prohibited claims | 资深教练/运动知识审核 |
| Cue | primary cue, secondary cue, no-cue/cannot-judge, recovery condition | 教练 + 产品文案审核 |
| User context | load, RPE/RIR, pain report, intent override | 用户输入；不得从视频臆测 |

### 6.2 Core annotation record

```ts
interface CoachAnnotation {
  captureId: string;
  canonicalRepId?: string;
  timeRangeMs: readonly [number, number];
  actionIdentity: { value: string; confidence: number; source: string };
  phase?: "ready" | "outbound" | "endpoint" | "return" | "hold" | "unknown";
  observationState: "usable" | "partially_usable" | "cannot_judge";
  observedEvents: readonly {
    featureId: string;
    direction: string;
    phase: string;
    side?: "left" | "right" | "bilateral";
    evidenceFrameRanges: readonly [number, number][];
  }[];
  deviation?: {
    patternId: string;
    severity: "mild" | "clear" | "large";
    intentional: boolean | "unknown";
    alternatives: readonly string[];
  };
  coachInference?: {
    likelyEffectId: string;
    confidence: "low" | "medium" | "high";
    rationaleFeatureIds: readonly string[];
  };
  cueDecision: "cue" | "no_cue" | "cannot_judge";
  cueFamilyId?: string;
  annotatorId: string;
  guideVersion: string;
  adjudicationId?: string;
}
```

### 6.3 Annotation rules

- 标注员先隐藏模型预测，避免 confirmation bias；自动预标只能在独立 pass 中审核。
- 动作周期、可见事件、偏差模式、效果解释分开标。不能因为教练认为“在借力”就回填一个并不存在的躯干角变化。
- `cannot_judge` 是正式标签，不是缺失数据。
- 左右标签描述端点/ROM/时序/轨迹差，不标“左侧弱”。
- “刺激影响”是动作知识级的条件标签，不是逐帧生理真值。逐视频只标是否出现了足以匹配该知识模式的证据。
- 每条偏差保留替代解释，如 intentional variant、负重变化、相机投影、遮挡或动作 identity 错误。
- 技术失败与主动结束分开；疼痛和受伤只来自用户报告并走安全流程。

## 7. Feature and target standard

每个特征都要版本化并包含：

- feature definition and units；
- landmark/equipment dependencies；
- required view and mirror semantics；
- normalization frame（身体比例、身体坐标或图像坐标）；
- valid phases；
- smoothing/window and missing-data policy；
- measurement noise and minimum detectable change；
- personal baseline eligibility；
- whether it is observed, derived, or inferred。

训练目标优先采用：

- phase probability and boundary events；
- continuous feature reconstruction/forecast；
- one-vs-rest deviation events；
- observability/cannot-judge；
- confidence calibration；
- cue priority/no-cue。

避免：

- 用“正确/错误”单标签压扁所有原因；
- 用逐帧标准骨架欧氏距离当质量；
- 用一个总分作为训练 truth；
- 把弱伪边界当人工逐 rep 标签；
- 用标准示范和用户偏差样本在同一 session 内随机切 train/test。

## 8. Dataset split and leakage rules

所有指标必须至少按以下 group key 切分：

`participant × recording session × source video × device`

- 同一原视频的裁剪、镜像、重采样、pose 模型变体只能出现在同一个 split。
- 标准教练演示不能同时进入 reference envelope 和其 own test。
- hyperparameter、阈值、cue persistence 只用 train/validation；test 与 unseen-subject 在冻结后运行。
- MM-Fit、RepCount-A 和自有目标域分别报告，不用大外部集掩盖目标域失败。
- 单独保留 unseen subject、unseen session、unseen device 和 hard-negative/cannot-judge tests。
- `lite/full/heavy` 的输出作为不同 observation domain 报告；用户设备自适应切换后记录 effective model，而不是 requested tier。

## 9. Evaluation contract

### Pose and observability

- required-landmark usable-frame rate and longest gap；
- temporal jitter and endpoint repeatability；
- view/occlusion rejection accuracy；
- performance by model tier, delegate, resolution and device thermal state。

### Action, phase and rep

- action precision/recall within the intended candidate set；
- phase boundary timing error；
- completed-rep precision/recall and exact-set count；
- false reps during setup/rest；
- incomplete-cycle handling and final packet completeness。

### Coaching

- per-pattern event precision/recall/F1；
- clean-set false cues and cannot-judge precision/recall；
- cue onset latency, repetition and recovery latency；
- expert agreement and adjudication rate；
- confidence calibration；
- results by exact exercise × intent × view × device, not just macro average。

### Stimulus interpretation

评估“系统是否选择了与专家共识一致、证据足够且不过界的条件化解释”，不评估虚构的肌肉激活准确率。可选 EMG/力学子集只用于检验特定代理，结果不能自动推广到全部动作。

## 10. Source-to-claim examples

### Example A: lateral raise bilateral endpoint cue

- MM-Fit: 重跑坐姿侧平举 RGB，预训练动作/相位；从真实差异中发现 hard cases。
- Own video: 标准双侧、单侧较低/提前回程、躯干摆动、单臂/交替 intentional variants、正面与错误机位。
- Human annotation: 左右 endpoint/time gap、是否持续、是否能判断、首选提示。
- Release claim: “连续两次右腕端点较低”而不是“右肩力量不足”。

### Example B: barbell-row trunk borrowing

- MM-Fit: standing dumbbell row 只用于通用拉动/周期 representation，不提供杠铃标准。
- Own video: exact barbell variant、俯身角范围、不同负重、正常自然变化、刻意躯干摆动、ROM 缩短、两者共现、器械遮挡和不同机位。
- Human annotation: trunk-change onset relative to elbow/bar path, pattern ID, alternative variant, likely effect and cue。
- Extra evidence: 杠铃轴/杠路径 detector；无器械证据时只评论躯干与肘腕代理。

### Example C: squat depth and strategy

- MM-Fit: squat action/set count and coarse phase pretraining。
- Own video: exact bodyweight/back/front/goblet identities, side depth evidence, front bilateral evidence, intentional partials, different anthropometry and stance。
- Human annotation: task endpoint, hip/knee strategy, trunk pattern, observable alignment; no universal knee-over-toe label。
- Release claim: relative ROM and selected-variant adherence, not injury risk or universal “perfect squat”。

## 11. Collection order

1. Freeze claim registry and annotation guide before collecting large volumes.
2. Re-run external RGB through the exact target pose assets; keep all source topologies separate.
3. Pilot a few high-observability claims to estimate measurement noise, label agreement and class prevalence.
4. Use pilot results to calculate sample size and enrich rare hard negatives/cannot-judge states.
5. Build standard envelope and deviation event sets separately, then test their interaction in realistic sets.
6. Validate in shadow mode on target Android devices.
7. Enable one claim at a time; expand to additional exercises through the reviewed mapping.

## 12. Non-negotiable provenance

Every model, envelope and evaluation result must preserve:

- raw source and license/consent version;
- raw video hash and immutable capture identity;
- pose model asset/version/delegate/resolution;
- extraction and feature code version;
- label source (`official`, `human`, `weak_pseudo`, `model`) and guide version;
- split assignment and leakage group;
- knowledge/pattern version;
- runtime configuration and canonical packet version。

没有这些 provenance 的轨迹只能用于探索，不能进入生产教练判断。

## 13. Related evidence

- [训练执行评估标准](./ai-coach-training-execution-assessment-standard-v0.1.md)
- [教练偏差—影响知识矩阵](./ai-coach-deviation-effect-pattern-matrix-v0.1.md)
- [70 个动作知识模式映射](./exercise-coaching-pattern-mapping-v0.1.md)
- [MM-Fit 相机朝向与 profile 训练报告](../reports/mmfit-camera-view-and-rolling-profile-training-2026-08-09.md)
- [MM-Fit / RepCount-A Rust profile 验证](../reports/mmfit-repcount-rust-profile-validation-2026-08-09.md)
- [目标域 pose 计次路线](../research/2026-08-09-path-to-95-percent-pose-rep-counting.md)
- [Motion profile 数据消费与优化 workflow](./motion-profile-data-consumption-workflow-v0.1.md)
