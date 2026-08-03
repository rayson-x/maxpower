export const MOTION_PACKET_CONTRACT_MAJOR = 1;

export type MotionTargetState =
  | "acquiring"
  | "locked"
  | "uncertain"
  | "lost"
  | "reacquiring";

export type MotionLandmarkSource = "measured" | "fused" | "predicted" | "unknown";
export type MotionContinuityReason =
  | "weak-observation-bone-fusion"
  | "short-gap-prediction"
  | "outlier-rejected-prediction"
  | "outlier-rejected-unknown"
  | "prediction-timeout"
  | "no-measurement-baseline";
export type MotionRepPhase = "ready" | "effort" | "peak" | "return" | "frozen";

export interface DecodedSealedRep {
  readonly repId: bigint;
  readonly startFrameId: bigint;
  readonly startTimestampMs: bigint;
  readonly peakFrameId: bigint;
  readonly peakTimestampMs: bigint;
  readonly endFrameId: bigint;
  readonly endTimestampMs: bigint;
  readonly canonicalSliceHash: bigint;
  readonly profileHash: bigint;
  readonly revision: number;
  readonly profileMaturity: "provisional" | "calibrated";
  readonly profileIdentity: string;
  readonly qualityVerdict: string | null;
  readonly recoveredAcrossGap: boolean;
}

export interface DecodedMotionLandmark {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly observationScore: number;
  readonly canonicalConfidence: number;
  readonly uncertainty: number | null;
  readonly source: MotionLandmarkSource;
  readonly reason: MotionContinuityReason | null;
  readonly renderable: boolean;
}

export interface DecodedMotionPacket {
  readonly lineage: Readonly<{
    sequenceId: string;
    contract: Readonly<{ major: number; minor: number }>;
    algorithmVersion: string;
    configVersion: string;
    inferenceVersion: string;
    diagnosticVersion: string;
    activeProfileIdentity: string | null;
    activeProfileHash: bigint | null;
  }>;
  readonly frameId: bigint;
  readonly sourceTimestampMs: bigint;
  readonly subjectEpoch: bigint;
  readonly target: Readonly<{
    state: MotionTargetState;
    candidateCount: number;
    selectedCandidateId: bigint | null;
  }>;
  readonly canonical: readonly Readonly<DecodedMotionLandmark>[];
  readonly repState: Readonly<{
    phase: MotionRepPhase;
    partialAttempts: bigint;
    activeRepId: bigint | null;
    recoveredAcrossGap: boolean;
  }>;
  readonly completedReps: readonly Readonly<DecodedSealedRep>[];
}

const textDecoder = new TextDecoder("utf-8", { fatal: true });
const HEADER_BYTES = 40;
const LANDMARK_BYTES = 26;

/**
 * Decodes one Rust-produced packet. Callers must route the returned immutable
 * object to every consumer instead of decoding or transforming it per feature.
 */
export function decodeMotionPacket(input: ArrayBuffer | ArrayBufferView): DecodedMotionPacket {
  const bytes = input instanceof ArrayBuffer
    ? new Uint8Array(input)
    : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (bytes.byteLength < HEADER_BYTES) throw new Error("MotionPacket truncated header");
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== "MOTN") {
    throw new Error("MotionPacket magic mismatch");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = view.getUint16(4, true);
  const minor = view.getUint16(6, true);
  if (major !== MOTION_PACKET_CONTRACT_MAJOR) {
    throw new Error(`Unsupported MotionPacket contract major ${major}`);
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > bytes.byteLength || declaredLength < HEADER_BYTES) {
    throw new Error("MotionPacket truncated payload");
  }

  const frameId = view.getBigUint64(12, true);
  const sourceTimestampMs = view.getBigUint64(20, true);
  const subjectEpoch = view.getBigUint64(28, true);
  const targetState = decodeTargetState(view.getUint8(36));
  const candidateCount = view.getUint8(37);
  const sequenceLength = view.getUint16(38, true);
  let offset = HEADER_BYTES;
  const sequenceId = readString(bytes, offset, sequenceLength, declaredLength, "sequence id");
  offset += sequenceLength;
  ensureAvailable(offset, 2, declaredLength, "algorithm length");
  const algorithmLength = view.getUint16(offset, true);
  offset += 2;
  const algorithmVersion = readString(
    bytes,
    offset,
    algorithmLength,
    declaredLength,
    "algorithm version",
  );
  offset += algorithmLength;
  ensureAvailable(offset, 2, declaredLength, "landmark count");
  const landmarkCount = view.getUint16(offset, true);
  offset += 2;

  const canonical: Readonly<DecodedMotionLandmark>[] = [];
  for (let index = 0; index < landmarkCount; index += 1) {
    ensureAvailable(offset, LANDMARK_BYTES, declaredLength, `landmark ${index}`);
    const source = decodeLandmarkSource(view.getUint8(offset));
    const flags = view.getUint8(offset + 1);
    offset += 2;
    const values = Array.from({ length: 6 }, () => {
      const value = view.getFloat32(offset, true);
      offset += 4;
      if (!Number.isFinite(value)) throw new Error(`MotionPacket landmark ${index} is non-finite`);
      return value;
    });
    const hasCoordinates = (flags & (1 << 1)) !== 0;
    const hasUncertainty = (flags & (1 << 2)) !== 0;
    canonical.push(Object.freeze({
      x: hasCoordinates ? values[0] : null,
      y: hasCoordinates ? values[1] : null,
      z: hasCoordinates ? values[2] : null,
      observationScore: values[3],
      canonicalConfidence: values[4],
      uncertainty: hasUncertainty ? values[5] : null,
      source,
      reason: decodeContinuityReason(flags >> 3),
      renderable: (flags & 1) !== 0,
    }));
  }

  let selectedCandidateId: bigint | null = null;
  let repPhase: MotionRepPhase = "ready";
  let partialAttempts = 0n;
  let activeRepId: bigint | null = null;
  let recoveredAcrossGap = false;
  let configVersion = "unspecified";
  let inferenceVersion = "unspecified";
  let diagnosticVersion = "unspecified";
  let activeProfileIdentity: string | null = null;
  let activeProfileHash: bigint | null = null;
  const completedReps: Readonly<DecodedSealedRep>[] = [];
  if (offset < declaredLength) {
    ensureAvailable(offset, 4, declaredLength, "rep extension marker");
    const marker = textDecoder.decode(bytes.subarray(offset, offset + 4));
    if (marker !== "RPS1") throw new Error(`Unknown MotionPacket minor extension ${marker}`);
    offset += 4;
    ensureAvailable(offset, 30, declaredLength, "rep extension header");
    const selectedPresent = view.getUint8(offset) !== 0;
    offset += 1;
    const selectedValue = view.getBigUint64(offset, true);
    offset += 8;
    selectedCandidateId = selectedPresent ? selectedValue : null;
    repPhase = decodeRepPhase(view.getUint8(offset));
    offset += 1;
    partialAttempts = view.getBigUint64(offset, true);
    offset += 8;
    const activePresent = view.getUint8(offset) !== 0;
    offset += 1;
    const activeValue = view.getBigUint64(offset, true);
    offset += 8;
    activeRepId = activePresent ? activeValue : null;
    recoveredAcrossGap = view.getUint8(offset) !== 0;
    offset += 1;
    const repCount = view.getUint16(offset, true);
    offset += 2;
    for (let index = 0; index < repCount; index += 1) {
      ensureAvailable(offset, 82, declaredLength, `sealed rep ${index}`);
      const values = Array.from({ length: 9 }, () => {
        const value = view.getBigUint64(offset, true);
        offset += 8;
        return value;
      });
      const revision = view.getUint32(offset, true);
      offset += 4;
      const maturity = view.getUint8(offset) === 0 ? "provisional" : "calibrated";
      offset += 1;
      const flags = view.getUint8(offset);
      offset += 1;
      const identityLength = view.getUint16(offset, true);
      offset += 2;
      const profileIdentity = readString(
        bytes,
        offset,
        identityLength,
        declaredLength,
        `sealed rep ${index} identity`,
      );
      offset += identityLength;
      ensureAvailable(offset, 2, declaredLength, `sealed rep ${index} verdict length`);
      const verdictLength = view.getUint16(offset, true);
      offset += 2;
      const verdict = readString(
        bytes,
        offset,
        verdictLength,
        declaredLength,
        `sealed rep ${index} verdict`,
      );
      offset += verdictLength;
      completedReps.push(Object.freeze({
        repId: values[0],
        startFrameId: values[1],
        startTimestampMs: values[2],
        peakFrameId: values[3],
        peakTimestampMs: values[4],
        endFrameId: values[5],
        endTimestampMs: values[6],
        canonicalSliceHash: values[7],
        profileHash: values[8],
        revision,
        profileMaturity: maturity,
        profileIdentity,
        qualityVerdict: (flags & 1) !== 0 ? verdict : null,
        recoveredAcrossGap: (flags & (1 << 1)) !== 0,
      }));
    }
    if (offset < declaredLength) {
      ensureAvailable(offset, 4, declaredLength, "version extension marker");
      const versionMarker = textDecoder.decode(bytes.subarray(offset, offset + 4));
      if (versionMarker !== "VER1") {
        throw new Error(`Unknown MotionPacket version extension ${versionMarker}`);
      }
      offset += 4;
      const readVersionString = (label: string) => {
        ensureAvailable(offset, 2, declaredLength, `${label} length`);
        const length = view.getUint16(offset, true);
        offset += 2;
        const value = readString(bytes, offset, length, declaredLength, label);
        offset += length;
        return value;
      };
      configVersion = readVersionString("config version");
      inferenceVersion = readVersionString("inference version");
      diagnosticVersion = readVersionString("diagnostic version");
      ensureAvailable(offset, 11, declaredLength, "active profile version");
      const profilePresent = view.getUint8(offset) !== 0;
      offset += 1;
      const profileHash = view.getBigUint64(offset, true);
      offset += 8;
      const identityLength = view.getUint16(offset, true);
      offset += 2;
      const profileIdentity = readString(
        bytes,
        offset,
        identityLength,
        declaredLength,
        "active profile identity",
      );
      offset += identityLength;
      if (profilePresent) {
        activeProfileIdentity = profileIdentity;
        activeProfileHash = profileHash;
      }
    }
  }

  return Object.freeze({
    lineage: Object.freeze({
      sequenceId,
      contract: Object.freeze({ major, minor }),
      algorithmVersion,
      configVersion,
      inferenceVersion,
      diagnosticVersion,
      activeProfileIdentity,
      activeProfileHash,
    }),
    frameId,
    sourceTimestampMs,
    subjectEpoch,
    target: Object.freeze({ state: targetState, candidateCount, selectedCandidateId }),
    canonical: Object.freeze(canonical),
    repState: Object.freeze({
      phase: repPhase,
      partialAttempts,
      activeRepId,
      recoveredAcrossGap,
    }),
    completedReps: Object.freeze(completedReps),
  });
}

function decodeContinuityReason(code: number): MotionContinuityReason | null {
  const reasons: readonly (MotionContinuityReason | null)[] = [
    null,
    "weak-observation-bone-fusion",
    "short-gap-prediction",
    "outlier-rejected-prediction",
    "outlier-rejected-unknown",
    "prediction-timeout",
    "no-measurement-baseline",
  ];
  const reason = reasons[code];
  if (reason === undefined) throw new Error(`Unknown MotionPacket continuity reason ${code}`);
  return reason;
}

function decodeRepPhase(code: number): MotionRepPhase {
  const phases: MotionRepPhase[] = ["ready", "effort", "peak", "return", "frozen"];
  const phase = phases[code];
  if (!phase) throw new Error(`Unknown MotionPacket rep phase ${code}`);
  return phase;
}

function ensureAvailable(offset: number, length: number, declared: number, label: string): void {
  if (offset < 0 || length < 0 || offset + length > declared) {
    throw new Error(`MotionPacket truncated ${label}`);
  }
}

function readString(
  bytes: Uint8Array,
  offset: number,
  length: number,
  declared: number,
  label: string,
): string {
  ensureAvailable(offset, length, declared, label);
  return textDecoder.decode(bytes.subarray(offset, offset + length));
}

function decodeTargetState(code: number): MotionTargetState {
  const states: MotionTargetState[] = [
    "acquiring",
    "locked",
    "uncertain",
    "lost",
    "reacquiring",
  ];
  const state = states[code];
  if (!state) throw new Error(`Unknown MotionPacket target state ${code}`);
  return state;
}

function decodeLandmarkSource(code: number): MotionLandmarkSource {
  const sources: MotionLandmarkSource[] = ["measured", "fused", "predicted", "unknown"];
  const source = sources[code];
  if (!source) throw new Error(`Unknown MotionPacket landmark source ${code}`);
  return source;
}
