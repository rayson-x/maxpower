import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);

export const DUMBBELL_REVIEW_TARGETS = [
  "visible_dumbbells",
  "no_target_dumbbell",
  "reflection_only",
  "static_rack_only",
  "ambiguous",
] as const;

export type DumbbellReviewTarget = typeof DUMBBELL_REVIEW_TARGETS[number];
export type DumbbellReviewerRole = "owner_observation" | "vision_annotator" | "vision_reviewer";
export type DumbbellOcclusion = "none" | "partial" | "heavy" | "unknown";
export type DumbbellImageSide = "image_left" | "image_right" | "unknown";

export interface DumbbellBox {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface DumbbellInstanceTruth {
  readonly instanceId: string;
  readonly bbox: DumbbellBox;
  readonly imageSide: DumbbellImageSide;
  readonly occlusion: DumbbellOcclusion;
  readonly truncated: boolean;
}

export interface DumbbellReviewInput {
  readonly reviewItemId: string;
  readonly reviewerId: string;
  readonly reviewerRole: DumbbellReviewerRole;
  readonly reviewStatus: "draft" | "submitted";
  readonly expectedPriorEventId: string | null;
  readonly target: DumbbellReviewTarget;
  readonly instances: readonly DumbbellInstanceTruth[];
  readonly note: string;
}

export interface DumbbellQueueItem {
  readonly reviewItemId: string;
  readonly sourceSequenceId: string;
  readonly sourceAction: string;
  readonly exerciseId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly officialSplit: "train";
  readonly split: "train" | "validation" | "test";
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly sampleKind: string;
  readonly setCountTruth: number;
  readonly repBounds: readonly [];
  readonly image: string;
  readonly imageSha256: string;
  readonly proposal: {
    readonly kind: "dumbbell_instances";
    readonly instances: readonly {
      readonly proposalId: string;
      readonly kind: "dumbbell";
      readonly hand: "left" | "right";
      readonly bbox: DumbbellBox;
      readonly source: string;
      readonly humanTruth: false;
    }[];
    readonly source: string;
    readonly humanTruth: false;
  };
}

export interface DumbbellReviewEvent extends DumbbellReviewInput {
  readonly schemaVersion: "maxpower-mmfit-dumbbell-review-event/v1";
  readonly eventId: string;
  readonly recordedAt: string;
  readonly queueSha256: string;
  readonly sourceSequenceId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly split: DumbbellQueueItem["split"];
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly imageSha256: string;
  readonly officialSplit: "train";
  readonly humanTruth: true;
  readonly productionPromotion: false;
}

export interface DumbbellReviewStoreOptions {
  readonly queuePath: string;
  readonly eventsPath: string;
  readonly assetRoot: string;
}

export interface DumbbellTrainingExample {
  readonly reviewItemId: string;
  readonly sourceSequenceId: string;
  readonly sourceAction: string;
  readonly exerciseId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly split: DumbbellQueueItem["split"];
  readonly frameIndex: number;
  readonly timestampMs: number;
  readonly image: string;
  readonly imageSha256: string;
  readonly target: DumbbellReviewTarget;
  readonly instances: readonly DumbbellInstanceTruth[];
  readonly reviewEventRefs: readonly string[];
  readonly humanTruth: true;
}

interface DumbbellQueueDocument {
  readonly schemaVersion: "maxpower-mmfit-dumbbell-review-queue/v1";
  readonly officialSourceSplit: "train";
  readonly excludedOfficialSplits: readonly ["validation", "test", "unseen_test"];
  readonly splitPolicy: string;
  readonly equipmentSplitBySubject: Readonly<Record<string, DumbbellQueueItem["split"]>>;
  readonly promotionAllowed: false;
  readonly blockedReasons: readonly string[];
  readonly materialized: true;
  readonly items: readonly unknown[];
}

export class DumbbellReviewStore {
  readonly #queueSha256: string;
  readonly #queue: DumbbellQueueDocument;
  readonly #items: Map<string, DumbbellQueueItem>;
  readonly #events: DumbbellReviewEvent[];
  readonly #eventsPath: string;
  readonly #assetRoot: string;
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(input: {
    queueSha256: string;
    queue: DumbbellQueueDocument;
    items: Map<string, DumbbellQueueItem>;
    events: DumbbellReviewEvent[];
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

  static async open(options: DumbbellReviewStoreOptions): Promise<DumbbellReviewStore> {
    const compressed = await readFile(options.queuePath);
    const queueSha256 = createHash("sha256").update(compressed).digest("hex");
    const queue = parseQueue(JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as unknown);
    const items = new Map<string, DumbbellQueueItem>();
    for (const candidate of queue.items) {
      const item = parseQueueItem(candidate);
      if (items.has(item.reviewItemId)) throw new Error(`duplicate dumbbell review item: ${item.reviewItemId}`);
      if (queue.equipmentSplitBySubject[item.subjectId] !== item.split) {
        throw new Error(`dumbbell subject crosses split: ${item.subjectId}`);
      }
      items.set(item.reviewItemId, item);
    }
    const events = await readEvents(options.eventsPath, items, queueSha256);
    return new DumbbellReviewStore({
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
        : submitted.length
          ? "submitted"
          : latestByReviewer.length
            ? "draft"
            : "unreviewed";
      return {
        reviewItemId: item.reviewItemId,
        sourceSequenceId: item.sourceSequenceId,
        sourceAction: item.sourceAction,
        exerciseId: item.exerciseId,
        subjectId: item.subjectId,
        sessionId: item.sessionId,
        split: item.split,
        frameIndex: item.frameIndex,
        timestampMs: item.timestampMs,
        sampleKind: item.sampleKind,
        proposalCount: item.proposal.instances.length,
        status,
        target: submitted[0]?.target ?? null,
      };
    });
    const statusCounts = countBy(items.map((item) => item.status));
    const splitCounts = countBy(items.map((item) => item.split));
    return {
      schemaVersion: "maxpower-mmfit-dumbbell-review-index/v1",
      queueSha256: this.#queueSha256,
      splitPolicy: this.#queue.splitPolicy,
      officialSourceSplit: "train",
      excludedOfficialSplits: this.#queue.excludedOfficialSplits,
      promotionAllowed: false,
      blockedReasons: this.#queue.blockedReasons,
      stats: {
        itemCount: items.length,
        subjectCount: Object.keys(this.#queue.equipmentSplitBySubject).length,
        submittedItems: statusCounts.submitted ?? 0,
        disagreementItems: statusCounts.disagreement ?? 0,
        draftItems: statusCounts.draft ?? 0,
        unreviewedItems: statusCounts.unreviewed ?? 0,
        trainItems: splitCounts.train ?? 0,
        validationItems: splitCounts.validation ?? 0,
        testItems: splitCounts.test ?? 0,
        dumbbellActionItems: items.filter((item) => item.proposalCount > 0).length,
        backgroundActionItems: items.filter((item) => item.proposalCount === 0).length,
      },
      items,
    };
  }

  detail(reviewItemId: string): unknown {
    const item = this.#items.get(reviewItemId);
    if (!item) throw new Error("dumbbell review item not found");
    return {
      schemaVersion: "maxpower-mmfit-dumbbell-review-detail/v1",
      queueSha256: this.#queueSha256,
      item,
      imageUrl: `/media/dumbbell?id=${encodeURIComponent(reviewItemId)}`,
      latestByReviewer: this.#latestByReviewer(reviewItemId),
    };
  }

  asset(reviewItemId: string): { path: string; sha256: string } {
    const item = this.#items.get(reviewItemId);
    if (!item) throw new Error("dumbbell review item not found");
    const path = resolve(this.#assetRoot, item.image);
    if (!path.startsWith(`${this.#assetRoot}${sep}`)) throw new Error("dumbbell asset not found");
    return { path, sha256: item.imageSha256 };
  }

  trainingDataset(): unknown {
    const examples: DumbbellTrainingExample[] = [];
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
        sourceSequenceId: item.sourceSequenceId,
        sourceAction: item.sourceAction,
        exerciseId: item.exerciseId,
        subjectId: item.subjectId,
        sessionId: item.sessionId,
        split: item.split,
        frameIndex: item.frameIndex,
        timestampMs: item.timestampMs,
        image: item.image,
        imageSha256: item.imageSha256,
        target: agreed.target,
        instances: agreed.instances,
        reviewEventRefs: submitted.map((event) => `dumbbell_review_event:${event.eventId}`).sort(),
        humanTruth: true,
      });
    }
    const splitCounts = countBy(examples.map((example) => example.split));
    const visibleCount = examples.filter((example) => example.target === "visible_dumbbells").length;
    const hardNegativeCount = examples.filter((example) => example.target !== "visible_dumbbells" && example.target !== "ambiguous").length;
    const blockedReasons = [
      ...(examples.length ? [] : ["no_submitted_human_dumbbell_labels"]),
      ...(visibleCount ? [] : ["no_visible_dumbbell_truth"]),
      ...(hardNegativeCount ? [] : ["no_human_hard_negatives"]),
      ...(splitCounts.train ? [] : ["no_train_labels"]),
      ...(splitCounts.validation ? [] : ["no_validation_labels"]),
      ...(splitCounts.test ? [] : ["no_frozen_test_labels"]),
    ];
    return {
      schemaVersion: "maxpower-mmfit-dumbbell-training-dataset/v1",
      queueSha256: this.#queueSha256,
      splitPolicy: this.#queue.splitPolicy,
      status: !examples.length
        ? "blocked_no_human_labels"
        : blockedReasons.length
          ? "blocked_data_quality"
          : "research_candidate",
      promotionAllowed: false,
      researchLimitations: [
        "official_train_inner_holdout_is_not_official_test",
        "mmfit_set_count_is_not_rep_phase_or_technique_truth",
      ],
      stats: {
        queueItemCount: this.#items.size,
        eligibleItemCount: examples.length,
        trainItemCount: splitCounts.train ?? 0,
        validationItemCount: splitCounts.validation ?? 0,
        testItemCount: splitCounts.test ?? 0,
        visibleItemCount: visibleCount,
        hardNegativeItemCount: hardNegativeCount,
        disagreementCount,
      },
      blockedReasons,
      examples,
    };
  }

  async save(raw: unknown): Promise<DumbbellReviewEvent> {
    const input = parseReviewInput(raw);
    const item = this.#items.get(input.reviewItemId);
    if (!item) throw new Error("dumbbell review item not found");
    let result: DumbbellReviewEvent | undefined;
    const operation = this.#writeTail.then(async () => {
      const latest = this.#latestByReviewer(input.reviewItemId)
        .find((event) => event.reviewerId === input.reviewerId);
      if ((latest?.eventId ?? null) !== input.expectedPriorEventId) {
        throw new Error("stale dumbbell review revision");
      }
      const event: DumbbellReviewEvent = {
        schemaVersion: "maxpower-mmfit-dumbbell-review-event/v1",
        eventId: randomUUID(),
        recordedAt: new Date().toISOString(),
        queueSha256: this.#queueSha256,
        ...input,
        sourceSequenceId: item.sourceSequenceId,
        subjectId: item.subjectId,
        sessionId: item.sessionId,
        split: item.split,
        frameIndex: item.frameIndex,
        timestampMs: item.timestampMs,
        imageSha256: item.imageSha256,
        officialSplit: "train",
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

  #latestByReviewer(reviewItemId: string): DumbbellReviewEvent[] {
    const latest = new Map<string, DumbbellReviewEvent>();
    for (const event of this.#events) {
      if (event.reviewItemId === reviewItemId) latest.set(event.reviewerId, event);
    }
    return [...latest.values()].sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  }
}

function parseQueue(raw: unknown): DumbbellQueueDocument {
  const value = record(raw, "unsupported MM-Fit dumbbell review queue");
  if (
    value.schemaVersion !== "maxpower-mmfit-dumbbell-review-queue/v1"
    || value.officialSourceSplit !== "train"
    || value.promotionAllowed !== false
    || value.materialized !== true
    || !Array.isArray(value.items)
    || !Array.isArray(value.blockedReasons)
    || !value.equipmentSplitBySubject
  ) throw new Error("unsupported MM-Fit dumbbell review queue");
  return value as unknown as DumbbellQueueDocument;
}

function parseQueueItem(raw: unknown): DumbbellQueueItem {
  const value = record(raw, "invalid dumbbell queue item");
  const proposal = record(value.proposal, "invalid dumbbell proposal");
  if (value.officialSplit !== "train" || value.repBounds && (!Array.isArray(value.repBounds) || value.repBounds.length)) {
    throw new Error("dumbbell queue supervision changed");
  }
  if (proposal.kind !== "dumbbell_instances" || proposal.humanTruth !== false || !Array.isArray(proposal.instances)) {
    throw new Error("invalid dumbbell proposal");
  }
  const instances = proposal.instances.map((candidate, index) => {
    const instance = record(candidate, `invalid dumbbell proposal instance ${index}`);
    if (instance.kind !== "dumbbell" || instance.humanTruth !== false) throw new Error("dumbbell proposal cannot be human truth");
    return { ...instance, bbox: parseBox(instance.bbox, `proposal.instances.${index}.bbox`) };
  });
  const item = {
    ...value,
    reviewItemId: nonEmptyString(value.reviewItemId, "reviewItemId"),
    sourceSequenceId: nonEmptyString(value.sourceSequenceId, "sourceSequenceId"),
    subjectId: nonEmptyString(value.subjectId, "subjectId"),
    sessionId: nonEmptyString(value.sessionId, "sessionId"),
    split: enumValue(value.split, ["train", "validation", "test"] as const, "split"),
    frameIndex: safeInteger(value.frameIndex, "frameIndex"),
    timestampMs: safeNumber(value.timestampMs, "timestampMs"),
    proposal: { ...proposal, instances, humanTruth: false as const },
  } as unknown as DumbbellQueueItem;
  if (!/^[a-f0-9]{64}$/.test(item.imageSha256)) throw new Error("invalid imageSha256");
  return item;
}

function parseReviewInput(raw: unknown): DumbbellReviewInput {
  const value = record(raw, "invalid dumbbell review input");
  const reviewerId = nonEmptyString(value.reviewerId, "reviewerId").trim();
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(reviewerId)) throw new Error("invalid reviewerId");
  const target = enumValue(value.target, DUMBBELL_REVIEW_TARGETS, "target");
  if (!Array.isArray(value.instances)) throw new Error("invalid dumbbell instances");
  const instances = value.instances.map((candidate, index) => parseInstance(candidate, index));
  const visible = target === "visible_dumbbells";
  if (visible && (instances.length < 1 || instances.length > 4)) {
    throw new Error("visible dumbbells require one to four reviewed boxes");
  }
  if (!visible && instances.length) throw new Error("non-visible dumbbell label cannot retain boxes");
  if (new Set(instances.map((instance) => instance.instanceId)).size !== instances.length) {
    throw new Error("duplicate dumbbell instanceId");
  }
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (note.length > 1_000) throw new Error("dumbbell review note too long");
  const reviewStatus = enumValue(value.reviewStatus, ["draft", "submitted"] as const, "reviewStatus");
  if (reviewStatus === "submitted" && target === "ambiguous" && note.length < 8) {
    throw new Error("submitted ambiguous dumbbell review requires a note");
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
    instances,
    note,
  };
}

function parseInstance(raw: unknown, index: number): DumbbellInstanceTruth {
  const value = record(raw, `invalid dumbbell instance ${index}`);
  const instanceId = nonEmptyString(value.instanceId, `instances.${index}.instanceId`);
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(instanceId)) throw new Error("invalid dumbbell instanceId");
  return {
    instanceId,
    bbox: parseBox(value.bbox, `instances.${index}.bbox`),
    imageSide: enumValue(value.imageSide, ["image_left", "image_right", "unknown"] as const, "imageSide"),
    occlusion: enumValue(value.occlusion, ["none", "partial", "heavy", "unknown"] as const, "occlusion"),
    truncated: value.truncated === true,
  };
}

function parseBox(raw: unknown, field: string): DumbbellBox {
  const value = record(raw, `invalid ${field}`);
  const box = {
    x1: safeNumber(value.x1, `${field}.x1`),
    y1: safeNumber(value.y1, `${field}.y1`),
    x2: safeNumber(value.x2, `${field}.x2`),
    y2: safeNumber(value.y2, `${field}.y2`),
  };
  if (Object.values(box).some((coordinate) => coordinate < 0 || coordinate > 1)
    || box.x2 - box.x1 < 0.01 || box.y2 - box.y1 < 0.01) {
    throw new Error(`invalid ${field} bounds`);
  }
  return box;
}

async function readEvents(
  path: string,
  items: ReadonlyMap<string, DumbbellQueueItem>,
  queueSha256: string,
): Promise<DumbbellReviewEvent[]> {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value = record(JSON.parse(line) as unknown, `invalid dumbbell event at line ${index + 1}`);
    if (value.schemaVersion !== "maxpower-mmfit-dumbbell-review-event/v1") {
      throw new Error(`unsupported dumbbell event at line ${index + 1}`);
    }
    const input = parseReviewInput(value);
    const item = items.get(input.reviewItemId);
    if (
      !item
      || value.queueSha256 !== queueSha256
      || value.sourceSequenceId !== item.sourceSequenceId
      || value.subjectId !== item.subjectId
      || value.sessionId !== item.sessionId
      || value.split !== item.split
      || value.frameIndex !== item.frameIndex
      || value.timestampMs !== item.timestampMs
      || value.imageSha256 !== item.imageSha256
      || value.officialSplit !== "train"
      || value.humanTruth !== true
      || value.productionPromotion !== false
      || typeof value.eventId !== "string"
      || !value.eventId
      || typeof value.recordedAt !== "string"
      || !Number.isFinite(Date.parse(value.recordedAt))
    ) throw new Error(`dumbbell event lineage mismatch at line ${index + 1}`);
    return value as unknown as DumbbellReviewEvent;
  });
}

function reviewsAgree(events: readonly DumbbellReviewEvent[]): boolean {
  const label = (event: DumbbellReviewEvent) => JSON.stringify([
    event.target,
    [...event.instances].sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
  ]);
  const labels = events.map(label);
  return labels.every((value) => value === labels[0]);
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
