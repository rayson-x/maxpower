import { EXERCISE_REGISTRY } from "./exerciseRegistry";
import type { CameraView } from "./formRuleEngine";
import { getKinematicsProfile } from "./kinematicsProfile";
import type { RepSegment } from "./repSegmenter";

export const LABELED_SET_FIXTURE_SCHEMA = "form-coach-labeled-set/v1" as const;

export type RepLabel<TPositive extends string, TNegative extends string> =
  | TPositive
  | TNegative
  | "unjudgeable";

export interface LabeledSetRep {
  repIndex: number;
  startMs: number;
  extremeMs: number;
  endMs: number;
  labels: {
    amplitude: RepLabel<"full", "partial">;
    torsoCompensation: RepLabel<"obvious", "stable">;
    bilateralAsymmetry: RepLabel<"asymmetric", "symmetric">;
    eccentricControl: RepLabel<"uncontrolled", "controlled">;
  };
}

/**
 * Sidecar stored beside a recording and its exported canonical keypoints.
 * It makes the source, identity split, frozen profile version, and rep labels
 * auditable before any candidate threshold is promoted.
 */
export interface LabeledSetFixture {
  schemaVersion: typeof LABELED_SET_FIXTURE_SCHEMA;
  videoId: string;
  keypointsFile: string;
  exerciseId: string;
  cameraView: CameraView;
  subjectId: string;
  recordingBatchId: string;
  profileVersion: string;
  ruleVersion: string;
  labels: LabeledSetRep[];
}

export interface LabeledSetFixtureTemplateInput {
  videoId: string;
  keypointsFile: string;
  exerciseId: string;
  cameraView: CameraView;
  ruleVersion: string;
  segments: readonly RepSegment[];
}

export interface LabeledFixtureRecordingEvidence {
  videoId: string;
  keypointsFile: string;
  durationMs: number;
}

export function buildLabeledSetFixtureTemplate(
  input: LabeledSetFixtureTemplateInput,
): LabeledSetFixture {
  const profile = getKinematicsProfile(input.exerciseId);
  if (!profile) {
    throw new Error(`Cannot create a labeled template without a profile: ${input.exerciseId}`);
  }
  return {
    schemaVersion: LABELED_SET_FIXTURE_SCHEMA,
    videoId: input.videoId,
    keypointsFile: input.keypointsFile,
    exerciseId: input.exerciseId,
    cameraView: input.cameraView,
    // These must be replaced with non-identifying, stable cohort keys before
    // entering the repository. They prevent a subject leaking between splits.
    subjectId: "REPLACE_WITH_SUBJECT_ID",
    recordingBatchId: "REPLACE_WITH_RECORDING_BATCH_ID",
    profileVersion: profile.version,
    ruleVersion: input.ruleVersion,
    labels: input.segments.map((segment) => ({
      repIndex: segment.repIndex,
      startMs: segment.startMs,
      extremeMs: segment.peakMs,
      endMs: segment.endMs,
      labels: {
        amplitude: "unjudgeable",
        torsoCompensation: "unjudgeable",
        bilateralAsymmetry: "unjudgeable",
        eccentricControl: "unjudgeable",
      },
    })),
  };
}

/** Returns every reason a sidecar cannot be used as a labeled fixture. */
export function validateLabeledSetFixture(
  value: unknown,
  recording: LabeledFixtureRecordingEvidence,
): string[] {
  if (!isRecord(value)) return ["Labeled fixture must be an object"];
  const errors: string[] = [];
  if (value.schemaVersion !== LABELED_SET_FIXTURE_SCHEMA) {
    errors.push(`schemaVersion must be ${LABELED_SET_FIXTURE_SCHEMA}`);
  }
  for (const key of [
    "videoId",
    "keypointsFile",
    "exerciseId",
    "subjectId",
    "recordingBatchId",
    "ruleVersion",
  ]) {
    if (!completedString(value[key])) errors.push(`${key} must be a completed non-empty string`);
  }
  if (value.videoId !== recording.videoId) {
    errors.push(`videoId must match keypoints recording: ${recording.videoId}`);
  }
  if (value.keypointsFile !== recording.keypointsFile) {
    errors.push(`keypointsFile must match supplied keypoints file: ${recording.keypointsFile}`);
  }
  if (!isCameraView(value.cameraView)) errors.push("cameraView must be front, side, or oblique45");
  const exerciseId = typeof value.exerciseId === "string" ? value.exerciseId : "";
  const concept = EXERCISE_REGISTRY.get(exerciseId);
  const profile = getKinematicsProfile(exerciseId);
  if (!concept || !EXERCISE_REGISTRY.canRunSpecializedAnalysis(exerciseId) || !profile) {
    errors.push(`exerciseId must identify an analysable registry exercise with a profile: ${exerciseId}`);
  } else if (value.profileVersion !== profile.version) {
    errors.push(`profileVersion must equal frozen profile version: ${profile.version}`);
  }
  if (!Array.isArray(value.labels) || value.labels.length === 0) {
    errors.push("labels must contain at least one rep");
    return errors;
  }
  let previousEndMs = -1;
  for (const [index, label] of value.labels.entries()) {
    if (!isRecord(label)) {
      errors.push(`labels[${index}] must be an object`);
      continue;
    }
    const prefix = `labels[${index}]`;
    if (!Number.isInteger(label.repIndex) || (label.repIndex as number) < 0) {
      errors.push(`${prefix}.repIndex must be a non-negative integer`);
    }
    const times = [label.startMs, label.extremeMs, label.endMs];
    if (!times.every((time) => typeof time === "number" && Number.isFinite(time))) {
      errors.push(`${prefix} timestamps must be finite numbers`);
    } else if (
      (label.startMs as number) < 0 ||
      (label.startMs as number) > (label.extremeMs as number) ||
      (label.extremeMs as number) > (label.endMs as number) ||
      (label.endMs as number) > recording.durationMs
    ) {
      errors.push(`${prefix} timestamps must be ordered within recording duration`);
    } else if ((label.startMs as number) < previousEndMs) {
      errors.push(`${prefix} overlaps the preceding rep`);
    } else {
      previousEndMs = label.endMs as number;
    }
    validateRepLabels(label.labels, prefix, errors);
  }
  return errors;
}

function validateRepLabels(value: unknown, prefix: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${prefix}.labels must be an object`);
    return;
  }
  const allowed = {
    amplitude: new Set(["full", "partial", "unjudgeable"]),
    torsoCompensation: new Set(["obvious", "stable", "unjudgeable"]),
    bilateralAsymmetry: new Set(["asymmetric", "symmetric", "unjudgeable"]),
    eccentricControl: new Set(["uncontrolled", "controlled", "unjudgeable"]),
  } as const;
  for (const [key, labels] of Object.entries(allowed)) {
    if (!labels.has(value[key] as never)) {
      errors.push(`${prefix}.labels.${key} must be one of ${[...labels].join(", ")}`);
    }
  }
}

function isCameraView(value: unknown): value is CameraView {
  return value === "front" || value === "side" || value === "oblique45";
}

function completedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    !value.trim().startsWith("REPLACE_WITH_")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
