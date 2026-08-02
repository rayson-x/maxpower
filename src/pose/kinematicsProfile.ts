import type { CameraView, PhaseMeaning } from "./formRuleEngine";
import type { LogicalJoint, SignalKind } from "./repSegmenter";

export interface KinematicsMetricDefinition {
  definitionId: string;
  unit: "normalized" | "ratio" | "deg" | "ms";
  joints: readonly LogicalJoint[];
  supportedViews: readonly CameraView[];
}

export interface KinematicsProfile {
  exerciseId: string;
  version: string;
  movementPattern: "horizontal_pull" | "vertical_pull";
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
  }),
  profile({
    exerciseId: "pull_up",
    version: "pull-up-kinematics/v1",
    movementPattern: "vertical_pull",
    signal: "wrist_height",
    effortExtreme: "max",
    preferredView: "front",
    amplitudeJoints: ["shoulder", "wrist"],
  }),
  profile({
    exerciseId: "lat_pulldown",
    version: "lat-pulldown-kinematics/v1",
    movementPattern: "vertical_pull",
    signal: "wrist_height",
    effortExtreme: "max",
    preferredView: "front",
    amplitudeJoints: ["shoulder", "wrist"],
  }),
  profile({
    exerciseId: "seated_row",
    version: "seated-row-kinematics/v1",
    movementPattern: "horizontal_pull",
    signal: "elbow_angle",
    effortExtreme: "min",
    preferredView: "oblique45",
    amplitudeJoints: ["shoulder", "elbow", "wrist"],
  }),
  profile({
    exerciseId: "straight_arm_pulldown",
    version: "straight-arm-pulldown-kinematics/v1",
    movementPattern: "vertical_pull",
    signal: "shoulder_angle",
    effortExtreme: "min",
    preferredView: "side",
    amplitudeJoints: ["hip", "shoulder", "wrist"],
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
  preferredView: CameraView;
  amplitudeJoints: readonly LogicalJoint[];
}): KinematicsProfile {
  const definitionPrefix = `${input.exerciseId.replaceAll("_", "-")}/v1`;
  return {
    exerciseId: input.exerciseId,
    version: input.version,
    movementPattern: input.movementPattern,
    preferredView: input.preferredView,
    supportedViews: COMMON_VIEWS,
    phaseSignal: {
      kind: input.signal,
      effortExtreme: input.effortExtreme,
      toExtreme: "concentric",
      fromExtreme: "eccentric",
    },
    metrics: {
      amplitude: {
        definitionId: `${definitionPrefix}/amplitude/${input.signal}`,
        unit: "normalized",
        joints: input.amplitudeJoints,
        supportedViews: COMMON_VIEWS,
      },
      bilateralAsymmetry: {
        definitionId: `${definitionPrefix}/bilateral-path-asymmetry`,
        unit: "ratio",
        joints: ["wrist"],
        supportedViews: ["front", "oblique45"],
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
        supportedViews: COMMON_VIEWS,
      },
    },
  };
}
