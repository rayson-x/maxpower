import fs from "node:fs";
import path from "node:path";

import { instantiateRustMotionWasm } from "../../src/motion/rustCanonicalWasm";
import { trainMmFitProfiles, type RollingTrainingArtifact } from "./rollingProfileTrainer";

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const normalizedRoot = path.resolve(process.argv[2] ?? "data/external/mm-fit/normalized");
  const outputPath = path.resolve(process.argv[3] ?? "docs/reports/mmfit-rolling-profile-training-2026-08-09.json");
  const candidateDiscoveryRoot = path.resolve(process.argv[4] ?? "data/external/mm-fit/native-mediapipe33-heavy");
  const checkpointPath = path.join(normalizedRoot, "candidate-profiles.checkpoint.json");
  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(projectRoot, "public/motion-sdk/maxpower_motion_sdk.wasm")),
  );
  let completed = 0;
  const write = (artifact: RollingTrainingArtifact, destination: string) => {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(artifact, null, 2)}\n`);
  };
  const artifact = await trainMmFitProfiles({
    normalizedRoot,
    candidateDiscoveryRoot,
    orientationAnalysisPath: path.join(normalizedRoot, "body-orientation-analysis.json"),
    wasm,
    onCheckpoint: (partial) => {
      completed += 1;
      write(partial, checkpointPath);
      const bucket = partial.buckets.at(-1)!;
      process.stdout.write(`[${completed}] ${bucket.bucketId}: ${bucket.status}${bucket.acceptedCandidateId ? ` accepted=${bucket.acceptedCandidateId}` : ""}\n`);
    },
  });
  write(artifact, outputPath);
  write({
    ...artifact,
    buckets: artifact.buckets.filter((bucket) => bucket.candidateProfile),
  }, path.join(normalizedRoot, "candidate-profiles.json"));
  process.stdout.write(`${JSON.stringify({ outputPath, candidateDiscoveryRoot, observationDomains: artifact.observationDomains, coverage: artifact.coverage, aggregate: artifact.aggregate }, null, 2)}\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
