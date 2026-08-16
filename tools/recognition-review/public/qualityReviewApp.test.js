"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const QualityReviewI18n = require("./qualityReviewI18n.js");

const {
  benchmarkEvidenceForItem,
  clearLocalDraft,
  coordinateEvidenceHtml,
  coordinateEvidenceSummary,
  coordinateStatusSummary,
  coordinateStatusText,
  correctionSelection,
  conclusionReviewPriority,
  createWorkspace,
  dimensionLabel,
  draftStorageKey,
  EVIDENCE_LAYER_DEFINITIONS,
  evidenceLayerControlsHtml,
  equipmentAxisGeometry,
  frameAt,
  frameEvidenceLayers,
  isPredictedEvidence,
  legacyEquipmentTrajectoryUntil,
  lineageSummary,
  normalizedTrajectoryUntil,
  syncExistingDecisionDraft,
  restoreLocalDraft,
  saveLocalDraft,
  structuredConclusionCorrection,
  trajectoryUntil,
} = require("./qualityReviewApp.js");

test("review page reserves a visible evidence strip for raw and local-frame facts", () => {
  const html = readFileSync("tools/recognition-review/public/quality-review.html", "utf8");

  assert.match(html, /id="coordinateEvidencePanel"/u);
  assert.match(html, /class="coordinate-evidence-panel"/u);
  assert.match(html, /\.coordinate-evidence-panel\s*\{/u);
  assert.match(html, /原始斜视角器械轴/u);
  assert.match(html, /Raw oblique equipment axis/u);
  assert.match(html, /规范局部轨迹/u);
  assert.match(html, /Canonical local-frame trajectory/u);
});

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

test("known unimplemented abstentions stay reviewable without inflating core progress", () => {
  const release = fixtureRelease();
  const conclusion = release.items[0].proposal.reps[0].conclusions[0];
  conclusion.conclusionId = "support-gap";
  conclusion.dimension = "support_stability";
  conclusion.state = "cannot_judge";
  assert.equal(conclusionReviewPriority(conclusion), "known_gap");

  const workspace = createWorkspace(release, {
    reviewerId: "owner",
    reviewerRole: "owner_observation",
  });
  assert.deepEqual(workspace.progress(), {
    decided: 0,
    total: 4,
    coreDecided: 0,
    coreTotal: 3,
    optionalDecided: 0,
    optionalTotal: 1,
  });
  workspace.review("item-a").setDecision({
    target: { kind: "conclusion", repId: "rep-1", conclusionId: "support-gap" },
    verdict: "correct",
    correctedValue: null,
  });
  assert.equal(workspace.progress().coreDecided, 0);
  assert.equal(workspace.progress().optionalDecided, 1);
});

test("conclusion corrections use a typed expected state and issue code", () => {
  assert.deepEqual(structuredConclusionCorrection("observed_deviation", "local_coordinate_wrong"), {
    schemaVersion: "maxpower-motion-quality-correction/v1",
    expectedState: "observed_deviation",
    issueCode: "local_coordinate_wrong",
  });
  assert.equal(structuredConclusionCorrection("", ""), null);
  assert.deepEqual(correctionSelection({
    schemaVersion: "maxpower-motion-quality-correction/v1",
    expectedState: "not_applicable",
    issueCode: "conclusion_state_wrong",
  }), {
    expectedState: "not_applicable",
    issueCode: "conclusion_state_wrong",
  });
  assert.deepEqual(correctionSelection({ state: "cannot_judge", reason: "legacy_reason" }), {
    expectedState: "cannot_judge",
    issueCode: "legacy_reason",
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

test("review overlay keeps raw pose visible and preserves an oblique equipment axis", () => {
  const unknownCanonical = Array.from({ length: 26 }, () => ({
    x: null,
    y: null,
    renderable: false,
  }));
  const inputPose = Array.from({ length: 26 }, (_, index) => ({
    x: 0.2 + index / 100,
    y: 0.3 + index / 200,
    visibility: 0.8,
  }));
  const axis = {
    kind: "barbell_shaft",
    source: "geometry_input",
    confidence: 0.91,
    x1: 0.01,
    y1: 0.434,
    x2: 0.98,
    y2: 0.478,
  };

  const layers = frameEvidenceLayers({
    landmarks: unknownCanonical,
    inputPose: { landmarks: inputPose },
    equipment: [{ x: 0.01, y: 0.446, width: 0.97, height: 0.02 }],
    inputEquipmentAxes: [axis],
  });

  assert.equal(layers.canonicalPose.length, 26);
  assert.equal(layers.inputPose, inputPose);
  assert.deepEqual(layers.equipment, [axis]);
});

test("review overlay prefers the canonical Rust shaft axis and safely falls back for legacy frames", () => {
  const canonicalTrack = {
    trackId: "rust-track-7",
    source: "geometry",
    confidence: 0.96,
    axis: { x1: 0.12, y1: 0.31, x2: 0.88, y2: 0.47 },
  };
  const inputAxis = {
    source: "geometry_input",
    confidence: 0.91,
    x1: 0.05,
    y1: 0.4,
    x2: 0.95,
    y2: 0.4,
  };

  const canonical = frameEvidenceLayers({
    equipment: [canonicalTrack, { trackId: "plate-8", x: 0.82, y: 0.3, width: 0.1, height: 0.18 }],
    inputEquipmentAxes: [inputAxis],
  });
  assert.deepEqual(canonical.rawEquipment, [
    canonicalTrack,
    { trackId: "plate-8", x: 0.82, y: 0.3, width: 0.1, height: 0.18 },
  ]);
  assert.deepEqual(canonical.equipment, canonical.rawEquipment);
  assert.deepEqual(equipmentAxisGeometry(canonical.rawEquipment[0]), {
    x1: 0.12,
    y1: 0.31,
    x2: 0.88,
    y2: 0.47,
  });
  assert.notEqual(
    equipmentAxisGeometry(canonical.rawEquipment[0]).y1,
    equipmentAxisGeometry(canonical.rawEquipment[0]).y2,
  );

  const legacy = frameEvidenceLayers({
    equipment: [{ x: 0.05, y: 0.39, width: 0.9, height: 0.02 }],
    inputEquipmentAxes: [inputAxis],
  });
  assert.deepEqual(legacy.rawEquipment, [inputAxis]);
  assert.deepEqual(equipmentAxisGeometry(legacy.rawEquipment[0]), {
    x1: 0.05,
    y1: 0.4,
    x2: 0.95,
    y2: 0.4,
  });
});

test("legacy review releases retain their raw equipment trails without local coordinates", () => {
  const trajectories = [{
    kind: "external_load_center",
    points: [
      { timestampMs: 100, x: 0.4, y: 0.2 },
      { timestampMs: 200, x: 0.42, y: 0.3 },
      { timestampMs: 300, x: 0.45, y: 0.4 },
    ],
  }];

  assert.deepEqual(legacyEquipmentTrajectoryUntil(trajectories, 250), [[
    { timestampMs: 100, x: 0.4, y: 0.2 },
    { timestampMs: 200, x: 0.42, y: 0.3 },
  ]]);
});

test("review projection keeps raw and normalized channels separate and exposes fusion state", () => {
  const coordinate = {
    schemaVersion: "maxpower-local-motion-coordinate/v1",
    coordinateFrameId: 12,
    state: "frozen",
    reason: null,
    primaryAxis: [0, 1],
    crossAxis: [1, 0],
    origin: [0.5, 0.5],
    scale: 0.2,
    scaleSource: "projected_bar_length",
    equipment: {
      alongAxisProgress: 0.4,
      crossAxisDisplacement: -0.1,
      confidence: 0.92,
      provenance: "equipment_measured",
    },
    pose: {
      alongAxisProgress: 0.5,
      crossAxisDisplacement: 0.25,
      confidence: 0.78,
      provenance: "pose_measured",
    },
    channelAgreement: "agreement",
    confidence: 0.86,
  };
  const layers = frameEvidenceLayers({
    timestampMs: 1_250,
    landmarks: [{ x: 0.2, y: 0.3, source: "predicted", renderable: true }],
    equipment: [{ axis: { x1: 0.1, y1: 0.3, x2: 0.9, y2: 0.4 } }],
    localMotionCoordinate: coordinate,
  });

  assert.deepEqual(layers.normalizedPose.point, { x: 0.55, y: 0.6 });
  assert.deepEqual(layers.normalizedEquipment.point, { x: 0.48, y: 0.5800000000000001 });
  assert.equal(layers.fusionStatus.status, "agreement");
  assert.deepEqual(coordinateStatusSummary(layers.coordinate), {
    coordinateFrameId: 12,
    state: "frozen",
    scale: 0.2,
    scaleSource: "projected_bar_length",
    confidence: 0.86,
    reason: null,
    fusionStatus: "agreement",
  });
  assert.equal(isPredictedEvidence(layers.rawSkeleton.canonical[0]), true);
  assert.equal(isPredictedEvidence(layers.normalizedPose), false);
});

test("normalized trails remain channel-specific and layer controls expose every review surface", () => {
  const frames = [
    localCoordinateFrame(100, 0.1, 0.2),
    localCoordinateFrame(200, 0.2, 0.4),
    localCoordinateFrame(300, 0.3, 0.6),
  ];

  assert.deepEqual(normalizedTrajectoryUntil(frames, 250, "pose").map((sample) => ({
    timestampMs: sample.timestampMs,
    point: sample.point,
  })), [
    { timestampMs: 100, point: { x: 0.5, y: 0.52 } },
    { timestampMs: 200, point: { x: 0.5, y: 0.54 } },
  ]);
  assert.deepEqual(normalizedTrajectoryUntil(frames, 250, "equipment").map((sample) => ({
    timestampMs: sample.timestampMs,
    point: sample.point,
  })), [
    { timestampMs: 100, point: { x: 0.5, y: 0.54 } },
    { timestampMs: 200, point: { x: 0.5, y: 0.5800000000000001 } },
  ]);
  assert.deepEqual(EVIDENCE_LAYER_DEFINITIONS.map(({ key }) => key), [
    "rawSkeleton",
    "rawEquipment",
    "normalizedPose",
    "normalizedEquipment",
    "fusionStatus",
  ]);
  const controls = evidenceLayerControlsHtml();
  EVIDENCE_LAYER_DEFINITIONS.forEach(({ key, label }) => {
    assert.match(controls, new RegExp(`data-quality-layer="${key}"`, "u"));
    assert.match(controls, new RegExp(label, "u"));
  });
  assert.equal((controls.match(/aria-pressed="true"/gu) || []).length, 5);
});

test("coordinate status readout keeps state scale confidence reason and fusion visible", () => {
  assert.equal(coordinateStatusText({
    coordinateFrameId: 12,
    state: "degraded",
    scale: 0.257,
    scaleSource: "projected_bar_length",
    confidence: 0.63,
    reason: "observation_gap",
    fusionStatus: "equipment_only",
  }), "COORD #12 · DEGRADED · SCALE projected_bar_length 0.257 · CONF 63% · REASON observation_gap · FUSION equipment_only");
  assert.equal(coordinateStatusText(null), "COORD UNAVAILABLE · REASON no_coordinate_evidence");
  assert.equal(coordinateStatusText({
    coordinateFrameId: 12,
    state: "frozen",
    scale: 0.2,
    scaleSource: "projected_bar_length",
    confidence: 0.86,
    reason: null,
    fusionStatus: "agreement",
  }, false), "COORD #12 · FROZEN · SCALE projected_bar_length 0.200 · CONF 86% · REASON none");
});

test("coordinate evidence names screen-ordered endpoints without inventing anatomy", () => {
  const summary = coordinateEvidenceSummary({
    coordinateFrameId: 12,
    state: "degraded",
    reason: "observation_gap",
    scale: 0.257,
    scaleSource: "projected_bar_length",
    confidence: 0.63,
    channelAgreement: "equipment_only",
    rawBarAxis: [0.12, 0.31, 0.88, 0.47],
    endpointOrderMapping: "screen_ordered_anatomy_unknown",
    rawBarAngleRadians: 0.2075,
    baselineCorrectedBarAngleRadians: -0.0349,
    endpointOneProgress: 0.42,
    endpointTwoProgress: 0.31,
    equipment: {
      alongAxisProgress: 0.37,
      crossAxisDisplacement: -0.08,
      confidence: 0.91,
      coverage: 0.84,
      uncertainty: 0.12,
      provenance: "equipment_measured",
    },
    pose: {
      alongAxisProgress: 0.33,
      crossAxisDisplacement: -0.04,
      confidence: 0.74,
      coverage: 0.68,
      uncertainty: 0.29,
      provenance: "pose_measured",
    },
  });

  assert.deepEqual(summary, {
    available: true,
    coordinateFrameId: 12,
    state: "degraded",
    reason: "observation_gap",
    scale: 0.257,
    scaleSource: "projected_bar_length",
    confidence: 0.63,
    fusionStatus: "equipment_only",
    rawBarAxis: [0.12, 0.31, 0.88, 0.47],
    coarseView: null,
    canonicalFeedMirrored: null,
    endpointOrderMapping: "screen_ordered_anatomy_unknown",
    anatomicalSideMapping: "unknown",
    rawAngleDegrees: 11.89,
    correctedAngleDegrees: -2,
    equipmentProgress: 0.37,
    equipmentCrossAxisDisplacement: -0.08,
    equipmentCoverage: 0.84,
    equipmentUncertainty: 0.12,
    poseCoverage: 0.68,
    poseUncertainty: 0.29,
    endpointOneProgress: 0.42,
    endpointTwoProgress: 0.31,
    anatomicalLeftEndpointProgress: null,
    anatomicalRightEndpointProgress: null,
    endpointResidual: -0.11,
  });

  const rendered = coordinateEvidenceHtml(summary);
  assert.match(rendered, /原始斜视角器械轴/u);
  assert.match(rendered, /Raw oblique equipment axis/u);
  assert.match(rendered, /11\.89°/u);
  assert.match(rendered, /规范局部轨迹/u);
  assert.match(rendered, /Canonical local-frame trajectory/u);
  assert.match(rendered, /屏幕有序端点 1/u);
  assert.match(rendered, /Screen-ordered endpoint 1/u);
  assert.match(rendered, /屏幕有序端点 2/u);
  assert.match(rendered, /P2 − P1/u);
  assert.match(rendered, /-0\.110/u);
  assert.match(rendered, /映射未知/u);
  assert.match(rendered, /Anatomical mapping unknown/u);
  assert.match(rendered, /器械覆盖率/u);
  assert.match(rendered, /Equipment coverage/u);
  assert.match(rendered, /84%/u);
  assert.match(rendered, /骨架不确定度/u);
  assert.match(rendered, /Pose uncertainty/u);
  assert.match(rendered, /29%/u);
  assert.doesNotMatch(rendered, /左端点|右端点|left endpoint|right endpoint/iu);
});

test("coordinate evidence localizes calibration state and abstention reason", () => {
  const rendered = coordinateEvidenceHtml(coordinateEvidenceSummary({
    coordinateFrameId: 8,
    state: "learning",
    reason: "insufficient_preparation",
    scale: null,
    scaleSource: null,
    confidence: 0.28,
    channelAgreement: "cannot_judge",
  }));

  assert.match(rendered, /学习中/u);
  assert.match(rendered, /Learning/u);
  assert.match(rendered, /准备阶段可靠观测不足/u);
  assert.match(rendered, /Insufficient reliable preparation observations/u);
  assert.match(rendered, /无法判断/u);
  assert.match(rendered, /Cannot judge/u);
});

test("coordinate evidence renders Rust-owned anatomical endpoint semantics", () => {
  const summary = coordinateEvidenceSummary({
    coordinateFrameId: 14,
    state: "frozen",
    reason: null,
    scale: 0.6,
    scaleSource: "projected_bar_length",
    confidence: 0.92,
    channelAgreement: "agreement",
    coarseView: "front_oblique_right",
    canonicalFeedMirrored: false,
    endpointOrderMapping: "screen_ordered_anatomy_unknown",
    anatomicalSideMapping: "endpoint_one_anatomical_right",
    endpointOneProgress: 0.31,
    endpointTwoProgress: 0.42,
    anatomicalLeftEndpointProgress: 0.42,
    anatomicalRightEndpointProgress: 0.31,
  });

  assert.equal(summary.endpointOrderMapping, "screen_ordered_anatomy_unknown");
  assert.equal(summary.anatomicalSideMapping, "endpoint_one_anatomical_right");
  assert.equal(summary.anatomicalLeftEndpointProgress, 0.42);
  assert.equal(summary.anatomicalRightEndpointProgress, 0.31);
  const rendered = coordinateEvidenceHtml(summary);
  assert.match(rendered, /解剖左侧端点/u);
  assert.match(rendered, /Anatomical left endpoint/u);
  assert.match(rendered, /解剖右侧端点/u);
  assert.match(rendered, /Anatomical right endpoint/u);
  assert.match(rendered, /front_oblique_right/u);
  assert.match(rendered, /canonical feed unmirrored/u);
  assert.doesNotMatch(rendered, /解剖侧映射未知|Anatomical mapping unknown/u);
});

test("missing coordinate evidence abstains visibly instead of fabricating values", () => {
  assert.deepEqual(coordinateEvidenceSummary(null), {
    available: false,
    reason: "no_coordinate_evidence",
  });
  const rendered = coordinateEvidenceHtml(coordinateEvidenceSummary(null));
  assert.match(rendered, /暂无局部坐标证据/u);
  assert.match(rendered, /Local-coordinate evidence unavailable/u);
  assert.doesNotMatch(rendered, /0\.000/u);
});

test("review projection accepts Rust snake-case local coordinate fields", () => {
  const layers = frameEvidenceLayers({
    timestampMs: 500,
    local_motion_coordinate: {
      coordinate_frame_id: 8,
      state: "learning",
      scale: 0.4,
      scale_source: "projected_bar_length",
      channel_agreement: "pose_only",
      confidence: 0.72,
      equipment: null,
      endpoint_order_mapping: "screen_ordered_anatomy_unknown",
      pose: {
        along_axis_progress: 0.25,
        cross_axis_displacement: -0.5,
        confidence: 0.7,
        coverage: 0.65,
        uncertainty: 0.3,
        provenance: "pose_measured",
      },
    },
  });

  assert.deepEqual(layers.normalizedPose.point, { x: 0.4, y: 0.55 });
  assert.equal(layers.fusionStatus.status, "pose_only");
  assert.equal(coordinateStatusSummary(layers.coordinate).coordinateFrameId, 8);
  assert.equal(layers.normalizedPose.coverage, 0.65);
  assert.equal(layers.normalizedPose.uncertainty, 0.3);
  assert.equal(coordinateEvidenceSummary(layers.coordinate).endpointOrderMapping, "screen_ordered_anatomy_unknown");
});

function localCoordinateFrame(timestampMs, poseProgress, equipmentProgress) {
  return {
    timestampMs,
    localMotionCoordinate: {
      schemaVersion: "maxpower-local-motion-coordinate/v1",
      coordinateFrameId: 7,
      state: "frozen",
      reason: null,
      primaryAxis: [0, 1],
      crossAxis: [1, 0],
      origin: [0.5, 0.5],
      scale: 0.2,
      scaleSource: "projected_bar_length",
      endpointOrderMapping: "screen_ordered_anatomy_unknown",
      pose: {
        alongAxisProgress: poseProgress,
        crossAxisDisplacement: 0,
        confidence: 0.8,
        coverage: 0.75,
        uncertainty: 0.2,
        provenance: "pose_measured",
      },
      equipment: {
        alongAxisProgress: equipmentProgress,
        crossAxisDisplacement: 0,
        confidence: 0.9,
        coverage: 0.9,
        uncertainty: 0.1,
        provenance: "equipment_measured",
      },
      channelAgreement: "agreement",
      confidence: 0.85,
    },
  };
}

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
