import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  RustCanonicalWasmSession,
  instantiateRustMotionWasm,
  type MotionWasmExports,
  type RustExerciseProfile,
  type RustSealedRep,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseEstimate } from "../../src/pose/PoseEngine";
import { analyzePoseSet } from "../../src/pose/poseSetAnalysis";
import type { CameraView } from "../../src/pose/formRuleEngine";
import { resolveRustExerciseProfile } from "../../src/motion/rustProfileResolver";

interface Segment { startMs: number; peakMs: number; endMs: number }
interface DatasetRecord {
  captureId: string;
  exerciseId: string;
  capturePosition: string;
  analysisView: string;
  expectedCount: number;
  segments: Segment[];
  reviewedNegativeWindows: Array<{ startMs: number; endMs: number }>;
  source: { keypoints: string };
  eligibility?: { evaluation?: boolean; tuning?: boolean; antiInterference?: boolean; challenge?: boolean };
}
interface Fixture { poses: PoseEstimate[] }

const root = process.cwd();
let dataset: { records: DatasetRecord[] };
let wasm: MotionWasmExports;
const supportedExercises = ["lat_pulldown", "seated_shoulder_press"] as const;

async function main(): Promise<void> {
  dataset = JSON.parse(
    fs.readFileSync(path.join(root, "data/training/approved-segmentation-v1.json"), "utf8"),
  ) as { records: DatasetRecord[] };
  wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(root, "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  const rows = dataset.records
    .map((record) => ({ record, profile: profileForRecord(record) }))
    .filter((entry): entry is { record: DatasetRecord; profile: Exclude<RustExerciseProfile, null> } =>
      entry.profile !== null,
    )
    .map(({ record, profile }) => replay(record, profile));
  const summary = metrics(rows);
  const heldOut = metrics(rows.filter((row) => row.split === "held_out"));
  const challenge = metrics(rows.filter((row) => row.split === "challenge"));
  const byExercise = groupedMetrics(rows, (row) => row.exerciseId);
  const byCapturePosition = groupedMetrics(rows, (row) => row.capturePosition);
  const gateMetricsPassed = heldOut.captureCount >= 2
    && heldOut.f1 >= 0.9
    && heldOut.exactCountRatio >= 0.8
    && heldOut.negativeWindowFalsePositives === 0;
  const promotionPassed = false;
  const report = {
  schemaVersion: "maxpower-rust-motion-evaluation/v1",
  generatedAt: new Date().toISOString(),
  algorithmVersion: "rust-canonical-wasm/v1 + generic-rep-state-machine/v1",
  evaluationMode: "canonical-sidecar-compatibility-replay",
  accuracyClaim: "Rep-engine compatibility only; not MediaPipe-to-Rust end-to-end accuracy",
  profileContextAssumption: "Approval rows omit training side and equipment variation; replay assumes bilateral default variation and cannot promote profiles",
  scope: {
    sourceCaptureCount: dataset.records.length,
    sourceSegmentCount: dataset.records.reduce((sum, record) => sum + record.segments.length, 0),
    sourceReviewedNegativeWindowCount: dataset.records.reduce(
      (sum, record) => sum + record.reviewedNegativeWindows.length,
      0,
    ),
    supportedCaptureCount: rows.length,
    supportedExercises,
    unsupportedCapturesAreNotTreatedAsFailures: true,
  },
  splitPolicy: "capture-id deterministic hash; no rep from one capture crosses a split",
  splitAudit: {
    leakageFreeForPromotion: false,
    reason: "The first Rust thresholds were explored while the full local corpus was visible; held-out metrics are descriptive, not a valid promotion claim.",
    gateMetricsPassed,
    allCaptureAssignments: dataset.records.map((record) => ({
      captureId: record.captureId,
      exerciseId: record.exerciseId || null,
      capturePosition: record.capturePosition,
      analysisView: record.analysisView,
      split: splitFor(record.captureId),
      rustProfileStatus: profileForRecord(record) ? "evaluated" : "unsupported_profile_or_context",
      eligibility: record.eligibility ?? null,
    })),
  },
  summary,
  heldOut,
  challenge,
  byExercise,
  byCapturePosition,
  promotion: {
    passed: promotionPassed,
    promotedProfileCount: promotionPassed ? 2 : 0,
    gate: { minimumHeldOutCaptures: 2, minimumF1: 0.9, minimumExactCountRatio: 0.8, maximumNegativeWindowFalsePositives: 0 },
    reason: "Promotion refused: exploratory tuning had visibility into this corpus. Both profiles remain provisional and qualityVerdict stays null until a genuinely untouched capture set is collected.",
  },
  rows,
  };

  const jsonPath = path.join(root, "docs/reports/rust-motion-evaluation-2026-08-03.json");
  const markdownPath = path.join(root, "docs/reports/rust-motion-evaluation-2026-08-03.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(report));
  console.log(JSON.stringify({ jsonPath, markdownPath, summary, heldOut, challenge, promotion: report.promotion }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function replay(record: DatasetRecord, profile: Exclude<RustExerciseProfile, null>) {
  const fixturePath = findFixture(record.source.keypoints);
  const fixture = (JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture[])[0];
  const first = fixture.poses[0] as PoseEstimate & { image?: { widthPx: number; heightPx: number; mirrored: boolean } };
  const session = new RustCanonicalWasmSession({
    sequenceId: `evaluation:${record.captureId}`,
    schema: "blazepose33",
    image: {
      widthPx: first?.image?.widthPx ?? 1280,
      heightPx: first?.image?.heightPx ?? 720,
      rotationDegrees: 0,
      mirrored: first?.image?.mirrored ?? false,
    },
    stabilization: "fusion",
  }, wasm);
  session.setExerciseProfile(profile);
  const outcomes: RustSealedRep[] = [];
  const rawTriggerStartMs: number[] = [];
  let previousActiveRepId: bigint | null = null;
  let previousRustPhase = "ready";
  const rustPhaseTimeline: Array<{ timestampMs: number; phase: string }> = [];
  const started = performance.now();
  for (const pose of fixture.poses) {
    session.process({
      timestampMs: pose.timestampMs,
      landmarks: pose.landmarks.map((landmark) => ({
        x: Number.isFinite(landmark.x) ? landmark.x : 0,
        y: Number.isFinite(landmark.y) ? landmark.y : 0,
        z: Number.isFinite(landmark.z) ? landmark.z : 0,
        visibility: (landmark as typeof landmark & { observationScore?: number }).observationScore
          ?? landmark.visibility,
      })),
      worldLandmarks: pose.worldLandmarks ?? [],
    });
    outcomes.push(...session.lastCompletedReps);
    const activeRepId = session.lastRepState.activeRepId;
    if (previousActiveRepId === null && activeRepId !== null) {
      rawTriggerStartMs.push(pose.timestampMs);
    }
    previousActiveRepId = activeRepId;
    if (session.lastRepState.phase !== previousRustPhase) {
      previousRustPhase = session.lastRepState.phase;
      rustPhaseTimeline.push({ timestampMs: pose.timestampMs, phase: previousRustPhase });
    }
  }
  if (session.lastDecodedPacket?.lineage.activeProfileIdentity !== profileIdentity(profile)) {
    throw new Error(`Rust profile identity mismatch for ${record.captureId}`);
  }
  const processingMs = performance.now() - started;
  // Formal evaluation follows the same product rule as the training screen:
  // only confirmed candidates contribute volume, matches, or false positives.
  // Ambiguous and rejected events remain separately auditable diagnostics.
  const confirmed = outcomes.filter((rep) => rep.disposition === "confirmed");
  const needsReview = outcomes.filter((rep) => rep.disposition === "needs_review");
  const rejected = outcomes.filter((rep) => rep.disposition === "rejected");
  const pred = confirmed.map((rep) => ({
    startMs: Number(rep.startTimestampMs),
    peakMs: Number(rep.peakTimestampMs),
    endMs: Number(rep.endTimestampMs),
    canonicalSliceHash: rep.canonicalSliceHash.toString(),
  }));
  const matching = matchSegments(record.segments, pred);
  const rawMatching = matchRawTriggers(record.segments, rawTriggerStartMs);
  const tsAnalysis = analyzePoseSet({
    poses: fixture.poses,
    cameraView: record.analysisView as CameraView,
    exercise: { mode: "user", exerciseId: record.exerciseId },
  });
  const tsPredicted = tsAnalysis.segments.map((segment) => ({
    startMs: segment.startMs,
    peakMs: segment.peakMs,
    endMs: segment.endMs,
  }));
  const tsMatching = matchSegments(record.segments, tsPredicted);
  const negativeWindowFalsePositives = pred.filter((rep) =>
    record.reviewedNegativeWindows.some((window) =>
      rep.peakMs >= window.startMs && rep.peakMs <= window.endMs,
    ),
  ).length;
  const rawNegativeWindowFalsePositives = rawTriggerStartMs.filter((timestampMs) =>
    record.reviewedNegativeWindows.some((window) =>
      timestampMs >= window.startMs && timestampMs <= window.endMs,
    ),
  ).length;
  return {
    captureId: record.captureId,
    exerciseId: record.exerciseId,
    capturePosition: record.capturePosition,
    analysisView: record.analysisView,
    profileVersion: profileIdentity(profile),
    split: splitFor(record.captureId),
    truthCount: record.expectedCount,
    predictedCount: pred.length,
    needsReviewCandidateCount: needsReview.length,
    rejectedCandidateCount: rejected.length,
    rejectedCandidateReasons: rejected.map((rep) => rep.evidenceReason ?? "unknown"),
    rawTriggerCount: rawTriggerStartMs.length,
    rawMatchedTriggers: rawMatching.matched,
    rawFalsePositiveTriggers: rawTriggerStartMs.length - rawMatching.matched,
    rawMissedReps: record.segments.length - rawMatching.matched,
    rawExactCount: rawTriggerStartMs.length === record.expectedCount,
    rawNegativeWindowFalsePositives,
    productFilteredTriggerCount: Math.max(0, rawTriggerStartMs.length - pred.length),
    tsPredictedCount: tsPredicted.length,
    tsMatchedReps: tsMatching.matched,
    tsFirstDivergence: firstBoundaryDivergence(record.segments, tsPredicted),
    rustFirstDivergence: firstBoundaryDivergence(record.segments, pred),
    tsRustFirstDivergence: firstBoundaryDivergence(tsPredicted, pred),
    firstStateFork: {
      rustVsTruth: firstPhaseDivergence(phaseTimeline(record.segments), phaseTimeline(pred)),
      tsVsTruth: firstPhaseDivergence(
        phaseTimeline(record.segments),
        phaseTimeline(tsPredicted),
      ),
      tsVsRust: firstPhaseDivergence(phaseTimeline(tsPredicted), phaseTimeline(pred)),
    },
    rustPhaseTimeline,
    exactCount: pred.length === record.expectedCount,
    matchedReps: matching.matched,
    falsePositiveReps: pred.length - matching.matched,
    missedReps: record.segments.length - matching.matched,
    meanBoundaryErrorMs: matching.boundaryErrors.length
      ? Math.round(matching.boundaryErrors.reduce((sum, value) => sum + value, 0) / matching.boundaryErrors.length)
      : null,
    negativeWindowFalsePositives,
    processingMs: Number(processingMs.toFixed(2)),
    processingFps: Number((fixture.poses.length / Math.max(processingMs / 1000, 1e-6)).toFixed(1)),
    predicted: pred,
  };
}

function profileForRecord(record: DatasetRecord): RustExerciseProfile {
  return resolveRustExerciseProfile({
    exerciseId: record.exerciseId,
    capturePosition: record.capturePosition,
    // The approval export does not yet carry these fields. These assumptions
    // are explicit and are another reason this compatibility replay cannot
    // promote a profile.
    trainingSide: "bilateral",
    variation: "",
  });
}

function profileIdentity(profile: Exclude<RustExerciseProfile, null>): string {
  return {
    lat_pulldown: "lat-pulldown/rear/bilateral/cable/v1",
    lat_pulldown_rear_left_45: "lat-pulldown/rear-left-45/bilateral/cable/v1",
    seated_shoulder_press: "seated-shoulder-press/front-left-45/bilateral/dumbbell/v1",
    seated_shoulder_press_front: "seated-shoulder-press/front/bilateral/dumbbell/v1",
    march_in_place: "march-in-place/front/bilateral/bodyweight/v1",
    side_step_touch: "side-step-touch/front/bilateral/bodyweight/v1",
    alternating_knee_raise: "alternating-knee-raise/front/bilateral/bodyweight/v1",
    step_jack: "step-jack/front/bilateral/bodyweight/v1",
  }[profile];
}

function phaseTimeline(segments: ArrayLike<Segment>) {
  const timeline: Array<{ timestampMs: number; phase: string }> = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    timeline.push(
      { timestampMs: segment.startMs, phase: "effort" },
      { timestampMs: segment.peakMs, phase: "return" },
      { timestampMs: segment.endMs, phase: "ready" },
    );
  }
  return timeline;
}

function firstPhaseDivergence(
  expected: ArrayLike<{ timestampMs: number; phase: string }>,
  actual: ArrayLike<{ timestampMs: number; phase: string }>,
  toleranceMs = 250,
) {
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (!left || !right || left.phase !== right.phase
      || Math.abs(left.timestampMs - right.timestampMs) > toleranceMs) {
      return {
        eventIndex: index,
        expected: left ?? null,
        actual: right ?? null,
        reason: !left || !right ? "event-count" : left.phase !== right.phase ? "phase" : "time",
      };
    }
  }
  return null;
}

function matchRawTriggers(truth: Segment[], triggers: number[]) {
  const available = new Set(triggers.map((_, index) => index));
  let matched = 0;
  for (const actual of truth) {
    const closest = [...available]
      .map((index) => ({ index, distance: Math.abs(triggers[index] - actual.startMs) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!closest || closest.distance > 1_500) continue;
    available.delete(closest.index);
    matched += 1;
  }
  return { matched };
}

function firstBoundaryDivergence(
  expected: ArrayLike<Segment>,
  actual: ArrayLike<Segment>,
  toleranceMs = 250,
) {
  const count = Math.max(expected.length, actual.length);
  for (let index = 0; index < count; index += 1) {
    const left = expected[index];
    const right = actual[index];
    if (!left || !right) {
      return {
        repIndex: index + 1,
        timestampMs: left?.startMs ?? right?.startMs ?? null,
        reason: !left ? "unexpected-rep" : "missing-rep",
      };
    }
    for (const boundary of ["startMs", "peakMs", "endMs"] as const) {
      const deltaMs = right[boundary] - left[boundary];
      if (Math.abs(deltaMs) > toleranceMs) {
        return { repIndex: index + 1, timestampMs: Math.min(left[boundary], right[boundary]), boundary, deltaMs };
      }
    }
  }
  return null;
}

function matchSegments(truth: Segment[], predicted: Array<{ startMs: number; peakMs: number; endMs: number }>) {
  const available = new Set(predicted.map((_, index) => index));
  const boundaryErrors: number[] = [];
  let matched = 0;
  for (const actual of truth) {
    const closest = [...available]
      .map((index) => ({ index, distance: Math.abs(predicted[index].peakMs - actual.peakMs) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!closest || closest.distance > 1_500) continue;
    available.delete(closest.index);
    matched += 1;
    const value = predicted[closest.index];
    boundaryErrors.push((
      Math.abs(value.startMs - actual.startMs)
      + Math.abs(value.peakMs - actual.peakMs)
      + Math.abs(value.endMs - actual.endMs)
    ) / 3);
  }
  return { matched, boundaryErrors };
}

function metrics(input: ReturnType<typeof replay>[]) {
  const truth = input.reduce((sum, row) => sum + row.truthCount, 0);
  const predicted = input.reduce((sum, row) => sum + row.predictedCount, 0);
  const matched = input.reduce((sum, row) => sum + row.matchedReps, 0);
  const fp = input.reduce((sum, row) => sum + row.falsePositiveReps, 0);
  const fn = input.reduce((sum, row) => sum + row.missedReps, 0);
  const precision = matched + fp ? matched / (matched + fp) : 0;
  const recall = matched + fn ? matched / (matched + fn) : 0;
  const rawMatched = input.reduce((sum, row) => sum + row.rawMatchedTriggers, 0);
  const rawFp = input.reduce((sum, row) => sum + row.rawFalsePositiveTriggers, 0);
  const rawFn = input.reduce((sum, row) => sum + row.rawMissedReps, 0);
  const rawPrecision = rawMatched + rawFp ? rawMatched / (rawMatched + rawFp) : 0;
  const rawRecall = rawMatched + rawFn ? rawMatched / (rawMatched + rawFn) : 0;
  return {
    captureCount: input.length,
    truthCount: truth,
    predictedCount: predicted,
    exactCountCaptures: input.filter((row) => row.exactCount).length,
    exactCountRatio: input.length ? input.filter((row) => row.exactCount).length / input.length : 0,
    matchedReps: matched,
    falsePositiveReps: fp,
    missedReps: fn,
    precision,
    recall,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    negativeWindowFalsePositives: input.reduce((sum, row) => sum + row.negativeWindowFalsePositives, 0),
    rawTriggerCount: input.reduce((sum, row) => sum + row.rawTriggerCount, 0),
    rawMatchedTriggers: rawMatched,
    rawFalsePositiveTriggers: rawFp,
    rawMissedReps: rawFn,
    rawPrecision,
    rawRecall,
    rawF1: rawPrecision + rawRecall
      ? 2 * rawPrecision * rawRecall / (rawPrecision + rawRecall)
      : 0,
    rawExactCountRatio: input.length
      ? input.filter((row) => row.rawExactCount).length / input.length
      : 0,
    rawNegativeWindowFalsePositives: input.reduce(
      (sum, row) => sum + row.rawNegativeWindowFalsePositives,
      0,
    ),
    productFilteredTriggerCount: input.reduce(
      (sum, row) => sum + row.productFilteredTriggerCount,
      0,
    ),
    meanBoundaryErrorMs: mean(input
      .map((row) => row.meanBoundaryErrorMs)
      .filter((value): value is number => value !== null)),
    coreReplayFpsP50: quantile(input.map((row) => row.processingFps), 0.5),
    coreReplayFpsP95: quantile(input.map((row) => row.processingFps), 0.95),
  };
}

function groupedMetrics<T extends ReturnType<typeof replay>>(
  rows: T[],
  keyOf: (row: T) => string,
) {
  return Object.fromEntries([...new Set(rows.map(keyOf))]
    .sort()
    .map((key) => [key, metrics(rows.filter((row) => keyOf(row) === key))]));
}

function mean(values: number[]): number | null {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function quantile(values: number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
}

function splitFor(captureId: string): "tuning" | "held_out" | "challenge" {
  let hash = 2166136261;
  for (const char of captureId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const bucket = (hash >>> 0) % 5;
  return bucket === 0 ? "challenge" : bucket === 1 ? "held_out" : "tuning";
}

function findFixture(filename: string): string {
  for (const candidate of [
    path.join(root, "public/archives/confirmed-captures", filename),
    path.join(root, "public/archives/confirmed-captures/shoulders", filename),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing fixture ${filename}`);
}

function markdown(report: any): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const rows = report.rows.map((row: any) =>
    `|${row.captureId}|${row.exerciseId}|${row.capturePosition}|${row.profileVersion}|${row.truthCount}|${row.tsPredictedCount}|${row.rawTriggerCount}|${row.predictedCount}|${row.rustFirstDivergence?.timestampMs ?? "—"}|`,
  ).join("\n");
  return `# Rust Motion SDK canonical sidecar 兼容性评估\n\n`+
    `生成时间：${report.generatedAt}\n\n`+
    `## 结论\n\n`+
    `本次只评估 Rust V1 已实现且机位 identity 精确匹配的 profile（高位下拉、坐姿推肩），覆盖 ${report.scope.supportedCaptureCount}/${report.scope.sourceCaptureCount} 组。`+
    `promotion **${report.promotion.passed ? "通过" : "未通过"}**；未通过时继续显示 provisional，qualityVerdict 保持 null。\n\n`+
    `> 本报告输入是历史 canonical sidecar，不是原始 MediaPipe observation；它只能验证 rep-engine 兼容性，不能声明 MediaPipe→Rust 端到端准确率。实时录像重新推理必须单独报告。\n\n`+
    `|范围|组数|真值 rep|Raw trigger|Rust sealed|Precision|Recall|F1|Exact count|Raw/产品负窗 FP|\n`+
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`+
    `|全部支持动作|${report.summary.captureCount}|${report.summary.truthCount}|${report.summary.rawTriggerCount}|${report.summary.predictedCount}|${percent(report.summary.precision)}|${percent(report.summary.recall)}|${percent(report.summary.f1)}|${percent(report.summary.exactCountRatio)}|${report.summary.rawNegativeWindowFalsePositives}/${report.summary.negativeWindowFalsePositives}|\n`+
    `|Held-out|${report.heldOut.captureCount}|${report.heldOut.truthCount}|${report.heldOut.rawTriggerCount}|${report.heldOut.predictedCount}|${percent(report.heldOut.precision)}|${percent(report.heldOut.recall)}|${percent(report.heldOut.f1)}|${percent(report.heldOut.exactCountRatio)}|${report.heldOut.rawNegativeWindowFalsePositives}/${report.heldOut.negativeWindowFalsePositives}|\n`+
    `|Challenge|${report.challenge.captureCount}|${report.challenge.truthCount}|${report.challenge.rawTriggerCount}|${report.challenge.predictedCount}|${percent(report.challenge.precision)}|${percent(report.challenge.recall)}|${percent(report.challenge.f1)}|${percent(report.challenge.exactCountRatio)}|${report.challenge.rawNegativeWindowFalsePositives}/${report.challenge.negativeWindowFalsePositives}|\n\n`+
    `## 边界\n\n`+
    `- ${report.scope.sourceCaptureCount} 组、${report.scope.sourceSegmentCount} 个人工 rep 区间、${report.scope.sourceReviewedNegativeWindowCount} 个已审核负窗口用于定义总体数据范围；Rust 尚未实现的动作不被伪装成失败或成功。\n`+
    `- 拆分按 capture ID 固定哈希完成，同一录像不会跨集合泄漏。\n`+
    `- 每组同时保留 TS 数量、Rust 数量、人工真值与首次边界分叉；raw trigger 与 sealed 产品结果分开统计。\n`+
    `- 这些标注只验证分段、计数与抗干扰，不是标准姿势轨迹真值。\n`+
    `- 重放同一录像只用于确定性验证，不增加样本量。\n`+
    `\n## 逐组差异\n\n`+
    `|Capture|动作|机位|Profile|人工|TS|Raw|Rust sealed|首次 Rust/人工分叉 ms|\n`+
    `|---|---|---|---|---:|---:|---:|---:|---:|\n${rows}\n`;
}
