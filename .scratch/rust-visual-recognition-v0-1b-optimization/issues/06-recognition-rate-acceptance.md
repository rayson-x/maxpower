# 06 — 验收 v0.1b 识别率与回归

**What to build:** 完整融合后的 Rust 引擎在冻结协议下输出可审计的识别率与性能验收结果；正式训练量只依据 ConfirmedRep，已知视频回放不被包装为跨用户泛化能力。

**Blocked by:** 05 — 融合动作算法层并输出可归因识别结果.

**Status:** complete — the governed known-video acceptance was executed and
frozen. The acceptance result is **numerically failed**, not a claim that
recognition was repaired: Confirmed+NeedsReview recall is 2.42%. Asset
calibration/recovery is split to Ticket 15; held-out/device and quality
accuracy remain Tickets 14 and 13.

## Audit context and non-negotiable constraints

- The frozen diagnostic baseline is 51.61% admitted-prediction Precision, 3.52% admitted-prediction Recall, 16 matched Rep of 455, and zero exact-count sets. The preceding threshold fix added one matched Rep without adding a false positive; it did not restore usable recognition.
- `Confirmed + NeedsReview` is a diagnostic measure only. Formal Rep count, training volume and formal recognition-rate claims use ConfirmedRep only; NeedsReview movement must be reported separately rather than treated as a gain.
- The known-video corpus is a deterministic regression/diagnostic cohort, not a held-out generalization cohort. It can establish whether a change regresses, but cannot establish that v0.1b works for new users, devices or views.
- Quality accuracy remains not evaluable until per-Rep, per-dimension human truth exists. This acceptance ticket may report quality coverage and `CannotJudge` rate, never an unearned quality-correctness score.

## Review remediation — acceptance is not structural compilation

The earlier 1,984 action×view compilation count confirms package shape only.
It is not a recognition-coverage or accuracy result. Every result produced
after Ticket 02–05 must retain this distinction explicitly.

- Compare each isolated algorithm/asset change with the frozen baseline using
  action×view proposal and admission migration. A gain in `NeedsReview` is not
  a formal Rep gain; only ConfirmedRep changes formal volume/count metrics.
- Do not promise a numeric recall increase from the sign or admission repair.
  The 97 direction outcomes are a high-priority hypothesis; candidate-to-truth
  overlap determines whether the repair improved that context.
- Quality output must remain facts, TaskCompletion, `CannotJudge` or
  `NotApplicable` until an exact action×view RulePack has appropriate human
  quality truth. Reusing the prototype 0.20/0.15 thresholds cannot justify
  `ObservedAcceptable` or `ObservedDeviation` across the catalog.

### Completion evidence

- The final immutable evaluation includes `byActionView`, Confirmed-only,
  Confirmed-plus-NeedsReview and raw-proposal metrics, boundary metrics and
  negative-window false triggers.
- The report labels the known-video corpus as deterministic regression only;
  no cross-user/device/view generalization or quality-accuracy pass claim is
  emitted.

- [x] 在评测运行前冻结输入哈希、匹配器、action×view context、负窗口、指标定义和门槛；新结果作为不可变分析版本，不覆盖 v0.1 基线。
- [x] 分别报告 raw proposal、Confirmed-only、Confirmed-plus-NeedsReview 与 Rejected diagnostic；NeedsReview/Rejected 不计入正式次数或训练量。四条流各自进行 one-to-one 人工区间匹配，Rejected overlap 只诊断“候选已形成但被准入拒绝”，不能伪装成正式识别率。
- [x] 每个 action×view 报告 Rep 计数、FP/FN、exact-set rate、start/end MAE/P95、interval IoU、负窗口误触发和 typed rejection；没有人工 turnaround truth 时该字段固定为不可评价。历史 v0.1 没有同 schema raw funnel，不能伪造逐层 migration；新的校准前后同 schema 对比归 Ticket 15。
- [x] 当前回放报告 pose input、equipment detection/tracker、local coordinate、fusion 与 Rep 的实际 cadence/覆盖；移动设备 p50/p95/p99、drop、内存和热稳态因缺设备证据已集中移至 Ticket 14。
- [x] known-video 数据只用于回归与诊断；正式 held-out 结论已集中移至 Ticket 14。
- [x] 质量维度只报告 coverage 和 `CannotJudge`；数值质量校准/准确率已集中移至 Ticket 13。

## Frozen result and split

- Actual replay executor: native release test runner; its binary SHA-256 and
  deterministic Rust source-bundle SHA-256 are both included in the frozen report.
- Attested client WASM artifact SHA-256: `2687e7fc5f44e7702c6540c1ccde258b391ae65f3dc56914a210809ce83d6d74`.
  It is a protected client-build parity artifact, not a false claim that the
  governed replay executed through WebAssembly.
- Local-private semantic report digest: `8b850852fa6cdba9819349c3fd3dcb64d5401ce96e3eb3f5a96fc260e18b9e6b`.
- 53 evaluated records, 455 truth Rep, 51 raw proposals, 10 Confirmed, 7 NeedsReview, 34 Rejected.
- Raw proposal stream: 51 predictions, 23 matches, 28 FP, 432 FN; Precision 45.10%, Recall 5.05%.
- Confirmed+NeedsReview: 17 predictions, 11 matches, 6 FP, 444 FN; Precision 64.71%, Recall 2.42%; exact-set rate 0%.
- Boundary evidence: start MAE 1047.5 ms, end MAE 669.4 ms, mean interval IoU 0.490; 2/455 strict boundary matches; 5 reviewed-negative-window triggers.
- Quality, equipment-track accuracy and turnaround accuracy remain explicitly not evaluable because their human truth is absent.

The architecture and evaluation tickets are complete, but the numerical gate
failed. Raw candidate count fell from the earlier diagnostic 194 to 51, so the
remaining bottleneck is action×view local-coordinate/topology calibration, not
permission to loosen formal-volume admission. Ticket 15 owns that recovery
using a distinct calibration/evaluation split; the current 53-record cohort
must not be repeatedly tuned and then presented as an unbiased result.
