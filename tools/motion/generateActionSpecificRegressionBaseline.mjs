import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const maxpowerRoot = resolve(import.meta.dirname, '../..');
const governanceRoot = resolve(maxpowerRoot, '../maxpower-training-data-governance');
const assetId = 'current-rust-v11-multirate-equipment-alignment-report';
const governance = JSON.parse(readFileSync(resolve(governanceRoot, 'catalog/assets.json'), 'utf8'));
const asset = governance.assets.find((candidate) => candidate.id === assetId);
if (!asset) throw new Error(`missing governed asset ${assetId}`);
if (asset.admission !== 'evaluation_only' || asset.authority !== 'frozen_prediction_or_report') {
  throw new Error(`invalid admission for ${assetId}`);
}
for (const task of ['known_video_regression', 'regression_diagnosis', 'capability_reporting']) {
  if (!asset.allowedTasks.includes(task)) throw new Error(`${assetId} forbids ${task}`);
}
if (asset.groupKey !== 'sourceCaptureId' || asset.location.root !== 'maxpower_source') {
  throw new Error(`invalid grouping or root for ${assetId}`);
}
const reportBytes = readFileSync(resolve(maxpowerRoot, asset.location.path));
const sha256 = createHash('sha256').update(reportBytes).digest('hex');
if (sha256 !== asset.location.sha256) throw new Error(`${assetId} hash mismatch`);
const report = JSON.parse(reportBytes);

const baseline = {
  schemaVersion: 'maxpower.action-specific-motion-regression-baseline/v1',
  source: {
    assetId,
    admission: asset.admission,
    authority: asset.authority,
    groupKey: asset.groupKey,
    immutableSha256: sha256,
    consumedFields: ['aggregate', 'buckets.byAction', 'buckets.byActionView', 'buckets.byView'],
    allowedTasks: ['known_video_regression', 'regression_diagnosis', 'capability_reporting'],
  },
  usage: 'known_video_regression_and_diagnosis_only',
  aggregate: report.aggregate,
  exactAction: report.buckets.byAction,
  exactActionView: report.buckets.byActionView,
  view: report.buckets.byView,
  accuracyStatus: {
    repCountAndBoundary: 'evaluable_known_video_regression',
    phaseAndTurnaround: 'not_evaluable',
    rawEquipmentGeometry: 'not_evaluable',
    subjectAssociation: 'not_evaluable',
    gripEstablishmentAndRelease: 'not_evaluable',
    qualityVerdicts: 'not_evaluable',
    traceConclusions: 'not_evaluable',
  },
  frozenRegressions: [
    { recordId: 'a44741cba03352f1e689fd51276dfec5', timestampMs: 5400, frameId: 162, expectation: 'raw_bar_allowed_fusion_and_turnaround_forbidden_before_grip' },
    { recordId: 'field-capture-2026-08-02T18-34-19-006Z', timestampMs: 16609, frameId: 498, expectation: 'pose_bridge_display_only_never_canonical_or_rep' },
  ],
};
const outputPath = resolve(maxpowerRoot, 'rust/motion-sdk/tests/fixtures/action_specific_motion_regression_baseline_v1.json');
writeFileSync(outputPath, `${JSON.stringify(baseline, null, 2)}\n`);
console.log(JSON.stringify({ assetId, sha256, actionCount: Object.keys(baseline.exactAction).length, actionViewCount: Object.keys(baseline.exactActionView).length }));
