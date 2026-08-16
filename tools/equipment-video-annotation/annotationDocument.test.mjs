import assert from "node:assert/strict";
import test from "node:test";

import {
  annotationAt,
  buildExportBundle,
  createDocument,
  deleteFrameAnnotation,
  parseDocument,
  parseExportBundle,
  upsertFrameAnnotation,
} from "./annotationDocument.mjs";

const video = {
  id: "capture-01",
  assetId: "personal-raw-archive",
  sourceGroupKey: "participant-a/session-a/capture-01/device-a",
  captureId: "capture-01",
  videoSha256: "a".repeat(64),
  exercise: "barbell_bench_press",
  view: "front",
  admissionState: "immutable_source",
};

function visible(timestampMs, x = 0.1) {
  return {
    timestampMs,
    fps: 30,
    target: "visible_equipment",
    instances: [{
      kind: "barbell_shaft",
      geometry: { type: "axis", a: { x, y: 0.4 }, b: { x: 0.9, y: 0.41 } },
    }],
    occlusion: "partial",
    truncated: false,
    note: "hands cover the center",
  };
}

test("same-frame save replaces the draft without duplicating it", () => {
  const first = upsertFrameAnnotation(createDocument(video), visible(1000));
  const second = upsertFrameAnnotation(first, visible(1010, 0.2));
  assert.equal(second.annotations.length, 1);
  assert.equal(second.annotations[0].instances[0].geometry.a.x, 0.2);
  assert.equal(second.annotations[0].createdAt, first.annotations[0].createdAt);
  assert.ok(annotationAt(second, 1000, 30));
});

test("negative and ambiguous frames never retain positive geometry", () => {
  const document = upsertFrameAnnotation(createDocument(video), {
    ...visible(2000),
    target: "static_rack_only",
  });
  assert.deepEqual(document.annotations[0].instances, []);
});

test("invalid normalized coordinates are rejected", () => {
  assert.throws(() => upsertFrameAnnotation(createDocument(video), visible(1000, -0.1)), /0 到 1/);
});

test("frame annotation can be removed using the same fps tolerance", () => {
  const document = upsertFrameAnnotation(createDocument(video), visible(1000));
  assert.equal(deleteFrameAnnotation(document, 1010, 30).annotations.length, 0);
});

test("export bundle round-trips source lineage and documents", () => {
  const document = upsertFrameAnnotation(createDocument(video), visible(1000));
  const bundle = buildExportBundle([document], {
    schemaVersion: "maxpower-equipment-video-manifest/v1",
    manifestId: "manifest-a",
    status: "ready",
  });
  const restored = parseExportBundle(JSON.stringify(bundle));
  assert.equal(restored[0].source.assetId, "personal-raw-archive");
  assert.equal(restored[0].annotations.length, 1);
  assert.equal(parseDocument(restored[0], video).source.videoId, video.id);
});
