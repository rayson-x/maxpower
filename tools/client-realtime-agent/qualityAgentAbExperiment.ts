import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface QualityAgentAbExperimentInput {
  predictionPath: string;
  testPackPath: string;
  outputDir: string;
  mediaRoot: string;
  frameExtractor?: EventFrameExtractor;
}

export interface EventFrameExtractor {
  extract(input: {
    videoPath: string;
    timestampMs: number;
    label: string;
    outputPath: string;
  }): Promise<void>;
  contactSheet(input: { imagePaths: readonly string[]; outputPath: string }): Promise<void>;
}

interface FrozenPrediction {
  schemaVersion: string;
  packSha256: string;
  runtime: Record<string, unknown>;
  cases: FrozenCase[];
}

interface FrozenCase {
  captureId: string;
  sourceCaptureId: string;
  preset: { exerciseId: string; capturePosition: string };
  profileIdentity: string;
  reps: FrozenRep[];
  frames: RuntimeFrame[];
  executionAssessment: Record<string, unknown> & {
    dimensions?: {
      phaseControl?: {
        semantics?: { startToPeak: string; peakToEnd: string };
      };
    };
    reps?: Array<Record<string, unknown> & { repId?: string | number }>;
  };
}

interface FrozenRep {
  repId: string | number;
  startMs: string | number;
  peakMs: string | number;
  endMs: string | number;
  disposition: "confirmed" | "needs_review" | "rejected";
  evidenceReason: string | null;
  observationFindings: readonly string[];
}

interface RuntimeFrame {
  timestampMs: number;
  frameValid: boolean;
  canonicalQuality: number;
  targetState: string;
  phase: string;
  rustCanonical?: Array<{
    index: number;
    x: number | null;
    y: number | null;
    confidence: number;
    source: string;
    renderable: boolean;
  }>;
  rustJointAngles?: Array<{
    kind: string;
    side: string;
    valueDeg: number | null;
    confidence: number;
    source: string;
    judgeable: boolean;
  }>;
  rustEquipment?: Record<string, unknown> | null;
}

interface TestPack {
  packSha256: string;
  cases: Array<{
    captureId: string;
    sourceCaptureId: string;
    exerciseId: string;
    capturePosition: string;
    videoPath: string;
  }>;
}

export async function prepareQualityAgentAbExperiment(
  input: QualityAgentAbExperimentInput,
) {
  const prediction = JSON.parse(await readFile(resolve(input.predictionPath), "utf8")) as FrozenPrediction;
  const testPack = JSON.parse(await readFile(resolve(input.testPackPath), "utf8")) as TestPack;
  if (prediction.packSha256 !== testPack.packSha256) throw new Error("prediction_test_pack_hash_mismatch");
  const outputDir = resolve(input.outputDir);
  const mediaRoot = resolve(input.mediaRoot);
  const extractor = input.frameExtractor ?? new FfmpegEventFrameExtractor();
  await mkdir(outputDir, { recursive: true });

  const multimodalCases: Record<string, unknown>[] = [];
  const trajectoryCases: Record<string, unknown>[] = [];
  for (const testCase of prediction.cases) {
    const packCase = testPack.cases.find((candidate) => candidate.captureId === testCase.captureId);
    if (!packCase) throw new Error(`missing_test_pack_case:${testCase.captureId}`);
    if (packCase.exerciseId !== testCase.preset.exerciseId
      || packCase.capturePosition !== testCase.preset.capturePosition) {
      throw new Error(`preset_mismatch:${testCase.captureId}`);
    }
    const videoPath = resolve(mediaRoot, packCase.videoPath);
    if (!videoPath.startsWith(`${mediaRoot}/`)) throw new Error(`video_outside_media_root:${testCase.captureId}`);
    const semantics = testCase.executionAssessment.dimensions?.phaseControl?.semantics
      ?? { startToPeak: "to_extreme", peakToEnd: "from_extreme" };
    const eligibleReps = testCase.reps.filter((rep) => rep.disposition !== "rejected");
    const caseImageDir = join(outputDir, "multimodal-frames", testCase.captureId);
    await mkdir(caseImageDir, { recursive: true });
    const multimodalReps: Record<string, unknown>[] = [];
    const trajectoryReps: Record<string, unknown>[] = [];
    const sheetInputs: string[] = [];
    for (let index = 0; index < eligibleReps.length; index += 1) {
      const rep = eligibleReps[index];
      const repIndex = index + 1;
      const turnaroundMs = finiteTimestamp(rep.peakMs, "peakMs");
      const endMs = finiteTimestamp(rep.endMs, "endMs");
      const events = [
        { kind: `${semantics.startToPeak}_endpoint`, timestampMs: turnaroundMs },
        { kind: `${semantics.peakToEnd}_endpoint`, timestampMs: endMs },
      ];
      const screenshots = [];
      for (const event of events) {
        const fileName = `rep-${String(repIndex).padStart(2, "0")}-${event.kind}.jpg`;
        const outputPath = join(caseImageDir, fileName);
        const label = `R${repIndex} ${event.kind} ${event.timestampMs}ms`;
        await extractor.extract({ videoPath, timestampMs: event.timestampMs, label, outputPath });
        sheetInputs.push(outputPath);
        screenshots.push({
          event: event.kind,
          timestampMs: event.timestampMs,
          imagePath: outputPath,
          sha256: await sha256File(outputPath),
          provenance: "rust_predicted_event_time_not_human_truth",
        });
      }
      multimodalReps.push({
        repIndex,
        repId: rep.repId,
        disposition: rep.disposition,
        screenshots,
      });
      trajectoryReps.push({
        repIndex,
        repId: rep.repId,
        disposition: rep.disposition,
        evidenceReason: rep.evidenceReason,
        observationFindings: rep.observationFindings,
        startMs: finiteTimestamp(rep.startMs, "startMs"),
        turnaroundMs,
        endMs,
        semantics,
        assessment: assessmentForRep(testCase.executionAssessment, rep.repId),
        samples: resampleRepFrames(testCase.frames, rep, 16),
      });
    }
    const contactSheetPath = join(caseImageDir, "contact-sheet.jpg");
    await extractor.contactSheet({ imagePaths: sheetInputs, outputPath: contactSheetPath });
    multimodalCases.push({
      captureId: testCase.captureId,
      preset: testCase.preset,
      profileIdentity: testCase.profileIdentity,
      repCount: multimodalReps.length,
      contactSheetPath,
      contactSheetSha256: await sha256File(contactSheetPath),
      reps: multimodalReps,
    });
    trajectoryCases.push({
      captureId: testCase.captureId,
      preset: testCase.preset,
      profileIdentity: testCase.profileIdentity,
      repCount: trajectoryReps.length,
      reps: trajectoryReps,
    });
  }

  const common = {
    schemaVersion: "maxpower-quality-agent-ab-input/v1",
    sourcePredictionSha256: await sha256File(resolve(input.predictionPath)),
    sourcePackSha256: prediction.packSha256,
    truthExcluded: true,
    humanQualityLabelsExcluded: true,
    runtime: prediction.runtime,
    assessmentContract: qualityAssessmentContract(),
  };
  const multimodal = {
    ...common,
    arm: "multimodal_endpoint_frames",
    permittedEvidence: "two Rust-timed endpoint images per non-rejected rep plus preset",
    prohibitedEvidence: ["trajectory_numbers", "human_timeline_truth", "human_quality_truth", "video_reinspection"],
    cases: multimodalCases,
  };
  const trajectory = {
    ...common,
    arm: "text_llm_rust_trajectory",
    permittedEvidence: "Rust report and 16-node Halpe-26 trajectory samples per non-rejected rep",
    prohibitedEvidence: ["images", "video", "human_timeline_truth", "human_quality_truth"],
    cases: trajectoryCases,
  };
  const multimodalPath = join(outputDir, "multimodal-input.json");
  const trajectoryPath = join(outputDir, "trajectory-input.json");
  const outputContractPath = join(outputDir, "quality-agent-output-contract.json");
  await writeJson(multimodalPath, multimodal);
  await writeJson(trajectoryPath, trajectory);
  await writeJson(outputContractPath, qualityAgentOutputContract());
  const manifest = {
    schemaVersion: "maxpower-quality-agent-ab-experiment/v1",
    generatedAt: new Date().toISOString(),
    randomizationUnit: "same_frozen_capture_and_rust_rep",
    armA: {
      id: "multimodal_endpoint_frames",
      inputPath: multimodalPath,
      inputSha256: await sha256File(multimodalPath),
      caseCount: multimodalCases.length,
    },
    armB: {
      id: "text_llm_rust_trajectory",
      inputPath: trajectoryPath,
      inputSha256: await sha256File(trajectoryPath),
      caseCount: trajectoryCases.length,
    },
    outputContractPath,
    truthIsolation: {
      timelineTruthAvailableToAgents: false,
      qualityTruthAvailableToAgents: false,
      predictionRepeated: false,
      pythonVisionUsed: false,
    },
    scoring: {
      current: "agreement_and_coverage_only_blocked_no_quality_gold",
      accuracyRequires: "two_expert_blind_quality_labels_with_adjudication",
    },
  };
  const manifestPath = join(outputDir, "experiment-manifest.json");
  await writeJson(manifestPath, manifest);
  return { ...manifest, manifestPath };
}

export class FfmpegEventFrameExtractor implements EventFrameExtractor {
  async extract(input: { videoPath: string; timestampMs: number; label: string; outputPath: string }): Promise<void> {
    await mkdir(dirname(input.outputPath), { recursive: true });
    const rawPath = input.outputPath.replace(/\.jpg$/u, ".raw.jpg");
    await execFileAsync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", (input.timestampMs / 1_000).toFixed(3),
      "-i", input.videoPath,
      "-frames:v", "1",
      "-vf", "scale=640:-2",
      "-q:v", "2",
      rawPath,
    ]);
    await execFileAsync("magick", [
      rawPath,
      "-gravity", "south",
      "-background", "#000000B8",
      "-fill", "white",
      "-font", "/System/Library/Fonts/SFNS.ttf",
      "-pointsize", "22",
      "-splice", "0x42",
      "-annotate", "+0+8", input.label,
      input.outputPath,
    ]);
    await rm(rawPath, { force: true });
  }

  async contactSheet(input: { imagePaths: readonly string[]; outputPath: string }): Promise<void> {
    if (!input.imagePaths.length) throw new Error("cannot_build_empty_contact_sheet");
    await execFileAsync("magick", [
      "montage", "-font", "/System/Library/Fonts/SFNS.ttf", ...input.imagePaths,
      "-thumbnail", "420x420>",
      "-tile", "2x",
      "-geometry", "+8+8",
      "-background", "#111517",
      input.outputPath,
    ]);
  }
}

function resampleRepFrames(frames: readonly RuntimeFrame[], rep: FrozenRep, count: number) {
  const startMs = finiteTimestamp(rep.startMs, "startMs");
  const endMs = finiteTimestamp(rep.endMs, "endMs");
  const within = frames.filter((frame) => frame.timestampMs >= startMs && frame.timestampMs <= endMs);
  if (!within.length) return [];
  return Array.from({ length: count }, (_, index) => {
    const targetMs = count === 1 ? startMs : startMs + (endMs - startMs) * index / (count - 1);
    const frame = within.reduce((closest, candidate) =>
      Math.abs(candidate.timestampMs - targetMs) < Math.abs(closest.timestampMs - targetMs) ? candidate : closest,
    );
    return {
      node: index,
      phaseProgress: count === 1 ? 0 : index / (count - 1),
      timestampMs: frame.timestampMs,
      frameValid: frame.frameValid,
      canonicalQuality: frame.canonicalQuality,
      targetState: frame.targetState,
      rustPhase: frame.phase,
      halpe26: (frame.rustCanonical ?? [])
        .filter((point) => point.index >= 5 && point.index <= 12)
        .map((point) => ({
          index: point.index,
          name: halpeName(point.index),
          x: point.x,
          y: point.y,
          confidence: point.confidence,
          source: point.source,
          renderable: point.renderable,
        })),
      jointAngles: frame.rustJointAngles ?? [],
      equipment: frame.rustEquipment ?? null,
    };
  });
}

function assessmentForRep(assessment: FrozenCase["executionAssessment"], repId: string | number) {
  return assessment.reps?.find((candidate) => String(candidate.repId) === String(repId)) ?? null;
}

function halpeName(index: number): string {
  return ["left_shoulder", "right_shoulder", "left_elbow", "right_elbow", "left_wrist", "right_wrist", "left_hip", "right_hip"][index - 5] ?? `point_${index}`;
}

function finiteTimestamp(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid_${field}`);
  return Math.round(parsed);
}

function qualityAssessmentContract() {
  return {
    noAggregateScore: true,
    dimensions: [
      "movementTaskCompletion",
      "techniqueAdherence",
      "visibleMovementStrategy",
      "stimulusCompatibility",
      "effortAndDoseContext",
      "range",
      "phaseControl",
      "supportStability",
      "bilateralCoordination",
      "trajectoryControl",
      "observationConfidence",
    ],
    allowedDimensionStatus: ["observed_acceptable", "observed_deviation", "cannot_judge"],
    rules: [
      "visible fact and coaching inference must be separate",
      "each non-cannot_judge claim names evidence refs",
      "still endpoint images cannot establish continuous phase control",
      "2d symmetry cannot establish equal force",
      "pose trajectory without equipment cannot establish barbell or dumbbell path",
      "no muscle activation, injury, pain, RPE or RIR inference from pixels or pose",
      "no total standardness score",
    ],
  };
}

function qualityAgentOutputContract() {
  return {
    schemaVersion: "maxpower-quality-agent-output/v1",
    required: ["schemaVersion", "arm", "cases", "limitations", "noAggregateScore"],
    case: {
      required: ["captureId", "preset", "reps", "setSummary"],
      rep: {
        required: ["repIndex", "taskClassification", "dimensions", "visibleFacts", "coachInferences", "primaryCue", "cannotJudgeReasons"],
        taskClassification: ["valid_rep", "not_a_rep", "cannot_judge"],
        dimensionStatus: ["observed_acceptable", "observed_deviation", "cannot_judge"],
        evidenceRefRequiredUnlessCannotJudge: true,
      },
    },
    noAggregateScore: true,
  };
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main(): Promise<void> {
  const predictionPath = process.argv[2];
  const testPackPath = process.argv[3];
  const outputDir = process.argv[4];
  if (!predictionPath || !testPackPath || !outputDir) {
    throw new Error("usage: qualityAgentAbExperiment <prediction.json> <test-pack.json> <output-dir> [media-root]");
  }
  const result = await prepareQualityAgentAbExperiment({
    predictionPath,
    testPackPath,
    outputDir,
    mediaRoot: process.argv[5] ?? "public/archives/confirmed-captures",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
