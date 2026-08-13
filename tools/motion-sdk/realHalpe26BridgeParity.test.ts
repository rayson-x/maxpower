import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import type { CanonicalLandmark, CanonicalPoseFrame } from "../../src/pose/canonicalPose";
import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type MotionWasmExports,
} from "../../src/motion/rustCanonicalWasm";

interface FixtureCandidate {
  candidateId: number;
  bbox: readonly [number, number, number, number];
  torsoColor: readonly [number, number, number];
  landmarks: readonly (readonly [number, number, number, number])[];
}

interface FixtureFrame {
  sourceFrameNumber: number;
  timestampMs: number;
  candidates: readonly FixtureCandidate[];
  equipmentObservations: readonly FixtureEquipmentObservation[];
}

interface FixtureEquipmentObservation {
  proposalId: number;
  kind: "weight_plate" | "barbell_shaft" | "dumbbell" | "machine_handle";
  bbox: readonly [number, number, number, number];
  score: number;
  uncertaintyPx: number | null;
  source: "detector" | "optical_flow" | "geometry" | "predicted";
  attributes: {
    reflectionCandidate: boolean;
    staticRackCandidate: boolean;
    occlusion: "none" | "partial" | "heavy";
    truncated: boolean;
  };
}

interface Fixture {
  source: { captureId: string; widthPx: number; heightPx: number };
  bridgeConfig: {
    sequenceId: string;
    fusionCode: number;
    poseSchema: "halpe26";
    profileCode: number;
    active: boolean;
  };
  frames: readonly FixtureFrame[];
}

interface Oracle {
  fixtureIdentity: { captureId: string; frameCount: number };
  frames: readonly {
    sourceFrameNumber: number;
    timestampMs: number;
    candidateIds: readonly number[];
    packetLength: number;
    packetHex: string;
    currentFrameValid: boolean;
  }[];
}

const fixturePath = path.join(
  process.cwd(),
  "tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.json",
);
const oraclePath = path.join(
  process.cwd(),
  "tools/motion-sdk/fixtures/front-bench-mirror-halpe26-multi-candidate-v1.rust-oracle.json",
);

function packetHex(wasm: MotionWasmExports): string {
  const length = wasm.motion_sdk_packet_len();
  const pointer = wasm.motion_sdk_packet_ptr();
  assert.ok(length > 0);
  assert.ok(pointer > 0 && pointer + length <= wasm.memory.buffer.byteLength);
  return Buffer.from(new Uint8Array(wasm.memory.buffer, pointer, length)).toString("hex");
}

function mapEquipment(frame: FixtureFrame) {
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

test("Web replays the real front-bench mirror Halpe-26 fixture byte-exactly through Rust", async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture;
  const oracle = JSON.parse(fs.readFileSync(oraclePath, "utf8")) as Oracle;
  assert.equal(fixture.bridgeConfig.poseSchema, "halpe26");
  assert.equal(fixture.bridgeConfig.fusionCode, 1);
  assert.equal(fixture.bridgeConfig.profileCode, 0);
  assert.equal(fixture.bridgeConfig.active, false);
  assert.equal(oracle.fixtureIdentity.captureId, fixture.source.captureId);
  assert.equal(oracle.fixtureIdentity.frameCount, fixture.frames.length);

  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(process.cwd(), "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  const session = new RustCanonicalWasmSession({
    sequenceId: fixture.bridgeConfig.sequenceId,
    schema: "halpe26",
    image: {
      widthPx: fixture.source.widthPx,
      heightPx: fixture.source.heightPx,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);

  try {
    fixture.frames.forEach((frame, index) => {
      const expected = oracle.frames[index];
      assert.equal(expected.sourceFrameNumber, frame.sourceFrameNumber);
      assert.equal(expected.timestampMs, frame.timestampMs);
      assert.deepEqual(expected.candidateIds, frame.candidates.map(({ candidateId }) => candidateId));
      session.processCandidates(frame.candidates.map((candidate) => ({
        timestampMs: frame.timestampMs,
        candidateId: candidate.candidateId,
        bbox: {
          x: candidate.bbox[0],
          y: candidate.bbox[1],
          width: candidate.bbox[2],
          height: candidate.bbox[3],
        },
        torsoColor: candidate.torsoColor,
        landmarks: candidate.landmarks.map(([x, y, z, visibility]) => ({ x, y, z, visibility })),
        worldLandmarks: [],
      })), frame.timestampMs, mapEquipment(frame));

      assert.equal(wasm.motion_sdk_packet_len(), expected.packetLength);
      assert.equal(packetHex(wasm), expected.packetHex, `packet drift at source frame ${frame.sourceFrameNumber}`);
      assert.equal(session.lastFrameValid, expected.currentFrameValid);
      assert.equal(session.lastTarget.selectedCandidateId, 0n);
      assert.equal(session.lastTarget.candidateCount, frame.candidates.length);
    });
  } finally {
    session.close();
  }
});

test("front-bench low-confidence elbows and wrists are not published as reliable measurements", async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture;
  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(process.cwd(), "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  const session = new RustCanonicalWasmSession({
    sequenceId: `${fixture.bridgeConfig.sequenceId}:low-confidence-arm-contract`,
    schema: "halpe26",
    image: {
      widthPx: fixture.source.widthPx,
      heightPx: fixture.source.heightPx,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);

  try {
    let targetFrame: CanonicalPoseFrame | null = null;
    for (const frame of fixture.frames) {
      const canonical = session.processCandidates(frame.candidates.map((candidate) => ({
        timestampMs: frame.timestampMs,
        candidateId: candidate.candidateId,
        bbox: {
          x: candidate.bbox[0],
          y: candidate.bbox[1],
          width: candidate.bbox[2],
          height: candidate.bbox[3],
        },
        torsoColor: candidate.torsoColor,
        landmarks: candidate.landmarks.map(([x, y, z, visibility]) => ({ x, y, z, visibility })),
        worldLandmarks: [],
      })), frame.timestampMs, mapEquipment(frame));
      if (frame.timestampMs === 20_800) targetFrame = canonical;
    }

    assert.ok(targetFrame, "fixture must contain the reported 20.8 second frame");
    assert.equal(
      session.lastTarget.selectedCandidateId,
      0n,
      "the foreground athlete must remain selected instead of the mirror candidate",
    );
    for (const jointIndex of [7, 8, 9, 10]) {
      const joint: CanonicalLandmark = targetFrame.landmarks[jointIndex];
      assert.ok(
        joint.observationScore < 0.5,
        `fixture joint ${jointIndex} must remain a low-confidence RTMPose observation`,
      );
      assert.notEqual(
        joint.source,
        "measured",
        `low-confidence Halpe joint ${jointIndex} must be fused, predicted, or unknown`,
      );
    }
  } finally {
    session.close();
  }
});

test("Web submits the research geometry bar observation and consumes Rust-associated evidence", async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as Fixture;
  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(process.cwd(), "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  const session = new RustCanonicalWasmSession({
    sequenceId: `${fixture.bridgeConfig.sequenceId}:equipment-v1.7`,
    schema: "halpe26",
    image: {
      widthPx: fixture.source.widthPx,
      heightPx: fixture.source.heightPx,
      rotationDegrees: 0,
      mirrored: false,
    },
    stabilization: "fusion",
    setLifecycleMode: "preview",
  }, wasm);

  try {
    const frame = fixture.frames[0];
    session.processCandidates(frame.candidates.map((candidate) => ({
      timestampMs: frame.timestampMs,
      candidateId: candidate.candidateId,
      bbox: {
        x: candidate.bbox[0],
        y: candidate.bbox[1],
        width: candidate.bbox[2],
        height: candidate.bbox[3],
      },
      torsoColor: candidate.torsoColor,
      landmarks: candidate.landmarks.map(([x, y, z, visibility]) => ({ x, y, z, visibility })),
      worldLandmarks: [],
    })), frame.timestampMs, mapEquipment(frame));

    assert.equal(session.lastDecodedPacket?.lineage.contract.minor, 10);
    assert.ok(session.lastDecodedPacket?.qualityProposals);
    assert.equal(session.lastDecodedPacket?.equipment.status.kind, "observed");
    assert.equal(session.lastDecodedPacket?.equipment.subjectCandidateId, 0n);
    assert.equal(session.lastDecodedPacket?.equipment.tracks.length, 1);
    assert.equal(session.lastDecodedPacket?.equipment.tracks[0].kind, "barbell_shaft");
    assert.equal(session.lastDecodedPacket?.equipment.tracks[0].proposalId, BigInt(frame.sourceFrameNumber));
    assert.equal(session.lastDecodedPacket?.equipment.tracks[0].source, "geometry");
  } finally {
    session.close();
  }
});
