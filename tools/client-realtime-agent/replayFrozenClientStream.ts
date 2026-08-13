import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";

type SerializedProfile = Omit<RustExerciseProfileData, "contentHash"> & {
  contentHash: string | number;
};

interface FrozenFrame {
  timestampMs: number;
  selectedCandidateId: string | number | null;
  selectedBbox: PoseCandidateEstimate["bbox"] | null;
  selectedLandmarks: PoseCandidateEstimate["landmarks"];
  visualBarbellAxis?: {
    source: "measured" | "fused" | "predicted";
    confidence: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    centerY: number;
  } | null;
}

interface FrozenCase {
  captureId: string;
  sourceCaptureId: string;
  preset: { exerciseId: string; capturePosition: string };
  profileIdentity: string;
  video: { width: number; height: number; durationMs: number };
  window: { startMs: number; endMs: number };
  runtime: Record<string, unknown>;
  frames: FrozenFrame[];
}

interface FrozenPrediction {
  schemaVersion: string;
  generatedAt: string;
  packSha256: string;
  seed: string;
  runtime: Record<string, unknown>;
  cases: FrozenCase[];
}

interface TruthFreePack {
  cases: Array<{ captureId: string; profile: SerializedProfile }>;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const inputPath = resolve(root, process.argv[2]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-prediction-before-truth.json");
  const packPath = resolve(root, process.argv[3]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/test-pack-before-truth.json");
  const outputPath = resolve(root, process.argv[4]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/rust-stable-cycle-frozen-stream-debug.json");
  const stateMachineId = (process.argv[5]
    ?? "stable-cycle-200ms-ready-effort-peak-return/v1") as RustExerciseProfileData["stateMachineId"];
  const directionOverride = process.argv[6] as RustExerciseProfileData["direction"] | undefined;
  const [prediction, pack, wasmBytes] = await Promise.all([
    readJson<FrozenPrediction>(inputPath),
    readJson<TruthFreePack>(packPath),
    readFile(resolve(root, "public/motion-sdk/maxpower_motion_sdk.wasm")),
  ]);
  const profileByCapture = new Map(pack.cases.map((testCase) => [testCase.captureId, testCase.profile]));
  const cases = [];
  for (const frozenCase of prediction.cases) {
    const serialized = profileByCapture.get(frozenCase.captureId);
    if (!serialized) throw new Error(`${frozenCase.captureId}: profile missing from truth-free pack`);
    const original = { ...serialized, contentHash: BigInt(serialized.contentHash) } as RustExerciseProfileData;
    const changedWithoutHash = {
      ...original,
      identity: `${original.identity}/debug-${stateMachineId}`,
      stateMachineId,
      ...(directionOverride ? { direction: directionOverride } : {}),
    };
    const changed: RustExerciseProfileData = {
      ...changedWithoutHash,
      contentHash: computeRustExerciseProfileHash(changedWithoutHash),
    };
    const wasm = await instantiateRustMotionWasm(wasmBytes);
    const motion = new RustCanonicalWasmSession({
      sequenceId: `frozen-client-debug:${frozenCase.captureId}`,
      schema: "halpe26",
      image: { widthPx: frozenCase.video.width, heightPx: frozenCase.video.height, rotationDegrees: 0, mirrored: false },
      stabilization: "fusion",
      setLifecycleMode: "preview",
    }, wasm);
    const installed = motion.installExerciseProfileData(changed);
    motion.beginSet();
    const sealed = new Map<string, typeof motion.lastCompletedReps[number]>();
    const canonicalDiagnostics = [];
    for (const frame of frozenCase.frames) {
      const candidates = frame.selectedBbox && frame.selectedLandmarks.length === 26
        ? [toCandidate(frame)]
        : [];
      const canonical = motion.processCandidates(
        candidates,
        frame.timestampMs,
        toEquipment(frame.visualBarbellAxis),
      );
      canonicalDiagnostics.push({
        timestampMs: frame.timestampMs,
        frameValid: motion.lastFrameValid,
        targetState: motion.lastTarget.state,
        landmarks: canonical.landmarks.map((landmark, index) => ({
          index,
          source: landmark.source,
          observationScore: landmark.observationScore,
          canonicalConfidence: landmark.canonicalConfidence,
          reason: landmark.continuityReason,
        })),
      });
      for (const rep of motion.lastCompletedReps) sealed.set(rep.repId.toString(), rep);
    }
    motion.finishSet();
    for (const rep of motion.lastCompletedReps) sealed.set(rep.repId.toString(), rep);
    cases.push({
      ...frozenCase,
      profileIdentity: installed.identity,
      reps: [...sealed.values()].map((rep) => ({
        repId: rep.repId,
        startMs: rep.startTimestampMs,
        peakMs: rep.peakTimestampMs,
        endMs: rep.endTimestampMs,
        disposition: rep.disposition,
        recoveredAcrossGap: rep.recoveredAcrossGap,
        evidenceReason: rep.evidenceReason,
        observationFindings: rep.observationFindings,
        canonicalSliceHash: rep.canonicalSliceHash,
      })),
      frames: [],
      canonicalDiagnostics,
    });
    motion.close();
  }
  const output = {
    ...prediction,
    schemaVersion: "maxpower-client-frozen-stream-rust-debug/v1",
    generatedAt: new Date().toISOString(),
    runtime: {
      ...prediction.runtime,
      pass: "frozen-client-observations-rust-only-debug-replay",
      pythonVisionUsed: false,
      acceptanceEligible: false,
      stateMachineId,
      directionOverride: directionOverride ?? null,
    },
    cases,
  };
  await writeFile(outputPath, `${JSON.stringify(output, bigintReplacer, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
}

function toEquipment(axis: FrozenFrame["visualBarbellAxis"]): RustEquipmentObservation[] {
  if (!axis || axis.source === "predicted") return [];
  const x = Math.max(0, Math.min(axis.x1, axis.x2));
  const right = Math.min(1, Math.max(axis.x1, axis.x2));
  const top = Math.max(0, Math.min(axis.y1, axis.y2) - 0.008);
  const bottom = Math.min(1, Math.max(axis.y1, axis.y2) + 0.008);
  if (right <= x || bottom <= top) return [];
  return [{
    proposalId: 1,
    kind: "barbell_shaft",
    bbox: { x, y: top, width: right - x, height: bottom - top },
    score: axis.confidence,
    uncertaintyPx: null,
    source: "geometry",
    reflectionCandidate: false,
    staticRackCandidate: false,
    occlusion: "none",
    truncated: x <= 0.001 || right >= 0.999,
  }];
}

function toCandidate(frame: FrozenFrame): PoseCandidateEstimate {
  return {
    timestampMs: frame.timestampMs,
    candidateId: Number(frame.selectedCandidateId ?? 0),
    bbox: frame.selectedBbox!,
    torsoColor: [0, 0, 0],
    landmarks: frame.selectedLandmarks,
    worldLandmarks: [],
  };
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
