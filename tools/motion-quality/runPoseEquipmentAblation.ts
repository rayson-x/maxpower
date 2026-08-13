import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  RustCanonicalWasmSession,
  computeRustExerciseProfileHash,
  instantiateRustMotionWasm,
  type RustEquipmentObservation,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { DecodedRustQualityProposal } from "../../src/motion/motionPacket";
import type { PoseCandidateEstimate } from "../../src/pose/PoseEngine";
import {
  freezePredictions,
  scoreFrozenBlindRun,
  type AlignmentMetrics,
  type BlindEvaluationReport,
  type FrozenPredictionRun,
  type InjectedContextPrediction,
  type PersonalGoldenDataset,
  type PersonalGoldenRecord,
  type TruthFreePlan,
} from "./blindEvaluation";
import {
  freezeFusionPolicy,
  type FusionAblationCandidate,
  type FusionCandidateId,
} from "./fusionAblation";
import { routeSourceFramesOnce } from "./rustFullDataProposalRunner";
import {
  equipmentFramesByTimestamp,
  loadBenchEquipmentSidecar,
  loadInputCatalog,
  loadRawObservationSidecar,
  loadSourceIndependentBenchProfiles,
  measuredAxisToEquipmentObservation,
  pinInputBytes,
  rawFrameCandidates,
  sha256,
  type BenchEquipmentFrame,
  type InputAssetPin,
  type RawObservationFrame,
  type SourceIndependentBenchProfileEntry,
} from "./runnerInputs";

export type AblationMode = FusionCandidateId;

const MODES = [
  "pose_only",
  "equipment_only",
  "pose_equipment_fused",
] as const satisfies readonly AblationMode[];

const PROFILE_FAMILY_ID = "barbell_bench_press/source-independent-ablation-family/v1";
const PACKET_SCHEMA = "MOTN/1.8+QLT1";

interface FrozenTruthSplitRecord extends Omit<PersonalGoldenRecord, "segments"> {
  readonly segments: readonly Readonly<{ startMs: number; endMs: number }>[];
}

export interface FrozenStartEndTruthSplit {
  readonly schemaVersion: "maxpower-start-end-truth-split/v1";
  readonly contexts: readonly FrozenTruthSplitRecord[];
  readonly truthSplitHash: string;
  readonly forbiddenFieldsConsumed: readonly [];
}

interface FrozenEndpoint {
  readonly kind: string;
  readonly occurredTimestampMs: number;
  readonly causalConfirmedTimestampMs: number;
  readonly evidenceChannels: readonly string[];
}

interface FrozenAblationRep {
  readonly repId: string;
  readonly startMs: number;
  readonly turnaroundMs: number;
  readonly endMs: number;
  readonly disposition: "confirmed" | "needs_review" | "rejected";
  readonly observationFindings: readonly string[];
  readonly endpoints: readonly FrozenEndpoint[];
  readonly conclusionStates: readonly string[];
}

interface FrozenModeContext {
  readonly sourceCaptureId: string;
  readonly contextId: string;
  readonly actionId: "barbell_bench_press";
  readonly capturePosition: string;
  readonly status: "executed" | "unsupported";
  readonly unsupportedReason: string | null;
  readonly profileFamilyId: typeof PROFILE_FAMILY_ID;
  readonly installedProfile: Readonly<{
    identity: string;
    contentHash: string;
    stateMachineId: string;
  }> | null;
  readonly processing: Readonly<{
    chronologicalMonotonic: true;
    singlePass: true;
    submittedFrameCount: number;
    firstTimestampMs: number | null;
    lastTimestampMs: number | null;
    frameScheduleHash: string;
  }>;
  readonly observationSetHash: string;
  readonly rawObservationSha256: string;
  readonly equipmentObservationSha256: string | null;
  readonly channelLineage: Readonly<Record<string, unknown>>;
  readonly rustEngineVersion: string;
  readonly packetHash: string;
  readonly proposalHash: string;
  readonly reps: readonly FrozenAblationRep[];
}

interface FrozenModeRun {
  readonly candidateId: AblationMode;
  readonly channelLineage: Readonly<Record<string, unknown>>;
  readonly contexts: readonly FrozenModeContext[];
  readonly frozenRun: FrozenPredictionRun;
}

interface FrozenAblationInference {
  readonly schemaVersion: "maxpower-bench-pose-equipment-ablation-predictions/v1";
  readonly state: "frozen_before_truth";
  readonly runId: string;
  readonly sourcePlanDigest: string;
  readonly profileFamilyId: typeof PROFILE_FAMILY_ID;
  readonly modes: readonly FrozenModeRun[];
  readonly reproducibility: Readonly<{
    inputAssets: readonly InputAssetPin[];
    inputAssetManifestSha256: string;
  }>;
  readonly limitations: readonly string[];
  readonly frozenDigest: string;
}

interface CandidateMetrics {
  readonly candidateId: AblationMode;
  readonly actionId: "barbell_bench_press";
  readonly capturePosition: string;
  readonly status: "executed" | "unsupported";
  readonly contextCount: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly exactSetRate: number | null;
  readonly meanAbsoluteStartErrorMs: number | null;
  readonly meanAbsoluteEndErrorMs: number | null;
  readonly endpointCoverage: number | null;
  readonly endpointProposalCount: number;
  readonly truthRepCount: number;
  readonly evidenceConflictRate: number | null;
  readonly conflictRepCount: number;
  readonly abstentionRate: number | null;
  readonly abstentionCount: number;
  readonly conclusionCount: number;
  readonly p90ConfirmationLatencyMs: number | null;
  readonly confirmationLatencyScope: "all_canonical_endpoints";
  readonly observationSetHash: string;
  readonly frameScheduleHash: string;
  readonly truthSplitHash: string;
  readonly channelLineage: Readonly<Record<string, unknown>>;
}

export function ablationFrameCandidates(
  frame: RawObservationFrame,
  mode: AblationMode,
): readonly PoseCandidateEstimate[] {
  const measured = rawFrameCandidates(frame);
  if (mode !== "equipment_only") return measured;
  return Object.freeze(measured.map((candidate) => ({
    ...candidate,
    torsoColor: [0, 0, 0] as const,
    landmarks: candidate.landmarks.map(() => ({
      x: 0,
      y: 0,
      z: 0,
      visibility: 0,
    })),
    worldLandmarks: [],
  })));
}

/** Copies only the admitted human start/end fields. Historical peaks never enter this object. */
export function freezeStartEndTruthSplit(
  records: readonly PersonalGoldenRecord[],
): Readonly<FrozenStartEndTruthSplit> {
  const contexts = [...records].sort((left, right) => left.captureId.localeCompare(right.captureId))
    .map((record): FrozenTruthSplitRecord => ({
      captureId: record.captureId,
      sourceCaptureId: record.sourceCaptureId,
      exerciseId: record.exerciseId,
      capturePosition: record.capturePosition,
      expectedCount: record.expectedCount,
      evaluationWindow: record.evaluationWindow,
      source: record.source,
      segments: Object.freeze((record.segments ?? []).map((segment) => Object.freeze({
        startMs: segment.startMs,
        endMs: segment.endMs,
      }))),
    }));
  const semantic: Omit<FrozenStartEndTruthSplit, "truthSplitHash"> = {
    schemaVersion: "maxpower-start-end-truth-split/v1" as const,
    contexts: Object.freeze(contexts),
    forbiddenFieldsConsumed: Object.freeze([]) as readonly [],
  };
  return deepFreeze({
    ...semantic,
    truthSplitHash: sha256(stableStringify(semantic)),
  });
}

export function buildRowNoWinnerScope(): Readonly<{
  scope: Readonly<{ actionId: "barbell_row"; capturePosition: "all" }>;
  status: "no_winner";
  selectedCandidateId: null;
  candidates: readonly [];
  missingEvidence: "no_frozen_row_equipment_sidecar";
  limitations: readonly string[];
}> {
  return deepFreeze({
    scope: { actionId: "barbell_row" as const, capturePosition: "all" as const },
    status: "no_winner" as const,
    selectedCandidateId: null,
    candidates: Object.freeze([]) as readonly [],
    missingEvidence: "no_frozen_row_equipment_sidecar" as const,
    limitations: [
      "No row equipment sidecar is frozen under the governed input catalog.",
      "Bench policy is not transferred to row.",
    ],
  });
}

export async function runPoseEquipmentAblationInference(input: Readonly<{
  planPath: string;
  rawObservationRoot: string;
  benchEquipmentObservationRoot: string;
  sourceIndependentBenchProfilePath: string;
  governanceInputCatalogPath: string;
  wasmPath: string;
  outputPath: string;
  runId: string;
}>): Promise<Readonly<FrozenAblationInference>> {
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const planBytes = await readFile(resolve(input.planPath));
  const plan = JSON.parse(planBytes.toString("utf8")) as TruthFreePlan;
  assertTruthFreePlan(plan);
  const wasmBytes = await readFile(resolve(input.wasmPath));
  const independentProfiles = await loadSourceIndependentBenchProfiles(
    input.sourceIndependentBenchProfilePath,
    catalogLoaded.value,
  );
  const benchSources = plan.sources.map((source) => ({
    ...source,
    contexts: source.contexts.filter((context) => context.actionId === "barbell_bench_press"),
  })).filter((source) => source.contexts.length > 0);
  if (benchSources.length !== 6 || benchSources.some((source) => source.contexts.length !== 1)) {
    throw new Error(`expected six single-context bench sources, received ${benchSources.length}`);
  }

  const pins: InputAssetPin[] = [
    catalogLoaded.pin,
    pinInputBytes(catalogLoaded.value, "blindPlan", input.planPath, planBytes),
    pinInputBytes(catalogLoaded.value, "rustWasm", input.wasmPath, wasmBytes),
    independentProfiles.pin,
  ];
  const modeContexts = new Map<AblationMode, FrozenModeContext[]>(
    MODES.map((mode) => [mode, []]),
  );
  const modePredictions = new Map<AblationMode, InjectedContextPrediction[]>(
    MODES.map((mode) => [mode, []]),
  );

  for (const source of benchSources) {
    const context = source.contexts[0]!;
    const raw = await loadRawObservationSidecar(
      input.rawObservationRoot,
      source.sourceCaptureId,
      catalogLoaded.value,
    );
    pins.push(raw.pin);
    const equipmentLoaded = await loadOptionalBenchEquipment(
      input.benchEquipmentObservationRoot,
      source.sourceCaptureId,
      catalogLoaded.value,
    );
    if (equipmentLoaded) pins.push(equipmentLoaded.pin);
    const equipmentByTimestamp = equipmentLoaded
      ? equipmentFramesByTimestamp(equipmentLoaded.value)
      : new Map<number, BenchEquipmentFrame>();
    const routed = routeSourceFramesOnce(raw.value.frames, [{
      captureId: context.contextId,
      startMs: context.inputWindow.fromTimestampMs,
      endMs: context.inputWindow.untilTimestampMs,
    }]);
    const frames = routed.map((entry) => entry.frame);
    if (frames.length === 0) throw new Error(`${context.contextId}: no raw frames in plan window`);
    const timestamps = frames.map((frame) => Math.round(frame.timestampMs));
    const frameScheduleHash = sha256(stableStringify(frames.map((frame) => ({
      frameNumber: frame.frameNumber,
      timestampMs: Math.round(frame.timestampMs),
    }))));
    const observationSetHash = sha256(stableStringify({
      sourceCaptureId: source.sourceCaptureId,
      rawObservationSha256: raw.pin.sha256,
      equipmentObservationSha256: equipmentLoaded?.pin.sha256 ?? null,
      inputWindow: context.inputWindow,
      frameScheduleHash,
    }));
    const baseProfile = independentProfiles.value.find((entry) => (
      entry.capturePosition === context.capturePosition
    ));

    for (const mode of MODES) {
      const lineage = channelLineage(mode);
      if (!baseProfile || ((mode === "equipment_only" || mode === "pose_equipment_fused")
          && !equipmentLoaded)) {
        const reason = !baseProfile
          ? `no_source_independent_profile_for_${context.capturePosition}`
          : "no_frozen_bench_equipment_sidecar";
        const unsupported = unsupportedModeContext({
          sourceCaptureId: source.sourceCaptureId,
          contextId: context.contextId,
          capturePosition: context.capturePosition,
          reason,
          timestamps,
          frameScheduleHash,
          observationSetHash,
          rawSha256: raw.pin.sha256,
          equipmentSha256: equipmentLoaded?.pin.sha256 ?? null,
          lineage,
        });
        modeContexts.get(mode)!.push(unsupported.context);
        modePredictions.get(mode)!.push(unsupported.prediction);
        continue;
      }
      const modeProfile = materializeModeProfile(baseProfile, mode);
      const wasm = await instantiateRustMotionWasm(wasmBytes);
      const motion = new RustCanonicalWasmSession({
        sequenceId: `${input.runId}:${mode}:${context.contextId}`,
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
      const installed = motion.installExerciseProfileData(modeProfile);
      motion.beginSet();
      const reps = new Map<string, (typeof motion.lastCompletedReps)[number]>();
      const proposals = new Map<string, Readonly<DecodedRustQualityProposal>>();
      const collect = (): void => {
        for (const rep of motion.lastCompletedReps) reps.set(rep.repId.toString(), rep);
        for (const proposal of motion.lastQualityProposals) proposals.set(proposal.proposalId, proposal);
      };
      for (const frame of frames) {
        const timestampMs = Math.round(frame.timestampMs);
        const equipment: readonly RustEquipmentObservation[] = mode === "pose_only"
          ? Object.freeze([])
          : measuredAxisToEquipmentObservation(
            equipmentByTimestamp.get(timestampMs)?.axis ?? null,
            frame.frameNumber + 1,
          );
        motion.processCandidates(
          ablationFrameCandidates(frame, mode),
          timestampMs,
          equipment,
        );
        collect();
        if (Number(motion.lastDecodedPacket?.sourceTimestampMs ?? -1) !== timestampMs) {
          throw new Error(`${context.contextId}/${mode}: Rust packet timestamp mismatch`);
        }
      }
      motion.finishSet();
      collect();
      const finalPacket = motion.lastDecodedPacket;
      if (!finalPacket) throw new Error(`${context.contextId}/${mode}: final Rust packet missing`);
      const frozenReps = [...reps.values()].map((rep): FrozenAblationRep => {
        const proposal = [...proposals.values()].find((candidate) => candidate.repId === Number(rep.repId));
        return Object.freeze({
          repId: rep.repId.toString(),
          startMs: Number(rep.startTimestampMs),
          turnaroundMs: Number(rep.peakTimestampMs),
          endMs: Number(rep.endTimestampMs),
          disposition: rep.disposition,
          observationFindings: Object.freeze([...rep.observationFindings]),
          endpoints: Object.freeze((proposal?.endpoints ?? []).map((endpoint) => Object.freeze({
            kind: endpoint.kind,
            occurredTimestampMs: endpoint.occurredTimestampMs,
            causalConfirmedTimestampMs: endpoint.causalConfirmedTimestampMs,
            evidenceChannels: Object.freeze([...endpoint.evidenceChannels]),
          }))),
          conclusionStates: Object.freeze((proposal?.conclusions ?? []).map((item) => item.state)),
        });
      });
      const proposalJson = [...proposals.values()];
      const packetHash = sha256(stableStringify({
        canonicalHash: motion.lastCanonicalHash.toString(16),
        reps: frozenReps,
        proposals: proposalJson,
      }));
      const proposalHash = sha256(stableStringify(proposalJson));
      const profileHash = installed.contentHash.toString(16).padStart(16, "0");
      const frozenContext: FrozenModeContext = deepFreeze({
        sourceCaptureId: source.sourceCaptureId,
        contextId: context.contextId,
        actionId: "barbell_bench_press" as const,
        capturePosition: context.capturePosition,
        status: "executed" as const,
        unsupportedReason: null,
        profileFamilyId: PROFILE_FAMILY_ID,
        installedProfile: {
          identity: installed.identity,
          contentHash: profileHash,
          stateMachineId: modeProfile.stateMachineId,
        },
        processing: {
          chronologicalMonotonic: true as const,
          singlePass: true as const,
          submittedFrameCount: timestamps.length,
          firstTimestampMs: timestamps[0] ?? null,
          lastTimestampMs: timestamps.at(-1) ?? null,
          frameScheduleHash,
        },
        observationSetHash,
        rawObservationSha256: raw.pin.sha256,
        equipmentObservationSha256: equipmentLoaded?.pin.sha256 ?? null,
        channelLineage: lineage,
        rustEngineVersion: finalPacket.lineage.algorithmVersion,
        packetHash,
        proposalHash,
        reps: Object.freeze(frozenReps),
      });
      modeContexts.get(mode)!.push(frozenContext);
      modePredictions.get(mode)!.push(toInjectedPrediction(
        frozenContext,
        timestamps,
        raw.value.inference.pipeline,
        proposalJson,
      ));
      motion.close();
    }
  }

  const modes = MODES.map((mode): FrozenModeRun => {
    const contextsForMode = modeContexts.get(mode)!;
    const modeSources = benchSources.map((source) => ({
      ...source,
      contexts: source.contexts.map((context) => {
        const executed = contextsForMode.find((candidate) => candidate.contextId === context.contextId);
        if (!executed) throw new Error(`${context.contextId}/${mode}: frozen context missing`);
        if (executed.status === "unsupported" || !executed.installedProfile) {
          return {
            ...context,
            capability: "unsupported" as const,
            bundle: null,
            selection: "no_legal_bundle" as const,
          };
        }
        return {
          ...context,
          bundle: {
            bundleId: `ablation/${mode}/${executed.installedProfile.identity}`,
            bundleHash: sha256(stableStringify(executed.installedProfile)),
            profileVersion: executed.installedProfile.identity,
            rulePackVersion: "rust-execution-assessment/qlt1",
          },
          selection: "legal_bundle" as const,
        };
      }),
    }));
    const miniPlan: TruthFreePlan = {
      ...plan,
      runId: `${input.runId}:${mode}`,
      sources: modeSources,
    };
    return deepFreeze({
      candidateId: mode,
      channelLineage: channelLineage(mode),
      contexts: Object.freeze(modeContexts.get(mode)!),
      frozenRun: freezePredictions(miniPlan, modePredictions.get(mode)!),
    });
  });
  assertLikeForLikeSchedules(modes);
  const inputAssets = uniquePins(pins);
  const semantic: Omit<FrozenAblationInference, "frozenDigest"> = {
    schemaVersion: "maxpower-bench-pose-equipment-ablation-predictions/v1" as const,
    state: "frozen_before_truth" as const,
    runId: input.runId,
    sourcePlanDigest: plan.planDigest,
    profileFamilyId: PROFILE_FAMILY_ID,
    modes: Object.freeze(modes),
    reproducibility: {
      inputAssets,
      inputAssetManifestSha256: sha256(stableStringify(inputAssets)),
    },
    limitations: [
      "No human start/end truth was opened by this inference command.",
      "Historical peakMs is neither loaded nor scored.",
      "Barbell axis sidecars are model proposals, not accepted equipment truth.",
      "equipment_only retains the selected subject bbox/identity while all 26 joint observations are unknown.",
      "Rust Motion SDK is the only Rep, turnaround and endpoint producer.",
    ],
  };
  const output = deepFreeze({
    ...semantic,
    frozenDigest: sha256(stableStringify(semantic)),
  });
  await writeFile(resolve(input.outputPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

export async function scorePoseEquipmentAblation(input: Readonly<{
  frozenPredictionPath: string;
  datasetPath: string;
  governanceInputCatalogPath: string;
  outputPath: string;
}>): Promise<Readonly<Record<string, unknown>>> {
  // Deliberately serial: validate the frozen-before-truth artifact before opening truth.
  const frozenBytes = await readFile(resolve(input.frozenPredictionPath));
  const frozen = JSON.parse(frozenBytes.toString("utf8")) as FrozenAblationInference;
  assertFrozenAblation(frozen);

  const datasetBytes = await readFile(resolve(input.datasetPath));
  const dataset = JSON.parse(datasetBytes.toString("utf8")) as PersonalGoldenDataset;
  const contextIds = new Set(frozen.modes[0]?.contexts.map((context) => context.contextId) ?? []);
  const benchRecords = dataset.records.filter((record) => contextIds.has(record.captureId));
  if (benchRecords.length !== 6 || benchRecords.some((record) => record.exerciseId !== "barbell_bench_press")) {
    throw new Error(`revealed truth must contain the same six bench contexts, got ${benchRecords.length}`);
  }
  const truthSplit = freezeStartEndTruthSplit(benchRecords);
  const sanitizedTruth: PersonalGoldenDataset = {
    schemaVersion: dataset.schemaVersion,
    records: truthSplit.contexts,
  };
  const reports = new Map<AblationMode, Readonly<BlindEvaluationReport>>();
  for (const mode of frozen.modes) {
    reports.set(mode.candidateId, scoreFrozenBlindRun(mode.frozenRun, sanitizedTruth));
  }
  const views = [...new Set(benchRecords.map((record) => record.capturePosition))].sort();
  const truthHashByView = new Map(views.map((view) => [
    view,
    freezeStartEndTruthSplit(benchRecords.filter((record) => record.capturePosition === view)).truthSplitHash,
  ]));
  const candidatesByView = views.map((view) => ({
    actionId: "barbell_bench_press" as const,
    capturePosition: view,
    candidates: frozen.modes.map((mode) => summarizeCandidate(
      mode,
      reports.get(mode.candidateId)!,
      view,
      truthHashByView.get(view)!,
    )),
  }));
  const policies = candidatesByView.map((bucket) => {
    const selectionCandidates = bucket.candidates
      .filter((candidate) => candidate.status === "executed")
      .map(toSelectionCandidate);
    return {
      ...freezeFusionPolicy(selectionCandidates),
      selectionNormalization: "null metric is normalized to gate failure (0; abstention 1) only inside policy selection",
    };
  });
  const catalogLoaded = await loadInputCatalog(input.governanceInputCatalogPath);
  const inputAssets = uniquePins([
    catalogLoaded.pin,
    pinInputBytes(catalogLoaded.value, "fullDataRun", input.frozenPredictionPath, frozenBytes),
    pinInputBytes(catalogLoaded.value, "humanRanges", input.datasetPath, datasetBytes),
  ]);
  const semantic = {
    schemaVersion: "maxpower-real-pose-equipment-ablation/v1" as const,
    runKind: "blind_single_pass_causal_ablation" as const,
    acceptanceEligible: false,
    productionPromotion: false,
    sourceFrozenDigest: frozen.frozenDigest,
    action: "barbell_bench_press" as const,
    contextCount: benchRecords.length,
    truth: {
      authority: "personal-human-rep-ranges-v2:startMs,endMs",
      truthSplitHash: truthSplit.truthSplitHash,
      forbiddenSignals: ["peakMs", "midpoint", "quality_note"],
      forbiddenFieldsConsumed: truthSplit.forbiddenFieldsConsumed,
      humanRangeCount: truthSplit.contexts.reduce((sum, record) => sum + record.segments.length, 0),
    },
    protocol: {
      candidatesFrozenBeforeTruthRead: true,
      rustWasmSoleRepAndEndpointProducer: true,
      chronologicalSinglePass: true,
      repeatedInterpretation: false,
      sameRawFrameScheduleAcrossCandidates: true,
      sameSourceIndependentProfileFamilyAcrossCandidates: PROFILE_FAMILY_ID,
      matching: "monotonic_start_end_dynamic_programming",
      maximumBoundaryErrorMs: 1500,
      minimumIntervalIoU: 0.1,
    },
    aggregateCandidates: frozen.modes.map((mode) => summarizeCandidate(
      mode,
      reports.get(mode.candidateId)!,
      null,
      truthSplit.truthSplitHash,
    )),
    candidatesByView,
    frozenPoliciesByExactView: policies,
    row: buildRowNoWinnerScope(),
    reproducibility: {
      inputAssets,
      inputAssetManifestSha256: sha256(stableStringify(inputAssets)),
      frozenInferenceInputAssets: frozen.reproducibility.inputAssets,
      frozenInferenceInputAssetManifestSha256: frozen.reproducibility.inputAssetManifestSha256,
    },
    claimBoundary: {
      acceptedClaims: [
        "rep_count",
        "start_end_alignment",
        "endpoint_proposal_coverage",
        "evidence_conflict",
        "abstention",
        "causal_confirmation_latency",
      ],
      prohibitedClaims: [
        "historical_peak_accuracy",
        "unreviewed_turnaround_accuracy",
        "unreviewed_action_quality_accuracy",
        "barbell_detector_accuracy",
        "strength_or_force",
      ],
    },
    limitations: [
      "All six captures are from one known participant; this is not cross-user generalization evidence.",
      "frontLeft45 contains one frozen capture and frontRight45 contains two; a selected candidate is exact-scope experimental evidence, not a production promotion.",
      "The barbell-axis input is proposal_only model evidence without accepted shaft truth, so this report evaluates Rep/start/end utility rather than detector accuracy.",
      "No historical peak or reviewed turnaround truth exists; turnaround accuracy and action-quality accuracy remain unclaimed.",
    ],
  };
  const output = deepFreeze({
    ...semantic,
    reportDigest: sha256(stableStringify(semantic)),
  });
  await writeFile(resolve(input.outputPath), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  return output;
}

function summarizeCandidate(
  mode: FrozenModeRun,
  report: Readonly<BlindEvaluationReport>,
  view: string | null,
  truthSplitHash: string,
): Readonly<CandidateMetrics> {
  const contexts = mode.contexts.filter((context) => view === null || context.capturePosition === view);
  const metrics = view === null
    ? report.aggregate
    : report.buckets.byView.find((bucket) => bucket.key === view)?.metrics;
  if (!metrics) throw new Error(`${mode.candidateId}/${view ?? "aggregate"}: metrics missing`);
  const reps = contexts.flatMap((context) => context.reps.filter((rep) => rep.disposition !== "rejected"));
  const truthRepCount = metrics.truthCount;
  const endpointProposalCount = reps.filter((rep) => rep.endpoints.length === 3).length;
  const conflictRepCount = reps.filter((rep) => (
    rep.observationFindings.includes("pose_equipment_turnaround_conflict")
  )).length;
  const conclusionStates = reps.flatMap((rep) => rep.conclusionStates);
  const abstentionCount = conclusionStates.filter((state) => (
    state === "cannot_judge" || state === "not_applicable"
  )).length;
  const confirmationLatencies = reps.flatMap((rep) => rep.endpoints.map((endpoint) => (
    endpoint.causalConfirmedTimestampMs - endpoint.occurredTimestampMs
  ))).filter((latency) => latency >= 0);
  const status = contexts.every((context) => context.status === "executed")
    ? "executed" as const
    : "unsupported" as const;
  return deepFreeze({
    candidateId: mode.candidateId,
    actionId: "barbell_bench_press" as const,
    capturePosition: view ?? "all",
    status,
    contextCount: contexts.length,
    precision: metrics.precision,
    recall: metrics.recall,
    exactSetRate: metrics.exactSetRate,
    meanAbsoluteStartErrorMs: metrics.meanAbsoluteStartErrorMs,
    meanAbsoluteEndErrorMs: metrics.meanAbsoluteEndErrorMs,
    endpointCoverage: truthRepCount === 0 ? null : Math.min(endpointProposalCount, truthRepCount) / truthRepCount,
    endpointProposalCount,
    truthRepCount,
    evidenceConflictRate: ratio(conflictRepCount, reps.length),
    conflictRepCount,
    abstentionRate: ratio(abstentionCount, conclusionStates.length),
    abstentionCount,
    conclusionCount: conclusionStates.length,
    p90ConfirmationLatencyMs: percentile(confirmationLatencies, 0.9),
    confirmationLatencyScope: "all_canonical_endpoints" as const,
    observationSetHash: sha256(stableStringify(contexts.map((context) => ({
      contextId: context.contextId,
      hash: context.observationSetHash,
    })).sort((left, right) => left.contextId.localeCompare(right.contextId)))),
    frameScheduleHash: sha256(stableStringify(contexts.map((context) => ({
      contextId: context.contextId,
      hash: context.processing.frameScheduleHash,
    })).sort((left, right) => left.contextId.localeCompare(right.contextId)))),
    truthSplitHash,
    channelLineage: mode.channelLineage,
  });
}

function toSelectionCandidate(candidate: CandidateMetrics): FusionAblationCandidate {
  return {
    actionId: candidate.actionId,
    capturePosition: candidate.capturePosition,
    candidateId: candidate.candidateId,
    observationSetHash: candidate.observationSetHash,
    frameScheduleHash: candidate.frameScheduleHash,
    truthSplitHash: candidate.truthSplitHash,
    precision: candidate.precision ?? 0,
    recall: candidate.recall ?? 0,
    exactSetRate: candidate.exactSetRate ?? 0,
    endpointCoverage: candidate.endpointCoverage ?? 0,
    evidenceConflictRate: candidate.evidenceConflictRate ?? 0,
    abstentionRate: candidate.abstentionRate ?? 1,
    p90ConfirmationLatencyMs: candidate.p90ConfirmationLatencyMs ?? 2_000,
    ...(candidate.candidateId !== "equipment_only"
      ? { poseLineage: "independent_measured_pose" as const }
      : {}),
    ...(candidate.candidateId !== "pose_only"
      ? { equipmentLineage: "subject_associated_barbell_axis" as const }
      : {}),
  };
}

function materializeModeProfile(
  entry: SourceIndependentBenchProfileEntry,
  mode: AblationMode,
): RustExerciseProfileData {
  const base = entry.profile;
  const identityParts = base.identity.split("/");
  const identity = [...identityParts.slice(0, 4), `ablation-${mode.replaceAll("_", "-")}-v1`].join("/");
  const profileWithoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
    ...base,
    identity,
    stateMachineId: mode === "pose_only"
      ? "ready-effort-peak-return/v1"
      : "barbell-axis-primary-ready-effort-return/v1",
  };
  return Object.freeze({
    ...profileWithoutHash,
    contentHash: computeRustExerciseProfileHash(profileWithoutHash),
  });
}

function channelLineage(mode: AblationMode): Readonly<Record<string, unknown>> {
  if (mode === "pose_only") return deepFreeze({
    pose: "independent_raw_rtmpose_halpe26_measured",
    equipment: "withheld_by_ablation",
    subjectIdentity: "selected_raw_yolox_bbox_plus_pose",
    stateGraph: "source_independent_pose_ready_effort_peak_return",
  });
  if (mode === "equipment_only") return deepFreeze({
    pose: "withheld_joint_signal_all_26_landmarks_visibility_zero",
    equipment: "subject_associated_measured_barbell_axis_proposal",
    subjectIdentity: "selected_raw_yolox_bbox_only",
    stateGraph: "source_independent_barbell_axis_ready_effort_return",
  });
  return deepFreeze({
    pose: "independent_raw_rtmpose_halpe26_measured",
    equipment: "subject_associated_measured_barbell_axis_proposal",
    subjectIdentity: "selected_raw_yolox_bbox_plus_pose",
    stateGraph: "source_independent_barbell_axis_ready_effort_return_with_pose_corroboration",
    doubleCountingGuard: "equipment_constrained_pose_remains_predicted_and_is_not_independent_evidence",
  });
}

function toInjectedPrediction(
  context: FrozenModeContext,
  timestamps: readonly number[],
  visualModel: string,
  proposals: readonly Readonly<DecodedRustQualityProposal>[],
): InjectedContextPrediction {
  return {
    runKind: "blind_evaluation",
    sourceCaptureId: context.sourceCaptureId,
    contextId: context.contextId,
    processing: {
      chronologicalMonotonic: true,
      singlePass: true,
      sourceTimestampsMs: timestamps,
    },
    packetHash: context.packetHash,
    proposalHash: context.proposalHash,
    versions: {
      visualModel,
      rustEngine: context.rustEngineVersion,
      packetSchema: PACKET_SCHEMA,
      profileBundle: context.installedProfile?.identity ?? "none",
      rulePack: context.installedProfile ? "rust-execution-assessment/qlt1" : "none",
    },
    reps: context.reps.map((rep) => ({
      repId: rep.repId,
      startMs: rep.startMs,
      endMs: rep.endMs,
      turnaroundTimestampMs: rep.turnaroundMs,
      disposition: rep.disposition,
    })),
    qualityConclusions: proposals.flatMap((proposal) => proposal.conclusions.map((conclusion) => ({
      conclusionId: `${proposal.proposalId}:${conclusion.conclusionId}`,
      state: conclusion.state === "cannot_judge" || conclusion.state === "not_applicable"
        ? "abstained" as const
        : "proposed" as const,
      reviewStatus: "unreviewed" as const,
    }))),
  };
}

function unsupportedModeContext(input: Readonly<{
  sourceCaptureId: string;
  contextId: string;
  capturePosition: string;
  reason: string;
  timestamps: readonly number[];
  frameScheduleHash: string;
  observationSetHash: string;
  rawSha256: string;
  equipmentSha256: string | null;
  lineage: Readonly<Record<string, unknown>>;
}>): Readonly<{ context: FrozenModeContext; prediction: InjectedContextPrediction }> {
  const packetHash = sha256(stableStringify({ contextId: input.contextId, reason: input.reason }));
  const proposalHash = sha256("[]");
  const context: FrozenModeContext = deepFreeze({
    sourceCaptureId: input.sourceCaptureId,
    contextId: input.contextId,
    actionId: "barbell_bench_press" as const,
    capturePosition: input.capturePosition,
    status: "unsupported" as const,
    unsupportedReason: input.reason,
    profileFamilyId: PROFILE_FAMILY_ID,
    installedProfile: null,
    processing: {
      chronologicalMonotonic: true as const,
      singlePass: true as const,
      submittedFrameCount: 0,
      firstTimestampMs: input.timestamps[0] ?? null,
      lastTimestampMs: input.timestamps.at(-1) ?? null,
      frameScheduleHash: input.frameScheduleHash,
    },
    observationSetHash: input.observationSetHash,
    rawObservationSha256: input.rawSha256,
    equipmentObservationSha256: input.equipmentSha256,
    channelLineage: input.lineage,
    rustEngineVersion: "not_run_unsupported_input",
    packetHash,
    proposalHash,
    reps: Object.freeze([]),
  });
  return {
    context,
    prediction: toInjectedPrediction(context, input.timestamps, "not_run", []),
  };
}

function assertTruthFreePlan(plan: TruthFreePlan): void {
  if (plan.schemaVersion !== "maxpower-motion-quality-truth-free-plan/v1"
      || plan.runKind !== "blind_evaluation" || !Array.isArray(plan.sources)) {
    throw new Error("ablation requires a frozen truth-free blind plan");
  }
  const forbidden = new Set(["segments", "reps", "startMs", "endMs", "peakMs", "reviewDecision"]);
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key)) throw new Error(`truth-free plan leaked ${key}`);
        visit(child);
      }
    }
  };
  visit(plan);
}

function assertFrozenAblation(value: FrozenAblationInference): void {
  if (value.schemaVersion !== "maxpower-bench-pose-equipment-ablation-predictions/v1"
      || value.state !== "frozen_before_truth" || value.modes.length !== MODES.length) {
    throw new Error("frozen ablation artifact schema/state is invalid");
  }
  const { frozenDigest, ...semantic } = value;
  if (sha256(stableStringify(semantic)) !== frozenDigest) {
    throw new Error("frozen ablation artifact digest mismatch");
  }
  if (MODES.some((mode) => !value.modes.some((candidate) => candidate.candidateId === mode))) {
    throw new Error("frozen ablation candidate inventory is incomplete");
  }
  assertLikeForLikeSchedules(value.modes);
}

function assertLikeForLikeSchedules(modes: readonly FrozenModeRun[]): void {
  const reference = modes[0];
  if (!reference) throw new Error("ablation modes are empty");
  for (const context of reference.contexts) {
    for (const mode of modes.slice(1)) {
      const candidate = mode.contexts.find((entry) => entry.contextId === context.contextId);
      if (!candidate
          || candidate.processing.frameScheduleHash !== context.processing.frameScheduleHash
          || candidate.observationSetHash !== context.observationSetHash
          || candidate.processing.firstTimestampMs !== context.processing.firstTimestampMs
          || candidate.processing.lastTimestampMs !== context.processing.lastTimestampMs) {
        throw new Error(`${context.contextId}: ablation inputs or frame schedule differ by mode`);
      }
    }
  }
}

async function loadOptionalBenchEquipment(
  root: string,
  sourceCaptureId: string,
  catalog: Awaited<ReturnType<typeof loadInputCatalog>>["value"],
): Promise<Awaited<ReturnType<typeof loadBenchEquipmentSidecar>> | null> {
  try {
    return await loadBenchEquipmentSidecar(root, sourceCaptureId, catalog);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)] ?? null;
}

function uniquePins(pins: readonly InputAssetPin[]): readonly InputAssetPin[] {
  const byIdentity = new Map<string, InputAssetPin>();
  for (const pin of pins) byIdentity.set(`${pin.assetId}\u0000${pin.path}\u0000${pin.sha256}`, pin);
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

const DEFAULTS = Object.freeze({
  planPath: "data/workflows/motion-quality-review/blind-inference-pack-v1.json",
  rawObservationRoot: "data/workflows/action-trajectory-database/halpe26-v1/personal-observations",
  benchEquipmentObservationRoot: "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12/observations",
  sourceIndependentBenchProfilePath: "tools/motion-quality/source-independent-bench-profiles.json",
  governanceInputCatalogPath: "tools/motion-quality/data-governance-inputs.json",
  wasmPath: "public/motion-sdk/maxpower_motion_sdk.wasm",
  frozenPredictionPath: "data/workflows/motion-quality-review/bench-pose-equipment-ablation-predictions-before-truth-v1.json",
  datasetPath: "data/training/personal-golden-segmentation-v2.json",
  outputPath: "data/workflows/motion-quality-review/bench-pose-equipment-ablation-v1.json",
  runId: "bench-pose-equipment-ablation-v1",
});

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode === "infer" || mode === "run") {
    await runPoseEquipmentAblationInference({
      planPath: DEFAULTS.planPath,
      rawObservationRoot: DEFAULTS.rawObservationRoot,
      benchEquipmentObservationRoot: DEFAULTS.benchEquipmentObservationRoot,
      sourceIndependentBenchProfilePath: DEFAULTS.sourceIndependentBenchProfilePath,
      governanceInputCatalogPath: DEFAULTS.governanceInputCatalogPath,
      wasmPath: DEFAULTS.wasmPath,
      outputPath: DEFAULTS.frozenPredictionPath,
      runId: DEFAULTS.runId,
    });
    if (mode === "infer") return;
  }
  if (mode === "score" || mode === "run") {
    await scorePoseEquipmentAblation({
      frozenPredictionPath: DEFAULTS.frozenPredictionPath,
      datasetPath: DEFAULTS.datasetPath,
      governanceInputCatalogPath: DEFAULTS.governanceInputCatalogPath,
      outputPath: DEFAULTS.outputPath,
    });
    return;
  }
  throw new Error("usage: runPoseEquipmentAblation infer|score|run");
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
