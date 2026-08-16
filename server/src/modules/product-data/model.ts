import type { Principal } from "../../kernel/principal.js";
import type { CursorPage, CursorPageInput } from "../../kernel/pagination.js";

export type { CursorPage, CursorPageInput } from "../../kernel/pagination.js";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface Profile {
  accountId: string;
  /** Versioned, server-opaque domain recovery envelope for a new device. */
  data: JsonObject;
  displayName: string | null;
  locale: string;
  timeZone: string;
  unitSystem: "metric" | "imperial";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface PatchProfileInput {
  patch: {
    displayName?: string | null;
    locale?: string;
    timeZone?: string;
    unitSystem?: "metric" | "imperial";
    data?: JsonObject;
  };
  expectedRevision: number;
  idempotencyKey: string;
}

export type PlanStatus = "draft" | "published";

export interface PlanVersion {
  id: string;
  planId: string;
  number: number;
  snapshot: JsonObject;
  createdAt: string;
  publishedAt: string | null;
}

export interface Plan {
  id: string;
  accountId: string;
  title: string;
  status: PlanStatus;
  currentVersionId: string;
  publishedVersionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  versions: readonly PlanVersion[];
}

export interface CreatePlanInput {
  title: string;
  snapshot: JsonObject;
  idempotencyKey: string;
}

export interface PatchPlanInput {
  planId: string;
  patch: {
    title?: string;
    snapshot?: JsonObject;
  };
  expectedRevision: number;
  idempotencyKey: string;
}

export interface PublishPlanInput {
  planId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface DeletePlanInput {
  planId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export type WorkoutSessionStatus = "in_progress" | "completed";

export type MediaEvidenceStatus = "available" | "evidence_deleted";

/** Typed, account-scoped link to an optional MediaLibrary asset. */
export interface MediaEvidenceReference {
  assetId: string;
  evidenceStatus: MediaEvidenceStatus;
  evidenceDeletedAt: string | null;
}

export interface WorkoutSession {
  id: string;
  accountId: string;
  planId: string | null;
  planVersionId: string | null;
  planSnapshot: JsonObject | null;
  title: string;
  status: WorkoutSessionStatus;
  data: JsonObject;
  summary: JsonObject | null;
  notes: string | null;
  mediaReferences: readonly MediaEvidenceReference[];
  startedAt: string;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkoutSessionInput {
  planId?: string;
  title: string;
  data?: JsonObject;
  mediaAssetIds?: readonly string[];
  startedAt?: string;
  idempotencyKey: string;
}

export interface PatchWorkoutSessionInput {
  workoutSessionId: string;
  patch: {
    title?: string;
    data?: JsonObject;
    notes?: string | null;
    startedAt?: string;
    mediaAssetIds?: readonly string[];
  };
  expectedRevision: number;
  idempotencyKey: string;
}

export interface CompleteWorkoutSessionInput {
  workoutSessionId: string;
  summary: JsonObject;
  completedAt?: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface DeleteWorkoutSessionInput {
  workoutSessionId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface ResultRecord {
  id: string;
  accountId: string;
  kind: string;
  workoutSessionId: string | null;
  payload: JsonObject;
  provenance: JsonObject;
  mediaReferences: readonly MediaEvidenceReference[];
  occurredAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateResultInput {
  kind: string;
  workoutSessionId?: string;
  payload: JsonObject;
  provenance?: JsonObject;
  mediaAssetIds?: readonly string[];
  occurredAt?: string;
  idempotencyKey: string;
}

export interface PatchResultInput {
  resultId: string;
  patch: {
    kind?: string;
    payload?: JsonObject;
    provenance?: JsonObject;
    occurredAt?: string;
    mediaAssetIds?: readonly string[];
  };
  expectedRevision: number;
  idempotencyKey: string;
}

export interface DeleteResultInput {
  resultId: string;
  expectedRevision: number;
  idempotencyKey: string;
}

export interface MarkMediaEvidenceDeletedInput {
  accountId: string;
  assetIds: readonly string[];
  deletedAt: string;
}

/** Internal lifecycle seam used by MediaLibrary after recursive byte deletion. */
export interface MediaEvidenceLifecycle {
  markMediaEvidenceDeleted(input: MarkMediaEvidenceDeletedInput): Promise<void>;
}

export interface ProductData {
  getProfile(principal: Principal): Promise<Profile>;
  patchProfile(principal: Principal, input: PatchProfileInput): Promise<Profile>;

  createPlan(principal: Principal, input: CreatePlanInput): Promise<Plan>;
  listPlans(principal: Principal, input?: CursorPageInput): Promise<CursorPage<Plan>>;
  getPlan(principal: Principal, planId: string): Promise<Plan>;
  patchPlan(principal: Principal, input: PatchPlanInput): Promise<Plan>;
  publishPlan(principal: Principal, input: PublishPlanInput): Promise<Plan>;
  deletePlan(principal: Principal, input: DeletePlanInput): Promise<void>;

  createWorkoutSession(
    principal: Principal,
    input: CreateWorkoutSessionInput,
  ): Promise<WorkoutSession>;
  listWorkoutSessions(
    principal: Principal,
    input?: CursorPageInput,
  ): Promise<CursorPage<WorkoutSession>>;
  getWorkoutSession(principal: Principal, workoutSessionId: string): Promise<WorkoutSession>;
  patchWorkoutSession(
    principal: Principal,
    input: PatchWorkoutSessionInput,
  ): Promise<WorkoutSession>;
  completeWorkoutSession(
    principal: Principal,
    input: CompleteWorkoutSessionInput,
  ): Promise<WorkoutSession>;
  deleteWorkoutSession(principal: Principal, input: DeleteWorkoutSessionInput): Promise<void>;

  createResult(principal: Principal, input: CreateResultInput): Promise<ResultRecord>;
  listResults(principal: Principal, input?: CursorPageInput): Promise<CursorPage<ResultRecord>>;
  getResult(principal: Principal, resultId: string): Promise<ResultRecord>;
  patchResult(principal: Principal, input: PatchResultInput): Promise<ResultRecord>;
  deleteResult(principal: Principal, input: DeleteResultInput): Promise<void>;
}
