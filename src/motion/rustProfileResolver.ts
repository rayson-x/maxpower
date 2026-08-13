import type { RustExerciseProfile } from "./rustCanonicalWasm";

export interface RustProfileContext {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly trainingSide: "bilateral" | "left" | "right";
  readonly variation: string;
  readonly equipment?: "barbell" | "dumbbell" | "none";
  /** Candidate profiles are never selected by default. */
  readonly experiment?: "local-motion-coordinate-v1";
}

/** Exact context gate for built-in provisional Rust profiles. */
export function resolveRustExerciseProfile(
  context: RustProfileContext,
): RustExerciseProfile {
  if (context.trainingSide !== "bilateral") return null;
  const detail = context.variation.trim().toLowerCase();
  const view = normalizeCoarseMotionView(context.capturePosition);
  if (["", "bodyweight", "徒手"].includes(detail) && context.capturePosition === "front") {
    if (context.exerciseId === "march_in_place") return "march_in_place";
    if (context.exerciseId === "side_step_touch") return "side_step_touch";
    if (context.exerciseId === "alternating_knee_raise") return "alternating_knee_raise";
    if (context.exerciseId === "step_jack") return "step_jack";
  }
  if (context.exerciseId === "lat_pulldown") {
    if (!["", "cable", "cable straight bar", "绳索", "绳索直杆", "直杆"].includes(detail)) {
      return null;
    }
    if (context.capturePosition === "rear") return "lat_pulldown";
    if (context.capturePosition === "rearLeft45") return "lat_pulldown_rear_left_45";
  }
  if (context.exerciseId === "seated_shoulder_press") {
    const equipment = context.equipment
      ?? (["barbell", "杠铃", "杠铃坐姿"].includes(detail) ? "barbell"
        : (["", "dumbbell", "哑铃", "哑铃坐姿"].includes(detail) ? "dumbbell" : "none"));
    if (equipment === "barbell" && context.experiment === "local-motion-coordinate-v1") {
      if (view === "front") return "seated_barbell_shoulder_press_local_front";
      if (view === "front_oblique_left") return "seated_barbell_shoulder_press_local_front_left";
      if (view === "front_oblique_right") return "seated_barbell_shoulder_press_local_front_right";
      return null;
    }
    if (equipment !== "dumbbell") return null;
    if (context.capturePosition === "frontLeft45") return "seated_shoulder_press";
    if (context.capturePosition === "front") return "seated_shoulder_press_front";
  }
  if (context.exerciseId === "dumbbell_shoulder_press") {
    if ((context.equipment ?? "dumbbell") !== "dumbbell" || context.capturePosition !== "front") {
      return null;
    }
    return "dumbbell_shoulder_press_front";
  }
  if (context.exerciseId === "barbell_bench_press"
      && context.equipment === "barbell"
      && ["", "standard", "standard_variant", "标准", "标准变式"].includes(detail)
      && context.experiment === "local-motion-coordinate-v1") {
    if (view === "front") return "barbell_bench_press_local_front";
    if (view === "front_oblique_left") return "barbell_bench_press_local_front_left";
    if (view === "front_oblique_right") return "barbell_bench_press_local_front_right";
  }
  return null;
}

/** Coarse public view buckets retain side semantics without claiming an exact angle. */
export function normalizeCoarseMotionView(capturePosition: string):
  | "front" | "front_oblique_left" | "front_oblique_right" | null {
  if (capturePosition === "front") return "front";
  if (["frontLeft45", "front_oblique_left"].includes(capturePosition)) {
    return "front_oblique_left";
  }
  if (["frontRight45", "front_oblique_right"].includes(capturePosition)) {
    return "front_oblique_right";
  }
  return null;
}
