import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createEquipmentAnnotationServer } from "./server.mjs";

test("server hides private source paths and supports video byte ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-equipment-annotation-"));
  const videoPath = join(root, "capture.mp4");
  const manifestPath = join(root, "manifest.json");
  await writeFile(videoPath, Buffer.from("0123456789"));
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "maxpower-equipment-video-manifest/v1",
    manifestId: "test-manifest",
    status: "ready",
    blockers: [],
    videos: [{ id: "capture-a", sourcePath: videoPath, title: "Capture A" }],
  }));
  const server = await createEquipmentAnnotationServer({ manifestPath });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const manifestResponse = await fetch(`${baseUrl}/api/manifest`);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.videos[0].sourcePath, undefined);
    assert.equal(manifest.videos[0].videoUrl, "/media/video?id=capture-a");

    const videoResponse = await fetch(`${baseUrl}/media/video?id=capture-a`, { headers: { Range: "bytes=2-5" } });
    assert.equal(videoResponse.status, 206);
    assert.equal(await videoResponse.text(), "2345");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("missing manifest fails closed without discovering repository videos", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-equipment-annotation-"));
  const server = await createEquipmentAnnotationServer({ manifestPath: join(root, "missing.json") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/manifest`);
    const manifest = await response.json();
    assert.equal(manifest.status, "blocked");
    assert.deepEqual(manifest.videos, []);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
