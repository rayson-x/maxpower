import { CAPTURE_POSITIONS, type CapturePosition } from "./viewGating";

export type VideoLibraryTrainingSide = "bilateral" | "left" | "right";

export interface VideoLibraryEntry {
  readonly id: string;
  readonly label: string;
  readonly video: string;
  /** Analysis context applied with this known library clip, when available. */
  readonly exerciseId?: string;
  readonly capturePosition?: CapturePosition;
  readonly variation?: string;
  readonly trainingSide?: VideoLibraryTrainingSide;
}

export interface VideoLibraryManifest {
  readonly version: string;
  readonly videos: readonly VideoLibraryEntry[];
}

export interface ConfirmedCaptureManifest {
  readonly captures: readonly ConfirmedCaptureManifestEntry[];
}

export interface ConfirmedCaptureManifestEntry {
  readonly id: string;
  readonly video: string;
  readonly labels?: string;
}

interface ArchivedAnnotation {
  readonly exerciseId?: unknown;
  readonly capturePosition?: unknown;
  readonly variation?: unknown;
  readonly trainingSide?: unknown;
  readonly labels?: unknown;
}

const CONFIRMED_ARCHIVE_ROOT = "archives/confirmed-captures";

/**
 * The training library is deliberately separate from the confirmed-capture
 * archive. Only explicit library entries can appear in the training selector.
 */
export function parseVideoLibraryManifest(value: unknown): VideoLibraryManifest {
  if (!value || typeof value !== "object") throw new Error("视频库清单格式无效。");
  const source = value as { version?: unknown; videos?: unknown };
  if (typeof source.version !== "string" || !Array.isArray(source.videos)) {
    throw new Error("视频库清单缺少版本或视频列表。");
  }
  const ids = new Set<string>();
  const videos = source.videos.map((item): VideoLibraryEntry => {
    if (!item || typeof item !== "object") throw new Error("视频库中存在无效条目。");
    const entry = item as {
      id?: unknown;
      label?: unknown;
      video?: unknown;
      exerciseId?: unknown;
      capturePosition?: unknown;
      variation?: unknown;
      trainingSide?: unknown;
    };
    if (
      typeof entry.id !== "string" || !entry.id ||
      typeof entry.label !== "string" || !entry.label ||
      typeof entry.video !== "string" || !entry.video ||
      entry.video.startsWith("/") || entry.video.includes("..")
    ) {
      throw new Error("视频库条目必须包含安全的 id、标题和相对视频路径。");
    }
    if (ids.has(entry.id)) throw new Error(`视频库存在重复 id: ${entry.id}`);
    if (entry.exerciseId !== undefined && (typeof entry.exerciseId !== "string" || !entry.exerciseId)) {
      throw new Error("视频库动作标识必须是非空字符串。");
    }
    if (
      entry.capturePosition !== undefined
      && (typeof entry.capturePosition !== "string"
        || !CAPTURE_POSITIONS.some((position) => position.id === entry.capturePosition))
    ) {
      throw new Error("视频库机位必须是受支持的实际机位。");
    }
    if (entry.variation !== undefined && typeof entry.variation !== "string") {
      throw new Error("视频库变式必须是字符串。");
    }
    if (
      entry.trainingSide !== undefined
      && entry.trainingSide !== "bilateral"
      && entry.trainingSide !== "left"
      && entry.trainingSide !== "right"
    ) {
      throw new Error("视频库侧别必须为 bilateral、left 或 right。");
    }
    ids.add(entry.id);
    return Object.freeze({
      id: entry.id,
      label: entry.label,
      video: entry.video,
      ...(entry.exerciseId === undefined ? {} : { exerciseId: entry.exerciseId }),
      ...(entry.capturePosition === undefined ? {} : { capturePosition: entry.capturePosition as CapturePosition }),
      ...(entry.variation === undefined ? {} : { variation: entry.variation }),
      ...(entry.trainingSide === undefined ? {} : { trainingSide: entry.trainingSide as VideoLibraryTrainingSide }),
    });
  });
  return Object.freeze({ version: source.version, videos: Object.freeze(videos) });
}

/** Read the local-only confirmed archive without ever exposing an unlabelled clip. */
export function parseConfirmedCaptureManifest(value: unknown): ConfirmedCaptureManifest {
  if (!value || typeof value !== "object" || !Array.isArray((value as { captures?: unknown }).captures)) {
    throw new Error("已确认档案清单格式无效。");
  }
  const ids = new Set<string>();
  const captures = (value as { captures: unknown[] }).captures.map((item): ConfirmedCaptureManifestEntry => {
    if (!item || typeof item !== "object") throw new Error("已确认档案中存在无效条目。");
    const entry = item as { id?: unknown; video?: unknown; labels?: unknown };
    if (
      typeof entry.id !== "string" || !entry.id
      || typeof entry.video !== "string" || !entry.video
      || entry.video.startsWith("/") || entry.video.includes("..")
      || (entry.labels !== undefined && typeof entry.labels !== "string")
      || (typeof entry.labels === "string" && (entry.labels.startsWith("/") || entry.labels.includes("..")))
    ) {
      throw new Error("已确认档案条目必须包含安全的 id、视频和标注路径。");
    }
    if (ids.has(entry.id)) throw new Error(`已确认档案存在重复 id: ${entry.id}`);
    ids.add(entry.id);
    return Object.freeze({
      id: entry.id,
      video: entry.video,
      ...(entry.labels ? { labels: entry.labels } : {}),
    });
  });
  return Object.freeze({ captures: Object.freeze(captures) });
}

/**
 * Builds the training selector from archive entries that actually have rep
 * annotations. Raw/unfinished clips stay in the archive and never appear as
 * candidate training videos.
 */
export function buildVideoLibraryFromConfirmedCaptures(
  manifest: ConfirmedCaptureManifest,
  labelsByCaptureId: Readonly<Record<string, unknown>>,
): VideoLibraryManifest {
  const videos = manifest.captures.flatMap((capture): VideoLibraryEntry[] => {
    if (!capture.labels) return [];
    const annotation = labelsByCaptureId[capture.id] as ArchivedAnnotation | undefined;
    const annotatedReps = Array.isArray(annotation?.labels) ? annotation.labels.length : 0;
    if (annotatedReps === 0) return [];
    const exerciseId = typeof annotation?.exerciseId === "string" && annotation.exerciseId
      ? annotation.exerciseId
      : undefined;
    const capturePosition = typeof annotation?.capturePosition === "string"
      && CAPTURE_POSITIONS.some((position) => position.id === annotation.capturePosition)
      ? annotation.capturePosition as CapturePosition
      : undefined;
    const variation = typeof annotation?.variation === "string" ? annotation.variation : undefined;
    const trainingSide = annotation?.trainingSide === "bilateral"
      || annotation?.trainingSide === "left"
      || annotation?.trainingSide === "right"
      ? annotation.trainingSide
      : undefined;
    return [Object.freeze({
      id: capture.id,
      label: `${capture.id.replace("field-capture-", "")} · ${annotatedReps} 次标注`,
      video: `${CONFIRMED_ARCHIVE_ROOT}/${capture.video}`,
      ...(exerciseId ? { exerciseId } : {}),
      ...(capturePosition ? { capturePosition } : {}),
      ...(variation === undefined ? {} : { variation }),
      ...(trainingSide === undefined ? {} : { trainingSide }),
    })];
  });
  return Object.freeze({
    version: "maxpower-confirmed-capture-library/v1",
    videos: Object.freeze(videos),
  });
}
