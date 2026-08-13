import assert from "node:assert/strict";
import test from "node:test";

import { trackDynamicSubject } from "../../public/harness/dynamic-subject-track.mjs";

const pose = (centerX, visibility = 0.95, scale = 1) => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: centerX, y: 0.5, z: 0, visibility: 0 }));
  for (const [index, dx, dy] of [
    [11, -0.10, -0.10], [12, 0.10, -0.10], [23, -0.08, 0.10], [24, 0.08, 0.10],
    [13, -0.15, 0], [14, 0.15, 0], [15, -0.20, 0.08], [16, 0.20, 0.08],
    [25, -0.08, 0.22], [26, 0.08, 0.22], [27, -0.08, 0.34], [28, 0.08, 0.34],
  ]) landmarks[index] = { x: centerX + dx * scale, y: 0.5 + dy * scale, z: 0, visibility };
  return { landmarks, worldLandmarks: [], torsoColor: [0.2, 0.2, 0.2] };
};

test("dynamic subject tracking follows identity when MediaPipe result indexes swap", () => {
  const foreground = [pose(0.50), pose(0.51), pose(0.52), pose(0.53)];
  const background = [pose(0.82, 0.95, 0.55), pose(0.81, 0.95, 0.55), pose(0.80, 0.95, 0.55), pose(0.79, 0.95, 0.55)];
  const frames = [
    { candidates: [foreground[0], background[0]] },
    { candidates: [background[1], foreground[1]] },
    { candidates: [foreground[2], background[2]] },
    { candidates: [background[3], foreground[3]] },
  ];
  const tracked = trackDynamicSubject(frames);
  assert.deepEqual(tracked.candidateIndexes, [0, 1, 0, 1]);
  assert.equal(tracked.diagnostics.indexSwitchCount, 3);
  assert.equal(tracked.diagnostics.impossibleJumpCount, 0);
});

test("dynamic subject tracking emits a gap instead of accepting a whole-body teleport", () => {
  const frames = [
    { candidates: [pose(0.50)] },
    { candidates: [pose(0.51)] },
    { candidates: [pose(0.90)] },
    { candidates: [pose(0.52)] },
  ];
  const tracked = trackDynamicSubject(frames);
  assert.equal(tracked.candidateIndexes[2], -1);
  assert.equal(tracked.diagnostics.gapFrameCount, 1);
  assert.equal(tracked.diagnostics.impossibleJumpCount, 0);
});
