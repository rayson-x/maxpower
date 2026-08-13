import { createHash } from "node:crypto";

export type AssessmentCapability =
  | "quality_supported"
  | "phase_supported"
  | "observation_only"
  | "unsupported";

export interface PersonalGoldenSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly peakMs?: number;
}

export interface PersonalGoldenRecord {
  readonly captureId: string;
  readonly sourceCaptureId?: string;
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly expectedCount?: number;
  readonly segments?: readonly PersonalGoldenSegment[];
  /** Action/view routing window; this is input context, not Rep boundary truth. */
  readonly evaluationWindow?: Readonly<{
    readonly startMs: number;
    readonly endMs: number;
  }>;
  readonly source?: Readonly<{
    video?: string;
    durationMs?: number;
  }>;
}

export interface PersonalGoldenDataset {
  readonly schemaVersion?: string;
  readonly records: readonly PersonalGoldenRecord[];
}

export interface ProfileBundle {
  readonly bundleId: string;
  readonly bundleHash: string;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: Exclude<AssessmentCapability, "unsupported">;
  readonly fittedSourceIds: readonly string[];
  readonly fittedDerivativeSourceIds?: readonly string[];
  readonly eligibleTargetSourceIds?: readonly string[];
  readonly versions: Readonly<{
    profile: string;
    rulePack: string;
  }>;
}

export interface LeakageValidation {
  readonly valid: boolean;
  readonly conflictingIds: readonly string[];
}

export interface TruthFreeContextPlan {
  readonly contextId: string;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: AssessmentCapability;
  readonly bundle: null | Readonly<{
    bundleId: string;
    bundleHash: string;
    profileVersion: string;
    rulePackVersion: string;
  }>;
  readonly selection: "legal_bundle" | "no_legal_bundle";
  readonly inputWindow: Readonly<{
    readonly fromTimestampMs: number;
    readonly untilTimestampMs: number;
  }>;
}

export interface TruthFreeSourcePlan {
  readonly sourceCaptureId: string;
  readonly videoRef: string | null;
  readonly contexts: readonly Readonly<TruthFreeContextPlan>[];
}

export type PredictionRunKind = "blind_evaluation" | "full_data_proposal";

export interface TruthFreePlan {
  readonly schemaVersion: "maxpower-motion-quality-truth-free-plan/v1";
  readonly runId: string;
  readonly runKind: PredictionRunKind;
  readonly seed: string;
  readonly planDigest: string;
  readonly sources: readonly Readonly<TruthFreeSourcePlan>[];
}

export interface BuildPlanOptions {
  readonly seed: string;
  readonly runId: string;
  readonly derivativeSourceIdsBySource?: Readonly<Record<string, readonly string[]>>;
}

export type RepDisposition = "confirmed" | "needs_review" | "rejected";
export type QualityProposalState = "proposed" | "abstained";
export type QualityReviewStatus = "unreviewed" | "correct" | "incorrect" | "cannot_judge";

export interface InjectedRepPrediction {
  readonly repId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly turnaroundTimestampMs?: number;
  readonly disposition: RepDisposition;
}

export interface InjectedQualityConclusion {
  readonly conclusionId: string;
  readonly state: QualityProposalState;
  readonly reviewStatus?: QualityReviewStatus;
}

export interface InjectedContextPrediction {
  readonly runKind: PredictionRunKind;
  readonly sourceCaptureId: string;
  readonly contextId: string;
  readonly processing: Readonly<{
    chronologicalMonotonic: true;
    singlePass: true;
    sourceTimestampsMs: readonly number[];
  }>;
  readonly packetHash: string;
  readonly proposalHash: string;
  readonly versions: Readonly<{
    visualModel: string;
    rustEngine: string;
    packetSchema: string;
    profileBundle: string;
    rulePack: string;
  }>;
  readonly reps: readonly InjectedRepPrediction[];
  readonly qualityConclusions: readonly InjectedQualityConclusion[];
}

export interface FrozenPredictionRun {
  readonly schemaVersion: "maxpower-motion-quality-frozen-predictions/v1";
  readonly state: "frozen_before_truth";
  readonly runId: string;
  readonly runKind: PredictionRunKind;
  readonly planDigest: string;
  readonly contexts: readonly Readonly<FrozenContextPrediction>[];
  readonly frozenDigest: string;
}

export interface FrozenContextPrediction extends InjectedContextPrediction {
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: AssessmentCapability;
  readonly bundleHash: string | null;
}

export interface AlignmentMatch {
  readonly truthIndex: number;
  readonly predictedIndex: number;
  readonly startErrorMs: number;
  readonly endErrorMs: number;
  readonly intervalIoU: number;
}

export interface AlignmentMetrics {
  readonly contextCount: number;
  readonly truthCount: number;
  readonly predictedCount: number;
  readonly matchedCount: number;
  readonly falsePositiveCount: number;
  readonly missedCount: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly exactSetRate: number | null;
  readonly meanAbsoluteStartErrorMs: number | null;
  readonly meanAbsoluteEndErrorMs: number | null;
  readonly meanIntervalIoU: number | null;
}

export interface BlindEvaluationContextScore {
  readonly sourceCaptureId: string;
  readonly contextId: string;
  readonly actionId: string;
  readonly capturePosition: string;
  readonly capability: AssessmentCapability;
  readonly truthCount: number;
  readonly predictedCount: number;
  readonly exactSet: boolean;
  readonly matches: readonly Readonly<AlignmentMatch>[];
}

export interface MetricBucket {
  readonly key: string;
  readonly metrics: AlignmentMetrics;
}

export interface BlindEvaluationReport {
  readonly schemaVersion: "maxpower-motion-quality-blind-evaluation/v1";
  readonly runKind: "blind_evaluation";
  readonly runId: string;
  readonly frozenDigest: string;
  readonly truthInventory: Readonly<{
    humanRangeCount: number;
    expectedRepCount: number;
  }>;
  readonly matchingPolicy: Readonly<{
    algorithm: "monotonic_start_end_dynamic_programming";
    minimumIntervalIoU: number;
    maximumBoundaryErrorMs: number;
    forbiddenSignals: readonly ["peak", "midpoint"];
  }>;
  readonly aggregate: AlignmentMetrics;
  readonly buckets: Readonly<{
    byAction: readonly Readonly<MetricBucket>[];
    byView: readonly Readonly<MetricBucket>[];
    byCapability: readonly Readonly<MetricBucket>[];
    byActionViewCapability: readonly Readonly<MetricBucket>[];
  }>;
  readonly contexts: readonly Readonly<BlindEvaluationContextScore>[];
  readonly reportDigest: string;
}

export interface ScoreOptions {
  readonly minimumIntervalIoU?: number;
  readonly maximumBoundaryErrorMs?: number;
}

export interface ReleaseInventory {
  readonly schemaVersion: "maxpower-motion-quality-personal-corpus-release/v1";
  readonly identities: Readonly<{
    blindRunId: string;
    fullDataProposalRunId: string;
    blindFrozenDigest: string;
    fullDataProposalFrozenDigest: string;
  }>;
  readonly inventory: Readonly<{
    uniqueSourceCount: 50;
    contextCount: 54;
    humanRangeCount: 464;
    expectedRepCount: 465;
  }>;
  readonly capabilityCounts: Readonly<Record<AssessmentCapability, number>>;
  readonly blindAlignment: AlignmentMetrics;
  readonly turnaround: Readonly<{
    eligibleRepCount: number;
    proposalCount: number;
    coverage: number | null;
  }>;
  readonly quality: Readonly<{
    conclusionCount: number;
    proposalCount: number;
    abstentionCount: number;
    proposalRate: number | null;
    abstentionRate: number | null;
    reviewStatusCounts: Readonly<Record<QualityReviewStatus, number>>;
  }>;
  readonly releaseDigest: string;
}

export interface BuildReleaseInput {
  readonly truth: PersonalGoldenDataset;
  readonly blindRun: FrozenPredictionRun;
  readonly blindReport: BlindEvaluationReport;
  readonly fullDataProposalRun: FrozenPredictionRun;
}

/**
 * Checks one fitted bundle against the complete identity closure of the held-out
 * source. Fitted ids may contain either raw source ids or derivative ids.
 */
export function validateSourceAwareLeakage(
  targetSourceId: string,
  targetDerivativeSourceIds: readonly string[],
  bundle: ProfileBundle,
): LeakageValidation {
  const targetClosure = new Set([targetSourceId, ...targetDerivativeSourceIds]);
  const fitted = new Set([
    ...bundle.fittedSourceIds,
    ...(bundle.fittedDerivativeSourceIds ?? []),
  ]);
  const conflictingIds = [...targetClosure].filter((id) => fitted.has(id)).sort();
  return Object.freeze({
    valid: conflictingIds.length === 0,
    conflictingIds: Object.freeze(conflictingIds),
  });
}

export function buildTruthFreePlan(
  dataset: PersonalGoldenDataset,
  bundles: readonly ProfileBundle[],
  options: BuildPlanOptions,
): Readonly<TruthFreePlan> {
  return buildPlan(dataset, bundles, options, "blind_evaluation");
}

export function buildFullDataProposalPlan(
  dataset: PersonalGoldenDataset,
  bundles: readonly ProfileBundle[],
  options: BuildPlanOptions,
): Readonly<TruthFreePlan> {
  return buildPlan(dataset, bundles, options, "full_data_proposal");
}

/** Freezes injected client results without loading or accepting formal truth. */
export function freezePredictions(
  plan: TruthFreePlan,
  predictions: readonly InjectedContextPrediction[],
): Readonly<FrozenPredictionRun> {
  assertPlanHasNoFormalTruth(plan);
  const expected = new Map<string, TruthFreeContextPlan>();
  for (const source of plan.sources) {
    for (const context of source.contexts) {
      const key = predictionKey(source.sourceCaptureId, context.contextId);
      if (expected.has(key)) throw new Error(`duplicate planned context ${key}`);
      expected.set(key, context);
    }
  }
  const supplied = new Map<string, InjectedContextPrediction>();
  for (const prediction of predictions) {
    if (prediction.runKind !== plan.runKind) {
      throw new Error(`prediction run kind ${prediction.runKind} does not match ${plan.runKind}`);
    }
    const key = predictionKey(prediction.sourceCaptureId, prediction.contextId);
    const context = expected.get(key);
    if (!context) throw new Error(`prediction has unplanned context ${key}`);
    if (supplied.has(key)) throw new Error(`duplicate prediction context ${key}`);
    assertPredictionIntegrity(prediction, context);
    supplied.set(key, prediction);
  }
  const missing = [...expected.keys()].filter((key) => !supplied.has(key));
  if (missing.length > 0) throw new Error(`missing prediction contexts: ${missing.join(", ")}`);

  const contexts: FrozenContextPrediction[] = plan.sources.flatMap((source) => source.contexts.map((context) => {
    const prediction = supplied.get(predictionKey(source.sourceCaptureId, context.contextId));
    if (!prediction) throw new Error("prediction inventory changed during freeze");
    return {
      ...prediction,
      actionId: context.actionId,
      capturePosition: context.capturePosition,
      capability: context.capability,
      bundleHash: context.bundle?.bundleHash ?? null,
    };
  }));
  const semantic = {
    schemaVersion: "maxpower-motion-quality-frozen-predictions/v1" as const,
    state: "frozen_before_truth" as const,
    runId: plan.runId,
    runKind: plan.runKind,
    planDigest: plan.planDigest,
    contexts,
  };
  return deepFreeze({
    ...semantic,
    frozenDigest: sha256(stableStringify(semantic)),
  });
}

/** Reveals formal range truth only after validating the immutable blind run. */
export function scoreFrozenBlindRun(
  frozen: FrozenPredictionRun,
  truth: PersonalGoldenDataset,
  options: ScoreOptions = {},
): Readonly<BlindEvaluationReport> {
  assertFrozenRun(frozen, "blind_evaluation");
  const minimumIntervalIoU = options.minimumIntervalIoU ?? 0.1;
  const maximumBoundaryErrorMs = options.maximumBoundaryErrorMs ?? 1_500;
  if (!(minimumIntervalIoU >= 0 && minimumIntervalIoU <= 1)) {
    throw new Error("minimumIntervalIoU must be between zero and one");
  }
  if (!Number.isFinite(maximumBoundaryErrorMs) || maximumBoundaryErrorMs < 0) {
    throw new Error("maximumBoundaryErrorMs must be non-negative");
  }
  const truthByContext = new Map<string, PersonalGoldenRecord>();
  for (const record of truth.records) {
    if (truthByContext.has(record.captureId)) throw new Error(`duplicate truth context ${record.captureId}`);
    truthByContext.set(record.captureId, record);
  }
  assertRunCoversTruth(frozen, truth);

  const contexts: BlindEvaluationContextScore[] = frozen.contexts.map((prediction) => {
    const record = truthByContext.get(prediction.contextId);
    if (!record) throw new Error(`truth context missing after freeze: ${prediction.contextId}`);
    const sourceCaptureId = String(record.sourceCaptureId ?? record.captureId);
    if (sourceCaptureId !== prediction.sourceCaptureId
        || record.exerciseId !== prediction.actionId
        || record.capturePosition !== prediction.capturePosition) {
      throw new Error(`${prediction.contextId}: frozen context identity disagrees with revealed truth`);
    }
    const truthRanges = [...(record.segments ?? [])];
    assertChronologicalRanges(truthRanges, `${prediction.contextId}: truth`);
    const predictedRanges = prediction.reps
      .filter((rep) => rep.disposition !== "rejected")
      .map((rep) => ({ startMs: rep.startMs, endMs: rep.endMs }));
    const matches = monotonicStartEndMatches(
      truthRanges,
      predictedRanges,
      minimumIntervalIoU,
      maximumBoundaryErrorMs,
    );
    return {
      sourceCaptureId: prediction.sourceCaptureId,
      contextId: prediction.contextId,
      actionId: prediction.actionId,
      capturePosition: prediction.capturePosition,
      capability: prediction.capability,
      truthCount: truthRanges.length,
      predictedCount: predictedRanges.length,
      exactSet: truthRanges.length === predictedRanges.length,
      matches,
    };
  });
  const aggregate = summarizeContextScores(contexts);
  const semantic = {
    schemaVersion: "maxpower-motion-quality-blind-evaluation/v1" as const,
    runKind: "blind_evaluation" as const,
    runId: frozen.runId,
    frozenDigest: frozen.frozenDigest,
    truthInventory: {
      humanRangeCount: truth.records.reduce((sum, record) => sum + (record.segments?.length ?? 0), 0),
      expectedRepCount: truth.records.reduce((sum, record) => sum + (record.expectedCount ?? 0), 0),
    },
    matchingPolicy: {
      algorithm: "monotonic_start_end_dynamic_programming" as const,
      minimumIntervalIoU,
      maximumBoundaryErrorMs,
      forbiddenSignals: ["peak", "midpoint"] as const,
    },
    aggregate,
    buckets: {
      byAction: bucketScores(contexts, (context) => context.actionId),
      byView: bucketScores(contexts, (context) => context.capturePosition),
      byCapability: bucketScores(contexts, (context) => context.capability),
      byActionViewCapability: bucketScores(
        contexts,
        (context) => `${context.actionId}|${context.capturePosition}|${context.capability}`,
      ),
    },
    contexts,
  };
  return deepFreeze({
    ...semantic,
    reportDigest: sha256(stableStringify(semantic)),
  });
}

/** Builds the ticket-17 inventory; it never turns proposals into a total score. */
export function buildReleaseInventory(
  input: BuildReleaseInput,
): Readonly<ReleaseInventory> {
  assertFrozenRun(input.blindRun, "blind_evaluation");
  assertFrozenRun(input.fullDataProposalRun, "full_data_proposal");
  if (input.blindRun.runId === input.fullDataProposalRun.runId) {
    throw new Error("blind and full_data_proposal run identities must be distinct");
  }
  assertBlindReport(input.blindReport, input.blindRun);

  const uniqueSourceCount = new Set(input.truth.records.map(
    (record) => String(record.sourceCaptureId ?? record.captureId),
  )).size;
  const contextCount = input.truth.records.length;
  const humanRangeCount = input.truth.records.reduce(
    (sum, record) => sum + (record.segments?.length ?? 0),
    0,
  );
  const expectedRepCount = input.truth.records.reduce(
    (sum, record) => sum + (record.expectedCount ?? 0),
    0,
  );
  if (uniqueSourceCount !== 50
      || contextCount !== 54
      || humanRangeCount !== 464
      || expectedRepCount !== 465) {
    throw new Error(
      `personal corpus inventory mismatch: ${uniqueSourceCount} sources, ${contextCount} contexts, ${humanRangeCount} ranges, ${expectedRepCount} expected`,
    );
  }
  assertRunCoversTruth(input.blindRun, input.truth);
  assertRunCoversTruth(input.fullDataProposalRun, input.truth);

  const fullReps = input.fullDataProposalRun.contexts.flatMap((context) =>
    context.reps.filter((rep) => rep.disposition !== "rejected"));
  const turnaroundProposalCount = fullReps.filter(
    (rep) => rep.turnaroundTimestampMs !== undefined,
  ).length;
  const conclusions = input.fullDataProposalRun.contexts.flatMap(
    (context) => context.qualityConclusions,
  );
  const qualityProposalCount = conclusions.filter(
    (conclusion) => conclusion.state === "proposed",
  ).length;
  const qualityAbstentionCount = conclusions.filter(
    (conclusion) => conclusion.state === "abstained",
  ).length;
  const reviewStatusCounts: Record<QualityReviewStatus, number> = {
    unreviewed: 0,
    correct: 0,
    incorrect: 0,
    cannot_judge: 0,
  };
  for (const conclusion of conclusions) {
    reviewStatusCounts[conclusion.reviewStatus ?? "unreviewed"] += 1;
  }
  const capabilityCounts: Record<AssessmentCapability, number> = {
    quality_supported: 0,
    phase_supported: 0,
    observation_only: 0,
    unsupported: 0,
  };
  for (const context of input.fullDataProposalRun.contexts) {
    capabilityCounts[context.capability] += 1;
  }

  const semantic = {
    schemaVersion: "maxpower-motion-quality-personal-corpus-release/v1" as const,
    identities: {
      blindRunId: input.blindRun.runId,
      fullDataProposalRunId: input.fullDataProposalRun.runId,
      blindFrozenDigest: input.blindRun.frozenDigest,
      fullDataProposalFrozenDigest: input.fullDataProposalRun.frozenDigest,
    },
    inventory: {
      uniqueSourceCount: 50 as const,
      contextCount: 54 as const,
      humanRangeCount: 464 as const,
      expectedRepCount: 465 as const,
    },
    capabilityCounts,
    blindAlignment: input.blindReport.aggregate,
    turnaround: {
      eligibleRepCount: fullReps.length,
      proposalCount: turnaroundProposalCount,
      coverage: ratio(turnaroundProposalCount, fullReps.length),
    },
    quality: {
      conclusionCount: conclusions.length,
      proposalCount: qualityProposalCount,
      abstentionCount: qualityAbstentionCount,
      proposalRate: ratio(qualityProposalCount, conclusions.length),
      abstentionRate: ratio(qualityAbstentionCount, conclusions.length),
      reviewStatusCounts,
    },
  };
  return deepFreeze({
    ...semantic,
    releaseDigest: sha256(stableStringify(semantic)),
  });
}

function assertBlindReport(
  report: BlindEvaluationReport,
  frozen: FrozenPredictionRun,
): void {
  if (report.schemaVersion !== "maxpower-motion-quality-blind-evaluation/v1"
      || report.runKind !== "blind_evaluation"
      || report.runId !== frozen.runId
      || report.frozenDigest !== frozen.frozenDigest) {
    throw new Error("blind report identity does not match the frozen blind run");
  }
  const { reportDigest, ...semantic } = report;
  if (sha256(stableStringify(semantic)) !== reportDigest) {
    throw new Error("blind report digest mismatch");
  }
}

function assertRunCoversTruth(
  run: FrozenPredictionRun,
  truth: PersonalGoldenDataset,
): void {
  const expected = new Set(truth.records.map((record) => predictionKey(
    String(record.sourceCaptureId ?? record.captureId),
    record.captureId,
  )));
  const actual = new Set(run.contexts.map((context) => predictionKey(
    context.sourceCaptureId,
    context.contextId,
  )));
  if (actual.size !== run.contexts.length
      || actual.size !== expected.size
      || [...expected].some((key) => !actual.has(key))) {
    throw new Error(`${run.runKind} does not cover the complete truth inventory`);
  }
}

function monotonicStartEndMatches(
  truth: readonly Pick<PersonalGoldenSegment, "startMs" | "endMs">[],
  predicted: readonly Pick<InjectedRepPrediction, "startMs" | "endMs">[],
  minimumIntervalIoU: number,
  maximumBoundaryErrorMs: number,
): AlignmentMatch[] {
  interface Solution {
    matches: AlignmentMatch[];
    totalIoU: number;
    totalBoundaryError: number;
  }
  const memo = new Map<string, Solution>();
  const solve = (truthIndex: number, predictedIndex: number): Solution => {
    const key = `${truthIndex}:${predictedIndex}`;
    const cached = memo.get(key);
    if (cached) return cached;
    if (truthIndex >= truth.length || predictedIndex >= predicted.length) {
      return { matches: [], totalIoU: 0, totalBoundaryError: 0 };
    }
    const options: Solution[] = [
      solve(truthIndex + 1, predictedIndex),
      solve(truthIndex, predictedIndex + 1),
    ];
    const expected = truth[truthIndex];
    const actual = predicted[predictedIndex];
    const intervalIoU = rangeIoU(expected, actual);
    const startErrorMs = actual.startMs - expected.startMs;
    const endErrorMs = actual.endMs - expected.endMs;
    const eligible = intervalIoU >= minimumIntervalIoU
      || (Math.abs(startErrorMs) <= maximumBoundaryErrorMs
        && Math.abs(endErrorMs) <= maximumBoundaryErrorMs);
    if (eligible) {
      const remainder = solve(truthIndex + 1, predictedIndex + 1);
      options.push({
        matches: [{ truthIndex, predictedIndex, startErrorMs, endErrorMs, intervalIoU }, ...remainder.matches],
        totalIoU: intervalIoU + remainder.totalIoU,
        totalBoundaryError: Math.abs(startErrorMs) + Math.abs(endErrorMs)
          + remainder.totalBoundaryError,
      });
    }
    const best = options.reduce((left, right) => betterSolution(left, right));
    memo.set(key, best);
    return best;
  };
  return solve(0, 0).matches;
}

function betterSolution(left: {
  matches: AlignmentMatch[];
  totalIoU: number;
  totalBoundaryError: number;
}, right: {
  matches: AlignmentMatch[];
  totalIoU: number;
  totalBoundaryError: number;
}): typeof left {
  if (left.matches.length !== right.matches.length) {
    return left.matches.length > right.matches.length ? left : right;
  }
  if (Math.abs(left.totalIoU - right.totalIoU) > 1e-12) {
    return left.totalIoU > right.totalIoU ? left : right;
  }
  return left.totalBoundaryError <= right.totalBoundaryError ? left : right;
}

function rangeIoU(
  left: Pick<PersonalGoldenSegment, "startMs" | "endMs">,
  right: Pick<InjectedRepPrediction, "startMs" | "endMs">,
): number {
  const intersection = Math.max(0, Math.min(left.endMs, right.endMs) - Math.max(left.startMs, right.startMs));
  const union = Math.max(left.endMs, right.endMs) - Math.min(left.startMs, right.startMs);
  return union > 0 ? intersection / union : 0;
}

function summarizeContextScores(contexts: readonly BlindEvaluationContextScore[]): AlignmentMetrics {
  const truthCount = contexts.reduce((sum, context) => sum + context.truthCount, 0);
  const predictedCount = contexts.reduce((sum, context) => sum + context.predictedCount, 0);
  const matches = contexts.flatMap((context) => context.matches);
  return {
    contextCount: contexts.length,
    truthCount,
    predictedCount,
    matchedCount: matches.length,
    falsePositiveCount: predictedCount - matches.length,
    missedCount: truthCount - matches.length,
    precision: ratio(matches.length, predictedCount),
    recall: ratio(matches.length, truthCount),
    exactSetRate: ratio(contexts.filter((context) => context.exactSet).length, contexts.length),
    meanAbsoluteStartErrorMs: mean(matches.map((match) => Math.abs(match.startErrorMs))),
    meanAbsoluteEndErrorMs: mean(matches.map((match) => Math.abs(match.endErrorMs))),
    meanIntervalIoU: mean(matches.map((match) => match.intervalIoU)),
  };
}

function bucketScores(
  contexts: readonly BlindEvaluationContextScore[],
  keyFor: (context: BlindEvaluationContextScore) => string,
): MetricBucket[] {
  const grouped = new Map<string, BlindEvaluationContextScore[]>();
  for (const context of contexts) {
    const key = keyFor(context);
    const rows = grouped.get(key) ?? [];
    rows.push(context);
    grouped.set(key, rows);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, rows]) => ({ key, metrics: summarizeContextScores(rows) }));
}

function assertChronologicalRanges(
  ranges: readonly Pick<PersonalGoldenSegment, "startMs" | "endMs">[],
  label: string,
): void {
  let previousStart = -1;
  for (const range of ranges) {
    if (!Number.isFinite(range.startMs) || !Number.isFinite(range.endMs)
        || range.startMs < 0 || range.endMs <= range.startMs || range.startMs < previousStart) {
      throw new Error(`${label} ranges must be chronological and valid`);
    }
    previousStart = range.startMs;
  }
}

function assertFrozenRun(
  frozen: FrozenPredictionRun,
  expectedKind: PredictionRunKind,
): void {
  if (frozen.schemaVersion !== "maxpower-motion-quality-frozen-predictions/v1"
      || frozen.state !== "frozen_before_truth") {
    throw new Error("prediction run is not frozen before truth reveal");
  }
  if (frozen.runKind !== expectedKind) {
    throw new Error(`${frozen.runKind} cannot be used as ${expectedKind}`);
  }
  const { frozenDigest, ...semantic } = frozen;
  const actualDigest = sha256(stableStringify(semantic));
  if (actualDigest !== frozenDigest) throw new Error("frozen prediction digest mismatch");
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildPlan(
  dataset: PersonalGoldenDataset,
  bundles: readonly ProfileBundle[],
  options: BuildPlanOptions,
  runKind: PredictionRunKind,
): Readonly<TruthFreePlan> {
  requireNonEmpty(options.seed, "seed");
  requireNonEmpty(options.runId, "runId");
  const bySource = new Map<string, { videoRef: string | null; contexts: TruthFreeContextPlan[] }>();

  for (const record of dataset.records) {
    const sourceCaptureId = String(record.sourceCaptureId ?? record.captureId);
    requireNonEmpty(sourceCaptureId, "sourceCaptureId");
    const source = bySource.get(sourceCaptureId) ?? {
      videoRef: record.source?.video ?? null,
      contexts: [],
    };
    const candidates = bundles
      .filter((bundle) => bundle.actionId === record.exerciseId
        && bundle.capturePosition === record.capturePosition
        && (!bundle.eligibleTargetSourceIds
          || bundle.eligibleTargetSourceIds.includes(sourceCaptureId)))
      .sort((left, right) => left.bundleId.localeCompare(right.bundleId));
    const targetDerivatives = options.derivativeSourceIdsBySource?.[sourceCaptureId] ?? [];
    const selected = candidates.find((bundle) => runKind === "full_data_proposal"
      || validateSourceAwareLeakage(sourceCaptureId, targetDerivatives, bundle).valid);
    const inputWindow = {
      fromTimestampMs: record.evaluationWindow?.startMs ?? 0,
      untilTimestampMs: record.evaluationWindow?.endMs
        ?? record.source?.durationMs
        ?? 0,
    };
    source.contexts.push(selected ? {
      contextId: record.captureId,
      actionId: record.exerciseId,
      capturePosition: record.capturePosition,
      capability: selected.capability,
      bundle: {
        bundleId: selected.bundleId,
        bundleHash: selected.bundleHash,
        profileVersion: selected.versions.profile,
        rulePackVersion: selected.versions.rulePack,
      },
      selection: "legal_bundle",
      inputWindow,
    } : {
      contextId: record.captureId,
      actionId: record.exerciseId,
      capturePosition: record.capturePosition,
      capability: "unsupported",
      bundle: null,
      selection: "no_legal_bundle",
      inputWindow,
    });
    bySource.set(sourceCaptureId, source);
  }

  const sources = seededShuffle(
    [...bySource.entries()].map(([sourceCaptureId, value]) => ({
      sourceCaptureId,
      videoRef: value.videoRef,
      contexts: value.contexts.sort((left, right) => left.contextId.localeCompare(right.contextId)),
    })),
    options.seed,
  );
  const semantic = {
    schemaVersion: "maxpower-motion-quality-truth-free-plan/v1" as const,
    runId: options.runId,
    runKind,
    seed: options.seed,
    sources,
  };
  const plan: TruthFreePlan = {
    ...semantic,
    planDigest: sha256(stableStringify(semantic)),
  };
  assertPlanHasNoFormalTruth(plan);
  return deepFreeze(plan);
}

function assertPlanHasNoFormalTruth(plan: TruthFreePlan): void {
  const forbidden = new Set([
    "expectedCount",
    "segments",
    "startMs",
    "endMs",
    "peakMs",
    "turnaround",
    "review",
  ]);
  const visit = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.has(key)) throw new Error(`formal truth field ${path}.${key} is forbidden`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(plan, "$");
}

function assertPredictionIntegrity(
  prediction: InjectedContextPrediction,
  context: TruthFreeContextPlan,
): void {
  if (prediction.processing.chronologicalMonotonic !== true
      || prediction.processing.singlePass !== true) {
    throw new Error(`${prediction.contextId}: prediction is not marked chronological single pass`);
  }
  const timestamps = prediction.processing.sourceTimestampsMs;
  if (timestamps.length === 0
      || timestamps.some((timestamp, index) => !Number.isSafeInteger(timestamp)
        || timestamp < 0
        || (index > 0 && timestamp <= timestamps[index - 1]))) {
    throw new Error(`${prediction.contextId}: strictly increasing source timestamps are required`);
  }
  requireSha256(prediction.packetHash, "packetHash");
  requireSha256(prediction.proposalHash, "proposalHash");
  for (const [key, value] of Object.entries(prediction.versions)) {
    requireNonEmpty(value, `versions.${key}`);
  }
  const expectedProfile = context.bundle?.profileVersion ?? "none";
  const expectedRulePack = context.bundle?.rulePackVersion ?? "none";
  if (prediction.versions.profileBundle !== expectedProfile
      || prediction.versions.rulePack !== expectedRulePack) {
    throw new Error(`${prediction.contextId}: prediction versions do not match planned bundle`);
  }
  let previousStart = -1;
  for (const rep of prediction.reps) {
    if (!Number.isFinite(rep.startMs) || !Number.isFinite(rep.endMs)
        || rep.startMs < 0 || rep.endMs <= rep.startMs || rep.startMs < previousStart) {
      throw new Error(`${prediction.contextId}: rep intervals must be chronological and valid`);
    }
    if (rep.turnaroundTimestampMs !== undefined
        && (!Number.isFinite(rep.turnaroundTimestampMs)
          || rep.turnaroundTimestampMs < rep.startMs
          || rep.turnaroundTimestampMs > rep.endMs)) {
      throw new Error(`${prediction.contextId}: turnaround must lie inside its predicted interval`);
    }
    previousStart = rep.startMs;
  }
  const conclusionIds = new Set<string>();
  for (const conclusion of prediction.qualityConclusions) {
    requireNonEmpty(conclusion.conclusionId, "conclusionId");
    if (conclusionIds.has(conclusion.conclusionId)) {
      throw new Error(`${prediction.contextId}: duplicate quality conclusion id`);
    }
    conclusionIds.add(conclusion.conclusionId);
  }
}

function predictionKey(sourceCaptureId: string, contextId: string): string {
  return `${sourceCaptureId}\u0000${contextId}`;
}

function seededShuffle<T>(values: readonly T[], seed: string): T[] {
  const output = [...values];
  let state = createHash("sha256").update(seed).digest().readUInt32LE(0) || 0x9e37_79b9;
  const random = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
  for (let index = output.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(random() * (index + 1));
    [output[index], output[replacement]] = [output[replacement], output[index]];
  }
  return output;
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

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) throw new Error(`${field} must be non-empty`);
}

function requireSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error(`${field} must be a SHA-256 hex digest`);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
