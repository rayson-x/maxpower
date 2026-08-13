import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  prepareQualityAgentAbExperiment,
  type EventFrameExtractor,
} from "./qualityAgentAbExperiment";

test("A/B pack gives both Agents the same Rust reps without leaking truth across the seam", async (context) => {
  const root = join(process.cwd(), ".quality-agent-ab-test", `${Date.now()}-${Math.random()}`);
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, "media", "chest"), { recursive: true });
  await writeFile(join(root, "media", "chest", "capture.mp4"), "fixture");
  const pack = {
    packSha256: "pack-1",
    cases: [{
      captureId: "capture", sourceCaptureId: "capture", exerciseId: "barbell_bench_press",
      capturePosition: "frontLeft45", videoPath: "chest/capture.mp4",
    }],
  };
  const points = [5, 6, 7, 8, 9, 10, 11, 12].map((index) => ({
    index, x: 0.1 * index, y: 0.05 * index, confidence: 0.9, source: "measured", renderable: true,
  }));
  const prediction = {
    schemaVersion: "prediction/v1",
    packSha256: "pack-1",
    runtime: { pythonVisionUsed: false },
    cases: [{
      captureId: "capture", sourceCaptureId: "capture",
      preset: { exerciseId: "barbell_bench_press", capturePosition: "frontLeft45" },
      profileIdentity: "profile",
      reps: [
        { repId: "1", startMs: "1000", peakMs: "1500", endMs: "2000", disposition: "confirmed", evidenceReason: null, observationFindings: [] },
        { repId: "2", startMs: "2100", peakMs: "2300", endMs: "2500", disposition: "rejected", evidenceReason: "incomplete_cycle", observationFindings: [] },
      ],
      frames: [1_000, 1_500, 2_000].map((timestampMs) => ({
        timestampMs, frameValid: true, canonicalQuality: 0.9, targetState: "locked", phase: "ready",
        rustCanonical: points, rustJointAngles: [], rustEquipment: null,
      })),
      executionAssessment: {
        dimensions: { phaseControl: { semantics: { startToPeak: "eccentric", peakToEnd: "concentric" } } },
        reps: [{ repId: "1", observation: { validFrameRate: 1 } }],
      },
    }],
  };
  const packPath = join(root, "pack.json");
  const predictionPath = join(root, "prediction.json");
  await writeFile(packPath, JSON.stringify(pack));
  await writeFile(predictionPath, JSON.stringify(prediction));
  const extractor: EventFrameExtractor = {
    async extract(input) { await writeFile(input.outputPath, `${input.label}:${input.timestampMs}`); },
    async contactSheet(input) { await writeFile(input.outputPath, input.imagePaths.join("\n")); },
  };
  const outputDir = join(root, "output");
  const manifest = await prepareQualityAgentAbExperiment({
    predictionPath, testPackPath: packPath, outputDir, mediaRoot: join(root, "media"), frameExtractor: extractor,
  });
  const multimodal = JSON.parse(await readFile(join(outputDir, "multimodal-input.json"), "utf8"));
  const trajectory = JSON.parse(await readFile(join(outputDir, "trajectory-input.json"), "utf8"));
  assert.equal(manifest.truthIsolation.timelineTruthAvailableToAgents, false);
  assert.equal(multimodal.cases[0].repCount, 1);
  assert.equal(trajectory.cases[0].repCount, 1);
  assert.equal(multimodal.cases[0].reps[0].screenshots.length, 2);
  assert.equal(trajectory.cases[0].reps[0].samples.length, 16);
  assert.equal(JSON.stringify(multimodal).includes("truthSegments"), false);
  assert.equal(JSON.stringify(trajectory).includes("truthSegments"), false);
  assert.equal("imagePath" in trajectory.cases[0].reps[0], false);
  assert.equal(JSON.stringify(multimodal).includes("rustCanonical"), false);
});
