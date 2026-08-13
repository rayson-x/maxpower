export const MOTION_PACKET_CONTRACT_MAJOR = 1;

export type MotionTargetState =
  | "acquiring"
  | "locked"
  | "uncertain"
  | "lost"
  | "reacquiring";

export type MotionLandmarkSource = "measured" | "fused" | "predicted" | "unknown";
export type MotionJointAngleKind = "elbow" | "shoulder" | "hip" | "knee";
export type MotionBodySide = "left" | "right";
export type MotionContinuityReason =
  | "weak-observation-bone-fusion"
  | "short-gap-prediction"
  | "outlier-rejected-prediction"
  | "outlier-rejected-unknown"
  | "prediction-timeout"
  | "no-measurement-baseline"
  | "equipment-path-constraint";
export type MotionRepPhase = "ready" | "effort" | "peak" | "return" | "frozen";
export type MotionSetLifecycle = "idle" | "arming" | "active" | "paused" | "finished";
export type MotionRepDisposition = "confirmed" | "needs_review" | "rejected";
export type MotionRepEvidenceReason =
  | "short_continuity_recovery"
  | "long_continuity_loss"
  | "subject_changed"
  | "incomplete_cycle"
  | "anti_interference_filter"
  | "duration_exceeded"
  | "required_joint_loss";
export type MotionRepObservationFinding =
  | "primary_range_below_expectation"
  | "secondary_range_below_expectation"
  | "cycle_faster_than_expected"
  | "equipment_primary_boundary"
  | "pose_equipment_turnaround_aligned"
  | "pose_unavailable_at_turnaround"
  | "pose_equipment_turnaround_conflict"
  | "equipment_path_coverage_low";
export type MotionEquipmentKind =
  | "weight_plate"
  | "barbell_shaft"
  | "dumbbell"
  | "machine_handle";
export type MotionEquipmentSource = "detector" | "optical_flow" | "geometry" | "predicted";
export type MotionEquipmentHand = "left" | "right" | "both" | "unknown";
export type MotionEquipmentCannotJudgeReason =
  | "no_locked_subject"
  | "no_equipment_observation"
  | "timestamp_not_monotonic"
  | "low_confidence_or_invalid"
  | "reflection_or_static_only"
  | "outside_locked_subject";
export type MotionAssessmentCapability =
  | "quality_supported"
  | "phase_supported"
  | "observation_only"
  | "unsupported";
export type MotionEndpointKind = "start_anchor" | "primary_turnaround" | "end_return";
export type MotionEvidenceChannel = "pose_measured" | "equipment_measured";
export type MotionAssessmentDimension =
  | "task_completion"
  | "range_of_motion"
  | "phase_control"
  | "support_stability"
  | "bilateral_coordination"
  | "trajectory_control"
  | "standard_variant_compatibility"
  | "observation_confidence";
export type MotionQualityConclusionState =
  | "observed_acceptable"
  | "observed_deviation"
  | "cannot_judge"
  | "not_applicable";

export interface DecodedRepEndpointSnapshot {
  readonly kind: MotionEndpointKind;
  readonly occurredFrameId: number;
  readonly occurredTimestampMs: number;
  readonly causalConfirmedTimestampMs: number;
  readonly phaseBefore: string;
  readonly phaseAfter: string;
  readonly confidence: number;
  readonly evidenceChannels: readonly MotionEvidenceChannel[];
}

export interface DecodedQualityConclusion {
  readonly conclusionId: string;
  readonly dimension: MotionAssessmentDimension;
  readonly state: MotionQualityConclusionState;
  readonly summary: string;
  readonly evidence: readonly string[];
  readonly reason: string | null;
  readonly confidence: number;
}

export interface DecodedRustQualityProposal {
  readonly schemaVersion: string;
  readonly proposalId: string;
  readonly repId: number;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly anatomicalSide: "left" | "right" | null;
  readonly equipmentRole: string;
  readonly capability: MotionAssessmentCapability;
  readonly ruleBundleVersion: string;
  readonly profileIdentity: string;
  readonly profileHash: string;
  readonly canonicalSliceHash: string;
  readonly endpoints: readonly Readonly<DecodedRepEndpointSnapshot>[];
  readonly conclusions: readonly Readonly<DecodedQualityConclusion>[];
  readonly contentHash: string;
}

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
  readonly disposition: MotionRepDisposition;
  readonly evidenceReason: MotionRepEvidenceReason | null;
  readonly observationFindings: readonly MotionRepObservationFinding[];
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

export interface DecodedJointAngle {
  readonly kind: MotionJointAngleKind;
  readonly side: MotionBodySide;
  readonly valueDeg: number | null;
  readonly confidence: number;
  readonly source: MotionLandmarkSource;
  readonly judgeable: boolean;
}

export interface DecodedEquipmentTrack {
  readonly trackId: bigint;
  readonly proposalId: bigint;
  readonly subjectCandidateId: bigint;
  readonly kind: MotionEquipmentKind;
  readonly bbox: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly centerX: number;
  readonly centerY: number;
  readonly observationScore: number;
  readonly associationConfidence: number;
  readonly uncertaintyPx: number | null;
  readonly source: MotionEquipmentSource;
  readonly heldBy: MotionEquipmentHand;
  readonly judgeablePath: boolean;
}

export interface DecodedEquipmentEvidence {
  readonly status: Readonly<{
    kind: "observed" | "cannot_judge";
    reason: MotionEquipmentCannotJudgeReason | null;
  }>;
  readonly subjectCandidateId: bigint | null;
  readonly tracks: readonly Readonly<DecodedEquipmentTrack>[];
  readonly rejectedReflectionCount: number;
  readonly rejectedStaticCount: number;
  readonly rejectedLowConfidenceOrInvalidCount: number;
  readonly rejectedOutsideSubjectCount: number;
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
  readonly jointAngles: readonly Readonly<DecodedJointAngle>[];
  readonly equipment: Readonly<DecodedEquipmentEvidence>;
  readonly setState: Readonly<{
    lifecycle: MotionSetLifecycle;
  }>;
  readonly repState: Readonly<{
    phase: MotionRepPhase;
    partialAttempts: bigint;
    activeRepId: bigint | null;
    recoveredAcrossGap: boolean;
  }>;
  readonly completedReps: readonly Readonly<DecodedSealedRep>[];
  readonly qualityProposals: readonly Readonly<DecodedRustQualityProposal>[];
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
  let setLifecycle: MotionSetLifecycle = "idle";
  let configVersion = "unspecified";
  let inferenceVersion = "unspecified";
  let diagnosticVersion = "unspecified";
  let activeProfileIdentity: string | null = null;
  let activeProfileHash: bigint | null = null;
  const completedReps: Readonly<DecodedSealedRep>[] = [];
  const jointAngles: Readonly<DecodedJointAngle>[] = [];
  let qualityProposals: readonly Readonly<DecodedRustQualityProposal>[] = [];
  let equipment: Readonly<DecodedEquipmentEvidence> = Object.freeze({
    status: Object.freeze({
      kind: "cannot_judge" as const,
      reason: "no_equipment_observation" as const,
    }),
    subjectCandidateId: null,
    tracks: Object.freeze([] as Readonly<DecodedEquipmentTrack>[]),
    rejectedReflectionCount: 0,
    rejectedStaticCount: 0,
    rejectedLowConfidenceOrInvalidCount: 0,
    rejectedOutsideSubjectCount: 0,
  });
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
    // v1.4 adds the immutable candidate disposition and evidence byte. v1.5
    // adds profile-relative observations without changing the immutable
    // boundary object. Keep
    // v1.0-v1.3 RPS1 recordings replayable: their historical sealed reps
    // were all formal confirmations because no candidate vocabulary existed.
    const hasCandidateDisposition = minor >= 4;
    const hasObservationFindings = minor >= 5;
    for (let index = 0; index < repCount; index += 1) {
      ensureAvailable(
        offset,
        hasCandidateDisposition ? (hasObservationFindings ? 84 : 83) : 82,
        declaredLength,
        `sealed rep ${index}`,
      );
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
      const evidenceReason = hasCandidateDisposition
        ? decodeRepEvidenceReason(view.getUint8(offset))
        : null;
      if (hasCandidateDisposition) offset += 1;
      const observationFindings = hasObservationFindings
        ? decodeRepObservationFindings(view.getUint8(offset))
        : Object.freeze([] as MotionRepObservationFinding[]);
      if (hasObservationFindings) offset += 1;
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
        disposition: hasCandidateDisposition ? decodeRepDisposition((flags >> 2) & 0b11) : "confirmed",
        evidenceReason,
        observationFindings,
      }));
    }
    if (offset < declaredLength) {
      ensureAvailable(offset, 4, declaredLength, "set extension marker");
      const marker = textDecoder.decode(bytes.subarray(offset, offset + 4));
      if (marker === "SET1") {
        offset += 4;
        ensureAvailable(offset, 1, declaredLength, "set lifecycle");
        setLifecycle = decodeSetLifecycle(view.getUint8(offset));
        offset += 1;
      } else if (marker !== "VER1") {
        throw new Error(`Unknown MotionPacket minor extension ${marker}`);
      }
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
    if (offset < declaredLength && minor >= 6) {
      ensureAvailable(offset, 5, declaredLength, "joint angle extension");
      const angleMarker = textDecoder.decode(bytes.subarray(offset, offset + 4));
      if (angleMarker !== "ANG1") {
        throw new Error(`Unknown MotionPacket joint angle extension ${angleMarker}`);
      }
      offset += 4;
      const angleCount = view.getUint8(offset);
      offset += 1;
      for (let index = 0; index < angleCount; index += 1) {
        ensureAvailable(offset, 12, declaredLength, `joint angle ${index}`);
        const kind = decodeJointAngleKind(view.getUint8(offset));
        const side = decodeBodySide(view.getUint8(offset + 1));
        const source = decodeLandmarkSource(view.getUint8(offset + 2));
        const flags = view.getUint8(offset + 3);
        const value = view.getFloat32(offset + 4, true);
        const confidence = view.getFloat32(offset + 8, true);
        offset += 12;
        if (!Number.isFinite(value) || !Number.isFinite(confidence)) {
          throw new Error(`MotionPacket joint angle ${index} is non-finite`);
        }
        jointAngles.push(Object.freeze({
          kind,
          side,
          valueDeg: (flags & 1) !== 0 ? value : null,
          confidence,
          source,
          judgeable: (flags & (1 << 1)) !== 0,
        }));
      }
    }
    if (minor >= 7) {
      ensureAvailable(offset, 25, declaredLength, "equipment extension");
      const equipmentMarker = textDecoder.decode(bytes.subarray(offset, offset + 4));
      if (equipmentMarker !== "EQP1") {
        throw new Error(`Unknown MotionPacket equipment extension ${equipmentMarker}`);
      }
      offset += 4;
      const statusCode = view.getUint8(offset);
      const reasonCode = view.getUint8(offset + 1);
      const subjectPresent = view.getUint8(offset + 2) !== 0;
      offset += 3;
      const equipmentSubjectId = view.getBigUint64(offset, true);
      offset += 8;
      const rejectedReflectionCount = view.getUint16(offset, true);
      offset += 2;
      const rejectedStaticCount = view.getUint16(offset, true);
      offset += 2;
      const rejectedLowConfidenceOrInvalidCount = view.getUint16(offset, true);
      offset += 2;
      const rejectedOutsideSubjectCount = view.getUint16(offset, true);
      offset += 2;
      const trackCount = view.getUint16(offset, true);
      offset += 2;
      const tracks: Readonly<DecodedEquipmentTrack>[] = [];
      for (let index = 0; index < trackCount; index += 1) {
        ensureAvailable(offset, 64, declaredLength, `equipment track ${index}`);
        const trackId = view.getBigUint64(offset, true);
        offset += 8;
        const proposalId = view.getBigUint64(offset, true);
        offset += 8;
        const subjectCandidateId = view.getBigUint64(offset, true);
        offset += 8;
        const kind = decodeEquipmentKind(view.getUint8(offset));
        const source = decodeEquipmentSource(view.getUint8(offset + 1));
        const heldBy = decodeEquipmentHand(view.getUint8(offset + 2));
        const flags = view.getUint8(offset + 3);
        offset += 4;
        if ((flags & ~0b11) !== 0) {
          throw new Error(`MotionPacket equipment track ${index} flags are invalid`);
        }
        const values = Array.from({ length: 9 }, () => {
          const value = view.getFloat32(offset, true);
          offset += 4;
          if (!Number.isFinite(value)) {
            throw new Error(`MotionPacket equipment track ${index} is non-finite`);
          }
          return value;
        });
        tracks.push(Object.freeze({
          trackId,
          proposalId,
          subjectCandidateId,
          kind,
          bbox: Object.freeze({
            x: values[0],
            y: values[1],
            width: values[2],
            height: values[3],
          }),
          centerX: values[4],
          centerY: values[5],
          observationScore: values[6],
          associationConfidence: values[7],
          uncertaintyPx: (flags & (1 << 1)) !== 0 ? values[8] : null,
          source,
          heldBy,
          judgeablePath: (flags & 1) !== 0,
        }));
      }
      equipment = Object.freeze({
        status: decodeEquipmentStatus(statusCode, reasonCode),
        subjectCandidateId: subjectPresent ? equipmentSubjectId : null,
        tracks: Object.freeze(tracks),
        rejectedReflectionCount,
        rejectedStaticCount,
        rejectedLowConfidenceOrInvalidCount,
        rejectedOutsideSubjectCount,
      });
    }
    if (minor >= 8) {
      ensureAvailable(offset, 8, declaredLength, "quality extension");
      const qualityMarker = textDecoder.decode(bytes.subarray(offset, offset + 4));
      if (qualityMarker !== "QLT1") {
        throw new Error(`Unknown MotionPacket quality extension ${qualityMarker}`);
      }
      offset += 4;
      const qualityLength = view.getUint32(offset, true);
      offset += 4;
      if (qualityLength > 1_048_576) {
        throw new Error("MotionPacket quality payload exceeds 1 MiB");
      }
      ensureAvailable(offset, qualityLength, declaredLength, "quality payload");
      let decoded: unknown;
      try {
        decoded = JSON.parse(textDecoder.decode(bytes.subarray(offset, offset + qualityLength)));
      } catch {
        throw new Error("MotionPacket quality payload is invalid UTF-8 or JSON");
      }
      offset += qualityLength;
      qualityProposals = decodeQualityExtension(decoded);
    }
    if (offset !== declaredLength) {
      throw new Error("MotionPacket has trailing or malformed extension bytes");
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
    jointAngles: Object.freeze(jointAngles),
    equipment,
    setState: Object.freeze({ lifecycle: setLifecycle }),
    repState: Object.freeze({
      phase: repPhase,
      partialAttempts,
      activeRepId,
      recoveredAcrossGap,
    }),
    completedReps: Object.freeze(completedReps),
    qualityProposals: Object.freeze(qualityProposals),
  });
}

const QUALITY_DIMENSIONS: readonly MotionAssessmentDimension[] = Object.freeze([
  "task_completion",
  "range_of_motion",
  "phase_control",
  "support_stability",
  "bilateral_coordination",
  "trajectory_control",
  "standard_variant_compatibility",
  "observation_confidence",
]);

function decodeQualityExtension(value: unknown): readonly Readonly<DecodedRustQualityProposal>[] {
  const extension = requireRecord(value, "quality extension");
  if (extension.schemaVersion !== "maxpower.motion-quality-proposal/v1") {
    throw new Error("MotionPacket quality schema version is unsupported");
  }
  if (!Array.isArray(extension.proposals)) {
    throw new Error("MotionPacket quality proposals must be an array");
  }
  return Object.freeze(extension.proposals.map((raw, index) => decodeQualityProposal(raw, index)));
}

function decodeQualityProposal(value: unknown, index: number): Readonly<DecodedRustQualityProposal> {
  const proposal = requireRecord(value, `quality proposal ${index}`);
  const endpoints = requireArray(proposal.endpoints, `quality proposal ${index} endpoints`)
    .map((endpoint, endpointIndex) => decodeQualityEndpoint(endpoint, index, endpointIndex));
  const expectedEndpoints: readonly MotionEndpointKind[] = [
    "start_anchor", "primary_turnaround", "end_return",
  ];
  if (endpoints.length !== expectedEndpoints.length
      || endpoints.some((endpoint, endpointIndex) => endpoint.kind !== expectedEndpoints[endpointIndex])) {
    throw new Error(`MotionPacket quality proposal ${index} must contain ordered three endpoints`);
  }
  const conclusions = requireArray(
    proposal.conclusions,
    `quality proposal ${index} conclusions`,
  ).map((conclusion, conclusionIndex) => decodeQualityConclusion(conclusion, index, conclusionIndex));
  const dimensions = new Set(conclusions.map((conclusion) => conclusion.dimension));
  if (conclusions.length !== QUALITY_DIMENSIONS.length
      || QUALITY_DIMENSIONS.some((dimension) => !dimensions.has(dimension))) {
    throw new Error(`MotionPacket quality proposal ${index} is missing a required dimension`);
  }
  return Object.freeze({
    schemaVersion: requireString(proposal.schemaVersion, "quality proposal schemaVersion"),
    proposalId: requireString(proposal.proposalId, "quality proposal proposalId"),
    repId: requireSafeInteger(proposal.repId, "quality proposal repId"),
    actionId: requireString(proposal.actionId, "quality proposal actionId"),
    capturePosition: requireString(proposal.capturePosition, "quality proposal capturePosition"),
    anatomicalSide: proposal.anatomicalSide == null
      ? null
      : requireEnum(
        proposal.anatomicalSide,
        ["left", "right"] as const,
        "quality proposal anatomicalSide",
      ),
    equipmentRole: requireString(proposal.equipmentRole, "quality proposal equipmentRole"),
    capability: requireEnum(
      proposal.capability,
      ["quality_supported", "phase_supported", "observation_only", "unsupported"] as const,
      "quality proposal capability",
    ),
    ruleBundleVersion: requireString(
      proposal.ruleBundleVersion,
      "quality proposal ruleBundleVersion",
    ),
    profileIdentity: requireString(proposal.profileIdentity, "quality proposal profileIdentity"),
    profileHash: requireHash(proposal.profileHash, "quality proposal profileHash"),
    canonicalSliceHash: requireHash(
      proposal.canonicalSliceHash,
      "quality proposal canonicalSliceHash",
    ),
    endpoints: Object.freeze(endpoints),
    conclusions: Object.freeze(conclusions),
    contentHash: requireHash(proposal.contentHash, "quality proposal contentHash"),
  });
}

function decodeQualityEndpoint(
  value: unknown,
  proposalIndex: number,
  endpointIndex: number,
): Readonly<DecodedRepEndpointSnapshot> {
  const label = `quality proposal ${proposalIndex} endpoint ${endpointIndex}`;
  const endpoint = requireRecord(value, label);
  const occurredTimestampMs = requireSafeInteger(
    endpoint.occurredTimestampMs,
    `${label} occurredTimestampMs`,
  );
  const causalConfirmedTimestampMs = requireSafeInteger(
    endpoint.causalConfirmedTimestampMs,
    `${label} causalConfirmedTimestampMs`,
  );
  if (causalConfirmedTimestampMs < occurredTimestampMs) {
    throw new Error(`${label} confirmation precedes occurrence`);
  }
  return Object.freeze({
    kind: requireEnum(
      endpoint.kind,
      ["start_anchor", "primary_turnaround", "end_return"] as const,
      `${label} kind`,
    ),
    occurredFrameId: requireSafeInteger(endpoint.occurredFrameId, `${label} occurredFrameId`),
    occurredTimestampMs,
    causalConfirmedTimestampMs,
    phaseBefore: requireString(endpoint.phaseBefore, `${label} phaseBefore`),
    phaseAfter: requireString(endpoint.phaseAfter, `${label} phaseAfter`),
    confidence: requireConfidence(endpoint.confidence, `${label} confidence`),
    evidenceChannels: Object.freeze(requireArray(
      endpoint.evidenceChannels,
      `${label} evidenceChannels`,
    ).map((channel) => requireEnum(
      channel,
      ["pose_measured", "equipment_measured"] as const,
      `${label} evidence channel`,
    ))),
  });
}

function decodeQualityConclusion(
  value: unknown,
  proposalIndex: number,
  conclusionIndex: number,
): Readonly<DecodedQualityConclusion> {
  const label = `quality proposal ${proposalIndex} conclusion ${conclusionIndex}`;
  const conclusion = requireRecord(value, label);
  const state = requireEnum(
    conclusion.state,
    ["observed_acceptable", "observed_deviation", "cannot_judge", "not_applicable"] as const,
    `${label} state`,
  );
  const reason = conclusion.reason === null
    ? null
    : requireString(conclusion.reason, `${label} reason`);
  if (state === "cannot_judge" && !reason?.trim()) {
    throw new Error(`${label} cannot_judge requires a reason`);
  }
  return Object.freeze({
    conclusionId: requireString(conclusion.conclusionId, `${label} conclusionId`),
    dimension: requireEnum(
      conclusion.dimension,
      QUALITY_DIMENSIONS,
      `${label} dimension`,
    ),
    state,
    summary: requireString(conclusion.summary, `${label} summary`),
    evidence: Object.freeze(requireArray(conclusion.evidence, `${label} evidence`)
      .map((item) => requireString(item, `${label} evidence item`))),
    reason,
    confidence: requireConfidence(conclusion.confidence, `${label} confidence`),
  });
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`MotionPacket ${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`MotionPacket ${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`MotionPacket ${label} must be a string`);
  return value;
}

function requireSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`MotionPacket ${label} must be a non-negative safe integer`);
  }
  return value;
}

function requireConfidence(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`MotionPacket ${label} must be between zero and one`);
  }
  return value;
}

function requireHash(value: unknown, label: string): string {
  const hash = requireString(value, label);
  if (!/^[0-9a-f]{16}$/.test(hash)) {
    throw new Error(`MotionPacket ${label} must be lower-case 64-bit hex`);
  }
  return hash;
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`MotionPacket ${label} is invalid`);
  }
  return value as T[number];
}

function decodeEquipmentStatus(
  statusCode: number,
  reasonCode: number,
): Readonly<DecodedEquipmentEvidence["status"]> {
  if (statusCode === 0) {
    if (reasonCode !== 0) throw new Error(`Observed equipment has reason code ${reasonCode}`);
    return Object.freeze({ kind: "observed", reason: null });
  }
  if (statusCode !== 1) throw new Error(`Unknown MotionPacket equipment status ${statusCode}`);
  return Object.freeze({ kind: "cannot_judge", reason: decodeEquipmentReason(reasonCode) });
}

function decodeEquipmentReason(code: number): MotionEquipmentCannotJudgeReason {
  const reasons: readonly (MotionEquipmentCannotJudgeReason | null)[] = [
    null,
    "no_locked_subject",
    "no_equipment_observation",
    "timestamp_not_monotonic",
    "low_confidence_or_invalid",
    "reflection_or_static_only",
    "outside_locked_subject",
  ];
  const reason = reasons[code];
  if (!reason) throw new Error(`Unknown MotionPacket equipment reason ${code}`);
  return reason;
}

function decodeEquipmentKind(code: number): MotionEquipmentKind {
  const kinds: readonly MotionEquipmentKind[] = [
    "weight_plate",
    "barbell_shaft",
    "dumbbell",
    "machine_handle",
  ];
  const kind = kinds[code];
  if (!kind) throw new Error(`Unknown MotionPacket equipment kind ${code}`);
  return kind;
}

function decodeEquipmentSource(code: number): MotionEquipmentSource {
  const sources: readonly MotionEquipmentSource[] = [
    "detector",
    "optical_flow",
    "geometry",
    "predicted",
  ];
  const source = sources[code];
  if (!source) throw new Error(`Unknown MotionPacket equipment source ${code}`);
  return source;
}

function decodeEquipmentHand(code: number): MotionEquipmentHand {
  const hands: readonly MotionEquipmentHand[] = ["left", "right", "both", "unknown"];
  const hand = hands[code];
  if (!hand) throw new Error(`Unknown MotionPacket equipment hand ${code}`);
  return hand;
}

function decodeJointAngleKind(code: number): MotionJointAngleKind {
  const kind: MotionJointAngleKind | undefined = ["elbow", "shoulder", "hip", "knee"][code] as
    | MotionJointAngleKind
    | undefined;
  if (!kind) throw new Error(`Unknown MotionPacket joint angle kind ${code}`);
  return kind;
}

function decodeBodySide(code: number): MotionBodySide {
  if (code === 0) return "left";
  if (code === 1) return "right";
  throw new Error(`Unknown MotionPacket body side ${code}`);
}

function decodeRepDisposition(code: number): MotionRepDisposition {
  switch (code) {
    case 0: return "confirmed";
    case 1: return "needs_review";
    case 2: return "rejected";
    default: throw new Error(`MotionPacket rep disposition code ${code} is invalid`);
  }
}

function decodeRepEvidenceReason(code: number): MotionRepEvidenceReason | null {
  switch (code) {
    case 0: return null;
    case 1: return "short_continuity_recovery";
    case 2: return "long_continuity_loss";
    case 3: return "subject_changed";
    case 4: return "incomplete_cycle";
    case 5: return "anti_interference_filter";
    case 6: return "duration_exceeded";
    case 7: return "required_joint_loss";
    default: throw new Error(`MotionPacket rep evidence reason code ${code} is invalid`);
  }
}

function decodeRepObservationFindings(flags: number): readonly MotionRepObservationFinding[] {
  const findings: MotionRepObservationFinding[] = [];
  if ((flags & (1 << 0)) !== 0) findings.push("primary_range_below_expectation");
  if ((flags & (1 << 1)) !== 0) findings.push("secondary_range_below_expectation");
  if ((flags & (1 << 2)) !== 0) findings.push("cycle_faster_than_expected");
  if ((flags & (1 << 3)) !== 0) findings.push("equipment_primary_boundary");
  if ((flags & (1 << 4)) !== 0) findings.push("pose_equipment_turnaround_aligned");
  if ((flags & (1 << 5)) !== 0) findings.push("pose_unavailable_at_turnaround");
  if ((flags & (1 << 6)) !== 0) findings.push("pose_equipment_turnaround_conflict");
  if ((flags & (1 << 7)) !== 0) findings.push("equipment_path_coverage_low");
  return Object.freeze(findings);
}

function decodeSetLifecycle(code: number): MotionSetLifecycle {
  switch (code) {
    case 0: return "idle";
    case 1: return "arming";
    case 2: return "active";
    case 3: return "paused";
    case 4: return "finished";
    default: throw new Error(`MotionPacket set lifecycle code ${code} is invalid`);
  }
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
    "equipment-path-constraint",
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
