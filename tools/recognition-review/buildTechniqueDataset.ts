import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { TechniqueReviewStore } from "./techniqueReview";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const trajectoryRoot = join(projectRoot, "data/workflows/action-trajectory-database/halpe26-v1");
  const queuePath = resolve(valueAfter("--queue") ?? join(trajectoryRoot, "technique-review-queue.json.gz"));
  const eventsPath = resolve(valueAfter("--events") ?? join(trajectoryRoot, "technique-review-events-v1.jsonl"));
  const outputPath = resolve(valueAfter("--output") ?? join(trajectoryRoot, "technique-training-dataset-v1.json"));
  const requireEligible = process.argv.includes("--require-eligible");
  const store = await TechniqueReviewStore.open({ queuePath, eventsPath });
  const dataset = store.trainingDataset();
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    status: dataset.status,
    promotionAllowed: dataset.promotionAllowed,
    ...dataset.stats,
  }, null, 2)}\n`);
  if (requireEligible && dataset.stats.eligibleRepCount === 0) process.exitCode = 2;
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
