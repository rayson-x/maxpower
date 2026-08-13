import assert from "node:assert/strict";
import test from "node:test";

import {
  rawHalpe26Landmarks,
  validateSetCountOnlyClip,
  validateTrainOnlyManifest,
  type MmfitManifest,
  type MmfitManifestClip,
} from "./exportMmfitHalpe26CanonicalSequences";

const item: MmfitManifestClip = {
  clipFile: "shards/w01/w01-4.json.gz",
  sourceSequenceId: "w01:4",
  subjectId: "01",
  split: "train",
  sourceAction: "pushups",
  exerciseId: "push_up",
  expectedCount: 10,
  clipSha256: "a".repeat(64),
};

function manifest(overrides: Partial<MmfitManifest> = {}): MmfitManifest {
  return {
    complete: true,
    requestedSplits: ["train"],
    poseDomain: "mmfit_yolox_nano_humanart_rtmpose_m_halpe26_cpu",
    pipeline: "yolox-nano-humanart+rtmpose-m-halpe26",
    detectorModelSha256: "d".repeat(64),
    poseModelSha256: "p".repeat(64),
    clips: [item],
    ...overrides,
  };
}

test("MM-Fit canonical export rejects split leakage", () => {
  assert.throws(
    () => validateTrainOnlyManifest(manifest({ requestedSplits: ["train", "validation"] })),
    /train-only/,
  );
  assert.throws(
    () => validateTrainOnlyManifest(manifest({ clips: [{ ...item, split: "test" }] })),
    /non-train/,
  );
});

test("MM-Fit canonical export preserves only set-count supervision", () => {
  const clip = {
    sourceSequenceId: "w01:4",
    exerciseId: "push_up",
    split: "train",
    poseSchema: "halpe26",
    missingPointPolicy: "unknown; never synthesize",
    observation: {
      pipeline: "yolox-nano-humanart+rtmpose-m-halpe26",
      sourceVideo: { widthPx: 1280, heightPx: 720, mirrored: false, sourceVideoSha256: "v".repeat(64) },
    },
    label: { annotationGranularity: "set_count", startFrame: 100, endFrame: 400, totalRepetitions: 10, repBounds: [] },
    repBounds: [],
    techniqueQuality: "unknown",
    compensation: "unknown",
    frames: [],
  } as const;
  assert.doesNotThrow(() => validateSetCountOnlyClip(item, clip));
  assert.throws(
    () => validateSetCountOnlyClip(item, { ...clip, techniqueQuality: "standard" }),
    /technique truth/,
  );
});

test("missing detector frames remain a 26-point unknown sentinel", () => {
  const landmarks = rawHalpe26Landmarks({ frameNumber: 1, timestampMs: 100, landmarks: [] });
  assert.equal(landmarks.length, 26);
  assert.ok(landmarks.every((landmark) => landmark.visibility === 0));
});
