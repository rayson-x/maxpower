import {
  LAT_PULLDOWN_REFERENCE_FEATURES,
  type PersonalProvisionalReferenceProfile,
  type ReferenceProfileContext,
} from "./referenceTrajectory";
import type { CapturePosition } from "./viewGating";

/**
 * Nominal reference for the first high-pulldown runtime profile. Values are
 * deliberately broad image-normalized trajectory envelopes, not population
 * norms: they encode expected phase direction and obvious path divergence
 * until recordings calibrate a narrower same-identity corridor.
 */
export function buildSimulatedLatPulldownReference(
  identity: ReferenceProfileContext & {
    exerciseId: "lat_pulldown";
    capturePosition: CapturePosition;
    featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2";
  },
): PersonalProvisionalReferenceProfile {
  const nodes = (["pull", "return"] as const).flatMap((phase) =>
    Array.from({ length: 16 }, (_, phaseIndex) => {
      const phaseProgress = phaseIndex / 15;
      const pullProgress = phase === "pull" ? phaseProgress : 1 - phaseProgress;
      return {
        nodeIndex: (phase === "pull" ? 0 : 16) + phaseIndex,
        phase,
        phasePercent: Number((phaseProgress * 100).toFixed(5)),
        features: LAT_PULLDOWN_REFERENCE_FEATURES.map((feature) => nominalBand(feature, pullProgress)),
      };
    }),
  );
  return {
    schemaVersion: "maxpower-provisional-reference-profile/v1",
    profileStatus: "simulated_nominal",
    identity,
    intendedUse: "compare_observed_reps_to_personal_provisional_corridor",
    prohibitedUses: [
      "form quality score",
      "population standard claim",
      "medical diagnosis",
      "injury risk prediction",
    ],
    phaseModel: {
      normalization: "piecewise_linear_start_bottom_end",
      pullNodes: 16,
      returnNodes: 16,
      unrestrictedDtwAllowed: false,
      retainRawTiming: true,
    },
    featureNames: [...LAT_PULLDOWN_REFERENCE_FEATURES],
    referencePopulation: {
      participantCount: 0,
      sessionCount: null,
      captureCount: 0,
      repCount: 0,
      sourceStatuses: ["simulated_kinematic_prior"],
      evidenceStatus: "hypothesis",
    },
    screeningSummary: {
      acceptedCandidateReps: 0,
      incompatibleCandidateReps: 0,
      unknownCandidateReps: 0,
    },
    corridor: {
      method: "pointwise_median_empirical_q10_q90",
      nodes,
      evidenceStatus: "hypothesis",
    },
    matchingPolicy: {
      minimumPointObservations: null,
      minimumComparableNodeRatio: null,
      sustainedOutsideNodes: null,
      maximumOutsideNodeRatio: null,
      minimumObservationConfidence: 0.5,
      unrestrictedDtwAllowed: false,
      decisionThresholdsCalibrated: false,
      evidenceStatus: "hypothesis",
    },
    provenance: {
      captureIds: [],
      repIds: [],
      generatedAt: null,
      notes: [
        "Simulated nominal trajectory: broad phase-direction envelope only.",
        "Human-approved same-identity recordings may calibrate this profile but must not be used to impute missing landmarks.",
      ],
    },
  };
}

function nominalBand(feature: typeof LAT_PULLDOWN_REFERENCE_FEATURES[number], pullProgress: number) {
  const center = nominalCenter(feature, pullProgress);
  const halfWidth = nominalHalfWidth(feature);
  return {
    nObserved: 1,
    nSessionsObserved: null,
    median: center,
    qLow: Number((center - halfWidth).toFixed(5)),
    qHigh: Number((center + halfWidth).toFixed(5)),
    medianAbsoluteDeviation: halfWidth,
    medianConfidence: 1,
    coverageRate: 1,
    evidenceStatus: "hypothesis" as const,
  };
}

function nominalCenter(feature: typeof LAT_PULLDOWN_REFERENCE_FEATURES[number], progress: number): number {
  switch (feature) {
    case "leftWristHeight":
    case "rightWristHeight": return -1.2 + 1.4 * progress;
    case "leftElbowAngleDeg":
    case "rightElbowAngleDeg": return 165 - 95 * progress;
    case "leftUpperArmToTorsoDeg":
    case "rightUpperArmToTorsoDeg": return 145 - 85 * progress;
    case "leftWristLateral": return -0.9 + 0.2 * progress;
    case "rightWristLateral": return 0.9 - 0.2 * progress;
    case "bilateralWristHeightDelta":
    case "torsoLateralShift":
    case "torsoLateralTiltDeg": return 0;
  }
}

function nominalHalfWidth(feature: typeof LAT_PULLDOWN_REFERENCE_FEATURES[number]): number {
  switch (feature) {
    case "leftWristHeight":
    case "rightWristHeight": return 0.75;
    case "leftElbowAngleDeg":
    case "rightElbowAngleDeg": return 45;
    case "leftUpperArmToTorsoDeg":
    case "rightUpperArmToTorsoDeg": return 50;
    case "leftWristLateral":
    case "rightWristLateral": return 0.7;
    case "bilateralWristHeightDelta": return 0.8;
    case "torsoLateralShift": return 0.5;
    case "torsoLateralTiltDeg": return 18;
  }
}
