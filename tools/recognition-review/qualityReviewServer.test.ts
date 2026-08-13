import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, test } from "node:test";

import {
  createRecognitionReviewServer,
  type RecognitionReviewServerOptions,
} from "./server";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("quality review exposes only frozen GET evidence and range-addressable video", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-quality-review-"));
  temporaryRoots.push(root);
  const publicRoot = join(root, "public");
  const videoRoot = join(root, "videos");
  await Promise.all([mkdir(publicRoot), mkdir(videoRoot)]);

  const pagePath = join(publicRoot, "quality-review.html");
  const documentPath = join(publicRoot, "qualityReviewDocument.js");
  const appPath = join(publicRoot, "qualityReviewApp.js");
  const playerMathPath = join(publicRoot, "playerMath.js");
  const releasePath = join(root, "frozen-release.json");
  const videoPath = join(videoRoot, "capture-a.mp4");
  const release = frozenRelease("capture-a.mp4");
  await Promise.all([
    writeFile(pagePath, "<!doctype html><title>Quality review</title>"),
    writeFile(documentPath, "window.QualityReviewDocument = {};"),
    writeFile(appPath, "window.QualityReviewApp = {};"),
    writeFile(playerMathPath, "window.ReviewPlayerMath = {};"),
    writeFile(releasePath, `${JSON.stringify(release)}\n`),
    writeFile(videoPath, Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])),
  ]);
  const before = await readFile(releasePath, "utf8");

  const server = createRecognitionReviewServer(serverOptions({
    qualityReviewPagePath: pagePath,
    qualityReviewReleasePath: releasePath,
    qualityReviewVideoRoot: videoRoot,
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const pageResponse = await fetch(`${baseUrl}/quality-review.html`);
    assert.equal(pageResponse.status, 200);
    assert.match(await pageResponse.text(), /Quality review/);

    for (const asset of ["qualityReviewDocument.js", "qualityReviewApp.js", "playerMath.js"]) {
      const response = await fetch(`${baseUrl}/${asset}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /javascript/);
    }

    const releaseResponse = await fetch(`${baseUrl}/api/review/quality-release`);
    assert.equal(releaseResponse.status, 200);
    const clientRelease = await releaseResponse.json() as {
      items: Array<Record<string, unknown>>;
    };
    assert.equal(clientRelease.items[0]?.videoPath, undefined);
    assert.equal(clientRelease.items[0]?.videoUrl, "/media/quality-review?id=item-a");
    assert.deepEqual(clientRelease.items[0]?.proposal, release.items[0]?.proposal);

    const rangeResponse = await fetch(`${baseUrl}/media/quality-review?id=item-a`, {
      headers: { Range: "bytes=2-5" },
    });
    assert.equal(rangeResponse.status, 206);
    assert.equal(rangeResponse.headers.get("content-range"), "bytes 2-5/8");
    assert.deepEqual(Buffer.from(await rangeResponse.arrayBuffer()), Buffer.from([2, 3, 4, 5]));

    const postResponse = await fetch(`${baseUrl}/api/review/quality-release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisions: [] }),
    });
    assert.equal(postResponse.status, 404);
    assert.equal(await readFile(releasePath, "utf8"), before);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("quality review rejects a release video path outside its configured root", async () => {
  const root = await mkdtemp(join(tmpdir(), "maxpower-quality-review-"));
  temporaryRoots.push(root);
  const publicRoot = join(root, "public");
  const videoRoot = join(root, "videos");
  await Promise.all([mkdir(publicRoot), mkdir(videoRoot)]);
  const pagePath = join(publicRoot, "quality-review.html");
  const releasePath = join(root, "frozen-release.json");
  await Promise.all([
    writeFile(pagePath, "<!doctype html>"),
    writeFile(releasePath, `${JSON.stringify(frozenRelease("../outside.mp4"))}\n`),
  ]);

  const server = createRecognitionReviewServer(serverOptions({
    qualityReviewPagePath: pagePath,
    qualityReviewReleasePath: releasePath,
    qualityReviewVideoRoot: videoRoot,
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/review/quality-release`);
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /video path is invalid/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

function serverOptions(quality: Pick<RecognitionReviewServerOptions,
  "qualityReviewPagePath" | "qualityReviewReleasePath" | "qualityReviewVideoRoot"
>): RecognitionReviewServerOptions {
  const inert = {} as never;
  return {
    repository: inert,
    techniqueReviews: inert,
    equipmentReviews: inert,
    dumbbellReviews: inert,
    poseKeypointReviews: inert,
    benchPhaseReviews: inert,
    pagePath: quality.qualityReviewPagePath,
    equipmentPagePath: quality.qualityReviewPagePath,
    dumbbellPagePath: quality.qualityReviewPagePath,
    poseKeypointPagePath: quality.qualityReviewPagePath,
    benchPhasePagePath: quality.qualityReviewPagePath,
    benchRandomTestPagePath: quality.qualityReviewPagePath,
    benchRandomTestReportPath: quality.qualityReviewReleasePath,
    benchRandomTestPredictionPath: quality.qualityReviewReleasePath,
    ...quality,
  };
}

function frozenRelease(videoPath: string) {
  return {
    schemaVersion: "maxpower-motion-quality-review-release/v1",
    releaseId: "release-a",
    releaseHash: "sha256:release-a",
    frozenAt: "2026-08-13T23:30:00.000Z",
    runKind: "full_data_proposal",
    items: [{
      itemId: "item-a",
      captureId: "capture-a",
      title: "Barbell bench · front",
      capability: "quality_supported",
      videoPath,
      durationMs: 4_000,
      humanSegments: [{ startMs: 900, endMs: 3_100 }],
      evidence: {
        maximumOverlayAgeMs: 150,
        frames: [{
          timestampMs: 1_000,
          landmarks: [{ x: 0.5, y: 0.5, visibility: 0.9 }],
          equipment: [{ kind: "barbell_axis", x1: 0.3, y1: 0.4, x2: 0.7, y2: 0.4 }],
        }],
        equipmentTrajectories: [],
      },
      proposal: {
        schemaVersion: "maxpower-motion-quality-proposal/v1",
        proposalHash: "sha256:proposal-a",
        lineage: {
          runId: "run-a",
          runKind: "full_data_proposal",
          motionPacketHash: "sha256:packet-a",
        },
        reps: [{
          repId: "rep-1",
          endpoints: {
            start_anchor: { occurredAtMs: 1_000, confirmedAtMs: 1_000 },
            primary_turnaround: { occurredAtMs: 2_000, confirmedAtMs: 2_100 },
            end_return: { occurredAtMs: 3_000, confirmedAtMs: 3_100 },
          },
          conclusions: [{
            conclusionId: "rom-complete",
            dimension: "rom_endpoint_completeness",
            state: "observed_acceptable",
            confidence: 0.91,
            evidence: ["endpoint:primary_turnaround"],
          }],
        }],
      },
    }],
  };
}
