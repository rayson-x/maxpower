import type { CameraView, PhaseMeaning } from "./formRuleEngine";
import type { LogicalJoint, SignalKind } from "./repSegmenter";

export interface KinematicsMetricDefinition {
  definitionId: string;
  unit: "normalized" | "ratio" | "deg" | "ms";
  joints: readonly LogicalJoint[];
  supportedViews: readonly CameraView[];
}

export type RecognitionTag =
  | "arms_travel"
  | "body_travel"
  | "elbow_flexion"
  | "forward_lean"
  | "horizontal_path"
  | "seated"
  | "shoulder_dominant"
  | "standing"
  | "straight_arm"
  | "upright"
  | "vertical_path";

export interface KinematicsProfile {
  exerciseId: string;
  version: string;
  movementPattern:
    | "horizontal_pull"
    | "horizontal_push"
    | "vertical_pull"
    | "vertical_push"
    | "shoulder_abduction"
    | "shoulder_horizontal_abduction"
    | "squat";
  /**
   * False means a user may select this experimental profile, but the local
   * auto-classifier must leave it unknown until field recordings establish a
   * discriminative signature. This prevents a press being guessed as a pull.
   */
  autoRecognizable?: boolean;
  recognitionTags: readonly RecognitionTag[];
  preferredView: CameraView;
  supportedViews: readonly CameraView[];
  phaseSignal: {
    kind: SignalKind;
    effortExtreme: "min" | "max";
    toExtreme: PhaseMeaning;
    fromExtreme: PhaseMeaning;
  };
  metrics: {
    amplitude: KinematicsMetricDefinition;
    bilateralAsymmetry: KinematicsMetricDefinition;
    torsoDrift: KinematicsMetricDefinition;
    phaseDuration: KinematicsMetricDefinition;
  };
}

const COMMON_VIEWS: readonly CameraView[] = ["front", "side", "oblique45"];
const SIDE_VIEWS: readonly CameraView[] = ["side", "oblique45"];
const FRONT_OBLIQUE_VIEWS: readonly CameraView[] = ["front", "oblique45"];
const OBLIQUE_ONLY_VIEWS: readonly CameraView[] = ["oblique45"];

const PROFILE_LIST: readonly KinematicsProfile[] = [
  profile({
    exerciseId: "barbell_row",
    version: "barbell-row-kinematics/v1",
    movementPattern: "horizontal_pull",
    signal: "elbow_angle",
    effortExtreme: "min",
    preferredView: "oblique45",
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
    recognitionTags: ["elbow_flexion", "arms_travel", "horizontal_path", "forward_lean", "standing"],
  }),
  profile({
    exerciseId: "pull_up",
    version: "pull-up-kinematics/v1",
    movementPattern: "vertical_pull",
    signal: "wrist_height",
    effortExtreme: "max",
    preferredView: "front",
    amplitudeJoints: ["shoulder", "wrist"],
    recognitionTags: ["elbow_flexion", "body_travel", "vertical_path", "upright", "standing"],
  }),
  profile({
    exerciseId: "lat_pulldown",
    version: "lat-pulldown-kinematics/v1",
    movementPattern: "vertical_pull",
    signal: "wrist_height",
    effortExtreme: "max",
    preferredView: "front",
    amplitudeJoints: ["shoulder", "wrist"],
    recognitionTags: ["elbow_flexion", "arms_travel", "vertical_path", "upright", "seated"],
  }),
  profile({
    exerciseId: "seated_row",
    version: "seated-row-kinematics/v1",
    movementPattern: "horizontal_pull",
    signal: "elbow_angle",
    effortExtreme: "min",
    preferredView: "oblique45",
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
    recognitionTags: ["elbow_flexion", "arms_travel", "horizontal_path", "upright", "seated"],
  }),
  profile({
    exerciseId: "straight_arm_pulldown",
    version: "straight-arm-pulldown-kinematics/v1",
    movementPattern: "vertical_pull",
    signal: "shoulder_angle",
    effortExtreme: "min",
    preferredView: "side",
    amplitudeJoints: ["hip", "shoulder", "wrist"],
    recognitionTags: ["straight_arm", "shoulder_dominant", "arms_travel", "vertical_path", "standing"],
  }),
  profile({
    exerciseId: "bodyweight_squat",
    version: "bodyweight-squat-kinematics/v1",
    movementPattern: "squat",
    signal: "knee_angle",
    effortExtreme: "min",
    toExtreme: "eccentric",
    fromExtreme: "concentric",
    preferredView: "side",
    supportedViews: SIDE_VIEWS,
    metricViews: SIDE_VIEWS,
    amplitudeJoints: ["hip", "knee", "ankle"],
    bilateralJoints: ["knee"],
    // A sagittal capture can segment a squat but cannot support a reliable
    // left/right comparison. Front captures are rejected before segmentation.
    bilateralViews: [],
    // Local recognition has no lower-body discriminators yet. Keep this empty
    // instead of borrowing generic standing evidence and misclassifying a squat
    // as an upper-body movement.
    recognitionTags: [],
  }),
  // Horizontal presses are explicitly selected in the first field version.
  // Their provisional profiles segment elbow extension/flexion, but do not
  // claim exercise classification or form-quality assessment.
  profile({
    exerciseId: "barbell_bench_press",
    version: "barbell-bench-press-kinematics/v1",
    movementPattern: "horizontal_push",
    signal: "elbow_angle",
    effortExtreme: "max",
    preferredView: "oblique45",
    supportedViews: FRONT_OBLIQUE_VIEWS,
    metricViews: FRONT_OBLIQUE_VIEWS,
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
  profile({
    exerciseId: "machine_chest_press",
    version: "machine-chest-press-kinematics/v1",
    movementPattern: "horizontal_push",
    signal: "elbow_angle",
    effortExtreme: "max",
    preferredView: "oblique45",
    supportedViews: FRONT_OBLIQUE_VIEWS,
    metricViews: FRONT_OBLIQUE_VIEWS,
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
  profile({
    exerciseId: "push_up",
    version: "push-up-kinematics/v1",
    movementPattern: "horizontal_push",
    signal: "elbow_angle",
    effortExtreme: "max",
    preferredView: "oblique45",
    supportedViews: FRONT_OBLIQUE_VIEWS,
    metricViews: FRONT_OBLIQUE_VIEWS,
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
  // Shoulder profiles are intentionally user-selected during the first field
  // collection. A single 2D wrist path cannot safely distinguish a seated
  // press from a pulldown, or a lateral raise from nearby cable variations.
  profile({
    exerciseId: "seated_shoulder_press",
    version: "seated-shoulder-press-kinematics/v1",
    movementPattern: "vertical_push",
    signal: "wrist_height",
    effortExtreme: "min",
    preferredView: "oblique45",
    supportedViews: FRONT_OBLIQUE_VIEWS,
    metricViews: FRONT_OBLIQUE_VIEWS,
    amplitudeJoints: ["shoulder", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
  profile({
    exerciseId: "lateral_raise",
    version: "lateral-raise-kinematics/v1",
    movementPattern: "shoulder_abduction",
    signal: "shoulder_angle",
    effortExtreme: "max",
    preferredView: "front",
    supportedViews: FRONT_OBLIQUE_VIEWS,
    metricViews: FRONT_OBLIQUE_VIEWS,
    amplitudeJoints: ["hip", "shoulder", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
  profile({
    exerciseId: "rear_delt_fly",
    version: "rear-delt-fly-kinematics/v1",
    movementPattern: "shoulder_horizontal_abduction",
    signal: "shoulder_angle",
    effortExtreme: "max",
    preferredView: "oblique45",
    supportedViews: OBLIQUE_ONLY_VIEWS,
    metricViews: OBLIQUE_ONLY_VIEWS,
    amplitudeJoints: ["hip", "shoulder", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
  profile({
    exerciseId: "face_pull",
    version: "face-pull-kinematics/v1",
    movementPattern: "horizontal_pull",
    signal: "elbow_angle",
    effortExtreme: "min",
    preferredView: "oblique45",
    supportedViews: FRONT_OBLIQUE_VIEWS,
    metricViews: FRONT_OBLIQUE_VIEWS,
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
    recognitionTags: [],
    autoRecognizable: false,
  }),
];

const PROFILES = new Map(PROFILE_LIST.map((item) => [item.exerciseId, item]));

/**
 * Move a profile here (rather than deleting it) when a newer profile becomes
 * current. Labeled recordings validate their complete frozen profile against
 * this append-only archive instead of trusting a sidecar version string.
 */
const HISTORICAL_PROFILE_LIST: readonly KinematicsProfile[] = [];
const PROFILE_VERSION_ARCHIVE = buildKinematicsProfileArchive(
  PROFILE_LIST,
  HISTORICAL_PROFILE_LIST,
);

export function getKinematicsProfile(exerciseId: string): KinematicsProfile | null {
  return PROFILES.get(exerciseId) ?? null;
}

export function listKinematicsProfiles(): readonly KinematicsProfile[] {
  return PROFILE_LIST;
}

export function getArchivedKinematicsProfile(
  exerciseId: string,
  version: string,
): KinematicsProfile | null {
  return PROFILE_VERSION_ARCHIVE.get(`${exerciseId}:${version}`) ?? null;
}

export function buildKinematicsProfileArchive(
  current: readonly KinematicsProfile[],
  historical: readonly KinematicsProfile[],
): ReadonlyMap<string, KinematicsProfile> {
  const archive = new Map<string, KinematicsProfile>();
  for (const profile of [...historical, ...current]) {
    const key = `${profile.exerciseId}:${profile.version}`;
    if (archive.has(key)) throw new Error(`Duplicate archived kinematics profile: ${key}`);
    archive.set(key, profile);
  }
  return archive;
}

/** Serializable, immutable-by-value profile evidence stored with a recording. */
export function freezeKinematicsProfile(profile: KinematicsProfile): KinematicsProfile {
  return JSON.parse(JSON.stringify(profile)) as KinematicsProfile;
}

/** A deterministic integrity marker for a complete profile snapshot. */
export function kinematicsProfileFingerprint(profile: KinematicsProfile): string {
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(profile)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function profile(input: {
  exerciseId: string;
  version: string;
  movementPattern: KinematicsProfile["movementPattern"];
  signal: SignalKind;
  effortExtreme: "min" | "max";
  toExtreme?: PhaseMeaning;
  fromExtreme?: PhaseMeaning;
  preferredView: CameraView;
  supportedViews?: readonly CameraView[];
  metricViews?: readonly CameraView[];
  amplitudeJoints: readonly LogicalJoint[];
  bilateralJoints?: readonly LogicalJoint[];
  bilateralViews?: readonly CameraView[];
  recognitionTags: readonly RecognitionTag[];
  autoRecognizable?: boolean;
}): KinematicsProfile {
  const definitionPrefix = `${input.exerciseId.replaceAll("_", "-")}/v1`;
  return {
    exerciseId: input.exerciseId,
    version: input.version,
    movementPattern: input.movementPattern,
    autoRecognizable: input.autoRecognizable ?? true,
    recognitionTags: input.recognitionTags,
    preferredView: input.preferredView,
    supportedViews: input.supportedViews ?? COMMON_VIEWS,
    phaseSignal: {
      kind: input.signal,
      effortExtreme: input.effortExtreme,
      toExtreme: input.toExtreme ?? "concentric",
      fromExtreme: input.fromExtreme ?? "eccentric",
    },
    metrics: {
      amplitude: {
        definitionId: `${definitionPrefix}/amplitude/${input.signal}`,
        unit: "normalized",
        joints: input.amplitudeJoints,
        supportedViews: input.metricViews ?? COMMON_VIEWS,
      },
      bilateralAsymmetry: {
        definitionId: `${definitionPrefix}/bilateral-path-asymmetry`,
        unit: "ratio",
        joints: input.bilateralJoints ?? ["wrist"],
        supportedViews: input.bilateralViews ?? ["front", "oblique45"],
      },
      torsoDrift: {
        definitionId: `${definitionPrefix}/torso-drift`,
        unit: "deg",
        joints: ["shoulder", "hip"],
        supportedViews: SIDE_VIEWS,
      },
      phaseDuration: {
        definitionId: `${definitionPrefix}/phase-duration`,
        unit: "ms",
        joints: input.amplitudeJoints,
        supportedViews: input.metricViews ?? COMMON_VIEWS,
      },
    },
  };
}
