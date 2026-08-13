import type { PoseLandmark } from "./PoseEngine";
import type {
  CanonicalContinuityReason,
  CanonicalImageMetadata,
  PoseSchema,
} from "./canonicalPose";

const MEASURED_MIN_SCORE = 0.5;
const WEAK_MIN_SCORE = 0.2;
const BASELINE_WINDOW = 15;
const MIN_BASELINE_SAMPLES = 5;
const MAX_RAW_BONE_RESIDUAL = 0.45;
const MAX_PREDICTION_MS = 150;
const MAX_WEAK_COORDINATE_INNOVATION_RATIO = 0.08;

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
  previousElbow: PointPx | null;
}

interface BoneEdge {
  from: number;
  to: number;
}

interface MotionState {
  point: PointPx;
  vxPxPerMs: number;
  vyPxPerMs: number;
  acceptedTimestampMs: number;
}

export interface ContinuityJointEvidence {
  x: number;
  y: number;
  source: "fused" | "predicted" | "unknown";
  canonicalConfidence: number;
  uncertainty: number;
  reason: Exclude<CanonicalContinuityReason, "legacy-tracker-prediction" | null>;
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
  halpe26: [
    { shoulder: 5, elbow: 7, wrist: 9 },
    { shoulder: 6, elbow: 8, wrist: 10 },
  ],
};

const SKELETON_BONES: Record<PoseSchema, readonly BoneEdge[]> = {
  blazepose33: [
    { from: 11, to: 12 },
    { from: 11, to: 13 },
    { from: 13, to: 15 },
    { from: 12, to: 14 },
    { from: 14, to: 16 },
    { from: 11, to: 23 },
    { from: 12, to: 24 },
    { from: 23, to: 24 },
    { from: 23, to: 25 },
    { from: 25, to: 27 },
    { from: 24, to: 26 },
    { from: 26, to: 28 },
  ],
  coco17: [
    { from: 5, to: 6 },
    { from: 5, to: 7 },
    { from: 7, to: 9 },
    { from: 6, to: 8 },
    { from: 8, to: 10 },
    { from: 5, to: 11 },
    { from: 6, to: 12 },
    { from: 11, to: 12 },
    { from: 11, to: 13 },
    { from: 13, to: 15 },
    { from: 12, to: 14 },
    { from: 14, to: 16 },
  ],
  halpe26: [
    { from: 5, to: 6 },
    { from: 5, to: 7 },
    { from: 7, to: 9 },
    { from: 6, to: 8 },
    { from: 8, to: 10 },
    { from: 5, to: 11 },
    { from: 6, to: 12 },
    { from: 11, to: 12 },
    { from: 11, to: 13 },
    { from: 13, to: 15 },
    { from: 12, to: 14 },
    { from: 14, to: 16 },
    { from: 15, to: 20 },
    { from: 15, to: 22 },
    { from: 15, to: 24 },
    { from: 16, to: 21 },
    { from: 16, to: 23 },
    { from: 16, to: 25 },
  ],
};

/**
 * Reference continuity pipeline for the Web implementation: fuse weak observed
 * elbows, reject isolated outliers, and repair only short evidence gaps.
 */
export class WeakObservationFusion {
  private readonly states = new Map<number, ArmState>();
  private readonly motion = new Map<number, MotionState>();
  private readonly boneLengths = new Map<string, number[]>();

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
    this.updateBoneBaselines(landmarks, rejected);
    for (const chain of ARM_CHAINS[this.schema]) {
      const shoulder = landmarks[chain.shoulder];
      const elbow = landmarks[chain.elbow];
      const wrist = landmarks[chain.wrist];
      if (!isFiniteLandmark(shoulder) || !isFiniteLandmark(elbow) || !isFiniteLandmark(wrist)) {
        continue;
      }

      const state = this.stateFor(chain.elbow);
      const upperLengths = this.boneLengths.get(boneKey(chain.shoulder, chain.elbow)) ?? [];
      const lowerLengths = this.boneLengths.get(boneKey(chain.elbow, chain.wrist)) ?? [];
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
        state.previousElbow = elbowPx;
        continue;
      }

      if (
        !anchorsReliable ||
        rejected.has(chain.elbow) ||
        elbow.visibility < WEAK_MIN_SCORE ||
        upperLengths.length < MIN_BASELINE_SAMPLES ||
        lowerLengths.length < MIN_BASELINE_SAMPLES
      ) {
        continue;
      }

      const upperLength = median(upperLengths);
      const lowerLength = median(lowerLengths);
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
        x: resultPx.x / this.image.widthPx,
        y: resultPx.y / this.image.heightPx,
        source: "fused",
        canonicalConfidence,
        uncertainty,
        reason: "weak-observation-bone-fusion",
      });
    }

    // Visibility is an occlusion likelihood, not a proof that MediaPipe's
    // coordinate is geometrically useless. Supine presses can retain coherent
    // elbow/wrist coordinates for seconds with near-zero visibility. Walk the
    // arm outward from a reliable shoulder and keep those weak observations
    // only when they satisfy both the learned bone length and motion prior.
    for (const chain of ARM_CHAINS[this.schema]) {
      const elbow = landmarks[chain.elbow];
      if (
        !repaired.has(chain.elbow) &&
        elbow &&
        elbow.visibility < MEASURED_MIN_SCORE
      ) {
        const fusedElbow = this.fuseWeakChild(
          chain.shoulder,
          chain.elbow,
          landmarks,
          rejected,
          repaired,
          timestampMs,
        );
        if (fusedElbow) repaired.set(chain.elbow, fusedElbow);
      }
      const wrist = landmarks[chain.wrist];
      if (
        !repaired.has(chain.wrist) &&
        wrist &&
        wrist.visibility < MEASURED_MIN_SCORE
      ) {
        const fusedWrist = this.fuseWeakChild(
          chain.elbow,
          chain.wrist,
          landmarks,
          rejected,
          repaired,
          timestampMs,
        );
        if (fusedWrist) repaired.set(chain.wrist, fusedWrist);
      }
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
        // Unknown has no business coordinate. Preserve the raw observation
        // only in the explicit diagnostic stream, never in canonical output.
        x: Number.NaN,
        y: Number.NaN,
        source: "unknown",
        canonicalConfidence: 0,
        uncertainty: 0.05 + (Number.isFinite(elapsedMs) ? Math.min(elapsedMs, 1000) / 1000 : 1) * 0.05,
        reason: rejected.has(index)
          ? "outlier-rejected-unknown"
          : state
            ? "prediction-timeout"
            : "no-measurement-baseline",
      });
      this.motion.delete(index);
    });

    return repaired;
  }

  reset(): void {
    this.states.clear();
    this.motion.clear();
    this.boneLengths.clear();
  }

  private stateFor(elbowIndex: number): ArmState {
    let state = this.states.get(elbowIndex);
    if (!state) {
      state = { previousElbow: null };
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

  private fuseWeakChild(
    parentIndex: number,
    childIndex: number,
    landmarks: readonly PoseLandmark[],
    rejected: ReadonlySet<number>,
    repaired: ReadonlyMap<number, ContinuityJointEvidence>,
    timestampMs: number,
  ): ContinuityJointEvidence | null {
    if (rejected.has(childIndex)) return null;
    const child = landmarks[childIndex];
    if (!isFiniteLandmark(child) || child.visibility <= 0) return null;
    const repairedParent = repaired.get(parentIndex);
    let parentPoint: PointPx;
    let parentConfidence: number;
    if (repairedParent && repairedParent.source === "fused") {
      parentPoint = {
        x: repairedParent.x * this.image.widthPx,
        y: repairedParent.y * this.image.heightPx,
      };
      parentConfidence = repairedParent.canonicalConfidence;
    } else {
      const parent = landmarks[parentIndex];
      if (
        rejected.has(parentIndex) ||
        !isFiniteLandmark(parent) ||
        parent.visibility < MEASURED_MIN_SCORE
      ) {
        return null;
      }
      parentPoint = this.toPixels(parent);
      parentConfidence = parent.visibility;
    }
    const samples = this.boneLengths.get(boneKey(parentIndex, childIndex));
    if (!samples || samples.length < MIN_BASELINE_SAMPLES) return null;
    const motion = this.motion.get(childIndex);
    if (!motion) return null;
    const elapsedMs = timestampMs - motion.acceptedTimestampMs;
    if (elapsedMs <= 0 || elapsedMs > MAX_PREDICTION_MS) return null;
    const baseline = median(samples);
    const rawPoint = this.toPixels(child);
    const boneResidual = Math.abs(distance(parentPoint, rawPoint) - baseline) / baseline;
    if (!Number.isFinite(boneResidual) || boneResidual > MAX_RAW_BONE_RESIDUAL) return null;
    const predicted = {
      x: motion.point.x + motion.vxPxPerMs * elapsedMs,
      y: motion.point.y + motion.vyPxPerMs * elapsedMs,
    };
    const diagonal = Math.hypot(this.image.widthPx, this.image.heightPx);
    const innovation = distance(rawPoint, predicted);
    if (
      !Number.isFinite(innovation) ||
      innovation > diagonal * MAX_WEAK_COORDINATE_INNOVATION_RATIO
    ) {
      return null;
    }
    // Visibility acts as the measurement gain: a near-zero observation may
    // steer a validated chain, but cannot dominate the motion prior.
    const rawWeight = clamp(0.08 + child.visibility * 0.84, 0.08, 0.5);
    const blended = {
      x: rawPoint.x * rawWeight + predicted.x * (1 - rawWeight),
      y: rawPoint.y * rawWeight + predicted.y * (1 - rawWeight),
    };
    const direction = {
      x: blended.x - parentPoint.x,
      y: blended.y - parentPoint.y,
    };
    const directionLength = Math.hypot(direction.x, direction.y);
    if (!Number.isFinite(directionLength) || directionLength <= 1e-6) return null;
    const result = {
      x: parentPoint.x + (direction.x / directionLength) * baseline,
      y: parentPoint.y + (direction.y / directionLength) * baseline,
    };
    return {
      x: result.x / this.image.widthPx,
      y: result.y / this.image.heightPx,
      source: "fused",
      canonicalConfidence: clamp(parentConfidence * 0.7, MEASURED_MIN_SCORE, 0.75),
      uncertainty:
        innovation / diagonal +
        boneResidual * 0.03 +
        Math.max(0, MEASURED_MIN_SCORE - child.visibility) * 0.025,
      reason: "weak-observation-bone-fusion",
    };
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
      const boneResidual = this.topologyBoneResidual(candidate.index, candidate.point, landmarks);
      const candidateMotion = Math.hypot(candidate.dx, candidate.dy);
      const hasCoherentNeighbor = SKELETON_BONES[this.schema].some((bone) => {
        const neighborIndex = bone.from === candidate.index
          ? bone.to
          : bone.to === candidate.index
            ? bone.from
            : null;
        if (neighborIndex === null) return false;
        const neighbor = candidates.find(({ index }) => index === neighborIndex);
        if (!neighbor) return false;
        const neighborMotion = Math.hypot(neighbor.dx, neighbor.dy);
        const cosine =
          (candidate.dx * neighbor.dx + candidate.dy * neighbor.dy) /
          Math.max(1e-6, candidateMotion * neighborMotion);
        return neighborMotion >= candidateMotion * 0.3 && cosine >= 0.7;
      });
      if (
        innovation > diagonal * 0.08 &&
        incoherent > diagonal * 0.06 &&
        !hasCoherentNeighbor &&
        (boneResidual > 0.35 || innovation > diagonal * 0.25)
      ) {
        rejected.add(candidate.index);
      }
    }
    return rejected;
  }

  private topologyBoneResidual(
    index: number,
    point: PointPx,
    landmarks: readonly PoseLandmark[],
  ): number {
    const residuals = SKELETON_BONES[this.schema].flatMap((bone) => {
      if (bone.from !== index && bone.to !== index) return [];
      const samples = this.boneLengths.get(boneKey(bone.from, bone.to));
      const otherIndex = bone.from === index ? bone.to : bone.from;
      const other = landmarks[otherIndex];
      if (!samples || samples.length < MIN_BASELINE_SAMPLES || !isFiniteLandmark(other)) {
        return [];
      }
      const baseline = median(samples);
      return [Math.abs(distance(point, this.toPixels(other)) - baseline) / baseline];
    });
    return residuals.length === 0 ? 0 : Math.max(...residuals);
  }

  private updateBoneBaselines(
    landmarks: readonly PoseLandmark[],
    rejected: ReadonlySet<number>,
  ): void {
    for (const bone of SKELETON_BONES[this.schema]) {
      const from = landmarks[bone.from];
      const to = landmarks[bone.to];
      if (
        rejected.has(bone.from) ||
        rejected.has(bone.to) ||
        !isFiniteLandmark(from) ||
        !isFiniteLandmark(to) ||
        from.visibility < MEASURED_MIN_SCORE ||
        to.visibility < MEASURED_MIN_SCORE
      ) {
        continue;
      }
      const key = boneKey(bone.from, bone.to);
      const samples = this.boneLengths.get(key) ?? [];
      const length = distance(this.toPixels(from), this.toPixels(to));
      if (
        samples.length >= MIN_BASELINE_SAMPLES &&
        Math.abs(length - median(samples)) / median(samples) > MAX_RAW_BONE_RESIDUAL
      ) {
        continue;
      }
      pushWindow(samples, length);
      this.boneLengths.set(key, samples);
    }
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

function boneKey(from: number, to: number): string {
  return from < to ? `${from}-${to}` : `${to}-${from}`;
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
