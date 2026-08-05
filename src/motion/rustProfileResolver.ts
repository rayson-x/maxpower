import type { RustExerciseProfile } from "./rustCanonicalWasm";

export interface RustProfileContext {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly trainingSide: "bilateral" | "left" | "right";
  readonly variation: string;
}

/** Exact context gate for built-in provisional Rust profiles. */
export function resolveRustExerciseProfile(
  context: RustProfileContext,
): RustExerciseProfile {
  if (context.trainingSide !== "bilateral") return null;
  const detail = context.variation.trim().toLowerCase();
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
    if (!["", "dumbbell", "哑铃", "哑铃坐姿"].includes(detail)) return null;
    if (context.capturePosition === "frontLeft45") return "seated_shoulder_press";
    if (context.capturePosition === "front") return "seated_shoulder_press_front";
  }
  return null;
}
