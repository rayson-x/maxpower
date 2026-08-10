export type CloudJsonPrimitive = boolean | number | string | null;
export type CloudJsonValue = CloudJsonPrimitive | CloudJsonObject | readonly CloudJsonValue[];
export interface CloudJsonObject {
  readonly [key: string]: CloudJsonValue;
}

/** These are the only product resource families that may cross the cloud seam. */
export const CLOUD_CANONICAL_RESOURCE_KINDS = [
  "profile",
  "plan",
  "workout_session",
  "result",
] as const;
export type CloudCanonicalResourceKind = typeof CLOUD_CANONICAL_RESOURCE_KINDS[number];

export interface CloudProfile {
  accountId: string;
  data: CloudJsonObject;
  displayName: string | null;
  locale: string;
  timeZone: string;
  unitSystem: "metric" | "imperial";
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudPlanVersion {
  id: string;
  planId: string;
  number: number;
  snapshot: CloudJsonObject;
  createdAt: string;
  publishedAt: string | null;
}

export interface CloudPlan {
  id: string;
  accountId: string;
  title: string;
  status: "draft" | "published";
  currentVersionId: string;
  publishedVersionId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  versions: readonly CloudPlanVersion[];
}

export interface CloudMediaEvidenceReference {
  assetId: string;
  evidenceStatus: "available" | "evidence_deleted";
  evidenceDeletedAt: string | null;
}

export interface CloudWorkoutSession {
  id: string;
  accountId: string;
  planId: string | null;
  planVersionId: string | null;
  planSnapshot: CloudJsonObject | null;
  title: string;
  status: "in_progress" | "completed";
  data: CloudJsonObject;
  summary: CloudJsonObject | null;
  notes: string | null;
  mediaReferences: readonly CloudMediaEvidenceReference[];
  startedAt: string;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudResult {
  id: string;
  accountId: string;
  kind: string;
  workoutSessionId: string | null;
  payload: CloudJsonObject;
  provenance: CloudJsonObject;
  mediaReferences: readonly CloudMediaEvidenceReference[];
  occurredAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type CloudCanonicalResource = CloudProfile | CloudPlan | CloudWorkoutSession | CloudResult;

/**
 * One cloud-authoritative snapshot. CoachSession, Message and AgentRun have no
 * field or resource discriminator here and remain in the account-local Ledger.
 */
export interface CloudCanonicalProjection {
  accountId: string;
  profile: CloudProfile;
  plans: readonly CloudPlan[];
  workoutSessions: readonly CloudWorkoutSession[];
  results: readonly CloudResult[];
  fetchedAt: string;
}

export interface CloudPage<T> {
  data: readonly T[];
  nextCursor: string | null;
}

export interface RevisionWrite {
  expectedRevision: number;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface PatchCloudProfileInput extends RevisionWrite {
  patch: {
    displayName?: string | null;
    locale?: string;
    timeZone?: string;
    unitSystem?: "metric" | "imperial";
    data?: CloudJsonObject;
  };
}

export interface CreateCloudPlanInput {
  title: string;
  snapshot: CloudJsonObject;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface PatchCloudPlanInput extends RevisionWrite {
  planId: string;
  patch: { title?: string; snapshot?: CloudJsonObject };
}

export interface PublishCloudPlanInput extends RevisionWrite { planId: string; }
export interface DeleteCloudPlanInput extends RevisionWrite { planId: string; }

export interface CreateCloudWorkoutSessionInput {
  planId?: string;
  title: string;
  data?: CloudJsonObject;
  mediaAssetIds?: readonly string[];
  startedAt?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface PatchCloudWorkoutSessionInput extends RevisionWrite {
  workoutSessionId: string;
  patch: {
    title?: string;
    data?: CloudJsonObject;
    notes?: string | null;
    startedAt?: string;
    mediaAssetIds?: readonly string[];
  };
}

export interface CompleteCloudWorkoutSessionInput extends RevisionWrite {
  workoutSessionId: string;
  summary: CloudJsonObject;
  completedAt?: string;
}

export interface DeleteCloudWorkoutSessionInput extends RevisionWrite { workoutSessionId: string; }

export interface CreateCloudResultInput {
  kind: string;
  workoutSessionId?: string;
  payload: CloudJsonObject;
  provenance?: CloudJsonObject;
  mediaAssetIds?: readonly string[];
  occurredAt?: string;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface PatchCloudResultInput extends RevisionWrite {
  resultId: string;
  patch: {
    kind?: string;
    payload?: CloudJsonObject;
    provenance?: CloudJsonObject;
    mediaAssetIds?: readonly string[];
    occurredAt?: string;
  };
}

export interface DeleteCloudResultInput extends RevisionWrite { resultId: string; }

export function parseCloudProfile(value: unknown): CloudProfile {
  const row = record(value);
  const unitSystem = text(row.unitSystem);
  if (unitSystem !== "metric" && unitSystem !== "imperial") throw invalidCloudData();
  return {
    accountId: text(row.accountId),
    data: jsonObject(row.data),
    displayName: nullableText(row.displayName),
    locale: text(row.locale),
    timeZone: text(row.timeZone),
    unitSystem,
    revision: positiveRevision(row.revision),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

export function parseCloudPlan(value: unknown): CloudPlan {
  const row = record(value);
  const status = text(row.status);
  if (status !== "draft" && status !== "published") throw invalidCloudData();
  if (!Array.isArray(row.versions)) throw invalidCloudData();
  return {
    id: text(row.id),
    accountId: text(row.accountId),
    title: text(row.title),
    status,
    currentVersionId: text(row.currentVersionId),
    publishedVersionId: nullableText(row.publishedVersionId),
    revision: positiveRevision(row.revision),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
    versions: row.versions.map(parseCloudPlanVersion),
  };
}

export function parseCloudWorkoutSession(value: unknown): CloudWorkoutSession {
  const row = record(value);
  const status = text(row.status);
  if (status !== "in_progress" && status !== "completed") throw invalidCloudData();
  if (!Array.isArray(row.mediaReferences)) throw invalidCloudData();
  return {
    id: text(row.id),
    accountId: text(row.accountId),
    planId: nullableText(row.planId),
    planVersionId: nullableText(row.planVersionId),
    planSnapshot: nullableJsonObject(row.planSnapshot),
    title: text(row.title),
    status,
    data: jsonObject(row.data),
    summary: nullableJsonObject(row.summary),
    notes: nullableText(row.notes),
    mediaReferences: row.mediaReferences.map(parseMediaReference),
    startedAt: text(row.startedAt),
    completedAt: nullableText(row.completedAt),
    revision: positiveRevision(row.revision),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

export function parseCloudResult(value: unknown): CloudResult {
  const row = record(value);
  if (!Array.isArray(row.mediaReferences)) throw invalidCloudData();
  return {
    id: text(row.id),
    accountId: text(row.accountId),
    kind: text(row.kind),
    workoutSessionId: nullableText(row.workoutSessionId),
    payload: jsonObject(row.payload),
    provenance: jsonObject(row.provenance),
    mediaReferences: row.mediaReferences.map(parseMediaReference),
    occurredAt: text(row.occurredAt),
    revision: positiveRevision(row.revision),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt),
  };
}

export function parseCloudCanonicalProjection(value: unknown): CloudCanonicalProjection {
  const row = record(value);
  if (!Array.isArray(row.plans) || !Array.isArray(row.workoutSessions) || !Array.isArray(row.results)) {
    throw invalidCloudData();
  }
  return {
    accountId: text(row.accountId),
    profile: parseCloudProfile(row.profile),
    plans: row.plans.map(parseCloudPlan),
    workoutSessions: row.workoutSessions.map(parseCloudWorkoutSession),
    results: row.results.map(parseCloudResult),
    fetchedAt: text(row.fetchedAt),
  };
}

function parseCloudPlanVersion(value: unknown): CloudPlanVersion {
  const row = record(value);
  return {
    id: text(row.id),
    planId: text(row.planId),
    number: positiveRevision(row.number),
    snapshot: jsonObject(row.snapshot),
    createdAt: text(row.createdAt),
    publishedAt: nullableText(row.publishedAt),
  };
}

function parseMediaReference(value: unknown): CloudMediaEvidenceReference {
  const row = record(value);
  const evidenceStatus = text(row.evidenceStatus);
  if (evidenceStatus !== "available" && evidenceStatus !== "evidence_deleted") throw invalidCloudData();
  return {
    assetId: text(row.assetId),
    evidenceStatus,
    evidenceDeletedAt: nullableText(row.evidenceDeletedAt),
  };
}

function jsonObject(value: unknown): CloudJsonObject {
  if (!isRecord(value)) throw invalidCloudData();
  assertJsonValue(value);
  return value;
}

function nullableJsonObject(value: unknown): CloudJsonObject | null {
  return value === null ? null : jsonObject(value);
}

function assertJsonValue(value: unknown, depth = 0): asserts value is CloudJsonValue {
  if (depth > 64) throw invalidCloudData();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) assertJsonValue(item, depth + 1);
    return;
  }
  throw invalidCloudData();
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw invalidCloudData();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidCloudData();
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function positiveRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw invalidCloudData();
  return value as number;
}

function invalidCloudData(): Error {
  return new Error("invalid_cloud_product_data");
}
