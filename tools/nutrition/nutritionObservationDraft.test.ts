import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture(confidence: "low" | "medium" | "high" = "medium") {
  let sequence = 0;
  const requests: unknown[] = [];
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-08T12:10:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    nutritionObservation: {
      async estimate(input) {
        requests.push(input);
        return {
          candidates: [{
            foodName: "鸡肉饭",
            portionAssumption: "一份常规外卖",
            energyRange: {
              min: { value: 550, unit: "kcal" },
              max: { value: 760, unit: "kcal" },
            },
            proteinGramsRange: { min: 28, max: 42 },
            fatGramsRange: { min: 12, max: 24 },
            carbohydrateGramsRange: { min: 65, max: 96 },
            assumptions: ["酱汁和用油未知"],
            confidence,
          }],
          missing: confidence === "low" ? ["米饭份量"] : [],
          provider: { id: "fixture-provider", modelVersion: "2026-08", processingScope: "text" },
        };
      },
    },
  });
  return { app, ledger, requests };
}

async function bootstrap(app: CoachApplication) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-08T00:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08", endDate: "2026-12-08" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
}

test("文字估算只产生 Draft；确认后才以 user_confirmed_estimate 写入 Timeline", async () => {
  const state = fixture();
  await bootstrap(state.app);
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1",
    idempotencyKey: "lunch-draft",
    occurredAt: "2026-08-08T12:00:00.000+08:00",
    request: { text: "午饭吃了鸡肉饭", inputProvenance: ["text"], mediaConsent: "not_requested", purpose: "meal_estimate" },
  });
  assert.equal(draft.kind, "nutrition_observation_draft");
  assert.equal(draft.draft.status, "draft");
  assert.deepEqual(draft.draft.estimates[0]?.fatGramsRange, { min: 12, max: 24 });
  assert.deepEqual(draft.draft.estimates[0]?.carbohydrateGramsRange, { min: 65, max: 96 });
  assert.equal((await state.app.readDomainProjection({ userId: "u1" })).timeline.events.length, 0);
  assert.equal(state.requests.length, 1);

  await state.app.confirmNutritionObservationDraft({
    userId: "u1",
    artifactId: draft.id,
    idempotencyKey: "lunch-confirm",
  });
  const timeline = (await state.app.readDomainProjection({ userId: "u1" })).timeline.events;
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].fact.kind, "nutrition");
  assert.equal(timeline[0].fact.confidence, "estimated");
  assert.equal(timeline[0].fact.kind === "nutrition" && timeline[0].fact.estimate?.provider?.id, "fixture-provider");
  assert.deepEqual(
    timeline[0].fact.kind === "nutrition" && timeline[0].fact.estimate?.estimates[0]?.energyRange,
    { min: { value: 550, unit: "kcal" }, max: { value: 760, unit: "kcal" } },
  );
  assert.ok(timeline[0].envelope?.causalRefs.includes(`nutrition_draft:${draft.id}`));
});

test("低置信 Draft 需要补充信息；拒绝只留下审计，不写入 Timeline", async () => {
  const state = fixture("low");
  await bootstrap(state.app);
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1",
    idempotencyKey: "uncertain-draft",
    occurredAt: "2026-08-08T12:00:00.000+08:00",
    request: { text: "午饭", mediaConsent: "not_requested", purpose: "meal_estimate" },
  });
  await assert.rejects(
    state.app.confirmNutritionObservationDraft({ userId: "u1", artifactId: draft.id, idempotencyKey: "uncertain-confirm" }),
    /nutrition_draft_requires_clarification/,
  );
  await state.app.rejectNutritionObservationDraft({ userId: "u1", artifactId: draft.id, idempotencyKey: "uncertain-reject" });
  assert.equal((await state.app.readDomainProjection({ userId: "u1" })).timeline.events.length, 0);
  const actions = await state.app.listActionLog("u1");
  assert.ok(actions.some((event) => event.action === "nutrition.draft.rejected"));
});

test("用户编辑候选食物与份量后确认：原 Draft 与明确编辑同时保留为估算语义", async () => {
  const state = fixture();
  await bootstrap(state.app);
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1",
    idempotencyKey: "edited-estimate-draft",
    occurredAt: "2026-08-08T12:00:00.000+08:00",
    request: { text: "午饭鸡肉饭", inputProvenance: ["text"], mediaConsent: "not_requested", purpose: "meal_estimate" },
  });

  await state.app.confirmNutritionObservationDraft({
    userId: "u1",
    artifactId: draft.id,
    idempotencyKey: "edited-estimate-confirm",
    edits: {
      description: "鸡胸肉饭，加了一份西兰花",
      estimates: [{
        foodName: "鸡胸肉饭和西兰花",
        portionAssumption: "一份米饭、120 g 鸡胸肉和一份西兰花",
        energyRange: {
          min: { value: 610, unit: "kcal" },
          max: { value: 790, unit: "kcal" },
        },
        proteinGramsRange: { min: 38, max: 52 },
        fatGramsRange: { min: 12, max: 24 },
        carbohydrateGramsRange: { min: 65, max: 96 },
        assumptions: ["酱汁和用油仍未知"],
        confidence: "medium",
      }],
    },
  });

  const fact = (await state.app.readDomainProjection({ userId: "u1" })).timeline.current[0]?.fact;
  assert.equal(fact?.kind, "nutrition");
  if (fact?.kind !== "nutrition") throw new Error("nutrition_fact_expected");
  assert.equal(fact.confidence, "estimated");
  assert.equal(fact.observationMode, "user_confirmed_estimate");
  assert.equal(fact.mealDescription, "鸡胸肉饭，加了一份西兰花");
  assert.deepEqual(fact.estimate?.estimates, draft.draft.estimates);
  assert.deepEqual(fact.estimate?.userEdits?.estimates?.[0]?.energyRange, {
    min: { value: 610, unit: "kcal" },
    max: { value: 790, unit: "kcal" },
  });
  assert.equal(fact.estimate?.userEdits?.description, "鸡胸肉饭，加了一份西兰花");
});

test("客户端只能按所属用户读取待确认营养 Draft", async () => {
  const state = fixture();
  await bootstrap(state.app);
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1",
    idempotencyKey: "readable-draft",
    occurredAt: "2026-08-08T12:00:00.000+08:00",
    request: { text: "午饭鸡肉饭", inputProvenance: ["text"], mediaConsent: "not_requested", purpose: "meal_estimate" },
  });
  assert.equal((await state.app.readNutritionObservationDraft({ userId: "u1", artifactId: draft.id })).id, draft.id);
  await assert.rejects(
    state.app.readNutritionObservationDraft({ userId: "u2", artifactId: draft.id }),
    /nutrition_draft_not_found/,
  );
});

test("仅本机照片会保留为待补充的本地草稿，绝不调用 Provider 或自动写入 Timeline", async () => {
  const state = fixture();
  await bootstrap(state.app);
  const draft = await state.app.createNutritionObservationDraft({
    userId: "u1",
    idempotencyKey: "local-photo",
    occurredAt: "2026-08-08T12:00:00.000+08:00",
    request: { localMediaRefs: ["local-media-1"], mediaConsent: "local_only", purpose: "meal_estimate" },
  });
  assert.equal(state.requests.length, 0);
  assert.deepEqual(draft.draft.inputMediaRefs, ["local-media-1"]);
  assert.equal(draft.draft.clarificationRequired, true);
  assert.equal((await state.app.readDomainProjection({ userId: "u1" })).timeline.events.length, 0);
  await assert.rejects(
    state.app.confirmNutritionObservationDraft({ userId: "u1", artifactId: draft.id, idempotencyKey: "local-photo-auto-confirm" }),
    /nutrition_draft_requires_clarification/,
  );
  await state.app.confirmNutritionObservationDraft({
    userId: "u1",
    artifactId: draft.id,
    idempotencyKey: "local-photo-manual-confirm",
    observation: {
      id: "manual-photo-meal",
      occurredAt: "2026-08-08T12:00:00.000+08:00",
      mode: "simplified",
      description: "鸡肉饭",
      provenance: "manual",
    },
  });
  const fact = (await state.app.readDomainProjection({ userId: "u1" })).timeline.current[0]?.fact;
  assert.equal(fact?.kind, "nutrition");
  assert.equal(fact?.kind === "nutrition" && fact.confidence, "confirmed");
});
