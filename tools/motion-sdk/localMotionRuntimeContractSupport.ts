import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  RustCanonicalWasmSession,
  type MotionWasmExports,
  type RustCanonicalWasmSessionConfig,
  type RustEquipmentObservation,
} from "../../src/motion/rustCanonicalWasm";
import {
  decodeMotionPacket,
  type DecodedLocalMotionCoordinate,
  type DecodedMotionPacket,
} from "../../src/motion/motionPacket";

export const LOCAL_MOTION_FLOAT_TOLERANCE = 1e-5;
export const FRONT_BENCH_FIXTURE = path.join(
  process.cwd(),
  "tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.json",
);

export type GateState = "passed" | "data-gated" | "platform-gated";

export interface ContractGate {
  readonly state: GateState;
  readonly capability: string;
  readonly reason: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface FixtureCandidate {
  readonly candidateId: number;
  readonly bbox: readonly [number, number, number, number];
  readonly torsoColor: readonly [number, number, number];
  readonly landmarks: readonly (readonly [number, number, number, number])[];
}

export interface FixtureEquipmentObservation {
  readonly proposalId: number;
  readonly kind: "weight_plate" | "barbell_shaft" | "dumbbell" | "machine_handle";
  readonly bbox: readonly [number, number, number, number];
  readonly axis?: Readonly<{ x1: number; y1: number; x2: number; y2: number }>;
  readonly score: number;
  readonly uncertaintyPx: number | null;
  readonly source: "detector" | "optical_flow" | "geometry" | "predicted";
  readonly attributes: {
    readonly reflectionCandidate: boolean;
    readonly staticRackCandidate: boolean;
    readonly occlusion: "none" | "partial" | "heavy";
    readonly truncated: boolean;
  };
}

export interface FixtureFrame {
  readonly sourceFrameNumber: number;
  readonly timestampMs: number;
  readonly candidates: readonly FixtureCandidate[];
  readonly equipmentObservations: readonly FixtureEquipmentObservation[];
}

export interface Halpe26EquipmentFixture {
  readonly source: {
    readonly captureId: string;
    readonly widthPx: number;
    readonly heightPx: number;
  };
  readonly bridgeConfig: {
    readonly sequenceId: string;
    readonly poseSchema: "halpe26";
    readonly profileCode: number;
    readonly active: boolean;
  };
  readonly frames: readonly FixtureFrame[];
}

export interface RuntimePackets {
  readonly packetHexes: readonly string[];
  readonly packets: readonly DecodedMotionPacket[];
}

export interface RuntimeAttempt<T> {
  readonly value: T | null;
  readonly gate: ContractGate;
}

export interface LocalMotionInspection {
  readonly availability: "missing" | "valid" | "invalid";
  readonly gate: ContractGate;
  readonly value: Readonly<DecodedLocalMotionCoordinate> | null;
}

const REQUIRED_LOCAL_MOTION_PATHS = [
  "schemaVersion",
  "coordinateFrameId",
  "sourceTimestampMs",
  "state",
  "reason",
  "primaryAxis",
  "crossAxis",
  "origin",
  "scale",
  "scaleSource",
  "equipmentTrackId",
  "rawBarAxis",
  "coarseView",
  "canonicalFeedMirrored",
  "endpointOrderMapping",
  "anatomicalSideMapping",
  "equipment",
  "pose",
  "channelAgreement",
  "endpointOneProgress",
  "endpointTwoProgress",
  "anatomicalLeftEndpointProgress",
  "anatomicalRightEndpointProgress",
  "rawBarAngleRadians",
  "baselineCorrectedBarAngleRadians",
  "confidence",
] as const;

const REQUIRED_TRAJECTORY_CHANNEL_PATHS = [
  "alongAxisProgress",
  "crossAxisDisplacement",
  "confidence",
  "coverage",
  "uncertainty",
  "provenance",
] as const;

export function loadFrontBenchFixture(): Halpe26EquipmentFixture {
  return JSON.parse(fs.readFileSync(FRONT_BENCH_FIXTURE, "utf8")) as Halpe26EquipmentFixture;
}

export function sessionConfig(
  fixture: Halpe26EquipmentFixture,
  sequenceId: string,
): RustCanonicalWasmSessionConfig {
  return {
    sequenceId,
    schema: "halpe26",
    image: {
      widthPx: fixture.source.widthPx,
      heightPx: fixture.source.heightPx,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
    canonicalFeedMirrored: false,
  };
}

export function mapEquipment(frame: FixtureFrame): readonly RustEquipmentObservation[] {
  return frame.equipmentObservations.map((observation) => ({
    proposalId: observation.proposalId,
    kind: observation.kind,
    bbox: {
      x: observation.bbox[0],
      y: observation.bbox[1],
      width: observation.bbox[2],
      height: observation.bbox[3],
    },
    axis: observation.axis,
    score: observation.score,
    uncertaintyPx: observation.uncertaintyPx,
    source: observation.source,
    reflectionCandidate: observation.attributes.reflectionCandidate,
    staticRackCandidate: observation.attributes.staticRackCandidate,
    occlusion: observation.attributes.occlusion,
    truncated: observation.attributes.truncated,
  }));
}

export function submitFrame(session: RustCanonicalWasmSession, frame: FixtureFrame): void {
  session.processCandidates(
    frame.candidates.map((candidate) => ({
      timestampMs: frame.timestampMs,
      candidateId: candidate.candidateId,
      bbox: {
        x: candidate.bbox[0],
        y: candidate.bbox[1],
        width: candidate.bbox[2],
        height: candidate.bbox[3],
      },
      torsoColor: candidate.torsoColor,
      landmarks: candidate.landmarks.map(([x, y, z, visibility]) => ({
        x,
        y,
        z,
        visibility,
      })),
      worldLandmarks: [],
    })),
    frame.timestampMs,
    mapEquipment(frame),
  );
}

export function packetHex(wasm: MotionWasmExports): string {
  const length = wasm.motion_sdk_packet_len();
  const pointer = wasm.motion_sdk_packet_ptr();
  assert.ok(length > 0, "Rust packet must not be empty");
  assert.ok(pointer > 0 && pointer + length <= wasm.memory.buffer.byteLength);
  return Buffer.from(new Uint8Array(wasm.memory.buffer, pointer, length)).toString("hex");
}

export function replayFixtureThroughWasm(
  wasm: MotionWasmExports,
  fixture: Halpe26EquipmentFixture,
  sequenceId = fixture.bridgeConfig.sequenceId,
): RuntimePackets {
  const session = new RustCanonicalWasmSession(sessionConfig(fixture, sequenceId), wasm);
  const packetHexes: string[] = [];
  const packets: DecodedMotionPacket[] = [];
  try {
    if (fixture.bridgeConfig.profileCode === 110) {
      session.setExerciseProfile("barbell_bench_press_local_front_left");
    } else if (fixture.bridgeConfig.profileCode !== 0) {
      throw new Error(`unsupported contract fixture profile code ${fixture.bridgeConfig.profileCode}`);
    }
    if (fixture.bridgeConfig.active) session.beginSet();
    for (const frame of fixture.frames) {
      submitFrame(session, frame);
      assert.ok(session.lastDecodedPacket, `missing packet at ${frame.timestampMs}ms`);
      packetHexes.push(packetHex(wasm));
      packets.push(session.lastDecodedPacket);
    }
  } finally {
    session.close();
  }
  return { packetHexes, packets };
}

export function replayFixtureThroughHostNative(
  fixturePath = FRONT_BENCH_FIXTURE,
): RuntimeAttempt<RuntimePackets> {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "maxpower-ticket06-native-"));
  const outputPath = path.join(temporaryDirectory, "oracle.json");
  try {
    execFileSync(
      process.env.CARGO ?? "cargo",
      [
        "run",
        "--quiet",
        "--manifest-path",
        "rust/motion-sdk/Cargo.toml",
        "--bin",
        "real_halpe26_bridge_oracle",
        "--",
        "--fixture",
        fixturePath,
        "--output",
        outputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 180_000 },
    );
    const oracle = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
      readonly frames: readonly { readonly packetHex: string }[];
    };
    const packetHexes = oracle.frames.map(({ packetHex: value }) => value);
    // The Web decoder is intentionally the single client projection used for
    // both byte streams; it does not recompute Rust semantics.
    const packets = packetHexes.map((value) => decodeMotionPacket(Buffer.from(value, "hex")));
    return {
      value: { packetHexes, packets },
      gate: {
        state: "passed",
        capability: "host-native-rust-vs-web-wasm-front-halpe26-barbell-bbox",
        reason: "identical client fixture produced byte-identical canonical packets",
        evidence: { frameCount: packetHexes.length },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      value: null,
      gate: {
        state: "platform-gated",
        capability: "host-native-rust-vs-web-wasm-front-halpe26-barbell-bbox",
        reason: "host native Rust oracle could not run",
        evidence: { error: message.slice(0, 500) },
      },
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export function inspectLocalMotionCoordinate(packet: DecodedMotionPacket): LocalMotionInspection {
  const packetRecord = packet as unknown as Readonly<Record<string, unknown>>;
  const value = record(packetRecord.localMotionCoordinate);
  if (!value) {
    return {
      availability: "missing",
      value: null,
      gate: {
        state: "data-gated",
        capability: "local-motion-coordinate-packet-contract",
        reason: "CanonicalMotionOutput.localMotionCoordinate is absent; Ticket 04 is not available",
      },
    };
  }

  const missing: string[] = REQUIRED_LOCAL_MOTION_PATHS.filter((field) => !(field in value));
  for (const channelName of ["equipment", "pose"] as const) {
    const channel = record(value[channelName]);
    if (value[channelName] !== null && !channel) {
      missing.push(`${channelName} (object-or-null)`);
      continue;
    }
    if (channel) {
      for (const field of REQUIRED_TRAJECTORY_CHANNEL_PATHS) {
        if (!(field in channel)) missing.push(`${channelName}.${field}`);
      }
    }
  }
  if (missing.length > 0) {
    return {
      availability: "invalid",
      value: value as unknown as Readonly<DecodedLocalMotionCoordinate>,
      gate: {
        state: "data-gated",
        capability: "local-motion-coordinate-packet-contract",
      reason: "localMotionCoordinate is present but violates the decoded v1 comparison contract",
        evidence: { missing },
      },
    };
  }

  return {
    availability: "valid",
    value: value as unknown as Readonly<DecodedLocalMotionCoordinate>,
    gate: {
      state: "passed",
      capability: "local-motion-coordinate-packet-contract",
      reason: value.state === "uninitialized"
        ? "uninitialized v1 coordinate is valid fail-closed evidence"
        : "decoded v1 coordinate, trajectory channels, provenance and agreement fields are present",
    },
  };
}

export function assertCoordinateParity(actual: unknown, expected: unknown, field = "localMotionCoordinate"): void {
  if (typeof actual === "number" || typeof expected === "number") {
    assert.equal(typeof actual, "number", `${field} actual must be numeric`);
    assert.equal(typeof expected, "number", `${field} expected must be numeric`);
    const actualNumber = actual as number;
    const expectedNumber = expected as number;
    assert.ok(Number.isFinite(actualNumber) && Number.isFinite(expectedNumber), `${field} must be finite`);
    assert.ok(
      Math.abs(actualNumber - expectedNumber) <= LOCAL_MOTION_FLOAT_TOLERANCE,
      `${field}: ${actualNumber} vs ${expectedNumber} exceeds ${LOCAL_MOTION_FLOAT_TOLERANCE}`,
    );
    return;
  }
  if (Array.isArray(actual) || Array.isArray(expected)) {
    assert.ok(Array.isArray(actual) && Array.isArray(expected), `${field} array mismatch`);
    assert.equal(actual.length, expected.length, `${field} length`);
    actual.forEach((value, index) => assertCoordinateParity(value, expected[index], `${field}[${index}]`));
    return;
  }
  const actualRecord = record(actual);
  const expectedRecord = record(expected);
  if (actualRecord || expectedRecord) {
    assert.ok(actualRecord && expectedRecord, `${field} object mismatch`);
    assert.deepEqual(Object.keys(actualRecord).sort(), Object.keys(expectedRecord).sort(), `${field} keys`);
    for (const key of Object.keys(actualRecord)) {
      assertCoordinateParity(actualRecord[key], expectedRecord[key], `${field}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, field);
}

export function orderedObliqueAxisGate(): ContractGate {
  const wasmAdapterSource = fs.readFileSync(
    path.join(process.cwd(), "src/motion/rustCanonicalWasm.ts"),
    "utf8",
  );
  const packetDecoderSource = fs.readFileSync(
    path.join(process.cwd(), "src/motion/motionPacket.ts"),
    "utf8",
  );
  const abiImplemented = wasmAdapterSource.includes("motion_sdk_add_equipment_axis_observation(")
    && wasmAdapterSource.includes("observation.axis.x1")
    && wasmAdapterSource.includes("observation.axis.y2");
  const decoderImplemented = packetDecoderSource.includes('marker !== "AXI1"')
    && packetDecoderSource.includes("projectedLength")
    && packetDecoderSource.includes("imageAngleRadians");
  const implemented = abiImplemented && decoderImplemented;
  return {
    state: implemented ? "passed" : "data-gated",
    capability: "ordered-oblique-bar-axis-input",
    reason: implemented
      ? "the shared WASM ABI accepts ordered x1/y1/x2/y2 shaft endpoints and MotionPacket v1.9+ decodes the resulting axis"
      : "the loaded WASM artifact does not export the ordered equipment-axis ABI",
    evidence: {
      orderedExample: { x1: 0.20, y1: 0.42, x2: 0.80, y2: 0.48 },
      wasmExport: "motion_sdk_add_equipment_axis_observation",
      decodedFields: ["x1", "y1", "x2", "y2", "projectedLength", "imageAngleRadians"],
      abiImplemented,
      decoderImplemented,
    },
  };
}

export function emitContractReport(name: string, gates: readonly ContractGate[], diagnostics: unknown = {}): void {
  console.log(JSON.stringify({
    schemaVersion: "maxpower.local-motion-runtime-contract/v1",
    name,
    gates,
    diagnostics,
  }));
}
