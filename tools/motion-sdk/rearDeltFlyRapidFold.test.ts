import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import { applyObservedRecognitionCompatibilityPolicy } from "../../src/motion/observedRecognitionProfiles";
import type { PoseEstimate } from "../../src/pose/PoseEngine";

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.join(ROOT, "public", "archives", "confirmed-captures");
const CAPTURE_ID = "field-capture-2026-08-03T08-45-04-435Z";
const CAPTURE_KEYPOINTS = path.join("shoulders", `${CAPTURE_ID}.json`);

interface Fixture {
  poses: PoseEstimate[];
}

interface StoredProfile extends Omit<RustExerciseProfileData, "contentHash"> {
  contentHash: string;
}

test("rear-delt fly keeps fast local folds out of formal volume while retaining them as review evidence", async () => {
  const fixture = readJson<Fixture[]>(path.join(ARCHIVE_ROOT, CAPTURE_KEYPOINTS))[0];
  const artifact = readJson<{ profiles: Array<{
    exerciseId: string;
    capturePosition: string;
    profile: StoredProfile;
  }> }>(path.join(ARCHIVE_ROOT, "recognition-profiles.json"));
  const storedProfile = artifact.profiles.find((entry) =>
    entry.exerciseId === "rear_delt_fly" && entry.capturePosition === "front",
  )?.profile;
  assert.ok(fixture?.poses.length, "real capture must contain canonical pose frames");
  assert.ok(storedProfile, "real capture must have the exact observed recognition profile");

  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(ROOT, "public", "motion-sdk", "form_coach_motion_sdk.wasm")),
  );
  const first = fixture.poses[0] as PoseEstimate & {
    image?: { widthPx: number; heightPx: number; mirrored: boolean };
  };
  const session = new RustCanonicalWasmSession({
    sequenceId: `regression:${CAPTURE_ID}`,
    schema: "blazepose33",
    image: {
      widthPx: first.image?.widthPx ?? 1280,
      heightPx: first.image?.heightPx ?? 720,
      rotationDegrees: 0,
      mirrored: first.image?.mirrored ?? false,
    },
    stabilization: "fusion",
  }, wasm);
  const profile = applyObservedRecognitionCompatibilityPolicy({
    exerciseId: "rear_delt_fly",
    capturePosition: "front",
    trainingSide: "bilateral",
    variation: "",
  }, {
    ...storedProfile,
    contentHash: BigInt(storedProfile.contentHash),
  });
  session.installExerciseProfileData(profile);

  const completed = [];
  for (const pose of fixture.poses) {
    session.process({
      timestampMs: pose.timestampMs,
      landmarks: pose.landmarks.map((landmark) => ({
        x: Number.isFinite(landmark.x) ? landmark.x : 0,
        y: Number.isFinite(landmark.y) ? landmark.y : 0,
        z: Number.isFinite(landmark.z) ? landmark.z : 0,
        visibility: landmark.visibility,
      })),
      worldLandmarks: pose.worldLandmarks ?? [],
    });
    completed.push(...session.lastCompletedReps);
  }
  session.close();

  const confirmed = completed.filter((rep) => rep.disposition === "confirmed");
  assert.ok(confirmed.length >= 13 && confirmed.length <= 15,
    "15 labelled fly reps must not inflate formal volume after wrist-spread segmentation");
  assert.ok(
    completed.some((rep) => rep.disposition === "needs_review" || rep.disposition === "rejected"),
    "ambiguous local movement remains visible as candidate evidence",
  );
});

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
