import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { EquipmentReviewStore } from "./equipmentReview";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const equipmentRoot = join(projectRoot, "data/equipment-validation/bar-axis-v1");
  const queuePath = resolve(valueAfter("--queue") ?? join(equipmentRoot, "equipment-review-queue-v1.json.gz"));
  const eventsPath = resolve(valueAfter("--events") ?? join(equipmentRoot, "equipment-review-events-v1.jsonl"));
  const assetRoot = resolve(valueAfter("--assets") ?? equipmentRoot);
  const outputPath = resolve(valueAfter("--output") ?? join(equipmentRoot, "equipment-training-dataset-v1.json"));
  const requireTrainable = process.argv.includes("--require-trainable");
  const store = await EquipmentReviewStore.open({ queuePath, eventsPath, assetRoot });
  const dataset = store.trainingDataset();
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(temporaryPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    status: dataset.status,
    promotionAllowed: dataset.promotionAllowed,
    blockedReasons: dataset.blockedReasons,
    ...dataset.stats,
  }, null, 2)}\n`);
  if (requireTrainable && dataset.status !== "research_candidate") process.exitCode = 2;
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
