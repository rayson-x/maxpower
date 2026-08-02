import type {
  CanonicalLandmark,
  CanonicalPoseFrame,
} from "./canonicalPose";
import { selectLandmarksByOriginalIndex } from "./selectLandmarks";

export interface CanonicalPoseEdge {
  fromIndex: number;
  toIndex: number;
  start: CanonicalLandmark;
  end: CanonicalLandmark;
  repaired: boolean;
}

export interface CanonicalPosePresentation {
  renderableLandmarks: Map<number, CanonicalLandmark>;
  measuredLandmarks: Map<number, CanonicalLandmark>;
  repairedLandmarks: Map<number, CanonicalLandmark>;
  usableLandmarks: Map<number, CanonicalLandmark>;
  edges: CanonicalPoseEdge[];
}

export function buildCanonicalPosePresentation(
  frame: CanonicalPoseFrame | null,
  connections: ReadonlyArray<readonly [number, number]>,
): CanonicalPosePresentation {
  const landmarks = frame?.landmarks ?? [];
  const renderableLandmarks = selectLandmarksByOriginalIndex(
    landmarks,
    (landmark) => landmark.renderable,
  );
  const measuredLandmarks = selectLandmarksByOriginalIndex(
    landmarks,
    (landmark) => landmark.renderable && landmark.source === "measured",
  );
  const repairedLandmarks = selectLandmarksByOriginalIndex(
    landmarks,
    (landmark) => landmark.renderable && landmark.source !== "measured",
  );
  const usableLandmarks = selectLandmarksByOriginalIndex(
    landmarks,
    (landmark) => landmark.usable,
  );
  const edges = connections.flatMap(([fromIndex, toIndex]) => {
    const start = renderableLandmarks.get(fromIndex);
    const end = renderableLandmarks.get(toIndex);
    if (!start || !end) return [];
    return [
      {
        fromIndex,
        toIndex,
        start,
        end,
        repaired: start.source !== "measured" || end.source !== "measured",
      },
    ];
  });

  return {
    renderableLandmarks,
    measuredLandmarks,
    repairedLandmarks,
    usableLandmarks,
    edges,
  };
}
