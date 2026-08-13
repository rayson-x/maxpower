import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { mapMmFitAction, mapRepCountAction } from "./actionMap";
import { adaptMmFit2d, mapCoco18Frame } from "./mmFitAdapter";
import { adaptRepCountAnnotation, parseCycleBounds } from "./repCountAdapter";
import { resolveSimulatedRecognitionProfile } from "../../src/motion/simulatedRecognitionProfile";
import { encodeRustExerciseProfileInstallation } from "../../src/motion/rustCanonicalWasm";

test("MM-Fit COCO-18 adapter maps exact joints and leaves missing BlazePose joints unknown", () => {
  const joints: Array<readonly [number, number]> = Array.from(
    { length: 18 },
    () => [0, 0] as const,
  );
  joints[5] = [100, 50]; // left shoulder
  joints[1] = [75, 45]; // neck: deliberately unmapped
  const landmarks = mapCoco18Frame(joints, 200, 100);
  assert.equal(landmarks.length, 33);
  assert.deepEqual(landmarks[11], { x: 0.5, y: 0.5, z: 0, visibility: 1 });
  assert.equal(landmarks[9].visibility, 0);
  assert.equal(landmarks[10].visibility, 0);
});

test("MM-Fit set labels remain set-level counts and cannot masquerade as rep boundaries", () => {
  const sequence = adaptMmFit2d({
    workoutId: "w01",
    subjectId: "01",
    split: "train",
    sourceWidth: 640,
    sourceHeight: 480,
    framesPerSecond: 30,
    frames: [{ frameIndex: 3, joints: Array.from({ length: 18 }, () => [0, 0] as const) }],
    labels: [{ startFrame: 3, endFrame: 93, repetitionCount: 5, activityClass: "squats" }],
  });
  assert.equal(sequence.exerciseId, "bodyweight_squat");
  assert.equal(sequence.labels[0].annotationGranularity, "set_count");
  assert.deepEqual(sequence.labels[0].repBounds, []);
  assert.deepEqual(sequence.forbiddenUse, ["production_profile_promotion", "form_reference"]);
});

test("RepCount adapter preserves fine-grained cycle bounds", () => {
  const bounds = parseCycleBounds("[(10, 20), (25, 38)]");
  assert.deepEqual(bounds, [
    { repIndex: 1, startFrame: 10, endFrame: 20 },
    { repIndex: 2, startFrame: 25, endFrame: 38 },
  ]);
  const sequence = adaptRepCountAnnotation({
    videoId: "sample.mp4",
    action: "jump_jack",
    count: 2,
    cycleBounds: "[(10, 20), (25, 38)]",
  });
  assert.equal(sequence.exerciseId, "jumping_jack");
  assert.equal(sequence.labels[0].annotationGranularity, "per_rep_bounds");
  assert.equal(sequence.poses.length, 0);
});

test("dataset labels map to exact catalog identities without conflating variants", () => {
  assert.equal(mapMmFitAction("dumbbell_rows"), "standing_dumbbell_row");
  assert.equal(mapMmFitAction("bicep_curls"), "alternating_dumbbell_biceps_curl");
  assert.equal(mapMmFitAction("lunges"), "alternating_lunge");
  assert.equal(mapMmFitAction("jumping_jacks"), "jumping_jack");
  assert.equal(mapRepCountAction("bench_pressing"), "barbell_bench_press");
  assert.equal(mapRepCountAction("pommelhorse"), null);
});

test("RepCount rejects count and boundary disagreement", () => {
  assert.throws(() => adaptRepCountAnnotation({
    videoId: "bad.mp4",
    action: "squat",
    count: 3,
    cycleBounds: "[(1, 3), (4, 6)]",
  }), /disagrees/);
});

test("alternating curl installs the Rust alternating state graph instead of a bilateral proxy", () => {
  const profile = resolveSimulatedRecognitionProfile({
    exerciseId: "alternating_dumbbell_biceps_curl",
    capturePosition: "frontLeft45",
    trainingSide: "bilateral",
    variation: "",
  });
  assert.ok(profile);
  assert.equal(profile.stateMachineId, "alternating-ready-effort-return/v1");
  assert.notDeepEqual(profile.primarySignal.landmarks, profile.secondarySignal.landmarks);
  assert.equal(encodeRustExerciseProfileInstallation(profile).abiArguments[5], 1);
});

test("MM-Fit body orientation proxy cannot masquerade as a physical capture position", () => {
  const root = process.cwd();
  const analyzer = fs.readFileSync(path.join(root, "tools/external-fitness-data/analyze_mmfit_view.py"), "utf8");
  const trainer = fs.readFileSync(path.join(root, "tools/external-fitness-data/rollingProfileTrainer.ts"), "utf8");
  assert.match(analyzer, /"bodyOrientationProxy": orientation/);
  assert.doesNotMatch(analyzer, /"cameraView": view/);
  assert.match(trainer, /const capturePosition = null/);
  assert.doesNotMatch(trainer, /function capturePositionFor/);
  assert.doesNotMatch(trainer, /oblique45"\) return "frontLeft45/);
});
