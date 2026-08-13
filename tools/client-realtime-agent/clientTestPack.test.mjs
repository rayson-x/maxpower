import assert from "node:assert/strict";
import test from "node:test";

import { assertTruthFree, publicClientTestPack } from "./clientTestPack.mjs";

test("truth is unavailable to the client runtime before prediction", () => {
  assert.doesNotThrow(() => assertTruthFree({ cases: [{ captureId: "a", profile: { startAmplitude: 0.1 } }] }));
  assert.throws(() => assertTruthFree({ cases: [{ segments: [] }] }), /truth field/);
  assert.throws(() => assertTruthFree({ peakMs: 10 }), /truth field/);
});

test("public pack hides private video paths", () => {
  const publicPack = publicClientTestPack({
    schemaVersion: "maxpower-client-single-pass-test-pack/v1",
    cases: [{ captureId: "capture-a", videoPath: "private/a.mp4" }],
  });
  assert.equal(publicPack.cases[0].videoPath, undefined);
  assert.equal(publicPack.cases[0].videoUrl, "/media/client-realtime-agent?id=capture-a");
});
