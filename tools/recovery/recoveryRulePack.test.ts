import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRecovery } from "../../src/recovery";
import { deriveDailyEvaluation } from "../../src/recovery";

const base = { id: "rc-1", evaluatedAt: "2026-08-08T08:00:00.000+08:00", validUntil: "2026-08-09T08:00:00.000+08:00" };

test("Recovery 单次 wearable 异常、缺失权限或单晚睡差不会硬暂停", () => {
  const wearableOnly = evaluateRecovery({
    ...base,
    checkIn: { hrv: { metric: "rmssd", baselineMature: true, direction: "lower", permission: "granted" } },
  });
  assert.equal(wearableOnly.constraint.level, "normal");
  const missing = evaluateRecovery({
    ...base,
    id: "rc-2",
    checkIn: { sleepDurationHours: 5, hrv: { metric: "sdnn", baselineMature: false, direction: "lower", permission: "denied" } },
  });
  assert.equal(missing.constraint.level, "normal");
  assert.equal(missing.constraint.evaluation?.missingOrStale.includes("hrv_unavailable_or_untrusted"), true);
});

test("主观低恢复与重复表现下降才形成可解释的软降级，红旗才暂停", () => {
  const soft = evaluateRecovery({
    ...base,
    checkIn: { perceivedRecovery: 2, fatigue: 8, comparablePerformanceDeclines: 2 },
    factRefs: ["timeline:checkin", "workout:prior-1", "workout:prior-2"],
  });
  assert.equal(soft.constraint.level, "recovery_priority");
  assert.equal(soft.constraint.evaluation?.confirmationRequired, true);
  assert.equal(soft.explanation.message.includes("生病"), false);
  const hard = evaluateRecovery({
    ...base,
    id: "rc-3",
    checkIn: { pain: { severity: 8, isNewSharp: true, area: "shoulder" } },
  });
  assert.equal(hard.constraint.level, "pause_and_confirm");
  assert.equal(hard.constraint.intentions?.[0]?.kind, "pause");
});

test("DailyEvaluation 只有四种状态，普通恢复波动只影响当日安全边界", () => {
  const decision = evaluateRecovery({
    id: "constraint-daily",
    evaluatedAt: "2026-08-09T08:00:00.000+08:00",
    validUntil: "2026-08-10T08:00:00.000+08:00",
    checkIn: { perceivedRecovery: 2, comparablePerformanceDeclines: 1 },
    factRefs: ["recovery:1"],
  });
  const evaluation = deriveDailyEvaluation({
    id: "daily-1",
    date: "2026-08-09",
    recovery: decision,
    plannedSessionKind: "weighted_reps",
    hasStartedSet: true,
    nextReviewAt: decision.constraint.validUntil,
  });
  assert.equal(evaluation.status, "DAILY_ADJUST");
  assert.equal(evaluation.planBoundary, "next_safety_boundary");
  const phaseReview = deriveDailyEvaluation({
    id: "daily-phase-review",
    date: "2026-08-09",
    recovery: evaluateRecovery({ ...base, id: "phase-review", checkIn: {} }),
    plannedSessionKind: "weighted_reps",
    hasStartedSet: false,
    phaseReviewRequested: true,
    nextReviewAt: base.validUntil,
  });
  assert.equal(phaseReview.status, "REVIEW_PHASE");
  const safetyReview = deriveDailyEvaluation({
    id: "daily-safety",
    date: "2026-08-09",
    recovery: evaluateRecovery({ ...base, id: "safety", checkIn: { pain: { severity: 8, isNewSharp: true, area: "shoulder" } } }),
    plannedSessionKind: "weighted_reps",
    hasStartedSet: false,
    nextReviewAt: base.validUntil,
  });
  assert.equal(safetyReview.status, "SAFETY_PAUSE");
});

test("SDNN 与 RMSSD、不同设备或算法不会被合并为一个恢复分数", () => {
  const sdnn = evaluateRecovery({
    ...base,
    id: "sdnn",
    checkIn: { hrv: { metric: "sdnn", baselineMature: true, direction: "lower", permission: "granted" } },
  });
  const rmssd = evaluateRecovery({
    ...base,
    id: "rmssd",
    checkIn: { hrv: { metric: "rmssd", baselineMature: true, direction: "lower", permission: "granted" } },
  });
  assert.deepEqual(sdnn.constraint.evaluation?.reasonCodes, rmssd.constraint.evaluation?.reasonCodes);
  assert.equal(sdnn.constraint.level, "normal");
  assert.equal(rmssd.constraint.level, "normal");
});
