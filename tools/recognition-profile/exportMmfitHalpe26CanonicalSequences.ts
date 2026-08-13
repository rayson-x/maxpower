import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
} from "../../src/motion/rustCanonicalWasm.js";
import type { PoseLandmark } from "../../src/pose/PoseEngine.js";

export interface MmfitManifestClip {
  readonly clipFile: string;
  readonly sourceSequenceId: string;
  readonly subjectId: string;
  readonly split: string;
  readonly sourceAction: string;
  readonly exerciseId: string;
  readonly expectedCount: number;
  readonly clipSha256: string;
}

export interface MmfitManifest {
  readonly complete: boolean;
  readonly requestedSplits: readonly string[];
  readonly poseDomain: string;
  readonly pipeline: string;
  readonly detectorModelSha256: string;
  readonly poseModelSha256: string;
  readonly clips: readonly MmfitManifestClip[];
}

interface RawLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number | null;
  readonly visibility: number;
}

interface RawFrame {
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly landmarks: readonly RawLandmark[];
}

interface MmfitClip {
  readonly sourceSequenceId: string;
  readonly exerciseId: string;
  readonly split: string;
  readonly poseSchema: string;
  readonly missingPointPolicy: string;
  readonly observation: {
    readonly pipeline: string;
    readonly sourceVideo: {
      readonly widthPx: number;
      readonly heightPx: number;
      readonly mirrored: boolean;
      readonly sourceVideoSha256: string;
    };
  };
  readonly label: {
    readonly annotationGranularity: string;
    readonly startFrame: number;
    readonly endFrame: number;
    readonly totalRepetitions: number;
    readonly repBounds: readonly unknown[];
  };
  readonly repBounds: readonly unknown[];
  readonly techniqueQuality: string;
  readonly compensation: string;
  readonly frames: readonly RawFrame[];
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

export function validateTrainOnlyManifest(manifest: MmfitManifest): void {
  if (manifest.complete !== true) throw new Error("MM-Fit RTMPose manifest is incomplete");
  if (manifest.requestedSplits.length !== 1 || manifest.requestedSplits[0] !== "train") {
    throw new Error(`MM-Fit canonical export must be train-only: ${manifest.requestedSplits.join(",")}`);
  }
  const leaked = manifest.clips.filter((clip) => clip.split !== "train");
  if (leaked.length) {
    throw new Error(`MM-Fit canonical export refuses non-train clips: ${leaked.map((clip) => `${clip.sourceSequenceId}:${clip.split}`).join(",")}`);
  }
  const identities = new Set<string>();
  for (const clip of manifest.clips) {
    if (identities.has(clip.sourceSequenceId)) {
      throw new Error(`MM-Fit canonical manifest has duplicate sequence: ${clip.sourceSequenceId}`);
    }
    identities.add(clip.sourceSequenceId);
  }
}

export function validateSetCountOnlyClip(item: MmfitManifestClip, clip: MmfitClip): void {
  if (
    clip.sourceSequenceId !== item.sourceSequenceId
    || clip.exerciseId !== item.exerciseId
    || clip.split !== "train"
    || clip.poseSchema !== "halpe26"
  ) {
    throw new Error(`MM-Fit Halpe-26 clip identity mismatch: ${item.sourceSequenceId}`);
  }
  if (
    clip.label.annotationGranularity !== "set_count"
    || clip.label.totalRepetitions !== item.expectedCount
    || !Number.isInteger(clip.label.startFrame)
    || !Number.isInteger(clip.label.endFrame)
    || clip.label.endFrame < clip.label.startFrame
    || clip.label.repBounds.length !== 0
    || clip.repBounds.length !== 0
  ) {
    throw new Error(`MM-Fit clip may provide set count only: ${item.sourceSequenceId}`);
  }
  if (clip.techniqueQuality !== "unknown" || clip.compensation !== "unknown") {
    throw new Error(`MM-Fit clip cannot provide technique truth: ${item.sourceSequenceId}`);
  }
}

/**
 * Rust needs the declared schema width even when the detector has no subject.
 * Zero confidence is the unknown-point sentinel; these coordinates are never
 * marked measured, renderable, usable, or eligible as training observations.
 */
export function rawHalpe26Landmarks(frame: RawFrame): PoseLandmark[] {
  if (frame.landmarks.length === 0) {
    return Array.from({ length: 26 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  }
  if (frame.landmarks.length !== 26) {
    throw new Error(`RTMPose frame must contain zero or 26 Halpe landmarks: ${frame.landmarks.length}`);
  }
  return frame.landmarks.map((landmark) => ({
    x: finite(landmark.x),
    y: finite(landmark.y),
    z: finite(landmark.z),
    visibility: finite(landmark.visibility),
  }));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inputRoot = resolve(option(argv, "--input"));
  const manifestPath = resolve(inputRoot, "manifest.json");
  const wasmPath = resolve(option(argv, "--wasm"));
  const outputPath = resolve(option(argv, "--output"));
  const sequenceOption = argv.indexOf("--sequences");
  const requestedSequences = sequenceOption >= 0
    ? new Set(argv.slice(sequenceOption + 1).filter((value) => !value.startsWith("--")))
    : null;
  const [manifestBytes, wasmBytes] = await Promise.all([
    readFile(manifestPath),
    readFile(wasmPath),
  ]);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as MmfitManifest;
  validateTrainOnlyManifest(manifest);
  const selected = requestedSequences
    ? manifest.clips.filter((clip) => requestedSequences.has(clip.sourceSequenceId))
    : manifest.clips;
  if (requestedSequences && selected.length !== requestedSequences.size) {
    const found = new Set(selected.map((clip) => clip.sourceSequenceId));
    throw new Error(`Unknown MM-Fit train sequences: ${[...requestedSequences].filter((id) => !found.has(id)).join(",")}`);
  }

  const clips: Record<string, unknown> = {};
  for (const [index, item] of selected.entries()) {
    const compressed = await readFile(resolve(inputRoot, item.clipFile));
    if (sha256(compressed) !== item.clipSha256) {
      throw new Error(`MM-Fit RTMPose clip SHA-256 mismatch: ${item.sourceSequenceId}`);
    }
    const clip = JSON.parse(gunzipSync(compressed).toString("utf8")) as MmfitClip;
    validateSetCountOnlyClip(item, clip);
    const wasm = await instantiateRustMotionWasm(wasmBytes);
    const session = new RustCanonicalWasmSession({
      sequenceId: `mmfit-halpe26:${item.sourceSequenceId}`,
      schema: "halpe26",
      image: {
        widthPx: clip.observation.sourceVideo.widthPx,
        heightPx: clip.observation.sourceVideo.heightPx,
        mirrored: clip.observation.sourceVideo.mirrored,
        rotationDegrees: 0,
      },
      // Training observations must stay measured/unknown. Fusion prediction is
      // a runtime presentation aid and is never converted into source truth.
      stabilization: "raw",
      setLifecycleMode: "replay",
    }, wasm);
    try {
      clips[item.sourceSequenceId] = {
        sourceSequenceId: item.sourceSequenceId,
        subjectId: item.subjectId,
        split: "train",
        sourceAction: item.sourceAction,
        exerciseId: item.exerciseId,
        expectedCount: item.expectedCount,
        annotationGranularity: "set_count",
        setBounds: {
          startFrame: clip.label.startFrame,
          endFrame: clip.label.endFrame,
        },
        repBounds: [],
        techniqueQuality: "unknown",
        compensation: "unknown",
        sourcePoseSha256: item.clipSha256,
        sourceVideoSha256: clip.observation.sourceVideo.sourceVideoSha256,
        sourcePoseModel: clip.observation.pipeline,
        poseSchema: "halpe26",
        poses: clip.frames.map((frame) => {
          const canonical = session.process({
            timestampMs: frame.timestampMs,
            landmarks: rawHalpe26Landmarks(frame),
            worldLandmarks: [],
          });
          return {
            frameNumber: frame.frameNumber,
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
              trainingObservationEligible: landmark.source === "measured" && landmark.usable,
            })),
          };
        }),
      };
    } finally {
      session.close();
    }
    if ((index + 1) % 25 === 0 || index + 1 === selected.length) {
      process.stderr.write(`${JSON.stringify({ processed: index + 1, total: selected.length })}\n`);
    }
  }

  const artifact = {
    schemaVersion: "maxpower-mmfit-rust-canonical-sequences/v1",
    researchOnly: true,
    productionPromotion: false,
    datasetId: "mm-fit",
    requestedSplits: ["train"],
    usesExpectedCountAtInference: false,
    labelContract: "set_count_only_no_rep_phase_no_technique_truth",
    datasetManifest: manifestPath,
    datasetManifestSha256: sha256(manifestBytes),
    rustWasm: wasmPath,
    rustWasmSha256: sha256(wasmBytes),
    inputPoseSchema: "halpe26",
    inputPoseDomain: manifest.poseDomain,
    inputPipeline: manifest.pipeline,
    detectorModelSha256: manifest.detectorModelSha256,
    poseModelSha256: manifest.poseModelSha256,
    stabilization: "raw",
    missingPointPolicy: "unknown; never synthesize training truth",
    sourceSequenceCount: selected.length,
    sourceSequenceIds: selected.map((clip) => clip.sourceSequenceId).sort(),
    clips,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    output: outputPath,
    sourceSequenceCount: selected.length,
    datasetManifestSha256: artifact.datasetManifestSha256,
    rustWasmSha256: artifact.rustWasmSha256,
  }, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
