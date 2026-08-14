import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { BenchPhaseReviewStore } from "./benchPhaseReview";
import { DumbbellReviewStore } from "./dumbbellReview";
import { EquipmentReviewStore } from "./equipmentReview";
import { PoseKeypointReviewStore } from "./poseKeypointReview";
import { defaultRecognitionReviewOptions, RecognitionReviewRepository } from "./reviewData";
import { createRecognitionReviewServer } from "./server";
import { TechniqueReviewStore } from "./techniqueReview";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const v7GovernedAssets = await resolveV7GovernedAssets(projectRoot);
  const repository = await RecognitionReviewRepository.open(defaultRecognitionReviewOptions(projectRoot));
  const trajectoryRoot = join(projectRoot, "data/workflows/action-trajectory-database/halpe26-v1");
  const techniqueReviews = await TechniqueReviewStore.open({
    queuePath: process.env.MAXPOWER_TECHNIQUE_REVIEW_QUEUE ?? join(trajectoryRoot, "technique-review-queue.json.gz"),
    eventsPath: process.env.MAXPOWER_TECHNIQUE_REVIEW_EVENTS ?? join(trajectoryRoot, "technique-review-events-v1.jsonl"),
  });
  const equipmentRoot = join(projectRoot, "data/equipment-validation/bar-axis-v1");
  const equipmentReviews = await EquipmentReviewStore.open({
    queuePath: process.env.MAXPOWER_EQUIPMENT_REVIEW_QUEUE ?? join(equipmentRoot, "equipment-review-queue-v1.json.gz"),
    eventsPath: process.env.MAXPOWER_EQUIPMENT_REVIEW_EVENTS ?? join(equipmentRoot, "equipment-review-events-v1.jsonl"),
    assetRoot: process.env.MAXPOWER_EQUIPMENT_REVIEW_ASSETS ?? equipmentRoot,
  });
  const dumbbellRoot = join(projectRoot, "data/equipment-validation/mmfit-dumbbell-v1");
  const dumbbellReviews = await DumbbellReviewStore.open({
    queuePath: process.env.MAXPOWER_DUMBBELL_REVIEW_QUEUE ?? join(dumbbellRoot, "mmfit-dumbbell-review-queue-v1.json.gz"),
    eventsPath: process.env.MAXPOWER_DUMBBELL_REVIEW_EVENTS ?? join(dumbbellRoot, "mmfit-dumbbell-review-events-v1.jsonl"),
    assetRoot: process.env.MAXPOWER_DUMBBELL_REVIEW_ASSETS ?? dumbbellRoot,
  });
  const poseKeypointRoot = join(projectRoot, "data/pose-validation/front-bench-halpe26-v1");
  const poseKeypointReviews = await PoseKeypointReviewStore.open({
    queuePath: process.env.MAXPOWER_POSE_KEYPOINT_REVIEW_QUEUE ?? join(poseKeypointRoot, "pose-keypoint-review-queue-v1.json.gz"),
    eventsPath: process.env.MAXPOWER_POSE_KEYPOINT_REVIEW_EVENTS ?? join(poseKeypointRoot, "pose-keypoint-review-events-v1.jsonl"),
    assetRoot: process.env.MAXPOWER_POSE_KEYPOINT_REVIEW_ASSETS ?? poseKeypointRoot,
  });
  const benchPhaseRoot = join(projectRoot, "data/workflows/equipment-pose-alignment-prototype/front-bench-v1/run-2026-08-12");
  const benchPhaseReviews = await BenchPhaseReviewStore.open({
    datasetPath: process.env.MAXPOWER_BENCH_PHASE_DATASET ?? join(projectRoot, "data/workflows/pose-stack-comparison/front-bench-v1/run-2026-08-12/dataset/personal-golden-front-bench-v1.json"),
    predictionsPath: process.env.MAXPOWER_BENCH_PHASE_PREDICTIONS ?? join(benchPhaseRoot, "blind-bench-recognition/predictions-before-label-reveal.json"),
    observationsDir: process.env.MAXPOWER_BENCH_PHASE_OBSERVATIONS ?? join(benchPhaseRoot, "observations"),
    rustCanonicalPath: process.env.MAXPOWER_BENCH_PHASE_RUST_CANONICAL ?? join(projectRoot, "data/workflows/motion-profile/personal-halpe26-v1/run-2026-08-11/corpus/personal-rust-canonical-v2.json"),
    eventsPath: process.env.MAXPOWER_BENCH_PHASE_EVENTS ?? join(benchPhaseRoot, "bench-phase-review-events-v1.jsonl"),
    videoRoot: process.env.MAXPOWER_BENCH_PHASE_VIDEO_ROOT ?? join(projectRoot, "public/archives/confirmed-captures"),
  });
  const pagePath = resolve(projectRoot, "tools/recognition-review/public/index.html");
  const equipmentPagePath = resolve(projectRoot, "tools/recognition-review/public/equipment.html");
  const dumbbellPagePath = resolve(projectRoot, "tools/recognition-review/public/dumbbell.html");
  const poseKeypointPagePath = resolve(projectRoot, "tools/recognition-review/public/pose-keypoints.html");
  const benchPhasePagePath = resolve(projectRoot, "tools/recognition-review/public/bench-phase.html");
  const benchRandomTestPagePath = resolve(projectRoot, "tools/recognition-review/public/bench-random-test.html");
  const qualityReviewPagePath = resolve(projectRoot, "tools/recognition-review/public/quality-review.html");
  const v7AlignmentReviewPagePath = resolve(
    projectRoot,
    "tools/recognition-review/public/v7-alignment-review.html",
  );
  const v7AlignmentReviewAppPath = resolve(
    projectRoot,
    "tools/recognition-review/public/v7AlignmentReviewApp.js",
  );
  const qualityReviewReleasePath = resolve(
    projectRoot,
    process.env.MAXPOWER_QUALITY_REVIEW_RELEASE
      ?? "data/workflows/motion-quality/full-personal-corpus-v1/frozen-quality-review-release.json",
  );
  const benchRandomTestReportPath = resolve(benchPhaseRoot, "single-pass-random-v1/evaluation-after-truth.json");
  const benchRandomTestPredictionPath = resolve(benchPhaseRoot, "single-pass-random-v1/prediction-before-truth.json");
  const clientRealtimeAgentPagePath = resolve(projectRoot, "tools/client-realtime-agent/client-realtime-agent.html");
  const clientRealtimeAgentPackPath = resolve(
    projectRoot,
    process.env.MAXPOWER_CLIENT_REALTIME_AGENT_PACK_PATH
      ?? "data/workflows/client-realtime-agent/client-single-pass-v1/test-pack-before-truth.json",
  );
  const clientRealtimeAgentPredictionPath = resolve(
    projectRoot,
    process.env.MAXPOWER_CLIENT_REALTIME_AGENT_PREDICTION_PATH
      ?? "data/workflows/client-realtime-agent/client-single-pass-v1/client-prediction-before-truth.json",
  );
  const port = Number(process.env.MAXPOWER_RECOGNITION_REVIEW_PORT ?? 4318);
  const server = createRecognitionReviewServer({
    repository,
    techniqueReviews,
    equipmentReviews,
    dumbbellReviews,
    poseKeypointReviews,
    benchPhaseReviews,
    pagePath,
    equipmentPagePath,
    dumbbellPagePath,
    poseKeypointPagePath,
    benchPhasePagePath,
    benchRandomTestPagePath,
    benchRandomTestReportPath,
    benchRandomTestPredictionPath,
    qualityReviewPagePath,
    qualityReviewReleasePath,
    qualityReviewVideoRoot: process.env.MAXPOWER_QUALITY_REVIEW_VIDEO_ROOT
      ?? join(projectRoot, "public/archives/confirmed-captures"),
    v7AlignmentReview: {
      pagePath: v7AlignmentReviewPagePath,
      appPath: v7AlignmentReviewAppPath,
      reportPath: v7GovernedAssets.report.path,
      reportSha256: v7GovernedAssets.report.sha256,
      labelPath: v7GovernedAssets.labels.path,
      labelSha256: v7GovernedAssets.labels.sha256,
      poseRoot: v7GovernedAssets.pose.path,
      videoRoot: join(projectRoot, "public/archives/confirmed-captures"),
    },
    clientRealtimeAgentPagePath,
    clientRealtimeAgentPackPath,
    clientRealtimeAgentPredictionPath,
    clientRealtimeAgentVideoRoot: join(projectRoot, "public/archives/confirmed-captures"),
  });
  server.listen(port, "127.0.0.1", () => {
    const stats = repository.index().stats;
    const equipment = equipmentReviews.index() as { stats: { itemCount: number; submittedItems: number } };
    const dumbbell = dumbbellReviews.index() as { stats: { itemCount: number; submittedItems: number } };
    const poseKeypoint = poseKeypointReviews.index() as { stats: { itemCount: number; submittedItems: number } };
    const benchPhase = benchPhaseReviews.index() as { stats: { repCount: number; submittedCaptures: number; captureCount: number } };
    process.stdout.write(`[recognition-review] http://127.0.0.1:${port} · v9 wrist-constrained equipment /v9-wrist-constrained-equipment-review.html · personal ${stats.personalAnnotatedVideos} · MM-Fit ${stats.mmfitClips} · barbell ${equipment.stats.submittedItems}/${equipment.stats.itemCount} · dumbbell ${dumbbell.stats.submittedItems}/${dumbbell.stats.itemCount} · pose truth ${poseKeypoint.stats.submittedItems}/${poseKeypoint.stats.itemCount} · bench phase ${benchPhase.stats.submittedCaptures}/${benchPhase.stats.captureCount} (${benchPhase.stats.repCount} reps) · evidence read-only / labels append-only\n`);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

interface GovernedAssetLocation {
  readonly path: string;
  readonly sha256?: string;
}

async function resolveV7GovernedAssets(projectRoot: string): Promise<{
  report: { path: string; sha256: string };
  labels: { path: string; sha256: string };
  pose: { path: string };
}> {
  const catalogPath = resolve(
    projectRoot,
    process.env.MAXPOWER_TRAINING_DATA_GOVERNANCE_CATALOG
      ?? "../maxpower-training-data-governance/catalog/assets.json",
  );
  const catalog = JSON.parse(await readFile(catalogPath, "utf8")) as {
    assets?: Array<{
      id?: unknown;
      admission?: unknown;
      allowedTasks?: unknown;
      location?: GovernedAssetLocation & { root?: unknown };
    }>;
  };
  const requireAsset = (
    id: string,
    admission: string,
    requiredTask: string,
  ): GovernedAssetLocation => {
    const asset = catalog.assets?.find((candidate) => candidate.id === id);
    if (!asset || asset.admission !== admission || asset.location?.root !== "maxpower_source") {
      throw new Error(`governed v7 asset ${id} is not admitted`);
    }
    if (!Array.isArray(asset.allowedTasks) || !asset.allowedTasks.includes(requiredTask)) {
      throw new Error(`governed v7 asset ${id} does not allow ${requiredTask}`);
    }
    if (typeof asset.location.path !== "string" || !asset.location.path.trim()) {
      throw new Error(`governed v7 asset ${id} path is invalid`);
    }
    return asset.location;
  };
  const report = requireAsset(
    "current-rust-v9-wrist-constrained-equipment-alignment-report",
    "evaluation_only",
    "regression_diagnosis",
  );
  const labels = requireAsset("personal-human-rep-ranges-v2", "label_allowed", "rep_counting");
  const pose = requireAsset(
    "personal-native-rtmpose-halpe26-observations",
    "feature_only",
    "runtime_parity",
  );
  if (typeof report.sha256 !== "string" || typeof labels.sha256 !== "string") {
    throw new Error("governed v7 file asset hash is invalid");
  }
  return {
    report: { path: resolve(projectRoot, report.path), sha256: report.sha256 },
    labels: { path: resolve(projectRoot, labels.path), sha256: labels.sha256 },
    pose: { path: resolve(projectRoot, pose.path) },
  };
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
