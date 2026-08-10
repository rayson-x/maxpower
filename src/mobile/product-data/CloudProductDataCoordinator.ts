import {
  CloudProductDataError,
  type CloudProductDataClient,
} from "./CloudProductDataClient";
import type { CloudProductDataCache } from "./CloudProductDataCache";
import {
  type CloudCanonicalProjection,
  type CloudPlan,
  type CloudProfile,
  type CloudResult,
  type CloudWorkoutSession,
  type CompleteCloudWorkoutSessionInput,
  type CreateCloudPlanInput,
  type CreateCloudResultInput,
  type CreateCloudWorkoutSessionInput,
  type DeleteCloudPlanInput,
  type DeleteCloudResultInput,
  type DeleteCloudWorkoutSessionInput,
  type PatchCloudPlanInput,
  type PatchCloudProfileInput,
  type PatchCloudResultInput,
  type PatchCloudWorkoutSessionInput,
  type PublishCloudPlanInput,
} from "./model";

export type CloudProductDataRecoverableReason =
  | "network"
  | "revision_conflict"
  | "idempotency_conflict"
  | "authentication"
  | "cache"
  | "server";

export type CloudProductDataState =
  | { status: "idle" }
  | { status: "loading"; previous?: CloudCanonicalProjection }
  | { status: "ready"; projection: CloudCanonicalProjection }
  | {
      status: "recoverable_error";
      reason: CloudProductDataRecoverableReason;
      error: Error;
      previous?: CloudCanonicalProjection;
    };

export interface CloudProductDataCoordinatorOptions {
  accountId: string;
  client: CloudProductDataClient;
  cache: CloudProductDataCache;
  signal?: AbortSignal;
}

/**
 * Owns cloud-authoritative state for one AuthRoot account. It never reports a
 * local success before the server succeeds, and a failed cache commit remains
 * retryable through the same idempotency key or a full cloud rebuild.
 */
export class CloudProductDataCoordinator {
  readonly accountId: string;

  private state: CloudProductDataState = { status: "idle" };
  private projection?: CloudCanonicalProjection;
  private readonly listeners = new Set<(state: CloudProductDataState) => void>();
  private readonly lifetime = new AbortController();
  private readonly client: CloudProductDataClient;
  private readonly cache: CloudProductDataCache;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: CloudProductDataCoordinatorOptions) {
    this.accountId = requiredAccountId(options.accountId);
    this.client = options.client;
    this.cache = options.cache;
    if (options.signal?.aborted) this.lifetime.abort();
    else options.signal?.addEventListener("abort", () => this.lifetime.abort(), { once: true });
  }

  currentState(): CloudProductDataState {
    return this.state;
  }

  currentProjection(): CloudCanonicalProjection | undefined {
    return this.projection;
  }

  subscribe(listener: (state: CloudProductDataState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(signal?: AbortSignal): Promise<CloudCanonicalProjection> {
    const previous = this.projection ?? await this.cache.read(this.accountId).catch(() => null) ?? undefined;
    this.setState({ status: "loading", ...(previous ? { previous } : {}) });
    try {
      const projection = await this.client.fetchCanonicalProjection(this.signal(signal));
      assertProjectionOwner(projection, this.accountId);
      try {
        await this.cache.replace({ accountId: this.accountId, projection });
      } catch {
        throw new CacheCommitError();
      }
      this.projection = projection;
      this.setState({ status: "ready", projection });
      return projection;
    } catch (cause) {
      const error = asError(cause);
      this.setState({
        status: "recoverable_error",
        reason: recoverableReason(error),
        error,
        ...(previous ? { previous } : {}),
      });
      throw error;
    }
  }

  retry(signal?: AbortSignal): Promise<CloudCanonicalProjection> {
    return this.bootstrap(signal);
  }

  patchProfile(input: PatchCloudProfileInput): Promise<CloudProfile> {
    return this.mutate(
      () => this.client.patchProfile({ ...input, signal: this.signal(input.signal) }),
      (projection, profile) => ({ ...projection, profile }),
    );
  }

  createPlan(input: CreateCloudPlanInput): Promise<CloudPlan> {
    return this.mutate(
      () => this.client.createPlan({ ...input, signal: this.signal(input.signal) }),
      (projection, plan) => ({ ...projection, plans: upsert(projection.plans, plan) }),
    );
  }

  patchPlan(input: PatchCloudPlanInput): Promise<CloudPlan> {
    return this.mutate(
      () => this.client.patchPlan({ ...input, signal: this.signal(input.signal) }),
      (projection, plan) => ({ ...projection, plans: upsert(projection.plans, plan) }),
    );
  }

  publishPlan(input: PublishCloudPlanInput): Promise<CloudPlan> {
    return this.mutate(
      () => this.client.publishPlan({ ...input, signal: this.signal(input.signal) }),
      (projection, plan) => ({ ...projection, plans: upsert(projection.plans, plan) }),
    );
  }

  async deletePlan(input: DeleteCloudPlanInput): Promise<void> {
    await this.mutate(
      async () => {
        await this.client.deletePlan({ ...input, signal: this.signal(input.signal) });
        return input.planId;
      },
      (projection, planId) => ({
        ...projection,
        plans: projection.plans.filter(({ id }) => id !== planId),
      }),
    );
  }

  createWorkoutSession(input: CreateCloudWorkoutSessionInput): Promise<CloudWorkoutSession> {
    return this.mutate(
      () => this.client.createWorkoutSession({ ...input, signal: this.signal(input.signal) }),
      (projection, workout) => ({
        ...projection,
        workoutSessions: upsert(projection.workoutSessions, workout),
      }),
    );
  }

  patchWorkoutSession(input: PatchCloudWorkoutSessionInput): Promise<CloudWorkoutSession> {
    return this.mutate(
      () => this.client.patchWorkoutSession({ ...input, signal: this.signal(input.signal) }),
      (projection, workout) => ({
        ...projection,
        workoutSessions: upsert(projection.workoutSessions, workout),
      }),
    );
  }

  completeWorkoutSession(input: CompleteCloudWorkoutSessionInput): Promise<CloudWorkoutSession> {
    return this.mutate(
      () => this.client.completeWorkoutSession({ ...input, signal: this.signal(input.signal) }),
      (projection, workout) => ({
        ...projection,
        workoutSessions: upsert(projection.workoutSessions, workout),
      }),
    );
  }

  async deleteWorkoutSession(input: DeleteCloudWorkoutSessionInput): Promise<void> {
    await this.mutate(
      async () => {
        await this.client.deleteWorkoutSession({ ...input, signal: this.signal(input.signal) });
        return input.workoutSessionId;
      },
      (projection, workoutSessionId) => ({
        ...projection,
        workoutSessions: projection.workoutSessions.filter(({ id }) => id !== workoutSessionId),
      }),
    );
  }

  createResult(input: CreateCloudResultInput): Promise<CloudResult> {
    return this.mutate(
      () => this.client.createResult({ ...input, signal: this.signal(input.signal) }),
      (projection, result) => ({ ...projection, results: upsert(projection.results, result) }),
    );
  }

  patchResult(input: PatchCloudResultInput): Promise<CloudResult> {
    return this.mutate(
      () => this.client.patchResult({ ...input, signal: this.signal(input.signal) }),
      (projection, result) => ({ ...projection, results: upsert(projection.results, result) }),
    );
  }

  async deleteResult(input: DeleteCloudResultInput): Promise<void> {
    await this.mutate(
      async () => {
        await this.client.deleteResult({ ...input, signal: this.signal(input.signal) });
        return input.resultId;
      },
      (projection, resultId) => ({
        ...projection,
        results: projection.results.filter(({ id }) => id !== resultId),
      }),
    );
  }

  dispose(): void {
    this.lifetime.abort();
    this.listeners.clear();
  }

  private mutate<T>(
    operation: () => Promise<T>,
    apply: (projection: CloudCanonicalProjection, value: T) => CloudCanonicalProjection,
  ): Promise<T> {
    const pending = this.mutationTail.then(() => this.performMutation(operation, apply));
    this.mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async performMutation<T>(
    operation: () => Promise<T>,
    apply: (projection: CloudCanonicalProjection, value: T) => CloudCanonicalProjection,
  ): Promise<T> {
    const previous = this.projection ?? await this.cache.read(this.accountId);
    if (!previous) throw new Error("cloud_product_data_not_ready");
    try {
      const value = await operation();
      const next = apply(previous, value);
      assertProjectionOwner(next, this.accountId);
      try {
        await this.cache.replace({ accountId: this.accountId, projection: next });
      } catch {
        throw new CacheCommitError();
      }
      this.projection = next;
      this.setState({ status: "ready", projection: next });
      return value;
    } catch (cause) {
      const error = asError(cause);
      this.setState({
        status: "recoverable_error",
        reason: recoverableReason(error),
        error,
        ...(previous ? { previous } : {}),
      });
      throw error;
    }
  }

  private signal(external?: AbortSignal): AbortSignal {
    if (!external) return this.lifetime.signal;
    if (typeof AbortSignal.any === "function") return AbortSignal.any([external, this.lifetime.signal]);
    return external;
  }

  private setState(state: CloudProductDataState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

class CacheCommitError extends Error {
  constructor() {
    super("cloud_product_cache_commit_failed");
    this.name = "CacheCommitError";
  }
}

function upsert<T extends { id: string }>(values: readonly T[], value: T): readonly T[] {
  const index = values.findIndex(({ id }) => id === value.id);
  if (index === -1) return [...values, value];
  return values.map((current, currentIndex) => currentIndex === index ? value : current);
}

function assertProjectionOwner(projection: CloudCanonicalProjection, accountId: string): void {
  const owners = [
    projection.accountId,
    projection.profile.accountId,
    ...projection.plans.map(({ accountId: owner }) => owner),
    ...projection.workoutSessions.map(({ accountId: owner }) => owner),
    ...projection.results.map(({ accountId: owner }) => owner),
  ];
  if (owners.some((owner) => owner !== accountId)) throw new Error("cloud_product_account_mismatch");
}

function recoverableReason(error: Error): CloudProductDataRecoverableReason {
  if (error instanceof CacheCommitError) return "cache";
  if (!(error instanceof CloudProductDataError)) return "server";
  if (error.code === "network_unavailable" || error.code === "request_aborted") return "network";
  if (error.code === "revision_conflict") return "revision_conflict";
  if (error.code === "idempotency_conflict") return "idempotency_conflict";
  if (error.code === "not_authenticated") return "authentication";
  return "server";
}

function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error("cloud_product_data_failed");
}

function requiredAccountId(value: string): string {
  if (!value || value.length > 512 || /[\u0000-\u001F\u007F]/.test(value)) {
    throw new Error("invalid_cloud_product_account");
  }
  return value;
}
