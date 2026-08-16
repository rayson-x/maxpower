import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function dateAt(day: number): string { return `2026-08-${String(day).padStart(2, "0")}`; }

test("personal maintenance calibration requires multi-week confirmed intake and comparable body measurements", async () => {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-01T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    mandate: { id: "mandate", mode: "manual", planChangeAuthorization: "always_ask" },
  });

  for (let day = 1; day <= 14; day += 1) {
    const date = dateAt(day);
    await app.confirmMealObservation({
      userId: "u1",
      idempotencyKey: `meal-${day}`,
      observation: { id: `meal-${day}`, occurredAt: `${date}T12:00:00.000+08:00`, mode: "structured", description: "用户填写的当日总摄入", nutrients: [{ nutrientId: "energy", amount: 2400, unit: "kcal", source: { kind: "manual_form", ref: `meal-${day}` } }], provenance: "manual_form", dayCoverage: "complete" },
    });
    if ([1, 7, 14].includes(day)) {
      await app.recordTimelineFact({
        userId: "u1",
        idempotencyKey: `weight-${day}`,
        fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: 75 + (day - 1) * 0.01, unit: "kg" }, condition: "morning" }, confidence: "confirmed" },
        envelope: { time: { startedAt: `${date}T07:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
      });
    }
  }

  const trends = await app.readHealthTrends({ userId: "u1", startDate: "2026-08-01", endDate: "2026-08-14", timezoneOffsetMinutes: 480 });
  assert.equal(trends.daily.length, 14);
  assert.equal(trends.weekly.length, 3);
  assert.equal(trends.calibration.status, "calibrated");
  assert.equal(trends.calibration.evidenceWindow.completeEnergyDays, 14);
  assert.equal(trends.calibration.evidenceWindow.comparableWeightObservations, 3);
  assert.ok(trends.calibration.maintenanceRange);
  assert.equal(trends.daily[0]?.nutrition.nutrients.energy.consumedLogged, 2400);
  assert.equal(trends.daily[0]?.expenditure.total.source, "profile_formula", "a later calibration never rewrites the historical daily result");

  const nextDay = await app.readDailyHealthLedger({ userId: "u1", date: "2026-08-15", timezoneOffsetMinutes: 480 });
  assert.equal(nextDay.expenditure.total.source, "personal_calibration");
  assert.deepEqual(nextDay.expenditure.total.range, trends.calibration.maintenanceRange);
  assert.ok(nextDay.expenditure.total.calibrationVersion);

  const product = await app.readProductProjection({ userId: "u1", date: "2026-08-15", timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: "2026-08-15" });
  assert.equal(product.today.nutrition.healthLedger.expenditure.total.source, "personal_calibration");
});

test("food descriptions and short windows do not calibrate energy", async () => {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({ type: "user.bootstrap", meta: { userId: "u2", actor: { kind: "user", id: "u2" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap-2" }, profile: { id: "profile-2", locale: "zh-CN" }, mandate: { id: "mandate-2", mode: "manual", planChangeAuthorization: "always_ask" } });
  await app.confirmMealObservation({ userId: "u2", idempotencyKey: "description", observation: { id: "description", occurredAt: "2026-08-15T12:00:00.000+08:00", mode: "descriptive", description: "吃了很多", provenance: "current_user_statement" } });
  const trends = await app.readHealthTrends({ userId: "u2", startDate: "2026-08-15", endDate: "2026-08-15", timezoneOffsetMinutes: 480 });
  assert.equal(trends.calibration.status, "insufficient_evidence");
  assert.equal(trends.calibration.evidenceWindow.completeEnergyDays, 0);
  assert.ok(trends.calibration.missing.includes("confirmed_energy_coverage_insufficient"));
});

test("未确认的身体、活动、训练与恢复事实不进入正式 Ledger 或校准", async () => {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({ type: "user.bootstrap", meta: { userId: "u3", actor: { kind: "user", id: "u3" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap-3" }, profile: { id: "profile-3", locale: "zh-CN" }, mandate: { id: "mandate-3", mode: "manual", planChangeAuthorization: "always_ask" } });
  const envelope = { time: { startedAt: "2026-08-15T09:00:00.000+08:00", timezoneOffsetMinutes: 480 }, provenance: { origin: "system" as const, recordingMethod: "system_import" as const, dataStatus: "estimated" as const, confidence: "estimated" as const }, privacyClass: "sensitive" as const, causalRefs: [], evidenceRefs: [], layer: "raw_observation" as const };
  await app.recordTimelineFact({ userId: "u3", idempotencyKey: "estimated-body", fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: 75, unit: "kg" }, condition: "morning" }, confidence: "estimated" }, envelope });
  await app.recordTimelineFact({ userId: "u3", idempotencyKey: "estimated-activity", fact: { kind: "activity", activityType: "walk", duration: { value: 30, unit: "minutes" }, confidence: "estimated" }, envelope });
  await app.recordTimelineFact({ userId: "u3", idempotencyKey: "estimated-training", fact: { kind: "training", reportedSession: { executionStatus: "missed", summary: "没有确认的漏训" }, confidence: "estimated" }, envelope });
  await app.recordTimelineFact({ userId: "u3", idempotencyKey: "estimated-recovery", fact: { kind: "recovery", perceivedRecovery: 1, confidence: "estimated" }, envelope });

  const ledger = await app.readDailyHealthLedger({ userId: "u3", date: "2026-08-15", timezoneOffsetMinutes: 480 });
  assert.equal(ledger.activity.recordedCount, 0);
  assert.equal(ledger.training.recordedCount, 0);
  assert.equal(ledger.body.recordedCount, 0);
  assert.equal(ledger.recovery.recordedCount, 0);
  assert.deepEqual(ledger.coverage, { nutrition: "no_log", activity: "no_log", training: "no_log", body: "no_log", recovery: "no_log" });
  const trends = await app.readHealthTrends({ userId: "u3", startDate: "2026-08-15", endDate: "2026-08-15", timezoneOffsetMinutes: 480 });
  assert.equal(trends.calibration.evidenceWindow.comparableWeightObservations, 0);
});
