import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type {
  DecodedMotionPacket,
  DecodedRustQualityProposal,
} from "../../src/motion/motionPacket";
import {
  equipmentFramesByTimestamp,
  loadBenchEquipmentSidecar,
  loadInputCatalog,
  loadRawObservationSidecar,
  loadSourceIndependentBenchProfiles,
  measuredAxisToEquipmentObservation,
  pinInputBytes,
  rawFrameCandidates,
  sha256,
  submitRawFrameToRust,
  type BenchEquipmentFrame,
  type InputAssetPin,
  type RawObservationFrame,
} from "./runnerInputs";
import { ACTION_CONTRACT_CATALOG } from "./actionContractCatalog";

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
  readonly rawObservationRoot: string;
  readonly benchEquipmentObservationRoot: string;
  readonly profileArtifactPath: string;
  readonly sourceIndependentBenchProfilePath: string;
  readonly governanceInputCatalogPath: string;
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
  const catalogLoaded = await loadInputCatalog(options.governanceInputCatalogPath);
  const catalog = catalogLoaded.value;
  const [datasetBytes, profileBytes, wasmBytes, independentBench] = await Promise.all([
    readFile(options.datasetPath),
    readFile(options.profileArtifactPath),
    readFile(options.wasmPath),
    loadSourceIndependentBenchProfiles(options.sourceIndependentBenchProfilePath, catalog),
  ]);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as GoldenDataset;
  const profiles = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const recordsBySource = new Map<string, GoldenRecord[]>();
  for (const record of dataset.records) {
    const sourceId = record.sourceCaptureId ?? record.captureId;
    const records = recordsBySource.get(sourceId) ?? [];
    records.push(record);
    recordsBySource.set(sourceId, records);
  }
  const independentBenchByView = new Map(independentBench.value.map((entry) => [
    entry.capturePosition,
    entry,
  ]));
  const sources: Array<Readonly<Record<string, unknown>>> = [];
  const inputAssetPins: InputAssetPin[] = [
    catalogLoaded.pin,
    pinInputBytes(catalog, "humanRanges", options.datasetPath, datasetBytes),
    pinInputBytes(catalog, "profileArtifact", options.profileArtifactPath, profileBytes),
    pinInputBytes(catalog, "rustWasm", options.wasmPath, wasmBytes),
    independentBench.pin,
  ];
  let submittedFrameCount = 0;
  let sourceFrameCount = 0;
  let equipmentInputFrameCount = 0;
  let equipmentObservedFrameCount = 0;
  let equipmentMeasuredEndpointCount = 0;
  for (const [sourceCaptureId, records] of [...recordsBySource].sort(([left], [right]) => left.localeCompare(right))) {
    const raw = await loadRawObservationSidecar(options.rawObservationRoot, sourceCaptureId, catalog);
    inputAssetPins.push(raw.pin);
    sourceFrameCount += raw.value.frames.length;
    const benchRecords = records.filter((record) => record.exerciseId === "barbell_bench_press");
    const benchEquipment = benchRecords.length > 0
      ? await loadBenchEquipmentSidecar(options.benchEquipmentObservationRoot, sourceCaptureId, catalog)
      : null;
    if (benchEquipment) inputAssetPins.push(benchEquipment.pin);
    const benchEquipmentByTimestamp = benchEquipment
      ? equipmentFramesByTimestamp(benchEquipment.value)
      : new Map<number, BenchEquipmentFrame>();
    const windows = records.map((record) => ({
      captureId: record.captureId,
      startMs: record.evaluationWindow?.startMs ?? 0,
      endMs: record.evaluationWindow?.endMs
        ?? record.source?.durationMs
        ?? raw.value.source.durationMs
        ?? raw.value.frames.at(-1)?.timestampMs
        ?? 0,
    }));
    const routed = routeSourceFramesOnce(raw.value.frames, windows);
    submittedFrameCount += routed.length;
    const framesByContext = new Map<string, RawObservationFrame[]>();
    for (const entry of routed) {
      const frames = framesByContext.get(entry.captureId) ?? [];
      frames.push(entry.frame);
      framesByContext.set(entry.captureId, frames);
    }
    const contexts: Array<Readonly<Record<string, unknown>>> = [];
    for (const record of records.sort((left, right) => (
      (left.evaluationWindow?.startMs ?? 0) - (right.evaluationWindow?.startMs ?? 0)
    ))) {
      const profileEntry = record.exerciseId === "barbell_bench_press"
        ? independentBenchByView.get(record.capturePosition as "front" | "frontLeft45" | "frontRight45")
        : profiles.profiles.find((candidate) => (
          candidate.exerciseId === record.exerciseId
          && candidate.capturePosition === record.capturePosition
        ));
      if (!profileEntry) throw new Error(`${record.captureId}: full-data profile missing`);
      const side = anatomicalSideForContext(record.exerciseId, record.capturePosition);
      const profile = materializeAssessmentProfile(profileEntry.profile, side);
      const wasm = await instantiateRustMotionWasm(wasmBytes);
      const motion = new RustCanonicalWasmSession({
        sequenceId: `${options.runId}:${record.captureId}`,
        schema: "halpe26",
        image: {
          widthPx: raw.value.source.widthPx,
          heightPx: raw.value.source.heightPx,
          mirrored: false,
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
      const currentRustFrames: Array<Readonly<Record<string, unknown>>> = [];
      const collect = (): void => {
        for (const rep of motion.lastCompletedReps) reps.set(rep.repId.toString(), rep);
        for (const proposal of motion.lastQualityProposals) {
          rustProposals.set(proposal.proposalId, proposal);
        }
      };
      for (const frame of framesByContext.get(record.captureId) ?? []) {
        const timestampMs = Math.round(frame.timestampMs);
        sourceTimestampsMs.push(timestampMs);
        const axisFrame = record.exerciseId === "barbell_bench_press"
          ? benchEquipmentByTimestamp.get(timestampMs)
          : undefined;
        const equipment: readonly RustEquipmentObservation[] = measuredAxisToEquipmentObservation(
          axisFrame?.axis ?? null,
          frame.frameNumber + 1,
        );
        if (equipment.length > 0) equipmentInputFrameCount += 1;
        submitRawFrameToRust(motion, frame, equipment);
        collect();
        const packet = motion.lastDecodedPacket;
        if (!packet || Number(packet.sourceTimestampMs) !== timestampMs) {
          throw new Error(`${record.captureId}: Rust packet timestamp mismatch`);
        }
        if (packet.equipment.status.kind === "observed") equipmentObservedFrameCount += 1;
        currentRustFrames.push(serializeCurrentRustFrame(packet, motion.lastCanonicalHash));
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
      equipmentMeasuredEndpointCount += [...rustProposals.values()].reduce((sum, proposal) => (
        sum + proposal.endpoints.filter((endpoint) => (
          endpoint.evidenceChannels.includes("equipment_measured")
        )).length
      ), 0);
      const evidenceSemantic = {
        schemaVersion: "maxpower-current-rust-context-evidence/v1",
        packetSchema: "MOTN/1.8+QLT1",
        producer: "current_rust_single_pass",
        frames: currentRustFrames,
      };
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
        installedProfile: {
          identity: installed.identity,
          contentHash: profileHash,
          sourceIdentity: profileEntry.profile.identity,
          identityAdapter: installed.identity === profileEntry.profile.identity
            ? null
            : "action-equipment-profile-identity/v1",
        },
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
        currentRustEvidence: {
          ...evidenceSemantic,
          evidenceHash: sha256(stableStringify(evidenceSemantic)),
        },
      }));
      motion.close();
    }
    sources.push(deepFreeze({
      sourceCaptureId,
      sourcePoseSha256: raw.pin.sha256,
      sourceVideoSha256: raw.value.source.sha256,
      videoRef: records[0]?.source?.video ?? raw.value.source.video,
      sourceFrameCount: raw.value.frames.length,
      submittedFrameCount: routed.length,
      inputAssets: benchEquipment ? [raw.pin, benchEquipment.pin] : [raw.pin],
      contexts,
    }));
  }
  const uniqueInputPins = uniquePins(inputAssetPins);
  const semantic = {
    schemaVersion: "maxpower-motion-quality-rust-full-data-proposals/v1",
    runId: options.runId,
    runKind: "full_data_proposal",
    frozen: true,
    acceptanceEligible: false,
    accuracyClaim: "forbidden_full_data_proposal_is_review_queue_only",
    runtime: {
      visualModel: "raw YOLOX + RTMPose Halpe-26 sidecar → current Rust single pass",
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
      sourceFrameCount,
      submittedFrameCount,
      equipmentInputFrameCount,
      equipmentObservedFrameCount,
      equipmentMeasuredEndpointCount,
    },
    reproducibility: {
      datasetSha256: sha256(datasetBytes),
      profileArtifactSha256: sha256(profileBytes),
      rustWasmSha256: sha256(wasmBytes),
      profileSchemaVersion: profiles.schemaVersion,
      inputAssets: uniqueInputPins,
      inputAssetManifestSha256: sha256(stableStringify(uniqueInputPins)),
    },
    limitations: [
      "This full-data proposal may use profiles fitted with the same sources and is not blind accuracy evidence.",
      "Accepted runner input is the raw client-deployable Halpe-26 sidecar, not personal-rust-canonical-v2.",
      "Bench uses a source-independent provisional Rust barbell graph and measured prototype axes as proposal-only features.",
      "Non-bench actions are pose-only; equipment proposal features are never treated as human truth.",
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

/**
 * Adapts legacy tuned profile identities to the five-part Rust assessment
 * identity without changing any learned signal, gate, or state graph.
 * The source identity remains frozen beside the installed identity.
 */
export function materializeAssessmentProfile(
  serialized: SerializedProfile | RustExerciseProfileData,
  side: "left" | "right" | null,
): RustExerciseProfileData {
  const original = {
    ...serialized,
    contentHash: typeof serialized.contentHash === "bigint"
      ? serialized.contentHash
      : BigInt(serialized.contentHash),
  } as RustExerciseProfileData;
  const parts = original.identity.split("/");
  const actionId = parts[0] ?? "";
  const capturePosition = parts[1] ?? "";
  const sourceLaterality = parts[2] ?? "";
  const laterality = side ?? sourceLaterality;
  const matchingContexts = ACTION_CONTRACT_CATALOG
    .find((contract) => contract.exerciseId === actionId)
    ?.contexts.filter((context) => (
      context.key.capturePosition === capturePosition
      && context.key.trainingSide === laterality
    )) ?? [];
  const equipment = matchingContexts.length === 1
    ? matchingContexts[0]!.key.equipment
    : undefined;
  if (!actionId || !capturePosition || !laterality || !equipment) {
    throw new Error(`${original.identity}: cannot adapt assessment profile identity`);
  }
  const alreadyCurrent = parts.length === 5 && parts[3] === equipment;
  const version = alreadyCurrent
    ? parts[4]
    : `legacy-profile-adapter-v1-${sha256(original.identity).slice(0, 16)}`;
  const identity = `${actionId}/${capturePosition}/${laterality}/${equipment}/${version}`;
  const withoutHash = { ...original, identity };
  return { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
}

function serializeCurrentRustFrame(
  packet: DecodedMotionPacket,
  canonicalHash: bigint,
): Readonly<Record<string, unknown>> {
  return deepFreeze({
    timestampMs: Number(packet.sourceTimestampMs),
    frameId: packet.frameId.toString(),
    canonicalPacketHash: canonicalHash.toString(16).padStart(16, "0"),
    target: {
      ...packet.target,
      selectedCandidateId: packet.target.selectedCandidateId?.toString() ?? null,
    },
    landmarks: packet.canonical.map((landmark) => ({ ...landmark })),
    equipmentStatus: { ...packet.equipment.status },
    equipment: packet.equipment.tracks.map((track) => ({
      trackId: track.trackId.toString(),
      proposalId: track.proposalId.toString(),
      subjectCandidateId: track.subjectCandidateId.toString(),
      kind: track.kind,
      source: track.source,
      x: track.bbox.x,
      y: track.bbox.y,
      width: track.bbox.width,
      height: track.bbox.height,
      centerX: track.centerX,
      centerY: track.centerY,
      observationScore: track.observationScore,
      associationConfidence: track.associationConfidence,
      uncertaintyPx: track.uncertaintyPx,
      heldBy: track.heldBy,
      judgeablePath: track.judgeablePath,
    })),
    equipmentRejections: {
      reflection: packet.equipment.rejectedReflectionCount,
      static: packet.equipment.rejectedStaticCount,
      lowConfidenceOrInvalid: packet.equipment.rejectedLowConfidenceOrInvalidCount,
      outsideSubject: packet.equipment.rejectedOutsideSubjectCount,
    },
  });
}

function uniquePins(pins: readonly InputAssetPin[]): readonly InputAssetPin[] {
  const byIdentity = new Map<string, InputAssetPin>();
  for (const pin of pins) {
    const key = `${pin.assetId}\u0000${pin.path}\u0000${pin.sha256}`;
    byIdentity.set(key, pin);
  }
  return Object.freeze([...byIdentity.values()].sort((left, right) => (
    left.assetId.localeCompare(right.assetId) || left.path.localeCompare(right.path)
  )));
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
    rawObservationRoot: "data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
    benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
    profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
    sourceIndependentBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
    governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
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
