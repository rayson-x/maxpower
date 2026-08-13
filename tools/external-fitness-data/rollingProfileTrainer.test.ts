import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  candidateProfiles,
  passesValidationGate,
  selectCandidate,
  trainMmFitProfiles,
  validateCandidateDiscoveryManifest,
  verifyCandidateDiscoveryClipIntegrity,
  type CandidateEvaluation,
  type CountMetrics,
} from "./rollingProfileTrainer";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile";

function manifestClip(
  sourceSequenceId: string,
  split: "train" | "validation" | "test" | "unseen_test",
  overrides: Record<string, unknown> = {},
) {
  const subject = sourceSequenceId.split(":", 1)[0].slice(1);
  return {
    clipFile: `${sourceSequenceId.replace(":", "-")}.json.gz`,
    sourceSequenceId,
    subjectId: subject,
    split,
    sourceAction: "synthetic_action",
    exerciseId: "synthetic_exercise",
    expectedCount: 10,
    frameCount: 20,
    ...overrides,
  };
}

function metrics(overrides: Partial<CountMetrics> = {}): CountMetrics {
  return {
    clipCount: 10,
    truthRepCount: 100,
    predictedRepCount: 90,
    meanAbsoluteCountError: 1,
    exactCountRatio: 0.5,
    offByOneRatio: 0.8,
    overcountClipCount: 0,
    ...overrides,
  };
}

test("candidate selection prioritizes count error and then overcount safety", () => {
  const evaluations: CandidateEvaluation[] = [
    { candidateId: "baseline", metrics: metrics({ meanAbsoluteCountError: 2 }) },
    { candidateId: "overcount", metrics: metrics({ overcountClipCount: 3 }) },
    { candidateId: "safe", metrics: metrics({ exactCountRatio: 0.6 }) },
  ];
  assert.equal(selectCandidate(evaluations).candidateId, "safe");
});

test("validation gate accepts improvement but refuses aggregate overcount", () => {
  const baseline = metrics({ meanAbsoluteCountError: 2 });
  assert.equal(passesValidationGate(baseline, metrics({ meanAbsoluteCountError: 1 })), true);
  assert.equal(passesValidationGate(baseline, metrics({ meanAbsoluteCountError: 1, predictedRepCount: 106 })), false);
});

test("validation gate refuses lower MAE when exact-count reliability regresses", () => {
  const baseline = metrics({ meanAbsoluteCountError: 2, exactCountRatio: 0.5 });
  const candidate = metrics({ meanAbsoluteCountError: 1, exactCountRatio: 0.4 });
  assert.equal(passesValidationGate(baseline, candidate), false);
});

test("validation gate requires a strict exact-ratio improvement on an MAE tie", () => {
  const baseline = metrics();
  assert.equal(passesValidationGate(baseline, metrics({ exactCountRatio: 0.6 })), true);
  assert.equal(passesValidationGate(baseline, metrics({ exactCountRatio: 0.5 })), false);
});

test("candidate grid includes a per-cycle visible-side profile for side-view occlusion", () => {
  const base = resolveSimulatedRecognitionProfile({
    exerciseId: "bodyweight_squat",
    capturePosition: "left",
    trainingSide: "bilateral",
    variation: "",
  });
  assert.ok(base);
  const candidate = candidateProfiles(base, "bodyweight_squat", "unknown")
    .find((item) => item.id === "visible-side");
  assert.ok(candidate);
  assert.equal(candidate.profile.stateMachineId, "alternating-ready-effort-return/v1");
  assert.deepEqual(candidate.profile.primarySignal, base.primarySignal);
  assert.deepEqual(candidate.profile.secondarySignal, base.secondarySignal);
  assert.equal(candidate.profile.direction, base.direction);
});

test("candidate grid can learn either clip-boundary phase convention without label-aware counting", () => {
  const base = resolveSimulatedRecognitionProfile({
    exerciseId: "push_up",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
  });
  assert.ok(base);
  const candidates = candidateProfiles(base, "push_up", "oblique45");
  const automatic = candidates.find((item) => item.id === "direction-auto-range-70-fast");
  assert.ok(automatic);
  assert.equal(automatic.profile.direction, "auto");
  assert.equal(automatic.profile.stateMachineId, base.stateMachineId);
});

test("push-up grid can use one consistently visible elbow with auto direction", () => {
  const base = resolveSimulatedRecognitionProfile({
    exerciseId: "push_up",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
  });
  assert.ok(base);
  const candidates = candidateProfiles(base, "push_up", "oblique45");
  const primary = candidates.find((item) => item.id === "primary-side-direction-auto-fast");
  const secondary = candidates.find((item) => item.id === "secondary-side-direction-auto-fast");
  assert.ok(primary);
  assert.ok(secondary);
  assert.equal(primary.profile.direction, "auto");
  assert.deepEqual(primary.profile.primarySignal, base.primarySignal);
  assert.deepEqual(primary.profile.secondarySignal, base.primarySignal);
  assert.equal(secondary.profile.direction, "auto");
  assert.deepEqual(secondary.profile.primarySignal, base.secondarySignal);
  assert.deepEqual(secondary.profile.secondarySignal, base.secondarySignal);
});

test("native candidate discovery must exactly cover mapped official train IDs", () => {
  const evaluation = [
    manifestClip("w01:1", "train"),
    manifestClip("w02:1", "train"),
    manifestClip("w14:1", "validation"),
  ];
  const result = validateCandidateDiscoveryManifest([
    manifestClip("w02:1", "train"),
    manifestClip("w01:1", "train"),
  ], evaluation);
  assert.equal(result.clipCount, 2);
  assert.deepEqual(result.sequenceIds, ["w01:1", "w02:1"]);
});

test("candidate discovery rejects split leakage, incomplete coverage, and label drift", () => {
  const evaluation = [
    manifestClip("w01:1", "train"),
    manifestClip("w02:1", "train"),
    manifestClip("w14:1", "validation"),
  ];
  assert.throws(
    () => validateCandidateDiscoveryManifest([manifestClip("w14:1", "validation")], evaluation),
    /train-only/,
  );
  assert.throws(
    () => validateCandidateDiscoveryManifest([manifestClip("w01:1", "train")], evaluation),
    /missing=w02:1/,
  );
  assert.throws(
    () => validateCandidateDiscoveryManifest([
      manifestClip("w01:1", "train"),
      manifestClip("w02:1", "train", { expectedCount: 11 }),
    ], evaluation),
    /metadata mismatch.*expectedCount/,
  );
});

test("native candidate discovery verifies every compressed clip against its manifest hash", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxpower-mmfit-native-integrity-"));
  try {
    const payload = Buffer.from("native-pose-clip");
    fs.writeFileSync(path.join(root, "w01-1.json.gz"), payload);
    const clip = manifestClip("w01:1", "train", {
      clipSha256: createHash("sha256").update(payload).digest("hex"),
    });
    const result = verifyCandidateDiscoveryClipIntegrity(root, [clip]);
    assert.match(result.corpusSha256, /^[a-f0-9]{64}$/);
    fs.writeFileSync(path.join(root, "w01-1.json.gz"), "mutated");
    assert.throws(() => verifyCandidateDiscoveryClipIntegrity(root, [clip]), /SHA-256 mismatch/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("training artifact keeps native candidate discovery separate from mapped frozen evaluation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maxpower-mmfit-dual-domain-"));
  const evaluationRoot = path.join(root, "mapped");
  const candidateRoot = path.join(root, "native");
  fs.mkdirSync(evaluationRoot, { recursive: true });
  fs.mkdirSync(candidateRoot, { recursive: true });
  try {
    const train = manifestClip("w01:1", "train");
    const validation = manifestClip("w14:1", "validation");
    const nativePayload = Buffer.from("native-pose-clip");
    const candidateTrain = {
      ...train,
      clipSha256: createHash("sha256").update(nativePayload).digest("hex"),
    };
    fs.writeFileSync(path.join(evaluationRoot, "manifest.json"), JSON.stringify({ clips: [train, validation] }));
    fs.writeFileSync(path.join(evaluationRoot, "body-orientation-analysis.json"), JSON.stringify({ clips: [] }));
    fs.writeFileSync(path.join(candidateRoot, candidateTrain.clipFile), nativePayload);
    fs.writeFileSync(path.join(candidateRoot, "manifest.json"), JSON.stringify({
      poseDomain: "mmfit_mediapipe33_heavy_cpu",
      clips: [candidateTrain],
    }));
    const artifact = await trainMmFitProfiles({
      normalizedRoot: evaluationRoot,
      candidateDiscoveryRoot: candidateRoot,
      orientationAnalysisPath: path.join(evaluationRoot, "body-orientation-analysis.json"),
      wasm: {} as never,
    });
    assert.equal(artifact.observationDomains.candidateDiscovery.poseDomain, "mmfit_mediapipe33_heavy_cpu");
    assert.deepEqual(artifact.observationDomains.candidateDiscovery.splits, ["train"]);
    assert.equal(artifact.observationDomains.candidateDiscovery.clipCount, 1);
    assert.equal(artifact.observationDomains.frozenEvaluation.poseDomain, "mmfit_openpose18_mapped");
    assert.deepEqual(artifact.observationDomains.frozenEvaluation.splits, ["train", "validation", "test", "unseen_test"]);
    assert.equal(artifact.observationDomains.frozenEvaluation.clipCount, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
