import assert from "node:assert/strict";
import test from "node:test";

import { createManualMealObservation } from "../../src/nutrition";

test("manual structured observation preserves only explicit field values and sources", () => {
  const observation = createManualMealObservation({
    id: "meal-1",
    occurredAt: "2026-08-15T12:00:00.000Z",
    description: "包装食品",
    mode: "structured",
    provenance: "manually_transcribed_label",
    foods: [{ id: "food-1", name: "包装食品", portion: "1 份" }],
    nutrients: [
      { nutrientId: "energy", amount: 320, unit: "kcal", source: { kind: "manually_transcribed_label", ref: "form-1" } },
      { nutrientId: "sodium", amount: 680, unit: "mg", source: { kind: "manually_transcribed_label", ref: "form-1" } },
    ],
  });

  assert.equal(observation.mode, "structured");
  assert.equal(observation.nutrients?.[0]?.amount, 320);
  assert.equal(observation.nutrients?.[1]?.nutrientId, "sodium");
  assert.equal(observation.foods?.[0]?.name, "包装食品");
});

test("descriptive food does not acquire nutrient values", () => {
  const observation = createManualMealObservation({
    id: "meal-2",
    occurredAt: "2026-08-15T18:00:00.000Z",
    description: "一碗牛肉面",
    mode: "descriptive",
    provenance: "manual_form",
    foods: [{ id: "food-2", name: "牛肉面", portion: "一碗" }],
  });
  assert.equal(observation.mode, "descriptive");
  assert.equal(observation.nutrients, undefined);
});

test("structured observation rejects missing or mismatched sources", () => {
  assert.throws(() => createManualMealObservation({ id: "meal-3", occurredAt: "2026-08-15T18:00:00.000Z", description: "x", mode: "structured", provenance: "manual_form" }), /nutrition_structured_value_required/);
  assert.throws(() => createManualMealObservation({
    id: "meal-4",
    occurredAt: "2026-08-15T18:00:00.000Z",
    description: "x",
    mode: "structured",
    provenance: "manual_form",
    nutrients: [{ nutrientId: "protein", amount: 20, unit: "g", source: { kind: "current_user_statement", ref: "turn-1" } }],
  }), /nutrition_value_source_mismatch/);
});
