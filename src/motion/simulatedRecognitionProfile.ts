import {
  getSimulatedKinematicPriorTemplate,
  type PriorFeature,
  type PriorTrend,
} from "../pose/simulatedKinematicPrior";
import {
  computeRustExerciseProfileHash,
  type RustExerciseProfileData,
} from "./rustCanonicalWasm";
import type { RustProfileContext } from "./rustProfileResolver";

type ProfileSignal = RustExerciseProfileData["primarySignal"];

/**
 * A deliberately broad first-pass profile derived from the simulated motion
 * prior. It is a recognition/counting initializer only; it cannot install a
 * quality reference or imply that its gates are normative form thresholds.
 */
export function resolveSimulatedRecognitionProfile(
  context: RustProfileContext,
): RustExerciseProfileData | null {
  if (context.trainingSide !== "bilateral") return null;
  // A simulated template has no authority to guess equipment, grip or a
  // free-text variant. The empty value means the catalog's exact default
  // context; any explicit variation needs its own template/profile bucket.
  if (context.variation.trim() !== "") return null;
  const template = getSimulatedKinematicPriorTemplate(context.exerciseId);
  if (!template || !template.supportedCapturePositions.includes(context.capturePosition as never)) {
    return null;
  }
  const primary = template.features.find((feature) => feature.role === "primary");
  if (!primary) return null;
  const signals = signalsFor(primary.feature);
  if (!signals) return null;
  const direction = directionFor(primary.trend);
  if (!direction) return null;
  const gates = gatesFor(signals.coordinateUnit);
  const identity = `simulated-${context.exerciseId}/${context.capturePosition}/bilateral/initializer/v1`;
  const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    identity,
    maturity: "provisional",
    schema: "blazepose33",
    coordinateUnit: signals.coordinateUnit,
    stateMachineId: "ready-effort-peak-return/v1",
    requiredCapabilities: ["canonical-landmarks", "subject-lock"],
    direction,
    primarySignal: signals.primary,
    secondarySignal: signals.secondary,
    ...gates,
    maxGapMs: 700,
    minRepDurationMs: 450,
    maxRepDurationMs: 8_000,
  };
  return { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
}

function signalsFor(feature: PriorFeature): {
  coordinateUnit: RustExerciseProfileData["coordinateUnit"];
  primary: ProfileSignal;
  secondary: ProfileSignal;
} | null {
  if (feature === "elbowAngleDeg") return angleSignals([11, 13, 15], [12, 14, 16]);
  if (feature === "kneeAngleDeg") return angleSignals([23, 25, 27], [24, 26, 28]);
  if (feature === "hipAngleDeg") return angleSignals([11, 23, 25], [12, 24, 26]);
  if (feature === "wristHeightRelativeShoulderY") return ySignals([15], [16]);
  if (feature === "hipHeightRelativeAnkleY") return ySignals([23], [24]);
  if (feature === "heelHeightRelativeAnkleY") return ySignals([29], [30]);
  if (feature === "wristDistanceToShoulder") return distanceSignals([15, 11], [16, 12]);
  if (feature === "wristLateralSpread") return distanceSignals([15, 16], [15, 16]);
  return null;
}

function angleSignals(
  primary: readonly [number, number, number],
  secondary: readonly [number, number, number],
) {
  return {
    coordinateUnit: "image-angle-deg" as const,
    primary: { kind: "joint-angle" as const, landmarks: primary },
    secondary: { kind: "joint-angle" as const, landmarks: secondary },
  };
}

function ySignals(primary: readonly [number], secondary: readonly [number]) {
  return {
    coordinateUnit: "image-normalized-y" as const,
    primary: { kind: "landmark-y" as const, landmarks: primary },
    secondary: { kind: "landmark-y" as const, landmarks: secondary },
  };
}

function distanceSignals(primary: readonly [number, number], secondary: readonly [number, number]) {
  return {
    coordinateUnit: "torso-normalized-distance" as const,
    primary: { kind: "landmark-distance" as const, landmarks: primary },
    secondary: { kind: "landmark-distance" as const, landmarks: secondary },
  };
}

function directionFor(trend: PriorTrend): RustExerciseProfileData["direction"] | null {
  return trend === "increase_to_extreme"
    ? "increasing"
    : trend === "decrease_to_extreme"
      ? "decreasing"
      : null;
}

function gatesFor(unit: RustExerciseProfileData["coordinateUnit"]): Pick<
  RustExerciseProfileData,
  "startAmplitude" | "minPrimaryAmplitude" | "minSecondaryAmplitude" | "returnHysteresis" | "readyTolerance"
> {
  if (unit === "image-angle-deg") {
    return { startAmplitude: 5, minPrimaryAmplitude: 20, minSecondaryAmplitude: 20, returnHysteresis: 5, readyTolerance: 6 };
  }
  if (unit === "torso-normalized-distance") {
    return { startAmplitude: 0.04, minPrimaryAmplitude: 0.15, minSecondaryAmplitude: 0.15, returnHysteresis: 0.04, readyTolerance: 0.05 };
  }
  return { startAmplitude: 0.02, minPrimaryAmplitude: 0.08, minSecondaryAmplitude: 0.08, returnHysteresis: 0.02, readyTolerance: 0.025 };
}
