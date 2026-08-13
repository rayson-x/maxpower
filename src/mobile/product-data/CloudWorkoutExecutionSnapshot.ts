import type { PlannedSessionData } from "../../coach/domain";
import { assertPlannedSessionShape } from "../../workout/UpcomingWorkoutPlanEditor";

import type { CloudJsonObject, CloudJsonValue } from "./model";

export const CLOUD_WORKOUT_EXECUTION_SCHEMA_VERSION = 1;

/**
 * Cloud-owned, versioned effective prescription for one executing workout.
 * Route edits replace this whole snapshot so recovery never has to replay a
 * lossy "last operation" field.
 */
export function createCloudWorkoutExecutionSnapshot(
  effectiveSession: PlannedSessionData,
): CloudJsonObject {
  assertPlannedSessionShape(effectiveSession);
  return {
    schemaVersion: CLOUD_WORKOUT_EXECUTION_SCHEMA_VERSION,
    effectiveSession: JSON.parse(JSON.stringify(effectiveSession)) as CloudJsonValue,
  };
}

/** Returns undefined for legacy workouts and malformed/untrusted snapshots. */
export function readCloudWorkoutExecutionSnapshot(
  value: CloudJsonValue | undefined,
): PlannedSessionData | undefined {
  if (!isCloudObject(value) || value.schemaVersion !== CLOUD_WORKOUT_EXECUTION_SCHEMA_VERSION) return undefined;
  try {
    const candidate = JSON.parse(JSON.stringify(value.effectiveSession)) as PlannedSessionData;
    assertPlannedSessionShape(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

function isCloudObject(value: CloudJsonValue | undefined): value is CloudJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
