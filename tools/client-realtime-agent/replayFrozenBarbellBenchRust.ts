import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";
import { buildClientExecutionAssessment } from "./clientExecutionReport";

type JsonObject = Record<string, unknown>;
type SerializedProfile = Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string | number };

interface AxisRecord {
  source: "measured" | "predicted";
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  centerY: number;
}

interface AlignmentFrame {
  frameNumber: number;
  timestampMs: number;
  axis: AxisRecord | null;
}

interface AlignmentSidecar {
  captureId: string;
  sourcePoseSidecar: string;
  frames: AlignmentFrame[];
}

interface PoseFrame {
  frameNumber: number;
  timestampMs: number;
  selectedBbox: PoseCandidateEstimate["bbox"] | null;
  landmarks: Array<{ x: number; y: number; z: number | null; visibility: number }>;
}

interface PoseSidecar {
  source: { widthPx: number; heightPx: number; durationMs: number };
  frames: PoseFrame[];
}

interface DatasetRecord {
  sourceCaptureId?: string;
  captureId?: string;
  exerciseId: string;
  capturePosition: string;
}

async function main(): Promise<void> {
  const root = resolve(process.cwd());
  const observationRoot = resolve(root, process.argv[2]
    ?? "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations");
  const profilePath = resolve(root, process.argv[3]
    ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json");
  const outputPath = resolve(root, process.argv[4]
    ?? "data/workflows/client-realtime-agent/barbell-pose-rust-v1/prediction-before-truth.json");
  const datasetPath = resolve(root, "data/training/personal-golden-segmentation-v2.json");
  const [profileArchive, dataset, wasmBytes] = await Promise.all([
    readJson<{ profiles: Array<{ exerciseId: string; capturePosition: string; profile: SerializedProfile }> }>(profilePath),
    readJson<{ records: DatasetRecord[] }>(datasetPath),
    readFile(resolve(root, "public/motion-sdk/maxpower_motion_sdk.wasm")),
  ]);
  const recordByCapture = new Map(dataset.records.map((record) => [
    String(record.sourceCaptureId ?? record.captureId),
    record,
  ]));
  const profileByView = new Map(profileArchive.profiles
    .filter((entry) => entry.exerciseId === "barbell_bench_press")
    .map((entry) => [entry.capturePosition, entry.profile]));
  const files = (await readdir(observationRoot))
    .filter((name) => name.endsWith(".barbell-pose-alignment.json.gz"))
    .sort();
  const cases = [];
  for (const name of files) {
    const alignment = await readGzipJson<AlignmentSidecar>(resolve(observationRoot, name));
    const pose = await readGzipJson<PoseSidecar>(resolve(root, alignment.sourcePoseSidecar));
    const record = recordByCapture.get(alignment.captureId);
    if (!record) throw new Error(`${alignment.captureId}: dataset record missing`);
    const serialized = profileByView.get(record.capturePosition);
    if (!serialized) throw new Error(`${alignment.captureId}: ${record.capturePosition} profile missing`);
    const original = { ...serialized, contentHash: BigInt(serialized.contentHash) } as RustExerciseProfileData;
    const changedWithoutHash = {
      ...original,
      identity: `${original.identity}/barbell-axis-primary-client-v1`,
      stateMachineId: "barbell-axis-primary-ready-effort-return/v1" as const,
    };
    const profile: RustExerciseProfileData = {
      ...changedWithoutHash,
      contentHash: computeRustExerciseProfileHash(changedWithoutHash),
    };
    const wasm = await instantiateRustMotionWasm(wasmBytes);
    const motion = new RustCanonicalWasmSession({
      sequenceId: `barbell-pose-client-replay:${alignment.captureId}`,
      schema: "halpe26",
      image: {
        widthPx: pose.source.widthPx,
        heightPx: pose.source.heightPx,
        rotationDegrees: 0,
        mirrored: false,
      },
      stabilization: "fusion",
      setLifecycleMode: "preview",
    }, wasm);
    const installed = motion.installExerciseProfileData(profile);
    motion.beginSet();
    const poseByFrame = new Map(pose.frames.map((frame) => [frame.frameNumber, frame]));
    const sealed = new Map<string, typeof motion.lastCompletedReps[number]>();
    const frames = [];
    let emptyCandidateFrames = 0;
    let maximumInferenceMs = 0;
    for (const alignmentFrame of alignment.frames) {
      const poseFrame = poseByFrame.get(alignmentFrame.frameNumber);
      const candidates = poseFrame?.selectedBbox && poseFrame.landmarks.length === 26
        ? [toCandidate(alignment.captureId, poseFrame)]
        : [];
      if (!candidates.length) emptyCandidateFrames += 1;
      const equipment = toEquipment(alignmentFrame.axis);
      const canonical = motion.processCandidates(candidates, alignmentFrame.timestampMs, equipment);
      maximumInferenceMs = Math.max(maximumInferenceMs, motion.lastTiming.coreMs + motion.lastTiming.decodeMs);
      const packet = motion.lastDecodedPacket;
      frames.push({
        timestampMs: alignmentFrame.timestampMs,
        frameValid: motion.lastFrameValid,
        canonicalQuality: canonical.overallQuality,
        rustCanonical: canonical.landmarks.map((landmark, index) => ({
          index,
          x: landmark.x,
          y: landmark.y,
          confidence: landmark.canonicalConfidence,
          source: landmark.source,
          renderable: landmark.renderable,
        })),
        rustJointAngles: packet?.jointAngles.map((angle) => ({
          kind: angle.kind,
          side: angle.side,
          valueDeg: angle.valueDeg,
          confidence: angle.confidence,
          source: angle.source,
          judgeable: angle.judgeable,
        })) ?? [],
        rustEquipment: packet?.equipment ?? null,
      });
      for (const rep of motion.lastCompletedReps) sealed.set(rep.repId.toString(), rep);
    }
    motion.finishSet();
    const reps = [...sealed.values()].map((rep) => ({
      repId: rep.repId,
      startMs: rep.startTimestampMs,
      peakMs: rep.peakTimestampMs,
      endMs: rep.endTimestampMs,
      disposition: rep.disposition,
      evidenceReason: rep.evidenceReason,
      observationFindings: rep.observationFindings,
      canonicalSliceHash: rep.canonicalSliceHash,
    }));
    const runtime = {
      processedFrames: frames.length,
      effectiveObservationFps: 10,
      emptyCandidateFrames,
      maximumInferenceMs,
    };
    const caseResult = {
      captureId: alignment.captureId,
      preset: { exerciseId: record.exerciseId, capturePosition: record.capturePosition },
      profileIdentity: installed.identity,
      runtime,
      reps,
      frames,
    };
    cases.push({
      ...caseResult,
      executionAssessment: buildClientExecutionAssessment(caseResult),
    });
    motion.close();
  }
  const semantic = {
    schemaVersion: "maxpower-client-barbell-pose-rust-single-pass/v1",
    generatedAt: new Date().toISOString(),
    runtime: {
      pythonVisionUsed: false,
      decisionRuntime: "rust-motion-sdk-wasm",
      upstreamObservationsFrozen: true,
    },
    lineage: {
      pose: "frozen-yolox-nano-humanart+rtmpose-m-halpe26-observations",
      equipment: "frozen-causal-horizontal-shaft-observations",
      decisionRuntime: "rust-motion-sdk-wasm",
      pythonVisionUsedAtDecisionRuntime: false,
      truthAvailableAtInference: false,
      chronologicalSinglePass: true,
      stateMachineId: "barbell-axis-primary-ready-effort-return/v1",
    },
    cases,
  };
  const output = {
    ...semantic,
    predictionSha256: createHash("sha256").update(JSON.stringify(semantic, bigintReplacer)).digest("hex"),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, bigintReplacer, 2)}\n`, "utf8");
  process.stdout.write(`${outputPath}\n`);
  for (const testCase of cases) {
    process.stdout.write(`${testCase.captureId}\t${testCase.reps.length} reps\n`);
  }
}

function toCandidate(captureId: string, frame: PoseFrame): PoseCandidateEstimate {
  return {
    timestampMs: frame.timestampMs,
    candidateId: stableCandidateId(captureId),
    bbox: frame.selectedBbox!,
    torsoColor: [0, 0, 0],
    landmarks: frame.landmarks.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z ?? 0,
      visibility: landmark.visibility,
    })),
    worldLandmarks: [],
  };
}

function toEquipment(axis: AxisRecord | null): RustEquipmentObservation[] {
  if (!axis || axis.source !== "measured") return [];
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

function stableCandidateId(captureId: string): number {
  return createHash("sha256").update(captureId).digest().readUInt32LE(0);
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readGzipJson<T>(path: string): Promise<T> {
  return JSON.parse(gunzipSync(await readFile(path)).toString("utf8")) as T;
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
