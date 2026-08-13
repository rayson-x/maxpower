import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import {
  buildTruthFreePlan,
  freezePredictions,
  scoreFrozenBlindRun,
  type BlindEvaluationReport,
  type AssessmentCapability,
  type BuildPlanOptions,
  type FrozenContextPrediction,
  type InjectedContextPrediction,
  type PersonalGoldenDataset,
  type ProfileBundle,
  type ScoreOptions,
  type TruthFreePlan,
  type FrozenPredictionRun,
} from "./blindEvaluation";
import { routeSourceFramesOnce } from "./rustFullDataProposalRunner";
import {
  equipmentFramesByTimestamp,
  loadBenchEquipmentSidecar,
  loadInputCatalog,
  loadRawObservationSidecar,
  measuredAxisToEquipmentObservation,
  normalizeSourceCaptureId,
  pinInputBytes,
  rawFrameCandidates,
  rawObservationDerivativeId,
  sha256,
  submitRawFrameToRust,
  type BenchEquipmentFrame,
  type InputAssetPin,
  type LoadedPinned,
  type MotionQualityInputCatalog,
  type BenchProfileEntry,
} from "./runnerInputs";

export const TOUCHED_BENCHMARK_RUN_KIND = "touched_benchmark" as const;

export const TOUCHED_BENCHMARK_CLAIM_BOUNDARY = Object.freeze({
  benchmarkClass: TOUCHED_BENCHMARK_RUN_KIND,
  acceptanceEligible: false,
  acceptedClaims: Object.freeze([
    "known_capture_rep_count",
    "known_capture_start_end_alignment",
  ]),
  prohibitedClaims: Object.freeze([
    "unseen_source_performance",
    "cross_user_performance",
    "production_acceptance",
    "turnaround_accuracy",
    "action_quality_accuracy",
  ]),
});

export interface TouchedBenchmarkBenchProfileEntry extends BenchProfileEntry {
  readonly fittedSourceIds: readonly string[];
  readonly fittedDerivativeSourceIds: readonly string[];
}

export interface TouchedBenchmarkPlan extends Omit<TruthFreePlan, "schemaVersion" | "runKind"> {
  readonly schemaVersion: "maxpower-motion-quality-touched-benchmark-plan/v1";
  readonly runKind: typeof TOUCHED_BENCHMARK_RUN_KIND;
  readonly claimBoundary: typeof TOUCHED_BENCHMARK_CLAIM_BOUNDARY;
}

export interface TouchedBenchmarkInjectedContextPrediction
  extends Omit<InjectedContextPrediction, "runKind"> {
  readonly runKind: typeof TOUCHED_BENCHMARK_RUN_KIND;
}

export interface TouchedBenchmarkFrozenPredictionRun
  extends Omit<FrozenPredictionRun, "schemaVersion" | "runKind" | "contexts"> {
  readonly schemaVersion: "maxpower-motion-quality-touched-benchmark-predictions/v1";
  readonly runKind: typeof TOUCHED_BENCHMARK_RUN_KIND;
  readonly claimBoundary: typeof TOUCHED_BENCHMARK_CLAIM_BOUNDARY;
  readonly contexts: readonly Readonly<
    Omit<FrozenContextPrediction, "runKind"> & { readonly runKind: typeof TOUCHED_BENCHMARK_RUN_KIND }
  >[];
}

export interface TouchedBenchmarkEvaluationReport
  extends Omit<BlindEvaluationReport, "schemaVersion" | "runKind"> {
  readonly schemaVersion: "maxpower-motion-quality-touched-benchmark-evaluation/v1";
  readonly runKind: typeof TOUCHED_BENCHMARK_RUN_KIND;
  readonly claimBoundary: typeof TOUCHED_BENCHMARK_CLAIM_BOUNDARY;
}

interface SerializedTouchedBenchmarkBenchProfiles {
  readonly schemaVersion: "maxpower-touched-benchmark-bench-profiles/v1";
  readonly evidence: Readonly<{
    status: typeof TOUCHED_BENCHMARK_RUN_KIND;
    source: "thresholds_touched_current_six_bench_captures";
    fittedSourceIds: readonly string[];
    fittedDerivativeSourceIds: readonly string[];
    claimBoundary: typeof TOUCHED_BENCHMARK_CLAIM_BOUNDARY;
  }>;
  readonly profiles: readonly Readonly<{
    exerciseId: "barbell_bench_press";
    capturePosition: "front" | "frontLeft45" | "frontRight45";
    profile: Omit<RustExerciseProfileData, "contentHash">;
  }>[];
}

interface ProfileEntry {
  readonly exerciseId: string;
  readonly capturePosition: string;
  readonly profile: Omit<RustExerciseProfileData, "contentHash"> & {
    readonly contentHash: string | number;
  };
  readonly evidence?: Readonly<{ sourceCaptureIds?: readonly string[] }>;
}

interface ProfileArtifact {
  readonly schemaVersion: string;
  readonly profiles: readonly ProfileEntry[];
}

export async function loadTouchedBenchmarkBenchProfiles(
  path: string,
  catalog: MotionQualityInputCatalog,
): Promise<LoadedPinned<readonly TouchedBenchmarkBenchProfileEntry[]>> {
  const absolute = resolve(path);
  const bytes = await readFile(absolute);
  const serialized = JSON.parse(bytes.toString("utf8")) as SerializedTouchedBenchmarkBenchProfiles;
  const fittedSourceIds = uniqueStrings(serialized.evidence?.fittedSourceIds ?? []);
  const fittedDerivativeSourceIds = uniqueStrings(
    serialized.evidence?.fittedDerivativeSourceIds ?? [],
  );
  if (serialized.schemaVersion !== "maxpower-touched-benchmark-bench-profiles/v1"
      || serialized.evidence.status !== TOUCHED_BENCHMARK_RUN_KIND
      || serialized.evidence.source !== "thresholds_touched_current_six_bench_captures"
      || fittedSourceIds.length !== 6
      || fittedDerivativeSourceIds.length !== 6
      || stableStringify(serialized.evidence.claimBoundary)
        !== stableStringify(TOUCHED_BENCHMARK_CLAIM_BOUNDARY)) {
    throw new Error("bench profile must declare the six-source touched benchmark lineage");
  }
  const expectedDerivatives = uniqueStrings(fittedSourceIds.map(rawObservationDerivativeId));
  if (stableStringify(fittedDerivativeSourceIds) !== stableStringify(expectedDerivatives)) {
    throw new Error("touched benchmark derivative lineage disagrees with its source captures");
  }
  const entries = serialized.profiles.map((entry): TouchedBenchmarkBenchProfileEntry => {
    const identityParts = entry.profile.identity.split("/");
    if (entry.exerciseId !== "barbell_bench_press"
        || entry.profile.stateMachineId !== "barbell-axis-primary-ready-effort-return/v1"
        || identityParts[0] !== "barbell_bench_press"
        || identityParts[1] !== entry.capturePosition
        || identityParts[2] !== "bilateral"
        || identityParts[3] !== "barbell"
        || identityParts[4] !== "touched-benchmark-provisional-v1"
        || identityParts.length !== 5) {
      throw new Error(`${entry.capturePosition}: invalid touched benchmark bench profile`);
    }
    const withoutHash = { ...entry.profile } as Omit<RustExerciseProfileData, "contentHash">;
    return Object.freeze({
      exerciseId: entry.exerciseId,
      capturePosition: entry.capturePosition,
      profile: Object.freeze({
        ...withoutHash,
        contentHash: computeRustExerciseProfileHash(withoutHash),
      }),
      fittedSourceIds,
      fittedDerivativeSourceIds,
    });
  });
  if (entries.length !== 3
      || new Set(entries.map((entry) => entry.capturePosition)).size !== 3) {
    throw new Error("touched benchmark bench profiles must declare exactly three views");
  }
  return Object.freeze({
    value: Object.freeze(entries),
    bytes,
    pin: pinInputBytes(catalog, "touchedBenchmarkBenchProfile", absolute, bytes),
  });
}

export function actualProfileBundles(
  artifact: ProfileArtifact,
  touchedBench: readonly TouchedBenchmarkBenchProfileEntry[] = [],
): readonly ProfileBundle[] {
  const fitted = artifact.profiles.map((entry) => {
    const bundleId = profileBundleId(entry);
    const fittedSourceIds = uniqueStrings((entry.evidence?.sourceCaptureIds ?? [])
      .map(normalizeSourceCaptureId));
    return Object.freeze({
      bundleId,
      bundleHash: sha256(stableStringify(entry)),
      actionId: entry.exerciseId,
      capturePosition: entry.capturePosition,
      capability: capabilityFor(entry.exerciseId),
      fittedSourceIds,
      fittedDerivativeSourceIds: Object.freeze(fittedSourceIds.map(rawObservationDerivativeId)),
      versions: Object.freeze({
        profile: entry.profile.identity,
        rulePack: "personal-motion-quality-rules/v1",
      }),
    });
  });
  const touchedBenchmark = touchedBench.map((entry) => Object.freeze({
    bundleId: touchedBenchBundleId(entry),
    bundleHash: sha256(stableStringify(serializeProfile(entry.profile))),
    actionId: entry.exerciseId,
    capturePosition: entry.capturePosition,
    capability: "quality_supported" as const,
    fittedSourceIds: Object.freeze([...entry.fittedSourceIds]),
    fittedDerivativeSourceIds: Object.freeze([...entry.fittedDerivativeSourceIds]),
    versions: Object.freeze({
      profile: entry.profile.identity,
      rulePack: "personal-motion-quality-rules/v1",
    }),
  }));
  return Object.freeze([...touchedBenchmark, ...fitted]);
}

export function buildTouchedBenchmarkPlan(
  dataset: PersonalGoldenDataset,
  bundles: readonly ProfileBundle[],
  options: BuildPlanOptions,
): Readonly<TouchedBenchmarkPlan> {
  const compatibilityPlan = buildTruthFreePlan(dataset, bundles, options);
  const {
    planDigest: _oldDigest,
    schemaVersion: _oldSchemaVersion,
    runKind: _oldRunKind,
    ...planBody
  } = compatibilityPlan;
  return sealTouchedBenchmarkPlan({
    ...planBody,
    schemaVersion: "maxpower-motion-quality-touched-benchmark-plan/v1",
    runKind: TOUCHED_BENCHMARK_RUN_KIND,
    claimBoundary: TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
  });
}

export async function writeTouchedBenchmarkPlan(input: Readonly<{
  datasetPath: string;
  profileArtifactPath: string;
  touchedBenchmarkBenchProfilePath: string;
  governanceInputCatalogPath: string;
  outputPath: string;
  seed: string;
  runId: string;
}>): Promise<Readonly<TouchedBenchmarkPlan> & Readonly<Record<string, unknown>>> {
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const [datasetBytes, profileBytes, touchedBench] = await Promise.all([
    readFile(resolve(input.datasetPath)),
    readFile(resolve(input.profileArtifactPath)),
    loadTouchedBenchmarkBenchProfiles(input.touchedBenchmarkBenchProfilePath, catalogLoaded.value),
  ]);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as PersonalGoldenDataset;
  const artifact = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const derivativeSourceIdsBySource = Object.fromEntries(dataset.records.map((record) => {
    const sourceCaptureId = normalizeSourceCaptureId(record.sourceCaptureId ?? record.captureId);
    return [sourceCaptureId, [rawObservationDerivativeId(sourceCaptureId)]];
  }));
  const basePlan = buildTouchedBenchmarkPlan(
    dataset,
    actualProfileBundles(artifact, touchedBench.value),
    {
    seed: input.seed,
    runId: input.runId,
    derivativeSourceIdsBySource,
    },
  );
  const { planDigest: _baseDigest, ...planSemantic } = basePlan;
  const inputAssets = uniquePins([
    catalogLoaded.pin,
    pinInputBytes(catalogLoaded.value, "humanRanges", input.datasetPath, datasetBytes),
    pinInputBytes(catalogLoaded.value, "profileArtifact", input.profileArtifactPath, profileBytes),
    touchedBench.pin,
  ]);
  const enrichedSemantic = {
    ...planSemantic,
    reproducibility: {
      inputAssets,
      inputAssetManifestSha256: sha256(stableStringify(inputAssets)),
    },
  };
  const enriched = sealTouchedBenchmarkPlan(enrichedSemantic);
  assertNoOverstatedTouchedBenchmarkClaim(enriched);
  await writeFile(resolve(input.outputPath), `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

/**
 * Executes a pre-scrubbed plan. This function has no dataset/truth parameter
 * and never opens the personal annotation file.
 */
export async function runFrozenTouchedBenchmarkPlan(input: Readonly<{
  planPath: string;
  rawObservationRoot: string;
  benchEquipmentObservationRoot: string;
  profileArtifactPath: string;
  touchedBenchmarkBenchProfilePath: string;
  governanceInputCatalogPath: string;
  wasmPath: string;
  outputPath: string;
}>): Promise<Readonly<TouchedBenchmarkFrozenPredictionRun> & Readonly<Record<string, unknown>>> {
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const [planBytes, profileBytes, wasmBytes, touchedBench] = await Promise.all([
    readFile(resolve(input.planPath)),
    readFile(resolve(input.profileArtifactPath)),
    readFile(resolve(input.wasmPath)),
    loadTouchedBenchmarkBenchProfiles(input.touchedBenchmarkBenchProfilePath, catalogLoaded.value),
  ]);
  const plan = JSON.parse(planBytes.toString("utf8")) as TouchedBenchmarkPlan;
  assertTouchedBenchmarkPlan(plan);
  const artifact = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const profilesByBundleId = new Map<string, RustExerciseProfileData | ProfileEntry["profile"]>(artifact.profiles.map((entry) => [
    profileBundleId(entry),
    entry.profile,
  ]));
  for (const entry of touchedBench.value) {
    profilesByBundleId.set(touchedBenchBundleId(entry), entry.profile);
  }
  const inputAssetPins: InputAssetPin[] = [
    catalogLoaded.pin,
    pinInputBytes(catalogLoaded.value, "blindPlan", input.planPath, planBytes),
    pinInputBytes(catalogLoaded.value, "profileArtifact", input.profileArtifactPath, profileBytes),
    pinInputBytes(catalogLoaded.value, "rustWasm", input.wasmPath, wasmBytes),
    touchedBench.pin,
  ];
  const predictions: TouchedBenchmarkInjectedContextPrediction[] = [];
  for (const source of plan.sources) {
    const raw = await loadRawObservationSidecar(
      input.rawObservationRoot,
      source.sourceCaptureId,
      catalogLoaded.value,
    );
    inputAssetPins.push(raw.pin);
    const hasBench = source.contexts.some((context) => context.actionId === "barbell_bench_press");
    const benchEquipment = hasBench
      ? await loadBenchEquipmentSidecar(
        input.benchEquipmentObservationRoot,
        source.sourceCaptureId,
        catalogLoaded.value,
      )
      : null;
    if (benchEquipment) inputAssetPins.push(benchEquipment.pin);
    const benchEquipmentByTimestamp = benchEquipment
      ? equipmentFramesByTimestamp(benchEquipment.value)
      : new Map<number, BenchEquipmentFrame>();
    const routed = routeSourceFramesOnce(raw.value.frames, source.contexts.map((context) => ({
      captureId: context.contextId,
      startMs: context.inputWindow.fromTimestampMs,
      endMs: context.inputWindow.untilTimestampMs,
    })));
    const framesByContext = new Map<string, typeof raw.value.frames[number][]>();
    for (const entry of routed) {
      const rows = framesByContext.get(entry.captureId) ?? [];
      rows.push(entry.frame);
      framesByContext.set(entry.captureId, rows);
    }
    for (const context of source.contexts) {
      const frames = framesByContext.get(context.contextId) ?? [];
      if (frames.length === 0) throw new Error(`${context.contextId}: no causal input frames`);
      const timestamps = frames.map((frame) => Math.round(frame.timestampMs));
      const serialized = context.bundle
        ? profilesByBundleId.get(context.bundle.bundleId)
        : null;
      if (context.bundle && !serialized) {
        throw new Error(`${context.contextId}: planned profile bundle missing`);
      }
      const wasm = await instantiateRustMotionWasm(wasmBytes);
      const motion = new RustCanonicalWasmSession({
        sequenceId: `${plan.runId}:${context.contextId}`,
        schema: "halpe26",
        image: {
          widthPx: raw.value.source.widthPx,
          heightPx: raw.value.source.heightPx,
          mirrored: false,
          rotationDegrees: 0,
        },
        stabilization: "fusion",
        setLifecycleMode: "preview",
      }, wasm);
      if (serialized) {
        motion.installExerciseProfileData({
          ...serialized,
          contentHash: typeof serialized.contentHash === "bigint"
            ? serialized.contentHash
            : BigInt(serialized.contentHash),
        } as RustExerciseProfileData);
      }
      motion.beginSet();
      const reps = new Map<string, (typeof motion.lastCompletedReps)[number]>();
      const proposals = new Map<string, (typeof motion.lastQualityProposals)[number]>();
      const collect = (): void => {
        for (const rep of motion.lastCompletedReps) reps.set(rep.repId.toString(), rep);
        for (const proposal of motion.lastQualityProposals) proposals.set(proposal.proposalId, proposal);
      };
      for (const frame of frames) {
        const timestampMs = Math.round(frame.timestampMs);
        const axisFrame = context.actionId === "barbell_bench_press"
          ? benchEquipmentByTimestamp.get(timestampMs)
          : undefined;
        const equipment: readonly RustEquipmentObservation[] = measuredAxisToEquipmentObservation(
          axisFrame?.axis ?? null,
          frame.frameNumber + 1,
        );
        submitRawFrameToRust(motion, frame, equipment);
        collect();
      }
      motion.finishSet();
      collect();
      const finalPacket = motion.lastDecodedPacket;
      if (!finalPacket) throw new Error(`${context.contextId}: current Rust packet missing`);
      if (!context.bundle && (reps.size !== 0 || proposals.size !== 0)) {
        throw new Error(`${context.contextId}: unsupported no-profile run emitted reps`);
      }
      const injectedReps = [...reps.values()].map((rep) => ({
        repId: rep.repId.toString(),
        startMs: Number(rep.startTimestampMs),
        endMs: Number(rep.endTimestampMs),
        turnaroundTimestampMs: Number(rep.peakTimestampMs),
        disposition: rep.disposition,
      }));
      const quality = [...proposals.values()].flatMap((proposal) => (
        proposal.conclusions.map((conclusion) => ({
          conclusionId: `${proposal.proposalId}:${conclusion.conclusionId}`,
          state: conclusion.state === "cannot_judge" || conclusion.state === "not_applicable"
            ? "abstained" as const
            : "proposed" as const,
          reviewStatus: "unreviewed" as const,
        }))
      ));
      const proposalJson = [...proposals.values()];
      predictions.push({
        runKind: TOUCHED_BENCHMARK_RUN_KIND,
        sourceCaptureId: source.sourceCaptureId,
        contextId: context.contextId,
        processing: {
          chronologicalMonotonic: true,
          singlePass: true,
          sourceTimestampsMs: timestamps,
        },
        packetHash: sha256(stableStringify({
          canonicalHash: motion.lastCanonicalHash.toString(16),
          reps: injectedReps,
          quality: proposalJson,
        })),
        proposalHash: sha256(stableStringify(proposalJson)),
        versions: {
          visualModel: raw.value.inference.pipeline,
          rustEngine: finalPacket.lineage.algorithmVersion,
          packetSchema: `MOTN/${finalPacket.lineage.contract.major}.${finalPacket.lineage.contract.minor}+QLT1`,
          profileBundle: context.bundle?.profileVersion ?? "none",
          rulePack: context.bundle?.rulePackVersion ?? "none",
        },
        reps: injectedReps,
        qualityConclusions: quality,
      });
      motion.close();
    }
  }
  const frozen = freezeTouchedBenchmarkPredictions(plan, predictions);
  const { frozenDigest: _oldDigest, ...frozenSemantic } = frozen;
  const inputAssets = uniquePins(inputAssetPins);
  const enrichedSemantic = {
    ...frozenSemantic,
    reproducibility: {
      inputAssets,
      inputAssetManifestSha256: sha256(stableStringify(inputAssets)),
    },
  };
  const enriched = deepFreeze({
    ...enrichedSemantic,
    frozenDigest: sha256(stableStringify(enrichedSemantic)),
  }) as Readonly<TouchedBenchmarkFrozenPredictionRun> & Readonly<Record<string, unknown>>;
  assertNoOverstatedTouchedBenchmarkClaim(enriched);
  await writeFile(resolve(input.outputPath), `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

export function freezeTouchedBenchmarkPredictions(
  plan: TouchedBenchmarkPlan,
  predictions: readonly TouchedBenchmarkInjectedContextPrediction[],
): Readonly<TouchedBenchmarkFrozenPredictionRun> {
  assertTouchedBenchmarkPlan(plan);
  const compatibilityPlan = {
    ...plan,
    schemaVersion: "maxpower-motion-quality-truth-free-plan/v1" as const,
    runKind: "blind_evaluation" as const,
  };
  const compatibilityPredictions: InjectedContextPrediction[] = predictions.map((prediction) => ({
    ...prediction,
    runKind: "blind_evaluation" as const,
  }));
  const compatibilityFrozen = freezePredictions(compatibilityPlan, compatibilityPredictions);
  const semantic = {
    schemaVersion: "maxpower-motion-quality-touched-benchmark-predictions/v1" as const,
    state: "frozen_before_truth" as const,
    runId: plan.runId,
    runKind: TOUCHED_BENCHMARK_RUN_KIND,
    planDigest: plan.planDigest,
    claimBoundary: TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
    contexts: compatibilityFrozen.contexts.map((context) => ({
      ...context,
      runKind: TOUCHED_BENCHMARK_RUN_KIND,
    })),
  };
  return deepFreeze({
    ...semantic,
    frozenDigest: sha256(stableStringify(semantic)),
  });
}

export function sealTouchedBenchmarkPlan(
  semantic: Omit<TouchedBenchmarkPlan, "planDigest">,
): Readonly<TouchedBenchmarkPlan> {
  if (semantic.schemaVersion !== "maxpower-motion-quality-touched-benchmark-plan/v1"
      || semantic.runKind !== TOUCHED_BENCHMARK_RUN_KIND
      || stableStringify(semantic.claimBoundary)
        !== stableStringify(TOUCHED_BENCHMARK_CLAIM_BOUNDARY)) {
    throw new Error("plan is not a touched benchmark plan");
  }
  return deepFreeze({
    ...semantic,
    planDigest: sha256(stableStringify(semantic)),
  });
}

export function scoreFrozenTouchedBenchmarkRun(
  frozen: TouchedBenchmarkFrozenPredictionRun,
  truth: PersonalGoldenDataset,
  options: ScoreOptions = {},
): Readonly<TouchedBenchmarkEvaluationReport> {
  assertTouchedBenchmarkFrozenRun(frozen);
  const {
    frozenDigest: _touchedDigest,
    schemaVersion: _touchedSchema,
    runKind: _touchedRunKind,
    claimBoundary: _claimBoundary,
    contexts,
    ...body
  } = frozen;
  const compatibilitySemantic = {
    ...body,
    schemaVersion: "maxpower-motion-quality-frozen-predictions/v1" as const,
    state: "frozen_before_truth" as const,
    runKind: "blind_evaluation" as const,
    contexts: contexts.map((context) => ({
      ...context,
      runKind: "blind_evaluation" as const,
    })),
  };
  const compatibilityFrozen = {
    ...compatibilitySemantic,
    frozenDigest: sha256(stableStringify(compatibilitySemantic)),
  } as FrozenPredictionRun;
  const compatibilityReport = scoreFrozenBlindRun(compatibilityFrozen, truth, options);
  const {
    schemaVersion: _compatibilitySchema,
    runKind: _compatibilityRunKind,
    reportDigest: _compatibilityDigest,
    frozenDigest: _compatibilityFrozenDigest,
    ...reportBody
  } = compatibilityReport;
  const semantic = {
    ...reportBody,
    schemaVersion: "maxpower-motion-quality-touched-benchmark-evaluation/v1" as const,
    runKind: TOUCHED_BENCHMARK_RUN_KIND,
    frozenDigest: frozen.frozenDigest,
    claimBoundary: TOUCHED_BENCHMARK_CLAIM_BOUNDARY,
  };
  const report = deepFreeze({
    ...semantic,
    reportDigest: sha256(stableStringify(semantic)),
  });
  assertNoOverstatedTouchedBenchmarkClaim(report);
  return report;
}

/** Loads formal truth only after the frozen-before-truth artifact exists. */
export async function scoreFrozenTouchedBenchmarkArtifact(input: Readonly<{
  frozenPredictionPath: string;
  datasetPath: string;
  outputPath: string;
}>): Promise<void> {
  const [frozenBytes, datasetBytes] = await Promise.all([
    readFile(resolve(input.frozenPredictionPath)),
    readFile(resolve(input.datasetPath)),
  ]);
  const report = scoreFrozenTouchedBenchmarkRun(
    JSON.parse(frozenBytes.toString("utf8")) as TouchedBenchmarkFrozenPredictionRun,
    JSON.parse(datasetBytes.toString("utf8")) as PersonalGoldenDataset,
  );
  await writeFile(resolve(input.outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function capabilityFor(actionId: string): Exclude<AssessmentCapability, "unsupported"> {
  if (actionId === "barbell_bench_press") return "quality_supported";
  if (actionId === "pull_up") return "observation_only";
  return "phase_supported";
}

function profileBundleId(entry: ProfileEntry): string {
  return `${entry.exerciseId}/${entry.capturePosition}/${entry.profile.identity}`;
}

export function touchedBenchBundleId(entry: TouchedBenchmarkBenchProfileEntry): string {
  return `0000-touched-benchmark/${entry.capturePosition}/${entry.profile.identity}`;
}

function assertTouchedBenchmarkPlan(plan: TouchedBenchmarkPlan): void {
  if (plan.schemaVersion !== "maxpower-motion-quality-touched-benchmark-plan/v1"
      || plan.runKind !== TOUCHED_BENCHMARK_RUN_KIND
      || stableStringify(plan.claimBoundary) !== stableStringify(TOUCHED_BENCHMARK_CLAIM_BOUNDARY)) {
    throw new Error("plan is not a touched benchmark plan");
  }
  const { planDigest, ...semantic } = plan as TouchedBenchmarkPlan & Record<string, unknown>;
  if (sha256(stableStringify(semantic)) !== planDigest) {
    throw new Error("touched benchmark plan digest mismatch");
  }
  assertNoOverstatedTouchedBenchmarkClaim(plan);
}

function assertTouchedBenchmarkFrozenRun(frozen: TouchedBenchmarkFrozenPredictionRun): void {
  if (frozen.schemaVersion !== "maxpower-motion-quality-touched-benchmark-predictions/v1"
      || frozen.runKind !== TOUCHED_BENCHMARK_RUN_KIND
      || frozen.state !== "frozen_before_truth"
      || stableStringify(frozen.claimBoundary) !== stableStringify(TOUCHED_BENCHMARK_CLAIM_BOUNDARY)) {
    throw new Error("prediction run is not a frozen touched benchmark");
  }
  const { frozenDigest, ...semantic } = frozen as TouchedBenchmarkFrozenPredictionRun
    & Record<string, unknown>;
  if (sha256(stableStringify(semantic)) !== frozenDigest) {
    throw new Error("touched benchmark prediction digest mismatch");
  }
  assertNoOverstatedTouchedBenchmarkClaim(frozen);
}

function assertNoOverstatedTouchedBenchmarkClaim(value: unknown): void {
  if (!value || typeof value !== "object") {
    throw new Error("artifact must declare touched_benchmark");
  }
  if (/blind|generalization/iu.test(JSON.stringify(value))) {
    throw new Error("touched benchmark artifact contains an overstated claim");
  }
  const visit = (child: unknown): void => {
    if (Array.isArray(child)) {
      child.forEach(visit);
      return;
    }
    if (!child || typeof child !== "object") return;
    for (const [key, nested] of Object.entries(child)) {
      if (key === "runKind" && nested !== TOUCHED_BENCHMARK_RUN_KIND) {
        throw new Error("every persisted runKind must be touched_benchmark");
      }
      visit(nested);
    }
  };
  visit(value);
}

function serializeProfile(profile: RustExerciseProfileData): Readonly<Record<string, unknown>> {
  return { ...profile, contentHash: profile.contentHash.toString() };
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function uniquePins(pins: readonly InputAssetPin[]): readonly InputAssetPin[] {
  const byIdentity = new Map<string, InputAssetPin>();
  for (const pin of pins) {
    byIdentity.set(`${pin.assetId}\u0000${pin.path}\u0000${pin.sha256}`, pin);
  }
  return Object.freeze([...byIdentity.values()].sort((left, right) => (
    left.assetId.localeCompare(right.assetId) || left.path.localeCompare(right.path)
  )));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "plan") {
    await writeTouchedBenchmarkPlan({
      datasetPath: "data/training/personal-golden-segmentation-v2.json",
      profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
      touchedBenchmarkBenchProfilePath: "tools/motion-quality/touched-benchmark-bench-profiles.json",
      governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
      outputPath: "data/workflows/motion-quality-review/touched-benchmark-inference-pack-v1.json",
      seed: "personal-motion-quality-touched-benchmark-v1-fixed-seed",
      runId: "personal-touched-benchmark-rust-qlt1-v1",
    });
    return;
  }
  if (mode === "infer") {
    await runFrozenTouchedBenchmarkPlan({
      planPath: "data/workflows/motion-quality-review/touched-benchmark-inference-pack-v1.json",
      rawObservationRoot: "data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
      benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
      profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
      touchedBenchmarkBenchProfilePath: "tools/motion-quality/touched-benchmark-bench-profiles.json",
      governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
      wasmPath: "public/motion-sdk/maxpower_motion_sdk.wasm",
      outputPath: "data/workflows/motion-quality-review/touched-benchmark-predictions-before-truth-v1.json",
    });
    return;
  }
  if (mode === "score") {
    await scoreFrozenTouchedBenchmarkArtifact({
      frozenPredictionPath: "data/workflows/motion-quality-review/touched-benchmark-predictions-before-truth-v1.json",
      datasetPath: "data/training/personal-golden-segmentation-v2.json",
      outputPath: "data/workflows/motion-quality-review/touched-benchmark-evaluation-after-truth-v1.json",
    });
    return;
  }
  throw new Error("usage: rustBlindProposalRunner plan|infer|score");
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
