import {
  adaptRustExerciseProfileToPoseSchema,
  computeRustExerciseProfileHash,
  encodeRustExerciseProfileInstallation,
  RUST_EXERCISE_PROFILE_CODES,
  type RustExerciseProfileData,
} from "../motion/rustCanonicalWasm";
import {
  installObservedRecognitionProfiles,
  resolveObservedRecognitionProfile,
} from "../motion/observedRecognitionProfiles";
import { resolveRustExerciseProfile } from "../motion/rustProfileResolver";
import { resolveSimulatedRecognitionProfile } from "../motion/simulatedRecognitionProfile";
import { recommendCapturePosition, type CapturePosition } from "../pose/viewGating";
import { resolveEquipmentRecognitionPolicy } from "../motion/equipmentRecognitionPolicy";
import {
  ExactMotionCapabilityResolver,
  type ExecutableProfileLookup,
  type MotionCapabilityDecision,
  type MotionCapabilityInput,
} from "../motion/MotionCapabilityResolver";
import observedProfileArtifact from "../../public/archives/confirmed-captures/recognition-profiles.json";

// Native clients remain offline: bundle the small approved recognition artifact
// instead of relying on the Web-only fetch path.
installObservedRecognitionProfiles(observedProfileArtifact);

export type LensFacing = "front" | "back";
export type RecognitionMode = "built_in" | "observed" | "simulated_initializer" | "none";
export type RecognitionAvailability = "available" | "unavailable";

export interface RecognitionCapability {
  readonly mode: RecognitionMode;
  readonly canRunRustRecognition: boolean;
  readonly canCount: boolean;
  readonly canEmitPhase: boolean;
  readonly profileIdentity: string | null;
  /** Opaque native-view input. Kotlin validates its schema before crossing JNI. */
  readonly nativeProfileJson: string;
}

const NATIVE_PROFILE_SCHEMA = "maxpower-native-recognition-profile/v1" as const;
type NativeEquipmentVision = "off" | "barbell_axis";

/**
 * Resolves one exact native recognition context. Evidence maturity is kept in
 * the profile lineage but never used as an availability gate.
 */
export function resolveRecognitionCapability(
  exerciseId: string,
  capturePosition: CapturePosition,
  platform: "android" | "ios" | "web" | "fixture" = "android",
): RecognitionCapability {
  const equipmentVision = resolveNativeEquipmentVision(exerciseId);
  const context = {
    exerciseId,
    capturePosition,
    trainingSide: "bilateral",
    variation: "",
  } as const;
  if (platform !== "android" && platform !== "ios" && platform !== "fixture") {
    return {
      mode: "none",
      canRunRustRecognition: false,
      canCount: false,
      canEmitPhase: false,
      profileIdentity: null,
      nativeProfileJson: JSON.stringify({
        schemaVersion: NATIVE_PROFILE_SCHEMA,
        mode: "none",
        profileCode: 0,
        equipmentVision,
      }),
    };
  }
  const builtIn = resolveRustExerciseProfile(context);
  const observed = resolveObservedRecognitionProfile(context);
  const keepsBuiltInReferenceBinding = builtIn === "lat_pulldown"
    || builtIn === "lat_pulldown_rear_left_45";
  const simulated = !builtIn && !observed
    ? resolveSimulatedRecognitionProfile(context)
    : null;
  const dataProfile = observed && !keepsBuiltInReferenceBinding ? observed : simulated;
  const targetSchema = platform === "fixture" ? "blazepose33" : "halpe26";

  if (dataProfile) {
    return dataCapability(
      observed === dataProfile ? "observed" : "simulated_initializer",
      activateClientPhaseEvidence(
        exerciseId,
        adaptRustExerciseProfileToPoseSchema(dataProfile, targetSchema),
      ),
      equipmentVision,
    );
  }
  if (builtIn) {
    const baseProfileCode = RUST_EXERCISE_PROFILE_CODES[builtIn];
    const profileCode = targetSchema === "halpe26" ? baseProfileCode + 100 : baseProfileCode;
    return {
      mode: "built_in",
      canRunRustRecognition: true,
      canCount: true,
      canEmitPhase: true,
      profileIdentity: builtIn,
      nativeProfileJson: JSON.stringify({
        schemaVersion: NATIVE_PROFILE_SCHEMA,
        mode: "built_in",
        profileCode,
        equipmentVision,
      }),
    };
  }
  return {
    mode: "none",
    canRunRustRecognition: false,
    canCount: false,
    canEmitPhase: false,
    profileIdentity: null,
    nativeProfileJson: JSON.stringify({
      schemaVersion: NATIVE_PROFILE_SCHEMA,
      mode: "none",
      profileCode: 0,
      equipmentVision,
    }),
  };
}

export function recognitionAvailabilityForExercise(exerciseId: string): RecognitionAvailability {
  const capturePosition = recommendCapturePosition(exerciseId)?.position ?? "front";
  return resolveRecognitionCapability(exerciseId, capturePosition).canRunRustRecognition
    ? "available"
    : "unavailable";
}

/** Android/iOS adapters use this lookup; product claims still go through the exact resolver. */
export const mobileExecutableProfileLookup: ExecutableProfileLookup = {
  resolve(input) {
    const recognition = resolveRecognitionCapability(input.exerciseVariantId, input.capturePosition, input.platform);
    return {
      canRecord: input.platform !== "web",
      canCount: recognition.canCount,
      canEmitPhase: recognition.canEmitPhase,
      // Native production surfaces emit one frozen Halpe-26 contract.
      // Fixture callers retain the historical heavy BlazePose contract.
      supportedPoseModels: recognition.canCount
        ? input.platform === "android" || input.platform === "ios"
          ? ["rtmpose-m-halpe26"] as const
          : ["heavy"] as const
        : [],
      ...(recognition.profileIdentity ? { profileIdentity: recognition.profileIdentity } : {}),
      reasonCodes: recognition.canCount ? [] : ["exact_executable_profile_missing"],
    };
  },
};

/** Current bundled data can count where executable, but carries no validation approval by default. */
export function resolveMotionRuntimeCapability(input: {
  exerciseVariantId: string;
  capturePosition: CapturePosition;
  lensFacing: LensFacing;
  platform: "android" | "ios" | "web" | "fixture";
  /** Defaults to the single production landmark stream used by the app. */
  poseModel?: MotionCapabilityInput["poseModel"];
}): MotionCapabilityDecision {
  return new ExactMotionCapabilityResolver(mobileExecutableProfileLookup).resolve({
    ...input,
    poseModel: input.poseModel ?? (
      input.platform === "android" || input.platform === "ios"
        ? "rtmpose-m-halpe26"
        : "heavy"
    ),
  });
}

function dataCapability(
  mode: "observed" | "simulated_initializer",
  profile: RustExerciseProfileData,
  equipmentVision: NativeEquipmentVision,
): RecognitionCapability {
  const installation = encodeRustExerciseProfileInstallation(profile);
  return {
    mode,
    canRunRustRecognition: true,
    canCount: true,
    canEmitPhase: true,
    profileIdentity: profile.identity,
    nativeProfileJson: JSON.stringify({
      schemaVersion: NATIVE_PROFILE_SCHEMA,
      mode: "data",
      source: mode,
      identity: installation.identity,
      abiArguments: installation.abiArguments,
      equipmentVision,
    }),
  };
}

/**
 * Barbell bench uses the selected user's shaft path as the primary causal
 * phase signal. The source artifact remains immutable; this derives a native
 * client profile with a new identity/hash for the shared Rust state graph.
 */
function activateClientPhaseEvidence(
  exerciseId: string,
  profile: RustExerciseProfileData,
): RustExerciseProfileData {
  if (exerciseId !== "barbell_bench_press") return profile;
  const withoutHash = {
    ...profile,
    identity: `${profile.identity}/barbell-axis-primary-client-v1`,
    stateMachineId: "barbell-axis-primary-ready-effort-return/v1" as const,
  };
  return {
    ...withoutHash,
    contentHash: computeRustExerciseProfileHash(withoutHash),
  };
}

function resolveNativeEquipmentVision(exerciseId: string): NativeEquipmentVision {
  const policy = resolveEquipmentRecognitionPolicy({ exerciseId });
  if (!policy.enabled) return "off";
  if (policy.kinds.includes("barbell_shaft")) return "barbell_axis";
  // The policy models future dumbbell evidence, but the native producer in
  // this release implements only the continuous barbell shaft track. Never
  // advertise a client mode that would silently emit no observations.
  return "off";
}

/**
 * Default lens remains a UX choice, independent of recognition availability.
 * Home exercises use the screen-facing camera; strength exercises default to
 * an observation setup with the back camera.
 */
const HOME_EXERCISES = new Set([
  "march_in_place",
  "side_step_touch",
  "alternating_knee_raise",
  "step_jack",
  "jumping_jack",
  "sit_up",
  "alternating_lunge",
]);

export function isHomeExercise(exerciseId: string): boolean {
  return HOME_EXERCISES.has(exerciseId);
}

export function defaultLensFacing(exerciseId: string): LensFacing {
  return isHomeExercise(exerciseId) ? "front" : "back";
}
