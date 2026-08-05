import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";

import { EXERCISE_REGISTRY } from "../../src/pose/exerciseRegistry";
import {
  buildVideoLibraryFromConfirmedCaptures,
  parseConfirmedCaptureManifest,
} from "../../src/pose/videoLibrary";

const EXPECTED_ACTION_BY_VIDEO_ID = Object.freeze({
  "field-capture-2026-08-02T18-15-03-101Z": "pull_up",
  "field-capture-2026-08-02T18-16-42-757Z": "pull_up",
  "field-capture-2026-08-02T18-19-26-633Z": "barbell_row",
  "field-capture-2026-08-02T18-24-38-253Z": "barbell_row",
  "field-capture-2026-08-02T18-26-54-722Z": "barbell_row",
  "field-capture-2026-08-02T18-30-30-478Z": "barbell_row",
  "field-capture-2026-08-02T18-34-19-006Z": "barbell_row",
  "field-capture-2026-08-02T18-37-19-691Z": "barbell_row",
  "field-capture-2026-08-02T18-41-05-284Z": "barbell_row",
  "field-capture-2026-08-02T18-41-55-780Z": "lat_pulldown",
  "field-capture-2026-08-02T18-44-00-128Z": "lat_pulldown",
  "field-capture-2026-08-02T18-46-52-295Z": "lat_pulldown",
  "field-capture-2026-08-02T18-55-17-537Z": "seated_row",
  "field-capture-2026-08-02T18-59-00-009Z": "seated_row",
  "field-capture-2026-08-02T19-02-41-183Z": "straight_arm_pulldown",
  "field-capture-2026-08-02T19-05-43-889Z": "straight_arm_pulldown",
  "field-capture-2026-08-02T19-08-40-178Z": "straight_arm_pulldown",
  "field-capture-2026-08-03T07-57-28-214Z": "seated_shoulder_press",
  "field-capture-2026-08-03T07-59-35-213Z": "seated_shoulder_press",
  "field-capture-2026-08-03T08-04-11-681Z": "seated_shoulder_press",
  "field-capture-2026-08-03T08-09-44-714Z": "seated_shoulder_press",
  "field-capture-2026-08-03T08-15-35-147Z": "seated_shoulder_press",
  "field-capture-2026-08-03T09-03-30-328Z": "seated_shoulder_press",
  "field-capture-2026-08-03T08-22-48-938Z": "lateral_raise",
  "field-capture-2026-08-03T08-24-48-386Z": "lateral_raise",
  "field-capture-2026-08-03T08-27-17-330Z": "lateral_raise",
  "field-capture-2026-08-03T08-30-12-186Z": "lateral_raise",
  "field-capture-2026-08-03T08-34-27-223Z": "lateral_raise",
  "field-capture-2026-08-03T08-36-58-723Z": "lateral_raise",
  "field-capture-2026-08-03T08-38-55-907Z": "lateral_raise",
} satisfies Readonly<Record<string, string>>);

test("every provided training video carries a known action context", () => {
  const archiveRoot = join(process.cwd(), "public/archives/confirmed-captures");
  const manifest = parseConfirmedCaptureManifest(JSON.parse(
    readFileSync(join(archiveRoot, "manifest.json"), "utf8"),
  ));
  const labelsByCaptureId = Object.fromEntries(manifest.captures.flatMap((capture) => {
    if (!capture.labels) return [];
    return [[capture.id, JSON.parse(
      readFileSync(join(archiveRoot, capture.labels), "utf8"),
    )]];
  }));
  const library = buildVideoLibraryFromConfirmedCaptures(manifest, labelsByCaptureId);

  assert.deepEqual(
    library.videos.map((video) => video.id).sort(),
    Object.keys(EXPECTED_ACTION_BY_VIDEO_ID).sort(),
  );
  for (const video of library.videos) {
    assert.ok(video.exerciseId, `${video.id} is missing its action context`);
    assert.ok(
      EXERCISE_REGISTRY.get(video.exerciseId!),
      `${video.id} references unknown action ${video.exerciseId}`,
    );
    assert.equal(
      video.exerciseId,
      EXPECTED_ACTION_BY_VIDEO_ID[video.id as keyof typeof EXPECTED_ACTION_BY_VIDEO_ID],
      `${video.id} carries the wrong action context`,
    );
  }
});
