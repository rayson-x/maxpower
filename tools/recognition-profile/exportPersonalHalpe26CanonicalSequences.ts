import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
} from "../../src/motion/rustCanonicalWasm.js";
import type { PoseLandmark } from "../../src/pose/PoseEngine.js";

interface DatasetRecord {
  readonly captureId: string;
  readonly sourceCaptureId: string;
  readonly source: { readonly keypoints: string };
}

interface Dataset {
  readonly records: readonly DatasetRecord[];
}

interface SidecarLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number | null;
  readonly visibility: number;
}

interface SidecarFrame {
  readonly timestampMs: number;
  readonly landmarks: readonly SidecarLandmark[];
}

interface HalpeSidecar {
  readonly captureId: string;
  readonly poseSchema: "halpe26";
  readonly source: {
    readonly sha256: string;
    readonly widthPx: number;
    readonly heightPx: number;
  };
  readonly inference: { readonly pipeline: string };
  readonly frames: readonly SidecarFrame[];
}

function option(argv: readonly string[], name: string): string {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function finite(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function poseLandmarks(frame: SidecarFrame): PoseLandmark[] {
  if (frame.landmarks.length === 26) {
    return frame.landmarks.map((landmark) => ({
      x: finite(landmark.x),
      y: finite(landmark.y),
      z: finite(landmark.z),
      visibility: finite(landmark.visibility),
    }));
  }
  return Array.from({ length: 26 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const datasetPath = resolve(option(argv, "--dataset"));
  const sidecarRoot = resolve(option(argv, "--sidecars"));
  const wasmPath = resolve(option(argv, "--wasm"));
  const outputPath = resolve(option(argv, "--output"));
  const [datasetBytes, wasmBytes] = await Promise.all([
    readFile(datasetPath),
    readFile(wasmPath),
  ]);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as Dataset;
  const sourceRecords = new Map<string, DatasetRecord>();
  for (const record of dataset.records) {
    sourceRecords.set(record.sourceCaptureId, record);
  }

  const captures: Record<string, unknown> = {};
  const inputPipelines = new Set<string>();
  for (const [sourceCaptureId, record] of [...sourceRecords].sort(([left], [right]) => left.localeCompare(right))) {
    const sidecarPath = resolve(sidecarRoot, `${sourceCaptureId}.halpe26.json.gz`);
    const compressed = await readFile(sidecarPath);
    const sidecar = JSON.parse(gunzipSync(compressed).toString("utf8")) as HalpeSidecar;
    if (sidecar.captureId !== sourceCaptureId || sidecar.poseSchema !== "halpe26") {
      throw new Error(`Halpe sidecar identity mismatch: ${sidecarPath}`);
    }
    inputPipelines.add(sidecar.inference.pipeline);
    const wasm = await instantiateRustMotionWasm(wasmBytes);
    const session = new RustCanonicalWasmSession({
      sequenceId: `personal-halpe26:${sourceCaptureId}`,
      schema: "halpe26",
      image: {
        widthPx: sidecar.source.widthPx,
        heightPx: sidecar.source.heightPx,
        mirrored: false,
        rotationDegrees: 0,
      },
      stabilization: "fusion",
      setLifecycleMode: "replay",
    }, wasm);
    try {
      captures[record.source.keypoints] = {
        sourceCaptureId,
        sourcePoseSha256: sha256(compressed),
        sourceVideoSha256: sidecar.source.sha256,
        sourcePoseModel: sidecar.inference.pipeline,
        poseSchema: "halpe26",
        image: {
          widthPx: sidecar.source.widthPx,
          heightPx: sidecar.source.heightPx,
          mirrored: false,
          rotationDegrees: 0,
        },
        poses: sidecar.frames.map((frame) => {
          const input = poseLandmarks(frame);
          const canonical = session.process({
            timestampMs: frame.timestampMs,
            landmarks: input,
            worldLandmarks: [],
          });
          return {
            timestampMs: canonical.timestampMs,
            landmarks: canonical.landmarks.map((landmark) => ({
              x: Number.isFinite(landmark.x) ? landmark.x : null,
              y: Number.isFinite(landmark.y) ? landmark.y : null,
              z: Number.isFinite(landmark.z) ? landmark.z : null,
              visibility: landmark.canonicalConfidence,
              observationScore: landmark.observationScore,
              source: landmark.source,
              predicted: landmark.predicted,
              renderable: landmark.renderable,
              usable: landmark.usable,
            })),
          };
        }),
      };
    } finally {
      session.close();
    }
  }

  if (inputPipelines.size !== 1) {
    throw new Error(`Expected one input pipeline, found: ${[...inputPipelines].sort().join(", ")}`);
  }
  const [inputPipeline] = inputPipelines;

  const artifact = {
    schemaVersion: "maxpower-personal-rust-canonical-sequences/v2",
    dataset: datasetPath,
    datasetSha256: sha256(datasetBytes),
    rustWasm: wasmPath,
    rustWasmSha256: sha256(wasmBytes),
    inputPoseSchema: "halpe26",
    inputPipeline,
    stabilization: "fusion",
    sourceCaptureCount: sourceRecords.size,
    captures,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    sourceCaptureCount: sourceRecords.size,
    rustWasmSha256: artifact.rustWasmSha256,
  }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
