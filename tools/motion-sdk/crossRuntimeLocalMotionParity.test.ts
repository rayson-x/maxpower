import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { instantiateRustMotionWasm, RustCanonicalWasmSession } from "../../src/motion/rustCanonicalWasm";
import type { DecodedMotionLandmark } from "../../src/motion/motionPacket";
import {
  LOCAL_MOTION_FLOAT_TOLERANCE,
  assertCoordinateParity,
  emitContractReport,
  inspectLocalMotionCoordinate,
  loadFrontBenchFixture,
  orderedObliqueAxisGate,
  replayFixtureThroughHostNative,
  replayFixtureThroughWasm,
  sessionConfig,
  submitFrame,
  type ContractGate,
} from "./localMotionRuntimeContractSupport";

const wasmPath = path.join(process.cwd(), "public/motion-sdk/maxpower_motion_sdk.wasm");

test("host-native Rust and Web/WASM keep the same front Halpe-26 barbell bbox packet lineage", async (t) => {
  assert.ok(fs.existsSync(wasmPath), "build the Rust WASM artifact before running this contract");
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const fixture = loadFrontBenchFixture();
  const web = replayFixtureThroughWasm(wasm, fixture);
  const native = replayFixtureThroughHostNative();

  if (!native.value) {
    emitContractReport("front-host-native-parity", [native.gate]);
    t.skip(native.gate.reason);
    return;
  }

  assert.equal(web.packetHexes.length, fixture.frames.length);
  assert.deepEqual(web.packetHexes, native.value.packetHexes, "native and WASM packets must be byte identical");

  const coordinateGates: ContractGate[] = [];
  for (let index = 0; index < web.packets.length; index += 1) {
    const webInspection = inspectLocalMotionCoordinate(web.packets[index]);
    const nativeInspection = inspectLocalMotionCoordinate(native.value.packets[index]);
    assert.notEqual(webInspection.availability, "invalid", webInspection.gate.reason);
    assert.notEqual(nativeInspection.availability, "invalid", nativeInspection.gate.reason);
    assert.equal(webInspection.availability, nativeInspection.availability, `coordinate availability frame ${index}`);
    if (webInspection.availability === "valid" && nativeInspection.availability === "valid") {
      assertCoordinateParity(webInspection.value, nativeInspection.value, `frame[${index}].localMotionCoordinate`);
    } else {
      coordinateGates.push(webInspection.gate);
    }
  }

  emitContractReport(
    "front-host-native-parity",
    [native.gate, ...coordinateGates.slice(0, 1)],
    { frameCount: fixture.frames.length, floatTolerance: LOCAL_MOTION_FLOAT_TOLERANCE },
  );
});

test("front fixture preserves low-confidence wrists as non-measured canonical evidence", async () => {
  assert.ok(fs.existsSync(wasmPath));
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const fixture = loadFrontBenchFixture();
  const session = new RustCanonicalWasmSession(sessionConfig(fixture, "ticket06:low-confidence"), wasm);
  try {
    const target = fixture.frames.find(({ timestampMs }) => timestampMs === 20_800);
    assert.ok(target, "reviewed fixture must contain the 20.8s low-confidence frame");
    for (const frame of fixture.frames) {
      submitFrame(session, frame);
      if (frame !== target) continue;
      assert.ok(session.lastDecodedPacket);
      for (const jointIndex of [7, 8, 9, 10]) {
        const landmark: DecodedMotionLandmark = session.lastDecodedPacket.canonical[jointIndex];
        assert.ok(landmark.observationScore < 0.5, `joint ${jointIndex} must remain low confidence`);
        assert.notEqual(landmark.source, "measured", `joint ${jointIndex} must not be overclaimed`);
      }
    }
  } finally {
    session.close();
  }
});

test("front-oblique ordered shaft geometry and mobile runtimes remain explicit gates", () => {
  const gates: ContractGate[] = [
    orderedObliqueAxisGate(),
    {
      state: "platform-gated",
      capability: "android-jni-front-and-front-oblique-parity",
      reason: "Android instrumentation source exists, but no physical/emulator run artifact for the Ticket 06 streams is available",
    },
    {
      state: "platform-gated",
      capability: "ios-native-front-and-front-oblique-parity",
      reason: "iOS simulator bridge source exists, but no Ticket 06 front-oblique run artifact is available",
    },
  ];
  assert.equal(gates[0].state, "data-gated");
  assert.equal(gates[1].state, "platform-gated");
  assert.equal(gates[2].state, "platform-gated");
  emitContractReport("front-oblique-cross-runtime", gates);
});

test("begin, finish and fresh-session reset use the public Rust set lifecycle", async () => {
  assert.ok(fs.existsSync(wasmPath));
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const fixture = loadFrontBenchFixture();
  const first = new RustCanonicalWasmSession(sessionConfig(fixture, "ticket06:lifecycle:first"), wasm);
  first.beginSet();
  assert.equal(first.lastSetLifecycle, "arming");
  for (const frame of fixture.frames) submitFrame(first, frame);
  assert.ok(
    first.lastSetLifecycle === "arming" || first.lastSetLifecycle === "active",
    "a chronological stream may remain arming until the selected profile confirms activation",
  );
  first.finishSet();
  assert.equal(first.lastSetLifecycle, "finished");
  first.close();

  const second = new RustCanonicalWasmSession(sessionConfig(fixture, "ticket06:lifecycle:second"), wasm);
  try {
    assert.equal(second.lastSetLifecycle, "idle");
    second.beginSet();
    submitFrame(second, fixture.frames[0]);
    assert.ok(second.lastDecodedPacket);
    assert.equal(second.lastDecodedPacket.completedReps.length, 0);
    assert.equal(second.lastDecodedPacket.repState.partialAttempts, 0n);
  } finally {
    second.close();
  }

  emitContractReport("set-lifecycle", [
    { state: "passed", capability: "begin-finish-fresh-reset", reason: "public WASM lifecycle was exercised" },
    { state: "platform-gated", capability: "pause-resume", reason: "RustCanonicalWasmSession has no public pause/resume methods" },
  ]);
});

test("endpoint occurrence and causal confirmation remain gated until Ticket 04 publishes both", async () => {
  assert.ok(fs.existsSync(wasmPath));
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const fixture = loadFrontBenchFixture();
  const packets = replayFixtureThroughWasm(wasm, fixture).packets;
  const endpoints = packets.flatMap((packet) => packet.qualityProposals)
    .flatMap((proposal) => proposal.endpoints);
  if (endpoints.length === 0) {
    emitContractReport("endpoint-causal-timestamps", [{
      state: "data-gated",
      capability: "endpoint-occurred-at-vs-confirmed-at",
      reason: "the blocked Ticket 04 profile emitted no endpoint snapshots for this fixture",
    }]);
    return;
  }

  for (const endpoint of endpoints) {
    assert.ok(
      endpoint.causalConfirmedTimestampMs >= endpoint.occurredTimestampMs,
      `${endpoint.kind}: confirmation cannot precede occurrence`,
    );
  }
  emitContractReport("endpoint-causal-timestamps", [{
    state: "passed",
    capability: "endpoint-occurred-at-vs-confirmed-at",
    reason: "published endpoint snapshots preserve causal timestamp ordering",
    evidence: { endpointCount: endpoints.length },
  }]);
});
