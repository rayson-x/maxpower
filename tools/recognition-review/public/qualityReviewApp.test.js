"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const QualityReviewI18n = require("./qualityReviewI18n.js");

const {
  benchmarkEvidenceForItem,
  clearLocalDraft,
  createWorkspace,
  dimensionLabel,
  draftStorageKey,
  frameAt,
  lineageSummary,
  syncExistingDecisionDraft,
  restoreLocalDraft,
  saveLocalDraft,
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

test("portrait review video is constrained to a media-aware evidence stage", () => {
  const html = readFileSync("tools/recognition-review/public/quality-review.html", "utf8");
  const app = readFileSync("tools/recognition-review/public/qualityReviewApp.js", "utf8");

  assert.match(html, /\.video-stage\s*\{[^}]*aspect-ratio:\s*var\(--media-aspect/iu);
  assert.match(html, /\.video-stage\s+video\s*\{[^}]*position:\s*absolute[^}]*inset:\s*0[^}]*width:\s*100%[^}]*height:\s*100%[^}]*object-fit:\s*contain/iu);
  assert.match(app, /--media-aspect/iu);
});

test("narrow review windows stack the audit rails instead of clipping the video", () => {
  const html = readFileSync("tools/recognition-review/public/quality-review.html", "utf8");

  assert.match(html, /body\s*\{[^}]*min-width:\s*0/iu);
  assert.match(html, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/iu);
  assert.match(html, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.queue-list\s*\{[^}]*overflow-x:\s*auto/iu);
});

test("quality conclusions render stable Chinese translations beside the Rust English source", () => {
  assert.deepEqual(QualityReviewI18n.localizeConclusionText(
    "The visible excursion reached the recognizer's cycle gate.",
  ), {
    zh: "可见动作幅度已达到当前识别器的计次阈值。",
    en: "The visible excursion reached the recognizer's cycle gate.",
    translated: true,
  });
  assert.deepEqual(QualityReviewI18n.localizeConclusionText(
    "Observed eccentric for 1291ms, then concentric for 103ms.",
  ), {
    zh: "观察到离心阶段持续 1291 ms，随后向心阶段持续 103 ms。",
    en: "Observed eccentric for 1291ms, then concentric for 103ms.",
    translated: true,
  });
  assert.equal(
    QualityReviewI18n.localizeConclusionReason(
      "This is profile-relative visible motion, not a universal standard-ROM verdict.",
    ).zh,
    "这只表示相对于当前识别 Profile 的可见运动幅度，不是通用的标准动作行程结论。",
  );
  assert.deepEqual(QualityReviewI18n.localizeConclusionState("observed_acceptable"), {
    zh: "观测范围内可接受",
    en: "Observed acceptable",
    translated: true,
  });
});

test("unknown Rust conclusion copy remains visible without inventing a translation", () => {
  assert.deepEqual(QualityReviewI18n.localizeConclusionText("A future Rust conclusion."), {
    zh: "中文翻译待补充",
    en: "A future Rust conclusion.",
    translated: false,
  });
});

test("review page wires bilingual conclusion copy before mounting the app", () => {
  const html = readFileSync("tools/recognition-review/public/quality-review.html", "utf8");
  const i18nIndex = html.indexOf('<script src="/qualityReviewI18n.js"></script>');
  const appIndex = html.indexOf('<script src="/qualityReviewApp.js"></script>');

  assert.ok(i18nIndex >= 0 && i18nIndex < appIndex);
  assert.match(html, /\.conclusion-copy-zh\s*\{/u);
  assert.match(html, /\.conclusion-copy-en\s*\{/u);
});

test("release-scoped local draft survives a workspace refresh and can be cleared", () => {
  const release = fixtureRelease();
  const storage = memoryStorage();
  const reviewer = { reviewerId: "owner", reviewerRole: "owner_observation" };
  const first = createWorkspace(release, reviewer);
  first.review("item-a").setDecision({
    target: { kind: "endpoint", repId: "rep-1", endpoint: "primary_turnaround" },
    verdict: "incorrect",
    correctedValue: null,
  });

  const saved = saveLocalDraft(storage, first, "2026-08-14T01:02:03.000Z");
  assert.equal(saved.decided, 1);
  assert.equal(storage.getItem(draftStorageKey(first.release)) != null, true);

  const refreshed = createWorkspace(fixtureRelease(), reviewer);
  assert.deepEqual(restoreLocalDraft(storage, refreshed), {
    restored: true,
    decided: 1,
    savedAt: "2026-08-14T01:02:03.000Z",
  });
  assert.equal(refreshed.progress().decided, 1);

  clearLocalDraft(storage, refreshed.release);
  assert.equal(storage.getItem(draftStorageKey(refreshed.release)), null);
});

test("local draft never crosses a frozen release hash boundary", () => {
  const storage = memoryStorage();
  const reviewer = { reviewerId: "owner", reviewerRole: "owner_observation" };
  const original = createWorkspace(fixtureRelease(), reviewer);
  saveLocalDraft(storage, original, "2026-08-14T01:02:03.000Z");
  const nextRelease = fixtureRelease();
  nextRelease.releaseHash = `sha256:${"b".repeat(64)}`;
  const next = createWorkspace(nextRelease, reviewer);

  assert.deepEqual(restoreLocalDraft(storage, next), { restored: false, decided: 0, savedAt: null });
});

test("review page declares browser-local autosave without weakening explicit export", () => {
  const html = readFileSync("tools/recognition-review/public/quality-review.html", "utf8");
  const app = readFileSync("tools/recognition-review/public/qualityReviewApp.js", "utf8");

  assert.match(html, /id="qualityClearDraft"/u);
  assert.match(html, /自动保存到此浏览器/u);
  assert.match(app, /localStorage/u);
  assert.match(app, /saveLocalDraft/u);
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

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
