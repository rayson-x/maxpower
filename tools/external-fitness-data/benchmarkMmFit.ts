import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile";
import { recommendCapturePosition } from "../../src/pose/viewGating";

interface ManifestClip {
  clipFile: string;
  sourceSequenceId: string;
  subjectId: string;
  split: "train" | "validation" | "test" | "unseen_test" | "unknown";
  sourceAction: string;
  exerciseId: string;
  expectedCount: number;
  frameCount: number;
}
interface Manifest {
  poseDomain?: string;
  modelAssetSha256?: string;
  mediapipeRuntimeVersion?: string;
  delegate?: string;
  landmarkerOptions?: object;
  extractorVersion?: string;
  clips: ManifestClip[];
}
interface OrientationAnalysis { clips: Array<{ sourceSequenceId: string; bodyOrientationProxy: string }> }
interface CandidateArtifact {
  buckets: Array<{
    bucketId: string;
    candidateProfile: (Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string }) | null;
    selectedCandidateProfile?: (Omit<RustExerciseProfileData, "contentHash"> & { contentHash: string });
  }>;
}
interface Clip {
  sourceSequenceId: string;
  exerciseId: string;
  label: { totalRepetitions: number };
  frames: Array<{ timestampMs: number; landmarks: Array<{ x: number; y: number; z: number; visibility: number }> }>;
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const normalizedRoot = path.resolve(process.argv[2] ?? "data/external/mm-fit/normalized");
  const reportPath = path.resolve(process.argv[3] ?? "docs/reports/mmfit-rust-profile-benchmark-2026-08-09.json");
  const candidatePath = process.argv[4] ? path.resolve(process.argv[4]) : null;
  const orientationAnalysisPath = process.argv[5]
    ? path.resolve(process.argv[5])
    : path.join(normalizedRoot, "body-orientation-analysis.json");
  const candidateSelectionMode = process.argv[6] === "selected" ? "selected" : "validation-gated";
  const manifest = JSON.parse(fs.readFileSync(path.join(normalizedRoot, "manifest.json"), "utf8")) as Manifest;
  const nativeMediaPipe = manifest.poseDomain === "mmfit_mediapipe33_heavy_cpu";
  const orientationBySequence = candidatePath
    ? new Map((JSON.parse(fs.readFileSync(orientationAnalysisPath, "utf8")) as OrientationAnalysis).clips.map((clip) => [clip.sourceSequenceId, clip.bodyOrientationProxy]))
    : new Map<string, string>();
  const candidateByBucket = candidatePath
    ? new Map(
      (JSON.parse(fs.readFileSync(candidatePath, "utf8")) as CandidateArtifact).buckets.flatMap((bucket) => {
        const stored = candidateSelectionMode === "selected"
          ? bucket.selectedCandidateProfile
          : bucket.candidateProfile;
        return stored
          ? [[bucket.bucketId, {
            ...stored,
            contentHash: BigInt(stored.contentHash),
          } as RustExerciseProfileData] as const]
          : [];
      }),
    )
    : new Map<string, RustExerciseProfileData>();
  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(projectRoot, "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  const rows = manifest.clips.map((item) => {
    const clip = JSON.parse(gunzipSync(fs.readFileSync(path.join(normalizedRoot, item.clipFile))).toString("utf8")) as Clip;
    const capturePosition = recommendCapturePosition(clip.exerciseId)?.position ?? "front";
    const bodyOrientationProxy = orientationBySequence.get(item.sourceSequenceId);
    const candidateProfile = bodyOrientationProxy
      ? candidateByBucket.get(`${clip.exerciseId}/body-orientation-${bodyOrientationProxy}`)
      : undefined;
    const profile = candidateProfile ?? resolveSimulatedRecognitionProfile({
      exerciseId: clip.exerciseId,
      capturePosition,
      trainingSide: "bilateral",
      variation: "",
    });
    if (!profile) {
      return { ...item, capturePosition, status: "profile_missing" as const, predictedCount: null };
    }
    const session = new RustCanonicalWasmSession({
      sequenceId: `mmfit-research:${clip.sourceSequenceId}`,
      schema: "blazepose33",
      image: { widthPx: 1280, heightPx: 720, rotationDegrees: 0, mirrored: false },
      stabilization: "raw",
    }, wasm);
    session.installExerciseProfileData(profile);
    let confirmed = 0;
    let needsReview = 0;
    let rejected = 0;
    const evidenceReasons: Record<string, number> = {};
    const observationFindings: Record<string, number> = {};
    const completedReps: Array<{
      disposition: string;
      evidenceReason: string | null;
      observationFindings: readonly string[];
      startTimestampMs: number;
      peakTimestampMs: number;
      endTimestampMs: number;
    }> = [];
    for (const frame of clip.frames) {
      session.process({
        timestampMs: frame.timestampMs,
        landmarks: frame.landmarks,
        worldLandmarks: [],
      });
      for (const rep of session.lastCompletedReps) {
        if (rep.disposition === "confirmed") confirmed += 1;
        else if (rep.disposition === "needs_review") needsReview += 1;
        else rejected += 1;
        if (rep.evidenceReason) evidenceReasons[rep.evidenceReason] = (evidenceReasons[rep.evidenceReason] ?? 0) + 1;
        for (const finding of rep.observationFindings) observationFindings[finding] = (observationFindings[finding] ?? 0) + 1;
        completedReps.push({
          disposition: rep.disposition,
          evidenceReason: rep.evidenceReason,
          observationFindings: rep.observationFindings,
          startTimestampMs: Number(rep.startTimestampMs),
          peakTimestampMs: Number(rep.peakTimestampMs),
          endTimestampMs: Number(rep.endTimestampMs),
        });
      }
    }
    session.close();
    return {
      ...item,
      capturePosition,
      bodyOrientationProxy: bodyOrientationProxy ?? "unknown",
      status: "evaluated" as const,
      profileIdentity: profile.identity,
      profileSource: candidateProfile
        ? candidateSelectionMode === "selected" ? "mmfit-train-selected-research-candidate" : "mmfit-validation-gated-candidate"
        : "initializer",
      predictedCount: confirmed,
      needsReviewCount: needsReview,
      rejectedCount: rejected,
      evidenceReasons,
      observationFindings,
      completedReps,
      absoluteError: Math.abs(confirmed - clip.label.totalRepetitions),
    };
  });
  const evaluated = rows.filter((row): row is Extract<typeof rows[number], { status: "evaluated" }> => row.status === "evaluated");
  const summarize = (group: typeof evaluated) => ({
    clipCount: group.length,
    truthRepCount: group.reduce((sum, row) => sum + row.expectedCount, 0),
    predictedRepCount: group.reduce((sum, row) => sum + (row.predictedCount ?? 0), 0),
    meanAbsoluteCountError: group.length ? round(group.reduce((sum, row) => sum + row.absoluteError, 0) / group.length) : null,
    exactCountRatio: group.length ? round(group.filter((row) => row.predictedCount === row.expectedCount).length / group.length) : null,
    offByOneRatio: group.length ? round(group.filter((row) => row.absoluteError <= 1).length / group.length) : null,
  });
  const actionIds = [...new Set(evaluated.map((row) => row.exerciseId))].sort();
  const report = {
    schemaVersion: "maxpower-external-rust-profile-benchmark/v1",
    generatedAt: new Date().toISOString(),
    datasetId: "mm-fit",
    evidenceBoundary: {
      cameraView: "unknown",
      bodyOrientationProxy: "research-only proxy; not a physical capture position",
      annotationGranularity: "set_count",
      poseDomain: manifest.poseDomain ?? "mmfit_openpose18_mapped",
      sourcePoseTopology: nativeMediaPipe
        ? "native MediaPipe BlazePose33 Heavy"
        : "COCO-18 adapted by exact-joint mapping to BlazePose33",
      sourceConfidenceAvailable: nativeMediaPipe,
      poseExtraction: nativeMediaPipe ? {
        modelAssetSha256: manifest.modelAssetSha256,
        mediapipeRuntimeVersion: manifest.mediapipeRuntimeVersion,
        delegate: manifest.delegate,
        landmarkerOptions: manifest.landmarkerOptions,
        extractorVersion: manifest.extractorVersion,
      } : null,
      intendedUse: ["offline_research", "benchmarking", "candidate_profile_diagnostics"],
      forbiddenUse: ["production_profile_promotion", "form_reference"],
      promotionPassed: false,
      reason: nativeMediaPipe
        ? "MM-Fit provides set totals but no per-rep boundaries or exact MaxPower capture position; this CPU extraction remains a distinct observation domain from Android GPU inference."
        : "MM-Fit provides set totals but no per-rep boundaries, the supplied view is not an exact MaxPower capture position, and source poses are not produced by the mobile BlazePose runtime.",
    },
    profileSelection: candidatePath ? {
      mode: candidateSelectionMode === "selected"
        ? "train-selected-research-candidates-with-initializer-fallback"
        : "validation-gated-candidates-with-initializer-fallback",
      candidatePath,
      candidateSha256: createHash("sha256").update(fs.readFileSync(candidatePath)).digest("hex"),
      candidateBucketCount: candidateByBucket.size,
      independent: candidateSelectionMode !== "selected",
    } : { mode: "initializer-only" },
    summary: summarize(evaluated),
    bySplit: Object.fromEntries(["train", "validation", "test", "unseen_test"].map((split) => [split, summarize(evaluated.filter((row) => row.split === split))])),
    byExercise: Object.fromEntries(actionIds.map((exerciseId) => [exerciseId, summarize(evaluated.filter((row) => row.exerciseId === exerciseId))])),
    rows,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ reportPath, summary: report.summary, byExercise: report.byExercise }, null, 2)}\n`);
}

function round(value: number): number { return Math.round(value * 10_000) / 10_000; }

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
