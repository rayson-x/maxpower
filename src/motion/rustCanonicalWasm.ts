import {
  CANONICAL_POSE_CONTRACT_VERSION,
  RUST_CANONICAL_ALGORITHM_VERSION,
  type CanonicalLandmark,
  type CanonicalPoseFrame,
  type PoseContinuitySession,
  type PoseContinuitySessionConfig,
} from "../pose/canonicalPose";
import type { PoseCandidateEstimate, PoseEstimate, PoseLandmark } from "../pose/PoseEngine";
import {
  decodeMotionPacket,
  type DecodedMotionLandmark,
  type DecodedMotionPacket,
} from "./motionPacket";

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
  acquisitionCost: number;
  identityCost: number | null;
  identityComponents: {
    position: number | null;
    scale: number | null;
    proportion: number | null;
    color: number | null;
  };
  stableThreshold: number;
  reacquireThreshold: number;
  decision: "selected" | "no-lock" | "slot-continuity" | "requires-confirmation" | "identity-rejected";
  selected: boolean;
}
export type RustExerciseProfile = "lat_pulldown" | "seated_shoulder_press" | null;
export interface RustRepState {
  phase: "ready" | "effort" | "peak" | "return" | "frozen";
  partialAttempts: bigint;
  activeRepId: bigint | null;
  recoveredAcrossGap: boolean;
}
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
}
export interface RustExerciseProfileData {
  contentHash: bigint;
  direction: "increasing-y" | "decreasing-y";
  primaryLandmarks: readonly [number, number?];
  secondaryLandmarks: readonly [number, number?];
  startAmplitude: number;
  minPrimaryAmplitude: number;
  minSecondaryAmplitude: number;
  returnHysteresis: number;
  readyTolerance: number;
  maxGapMs: number;
}
export interface RustReferenceComparisonUnavailable {
  readonly status: "unavailable";
  readonly reason: "no-installed-reviewed-profile";
  readonly profileIdentity: null;
  readonly qualityVerdict: null;
}

export interface MotionWasmExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  motion_sdk_begin_sequence(length: number): number;
  motion_sdk_set_sequence_byte(index: number, value: number): number;
  motion_sdk_commit_sequence(): number;
  motion_sdk_close(): number;
  motion_sdk_reset(width: number, height: number, fusion: number): number;
  motion_sdk_begin_frame(timestampLow: number, timestampHigh: number, count: number): number;
  motion_sdk_set_landmark(
    index: number,
    x: number,
    y: number,
    z: number,
    visibility: number,
  ): number;
  motion_sdk_process_frame(): number;
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
  motion_sdk_process_multi(): number;
  motion_sdk_target_field(field: number): number;
  motion_sdk_candidate_count(): number;
  motion_sdk_candidate_number(index: number, field: number): number;
  motion_sdk_select_subject(x: number, y: number): number;
  motion_sdk_schedule(timestampLow: number, timestampHigh: number, inFlight: number): number;
  motion_sdk_set_profile(profileCode: number): number;
  motion_sdk_install_profile(
    hashLow: number,
    hashHigh: number,
    direction: number,
    primary0: number,
    primary1: number,
    secondary0: number,
    secondary1: number,
    startAmplitude: number,
    minPrimaryAmplitude: number,
    minSecondaryAmplitude: number,
    returnHysteresis: number,
    readyTolerance: number,
    maxGapMs: number,
  ): number;
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
  url = "/motion-sdk/form_coach_motion_sdk.wasm",
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
  lastCompletedReps: readonly RustSealedRep[] = [];
  lastCanonicalHash = 0n;
  lastDecodedPacket: DecodedMotionPacket | null = null;
  lastCandidateDiagnostics: readonly RustCandidateDiagnostic[] = [];
  readonly referenceComparison: RustReferenceComparisonUnavailable = Object.freeze({
    status: "unavailable",
    reason: "no-installed-reviewed-profile",
    profileIdentity: null,
    qualityVerdict: null,
  });

  constructor(
    private readonly config: PoseContinuitySessionConfig,
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
  }

  static async create(config: PoseContinuitySessionConfig): Promise<RustCanonicalWasmSession> {
    return new RustCanonicalWasmSession(config, await loadRustMotionWasm());
  }

  process(observation: PoseEstimate): CanonicalPoseFrame {
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
    this.lastCanonicalHash = combineU64(
      this.wasm.motion_sdk_output_hash(0),
      this.wasm.motion_sdk_output_hash(1),
    );
    this.lastDecodedPacket = this.readPacket();
    this.applyDecodedPacket(this.lastDecodedPacket);
    this.lastCandidateDiagnostics = this.readCandidateDiagnostics();
    return this.readFrame(observation, observation.landmarks, observation.worldLandmarks);
  }

  processCandidates(
    candidates: readonly PoseCandidateEstimate[],
    timestampMs: number,
  ): CanonicalPoseFrame {
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
    ensureOk(this.wasm.motion_sdk_process_multi(), "process_multi");
    this.lastCanonicalHash = combineU64(
      this.wasm.motion_sdk_output_hash(0),
      this.wasm.motion_sdk_output_hash(1),
    );
    this.lastDecodedPacket = this.readPacket();
    this.applyDecodedPacket(this.lastDecodedPacket);
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
    return this.wasm.motion_sdk_select_subject(x, y) === 0;
  }

  close(): void {
    ensureOk(this.wasm.motion_sdk_close(), "close");
    this.lastDecodedPacket = null;
    this.lastCandidateDiagnostics = [];
  }

  setExerciseProfile(profile: RustExerciseProfile): void {
    const code = profile === "lat_pulldown" ? 1 : profile === "seated_shoulder_press" ? 2 : 0;
    ensureOk(this.wasm.motion_sdk_set_profile(code), "set_profile");
    this.lastRepState = {
      phase: "ready",
      partialAttempts: 0n,
      activeRepId: null,
      recoveredAcrossGap: false,
    };
    this.lastCompletedReps = [];
  }

  installExerciseProfileData(profile: RustExerciseProfileData): void {
    void profile;
    throw new Error(
      "Custom profile install is closed until the full identity/capability bundle ABI is available",
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
    })));
  }

  private readCandidateDiagnostics(): readonly RustCandidateDiagnostic[] {
    return Object.freeze(Array.from(
      { length: this.wasm.motion_sdk_candidate_count() },
      (_, index) => {
        const value = (field: number) => this.wasm.motion_sdk_candidate_number(index, field);
        const identityCost = value(6);
        const selected = value(7) === 1;
        const components = [value(8), value(9), value(10), value(11)]
          .map((component) => Number.isFinite(component) ? component : null);
        const stableThreshold = value(12);
        const reacquireThreshold = value(13);
        const decision = selected
          ? "selected"
          : !Number.isFinite(identityCost)
            ? "no-lock"
            : identityCost <= stableThreshold
              ? "slot-continuity"
              : identityCost <= reacquireThreshold
                ? "requires-confirmation"
                : "identity-rejected";
        return Object.freeze({
          candidateId: value(0),
          bbox: Object.freeze({ x: value(1), y: value(2), width: value(3), height: value(4) }),
          acquisitionCost: value(5),
          identityCost: Number.isFinite(identityCost) ? identityCost : null,
          identityComponents: Object.freeze({
            position: components[0],
            scale: components[1],
            proportion: components[2],
            color: components[3],
          }),
          stableThreshold,
          reacquireThreshold,
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
