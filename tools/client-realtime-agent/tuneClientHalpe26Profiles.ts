import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";

type SerializedProfile = Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string | number };

interface ProfileEntry {
  exerciseId: string;
  capturePosition: string;
  profile: SerializedProfile;
  [key: string]: unknown;
}

interface TrainingRecord {
  captureId: string;
  sourceCaptureId?: string;
  exerciseId: string;
  capturePosition: string;
  evaluationWindow?: { startMs: number; endMs: number } | null;
  segments?: Array<{ startMs: number; endMs: number }>;
  source?: { durationMs?: number };
}

interface SidecarFrame {
  timestampMs: number;
  selectedBbox?: { x: number; y: number; width: number; height: number } | null;
  landmarks?: Array<{ x: number; y: number; z?: number | null; visibility: number }>;
}

interface Sidecar {
  source?: { width?: number; height?: number };
  frames?: SidecarFrame[];
}

interface Segment {
  startMs: number;
  peakMs: number;
  endMs: number;
  disposition: string;
}

const SAMPLE_INTERVAL_MS = 80;

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const inputPath = resolve(root, process.argv[2]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json");
  const outputPath = resolve(root, process.argv[3]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-rust-tuned-profiles.json");
  const datasetPath = resolve(root, process.argv[4]
    ?? "data/training/personal-golden-segmentation-v2.json");
  const observationsRoot = resolve(root, process.argv[5]
    ?? "data/workflows/action-trajectory-database/halpe26-v1/personal-observations");
  const contextFilter = process.argv[6] ? new Set(process.argv[6].split(",")) : null;
  const [archive, dataset, wasmBytes] = await Promise.all([
    readJson<{ profiles: ProfileEntry[]; [key: string]: unknown }>(inputPath),
    readJson<{ records: TrainingRecord[] }>(datasetPath),
    readFile(resolve(root, "public/motion-sdk/maxpower_motion_sdk.wasm")).then((bytes) =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer),
  ]);
  const recordsByContext = groupBy(
    dataset.records,
    (record) => `${record.exerciseId}\u0000${record.capturePosition}`,
  );
  const sidecars = new Map<string, Promise<Sidecar>>();
  const tunedProfiles: ProfileEntry[] = [];

  for (const entry of archive.profiles) {
    const context = `${entry.exerciseId}\u0000${entry.capturePosition}`;
    const printableContext = `${entry.exerciseId}/${entry.capturePosition}`;
    if (contextFilter && !contextFilter.has(printableContext)) {
      tunedProfiles.push(entry);
      continue;
    }
    const records = recordsByContext.get(context) ?? [];
    const original = deserializeProfile(entry.profile);
    if (!records.length) {
      tunedProfiles.push(entry);
      continue;
    }
    const prepared = await Promise.all(records.map(async (record) => {
      const sourceId = record.sourceCaptureId ?? record.captureId;
      let promise = sidecars.get(sourceId);
      if (!promise) {
        promise = readSidecar(resolve(observationsRoot, `${sourceId}.halpe26.json.gz`));
        sidecars.set(sourceId, promise);
      }
      return { record, sidecar: await promise };
    }));
    let best: { profile: RustExerciseProfileData; score: ReturnType<typeof emptyScore>; params: unknown } | null = null;
    for (const candidate of candidates(original, records, prepared)) {
      const score = emptyScore();
      let validCandidate = true;
      for (const item of prepared) {
        try {
          const predicted = await replay(candidate.profile, item.record, item.sidecar, wasmBytes);
          accumulateScore(score, item.record.segments ?? [], predicted);
        } catch (error) {
          if (error instanceof Error && error.message.includes("install_profile failed")) {
            validCandidate = false;
            break;
          }
          throw error;
        }
      }
      if (!validCandidate) continue;
      if (!best || compareScore(score, best.score) > 0) {
        best = { profile: candidate.profile, score, params: candidate.params };
      }
    }
    if (!best) throw new Error(`${entry.exerciseId}/${entry.capturePosition}: no tuning candidate`);
    const captureScores = [];
    for (const item of prepared) {
      const score = emptyScore();
      const predicted = await replay(best.profile, item.record, item.sidecar, wasmBytes);
      accumulateScore(score, item.record.segments ?? [], predicted);
      captureScores.push({
        captureId: item.record.captureId,
        sourceCaptureId: item.record.sourceCaptureId ?? item.record.captureId,
        ...score,
      });
    }
    const withoutHash = {
      ...best.profile,
      identity: `${original.identity}/rust-client-tuned-v1`,
    };
    const profile = {
      ...withoutHash,
      contentHash: computeRustExerciseProfileHash(withoutHash),
    };
    tunedProfiles.push({
      ...entry,
      identity: `${String(entry.identity)}/rust-client-tuned-v1`,
      profile: serializeProfile(profile),
      clientRustTuning: {
        runtime: "rust-wasm/maxpower-motion-sdk",
        visualObservationSource: "offline_same_model_halpe26_oracle_not_runtime_not_acceptance",
        causality: "chronological_sampled_no_future",
        sampleIntervalMs: SAMPLE_INTERVAL_MS,
        captureCount: records.length,
        labeledRepCount: records.reduce((sum, record) => sum + (record.segments?.length ?? 0), 0),
        selectedParameters: best.params,
        trainingScore: best.score,
        captureScores,
        productionPromotion: false,
      },
    });
    process.stdout.write(`${entry.exerciseId}/${entry.capturePosition}\t${best.score.matched}/${best.score.truth}\tFP ${best.score.falsePositive}\n`);
  }

  const semantic = {
    ...archive,
    schemaVersion: "maxpower-client-halpe26-rust-tuned-profile-candidates/v1",
    generatedAt: new Date().toISOString(),
    sourceProfilesSha256: createHash("sha256").update(await readFile(inputPath)).digest("hex"),
    trainingDatasetSha256: createHash("sha256").update(await readFile(datasetPath)).digest("hex"),
    runtimeCompatibility: ["web-wasm", "android-native", "ios-native"],
    pythonVisionRuntime: false,
    productionPromotion: false,
    profiles: tunedProfiles,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(semantic, bigintReplacer, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

function candidates(
  base: RustExerciseProfileData,
  records: TrainingRecord[],
  prepared: Array<{ record: TrainingRecord; sidecar: Sidecar }>,
) {
  const labeledDurations = records.flatMap((record) => (record.segments ?? [])
    .map((segment) => segment.endMs - segment.startMs)
    .filter((duration) => duration > 0));
  const observedMax = percentile(labeledDurations, 0.9) ?? base.maxRepDurationMs;
  const maxDurationOptions = uniqueNumbers([
    3_000,
    4_500,
    6_000,
    Math.round(observedMax * 1.15),
    base.maxRepDurationMs,
  ].map((value) => Math.max(1_500, Math.min(10_000, value))));
  const mirroredSecondary = mirrorSignal(base.primarySignal);
  const learnedSignals = fitSignalVariants(prepared);
  const signalVariants = uniqueSignalVariants([
    {
      name: "source",
      coordinateUnit: base.coordinateUnit,
      direction: base.direction,
      primarySignal: base.primarySignal,
      secondarySignal: base.secondarySignal,
      thresholds: null,
    },
    {
      name: "bilateral_mirror",
      coordinateUnit: base.coordinateUnit,
      direction: base.direction,
      primarySignal: base.primarySignal,
      secondarySignal: mirroredSecondary,
      thresholds: null,
    },
    ...learnedSignals,
  ]);
  const output = [];
  for (const signals of signalVariants) {
    for (const startScale of [0.65, 0.85, 1, 1.25]) {
      for (const returnScale of [0.6, 0.8, 1, 1.25]) {
        for (const readyScale of [0.75, 1, 1.35]) {
          for (const maxRepDurationMs of maxDurationOptions) {
            const withoutHash = {
              ...base,
              coordinateUnit: signals.coordinateUnit,
              direction: signals.direction,
              primarySignal: signals.primarySignal,
              secondarySignal: signals.secondarySignal,
              startAmplitude: (signals.thresholds?.startAmplitude ?? base.startAmplitude) * startScale,
              minPrimaryAmplitude: signals.thresholds?.minPrimaryAmplitude ?? base.minPrimaryAmplitude,
              minSecondaryAmplitude: signals.thresholds?.minSecondaryAmplitude ?? base.minSecondaryAmplitude,
              returnHysteresis: (signals.thresholds?.returnHysteresis ?? base.returnHysteresis) * returnScale,
              readyTolerance: (signals.thresholds?.readyTolerance ?? base.readyTolerance) * readyScale,
              maxRepDurationMs,
            };
            output.push({
              profile: {
                ...withoutHash,
                contentHash: computeRustExerciseProfileHash(withoutHash),
              },
              params: { signalVariant: signals.name, startScale, returnScale, readyScale, maxRepDurationMs },
            });
          }
        }
      }
    }
  }
  return output;
}

function fitSignalVariants(prepared: Array<{ record: TrainingRecord; sidecar: Sidecar }>) {
  const signalCandidates: Array<{
    name: string;
    coordinateUnit: RustExerciseProfileData["coordinateUnit"];
    primarySignal: RustExerciseProfileData["primarySignal"];
    secondarySignal: RustExerciseProfileData["secondarySignal"];
  }> = [
    ...[
      [5, 6, "shoulder_y"], [7, 8, "elbow_y"], [9, 10, "wrist_y"],
      [11, 12, "hip_y"], [13, 14, "knee_y"], [15, 16, "ankle_y"],
    ].map(([left, right, name]) => ({
      name: String(name),
      coordinateUnit: "image-normalized-y" as const,
      primarySignal: { kind: "landmark-y" as const, landmarks: [Number(left)] as const },
      secondarySignal: { kind: "landmark-y" as const, landmarks: [Number(right)] as const },
    })),
    ...[
      [[5, 7, 9], [6, 8, 10], "elbow_angle"],
      [[11, 5, 7], [12, 6, 8], "shoulder_elbow_angle"],
      [[11, 5, 9], [12, 6, 10], "shoulder_wrist_angle"],
      [[5, 11, 13], [6, 12, 14], "hip_angle"],
      [[11, 13, 15], [12, 14, 16], "knee_angle"],
    ].map(([left, right, name]) => ({
      name: String(name),
      coordinateUnit: "image-angle-deg" as const,
      primarySignal: { kind: "joint-angle" as const, landmarks: left as unknown as readonly [number, number, number] },
      secondarySignal: { kind: "joint-angle" as const, landmarks: right as unknown as readonly [number, number, number] },
    })),
    ...[
      [9, 10, "wrist_distance"], [7, 8, "elbow_distance"],
      [15, 16, "ankle_distance"], [5, 9, "left_upper_limb_distance"],
      [6, 10, "right_upper_limb_distance"],
    ].map(([first, second, name]) => {
      const signal = { kind: "landmark-distance" as const, landmarks: [Number(first), Number(second)] as const };
      return {
        name: String(name),
        coordinateUnit: "torso-normalized-distance" as const,
        primarySignal: signal,
        secondarySignal: signal,
      };
    }),
    ...[
      [9, 10, "wrist_horizontal_distance"], [7, 8, "elbow_horizontal_distance"],
      [15, 16, "ankle_horizontal_distance"],
    ].map(([first, second, name]) => {
      const signal = {
        kind: "landmark-horizontal-distance" as const,
        landmarks: [Number(first), Number(second)] as const,
      };
      return {
        name: String(name),
        coordinateUnit: "torso-normalized-distance" as const,
        primarySignal: signal,
        secondarySignal: signal,
      };
    }),
  ];
  return signalCandidates
    .map((candidate) => scoreSignalVariant(candidate, prepared))
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((left, right) => right.fitScore - left.fitScore)
    .slice(0, 4);
}

function scoreSignalVariant(
  candidate: {
    name: string;
    coordinateUnit: RustExerciseProfileData["coordinateUnit"];
    primarySignal: RustExerciseProfileData["primarySignal"];
    secondarySignal: RustExerciseProfileData["secondarySignal"];
  },
  prepared: Array<{ record: TrainingRecord; sidecar: Sidecar }>,
) {
  type Direction = "increasing" | "decreasing";
  type SignalSample = {
    primaryDelta: number;
    secondaryDelta: number;
    primaryReturn: number;
    secondaryReturn: number;
  };
  const samplesByDirection: Record<Direction, SignalSample[]> = {
    increasing: [],
    decreasing: [],
  };
  let truthCount = 0;
  for (const { record, sidecar } of prepared) {
    const frames = sidecar.frames ?? [];
    for (const segment of record.segments ?? []) {
      truthCount += 1;
      const durationMs = segment.endMs - segment.startMs;
      if (durationMs <= 0) continue;
      const endpointWindowMs = Math.max(120, Math.min(320, durationMs * 0.15));
      const measured = frames
        .filter((frame) => frame.timestampMs >= segment.startMs - 120
          && frame.timestampMs <= segment.endMs + 120)
        .map((frame) => ({
          timestampMs: frame.timestampMs,
          primary: measureSidecarSignal(candidate.primarySignal, frame.landmarks),
          secondary: measureSidecarSignal(candidate.secondarySignal, frame.landmarks),
        }))
        .filter((frame): frame is { timestampMs: number; primary: number; secondary: number } =>
          frame.primary !== null && frame.secondary !== null);
      const startFrames = measured.filter((frame) =>
        frame.timestampMs >= segment.startMs - 120
        && frame.timestampMs <= segment.startMs + endpointWindowMs);
      const endFrames = measured.filter((frame) =>
        frame.timestampMs >= segment.endMs - endpointWindowMs
        && frame.timestampMs <= segment.endMs + 120);
      const interiorFrames = measured.filter((frame) =>
        frame.timestampMs >= segment.startMs + endpointWindowMs * 0.5
        && frame.timestampMs <= segment.endMs - endpointWindowMs * 0.5);
      if (!startFrames.length || !endFrames.length || interiorFrames.length < 3) continue;
      const primaryStart = median(startFrames.map((frame) => frame.primary));
      const secondaryStart = median(startFrames.map((frame) => frame.secondary));
      const primaryEnd = median(endFrames.map((frame) => frame.primary));
      const secondaryEnd = median(endFrames.map((frame) => frame.secondary));
      if (primaryStart === null || secondaryStart === null || primaryEnd === null || secondaryEnd === null) continue;
      for (const direction of ["increasing", "decreasing"] as const) {
        const extremumQuantile = direction === "increasing" ? 0.90 : 0.10;
        const primaryExtremum = interpolatedPercentile(
          interiorFrames.map((frame) => frame.primary),
          extremumQuantile,
        );
        const secondaryExtremum = interpolatedPercentile(
          interiorFrames.map((frame) => frame.secondary),
          extremumQuantile,
        );
        if (primaryExtremum === null || secondaryExtremum === null) continue;
        samplesByDirection[direction].push({
          primaryDelta: primaryExtremum - primaryStart,
          secondaryDelta: secondaryExtremum - secondaryStart,
          primaryReturn: primaryEnd - primaryStart,
          secondaryReturn: secondaryEnd - secondaryStart,
        });
      }
    }
  }
  const normalization = candidate.coordinateUnit === "image-normalized-y" ? 0.20
    : candidate.coordinateUnit === "image-angle-deg" ? 60
      : 1;
  const fits = (["increasing", "decreasing"] as const).flatMap((direction) => {
    const samples = samplesByDirection[direction];
    if (samples.length < Math.max(3, truthCount * 0.65)) return [];
    const sign = direction === "increasing" ? 1 : -1;
    const coherent = samples.filter((sample) =>
      sample.primaryDelta * sign > 0 && sample.secondaryDelta * sign > 0);
    if (coherent.length < samples.length * 0.60) return [];
    const primaryAmplitudes = coherent.map((sample) => sample.primaryDelta * sign);
    const secondaryAmplitudes = coherent.map((sample) => sample.secondaryDelta * sign);
    const effectiveAmplitudes = coherent.map((sample) =>
      Math.min(sample.primaryDelta * sign, sample.secondaryDelta * sign));
    const returnRatios = coherent.map((sample) => {
      const amplitude = Math.max(1e-6, Math.min(Math.abs(sample.primaryDelta), Math.abs(sample.secondaryDelta)));
      return (Math.abs(sample.primaryReturn) + Math.abs(sample.secondaryReturn)) / (2 * amplitude);
    });
    const medianAmplitude = median(effectiveAmplitudes) ?? 0;
    const consistency = coherent.length / samples.length;
    const coverage = samples.length / Math.max(1, truthCount);
    const returnRatio = median(returnRatios) ?? 10;
    const fitScore = (medianAmplitude / normalization) * consistency * coverage / (1 + returnRatio * 1.5);
    return [{ direction, coherent, primaryAmplitudes, secondaryAmplitudes, medianAmplitude, fitScore }];
  });
  const fit = fits.sort((left, right) => right.fitScore - left.fitScore)[0];
  if (!fit) return null;
  const { direction, coherent, primaryAmplitudes, secondaryAmplitudes, medianAmplitude, fitScore } = fit;
  const primaryQ20 = percentile(primaryAmplitudes, 0.20) ?? medianAmplitude;
  const secondaryQ20 = percentile(secondaryAmplitudes, 0.20) ?? medianAmplitude;
  const returnDeviation = median(coherent.flatMap((sample) =>
    [Math.abs(sample.primaryReturn), Math.abs(sample.secondaryReturn)])) ?? 0;
  return {
    ...candidate,
    name: `learned_${candidate.name}`,
    direction,
    fitScore,
    thresholds: {
      startAmplitude: clampSignalThreshold(medianAmplitude * 0.14, candidate.coordinateUnit, "start"),
      minPrimaryAmplitude: Math.max(primaryQ20 * 0.65, medianAmplitude * 0.35),
      minSecondaryAmplitude: Math.max(secondaryQ20 * 0.65, medianAmplitude * 0.35),
      returnHysteresis: clampSignalThreshold(medianAmplitude * 0.18, candidate.coordinateUnit, "return"),
      readyTolerance: clampSignalThreshold(
        Math.max(returnDeviation * 1.25, medianAmplitude * 0.12),
        candidate.coordinateUnit,
        "ready",
      ),
    },
  };
}

function interpolatedPercentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  if (ordered.length === 1) return ordered[0];
  const position = Math.max(0, Math.min(1, quantile)) * (ordered.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return ordered[lower] * (1 - fraction) + ordered[upper] * fraction;
}

function clampSignalThreshold(
  value: number,
  coordinateUnit: RustExerciseProfileData["coordinateUnit"],
  kind: "start" | "return" | "ready",
): number {
  if (coordinateUnit === "image-normalized-y") return Math.max(0.006, Math.min(kind === "ready" ? 0.08 : 0.06, value));
  if (coordinateUnit === "image-angle-deg") return Math.max(1.5, Math.min(kind === "ready" ? 15 : 12, value));
  return Math.max(0.015, Math.min(kind === "ready" ? 0.30 : 0.20, value));
}

function nearestSidecarFrame(frames: SidecarFrame[], timestampMs: number, maxDistanceMs: number): SidecarFrame | null {
  let nearest: SidecarFrame | null = null;
  let distance = Infinity;
  for (const frame of frames) {
    const candidate = Math.abs(frame.timestampMs - timestampMs);
    if (candidate < distance) {
      nearest = frame;
      distance = candidate;
    }
  }
  return distance <= maxDistanceMs ? nearest : null;
}

function measureSidecarSignal(
  signal: RustExerciseProfileData["primarySignal"],
  landmarks: SidecarFrame["landmarks"],
): number | null {
  if (!landmarks) return null;
  const indices = signal.landmarks.filter((index): index is number => typeof index === "number");
  const points = indices.map((index) => landmarks[index]);
  if (!points.every((point) => point && point.visibility >= 0.05)) return null;
  if (signal.kind === "landmark-y") return points.reduce((sum, point) => sum + point.y, 0) / points.length;
  if (signal.kind === "joint-angle" && points.length === 3) {
    const [first, joint, third] = points;
    const left = [first.x - joint.x, first.y - joint.y];
    const right = [third.x - joint.x, third.y - joint.y];
    const denominator = Math.hypot(...left) * Math.hypot(...right);
    if (denominator <= 1e-8) return null;
    const cosine = Math.max(-1, Math.min(1, (left[0] * right[0] + left[1] * right[1]) / denominator));
    return Math.acos(cosine) * 180 / Math.PI;
  }
  if ((signal.kind === "landmark-distance"
      || signal.kind === "landmark-horizontal-distance"
      || signal.kind === "landmark-vertical-distance")
    && points.length === 2) {
    const shoulderCenter = midpoint(landmarks[5], landmarks[6]);
    const hipCenter = midpoint(landmarks[11], landmarks[12]);
    if (!shoulderCenter || !hipCenter) return null;
    const torso = Math.hypot(shoulderCenter.x - hipCenter.x, shoulderCenter.y - hipCenter.y);
    if (torso <= 1e-6) return null;
    if (signal.kind === "landmark-horizontal-distance") {
      return Math.abs(points[0].x - points[1].x) / torso;
    }
    if (signal.kind === "landmark-vertical-distance") {
      return Math.abs(points[0].y - points[1].y) / torso;
    }
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / torso;
  }
  return null;
}

function midpoint(
  left: SidecarFrame["landmarks"] extends Array<infer T> | undefined ? T : never,
  right: SidecarFrame["landmarks"] extends Array<infer T> | undefined ? T : never,
) {
  if (!left || !right || left.visibility < 0.05 || right.visibility < 0.05) return null;
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function mirrorSignal(signal: RustExerciseProfileData["primarySignal"]): RustExerciseProfileData["secondarySignal"] {
  const mirror = new Map([
    [1, 2], [2, 1], [3, 4], [4, 3], [5, 6], [6, 5], [7, 8], [8, 7],
    [9, 10], [10, 9], [11, 12], [12, 11], [13, 14], [14, 13], [15, 16], [16, 15],
    [20, 21], [21, 20], [22, 23], [23, 22], [24, 25], [25, 24],
  ]);
  return {
    ...signal,
    landmarks: signal.landmarks.map((index) => typeof index === "number" ? (mirror.get(index) ?? index) : index),
  } as unknown as RustExerciseProfileData["secondarySignal"];
}

function uniqueSignalVariants<T extends { primarySignal: unknown; secondarySignal: unknown }>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify([value.primarySignal, value.secondarySignal]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function replay(
  profile: RustExerciseProfileData,
  record: TrainingRecord,
  sidecar: Sidecar,
  wasmBytes: BufferSource,
): Promise<Segment[]> {
  const frames = sidecar.frames ?? [];
  const width = Math.max(1, Math.round(sidecar.source?.width ?? 1280));
  const height = Math.max(1, Math.round(sidecar.source?.height ?? 720));
  const evaluationStart = record.evaluationWindow?.startMs ?? 0;
  const evaluationEnd = record.evaluationWindow?.endMs
    ?? record.source?.durationMs
    ?? frames.at(-1)?.timestampMs
    ?? 0;
  const processStart = Math.max(0, evaluationStart - 2_000);
  const wasm = await instantiateRustMotionWasm(wasmBytes);
  const motion = new RustCanonicalWasmSession({
    sequenceId: `profile-tuning:${record.captureId}`,
    schema: "halpe26",
    image: { widthPx: width, heightPx: height, rotationDegrees: 0, mirrored: false },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);
  motion.installExerciseProfileData(profile);
  motion.beginSet();
  const outcomes = new Map<string, typeof motion.lastCompletedReps[number]>();
  let lastTimestamp = -Infinity;
  for (const frame of frames) {
    if (frame.timestampMs < processStart || frame.timestampMs > evaluationEnd) continue;
    if (frame.timestampMs - lastTimestamp < SAMPLE_INTERVAL_MS) continue;
    lastTimestamp = frame.timestampMs;
    const candidates = toCandidates(frame);
    motion.processCandidates(candidates, frame.timestampMs);
    for (const rep of motion.lastCompletedReps) outcomes.set(rep.repId.toString(), rep);
  }
  motion.finishSet();
  for (const rep of motion.lastCompletedReps) outcomes.set(rep.repId.toString(), rep);
  motion.close();
  return [...outcomes.values()]
    .filter((rep) => rep.disposition !== "rejected")
    .map((rep) => ({
      startMs: Number(rep.startTimestampMs),
      peakMs: Number(rep.peakTimestampMs),
      endMs: Number(rep.endTimestampMs),
      disposition: rep.disposition,
    }))
    .filter((rep) => rep.peakMs >= evaluationStart && rep.startMs <= evaluationEnd);
}

function toCandidates(frame: SidecarFrame): PoseCandidateEstimate[] {
  if (!frame.selectedBbox || frame.landmarks?.length !== 26) return [];
  return [{
    timestampMs: frame.timestampMs,
    candidateId: 0,
    bbox: frame.selectedBbox,
    torsoColor: [0, 0, 0],
    landmarks: frame.landmarks.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z ?? 0,
      visibility: point.visibility,
    })),
    worldLandmarks: [],
  }];
}

function emptyScore() {
  return {
    objective: 0,
    truth: 0,
    predicted: 0,
    matched: 0,
    falsePositive: 0,
    missed: 0,
    rangeAligned: 0,
    exactSetCount: 0,
    needsReview: 0,
    absoluteBoundaryErrorMs: 0,
  };
}

function accumulateScore(
  score: ReturnType<typeof emptyScore>,
  truth: Array<{ startMs: number; endMs: number }>,
  predicted: Segment[],
): void {
  const available = new Set(predicted.map((_, index) => index));
  let matched = 0;
  let aligned = 0;
  let boundaryError = 0;
  for (const expected of truth) {
    let bestIndex = -1;
    let bestIou = 0;
    for (const index of available) {
      const overlap = intervalIou(expected, predicted[index]);
      if (overlap > bestIou) {
        bestIou = overlap;
        bestIndex = index;
      }
    }
    if (bestIndex < 0 || bestIou < 0.10) continue;
    available.delete(bestIndex);
    matched += 1;
    const candidate = predicted[bestIndex];
    const startError = Math.abs(candidate.startMs - expected.startMs);
    const endError = Math.abs(candidate.endMs - expected.endMs);
    boundaryError += Math.min(2_000, startError) + Math.min(2_000, endError);
    if (startError <= 500 && endError <= 500) aligned += 1;
  }
  const missed = truth.length - matched;
  const falsePositive = predicted.length - matched;
  const exact = predicted.length === truth.length ? 1 : 0;
  const review = predicted.filter((segment) => segment.disposition === "needs_review").length;
  score.truth += truth.length;
  score.predicted += predicted.length;
  score.matched += matched;
  score.missed += missed;
  score.falsePositive += falsePositive;
  score.rangeAligned += aligned;
  score.exactSetCount += exact;
  score.needsReview += review;
  score.absoluteBoundaryErrorMs += boundaryError;
  score.objective += matched * 1_000
    - missed * 1_300
    - falsePositive * 1_500
    + aligned * 160
    + exact * 500
    - review * 25
    - boundaryError / 25;
}

function compareScore(left: ReturnType<typeof emptyScore>, right: ReturnType<typeof emptyScore>): number {
  if (left.objective !== right.objective) return left.objective - right.objective;
  if (left.falsePositive !== right.falsePositive) return right.falsePositive - left.falsePositive;
  if (left.missed !== right.missed) return right.missed - left.missed;
  return right.absoluteBoundaryErrorMs - left.absoluteBoundaryErrorMs;
}

function intervalIou(
  left: { startMs: number; endMs: number },
  right: { startMs: number; endMs: number },
): number {
  const intersection = Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
  const union = Math.max(left.endMs, right.endMs) - Math.min(left.startMs, right.startMs);
  return union > 0 ? intersection / union : 0;
}

function deserializeProfile(profile: SerializedProfile): RustExerciseProfileData {
  return { ...profile, contentHash: BigInt(profile.contentHash) } as RustExerciseProfileData;
}

function serializeProfile(profile: RustExerciseProfileData): SerializedProfile {
  return { ...profile, contentHash: profile.contentHash.toString() } as SerializedProfile;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))];
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
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

async function readSidecar(path: string): Promise<Sidecar> {
  return JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as Sidecar;
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
