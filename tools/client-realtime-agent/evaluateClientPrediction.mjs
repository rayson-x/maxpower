import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_PREDICTION = "data/workflows/client-realtime-agent/client-single-pass-v1/client-prediction-before-truth.json";
const DEFAULT_DATASET = "data/training/personal-golden-segmentation-v2.json";
const DEFAULT_STANDARD = "docs/design/ai-coach-blind-video-model-evaluation-standard-v0.1.json";
const DEFAULT_OUTPUT = "data/workflows/client-realtime-agent/client-single-pass-v1/client-rep-phase-evaluation-after-truth.json";
const DEFAULT_PHASE_TRUTH = "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/bench-phase-review-events-v1.jsonl";

export async function evaluateClientPrediction(options = {}) {
  const root = resolve(options.projectRoot ?? process.cwd());
  const predictionPath = resolve(root, options.predictionPath ?? DEFAULT_PREDICTION);
  const datasetPath = resolve(root, options.datasetPath ?? DEFAULT_DATASET);
  const standardPath = resolve(root, options.standardPath ?? DEFAULT_STANDARD);
  const outputPath = resolve(root, options.outputPath ?? DEFAULT_OUTPUT);
  const phaseTruthPath = resolve(root, options.phaseTruthPath ?? DEFAULT_PHASE_TRUTH);
  const [prediction, dataset, standard, phaseTruthEvents] = await Promise.all([
    readJson(predictionPath), readJson(datasetPath), readJson(standardPath),
    readJsonLinesOptional(phaseTruthPath),
  ]);
  if (prediction.runtime?.pythonVisionUsed !== false) throw new Error("prediction is not a no-Python client run");
  const tolerance = standard.thresholds.repAndPhase;
  const records = new Map((dataset.records ?? []).map((record) => [String(record.captureId), record]));
  const phaseTruth = approvedPhaseTruthByCapture(phaseTruthEvents);
  const rows = prediction.cases.map((testCase) => {
    const truth = records.get(String(testCase.captureId));
    if (!truth) throw new Error(`${testCase.captureId}: truth record not found after prediction freeze`);
    const scoredTruth = truthSegmentsForEvaluation(truth, phaseTruth.get(String(testCase.captureId)));
    const confirmed = testCase.reps.filter((rep) => rep.disposition === "confirmed").map(repSegment);
    const reviewable = testCase.reps.filter((rep) => rep.disposition !== "rejected").map(repSegment);
    const confirmedEvaluation = evaluateSegments(scoredTruth, confirmed, tolerance);
    const reviewableEvaluation = evaluateSegments(scoredTruth, reviewable, tolerance);
    return {
      captureId: testCase.captureId,
      exerciseId: truth.exerciseId,
      capturePosition: truth.capturePosition,
      expectedCount: truth.expectedCount,
      truthSegments: scoredTruth,
      truthProvenance: {
        startEnd: "existing_human_range",
        turnaround: phaseTruth.has(String(testCase.captureId))
          ? "submitted_human_confirmed_candidate"
          : "unavailable_legacy_midpoint_not_scored",
      },
      clientRuntime: testCase.runtime,
      rustOutcomes: {
        confirmed: confirmed.length,
        needsReview: testCase.reps.filter((rep) => rep.disposition === "needs_review").length,
        rejected: testCase.reps.filter((rep) => rep.disposition === "rejected").length,
        reasonCounts: countBy(testCase.reps.map((rep) => rep.evidenceReason ?? "none")),
      },
      confirmedEvaluation,
      reviewableEvaluation,
      executionAssessment: testCase.executionAssessment ?? buildExecutionAssessment(testCase, confirmed),
    };
  });
  const confirmedAggregate = aggregateRows(rows, "confirmedEvaluation");
  const reviewableAggregate = aggregateRows(rows, "reviewableEvaluation");
  const aggregate = {
    ...confirmedAggregate,
    // Preserve the original confirmed-only fields while making the two
    // observation-confidence lanes explicit for clients and Agents.
    confirmedPredictedRepCount: confirmedAggregate.predictedRepCount,
    recognitionLanes: {
      highConfidenceConfirmed: confirmedAggregate,
      observableIncludingNeedsReview: reviewableAggregate,
    },
  };
  const semantic = {
    schemaVersion: "maxpower-client-rep-phase-evaluation/v1",
    generatedAt: new Date().toISOString(),
    protocol: {
      visualRuntime: prediction.runtime.visual,
      motionRuntime: prediction.runtime.motion,
      pass: prediction.runtime.pass,
      pythonVisionUsed: false,
      truthReveal: "after-client-prediction-was-frozen",
      predictionSha256: await sha256(predictionPath),
      datasetSha256: await sha256(datasetPath),
      standardSha256: await sha256(standardPath),
      phaseTruthSha256: await sha256Optional(phaseTruthPath),
    },
    acceptanceThresholds: tolerance,
    aggregate,
    rows,
    interpretationBoundary: [
      "This self-replay sample validates the client inference and Rust timeline path, not unseen-source generalization.",
      "Pose confidence is observation confidence, not keypoint accuracy; no skeleton accuracy is claimed without point truth.",
      "No technique, compensation, stimulus-shift, load, RPE or RIR verdict is emitted without reviewed evidence.",
      "No blended standardness score is produced.",
    ],
  };
  const report = { ...semantic, reportSha256: createHash("sha256").update(JSON.stringify(semantic)).digest("hex") };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { outputPath, report };
}

export function evaluateSegments(truth, predicted, tolerance) {
  const remaining = new Set(predicted.map((_, index) => index));
  const matches = [];
  for (const [truthIndex, expected] of truth.entries()) {
    const expectedReferenceMs = Number.isFinite(expected.peakMs)
      ? expected.peakMs
      : (expected.startMs + expected.endMs) / 2;
    const candidate = [...remaining]
      .map((index) => ({ index, distance: Math.abs(predicted[index].peakMs - expectedReferenceMs) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!candidate || candidate.distance > 1_500) continue;
    remaining.delete(candidate.index);
    const actual = predicted[candidate.index];
    const startOffsetMs = actual.startMs - expected.startMs;
    const hasPeakTruth = Number.isFinite(expected.peakMs);
    const peakOffsetMs = hasPeakTruth ? actual.peakMs - expected.peakMs : null;
    const endOffsetMs = actual.endMs - expected.endMs;
    const intersection = Math.max(0, Math.min(expected.endMs, actual.endMs) - Math.max(expected.startMs, actual.startMs));
    const union = Math.max(expected.endMs, actual.endMs) - Math.min(expected.startMs, actual.startMs);
    const intervalIou = union > 0 ? intersection / union : 0;
    const startWithinTolerance = Math.abs(startOffsetMs) <= tolerance.startEndToleranceMs;
    const peakWithinTolerance = hasPeakTruth
      ? Math.abs(peakOffsetMs) <= tolerance.peakToleranceMs
      : null;
    const endWithinTolerance = Math.abs(endOffsetMs) <= tolerance.startEndToleranceMs;
    const intervalAligned = intervalIou >= tolerance.minimumIntervalIoU;
    const rangeAligned = startWithinTolerance && endWithinTolerance && intervalAligned;
    matches.push({
      truthIndex,
      predictedIndex: candidate.index,
      startOffsetMs,
      peakOffsetMs,
      endOffsetMs,
      intervalIou,
      startWithinTolerance,
      peakWithinTolerance,
      endWithinTolerance,
      intervalAligned,
      rangeAligned,
      fullyAligned: hasPeakTruth ? rangeAligned && peakWithinTolerance : null,
    });
  }
  return {
    predictedSegments: predicted,
    matchedCount: matches.length,
    falsePositiveCount: predicted.length - matches.length,
    missedCount: truth.length - matches.length,
    exactCount: predicted.length === truth.length,
    rangeAlignedCount: matches.filter((match) => match.rangeAligned).length,
    peakTruthCount: truth.filter((segment) => Number.isFinite(segment.peakMs)).length,
    fullyAlignedCount: matches.filter((match) => match.fullyAligned === true).length,
    startWithinToleranceCount: matches.filter((match) => match.startWithinTolerance).length,
    peakWithinToleranceCount: matches.filter((match) => match.peakWithinTolerance).length,
    endWithinToleranceCount: matches.filter((match) => match.endWithinTolerance).length,
    matches,
  };
}

export function aggregateRows(rows, evaluationField = "confirmedEvaluation") {
  const truth = rows.reduce((sum, row) => sum + row.truthSegments.length, 0);
  const evaluation = (row) => row[evaluationField];
  const predicted = rows.reduce((sum, row) => sum + evaluation(row).predictedSegments.length, 0);
  const matched = rows.reduce((sum, row) => sum + evaluation(row).matchedCount, 0);
  const rangeAligned = rows.reduce((sum, row) => sum + evaluation(row).rangeAlignedCount, 0);
  const peakTruth = rows.reduce((sum, row) => sum + evaluation(row).peakTruthCount, 0);
  const fullyAligned = rows.reduce((sum, row) => sum + evaluation(row).fullyAlignedCount, 0);
  const startAligned = rows.reduce((sum, row) => sum + evaluation(row).startWithinToleranceCount, 0);
  const peakAligned = rows.reduce((sum, row) => sum + evaluation(row).peakWithinToleranceCount, 0);
  const endAligned = rows.reduce((sum, row) => sum + evaluation(row).endWithinToleranceCount, 0);
  return {
    sourceCount: rows.length,
    truthRepCount: truth,
    predictedRepCount: predicted,
    matchedRepCount: matched,
    candidatePrecision: ratio(matched, predicted),
    candidateRecall: ratio(matched, truth),
    exactSetSourceRate: ratio(rows.filter((row) => evaluation(row).exactCount).length, rows.length),
    manualRangeAlignedRate: ratio(rangeAligned, truth),
    startWithinToleranceRate: ratio(startAligned, truth),
    peakTruthRepCount: peakTruth,
    peakWithinToleranceRate: ratio(peakAligned, peakTruth),
    fullyPhaseAlignedRate: ratio(fullyAligned, peakTruth),
    endWithinToleranceRate: ratio(endAligned, truth),
    runtime: {
      minimumEffectiveObservationFps: Math.min(...rows.map((row) => row.clientRuntime.effectiveObservationFps)),
      maximumInferenceMs: Math.max(...rows.map((row) => row.clientRuntime.maximumInferenceMs)),
      totalEmptyCandidateFrames: rows.reduce((sum, row) => sum + row.clientRuntime.emptyCandidateFrames, 0),
    },
  };
}

function buildExecutionAssessment(testCase, confirmed) {
  const phaseNames = phaseSemantics(testCase.preset.exerciseId);
  return {
    schemaVersion: "maxpower-training-execution-assessment/v1",
    exerciseId: testCase.preset.exerciseId,
    capturePosition: testCase.preset.capturePosition,
    dimensions: {
      task: {
        status: confirmed.length ? "observed_cycles" : "no_confirmed_cycle",
        confirmedRepCount: confirmed.length,
      },
      range: { status: "cannot_judge", reason: "no_reviewed_standard_range_reference" },
      phaseControl: {
        status: confirmed.length ? "observed" : "cannot_judge",
        semantics: phaseNames,
        reps: confirmed.map((rep, index) => ({
          repIndex: index + 1,
          firstPhaseMs: rep.peakMs - rep.startMs,
          secondPhaseMs: rep.endMs - rep.peakMs,
          totalMs: rep.endMs - rep.startMs,
        })),
      },
      supportStability: { status: "cannot_judge", reason: "no_reviewed_support-feature_contract_in_frozen_report" },
      bilateralCoordination: { status: "cannot_judge", reason: "no_calibrated_left_right_feature_evidence_in_frozen_report" },
      trajectoryControl: { status: "cannot_judge", reason: "no_equipment_track_or_reviewed_trajectory_corridor_in_frozen_report" },
      stimulusCompatibility: { status: "cannot_judge", reason: "technique_and_strategy_labels_unavailable" },
      observationConfidence: {
        status: "observed",
        effectiveObservationFps: testCase.runtime.effectiveObservationFps,
        processedFrames: testCase.runtime.processedFrames,
        emptyCandidateFrames: testCase.runtime.emptyCandidateFrames,
        emptyCandidateFrameRate: ratio(testCase.runtime.emptyCandidateFrames, testCase.runtime.processedFrames),
        maximumInferenceMs: testCase.runtime.maximumInferenceMs,
      },
    },
    effortAndDose: {
      status: "partial_observation_only",
      observable: ["rep_duration", "phase_duration", "duration_change_across_confirmed_reps"],
      cannotJudge: ["RPE", "RIR", "load", "muscle_activation", "subjective_effort"],
    },
  };
}

function phaseSemantics(exerciseId) {
  if (exerciseId === "barbell_bench_press") return { startToPeak: "eccentric", peakToEnd: "concentric" };
  if (exerciseId === "machine_chest_press") return { startToPeak: "concentric", peakToEnd: "eccentric" };
  return { startToPeak: "action_specific_phase_1", peakToEnd: "action_specific_phase_2" };
}

function repSegment(rep) {
  return { startMs: Number(rep.startMs), peakMs: Number(rep.peakMs), endMs: Number(rep.endMs) };
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function sha256Optional(path) {
  try {
    return await sha256(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonLinesOptional(path) {
  try {
    const text = await readFile(path, "utf8");
    return text.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

function approvedPhaseTruthByCapture(events) {
  const approved = new Map();
  for (const event of events) {
    if (event.reviewStatus !== "submitted" || event.humanPeakTruth !== true) continue;
    if (!Array.isArray(event.reps) || !event.reps.every((rep) => rep.humanTruth === true)) continue;
    approved.set(String(event.captureId), event);
  }
  return approved;
}

function truthSegmentsForEvaluation(record, phaseReview) {
  const approvedByRep = new Map((phaseReview?.reps ?? []).map((rep) => [Number(rep.repIndex), rep]));
  return (record.segments ?? []).map((segment, index) => {
    const repIndex = Number(segment.repIndex ?? index + 1);
    const approved = approvedByRep.get(repIndex);
    return {
      repIndex,
      startMs: Number(approved?.startMs ?? segment.startMs),
      peakMs: approved ? Number(approved.turnaroundMs) : null,
      endMs: Number(approved?.endMs ?? segment.endMs),
      peakTruth: approved ? "human_confirmed" : "unavailable",
      legacyMidpointMs: Number.isFinite(segment.peakMs) ? Number(segment.peakMs) : null,
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const [predictionPath, outputPathArg, datasetPath, phaseTruthPath] = process.argv.slice(2);
  const { outputPath, report } = await evaluateClientPrediction({
    predictionPath,
    outputPath: outputPathArg,
    datasetPath,
    phaseTruthPath,
  });
  process.stdout.write(`${outputPath}\n${JSON.stringify(report.aggregate, null, 2)}\n`);
}
