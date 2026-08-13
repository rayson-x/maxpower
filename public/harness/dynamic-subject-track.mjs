const TORSO = [11, 12, 23, 24];
const BODY = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const NULL_STATE = -1;

/**
 * Tracks one physical subject through a MediaPipe multi-pose sequence.
 *
 * PoseLandmarker result indexes are frame-local ranks, not identities.  This
 * Viterbi pass is deliberately index-agnostic: it follows torso geometry,
 * image position, scale and appearance, and emits a gap when every candidate
 * would require an anatomically impossible jump.
 */
export function trackDynamicSubject(frames) {
  if (!frames.length) return { candidateIndexes: [], diagnostics: emptyDiagnostics() };
  const descriptors = frames.map((frame) => frame.candidates.map(describeCandidate));
  const costs = [];
  const parents = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const states = [...descriptors[frameIndex].keys(), NULL_STATE];
    const frameCosts = new Map();
    const frameParents = new Map();
    for (const state of states) {
      const emission = emissionCost(state === NULL_STATE ? null : descriptors[frameIndex][state]);
      if (frameIndex === 0) {
        frameCosts.set(state, emission);
        frameParents.set(state, null);
        continue;
      }
      let bestCost = Number.POSITIVE_INFINITY;
      let bestParent = NULL_STATE;
      for (const [previousState, previousCost] of costs[frameIndex - 1]) {
        const transition = transitionCost(
          previousState === NULL_STATE ? null : descriptors[frameIndex - 1][previousState],
          state === NULL_STATE ? null : descriptors[frameIndex][state],
        );
        const total = previousCost + transition + emission;
        if (total < bestCost) {
          bestCost = total;
          bestParent = previousState;
        }
      }
      frameCosts.set(state, bestCost);
      frameParents.set(state, bestParent);
    }
    costs.push(frameCosts);
    parents.push(frameParents);
  }

  const last = [...costs.at(-1).entries()].sort((left, right) => left[1] - right[1])[0]?.[0] ?? NULL_STATE;
  const candidateIndexes = Array(frames.length).fill(NULL_STATE);
  candidateIndexes[candidateIndexes.length - 1] = last;
  for (let index = frames.length - 1; index > 0; index -= 1) {
    candidateIndexes[index - 1] = parents[index].get(candidateIndexes[index]) ?? NULL_STATE;
  }

  let indexSwitchCount = 0;
  let impossibleJumpCount = 0;
  for (let index = 1; index < candidateIndexes.length; index += 1) {
    const previous = candidateIndexes[index - 1];
    const current = candidateIndexes[index];
    if (previous >= 0 && current >= 0 && previous !== current) indexSwitchCount += 1;
    if (previous >= 0 && current >= 0
      && transitionCost(descriptors[index - 1][previous], descriptors[index][current]) >= 8) {
      impossibleJumpCount += 1;
    }
  }
  const selectedFrameCount = candidateIndexes.filter((index) => index >= 0).length;
  return {
    candidateIndexes,
    diagnostics: {
      selectedFrameCount,
      gapFrameCount: candidateIndexes.length - selectedFrameCount,
      indexSwitchCount,
      impossibleJumpCount,
      selectedRatio: candidateIndexes.length ? selectedFrameCount / candidateIndexes.length : 0,
    },
  };
}

function describeCandidate(candidate) {
  const landmarks = candidate.landmarks ?? [];
  const visibleBody = BODY.map((index) => landmarks[index]).filter(visible);
  const torso = TORSO.map((index) => landmarks[index]);
  const shoulderCenter = pairCenter(torso[0], torso[1]);
  const hipCenter = pairCenter(torso[2], torso[3]);
  const points = torso.filter(visible);
  const center = averagePoint(points.length >= 2 ? points : visibleBody);
  const bounds = landmarkBounds(visibleBody);
  const shoulderWidth = pointDistance(torso[0], torso[1]);
  const hipWidth = pointDistance(torso[2], torso[3]);
  const torsoLength = pointDistance(shoulderCenter, hipCenter);
  const scale = Math.max(0.04, Math.sqrt(bounds.width * bounds.height));
  const meanVisibility = visibleBody.length
    ? visibleBody.reduce((sum, landmark) => sum + clamp(landmark.visibility ?? 0, 0, 1), 0) / visibleBody.length
    : 0;
  let geometryPenalty = 0;
  if (!center) geometryPenalty += 8;
  if (points.length < 3) geometryPenalty += 2.5;
  if (shoulderWidth !== null && shoulderWidth < 0.035) geometryPenalty += 2.5;
  if (hipWidth !== null && hipWidth < 0.025) geometryPenalty += 2.5;
  if (shoulderWidth !== null && hipWidth !== null) {
    const ratio = shoulderWidth / Math.max(hipWidth, 1e-4);
    if (ratio < 0.35 || ratio > 3.5) geometryPenalty += 1.5;
  }
  if (bounds.width * bounds.height < 0.008) geometryPenalty += 2;
  return {
    center,
    shoulderCenter,
    hipCenter,
    shoulderWidth,
    hipWidth,
    torsoLength,
    scale,
    meanVisibility,
    geometryPenalty,
    color: candidate.torsoColor ?? [0, 0, 0],
  };
}

function emissionCost(descriptor) {
  if (!descriptor) return 2.6;
  const dominanceReward = descriptor.scale * 2.2 + descriptor.meanVisibility * 0.65;
  return descriptor.geometryPenalty - dominanceReward;
}

function transitionCost(previous, current) {
  if (!previous && !current) return 0.08;
  if (!previous || !current) return 0.7;
  if (!previous.center || !current.center) return 12;
  const center = pointDistance(previous.center, current.center) ?? 1;
  const shoulder = nullableDistance(previous.shoulderCenter, current.shoulderCenter);
  const hip = nullableDistance(previous.hipCenter, current.hipCenter);
  const scaleChange = Math.abs(Math.log(current.scale / previous.scale));
  const shapeChange = normalizedDifference(previous.shoulderWidth, current.shoulderWidth)
    + normalizedDifference(previous.hipWidth, current.hipWidth)
    + normalizedDifference(previous.torsoLength, current.torsoLength);
  const color = Math.hypot(
    current.color[0] - previous.color[0],
    current.color[1] - previous.color[1],
    current.color[2] - previous.color[2],
  );
  const jumpPenalty = center > 0.16 || shoulder > 0.18 || hip > 0.18 ? 12 : 0;
  return center * 12 + shoulder * 7 + hip * 7 + scaleChange * 1.4 + shapeChange * 0.7 + color * 0.45 + jumpPenalty;
}

function visible(landmark) {
  return Boolean(landmark)
    && Number.isFinite(landmark.x)
    && Number.isFinite(landmark.y)
    && (landmark.visibility ?? 0) >= 0.2;
}

function pairCenter(left, right) {
  return visible(left) && visible(right) ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : null;
}

function averagePoint(points) {
  if (!points.length) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function pointDistance(left, right) {
  return left && right ? Math.hypot(left.x - right.x, left.y - right.y) : null;
}

function nullableDistance(left, right) {
  return pointDistance(left, right) ?? 0.12;
}

function normalizedDifference(left, right) {
  if (left === null || right === null) return 0.75;
  return Math.abs(left - right) / Math.max(0.03, left, right);
}

function landmarkBounds(landmarks) {
  if (!landmarks.length) return { width: 0, height: 0 };
  const xs = landmarks.map((landmark) => landmark.x);
  const ys = landmarks.map((landmark) => landmark.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function emptyDiagnostics() {
  return { selectedFrameCount: 0, gapFrameCount: 0, indexSwitchCount: 0, impossibleJumpCount: 0, selectedRatio: 0 };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
