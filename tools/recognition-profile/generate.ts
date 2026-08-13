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
type SignalContract = {
  coordinateUnit: RustExerciseProfileData["coordinateUnit"];
  direction: RustExerciseProfileData["direction"];
  primary: RustExerciseProfileData["primarySignal"];
  secondary: RustExerciseProfileData["secondarySignal"];
};

const projectRoot = process.cwd();
const capturesRoot = path.join(projectRoot, "public", "archives", "confirmed-captures");

function option(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

export function resolveGenerationArtifactPaths(argv: readonly string[], rootDir = process.cwd()) {
  const datasetArgument = option(argv, "--dataset");
  const outputArgument = option(argv, "--output");
  if (!datasetArgument || !outputArgument) {
    throw new Error("Usage: --dataset data/training/<dataset>.json --output data/workflows/motion-profile/<workflow>/<run>/candidates/<file>.json");
  }
  const datasetPath = path.resolve(rootDir, datasetArgument);
  const relativeDataset = path.relative(rootDir, datasetPath);
  if (path.isAbsolute(relativeDataset) || relativeDataset.startsWith("..") || !relativeDataset.startsWith(`data${path.sep}training${path.sep}`)) {
    throw new Error("--dataset must be inside data/training/");
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
  return { datasetPath, outputPath };
}

function main(): void {
  const { datasetPath, outputPath } = resolveGenerationArtifactPaths(process.argv.slice(2), projectRoot);
  const dataset = readJson<Dataset>(datasetPath);
  const buckets = new Map<string, DatasetRecord[]>();
  for (const record of dataset.records) {
    if (!record.exerciseId || !record.capturePosition || record.segments.length === 0) continue;
    const key = `${record.exerciseId}|${record.capturePosition}`;
    buckets.set(key, [...(buckets.get(key) ?? []), record]);
  }
  const candidates = [...buckets.values()]
    .map((records) => buildObservedProfile(records, dataset, datasetPath))
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
      reason: "没有达到发布门槛：至少 4 个可用标注 rep，且双侧或近侧关节信号需覆盖足够帧；原始录像与标签继续保留。",
    }))
    .sort((left, right) => `${left.exerciseId}|${left.capturePosition}`.localeCompare(`${right.exerciseId}|${right.capturePosition}`));
  const artifact = {
    schemaVersion: "maxpower-observed-recognition-profiles/v1",
    generatedAt: new Date().toISOString(),
    intendedUse: ["rep_segmentation", "rep_counting", "anti_interference"],
    excludedUse: ["standard_form_reference", "quality_scoring", "medical_assessment"],
    profiles,
    skippedBuckets,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
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
  datasetPath: string,
): ObservedRecognitionProfile | null {
  const [first] = records;
  const kinematics = getKinematicsProfile(first.exerciseId);
  const contract = isHorizontalPress(first.exerciseId)
    ? chooseHorizontalPressContract(records)
    : first.exerciseId === "seated_shoulder_press"
    ? seatedShoulderPressContract()
    : first.exerciseId === "single_arm_cable_lateral_raise"
    ? chooseSingleArmLateralRaiseContract(records)
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
  const fallback = conservativeSignalThresholds(contract.coordinateUnit);
  const primaryFloor = primaryAmplitudes.length >= 4
    ? percentile(primaryAmplitudes, 0.2)
    : fallback.minimum / 0.60;
  const secondaryFloor = secondaryAmplitudes.length >= 4
    ? percentile(secondaryAmplitudes, 0.2)
    : fallback.minimum / 0.60;
  const minPrimaryAmplitude = primaryFloor * 0.60;
  const minSecondaryAmplitude = secondaryFloor * 0.60;
  const noiseGuard = activationNoiseGuard(first.exerciseId, first.capturePosition);
  const startAmplitude = Math.min(
    fallback.start,
    Math.min(minPrimaryAmplitude * 0.55, minSecondaryAmplitude * 0.55) * noiseGuard,
  );
  const durations = records.flatMap((record) => record.segments.map((segment) => segment.endMs - segment.startMs));
  // Rust boundaries intentionally sit inside the human setup/return marks.
  // Use annotation duration as an upper-context signal, not as a direct lower
  // bound; otherwise genuine cycles are downgraded merely because the engine
  // seals before the annotator's wider end marker.
  const minRepDurationMs = Math.max(450, Math.round(percentile(durations, 0.20) * 0.35));
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
    returnHysteresis: Math.min(minPrimaryAmplitude * 0.90, Math.max(
      startAmplitude * 1.35,
      minPrimaryAmplitude * 0.35 * noiseGuard,
    )),
    readyTolerance: startAmplitude * 0.55,
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
        ...(primaryAmplitudes.length < 4 || secondaryAmplitudes.length < 4
          ? ["人工边界附近的可靠幅度样本不足；该 profile 仅作为全视频候选搜索 seed，不具备发布资格。"]
          : []),
        ...(sameSignal(contract.primary, contract.secondary)
          ? ["该机位双侧遮挡明显，profile 使用可见侧肘角完成计数，不声明左右对称性。"]
          : []),
      ],
    },
  };
}

function conservativeSignalThresholds(
  coordinateUnit: RustExerciseProfileData["coordinateUnit"],
): { start: number; minimum: number } {
  if (coordinateUnit === "image-angle-deg") return { start: 5, minimum: 20 };
  if (coordinateUnit === "image-normalized-y") return { start: 0.02, minimum: 0.08 };
  return { start: 0.04, minimum: 0.15 };
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

function chooseSingleArmLateralRaiseContract(records: readonly DatasetRecord[]): SignalContract | null {
  const left = { kind: "joint-angle" as const, landmarks: [23, 11, 15] as [number, number, number] };
  const right = { kind: "joint-angle" as const, landmarks: [24, 12, 16] as [number, number, number] };
  const leftCoverage = signalCoverage(records, left);
  const rightCoverage = signalCoverage(records, right);
  const selected = leftCoverage >= rightCoverage ? left : right;
  if (Math.max(leftCoverage, rightCoverage) < 0.05) return null;
  return {
    coordinateUnit: "image-angle-deg",
    direction: "auto",
    primary: selected,
    secondary: selected,
  };
}

function isHorizontalPress(exerciseId: string): boolean {
  return exerciseId === "barbell_bench_press"
    || exerciseId === "machine_chest_press"
    || exerciseId === "push_up";
}

function activationNoiseGuard(exerciseId: string, capturePosition: string): number {
  if (exerciseId === "barbell_bench_press" && capturePosition === "frontRight45") return 1.40;
  if (exerciseId === "machine_chest_press" && capturePosition === "frontRight45") return 1.20;
  if (exerciseId === "push_up" && capturePosition === "rearRight45") return 1.20;
  return 1;
}

/**
 * Bench press, chest press and push-up share the same directly observable
 * image-space cycle: bilateral elbow flexion/extension. `auto` is deliberate:
 * capture can start at either lockout or the bottom and annotators mark the
 * physical extreme, not a globally fixed angle direction.
 */
function chooseHorizontalPressContract(records: readonly DatasetRecord[]): SignalContract | null {
  const left = { kind: "joint-angle" as const, landmarks: [11, 13, 15] as [number, number, number] };
  const right = { kind: "joint-angle" as const, landmarks: [12, 14, 16] as [number, number, number] };
  const candidates: SignalContract[] = [
    horizontalPressContract(left, right),
    horizontalPressContract(left, left),
    horizontalPressContract(right, right),
  ];
  const coverage = [signalCoverage(records, left), signalCoverage(records, right)];
  // Bilateral evidence is preferred only when both arms remain observable.
  // Oblique horizontal presses often hide the far elbow; in that case a
  // versioned near-side counter is safer than repeatedly freezing the cycle.
  if (Math.min(...coverage) >= 0.70) return candidates[0];
  const bestSide = coverage[0] >= coverage[1] ? 1 : 2;
  if (coverage[bestSide - 1] < 0.05) return null;
  return candidates[bestSide];
}

function horizontalPressContract(
  primary: RustExerciseProfileData["primarySignal"],
  secondary: RustExerciseProfileData["secondarySignal"],
): SignalContract {
  return {
    coordinateUnit: "image-angle-deg",
    direction: "auto",
    primary,
    secondary,
  };
}

function signalCoverage(
  records: readonly DatasetRecord[],
  signal: RustExerciseProfileData["primarySignal"],
): number {
  let visible = 0;
  let total = 0;
  for (const record of records) {
    const fixture = readJson<Fixture[]>(path.join(capturesRoot, record.source.keypoints))[0];
    if (!fixture) continue;
    for (const pose of fixture.poses) {
      total += 1;
      if (measureSignal(pose.landmarks, signal) !== null) visible += 1;
    }
  }
  return total ? visible / total : 0;
}

function sameSignal(
  left: RustExerciseProfileData["primarySignal"],
  right: RustExerciseProfileData["secondarySignal"],
): boolean {
  return left.kind === right.kind && left.landmarks.join(",") === right.landmarks.join(",");
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
  let selectedValue: number | null = null;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const pose of poses) {
    const distance = Math.abs(pose.timestampMs - timeMs);
    if (distance > 350 || distance >= selectedDistance) continue;
    const value = measureSignal(pose.landmarks, signal);
    if (value === null) continue;
    selectedValue = value;
    selectedDistance = distance;
  }
  return selectedValue;
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

if (require.main === module) main();
