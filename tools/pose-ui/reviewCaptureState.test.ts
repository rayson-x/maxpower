import assert from "node:assert/strict";
import test from "node:test";

import {
  revocableCaptureUrlsExcluding,
  reviewDraftAfterContextChange,
  shouldSelectProcessedInboxCapture,
} from "../../src/pose/reviewCaptureState";

test("changing exercise or capture position preserves reviewed rep ranges", () => {
  const segments = [
    { repIndex: 1, startMs: 1000, peakMs: 1500, endMs: 2000, note: "底部停顿" },
    { repIndex: 2, startMs: 2500, peakMs: 3000, endMs: 3500 },
  ];

  assert.deepEqual(reviewDraftAfterContextChange({
    candidateId: "auto",
    segments,
  }), {
    candidateId: "manual_range",
    segments,
  });
  assert.deepEqual(reviewDraftAfterContextChange({
    candidateId: "auto",
    segments: [],
  }), {
    candidateId: null,
    segments: [],
  });
});

test("background inbox tracking never steals selection after review interaction", () => {
  assert.equal(shouldSelectProcessedInboxCapture({
    foreground: false,
    interactionRevisionAtStart: 0,
    currentInteractionRevision: 0,
  }), true);
  assert.equal(shouldSelectProcessedInboxCapture({
    foreground: false,
    interactionRevisionAtStart: 0,
    currentInteractionRevision: 1,
  }), false);
  assert.equal(shouldSelectProcessedInboxCapture({
    foreground: false,
    interactionRevisionAtStart: 2,
    currentInteractionRevision: 2,
  }), false);
  assert.equal(shouldSelectProcessedInboxCapture({
    foreground: true,
    interactionRevisionAtStart: 4,
    currentInteractionRevision: 5,
  }), true);
});

test("merging capture sources revokes only object URLs that are no longer retained", () => {
  const retained = { videoUrl: "blob:retained", revokeVideoUrl: true };
  const displaced = { videoUrl: "blob:displaced", revokeVideoUrl: true };
  const freshDuplicate = { videoUrl: "blob:fresh-duplicate", revokeVideoUrl: true };
  const permanent = { videoUrl: "/archives/video.mp4", revokeVideoUrl: false };

  assert.deepEqual(
    revocableCaptureUrlsExcluding([freshDuplicate, retained], [retained, displaced, permanent]),
    ["blob:fresh-duplicate"],
  );
  assert.deepEqual(
    revocableCaptureUrlsExcluding([retained, displaced, permanent], [retained, freshDuplicate]),
    ["blob:displaced"],
  );
});
