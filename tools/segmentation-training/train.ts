import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getKinematicsProfile } from "../../src/pose/kinematicsProfile";
import type { PoseEstimate } from "../../src/pose/PoseEngine";
import {
  DEFAULT_REP_SEGMENTATION_CONFIG,
  isSignalFrameVisible,
  resolveSignalSide,
  type RepSegmentationConfig,
  type SignalKind,
} from "../../src/pose/repSegmenter";
import {
  chooseSegmentationConfig,
  evaluateSegmentationConfig,
  reviewedNegativeWindows,
  segmentationCalibrationGrid,
  validateSegmentationAnnotation,
  type HumanRepBoundary,
  type SegmentationMetrics,
  type SegmentationTrainingCapture,
} from "../../src/pose/segmentationTraining";
import { CAPTURE_POSITIONS } from "../../src/pose/viewGating";

interface ReviewDraft {
  exerciseId: string;
  capturePosition: string;
  expectedCount: string;
  draftSegments: HumanRepBoundary[];
  note?: string;
  updatedAt?: string;
}

interface ApprovedReview {
  exerciseId: string;
  capturePosition: string | null;
  expectedCount: string;
  approvedSegments: HumanRepBoundary[];
  note?: string;
  approvedAt?: string;
}

interface ReviewAnnotation extends ReviewDraft {
  annotationStatus: "approved" | "autosaved_draft" | "user_confirmed_complete_draft";
}

interface ApprovalExport {
  version: string;
  exportedAt: string;
  drafts?: Record<string, ReviewDraft>;
  approvals?: Record<string, ApprovedReview>;
}

interface ManifestEntry {
  id: string;
  video: string;
  keypoints: string;
  labels?: string;
  metadata?: string;
}

interface Manifest {
  version: string;
  captures: ManifestEntry[];
}

interface Fixture {
  durationSec: number;
  model?: string;
  poses: PoseEstimate[];
}

interface RepCoverage {
  repIndex: number;
  frameCount: number;
  usableSignalFrames: number;
  signalCoverage: number;
  longestSignalGapMs: number | null;
}

interface DatasetRecord {
  captureId: string;
  exerciseId: string;
  capturePosition: string;
  analysisView: string | null;
  expectedCount: number | null;
  segments: HumanRepBoundary[];
  reviewedNegativeWindows: Array<{ startMs: number; endMs: number }>;
  note: string;
  annotationUpdatedAt: string | null;
  annotationStatus: ReviewAnnotation["annotationStatus"];
  source: {
    keypoints: string;
    video: string;
    model: string | null;
    durationMs: number;
    frameCount: number;
  };
  quality: {
    poseCoverage: number;
    torsoCoverage: number;
    repCoverage: RepCoverage[];
    minimumRepSignalCoverage: number | null;
  };
  eligibility: {
    evaluation: boolean;
    tuning: boolean;
    antiInterference: boolean;
    challenge: boolean;
    reasons: string[];
  };
}

interface LoadedRecord {
  record: DatasetRecord;
  trainingCapture: SegmentationTrainingCapture | null;
}

interface BucketReport {
  key: string;
  exerciseId: string;
  capturePosition: string;
  captureCount: number;
  repCount: number;
  tuningCaptureCount: number;
  tuningRepCount: number;
  challengeCaptureCount: number;
  baseline: SegmentationMetrics | null;
  tuningBaseline: SegmentationMetrics | null;
  calibrated: {
    finalConfig: RepSegmentationConfig;
    trainingMetrics: SegmentationMetrics;
    leaveOneCaptureOutBaselineMetrics: SegmentationMetrics;
    leaveOneCaptureOutMetrics: SegmentationMetrics;
    evaluationMetrics: SegmentationMetrics;
    challengeBaselineMetrics: SegmentationMetrics | null;
    challengeEvaluationMetrics: SegmentationMetrics | null;
    promoted: boolean;
    reason: string;
  } | null;
}

const projectRoot = process.cwd();
const capturesRoot = path.join(projectRoot, "public", "field-captures");
const manifestPath = path.join(capturesRoot, "manifest.json");
const datasetPath = path.join(projectRoot, "data", "training", "approved-segmentation-v1.json");
const reportJsonPath = path.join(projectRoot, "docs", "reports", "segmentation-training-2026-08-03.json");
const reportMarkdownPath = path.join(projectRoot, "docs", "reports", "segmentation-training-2026-08-03.md");

function main(): void {
  const exportPath = process.argv.find((argument) => !argument.startsWith("--") && argument.endsWith(".json"));
  if (!exportPath) {
    throw new Error("Usage: npm run train:segmentation -- /path/to/approvals.json --reviewed-all-sha256=<sha256>");
  }
  const exportBytes = fs.readFileSync(exportPath);
  const exportSha256 = createHash("sha256").update(exportBytes).digest("hex");
  const declaredHash = process.argv
    .find((argument) => argument.startsWith("--reviewed-all-sha256="))
    ?.slice("--reviewed-all-sha256=".length) ?? null;
  if (declaredHash && declaredHash !== exportSha256) {
    throw new Error("The complete-review declaration does not match this approval export SHA-256.");
  }
  const reviewedAll = declaredHash === exportSha256;
  const approvalExport = JSON.parse(exportBytes.toString("utf8")) as ApprovalExport;
  const manifest = readJson<Manifest>(manifestPath);
  const manifestById = new Map(manifest.captures.map((entry) => [entry.id, entry]));
  const annotations = normalizedAnnotations(approvalExport, reviewedAll);
  const loaded: LoadedRecord[] = [];

  for (const [captureId, draft] of annotations) {
    const entry = manifestById.get(captureId);
    if (!entry) {
      loaded.push({ record: missingCaptureRecord(captureId, draft), trainingCapture: null });
      continue;
    }
    const fixture = readJson<Fixture[]>(path.join(capturesRoot, entry.keypoints))[0];
    if (!fixture) throw new Error(`Fixture has no capture payload: ${entry.keypoints}`);
    loaded.push(buildRecord(captureId, draft, entry, fixture, reviewedAll));
  }

  const records = loaded.map((item) => item.record).sort((left, right) => left.captureId.localeCompare(right.captureId));
  const bucketReports = buildBucketReports(loaded);
  const promotedProfiles = bucketReports.flatMap((bucket) =>
    bucket.calibrated?.promoted
      ? [{ exerciseId: bucket.exerciseId, capturePosition: bucket.capturePosition, config: bucket.calibrated.finalConfig }]
      : [],
  );
  const generatedAt = new Date().toISOString();
  const dataset = {
    schemaVersion: "form-coach-segmentation-training-dataset/v1",
    generatedAt,
    intendedUse: ["rep_segmentation", "rep_counting", "anti_interference_evaluation"],
    excludedUse: ["standard_form_reference", "medical_assessment"],
    source: {
      approvalExport: path.resolve(exportPath),
      approvalExportSha256: exportSha256,
      approvalExportVersion: approvalExport.version,
      approvalExportedAt: approvalExport.exportedAt,
      approvalCount: Object.keys(approvalExport.approvals ?? {}).length,
      draftCount: Object.keys(approvalExport.drafts ?? {}).length,
      manifest: path.relative(projectRoot, manifestPath),
      fullVideoReviewDeclared: reviewedAll,
    },
    records,
  };
  const report = {
    schemaVersion: "form-coach-segmentation-calibration-report/v1",
    generatedAt,
    sourceDataset: path.relative(projectRoot, datasetPath),
    source: {
      approvalExportSha256: exportSha256,
      approvalExportVersion: approvalExport.version,
      approvalExportedAt: approvalExport.exportedAt,
      fullVideoReviewDeclared: reviewedAll,
    },
    summary: summarize(records, promotedProfiles.length),
    buckets: bucketReports,
    promotedProfiles,
  };

  fs.mkdirSync(path.dirname(datasetPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportMarkdownPath, reportMarkdown(report, records));
  process.stdout.write(`${JSON.stringify({
    dataset: datasetPath,
    report: reportMarkdownPath,
    ...report.summary,
    promotedProfiles,
  }, null, 2)}\n`);
}

function buildRecord(
  captureId: string,
  draft: ReviewAnnotation,
  entry: ManifestEntry,
  fixture: Fixture,
  reviewedAll: boolean,
): LoadedRecord {
  const durationMs = Math.max(
    Math.round(fixture.durationSec * 1000),
    fixture.poses.at(-1)?.timestampMs ?? 0,
  );
  const capturePosition = CAPTURE_POSITIONS.find((position) => position.id === draft.capturePosition);
  const analysisView = capturePosition?.analysisView ?? null;
  const profile = draft.exerciseId ? getKinematicsProfile(draft.exerciseId) : null;
  const annotationIssues = validateSegmentationAnnotation({
    exerciseId: draft.exerciseId,
    capturePosition: draft.capturePosition,
    expectedCount: draft.expectedCount,
    durationMs,
    segments: draft.draftSegments,
  });
  const reasons = [...annotationIssues];
  if (draft.capturePosition && !capturePosition) reasons.push("invalid_capture_position");
  if (!profile) reasons.push("missing_kinematics_profile");
  if (profile && analysisView && !profile.supportedViews.includes(analysisView)) reasons.push("unsupported_profile_view");
  const signalSide = profile ? resolveSignalSide(fixture.poses, profile.phaseSignal.kind) : null;
  const repCoverage = profile && signalSide
    ? draft.draftSegments.map((segment) => signalCoverage(
        fixture.poses,
        segment,
        profile.phaseSignal.kind,
        signalSide,
      ))
    : [];
  const minimumRepSignalCoverage = repCoverage.length
    ? Math.min(...repCoverage.map((coverage) => coverage.signalCoverage))
    : null;
  if (minimumRepSignalCoverage !== null && minimumRepSignalCoverage < 0.6) reasons.push("low_rep_signal_coverage");
  const structuralReasons = reasons.filter((reason) => reason !== "low_rep_signal_coverage");
  const challenge = Boolean(draft.note?.trim()) ||
    draft.draftSegments.some((segment) => Boolean(segment.note?.trim())) ||
    reasons.includes("low_rep_signal_coverage");
  const evaluation = structuralReasons.length === 0;
  const completeReview = draft.annotationStatus === "approved" || reviewedAll;
  const tuning = evaluation && completeReview && !challenge && (minimumRepSignalCoverage ?? 0) >= 0.6;
  const antiInterference = completeReview && annotationIssues.length === 0;
  const record: DatasetRecord = {
    captureId,
    exerciseId: draft.exerciseId,
    capturePosition: draft.capturePosition,
    analysisView,
    expectedCount: Number.isInteger(Number(draft.expectedCount)) ? Number(draft.expectedCount) : null,
    segments: draft.draftSegments.map((segment) => ({ ...segment })),
    reviewedNegativeWindows: antiInterference
      ? reviewedNegativeWindows(durationMs, draft.draftSegments)
      : [],
    note: draft.note?.trim() ?? "",
    annotationUpdatedAt: draft.updatedAt ?? null,
    annotationStatus: draft.annotationStatus,
    source: {
      keypoints: entry.keypoints,
      video: entry.video,
      model: fixture.model ?? null,
      durationMs,
      frameCount: fixture.poses.length,
    },
    quality: {
      poseCoverage: frameCoverage(fixture.poses, (pose) => pose.landmarks.length > 0),
      torsoCoverage: frameCoverage(fixture.poses, (pose) =>
        [11, 12, 23, 24].every((index) => (pose.landmarks[index]?.visibility ?? 0) >= 0.5),
      ),
      repCoverage,
      minimumRepSignalCoverage,
    },
    eligibility: {
      evaluation,
      tuning,
      antiInterference,
      challenge,
      reasons: [...new Set(reasons)],
    },
  };
  return {
    record,
    trainingCapture: evaluation && profile
      ? {
          captureId,
          poses: fixture.poses,
          truth: draft.draftSegments,
          signal: profile.phaseSignal.kind,
          effortExtreme: profile.phaseSignal.effortExtreme,
          negativeWindows: record.reviewedNegativeWindows,
        }
      : null,
  };
}

function buildBucketReports(loaded: readonly LoadedRecord[]): BucketReport[] {
  const buckets = new Map<string, LoadedRecord[]>();
  for (const item of loaded) {
    if (!item.record.exerciseId || !item.record.capturePosition) continue;
    const key = `${item.record.exerciseId}|${item.record.capturePosition}`;
    buckets.set(key, [...(buckets.get(key) ?? []), item]);
  }
  const grid = segmentationCalibrationGrid();
  return [...buckets.entries()].map(([key, items]): BucketReport => {
    const [exerciseId, capturePosition] = key.split("|");
    const evaluation = items.flatMap((item) => item.trainingCapture ? [item.trainingCapture] : []);
    const tuning = items.flatMap((item) => item.record.eligibility.tuning && item.trainingCapture ? [item.trainingCapture] : []);
    const challenge = items.flatMap((item) => item.record.eligibility.challenge && item.trainingCapture
      ? [item.trainingCapture]
      : []);
    const baseline = evaluation.length
      ? evaluateSegmentationConfig(evaluation, DEFAULT_REP_SEGMENTATION_CONFIG)
      : null;
    const tuningBaseline = tuning.length
      ? evaluateSegmentationConfig(tuning, DEFAULT_REP_SEGMENTATION_CONFIG)
      : null;
    const tuningRepCount = tuning.reduce((total, capture) => total + capture.truth.length, 0);
    let calibrated: BucketReport["calibrated"] = null;
    if (tuning.length >= 5 && tuningRepCount >= 40) {
      const selected = chooseSegmentationConfig(tuning, grid);
      const leaveOneOut = leaveOneCaptureOut(tuning, grid);
      const leaveOneOutBaseline = leaveOneCaptureOutFixed(tuning, DEFAULT_REP_SEGMENTATION_CONFIG);
      const evaluationMetrics = evaluateSegmentationConfig(evaluation, selected.config);
      const challengeBaselineMetrics = challenge.length
        ? evaluateSegmentationConfig(challenge, DEFAULT_REP_SEGMENTATION_CONFIG)
        : null;
      const challengeEvaluationMetrics = challenge.length
        ? evaluateSegmentationConfig(challenge, selected.config)
        : null;
      const baselineBoundary = leaveOneOutBaseline.meanBoundaryErrorMs ?? Infinity;
      const candidateBoundary = leaveOneOut.meanBoundaryErrorMs ?? Infinity;
      const improvesCount = leaveOneOut.countAbsoluteError < leaveOneOutBaseline.countAbsoluteError;
      const holdsCountAndImprovesBoundary =
        leaveOneOut.countAbsoluteError === leaveOneOutBaseline.countAbsoluteError &&
        candidateBoundary <= baselineBoundary * 0.9;
      const doesNotRegressHeldOutNoise =
        leaveOneOut.falsePositiveReps <= leaveOneOutBaseline.falsePositiveReps &&
        leaveOneOut.negativeWindowFalsePositives <= leaveOneOutBaseline.negativeWindowFalsePositives &&
        leaveOneOut.rawNegativeWindowTriggers <= leaveOneOutBaseline.rawNegativeWindowTriggers;
      const doesNotRegressHeldOutF1 = leaveOneOut.f1 >= leaveOneOutBaseline.f1;
      const doesNotRegressChallenge = !challengeBaselineMetrics || !challengeEvaluationMetrics || (
        challengeEvaluationMetrics.countAbsoluteError <= challengeBaselineMetrics.countAbsoluteError &&
        challengeEvaluationMetrics.falsePositiveReps <= challengeBaselineMetrics.falsePositiveReps &&
        challengeEvaluationMetrics.negativeWindowFalsePositives <= challengeBaselineMetrics.negativeWindowFalsePositives &&
        challengeEvaluationMetrics.rawNegativeWindowTriggers <= challengeBaselineMetrics.rawNegativeWindowTriggers &&
        challengeEvaluationMetrics.f1 >= challengeBaselineMetrics.f1
      );
      const hasPromotionVolume = tuningRepCount >= 50;
      const promoted = hasPromotionVolume && doesNotRegressHeldOutNoise && doesNotRegressHeldOutF1 &&
        doesNotRegressChallenge &&
        (improvesCount || holdsCountAndImprovesBoundary);
      calibrated = {
        finalConfig: selected.config,
        trainingMetrics: selected.metrics,
        leaveOneCaptureOutBaselineMetrics: leaveOneOutBaseline,
        leaveOneCaptureOutMetrics: leaveOneOut,
        evaluationMetrics,
        challengeBaselineMetrics,
        challengeEvaluationMetrics,
        promoted,
        reason: promoted
          ? improvesCount
            ? "留一组验证降低了计数绝对误差。"
            : "留一组验证保持计数误差且边界误差至少降低 10%。"
          : !doesNotRegressHeldOutNoise || !doesNotRegressHeldOutF1 || !doesNotRegressChallenge
            ? "校准参数在留一组或困难样本评估中降低了精度、抗干扰或 F1；保留结果，不发布参数。"
            : !hasPromotionVolume
            ? "已完成探索性留组校准，但干净 rep 少于 50；保留结果，不发布参数。"
            : "独立留组结果没有优于冻结基线；保留数据但不发布参数。",
      };
    }
    return {
      key,
      exerciseId,
      capturePosition,
      captureCount: items.length,
      repCount: items.reduce((total, item) => total + item.record.segments.length, 0),
      tuningCaptureCount: tuning.length,
      tuningRepCount,
      challengeCaptureCount: items.filter((item) => item.record.eligibility.challenge).length,
      baseline,
      tuningBaseline,
      calibrated,
    };
  }).sort((left, right) => right.repCount - left.repCount || left.key.localeCompare(right.key));
}

function leaveOneCaptureOut(
  captures: readonly SegmentationTrainingCapture[],
  grid: readonly RepSegmentationConfig[],
): SegmentationMetrics {
  const foldMetrics = captures.map((heldOut, index) => {
    const training = captures.filter((_, candidateIndex) => candidateIndex !== index);
    const selected = chooseSegmentationConfig(training, grid);
    return evaluateSegmentationConfig([heldOut], selected.config);
  });
  return mergeMetrics(foldMetrics);
}

function leaveOneCaptureOutFixed(
  captures: readonly SegmentationTrainingCapture[],
  config: Readonly<RepSegmentationConfig>,
): SegmentationMetrics {
  return mergeMetrics(captures.map((heldOut) => evaluateSegmentationConfig([heldOut], config)));
}

function mergeMetrics(metrics: readonly SegmentationMetrics[]): SegmentationMetrics {
  const total = (field: keyof SegmentationMetrics) =>
    metrics.reduce((sum, metric) => sum + (typeof metric[field] === "number" ? metric[field] as number : 0), 0);
  const matchedReps = total("matchedReps");
  const falsePositiveReps = total("falsePositiveReps");
  const missedReps = total("missedReps");
  const negativeWindowFalsePositives = total("negativeWindowFalsePositives");
  const precision = matchedReps + falsePositiveReps === 0 ? 0 : matchedReps / (matchedReps + falsePositiveReps);
  const recall = matchedReps + missedReps === 0 ? 0 : matchedReps / (matchedReps + missedReps);
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);
  const boundaryWeighted = metrics.reduce((sum, metric) =>
    sum + (metric.meanBoundaryErrorMs ?? 0) * metric.matchedReps,
  0);
  const meanBoundaryErrorMs = matchedReps ? Math.round(boundaryWeighted / matchedReps) : null;
  const countAbsoluteError = total("countAbsoluteError");
  const loss = countAbsoluteError * 10 + falsePositiveReps * 3 + missedReps * 3 +
    negativeWindowFalsePositives * 5 +
    (meanBoundaryErrorMs ?? 10_000) / 1000;
  return {
    captureCount: total("captureCount"),
    truthCount: total("truthCount"),
    predictedCount: total("predictedCount"),
    exactCountCaptures: total("exactCountCaptures"),
    countAbsoluteError,
    matchedReps,
    falsePositiveReps,
    missedReps,
    negativeWindowFalsePositives,
    rawNegativeWindowTriggers: total("rawNegativeWindowTriggers"),
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    meanBoundaryErrorMs,
    loss: Number(loss.toFixed(3)),
  };
}

function signalCoverage(
  poses: readonly PoseEstimate[],
  segment: HumanRepBoundary,
  signal: SignalKind,
  side: "left" | "right",
): RepCoverage {
  const frames = poses.filter((pose) => pose.timestampMs >= segment.startMs && pose.timestampMs <= segment.endMs);
  const usable = frames.filter((pose) => isSignalFrameVisible(pose, signal, side));
  let longestSignalGapMs: number | null = null;
  for (let index = 1; index < usable.length; index += 1) {
    const gap = usable[index].timestampMs - usable[index - 1].timestampMs;
    longestSignalGapMs = Math.max(longestSignalGapMs ?? 0, gap);
  }
  return {
    repIndex: segment.repIndex,
    frameCount: frames.length,
    usableSignalFrames: usable.length,
    signalCoverage: frames.length ? Number((usable.length / frames.length).toFixed(4)) : 0,
    longestSignalGapMs,
  };
}

function frameCoverage(poses: readonly PoseEstimate[], predicate: (pose: PoseEstimate) => boolean): number {
  if (!poses.length) return 0;
  return Number((poses.filter(predicate).length / poses.length).toFixed(4));
}

function missingCaptureRecord(captureId: string, draft: ReviewAnnotation): DatasetRecord {
  return {
    captureId,
    exerciseId: draft.exerciseId,
    capturePosition: draft.capturePosition,
    analysisView: null,
    expectedCount: Number.isInteger(Number(draft.expectedCount)) ? Number(draft.expectedCount) : null,
    segments: draft.draftSegments ?? [],
    reviewedNegativeWindows: [],
    note: draft.note?.trim() ?? "",
    annotationUpdatedAt: draft.updatedAt ?? null,
    annotationStatus: draft.annotationStatus,
    source: { keypoints: "", video: "", model: null, durationMs: 0, frameCount: 0 },
    quality: { poseCoverage: 0, torsoCoverage: 0, repCoverage: [], minimumRepSignalCoverage: null },
    eligibility: {
      evaluation: false,
      tuning: false,
      antiInterference: false,
      challenge: true,
      reasons: ["capture_missing_from_manifest"],
    },
  };
}

function summarize(records: readonly DatasetRecord[], promotedProfileCount: number) {
  return {
    captureCount: records.length,
    segmentCount: records.reduce((total, record) => total + record.segments.length, 0),
    evaluationCaptureCount: records.filter((record) => record.eligibility.evaluation).length,
    tuningCaptureCount: records.filter((record) => record.eligibility.tuning).length,
    antiInterferenceCaptureCount: records.filter((record) => record.eligibility.antiInterference).length,
    reviewedNegativeWindowCount: records.reduce(
      (total, record) => total + record.reviewedNegativeWindows.length,
      0,
    ),
    reviewedNegativeDurationMs: records.reduce(
      (total, record) => total + record.reviewedNegativeWindows.reduce(
        (windowTotal, window) => windowTotal + window.endMs - window.startMs,
        0,
      ),
      0,
    ),
    challengeCaptureCount: records.filter((record) => record.eligibility.challenge).length,
    quarantinedCaptureCount: records.filter((record) => !record.eligibility.evaluation).length,
    promotedProfileCount,
  };
}

function reportMarkdown(
  report: { summary: ReturnType<typeof summarize>; buckets: BucketReport[]; promotedProfiles: unknown[] },
  records: readonly DatasetRecord[],
): string {
  const quarantined = records.filter((record) => !record.eligibility.evaluation);
  const rows = report.buckets.map((bucket) => {
    const baseline = bucket.baseline
      ? `${bucket.baseline.exactCountCaptures}/${bucket.baseline.captureCount}；MAE ${(bucket.baseline.countAbsoluteError / bucket.baseline.captureCount).toFixed(2)}；FP/FN ${bucket.baseline.falsePositiveReps}/${bucket.baseline.missedReps}；负区间误触 ${bucket.baseline.negativeWindowFalsePositives}`
      : "—";
    const calibrated = bucket.calibrated
      ? `${bucket.calibrated.leaveOneCaptureOutMetrics.exactCountCaptures}/${bucket.calibrated.leaveOneCaptureOutMetrics.captureCount}；MAE ${(bucket.calibrated.leaveOneCaptureOutMetrics.countAbsoluteError / bucket.calibrated.leaveOneCaptureOutMetrics.captureCount).toFixed(2)}；FP/FN ${bucket.calibrated.leaveOneCaptureOutMetrics.falsePositiveReps}/${bucket.calibrated.leaveOneCaptureOutMetrics.missedReps}；${bucket.calibrated.promoted ? "发布" : "不发布"}`
      : "样本不足，只评估";
    return `| ${bucket.exerciseId} | ${bucket.capturePosition} | ${bucket.captureCount} / ${bucket.repCount} | ${bucket.tuningCaptureCount} / ${bucket.tuningRepCount} | ${bucket.challengeCaptureCount} | ${baseline} | ${calibrated} |`;
  }).join("\n");
  const quarantineRows = quarantined.map((record, index) =>
    `| capture-${String(index + 1).padStart(3, "0")} | ${record.exerciseId || "未标"} | ${record.eligibility.reasons.join(", ")} |`,
  ).join("\n") || "| — | — | 无 |";
  return `# 人工逐 rep 数据：分段、计数与抗干扰训练报告\n\n` +
    `生成时间：${new Date().toISOString()}\n\n` +
    `## 结论\n\n` +
    `已导入 ${report.summary.captureCount} 组、${report.summary.segmentCount} 个逐 rep 时间段。` +
    `${report.summary.evaluationCaptureCount} 组可进入当前 profile 的独立评估，` +
    `${report.summary.tuningCaptureCount} 组可用于参数选择，${report.summary.challengeCaptureCount} 组作为困难样本保留，` +
    `${report.summary.quarantinedCaptureCount} 组因结构问题隔离。` +
    `完整审核声明产生 ${report.summary.reviewedNegativeWindowCount} 个非 rep 区间（共 ${(report.summary.reviewedNegativeDurationMs / 1000).toFixed(1)} 秒），用于统计误触发。` +
    `本次发布 ${report.summary.promotedProfileCount} 个经留一组验证优于冻结基线的参数档案。\n\n` +
    `这些标签只训练分段、计数和抗干扰，不作为标准动作轨迹。\n\n` +
    `## 分桶结果\n\n` +
    `| 动作 | 实际机位 | 总组/rep | 干净调参组/rep | 困难组 | 冻结基线（精确组；MAE；FP/FN） | 留一组校准 |\n` +
    `| --- | --- | ---: | ---: | ---: | --- | --- |\n${rows}\n\n` +
    `## 隔离样本\n\n` +
    `| Capture | 动作 | 原因 |\n| --- | --- | --- |\n${quarantineRows}\n\n` +
    `## 使用边界\n\n` +
    `- 有备注的力竭、遮挡、机位变化和低覆盖录像作为 challenge set，不参与阈值选择。\n` +
    `- 只有用户声明整段视频已审核时，rep 以外的区间才作为抗干扰负样本。\n` +
    `- 每个动作与实际机位单独分桶，不跨机位合并参数。\n` +
    `- 未通过 capture-level 留一验证的参数不会进入客户端。\n`;
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, "utf8")) as T;
}

function normalizedAnnotations(
  approvalExport: ApprovalExport,
  reviewedAll: boolean,
): Array<[string, ReviewAnnotation]> {
  const annotations = new Map<string, ReviewAnnotation>();
  for (const [captureId, draft] of Object.entries(approvalExport.drafts ?? {})) {
    annotations.set(captureId, {
      ...draft,
      annotationStatus: reviewedAll ? "user_confirmed_complete_draft" : "autosaved_draft",
    });
  }
  for (const [captureId, approval] of Object.entries(approvalExport.approvals ?? {})) {
    annotations.set(captureId, {
      exerciseId: approval.exerciseId,
      capturePosition: approval.capturePosition ?? "",
      expectedCount: approval.expectedCount,
      draftSegments: approval.approvedSegments,
      note: approval.note,
      updatedAt: approval.approvedAt,
      annotationStatus: "approved",
    });
  }
  return [...annotations.entries()];
}

main();
