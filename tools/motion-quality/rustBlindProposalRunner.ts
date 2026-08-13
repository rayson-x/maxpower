import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  instantiateRustMotionWasm,
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
import { anatomicalSideForContext, routeSourceFramesOnce } from "./rustFullDataProposalRunner";

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

interface CanonicalPose {
  readonly timestampMs: number;
  readonly landmarks: readonly Readonly<{
    x: number | null;
    y: number | null;
    z: number | null;
    visibility: number | null;
  }>[];
}

interface CanonicalCapture {
  readonly sourceCaptureId: string;
  readonly image?: Readonly<{ widthPx?: number; heightPx?: number; mirrored?: boolean }>;
  readonly poses: readonly CanonicalPose[];
}

interface CanonicalCorpus {
  readonly captures: Readonly<Record<string, CanonicalCapture>>;
}

export function actualProfileBundles(artifact: ProfileArtifact): readonly ProfileBundle[] {
  return Object.freeze(artifact.profiles.map((entry) => {
    const bundleId = profileBundleId(entry);
    return Object.freeze({
      bundleId,
      bundleHash: sha256(stableStringify(entry)),
      actionId: entry.exerciseId,
      capturePosition: entry.capturePosition,
      capability: capabilityFor(entry.exerciseId),
      fittedSourceIds: Object.freeze([...(entry.evidence?.sourceCaptureIds ?? [])]),
      fittedDerivativeSourceIds: Object.freeze([]),
      versions: Object.freeze({
        profile: entry.profile.identity,
        rulePack: "personal-motion-quality-rules/v1",
      }),
    });
  }));
}

export async function writeTruthFreeBlindPlan(input: Readonly<{
  datasetPath: string;
  profileArtifactPath: string;
  outputPath: string;
  seed: string;
  runId: string;
}>): Promise<Readonly<TruthFreePlan>> {
  const [datasetBytes, profileBytes] = await Promise.all([
    readFile(resolve(input.datasetPath)),
    readFile(resolve(input.profileArtifactPath)),
  ]);
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as PersonalGoldenDataset;
  const artifact = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const plan = buildTruthFreePlan(dataset, actualProfileBundles(artifact), {
    seed: input.seed,
    runId: input.runId,
  });
  await writeFile(resolve(input.outputPath), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return plan;
}

/**
 * Executes a pre-scrubbed plan. This function has no dataset/truth parameter
 * and never opens the personal annotation file.
 */
export async function runFrozenBlindPlan(input: Readonly<{
  planPath: string;
  canonicalCorpusPath: string;
  profileArtifactPath: string;
  wasmPath: string;
  outputPath: string;
}>): Promise<ReturnType<typeof freezePredictions>> {
  const [planBytes, corpusBytes, profileBytes, wasmBytes] = await Promise.all([
    readFile(resolve(input.planPath)),
    readFile(resolve(input.canonicalCorpusPath)),
    readFile(resolve(input.profileArtifactPath)),
    readFile(resolve(input.wasmPath)),
  ]);
  const plan = JSON.parse(planBytes.toString("utf8")) as TruthFreePlan;
  const corpus = JSON.parse(corpusBytes.toString("utf8")) as CanonicalCorpus;
  const artifact = JSON.parse(profileBytes.toString("utf8")) as ProfileArtifact;
  const captures = new Map(Object.values(corpus.captures).map((capture) => [
    capture.sourceCaptureId,
    capture,
  ]));
  const profilesByBundleId = new Map(artifact.profiles.map((entry) => [
    profileBundleId(entry),
    entry.profile,
  ]));
  const predictions: InjectedContextPrediction[] = [];
  for (const source of plan.sources) {
    const capture = captures.get(source.sourceCaptureId);
    if (!capture) throw new Error(`${source.sourceCaptureId}: canonical stream missing`);
    const routed = routeSourceFramesOnce(capture.poses, source.contexts.map((context) => ({
      captureId: context.contextId,
      startMs: context.inputWindow.fromTimestampMs,
      endMs: context.inputWindow.untilTimestampMs,
    })));
    const framesByContext = new Map<string, CanonicalPose[]>();
    for (const entry of routed) {
      const rows = framesByContext.get(entry.captureId) ?? [];
      rows.push(entry.frame);
      framesByContext.set(entry.captureId, rows);
    }
    for (const context of source.contexts) {
      const frames = framesByContext.get(context.contextId) ?? [];
      if (frames.length === 0) throw new Error(`${context.contextId}: no causal input frames`);
      const timestamps = frames.map((frame) => Math.round(frame.timestampMs));
      if (!context.bundle) {
        predictions.push({
          runKind: "blind_evaluation",
          sourceCaptureId: source.sourceCaptureId,
          contextId: context.contextId,
          processing: {
            chronologicalMonotonic: true,
            singlePass: true,
            sourceTimestampsMs: timestamps,
          },
          packetHash: sha256(stableStringify({ context: context.contextId, unsupported: true, timestamps })),
          proposalHash: sha256("[]"),
          versions: {
            visualModel: "client-halpe26-canonical-observation-v1",
            rustEngine: "not_run_no_legal_source_excluded_profile",
            packetSchema: "MOTN/1.8+QLT1",
            profileBundle: "none",
            rulePack: "none",
          },
          reps: [],
          qualityConclusions: [],
        });
        continue;
      }
      const serialized = profilesByBundleId.get(context.bundle.bundleId);
      if (!serialized) throw new Error(`${context.contextId}: planned profile bundle missing`);
      const profile = {
        ...serialized,
        contentHash: BigInt(serialized.contentHash),
      } as RustExerciseProfileData;
      const wasm = await instantiateRustMotionWasm(wasmBytes);
      const motion = new RustCanonicalWasmSession({
        sequenceId: `${plan.runId}:${context.contextId}`,
        schema: "halpe26",
        image: {
          widthPx: capture.image?.widthPx ?? 1280,
          heightPx: capture.image?.heightPx ?? 720,
          mirrored: capture.image?.mirrored ?? false,
          rotationDegrees: 0,
        },
        stabilization: "fusion",
        setLifecycleMode: "preview",
      }, wasm);
      motion.installExerciseProfileData(profile);
      motion.beginSet();
      const reps = new Map<string, (typeof motion.lastCompletedReps)[number]>();
      const proposals = new Map<string, (typeof motion.lastQualityProposals)[number]>();
      const collect = (): void => {
        for (const rep of motion.lastCompletedReps) reps.set(rep.repId.toString(), rep);
        for (const proposal of motion.lastQualityProposals) proposals.set(proposal.proposalId, proposal);
      };
      for (const frame of frames) {
        motion.process({
          timestampMs: frame.timestampMs,
          landmarks: frame.landmarks.map((point) => ({
            x: finiteOrZero(point.x),
            y: finiteOrZero(point.y),
            z: finiteOrZero(point.z),
            visibility: finiteOrZero(point.visibility),
          })),
          worldLandmarks: [],
        });
        collect();
      }
      motion.finishSet();
      collect();
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
          visualModel: "client-halpe26-canonical-observation-v1",
          rustEngine: "maxpower-motion-sdk/MOTN-1.8-QLT1",
          packetSchema: "MOTN/1.8+QLT1",
          profileBundle: context.bundle.profileVersion,
          rulePack: context.bundle.rulePackVersion,
        },
        reps: injectedReps,
        qualityConclusions: quality,
      });
      motion.close();
    }
  }
  const frozen = freezePredictions(plan, predictions);
  await writeFile(resolve(input.outputPath), `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  return frozen;
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

function finiteOrZero(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "plan") {
    await writeTruthFreeBlindPlan({
      datasetPath: "data/training/personal-golden-segmentation-v2.json",
      profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
      outputPath: "data/workflows/motion-quality-review/blind-inference-pack-v1.json",
      seed: "personal-motion-quality-blind-v1-fixed-seed",
      runId: "personal-blind-rust-qlt1-v1",
    });
    return;
  }
  if (mode === "infer") {
    await runFrozenBlindPlan({
      planPath: "data/workflows/motion-quality-review/blind-inference-pack-v1.json",
      canonicalCorpusPath: "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/corpus/personal-rust-canonical-v2.json",
      profileArtifactPath: "data/workflows/client-realtime-agent/client-single-pass-v1/client-halpe26-cycle-aligned-profiles.json",
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
