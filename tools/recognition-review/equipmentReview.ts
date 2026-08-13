import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export const EQUIPMENT_REVIEW_TARGETS = [
  "visible_barbell",
  "no_target_equipment",
  "reflection_only",
  "static_rack_only",
  "ambiguous",
] as const;

export type EquipmentReviewTarget = typeof EQUIPMENT_REVIEW_TARGETS[number];
export type EquipmentReviewerRole = "owner_observation" | "vision_annotator" | "vision_reviewer";
export type EquipmentOcclusion = "none" | "partial" | "heavy" | "unknown";

export interface EquipmentAxis {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface EquipmentQueueItem {
  readonly reviewItemId: string;
  readonly sourceCaptureId: string;
  readonly sourceVideo: string;
  readonly sourceVideoSha256: string;
  readonly capturePosition: string;
  readonly analysisView: string;
  readonly split: "train" | "validation" | "test";
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly sampleKind: string;
  readonly repIndex: number | null;
  readonly phase: string | null;
  readonly image: string;
  readonly imageSha256: string;
  readonly preview: string;
  readonly previewSha256: string;
  readonly proposal: {
    readonly kind: "barbell_shaft";
    readonly axis: EquipmentAxis;
    readonly confidenceRatio: number;
    readonly source: string;
    readonly reviewPriority: "normal" | "high";
    readonly reviewReason: string | null;
    readonly humanTruth: false;
  };
}

export interface EquipmentReviewInput {
  readonly reviewItemId: string;
  readonly reviewerId: string;
  readonly reviewerRole: EquipmentReviewerRole;
  readonly reviewStatus: "draft" | "submitted";
  readonly expectedPriorEventId: string | null;
  readonly target: EquipmentReviewTarget;
  readonly equipmentKind: "barbell_shaft" | null;
  readonly axis: EquipmentAxis | null;
  readonly occlusion: EquipmentOcclusion;
  readonly truncated: boolean;
  readonly note: string;
}

export interface EquipmentReviewEvent extends EquipmentReviewInput {
  readonly schemaVersion: "maxpower-equipment-review-event/v1";
  readonly eventId: string;
  readonly recordedAt: string;
  readonly queueSha256: string;
  readonly sourceManifestSha256: string;
  readonly sourceCaptureId: string;
  readonly sourceVideoSha256: string;
  readonly split: EquipmentQueueItem["split"];
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly imageSha256: string;
  readonly humanTruth: true;
  readonly productionPromotion: false;
}

export interface EquipmentReviewStoreOptions {
  readonly queuePath: string;
  readonly eventsPath: string;
  readonly assetRoot: string;
}

export interface EquipmentTrainingDataset {
  readonly schemaVersion: "maxpower-equipment-training-dataset/v1";
  readonly queueSha256: string;
  readonly sourceManifestSha256: string;
  readonly splitPolicy: string;
  readonly status: "blocked_no_human_labels" | "blocked_data_quality" | "research_candidate";
  readonly promotionAllowed: false;
  readonly stats: {
    readonly queueItemCount: number;
    readonly eligibleItemCount: number;
    readonly trainItemCount: number;
    readonly validationItemCount: number;
    readonly testItemCount: number;
    readonly disagreementCount: number;
  };
  readonly blockedReasons: readonly string[];
  readonly examples: readonly EquipmentTrainingExample[];
}

export interface EquipmentTrainingExample {
  readonly reviewItemId: string;
  readonly sourceCaptureId: string;
  readonly sourceVideoSha256: string;
  readonly split: EquipmentQueueItem["split"];
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly image: string;
  readonly imageSha256: string;
  readonly target: EquipmentReviewTarget;
  readonly equipmentKind: "barbell_shaft" | null;
  readonly axis: EquipmentAxis | null;
  readonly occlusion: EquipmentOcclusion;
  readonly truncated: boolean;
  readonly reviewEventRefs: readonly string[];
  readonly humanTruth: true;
}

interface EquipmentQueueDocument {
  readonly schemaVersion: "maxpower-equipment-review-queue/v1";
  readonly sourceManifestSha256: string;
  readonly splitPolicy: string;
  readonly promotionAllowed: false;
  readonly blockedReasons: readonly string[];
  readonly sourceGroups: readonly {
    readonly sourceCaptureId: string;
    readonly split: EquipmentQueueItem["split"];
  }[];
  readonly items: readonly unknown[];
}

export class EquipmentReviewStore {
  readonly #queueSha256: string;
  readonly #queue: EquipmentQueueDocument;
  readonly #items: Map<string, EquipmentQueueItem>;
  readonly #events: EquipmentReviewEvent[];
  readonly #eventsPath: string;
  readonly #assetRoot: string;
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(input: {
    queueSha256: string;
    queue: EquipmentQueueDocument;
    items: Map<string, EquipmentQueueItem>;
    events: EquipmentReviewEvent[];
    eventsPath: string;
    assetRoot: string;
  }) {
    this.#queueSha256 = input.queueSha256;
    this.#queue = input.queue;
    this.#items = input.items;
    this.#events = input.events;
    this.#eventsPath = input.eventsPath;
    this.#assetRoot = resolve(input.assetRoot);
  }

  static async open(options: EquipmentReviewStoreOptions): Promise<EquipmentReviewStore> {
    const compressed = await readFile(options.queuePath);
    const queueSha256 = createHash("sha256").update(compressed).digest("hex");
    const raw = JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as unknown;
    const queue = parseQueue(raw);
    const items = new Map<string, EquipmentQueueItem>();
    const splitBySource = new Map(queue.sourceGroups.map((group) => [group.sourceCaptureId, group.split]));
    for (const candidate of queue.items) {
      const item = parseQueueItem(candidate);
      if (items.has(item.reviewItemId)) throw new Error(`duplicate equipment review item: ${item.reviewItemId}`);
      if (splitBySource.get(item.sourceCaptureId) !== item.split) {
        throw new Error(`equipment source crosses split: ${item.sourceCaptureId}`);
      }
      items.set(item.reviewItemId, item);
    }
    const events = await readEvents(options.eventsPath, items, queueSha256, queue.sourceManifestSha256);
    return new EquipmentReviewStore({
      queueSha256,
      queue,
      items,
      events,
      eventsPath: options.eventsPath,
      assetRoot: options.assetRoot,
    });
  }

  index(): unknown {
    const items = [...this.#items.values()].map((item) => {
      const latestByReviewer = this.#latestByReviewer(item.reviewItemId);
      const submitted = latestByReviewer.filter((event) => event.reviewStatus === "submitted");
      const status = submitted.length > 1 && !reviewsAgree(submitted)
        ? "disagreement"
        : submitted.length > 0
          ? "submitted"
          : latestByReviewer.length > 0
            ? "draft"
            : "unreviewed";
      return {
        reviewItemId: item.reviewItemId,
        sourceCaptureId: item.sourceCaptureId,
        capturePosition: item.capturePosition,
        analysisView: item.analysisView,
        split: item.split,
        frameIndex: item.frameIndex,
        timestampMs: item.timestampMs,
        sampleKind: item.sampleKind,
        phase: item.phase,
        reviewPriority: item.proposal.reviewPriority,
        reviewReason: item.proposal.reviewReason,
        status,
        target: submitted[0]?.target ?? null,
      };
    });
    const statusCounts = countBy(items.map((item) => item.status));
    const splitCounts = countBy(items.map((item) => item.split));
    return {
      schemaVersion: "maxpower-equipment-review-index/v1",
      queueSha256: this.#queueSha256,
      sourceManifestSha256: this.#queue.sourceManifestSha256,
      splitPolicy: this.#queue.splitPolicy,
      promotionAllowed: false,
      blockedReasons: this.#queue.blockedReasons,
      stats: {
        itemCount: items.length,
        sourceCount: this.#queue.sourceGroups.length,
        submittedItems: statusCounts.submitted ?? 0,
        disagreementItems: statusCounts.disagreement ?? 0,
        draftItems: statusCounts.draft ?? 0,
        unreviewedItems: statusCounts.unreviewed ?? 0,
        trainItems: splitCounts.train ?? 0,
        validationItems: splitCounts.validation ?? 0,
        testItems: splitCounts.test ?? 0,
        highPriorityItems: items.filter((item) => item.reviewPriority === "high").length,
      },
      items,
    };
  }

  detail(reviewItemId: string): unknown {
    const item = this.#items.get(reviewItemId);
    if (!item) throw new Error("equipment review item not found");
    return {
      schemaVersion: "maxpower-equipment-review-detail/v1",
      queueSha256: this.#queueSha256,
      item,
      imageUrl: `/media/equipment?id=${encodeURIComponent(reviewItemId)}&kind=image`,
      previewUrl: `/media/equipment?id=${encodeURIComponent(reviewItemId)}&kind=preview`,
      latestByReviewer: this.#latestByReviewer(reviewItemId),
    };
  }

  asset(reviewItemId: string, kind: "image" | "preview"): { path: string; sha256: string } {
    const item = this.#items.get(reviewItemId);
    if (!item) throw new Error("equipment review item not found");
    const relative = kind === "image" ? item.image : item.preview;
    const path = resolve(this.#assetRoot, relative);
    if (!path.startsWith(`${this.#assetRoot}${sep}`)) throw new Error("equipment asset not found");
    return { path, sha256: kind === "image" ? item.imageSha256 : item.previewSha256 };
  }

  trainingDataset(): EquipmentTrainingDataset {
    const examples: EquipmentTrainingExample[] = [];
    let disagreementCount = 0;
    for (const item of this.#items.values()) {
      const submitted = this.#latestByReviewer(item.reviewItemId)
        .filter((event) => event.reviewStatus === "submitted");
      if (!submitted.length) continue;
      if (!reviewsAgree(submitted)) {
        disagreementCount += 1;
        continue;
      }
      const agreed = submitted[0]!;
      examples.push({
        reviewItemId: item.reviewItemId,
        sourceCaptureId: item.sourceCaptureId,
        sourceVideoSha256: item.sourceVideoSha256,
        split: item.split,
        frameIndex: item.frameIndex,
        timestampMs: item.timestampMs,
        image: item.image,
        imageSha256: item.imageSha256,
        target: agreed.target,
        equipmentKind: agreed.equipmentKind,
        axis: agreed.axis,
        occlusion: agreed.occlusion,
        truncated: agreed.truncated,
        reviewEventRefs: submitted.map((event) => `equipment_review_event:${event.eventId}`).sort(),
        humanTruth: true,
      });
    }
    const blockedReasons = [
      ...(examples.length ? [] : ["no_submitted_human_equipment_labels"]),
      ...this.#queue.blockedReasons.filter((reason) => reason !== "all_items_require_human_review"),
    ];
    const splitCounts = countBy(examples.map((example) => example.split));
    return {
      schemaVersion: "maxpower-equipment-training-dataset/v1",
      queueSha256: this.#queueSha256,
      sourceManifestSha256: this.#queue.sourceManifestSha256,
      splitPolicy: this.#queue.splitPolicy,
      status: !examples.length
        ? "blocked_no_human_labels"
        : blockedReasons.length
          ? "blocked_data_quality"
          : "research_candidate",
      promotionAllowed: false,
      stats: {
        queueItemCount: this.#items.size,
        eligibleItemCount: examples.length,
        trainItemCount: splitCounts.train ?? 0,
        validationItemCount: splitCounts.validation ?? 0,
        testItemCount: splitCounts.test ?? 0,
        disagreementCount,
      },
      blockedReasons,
      examples,
    };
  }

  async save(raw: unknown): Promise<EquipmentReviewEvent> {
    const input = parseReviewInput(raw);
    const item = this.#items.get(input.reviewItemId);
    if (!item) throw new Error("equipment review item not found");
    let result: EquipmentReviewEvent | undefined;
    const operation = this.#writeTail.then(async () => {
      const latest = this.#latestByReviewer(input.reviewItemId)
        .find((event) => event.reviewerId === input.reviewerId);
      if ((latest?.eventId ?? null) !== input.expectedPriorEventId) {
        throw new Error("stale equipment review revision");
      }
      const event: EquipmentReviewEvent = {
        schemaVersion: "maxpower-equipment-review-event/v1",
        eventId: randomUUID(),
        recordedAt: new Date().toISOString(),
        queueSha256: this.#queueSha256,
        sourceManifestSha256: this.#queue.sourceManifestSha256,
        ...input,
        sourceCaptureId: item.sourceCaptureId,
        sourceVideoSha256: item.sourceVideoSha256,
        split: item.split,
        frameIndex: item.frameIndex,
        timestampMs: item.timestampMs,
        imageSha256: item.imageSha256,
        humanTruth: true,
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

  #latestByReviewer(reviewItemId: string): EquipmentReviewEvent[] {
    const latest = new Map<string, EquipmentReviewEvent>();
    for (const event of this.#events) {
      if (event.reviewItemId === reviewItemId) latest.set(event.reviewerId, event);
    }
    return [...latest.values()].sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  }
}

function parseQueue(raw: unknown): EquipmentQueueDocument {
  const value = record(raw, "unsupported equipment review queue");
  if (
    value.schemaVersion !== "maxpower-equipment-review-queue/v1"
    || value.promotionAllowed !== false
    || typeof value.sourceManifestSha256 !== "string"
    || !Array.isArray(value.items)
    || !Array.isArray(value.sourceGroups)
    || !Array.isArray(value.blockedReasons)
  ) {
    throw new Error("unsupported equipment review queue");
  }
  return value as unknown as EquipmentQueueDocument;
}

function parseQueueItem(raw: unknown): EquipmentQueueItem {
  const value = record(raw, "invalid equipment queue item");
  const proposal = record(value.proposal, "invalid equipment proposal");
  const item = {
    ...value,
    reviewItemId: nonEmptyString(value.reviewItemId, "reviewItemId"),
    sourceCaptureId: nonEmptyString(value.sourceCaptureId, "sourceCaptureId"),
    split: enumValue(value.split, ["train", "validation", "test"] as const, "split"),
    frameIndex: safeInteger(value.frameIndex, "frameIndex"),
    timestampMs: safeNumber(value.timestampMs, "timestampMs"),
    proposal: {
      ...proposal,
      kind: enumValue(proposal.kind, ["barbell_shaft"] as const, "proposal.kind"),
      axis: parseAxis(proposal.axis, "proposal.axis"),
      reviewPriority: enumValue(proposal.reviewPriority, ["normal", "high"] as const, "proposal.reviewPriority"),
      humanTruth: false as const,
    },
  } as unknown as EquipmentQueueItem;
  if (value.proposal && proposal.humanTruth !== false) throw new Error("equipment proposal cannot be human truth");
  for (const field of ["sourceVideoSha256", "imageSha256", "previewSha256"] as const) {
    if (typeof item[field] !== "string" || !/^[a-f0-9]{64}$/.test(item[field])) {
      throw new Error(`invalid ${field}`);
    }
  }
  return item;
}

function parseReviewInput(raw: unknown): EquipmentReviewInput {
  const value = record(raw, "invalid equipment review input");
  const reviewerId = nonEmptyString(value.reviewerId, "reviewerId").trim();
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(reviewerId)) throw new Error("invalid reviewerId");
  const target = enumValue(value.target, EQUIPMENT_REVIEW_TARGETS, "target");
  const visible = target === "visible_barbell";
  const axis = value.axis === null ? null : parseAxis(value.axis, "axis");
  const equipmentKind = value.equipmentKind === null
    ? null
    : enumValue(value.equipmentKind, ["barbell_shaft"] as const, "equipmentKind");
  if (visible && (!axis || equipmentKind !== "barbell_shaft")) {
    throw new Error("visible barbell requires a reviewed shaft axis");
  }
  if (!visible && (axis !== null || equipmentKind !== null)) {
    throw new Error("non-visible equipment label cannot retain a shaft axis");
  }
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (note.length > 1_000) throw new Error("equipment review note too long");
  const reviewStatus = enumValue(value.reviewStatus, ["draft", "submitted"] as const, "reviewStatus");
  if (reviewStatus === "submitted" && target === "ambiguous" && note.length < 8) {
    throw new Error("submitted ambiguous equipment review requires a note");
  }
  return {
    reviewItemId: nonEmptyString(value.reviewItemId, "reviewItemId"),
    reviewerId,
    reviewerRole: enumValue(value.reviewerRole, ["owner_observation", "vision_annotator", "vision_reviewer"] as const, "reviewerRole"),
    reviewStatus,
    expectedPriorEventId: value.expectedPriorEventId === null
      ? null
      : nonEmptyString(value.expectedPriorEventId, "expectedPriorEventId"),
    target,
    equipmentKind,
    axis,
    occlusion: enumValue(value.occlusion, ["none", "partial", "heavy", "unknown"] as const, "occlusion"),
    truncated: value.truncated === true,
    note,
  };
}

function parseAxis(raw: unknown, field: string): EquipmentAxis {
  const value = record(raw, `invalid ${field}`);
  const axis = {
    x1: safeNumber(value.x1, `${field}.x1`),
    y1: safeNumber(value.y1, `${field}.y1`),
    x2: safeNumber(value.x2, `${field}.x2`),
    y2: safeNumber(value.y2, `${field}.y2`),
  };
  if (Object.values(axis).some((coordinate) => coordinate < 0 || coordinate > 1)) {
    throw new Error(`invalid ${field} bounds`);
  }
  if (axis.x2 <= axis.x1 || Math.hypot(axis.x2 - axis.x1, axis.y2 - axis.y1) < 0.2) {
    throw new Error(`invalid ${field} length`);
  }
  return axis;
}

async function readEvents(
  path: string,
  items: ReadonlyMap<string, EquipmentQueueItem>,
  queueSha256: string,
  sourceManifestSha256: string,
): Promise<EquipmentReviewEvent[]> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value = record(JSON.parse(line) as unknown, `invalid equipment event at line ${index + 1}`);
    if (value.schemaVersion !== "maxpower-equipment-review-event/v1") {
      throw new Error(`unsupported equipment event at line ${index + 1}`);
    }
    const input = parseReviewInput(value);
    const item = items.get(input.reviewItemId);
    if (
      !item
      || value.queueSha256 !== queueSha256
      || value.sourceManifestSha256 !== sourceManifestSha256
      || value.sourceCaptureId !== item.sourceCaptureId
      || value.sourceVideoSha256 !== item.sourceVideoSha256
      || value.split !== item.split
      || value.frameIndex !== item.frameIndex
      || value.timestampMs !== item.timestampMs
      || value.imageSha256 !== item.imageSha256
      || value.humanTruth !== true
      || value.productionPromotion !== false
      || typeof value.eventId !== "string"
      || !value.eventId
      || typeof value.recordedAt !== "string"
      || !Number.isFinite(Date.parse(value.recordedAt))
    ) {
      throw new Error(`equipment event lineage mismatch at line ${index + 1}`);
    }
    return value as unknown as EquipmentReviewEvent;
  });
}

function reviewsAgree(events: readonly EquipmentReviewEvent[]): boolean {
  const labels = events.map((event) => JSON.stringify([
    event.target,
    event.equipmentKind,
    event.axis,
    event.occlusion,
    event.truncated,
  ]));
  return labels.every((label) => label === labels[0]);
}

function countBy(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
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
