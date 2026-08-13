import assert from "node:assert/strict";
import test from "node:test";

import {
  replaySelectionFromRecordedVideo,
  trainingVideoSaveState,
} from "../../src/mobile/trainingVideo";

test("a stopped recorder remains pending until native finalization returns a local path", () => {
  assert.equal(trainingVideoSaveState(false, null), undefined);
  assert.equal(trainingVideoSaveState(true, null), "saving");
  assert.equal(trainingVideoSaveState(true, { status: "saved" }), "saving");
  assert.equal(trainingVideoSaveState(true, { status: "error", error: "disk_full" }), "failed");
  assert.equal(trainingVideoSaveState(true, { status: "saved", path: "/private/Movies/maxpower.mp4" }), "saved");
});

test("only a finalized local video can carry the current exercise into replay", () => {
  assert.equal(replaySelectionFromRecordedVideo({
    event: { status: "error", error: "disk_full" },
    exerciseId: "barbell_row",
    capturePosition: "rear",
  }), undefined);

  assert.deepEqual(replaySelectionFromRecordedVideo({
    event: { status: "saved", path: "/private/Movies/maxpower.mp4" },
    exerciseId: "barbell_row",
    capturePosition: "rear",
  }), {
    exerciseId: "barbell_row",
    capturePosition: "rear",
    videoPath: "/private/Movies/maxpower.mp4",
  });
});
