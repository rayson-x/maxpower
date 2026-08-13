import type { PoseLandmark } from "../../src/pose/PoseEngine";
import { mapMmFitAction } from "./actionMap";
import {
  EXTERNAL_FITNESS_SEQUENCE_SCHEMA,
  EXTERNAL_RESEARCH_POLICY,
  type ExternalFitnessLabel,
  type ExternalFitnessSequence,
} from "./model";

export interface MmFit2dFrame {
  readonly frameIndex: number;
  /** COCO-18 order used by MM-Fit, in source-image pixels. */
  readonly joints: readonly (readonly [number, number])[];
}

export interface MmFitSetLabel {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly repetitionCount: number;
  readonly activityClass: string;
}

export interface MmFitSequenceInput {
  readonly workoutId: string;
  readonly subjectId: string;
  readonly split: ExternalFitnessSequence["split"];
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly framesPerSecond: number;
  readonly frames: readonly MmFit2dFrame[];
  readonly labels: readonly MmFitSetLabel[];
}

// Exact joints only. MM-Fit's derived neck joint has no BlazePose equivalent
// and is deliberately omitted instead of being copied into a nearby slot.
const COCO18_TO_BLAZEPOSE33 = new Map<number, number>([
  [0, 0], [14, 5], [15, 2], [16, 8], [17, 7],
  [2, 12], [3, 14], [4, 16], [5, 11], [6, 13], [7, 15],
  [8, 24], [9, 26], [10, 28], [11, 23], [12, 25], [13, 27],
]);

export function adaptMmFit2d(input: MmFitSequenceInput): ExternalFitnessSequence {
  assertPositive(input.sourceWidth, "sourceWidth");
  assertPositive(input.sourceHeight, "sourceHeight");
  assertPositive(input.framesPerSecond, "framesPerSecond");
  const actions = new Set(input.labels.map((label) => label.activityClass));
  const sourceAction = actions.size === 1 ? [...actions][0] : "mixed";
  return {
    schemaVersion: EXTERNAL_FITNESS_SEQUENCE_SCHEMA,
    datasetId: "mm-fit",
    sourceSequenceId: input.workoutId,
    split: input.split,
    subjectId: input.subjectId,
    sourceAction,
    exerciseId: actions.size === 1 ? mapMmFitAction(sourceAction) : null,
    cameraView: "unknown",
    ...EXTERNAL_RESEARCH_POLICY,
    poseTopology: "blazepose33-adapted",
    sourceConfidenceAvailable: false,
    framesPerSecond: input.framesPerSecond,
    poses: input.frames.map((frame) => ({
      timestampMs: frame.frameIndex * 1_000 / input.framesPerSecond,
      landmarks: mapCoco18Frame(frame.joints, input.sourceWidth, input.sourceHeight),
      worldLandmarks: [],
    })),
    labels: input.labels.map(adaptSetLabel),
  };
}

export function mapCoco18Frame(
  joints: readonly (readonly [number, number])[],
  width: number,
  height: number,
): PoseLandmark[] {
  const output = Array.from({ length: 33 }, unknownLandmark);
  for (const [sourceIndex, targetIndex] of COCO18_TO_BLAZEPOSE33) {
    const joint = joints[sourceIndex];
    if (!joint || !finiteNonZeroPair(joint)) continue;
    output[targetIndex] = {
      x: joint[0] / width,
      y: joint[1] / height,
      z: 0,
      // MM-Fit exposes coordinates but no detector confidence. Visibility=1
      // means "provided by source", while sourceConfidenceAvailable=false
      // prevents consumers from treating it as a calibrated probability.
      visibility: 1,
    };
  }
  return output;
}

function adaptSetLabel(label: MmFitSetLabel): ExternalFitnessLabel {
  if (!Number.isInteger(label.repetitionCount) || label.repetitionCount < 0) {
    throw new Error("MM-Fit repetitionCount must be a non-negative integer");
  }
  if (!(label.startFrame >= 0 && label.endFrame >= label.startFrame)) {
    throw new Error("MM-Fit label bounds must be ordered non-negative frames");
  }
  return {
    startFrame: label.startFrame,
    endFrame: label.endFrame,
    totalRepetitions: label.repetitionCount,
    annotationGranularity: "set_count",
    repBounds: [],
  };
}

function unknownLandmark(): PoseLandmark {
  return { x: 0, y: 0, z: 0, visibility: 0 };
}

function finiteNonZeroPair(value: readonly [number, number]): boolean {
  return value.every(Number.isFinite) && !(value[0] === 0 && value[1] === 0);
}

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive`);
}
