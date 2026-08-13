import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface Segment {
  repIndex: number;
  startMs: number;
  peakMs: number;
  endMs: number;
  note?: string;
  peakSource?: "human_adjusted" | "algorithm_candidate" | "range_midpoint" | "legacy_unattributed";
}

interface DraftReview {
  exerciseId: string;
  capturePosition: string;
  expectedCount: string;
  draftSegments: Segment[];
  [key: string]: unknown;
}

interface ApprovedReview {
  exerciseId: string;
  capturePosition: string | null;
  expectedCount: string;
  approvedSegments: Segment[];
  [key: string]: unknown;
}

interface ApprovalExport {
  version: string;
  exportedAt: string;
  drafts?: Record<string, DraftReview>;
  approvals?: Record<string, ApprovedReview>;
}

interface Correction {
  captureId: string;
  field: "exerciseId" | "capturePosition";
  from: string;
  to: string;
  reason: string;
  evidence: {
    video: string;
    reviewedTimestampsMs: number[];
  };
}

interface CorrectionArtifact {
  schemaVersion: string;
  corrections: Correction[];
  contextSplits?: ContextSplit[];
  consent: {
    consentId: string;
    allowedUses: string[];
    forbiddenUses: string[];
    evidence: string;
  };
}

interface ContextWindow {
  id: string;
  capturePosition: string;
  startMs: number;
  endMs: number;
  expectedCount: number;
  repIndexes: number[];
}

interface ContextSplit {
  captureId: string;
  reason: string;
  windows: ContextWindow[];
  evidence: {
    video: string;
    metadata?: string;
    metadataSha256?: string;
    reviewedTimestampsMs: number[];
  };
}

interface SourceExport {
  file: string;
  sha256: string;
  version: string;
  exportedAt: string;
}

export interface GoldenApprovalExport extends ApprovalExport {
  sourceExports: SourceExport[];
  correctionArtifact: {
    file: string;
    sha256: string;
    schemaVersion: string;
  };
  consent: CorrectionArtifact["consent"];
  contextSplits: ContextSplit[];
  summary: {
    captureCount: number;
    trainingSequenceCount: number;
    contextSplitCaptureCount: number;
    setCountTruthTotal: number;
    perRepBoundaryCount: number;
    countOnlyRepCount: number;
    peakProvenance: Record<NonNullable<Segment["peakSource"]>, number>;
    annotationIssues: Array<{
      captureId: string;
      expectedCount?: number;
      perRepBoundaryCount?: number;
      repIndex?: number;
      reason: "expected_count_differs_from_rep_boundaries" | "degenerate_phase_boundary";
    }>;
  };
}

interface LoadedExport {
  file: string;
  bytes: Buffer;
  value: ApprovalExport;
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateSegments(captureId: string, expectedCount: string, segments: readonly Segment[]): void {
  const parsedExpected = Number(expectedCount);
  if (!Number.isInteger(parsedExpected) || parsedExpected < 0) {
    throw new Error(`${captureId}: expectedCount must be a non-negative integer`);
  }
  for (const [index, segment] of segments.entries()) {
    if (segment.repIndex !== index + 1) {
      throw new Error(`${captureId}: repIndex must be contiguous from 1`);
    }
    if (!(segment.startMs <= segment.peakMs && segment.peakMs <= segment.endMs) || segment.startMs === segment.endMs) {
      throw new Error(`${captureId}: invalid start/peak/end ordering at rep ${segment.repIndex}`);
    }
  }
}

function applyCorrection(
  drafts: Record<string, DraftReview>,
  approvals: Record<string, ApprovedReview>,
  correction: Correction,
): void {
  const record = drafts[correction.captureId] ?? approvals[correction.captureId];
  if (!record) throw new Error(`Correction target is missing: ${correction.captureId}`);
  const current = record[correction.field] ?? "";
  if (current !== correction.from) {
    throw new Error(
      `${correction.captureId}: correction expected ${correction.field}=${JSON.stringify(correction.from)}, got ${JSON.stringify(current)}`,
    );
  }
  record[correction.field] = correction.to;
}

function validateContextSplits(
  annotations: readonly { captureId: string; review: DraftReview | ApprovedReview; segments: Segment[] }[],
  splits: readonly ContextSplit[],
): void {
  const byCapture = new Map(annotations.map((annotation) => [annotation.captureId, annotation]));
  const seenCaptures = new Set<string>();
  for (const split of splits) {
    if (seenCaptures.has(split.captureId)) throw new Error(`Duplicate context split: ${split.captureId}`);
    seenCaptures.add(split.captureId);
    const annotation = byCapture.get(split.captureId);
    if (!annotation) throw new Error(`Context split target is missing: ${split.captureId}`);
    if (split.windows.length < 2) throw new Error(`${split.captureId}: context split needs at least two windows`);
    const seenReps = new Set<number>();
    let expectedTotal = 0;
    let previousEnd = -1;
    for (const window of split.windows) {
      if (!window.id.trim() || !window.capturePosition.trim() || window.startMs < 0 || window.endMs <= window.startMs) {
        throw new Error(`${split.captureId}: invalid context window`);
      }
      if (window.startMs < previousEnd) throw new Error(`${split.captureId}: context windows overlap`);
      previousEnd = window.endMs;
      if (window.expectedCount !== window.repIndexes.length) {
        throw new Error(`${split.captureId}/${window.id}: expectedCount must equal assigned strong rep count`);
      }
      expectedTotal += window.expectedCount;
      for (const repIndex of window.repIndexes) {
        if (seenReps.has(repIndex)) throw new Error(`${split.captureId}: rep ${repIndex} appears in multiple windows`);
        const segment = annotation.segments.find((candidate) => candidate.repIndex === repIndex);
        if (!segment) throw new Error(`${split.captureId}: context window references missing rep ${repIndex}`);
        if (segment.startMs < window.startMs || segment.endMs > window.endMs) {
          throw new Error(`${split.captureId}: rep ${repIndex} falls outside context window ${window.id}`);
        }
        seenReps.add(repIndex);
      }
    }
    if (seenReps.size !== annotation.segments.length) {
      throw new Error(`${split.captureId}: context split does not cover every strong rep exactly once`);
    }
    if (expectedTotal !== Number(annotation.review.expectedCount)) {
      throw new Error(`${split.captureId}: context split count does not preserve group-count truth`);
    }
  }
}

export function mergePersonalApprovalExports(
  inputs: readonly LoadedExport[],
  correctionFile: string,
  correctionBytes: Buffer,
  corrections: CorrectionArtifact,
): GoldenApprovalExport {
  if (inputs.length === 0) throw new Error("At least one approval export is required");
  const drafts: Record<string, DraftReview> = {};
  const approvals: Record<string, ApprovedReview> = {};

  for (const input of inputs) {
    for (const [captureId, draft] of Object.entries(input.value.drafts ?? {})) {
      const existing = drafts[captureId] ?? approvals[captureId];
      if (existing && !stableEqual(existing, draft)) {
        throw new Error(`Conflicting duplicate annotation: ${captureId}`);
      }
      if (!existing) drafts[captureId] = structuredClone(draft);
    }
    for (const [captureId, approval] of Object.entries(input.value.approvals ?? {})) {
      const existing = approvals[captureId] ?? drafts[captureId];
      if (existing && !stableEqual(existing, approval)) {
        throw new Error(`Conflicting duplicate annotation: ${captureId}`);
      }
      delete drafts[captureId];
      approvals[captureId] = structuredClone(approval);
    }
  }

  for (const review of Object.values(drafts)) {
    for (const segment of review.draftSegments) {
      segment.peakSource ??= "legacy_unattributed";
    }
  }
  for (const review of Object.values(approvals)) {
    for (const segment of review.approvedSegments) {
      segment.peakSource ??= "legacy_unattributed";
    }
  }

  for (const correction of corrections.corrections) {
    applyCorrection(drafts, approvals, correction);
  }

  const annotations = [
    ...Object.entries(drafts).map(([captureId, review]) => ({
      captureId,
      review,
      segments: review.draftSegments,
    })),
    ...Object.entries(approvals).map(([captureId, review]) => ({
      captureId,
      review,
      segments: review.approvedSegments,
    })),
  ];
  const issues: GoldenApprovalExport["summary"]["annotationIssues"] = [];
  const peakProvenance: GoldenApprovalExport["summary"]["peakProvenance"] = {
    human_adjusted: 0,
    algorithm_candidate: 0,
    range_midpoint: 0,
    legacy_unattributed: 0,
  };
  let setCountTruthTotal = 0;
  let perRepBoundaryCount = 0;
  for (const { captureId, review, segments } of annotations) {
    if (!review.exerciseId.trim()) throw new Error(`${captureId}: exerciseId is empty after corrections`);
    if (!(review.capturePosition ?? "").trim()) throw new Error(`${captureId}: capturePosition is empty after corrections`);
    validateSegments(captureId, review.expectedCount, segments);
    const expectedCount = Number(review.expectedCount);
    setCountTruthTotal += expectedCount;
    perRepBoundaryCount += segments.length;
    if (expectedCount !== segments.length) {
      issues.push({
        captureId,
        expectedCount,
        perRepBoundaryCount: segments.length,
        reason: "expected_count_differs_from_rep_boundaries",
      });
    }
    for (const segment of segments) {
      peakProvenance[segment.peakSource ?? "legacy_unattributed"] += 1;
      if (segment.startMs === segment.peakMs || segment.peakMs === segment.endMs) {
        issues.push({
          captureId,
          repIndex: segment.repIndex,
          reason: "degenerate_phase_boundary",
        });
      }
    }
  }
  const contextSplits = structuredClone(corrections.contextSplits ?? []);
  validateContextSplits(annotations, contextSplits);

  return {
    version: "capture-approval/personal-golden-v1",
    exportedAt: new Date().toISOString(),
    drafts,
    approvals,
    sourceExports: inputs.map((input) => ({
      file: path.resolve(input.file),
      sha256: sha256(input.bytes),
      version: input.value.version,
      exportedAt: input.value.exportedAt,
    })),
    correctionArtifact: {
      file: path.resolve(correctionFile),
      sha256: sha256(correctionBytes),
      schemaVersion: corrections.schemaVersion,
    },
    consent: corrections.consent,
    contextSplits,
    summary: {
      captureCount: annotations.length,
      trainingSequenceCount: annotations.length + contextSplits.reduce((sum, split) => sum + split.windows.length - 1, 0),
      contextSplitCaptureCount: contextSplits.length,
      setCountTruthTotal,
      perRepBoundaryCount,
      countOnlyRepCount: Math.max(0, setCountTruthTotal - perRepBoundaryCount),
      peakProvenance,
      annotationIssues: issues,
    },
  };
}

function optionValues(argv: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === name && argv[index + 1]) values.push(argv[index + 1]);
  }
  return values;
}

function option(argv: readonly string[], name: string): string | null {
  return optionValues(argv, name).at(-1) ?? null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const exportFiles = optionValues(argv, "--export");
  const correctionFile = option(argv, "--corrections");
  const outputFile = option(argv, "--output");
  if (exportFiles.length === 0 || !correctionFile || !outputFile) {
    throw new Error("Usage: --export <approvals.json> [--export <approvals.json>] --corrections <corrections.json> --output <golden.json>");
  }
  const loaded = exportFiles.map((file): LoadedExport => {
    const bytes = fs.readFileSync(file);
    return { file, bytes, value: JSON.parse(bytes.toString("utf8")) as ApprovalExport };
  });
  const correctionBytes = fs.readFileSync(correctionFile);
  const corrections = JSON.parse(correctionBytes.toString("utf8")) as CorrectionArtifact;
  const merged = mergePersonalApprovalExports(loaded, correctionFile, correctionBytes, corrections);
  if (merged.summary.captureCount !== 50 || merged.summary.perRepBoundaryCount !== 464) {
    throw new Error(
      `Personal golden invariant failed: expected 50 captures/464 rep boundaries, got ${merged.summary.captureCount}/${merged.summary.perRepBoundaryCount}`,
    );
  }
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(merged, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: path.resolve(outputFile), ...merged.summary }, null, 2)}\n`);
}

if (require.main === module) main();
