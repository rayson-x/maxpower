import {
  access,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname, join, parse } from "node:path";

import {
  ANNOTATION_INBOX_VIDEO_EXTENSIONS,
  isSafeAnnotationVideoFilename,
  type AnnotationInboxItem,
} from "../../src/pose/annotationInboxContract";

const activeCompletions = new Set<string>();

export interface ConfirmedCaptureEntry {
  readonly id: string;
  readonly video: string;
  readonly keypoints: string;
  readonly labels: string;
  readonly metadata: string;
}

export interface CompleteAnnotationInboxInput {
  readonly inboxRoot: string;
  readonly archiveRoot: string;
  readonly filename: string;
  readonly archiveGroup: string;
  readonly keypoints: unknown;
  readonly labels: unknown;
  readonly metadata: unknown;
}

export async function listAnnotationInbox(root: string): Promise<AnnotationInboxItem[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const videos = await Promise.all(entries
    .filter((entry) => entry.isFile() && isSafeAnnotationVideoFilename(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map(async (entry) => {
      const fileStat = await stat(join(root, entry.name));
      return {
        id: parse(entry.name).name,
        filename: entry.name,
        sizeBytes: fileStat.size,
        videoUrl: `/videos/${encodeURIComponent(entry.name)}`,
      } satisfies AnnotationInboxItem;
    }));
  return videos;
}

export async function completeAnnotationInboxItem(
  input: CompleteAnnotationInboxInput,
): Promise<ConfirmedCaptureEntry> {
  const completionKey = `${input.archiveRoot}\0${input.filename}`;
  if (activeCompletions.has(completionKey)) {
    throw new Error(`archive completion already in progress: ${input.filename}`);
  }
  activeCompletions.add(completionKey);
  try {
    return await completeUnlocked(input);
  } finally {
    activeCompletions.delete(completionKey);
  }
}

async function completeUnlocked(input: CompleteAnnotationInboxInput): Promise<ConfirmedCaptureEntry> {
  assertSafeFilename(input.filename);
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(input.archiveGroup)) {
    throw new Error("archiveGroup must be one safe directory name");
  }
  const extension = extname(input.filename);
  if (!ANNOTATION_INBOX_VIDEO_EXTENSIONS.has(extension.toLowerCase())) {
    throw new Error("unsupported inbox video extension");
  }
  const sourcePath = join(input.inboxRoot, input.filename);
  const sourceStat = await lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("inbox source must be a regular video file");
  }

  const id = parse(input.filename).name;
  const groupRoot = join(input.archiveRoot, input.archiveGroup);
  const relativeBase = `${input.archiveGroup}/${id}`;
  const entry: ConfirmedCaptureEntry = {
    id,
    video: `${relativeBase}${extension.toLowerCase()}`,
    keypoints: `${relativeBase}.json`,
    labels: `${relativeBase}.labels.json`,
    metadata: `${relativeBase}.metadata.json`,
  };
  const manifestPath = join(input.archiveRoot, "manifest.json");
  const manifestText = await readFile(manifestPath, "utf8");
  const manifest = parseManifest(manifestText);
  if (manifest.captures.some((capture) => capture.id === id)) {
    throw new Error(`archive capture already exists: ${id}`);
  }

  await mkdir(groupRoot, { recursive: true });
  const finalPaths = [entry.video, entry.keypoints, entry.labels, entry.metadata]
    .map((relativePath) => join(input.archiveRoot, relativePath));
  for (const finalPath of finalPaths) {
    if (await exists(finalPath)) throw new Error(`archive target already exists: ${basename(finalPath)}`);
  }

  const stageRoot = join(input.archiveRoot, `.annotation-inbox-${process.pid}-${Date.now()}-${id}`);
  const stageVideo = join(stageRoot, basename(entry.video));
  const stageKeypoints = join(stageRoot, basename(entry.keypoints));
  const stageLabels = join(stageRoot, basename(entry.labels));
  const stageMetadata = join(stageRoot, basename(entry.metadata));
  const stagedManifest = join(stageRoot, "manifest.json");
  const promoted: string[] = [];
  let manifestPromoted = false;
  try {
    await mkdir(stageRoot);
    await copyFile(sourcePath, stageVideo, constants.COPYFILE_EXCL);
    await Promise.all([
      writeJson(stageKeypoints, input.keypoints),
      writeJson(stageLabels, input.labels),
      writeJson(stageMetadata, input.metadata),
    ]);
    await writeJson(stagedManifest, {
      ...manifest,
      captures: [...manifest.captures, entry],
    });

    for (const [stagedPath, finalPath] of [
      [stageVideo, finalPaths[0]],
      [stageKeypoints, finalPaths[1]],
      [stageLabels, finalPaths[2]],
      [stageMetadata, finalPaths[3]],
    ] as const) {
      await rename(stagedPath, finalPath);
      promoted.push(finalPath);
    }
    await rename(stagedManifest, manifestPath);
    manifestPromoted = true;
    await unlink(sourcePath);
    return entry;
  } catch (error) {
    if (manifestPromoted) await writeFile(manifestPath, manifestText);
    await Promise.all(promoted.map((path) => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

function assertSafeFilename(filename: string): void {
  if (basename(filename) !== filename || !isSafeAnnotationVideoFilename(filename)) {
    throw new Error("filename must be a safe inbox basename");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseManifest(text: string): { version: string; captures: Array<Record<string, unknown>> } & Record<string, unknown> {
  const value = JSON.parse(text) as { version?: unknown; captures?: unknown };
  if (typeof value.version !== "string" || !Array.isArray(value.captures)) {
    throw new Error("confirmed capture manifest is invalid");
  }
  return value as { version: string; captures: Array<Record<string, unknown>> } & Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
