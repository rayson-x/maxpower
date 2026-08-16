import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), {
    now: () => "2026-08-08T12:10:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return app;
}

async function bootstrap(app: LocalProductKernel) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1", occurredAt: "2026-08-08T00:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile-1", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal-1", primaryGoal: "fat_loss_preserve_lean_mass", horizon: { startDate: "2026-08-01", endDate: "2026-12-08" } },
    mandate: { id: "mandate-1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}

test("Coach text creates an explicit shared form and writes nothing before user confirmation", async () => {
  const app = fixture();
  await bootstrap(app);
  const observation = {
    id: "meal-1",
    occurredAt: "2026-08-08T12:00:00.000+08:00",
    mode: "descriptive" as const,
    description: "一碗鸡肉饭",
    foods: [{ id: "food-1", name: "鸡肉饭", portion: "一碗" }],
    provenance: "current_user_statement" as const,
  };
  const draft = await app.createNutritionObservationDraft({ userId: "u1", idempotencyKey: "draft-1", observation });
  assert.equal(draft.draft.clarificationRequired, true);
  assert.deepEqual(draft.draft.missing, ["nutrient_values_not_provided"]);
  assert.equal((await app.readDomainProjection({ userId: "u1" })).timeline.events.length, 0);

  await app.confirmNutritionObservationDraft({ userId: "u1", artifactId: draft.id, idempotencyKey: "confirm-1", observation });
  const fact = (await app.readDomainProjection({ userId: "u1" })).timeline.current[0]?.fact;
  assert.equal(fact?.kind, "nutrition");
  assert.equal(fact?.kind === "nutrition" && fact.observationMode, "descriptive");
  assert.equal(fact?.kind === "nutrition" && fact.nutrients, undefined);
});

test("confirmed values keep field source and rejection never writes Timeline", async () => {
  const app = fixture();
  await bootstrap(app);
  const observation = {
    id: "meal-2",
    occurredAt: "2026-08-08T13:00:00.000+08:00",
    mode: "structured" as const,
    description: "手工标签",
    nutrients: [{ nutrientId: "energy" as const, amount: 480, unit: "kcal" as const, source: { kind: "manually_transcribed_label" as const, ref: "turn-2" } }],
    provenance: "manually_transcribed_label" as const,
  };
  const draft = await app.createNutritionObservationDraft({ userId: "u1", idempotencyKey: "draft-2", observation });
  await app.rejectNutritionObservationDraft({ userId: "u1", artifactId: draft.id, idempotencyKey: "reject-2" });
  assert.equal((await app.readDomainProjection({ userId: "u1" })).timeline.events.length, 0);
});

test("draft ownership is enforced", async () => {
  const app = fixture();
  await bootstrap(app);
  const draft = await app.createNutritionObservationDraft({ userId: "u1", idempotencyKey: "draft-3", observation: { id: "meal-3", occurredAt: "2026-08-08T14:00:00.000+08:00", mode: "descriptive", description: "午餐", provenance: "manual_form" } });
  assert.equal((await app.readNutritionObservationDraft({ userId: "u1", artifactId: draft.id })).id, draft.id);
  await assert.rejects(app.readNutritionObservationDraft({ userId: "u2", artifactId: draft.id }), /nutrition_draft_not_found/);
});
