import { createHash } from "node:crypto";

export type FusionCandidateId =
  | "pose_only"
  | "equipment_only"
  | "pose_equipment_fused";

export interface FusionAblationCandidate {
  readonly actionId: string;
  readonly capturePosition: string;
  readonly candidateId: FusionCandidateId;
  readonly observationSetHash: string;
  readonly frameScheduleHash: string;
  readonly truthSplitHash: string;
  readonly precision: number;
  readonly recall: number;
  readonly exactSetRate: number;
  readonly endpointCoverage: number;
  readonly evidenceConflictRate: number;
  readonly abstentionRate: number;
  readonly p90ConfirmationLatencyMs: number;
  readonly poseLineage?: "independent_measured_pose" | "equipment_constrained_pose";
  readonly equipmentLineage?: "subject_associated_barbell_axis";
}

export interface FrozenFusionPolicy {
  readonly schemaVersion: "maxpower-pose-equipment-fusion-ablation/v1";
  readonly status: "selected" | "no_winner";
  readonly scope: Readonly<{ actionId: string; capturePosition: string }>;
  readonly selectedCandidateId: FusionCandidateId | null;
  readonly policyHash: string | null;
  readonly candidates: readonly Readonly<FusionAblationCandidate>[];
  readonly claimScope: readonly string[];
  readonly limitations: readonly string[];
}

/**
 * Freezes one exact action/view policy from a like-for-like ablation.
 * This function never compares across views or actions and never forces a
 * winner when the candidate set or evidence is insufficient.
 */
export function freezeFusionPolicy(
  candidates: readonly FusionAblationCandidate[],
): Readonly<FrozenFusionPolicy> {
  if (candidates.length === 0) throw new Error("fusion ablation requires candidates");
  const first = candidates[0];
  for (const candidate of candidates) {
    if (candidate.actionId !== first.actionId
      || candidate.capturePosition !== first.capturePosition
      || candidate.observationSetHash !== first.observationSetHash
      || candidate.frameScheduleHash !== first.frameScheduleHash
      || candidate.truthSplitHash !== first.truthSplitHash) {
      throw new Error("fusion ablation candidates must share action/view/observations/schedule/truth split");
    }
    for (const [name, value] of Object.entries({
      precision: candidate.precision,
      recall: candidate.recall,
      exactSetRate: candidate.exactSetRate,
      endpointCoverage: candidate.endpointCoverage,
      evidenceConflictRate: candidate.evidenceConflictRate,
      abstentionRate: candidate.abstentionRate,
    })) {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`fusion ablation ${name} must be between zero and one`);
      }
    }
    if (candidate.candidateId === "pose_equipment_fused") {
      if (candidate.poseLineage !== "independent_measured_pose"
        || candidate.equipmentLineage !== "subject_associated_barbell_axis") {
        throw new Error("fused evidence requires independent measured pose and equipment lineage");
      }
    }
  }

  const sorted = [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const eligible = sorted.filter((candidate) => candidate.precision >= 0.95
    && candidate.recall >= 0.95
    && candidate.exactSetRate >= 0.95
    && candidate.endpointCoverage >= 0.95
    && candidate.evidenceConflictRate <= 0.05);
  const selected = candidates.length >= 2
    ? eligible.sort((left, right) => candidateScore(right) - candidateScore(left))[0] ?? null
    : null;
  const semantic = {
    schemaVersion: "maxpower-pose-equipment-fusion-ablation/v1" as const,
    scope: { actionId: first.actionId, capturePosition: first.capturePosition },
    selectedCandidateId: selected?.candidateId ?? null,
    observationSetHash: first.observationSetHash,
    frameScheduleHash: first.frameScheduleHash,
    truthSplitHash: first.truthSplitHash,
    candidates: sorted,
  };
  const policyHash = selected
    ? createHash("sha256").update(JSON.stringify(semantic)).digest("hex")
    : null;
  return deepFreeze({
    schemaVersion: semantic.schemaVersion,
    status: selected ? "selected" : "no_winner",
    scope: semantic.scope,
    selectedCandidateId: selected?.candidateId ?? null,
    policyHash,
    candidates: sorted,
    claimScope: selected
      ? ["rep_count", "start_end_alignment", "turnaround_proposal", "causal_confirmation_latency"]
      : [],
    limitations: [
      "no_unreviewed_turnaround_accuracy_claim",
      "no_unreviewed_action_quality_accuracy_claim",
      "policy_is_exact_action_and_view_only",
      "equipment_constrained_pose_is_not_independent_evidence",
    ],
  });
}

function candidateScore(candidate: FusionAblationCandidate): number {
  return candidate.precision
    + candidate.recall
    + candidate.exactSetRate
    + candidate.endpointCoverage
    - candidate.evidenceConflictRate
    - candidate.abstentionRate * 0.25
    - Math.min(candidate.p90ConfirmationLatencyMs, 2_000) / 20_000;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
