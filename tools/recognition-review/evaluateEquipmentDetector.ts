import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  evaluateEquipmentDetector,
  stableJson,
  type CocoEquipmentDocument,
  type EquipmentDetectorCorpusManifest,
  type EquipmentDetectorPredictionDocument,
} from "./equipmentDetectorCorpus";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const corpusRoot = resolve(valueAfter("--corpus")
    ?? join(projectRoot, "data/equipment-validation/bar-axis-v1/detector-corpus-v1"));
  const manifestPath = resolve(valueAfter("--manifest") ?? join(corpusRoot, "manifest.json"));
  const truthPath = resolve(valueAfter("--truth") ?? join(corpusRoot, "evaluation/test-truth.coco.json"));
  const predictionsPath = resolve(requiredValueAfter("--predictions"));
  const outputPath = resolve(valueAfter("--output") ?? join(corpusRoot, "evaluation/frozen-evaluation.json"));
  const requirePassing = process.argv.includes("--require-passing");
  const report = evaluateEquipmentDetector({
    corpus: await json<EquipmentDetectorCorpusManifest>(manifestPath),
    testTruth: await json<CocoEquipmentDocument>(truthPath),
    predictions: await json<EquipmentDetectorPredictionDocument>(predictionsPath),
  });
  await atomicWrite(outputPath, stableJson(report));
  process.stdout.write(`${JSON.stringify({ outputPath, status: report.status, ...report.metrics }, null, 2)}\n`);
  if (requirePassing && report.status !== "pass") process.exitCode = 2;
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function atomicWrite(path: string, body: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, body, "utf8");
  await rename(temporary, path);
}

function requiredValueAfter(flag: string): string {
  const value = valueAfter(flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
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
