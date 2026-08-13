import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import test from "node:test";

import {
  buildFullDataProposalPlan,
  buildTruthFreePlan,
  freezePredictions,
  scoreFrozenBlindRun,
  type FrozenPredictionRun,
  type InjectedContextPrediction,
  type PersonalGoldenDataset,
  type ProfileBundle,
  type QualityReviewStatus,
  type TruthFreePlan,
} from "./blindEvaluation.js";
import {
  QUALITY_DIMENSIONS,
  assembleFullPersonalReviewRelease,
  runFullPersonalReviewRelease,
  type FullDataContextReviewProposal,
  type FullPersonalReviewReleaseInput,
} from "./fullPersonalReviewRelease.js";

const qualityReviewDocument = require(
  path.resolve("tools/recognition-review/public/qualityReviewDocument.js"),
) as Readonly<{
  createReviewDocument(
    input: Readonly<{ proposal: unknown; reviewer: unknown }>,
  ): unknown;
}>;

const SHA_256 = /^[a-f0-9]{64}$/u;

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function personalCorpus(): PersonalGoldenDataset {
  const records: PersonalGoldenDataset["records"][number][] = [];
  let contextIndex = 0;
  for (let sourceIndex = 0; sourceIndex < 50; sourceIndex += 1) {
    const contextsForSource = sourceIndex < 4 ? 2 : 1;
    for (let localIndex = 0; localIndex < contextsForSource; localIndex += 1) {
      const rangeCount = contextIndex < 32 ? 9 : 8;
      const context = contextIdentity(contextIndex);
      records.push({
        captureId: `context-${contextIndex.toString().padStart(2, "0")}`,
        sourceCaptureId: `source-${sourceIndex.toString().padStart(2, "0")}`,
        exerciseId: context.actionId,
        capturePosition: context.view,
        expectedCount: rangeCount + (contextIndex === 0 ? 1 : 0),
        segments: Array.from({ length: rangeCount }, (_, repIndex) => ({
          startMs: repIndex * 2_000 + 100,
          peakMs: repIndex * 2_000 + 900,
          endMs: repIndex * 2_000 + 1_600,
        })),
        source: {
          video: `private/source-${sourceIndex.toString().padStart(2, "0")}.mp4`,
        },
      });
      contextIndex += 1;
    }
  }
  return { schemaVersion: "fixture/v1", records };
}

function contextIdentity(
  index: number,
): Readonly<{ actionId: string; view: string }> {
  return [
    { actionId: "barbell_bench_press", view: "front" },
    { actionId: "lateral_raise", view: "front" },
    { actionId: "pull_up", view: "rearLeft45" },
    { actionId: "rear_delt_fly", view: "front" },
  ][index % 4];
}

function bundles(): ProfileBundle[] {
  return [
    ["barbell_bench_press", "front", "quality_supported"],
    ["lateral_raise", "front", "phase_supported"],
    ["pull_up", "rearLeft45", "observation_only"],
  ].map(([actionId, capturePosition, capability], index) => ({
    bundleId: `bundle-${index}`,
    bundleHash: digest(`bundle-${index}`),
    actionId,
    capturePosition,
    capability: capability as ProfileBundle["capability"],
    fittedSourceIds: ["external-source"],
    versions: { profile: `profile/${index}`, rulePack: `rules/${index}` },
  }));
}

function predictionsFor(
  plan: TruthFreePlan,
  truth: PersonalGoldenDataset,
  withQualityReviews = false,
): InjectedContextPrediction[] {
  const truthByContext = new Map(
    truth.records.map((record) => [record.captureId, record]),
  );
  return plan.sources.flatMap((source) =>
    source.contexts.map((context) => {
      const record = truthByContext.get(context.contextId);
      assert.ok(record);
      const reps = (record.segments ?? []).map((segment, repIndex) => ({
        repId: `rep-${repIndex + 1}`,
        startMs: segment.startMs,
        turnaroundTimestampMs: segment.startMs + 800,
        endMs: segment.endMs,
        disposition: "confirmed" as const,
      }));
      return {
        runKind: plan.runKind,
        sourceCaptureId: source.sourceCaptureId,
        contextId: context.contextId,
        processing: {
          chronologicalMonotonic: true as const,
          singlePass: true as const,
          sourceTimestampsMs: [0, 100, 200],
        },
        packetHash: digest(`${plan.runId}:${context.contextId}:packet`),
        proposalHash: digest(`${plan.runId}:${context.contextId}:proposal`),
        versions: {
          visualModel: "yolox-nano+rtmpose-m-halpe26/client-v1",
          rustEngine: "motion-sdk/test-v1",
          packetSchema: "MOTN/1.8+QLT1",
          profileBundle: context.bundle?.profileVersion ?? "none",
          rulePack: context.bundle?.rulePackVersion ?? "none",
        },
        reps,
        qualityConclusions: reps.flatMap((rep) =>
          QUALITY_DIMENSIONS.map((dimension) => {
            const abstained = dimension === "standard_variant_compatibility";
            return {
              conclusionId: `${rep.repId}:${dimension}`,
              dimension,
              state: abstained ? ("abstained" as const) : ("proposed" as const),
              value: abstained ? null : "observed",
              confidence: abstained ? null : 0.8,
              summary: abstained ? "cannot judge" : `${dimension} observed`,
              reason: abstained ? "no_exact_reviewed_reference" : null,
              evidence: abstained ? [] : [`rust:${rep.repId}:${dimension}`],
              ...(withQualityReviews
                ? {
                    reviewStatus:
                      (
                        {
                          task_completion: "correct",
                          range_of_motion: "incorrect",
                        } as Partial<
                          Record<
                            (typeof QUALITY_DIMENSIONS)[number],
                            QualityReviewStatus
                          >
                        >
                      )[dimension] ?? "unreviewed",
                  }
                : {}),
            };
          }),
        ),
      };
    }),
  );
}

function reviewContexts(
  run: FrozenPredictionRun,
): FullDataContextReviewProposal[] {
  return run.contexts.map((context) => ({
    sourceCaptureId: context.sourceCaptureId,
    contextId: context.contextId,
    reps: context.reps.map((rep) => ({
      repId: rep.repId,
      endpoints: {
        start_anchor: {
          state: "proposed",
          occurredAtMs: rep.startMs,
          confirmedAtMs: rep.startMs,
          reason: null,
        },
        primary_turnaround: {
          state: "proposed",
          occurredAtMs: rep.turnaroundTimestampMs ?? null,
          confirmedAtMs:
            rep.turnaroundTimestampMs == null
              ? null
              : rep.turnaroundTimestampMs + 100,
          reason: null,
        },
        end_return: {
          state: "proposed",
          occurredAtMs: rep.endMs,
          confirmedAtMs: rep.endMs,
          reason: null,
        },
      },
      conclusions: QUALITY_DIMENSIONS.map((dimension) => {
        const frozen = context.qualityConclusions.find(
          (conclusion) =>
            conclusion.conclusionId === `${rep.repId}:${dimension}`,
        ) as unknown as
          | FullDataContextReviewProposal["reps"][number]["conclusions"][number]
          | undefined;
        assert.ok(frozen);
        return {
          ...frozen,
          evidence: [...frozen.evidence],
          reviewStatus: frozen.reviewStatus ?? "unreviewed",
        };
      }),
    })),
  }));
}

function fixtureInput(): FullPersonalReviewReleaseInput {
  const truth = personalCorpus();
  const profileBundles = bundles();
  const blindPlan = buildTruthFreePlan(truth, profileBundles, {
    seed: "full-release-blind-seed",
    runId: "blind-run-001",
  });
  const fullPlan = buildFullDataProposalPlan(truth, profileBundles, {
    seed: "full-release-proposal-seed",
    runId: "full-data-proposal-001",
  });
  const blindRun = freezePredictions(
    blindPlan,
    predictionsFor(blindPlan, truth),
  );
  const fullDataProposalRun = freezePredictions(
    fullPlan,
    predictionsFor(fullPlan, truth, true),
  );
  return {
    releaseId: "personal-review-release-001",
    assembledAt: "2026-08-13T23:45:00.000Z",
    truth,
    blind: {
      run: blindRun,
      frozenAt: "2026-08-13T23:00:00.000Z",
      report: scoreFrozenBlindRun(blindRun, truth),
    },
    fullDataProposal: {
      run: fullDataProposalRun,
      frozenAt: "2026-08-13T23:30:00.000Z",
      reviewContexts: reviewContexts(fullDataProposalRun),
    },
    sourcePins: Array.from({ length: 50 }, (_, index) => ({
      sourceCaptureId: `source-${index.toString().padStart(2, "0")}`,
      assetId: "personal-raw-capture-archive",
      admission: "immutable_source",
      authority: "user_source",
      groupKey: "sourceCaptureId",
      sourceSha256: digest(`source-${index}`),
    })),
    governance: {
      catalogId: "maxpower-motion-training-data-v1",
      catalogSha256: digest("catalog"),
      humanRanges: {
        assetId: "personal-human-rep-ranges-v2",
        admission: "label_allowed",
        authority: "user_reviewed",
        sourceSha256:
          "63c33e44365d8359df32793e16f3a3c8dd4c53d32a970933ed57441d4c150727",
        groupKey: "sourceCaptureId",
        selectedFields: [
          "exerciseId",
          "capturePosition",
          "expectedCount",
          "segments[].startMs",
          "segments[].endMs",
        ],
      },
      historicalPeaks: {
        assetId: "personal-legacy-peak-field-v2",
        admission: "quarantined",
        authority: "mixed_unknown",
        sourceSha256:
          "63c33e44365d8359df32793e16f3a3c8dd4c53d32a970933ed57441d4c150727",
        groupKey: "sourceCaptureId",
        selectedField: "segments[].peakMs",
      },
      modelObservations: {
        assetId: "personal-native-rtmpose-halpe26-observations",
        admission: "feature_only",
        authority: "model_generated",
        groupKey: "sourceCaptureId",
      },
      frozenEvaluation: {
        assetId: "client-single-pass-predictions-and-agent-output",
        admission: "evaluation_only",
        authority: "frozen_prediction_or_report",
        groupKey: "sourceCaptureId",
      },
    },
    versions: {
      assembler: "full-personal-review-release/v1",
      actionBundle: "personal-action-contracts/v1",
      qualitySchema: "maxpower.motion-quality-proposal/v1",
      reviewSchema: "maxpower-motion-quality-review-export/v1",
    },
  };
}

test("assembles the complete frozen personal corpus into the existing review proposal seam", () => {
  const release = assembleFullPersonalReviewRelease(fixtureInput());

  assert.deepEqual(release.inventory, {
    uniqueVideoCount: 50,
    exactContextCount: 54,
    humanIntervalCount: 464,
    expectedRepCount: 465,
    expectedMinusHumanIntervals: 1,
    mismatchPolicy: "known_mismatch_preserved",
  });
  assert.equal(release.runs.blind.runKind, "blind_evaluation");
  assert.equal(release.runs.fullDataProposal.runKind, "full_data_proposal");
  assert.equal(release.contexts.length, 54);
  assert.deepEqual(
    new Set(release.contexts.map((context) => context.capability)),
    new Set([
      "quality_supported",
      "phase_supported",
      "observation_only",
      "unsupported",
    ]),
  );
  assert.equal(release.reviewProposal.reps.length, 464);
  assert.match(release.reviewProposal.proposalHash, /^sha256:[a-f0-9]{64}$/u);
  assert.doesNotThrow(() =>
    qualityReviewDocument.createReviewDocument({
      proposal: release.reviewProposal,
      reviewer: { reviewerId: "owner", reviewerRole: "owner_observation" },
    }),
  );
  assert.match(release.releaseHash, SHA_256);
  assert.equal(Object.isFrozen(release), true);
});

test("pins source, model, Rust, packet, Profile and RulePack lineage for both frozen runs", () => {
  const release = assembleFullPersonalReviewRelease(fixtureInput());

  assert.equal(release.reproducibility.resultPins.length, 108);
  assert.deepEqual(
    new Set(release.reproducibility.resultPins.map((pin) => pin.runKind)),
    new Set(["blind_evaluation", "full_data_proposal"]),
  );
  for (const pin of release.reproducibility.resultPins) {
    assert.match(pin.sourceSha256, SHA_256);
    assert.match(pin.packetHash, SHA_256);
    assert.match(pin.contextProposalHash, SHA_256);
    assert.ok(pin.visualModel);
    assert.ok(pin.rustEngine);
    assert.ok(pin.packetSchema);
    assert.ok(pin.profileBundle);
    assert.ok(pin.rulePack);
  }
  assert.match(release.reproducibility.sourceManifestHash, SHA_256);
  assert.match(release.reproducibility.manifestHash, SHA_256);
});

test("quarantines historical peaks and never uses them for Rep or turnaround accuracy", () => {
  const originalInput = fixtureInput();
  const original = assembleFullPersonalReviewRelease(originalInput);
  const changedTruth: PersonalGoldenDataset = {
    ...originalInput.truth,
    records: originalInput.truth.records.map((record) => ({
      ...record,
      segments: record.segments?.map((segment) => ({
        ...segment,
        peakMs: segment.startMs + 1,
      })),
    })),
  };
  const changed = assembleFullPersonalReviewRelease({
    ...originalInput,
    truth: changedTruth,
  });

  assert.deepEqual(changed.evaluation.rep, original.evaluation.rep);
  assert.deepEqual(
    changed.evaluation.turnaround,
    original.evaluation.turnaround,
  );
  assert.equal(changed.historicalPeakDiagnostics.admission, "quarantined");
  assert.equal(changed.historicalPeakDiagnostics.eligibleForScoring, false);
  assert.equal(changed.historicalPeakDiagnostics.presentCount, 464);
  assert.equal(changed.historicalPeakDiagnostics.exactIntervalMidpointCount, 0);
  assert.equal(changed.evaluation.turnaround.accuracy, null);
  assert.doesNotMatch(
    JSON.stringify(changed.evaluation),
    /peakMs|midpoint|aggregateStandardness|standardnessScore|totalScore/iu,
  );
});

test("reports only separated Rep metrics and review-bounded proposal/abstention coverage", () => {
  const release = assembleFullPersonalReviewRelease(fixtureInput());

  assert.deepEqual(Object.keys(release.evaluation.rep.overall).sort(), [
    "exactSetRate",
    "meanAbsoluteEndErrorMs",
    "meanAbsoluteStartErrorMs",
    "precision",
    "recall",
  ]);
  assert.deepEqual(release.evaluation.rep.overall, {
    precision: 1,
    recall: 1,
    exactSetRate: 1,
    meanAbsoluteStartErrorMs: 0,
    meanAbsoluteEndErrorMs: 0,
  });
  assert.deepEqual(release.evaluation.quality.overall, {
    eligibleCount: 464 * 8,
    proposalCount: 464 * 7,
    abstentionCount: 464,
    proposalRate: 7 / 8,
    abstentionRate: 1 / 8,
    reviewedFindingCount: 464 * 2,
    falseFindingCount: 464,
    falseFindingRate: 1 / 2,
    reviewStatusCounts: {
      unreviewed: 464 * 6,
      correct: 464,
      incorrect: 464,
      cannot_judge: 0,
    },
    limitations: ["no_exact_reviewed_reference"],
  });
  const standardCompatibility = release.evaluation.quality.byDimension.find(
    (bucket) => bucket.key === "standard_variant_compatibility",
  );
  assert.equal(standardCompatibility?.metrics.proposalRate, 0);
  assert.equal(standardCompatibility?.metrics.abstentionRate, 1);
  assert.equal(standardCompatibility?.metrics.falseFindingRate, null);
  assert.doesNotMatch(
    JSON.stringify(release.evaluation),
    /overallScore|standardnessAccuracy|standardnessScore|totalScore|blendedAccuracy/iu,
  );
  assert.equal(release.boundaries.aggregateStandardnessScore, "forbidden");
});

test("runner freezes blind evidence before running the full-data proposal and has no mutation stage", async () => {
  const fixture = fixtureInput();
  const { blind, fullDataProposal, ...runnerInput } = fixture;
  const events: string[] = [];
  const forbidden = (): never => {
    throw new Error("forbidden mutation callback was invoked");
  };
  const runner = {
    async freezeBlindRun() {
      events.push("blind:frozen");
      return { run: blind.run, frozenAt: blind.frozenAt };
    },
    async freezeFullDataProposalRun() {
      assert.deepEqual(events, ["blind:frozen"]);
      events.push("full_data_proposal:frozen");
      return fullDataProposal;
    },
    fit: forbidden,
    refit: forbidden,
    train: forbidden,
    mutateProfile: forbidden,
    promote: forbidden,
    runPython: forbidden,
  };

  const release = await runFullPersonalReviewRelease(runnerInput, runner);

  assert.deepEqual(events, ["blind:frozen", "full_data_proposal:frozen"]);
  assert.equal(release.runs.blind.runId, blind.run.runId);
  assert.equal(release.runs.fullDataProposal.runId, fullDataProposal.run.runId);
  assert.deepEqual(release.boundaries, {
    participantScope: "single_known_user",
    proves: [
      "frozen client-format single-pass Rep alignment on the declared personal source-held-out run",
      "review coverage of Rust endpoint and quality proposals on the complete personal corpus",
    ],
    doesNotProve: [
      "generalization to a new user, recording session, device, camera view or gym",
      "turnaround accuracy before new human turnaround review",
      "technique correctness before accepted qualified review truth exists",
      "strength, force, joint torque, muscle activation, injury risk or physiological cause",
      "blind accuracy of the full_data_proposal run",
    ],
    automaticTraining: false,
    refitting: false,
    profileMutation: false,
    productionPromotion: false,
    aggregateStandardnessScore: "forbidden",
    pythonRuntime: false,
  });
});

test("rejects tampered blind metrics, missing source lineage and silent mismatch repair", () => {
  const tampered = fixtureInput();
  assert.throws(
    () =>
      assembleFullPersonalReviewRelease({
        ...tampered,
        blind: {
          ...tampered.blind,
          report: {
            ...tampered.blind.report,
            aggregate: { ...tampered.blind.report.aggregate, precision: 0 },
          },
        },
      }),
    /reproduced from frozen predictions using start\/end truth only/u,
  );

  const missingSource = fixtureInput();
  assert.throws(
    () =>
      assembleFullPersonalReviewRelease({
        ...missingSource,
        sourcePins: missingSource.sourcePins.slice(1),
      }),
    /all 50 unique personal videos/u,
  );

  const repaired = fixtureInput();
  const repairedTruth: PersonalGoldenDataset = {
    ...repaired.truth,
    records: repaired.truth.records.map((record, index) =>
      index === 0
        ? {
            ...record,
            expectedCount: (record.expectedCount ?? 0) - 1,
          }
        : record,
    ),
  };
  const repairedReport = scoreFrozenBlindRun(repaired.blind.run, repairedTruth);
  assert.throws(
    () =>
      assembleFullPersonalReviewRelease({
        ...repaired,
        truth: repairedTruth,
        blind: { ...repaired.blind, report: repairedReport },
      }),
    /personal corpus inventory mismatch/u,
  );
});

test("rejects incomplete review queues and non-causal Rust endpoint proposals", () => {
  const missingRep = fixtureInput();
  const [firstContext, ...remainingContexts] =
    missingRep.fullDataProposal.reviewContexts;
  assert.ok(firstContext);
  assert.throws(
    () =>
      assembleFullPersonalReviewRelease({
        ...missingRep,
        fullDataProposal: {
          ...missingRep.fullDataProposal,
          reviewContexts: [
            { ...firstContext, reps: firstContext.reps.slice(1) },
            ...remainingContexts,
          ],
        },
      }),
    /review Rep inventory disagrees/u,
  );

  const nonCausal = fixtureInput();
  const [causalContext, ...otherContexts] =
    nonCausal.fullDataProposal.reviewContexts;
  assert.ok(causalContext);
  const [causalRep, ...otherReps] = causalContext.reps;
  assert.ok(causalRep);
  const turnaround = causalRep.endpoints.primary_turnaround;
  assert.ok(turnaround.occurredAtMs != null);
  const occurredAtMs = turnaround.occurredAtMs;
  assert.throws(
    () =>
      assembleFullPersonalReviewRelease({
        ...nonCausal,
        fullDataProposal: {
          ...nonCausal.fullDataProposal,
          reviewContexts: [
            {
              ...causalContext,
              reps: [
                {
                  ...causalRep,
                  endpoints: {
                    ...causalRep.endpoints,
                    primary_turnaround: {
                      ...turnaround,
                      confirmedAtMs: occurredAtMs - 1,
                    },
                  },
                },
                ...otherReps,
              ],
            },
            ...otherContexts,
          ],
        },
      }),
    /invalid or non-causal/u,
  );
});

test("rejects any tampering of a canonical Rust conclusion payload", () => {
  const tamperCases: ReadonlyArray<
    readonly [
      string,
      (
        conclusion: FullDataContextReviewProposal["reps"][number]["conclusions"][number],
      ) => FullDataContextReviewProposal["reps"][number]["conclusions"][number],
    ]
  > = [
    [
      "dimension",
      (conclusion) => ({ ...conclusion, dimension: "range_of_motion" }),
    ],
    ["state", (conclusion) => ({ ...conclusion, state: "abstained" })],
    ["confidence", (conclusion) => ({ ...conclusion, confidence: 0.1 })],
    [
      "summary",
      (conclusion) => ({ ...conclusion, summary: "tampered summary" }),
    ],
    ["reason", (conclusion) => ({ ...conclusion, reason: "tampered_reason" })],
    [
      "evidence",
      (conclusion) => ({ ...conclusion, evidence: ["tampered:evidence"] }),
    ],
    ["value/null", (conclusion) => ({ ...conclusion, value: null })],
  ];

  for (const [field, tamperConclusion] of tamperCases) {
    const tampered = fixtureInput();
    const [firstContext, ...remainingContexts] =
      tampered.fullDataProposal.reviewContexts;
    assert.ok(firstContext);
    const [firstRep, ...remainingReps] = firstContext.reps;
    assert.ok(firstRep);
    const [firstConclusion, ...remainingConclusions] = firstRep.conclusions;
    assert.ok(firstConclusion);

    assert.throws(
      () =>
        assembleFullPersonalReviewRelease({
          ...tampered,
          fullDataProposal: {
            ...tampered.fullDataProposal,
            reviewContexts: [
              {
                ...firstContext,
                reps: [
                  {
                    ...firstRep,
                    conclusions: [
                      tamperConclusion(firstConclusion),
                      ...remainingConclusions,
                    ],
                  },
                  ...remainingReps,
                ],
              },
              ...remainingContexts,
            ],
          },
        }),
      /canonical Rust conclusion payload mismatch/u,
      field,
    );
  }
});
