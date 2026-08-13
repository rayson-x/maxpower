import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

import {
  computeRustExerciseProfileHash,
  RustCanonicalWasmSession,
  type RustExerciseProfileData,
  type MotionWasmExports,
} from "../../src/motion/rustCanonicalWasm";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile";
import { getSimulatedKinematicPriorTemplate } from "../../src/pose/simulatedKinematicPrior";

type Split = "train" | "validation" | "test" | "unseen_test" | "unknown";
type BodyOrientationProxy = "front" | "oblique45" | "side" | "unknown";

export interface ManifestClip {
  readonly clipFile: string;
  readonly sourceSequenceId: string;
  readonly subjectId: string;
  readonly split: Split;
  readonly sourceAction: string;
  readonly exerciseId: string;
  readonly expectedCount: number;
  readonly frameCount: number;
  readonly clipSha256?: string;
}

interface PoseManifest {
  readonly schemaVersion?: string;
  readonly poseDomain?: string;
  readonly modelAssetSha256?: string;
  readonly delegate?: string;
  readonly extractorVersion?: string;
  readonly clips: readonly ManifestClip[];
}

interface NormalizedClip {
  readonly sourceSequenceId: string;
  readonly label: { readonly totalRepetitions: number };
  readonly frames: readonly {
    readonly timestampMs: number;
    readonly landmarks: readonly { readonly x: number; readonly y: number; readonly z: number; readonly visibility: number }[];
  }[];
}

interface OrientationClip {
  readonly sourceSequenceId: string;
  readonly bodyOrientationProxy: BodyOrientationProxy;
  readonly confidence: "high" | "medium" | "low";
}

export interface CountMetrics {
  readonly clipCount: number;
  readonly truthRepCount: number;
  readonly predictedRepCount: number;
  readonly meanAbsoluteCountError: number | null;
  readonly exactCountRatio: number | null;
  readonly offByOneRatio: number | null;
  readonly overcountClipCount: number;
}

interface ReplayRow {
  readonly sourceSequenceId: string;
  readonly split: Split;
  readonly expectedCount: number;
  readonly predictedCount: number;
  readonly needsReviewCount: number;
  readonly rejectedCount: number;
  readonly absoluteError: number;
}

export interface CandidateEvaluation {
  readonly candidateId: string;
  readonly metrics: CountMetrics;
}

export interface BucketResult {
  readonly bucketId: string;
  readonly exerciseId: string;
  readonly bodyOrientationProxy: BodyOrientationProxy;
  /** MM-Fit pose files do not expose a recoverable physical camera position. */
  readonly capturePosition: string | null;
  readonly initializerCapturePosition?: string | null;
  readonly clipCountsBySplit: Readonly<Record<Split, number>>;
  readonly candidateDiscoveryClipCount: number;
  readonly candidateDiscoverySequenceIds: readonly string[];
  readonly status: "trained" | "skipped";
  readonly reason?: string;
  readonly selectedCandidateId?: string;
  readonly acceptedCandidateId?: string | null;
  readonly validationGateStatus?: "passed" | "failed" | "unavailable";
  /** Best train-only research profile, retained even when the validation gate refuses it. */
  readonly selectedCandidateProfile?: SerializableProfile;
  readonly baseline?: Readonly<Record<"train" | "validation" | "test" | "unseen_test", CountMetrics>>;
  readonly selected?: Readonly<Record<"train" | "validation" | "test" | "unseen_test", CountMetrics>>;
  readonly trainCandidates?: readonly CandidateEvaluation[];
  readonly candidateProfile?: SerializableProfile | null;
}

export interface SerializableProfile extends Omit<RustExerciseProfileData, "contentHash"> {
  readonly contentHash: string;
  readonly researchOnly: true;
  readonly evidenceDataset: "mm-fit";
  readonly promotionPassed: false;
}

export interface RollingTrainingArtifact {
  readonly schemaVersion: "maxpower-external-rolling-profile-training/v3";
  readonly generatedAt: string;
  readonly datasetId: "mm-fit";
  readonly observationDomains: {
    readonly candidateDiscovery: ObservationDomainProvenance;
    readonly frozenEvaluation: ObservationDomainProvenance;
  };
  readonly selectionProtocol: object;
  readonly coverage: {
    readonly totalClipCount: number;
    readonly candidateDiscoveryClipCount: number;
    readonly trainedBucketCount: number;
    readonly acceptedBucketCount: number;
    readonly evaluatedClipCount: number;
  };
  readonly aggregate: {
    readonly baseline: CountMetrics;
    readonly selectedAfterValidationGate: CountMetrics;
  };
  readonly buckets: readonly BucketResult[];
}

export interface RollingTrainerInput {
  /** All-split mapped corpus used for validation, test, and unseen safeguards. */
  readonly normalizedRoot: string;
  /** Optional train-only native pose corpus used exclusively for candidate search. */
  readonly candidateDiscoveryRoot?: string;
  readonly orientationAnalysisPath: string;
  readonly wasm: MotionWasmExports;
  readonly minimumTrainClips?: number;
  readonly minimumValidationClips?: number;
  readonly onCheckpoint?: (artifact: RollingTrainingArtifact) => void;
}

export interface CandidateDiscoveryValidation {
  readonly clipCount: number;
  readonly sequenceIds: readonly string[];
}

interface ObservationDomainProvenance {
  readonly poseDomain: string;
  readonly splits: readonly (typeof SPLITS)[number][];
  readonly clipCount: number;
  readonly manifestSha256: string;
  readonly corpusSha256: string | null;
  readonly modelAssetSha256: string | null;
  readonly delegate: string | null;
  readonly extractorVersion: string | null;
}

interface ArtifactContext {
  readonly totalClipCount: number;
  readonly candidateDiscoveryClipCount: number;
  readonly observationDomains: RollingTrainingArtifact["observationDomains"];
}

interface LoadedClip {
  readonly manifest: ManifestClip;
  readonly clip: NormalizedClip;
}

interface Candidate {
  readonly id: string;
  readonly profile: RustExerciseProfileData;
}

const SPLITS = ["train", "validation", "test", "unseen_test"] as const;
const MAPPED_POSE_DOMAIN = "mmfit_openpose18_mapped";

/**
 * Refuse silent split leakage or partial native extraction. A separate RGB
 * candidate corpus must be a metadata-identical, train-only view of every
 * official train sequence in the mapped reference manifest.
 */
export function validateCandidateDiscoveryManifest(
  candidateClips: readonly ManifestClip[],
  evaluationClips: readonly ManifestClip[],
): CandidateDiscoveryValidation {
  const leaked = candidateClips.filter((clip) => clip.split !== "train");
  if (leaked.length) {
    throw new Error(`Candidate discovery manifest must be train-only; leaked=${leaked.map((clip) => `${clip.sourceSequenceId}:${clip.split}`).sort().join(",")}`);
  }
  const candidateById = uniqueClips(candidateClips, "candidate discovery");
  const expectedById = uniqueClips(evaluationClips.filter((clip) => clip.split === "train"), "evaluation train");
  const missing = [...expectedById.keys()].filter((id) => !candidateById.has(id)).sort();
  const unexpected = [...candidateById.keys()].filter((id) => !expectedById.has(id)).sort();
  if (missing.length || unexpected.length) {
    throw new Error(`Candidate discovery coverage mismatch: missing=${missing.join(",") || "none"}; unexpected=${unexpected.join(",") || "none"}`);
  }
  const metadataFields = ["subjectId", "split", "sourceAction", "exerciseId", "expectedCount"] as const;
  for (const [sourceSequenceId, candidate] of candidateById) {
    const expected = expectedById.get(sourceSequenceId)!;
    for (const field of metadataFields) {
      if (candidate[field] !== expected[field]) {
        throw new Error(`Candidate discovery metadata mismatch for ${sourceSequenceId}: ${field} expected=${expected[field]} actual=${candidate[field]}`);
      }
    }
  }
  return { clipCount: candidateClips.length, sequenceIds: [...candidateById.keys()].sort() };
}

export function verifyCandidateDiscoveryClipIntegrity(
  root: string,
  clips: readonly ManifestClip[],
): { readonly corpusSha256: string } {
  const resolvedRoot = path.resolve(root);
  const aggregate = createHash("sha256");
  for (const clip of [...clips].sort((a, b) => a.sourceSequenceId.localeCompare(b.sourceSequenceId))) {
    if (!clip.clipSha256?.match(/^[a-f0-9]{64}$/)) {
      throw new Error(`Candidate discovery clip is missing a valid clipSha256: ${clip.sourceSequenceId}`);
    }
    const file = path.resolve(resolvedRoot, clip.clipFile);
    if (file !== resolvedRoot && !file.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`Candidate discovery clip escapes its corpus root: ${clip.clipFile}`);
    }
    if (!fs.existsSync(file)) throw new Error(`Candidate discovery clip is missing: ${clip.clipFile}`);
    const actual = sha256File(file);
    if (actual !== clip.clipSha256) {
      throw new Error(`Candidate discovery clip SHA-256 mismatch for ${clip.sourceSequenceId}: expected=${clip.clipSha256} actual=${actual}`);
    }
    aggregate.update(clip.sourceSequenceId).update("\0").update(actual).update("\n");
  }
  return { corpusSha256: aggregate.digest("hex") };
}

/**
 * Deep offline training module: it owns lazy bucket loading, candidate search,
 * split isolation and the promotion refusal. The caller sees one artifact and
 * an optional checkpoint stream; no official profile store is writable here.
 */
export async function trainMmFitProfiles(input: RollingTrainerInput): Promise<RollingTrainingArtifact> {
  const evaluationRoot = path.resolve(input.normalizedRoot);
  const candidateDiscoveryRoot = path.resolve(input.candidateDiscoveryRoot ?? input.normalizedRoot);
  const evaluationManifestPath = path.join(evaluationRoot, "manifest.json");
  const candidateManifestPath = path.join(candidateDiscoveryRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(evaluationManifestPath, "utf8")) as PoseManifest;
  const separateCandidateCorpus = candidateDiscoveryRoot !== evaluationRoot;
  const candidateManifest = separateCandidateCorpus
    ? JSON.parse(fs.readFileSync(candidateManifestPath, "utf8")) as PoseManifest
    : manifest;
  if (separateCandidateCorpus && !candidateManifest.poseDomain) {
    throw new Error("Separate candidate discovery manifest must declare poseDomain");
  }
  const candidateClips = separateCandidateCorpus
    ? candidateManifest.clips
    : candidateManifest.clips.filter((clip) => clip.split === "train");
  const candidateValidation = validateCandidateDiscoveryManifest(candidateClips, manifest.clips);
  const candidateIntegrity = separateCandidateCorpus
    ? verifyCandidateDiscoveryClipIntegrity(candidateDiscoveryRoot, candidateClips)
    : null;
  const candidateBySequence = new Map(candidateClips.map((clip) => [clip.sourceSequenceId, clip]));
  const candidatePoseDomain = candidateManifest.poseDomain ?? MAPPED_POSE_DOMAIN;
  const evaluationPoseDomain = manifest.poseDomain ?? MAPPED_POSE_DOMAIN;
  const artifactContext: ArtifactContext = {
    totalClipCount: manifest.clips.length,
    candidateDiscoveryClipCount: candidateValidation.clipCount,
    observationDomains: {
      candidateDiscovery: {
        poseDomain: candidatePoseDomain,
        splits: ["train"],
        clipCount: candidateValidation.clipCount,
        manifestSha256: sha256File(candidateManifestPath),
        corpusSha256: candidateIntegrity?.corpusSha256 ?? null,
        modelAssetSha256: candidateManifest.modelAssetSha256 ?? null,
        delegate: candidateManifest.delegate ?? null,
        extractorVersion: candidateManifest.extractorVersion ?? null,
      },
      frozenEvaluation: {
        poseDomain: evaluationPoseDomain,
        splits: [...SPLITS],
        clipCount: manifest.clips.length,
        manifestSha256: sha256File(evaluationManifestPath),
        corpusSha256: null,
        modelAssetSha256: manifest.modelAssetSha256 ?? null,
        delegate: manifest.delegate ?? null,
        extractorVersion: manifest.extractorVersion ?? null,
      },
    },
  };
  const orientationAnalysis = JSON.parse(fs.readFileSync(input.orientationAnalysisPath, "utf8")) as { clips: OrientationClip[] };
  const orientationBySequence = new Map(orientationAnalysis.clips.map((clip) => [clip.sourceSequenceId, clip]));
  const buckets = groupByBucket(manifest.clips, orientationBySequence);
  const results: BucketResult[] = [];
  const baselineRows: ReplayRow[] = [];
  const selectedRows: ReplayRow[] = [];

  for (const [bucketId, entries] of [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const exerciseId = entries[0].manifest.exerciseId;
    const bodyOrientationProxy = entries[0].orientation.bodyOrientationProxy;
    const capturePosition = null;
    const clipCountsBySplit = splitCounts(entries.map((entry) => entry.manifest));
    const candidateDiscoveryEntries = entries
      .filter((entry) => entry.manifest.split === "train")
      .map((entry) => candidateBySequence.get(entry.manifest.sourceSequenceId)!);
    const candidateDiscoverySequenceIds = candidateDiscoveryEntries.map((entry) => entry.sourceSequenceId).sort();
    const minimumTrain = input.minimumTrainClips ?? 8;
    const minimumValidation = input.minimumValidationClips ?? 3;
    const initializer = resolveResearchInitializer(exerciseId);
    const baseProfile = initializer.profile;

    if (!baseProfile || candidateDiscoveryEntries.length < minimumTrain) {
      results.push({
        bucketId, exerciseId, bodyOrientationProxy, capturePosition,
        initializerCapturePosition: initializer.capturePosition,
        clipCountsBySplit, candidateDiscoveryClipCount: candidateDiscoveryEntries.length,
        candidateDiscoverySequenceIds, status: "skipped",
        reason: !baseProfile
          ? "No action initializer signal topology is available."
          : `Insufficient isolated candidate-discovery evidence (need train>=${minimumTrain}); validation safeguards never substitute for training clips.`,
      });
      input.onCheckpoint?.(makeArtifact(artifactContext, results, baselineRows, selectedRows));
      continue;
    }

    // Lazy seam: only this action-orientation bucket is inflated in memory.
    const loaded = entries.map(({ manifest: item }) => ({
      manifest: item,
      clip: loadClip(evaluationRoot, item),
    }));
    const candidates = candidateProfiles(baseProfile, exerciseId, bodyOrientationProxy);
    const training = separateCandidateCorpus
      ? candidateDiscoveryEntries.map((item) => ({ manifest: item, clip: loadClip(candidateDiscoveryRoot, item) }))
      : loaded.filter((entry) => entry.manifest.split === "train");
    const trainCandidates = candidates.map((candidate) => ({
      candidateId: candidate.id,
      metrics: summarize(replay(training, candidate.profile, input.wasm)),
    }));
    const selectedCandidate = candidates.find((candidate) => candidate.id === selectCandidate(trainCandidates).candidateId)!;
    const baselineCandidate = candidates[0];
    const baselineAllRows = replay(loaded, baselineCandidate.profile, input.wasm);
    const selectedAllRows = selectedCandidate.id === baselineCandidate.id
      ? baselineAllRows
      : replay(loaded, selectedCandidate.profile, input.wasm);
    const baselineBySplit = summarizeBySplit(baselineAllRows);
    const selectedBySplit = summarizeBySplit(selectedAllRows);
    const validationAvailable = clipCountsBySplit.validation >= minimumValidation;
    const accepted = validationAvailable
      && selectedCandidate.id !== "baseline"
      && passesValidationGate(baselineBySplit.validation, selectedBySplit.validation);
    const deployedBySplit = accepted ? selectedBySplit : baselineBySplit;

    baselineRows.push(...baselineAllRows);
    selectedRows.push(...(accepted ? selectedAllRows : baselineAllRows));

    results.push({
      bucketId, exerciseId, bodyOrientationProxy, capturePosition,
      initializerCapturePosition: initializer.capturePosition,
      clipCountsBySplit, candidateDiscoveryClipCount: training.length,
      candidateDiscoverySequenceIds, status: "trained",
      selectedCandidateId: selectedCandidate.id,
      acceptedCandidateId: accepted ? selectedCandidate.id : null,
      validationGateStatus: !validationAvailable ? "unavailable" : accepted ? "passed" : "failed",
      selectedCandidateProfile: serializeProfile(selectedCandidate.profile),
      baseline: baselineBySplit,
      selected: deployedBySplit,
      trainCandidates,
      candidateProfile: accepted ? serializeProfile(selectedCandidate.profile) : null,
    });
    input.onCheckpoint?.(makeArtifact(artifactContext, results, baselineRows, selectedRows));
  }

  return makeArtifact(artifactContext, results, baselineRows, selectedRows);
}

export function selectCandidate(evaluations: readonly CandidateEvaluation[]): CandidateEvaluation {
  if (!evaluations.length) throw new Error("At least one candidate evaluation is required");
  return [...evaluations].sort((a, b) => compareMetric(a.metrics, b.metrics))[0];
}

export function passesValidationGate(baseline: CountMetrics, candidate: CountMetrics): boolean {
  if (baseline.meanAbsoluteCountError === null || candidate.meanAbsoluteCountError === null) return false;
  if (candidate.predictedRepCount > candidate.truthRepCount * 1.05) return false;
  // Lower average error is not enough if fewer sets are counted exactly. That
  // pattern is usually a threshold trading one failure mode for another.
  if (
    candidate.meanAbsoluteCountError < baseline.meanAbsoluteCountError
    && (candidate.exactCountRatio ?? 0) >= (baseline.exactCountRatio ?? 0)
    && (candidate.offByOneRatio ?? 0) >= (baseline.offByOneRatio ?? 0)
  ) return true;
  return candidate.meanAbsoluteCountError === baseline.meanAbsoluteCountError
    && (candidate.exactCountRatio ?? 0) > (baseline.exactCountRatio ?? 0);
}

export function candidateProfiles(base: RustExerciseProfileData, exerciseId: string, orientation: BodyOrientationProxy): Candidate[] {
  const definitions = [
    { id: "baseline", rangeScale: 1, durationScale: 1, flipDirection: false },
    { id: "range-85", rangeScale: 0.85, durationScale: 1, flipDirection: false },
    { id: "range-70", rangeScale: 0.7, durationScale: 1, flipDirection: false },
    { id: "range-55", rangeScale: 0.55, durationScale: 1, flipDirection: false },
    { id: "fast", rangeScale: 1, durationScale: 2 / 3, flipDirection: false },
    { id: "range-85-fast", rangeScale: 0.85, durationScale: 2 / 3, flipDirection: false },
    { id: "range-70-fast", rangeScale: 0.7, durationScale: 2 / 3, flipDirection: false },
    { id: "direction-flip", rangeScale: 1, durationScale: 1, flipDirection: true },
    { id: "direction-flip-range-70", rangeScale: 0.7, durationScale: 1, flipDirection: true },
    { id: "direction-flip-range-70-fast", rangeScale: 0.7, durationScale: 2 / 3, flipDirection: true },
  ] as const;
  const scaledBaseline = definitions.map((definition) => {
    const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
      ...base,
      identity: `external-research-${exerciseId}/body-orientation-${orientation}/bilateral/mmfit/${definition.id}/v2`,
      direction: definition.flipDirection
        ? (base.direction === "increasing" ? "decreasing" : base.direction === "decreasing" ? "increasing" : "auto")
        : base.direction,
      startAmplitude: base.startAmplitude * definition.rangeScale,
      minPrimaryAmplitude: base.minPrimaryAmplitude * definition.rangeScale,
      minSecondaryAmplitude: base.minSecondaryAmplitude * definition.rangeScale,
      returnHysteresis: base.returnHysteresis * definition.rangeScale,
      readyTolerance: base.readyTolerance * definition.rangeScale,
      minRepDurationMs: Math.round(base.minRepDurationMs * definition.durationScale),
    };
    return { id: definition.id, profile: { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) } };
  });
  // Set-count corpora often crop a clip at the opposite resting extreme from
  // a human phase annotation (for example, top-to-top push-ups versus
  // bottom-to-bottom reviewed reps). Rust's auto direction learns the first
  // complete cycle's orientation from pose motion alone and then locks it for
  // the set; it does not inspect the expected count or synthesize a boundary.
  const automaticDefinitions = [
    { id: "direction-auto", rangeScale: 1, durationScale: 1 },
    { id: "direction-auto-range-85", rangeScale: 0.85, durationScale: 1 },
    { id: "direction-auto-range-70", rangeScale: 0.7, durationScale: 1 },
    { id: "direction-auto-range-55", rangeScale: 0.55, durationScale: 1 },
    { id: "direction-auto-fast", rangeScale: 1, durationScale: 2 / 3 },
    { id: "direction-auto-range-85-fast", rangeScale: 0.85, durationScale: 2 / 3 },
    { id: "direction-auto-range-70-fast", rangeScale: 0.7, durationScale: 2 / 3 },
    { id: "direction-auto-range-55-fast", rangeScale: 0.55, durationScale: 2 / 3 },
  ] as const;
  const automaticCandidates = (exerciseId === "push_up" ? automaticDefinitions : []).map((definition) => {
    const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
      ...base,
      identity: `external-research-${exerciseId}/body-orientation-${orientation}/bilateral/mmfit/${definition.id}/v2`,
      direction: "auto",
      startAmplitude: base.startAmplitude * definition.rangeScale,
      minPrimaryAmplitude: base.minPrimaryAmplitude * definition.rangeScale,
      minSecondaryAmplitude: base.minSecondaryAmplitude * definition.rangeScale,
      returnHysteresis: base.returnHysteresis * definition.rangeScale,
      readyTolerance: base.readyTolerance * definition.rangeScale,
      minRepDurationMs: Math.round(base.minRepDurationMs * definition.durationScale),
    };
    return { id: definition.id, profile: { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) } };
  });
  // In an oblique floor view, the far elbow can fold or disappear while the
  // near elbow retains a clean cycle. Duplicating one declared signal into
  // the bilateral evidence slots keeps the regular Rust graph and its auto
  // direction, while making the fixed-side assumption explicit in identity.
  const fixedSideAutoCandidates = exerciseId === "push_up"
    ? ([
      { id: "primary-side-direction-auto-fast", signal: base.primarySignal },
      { id: "secondary-side-direction-auto-fast", signal: base.secondarySignal },
    ] as const).map((definition) => {
      const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
        ...base,
        identity: `external-research-${exerciseId}/body-orientation-${orientation}/fixed-side/mmfit/${definition.id}/v2`,
        direction: "auto",
        primarySignal: definition.signal,
        secondarySignal: definition.signal,
        minRepDurationMs: Math.round(base.minRepDurationMs * 2 / 3),
      };
      return { id: definition.id, profile: { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) } };
    })
    : [];
  // Side views and partial self-occlusion can leave one anatomically valid
  // signal nearly static while the paired side carries the complete cycle.
  // Rust's alternating graph locks the stronger side for each active cycle;
  // it does not require literal left/right alternation, so it is also the
  // existing data-only representation for "either observable side".
  const visibleSideDefinitions = [
    { id: "visible-side", rangeScale: 1, durationScale: 1 },
    { id: "visible-side-range-70", rangeScale: 0.7, durationScale: 1 },
    { id: "visible-side-range-70-fast", rangeScale: 0.7, durationScale: 2 / 3 },
  ] as const;
  const visibleSideCandidates = visibleSideDefinitions.map((definition) => {
    const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
      ...base,
      identity: `external-research-${exerciseId}/body-orientation-${orientation}/visible-side/mmfit/${definition.id}/v2`,
      stateMachineId: "alternating-ready-effort-return/v1",
      startAmplitude: base.startAmplitude * definition.rangeScale,
      minPrimaryAmplitude: base.minPrimaryAmplitude * definition.rangeScale,
      minSecondaryAmplitude: base.minSecondaryAmplitude * definition.rangeScale,
      returnHysteresis: base.returnHysteresis * definition.rangeScale,
      readyTolerance: base.readyTolerance * definition.rangeScale,
      minRepDurationMs: Math.round(base.minRepDurationMs * definition.durationScale),
    };
    return { id: definition.id, profile: { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) } };
  });
  const normalizedDistance = normalizedDistanceSignal(exerciseId);
  if (!normalizedDistance) return [
    ...scaledBaseline,
    ...automaticCandidates,
    ...fixedSideAutoCandidates,
    ...visibleSideCandidates,
  ];
  const distanceDefinitions = [
    { id: "torso-distance-10", start: 0.03, peak: 0.10, hysteresis: 0.04, ready: 0.05 },
    { id: "torso-distance-18", start: 0.05, peak: 0.18, hysteresis: 0.06, ready: 0.07 },
    { id: "torso-distance-30", start: 0.08, peak: 0.30, hysteresis: 0.09, ready: 0.10 },
  ] as const;
  const distanceCandidates = distanceDefinitions.map((definition) => {
    const withoutHash: Omit<RustExerciseProfileData, "contentHash"> = {
      ...base,
      identity: `external-research-${exerciseId}/body-orientation-${orientation}/bilateral/mmfit/${definition.id}/v2`,
      coordinateUnit: "torso-normalized-distance",
      direction: normalizedDistance.direction,
      primarySignal: { kind: "landmark-distance", landmarks: normalizedDistance.primary },
      secondarySignal: { kind: "landmark-distance", landmarks: normalizedDistance.secondary },
      startAmplitude: definition.start,
      minPrimaryAmplitude: definition.peak,
      minSecondaryAmplitude: definition.peak,
      returnHysteresis: definition.hysteresis,
      readyTolerance: definition.ready,
      minRepDurationMs: 350,
    };
    return { id: definition.id, profile: { ...withoutHash, contentHash: computeRustExerciseProfileHash(withoutHash) } };
  });
  return [
    ...scaledBaseline,
    ...automaticCandidates,
    ...fixedSideAutoCandidates,
    ...visibleSideCandidates,
    ...distanceCandidates,
  ];
}

/**
 * Cross-person alternative signals. Distances are divided by Rust's stable
 * torso scale before entering the same canonical state machine, so camera
 * zoom and body size do not silently become exercise thresholds.
 */
function normalizedDistanceSignal(exerciseId: string): {
  readonly primary: readonly [number, number];
  readonly secondary: readonly [number, number];
  readonly direction: "increasing" | "decreasing";
} | null {
  switch (exerciseId) {
    case "bodyweight_squat":
    case "alternating_lunge":
      return { primary: [11, 27], secondary: [12, 28], direction: "decreasing" };
    case "dumbbell_shoulder_press":
      return { primary: [15, 23], secondary: [16, 24], direction: "increasing" };
    case "overhead_triceps_extension":
    case "lateral_raise":
      return { primary: [15, 11], secondary: [16, 12], direction: "increasing" };
    case "standing_dumbbell_row":
    case "alternating_dumbbell_biceps_curl":
      return { primary: [15, 11], secondary: [16, 12], direction: "decreasing" };
    case "sit_up":
      return { primary: [11, 25], secondary: [12, 26], direction: "decreasing" };
    default:
      return null;
  }
}

function replay(clips: readonly LoadedClip[], profile: RustExerciseProfileData, wasm: MotionWasmExports): ReplayRow[] {
  return clips.map(({ manifest, clip }) => {
    const session = new RustCanonicalWasmSession({
      sequenceId: `mmfit-train:${manifest.sourceSequenceId}`,
      schema: "blazepose33",
      image: { widthPx: 1280, heightPx: 720, rotationDegrees: 0, mirrored: false },
      stabilization: "raw",
    }, wasm);
    session.installExerciseProfileData(profile);
    let predictedCount = 0;
    let needsReviewCount = 0;
    let rejectedCount = 0;
    for (const frame of clip.frames) {
      session.process({ timestampMs: frame.timestampMs, landmarks: [...frame.landmarks], worldLandmarks: [] });
      for (const rep of session.lastCompletedReps) {
        if (rep.disposition === "confirmed") predictedCount += 1;
        else if (rep.disposition === "needs_review") needsReviewCount += 1;
        else rejectedCount += 1;
      }
    }
    session.close();
    return {
      sourceSequenceId: manifest.sourceSequenceId,
      split: manifest.split,
      expectedCount: clip.label.totalRepetitions,
      predictedCount,
      needsReviewCount,
      rejectedCount,
      absoluteError: Math.abs(predictedCount - clip.label.totalRepetitions),
    };
  });
}

function summarizeBySplit(rows: readonly ReplayRow[]): Record<(typeof SPLITS)[number], CountMetrics> {
  return Object.fromEntries(SPLITS.map((split) => [split, summarize(rows.filter((row) => row.split === split))])) as Record<(typeof SPLITS)[number], CountMetrics>;
}

function summarize(rows: readonly ReplayRow[]): CountMetrics {
  const truthRepCount = rows.reduce((sum, row) => sum + row.expectedCount, 0);
  const predictedRepCount = rows.reduce((sum, row) => sum + row.predictedCount, 0);
  return {
    clipCount: rows.length,
    truthRepCount,
    predictedRepCount,
    meanAbsoluteCountError: rows.length ? round(rows.reduce((sum, row) => sum + row.absoluteError, 0) / rows.length) : null,
    exactCountRatio: rows.length ? round(rows.filter((row) => row.predictedCount === row.expectedCount).length / rows.length) : null,
    offByOneRatio: rows.length ? round(rows.filter((row) => row.absoluteError <= 1).length / rows.length) : null,
    overcountClipCount: rows.filter((row) => row.predictedCount > row.expectedCount).length,
  };
}

function compareMetric(a: CountMetrics, b: CountMetrics): number {
  return (a.meanAbsoluteCountError ?? Number.POSITIVE_INFINITY) - (b.meanAbsoluteCountError ?? Number.POSITIVE_INFINITY)
    || a.overcountClipCount - b.overcountClipCount
    || (b.exactCountRatio ?? 0) - (a.exactCountRatio ?? 0)
    || (b.offByOneRatio ?? 0) - (a.offByOneRatio ?? 0);
}

function groupByBucket(clips: readonly ManifestClip[], orientationBySequence: ReadonlyMap<string, OrientationClip>) {
  const buckets = new Map<string, { manifest: ManifestClip; orientation: OrientationClip }[]>();
  for (const manifest of clips) {
    const orientation = orientationBySequence.get(manifest.sourceSequenceId) ?? {
      sourceSequenceId: manifest.sourceSequenceId, bodyOrientationProxy: "unknown" as const, confidence: "low" as const,
    };
    const bucketId = `${manifest.exerciseId}/body-orientation-${orientation.bodyOrientationProxy}`;
    const values = buckets.get(bucketId) ?? [];
    values.push({ manifest, orientation });
    buckets.set(bucketId, values);
  }
  return buckets;
}

function splitCounts(clips: readonly ManifestClip[]): Record<Split, number> {
  return {
    train: clips.filter((clip) => clip.split === "train").length,
    validation: clips.filter((clip) => clip.split === "validation").length,
    test: clips.filter((clip) => clip.split === "test").length,
    unseen_test: clips.filter((clip) => clip.split === "unseen_test").length,
    unknown: clips.filter((clip) => clip.split === "unknown").length,
  };
}

function uniqueClips(clips: readonly ManifestClip[], label: string): Map<string, ManifestClip> {
  const byId = new Map<string, ManifestClip>();
  const duplicates = new Set<string>();
  for (const clip of clips) {
    if (byId.has(clip.sourceSequenceId)) duplicates.add(clip.sourceSequenceId);
    byId.set(clip.sourceSequenceId, clip);
  }
  if (duplicates.size) throw new Error(`${label} manifest has duplicate sourceSequenceId values: ${[...duplicates].sort().join(",")}`);
  return byId;
}

function loadClip(root: string, item: ManifestClip): NormalizedClip {
  return JSON.parse(gunzipSync(fs.readFileSync(path.join(root, item.clipFile))).toString("utf8")) as NormalizedClip;
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function resolveResearchInitializer(exerciseId: string): {
  profile: RustExerciseProfileData | null;
  capturePosition: string | null;
} {
  const template = getSimulatedKinematicPriorTemplate(exerciseId);
  if (!template) return { profile: null, capturePosition: null };
  const fallbackCapturePosition = template.primaryCapturePosition;
  const fallback = resolveSimulatedRecognitionProfile({
    exerciseId, capturePosition: fallbackCapturePosition, trainingSide: "bilateral", variation: "",
  });
  return { profile: fallback, capturePosition: fallback ? fallbackCapturePosition : null };
}

function serializeProfile(profile: RustExerciseProfileData): SerializableProfile {
  return {
    ...profile,
    contentHash: profile.contentHash.toString(),
    researchOnly: true,
    evidenceDataset: "mm-fit",
    promotionPassed: false,
  };
}

function makeArtifact(
  context: ArtifactContext, buckets: readonly BucketResult[], baselineRows: readonly ReplayRow[], selectedRows: readonly ReplayRow[],
): RollingTrainingArtifact {
  const candidateDomain = context.observationDomains.candidateDiscovery.poseDomain;
  const evaluationDomain = context.observationDomains.frozenEvaluation.poseDomain;
  return {
    schemaVersion: "maxpower-external-rolling-profile-training/v3",
    generatedAt: new Date().toISOString(),
    datasetId: "mm-fit",
    observationDomains: context.observationDomains,
    selectionProtocol: {
      identity: `exercise_id × body_orientation_proxy × candidate_pose_domain(${candidateDomain})`,
      loading: "one bucket inflated at a time",
      selection: `candidate thresholds selected only on official subject train split in ${candidateDomain}`,
      acceptance: `cross-domain validation safeguard in ${evaluationDomain}: MAE must improve without reducing exact/off-by-one ratios, or tie with a higher exact ratio; >5% aggregate overcount is refused`,
      untouchedEvaluation: ["test", "unseen_test"],
      crossDomainValidation: candidateDomain !== evaluationDomain,
      candidateGrid: [
        "baseline", "range-85", "range-70", "range-55", "fast", "range-85-fast", "range-70-fast",
        "direction-flip", "direction-flip-range-70", "direction-flip-range-70-fast",
        "push_up:direction-auto", "push_up:direction-auto-range-85", "push_up:direction-auto-range-70", "push_up:direction-auto-range-55",
        "push_up:direction-auto-fast", "push_up:direction-auto-range-85-fast", "push_up:direction-auto-range-70-fast", "push_up:direction-auto-range-55-fast",
        "push_up:primary-side-direction-auto-fast", "push_up:secondary-side-direction-auto-fast",
        "visible-side", "visible-side-range-70", "visible-side-range-70-fast",
        "torso-distance-10", "torso-distance-18", "torso-distance-30",
      ],
      promotionPassed: false,
      refusal: "Set-count labels, adapted 2D joints, absent negative windows and unclear dataset licensing cannot promote a runtime profile.",
    },
    coverage: {
      totalClipCount: context.totalClipCount,
      candidateDiscoveryClipCount: context.candidateDiscoveryClipCount,
      trainedBucketCount: buckets.filter((bucket) => bucket.status === "trained").length,
      acceptedBucketCount: buckets.filter((bucket) => bucket.acceptedCandidateId).length,
      evaluatedClipCount: baselineRows.length,
    },
    aggregate: { baseline: summarize(baselineRows), selectedAfterValidationGate: summarize(selectedRows) },
    buckets,
  };
}

function round(value: number): number { return Math.round(value * 10_000) / 10_000; }
