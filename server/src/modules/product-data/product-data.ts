import { ApiError, conflict, forbidden, notFound } from "../../kernel/api-error.js";
import type { Clock } from "../../kernel/clock.js";
import { SystemClock } from "../../kernel/clock.js";
import type { IdFactory } from "../../kernel/ids.js";
import { randomId } from "../../kernel/ids.js";
import type { Principal } from "../../kernel/principal.js";
import { paginateByCreatedAt, type CursorPageInput } from "../../kernel/pagination.js";
import type {
  CompleteWorkoutSessionInput,
  CreatePlanInput,
  CreateResultInput,
  CreateWorkoutSessionInput,
  DeletePlanInput,
  DeleteResultInput,
  DeleteWorkoutSessionInput,
  JsonObject,
  MarkMediaEvidenceDeletedInput,
  PatchPlanInput,
  PatchProfileInput,
  PatchResultInput,
  PatchWorkoutSessionInput,
  Plan,
  PlanVersion,
  ProductData,
  Profile,
  PublishPlanInput,
  ResultRecord,
  WorkoutSession,
} from "./model.js";
import type {
  ProductDataState,
  ProductDataStateAdapter,
  StoredPlan,
  StoredResult,
  StoredWorkoutSession,
} from "./state-adapter.js";

export interface ProductDataModuleDependencies {
  adapter: ProductDataStateAdapter;
  clock?: Clock;
  ids?: IdFactory;
}

/**
 * The cloud-authoritative product-data module. Persistence details stay behind
 * the state adapter; callers see account-scoped use cases and their invariants.
 */
export class ProductDataModule implements ProductData {
  readonly #adapter: ProductDataStateAdapter;
  readonly #clock: Clock;
  readonly #ids: IdFactory;

  constructor(dependencies: ProductDataModuleDependencies) {
    this.#adapter = dependencies.adapter;
    this.#clock = dependencies.clock ?? new SystemClock();
    this.#ids = dependencies.ids ?? randomId;
  }

  getProfile(principal: Principal): Promise<Profile> {
    if (this.#adapter.readProfile !== undefined) {
      return this.#adapter.readProfile(principal.accountId).then((profile) =>
        profile ?? this.#adapter.transact(principal.accountId, (state) => {
          if (state.profile === null) state.profile = this.#defaultProfile(principal.accountId);
          return state.profile;
        })
      );
    }
    return this.#adapter.transact(principal.accountId, (state) => {
      if (state.profile === null) {
        state.profile = this.#defaultProfile(principal.accountId);
      }
      return state.profile;
    });
  }

  patchProfile(principal: Principal, input: PatchProfileInput): Promise<Profile> {
    assertNonEmptyPatch(input.patch);
    assertRevisionNumber(input.expectedRevision);
    if (input.patch.data !== undefined) requireJsonObject(input.patch.data, "data");
    return this.#write(principal, "profile.patch", input.idempotencyKey, input, (state, now) => {
      const profile = state.profile ?? this.#defaultProfile(principal.accountId, now);
      assertRevision(profile.revision, input.expectedRevision, profile);
      const next: Profile = {
        ...profile,
        ...(Object.hasOwn(input.patch, "displayName")
          ? { displayName: normalizeNullableText(input.patch.displayName, "displayName") }
          : {}),
        ...(input.patch.locale === undefined
          ? {}
          : { locale: requireText(input.patch.locale, "locale") }),
        ...(input.patch.timeZone === undefined
          ? {}
          : { timeZone: requireText(input.patch.timeZone, "timeZone") }),
        ...(input.patch.unitSystem === undefined
          ? {}
          : { unitSystem: input.patch.unitSystem }),
        ...(input.patch.data === undefined ? {} : { data: cloneJson(input.patch.data) }),
        revision: profile.revision + 1,
        updatedAt: now,
      };
      state.profile = next;
      return next;
    });
  }

  createPlan(principal: Principal, input: CreatePlanInput): Promise<Plan> {
    const title = requireText(input.title, "title");
    requireJsonObject(input.snapshot, "snapshot");
    return this.#write(principal, "plan.create", input.idempotencyKey, input, (state, now) => {
      const planId = this.#ids("plan");
      const version: PlanVersion = {
        id: this.#ids("plan_version"),
        planId,
        number: 1,
        snapshot: cloneJson(input.snapshot),
        createdAt: now,
        publishedAt: null,
      };
      const plan: StoredPlan = {
        id: planId,
        accountId: principal.accountId,
        title,
        status: "draft",
        currentVersionId: version.id,
        publishedVersionId: null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        versions: [version],
      };
      state.plans.set(plan.id, plan);
      return publicPlan(plan);
    });
  }

  listPlans(principal: Principal, input: CursorPageInput = {}) {
    if (this.#adapter.listPlans !== undefined) {
      return this.#adapter.listPlans(principal.accountId, input);
    }
    return this.#adapter.transact(principal.accountId, (state) =>
      paginateByCreatedAt(
        [...state.plans.values()]
        .filter((plan) => plan.deletedAt === null)
        .map(publicPlan),
        input,
      ),
    );
  }

  getPlan(principal: Principal, planId: string): Promise<Plan> {
    if (this.#adapter.readPlan !== undefined) {
      return this.#adapter.readPlan(principal.accountId, planId).then((plan) => {
        if (plan === undefined) throw notFound("plan");
        return plan;
      });
    }
    return this.#adapter.transact(principal.accountId, (state) =>
      publicPlan(requirePlan(state, planId)),
    );
  }

  patchPlan(principal: Principal, input: PatchPlanInput): Promise<Plan> {
    assertNonEmptyPatch(input.patch);
    assertRevisionNumber(input.expectedRevision);
    if (input.patch.title !== undefined) requireText(input.patch.title, "title");
    if (input.patch.snapshot !== undefined) requireJsonObject(input.patch.snapshot, "snapshot");

    return this.#write(principal, "plan.patch", input.idempotencyKey, input, (state, now) => {
      const plan = requirePlan(state, input.planId);
      assertRevision(plan.revision, input.expectedRevision, publicPlan(plan));

      if (input.patch.title !== undefined) plan.title = input.patch.title.trim();
      if (input.patch.snapshot !== undefined) {
        const version: PlanVersion = {
          id: this.#ids("plan_version"),
          planId: plan.id,
          number: plan.versions.length + 1,
          snapshot: cloneJson(input.patch.snapshot),
          createdAt: now,
          publishedAt: null,
        };
        plan.versions = [...plan.versions, version];
        plan.currentVersionId = version.id;
        plan.status = "draft";
      }
      plan.revision += 1;
      plan.updatedAt = now;
      return publicPlan(plan);
    });
  }

  publishPlan(principal: Principal, input: PublishPlanInput): Promise<Plan> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(principal, "plan.publish", input.idempotencyKey, input, (state, now) => {
      const plan = requirePlan(state, input.planId);
      assertRevision(plan.revision, input.expectedRevision, publicPlan(plan));
      const current = plan.versions.find((version) => version.id === plan.currentVersionId);
      if (current === undefined) throw new ApiError(500, "plan_version_missing", "Current plan version is missing.");
      plan.versions = plan.versions.map((version) =>
        version.id === current.id ? { ...version, publishedAt: now } : version,
      );
      plan.publishedVersionId = current.id;
      plan.status = "published";
      plan.revision += 1;
      plan.updatedAt = now;
      return publicPlan(plan);
    });
  }

  deletePlan(principal: Principal, input: DeletePlanInput): Promise<void> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(principal, "plan.delete", input.idempotencyKey, input, (state, now) => {
      const plan = requirePlan(state, input.planId);
      assertRevision(plan.revision, input.expectedRevision, publicPlan(plan));
      plan.deletedAt = now;
      plan.revision += 1;
      plan.updatedAt = now;
    });
  }

  createWorkoutSession(
    principal: Principal,
    input: CreateWorkoutSessionInput,
  ): Promise<WorkoutSession> {
    const title = requireText(input.title, "title");
    if (input.data !== undefined) requireJsonObject(input.data, "data");
    if (input.startedAt !== undefined) requireTimestamp(input.startedAt, "startedAt");

    return this.#write(
      principal,
      "workout_session.create",
      input.idempotencyKey,
      input,
      (state, now) => {
        const plan = input.planId === undefined ? null : requirePlan(state, input.planId);
        const version = plan === null
          ? null
          : plan.versions.find((candidate) => candidate.id === plan.currentVersionId) ?? null;
        if (plan !== null && version === null) {
          throw new ApiError(500, "plan_version_missing", "Current plan version is missing.");
        }
        const session: StoredWorkoutSession = {
          id: this.#ids("workout_session"),
          accountId: principal.accountId,
          planId: plan?.id ?? null,
          planVersionId: version?.id ?? null,
          planSnapshot: version === null ? null : cloneJson(version.snapshot),
          title,
          status: "in_progress",
          data: cloneJson(input.data ?? {}),
          summary: null,
          notes: null,
          mediaReferences: availableMediaReferences(input.mediaAssetIds),
          startedAt: input.startedAt ?? now,
          completedAt: null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        state.workoutSessions.set(session.id, session);
        return publicWorkoutSession(session);
      },
    );
  }

  listWorkoutSessions(principal: Principal, input: CursorPageInput = {}) {
    if (this.#adapter.listWorkoutSessions !== undefined) {
      return this.#adapter.listWorkoutSessions(principal.accountId, input);
    }
    return this.#adapter.transact(principal.accountId, (state) =>
      paginateByCreatedAt(
        [...state.workoutSessions.values()]
        .filter((session) => session.deletedAt === null)
        .map(publicWorkoutSession),
        input,
      ),
    );
  }

  getWorkoutSession(principal: Principal, workoutSessionId: string): Promise<WorkoutSession> {
    if (this.#adapter.readWorkoutSession !== undefined) {
      return this.#adapter.readWorkoutSession(principal.accountId, workoutSessionId).then((session) => {
        if (session === undefined) throw notFound("workout_session");
        return session;
      });
    }
    return this.#adapter.transact(principal.accountId, (state) =>
      publicWorkoutSession(requireWorkoutSession(state, workoutSessionId)),
    );
  }

  patchWorkoutSession(
    principal: Principal,
    input: PatchWorkoutSessionInput,
  ): Promise<WorkoutSession> {
    assertNonEmptyPatch(input.patch);
    assertRevisionNumber(input.expectedRevision);
    if (input.patch.title !== undefined) requireText(input.patch.title, "title");
    if (input.patch.data !== undefined) requireJsonObject(input.patch.data, "data");
    if (input.patch.startedAt !== undefined) requireTimestamp(input.patch.startedAt, "startedAt");

    return this.#write(
      principal,
      "workout_session.patch",
      input.idempotencyKey,
      input,
      (state, now) => {
        const session = requireWorkoutSession(state, input.workoutSessionId);
        assertRevision(session.revision, input.expectedRevision, publicWorkoutSession(session));
        if (session.status === "completed") {
          throw conflict(
            "completed_workout_immutable",
            "A completed workout must be corrected through a new linked record.",
          );
        }
        if (input.patch.title !== undefined) session.title = input.patch.title.trim();
        if (input.patch.data !== undefined) session.data = cloneJson(input.patch.data);
        if (Object.hasOwn(input.patch, "notes")) {
          session.notes = normalizeNullableText(input.patch.notes, "notes");
        }
        if (input.patch.startedAt !== undefined) session.startedAt = input.patch.startedAt;
        if (input.patch.mediaAssetIds !== undefined) {
          session.mediaReferences = replaceMediaReferences(
            session.mediaReferences,
            input.patch.mediaAssetIds,
          );
        }
        session.revision += 1;
        session.updatedAt = now;
        return publicWorkoutSession(session);
      },
    );
  }

  completeWorkoutSession(
    principal: Principal,
    input: CompleteWorkoutSessionInput,
  ): Promise<WorkoutSession> {
    assertRevisionNumber(input.expectedRevision);
    requireJsonObject(input.summary, "summary");
    if (input.completedAt !== undefined) requireTimestamp(input.completedAt, "completedAt");

    return this.#write(
      principal,
      "workout_session.complete",
      input.idempotencyKey,
      input,
      (state, now) => {
        const session = requireWorkoutSession(state, input.workoutSessionId);
        assertRevision(session.revision, input.expectedRevision, publicWorkoutSession(session));
        if (session.status === "completed") {
          throw conflict("workout_already_completed", "Workout session is already completed.");
        }
        session.status = "completed";
        session.summary = cloneJson(input.summary);
        session.completedAt = input.completedAt ?? now;
        session.revision += 1;
        session.updatedAt = now;
        return publicWorkoutSession(session);
      },
    );
  }

  deleteWorkoutSession(principal: Principal, input: DeleteWorkoutSessionInput): Promise<void> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(
      principal,
      "workout_session.delete",
      input.idempotencyKey,
      input,
      (state, now) => {
        const session = requireWorkoutSession(state, input.workoutSessionId);
        assertRevision(session.revision, input.expectedRevision, publicWorkoutSession(session));
        session.deletedAt = now;
        session.revision += 1;
        session.updatedAt = now;
      },
    );
  }

  createResult(principal: Principal, input: CreateResultInput): Promise<ResultRecord> {
    const kind = requireText(input.kind, "kind");
    requireJsonObject(input.payload, "payload");
    if (input.provenance !== undefined) requireJsonObject(input.provenance, "provenance");
    if (input.occurredAt !== undefined) requireTimestamp(input.occurredAt, "occurredAt");

    return this.#write(principal, "result.create", input.idempotencyKey, input, (state, now) => {
      if (input.workoutSessionId !== undefined) {
        requireWorkoutSession(state, input.workoutSessionId);
      }
      const result: StoredResult = {
        id: this.#ids("result"),
        accountId: principal.accountId,
        kind,
        workoutSessionId: input.workoutSessionId ?? null,
        payload: cloneJson(input.payload),
        provenance: cloneJson(input.provenance ?? {}),
        mediaReferences: availableMediaReferences(input.mediaAssetIds),
        occurredAt: input.occurredAt ?? now,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      state.results.set(result.id, result);
      return publicResult(result);
    });
  }

  listResults(principal: Principal, input: CursorPageInput = {}) {
    if (this.#adapter.listResults !== undefined) {
      return this.#adapter.listResults(principal.accountId, input);
    }
    return this.#adapter.transact(principal.accountId, (state) =>
      paginateByCreatedAt(
        [...state.results.values()]
        .filter((result) => result.deletedAt === null)
        .map(publicResult),
        input,
      ),
    );
  }

  getResult(principal: Principal, resultId: string): Promise<ResultRecord> {
    if (this.#adapter.readResult !== undefined) {
      return this.#adapter.readResult(principal.accountId, resultId).then((result) => {
        if (result === undefined) throw notFound("result");
        return result;
      });
    }
    return this.#adapter.transact(principal.accountId, (state) =>
      publicResult(requireResult(state, resultId)),
    );
  }

  patchResult(principal: Principal, input: PatchResultInput): Promise<ResultRecord> {
    assertNonEmptyPatch(input.patch);
    assertRevisionNumber(input.expectedRevision);
    if (input.patch.kind !== undefined) requireText(input.patch.kind, "kind");
    if (input.patch.payload !== undefined) requireJsonObject(input.patch.payload, "payload");
    if (input.patch.provenance !== undefined) requireJsonObject(input.patch.provenance, "provenance");
    if (input.patch.occurredAt !== undefined) requireTimestamp(input.patch.occurredAt, "occurredAt");

    return this.#write(principal, "result.patch", input.idempotencyKey, input, (state, now) => {
      const result = requireResult(state, input.resultId);
      assertRevision(result.revision, input.expectedRevision, publicResult(result));
      if (input.patch.kind !== undefined) result.kind = input.patch.kind.trim();
      if (input.patch.payload !== undefined) result.payload = cloneJson(input.patch.payload);
      if (input.patch.provenance !== undefined) result.provenance = cloneJson(input.patch.provenance);
      if (input.patch.occurredAt !== undefined) result.occurredAt = input.patch.occurredAt;
      if (input.patch.mediaAssetIds !== undefined) {
        result.mediaReferences = replaceMediaReferences(
          result.mediaReferences,
          input.patch.mediaAssetIds,
        );
      }
      result.revision += 1;
      result.updatedAt = now;
      return publicResult(result);
    });
  }

  deleteResult(principal: Principal, input: DeleteResultInput): Promise<void> {
    assertRevisionNumber(input.expectedRevision);
    return this.#write(principal, "result.delete", input.idempotencyKey, input, (state, now) => {
      const result = requireResult(state, input.resultId);
      assertRevision(result.revision, input.expectedRevision, publicResult(result));
      result.deletedAt = now;
      result.revision += 1;
      result.updatedAt = now;
    });
  }

  markMediaEvidenceDeleted(input: MarkMediaEvidenceDeletedInput): Promise<void> {
    const assetIds = new Set(normalizeMediaAssetIds(input.assetIds));
    requireTimestamp(input.deletedAt, "deletedAt");
    if (assetIds.size === 0) return Promise.resolve();
    return this.#adapter.transact(input.accountId, (state) => {
      for (const session of state.workoutSessions.values()) {
        const next = markEvidenceDeleted(session.mediaReferences, assetIds, input.deletedAt);
        if (next === session.mediaReferences) continue;
        session.mediaReferences = next;
        session.revision += 1;
        session.updatedAt = input.deletedAt;
      }
      for (const result of state.results.values()) {
        const next = markEvidenceDeleted(result.mediaReferences, assetIds, input.deletedAt);
        if (next === result.mediaReferences) continue;
        result.mediaReferences = next;
        result.revision += 1;
        result.updatedAt = input.deletedAt;
      }
    });
  }

  #defaultProfile(accountId: string, timestamp = this.#clock.now().toISOString()): Profile {
    return {
      accountId,
      data: {},
      displayName: null,
      locale: "en",
      timeZone: "UTC",
      unitSystem: "metric",
      revision: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  #write<T>(
    principal: Principal,
    operation: string,
    idempotencyKey: string,
    request: unknown,
    mutation: (state: ProductDataState, now: string) => T,
  ): Promise<T> {
    assertWritable(principal);
    const key = requireText(idempotencyKey, "idempotencyKey");
    const fingerprint = stableStringify(request);
    return this.#adapter.transact(principal.accountId, (state) => {
      const existing = state.idempotency.get(key);
      if (existing !== undefined) {
        if (existing.operation !== operation || existing.fingerprint !== fingerprint) {
          throw conflict(
            "idempotency_key_reused",
            "The idempotency key was already used for a different request.",
          );
        }
        return structuredClone(existing.result) as T;
      }

      const result = mutation(state, this.#clock.now().toISOString());
      state.idempotency.set(key, {
        operation,
        fingerprint,
        result: structuredClone(result),
      });
      return result;
    });
  }
}

function assertWritable(principal: Principal): void {
  if (principal.status !== "active") {
    throw forbidden("account_not_writable", "The account cannot accept writes.");
  }
}

function assertRevision(actual: number, expected: number, current: unknown): void {
  if (actual !== expected) {
    throw conflict("revision_conflict", "The resource was modified by another request.", {
      expectedRevision: expected,
      actualRevision: actual,
      current,
    });
  }
}

function assertRevisionNumber(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new ApiError(400, "invalid_revision", "expectedRevision must be a positive integer.");
  }
}

function requirePlan(state: ProductDataState, id: string): StoredPlan {
  const plan = state.plans.get(id);
  if (plan === undefined || plan.deletedAt !== null) throw notFound("plan");
  return plan;
}

function requireWorkoutSession(state: ProductDataState, id: string): StoredWorkoutSession {
  const session = state.workoutSessions.get(id);
  if (session === undefined || session.deletedAt !== null) throw notFound("workout_session");
  return session;
}

function requireResult(state: ProductDataState, id: string): StoredResult {
  const result = state.results.get(id);
  if (result === undefined || result.deletedAt !== null) throw notFound("result");
  return result;
}

function publicPlan(plan: StoredPlan): Plan {
  return {
    id: plan.id,
    accountId: plan.accountId,
    title: plan.title,
    status: plan.status,
    currentVersionId: plan.currentVersionId,
    publishedVersionId: plan.publishedVersionId,
    revision: plan.revision,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    versions: structuredClone(plan.versions),
  };
}

function publicWorkoutSession(session: StoredWorkoutSession): WorkoutSession {
  return {
    id: session.id,
    accountId: session.accountId,
    planId: session.planId,
    planVersionId: session.planVersionId,
    planSnapshot: structuredClone(session.planSnapshot),
    title: session.title,
    status: session.status,
    data: cloneJson(session.data),
    summary: structuredClone(session.summary),
    notes: session.notes,
    mediaReferences: structuredClone(session.mediaReferences),
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    revision: session.revision,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function publicResult(result: StoredResult): ResultRecord {
  return {
    id: result.id,
    accountId: result.accountId,
    kind: result.kind,
    workoutSessionId: result.workoutSessionId,
    payload: cloneJson(result.payload),
    provenance: cloneJson(result.provenance),
    mediaReferences: structuredClone(result.mediaReferences),
    occurredAt: result.occurredAt,
    revision: result.revision,
    createdAt: result.createdAt,
    updatedAt: result.updatedAt,
  };
}

function availableMediaReferences(assetIds: readonly string[] | undefined) {
  return normalizeMediaAssetIds(assetIds ?? []).map((assetId) => ({
    assetId,
    evidenceStatus: "available" as const,
    evidenceDeletedAt: null,
  }));
}

function replaceMediaReferences(
  current: WorkoutSession["mediaReferences"],
  assetIds: readonly string[],
): WorkoutSession["mediaReferences"] {
  const byId = new Map(current.map((reference) => [reference.assetId, reference]));
  return normalizeMediaAssetIds(assetIds).map((assetId) =>
    structuredClone(byId.get(assetId) ?? {
      assetId,
      evidenceStatus: "available" as const,
      evidenceDeletedAt: null,
    }),
  );
}

function markEvidenceDeleted(
  current: WorkoutSession["mediaReferences"],
  assetIds: ReadonlySet<string>,
  deletedAt: string,
): WorkoutSession["mediaReferences"] {
  let changed = false;
  const next = current.map((reference) => {
    if (!assetIds.has(reference.assetId) || reference.evidenceStatus === "evidence_deleted") {
      return reference;
    }
    changed = true;
    return {
      ...reference,
      evidenceStatus: "evidence_deleted" as const,
      evidenceDeletedAt: deletedAt,
    };
  });
  return changed ? next : current;
}

function normalizeMediaAssetIds(values: readonly string[]): string[] {
  const ids = values.map((value) => requireText(value, "mediaAssetId"));
  if (ids.length > 32) {
    throw new ApiError(400, "invalid_request", "At most 32 media assets may be linked.", {
      field: "mediaAssetIds",
    });
  }
  return [...new Set(ids)].sort();
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ApiError(400, "invalid_request", `${field} must not be empty.`, { field });
  }
  return normalized;
}

function normalizeNullableText(value: string | null | undefined, field: string): string | null {
  if (value === null) return null;
  if (value === undefined) {
    throw new ApiError(400, "invalid_request", `${field} is required.`, { field });
  }
  return requireText(value, field);
}

function assertNonEmptyPatch(patch: object): void {
  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "empty_patch", "At least one field must be patched.");
  }
}

function requireTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new ApiError(400, "invalid_request", `${field} must be an ISO timestamp.`, { field });
  }
}

function requireJsonObject(value: JsonObject, field: string): void {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.startsWith("[") || serialized === "null") throw new Error();
    JSON.parse(serialized) as unknown;
  } catch {
    throw new ApiError(400, "invalid_request", `${field} must be a JSON object.`, { field });
  }
}

function cloneJson<T extends JsonObject>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}
