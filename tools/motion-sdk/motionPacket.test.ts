import assert from "node:assert/strict";
import test from "node:test";

import { decodeMotionPacket } from "../../src/motion/motionPacket";
import { createWebMotionPacket, routeWebMotionPacket } from "../../src/motion/webMotionPacket";

test("TypeScript decodes the versioned Rust MotionPacket once", () => {
  const sequence = new TextEncoder().encode("fixture:binary");
  const algorithm = new TextEncoder().encode("motion-session-replay/v1");
  const length = 44 + sequence.length + algorithm.length + 26;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 0, true);
  view.setUint32(8, length, true);
  view.setBigUint64(12, 9n, true);
  view.setBigUint64(20, 2_000n, true);
  view.setBigUint64(28, 3n, true);
  view.setUint8(36, 1);
  view.setUint8(37, 1);
  view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset);
  offset += sequence.length;
  view.setUint16(offset, algorithm.length, true);
  offset += 2;
  bytes.set(algorithm, offset);
  offset += algorithm.length;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint8(offset, 0);
  view.setUint8(offset + 1, 0b111);
  offset += 2;
  for (const value of [0.25, 0.5, 0, 0.9, 0.9, 0.02]) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }

  const packet = decodeMotionPacket(buffer);

  assert.equal(packet.lineage.sequenceId, "fixture:binary");
  assert.deepEqual(packet.lineage.contract, { major: 1, minor: 0 });
  assert.equal(packet.lineage.algorithmVersion, "motion-session-replay/v1");
  assert.equal(packet.frameId, 9n);
  assert.equal(packet.sourceTimestampMs, 2_000n);
  assert.equal(packet.subjectEpoch, 3n);
  assert.deepEqual(packet.target, {
    state: "locked",
    candidateCount: 1,
    selectedCandidateId: null,
  });
  assert.equal(packet.canonical.length, 1);
  assert.equal(packet.canonical[0].source, "measured");
  assert.equal(packet.canonical[0].reason, null);
  assert.equal(packet.canonical[0].renderable, true);
  assert.ok(Math.abs((packet.canonical[0].x ?? 0) - 0.25) < 1e-6);
  assert.ok(Math.abs((packet.canonical[0].uncertainty ?? 0) - 0.02) < 1e-6);
  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.canonical[0]), true);
  assert.equal(packet.repState.phase, "ready");
  assert.deepEqual(packet.completedReps, []);
});

test("decoder preserves Rust continuity reason independently of landmark source", () => {
  const sequence = new TextEncoder().encode("fixture:reason");
  const algorithm = new TextEncoder().encode("motion-session-replay/v1");
  const length = 44 + sequence.length + algorithm.length + 26;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 1, true);
  view.setUint32(8, length, true);
  view.setUint8(36, 1);
  view.setUint8(37, 1);
  view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset);
  offset += sequence.length;
  view.setUint16(offset, algorithm.length, true);
  offset += 2;
  bytes.set(algorithm, offset);
  offset += algorithm.length;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint8(offset, 2);
  view.setUint8(offset + 1, 0b0001_1011);
  offset += 2;
  for (const value of [0.25, 0.5, 0, 0.9, 0.4, 0.02]) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }

  const packet = decodeMotionPacket(buffer);
  assert.equal(packet.canonical[0].source, "predicted");
  assert.equal(packet.canonical[0].reason, "outlier-rejected-prediction");
});

test("decoder refuses corrupt or truncated packets", () => {
  assert.throws(() => decodeMotionPacket(new Uint8Array([1, 2, 3, 4]).buffer), /truncated/i);
  const corrupt = new Uint8Array(42);
  corrupt.set(new TextEncoder().encode("NOPE"));
  assert.throws(() => decodeMotionPacket(corrupt.buffer), /magic/i);
});

test("minor extension decodes subject identity and immutable sealed rep", () => {
  const sequence = new TextEncoder().encode("fixture:rep");
  const algorithm = new TextEncoder().encode("motion-session-replay/v1");
  const identity = new TextEncoder().encode("lat-pulldown/rear/bilateral/cable/v1");
  const length = 44 + sequence.length + algorithm.length + 4 + 30 + 84 + identity.length + 5;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 5, true);
  view.setUint32(8, length, true);
  view.setBigUint64(12, 10n, true);
  view.setBigUint64(20, 1_000n, true);
  view.setBigUint64(28, 2n, true);
  view.setUint8(36, 1);
  view.setUint8(37, 2);
  view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset);
  offset += sequence.length;
  view.setUint16(offset, algorithm.length, true);
  offset += 2;
  bytes.set(algorithm, offset);
  offset += algorithm.length;
  view.setUint16(offset, 0, true);
  offset += 2;
  bytes.set(new TextEncoder().encode("RPS1"), offset);
  offset += 4;
  view.setUint8(offset, 1);
  offset += 1;
  view.setBigUint64(offset, 77n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 3n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint16(offset, 1, true);
  offset += 2;
  for (const value of [1n, 2n, 200n, 5n, 500n, 9n, 900n, 123n, 456n]) {
    view.setBigUint64(offset, value, true);
    offset += 8;
  }
  view.setUint32(offset, 0, true);
  offset += 4;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint8(offset, 0b0110);
  offset += 1;
  view.setUint8(offset, 1);
  offset += 1;
  view.setUint8(offset, 0b101);
  offset += 1;
  view.setUint16(offset, identity.length, true);
  offset += 2;
  bytes.set(identity, offset);
  offset += identity.length;
  view.setUint16(offset, 0, true);
  offset += 2;
  bytes.set(new TextEncoder().encode("SET1"), offset);
  offset += 4;
  view.setUint8(offset, 3);

  const packet = decodeMotionPacket(buffer);
  assert.equal(packet.target.selectedCandidateId, 77n);
  assert.equal(packet.repState.partialAttempts, 3n);
  assert.equal(packet.completedReps.length, 1);
  assert.equal(packet.completedReps[0].canonicalSliceHash, 123n);
  assert.equal(packet.completedReps[0].profileIdentity, "lat-pulldown/rear/bilateral/cable/v1");
  assert.equal(packet.completedReps[0].qualityVerdict, null);
  assert.equal(packet.completedReps[0].recoveredAcrossGap, true);
  assert.equal(packet.completedReps[0].disposition, "needs_review");
  assert.equal(packet.completedReps[0].evidenceReason, "short_continuity_recovery");
  assert.deepEqual(packet.completedReps[0].observationFindings, [
    "primary_range_below_expectation",
    "cycle_faster_than_expected",
  ]);
  assert.equal(packet.setState.lifecycle, "paused");
});

test("v1.6 decodes Rust joint angle snapshots without recomputing them in the client", () => {
  const sequence = new TextEncoder().encode("fixture:angles");
  const algorithm = new TextEncoder().encode("rust-canonical-wasm/v1");
  const baseLength = 44 + sequence.length + algorithm.length;
  const length = baseLength + 34 + 5 + 21 + 29;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 6, true);
  view.setUint32(8, length, true);
  view.setUint8(36, 1);
  view.setUint8(37, 1);
  view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset);
  offset += sequence.length;
  view.setUint16(offset, algorithm.length, true);
  offset += 2;
  bytes.set(algorithm, offset);
  offset += algorithm.length;
  view.setUint16(offset, 0, true);
  offset += 2;

  bytes.set(new TextEncoder().encode("RPS1"), offset);
  offset += 4;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint16(offset, 0, true);
  offset += 2;

  bytes.set(new TextEncoder().encode("SET1"), offset);
  offset += 4;
  view.setUint8(offset, 0);
  offset += 1;

  bytes.set(new TextEncoder().encode("VER1"), offset);
  offset += 4;
  for (let index = 0; index < 3; index += 1) {
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint16(offset, 0, true);
  offset += 2;

  bytes.set(new TextEncoder().encode("ANG1"), offset);
  offset += 4;
  view.setUint8(offset, 2);
  offset += 1;
  for (const angle of [
    { kind: 0, side: 0, source: 0, flags: 0b11, value: 90, confidence: 0.95 },
    { kind: 3, side: 1, source: 2, flags: 0, value: 0, confidence: 0.4 },
  ]) {
    view.setUint8(offset, angle.kind);
    view.setUint8(offset + 1, angle.side);
    view.setUint8(offset + 2, angle.source);
    view.setUint8(offset + 3, angle.flags);
    view.setFloat32(offset + 4, angle.value, true);
    view.setFloat32(offset + 8, angle.confidence, true);
    offset += 12;
  }
  assert.equal(offset, length);

  const packet = decodeMotionPacket(buffer);
  assert.deepEqual(packet.jointAngles[0], {
    kind: "elbow",
    side: "left",
    valueDeg: 90,
    confidence: Math.fround(0.95),
    source: "measured",
    judgeable: true,
  });
  assert.deepEqual(packet.jointAngles[1], {
    kind: "knee",
    side: "right",
    valueDeg: null,
    confidence: Math.fround(0.4),
    source: "predicted",
    judgeable: false,
  });
});

test("v1.7 decodes Rust-associated equipment without inferring pose landmarks", () => {
  const sequence = new TextEncoder().encode("fixture:equipment");
  const algorithm = new TextEncoder().encode("motion-session-replay/v1");
  const baseLength = 44 + sequence.length + algorithm.length;
  const length = baseLength + 34 + 5 + 21 + 5 + 25 + 64;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 7, true);
  view.setUint32(8, length, true);
  view.setBigUint64(20, 1_000n, true);
  view.setUint8(36, 1);
  view.setUint8(37, 2);
  view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset);
  offset += sequence.length;
  view.setUint16(offset, algorithm.length, true);
  offset += 2;
  bytes.set(algorithm, offset);
  offset += algorithm.length;
  view.setUint16(offset, 0, true);
  offset += 2;

  bytes.set(new TextEncoder().encode("RPS1"), offset);
  offset += 4;
  view.setUint8(offset, 1);
  offset += 1;
  view.setBigUint64(offset, 41n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint8(offset, 0);
  offset += 1;
  view.setUint16(offset, 0, true);
  offset += 2;

  bytes.set(new TextEncoder().encode("SET1"), offset);
  offset += 4;
  view.setUint8(offset, 0);
  offset += 1;

  bytes.set(new TextEncoder().encode("VER1"), offset);
  offset += 4;
  for (let index = 0; index < 3; index += 1) {
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  view.setUint8(offset, 0);
  offset += 1;
  view.setBigUint64(offset, 0n, true);
  offset += 8;
  view.setUint16(offset, 0, true);
  offset += 2;

  bytes.set(new TextEncoder().encode("ANG1"), offset);
  offset += 4;
  view.setUint8(offset, 0);
  offset += 1;

  bytes.set(new TextEncoder().encode("EQP1"), offset);
  offset += 4;
  view.setUint8(offset, 0);
  view.setUint8(offset + 1, 0);
  view.setUint8(offset + 2, 1);
  offset += 3;
  view.setBigUint64(offset, 41n, true);
  offset += 8;
  for (const count of [1, 0, 0, 0]) {
    view.setUint16(offset, count, true);
    offset += 2;
  }
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setBigUint64(offset, 5n, true);
  offset += 8;
  view.setBigUint64(offset, 77n, true);
  offset += 8;
  view.setBigUint64(offset, 41n, true);
  offset += 8;
  view.setUint8(offset, 1);
  view.setUint8(offset + 1, 0);
  view.setUint8(offset + 2, 3);
  view.setUint8(offset + 3, 0b11);
  offset += 4;
  for (const value of [0.22, 0.42, 0.56, 0.035, 0.5, 0.4375, 0.92, 0.88, 2]) {
    view.setFloat32(offset, value, true);
    offset += 4;
  }
  assert.equal(offset, length);

  const packet = decodeMotionPacket(buffer);
  assert.equal(packet.canonical.length, 0);
  assert.deepEqual(packet.equipment.status, {
    kind: "observed",
    reason: null,
  });
  assert.equal(packet.equipment.subjectCandidateId, 41n);
  assert.equal(packet.equipment.rejectedReflectionCount, 1);
  assert.equal(packet.equipment.tracks.length, 1);
  assert.deepEqual(packet.equipment.tracks[0], {
    trackId: 5n,
    proposalId: 77n,
    subjectCandidateId: 41n,
    kind: "barbell_shaft",
    bbox: {
      x: Math.fround(0.22),
      y: Math.fround(0.42),
      width: Math.fround(0.56),
      height: Math.fround(0.035),
    },
    axis: null,
    centerX: Math.fround(0.5),
    centerY: Math.fround(0.4375),
    observationScore: Math.fround(0.92),
    associationConfidence: Math.fround(0.88),
    uncertaintyPx: 2,
    source: "detector",
    heldBy: "unknown",
    judgeablePath: true,
  });
});

function makeV18QualityPacket(quality: unknown): ArrayBuffer {
  const encoder = new TextEncoder();
  const sequence = encoder.encode("q");
  const algorithm = encoder.encode("a");
  const payload = encoder.encode(JSON.stringify(quality));
  const length = 40 + sequence.length + 2 + algorithm.length + 2
    + 34 + 5 + 21 + 5 + 25 + 8 + payload.length;
  const buffer = new ArrayBuffer(length);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let offset = 0;
  const marker = (value: string) => {
    bytes.set(encoder.encode(value), offset);
    offset += 4;
  };
  const u8 = (value: number) => { view.setUint8(offset, value); offset += 1; };
  const u16 = (value: number) => { view.setUint16(offset, value, true); offset += 2; };
  const u32 = (value: number) => { view.setUint32(offset, value, true); offset += 4; };
  const u64 = (value: bigint) => { view.setBigUint64(offset, value, true); offset += 8; };

  marker("MOTN");
  u16(1); u16(8); u32(length); u64(1n); u64(100n); u64(0n);
  u8(1); u8(1); u16(sequence.length);
  bytes.set(sequence, offset); offset += sequence.length;
  u16(algorithm.length); bytes.set(algorithm, offset); offset += algorithm.length;
  u16(0);
  marker("RPS1"); u8(0); u64(0n); u8(0); u64(0n); u8(0); u64(0n); u8(0); u16(0);
  marker("SET1"); u8(4);
  marker("VER1"); u16(0); u16(0); u16(0); u8(0); u64(0n); u16(0);
  marker("ANG1"); u8(0);
  marker("EQP1"); u8(1); u8(2); u8(0); u64(0n); u16(0); u16(0); u16(0); u16(0); u16(0);
  marker("QLT1"); u32(payload.length); bytes.set(payload, offset); offset += payload.length;
  assert.equal(offset, length);
  return buffer;
}

test("v1.10 preserves oblique shaft endpoints and local coordinate provenance", () => {
  const encoder = new TextEncoder();
  const sequence = encoder.encode("axis");
  const algorithm = encoder.encode("rust");
  const quality = encoder.encode(JSON.stringify({
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [],
  }));
  const local = encoder.encode(JSON.stringify({
    schemaVersion: "maxpower-local-motion-coordinate/v1",
    coordinateFrameId: 3,
    sourceTimestampMs: 1000,
    state: "frozen",
    reason: null,
    primaryAxis: [-0.2, 0.98],
    crossAxis: [0.98, 0.2],
    origin: [0.5, 0.4],
    scale: 0.6,
    scaleSource: "projected_bar_length",
    equipmentTrackId: 5,
    rawBarAxis: [0.2, 0.35, 0.8, 0.47],
    coarseView: "front_oblique_left",
    canonicalFeedMirrored: false,
    endpointOrderMapping: "screen_ordered_anatomy_unknown",
    anatomicalSideMapping: "endpoint_one_anatomical_right",
    equipment: { alongAxisProgress: 0.4, crossAxisDisplacement: 0.01, confidence: 0.92, coverage: 0.8, uncertainty: 0.08, provenance: "equipment_measured" },
    pose: null,
    channelAgreement: "equipment_only",
    endpointOneProgress: 0.39,
    endpointTwoProgress: 0.41,
    anatomicalLeftEndpointProgress: 0.41,
    anatomicalRightEndpointProgress: 0.39,
    rawBarAngleRadians: Math.atan2(0.12, 0.6),
    baselineCorrectedBarAngleRadians: 0.01,
    confidence: 0.92,
  }));
  const base = 40 + sequence.length + 2 + algorithm.length + 2;
  const equipmentLength = 4 + 3 + 8 + 8 + 2 + 24 + 4 + 36;
  const extensionLength = 8 + quality.length + 6 + 32 + 8 + local.length;
  const length = base + 34 + 5 + 21 + 5 + equipmentLength + extensionLength;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(encoder.encode("MOTN"), 0);
  view.setUint16(4, 1, true); view.setUint16(6, 10, true); view.setUint32(8, length, true);
  view.setUint8(36, 1); view.setUint8(37, 1); view.setUint16(38, sequence.length, true);
  let offset = 40;
  bytes.set(sequence, offset); offset += sequence.length;
  view.setUint16(offset, algorithm.length, true); offset += 2;
  bytes.set(algorithm, offset); offset += algorithm.length;
  view.setUint16(offset, 0, true); offset += 2;
  bytes.set(encoder.encode("RPS1"), offset); offset += 4;
  view.setUint8(offset, 1); offset += 1; view.setBigUint64(offset, 7n, true); offset += 8;
  view.setUint8(offset, 0); offset += 1; view.setBigUint64(offset, 0n, true); offset += 8;
  view.setUint8(offset, 0); offset += 1; view.setBigUint64(offset, 0n, true); offset += 8;
  view.setUint8(offset, 0); offset += 1; view.setUint16(offset, 0, true); offset += 2;
  bytes.set(encoder.encode("SET1"), offset); offset += 4; view.setUint8(offset, 2); offset += 1;
  bytes.set(encoder.encode("VER1"), offset); offset += 4;
  for (let i = 0; i < 3; i += 1) { view.setUint16(offset, 0, true); offset += 2; }
  view.setUint8(offset, 0); offset += 1; view.setBigUint64(offset, 0n, true); offset += 8;
  view.setUint16(offset, 0, true); offset += 2;
  bytes.set(encoder.encode("ANG1"), offset); offset += 4; view.setUint8(offset, 0); offset += 1;
  bytes.set(encoder.encode("EQP1"), offset); offset += 4;
  view.setUint8(offset, 0); view.setUint8(offset + 1, 0); view.setUint8(offset + 2, 1); offset += 3;
  view.setBigUint64(offset, 7n, true); offset += 8;
  for (let i = 0; i < 4; i += 1) { view.setUint16(offset, 0, true); offset += 2; }
  view.setUint16(offset, 1, true); offset += 2;
  view.setBigUint64(offset, 5n, true); offset += 8; view.setBigUint64(offset, 77n, true); offset += 8;
  view.setBigUint64(offset, 7n, true); offset += 8;
  view.setUint8(offset, 1); view.setUint8(offset + 1, 2); view.setUint8(offset + 2, 3); view.setUint8(offset + 3, 3); offset += 4;
  for (const value of [0.2, 0.35, 0.6, 0.12, 0.5, 0.41, 0.94, 0.92, 1]) { view.setFloat32(offset, value, true); offset += 4; }
  bytes.set(encoder.encode("QLT1"), offset); offset += 4; view.setUint32(offset, quality.length, true); offset += 4;
  bytes.set(quality, offset); offset += quality.length;
  bytes.set(encoder.encode("AXI1"), offset); offset += 4; view.setUint16(offset, 1, true); offset += 2;
  view.setBigUint64(offset, 5n, true); offset += 8;
  const axis = [0.2, 0.35, 0.8, 0.47];
  for (const value of [...axis, Math.hypot(0.6, 0.12), Math.atan2(0.12, 0.6)]) { view.setFloat32(offset, value, true); offset += 4; }
  bytes.set(encoder.encode("LMC1"), offset); offset += 4; view.setUint32(offset, local.length, true); offset += 4;
  bytes.set(local, offset); offset += local.length;
  assert.equal(offset, length);
  const packet = decodeMotionPacket(buffer);
  assert.ok((packet.equipment.tracks[0].axis?.imageAngleRadians ?? 0) > 0.1);
  assert.deepEqual(packet.localMotionCoordinate?.rawBarAxis, axis);
  assert.equal(packet.localMotionCoordinate?.endpointOrderMapping, "screen_ordered_anatomy_unknown");
  assert.equal(packet.localMotionCoordinate?.anatomicalSideMapping, "endpoint_one_anatomical_right");
  assert.equal(packet.localMotionCoordinate?.anatomicalLeftEndpointProgress, 0.41);
  assert.equal(packet.localMotionCoordinate?.anatomicalRightEndpointProgress, 0.39);
  assert.equal(packet.localMotionCoordinate?.equipment?.provenance, "equipment_measured");
  assert.equal(packet.localMotionCoordinate?.equipment?.coverage, 0.8);
  assert.equal(packet.localMotionCoordinate?.equipment?.uncertainty, 0.08);
  assert.equal(packet.localMotionCoordinate?.channelAgreement, "equipment_only");
});

test("v1.8 decodes and freezes Rust QLT1 proposals without recalculating quality", () => {
  const dimensions = [
    "task_completion", "range_of_motion", "phase_control", "support_stability",
    "bilateral_coordination", "trajectory_control", "standard_variant_compatibility",
    "observation_confidence",
  ];
  const packet = decodeMotionPacket(makeV18QualityPacket({
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{
      schemaVersion: "maxpower.motion-quality-proposal/v1",
      proposalId: "proposal-1",
      repId: 1,
      actionId: "lat_pulldown",
      capturePosition: "rear",
      anatomicalSide: null,
      equipmentRole: "cable_handle_not_observed",
      capability: "phase_supported",
      ruleBundleVersion: "personal-motion-quality-rules/v1",
      profileIdentity: "lat-pulldown/rear/bilateral/cable/v1",
      profileHash: "0000000000000001",
      canonicalSliceHash: "0000000000000002",
      endpoints: ["start_anchor", "primary_turnaround", "end_return"].map((kind, index) => ({
        kind,
        occurredFrameId: index + 1,
        occurredTimestampMs: 100 + index * 100,
        causalConfirmedTimestampMs: 300,
        phaseBefore: "ready",
        phaseAfter: "concentric",
        confidence: 0.8,
        evidenceChannels: ["pose_measured"],
      })),
      conclusions: dimensions.map((dimension) => ({
        conclusionId: `rep:1:${dimension}`,
        dimension,
        state: dimension === "support_stability"
          ? "cannot_judge"
          : dimension === "range_of_motion"
            ? "observed_deviation"
            : "observed_acceptable",
        summary: "proposal",
        evidence: [],
        reason: dimension === "support_stability" ? "missing support trajectory" : null,
        confidence: 0.8,
      })),
      contentHash: "0123456789abcdef",
    }],
  }));

  assert.equal(packet.qualityProposals.length, 1);
  assert.equal(packet.qualityProposals[0].endpoints[1].kind, "primary_turnaround");
  assert.equal(packet.qualityProposals[0].conclusions.length, 8);
  assert.equal(packet.qualityProposals[0].conclusions[0].state, "observed_acceptable");
  assert.equal(packet.qualityProposals[0].conclusions[1].state, "observed_deviation");
  assert.equal(Object.isFrozen(packet.qualityProposals[0]), true);
});

test("v1.8 rejects the obsolete observed_fact quality state", () => {
  const dimensions = [
    "task_completion", "range_of_motion", "phase_control", "support_stability",
    "bilateral_coordination", "trajectory_control", "standard_variant_compatibility",
    "observation_confidence",
  ];
  assert.throws(() => decodeMotionPacket(makeV18QualityPacket({
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{
      schemaVersion: "maxpower.motion-quality-proposal/v1",
      proposalId: "obsolete-state",
      repId: 1,
      actionId: "lat_pulldown",
      capturePosition: "rear",
      anatomicalSide: null,
      equipmentRole: "cable_handle_not_observed",
      capability: "phase_supported",
      ruleBundleVersion: "personal-motion-quality-rules/v1",
      profileIdentity: "lat-pulldown/rear/bilateral/cable/v1",
      profileHash: "0000000000000001",
      canonicalSliceHash: "0000000000000002",
      endpoints: ["start_anchor", "primary_turnaround", "end_return"].map((kind, index) => ({
        kind,
        occurredFrameId: index + 1,
        occurredTimestampMs: 100 + index * 100,
        causalConfirmedTimestampMs: 300,
        phaseBefore: "ready",
        phaseAfter: "concentric",
        confidence: 0.8,
        evidenceChannels: ["pose_measured"],
      })),
      conclusions: dimensions.map((dimension) => ({
        conclusionId: `rep:1:${dimension}`,
        dimension,
        state: "observed_fact",
        summary: "obsolete state",
        evidence: [],
        reason: null,
        confidence: 0.8,
      })),
      contentHash: "0123456789abcdef",
    }],
  })), /quality.*state/i);
});

test("v1.8 refuses a QLT1 proposal with a missing required dimension", () => {
  assert.throws(() => decodeMotionPacket(makeV18QualityPacket({
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{
      endpoints: ["start_anchor", "primary_turnaround", "end_return"].map((kind) => ({
        kind,
        occurredFrameId: 1,
        occurredTimestampMs: 100,
        causalConfirmedTimestampMs: 100,
        phaseBefore: "ready",
        phaseAfter: "concentric",
        confidence: 0.8,
        evidenceChannels: ["pose_measured"],
      })),
      conclusions: [],
    }],
  })), /quality.*dimension/i);
});

test("web rendering recording counting and analysis receive one immutable motion packet", () => {
  const packet = createWebMotionPacket({
    canonical: { frameId: 3 } as never,
    canonicalContentHash: 55n,
    target: null,
    repState: null,
    completedReps: [],
    rustPacket: null,
    referenceComparison: {
      status: "unavailable",
      reason: "no-installed-reviewed-profile",
      profileIdentity: null,
      qualityVerdict: null,
    },
  });
  const received: unknown[] = [];
  routeWebMotionPacket(packet, {
    render: (value) => received.push(value),
    count: (value) => received.push(value),
    record: (value) => received.push(value),
    analyze: (value) => received.push(value),
  });
  assert.equal(received.length, 4);
  assert.ok(received.every((value) => value === packet));
  assert.equal(Object.isFrozen(packet), true);
  assert.equal(Object.isFrozen(packet.completedReps), true);
});
