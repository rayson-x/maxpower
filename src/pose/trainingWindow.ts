import type { PoseEstimate, PoseLandmark } from "./PoseEngine";

/**
 * The camera stream contains more than the set: people walk into frame, adjust
 * the tripod, or leave after the last rep.  Those motions are meaningful for a
 * recorder, but they must not influence the rep signal's robust range or its
 * extrema.  This module chooses one continuous, camera-stable training window
 * before any segmentation/classification/scoring consumer runs.
 *
 * Deliberately do not use vertical body motion here: it is the primary signal
 * for pull-ups and squats.  We only use global lateral travel and apparent
 * torso-size change, which indicate entering/leaving/repositioning rather than
 * an in-place repetition.
 */
export interface TrainingWindow {
  poses: PoseEstimate[];
  rawPoseCount: number;
  excludedPoseCount: number;
  startMs: number | null;
  endMs: number | null;
  /** true when a shorter stable run was selected from a longer recording. */
  trimmed: boolean;
}

const VISIBILITY = 0.5;
const MAX_GAP_MS = 550;
const MAX_LATERAL_TORSO_PER_SEC = 0.65;
const MAX_SCALE_LOG_CHANGE_PER_SEC = 0.22;
const MIN_WINDOW_MS = 2_000;
const MIN_WINDOW_POSES = 12;

interface SubjectAnchor {
  x: number;
  scale: number;
}

function visible(point: PoseLandmark | undefined): point is PoseLandmark {
  return !!point && point.visibility >= VISIBILITY;
}

function anchorOf(pose: PoseEstimate): SubjectAnchor | null {
  // BlazePose indices are stable in our canonical representation. Requiring
  // three of these four points tolerates a single occluded shoulder/hip while
  // excluding the partial poses that happen while the subject enters frame.
  const joints = [
    pose.landmarks[11],
    pose.landmarks[12],
    pose.landmarks[23],
    pose.landmarks[24],
  ].filter(visible);
  if (joints.length < 3) return null;

  const shoulders = [pose.landmarks[11], pose.landmarks[12]].filter(visible);
  const hips = [pose.landmarks[23], pose.landmarks[24]].filter(visible);
  if (!shoulders.length || !hips.length) return null;

  const shoulder = {
    x: shoulders.reduce((total, joint) => total + joint.x, 0) / shoulders.length,
    y: shoulders.reduce((total, joint) => total + joint.y, 0) / shoulders.length,
  };
  const hip = {
    x: hips.reduce((total, joint) => total + joint.x, 0) / hips.length,
    y: hips.reduce((total, joint) => total + joint.y, 0) / hips.length,
  };
  const scale = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
  if (!Number.isFinite(scale) || scale < 0.03) return null;
  return { x: (shoulder.x + hip.x) / 2, scale };
}

function isStableTransition(
  previous: PoseEstimate,
  previousAnchor: SubjectAnchor,
  current: PoseEstimate,
  currentAnchor: SubjectAnchor,
): boolean {
  const elapsedSec = (current.timestampMs - previous.timestampMs) / 1000;
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0 || elapsedSec * 1000 > MAX_GAP_MS) return false;
  const scale = (previousAnchor.scale + currentAnchor.scale) / 2;
  const lateralPerSec = Math.abs(currentAnchor.x - previousAnchor.x) / scale / elapsedSec;
  const scaleLogChangePerSec =
    Math.abs(Math.log(currentAnchor.scale / previousAnchor.scale)) / elapsedSec;
  return (
    lateralPerSec <= MAX_LATERAL_TORSO_PER_SEC &&
    scaleLogChangePerSec <= MAX_SCALE_LOG_CHANGE_PER_SEC
  );
}

/**
 * Select the longest continuous in-place portion of the recording.  If the
 * input has no trustworthy stable run, retain the original poses rather than
 * inventing a result or silently dropping an entire short set.
 */
export function selectTrainingWindow(poses: readonly PoseEstimate[]): TrainingWindow {
  if (poses.length === 0) {
    return { poses: [], rawPoseCount: 0, excludedPoseCount: 0, startMs: null, endMs: null, trimmed: false };
  }

  const runs: PoseEstimate[][] = [];
  let run: PoseEstimate[] = [];
  let previousPose: PoseEstimate | null = null;
  let previousAnchor: SubjectAnchor | null = null;

  const finishRun = () => {
    if (run.length) runs.push(run);
    run = [];
  };

  for (const pose of poses) {
    const anchor = anchorOf(pose);
    if (!anchor) {
      finishRun();
      previousPose = null;
      previousAnchor = null;
      continue;
    }
    if (
      previousPose &&
      previousAnchor &&
      !isStableTransition(previousPose, previousAnchor, pose, anchor)
    ) {
      finishRun();
    }
    run.push(pose);
    previousPose = pose;
    previousAnchor = anchor;
  }
  finishRun();

  const viable = runs.filter((candidate) => {
    if (candidate.length < MIN_WINDOW_POSES) return false;
    const duration = candidate[candidate.length - 1].timestampMs - candidate[0].timestampMs;
    return duration >= MIN_WINDOW_MS;
  });
  const selected = viable.reduce<PoseEstimate[] | null>((best, candidate) => {
    if (!best) return candidate;
    const bestDuration = best[best.length - 1].timestampMs - best[0].timestampMs;
    const candidateDuration = candidate[candidate.length - 1].timestampMs - candidate[0].timestampMs;
    return candidateDuration > bestDuration ? candidate : best;
  }, null);

  // A stationary short set should still get a normal analysis.  The filter is
  // conservative: it only removes frames when there is a clearly valid stable
  // window to use instead.
  const kept = selected ?? [...poses];
  return {
    poses: kept,
    rawPoseCount: poses.length,
    excludedPoseCount: poses.length - kept.length,
    startMs: kept.length ? kept[0].timestampMs : null,
    endMs: kept.length ? kept[kept.length - 1].timestampMs : null,
    trimmed: selected !== null && kept.length !== poses.length,
  };
}
