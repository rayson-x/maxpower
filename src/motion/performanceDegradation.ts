export type MotionDegradationLevel = 0 | 1 | 2;

export interface MotionDegradationDecision {
  readonly level: MotionDegradationLevel;
  readonly changed: boolean;
  readonly reason: "within-budget" | "over-budget" | "severely-over-budget" | "recovered";
}

/** Uses a bounded P95 window and changes only Rust multi-person inference cadence. */
export class MotionPerformanceDegradationController {
  private readonly samples: number[] = [];
  private level: MotionDegradationLevel = 0;

  observe(processingMultiplier: number): MotionDegradationDecision {
    if (Number.isFinite(processingMultiplier) && processingMultiplier >= 0) {
      this.samples.push(processingMultiplier);
      if (this.samples.length > 90) this.samples.shift();
    }
    if (this.samples.length < 30) {
      return Object.freeze({ level: this.level, changed: false, reason: "within-budget" });
    }
    const sorted = [...this.samples].sort((left, right) => left - right);
    const p95 = sorted[Math.floor((sorted.length - 1) * 0.95)];
    const previous = this.level;
    let reason: MotionDegradationDecision["reason"] = "within-budget";
    if (p95 > 1.5) {
      this.level = 2;
      reason = "severely-over-budget";
    } else if (p95 > 1) {
      this.level = Math.max(this.level, 1) as MotionDegradationLevel;
      reason = "over-budget";
    } else if (p95 < 0.75 && this.level > 0) {
      this.level = (this.level - 1) as MotionDegradationLevel;
      reason = "recovered";
      this.samples.length = 0;
    }
    return Object.freeze({ level: this.level, changed: previous !== this.level, reason });
  }

  currentLevel(): MotionDegradationLevel {
    return this.level;
  }
}
