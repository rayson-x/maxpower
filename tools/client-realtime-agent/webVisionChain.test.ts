import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalPoseFrame } from "../../src/pose/canonicalPose";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";
import type { OrtModule } from "../../src/shims/onnxRuntime";
import {
  createVerifiedOnnxSession,
  fetchAndVerifyBinaryArtifact,
} from "../../src/pose/YoloxPersonDetector";
import {
  WebRtmposeRustCameraAdapter,
  type WebVideoFrameCallback,
  type WebVideoFrameScheduler,
  type WebVideoFrameSource,
} from "../../src/pose/WebRtmposeRustCameraAdapter";
import {
  buildPredictionIdentity,
  canReuseFrozenPrediction,
  projectRustQualityProposals,
} from "./browserHarness";

const candidate: PoseCandidateEstimate = {
  timestampMs: 1_000,
  candidateId: 7,
  landmarks: Array.from({ length: 26 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.8 })),
  worldLandmarks: [],
  bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
  torsoColor: [0.2, 0.3, 0.4],
};

const ABC_SHA256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

test("Web ONNX loading verifies pinned bytes before creating a session", async () => {
  const bytes = new TextEncoder().encode("abc");
  let sessionCreateCalls = 0;
  const ort = {
    InferenceSession: {
      async create(input: string | Uint8Array) {
        sessionCreateCalls += 1;
        assert.ok(input instanceof Uint8Array, "the ONNX runtime must receive verified bytes, never a URL");
        assert.deepEqual([...input], [...bytes]);
        return { inputNames: ["input"], outputNames: [], async run() { return {}; }, async release() {} };
      },
    },
  } as unknown as OrtModule;
  const pinned = {
    id: "fixture-model",
    publicPath: "/models/fixture.onnx",
    bytes: 3,
    sha256: ABC_SHA256,
  } as const;
  const fetcher = async () => new Response(bytes);

  const verified = await fetchAndVerifyBinaryArtifact(pinned, fetcher);
  const created = await createVerifiedOnnxSession(ort, verified);
  assert.equal(created.executionProvider, "webgpu");
  assert.equal(sessionCreateCalls, 1);

  await assert.rejects(
    fetchAndVerifyBinaryArtifact({ ...pinned, bytes: 4 }, fetcher),
    /byte size mismatch/i,
  );
  await assert.rejects(
    fetchAndVerifyBinaryArtifact({ ...pinned, sha256: "0".repeat(64) }, fetcher),
    /sha-256 mismatch/i,
  );
  assert.equal(sessionCreateCalls, 1, "invalid bytes never reach ONNX session creation");
});

test("frozen Web predictions are reusable only under the complete byte and runtime identity", async () => {
  const base = {
    packSha256: "pack-sha",
    profileArchiveSha256: "profile-archive-sha",
    models: {
      yolox: { id: "yolox", publicPath: "/yolox.onnx", bytes: 3, sha256: "1".repeat(64) },
      rtmpose: { id: "rtmpose", publicPath: "/rtmpose.onnx", bytes: 4, sha256: "2".repeat(64) },
    },
    rustWasm: { id: "rust", publicPath: "/motion.wasm", bytes: 5, sha256: "3".repeat(64) },
    profiles: [
      { captureId: "capture-1", profileIdentity: "profile/front/v1", contentHash: "101" },
    ],
    runtime: {
      onnxRuntime: "onnxruntime-web@1.22.0",
      yoloxExecutionProvider: "webgpu",
      rtmposeExecutionProvider: "webgpu",
      motionPacketContract: "MOTN/1.8+QLT1",
      pass: "causal-chronological-single-pass",
      harness: "maxpower-client-single-pass/v2",
      userAgent: "fixture-browser/1",
    },
  } as const;
  const expected = await buildPredictionIdentity(base);
  const frozen = {
    schemaVersion: "maxpower-client-single-pass-prediction/v2",
    packSha256: base.packSha256,
    predictionIdentity: expected.identity,
    predictionIdentitySha256: expected.sha256,
  };
  assert.equal(canReuseFrozenPrediction(frozen, expected), true);

  for (const changed of [
    { ...base, packSha256: "other-pack" },
    { ...base, models: { ...base.models, yolox: { ...base.models.yolox, sha256: "9".repeat(64) } } },
    { ...base, rustWasm: { ...base.rustWasm, sha256: "8".repeat(64) } },
    { ...base, profileArchiveSha256: "other-profile-archive" },
    { ...base, profiles: [{ ...base.profiles[0], contentHash: "202" }] },
    { ...base, runtime: { ...base.runtime, rtmposeExecutionProvider: "wasm" as const } },
  ]) {
    const other = await buildPredictionIdentity(changed);
    assert.equal(
      canReuseFrozenPrediction(frozen, other),
      false,
      "a frozen result cannot survive any inference identity change",
    );
  }
});

test("browser result projects Rust MOTN/1.8 QLT1 proposals without host interpretation", () => {
  const proposals = Object.freeze([{ proposalId: "rust-proposal-1", contentHash: "1".repeat(16) }]);
  const projection = projectRustQualityProposals({
    lineage: { contract: { major: 1, minor: 8 } },
    qualityProposals: proposals,
  });
  assert.equal(projection.packetContract, "MOTN/1.8+QLT1");
  assert.equal(projection.owner, "rust-motion-sdk");
  assert.strictEqual(projection.proposals, proposals, "the host must preserve the Rust proposal array");
  assert.throws(() => projectRustQualityProposals({
    lineage: { contract: { major: 1, minor: 7 } },
    qualityProposals: proposals,
  }), /MOTN\/1\.8\+QLT1/);
});

test("Web camera adapter processes exactly one captured frame at a time", async () => {
  const scheduled = new Map<number, WebVideoFrameCallback>();
  let nextHandle = 1;
  const scheduler: WebVideoFrameScheduler = {
    request(_video, callback) {
      const handle = nextHandle++;
      scheduled.set(handle, callback);
      return handle;
    },
    cancel(_video, handle) {
      scheduled.delete(handle);
    },
  };
  const firstInference = deferred<readonly PoseCandidateEstimate[]>();
  const observedTimestamps: number[] = [];
  let inferenceCalls = 0;
  let lumaReads = 0;
  const vision = {
    latestInferenceMs: 14,
    resetTracking() {},
    estimateCapturedFrame(_video: HTMLVideoElement, timestampMs: number) {
      inferenceCalls += 1;
      observedTimestamps.push(timestampMs);
      return inferenceCalls === 1
        ? firstInference.promise.then((value) => [...value])
        : Promise.resolve([{ ...candidate, timestampMs }]);
    },
    readCapturedLumaFrame() {
      lumaReads += 1;
      return { width: 8, height: 8, luma: new Uint8Array(64) };
    },
  };
  const rustInputs: Array<{ timestampMs: number; candidateCount: number; hasLuma: boolean }> = [];
  let beginCount = 0;
  let finishCount = 0;
  const motion = {
    lastTarget: { state: "locked" as const, candidateCount: 1, selectedCandidateId: 7n, subjectEpoch: 1n },
    lastRepState: { phase: "effort" as const, partialAttempts: 0n, activeRepId: 1n, recoveredAcrossGap: false },
    lastCompletedReps: [],
    lastVisualBarbellAxis: null,
    lastFrameValid: true,
    lastTiming: { coreMs: 2, decodeMs: 1 },
    beginSet() { beginCount += 1; },
    finishSet() { finishCount += 1; },
    processCandidates(
      candidates: readonly PoseCandidateEstimate[],
      timestampMs: number,
      _equipment: readonly [],
      luma?: { width: number; height: number; luma: Uint8Array },
    ) {
      rustInputs.push({ timestampMs, candidateCount: candidates.length, hasLuma: Boolean(luma) });
      return {} as CanonicalPoseFrame;
    },
  };
  const frames: number[] = [];
  const video = fakeVideo();
  const adapter = new WebRtmposeRustCameraAdapter(video, vision, motion, {
    scheduler,
    detectBarbellAxis: true,
    onFrame: (frame) => frames.push(frame.timestampMs),
  });

  adapter.start();
  assert.equal(beginCount, 1);
  assert.equal(scheduled.size, 1);
  fireOnlyFrame(scheduled, 1.000);
  assert.equal(inferenceCalls, 1);
  assert.equal(scheduled.size, 0, "no second frame is registered while ONNX inference is active");

  firstInference.resolve([candidate]);
  await settleAsyncWork();
  assert.deepEqual(rustInputs, [{ timestampMs: 1_000, candidateCount: 1, hasLuma: true }]);
  assert.deepEqual(frames, [1_000]);
  assert.equal(lumaReads, 1);
  assert.equal(scheduled.size, 1, "next camera callback is registered only after Rust consumed the frame");

  fireOnlyFrame(scheduled, 1.000);
  await settleAsyncWork();
  assert.deepEqual(observedTimestamps, [1_000, 1_001], "duplicate media timestamps stay monotonic");
  assert.deepEqual(frames, [1_000, 1_001]);

  await adapter.stop();
  assert.equal(finishCount, 1);
  assert.equal(scheduled.size, 0);
});

test("equipment pixels are omitted when the preset does not use a barbell", async () => {
  const scheduler = immediateScheduler(2.5);
  let lumaReads = 0;
  let receivedLuma = true;
  const video = fakeVideo();
  const adapter = new WebRtmposeRustCameraAdapter(video, {
    latestInferenceMs: 10,
    resetTracking() {},
    async estimateCapturedFrame() { return []; },
    readCapturedLumaFrame() {
      lumaReads += 1;
      return { width: 8, height: 8, luma: new Uint8Array(64) };
    },
  }, {
    lastTarget: { state: "acquiring", candidateCount: 0, selectedCandidateId: null, subjectEpoch: 0n },
    lastRepState: { phase: "ready", partialAttempts: 0n, activeRepId: null, recoveredAcrossGap: false },
    lastCompletedReps: [],
    lastVisualBarbellAxis: null,
    lastFrameValid: false,
    lastTiming: { coreMs: 1, decodeMs: 1 },
    beginSet() {},
    finishSet() {},
    processCandidates(_candidates, _timestampMs, _equipment, luma) {
      receivedLuma = Boolean(luma);
      return {} as CanonicalPoseFrame;
    },
  }, {
    scheduler,
    detectBarbellAxis: false,
  });

  adapter.start();
  await settleAsyncWork();
  await adapter.stop();
  assert.equal(lumaReads, 0);
  assert.equal(receivedLuma, false);
});

function fakeVideo(): WebVideoFrameSource {
  return {
    readyState: 4,
    videoWidth: 1_280,
    videoHeight: 720,
    currentTime: 0,
  } as WebVideoFrameSource;
}

function fireOnlyFrame(callbacks: Map<number, WebVideoFrameCallback>, mediaTime: number): void {
  const [entry] = callbacks.entries();
  if (!entry) throw new Error("expected a scheduled video frame");
  callbacks.delete(entry[0]);
  entry[1](performance.now(), { mediaTime });
}

function immediateScheduler(mediaTime: number): WebVideoFrameScheduler {
  let cancelled = false;
  let delivered = false;
  return {
    request(_video, callback) {
      if (!delivered) {
        delivered = true;
        queueMicrotask(() => {
          if (!cancelled) callback(performance.now(), { mediaTime });
        });
      }
      return 1;
    },
    cancel() { cancelled = true; },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function settleAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
