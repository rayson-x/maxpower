import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

import type { PoseEstimate } from "../../src/pose/PoseEngine";

export interface PoseFixture {
  video: string;
  durationSec: number;
  stepMs: number;
  model: string;
  poses: PoseEstimate[];
}

export interface PoseFixtureAnnotation {
  schemaVersion: 1;
  videoId: string;
  exercise: string;
  cameraView: string;
  evidence: {
    rawObservation: "recorded_fixture";
    currentImplementationBehavior: "characterization_only";
    manualCoordinateGroundTruth: "annotated_video_frame";
  };
  acceptance: {
    coordinateSpace: "image_normalized";
    maxElbowErrorPx: number;
    minArmEdgeCoverage: number;
  };
  challengeFrames: Array<{
    timestampMs: number;
    joints: Array<{
      name: string;
      landmarkIndex: number;
      rawVisibility: number;
      currentBehavior: "measured" | "predicted";
      manualCoordinate?: { x: number; y: number };
    }>;
  }>;
}

function defaultFixturesPath(): string {
  return resolve(process.cwd(), "tools/harness/fixtures/fixtures.json");
}

export function loadPoseFixtures(
  fixturesPath = defaultFixturesPath(),
): PoseFixture[] {
  return JSON.parse(readFileSync(fixturesPath, "utf8")) as PoseFixture[];
}

export function loadPoseFixture(
  videoId: string,
  fixturesPath = defaultFixturesPath(),
): PoseFixture {
  const fixture = loadPoseFixtures(fixturesPath).find(
    ({ video }) => video === videoId,
  );

  if (!fixture) {
    throw new Error(`Pose fixture not found: ${videoId}`);
  }

  return fixture;
}

export function loadPoseFixtureAnnotation(
  videoId: string,
  annotationsDirectory = resolve(
    process.cwd(),
    "tools/harness/fixtures/annotations",
  ),
): PoseFixtureAnnotation {
  const extension = extname(videoId);
  const stableId = extension ? videoId.slice(0, -extension.length) : videoId;
  const annotationPath = resolve(annotationsDirectory, `${stableId}.json`);
  const annotation = JSON.parse(
    readFileSync(annotationPath, "utf8"),
  ) as PoseFixtureAnnotation;

  if (annotation.videoId !== videoId) {
    throw new Error(
      `Pose fixture annotation id mismatch: expected ${videoId}, received ${annotation.videoId}`,
    );
  }

  return annotation;
}

export function poseAtTimestamp(
  fixture: PoseFixture,
  timestampMs: number,
): PoseEstimate {
  const pose = fixture.poses.find(
    (candidate) => candidate.timestampMs === timestampMs,
  );

  if (!pose) {
    throw new Error(
      `Pose frame not found: ${fixture.video} at ${timestampMs}ms`,
    );
  }

  return pose;
}
