import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { Pool } from "pg";

import { createPostgresProductData } from "../src/adapters/postgres/product-data.js";
import { ApiError } from "../src/kernel/api-error.js";
import type { Clock } from "../src/kernel/clock.js";
import type { IdFactory } from "../src/kernel/ids.js";
import type { Principal } from "../src/kernel/principal.js";

const databaseUrl = process.env.MAXPOWER_TEST_POSTGRES_URL;

test(
  "Postgres preserves ProductData behavior across instances and serializes account revisions",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("DROP SCHEMA IF EXISTS maxpower CASCADE");
      await pool.query(
        `DROP TABLE IF EXISTS "rateLimit", "jwks", "verification", "account", "session", "user" CASCADE`,
      );
      await pool.query(
        await readFile(new URL("../migrations/010-better-auth.sql", import.meta.url), "utf8"),
      );
      await pool.query(
        await readFile(new URL("../migrations/020-product-data.sql", import.meta.url), "utf8"),
      );
      await pool.query(
        await readFile(new URL("../migrations/030-media-library.sql", import.meta.url), "utf8"),
      );
      await seedActiveAccount(pool, "alice");
      await seedActiveAccount(pool, "bob");
      await seedReadyMedia(pool, "alice", "media-evidence");

      const ids = sequentialIds();
      const first = createPostgresProductData({ pool, clock: new StepClock(), ids });
      const alice = principal("alice");
      const bob = principal("bob");

      const profile = await first.patchProfile(alice, {
        patch: { displayName: "Alice", timeZone: "Europe/Berlin" },
        expectedRevision: 1,
        idempotencyKey: "profile-1",
      });
      assert.equal(profile.revision, 2);

      const planRequest = {
        title: "Strength",
        snapshot: { weeks: [{ sessions: 3 }] },
        idempotencyKey: "plan-1",
      } as const;
      const plan = await first.createPlan(alice, planRequest);

      const restarted = createPostgresProductData({ pool, clock: new StepClock(), ids });
      assert.deepEqual(await restarted.getProfile(alice), profile);
      assert.equal((await restarted.createPlan(alice, planRequest)).id, plan.id);
      await assertApiError(restarted.getPlan(bob, plan.id), 404, "not_found");

      const competing = await Promise.allSettled([
        first.patchPlan(alice, {
          planId: plan.id,
          patch: { snapshot: { weeks: [{ sessions: 4 }] } },
          expectedRevision: 1,
          idempotencyKey: "plan-edit-a",
        }),
        restarted.patchPlan(alice, {
          planId: plan.id,
          patch: { snapshot: { weeks: [{ sessions: 5 }] } },
          expectedRevision: 1,
          idempotencyKey: "plan-edit-b",
        }),
      ]);
      assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
      const rejected = competing.find((result) => result.status === "rejected");
      assert.ok(rejected?.status === "rejected");
      assert.ok(rejected.reason instanceof ApiError);
      assert.equal(rejected.reason.code, "revision_conflict");

      const currentPlan = await restarted.getPlan(alice, plan.id);
      assert.equal(currentPlan.revision, 2);
      assert.equal(currentPlan.versions.length, 2);
      assert.deepEqual(currentPlan.versions[0]?.snapshot, planRequest.snapshot);

      const published = await restarted.publishPlan(alice, {
        planId: plan.id,
        expectedRevision: currentPlan.revision,
        idempotencyKey: "plan-publish",
      });
      const workout = await restarted.createWorkoutSession(alice, {
        planId: published.id,
        title: "Monday",
        data: { sets: [{ reps: 5 }] },
        mediaAssetIds: ["media-evidence"],
        idempotencyKey: "workout-1",
      });
      const revisedWorkout = await restarted.patchWorkoutSession(alice, {
        workoutSessionId: workout.id,
        patch: { notes: "Felt strong", data: { sets: [{ reps: 5, loadKg: 100 }] } },
        expectedRevision: workout.revision,
        idempotencyKey: "workout-patch",
      });
      const completed = await restarted.completeWorkoutSession(alice, {
        workoutSessionId: workout.id,
        summary: { completedSets: 1 },
        expectedRevision: revisedWorkout.revision,
        idempotencyKey: "workout-complete",
      });
      const result = await restarted.createResult(alice, {
        kind: "motion_analysis",
        workoutSessionId: completed.id,
        payload: { score: 0.93 },
        provenance: { model: "pose-v1" },
        mediaAssetIds: ["media-evidence"],
        idempotencyKey: "result-1",
      });
      const corrected = await restarted.patchResult(alice, {
        resultId: result.id,
        patch: { payload: { score: 0.95 } },
        expectedRevision: result.revision,
        idempotencyKey: "result-patch",
      });
      const workoutHistory = await pool.query<{ revision: number; snapshot: { status: string; notes: string | null } }>(
        `SELECT revision, snapshot
           FROM maxpower.workout_session_revisions
          WHERE account_id = $1 AND workout_session_id = $2
          ORDER BY revision`,
        [alice.accountId, workout.id],
      );
      assert.deepEqual(workoutHistory.rows.map(({ revision, snapshot }) => ({ revision, status: snapshot.status, notes: snapshot.notes })), [
        { revision: 1, status: "in_progress", notes: null },
        { revision: 2, status: "in_progress", notes: "Felt strong" },
        { revision: 3, status: "completed", notes: "Felt strong" },
      ]);
      const resultHistory = await pool.query<{ revision: number; snapshot: { payload: { score: number } } }>(
        `SELECT revision, snapshot
           FROM maxpower.result_revisions
          WHERE account_id = $1 AND result_id = $2
          ORDER BY revision`,
        [alice.accountId, result.id],
      );
      assert.deepEqual(resultHistory.rows.map(({ revision, snapshot }) => ({ revision, score: snapshot.payload.score })), [
        { revision: 1, score: 0.93 },
        { revision: 2, score: 0.95 },
      ]);

      const finalInstance = createPostgresProductData({
        pool,
        clock: new StepClock(),
        ids,
      });
      assert.equal((await finalInstance.getWorkoutSession(alice, workout.id)).status, "completed");
      assert.deepEqual((await finalInstance.getResult(alice, result.id)).payload, { score: 0.95 });
      assert.equal((await finalInstance.getResult(alice, result.id)).mediaReferences[0]?.assetId, "media-evidence");
      assert.equal((await finalInstance.listPlans(alice)).data.length, 1);
      assert.equal((await finalInstance.listWorkoutSessions(alice)).data.length, 1);
      assert.equal((await finalInstance.listResults(alice)).data.length, 1);
      assert.deepEqual((await finalInstance.listPlans(bob)).data, []);
      assert.deepEqual((await finalInstance.listWorkoutSessions(bob)).data, []);
      assert.deepEqual((await finalInstance.listResults(bob)).data, []);

      await finalInstance.deleteResult(alice, {
        resultId: result.id,
        expectedRevision: corrected.revision,
        idempotencyKey: "result-delete",
      });
      await finalInstance.deleteWorkoutSession(alice, {
        workoutSessionId: workout.id,
        expectedRevision: completed.revision,
        idempotencyKey: "workout-delete",
      });
      await finalInstance.deletePlan(alice, {
        planId: plan.id,
        expectedRevision: published.revision,
        idempotencyKey: "plan-delete",
      });
      const afterDeletion = createPostgresProductData({ pool, clock: new StepClock(), ids });
      assert.deepEqual((await afterDeletion.listPlans(alice)).data, []);
      assert.deepEqual((await afterDeletion.listWorkoutSessions(alice)).data, []);
      assert.deepEqual((await afterDeletion.listResults(alice)).data, []);
      await pool.query(
        `UPDATE "user" SET "accountStatus" = 'pending_deletion' WHERE id = 'alice'`,
      );
      await assertApiError(afterDeletion.patchProfile(alice, {
        patch: { displayName: "Must not write" },
        expectedRevision: profile.revision,
        idempotencyKey: "profile-after-deletion",
      }), 403, "account_not_writable");
    } finally {
      await pool.end();
    }
  },
);

test(
  "Postgres ProductData lists page without mutating stored resources",
  { skip: databaseUrl === undefined },
  async () => {
    assert.ok(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("DROP SCHEMA IF EXISTS maxpower CASCADE");
      await pool.query(
        `DROP TABLE IF EXISTS "rateLimit", "jwks", "verification", "account", "session", "user" CASCADE`,
      );
      await pool.query(
        await readFile(new URL("../migrations/010-better-auth.sql", import.meta.url), "utf8"),
      );
      await pool.query(
        await readFile(new URL("../migrations/020-product-data.sql", import.meta.url), "utf8"),
      );
      await pool.query(
        await readFile(new URL("../migrations/030-media-library.sql", import.meta.url), "utf8"),
      );
      await seedActiveAccount(pool, "alice");
      const productData = createPostgresProductData({
        pool,
        clock: new StepClock(),
        ids: sequentialIds(),
      });
      const alice = principal("alice");
      const created = [];
      for (const title of ["First", "Second", "Third"]) {
        created.push(await productData.createPlan(alice, {
          title,
          snapshot: { title },
          idempotencyKey: `create-${title}`,
        }));
      }

      const firstPage = await productData.listPlans(alice, { limit: 2 });
      assert.deepEqual(firstPage.data.map((plan) => plan.title), ["Third", "Second"]);
      assert.ok(firstPage.nextCursor);
      const secondPage = await productData.listPlans(alice, {
        limit: 2,
        cursor: firstPage.nextCursor,
      });
      assert.deepEqual(secondPage.data.map((plan) => plan.title), ["First"]);
      assert.equal(secondPage.nextCursor, null);

      const revisionsBefore = created.map((plan) => plan.revision);
      assert.deepEqual(
        await Promise.all(created.map(async (plan) => (await productData.getPlan(alice, plan.id)).revision)),
        revisionsBefore,
      );
    } finally {
      await pool.end();
    }
  },
);

async function seedActiveAccount(pool: Pool, accountId: string): Promise<void> {
  await pool.query(
    `INSERT INTO "user"
      (id, name, email, "emailVerified", "createdAt", "updatedAt",
       "accountStatus", scopes, "registrationComplete")
     VALUES ($1, 'Test account', $2, true, now(), now(), 'active', '', true)
     ON CONFLICT (id) DO UPDATE
       SET "accountStatus" = 'active', "updatedAt" = now()`,
    [accountId, `${accountId}@product-data.example.invalid`],
  );
}

async function seedReadyMedia(pool: Pool, accountId: string, assetId: string): Promise<void> {
  await pool.query(
    `INSERT INTO maxpower.media_assets
      (account_id, id, kind, file_name, content_type, byte_size, sha256, object_key,
       status, purpose, verification, revision, created_at, ready_at, deleted_at)
     VALUES ($1, $2, 'canonical_packet', 'packet.json', 'application/json', 10, $3, $4,
             'ready', 'personal', 'object_metadata_verified', 2, now(), now(), NULL)`,
    [accountId, assetId, "a".repeat(64), `accounts/test/${assetId}`],
  );
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
    return new Date(Date.UTC(2026, 4, 1, 0, 0, this.#step));
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
