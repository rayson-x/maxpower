import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalPoseFrame } from "../../src/pose/canonicalPose";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";
import {
  WebRtmposeRustCameraAdapter,
  type WebVideoFrameCallback,
  type WebVideoFrameScheduler,
  type WebVideoFrameSource,
} from "../../src/pose/WebRtmposeRustCameraAdapter";

const candidate: PoseCandidateEstimate = {
  timestampMs: 1_000,
  candidateId: 7,
  landmarks: Array.from({ length: 26 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.8 })),
  worldLandmarks: [],
  bbox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 },
  torsoColor: [0.2, 0.3, 0.4],
};

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
