import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  instantiateRustMotionWasm,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import {
  buildTruthFreePlan,
  freezePredictions,
  scoreFrozenBlindRun,
  type AssessmentCapability,
  type InjectedContextPrediction,
  type PersonalGoldenDataset,
  type ProfileBundle,
  type TruthFreePlan,
  type FrozenPredictionRun,
} from "./blindEvaluation";
import { routeSourceFramesOnce } from "./rustFullDataProposalRunner";
import {
  equipmentFramesByTimestamp,
  loadBenchEquipmentSidecar,
  loadInputCatalog,
  loadRawObservationSidecar,
  loadSourceIndependentBenchProfiles,
  measuredAxisToEquipmentObservation,
  normalizeSourceCaptureId,
  pinInputBytes,
  rawFrameCandidates,
  rawObservationDerivativeId,
  sha256,
  submitRawFrameToRust,
  type BenchEquipmentFrame,
  type InputAssetPin,
  type SourceIndependentBenchProfileEntry,
} from "./runnerInputs";

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

export function actualProfileBundles(
  artifact: ProfileArtifact,
  independentBench: readonly SourceIndependentBenchProfileEntry[] = [],
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
  const sourceIndependent = independentBench.map((entry) => Object.freeze({
    bundleId: independentBenchBundleId(entry),
    bundleHash: sha256(stableStringify(serializeProfile(entry.profile))),
    actionId: entry.exerciseId,
    capturePosition: entry.capturePosition,
    capability: "quality_supported" as const,
    fittedSourceIds: Object.freeze([]),
    fittedDerivativeSourceIds: Object.freeze([]),
    versions: Object.freeze({
      profile: entry.profile.identity,
      rulePack: "personal-motion-quality-rules/v1",
    }),
  }));
  return Object.freeze([...sourceIndependent, ...fitted]);
}

export async function writeTruthFreeBlindPlan(input: Readonly<{
  datasetPath: string;
  profileArtifactPath: string;
  sourceIndependentBenchProfilePath: string;
  governanceInputCatalogPath: string;
  outputPath: string;
  seed: string;
  runId: string;
}>): Promise<Readonly<TruthFreePlan> & Readonly<Record<string, unknown>>> {
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const [datasetBytes, profileBytes, independentBench] = await Promise.all([
    readFile(resolve(input.datasetPath)),
    readFile(resolve(input.profileArtifactPath)),
    loadSourceIndependentBenchProfiles(input.sourceIndependentBenchProfilePath, catalogLoaded.value),
  ]);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as PersonalGoldenDataset;
  const artifact = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const derivativeSourceIdsBySource = Object.fromEntries(dataset.records.map((record) => {
    const sourceCaptureId = normalizeSourceCaptureId(record.sourceCaptureId ?? record.captureId);
    return [sourceCaptureId, [rawObservationDerivativeId(sourceCaptureId)]];
  }));
  const plan = buildTruthFreePlan(dataset, actualProfileBundles(artifact, independentBench.value), {
    seed: input.seed,
    runId: input.runId,
    derivativeSourceIdsBySource,
  });
  const { planDigest: _oldDigest, ...planSemantic } = plan;
  const inputAssets = uniquePins([
    catalogLoaded.pin,
    pinInputBytes(catalogLoaded.value, "humanRanges", input.datasetPath, datasetBytes),
    pinInputBytes(catalogLoaded.value, "profileArtifact", input.profileArtifactPath, profileBytes),
    independentBench.pin,
  ]);
  const enrichedSemantic = {
    ...planSemantic,
    reproducibility: {
      inputAssets,
      inputAssetManifestSha256: sha256(stableStringify(inputAssets)),
    },
  };
  const enriched = deepFreeze({
    ...enrichedSemantic,
    planDigest: sha256(stableStringify(enrichedSemantic)),
  }) as Readonly<TruthFreePlan> & Readonly<Record<string, unknown>>;
  await writeFile(resolve(input.outputPath), `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

/**
 * Executes a pre-scrubbed plan. This function has no dataset/truth parameter
 * and never opens the personal annotation file.
 */
export async function runFrozenBlindPlan(input: Readonly<{
  planPath: string;
  rawObservationRoot: string;
  benchEquipmentObservationRoot: string;
  profileArtifactPath: string;
  sourceIndependentBenchProfilePath: string;
  governanceInputCatalogPath: string;
  wasmPath: string;
  outputPath: string;
}>): Promise<Readonly<FrozenPredictionRun> & Readonly<Record<string, unknown>>> {
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const [planBytes, profileBytes, wasmBytes, independentBench] = await Promise.all([
    readFile(resolve(input.planPath)),
    readFile(resolve(input.profileArtifactPath)),
    readFile(resolve(input.wasmPath)),
    loadSourceIndependentBenchProfiles(input.sourceIndependentBenchProfilePath, catalogLoaded.value),
  ]);
  const plan = JSON.parse(planBytes.toString("utf8")) as TruthFreePlan;
  const artifact = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const profilesByBundleId = new Map<string, RustExerciseProfileData | ProfileEntry["profile"]>(artifact.profiles.map((entry) => [
    profileBundleId(entry),
    entry.profile,
  ]));
  for (const entry of independentBench.value) {
    profilesByBundleId.set(independentBenchBundleId(entry), entry.profile);
  }
  const inputAssetPins: InputAssetPin[] = [
    catalogLoaded.pin,
    pinInputBytes(catalogLoaded.value, "blindPlan", input.planPath, planBytes),
    pinInputBytes(catalogLoaded.value, "profileArtifact", input.profileArtifactPath, profileBytes),
    pinInputBytes(catalogLoaded.value, "rustWasm", input.wasmPath, wasmBytes),
    independentBench.pin,
  ];
  const predictions: InjectedContextPrediction[] = [];
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
        runKind: "blind_evaluation",
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
  const frozen = freezePredictions(plan, predictions);
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
  }) as Readonly<FrozenPredictionRun> & Readonly<Record<string, unknown>>;
  await writeFile(resolve(input.outputPath), `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
  return enriched;
}

/** Loads formal truth only after the frozen-before-truth artifact exists. */
export async function scoreFrozenBlindArtifact(input: Readonly<{
  frozenPredictionPath: string;
  datasetPath: string;
  outputPath: string;
}>): Promise<void> {
  const [frozenBytes, datasetBytes] = await Promise.all([
    readFile(resolve(input.frozenPredictionPath)),
    readFile(resolve(input.datasetPath)),
  ]);
  const report = scoreFrozenBlindRun(
    JSON.parse(frozenBytes.toString("utf8")) as FrozenPredictionRun,
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

export function independentBenchBundleId(entry: SourceIndependentBenchProfileEntry): string {
  return `0000-source-independent/${entry.capturePosition}/${entry.profile.identity}`;
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
    await writeTruthFreeBlindPlan({
      datasetPath: "data/training/personal-golden-segmentation-v2.json",
      profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
      sourceIndependentBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
      governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
      outputPath: "data/workflows/motion-quality-review/blind-inference-pack-v1.json",
      seed: "personal-motion-quality-blind-v1-fixed-seed",
      runId: "personal-blind-rust-qlt1-v1",
    });
    return;
  }
  if (mode === "infer") {
    await runFrozenBlindPlan({
      planPath: "data/workflows/motion-quality-review/blind-inference-pack-v1.json",
      rawObservationRoot: "data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
      benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
      profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
      sourceIndependentBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
      governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
      wasmPath: "public/motion-sdk/maxpower_motion_sdk.wasm",
      outputPath: "data/workflows/motion-quality-review/blind-predictions-before-truth-v1.json",
    });
    return;
  }
  if (mode === "score") {
    await scoreFrozenBlindArtifact({
      frozenPredictionPath: "data/workflows/motion-quality-review/blind-predictions-before-truth-v1.json",
      datasetPath: "data/training/personal-golden-segmentation-v2.json",
      outputPath: "data/workflows/motion-quality-review/blind-evaluation-after-truth-v1.json",
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
