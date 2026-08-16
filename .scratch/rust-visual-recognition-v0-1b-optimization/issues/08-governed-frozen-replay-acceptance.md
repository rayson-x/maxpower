# 08 — 恢复受治理的冻结回放并执行 v0.1b 验收

**What to build:** 以不可变、受训练数据治理验证的输入运行 Ticket 06 的识别率验收，输出仅本地保存的 action×view 回归报告。

**Blocked by:** None. The runtime/input governance blocker was resolved; the
numeric recovery revealed by this replay is intentionally split to Ticket 15.

**Status:** complete — governed replay executed from catalog-resolved inputs,
the local-private output is frozen, and the numerical result is explicitly a
failed known-video regression rather than a generalization claim.

## Required recovery

- [x] 治理 catalog 登记 release WASM SHA-256 `2687e7fc5f44e7702c6540c1ccde258b391ae65f3dc56914a210809ce83d6d74`；`npm run audit` 通过 25 个资产。
- [x] replay manifest 解析 `maxpower-motion-sdk-wasm` 的 asset ID、`protected` admission、`application_runtime` authority、`not_applicable` groupKey 与 immutable SHA-256，并验证 `client_runtime_parity` 属于治理 catalog 的 `allowedTasks`；它只被声明为客户端 build parity artifact。实际回放明确记录 native release runner 的二进制 SHA-256、源码集合 SHA-256、crate/version 与 packet 1.11，不再冒充 WASM 执行。
- [x] 原视频逐帧解码并输入器械 Provider 的真实用途登记为 `known_video_runtime_evaluation`，且同时由 catalog、replay manifest 与 video source manifest 准入；不再借用仅供人工失败复盘的 `failure_review`。
- [x] replay 使用的 label、pose、video、exclusion、protocol、runtime 均按 asset ID/admission/authority/groupKey/hash 解析；逐 capture 输出只能写入 canonicalized governance local-private workspace，父目录必须预先存在，绝对/相对路径越界和 symlink escape 均 fail closed。
- [x] v0.1b immutable replay 输出 raw proposal、Confirmed-only、Confirmed+NeedsReview、Rejected/原因、one-to-one FP/FN、边界、IoU 与 negative-window 的 action×view 细目。
- [x] 输出声明 `known_participant_known_video_regression`、`generalizationClaimAllowed=false`，并把 equipment track、turnaround 和 technique quality 标记为没有 human truth、不可评价。

## Expected handoff

Local-private output:
`maxpower-training-data-governance/workspace/visual-recognition-v0.1/repeat-runs/v0.1b-repeat-1786881288663-decddd14-331a-4769-afe4-854581290e51/a.json`.
Its frozen report digest is
`8b850852fa6cdba9819349c3fd3dcb64d5401ce96e3eb3f5a96fc260e18b9e6b`.
The replay reports 64.71% Precision / 2.42% Recall for
Confirmed+NeedsReview and therefore **fails** recognition recovery. Ticket 14
owns held-out/device acceptance; Ticket 15 owns parameter calibration and the
next same-schema recovery replay.

The governed replay is intentionally run with `cargo test --release`; the
debug build executes the same assertions but makes the pixel-level equipment
provider roughly an hour-long local run and is not the acceptance command.
Every published output also requires an explicit immutable run ID; all frozen
assertions and the canonical output boundary pass before an atomic rename
publishes the local-private artifact. The runner never creates an arbitrary
output directory and cannot publish through a symbolic-link escape.
Final consumer-spawned run A/B used distinct run IDs and processes
(98447 / 811) while retaining protocol `d66750af…66b8`, prediction
`5ace589d…9ade`, native runner `b8a274dd…9c00` and source bundle
`d5b595d2…2951`.
