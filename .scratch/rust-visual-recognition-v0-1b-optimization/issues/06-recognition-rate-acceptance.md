# 06 — 验收 v0.1b 识别率与回归

**What to build:** 完整融合后的 Rust 引擎在冻结协议下输出可审计的识别率与性能验收结果；正式训练量只依据 ConfirmedRep，已知视频回放不被包装为跨用户泛化能力。

**Blocked by:** 05 — 融合动作算法层并输出可归因识别结果.

**Status:** blocked — governed replay acceptance is split to Ticket 08

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

- [ ] 在评测运行前冻结输入哈希、匹配器、action×view context、负窗口、指标定义和门槛；新结果作为不可变分析版本，不覆盖 v0.1 基线。
- [ ] 分别报告 raw proposal、Confirmed-only、Confirmed-plus-NeedsReview 的 Precision/Recall；NeedsReview 不得计入正式次数、训练量或正式识别率改善。
- [ ] 每个 action×view 报告 Rep 计数误差、FP/FN、exact-set rate、start/turnaround/end MAE/P95、interval IoU、负窗口误触发、candidate/admission 迁移和拒绝原因变化。
- [ ] 端上报告分别覆盖 pose input、equipment detection、tracker、local coordinate、fusion 与 Rep 的有效帧率、证据年龄、p50/p95/p99 延迟、drop、内存和热稳态；高 tracker FPS 不得掩盖低 pose/Rep cadence。
- [ ] known-video 数据只用于回归与诊断；只有 participant、source、session、device 和 view 隔离的 held-out 数据可形成正式识别率通过结论。
- [ ] 质量维度没有逐 Rep 人工真值时仅报告覆盖率和 `CannotJudge`，不发布质量准确率或综合正确性分数。

## Blocker and split

The report schema/aggregation implementation is available, but its required
frozen video input may not be consumed: the training-data governance audit
fails because the registered v0.1 baseline report asset is missing. Ticket 08
owns repair of that external governed dependency and the only permitted
numeric v0.1b replay claim. Quality-rule calibration is independently tracked
by Ticket 09.
