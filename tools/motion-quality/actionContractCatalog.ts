export type CapturePosition =
  | "front"
  | "frontLeft45"
  | "left"
  | "rearLeft45"
  | "rear"
  | "rearRight45"
  | "right"
  | "frontRight45";

export type EquipmentMode =
  | "barbell"
  | "bodyweight"
  | "cable_bar"
  | "cable_handle"
  | "chest_press_machine"
  | "dumbbell"
  | "fixed_pull_up_bar";

export type TrainingSide = "bilateral" | "left" | "right";
export type MotionPhase = "concentric" | "eccentric";
export type CountingMode = "bilateral_cycle" | "unilateral_cycle_per_side";
export type PhaseCapability = "phase_supported" | "observation_only";
export type QualityCapability = "direct_observation_proposal" | "quality_supported";
export type EquipmentCapability = "tracked" | "conditional" | "unavailable" | "not_applicable";

export const QUALITY_DIMENSIONS = [
  "task_completion",
  "range_of_motion",
  "phase_control",
  "support_stability",
  "bilateral_coordination",
  "trajectory_control",
  "standard_variant_compatibility",
  "observation_confidence",
] as const;

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];
export type ObservabilityState = "observable" | "conditional" | "abstain" | "not_applicable";
export type AbstainReason =
  | "active_side_ambiguous"
  | "equipment_policy_not_frozen_for_exact_context"
  | "equipment_track_unavailable"
  | "front_oblique_projection_not_physical_height"
  | "hidden_or_unreliable_joint_strategy"
  | "insufficient_independent_feature_groups"
  | "insufficient_required_landmark_coverage"
  | "no_calibrated_range_corridor"
  | "no_exact_reviewed_reference"
  | "not_applicable_to_unilateral_action"
  | "phase_not_validated_for_exact_context"
  | "predicted_only_evidence"
  | "pure_side_view_cannot_support_bilateral_projection"
  | "rear_oblique_projection_not_physical_height"
  | "rust_rep_unavailable";

export type DirectObservation =
  | "active_side_path"
  | "bilateral_projected_path"
  | "bilateral_turnaround_timing"
  | "body_center_relative_to_fixed_hands"
  | "body_path_continuity"
  | "complete_cycle"
  | "endpoint_return"
  | "equipment_axis_image_slope"
  | "equipment_center_path"
  | "evidence_source_mix"
  | "landmark_coverage"
  | "pause_and_reversal"
  | "phase_duration"
  | "pose_path_continuity"
  | "projected_range"
  | "torso_center_path"
  | "torso_tilt_range"
  | "wrist_spread_cycle";

export interface DimensionProjection {
  readonly state: ObservabilityState;
  readonly observations: readonly DirectObservation[];
  readonly abstainReasons: readonly AbstainReason[];
}

export type DimensionProjectionMap = Readonly<Record<QualityDimension, DimensionProjection>>;

export const ACTION_CONTRACT_CATALOG_POLICY = Object.freeze({
  schemaVersion: "maxpower-action-contract-catalog/v1",
  purpose: "review_report_projection",
  inputAuthority: "rust_sealed_rep",
  mayRecomputeRustRep: false,
  aggregateScore: "forbidden",
  causalPhysiologyInference: "forbidden",
} as const);

export interface PhaseSemantics {
  readonly startAnchor: string;
  readonly primaryTurnaround: string;
  readonly endReturn: string;
  readonly order: readonly [MotionPhase, MotionPhase];
}

export interface ProjectionCapability {
  readonly repAuthority: "rust_sealed_rep";
  readonly phase: PhaseCapability;
  readonly quality: QualityCapability;
  readonly equipment: EquipmentCapability;
}

export interface ExactActionContextKey {
  readonly exerciseId: string;
  readonly capturePosition: CapturePosition;
  readonly equipment: EquipmentMode;
  readonly trainingSide: TrainingSide;
}

export interface ExactActionContextContract {
  readonly key: ExactActionContextKey;
  readonly capability: ProjectionCapability;
  readonly dimensions: DimensionProjectionMap;
}

export interface ActionContract {
  readonly exerciseId: string;
  readonly phase: PhaseSemantics;
  readonly countingMode: CountingMode;
  readonly contexts: readonly ExactActionContextContract[];
}

function exactContext(
  exerciseId: string,
  capturePosition: CapturePosition,
  equipment: EquipmentMode,
  trainingSide: TrainingSide,
  phaseCapability: PhaseCapability,
  equipmentCapability: EquipmentCapability,
): ExactActionContextContract {
  const capability: ProjectionCapability = {
    repAuthority: "rust_sealed_rep",
    phase: phaseCapability,
    quality: "direct_observation_proposal",
    equipment: equipmentCapability,
  };
  return {
    key: { exerciseId, capturePosition, equipment, trainingSide },
    capability,
    dimensions: dimensionsFor(exerciseId, capturePosition, trainingSide, capability),
  };
}

function dimension(
  state: ObservabilityState,
  observations: readonly DirectObservation[],
  abstainReasons: readonly AbstainReason[],
): DimensionProjection {
  return { state, observations, abstainReasons };
}

function appendReason(
  projection: DimensionProjection,
  reason: AbstainReason,
): DimensionProjection {
  return projection.abstainReasons.includes(reason)
    ? projection
    : { ...projection, abstainReasons: [...projection.abstainReasons, reason] };
}

/**
 * Describes how an already sealed Rust Rep may be projected for review.
 * No frame, endpoint, phase, or Rep boundary is calculated in this catalog.
 */
function dimensionsFor(
  exerciseId: string,
  capturePosition: CapturePosition,
  trainingSide: TrainingSide,
  capability: ProjectionCapability,
): DimensionProjectionMap {
  const dimensions: Record<QualityDimension, DimensionProjection> = {
    task_completion: dimension(
      capability.phase === "phase_supported" ? "observable" : "conditional",
      ["complete_cycle", "endpoint_return"],
      capability.phase === "phase_supported"
        ? ["rust_rep_unavailable"]
        : ["rust_rep_unavailable", "phase_not_validated_for_exact_context"],
    ),
    range_of_motion: dimension(
      "conditional",
      ["projected_range", "endpoint_return"],
      ["rust_rep_unavailable", "insufficient_required_landmark_coverage", "predicted_only_evidence", "no_calibrated_range_corridor"],
    ),
    phase_control: dimension(
      capability.phase === "phase_supported" ? "observable" : "conditional",
      ["phase_duration", "pause_and_reversal"],
      capability.phase === "phase_supported"
        ? ["rust_rep_unavailable"]
        : ["rust_rep_unavailable", "phase_not_validated_for_exact_context"],
    ),
    support_stability: dimension(
      "conditional",
      ["torso_center_path", "torso_tilt_range"],
      ["rust_rep_unavailable", "insufficient_required_landmark_coverage", "predicted_only_evidence", "insufficient_independent_feature_groups"],
    ),
    bilateral_coordination: dimension(
      "conditional",
      ["bilateral_turnaround_timing", "bilateral_projected_path"],
      ["rust_rep_unavailable", "insufficient_required_landmark_coverage", "predicted_only_evidence"],
    ),
    trajectory_control: dimension(
      "conditional",
      ["pose_path_continuity"],
      ["rust_rep_unavailable", "insufficient_required_landmark_coverage", "predicted_only_evidence"],
    ),
    standard_variant_compatibility: dimension(
      "abstain",
      [],
      ["no_exact_reviewed_reference"],
    ),
    observation_confidence: dimension(
      "observable",
      ["landmark_coverage", "evidence_source_mix"],
      ["rust_rep_unavailable"],
    ),
  };

  if (trainingSide !== "bilateral") {
    dimensions.bilateral_coordination = dimension(
      "not_applicable",
      [],
      ["not_applicable_to_unilateral_action"],
    );
    dimensions.trajectory_control = {
      ...dimensions.trajectory_control,
      observations: ["active_side_path"],
      abstainReasons: [...dimensions.trajectory_control.abstainReasons, "active_side_ambiguous"],
    };
  } else if (capturePosition === "left" || capturePosition === "right") {
    dimensions.bilateral_coordination = dimension(
      "abstain",
      [],
      ["pure_side_view_cannot_support_bilateral_projection"],
    );
  } else if (capturePosition === "frontLeft45" || capturePosition === "frontRight45") {
    dimensions.bilateral_coordination = appendReason(
      dimensions.bilateral_coordination,
      "front_oblique_projection_not_physical_height",
    );
  } else if (capturePosition === "rearLeft45" || capturePosition === "rearRight45") {
    dimensions.bilateral_coordination = appendReason(
      dimensions.bilateral_coordination,
      "rear_oblique_projection_not_physical_height",
    );
  }

  if (capability.equipment === "tracked") {
    dimensions.trajectory_control = {
      ...dimensions.trajectory_control,
      observations: capturePosition === "front"
        ? ["pose_path_continuity", "equipment_center_path", "equipment_axis_image_slope"]
        : ["pose_path_continuity", "equipment_center_path"],
    };
  } else if (capability.equipment === "conditional") {
    dimensions.trajectory_control = appendReason(
      {
        ...dimensions.trajectory_control,
        observations: ["pose_path_continuity", "equipment_center_path"],
      },
      "equipment_policy_not_frozen_for_exact_context",
    );
  } else if (capability.equipment === "unavailable") {
    dimensions.trajectory_control = appendReason(
      dimensions.trajectory_control,
      "equipment_track_unavailable",
    );
  }

  if (exerciseId === "push_up") {
    dimensions.trajectory_control = {
      ...dimensions.trajectory_control,
      observations: ["body_path_continuity"],
    };
    dimensions.bilateral_coordination = appendReason(
      dimensions.bilateral_coordination,
      "hidden_or_unreliable_joint_strategy",
    );
  }

  if (exerciseId === "pull_up") {
    dimensions.trajectory_control = {
      ...dimensions.trajectory_control,
      observations: ["body_center_relative_to_fixed_hands", "body_path_continuity"],
    };
    dimensions.bilateral_coordination = appendReason(
      dimensions.bilateral_coordination,
      "hidden_or_unreliable_joint_strategy",
    );
  }

  if (exerciseId === "rear_delt_fly") {
    dimensions.range_of_motion = appendReason(
      { ...dimensions.range_of_motion, observations: ["projected_range", "wrist_spread_cycle"] },
      "hidden_or_unreliable_joint_strategy",
    );
    dimensions.bilateral_coordination = appendReason(
      dimensions.bilateral_coordination,
      "hidden_or_unreliable_joint_strategy",
    );
  }

  return dimensions;
}

function bilateralContexts(
  exerciseId: string,
  equipment: EquipmentMode,
  capturePositions: readonly CapturePosition[],
  phaseCapability: PhaseCapability = "phase_supported",
  equipmentCapability: EquipmentCapability = "unavailable",
): readonly ExactActionContextContract[] {
  return capturePositions.map((capturePosition) => exactContext(
    exerciseId,
    capturePosition,
    equipment,
    "bilateral",
    phaseCapability,
    equipmentCapability,
  ));
}

function phase(
  startAnchor: string,
  primaryTurnaround: string,
  endReturn: string,
  order: readonly [MotionPhase, MotionPhase],
): PhaseSemantics {
  return { startAnchor, primaryTurnaround, endReturn, order };
}

export const ACTION_CONTRACT_CATALOG = [
  {
    exerciseId: "barbell_bench_press",
    phase: phase("upper_lockout", "lower_chest_turnaround", "upper_return", ["eccentric", "concentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("barbell_bench_press", "barbell", ["front", "frontLeft45", "frontRight45"], "phase_supported", "tracked"),
  },
  {
    exerciseId: "barbell_row",
    phase: phase("arms_extended", "load_near_torso", "arms_extended_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("barbell_row", "barbell", ["front", "frontLeft45", "frontRight45", "rearLeft45", "rearRight45"], "phase_supported", "conditional"),
  },
  {
    exerciseId: "machine_chest_press",
    phase: phase("handles_near_torso", "arms_extended", "handles_near_torso_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("machine_chest_press", "chest_press_machine", ["front", "frontRight45"]),
  },
  {
    exerciseId: "seated_shoulder_press",
    phase: phase("bar_at_shoulders", "overhead_turnaround", "bar_at_shoulders_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts(
      "seated_shoulder_press",
      "barbell",
      ["front", "frontLeft45", "frontRight45"],
      "phase_supported",
      "tracked",
    ),
  },
  {
    exerciseId: "push_up",
    phase: phase("top_support", "bottom_turnaround", "top_support_return", ["eccentric", "concentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("push_up", "bodyweight", ["rearRight45"], "phase_supported", "not_applicable"),
  },
  {
    exerciseId: "lat_pulldown",
    phase: phase("arms_overhead", "bar_lowered", "arms_overhead_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("lat_pulldown", "cable_bar", ["rear", "rearLeft45"]),
  },
  {
    exerciseId: "pull_up",
    phase: phase("dead_hang", "upper_turnaround", "dead_hang_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("pull_up", "fixed_pull_up_bar", ["rearLeft45"], "observation_only", "not_applicable"),
  },
  {
    exerciseId: "seated_row",
    phase: phase("arms_extended", "handle_near_torso", "arms_extended_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("seated_row", "cable_handle", ["frontLeft45", "rearLeft45", "right"]),
  },
  {
    exerciseId: "straight_arm_pulldown",
    phase: phase("arms_overhead", "handle_lowered", "arms_overhead_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("straight_arm_pulldown", "cable_bar", ["frontLeft45", "frontRight45"]),
  },
  {
    exerciseId: "lateral_raise",
    phase: phase("arms_lowered", "arms_raised", "arms_lowered_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("lateral_raise", "dumbbell", ["front"]),
  },
  {
    exerciseId: "rear_delt_fly",
    phase: phase("arms_closed", "arms_spread", "arms_closed_return", ["concentric", "eccentric"]),
    countingMode: "bilateral_cycle",
    contexts: bilateralContexts("rear_delt_fly", "dumbbell", ["front"]),
  },
  {
    exerciseId: "single_arm_cable_lateral_raise",
    phase: phase("working_arm_lowered", "working_arm_raised", "working_arm_lowered_return", ["concentric", "eccentric"]),
    countingMode: "unilateral_cycle_per_side",
    contexts: [
      exactContext("single_arm_cable_lateral_raise", "frontLeft45", "cable_handle", "left", "phase_supported", "unavailable"),
      exactContext("single_arm_cable_lateral_raise", "rearRight45", "cable_handle", "right", "phase_supported", "unavailable"),
    ],
  },
] as const satisfies readonly ActionContract[];

export function getExactActionContextContract(
  key: Readonly<{
    exerciseId: string;
    capturePosition: string;
    equipment: string;
    trainingSide: string;
  }>,
): ExactActionContextContract | undefined {
  return ACTION_CONTRACT_CATALOG
    .find((contract) => contract.exerciseId === key.exerciseId)
    ?.contexts.find((context) => (
      context.key.capturePosition === key.capturePosition
      && context.key.equipment === key.equipment
      && context.key.trainingSide === key.trainingSide
    ));
}
