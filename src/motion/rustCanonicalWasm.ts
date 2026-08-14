import {
  CANONICAL_POSE_CONTRACT_VERSION,
  RUST_CANONICAL_ALGORITHM_VERSION,
  type CanonicalLandmark,
  type CanonicalPoseFrame,
  type PoseContinuitySession,
  type PoseContinuitySessionConfig,
} from "../pose/canonicalPose";
import type { PoseCandidateEstimate, PoseEstimate, PoseLandmark } from "../pose/PoseEngine";
import type { PersonalProvisionalReferenceProfile } from "../pose/referenceTrajectory";
import {
  decodeMotionPacket,
  type DecodedMotionLandmark,
  type DecodedMotionPacket,
  type DecodedRustQualityProposal,
} from "./motionPacket";
import type {
  ExecutableRustProfileRef,
  RuntimeBuiltInProfileAttestation,
} from "./benchProfileSelector";

export type RustTargetState = "acquiring" | "locked" | "uncertain" | "lost" | "reacquiring";
export interface RustTargetSnapshot {
  state: RustTargetState;
  candidateCount: number;
  selectedCandidateId: bigint | null;
  subjectEpoch: bigint;
}
export interface RustCandidateDiagnostic {
  candidateId: number;
  bbox: { x: number; y: number; width: number; height: number };
  dominanceScore: number;
  continuityCost: number | null;
  continuityComponents: {
    landmarks: number | null;
    center: number | null;
    color: number | null;
  };
  switchThreshold: number;
  switchConfirmMs: number;
  decision: "selected" | "dominant-candidate" | "temporal-match" | "alternate-candidate";
  selected: boolean;
}
export type RustEquipmentObservationKind =
  | "weight_plate"
  | "barbell_shaft"
  | "dumbbell"
  | "machine_handle";
export type RustEquipmentObservationSource = "detector" | "optical_flow" | "geometry" | "predicted";
export interface RustEquipmentObservation {
  /** Frame-local detector/tracker id. Rust assigns the stable track id. */
  proposalId: number;
  kind: RustEquipmentObservationKind;
  bbox: { x: number; y: number; width: number; height: number };
  axis?: { x1: number; y1: number; x2: number; y2: number };
  score: number;
  uncertaintyPx: number | null;
  source: RustEquipmentObservationSource;
  reflectionCandidate?: boolean;
  staticRackCandidate?: boolean;
  occlusion?: "none" | "partial" | "heavy";
  truncated?: boolean;
}
export interface RustVisualEquipmentLumaFrame {
  readonly width: number;
  readonly height: number;
  readonly luma: Uint8Array;
}
export interface RustVisualBarbellAxis {
  readonly source: "measured" | "fused" | "predicted";
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly centerY: number;
  readonly confidence: number;
  readonly uncertaintyPx: number;
}

const RUST_CANDIDATE_FIELD = Object.freeze({
  id: 0,
  bboxX: 1,
  bboxY: 2,
  bboxWidth: 3,
  bboxHeight: 4,
  dominanceScore: 5,
  continuityCost: 6,
  selected: 7,
  continuityLandmarks: 8,
  continuityCenter: 9,
  continuityColor: 10,
  switchThreshold: 12,
  switchConfirmMs: 13,
});
const RUST_EQUIPMENT_KIND_CODE: Readonly<Record<RustEquipmentObservationKind, number>> =
  Object.freeze({ weight_plate: 0, barbell_shaft: 1, dumbbell: 2, machine_handle: 3 });
const RUST_EQUIPMENT_SOURCE_CODE: Readonly<Record<RustEquipmentObservationSource, number>> =
  Object.freeze({ detector: 0, optical_flow: 1, geometry: 2, predicted: 3 });
export type RustExerciseProfile =
  | "lat_pulldown"
  | "lat_pulldown_rear_left_45"
  | "seated_shoulder_press"
  | "seated_shoulder_press_front"
  | "march_in_place"
  | "side_step_touch"
  | "alternating_knee_raise"
  | "step_jack"
  | "barbell_bench_press_local_front"
  | "barbell_bench_press_local_front_left"
  | "barbell_bench_press_local_front_right"
  | "seated_barbell_shoulder_press_local_front"
  | "seated_barbell_shoulder_press_local_front_left"
  | "seated_barbell_shoulder_press_local_front_right"
  | "dumbbell_shoulder_press_front"
  | null;
export interface RustRepState {
  phase: "ready" | "effort" | "peak" | "return" | "frozen";
  partialAttempts: bigint;
  activeRepId: bigint | null;
  recoveredAcrossGap: boolean;
}
export type RustSetLifecycle = "idle" | "arming" | "active" | "paused" | "finished";
export interface RustSealedRep {
  repId: bigint;
  startFrameId: bigint;
  startTimestampMs: bigint;
  peakFrameId: bigint;
  peakTimestampMs: bigint;
  endFrameId: bigint;
  endTimestampMs: bigint;
  canonicalSliceHash: bigint;
  profileHash: bigint;
  revision: number;
  profileMaturity: "provisional" | "calibrated";
  profileIdentity: string;
  qualityVerdict: string | null;
  recoveredAcrossGap: boolean;
  disposition: "confirmed" | "needs_review" | "rejected";
  evidenceReason:
    | "short_continuity_recovery"
    | "long_continuity_loss"
    | "subject_changed"
    | "incomplete_cycle"
    | "anti_interference_filter"
    | "duration_exceeded"
    | "required_joint_loss"
    | "coordinate_provisional"
    | "local_trajectory_channel_conflict"
    | null;
  observationFindings: readonly (
    | "primary_range_below_expectation"
    | "secondary_range_below_expectation"
    | "cycle_faster_than_expected"
    | "equipment_primary_boundary"
    | "pose_equipment_turnaround_aligned"
    | "pose_unavailable_at_turnaround"
    | "pose_equipment_turnaround_conflict"
    | "equipment_path_coverage_low"
  )[];
}
export interface RustExerciseProfileData {
  identity: string;
  contentHash: bigint;
  maturity: "provisional";
  schema: "blazepose33" | "halpe26";
  coordinateUnit:
    | "image-normalized-y"
    | "image-angle-deg"
    | "torso-normalized-distance"
    | "derived-kinematic-signal"
    | "set-normalized-local-motion";
  stateMachineId:
    | "ready-effort-peak-return/v1"
    | "cycle-aligned-ready-effort-peak-return/v1"
    | "median-100ms-ready-effort-peak-return/v1"
    | "median-200ms-ready-effort-peak-return/v1"
    | "median-300ms-ready-effort-peak-return/v1"
    | "median-400ms-ready-effort-peak-return/v1"
    | "median-600ms-ready-effort-peak-return/v1"
    | "cycle-aligned-median-100ms-ready-effort-peak-return/v1"
    | "cycle-aligned-median-200ms-ready-effort-peak-return/v1"
    | "cycle-aligned-median-300ms-ready-effort-peak-return/v1"
    | "cycle-aligned-median-400ms-ready-effort-peak-return/v1"
    | "cycle-aligned-median-600ms-ready-effort-peak-return/v1"
    | "stable-cycle-200ms-ready-effort-peak-return/v1"
    | "barbell-axis-primary-ready-effort-return/v1"
    | "local-barbell-bench-ready-effort-return/v1"
    | "local-barbell-shoulder-press-ready-effort-return/v1"
    | "alternating-ready-effort-return/v1";
  requiredCapabilities: readonly ["canonical-landmarks", "subject-lock"];
  direction: "increasing" | "decreasing" | "auto";
  primarySignal: RustExerciseSignal;
  secondarySignal: RustExerciseSignal;
  startAmplitude: number;
  minPrimaryAmplitude: number;
  minSecondaryAmplitude: number;
  returnHysteresis: number;
  readyTolerance: number;
  maxGapMs: number;
  minRepDurationMs: number;
  maxRepDurationMs: number;
}
export interface RustExerciseSignal {
  kind:
    | "landmark-y"
    | "joint-angle"
    | "landmark-distance"
    | "landmark-horizontal-distance"
    | "landmark-vertical-distance"
    | "local-along-axis-progress"
    | "local-cross-axis-displacement"
    | "local-endpoint-relative-progress"
    | "local-dynamic-bar-angle"
    | "local-channel-agreement"
    | "local-observability";
  /** Local-coordinate signals use an empty list; legacy tuples may contain omitted slots. */
  landmarks: readonly (number | undefined)[];
}

/** Scalar form shared by WASM and native adapters when installing a data profile. */
export interface RustExerciseProfileInstallation {
  identity: string;
  /** Exact argument order after identity in `motion_sdk_install_profile`. */
  abiArguments: readonly [
    number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number,
    number, number, number, number, number, number, number, number,
  ];
}

export const RUST_EXERCISE_PROFILE_CODES: Readonly<Record<Exclude<RustExerciseProfile, null>, number>> =
  Object.freeze({
    lat_pulldown: 1,
    seated_shoulder_press: 2,
    lat_pulldown_rear_left_45: 3,
    seated_shoulder_press_front: 4,
    march_in_place: 5,
    side_step_touch: 6,
    alternating_knee_raise: 7,
    step_jack: 8,
    barbell_bench_press_local_front: 9,
    barbell_bench_press_local_front_left: 10,
    barbell_bench_press_local_front_right: 11,
    seated_barbell_shoulder_press_local_front: 12,
    seated_barbell_shoulder_press_local_front_left: 13,
    seated_barbell_shoulder_press_local_front_right: 14,
    dumbbell_shoulder_press_front: 15,
  });
export interface RustReferenceComparisonUnavailable {
  readonly status: "unavailable";
  readonly reason:
    | "no-installed-reviewed-profile"
    | "awaiting-sealed-rep"
    | "reference-extraction-refused";
  readonly profileIdentity: string | null;
  readonly qualityVerdict: null;
}
export interface RustReferenceFeatureEvidence {
  readonly feature: string;
  readonly comparableNodeCount: number;
  readonly unknownNodeCount: number;
  readonly outsideNodeCount: number;
  readonly outsideNodeRatio: number | null;
  readonly maximumConsecutiveOutsideNodes: number;
  readonly totalNormalizedExcess: number;
}
export interface RustReferenceComparisonEvidence {
  readonly status:
    | "comparison_available"
    | "insufficient_observation"
    | "profile_mismatch"
    | "invalid_profile";
  readonly reason: string | null;
  readonly profileIdentity: string;
  readonly profileHash: bigint;
  readonly repId: bigint;
  readonly repRevision: number;
  readonly canonicalSliceHash: bigint;
  readonly features: readonly RustReferenceFeatureEvidence[];
  readonly qualityVerdict: null;
}
export type RustReferenceComparison =
  | RustReferenceComparisonUnavailable
  | RustReferenceComparisonEvidence;
export type RustReferenceRuntimeContext =
  PersonalProvisionalReferenceProfile["identity"];
export interface RustTrajectoryIdentity {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly variation: string;
  readonly trainingSide: string;
  readonly equipment: string;
  readonly coordinateSystem: string;
  readonly featureSchemaId: string;
  readonly poseModelVersion: string;
}
export interface RustReferenceProfileInstallation {
  readonly profile: PersonalProvisionalReferenceProfile;
}
export interface RustSimulatedTrajectoryBaselineInstallation {
  readonly baseline: Readonly<{
    schemaVersion: "maxpower-simulated-trajectory-baseline/v1";
    source: "simulated_kinematic_prior";
    evidenceStatus: "uncalibrated";
    calibrationStatus: "uncalibrated";
    identity: RustTrajectoryIdentity;
    profileBinding: Readonly<{
      exerciseProfileIdentity: string;
      exerciseProfileHash: string;
    }>;
    featureNames: readonly ["primarySignalPhase", "secondarySignalPhase"];
    corridor: Readonly<{
      nodes: readonly Readonly<{
        phase: "to_extreme" | "from_extreme";
        phasePercent: number;
        features: readonly Readonly<{
          qLow: number;
          qHigh: number;
          medianAbsoluteDeviation: null;
          nObserved: number;
        }>[];
      }>[];
    }>;
    matchingPolicy: Readonly<{
      minimumObservationConfidence: number;
      unrestrictedDtwAllowed: false;
    }>;
  }>;
}
export interface RustWasmTiming {
  readonly coreMs: number;
  readonly decodeMs: number;
}

export interface MotionWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  motion_sdk_begin_sequence(length: number): number;
  motion_sdk_set_sequence_byte(index: number, value: number): number;
  motion_sdk_commit_sequence(): number;
  motion_sdk_close(): number;
  motion_sdk_reset(width: number, height: number, fusion: number): number;
  motion_sdk_set_pose_schema(schema: number): number;
  motion_sdk_set_canonical_feed_mirroring(mirrored: number): number;
  motion_sdk_begin_set(): number;
  motion_sdk_begin_replay_set(): number;
  motion_sdk_finish_set(): number;
  motion_sdk_pause_set(): number;
  motion_sdk_resume_set(): number;
  motion_sdk_begin_frame(timestampLow: number, timestampHigh: number, count: number): number;
  motion_sdk_set_landmark(
    index: number,
    x: number,
    y: number,
    z: number,
    visibility: number,
  ): number;
  motion_sdk_process_frame(): number;
  motion_sdk_current_frame_valid(): number;
  motion_sdk_begin_multi(timestampLow: number, timestampHigh: number): number;
  motion_sdk_begin_candidate(
    idLow: number,
    idHigh: number,
    x: number,
    y: number,
    width: number,
    height: number,
    red: number,
    green: number,
    blue: number,
    count: number,
  ): number;
  motion_sdk_commit_candidate(): number;
  motion_sdk_add_equipment_observation(
    idLow: number,
    idHigh: number,
    kind: number,
    x: number,
    y: number,
    width: number,
    height: number,
    score: number,
    uncertaintyPx: number,
    source: number,
    flags: number,
  ): number;
  motion_sdk_add_equipment_axis_observation(
    idLow: number,
    idHigh: number,
    kind: number,
    x: number,
    y: number,
    width: number,
    height: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    score: number,
    uncertaintyPx: number,
    source: number,
    flags: number,
  ): number;
  motion_sdk_begin_visual_equipment_frame(width: number, height: number, length: number): number;
  motion_sdk_visual_equipment_luma_ptr(): number;
  motion_sdk_detect_barbell_axis(): number;
  motion_sdk_visual_barbell_axis_source(): number;
  motion_sdk_visual_barbell_axis_number(field: number): number;
  motion_sdk_process_multi(): number;
  motion_sdk_target_field(field: number): number;
  motion_sdk_candidate_count(): number;
  motion_sdk_candidate_number(index: number, field: number): number;
  motion_sdk_select_subject(x: number, y: number): number;
  motion_sdk_schedule(timestampLow: number, timestampHigh: number, inFlight: number): number;
  motion_sdk_set_degradation(level: number): number;
  motion_sdk_set_profile(profileCode: number): number;
  motion_sdk_builtin_profile_hash_low(profileCode: number): number;
  motion_sdk_builtin_profile_hash_high(profileCode: number): number;
  motion_sdk_begin_profile_identity(length: number): number;
  motion_sdk_set_profile_identity_byte(index: number, value: number): number;
  motion_sdk_install_profile(
    hashLow: number,
    hashHigh: number,
    maturity: number,
    schema: number,
    coordinateUnit: number,
    stateMachine: number,
    requiredCapabilities: number,
    direction: number,
    primaryKind: number,
    primary0: number,
    primary1: number,
    primary2: number,
    secondaryKind: number,
    secondary0: number,
    secondary1: number,
    secondary2: number,
    startAmplitude: number,
    minPrimaryAmplitude: number,
    minSecondaryAmplitude: number,
    returnHysteresis: number,
    readyTolerance: number,
    maxGapMs: number,
    minRepDurationMs: number,
    maxRepDurationMs: number,
  ): number;
  motion_sdk_begin_reference_profile(length: number): number;
  motion_sdk_set_reference_profile_byte(index: number, value: number): number;
  motion_sdk_commit_reference_profile(): number;
  motion_sdk_begin_reference_context(length: number): number;
  motion_sdk_set_reference_context_byte(index: number, value: number): number;
  motion_sdk_commit_reference_context(): number;
  motion_sdk_reference_status(): number;
  motion_sdk_reference_field(field: number, high: number): number;
  motion_sdk_reference_feature_count(): number;
  motion_sdk_reference_feature_number(index: number, field: number): number;
  motion_sdk_begin_simulated_baseline(length: number): number;
  motion_sdk_set_simulated_baseline_byte(index: number, value: number): number;
  motion_sdk_commit_simulated_baseline(): number;
  motion_sdk_simulated_baseline_status(): number;
  motion_sdk_simulated_baseline_field(field: number, high: number): number;
  motion_sdk_simulated_baseline_feature_count(): number;
  motion_sdk_simulated_baseline_feature_number(index: number, field: number): number;
  motion_sdk_rep_state_field(field: number): number;
  motion_sdk_completed_rep_count(): number;
  motion_sdk_completed_rep_field(index: number, field: number): number;
  motion_sdk_completed_rep_field_high(index: number, field: number): number;
  motion_sdk_output_len(): number;
  motion_sdk_output_number(index: number, field: number): number;
  motion_sdk_output_flags(index: number): number;
  motion_sdk_output_hash(high: number): number;
  motion_sdk_packet_len(): number;
  motion_sdk_packet_ptr(): number;
}

let wasmPromise: Promise<MotionWasmExports> | null = null;

export function loadRustMotionWasm(
  url = "/motion-sdk/maxpower_motion_sdk.wasm",
): Promise<MotionWasmExports> {
  wasmPromise ??= fetch(url)
    .then(async (response) => {
      if (!response.ok) throw new Error(`Rust motion SDK load failed: ${response.status}`);
      const bytes = await response.arrayBuffer();
      return instantiateRustMotionWasm(bytes);
    });
  return wasmPromise;
}

export async function instantiateRustMotionWasm(
  bytes: BufferSource,
): Promise<MotionWasmExports> {
  const result = await WebAssembly.instantiate(bytes, {});
  return result.instance.exports as MotionWasmExports;
}

export interface RustCanonicalWasmSessionConfig extends PoseContinuitySessionConfig {
  /** Camera preview is idle until the user records; fixture/replay callers are active. */
  setLifecycleMode?: "preview" | "replay";
  /** Mirroring applied to canonical coordinates themselves; preview CSS/video mirroring is separate. */
  canonicalFeedMirrored?: boolean;
}

export class RustCanonicalWasmSession implements PoseContinuitySession {
  private nextFrameId = 0;
  lastTarget: RustTargetSnapshot = {
    state: "acquiring",
    candidateCount: 0,
    selectedCandidateId: null,
    subjectEpoch: 0n,
  };
  lastRepState: RustRepState = {
    phase: "ready",
    partialAttempts: 0n,
    activeRepId: null,
    recoveredAcrossGap: false,
  };
  lastSetLifecycle: RustSetLifecycle = "idle";
  lastCompletedReps: readonly RustSealedRep[] = [];
  /** Immutable Rust QLT1 proposals; clients render/export but never recompute. */
  lastQualityProposals: readonly Readonly<DecodedRustQualityProposal>[] = [];
  lastCanonicalHash = 0n;
  lastFrameValid = false;
  lastDecodedPacket: DecodedMotionPacket | null = null;
  lastCandidateDiagnostics: readonly RustCandidateDiagnostic[] = [];
  lastVisualBarbellAxis: RustVisualBarbellAxis | null = null;
  lastTiming: RustWasmTiming = Object.freeze({ coreMs: 0, decodeMs: 0 });
  referenceComparison: RustReferenceComparison = Object.freeze({
    status: "unavailable",
    reason: "no-installed-reviewed-profile",
    profileIdentity: null,
    qualityVerdict: null,
  });
  simulatedBaselineComparison: RustReferenceComparison = Object.freeze({
    status: "unavailable",
    reason: "no-installed-reviewed-profile",
    profileIdentity: null,
    qualityVerdict: null,
  });
  private installedReferenceIdentity: string | null = null;
  private installedReferenceFeatureNames: readonly string[] = [];
  private installedSimulatedBaselineIdentity: string | null = null;
  private installedSimulatedBaselineFeatureNames: readonly string[] = [];

  constructor(
    private readonly config: RustCanonicalWasmSessionConfig,
    private readonly wasm: MotionWasmExports,
  ) {
    const sequence = new TextEncoder().encode(config.sequenceId);
    ensureOk(wasm.motion_sdk_begin_sequence(sequence.length), "begin_sequence");
    sequence.forEach((value, index) => {
      ensureOk(wasm.motion_sdk_set_sequence_byte(index, value), `sequence_byte_${index}`);
    });
    ensureOk(wasm.motion_sdk_commit_sequence(), "commit_sequence");
    ensureOk(
      wasm.motion_sdk_reset(
        config.image.widthPx,
        config.image.heightPx,
        config.stabilization === "raw" ? 0 : 1,
      ),
      "reset",
    );
    ensureOk(
      wasm.motion_sdk_set_pose_schema(config.schema === "halpe26" ? 1 : 0),
      "set_pose_schema",
    );
    ensureOk(
      wasm.motion_sdk_set_canonical_feed_mirroring(
        config.canonicalFeedMirrored === undefined ? 2 : config.canonicalFeedMirrored ? 1 : 0,
      ),
      "set_canonical_feed_mirroring",
    );
    if (config.setLifecycleMode !== "preview") {
      ensureOk(wasm.motion_sdk_begin_replay_set(), "begin_replay_set");
      this.lastSetLifecycle = "active";
    }
  }

  static async create(config: RustCanonicalWasmSessionConfig): Promise<RustCanonicalWasmSession> {
    return new RustCanonicalWasmSession(config, await loadRustMotionWasm());
  }

  process(observation: PoseEstimate): CanonicalPoseFrame {
    const coreStartedAt = performance.now();
    const timestamp = BigInt(Math.max(0, Math.round(observation.timestampMs)));
    ensureOk(
      this.wasm.motion_sdk_begin_frame(
        Number(timestamp & 0xffff_ffffn),
        Number(timestamp >> 32n),
        observation.landmarks.length,
      ),
      "begin_frame",
    );
    observation.landmarks.forEach((landmark, index) => {
      ensureOk(
        this.wasm.motion_sdk_set_landmark(
          index,
          landmark.x,
          landmark.y,
          landmark.z,
          landmark.visibility,
        ),
        `landmark_${index}`,
      );
    });
    ensureOk(this.wasm.motion_sdk_process_frame(), "process_frame");
    this.lastFrameValid = this.wasm.motion_sdk_current_frame_valid() === 1;
    this.lastCanonicalHash = combineU64(
      this.wasm.motion_sdk_output_hash(0),
      this.wasm.motion_sdk_output_hash(1),
    );
    const coreMs = performance.now() - coreStartedAt;
    const decodeStartedAt = performance.now();
    this.lastDecodedPacket = this.readPacket();
    const decodeMs = performance.now() - decodeStartedAt;
    this.lastTiming = Object.freeze({ coreMs, decodeMs });
    this.applyDecodedPacket(this.lastDecodedPacket);
    this.referenceComparison = this.readReferenceComparison();
    this.simulatedBaselineComparison = this.readSimulatedBaselineComparison();
    this.lastCandidateDiagnostics = this.readCandidateDiagnostics();
    return this.readFrame(observation, observation.landmarks, observation.worldLandmarks);
  }

  processCandidates(
    candidates: readonly PoseCandidateEstimate[],
    timestampMs: number,
    equipment: readonly RustEquipmentObservation[] = [],
    visualEquipmentFrame?: RustVisualEquipmentLumaFrame,
  ): CanonicalPoseFrame {
    const coreStartedAt = performance.now();
    const timestamp = BigInt(Math.max(0, Math.round(timestampMs)));
    ensureOk(
      this.wasm.motion_sdk_begin_multi(
        Number(timestamp & 0xffff_ffffn),
        Number(timestamp >> 32n),
      ),
      "begin_multi",
    );
    for (const candidate of candidates) {
      const id = BigInt(candidate.candidateId);
      ensureOk(
        this.wasm.motion_sdk_begin_candidate(
          Number(id & 0xffff_ffffn),
          Number(id >> 32n),
          candidate.bbox.x,
          candidate.bbox.y,
          candidate.bbox.width,
          candidate.bbox.height,
          candidate.torsoColor[0],
          candidate.torsoColor[1],
          candidate.torsoColor[2],
          candidate.landmarks.length,
        ),
        "begin_candidate",
      );
      candidate.landmarks.forEach((landmark, index) => {
        ensureOk(
          this.wasm.motion_sdk_set_landmark(
            index,
            landmark.x,
            landmark.y,
            landmark.z,
            landmark.visibility,
          ),
          `candidate_landmark_${index}`,
        );
      });
      ensureOk(this.wasm.motion_sdk_commit_candidate(), "commit_candidate");
    }
    this.lastVisualBarbellAxis = null;
    if (visualEquipmentFrame) {
      const { width, height, luma } = visualEquipmentFrame;
      if (
        !Number.isSafeInteger(width)
        || !Number.isSafeInteger(height)
        || width < 8
        || height < 8
        || luma.length !== width * height
      ) {
        throw new Error("Rust visual equipment luma frame is invalid");
      }
      ensureOk(
        this.wasm.motion_sdk_begin_visual_equipment_frame(width, height, luma.length),
        "begin_visual_equipment_frame",
      );
      const pointer = this.wasm.motion_sdk_visual_equipment_luma_ptr();
      if (pointer <= 0 || pointer + luma.length > this.wasm.memory.buffer.byteLength) {
        throw new Error("Rust visual equipment luma memory range is invalid");
      }
      new Uint8Array(this.wasm.memory.buffer, pointer, luma.length).set(luma);
      ensureOk(this.wasm.motion_sdk_detect_barbell_axis(), "detect_barbell_axis");
    }
    for (const observation of equipment) {
      const id = BigInt(observation.proposalId);
      let flags = 0;
      if (observation.reflectionCandidate) flags |= 1;
      if (observation.staticRackCandidate) flags |= 1 << 1;
      if (observation.occlusion === "partial") flags |= 1 << 2;
      if (observation.occlusion === "heavy") flags |= 1 << 3;
      if (observation.truncated) flags |= 1 << 4;
      const addObservation = observation.axis
        ? this.wasm.motion_sdk_add_equipment_axis_observation(
          Number(id & 0xffff_ffffn),
          Number(id >> 32n),
          RUST_EQUIPMENT_KIND_CODE[observation.kind],
          observation.bbox.x,
          observation.bbox.y,
          observation.bbox.width,
          observation.bbox.height,
          observation.axis.x1,
          observation.axis.y1,
          observation.axis.x2,
          observation.axis.y2,
          observation.score,
          observation.uncertaintyPx ?? -1,
          RUST_EQUIPMENT_SOURCE_CODE[observation.source],
          flags,
        )
        : this.wasm.motion_sdk_add_equipment_observation(
          Number(id & 0xffff_ffffn),
          Number(id >> 32n),
          RUST_EQUIPMENT_KIND_CODE[observation.kind],
          observation.bbox.x,
          observation.bbox.y,
          observation.bbox.width,
          observation.bbox.height,
          observation.score,
          observation.uncertaintyPx ?? -1,
          RUST_EQUIPMENT_SOURCE_CODE[observation.source],
          flags,
        );
      ensureOk(
        addObservation,
        observation.axis ? "add_equipment_axis_observation" : "add_equipment_observation",
      );
    }
    ensureOk(this.wasm.motion_sdk_process_multi(), "process_multi");
    if (visualEquipmentFrame) this.lastVisualBarbellAxis = this.readVisualBarbellAxis();
    this.lastFrameValid = this.wasm.motion_sdk_current_frame_valid() === 1;
    this.lastCanonicalHash = combineU64(
      this.wasm.motion_sdk_output_hash(0),
      this.wasm.motion_sdk_output_hash(1),
    );
    const coreMs = performance.now() - coreStartedAt;
    const decodeStartedAt = performance.now();
    this.lastDecodedPacket = this.readPacket();
    const decodeMs = performance.now() - decodeStartedAt;
    this.lastTiming = Object.freeze({ coreMs, decodeMs });
    this.applyDecodedPacket(this.lastDecodedPacket);
    this.referenceComparison = this.readReferenceComparison();
    this.simulatedBaselineComparison = this.readSimulatedBaselineComparison();
    this.lastCandidateDiagnostics = this.readCandidateDiagnostics();
    const selected = this.lastTarget.state !== "locked" || this.lastTarget.selectedCandidateId === null
      ? undefined
      : candidates.find(
          (candidate) => BigInt(candidate.candidateId) === this.lastTarget.selectedCandidateId,
        );
    return this.readFrame(
      { timestampMs, landmarks: [], worldLandmarks: [] },
      selected?.landmarks ?? [],
      selected?.worldLandmarks ?? [],
    );
  }

  selectSubjectAt(x: number, y: number): boolean {
    if (this.wasm.motion_sdk_select_subject(x, y) !== 0) return false;
    this.applyDecodedPacket(this.readPacket());
    return true;
  }

  close(): void {
    ensureOk(this.wasm.motion_sdk_close(), "close");
    this.lastDecodedPacket = null;
    this.lastQualityProposals = [];
    this.lastFrameValid = false;
    this.lastCandidateDiagnostics = [];
    this.lastVisualBarbellAxis = null;
    this.resetReferenceComparison();
  }

  private readVisualBarbellAxis(): RustVisualBarbellAxis | null {
    const source = this.wasm.motion_sdk_visual_barbell_axis_source();
    if (source === 0) return null;
    if (source !== 1 && source !== 2 && source !== 3) {
      throw new Error(`Rust visual barbell source ${source} is invalid`);
    }
    const number = (field: number) => this.wasm.motion_sdk_visual_barbell_axis_number(field);
    const values = Array.from({ length: 7 }, (_, field) => number(field));
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error("Rust visual barbell axis contains a non-finite value");
    }
    return Object.freeze({
      source: source === 1 ? "measured" : source === 3 ? "fused" : "predicted",
      x1: values[0],
      y1: values[1],
      x2: values[2],
      y2: values[3],
      centerY: values[4],
      confidence: values[5],
      uncertaintyPx: values[6],
    });
  }

  beginSet(): void {
    ensureOk(this.wasm.motion_sdk_begin_set(), "begin_set");
    this.applyDecodedPacket(this.readPacket());
  }

  finishSet(): void {
    ensureOk(this.wasm.motion_sdk_finish_set(), "finish_set");
    this.applyDecodedPacket(this.readPacket());
  }

  pauseSet(): void {
    ensureOk(this.wasm.motion_sdk_pause_set(), "pause_set");
    this.applyDecodedPacket(this.readPacket());
  }

  resumeSet(): void {
    ensureOk(this.wasm.motion_sdk_resume_set(), "resume_set");
    this.applyDecodedPacket(this.readPacket());
  }

  attestBuiltInProfile(
    profile: Exclude<RustExerciseProfile, null>,
  ): RuntimeBuiltInProfileAttestation | null {
    const baseCode = RUST_EXERCISE_PROFILE_CODES[profile];
    const profileCode = this.config.schema === "halpe26" ? baseCode + 100 : baseCode;
    const low = this.wasm.motion_sdk_builtin_profile_hash_low(profileCode) >>> 0;
    const high = this.wasm.motion_sdk_builtin_profile_hash_high(profileCode) >>> 0;
    if (low === 0 && high === 0) return null;
    const hash = (BigInt(high) << 32n) | BigInt(low);
    return Object.freeze({
      profileCode,
      contentHash: `fnv1a64:${hash.toString(16).padStart(16, "0")}`,
      source: "rust_abi",
    });
  }

  setExerciseProfile(
    profile: RustExerciseProfile,
    expectedExecutable?: ExecutableRustProfileRef,
  ): void {
    const baseCode = profile === null ? 0 : RUST_EXERCISE_PROFILE_CODES[profile];
    const code = profile !== null && this.config.schema === "halpe26" ? baseCode + 100 : baseCode;
    if (expectedExecutable) {
      const attestation = profile === null ? null : this.attestBuiltInProfile(profile);
      if (
        !attestation
        || attestation.profileCode !== expectedExecutable.profileCode
        || attestation.contentHash !== expectedExecutable.contentHash
      ) {
        throw new Error("Rust built-in profile does not match the promoted executable binding");
      }
    }
    ensureOk(this.wasm.motion_sdk_set_profile(code), "set_profile");
    this.lastRepState = {
      phase: "ready",
      partialAttempts: 0n,
      activeRepId: null,
      recoveredAcrossGap: false,
    };
    this.lastCompletedReps = [];
    this.lastQualityProposals = [];
    this.resetReferenceComparison();
  }

  installExerciseProfileData(profile: RustExerciseProfileData): RustExerciseProfileData {
    const sessionProfile = adaptRustExerciseProfileToPoseSchema(profile, this.config.schema);
    const installation = encodeRustExerciseProfileInstallation(sessionProfile);
    const identity = new TextEncoder().encode(installation.identity);
    ensureOk(this.wasm.motion_sdk_begin_profile_identity(identity.length), "begin_profile_identity");
    identity.forEach((value, index) => {
      ensureOk(
        this.wasm.motion_sdk_set_profile_identity_byte(index, value),
        `profile_identity_byte_${index}`,
      );
    });
    ensureOk(
      this.wasm.motion_sdk_install_profile(
        ...installation.abiArguments,
      ),
      "install_profile",
    );
    this.lastRepState = {
      phase: "ready",
      partialAttempts: 0n,
      activeRepId: null,
      recoveredAcrossGap: false,
    };
    this.lastCompletedReps = [];
    this.lastQualityProposals = [];
    this.resetReferenceComparison();
    return sessionProfile;
  }

  installReferenceProfile(input: RustReferenceProfileInstallation): void {
    if (
      input.profile.profileStatus !== "personal_provisional_expert_reviewed"
      && input.profile.profileStatus !== "simulated_nominal"
    ) {
      throw new Error("Reference profiles must be either simulated nominal or expert reviewed before installation");
    }
    const envelope = new TextEncoder().encode(JSON.stringify(input));
    ensureOk(
      this.wasm.motion_sdk_begin_reference_profile(envelope.length),
      "begin_reference_profile",
    );
    envelope.forEach((value, index) => {
      ensureOk(
        this.wasm.motion_sdk_set_reference_profile_byte(index, value),
        `reference_profile_byte_${index}`,
      );
    });
    ensureOk(this.wasm.motion_sdk_commit_reference_profile(), "commit_reference_profile");
    this.installedReferenceIdentity = referenceIdentityKey(input.profile.identity);
    this.installedReferenceFeatureNames = Object.freeze([...input.profile.featureNames]);
    this.referenceComparison = this.readReferenceComparison();
  }

  /** Installs a broad simulated phase corridor that is consumed and compared
   * inside Rust. It is evidence for review only: no simulation can emit a
   * normative quality verdict or alter a sealed-rep count. */
  installSimulatedTrajectoryBaseline(input: RustSimulatedTrajectoryBaselineInstallation): void {
    const envelope = new TextEncoder().encode(JSON.stringify(input));
    ensureOk(
      this.wasm.motion_sdk_begin_simulated_baseline(envelope.length),
      "begin_simulated_baseline",
    );
    envelope.forEach((value, index) => {
      ensureOk(
        this.wasm.motion_sdk_set_simulated_baseline_byte(index, value),
        `simulated_baseline_byte_${index}`,
      );
    });
    ensureOk(this.wasm.motion_sdk_commit_simulated_baseline(), "commit_simulated_baseline");
    this.installedSimulatedBaselineIdentity = referenceIdentityKey(input.baseline.identity);
    this.installedSimulatedBaselineFeatureNames = Object.freeze([...input.baseline.featureNames]);
    this.simulatedBaselineComparison = this.readSimulatedBaselineComparison();
  }

  /**
   * Installs the host-derived model/action/camera context independently from
   * reference-profile bytes. Rust freezes this context until the active
   * ExerciseProfile changes, preventing a profile from self-attesting that it
   * matches the currently running MediaPipe model or equipment variation.
   */
  setReferenceRuntimeContext(context: RustReferenceRuntimeContext): void {
    const bytes = new TextEncoder().encode(JSON.stringify(context));
    ensureOk(
      this.wasm.motion_sdk_begin_reference_context(bytes.length),
      "begin_reference_context",
    );
    bytes.forEach((value, index) => {
      ensureOk(
        this.wasm.motion_sdk_set_reference_context_byte(index, value),
        `reference_context_byte_${index}`,
      );
    });
    ensureOk(
      this.wasm.motion_sdk_commit_reference_context(),
      "commit_reference_context",
    );
  }

  schedule(
    timestampMs: number,
    inFlight = false,
  ): "acquire-multi" | "track-target" | "refresh-candidates" | "skip-frame" {
    const timestamp = BigInt(Math.max(0, Math.round(timestampMs)));
    const code = this.wasm.motion_sdk_schedule(
      Number(timestamp & 0xffff_ffffn),
      Number(timestamp >> 32n),
      inFlight ? 1 : 0,
    );
    const request = ([
      "acquire-multi",
      "track-target",
      "refresh-candidates",
      "skip-frame",
    ] as const)[code];
    if (!request) throw new Error(`Rust scheduler returned ${code}`);
    return request;
  }

  setDegradationLevel(level: 0 | 1 | 2): void {
    ensureOk(this.wasm.motion_sdk_set_degradation(level), "set_degradation");
  }

  private readFrame(
    observation: PoseEstimate,
    rawLandmarks: readonly PoseLandmark[],
    rawWorldLandmarks: readonly PoseLandmark[],
  ): CanonicalPoseFrame {
    const packet = this.lastDecodedPacket;
    if (!packet) throw new Error("Rust MotionPacket was not decoded before canonical read");
    const outputLength = packet.canonical.length;
    const fallback = rawLandmarks[0] ?? { x: 0, y: 0, z: 0, visibility: 0 };
    const landmarks = Array.from(
      { length: outputLength },
      (_, index) => this.readLandmark(packet.canonical[index], rawLandmarks[index] ?? fallback),
    );
    const worldLandmarks = rawWorldLandmarks.map(rawCanonicalLandmark);
    const overallQuality = landmarks.length
      ? landmarks.reduce((sum, landmark) => sum + landmark.canonicalConfidence, 0)
        / landmarks.length
      : 0;
    return {
      contractVersion: CANONICAL_POSE_CONTRACT_VERSION,
      algorithmVersion: RUST_CANONICAL_ALGORITHM_VERSION,
      frameId: this.nextFrameId++,
      sequenceId: this.config.sequenceId,
      timestampMs: observation.timestampMs,
      sourceTimestampMs: observation.timestampMs,
      schema: this.config.schema,
      coordinateSpace: "image_normalized",
      worldCoordinateSpace: "meters",
      image: { ...this.config.image },
      overallQuality,
      landmarks,
      worldLandmarks,
    };
  }

  private readPacket(): DecodedMotionPacket {
    const length = this.wasm.motion_sdk_packet_len();
    if (length <= 0) throw new Error("Rust MotionPacket is empty");
    const pointer = this.wasm.motion_sdk_packet_ptr();
    if (pointer <= 0 || pointer + length > this.wasm.memory.buffer.byteLength) {
      throw new Error("Rust MotionPacket memory range is invalid");
    }
    // Decode synchronously before the next Rust call can reuse the Vec.
    const bytes = new Uint8Array(this.wasm.memory.buffer, pointer, length);
    return decodeMotionPacket(bytes);
  }

  private applyDecodedPacket(packet: DecodedMotionPacket): void {
    this.lastTarget = {
      state: packet.target.state,
      candidateCount: packet.target.candidateCount,
      selectedCandidateId: packet.target.selectedCandidateId,
      subjectEpoch: packet.subjectEpoch,
    };
    this.lastRepState = {
      phase: packet.repState.phase,
      partialAttempts: packet.repState.partialAttempts,
      activeRepId: packet.repState.activeRepId,
      recoveredAcrossGap: packet.repState.recoveredAcrossGap,
    };
    this.lastSetLifecycle = packet.setState.lifecycle;
    this.lastCompletedReps = Object.freeze(packet.completedReps.map((rep) => Object.freeze({
      repId: rep.repId,
      startFrameId: rep.startFrameId,
      startTimestampMs: rep.startTimestampMs,
      peakFrameId: rep.peakFrameId,
      peakTimestampMs: rep.peakTimestampMs,
      endFrameId: rep.endFrameId,
      endTimestampMs: rep.endTimestampMs,
      canonicalSliceHash: rep.canonicalSliceHash,
      profileHash: rep.profileHash,
      revision: rep.revision,
      profileMaturity: rep.profileMaturity,
      profileIdentity: rep.profileIdentity,
      qualityVerdict: rep.qualityVerdict,
      recoveredAcrossGap: rep.recoveredAcrossGap,
      disposition: rep.disposition,
      evidenceReason: rep.evidenceReason,
      observationFindings: rep.observationFindings,
    })));
    this.lastQualityProposals = packet.qualityProposals;
  }

  private resetReferenceComparison(): void {
    this.installedReferenceIdentity = null;
    this.installedReferenceFeatureNames = [];
    this.referenceComparison = Object.freeze({
      status: "unavailable",
      reason: "no-installed-reviewed-profile",
      profileIdentity: null,
      qualityVerdict: null,
    });
    this.installedSimulatedBaselineIdentity = null;
    this.installedSimulatedBaselineFeatureNames = [];
    this.simulatedBaselineComparison = Object.freeze({
      status: "unavailable",
      reason: "no-installed-reviewed-profile",
      profileIdentity: null,
      qualityVerdict: null,
    });
  }

  private readReferenceComparison(): RustReferenceComparison {
    const status = this.wasm.motion_sdk_reference_status();
    if (status <= 2) {
      return Object.freeze({
        status: "unavailable",
        reason: status === 1
          ? "awaiting-sealed-rep"
          : status === 2
            ? "reference-extraction-refused"
            : "no-installed-reviewed-profile",
        profileIdentity: this.installedReferenceIdentity,
        qualityVerdict: null,
      });
    }
    if (status > 6 || !this.installedReferenceIdentity) {
      throw new Error(`Rust reference matcher returned invalid state ${status}`);
    }
    const field64 = (field: number) => combineU64(
      this.wasm.motion_sdk_reference_field(field, 0),
      this.wasm.motion_sdk_reference_field(field, 1),
    );
    const featureCount = this.wasm.motion_sdk_reference_feature_count();
    const expectedFeatureCount = status >= 5 ? 0 : this.installedReferenceFeatureNames.length;
    if (featureCount !== expectedFeatureCount) {
      throw new Error("Rust reference matcher feature schema changed after installation");
    }
    const features = Object.freeze(this.installedReferenceFeatureNames
      .slice(0, featureCount)
      .map((feature, index) => {
      const value = (field: number) => this.wasm.motion_sdk_reference_feature_number(index, field);
      const outsideRatio = value(3);
      return Object.freeze({
        feature,
        comparableNodeCount: value(0),
        unknownNodeCount: value(1),
        outsideNodeCount: value(2),
        outsideNodeRatio: Number.isFinite(outsideRatio) ? outsideRatio : null,
        maximumConsecutiveOutsideNodes: value(4),
        totalNormalizedExcess: value(5),
      });
      }));
    return Object.freeze({
      status: ([
        "comparison_available",
        "insufficient_observation",
        "profile_mismatch",
        "invalid_profile",
      ] as const)[status - 3],
      reason: status === 5
        ? "strict reference identity or phase mismatch"
        : status === 6
          ? "invalid reference profile"
          : null,
      profileIdentity: this.installedReferenceIdentity,
      profileHash: field64(3),
      repId: field64(0),
      repRevision: Number(field64(1)),
      canonicalSliceHash: field64(2),
      features,
      qualityVerdict: null,
    });
  }

  private readSimulatedBaselineComparison(): RustReferenceComparison {
    const status = this.wasm.motion_sdk_simulated_baseline_status();
    if (status <= 2) {
      return Object.freeze({
        status: "unavailable",
        reason: status === 1
          ? "awaiting-sealed-rep"
          : status === 2
            ? "reference-extraction-refused"
            : "no-installed-reviewed-profile",
        profileIdentity: this.installedSimulatedBaselineIdentity,
        qualityVerdict: null,
      });
    }
    if (status > 6 || !this.installedSimulatedBaselineIdentity) {
      throw new Error(`Rust simulated baseline returned invalid state ${status}`);
    }
    const field64 = (field: number) => combineU64(
      this.wasm.motion_sdk_simulated_baseline_field(field, 0),
      this.wasm.motion_sdk_simulated_baseline_field(field, 1),
    );
    const featureCount = this.wasm.motion_sdk_simulated_baseline_feature_count();
    const expectedFeatureCount = status >= 5 ? 0 : this.installedSimulatedBaselineFeatureNames.length;
    if (featureCount !== expectedFeatureCount) {
      throw new Error("Rust simulated baseline feature schema changed after installation");
    }
    const features = Object.freeze(this.installedSimulatedBaselineFeatureNames
      .slice(0, featureCount)
      .map((feature, index) => {
        const value = (field: number) => this.wasm.motion_sdk_simulated_baseline_feature_number(index, field);
        const outsideRatio = value(3);
        return Object.freeze({
          feature,
          comparableNodeCount: value(0),
          unknownNodeCount: value(1),
          outsideNodeCount: value(2),
          outsideNodeRatio: Number.isFinite(outsideRatio) ? outsideRatio : null,
          maximumConsecutiveOutsideNodes: value(4),
          totalNormalizedExcess: value(5),
        });
      }));
    return Object.freeze({
      status: ([
        "comparison_available",
        "insufficient_observation",
        "profile_mismatch",
        "invalid_profile",
      ] as const)[status - 3],
      reason: status === 5
        ? "strict simulated baseline identity or phase mismatch"
        : status === 6
          ? "invalid simulated baseline"
          : null,
      profileIdentity: this.installedSimulatedBaselineIdentity,
      profileHash: field64(3),
      repId: field64(0),
      repRevision: Number(field64(1)),
      canonicalSliceHash: field64(2),
      features,
      qualityVerdict: null,
    });
  }

  private readCandidateDiagnostics(): readonly RustCandidateDiagnostic[] {
    return Object.freeze(Array.from(
      { length: this.wasm.motion_sdk_candidate_count() },
      (_, index) => {
        const value = (field: number) => this.wasm.motion_sdk_candidate_number(index, field);
        const continuityCost = value(RUST_CANDIDATE_FIELD.continuityCost);
        const selected = value(RUST_CANDIDATE_FIELD.selected) === 1;
        const components = [
          value(RUST_CANDIDATE_FIELD.continuityLandmarks),
          value(RUST_CANDIDATE_FIELD.continuityCenter),
          value(RUST_CANDIDATE_FIELD.continuityColor),
        ]
          .map((component) => Number.isFinite(component) ? component : null);
        const switchThreshold = value(RUST_CANDIDATE_FIELD.switchThreshold);
        const switchConfirmMs = value(RUST_CANDIDATE_FIELD.switchConfirmMs);
        const decision = selected
          ? "selected"
          : !Number.isFinite(continuityCost)
            ? "dominant-candidate"
            : continuityCost <= switchThreshold
              ? "temporal-match"
              : "alternate-candidate";
        return Object.freeze({
          candidateId: value(RUST_CANDIDATE_FIELD.id),
          bbox: Object.freeze({
            x: value(RUST_CANDIDATE_FIELD.bboxX),
            y: value(RUST_CANDIDATE_FIELD.bboxY),
            width: value(RUST_CANDIDATE_FIELD.bboxWidth),
            height: value(RUST_CANDIDATE_FIELD.bboxHeight),
          }),
          dominanceScore: value(RUST_CANDIDATE_FIELD.dominanceScore),
          continuityCost: Number.isFinite(continuityCost) ? continuityCost : null,
          continuityComponents: Object.freeze({
            landmarks: components[0],
            center: components[1],
            color: components[2],
          }),
          switchThreshold,
          switchConfirmMs,
          decision,
          selected,
        });
      },
    ));
  }

  private readLandmark(
    decoded: Readonly<DecodedMotionLandmark>,
    raw: PoseLandmark,
  ): CanonicalLandmark {
    const { source, renderable } = decoded;
    return {
      ...raw,
      x: decoded.x ?? Number.NaN,
      y: decoded.y ?? Number.NaN,
      z: decoded.z ?? Number.NaN,
      visibility: decoded.canonicalConfidence,
      predicted: source === "predicted",
      observationScore: decoded.observationScore,
      canonicalConfidence: decoded.canonicalConfidence,
      uncertainty: decoded.uncertainty,
      source,
      repairFlags: source === "fused" ? ["constrained"] : [],
      continuityReason: decoded.reason,
      renderable,
      usable: renderable && source !== "predicted",
    };
  }
}

function referenceIdentityKey(
  identity: RustTrajectoryIdentity,
): string {
  return [
    identity.exerciseId,
    identity.capturePosition,
    identity.variation,
    identity.trainingSide,
    identity.equipment,
    identity.coordinateSystem,
    identity.featureSchemaId,
    identity.poseModelVersion,
  ].join("|");
}

export function computeRustExerciseProfileHash(
  profile: Omit<RustExerciseProfileData, "contentHash">,
): bigint {
  let hash = 0xcbf2_9ce4_8422_2325n;
  const update = (bytes: Iterable<number>) => {
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = BigInt.asUintN(64, hash * 0x0000_0100_0000_01b3n);
    }
  };
  const encoder = new TextEncoder();
  for (const value of [profile.identity, profile.coordinateUnit, profile.stateMachineId]) {
    update(encoder.encode(value));
    update([0]);
  }
  const scratch = new ArrayBuffer(8);
  const view = new DataView(scratch);
  const updateU32 = (value: number) => {
    view.setUint32(0, value, true);
    update(new Uint8Array(scratch, 0, 4));
  };
  const capabilities = Number(profile.requiredCapabilities.includes("canonical-landmarks"))
    | (Number(profile.requiredCapabilities.includes("subject-lock")) << 1);
  updateU32(capabilities);
  update([
    0,
    profile.schema === "halpe26" ? 1 : 0,
    profile.direction === "increasing" ? 0 : profile.direction === "decreasing" ? 1 : 2,
  ]);
  for (const signal of [profile.primarySignal, profile.secondarySignal]) {
    const landmarks: number[] = signal.landmarks.filter((value): value is number => value !== undefined);
    update([rustExerciseSignalKind(signal.kind), landmarks.length, ...landmarks]);
  }
  for (const value of [
    profile.startAmplitude,
    profile.minPrimaryAmplitude,
    profile.minSecondaryAmplitude,
    profile.returnHysteresis,
    profile.readyTolerance,
  ]) {
    view.setFloat32(0, value, true);
    update(new Uint8Array(scratch, 0, 4));
  }
  view.setBigUint64(0, BigInt(profile.maxGapMs), true);
  update(new Uint8Array(scratch));
  view.setBigUint64(0, BigInt(profile.minRepDurationMs), true);
  update(new Uint8Array(scratch));
  view.setBigUint64(0, BigInt(profile.maxRepDurationMs), true);
  update(new Uint8Array(scratch));
  return hash;
}

/**
 * Validates a profile's lineage and encodes the exact scalar order expected by
 * `motion_sdk_install_profile`. Native adapters consume the same encoding, so
 * enum and missing-landmark conventions cannot drift between Web and Android.
 */
export function encodeRustExerciseProfileInstallation(
  profile: RustExerciseProfileData,
): RustExerciseProfileInstallation {
  if (computeRustExerciseProfileHash(profile) !== profile.contentHash) {
    throw new Error("Exercise profile content hash does not match its canonical bundle");
  }
  const abiArguments = [
    Number(profile.contentHash & 0xffff_ffffn),
    Number((profile.contentHash >> 32n) & 0xffff_ffffn),
    // Rust ABI order is maturity followed by pose schema. Both legacy
    // provisional BlazePose values were zero, which previously hid a swapped
    // argument bug until the first Halpe-26 data profile was installed.
    0,
    profile.schema === "halpe26" ? 1 : 0,
    rustCoordinateUnit(profile.coordinateUnit),
    rustExerciseStateMachine(profile.stateMachineId),
    Number(profile.requiredCapabilities.includes("canonical-landmarks"))
      | (Number(profile.requiredCapabilities.includes("subject-lock")) << 1),
    profile.direction === "increasing" ? 0 : profile.direction === "decreasing" ? 1 : 2,
    rustExerciseSignalKind(profile.primarySignal.kind),
    profile.primarySignal.landmarks[0] ?? 0xffff_ffff,
    profile.primarySignal.landmarks[1] ?? 0xffff_ffff,
    profile.primarySignal.landmarks[2] ?? 0xffff_ffff,
    rustExerciseSignalKind(profile.secondarySignal.kind),
    profile.secondarySignal.landmarks[0] ?? 0xffff_ffff,
    profile.secondarySignal.landmarks[1] ?? 0xffff_ffff,
    profile.secondarySignal.landmarks[2] ?? 0xffff_ffff,
    profile.startAmplitude,
    profile.minPrimaryAmplitude,
    profile.minSecondaryAmplitude,
    profile.returnHysteresis,
    profile.readyTolerance,
    profile.maxGapMs,
    profile.minRepDurationMs,
    profile.maxRepDurationMs,
  ] as const;
  return { identity: profile.identity, abiArguments };
}

const BLAZEPOSE33_TO_HALPE26 = new Map<number, number>([
  [0, 0], [2, 1], [5, 2], [7, 3], [8, 4],
  [11, 5], [12, 6], [13, 7], [14, 8], [15, 9], [16, 10],
  [23, 11], [24, 12], [25, 13], [26, 14], [27, 15], [28, 16],
  // BlazePose heel and foot-index points have direct Halpe foot equivalents.
  [29, 24], [30, 25], [31, 20], [32, 21],
]);

export function adaptRustExerciseProfileToPoseSchema(
  profile: RustExerciseProfileData,
  targetSchema: PoseContinuitySessionConfig["schema"],
): RustExerciseProfileData {
  if (targetSchema === profile.schema) return profile;
  if (targetSchema !== "halpe26" || profile.schema !== "blazepose33") {
    throw new Error(`Unsupported profile schema adaptation: ${profile.schema} -> ${targetSchema}`);
  }
  const adaptSignal = (signal: RustExerciseSignal): RustExerciseSignal => ({
    ...signal,
    landmarks: signal.landmarks.map((index) => {
      if (index === undefined) return undefined;
      const mapped = BLAZEPOSE33_TO_HALPE26.get(index);
      if (mapped === undefined) {
        throw new Error(`BlazePose joint ${index} has no Halpe-26 equivalent`);
      }
      return mapped;
    }),
  });
  const withoutHash: RustExerciseProfileData = {
    ...profile,
    identity: `${profile.identity}-halpe26`,
    contentHash: 0n,
    schema: "halpe26",
    primarySignal: adaptSignal(profile.primarySignal),
    secondarySignal: adaptSignal(profile.secondarySignal),
  };
  return {
    ...withoutHash,
    contentHash: computeRustExerciseProfileHash(withoutHash),
  };
}

function rustExerciseSignalKind(kind: RustExerciseSignal["kind"]): number {
  const codeByKind: Readonly<Record<RustExerciseSignal["kind"], number>> = {
    "landmark-y": 0,
    "joint-angle": 1,
    "landmark-distance": 2,
    "landmark-horizontal-distance": 3,
    "landmark-vertical-distance": 4,
    "local-along-axis-progress": 6,
    "local-cross-axis-displacement": 7,
    "local-endpoint-relative-progress": 8,
    "local-dynamic-bar-angle": 9,
    "local-channel-agreement": 10,
    "local-observability": 11,
  };
  return codeByKind[kind];
}

function rustExerciseStateMachine(stateMachineId: RustExerciseProfileData["stateMachineId"]): number {
  const codeById: Readonly<Record<RustExerciseProfileData["stateMachineId"], number>> = {
    "ready-effort-peak-return/v1": 0,
    "alternating-ready-effort-return/v1": 1,
    "median-100ms-ready-effort-peak-return/v1": 2,
    "median-200ms-ready-effort-peak-return/v1": 3,
    "median-300ms-ready-effort-peak-return/v1": 4,
    "median-400ms-ready-effort-peak-return/v1": 5,
    "median-600ms-ready-effort-peak-return/v1": 6,
    "cycle-aligned-ready-effort-peak-return/v1": 7,
    "cycle-aligned-median-100ms-ready-effort-peak-return/v1": 8,
    "cycle-aligned-median-200ms-ready-effort-peak-return/v1": 9,
    "cycle-aligned-median-300ms-ready-effort-peak-return/v1": 10,
    "cycle-aligned-median-400ms-ready-effort-peak-return/v1": 11,
    "cycle-aligned-median-600ms-ready-effort-peak-return/v1": 12,
    "stable-cycle-200ms-ready-effort-peak-return/v1": 13,
    "barbell-axis-primary-ready-effort-return/v1": 14,
    "local-barbell-bench-ready-effort-return/v1": 15,
    "local-barbell-shoulder-press-ready-effort-return/v1": 16,
  };
  return codeById[stateMachineId];
}

function rustCoordinateUnit(unit: RustExerciseProfileData["coordinateUnit"]): number {
  return unit === "image-normalized-y"
    ? 0
    : unit === "image-angle-deg"
      ? 1
      : unit === "torso-normalized-distance"
        ? 2
        : unit === "derived-kinematic-signal"
          ? 3
          : 4;
}

function combineU64(low: number, high: number): bigint {
  return BigInt(low >>> 0) | (BigInt(high >>> 0) << 32n);
}

function rawCanonicalLandmark(raw: PoseLandmark): CanonicalLandmark {
  const renderable = Number.isFinite(raw.x) && Number.isFinite(raw.y) && raw.visibility >= 0.5;
  return {
    ...raw,
    predicted: false,
    observationScore: raw.visibility,
    canonicalConfidence: raw.visibility,
    uncertainty: null,
    source: "measured",
    repairFlags: [],
    continuityReason: null,
    renderable,
    usable: renderable,
  };
}

function ensureOk(code: number, operation: string): void {
  if (code !== 0) throw new Error(`Rust motion SDK ${operation} failed (${code})`);
}
