import {
  evaluateBenchProfilePromotion,
  type BenchProfilePromotionManifest,
  type BenchPromotionEvidenceStore,
  type ImmutableEvidenceRef,
  type ImmutableRecognitionProfileRef,
  type Sha256,
} from "./benchProfilePromotion";

export interface BenchProfileSelectionContext {
  readonly exerciseId: string;
  readonly variation: string;
  readonly equipment: string;
  readonly trainingSide: "bilateral" | "left" | "right";
  readonly capturePosition: string;
}

interface ProfilePromotionActivationBase {
  readonly decision: "activate" | "rollback";
  readonly manifestSha256: Sha256;
  readonly profileSha256: Sha256;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
}

export interface ExecutableRustProfileRef {
  /** Exact built-in code passed to `motion_sdk_set_profile`. */
  readonly profileCode: number;
  /** Rust-owned `ExerciseProfile::content_hash`, exposed by the shipped ABI. */
  readonly contentHash: `fnv1a64:${string}`;
}

/** Opaque evidence read from the currently loaded Rust binary, never rebuilt in a client. */
export interface RuntimeBuiltInProfileAttestation extends ExecutableRustProfileRef {
  readonly source: "rust_abi";
}

export type ProfilePromotionActivation =
  | (ProfilePromotionActivationBase & {
    readonly schemaVersion: "maxpower-profile-activation/v1";
  })
  | (ProfilePromotionActivationBase & {
    readonly schemaVersion: "maxpower-profile-activation/v2";
    /** Executable Rust profiles reviewed by this immutable activation. */
    readonly executableProfiles: readonly ExecutableRustProfileRef[];
  });

export interface BenchProfileSelection {
  readonly status: "stable" | "data_gated" | "promoted" | "rolled_back";
  readonly selectedProfile: ImmutableRecognitionProfileRef;
  readonly reasonCodes: readonly string[];
  readonly manifestRef?: ImmutableEvidenceRef;
  /** Expected executable binding sealed into the manual activation. */
  readonly executableProfile?: ExecutableRustProfileRef;
}

export interface BenchProfilePromotionRuntime {
  readonly stableProfile: ImmutableRecognitionProfileRef;
  readonly manifests: readonly {
    readonly ref: ImmutableEvidenceRef;
    readonly manifest: BenchProfilePromotionManifest;
  }[];
  readonly evidenceStore: BenchPromotionEvidenceStore;
  readonly activation?: ProfilePromotionActivation;
}

let installedRuntime: BenchProfilePromotionRuntime | null = null;

/**
 * Installs the immutable release decision consumed by every client resolver.
 * `null` is the production-safe default: the normalized candidate remains
 * shadow-only and existing stable profile lookup continues unchanged.
 */
export function installBenchProfilePromotionRuntime(
  runtime: BenchProfilePromotionRuntime | null,
): void {
  installedRuntime = runtime;
}

export function resolveInstalledBenchProfileSelection(
  context: BenchProfileSelectionContext,
  executableProfileCode: number | null,
  runtimeAttestation: RuntimeBuiltInProfileAttestation | null = null,
  deferRuntimeAttestationToNative = false,
): BenchProfileSelection | null {
  if (!installedRuntime || context.exerciseId !== "barbell_bench_press") return null;
  return selectBenchRecognitionProfile({
    context,
    stableProfile: installedRuntime.stableProfile,
    manifests: installedRuntime.manifests,
    evidenceStore: installedRuntime.evidenceStore,
    activation: installedRuntime.activation,
    executableProfileCode,
    runtimeAttestation,
    deferRuntimeAttestationToNative,
  });
}

export function selectBenchRecognitionProfile(input: {
  readonly context: BenchProfileSelectionContext;
  readonly stableProfile: ImmutableRecognitionProfileRef;
  readonly manifests: readonly {
    readonly ref: ImmutableEvidenceRef;
    readonly manifest: BenchProfilePromotionManifest;
  }[];
  readonly evidenceStore: BenchPromotionEvidenceStore;
  readonly activation?: ProfilePromotionActivation;
  /** Omitted only by the pure evidence selector; production passes a code or null. */
  readonly executableProfileCode?: number | null;
  /** Read from the current Rust ABI. Web must provide this before promotion. */
  readonly runtimeAttestation?: RuntimeBuiltInProfileAttestation | null;
  /** Android/iOS perform the same check inside the native bridge before set_profile. */
  readonly deferRuntimeAttestationToNative?: boolean;
}): BenchProfileSelection {
  const matching = input.manifests.filter(({ manifest }) =>
    manifest.actionContext.exerciseId === input.context.exerciseId
    && manifest.actionContext.variation === input.context.variation
    && manifest.actionContext.equipment === input.context.equipment
    && manifest.actionContext.trainingSide === input.context.trainingSide
    && manifest.actionContext.capturePositions.includes(input.context.capturePosition as never)
  );
  const candidate = input.activation
    ? matching.find(({ ref }) => ref.sha256 === input.activation?.manifestSha256)
    : matching[0];
  if (!candidate) {
    if (input.activation && matching.length > 0) {
      return {
        status: "data_gated",
        selectedProfile: input.stableProfile,
        reasonCodes: ["promotion_activation_mismatch"],
      };
    }
    return { status: "stable", selectedProfile: input.stableProfile, reasonCodes: ["promotion_manifest_missing"] };
  }
  if (candidate.ref.sha256 !== candidate.manifest.sha256) {
    return {
      status: "data_gated",
      selectedProfile: input.stableProfile,
      reasonCodes: ["promotion_manifest_hash_mismatch"],
      manifestRef: candidate.ref,
    };
  }
  if (candidate.manifest.stableProfile.sha256 !== input.stableProfile.sha256) {
    return {
      status: "data_gated",
      selectedProfile: input.stableProfile,
      reasonCodes: ["promotion_stable_profile_mismatch"],
      manifestRef: candidate.ref,
    };
  }

  if (input.activation?.decision === "rollback") {
    const rollbackMatches = input.activation.manifestSha256 === candidate.ref.sha256
      && input.activation.profileSha256 === input.stableProfile.sha256;
    return rollbackMatches
      ? {
        status: "rolled_back",
        selectedProfile: input.stableProfile,
        reasonCodes: ["explicit_profile_rollback"],
        manifestRef: candidate.ref,
      }
      : {
        status: "data_gated",
        selectedProfile: input.stableProfile,
        reasonCodes: ["promotion_activation_mismatch"],
        manifestRef: candidate.ref,
      };
  }

  const evaluation = evaluateBenchProfilePromotion(candidate.manifest, input.evidenceStore);
  if (evaluation.status !== "eligible_for_manual_promotion") {
    return {
      status: "data_gated",
      selectedProfile: input.stableProfile,
      reasonCodes: evaluation.blockerCodes,
      manifestRef: candidate.ref,
    };
  }

  const activationMatches = input.activation?.decision === "activate"
    && input.activation.manifestSha256 === candidate.ref.sha256
    && input.activation.profileSha256 === candidate.manifest.candidateProfile.sha256;
  if (input.activation && !activationMatches) {
    return {
      status: "data_gated",
      selectedProfile: input.stableProfile,
      reasonCodes: ["promotion_activation_mismatch"],
      manifestRef: candidate.ref,
    };
  }
  if (!input.activation) {
    return {
      status: "stable",
      selectedProfile: input.stableProfile,
      reasonCodes: ["manual_promotion_activation_required"],
      manifestRef: candidate.ref,
    };
  }
  if (input.executableProfileCode !== undefined) {
    const executableBinding = validateExecutableProfileBinding(
      input.activation,
      input.executableProfileCode,
      input.runtimeAttestation ?? null,
      input.deferRuntimeAttestationToNative === true,
    );
    if (typeof executableBinding === "string") {
      return {
        status: "data_gated",
        selectedProfile: input.stableProfile,
        reasonCodes: [executableBinding],
        manifestRef: candidate.ref,
      };
    }
    return {
      status: "promoted",
      selectedProfile: candidate.manifest.candidateProfile,
      reasonCodes: [],
      manifestRef: candidate.ref,
      executableProfile: executableBinding,
    };
  }
  return {
    status: "promoted",
    selectedProfile: candidate.manifest.candidateProfile,
    reasonCodes: [],
    manifestRef: candidate.ref,
  };
}

function validateExecutableProfileBinding(
  activation: ProfilePromotionActivation,
  profileCode: number | null,
  runtimeAttestation: RuntimeBuiltInProfileAttestation | null,
  deferRuntimeAttestationToNative: boolean,
): ExecutableRustProfileRef | string {
  if (profileCode === null) return "promotion_executable_profile_code_missing";
  if (activation.schemaVersion !== "maxpower-profile-activation/v2") {
    return "promotion_executable_profile_activation_metadata_missing";
  }
  const activated = activation.executableProfiles.find((entry) => entry.profileCode === profileCode);
  if (!activated) return "promotion_executable_profile_activation_metadata_missing";
  if (!/^fnv1a64:[0-9a-f]{16}$/u.test(activated.contentHash)) {
    return "promotion_executable_profile_activation_metadata_invalid";
  }
  if (deferRuntimeAttestationToNative) return activated;
  if (!runtimeAttestation || runtimeAttestation.profileCode !== profileCode) {
    return "promotion_executable_profile_runtime_attestation_missing";
  }
  if (activated.contentHash !== runtimeAttestation.contentHash) {
    return "promotion_executable_profile_content_hash_mismatch";
  }
  return activated;
}
