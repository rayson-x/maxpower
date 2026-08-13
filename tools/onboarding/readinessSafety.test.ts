import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let now = "2026-08-14T09:30:00.000+08:00";
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => now,
      nextId: (prefix: string) => `${prefix}-${++sequence}`,
    },
  });
  return { app, ledger, setNow: (value: string) => { now = value; } };
}

async function baseline(app: CoachApplication) {
  const draft = await app.startOrResumeBaselineIntake({ userId: "readiness-user" });
  return app.saveBaselineIntake({
    draftId: draft.id,
    inputMode: "form",
    idempotencyKey: "baseline",
    values: {
      age: { ageYears: 30, observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline" } },
      height: { value: { value: 179, unit: "cm" }, observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline" } },
      currentWeight: { value: { value: 75, unit: "kg" }, observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline" } },
      goalNarrative: { text: "减脂并保持训练", observedAt: "2026-08-14T09:30:00.000+08:00", source: { kind: "form_submission", submissionId: "baseline" } },
    },
  });
}

test("睡眠差且腿部酸痛生成短时 readiness：只限制相关部位与高强度能力，不取消上肢训练", async () => {
  const { app, ledger, setNow } = fixture();
  const draft = await baseline(app);
  await app.submitRecoveryCheckIn({
    userId: "readiness-user",
    idempotencyKey: "poor-sleep-legs",
    occurredAt: "2026-08-14T09:30:00.000+08:00",
    validUntil: "2026-08-15T09:30:00.000+08:00",
    checkIn: { sleepDurationHours: 5, perceivedRecovery: 2, fatigue: 8, soreness: { area: "legs", severity: 7 }, schedule: { availableMinutes: 75 } },
  });

  const assessment = await app.assessOnboardingReadinessAndSafety({
    draftId: draft.id,
    idempotencyKey: "readiness-assessment-1",
  });
  assert.equal(assessment.readiness.status, "active");
  assert.equal(assessment.readiness.affectedAreas.includes("legs"), true);
  assert.equal(assessment.readiness.canTrainUnaffectedAreas, true);
  assert.equal(assessment.readiness.availability?.availableMinutes, 75);
  assert.equal(assessment.capabilities.find((item) => item.action === "high_intensity_cardio")?.status, "limited");
  assert.equal(assessment.capabilities.find((item) => item.action === "training_execution")?.status, "limited");
  assert.equal(assessment.capabilities.find((item) => item.action === "training_execution")?.allowedWith.includes("avoid:legs"), true);
  assert.equal((await app.readDomainProjection({ userId: "readiness-user" })).profile, undefined);
  assert.deepEqual(
    (await app.readDomainProjection({ userId: "readiness-user" })).timeline.current.map((event) => event.fact.kind).sort(),
    ["recovery", "schedule", "sleep", "symptom"],
  );
  assert.equal((await ledger.read()).actionEvents.some((event) => event.intent === "onboarding.readiness_safety.assess"), true);

  setNow("2026-08-15T10:00:00.000+08:00");
  const expired = await app.assessOnboardingReadinessAndSafety({
    draftId: draft.id,
    idempotencyKey: "readiness-assessment-expired",
  });
  assert.equal(expired.readiness.status, "expired");
  assert.equal(expired.readiness.reassessRequired, true);
});

test("未知、明确清楚、明确限制与 stop signal 是不同安全状态，只门控关联能力", async () => {
  const { app } = fixture();
  const draft = await baseline(app);
  const unknown = await app.assessOnboardingReadinessAndSafety({ draftId: draft.id, idempotencyKey: "safety-unknown" });
  assert.equal(unknown.safety.status, "unknown");
  assert.equal(unknown.capabilities.find((item) => item.action === "fasted_cardio")?.status, "limited");
  assert.equal(unknown.capabilities.find((item) => item.action === "reliable_energy_target")?.status, "limited");

  const card = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "safety-card",
    proposal: { topic: "safety_check", fieldIds: ["safety.activity_restrictions"], reasonCode: "safety_gate", requiredFor: "exercise_selection" },
  });
  const clear = await app.submitOnboardingDynamicForm({
    draftId: draft.id,
    cardId: card.cardId,
    expectedDraftRevision: card.draftRevision,
    idempotencyKey: "safety-clear",
    answers: [{ fieldId: "safety.activity_restrictions", state: "captured_explicit", value: ["none_declared"] }],
  });
  const explicitClear = await app.assessOnboardingReadinessAndSafety({ draftId: clear.id, idempotencyKey: "safety-clear-assessment" });
  assert.equal(explicitClear.safety.status, "explicitly_denied");

  const restrictedDraft = await app.captureOnboardingDynamicFields({
    draftId: clear.id,
    expectedDraftRevision: clear.revision,
    inputMode: "conversation",
    idempotencyKey: "safety-restricted",
    captures: [{ fieldId: "safety.activity_restrictions", state: "captured_explicit", value: ["medical_restriction"], observedAt: "2026-08-14T10:00:00.000+08:00", source: { kind: "conversation_message", messageId: "restriction" } }],
  });
  const restricted = await app.assessOnboardingReadinessAndSafety({ draftId: restrictedDraft.id, idempotencyKey: "safety-restricted-assessment" });
  assert.equal(restricted.safety.status, "restricted");
  assert.equal(restricted.capabilities.find((item) => item.action === "training_execution")?.status, "limited");

  const stop = await app.saveOnboardingProgress({
    draftId: restrictedDraft.id,
    inputMode: "conversation",
    idempotencyKey: "safety-stop",
    confirmedSections: [],
    patch: { safety: { stopSignals: ["dizziness_or_fainting"] } },
  });
  const stopped = await app.assessOnboardingReadinessAndSafety({ draftId: stop.id, idempotencyKey: "safety-stop-assessment" });
  assert.equal(stopped.safety.status, "stop_signal");
  assert.equal(stopped.capabilities.find((item) => item.action === "training_execution")?.status, "blocked");
  assert.equal(stopped.capabilities.find((item) => item.action === "reliable_energy_target")?.status, "limited");
});

test("明确回答不知道会保留 explicit unknown，不被当作未回答而反复追问", async () => {
  const { app } = fixture();
  const draft = await baseline(app);
  const card = await app.requestOnboardingDynamicForm({
    draftId: draft.id,
    expectedDraftRevision: draft.revision,
    idempotencyKey: "unknown-safety-card",
    proposal: { topic: "safety_check", fieldIds: ["safety.activity_restrictions"], reasonCode: "safety_gate", requiredFor: "exercise_selection" },
  });
  const skipped = await app.submitOnboardingDynamicForm({
    draftId: draft.id,
    cardId: card.cardId,
    expectedDraftRevision: card.draftRevision,
    idempotencyKey: "unknown-safety-submit",
    answers: [{ fieldId: "safety.activity_restrictions", state: "explicit_unknown" }],
  });
  const assessment = await app.assessOnboardingReadinessAndSafety({ draftId: skipped.id, idempotencyKey: "unknown-safety-assessment" });
  assert.equal(assessment.safety.status, "explicitly_unknown");
  assert.deepEqual(assessment.capabilities.find((item) => item.action === "training_execution")?.factsNeeded, []);
  await assert.rejects(
    app.requestOnboardingDynamicForm({
      draftId: skipped.id,
      expectedDraftRevision: skipped.revision,
      idempotencyKey: "repeat-unknown-safety-card",
      proposal: { topic: "safety_check", fieldIds: ["safety.activity_restrictions"], reasonCode: "safety_gate", requiredFor: "exercise_selection" },
    }),
    { message: /dynamic_form_rejected/ },
  );
});
