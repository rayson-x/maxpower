import type { PoseLandmark } from "./PoseEngine";
import type { CanonicalImageMetadata, PoseSchema } from "./canonicalPose";

const MEASURED_MIN_SCORE = 0.5;
const WEAK_MIN_SCORE = 0.2;
const BASELINE_WINDOW = 15;
const MIN_BASELINE_SAMPLES = 5;
const MAX_RAW_BONE_RESIDUAL = 0.45;
const MAX_PREDICTION_MS = 150;

interface ArmChain {
  shoulder: number;
  elbow: number;
  wrist: number;
}

interface PointPx {
  x: number;
  y: number;
}

interface ArmState {
  upperLengths: number[];
  lowerLengths: number[];
  previousElbow: PointPx | null;
}

interface MotionState {
  point: PointPx;
  vxPxPerMs: number;
  vyPxPerMs: number;
  acceptedTimestampMs: number;
}

export interface ContinuityJointEvidence {
  index: number;
  x: number;
  y: number;
  source: "fused" | "predicted" | "unknown";
  canonicalConfidence: number;
  uncertainty: number;
  reason:
    | "weak-observation-bone-fusion"
    | "short-gap-prediction"
    | "outlier-rejected-prediction"
    | "outlier-rejected-unknown"
    | "prediction-timeout"
    | "no-measurement-baseline";
}

const ARM_CHAINS: Record<PoseSchema, readonly ArmChain[]> = {
  blazepose33: [
    { shoulder: 11, elbow: 13, wrist: 15 },
    { shoulder: 12, elbow: 14, wrist: 16 },
  ],
  coco17: [
    { shoulder: 5, elbow: 7, wrist: 9 },
    { shoulder: 6, elbow: 8, wrist: 10 },
  ],
};

/**
 * Fuses only weak, still-observed elbows. It never creates a point from a gap;
 * time-bounded prediction belongs to the separate gap-repair ticket.
 */
export class WeakObservationFusion {
  private readonly states = new Map<number, ArmState>();
  private readonly motion = new Map<number, MotionState>();

  constructor(
    private readonly schema: PoseSchema,
    private readonly image: CanonicalImageMetadata,
  ) {}

  process(
    landmarks: readonly PoseLandmark[],
    timestampMs: number,
  ): Map<number, ContinuityJointEvidence> {
    const repaired = new Map<number, ContinuityJointEvidence>();
    const rejected = this.findOutliers(landmarks, timestampMs);
    for (const chain of ARM_CHAINS[this.schema]) {
      const shoulder = landmarks[chain.shoulder];
      const elbow = landmarks[chain.elbow];
      const wrist = landmarks[chain.wrist];
      if (!isFiniteLandmark(shoulder) || !isFiniteLandmark(elbow) || !isFiniteLandmark(wrist)) {
        continue;
      }

      const state = this.stateFor(chain.elbow);
      const shoulderPx = this.toPixels(shoulder);
      const elbowPx = this.toPixels(elbow);
      const wristPx = this.toPixels(wrist);
      const anchorsReliable =
        !rejected.has(chain.shoulder) &&
        !rejected.has(chain.wrist) &&
        shoulder.visibility >= MEASURED_MIN_SCORE &&
        wrist.visibility >= MEASURED_MIN_SCORE;

      if (
        anchorsReliable &&
        !rejected.has(chain.elbow) &&
        elbow.visibility >= MEASURED_MIN_SCORE
      ) {
        pushWindow(state.upperLengths, distance(shoulderPx, elbowPx));
        pushWindow(state.lowerLengths, distance(elbowPx, wristPx));
        state.previousElbow = elbowPx;
        continue;
      }

      if (
        !anchorsReliable ||
        rejected.has(chain.elbow) ||
        elbow.visibility < WEAK_MIN_SCORE ||
        state.upperLengths.length < MIN_BASELINE_SAMPLES ||
        state.lowerLengths.length < MIN_BASELINE_SAMPLES
      ) {
        continue;
      }

      const upperLength = median(state.upperLengths);
      const lowerLength = median(state.lowerLengths);
      const upperResidual = Math.abs(distance(shoulderPx, elbowPx) - upperLength) / upperLength;
      const lowerResidual = Math.abs(distance(elbowPx, wristPx) - lowerLength) / lowerLength;
      if (Math.max(upperResidual, lowerResidual) > MAX_RAW_BONE_RESIDUAL) continue;

      const constrained = chooseConstrainedElbow(
        shoulderPx,
        wristPx,
        upperLength,
        lowerLength,
        elbowPx,
        state.previousElbow,
      );
      if (!constrained) continue;

      // The raw elbow is still direct visual evidence and therefore dominates;
      // the chain/history estimate supplies a soft correction and branch choice.
      const rawChangedBranch =
        state.previousElbow !== null &&
        signedSide(shoulderPx, wristPx, elbowPx) *
          signedSide(shoulderPx, wristPx, state.previousElbow) <
          0;
      const rawWeight = rawChangedBranch
        ? 0.2
        : clamp(0.65 + elbow.visibility * 0.3, 0.7, 0.85);
      const resultPx = {
        x: elbowPx.x * rawWeight + constrained.x * (1 - rawWeight),
        y: elbowPx.y * rawWeight + constrained.y * (1 - rawWeight),
      };
      const disagreement = distance(elbowPx, constrained);
      const imageDiagonal = Math.hypot(this.image.widthPx, this.image.heightPx);
      const uncertainty =
        disagreement / imageDiagonal + (MEASURED_MIN_SCORE - elbow.visibility) * 0.025;
      const anchorConfidence = Math.min(shoulder.visibility, wrist.visibility);
      const canonicalConfidence = clamp(
        anchorConfidence * (0.7 + elbow.visibility * 0.3),
        MEASURED_MIN_SCORE,
        1,
      );

      state.previousElbow = resultPx;
      repaired.set(chain.elbow, {
        index: chain.elbow,
        x: resultPx.x / this.image.widthPx,
        y: resultPx.y / this.image.heightPx,
        source: "fused",
        canonicalConfidence,
        uncertainty,
        reason: "weak-observation-bone-fusion",
      });
    }

    landmarks.forEach((landmark, index) => {
      const existingRepair = repaired.get(index);
      if (existingRepair?.source === "fused") {
        this.acceptMotion(
          index,
          { x: existingRepair.x * this.image.widthPx, y: existingRepair.y * this.image.heightPx },
          timestampMs,
        );
        return;
      }

      if (
        !rejected.has(index) &&
        isFiniteLandmark(landmark) &&
        landmark.visibility >= MEASURED_MIN_SCORE
      ) {
        this.acceptMotion(index, this.toPixels(landmark), timestampMs);
        return;
      }

      const state = this.motion.get(index);
      const elapsedMs = state ? timestampMs - state.acceptedTimestampMs : Infinity;
      if (state && elapsedMs > 0 && elapsedMs <= MAX_PREDICTION_MS) {
        const predicted = {
          x: state.point.x + state.vxPxPerMs * elapsedMs,
          y: state.point.y + state.vyPxPerMs * elapsedMs,
        };
        repaired.set(index, {
          index,
          x: predicted.x / this.image.widthPx,
          y: predicted.y / this.image.heightPx,
          source: "predicted",
          canonicalConfidence: clamp(0.5 * (1 - elapsedMs / (MAX_PREDICTION_MS + 1)), 0.05, 0.49),
          uncertainty: 0.01 + (elapsedMs / MAX_PREDICTION_MS) * 0.04,
          reason: rejected.has(index)
            ? "outlier-rejected-prediction"
            : "short-gap-prediction",
        });
        return;
      }

      repaired.set(index, {
        index,
        x: landmark?.x ?? 0,
        y: landmark?.y ?? 0,
        source: "unknown",
        canonicalConfidence: 0,
        uncertainty: 0.05 + (Number.isFinite(elapsedMs) ? Math.min(elapsedMs, 1000) / 1000 : 1) * 0.05,
        reason: rejected.has(index)
          ? "outlier-rejected-unknown"
          : state
            ? "prediction-timeout"
            : "no-measurement-baseline",
      });
    });

    return repaired;
  }

  reset(): void {
    this.states.clear();
    this.motion.clear();
  }

  private stateFor(elbowIndex: number): ArmState {
    let state = this.states.get(elbowIndex);
    if (!state) {
      state = { upperLengths: [], lowerLengths: [], previousElbow: null };
      this.states.set(elbowIndex, state);
    }
    return state;
  }

  private toPixels(landmark: PoseLandmark): PointPx {
    return {
      x: landmark.x * this.image.widthPx,
      y: landmark.y * this.image.heightPx,
    };
  }

  private acceptMotion(index: number, point: PointPx, timestampMs: number): void {
    const previous = this.motion.get(index);
    const elapsedMs = previous ? timestampMs - previous.acceptedTimestampMs : 0;
    this.motion.set(index, {
      point,
      vxPxPerMs:
        previous && elapsedMs > 0 ? (point.x - previous.point.x) / elapsedMs : 0,
      vyPxPerMs:
        previous && elapsedMs > 0 ? (point.y - previous.point.y) / elapsedMs : 0,
      acceptedTimestampMs: timestampMs,
    });
  }

  private findOutliers(
    landmarks: readonly PoseLandmark[],
    timestampMs: number,
  ): Set<number> {
    const candidates = landmarks.flatMap((landmark, index) => {
      const state = this.motion.get(index);
      if (
        !state ||
        !isFiniteLandmark(landmark) ||
        landmark.visibility < MEASURED_MIN_SCORE
      ) {
        return [];
      }
      const elapsedMs = timestampMs - state.acceptedTimestampMs;
      if (elapsedMs <= 0 || elapsedMs > MAX_PREDICTION_MS * 2) return [];
      const point = this.toPixels(landmark);
      return [
        {
          index,
          point,
          dx: point.x - state.point.x,
          dy: point.y - state.point.y,
          predicted: {
            x: state.point.x + state.vxPxPerMs * elapsedMs,
            y: state.point.y + state.vyPxPerMs * elapsedMs,
          },
        },
      ];
    });
    if (candidates.length < 3) return new Set();

    const coherentDx = median(candidates.map(({ dx }) => dx));
    const coherentDy = median(candidates.map(({ dy }) => dy));
    const diagonal = Math.hypot(this.image.widthPx, this.image.heightPx);
    const rejected = new Set<number>();
    for (const candidate of candidates) {
      const innovation = distance(candidate.point, candidate.predicted);
      const incoherent = Math.hypot(
        candidate.dx - coherentDx,
        candidate.dy - coherentDy,
      );
      const boneResidual = this.armBoneResidual(candidate.index, candidate.point, landmarks);
      if (
        innovation > diagonal * 0.08 &&
        incoherent > diagonal * 0.06 &&
        (boneResidual > 0.35 || innovation > diagonal * 0.25)
      ) {
        rejected.add(candidate.index);
      }
    }
    return rejected;
  }

  private armBoneResidual(
    index: number,
    point: PointPx,
    landmarks: readonly PoseLandmark[],
  ): number {
    const chain = ARM_CHAINS[this.schema].find(({ elbow }) => elbow === index);
    if (!chain) return 0;
    const state = this.states.get(index);
    const shoulder = landmarks[chain.shoulder];
    const wrist = landmarks[chain.wrist];
    if (
      !state ||
      state.upperLengths.length < MIN_BASELINE_SAMPLES ||
      state.lowerLengths.length < MIN_BASELINE_SAMPLES ||
      !isFiniteLandmark(shoulder) ||
      !isFiniteLandmark(wrist)
    ) {
      return 0;
    }
    const upper = median(state.upperLengths);
    const lower = median(state.lowerLengths);
    return Math.max(
      Math.abs(distance(this.toPixels(shoulder), point) - upper) / upper,
      Math.abs(distance(point, this.toPixels(wrist)) - lower) / lower,
    );
  }
}

function chooseConstrainedElbow(
  shoulder: PointPx,
  wrist: PointPx,
  upperLength: number,
  lowerLength: number,
  raw: PointPx,
  previous: PointPx | null,
): PointPx | null {
  const dx = wrist.x - shoulder.x;
  const dy = wrist.y - shoulder.y;
  const anchorDistance = Math.hypot(dx, dy);
  if (
    anchorDistance < 1e-6 ||
    anchorDistance > upperLength + lowerLength ||
    anchorDistance < Math.abs(upperLength - lowerLength)
  ) {
    return null;
  }

  const along =
    (upperLength ** 2 - lowerLength ** 2 + anchorDistance ** 2) /
    (2 * anchorDistance);
  const perpendicular = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const unitX = dx / anchorDistance;
  const unitY = dy / anchorDistance;
  const base = {
    x: shoulder.x + along * unitX,
    y: shoulder.y + along * unitY,
  };
  const candidates = [
    { x: base.x - perpendicular * unitY, y: base.y + perpendicular * unitX },
    { x: base.x + perpendicular * unitY, y: base.y - perpendicular * unitX },
  ];

  return candidates.reduce((best, candidate) =>
    branchCost(candidate, raw, previous) < branchCost(best, raw, previous)
      ? candidate
      : best,
  );
}

function branchCost(candidate: PointPx, raw: PointPx, previous: PointPx | null): number {
  if (!previous) return distance(candidate, raw);
  return distance(candidate, raw) * 0.35 + distance(candidate, previous) * 0.65;
}

function signedSide(from: PointPx, to: PointPx, point: PointPx): number {
  return (to.x - from.x) * (point.y - from.y) -
    (to.y - from.y) * (point.x - from.x);
}

function pushWindow(values: number[], value: number): void {
  if (!Number.isFinite(value) || value <= 1e-6) return;
  values.push(value);
  if (values.length > BASELINE_WINDOW) values.shift();
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function distance(left: PointPx, right: PointPx): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function isFiniteLandmark(landmark: PoseLandmark | undefined): landmark is PoseLandmark {
  return !!landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y);
}
