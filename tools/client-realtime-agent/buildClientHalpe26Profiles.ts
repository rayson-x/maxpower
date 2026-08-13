import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  adaptRustExerciseProfileToPoseSchema,
  computeRustExerciseProfileHash,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";

interface ProfileEntry {
  exerciseId: string;
  capturePosition: string;
  profile: Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string | number };
  [key: string]: unknown;
}

interface ProfileArchive {
  profiles: ProfileEntry[];
  [key: string]: unknown;
}

interface TrainingRecord {
  captureId: string;
  sourceCaptureId?: string;
  exerciseId: string;
  capturePosition: string;
  segments?: Array<{ startMs: number; peakMs?: number; endMs: number }>;
}

interface PosePoint {
  x: number;
  y: number;
  visibility: number;
}

interface PoseFrame {
  timestampMs: number;
  landmarks?: PosePoint[];
}

async function main(): Promise<void> {
  const inputPath = resolve(process.argv[2]
    ?? "data/workflows/motion-profile/personal-golden-v2/run-2026-08-10/candidates/final-personal-v3-candidate.json");
  const outputPath = resolve(process.argv[3]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json");
  const overridePath = resolve(process.argv[4]
    ?? "public/archives/confirmed-captures/recognition-profiles.candidate.json");
  const datasetPath = resolve(process.argv[5]
    ?? "data/training/personal-golden-segmentation-v2.json");
  const observationsRoot = resolve(process.argv[6]
    ?? "data/workflows/action-trajectory-database/halpe26-v1/personal-observations");
  const [source, overrides, dataset] = await Promise.all([
    readJson<ProfileArchive>(inputPath),
    readJson<ProfileArchive>(overridePath),
    readJson<{ records: TrainingRecord[] }>(datasetPath),
  ]);
  const overrideByContext = new Map(overrides.profiles.map((entry) => [profileKey(entry), entry]));
  const merged = new Map<string, ProfileEntry>();
  for (const entry of source.profiles) merged.set(profileKey(entry), entry);
  for (const [key, entry] of overrideByContext) merged.set(key, entry);
  const recordsByContext = groupBy(dataset.records, (record) => `${record.exerciseId}\u0000${record.capturePosition}`);
  const sidecarCache = new Map<string, Promise<PoseFrame[]>>();
  const profiles = await Promise.all([...merged.values()].map(async (entry) => {
    const serialized = entry.profile;
    const input = { ...serialized, contentHash: BigInt(serialized.contentHash) } as RustExerciseProfileData;
    const halpe = adaptRustExerciseProfileToPoseSchema(input, "halpe26");
    const calibration = halpe.direction === "auto"
      ? await inferDirection(
        halpe,
        recordsByContext.get(profileKey(entry)) ?? [],
        observationsRoot,
        sidecarCache,
      )
      : { direction: halpe.direction, sampleCount: 0, medianDelta: null, source: "explicit_source_profile" };
    const usesEquipmentPhase = entry.exerciseId === "barbell_bench_press";
    const stateMachineId = usesEquipmentPhase
      ? "barbell-axis-primary-ready-effort-return/v1" as const
      : "cycle-aligned-ready-effort-peak-return/v1" as const;
    const candidateSuffix = usesEquipmentPhase
      ? "barbell-axis-primary-client-candidate-v1"
      : "cycle-aligned-client-candidate-v1";
    const withoutHash = {
      ...halpe,
      identity: `${halpe.identity}/${candidateSuffix}`,
      stateMachineId,
      direction: calibration.direction,
    };
    return {
      ...entry,
      identity: `${String(entry.identity)}/halpe26-${candidateSuffix}`,
      profile: {
        ...withoutHash,
        contentHash: computeRustExerciseProfileHash(withoutHash),
      },
      clientCandidateEvidence: {
        sourceProfileIdentity: serialized.identity,
        sourceProfileHash: String(serialized.contentHash),
        sourceWasCuratedOverride: overrideByContext.has(profileKey(entry)),
        directionCalibration: calibration,
        change: [
          "blazepose33_to_halpe26_index_compatible_adapter",
          usesEquipmentPhase
            ? "rust_barbell_axis_primary_causal_boundaries"
            : "cycle_aligned_causal_boundaries",
          "training_fixed_movement_direction",
        ],
        phaseEvidence: usesEquipmentPhase
          ? "subject_associated_barbell_axis_with_independent_pose_corroboration"
          : "pose_profile_signal",
        productionPromotion: false,
      },
    };
  }));
  const semantic = {
    ...source,
    schemaVersion: "maxpower-client-halpe26-profile-candidates/v1",
    generatedAt: new Date().toISOString(),
    sourceProfilesSha256: createHash("sha256").update(await readFile(inputPath)).digest("hex"),
    overrideProfilesSha256: createHash("sha256").update(await readFile(overridePath)).digest("hex"),
    trainingDatasetSha256: createHash("sha256").update(await readFile(datasetPath)).digest("hex"),
    offlineObservationRole: "profile_training_only_not_runtime_not_acceptance",
    productionPromotion: false,
    profiles,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(semantic, bigintReplacer, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

async function inferDirection(
  profile: RustExerciseProfileData,
  records: TrainingRecord[],
  observationsRoot: string,
  cache: Map<string, Promise<PoseFrame[]>>,
): Promise<{
  direction: "increasing" | "decreasing";
  sampleCount: number;
  medianDelta: number | null;
  source: string;
}> {
  const deltas: number[] = [];
  for (const record of records) {
    const observationId = record.sourceCaptureId ?? record.captureId;
    let framesPromise = cache.get(observationId);
    if (!framesPromise) {
      framesPromise = readPoseFrames(resolve(observationsRoot, `${observationId}.halpe26.json.gz`));
      cache.set(observationId, framesPromise);
    }
    const frames = await framesPromise;
    for (const segment of record.segments ?? []) {
      const middleMs = Number.isFinite(segment.peakMs)
        ? Number(segment.peakMs)
        : (Number(segment.startMs) + Number(segment.endMs)) / 2;
      const start = nearestFrame(frames, Number(segment.startMs), 180);
      const middle = nearestFrame(frames, middleMs, 180);
      if (!start || !middle) continue;
      const startValue = measureSignal(profile.primarySignal, start.landmarks);
      const middleValue = measureSignal(profile.primarySignal, middle.landmarks);
      if (startValue === null || middleValue === null) continue;
      const delta = middleValue - startValue;
      if (Math.abs(delta) >= profile.startAmplitude * 0.35) deltas.push(delta);
    }
  }
  const medianDelta = median(deltas);
  return {
    direction: medianDelta !== null && medianDelta < 0 ? "decreasing" : "increasing",
    sampleCount: deltas.length,
    medianDelta,
    source: "annotated_start_to_legacy_middle_direction_only",
  };
}

async function readPoseFrames(path: string): Promise<PoseFrame[]> {
  const sidecar = JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as { frames?: PoseFrame[] };
  return sidecar.frames ?? [];
}

function nearestFrame(frames: PoseFrame[], timestampMs: number, maximumDistanceMs: number): PoseFrame | null {
  let nearest: PoseFrame | null = null;
  let nearestDistance = Infinity;
  for (const frame of frames) {
    const distance = Math.abs(frame.timestampMs - timestampMs);
    if (distance < nearestDistance) {
      nearest = frame;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= maximumDistanceMs ? nearest : null;
}

function measureSignal(
  signal: RustExerciseProfileData["primarySignal"],
  landmarks: PosePoint[] | undefined,
): number | null {
  if (!landmarks) return null;
  const points = signal.landmarks.map((index) => typeof index === "number" ? landmarks[index] : undefined);
  if (!points.every((point): point is PosePoint => Boolean(point && point.visibility >= 0.05))) return null;
  if (signal.kind === "landmark-y") {
    return points.reduce((sum, point) => sum + point.y, 0) / points.length;
  }
  if (signal.kind === "joint-angle" && points.length === 3) {
    const [first, joint, third] = points;
    const leftX = first.x - joint.x;
    const leftY = first.y - joint.y;
    const rightX = third.x - joint.x;
    const rightY = third.y - joint.y;
    const denominator = Math.hypot(leftX, leftY) * Math.hypot(rightX, rightY);
    if (denominator <= 1e-8) return null;
    const cosine = Math.max(-1, Math.min(1, (leftX * rightX + leftY * rightY) / denominator));
    return Math.acos(cosine) * 180 / Math.PI;
  }
  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function profileKey(entry: Pick<ProfileEntry, "exerciseId" | "capturePosition">): string {
  return `${entry.exerciseId}\u0000${entry.capturePosition}`;
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const output = new Map<string, T[]>();
  for (const value of values) {
    const group = output.get(key(value)) ?? [];
    group.push(value);
    output.set(key(value), group);
  }
  return output;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
