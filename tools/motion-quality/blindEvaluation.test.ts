import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildFullDataProposalPlan,
  buildReleaseInventory,
  buildTruthFreePlan,
  freezePredictions,
  scoreFrozenBlindRun,
  validateSourceAwareLeakage,
  type PersonalGoldenDataset,
  type InjectedContextPrediction,
  type ProfileBundle,
  type TruthFreePlan,
} from "./blindEvaluation.js";

const PERSONAL_GOLDEN_PATH = "data/training/personal-golden-segmentation-v2.json";

function readPersonalGolden(): PersonalGoldenDataset {
  return JSON.parse(fs.readFileSync(PERSONAL_GOLDEN_PATH, "utf8")) as PersonalGoldenDataset;
}

function safeBundles(dataset: PersonalGoldenDataset): ProfileBundle[] {
  const contexts = new Map<string, { actionId: string; capturePosition: string }>();
  for (const record of dataset.records) {
    const key = `${record.exerciseId}\u0000${record.capturePosition}`;
    contexts.set(key, {
      actionId: record.exerciseId,
      capturePosition: record.capturePosition,
    });
  }
  return [...contexts.values()].map((context, index) => ({
    bundleId: `bundle-${index.toString().padStart(2, "0")}`,
    bundleHash: (index + 1).toString(16).padStart(64, "0"),
    actionId: context.actionId,
    capturePosition: context.capturePosition,
    capability: "phase_supported",
    fittedSourceIds: ["external-training-source"],
    fittedDerivativeSourceIds: [],
    versions: {
      profile: "test-profile/v1",
      rulePack: "test-rules/v1",
    },
  }));
}

test("truth-free plan deterministically shuffles all 50 sources and preserves 54 contexts", () => {
  const dataset = readPersonalGolden();
  const bundles = safeBundles(dataset);
  const first = buildTruthFreePlan(dataset, bundles, {
    seed: "ticket-02-fixed-seed",
    runId: "blind-run-001",
  });
  const repeated = buildTruthFreePlan(dataset, bundles, {
    seed: "ticket-02-fixed-seed",
    runId: "blind-run-001",
  });
  const differentSeed = buildTruthFreePlan(dataset, bundles, {
    seed: "ticket-02-other-seed",
    runId: "blind-run-002",
  });

  assert.equal(first.runKind, "blind_evaluation");
  assert.equal(first.sources.length, 50);
  assert.equal(first.sources.reduce((sum, source) => sum + source.contexts.length, 0), 54);
  assert.equal(new Set(first.sources.map((source) => source.sourceCaptureId)).size, 50);
  assert.deepEqual(first.sources, repeated.sources);
  assert.notDeepEqual(
    first.sources.map((source) => source.sourceCaptureId),
    differentSeed.sources.map((source) => source.sourceCaptureId),
  );

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(
    serialized,
    /expectedCount|segments|startMs|endMs|peakMs|turnaround|review/iu,
  );
});

function predictionsForPlan(plan: TruthFreePlan): InjectedContextPrediction[] {
  return plan.sources.flatMap((source) => source.contexts.map((context, contextIndex) => ({
    runKind: plan.runKind,
    sourceCaptureId: source.sourceCaptureId,
    contextId: context.contextId,
    processing: {
      chronologicalMonotonic: true as const,
      singlePass: true as const,
      sourceTimestampsMs: [contextIndex * 100, contextIndex * 100 + 100],
    },
    packetHash: "a".repeat(64),
    proposalHash: "b".repeat(64),
    versions: {
      visualModel: "yolox-rtmpose-halpe26/test",
      rustEngine: "motion-sdk/test",
      packetSchema: "MOTN/1.8",
      profileBundle: context.bundle?.profileVersion ?? "none",
      rulePack: context.bundle?.rulePackVersion ?? "none",
    },
    reps: [],
    qualityConclusions: [],
  })));
}

test("prediction freeze requires one chronological single-pass result per context", () => {
  const dataset = readPersonalGolden();
  const plan = buildTruthFreePlan(dataset, safeBundles(dataset), {
    seed: "ticket-02-freeze-seed",
    runId: "blind-run-freeze",
  });
  const predictions = predictionsForPlan(plan);
  const frozen = freezePredictions(plan, predictions);

  assert.equal(frozen.state, "frozen_before_truth");
  assert.equal(frozen.contexts.length, 54);
  assert.match(frozen.frozenDigest, /^[a-f0-9]{64}$/u);
  assert.equal(Object.isFrozen(frozen), true);
  assert.equal(Object.isFrozen(frozen.contexts), true);

  const invalid = predictions.map((prediction, index) => index === 0 ? {
    ...prediction,
    processing: {
      ...prediction.processing,
      sourceTimestampsMs: [100, 90],
    },
  } : prediction);
  assert.throws(
    () => freezePredictions(plan, invalid),
    /strictly increasing source timestamps/u,
  );
});

test("source and derivative leakage make a blind context unsupported without dropping it", () => {
  const dataset: PersonalGoldenDataset = {
    records: [{
      captureId: "context-a",
      sourceCaptureId: "source-a",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      source: { video: "capture.mp4" },
    }],
  };
  const leakingBundle: ProfileBundle = {
    bundleId: "leaking",
    bundleHash: "c".repeat(64),
    actionId: "barbell_bench_press",
    capturePosition: "front",
    capability: "quality_supported",
    fittedSourceIds: ["source-a"],
    fittedDerivativeSourceIds: ["source-a:halpe26"],
    versions: { profile: "profile/v1", rulePack: "rules/v1" },
  };
  assert.deepEqual(
    validateSourceAwareLeakage("source-a", ["source-a:halpe26"], leakingBundle),
    {
      valid: false,
      conflictingIds: ["source-a", "source-a:halpe26"],
    },
  );

  const blind = buildTruthFreePlan(dataset, [leakingBundle], {
    seed: "leakage",
    runId: "blind-leakage",
    derivativeSourceIdsBySource: { "source-a": ["source-a:halpe26"] },
  });
  assert.equal(blind.sources[0].contexts[0].capability, "unsupported");
  assert.equal(blind.sources[0].contexts[0].bundle, null);

  const full = buildFullDataProposalPlan(dataset, [leakingBundle], {
    seed: "leakage",
    runId: "full-data-proposal",
  });
  assert.equal(full.sources[0].contexts[0].capability, "quality_supported");
  assert.equal(full.runKind, "full_data_proposal");
});

test("blind scoring uses monotonic start/end matching and never peak or midpoint", () => {
  const dataset: PersonalGoldenDataset = {
    records: [{
      captureId: "context-score",
      sourceCaptureId: "source-score",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      expectedCount: 2,
      segments: [
        { startMs: 1_000, endMs: 3_000, peakMs: 1_050 },
        { startMs: 4_000, endMs: 6_000, peakMs: 5_950 },
      ],
    }],
  };
  const plan = buildTruthFreePlan(dataset, safeBundles(dataset), {
    seed: "score",
    runId: "blind-score",
  });
  const prediction = predictionsForPlan(plan)[0];
  const frozen = freezePredictions(plan, [{
    ...prediction,
    processing: { ...prediction.processing, sourceTimestampsMs: [0, 100, 200] },
    reps: [
      { repId: "1", startMs: 900, endMs: 3_100, turnaroundTimestampMs: 2_900, disposition: "confirmed" },
      { repId: "2", startMs: 3_900, endMs: 6_100, turnaroundTimestampMs: 4_050, disposition: "confirmed" },
      { repId: "3", startMs: 7_000, endMs: 8_000, turnaroundTimestampMs: 7_500, disposition: "confirmed" },
    ],
  }]);
  const report = scoreFrozenBlindRun(frozen, dataset);

  assert.equal(report.aggregate.truthCount, 2);
  assert.equal(report.aggregate.predictedCount, 3);
  assert.equal(report.aggregate.matchedCount, 2);
  assert.equal(report.aggregate.precision, 2 / 3);
  assert.equal(report.aggregate.recall, 1);
  assert.equal(report.aggregate.exactSetRate, 0);
  assert.equal(report.aggregate.meanAbsoluteStartErrorMs, 100);
  assert.equal(report.aggregate.meanAbsoluteEndErrorMs, 100);
  assert.ok((report.aggregate.meanIntervalIoU ?? 0) > 0.9);
  assert.equal(report.buckets.byAction[0].key, "barbell_bench_press");
  assert.equal(report.buckets.byView[0].key, "front");
  assert.equal(report.buckets.byCapability[0].key, "phase_supported");

  const changedPeaks: PersonalGoldenDataset = {
    records: dataset.records.map((record) => ({
      ...record,
      segments: record.segments?.map((segment) => ({ ...segment, peakMs: -999_999 })),
    })),
  };
  assert.deepEqual(
    scoreFrozenBlindRun(frozen, changedPeaks).aggregate,
    report.aggregate,
  );
  assert.throws(
    () => scoreFrozenBlindRun(frozen, {
      records: [...dataset.records, {
        captureId: "unexpected-truth-context",
        sourceCaptureId: "unexpected-source",
        exerciseId: "barbell_bench_press",
        capturePosition: "front",
        expectedCount: 0,
        segments: [],
      }],
    }),
    /complete truth inventory/u,
  );
});

test("release keeps blind and full-data identities separate and asserts the complete corpus", () => {
  const dataset = readPersonalGolden();
  const bundles = safeBundles(dataset);
  const blindPlan = buildTruthFreePlan(dataset, bundles, {
    seed: "release",
    runId: "blind-release",
  });
  const fullPlan = buildFullDataProposalPlan(dataset, bundles, {
    seed: "release",
    runId: "full-release",
  });
  const blindRun = freezePredictions(blindPlan, predictionsForPlan(blindPlan));
  const fullPredictions = predictionsForPlan(fullPlan);
  fullPredictions[0] = {
    ...fullPredictions[0],
    reps: [{
      repId: "full-1",
      startMs: 10,
      endMs: 90,
      turnaroundTimestampMs: 50,
      disposition: "confirmed",
    }],
    qualityConclusions: [
      { conclusionId: "quality-1", state: "proposed", reviewStatus: "correct" },
      { conclusionId: "quality-2", state: "abstained" },
    ],
  };
  const fullRun = freezePredictions(fullPlan, fullPredictions);
  const blindReport = scoreFrozenBlindRun(blindRun, dataset);
  const release = buildReleaseInventory({
    truth: dataset,
    blindRun,
    blindReport,
    fullDataProposalRun: fullRun,
  });

  assert.deepEqual(release.inventory, {
    uniqueSourceCount: 50,
    contextCount: 54,
    humanRangeCount: 464,
    expectedRepCount: 465,
  });
  assert.deepEqual(release.identities, {
    blindRunId: "blind-release",
    fullDataProposalRunId: "full-release",
    blindFrozenDigest: blindRun.frozenDigest,
    fullDataProposalFrozenDigest: fullRun.frozenDigest,
  });
  assert.deepEqual(release.turnaround, {
    eligibleRepCount: 1,
    proposalCount: 1,
    coverage: 1,
  });
  assert.equal(release.quality.proposalCount, 1);
  assert.equal(release.quality.abstentionCount, 1);
  assert.equal(release.quality.reviewStatusCounts.correct, 1);
  assert.equal(release.quality.reviewStatusCounts.unreviewed, 1);
  assert.doesNotMatch(JSON.stringify(release), /totalScore|standardness|turnaroundAccuracy/iu);

  assert.throws(
    () => buildReleaseInventory({
      truth: dataset,
      blindRun,
      blindReport,
      fullDataProposalRun: blindRun,
    }),
    /full_data_proposal/u,
  );
});
