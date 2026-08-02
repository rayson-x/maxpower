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
  movementPattern: "horizontal_pull" | "vertical_pull" | "squat";
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
];

const PROFILES = new Map(PROFILE_LIST.map((item) => [item.exerciseId, item]));

export function getKinematicsProfile(exerciseId: string): KinematicsProfile | null {
  return PROFILES.get(exerciseId) ?? null;
}

export function listKinematicsProfiles(): readonly KinematicsProfile[] {
  return PROFILE_LIST;
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
}): KinematicsProfile {
  const definitionPrefix = `${input.exerciseId.replaceAll("_", "-")}/v1`;
  return {
    exerciseId: input.exerciseId,
    version: input.version,
    movementPattern: input.movementPattern,
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
