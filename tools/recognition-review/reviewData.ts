import { createReadStream } from "node:fs";
import { access, readFile, readdir } from "node:fs/promises";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";
import { basename, extname, join, resolve } from "node:path";
import type { ReadStream } from "node:fs";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
} from "../../src/motion/rustCanonicalWasm";

const gunzipAsync = promisify(gunzip);

export type ReviewSource = "personal" | "mmfit";
export type ReviewStatus = "exact" | "failure" | "not_evaluated" | "annotation_blocked";

export interface RepSegment {
  readonly repIndex?: number;
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
  readonly note?: string;
}

export interface ReviewItemSummary {
  readonly id: string;
  readonly source: ReviewSource;
  readonly sequenceId: string;
  readonly exerciseId: string | null;
  readonly view: string | null;
  readonly split: string;
  readonly expectedCount: number;
  readonly predictedCount: number | null;
  readonly countDelta: number | null;
  readonly countExact: boolean | null;
  readonly alignedCount: number | null;
  readonly timelineTruthCount: number | null;
  readonly timelineAlignmentRatio: number | null;
  readonly meanBoundaryErrorMs: number | null;
  readonly maxBoundaryErrorMs: number | null;
  readonly status: ReviewStatus;
  readonly failureCategory: string;
  readonly reasonCodes: readonly string[];
  readonly evidenceLevel: "source_held_out_research" | "research_golden_replay" | "current_replay" | "legacy_replay" | "annotation_only" | "official_pose_replay";
  readonly auditSelection: "seeded_random_audit" | "held_out" | "not_held_out" | "official_split";
  readonly annotationState: "approved" | "draft" | "official";
  readonly hasVideo: boolean;
  readonly hasSkeleton: boolean;
  readonly rgbState: "available" | "not_downloaded" | "not_applicable";
  readonly profileSource: string | null;
  readonly needsReviewCount: number;
  readonly rejectedCount: number;
  readonly provenance: string;
}

export interface ReviewIndex {
  readonly generatedAt: string;
  readonly readOnly: true;
  readonly stats: {
    readonly personalAnnotatedVideos: number;
    readonly personalAnnotatedReps: number;
    readonly personalEvaluatedVideos: number;
    readonly personalExactVideos: number;
    readonly personalCountExactVideos: number;
    readonly personalAlignedReps: number;
    readonly personalTimelineTruthReps: number;
    readonly personalUnevaluatedVideos: number;
    readonly mmfitClips: number;
    readonly mmfitExactClips: number;
    readonly mmfitFailedClips: number;
    readonly mmfitRgbClips: number;
  };
  readonly personalHeldOutAcceptance: {
    readonly overallStatus: string;
    readonly productionPromotion: false;
    readonly protocol: {
      readonly mode: string;
      readonly partitionUnit: string;
      readonly eligibleHeldOutSourceCount: number;
      readonly inferenceBeforeLabelReveal: boolean;
      readonly randomAuditSeed: string;
      readonly randomAuditSources: readonly string[];
      readonly randomAuditIsAcceptanceMetric: false;
      readonly knownLimit: string;
    };
    readonly metrics: {
      readonly candidatePrecision: number;
      readonly candidateRecall: number;
      readonly exactSetSourceRate: number;
      readonly manualRangeAlignedRate: number;
      readonly exactTimelineSourceRate: number;
      readonly eligiblePeakTruthCount: number;
    };
    readonly thresholds: Readonly<Record<string, number>>;
    readonly failures: readonly string[];
  };
  readonly items: readonly ReviewItemSummary[];
}

export interface ReviewFrame {
  readonly timestampMs: number;
  readonly landmarks: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly visibility: number;
    readonly source?: string;
    readonly predicted?: boolean;
    readonly observationScore?: number;
    readonly canonicalConfidence?: number;
    readonly uncertainty?: number | null;
    readonly continuityReason?: string | null;
    readonly renderable?: boolean;
    readonly usable?: boolean;
  }[];
  readonly image?: {
    readonly widthPx?: number;
    readonly heightPx?: number;
    readonly mirrored?: boolean;
    readonly rotationDegrees?: 0 | 90 | 180 | 270;
  };
}

export interface ReviewDetail {
  readonly item: ReviewItemSummary;
  readonly videoUrl: string | null;
  readonly poseSchema: "blazepose33" | "halpe26";
  readonly posePipeline: string;
  readonly poseTimestampDomain: "legacy_capture_clock" | "media_pts" | "official_session_clock";
  readonly poseTiming: {
    readonly maximumOverlayAgeMs: number;
    readonly medianFrameIntervalMs: number;
  };
  readonly clipStartMs: number;
  readonly clipEndMs: number;
  readonly durationMs: number;
  readonly truthSegments: readonly RepSegment[];
  readonly predictedSegments: readonly RepSegment[];
  readonly baselineSegments: readonly RepSegment[];
  readonly frames: readonly ReviewFrame[];
  readonly rawFrames: readonly ReviewFrame[];
  readonly poseDiagnostics: {
    readonly frameCount: number;
    readonly framesWithPose: number;
    readonly poseFrameRatio: number;
    readonly upperBodyVisibleRatio: number;
    readonly measuredJointRatio: number;
    readonly fusedJointRatio: number;
    readonly predictedJointRatio: number;
    readonly unknownJointRatio: number;
    readonly label: string;
  };
  readonly rawPoseDiagnostics: ReviewDetail["poseDiagnostics"];
  readonly reasonDetails: readonly {
    readonly code: string;
    readonly title: string;
    readonly explanation: string;
    readonly layer: "data_pipeline" | "pose_extractor" | "profile" | "state_machine" | "annotation";
    readonly count?: number;
  }[];
  readonly notes: readonly string[];
}

export interface RecognitionReviewOptions {
  readonly projectRoot: string;
  readonly legacyApprovalExport: string;
  readonly currentApprovalExport: string;
  readonly archiveRoot: string;
  readonly personalHalpe26Root: string;
  readonly mmfitNormalizedRoot: string;
  readonly mmfitRgbRoot: string;
  readonly mmfitBenchmarkReport: string;
  readonly legacyRustReport: string;
  readonly poseQualityReport: string;
  readonly personalHeldOutReport: string;
  readonly personalBlindAcceptanceReport: string;
  readonly personalSameRecordReplayReport: string;
  readonly motionWasmPath: string;
}

interface InternalItem {
  readonly summary: ReviewItemSummary;
  readonly videoPath: string | null;
  readonly posePath: string | null;
  readonly observationPath: string | null;
  readonly truthSegments: readonly RepSegment[];
  readonly predictedSegments: readonly RepSegment[];
  readonly baselineSegments: readonly RepSegment[];
  readonly clipPath: string | null;
  readonly evidenceReasonCounts: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
  readonly poseQuality: Record<string, unknown> | null;
}

type UnknownRecord = Record<string, unknown>;

export function defaultRecognitionReviewOptions(projectRoot = process.cwd()): RecognitionReviewOptions {
  const parentRoot = resolve(projectRoot, "..");
  return {
    projectRoot,
    legacyApprovalExport: process.env.MAXPOWER_PERSONAL_APPROVALS_LEGACY ?? join(parentRoot, "field-capture-approvals-2026-08-03.json"),
    currentApprovalExport: process.env.MAXPOWER_PERSONAL_APPROVALS_CURRENT ?? join(projectRoot, "data/training/personal-golden-approvals-v2.json"),
    archiveRoot: process.env.MAXPOWER_CONFIRMED_ARCHIVE_DIR ?? join(projectRoot, "public/archives/confirmed-captures"),
    personalHalpe26Root: process.env.MAXPOWER_PERSONAL_HALPE26_DIR
      ?? join(projectRoot, "data/workflows/action-trajectory-database/halpe26-v1/personal-observations"),
    mmfitNormalizedRoot: process.env.MAXPOWER_MMFIT_NORMALIZED_DIR ?? join(projectRoot, "data/external/mm-fit/normalized"),
    mmfitRgbRoot: process.env.MAXPOWER_MMFIT_RGB_DIR ?? join(projectRoot, "data/external/mm-fit/rgb"),
    mmfitBenchmarkReport: join(projectRoot, "docs/reports/mmfit-full-616-validation-gated-benchmark-2026-08-10.json"),
    legacyRustReport: join(projectRoot, "docs/reports/rust-motion-evaluation-2026-08-03.json"),
    poseQualityReport: join(projectRoot, "docs/reports/field-capture-replay-2026-08-03.json"),
    personalHeldOutReport: process.env.MAXPOWER_PERSONAL_HELD_OUT_REPORT
      ?? join(projectRoot, "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/diagnostics/personal-cycle-state-halpe26-v1-loo.json"),
    personalBlindAcceptanceReport: process.env.MAXPOWER_PERSONAL_BLIND_ACCEPTANCE_REPORT
      ?? join(projectRoot, "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/diagnostics/personal-halpe26-blind-video-acceptance-v1.json"),
    personalSameRecordReplayReport: process.env.MAXPOWER_PERSONAL_SAME_RECORD_REPLAY_REPORT
      ?? join(projectRoot, "data/workflows/motion-profile/personal-golden-v2/run-2026-08-10/diagnostics/personal-temporal-template-v1-rust-replay.json"),
    motionWasmPath: join(projectRoot, "public/motion-sdk/maxpower_motion_sdk.wasm"),
  };
}

export class RecognitionReviewRepository {
  readonly #items: Map<string, InternalItem>;
  readonly #index: ReviewIndex;
  readonly #options: RecognitionReviewOptions;

  private constructor(items: Map<string, InternalItem>, index: ReviewIndex, options: RecognitionReviewOptions) {
    this.#items = items;
    this.#index = index;
    this.#options = options;
  }

  static async open(options: RecognitionReviewOptions): Promise<RecognitionReviewRepository> {
    const files = await walkFiles(options.archiveRoot);
    const videoById = new Map<string, string>();
    const poseById = new Map<string, string>();
    for (const path of files) {
      const extension = extname(path).toLowerCase();
      const name = basename(path, extension);
      if ([".mp4", ".webm", ".mov"].includes(extension)) videoById.set(name, path);
      if (extension === ".json" && !name.endsWith(".labels") && !name.endsWith(".metadata") && name !== "manifest" && name !== "groups" && !name.startsWith("recognition-profiles")) {
        poseById.set(name, path);
      }
    }
    const observationById = new Map<string, string>();
    if (await fileExists(options.personalHalpe26Root)) {
      for (const path of await walkFiles(options.personalHalpe26Root)) {
        const filename = basename(path);
        if (!filename.endsWith(".halpe26.json.gz")) continue;
        observationById.set(filename.slice(0, -".halpe26.json.gz".length), path);
      }
    }

    const strictReplay = await readJsonRecord(options.personalSameRecordReplayReport);
    const sameRecordReplay = asRecord(strictReplay.sameRecord);
    const reportRows = recordArray(strictReplay.buckets)
      .flatMap((bucket) => recordArray(bucket.rows));
    const strictReplayRows = reportRows.length > 0
      ? reportRows
      : recordArray(sameRecordReplay?.rows).map((row) => ({
        ...row,
        replaySchemaVersion: strictReplay.schemaVersion,
        executionBackend: strictReplay.executionBackend,
        rustCanonicalReplay: strictReplay.rustCanonicalReplay,
      }));
    const sameRecordReplayById = aggregateReplayRowsBySource(strictReplayRows);
    const heldOutReport = await readJsonRecord(options.personalHeldOutReport);
    const heldOutReplayById = aggregateReplayRowsBySource(normalizeHeldOutReplayRows(heldOutReport));
    const blindAcceptance = parseBlindAcceptance(
      await readJsonRecord(options.personalBlindAcceptanceReport),
    );
    const randomAuditSourceIds = new Set(blindAcceptance.protocol.randomAuditSources);
    const legacyRust = await readJsonRecord(options.legacyRustReport);
    const legacyRustById = mapByStringKey(recordArray(legacyRust.rows), "captureId");
    const poseQuality = await readJsonRecord(options.poseQualityReport);
    const poseQualityById = mapByStringKey(recordArray(poseQuality.rows), "id");

    const internal = new Map<string, InternalItem>();
    await addPersonalExport({
      internal,
      exportPath: options.legacyApprovalExport,
      provenance: "field-capture-approvals-2026-08-03.json",
      split: "personal_legacy",
      inCurrentSnapshot: false,
      videoById,
      poseById,
      observationById,
      currentReplayById: heldOutReplayById,
      baselineReplayById: sameRecordReplayById,
      randomAuditSourceIds,
      legacyRustById,
      poseQualityById,
    });
    await addPersonalExport({
      internal,
      exportPath: options.currentApprovalExport,
      provenance: basename(options.currentApprovalExport),
      split: "personal_golden",
      inCurrentSnapshot: true,
      videoById,
      poseById,
      observationById,
      currentReplayById: heldOutReplayById,
      baselineReplayById: sameRecordReplayById,
      randomAuditSourceIds,
      legacyRustById,
      poseQualityById,
    });

    const mmfitReport = await readJsonRecord(options.mmfitBenchmarkReport);
    for (const row of recordArray(mmfitReport.rows)) {
      const sourceSequenceId = stringValue(row.sourceSequenceId);
      if (!sourceSequenceId) continue;
      const subjectId = stringValue(row.subjectId) ?? sourceSequenceId.split(":")[0]?.replace(/^w/, "").padStart(2, "0");
      const sessionId = `w${subjectId}`;
      const rgbPath = join(options.mmfitRgbRoot, `${sessionId}_rgb.mp4`);
      const hasVideo = await fileExists(rgbPath);
      const expectedCount = numberValue(row.expectedCount) ?? 0;
      const predictedCount = numberValue(row.predictedCount) ?? 0;
      const evidenceReasonCounts = numericRecord(row.evidenceReasons);
      const observationCounts = numericRecord(row.observationFindings);
      const reasonCodes = Object.entries({ ...evidenceReasonCounts, ...observationCounts })
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([code]) => code);
      const profileSource = stringValue(row.profileSource);
      if (expectedCount !== predictedCount && profileSource?.includes("initializer")) reasonCodes.push("initializer_fallback_profile");
      const summary: ReviewItemSummary = {
        id: `mmfit:${sourceSequenceId}`,
        source: "mmfit",
        sequenceId: sourceSequenceId,
        exerciseId: stringValue(row.exerciseId),
        view: stringValue(row.bodyOrientationProxy) ?? stringValue(row.capturePosition),
        split: stringValue(row.split) ?? "unknown",
        expectedCount,
        predictedCount,
        countDelta: predictedCount - expectedCount,
        countExact: predictedCount === expectedCount,
        alignedCount: null,
        timelineTruthCount: null,
        timelineAlignmentRatio: null,
        meanBoundaryErrorMs: null,
        maxBoundaryErrorMs: null,
        status: predictedCount === expectedCount ? "exact" : "failure",
        failureCategory: predictedCount === expectedCount ? "计数一致" : predictedCount < expectedCount ? "状态机漏记" : "状态机多记",
        reasonCodes,
        evidenceLevel: "official_pose_replay",
        auditSelection: "official_split",
        annotationState: "official",
        hasVideo,
        hasSkeleton: true,
        rgbState: hasVideo ? "available" : "not_downloaded",
        profileSource,
        needsReviewCount: numberValue(row.needsReviewCount) ?? 0,
        rejectedCount: numberValue(row.rejectedCount) ?? 0,
        provenance: "MM-Fit official OpenPose-18 → BlazePose-33 mapping + Rust replay",
      };
      internal.set(summary.id, {
        summary,
        videoPath: hasVideo ? rgbPath : null,
        posePath: null,
        observationPath: null,
        truthSegments: [],
        predictedSegments: asCompletedSegments(row.completedReps),
        baselineSegments: [],
        clipPath: join(options.mmfitNormalizedRoot, stringValue(row.clipFile) ?? ""),
        evidenceReasonCounts: { ...evidenceReasonCounts, ...observationCounts },
        notes: [],
        poseQuality: null,
      });
    }

    const items = [...internal.values()].map(({ summary }) => summary);
    const personal = items.filter((item) => item.source === "personal");
    const mmfit = items.filter((item) => item.source === "mmfit");
    const index: ReviewIndex = {
      generatedAt: new Date().toISOString(),
      readOnly: true,
      stats: {
        personalAnnotatedVideos: personal.length,
        personalAnnotatedReps: personal.reduce((sum, item) => sum + item.expectedCount, 0),
        personalEvaluatedVideos: personal.filter((item) => item.predictedCount !== null).length,
        personalExactVideos: personal.filter((item) => item.status === "exact").length,
        personalCountExactVideos: personal.filter((item) => item.countExact === true).length,
        personalAlignedReps: personal.reduce((sum, item) => sum + (item.alignedCount ?? 0), 0),
        personalTimelineTruthReps: personal.reduce((sum, item) => sum + (item.timelineTruthCount ?? 0), 0),
        personalUnevaluatedVideos: personal.filter((item) => item.status === "not_evaluated" || item.status === "annotation_blocked").length,
        mmfitClips: mmfit.length,
        mmfitExactClips: mmfit.filter((item) => item.status === "exact").length,
        mmfitFailedClips: mmfit.filter((item) => item.status === "failure").length,
        mmfitRgbClips: mmfit.filter((item) => item.hasVideo).length,
      },
      personalHeldOutAcceptance: blindAcceptance,
      items,
    };
    return new RecognitionReviewRepository(internal, index, options);
  }

  index(): ReviewIndex {
    return this.#index;
  }

  videoStream(id: string): { stream: (range?: { start: number; end: number }) => ReadStream; path: string } {
    const item = this.#items.get(id);
    if (!item?.videoPath) throw new Error("video not found");
    return {
      path: item.videoPath,
      stream: (range) => createReadStream(item.videoPath!, range),
    };
  }

  async detail(id: string): Promise<ReviewDetail> {
    const item = this.#items.get(id);
    if (!item) throw new Error("review item not found");
    let frames: ReviewFrame[] = [];
    let rawFrames: ReviewFrame[] = [];
    let durationMs = 0;
    let clipStartMs = 0;
    let clipEndMs = 0;
    let poseSchema: ReviewDetail["poseSchema"] = "blazepose33";
    let posePipeline = "unknown";
    let poseTimestampDomain: ReviewDetail["poseTimestampDomain"] = "legacy_capture_clock";
    if (item.summary.source === "personal" && item.observationPath) {
      const compressed = await readFile(item.observationPath);
      const observation = asRecord(JSON.parse((await gunzipAsync(compressed)).toString("utf8")));
      if (stringValue(observation?.poseSchema) !== "halpe26") {
        throw new Error(`unsupported personal observation schema for ${item.summary.sequenceId}`);
      }
      const source = asRecord(observation?.source);
      const inference = asRecord(observation?.inference);
      const image: ReviewFrame["image"] = {
        widthPx: numberValue(source?.widthPx) ?? undefined,
        heightPx: numberValue(source?.heightPx) ?? undefined,
        mirrored: false,
        rotationDegrees: 0,
      };
      rawFrames = compactFrames(observation?.frames, image);
      clipStartMs = rawFrames[0]?.timestampMs ?? 0;
      clipEndMs = rawFrames.at(-1)?.timestampMs ?? clipStartMs;
      durationMs = Math.max(0, clipEndMs - clipStartMs);
      poseSchema = "halpe26";
      posePipeline = stringValue(inference?.pipeline) ?? "yolox+rtmpose-halpe26";
      poseTimestampDomain = "media_pts";
    } else if (item.summary.source === "personal" && item.posePath) {
      const raw = JSON.parse(await readFile(item.posePath, "utf8")) as unknown;
      const fixture = Array.isArray(raw) ? asRecord(raw[0]) : asRecord(raw);
      rawFrames = compactFrames(fixture?.poses);
      durationMs = Math.round((numberValue(fixture?.durationSec) ?? 0) * 1000);
      clipEndMs = durationMs || rawFrames.at(-1)?.timestampMs || 0;
      posePipeline = "legacy-mediapipe-blazepose33";
    } else if (item.summary.source === "mmfit" && item.clipPath) {
      const compressed = await readFile(item.clipPath);
      const clip = asRecord(JSON.parse((await gunzipAsync(compressed)).toString("utf8")));
      rawFrames = compactFrames(clip?.frames);
      clipStartMs = rawFrames[0]?.timestampMs ?? 0;
      clipEndMs = rawFrames.at(-1)?.timestampMs ?? clipStartMs;
      durationMs = Math.max(0, clipEndMs - clipStartMs);
      posePipeline = "mmfit-openpose18-to-blazepose33";
      poseTimestampDomain = "official_session_clock";
    }
    frames = await canonicalizeReviewFrames(
      rawFrames,
      `recognition-review:${item.summary.sequenceId}`,
      this.#options.motionWasmPath,
      poseSchema,
    );
    const diagnostics = poseDiagnostics(frames, poseSchema);
    const rawDiagnostics = poseDiagnostics(rawFrames, poseSchema);
    const reasonDetails = item.summary.reasonCodes.map((code) => reasonDetail(code, item.evidenceReasonCounts[code]));
    if (item.summary.status === "failure" && reasonDetails.length === 0) {
      reasonDetails.push(reasonDetail(item.summary.countDelta! < 0 ? "missed_rep_without_explicit_evidence" : "false_positive_without_explicit_evidence"));
    }
    return {
      item: item.summary,
      videoUrl: item.videoPath ? `/media/video?id=${encodeURIComponent(id)}` : null,
      poseSchema,
      posePipeline,
      poseTimestampDomain,
      poseTiming: {
        maximumOverlayAgeMs: 150,
        medianFrameIntervalMs: medianFrameIntervalMs(rawFrames),
      },
      clipStartMs,
      clipEndMs,
      durationMs,
      truthSegments: item.truthSegments,
      predictedSegments: item.predictedSegments,
      baselineSegments: item.baselineSegments,
      frames,
      rawFrames,
      poseDiagnostics: diagnostics,
      rawPoseDiagnostics: rawDiagnostics,
      reasonDetails,
      notes: item.notes,
    };
  }
}

async function addPersonalExport(input: {
  internal: Map<string, InternalItem>;
  exportPath: string;
  provenance: string;
  split: string;
  inCurrentSnapshot: boolean;
  videoById: Map<string, string>;
  poseById: Map<string, string>;
  observationById: Map<string, string>;
  currentReplayById: Map<string, UnknownRecord>;
  baselineReplayById: Map<string, UnknownRecord>;
  randomAuditSourceIds: ReadonlySet<string>;
  legacyRustById: Map<string, UnknownRecord>;
  poseQualityById: Map<string, UnknownRecord>;
}): Promise<void> {
  const exported = await readJsonRecord(input.exportPath);
  const collections: ["approved" | "draft", UnknownRecord][] = [
    ["approved", asRecord(exported.approvals) ?? {}],
    ["draft", asRecord(exported.drafts) ?? {}],
  ];
  for (const [annotationState, collection] of collections) {
    for (const [captureId, rawValue] of Object.entries(collection)) {
      const annotation = asRecord(rawValue);
      if (!annotation) continue;
      const truthSegments = asSegments(annotation.approvedSegments ?? annotation.draftSegments);
      const expectedCount = numberValue(annotation.expectedCount) ?? truthSegments.length;
      const currentReplay = input.currentReplayById.get(captureId);
      const baselineReplay = input.baselineReplayById.get(captureId);
      const legacyReplay = input.legacyRustById.get(captureId);
      let predictedSegments: RepSegment[] = [];
      let baselineSegments: RepSegment[] = [];
      let evidenceLevel: ReviewItemSummary["evidenceLevel"] = "annotation_only";
      let needsReviewCount = 0;
      let rejectedCount = 0;
      let profileSource: string | null = null;
      let strictExact: boolean | null = null;
      let alignedCount: number | null = null;
      let timelineTruthCount: number | null = null;
      let alignmentErrorMs: number | null = null;
      let maxBoundaryErrorMs: number | null = null;
      let replayReasonCounts: Record<string, number> = {};
      if (currentReplay) {
        const candidate = asRecord(currentReplay.candidate) ?? currentReplay;
        const parent = asRecord(currentReplay.parent)
          ?? asRecord(baselineReplay?.candidate)
          ?? baselineReplay;
        predictedSegments = asSegments(candidate?.predictedSegments);
        baselineSegments = asSegments(parent?.predictedSegments);
        needsReviewCount = numberValue(candidate?.needsReviewCount) ?? 0;
        rejectedCount = numberValue(candidate?.rejectedCount) ?? 0;
        strictExact = typeof candidate?.exact === "boolean" ? candidate.exact : null;
        alignedCount = numberValue(candidate?.alignedCount);
        timelineTruthCount = numberValue(candidate?.truthCount);
        alignmentErrorMs = numberValue(candidate?.alignmentErrorMs);
        const boundaryOffsets = recordArray(candidate?.segmentMatches).flatMap((match) => [
          numberValue(match.startOffsetMs),
          numberValue(match.peakOffsetMs),
          numberValue(match.endOffsetMs),
        ]).filter((value): value is number => value !== null).map(Math.abs);
        maxBoundaryErrorMs = boundaryOffsets.length ? Math.max(...boundaryOffsets) : null;
        replayReasonCounts = numericRecord(candidate?.evidenceReasonCounts);
        const executionBackend = stringValue(currentReplay.executionBackend);
        const sourceHeldOut = currentReplay.evaluationMode === "source_held_out";
        const researchReplay = executionBackend === "python_reference_only"
          || executionBackend === "rust_reference_cli"
          || currentReplay.rustCanonicalReplay === false;
        profileSource = sourceHeldOut
          ? "personal cycle-state Halpe-26 v1 (source-held-out Python research inference)"
          : executionBackend === "rust_reference_cli"
          ? "personal temporal template v1 (Rust canonical research replay)"
          : researchReplay
            ? "personal temporal template v1 (Python reference-only)"
          : strictExact === null ? "validation-gated candidate profile" : "personal golden provisional candidate";
        evidenceLevel = sourceHeldOut
          ? "source_held_out_research"
          : researchReplay ? "research_golden_replay" : "current_replay";
      } else if (legacyReplay) {
        predictedSegments = asSegments(legacyReplay.predicted);
        needsReviewCount = numberValue(legacyReplay.needsReviewCandidateCount) ?? 0;
        rejectedCount = numberValue(legacyReplay.rejectedCandidateCount) ?? 0;
        profileSource = stringValue(legacyReplay.profileVersion);
        evidenceLevel = "legacy_replay";
      }
      const exerciseId = stringValue(annotation.exerciseId);
      const predictedCount = evidenceLevel === "annotation_only" ? null : predictedSegments.length;
      const countExact = predictedCount === null ? null : predictedCount === expectedCount;
      const timelineAlignmentRatio = alignedCount !== null && timelineTruthCount
        ? alignedCount / timelineTruthCount
        : null;
      const matchedTimelineCount = currentReplay
        ? numberValue((asRecord(currentReplay.candidate) ?? currentReplay).matchedCount)
        : null;
      const meanBoundaryErrorMs = alignmentErrorMs !== null && matchedTimelineCount
        ? alignmentErrorMs / (matchedTimelineCount * 3)
        : null;
      const reasonCodes: string[] = [];
      let status: ReviewStatus;
      let failureCategory: string;
      if (!exerciseId) {
        status = "annotation_blocked";
        failureCategory = "动作标签缺失";
        reasonCodes.push("missing_exercise_annotation");
      } else if (predictedCount === null) {
        status = "not_evaluated";
        failureCategory = "尚未进入当前评测";
        reasonCodes.push("not_in_current_evaluation");
      } else if (strictExact === true || (strictExact === null && predictedCount === expectedCount)) {
        status = "exact";
        failureCategory = "计数一致";
      } else {
        status = "failure";
        failureCategory = countExact
          ? "次数相同但边界错位"
          : predictedCount < expectedCount ? "状态机漏记" : "状态机多记";
        reasonCodes.push(...Object.keys(replayReasonCounts));
        if (reasonCodes.length === 0) {
          reasonCodes.push(predictedCount <= expectedCount ? "missed_rep_without_explicit_evidence" : "false_positive_without_explicit_evidence");
        }
      }
      if (!input.inCurrentSnapshot) reasonCodes.push("not_in_current_training_snapshot");
      if (evidenceLevel === "legacy_replay") reasonCodes.push("legacy_evaluation_only");
      if (needsReviewCount > 0) reasonCodes.push("needs_review_candidates");
      if (countExact && strictExact === false) reasonCodes.push("timeline_boundary_misaligned");
      if ((replayReasonCounts.weak_set_count_candidate ?? 0) > 0) reasonCodes.push("weak_set_count_candidate");
      const videoPath = input.videoById.get(captureId) ?? null;
      const posePath = input.poseById.get(captureId) ?? null;
      const observationPath = input.observationById.get(captureId) ?? null;
      const summary: ReviewItemSummary = {
        id: `personal:${captureId}`,
        source: "personal",
        sequenceId: captureId,
        exerciseId,
        view: stringValue(annotation.capturePosition) ?? stringValue(annotation.cameraView),
        split: input.split,
        expectedCount,
        predictedCount,
        countDelta: predictedCount === null ? null : predictedCount - expectedCount,
        countExact,
        alignedCount,
        timelineTruthCount,
        timelineAlignmentRatio,
        meanBoundaryErrorMs,
        maxBoundaryErrorMs,
        status,
        failureCategory,
        reasonCodes: [...new Set(reasonCodes)],
        evidenceLevel,
        auditSelection: evidenceLevel === "source_held_out_research"
          ? input.randomAuditSourceIds.has(captureId) ? "seeded_random_audit" : "held_out"
          : "not_held_out",
        annotationState,
        hasVideo: Boolean(videoPath),
        hasSkeleton: Boolean(observationPath ?? posePath),
        rgbState: "not_applicable",
        profileSource,
        needsReviewCount,
        rejectedCount,
        provenance: input.provenance,
      };
      const notes = [stringValue(annotation.note), ...truthSegments.map((segment) => segment.note)].filter((value): value is string => Boolean(value));
      input.internal.set(summary.id, {
        summary,
        videoPath,
        posePath,
        observationPath,
        truthSegments,
        predictedSegments,
        baselineSegments,
        clipPath: null,
        evidenceReasonCounts: replayReasonCounts,
        notes,
        poseQuality: input.poseQualityById.get(captureId) ?? null,
      });
    }
  }
}

function compactFrames(value: unknown, fallbackImage?: ReviewFrame["image"]): ReviewFrame[] {
  return recordArray(value).map((frame) => ({
    timestampMs: numberValue(frame.timestampMs) ?? 0,
    landmarks: recordArray(frame.landmarks).map((landmark) => ({
      x: numberValue(landmark.x) ?? 0,
      y: numberValue(landmark.y) ?? 0,
      z: numberValue(landmark.z) ?? 0,
      visibility: numberValue(landmark.visibility) ?? numberValue(landmark.canonicalConfidence) ?? 0,
      source: stringValue(landmark.source) ?? undefined,
      predicted: typeof landmark.predicted === "boolean" ? landmark.predicted : undefined,
      observationScore: numberValue(landmark.observationScore) ?? undefined,
      canonicalConfidence: numberValue(landmark.canonicalConfidence) ?? undefined,
      uncertainty: numberValue(landmark.uncertainty),
      continuityReason: stringValue(landmark.continuityReason),
      renderable: typeof landmark.renderable === "boolean" ? landmark.renderable : undefined,
      usable: typeof landmark.usable === "boolean" ? landmark.usable : undefined,
    })),
    image: asImage(frame.image) ?? fallbackImage,
  }));
}

function medianFrameIntervalMs(frames: readonly ReviewFrame[]): number {
  const intervals = frames.slice(1)
    .map((frame, index) => frame.timestampMs - frames[index]!.timestampMs)
    .filter((interval) => interval > 0)
    .sort((left, right) => left - right);
  if (intervals.length === 0) return 0;
  const middle = Math.floor(intervals.length / 2);
  return intervals.length % 2 === 0
    ? (intervals[middle - 1]! + intervals[middle]!) / 2
    : intervals[middle]!;
}

export async function canonicalizeReviewFrames(
  rawFrames: readonly ReviewFrame[],
  sequenceId: string,
  motionWasmPath: string,
  schema: "blazepose33" | "halpe26" = "blazepose33",
): Promise<ReviewFrame[]> {
  if (rawFrames.length === 0) return [];
  const firstImage = rawFrames.find((frame) => frame.image)?.image;
  const wasm = await instantiateRustMotionWasm(await readFile(motionWasmPath));
  const session = new RustCanonicalWasmSession({
    sequenceId,
    schema,
    image: {
      widthPx: firstImage?.widthPx ?? 1280,
      heightPx: firstImage?.heightPx ?? 720,
      mirrored: firstImage?.mirrored ?? false,
      rotationDegrees: firstImage?.rotationDegrees ?? 0,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);
  try {
    return rawFrames.map((frame): ReviewFrame => {
      const canonical = session.process({
        timestampMs: frame.timestampMs,
        landmarks: frame.landmarks.map((landmark) => ({
          x: landmark.x,
          y: landmark.y,
          z: landmark.z,
          visibility: landmark.visibility,
        })),
        worldLandmarks: [],
      });
      return {
        timestampMs: canonical.timestampMs,
        image: canonical.image,
        landmarks: canonical.landmarks.map((landmark) => ({
          x: landmark.x,
          y: landmark.y,
          z: landmark.z,
          visibility: landmark.canonicalConfidence,
          source: landmark.source,
          predicted: landmark.predicted,
          observationScore: landmark.observationScore,
          canonicalConfidence: landmark.canonicalConfidence,
          uncertainty: landmark.uncertainty,
          continuityReason: landmark.continuityReason,
          renderable: landmark.renderable,
          usable: landmark.usable,
        })),
      };
    });
  } finally {
    session.close();
  }
}

function poseDiagnostics(
  frames: readonly ReviewFrame[],
  schema: ReviewDetail["poseSchema"],
): ReviewDetail["poseDiagnostics"] {
  const withPose = frames.filter((frame) => frame.landmarks.length >= 17);
  const upperBodyIndices = schema === "halpe26" ? [5, 6, 7, 8, 9, 10] : [11, 12, 13, 14, 15, 16];
  let visibleJoints = 0;
  let observedJoints = 0;
  const sources = { measured: 0, fused: 0, predicted: 0, unknown: 0 };
  for (const frame of withPose) {
    for (const index of upperBodyIndices) {
      observedJoints += 1;
      const landmark = frame.landmarks[index];
      if ((landmark?.visibility ?? 0) >= 0.5) visibleJoints += 1;
      if (landmark?.source === "measured") sources.measured += 1;
      else if (landmark?.source === "fused") sources.fused += 1;
      else if (landmark?.source === "predicted") sources.predicted += 1;
      else if (landmark?.source === "unknown") sources.unknown += 1;
    }
  }
  const poseFrameRatio = frames.length ? withPose.length / frames.length : 0;
  const upperBodyVisibleRatio = observedJoints ? visibleJoints / observedJoints : 0;
  return {
    frameCount: frames.length,
    framesWithPose: withPose.length,
    poseFrameRatio,
    upperBodyVisibleRatio,
    measuredJointRatio: observedJoints ? sources.measured / observedJoints : 0,
    fusedJointRatio: observedJoints ? sources.fused / observedJoints : 0,
    predictedJointRatio: observedJoints ? sources.predicted / observedJoints : 0,
    unknownJointRatio: observedJoints ? sources.unknown / observedJoints : 0,
    label: "姿态提取器输出覆盖率（不等同于原视频可见性）",
  };
}

function reasonDetail(code: string, count?: number): ReviewDetail["reasonDetails"][number] {
  const catalog: Record<string, Omit<ReviewDetail["reasonDetails"][number], "code" | "count">> = {
    incomplete_cycle: { title: "动作周期未闭合", explanation: "状态机进入了动作阶段，但没有在允许窗口内完成 effort → return → ready。", layer: "state_machine" },
    duration_exceeded: { title: "动作窗口超时", explanation: "候选周期持续时间超过当前 profile 的上限。", layer: "profile" },
    cycle_faster_than_expected: { title: "周期快于阈值", explanation: "真实动作周期被当前 profile 的最小时长阈值拒绝。", layer: "profile" },
    secondary_range_below_threshold: { title: "辅助关节幅度不足", explanation: "辅助信号的活动范围没有越过 profile 阈值。", layer: "profile" },
    primary_range_below_threshold: { title: "主关节幅度不足", explanation: "主信号的活动范围没有越过 profile 阈值。", layer: "profile" },
    initializer_fallback_profile: { title: "使用初始化兜底 profile", explanation: "该片段没有命中已学习 profile，回退规则是主要风险来源。", layer: "profile" },
    not_in_current_training_snapshot: { title: "训练快照漏收", explanation: "这条人工标注存在，但当前 approved-segmentation 快照没有收录它。", layer: "data_pipeline" },
    not_in_current_evaluation: { title: "尚未运行统一回放", explanation: "不能据此判定算法成功或失败；需要先迁移标注并运行当前 Rust 回放。", layer: "data_pipeline" },
    legacy_evaluation_only: { title: "仅有旧版 Rust 结果", explanation: "页面可展示旧结果，但它不代表当前 validation-gated profile 的最终能力。", layer: "data_pipeline" },
    missing_exercise_annotation: { title: "动作标签为空", explanation: "rep 和朝向存在，但动作类型为空，profile 无法路由。", layer: "annotation" },
    needs_review_candidates: { title: "候选被送入复核", explanation: "状态机产生了不满足确认条件的候选动作。", layer: "state_machine" },
    timeline_boundary_misaligned: { title: "次数相同但时间轴错位", explanation: "计数相等不能通过验收：至少一个预测周期的 start、peak、end 或区间重叠率没有达到人工标签容差。", layer: "profile" },
    weak_set_count_candidate: { title: "仅由组次数支持的候选", explanation: "该周期用于补足人工确认的组总次数，但目前没有对应的人工 start / peak / end 边界，不能计入逐 rep 时序真值。", layer: "annotation" },
    missed_rep_without_explicit_evidence: { title: "识别少于人工标注", explanation: "已确认存在漏记，但现有报告没有保存逐候选拒绝原因。", layer: "state_machine" },
    false_positive_without_explicit_evidence: { title: "识别多于人工标注", explanation: "已确认存在多记，但现有报告没有保存逐候选触发原因。", layer: "state_machine" },
  };
  const known = catalog[code] ?? { title: humanize(code), explanation: "来自回放报告的原始诊断代码。", layer: "state_machine" as const };
  return { code, ...known, ...(count && count > 0 ? { count } : {}) };
}

function asCompletedSegments(value: unknown): RepSegment[] {
  return recordArray(value)
    .filter((segment) => stringValue(segment.disposition) === "confirmed")
    .map((segment, index) => ({
    repIndex: index + 1,
    startMs: numberValue(segment.startTimestampMs) ?? 0,
    peakMs: numberValue(segment.peakTimestampMs) ?? numberValue(segment.startTimestampMs) ?? 0,
    endMs: numberValue(segment.endTimestampMs) ?? numberValue(segment.peakTimestampMs) ?? 0,
    }));
}

function asSegments(value: unknown): RepSegment[] {
  return recordArray(value).map((segment, index) => ({
    repIndex: numberValue(segment.repIndex) ?? index + 1,
    startMs: numberValue(segment.startMs) ?? numberValue(segment.startTimestampMs) ?? 0,
    peakMs: numberValue(segment.peakMs) ?? numberValue(segment.peakTimestampMs) ?? 0,
    endMs: numberValue(segment.endMs) ?? numberValue(segment.endTimestampMs) ?? 0,
    note: stringValue(segment.note) ?? undefined,
  }));
}

function asImage(value: unknown): ReviewFrame["image"] | undefined {
  const image = asRecord(value);
  if (!image) return undefined;
  const rotation = numberValue(image.rotationDegrees);
  return {
    widthPx: numberValue(image.widthPx) ?? undefined,
    heightPx: numberValue(image.heightPx) ?? undefined,
    mirrored: typeof image.mirrored === "boolean" ? image.mirrored : undefined,
    rotationDegrees: rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270
      ? rotation
      : undefined,
  };
}

async function readJsonRecord(path: string): Promise<UnknownRecord> {
  return asRecord(JSON.parse(await readFile(path, "utf8"))) ?? {};
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function recordArray(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(asRecord).filter((entry): entry is UnknownRecord => Boolean(entry)) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const converted = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(converted) ? converted : null;
}

function numericRecord(value: unknown): Record<string, number> {
  const record = asRecord(value) ?? {};
  return Object.fromEntries(Object.entries(record).flatMap(([key, raw]) => {
    const count = numberValue(raw);
    return count === null ? [] : [[key, count]];
  }));
}

function normalizeHeldOutReplayRows(report: UnknownRecord): UnknownRecord[] {
  const protocol = asRecord(report.evaluationProtocol);
  const leaveOneSourceOut = asRecord(report.leaveOneSourceOut);
  if (
    stringValue(protocol?.mode) !== "exhaustive_leave_one_source_out"
    || protocol?.inferenceBeforeLabelReveal !== true
    || !leaveOneSourceOut
  ) {
    throw new Error("personal held-out report does not satisfy the source-isolated evaluation contract");
  }

  return recordArray(leaveOneSourceOut.rows)
    .filter((row) => row.leaveOneSourceOutEligible === true)
    .map((row) => {
      const sourceCaptureId = stringValue(row.sourceCaptureId);
      const heldOutSourceId = stringValue(row.heldOutSourceId);
      const trainingSourceIds = Array.isArray(row.trainingSourceIds)
        ? row.trainingSourceIds.map(stringValue).filter((value): value is string => Boolean(value))
        : [];
      if (
        !sourceCaptureId
        || heldOutSourceId !== sourceCaptureId
        || row.splitLeakageDetected !== false
        || row.labelsRevealedAfterInference !== true
        || trainingSourceIds.includes(sourceCaptureId)
      ) {
        throw new Error(`invalid source-held-out row for ${sourceCaptureId ?? "unknown source"}`);
      }
      return {
        ...row,
        expectedSetCount: numberValue(row.expectedCount) ?? numberValue(row.truthCount) ?? 0,
        alignedCount: numberValue(row.manualRangeAlignedCount) ?? 0,
        needsReviewCount: numberValue(row.needsReviewCandidateCount) ?? 0,
        rejectedCount: 0,
        evaluationMode: "source_held_out",
        executionBackend: "python_source_held_out_research",
        rustCanonicalReplay: true,
      };
    });
}

function parseBlindAcceptance(report: UnknownRecord): ReviewIndex["personalHeldOutAcceptance"] {
  const protocol = asRecord(report.protocol);
  const dimensions = asRecord(report.dimensions);
  const repAndPhase = asRecord(dimensions?.repAndPhase);
  const metrics = asRecord(repAndPhase?.metrics);
  if (
    stringValue(report.schemaVersion) !== "maxpower-blind-video-acceptance/v1"
    || report.productionPromotion !== false
    || stringValue(protocol?.mode) !== "exhaustive_leave_one_source_out_with_seeded_random_audit"
    || protocol?.inferenceBeforeLabelReveal !== true
    || protocol?.randomAuditIsAcceptanceMetric !== false
    || (repAndPhase?.status !== "fail" && repAndPhase?.status !== "pass")
    || !metrics
  ) {
    throw new Error("personal blind acceptance report does not satisfy the review contract");
  }
  const randomAuditSources = Array.isArray(protocol.randomAuditSources)
    ? protocol.randomAuditSources.map(stringValue).filter((value): value is string => Boolean(value))
    : [];
  const failures = Array.isArray(repAndPhase.failures)
    ? repAndPhase.failures.map(stringValue).filter((value): value is string => Boolean(value))
    : [];
  return {
    overallStatus: stringValue(report.overallStatus) ?? "unknown",
    productionPromotion: false,
    protocol: {
      mode: stringValue(protocol.mode) ?? "unknown",
      partitionUnit: stringValue(protocol.partitionUnit) ?? "unknown",
      eligibleHeldOutSourceCount: numberValue(protocol.eligibleHeldOutSourceCount) ?? 0,
      inferenceBeforeLabelReveal: protocol.inferenceBeforeLabelReveal === true,
      randomAuditSeed: stringValue(protocol.randomAuditSeed) ?? "unknown",
      randomAuditSources,
      randomAuditIsAcceptanceMetric: false,
      knownLimit: stringValue(protocol.knownLimit) ?? "unknown",
    },
    metrics: {
      candidatePrecision: numberValue(metrics.candidatePrecision) ?? 0,
      candidateRecall: numberValue(metrics.candidateRecall) ?? 0,
      exactSetSourceRate: numberValue(metrics.exactSetSourceRate) ?? 0,
      manualRangeAlignedRate: numberValue(metrics.manualRangeAlignedRate) ?? 0,
      exactTimelineSourceRate: numberValue(metrics.exactTimelineSourceRate) ?? 0,
      eligiblePeakTruthCount: numberValue(metrics.eligiblePeakTruthCount) ?? 0,
    },
    thresholds: numericRecord(repAndPhase.thresholds),
    failures,
  };
}

export function aggregateReplayRowsBySource(rows: readonly UnknownRecord[]): Map<string, UnknownRecord> {
  const grouped = new Map<string, UnknownRecord[]>();
  for (const row of rows) {
    const captureId = stringValue(row.captureId);
    if (!captureId) continue;
    const sourceCaptureId = stringValue(row.sourceCaptureId) ?? captureId;
    grouped.set(sourceCaptureId, [...(grouped.get(sourceCaptureId) ?? []), row]);
  }
  const totals = [
    "expectedSetCount",
    "truthCount",
    "predictedCount",
    "matchedCount",
    "alignedCount",
    "alignmentErrorMs",
    "falsePositiveCount",
    "needsReviewCount",
    "rejectedCount",
  ] as const;
  const segmentFields = [
    "truthSegments",
    "predictedSegments",
    "needsReviewSegments",
    "rejectedSegments",
    "segmentMatches",
  ] as const;
  const countRecordFields = ["evidenceReasonCounts", "observationFindingCounts"] as const;
  const result = new Map<string, UnknownRecord>();
  for (const [sourceCaptureId, parts] of grouped) {
    const merged: UnknownRecord = { ...parts[0], captureId: sourceCaptureId, sourceCaptureId };
    for (const field of totals) {
      const values = parts.map((part) => numberValue(part[field])).filter((value): value is number => value !== null);
      merged[field] = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
    }
    for (const field of segmentFields) {
      merged[field] = parts
        .flatMap((part) => recordArray(part[field]))
        .sort((left, right) => (numberValue(left.startMs) ?? 0) - (numberValue(right.startMs) ?? 0));
    }
    for (const field of countRecordFields) {
      const counts: Record<string, number> = {};
      for (const part of parts) {
        for (const [key, count] of Object.entries(numericRecord(part[field]))) {
          counts[key] = (counts[key] ?? 0) + count;
        }
      }
      merged[field] = counts;
    }
    const expected = numberValue(merged.expectedSetCount) ?? 0;
    const truth = numberValue(merged.truthCount) ?? 0;
    const predicted = numberValue(merged.predictedCount) ?? 0;
    const matched = numberValue(merged.matchedCount) ?? 0;
    const hasAlignedEvidence = parts.some((part) => numberValue(part.alignedCount) !== null);
    const aligned = numberValue(merged.alignedCount) ?? 0;
    merged.exact = predicted === expected && (hasAlignedEvidence ? aligned === truth : matched === truth);
    merged.exactAnnotatedBoundaries = parts.every((part) => part.exactAnnotatedBoundaries === true);
    result.set(sourceCaptureId, merged);
  }
  return result;
}

function mapByStringKey(rows: readonly UnknownRecord[], key: string): Map<string, UnknownRecord> {
  const result = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const value = stringValue(row[key]);
    if (value) result.set(value, row);
  }
  return result;
}

async function walkFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && !entry.isSymbolicLink()) result.push(path);
    }
  };
  await visit(root);
  return result;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
