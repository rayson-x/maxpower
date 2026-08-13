"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const {
  benchmarkEvidenceForItem,
  createWorkspace,
  dimensionLabel,
  frameAt,
  lineageSummary,
  syncExistingDecisionDraft,
  trajectoryUntil,
} = require("./qualityReviewApp.js");

test("evidence mode controls remain visible in the sticky audit header", () => {
  const html = readFileSync("tools/recognition-review/public/quality-review.html", "utf8");
  const brand = html.match(/<div class="brand">([\s\S]*?)<\/div>\s*<\/div>/u)?.[1] ?? "";
  const topActions = html.match(/<div class="top-actions">([\s\S]*?)<\/div>\s*<\/header>/u)?.[1] ?? "";

  assert.match(brand, /class="evidence-mode-switch"/u);
  assert.doesNotMatch(topActions, /class="evidence-mode-switch"/u);
  assert.match(html, /\.brand-copy\s*\{[^}]*min-width:\s*0/iu);
});

test("review release exposes touched frozen benchmark evidence beside calibration proposals", () => {
  const release = fixtureRelease();
  const evidence = benchmarkEvidenceForItem(release, release.items[0]);
  assert.equal(evidence.contextId, "capture-a");
  assert.equal(evidence.reps[0].turnaroundTimestampMs, 2_050);
  assert.equal(release.evidenceRuns.benchmark.frozenPredictions.contexts[0].proposalHash, "sha256:benchmark-a");
});

test("lineage readout exposes the applied equipment policy instead of a generic placeholder", () => {
  assert.equal(lineageSummary({
    profileIdentity: "barbell_bench_press/frontLeft45/bilateral/barbell/touched-v1",
    profileHash: "profile-a",
    appliedPolicy: { candidate: "equipment_only", policyHash: "policy-a" },
  }), "barbell_bench_press/frontLeft45/bilateral/barbell/touched-v1 · profile-a · equipment_only · policy-a");
});

test("current Rust eight-dimension keys render with Chinese review labels", () => {
  assert.deepEqual(Object.fromEntries([
    "task_completion",
    "range_of_motion",
    "phase_control",
    "support_stability",
    "bilateral_coordination",
    "trajectory_control",
    "standard_variant_compatibility",
    "observation_confidence",
  ].map((key) => [key, dimensionLabel(key)])), {
    task_completion: "动作任务完成",
    range_of_motion: "行程与端点",
    phase_control: "阶段控制",
    support_stability: "支撑稳定",
    bilateral_coordination: "双侧协调",
    trajectory_control: "轨迹控制",
    standard_variant_compatibility: "标准变式兼容性",
    observation_confidence: "观测可信度",
  });
});

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

test("verdict-then-edit updates the exported decision without changing its verdict", () => {
  const workspace = createWorkspace(fixtureRelease(), {
    reviewerId: "owner",
    reviewerRole: "owner_observation",
  });
  const review = workspace.review("item-a");
  const target = { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" };

  review.setDecision({
    target,
    verdict: "incorrect",
    correctedValue: null,
    note: null,
  });
  syncExistingDecisionDraft(review, target, {
    correctedValue: { occurredAtMs: 1_875 },
    note: "换向点应更早",
  });
  const metadata = {
    exportId: "export-after-edit",
    exportedAt: "2026-08-13T23:46:00.000Z",
    applicationVersion: "quality-review/v1",
  };
  const edited = JSON.parse(workspace.exportJson(metadata))
    .proposalReviews[0].review.decisions[0];
  assert.equal(edited.verdict, "incorrect");
  assert.deepEqual(edited.correctedValue, { occurredAtMs: 1_875 });
  assert.equal(edited.note, "换向点应更早");

  syncExistingDecisionDraft(review, target, {
    correctedValue: null,
    note: "保留错误结论，但暂时没有答案",
  });

  const exported = JSON.parse(workspace.exportJson(metadata));
  const decision = exported.proposalReviews[0].review.decisions[0];
  assert.equal(decision.verdict, "incorrect");
  assert.equal(decision.correctedValue, null);
  assert.equal(decision.note, "保留错误结论，但暂时没有答案");
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
    evidenceRuns: {
      benchmark: {
        runKind: "touched_benchmark",
        acceptanceEligible: false,
        truthStatus: "withheld_from_inference",
        frozenPredictions: {
          schemaVersion: "maxpower-motion-quality-touched-benchmark-predictions/v1",
          state: "frozen_before_truth",
          runId: "benchmark-run-a",
          runKind: "touched_benchmark",
          planDigest: "sha256:plan-a",
          frozenDigest: "sha256:frozen-a",
          contexts: [{
            sourceCaptureId: "capture-a",
            contextId: "capture-a",
            proposalHash: "sha256:benchmark-a",
            capability: "quality_supported",
            reps: [{
              repId: "rep-1",
              startTimestampMs: 1_050,
              turnaroundTimestampMs: 2_050,
              endTimestampMs: 3_050,
              disposition: "confirmed",
            }],
            qualityConclusions: [],
          }],
        },
      },
      calibration: {
        runKind: "full_data_proposal",
        acceptanceEligible: false,
        sourceRunId: "run-a",
        sourceFrozenDigest: "sha256:calibration-a",
      },
    },
    items: [{
      itemId: "item-a",
      captureId: "capture-a",
      videoUrl: "/media/quality-review?id=item-a",
      durationMs: 4_000,
      humanSegments: [{ startMs: 900, endMs: 3_100 }],
      evidence: { frames: [], equipmentTrajectories: [] },
      evidenceLinks: { calibrationContextId: "capture-a", benchmarkContextId: "capture-a" },
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
