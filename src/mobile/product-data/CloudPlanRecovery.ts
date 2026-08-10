import type { DomainProjection } from "../../coach/domain";
import type { EvidenceBriefArtifact } from "../../coach/model";

import type { CloudJsonObject } from "./model";

export const CLOUD_PLAN_RECOVERY_SCHEMA_VERSION = 1 as const;

export interface CreateCloudPlanRecoverySnapshotInput {
  artifactId: string;
  planningPreview: NonNullable<EvidenceBriefArtifact["planningPreview"]>;
  domain: DomainProjection;
}

export function createCloudProfileRecoverySnapshot(domain: DomainProjection): CloudJsonObject {
  return jsonObject({
    kind: "maxpower_profile_recovery",
    schemaVersion: CLOUD_PLAN_RECOVERY_SCHEMA_VERSION,
    domain: recoveryDomain(domain),
  });
}

/**
 * Stores the confirmed plan together with the exact domain context that made
 * it executable. The server treats this as opaque versioned JSON; only this
 * module is allowed to create or interpret the recovery envelope.
 */
export function createCloudPlanRecoverySnapshot(
  input: CreateCloudPlanRecoverySnapshotInput,
): CloudJsonObject {
  if (input.planningPreview.proposal.kind !== "plan_proposal") {
    throw new Error("cloud_plan_recovery_requires_plan_proposal");
  }
  if (!input.domain.profile || !input.domain.goalContract || !input.domain.mandate) {
    throw new Error("cloud_plan_recovery_context_incomplete");
  }
  return jsonObject({
    kind: "maxpower_plan_recovery",
    schemaVersion: CLOUD_PLAN_RECOVERY_SCHEMA_VERSION,
    artifactId: input.artifactId,
    planningPreview: input.planningPreview,
    domain: recoveryDomain(input.domain),
  });
}

function recoveryDomain(domain: DomainProjection) {
  if (!domain.profile || !domain.goalContract || !domain.mandate) {
    throw new Error("cloud_profile_recovery_context_incomplete");
  }
  return {
    profile: domain.profile,
    goalContract: domain.goalContract,
    mandate: domain.mandate,
    equipmentProfiles: domain.equipmentProfiles,
    recoveryConstraints: domain.recoveryConstraints,
    nutritionStrategies: domain.nutritionStrategies,
    customExercises: domain.customExercises,
    safetyConstraints: domain.safetyConstraints,
  };
}

function jsonObject(value: unknown): CloudJsonObject {
  const parsed = JSON.parse(JSON.stringify(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("cloud_plan_recovery_invalid_json");
  }
  return parsed as CloudJsonObject;
}
