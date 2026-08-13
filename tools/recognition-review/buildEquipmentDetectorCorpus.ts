import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { EquipmentTrainingDataset } from "./equipmentReview";
import { buildEquipmentDetectorCorpus, stableJson } from "./equipmentDetectorCorpus";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const equipmentRoot = resolve(valueAfter("--equipment-root") ?? join(projectRoot, "data/equipment-validation/bar-axis-v1"));
  const datasetPath = resolve(valueAfter("--dataset") ?? join(equipmentRoot, "equipment-training-dataset-v1.json"));
  const outputRoot = resolve(valueAfter("--output") ?? join(equipmentRoot, "detector-corpus-v1"));
  const requireTrainable = process.argv.includes("--require-trainable");
  const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as EquipmentTrainingDataset;
  const corpus = await buildEquipmentDetectorCorpus({ dataset, assetRoot: equipmentRoot });
  const documents: Readonly<Record<string, unknown>> = {
    "annotations/train.coco.json": corpus.train,
    "annotations/validation.coco.json": corpus.validation,
    "evaluation/test-input.coco.json": corpus.testInput,
    "evaluation/test-truth.coco.json": corpus.testTruth,
    "training-plan.json": corpus.trainingPlan,
    "manifest.json": corpus.manifest,
  };
  for (const [relative, document] of Object.entries(documents)) {
    await atomicWrite(join(outputRoot, relative), stableJson(document));
  }
  process.stdout.write(`${JSON.stringify({
    outputRoot,
    corpusSha256: corpus.manifest.corpusSha256,
    status: corpus.manifest.status,
    productionPromotion: false,
    stats: corpus.manifest.stats,
    blockedReasons: corpus.manifest.blockedReasons,
  }, null, 2)}\n`);
  if (requireTrainable && corpus.manifest.status !== "research_candidate") process.exitCode = 2;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, path);
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
