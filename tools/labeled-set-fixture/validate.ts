import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { validateLabeledSetFixture } from "../../src/pose/labeledSetFixture";

interface RecordedFixture {
  video: string;
  durationSec: number;
}

function main(): void {
  const [manifestPath, keypointsPath] = process.argv.slice(2);
  if (!manifestPath || !keypointsPath) {
    throw new Error(
      "Usage: npm run validate:labeled-fixture -- path/to/labels.json path/to/keypoints.json",
    );
  }
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as unknown;
  const fixture = JSON.parse(readFileSync(resolve(keypointsPath), "utf8")) as unknown;
  if (!Array.isArray(fixture) || fixture.length !== 1 || !isRecordedFixture(fixture[0])) {
    throw new Error("Keypoints file must contain exactly one recording fixture with video and durationSec");
  }
  const errors = validateLabeledSetFixture(manifest, {
    videoId: fixture[0].video,
    keypointsFile: basename(keypointsPath),
    durationMs: fixture[0].durationSec * 1000,
  });
  if (errors.length > 0) {
    throw new Error(`Labeled fixture is invalid:\n- ${errors.join("\n- ")}`);
  }
  console.log("Labeled fixture is valid and can enter the review queue.");
}

function isRecordedFixture(value: unknown): value is RecordedFixture {
  return (
    typeof value === "object" &&
    value !== null &&
    "video" in value &&
    typeof value.video === "string" &&
    "durationSec" in value &&
    typeof value.durationSec === "number" &&
    Number.isFinite(value.durationSec) &&
    value.durationSec >= 0
  );
}

main();
