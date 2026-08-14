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

export interface ProfilePromotionActivation {
  readonly schemaVersion: "maxpower-profile-activation/v1";
  readonly decision: "activate" | "rollback";
  readonly manifestSha256: Sha256;
  readonly profileSha256: Sha256;
  readonly authorizedBy: string;
  readonly authorizedAt: string;
}

export interface BenchProfileSelection {
  readonly status: "stable" | "data_gated" | "promoted" | "rolled_back";
  readonly selectedProfile: ImmutableRecognitionProfileRef;
  readonly reasonCodes: readonly string[];
  readonly manifestRef?: ImmutableEvidenceRef;
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
): BenchProfileSelection | null {
  if (!installedRuntime || context.exerciseId !== "barbell_bench_press") return null;
  return selectBenchRecognitionProfile({
    context,
    stableProfile: installedRuntime.stableProfile,
    manifests: installedRuntime.manifests,
    evidenceStore: installedRuntime.evidenceStore,
    activation: installedRuntime.activation,
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
  return {
    status: "promoted",
    selectedProfile: candidate.manifest.candidateProfile,
    reasonCodes: [],
    manifestRef: candidate.ref,
  };
}
