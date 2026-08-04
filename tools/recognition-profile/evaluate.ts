import fs from "node:fs";
import path from "node:path";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustExerciseProfile,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm.js";
import { resolveRustExerciseProfile } from "../../src/motion/rustProfileResolver.js";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile.js";
import type { PoseEstimate } from "../../src/pose/PoseEngine.js";

interface Segment { startMs: number; peakMs: number; endMs: number; }
interface PeakMatch {
  truthIndex: number;
  predictedIndex: number;
  peakOffsetMs: number;
}
interface DatasetRecord {
  captureId: string;
  exerciseId: string;
  capturePosition: string;
  expectedCount: number | null;
  segments: Segment[];
  source: { keypoints: string; };
}
interface Fixture { poses: PoseEstimate[]; }
interface StoredProfile extends Omit<RustExerciseProfileData, "contentHash"> { contentHash: string; }
interface ObservedProfileArtifact {
  profiles: Array<{
    exerciseId: string;
    capturePosition: string;
    trainingSide: "bilateral";
    variation: "unrecorded";
    profile: StoredProfile;
  }>;
}

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.join(ROOT, "public", "archives", "confirmed-captures");
const TARGET_EXERCISES = new Set(["lat_pulldown", "barbell_row", "seated_shoulder_press", "lateral_raise"]);

async function main(): Promise<void> {
  const dataset = readJson<{ records: DatasetRecord[] }>(path.join(ROOT, "data", "training", "approved-segmentation-v1.json"));
  const observed = readJson<ObservedProfileArtifact>(path.join(ARCHIVE_ROOT, "recognition-profiles.json"));
  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(ROOT, "public", "motion-sdk", "form_coach_motion_sdk.wasm")),
  );
  const rows = dataset.records
    .filter((record) => TARGET_EXERCISES.has(record.exerciseId))
    .map((record) => replay(record, observed, wasm));
  const report = {
    schemaVersion: "form-coach-observed-profile-replay/v1",
    generatedAt: new Date().toISOString(),
    purpose: "In-sample compatibility replay of archived canonical sidecars. Not MediaPipe inference accuracy and not an independent validation claim.",
    selection: [...TARGET_EXERCISES],
    summary: summarize(rows),
    byExerciseAndPosition: group(rows),
    rows,
  };
  const jsonPath = path.join(ROOT, "docs", "reports", "observed-profile-replay-2026-08-04.json");
  const markdownPath = path.join(ROOT, "docs", "reports", "observed-profile-replay-2026-08-04.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(markdownPath, markdown(report));
  process.stdout.write(`${JSON.stringify({ jsonPath, markdownPath, summary: report.summary, byExerciseAndPosition: report.byExerciseAndPosition }, null, 2)}\n`);
}

function replay(record: DatasetRecord, observed: ObservedProfileArtifact, wasm: MotionWasmExports) {
  const profile = profileFor(record, observed);
  if (!profile) {
    return { captureId: record.captureId, exerciseId: record.exerciseId, capturePosition: record.capturePosition, truthCount: record.expectedCount, truthSegmentCount: record.segments.length, source: "unavailable", profileIdentity: null, predictedCount: null, matchedReps: null, missedReps: null, falsePositiveReps: null, exactCount: null, reason: "No exact observed, built-in, or simulated recognition profile for this context." };
  }
  const fixture = readJson<Fixture[]>(path.join(ARCHIVE_ROOT, record.source.keypoints))[0];
  if (!fixture?.poses.length) throw new Error(`Missing poses for ${record.captureId}`);
  const first = fixture.poses[0] as PoseEstimate & { image?: { widthPx: number; heightPx: number; mirrored: boolean } };
  const session = new RustCanonicalWasmSession({
    sequenceId: `observed-replay:${record.captureId}`,
    schema: "blazepose33",
    image: { widthPx: first.image?.widthPx ?? 1280, heightPx: first.image?.heightPx ?? 720, rotationDegrees: 0, mirrored: first.image?.mirrored ?? false },
    stabilization: "fusion",
  }, wasm);
  if (profile.kind === "data") session.installExerciseProfileData(profile.profile);
  else session.setExerciseProfile(profile.profile);
  const predicted: Segment[] = [];
  for (const pose of fixture.poses) {
    session.process({
      timestampMs: pose.timestampMs,
      landmarks: pose.landmarks.map((landmark) => ({ x: finiteOrZero(landmark.x), y: finiteOrZero(landmark.y), z: finiteOrZero(landmark.z), visibility: landmark.visibility })),
      worldLandmarks: pose.worldLandmarks ?? [],
    });
    predicted.push(...session.lastCompletedReps.map((rep) => ({
      startMs: Number(rep.startTimestampMs), peakMs: Number(rep.peakTimestampMs), endMs: Number(rep.endTimestampMs),
    })));
  }
  const match = matchByPeak(record.segments, predicted);
  const identity = session.lastDecodedPacket?.lineage.activeProfileIdentity ?? null;
  session.close();
  return {
    captureId: record.captureId,
    exerciseId: record.exerciseId,
    capturePosition: record.capturePosition,
    truthCount: record.expectedCount,
    truthSegmentCount: record.segments.length,
    source: profile.source,
    profileIdentity: identity,
    predictedCount: predicted.length,
    matchedReps: match.matched,
    missedReps: record.segments.length - match.matched,
    falsePositiveReps: predicted.length - match.matched,
    exactCount: predicted.length === record.expectedCount,
    replayDetail: {
      truthSegments: record.segments,
      predictedSegments: predicted,
      peakMatches: match.pairs,
      unmatchedTruthIndexes: match.unmatchedTruthIndexes,
      unmatchedPredictedIndexes: match.unmatchedPredictedIndexes,
    },
    reason: null,
  };
}

function profileFor(record: DatasetRecord, observed: ObservedProfileArtifact):
  | { kind: "data"; source: "observed" | "simulated"; profile: RustExerciseProfileData }
  | { kind: "built-in"; source: "built-in"; profile: Exclude<RustExerciseProfile, null> }
  | null {
  const context = { exerciseId: record.exerciseId, capturePosition: record.capturePosition, trainingSide: "bilateral" as const, variation: "" };
  const stored = observed.profiles.find((entry) => entry.exerciseId === record.exerciseId && entry.capturePosition === record.capturePosition);
  if (stored) return { kind: "data", source: "observed", profile: deserialize(stored.profile) };
  const builtIn = resolveRustExerciseProfile(context);
  if (builtIn) return { kind: "built-in", source: "built-in", profile: builtIn };
  const simulated = resolveSimulatedRecognitionProfile(context);
  return simulated ? { kind: "data", source: "simulated", profile: simulated } : null;
}

function deserialize(profile: StoredProfile): RustExerciseProfileData {
  return { ...profile, contentHash: BigInt(profile.contentHash), primarySignal: { ...profile.primarySignal }, secondarySignal: { ...profile.secondarySignal } };
}

function matchByPeak(truth: readonly Segment[], predicted: readonly Segment[]) {
  const remaining = new Set(predicted.map((_, index) => index));
  const pairs: PeakMatch[] = [];
  const unmatchedTruthIndexes: number[] = [];
  for (const [truthIndex, segment] of truth.entries()) {
    const closest = [...remaining]
      .map((index) => ({ index, distance: Math.abs(predicted[index].peakMs - segment.peakMs) }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!closest || closest.distance > 1_500) {
      unmatchedTruthIndexes.push(truthIndex);
      continue;
    }
    remaining.delete(closest.index);
    pairs.push({ truthIndex, predictedIndex: closest.index, peakOffsetMs: predicted[closest.index].peakMs - segment.peakMs });
  }
  return { matched: pairs.length, pairs, unmatchedTruthIndexes, unmatchedPredictedIndexes: [...remaining] };
}

function summarize(rows: ReturnType<typeof replay>[]) {
  const evaluated = rows.filter((row) => row.predictedCount !== null);
  return {
    captureCount: rows.length,
    evaluatedCaptureCount: evaluated.length,
    unavailableCaptureCount: rows.length - evaluated.length,
    truthRepCount: rows.reduce((sum, row) => sum + row.truthSegmentCount, 0),
    predictedRepCount: evaluated.reduce((sum, row) => sum + (row.predictedCount ?? 0), 0),
    matchedRepCount: evaluated.reduce((sum, row) => sum + (row.matchedReps ?? 0), 0),
    exactCountCaptureCount: evaluated.filter((row) => row.exactCount).length,
  };
}

function group(rows: ReturnType<typeof replay>[]) {
  const groups = new Map<string, ReturnType<typeof replay>[]>();
  for (const row of rows) {
    const key = `${row.exerciseId}|${row.capturePosition}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()].map(([key, values]) => ({ key, ...summarize(values), sources: [...new Set(values.map((row) => row.source))] }));
}

function markdown(report: { summary: ReturnType<typeof summarize>; byExerciseAndPosition: ReturnType<typeof group>; rows: ReturnType<typeof replay>[] }) {
  return [
    "# 已归档视频：观察型 profile 回放", "",
    "这是人工标注关键点 sidecar 的 in-sample 回放，不是重新运行 MediaPipe，也不是独立准确率或动作质量结论。", "",
    `- 覆盖录像：${report.summary.captureCount}；可回放：${report.summary.evaluatedCaptureCount}；无精确 profile：${report.summary.unavailableCaptureCount}`,
    `- 标注 rep：${report.summary.truthRepCount}；Rust 封装 rep：${report.summary.predictedRepCount}；峰值匹配：${report.summary.matchedRepCount}`, "",
    "| 动作 × 机位 | 录像 | 标注 rep | 封装 rep | 峰值匹配 | 精确计数录像 | profile 来源 |", "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...report.byExerciseAndPosition.map((row) => `| ${row.key} | ${row.captureCount} | ${row.truthRepCount} | ${row.predictedRepCount} | ${row.matchedRepCount} | ${row.exactCountCaptureCount} | ${row.sources.join(", ")} |`),
    "", "## 逐段", "",
    ...report.rows.map((row) => `- ${row.captureId}: ${row.exerciseId}/${row.capturePosition} · ${row.source} · 标注 ${row.truthSegmentCount} / 预测 ${row.predictedCount ?? "—"} / 匹配 ${row.matchedReps ?? "—"}${row.reason ? ` · ${row.reason}` : ""}`), "",
  ].join("\n");
}

function finiteOrZero(value: number): number { return Number.isFinite(value) ? value : 0; }
function readJson<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }

void main().catch((error) => { console.error(error); process.exitCode = 1; });
