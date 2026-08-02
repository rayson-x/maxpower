import type { PoseEstimate } from "./PoseEngine";

export interface RepEvent {
  type: "rep_completed";
  repIndex: number;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  minY: number;
  maxY: number;
  amplitude: number;
}

const WRIST_LEFT = 15;
const WRIST_RIGHT = 16;
const MIN_AMPLITUDE = 0.08; // normalized image units
const MIN_REP_MS = 400;
const MIN_VISIBILITY = 0.5;

type Phase = "idle" | "moving";

/**
 * Naive combo-test rep counter: tracks the wrist midpoint's vertical position
 * and counts direction reversals with enough amplitude. NOT a production
 * algorithm — exists to prove the frame → event → agent chain end to end.
 */
export class RepCounter {
  private phase: Phase = "idle";
  private direction: 0 | 1 | -1 = 0; // 1 = moving down, -1 = moving up
  private repStartMs = 0;
  private minY = 1;
  private maxY = 0;
  private extremumY = 0;
  private repIndex = 0;

  /** Returns a RepEvent when a rep completes on this frame, else null. */
  update(pose: PoseEstimate): RepEvent | null {
    const left = pose.landmarks[WRIST_LEFT];
    const right = pose.landmarks[WRIST_RIGHT];
    // 侧视角远侧手腕是幻觉值:取可见性更高的那只手腕,而不是两手平均
    const candidates = [left, right].filter(
      (wrist) => wrist && wrist.visibility >= MIN_VISIBILITY,
    );
    if (candidates.length === 0) return null;
    const wrist =
      candidates.length === 1
        ? candidates[0]
        : candidates[0].visibility >= candidates[1].visibility
          ? candidates[0]
          : candidates[1];
    const y = wrist.y;
    const now = pose.timestampMs;

    if (this.phase === "idle") {
      this.phase = "moving";
      this.direction = 0;
      this.repStartMs = now;
      this.minY = y;
      this.maxY = y;
      this.extremumY = y;
      return null;
    }

    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);

    const delta = y - this.extremumY;
    if (this.direction >= 0 && delta < -MIN_AMPLITUDE / 4) {
      // was going down/flat, now clearly moving up → bottom reversal
      this.direction = -1;
      this.extremumY = y;
    } else if (this.direction <= 0 && delta > MIN_AMPLITUDE / 4) {
      // now clearly moving down → top reversal
      if (this.direction === -1) {
        const amplitude = this.maxY - this.minY;
        const duration = now - this.repStartMs;
        if (amplitude >= MIN_AMPLITUDE && duration >= MIN_REP_MS) {
          this.repIndex += 1;
          const event: RepEvent = {
            type: "rep_completed",
            repIndex: this.repIndex,
            startedAtMs: this.repStartMs,
            endedAtMs: now,
            durationMs: duration,
            minY: this.minY,
            maxY: this.maxY,
            amplitude,
          };
          this.repStartMs = now;
          this.minY = y;
          this.maxY = y;
          this.direction = 1;
          this.extremumY = y;
          return event;
        }
      }
      this.direction = 1;
      this.extremumY = y;
    } else {
      this.extremumY =
        this.direction === -1 ? Math.min(this.extremumY, y) : Math.max(this.extremumY, y);
    }
    return null;
  }

  get count(): number {
    return this.repIndex;
  }

  reset(): void {
    this.phase = "idle";
    this.direction = 0;
    this.repIndex = 0;
  }
}
