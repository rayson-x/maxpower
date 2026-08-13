import type { PoseEstimate } from "../../src/pose/PoseEngine";

export const EXTERNAL_FITNESS_SEQUENCE_SCHEMA =
  "maxpower-external-fitness-sequence/v1" as const;

export type ExternalDatasetId = "mm-fit" | "repcount-a";
export type ExternalAnnotationGranularity =
  | "set_count"
  | "per_rep_bounds"
  | "salient_pose";

export interface ExternalRepBound {
  readonly repIndex: number;
  readonly startFrame: number;
  readonly endFrame: number;
}

export interface ExternalFitnessLabel {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly totalRepetitions: number;
  readonly annotationGranularity: ExternalAnnotationGranularity;
  readonly repBounds: readonly ExternalRepBound[];
}

/**
 * Research-only sequence at the seam between public datasets and MaxPower.
 * It is intentionally not a LabeledSetFixture: external records cannot be
 * promoted through the human-approved profile path by changing a filename.
 */
export interface ExternalFitnessSequence {
  readonly schemaVersion: typeof EXTERNAL_FITNESS_SEQUENCE_SCHEMA;
  readonly datasetId: ExternalDatasetId;
  readonly sourceSequenceId: string;
  readonly split: "train" | "validation" | "test" | "unseen_test" | "unknown";
  readonly subjectId: string | null;
  readonly sourceAction: string;
  readonly exerciseId: string | null;
  readonly cameraView: "unknown";
  readonly intendedUse: readonly ["offline_research", "benchmarking"];
  readonly forbiddenUse: readonly ["production_profile_promotion", "form_reference"];
  readonly poseTopology: "blazepose33-adapted" | "unavailable";
  readonly sourceConfidenceAvailable: boolean;
  readonly framesPerSecond: number | null;
  readonly poses: readonly PoseEstimate[];
  readonly labels: readonly ExternalFitnessLabel[];
}

export const EXTERNAL_RESEARCH_POLICY = Object.freeze({
  intendedUse: ["offline_research", "benchmarking"] as const,
  forbiddenUse: ["production_profile_promotion", "form_reference"] as const,
});
