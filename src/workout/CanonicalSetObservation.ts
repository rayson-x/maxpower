import type { SetObservationData } from "../coach/domain";
import {
  MOTION_PACKET_CONTRACT_MAJOR,
  isDecodedRustMotionPacket,
  type DecodedMotionPacket,
} from "../motion/motionPacket";

export interface CanonicalSetObservationContext {
  workoutId: string;
  setId: string;
  exerciseVariantId: string;
  capabilityIdentity?: string;
}

export interface CanonicalCaptureTelemetry {
  processedFrames: number;
  validFrames: number;
}

export interface CanonicalSetObservationInput {
  context: CanonicalSetObservationContext;
  packets: readonly DecodedMotionPacket[];
  telemetry: CanonicalCaptureTelemetry;
  observedAt: string;
}

/**
 * Projects dispositions already sealed by Rust. This module never infers a
 * phase or counts motion; it only selects the latest immutable rep revision.
 */
export function buildCanonicalSetObservation(input: CanonicalSetObservationInput): SetObservationData {
  assertDecodedRustPackets(input.packets);
  const reps = latestSealedReps(input.packets).map(({ id, rep }) => ({
    id,
    revision: rep.revision,
    disposition: rep.disposition,
    findings: [...rep.observationFindings],
    canonicalSliceHash: bigintHex(rep.canonicalSliceHash),
    profileIdentity: rep.profileIdentity,
    profileHash: bigintHex(rep.profileHash),
  }));
  assertProfileLineage(input.context.capabilityIdentity, input.packets, reps);

  const cannotJudgeReason = canonicalCannotJudgeReason(input);
  const unique = (values: readonly string[]) => [...new Set(values)];
  const last = input.packets.at(-1)!;
  const observation: SetObservationData = {
    id: `set-observation:${input.context.workoutId}:${input.context.setId}:${last.lineage.sequenceId}`,
    prescriptionSetId: input.context.setId,
    exerciseVariantId: input.context.exerciseVariantId,
    source: "rust_canonical_packet",
    observedAt: input.observedAt,
    ...(input.context.capabilityIdentity ? { capabilityIdentity: input.context.capabilityIdentity } : {}),
    judgement: cannotJudgeReason ? "cannot_judge" : "observed",
    ...(cannotJudgeReason ? { cannotJudgeReason } : {}),
    counts: {
      confirmed: reps.filter((rep) => rep.disposition === "confirmed").length,
      needsReview: reps.filter((rep) => rep.disposition === "needs_review").length,
      rejected: reps.filter((rep) => rep.disposition === "rejected").length,
    },
    reps,
    lineage: {
      sequenceIds: unique(input.packets.map((packet) => packet.lineage.sequenceId)),
      contractVersions: unique(input.packets.map((packet) => `${packet.lineage.contract.major}.${packet.lineage.contract.minor}`)),
      algorithmVersions: unique(input.packets.map((packet) => packet.lineage.algorithmVersion)),
      configVersions: unique(input.packets.map((packet) => packet.lineage.configVersion)),
      inferenceVersions: unique(input.packets.map((packet) => packet.lineage.inferenceVersion)),
      sourceFrameIds: unique(input.packets.map((packet) => packet.frameId.toString())),
      canonicalSliceHashes: unique(reps.map((rep) => rep.canonicalSliceHash)),
    },
  };
  assertCanonicalSetObservation(observation, input);
  return observation;
}

/** Strict runtime validation used by CoachApplication before ledger commit. */
export function assertCanonicalSetObservation(
  observation: SetObservationData,
  input: CanonicalSetObservationInput,
): void {
  assertDecodedRustPackets(input.packets);
  const expected = canonicalProjectionForValidation(input);
  if (JSON.stringify(observation) !== JSON.stringify(expected)) {
    throw new Error("canonical_observation_projection_mismatch");
  }
}

function canonicalProjectionForValidation(input: CanonicalSetObservationInput): SetObservationData {
  const reps = latestSealedReps(input.packets).map(({ id, rep }) => ({
    id,
    revision: rep.revision,
    disposition: rep.disposition,
    findings: [...rep.observationFindings],
    canonicalSliceHash: bigintHex(rep.canonicalSliceHash),
    profileIdentity: rep.profileIdentity,
    profileHash: bigintHex(rep.profileHash),
  }));
  assertProfileLineage(input.context.capabilityIdentity, input.packets, reps);
  const cannotJudgeReason = canonicalCannotJudgeReason(input);
  const unique = (values: readonly string[]) => [...new Set(values)];
  const last = input.packets.at(-1)!;
  return {
    id: `set-observation:${input.context.workoutId}:${input.context.setId}:${last.lineage.sequenceId}`,
    prescriptionSetId: input.context.setId,
    exerciseVariantId: input.context.exerciseVariantId,
    source: "rust_canonical_packet",
    observedAt: input.observedAt,
    ...(input.context.capabilityIdentity ? { capabilityIdentity: input.context.capabilityIdentity } : {}),
    judgement: cannotJudgeReason ? "cannot_judge" : "observed",
    ...(cannotJudgeReason ? { cannotJudgeReason } : {}),
    counts: {
      confirmed: reps.filter((rep) => rep.disposition === "confirmed").length,
      needsReview: reps.filter((rep) => rep.disposition === "needs_review").length,
      rejected: reps.filter((rep) => rep.disposition === "rejected").length,
    },
    reps,
    lineage: {
      sequenceIds: unique(input.packets.map((packet) => packet.lineage.sequenceId)),
      contractVersions: unique(input.packets.map((packet) => `${packet.lineage.contract.major}.${packet.lineage.contract.minor}`)),
      algorithmVersions: unique(input.packets.map((packet) => packet.lineage.algorithmVersion)),
      configVersions: unique(input.packets.map((packet) => packet.lineage.configVersion)),
      inferenceVersions: unique(input.packets.map((packet) => packet.lineage.inferenceVersion)),
      sourceFrameIds: unique(input.packets.map((packet) => packet.frameId.toString())),
      canonicalSliceHashes: unique(reps.map((rep) => rep.canonicalSliceHash)),
    },
  };
}

function assertDecodedRustPackets(packets: readonly DecodedMotionPacket[]): void {
  if (!packets.length) throw new Error("canonical_packets_required");
  const lineageSignatures = new Set<string>();
  let previousTimestamp: bigint | undefined;
  for (const packet of packets) {
    if (
      !isDecodedRustMotionPacket(packet)
      || !Object.isFrozen(packet)
      || !Object.isFrozen(packet.lineage)
      || !Object.isFrozen(packet.completedReps)
      || packet.lineage.contract.major !== MOTION_PACKET_CONTRACT_MAJOR
      || !packet.lineage.sequenceId
      || !packet.lineage.algorithmVersion
    ) throw new Error("untrusted_canonical_packet");
    lineageSignatures.add([
      packet.lineage.sequenceId,
      packet.lineage.contract.major,
      packet.lineage.contract.minor,
      packet.lineage.algorithmVersion,
      packet.lineage.configVersion,
      packet.lineage.inferenceVersion,
    ].join("|"));
    if (previousTimestamp !== undefined && packet.sourceTimestampMs < previousTimestamp) {
      throw new Error("canonical_packet_lineage_not_monotonic");
    }
    previousTimestamp = packet.sourceTimestampMs;
    for (const rep of packet.completedReps) {
      if (
        !Object.isFrozen(rep)
        || !rep.profileIdentity
        || rep.canonicalSliceHash <= 0n
        || rep.profileHash <= 0n
        || !["confirmed", "needs_review", "rejected"].includes(rep.disposition)
      ) throw new Error("invalid_sealed_rep_lineage");
    }
  }
  if (lineageSignatures.size !== 1) throw new Error("canonical_packet_lineage_mismatch");
}

function assertProfileLineage(
  capabilityIdentity: string | undefined,
  packets: readonly DecodedMotionPacket[],
  reps: readonly { profileIdentity: string; profileHash: string }[],
): void {
  if (!capabilityIdentity) throw new Error("exact_capability_identity_required");
  if (reps.some((rep) => rep.profileIdentity !== capabilityIdentity)) {
    throw new Error("canonical_profile_identity_mismatch");
  }
  for (const packet of packets) {
    const activeIdentity = packet.lineage.activeProfileIdentity;
    if (activeIdentity && activeIdentity !== capabilityIdentity) {
      throw new Error("canonical_profile_identity_mismatch");
    }
    const activeHash = packet.lineage.activeProfileHash;
    if (activeHash !== null && reps.length && reps.some((rep) => rep.profileHash !== bigintHex(activeHash))) {
      throw new Error("canonical_profile_hash_mismatch");
    }
  }
}

function canonicalCannotJudgeReason(input: CanonicalSetObservationInput): SetObservationData["cannotJudgeReason"] {
  if (input.telemetry.validFrames <= 0) return "no_valid_frames";
  if (!input.packets.some((packet) => packet.target.state === "locked")) return "target_not_locked";
  const canonical = input.packets.flatMap((packet) => packet.canonical);
  if (!canonical.length || canonical.every((landmark) => landmark.source === "unknown")) {
    return "canonical_producer_unknown";
  }
  return undefined;
}

function latestSealedReps(packets: readonly DecodedMotionPacket[]) {
  const latest = new Map<string, { id: string; rep: DecodedMotionPacket["completedReps"][number] }>();
  for (const packet of packets) {
    for (const rep of packet.completedReps) {
      const id = `${packet.subjectEpoch.toString()}:${rep.repId.toString()}`;
      const previous = latest.get(id);
      if (!previous || previous.rep.revision < rep.revision) latest.set(id, { id, rep });
    }
  }
  return [...latest.values()];
}

function bigintHex(value: bigint): string {
  return `0x${value.toString(16).padStart(16, "0")}`;
}
