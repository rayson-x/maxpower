# 02 — 完成通用 Rep 识别算法包

**What to build:** 用户所选动作能够由资产选中的通用 Rep 算法形成 candidate、判定证据 disposition，并以因果边界封存唯一 Rep；不同动作使用不同 topology，而不是共享一套固定屏幕方向和周期门槛。

**Blocked by:** 01 — 建立可复用识别算法模块库.

**Status:** complete for the installed action library; deferred topology executors are tracked in Ticket 07

## Audit context and non-negotiable constraints

- The current candidate segmenter is action-independent: it applies one `0.06 / 0.18 / 0.06 / 0.04`, `700 ms`, `350 ms`, `8 s`, `Auto` policy across contexts. With only 194 raw candidates for 455 human Rep, admission-only work cannot exceed 42.64% recall on this candidate set.
- `ActionPrimaryDirectionMismatch` rejected 97 of 163 rejected candidates (59.51%). The current local-cycle validator requires the effort endpoint delta to be positive. Sign-invariant departure-turnaround-return is therefore a P1 repair, but action×view candidate/truth overlap must still confirm its distribution before a numeric gain is claimed.
- The plan must configure candidate generation before the Rep is sealed. A plan hash or post-seal validator alone is not action-driven recognition.
- Weak but bounded evidence may create a candidate; predicted, Unknown, wrist bridge, another subject and unplanned relations may never create a boundary.

## Review remediation — candidate and admission failures

This ticket is the implementation owner for the two highest-signal Rep defects
found in the frozen replay. They are not optional cleanup and must be fixed
before a recognition-rate claim is reconsidered.

- Replace the local-cycle hard check `turn - start > 0` with the topology
  contract: `abs(turn - start) > minimum_excursion`, reversal of the local
  departure and return, and a bounded return error. `sign_invariant` is the
  default. A fixed sign is legal only when the exact action×view asset
  explicitly declares it. Do not silently derive it from screen Y, mirroring,
  the first frame, or an action-name branch.
- Remove the semantic overload of `RequiredJointLoss`. Runtime outcomes must
  distinguish `CoordinateNotFrozen`, `SignalTemporarilyUnavailable`,
  `TransitionEvidenceWeak`, and `IdentityRelationMissing`. A bounded recovery
  across the first three is a traced `NeedsReview` path; an unobserved primary
  identity relation, explicit conflict, or incomplete topology remains
  `Rejected`.
- `RepTopologyProfile` is an exact action×view asset and is consumed by the
  candidate engine *before* sealing. It includes topology, primary relation,
  direction policy, start/excursion/hysteresis/return gates, phase dwell,
  maximum gap and duration. A global `0.06/0.18/0.06/0.04`, `700/350/8000`,
  `Auto` initializer is not an acceptable implementation.

### Completion evidence

- Contract tests cover an axis-sign/mirrored round trip that confirms exactly
  the same Rep under `sign_invariant`, plus a declared fixed-direction context
  that refuses the reversed movement.
- A candidate can carry a bounded coordinate/signal/transition interruption
  into `NeedsReview` with its typed reason; the same test proves it does not
  add to formal ConfirmedRep volume.
- Frozen replay reports proposal, Confirmed-only and
  Confirmed-plus-NeedsReview changes by **action×view**, including FP/FN and
  reviewed-negative-window false triggers. An aggregate reason count alone is
  not evidence that a particular context was repaired. This governed
  evaluator-output acceptance is owned by Ticket 10; the runtime must not
  fabricate the absent human matching evidence.

- [x] 已安装资产选择并运行 bilateral synchronous、independent bilateral、unilateral、alternating、pose-primary；hold interval、locomotion step 与 multi-stage 没有已安装动作语义，已拆至 Ticket 07。
- [x] 往返拓扑使用 action-local departure-turnaround-return 语义：镜像或局部轴反号不改变同一完整动作的结果，真实违反显式起始状态/方向合同的动作不会被确认。
- [x] candidate 只使用当前动作计划授权的 measured relation；predicted、Unknown、另一个主体、手腕桥接或未授权关系不能创建 start、turnaround 或 end。
- [x] 拆分坐标未冻结、临时 signal 不足、转换证据弱、身份关系缺失、连续性中断、周期不完整与冲突等 disposition 原因；Confirmed 是唯一可计入正式训练量的 Rep。
- [x] start、turnaround、end 在固定上限因果缓冲中精修，并分别保留事件时间和确认时间；质量或未来帧不能移动、删除或重写 SealedRep。
- [x] 端到端会话测试覆盖当前已选 topology、完整 candidate、NeedsReview、Rejected、镜像/轴反号、未来截断和正式训练量行为；未选 topology 的验收在 Ticket 07。

## Completion evidence

The candidate engine consumes the exact action×view `RepTopologyProfile` before
sealing: amplitude, hysteresis, return, gap, duration and phase dwell no
longer fall back to one global initializer. A dynamic dwell state graph proves
a rapid round trip is not formal volume, while a sign-invariant contract accepts
the mirrored equivalent cycle. Ticket 10 separately verifies the numerical
action×view replay outcome against governed human truth.
