import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { evaluatePoseKeypoints } from "./poseKeypointEvaluation";
import { PoseKeypointReviewStore } from "./poseKeypointReview";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const validationRoot = resolve(valueAfter("--root") ?? join(projectRoot, "data/pose-validation/front-bench-halpe26-v1"));
  const queuePath = resolve(valueAfter("--queue") ?? join(validationRoot, "pose-keypoint-review-queue-v1.json.gz"));
  const eventsPath = resolve(valueAfter("--events") ?? join(validationRoot, "pose-keypoint-review-events-v1.jsonl"));
  const outputPath = resolve(valueAfter("--output") ?? join(validationRoot, "pose-keypoint-evaluation-v1.json"));
  const store = await PoseKeypointReviewStore.open({ queuePath, eventsPath, assetRoot: validationRoot });
  const report = evaluatePoseKeypoints(store.evaluationDataset());
  await atomicWrite(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    status: report.status,
    researchMetricPass: report.researchMetricPass,
    humanReviewedItemCount: report.stats.humanReviewedItemCount,
    queueItemCount: report.stats.queueItemCount,
    rustPckAtTenPercentTorso: report.metrics.rustCanonical.pckAtThreshold.rate,
    rustUsableJointFrameRate: report.metrics.rustCanonical.usableJointFrameRate.rate,
    falseMeasuredOverclaimRate: report.metrics.falseMeasuredOverclaim.rate,
    metricFailures: report.metricFailures,
    blockedReasons: report.blockedReasons,
  }, null, 2)}\n`);
  const requireResearchPassing = process.argv.includes("--require-research-passing");
  if (requireResearchPassing && !report.researchMetricPass) process.exitCode = 2;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, body, "utf8");
  await rename(temporaryPath, path);
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing value for ${flag}`);
  return value;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
