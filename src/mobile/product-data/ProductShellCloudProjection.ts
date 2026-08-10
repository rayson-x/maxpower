import type { CloudCanonicalProjection, CloudJsonObject, CloudMediaEvidenceReference } from "./model";

/** Narrow read model consumed by ProductShell; no conversation/run payload fits. */
export interface ProductShellCloudProjection {
  profile: {
    displayName: string | null;
    locale: string;
    timeZone: string;
    unitSystem: "metric" | "imperial";
    revision: number;
  };
  plans: readonly { id: string; title: string; status: "draft" | "published"; revision: number }[];
  workouts: readonly {
    id: string;
    title: string;
    status: "in_progress" | "completed";
    startedAt: string;
    completedAt: string | null;
    revision: number;
  }[];
  results: readonly {
    id: string;
    kind: string;
    workoutSessionId: string | null;
    payload: CloudJsonObject;
    provenance: CloudJsonObject;
    mediaReferences: readonly CloudMediaEvidenceReference[];
    occurredAt: string;
    revision: number;
  }[];
  fetchedAt: string;
}

export function projectCloudProductDataForProductShell(
  projection: CloudCanonicalProjection,
): ProductShellCloudProjection {
  return {
    profile: {
      displayName: projection.profile.displayName,
      locale: projection.profile.locale,
      timeZone: projection.profile.timeZone,
      unitSystem: projection.profile.unitSystem,
      revision: projection.profile.revision,
    },
    plans: projection.plans.map(({ id, title, status, revision }) => ({ id, title, status, revision })),
    workouts: projection.workoutSessions.map(({
      id,
      title,
      status,
      startedAt,
      completedAt,
      revision,
    }) => ({ id, title, status, startedAt, completedAt, revision })),
    results: projection.results.map(({ id, kind, workoutSessionId, payload, provenance, mediaReferences, occurredAt, revision }) => ({
      id,
      kind,
      workoutSessionId,
      payload,
      provenance,
      mediaReferences,
      occurredAt,
      revision,
    })),
    fetchedAt: projection.fetchedAt,
  };
}
