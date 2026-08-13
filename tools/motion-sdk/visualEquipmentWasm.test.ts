import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  RustCanonicalWasmSession,
  instantiateRustMotionWasm,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseCandidateEstimate, PoseLandmark } from "../../src/pose/PoseEngine";

test("Web/WASM sends the exact luma frame and pose candidates through the shared Rust tracker", async () => {
  const bytes = await readFile("public/motion-sdk/maxpower_motion_sdk.wasm");
  const wasm = await instantiateRustMotionWasm(bytes);
  const session = new RustCanonicalWasmSession({
    sequenceId: "web-rust-visual-equipment-contract",
    schema: "halpe26",
    image: { widthPx: WIDTH, heightPx: HEIGHT, rotationDegrees: 0, mirrored: false },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);
  try {
    session.processCandidates([subject()], 1_000, [], {
      width: WIDTH,
      height: HEIGHT,
      luma: frameWithShaft(),
    });
    assert.equal(session.lastVisualBarbellAxis?.source, "measured");
    assert.ok(Math.abs((session.lastVisualBarbellAxis?.centerY ?? 0) - 0.42) < 0.025);
    assert.ok((session.lastVisualBarbellAxis?.confidence ?? 0) >= 0.5);

    session.processCandidates([subject()], 1_100, [], {
      width: WIDTH,
      height: HEIGHT,
      luma: new Uint8Array(WIDTH * HEIGHT).fill(30),
    });
    assert.equal(session.lastVisualBarbellAxis?.source, "predicted");
    assert.notEqual(
      session.lastDecodedPacket?.equipment.status,
      "observed",
      "display-only prediction must not be published as measured equipment",
    );
  } finally {
    session.close();
  }
});

function frameWithShaft(): Uint8Array {
  const frame = new Uint8Array(WIDTH * HEIGHT).fill(30);
  const centerY = Math.round(0.42 * HEIGHT);
  for (let y = centerY - 3; y <= centerY + 3; y += 1) {
    for (let x = 105; x <= 535; x += 1) frame[y * WIDTH + x] = 224;
  }
  return frame;
}

function subject(): PoseCandidateEstimate {
  const landmarks: PoseLandmark[] = Array.from({ length: 26 }, () => ({
    x: 0.5,
    y: 0.48,
    z: 0,
    visibility: 0,
  }));
  landmarks[5] = { x: 0.40, y: 0.48, z: 0, visibility: 0.9 };
  landmarks[6] = { x: 0.60, y: 0.48, z: 0, visibility: 0.9 };
  landmarks[9] = { x: 0.25, y: 0.42, z: 0, visibility: 0.8 };
  landmarks[10] = { x: 0.75, y: 0.42, z: 0, visibility: 0.8 };
  return {
    candidateId: 1,
    timestampMs: 1_000,
    bbox: { x: 0.2, y: 0.15, width: 0.6, height: 0.82 },
    torsoColor: [0.3, 0.3, 0.3],
    landmarks,
    worldLandmarks: [],
  };
}

const WIDTH = 640;
const HEIGHT = 360;
