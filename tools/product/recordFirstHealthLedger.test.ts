import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

const USER_ID = "record-first-user";
const DATE = "2026-08-15";

function fixture() {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), {
    now: () => `${DATE}T20:00:00.000+08:00`,
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return app;
}

async function bootstrap(app: LocalProductKernel) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: USER_ID,
      actor: { kind: "user", id: USER_ID },
      deviceId: "phone-1",
      occurredAt: `${DATE}T08:00:00.000+08:00`,
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: {
      id: "profile-1",
      locale: "zh-CN",
      dailyActivityLevel: "lightly_active",
      demographics: {
        ageYears: 30,
        sex: "male",
        height: { value: 175, unit: "cm" },
        currentWeight: { value: 75, unit: "kg" },
      },
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "hypertrophy",
      horizon: { startDate: DATE, endDate: "2026-12-15" },
      status: "active",
    },
    mandate: { id: "mandate-1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}

test("描述性饮食正常进入 Timeline，但没有明确营养数值时 Ledger 保持 partial/unknown", async () => {
  const app = fixture();
  await bootstrap(app);

  await app.confirmMealObservation({
    userId: USER_ID,
    idempotencyKey: "descriptive-meal",
    observation: {
      id: "meal-1",
      occurredAt: `${DATE}T12:00:00.000+08:00`,
      mode: "descriptive",
      description: "一碗牛肉面",
      foods: [{ id: "food-1", name: "牛肉面", portion: "一碗" }],
      provenance: "current_user_statement",
    },
  });

  const ledger = await app.readDailyHealthLedger({
    userId: USER_ID,
    date: DATE,
    timezoneOffsetMinutes: 480,
  });

  assert.equal(ledger.nutrition.coverage, "partial");
  assert.equal(ledger.nutrition.nutrients.energy.intakeKnown, false);
  assert.equal(ledger.nutrition.nutrients.energy.consumedLogged, 0);
  assert.ok(ledger.nutrition.nutrients.energy.missing.includes("nutrient_not_provided"));
  assert.equal(ledger.energyBalance.status, "partial");
  assert.equal(ledger.energyBalance.range, undefined);
});

test("手工转录标签的宏量和微量营养素使用字段级来源汇总", async () => {
  const app = fixture();
  await bootstrap(app);

  await app.executeDomainCommand({
    type: "nutrition_strategy.revise",
    meta: {
      userId: USER_ID,
      actor: { kind: "user", id: USER_ID },
      deviceId: "phone-1",
      occurredAt: `${DATE}T08:05:00.000+08:00`,
      timezoneOffsetMinutes: 480,
      idempotencyKey: "nutrition-targets",
    },
    nutritionStrategyId: "nutrition-1",
    expectedRevision: 0,
    nutritionStrategy: {
      id: "nutrition-1",
      goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
      status: "active",
      nutrientTargets: {
        fiber: { unit: "g", minimum: 25 },
        sodium: { unit: "mg", maximum: 700 },
        potassium: { unit: "mg", minimum: 3_500 },
      },
    },
  });

  await app.confirmMealObservation({
    userId: USER_ID,
    idempotencyKey: "label-meal",
    observation: {
      id: "meal-2",
      occurredAt: `${DATE}T08:30:00.000+08:00`,
      mode: "structured",
      description: "手工填写包装标签",
      foods: [{ id: "food-2", name: "用户填写食品", portion: "1 份" }],
      nutrients: [
        { nutrientId: "energy", amount: 420, unit: "kcal", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
        { nutrientId: "protein", amount: 28, unit: "g", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
        { nutrientId: "carbohydrate", amount: 52, unit: "g", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
        { nutrientId: "fat", amount: 11, unit: "g", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
        { nutrientId: "fiber", amount: 8, unit: "g", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
        { nutrientId: "sodium", amount: 760, unit: "mg", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
        { nutrientId: "potassium", amount: 510, unit: "mg", source: { kind: "manually_transcribed_label", ref: "form:label-meal" } },
      ],
      provenance: "manually_transcribed_label",
      dayCoverage: "complete",
    },
  });

  const ledger = await app.readDailyHealthLedger({ userId: USER_ID, date: DATE, timezoneOffsetMinutes: 480 });

  assert.equal(ledger.nutrition.coverage, "logged");
  assert.equal(ledger.nutrition.nutrients.energy.consumedLogged, 420);
  assert.equal(ledger.nutrition.nutrients.protein.consumedLogged, 28);
  assert.equal(ledger.nutrition.nutrients.fiber.consumedLogged, 8);
  assert.equal(ledger.nutrition.nutrients.sodium.consumedLogged, 760);
  assert.equal(ledger.nutrition.nutrients.potassium.consumedLogged, 510);
  assert.equal(ledger.nutrition.nutrients.fiber.minimum, 25);
  assert.equal(ledger.nutrition.nutrients.fiber.remainingAgainstLogged, 17);
  assert.equal(ledger.nutrition.nutrients.sodium.maximum, 700);
  assert.equal(ledger.nutrition.nutrients.sodium.overage, 60);
  assert.equal(ledger.nutrition.nutrients.potassium.minimum, 3_500);
  assert.equal(ledger.nutrition.nutrients.potassium.remainingAgainstLogged, 2_990);
  assert.deepEqual(ledger.nutrition.meals[0]?.nutrients?.find((value) => value.nutrientId === "sodium")?.source, {
    kind: "manually_transcribed_label",
    ref: "form:label-meal",
  });
  assert.equal(ledger.energyBalance.status, "complete");
  assert.ok(ledger.energyBalance.range);
  const expenditureRange = ledger.expenditure.total.range;
  assert.ok(expenditureRange);
  assert.ok(expenditureRange.min < expenditureRange.max);
});

test("零散结构化餐食不能冒充完整日摄入或生成热量差", async () => {
  const app = fixture();
  await bootstrap(app);

  await app.confirmMealObservation({
    userId: USER_ID,
    idempotencyKey: "partial-structured-meal",
    observation: {
      id: "meal-partial",
      occurredAt: `${DATE}T12:30:00.000+08:00`,
      mode: "structured",
      description: "用户只填写了这一餐",
      nutrients: [
        { nutrientId: "energy", amount: 650, unit: "kcal", source: { kind: "manual_form", ref: "form:partial-meal" } },
        { nutrientId: "protein", amount: 35, unit: "g", source: { kind: "manual_form", ref: "form:partial-meal" } },
      ],
      provenance: "manual_form",
    },
  });

  const ledger = await app.readDailyHealthLedger({ userId: USER_ID, date: DATE, timezoneOffsetMinutes: 480 });
  assert.equal(ledger.nutrition.coverage, "partial");
  assert.equal(ledger.nutrition.nutrients.energy.consumedLogged, 650);
  assert.equal(ledger.nutrition.nutrients.energy.intakeKnown, false);
  assert.ok(ledger.nutrition.nutrients.energy.missing.includes("day_intake_not_confirmed_complete"));
  assert.equal(ledger.energyBalance.status, "partial");
  assert.equal(ledger.energyBalance.range, undefined);
});

test("每日 Health Ledger 是唯一、可版本追溯的正式产物，产品页消费同一版本", async () => {
  const store = new InMemoryCoachLedger();
  let sequence = 0;
  const app = new LocalProductKernel(store, {
    now: () => `${DATE}T20:00:00.000+08:00`,
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  await bootstrap(app);

  const first = await app.readDailyHealthLedger({ userId: USER_ID, date: DATE, timezoneOffsetMinutes: 480 });
  const afterFirst = await store.read();
  assert.equal(afterFirst.artifacts.filter((artifact) => artifact.kind === "daily_health_ledger" && artifact.date === DATE && artifact.ledger.version === first.version).length, 1);

  await app.recordTimelineFact({
    userId: USER_ID,
    idempotencyKey: "recovery-frontier",
    fact: { kind: "recovery", perceivedRecovery: 4, confidence: "confirmed" },
    envelope: { time: { startedAt: `${DATE}T19:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
  });
  const second = await app.readDailyHealthLedger({ userId: USER_ID, date: DATE, timezoneOffsetMinutes: 480 });
  assert.notEqual(second.version, first.version);
  const afterSecond = await store.read();
  const versions = afterSecond.artifacts.flatMap((artifact) => artifact.kind === "daily_health_ledger" && artifact.date === DATE ? [artifact.ledger.version] : []);
  assert.ok(versions.includes(first.version));
  assert.ok(versions.includes(second.version));

  const product = await app.readProductProjection({ userId: USER_ID, date: DATE, timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: DATE });
  assert.equal(product.today.nutrition.healthLedger.version, second.version);
});
