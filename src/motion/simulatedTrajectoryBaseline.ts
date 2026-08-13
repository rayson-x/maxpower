import { EXERCISE_REGISTRY } from "../pose/exerciseRegistry";
import {
  getSimulatedKinematicPriorTemplate,
  SIMULATED_PRIOR_NODE_COUNT,
  SIMULATED_PRIOR_NODES_PER_PHASE,
} from "../pose/simulatedKinematicPrior";
import type {
  RustExerciseProfileData,
  RustSimulatedTrajectoryBaselineInstallation,
} from "./rustCanonicalWasm";
import type { RustProfileContext } from "./rustProfileResolver";

/**
 * Compiles a catalog-only five-split prior into the narrow schema accepted by
 * the Rust runtime. The corridor is deliberately broad and phase-relative:
 * it carries no population pose claim, no range-of-motion threshold, and no
 * form verdict. Rust compares it only after it seals the rep boundaries.
 */
export function buildSimulatedTrajectoryBaseline(
  context: RustProfileContext,
  exerciseProfile: RustExerciseProfileData,
  poseModelVersion: string,
): RustSimulatedTrajectoryBaselineInstallation | null {
  if (context.trainingSide !== "bilateral" || context.variation.trim() !== "") return null;
  const template = getSimulatedKinematicPriorTemplate(context.exerciseId);
  const exercise = EXERCISE_REGISTRY.get(context.exerciseId);
  if (!template || !exercise || !template.supportedCapturePositions.includes(context.capturePosition as never)) {
    return null;
  }
  const identity = {
    exerciseId: context.exerciseId,
    capturePosition: context.capturePosition,
    variation: "catalog_default/v1",
    trainingSide: context.trainingSide,
    equipment: exercise.equipment.join("+") || "catalog_unspecified",
    coordinateSystem: "source-image/v1",
    featureSchemaId: "profile-signal-phase/v1",
    poseModelVersion,
  } as const;
  const nodes = Array.from({ length: SIMULATED_PRIOR_NODE_COUNT }, (_, nodeIndex) => {
    const phaseIndex = nodeIndex % SIMULATED_PRIOR_NODES_PER_PHASE;
    const progress = phaseIndex / (SIMULATED_PRIOR_NODES_PER_PHASE - 1);
    // Mirrors the source prior's piecewise-cosine activation. Its generous
    // corridor is only a review signal for direction/continuity; calibration
    // must replace it with observed same-context corridors later.
    const activation = nodeIndex < SIMULATED_PRIOR_NODES_PER_PHASE
      ? Math.sin(progress * Math.PI / 2)
      : Math.cos(progress * Math.PI / 2);
    return {
      phase: nodeIndex < SIMULATED_PRIOR_NODES_PER_PHASE ? "to_extreme" as const : "from_extreme" as const,
      phasePercent: Number((progress * 100).toFixed(5)),
      features: [0, 1].map(() => ({
        qLow: Number(Math.max(0, activation - 0.32).toFixed(5)),
        qHigh: Number(Math.min(1, activation + 0.32).toFixed(5)),
        medianAbsoluteDeviation: null,
        nObserved: 0,
      })),
    };
  });
  return {
    baseline: {
      schemaVersion: "maxpower-simulated-trajectory-baseline/v1" as const,
      source: "simulated_kinematic_prior" as const,
      evidenceStatus: "uncalibrated" as const,
      calibrationStatus: "uncalibrated" as const,
      identity,
      profileBinding: {
        exerciseProfileIdentity: exerciseProfile.identity,
        exerciseProfileHash: exerciseProfile.contentHash.toString(),
      },
      featureNames: ["primarySignalPhase", "secondarySignalPhase"] as const,
      corridor: { nodes },
      matchingPolicy: {
        minimumObservationConfidence: 0.5,
        unrestrictedDtwAllowed: false as const,
      },
    },
  };
}
