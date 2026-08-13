import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { DecodedRustQualityProposal } from "../../src/motion/motionPacket";

export interface TimestampedFrame {
  readonly timestampMs: number;
}

export interface ExactContextWindow {
  readonly captureId: string;
  readonly startMs: number;
  readonly endMs: number;
}

export function routeSourceFramesOnce<T extends TimestampedFrame>(
  frames: readonly T[],
  windows: readonly ExactContextWindow[],
): readonly Readonly<{ frame: T; captureId: string }>[] {
  const sortedWindows = [...windows].sort((left, right) => left.startMs - right.startMs);
  for (let index = 0; index < sortedWindows.length; index += 1) {
    const window = sortedWindows[index]!;
    if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)
        || window.startMs < 0 || window.endMs < window.startMs) {
      throw new Error(`${window.captureId}: invalid exact-context window`);
    }
    const previous = sortedWindows[index - 1];
    if (previous && window.startMs < previous.endMs) {
      throw new Error(`${previous.captureId}/${window.captureId}: overlapping exact-context windows`);
    }
  }
  let previousTimestamp = -1;
  const routed: Array<Readonly<{ frame: T; captureId: string }>> = [];
  for (const frame of frames) {
    if (!Number.isFinite(frame.timestampMs) || frame.timestampMs < 0
        || frame.timestampMs <= previousTimestamp) {
      throw new Error("source frames must use strictly increasing timestamps");
    }
    previousTimestamp = frame.timestampMs;
    const matches = sortedWindows.filter((window, index) => (
      frame.timestampMs >= window.startMs
      && (index === sortedWindows.length - 1
        ? frame.timestampMs <= window.endMs
        : frame.timestampMs < window.endMs)
    ));
    if (matches.length > 1) throw new Error("overlapping exact-context windows routed one frame twice");
    if (matches[0]) routed.push(Object.freeze({ frame, captureId: matches[0].captureId }));
  }
  return Object.freeze(routed);
}

export function anatomicalSideForContext(
  actionId: string,
  capturePosition: string,
): "left" | "right" | null {
  if (actionId !== "single_arm_cable_lateral_raise") return null;
  if (capturePosition === "frontLeft45") return "left";
  if (capturePosition === "rearRight45") return "right";
  return null;
}

interface ReviewProposalInput {
  readonly captureId: string;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly anatomicalSide: "left" | "right" | null;
  readonly sourceCaptureId: string;
  readonly videoRef: string | null;
  readonly profileIdentity: string;
  readonly profileHash: string;
  readonly rustProposals: readonly Readonly<Record<string, unknown>>[];
}

export interface FrozenReviewProposal {
  readonly schemaVersion: "maxpower.motion-quality-proposal/v1";
  readonly proposalHash: string;
  readonly lineage: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly reps: readonly Readonly<{
    repId: string;
    rustProposalId: string;
    rustContentHash: string;
    endpoints: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    conclusions: readonly Readonly<Record<string, unknown>>[];
  }>[];
}

export function buildReviewProposal(input: ReviewProposalInput): Readonly<FrozenReviewProposal> {
  const reps = input.rustProposals.map((raw, index) => {
    const proposal = requireRecord(raw, `Rust proposal ${index}`);
    const endpoints = requireArray(proposal.endpoints, `Rust proposal ${index} endpoints`);
    const endpointMap: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const endpointRaw of endpoints) {
      const endpoint = requireRecord(endpointRaw, "Rust endpoint");
      const kind = requireString(endpoint.kind, "Rust endpoint kind");
      if (endpointMap[kind]) throw new Error(`duplicate Rust endpoint ${kind}`);
      endpointMap[kind] = cloneJson(endpoint);
    }
    const expected = ["start_anchor", "primary_turnaround", "end_return"];
    if (expected.some((kind) => !endpointMap[kind]) || Object.keys(endpointMap).length !== 3) {
      throw new Error("Rust proposal must contain exactly three canonical endpoints");
    }
    const orderedEndpoints = Object.fromEntries(expected.map((kind) => [kind, endpointMap[kind]!])) as
      Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    const conclusions = requireArray(proposal.conclusions, "Rust conclusions")
      .map((conclusion) => cloneJson(requireRecord(conclusion, "Rust conclusion")));
    if (conclusions.length !== 8) throw new Error("Rust proposal must contain eight dimensions");
    return {
      repId: `${input.captureId}:${String(proposal.repId)}`,
      rustProposalId: requireString(proposal.proposalId, "Rust proposal id"),
      rustContentHash: requireString(proposal.contentHash, "Rust content hash"),
      endpoints: orderedEndpoints,
      conclusions,
    };
  });
  const semantic = {
    schemaVersion: "maxpower.motion-quality-proposal/v1" as const,
    lineage: {
      schemaVersion: "maxpower-motion-quality-review-proposal/v1",
      runKind: "full_data_proposal",
      producer: "rust_motion_sdk_motn_1_8_qlt1",
      visualInput: "client_deployable_yolox_rtmpose_halpe26_canonical_observations",
      profileIdentity: input.profileIdentity,
      profileHash: input.profileHash,
      prohibitedClaims: ["force", "strength", "muscle_activation", "joint_torque", "medical_diagnosis"],
      automaticTraining: false,
      productionPromotion: false,
    },
    context: {
      captureId: input.captureId,
      sourceCaptureId: input.sourceCaptureId,
      actionId: input.actionId,
      capturePosition: input.capturePosition,
      anatomicalSide: input.anatomicalSide,
      videoRef: input.videoRef,
    },
    reps,
  };
  return deepFreeze({
    proposalHash: sha256(stableStringify(semantic)),
    ...semantic,
  });
}

interface GoldenRecord {
  readonly captureId: string;
  readonly sourceCaptureId?: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly evaluationWindow?: Readonly<{ startMs: number; endMs: number }>;
  readonly source?: Readonly<{ keypoints?: string; video?: string; durationMs?: number }>;
}

interface GoldenDataset {
  readonly schemaVersion?: string;
  readonly records: readonly GoldenRecord[];
}

interface CanonicalLandmark {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
  readonly visibility: number | null;
}

interface CanonicalPose extends TimestampedFrame {
  readonly landmarks: readonly CanonicalLandmark[];
}

interface CanonicalCapture {
  readonly sourceCaptureId: string;
  readonly sourcePoseSha256?: string;
  readonly sourceVideoSha256?: string;
  readonly image?: Readonly<{
    widthPx?: number;
    heightPx?: number;
    mirrored?: boolean;
  }>;
  readonly poses: readonly CanonicalPose[];
}

interface CanonicalCorpus {
  readonly schemaVersion: string;
  readonly inputPipeline?: string;
  readonly rustWasmSha256?: string;
  readonly captures: Readonly<Record<string, CanonicalCapture>>;
}

interface SerializedProfile extends Omit<RustExerciseProfileData, "contentHash"> {
  readonly contentHash: string | number;
}

interface ProfileEntry {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly profile: SerializedProfile;
}

interface ProfileArtifact {
  readonly schemaVersion: string;
  readonly profiles: readonly ProfileEntry[];
}

export interface FullDataProposalRunnerOptions {
  readonly datasetPath: string;
  readonly canonicalCorpusPath: string;
  readonly profileArtifactPath: string;
  readonly wasmPath: string;
  readonly outputPath: string;
  readonly runId: string;
}

export async function runFullDataProposal(
  rawOptions: FullDataProposalRunnerOptions,
): Promise<Readonly<Record<string, unknown>>> {
  const options = Object.fromEntries(Object.entries(rawOptions).map(([key, value]) => [
    key,
    key === "runId" ? value : resolve(value),
  ])) as unknown as FullDataProposalRunnerOptions;
  const [datasetBytes, corpusBytes, profileBytes, wasmBytes] = await Promise.all([
    readFile(options.datasetPath),
    readFile(options.canonicalCorpusPath),
    readFile(options.profileArtifactPath),
    readFile(options.wasmPath),
  ]);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as GoldenDataset;
  const corpus = JSON.parse(corpusBytes.toString("utf8")) as CanonicalCorpus;
  const profiles = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const recordsBySource = new Map<string, GoldenRecord[]>();
  for (const record of dataset.records) {
    const sourceId = record.sourceCaptureId ?? record.captureId;
    const records = recordsBySource.get(sourceId) ?? [];
    records.push(record);
    recordsBySource.set(sourceId, records);
  }
  const captureBySource = new Map(
    Object.values(corpus.captures).map((capture) => [capture.sourceCaptureId, capture]),
  );
  const sources: Array<Readonly<Record<string, unknown>>> = [];
  let submittedFrameCount = 0;
  for (const [sourceCaptureId, records] of [...recordsBySource].sort(([left], [right]) => left.localeCompare(right))) {
    const capture = captureBySource.get(sourceCaptureId);
    if (!capture) throw new Error(`${sourceCaptureId}: canonical Halpe-26 capture missing`);
    const windows = records.map((record) => ({
      captureId: record.captureId,
      startMs: record.evaluationWindow?.startMs ?? 0,
      endMs: record.evaluationWindow?.endMs
        ?? record.source?.durationMs
        ?? capture.poses.at(-1)?.timestampMs
        ?? 0,
    }));
    const routed = routeSourceFramesOnce(capture.poses, windows);
    submittedFrameCount += routed.length;
    const framesByContext = new Map<string, CanonicalPose[]>();
    for (const entry of routed) {
      const frames = framesByContext.get(entry.captureId) ?? [];
      frames.push(entry.frame);
      framesByContext.set(entry.captureId, frames);
    }
    const contexts: Array<Readonly<Record<string, unknown>>> = [];
    for (const record of records.sort((left, right) => (
      (left.evaluationWindow?.startMs ?? 0) - (right.evaluationWindow?.startMs ?? 0)
    ))) {
      const profileEntry = profiles.profiles.find((candidate) => (
        candidate.exerciseId === record.exerciseId
        && candidate.capturePosition === record.capturePosition
      ));
      if (!profileEntry) throw new Error(`${record.captureId}: full-data profile missing`);
      const side = anatomicalSideForContext(record.exerciseId, record.capturePosition);
      const profile = materializeProfile(profileEntry.profile, side);
      const wasm = await instantiateRustMotionWasm(wasmBytes);
      const motion = new RustCanonicalWasmSession({
        sequenceId: `${options.runId}:${record.captureId}`,
        schema: "halpe26",
        image: {
          widthPx: capture.image?.widthPx ?? 1280,
          heightPx: capture.image?.heightPx ?? 720,
          mirrored: capture.image?.mirrored ?? false,
          rotationDegrees: 0,
        },
        stabilization: "fusion",
        setLifecycleMode: "preview",
      }, wasm);
      const installed = motion.installExerciseProfileData(profile);
      motion.beginSet();
      const reps = new Map<string, (typeof motion.lastCompletedReps)[number]>();
      const rustProposals = new Map<string, Readonly<DecodedRustQualityProposal>>();
      const sourceTimestampsMs: number[] = [];
      const collect = (): void => {
        for (const rep of motion.lastCompletedReps) reps.set(rep.repId.toString(), rep);
        for (const proposal of motion.lastQualityProposals) {
          rustProposals.set(proposal.proposalId, proposal);
        }
      };
      for (const frame of framesByContext.get(record.captureId) ?? []) {
        sourceTimestampsMs.push(frame.timestampMs);
        motion.process({
          timestampMs: frame.timestampMs,
          landmarks: frame.landmarks.map((landmark) => ({
            x: finiteOrZero(landmark.x),
            y: finiteOrZero(landmark.y),
            z: finiteOrZero(landmark.z),
            visibility: finiteOrZero(landmark.visibility),
          })),
          worldLandmarks: [],
        });
        collect();
      }
      motion.finishSet();
      collect();
      const profileHash = installed.contentHash.toString(16).padStart(16, "0");
      const reviewProposal = buildReviewProposal({
        captureId: record.captureId,
        actionId: record.exerciseId,
        capturePosition: record.capturePosition,
        anatomicalSide: side,
        sourceCaptureId,
        videoRef: record.source?.video ?? null,
        profileIdentity: installed.identity,
        profileHash,
        rustProposals: [...rustProposals.values()] as unknown as readonly Readonly<Record<string, unknown>>[],
      });
      contexts.push(deepFreeze({
        captureId: record.captureId,
        actionId: record.exerciseId,
        capturePosition: record.capturePosition,
        anatomicalSide: side,
        processing: {
          chronologicalMonotonic: true,
          singlePass: true,
          submittedFrameCount: sourceTimestampsMs.length,
          firstTimestampMs: sourceTimestampsMs[0] ?? null,
          lastTimestampMs: sourceTimestampsMs.at(-1) ?? null,
        },
        installedProfile: { identity: installed.identity, contentHash: profileHash },
        packetSchema: "MOTN/1.8+QLT1",
        canonicalPacketHash: motion.lastCanonicalHash.toString(16).padStart(16, "0"),
        reps: [...reps.values()].map((rep) => ({
          repId: rep.repId.toString(),
          startFrameId: rep.startFrameId.toString(),
          startTimestampMs: Number(rep.startTimestampMs),
          turnaroundFrameId: rep.peakFrameId.toString(),
          turnaroundTimestampMs: Number(rep.peakTimestampMs),
          endFrameId: rep.endFrameId.toString(),
          endTimestampMs: Number(rep.endTimestampMs),
          disposition: rep.disposition,
          evidenceReason: rep.evidenceReason,
          observationFindings: rep.observationFindings,
        })),
        qualityProposals: [...rustProposals.values()],
        reviewProposal,
      }));
      motion.close();
    }
    sources.push(deepFreeze({
      sourceCaptureId,
      sourcePoseSha256: capture.sourcePoseSha256 ?? null,
      sourceVideoSha256: capture.sourceVideoSha256 ?? null,
      videoRef: records[0]?.source?.video ?? null,
      sourceFrameCount: capture.poses.length,
      submittedFrameCount: routed.length,
      contexts,
    }));
  }
  const semantic = {
    schemaVersion: "maxpower-motion-quality-rust-full-data-proposals/v1",
    runId: options.runId,
    runKind: "full_data_proposal",
    frozen: true,
    acceptanceEligible: false,
    accuracyClaim: "forbidden_full_data_proposal_is_review_queue_only",
    runtime: {
      visualModel: "YOLOX + RTMPose Halpe-26 client-deployable observation contract",
      actionAuthority: "Rust Motion SDK",
      packetSchema: "MOTN/1.8+QLT1",
      pythonVisionUsed: false,
      repeatedVideoInterpretation: false,
      automaticTraining: false,
      profileMutation: false,
      productionPromotion: false,
    },
    inventory: {
      uniqueSourceCount: recordsBySource.size,
      exactContextCount: dataset.records.length,
      sourceFrameCount: Object.values(corpus.captures).reduce(
        (sum, capture) => sum + capture.poses.length,
        0,
      ),
      submittedFrameCount,
    },
    reproducibility: {
      datasetSha256: sha256(datasetBytes),
      canonicalCorpusSha256: sha256(corpusBytes),
      profileArtifactSha256: sha256(profileBytes),
      rustWasmSha256: sha256(wasmBytes),
      canonicalCorpusDeclaredRustWasmSha256: corpus.rustWasmSha256 ?? null,
      canonicalInputPipeline: corpus.inputPipeline ?? null,
      canonicalSchemaVersion: corpus.schemaVersion,
      profileSchemaVersion: profiles.schemaVersion,
    },
    limitations: [
      "This full-data proposal may use profiles fitted with the same sources and is not blind accuracy evidence.",
      "The canonical corpus is client-deployable Halpe-26 observation replay, not a repeated Python visual model.",
      "Equipment tracks are present only when supplied by the frozen client observation stream.",
      "No physiological force, strength, muscle activation, joint-torque or medical conclusion is measured.",
    ],
    sources,
  };
  const output = deepFreeze({
    ...semantic,
    frozenDigest: sha256(stableStringify(semantic)),
  });
  await writeFile(options.outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

function materializeProfile(
  serialized: SerializedProfile,
  side: "left" | "right" | null,
): RustExerciseProfileData {
  const original = {
    ...serialized,
    contentHash: BigInt(serialized.contentHash),
  } as RustExerciseProfileData;
  if (!side) return original;
  const identity = original.identity.replace("/bilateral/", `/${side}/`);
  const withoutHash = { ...original, identity };
  return { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
}

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function requireRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a string`);
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (
      left.localeCompare(right)
    )).map(([key, entry]) => [key, sortJson(entry)]));
  }
  return value;
}

function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

async function main(): Promise<void> {
  const projectRoot = resolve(process.cwd());
  const outputPath = process.argv[2] ?? "data/workflows/motion-quality-review/full-data-proposals-v1.json";
  await runFullDataProposal({
    datasetPath: "data/training/personal-golden-segmentation-v2.json",
    canonicalCorpusPath: "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/corpus/personal-rust-canonical-v2.json",
    profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
    wasmPath: "public/motion-sdk/maxpower_motion_sdk.wasm",
    outputPath,
    runId: "personal-full-data-proposal-rust-qlt1-v1",
  });
  process.stdout.write(`${resolve(projectRoot, outputPath)}\n`);
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
