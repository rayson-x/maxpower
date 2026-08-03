import type { CanonicalPoseFrame } from "../pose/canonicalPose";
import type {
  RustRepState,
  RustReferenceComparisonUnavailable,
  RustSealedRep,
  RustTargetSnapshot,
} from "./rustCanonicalWasm";
import type { DecodedMotionPacket } from "./motionPacket";

export interface WebMotionPacket {
  readonly canonical: CanonicalPoseFrame;
  readonly canonicalContentHash: bigint;
  readonly target: RustTargetSnapshot | null;
  readonly repState: RustRepState | null;
  readonly completedReps: readonly RustSealedRep[];
  /** The once-decoded binary packet emitted by Rust; null only in diagnostic TS shadow mode. */
  readonly rustPacket: DecodedMotionPacket | null;
  readonly referenceComparison: RustReferenceComparisonUnavailable;
}

export interface WebMotionPacketConsumers {
  render(packet: WebMotionPacket): void;
  count(packet: WebMotionPacket): void;
  record(packet: WebMotionPacket): void;
  analyze(packet: WebMotionPacket): void;
}

export function createWebMotionPacket(input: WebMotionPacket): WebMotionPacket {
  return Object.freeze({
    ...input,
    completedReps: Object.freeze([...input.completedReps]),
  });
}

/** One immutable packet instance is synchronously published to every product consumer. */
export function routeWebMotionPacket(
  packet: WebMotionPacket,
  consumers: WebMotionPacketConsumers,
): void {
  consumers.render(packet);
  consumers.count(packet);
  consumers.record(packet);
  consumers.analyze(packet);
}
