import assert from "node:assert/strict";
import test from "node:test";

import {
  FrozenViewNormalizationEvaluationSession,
  adaptOptionalDecodedNormalizedFacts,
  createPostRevealTouchedRerun,
  evaluateSyntheticGeometryInvariance,
  revealFrozenEvaluationTruth,
  validateFrozenEvaluationPrediction,
  type FrozenEvaluationInferencePack,
} from "./frozenViewNormalizationEvaluation.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function inferencePack(
  runKind: FrozenEvaluationInferencePack["runKind"] = "touched_benchmark",
): FrozenEvaluationInferencePack {
  return {
    schemaVersion: "maxpower-view-normalization-inference-pack/v1",
    runId: "ticket-05-freeze",
    runKind,
    processingContract: {
      chronologicalSinglePass: true,
      rewindsAllowed: false,
      futureFramesAllowed: false,
    },
    preregistration: {
      profileVersion: "bench-normalized-candidate/v1",
      baselineProfileVersion: "bench-screen-y/v1",
      coordinateVersion: "local-motion-coordinate/v1",
      reportCodeVersion: "view-normalization-evaluation/v1",
      endpointToleranceMs: 250,
      matchingToleranceMs: 1_500,
    },
    sourceLineage: {
      targetSourceIds: ["capture-a"],
      profileFitSourceIds: ["capture-a"],
      thresholdSelectionSourceIds: ["capture-a"],
      manuallyInspectedSourceIds: ["capture-a"],
    },
    contexts: [{
      contextId: "capture-a::front-left-oblique",
      sourceCaptureId: "capture-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_left",
      conditions: ["mirror", "bar_occlusion"],
    }],
  };
}

test("inference pack rejects truth leakage and source-derived untouched acceptance", () => {
  assert.throws(
    () => new FrozenViewNormalizationEvaluationSession({
      ...inferencePack(),
      expectedCount: 1,
    } as unknown as FrozenEvaluationInferencePack),
    /formal truth.*expectedCount/u,
  );
  assert.throws(
    () => new FrozenViewNormalizationEvaluationSession(
      inferencePack("untouched_model_acceptance"),
    ),
    /untouched.*source lineage/u,
  );
  const derivativeLeak = inferencePack("untouched_model_acceptance");
  assert.throws(() => new FrozenViewNormalizationEvaluationSession({
    ...derivativeLeak,
    sourceLineage: {
      ...derivativeLeak.sourceLineage,
      profileFitSourceIds: ["fit-source"],
      thresholdSelectionSourceIds: ["tune-source"],
      manuallyInspectedSourceIds: [],
      targetDerivativeSourceIds: ["capture-a:halpe26"],
      profileFitDerivativeSourceIds: ["capture-a:halpe26"],
    },
  }), /untouched.*source lineage.*halpe26/u);

  const clean = inferencePack("untouched_model_acceptance");
  const session = new FrozenViewNormalizationEvaluationSession({
    ...clean,
    sourceLineage: {
      ...clean.sourceLineage,
      profileFitSourceIds: ["other-fit-source"],
      thresholdSelectionSourceIds: ["other-tuning-source"],
      manuallyInspectedSourceIds: [],
    },
  });
  assert.ok(session);
  assert.throws(() => new FrozenViewNormalizationEvaluationSession({
    ...clean,
    sourceLineage: {
      ...clean.sourceLineage,
      targetSourceIds: ["different-target"],
      profileFitSourceIds: ["fit-source"],
      thresholdSelectionSourceIds: ["tune-source"],
      manuallyInspectedSourceIds: [],
    },
  }), /target source lineage.*contexts/u);
});

test("truth reveal rejects any post-freeze preregistration change", () => {
  const pack = inferencePack();
  const session = new FrozenViewNormalizationEvaluationSession(pack);
  session.submit("capture-a::front-left-oblique", {
    frameId: 1,
    sourceTimestampMs: 0,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  const frozen = session.freeze();
  const truth = {
    schemaVersion: "maxpower-view-normalization-revealed-truth/v1" as const,
    contexts: [{
      contextId: "capture-a::front-left-oblique",
      sourceCaptureId: "capture-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_left" as const,
      reps: [],
    }],
  };

  assert.throws(() => revealFrozenEvaluationTruth(frozen, {
    ...pack,
    preregistration: { ...pack.preregistration, endpointToleranceMs: 251 },
  }, truth), /inference pack changed after prediction freeze/u);
  assert.throws(() => revealFrozenEvaluationTruth(frozen, {
    ...pack,
    preregistration: { ...pack.preregistration, reportCodeVersion: "changed-after-truth/v2" },
  }, truth), /inference pack changed after prediction freeze/u);
});

test("post-reveal tuning can only start a new touched benchmark run", () => {
  const prior = inferencePack("untouched_model_acceptance");
  const cleanPrior: FrozenEvaluationInferencePack = {
    ...prior,
    sourceLineage: {
      targetSourceIds: ["capture-a"],
      profileFitSourceIds: ["fit-source"],
      thresholdSelectionSourceIds: ["tune-source"],
      manuallyInspectedSourceIds: [],
    },
  };
  const rerun = createPostRevealTouchedRerun(cleanPrior, {
    runId: "ticket-05-post-reveal-rerun",
    preregistration: {
      ...cleanPrior.preregistration,
      endpointToleranceMs: 300,
      profileVersion: "bench-normalized-candidate/v2",
    },
  });

  assert.equal(rerun.runKind, "touched_benchmark");
  assert.equal(rerun.runId, "ticket-05-post-reveal-rerun");
  assert.ok(rerun.sourceLineage.thresholdSelectionSourceIds.includes("capture-a"));
  assert.ok(rerun.sourceLineage.manuallyInspectedSourceIds.includes("capture-a"));
  assert.throws(() => createPostRevealTouchedRerun(cleanPrior, {
    runId: cleanPrior.runId,
    preregistration: cleanPrior.preregistration,
  }), /new run id/u);
});

test("optional normalized facts adapter preserves missing Ticket 04 evidence as unavailable", () => {
  assert.deepEqual(adaptOptionalDecodedNormalizedFacts(undefined), {
    status: "unavailable",
    reason: "normalized_fields_not_present",
  });
  assert.deepEqual(adaptOptionalDecodedNormalizedFacts({
    coordinateVersion: "local-motion-coordinate/v1",
    frameState: "frozen",
    alongAxisProgress: 0.75,
    crossAxisDisplacement: -0.1,
    endpointResidual: 0.03,
    confidence: 0.9,
  }), {
    status: "available",
    coordinateVersion: "local-motion-coordinate/v1",
    frameState: "frozen",
    alongAxisProgress: 0.75,
    crossAxisDisplacement: -0.1,
    endpointResidual: 0.03,
    confidence: 0.9,
  });
  assert.deepEqual(adaptOptionalDecodedNormalizedFacts({
    coordinateVersion: "local-motion-coordinate/v1",
    alongAxisProgress: Number.NaN,
  }), {
    status: "unavailable",
    reason: "normalized_fields_invalid",
  });
});

test("synthetic geometry suite reports normalized invariance separately from raw screen-y", () => {
  const report = evaluateSyntheticGeometryInvariance({
    sourceId: "synthetic-bench",
    original: {
      phaseSequence: ["ready", "effort", "peak", "return"],
      repEndpointsMs: [{ startMs: 100, turnaroundMs: 500, endMs: 900 }],
      rawScreenY: [0.7, 0.55, 0.35, 0.7],
      normalizedAlongAxis: [0, 0.5, 1, 0],
      normalizedCrossAxis: [0, 0.02, 0.01, 0],
    },
    transforms: [{
      transformId: "rotate-30-translate-scale",
      transform: { rotationDegrees: 30, translateX: 0.2, translateY: -0.1, uniformScale: 1.5 },
      output: {
        phaseSequence: ["ready", "effort", "peak", "return"],
        repEndpointsMs: [{ startMs: 100, turnaroundMs: 500, endMs: 900 }],
        rawScreenY: [0.809, 0.614, 0.354, 0.809],
        normalizedAlongAxis: [0, 0.5, 1, 0],
        normalizedCrossAxis: [0, 0.02, 0.01, 0],
      },
    }],
  });

  assert.equal(report.transforms[0]?.discreteRepPhaseInvariant, true);
  assert.ok((report.transforms[0]?.rawScreenYMaximumAbsoluteError ?? 0) > 0.1);
  assert.equal(report.transforms[0]?.normalizedAlongAxisMaximumAbsoluteError, 0);
  assert.equal(report.transforms[0]?.normalizedCrossAxisMaximumAbsoluteError, 0);
  assert.equal(report.normalizedFactsStatus, "available");

  const unavailable = evaluateSyntheticGeometryInvariance({
    sourceId: "legacy-packet",
    original: {
      phaseSequence: ["ready"],
      repEndpointsMs: [],
      rawScreenY: [0.5],
    },
    transforms: [{
      transformId: "translated",
      transform: { rotationDegrees: 0, translateX: 0, translateY: 0.2, uniformScale: 1 },
      output: { phaseSequence: ["ready"], repEndpointsMs: [], rawScreenY: [0.7] },
    }],
  });
  assert.equal(unavailable.normalizedFactsStatus, "unavailable");
  assert.equal(unavailable.transforms[0]?.normalizedAlongAxisMaximumAbsoluteError, null);
});

test("client observations freeze once before truth reveal", () => {
  const session = new FrozenViewNormalizationEvaluationSession(inferencePack());
  session.submit("capture-a::front-left-oblique", {
    frameId: 1,
    sourceTimestampMs: 0,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  session.submit("capture-a::front-left-oblique", {
    frameId: 2,
    sourceTimestampMs: 100,
    inputObservationHash: HASH_B,
    candidate: { packetHash: HASH_B, phase: "effort", sealedReps: [] },
    baseline: { packetHash: HASH_A, phase: "effort", sealedReps: [] },
  });

  const frozen = session.freeze();

  assert.equal(frozen.state, "frozen_before_truth");
  assert.equal(frozen.runKind, "touched_benchmark");
  assert.match(frozen.inputHash, /^[a-f0-9]{64}$/u);
  assert.match(frozen.predictionHash, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.contexts[0]?.frames), true);
  assert.throws(() => session.submit("capture-a::front-left-oblique", {
    frameId: 3,
    sourceTimestampMs: 200,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "return", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "return", sealedReps: [] },
  }), /already frozen/u);
});

test("client stream cannot rewind or resubmit a timestamp", () => {
  const session = new FrozenViewNormalizationEvaluationSession(inferencePack());
  session.submit("capture-a::front-left-oblique", {
    frameId: 2,
    sourceTimestampMs: 100,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  assert.throws(() => session.submit("capture-a::front-left-oblique", {
    frameId: 3,
    sourceTimestampMs: 100,
    inputObservationHash: HASH_B,
    candidate: { packetHash: HASH_B, phase: "effort", sealedReps: [] },
    baseline: { packetHash: HASH_A, phase: "effort", sealedReps: [] },
  }), /strictly chronological and single pass/u);
});

test("client stream rejects future endpoints and rewriting a sealed rep", () => {
  const future = new FrozenViewNormalizationEvaluationSession(inferencePack());
  assert.throws(() => future.submit("capture-a::front-left-oblique", {
    frameId: 1,
    sourceTimestampMs: 100,
    inputObservationHash: HASH_A,
    candidate: {
      packetHash: HASH_A,
      phase: "return",
      sealedReps: [{
        repId: "future",
        startMs: 0,
        turnaroundMs: 50,
        endMs: 200,
        disposition: "confirmed",
      }],
    },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  }), /future endpoint/u);

  const rewritten = new FrozenViewNormalizationEvaluationSession(inferencePack());
  rewritten.submit("capture-a::front-left-oblique", {
    frameId: 1,
    sourceTimestampMs: 300,
    inputObservationHash: HASH_A,
    candidate: {
      packetHash: HASH_A,
      phase: "return",
      sealedReps: [{
        repId: "sealed-1",
        startMs: 0,
        turnaroundMs: 100,
        endMs: 200,
        disposition: "confirmed",
      }],
    },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  assert.throws(() => rewritten.submit("capture-a::front-left-oblique", {
    frameId: 2,
    sourceTimestampMs: 400,
    inputObservationHash: HASH_B,
    candidate: {
      packetHash: HASH_B,
      phase: "ready",
      sealedReps: [{
        repId: "sealed-1",
        startMs: 0,
        turnaroundMs: 150,
        endMs: 200,
        disposition: "confirmed",
      }],
    },
    baseline: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
  }), /rewrite sealed candidate rep/u);
});

test("persisted frozen prediction validates hashes and chronological client semantics", () => {
  const pack = inferencePack();
  const session = new FrozenViewNormalizationEvaluationSession(pack);
  session.submit("capture-a::front-left-oblique", {
    frameId: 1,
    sourceTimestampMs: 0,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  const frozen = session.freeze();
  const persisted = JSON.parse(JSON.stringify(frozen)) as unknown;
  assert.deepEqual(validateFrozenEvaluationPrediction(persisted, pack), frozen);

  const tampered = JSON.parse(JSON.stringify(frozen)) as {
    contexts: Array<{ frames: Array<{ candidate: { phase: string } }> }>;
  };
  tampered.contexts[0]!.frames[0]!.candidate.phase = "return";
  assert.throws(
    () => validateFrozenEvaluationPrediction(tampered, pack),
    /prediction hash mismatch/u,
  );
});

test("truth reveal scores a copy and cannot mutate frozen prediction bytes", () => {
  const pack = inferencePack();
  const session = new FrozenViewNormalizationEvaluationSession(pack);
  session.submit("capture-a::front-left-oblique", {
    frameId: 1,
    sourceTimestampMs: 0,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  session.submit("capture-a::front-left-oblique", {
    frameId: 2,
    sourceTimestampMs: 1_000,
    inputObservationHash: HASH_B,
    candidate: {
      packetHash: HASH_B,
      phase: "return",
      sealedReps: [{
        repId: "candidate-1",
        startMs: 100,
        turnaroundMs: 500,
        endMs: 900,
        disposition: "confirmed",
      }],
    },
    baseline: {
      packetHash: HASH_A,
      phase: "return",
      sealedReps: [{
        repId: "baseline-1",
        startMs: 90,
        turnaroundMs: 450,
        endMs: 910,
        disposition: "confirmed",
      }],
    },
  });
  const frozen = session.freeze();
  const before = JSON.stringify(frozen);

  const report = revealFrozenEvaluationTruth(frozen, pack, {
    schemaVersion: "maxpower-view-normalization-revealed-truth/v1",
    contexts: [{
      contextId: "capture-a::front-left-oblique",
      sourceCaptureId: "capture-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_left",
      reps: [{ repId: "truth-1", startMs: 100, turnaroundMs: 500, endMs: 900 }],
    }],
  });

  assert.equal(JSON.stringify(frozen), before);
  assert.equal(report.predictionHash, frozen.predictionHash);
  assert.equal(report.runKind, "touched_benchmark");
  assert.deepEqual(report.aggregate.candidate, {
    truthCount: 1,
    predictedCount: 1,
    matchedCount: 1,
    rejectedCount: 0,
    abstentionCount: 0,
    precision: 1,
    recall: 1,
    exactSetRate: 1,
    startMeanAbsoluteErrorMs: 0,
    turnaroundMeanAbsoluteErrorMs: 0,
    endMeanAbsoluteErrorMs: 0,
    fullEndpointAlignmentRate: 1,
    coverage: 1,
  });
  assert.equal(report.promotion.eligible, false);
  assert.deepEqual(report.promotion.reasons, ["touched_benchmark_is_never_acceptance_eligible"]);
});

test("synchronized cross-view report compares oblique frozen output with withheld front truth", () => {
  const base = inferencePack("synchronized_cross_view_validation");
  const pack: FrozenEvaluationInferencePack = {
    ...base,
    sourceLineage: {
      targetSourceIds: ["oblique-a"],
      profileFitSourceIds: ["fit-source"],
      thresholdSelectionSourceIds: ["tune-source"],
      manuallyInspectedSourceIds: [],
    },
    contexts: [{
      contextId: "oblique-a::left",
      sourceCaptureId: "oblique-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_left",
      conditions: ["mirror", "wrist_forearm_occlusion", "competing_reflection_person"],
    }],
  };
  const session = new FrozenViewNormalizationEvaluationSession(pack);
  session.submit("oblique-a::left", {
    frameId: 1,
    sourceTimestampMs: 0,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  session.submit("oblique-a::left", {
    frameId: 2,
    sourceTimestampMs: 1_000,
    inputObservationHash: HASH_B,
    candidate: {
      packetHash: HASH_B,
      phase: "return",
      sealedReps: [{
        repId: "candidate-sync-1",
        startMs: 100,
        turnaroundMs: 520,
        endMs: 900,
        disposition: "confirmed",
        rawScreenYRom: 0.31,
        normalizedFacts: {
          coordinateVersion: "local-motion-coordinate/v1",
          normalizedRom: 0.81,
          crossPath: 0.04,
          endpointResidual: 0.02,
          confidence: 0.88,
        },
      }],
    },
    baseline: {
      packetHash: HASH_A,
      phase: "return",
      sealedReps: [{
        repId: "baseline-sync-1",
        startMs: 100,
        turnaroundMs: 550,
        endMs: 900,
        disposition: "confirmed",
        rawScreenYRom: 0.31,
      }],
    },
  });
  const frozen = session.freeze();
  assert.doesNotMatch(JSON.stringify(frozen), /frontReference|frontNormalizedRom/iu);

  const report = revealFrozenEvaluationTruth(frozen, pack, {
    schemaVersion: "maxpower-view-normalization-revealed-truth/v1",
    contexts: [{
      contextId: "oblique-a::left",
      sourceCaptureId: "oblique-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_left",
      reps: [{
        repId: "physical-rep-1",
        startMs: 100,
        turnaroundMs: 500,
        endMs: 900,
        synchronizedFrontReference: {
          turnaroundMs: 500,
          rawScreenYRom: 0.45,
          normalizedRom: 0.8,
          crossPath: 0.05,
          endpointResidual: 0.01,
        },
      }],
    }],
  });

  assert.equal(report.crossView.status, "available");
  if (report.crossView.status !== "available") throw new Error("expected cross-view metrics");
  assert.equal(report.crossView.pairedRepCount, 1);
  assert.equal(report.crossView.turnaroundMeanAbsoluteErrorMs, 20);
  assert.ok(Math.abs((report.crossView.rawScreenYRomMeanAbsoluteDisagreement ?? 0) - 0.14) < 1e-12);
  assert.ok(Math.abs((report.crossView.normalizedRomMeanAbsoluteDisagreement ?? 0) - 0.01) < 1e-12);
  assert.ok(Math.abs((report.crossView.normalizedCrossPathMeanAbsoluteDisagreement ?? 0) - 0.01) < 1e-12);
  assert.ok(Math.abs((report.crossView.normalizedEndpointResidualMeanAbsoluteDisagreement ?? 0) - 0.01) < 1e-12);
  assert.equal(report.crossView.normalizedCoverage, 1);
  assert.equal(report.crossView.abstentionCount, 0);
  assert.equal(report.promotion.eligible, false);
  assert.ok(report.buckets.some((bucket) => bucket.key === "view:front_oblique_left"));
  assert.ok(report.buckets.some((bucket) => bucket.key === "condition:mirror"));
  assert.ok(report.buckets.some((bucket) => bucket.key === "condition:wrist_forearm_occlusion"));
  assert.ok(report.buckets.some((bucket) => bucket.key === "condition:competing_reflection_person"));
  assert.ok(report.buckets.some((bucket) => bucket.key === "confidence:high"));
  assert.equal(report.buckets[0]?.baseline.truthCount, 1);
  assert.equal(report.buckets[0]?.baseline.predictedCount, 1);
  assert.equal(report.worstBucket?.key, "condition:competing_reflection_person");
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.buckets), true);
});

test("untouched promotion eligibility requires frozen 95 percent gates and normalized improvement", () => {
  const base = inferencePack("untouched_model_acceptance");
  const pack: FrozenEvaluationInferencePack = {
    ...base,
    sourceLineage: {
      targetSourceIds: ["untouched-a"],
      profileFitSourceIds: ["fit-other"],
      thresholdSelectionSourceIds: ["tune-other"],
      manuallyInspectedSourceIds: [],
    },
    contexts: [{
      contextId: "untouched-a::right",
      sourceCaptureId: "untouched-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_right",
      conditions: [],
    }],
  };
  const session = new FrozenViewNormalizationEvaluationSession(pack);
  session.submit("untouched-a::right", {
    frameId: 1,
    sourceTimestampMs: 0,
    inputObservationHash: HASH_A,
    candidate: { packetHash: HASH_A, phase: "ready", sealedReps: [] },
    baseline: { packetHash: HASH_B, phase: "ready", sealedReps: [] },
  });
  session.submit("untouched-a::right", {
    frameId: 2,
    sourceTimestampMs: 1_000,
    inputObservationHash: HASH_B,
    candidate: {
      packetHash: HASH_B,
      phase: "return",
      sealedReps: [{
        repId: "candidate-1",
        startMs: 100,
        turnaroundMs: 500,
        endMs: 900,
        disposition: "confirmed",
        rawScreenYRom: 0.3,
        normalizedFacts: {
          coordinateVersion: "local-motion-coordinate/v1",
          normalizedRom: 0.8,
          crossPath: 0.01,
          endpointResidual: 0.01,
          confidence: 0.9,
        },
      }],
    },
    baseline: {
      packetHash: HASH_A,
      phase: "return",
      sealedReps: [{
        repId: "baseline-1",
        startMs: 100,
        turnaroundMs: 500,
        endMs: 900,
        disposition: "confirmed",
        rawScreenYRom: 0.3,
      }],
    },
  });
  const report = revealFrozenEvaluationTruth(session.freeze(), pack, {
    schemaVersion: "maxpower-view-normalization-revealed-truth/v1",
    contexts: [{
      contextId: "untouched-a::right",
      sourceCaptureId: "untouched-a",
      actionId: "barbell_bench_press",
      view: "front_oblique_right",
      reps: [{
        repId: "truth-1",
        startMs: 100,
        turnaroundMs: 500,
        endMs: 900,
        synchronizedFrontReference: {
          turnaroundMs: 500,
          rawScreenYRom: 0.45,
          normalizedRom: 0.8,
          crossPath: 0.01,
          endpointResidual: 0.01,
        },
      }],
    }],
  });

  assert.equal(report.promotion.eligible, true);
  assert.deepEqual(report.promotion.reasons, []);
  assert.equal(report.promotion.gates.precisionAtLeast95, true);
  assert.equal(report.promotion.gates.recallAtLeast95, true);
  assert.equal(report.promotion.gates.fullEndpointAlignmentAtLeast95, true);
  assert.equal(report.promotion.gates.candidateNonInferiorInEveryBucket, true);
  assert.equal(report.promotion.gates.normalizedCrossViewImprovesOnRawScreenY, true);
});
