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
import { decodeMotionPacket, type DecodedMotionPacket } from "../../src/motion/motionPacket";

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
  readonly value: Readonly<Record<string, unknown>> | null;
}

const REQUIRED_LOCAL_MOTION_PATHS = [
  "contractVersion",
  "frameId",
  "state",
  "primaryAxis.x",
  "primaryAxis.y",
  "crossAxis.x",
  "crossAxis.y",
  "scale.value",
  "scale.source",
  "equipment.progress",
  "equipment.crossPath",
  "equipment.provenance",
  "pose.progress",
  "pose.crossPath",
  "pose.provenance",
  "channelAgreement",
  "confidence",
  "abstentionReason",
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

function valueAt(root: Readonly<Record<string, unknown>>, dottedPath: string): unknown {
  let current: unknown = root;
  for (const part of dottedPath.split(".")) {
    const currentRecord = record(current);
    if (!currentRecord || !(part in currentRecord)) return undefined;
    current = currentRecord[part];
  }
  return current;
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

  const missing = REQUIRED_LOCAL_MOTION_PATHS.filter((field) => valueAt(value, field) === undefined);
  if (missing.length > 0) {
    return {
      availability: "invalid",
      value,
      gate: {
        state: "data-gated",
        capability: "local-motion-coordinate-packet-contract",
        reason: "localMotionCoordinate is present but violates the Ticket 06 comparison contract",
        evidence: { missing },
      },
    };
  }

  return {
    availability: "valid",
    value,
    gate: {
      state: "passed",
      capability: "local-motion-coordinate-packet-contract",
      reason: "required discrete, numeric, provenance, agreement and abstention fields are present",
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
  return {
    state: "data-gated",
    capability: "ordered-oblique-bar-axis-input",
    reason: "RustEquipmentObservation currently accepts bbox only; x1/y1/x2/y2 cannot enter the shared client-format stream",
    evidence: {
      requiredExample: { x1: 0.20, y1: 0.42, x2: 0.80, y2: 0.48 },
      availableFields: ["bbox.x", "bbox.y", "bbox.width", "bbox.height"],
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
