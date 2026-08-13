import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  instantiateRustMotionWasm,
  RustCanonicalWasmSession,
  type RustExerciseProfileData,
} from "../../src/motion/rustCanonicalWasm";
import type { PoseEstimate } from "../../src/pose/PoseEngine";

const ROOT = process.cwd();
const ARCHIVE_ROOT = path.join(ROOT, "public", "archives", "confirmed-captures");
const CAPTURE_ID = "field-capture-2026-08-03T07-57-28-214Z";
const CAPTURE_KEYPOINTS = path.join("shoulders", `${CAPTURE_ID}.json`);

interface Fixture {
  poses: PoseEstimate[];
}

interface StoredProfile extends Omit<RustExerciseProfileData, "contentHash"> {
  contentHash: string;
}

test("seated shoulder press replay keeps its pre-set setup separate from twelve presses", async (t) => {
  const fixture = readJson<Fixture[]>(path.join(ARCHIVE_ROOT, CAPTURE_KEYPOINTS))[0];
  const artifact = readJson<{ profiles: Array<{
    exerciseId: string;
    capturePosition: string;
    profile: StoredProfile;
  }> }>(path.join(ARCHIVE_ROOT, "recognition-profiles.json"));
  const storedProfile = artifact.profiles.find((entry) =>
    entry.exerciseId === "seated_shoulder_press" && entry.capturePosition === "front",
  )?.profile;
  assert.ok(fixture?.poses.length, "real capture must contain canonical pose frames");
  if (!storedProfile) {
    t.skip("current installed evidence snapshot has no exact shoulder-press observed profile");
    return;
  }

  const wasm = await instantiateRustMotionWasm(
    fs.readFileSync(path.join(ROOT, "public", "motion-sdk", "maxpower_motion_sdk.wasm")),
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
  session.installExerciseProfileData({
    ...storedProfile,
    contentHash: BigInt(storedProfile.contentHash),
  });

  const usable = [];
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
    usable.push(...session.lastCompletedReps.filter((rep) => rep.disposition !== "rejected"));
  }
  session.close();

  // This legacy clip includes one unlabelled setup movement before the
  // approved set. The twelve subsequent candidates are the real presses.
  // Before direction locking, the same input produced 24 usable candidates
  // because each return was re-opened as an opposite-direction auto cycle.
  assert.equal(usable.length, 13, "the replay has one setup movement plus twelve presses");
  assert.equal(
    usable.filter((rep) => rep.startTimestampMs >= 5_000n).length,
    12,
    "each labelled press must contribute at most one usable cycle after setup",
  );
});

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
