import { EXERCISE_REGISTRY } from "./exerciseRegistry";
import { RULE_METRIC, type CameraView, type MetricUnit, type RuleMetricKey } from "./formRuleEngine";
import {
  freezeKinematicsProfile,
  getArchivedKinematicsProfile,
  getKinematicsProfile,
  kinematicsProfileFingerprint,
  type KinematicsProfile,
} from "./kinematicsProfile";
import type { RepSegment } from "./repSegmenter";

export const LABELED_SET_FIXTURE_SCHEMA = "maxpower-labeled-set/v1" as const;

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

export interface FrozenMetricDefinition {
  definitionId: string;
  unit: MetricUnit;
}

export interface FrozenProfileSnapshot {
  profile: KinematicsProfile;
  fingerprint: string;
  metricDefinitions: Record<RuleMetricKey, FrozenMetricDefinition>;
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
  profileSnapshot: FrozenProfileSnapshot;
  ruleVersion: string;
  thresholdVersion: string;
  labels: LabeledSetRep[];
}

export interface LabeledSetFixtureTemplateInput {
  videoId: string;
  keypointsFile: string;
  exerciseId: string;
  cameraView: CameraView;
  ruleVersion: string;
  thresholdVersion: string;
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
    profileSnapshot: {
      profile: freezeKinematicsProfile(profile),
      fingerprint: kinematicsProfileFingerprint(profile),
      metricDefinitions: {
        [RULE_METRIC.amplitude]: metricDefinition(profile.metrics.amplitude),
        [RULE_METRIC.bilateralAsymmetryRatio]: metricDefinition(profile.metrics.bilateralAsymmetry),
        [RULE_METRIC.torsoDriftDeg]: metricDefinition(profile.metrics.torsoDrift),
        [RULE_METRIC.toExtremeMs]: metricDefinition(profile.metrics.phaseDuration),
        [RULE_METRIC.fromExtremeMs]: metricDefinition(profile.metrics.phaseDuration),
      },
    },
    ruleVersion: input.ruleVersion,
    thresholdVersion: input.thresholdVersion,
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
    "profileVersion",
    "ruleVersion",
    "thresholdVersion",
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
  }
  validateProfileSnapshot(value, exerciseId, errors);
  if (!Array.isArray(value.labels) || value.labels.length === 0) {
    errors.push("labels must contain at least one rep");
    return errors;
  }
  let previousEndMs = -1;
  let previousRepIndex = -1;
  for (const [index, label] of value.labels.entries()) {
    if (!isRecord(label)) {
      errors.push(`labels[${index}] must be an object`);
      continue;
    }
    const prefix = `labels[${index}]`;
    if (!Number.isInteger(label.repIndex) || (label.repIndex as number) < 0) {
      errors.push(`${prefix}.repIndex must be a non-negative integer`);
    } else if ((label.repIndex as number) <= previousRepIndex) {
      errors.push(`${prefix}.repIndex must be unique and strictly increasing`);
    } else {
      previousRepIndex = label.repIndex as number;
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

function metricDefinition(definition: { definitionId: string; unit: MetricUnit }): FrozenMetricDefinition {
  return { definitionId: definition.definitionId, unit: definition.unit };
}

function validateProfileSnapshot(
  value: Record<string, unknown>,
  exerciseId: string,
  errors: string[],
): void {
  if (!isRecord(value.profileSnapshot)) {
    errors.push("profileSnapshot must be an object");
    return;
  }
  const snapshot = value.profileSnapshot;
  if (!isRecord(snapshot.profile)) {
    errors.push("profileSnapshot.profile must be an object");
    return;
  }
  const archived = getArchivedKinematicsProfile(
    exerciseId,
    typeof value.profileVersion === "string" ? value.profileVersion : "",
  );
  if (!archived) {
    errors.push("profileVersion must identify an archived kinematics profile");
  } else if (
    snapshot.fingerprint !== kinematicsProfileFingerprint(archived) ||
    JSON.stringify(snapshot.profile) !== JSON.stringify(archived)
  ) {
    errors.push("profileSnapshot must match the archived kinematics profile and fingerprint");
  }
  if (!isRecord(snapshot.metricDefinitions)) {
    errors.push("profileSnapshot.metricDefinitions must be an object");
    return;
  }
  for (const metric of Object.values(RULE_METRIC)) {
    const definition = snapshot.metricDefinitions[metric];
    if (!isRecord(definition) || !completedString(definition.definitionId) || !isMetricUnit(definition.unit)) {
      errors.push(`profileSnapshot.metricDefinitions.${metric} must contain definitionId and unit`);
    } else if (!matchesFrozenMetricDefinition(metric, definition, snapshot.profile)) {
      errors.push(`profileSnapshot.metricDefinitions.${metric} must match the frozen profile metric`);
    }
  }
}

function matchesFrozenMetricDefinition(
  metric: RuleMetricKey,
  definition: Record<string, unknown>,
  profile: Record<string, unknown>,
): boolean {
  if (!isRecord(profile.metrics)) return false;
  const metricName =
    metric === RULE_METRIC.amplitude
      ? "amplitude"
      : metric === RULE_METRIC.bilateralAsymmetryRatio
        ? "bilateralAsymmetry"
        : metric === RULE_METRIC.torsoDriftDeg
          ? "torsoDrift"
          : "phaseDuration";
  const expected = profile.metrics[metricName];
  return (
    isRecord(expected) &&
    definition.definitionId === expected.definitionId &&
    definition.unit === expected.unit
  );
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

function isMetricUnit(value: unknown): value is MetricUnit {
  return value === "normalized" || value === "ratio" || value === "deg" || value === "ms";
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
