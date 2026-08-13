import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

const gunzipAsync = promisify(gunzip);
const JOINT_STATUSES = ["visible", "occluded", "ambiguous", "outside_frame"] as const;
const REVIEWER_ROLES = ["owner_observation", "vision_annotator", "vision_reviewer"] as const;

export type PoseJointStatus = typeof JOINT_STATUSES[number];
export type PoseReviewerRole = typeof REVIEWER_ROLES[number];

export interface PoseJointTruth {
  readonly index: number;
  readonly name: string;
  readonly status: PoseJointStatus;
  readonly x: number | null;
  readonly y: number | null;
}

export interface PoseKeypointReviewInput {
  readonly reviewItemId: string;
  readonly reviewerId: string;
  readonly reviewerRole: PoseReviewerRole;
  readonly reviewStatus: "draft" | "submitted";
  readonly expectedPriorEventId: string | null;
  readonly joints: readonly PoseJointTruth[];
  readonly note: string;
}

export interface PoseModelPoint {
  readonly index: number;
  readonly name: string;
  readonly x: number | null;
  readonly y: number | null;
  readonly score: number;
  readonly humanTruth: false;
  readonly source?: string;
  readonly predicted?: boolean;
  readonly renderable?: boolean;
  readonly usable?: boolean;
}

export interface PoseKeypointQueueItem {
  readonly reviewItemId: string;
  readonly sourceCaptureId: string;
  readonly exerciseId: "barbell_bench_press";
  readonly capturePosition: "front";
  readonly equipmentContext: "barbell";
  readonly mirrorPresent: true;
  readonly split: "test";
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly selectionReason: string;
  readonly phaseContext: { readonly repIndex: number; readonly phase: "start" | "peak" | "end" } | null;
  readonly image: string;
  readonly imageSha256: string;
  readonly rawRtmpose: { readonly timestampMs: number; readonly requiredJoints: readonly PoseModelPoint[]; readonly humanTruth: false };
  readonly rustCanonical: { readonly timestampMs: number; readonly requiredJoints: readonly PoseModelPoint[]; readonly humanTruth: false };
  readonly humanTruth: false;
}

export interface PoseKeypointAcceptance {
  readonly pckThresholdTorsoRatio: number;
  readonly requiredJointPckMinimum: number;
  readonly requiredJointUsableFrameRateMinimum: number;
  readonly occludedOrAmbiguousMeasuredOverclaimMaximum: number;
  readonly minimumHumanKeypointFramesPerExactContext: number;
}

interface PoseQueueDocument {
  readonly schemaVersion: "maxpower-personal-pose-keypoint-review-queue/v1";
  readonly poseSchema: "halpe26";
  readonly splitPolicy: string;
  readonly allItemsFrozenTest: true;
  readonly trainerReadable: false;
  readonly productionPromotion: false;
  readonly materialized: true;
  readonly requiredJoints: readonly { readonly index: number; readonly name: string }[];
  readonly modelFreeze: Readonly<Record<string, string>>;
  readonly acceptance: PoseKeypointAcceptance;
  readonly blockedReasons: readonly string[];
  readonly items: readonly unknown[];
}

export interface PoseKeypointReviewEvent extends PoseKeypointReviewInput {
  readonly schemaVersion: "maxpower-personal-pose-keypoint-review-event/v1";
  readonly eventId: string;
  readonly recordedAt: string;
  readonly queueSha256: string;
  readonly sourceCaptureId: string;
  readonly split: "test";
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly imageSha256: string;
  readonly modelFreeze: Readonly<Record<string, string>>;
  readonly humanTruth: true;
  readonly trainerReadable: false;
  readonly productionPromotion: false;
}

export interface PoseKeypointReviewStoreOptions {
  readonly queuePath: string;
  readonly eventsPath: string;
  readonly assetRoot: string;
}

export interface PoseKeypointEvaluationExample {
  readonly reviewItemId: string;
  readonly sourceCaptureId: string;
  readonly exerciseId: "barbell_bench_press";
  readonly capturePosition: "front";
  readonly equipmentContext: "barbell";
  readonly mirrorPresent: true;
  readonly split: "test";
  readonly frameNumber: number;
  readonly timestampMs: number;
  readonly selectionReason: string;
  readonly phaseContext: PoseKeypointQueueItem["phaseContext"];
  readonly image: string;
  readonly imageSha256: string;
  readonly rawRtmpose: PoseKeypointQueueItem["rawRtmpose"];
  readonly rustCanonical: PoseKeypointQueueItem["rustCanonical"];
  readonly joints: readonly PoseJointTruth[];
  readonly reviewEventRefs: readonly string[];
  readonly humanTruth: true;
  readonly trainerReadable: false;
}

export interface PoseKeypointEvaluationDataset {
  readonly schemaVersion: "maxpower-personal-pose-keypoint-evaluation-dataset/v1";
  readonly queueSha256: string;
  readonly status: "research_evaluable" | "blocked_incomplete_human_truth";
  readonly split: "test";
  readonly trainerReadable: false;
  readonly productionPromotion: false;
  readonly requiredJoints: readonly { readonly index: number; readonly name: string }[];
  readonly acceptance: PoseKeypointAcceptance;
  readonly modelFreeze: Readonly<Record<string, string>>;
  readonly stats: {
    readonly queueItemCount: number;
    readonly eligibleItemCount: number;
    readonly disagreementCount: number;
  };
  readonly blockedReasons: readonly string[];
  readonly examples: readonly PoseKeypointEvaluationExample[];
}

export class PoseKeypointReviewStore {
  readonly #queueSha256: string;
  readonly #queue: PoseQueueDocument;
  readonly #items: Map<string, PoseKeypointQueueItem>;
  readonly #events: PoseKeypointReviewEvent[];
  readonly #eventsPath: string;
  readonly #assetRoot: string;
  #writeTail: Promise<void> = Promise.resolve();

  private constructor(input: {
    queueSha256: string;
    queue: PoseQueueDocument;
    items: Map<string, PoseKeypointQueueItem>;
    events: PoseKeypointReviewEvent[];
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

  static async open(options: PoseKeypointReviewStoreOptions): Promise<PoseKeypointReviewStore> {
    const compressed = await readFile(options.queuePath);
    const queueSha256 = createHash("sha256").update(compressed).digest("hex");
    const queue = parseQueue(JSON.parse((await gunzipAsync(compressed)).toString("utf8")) as unknown);
    const items = new Map<string, PoseKeypointQueueItem>();
    for (const raw of queue.items) {
      const item = parseQueueItem(raw, queue.requiredJoints);
      if (items.has(item.reviewItemId)) throw new Error(`duplicate pose review item: ${item.reviewItemId}`);
      items.set(item.reviewItemId, item);
    }
    const events = await readEvents(options.eventsPath, items, queue, queueSha256);
    return new PoseKeypointReviewStore({ queueSha256, queue, items, events, eventsPath: options.eventsPath, assetRoot: options.assetRoot });
  }

  index(): unknown {
    const items = [...this.#items.values()].map((item) => {
      const latest = this.#latestByReviewer(item.reviewItemId);
      const submitted = latest.filter((event) => event.reviewStatus === "submitted");
      const consensus = submitted.length ? consensusJoints(submitted) : null;
      return {
        reviewItemId: item.reviewItemId,
        sourceCaptureId: item.sourceCaptureId,
        split: item.split,
        frameNumber: item.frameNumber,
        timestampMs: item.timestampMs,
        selectionReason: item.selectionReason,
        phaseContext: item.phaseContext,
        minimumRawScore: Math.min(...item.rawRtmpose.requiredJoints.map((point) => point.score)),
        status: submitted.length
          ? consensus ? "submitted" : "disagreement"
          : latest.length ? "draft" : "unreviewed",
      };
    });
    const counts = countBy(items.map((item) => item.status));
    return {
      schemaVersion: "maxpower-personal-pose-keypoint-review-index/v1",
      queueSha256: this.#queueSha256,
      splitPolicy: this.#queue.splitPolicy,
      allItemsFrozenTest: true,
      trainerReadable: false,
      productionPromotion: false,
      modelFreeze: this.#queue.modelFreeze,
      acceptance: this.#queue.acceptance,
      blockedReasons: this.#queue.blockedReasons,
      requiredJoints: this.#queue.requiredJoints,
      stats: {
        itemCount: items.length,
        sourceCaptureCount: new Set(items.map((item) => item.sourceCaptureId)).size,
        submittedItems: counts.submitted ?? 0,
        disagreementItems: counts.disagreement ?? 0,
        draftItems: counts.draft ?? 0,
        unreviewedItems: counts.unreviewed ?? 0,
      },
      items,
    };
  }

  detail(reviewItemId: string): unknown {
    const item = this.#items.get(reviewItemId);
    if (!item) throw new Error("pose keypoint review item not found");
    return {
      schemaVersion: "maxpower-personal-pose-keypoint-review-detail/v1",
      queueSha256: this.#queueSha256,
      requiredJoints: this.#queue.requiredJoints,
      item,
      imageUrl: `/media/pose-keypoint?id=${encodeURIComponent(reviewItemId)}`,
      latestByReviewer: this.#latestByReviewer(reviewItemId),
    };
  }

  asset(reviewItemId: string): { path: string; sha256: string } {
    const item = this.#items.get(reviewItemId);
    if (!item) throw new Error("pose keypoint asset not found");
    const path = resolve(this.#assetRoot, item.image);
    if (!path.startsWith(`${this.#assetRoot}${sep}`)) throw new Error("pose keypoint asset not found");
    return { path, sha256: item.imageSha256 };
  }

  evaluationDataset(): PoseKeypointEvaluationDataset {
    const examples: PoseKeypointEvaluationExample[] = [];
    let disagreementCount = 0;
    for (const item of this.#items.values()) {
      const submitted = this.#latestByReviewer(item.reviewItemId).filter((event) => event.reviewStatus === "submitted");
      if (!submitted.length) continue;
      const joints = consensusJoints(submitted);
      if (!joints) {
        disagreementCount += 1;
        continue;
      }
      examples.push({
        reviewItemId: item.reviewItemId,
        sourceCaptureId: item.sourceCaptureId,
        exerciseId: item.exerciseId,
        capturePosition: item.capturePosition,
        equipmentContext: item.equipmentContext,
        mirrorPresent: item.mirrorPresent,
        split: "test",
        frameNumber: item.frameNumber,
        timestampMs: item.timestampMs,
        selectionReason: item.selectionReason,
        phaseContext: item.phaseContext,
        image: item.image,
        imageSha256: item.imageSha256,
        rawRtmpose: item.rawRtmpose,
        rustCanonical: item.rustCanonical,
        joints,
        reviewEventRefs: submitted.map((event) => `pose_keypoint_review_event:${event.eventId}`).sort(),
        humanTruth: true,
        trainerReadable: false,
      });
    }
    const blockedReasons = [
      ...(examples.length === this.#items.size ? [] : ["not_all_frozen_pose_frames_reviewed"]),
      ...(disagreementCount ? ["pose_keypoint_review_disagreement"] : []),
      "single_known_person_cannot_prove_cross_user_pose_generalization",
    ];
    return {
      schemaVersion: "maxpower-personal-pose-keypoint-evaluation-dataset/v1",
      queueSha256: this.#queueSha256,
      status: blockedReasons.length === 1 && examples.length === this.#items.size ? "research_evaluable" : "blocked_incomplete_human_truth",
      split: "test",
      trainerReadable: false,
      productionPromotion: false,
      requiredJoints: this.#queue.requiredJoints,
      acceptance: this.#queue.acceptance,
      modelFreeze: this.#queue.modelFreeze,
      stats: { queueItemCount: this.#items.size, eligibleItemCount: examples.length, disagreementCount },
      blockedReasons,
      examples,
    };
  }

  async save(raw: unknown): Promise<PoseKeypointReviewEvent> {
    const input = parseReviewInput(raw, this.#queue.requiredJoints);
    const item = this.#items.get(input.reviewItemId);
    if (!item) throw new Error("pose keypoint review item not found");
    let result: PoseKeypointReviewEvent | undefined;
    const operation = this.#writeTail.then(async () => {
      const latest = this.#latestByReviewer(input.reviewItemId).find((event) => event.reviewerId === input.reviewerId);
      if ((latest?.eventId ?? null) !== input.expectedPriorEventId) throw new Error("stale pose keypoint review revision");
      const event: PoseKeypointReviewEvent = {
        schemaVersion: "maxpower-personal-pose-keypoint-review-event/v1",
        eventId: randomUUID(),
        recordedAt: new Date().toISOString(),
        queueSha256: this.#queueSha256,
        ...input,
        sourceCaptureId: item.sourceCaptureId,
        split: "test",
        frameNumber: item.frameNumber,
        timestampMs: item.timestampMs,
        imageSha256: item.imageSha256,
        modelFreeze: this.#queue.modelFreeze,
        humanTruth: true,
        trainerReadable: false,
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

  #latestByReviewer(reviewItemId: string): PoseKeypointReviewEvent[] {
    const latest = new Map<string, PoseKeypointReviewEvent>();
    for (const event of this.#events) if (event.reviewItemId === reviewItemId) latest.set(event.reviewerId, event);
    return [...latest.values()].sort((left, right) => left.reviewerId.localeCompare(right.reviewerId));
  }
}

function parseQueue(raw: unknown): PoseQueueDocument {
  const value = record(raw, "unsupported pose keypoint review queue");
  if (
    value.schemaVersion !== "maxpower-personal-pose-keypoint-review-queue/v1"
    || value.poseSchema !== "halpe26"
    || value.allItemsFrozenTest !== true
    || value.trainerReadable !== false
    || value.productionPromotion !== false
    || value.materialized !== true
    || !Array.isArray(value.requiredJoints)
    || value.requiredJoints.length !== 8
    || !Array.isArray(value.items)
  ) throw new Error("unsupported pose keypoint review queue");
  const acceptance = parseAcceptance(value.acceptance);
  return { ...value, acceptance } as unknown as PoseQueueDocument;
}

function parseAcceptance(raw: unknown): PoseKeypointAcceptance {
  const value = record(raw, "invalid pose keypoint acceptance");
  const acceptance: PoseKeypointAcceptance = {
    pckThresholdTorsoRatio: safeNumber(value.pckThresholdTorsoRatio, "acceptance.pckThresholdTorsoRatio"),
    requiredJointPckMinimum: safeNumber(value.requiredJointPckMinimum, "acceptance.requiredJointPckMinimum"),
    requiredJointUsableFrameRateMinimum: safeNumber(value.requiredJointUsableFrameRateMinimum, "acceptance.requiredJointUsableFrameRateMinimum"),
    occludedOrAmbiguousMeasuredOverclaimMaximum: safeNumber(value.occludedOrAmbiguousMeasuredOverclaimMaximum, "acceptance.occludedOrAmbiguousMeasuredOverclaimMaximum"),
    minimumHumanKeypointFramesPerExactContext: safeInteger(value.minimumHumanKeypointFramesPerExactContext, "acceptance.minimumHumanKeypointFramesPerExactContext"),
  };
  if (
    !(acceptance.pckThresholdTorsoRatio > 0 && acceptance.pckThresholdTorsoRatio <= 1)
    || !(acceptance.requiredJointPckMinimum > 0 && acceptance.requiredJointPckMinimum <= 1)
    || !(acceptance.requiredJointUsableFrameRateMinimum > 0 && acceptance.requiredJointUsableFrameRateMinimum <= 1)
    || !(acceptance.occludedOrAmbiguousMeasuredOverclaimMaximum >= 0 && acceptance.occludedOrAmbiguousMeasuredOverclaimMaximum <= 1)
    || acceptance.minimumHumanKeypointFramesPerExactContext < 1
  ) throw new Error("invalid pose keypoint acceptance");
  return acceptance;
}

function parseQueueItem(raw: unknown, expectedJoints: PoseQueueDocument["requiredJoints"]): PoseKeypointQueueItem {
  const value = record(raw, "invalid pose keypoint queue item");
  if (value.split !== "test" || value.humanTruth !== false || value.exerciseId !== "barbell_bench_press" || value.capturePosition !== "front") {
    throw new Error("pose keypoint queue supervision changed");
  }
  const rawRtmpose = parseModelObservation(value.rawRtmpose, expectedJoints, false);
  const rustCanonical = parseModelObservation(value.rustCanonical, expectedJoints, true);
  const item = { ...value, rawRtmpose, rustCanonical } as unknown as PoseKeypointQueueItem;
  if (!/^[a-f0-9]{64}$/.test(item.imageSha256)) throw new Error("invalid pose keypoint imageSha256");
  safeInteger(item.frameNumber, "frameNumber");
  safeNumber(item.timestampMs, "timestampMs");
  return item;
}

function parseModelObservation(raw: unknown, expected: PoseQueueDocument["requiredJoints"], canonical: boolean): unknown {
  const value = record(raw, "invalid model pose observation");
  if (value.humanTruth !== false || !Array.isArray(value.requiredJoints) || value.requiredJoints.length !== expected.length) {
    throw new Error("model pose cannot be human truth");
  }
  const requiredJoints = value.requiredJoints.map((rawPoint, position) => {
    const point = record(rawPoint, `invalid model point ${position}`);
    const expectedPoint = expected[position]!;
    if (point.index !== expectedPoint.index || point.name !== expectedPoint.name || point.humanTruth !== false) throw new Error("model joint topology changed");
    nullableCoordinate(point.x, `model.${position}.x`);
    nullableCoordinate(point.y, `model.${position}.y`);
    safeNumber(point.score, `model.${position}.score`);
    if (canonical && typeof point.source !== "string") throw new Error("canonical model point source missing");
    return point;
  });
  return { ...value, requiredJoints };
}

function parseReviewInput(raw: unknown, expected: PoseQueueDocument["requiredJoints"]): PoseKeypointReviewInput {
  const value = record(raw, "invalid pose keypoint review input");
  const reviewerId = nonEmptyString(value.reviewerId, "reviewerId").trim();
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(reviewerId)) throw new Error("invalid reviewerId");
  if (!Array.isArray(value.joints) || value.joints.length !== expected.length) throw new Error("pose review requires all required joints");
  const joints = value.joints.map((rawJoint, position) => {
    const joint = record(rawJoint, `invalid truth joint ${position}`);
    const expectedJoint = expected[position]!;
    if (joint.index !== expectedJoint.index || joint.name !== expectedJoint.name) throw new Error("truth joint topology changed");
    const status = enumValue(joint.status, JOINT_STATUSES, `joints.${position}.status`);
    const x = nullableCoordinate(joint.x, `joints.${position}.x`);
    const y = nullableCoordinate(joint.y, `joints.${position}.y`);
    if (status === "visible" && (x === null || y === null)) throw new Error("visible truth joint requires coordinates");
    if (status !== "visible" && (x !== null || y !== null)) throw new Error("non-visible truth joint cannot retain coordinates");
    return { index: expectedJoint.index, name: expectedJoint.name, status, x, y };
  });
  const note = typeof value.note === "string" ? value.note.trim() : "";
  if (note.length > 1_000) throw new Error("pose keypoint review note too long");
  const reviewStatus = enumValue(value.reviewStatus, ["draft", "submitted"] as const, "reviewStatus");
  if (reviewStatus === "submitted" && joints.every((joint) => joint.status !== "visible") && note.length < 8) {
    throw new Error("submitted all-non-visible pose review requires a note");
  }
  return {
    reviewItemId: nonEmptyString(value.reviewItemId, "reviewItemId"),
    reviewerId,
    reviewerRole: enumValue(value.reviewerRole, REVIEWER_ROLES, "reviewerRole"),
    reviewStatus,
    expectedPriorEventId: value.expectedPriorEventId === null ? null : nonEmptyString(value.expectedPriorEventId, "expectedPriorEventId"),
    joints,
    note,
  };
}

function consensusJoints(events: readonly PoseKeypointReviewEvent[]): PoseJointTruth[] | null {
  if (!events.length) return null;
  const output: PoseJointTruth[] = [];
  for (let index = 0; index < events[0]!.joints.length; index += 1) {
    const candidates = events.map((event) => event.joints[index]!);
    if (!candidates.every((joint) => joint.status === candidates[0]!.status)) return null;
    const first = candidates[0]!;
    if (first.status !== "visible") {
      output.push(first);
      continue;
    }
    const xs = candidates.map((joint) => joint.x!);
    const ys = candidates.map((joint) => joint.y!);
    for (let left = 0; left < candidates.length; left += 1) {
      for (let right = left + 1; right < candidates.length; right += 1) {
        if (Math.hypot(xs[left]! - xs[right]!, ys[left]! - ys[right]!) > 0.02) return null;
      }
    }
    output.push({ ...first, x: mean(xs), y: mean(ys) });
  }
  return output;
}

async function readEvents(
  path: string,
  items: ReadonlyMap<string, PoseKeypointQueueItem>,
  queue: PoseQueueDocument,
  queueSha256: string,
): Promise<PoseKeypointReviewEvent[]> {
  let text = "";
  try { text = await readFile(path, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    const value = record(JSON.parse(line) as unknown, `invalid pose event at line ${index + 1}`);
    if (value.schemaVersion !== "maxpower-personal-pose-keypoint-review-event/v1") throw new Error(`unsupported pose event at line ${index + 1}`);
    const input = parseReviewInput(value, queue.requiredJoints);
    const item = items.get(input.reviewItemId);
    if (
      !item || value.queueSha256 !== queueSha256 || value.sourceCaptureId !== item.sourceCaptureId
      || value.split !== "test" || value.frameNumber !== item.frameNumber || value.timestampMs !== item.timestampMs
      || value.imageSha256 !== item.imageSha256 || JSON.stringify(value.modelFreeze) !== JSON.stringify(queue.modelFreeze)
      || value.humanTruth !== true || value.trainerReadable !== false || value.productionPromotion !== false
      || typeof value.eventId !== "string" || !value.eventId || typeof value.recordedAt !== "string" || !Number.isFinite(Date.parse(value.recordedAt))
    ) throw new Error(`pose keypoint event lineage mismatch at line ${index + 1}`);
    return value as unknown as PoseKeypointReviewEvent;
  });
}

function mean(values: readonly number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function countBy(values: readonly string[]): Record<string, number> { const result: Record<string, number> = {}; for (const value of values) result[value] = (result[value] ?? 0) + 1; return result; }
function record(value: unknown, message: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message); return value as Record<string, unknown>; }
function nonEmptyString(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) throw new Error(`invalid ${field}`); return value; }
function safeInteger(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`invalid ${field}`); return value; }
function safeNumber(value: unknown, field: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid ${field}`); return value; }
function nullableCoordinate(value: unknown, field: string): number | null { if (value === null) return null; const number = safeNumber(value, field); if (number < 0 || number > 1) throw new Error(`invalid ${field}`); return number; }
function enumValue<const T extends readonly string[]>(value: unknown, allowed: T, field: string): T[number] { if (typeof value !== "string" || !allowed.includes(value)) throw new Error(`invalid ${field}`); return value as T[number]; }
