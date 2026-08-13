"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createWorkspace,
  frameAt,
  trajectoryUntil,
} = require("./qualityReviewApp.js");

test("workspace keeps proposals frozen and exports endpoint and conclusion decisions only on demand", () => {
  const release = fixtureRelease();
  const workspace = createWorkspace(release, { reviewerId: "owner", reviewerRole: "owner_observation" });
  const review = workspace.review("item-a");

  review.setDecision({
    target: { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" },
    verdict: "incorrect",
    correctedValue: null,
  });
  review.setDecision({
    target: { kind: "conclusion", repId: "rep-1", conclusionId: "rom-complete" },
    verdict: "correct",
    correctedValue: null,
  });

  assert.equal(Object.isFrozen(review.proposal), true);
  assert.equal(workspace.progress().decided, 2);
  assert.equal(workspace.progress().total, 4);

  const json = workspace.exportJson({
    exportId: "export-a",
    exportedAt: "2026-08-13T23:45:00.000Z",
    applicationVersion: "quality-review/v1",
  });
  const exported = JSON.parse(json);
  assert.equal(exported.releaseHash, "sha256:release-a");
  assert.equal(exported.proposalReviews.length, 1);
  assert.equal(exported.proposalReviews[0].review.decisions.length, 2);
  assert.deepEqual(exported.proposalReviews[0].review.decisions.map((decision) => decision.target.kind), [
    "endpoint",
    "conclusion",
  ]);

  release.items[0].proposal.reps[0].endpoints.primary_turnaround.occurredAtMs = 9_999;
  assert.equal(review.proposal.reps[0].endpoints.primary_turnaround.occurredAtMs, 2_000);
});

test("workspace round trip preserves explicit incorrect null corrections", () => {
  const release = fixtureRelease();
  const first = createWorkspace(release, { reviewerId: "owner", reviewerRole: "owner_observation" });
  first.review("item-a").setDecision({
    target: { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" },
    verdict: "incorrect",
    correctedValue: null,
    note: "候选点偏晚",
  });
  const metadata = {
    exportId: "export-a",
    exportedAt: "2026-08-13T23:45:00.000Z",
    applicationVersion: "quality-review/v1",
  };
  const exported = first.exportJson(metadata);

  const restored = createWorkspace(release, { reviewerId: "placeholder", reviewerRole: "owner_observation" });
  restored.importJson(exported);
  assert.equal(restored.exportJson(metadata), exported);
  assert.equal(restored.review("item-a").listDecisions()[0].correctedValue, null);
});

test("evidence helpers synchronize observations and equipment trails to the video clock", () => {
  const frames = [{ timestampMs: 1_000 }, { timestampMs: 1_100 }, { timestampMs: 1_500 }];
  assert.equal(frameAt(frames, 1_240, 150), frames[1]);
  assert.equal(frameAt(frames, 1_251, 150), null);
  assert.deepEqual(trajectoryUntil([
    { timestampMs: 900, x: 0.4, y: 0.2 },
    { timestampMs: 1_200, x: 0.4, y: 0.3 },
    { timestampMs: 1_800, x: 0.4, y: 0.4 },
  ], 1_300), [
    { timestampMs: 900, x: 0.4, y: 0.2 },
    { timestampMs: 1_200, x: 0.4, y: 0.3 },
  ]);
});

function fixtureRelease() {
  return {
    schemaVersion: "maxpower-motion-quality-review-release/v1",
    releaseId: "release-a",
    releaseHash: "sha256:release-a",
    frozenAt: "2026-08-13T23:30:00.000Z",
    runKind: "full_data_proposal",
    items: [{
      itemId: "item-a",
      captureId: "capture-a",
      videoUrl: "/media/quality-review?id=item-a",
      durationMs: 4_000,
      humanSegments: [{ startMs: 900, endMs: 3_100 }],
      evidence: { frames: [], equipmentTrajectories: [] },
      proposal: {
        schemaVersion: "maxpower-motion-quality-proposal/v1",
        proposalHash: "sha256:proposal-a",
        lineage: { runId: "run-a", runKind: "full_data_proposal" },
        reps: [{
          repId: "rep-1",
          endpoints: {
            start_anchor: { occurredAtMs: 1_000, confirmedAtMs: 1_000 },
            primary_turnaround: { occurredAtMs: 2_000, confirmedAtMs: 2_100 },
            end_return: { occurredAtMs: 3_000, confirmedAtMs: 3_100 },
          },
          conclusions: [{
            conclusionId: "rom-complete",
            dimension: "rom_endpoint_completeness",
            state: "observed_acceptable",
            confidence: 0.91,
          }],
        }],
      },
    }],
  };
}
