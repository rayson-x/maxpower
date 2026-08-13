import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
} from "../../src/motion/rustCanonicalWasm.js";
import type { PoseEstimate } from "../../src/pose/PoseEngine.js";

interface DatasetRecord {
  readonly captureId: string;
  readonly sourceCaptureId?: string;
  readonly source: { readonly keypoints: string };
}

interface Dataset {
  readonly records: readonly DatasetRecord[];
}

interface PoseFixture {
  readonly model?: string;
  readonly poses: readonly (PoseEstimate & {
    readonly image?: {
      readonly widthPx: number;
      readonly heightPx: number;
      readonly mirrored?: boolean;
      readonly rotationDegrees?: 0 | 90 | 180 | 270;
    };
  })[];
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

async function main(): Promise<void> {
  const datasetPath = resolve(option(process.argv.slice(2), "--dataset"));
  const archiveRoot = resolve(option(process.argv.slice(2), "--archive"));
  const wasmPath = resolve(option(process.argv.slice(2), "--wasm"));
  const outputPath = resolve(option(process.argv.slice(2), "--output"));
  const datasetBytes = await readFile(datasetPath);
  const wasmBytes = await readFile(wasmPath);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as Dataset;
  const sourceIds = new Map<string, string>();
  for (const record of dataset.records) {
    sourceIds.set(record.source.keypoints, record.sourceCaptureId ?? record.captureId);
  }

  const captures: Record<string, unknown> = {};
  for (const [keypoints, sourceCaptureId] of [...sourceIds].sort(([left], [right]) => left.localeCompare(right))) {
    const fixtureBytes = await readFile(join(archiveRoot, keypoints));
    const fixture = (JSON.parse(fixtureBytes.toString("utf8")) as readonly PoseFixture[])[0];
    if (!fixture?.poses.length) throw new Error(`pose fixture is empty: ${keypoints}`);
    const image = fixture.poses.find((pose) => pose.image)?.image ?? {
      widthPx: 1280,
      heightPx: 720,
      mirrored: false,
      rotationDegrees: 0 as const,
    };
    const wasm = await instantiateRustMotionWasm(wasmBytes);
    const session = new RustCanonicalWasmSession({
      sequenceId: `personal-temporal:${sourceCaptureId}`,
      schema: "blazepose33",
      image: {
        widthPx: image.widthPx,
        heightPx: image.heightPx,
        mirrored: image.mirrored ?? false,
        rotationDegrees: image.rotationDegrees ?? 0,
      },
      stabilization: "fusion",
      setLifecycleMode: "replay",
    }, wasm);
    try {
      captures[keypoints] = {
        sourceCaptureId,
        sourcePoseSha256: sha256(fixtureBytes),
        sourcePoseModel: fixture.model ?? "unknown",
        image,
        poses: fixture.poses.map((pose) => {
          const canonical = session.process(pose);
          return {
            timestampMs: canonical.timestampMs,
            landmarks: canonical.landmarks.map((landmark) => ({
              x: Number.isFinite(landmark.x) ? landmark.x : null,
              y: Number.isFinite(landmark.y) ? landmark.y : null,
              z: Number.isFinite(landmark.z) ? landmark.z : null,
              visibility: landmark.canonicalConfidence,
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

  const artifact = {
    schemaVersion: "maxpower-personal-rust-canonical-sequences/v1",
    dataset: datasetPath,
    datasetSha256: sha256(datasetBytes),
    rustWasm: wasmPath,
    rustWasmSha256: sha256(wasmBytes),
    stabilization: "fusion",
    sourceCaptureCount: sourceIds.size,
    captures,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    sourceCaptureCount: sourceIds.size,
    rustWasmSha256: artifact.rustWasmSha256,
  }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
