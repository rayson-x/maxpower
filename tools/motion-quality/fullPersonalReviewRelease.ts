import { createHash } from "node:crypto";

import {
  buildReleaseInventory,
  scoreFrozenBlindRun,
  type AlignmentMetrics,
  type AssessmentCapability,
  type BlindEvaluationReport,
  type FrozenContextPrediction,
  type FrozenPredictionRun,
  type PersonalGoldenDataset,
  type QualityReviewStatus,
  type ScoreOptions,
} from "./blindEvaluation.js";

export const QUALITY_DIMENSIONS = [
  "task_completion",
  "range_of_motion",
  "phase_control",
  "support_stability",
  "bilateral_coordination",
  "trajectory_control",
  "standard_variant_compatibility",
  "observation_confidence",
] as const;

export type QualityDimension = (typeof QUALITY_DIMENSIONS)[number];
export type ReviewProposalState = "proposed" | "abstained";

export interface ReviewEndpointProposal {
  readonly state: ReviewProposalState;
  readonly occurredAtMs: number | null;
  readonly confirmedAtMs: number | null;
  readonly reason: string | null;
}

export interface ReviewConclusionProposal {
  readonly conclusionId: string;
  readonly dimension: QualityDimension;
  readonly state: ReviewProposalState;
  readonly value: unknown;
  readonly confidence: number | null;
  readonly reason: string | null;
  readonly reviewStatus?: QualityReviewStatus;
}

export interface FullDataRepReviewProposal {
  readonly repId: string;
  readonly endpoints: Readonly<{
    start_anchor: ReviewEndpointProposal;
    primary_turnaround: ReviewEndpointProposal;
    end_return: ReviewEndpointProposal;
  }>;
  readonly conclusions: readonly ReviewConclusionProposal[];
}

export interface FullDataContextReviewProposal {
  readonly sourceCaptureId: string;
  readonly contextId: string;
  readonly reps: readonly FullDataRepReviewProposal[];
}

export interface FrozenRunArtifact {
  readonly run: FrozenPredictionRun;
  readonly frozenAt: string;
}

export interface FrozenBlindArtifact extends FrozenRunArtifact {
  readonly report: BlindEvaluationReport;
}

export interface FrozenFullDataProposalArtifact extends FrozenRunArtifact {
  readonly reviewContexts: readonly FullDataContextReviewProposal[];
}

export interface SourcePin {
  readonly sourceCaptureId: string;
  readonly assetId: "personal-raw-capture-archive";
  readonly admission: "immutable_source";
  readonly authority: "user_source";
  readonly groupKey: "sourceCaptureId";
  readonly sourceSha256: string;
}

interface GovernedAssetPin {
  readonly assetId: string;
  readonly admission: string;
  readonly authority: string;
  readonly groupKey: "sourceCaptureId";
  readonly sourceSha256?: string;
}

export interface PersonalReviewGovernancePins {
  readonly catalogId: "maxpower-motion-training-data-v1";
  readonly catalogSha256: string;
  readonly humanRanges: GovernedAssetPin &
    Readonly<{
      assetId: "personal-human-rep-ranges-v2";
      admission: "label_allowed";
      authority: "user_reviewed";
      sourceSha256: string;
      selectedFields: readonly string[];
    }>;
  readonly historicalPeaks: GovernedAssetPin &
    Readonly<{
      assetId: "personal-legacy-peak-field-v2";
      admission: "quarantined";
      authority: "mixed_unknown";
      sourceSha256: string;
      selectedField: "segments[].peakMs";
    }>;
  readonly modelObservations: GovernedAssetPin &
    Readonly<{
      assetId: "personal-native-rtmpose-halpe26-observations";
      admission: "feature_only";
      authority: "model_generated";
    }>;
  readonly frozenEvaluation: GovernedAssetPin &
    Readonly<{
      assetId: "client-single-pass-predictions-and-agent-output";
      admission: "evaluation_only";
      authority: "frozen_prediction_or_report";
    }>;
}

export interface PersonalReviewReleaseVersions {
  readonly assembler: string;
  readonly actionBundle: string;
  readonly qualitySchema: "maxpower.motion-quality-proposal/v1";
  readonly reviewSchema: "maxpower-motion-quality-review-export/v1";
}

export interface FullPersonalReviewReleaseInput {
  readonly releaseId: string;
  readonly assembledAt: string;
  readonly truth: PersonalGoldenDataset;
  readonly blind: FrozenBlindArtifact;
  readonly fullDataProposal: FrozenFullDataProposalArtifact;
  readonly sourcePins: readonly SourcePin[];
  readonly governance: PersonalReviewGovernancePins;
  readonly versions: PersonalReviewReleaseVersions;
}

export interface SeparatedRepMetrics {
  readonly precision: number | null;
  readonly recall: number | null;
  readonly exactSetRate: number | null;
  readonly meanAbsoluteStartErrorMs: number | null;
  readonly meanAbsoluteEndErrorMs: number | null;
}

export interface CoverageMetrics {
  readonly eligibleCount: number;
  readonly proposalCount: number;
  readonly abstentionCount: number;
  readonly proposalRate: number | null;
  readonly abstentionRate: number | null;
  readonly reviewedFindingCount: number;
  readonly falseFindingCount: number;
  readonly falseFindingRate: number | null;
  readonly reviewStatusCounts: Readonly<Record<QualityReviewStatus, number>>;
  readonly limitations: readonly string[];
}

interface ReviewReadyRep {
  readonly repId: string;
  readonly sourceCaptureId: string;
  readonly contextId: string;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: AssessmentCapability;
  readonly originalRepId: string;
  readonly endpoints: FullDataRepReviewProposal["endpoints"];
  readonly conclusions: readonly ReviewConclusionProposal[];
}

export interface ReviewReadyProposal {
  readonly schemaVersion: "maxpower-motion-quality-proposal/v1";
  readonly proposalHash: string;
  readonly lineage: Readonly<{
    releaseId: string;
    runId: string;
    runKind: "full_data_proposal";
    frozenDigest: string;
    sourceManifestHash: string;
    actionBundleVersion: string;
    qualitySchemaVersion: string;
    reviewSchemaVersion: string;
  }>;
  readonly reps: readonly Readonly<ReviewReadyRep>[];
}

export interface FullPersonalReviewRelease {
  readonly schemaVersion: "maxpower-motion-quality-personal-review-release/v1";
  readonly releaseId: string;
  readonly assembledAt: string;
  readonly inventory: Readonly<{
    uniqueVideoCount: 50;
    exactContextCount: 54;
    humanIntervalCount: 464;
    expectedRepCount: 465;
    expectedMinusHumanIntervals: 1;
    mismatchPolicy: "known_mismatch_preserved";
  }>;
  readonly runs: Readonly<{
    blind: Readonly<{
      runId: string;
      runKind: "blind_evaluation";
      frozenAt: string;
      planDigest: string;
      frozenDigest: string;
      reportDigest: string;
    }>;
    fullDataProposal: Readonly<{
      runId: string;
      runKind: "full_data_proposal";
      frozenAt: string;
      planDigest: string;
      frozenDigest: string;
    }>;
  }>;
  readonly contexts: readonly Readonly<{
    sourceCaptureId: string;
    contextId: string;
    actionId: string;
    capturePosition: string;
    capability: AssessmentCapability;
    blindCapability: AssessmentCapability;
  }>[];
  readonly evaluation: Readonly<{
    rep: Readonly<{
      scope: "frozen_blind_run_only";
      overall: SeparatedRepMetrics;
      byAction: readonly Readonly<{
        key: string;
        metrics: SeparatedRepMetrics;
      }>[];
      byView: readonly Readonly<{
        key: string;
        metrics: SeparatedRepMetrics;
      }>[];
      byCapability: readonly Readonly<{
        key: string;
        metrics: SeparatedRepMetrics;
      }>[];
      byActionViewCapability: readonly Readonly<{
        key: string;
        metrics: SeparatedRepMetrics;
      }>[];
    }>;
    turnaround: Readonly<{
      scope: "full_data_proposal_coverage_only";
      eligibleRepCount: number;
      proposalCount: number;
      abstentionCount: number;
      proposalRate: number | null;
      abstentionRate: number | null;
      accuracy: null;
      limitation: "historical_peaks_are_not_turnaround_truth";
    }>;
    quality: Readonly<{
      scope: "full_data_proposal_and_manual_review_only";
      overall: CoverageMetrics;
      byDimension: readonly Readonly<{
        key: QualityDimension;
        metrics: CoverageMetrics;
      }>[];
      byActionViewCapabilityAndDimension: readonly Readonly<{
        key: string;
        metrics: CoverageMetrics;
      }>[];
    }>;
  }>;
  readonly historicalPeakDiagnostics: Readonly<{
    assetId: "personal-legacy-peak-field-v2";
    admission: "quarantined";
    authority: "mixed_unknown";
    eligibleForScoring: false;
    presentCount: number;
    exactIntervalMidpointCount: number;
    entries: readonly Readonly<{
      sourceCaptureId: string;
      contextId: string;
      repIndex: number;
      peakMs: number;
    }>[];
  }>;
  readonly reviewProposal: ReviewReadyProposal;
  readonly reproducibility: Readonly<{
    catalogId: string;
    catalogSha256: string;
    sourceManifestHash: string;
    versions: PersonalReviewReleaseVersions;
    governedAssets: PersonalReviewGovernancePins;
    resultPins: readonly Readonly<{
      runKind: "blind_evaluation" | "full_data_proposal";
      sourceCaptureId: string;
      contextId: string;
      sourceSha256: string;
      packetHash: string;
      contextProposalHash: string;
      bundleHash: string | null;
      visualModel: string;
      rustEngine: string;
      packetSchema: string;
      profileBundle: string;
      rulePack: string;
    }>[];
    manifestHash: string;
  }>;
  readonly boundaries: Readonly<{
    participantScope: "single_known_user";
    proves: readonly string[];
    doesNotProve: readonly string[];
    automaticTraining: false;
    refitting: false;
    profileMutation: false;
    productionPromotion: false;
    aggregateStandardnessScore: "forbidden";
    pythonRuntime: false;
  }>;
  readonly releaseHash: string;
}

export interface FullPersonalReviewReleaseRunner {
  freezeBlindRun(): Promise<Readonly<FrozenRunArtifact>>;
  freezeFullDataProposalRun(): Promise<
    Readonly<FrozenFullDataProposalArtifact>
  >;
}

export type FullPersonalReviewRunnerInput = Omit<
  FullPersonalReviewReleaseInput,
  "blind" | "fullDataProposal"
> &
  Readonly<{ scoreOptions?: ScoreOptions }>;

/**
 * Runs only the two already-configured causal inference jobs. The runner API
 * intentionally has no fit, train, promote or mutate callback.
 */
export async function runFullPersonalReviewRelease(
  input: FullPersonalReviewRunnerInput,
  runner: FullPersonalReviewReleaseRunner,
): Promise<Readonly<FullPersonalReviewRelease>> {
  const blind = await runner.freezeBlindRun();
  assertRunKind(blind.run, "blind_evaluation");
  const report = scoreFrozenBlindRun(
    blind.run,
    input.truth,
    input.scoreOptions,
  );
  const fullDataProposal = await runner.freezeFullDataProposalRun();
  return assembleFullPersonalReviewRelease({
    ...input,
    blind: { ...blind, report },
    fullDataProposal,
  });
}

/** Pure assembler: validates, projects and hashes; it performs no file writes. */
export function assembleFullPersonalReviewRelease(
  input: FullPersonalReviewReleaseInput,
): Readonly<FullPersonalReviewRelease> {
  requireNonEmpty(input.releaseId, "releaseId");
  const assembledAt = requireTimestamp(input.assembledAt, "assembledAt");
  const blindFrozenAt = requireTimestamp(
    input.blind.frozenAt,
    "blind.frozenAt",
  );
  const fullFrozenAt = requireTimestamp(
    input.fullDataProposal.frozenAt,
    "fullDataProposal.frozenAt",
  );
  if (Date.parse(blindFrozenAt) >= Date.parse(fullFrozenAt)) {
    throw new Error(
      "frozen blind run must exist before the full_data_proposal run",
    );
  }
  if (Date.parse(fullFrozenAt) > Date.parse(assembledAt)) {
    throw new Error("assembledAt cannot precede a frozen run");
  }
  assertGovernance(input.governance);
  assertRunKind(input.blind.run, "blind_evaluation");
  assertRunKind(input.fullDataProposal.run, "full_data_proposal");
  assertReleaseVersions(input.versions);

  const recomputedBlindReport = scoreFrozenBlindRun(
    input.blind.run,
    input.truth,
    {
      minimumIntervalIoU: input.blind.report.matchingPolicy.minimumIntervalIoU,
      maximumBoundaryErrorMs:
        input.blind.report.matchingPolicy.maximumBoundaryErrorMs,
    },
  );
  if (
    stableStringify(recomputedBlindReport) !==
    stableStringify(input.blind.report)
  ) {
    throw new Error(
      "blind report must be reproduced from frozen predictions using start/end truth only",
    );
  }

  const baseInventory = buildReleaseInventory({
    truth: input.truth,
    blindRun: input.blind.run,
    blindReport: recomputedBlindReport,
    fullDataProposalRun: input.fullDataProposal.run,
  });
  const sourcePinById = validateSourcePins(input.sourcePins, input.truth);
  const blindByContext = contextMap(input.blind.run);
  const detailByContext = reviewContextMap(
    input.fullDataProposal.reviewContexts,
  );
  const historicalPeakDiagnostics = quarantineHistoricalPeaks(input.truth);

  const contexts = input.fullDataProposal.run.contexts.map((context) => {
    const blind = blindByContext.get(
      contextKey(context.sourceCaptureId, context.contextId),
    );
    if (
      !blind ||
      blind.actionId !== context.actionId ||
      blind.capturePosition !== context.capturePosition
    ) {
      throw new Error(
        `${context.contextId}: blind and full-data context identities disagree`,
      );
    }
    return {
      sourceCaptureId: context.sourceCaptureId,
      contextId: context.contextId,
      actionId: context.actionId,
      capturePosition: context.capturePosition,
      capability: context.capability,
      blindCapability: blind.capability,
    };
  });

  const reviewReps: ReviewReadyRep[] = [];
  for (const context of input.fullDataProposal.run.contexts) {
    const detail = detailByContext.get(
      contextKey(context.sourceCaptureId, context.contextId),
    );
    if (!detail)
      throw new Error(
        `${context.contextId}: full-data review proposal is missing`,
      );
    const accepted = context.reps.filter(
      (rep) => rep.disposition !== "rejected",
    );
    const detailByRep = new Map(detail.reps.map((rep) => [rep.repId, rep]));
    if (
      detailByRep.size !== detail.reps.length ||
      accepted.length !== detail.reps.length ||
      accepted.some((rep) => !detailByRep.has(rep.repId))
    ) {
      throw new Error(
        `${context.contextId}: review Rep inventory disagrees with frozen QLT1 output`,
      );
    }
    const frozenConclusions = new Map(
      context.qualityConclusions.map((conclusion) => [
        conclusion.conclusionId,
        conclusion,
      ]),
    );
    for (const rep of accepted) {
      const proposal = detailByRep.get(rep.repId);
      if (!proposal)
        throw new Error(
          `${context.contextId}:${rep.repId}: review proposal missing`,
        );
      validateEndpoints(context, rep, proposal.endpoints);
      validateConclusions(context, proposal.conclusions, frozenConclusions);
      reviewReps.push({
        repId: globalRepId(
          context.sourceCaptureId,
          context.contextId,
          rep.repId,
        ),
        sourceCaptureId: context.sourceCaptureId,
        contextId: context.contextId,
        actionId: context.actionId,
        capturePosition: context.capturePosition,
        capability: context.capability,
        originalRepId: rep.repId,
        endpoints: cloneEndpoints(proposal.endpoints),
        conclusions: proposal.conclusions.map((conclusion) => ({
          ...conclusion,
        })),
      });
    }
    const usedConclusionIds = new Set(
      detail.reps.flatMap((rep) =>
        rep.conclusions.map((conclusion) => conclusion.conclusionId),
      ),
    );
    if (
      usedConclusionIds.size !== frozenConclusions.size ||
      [...frozenConclusions.keys()].some((id) => !usedConclusionIds.has(id))
    ) {
      throw new Error(
        `${context.contextId}: review conclusions disagree with frozen QLT1 output`,
      );
    }
  }
  if (detailByContext.size !== input.fullDataProposal.run.contexts.length) {
    throw new Error("full-data review proposal contains an unplanned context");
  }
  if (reviewReps.length !== 464) {
    throw new Error(
      `full_data_proposal must expose all 464 human-range Reps for review; got ${reviewReps.length}`,
    );
  }

  const normalizedPins = [...sourcePinById.values()].sort((left, right) =>
    left.sourceCaptureId.localeCompare(right.sourceCaptureId),
  );
  const sourceManifestHash = sha256(stableStringify(normalizedPins));
  const proposalSemantic = {
    schemaVersion: "maxpower-motion-quality-proposal/v1" as const,
    lineage: {
      releaseId: input.releaseId,
      runId: input.fullDataProposal.run.runId,
      runKind: "full_data_proposal" as const,
      frozenDigest: input.fullDataProposal.run.frozenDigest,
      sourceManifestHash,
      actionBundleVersion: requireNonEmpty(
        input.versions.actionBundle,
        "versions.actionBundle",
      ),
      qualitySchemaVersion: input.versions.qualitySchema,
      reviewSchemaVersion: input.versions.reviewSchema,
    },
    reps: reviewReps,
  };
  const reviewProposal: ReviewReadyProposal = {
    ...proposalSemantic,
    proposalHash: `sha256:${sha256(stableStringify(proposalSemantic))}`,
  };

  const resultPins = [input.blind.run, input.fullDataProposal.run].flatMap(
    (run) =>
      run.contexts.map((context) => {
        const source = sourcePinById.get(context.sourceCaptureId);
        if (!source)
          throw new Error(
            `${context.contextId}: source pin missing after validation`,
          );
        return {
          runKind: run.runKind,
          sourceCaptureId: context.sourceCaptureId,
          contextId: context.contextId,
          sourceSha256: source.sourceSha256,
          packetHash: context.packetHash,
          contextProposalHash: context.proposalHash,
          bundleHash: context.bundleHash,
          visualModel: context.versions.visualModel,
          rustEngine: context.versions.rustEngine,
          packetSchema: context.versions.packetSchema,
          profileBundle: context.versions.profileBundle,
          rulePack: context.versions.rulePack,
        };
      }),
  );
  const manifestSemantic = {
    catalogId: input.governance.catalogId,
    catalogSha256: input.governance.catalogSha256,
    sourceManifestHash,
    versions: { ...input.versions },
    governedAssets: cloneGovernance(input.governance),
    resultPins,
  };
  const reproducibility = {
    ...manifestSemantic,
    manifestHash: sha256(stableStringify(manifestSemantic)),
  };

  const qualityRows = reviewReps.flatMap((rep) =>
    rep.conclusions.map((conclusion) => ({
      actionId: rep.actionId,
      capturePosition: rep.capturePosition,
      capability: rep.capability,
      conclusion,
    })),
  );
  const turnaroundProposalCount = reviewReps.filter(
    (rep) => rep.endpoints.primary_turnaround.state === "proposed",
  ).length;
  const semantic = {
    schemaVersion:
      "maxpower-motion-quality-personal-review-release/v1" as const,
    releaseId: input.releaseId,
    assembledAt,
    inventory: {
      uniqueVideoCount: 50 as const,
      exactContextCount: 54 as const,
      humanIntervalCount: 464 as const,
      expectedRepCount: 465 as const,
      expectedMinusHumanIntervals: 1 as const,
      mismatchPolicy: "known_mismatch_preserved" as const,
    },
    runs: {
      blind: {
        runId: input.blind.run.runId,
        runKind: "blind_evaluation" as const,
        frozenAt: blindFrozenAt,
        planDigest: input.blind.run.planDigest,
        frozenDigest: input.blind.run.frozenDigest,
        reportDigest: recomputedBlindReport.reportDigest,
      },
      fullDataProposal: {
        runId: input.fullDataProposal.run.runId,
        runKind: "full_data_proposal" as const,
        frozenAt: fullFrozenAt,
        planDigest: input.fullDataProposal.run.planDigest,
        frozenDigest: input.fullDataProposal.run.frozenDigest,
      },
    },
    contexts,
    evaluation: {
      rep: {
        scope: "frozen_blind_run_only" as const,
        overall: separatedRepMetrics(recomputedBlindReport.aggregate),
        byAction: projectMetricBuckets(recomputedBlindReport.buckets.byAction),
        byView: projectMetricBuckets(recomputedBlindReport.buckets.byView),
        byCapability: projectMetricBuckets(
          recomputedBlindReport.buckets.byCapability,
        ),
        byActionViewCapability: projectMetricBuckets(
          recomputedBlindReport.buckets.byActionViewCapability,
        ),
      },
      turnaround: {
        scope: "full_data_proposal_coverage_only" as const,
        eligibleRepCount: reviewReps.length,
        proposalCount: turnaroundProposalCount,
        abstentionCount: reviewReps.length - turnaroundProposalCount,
        proposalRate: ratio(turnaroundProposalCount, reviewReps.length),
        abstentionRate: ratio(
          reviewReps.length - turnaroundProposalCount,
          reviewReps.length,
        ),
        accuracy: null,
        limitation: "historical_peaks_are_not_turnaround_truth" as const,
      },
      quality: {
        scope: "full_data_proposal_and_manual_review_only" as const,
        overall: coverageMetrics(qualityRows),
        byDimension: QUALITY_DIMENSIONS.map((dimension) => ({
          key: dimension,
          metrics: coverageMetrics(
            qualityRows.filter((row) => row.conclusion.dimension === dimension),
          ),
        })),
        byActionViewCapabilityAndDimension: groupedCoverageMetrics(qualityRows),
      },
    },
    historicalPeakDiagnostics,
    reviewProposal,
    reproducibility,
    boundaries: {
      participantScope: "single_known_user" as const,
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
      automaticTraining: false as const,
      refitting: false as const,
      profileMutation: false as const,
      productionPromotion: false as const,
      aggregateStandardnessScore: "forbidden" as const,
      pythonRuntime: false as const,
    },
  };
  if (
    baseInventory.inventory.expectedRepCount -
      baseInventory.inventory.humanRangeCount !==
    1
  ) {
    throw new Error("known expected-count mismatch was not preserved");
  }
  return deepFreeze({
    ...semantic,
    releaseHash: sha256(stableStringify(semantic)),
  });
}

function assertRunKind(
  run: FrozenPredictionRun,
  expected: "blind_evaluation" | "full_data_proposal",
): void {
  if (run.state !== "frozen_before_truth" || run.runKind !== expected) {
    throw new Error(`${expected} requires a frozen ${expected} artifact`);
  }
}

function assertGovernance(governance: PersonalReviewGovernancePins): void {
  if (governance.catalogId !== "maxpower-motion-training-data-v1") {
    throw new Error("unexpected data governance catalog");
  }
  requireSha256(governance.catalogSha256, "governance.catalogSha256");
  const requiredFields = [
    "exerciseId",
    "capturePosition",
    "expectedCount",
    "segments[].startMs",
    "segments[].endMs",
  ];
  if (
    governance.humanRanges.assetId !== "personal-human-rep-ranges-v2" ||
    governance.humanRanges.admission !== "label_allowed" ||
    governance.humanRanges.authority !== "user_reviewed" ||
    stableStringify([...governance.humanRanges.selectedFields].sort()) !==
      stableStringify([...requiredFields].sort())
  ) {
    throw new Error(
      "human range supervision pin is not admissible for this release",
    );
  }
  if (
    governance.historicalPeaks.assetId !== "personal-legacy-peak-field-v2" ||
    governance.historicalPeaks.admission !== "quarantined" ||
    governance.historicalPeaks.selectedField !== "segments[].peakMs"
  ) {
    throw new Error("historical peak field must remain quarantined");
  }
  if (
    governance.modelObservations.assetId !==
      "personal-native-rtmpose-halpe26-observations" ||
    governance.modelObservations.admission !== "feature_only"
  ) {
    throw new Error("model observations must remain feature_only");
  }
  if (
    governance.frozenEvaluation.assetId !==
      "client-single-pass-predictions-and-agent-output" ||
    governance.frozenEvaluation.admission !== "evaluation_only"
  ) {
    throw new Error("frozen predictions must remain evaluation_only");
  }
  requireSha256(
    governance.humanRanges.sourceSha256,
    "human range sourceSha256",
  );
  requireSha256(
    governance.historicalPeaks.sourceSha256,
    "historical peak sourceSha256",
  );
}

function validateSourcePins(
  sourcePins: readonly SourcePin[],
  truth: PersonalGoldenDataset,
): Map<string, SourcePin> {
  const expected = new Set(
    truth.records.map((record) =>
      String(record.sourceCaptureId ?? record.captureId),
    ),
  );
  const byId = new Map<string, SourcePin>();
  for (const pin of sourcePins) {
    requireNonEmpty(pin.sourceCaptureId, "sourceCaptureId");
    if (
      pin.assetId !== "personal-raw-capture-archive" ||
      pin.admission !== "immutable_source" ||
      pin.authority !== "user_source" ||
      pin.groupKey !== "sourceCaptureId"
    ) {
      throw new Error(`${pin.sourceCaptureId}: invalid immutable source pin`);
    }
    requireSha256(pin.sourceSha256, `${pin.sourceCaptureId}.sourceSha256`);
    if (byId.has(pin.sourceCaptureId))
      throw new Error(`duplicate source pin ${pin.sourceCaptureId}`);
    byId.set(pin.sourceCaptureId, { ...pin });
  }
  if (
    expected.size !== 50 ||
    byId.size !== expected.size ||
    [...expected].some((sourceId) => !byId.has(sourceId))
  ) {
    throw new Error(
      "source pins must cover all 50 unique personal videos exactly once",
    );
  }
  return byId;
}

function assertReleaseVersions(versions: PersonalReviewReleaseVersions): void {
  requireNonEmpty(versions.assembler, "versions.assembler");
  requireNonEmpty(versions.actionBundle, "versions.actionBundle");
  if (versions.qualitySchema !== "maxpower.motion-quality-proposal/v1") {
    throw new Error("unsupported quality proposal schema version");
  }
  if (versions.reviewSchema !== "maxpower-motion-quality-review-export/v1") {
    throw new Error("unsupported manual review export schema version");
  }
}

function contextMap(
  run: FrozenPredictionRun,
): Map<string, FrozenContextPrediction> {
  const result = new Map<string, FrozenContextPrediction>();
  for (const context of run.contexts) {
    const key = contextKey(context.sourceCaptureId, context.contextId);
    if (result.has(key)) throw new Error(`duplicate frozen context ${key}`);
    result.set(key, context);
  }
  return result;
}

function reviewContextMap(
  contexts: readonly FullDataContextReviewProposal[],
): Map<string, FullDataContextReviewProposal> {
  const result = new Map<string, FullDataContextReviewProposal>();
  for (const context of contexts) {
    const key = contextKey(context.sourceCaptureId, context.contextId);
    if (result.has(key)) throw new Error(`duplicate review context ${key}`);
    result.set(key, context);
  }
  return result;
}

function validateEndpoints(
  context: FrozenContextPrediction,
  rep: FrozenContextPrediction["reps"][number],
  endpoints: FullDataRepReviewProposal["endpoints"],
): void {
  validateEndpoint(
    endpoints.start_anchor,
    `${context.contextId}:${rep.repId}:start_anchor`,
  );
  validateEndpoint(
    endpoints.primary_turnaround,
    `${context.contextId}:${rep.repId}:primary_turnaround`,
  );
  validateEndpoint(
    endpoints.end_return,
    `${context.contextId}:${rep.repId}:end_return`,
  );
  if (
    endpoints.start_anchor.state !== "proposed" ||
    endpoints.start_anchor.occurredAtMs !== rep.startMs ||
    endpoints.end_return.state !== "proposed" ||
    endpoints.end_return.occurredAtMs !== rep.endMs
  ) {
    throw new Error(
      `${context.contextId}:${rep.repId}: start/end endpoints disagree with frozen Rep`,
    );
  }
  if (rep.turnaroundTimestampMs === undefined) {
    if (endpoints.primary_turnaround.state !== "abstained") {
      throw new Error(
        `${context.contextId}:${rep.repId}: missing turnaround must remain abstained`,
      );
    }
  } else if (
    endpoints.primary_turnaround.state !== "proposed" ||
    endpoints.primary_turnaround.occurredAtMs !== rep.turnaroundTimestampMs
  ) {
    throw new Error(
      `${context.contextId}:${rep.repId}: turnaround disagrees with frozen QLT1`,
    );
  }
}

function validateEndpoint(
  endpoint: ReviewEndpointProposal,
  label: string,
): void {
  if (endpoint.state === "abstained") {
    if (
      endpoint.occurredAtMs !== null ||
      endpoint.confirmedAtMs !== null ||
      !endpoint.reason?.trim()
    ) {
      throw new Error(
        `${label}: abstention requires null timestamps and a reason`,
      );
    }
    return;
  }
  if (
    !Number.isSafeInteger(endpoint.occurredAtMs) ||
    !Number.isSafeInteger(endpoint.confirmedAtMs) ||
    (endpoint.occurredAtMs ?? -1) < 0 ||
    (endpoint.confirmedAtMs ?? -1) < (endpoint.occurredAtMs ?? 0)
  ) {
    throw new Error(
      `${label}: proposed endpoint timestamps are invalid or non-causal`,
    );
  }
}

function validateConclusions(
  context: FrozenContextPrediction,
  conclusions: readonly ReviewConclusionProposal[],
  frozen: ReadonlyMap<
    string,
    FrozenContextPrediction["qualityConclusions"][number]
  >,
): void {
  const dimensions = new Set<QualityDimension>();
  const ids = new Set<string>();
  for (const conclusion of conclusions) {
    requireNonEmpty(conclusion.conclusionId, "conclusionId");
    if (ids.has(conclusion.conclusionId)) {
      throw new Error(
        `${context.contextId}: duplicate conclusion ${conclusion.conclusionId}`,
      );
    }
    ids.add(conclusion.conclusionId);
    dimensions.add(conclusion.dimension);
    const frozenConclusion = frozen.get(conclusion.conclusionId);
    if (!frozenConclusion || frozenConclusion.state !== conclusion.state) {
      throw new Error(
        `${context.contextId}:${conclusion.conclusionId}: conclusion is not frozen QLT1`,
      );
    }
    if (conclusion.state === "abstained") {
      if (
        !conclusion.reason?.trim() ||
        conclusion.value !== null ||
        conclusion.confidence !== null
      ) {
        throw new Error(
          `${context.contextId}:${conclusion.conclusionId}: abstention needs a reason and null value/confidence`,
        );
      }
    } else if (
      conclusion.confidence == null ||
      conclusion.confidence < 0 ||
      conclusion.confidence > 1
    ) {
      throw new Error(
        `${context.contextId}:${conclusion.conclusionId}: invalid proposal confidence`,
      );
    }
    if (
      conclusion.reviewStatus !== undefined &&
      conclusion.reviewStatus !==
        (frozenConclusion.reviewStatus ?? "unreviewed")
    ) {
      throw new Error(
        `${context.contextId}:${conclusion.conclusionId}: review status lineage mismatch`,
      );
    }
  }
  if (
    conclusions.length !== QUALITY_DIMENSIONS.length ||
    QUALITY_DIMENSIONS.some((dimension) => !dimensions.has(dimension))
  ) {
    throw new Error(
      `${context.contextId}: every review Rep needs all eight quality dimensions`,
    );
  }
}

function cloneEndpoints(
  endpoints: FullDataRepReviewProposal["endpoints"],
): FullDataRepReviewProposal["endpoints"] {
  return {
    start_anchor: { ...endpoints.start_anchor },
    primary_turnaround: { ...endpoints.primary_turnaround },
    end_return: { ...endpoints.end_return },
  };
}

function quarantineHistoricalPeaks(
  truth: PersonalGoldenDataset,
): FullPersonalReviewRelease["historicalPeakDiagnostics"] {
  const entries = truth.records.flatMap((record) =>
    (record.segments ?? []).flatMap((segment, repIndex) =>
      segment.peakMs === undefined
        ? []
        : [
            {
              sourceCaptureId: String(
                record.sourceCaptureId ?? record.captureId,
              ),
              contextId: record.captureId,
              repIndex,
              peakMs: segment.peakMs,
            },
          ],
    ),
  );
  const segmentByContext = new Map(
    truth.records.map((record) => [record.captureId, record.segments ?? []]),
  );
  const exactIntervalMidpointCount = entries.filter((entry) => {
    const segment = segmentByContext.get(entry.contextId)?.[entry.repIndex];
    return (
      segment !== undefined &&
      entry.peakMs === (segment.startMs + segment.endMs) / 2
    );
  }).length;
  return {
    assetId: "personal-legacy-peak-field-v2",
    admission: "quarantined",
    authority: "mixed_unknown",
    eligibleForScoring: false,
    presentCount: entries.length,
    exactIntervalMidpointCount,
    entries,
  };
}

function separatedRepMetrics(metrics: AlignmentMetrics): SeparatedRepMetrics {
  return {
    precision: metrics.precision,
    recall: metrics.recall,
    exactSetRate: metrics.exactSetRate,
    meanAbsoluteStartErrorMs: metrics.meanAbsoluteStartErrorMs,
    meanAbsoluteEndErrorMs: metrics.meanAbsoluteEndErrorMs,
  };
}

function projectMetricBuckets(
  buckets: BlindEvaluationReport["buckets"]["byAction"],
): readonly Readonly<{ key: string; metrics: SeparatedRepMetrics }>[] {
  return buckets.map((bucket) => ({
    key: bucket.key,
    metrics: separatedRepMetrics(bucket.metrics),
  }));
}

interface QualityRow {
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: AssessmentCapability;
  readonly conclusion: ReviewConclusionProposal;
}

function coverageMetrics(rows: readonly QualityRow[]): CoverageMetrics {
  const proposalRows = rows.filter(
    (row) => row.conclusion.state === "proposed",
  );
  const abstentionRows = rows.filter(
    (row) => row.conclusion.state === "abstained",
  );
  const reviewStatusCounts: Record<QualityReviewStatus, number> = {
    unreviewed: 0,
    correct: 0,
    incorrect: 0,
    cannot_judge: 0,
  };
  for (const row of rows)
    reviewStatusCounts[row.conclusion.reviewStatus ?? "unreviewed"] += 1;
  const reviewedFindings = proposalRows.filter((row) => {
    const status = row.conclusion.reviewStatus ?? "unreviewed";
    return status === "correct" || status === "incorrect";
  });
  const falseFindings = reviewedFindings.filter(
    (row) => row.conclusion.reviewStatus === "incorrect",
  );
  return {
    eligibleCount: rows.length,
    proposalCount: proposalRows.length,
    abstentionCount: abstentionRows.length,
    proposalRate: ratio(proposalRows.length, rows.length),
    abstentionRate: ratio(abstentionRows.length, rows.length),
    reviewedFindingCount: reviewedFindings.length,
    falseFindingCount: falseFindings.length,
    falseFindingRate: ratio(falseFindings.length, reviewedFindings.length),
    reviewStatusCounts,
    limitations: [
      ...new Set(
        abstentionRows.flatMap((row) =>
          row.conclusion.reason?.trim() ? [row.conclusion.reason.trim()] : [],
        ),
      ),
    ].sort(),
  };
}

function groupedCoverageMetrics(
  rows: readonly QualityRow[],
): readonly Readonly<{
  key: string;
  metrics: CoverageMetrics;
}>[] {
  const grouped = new Map<string, QualityRow[]>();
  for (const row of rows) {
    const key = [
      row.actionId,
      row.capturePosition,
      row.capability,
      row.conclusion.dimension,
    ].join("|");
    const values = grouped.get(key) ?? [];
    values.push(row);
    grouped.set(key, values);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, values]) => ({ key, metrics: coverageMetrics(values) }));
}

function cloneGovernance(
  value: PersonalReviewGovernancePins,
): PersonalReviewGovernancePins {
  return {
    ...value,
    humanRanges: {
      ...value.humanRanges,
      selectedFields: [...value.humanRanges.selectedFields],
    },
    historicalPeaks: { ...value.historicalPeaks },
    modelObservations: { ...value.modelObservations },
    frozenEvaluation: { ...value.frozenEvaluation },
  };
}

function contextKey(sourceCaptureId: string, contextId: string): string {
  return `${sourceCaptureId}\u0000${contextId}`;
}

function globalRepId(
  sourceCaptureId: string,
  contextId: string,
  repId: string,
): string {
  return `${sourceCaptureId}/${contextId}/${repId}`;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function requireTimestamp(value: string, field: string): string {
  requireNonEmpty(value, field);
  if (!Number.isFinite(Date.parse(value)))
    throw new Error(`${field} must be an ISO timestamp`);
  return value;
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} must be non-empty`);
  return value.trim();
}

function requireSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value))
    throw new Error(`${field} must be a SHA-256 hex digest`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
