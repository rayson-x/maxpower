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
  const length = 44 + sequence.length + algorithm.length + 4 + 30 + 82 + identity.length;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, 1, true);
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
  view.setUint8(offset, 0b10);
  offset += 1;
  view.setUint16(offset, identity.length, true);
  offset += 2;
  bytes.set(identity, offset);
  offset += identity.length;
  view.setUint16(offset, 0, true);

  const packet = decodeMotionPacket(buffer);
  assert.equal(packet.target.selectedCandidateId, 77n);
  assert.equal(packet.repState.partialAttempts, 3n);
  assert.equal(packet.completedReps.length, 1);
  assert.equal(packet.completedReps[0].canonicalSliceHash, 123n);
  assert.equal(packet.completedReps[0].profileIdentity, "lat-pulldown/rear/bilateral/cable/v1");
  assert.equal(packet.completedReps[0].qualityVerdict, null);
  assert.equal(packet.completedReps[0].recoveredAcrossGap, true);
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
