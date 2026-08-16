import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const replayPath = resolve(
  root,
  'rust/motion-sdk/tests/fixtures/all_action_governed_replay_manifest_v1.json',
);
const archiveRoot = resolve(root, 'public/archives/confirmed-captures');
const archiveManifestPath = resolve(archiveRoot, 'manifest.json');
const outputPath = resolve(
  root,
  'rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_video_sources.json',
);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const replay = JSON.parse(readFileSync(replayPath));
const archiveManifestBytes = readFileSync(archiveManifestPath);
const archiveManifest = JSON.parse(archiveManifestBytes);
const byId = new Map(archiveManifest.captures.map((capture) => [capture.id, capture]));
const contextRows = replay.assembledInput.sourceGroups;
const uniqueSourceIds = [...new Set(contextRows.map((row) => row.sourceCaptureId))].sort();

const sources = uniqueSourceIds.map((sourceCaptureId) => {
  const capture = byId.get(sourceCaptureId);
  if (!capture?.video) {
    throw new Error(`archive manifest has no video for ${sourceCaptureId}`);
  }
  const videoBytes = readFileSync(resolve(archiveRoot, capture.video));
  return {
    sourceCaptureId,
    path: capture.video,
    sha256: sha256(videoBytes),
  };
});

const semantic = {
  schemaVersion: 'maxpower.visual-recognition-video-source-manifest/v0.1',
  assetId: 'personal-raw-capture-archive',
  admission: 'immutable_source',
  authority: 'user_source',
  groupKey: 'sourceCaptureId',
  allowedTask: 'known_video_runtime_evaluation',
  archiveManifestSha256: sha256(archiveManifestBytes),
  contextCount: contextRows.length,
  uniqueSourceCount: sources.length,
  sources,
};
const output = {
  ...semantic,
  manifestSha256: sha256(Buffer.from(JSON.stringify(semantic))),
};
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ outputPath, contextCount: contextRows.length, uniqueSourceCount: sources.length, manifestSha256: output.manifestSha256 })}\n`,
);
