# Motion profile 数据消费与优化 workflow v0.1

**Status:** Approved design target / not implemented yet  
**Date:** 2026-08-09  
**Scope:** 消费 MaxPower 已标记视频与 MM-Fit，生成可复现的识别 profile 候选、评测报告和人工审批提案  
**Does not change:** Android V1、Rust ABI、MotionPacket、实时 AI 教练运行逻辑

## 1. Outcome

建立一个固定、可重复、可审计的 workflow：

```text
发现数据
→ 按来源适配
→ 统一标准输出
→ 证据/许可/可观测性门禁
→ 冻结 train/validation/test
→ 生成 baseline
→ 优化 profile candidate
→ 跨来源回放与分层评测
→ 生成 promotion proposal
→ 人工批准后发布新 profile 版本
```

workflow 只优化**动作身份证据、阶段、计数和抗干扰 profile**。它不会把“用户做过的动作”或 MM-Fit 片段自动变成标准动作，也不会直接优化训练完成度、刺激影响或教练提示阈值。后者消费同一 canonical evidence，但使用独立的教练知识与标注合同。

## 2. Current data reality

### MaxPower 已标记数据

当前 `data/training/approved-segmentation-v1.json` 包含：

- 11 段 capture、89 个逐 rep `start/peak/end` 标注；
- 6 段杠铃卧推、4 段器械推胸、1 段俯卧撑；
- 11 段可用于 evaluation，4 段当前满足 tuning 条件，7 段属于 challenge；
- 1 条状态为 `approved`，10 条为 `user_confirmed_complete_draft`，但导出声明完成整段审阅；
- 没有结构化 `subjectId` 与 `recordingBatchId`，因此无法证明 subject/session holdout；
- 当前已经生成 5 个 provisional observed profiles；这些 profile 的回放仍是同批或近同批证据。

workflow 必须把这批数据标成 `legacy_unpartitioned`：允许生成研究候选、回归和失败分析，不允许单独推动 production promotion。

### MM-Fit

当前本地规范化语料包含：

- 21 个 session、616 个 set、6,160 个组级 repetitions、10 类动作；
- 官方标签为 `action + set start/end + set total count`，没有逐 rep phase 边界；
- 当前 pose 是 COCO/OpenPose joints 到 BlazePose33 slots 的 exact-joint mapping，不是原生 MediaPipe 33；
- train/validation/test/unseen_test 可按官方 subject-isolated split 使用；
- RGB train 下载目前仍有 `.part` 文件，不能假设 exact MediaPipe Heavy 重提取已经完成。

workflow 必须同时支持两个 MM-Fit observation domain：

1. `mmfit_openpose18_mapped`：现在即可使用的 research-only baseline。
2. `mmfit_mediapipe33_<asset>`：RGB 完整下载并用 exact target asset 重跑后才能存在的目标 topology。

这两个 domain 不能混桶或冒充彼此。

## 3. Non-negotiable rules

1. Rust canonical replay 是识别/阶段/计数评测的唯一运行路径，不写第二套计数器。
2. MM-Fit `set_count` 只提供组级弱监督。workflow 不从总次数伪造人工逐 rep 真值。
3. 自有逐 rep 标签可以优化识别 profile，但不代表动作标准、刺激效果或医学结论。
4. 原始数据、归一化语料、split assignment、candidate、evaluation 与 published profile 都不可变、可追溯。
5. 优化永远不能直接覆盖当前 profile。输出先进入 `proposal`，由人审后发布一个新 identity/version。
6. train 才能拟合；validation 用于选择/早停；test 和 unseen_test 只能在候选冻结后运行。
7. 同一原视频的裁剪、pose 重提取、镜像、不同模型档位和增强版本必须留在同一 split。
8. profile 精确匹配 `exercise × variation × equipment × capture position × side × observation domain`。缺失字段不得通过相似名称自动继承。
9. 数据许可、同意书或 provenance 不完整时可以生成 inventory，但不得进入训练或 promotion。
10. 每次 run 即使失败也必须输出机器可读的拒绝原因和已完成阶段。

## 4. Deep Module

`MotionProfileWorkflow` 是整个流程的深 Module。调用者只需要学习一个 spec 和一个运行命令；现有 segmentation trainer、MM-Fit adapter、profile generator、Rust replay 和报告生成器成为其内部 Implementation。

### External Interface

```ts
interface MotionProfileWorkflow {
  plan(spec: MotionProfileWorkflowSpec): Promise<WorkflowPlan>;
  run(spec: MotionProfileWorkflowSpec): Promise<WorkflowRunResult>;
}
```

CLI 只暴露一个入口：

```bash
npm run workflow:motion-profile -- \
  --spec configs/motion-profile-workflows/<workflow-id>.json \
  --mode inspect|candidate|proposal
```

- `inspect`：只发现、验证、标准化和报告数据，不训练。
- `candidate`：生成候选并完成所有冻结评测，不允许发布。
- `proposal`：候选通过 policy 后生成 promotion proposal，仍不覆盖已发布 profile。

真正的发布使用独立、显式且带 proposal hash 的审批命令。`run` 不接受 `--force-promote`。

### Internal adapters

只有存在真实差异的两个 source adapters：

- `ApprovedCaptureAdapter`：读取 approval export、capture manifest 和 MediaPipe sidecar，保留逐 rep 强标签及审批状态。
- `MmFitAdapter`：读取官方 split、组级标签和明确的 pose source，保留 weak supervision。

它们在 source seam 后输出同一个 `CanonicalTrainingSequence`，但不得抹平监督强度。未来 RepCount-A 可以作为第三个 adapter，不需要修改 workflow Interface。

## 5. Workflow spec

```ts
interface MotionProfileWorkflowSpec {
  schemaVersion: "maxpower-motion-profile-workflow/v1";
  workflowId: string;
  claim: {
    exerciseId: string;
    variation: string;
    equipment: string;
    capturePosition: string;
    trainingSide: "bilateral" | "left" | "right" | "alternating";
    intendedUse: readonly ("action_evidence" | "phase" | "rep_count" | "anti_interference")[];
  };
  observationDomains: readonly PoseRuntimeDescriptor[];
  sources: readonly SourceSelection[];
  splitPolicyId: string;
  featureContractId: string;
  candidateSearchPolicyId: string;
  promotionPolicyId: string;
  seed: number;
}
```

Example:

```json
{
  "schemaVersion": "maxpower-motion-profile-workflow/v1",
  "workflowId": "lateral-raise-front-bilateral-v1",
  "claim": {
    "exerciseId": "lateral_raise",
    "variation": "standard_dumbbell",
    "equipment": "dumbbell",
    "capturePosition": "front",
    "trainingSide": "bilateral",
    "intendedUse": ["action_evidence", "phase", "rep_count", "anti_interference"]
  },
  "observationDomains": [
    {
      "poseModel": "mediapipe-pose-landmarker-heavy",
      "assetHash": "REQUIRED",
      "delegate": "recorded-per-capture",
      "landmarkSchema": "blazepose33"
    },
    {
      "poseModel": "mmfit-openpose18-mapped",
      "assetHash": "source-dataset",
      "delegate": "offline",
      "landmarkSchema": "blazepose33-adapted"
    }
  ],
  "sources": [
    { "kind": "approved_capture", "dataset": "data/training/approved-segmentation-v1.json" },
    { "kind": "mmfit", "dataset": "data/external/mm-fit/normalized", "allowedSplits": ["train", "validation", "test", "unseen_test"] }
  ],
  "splitPolicyId": "subject-session-source-video/v1",
  "featureContractId": "lateral_raise/front/bilateral/features/v1",
  "candidateSearchPolicyId": "rust-profile-conservative-grid/v1",
  "promotionPolicyId": "recognition-profile-evidence-gate/v1",
  "seed": 20260809
}
```

`REQUIRED` 占位符会让 `plan` 失败，不能静默使用当前机器上的另一个模型。

## 6. Canonical standard output

所有 source adapters 输出：

```ts
interface CanonicalTrainingSequence {
  schemaVersion: "maxpower-canonical-training-sequence/v1";
  sequenceId: string;
  source: {
    datasetId: string;
    sourceRecordId: string;
    sourceHash: string;
    licenseOrConsentId: string;
  };
  identity: {
    exerciseId: string | null;
    variation: string | null;
    equipment: string | null;
    capturePosition: string | "unknown";
    trainingSide: string | "unknown";
  };
  grouping: {
    subjectId: string | null;
    sessionId: string | null;
    sourceVideoId: string;
    deviceId: string | null;
  };
  observation: PoseRuntimeDescriptor;
  frames: readonly CanonicalPoseFrameRef[];
  supervision: {
    labelSource: "human" | "official_dataset" | "weak_pseudo";
    granularity: "set_count" | "per_rep_bounds" | "per_rep_phase";
    approvalStatus: string;
    allowedUses: readonly string[];
    forbiddenUses: readonly string[];
  };
  labels: {
    setBounds: readonly TimeRange[];
    totalRepetitions: number | null;
    repBounds: readonly RepBoundary[];
    negativeWindows: readonly TimeRange[];
  };
  quality: ObservationQuality;
}
```

关键设计：格式统一不代表证据等价。MM-Fit 仍保持 `set_count + official_dataset`，自有完整标注保持 `per_rep_phase + human`。训练器按照 `allowedUses` 消费，而不是看文件名猜标签可信度。

## 7. Fixed stages

### Stage 0 — Plan and freeze

- 校验 spec、exercise registry、feature contract、profile schema 和目标 Rust SDK contract version。
- 解析将读取的源、预期 observation domain、split policy 和输出目录。
- 输出 `plan.json`，包含 input paths、hash strategy、预计任务和 blockers。
- 任何 unresolved placeholder、unknown license/consent 或 missing exact identity 阻止后续训练。

### Stage 1 — Discover and inventory

- 枚举 approval export、capture manifest、keypoint sidecars、MM-Fit manifests/splits/RGB extraction state。
- 计算文件 hash；不复制或修改原始视频。
- 明确列出 missing RGB、`.part` 文件、丢失 sidecar、未知 subject/session 和过期 model provenance。
- 输出 `inventory.json` 和面向人的 `inventory.md`。

### Stage 2 — Adapt to canonical training sequences

- 自有 capture：保留 `start/peak/end`、notes、negative windows、pose model 和审批状态。
- MM-Fit mapped pose：只有真实共有 joints，其余 landmark 保持 unknown。
- MM-Fit RGB branch：只有完整视频、asset hash 和 extraction manifest 都满足时才用 exact target Pose Landmarker 重提取。
- 每个 sequence 都获得稳定 `sequenceId = hash(source + extraction + label version)`。

### Stage 3 — Admission gates

每条 sequence 单独决定用途：

| Gate | 失败后的处理 |
|---|---|
| Provenance/permission | inventory only |
| Exact exercise/context | 可用于 broad action research；不能进入 exact profile |
| Observation domain | 隔离成独立 bucket |
| Required landmark coverage | challenge/cannot-observe；不能补点 |
| Label consistency | reject 或 weak only |
| Human review completeness | evaluation/challenge 或 pending；不得自动作为 clean tuning |
| Subject/session group keys | `legacy_unpartitioned`；不得支持独立 promotion |
| Negative-window review | 不允许证明 anti-interference |

输出 `admission.json`，每条样本携带 accepted uses 与拒绝原因。

### Stage 4 — Split lock

- 外部数据保留官方 subject-isolated split。
- 自有数据按 `subject × session × source video × device` 分组后分配。
- 同源派生数据继承原 split。
- split manifest 由输入 hash、policy 和 seed 决定；一经产生不可就地重分。
- 缺少 group keys 的历史数据单列 `legacy_unpartitioned`，只能用于 candidate discovery 或 regression。

输出 `split-lock.json`。

### Stage 5 — Standard feature extraction

所有样本使用同一 versioned feature contract：

- body-coordinate normalization and mirror semantics；
- primary/secondary phase signal；
- required-landmark observability；
- phase-window feature values；
- rest/setup negative evidence；
- exact timestamps and missing-data spans。

workflow 不允许每个 trainer 自己重新解释坐标、镜像或 unknown landmarks。

输出 `feature-corpus/manifest.json` 和按 sequence 分片的 feature records。

### Stage 6 — Baseline replay

在任何优化前，用当前已发布 profile 或明确的 initializer 通过相同 Rust canonical replay 运行：

- self per-rep boundary/count metrics；
- clean/challenge/negative results；
- MM-Fit set-count metrics by split；
- observation coverage and rejection；
- runtime/profile provenance。

输出 `baseline-evaluation.json`。没有 baseline 的 claim 不进入优化，因为无法证明候选改善了什么。

### Stage 7 — Candidate optimization

优化顺序固定：

1. 用训练集选择可观测 signal/feature contract；
2. 用 strong per-rep train labels 拟合边界、幅度、hysteresis、duration 和 gap 参数；
3. MM-Fit train 的 set-count weak labels只用于 candidate ranking、count-consistency 或 learned phase evidence 预训练；
4. validation 选择候选和防止过拟合；
5. candidate 冻结后才运行 test/unseen/challenge；
6. 不允许 test 指标反向进入参数搜索。

若 exact-context strong labels 不足，workflow 可以输出 `research_candidate`，但不能用 MM-Fit 自动补齐成 `field_observed_candidate`。

每个 candidate 必须包含：

- 完整 Rust profile data 与 content hash；
- parent profile identity/hash；
- training sequence IDs and label granularity；
- excluded/challenge sequences；
- search policy、seed 和 objective；
- intended/forbidden uses。

### Stage 8 — Frozen evaluation

同一个 frozen candidate 依次评测：

1. self validation/held-out subject；
2. self challenge；
3. self reviewed negatives；
4. MM-Fit validation；
5. MM-Fit test；
6. MM-Fit unseen_test；
7. observation-domain breakdown；
8. current published profile parity/regression。

报告不得把组级 MM-Fit count 与自有逐 rep phase 合成一个“总准确率”。分别输出：

- exact-set ratio and count MAE；
- completed-rep precision/recall；
- start/peak/end boundary error；
- false reps in negative windows；
- cannot-observe/rejection coverage；
- per action/view/domain/subject/device results。

### Stage 9 — Promotion proposal

promotion policy 由版本化配置定义，但至少要求：

- 有 exact-context strong-label holdout；
- subject/session/source-video 泄漏检查通过；
- 相对 parent 在目标 holdout 有声明的改善或等效，并且 false-positive/negative-window 不退化；
- challenge、external test 和 unseen 报告完整，不隐藏失败；
- profile identity、schema、content hash、runtime contract 可安装；
- profile 仍只声明 recognition/counting，不声明 form correctness；
- 人工审阅 candidate diff、失败明细和数据许可。

输出 `promotion-proposal.json` 与 `promotion-proposal.md`。失败时输出 `not_promotable` 和原因，不生成可发布 bundle。

### Stage 10 — Explicit publish

发布不属于 `run`：

```bash
npm run approve:motion-profile -- \
  --proposal <absolute-path>/promotion-proposal.json \
  --expected-sha256 <proposal-hash>
```

审批器只追加新 version，不修改旧 artifact；写入 changelog、profile registry、evidence manifest 和 rollback reference。Android/Rust 是否消费新 artifact 仍由未来 SDK spec 决定。

## 8. Source weighting and optimization policy

不能把两个来源简单拼成一个随机训练集。推荐的分工是：

| Source/evidence | Candidate discovery | Parameter fitting | Candidate selection | Final product gate |
|---|---:|---:|---:|---:|
| MaxPower strong per-rep train | yes | yes | no | no |
| MaxPower strong per-rep validation | no | no | yes | no |
| MaxPower held-out subject/session | no | no | no | yes |
| MaxPower challenge/negative | no | no | regression only | yes |
| MM-Fit train set-count | yes | weak loss/ranking | no | no |
| MM-Fit validation | no | no | domain robustness | no |
| MM-Fit test/unseen | no | no | no | external robustness only |
| `legacy_unpartitioned` self data | yes | research candidate | compatibility replay | never alone |

MM-Fit 可以让模型学会“这类动作的周期通常长什么样”，但 production profile 的最终幅度、可见性和机位门禁仍需要目标 Android observation domain 的自有数据。

## 9. Artifact layout

运行产物默认进入 git-ignored 路径：

```text
data/workflows/motion-profile/<workflow-id>/<run-id>/
├── plan.json
├── inventory.json
├── admission.json
├── split-lock.json
├── source-manifest.json
├── canonical-corpus/
├── feature-corpus/
├── baseline-evaluation.json
├── candidates/
├── frozen-evaluation.json
├── promotion-proposal.json
├── promotion-proposal.md
└── run-manifest.json
```

`run-id` 由 spec hash、source hashes、feature code version、Rust artifact hash 和 seed 共同决定。相同输入必须复用或重现相同结果；时间戳不参与模型内容 hash。

可提交内容只有：

- workflow source、schemas、tests 和 policy；
- 去身份化 aggregate report；
- 经审批的 profile bundle 和 evidence manifest。

原视频、用户逐段标注、canonical sequences 和 per-capture report 保持本地/ignored，除非用户明确批准发布。

## 10. Run result

```ts
interface WorkflowRunResult {
  schemaVersion: "maxpower-motion-profile-workflow-run/v1";
  runId: string;
  status: "inspected" | "candidate_created" | "not_promotable" | "proposal_created" | "failed";
  completedStages: readonly string[];
  sourceSummary: SourceSummary;
  admissionSummary: AdmissionSummary;
  splitSummary: SplitSummary;
  baseline: EvaluationSummary | null;
  candidate: CandidateSummary | null;
  frozenEvaluation: EvaluationSummary | null;
  proposalPath: string | null;
  blockers: readonly WorkflowBlocker[];
  artifactHashes: Readonly<Record<string, string>>;
}
```

这个输出可供 CLI、CI、审核 UI 和 LLM 使用。LLM 可以解释 blockers 和评测变化，不能修改 `status` 或绕过 promotion policy。

## 11. Tests at the Module Interface

### Contract tests

- 同一 spec/source/hash 产生同一 run ID、split lock 和 candidate hash。
- MM-Fit set count 永远不会变成 human rep bounds。
- COCO-mapped unknown joints 保持 unknown。
- 同源视频的所有派生 observation domains 留在同一 split。
- 缺 subject/session 的 self data 无法生成 promotable proposal。
- test/unseen 数据不能出现在 search trace。
- candidate run 不覆盖 `recognition-profiles.json`。
- profile content hash 与 Rust contract 一致。
- rejected/cannot-observe sequences 不被静默删除。

### Golden runs

- 当前 11 段自有数据应产生 `legacy_unpartitioned` blocker，但仍能复现 baseline replay。
- 当前 MM-Fit 616 组应保持官方 split 和 set-count supervision。
- 某个 deliberately corrupted label、wrong pose asset 或 source hash 应在 admission 前失败。
- 加入一组具有 subject/session 的 held-out self data 后，workflow 能进入 frozen evaluation，但只有 promotion policy 通过才生成 proposal。

## 12. What changes from the current scripts

现有命令仍有价值，但要收进一个 Interface：

| Existing path | Workflow role | Required correction |
|---|---|---|
| `train:segmentation` | approved capture adapter + strong-label calibration | 不再直接把结果当 promotion；补 group/split lock |
| `generate:observed-recognition-profiles` | candidate builder | 输出 candidate directory，不直接覆盖 runtime artifact |
| `evaluate:observed-recognition-profiles` | self baseline/frozen replay | 目标 exercise 不再硬编码；区分 train/holdout/challenge |
| `prepare:mmfit` | MM-Fit adapter | pose source/domain 明确；未来加入 exact MediaPipe RGB extraction |
| `train:mmfit-profiles` | weak-label discovery/ranking | research candidate 不能直接发布 |
| `benchmark:mmfit:candidates` | external frozen evaluation | 保留官方 splits，冻结后运行 test/unseen |
| `report:recognition-corpus` | report projection | 移除固定 616/11 假设；按 manifest completeness 和 supervision 分层报告 |

这样做的 Depth 在于：调用者不再手工记住七条命令、产物顺序和哪些输出不能发布；这些规则集中在 `MotionProfileWorkflow` Implementation 中。

## 13. Rollout

### Phase A — Inspect only

- 建 schema、spec parser、source inventory、admission、split lock 和 run manifest。
- 用当前 11 段自有数据与 MM-Fit 跑 golden inspect。
- 不训练、不写 runtime profile。

### Phase B — Candidate mode

- 包装现有 self/MM-Fit trainers 和 Rust replay。
- 生成 immutable candidate 与 frozen evaluation。
- 旧命令保留为内部调试入口，但 CI 只调用新 workflow Interface。

### Phase C — Proposal mode

- 补 subject/session/device metadata 和真正 held-out 自有数据。
- 引入 versioned promotion policy、candidate diff 和人工审批。
- 仍不直接改 Android/Rust；只生成下一版本 SDK spec 可消费的 profile bundle。

### Phase D — Target-domain MM-Fit extraction

- RGB 下载与校验完整后，用 exact MediaPipe model tiers 重提取。
- mapped OpenPose 与 native MediaPipe 作为不同 domain 并行报告。
- 比较外部预训练是否真正改善目标域 holdout，而不是只改善 MM-Fit 自身。

## 14. Acceptance criteria for implementing this workflow

- 一条固定命令可 inventory 当前自有标注和 MM-Fit，并输出完整 blocker report。
- 标准化语料保留 label strength、source topology、split、license/consent 和 immutable hashes。
- 相同 run 可复现；中断后按 stage hash 恢复。
- 当前自有数据不会因“已有 89 个标注 rep”而误获 production promotion。
- MM-Fit 不会因组次数标签而伪造逐 rep phase accuracy。
- candidate 与 published profile 物理隔离。
- 所有 optimization 都有 parent baseline、frozen evaluation 和 search trace。
- 人工审批是唯一 promotion 路径。
- workflow 不修改 Rust ABI、Android client 或 canonical packet。

## 15. Related contracts

- [实时 AI 健身教练 PRD](../../.scratch/realtime-ai-fitness-coach/PRD.md)
- [AI 教练证据、采集、训练与人工标注标准](./ai-coach-evidence-and-training-data-requirements-v0.1.md)
- [训练执行评估标准](./ai-coach-training-execution-assessment-standard-v0.1.md)
- [MM-Fit 相机朝向与 profile 训练报告](../reports/mmfit-camera-view-and-rolling-profile-training-2026-08-09.md)
- [MM-Fit / RepCount-A Rust profile 验证](../reports/mmfit-repcount-rust-profile-validation-2026-08-09.md)
