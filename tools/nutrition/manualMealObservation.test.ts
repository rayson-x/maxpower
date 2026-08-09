import assert from "node:assert/strict";
import test from "node:test";

import { createManualMealObservation } from "../../src/nutrition";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

test("精确手工餐食只保存用户输入的数值与标签来源", () => {
  const observation = createManualMealObservation({
    id: "meal-1",
    occurredAt: "2026-08-09T12:00:00.000+08:00",
    description: "鸡肉饭",
    mode: "precise",
    provenance: "label",
    energyKcal: 540,
    proteinGrams: 36,
    carbohydrateGrams: 62,
  });
  assert.equal(observation.mode, "precise");
  assert.equal(observation.provenance, "label");
  assert.deepEqual(observation.energy, { value: 540, unit: "kcal" });
  assert.equal(observation.fatGrams, undefined);
});

test("轻量餐食保留结构化执行反馈，不伪造成热量记录", () => {
  const observation = createManualMealObservation({
    id: "meal-2",
    occurredAt: "2026-08-09T19:00:00.000+08:00",
    description: "晚餐",
    mode: "simplified",
    provenance: "manual",
    simplified: { proteinCompletion: "met", hunger: "moderate", deviation: "small" },
  });
  assert.equal(observation.energy, undefined);
  assert.deepEqual(observation.simplified, { proteinCompletion: "met", hunger: "moderate", deviation: "small" });
});

test("用户确认的轻量记录把结构化反馈保留在 Timeline，而不是丢在 UI 里", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-09T19:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-1`,
  });
  const observation = createManualMealObservation({
    id: "meal-3",
    occurredAt: "2026-08-09T19:00:00.000+08:00",
    description: "晚餐",
    mode: "simplified",
    provenance: "manual",
    simplified: { proteinCompletion: "met", hunger: "moderate", deviation: "small" },
  });
  await app.confirmMealObservation({ userId: "u1", idempotencyKey: "meal-3-confirm", observation });
  const timeline = (await app.readDomainProjection({ userId: "u1" })).timeline.current;
  const event = timeline.find((item) => item.fact.kind === "nutrition");
  assert.ok(event && event.fact.kind === "nutrition");
  assert.deepEqual(event.fact.simplified, { proteinCompletion: "met", hunger: "moderate", deviation: "small" });
  assert.equal(event.fact.energy, undefined);
});

test("缺失描述、精确数值或非法数值不会成为 canonical meal", () => {
  assert.throws(() => createManualMealObservation({
    id: "meal", occurredAt: "2026-08-09T12:00:00.000+08:00", description: "", mode: "simplified", provenance: "manual",
    simplified: { proteinCompletion: "partial", hunger: "moderate", deviation: "none" },
  }), /description_required/);
  assert.throws(() => createManualMealObservation({
    id: "meal", occurredAt: "2026-08-09T12:00:00.000+08:00", description: "午餐", mode: "precise", provenance: "manual",
  }), /precise_value_required/);
  assert.throws(() => createManualMealObservation({
    id: "meal", occurredAt: "2026-08-09T12:00:00.000+08:00", description: "午餐", mode: "precise", provenance: "manual", energyKcal: -1,
  }), /value_invalid/);
});
