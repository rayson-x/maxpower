import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
}

interface FullContext {
  readonly captureId: string;
  readonly actionId: string;
  readonly capturePosition: string;
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
  readonly runId: string;
  readonly runKind: "full_data_proposal";
  readonly frozenDigest: string;
  readonly sources: readonly Readonly<{
    sourceCaptureId: string;
    videoRef: string | null;
    contexts: readonly FullContext[];
  }>[];
}

interface FrozenEvaluationContext extends Readonly<Record<string, unknown>> {
  readonly sourceCaptureId: string;
  readonly contextId: string;
}

interface FrozenEvaluationRun extends Readonly<Record<string, unknown>> {
  readonly schemaVersion: "maxpower-motion-quality-frozen-predictions/v1";
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
  if (input.fullDataRun.runKind !== "full_data_proposal") {
    throw new Error("quality review queue must use a full_data_proposal run");
  }
  assertFrozenEvaluationRun(input.frozenEvaluationRun);
  const benchmarkContexts = new Map(input.frozenEvaluationRun.contexts.map((context) => [
    `${context.sourceCaptureId}\u0000${context.contextId}`,
    context,
  ]));
  const records = new Map(input.records.map((record) => [record.captureId, record]));
  const items = input.fullDataRun.sources.flatMap((source) => source.contexts.map((context) => {
    const record = records.get(context.captureId);
    if (!record) throw new Error(`${context.captureId}: review truth/context record missing`);
    const sourceCaptureId = record.sourceCaptureId ?? record.captureId;
    if (sourceCaptureId !== source.sourceCaptureId) {
      throw new Error(`${context.captureId}: source identity mismatch`);
    }
    const from = record.evaluationWindow?.startMs ?? 0;
    const until = record.evaluationWindow?.endMs ?? record.source?.durationMs ?? Number.MAX_SAFE_INTEGER;
    const { evidenceHash, ...evidenceSemantic } = context.currentRustEvidence;
    if (context.currentRustEvidence.producer !== "current_rust_single_pass"
        || sha256(stableStringify(evidenceSemantic)) !== evidenceHash) {
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
    return deepFreeze({
      itemId: context.captureId,
      captureId: context.captureId,
      title: `${context.actionId} · ${context.capturePosition}`,
      capability: String(context.qualityProposals[0]?.capability ?? "unsupported"),
      context: {
        action: context.actionId,
        view: context.capturePosition,
      },
      videoPath: record.source?.video ?? source.videoRef,
      durationMs: record.source?.durationMs ?? until,
      humanSegments: (record.segments ?? []).map((segment) => ({
        startMs: segment.startMs,
        endMs: segment.endMs,
      })),
      expectedCount: record.expectedCount ?? null,
      evidence: {
        maximumOverlayAgeMs: 150,
        source: "current_rust_single_pass",
        evidenceHash,
        frames,
        equipmentTrajectories: equipmentPoints.length
          ? [{ kind: "external_load_center", points: equipmentPoints }]
          : [],
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
  const semantic = {
    schemaVersion: "maxpower-motion-quality-review-release/v1" as const,
    releaseId: input.releaseId,
    frozenAt: input.frozenAt,
    runKind: "full_data_proposal" as const,
    sourceRunId: input.fullDataRun.runId,
    sourceFrozenDigest: input.fullDataRun.frozenDigest,
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

export async function buildQualityReviewRelease(input: Readonly<{
  fullDataRunPath: string;
  frozenEvaluationRunPath: string;
  datasetPath: string;
  governanceInputCatalogPath: string;
  outputPath: string;
  frozenAt: string;
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
  if (run.schemaVersion !== "maxpower-motion-quality-frozen-predictions/v1"
      || run.state !== "frozen_before_truth"
      || !Array.isArray(run.contexts)) {
    throw new Error("benchmark evidence is not a frozen prediction run");
  }
  const { frozenDigest, ...semantic } = run;
  if (sha256(stableStringify(semantic)) !== frozenDigest) {
    throw new Error("benchmark frozen prediction digest mismatch");
  }
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
    frozenEvaluationRunPath: "data/workflows/motion-quality-review/blind-predictions-before-truth-v1.json",
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
