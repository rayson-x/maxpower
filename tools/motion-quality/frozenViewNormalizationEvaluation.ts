import { createHash } from "node:crypto";
import type {
  DecodedLocalMotionCoordinate,
  DecodedMotionPacket,
  DecodedRepEndpointSnapshot,
} from "../../src/motion/motionPacket.js";

export type FrozenEvaluationRunKind =
  | "touched_benchmark"
  | "untouched_model_acceptance"
  | "synchronized_cross_view_validation";

export type FrozenEvaluationView =
  | "front"
  | "front_oblique_left"
  | "front_oblique_right";

export type EvaluationCondition =
  | "mirror"
  | "bar_occlusion"
  | "wrist_forearm_occlusion"
  | "competing_reflection_person"
  | "camera_roll"
  | "crop_change"
  | "orientation_change";

export type EvaluationBucketKey =
  | `view:${FrozenEvaluationView}`
  | `condition:${EvaluationCondition}`
  | `confidence:${"high" | "medium" | "low" | "unavailable"}`;

export interface FrozenEvaluationInferencePack {
  readonly schemaVersion: "maxpower-view-normalization-inference-pack/v1";
  readonly runId: string;
  readonly runKind: FrozenEvaluationRunKind;
  readonly processingContract: Readonly<{
    chronologicalSinglePass: true;
    rewindsAllowed: false;
    futureFramesAllowed: false;
  }>;
  readonly preregistration: Readonly<{
    profileVersion: string;
    baselineProfileVersion: string;
    coordinateVersion: string;
    reportCodeVersion: string;
    endpointToleranceMs: number;
    matchingToleranceMs: number;
  }>;
  readonly sourceLineage: Readonly<{
    targetSourceIds: readonly string[];
    profileFitSourceIds: readonly string[];
    profileFitDerivativeSourceIds?: readonly string[];
    thresholdSelectionSourceIds: readonly string[];
    thresholdSelectionDerivativeSourceIds?: readonly string[];
    manuallyInspectedSourceIds: readonly string[];
    manuallyInspectedDerivativeSourceIds?: readonly string[];
    targetDerivativeSourceIds?: readonly string[];
  }>;
  readonly contexts: readonly Readonly<{
    contextId: string;
    sourceCaptureId: string;
    actionId: string;
    view: FrozenEvaluationView;
    conditions: readonly EvaluationCondition[];
  }>[];
}

export type ClientRepPhase = "ready" | "effort" | "peak" | "return" | "frozen";

export interface ClientSealedRepPrediction {
  readonly repId: string;
  readonly startMs: number;
  readonly turnaroundMs: number;
  readonly endMs: number;
  readonly disposition: "confirmed" | "needs_review" | "rejected";
  readonly rawScreenYRom?: number;
  readonly normalizedFacts?: unknown;
}

export interface ClientRustOutputProjection {
  readonly packetHash: string;
  readonly phase: ClientRepPhase;
  readonly sealedReps: readonly Readonly<ClientSealedRepPrediction>[];
  /** Additive Ticket 04 decoder output. Older packets leave this absent. */
  readonly normalizedFacts?: unknown;
}

export type DecodedNormalizedFacts =
  | Readonly<{
      status: "unavailable";
      reason: "normalized_fields_not_present" | "normalized_fields_invalid";
    }>
  | Readonly<{
      status: "available";
      coordinateVersion: string;
      frameState: "provisional" | "learning" | "frozen" | "degraded";
      alongAxisProgress: number;
      crossAxisDisplacement: number | null;
      endpointResidual: number | null;
      confidence: number;
    }>;

export interface GeometryInvarianceTrace {
  readonly phaseSequence: readonly ClientRepPhase[];
  readonly repEndpointsMs: readonly Readonly<{
    startMs: number;
    turnaroundMs: number;
    endMs: number;
  }>[];
  readonly rawScreenY: readonly number[];
  readonly normalizedAlongAxis?: readonly number[];
  readonly normalizedCrossAxis?: readonly number[];
}

export interface GeometryInvarianceInput {
  readonly sourceId: string;
  readonly original: Readonly<GeometryInvarianceTrace>;
  readonly transforms: readonly Readonly<{
    transformId: string;
    transform: Readonly<{
      rotationDegrees: number;
      translateX: number;
      translateY: number;
      uniformScale: number;
    }>;
    output: Readonly<GeometryInvarianceTrace>;
  }>[];
}

export interface GeometryInvarianceReport {
  readonly schemaVersion: "maxpower-view-normalization-geometry-invariance/v1";
  readonly sourceId: string;
  readonly normalizedFactsStatus: "available" | "unavailable";
  readonly transforms: readonly Readonly<{
    transformId: string;
    transform: GeometryInvarianceInput["transforms"][number]["transform"];
    discreteRepPhaseInvariant: boolean;
    rawScreenYMaximumAbsoluteError: number;
    normalizedAlongAxisMaximumAbsoluteError: number | null;
    normalizedCrossAxisMaximumAbsoluteError: number | null;
  }>[];
}

export interface GeometryRawPoint2d {
  readonly x: number;
  readonly y: number;
}

export interface GeometryRawObservationInput {
  readonly frames: readonly Readonly<{
    readonly frameId: number;
    readonly sourceTimestampMs: number;
    readonly points: Readonly<Record<string, Readonly<GeometryRawPoint2d> | null>>;
  }>[];
}

export interface GeometryInvarianceRawInput {
  readonly sourceId: string;
  readonly original: Readonly<GeometryRawObservationInput>;
  readonly transforms: readonly Readonly<{
    transformId: string;
    transform: GeometryInvarianceInput["transforms"][number]["transform"];
  }>[];
  /** Runs the same causal projection for the original and every transformed input. */
  readonly run: (
    input: Readonly<GeometryRawObservationInput>,
  ) => Readonly<GeometryInvarianceTrace>;
}

/** Compares independently produced transformed outputs; it does not normalize traces itself. */
export function evaluateSyntheticGeometryInvariance(
  input: GeometryInvarianceInput,
): Readonly<GeometryInvarianceReport> {
  assertTrace(input.original, "original");
  const normalizedAvailable = input.original.normalizedAlongAxis !== undefined
    && input.original.normalizedCrossAxis !== undefined;
  const transforms = input.transforms.map((entry) => {
    assertTrace(entry.output, entry.transformId);
    if (!Number.isFinite(entry.transform.rotationDegrees)
        || !Number.isFinite(entry.transform.translateX)
        || !Number.isFinite(entry.transform.translateY)
        || !Number.isFinite(entry.transform.uniformScale)
        || entry.transform.uniformScale <= 0) {
      throw new Error(`${entry.transformId}: invalid synthetic transform`);
    }
    const outputNormalized = entry.output.normalizedAlongAxis !== undefined
      && entry.output.normalizedCrossAxis !== undefined;
    return {
      transformId: entry.transformId,
      transform: cloneJson(entry.transform),
      discreteRepPhaseInvariant: stableStringify(entry.output.phaseSequence)
          === stableStringify(input.original.phaseSequence)
        && stableStringify(entry.output.repEndpointsMs)
          === stableStringify(input.original.repEndpointsMs),
      rawScreenYMaximumAbsoluteError: maximumAbsoluteError(
        input.original.rawScreenY,
        entry.output.rawScreenY,
      ),
      normalizedAlongAxisMaximumAbsoluteError: normalizedAvailable && outputNormalized
        ? maximumAbsoluteError(
            input.original.normalizedAlongAxis!,
            entry.output.normalizedAlongAxis!,
          )
        : null,
      normalizedCrossAxisMaximumAbsoluteError: normalizedAvailable && outputNormalized
        ? maximumAbsoluteError(
            input.original.normalizedCrossAxis!,
            entry.output.normalizedCrossAxis!,
          )
        : null,
    };
  });
  return deepFreeze({
    schemaVersion: "maxpower-view-normalization-geometry-invariance/v1",
    sourceId: input.sourceId,
    normalizedFactsStatus: normalizedAvailable ? "available" : "unavailable",
    transforms,
  });
}

/**
 * Applies each preregistered transform to raw 2D observations, then invokes
 * the same runner again. This prevents a geometry case from supplying its own
 * expected normalized output and accidentally passing by construction.
 */
export function evaluateSyntheticGeometryInvarianceFromRawInput(
  input: GeometryInvarianceRawInput,
): Readonly<GeometryInvarianceReport> {
  assertRawGeometryInput(input.original, "original");
  const original = input.run(deepFreeze(cloneJson(input.original)));
  return evaluateSyntheticGeometryInvariance({
    sourceId: input.sourceId,
    original,
    transforms: input.transforms.map((entry) => ({
      transformId: entry.transformId,
      transform: cloneJson(entry.transform),
      output: input.run(transformRawGeometryInput(input.original, entry.transform)),
    })),
  });
}

/**
 * Reads Ticket 04's additive decoded facts without fabricating a fallback from
 * screen-y when an older packet does not contain them.
 */
export function adaptOptionalDecodedNormalizedFacts(value: unknown): DecodedNormalizedFacts {
  if (value === undefined || value === null) {
    return Object.freeze({
      status: "unavailable",
      reason: "normalized_fields_not_present",
    });
  }
  if (!value || typeof value !== "object") return invalidNormalizedFacts();
  const candidate = value as Record<string, unknown>;
  // Canonical decoded MotionPacket shape. Prefer measured equipment, but keep
  // a valid pose-only channel observable; neither is rebuilt from screen-y.
  if (candidate.schemaVersion === "maxpower-local-motion-coordinate/v1") {
    const frameState = candidate.state;
    const channelCandidate = candidate.equipment ?? candidate.pose;
    if ((frameState !== "uninitialized" && frameState !== "provisional"
        && frameState !== "learning" && frameState !== "frozen" && frameState !== "degraded")
        || candidate.endpointOrderMapping !== "screen_ordered_anatomy_unknown"
        || !finiteNumber(candidate.confidence)
        || candidate.confidence < 0 || candidate.confidence > 1) {
      return invalidNormalizedFacts();
    }
    if (!channelCandidate || typeof channelCandidate !== "object") {
      return Object.freeze({ status: "unavailable", reason: "normalized_fields_not_present" });
    }
    const channel = channelCandidate as Record<string, unknown>;
    if (!finiteNumber(channel.alongAxisProgress)
        || !finiteNumber(channel.crossAxisDisplacement)
        || !unitInterval(channel.confidence)
        || !unitInterval(channel.coverage)
        || !unitInterval(channel.uncertainty)) {
      return invalidNormalizedFacts();
    }
    return Object.freeze({
      status: "available",
      coordinateVersion: candidate.schemaVersion,
      frameState: frameState === "uninitialized" ? "provisional" : frameState,
      alongAxisProgress: channel.alongAxisProgress,
      crossAxisDisplacement: channel.crossAxisDisplacement,
      endpointResidual: null,
      confidence: candidate.confidence,
    });
  }
  const frameState = candidate.frameState;
  if (typeof candidate.coordinateVersion !== "string" || !candidate.coordinateVersion
      || (frameState !== "provisional" && frameState !== "learning"
        && frameState !== "frozen" && frameState !== "degraded")
      || !finiteNumber(candidate.alongAxisProgress)
      || !nullableFiniteNumber(candidate.crossAxisDisplacement)
      || !nullableFiniteNumber(candidate.endpointResidual)
      || !finiteNumber(candidate.confidence)
      || candidate.confidence < 0 || candidate.confidence > 1) {
    return invalidNormalizedFacts();
  }
  return Object.freeze({
    status: "available",
    coordinateVersion: candidate.coordinateVersion,
    frameState,
    alongAxisProgress: candidate.alongAxisProgress,
    crossAxisDisplacement: candidate.crossAxisDisplacement ?? null,
    endpointResidual: candidate.endpointResidual ?? null,
    confidence: candidate.confidence,
  });
}

type DecodedRustCanonicalPacketProjectionSource = Pick<DecodedMotionPacket,
  "frameId" | "sourceTimestampMs" | "repState" | "completedReps"
  | "localMotionCoordinate" | "qualityProposals">;

/**
 * Projects the real `decodeMotionPacket` result into the frozen evaluator's
 * stable compatibility shape. Rep endpoint facts come only from Rust quality
 * proposal snapshots; absent snapshots remain absent.
 */
export function adaptDecodedRustCanonicalPacket(
  packet: Readonly<DecodedRustCanonicalPacketProjectionSource>,
  packetHash: string,
): Readonly<ClientRustOutputProjection> {
  if (!/^[a-f0-9]{64}$/u.test(packetHash)) {
    throw new Error("decoded Rust canonical packet hash must be sha256");
  }
  const proposals = new Map(packet.qualityProposals.map((proposal) => [
    String(proposal.repId),
    proposal,
  ]));
  const sealedReps = packet.completedReps.map((rep): ClientSealedRepPrediction => {
    const proposal = proposals.get(rep.repId.toString());
    const endpoints = proposal?.endpoints ?? [];
    const normalizedFacts = normalizedFactsFromEndpointSnapshots(endpoints);
    const rawScreenYRom = rawScreenYRomFromEndpointSnapshots(endpoints);
    return {
      repId: rep.repId.toString(),
      startMs: safeBigIntTimestamp(rep.startTimestampMs, "rep start timestamp"),
      turnaroundMs: safeBigIntTimestamp(rep.peakTimestampMs, "rep turnaround timestamp"),
      endMs: safeBigIntTimestamp(rep.endTimestampMs, "rep end timestamp"),
      disposition: rep.disposition,
      ...(rawScreenYRom === null ? {} : { rawScreenYRom }),
      ...(normalizedFacts === null ? {} : { normalizedFacts }),
    };
  });
  return deepFreeze({
    packetHash,
    phase: packet.repState.phase,
    sealedReps,
    ...(packet.localMotionCoordinate === null
      ? {}
      : { normalizedFacts: packet.localMotionCoordinate }),
  });
}

export interface ClientCausalEvaluationFrame {
  readonly frameId: number;
  readonly sourceTimestampMs: number;
  readonly inputObservationHash: string;
  readonly candidate: Readonly<ClientRustOutputProjection>;
  readonly baseline: Readonly<ClientRustOutputProjection>;
}

export interface FrozenViewNormalizationPrediction {
  readonly schemaVersion: "maxpower-view-normalization-frozen-prediction/v1";
  readonly state: "frozen_before_truth";
  readonly runId: string;
  readonly runKind: FrozenEvaluationRunKind;
  readonly profileVersion: string;
  readonly baselineProfileVersion: string;
  readonly coordinateVersion: string;
  readonly inferencePackHash: string;
  readonly sourceLineage: FrozenEvaluationInferencePack["sourceLineage"];
  readonly contexts: readonly Readonly<{
    contextId: string;
    sourceCaptureId: string;
    actionId: string;
    view: FrozenEvaluationView;
    conditions: readonly EvaluationCondition[];
    frames: readonly Readonly<ClientCausalEvaluationFrame>[];
  }>[];
  readonly inputHash: string;
  readonly predictionHash: string;
}

/**
 * Creates a new, explicitly touched run after any truth inspection or tuning.
 * It never preserves an untouched acceptance identity across that boundary.
 */
export function createPostRevealTouchedRerun(
  prior: FrozenEvaluationInferencePack,
  input: Readonly<{
    runId: string;
    preregistration: FrozenEvaluationInferencePack["preregistration"];
  }>,
): Readonly<FrozenEvaluationInferencePack> {
  if (!input.runId || input.runId === prior.runId) {
    throw new Error("post-reveal tuning requires a new run id");
  }
  const sourceLineage = {
    ...cloneJson(prior.sourceLineage),
    thresholdSelectionSourceIds: uniqueStrings([
      ...prior.sourceLineage.thresholdSelectionSourceIds,
      ...prior.sourceLineage.targetSourceIds,
    ]),
    thresholdSelectionDerivativeSourceIds: uniqueStrings([
      ...(prior.sourceLineage.thresholdSelectionDerivativeSourceIds ?? []),
      ...(prior.sourceLineage.targetDerivativeSourceIds ?? []),
    ]),
    manuallyInspectedSourceIds: uniqueStrings([
      ...prior.sourceLineage.manuallyInspectedSourceIds,
      ...prior.sourceLineage.targetSourceIds,
    ]),
    manuallyInspectedDerivativeSourceIds: uniqueStrings([
      ...(prior.sourceLineage.manuallyInspectedDerivativeSourceIds ?? []),
      ...(prior.sourceLineage.targetDerivativeSourceIds ?? []),
    ]),
  };
  const rerun: FrozenEvaluationInferencePack = {
    ...cloneJson(prior),
    runId: input.runId,
    runKind: "touched_benchmark",
    preregistration: cloneJson(input.preregistration),
    sourceLineage,
  };
  assertInferencePack(rerun);
  return deepFreeze(rerun);
}

export interface RevealedEvaluationTruth {
  readonly schemaVersion: "maxpower-view-normalization-revealed-truth/v1";
  readonly contexts: readonly Readonly<{
    contextId: string;
    sourceCaptureId: string;
    actionId: string;
    view: FrozenEvaluationView;
    reps: readonly Readonly<RevealedTruthRep>[];
  }>[];
}

export interface SynchronizedFrontReference {
  readonly turnaroundMs: number;
  readonly rawScreenYRom: number;
  readonly normalizedRom: number;
  readonly crossPath: number;
  readonly endpointResidual: number;
}

export interface RevealedTruthRep {
  readonly repId: string;
  readonly startMs: number;
  readonly turnaroundMs: number;
  readonly endMs: number;
  readonly synchronizedFrontReference?: Readonly<SynchronizedFrontReference>;
}

export interface EndpointAlignmentMetrics {
  readonly truthCount: number;
  readonly predictedCount: number;
  readonly matchedCount: number;
  readonly rejectedCount: number;
  readonly abstentionCount: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly exactSetRate: number | null;
  readonly startMeanAbsoluteErrorMs: number | null;
  readonly turnaroundMeanAbsoluteErrorMs: number | null;
  readonly endMeanAbsoluteErrorMs: number | null;
  readonly fullEndpointAlignmentRate: number | null;
  readonly coverage: number | null;
}

export interface FrozenViewNormalizationEvaluationReport {
  readonly schemaVersion: "maxpower-view-normalization-evaluation-report/v1";
  readonly runId: string;
  readonly runKind: FrozenEvaluationRunKind;
  readonly inputHash: string;
  readonly predictionHash: string;
  readonly aggregate: Readonly<{
    candidate: EndpointAlignmentMetrics;
    baseline: EndpointAlignmentMetrics;
  }>;
  readonly crossView: CrossViewMetrics;
  readonly buckets: readonly Readonly<{
    key: EvaluationBucketKey;
    candidate: EndpointAlignmentMetrics;
    baseline: EndpointAlignmentMetrics;
  }>[];
  readonly worstBucket: Readonly<{
    key: EvaluationBucketKey;
    candidate: EndpointAlignmentMetrics;
    baseline: EndpointAlignmentMetrics;
  }> | null;
  readonly promotion: Readonly<{
    eligible: boolean;
    reasons: readonly string[];
    gates: Readonly<{
      precisionAtLeast95: boolean;
      recallAtLeast95: boolean;
      fullEndpointAlignmentAtLeast95: boolean;
      candidateNonInferiorToBaseline: boolean;
      candidateNonInferiorInEveryBucket: boolean;
      normalizedCrossViewImprovesOnRawScreenY: boolean;
    }>;
  }>;
  readonly reportHash: string;
}

export type CrossViewMetrics =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{
      status: "unavailable";
      reason: "normalized_fields_not_present";
      pairedRepCount: number;
      normalizedCoverage: number;
      abstentionCount: number;
    }>
  | Readonly<{
      status: "available";
      pairedRepCount: number;
      turnaroundMeanAbsoluteErrorMs: number | null;
      rawScreenYRomMeanAbsoluteDisagreement: number | null;
      normalizedRomMeanAbsoluteDisagreement: number | null;
      normalizedCrossPathMeanAbsoluteDisagreement: number | null;
      normalizedEndpointResidualMeanAbsoluteDisagreement: number | null;
      normalizedCoverage: number;
      abstentionCount: number;
    }>;

/**
 * Collects the same chronological client-format evidence a realtime client
 * sends to Rust. Human truth is deliberately absent from this interface.
 */
export class FrozenViewNormalizationEvaluationSession {
  private readonly framesByContext = new Map<string, ClientCausalEvaluationFrame[]>();
  private frozen = false;

  constructor(private readonly pack: FrozenEvaluationInferencePack) {
    assertInferencePack(pack);
    for (const context of pack.contexts) this.framesByContext.set(context.contextId, []);
  }

  submit(contextId: string, frame: ClientCausalEvaluationFrame): void {
    if (this.frozen) throw new Error("prediction is already frozen before truth reveal");
    const frames = this.framesByContext.get(contextId);
    if (!frames) throw new Error(`unplanned evaluation context ${contextId}`);
    assertFrame(frame);
    const previous = frames.at(-1);
    if (previous && (frame.frameId <= previous.frameId
        || frame.sourceTimestampMs <= previous.sourceTimestampMs)) {
      throw new Error(`${contextId}: client frames must be strictly chronological and single pass`);
    }
    assertCausalRustOutput(frame.candidate, frame.sourceTimestampMs, "candidate", previous?.candidate);
    assertCausalRustOutput(frame.baseline, frame.sourceTimestampMs, "baseline", previous?.baseline);
    frames.push(cloneJson(frame));
  }

  freeze(): Readonly<FrozenViewNormalizationPrediction> {
    if (this.frozen) throw new Error("prediction is already frozen before truth reveal");
    const contexts = this.pack.contexts.map((context) => {
      const frames = this.framesByContext.get(context.contextId) ?? [];
      if (frames.length === 0) throw new Error(`${context.contextId}: missing client observations`);
      return {
        ...context,
        frames: frames.map(cloneJson),
      };
    });
    const inputSemantic = contexts.map((context) => ({
      contextId: context.contextId,
      frames: context.frames.map((frame) => ({
        frameId: frame.frameId,
        sourceTimestampMs: frame.sourceTimestampMs,
        inputObservationHash: frame.inputObservationHash,
      })),
    }));
    const semantic = {
      schemaVersion: "maxpower-view-normalization-frozen-prediction/v1" as const,
      state: "frozen_before_truth" as const,
      runId: this.pack.runId,
      runKind: this.pack.runKind,
      profileVersion: this.pack.preregistration.profileVersion,
      baselineProfileVersion: this.pack.preregistration.baselineProfileVersion,
      coordinateVersion: this.pack.preregistration.coordinateVersion,
      inferencePackHash: sha256(stableStringify(this.pack)),
      sourceLineage: cloneJson(this.pack.sourceLineage),
      contexts,
      inputHash: sha256(stableStringify(inputSemantic)),
    };
    this.frozen = true;
    return deepFreeze({
      ...semantic,
      predictionHash: sha256(stableStringify(semantic)),
    });
  }
}

/** Validates a JSON-loaded artifact before truth or report code can consume it. */
export function validateFrozenEvaluationPrediction(
  value: unknown,
  pack: FrozenEvaluationInferencePack,
): Readonly<FrozenViewNormalizationPrediction> {
  if (!value || typeof value !== "object") throw new Error("frozen prediction must be an object");
  const frozen = value as FrozenViewNormalizationPrediction;
  assertFrozenPrediction(frozen, pack);
  if (!Array.isArray(frozen.contexts) || frozen.contexts.length !== pack.contexts.length) {
    throw new Error("frozen prediction context inventory mismatch");
  }
  for (const context of frozen.contexts) {
    if (!Array.isArray(context.frames) || context.frames.length === 0) {
      throw new Error(`${context.contextId}: frozen prediction has no client frames`);
    }
    let previousFrameId = -1;
    let previousTimestamp = -1;
    let previousFrame: ClientCausalEvaluationFrame | undefined;
    for (const frame of context.frames) {
      assertFrame(frame);
      if (frame.frameId <= previousFrameId || frame.sourceTimestampMs <= previousTimestamp) {
        throw new Error(`${context.contextId}: frozen client frames are not chronological`);
      }
      assertCausalRustOutput(
        frame.candidate,
        frame.sourceTimestampMs,
        "candidate",
        previousFrame?.candidate,
      );
      assertCausalRustOutput(
        frame.baseline,
        frame.sourceTimestampMs,
        "baseline",
        previousFrame?.baseline,
      );
      previousFrameId = frame.frameId;
      previousTimestamp = frame.sourceTimestampMs;
      previousFrame = frame;
    }
  }
  return deepFreeze(cloneJson(frozen));
}

/** Reveals formal truth only after the immutable prediction hash is validated. */
export function revealFrozenEvaluationTruth(
  frozen: FrozenViewNormalizationPrediction,
  pack: FrozenEvaluationInferencePack,
  truth: RevealedEvaluationTruth,
): Readonly<FrozenViewNormalizationEvaluationReport> {
  const validatedFrozen = validateFrozenEvaluationPrediction(frozen, pack);
  if (truth.schemaVersion !== "maxpower-view-normalization-revealed-truth/v1") {
    throw new Error("unsupported revealed truth schema");
  }
  const truthByContext = new Map(truth.contexts.map((context) => [context.contextId, context]));
  if (truthByContext.size !== validatedFrozen.contexts.length) {
    throw new Error("revealed truth must cover the complete frozen context inventory");
  }
  const candidate = emptyMetricAccumulator();
  const baseline = emptyMetricAccumulator();
  const bucketAccumulators = new Map<EvaluationBucketKey, Readonly<{
    candidate: MetricAccumulator;
    baseline: MetricAccumulator;
  }>>();
  const crossViewAccumulator = emptyCrossViewAccumulator();
  for (const context of validatedFrozen.contexts) {
    const contextTruth = truthByContext.get(context.contextId);
    if (!contextTruth) throw new Error(`missing revealed truth for ${context.contextId}`);
    if (contextTruth.sourceCaptureId !== context.sourceCaptureId
        || contextTruth.actionId !== context.actionId
        || contextTruth.view !== context.view) {
      throw new Error(`${context.contextId}: revealed truth identity disagrees with prediction`);
    }
    const lastFrame = context.frames.at(-1);
    if (!lastFrame) throw new Error(`${context.contextId}: frozen prediction has no frames`);
    accumulateEndpointMetrics(
      candidate,
      contextTruth.reps,
      lastFrame.candidate.sealedReps,
      pack.preregistration.endpointToleranceMs,
      pack.preregistration.matchingToleranceMs,
    );
    accumulateEndpointMetrics(
      baseline,
      contextTruth.reps,
      lastFrame.baseline.sealedReps,
      pack.preregistration.endpointToleranceMs,
      pack.preregistration.matchingToleranceMs,
    );
    for (const key of bucketKeys(context, lastFrame)) {
      const bucket = bucketAccumulators.get(key) ?? {
        candidate: emptyMetricAccumulator(),
        baseline: emptyMetricAccumulator(),
      };
      accumulateEndpointMetrics(
        bucket.candidate,
        contextTruth.reps,
        lastFrame.candidate.sealedReps,
        pack.preregistration.endpointToleranceMs,
        pack.preregistration.matchingToleranceMs,
      );
      accumulateEndpointMetrics(
        bucket.baseline,
        contextTruth.reps,
        lastFrame.baseline.sealedReps,
        pack.preregistration.endpointToleranceMs,
        pack.preregistration.matchingToleranceMs,
      );
      bucketAccumulators.set(key, bucket);
    }
    if (contextTruth.reps.some((rep) => rep.synchronizedFrontReference !== undefined)) {
      accumulateCrossView(
        crossViewAccumulator,
        contextTruth.reps,
        lastFrame.candidate.sealedReps,
        pack.preregistration.matchingToleranceMs,
      );
    }
  }
  const buckets = [...bucketAccumulators.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, metrics]) => ({
      key,
      candidate: finalizeEndpointMetrics(metrics.candidate),
      baseline: finalizeEndpointMetrics(metrics.baseline),
    }));
  const worstBucket = selectWorstBucket(buckets);
  const candidateMetrics = finalizeEndpointMetrics(candidate);
  const baselineMetrics = finalizeEndpointMetrics(baseline);
  const crossView = crossViewAccumulator.pairedRepCount > 0
    ? finalizeCrossView(crossViewAccumulator)
    : { status: "not_applicable" as const };
  const gates = {
    precisionAtLeast95: atLeast(candidateMetrics.precision, 0.95),
    recallAtLeast95: atLeast(candidateMetrics.recall, 0.95),
    fullEndpointAlignmentAtLeast95: atLeast(candidateMetrics.fullEndpointAlignmentRate, 0.95),
    candidateNonInferiorToBaseline: nonInferior(candidateMetrics, baselineMetrics),
    candidateNonInferiorInEveryBucket: buckets.every((bucket) => (
      nonInferior(bucket.candidate, bucket.baseline)
    )),
    normalizedCrossViewImprovesOnRawScreenY: crossView.status === "available"
      && crossView.normalizedRomMeanAbsoluteDisagreement !== null
      && crossView.rawScreenYRomMeanAbsoluteDisagreement !== null
      && crossView.normalizedRomMeanAbsoluteDisagreement
        < crossView.rawScreenYRomMeanAbsoluteDisagreement,
  };
  const promotionReasons = promotionReasonsFor(pack.runKind, gates);
  const semantic = {
    schemaVersion: "maxpower-view-normalization-evaluation-report/v1" as const,
    runId: frozen.runId,
    runKind: frozen.runKind,
    inputHash: validatedFrozen.inputHash,
    predictionHash: validatedFrozen.predictionHash,
    aggregate: {
      candidate: candidateMetrics,
      baseline: baselineMetrics,
    },
    crossView,
    buckets,
    worstBucket,
    promotion: {
      eligible: promotionReasons.length === 0,
      reasons: promotionReasons,
      gates,
    },
  };
  return deepFreeze({ ...semantic, reportHash: sha256(stableStringify(semantic)) });
}

interface MetricAccumulator {
  truthCount: number;
  predictedCount: number;
  matchedCount: number;
  rejectedCount: number;
  abstentionCount: number;
  exactContextCount: number;
  contextCount: number;
  startErrors: number[];
  turnaroundErrors: number[];
  endErrors: number[];
  fullEndpointAlignedCount: number;
}

function emptyMetricAccumulator(): MetricAccumulator {
  return {
    truthCount: 0,
    predictedCount: 0,
    matchedCount: 0,
    rejectedCount: 0,
    abstentionCount: 0,
    exactContextCount: 0,
    contextCount: 0,
    startErrors: [],
    turnaroundErrors: [],
    endErrors: [],
    fullEndpointAlignedCount: 0,
  };
}

function accumulateEndpointMetrics(
  metrics: MetricAccumulator,
  truth: readonly Readonly<RevealedTruthRep>[],
  predictions: readonly Readonly<ClientSealedRepPrediction>[],
  endpointToleranceMs: number,
  matchingToleranceMs: number,
): void {
  const eligible = predictions.filter((rep) => rep.disposition !== "rejected");
  const rejected = predictions.length - eligible.length;
  const matches = monotonicNearestMatches(truth, eligible, matchingToleranceMs);
  metrics.truthCount += truth.length;
  metrics.predictedCount += predictions.length;
  metrics.rejectedCount += rejected;
  metrics.matchedCount += matches.length;
  metrics.abstentionCount += Math.max(0, truth.length - matches.length);
  metrics.contextCount += 1;
  if (truth.length === eligible.length && matches.length === truth.length && rejected === 0) {
    metrics.exactContextCount += 1;
  }
  for (const [truthRep, predictedRep] of matches) {
    const start = Math.abs(predictedRep.startMs - truthRep.startMs);
    const turnaround = Math.abs(predictedRep.turnaroundMs - truthRep.turnaroundMs);
    const end = Math.abs(predictedRep.endMs - truthRep.endMs);
    metrics.startErrors.push(start);
    metrics.turnaroundErrors.push(turnaround);
    metrics.endErrors.push(end);
    if (start <= endpointToleranceMs && turnaround <= endpointToleranceMs
        && end <= endpointToleranceMs) {
      metrics.fullEndpointAlignedCount += 1;
    }
  }
}

function monotonicNearestMatches(
  truth: readonly Readonly<RevealedTruthRep>[],
  predictions: readonly Readonly<ClientSealedRepPrediction>[],
  toleranceMs: number,
): Array<[
  Readonly<RevealedTruthRep>,
  Readonly<ClientSealedRepPrediction>,
]> {
  const matches: Array<[
    Readonly<RevealedTruthRep>,
    Readonly<ClientSealedRepPrediction>,
  ]> = [];
  let predictedIndex = 0;
  for (const truthRep of truth) {
    let bestIndex = -1;
    let bestError = Number.POSITIVE_INFINITY;
    for (let index = predictedIndex; index < predictions.length; index += 1) {
      const prediction = predictions[index]!;
      const error = Math.abs(prediction.startMs - truthRep.startMs)
        + Math.abs(prediction.endMs - truthRep.endMs);
      if (error < bestError) {
        bestIndex = index;
        bestError = error;
      }
    }
    if (bestIndex >= 0 && bestError <= toleranceMs * 2) {
      matches.push([truthRep, predictions[bestIndex]!]);
      predictedIndex = bestIndex + 1;
    }
  }
  return matches;
}

function finalizeEndpointMetrics(metrics: MetricAccumulator): EndpointAlignmentMetrics {
  return {
    truthCount: metrics.truthCount,
    predictedCount: metrics.predictedCount,
    matchedCount: metrics.matchedCount,
    rejectedCount: metrics.rejectedCount,
    abstentionCount: metrics.abstentionCount,
    precision: ratio(metrics.matchedCount, metrics.predictedCount),
    recall: ratio(metrics.matchedCount, metrics.truthCount),
    exactSetRate: ratio(metrics.exactContextCount, metrics.contextCount),
    startMeanAbsoluteErrorMs: mean(metrics.startErrors),
    turnaroundMeanAbsoluteErrorMs: mean(metrics.turnaroundErrors),
    endMeanAbsoluteErrorMs: mean(metrics.endErrors),
    fullEndpointAlignmentRate: ratio(metrics.fullEndpointAlignedCount, metrics.truthCount),
    coverage: ratio(metrics.matchedCount, metrics.truthCount),
  };
}

interface CrossViewAccumulator {
  pairedRepCount: number;
  normalizedCount: number;
  abstentionCount: number;
  turnaroundErrors: number[];
  rawRomDisagreements: number[];
  normalizedRomDisagreements: number[];
  crossPathDisagreements: number[];
  endpointResidualDisagreements: number[];
}

function emptyCrossViewAccumulator(): CrossViewAccumulator {
  return {
    pairedRepCount: 0,
    normalizedCount: 0,
    abstentionCount: 0,
    turnaroundErrors: [],
    rawRomDisagreements: [],
    normalizedRomDisagreements: [],
    crossPathDisagreements: [],
    endpointResidualDisagreements: [],
  };
}

function accumulateCrossView(
  metrics: CrossViewAccumulator,
  truth: readonly Readonly<RevealedTruthRep>[],
  predictions: readonly Readonly<ClientSealedRepPrediction>[],
  matchingToleranceMs: number,
): void {
  const eligible = predictions.filter((rep) => rep.disposition !== "rejected");
  const matches = monotonicNearestMatches(truth, eligible, matchingToleranceMs);
  for (const [truthRep, predictedRep] of matches) {
    const front = truthRep.synchronizedFrontReference;
    if (!front) continue;
    metrics.pairedRepCount += 1;
    metrics.turnaroundErrors.push(Math.abs(predictedRep.turnaroundMs - front.turnaroundMs));
    if (finiteNumber(predictedRep.rawScreenYRom)) {
      metrics.rawRomDisagreements.push(Math.abs(predictedRep.rawScreenYRom - front.rawScreenYRom));
    }
    const normalized = normalizedRepFacts(predictedRep.normalizedFacts);
    if (!normalized) {
      metrics.abstentionCount += 1;
      continue;
    }
    metrics.normalizedCount += 1;
    metrics.normalizedRomDisagreements.push(Math.abs(normalized.normalizedRom - front.normalizedRom));
    metrics.crossPathDisagreements.push(Math.abs(normalized.crossPath - front.crossPath));
    metrics.endpointResidualDisagreements.push(
      Math.abs(normalized.endpointResidual - front.endpointResidual),
    );
  }
}

function finalizeCrossView(metrics: CrossViewAccumulator): CrossViewMetrics {
  if (metrics.normalizedCount === 0) {
    return {
      status: "unavailable",
      reason: "normalized_fields_not_present",
      pairedRepCount: metrics.pairedRepCount,
      normalizedCoverage: ratio(metrics.normalizedCount, metrics.pairedRepCount) ?? 0,
      abstentionCount: metrics.abstentionCount,
    };
  }
  return {
    status: "available",
    pairedRepCount: metrics.pairedRepCount,
    turnaroundMeanAbsoluteErrorMs: mean(metrics.turnaroundErrors),
    rawScreenYRomMeanAbsoluteDisagreement: mean(metrics.rawRomDisagreements),
    normalizedRomMeanAbsoluteDisagreement: mean(metrics.normalizedRomDisagreements),
    normalizedCrossPathMeanAbsoluteDisagreement: mean(metrics.crossPathDisagreements),
    normalizedEndpointResidualMeanAbsoluteDisagreement: mean(
      metrics.endpointResidualDisagreements,
    ),
    normalizedCoverage: ratio(metrics.normalizedCount, metrics.pairedRepCount) ?? 0,
    abstentionCount: metrics.abstentionCount,
  };
}

function normalizedRepFacts(value: unknown): null | Readonly<{
  normalizedRom: number;
  crossPath: number;
  endpointResidual: number;
  confidence: number;
}> {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return finiteNumber(candidate.normalizedRom)
      && finiteNumber(candidate.crossPath)
      && finiteNumber(candidate.endpointResidual)
      && finiteNumber(candidate.confidence)
      && candidate.confidence >= 0
      && candidate.confidence <= 1
    ? {
        normalizedRom: candidate.normalizedRom,
        crossPath: candidate.crossPath,
        endpointResidual: candidate.endpointResidual,
        confidence: candidate.confidence,
      }
    : null;
}

function bucketKeys(
  context: FrozenViewNormalizationPrediction["contexts"][number],
  lastFrame: ClientCausalEvaluationFrame,
): EvaluationBucketKey[] {
  const keys: EvaluationBucketKey[] = [
    `view:${context.view}`,
    ...context.conditions.map((condition): EvaluationBucketKey => `condition:${condition}`),
  ];
  const confidences = lastFrame.candidate.sealedReps
    .map((rep) => normalizedRepFacts(rep.normalizedFacts)?.confidence)
    .filter((value): value is number => value !== undefined);
  if (confidences.length > 0) {
    const average = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
    keys.push(`confidence:${average >= 0.8 ? "high" : average >= 0.5 ? "medium" : "low"}`);
  } else {
    keys.push("confidence:unavailable");
  }
  return [...new Set(keys)];
}

function selectWorstBucket(
  buckets: readonly Readonly<{
    key: EvaluationBucketKey;
    candidate: EndpointAlignmentMetrics;
    baseline: EndpointAlignmentMetrics;
  }>[],
): Readonly<{
  key: EvaluationBucketKey;
  candidate: EndpointAlignmentMetrics;
  baseline: EndpointAlignmentMetrics;
}> | null {
  if (buckets.length === 0) return null;
  return [...buckets].sort((left, right) => {
    const leftScore = left.candidate.fullEndpointAlignmentRate ?? -1;
    const rightScore = right.candidate.fullEndpointAlignmentRate ?? -1;
    if (leftScore !== rightScore) return leftScore - rightScore;
    const leftCoverage = left.candidate.coverage ?? -1;
    const rightCoverage = right.candidate.coverage ?? -1;
    if (leftCoverage !== rightCoverage) return leftCoverage - rightCoverage;
    return left.key.localeCompare(right.key);
  })[0]!;
}

function promotionReasonsFor(
  runKind: FrozenEvaluationRunKind,
  gates: FrozenViewNormalizationEvaluationReport["promotion"]["gates"],
): string[] {
  if (runKind === "touched_benchmark") {
    return ["touched_benchmark_is_never_acceptance_eligible"];
  }
  if (runKind === "synchronized_cross_view_validation") {
    return ["synchronized_cross_view_validation_is_supporting_evidence_only"];
  }
  const reasons: string[] = [];
  if (!gates.precisionAtLeast95) reasons.push("precision_below_95_percent");
  if (!gates.recallAtLeast95) reasons.push("recall_below_95_percent");
  if (!gates.fullEndpointAlignmentAtLeast95) {
    reasons.push("full_endpoint_alignment_below_95_percent");
  }
  if (!gates.candidateNonInferiorToBaseline) reasons.push("candidate_regresses_baseline");
  if (!gates.candidateNonInferiorInEveryBucket) {
    reasons.push("candidate_regresses_baseline_in_at_least_one_bucket");
  }
  if (!gates.normalizedCrossViewImprovesOnRawScreenY) {
    reasons.push("normalized_cross_view_does_not_improve_raw_screen_y");
  }
  return reasons;
}

function atLeast(value: number | null, threshold: number): boolean {
  return value !== null && value >= threshold;
}

function nonInferior(
  candidate: EndpointAlignmentMetrics,
  baseline: EndpointAlignmentMetrics,
): boolean {
  return comparableAtLeast(candidate.precision, baseline.precision)
    && comparableAtLeast(candidate.recall, baseline.recall)
    && comparableAtLeast(candidate.exactSetRate, baseline.exactSetRate)
    && comparableAtLeast(
      candidate.fullEndpointAlignmentRate,
      baseline.fullEndpointAlignmentRate,
    );
}

function comparableAtLeast(candidate: number | null, baseline: number | null): boolean {
  return candidate !== null && baseline !== null && candidate >= baseline;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function assertFrozenPrediction(
  frozen: FrozenViewNormalizationPrediction,
  pack: FrozenEvaluationInferencePack,
): void {
  if (frozen.schemaVersion !== "maxpower-view-normalization-frozen-prediction/v1"
      || frozen.state !== "frozen_before_truth") {
    throw new Error("prediction must be frozen before truth reveal");
  }
  if (frozen.runId !== pack.runId || frozen.runKind !== pack.runKind) {
    throw new Error("frozen prediction identity disagrees with inference pack");
  }
  if (frozen.inferencePackHash !== sha256(stableStringify(pack))) {
    throw new Error("inference pack changed after prediction freeze");
  }
  const { predictionHash, ...semantic } = frozen;
  if (sha256(stableStringify(semantic)) !== predictionHash) {
    throw new Error("frozen prediction hash mismatch");
  }
}

function assertInferencePack(pack: FrozenEvaluationInferencePack): void {
  if (pack.schemaVersion !== "maxpower-view-normalization-inference-pack/v1") {
    throw new Error("unsupported view-normalization inference pack");
  }
  if (!pack.runId || pack.contexts.length === 0) throw new Error("inference pack is incomplete");
  if (pack.processingContract.chronologicalSinglePass !== true
      || pack.processingContract.rewindsAllowed !== false
      || pack.processingContract.futureFramesAllowed !== false) {
    throw new Error("evaluation requires chronological client-format single-pass processing");
  }
  assertNoFormalTruth(pack);
  if (pack.runKind === "untouched_model_acceptance") {
    const targets = new Set([
      ...pack.sourceLineage.targetSourceIds,
      ...(pack.sourceLineage.targetDerivativeSourceIds ?? []),
    ]);
    const influencedTargets = [
      ...pack.sourceLineage.profileFitSourceIds,
      ...(pack.sourceLineage.profileFitDerivativeSourceIds ?? []),
      ...pack.sourceLineage.thresholdSelectionSourceIds,
      ...(pack.sourceLineage.thresholdSelectionDerivativeSourceIds ?? []),
      ...pack.sourceLineage.manuallyInspectedSourceIds,
      ...(pack.sourceLineage.manuallyInspectedDerivativeSourceIds ?? []),
    ].filter((sourceId) => targets.has(sourceId));
    if (influencedTargets.length > 0) {
      throw new Error(
        `untouched model acceptance has conflicting source lineage: ${[
          ...new Set(influencedTargets),
        ].sort().join(", ")}`,
      );
    }
  }
  const ids = new Set<string>();
  const targetSources = new Set(pack.sourceLineage.targetSourceIds);
  for (const context of pack.contexts) {
    if (!context.contextId || ids.has(context.contextId)) {
      throw new Error(`duplicate or empty context id ${context.contextId}`);
    }
    if (!targetSources.has(context.sourceCaptureId)) {
      throw new Error(
        `${context.contextId}: target source lineage does not cover inference contexts`,
      );
    }
    ids.add(context.contextId);
  }
}

function assertNoFormalTruth(pack: FrozenEvaluationInferencePack): void {
  const forbiddenKeys = new Set([
    "expectedCount",
    "segments",
    "startMs",
    "turnaroundMs",
    "turnaroundTimestampMs",
    "endMs",
    "reviewDecision",
    "reviewDecisions",
    "truth",
    "sameVideoEndpointTemplate",
  ]);
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbiddenKeys.has(key)) {
        throw new Error(`formal truth key ${key} is forbidden in inference pack at ${path}`);
      }
      visit(child, `${path}.${key}`);
    }
  };
  visit(pack, "inferencePack");
}

function assertFrame(frame: ClientCausalEvaluationFrame): void {
  if (!Number.isSafeInteger(frame.frameId) || frame.frameId < 0
      || !Number.isFinite(frame.sourceTimestampMs) || frame.sourceTimestampMs < 0) {
    throw new Error("client frame identity is invalid");
  }
  for (const hash of [
    frame.inputObservationHash,
    frame.candidate.packetHash,
    frame.baseline.packetHash,
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("client frame hash must be sha256");
  }
}

function assertCausalRustOutput(
  output: ClientRustOutputProjection,
  sourceTimestampMs: number,
  label: "candidate" | "baseline",
  previous?: ClientRustOutputProjection,
): void {
  const byId = new Map<string, ClientSealedRepPrediction>();
  let priorEnd = -1;
  for (const rep of output.sealedReps) {
    if (!rep.repId || byId.has(rep.repId)) throw new Error(`${label}: duplicate sealed rep`);
    if (!(rep.startMs >= 0 && rep.startMs <= rep.turnaroundMs
        && rep.turnaroundMs <= rep.endMs && rep.endMs <= sourceTimestampMs)) {
      throw new Error(`${label}: sealed rep contains a future endpoint or invalid chronology`);
    }
    if (rep.startMs < priorEnd) throw new Error(`${label}: sealed reps overlap or rewind`);
    priorEnd = rep.endMs;
    byId.set(rep.repId, rep);
  }
  if (!previous) return;
  for (const sealed of previous.sealedReps) {
    const current = byId.get(sealed.repId);
    if (!current || stableStringify(current) !== stableStringify(sealed)) {
      throw new Error(`cannot rewrite sealed ${label} rep ${sealed.repId}`);
    }
  }
}

function assertTrace(trace: GeometryInvarianceTrace, label: string): void {
  if (trace.phaseSequence.length !== trace.rawScreenY.length
      || trace.rawScreenY.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label}: invalid raw screen trace`);
  }
  for (const normalized of [trace.normalizedAlongAxis, trace.normalizedCrossAxis]) {
    if (normalized !== undefined && (normalized.length !== trace.phaseSequence.length
        || normalized.some((value) => !Number.isFinite(value)))) {
      throw new Error(`${label}: invalid normalized trace`);
    }
  }
}

function assertRawGeometryInput(input: GeometryRawObservationInput, label: string): void {
  if (!Array.isArray(input.frames) || input.frames.length === 0) {
    throw new Error(`${label}: raw geometry input has no frames`);
  }
  let previousFrameId = -1;
  let previousTimestampMs = -1;
  for (const frame of input.frames) {
    if (!Number.isSafeInteger(frame.frameId) || frame.frameId <= previousFrameId
        || !Number.isFinite(frame.sourceTimestampMs)
        || frame.sourceTimestampMs <= previousTimestampMs) {
      throw new Error(`${label}: raw geometry frames must be chronological`);
    }
    const entries = Object.entries(frame.points) as Array<[
      string,
      Readonly<GeometryRawPoint2d> | null,
    ]>;
    if (entries.length === 0) throw new Error(`${label}: raw geometry frame has no points`);
    for (const [pointId, point] of entries) {
      if (point !== null && (!finiteNumber(point.x) || !finiteNumber(point.y))) {
        throw new Error(`${label}: raw geometry point ${pointId} is invalid`);
      }
    }
    previousFrameId = frame.frameId;
    previousTimestampMs = frame.sourceTimestampMs;
  }
}

function transformRawGeometryInput(
  input: GeometryRawObservationInput,
  transform: GeometryInvarianceInput["transforms"][number]["transform"],
): Readonly<GeometryRawObservationInput> {
  if (!finiteNumber(transform.rotationDegrees)
      || !finiteNumber(transform.translateX)
      || !finiteNumber(transform.translateY)
      || !finiteNumber(transform.uniformScale)
      || transform.uniformScale <= 0) {
    throw new Error("invalid synthetic transform");
  }
  const radians = transform.rotationDegrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const transformed: GeometryRawObservationInput = {
    frames: input.frames.map((frame) => ({
      frameId: frame.frameId,
      sourceTimestampMs: frame.sourceTimestampMs,
      points: Object.fromEntries(Object.entries(frame.points).map(([pointId, point]) => [
        pointId,
        point === null ? null : {
          x: transform.uniformScale * (point.x * cosine - point.y * sine)
            + transform.translateX,
          y: transform.uniformScale * (point.x * sine + point.y * cosine)
            + transform.translateY,
        },
      ])),
    })),
  };
  assertRawGeometryInput(transformed, "transformed");
  return deepFreeze(transformed);
}

function normalizedFactsFromEndpointSnapshots(
  endpoints: readonly Readonly<DecodedRepEndpointSnapshot>[],
): null | Readonly<{
  coordinateVersion: string;
  normalizedRom: number;
  crossPath: number;
  endpointResidual: number;
  confidence: number;
}> {
  const start = endpointCoordinate(endpoints, "start_anchor");
  const turnaround = endpointCoordinate(endpoints, "primary_turnaround");
  const end = endpointCoordinate(endpoints, "end_return");
  if (!start || !turnaround || !end) return null;
  const coordinates = [start, turnaround, end];
  const channels = coordinates.map((coordinate) => coordinate.equipment ?? coordinate.pose);
  if (channels.some((channel) => channel === null)) return null;
  const along = channels.map((channel) => channel!.alongAxisProgress);
  const cross = channels.map((channel) => channel!.crossAxisDisplacement);
  return deepFreeze({
    coordinateVersion: start.schemaVersion,
    normalizedRom: Math.max(...along) - Math.min(...along),
    crossPath: Math.max(...cross) - Math.min(...cross),
    endpointResidual: Math.hypot(channels[2]!.alongAxisProgress
      - channels[0]!.alongAxisProgress, channels[2]!.crossAxisDisplacement
      - channels[0]!.crossAxisDisplacement),
    confidence: Math.min(...coordinates.map((coordinate) => coordinate.confidence)),
  });
}

function endpointCoordinate(
  endpoints: readonly Readonly<DecodedRepEndpointSnapshot>[],
  kind: DecodedRepEndpointSnapshot["kind"],
): Readonly<DecodedLocalMotionCoordinate> | null {
  const coordinate = endpoints.find((endpoint) => endpoint.kind === kind)?.normalizedFeatures;
  const channel = coordinate?.equipment ?? coordinate?.pose;
  if (!coordinate || coordinate.endpointOrderMapping !== "screen_ordered_anatomy_unknown"
      || !channel || !unitInterval(channel.coverage)
      || !unitInterval(channel.uncertainty)) {
    return null;
  }
  return coordinate;
}

function rawScreenYRomFromEndpointSnapshots(
  endpoints: readonly Readonly<DecodedRepEndpointSnapshot>[],
): number | null {
  const start = endpointCoordinate(endpoints, "start_anchor")?.rawBarAxis;
  const turnaround = endpointCoordinate(endpoints, "primary_turnaround")?.rawBarAxis;
  if (!start || !turnaround) return null;
  return Math.abs((turnaround[1] + turnaround[3]) / 2 - (start[1] + start[3]) / 2);
}

function safeBigIntTimestamp(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`decoded Rust ${label} is outside the evaluation range`);
  }
  return result;
}

function maximumAbsoluteError(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length) throw new Error("geometry traces have different lengths");
  return left.reduce((maximum, value, index) => (
    Math.max(maximum, Math.abs(value - right[index]!))
  ), 0);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unitInterval(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function nullableFiniteNumber(value: unknown): value is number | null | undefined {
  return value === undefined || value === null || finiteNumber(value);
}

function invalidNormalizedFacts(): DecodedNormalizedFacts {
  return Object.freeze({
    status: "unavailable",
    reason: "normalized_fields_invalid",
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
