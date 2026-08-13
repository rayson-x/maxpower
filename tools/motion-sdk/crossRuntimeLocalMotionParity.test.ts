import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { instantiateRustMotionWasm, RustCanonicalWasmSession } from "../../src/motion/rustCanonicalWasm";
import type {
  DecodedLocalMotionCoordinate,
  DecodedMotionLandmark,
  DecodedMotionPacket,
} from "../../src/motion/motionPacket";
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

test("host-native Rust and Web/WASM preserve one active oblique shaft coordinate stream", async () => {
  assert.ok(fs.existsSync(wasmPath));
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const source = loadFrontBenchFixture();
  const progress = [0, 0.004, 0.018, 0.05, 0.10, 0.17, 0.24, 0.31, 0.35,
    0.34, 0.30, 0.24, 0.16, 0.08, 0.025, 0.004];
  const angle = 0.22;
  const cross = [Math.cos(angle), Math.sin(angle)] as const;
  const primary = [-cross[1], cross[0]] as const;
  const fixture = {
    ...source,
    bridgeConfig: {
      ...source.bridgeConfig,
      sequenceId: "ticket06:active-oblique-local",
      profileCode: 110,
      active: true,
    },
    frames: progress.map((value, index) => {
      const basis = source.frames[Math.min(index, source.frames.length - 1)];
      const center = [0.5 + primary[0] * value, 0.42 + primary[1] * value] as const;
      const half = 0.30;
      const axis = {
        x1: center[0] - cross[0] * half,
        y1: center[1] - cross[1] * half,
        x2: center[0] + cross[0] * half,
        y2: center[1] + cross[1] * half,
      };
      return {
        ...basis,
        sourceFrameNumber: index + 1,
        timestampMs: 1_000 + index * 100,
        equipmentObservations: [{
          ...basis.equipmentObservations[0],
          proposalId: 900 + index,
          bbox: [
            Math.min(axis.x1, axis.x2),
            Math.min(axis.y1, axis.y2),
            Math.abs(axis.x2 - axis.x1),
            Math.max(Math.abs(axis.y2 - axis.y1), 0.005),
          ] as const,
          axis,
          score: 0.96,
        }],
      };
    }),
  } satisfies import("./localMotionRuntimeContractSupport").Halpe26EquipmentFixture;
  const temporaryDirectory = fs.mkdtempSync(path.join(process.cwd(), ".ticket06-oblique-fixture-"));
  const fixturePath = path.join(temporaryDirectory, "active-oblique.json");
  try {
    fs.writeFileSync(fixturePath, `${JSON.stringify(fixture)}\n`);
    const web = replayFixtureThroughWasm(wasm, fixture);
    const native = replayFixtureThroughHostNative(fixturePath);
    assert.ok(native.value, native.gate.reason);
    assert.equal(web.packets.length, native.value.packets.length);
    for (let index = 0; index < web.packets.length; index += 1) {
      const webPacket = web.packets[index];
      const nativePacket: DecodedMotionPacket = native.value.packets[index];
      assert.equal(webPacket.frameId, nativePacket.frameId);
      assert.equal(webPacket.sourceTimestampMs, nativePacket.sourceTimestampMs);
      assert.equal(webPacket.repState.phase, nativePacket.repState.phase);
      assert.equal(webPacket.setState.lifecycle, nativePacket.setState.lifecycle);
      assertCoordinateParity(
        webPacket.localMotionCoordinate,
        nativePacket.localMotionCoordinate,
        `active-oblique[${index}].localMotionCoordinate`,
      );
    }
    const frozen = web.packets.map((packet) => packet.localMotionCoordinate)
      .find((coordinate) => coordinate?.state === "frozen");
    assert.ok(frozen, "active oblique stream must freeze a causal local frame");
    assert.ok(Math.abs((frozen.rawBarAngleRadians ?? 0) - angle) < 1e-4);
    assert.equal(frozen.endpointOrderMapping, "screen_ordered_anatomy_unknown");
    assert.equal(frozen.anatomicalSideMapping, "endpoint_one_anatomical_right");
    assert.equal(frozen.anatomicalLeftEndpointProgress, frozen.endpointTwoProgress);
    assert.equal(frozen.anatomicalRightEndpointProgress, frozen.endpointOneProgress);
    assert.equal(frozen.equipment?.provenance, "equipment_measured");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("uninitialized local coordinate remains valid fail-closed evidence", () => {
  const coordinate: DecodedLocalMotionCoordinate = {
    schemaVersion: "maxpower-local-motion-coordinate/v1",
    coordinateFrameId: 0,
    sourceTimestampMs: null,
    state: "uninitialized",
    reason: "no_set",
    primaryAxis: null,
    crossAxis: null,
    origin: null,
    scale: null,
    scaleSource: null,
    equipmentTrackId: null,
    rawBarAxis: null,
    coarseView: null,
    canonicalFeedMirrored: null,
    endpointOrderMapping: "screen_ordered_anatomy_unknown",
    anatomicalSideMapping: "unknown",
    equipment: null,
    pose: null,
    channelAgreement: "cannot_judge",
    endpointOneProgress: null,
    endpointTwoProgress: null,
    anatomicalLeftEndpointProgress: null,
    anatomicalRightEndpointProgress: null,
    rawBarAngleRadians: null,
    baselineCorrectedBarAngleRadians: null,
    confidence: 0,
  };
  const inspection = inspectLocalMotionCoordinate({
    localMotionCoordinate: coordinate,
  } as DecodedMotionPacket);
  assert.equal(inspection.availability, "valid");
  assert.equal(inspection.gate.state, "passed");
  assert.match(inspection.gate.reason, /fail-closed/);
});

test("front-oblique ordered shaft geometry is implemented while mobile runtimes remain explicit gates", () => {
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
  assert.equal(gates[0].state, "passed");
  assert.equal(gates[1].state, "platform-gated");
  assert.equal(gates[2].state, "platform-gated");
  emitContractReport("front-oblique-cross-runtime", gates);
});

test("begin, pause, resume, finish and fresh-session reset use the public Rust set lifecycle", async () => {
  assert.ok(fs.existsSync(wasmPath));
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const fixture = loadFrontBenchFixture();
  const first = new RustCanonicalWasmSession(sessionConfig(fixture, "ticket06:lifecycle:first"), wasm);
  first.beginSet();
  assert.equal(first.lastSetLifecycle, "arming");
  first.pauseSet();
  assert.equal(first.lastSetLifecycle, "paused");
  submitFrame(first, fixture.frames[0]);
  assert.equal(first.lastSetLifecycle, "paused", "explicit pause cannot auto-resume from motion");
  first.resumeSet();
  assert.equal(first.lastSetLifecycle, "active");
  for (const frame of fixture.frames.slice(1)) submitFrame(first, frame);
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
    { state: "passed", capability: "begin-pause-resume-finish-fresh-reset", reason: "public WASM lifecycle was exercised" },
  ]);
});

test("active local profile preserves endpoint occurrence before causal confirmation", async () => {
  assert.ok(fs.existsSync(wasmPath));
  const wasm = await instantiateRustMotionWasm(fs.readFileSync(wasmPath));
  const source = loadFrontBenchFixture();
  const progress = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0.02, 0.06, 0.12, 0.20, 0.30, 0.34, 0.33, 0.30, 0.22, 0.12, 0.04, 0.01,
    0, 0, 0, 0, 0, 0];
  const fixture = {
    ...source,
    bridgeConfig: { ...source.bridgeConfig, profileCode: 110, active: true },
    frames: progress.map((value, index) => {
      const basis = source.frames[Math.min(index, source.frames.length - 1)];
      const y = 0.40 + value;
      return {
        ...basis,
        sourceFrameNumber: index + 1,
        timestampMs: index * 100,
        equipmentObservations: [{
          ...basis.equipmentObservations[0],
          proposalId: 1_500 + index,
          bbox: [0.2, y, 0.6, 0.005] as const,
          axis: { x1: 0.2, y1: y, x2: 0.8, y2: y },
          score: 0.96,
        }],
      };
    }),
  } satisfies import("./localMotionRuntimeContractSupport").Halpe26EquipmentFixture;
  const session = new RustCanonicalWasmSession(sessionConfig(fixture, "ticket06:endpoints"), wasm);
  const endpoints = [] as import("../../src/motion/motionPacket").DecodedRepEndpointSnapshot[];
  try {
    session.setExerciseProfile("barbell_bench_press_local_front_left");
    session.beginSet();
    for (const frame of fixture.frames) {
      submitFrame(session, frame);
      endpoints.push(...session.lastQualityProposals.flatMap((proposal) => proposal.endpoints));
    }
    session.finishSet();
    endpoints.push(...session.lastQualityProposals.flatMap((proposal) => proposal.endpoints));
  } finally {
    session.close();
  }
  assert.ok(endpoints.length >= 3, "local profile must publish a complete endpoint snapshot set");

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
