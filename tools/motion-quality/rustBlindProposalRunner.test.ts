import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
  actualProfileBundles,
  freezeTouchedBenchmarkPredictions,
  loadTouchedBenchmarkBenchProfiles,
  scoreFrozenTouchedBenchmarkRun,
  sealTouchedBenchmarkPlan,
  writeTouchedBenchmarkPlan,
} from "./rustBlindProposalRunner";
import { loadInputCatalog, rawObservationDerivativeId } from "./runnerInputs";

const TOUCHED_SOURCES = [
  "839e233f09acd809593551b125645bf7",
  "a44741cba03352f1e689fd51276dfec5",
  "a51c8a692c2a5a5b40cda482065cc6d5",
  "b8af1ab860d6bbb43cd3f2cadc71506c",
  "bc29e11c23f97a4b1ccaf321ba1e9db7",
  "e963bc2e0819f5ef528561cc1260b7ef",
] as const;

test("all six touched bench captures fail closed at source exclusion", async () => {
  const catalog = await loadInputCatalog("tools/motion-quality/data-governance-inputs.json");
  const loaded = await loadTouchedBenchmarkBenchProfiles(
    "tools/motion-quality/source-independent-bench-profiles.json",
    catalog.value,
  );
  assert.equal(loaded.value.length, 3);
  for (const entry of loaded.value) {
    assert.deepEqual(entry.fittedSourceIds, TOUCHED_SOURCES);
    assert.deepEqual(
      entry.fittedDerivativeSourceIds,
      TOUCHED_SOURCES.map(rawObservationDerivativeId),
    );
  }
  const bundles = actualProfileBundles({ schemaVersion: "profiles/v1", profiles: [] }, loaded.value);
  assert.ok(bundles.every((bundle) => (
    TOUCHED_SOURCES.every((sourceCaptureId) => bundle.fittedSourceIds.includes(sourceCaptureId))
  )));

  const directory = await mkdtemp(join(tmpdir(), "maxpower-touched-benchmark-plan-"));
  const plan = await writeTouchedBenchmarkPlan({
    datasetPath: "data/training/personal-golden-segmentation-v2.json",
    profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
    touchedBenchmarkBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
    governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
    outputPath: join(directory, "plan.json"),
    seed: "touched-benchmark-source-exclusion-test",
    runId: "touched-benchmark-source-exclusion-test",
  });
  const benchContexts = plan.sources.flatMap((source) => source.contexts.filter((context) => (
    context.actionId === "barbell_bench_press"
  )));
  assert.equal(plan.runKind, "touched_benchmark");
  assert.equal(benchContexts.length, 6);
  assert.ok(benchContexts.every((context) => (
    context.capability === "unsupported"
    && context.bundle === null
    && context.selection === "no_legal_bundle"
  )));
  assert.doesNotMatch(JSON.stringify(plan), /blind|generalization/iu);
});

test("touched report keeps freeze-before-truth and ignores historical peak", () => {
  const plan = sealTouchedBenchmarkPlan({
    schemaVersion: "maxpower-motion-quality-touched-benchmark-plan/v1",
    runId: "touched-report-test",
    runKind: "touched_benchmark",
    seed: "touched-report-test",
    claimBoundary: TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
    sources: [{
      sourceCaptureId: "source-a",
      videoRef: null,
      contexts: [{
        contextId: "context-a",
        actionId: "barbell_bench_press",
        capturePosition: "front",
        capability: "unsupported",
        bundle: null,
        selection: "no_legal_bundle",
        inputWindow: { fromTimestampMs: 0, untilTimestampMs: 1_000 },
      }],
    }],
  });
  const frozen = freezeTouchedBenchmarkPredictions(plan, [{
    runKind: "touched_benchmark",
    sourceCaptureId: "source-a",
    contextId: "context-a",
    processing: {
      chronologicalMonotonic: true,
      singlePass: true,
      sourceTimestampsMs: [0, 100, 200, 300],
    },
    packetHash: "a".repeat(64),
    proposalHash: "b".repeat(64),
    versions: {
      visualModel: "fixture",
      rustEngine: "fixture",
      packetSchema: "MOTN/1.8+QLT1",
      profileBundle: "none",
      rulePack: "none",
    },
    reps: [{
      repId: "1",
      startMs: 100,
      endMs: 300,
      turnaroundTimestampMs: 200,
      disposition: "confirmed",
    }],
    qualityConclusions: [],
  }]);
  const truth = (peakMs: number) => ({
    records: [{
      captureId: "context-a",
      sourceCaptureId: "source-a",
      exerciseId: "barbell_bench_press",
      capturePosition: "front",
      expectedCount: 1,
      segments: [{ startMs: 100, peakMs, endMs: 300 }],
    }],
  });
  const report = scoreFrozenTouchedBenchmarkRun(frozen, truth(150));
  const changedPeak = scoreFrozenTouchedBenchmarkRun(frozen, truth(299));
  assert.equal(frozen.state, "frozen_before_truth");
  assert.equal(report.runKind, "touched_benchmark");
  assert.equal(report.aggregate.precision, 1);
  assert.equal(report.aggregate.recall, 1);
  assert.deepEqual(report.aggregate, changedPeak.aggregate);
  assert.doesNotMatch(JSON.stringify(report), /blind|generalization/iu);
});
