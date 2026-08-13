import { EXERCISE_REGISTRY, type MuscleGroup } from "./exerciseRegistry";
import type { CameraView } from "./formRuleEngine";
import type { PoseEstimate } from "./PoseEngine";
import type { CapturePosition } from "./viewGating";
import {
  ANNOTATION_INBOX_MANIFEST_VERSION,
  isSafeAnnotationVideoFilename,
  type AnnotationInboxItem,
} from "./annotationInboxContract";

export type { AnnotationInboxItem } from "./annotationInboxContract";

export const ANNOTATION_INBOX_ORIGIN = "http://127.0.0.1:4317";

export interface AnnotationInboxManifest {
  readonly version: typeof ANNOTATION_INBOX_MANIFEST_VERSION;
  readonly items: readonly AnnotationInboxItem[];
}

export interface InboxPoseFixture {
  video: string;
  durationSec: number;
  stepMs: number;
  model: string;
  poses: PoseEstimate[];
}

export interface ReviewedInboxApproval {
  exerciseId: string;
  cameraView: CameraView;
  capturePosition: CapturePosition;
  expectedCount: string;
  approvedAt: string;
  approvedSegments: Array<{
    repIndex: number;
    startMs: number;
    peakMs: number;
    endMs: number;
    note?: string;
  }>;
  candidateId: string;
  note?: string;
}

export function parseAnnotationInboxManifest(value: unknown): AnnotationInboxManifest {
  if (!value || typeof value !== "object") throw new Error("待标注收件箱格式无效。");
  const source = value as { version?: unknown; items?: unknown };
  if (source.version !== ANNOTATION_INBOX_MANIFEST_VERSION || !Array.isArray(source.items)) {
    throw new Error("待标注收件箱缺少版本或视频列表。");
  }
  const ids = new Set<string>();
  const items = source.items.map((value): AnnotationInboxItem => {
    if (!value || typeof value !== "object") throw new Error("待标注收件箱包含无效视频。");
    const item = value as { id?: unknown; filename?: unknown; sizeBytes?: unknown; videoUrl?: unknown };
    if (
      typeof item.id !== "string" || !item.id
      || typeof item.filename !== "string" || !isSafeAnnotationVideoFilename(item.filename)
      || typeof item.sizeBytes !== "number" || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 0
      || typeof item.videoUrl !== "string" || item.videoUrl !== `/videos/${encodeURIComponent(item.filename)}`
    ) {
      throw new Error("待标注视频必须包含安全的 id、文件名、大小和本地地址。");
    }
    if (ids.has(item.id)) throw new Error(`待标注收件箱存在重复 id: ${item.id}`);
    ids.add(item.id);
    return Object.freeze({
      id: item.id,
      filename: item.filename,
      sizeBytes: item.sizeBytes,
      videoUrl: item.videoUrl,
    });
  });
  return Object.freeze({ version: source.version, items: Object.freeze(items) });
}

export async function loadAnnotationInbox(): Promise<AnnotationInboxManifest> {
  const response = await fetch(`${ANNOTATION_INBOX_ORIGIN}/api/annotation-inbox`, { cache: "no-store" });
  if (!response.ok) throw new Error("待标注目录服务不可用；请用 npm run web 启动页面。");
  return parseAnnotationInboxManifest(await response.json());
}

export function annotationInboxVideoUrl(item: AnnotationInboxItem): string {
  return `${ANNOTATION_INBOX_ORIGIN}${item.videoUrl}`;
}

export function buildReviewedInboxArtifacts(input: {
  filename: string;
  fixture: InboxPoseFixture;
  approval: ReviewedInboxApproval;
}): {
  archiveGroup: MuscleGroup;
  keypoints: InboxPoseFixture[];
  labels: Record<string, unknown> & { labels: Array<Record<string, unknown>>; exerciseId: string };
  metadata: Record<string, unknown> & { annotationStatus: "human_approved" };
} {
  if (!isSafeAnnotationVideoFilename(input.filename)) throw new Error("待归档视频文件名不安全。");
  const exercise = EXERCISE_REGISTRY.get(input.approval.exerciseId);
  if (!exercise) throw new Error(`动作未在目录中注册：${input.approval.exerciseId}`);
  if (exercise.maturity !== "catalog_only") {
    throw new Error("待标注收件箱只接受尚无 Rust profile 的 catalog-only 动作真值。");
  }
  const id = input.filename.replace(/\.(mp4|mov|webm)$/i, "");
  const labels = input.approval.approvedSegments.map((segment) => ({
    repIndex: segment.repIndex,
    startMs: segment.startMs,
    extremeMs: segment.peakMs,
    endMs: segment.endMs,
    ...(segment.note ? { note: segment.note } : {}),
  }));
  return {
    archiveGroup: exercise.muscleGroup,
    keypoints: [{ ...input.fixture, video: input.filename }],
    labels: {
      schemaVersion: "maxpower-reviewed-rep-labels/v1",
      videoId: input.filename,
      keypointsFile: `${id}.json`,
      exerciseId: input.approval.exerciseId,
      cameraView: input.approval.cameraView,
      capturePosition: input.approval.capturePosition,
      expectedCount: Number(input.approval.expectedCount),
      approvedAt: input.approval.approvedAt,
      candidateId: input.approval.candidateId,
      labels,
      note: input.approval.note ?? "",
    },
    metadata: {
      schemaVersion: "maxpower-inbox-review/v1",
      annotationStatus: "human_approved",
      source: "annotation_inbox",
      videoId: input.filename,
      keypointsFile: `${id}.json`,
      exerciseId: input.approval.exerciseId,
      cameraView: input.approval.cameraView,
      capturePosition: input.approval.capturePosition,
      model: input.fixture.model,
      canonicalPoseFrameCount: input.fixture.poses.length,
      approvedAt: input.approval.approvedAt,
    },
  };
}

export async function completeReviewedInboxItem(input: {
  item: AnnotationInboxItem;
  fixture: InboxPoseFixture;
  approval: ReviewedInboxApproval;
}): Promise<void> {
  const artifacts = buildReviewedInboxArtifacts({
    filename: input.item.filename,
    fixture: input.fixture,
    approval: input.approval,
  });
  const response = await fetch(`${ANNOTATION_INBOX_ORIGIN}/api/annotation-inbox/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: input.item.filename,
      ...artifacts,
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof result?.error === "string" ? result.error : "标注归档失败。");
  }
}
