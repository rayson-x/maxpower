import {
  RUST_EXERCISE_PROFILE_CODES,
  type RustExerciseProfile,
} from "./rustCanonicalWasm";
import {
  resolveInstalledBenchProfileSelection,
  type BenchProfileSelection,
  type ExecutableRustProfileRef,
  type RuntimeBuiltInProfileAttestation,
} from "./benchProfileSelector";

export interface RustProfileContext {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly trainingSide: "bilateral" | "left" | "right";
  readonly variation: string;
  readonly equipment?: "barbell" | "dumbbell" | "none";
  /** Exact pose contract for callers that can switch inference engines. */
  readonly poseRuntime?: Readonly<{
    engine: "mediapipe" | "rtmpose";
    schema: "blazepose33" | "halpe26";
  }>;
  /** Candidate profiles are never selected by default. */
  readonly experiment?: "local-motion-coordinate-v1";
}

export type RustRuntimeProfileResolution = Readonly<{
  kind: "built_in";
  profile: Exclude<RustExerciseProfile, null>;
  promotion: Pick<BenchProfileSelection, "status" | "reasonCodes"> | null;
  /** Present only for an evidence-promoted profile that Rust must attest before execution. */
  executableProfile?: ExecutableRustProfileRef;
}> | Readonly<{
  kind: "legacy";
  profile: null;
  promotion: Pick<BenchProfileSelection, "status" | "reasonCodes"> | null;
}>;

const BENCH_LOCAL_PROFILE_IDENTITY = "barbell_bench_press/local-motion/v1";

export interface RustRuntimeProfileOptions {
  /** Web reads this from the currently loaded WASM ABI. */
  readonly runtimeAttestation?: RuntimeBuiltInProfileAttestation | null;
  /** Native bridges verify the sealed hash immediately before `motion_sdk_set_profile`. */
  readonly deferRuntimeAttestationToNative?: boolean;
}

/**
 * Shared production profile gate used by Web and both native clients.
 * Bench local-coordinate profiles require immutable evidence plus an exact
 * manual activation. The separately scoped shoulder-press expansion is
 * executable only when the caller explicitly selects a barbell.
 */
export function resolveRustRuntimeProfile(
  context: RustProfileContext,
  options: RustRuntimeProfileOptions = {},
): RustRuntimeProfileResolution {
  if (context.exerciseId === "barbell_bench_press") {
    const view = normalizeCoarseMotionView(context.capturePosition);
    const localProfile = supportsLocalMotionProfile(context)
      ? resolveRustExerciseProfile({ ...context, experiment: "local-motion-coordinate-v1" })
      : null;
    const promotion = resolveInstalledBenchProfileSelection({
      exerciseId: context.exerciseId,
      variation: normalizedBenchVariation(context.variation),
      equipment: context.equipment ?? "none",
      trainingSide: context.trainingSide,
      capturePosition: view ?? context.capturePosition,
    }, localProfile ? RUST_EXERCISE_PROFILE_CODES[localProfile] + 100 : null,
    options.runtimeAttestation ?? null,
    options.deferRuntimeAttestationToNative === true);
    if (
      promotion?.status === "promoted"
      && promotion.selectedProfile.identity === BENCH_LOCAL_PROFILE_IDENTITY
      && promotion.executableProfile
      && localProfile
    ) {
      return {
        kind: "built_in",
        profile: localProfile,
        promotion,
        executableProfile: promotion.executableProfile,
      };
    }
    return {
      kind: "legacy",
      profile: null,
      promotion: promotion
        ? { status: promotion.status, reasonCodes: promotion.reasonCodes }
        : null,
    };
  }

  const selected = context.exerciseId === "seated_shoulder_press"
    && context.equipment === "barbell"
    && supportsLocalMotionProfile(context)
    ? resolveRustExerciseProfile({ ...context, experiment: "local-motion-coordinate-v1" })
    : resolveRustExerciseProfile(context);
  return selected
    ? { kind: "built_in", profile: selected, promotion: null }
    : { kind: "legacy", profile: null, promotion: null };
}

/** Exact context gate for built-in provisional Rust profiles. */
export function resolveRustExerciseProfile(
  context: RustProfileContext,
): RustExerciseProfile {
  if (
    context.experiment === "local-motion-coordinate-v1"
    && !supportsLocalMotionProfile(context)
  ) return null;
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

function supportsLocalMotionProfile(context: RustProfileContext): boolean {
  // Native callers currently omit this because their adapter is fixed to
  // RTMPose Halpe-26. Runtime-switchable Web callers always provide it.
  return context.poseRuntime === undefined
    || (context.poseRuntime.engine === "rtmpose" && context.poseRuntime.schema === "halpe26");
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

function normalizedBenchVariation(variation: string): string {
  const detail = variation.trim().toLowerCase();
  return ["", "standard", "standard_variant", "标准", "标准变式"].includes(detail)
    ? "standard_variant"
    : variation;
}
