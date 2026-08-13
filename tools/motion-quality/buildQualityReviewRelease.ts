import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);

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

export interface QualityReviewReleaseInput {
  readonly releaseId: string;
  readonly frozenAt: string;
  readonly fullDataRun: FullDataRun;
  readonly records: readonly GoldenRecord[];
  readonly evidenceBySource: ReadonlyMap<string, readonly ReviewEvidenceFrame[]>;
}

export function assembleQualityReviewRelease(input: QualityReviewReleaseInput) {
  if (input.fullDataRun.runKind !== "full_data_proposal") {
    throw new Error("quality review queue must use a full_data_proposal run");
  }
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
    const frames = (input.evidenceBySource.get(sourceCaptureId) ?? [])
      .filter((frame) => frame.timestampMs >= from && frame.timestampMs <= until);
    const equipmentPoints = frames.flatMap((frame) => (frame.equipment ?? []).flatMap((raw) => {
      const axis = (raw.axis ?? raw) as Record<string, unknown>;
      const x1 = Number(axis.x1);
      const x2 = Number(axis.x2);
      const y1 = Number(axis.y1);
      const y2 = Number(axis.y2);
      return [x1, x2, y1, y2].every(Number.isFinite)
        ? [{ timestampMs: frame.timestampMs, x: (x1 + x2) / 2, y: (y1 + y2) / 2 }]
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
        frames,
        equipmentTrajectories: equipmentPoints.length
          ? [{ kind: "external_load_center", points: equipmentPoints }]
          : [],
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
    items,
  };
  return deepFreeze({
    ...semantic,
    releaseHash: `sha256:${sha256(stableStringify(semantic))}`,
  });
}

export async function buildQualityReviewRelease(input: Readonly<{
  fullDataRunPath: string;
  datasetPath: string;
  canonicalCorpusPath: string;
  benchEquipmentObservationRoot: string;
  outputPath: string;
  frozenAt: string;
}>): Promise<void> {
  const [runBytes, datasetBytes, corpusBytes] = await Promise.all([
    readFile(resolve(input.fullDataRunPath)),
    readFile(resolve(input.datasetPath)),
    readFile(resolve(input.canonicalCorpusPath)),
  ]);
  const run = JSON.parse(runBytes.toString("utf8")) as FullDataRun;
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as { records: GoldenRecord[] };
  const corpus = JSON.parse(corpusBytes.toString("utf8")) as {
    captures: Record<string, {
      sourceCaptureId: string;
      poses: Array<{ timestampMs: number; landmarks: Array<Record<string, unknown>> }>;
    }>;
  };
  const evidenceBySource = new Map<string, ReviewEvidenceFrame[]>();
  for (const capture of Object.values(corpus.captures)) {
    evidenceBySource.set(capture.sourceCaptureId, capture.poses.map((pose) => ({
      timestampMs: pose.timestampMs,
      landmarks: pose.landmarks,
    })));
  }
  for (const record of dataset.records.filter((candidate) => candidate.exerciseId === "barbell_bench_press")) {
    const sourceCaptureId = record.sourceCaptureId ?? record.captureId;
    const path = resolve(
      input.benchEquipmentObservationRoot,
      `${sourceCaptureId}.barbell-pose-alignment.json.gz`,
    );
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    const observation = JSON.parse((await gunzipAsync(bytes)).toString("utf8")) as {
      frames?: Array<{
        timestampMs: number;
        landmarks?: Array<Record<string, unknown>>;
        axis?: Record<string, unknown> | null;
      }>;
    };
    evidenceBySource.set(sourceCaptureId, (observation.frames ?? []).map((frame) => ({
      timestampMs: frame.timestampMs,
      landmarks: frame.landmarks ?? [],
      equipment: frame.axis ? [{ kind: "barbell_axis", ...frame.axis }] : [],
    })));
  }
  const release = assembleQualityReviewRelease({
    releaseId: "personal-motion-quality-review-v1",
    frozenAt: input.frozenAt,
    fullDataRun: run,
    records: dataset.records,
    evidenceBySource,
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
    datasetPath: "data/training/personal-golden-segmentation-v2.json",
    canonicalCorpusPath: "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/corpus/personal-rust-canonical-v2.json",
    benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
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
