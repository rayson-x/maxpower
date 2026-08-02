/**
 * One Euro filter (Casiez et al. 2012) — 实时低延迟时序平滑。
 * 慢速运动时强平滑(消抖动),快速运动时弱平滑(不拖影),
 * 正好适合姿态骨架:静止时稳、发力时跟得上。
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(
    private readonly minCutoff = 1.0, // Hz:越小越平滑
    private readonly beta = 0.05, // 速度系数:越大越快响应快速运动
    private readonly dCutoff = 1.0, // Hz:导数截止频率
  ) {}

  filter(value: number, timestampMs: number): number {
    if (this.tPrev === null) {
      this.xPrev = value;
      this.tPrev = timestampMs;
      return value;
    }
    const dt = Math.max((timestampMs - this.tPrev) / 1000, 1e-3);
    const dx = (value - (this.xPrev as number)) / dt;
    const alphaD = alpha(this.dCutoff, dt);
    const dxHat = alphaD * dx + (1 - alphaD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const alphaX = alpha(cutoff, dt);
    const xHat = alphaX * value + (1 - alphaX) * (this.xPrev as number);
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = timestampMs;
    return xHat;
  }

  reset(): void {
    this.xPrev = null;
    this.tPrev = null;
    this.dxPrev = 0;
  }
}

function alpha(cutoffHz: number, dtSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSeconds);
}

export interface SmoothedPoint {
  x: number;
  y: number;
}

/** 33 个关键点各一对 One Euro 滤波器(x/y)，由 legacy canonical adapter 使用。 */
export class PoseSmoother {
  private filters: Array<{ x: OneEuroFilter; y: OneEuroFilter }> = [];

  smooth(
    landmarks: Array<{ x: number; y: number }>,
    timestampMs: number,
  ): SmoothedPoint[] {
    return landmarks.map((landmark, index) => {
      if (!this.filters[index]) {
        this.filters[index] = {
          x: new OneEuroFilter(),
          y: new OneEuroFilter(),
        };
      }
      const filter = this.filters[index];
      return {
        x: filter.x.filter(landmark.x, timestampMs),
        y: filter.y.filter(landmark.y, timestampMs),
      };
    });
  }

  reset(): void {
    this.filters = [];
  }
}
