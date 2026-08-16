# Handoff: 统一消费自有标注与 MM-Fit，训练 motion profile candidates

**Owner:** 接手的数据训练 agent  
**Working directory:** `/Users/Ruihan/Documents/power/maxpower`  
**Date:** 2026-08-09  
**Task type:** 数据 workflow 实现 + candidate 训练 + 冻结评测；不做 production promotion

## Mission

实现并运行 `MotionProfileWorkflow` 的最小可执行版本，统一消费 MaxPower 当前已标记的自有 capture 与 MM-Fit 当前已规范化的 pose/label 数据，输出标准化 corpus、admission/split blockers、baseline、profile candidates 和 frozen evaluation。所有候选保持 research/provisional，不覆盖 Android/Rust 当前使用的 profile。

## Definition of done

本 handoff 完成时必须同时满足：

- 一条固定命令可以运行 `inspect`，同一 Module Interface 可以运行 `candidate`。
- 自有 11 段/89 rep 与 MM-Fit 616 set/6,160 rep 全部进入 inventory；任何数量差异都有 source-level 原因。
- 自有人工逐 rep 标签与 MM-Fit 组级弱标签保持不同 supervision granularity。
- 自有数据因缺少 subject/session group keys 被标记 `legacy_unpartitioned`，本轮不生成 promotable proposal。
- baseline 与 candidate 使用同一个 Rust canonical replay；self per-rep 与 MM-Fit set-count 分开报告。
- candidates 写入 git-ignored workflow run 目录，不覆盖 `public/archives/confirmed-captures/recognition-profiles.json`。
- 新增/修改代码有 Interface-level tests；相关现有测试通过。
- 最终提交 Markdown + JSON run report，列出改善、退化、无法评测项、泄漏检查和下一批采集需求。

“训练命令成功”不是完成；上述每条都有可检查产物才算完成。

## Read first

按顺序完整阅读：

1. [`AGENTS.md`](../../AGENTS.md)
2. [`CONTEXT.md`](../../CONTEXT.md)
3. [固定 workflow 设计](../../docs/design/motion-profile-data-consumption-workflow-v0.1.md)
4. [证据、采集、训练与标注标准](../../docs/design/ai-coach-evidence-and-training-data-requirements-v0.1.md)
5. [实时 AI 健身教练 PRD](./PRD.md)
6. [MM-Fit 训练现状报告](../../docs/reports/mmfit-camera-view-and-rolling-profile-training-2026-08-09.md)
7. [MM-Fit / RepCount-A Rust 验证](../../docs/reports/mmfit-repcount-rust-profile-validation-2026-08-09.md)

完成标准：能说明 `recognition profile` 与 `standard-form/coaching profile` 的差别，以及 MM-Fit 为什么不能提供逐 rep phase truth。

## Current ground truth

### Self-labelled corpus

Sources:

- `data/training/approved-segmentation-v1.json`
- `/Users/Ruihan/Documents/power/field-capture-approvals-2026-08-08.json`
- `public/archives/confirmed-captures/`
- approval export SHA-256: `3a5c1baecbed8e813f2f5d0166ab999dfb4b902073fe78b701759fa6789afdf4`

Expected inventory:

| Item | Expected |
|---|---:|
| Captures | 11 |
| Human rep boundaries | 89 |
| Evaluation captures | 11 |
| Tuning-eligible captures | 4 |
| Challenge captures | 7 |
| Barbell bench press | 6 captures |
| Machine chest press | 4 captures |
| Push-up | 1 capture |
| Structured subject/session keys | 0 |

Current parent replay in `docs/reports/observed-profile-replay-2026-08-08.json`:

- 8/11 captures have a replayable exact-context profile; 3 front bench captures are unavailable.
- Among 73 evaluated truth reps: 79 predicted, 60 peak-matched.
- In-sample matched precision 75.95%, recall 82.19%.
- Only 1/8 evaluated captures has exact count.

These are compatibility results, not production accuracy. Preserve them as the parent baseline; do not replace them with an earlier/staler 9/11 or 84/89 narrative.

### MM-Fit corpus

Sources:

- `data/external/mm-fit/pose-labels/`
- `data/external/mm-fit/normalized/`
- `data/external/mm-fit/normalized/manifest.json`

Expected inventory:

| Item | Expected |
|---|---:|
| Workout sessions | 21 |
| Labeled sets | 616 |
| Set-level repetitions | 6,160 |
| Actions | 10 |
| Label granularity | set start/end + total count |
| Current pose domain | OpenPose/COCO exact joints mapped to BlazePose33 slots |

Current parent candidate report in `docs/reports/mmfit-candidate-profile-benchmark-2026-08-09.json`:

- 428/616 exact-set = 69.48%.
- 5,563 predicted vs 6,160 truth reps.
- MAE 1.0146; off-by-one-or-better 84.90%.

RGB is incomplete: `data/external/mm-fit/rgb/` is about 101 MB and contains `.part` files. Do not start or resume the 39 GB download in this task. Use `mmfit_openpose18_mapped` and report exact MediaPipe RGB extraction as pending.

Completion criterion: inventory reproduces these facts or explains every discrepancy with source IDs and hashes.

## Scope and ownership

### You may change

- `tools/motion-profile-workflow/**` — preferred new Module location.
- `tools/external-fitness-data/**` — only to expose reusable functions or remove hardcoded paths/counts.
- `tools/recognition-profile/**` — only to inject candidate destinations and evaluate declared buckets.
- `src/pose/**` data contracts when required by canonical training sequences; preserve runtime semantics.
- `package.json` scripts for the single workflow entry.
- tests and generated aggregate reports.

### Preserve

- User video, approval exports, pose sidecars and existing annotations.
- Existing profile artifacts unless a later explicit approval task authorizes a new version.
- Dirty-worktree changes outside this task.
- Rust canonical counter, phase/disposition enums and MotionPacket contracts.

### Out of scope

- Android/Kotlin/Expo camera code.
- Rust SDK, C ABI, JNI or MotionPacket changes.
- MediaPipe model-tier selection.
- Coaching-quality thresholds, muscle/stimulus inference or LLM prompts.
- Remaining MM-Fit RGB download.
- Production profile promotion.
- Git commit, push or PR unless separately requested.

## Execution sequence

### Step 1 — Audit before editing

Run read-only checks:

```bash
git status --short
jq '.records | length' data/training/approved-segmentation-v1.json
jq '.summary' docs/reports/observed-profile-replay-2026-08-08.json
jq '.summary' docs/reports/mmfit-candidate-profile-benchmark-2026-08-09.json
npm run test:external-fitness-data
```

Inspect the implementations referenced in the workflow design instead of rewriting them from scratch. Record which files already contain unrelated changes.

Completion criterion: baseline tests and counts are captured before editing; pre-existing failures are separated from task regressions.

### Step 2 — Implement the deep Module

Create `MotionProfileWorkflow` with the Interface defined in the workflow design:

- `plan(spec) -> WorkflowPlan`
- `run(spec) -> WorkflowRunResult`

Expose one CLI through `npm run workflow:motion-profile`. Source adapters and stage implementations remain internal. Required modes are `inspect` and `candidate`; `proposal` may return `not_promotable`. Explicit publish is not part of this task.

Completion criterion: a test caller runs both modes through the same Interface without knowing source-specific commands.

### Step 3 — Standardize source outputs

Implement `CanonicalTrainingSequence` and both adapters.

Self adapter preserves human rep boundaries/notes, approval status, negative windows, pose model provenance, exact exercise/view and missing subject/session keys.

MM-Fit adapter preserves official split and subject/session identity, `set_count` supervision, `cameraView=unknown`, `poseDomain=mmfit_openpose18_mapped` and unknown landmarks without synthesis.

Completion criterion: tests prove no MM-Fit sequence contains human/per-rep labels and no mapped missing joint becomes visible.

### Step 4 — Implement admission and split lock

Admission assigns allowed uses per sequence. Required current outcomes:

- self: compatibility replay/candidate discovery; `legacy_unpartitioned` blocks production promotion;
- MM-Fit train: weak candidate discovery/ranking;
- MM-Fit validation/test/unseen: frozen evaluation only;
- front bench with wrist/elbow gaps: challenge/unobservable for the affected signal;
- incomplete RGB: pending observation domain, not a blocker for mapped-pose inspect.

Completion criterion: `admission.json` and `split-lock.json` enumerate every source sequence exactly once with a stable disposition.

### Step 5 — Protect artifacts before training

Refactor candidate generation so destination is injected and always falls under:

```text
data/workflows/motion-profile/<workflow-id>/<run-id>/candidates/
```

Treat `public/archives/confirmed-captures/recognition-profiles.json` as read-only.

Completion criterion: a regression test seeds a sentinel runtime artifact, runs candidate mode, and confirms its bytes/hash are unchanged.

### Step 6 — Produce parent baseline

Replay current profiles through the same Rust WASM path later used for candidates. Write separate self per-rep and MM-Fit set-count metrics, including unavailable/cannot-observe counts and all profile/runtime/source hashes.

Completion criterion: baseline reproduces the current metrics above within deterministic rounding, or documents an intentional behavior change.

### Step 7 — Train candidates

Use only admitted training evidence:

- strong self train evidence may fit profile thresholds;
- MM-Fit train set-count may rank candidates or contribute weak count-consistency supervision;
- validation may select a frozen candidate;
- test/unseen/challenge cannot alter parameters.

Generate candidates for every bucket with sufficient declared evidence. For the rest, output `insufficient_evidence` instead of loosening gates. `research_candidate` or `not_promotable` is an acceptable current result.

Completion criterion: every searched parameter is in a search trace, each selected candidate names its training sequence IDs, and no test/unseen sequence appears in that trace.

### Step 8 — Frozen evaluation

Evaluate each frozen candidate against its parent on:

1. self available captures by bucket/challenge;
2. reviewed negative windows;
3. MM-Fit validation;
4. MM-Fit test;
5. MM-Fit unseen_test;
6. observation domain.

Report exact-set ratio, MAE, completed-rep precision/recall and boundary error where truth exists, negative-window false positives, coverage/rejection and parent-to-candidate delta. Use `not_applicable` for unavailable truth.

Completion criterion: `frozen-evaluation.json` contains all applicable metrics and exposes every regression.

### Step 9 — Report and stop

Write run artifacts under:

```text
data/workflows/motion-profile/<workflow-id>/<run-id>/
```

Required files:

- `run-manifest.json`
- `inventory.json`
- `admission.json`
- `split-lock.json`
- `baseline-evaluation.json`
- `frozen-evaluation.json`
- candidate bundle/search trace

Also write aggregate reports:

- `docs/reports/motion-profile-workflow-2026-08-09.md`
- `docs/reports/motion-profile-workflow-2026-08-09.json`

The report leads with whether metrics improved, whether evidence is independent or legacy/in-sample, why promotion is blocked, which exact action/view/domain needs data, modified source files and tests.

For the current corpus, promotion remains blocked unless genuinely new, correctly grouped held-out self data is discovered. Preserve negative results instead of weakening the gate.

Completion criterion: report claims trace to JSON fields/source hashes and the runtime profile artifact remains unchanged.

## Required tests

At minimum cover:

1. deterministic run ID and split lock;
2. self vs MM-Fit supervision separation;
3. unknown landmark preservation;
4. `legacy_unpartitioned` promotion blocker;
5. train/validation/test leakage rejection;
6. candidate destination isolation;
7. self 11/89 golden inventory;
8. MM-Fit 616/6,160 golden inventory;
9. failed/incomplete run still writes blockers/status;
10. parent and candidate use the same replay Interface.

Run narrow tests first, then relevant existing suites. Report exact commands and pass/fail counts.

## Stop conditions

Stop and ask the user if:

- the task requires the remaining MM-Fit RGB download;
- license/consent metadata is missing for data entering training;
- a required fix changes Rust ABI, MotionPacket or Android code;
- dirty changes overlap the same lines and cannot be preserved;
- raw user video/private annotations would need to be committed or uploaded;
- production promotion is the only way to continue.

An algorithm that fails to improve is not a blocker: preserve the result, explain it, and finish the report.

## Final response format

Return:

1. workflow implementation outcome;
2. candidate vs parent metrics by source;
3. promotion status and blockers;
4. files changed;
5. tests run;
6. exact next data to collect.

Do not call in-sample replay “accuracy” and do not merge MM-Fit set-count metrics with self per-rep metrics into one percentage.
