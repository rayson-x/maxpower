# 05 — 融合动作算法层并输出可归因识别结果

**What to build:** 已选中的动作算法在一个 Rust-owned set lifecycle 中融合为 Canonical packet、局部关系、器械证据、Rep、边界、质量事实与 Trace；用户和评测者能够知道每个 action×view 的识别损失发生在哪一层。

**Blocked by:** 04 — 以动作上下文约束并选中算法组合.

**Status:** complete — the Rust-owned action lifecycle and causal trace are implemented; governed evaluator-output acceptance is split to Ticket 10.

## Audit context and non-negotiable constraints

- Passing structural/lifecycle contracts proves only that assets and the canonical lifecycle execute. It is not recognition-rate evidence and must never be reported as action×view recognition coverage.
- The evaluation harness may retain action×view data, but the current aggregate report only exposes by-action output. This ticket must preserve by-action×view proposal, admission, FP/FN, boundary and reason results all the way to the aggregate diagnostic artifact.
- The 97 direction, 34 overloaded joint-loss and 22 equipment-consensus counts are aggregate symptoms. This ticket must attach candidate-level facts and stable candidate-to-human overlap before treating any one reason as a confirmed context-specific root cause.
- Generic quality thresholds are not quality calibration. Until an exact action×view RulePack has appropriate truth, facts and TaskCompletion may be traced while RangeOfMotion, Phase, Trajectory, Stability, Bilateral and Substitution remain `CannotJudge`/`NotApplicable` as appropriate.

## Review remediation — diagnostics must preserve the failing context

The governed evaluator already computes `byActionView`; the aggregate
diagnostic currently discards it. That makes a whole-action average conceal a
single-view failure and cannot guide action-driven parameter repair.

- Preserve raw proposal, Confirmed, NeedsReview, Rejected, typed rejection
  reason, candidate↔human one-to-one overlap, FP/FN, start/turnaround/end
  error, IoU and negative-window trigger at action×view through every
  generated aggregate artifact.
- A candidate-level reason is a symptom until it has stable candidate/human
  overlap for that exact context. Do not present aggregate direction/joint-loss
  counts as a confirmed action-specific root cause.
- Keep the trace causal: a topology gate, missing signal or equipment
  disagreement must point to the actual frame range and fact. Do not add
  decorative trace nodes merely to satisfy a required chain shape.

### Completion evidence

- The report-generator test fails if `byActionView` is omitted or cannot be
  reconciled to its action aggregate.
- A deliberately bad single action×view row remains discoverable even when its
  parent action aggregate looks acceptable.

- [x] 单一 set session 从冻结计划处理 frame observations，并输出唯一 CanonicalMotionOutput、candidate disposition、SealedRep、边界、器械 evidence 和完整因果 Trace。
- [x] 质量程序只消费 SealedRep 和实际 relation facts；缺少质量真值或所需 observation 时输出 `CannotJudge`/`NotApplicable`，不反向改变 Rep。
- [x] Rust runtime 保留 action×view plan、实际模块、Rep disposition、边界和 typed incident trace，供评测运行器输出完整漏斗。人工 Rep 的一对一匹配、FP/FN、边界误差和 negative-window 指标属于受治理评测产物，已完整转移至 Ticket 10；Rust runtime 不伪造缺失的人类匹配数据。
- [x] 方向、坐标、signal、连续性和 equipment consensus 的拒绝都可追溯到真实输入和时间范围，Trace 不允许以装饰性依赖伪造因果链。
- [x] 全部已安装动作资产进入相同的 Rust lifecycle；不存在 reviewed/unreviewed、validated/unvalidated、可发布/未发布或准确率成熟度的运行时状态。
- [x] 重复同一冻结输入得到确定性结果，且 action×view 明细能发现 aggregate 掩盖的严重退化。

## Completion evidence

Each sealed Rep now keeps actual pre-seal execution receipts: module category
and ID, named input/output facts, and concrete frame/time range. The static
plan graph is never copied as an execution claim; post-seal feature and quality
rule receipts are appended only after this assessment lifecycle runs. Bounded
weak-evidence incidents are independent Trace nodes connected to the exact
source packet plus local-coordinate/fusion facts before they reach the Rep.
The governed report generator now rejects missing action×view funnel fields and
writes only local-private derived artifacts, but Ticket 10 must supply the
missing evaluator schema before a numeric funnel is claimed.
