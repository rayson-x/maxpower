import type { PoseEstimate } from "./PoseEngine";
import {
  DEFAULT_REP_SEGMENTATION_CONFIG,
  segmentRepsBySignalWithConfig,
  type RepSegmentationConfig,
  type RepSegment,
  type SignalKind,
} from "./repSegmenter";
import { selectTrainingWindow } from "./trainingWindow";

export interface HumanRepBoundary {
  repIndex: number;
  startMs: number;
  peakMs: number;
  endMs: number;
  note?: string;
}

export interface SegmentationTrainingCapture {
  captureId: string;
  poses: PoseEstimate[];
  truth: HumanRepBoundary[];
  signal: SignalKind;
  effortExtreme: "min" | "max";
  negativeWindows?: TimeWindow[];
}

export interface AnnotationValidationInput {
  exerciseId: string;
  capturePosition: string;
  expectedCount: string;
  durationMs: number;
  segments: readonly HumanRepBoundary[];
}

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

export interface SegmentationMetrics {
  captureCount: number;
  truthCount: number;
  predictedCount: number;
  exactCountCaptures: number;
  countAbsoluteError: number;
  matchedReps: number;
  falsePositiveReps: number;
  missedReps: number;
  /** End-to-end predictions whose peak remains inside reviewed non-rep time. */
  negativeWindowFalsePositives: number;
  /** Diagnostic triggers before the production training-window filter. */
  rawNegativeWindowTriggers: number;
  precision: number;
  recall: number;
  f1: number;
  meanBoundaryErrorMs: number | null;
  loss: number;
}

export interface CalibrationResult {
  config: RepSegmentationConfig;
  metrics: SegmentationMetrics;
}

/** Stable data-contract checks before an annotation may tune a counter. */
export function validateSegmentationAnnotation(input: AnnotationValidationInput): string[] {
  const issues: string[] = [];
  const expectedCount = Number(input.expectedCount);
  if (!input.exerciseId) issues.push("missing_exercise");
  if (!input.capturePosition) issues.push("missing_capture_position");
  if (!Number.isInteger(expectedCount) || expectedCount <= 0) issues.push("invalid_expected_count");
  if (Number.isInteger(expectedCount) && expectedCount !== input.segments.length) {
    issues.push("count_boundary_mismatch");
  }

  let previousEnd = -Infinity;
  input.segments.forEach((segment, index) => {
    if (segment.repIndex !== index + 1) issues.push("non_sequential_rep_index");
    if (![segment.startMs, segment.peakMs, segment.endMs].every(Number.isFinite)) {
      issues.push("non_finite_boundary");
      return;
    }
    if (
      segment.startMs < 0 ||
      segment.startMs > segment.peakMs ||
      segment.peakMs > segment.endMs ||
      segment.endMs > input.durationMs
    ) {
      issues.push("invalid_boundary_order_or_range");
    }
    if (segment.startMs < previousEnd) issues.push("overlapping_boundaries");
    if (segment.endMs - segment.startMs < 250) issues.push("boundary_too_short");
    previousEnd = segment.endMs;
  });
  return [...new Set(issues)];
}

/** Complement of fully reviewed rep ranges; these spans are noise/rest evidence. */
export function reviewedNegativeWindows(
  durationMs: number,
  segments: readonly HumanRepBoundary[],
  minimumWindowMs = 250,
): TimeWindow[] {
  const windows: TimeWindow[] = [];
  let cursor = 0;
  for (const segment of [...segments].sort((left, right) => left.startMs - right.startMs)) {
    if (segment.startMs - cursor >= minimumWindowMs) windows.push({ startMs: cursor, endMs: segment.startMs });
    cursor = Math.max(cursor, segment.endMs);
  }
  if (durationMs - cursor >= minimumWindowMs) windows.push({ startMs: cursor, endMs: durationMs });
  return windows;
}

export function evaluateSegmentationConfig(
  captures: readonly SegmentationTrainingCapture[],
  config: Readonly<RepSegmentationConfig>,
): SegmentationMetrics {
  let truthCount = 0;
  let predictedCount = 0;
  let exactCountCaptures = 0;
  let countAbsoluteError = 0;
  let matchedReps = 0;
  let falsePositiveReps = 0;
  let missedReps = 0;
  let negativeWindowFalsePositives = 0;
  let rawNegativeWindowTriggers = 0;
  let boundaryErrorTotal = 0;
  let boundaryValueCount = 0;

  for (const capture of captures) {
    const stable = selectTrainingWindow(capture.poses);
    const predicted = segmentRepsBySignalWithConfig(
      stable.poses,
      capture.signal,
      capture.effortExtreme,
      config,
    );
    const negativeWindows = capture.negativeWindows ?? [];
    negativeWindowFalsePositives += countPeaksInWindows(predicted, negativeWindows);
    if (negativeWindows.length) {
      const rawPredicted = segmentRepsBySignalWithConfig(
        capture.poses,
        capture.signal,
        capture.effortExtreme,
        config,
      );
      rawNegativeWindowTriggers += countPeaksInWindows(rawPredicted, negativeWindows);
    }
    const matched = matchReps(capture.truth, predicted);
    truthCount += capture.truth.length;
    predictedCount += predicted.length;
    if (capture.truth.length === predicted.length) exactCountCaptures += 1;
    countAbsoluteError += Math.abs(capture.truth.length - predicted.length);
    matchedReps += matched.matches.length;
    falsePositiveReps += matched.falsePositiveCount;
    missedReps += matched.missedCount;
    for (const match of matched.matches) {
      boundaryErrorTotal +=
        Math.abs(match.truth.startMs - match.predicted.startMs) +
        Math.abs(match.truth.peakMs - match.predicted.peakMs) +
        Math.abs(match.truth.endMs - match.predicted.endMs);
      boundaryValueCount += 3;
    }
  }

  const precision = ratio(matchedReps, matchedReps + falsePositiveReps);
  const recall = ratio(matchedReps, matchedReps + missedReps);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const meanBoundaryErrorMs = boundaryValueCount ? boundaryErrorTotal / boundaryValueCount : null;
  // Count mistakes dominate; boundary error breaks ties without rewarding a
  // configuration that predicts fewer, overly broad cycles.
  const loss = countAbsoluteError * 10 + falsePositiveReps * 3 + missedReps * 3 +
    negativeWindowFalsePositives * 5 +
    (meanBoundaryErrorMs ?? 10_000) / 1000;
  return {
    captureCount: captures.length,
    truthCount,
    predictedCount,
    exactCountCaptures,
    countAbsoluteError,
    matchedReps,
    falsePositiveReps,
    missedReps,
    negativeWindowFalsePositives,
    rawNegativeWindowTriggers,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    meanBoundaryErrorMs: meanBoundaryErrorMs === null ? null : Math.round(meanBoundaryErrorMs),
    loss: Number(loss.toFixed(3)),
  };
}

export function chooseSegmentationConfig(
  captures: readonly SegmentationTrainingCapture[],
  candidates: readonly RepSegmentationConfig[],
): CalibrationResult {
  if (!captures.length) throw new Error("At least one capture is required for calibration.");
  if (!candidates.length) throw new Error("At least one segmentation configuration is required.");
  return candidates
    .map((config) => ({ config: { ...config }, metrics: evaluateSegmentationConfig(captures, config) }))
    .sort((left, right) =>
      left.metrics.loss - right.metrics.loss ||
      configDistanceFromDefault(left.config) - configDistanceFromDefault(right.config),
    )[0];
}

export function segmentationCalibrationGrid(): RepSegmentationConfig[] {
  const configs: RepSegmentationConfig[] = [];
  for (const smoothingAlpha of [0.2, 0.35, 0.5]) {
    for (const hysteresisRatio of [0.12, 0.16, 0.2, 0.24, 0.28]) {
      for (const minRepMs of [500, 700, 900]) {
        for (const minCycleAmplitudeRatio of [0, 0.15, 0.25]) {
          configs.push({
            smoothingAlpha,
            hysteresisRatio,
            minRepMs,
            maxRepMs: DEFAULT_REP_SEGMENTATION_CONFIG.maxRepMs,
            minCycleAmplitudeRatio,
          });
        }
      }
    }
  }
  return configs;
}

function matchReps(truth: readonly HumanRepBoundary[], predicted: readonly RepSegment[]) {
  const unmatched = new Set(predicted.map((_, index) => index));
  const matches: Array<{ truth: HumanRepBoundary; predicted: RepSegment }> = [];
  for (const actual of truth) {
    let bestIndex: number | null = null;
    let bestScore = 0;
    for (const index of unmatched) {
      const candidate = predicted[index];
      const intersection = Math.max(0, Math.min(actual.endMs, candidate.endMs) - Math.max(actual.startMs, candidate.startMs));
      const union = Math.max(actual.endMs, candidate.endMs) - Math.min(actual.startMs, candidate.startMs);
      const overlap = union > 0 ? intersection / union : 0;
      const peakInside = candidate.peakMs >= actual.startMs && candidate.peakMs <= actual.endMs;
      const score = overlap + (peakInside ? 0.5 : 0);
      if ((overlap >= 0.2 || peakInside) && score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex !== null) {
      matches.push({ truth: actual, predicted: predicted[bestIndex] });
      unmatched.delete(bestIndex);
    }
  }
  return {
    matches,
    falsePositiveCount: unmatched.size,
    missedCount: truth.length - matches.length,
  };
}

function countPeaksInWindows(
  segments: readonly Pick<RepSegment, "peakMs">[],
  windows: readonly TimeWindow[],
): number {
  return segments.filter((segment) =>
    windows.some((window) => segment.peakMs >= window.startMs && segment.peakMs <= window.endMs),
  ).length;
}

function configDistanceFromDefault(config: Readonly<RepSegmentationConfig>): number {
  return (
    Math.abs(config.smoothingAlpha - DEFAULT_REP_SEGMENTATION_CONFIG.smoothingAlpha) +
    Math.abs(config.hysteresisRatio - DEFAULT_REP_SEGMENTATION_CONFIG.hysteresisRatio) +
    Math.abs(config.minRepMs - DEFAULT_REP_SEGMENTATION_CONFIG.minRepMs) / 1000 +
    Math.abs(config.minCycleAmplitudeRatio - DEFAULT_REP_SEGMENTATION_CONFIG.minCycleAmplitudeRatio)
  );
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
