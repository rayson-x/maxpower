import assert from "node:assert/strict";
import test from "node:test";

import {
  projectPoseEventQuality,
  projectRustQualityFromPacket,
} from "../../modules/pose-camera/src/qualityProjection";
import type { PoseEvent } from "../../modules/pose-camera/src/types";

const encoder = new TextEncoder();

function packet(
  minor: number,
  payload?: Record<string, unknown>,
  futureTail: ArrayLike<number> = new Uint8Array(),
): Uint8Array {
  const payloadBytes =
    payload === undefined
      ? new Uint8Array()
      : encoder.encode(JSON.stringify(payload));
  const qltLength = payload === undefined ? 0 : 8 + payloadBytes.length;
  const bytes = new Uint8Array(40 + qltLength + futureTail.length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("MOTN"), 0);
  view.setUint16(4, 1, true);
  view.setUint16(6, minor, true);
  view.setUint32(8, bytes.length, true);
  if (payload !== undefined) {
    bytes.set(encoder.encode("QLT1"), 40);
    view.setUint32(44, payloadBytes.length, true);
    bytes.set(payloadBytes, 48);
  }
  bytes.set(futureTail, 40 + qltLength);
  return bytes;
}

function extension(
  marker: "AXI1" | "LMC1",
  payload: ArrayLike<number>,
): Uint8Array {
  const bytes = new Uint8Array(8 + payload.length);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode(marker), 0);
  view.setUint32(4, payload.length, true);
  bytes.set(payload, 8);
  return bytes;
}

function axisExtension(trackCount = 0): Uint8Array {
  const bytes = new Uint8Array(6 + trackCount * 32);
  const view = new DataView(bytes.buffer);
  bytes.set(encoder.encode("AXI1"), 0);
  view.setUint16(4, trackCount, true);
  return bytes;
}

function concat(...parts: readonly ArrayLike<number>[]): Uint8Array {
  const bytes = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}

function poseEvent(packetBase64: string): PoseEvent {
  return {
    width: 1920,
    height: 1080,
    timestampMs: 1_000,
    model: "rtmpose-m-halpe26",
    poseSchema: "halpe26",
    packetBase64,
  };
}

test("native host projection preserves the exact Rust QLT1 JSON and proposal hashes", () => {
  const payload = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [
      {
        proposalId: "rust-proposal-7",
        repId: 73,
        endpoints: [
          { occurredTimestampMs: 901, causalConfirmedTimestampMs: 1_037 },
        ],
        conclusions: [
          { dimension: "trajectory_control", state: "cannot_judge" },
        ],
        contentHash: "0123456789abcdef",
        futureRustField: { mustSurvive: true },
      },
    ],
    futureEnvelopeField: ["also", "preserved"],
  };
  const bytes = packet(8, payload);
  const before = new Uint8Array(bytes);

  const projection = projectRustQualityFromPacket(bytes);

  assert.ok(projection);
  assert.equal(projection.marker, "QLT1");
  assert.equal(projection.schemaVersion, payload.schemaVersion);
  assert.equal(projection.payloadJson, JSON.stringify(payload));
  assert.deepEqual(projection.proposalIds, ["rust-proposal-7"]);
  assert.deepEqual(projection.proposalHashes, ["0123456789abcdef"]);
  assert.deepEqual(projection.proposals, payload.proposals);
  assert.equal(
    (projection.proposals[0].futureRustField as { mustSurvive: boolean })
      .mustSurvive,
    true,
  );
  assert.deepEqual(
    bytes,
    before,
    "projection must not mutate the canonical packet",
  );
});

test("native event projection adds only the Rust envelope and does not derive quality", () => {
  const payload = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [
      {
        proposalId: "opaque-proposal",
        contentHash: "fedcba9876543210",
        deliberatelyNonSemantic: "host-must-not-interpret",
      },
    ],
  };
  const source = poseEvent(Buffer.from(packet(8, payload)).toString("base64"));

  const projected = projectPoseEventQuality(source);

  assert.notEqual(projected, source);
  assert.equal(projected.packetBase64, source.packetBase64);
  assert.equal(
    projected.qualityProjection?.payloadJson,
    JSON.stringify(payload),
  );
  assert.equal("repCount" in projected, false);
  assert.equal("endpoints" in projected, false);
  assert.equal("qualityScore" in projected, false);
});

test("legacy packets remain unchanged and MOTN/1.8 keeps terminal QLT1 support", () => {
  const legacy = poseEvent(Buffer.from(packet(7)).toString("base64"));
  assert.equal(projectRustQualityFromPacket(packet(7)), null);
  assert.equal(projectPoseEventQuality(legacy), legacy);

  const payload = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{ proposalId: "p", contentHash: "aaaaaaaaaaaaaaaa" }],
  };
  const futureTail = encoder.encode("FTR1\u0003\u0000\u0000\u0000xyz");
  assert.equal(projectRustQualityFromPacket(packet(9, payload, futureTail)), null);

  const empty = projectRustQualityFromPacket(
    packet(8, {
      schemaVersion: "maxpower.motion-quality-proposal/v1",
      proposals: [],
      futureEnvelopeField: true,
    }),
  );
  assert.deepEqual(empty?.proposalHashes, []);
});

test("MOTN/1.10 projects QLT1 before the legal AXI1 and LMC1 extensions", () => {
  const payload = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [
      { proposalId: "v1.10", contentHash: "1010101010101010" },
    ],
  };
  const tail = concat(
    axisExtension(),
    extension("LMC1", encoder.encode('{"state":"frozen"}')),
  );

  assert.deepEqual(
    projectRustQualityFromPacket(packet(10, payload, tail))?.proposalIds,
    ["v1.10"],
  );
});

test("MOTN/1.10 fails closed when AXI1 or LMC1 framing is malformed", () => {
  const payload = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [
      { proposalId: "v1.10", contentHash: "1010101010101010" },
    ],
  };

  const wrongAxisMarker = concat(
    axisExtension(),
    extension("LMC1", encoder.encode("{}")),
  );
  wrongAxisMarker[0] = "Z".charCodeAt(0);
  assert.equal(
    projectRustQualityFromPacket(packet(10, payload, wrongAxisMarker)),
    null,
  );

  const truncatedAxisRecord = axisExtension();
  new DataView(truncatedAxisRecord.buffer).setUint16(4, 1, true);
  assert.equal(
    projectRustQualityFromPacket(
      packet(
        10,
        payload,
        concat(truncatedAxisRecord, extension("LMC1", encoder.encode("{}"))),
      ),
    ),
    null,
  );

  const malformedLocal = extension("LMC1", encoder.encode("{}"));
  new DataView(malformedLocal.buffer).setUint32(4, 3, true);
  assert.equal(
    projectRustQualityFromPacket(
      packet(10, payload, concat(axisExtension(), malformedLocal)),
    ),
    null,
  );

  const wrongLocalMarker = extension("LMC1", encoder.encode("{}"));
  wrongLocalMarker[0] = "Z".charCodeAt(0);
  assert.equal(
    projectRustQualityFromPacket(
      packet(10, payload, concat(axisExtension(), wrongLocalMarker)),
    ),
    null,
  );

  assert.equal(
    projectRustQualityFromPacket(
      packet(
        10,
        payload,
        concat(axisExtension(), extension("LMC1", encoder.encode("not-json"))),
      ),
    ),
    null,
  );
});

test("native projection ignores pseudo QLT1 markers outside a legal tail envelope", () => {
  const fakePayload = encoder.encode(JSON.stringify({
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{ proposalId: "fake", contentHash: "bbbbbbbbbbbbbbbb" }],
  }));
  const pseudoMarker = new Uint8Array(8 + fakePayload.length + 3);
  const pseudoView = new DataView(pseudoMarker.buffer);
  pseudoMarker.set(encoder.encode("QLT1"), 0);
  pseudoView.setUint32(4, fakePayload.length, true);
  pseudoMarker.set(fakePayload, 8);
  pseudoMarker.set(encoder.encode("xyz"), 8 + fakePayload.length);
  assert.equal(projectRustQualityFromPacket(packet(8, undefined, pseudoMarker)), null);

  const realPayload = {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{ proposalId: "real", contentHash: "cccccccccccccccc" }],
  };
  const prefixWithPseudoMarker = packet(8, undefined, pseudoMarker);
  const realBytes = encoder.encode(JSON.stringify(realPayload));
  const bytes = new Uint8Array(prefixWithPseudoMarker.length + 8 + realBytes.length);
  bytes.set(prefixWithPseudoMarker);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, bytes.length, true);
  bytes.set(encoder.encode("QLT1"), prefixWithPseudoMarker.length);
  view.setUint32(prefixWithPseudoMarker.length + 4, realBytes.length, true);
  bytes.set(realBytes, prefixWithPseudoMarker.length + 8);
  assert.deepEqual(projectRustQualityFromPacket(bytes)?.proposalIds, ["real"]);
});

test("malformed or hashless QLT1 is not projected into a misleading host object", () => {
  assert.equal(
    projectRustQualityFromPacket(packet(8, { proposals: [] })),
    null,
  );
  assert.equal(
    projectRustQualityFromPacket(
      packet(8, {
        schemaVersion: "maxpower.motion-quality-proposal/v1",
        proposals: [{ proposalId: "p" }],
      }),
    ),
    null,
  );

  const malformed = packet(8, {
    schemaVersion: "maxpower.motion-quality-proposal/v1",
    proposals: [{ proposalId: "p", contentHash: "aaaaaaaaaaaaaaaa" }],
  });
  new DataView(malformed.buffer).setUint32(44, 0x7fff_ffff, true);
  assert.equal(projectRustQualityFromPacket(malformed), null);
});
