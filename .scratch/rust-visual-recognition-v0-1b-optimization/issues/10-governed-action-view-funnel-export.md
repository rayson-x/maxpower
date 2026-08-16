# 10 — 冻结评测输出 action×view 漏斗明细

**What to build:** 在已通过训练数据治理审计的冻结回放中，为每个
action×view 产出 raw proposal、Confirmed-only、Confirmed+NeedsReview、Rejected、
原因、candidate↔truth 一对一匹配、FP/FN、边界和负窗口指标；报告生成器只能
消费这一完整结构。

**Blocked by:** None. Ticket 08 restored the governed runtime/input and the
Rust evaluator now authors the funnel rather than expecting it in an older
evaluation artifact.

**Status:** complete — the current evaluator exports and freezes a complete
v2 action×view funnel. Historical v0.1 artifacts without raw-proposal lineage
remain non-comparable at that layer; no fields are reconstructed from them.

## Why this was split

Rust v0.1b 已能保留 plan、模块、Rep disposition 与 incident trace，但已有冻结
evaluation JSON 只有聚合 prediction bucket。直接从该 JSON 猜测 raw proposal、
Confirmed/NeedsReview 分流或 candidate-to-truth 归因会制造数据。报告脚本现已
fail-closed：治理 audit 通过前不读取任何输入；缺少 `recognitionFunnel` 的
action×view row 也拒绝生成输出。

## Acceptance

- [x] 在治理审计通过后，由评测运行器为每个 action×view 写入带 schema/version
  的 `recognitionFunnel`：rawProposal、confirmedOnly、confirmedPlusNeedsReview、
  rejected；四条流分别执行 one-to-one candidate↔truth 匹配、FP/FN、Precision/Recall、
  start/turnaround/end MAE/P95、IoU 与 negativeWindowFalseTriggers。Rejected 流明确标为 diagnostic-only，不能算正式 Rep。
- [x] evaluator/report consumer 验证当前 candidate 的每个 action×view 都有完整
  funnel，且 action roll-up 由 view rows 生成；遗漏字段时 fail closed。旧 baseline
  没有该 schema，不能伪造 migration；下一次 Ticket 15 回放才形成同 schema before/after。
- [x] 产物只写入治理 workspace 的 local-private derived-report 目录，不能提交
  逐 capture、sourceCaptureId、prediction 或原视频派生明细到产品仓库。aggregate、
  report artifact 与 pair manifest 先写入不可见的 immutable version directory，完成
  后再由单一 current pointer 原子切换；读者不会看到新旧混版。
- [x] 冻结 replay 在同一 matcher/input hashes 下重复运行并以完整 report digest
  锁定；报告工具必须用 `--execute-repeat` 自行启动两个独立 release 进程，手工
  提供或复制的 JSON 不能成为 repeat 证据。结果明确标为
  known-video deterministic regression，而不是 held-out 或质量准确率。

## Completion evidence

- Funnel schema: `maxpower.visual-recognition-funnel/v2`.
- Aggregate fields: raw 51 (23 matched, 28 FP, 432 FN; 45.10% Precision,
  5.05% Recall), Confirmed 10 (7 matched, 3 FP, 448 FN; 70.00% Precision,
  1.54% Recall), Confirmed+NeedsReview 17 (11 matched, 6 FP, 444 FN; 64.71%
  Precision, 2.42% Recall), Rejected 34 (12 truth overlaps; diagnostic-only),
  and 5 formal negative-window false triggers.
- Turnaround MAE/P95 are typed null with
  `not_evaluable_no_human_turnaround_truth`; absence is not rendered as zero.
- Product repository stores only the frozen digest and aggregate acceptance;
  the output containing context/candidate rows remains local-private.
- The report consumer issued independent run IDs
  `v0.1b-repeat-1786881288663-decddd14-331a-4769-afe4-854581290e51-a` and
  `v0.1b-repeat-1786881288663-decddd14-331a-4769-afe4-854581290e51-b`, then
  executed them as different processes (98447 / 811) over the same native
  release binary. Both produced semantic report digest
  `8b850852fa6cdba9819349c3fd3dcb64d5401ce96e3eb3f5a96fc260e18b9e6b`
  and prediction digest `5ace589dc61975a71b9737e91957d50ff7185807dea6cbd8c4ab096906479ade`.
  The report consumer itself spawned both release replays, verified the
  complete run semantics and emitted `repeatRunCoreResultMatched=true`.
  The report tool rejects every external JSON path and only consumes the two
  release replay outputs that it spawned inside the canonical governance
  workspace. The aggregate and report artifact are published through an immutable pair manifest plus atomic
  `visual-recognition-v0.1b-current.json` pointer.
- Accepted derived-report pair ID:
  `0298f97a8209263c595f97fc42e43cb977fee2e6fe4ed12121ad779ba51e6c20`;
  its pointer binds manifest SHA-256
  `806941f92fd28fcaf7951798c9a2dff59786ba3f75e38d96853058cfbafdff52`.
