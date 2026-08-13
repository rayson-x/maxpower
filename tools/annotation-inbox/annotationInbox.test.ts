import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { completeAnnotationInboxItem, listAnnotationInbox } from "./annotationInbox";

test("annotation inbox lists only top-level workout videos in chronological order", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-inbox-"));
  try {
    await writeFile(join(root, "bench-b.mp4"), "bbbb");
    await writeFile(join(root, "bench-a.MOV"), "aa");
    await writeFile(join(root, "notes.txt"), "ignore me");
    await utimes(join(root, "bench-b.mp4"), new Date(1_000), new Date(1_000));
    await utimes(join(root, "bench-a.MOV"), new Date(2_000), new Date(2_000));

    assert.deepEqual(await listAnnotationInbox(root), [
      {
        id: "bench-b",
        filename: "bench-b.mp4",
        sizeBytes: 4,
        videoUrl: "/videos/bench-b.mp4",
      },
      {
        id: "bench-a",
        filename: "bench-a.MOV",
        sizeBytes: 2,
        videoUrl: "/videos/bench-a.MOV",
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completing an annotation archives the video and sidecars before removing it from the inbox", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-inbox-"));
  const inboxRoot = join(root, "new-video");
  const archiveRoot = join(root, "confirmed-captures");
  await mkdir(inboxRoot);
  await mkdir(archiveRoot);
  await writeFile(join(inboxRoot, "bench.mp4"), "video-bytes");
  await writeFile(join(archiveRoot, "manifest.json"), JSON.stringify({
    version: "field-capture-manifest/v1",
    captures: [],
  }));

  try {
    const completed = await completeAnnotationInboxItem({
      inboxRoot,
      archiveRoot,
      filename: "bench.mp4",
      archiveGroup: "chest",
      keypoints: [{ video: "bench.mp4", durationSec: 3, stepMs: 33, model: "pose_landmarker_lite", poses: [] }],
      labels: { exerciseId: "barbell_bench_press", labels: [{ repIndex: 1, startMs: 100, extremeMs: 500, endMs: 900 }] },
      metadata: { schemaVersion: "maxpower-inbox-review/v1", exerciseId: "barbell_bench_press" },
    });

    assert.deepEqual(completed, {
      id: "bench",
      video: "chest/bench.mp4",
      keypoints: "chest/bench.json",
      labels: "chest/bench.labels.json",
      metadata: "chest/bench.metadata.json",
    });
    assert.equal(await readFile(join(archiveRoot, "chest", "bench.mp4"), "utf8"), "video-bytes");
    await assert.rejects(readFile(join(inboxRoot, "bench.mp4")), /ENOENT/);
    assert.deepEqual(JSON.parse(await readFile(join(archiveRoot, "manifest.json"), "utf8")), {
      version: "field-capture-manifest/v1",
      captures: [completed],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an archive collision leaves the inbox source untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-inbox-"));
  const inboxRoot = join(root, "new-video");
  const archiveRoot = join(root, "confirmed-captures");
  await mkdir(inboxRoot);
  await mkdir(join(archiveRoot, "chest"), { recursive: true });
  await writeFile(join(inboxRoot, "bench.mp4"), "source");
  await writeFile(join(archiveRoot, "chest", "bench.mp4"), "existing");
  await writeFile(join(archiveRoot, "manifest.json"), JSON.stringify({ version: "field-capture-manifest/v1", captures: [] }));

  try {
    await assert.rejects(completeAnnotationInboxItem({
      inboxRoot,
      archiveRoot,
      filename: "bench.mp4",
      archiveGroup: "chest",
      keypoints: [],
      labels: {},
      metadata: {},
    }), /already exists/);
    assert.equal(await readFile(join(inboxRoot, "bench.mp4"), "utf8"), "source");
    assert.equal(await readFile(join(archiveRoot, "chest", "bench.mp4"), "utf8"), "existing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate completion requests cannot race the same inbox video", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-inbox-"));
  const inboxRoot = join(root, "new-video");
  const archiveRoot = join(root, "confirmed-captures");
  await mkdir(inboxRoot);
  await mkdir(archiveRoot);
  await writeFile(join(inboxRoot, "bench.mp4"), "source");
  await writeFile(join(archiveRoot, "manifest.json"), JSON.stringify({ version: "field-capture-manifest/v1", captures: [] }));
  const request = {
    inboxRoot,
    archiveRoot,
    filename: "bench.mp4",
    archiveGroup: "chest",
    keypoints: [],
    labels: { labels: [] },
    metadata: {},
  };

  try {
    const results = await Promise.allSettled([
      completeAnnotationInboxItem(request),
      completeAnnotationInboxItem(request),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal(await readFile(join(archiveRoot, "chest", "bench.mp4"), "utf8"), "source");
    const manifest = JSON.parse(await readFile(join(archiveRoot, "manifest.json"), "utf8")) as { captures: unknown[] };
    assert.equal(manifest.captures.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
