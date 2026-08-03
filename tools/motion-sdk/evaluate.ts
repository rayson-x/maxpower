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
const supported: Record<string, RustExerciseProfile> = {
  lat_pulldown: "lat_pulldown",
  seated_shoulder_press: "seated_shoulder_press",
};

async function main(): Promise<void> {
  dataset = JSON.parse(
    fs.readFileSync(path.join(root, "data/training/approved-segmentation-v1.json"), "utf8"),
  ) as { records: DatasetRecord[] };
  wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(root, "public/motion-sdk/form_coach_motion_sdk.wasm")),
  );
  const rows = dataset.records
    .filter((record) => supported[record.exerciseId])
    .map((record) => replay(record));
  const summary = metrics(rows);
  const heldOut = metrics(rows.filter((row) => row.split === "held_out"));
  const challenge = metrics(rows.filter((row) => row.split === "challenge"));
  const gateMetricsPassed = heldOut.captureCount >= 2
    && heldOut.f1 >= 0.9
    && heldOut.exactCountRatio >= 0.8
    && heldOut.negativeWindowFalsePositives === 0;
  const promotionPassed = false;
  const report = {
  schemaVersion: "form-coach-rust-motion-evaluation/v1",
  generatedAt: new Date().toISOString(),
  algorithmVersion: "rust-canonical-wasm/v1 + generic-rep-state-machine/v1",
  scope: {
    sourceCaptureCount: dataset.records.length,
    sourceSegmentCount: dataset.records.reduce((sum, record) => sum + record.segments.length, 0),
    supportedCaptureCount: rows.length,
    supportedExercises: Object.keys(supported),
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
      rustProfileStatus: supported[record.exerciseId] ? "evaluated" : "unsupported_profile",
      eligibility: record.eligibility ?? null,
    })),
  },
  summary,
  heldOut,
  challenge,
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

function replay(record: DatasetRecord) {
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
  session.setExerciseProfile(supported[record.exerciseId]);
  const predicted: RustSealedRep[] = [];
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
    predicted.push(...session.lastCompletedReps);
  }
  const processingMs = performance.now() - started;
  const pred = predicted.map((rep) => ({
    startMs: Number(rep.startTimestampMs),
    peakMs: Number(rep.peakTimestampMs),
    endMs: Number(rep.endTimestampMs),
    canonicalSliceHash: rep.canonicalSliceHash.toString(),
  }));
  const matching = matchSegments(record.segments, pred);
  const negativeWindowFalsePositives = pred.filter((rep) =>
    record.reviewedNegativeWindows.some((window) =>
      rep.peakMs >= window.startMs && rep.peakMs <= window.endMs,
    ),
  ).length;
  return {
    captureId: record.captureId,
    exerciseId: record.exerciseId,
    capturePosition: record.capturePosition,
    analysisView: record.analysisView,
    profileVersion: supported[record.exerciseId] === "lat_pulldown"
      ? "lat-pulldown/rear/bilateral/cable/v1"
      : "seated-shoulder-press/front-left-45/bilateral/dumbbell/v1",
    split: splitFor(record.captureId),
    truthCount: record.expectedCount,
    predictedCount: pred.length,
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
    coreReplayFpsP50: quantile(input.map((row) => row.processingFps), 0.5),
    coreReplayFpsP95: quantile(input.map((row) => row.processingFps), 0.95),
  };
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
    path.join(root, "public/field-captures", filename),
    path.join(root, "public/field-captures/shoulders", filename),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Missing fixture ${filename}`);
}

function markdown(report: any): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  return `# Rust Motion SDK 独立评估\n\n`+
    `生成时间：${report.generatedAt}\n\n`+
    `## 结论\n\n`+
    `本次只评估 Rust V1 已实现 profile（高位下拉、坐姿推肩），覆盖 ${report.scope.supportedCaptureCount}/${report.scope.sourceCaptureCount} 组。`+
    `promotion **${report.promotion.passed ? "通过" : "未通过"}**；未通过时继续显示 provisional，qualityVerdict 保持 null。\n\n`+
    `|范围|组数|真值 rep|预测 rep|Precision|Recall|F1|Exact count|负窗口 FP|\n`+
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`+
    `|全部支持动作|${report.summary.captureCount}|${report.summary.truthCount}|${report.summary.predictedCount}|${percent(report.summary.precision)}|${percent(report.summary.recall)}|${percent(report.summary.f1)}|${percent(report.summary.exactCountRatio)}|${report.summary.negativeWindowFalsePositives}|\n`+
    `|Held-out|${report.heldOut.captureCount}|${report.heldOut.truthCount}|${report.heldOut.predictedCount}|${percent(report.heldOut.precision)}|${percent(report.heldOut.recall)}|${percent(report.heldOut.f1)}|${percent(report.heldOut.exactCountRatio)}|${report.heldOut.negativeWindowFalsePositives}|\n`+
    `|Challenge|${report.challenge.captureCount}|${report.challenge.truthCount}|${report.challenge.predictedCount}|${percent(report.challenge.precision)}|${percent(report.challenge.recall)}|${percent(report.challenge.f1)}|${percent(report.challenge.exactCountRatio)}|${report.challenge.negativeWindowFalsePositives}|\n\n`+
    `## 边界\n\n`+
    `- 39 组、375 个区间用于定义总体数据范围；Rust 尚未实现的动作不被伪装成失败或成功。\n`+
    `- 拆分按 capture ID 固定哈希完成，同一录像不会跨集合泄漏。\n`+
    `- 这些标注只验证分段、计数与抗干扰，不是标准姿势轨迹真值。\n`+
    `- 重放同一录像只用于确定性验证，不增加样本量。\n`;
}
