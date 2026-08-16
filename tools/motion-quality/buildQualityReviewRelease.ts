import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import {
  loadInputCatalog,
  pinInputBytes,
  type InputAssetPin,
} from "./runnerInputs";

interface GoldenRecord {
  readonly captureId: string;
  readonly sourceCaptureId?: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly expectedCount?: number;
  readonly evaluationWindow?: Readonly<{ startMs: number; endMs: number }>;
  readonly segments?: readonly Readonly<{ startMs: number; peakMs?: number; endMs: number }>[];
  readonly source?: Readonly<{ video?: string; durationMs?: number }>;
}

interface ReviewEvidenceFrame {
  readonly timestampMs: number;
  readonly landmarks: readonly Readonly<Record<string, unknown>>[];
  readonly equipment?: readonly Readonly<Record<string, unknown>>[];
  readonly localMotionCoordinate?: Readonly<Record<string, unknown>> | null;
  readonly inputPose?: Readonly<{
    readonly source: "rtmpose_halpe26_input";
    readonly landmarks: readonly Readonly<Record<string, unknown>>[];
  }> | null;
  readonly inputEquipmentAxes?: readonly Readonly<Record<string, unknown>>[];
}

type ReviewCapability =
  | "quality_supported"
  | "phase_supported"
  | "observation_only"
  | "unsupported";

interface FullContext {
  readonly captureId: string;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: ReviewCapability;
  readonly qualityProposals: readonly Readonly<Record<string, unknown>>[];
  readonly reviewProposal: Readonly<{
    schemaVersion: string;
    proposalHash: string;
    lineage: Readonly<Record<string, unknown>>;
    reps: readonly Readonly<Record<string, unknown>>[];
  }>;
  readonly currentRustEvidence: Readonly<{
    schemaVersion: "maxpower-current-rust-context-evidence/v1";
    packetSchema: string;
    producer: "current_rust_single_pass";
    evidenceHash: string;
    frames: readonly ReviewEvidenceFrame[];
  }>;
}

interface FullDataRun {
  readonly schemaVersion: "maxpower-motion-quality-rust-full-data-proposals/v1";
  readonly runId: string;
  readonly runKind: "full_data_proposal";
  readonly frozen: true;
  readonly acceptanceEligible: false;
  readonly frozenDigest: string;
  readonly runtime: Readonly<{
    visualInferenceRuntime: "offline_python_onnx_reference_only";
    pythonVisionUsed: true;
    clientVisualAcceptanceEligible: false;
    [key: string]: unknown;
  }>;
  readonly limitations: readonly string[];
  readonly reproducibility: Readonly<Record<string, unknown>>;
  readonly sources: readonly Readonly<{
    sourceCaptureId: string;
    sourceVideoSha256: string;
    videoRef: string | null;
    contexts: readonly FullContext[];
  }>[];
}

interface FrozenEvaluationContext extends Readonly<Record<string, unknown>> {
  readonly sourceCaptureId: string;
  readonly contextId: string;
}

interface FrozenEvaluationRun extends Readonly<Record<string, unknown>> {
  readonly schemaVersion:
    | "maxpower-motion-quality-frozen-predictions/v1"
    | "maxpower-motion-quality-touched-benchmark-predictions/v1";
  readonly state: "frozen_before_truth";
  readonly runId: string;
  readonly runKind: string;
  readonly contexts: readonly FrozenEvaluationContext[];
  readonly frozenDigest: string;
}

export interface QualityReviewReleaseInput {
  readonly releaseId: string;
  readonly frozenAt: string;
  readonly fullDataRun: FullDataRun;
  readonly frozenEvaluationRun: FrozenEvaluationRun;
  readonly records: readonly GoldenRecord[];
  readonly inputAssets?: readonly InputAssetPin[];
}

export function assembleQualityReviewRelease(input: QualityReviewReleaseInput) {
  assertFullDataRun(input.fullDataRun);
  assertFrozenEvaluationRun(input.frozenEvaluationRun);
  const benchmarkContexts = new Map(input.frozenEvaluationRun.contexts.map((context) => [
    `${context.sourceCaptureId}\u0000${context.contextId}`,
    context,
  ]));
  const records = new Map(input.records.map((record) => [record.captureId, record]));
  if (records.size !== input.records.length) throw new Error("review truth contains duplicate context ids");
  const items = input.fullDataRun.sources.flatMap((source) => source.contexts.map((context) => {
    const capability = requireReviewCapability(context.capability, context.captureId);
    assertContextRustProposalIntegrity(context);
    const record = records.get(context.captureId);
    if (!record) throw new Error(`${context.captureId}: review truth/context record missing`);
    const sourceCaptureId = record.sourceCaptureId ?? record.captureId;
    if (sourceCaptureId !== source.sourceCaptureId) {
      throw new Error(`${context.captureId}: source identity mismatch`);
    }
    const from = record.evaluationWindow?.startMs ?? 0;
    const until = record.evaluationWindow?.endMs ?? record.source?.durationMs ?? Number.MAX_SAFE_INTEGER;
    const { evidenceHash: sourceEvidenceHash, ...evidenceSemantic } = context.currentRustEvidence;
    if (context.currentRustEvidence.producer !== "current_rust_single_pass"
        || sha256(stableStringify(evidenceSemantic)) !== sourceEvidenceHash) {
      throw new Error(`${context.captureId}: current Rust evidence hash mismatch`);
    }
    const frames = context.currentRustEvidence.frames
      .filter((frame) => frame.timestampMs >= from && frame.timestampMs <= until);
    const equipmentPoints = frames.flatMap((frame) => (frame.equipment ?? []).flatMap((raw) => {
      const axis = (raw.axis ?? raw) as Record<string, unknown>;
      const x1 = Number(axis.x1);
      const x2 = Number(axis.x2);
      const y1 = Number(axis.y1);
      const y2 = Number(axis.y2);
      if ([x1, x2, y1, y2].every(Number.isFinite)) {
        return [{ timestampMs: frame.timestampMs, x: (x1 + x2) / 2, y: (y1 + y2) / 2 }];
      }
      const centerX = Number(raw.centerX);
      const centerY = Number(raw.centerY);
      return Number.isFinite(centerX) && Number.isFinite(centerY)
        ? [{ timestampMs: frame.timestampMs, x: centerX, y: centerY }]
        : [];
    }));
    const reviewEvidenceSemantic = {
      maximumOverlayAgeMs: 150,
      source: "current_rust_single_pass" as const,
      lineage: { sourceEvidenceHash },
      frames,
      equipmentTrajectories: equipmentPoints.length
        ? [{ kind: "external_load_center", points: equipmentPoints }]
        : [],
    };
    return deepFreeze({
      itemId: context.captureId,
      captureId: context.captureId,
      title: `${context.actionId} · ${context.capturePosition}`,
      capability,
      context: {
        action: context.actionId,
        view: context.capturePosition,
      },
      videoPath: record.source?.video ?? source.videoRef,
      videoSha256: requireSha256(source.sourceVideoSha256, `${context.captureId}: source video`),
      durationMs: record.source?.durationMs ?? until,
      humanSegments: (record.segments ?? []).map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
      })),
      expectedCount: record.expectedCount ?? null,
      evidence: {
        ...reviewEvidenceSemantic,
        evidenceHash: sha256(stableStringify(reviewEvidenceSemantic)),
      },
      evidenceLinks: {
        calibrationContextId: context.captureId,
        benchmarkContextId: benchmarkContexts.has(`${source.sourceCaptureId}\u0000${context.captureId}`)
          ? context.captureId
          : null,
      },
      proposal: context.reviewProposal,
    });
  }));
  const itemIds = new Set(items.map((item) => item.itemId));
  if (items.length !== input.records.length
      || itemIds.size !== items.length
      || [...records.keys()].some((captureId) => !itemIds.has(captureId))) {
    throw new Error("full-data review contexts do not exactly cover the human record inventory");
  }
  const semantic = {
    schemaVersion: "maxpower-motion-quality-review-release/v1" as const,
    releaseId: input.releaseId,
    frozenAt: input.frozenAt,
    runKind: "full_data_proposal" as const,
    sourceRunId: input.fullDataRun.runId,
    sourceFrozenDigest: input.fullDataRun.frozenDigest,
    visualObservationProvenance: cloneJson(input.fullDataRun.runtime),
    limitations: cloneJson(input.fullDataRun.limitations),
    defaultReviewer: { reviewerId: "owner", reviewerRole: "owner_observation" },
    inventory: {
      uniqueVideoCount: new Set(input.records.map((record) => record.sourceCaptureId ?? record.captureId)).size,
      exactContextCount: input.records.length,
      humanIntervalCount: input.records.reduce((sum, record) => sum + (record.segments?.length ?? 0), 0),
      expectedRepCount: input.records.reduce((sum, record) => sum + (record.expectedCount ?? 0), 0),
    },
    boundaries: {
      acceptanceEligible: false,
      purpose: "manual_review_of_rust_full_data_proposals",
      automaticTraining: false,
      profileMutation: false,
      productionPromotion: false,
      aggregateStandardnessScore: "forbidden",
    },
    evidenceRuns: {
      benchmark: {
        runKind: input.frozenEvaluationRun.runKind,
        acceptanceEligible: false,
        truthStatus: "withheld_from_inference",
        disclosure: input.frozenEvaluationRun.runKind === "blind_evaluation"
          ? "frozen_before_truth_but_not_claimed_as_pristine_until_governance_confirms"
          : "parameters_or_data_were_previously_inspected; calibration_only",
        frozenPredictions: cloneJson(input.frozenEvaluationRun),
      },
      calibration: {
        runKind: "full_data_proposal",
        acceptanceEligible: false,
        sourceRunId: input.fullDataRun.runId,
        sourceFrozenDigest: input.fullDataRun.frozenDigest,
        visualObservationProvenance: cloneJson(input.fullDataRun.runtime),
      },
    },
    reproducibility: {
      inputAssets: input.inputAssets ?? [],
      sourceRunReproducibility: (input.fullDataRun as unknown as Record<string, unknown>).reproducibility ?? null,
    },
    items,
  };
  return deepFreeze({
    ...semantic,
    releaseHash: `sha256:${sha256(stableStringify(semantic))}`,
  });
}

function requireReviewCapability(value: unknown, captureId: string): ReviewCapability {
  if (value !== "quality_supported"
      && value !== "phase_supported"
      && value !== "observation_only"
      && value !== "unsupported") {
    throw new Error(`${captureId}: invalid review capability`);
  }
  return value;
}

const RUST_PROPOSAL_KEYS = Object.freeze([
  "schemaVersion",
  "proposalId",
  "repId",
  "actionId",
  "capturePosition",
  "anatomicalSide",
  "equipmentRole",
  "capability",
  "ruleBundleVersion",
  "profileIdentity",
  "profileHash",
  "canonicalSliceHash",
  "endpoints",
  "conclusions",
  "contentHash",
].sort());

function assertContextRustProposalIntegrity(context: FullContext): void {
  const { proposalHash, ...reviewSemantic } = context.reviewProposal;
  if (!/^[a-f0-9]{64}$/u.test(proposalHash)
      || sha256(stableStringify(reviewSemantic)) !== proposalHash) {
    throw new Error(`${context.captureId}: review proposal hash mismatch`);
  }
  const lineage = requireRecord(
    context.reviewProposal.lineage,
    `${context.captureId}: review proposal lineage`,
  );
  if (lineage.capability !== context.capability) {
    throw new Error(`${context.captureId}: review lineage capability mismatch`);
  }
  if (lineage.visualInput !== "offline_python_onnx_reference_observations") {
    throw new Error(`${context.captureId}: review visual provenance mismatch`);
  }
  const reviewReps = new Map<string, Readonly<Record<string, unknown>>>();
  for (const raw of context.reviewProposal.reps) {
    const rep = requireRecord(raw, `${context.captureId}: review rep`);
    const proposalId = requireString(
      rep.rustProposalId,
      `${context.captureId}: review Rust proposal id`,
    );
    if (reviewReps.has(proposalId)) {
      throw new Error(`${context.captureId}: duplicate review Rust proposal id`);
    }
    reviewReps.set(proposalId, rep);
  }
  if (reviewReps.size !== context.qualityProposals.length) {
    throw new Error(`${context.captureId}: Rust proposal count mismatch`);
  }
  for (const raw of context.qualityProposals) {
    const proposal = requireRecord(raw, `${context.captureId}: Rust proposal`);
    const keys = Object.keys(proposal).sort();
    if (keys.length !== RUST_PROPOSAL_KEYS.length
        || keys.some((key, index) => key !== RUST_PROPOSAL_KEYS[index])) {
      throw new Error(`${context.captureId}: Rust proposal contains non-canonical fields`);
    }
    const proposalId = requireString(
      proposal.proposalId,
      `${context.captureId}: Rust proposal id`,
    );
    const contentHash = requireString(
      proposal.contentHash,
      `${context.captureId}: Rust proposal content hash`,
    );
    if (!/^[a-f0-9]{16}$/u.test(contentHash)) {
      throw new Error(`${context.captureId}: invalid Rust proposal content hash`);
    }
    if (computeRustQualityProposalContentHash(proposal) !== contentHash) {
      throw new Error(`${context.captureId}: Rust proposal content hash mismatch`);
    }
    const rustCapability = requireReviewCapability(proposal.capability, context.captureId);
    const reviewRep = reviewReps.get(proposalId);
    if (!reviewRep
        || reviewRep.rustContentHash !== contentHash
        || reviewRep.rustCapability !== rustCapability
        || reviewRep.rustProposalDigest !== sha256(stableStringify(proposal))) {
      throw new Error(`${context.captureId}: Rust proposal content mismatch`);
    }
  }
}

export function computeRustQualityProposalContentHash(
  raw: Readonly<Record<string, unknown>>,
): string {
  const proposal = requireRecord(raw, "Rust quality proposal");
  const canonical = {
    schemaVersion: proposal.schemaVersion,
    proposalId: proposal.proposalId,
    repId: proposal.repId,
    actionId: proposal.actionId,
    capturePosition: proposal.capturePosition,
    anatomicalSide: proposal.anatomicalSide,
    equipmentRole: proposal.equipmentRole,
    capability: proposal.capability,
    ruleBundleVersion: proposal.ruleBundleVersion,
    profileIdentity: proposal.profileIdentity,
    profileHash: proposal.profileHash,
    canonicalSliceHash: proposal.canonicalSliceHash,
    endpoints: requireArray(proposal.endpoints, "Rust quality proposal endpoints").map((rawEndpoint) => {
      const endpoint = requireRecord(rawEndpoint, "Rust quality proposal endpoint");
      return {
        kind: endpoint.kind,
        occurredFrameId: endpoint.occurredFrameId,
        occurredTimestampMs: endpoint.occurredTimestampMs,
        causalConfirmedTimestampMs: endpoint.causalConfirmedTimestampMs,
        phaseBefore: endpoint.phaseBefore,
        phaseAfter: endpoint.phaseAfter,
        confidence: endpoint.confidence,
        evidenceChannels: endpoint.evidenceChannels,
        ...(endpoint.normalizedFeatures == null
          ? {}
          : { normalizedFeatures: canonicalLocalMotionCoordinate(endpoint.normalizedFeatures) }),
      };
    }),
    conclusions: requireArray(
      proposal.conclusions,
      "Rust quality proposal conclusions",
    ).map((rawConclusion) => {
      const conclusion = requireRecord(rawConclusion, "Rust quality proposal conclusion");
      return {
        conclusionId: conclusion.conclusionId,
        dimension: conclusion.dimension,
        state: conclusion.state,
        summary: conclusion.summary,
        evidence: conclusion.evidence,
        reason: conclusion.reason,
        confidence: conclusion.confidence,
      };
    }),
    contentHash: "",
  };
  let hash = 0xcbf2_9ce4_8422_2325n;
  const rustJson = rustQualityJson(canonical);
  for (const byte of Buffer.from(rustJson, "utf8")) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x0000_0100_0000_01b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function canonicalLocalMotionCoordinate(raw: unknown): Readonly<Record<string, unknown>> {
  const value = requireRecord(raw, "Rust endpoint normalized features");
  // Keep this in the Rust struct's serde field order. The Web decoder exposes
  // a friendlier object order, but the immutable content hash is over Rust's
  // original JSON bytes.
  return {
    schemaVersion: value.schemaVersion,
    coordinateFrameId: value.coordinateFrameId,
    sourceTimestampMs: value.sourceTimestampMs,
    state: value.state,
    reason: value.reason,
    primaryAxis: value.primaryAxis,
    crossAxis: value.crossAxis,
    origin: value.origin,
    scale: value.scale,
    scaleSource: value.scaleSource,
    equipmentTrackId: value.equipmentTrackId,
    rawBarAxis: value.rawBarAxis,
    coarseView: value.coarseView,
    canonicalFeedMirrored: value.canonicalFeedMirrored,
    anatomicalSideMapping: value.anatomicalSideMapping,
    endpointOrderMapping: value.endpointOrderMapping,
    equipment: value.equipment,
    pose: value.pose,
    channelAgreement: value.channelAgreement,
    endpointOneProgress: value.endpointOneProgress,
    endpointTwoProgress: value.endpointTwoProgress,
    anatomicalLeftEndpointProgress: value.anatomicalLeftEndpointProgress,
    anatomicalRightEndpointProgress: value.anatomicalRightEndpointProgress,
    rawBarAngleRadians: value.rawBarAngleRadians,
    baselineCorrectedBarAngleRadians: value.baselineCorrectedBarAngleRadians,
    confidence: value.confidence,
  };
}

const RUST_F32_FIELDS = new Set([
  "alongAxisProgress",
  "anatomicalLeftEndpointProgress",
  "anatomicalRightEndpointProgress",
  "baselineCorrectedBarAngleRadians",
  "confidence",
  "coverage",
  "crossAxisDisplacement",
  "endpointOneProgress",
  "endpointTwoProgress",
  "rawBarAngleRadians",
  "scale",
  "uncertainty",
]);

const RUST_F32_ARRAY_FIELDS = new Set(["crossAxis", "origin", "primaryAxis", "rawBarAxis"]);

function rustQualityJson(value: unknown, fieldName = "", forceFloat = false): string {
  if (value == null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Rust quality proposal contains a non-finite number");
    const serialized = JSON.stringify(value);
    return forceFloat && Number.isInteger(value) ? `${serialized}.0` : serialized;
  }
  if (Array.isArray(value)) {
    const arrayFloat = RUST_F32_ARRAY_FIELDS.has(fieldName);
    return `[${value.map((entry) => rustQualityJson(entry, fieldName, arrayFloat)).join(",")}]`;
  }
  const record = requireRecord(value, "Rust quality proposal JSON value");
  return `{${Object.entries(record).map(([key, entry]) => (
    `${JSON.stringify(key)}:${rustQualityJson(entry, key, RUST_F32_FIELDS.has(key))}`
  )).join(",")}}`;
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
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, `${label} SHA-256`);
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new Error(`${label} SHA-256 is invalid`);
  return digest;
}

export async function buildQualityReviewRelease(input: Readonly<{
  fullDataRunPath: string;
  frozenEvaluationRunPath: string;
  datasetPath: string;
  governanceInputCatalogPath: string;
  outputPath: string;
  frozenAt: string;
  qualityReviewVideoRoot?: string;
}>): Promise<void> {
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const [runBytes, frozenEvaluationBytes, datasetBytes] = await Promise.all([
    readFile(resolve(input.fullDataRunPath)),
    readFile(resolve(input.frozenEvaluationRunPath)),
    readFile(resolve(input.datasetPath)),
  ]);
  const run = JSON.parse(runBytes.toString("utf8")) as FullDataRun;
  const frozenEvaluationRun = JSON.parse(frozenEvaluationBytes.toString("utf8")) as FrozenEvaluationRun;
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as { records: GoldenRecord[] };
  const release = assembleQualityReviewRelease({
    releaseId: "personal-motion-quality-review-v1",
    frozenAt: input.frozenAt,
    fullDataRun: run,
    frozenEvaluationRun,
    records: dataset.records,
    inputAssets: [
      catalogLoaded.pin,
      pinInputBytes(catalogLoaded.value, "fullDataRun", input.fullDataRunPath, runBytes),
      pinInputBytes(catalogLoaded.value, "frozenPredictions", input.frozenEvaluationRunPath, frozenEvaluationBytes),
      pinInputBytes(catalogLoaded.value, "humanRanges", input.datasetPath, datasetBytes),
    ],
  });
  await assertReleaseVideoBytes(
    release.items,
    resolve(input.qualityReviewVideoRoot ?? "public/archives/confirmed-captures"),
  );
  const outputPath = resolve(input.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(release)}\n`, "utf8");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertFrozenEvaluationRun(run: FrozenEvaluationRun): void {
  if ((run.schemaVersion !== "maxpower-motion-quality-frozen-predictions/v1"
      && run.schemaVersion !== "maxpower-motion-quality-touched-benchmark-predictions/v1")
      || run.state !== "frozen_before_truth"
      || !Array.isArray(run.contexts)) {
    throw new Error("benchmark evidence is not a frozen prediction run");
  }
  const { frozenDigest, ...semantic } = run;
  if (sha256(stableStringify(semantic)) !== frozenDigest) {
    throw new Error("benchmark frozen prediction digest mismatch");
  }
}

function assertFullDataRun(run: FullDataRun): void {
  if (run.schemaVersion !== "maxpower-motion-quality-rust-full-data-proposals/v1"
      || run.runKind !== "full_data_proposal"
      || run.frozen !== true
      || run.acceptanceEligible !== false
      || !Array.isArray(run.sources)) {
    throw new Error("quality review queue must use a frozen full_data_proposal run");
  }
  if (run.runtime?.visualInferenceRuntime !== "offline_python_onnx_reference_only"
      || run.runtime.pythonVisionUsed !== true
      || run.runtime.clientVisualAcceptanceEligible !== false) {
    throw new Error("full-data visual provenance is not offline calibration-only");
  }
  const { frozenDigest, ...semantic } = run;
  if (!/^[a-f0-9]{64}$/u.test(frozenDigest)
      || sha256(stableStringify(semantic)) !== frozenDigest) {
    throw new Error("full-data frozen digest mismatch");
  }
}

async function assertReleaseVideoBytes(
  items: readonly Readonly<Record<string, unknown>>[],
  root: string,
): Promise<void> {
  const checked = new Map<string, string>();
  for (const item of items) {
    const relativePath = requireString(item.videoPath, "quality review video path");
    const expected = requireSha256(item.videoSha256, "quality review video");
    if (isAbsolute(relativePath)) throw new Error("quality review video path is invalid");
    const path = resolve(root, relativePath);
    if (!path.startsWith(`${root}${sep}`)) throw new Error("quality review video path is invalid");
    const prior = checked.get(path);
    if (prior && prior !== expected) throw new Error("quality review video hash identity mismatch");
    if (!prior && await sha256File(path) !== expected) {
      throw new Error(`${relativePath}: quality review video SHA-256 mismatch`);
    }
    checked.set(path, expected);
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", resolvePromise);
  });
  return hash.digest("hex");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

async function main(): Promise<void> {
  await buildQualityReviewRelease({
    fullDataRunPath: "data/workflows/motion-quality-review/full-data-proposals-v1.json",
    frozenEvaluationRunPath: "data/workflows/motion-quality-review/touched-benchmark-predictions-before-truth-v1.json",
    datasetPath: "data/training/personal-golden-segmentation-v2.json",
    governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
    outputPath: "data/workflows/motion-quality/full-personal-corpus-v1/frozen-quality-review-release.json",
    frozenAt: new Date().toISOString(),
  });
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
