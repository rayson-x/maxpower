import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);
const TURNAROUND_SOURCES = ["algorithm_candidate", "human_confirmed_candidate", "human_adjusted"] as const;

export type BenchTurnaroundSource = typeof TURNAROUND_SOURCES[number];

interface HumanRange {
  readonly repIndex: number;
  readonly startMs: number;
  readonly endMs: number;
}

interface AlgorithmSegment extends HumanRange {
  readonly turnaroundMs: number;
  readonly rawStartMs: number;
  readonly rawEndMs: number;
  readonly meanAxisConfidence: number;
  readonly provenance: "algorithm_bar_axis";
  readonly humanTruth: false;
}

interface RawPosePoint {
  readonly x: number | null;
  readonly y: number | null;
  readonly visibility: number;
}

interface RustPosePoint extends RawPosePoint {
  readonly observationScore: number;
  readonly source: "measured" | "fused" | "predicted" | "unknown";
  readonly predicted: boolean;
  readonly renderable: boolean;
  readonly usable: boolean;
}

interface AxisFrame {
  readonly timestampMs: number;
  readonly axis: null | {
    readonly source: string;
    readonly confidence: number;
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
    readonly centerY: number;
  };
  readonly landmarks: readonly RawPosePoint[];
  readonly fusionStatus: string;
}

interface RustPoseFrame {
  readonly timestampMs: number;
  readonly landmarks: readonly RustPosePoint[];
}

interface BenchCapture {
  readonly captureId: string;
  readonly exerciseId: "barbell_bench_press";
  readonly capturePosition: string;
  readonly durationMs: number;
  readonly videoPath: string;
  readonly humanRanges: readonly HumanRange[];
  readonly algorithmSegments: readonly AlgorithmSegment[];
  readonly axisFrames: readonly AxisFrame[];
  readonly rustFrames: readonly RustPoseFrame[];
}

export interface BenchPhaseRepInput {
  readonly repIndex: number;
  readonly startMs: number;
  readonly turnaroundMs: number;
  readonly endMs: number;
  readonly turnaroundSource: BenchTurnaroundSource;
  readonly note: string;
}

export interface BenchPhaseReviewInput {
  readonly captureId: string;
  readonly reviewerId: string;
  readonly reviewStatus: "draft" | "submitted";
  readonly expectedPriorEventId: string | null;
  readonly reps: readonly BenchPhaseRepInput[];
  readonly note: string;
}

export interface BenchPhaseReviewEvent extends BenchPhaseReviewInput {
  readonly schemaVersion: "maxpower-bench-phase-review-event/v1";
  readonly eventId: string;
  readonly recordedAt: string;
  readonly datasetSha256: string;
  readonly predictionsSha256: string;
  readonly exerciseId: "barbell_bench_press";
  readonly capturePosition: string;
  readonly reps: readonly (BenchPhaseRepInput & {
    readonly startSource: "existing_human_range" | "human_adjusted";
    readonly endSource: "existing_human_range" | "human_adjusted";
    readonly humanTruth: boolean;
  })[];
  readonly humanPeakTruth: boolean;
  readonly trainerReadable: boolean;
  readonly productionPromotion: false;
}

export interface BenchPhaseReviewStoreOptions {
  readonly datasetPath: string;
  readonly predictionsPath: string;
  readonly observationsDir: string;
  readonly rustCanonicalPath: string;
  readonly eventsPath: string;
  readonly videoRoot: string;
}

export class BenchPhaseReviewStore {
  readonly #datasetSha256: string;
  readonly #predictionsSha256: string;
  readonly #captures: Map<string, BenchCapture>;
  readonly #captureOrder: readonly string[];
  readonly #events: BenchPhaseReviewEvent[];
  readonly #eventsPath: string;
  readonly #videoRoot: string;
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(input: {
    datasetSha256: string;
    predictionsSha256: string;
    captures: Map<string, BenchCapture>;
    captureOrder: readonly string[];
    events: BenchPhaseReviewEvent[];
    eventsPath: string;
    videoRoot: string;
  }) {
    this.#datasetSha256 = input.datasetSha256;
    this.#predictionsSha256 = input.predictionsSha256;
    this.#captures = input.captures;
    this.#captureOrder = input.captureOrder;
    this.#events = input.events;
    this.#eventsPath = input.eventsPath;
    this.#videoRoot = resolve(input.videoRoot);
  }

  static async open(options: BenchPhaseReviewStoreOptions): Promise<BenchPhaseReviewStore> {
    const [datasetBytes, predictionsBytes, rustCanonicalBytes] = await Promise.all([
      readFile(options.datasetPath),
      readFile(options.predictionsPath),
      readFile(options.rustCanonicalPath),
    ]);
    const datasetSha256 = sha256(datasetBytes);
    const predictionsSha256 = sha256(predictionsBytes);
    const dataset = parseDataset(JSON.parse(datasetBytes.toString("utf8")) as unknown);
    const predictions = parsePredictions(JSON.parse(predictionsBytes.toString("utf8")) as unknown);
    const rustByCapture = parseRustCanonical(JSON.parse(rustCanonicalBytes.toString("utf8")) as unknown);
    const predictionByCapture = new Map(predictions.rows.map((row) => [row.captureId, row]));
    const captures = new Map<string, BenchCapture>();

    await Promise.all(dataset.records.map(async (record) => {
      const prediction = predictionByCapture.get(record.captureId);
      if (!prediction) throw new Error(`bench phase prediction not found: ${record.captureId}`);
      if (prediction.predictedSegments.length !== record.ranges.length) {
        throw new Error(`bench phase rep count mismatch: ${record.captureId}`);
      }
      const observationPath = resolve(options.observationsDir, `${record.captureId}.barbell-pose-alignment.json.gz`);
      const observationBytes = await readFile(observationPath);
      const observation = parseObservation(JSON.parse((await gunzipAsync(observationBytes)).toString("utf8")) as unknown, record.captureId);
      const rustFrames = rustByCapture.get(record.captureId);
      if (!rustFrames) throw new Error(`bench phase Rust canonical pose not found: ${record.captureId}`);
      const algorithmSegments = prediction.predictedSegments.map((segment, index): AlgorithmSegment => ({
        repIndex: index + 1,
        startMs: segment.startMs,
        turnaroundMs: segment.turnaroundMs,
        endMs: segment.endMs,
        rawStartMs: segment.rawStartMs,
        rawEndMs: segment.rawEndMs,
        meanAxisConfidence: segment.meanAxisConfidence,
        provenance: "algorithm_bar_axis",
        humanTruth: false,
      }));
      captures.set(record.captureId, {
        captureId: record.captureId,
        exerciseId: "barbell_bench_press",
        capturePosition: record.capturePosition,
        durationMs: record.durationMs,
        videoPath: record.videoPath,
        humanRanges: record.ranges,
        algorithmSegments,
        axisFrames: observation.frames,
        rustFrames,
      });
    }));

    const captureOrder = predictions.captureOrder.filter((captureId) => captures.has(captureId));
    if (captureOrder.length !== captures.size) throw new Error("bench phase capture order is incomplete");
    const events = await readEvents(options.eventsPath, captures, datasetSha256, predictionsSha256);
    return new BenchPhaseReviewStore({
      datasetSha256,
      predictionsSha256,
      captures,
      captureOrder,
      events,
      eventsPath: options.eventsPath,
      videoRoot: options.videoRoot,
    });
  }

  index(): unknown {
    const items = this.#captureOrder.map((captureId) => {
      const capture = this.#captures.get(captureId)!;
      const latest = this.#latestByReviewer(captureId);
      const submitted = latest.filter((event) => event.reviewStatus === "submitted");
      return {
        captureId,
        capturePosition: capture.capturePosition,
        durationMs: capture.durationMs,
        repCount: capture.humanRanges.length,
        confirmedRepCount: Math.max(0, ...latest.map((event) => event.reps.filter((rep) => rep.humanTruth).length)),
        status: submitted.length ? "submitted" : latest.length ? "draft" : "unreviewed",
      };
    });
    return {
      schemaVersion: "maxpower-bench-phase-review-index/v1",
      datasetSha256: this.#datasetSha256,
      predictionsSha256: this.#predictionsSha256,
      humanRangePolicy: "start_end_only_peak_is_not_truth",
      productionPromotion: false,
      stats: {
        captureCount: items.length,
        repCount: items.reduce((total, item) => total + item.repCount, 0),
        submittedCaptures: items.filter((item) => item.status === "submitted").length,
      },
      items,
    };
  }

  detail(captureId: string): unknown {
    const capture = this.#captures.get(captureId);
    if (!capture) throw new Error("bench phase review item not found");
    return {
      schemaVersion: "maxpower-bench-phase-review-detail/v1",
      datasetSha256: this.#datasetSha256,
      predictionsSha256: this.#predictionsSha256,
      capture: {
        captureId: capture.captureId,
        exerciseId: capture.exerciseId,
        capturePosition: capture.capturePosition,
        durationMs: capture.durationMs,
      },
      videoUrl: `/media/bench-phase?id=${encodeURIComponent(captureId)}`,
      humanRanges: capture.humanRanges.map((range) => ({
        ...range,
        provenance: "existing_human_range" as const,
        humanTruth: true,
        turnaroundMs: null,
      })),
      algorithmSegments: capture.algorithmSegments,
      axisFrames: capture.axisFrames,
      rustCanonicalFrames: capture.rustFrames,
      poseLayers: {
        schema: "halpe26",
        raw: { source: "yolox_rtmpose", humanTruth: false },
        rustCanonical: { source: "rust_motion_sdk", humanTruth: false },
      },
      latestByReviewer: this.#latestByReviewer(captureId),
      annotationPolicy: {
        algorithmCandidateIsHumanTruth: false,
        submissionRequiresEveryTurnaroundHumanConfirmed: true,
        midpointFallbackAllowed: false,
        productionPromotion: false,
      },
    };
  }

  video(captureId: string): { path: string } {
    const capture = this.#captures.get(captureId);
    if (!capture) throw new Error("bench phase video not found");
    const path = resolve(this.#videoRoot, capture.videoPath);
    if (!path.startsWith(`${this.#videoRoot}${sep}`)) throw new Error("bench phase video not found");
    return { path };
  }

  async save(raw: unknown): Promise<BenchPhaseReviewEvent> {
    const input = parseReviewInput(raw);
    const capture = this.#captures.get(input.captureId);
    if (!capture) throw new Error("bench phase review item not found");
    validateReviewAgainstCapture(input, capture);
    let result: BenchPhaseReviewEvent | undefined;
    const operation = this.#writeTail.then(async () => {
      const latest = this.#latestByReviewer(input.captureId).find((event) => event.reviewerId === input.reviewerId);
      if ((latest?.eventId ?? null) !== input.expectedPriorEventId) throw new Error("stale bench phase review revision");
      const reps = input.reps.map((rep, index) => {
        const original = capture.humanRanges[index]!;
        return {
          ...rep,
          startSource: rep.startMs === original.startMs ? "existing_human_range" as const : "human_adjusted" as const,
          endSource: rep.endMs === original.endMs ? "existing_human_range" as const : "human_adjusted" as const,
          humanTruth: rep.turnaroundSource !== "algorithm_candidate",
        };
      });
      const humanPeakTruth = input.reviewStatus === "submitted" && reps.every((rep) => rep.humanTruth);
      const event: BenchPhaseReviewEvent = {
        schemaVersion: "maxpower-bench-phase-review-event/v1",
        eventId: randomUUID(),
        recordedAt: new Date().toISOString(),
        datasetSha256: this.#datasetSha256,
        predictionsSha256: this.#predictionsSha256,
        ...input,
        exerciseId: capture.exerciseId,
        capturePosition: capture.capturePosition,
        reps,
        humanPeakTruth,
        trainerReadable: humanPeakTruth,
        productionPromotion: false,
      };
      await mkdir(dirname(this.#eventsPath), { recursive: true });
      await appendFile(this.#eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      this.#events.push(event);
      result = event;
    });
    this.#writeTail = operation.catch(() => undefined);
    await operation;
    return result!;
  }

  #latestByReviewer(captureId: string): BenchPhaseReviewEvent[] {
    const latest = new Map<string, BenchPhaseReviewEvent>();
    for (const event of this.#events) {
      if (event.captureId === captureId) latest.set(event.reviewerId, event);
    }
    return [...latest.values()].sort((a, b) => a.reviewerId.localeCompare(b.reviewerId));
  }
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseDataset(raw: unknown): {
  records: readonly { captureId: string; capturePosition: string; durationMs: number; videoPath: string; ranges: readonly HumanRange[] }[];
} {
  const root = record(raw, "invalid bench phase dataset");
  const records = array(root.records, "invalid bench phase dataset records").map((entry) => {
    const value = record(entry, "invalid bench phase dataset record");
    const source = record(value.source, "invalid bench phase dataset source");
    return {
      captureId: string(value.captureId, "invalid bench phase capture id"),
      capturePosition: string(value.capturePosition, "invalid bench phase capture position"),
      durationMs: finite(source.durationMs, "invalid bench phase duration"),
      videoPath: string(source.video, "invalid bench phase video"),
      ranges: array(value.segments, "invalid bench phase segments").map((segment, index) => {
        const item = record(segment, "invalid bench phase segment");
        return {
          repIndex: integer(item.repIndex, "invalid bench phase rep index"),
          startMs: finite(item.startMs, "invalid bench phase start"),
          endMs: finite(item.endMs, "invalid bench phase end"),
        } satisfies HumanRange;
      }).sort((a, b) => a.repIndex - b.repIndex),
    };
  });
  return { records };
}

function parsePredictions(raw: unknown): {
  captureOrder: readonly string[];
  rows: readonly { captureId: string; predictedSegments: readonly Omit<AlgorithmSegment, "repIndex" | "provenance" | "humanTruth">[] }[];
} {
  const root = record(raw, "invalid bench phase predictions");
  const captureOrder = array(root.randomizedCaptureOrder, "invalid bench phase capture order").map((value) => string(value, "invalid bench phase capture order"));
  const rows = array(root.rows, "invalid bench phase prediction rows").map((entry) => {
    const value = record(entry, "invalid bench phase prediction row");
    return {
      captureId: string(value.captureId, "invalid bench phase prediction capture id"),
      predictedSegments: array(value.predictedSegments, "invalid bench phase predicted segments").map((segment) => {
        const item = record(segment, "invalid bench phase predicted segment");
        return {
          startMs: finite(item.startMs, "invalid predicted start"),
          turnaroundMs: finite(item.peakMs, "invalid predicted turnaround"),
          endMs: finite(item.endMs, "invalid predicted end"),
          rawStartMs: finite(item.rawStartMs, "invalid predicted raw start"),
          rawEndMs: finite(item.rawEndMs, "invalid predicted raw end"),
          meanAxisConfidence: finite(item.meanAxisConfidence, "invalid predicted confidence"),
        };
      }),
    };
  });
  return { captureOrder, rows };
}

function parseObservation(raw: unknown, expectedCaptureId: string): { frames: readonly AxisFrame[] } {
  const root = record(raw, "invalid bench phase observation");
  if (string(root.captureId, "invalid bench phase observation capture") !== expectedCaptureId) {
    throw new Error("invalid bench phase observation capture mismatch");
  }
  return {
    frames: array(root.frames, "invalid bench phase observation frames").map((entry) => {
      const frame = record(entry, "invalid bench phase observation frame");
      const rawAxis = frame.axis;
      const fusion = record(frame.fusion, "invalid bench phase fusion");
      const landmarks = parseRawLandmarks(frame.landmarks);
      const axis = rawAxis === null || rawAxis === undefined ? null : record(rawAxis, "invalid bench phase axis");
      return {
        timestampMs: finite(frame.timestampMs, "invalid axis timestamp"),
        axis: axis ? {
          source: string(axis.source, "invalid axis source"),
          confidence: finite(axis.confidence, "invalid axis confidence"),
          x1: finite(axis.x1, "invalid axis x1"),
          y1: finite(axis.y1, "invalid axis y1"),
          x2: finite(axis.x2, "invalid axis x2"),
          y2: finite(axis.y2, "invalid axis y2"),
          centerY: finite(axis.centerY, "invalid axis center"),
        } : null,
        landmarks,
        fusionStatus: string(fusion.status, "invalid bench phase fusion status"),
      };
    }),
  };
}

function parseRawLandmarks(raw: unknown): RawPosePoint[] {
  const points = array(raw, "invalid bench phase raw landmarks");
  if (points.length === 0) return Array.from({ length: 26 }, () => ({ x: null, y: null, visibility: 0 }));
  if (points.length !== 26) throw new Error("bench phase raw pose requires Halpe-26 landmarks");
  return points.map((entry) => {
    const point = record(entry, "invalid bench phase raw landmark");
    return {
      x: nullableFinite(point.x, "invalid raw pose x"),
      y: nullableFinite(point.y, "invalid raw pose y"),
      visibility: finite(point.visibility, "invalid raw pose visibility"),
    };
  });
}

function parseRustCanonical(raw: unknown): Map<string, readonly RustPoseFrame[]> {
  const root = record(raw, "invalid bench phase Rust canonical corpus");
  const captures = record(root.captures, "invalid bench phase Rust captures");
  const result = new Map<string, readonly RustPoseFrame[]>();
  for (const rawCapture of Object.values(captures)) {
    const capture = record(rawCapture, "invalid bench phase Rust capture");
    const captureId = string(capture.sourceCaptureId, "invalid bench phase Rust capture id");
    const poses = array(capture.poses, "invalid bench phase Rust poses").map((rawPose) => {
      const pose = record(rawPose, "invalid bench phase Rust pose");
      const points = array(pose.landmarks, "invalid bench phase Rust landmarks");
      if (points.length !== 26) throw new Error("bench phase Rust pose requires Halpe-26 landmarks");
      return {
        timestampMs: finite(pose.timestampMs, "invalid bench phase Rust timestamp"),
        landmarks: points.map((rawPoint): RustPosePoint => {
          const point = record(rawPoint, "invalid bench phase Rust landmark");
          const source = point.source;
          if (source !== "measured" && source !== "fused" && source !== "predicted" && source !== "unknown") throw new Error("invalid bench phase Rust point source");
          return {
            x: nullableFinite(point.x, "invalid Rust pose x"),
            y: nullableFinite(point.y, "invalid Rust pose y"),
            visibility: finite(point.visibility, "invalid Rust pose visibility"),
            observationScore: finite(point.observationScore, "invalid Rust observation score"),
            source,
            predicted: boolean(point.predicted, "invalid Rust predicted flag"),
            renderable: boolean(point.renderable, "invalid Rust renderable flag"),
            usable: boolean(point.usable, "invalid Rust usable flag"),
          };
        }),
      };
    });
    result.set(captureId, poses);
  }
  return result;
}

function parseReviewInput(raw: unknown): BenchPhaseReviewInput {
  const value = record(raw, "invalid bench phase review");
  const reviewStatus = value.reviewStatus;
  if (reviewStatus !== "draft" && reviewStatus !== "submitted") throw new Error("invalid bench phase review status");
  const expectedPriorEventId = value.expectedPriorEventId;
  if (expectedPriorEventId !== null && typeof expectedPriorEventId !== "string") throw new Error("invalid bench phase prior event");
  const reps = array(value.reps, "bench phase review requires reps").map((entry) => {
    const rep = record(entry, "invalid bench phase review rep");
    const turnaroundSource = rep.turnaroundSource;
    if (!TURNAROUND_SOURCES.includes(turnaroundSource as BenchTurnaroundSource)) throw new Error("invalid bench phase turnaround source");
    return {
      repIndex: integer(rep.repIndex, "invalid bench phase rep index"),
      startMs: finite(rep.startMs, "invalid bench phase rep start"),
      turnaroundMs: finite(rep.turnaroundMs, "invalid bench phase turnaround"),
      endMs: finite(rep.endMs, "invalid bench phase rep end"),
      turnaroundSource: turnaroundSource as BenchTurnaroundSource,
      note: optionalShortString(rep.note, 500, "invalid bench phase rep note"),
    };
  });
  return {
    captureId: shortString(value.captureId, 100, "invalid bench phase capture id"),
    reviewerId: shortString(value.reviewerId, 100, "invalid bench phase reviewer"),
    reviewStatus,
    expectedPriorEventId,
    reps,
    note: optionalShortString(value.note, 2000, "invalid bench phase note"),
  };
}

function validateReviewAgainstCapture(input: BenchPhaseReviewInput, capture: BenchCapture): void {
  if (input.reps.length !== capture.humanRanges.length) throw new Error("bench phase review requires every rep");
  input.reps.forEach((rep, index) => {
    if (rep.repIndex !== index + 1) throw new Error("invalid bench phase rep order");
    if (!(0 <= rep.startMs && rep.startMs < rep.turnaroundMs && rep.turnaroundMs < rep.endMs && rep.endMs <= capture.durationMs)) {
      throw new Error(`invalid bench phase timing for rep ${rep.repIndex}`);
    }
    if (input.reviewStatus === "submitted" && rep.turnaroundSource === "algorithm_candidate") {
      throw new Error("submitted bench phase review requires every turnaround to be human confirmed");
    }
  });
}

async function readEvents(
  path: string,
  captures: ReadonlyMap<string, BenchCapture>,
  datasetSha256: string,
  predictionsSha256: string,
): Promise<BenchPhaseReviewEvent[]> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const event = record(JSON.parse(line) as unknown, "invalid bench phase review event") as unknown as BenchPhaseReviewEvent;
    if (event.schemaVersion !== "maxpower-bench-phase-review-event/v1") throw new Error("invalid bench phase review event schema");
    if (!captures.has(event.captureId)) throw new Error("bench phase review event capture not found");
    if (event.datasetSha256 !== datasetSha256 || event.predictionsSha256 !== predictionsSha256) {
      throw new Error("bench phase review event evidence hash mismatch");
    }
    return event;
  });
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(message);
  return value;
}

function string(value: unknown, message: string): string {
  if (typeof value !== "string" || !value) throw new Error(message);
  return value;
}

function shortString(value: unknown, maximum: number, message: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(message);
  return value.trim();
}

function optionalShortString(value: unknown, maximum: number, message: string): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(message);
  return value.trim();
}

function finite(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(message);
  return value;
}

function nullableFinite(value: unknown, message: string): number | null {
  if (value === null) return null;
  return finite(value, message);
}

function boolean(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") throw new Error(message);
  return value;
}

function integer(value: unknown, message: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error(message);
  return value as number;
}
