import fs from "node:fs";
import path from "node:path";

import {
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm.js";
import type { PoseEstimate } from "../../src/pose/PoseEngine.js";

interface Segment { startMs: number; peakMs: number; endMs: number; note?: string }
interface RecordRow {
  captureId: string;
  sourceCaptureId?: string;
  exerciseId: string;
  capturePosition: string;
  expectedCount: number;
  evaluationWindow?: { startMs: number; endMs: number } | null;
  segments: Segment[];
  source: { keypoints: string };
}
interface Fixture { poses: PoseEstimate[] }
interface StoredProfile extends Omit<RustExerciseProfileData, "contentHash"> { contentHash: string }
interface ProfileEntry {
  exerciseId: string;
  capturePosition: string;
  trainingSide: "bilateral";
  variation: "unrecorded";
  profile: StoredProfile;
  evidence: object;
}
interface Artifact { schemaVersion: string; profiles: ProfileEntry[]; skippedBuckets?: object[] }
interface LoadedRecord { record: RecordRow; fixture: Fixture }
interface ReplayRow {
  captureId: string;
  sourceCaptureId: string;
  expectedSetCount: number;
  truthCount: number;
  predictedCount: number;
  matchedCount: number;
  alignedCount: number;
  alignmentErrorMs: number;
  falsePositiveCount: number;
  needsReviewCount: number;
  rejectedCount: number;
  exact: boolean;
  exactAnnotatedBoundaries: boolean;
  segmentMatches: SegmentMatch[];
  truthSegments: Segment[];
  predictedSegments: Segment[];
  needsReviewSegments: Segment[];
  rejectedSegments: Segment[];
  evidenceReasonCounts: Record<string, number>;
  observationFindingCounts: Record<string, number>;
}
interface Evaluation { rows: ReplayRow[]; score: number }
export interface ReplayObjectiveRow {
  expectedSetCount: number;
  truthCount: number;
  predictedCount: number;
  matchedCount: number;
  alignedCount: number;
  alignmentErrorMs: number;
  falsePositiveCount: number;
  needsReviewCount: number;
  exact: boolean;
}

export interface SegmentMatch {
  truthIndex: number;
  predictedIndex: number;
  startOffsetMs: number;
  peakOffsetMs: number;
  endOffsetMs: number;
  intersectionOverUnion: number;
  aligned: boolean;
}

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.resolve(
  process.env.MAXPOWER_CONFIRMED_ARCHIVE_DIR
    ?? path.join(ROOT, "public", "archives", "confirmed-captures"),
);
export const TIMELINE_ALIGNMENT_TOLERANCE_MS = Object.freeze({ start: 500, peak: 250, end: 500 });
const SCALE = [0.55, 0.7, 0.85, 1, 1.2, 1.45, 1.8];

function option(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function positiveIntegerOption(argv: readonly string[], name: string, fallback: number): number {
  const raw = option(argv, name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function resolveTuningArtifactPaths(argv: readonly string[], rootDir = process.cwd()) {
  const datasetArgument = option(argv, "--dataset");
  const sourceArgument = option(argv, "--source");
  const outputArgument = option(argv, "--output");
  if (!datasetArgument || !sourceArgument || !outputArgument) {
    throw new Error("Usage: --dataset data/training/<dataset>.json --source <same-run-candidate>.json --output data/workflows/motion-profile/<workflow>/<run>/candidates/<file>.json [--report <same-run-path>.json]");
  }
  const outputPath = path.resolve(rootDir, outputArgument);
  const relativeOutput = path.relative(rootDir, outputPath);
  const parts = relativeOutput.split(path.sep);
  const isWorkflowCandidate = !path.isAbsolute(relativeOutput)
    && !relativeOutput.startsWith("..")
    && parts.length >= 7
    && parts[0] === "data"
    && parts[1] === "workflows"
    && parts[2] === "motion-profile"
    && parts[5] === "candidates";
  if (!isWorkflowCandidate) {
    throw new Error("--output must be inside data/workflows/motion-profile/<workflow>/<run>/candidates/");
  }
  const runRoot = path.resolve(rootDir, ...parts.slice(0, 5));
  const datasetPath = path.resolve(rootDir, datasetArgument);
  const relativeDataset = path.relative(rootDir, datasetPath);
  if (path.isAbsolute(relativeDataset) || relativeDataset.startsWith("..") || !relativeDataset.startsWith(`data${path.sep}training${path.sep}`)) {
    throw new Error("--dataset must be inside data/training/");
  }
  const sourcePath = path.resolve(rootDir, sourceArgument);
  const relativeSource = path.relative(runRoot, sourcePath);
  if (path.isAbsolute(relativeSource) || relativeSource.startsWith("..") || !relativeSource.startsWith(`candidates${path.sep}`)) {
    throw new Error("--source must be a candidate inside the same workflow run as --output");
  }
  const reportPath = path.resolve(rootDir, option(argv, "--report") ?? path.join(runRoot, "training-report.json"));
  const relativeReport = path.relative(runRoot, reportPath);
  if (relativeReport === "" || relativeReport.startsWith("..") || path.isAbsolute(relativeReport)) {
    throw new Error("--report must stay inside the same workflow run as --output");
  }
  return { datasetPath, sourcePath, outputPath, reportPath };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { datasetPath, sourcePath, outputPath, reportPath } = resolveTuningArtifactPaths(argv, ROOT);
  const onlyBucket = option(argv, "--only-bucket");
  const evaluateOnly = argv.includes("--evaluate-only");
  const initialOnly = argv.includes("--initial-only");
  const forcedStateMachine = option(argv, "--state-machine") as RustExerciseProfileData["stateMachineId"] | null;
  const beamSearch = argv.includes("--beam-search");
  const beamWidth = positiveIntegerOption(argv, "--beam-width", 12);
  const beamRounds = positiveIntegerOption(argv, "--beam-rounds", 4);
  const dataset = readJson<{ records: RecordRow[] }>(datasetPath);
  const source = readJson<Artifact>(sourcePath);
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(path.join(ROOT, "public", "motion-sdk", "maxpower_motion_sdk.wasm")));
  const buckets = group(dataset.records);
  const entries: ProfileEntry[] = [];
  const reports = [];

  for (const [key, records] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (onlyBucket && key !== onlyBucket) continue;
    const loaded = records.map((record) => ({
      record,
      fixture: readJson<Fixture[]>(path.join(ARCHIVE_ROOT, record.source.keypoints))[0],
    }));
    const original = source.profiles.find((entry) => `${entry.exerciseId}|${entry.capturePosition}` === key);
    const fallback = original ?? source.profiles.find((entry) => entry.exerciseId === records[0].exerciseId);
    if (!fallback) {
      reports.push({ key, status: "unavailable", reason: "No same-action signal topology is available." });
      continue;
    }
    const base = deserialize(fallback.profile);
    const exactIdentity = `${records[0].exerciseId}/${records[0].capturePosition}/bilateral/observed-tuned/v2`;
    let best = profileWith(base, exactIdentity, forcedStateMachine
      ? { stateMachineId: forcedStateMachine }
      : {});
    let bestEvaluation = evaluate(loaded, best, wasm);
    const baseline = bestEvaluation;
    const initialEvaluations = (evaluateOnly ? [] : initialSignalProfiles(base, exactIdentity))
      .map((candidate) => forcedStateMachine
        ? profileWith(candidate, exactIdentity, { stateMachineId: forcedStateMachine })
        : candidate)
      .map((candidate) => ({
        candidate,
        result: evaluate(loaded, candidate, wasm),
      }));
    for (const { candidate, result } of initialEvaluations) {
      if (result.score > bestEvaluation.score) {
        best = candidate;
        bestEvaluation = result;
      }
    }

    // Signal topology and threshold search are coupled. Refine several
    // high-potential topologies independently before selecting one, otherwise
    // a mediocre signal with one lucky exact count wins the billion-point
    // exact-set bonus and prevents a much better-aligned signal from ever
    // receiving threshold tuning.
    if (!evaluateOnly && !initialOnly) {
      for (const seed of [...initialEvaluations]
        .sort((left, right) => explorationScore(right.result.rows) - explorationScore(left.result.rows))
        .slice(0, 12)) {
        const refined = optimizeProfile(loaded, seed.candidate, wasm, exactIdentity, 2, false);
        if (refined.evaluation.score > bestEvaluation.score) {
          best = refined.profile;
          bestEvaluation = refined.evaluation;
        }
      }
      const refinedBest = optimizeProfile(loaded, best, wasm, exactIdentity, 5, true);
      best = refinedBest.profile;
      bestEvaluation = refinedBest.evaluation;
      if (beamSearch && bestEvaluation.rows.some((row) => !row.exact)) {
        const beam = optimizeProfileBeam(
          loaded,
          [best, ...initialEvaluations.map(({ candidate }) => candidate)],
          wasm,
          exactIdentity,
          beamRounds,
          beamWidth,
        );
        if (beam.evaluation.score > bestEvaluation.score) {
          best = beam.profile;
          bestEvaluation = beam.evaluation;
        }
      }
    }

    const serialized = serialize(best);
    entries.push({
      ...fallback,
      exerciseId: records[0].exerciseId,
      capturePosition: records[0].capturePosition,
      profile: serialized,
      evidence: {
        ...fallback.evidence,
        tuning: evaluateOnly
          ? "evaluation-only"
          : initialOnly ? "initial-signal-search/v2" : "coordinate-search/v2",
        beamSearch: beamSearch && !evaluateOnly
          ? { width: beamWidth, rounds: beamRounds }
          : null,
        inSampleOnly: true,
        promotionPassed: false,
        sourceCaptureIds: records.map((record) => record.captureId),
      },
    });
    reports.push({
      key,
      status: "evaluated",
      sourceProfileKey: `${fallback.exerciseId}|${fallback.capturePosition}`,
      baseline: summarize(baseline.rows),
      tuned: summarize(bestEvaluation.rows),
      initialSignalSearch: initialEvaluations
        .sort((left, right) => right.result.score - left.result.score)
        .slice(0, 12)
        .map(({ candidate, result }) => ({
          stateMachineId: candidate.stateMachineId,
          coordinateUnit: candidate.coordinateUnit,
          direction: candidate.direction,
          primarySignal: candidate.primarySignal,
          secondarySignal: candidate.secondarySignal,
          summary: summarize(result.rows),
          rows: result.rows,
        })),
      annotatedRepNotes: records.flatMap((record) => record.segments
        .filter((segment) => segment.note?.trim())
        .map((segment) => ({ captureId: record.captureId, peakMs: segment.peakMs, note: segment.note }))),
      profile: serialized,
      rows: bestEvaluation.rows,
    });
    process.stdout.write(`${key}: ${format(baseline.rows)} -> ${format(bestEvaluation.rows)}\n`);
  }

  const allRows = reports.flatMap((report): ReplayRow[] =>
    report.status === "evaluated" && "rows" in report ? report.rows as ReplayRow[] : [],
  );
  const report = {
    schemaVersion: "maxpower-existing-video-profile-tuning/v2",
    generatedAt: new Date().toISOString(),
    purpose: evaluateOnly
      ? "Evaluation-only in-sample replay of a frozen candidate against full approved videos."
      : "In-sample diagnostic optimization against full approved videos using the explicit product set lifecycle.",
    promotionPassed: false,
    refusal: "The same captures selected these parameters; an independently held-out gate is still required.",
    replayPolicy: {
      setLifecycleMode: "preview",
      beginSetAtMs: 0,
      fullVideoNegativeContext: true,
      predictionFiltering: "none",
    },
    summary: summarize(allRows),
    buckets: reports,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const mergedProfiles = mergeProfileEntries(source.profiles, entries);
  fs.writeFileSync(outputPath, `${JSON.stringify({ ...source, generatedAt: report.generatedAt, profiles: mergedProfiles, skippedBuckets: [] }, null, 2)}\n`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: outputPath, report: reportPath, summary: report.summary }, null, 2)}\n`);
}

function evaluate(records: readonly LoadedRecord[], profile: RustExerciseProfileData, wasm: MotionWasmExports): Evaluation {
  const rows = records.map(({ record, fixture }) => replay(record, fixture, profile, wasm));
  const annotatedDurations = records
    .flatMap(({ record }) => record.segments.map((segment) => segment.endMs - segment.startMs))
    .filter((duration) => duration >= 250);
  const shortestAnnotatedDuration = Math.min(...annotatedDurations);
  const longestAnnotatedDuration = Math.max(...annotatedDurations);
  const durationCompatible = annotatedDurations.length === 0 || (
    profile.minRepDurationMs <= shortestAnnotatedDuration * 0.8
    && profile.maxRepDurationMs >= longestAnnotatedDuration * 0.8
  );
  return {
    rows,
    score: scoreReplayObjective(rows, durationCompatible),
  };
}

export function scoreReplayObjective(
  rows: readonly ReplayObjectiveRow[],
  durationCompatible = true,
): number {
  const exact = rows.filter((row) => row.exact).length;
  const exactSetCount = rows.filter((row) => row.predictedCount === row.expectedSetCount).length;
  const truth = rows.reduce((sum, row) => sum + row.truthCount, 0);
  const predicted = rows.reduce((sum, row) => sum + row.predictedCount, 0);
  const matched = rows.reduce((sum, row) => sum + row.matchedCount, 0);
  const aligned = rows.reduce((sum, row) => sum + row.alignedCount, 0);
  const alignmentErrorMs = rows.reduce((sum, row) => sum + row.alignmentErrorMs, 0);
  const falsePositive = rows.reduce((sum, row) => sum + row.falsePositiveCount, 0);
  const countError = rows.reduce((sum, row) => sum + Math.abs(row.predictedCount - row.expectedSetCount), 0);
  const needsReview = rows.reduce((sum, row) => sum + row.needsReviewCount, 0);
  const recall = truth ? matched / truth : 0;
  const precision = predicted ? matched / predicted : 0;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  // A profile cannot buy recall with ghost cycles: optimize the weaker of
  // recall and precision after exact-count and strict-boundary coverage.
  const balancedFloor = Math.min(recall, precision);
  return (durationCompatible ? 0 : -10_000_000_000)
    // A count-equal set with one miss and one ghost cycle is not recognition.
    // The primary objective is one-to-one start/peak/end alignment; exact set
    // count is only a secondary signal within the same aligned frontier.
    + exact * 1_000_000_000
    + aligned * 10_000_000
    + exactSetCount * 1_000_000
    + Math.round(balancedFloor * 1_000_000) * 1_000
    + Math.round(f1 * 1_000)
    - falsePositive * 10
    - countError
    - needsReview
    - Math.round(alignmentErrorMs / 10);
}

function optimizeProfile(
  records: readonly LoadedRecord[],
  initial: RustExerciseProfileData,
  wasm: MotionWasmExports,
  identity: string,
  passCount: number,
  includeSignalVariants: boolean,
): { profile: RustExerciseProfileData; evaluation: Evaluation } {
  let profile = initial;
  let evaluation = evaluate(records, profile, wasm);
  for (let pass = 0; pass < passCount; pass += 1) {
    const neighborhoods = profileNeighborhoods(profile, identity, includeSignalVariants);
    let improved = false;
    for (const candidates of neighborhoods) {
      for (const candidate of candidates) {
        const result = evaluate(records, candidate, wasm);
        if (result.score > evaluation.score) {
          profile = candidate;
          evaluation = result;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return { profile, evaluation };
}

interface BeamItem {
  profile: RustExerciseProfileData;
  evaluation: Evaluation;
}

export function selectBeamByScore<T>(
  items: readonly T[],
  width: number,
  keyOf: (item: T) => string,
  scoreOf: (item: T) => number,
): T[] {
  const bestByKey = new Map<string, T>();
  for (const item of items) {
    const key = keyOf(item);
    const current = bestByKey.get(key);
    if (!current || scoreOf(item) > scoreOf(current)) bestByKey.set(key, item);
  }
  return [...bestByKey.values()]
    .sort((left, right) => scoreOf(right) - scoreOf(left) || keyOf(left).localeCompare(keyOf(right)))
    .slice(0, width);
}

export function mergeProfileEntries<T extends { exerciseId: string; capturePosition: string }>(
  source: readonly T[],
  tuned: readonly T[],
): T[] {
  const tunedByKey = new Map(tuned.map((entry) => [`${entry.exerciseId}|${entry.capturePosition}`, entry]));
  return [
    ...source.map((entry) => tunedByKey.get(`${entry.exerciseId}|${entry.capturePosition}`) ?? entry),
    ...tuned.filter((entry) => !source.some((existing) =>
      existing.exerciseId === entry.exerciseId && existing.capturePosition === entry.capturePosition
    )),
  ];
}

function optimizeProfileBeam(
  records: readonly LoadedRecord[],
  seeds: readonly RustExerciseProfileData[],
  wasm: MotionWasmExports,
  identity: string,
  roundCount: number,
  width: number,
): BeamItem {
  const cache = new Map<string, Evaluation>();
  const evaluateOnce = (profile: RustExerciseProfileData): Evaluation => {
    const key = profile.contentHash.toString();
    const cached = cache.get(key);
    if (cached) return cached;
    const result = evaluate(records, profile, wasm);
    cache.set(key, result);
    return result;
  };
  let beam = selectBeamByScore(
    seeds.map((profile) => ({ profile, evaluation: evaluateOnce(profile) })),
    width,
    (item) => item.profile.contentHash.toString(),
    (item) => item.evaluation.score,
  );
  for (let round = 0; round < roundCount; round += 1) {
    const expanded = [...beam];
    for (const item of beam) {
      for (const neighborhood of profileNeighborhoods(item.profile, identity, true)) {
        for (const profile of neighborhood) {
          expanded.push({ profile, evaluation: evaluateOnce(profile) });
        }
      }
    }
    const next = selectBeamByScore(
      expanded,
      width,
      (item) => item.profile.contentHash.toString(),
      (item) => item.evaluation.score,
    );
    if (next[0].evaluation.rows.every((row) => row.exact)) return next[0];
    if (next.every((item, index) => item.profile.contentHash === beam[index]?.profile.contentHash)) break;
    beam = next;
  }
  return beam[0];
}

function profileNeighborhoods(
  profile: RustExerciseProfileData,
  identity: string,
  includeSignalVariants: boolean,
): RustExerciseProfileData[][] {
  return [
    SCALE.map((factor) => profileWith(profile, identity, { startAmplitude: profile.startAmplitude * factor })),
    SCALE.map((factor) => profileWith(profile, identity, {
      minPrimaryAmplitude: profile.minPrimaryAmplitude * factor,
      minSecondaryAmplitude: profile.minSecondaryAmplitude * factor,
    })),
    SCALE.map((factor) => profileWith(profile, identity, { minPrimaryAmplitude: profile.minPrimaryAmplitude * factor })),
    SCALE.map((factor) => profileWith(profile, identity, { minSecondaryAmplitude: profile.minSecondaryAmplitude * factor })),
    SCALE.map((factor) => profileWith(profile, identity, { returnHysteresis: profile.returnHysteresis * factor })),
    SCALE.map((factor) => profileWith(profile, identity, { readyTolerance: profile.readyTolerance * factor })),
    [250, 350, 450, 600, 800, 1_000, 1_300, 1_600, 2_000].map((value) => profileWith(profile, identity, { minRepDurationMs: value })),
    [2_000, 3_000, 4_500, 6_000, 8_000, 12_000].map((value) => profileWith(profile, identity, { maxRepDurationMs: value })),
    [400, 700, 1_000, 1_500, 2_500].map((value) => profileWith(profile, identity, { maxGapMs: value })),
    ...(profile.stateMachineId === "alternating-ready-effort-return/v1"
      ? []
      : [([
          "ready-effort-peak-return/v1",
          "cycle-aligned-ready-effort-peak-return/v1",
          "median-100ms-ready-effort-peak-return/v1",
          "median-200ms-ready-effort-peak-return/v1",
          "median-300ms-ready-effort-peak-return/v1",
          "median-400ms-ready-effort-peak-return/v1",
          "median-600ms-ready-effort-peak-return/v1",
          "cycle-aligned-median-100ms-ready-effort-peak-return/v1",
          "cycle-aligned-median-200ms-ready-effort-peak-return/v1",
          "cycle-aligned-median-300ms-ready-effort-peak-return/v1",
          "cycle-aligned-median-400ms-ready-effort-peak-return/v1",
          "cycle-aligned-median-600ms-ready-effort-peak-return/v1",
          "stable-cycle-200ms-ready-effort-peak-return/v1",
        ] as const).map((stateMachineId) => profileWith(profile, identity, { stateMachineId }))]),
    (["auto", "increasing", "decreasing"] as const).map((direction) => profileWith(profile, identity, { direction })),
    ...(includeSignalVariants
      ? [signalVariants(profile).map((signals) => profileWith(profile, identity, signals))]
      : []),
  ];
}

function explorationScore(rows: readonly ReplayRow[]): number {
  const exact = rows.filter((row) => row.exact).length;
  const aligned = rows.reduce((sum, row) => sum + row.alignedCount, 0);
  const matched = rows.reduce((sum, row) => sum + row.matchedCount, 0);
  const alignmentErrorMs = rows.reduce((sum, row) => sum + row.alignmentErrorMs, 0);
  const falsePositive = rows.reduce((sum, row) => sum + row.falsePositiveCount, 0);
  const countError = rows.reduce((sum, row) => sum + Math.abs(row.predictedCount - row.expectedSetCount), 0);
  const exactSetCount = rows.filter((row) => row.predictedCount === row.expectedSetCount).length;
  // Seed selection must use the same acceptance hierarchy as the final
  // objective.  Count-only seeds previously crowded out candidates whose
  // complete cycles were closer to the human start/peak/end annotations.
  return exact * 1_000_000_000
    + aligned * 10_000_000
    + exactSetCount * 1_000_000
    + matched * 1_000
    - falsePositive * 40
    - countError * 10
    - Math.round(alignmentErrorMs / 10);
}

function replay(record: RecordRow, fixture: Fixture, profile: RustExerciseProfileData, wasm: MotionWasmExports): ReplayRow {
  const poses = record.evaluationWindow
    ? fixture.poses.filter((pose) =>
        pose.timestampMs >= record.evaluationWindow!.startMs && pose.timestampMs <= record.evaluationWindow!.endMs)
    : fixture.poses;
  const first = poses[0] as (PoseEstimate & { image?: { widthPx: number; heightPx: number; mirrored: boolean } }) | undefined;
  if (!first) throw new Error(`${record.captureId}: evaluation window contains no pose frames`);
  const session = new RustCanonicalWasmSession({
    sequenceId: `existing-video-tune:${record.captureId}`,
    schema: "blazepose33",
    image: {
      widthPx: first.image?.widthPx ?? 1280,
      heightPx: first.image?.heightPx ?? 720,
      rotationDegrees: 0,
      mirrored: first.image?.mirrored ?? false,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);
  session.installExerciseProfileData(profile);
  session.beginSet();
  const predicted: Segment[] = [];
  const needsReview: Segment[] = [];
  const rejected: Segment[] = [];
  const evidenceReasonCounts: Record<string, number> = {};
  const observationFindingCounts: Record<string, number> = {};
  const collectOutcomes = () => {
    for (const outcome of session.lastCompletedReps) {
      const segment = {
        startMs: Number(outcome.startTimestampMs),
        peakMs: Number(outcome.peakTimestampMs),
        endMs: Number(outcome.endTimestampMs),
        note: [outcome.evidenceReason, ...outcome.observationFindings].filter(Boolean).join(", ") || undefined,
      };
      if (outcome.disposition === "confirmed") predicted.push(segment);
      else if (outcome.disposition === "needs_review") needsReview.push(segment);
      else rejected.push(segment);
      if (outcome.evidenceReason) increment(evidenceReasonCounts, outcome.evidenceReason);
      for (const finding of outcome.observationFindings) increment(observationFindingCounts, finding);
    }
  };
  // Preparation, equipment adjustment, and reracking are labeled negative
  // context. They must remain in the optimization objective so a profile
  // cannot win by hiding predictions outside the annotated repetition span.
  for (const pose of poses) {
    session.process({
      timestampMs: pose.timestampMs,
      landmarks: pose.landmarks.map((landmark) => ({
        x: finite(landmark.x), y: finite(landmark.y), z: finite(landmark.z), visibility: landmark.visibility,
      })),
      worldLandmarks: pose.worldLandmarks ?? [],
    });
    collectOutcomes();
  }
  session.finishSet();
  collectOutcomes();
  session.close();
  const matches = matchSegments(record.segments, predicted);
  const matchedCount = matches.length;
  const alignedCount = matches.filter((match) => match.aligned).length;
  const alignmentErrorMs = matches.reduce((sum, match) => sum
    + Math.abs(match.startOffsetMs)
    + Math.abs(match.peakOffsetMs)
    + Math.abs(match.endOffsetMs), 0);
  const unlabeledExpectedRepCount = Math.max(0, record.expectedCount - record.segments.length);
  const falsePositiveCount = Math.max(0, predicted.length - matchedCount - unlabeledExpectedRepCount);
  return {
    captureId: record.captureId,
    sourceCaptureId: record.sourceCaptureId ?? record.captureId,
    expectedSetCount: record.expectedCount,
    truthCount: record.segments.length,
    predictedCount: predicted.length,
    matchedCount,
    alignedCount,
    alignmentErrorMs,
    falsePositiveCount,
    needsReviewCount: needsReview.length,
    rejectedCount: rejected.length,
    exact: predicted.length === record.expectedCount && alignedCount === record.segments.length,
    exactAnnotatedBoundaries: predicted.length === record.segments.length && alignedCount === record.segments.length,
    segmentMatches: matches,
    truthSegments: record.segments,
    predictedSegments: predicted,
    needsReviewSegments: needsReview,
    rejectedSegments: rejected,
    evidenceReasonCounts,
    observationFindingCounts,
  };
}

export function matchSegments(truth: readonly Segment[], predicted: readonly Segment[]): SegmentMatch[] {
  const remaining = new Set(predicted.map((_, index) => index));
  const matches: SegmentMatch[] = [];
  for (const [truthIndex, segment] of truth.entries()) {
    const candidate = [...remaining]
      .map((index) => ({ index, distance: Math.abs(predicted[index].peakMs - segment.peakMs) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (!candidate || candidate.distance > 1_500) continue;
    remaining.delete(candidate.index);
    const prediction = predicted[candidate.index];
    const startOffsetMs = prediction.startMs - segment.startMs;
    const peakOffsetMs = prediction.peakMs - segment.peakMs;
    const endOffsetMs = prediction.endMs - segment.endMs;
    const intersection = Math.max(0, Math.min(segment.endMs, prediction.endMs) - Math.max(segment.startMs, prediction.startMs));
    const union = Math.max(segment.endMs, prediction.endMs) - Math.min(segment.startMs, prediction.startMs);
    const intersectionOverUnion = union > 0 ? intersection / union : 0;
    matches.push({
      truthIndex,
      predictedIndex: candidate.index,
      startOffsetMs,
      peakOffsetMs,
      endOffsetMs,
      intersectionOverUnion,
      aligned: Math.abs(startOffsetMs) <= TIMELINE_ALIGNMENT_TOLERANCE_MS.start
        && Math.abs(peakOffsetMs) <= TIMELINE_ALIGNMENT_TOLERANCE_MS.peak
        && Math.abs(endOffsetMs) <= TIMELINE_ALIGNMENT_TOLERANCE_MS.end
        && intersectionOverUnion >= 0.6,
    });
  }
  return matches.sort((left, right) => left.truthIndex - right.truthIndex);
}

function profileWith(
  source: RustExerciseProfileData,
  identity: string,
  overrides: Partial<Omit<RustExerciseProfileData, "contentHash" | "identity">>,
): RustExerciseProfileData {
  const merged = { ...source, ...overrides };
  const minAmplitude = Math.max(0.001, Math.min(merged.minPrimaryAmplitude, merged.minSecondaryAmplitude));
  const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    ...merged,
    identity,
    startAmplitude: clamp(merged.startAmplitude, 0.001, minAmplitude * 0.92),
    returnHysteresis: clamp(merged.returnHysteresis, 0.001, minAmplitude * 0.92),
    readyTolerance: Math.max(0.001, merged.readyTolerance),
    minRepDurationMs: Math.max(100, Math.min(merged.minRepDurationMs, merged.maxRepDurationMs - 100)),
    maxRepDurationMs: Math.max(merged.maxRepDurationMs, merged.minRepDurationMs + 100),
    primarySignal: { ...merged.primarySignal },
    secondarySignal: { ...merged.secondarySignal },
  };
  return { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
}

function signalVariants(profile: RustExerciseProfileData): Partial<RustExerciseProfileData>[] {
  if (profile.primarySignal.kind !== "joint-angle" || profile.primarySignal.landmarks.length !== 3) return [{}];
  const left = { kind: "joint-angle" as const, landmarks: [11, 13, 15] as [number, number, number] };
  const right = { kind: "joint-angle" as const, landmarks: [12, 14, 16] as [number, number, number] };
  return [
    { primarySignal: left, secondarySignal: right },
    { primarySignal: left, secondarySignal: left },
    { primarySignal: right, secondarySignal: right },
  ];
}

function initialSignalProfiles(base: RustExerciseProfileData, identity: string): RustExerciseProfileData[] {
  const leftElbow = { kind: "joint-angle" as const, landmarks: [11, 13, 15] as [number, number, number] };
  const rightElbow = { kind: "joint-angle" as const, landmarks: [12, 14, 16] as [number, number, number] };
  const leftShoulder = { kind: "joint-angle" as const, landmarks: [23, 11, 13] as [number, number, number] };
  const rightShoulder = { kind: "joint-angle" as const, landmarks: [24, 12, 14] as [number, number, number] };
  const leftArmElevation = { kind: "joint-angle" as const, landmarks: [23, 11, 15] as [number, number, number] };
  const rightArmElevation = { kind: "joint-angle" as const, landmarks: [24, 12, 16] as [number, number, number] };
  const leftReach = { kind: "landmark-distance" as const, landmarks: [15, 11] as [number, number] };
  const rightReach = { kind: "landmark-distance" as const, landmarks: [16, 12] as [number, number] };
  const leftUpperArm = { kind: "landmark-distance" as const, landmarks: [13, 11] as [number, number] };
  const rightUpperArm = { kind: "landmark-distance" as const, landmarks: [14, 12] as [number, number] };
  const leftWristHip = { kind: "landmark-distance" as const, landmarks: [15, 23] as [number, number] };
  const rightWristHip = { kind: "landmark-distance" as const, landmarks: [16, 24] as [number, number] };
  const leftWristOppositeHip = { kind: "landmark-distance" as const, landmarks: [15, 24] as [number, number] };
  const rightWristOppositeHip = { kind: "landmark-distance" as const, landmarks: [16, 23] as [number, number] };
  const elbowSpread = { kind: "landmark-distance" as const, landmarks: [13, 14] as [number, number] };
  const wristSpread = { kind: "landmark-distance" as const, landmarks: [15, 16] as [number, number] };
  const leftElbowY = { kind: "landmark-y" as const, landmarks: [13] as [number] };
  const rightElbowY = { kind: "landmark-y" as const, landmarks: [14] as [number] };
  const leftWristY = { kind: "landmark-y" as const, landmarks: [15] as [number] };
  const rightWristY = { kind: "landmark-y" as const, landmarks: [16] as [number] };
  const meanShoulderY = { kind: "landmark-y" as const, landmarks: [11, 12] as [number, number] };
  const meanElbowY = { kind: "landmark-y" as const, landmarks: [13, 14] as [number, number] };
  const meanWristY = { kind: "landmark-y" as const, landmarks: [15, 16] as [number, number] };
  const leftHipY = { kind: "landmark-y" as const, landmarks: [23] as [number] };
  const rightHipY = { kind: "landmark-y" as const, landmarks: [24] as [number] };
  const meanHipY = { kind: "landmark-y" as const, landmarks: [23, 24] as [number, number] };
  const noseY = { kind: "landmark-y" as const, landmarks: [0] as [number] };
  const specifications = [
    { unit: "image-angle-deg" as const, primary: leftElbow, secondary: rightElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftElbow, secondary: leftElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: rightElbow, secondary: rightElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftShoulder, secondary: rightShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftShoulder, secondary: leftShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: rightShoulder, secondary: rightShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftArmElevation, secondary: rightArmElevation, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftArmElevation, secondary: leftArmElevation, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: rightArmElevation, secondary: rightArmElevation, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "torso-normalized-distance" as const, primary: leftReach, secondary: rightReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: leftReach, secondary: leftReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: rightReach, secondary: rightReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: wristSpread, secondary: wristSpread, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: leftUpperArm, secondary: rightUpperArm, start: 0.025, min: 0.10, hysteresis: 0.025, ready: 0.035 },
    { unit: "torso-normalized-distance" as const, primary: leftUpperArm, secondary: leftUpperArm, start: 0.025, min: 0.10, hysteresis: 0.025, ready: 0.035 },
    { unit: "torso-normalized-distance" as const, primary: rightUpperArm, secondary: rightUpperArm, start: 0.025, min: 0.10, hysteresis: 0.025, ready: 0.035 },
    { unit: "torso-normalized-distance" as const, primary: elbowSpread, secondary: elbowSpread, start: 0.025, min: 0.10, hysteresis: 0.025, ready: 0.035 },
    { unit: "torso-normalized-distance" as const, primary: leftWristHip, secondary: rightWristHip, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: leftWristHip, secondary: leftWristHip, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: rightWristHip, secondary: rightWristHip, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: leftWristOppositeHip, secondary: rightWristOppositeHip, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "image-normalized-y" as const, primary: leftElbowY, secondary: rightElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: leftElbowY, secondary: leftElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: rightElbowY, secondary: rightElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: leftWristY, secondary: rightWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
    { unit: "image-normalized-y" as const, primary: leftWristY, secondary: leftWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
    { unit: "image-normalized-y" as const, primary: rightWristY, secondary: rightWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
    { unit: "image-normalized-y" as const, primary: meanShoulderY, secondary: meanShoulderY, start: 0.01, min: 0.04, hysteresis: 0.01, ready: 0.015 },
    { unit: "image-normalized-y" as const, primary: meanElbowY, secondary: meanElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: meanWristY, secondary: meanWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
    { unit: "image-normalized-y" as const, primary: leftHipY, secondary: leftHipY, start: 0.01, min: 0.04, hysteresis: 0.01, ready: 0.015 },
    { unit: "image-normalized-y" as const, primary: rightHipY, secondary: rightHipY, start: 0.01, min: 0.04, hysteresis: 0.01, ready: 0.015 },
    { unit: "image-normalized-y" as const, primary: meanHipY, secondary: meanHipY, start: 0.01, min: 0.04, hysteresis: 0.01, ready: 0.015 },
    { unit: "image-normalized-y" as const, primary: noseY, secondary: noseY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
  ];
  const ordinary = specifications.map((specification) => profileWith(base, identity, {
    coordinateUnit: specification.unit,
    direction: "auto",
    primarySignal: specification.primary,
    secondarySignal: specification.secondary,
    startAmplitude: specification.start,
    minPrimaryAmplitude: specification.min,
    minSecondaryAmplitude: specification.min,
    returnHysteresis: specification.hysteresis,
    readyTolerance: specification.ready,
    minRepDurationMs: 350,
    maxRepDurationMs: 8_000,
  }));
  if (!identity.startsWith("single_arm_cable_lateral_raise/")) return ordinary;
  // These captures contain a front-facing block followed by a rear-facing
  // block. In the rear block the exercising arm and head leave the frame, but
  // both shoulders and hips remain observed. Search an explicit torso-motion
  // fallback so the profile can be diagnosed against evidence that actually
  // survives the turn, rather than extending hand predictions for seconds.
  const torsoYSignals = [
    [11], [12], [23], [24], [11, 12], [23, 24], [11, 23], [12, 24],
  ].map((landmarks) => ({ kind: "landmark-y" as const, landmarks: landmarks as [number, number?] }));
  const torsoDistanceSignals = [
    [11, 12], [23, 24], [11, 23], [12, 24], [11, 24], [12, 23],
  ].map((landmarks) => ({ kind: "landmark-distance" as const, landmarks: landmarks as [number, number] }));
  const torsoAngleSignals = [
    [23, 11, 12], [24, 12, 11], [11, 23, 24], [12, 24, 23],
  ].map((landmarks) => ({ kind: "joint-angle" as const, landmarks: landmarks as [number, number, number] }));
  const torsoFallbacks = [
    ...torsoYSignals.map((signal) => ({ unit: "image-normalized-y" as const, signal, start: 0.004, min: 0.015, hysteresis: 0.004, ready: 0.006 })),
    ...torsoDistanceSignals.map((signal) => ({ unit: "torso-normalized-distance" as const, signal, start: 0.008, min: 0.030, hysteresis: 0.008, ready: 0.012 })),
    ...torsoAngleSignals.map((signal) => ({ unit: "image-angle-deg" as const, signal, start: 2, min: 7, hysteresis: 2, ready: 3 })),
  ].map((specification) => profileWith(base, identity, {
    stateMachineId: "ready-effort-peak-return/v1",
    coordinateUnit: specification.unit,
    direction: "auto",
    primarySignal: specification.signal,
    secondarySignal: specification.signal,
    startAmplitude: specification.start,
    minPrimaryAmplitude: specification.min,
    minSecondaryAmplitude: specification.min,
    returnHysteresis: specification.hysteresis,
    readyTolerance: specification.ready,
    minRepDurationMs: 350,
    maxRepDurationMs: 8_000,
  }));
  const alternatingSpecifications = [
    { unit: "image-angle-deg" as const, primary: leftShoulder, secondary: rightShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftElbow, secondary: rightElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "torso-normalized-distance" as const, primary: leftReach, secondary: rightReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: leftUpperArm, secondary: rightUpperArm, start: 0.025, min: 0.10, hysteresis: 0.025, ready: 0.035 },
    { unit: "image-normalized-y" as const, primary: leftElbowY, secondary: rightElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: leftWristY, secondary: rightWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
  ];
  // Rust's alternating graph selects the stronger side at the beginning of
  // every cycle, but unlike the bilateral graph it cannot infer an Auto
  // direction before the first cycle exists. Search both explicit directions
  // so "left block, turn around, right block" recordings can switch the
  // visible anatomical side without deadlocking at Ready.
  const alternating = alternatingSpecifications.flatMap((specification) =>
    (["increasing", "decreasing"] as const).map((direction) => profileWith(base, identity, {
      stateMachineId: "alternating-ready-effort-return/v1",
      coordinateUnit: specification.unit,
      direction,
      primarySignal: specification.primary,
      secondarySignal: specification.secondary,
      startAmplitude: specification.start,
      minPrimaryAmplitude: specification.min,
      minSecondaryAmplitude: specification.min,
      returnHysteresis: specification.hysteresis,
      readyTolerance: specification.ready,
      minRepDurationMs: 350,
      maxRepDurationMs: 8_000,
    })),
  );
  return [...ordinary, ...torsoFallbacks, ...alternating];
}

function group(records: readonly RecordRow[]): Map<string, RecordRow[]> {
  const output = new Map<string, RecordRow[]>();
  for (const record of records) {
    const key = `${record.exerciseId}|${record.capturePosition}`;
    output.set(key, [...(output.get(key) ?? []), record]);
  }
  return output;
}

function summarize(rows: readonly ReplayRow[]) {
  const truth = rows.reduce((sum, row) => sum + row.truthCount, 0);
  const expected = rows.reduce((sum, row) => sum + row.expectedSetCount, 0);
  const predicted = rows.reduce((sum, row) => sum + row.predictedCount, 0);
  const matched = rows.reduce((sum, row) => sum + row.matchedCount, 0);
  const aligned = rows.reduce((sum, row) => sum + row.alignedCount, 0);
  const bySource = new Map<string, ReplayRow[]>();
  for (const row of rows) bySource.set(row.sourceCaptureId, [...(bySource.get(row.sourceCaptureId) ?? []), row]);
  const sourceRows = [...bySource.values()].map((parts) => ({
    expected: parts.reduce((sum, row) => sum + row.expectedSetCount, 0),
    truth: parts.reduce((sum, row) => sum + row.truthCount, 0),
    predicted: parts.reduce((sum, row) => sum + row.predictedCount, 0),
    matched: parts.reduce((sum, row) => sum + row.matchedCount, 0),
    aligned: parts.reduce((sum, row) => sum + row.alignedCount, 0),
  }));
  return {
    captureCount: rows.length,
    sourceCaptureCount: sourceRows.length,
    exactSetCountCaptureCount: rows.filter((row) => row.predictedCount === row.expectedSetCount).length,
    exactSetCountSourceCaptureCount: sourceRows.filter((row) => row.predicted === row.expected).length,
    exactCaptureCount: rows.filter((row) => row.exact).length,
    exactSourceCaptureCount: sourceRows.filter((row) => row.predicted === row.expected && row.aligned === row.truth).length,
    exactAnnotatedBoundaryCaptureCount: rows.filter((row) => row.exactAnnotatedBoundaries).length,
    expectedSetRepCount: expected,
    truthRepCount: truth,
    predictedRepCount: predicted,
    matchedRepCount: matched,
    alignedRepCount: aligned,
    timelineAlignmentToleranceMs: TIMELINE_ALIGNMENT_TOLERANCE_MS,
    matchedRecall: truth ? matched / truth : null,
    matchedPrecision: predicted ? matched / predicted : null,
    absoluteCountError: rows.reduce((sum, row) => sum + Math.abs(row.predictedCount - row.expectedSetCount), 0),
  };
}

function deserialize(profile: StoredProfile): RustExerciseProfileData {
  return { ...profile, contentHash: BigInt(profile.contentHash), primarySignal: { ...profile.primarySignal }, secondarySignal: { ...profile.secondarySignal } };
}
function serialize(profile: RustExerciseProfileData): StoredProfile { return { ...profile, contentHash: profile.contentHash.toString() }; }
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
function finite(value: number): number { return Number.isFinite(value) ? value : 0; }
function clamp(value: number, low: number, high: number): number { return Math.min(high, Math.max(low, value)); }
function increment(counts: Record<string, number>, key: string): void { counts[key] = (counts[key] ?? 0) + 1; }
function format(rows: readonly ReplayRow[]): string {
  const value = summarize(rows);
  return `${value.exactCaptureCount}/${value.captureCount} exact, ${value.matchedRepCount}/${value.truthRepCount} matched`;
}

if (require.main === module) {
  void main().catch((error) => { console.error(error); process.exitCode = 1; });
}
