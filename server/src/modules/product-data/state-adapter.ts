import type { CursorPage, CursorPageInput, Plan, Profile, ResultRecord, WorkoutSession } from "./model.js";

export interface StoredPlan extends Omit<Plan, "versions"> {
  deletedAt: string | null;
  versions: Plan["versions"];
}

export interface StoredWorkoutSession extends WorkoutSession {
  deletedAt: string | null;
}

export interface StoredResult extends ResultRecord {
  deletedAt: string | null;
}

export interface StoredIdempotencyResult {
  operation: string;
  fingerprint: string;
  result: unknown;
}

export interface ProductDataState {
  profile: Profile | null;
  plans: Map<string, StoredPlan>;
  workoutSessions: Map<string, StoredWorkoutSession>;
  results: Map<string, StoredResult>;
  idempotency: Map<string, StoredIdempotencyResult>;
}

export interface ProductDataStateAdapter {
  transact<T>(accountId: string, operation: (state: ProductDataState) => T): Promise<T>;
  readProfile?(accountId: string): Promise<Profile | undefined>;
  readPlan?(accountId: string, planId: string): Promise<Plan | undefined>;
  readWorkoutSession?(accountId: string, workoutSessionId: string): Promise<WorkoutSession | undefined>;
  readResult?(accountId: string, resultId: string): Promise<ResultRecord | undefined>;
  listPlans?(accountId: string, input?: CursorPageInput): Promise<CursorPage<Plan>>;
  listWorkoutSessions?(
    accountId: string,
    input?: CursorPageInput,
  ): Promise<CursorPage<WorkoutSession>>;
  listResults?(accountId: string, input?: CursorPageInput): Promise<CursorPage<ResultRecord>>;
}

export function emptyProductDataState(): ProductDataState {
  return {
    profile: null,
    plans: new Map(),
    workoutSessions: new Map(),
    results: new Map(),
    idempotency: new Map(),
  };
}
