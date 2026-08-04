import fs from "node:fs";
import path from "node:path";

import {
  computeRustExerciseProfileHash,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm.js";
import { getKinematicsProfile } from "../../src/pose/kinematicsProfile.js";
import type { PoseEstimate, PoseLandmark } from "../../src/pose/PoseEngine.js";

interface Segment { startMs: number; peakMs: number; endMs: number; }
interface DatasetRecord {
  captureId: string;
  exerciseId: string;
  capturePosition: string;
  segments: Segment[];
  annotationStatus: string;
  eligibility: { challenge: boolean; reasons: string[] };
  source: { keypoints: string; model: string | null; };
}
interface Dataset { source: { approvalExportSha256: string; }; records: DatasetRecord[]; }
interface Fixture { poses: PoseEstimate[]; }

interface ObservedRecognitionProfile {
  identity: string;
  exerciseId: string;
  capturePosition: string;
  trainingSide: "bilateral";
  variation: "unrecorded";
  profile: SerializedRustProfile;
  evidence: {
    sourceDataset: string;
    approvalExportSha256: string;
    captureIds: string[];
    captureCount: number;
    labeledRepCount: number;
    usableRepCount: number;
    challengeRepCount: number;
    excludedRepCount: number;
    notes: string[];
  };
}
type SerializedRustProfile = Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string };

const projectRoot = process.cwd();
const datasetPath = path.join(projectRoot, "data", "training", "approved-segmentation-v1.json");
const capturesRoot = path.join(projectRoot, "public", "archives", "confirmed-captures");
const outputPath = path.join(capturesRoot, "recognition-profiles.json");

function main(): void {
  const dataset = readJson<Dataset>(datasetPath);
  const buckets = new Map<string, DatasetRecord[]>();
  for (const record of dataset.records) {
    if (!record.exerciseId || !record.capturePosition || record.segments.length === 0) continue;
    const key = `${record.exerciseId}|${record.capturePosition}`;
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  }
  const candidates = [...buckets.values()]
    .map((records) => buildObservedProfile(records, dataset))
    .sort((left, right) => (left?.identity ?? "").localeCompare(right?.identity ?? ""));
  const profiles = candidates.filter((profile): profile is ObservedRecognitionProfile => profile !== null);
  const skippedBuckets = [...buckets.values()]
    .filter((records) => !profiles.some((profile) =>
      profile.exerciseId === records[0].exerciseId && profile.capturePosition === records[0].capturePosition,
    ))
    .map((records) => ({
      exerciseId: records[0].exerciseId,
      capturePosition: records[0].capturePosition,
      captureCount: records.length,
      labeledRepCount: records.reduce((sum, record) => sum + record.segments.length, 0),
      reason: "少于 4 个双侧信号完整的标注 rep；已保留在原始训练集，等待更多可见性或机位匹配数据。",
    }))
    .sort((left, right) => `${left.exerciseId}|${left.capturePosition}`.localeCompare(`${right.exerciseId}|${right.capturePosition}`));
  const artifact = {
    schemaVersion: "form-coach-observed-recognition-profiles/v1",
    generatedAt: new Date().toISOString(),
    intendedUse: ["rep_segmentation", "rep_counting", "anti_interference"],
    excludedUse: ["standard_form_reference", "quality_scoring", "medical_assessment"],
    profiles,
    skippedBuckets,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: outputPath, profileCount: profiles.length, skippedBucketCount: skippedBuckets.length, profiles: profiles.map((profile) => ({
    exerciseId: profile.exerciseId,
    capturePosition: profile.capturePosition,
    usableRepCount: profile.evidence.usableRepCount,
  })) }, null, 2)}\n`);
}

function buildObservedProfile(
  records: readonly DatasetRecord[],
  dataset: Dataset,
): ObservedRecognitionProfile | null {
  const [first] = records;
  const kinematics = getKinematicsProfile(first.exerciseId);
  const contract = first.exerciseId === "seated_shoulder_press"
    ? seatedShoulderPressContract()
    : kinematics
      ? signalContract(kinematics.phaseSignal.kind, kinematics.phaseSignal.effortExtreme)
      : null;
  if (!contract) return null;
  const primaryAmplitudes: number[] = [];
  const secondaryAmplitudes: number[] = [];
  let labeledRepCount = 0;
  let challengeRepCount = 0;
  let excludedRepCount = 0;
  for (const record of records) {
    const fixture = readJson<Fixture[]>(path.join(capturesRoot, record.source.keypoints))[0];
    if (!fixture) continue;
    for (const segment of record.segments) {
      labeledRepCount += 1;
      if (record.eligibility.challenge) challengeRepCount += 1;
      const primary = segmentAmplitude(fixture.poses, segment, contract.primary, contract.direction);
      const secondary = segmentAmplitude(fixture.poses, segment, contract.secondary, contract.direction);
      if (primary === null || secondary === null || primary <= 0 || secondary <= 0) {
        excludedRepCount += 1;
        continue;
      }
      primaryAmplitudes.push(primary);
      secondaryAmplitudes.push(secondary);
    }
  }
  if (primaryAmplitudes.length < 4 || secondaryAmplitudes.length < 4) return null;
  const primaryFloor = percentile(primaryAmplitudes, 0.2);
  const secondaryFloor = percentile(secondaryAmplitudes, 0.2);
  const minPrimaryAmplitude = primaryFloor * 0.60;
  const minSecondaryAmplitude = secondaryFloor * 0.60;
  const startAmplitude = Math.min(minPrimaryAmplitude * 0.40, minSecondaryAmplitude * 0.40);
  const durations = records.flatMap((record) => record.segments.map((segment) => segment.endMs - segment.startMs));
  const minRepDurationMs = Math.max(450, Math.round(percentile(durations, 0.20) * 0.55));
  const maxRepDurationMs = Math.min(8_000, Math.round(percentile(durations, 0.80) * 1.60));
  const identity = `${first.exerciseId}/${first.capturePosition}/bilateral/observed/v1`;
  const profileWithoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    identity,
    maturity: "provisional",
    schema: "blazepose33",
    coordinateUnit: contract.coordinateUnit,
    stateMachineId: "ready-effort-peak-return/v1",
    requiredCapabilities: ["canonical-landmarks", "subject-lock"],
    direction: contract.direction,
    primarySignal: contract.primary,
    secondarySignal: contract.secondary,
    startAmplitude,
    minPrimaryAmplitude,
    minSecondaryAmplitude,
    returnHysteresis: Math.max(startAmplitude * 0.75, minPrimaryAmplitude * 0.12),
    readyTolerance: startAmplitude * 0.75,
    maxGapMs: 700,
    minRepDurationMs,
    maxRepDurationMs,
  };
  const profile: SerializedRustProfile = {
    ...profileWithoutHash,
    contentHash: computeRustExerciseProfileHash(profileWithoutHash).toString(),
  };
  return {
    identity,
    exerciseId: first.exerciseId,
    capturePosition: first.capturePosition,
    trainingSide: "bilateral",
    variation: "unrecorded",
    profile,
    evidence: {
      sourceDataset: path.relative(projectRoot, datasetPath),
      approvalExportSha256: dataset.source.approvalExportSha256,
      captureIds: records.map((record) => record.captureId).sort(),
      captureCount: records.length,
      labeledRepCount,
      usableRepCount: primaryAmplitudes.length,
      challengeRepCount,
      excludedRepCount,
      notes: [
        "由人工标注的起点、极点、终点拟合，仅用于识别与计数。",
        "不把录制者动作当作标准动作轨迹，也不产生动作质量评分。",
        "variation 未在历史标注中结构化记录；运行时只会在空变式上下文匹配，禁止替代明确器械/握法。",
      ],
    },
  };
}

function signalContract(kind: string, effortExtreme: "min" | "max"): {
  coordinateUnit: RustExerciseProfileData["coordinateUnit"];
  direction: RustExerciseProfileData["direction"];
  primary: RustExerciseProfileData["primarySignal"];
  secondary: RustExerciseProfileData["secondarySignal"];
} | null {
  if (kind === "wrist_height") {
    return {
      coordinateUnit: "image-normalized-y",
      direction: effortExtreme === "max" ? "increasing" : "decreasing",
      primary: { kind: "landmark-y", landmarks: [15, 16] },
      secondary: { kind: "landmark-y", landmarks: [13, 14] },
    };
  }
  if (kind === "elbow_angle") {
    return {
      coordinateUnit: "image-angle-deg",
      direction: effortExtreme === "max" ? "increasing" : "decreasing",
      primary: { kind: "joint-angle", landmarks: [11, 13, 15] },
      secondary: { kind: "joint-angle", landmarks: [12, 14, 16] },
    };
  }
  if (kind === "knee_angle") {
    return {
      coordinateUnit: "image-angle-deg",
      direction: effortExtreme === "max" ? "increasing" : "decreasing",
      primary: { kind: "joint-angle", landmarks: [23, 25, 27] },
      secondary: { kind: "joint-angle", landmarks: [24, 26, 28] },
    };
  }
  if (kind === "shoulder_angle") {
    return {
      coordinateUnit: "image-angle-deg",
      direction: effortExtreme === "max" ? "increasing" : "decreasing",
      primary: { kind: "joint-angle", landmarks: [23, 11, 15] },
      secondary: { kind: "joint-angle", landmarks: [24, 12, 16] },
    };
  }
  return null;
}

/**
 * Historical push-press annotations used `peak` for either physical extreme,
 * depending on where the set began. Left/right elbow extension is stable in a
 * front image, whereas elbow screen-Y merely duplicates wrist travel. The
 * Rust state machine therefore selects the first coherent cycle direction.
 */
function seatedShoulderPressContract(): {
  coordinateUnit: RustExerciseProfileData["coordinateUnit"];
  direction: RustExerciseProfileData["direction"];
  primary: RustExerciseProfileData["primarySignal"];
  secondary: RustExerciseProfileData["secondarySignal"];
} {
  return {
    coordinateUnit: "image-angle-deg",
    direction: "auto",
    primary: { kind: "joint-angle", landmarks: [11, 13, 15] },
    secondary: { kind: "joint-angle", landmarks: [12, 14, 16] },
  };
}

function segmentAmplitude(
  poses: readonly PoseEstimate[],
  segment: Segment,
  signal: RustExerciseProfileData["primarySignal"],
  direction: RustExerciseProfileData["direction"],
): number | null {
  const start = closestSignal(poses, segment.startMs, signal);
  const peak = closestSignal(poses, segment.peakMs, signal);
  const end = closestSignal(poses, segment.endMs, signal);
  if (start === null || peak === null || end === null) return null;
  const baseline = (start + end) / 2;
  return direction === "increasing"
    ? peak - baseline
    : direction === "decreasing"
      ? baseline - peak
      : Math.abs(peak - baseline);
}

function closestSignal(
  poses: readonly PoseEstimate[],
  timeMs: number,
  signal: RustExerciseProfileData["primarySignal"],
): number | null {
  let selected: PoseEstimate | null = null;
  for (const pose of poses) {
    if (!selected || Math.abs(pose.timestampMs - timeMs) < Math.abs(selected.timestampMs - timeMs)) selected = pose;
  }
  return selected ? measureSignal(selected.landmarks, signal) : null;
}

function measureSignal(
  landmarks: readonly PoseLandmark[],
  signal: RustExerciseProfileData["primarySignal"],
): number | null {
  const point = (index: number) => {
    const landmark = landmarks[index];
    return landmark && landmark.visibility >= 0.5 && Number.isFinite(landmark.x) && Number.isFinite(landmark.y)
      ? landmark
      : null;
  };
  if (signal.kind === "landmark-y") {
    const values = signal.landmarks
      .filter((index): index is number => index !== undefined)
      .map(point)
      .filter((value): value is PoseLandmark => value !== null)
      .map((value) => value.y);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }
  if (signal.kind === "joint-angle") {
    const [a, b, c] = signal.landmarks.filter((index): index is number => index !== undefined).map(point);
    if (!a || !b || !c) return null;
    const first = { x: a.x - b.x, y: a.y - b.y };
    const second = { x: c.x - b.x, y: c.y - b.y };
    const denominator = Math.hypot(first.x, first.y) * Math.hypot(second.x, second.y);
    if (denominator <= 1e-6) return null;
    return Math.acos(Math.max(-1, Math.min(1, (first.x * second.x + first.y * second.y) / denominator))) * 180 / Math.PI;
  }
  const [a, b] = signal.landmarks.filter((index): index is number => index !== undefined).map(point);
  const leftShoulder = point(11);
  const rightShoulder = point(12);
  if (!a || !b || !leftShoulder || !rightShoulder) return null;
  const scale = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
  return scale > 1e-6 ? Math.hypot(a.x - b.x, a.y - b.y) / scale : null;
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))];
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

main();
