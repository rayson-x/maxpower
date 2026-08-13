import type { CapturePosition } from "../pose/viewGating";

export type MotionRuntimePlatform = "android" | "ios" | "web" | "fixture";

export interface MotionCapabilityInput {
  exerciseVariantId: string;
  setup?: string;
  trainingSide?: "left" | "right" | "bilateral";
  capturePosition: CapturePosition;
  lensFacing: "front" | "back";
  poseModel: "lite" | "full" | "heavy" | "rtmpose-m-halpe26";
  platform: MotionRuntimePlatform;
  profileEnvelope?: { schemaVersion: string; identity?: string; hash?: string; abiVersion?: string };
}

export interface ValidatedAnalysisRecord {
  exerciseVariantId: string;
  /** Exact equipment/setup identity; an approval never transfers to a substitute. */
  setup: string;
  trainingSide: NonNullable<MotionCapabilityInput["trainingSide"]>;
  capturePosition: CapturePosition;
  lensFacing: MotionCapabilityInput["lensFacing"];
  profileIdentity: string;
  profileHash: string;
  approvalId: string;
  status: "approved" | "suspended";
}

export interface MotionCapabilityDecision {
  localRecording: "available" | "unavailable";
  repCounting: "available" | "unavailable";
  phaseTempo: "available" | "unavailable";
  trajectoryComparison: "available" | "unavailable";
  evidenceLinkedTechniqueCue: "available" | "unavailable";
  fallback: "manual_recording" | "video_only" | "count_tempo_only";
  reasonCodes: readonly string[];
  evidenceRefs: readonly string[];
  profileIdentity?: string;
  /** This is a runtime decision, never a catalog maturity proxy. */
  validationStatus: "validated_analysis" | "not_validated" | "suspended";
}

export interface MotionCapabilityResolver {
  resolve(input: MotionCapabilityInput): MotionCapabilityDecision;
}

export interface ExecutableProfileLookup {
  resolve(input: MotionCapabilityInput): {
    canRecord: boolean;
    canCount: boolean;
    canEmitPhase: boolean;
    /**
     * An executable profile is bound to the pose-model contract used to
     * create its canonical landmarks. Omitted only for legacy/fixture lookup
     * implementations that intentionally make no model claim.
     */
    supportedPoseModels?: readonly MotionCapabilityInput["poseModel"][];
    profileIdentity?: string;
    profileHash?: string;
    schemaVersion?: string;
    abiVersion?: string;
    reasonCodes?: readonly string[];
  };
}

/**
 * Runtime capability is exact-context based. It can run a Rust counter while
 * still refusing comparison/cue claims until an independently approved record
 * is injected for the very same action × setup × view/profile.
 */
export class ExactMotionCapabilityResolver implements MotionCapabilityResolver {
  constructor(
    private readonly profiles: ExecutableProfileLookup,
    private readonly validations: readonly ValidatedAnalysisRecord[] = [],
  ) {}

  resolve(input: MotionCapabilityInput): MotionCapabilityDecision {
    const profile = this.profiles.resolve(input);
    const runtime = canonicalMotionRuntimeContract(input.platform);
    if (!runtime.canEmitCanonicalPackets) {
      return {
        localRecording: profile.canRecord ? "available" : "unavailable",
        repCounting: "unavailable",
        phaseTempo: "unavailable",
        trajectoryComparison: "unavailable",
        evidenceLinkedTechniqueCue: "unavailable",
        fallback: profile.canRecord ? "video_only" : "manual_recording",
        reasonCodes: [runtime.reasonCode, ...(profile.reasonCodes ?? [])],
        evidenceRefs: [],
        validationStatus: "not_validated",
      };
    }
    const envelopeMismatch = profileEnvelopeMismatch(input.profileEnvelope, profile);
    const poseModelUnsupported = profile.supportedPoseModels !== undefined
      && !profile.supportedPoseModels.includes(input.poseModel);
    if (!profile.canCount || !profile.profileIdentity || poseModelUnsupported || envelopeMismatch.length) {
      return {
        localRecording: profile.canRecord ? "available" : "unavailable",
        repCounting: "unavailable",
        phaseTempo: "unavailable",
        trajectoryComparison: "unavailable",
        evidenceLinkedTechniqueCue: "unavailable",
        fallback: profile.canRecord ? "video_only" : "manual_recording",
        reasonCodes: [
          ...(!profile.canCount || !profile.profileIdentity ? ["exact_executable_profile_missing"] : []),
          ...(poseModelUnsupported ? ["pose_model_unsupported"] : []),
          ...envelopeMismatch,
          ...(profile.reasonCodes ?? []),
        ],
        evidenceRefs: [],
        validationStatus: "not_validated",
      };
    }
    const validation = this.validations.find(
      (candidate) =>
        candidate.exerciseVariantId === input.exerciseVariantId &&
        candidate.setup === input.setup &&
        candidate.trainingSide === input.trainingSide &&
        candidate.capturePosition === input.capturePosition &&
        candidate.lensFacing === input.lensFacing &&
        candidate.profileIdentity === profile.profileIdentity &&
        (!input.profileEnvelope?.hash || candidate.profileHash === input.profileEnvelope.hash) &&
        (!profile.profileHash || candidate.profileHash === profile.profileHash),
    );
    const approved = validation?.status === "approved";
    const suspended = validation?.status === "suspended";
    return {
      localRecording: profile.canRecord ? "available" : "unavailable",
      repCounting: "available",
      phaseTempo: profile.canEmitPhase ? "available" : "unavailable",
      trajectoryComparison: approved ? "available" : "unavailable",
      evidenceLinkedTechniqueCue: approved ? "available" : "unavailable",
      fallback: approved ? "count_tempo_only" : "count_tempo_only",
      reasonCodes: [
        ...(suspended ? ["validated_analysis_suspended"] : []),
        ...(!validation ? ["validated_analysis_record_missing"] : []),
        ...(validation && !approved && !suspended ? ["validated_analysis_not_approved"] : []),
      ],
      evidenceRefs: validation ? [`motion_validation:${validation.approvalId}`] : [],
      profileIdentity: profile.profileIdentity,
      validationStatus: suspended ? "suspended" : approved ? "validated_analysis" : "not_validated",
    };
  }
}

/**
 * Runtime readiness is independent from catalog/profile maturity. Android and
 * iOS use native Rust bridges, Web uses the same Rust contract through WASM,
 * and fixtures retain a deterministic test implementation. None of these
 * runtimes enables comparison or technique cues without exact-context approval.
 */
export function canonicalMotionRuntimeContract(platform: MotionRuntimePlatform): {
  readonly canEmitCanonicalPackets: boolean;
  readonly reasonCode: string;
} {
  switch (platform) {
    case "android":
      return { canEmitCanonicalPackets: true, reasonCode: "android_canonical_packet_bridge_ready" };
    case "fixture":
      return { canEmitCanonicalPackets: true, reasonCode: "fixture_canonical_packet_bridge_ready" };
    case "ios":
      return { canEmitCanonicalPackets: true, reasonCode: "ios_canonical_packet_bridge_ready" };
    case "web":
      return { canEmitCanonicalPackets: true, reasonCode: "web_wasm_canonical_packet_runtime_ready" };
  }
}

/** @deprecated Use canonicalMotionRuntimeContract; kept as a source-compatible alias. */
export const nativeMotionBridgeContract = canonicalMotionRuntimeContract;

/**
 * A native bridge must not treat a profile name as sufficient identity. The
 * lookup is its local executable contract; the supplied envelope is the
 * immutable contract accompanying this observation segment. Any disagreement
 * downgrades to local video rather than accepting a possibly stale profile.
 */
function profileEnvelopeMismatch(
  envelope: MotionCapabilityInput["profileEnvelope"],
  profile: ReturnType<ExecutableProfileLookup["resolve"]>,
): readonly string[] {
  if (!envelope) return [];
  const reasons: string[] = [];
  if (!envelope.identity || envelope.identity !== profile.profileIdentity) {
    reasons.push("profile_envelope_identity_mismatch");
  }
  if (!envelope.hash || envelope.hash !== profile.profileHash) {
    reasons.push("profile_envelope_hash_mismatch");
  }
  if (!profile.schemaVersion || envelope.schemaVersion !== profile.schemaVersion) {
    reasons.push("profile_envelope_schema_mismatch");
  }
  if (!envelope.abiVersion || !profile.abiVersion || envelope.abiVersion !== profile.abiVersion) {
    reasons.push("profile_envelope_abi_mismatch");
  }
  return reasons;
}

function unavailable(reason: string): MotionCapabilityDecision {
  return {
    localRecording: "unavailable",
    repCounting: "unavailable",
    phaseTempo: "unavailable",
    trajectoryComparison: "unavailable",
    evidenceLinkedTechniqueCue: "unavailable",
    fallback: "manual_recording",
    reasonCodes: [reason],
    evidenceRefs: [],
    validationStatus: "not_validated",
  };
}
