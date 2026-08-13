import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifestUrl = new URL("./web-vision-models.json", import.meta.url);

test("Web vision model manifest freezes public paths and official hashes", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  assert.equal(manifest.schemaVersion, "maxpower-web-vision-model-manifest/v1");
  assert.equal(manifest.runtime, "onnxruntime-web@1.22.0");
  assert.deepEqual(manifest.models.map((model) => model.publicPath), [
    "/models/yolox-nano-humanart-416x416.onnx",
    "/models/rtmpose-m-halpe26-256x192.onnx",
  ]);
  for (const model of manifest.models) {
    assert.match(model.sourceArchive, /^https:\/\/download\.openmmlab\.com\//);
    assert.match(model.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(model.bytes) && model.bytes > 0);
  }
  assert.equal(manifest.boundary.equipmentClassesAvailable.length, 0);
  assert.equal(manifest.boundary.subjectSelectionOwner, "rust-motion-sdk");
  assert.equal(manifest.boundary.modelBinariesCommitted, false);
});
