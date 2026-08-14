import type {
  RustEquipmentObservation,
  RustEquipmentObservationKind,
} from "./rustCanonicalWasm";

export type EquipmentRecognitionPreference = "auto" | "disabled";
export type SelectedFreeWeightEquipment = "barbell" | "dumbbell" | "none";

export interface EquipmentRecognitionContext {
  /** Exact exercise chosen by the user before capture; never inferred from the frame. */
  readonly exerciseId: string;
  /** Required for exercise names whose implementation can use different free weights. */
  readonly selectedEquipment?: SelectedFreeWeightEquipment;
  readonly preference?: EquipmentRecognitionPreference;
}

export interface EquipmentRecognitionPolicy {
  readonly enabled: boolean;
  readonly kinds: readonly RustEquipmentObservationKind[];
  /** Equipment contributes phase evidence directly; it is not a pose fallback. */
  readonly role: "phase_evidence";
  readonly requiredForRepCounting: false;
  readonly reason:
    | "selected-exercise-uses-barbell"
    | "selected-exercise-uses-dumbbell"
    | "selected-equipment-uses-barbell"
    | "selected-equipment-uses-dumbbell"
    | "equipment-recognition-disabled"
    | "equipment-variant-not-selected"
    | "selected-exercise-does-not-use-supported-equipment";
}

/**
 * Product default used only when the selected exercise already fixes the
 * free-weight variant. Callers must still preserve an explicit user choice.
 */
export function defaultSelectedFreeWeightEquipment(
  exerciseId: string,
): SelectedFreeWeightEquipment {
  if (exerciseId === "seated_shoulder_press") return "barbell";
  if (BARBELL_EXERCISES.has(exerciseId)) return "barbell";
  if (DUMBBELL_EXERCISES.has(exerciseId)) return "dumbbell";
  return "none";
}

const BARBELL_KINDS = Object.freeze([
  "barbell_shaft",
  "weight_plate",
] satisfies RustEquipmentObservationKind[]);
const DUMBBELL_KINDS = Object.freeze([
  "dumbbell",
] satisfies RustEquipmentObservationKind[]);

// These IDs encode an unambiguous equipment choice in the exercise registry.
// Do not use fuzzy name matching: action selection is the product contract.
const BARBELL_EXERCISES = new Set([
  "barbell_back_squat",
  "barbell_bench_press",
  "barbell_biceps_curl",
  "barbell_row",
  "close_grip_bench_press",
  "conventional_deadlift",
  "decline_barbell_bench_press",
  "front_squat",
]);

const DUMBBELL_EXERCISES = new Set([
  "alternating_dumbbell_biceps_curl",
  "arnold_press",
  "dumbbell_bench_press",
  "dumbbell_biceps_curl",
  "dumbbell_shoulder_press",
  "hammer_curl",
  "incline_dumbbell_curl",
  "incline_dumbbell_press",
  "one_arm_dumbbell_row",
  "standing_dumbbell_row",
]);

const EQUIPMENT_VARIANT_EXERCISES = new Set([
  "bulgarian_split_squat",
  "romanian_deadlift",
  "walking_lunge",
  "seated_shoulder_press",
]);

/**
 * Resolves whether the expensive equipment pipeline is allowed to run for the
 * exact action selected before capture. It never classifies an exercise from
 * pixels and it never makes equipment mandatory for rep counting.
 */
export function resolveEquipmentRecognitionPolicy(
  context: EquipmentRecognitionContext,
): EquipmentRecognitionPolicy {
  if ((context.preference ?? "auto") === "disabled") {
    return disabledPolicy("equipment-recognition-disabled");
  }
  if (BARBELL_EXERCISES.has(context.exerciseId)) {
    return enabledPolicy(BARBELL_KINDS, "selected-exercise-uses-barbell");
  }
  if (DUMBBELL_EXERCISES.has(context.exerciseId)) {
    return enabledPolicy(DUMBBELL_KINDS, "selected-exercise-uses-dumbbell");
  }
  if (EQUIPMENT_VARIANT_EXERCISES.has(context.exerciseId)) {
    if (context.selectedEquipment === "barbell") {
      return enabledPolicy(BARBELL_KINDS, "selected-equipment-uses-barbell");
    }
    if (context.selectedEquipment === "dumbbell") {
      return enabledPolicy(DUMBBELL_KINDS, "selected-equipment-uses-dumbbell");
    }
    return disabledPolicy("equipment-variant-not-selected");
  }
  return disabledPolicy("selected-exercise-does-not-use-supported-equipment");
}

/** Drops stale or wrong-kind detections whenever the selected action changes. */
export function routeEquipmentObservations(
  policy: EquipmentRecognitionPolicy,
  observations: readonly RustEquipmentObservation[],
): readonly RustEquipmentObservation[] {
  if (!policy.enabled) return [];
  const allowed = new Set(policy.kinds);
  return observations.filter((observation) => allowed.has(observation.kind));
}

function enabledPolicy(
  kinds: readonly RustEquipmentObservationKind[],
  reason: Extract<EquipmentRecognitionPolicy["reason"], `selected-${string}`>,
): EquipmentRecognitionPolicy {
  return Object.freeze({
    enabled: true,
    kinds,
    role: "phase_evidence",
    requiredForRepCounting: false,
    reason,
  });
}

function disabledPolicy(reason: EquipmentRecognitionPolicy["reason"]): EquipmentRecognitionPolicy {
  return Object.freeze({
    enabled: false,
    kinds: Object.freeze([]),
    role: "phase_evidence",
    requiredForRepCounting: false,
    reason,
  });
}
