import { mapRepCountAction } from "./actionMap";
import {
  EXTERNAL_FITNESS_SEQUENCE_SCHEMA,
  EXTERNAL_RESEARCH_POLICY,
  type ExternalFitnessSequence,
  type ExternalRepBound,
} from "./model";

export interface RepCountAnnotationInput {
  readonly videoId: string;
  readonly split?: ExternalFitnessSequence["split"];
  readonly action: string;
  readonly count: number;
  /** Accepts the official Python-list-like string or an already parsed array. */
  readonly cycleBounds: string | readonly (readonly [number, number])[];
  readonly framesPerSecond?: number | null;
}

export function adaptRepCountAnnotation(input: RepCountAnnotationInput): ExternalFitnessSequence {
  if (!Number.isInteger(input.count) || input.count < 0) {
    throw new Error("RepCount count must be a non-negative integer");
  }
  const repBounds = parseCycleBounds(input.cycleBounds);
  if (repBounds.length !== input.count) {
    throw new Error(`RepCount count ${input.count} disagrees with ${repBounds.length} cycle bounds`);
  }
  const startFrame = repBounds[0]?.startFrame ?? 0;
  const endFrame = repBounds.at(-1)?.endFrame ?? 0;
  return {
    schemaVersion: EXTERNAL_FITNESS_SEQUENCE_SCHEMA,
    datasetId: "repcount-a",
    sourceSequenceId: input.videoId,
    split: input.split ?? "unknown",
    subjectId: null,
    sourceAction: input.action,
    exerciseId: mapRepCountAction(input.action),
    cameraView: "unknown",
    ...EXTERNAL_RESEARCH_POLICY,
    poseTopology: "unavailable",
    sourceConfidenceAvailable: false,
    framesPerSecond: input.framesPerSecond ?? null,
    poses: [],
    labels: [{
      startFrame,
      endFrame,
      totalRepetitions: input.count,
      annotationGranularity: "per_rep_bounds",
      repBounds,
    }],
  };
}

export function parseCycleBounds(
  value: string | readonly (readonly [number, number])[],
): ExternalRepBound[] {
  const pairs = typeof value === "string" ? parseBoundsString(value) : value;
  let previousEnd = -1;
  return pairs.map((pair, index) => {
    const [startFrame, endFrame] = pair;
    if (!Number.isInteger(startFrame) || !Number.isInteger(endFrame) ||
        startFrame < 0 || endFrame < startFrame || startFrame < previousEnd) {
      throw new Error(`Invalid RepCount cycle bound at index ${index}`);
    }
    previousEnd = endFrame;
    return { repIndex: index + 1, startFrame, endFrame };
  });
}

function parseBoundsString(value: string): readonly (readonly [number, number])[] {
  const matches = [...value.matchAll(/[[(]\s*(\d+)\s*,\s*(\d+)\s*[\])]/g)];
  if (matches.length === 0 && value.trim() !== "[]") {
    throw new Error("RepCount cycle_bounds could not be parsed");
  }
  return matches.map((match) => [Number(match[1]), Number(match[2])] as const);
}
