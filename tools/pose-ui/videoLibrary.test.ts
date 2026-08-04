import assert from "node:assert/strict";
import test from "node:test";

import { parseVideoLibraryManifest } from "../../src/pose/videoLibrary";

test("training video library accepts only explicit, safe entries", () => {
  const manifest = parseVideoLibraryManifest({
    version: "form-coach-video-library/v1",
    videos: [{
      id: "lat-pulldown",
      label: "高位下拉 · 测试素材",
      video: "lat-pulldown.mp4",
      exerciseId: "lat_pulldown",
      capturePosition: "rear",
      variation: "cable straight bar",
      trainingSide: "bilateral",
    }],
  });
  assert.equal(manifest.videos[0].label, "高位下拉 · 测试素材");
  assert.equal(manifest.videos[0].capturePosition, "rear");
  assert.throws(() => parseVideoLibraryManifest({
    version: "v1",
    videos: [{ id: "archive", label: "Archive", video: "../archives/confirmed.webm" }],
  }), /安全/);
  assert.throws(() => parseVideoLibraryManifest({
    version: "v1",
    videos: [{ id: "bad-position", label: "Bad", video: "bad.mp4", capturePosition: "top" }],
  }), /机位/);
});
