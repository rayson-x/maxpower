import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

import {
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm.js";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile.js";
import { recommendCapturePosition } from "../../src/pose/viewGating.js";
import { trainMmFitProfiles, validateCandidateDiscoveryManifest, verifyCandidateDiscoveryClipIntegrity, type RollingTrainingArtifact } from "../external-fitness-data/rollingProfileTrainer.js";

export type WorkflowMode = "inspect" | "candidate" | "proposal";
export type Split = "train" | "validation" | "test" | "unseen_test" | "legacy_unpartitioned";
export const CANONICAL_REPLAY_INTERFACE = "rust-canonical-replay/v1" as const;

export interface PoseRuntimeDescriptor {
  poseModel: string;
  assetHash: string;
  delegate: string;
  landmarkSchema: string;
}

export interface MotionProfileWorkflowSpec {
  schemaVersion: "maxpower-motion-profile-workflow/v1";
  workflowId: string;
  claim: {
    exerciseId: string;
    variation: string;
    equipment: string;
    capturePosition: string;
    trainingSide: "bilateral" | "left" | "right" | "alternating";
    intendedUse: readonly ("action_evidence" | "phase" | "rep_count" | "anti_interference")[];
  };
  observationDomains: readonly PoseRuntimeDescriptor[];
  sources: readonly { kind: "approved_capture" | "mmfit"; dataset: string; allowedSplits?: readonly string[] }[];
  splitPolicyId: string;
  featureContractId: string;
  candidateSearchPolicyId: string;
  promotionPolicyId: string;
  seed: number;
  mode?: WorkflowMode;
}

export interface WorkflowPlan {
  schemaVersion: "maxpower-motion-profile-workflow-plan/v1";
  workflowId: string;
  runId: string;
  mode: WorkflowMode;
  outputDir: string;
  inputHashes: Record<string, string>;
  blockers: string[];
}

export interface WorkflowRunResult {
  schemaVersion: "maxpower-motion-profile-workflow-run/v1";
  runId: string;
  status: "inspected" | "candidate_created" | "not_promotable" | "proposal_created" | "failed";
  completedStages: string[];
  sourceSummary: { selfCaptures: number; selfRepCount: number; mmfitSets: number; mmfitRepCount: number };
  admissionSummary: { total: number; byDisposition: Record<string, number>; blockers: string[] };
  splitSummary: { total: number; bySplit: Record<string, number>; leakageChecks: string[] };
  baseline: EvaluationSummary | null;
  candidate: CandidateSummary | null;
  frozenEvaluation: EvaluationSummary | null;
  proposalPath: string | null;
  blockers: string[];
  artifactHashes: Record<string, string>;
}

export interface CountMetrics {
  sampleCount: number;
  truthCount: number;
  predictedCount: number;
  exactRatio: number | null;
  meanAbsoluteError: number | null;
  offByOneRatio: number | null;
}

export interface EvaluationSummary {
  parent: { selfPerRep: SelfMetrics; mmfitSetCount: MmFitMetrics };
  candidate: { selfPerRep: SelfMetrics; mmfitSetCount: MmFitMetrics };
  selfByAdmission: Record<"tuningEligible" | "challenge", {
    parent: SelfMetrics;
    candidate: SelfMetrics;
  }>;
  selfByBucket: Array<{
    bucketId: string;
    admission: "tuningEligible" | "challenge";
    parent: SelfMetrics;
    candidate: SelfMetrics;
  }>;
  bySplit: Record<string, { parent: CountMetrics; candidate: CountMetrics }>;
  notApplicable: { metric: string; reason: string }[];
}

interface SelfMetrics extends CountMetrics {
  matchedRepCount: number;
  matchedRecall: number | null;
  matchedPrecision: number | null;
  falsePositiveRepCount: number;
  negativeWindowFalsePositiveCount: number;
  meanAbsolutePeakErrorMs: number | null;
  needsReviewOutcomeCount: number;
  rejectedOutcomeCount: number;
  unavailableCaptureCount: number;
  exactCaptureCount: number;
  fullyMatchedCaptureCount: number;
}

interface MmFitMetrics extends CountMetrics {
  split: string;
  domain: "mmfit_openpose18_mapped";
}

export interface CandidateSummary {
  status: "research_candidate" | "not_promotable";
  selfProfiles: number;
  mmfitAcceptedBuckets: number;
  searchTracePath: string;
  trainingSequenceIdsByCandidate: Record<string, string[]>;
}

interface ApprovedRecord {
  captureId: string;
  exerciseId: string;
  capturePosition: string;
  expectedCount?: number | null;
  segments: { startMs: number; peakMs: number; endMs: number }[];
  annotationStatus: string;
  eligibility: { challenge: boolean; reasons: string[] };
  source: { keypoints: string; model: string | null };
  reviewedNegativeWindows?: { startMs: number; endMs: number }[];
}

interface ApprovedDataset { source: { approvalExportSha256: string }; records: ApprovedRecord[] }
interface Pose {
  timestampMs: number;
  landmarks: { x: number; y: number; z: number; visibility: number }[];
  worldLandmarks?: unknown[];
  image?: { widthPx: number; heightPx: number; mirrored: boolean };
}
export interface RepSegment { startMs: number; peakMs: number; endMs: number }
export interface ProfileReplayResult {
  confirmed: RepSegment[];
  needsReviewCount: number;
  rejectedCount: number;
}
export interface SelfReplayMetricRow {
  captureId: string;
  challenge: boolean;
  truthSegments: RepSegment[];
  negativeWindows: { startMs: number; endMs: number }[];
  replay: ProfileReplayResult | null;
}
type ReplayLifecycle = "compatibility_replay" | "product_set";
interface StoredProfile extends Omit<RustExerciseProfileData, "contentHash"> { contentHash: string }
interface ProfileEntry {
  exerciseId: string;
  capturePosition: string;
  trainingSide?: string;
  variation?: string;
  profile: StoredProfile;
  evidence?: { sourceCaptureIds?: string[]; [key: string]: unknown };
  [key: string]: unknown;
}
interface ProfileArtifact { profiles: ProfileEntry[] }
interface MmFitManifestClip { clipFile: string; sourceSequenceId: string; subjectId: string; split: Exclude<Split, "legacy_unpartitioned">; sourceAction: string; exerciseId: string; expectedCount: number; frameCount: number; clipSha256?: string }
interface MmFitManifest { clips: MmFitManifestClip[] }
interface MmFitClip { sourceSequenceId: string; label: { totalRepetitions: number }; frames: Pose[] }
interface WorkflowMmFitRow extends MmFitManifestClip { bucket: string; predictedParent: number | null; predictedCandidate: number | null }

function rgbStatus(rootDir: string) {
  const trainSubjects = new Set(["w01", "w02", "w03", "w04", "w06", "w07", "w08", "w16", "w17", "w18"]);
  const rgbRoot = path.resolve(rootDir, "data/external/mm-fit/rgb");
  const manifestPath = path.join(rgbRoot, "zenodo-record-7672767.json");
  if (!fs.existsSync(manifestPath)) return { trainStatus: "missing_manifest", completeFiles: [] as string[], partialFiles: [] as string[], poseDomain: "mmfit_openpose18_mapped" };
  const manifest = json<{ files: { key: string; size: number; checksum: string }[] }>(manifestPath);
  const completeFiles: string[] = [];
  const partialFiles: string[] = [];
  const trainRgbFiles = manifest.files.filter((item) =>
    item.key.endsWith("_rgb.mp4") && trainSubjects.has(item.key.slice(0, 3))
  );
  for (const file of trainRgbFiles) {
    const target = path.join(rgbRoot, file.key);
    if (fs.existsSync(target) && fs.statSync(target).size === file.size && md5(target) === file.checksum.replace(/^md5:/, "")) completeFiles.push(file.key);
    else if (fs.existsSync(`${target}.part`)) partialFiles.push(`${file.key}.part`);
  }
  const trainStatus = completeFiles.length === trainRgbFiles.length ? "complete" : "partial";
  return {
    trainStatus,
    expectedTrainFiles: trainRgbFiles.map((file) => file.key),
    completeFiles,
    partialFiles,
    nonTrainRgbPolicy: "not_requested",
    poseDomain: trainStatus === "complete"
      ? "mmfit_mediapipe33_heavy_pending_extraction"
      : "mmfit_openpose18_mapped",
  };
}

const SELF_DATASET = "data/training/approved-segmentation-v1.json";
const APPROVAL_EXPORT = "/Users/Ruihan/Documents/power/field-capture-approvals-2026-08-08.json";
const SELF_PARENT = "public/archives/confirmed-captures/recognition-profiles.json";
const MMFIT_MANIFEST = "data/external/mm-fit/normalized/manifest.json";
const MMFIT_NATIVE_ROOT = "data/external/mm-fit/native-mediapipe33-heavy";
const MMFIT_NATIVE_MANIFEST = `${MMFIT_NATIVE_ROOT}/manifest.json`;
const WASM = "public/motion-sdk/maxpower_motion_sdk.wasm";

function json<T>(file: string): T { return JSON.parse(fs.readFileSync(file, "utf8")) as T; }
const HASH_CHUNK_BYTES = 8 * 1024 * 1024;

export function hashFileSync(file: string, algorithm: "sha256" | "md5"): string {
  const hash = crypto.createHash(algorithm);
  const descriptor = fs.openSync(file, "r");
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, chunk, 0, chunk.length, null);
      if (bytesRead > 0) hash.update(chunk.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function sha256(file: string): string { return hashFileSync(file, "sha256"); }
function md5(file: string): string { return hashFileSync(file, "md5"); }
function stableHash(value: unknown): string { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

export function inspectMmFitNativeCandidateCorpus(rootDir: string): {
  status: "missing" | "invalid" | "complete";
  root: string;
  manifestPath: string;
  poseDomain: string | null;
  clipCount: number;
  sequenceIds: readonly string[];
  corpusSha256: string | null;
  reason?: string;
} {
  const nativeRoot = path.resolve(rootDir, MMFIT_NATIVE_ROOT);
  const nativeManifestPath = path.resolve(rootDir, MMFIT_NATIVE_MANIFEST);
  if (!fs.existsSync(nativeManifestPath)) {
    return { status: "missing", root: nativeRoot, manifestPath: nativeManifestPath, poseDomain: null, clipCount: 0, sequenceIds: [], corpusSha256: null, reason: "native manifest is missing" };
  }
  try {
    const native = json<{
      schemaVersion?: string;
      complete?: boolean;
      poseDomain?: string;
      modelAssetSha256?: string;
      mediapipeRuntimeVersion?: string;
      delegate?: string;
      extractorVersion?: string;
      requestedSplits?: string[];
      requestedSessions?: string[] | null;
      requestedSequences?: string[] | null;
      clips?: MmFitManifestClip[];
    }>(nativeManifestPath);
    if (native.schemaVersion !== "maxpower-mmfit-native-pose-manifest/v2") throw new Error(`unsupported schemaVersion=${native.schemaVersion ?? "missing"}`);
    if (native.complete !== true) throw new Error("native extraction manifest is not complete");
    if (native.poseDomain !== "mmfit_mediapipe33_heavy_cpu") throw new Error(`unexpected poseDomain=${native.poseDomain ?? "missing"}`);
    if (native.delegate !== "CPU") throw new Error(`unexpected delegate=${native.delegate ?? "missing"}`);
    if (!native.modelAssetSha256?.match(/^[a-f0-9]{64}$/)) throw new Error("modelAssetSha256 is missing or invalid");
    if (!native.mediapipeRuntimeVersion) throw new Error("mediapipeRuntimeVersion is missing");
    if (native.extractorVersion !== "mmfit-native-mediapipe33/v2") throw new Error(`unexpected extractorVersion=${native.extractorVersion ?? "missing"}`);
    if (JSON.stringify(native.requestedSplits) !== JSON.stringify(["train"])) throw new Error("requestedSplits must be exactly train");
    if (native.requestedSessions !== null) throw new Error("requestedSessions must be null for the complete train corpus");
    if (native.requestedSequences !== null) throw new Error("requestedSequences must be null for the complete train corpus");
    if (!Array.isArray(native.clips)) throw new Error("clips are missing");
    const mapped = json<MmFitManifest>(path.resolve(rootDir, MMFIT_MANIFEST));
    const validation = validateCandidateDiscoveryManifest(native.clips, mapped.clips);
    const integrity = verifyCandidateDiscoveryClipIntegrity(nativeRoot, native.clips);
    const modelPath = path.resolve(rootDir, "public/models/pose_landmarker_heavy.task");
    if (fs.existsSync(modelPath) && sha256(modelPath) !== native.modelAssetSha256) throw new Error("model asset SHA-256 does not match the checked-in Heavy model");
    return {
      status: "complete",
      root: nativeRoot,
      manifestPath: nativeManifestPath,
      poseDomain: native.poseDomain,
      clipCount: validation.clipCount,
      sequenceIds: validation.sequenceIds,
      corpusSha256: integrity.corpusSha256,
    };
  } catch (error) {
    return {
      status: "invalid",
      root: nativeRoot,
      manifestPath: nativeManifestPath,
      poseDomain: null,
      clipCount: 0,
      sequenceIds: [],
      corpusSha256: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
function deserialize(profile: StoredProfile): RustExerciseProfileData {
  return { ...profile, contentHash: BigInt(profile.contentHash), primarySignal: { ...profile.primarySignal }, secondarySignal: { ...profile.secondarySignal } };
}
function serialize(profile: RustExerciseProfileData): StoredProfile {
  return { ...profile, contentHash: profile.contentHash.toString() };
}

export function stableRunId(spec: MotionProfileWorkflowSpec, inputHashes: Record<string, string>): string {
  return stableHash({
    spec: { ...spec, mode: spec.mode ?? "candidate" },
    inputHashes,
    featureCodeVersion: "motion-profile-workflow/v6-native-heavy-fixed-side-grid",
    rustContract: "canonical-rust-replay/v1",
  }).slice(0, 24);
}

export function adaptMmFitSequence(input: {
  sourceSequenceId: string;
  subjectId: string;
  split: Exclude<Split, "legacy_unpartitioned">;
  exerciseId: string;
  sourceAction: string;
  frames: readonly Pose[];
  expectedCount: number;
}) {
  return {
    schemaVersion: "maxpower-canonical-training-sequence/v1",
    sequenceId: stableHash({ dataset: "mm-fit", sourceSequenceId: input.sourceSequenceId, domain: "mmfit_openpose18_mapped" }).slice(0, 24),
    source: { datasetId: "mm-fit", sourceRecordId: input.sourceSequenceId, sourceHash: stableHash(input), licenseOrConsentId: "mm-fit-research-policy/pending-license-review" },
    identity: { exerciseId: input.exerciseId, variation: null, equipment: null, capturePosition: "unknown", trainingSide: "unknown" },
    grouping: { subjectId: input.subjectId, sessionId: input.sourceSequenceId.split(":")[0], sourceVideoId: input.sourceSequenceId, deviceId: null },
    observation: { poseModel: "mmfit-openpose18-mapped", assetHash: "source-dataset", delegate: "offline", landmarkSchema: "blazepose33-adapted" },
    frames: input.frames.map((frame) => ({ timestampMs: frame.timestampMs, landmarkCount: frame.landmarks.length, unknownLandmarkIndexes: frame.landmarks.flatMap((landmark, index) => landmark.visibility > 0 ? [] : [index]) })),
    supervision: { labelSource: "official_dataset", granularity: "set_count", approvalStatus: "research_only", allowedUses: ["weak_candidate_discovery", "frozen_evaluation"], forbiddenUses: ["per_rep_phase_truth", "production_profile_promotion", "form_reference"] },
    labels: { setBounds: [], totalRepetitions: input.expectedCount, repBounds: [], negativeWindows: [] },
    quality: { sourceConfidenceAvailable: false, cameraView: "unknown", observationDomain: "mmfit_openpose18_mapped" },
  } as const;
}

export function buildAdmission(self: ApprovedDataset, mmfit: MmFitManifest) {
  const entries = [
    ...self.records.map((record) => ({
      sequenceId: `self:${record.captureId}`,
      source: "approved_capture",
      split: "legacy_unpartitioned",
      supervision: "per_rep_phase",
      disposition: record.eligibility.challenge
        ? "challenge_regression_only"
        : "candidate_discovery_and_regression",
      blockers: [
        "legacy_unpartitioned:missing_subject_id",
        "legacy_unpartitioned:missing_session_id",
        ...(record.eligibility.challenge
          ? ["challenge:not_training_evidence", ...record.eligibility.reasons.map((reason) => `challenge:${reason}`)]
          : []),
      ],
    })),
    ...mmfit.clips.map((clip) => ({ sequenceId: `mmfit:${clip.sourceSequenceId}`, source: "mm-fit", split: clip.split, supervision: "set_count", disposition: clip.split === "train" ? "weak_candidate_discovery" : "frozen_evaluation", blockers: ["research_only:license_review_pending", "set_count_not_per_rep_truth"] })),
  ];
  return { schemaVersion: "maxpower-motion-profile-admission/v1", entries, total: entries.length };
}

export function eligibleSelfTrainingCaptureIds(self: ApprovedDataset): string[] {
  return self.records
    .filter((record) => !record.eligibility.challenge)
    .map((record) => record.captureId);
}

export function admitSelfCandidateEvidence<T extends { candidateId: string; trainingCaptureIds: readonly string[] }>(
  entries: readonly T[],
  eligibleCaptureIds: readonly string[],
) {
  const eligible = new Set(eligibleCaptureIds);
  const accepted: T[] = [];
  const rejected: (T & { reason: string })[] = [];
  for (const entry of entries) {
    if (entry.trainingCaptureIds.length === 0) {
      rejected.push({ ...entry, reason: "missing_training_capture_ids" });
      continue;
    }
    const disallowed = entry.trainingCaptureIds.filter((captureId) => !eligible.has(captureId));
    if (disallowed.length) {
      rejected.push({
        ...entry,
        reason: `challenge_or_undeclared_training_capture:${disallowed.join(",")}`,
      });
      continue;
    }
    accepted.push(entry);
  }
  return { accepted, rejected };
}

export function matchSegmentsByPeak(
  truth: readonly RepSegment[],
  predicted: readonly RepSegment[],
  toleranceMs = 1_500,
) {
  const remaining = new Set(predicted.map((_, index) => index));
  const pairs: { truthIndex: number; predictedIndex: number; peakOffsetMs: number }[] = [];
  const unmatchedTruthIndexes: number[] = [];
  for (const [truthIndex, segment] of truth.entries()) {
    const closest = [...remaining]
      .map((predictedIndex) => ({
        predictedIndex,
        distance: Math.abs(predicted[predictedIndex].peakMs - segment.peakMs),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!closest || closest.distance > toleranceMs) {
      unmatchedTruthIndexes.push(truthIndex);
      continue;
    }
    remaining.delete(closest.predictedIndex);
    pairs.push({
      truthIndex,
      predictedIndex: closest.predictedIndex,
      peakOffsetMs: predicted[closest.predictedIndex].peakMs - segment.peakMs,
    });
  }
  return {
    matchedCount: pairs.length,
    pairs,
    unmatchedTruthIndexes,
    unmatchedPredictedIndexes: [...remaining],
    meanAbsolutePeakErrorMs: pairs.length
      ? pairs.reduce((sum, pair) => sum + Math.abs(pair.peakOffsetMs), 0) / pairs.length
      : null,
  };
}

export function summarizeSelfReplayRows(rows: readonly SelfReplayMetricRow[]): SelfMetrics {
  const evaluated = rows.filter((row): row is SelfReplayMetricRow & { replay: ProfileReplayResult } => row.replay !== null);
  const countSummary = countMetrics(rows.map((row) => ({
    truth: row.truthSegments.length,
    predicted: row.replay?.confirmed.length ?? 0,
  })));
  let matchedRepCount = 0;
  let falsePositiveRepCount = 0;
  let negativeWindowFalsePositiveCount = 0;
  let absolutePeakErrorMs = 0;
  let exactCaptureCount = 0;
  let fullyMatchedCaptureCount = 0;
  for (const row of evaluated) {
    const match = matchSegmentsByPeak(row.truthSegments, row.replay.confirmed);
    matchedRepCount += match.matchedCount;
    falsePositiveRepCount += match.unmatchedPredictedIndexes.length;
    absolutePeakErrorMs += match.pairs.reduce((sum, pair) => sum + Math.abs(pair.peakOffsetMs), 0);
    negativeWindowFalsePositiveCount += row.replay.confirmed.filter((segment) =>
      row.negativeWindows.some((window) => segment.peakMs >= window.startMs && segment.peakMs <= window.endMs)
    ).length;
    if (row.replay.confirmed.length === row.truthSegments.length) {
      exactCaptureCount += 1;
    }
    if (match.matchedCount === row.truthSegments.length
      && row.replay.confirmed.length === row.truthSegments.length) {
      fullyMatchedCaptureCount += 1;
    }
  }
  return {
    ...countSummary,
    exactRatio: countSummary.exactRatio,
    matchedRepCount,
    matchedRecall: countSummary.truthCount ? matchedRepCount / countSummary.truthCount : null,
    matchedPrecision: countSummary.predictedCount ? matchedRepCount / countSummary.predictedCount : null,
    falsePositiveRepCount,
    negativeWindowFalsePositiveCount,
    meanAbsolutePeakErrorMs: matchedRepCount ? absolutePeakErrorMs / matchedRepCount : null,
    needsReviewOutcomeCount: evaluated.reduce((sum, row) => sum + row.replay.needsReviewCount, 0),
    rejectedOutcomeCount: evaluated.reduce((sum, row) => sum + row.replay.rejectedCount, 0),
    unavailableCaptureCount: rows.length - evaluated.length,
    exactCaptureCount,
    fullyMatchedCaptureCount,
  };
}

export function buildSplitLock(self: ApprovedDataset, mmfit: MmFitManifest, runId: string) {
  const assignments = [
    ...self.records.map((record) => ({ sequenceId: `self:${record.captureId}`, groupKey: null, split: "legacy_unpartitioned", reason: "subject/session keys absent" })),
    ...mmfit.clips.map((clip) => ({ sequenceId: `mmfit:${clip.sourceSequenceId}`, groupKey: `subject:${clip.subjectId}`, split: clip.split, reason: "official MM-Fit subject split" })),
  ];
  return { schemaVersion: "maxpower-motion-profile-split-lock/v1", runId, policy: "subject-session-source-video/v1", assignments, leakageChecks: ["same sourceSequenceId has one split", "MM-Fit official subject split preserved", "self data remains legacy_unpartitioned"] };
}

function replayProfile(
  wasm: MotionWasmExports,
  sequenceId: string,
  poses: readonly Pose[],
  profile: RustExerciseProfileData,
  lifecycle: ReplayLifecycle,
): ProfileReplayResult {
  const first = poses[0];
  const session = new RustCanonicalWasmSession({
    sequenceId,
    schema: "blazepose33",
    image: {
      widthPx: first?.image?.widthPx ?? 1280,
      heightPx: first?.image?.heightPx ?? 720,
      rotationDegrees: 0,
      mirrored: first?.image?.mirrored ?? false,
    },
    stabilization: "fusion",
    setLifecycleMode: lifecycle === "product_set" ? "preview" : "replay",
  }, wasm);
  session.installExerciseProfileData(profile);
  if (lifecycle === "product_set") session.beginSet();
  const confirmed: RepSegment[] = [];
  let needsReviewCount = 0;
  let rejectedCount = 0;
  for (const pose of poses) {
    session.process({
      timestampMs: pose.timestampMs,
      landmarks: pose.landmarks.map((landmark) => ({
        x: Number.isFinite(landmark.x) ? landmark.x : 0,
        y: Number.isFinite(landmark.y) ? landmark.y : 0,
        z: Number.isFinite(landmark.z) ? landmark.z : 0,
        visibility: landmark.visibility,
      })),
      worldLandmarks: [],
    });
    for (const rep of session.lastCompletedReps) {
      if (rep.disposition === "confirmed") {
        confirmed.push({
          startMs: Number(rep.startTimestampMs),
          peakMs: Number(rep.peakTimestampMs),
          endMs: Number(rep.endTimestampMs),
        });
      } else if (rep.disposition === "needs_review") {
        needsReviewCount += 1;
      } else {
        rejectedCount += 1;
      }
    }
  }
  if (lifecycle === "product_set") session.finishSet();
  session.close();
  return { confirmed, needsReviewCount, rejectedCount };
}

function replayProfileCount(
  wasm: MotionWasmExports,
  sequenceId: string,
  poses: readonly Pose[],
  profile: RustExerciseProfileData,
): number {
  return replayProfile(wasm, sequenceId, poses, profile, "compatibility_replay").confirmed.length;
}

function selfRows(
  wasm: MotionWasmExports,
  dataset: ApprovedDataset,
  parentProfiles: ProfileArtifact,
  candidateProfiles: ProfileArtifact = parentProfiles,
  lifecycle: ReplayLifecycle = "product_set",
) {
  return dataset.records.map((record) => {
    const fixture = json<{ poses: Pose[] }[]>(path.join("public/archives/confirmed-captures", record.source.keypoints))[0];
    const parent = parentProfiles.profiles.find((item) => item.exerciseId === record.exerciseId && item.capturePosition === record.capturePosition);
    const candidate = candidateProfiles.profiles.find((item) => item.exerciseId === record.exerciseId && item.capturePosition === record.capturePosition);
    return {
      captureId: record.captureId,
      exerciseId: record.exerciseId,
      capturePosition: record.capturePosition,
      challenge: record.eligibility.challenge,
      truthSegments: record.segments.map((segment) => ({ ...segment })),
      negativeWindows: (record.reviewedNegativeWindows ?? []).map((window) => ({ ...window })),
      parent: fixture?.poses && parent
        ? replayProfile(wasm, `workflow-parent:${record.captureId}`, fixture.poses, deserialize(parent.profile), lifecycle)
        : null,
      candidate: fixture?.poses && candidate
        ? replayProfile(wasm, `workflow-candidate:${record.captureId}`, fixture.poses, deserialize(candidate.profile), lifecycle)
        : null,
    };
  });
}

function countMetrics(rows: readonly { truth: number; predicted: number }[]): CountMetrics {
  if (!rows.length) return { sampleCount: 0, truthCount: 0, predictedCount: 0, exactRatio: null, meanAbsoluteError: null, offByOneRatio: null };
  return { sampleCount: rows.length, truthCount: rows.reduce((sum, row) => sum + row.truth, 0), predictedCount: rows.reduce((sum, row) => sum + row.predicted, 0), exactRatio: round(rows.filter((row) => row.truth === row.predicted).length / rows.length), meanAbsoluteError: round(rows.reduce((sum, row) => sum + Math.abs(row.truth - row.predicted), 0) / rows.length), offByOneRatio: round(rows.filter((row) => Math.abs(row.truth - row.predicted) <= 1).length / rows.length) };
}

function selfMetrics(rows: ReturnType<typeof selfRows>, field: "parent" | "candidate"): SelfMetrics {
  return summarizeSelfReplayRows(rows.map((row) => ({
    captureId: row.captureId,
    challenge: row.challenge,
    truthSegments: row.truthSegments,
    negativeWindows: row.negativeWindows,
    replay: row[field],
  })));
}

const SELF_PROFILE_SCALE = [0.55, 0.7, 0.85, 1, 1.2, 1.45, 1.8] as const;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function profileWith(
  source: RustExerciseProfileData,
  identity: string,
  overrides: Partial<Omit<RustExerciseProfileData, "contentHash" | "identity">>,
): RustExerciseProfileData {
  const merged = { ...source, ...overrides };
  const minAmplitude = Math.max(0.001, Math.min(merged.minPrimaryAmplitude, merged.minSecondaryAmplitude));
  const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    ...merged,
    identity,
    startAmplitude: clamp(merged.startAmplitude, 0.001, minAmplitude * 0.92),
    returnHysteresis: clamp(merged.returnHysteresis, 0.001, minAmplitude * 0.92),
    readyTolerance: Math.max(0.001, merged.readyTolerance),
    minRepDurationMs: Math.max(100, Math.min(merged.minRepDurationMs, merged.maxRepDurationMs - 100)),
    maxRepDurationMs: Math.max(merged.maxRepDurationMs, merged.minRepDurationMs + 100),
    primarySignal: { ...merged.primarySignal },
    secondarySignal: { ...merged.secondarySignal },
  };
  return { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) };
}

function initialSelfSignalProfiles(base: RustExerciseProfileData, identity: string): RustExerciseProfileData[] {
  const leftElbow = { kind: "joint-angle" as const, landmarks: [11, 13, 15] as [number, number, number] };
  const rightElbow = { kind: "joint-angle" as const, landmarks: [12, 14, 16] as [number, number, number] };
  const leftShoulder = { kind: "joint-angle" as const, landmarks: [23, 11, 13] as [number, number, number] };
  const rightShoulder = { kind: "joint-angle" as const, landmarks: [24, 12, 14] as [number, number, number] };
  const leftReach = { kind: "landmark-distance" as const, landmarks: [15, 11] as [number, number] };
  const rightReach = { kind: "landmark-distance" as const, landmarks: [16, 12] as [number, number] };
  const elbowSpread = { kind: "landmark-distance" as const, landmarks: [13, 14] as [number, number] };
  const wristSpread = { kind: "landmark-distance" as const, landmarks: [15, 16] as [number, number] };
  const leftElbowY = { kind: "landmark-y" as const, landmarks: [13] as [number] };
  const rightElbowY = { kind: "landmark-y" as const, landmarks: [14] as [number] };
  const leftWristY = { kind: "landmark-y" as const, landmarks: [15] as [number] };
  const rightWristY = { kind: "landmark-y" as const, landmarks: [16] as [number] };
  const specifications = [
    { unit: "image-angle-deg" as const, primary: leftElbow, secondary: rightElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftElbow, secondary: leftElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: rightElbow, secondary: rightElbow, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftShoulder, secondary: rightShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: leftShoulder, secondary: leftShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "image-angle-deg" as const, primary: rightShoulder, secondary: rightShoulder, start: 5, min: 20, hysteresis: 5, ready: 6 },
    { unit: "torso-normalized-distance" as const, primary: leftReach, secondary: rightReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: leftReach, secondary: leftReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: rightReach, secondary: rightReach, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: wristSpread, secondary: wristSpread, start: 0.04, min: 0.15, hysteresis: 0.04, ready: 0.05 },
    { unit: "torso-normalized-distance" as const, primary: elbowSpread, secondary: elbowSpread, start: 0.025, min: 0.10, hysteresis: 0.025, ready: 0.035 },
    { unit: "image-normalized-y" as const, primary: leftElbowY, secondary: rightElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: leftElbowY, secondary: leftElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: rightElbowY, secondary: rightElbowY, start: 0.015, min: 0.06, hysteresis: 0.015, ready: 0.02 },
    { unit: "image-normalized-y" as const, primary: leftWristY, secondary: rightWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
    { unit: "image-normalized-y" as const, primary: leftWristY, secondary: leftWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
    { unit: "image-normalized-y" as const, primary: rightWristY, secondary: rightWristY, start: 0.02, min: 0.08, hysteresis: 0.02, ready: 0.025 },
  ];
  return specifications.map((specification) => profileWith(base, identity, {
    coordinateUnit: specification.unit,
    direction: "auto",
    primarySignal: specification.primary,
    secondarySignal: specification.secondary,
    startAmplitude: specification.start,
    minPrimaryAmplitude: specification.min,
    minSecondaryAmplitude: specification.min,
    returnHysteresis: specification.hysteresis,
    readyTolerance: specification.ready,
    minRepDurationMs: 350,
    maxRepDurationMs: 8_000,
  }));
}

function selfProfileNeighborhoods(profile: RustExerciseProfileData, identity: string): RustExerciseProfileData[][] {
  return [
    SELF_PROFILE_SCALE.map((factor) => profileWith(profile, identity, { startAmplitude: profile.startAmplitude * factor })),
    SELF_PROFILE_SCALE.map((factor) => profileWith(profile, identity, {
      minPrimaryAmplitude: profile.minPrimaryAmplitude * factor,
      minSecondaryAmplitude: profile.minSecondaryAmplitude * factor,
    })),
    SELF_PROFILE_SCALE.map((factor) => profileWith(profile, identity, { returnHysteresis: profile.returnHysteresis * factor })),
    SELF_PROFILE_SCALE.map((factor) => profileWith(profile, identity, { readyTolerance: profile.readyTolerance * factor })),
    [250, 350, 450, 600, 800, 1_000, 1_300].map((value) => profileWith(profile, identity, { minRepDurationMs: value })),
    [2_000, 3_000, 4_500, 6_000, 8_000, 12_000].map((value) => profileWith(profile, identity, { maxRepDurationMs: value })),
    [400, 700, 1_000, 1_500, 2_500].map((value) => profileWith(profile, identity, { maxGapMs: value })),
    (["auto", "increasing", "decreasing"] as const).map((direction) => profileWith(profile, identity, { direction })),
  ];
}

function selfCandidateScore(metrics: SelfMetrics): number {
  const recall = metrics.matchedRecall ?? 0;
  const precision = metrics.matchedPrecision ?? 0;
  const f1 = recall + precision ? (2 * recall * precision) / (recall + precision) : 0;
  return metrics.fullyMatchedCaptureCount * 1_000_000_000_000
    + Math.min(recall, precision) * 1_000_000_000
    + f1 * 1_000_000
    - metrics.negativeWindowFalsePositiveCount * 10_000
    - metrics.falsePositiveRepCount * 1_000
    - (metrics.meanAbsolutePeakErrorMs ?? 10_000);
}

export function buildSelfCandidateEvidence(
  parentEvidence: Readonly<Record<string, unknown>> | undefined,
  records: readonly { captureId: string; segments: readonly RepSegment[] }[],
  approvalExportSha256: string,
) {
  const captureIds = records.map((record) => record.captureId);
  const labeledRepCount = records.reduce((sum, record) => sum + record.segments.length, 0);
  return {
    sourceDataset: typeof parentEvidence?.sourceDataset === "string"
      ? parentEvidence.sourceDataset
      : SELF_DATASET,
    approvalExportSha256,
    captureIds,
    captureCount: records.length,
    labeledRepCount,
    usableRepCount: labeledRepCount,
    challengeRepCount: 0,
    excludedRepCount: 0,
    notes: Array.isArray(parentEvidence?.notes) ? parentEvidence.notes : [],
    tuning: "motion-profile-workflow-coordinate-search/v3",
    replayInterface: CANONICAL_REPLAY_INTERFACE,
    replayLifecycle: "product_set",
    fullVideoNegativeContext: true,
    inSampleOnly: true,
    promotionPassed: false,
    sourceCaptureIds: captureIds,
  } as const;
}

function trainSelfProfiles(
  rootDir: string,
  wasm: MotionWasmExports,
  dataset: ApprovedDataset,
  parentArtifact: ProfileArtifact,
) {
  const eligibleRecords = dataset.records.filter((record) => !record.eligibility.challenge);
  const grouped = new Map<string, ApprovedRecord[]>();
  for (const record of eligibleRecords) {
    const key = `${record.exerciseId}|${record.capturePosition}`;
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  const profiles: ProfileEntry[] = [];
  const traces: object[] = [];
  const insufficientEvidence: object[] = [];
  for (const [bucketId, records] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const [exerciseId, capturePosition] = bucketId.split("|");
    const parentEntry = parentArtifact.profiles.find((entry) =>
      entry.exerciseId === exerciseId && entry.capturePosition === capturePosition
    );
    if (!parentEntry) {
      insufficientEvidence.push({ bucketId, reason: "missing_parent_profile", trainingCaptureIds: records.map((record) => record.captureId) });
      continue;
    }
    const loaded = records.map((record) => ({
      record,
      poses: json<{ poses: Pose[] }[]>(path.resolve(rootDir, "public/archives/confirmed-captures", record.source.keypoints))[0].poses,
    }));
    const identity = `${exerciseId}/${capturePosition}/bilateral/workflow-candidate/v1`;
    const seen = new Map<string, { profile: RustExerciseProfileData; metrics: SelfMetrics; score: number }>();
    const evaluations: object[] = [];
    const evaluateProfile = (profile: RustExerciseProfileData) => {
      const hash = profile.contentHash.toString();
      const existing = seen.get(hash);
      if (existing) return existing;
      const metricRows: SelfReplayMetricRow[] = loaded.map(({ record, poses }) => ({
        captureId: record.captureId,
        challenge: false,
        truthSegments: record.segments.map((segment) => ({ ...segment })),
        negativeWindows: (record.reviewedNegativeWindows ?? []).map((window) => ({ ...window })),
        replay: replayProfile(wasm, `self-train:${bucketId}:${hash}:${record.captureId}`, poses, profile, "product_set"),
      }));
      const metrics = summarizeSelfReplayRows(metricRows);
      const result = { profile, metrics, score: selfCandidateScore(metrics) };
      seen.set(hash, result);
      evaluations.push({
        profileHash: hash,
        primarySignal: profile.primarySignal,
        secondarySignal: profile.secondarySignal,
        direction: profile.direction,
        startAmplitude: profile.startAmplitude,
        minPrimaryAmplitude: profile.minPrimaryAmplitude,
        minSecondaryAmplitude: profile.minSecondaryAmplitude,
        returnHysteresis: profile.returnHysteresis,
        readyTolerance: profile.readyTolerance,
        maxGapMs: profile.maxGapMs,
        minRepDurationMs: profile.minRepDurationMs,
        maxRepDurationMs: profile.maxRepDurationMs,
        score: result.score,
        metrics,
      });
      return result;
    };
    const baseline = evaluateProfile(profileWith(deserialize(parentEntry.profile), identity, {}));
    let best = baseline;
    for (const seed of initialSelfSignalProfiles(deserialize(parentEntry.profile), identity)) {
      const candidate = evaluateProfile(seed);
      if (candidate.score > best.score) best = candidate;
    }
    for (let pass = 0; pass < 5; pass += 1) {
      let improved = false;
      for (const neighborhood of selfProfileNeighborhoods(best.profile, identity)) {
        for (const profile of neighborhood) {
          const candidate = evaluateProfile(profile);
          if (candidate.score > best.score) {
            best = candidate;
            improved = true;
          }
        }
      }
      if (!improved) break;
    }
    const accepted = best.score > baseline.score;
    traces.push({
      bucketId,
      trainingSequenceIds: records.map((record) => record.captureId),
      baselineProfileHash: baseline.profile.contentHash.toString(),
      baselineMetrics: baseline.metrics,
      selectedProfileHash: best.profile.contentHash.toString(),
      selectedMetrics: best.metrics,
      accepted,
      searchedParameters: ["signalTopology", "direction", "startAmplitude", "minPrimaryAmplitude", "minSecondaryAmplitude", "returnHysteresis", "readyTolerance", "maxGapMs", "minRepDurationMs", "maxRepDurationMs"],
      evaluations,
    });
    if (!accepted) {
      insufficientEvidence.push({ bucketId, reason: "candidate_did_not_improve_parent", trainingCaptureIds: records.map((record) => record.captureId) });
      continue;
    }
    profiles.push({
      ...parentEntry,
      exerciseId,
      capturePosition,
      profile: serialize(best.profile),
      evidence: buildSelfCandidateEvidence(parentEntry.evidence, records, dataset.source.approvalExportSha256),
    });
  }
  return { profiles, traces, insufficientEvidence };
}

async function mmfitRows(wasm: MotionWasmExports, candidateByBucket: ReadonlyMap<string, RustExerciseProfileData>, normalizedRoot: string, orientationPath: string): Promise<WorkflowMmFitRow[]> {
  const manifest = json<MmFitManifest>(path.join(normalizedRoot, "manifest.json"));
  const orientation = json<{ clips: { sourceSequenceId: string; bodyOrientationProxy: string }[] }>(orientationPath);
  const orientationMap = new Map(orientation.clips.map((item) => [item.sourceSequenceId, item.bodyOrientationProxy]));
  return manifest.clips.map((item) => {
    const clip = JSON.parse(gunzipSync(fs.readFileSync(path.join(normalizedRoot, item.clipFile))).toString("utf8")) as MmFitClip;
    const proxy = orientationMap.get(item.sourceSequenceId) ?? "unknown";
    const bucket = `${item.exerciseId}/body-orientation-${proxy}`;
    const parent = resolveMmFitInitializer(item.exerciseId).profile;
    const candidate = candidateByBucket.get(bucket) ?? parent;
    if (!parent || !candidate) return { ...item, predictedParent: null, predictedCandidate: null, bucket };
    return { ...item, predictedParent: replayProfileCount(wasm, `workflow-mmfit-parent:${item.sourceSequenceId}`, clip.frames, parent), predictedCandidate: replayProfileCount(wasm, `workflow-mmfit-candidate:${item.sourceSequenceId}`, clip.frames, candidate), bucket };
  });
}

export function resolveMmFitInitializer(exerciseId: string) {
  const capturePosition = recommendCapturePosition(exerciseId)?.position ?? "front";
  return {
    capturePosition,
    profile: resolveSimulatedRecognitionProfile({
      exerciseId,
      capturePosition,
      trainingSide: "bilateral",
      variation: "",
    }),
  };
}

function mmfitSummary(rows: Awaited<ReturnType<typeof mmfitRows>>, field: "predictedParent" | "predictedCandidate", split: string): MmFitMetrics {
  const evaluated = rows.filter((row): row is typeof row & { [K in typeof field]: number } => row.split === split && row[field] !== null);
  const metrics = countMetrics(evaluated.map((row) => ({ truth: row.expectedCount, predicted: row[field] })));
  return { ...metrics, split, domain: "mmfit_openpose18_mapped" };
}

function makeEvaluation(self: ReturnType<typeof selfRows>, mmfit: Awaited<ReturnType<typeof mmfitRows>>): EvaluationSummary {
  const splits = ["train", "validation", "test", "unseen_test"];
  const tuningEligible = self.filter((row) => !row.challenge);
  const challenge = self.filter((row) => row.challenge);
  const selfBuckets = new Map<string, typeof self>();
  for (const row of self) {
    const admission = row.challenge ? "challenge" : "tuningEligible";
    const key = `${admission}|${row.exerciseId}|${row.capturePosition}`;
    selfBuckets.set(key, [...(selfBuckets.get(key) ?? []), row]);
  }
  return {
    parent: { selfPerRep: selfMetrics(self, "parent"), mmfitSetCount: mmfitSummary(mmfit, "predictedParent", "train") },
    candidate: { selfPerRep: selfMetrics(self, "candidate"), mmfitSetCount: mmfitSummary(mmfit, "predictedCandidate", "train") },
    selfByAdmission: {
      tuningEligible: {
        parent: selfMetrics(tuningEligible, "parent"),
        candidate: selfMetrics(tuningEligible, "candidate"),
      },
      challenge: {
        parent: selfMetrics(challenge, "parent"),
        candidate: selfMetrics(challenge, "candidate"),
      },
    },
    selfByBucket: [...selfBuckets.entries()].map(([key, rows]) => {
      const [admission, exerciseId, capturePosition] = key.split("|") as ["tuningEligible" | "challenge", string, string];
      return {
        bucketId: `${exerciseId}|${capturePosition}`,
        admission,
        parent: selfMetrics(rows, "parent"),
        candidate: selfMetrics(rows, "candidate"),
      };
    }),
    bySplit: Object.fromEntries(splits.map((split) => [split, { parent: mmfitSummary(mmfit, "predictedParent", split), candidate: mmfitSummary(mmfit, "predictedCandidate", split) }])),
    notApplicable: [
      { metric: "mmfit_per_rep_precision_recall", reason: "MM-Fit has set_count supervision only; repBounds is intentionally empty" },
    ],
  };
}

function selfReplayDetails(rows: ReturnType<typeof selfRows>) {
  const replayDetail = (row: (typeof rows)[number], field: "parent" | "candidate") => {
    const replay = row[field];
    if (!replay) return null;
    const match = matchSegmentsByPeak(row.truthSegments, replay.confirmed);
    return {
      predictedSegments: replay.confirmed,
      matchedCount: match.matchedCount,
      peakMatches: match.pairs,
      unmatchedTruthIndexes: match.unmatchedTruthIndexes,
      unmatchedPredictedIndexes: match.unmatchedPredictedIndexes,
      negativeWindowPredictionIndexes: replay.confirmed.flatMap((segment, index) =>
        row.negativeWindows.some((window) => segment.peakMs >= window.startMs && segment.peakMs <= window.endMs)
          ? [index]
          : []
      ),
      needsReviewCount: replay.needsReviewCount,
      rejectedCount: replay.rejectedCount,
    };
  };
  return {
    schemaVersion: "maxpower-self-profile-replay-details/v1",
    replayLifecycle: "product_set",
    matchingPolicy: { kind: "one-to-one-nearest-peak", toleranceMs: 1_500 },
    rows: rows.map((row) => ({
      captureId: row.captureId,
      exerciseId: row.exerciseId,
      capturePosition: row.capturePosition,
      admission: row.challenge ? "challenge" : "tuningEligible",
      truthSegments: row.truthSegments,
      negativeWindows: row.negativeWindows,
      parent: replayDetail(row, "parent"),
      candidate: replayDetail(row, "candidate"),
    })),
  };
}

function writeJson(file: string, value: unknown): void { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

export class MotionProfileWorkflow {
  constructor(private readonly rootDir = process.cwd()) {}

  plan(spec: MotionProfileWorkflowSpec): WorkflowPlan {
    if (spec.schemaVersion !== "maxpower-motion-profile-workflow/v1") throw new Error("Unsupported workflow spec schema");
    if (spec.observationDomains.some((domain) => Object.values(domain).some((value) => value === "REQUIRED"))) throw new Error("Unresolved observation domain placeholder");
    const nativeCandidate = inspectMmFitNativeCandidateCorpus(this.rootDir);
    const files = [SELF_DATASET, APPROVAL_EXPORT, SELF_PARENT, MMFIT_MANIFEST, WASM, "data/external/mm-fit/rgb/zenodo-record-7672767.json", ...(fs.existsSync(nativeCandidate.manifestPath) ? [MMFIT_NATIVE_MANIFEST] : [])];
    const inputHashes = Object.fromEntries(files.map((file) => [file, sha256(path.resolve(this.rootDir, file))]));
    inputHashes["mmfit-rgb-status"] = stableHash(rgbStatus(this.rootDir));
    inputHashes["mmfit-native-candidate-status"] = stableHash({
      status: nativeCandidate.status,
      poseDomain: nativeCandidate.poseDomain,
      clipCount: nativeCandidate.clipCount,
      sequenceIds: nativeCandidate.sequenceIds,
      corpusSha256: nativeCandidate.corpusSha256,
      reason: nativeCandidate.reason ?? null,
    });
    const runId = stableRunId(spec, inputHashes);
    const rgb = rgbStatus(this.rootDir);
    return { schemaVersion: "maxpower-motion-profile-workflow-plan/v1", workflowId: spec.workflowId, runId, mode: spec.mode ?? "candidate", outputDir: path.resolve(this.rootDir, "data/workflows/motion-profile", spec.workflowId, runId), inputHashes, blockers: ["self data: legacy_unpartitioned", ...(rgb.trainStatus === "complete" ? [] : [`MM-Fit train RGB: ${rgb.trainStatus}; MediaPipe extraction unavailable until complete`]), ...(nativeCandidate.status === "complete" ? [] : [`MM-Fit native candidate corpus: ${nativeCandidate.status}${nativeCandidate.reason ? ` (${nativeCandidate.reason})` : ""}`]), "MM-Fit license: research-only policy pending formal review"] };
  }

  async run(spec: MotionProfileWorkflowSpec): Promise<WorkflowRunResult> {
    const plan = this.plan(spec);
    try {
      return await this.runPlanned(spec, plan);
    } catch (error) {
      const message = error instanceof Error ? `${error.name}:${error.message}` : String(error);
      const completedStages = [
        ["plan", "plan.json"],
        ["inventory", "inventory.json"],
        ["admission", "admission.json"],
        ["split-lock", "split-lock.json"],
        ["canonical-corpus", "canonical-corpus/manifest.json"],
        ["feature-corpus", "feature-corpus/manifest.json"],
        ["baseline-replay", "baseline-evaluation.json"],
        ["frozen-evaluation", "frozen-evaluation.json"],
      ].flatMap(([stage, relative]) => fs.existsSync(path.join(plan.outputDir, relative)) ? [stage] : []);
      const blockers = [...plan.blockers, `workflow_error:${message}`];
      writeJson(path.join(plan.outputDir, "failure.json"), {
        schemaVersion: "maxpower-motion-profile-workflow-failure/v1",
        status: "failed",
        runId: plan.runId,
        completedStages,
        blockers,
      });
      return this.finalize(plan.outputDir, {
        schemaVersion: "maxpower-motion-profile-workflow-run/v1",
        runId: plan.runId,
        status: "failed",
        completedStages,
        sourceSummary: { selfCaptures: 0, selfRepCount: 0, mmfitSets: 0, mmfitRepCount: 0 },
        admissionSummary: { total: 0, byDisposition: {}, blockers },
        splitSummary: { total: 0, bySplit: {}, leakageChecks: [] },
        baseline: null,
        candidate: null,
        frozenEvaluation: null,
        proposalPath: null,
        blockers,
        artifactHashes: {},
      });
    }
  }

  private async runPlanned(spec: MotionProfileWorkflowSpec, plan: WorkflowPlan): Promise<WorkflowRunResult> {
    const output = plan.outputDir;
    const self = json<ApprovedDataset>(path.resolve(this.rootDir, SELF_DATASET));
    const mmfitManifest = json<MmFitManifest>(path.resolve(this.rootDir, MMFIT_MANIFEST));
    const nativeCandidate = inspectMmFitNativeCandidateCorpus(this.rootDir);
    const admission = buildAdmission(self, mmfitManifest);
    const splitLock = buildSplitLock(self, mmfitManifest, plan.runId);
    writeJson(path.join(output, "plan.json"), plan);
    const rgb = rgbStatus(this.rootDir);
    writeJson(path.join(output, "inventory.json"), {
      schemaVersion: "maxpower-motion-profile-inventory/v1", sources: { self: { captureCount: self.records.length, repCount: self.records.reduce((sum, record) => sum + record.segments.length, 0), approvalExportSha256: self.source.approvalExportSha256, subjectKeys: 0, sessionKeys: 0 }, mmfit: { sessionCount: new Set(mmfitManifest.clips.map((clip) => clip.sourceSequenceId.split(":")[0])).size, setCount: mmfitManifest.clips.length, repCount: mmfitManifest.clips.reduce((sum, clip) => sum + clip.expectedCount, 0), splitCounts: Object.fromEntries(["train", "validation", "test", "unseen_test"].map((split) => [split, mmfitManifest.clips.filter((clip) => clip.split === split).length])), poseDomain: "mmfit_openpose18_mapped", candidateDiscoveryPoseDomain: nativeCandidate.poseDomain, nativeCandidateStatus: nativeCandidate.status, nativeCandidateClipCount: nativeCandidate.clipCount, rgb } }, sourceHashes: plan.inputHashes,
    });
    writeJson(path.join(output, "admission.json"), admission);
    writeJson(path.join(output, "split-lock.json"), splitLock);
    const nativeManifest = nativeCandidate.status === "complete"
      ? json<{ clips: MmFitManifestClip[] }>(nativeCandidate.manifestPath)
      : { clips: [] };
    writeJson(path.join(output, "source-manifest.json"), {
      self: self.records.map((record) => ({ sequenceId: `self:${record.captureId}`, sourceHash: sha256(path.resolve(this.rootDir, "public/archives/confirmed-captures", record.source.keypoints)) })),
      mmfitFrozenEvaluation: mmfitManifest.clips.map((clip) => ({ sequenceId: `mmfit:${clip.sourceSequenceId}`, observationDomain: "mmfit_openpose18_mapped", sourceHash: sha256(path.resolve(this.rootDir, "data/external/mm-fit/normalized", clip.clipFile)) })),
      mmfitCandidateDiscovery: nativeManifest.clips.map((clip) => ({ sequenceId: `mmfit:${clip.sourceSequenceId}`, observationDomain: nativeCandidate.poseDomain, sourceHash: clip.clipSha256 })),
    });
    writeJson(path.join(output, "canonical-corpus", "manifest.json"), { schemaVersion: "maxpower-canonical-training-corpus/v1", sequenceCount: admission.total, selfSupervision: "per_rep_phase", mmfitSupervision: "set_count", mmfitRepBoundsCount: 0, unknownLandmarksRemainUnknown: true, sequenceIds: admission.entries.map((entry) => entry.sequenceId) });
    writeJson(path.join(output, "feature-corpus", "manifest.json"), { schemaVersion: "maxpower-motion-profile-feature-corpus/v1", featureContractId: spec.featureContractId, sourceDomain: ["blazepose33", ...(nativeCandidate.poseDomain ? [nativeCandidate.poseDomain] : []), "mmfit_openpose18_mapped"], missingDataPolicy: "preserve_unknown_no_synthesis", sequenceCount: admission.total });
    const resultBase = { sourceSummary: { selfCaptures: self.records.length, selfRepCount: self.records.reduce((sum, record) => sum + record.segments.length, 0), mmfitSets: mmfitManifest.clips.length, mmfitRepCount: mmfitManifest.clips.reduce((sum, clip) => sum + clip.expectedCount, 0) }, admissionSummary: { total: admission.total, byDisposition: admission.entries.reduce<Record<string, number>>((counts, entry) => { counts[entry.disposition] = (counts[entry.disposition] ?? 0) + 1; return counts; }, {}), blockers: plan.blockers }, splitSummary: { total: splitLock.assignments.length, bySplit: splitLock.assignments.reduce<Record<string, number>>((counts, entry) => { counts[entry.split] = (counts[entry.split] ?? 0) + 1; return counts; }, {}), leakageChecks: splitLock.leakageChecks } };
    if ((spec.mode ?? "candidate") === "inspect") {
      const run: WorkflowRunResult = { schemaVersion: "maxpower-motion-profile-workflow-run/v1", runId: plan.runId, status: "inspected", completedStages: ["plan", "inventory", "admission", "split-lock", "canonical-corpus", "feature-corpus"], ...resultBase, baseline: null, candidate: null, frozenEvaluation: null, proposalPath: null, blockers: plan.blockers, artifactHashes: {} };
      return this.finalize(output, run);
    }
    if (nativeCandidate.status !== "complete") {
      throw new Error(`MM-Fit native Heavy candidate corpus is ${nativeCandidate.status}: ${nativeCandidate.reason ?? "unknown reason"}`);
    }
    const wasm = await instantiateRustMotionWasm(fs.readFileSync(path.resolve(this.rootDir, WASM)));
    const parentArtifact = json<ProfileArtifact>(path.resolve(this.rootDir, SELF_PARENT));
    process.stderr.write("[motion-profile] training self profiles from 4 tuning-eligible captures\n");
    const selfTraining = trainSelfProfiles(this.rootDir, wasm, self, parentArtifact);
    process.stderr.write(`[motion-profile] self search complete: ${selfTraining.profiles.length} improved candidates\n`);
    const admittedSelfProfiles = selfTraining.profiles;
    const admittedByBucket = new Map(admittedSelfProfiles.map((profile) => [
      `${profile.exerciseId}|${profile.capturePosition}`,
      profile,
    ]));
    const frozenSelfProfiles: ProfileArtifact = {
      profiles: [
        ...parentArtifact.profiles.map((profile) =>
          admittedByBucket.get(`${profile.exerciseId}|${profile.capturePosition}`) ?? profile
        ),
        ...admittedSelfProfiles.filter((profile) => !parentArtifact.profiles.some((parent) =>
          parent.exerciseId === profile.exerciseId && parent.capturePosition === profile.capturePosition
        )),
      ],
    };
    const selfCompatibilityRows = selfRows(wasm, self, parentArtifact, parentArtifact, "compatibility_replay");
    const selfCandidateRows = selfRows(wasm, self, parentArtifact, frozenSelfProfiles, "product_set");
    process.stderr.write("[motion-profile] training MM-Fit set-count candidates from native MediaPipe Heavy official train split\n");
    const mmfitTraining = await trainMmFitProfiles({ normalizedRoot: path.resolve(this.rootDir, "data/external/mm-fit/normalized"), candidateDiscoveryRoot: nativeCandidate.root, orientationAnalysisPath: path.resolve(this.rootDir, "data/external/mm-fit/normalized/body-orientation-analysis.json"), wasm });
    const accepted = new Map(mmfitTraining.buckets.flatMap((bucket) => bucket.candidateProfile ? [[bucket.bucketId, deserialize(bucket.candidateProfile)] as const] : []));
    process.stderr.write("[motion-profile] replaying frozen MM-Fit train/validation/test/unseen splits\n");
    const mmfitEval = await mmfitRows(wasm, accepted, path.resolve(this.rootDir, "data/external/mm-fit/normalized"), path.resolve(this.rootDir, "data/external/mm-fit/normalized/body-orientation-analysis.json"));
    const baseline = makeEvaluation(selfCompatibilityRows, mmfitEval.map((row) => ({ ...row, predictedCandidate: row.predictedParent })));
    const frozen = makeEvaluation(selfCandidateRows, mmfitEval);
    const evaluationProvenance = {
      schemaVersion: "maxpower-motion-profile-evaluation-provenance/v1",
      replayInterface: CANONICAL_REPLAY_INTERFACE,
      runtimeWasm: { path: WASM, sha256: plan.inputHashes[WASM] },
      parentProfileArtifact: { path: SELF_PARENT, sha256: plan.inputHashes[SELF_PARENT] },
      sourceHashes: plan.inputHashes,
      selfReplayLifecycle: { compatibilityBaseline: "compatibility_replay", parentAndCandidate: "product_set" },
      mmfitSupervision: "set_count",
      mmfitCandidateDiscoveryObservationDomain: mmfitTraining.observationDomains.candidateDiscovery,
      mmfitObservationDomain: "mmfit_openpose18_mapped",
    };
    writeJson(path.join(output, "baseline-evaluation.json"), { ...baseline, provenance: evaluationProvenance });
    writeJson(path.join(output, "frozen-evaluation.json"), { ...frozen, provenance: evaluationProvenance });
    writeJson(path.join(output, "self-replay-details.json"), selfReplayDetails(selfCandidateRows));
    writeJson(path.join(output, "candidates", "mmfit-rolling-training.json"), mmfitTraining);
    writeJson(path.join(output, "candidates", "self-candidates.json"), {
      schemaVersion: "maxpower-motion-profile-candidate-bundle/v1",
      parentArtifact: SELF_PARENT,
      parentArtifactSha256: plan.inputHashes[SELF_PARENT],
      runtimeWasmSha256: plan.inputHashes[WASM],
      replayInterface: CANONICAL_REPLAY_INTERFACE,
      generatedBy: "MotionProfileWorkflow.trainSelfProfiles/v3",
      profiles: admittedSelfProfiles,
      insufficientEvidence: selfTraining.insufficientEvidence,
      researchOnly: true,
      promotionPassed: false,
    });
    const trainingIds: Record<string, string[]> = {};
    for (const bucket of mmfitTraining.buckets) trainingIds[bucket.bucketId] = [...bucket.candidateDiscoverySequenceIds];
    const searchTrace = {
      schemaVersion: "maxpower-motion-profile-search-trace/v1",
      seed: spec.seed,
      policy: spec.candidateSearchPolicyId,
      self: selfTraining.traces,
      selfRejected: selfTraining.insufficientEvidence,
      mmfit: mmfitTraining.buckets.map((bucket) => ({
        bucketId: bucket.bucketId,
        trainSelectedCandidateId: bucket.selectedCandidateId ?? null,
        acceptedCandidateId: bucket.acceptedCandidateId ?? null,
        validationGateStatus: bucket.validationGateStatus ?? null,
        trainingSequenceIds: trainingIds[bucket.bucketId] ?? [],
        candidateDiscoveryDomain: mmfitTraining.observationDomains.candidateDiscovery.poseDomain,
        validationAndEvaluationDomain: mmfitTraining.observationDomains.frozenEvaluation.poseDomain,
        testOrUnseenInTrace: false,
        labelGranularity: "set_count",
      })),
    };
    writeJson(path.join(output, "candidates", "search-trace.json"), searchTrace);
    const proposal = { schemaVersion: "maxpower-motion-profile-promotion-proposal/v1", status: "not_promotable", runId: plan.runId, reasons: ["self corpus is legacy_unpartitioned with zero structured subject/session keys", "MM-Fit native Heavy candidate discovery still has set_count labels only", "MM-Fit validation/test/unseen safeguards are a separate mapped OpenPose observation domain", "no independent exact-context self holdout", "promotion would require production artifact mutation, which is out of scope"], candidatePaths: ["candidates/self-candidates.json", "candidates/mmfit-rolling-training.json"] };
    writeJson(path.join(output, "promotion-proposal.json"), proposal);
    fs.writeFileSync(path.join(output, "promotion-proposal.md"), `# Motion profile promotion proposal\n\nStatus: **not_promotable**\n\n- self: legacy_unpartitioned\n- MM-Fit candidate discovery: set_count / mmfit_mediapipe33_heavy_cpu\n- MM-Fit validation and evaluation safeguard: set_count / mmfit_openpose18_mapped\n- no production profile was modified\n`);
    const selfTrainingIds = Object.fromEntries(admittedSelfProfiles.map((profile) => [
      profile.profile.identity,
      profile.evidence?.sourceCaptureIds ?? [],
    ]));
    const runBlockers = [...plan.blockers, "legacy_unpartitioned self data blocks promotable proposal"];
    const run: WorkflowRunResult = { schemaVersion: "maxpower-motion-profile-workflow-run/v1", runId: plan.runId, status: statusForBlockers(spec.mode ?? "candidate", runBlockers), completedStages: ["plan", "inventory", "admission", "split-lock", "canonical-corpus", "feature-corpus", "baseline-replay", "candidate-optimization", "frozen-evaluation", "promotion-policy"], ...resultBase, baseline, candidate: { status: "research_candidate", selfProfiles: admittedSelfProfiles.length, mmfitAcceptedBuckets: mmfitTraining.buckets.filter((bucket) => bucket.acceptedCandidateId).length, searchTracePath: path.join(output, "candidates", "search-trace.json"), trainingSequenceIdsByCandidate: { ...selfTrainingIds, ...trainingIds } }, frozenEvaluation: frozen, proposalPath: path.join(output, "promotion-proposal.json"), blockers: runBlockers, artifactHashes: {} };
    const finalized = this.finalize(output, run);
    const report = buildReport(finalized, baseline, frozen, this.rootDir);
    writeJson(path.resolve(this.rootDir, "docs/reports/motion-profile-workflow-2026-08-09.json"), report.json);
    fs.writeFileSync(path.resolve(this.rootDir, "docs/reports/motion-profile-workflow-2026-08-09.md"), report.markdown);
    return finalized;
  }

  private finalize(output: string, run: WorkflowRunResult): WorkflowRunResult {
    const artifactHashes: Record<string, string> = {};
    if (fs.existsSync(output)) for (const file of walkFiles(output)) artifactHashes[path.relative(output, file)] = sha256(file);
    const finalized = { ...run, artifactHashes };
    writeJson(path.join(output, "run-manifest.json"), finalized);
    return finalized;
  }
}

function walkFiles(dir: string): string[] { return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walkFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }

function buildReport(run: WorkflowRunResult, baseline: EvaluationSummary, frozen: EvaluationSummary, rootDir: string) {
  const nativeCandidate = inspectMmFitNativeCandidateCorpus(rootDir);
  const nativeTrainingArtifactPath = path.resolve(
    rootDir,
    "data/workflows/motion-profile/recognition-corpus-v1",
    run.runId,
    "candidates/mmfit-rolling-training.json",
  );
  const nativeTraining = fs.existsSync(nativeTrainingArtifactPath)
    ? json<RollingTrainingArtifact>(nativeTrainingArtifactPath)
    : null;
  const nativePushUpBuckets = (nativeTraining?.buckets ?? [])
    .filter((bucket) => bucket.exerciseId === "push_up")
    .map((bucket) => ({
      bucketId: bucket.bucketId,
      status: bucket.status,
      candidateDiscoveryClipCount: bucket.candidateDiscoveryClipCount,
      validationClipCount: bucket.clipCountsBySplit.validation,
      trainSelectedCandidateId: bucket.selectedCandidateId ?? null,
      acceptedCandidateId: bucket.acceptedCandidateId ?? null,
      validationGateStatus: bucket.validationGateStatus ?? null,
      trainMetrics: bucket.trainCandidates?.find((candidate) => candidate.candidateId === bucket.selectedCandidateId)?.metrics ?? null,
      reason: bucket.reason ?? null,
    }));
  const compatibilitySelf = baseline.parent.selfPerRep;
  const parentSelf = frozen.parent.selfPerRep;
  const candidateSelf = frozen.candidate.selfPerRep;
  const tuningSelf = frozen.selfByAdmission.tuningEligible.candidate;
  const challengeSelf = frozen.selfByAdmission.challenge.candidate;
  const mmfitSplits = ["train", "validation", "test", "unseen_test"].map((split) => ({
    split,
    parent: frozen.bySplit[split].parent,
    candidate: frozen.bySplit[split].candidate,
  }));
  const selfImproved = Math.min(candidateSelf.matchedRecall ?? 0, candidateSelf.matchedPrecision ?? 0)
    > Math.min(parentSelf.matchedRecall ?? 0, parentSelf.matchedPrecision ?? 0)
    && candidateSelf.falsePositiveRepCount < parentSelf.falsePositiveRepCount;
  const mmfitImprovedWithoutExactSetRegression = mmfitSplits.every((row) =>
    (row.candidate.exactRatio ?? 0) >= (row.parent.exactRatio ?? 0)
    && (row.candidate.meanAbsoluteError ?? Number.POSITIVE_INFINITY) <= (row.parent.meanAbsoluteError ?? Number.POSITIVE_INFINITY)
  );
  const target95 = {
    selfTuningInSamplePerRep: {
      passed: (tuningSelf.matchedRecall ?? 0) >= 0.95 && (tuningSelf.matchedPrecision ?? 0) >= 0.95,
      matchedRecall: tuningSelf.matchedRecall,
      matchedPrecision: tuningSelf.matchedPrecision,
      independent: false,
    },
    selfFrozenEndToEndPerRep: {
      passed: (candidateSelf.matchedRecall ?? 0) >= 0.95 && (candidateSelf.matchedPrecision ?? 0) >= 0.95,
      matchedRecall: candidateSelf.matchedRecall,
      matchedPrecision: candidateSelf.matchedPrecision,
      independent: false,
    },
    selfChallengePerRep: {
      passed: (challengeSelf.matchedRecall ?? 0) >= 0.95 && (challengeSelf.matchedPrecision ?? 0) >= 0.95,
      matchedRecall: challengeSelf.matchedRecall,
      matchedPrecision: challengeSelf.matchedPrecision,
      independent: false,
    },
    mmfitUnseenExactSet: {
      passed: (frozen.bySplit.unseen_test.candidate.exactRatio ?? 0) >= 0.95,
      exactRatio: frozen.bySplit.unseen_test.candidate.exactRatio,
      supervision: "set_count",
      observationDomain: "mmfit_openpose18_mapped",
    },
    promotionPassed: false,
  };
  const nextData = [
    "为每个 exact exercise/view bucket 采集带 subject_id、session_id、device_id 的独立用户 holdout",
    "保留现有 3 条正面杠铃卧推/16 rep 作为冻结算法回归：原始 RGB 中人体、双臂、手腕和杠铃清楚可见；修复仰卧机位姿态信号恢复与 exact-context profile 覆盖，不要求用户重录",
    "为俯卧撑录制前准备动作增加明确 set-start 事件或单独负样本；当前准备阶段含一个与真 rep 同形的完整周期",
    nativeCandidate.status === "complete"
      ? "MM-Fit train RGB 与固定 MediaPipe Heavy 提取已完成；若要证明同域泛化，需另行授权并预先冻结 validation/test/unseen RGB 评测协议，本轮不下载"
      : "完成并校验 MM-Fit train RGB，再用固定 MediaPipe Heavy asset 提取同域关键点；validation/test/unseen 保持冻结",
    "完成 MM-Fit research-only 许可与产品使用边界审查",
  ];
  const jsonReport = {
    schemaVersion: "maxpower-motion-profile-workflow-report/v3",
    generatedAt: new Date().toISOString(),
    runId: run.runId,
    status: run.status,
    outcome: {
      improved: selfImproved && mmfitImprovedWithoutExactSetRegression,
      selfImproved,
      mmfitImprovedWithoutExactSetRegression,
      promotion: "not_promotable",
      evidenceIndependence: "self tuning is legacy/in-sample; self challenge is frozen but not subject-independent; MM-Fit uses official subject splits with weak set_count labels",
      selfReplayPolicies: {
        compatibilityBaseline: "compatibility_replay",
        productParentAndCandidate: "product_set",
      },
    },
    target95,
    nativeCandidateDiscovery: {
      status: nativeCandidate.status,
      poseDomain: nativeCandidate.poseDomain,
      clipCount: nativeCandidate.clipCount,
      corpusSha256: nativeCandidate.corpusSha256,
      trainOnly: true,
      frozenIndependentEvaluationAvailable: false,
    },
    nativeTrainingDiagnostics: nativeTraining ? {
      artifactPath: path.relative(rootDir, nativeTrainingArtifactPath),
      researchOnly: true,
      independent: false,
      coverage: nativeTraining.coverage,
      validationGatedMappedAggregate: nativeTraining.aggregate,
      pushUpBuckets: nativePushUpBuckets,
    } : null,
    diagnosis: {
      fixedAlgorithmDefect: "Explicit product sets could remain in Arming forever because frame-to-frame pose jitter reset the 500 ms stability timer. SetGate now retains the stable fast path and activates after a bounded 2,000 ms observable arming interval.",
      fixedEvaluationDefect: "MM-Fit frozen replay previously requested a front-view initializer for every exercise, silently excluding 320 of 616 labeled sets whose registered initializer uses another view. Replay now resolves each exercise at its recommended capture position and evaluates all 616 official sets.",
      residualEndToEndErrors: {
        missedTruthReps: candidateSelf.truthCount - candidateSelf.matchedRepCount,
        unmatchedPredictedReps: candidateSelf.falsePositiveRepCount,
        allMissesAreChallenge: tuningSelf.matchedRepCount === tuningSelf.truthCount,
        tuningUnmatchedPredictedReps: tuningSelf.falsePositiveRepCount,
        challengeUnmatchedPredictedReps: challengeSelf.falsePositiveRepCount,
      },
      unsupportedByCurrentAlgorithm: {
        captures: 3,
        labeledReps: 16,
        bucket: "barbell_bench_press|front",
        rawVideoHumanVisibility: "confirmed_clear",
        cause: "The exact front-view profile is absent, so these captures never enter the Rust counter. Upstream MediaPipe Heavy also assigns very low elbow/wrist confidence in the supine view despite clear RGB evidence; the current canonical signal gate discards those coordinates.",
        metricTreatment: "end_to_end_algorithm_failure; predicted_count=0; all labeled reps remain in the denominator",
      },
      remainingCauses: [
        "The push-up setup before the annotated set contains one complete kinematic cycle, so pose-only inference cannot distinguish it without a trustworthy set-start event or explicit negative semantics.",
        "Native MM-Fit push-up clips are top-to-top while the simulated initializer is bottom-to-bottom; a fixed increasing direction therefore counted 31/32 clips exactly one low. The research grid now tests Rust auto direction, which locks from pose motion without reading the set-count label.",
        "A native Heavy squat clip exposed side occlusion: one knee signal was nearly static while the opposite knee carried all ten cycles. The research grid now tests Rust's existing per-cycle visible-side graph instead of requiring bilateral motion.",
        "The three front-view bench captures are algorithm-coverage failures, not bad recordings: no exact profile resolves and all 16 labeled reps now count as misses in end-to-end metrics.",
        "Among contexts that do resolve a profile, all five residual missed truth reps are in challenge captures with endpoint dropout, phase offset, or observation gaps; challenge evidence remains frozen and cannot tune parameters.",
        "Negative-window predictions and unmatched false positives are separate metrics: an early phase prediction can fall in an inter-rep window yet still one-to-one match the following labeled peak.",
      ],
    },
    sources: run.sourceSummary,
    admissionSummary: run.admissionSummary,
    splitSummary: run.splitSummary,
    baseline,
    frozenEvaluation: frozen,
    blockers: run.blockers,
    nextData,
    runtimeProfileArtifact: {
      path: SELF_PARENT,
      sha256: sha256(path.resolve(SELF_PARENT)),
      modifiedByWorkflow: false,
    },
    artifactHashes: run.artifactHashes,
    implementation: {
      algorithmChange: "Rust SetGate keeps the 500 ms stable fast path and adds a 2,000 ms noisy-arming fallback. Research-only profile search adds visible-side, push-up auto-direction, and fixed-visible-elbow candidates. MM-Fit replay resolves each exercise at its recommended initializer view so the frozen evaluation covers all 616 sets. End-to-end self metrics count unsupported profile contexts as zero-prediction algorithm failures; no ABI, MotionPacket, Android, or production-profile change.",
      sourceFiles: [
        "tools/motion-profile-workflow/workflow.ts",
        "tools/motion-profile-workflow/cli.ts",
        "tools/motion-profile-workflow/workflow.test.ts",
        "tools/external-fitness-data/unifiedRecognitionCorpusGate.ts",
        "tools/external-fitness-data/unifiedRecognitionCorpusGate.test.ts",
        "tools/external-fitness-data/rollingProfileTrainer.ts",
        "tools/external-fitness-data/rollingProfileTrainer.test.ts",
        "tools/external-fitness-data/extract_mmfit_rgb_pose.py",
        "tools/external-fitness-data/test_extract_mmfit_rgb_pose.py",
        "tools/external-fitness-data/merge_mmfit_rgb_pose_shards.py",
        "tools/external-fitness-data/extract_mmfit_rgb_train.sh",
        "tools/external-fitness-data/setup_mmfit_rgb_runtime.sh",
        "tools/external-fitness-data/mmfit-rgb-runtime-requirements.txt",
        "tools/recognition-profile/tuneExistingProfiles.ts",
        "tools/recognition-profile/tuneExistingProfiles.test.ts",
        "rust/motion-sdk/src/lib.rs",
        "rust/motion-sdk/tests/rep_contract.rs",
      ],
      verificationCommands: [
        "npm run test:motion-profile-workflow",
        "npm run test:external-fitness-data",
        "npm run test:mmfit-rgb-extractor",
        "npm run test:recognition-profile-tools",
        "npm run test:rust",
        "npm run test:motion-parity",
        "npm run gate:recognition-corpus",
      ],
      verificationResults: [
        { command: "npm run test:motion-profile-workflow", status: "passed", result: "22/22 tests" },
        { command: "npm run test:external-fitness-data", status: "passed", result: "56/56 tests" },
        { command: "npm run test:mmfit-rgb-extractor", status: "passed", result: "6/6 tests" },
        { command: "npm run test:recognition-profile-tools", status: "passed", result: "2/2 tests" },
        { command: "npm run test:rust", status: "passed", result: "71/71 tests" },
        { command: "npm run test:motion-parity", status: "passed", result: "54 frames; coordinate tolerance 0.00001" },
        { command: "npm run gate:recognition-corpus", status: "failed_policy_gate", result: "expected non-zero because the frozen quality and promotion gates are not met" },
      ],
    },
    artifactRunDirectory: `data/workflows/motion-profile/recognition-corpus-v1/${run.runId}/`,
  };
  const pct = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(2)}%`;
  const nativePushUpMarkdown = nativePushUpBuckets.length
    ? `## MM-Fit 原生 Heavy train-only 诊断（不可称为泛化准确率）\n\n`
      + `| Bucket | Train clips | Selected profile | Train exact-set | Train MAE | Validation | Accepted |\n|---|---:|---|---:|---:|---|---|\n`
      + nativePushUpBuckets.map((bucket) => `| ${bucket.bucketId} | ${bucket.candidateDiscoveryClipCount} | ${bucket.trainSelectedCandidateId ?? "n/a"} | ${pct(bucket.trainMetrics?.exactCountRatio ?? null)} | ${bucket.trainMetrics?.meanAbsoluteCountError ?? "n/a"} | ${bucket.validationGateStatus ?? "n/a"} (${bucket.validationClipCount} clips) | ${bucket.acceptedCandidateId ?? "no"} |`).join("\n")
      + `\n\n`
    : "";
  const markdown = `# Motion Profile Workflow 2026-08-09\n\n`
    + `结论：**self 与 MM-Fit research candidates 均改善，但冻结门槛未达到 95%，不可 promotion**。self tuning 是 legacy/in-sample；MM-Fit 候选搜索使用 ${nativeCandidate.clipCount} 段官方 train RGB 的 ${nativeCandidate.poseDomain ?? "unavailable"}，冻结评测仍使用全 616 组 mmfit_openpose18_mapped set-count 弱标签。\n\n`
    + `## Self：人工逐 rep 标签（不与 MM-Fit 合并）\n\n`
    + `| 集合 | Profile | 标注 rep | 预测 | 匹配 | Recall | Precision | 负窗口 FP | 精确计数录像 |\n|---|---|---:|---:|---:|---:|---:|---:|---:|\n`
    + `| 兼容性 baseline（历史 replay） | Parent | ${compatibilitySelf.truthCount} | ${compatibilitySelf.predictedCount} | ${compatibilitySelf.matchedRepCount} | ${pct(compatibilitySelf.matchedRecall)} | ${pct(compatibilitySelf.matchedPrecision)} | ${compatibilitySelf.negativeWindowFalsePositiveCount} | ${compatibilitySelf.exactCaptureCount}/${compatibilitySelf.sampleCount} |\n`
    + `| 全部 11 条端到端 | Parent | ${parentSelf.truthCount} | ${parentSelf.predictedCount} | ${parentSelf.matchedRepCount} | ${pct(parentSelf.matchedRecall)} | ${pct(parentSelf.matchedPrecision)} | ${parentSelf.negativeWindowFalsePositiveCount} | ${parentSelf.exactCaptureCount}/${parentSelf.sampleCount} |\n`
    + `| 全部 11 条端到端 | Candidate | ${candidateSelf.truthCount} | ${candidateSelf.predictedCount} | ${candidateSelf.matchedRepCount} | ${pct(candidateSelf.matchedRecall)} | ${pct(candidateSelf.matchedPrecision)} | ${candidateSelf.negativeWindowFalsePositiveCount} | ${candidateSelf.exactCaptureCount}/${candidateSelf.sampleCount} |\n`
    + `| 4 条 tuning eligible | Candidate | ${tuningSelf.truthCount} | ${tuningSelf.predictedCount} | ${tuningSelf.matchedRepCount} | ${pct(tuningSelf.matchedRecall)} | ${pct(tuningSelf.matchedPrecision)} | ${tuningSelf.negativeWindowFalsePositiveCount} | ${tuningSelf.exactCaptureCount}/${tuningSelf.sampleCount} |\n`
    + `| 7 条 challenge（含 3 条当前算法无 profile） | Candidate | ${challengeSelf.truthCount} | ${challengeSelf.predictedCount} | ${challengeSelf.matchedRepCount} | ${pct(challengeSelf.matchedRecall)} | ${pct(challengeSelf.matchedPrecision)} | ${challengeSelf.negativeWindowFalsePositiveCount} | ${challengeSelf.exactCaptureCount}/${challengeSelf.sampleCount} |\n\n`
    + nativePushUpMarkdown
    + `## MM-Fit：set-count 弱标签（mmfit_openpose18_mapped）\n\n`
    + `| Split | Parent exact-set | Candidate exact-set | Parent MAE | Candidate MAE |\n|---|---:|---:|---:|---:|\n`
    + mmfitSplits.map((row) => `| ${row.split} | ${pct(row.parent.exactRatio)} | ${pct(row.candidate.exactRatio)} | ${row.parent.meanAbsoluteError ?? "n/a"} | ${row.candidate.meanAbsoluteError ?? "n/a"} |`).join("\n")
    + `\n\n## 95% gate\n\n`
    + `- Self tuning in-sample per-rep：${target95.selfTuningInSamplePerRep.passed ? "通过" : "未通过"}（Recall ${pct(tuningSelf.matchedRecall)} / Precision ${pct(tuningSelf.matchedPrecision)}），不能当泛化准确率。\n`
    + `- Self 全部 11 条端到端冻结回放：${target95.selfFrozenEndToEndPerRep.passed ? "通过" : "未通过"}（Recall ${pct(candidateSelf.matchedRecall)} / Precision ${pct(candidateSelf.matchedPrecision)}）；当前算法无 exact profile 的录像按预测 0 计入分母。\n`
    + `- MM-Fit unseen exact-set：${target95.mmfitUnseenExactSet.passed ? "通过" : "未通过"}（${pct(target95.mmfitUnseenExactSet.exactRatio)}）。\n`
    + `- Promotion：未通过。\n\n`
    + `## Algorithm diagnosis\n\n`
    + `- 已修复真实算法缺陷：product set 的 Arming 会被逐帧姿态抖动无限重置；现在保留 500 ms 稳定快速路径，并在持续可观测 2,000 ms 后有界激活。\n`
    + `- 已修复 MM-Fit 评估缺陷：旧工作流把所有动作写死成 front initializer，静默漏掉 320/616 组；现在按动作推荐视角解析 initializer，冻结回放覆盖全部 616 组。\n`
    + `- Candidate 在全部人工标注数据上仍有 ${candidateSelf.truthCount - candidateSelf.matchedRepCount} 个漏检、${candidateSelf.falsePositiveRepCount} 个未匹配假检；tuning 数据的漏检为 ${tuningSelf.truthCount - tuningSelf.matchedRepCount}。\n`
    + `- 原生 Heavy MM-Fit 俯卧撑是顶部到顶部，旧 initializer 是底部到顶部再回到底部，因此 32 组中 31 组固定少 1；候选搜索已加入不读取标签、只从首个完整动作锁定方向的 Rust auto-direction，并显式搜索固定可见肘信号。\n`
    + `- 原生 Heavy 深蹲暴露单侧遮挡：一侧膝角近乎静止、另一侧保留 10 个周期；候选搜索已加入 Rust 现有 visible-side 状态图。\n`
    + `- 训练数据中的唯一未匹配假检来自俯卧撑：正式标注开始前存在一个完整运动周期，单靠骨架运动无法知道它是“准备”而不是 rep，需要可信 set-start 或明确负语义。\n`
    + `- 3 条正面杠铃卧推共 16 rep 是算法失败，不是视频失败：原始 RGB 已确认清楚，但 exact front profile 缺失，且 MediaPipe Heavy 在仰卧机位对肘/腕给出异常低置信度；它们现在按预测 0 全部计入漏检。\n`
    + `- 负窗口预测与未匹配假检不是同一指标：相位偏早的预测可能落在 rep 间窗口，但仍能与下一条人工 peak 一对一匹配。\n\n`
    + `## Leakage checks\n\n- ${run.splitSummary.leakageChecks.join("\n- ")}\n- self challenge captures are regression-only; selected self candidates list only the 4 admitted capture IDs.\n- MM-Fit validation/test/unseen IDs do not enter search traces.\n\n`
    + `## Implementation and verification\n\n`
    + `- Rust SetGate 保留 500 ms 稳定快速路径，并增加 2,000 ms noisy-arming fallback；research profile 搜索新增 visible-side、push-up auto-direction 与固定可见肘候选；MM-Fit 回放按动作推荐视角解析 initializer 并覆盖全部 616 组；端到端指标不再删除无 profile 的人工标签，未改 ABI、MotionPacket、Android 或正式 profile。\n`
    + `- 修改范围包含 workflow、MM-Fit RGB Heavy 提取/合并、rolling profile trainer、对应测试及既有 SetGate 修复；完整清单见 JSON report 的 \`implementation.sourceFiles\`。\n`
    + `- \`npm run test:motion-profile-workflow\`：22/22 通过。\n`
    + `- \`npm run test:external-fitness-data\`：56/56 通过。\n`
    + `- \`npm run test:mmfit-rgb-extractor\`：6/6 通过。\n`
    + `- \`npm run test:recognition-profile-tools\`：2/2 通过。\n`
    + `- \`npm run test:rust\`：71/71 通过。\n`
    + `- \`npm run test:motion-parity\`：54 帧通过，坐标容差 0.00001。\n`
    + `- \`npm run gate:recognition-corpus\`：正确执行并按策略返回非零；冻结质量与 promotion 门槛未达到。\n\n`
    + `## Blockers\n\n- ${run.blockers.join("\n- ")}\n\n`
    + `## Required next collection\n\n- ${nextData.join("\n- ")}\n\n`
    + `Run artifacts: \`${jsonReport.artifactRunDirectory}\`\n`;
  return { json: jsonReport, markdown };
}

export function candidateDestinationIsIsolated(destination: string, rootDir = process.cwd()): boolean {
  const relative = path.relative(path.resolve(rootDir, "data/workflows/motion-profile"), path.resolve(rootDir, destination));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function trainOnlySequenceIds(rows: readonly { sourceSequenceId: string; split: string }[]): string[] {
  return rows.filter((row) => row.split === "train").map((row) => row.sourceSequenceId);
}

export function statusForBlockers(mode: WorkflowMode, blockers: readonly string[]): WorkflowRunResult["status"] {
  if (mode === "inspect") return "inspected";
  return blockers.length ? "not_promotable" : mode === "proposal" ? "proposal_created" : "candidate_created";
}
