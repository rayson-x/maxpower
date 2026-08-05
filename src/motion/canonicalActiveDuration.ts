import type { MotionSetLifecycle } from "./motionPacket";

/** Accumulates only intervals whose preceding canonical packet was active. */
export class CanonicalActiveDurationAccumulator {
  private previousTimestampMs: number | null = null;
  private previousLifecycle: MotionSetLifecycle = "idle";
  private totalMs = 0;

  update(timestampMs: number | bigint, lifecycle: MotionSetLifecycle): number {
    const nextTimestampMs = Number(timestampMs);
    if (!Number.isFinite(nextTimestampMs)) return this.totalMs;
    if (this.previousTimestampMs !== null && this.previousLifecycle === "active") {
      this.totalMs += Math.max(0, nextTimestampMs - this.previousTimestampMs);
    }
    this.previousTimestampMs = nextTimestampMs;
    this.previousLifecycle = lifecycle;
    return this.totalMs;
  }

  reset(): void {
    this.previousTimestampMs = null;
    this.previousLifecycle = "idle";
    this.totalMs = 0;
  }

  value(): number { return this.totalMs; }
}
