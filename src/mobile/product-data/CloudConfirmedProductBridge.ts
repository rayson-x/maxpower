import type { CloudProductDataCoordinator } from "./CloudProductDataCoordinator";
import type {
  CloudCanonicalProjection,
  CloudJsonObject,
  CloudPlan,
  CloudProfile,
  CloudResult,
  CloudWorkoutSession,
  PatchCloudProfileInput,
} from "./model";

export interface CloudCanonicalWriter {
  currentProjection(): CloudCanonicalProjection | undefined;
  patchProfile(input: PatchCloudProfileInput): Promise<CloudProfile>;
  createPlan(input: Parameters<CloudProductDataCoordinator["createPlan"]>[0]): Promise<CloudPlan>;
  patchPlan(input: Parameters<CloudProductDataCoordinator["patchPlan"]>[0]): Promise<CloudPlan>;
  publishPlan(input: Parameters<CloudProductDataCoordinator["publishPlan"]>[0]): Promise<CloudPlan>;
  createWorkoutSession(input: Parameters<CloudProductDataCoordinator["createWorkoutSession"]>[0]): Promise<CloudWorkoutSession>;
  patchWorkoutSession(input: Parameters<CloudProductDataCoordinator["patchWorkoutSession"]>[0]): Promise<CloudWorkoutSession>;
  completeWorkoutSession(input: Parameters<CloudProductDataCoordinator["completeWorkoutSession"]>[0]): Promise<CloudWorkoutSession>;
  createResult(input: Parameters<CloudProductDataCoordinator["createResult"]>[0]): Promise<CloudResult>;
  patchResult(input: Parameters<CloudProductDataCoordinator["patchResult"]>[0]): Promise<CloudResult>;
}

/**
 * Confirmation barrier between ProductShell and its local Coach Ledger.
 * Every callback runs only after the canonical server write and cache commit.
 */
export class CloudConfirmedProductBridge {
  constructor(private readonly cloud: CloudCanonicalWriter) {}

  async patchProfileThen<T>(input: {
    patch: PatchCloudProfileInput["patch"];
    idempotencyKey: string;
    commitLocal(): Promise<T>;
  }): Promise<T> {
    const projection = this.requireProjection();
    await this.cloud.patchProfile({
      patch: input.patch,
      expectedRevision: projection.profile.revision,
      idempotencyKey: `${input.idempotencyKey}:r${projection.profile.revision}`,
    });
    return input.commitLocal();
  }

  async publishPlanThen<T>(input: {
    localPlanId: string;
    title: string;
    snapshot: CloudJsonObject;
    idempotencyKey: string;
    commitLocal(): Promise<T>;
  }): Promise<T> {
    const projection = this.requireProjection();
    const existing = projection.plans.find((plan) =>
      plan.id === input.localPlanId || plan.versions.some((version) =>
        version.snapshot.localPlanId === input.localPlanId
      )
    );
    const snapshot = { ...input.snapshot, localPlanId: input.localPlanId };
    const draft = existing
      ? await this.cloud.patchPlan({
          planId: existing.id,
          patch: { title: input.title, snapshot },
          expectedRevision: existing.revision,
          idempotencyKey: `${input.idempotencyKey}:version`,
        })
      : await this.cloud.createPlan({
          title: input.title,
          snapshot,
          idempotencyKey: `${input.idempotencyKey}:create`,
        });
    await this.cloud.publishPlan({
      planId: draft.id,
      expectedRevision: draft.revision,
      idempotencyKey: `${input.idempotencyKey}:publish`,
    });
    return input.commitLocal();
  }

  async startWorkoutThen<T>(input: {
    localWorkoutId: string;
    localPlanId?: string;
    title: string;
    data?: CloudJsonObject;
    startedAt: string;
    idempotencyKey: string;
    commitLocal(): Promise<T>;
  }): Promise<T> {
    const projection = this.requireProjection();
    const plan = input.localPlanId
      ? projection.plans.find((candidate) =>
          candidate.id === input.localPlanId || candidate.versions.some((version) =>
            version.snapshot.localPlanId === input.localPlanId
          )
        )
      : undefined;
    const existing = workoutByLocalId(projection, input.localWorkoutId);
    if (existing) {
      await this.cloud.patchWorkoutSession({
        workoutSessionId: existing.id,
        patch: {
          title: input.title,
          data: { ...existing.data, ...(input.data ?? {}), localWorkoutId: input.localWorkoutId },
          startedAt: input.startedAt,
        },
        expectedRevision: existing.revision,
        idempotencyKey: `${input.idempotencyKey}:update`,
      });
    } else {
      await this.cloud.createWorkoutSession({
        ...(plan ? { planId: plan.id } : {}),
        title: input.title,
        data: { ...(input.data ?? {}), localWorkoutId: input.localWorkoutId },
        startedAt: input.startedAt,
        idempotencyKey: `${input.idempotencyKey}:create`,
      });
    }
    return input.commitLocal();
  }

  async updateWorkoutThen<T>(input: {
    localWorkoutId: string;
    patch: { title?: string; data?: CloudJsonObject; notes?: string | null; startedAt?: string };
    idempotencyKey: string;
    commitLocal(): Promise<T>;
  }): Promise<T> {
    const workout = this.requireWorkout(input.localWorkoutId);
    await this.cloud.patchWorkoutSession({
      workoutSessionId: workout.id,
      patch: {
        ...input.patch,
        ...(input.patch.data
          ? { data: { ...workout.data, ...input.patch.data, localWorkoutId: input.localWorkoutId } }
          : {}),
      },
      expectedRevision: workout.revision,
      idempotencyKey: input.idempotencyKey,
    });
    return input.commitLocal();
  }

  async completeWorkoutThen<T>(input: {
    localWorkoutId: string;
    summary: CloudJsonObject;
    completedAt: string;
    idempotencyKey: string;
    commitLocal(): Promise<T>;
  }): Promise<T> {
    const workout = this.requireWorkout(input.localWorkoutId);
    await this.cloud.completeWorkoutSession({
      workoutSessionId: workout.id,
      summary: { ...input.summary, localWorkoutId: input.localWorkoutId },
      completedAt: input.completedAt,
      expectedRevision: workout.revision,
      idempotencyKey: input.idempotencyKey,
    });
    return input.commitLocal();
  }

  async confirmResultThen<T>(input: {
    localWorkoutId?: string;
    localResultId: string;
    kind: string;
    payload: CloudJsonObject;
    provenance?: CloudJsonObject;
    occurredAt: string;
    idempotencyKey: string;
    commitLocal(): Promise<T>;
  }): Promise<T> {
    const projection = this.requireProjection();
    const workout = input.localWorkoutId === undefined
      ? undefined
      : this.requireWorkout(input.localWorkoutId);
    const existing = projection.results.find((result) =>
      result.workoutSessionId === (workout?.id ?? null) &&
      result.kind === input.kind &&
      result.payload.localResultId === input.localResultId
    );
    const payload = { ...input.payload, localResultId: input.localResultId };
    if (existing) {
      await this.cloud.patchResult({
        resultId: existing.id,
        patch: {
          kind: input.kind,
          payload,
          ...(input.provenance ? { provenance: input.provenance } : {}),
          occurredAt: input.occurredAt,
        },
        expectedRevision: existing.revision,
        idempotencyKey: `${input.idempotencyKey}:update`,
      });
    } else {
      await this.cloud.createResult({
        kind: input.kind,
        ...(workout ? { workoutSessionId: workout.id } : {}),
        payload,
        ...(input.provenance ? { provenance: input.provenance } : {}),
        occurredAt: input.occurredAt,
        idempotencyKey: `${input.idempotencyKey}:create`,
      });
    }
    return input.commitLocal();
  }

  private requireProjection(): CloudCanonicalProjection {
    const projection = this.cloud.currentProjection();
    if (!projection) throw new Error("cloud_product_data_not_ready");
    return projection;
  }

  private requireWorkout(localWorkoutId: string): CloudWorkoutSession {
    const workout = workoutByLocalId(this.requireProjection(), localWorkoutId);
    if (!workout) throw new Error("cloud_workout_session_not_found");
    return workout;
  }
}

function workoutByLocalId(
  projection: CloudCanonicalProjection,
  localWorkoutId: string,
): CloudWorkoutSession | undefined {
  return projection.workoutSessions.find((workout) =>
    workout.id === localWorkoutId || workout.data.localWorkoutId === localWorkoutId
  );
}
