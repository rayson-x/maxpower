import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createAnnotationInboxServer } from "./server";

test("local annotation server exposes the inbox and seekable video bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-inbox-server-"));
  const inboxRoot = join(root, "new-video");
  const archiveRoot = join(root, "archive");
  await mkdir(inboxRoot);
  await mkdir(archiveRoot);
  await writeFile(join(inboxRoot, "bench.mp4"), "0123456789");
  await writeFile(join(inboxRoot, "notes.txt"), "private notes");
  await writeFile(join(archiveRoot, "manifest.json"), JSON.stringify({ version: "field-capture-manifest/v1", captures: [] }));
  const server = createAnnotationInboxServer({ inboxRoot, archiveRoot });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    const listResponse = await fetch(`http://127.0.0.1:${port}/api/annotation-inbox`, {
      headers: { Origin: "http://localhost:8081" },
    });
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.headers.get("access-control-allow-origin"), "http://localhost:8081");
    assert.deepEqual(await listResponse.json(), {
      version: "maxpower-annotation-inbox/v1",
      items: [{ id: "bench", filename: "bench.mp4", sizeBytes: 10, videoUrl: "/videos/bench.mp4" }],
    });

    const videoResponse = await fetch(`http://127.0.0.1:${port}/videos/bench.mp4`, {
      headers: { Range: "bytes=2-5" },
    });
    assert.equal(videoResponse.status, 206);
    assert.equal(videoResponse.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await videoResponse.text(), "2345");

    const nonVideoResponse = await fetch(`http://127.0.0.1:${port}/videos/notes.txt`);
    assert.equal(nonVideoResponse.status, 409);

    const completion = await fetch(`http://127.0.0.1:${port}/api/annotation-inbox/complete`, {
      method: "POST",
      headers: { Origin: "http://localhost:8081", "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "bench.mp4",
        archiveGroup: "chest",
        keypoints: [],
        labels: { exerciseId: "barbell_bench_press", labels: [] },
        metadata: { annotationStatus: "human_approved" },
      }),
    });
    assert.equal(completion.status, 200);
    assert.deepEqual(await completion.json(), {
      completed: {
        id: "bench",
        video: "chest/bench.mp4",
        keypoints: "chest/bench.json",
        labels: "chest/bench.labels.json",
        metadata: "chest/bench.metadata.json",
      },
    });

    const poseFixture = {
      video: "bench.mp4",
      durationSec: 1,
      stepMs: 50,
      model: "pose_landmarker_heavy",
      poses: [{ timestampMs: 50, landmarks: [], worldLandmarks: [] }],
    };
    const poseResponse = await fetch(`http://127.0.0.1:${port}/api/annotation-inbox/archive-pose-fixture`, {
      method: "POST",
      headers: { Origin: "http://localhost:8081", "Content-Type": "application/json" },
      body: JSON.stringify({ captureId: "bench", fixture: poseFixture }),
    });
    assert.equal(poseResponse.status, 200);
    assert.deepEqual(await poseResponse.json(), { captureId: "bench", frameCount: 1 });
    assert.deepEqual(JSON.parse(await readFile(join(archiveRoot, "chest", "bench.json"), "utf8")), [poseFixture]);
    assert.deepEqual(JSON.parse(await readFile(join(archiveRoot, "chest", "bench.metadata.json"), "utf8")), {
      annotationStatus: "human_approved",
      model: "pose_landmarker_heavy",
      canonicalPoseFrameCount: 1,
      poseFixtureDurationSec: 1,
    });

    const foreignOrigin = await fetch(`http://127.0.0.1:${port}/api/annotation-inbox`, {
      headers: { Origin: "https://malicious.example" },
    });
    assert.equal(foreignOrigin.status, 403);
  } finally {
    server.close();
    await once(server, "close");
    await rm(root, { recursive: true, force: true });
  }
});
