import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { instantiateRustMotionWasm, RustCanonicalWasmSession } from "../../src/motion/rustCanonicalWasm";
import {
  emitContractReport,
  inspectLocalMotionCoordinate,
  loadFrontBenchFixture,
  sessionConfig,
  submitFrame,
  type ContractGate,
} from "./localMotionRuntimeContractSupport";

const wasmPath = path.join(process.cwd(), "public/motion-sdk/maxpower_motion_sdk.wasm");

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

test("single-pass Node/WASM diagnostic preserves source order and measures Rust core/decode cost", async () => {
  assert.ok(fs.existsSync(wasmPath), "build the Rust WASM artifact before running this contract");
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const fixture = loadFrontBenchFixture();
  const session = new RustCanonicalWasmSession(sessionConfig(fixture, "ticket06:offline-performance"), wasm);
  const submittedTimestamps: number[] = [];
  const coreCosts: number[] = [];
  const decodeCosts: number[] = [];
  const coordinateGates: ContractGate[] = [];
  const startedAt = performance.now();
  let finishSetCostMs: number;

  try {
    session.beginSet();
    for (const frame of fixture.frames) {
      submitFrame(session, frame);
      submittedTimestamps.push(frame.timestampMs);
      coreCosts.push(session.lastTiming.coreMs);
      decodeCosts.push(session.lastTiming.decodeMs);
      assert.ok(session.lastDecodedPacket);
      const coordinate = inspectLocalMotionCoordinate(session.lastDecodedPacket);
      assert.notEqual(coordinate.availability, "invalid", coordinate.gate.reason);
      if (coordinate.availability === "missing") coordinateGates.push(coordinate.gate);
    }
    const finishStartedAt = performance.now();
    session.finishSet();
    finishSetCostMs = performance.now() - finishStartedAt;
    assert.equal(session.lastSetLifecycle, "finished");
  } finally {
    session.close();
  }

  assert.deepEqual(
    submittedTimestamps,
    fixture.frames.map(({ timestampMs }) => timestampMs),
    "the harness must submit each source observation exactly once in chronological order",
  );

  const elapsedMs = performance.now() - startedAt;
  const diagnostics = {
    scope: "offline-node-wasm-diagnostic-not-mobile-acceptance",
    processedFrames: submittedTimestamps.length,
    elapsedMs,
    throughputFps: submittedTimestamps.length / (elapsedMs / 1000),
    rustCoreMs: {
      mean: coreCosts.reduce((sum, value) => sum + value, 0) / coreCosts.length,
      p95: percentile(coreCosts, 0.95),
      max: Math.max(...coreCosts),
    },
    decodeMs: {
      mean: decodeCosts.reduce((sum, value) => sum + value, 0) / decodeCosts.length,
      p95: percentile(decodeCosts, 0.95),
      max: Math.max(...decodeCosts),
    },
    finishSetCostMs,
  };
  assert.ok(diagnostics.throughputFps > 0);
  assert.ok(Number.isFinite(diagnostics.finishSetCostMs));

  emitContractReport("offline-wasm-performance", [
    {
      state: "passed",
      capability: "offline-node-wasm-diagnostic",
      reason: "single chronological pass measured Rust core, decode and finish-set costs; this is not client FPS acceptance",
    },
    ...coordinateGates.slice(0, 1),
  ], diagnostics);
});

test("realtime scheduling and physical-device metrics never pass without runtime metadata", () => {
  const gates: ContractGate[] = [
    {
      state: "platform-gated",
      capability: "latest-frame-submitted-processed-dropped-max-backlog",
      reason: "Node fixture replay does not expose CameraX/AVFoundation latest-frame scheduler metadata",
    },
    {
      state: "platform-gated",
      capability: "android-physical-device-fps-and-confirmation-latency",
      reason: "no declared Android device run artifact is available",
    },
    {
      state: "platform-gated",
      capability: "ios-physical-device-fps-and-confirmation-latency",
      reason: "no declared iOS device run artifact is available",
    },
    {
      state: "platform-gated",
      capability: "physical-device-coordinate-freeze-and-rep-confirmation-latency",
      reason: "synthetic and host/WASM contracts exercise these timestamps, but no Android/iOS realtime artifact reports them yet",
    },
  ];
  assert.ok(gates.every(({ state }) => state !== "passed"));
  emitContractReport("realtime-performance-gates", gates);
});
