import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const replayRelative =
  'rust/motion-sdk/tests/fixtures/all_action_governed_replay_manifest_v1.json';
const videoRelative =
  'rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_video_sources.json';
const outputPath = resolve(
  root,
  'rust/motion-sdk/tests/fixtures/visual_recognition_v0_1_protocol.json',
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};
const replayBytes = readFileSync(resolve(root, replayRelative));
const replay = JSON.parse(replayBytes);
const videoBytes = readFileSync(resolve(root, videoRelative));
const video = JSON.parse(videoBytes);

const protocol = {
  evaluationScope: 'known_participant_known_video_regression',
  generalizationClaimAllowed: false,
  replayManifest: {
    path: replayRelative,
    sha256: sha256(replayBytes),
    assembledInputSha256: replay.assembledInputSha256,
  },
  videoSourceManifest: {
    path: videoRelative,
    sha256: sha256(videoBytes),
    semanticSha256: video.manifestSha256,
  },
  modelConfiguration: {
    sdkVersion: '0.1.0',
    assessmentCatalogId: 'maxpower/visual-recognition-baseline/v0.1',
    poseRuntimeId: 'rtmpose-m',
    poseSchema: 'halpe26/v1',
    packetContract: '1.11',
    equipmentProvider: 'maxpower_motion_sdk::EquipmentProviderRegistry',
    equipmentActivationAuthority: 'ExecutionContract',
    repBoundaryAuthority:
      'action_observation_plan_task_primary_and_required_relations',
    countedDispositions: ['confirmed', 'needs_review'],
  },
  truthReveal: 'all_predictions_hashed_before_human_ranges_are_loaded',
  matchingPolicy: {
    algorithm: 'monotonic_start_end_dynamic_programming',
    candidateEligibility:
      'interval_iou_gte_0.10_or_both_boundaries_within_1500ms',
    minimumIntervalIoU: 0.1,
    candidateBoundaryToleranceMs: 1500,
    strictBoundaryAlignment:
      'interval_iou_gte_0.60_and_both_boundaries_within_500ms',
    strictMinimumIntervalIoU: 0.6,
    strictStartEndToleranceMs: 500,
    negativeWindowFalseTrigger:
      'predicted_rep_midpoint_inside_reviewed_negative_window',
  },
  humanSupervision: {
    assetId: 'personal-human-rep-ranges-v2',
    consumedForTasks: [
      'rep_counting',
      'rep_segmentation',
      'negative_window_rejection',
    ],
    selectedFields: [
      'sourceCaptureId',
      'exerciseId',
      'capturePosition',
      'expectedCount',
      'segments[].startMs',
      'segments[].endMs',
      'reviewedNegativeWindows[].startMs',
      'reviewedNegativeWindows[].endMs',
    ],
  },
  forbiddenClaims: [
    'held_out_accuracy',
    'unseen_user_generalization',
    'equipment_track_accuracy',
    'technique_quality_accuracy',
    'production_promotion',
  ],
  output: {
    path: 'workspace/visual-recognition-v0.1/v0.1b-action-driven-evaluation-2026-08-16.json',
    schemaVersion: 'maxpower.visual-recognition-known-video-evaluation/v0.1',
  },
};

const frozen = {
  schemaVersion: 'maxpower.visual-recognition-evaluation-protocol/v0.1',
  evaluationId: 'visual-recognition-v0.1b-action-driven-2026-08-16',
  protocolSha256: sha256(Buffer.from(JSON.stringify(canonicalize(protocol)))),
  protocol,
};
writeFileSync(outputPath, `${JSON.stringify(frozen, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, protocolSha256: frozen.protocolSha256 })}\n`);
