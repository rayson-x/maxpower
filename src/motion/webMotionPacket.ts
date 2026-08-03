import type { CanonicalPoseFrame } from "../pose/canonicalPose";
import type {
  RustRepState,
  RustReferenceComparison,
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
  readonly referenceComparison: RustReferenceComparison;
}

export interface WebMotionPacketConsumers {
  render(packet: WebMotionPacket): void;
  count(packet: WebMotionPacket): void;
  record(packet: WebMotionPacket): void;
  analyze(packet: WebMotionPacket): void;
}

export interface WebMotionRouteTiming {
  readonly renderMs: number;
  readonly countMs: number;
  readonly recordMs: number;
  readonly analyzeMs: number;
  readonly totalMs: number;
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
): WebMotionRouteTiming {
  const routeStartedAt = performance.now();
  let stageStartedAt = routeStartedAt;
  consumers.render(packet);
  const renderMs = performance.now() - stageStartedAt;
  stageStartedAt = performance.now();
  consumers.count(packet);
  const countMs = performance.now() - stageStartedAt;
  stageStartedAt = performance.now();
  consumers.record(packet);
  const recordMs = performance.now() - stageStartedAt;
  stageStartedAt = performance.now();
  consumers.analyze(packet);
  const analyzeMs = performance.now() - stageStartedAt;
  return Object.freeze({
    renderMs,
    countMs,
    recordMs,
    analyzeMs,
    totalMs: performance.now() - routeStartedAt,
  });
}
