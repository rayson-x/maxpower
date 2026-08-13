import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export const TECHNIQUE_FEATURE_GROUPS = [
  "torso_pelvis",
  "bilateral_coordination",
  "body_joint_path",
  "equipment_path",
  "tempo_phase",
  "rom_endpoint",
  "base_support",
] as const;

export const MOVEMENT_STRATEGIES = [
  "momentum_assistance",
  "torso_extension_assistance",
  "hip_drive_assistance",
  "shoulder_elevation_strategy",
  "range_shortening",
  "asymmetric_path",
  "tempo_loss",
  "equipment_path_deviation",
  "balance_shift",
  "other_visible_strategy",
] as const;

export type TechniqueFeatureGroup = typeof TECHNIQUE_FEATURE_GROUPS[number];
export type MovementStrategy = typeof MOVEMENT_STRATEGIES[number];
export type ReviewerRole = "owner_observation" | "coach" | "biomechanics_reviewer";
export type TechniqueAdherence = "within_contract" | "observed_deviation" | "outside_contract" | "cannot_judge";
export type CompensationLabel = "not_observed" | "possible" | "observed" | "cannot_judge";
export type StimulusCompatibility =
  | "consistent"
  | "likely_consistent_with_observed_deviation"
  | "possible_strategy_shift"
  | "inconsistent_with_selected_variant"
  | "insufficient_evidence";

export interface TechniqueQueueItem {
  readonly reviewItemId: string;
  readonly captureId: string;
  readonly sourceCaptureId: string;
  readonly sourceVideo: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly repIndex: number;
  readonly startMs: number;
  readonly peakMs: number;
  readonly endMs: number;
}

export interface TechniqueReviewInput {
  readonly reviewItemId: string;
  readonly reviewerId: string;
  readonly reviewerRole: ReviewerRole;
  readonly reviewStatus: "draft" | "submitted";
  readonly expectedPriorEventId: string | null;
  readonly techniqueAdherence: TechniqueAdherence;
  readonly compensation: CompensationLabel;
  readonly stimulusCompatibility: StimulusCompatibility;
  readonly movementStrategies: readonly MovementStrategy[];
  readonly independentFeatureGroups: readonly TechniqueFeatureGroup[];
  readonly note: string;
}

export interface TechniqueReviewEvent extends TechniqueReviewInput {
  readonly schemaVersion: "maxpower-technique-review-event/v1";
  readonly eventId: string;
  readonly recordedAt: string;
  readonly queueSha256: string;
  readonly captureId: string;
  readonly sourceCaptureId: string;
  readonly sourceVideo: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly repIndex: number;
  readonly evidenceTimeRange: {
    readonly startMs: number;
    readonly peakMs: number;
    readonly endMs: number;
  };
  /** Personal captures never become a standard-form reference through this single-review UI. */
  readonly standardFormReference: false;
}

export interface TechniqueCaptureReview {
  readonly schemaVersion: "maxpower-technique-capture-review/v1";
  readonly queueSha256: string;
  readonly captureId: string;
  readonly totalReps: number;
  readonly submittedReps: number;
  readonly items: readonly {
    readonly queue: TechniqueQueueItem;
    readonly latestByReviewer: readonly TechniqueReviewEvent[];
    readonly adjudicationStatus: "pending" | "single_review" | "agreement" | "disagreement";
  }[];
}

export interface TechniqueTrainingDataset {
  readonly schemaVersion: "maxpower-technique-training-dataset/v1";
  readonly generatedAt: string;
  readonly queueSha256: string;
  readonly status: "blocked_no_gold_labels" | "research_candidate";
  readonly promotionAllowed: false;
  readonly labelPolicy: {
    readonly minimumIndependentExpertReviews: 2;
    readonly acceptedReviewerRoles: readonly ["coach", "biomechanics_reviewer"];
    readonly agreement: "exact_structured_label_match";
    readonly personalStandardFormReferenceAllowed: false;
  };
  readonly stats: {
    readonly queueRepCount: number;
    readonly eligibleRepCount: number;
    readonly pendingOrSingleReviewCount: number;
    readonly disagreementCount: number;
  };
  readonly blockedReasons: readonly string[];
  readonly examples: readonly {
    readonly reviewItemId: string;
    readonly sourceCaptureId: string;
    readonly sourceVideo: string;
    readonly exerciseId: string;
    readonly capturePosition: string;
    readonly repIndex: number;
    readonly startMs: number;
    readonly peakMs: number;
    readonly endMs: number;
    readonly techniqueAdherence: TechniqueAdherence;
    readonly compensation: CompensationLabel;
    readonly stimulusCompatibility: StimulusCompatibility;
    readonly movementStrategies: readonly MovementStrategy[];
    readonly independentFeatureGroups: readonly TechniqueFeatureGroup[];
    readonly reviewerCount: number;
    readonly reviewEventRefs: readonly string[];
    readonly standardFormReference: false;
    readonly splitPolicy: "unassigned_single_subject_group";
  }[];
}

interface TechniqueQueueDocument {
  readonly schemaVersion: string;
  readonly items: readonly unknown[];
}

export interface TechniqueReviewStoreOptions {
  readonly queuePath: string;
  readonly eventsPath: string;
}

export class TechniqueReviewStore {
  readonly #queueSha256: string;
  readonly #eventsPath: string;
  readonly #items: Map<string, TechniqueQueueItem>;
  readonly #events: TechniqueReviewEvent[];
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(input: {
    queueSha256: string;
    eventsPath: string;
    items: Map<string, TechniqueQueueItem>;
    events: TechniqueReviewEvent[];
  }) {
    this.#queueSha256 = input.queueSha256;
    this.#eventsPath = input.eventsPath;
    this.#items = input.items;
    this.#events = input.events;
  }

  static async open(options: TechniqueReviewStoreOptions): Promise<TechniqueReviewStore> {
    const compressed = await readFile(options.queuePath);
    const queueSha256 = createHash("sha256").update(compressed).digest("hex");
    const parsed = JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as TechniqueQueueDocument;
    if (parsed.schemaVersion !== "maxpower-training-execution-review-queue/v1" || !Array.isArray(parsed.items)) {
      throw new Error("unsupported technique review queue");
    }
    const items = new Map<string, TechniqueQueueItem>();
    for (const raw of parsed.items) {
      const item = parseQueueItem(raw);
      if (items.has(item.reviewItemId)) throw new Error(`duplicate technique review item: ${item.reviewItemId}`);
      items.set(item.reviewItemId, item);
    }
    const events = await readEvents(options.eventsPath, items, queueSha256);
    return new TechniqueReviewStore({ queueSha256, eventsPath: options.eventsPath, items, events });
  }

  capture(captureId: string): TechniqueCaptureReview {
    const queueItems = [...this.#items.values()]
      .filter((item) => item.captureId === captureId || item.sourceCaptureId === captureId)
      .sort((left, right) => left.repIndex - right.repIndex);
    const items = queueItems.map((queue) => {
      const latestByReviewer = latestEventsByReviewer(
        this.#events.filter((event) => event.reviewItemId === queue.reviewItemId),
      );
      return {
        queue,
        latestByReviewer,
        adjudicationStatus: adjudicationStatus(latestByReviewer),
      } as const;
    });
    return {
      schemaVersion: "maxpower-technique-capture-review/v1",
      queueSha256: this.#queueSha256,
      captureId,
      totalReps: items.length,
      submittedReps: items.filter((item) => item.latestByReviewer.some((event) => event.reviewStatus === "submitted")).length,
      items,
    };
  }

  trainingDataset(): TechniqueTrainingDataset {
    const examples: TechniqueTrainingDataset["examples"][number][] = [];
    let pendingOrSingleReviewCount = 0;
    let disagreementCount = 0;
    for (const item of this.#items.values()) {
      const expertReviews = latestEventsByReviewer(
        this.#events.filter((event) => event.reviewItemId === item.reviewItemId),
      ).filter((event) =>
        event.reviewStatus === "submitted"
        && (event.reviewerRole === "coach" || event.reviewerRole === "biomechanics_reviewer"),
      );
      if (expertReviews.length < 2) {
        pendingOrSingleReviewCount += 1;
        continue;
      }
      const keys = expertReviews.map(reviewLabelKey);
      if (!keys.every((key) => key === keys[0])) {
        disagreementCount += 1;
        continue;
      }
      const agreed = expertReviews[0]!;
      examples.push({
        reviewItemId: item.reviewItemId,
        sourceCaptureId: item.sourceCaptureId,
        sourceVideo: item.sourceVideo,
        exerciseId: item.exerciseId,
        capturePosition: item.capturePosition,
        repIndex: item.repIndex,
        startMs: item.startMs,
        peakMs: item.peakMs,
        endMs: item.endMs,
        techniqueAdherence: agreed.techniqueAdherence,
        compensation: agreed.compensation,
        stimulusCompatibility: agreed.stimulusCompatibility,
        movementStrategies: [...agreed.movementStrategies].sort(),
        independentFeatureGroups: [...agreed.independentFeatureGroups].sort(),
        reviewerCount: expertReviews.length,
        reviewEventRefs: expertReviews.map((event) => `technique_review_event:${event.eventId}`).sort(),
        standardFormReference: false,
        splitPolicy: "unassigned_single_subject_group",
      });
    }
    const blockedReasons = [
      ...(examples.length === 0 ? ["no_dual_expert_agreement_labels"] : []),
      "personal_data_is_one_subject_group_and_cannot_prove_cross_user_generalization",
      "personal_capture_consent_forbids_standard_form_reference_promotion",
    ];
    return {
      schemaVersion: "maxpower-technique-training-dataset/v1",
      // Keep the training artifact byte-stable when neither queue nor review
      // events changed. The latest source event is the dataset's as-of time.
      generatedAt: this.#events.map((event) => event.recordedAt).sort().at(-1) ?? "1970-01-01T00:00:00.000Z",
      queueSha256: this.#queueSha256,
      status: examples.length ? "research_candidate" : "blocked_no_gold_labels",
      promotionAllowed: false,
      labelPolicy: {
        minimumIndependentExpertReviews: 2,
        acceptedReviewerRoles: ["coach", "biomechanics_reviewer"],
        agreement: "exact_structured_label_match",
        personalStandardFormReferenceAllowed: false,
      },
      stats: {
        queueRepCount: this.#items.size,
        eligibleRepCount: examples.length,
        pendingOrSingleReviewCount,
        disagreementCount,
      },
      blockedReasons,
      examples: examples.sort((left, right) => left.sourceCaptureId.localeCompare(right.sourceCaptureId) || left.repIndex - right.repIndex),
    };
  }

  async save(raw: unknown): Promise<TechniqueReviewEvent> {
    const input = parseReviewInput(raw);
    const item = this.#items.get(input.reviewItemId);
    if (!item) throw new Error("technique review item not found");
    let result: TechniqueReviewEvent | undefined;
    const operation = this.#writeTail.then(async () => {
      const latest = latestEventsByReviewer(
        this.#events.filter((event) => event.reviewItemId === input.reviewItemId),
      ).find((event) => event.reviewerId === input.reviewerId);
      if ((latest?.eventId ?? null) !== input.expectedPriorEventId) {
        throw new Error("stale technique review revision");
      }
      const event: TechniqueReviewEvent = {
        schemaVersion: "maxpower-technique-review-event/v1",
        eventId: randomUUID(),
        recordedAt: new Date().toISOString(),
        queueSha256: this.#queueSha256,
        ...input,
        captureId: item.captureId,
        sourceCaptureId: item.sourceCaptureId,
        sourceVideo: item.sourceVideo,
        exerciseId: item.exerciseId,
        capturePosition: item.capturePosition,
        repIndex: item.repIndex,
        evidenceTimeRange: { startMs: item.startMs, peakMs: item.peakMs, endMs: item.endMs },
        standardFormReference: false,
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
}

function parseQueueItem(raw: unknown): TechniqueQueueItem {
  const value = record(raw, "invalid technique queue item");
  const item: TechniqueQueueItem = {
    reviewItemId: nonEmptyString(value.reviewItemId, "reviewItemId"),
    captureId: nonEmptyString(value.captureId, "captureId"),
    sourceCaptureId: nonEmptyString(value.sourceCaptureId, "sourceCaptureId"),
    sourceVideo: nonEmptyString(value.sourceVideo, "sourceVideo"),
    exerciseId: nonEmptyString(value.exerciseId, "exerciseId"),
    capturePosition: nonEmptyString(value.capturePosition, "capturePosition"),
    repIndex: safeInteger(value.repIndex, "repIndex"),
    startMs: safeNumber(value.startMs, "startMs"),
    peakMs: safeNumber(value.peakMs, "peakMs"),
    endMs: safeNumber(value.endMs, "endMs"),
  };
  if (item.repIndex < 1 || item.startMs < 0 || !(item.startMs <= item.peakMs && item.peakMs <= item.endMs)) {
    throw new Error("invalid technique queue time range");
  }
  return item;
}

function parseReviewInput(raw: unknown): TechniqueReviewInput {
  const value = record(raw, "invalid technique review input");
  const reviewerId = nonEmptyString(value.reviewerId, "reviewerId").trim();
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(reviewerId)) throw new Error("invalid reviewerId");
  const input: TechniqueReviewInput = {
    reviewItemId: nonEmptyString(value.reviewItemId, "reviewItemId"),
    reviewerId,
    reviewerRole: enumValue(value.reviewerRole, ["owner_observation", "coach", "biomechanics_reviewer"] as const, "reviewerRole"),
    reviewStatus: enumValue(value.reviewStatus, ["draft", "submitted"] as const, "reviewStatus"),
    expectedPriorEventId: value.expectedPriorEventId === null ? null : nonEmptyString(value.expectedPriorEventId, "expectedPriorEventId"),
    techniqueAdherence: enumValue(value.techniqueAdherence, ["within_contract", "observed_deviation", "outside_contract", "cannot_judge"] as const, "techniqueAdherence"),
    compensation: enumValue(value.compensation, ["not_observed", "possible", "observed", "cannot_judge"] as const, "compensation"),
    stimulusCompatibility: enumValue(value.stimulusCompatibility, ["consistent", "likely_consistent_with_observed_deviation", "possible_strategy_shift", "inconsistent_with_selected_variant", "insufficient_evidence"] as const, "stimulusCompatibility"),
    movementStrategies: uniqueEnumArray(value.movementStrategies, MOVEMENT_STRATEGIES, "movementStrategies"),
    independentFeatureGroups: uniqueEnumArray(value.independentFeatureGroups, TECHNIQUE_FEATURE_GROUPS, "independentFeatureGroups"),
    note: typeof value.note === "string" ? value.note.trim() : "",
  };
  if (input.note.length > 1_000) throw new Error("technique review note too long");
  if (input.compensation === "observed" && input.independentFeatureGroups.length < 2) {
    throw new Error("observed compensation requires two independent feature groups");
  }
  if (input.techniqueAdherence === "outside_contract" && input.independentFeatureGroups.length < 1) {
    throw new Error("outside-contract technique requires visible feature evidence");
  }
  const allUnknown = input.techniqueAdherence === "cannot_judge"
    && input.compensation === "cannot_judge"
    && input.stimulusCompatibility === "insufficient_evidence";
  if (input.reviewStatus === "submitted" && !allUnknown && input.note.length < 8) {
    throw new Error("submitted technique review requires an evidence note");
  }
  return input;
}

async function readEvents(
  path: string,
  items: ReadonlyMap<string, TechniqueQueueItem>,
  queueSha256: string,
): Promise<TechniqueReviewEvent[]> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const raw = record(JSON.parse(line) as unknown, `invalid technique event at line ${index + 1}`);
    if (raw.schemaVersion !== "maxpower-technique-review-event/v1") throw new Error(`unsupported technique event at line ${index + 1}`);
    if (raw.queueSha256 !== queueSha256) throw new Error(`technique event queue hash mismatch at line ${index + 1}`);
    const input = parseReviewInput(raw);
    const item = items.get(input.reviewItemId);
    const timeRange = raw.evidenceTimeRange && typeof raw.evidenceTimeRange === "object"
      ? raw.evidenceTimeRange as Record<string, unknown>
      : {};
    if (
      !item
      || raw.captureId !== item.captureId
      || raw.sourceCaptureId !== item.sourceCaptureId
      || raw.sourceVideo !== item.sourceVideo
      || raw.exerciseId !== item.exerciseId
      || raw.capturePosition !== item.capturePosition
      || raw.repIndex !== item.repIndex
      || timeRange.startMs !== item.startMs
      || timeRange.peakMs !== item.peakMs
      || timeRange.endMs !== item.endMs
      || raw.standardFormReference !== false
      || typeof raw.eventId !== "string"
      || !raw.eventId
      || typeof raw.recordedAt !== "string"
      || !Number.isFinite(Date.parse(raw.recordedAt))
    ) {
      throw new Error(`technique event lineage mismatch at line ${index + 1}`);
    }
    return raw as unknown as TechniqueReviewEvent;
  });
}

function latestEventsByReviewer(events: readonly TechniqueReviewEvent[]): TechniqueReviewEvent[] {
  const latest = new Map<string, TechniqueReviewEvent>();
  for (const event of events) latest.set(event.reviewerId, event);
  return [...latest.values()].sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
}

function adjudicationStatus(events: readonly TechniqueReviewEvent[]): TechniqueCaptureReview["items"][number]["adjudicationStatus"] {
  const submitted = events.filter((event) => event.reviewStatus === "submitted");
  if (submitted.length === 0) return "pending";
  if (submitted.length === 1) return "single_review";
  const labels = submitted.map((event) => JSON.stringify([
    event.techniqueAdherence,
    event.compensation,
    event.stimulusCompatibility,
    [...event.movementStrategies].sort(),
  ]));
  return labels.every((label) => label === labels[0]) ? "agreement" : "disagreement";
}

function reviewLabelKey(event: TechniqueReviewEvent): string {
  return JSON.stringify([
    event.techniqueAdherence,
    event.compensation,
    event.stimulusCompatibility,
    [...event.movementStrategies].sort(),
    [...event.independentFeatureGroups].sort(),
  ]);
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`invalid ${field}`);
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`invalid ${field}`);
  return value;
}

function safeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${field}`);
  return value;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`invalid ${field}`);
  return value as T[number];
}

function uniqueEnumArray<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number][] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !allowed.includes(entry))) {
    throw new Error(`invalid ${field}`);
  }
  return [...new Set(value as T[number][])];
}
