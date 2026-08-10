import type { Clock } from "../../kernel/clock.js";
import { forbidden, notFound } from "../../kernel/api-error.js";
import type { IdFactory } from "../../kernel/ids.js";
import {
  encodeCursor,
  normalizeCursorPageInput,
  type CursorPage,
  type CursorPageInput,
  type CursorPosition,
} from "../../kernel/pagination.js";
import type {
  MediaEvidenceReference,
  Plan,
  PlanVersion,
  ProductData,
  Profile,
  ResultRecord,
  WorkoutSession,
} from "../../modules/product-data/model.js";
import { ProductDataModule } from "../../modules/product-data/product-data.js";
import type {
  ProductDataState,
  ProductDataStateAdapter,
  StoredPlan,
  StoredResult,
  StoredWorkoutSession,
} from "../../modules/product-data/state-adapter.js";
import { emptyProductDataState } from "../../modules/product-data/state-adapter.js";
import type { PostgresClient, PostgresPool } from "./client.js";

export interface PostgresProductDataDependencies {
  pool: PostgresPool;
  clock?: Clock;
  ids?: IdFactory;
}

/** Compose the existing ProductData Module with durable PostgreSQL state. */
export function createPostgresProductData(dependencies: PostgresProductDataDependencies): ProductData {
  return new ProductDataModule({
    adapter: new PostgresProductDataStateAdapter(dependencies.pool),
    ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
    ...(dependencies.ids === undefined ? {} : { ids: dependencies.ids }),
  });
}

/**
 * PostgreSQL adapter for ProductData's internal transactional seam. An account
 * advisory lock makes the Module's revision and idempotency checks atomic
 * across server instances.
 */
export class PostgresProductDataStateAdapter implements ProductDataStateAdapter {
  readonly #pool: PostgresPool;

  constructor(pool: PostgresPool) {
    this.#pool = pool;
  }

  readProfile(accountId: string): Promise<Profile | undefined> {
    return this.#read(async (client) => {
      const result = await client.query<ProfileRow>(
        "SELECT * FROM maxpower.profiles WHERE account_id = $1",
        [accountId],
      );
      const row = result.rows[0];
      return row === undefined ? undefined : profileFromRow(row);
    });
  }

  readPlan(accountId: string, planId: string): Promise<Plan | undefined> {
    return this.#read(async (client) => {
      const result = await client.query<PlanRow>(
        `SELECT * FROM maxpower.plans
          WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [accountId, planId],
      );
      const plans = await hydratePlans(client, accountId, result.rows);
      return plans[0];
    });
  }

  listPlans(accountId: string, input: CursorPageInput = {}): Promise<CursorPage<Plan>> {
    return this.#read(async (client) => {
      const page = pageQuery(input, accountId);
      const result = await client.query<PlanRow>(
        `SELECT * FROM maxpower.plans
          WHERE account_id = $1 AND deleted_at IS NULL
            ${page.cursorSql}
          ORDER BY created_at DESC, id DESC
          LIMIT $${page.params.length}`,
        page.params,
      );
      return finishPage(await hydratePlans(client, accountId, result.rows), page.limit);
    });
  }

  readWorkoutSession(
    accountId: string,
    workoutSessionId: string,
  ): Promise<WorkoutSession | undefined> {
    return this.#read(async (client) => {
      const result = await client.query<WorkoutRow>(
        `SELECT * FROM maxpower.workout_sessions
          WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [accountId, workoutSessionId],
      );
      const workouts = await hydrateWorkouts(client, accountId, result.rows);
      return workouts[0];
    });
  }

  listWorkoutSessions(
    accountId: string,
    input: CursorPageInput = {},
  ): Promise<CursorPage<WorkoutSession>> {
    return this.#read(async (client) => {
      const page = pageQuery(input, accountId);
      const result = await client.query<WorkoutRow>(
        `SELECT * FROM maxpower.workout_sessions
          WHERE account_id = $1 AND deleted_at IS NULL
            ${page.cursorSql}
          ORDER BY created_at DESC, id DESC
          LIMIT $${page.params.length}`,
        page.params,
      );
      return finishPage(await hydrateWorkouts(client, accountId, result.rows), page.limit);
    });
  }

  readResult(accountId: string, resultId: string): Promise<ResultRecord | undefined> {
    return this.#read(async (client) => {
      const result = await client.query<ResultRow>(
        `SELECT * FROM maxpower.results
          WHERE account_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [accountId, resultId],
      );
      const results = await hydrateResults(client, accountId, result.rows);
      return results[0];
    });
  }

  listResults(accountId: string, input: CursorPageInput = {}): Promise<CursorPage<ResultRecord>> {
    return this.#read(async (client) => {
      const page = pageQuery(input, accountId);
      const result = await client.query<ResultRow>(
        `SELECT * FROM maxpower.results
          WHERE account_id = $1 AND deleted_at IS NULL
            ${page.cursorSql}
          ORDER BY created_at DESC, id DESC
          LIMIT $${page.params.length}`,
        page.params,
      );
      return finishPage(await hydrateResults(client, accountId, result.rows), page.limit);
    });
  }

  async transact<T>(accountId: string, operation: (state: ProductDataState) => T): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 11))",
        [accountId],
      );
      await requireActiveAccountForProductWrite(client, accountId);
      const state = await loadState(client, accountId);
      const baseline = structuredClone(state);
      const result = operation(state);
      await persistState(client, accountId, state, baseline);
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original failure; the pool will discard a broken client.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async #read<T>(operation: (client: PostgresClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      return await operation(client);
    } finally {
      client.release();
    }
  }
}

async function requireActiveAccountForProductWrite(
  client: PostgresClient,
  accountId: string,
): Promise<void> {
  const result = await client.query<{ account_status: string }>(
    `SELECT "accountStatus" AS account_status
       FROM "user"
      WHERE id = $1
      FOR SHARE`,
    [accountId],
  );
  if (result.rows[0]?.account_status !== "active") {
    throw forbidden("account_not_writable", "The account cannot accept writes.");
  }
}

interface ProfileRow {
  account_id: string;
  data: Profile["data"];
  display_name: string | null;
  locale: string;
  time_zone: string;
  unit_system: "metric" | "imperial";
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlanRow {
  account_id: string;
  id: string;
  title: string;
  status: "draft" | "published";
  current_version_id: string;
  published_version_id: string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface PlanVersionRow {
  id: string;
  plan_id: string;
  version_number: number;
  snapshot: PlanVersion["snapshot"];
  created_at: Date | string;
  published_at: Date | string | null;
}

interface WorkoutRow {
  account_id: string;
  id: string;
  plan_id: string | null;
  plan_version_id: string | null;
  plan_snapshot: StoredWorkoutSession["planSnapshot"];
  title: string;
  status: StoredWorkoutSession["status"];
  data: StoredWorkoutSession["data"];
  summary: StoredWorkoutSession["summary"];
  notes: string | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface ResultRow {
  account_id: string;
  id: string;
  kind: string;
  workout_session_id: string | null;
  payload: StoredResult["payload"];
  provenance: StoredResult["provenance"];
  occurred_at: Date | string;
  revision: number;
  created_at: Date | string;
  updated_at: Date | string;
  deleted_at: Date | string | null;
}

interface IdempotencyRow {
  idempotency_key: string;
  operation: string;
  fingerprint: string;
  result_jsonb: unknown;
  result_is_undefined: boolean;
}

interface MediaReferenceRow {
  resource_id: string;
  asset_id: string;
  evidence_status: MediaEvidenceReference["evidenceStatus"];
  evidence_deleted_at: Date | string | null;
}

async function loadState(client: PostgresClient, accountId: string): Promise<ProductDataState> {
  const state = emptyProductDataState();
  const profileResult = await client.query<ProfileRow>(
    "SELECT * FROM maxpower.profiles WHERE account_id = $1",
    [accountId],
  );
  const profileRow = profileResult.rows[0];
  if (profileRow !== undefined) state.profile = profileFromRow(profileRow);

  const planResult = await client.query<PlanRow>(
    "SELECT * FROM maxpower.plans WHERE account_id = $1",
    [accountId],
  );
  const versionResult = await client.query<PlanVersionRow>(
    `SELECT id, plan_id, version_number, snapshot, created_at, published_at
       FROM maxpower.plan_versions
      WHERE account_id = $1
      ORDER BY plan_id, version_number`,
    [accountId],
  );
  const versions = new Map<string, PlanVersion[]>();
  for (const row of versionResult.rows) {
    const planVersions = versions.get(row.plan_id) ?? [];
    planVersions.push({
      id: row.id,
      planId: row.plan_id,
      number: row.version_number,
      snapshot: structuredClone(row.snapshot),
      createdAt: iso(row.created_at),
      publishedAt: nullableIso(row.published_at),
    });
    versions.set(row.plan_id, planVersions);
  }
  for (const row of planResult.rows) {
    state.plans.set(row.id, {
      id: row.id,
      accountId: row.account_id,
      title: row.title,
      status: row.status,
      currentVersionId: row.current_version_id,
      publishedVersionId: row.published_version_id,
      revision: row.revision,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: nullableIso(row.deleted_at),
      versions: versions.get(row.id) ?? [],
    });
  }

  const workoutResult = await client.query<WorkoutRow>(
    "SELECT * FROM maxpower.workout_sessions WHERE account_id = $1",
    [accountId],
  );
  const workoutReferences = await loadReferenceMap(
    client,
    accountId,
    "maxpower.workout_session_media_references",
    "workout_session_id",
  );
  for (const row of workoutResult.rows) {
    state.workoutSessions.set(row.id, {
      id: row.id,
      accountId: row.account_id,
      planId: row.plan_id,
      planVersionId: row.plan_version_id,
      planSnapshot: structuredClone(row.plan_snapshot),
      title: row.title,
      status: row.status,
      data: structuredClone(row.data),
      summary: structuredClone(row.summary),
      notes: row.notes,
      mediaReferences: workoutReferences.get(row.id) ?? [],
      startedAt: iso(row.started_at),
      completedAt: nullableIso(row.completed_at),
      revision: row.revision,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: nullableIso(row.deleted_at),
    });
  }

  const resultRows = await client.query<ResultRow>(
    "SELECT * FROM maxpower.results WHERE account_id = $1",
    [accountId],
  );
  const resultReferences = await loadReferenceMap(
    client,
    accountId,
    "maxpower.result_media_references",
    "result_id",
  );
  for (const row of resultRows.rows) {
    state.results.set(row.id, {
      id: row.id,
      accountId: row.account_id,
      kind: row.kind,
      workoutSessionId: row.workout_session_id,
      payload: structuredClone(row.payload),
      provenance: structuredClone(row.provenance),
      mediaReferences: resultReferences.get(row.id) ?? [],
      occurredAt: iso(row.occurred_at),
      revision: row.revision,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      deletedAt: nullableIso(row.deleted_at),
    });
  }

  const idempotencyResult = await client.query<IdempotencyRow>(
    `SELECT idempotency_key, operation, fingerprint, result_jsonb, result_is_undefined
       FROM maxpower.product_idempotency
      WHERE account_id = $1`,
    [accountId],
  );
  for (const row of idempotencyResult.rows) {
    state.idempotency.set(row.idempotency_key, {
      operation: row.operation,
      fingerprint: row.fingerprint,
      result: row.result_is_undefined ? undefined : structuredClone(row.result_jsonb),
    });
  }
  return state;
}

async function persistState(
  client: PostgresClient,
  accountId: string,
  state: ProductDataState,
  baseline: ProductDataState,
): Promise<void> {
  if (state.profile !== null && !sameValue(state.profile, baseline.profile)) {
    await persistProfile(client, state.profile);
  }
  for (const plan of state.plans.values()) {
    if (sameValue(plan, baseline.plans.get(plan.id))) continue;
    await persistPlan(client, accountId, plan);
    for (const version of plan.versions) await persistPlanVersion(client, accountId, version);
  }
  for (const workout of state.workoutSessions.values()) {
    if (sameValue(workout, baseline.workoutSessions.get(workout.id))) continue;
    await persistWorkout(client, accountId, workout);
    await persistWorkoutReferences(client, accountId, workout);
    await persistWorkoutRevision(client, accountId, workout);
  }
  for (const result of state.results.values()) {
    if (sameValue(result, baseline.results.get(result.id))) continue;
    await persistResult(client, accountId, result);
    await persistResultReferences(client, accountId, result);
    await persistResultRevision(client, accountId, result);
  }
  for (const [key, record] of state.idempotency) {
    if (baseline.idempotency.has(key)) continue;
    await client.query(
      `INSERT INTO maxpower.product_idempotency
        (account_id, idempotency_key, operation, fingerprint, result_jsonb, result_is_undefined)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, idempotency_key) DO NOTHING`,
      [
        accountId,
        key,
        record.operation,
        record.fingerprint,
        record.result === undefined ? null : record.result,
        record.result === undefined,
      ],
    );
  }
}

async function persistProfile(client: PostgresClient, profile: Profile): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.profiles
      (account_id, data, display_name, locale, time_zone, unit_system, revision, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (account_id) DO UPDATE SET
       data = EXCLUDED.data,
       display_name = EXCLUDED.display_name,
       locale = EXCLUDED.locale,
       time_zone = EXCLUDED.time_zone,
       unit_system = EXCLUDED.unit_system,
       revision = EXCLUDED.revision,
       updated_at = EXCLUDED.updated_at`,
    [
      profile.accountId,
      profile.data,
      profile.displayName,
      profile.locale,
      profile.timeZone,
      profile.unitSystem,
      profile.revision,
      profile.createdAt,
      profile.updatedAt,
    ],
  );
}

async function persistPlan(
  client: PostgresClient,
  accountId: string,
  plan: StoredPlan,
): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.plans
      (account_id, id, title, status, current_version_id, published_version_id,
       revision, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (account_id, id) DO UPDATE SET
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       current_version_id = EXCLUDED.current_version_id,
       published_version_id = EXCLUDED.published_version_id,
       revision = EXCLUDED.revision,
       updated_at = EXCLUDED.updated_at,
       deleted_at = EXCLUDED.deleted_at`,
    [
      accountId,
      plan.id,
      plan.title,
      plan.status,
      plan.currentVersionId,
      plan.publishedVersionId,
      plan.revision,
      plan.createdAt,
      plan.updatedAt,
      plan.deletedAt,
    ],
  );
}

async function persistPlanVersion(
  client: PostgresClient,
  accountId: string,
  version: PlanVersion,
): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.plan_versions
      (account_id, id, plan_id, version_number, snapshot, created_at, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_id, id) DO UPDATE SET
       published_at = COALESCE(maxpower.plan_versions.published_at, EXCLUDED.published_at)`,
    [
      accountId,
      version.id,
      version.planId,
      version.number,
      version.snapshot,
      version.createdAt,
      version.publishedAt,
    ],
  );
}

async function persistWorkout(
  client: PostgresClient,
  accountId: string,
  workout: StoredWorkoutSession,
): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.workout_sessions
      (account_id, id, plan_id, plan_version_id, plan_snapshot, title, status, data,
       summary, notes, started_at, completed_at, revision, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     ON CONFLICT (account_id, id) DO UPDATE SET
       title = EXCLUDED.title,
       status = EXCLUDED.status,
       data = EXCLUDED.data,
       summary = EXCLUDED.summary,
       notes = EXCLUDED.notes,
       started_at = EXCLUDED.started_at,
       completed_at = EXCLUDED.completed_at,
       revision = EXCLUDED.revision,
       updated_at = EXCLUDED.updated_at,
       deleted_at = EXCLUDED.deleted_at`,
    [
      accountId,
      workout.id,
      workout.planId,
      workout.planVersionId,
      workout.planSnapshot,
      workout.title,
      workout.status,
      workout.data,
      workout.summary,
      workout.notes,
      workout.startedAt,
      workout.completedAt,
      workout.revision,
      workout.createdAt,
      workout.updatedAt,
      workout.deletedAt,
    ],
  );
}

async function persistResult(
  client: PostgresClient,
  accountId: string,
  result: StoredResult,
): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.results
      (account_id, id, kind, workout_session_id, payload, provenance, occurred_at,
       revision, created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (account_id, id) DO UPDATE SET
       kind = EXCLUDED.kind,
       payload = EXCLUDED.payload,
       provenance = EXCLUDED.provenance,
       occurred_at = EXCLUDED.occurred_at,
       revision = EXCLUDED.revision,
       updated_at = EXCLUDED.updated_at,
       deleted_at = EXCLUDED.deleted_at`,
    [
      accountId,
      result.id,
      result.kind,
      result.workoutSessionId,
      result.payload,
      result.provenance,
      result.occurredAt,
      result.revision,
      result.createdAt,
      result.updatedAt,
      result.deletedAt,
    ],
  );
}

async function persistWorkoutRevision(
  client: PostgresClient,
  accountId: string,
  workout: StoredWorkoutSession,
): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.workout_session_revisions
      (account_id, workout_session_id, revision, snapshot, recorded_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [accountId, workout.id, workout.revision, workout, workout.updatedAt],
  );
}

async function persistResultRevision(
  client: PostgresClient,
  accountId: string,
  result: StoredResult,
): Promise<void> {
  await client.query(
    `INSERT INTO maxpower.result_revisions
      (account_id, result_id, revision, snapshot, recorded_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [accountId, result.id, result.revision, result, result.updatedAt],
  );
}

async function persistWorkoutReferences(
  client: PostgresClient,
  accountId: string,
  workout: StoredWorkoutSession,
): Promise<void> {
  await validateAvailableReferences(client, accountId, workout.mediaReferences);
  const assetIds = workout.mediaReferences.map((reference) => reference.assetId);
  await client.query(
    `DELETE FROM maxpower.workout_session_media_references
      WHERE account_id = $1 AND workout_session_id = $2
        AND NOT (asset_id = ANY($3::text[]))`,
    [accountId, workout.id, assetIds],
  );
  for (const reference of workout.mediaReferences) {
    await client.query(
      `INSERT INTO maxpower.workout_session_media_references
        (account_id, workout_session_id, asset_id, evidence_status, linked_at,
         evidence_deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, workout_session_id, asset_id) DO UPDATE SET
         evidence_status = EXCLUDED.evidence_status,
         evidence_deleted_at = EXCLUDED.evidence_deleted_at`,
      [
        accountId,
        workout.id,
        reference.assetId,
        reference.evidenceStatus,
        workout.updatedAt,
        reference.evidenceDeletedAt,
      ],
    );
  }
}

async function persistResultReferences(
  client: PostgresClient,
  accountId: string,
  result: StoredResult,
): Promise<void> {
  await validateAvailableReferences(client, accountId, result.mediaReferences);
  const assetIds = result.mediaReferences.map((reference) => reference.assetId);
  await client.query(
    `DELETE FROM maxpower.result_media_references
      WHERE account_id = $1 AND result_id = $2
        AND NOT (asset_id = ANY($3::text[]))`,
    [accountId, result.id, assetIds],
  );
  for (const reference of result.mediaReferences) {
    await client.query(
      `INSERT INTO maxpower.result_media_references
        (account_id, result_id, asset_id, evidence_status, linked_at, evidence_deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (account_id, result_id, asset_id) DO UPDATE SET
         evidence_status = EXCLUDED.evidence_status,
         evidence_deleted_at = EXCLUDED.evidence_deleted_at`,
      [
        accountId,
        result.id,
        reference.assetId,
        reference.evidenceStatus,
        result.updatedAt,
        reference.evidenceDeletedAt,
      ],
    );
  }
}

async function validateAvailableReferences(
  client: PostgresClient,
  accountId: string,
  references: readonly MediaEvidenceReference[],
): Promise<void> {
  const availableIds = references
    .filter((reference) => reference.evidenceStatus === "available")
    .map((reference) => reference.assetId);
  if (availableIds.length === 0) return;
  const result = await client.query<{ id: string }>(
    `SELECT id FROM maxpower.media_assets
      WHERE account_id = $1 AND id = ANY($2::text[])
        AND status = 'ready' AND deleted_at IS NULL`,
    [accountId, availableIds],
  );
  if (result.rows.length !== availableIds.length) throw notFound("media_asset");
}

async function hydratePlans(
  client: PostgresClient,
  accountId: string,
  rows: readonly PlanRow[],
): Promise<Plan[]> {
  if (rows.length === 0) return [];
  const versionResult = await client.query<PlanVersionRow>(
    `SELECT id, plan_id, version_number, snapshot, created_at, published_at
       FROM maxpower.plan_versions
      WHERE account_id = $1 AND plan_id = ANY($2::text[])
      ORDER BY plan_id, version_number`,
    [accountId, rows.map((row) => row.id)],
  );
  const versions = new Map<string, PlanVersion[]>();
  for (const row of versionResult.rows) {
    const values = versions.get(row.plan_id) ?? [];
    values.push(planVersionFromRow(row));
    versions.set(row.plan_id, values);
  }
  return rows.map((row) => planFromRow(row, versions.get(row.id) ?? []));
}

async function hydrateWorkouts(
  client: PostgresClient,
  accountId: string,
  rows: readonly WorkoutRow[],
): Promise<WorkoutSession[]> {
  if (rows.length === 0) return [];
  const references = await loadReferenceMap(
    client,
    accountId,
    "maxpower.workout_session_media_references",
    "workout_session_id",
    rows.map((row) => row.id),
  );
  return rows.map((row) => workoutFromRow(row, references.get(row.id) ?? []));
}

async function hydrateResults(
  client: PostgresClient,
  accountId: string,
  rows: readonly ResultRow[],
): Promise<ResultRecord[]> {
  if (rows.length === 0) return [];
  const references = await loadReferenceMap(
    client,
    accountId,
    "maxpower.result_media_references",
    "result_id",
    rows.map((row) => row.id),
  );
  return rows.map((row) => resultFromRow(row, references.get(row.id) ?? []));
}

async function loadReferenceMap(
  client: PostgresClient,
  accountId: string,
  table: "maxpower.workout_session_media_references" | "maxpower.result_media_references",
  resourceColumn: "workout_session_id" | "result_id",
  resourceIds?: readonly string[],
): Promise<Map<string, MediaEvidenceReference[]>> {
  if (resourceIds !== undefined && resourceIds.length === 0) return new Map();
  const result = await client.query<MediaReferenceRow>(
    `SELECT ${resourceColumn} AS resource_id, asset_id, evidence_status, evidence_deleted_at
       FROM ${table}
      WHERE account_id = $1
        ${resourceIds === undefined ? "" : "AND " + resourceColumn + " = ANY($2::text[])"}
      ORDER BY ${resourceColumn}, asset_id`,
    resourceIds === undefined ? [accountId] : [accountId, resourceIds],
  );
  const references = new Map<string, MediaEvidenceReference[]>();
  for (const row of result.rows) {
    const values = references.get(row.resource_id) ?? [];
    values.push({
      assetId: row.asset_id,
      evidenceStatus: row.evidence_status,
      evidenceDeletedAt: nullableIso(row.evidence_deleted_at),
    });
    references.set(row.resource_id, values);
  }
  return references;
}

function planVersionFromRow(row: PlanVersionRow): PlanVersion {
  return {
    id: row.id,
    planId: row.plan_id,
    number: row.version_number,
    snapshot: structuredClone(row.snapshot),
    createdAt: iso(row.created_at),
    publishedAt: nullableIso(row.published_at),
  };
}

function planFromRow(row: PlanRow, versions: readonly PlanVersion[]): Plan {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    status: row.status,
    currentVersionId: row.current_version_id,
    publishedVersionId: row.published_version_id,
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    versions: structuredClone(versions),
  };
}

function workoutFromRow(
  row: WorkoutRow,
  mediaReferences: readonly MediaEvidenceReference[],
): WorkoutSession {
  return {
    id: row.id,
    accountId: row.account_id,
    planId: row.plan_id,
    planVersionId: row.plan_version_id,
    planSnapshot: structuredClone(row.plan_snapshot),
    title: row.title,
    status: row.status,
    data: structuredClone(row.data),
    summary: structuredClone(row.summary),
    notes: row.notes,
    mediaReferences: structuredClone(mediaReferences),
    startedAt: iso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function resultFromRow(
  row: ResultRow,
  mediaReferences: readonly MediaEvidenceReference[],
): ResultRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    workoutSessionId: row.workout_session_id,
    payload: structuredClone(row.payload),
    provenance: structuredClone(row.provenance),
    mediaReferences: structuredClone(mediaReferences),
    occurredAt: iso(row.occurred_at),
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function pageQuery(input: CursorPageInput, accountId: string): {
  limit: number;
  cursorSql: string;
  params: unknown[];
} {
  const { limit, position } = normalizeCursorPageInput(input);
  return position === null
    ? { limit, cursorSql: "", params: [accountId, limit + 1] }
    : {
        limit,
        cursorSql: "AND (created_at, id) < ($2::timestamptz, $3::text)",
        params: [accountId, position.createdAt, position.id, limit + 1],
      };
}

function finishPage<T extends CursorPosition>(values: readonly T[], limit: number): CursorPage<T> {
  const data = values.slice(0, limit);
  const last = data.at(-1);
  return {
    data,
    nextCursor: values.length > limit && last !== undefined
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function profileFromRow(row: ProfileRow): Profile {
  return {
    accountId: row.account_id,
    data: structuredClone(row.data),
    displayName: row.display_name,
    locale: row.locale,
    timeZone: row.time_zone,
    unitSystem: row.unit_system,
    revision: row.revision,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}
