import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { IdFactory } from "../src/kernel/ids.js";
import type { Principal } from "../src/kernel/principal.js";
import {
  InMemoryProductDataAdapter,
  ProductDataModule,
  type JsonObject,
} from "../src/modules/product-data/index.js";

test("profile writes are account scoped, idempotent, and revision checked", async () => {
  const productData = createProductData();
  const alice = principal("alice");
  const bob = principal("bob");

  const initial = await productData.getProfile(alice);
  assert.equal(initial.accountId, "alice");
  assert.equal(initial.revision, 1);

  const request = {
    patch: {
      displayName: "Alice",
      timeZone: "Europe/Berlin",
      data: { kind: "maxpower_profile_recovery", schemaVersion: 1 },
    },
    expectedRevision: 1,
    idempotencyKey: "profile-1",
  } as const;
  const updated = await productData.patchProfile(alice, request);
  assert.equal(updated.revision, 2);
  assert.equal(updated.displayName, "Alice");
  assert.deepEqual(updated.data, { kind: "maxpower_profile_recovery", schemaVersion: 1 });
  assert.deepEqual(await productData.patchProfile(alice, request), updated);

  const bobProfile = await productData.getProfile(bob);
  assert.equal(bobProfile.displayName, null);
  assert.equal(bobProfile.revision, 1);

  await assertApiError(
    productData.patchProfile(alice, {
      patch: { displayName: "Different payload" },
      expectedRevision: 1,
      idempotencyKey: "profile-1",
    }),
    409,
    "idempotency_key_reused",
  );
  await assertApiError(
    productData.patchProfile(alice, {
      patch: { locale: "de" },
      expectedRevision: 1,
      idempotencyKey: "profile-stale",
    }),
    409,
    "revision_conflict",
  );
});

test("plans retain immutable snapshots and hide resources across accounts", async () => {
  const productData = createProductData();
  const alice = principal("alice");
  const bob = principal("bob");
  const initialSnapshot: JsonObject = { weeks: [{ label: "base", sessions: 3 }] };

  const created = await productData.createPlan(alice, {
    title: "Base plan",
    snapshot: initialSnapshot,
    idempotencyKey: "plan-create",
  });
  const replayed = await productData.createPlan(alice, {
    title: "Base plan",
    snapshot: initialSnapshot,
    idempotencyKey: "plan-create",
  });
  assert.equal(replayed.id, created.id);
  assert.equal(created.revision, 1);
  assert.equal(created.versions.length, 1);

  const patched = await productData.patchPlan(alice, {
    planId: created.id,
    patch: { snapshot: { weeks: [{ label: "build", sessions: 4 }] } },
    expectedRevision: 1,
    idempotencyKey: "plan-patch",
  });
  assert.equal(patched.revision, 2);
  assert.equal(patched.versions.length, 2);
  assert.deepEqual(patched.versions[0]?.snapshot, initialSnapshot);
  assert.notEqual(patched.currentVersionId, created.currentVersionId);

  await assertApiError(
    productData.patchPlan(alice, {
      planId: created.id,
      patch: { title: "Stale edit" },
      expectedRevision: 1,
      idempotencyKey: "plan-stale",
    }),
    409,
    "revision_conflict",
  );
  await assertApiError(productData.getPlan(bob, created.id), 404, "not_found");

  const published = await productData.publishPlan(alice, {
    planId: created.id,
    expectedRevision: 2,
    idempotencyKey: "plan-publish",
  });
  assert.equal(published.status, "published");
  assert.equal(published.publishedVersionId, published.currentVersionId);
  assert.equal(published.versions[0]?.publishedAt, null);
  assert.notEqual(published.versions[1]?.publishedAt, null);

  await productData.deletePlan(alice, {
    planId: created.id,
    expectedRevision: 3,
    idempotencyKey: "plan-delete",
  });
  await productData.deletePlan(alice, {
    planId: created.id,
    expectedRevision: 3,
    idempotencyKey: "plan-delete",
  });
  assert.deepEqual((await productData.listPlans(alice)).data, []);
  await assertApiError(productData.getPlan(alice, created.id), 404, "not_found");
});

test("product lists use stable owner-scoped cursor pagination", async () => {
  const productData = createProductData();
  const alice = principal("alice");
  const firstCreated = await productData.createPlan(alice, {
    title: "First",
    snapshot: { order: 1 },
    idempotencyKey: "page-plan-1",
  });
  const secondCreated = await productData.createPlan(alice, {
    title: "Second",
    snapshot: { order: 2 },
    idempotencyKey: "page-plan-2",
  });
  const thirdCreated = await productData.createPlan(alice, {
    title: "Third",
    snapshot: { order: 3 },
    idempotencyKey: "page-plan-3",
  });

  const firstPage = await productData.listPlans(alice, { limit: 2 });
  assert.deepEqual(firstPage.data.map((plan) => plan.id), [thirdCreated.id, secondCreated.id]);
  assert.equal(typeof firstPage.nextCursor, "string");
  const secondPage = await productData.listPlans(alice, {
    limit: 2,
    cursor: firstPage.nextCursor ?? undefined,
  });
  assert.deepEqual(secondPage.data.map((plan) => plan.id), [firstCreated.id]);
  assert.equal(secondPage.nextCursor, null);
  await assertApiError(
    productData.listPlans(alice, { limit: 2, cursor: "not-a-cursor" }),
    400,
    "invalid_cursor",
  );
});

test("workout sessions and results expose durable product outcomes, not conversations", async () => {
  const productData = createProductData();
  const alice = principal("alice");
  const plan = await productData.createPlan(alice, {
    title: "Strength",
    snapshot: { exercises: ["squat"] },
    idempotencyKey: "p1",
  });
  const workout = await productData.createWorkoutSession(alice, {
    planId: plan.id,
    title: "Monday",
    data: { sets: [] },
    mediaAssetIds: ["media_video", "media_packet"],
    idempotencyKey: "w1",
  });
  assert.deepEqual(workout.planSnapshot, plan.versions[0]?.snapshot);
  assert.deepEqual(workout.mediaReferences, [
    { assetId: "media_packet", evidenceStatus: "available", evidenceDeletedAt: null },
    { assetId: "media_video", evidenceStatus: "available", evidenceDeletedAt: null },
  ]);
  assert.equal("messages" in workout, false);
  assert.equal((await productData.listWorkoutSessions(alice)).data.length, 1);

  const patched = await productData.patchWorkoutSession(alice, {
    workoutSessionId: workout.id,
    patch: { data: { sets: [{ reps: 5, loadKg: 100 }] }, notes: "Felt good" },
    expectedRevision: 1,
    idempotencyKey: "w-patch",
  });
  const completed = await productData.completeWorkoutSession(alice, {
    workoutSessionId: workout.id,
    summary: { completedSets: 1 },
    expectedRevision: patched.revision,
    idempotencyKey: "w-complete",
  });
  assert.equal(completed.status, "completed");
  await assertApiError(productData.patchWorkoutSession(alice, {
    workoutSessionId: workout.id,
    patch: { notes: "Must be a correction revision, not an in-place edit" },
    expectedRevision: completed.revision,
    idempotencyKey: "w-patch-after-complete",
  }), 409, "completed_workout_immutable");

  const result = await productData.createResult(alice, {
    kind: "motion_analysis",
    workoutSessionId: workout.id,
    payload: { score: 0.91 },
    provenance: { model: "pose-v1" },
    mediaAssetIds: ["media_packet"],
    idempotencyKey: "r1",
  });
  const corrected = await productData.patchResult(alice, {
    resultId: result.id,
    patch: { payload: { score: 0.94 } },
    expectedRevision: 1,
    idempotencyKey: "r-patch",
  });
  assert.deepEqual(corrected.payload, { score: 0.94 });
  assert.equal("conversationId" in corrected, false);
  await productData.markMediaEvidenceDeleted({
    accountId: alice.accountId,
    assetIds: ["media_packet"],
    deletedAt: "2026-01-03T00:00:00.000Z",
  });
  const evidenceDeleted = await productData.getResult(alice, result.id);
  assert.deepEqual(evidenceDeleted.mediaReferences, [{
    assetId: "media_packet",
    evidenceStatus: "evidence_deleted",
    evidenceDeletedAt: "2026-01-03T00:00:00.000Z",
  }]);
  assert.equal(evidenceDeleted.revision, corrected.revision + 1);
  const workoutAfterEvidenceDeletion = await productData.getWorkoutSession(alice, workout.id);
  assert.equal(workoutAfterEvidenceDeletion.mediaReferences[0]?.evidenceStatus, "evidence_deleted");
  assert.deepEqual((await productData.listResults(alice)).data, [evidenceDeleted]);

  await productData.deleteWorkoutSession(alice, {
    workoutSessionId: workout.id,
    expectedRevision: workoutAfterEvidenceDeletion.revision,
    idempotencyKey: "w-delete",
  });
  assert.equal((await productData.getResult(alice, result.id)).workoutSessionId, workout.id);
  await assertApiError(productData.getWorkoutSession(alice, workout.id), 404, "not_found");

  await productData.deleteResult(alice, {
    resultId: result.id,
    expectedRevision: evidenceDeleted.revision,
    idempotencyKey: "r-delete",
  });
  assert.deepEqual((await productData.listResults(alice)).data, []);
  await assertApiError(productData.getResult(alice, result.id), 404, "not_found");
});

function createProductData(): ProductDataModule {
  return new ProductDataModule({
    adapter: new InMemoryProductDataAdapter(),
    clock: new StepClock(),
    ids: sequentialIds(),
  });
}

function principal(accountId: string): Principal {
  return {
    accountId,
    sessionId: `session-${accountId}`,
    status: "active",
    scopes: new Set(),
  };
}

class StepClock implements Clock {
  #step = 0;

  now(): Date {
    this.#step += 1;
    return new Date(Date.UTC(2026, 0, 1, 0, 0, this.#step));
  }
}

function sequentialIds(): IdFactory {
  let sequence = 0;
  return (prefix) => `${prefix}_${++sequence}`;
}

async function assertApiError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
}
