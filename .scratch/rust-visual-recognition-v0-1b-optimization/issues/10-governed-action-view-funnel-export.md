# 10 — 冻结评测输出 action×view 漏斗明细

**What to build:** 在已通过训练数据治理审计的冻结回放中，为每个
action×view 产出 raw proposal、Confirmed-only、Confirmed+NeedsReview、Rejected、
原因、candidate↔truth 一对一匹配、FP/FN、边界和负窗口指标；报告生成器只能
消费这一完整结构。

**Blocked by:** 08 — 治理审计与冻结输入恢复；以及当前
`maxpower.visual-recognition-known-video-evaluation/v0.1` 输入不含该漏斗字段。

**Status:** blocked — upstream governed evaluator/output schema is absent; this is a dependency split, not an SDK implementation failure.

## Why this was split

Rust v0.1b 已能保留 plan、模块、Rep disposition 与 incident trace，但已有冻结
evaluation JSON 只有聚合 prediction bucket。直接从该 JSON 猜测 raw proposal、
Confirmed/NeedsReview 分流或 candidate-to-truth 归因会制造数据。报告脚本现已
fail-closed：治理 audit 通过前不读取任何输入；缺少 `recognitionFunnel` 的
action×view row 也拒绝生成输出。

## Acceptance

- [ ] 在治理审计通过后，由评测运行器为每个 action×view 写入带 schema/version
  的 `recognitionFunnel`：rawProposal、confirmedOnly、confirmedPlusNeedsReview、
  rejected、typed rejection reasons、one-to-one candidateTruthMatches、FP/FN、
  start/turnaround/end MAE/P95、IoU 与 negativeWindowFalseTriggers。
- [ ] report generator 验证 baseline 与 candidate 的每个 action×view 都有完整
  funnel，且 action roll-up 可由 view rows 复算；遗漏或不可对齐时 fail closed。
- [ ] 产物只写入治理 workspace 的 local-private derived-report 目录，不能提交
  逐 capture、sourceCaptureId、prediction 或原视频派生明细到产品仓库。
- [ ] 冻结 replay 在同一 matcher/input hashes 下重复运行；结果明确标为
  known-video deterministic regression，而不是 held-out 或质量准确率。
