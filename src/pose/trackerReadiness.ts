export type TrackerReadinessPhase =
  | "loading"
  | "loaded"
  | "calibrating"
  | "ready"
  | "interrupted";

export interface TrackerReadinessState {
  phase: TrackerReadinessPhase;
  stableFrameCount: number;
}

export interface TrackerReadinessInput {
  assetsReady: boolean;
  sourceOpen: boolean;
  targetLocked: boolean;
  usableLandmarkRatio: number;
}

export const INITIAL_TRACKER_READINESS: TrackerReadinessState = Object.freeze({
  phase: "loading",
  stableFrameCount: 0,
});

const MIN_USABLE_LANDMARK_RATIO = 0.6;
const REQUIRED_STABLE_FRAME_COUNT = 2;

export function updateTrackerReadiness(
  state: TrackerReadinessState,
  input: TrackerReadinessInput,
): TrackerReadinessState {
  if (!input.assetsReady) {
    return { phase: "loading", stableFrameCount: 0 };
  }

  if (!input.sourceOpen) {
    return { phase: "loaded", stableFrameCount: 0 };
  }

  const reliableFrame =
    input.targetLocked &&
    Number.isFinite(input.usableLandmarkRatio) &&
    input.usableLandmarkRatio >= MIN_USABLE_LANDMARK_RATIO;

  if (!reliableFrame) {
    return {
      phase:
        state.phase === "ready" || state.phase === "interrupted"
          ? "interrupted"
          : "calibrating",
      stableFrameCount: 0,
    };
  }

  if (state.phase === "ready" || state.phase === "interrupted") {
    return { phase: "ready", stableFrameCount: REQUIRED_STABLE_FRAME_COUNT };
  }

  const stableFrameCount =
    state.phase === "calibrating"
      ? Math.min(state.stableFrameCount + 1, REQUIRED_STABLE_FRAME_COUNT)
      : 1;

  return {
    phase:
      stableFrameCount >= REQUIRED_STABLE_FRAME_COUNT ? "ready" : "calibrating",
    stableFrameCount,
  };
}
