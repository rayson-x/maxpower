import assert from "node:assert/strict";
import test from "node:test";

import { RecordModule } from "../../src/records";

test("RecordModule admits both fact and nutrition through one draft-confirm boundary", async () => {
  const calls: string[] = [];
  const records = new RecordModule({
    createTimelineDraft: async () => { calls.push("fact:draft"); return { id: "fact-draft" }; },
    confirmTimelineDraft: async () => { calls.push("fact:confirm"); },
    createNutritionDraft: async () => { calls.push("nutrition:draft"); return { id: "nutrition-draft" }; },
    confirmNutritionDraft: async () => { calls.push("nutrition:confirm"); },
    correctTimelineFact: async () => { calls.push("fact:correct"); },
  });
  await records.recordFact({ userId: "user-1", idempotencyKey: "fact", occurredAt: "2026-08-16T00:00:00.000Z", source: "manual_form", fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" } }, confidence: "confirmed" } });
  await records.recordNutrition({ userId: "user-1", idempotencyKey: "nutrition", observation: { id: "meal", occurredAt: "2026-08-16T00:00:00.000Z", mode: "structured", description: "标签", nutrients: [{ nutrientId: "energy", amount: 400, unit: "kcal", source: { kind: "manual_form", ref: "label" } }], provenance: "manual_form" } });
  assert.deepEqual(calls, ["fact:draft", "fact:confirm", "nutrition:draft", "nutrition:confirm"]);
});

test("RecordModule keeps a Timeline correction on the same formal admission boundary", async () => {
  const calls: string[] = [];
  const records = new RecordModule({
    createTimelineDraft: async () => ({ id: "unused" }),
    confirmTimelineDraft: async () => undefined,
    createNutritionDraft: async () => ({ id: "unused" }),
    confirmNutritionDraft: async () => undefined,
    correctTimelineFact: async () => { calls.push("correction"); },
  });
  await records.correctFact({
    userId: "user-1",
    idempotencyKey: "correction-1",
    correction: { correctsEventId: "event-1", reason: "输入有误", actor: { kind: "user", id: "user-1" }, recordedAt: "2026-08-16T00:00:00.000Z" },
    fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" } }, confidence: "confirmed" },
    envelope: { id: "entry-1", time: { startedAt: "2026-08-16T00:00:00.000Z", timezoneOffsetMinutes: 0 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "private", causalRefs: [], evidenceRefs: [], layer: "canonical_projection" },
  });
  assert.deepEqual(calls, ["correction"]);
});

test("RecordModule preserves a successful confirmed record without any secondary write path", async () => {
  const calls: string[] = [];
  const records = new RecordModule({
    createTimelineDraft: async () => ({ id: "fact-draft" }),
    confirmTimelineDraft: async () => { calls.push("confirmed"); },
    createNutritionDraft: async () => ({ id: "unused" }),
    confirmNutritionDraft: async () => undefined,
    correctTimelineFact: async () => undefined,
  });
  await records.recordFact({ userId: "user-1", idempotencyKey: "fact", occurredAt: "2026-08-16T00:00:00.000Z", source: "manual_form", fact: { kind: "body", measurement: { metric: "body_weight", quantity: { value: 80, unit: "kg" } }, confidence: "confirmed" } });
  assert.deepEqual(calls, ["confirmed"]);
});
