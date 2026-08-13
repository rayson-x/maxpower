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
  MotionAssessmentCapability,
} from "../../src/motion/motionPacket";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";
import {
  equipmentFramesByTimestamp,
  loadBenchEquipmentSidecar,
  loadInputCatalog,
  loadRawObservationSidecar,
  measuredAxisToEquipmentObservation,
  pinInputBytes,
  rawFrameCandidates,
  sha256,
  type BenchEquipmentFrame,
  type InputAssetPin,
  type MotionQualityInputCatalog,
  type RawObservationFrame,
} from "./runnerInputs";
import {
  ACTION_CONTRACT_CATALOG,
  getExactActionContextContract,
} from "./actionContractCatalog";

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
  readonly capability: MotionAssessmentCapability;
  readonly appliedPolicy?: Readonly<Record<string, unknown>>;
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
    rustCapability: MotionAssessmentCapability;
    rustProposalDigest: string;
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
      rustCapability: requireMotionAssessmentCapability(
        proposal.capability,
        "Rust proposal capability",
      ),
      rustProposalDigest: sha256(stableStringify(proposal)),
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
      capability: input.capability,
      appliedPolicy: input.appliedPolicy ?? null,
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

function requireMotionAssessmentCapability(
  value: unknown,
  label: string,
): MotionAssessmentCapability {
  if (value !== "quality_supported"
      && value !== "phase_supported"
      && value !== "observation_only"
      && value !== "unsupported") {
    throw new Error(`${label} is invalid`);
  }
  return value;
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

type BenchView = "front" | "frontLeft45" | "frontRight45";
type FrozenBenchCandidateId = "pose_only" | "equipment_only" | "pose_equipment_fused";

interface FrozenBenchAblationCandidate {
  readonly actionId: "barbell_bench_press";
  readonly capturePosition: BenchView;
  readonly candidateId: FrozenBenchCandidateId;
  readonly observationSetHash: string;
  readonly frameScheduleHash: string;
  readonly truthSplitHash: string;
}

interface FrozenBenchViewPolicy {
  readonly schemaVersion: "maxpower-pose-equipment-fusion-ablation/v1";
  readonly status: "selected" | "no_winner";
  readonly scope: Readonly<{
    actionId: "barbell_bench_press";
    capturePosition: BenchView;
  }>;
  readonly selectedCandidateId: FrozenBenchCandidateId | null;
  readonly policyHash: string | null;
  readonly candidates: readonly FrozenBenchAblationCandidate[];
}

export interface FrozenBenchAblationPolicyReport {
  readonly schemaVersion: "maxpower-real-pose-equipment-ablation/v1";
  readonly action: "barbell_bench_press";
  readonly sourceFrozenDigest: string;
  readonly frozenPoliciesByExactView: readonly FrozenBenchViewPolicy[];
  readonly reportDigest: string;
  readonly [key: string]: unknown;
}

export interface LoadedFrozenBenchAblationPolicyReport {
  readonly value: FrozenBenchAblationPolicyReport;
  readonly bytes: Buffer;
  readonly absolutePath: string;
  readonly sha256: string;
}

export interface AppliedBenchPolicy {
  readonly status: "selected" | "no_winner";
  readonly candidate: FrozenBenchCandidateId | "diagnostic_unselected_fused";
  readonly frozenPolicyCandidate: FrozenBenchCandidateId | null;
  readonly reportDigest: string;
  readonly reportSha256: string;
  readonly sourceFrozenDigest: string;
  readonly policyHash: string | null;
  readonly exactScope: Readonly<{
    actionId: "barbell_bench_press";
    capturePosition: BenchView;
  }>;
  readonly claimEligibility:
    | "frozen_exact_view_policy"
    | "diagnostic_only_not_frozen_policy_claim";
  readonly ablationInputSchedule: Readonly<{
    observationSetHash: string;
    frameScheduleHash: string;
    truthSplitHash: string;
  }>;
}

const BENCH_VIEWS = Object.freeze([
  "front",
  "frontLeft45",
  "frontRight45",
] as const satisfies readonly BenchView[]);
const BENCH_CANDIDATES = Object.freeze([
  "pose_only",
  "equipment_only",
  "pose_equipment_fused",
] as const satisfies readonly FrozenBenchCandidateId[]);

export async function loadFrozenBenchAblationPolicyReport(
  path: string,
): Promise<Readonly<LoadedFrozenBenchAblationPolicyReport>> {
  const absolutePath = resolve(path);
  const bytes = await readFile(absolutePath);
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  const report = validateFrozenBenchAblationPolicyReport(raw);
  return Object.freeze({
    value: report,
    bytes,
    absolutePath,
    sha256: sha256(bytes),
  });
}

export function resolveAppliedBenchPolicy(
  report: LoadedFrozenBenchAblationPolicyReport,
  actionId: string,
  capturePosition: string,
): Readonly<AppliedBenchPolicy> {
  if (actionId !== "barbell_bench_press" || !isBenchView(capturePosition)) {
    throw new Error(`${actionId}/${capturePosition}: no exact bench ablation policy`);
  }
  const policy = report.value.frozenPoliciesByExactView.find((candidate) => (
    candidate.scope.actionId === actionId
    && candidate.scope.capturePosition === capturePosition
  ));
  if (!policy) throw new Error(`${actionId}/${capturePosition}: frozen policy missing`);
  const frozenPolicyCandidate = policy.status === "selected"
    ? policy.selectedCandidateId
    : null;
  const runtimeCandidate = frozenPolicyCandidate ?? "pose_equipment_fused";
  const candidate = policy.candidates.find((entry) => entry.candidateId === runtimeCandidate);
  if (!candidate) {
    throw new Error(`${actionId}/${capturePosition}: ${runtimeCandidate} candidate lineage missing`);
  }
  const exactScope = {
    actionId: "barbell_bench_press" as const,
    capturePosition,
  } satisfies AppliedBenchPolicy["exactScope"];
  return deepFreeze({
    status: policy.status,
    candidate: policy.status === "selected"
      ? runtimeCandidate
      : "diagnostic_unselected_fused",
    frozenPolicyCandidate,
    reportDigest: report.value.reportDigest,
    reportSha256: report.sha256,
    sourceFrozenDigest: report.value.sourceFrozenDigest,
    policyHash: policy.policyHash,
    exactScope,
    claimEligibility: policy.status === "selected"
      ? "frozen_exact_view_policy"
      : "diagnostic_only_not_frozen_policy_claim",
    ablationInputSchedule: {
      observationSetHash: candidate.observationSetHash,
      frameScheduleHash: candidate.frameScheduleHash,
      truthSplitHash: candidate.truthSplitHash,
    },
  });
}

export function applyBenchPolicyToFrame(
  frame: RawObservationFrame,
  measuredEquipment: readonly RustEquipmentObservation[],
  appliedPolicy: AppliedBenchPolicy,
): Readonly<{
  candidates: readonly PoseCandidateEstimate[];
  equipment: readonly RustEquipmentObservation[];
}> {
  const measuredPose = rawFrameCandidates(frame);
  if (appliedPolicy.candidate === "pose_only") {
    return deepFreeze({ candidates: measuredPose, equipment: [] });
  }
  if (appliedPolicy.candidate === "equipment_only") {
    const unknownPose = measuredPose.map((candidate) => ({
      ...candidate,
      landmarks: candidate.landmarks.map(() => ({
        x: 0,
        y: 0,
        z: 0,
        visibility: 0,
      })),
      worldLandmarks: [],
    }));
    return deepFreeze({ candidates: unknownPose, equipment: measuredEquipment });
  }
  return deepFreeze({ candidates: measuredPose, equipment: measuredEquipment });
}

export interface FullDataProposalRunnerOptions {
  readonly datasetPath: string;
  readonly rawObservationRoot: string;
  readonly benchEquipmentObservationRoot: string;
  readonly benchAblationReportPath: string;
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
  const [datasetBytes, profileBytes, wasmBytes, independentBench, benchAblation] = await Promise.all([
    readFile(options.datasetPath),
    readFile(options.profileArtifactPath),
    readFile(options.wasmPath),
    loadFullDataBenchProfiles(options.sourceIndependentBenchProfilePath, catalog),
    loadFrozenBenchAblationPolicyReport(options.benchAblationReportPath),
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
    pinInputBytes(catalog, "fullDataRun", benchAblation.absolutePath, benchAblation.bytes),
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
      const appliedBenchPolicy = record.exerciseId === "barbell_bench_press"
        ? resolveAppliedBenchPolicy(
          benchAblation,
          record.exerciseId,
          record.capturePosition,
        )
        : null;
      const baseAppliedPolicy = appliedBenchPolicy ?? deepFreeze({
        status: "not_applicable" as const,
        candidate: "pose_only" as const,
        frozenPolicyCandidate: null,
        reportDigest: benchAblation.value.reportDigest,
        reportSha256: benchAblation.sha256,
        sourceFrozenDigest: benchAblation.value.sourceFrozenDigest,
        policyHash: null,
        exactScope: null,
        claimEligibility: "outside_bench_ablation_scope" as const,
        ablationInputSchedule: null,
      });
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
      const submittedInputSchedule: Array<Readonly<Record<string, unknown>>> = [];
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
        const prepared = appliedBenchPolicy
          ? applyBenchPolicyToFrame(frame, equipment, appliedBenchPolicy)
          : deepFreeze({ candidates: rawFrameCandidates(frame), equipment: [] });
        if (prepared.equipment.length > 0) equipmentInputFrameCount += 1;
        motion.processCandidates(prepared.candidates, timestampMs, prepared.equipment);
        submittedInputSchedule.push(deepFreeze({
          timestampMs,
          candidateIds: prepared.candidates.map((candidate) => candidate.candidateId),
          visibleLandmarkCount: prepared.candidates.reduce((sum, candidate) => (
            sum + candidate.landmarks.filter((landmark) => landmark.visibility > 0).length
          ), 0),
          equipmentProposalIds: prepared.equipment.map((observation) => observation.proposalId),
        }));
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
      const currentContextFrameScheduleHash = sha256(stableStringify(submittedInputSchedule));
      const appliedPolicy = deepFreeze({
        ...baseAppliedPolicy,
        inputSchedule: {
          currentContextFrameScheduleHash,
          submittedFrameCount: submittedInputSchedule.length,
          ablationFrameScheduleHash: appliedBenchPolicy?.ablationInputSchedule.frameScheduleHash ?? null,
        },
      });
      const profileHash = installed.contentHash.toString(16).padStart(16, "0");
      const contextCapability = reviewCapabilityForContext({
        actionId: record.exerciseId,
        capturePosition: record.capturePosition,
        anatomicalSide: side,
        profileIdentity: installed.identity,
      });
      const releaseQualityProposals = releaseQualityProposalsForPolicy(
        [...rustProposals.values()],
        appliedPolicy,
      );
      const reviewProposal = buildReviewProposal({
        captureId: record.captureId,
        actionId: record.exerciseId,
        capturePosition: record.capturePosition,
        anatomicalSide: side,
        sourceCaptureId,
        videoRef: record.source?.video ?? null,
        profileIdentity: installed.identity,
        profileHash,
        capability: contextCapability,
        appliedPolicy,
        rustProposals: releaseQualityProposals,
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
        capability: contextCapability,
        processing: {
          chronologicalMonotonic: true,
          singlePass: true,
          submittedFrameCount: sourceTimestampsMs.length,
          firstTimestampMs: sourceTimestampsMs[0] ?? null,
          lastTimestampMs: sourceTimestampsMs.at(-1) ?? null,
          inputScheduleHash: currentContextFrameScheduleHash,
        },
        appliedPolicy,
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
        qualityProposals: releaseQualityProposals,
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
      visualModel: "offline Python ONNX YOLOX + RTMPose Halpe-26 sidecar → current Rust single pass",
      visualInferenceRuntime: "offline_python_onnx_reference_only",
      actionAuthority: "Rust Motion SDK",
      packetSchema: "MOTN/1.8+QLT1",
      pythonVisionUsed: true,
      clientVisualAcceptanceEligible: false,
      repeatedVideoInterpretation: false,
      automaticTraining: false,
      profileMutation: false,
      productionPromotion: false,
      benchPolicyExecution: "frozen_exact_view_policy_or_explicit_unselected_diagnostic",
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
      benchAblationReportSha256: benchAblation.sha256,
      benchAblationReportDigest: benchAblation.value.reportDigest,
      profileSchemaVersion: profiles.schemaVersion,
      inputAssets: uniqueInputPins,
      inputAssetManifestSha256: sha256(stableStringify(uniqueInputPins)),
    },
    limitations: [
      "This full-data proposal may use profiles fitted with the same sources and is not blind accuracy evidence.",
      "The Halpe-26 observations in this release were extracted by the offline Python ONNX reference pipeline. They calibrate Rust conclusions only and are not evidence of the Web, Android, or iOS visual runtime.",
      "Client visual acceptance requires a separately frozen ONNX Runtime Web or native YOLOX + RTMPose Halpe-26 → Rust single-pass result; this release is ineligible for that claim.",
      "Bench uses an explicitly touched-benchmark provisional Rust barbell graph and measured prototype axes as proposal-only features; this full-data queue is not unseen-source evidence.",
      "Bench frontLeft45/frontRight45 execute the frozen equipment_only policy; all 26 pose landmarks are submitted as unknown.",
      "Bench front has no frozen winner; its fused output is diagnostic_unselected_fused and is ineligible for a frozen policy claim.",
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

async function loadFullDataBenchProfiles(
  path: string,
  catalog: MotionQualityInputCatalog,
): Promise<Readonly<{
  value: readonly Readonly<{
    exerciseId: "barbell_bench_press";
    capturePosition: BenchView;
    profile: RustExerciseProfileData;
  }>[];
  bytes: Buffer;
  pin: InputAssetPin;
}>> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const artifact = requireRecord(JSON.parse(bytes.toString("utf8")), "full-data bench profile artifact");
  const evidence = requireRecord(artifact.evidence, "full-data bench profile evidence");
  const fittedSourceIds = requireArray(
    evidence.fittedSourceIds,
    "full-data bench fittedSourceIds",
  ).map((value, index) => requireString(value, `full-data bench fittedSourceIds ${index}`));
  const fittedDerivativeSourceIds = requireArray(
    evidence.fittedDerivativeSourceIds,
    "full-data bench fittedDerivativeSourceIds",
  ).map((value, index) => requireString(value, `full-data bench fittedDerivativeSourceIds ${index}`));
  if (artifact.schemaVersion !== "maxpower-touched-benchmark-bench-profiles/v1"
      || evidence.status !== "touched_benchmark"
      || evidence.source !== "thresholds_touched_current_six_bench_captures"
      || fittedSourceIds.length !== 6
      || fittedDerivativeSourceIds.length !== 6) {
    throw new Error("full-data bench profile must declare touched-benchmark lineage");
  }
  const profiles = requireArray(artifact.profiles, "full-data bench profiles").map((raw, index) => {
    const entry = requireRecord(raw, `full-data bench profile ${index}`);
    const capturePosition = entry.capturePosition;
    const serialized = requireRecord(entry.profile, `full-data bench profile ${index} data`);
    if (entry.exerciseId !== "barbell_bench_press" || !isBenchView(capturePosition)) {
      throw new Error(`full-data bench profile ${index}: exact action/view mismatch`);
    }
    const identity = requireString(serialized.identity, `full-data bench profile ${index} identity`);
    if (identity !== `barbell_bench_press/${capturePosition}/bilateral/barbell/touched-benchmark-provisional-v1`
        || serialized.stateMachineId !== "barbell-axis-primary-ready-effort-return/v1") {
      throw new Error(`full-data bench profile ${index}: touched identity/state graph mismatch`);
    }
    const withoutHash = cloneJson(serialized) as unknown as Omit<RustExerciseProfileData, "contentHash">;
    return deepFreeze({
      exerciseId: "barbell_bench_press" as const,
      capturePosition,
      profile: {
        ...withoutHash,
        contentHash: computeRustExerciseProfileHash(withoutHash),
      },
    });
  });
  if (profiles.length !== BENCH_VIEWS.length
      || BENCH_VIEWS.some((view) => !profiles.some((entry) => entry.capturePosition === view))) {
    throw new Error("full-data bench profile must contain exactly three views");
  }
  return Object.freeze({
    value: Object.freeze(profiles),
    bytes,
    pin: pinInputBytes(catalog, "sourceIndependentBenchProfile", absolute, bytes),
  });
}

function validateFrozenBenchAblationPolicyReport(
  raw: unknown,
): Readonly<FrozenBenchAblationPolicyReport> {
  const report = requireRecord(raw, "bench ablation report");
  if (report.schemaVersion !== "maxpower-real-pose-equipment-ablation/v1"
      || report.action !== "barbell_bench_press"
      || report.runKind !== "touched_benchmark") {
    throw new Error("bench ablation report schema/action mismatch");
  }
  const claimBoundary = requireRecord(report.claimBoundary, "bench ablation claim boundary");
  if (claimBoundary.benchmarkClass !== "touched_benchmark"
      || JSON.stringify(report).match(/blind|generalization/iu)) {
    throw new Error("bench ablation report overstates touched-benchmark evidence");
  }
  const reportDigest = requireSha256(report.reportDigest, "bench ablation reportDigest");
  const sourceFrozenDigest = requireSha256(
    report.sourceFrozenDigest,
    "bench ablation sourceFrozenDigest",
  );
  const { reportDigest: ignoredDigest, ...semantic } = report;
  void ignoredDigest;
  if (sha256(stableStringify(semantic)) !== reportDigest) {
    throw new Error("bench ablation reportDigest mismatch");
  }

  const rawPolicies = requireArray(
    report.frozenPoliciesByExactView,
    "bench ablation exact-view policies",
  );
  if (rawPolicies.length !== BENCH_VIEWS.length) {
    throw new Error("bench ablation must contain exactly three view policies");
  }
  const seenViews = new Set<BenchView>();
  for (const [index, rawPolicy] of rawPolicies.entries()) {
    const policy = requireRecord(rawPolicy, `bench ablation policy ${index}`);
    if (policy.schemaVersion !== "maxpower-pose-equipment-fusion-ablation/v1") {
      throw new Error(`bench ablation policy ${index}: schema mismatch`);
    }
    const scope = requireRecord(policy.scope, `bench ablation policy ${index} scope`);
    if (scope.actionId !== "barbell_bench_press" || !isBenchView(scope.capturePosition)) {
      throw new Error(`bench ablation policy ${index}: exact action/view mismatch`);
    }
    if (seenViews.has(scope.capturePosition)) {
      throw new Error(`bench ablation policy ${index}: duplicate ${scope.capturePosition}`);
    }
    seenViews.add(scope.capturePosition);
    if (policy.status !== "selected" && policy.status !== "no_winner") {
      throw new Error(`bench ablation policy ${index}: invalid status`);
    }

    const rawCandidates = requireArray(
      policy.candidates,
      `bench ablation policy ${index} candidates`,
    );
    if (rawCandidates.length !== BENCH_CANDIDATES.length) {
      throw new Error(`bench ablation policy ${index}: candidate set is not exact`);
    }
    const seenCandidates = new Set<FrozenBenchCandidateId>();
    const parsedCandidates = rawCandidates.map((rawCandidate, candidateIndex) => {
      const candidate = requireRecord(
        rawCandidate,
        `bench ablation policy ${index} candidate ${candidateIndex}`,
      );
      const candidateActionId = candidate.actionId;
      const candidateView = candidate.capturePosition;
      const candidateId = candidate.candidateId;
      if (candidateActionId !== "barbell_bench_press"
          || !isBenchView(candidateView)
          || candidateActionId !== scope.actionId
          || candidateView !== scope.capturePosition
          || !isFrozenBenchCandidateId(candidateId)) {
        throw new Error(`bench ablation policy ${index}: candidate exact action/view mismatch`);
      }
      if (seenCandidates.has(candidateId)) {
        throw new Error(`bench ablation policy ${index}: duplicate ${candidateId}`);
      }
      seenCandidates.add(candidateId);
      return {
        actionId: candidateActionId,
        capturePosition: candidateView,
        candidateId,
        observationSetHash: requireSha256(
          candidate.observationSetHash,
          `bench ablation policy ${index} observationSetHash`,
        ),
        frameScheduleHash: requireSha256(
          candidate.frameScheduleHash,
          `bench ablation policy ${index} frameScheduleHash`,
        ),
        truthSplitHash: requireSha256(
          candidate.truthSplitHash,
          `bench ablation policy ${index} truthSplitHash`,
        ),
      } satisfies FrozenBenchAblationCandidate;
    });
    if (BENCH_CANDIDATES.some((candidate) => !seenCandidates.has(candidate))) {
      throw new Error(`bench ablation policy ${index}: candidate set is incomplete`);
    }
    const selectedCandidateId = policy.selectedCandidateId;
    if (policy.status === "selected") {
      if (!isFrozenBenchCandidateId(selectedCandidateId)
          || !seenCandidates.has(selectedCandidateId)) {
        throw new Error(`bench ablation policy ${index}: selected candidate is invalid`);
      }
      const policyHash = requireSha256(policy.policyHash, `bench ablation policy ${index} hash`);
      const first = parsedCandidates[0]!;
      const policySemantic = {
        schemaVersion: policy.schemaVersion,
        scope,
        selectedCandidateId,
        observationSetHash: first.observationSetHash,
        frameScheduleHash: first.frameScheduleHash,
        truthSplitHash: first.truthSplitHash,
        candidates: rawCandidates,
      };
      if (sha256(JSON.stringify(policySemantic)) !== policyHash) {
        throw new Error(`bench ablation policy ${index}: policyHash mismatch`);
      }
    } else if (selectedCandidateId !== null || policy.policyHash !== null) {
      throw new Error(`bench ablation policy ${index}: no_winner cannot select a candidate`);
    }
  }
  if (BENCH_VIEWS.some((view) => !seenViews.has(view))) {
    throw new Error("bench ablation exact-view policy set is incomplete");
  }
  void sourceFrozenDigest;
  return deepFreeze(cloneJson(report) as unknown as FrozenBenchAblationPolicyReport);
}

function isBenchView(value: unknown): value is BenchView {
  return typeof value === "string" && (BENCH_VIEWS as readonly string[]).includes(value);
}

function isFrozenBenchCandidateId(value: unknown): value is FrozenBenchCandidateId {
  return typeof value === "string" && (BENCH_CANDIDATES as readonly string[]).includes(value);
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, label);
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error(`${label} must be SHA-256`);
  return digest;
}

export function releaseQualityProposalsForPolicy(
  proposals: readonly Readonly<DecodedRustQualityProposal>[],
  appliedPolicy: Readonly<{
    status: string;
    candidate: string;
    claimEligibility: string;
    reportDigest: string;
  }>,
): readonly Readonly<Record<string, unknown>>[] {
  if (appliedPolicy.status === "no_winner" && (
    appliedPolicy.candidate !== "diagnostic_unselected_fused"
      || appliedPolicy.claimEligibility !== "diagnostic_only_not_frozen_policy_claim"
  )) {
    throw new Error("no_winner may only emit an unselected fused diagnostic");
  }
  return Object.freeze([...proposals]) as readonly Readonly<Record<string, unknown>>[];
}

export function reviewCapabilityForContext(input: Readonly<{
  actionId: string;
  capturePosition: string;
  anatomicalSide: "left" | "right" | null;
  profileIdentity: string;
}>): MotionAssessmentCapability {
  const identityParts = input.profileIdentity.split("/");
  const equipment = identityParts[3] ?? "";
  const contract = getExactActionContextContract({
    exerciseId: input.actionId,
    capturePosition: input.capturePosition,
    equipment,
    trainingSide: input.anatomicalSide ?? "bilateral",
  });
  if (!contract) return "unsupported";
  return contract.capability.phase;
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
    benchAblationReportPath: "data/workflows/motion-quality-review/bench-pose-equipment-touched-benchmark-v1.json",
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
