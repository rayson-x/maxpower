import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const governanceRoot = resolve(root, '../maxpower-training-data-governance');
const workspaceRoot = resolve(
  governanceRoot,
  'workspace/visual-recognition-v0.1',
);
const rawArguments = process.argv.slice(2);
if (rawArguments.length !== 1 || rawArguments[0] !== '--execute-repeat') {
  throw new Error(
    'this governed report accepts no external JSON; invoke it only with --execute-repeat',
  );
}
const outputRelative = 'workspace/visual-recognition-v0.1/derived-reports';
const outputRoot = resolve(governanceRoot, outputRelative);

// Never read a governed replay input merely because this script was invoked.
// The catalog audit resolves asset IDs/admission before a local-only report
// can be generated, and failure leaves both the source data and repository
// reports untouched.
const governanceAudit = spawnSync('npm', ['run', 'audit'], {
  cwd: governanceRoot,
  encoding: 'utf8',
});
if (governanceAudit.status !== 0) {
  throw new Error(`governance audit failed; replay input was not consumed:\n${governanceAudit.stderr || governanceAudit.stdout}`);
}
mkdirSync(outputRoot, { recursive: true });

const runGroupId = `v0.1b-repeat-${Date.now()}-${randomUUID()}`;
const repeatRunsRoot = resolve(workspaceRoot, 'repeat-runs');
mkdirSync(repeatRunsRoot, { recursive: true });
const repeatRoot = resolve(repeatRunsRoot, runGroupId);
mkdirSync(repeatRoot, { recursive: false });
const runReplay = (suffix) => {
  const runId = `${runGroupId}-${suffix}`;
  const outputPath = resolve(repeatRoot, `${suffix}.json`);
  const result = spawnSync(
    'cargo',
    [
      'test',
      '--release',
      '--manifest-path',
      'rust/motion-sdk/Cargo.toml',
      '--test',
      'execution_assessment_rigid_bar_family_contract',
      'governed_v0_1_visual_recognition_baseline_replays_current_action_views',
      '--',
      '--ignored',
      '--exact',
      '--nocapture',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        MAXPOWER_GOVERNED_EVALUATION_OUTPUT: outputPath,
        MAXPOWER_GOVERNED_EVALUATION_RUN_ID: runId,
      },
      stdio: 'inherit',
    },
  );
  if (result.status !== 0) {
    throw new Error(`independent governed release replay ${suffix} failed`);
  }
  return { runId, outputPath };
};
const first = runReplay('a');
const repeated = runReplay('b');
const controlledRepeat = {
  method: 'report_generator_spawned_release_replays',
  controllerProcessId: process.pid,
  runGroupId,
  firstRunId: first.runId,
  repeatedRunId: repeated.runId,
};
const baselinePath = first.outputPath;
const firstPostPath = first.outputPath;
const diagnosticPostPath = repeated.outputPath;
const repeatRequested = true;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readEvaluation = (path) => {
  const bytes = readFileSync(path);
  const value = JSON.parse(bytes);
  if (
    value.schemaVersion !==
      'maxpower.visual-recognition-known-video-evaluation/v0.1' ||
    value.generalizationClaimAllowed !== false
  ) {
    throw new Error(`${path} is not a governed v0.1 known-video evaluation`);
  }
  return { bytes, value };
};

const baseline = readEvaluation(baselinePath);
const firstPost = readEvaluation(firstPostPath);
const diagnosticPost = readEvaluation(diagnosticPostPath);
const before = baseline.value;
const after = firstPost.value;

const replaySemantic = (evaluation) => {
  const {
    runId: _runId,
    executionInvocation: _executionInvocation,
    ...semantic
  } = evaluation;
  return semantic;
};
let repeatVerified = false;
if (repeatRequested) {
  if (diagnosticPostPath === firstPostPath) {
    throw new Error('repeat evidence requires two distinct artifact paths');
  }
  const firstRunId = firstPost.value.runId;
  const repeatedRunId = diagnosticPost.value.runId;
  if (
    typeof firstRunId !== 'string' || firstRunId.length === 0 ||
    typeof repeatedRunId !== 'string' || repeatedRunId.length === 0 ||
    firstRunId === repeatedRunId
  ) {
    throw new Error('repeat evidence requires two distinct immutable run IDs');
  }
  for (const field of ['evaluationId', 'protocolSha256', 'predictionSha256', 'reportDigest']) {
    if (firstPost.value[field] !== diagnosticPost.value[field]) {
      throw new Error(`repeat evidence changed ${field}`);
    }
  }
  for (const field of ['executionRuntime', 'clientRuntimeParityArtifact']) {
    if (
      JSON.stringify(firstPost.value[field]) !==
      JSON.stringify(diagnosticPost.value[field])
    ) {
      throw new Error(`repeat evidence changed ${field}`);
    }
  }
  if (
    !Number.isInteger(firstPost.value.executionInvocation?.processId) ||
    !Number.isInteger(diagnosticPost.value.executionInvocation?.processId) ||
    firstPost.value.executionInvocation.processId ===
      diagnosticPost.value.executionInvocation.processId
  ) {
    throw new Error('repeat evidence requires separate processes running the same native binary');
  }
  if (
    JSON.stringify(replaySemantic(firstPost.value)) !==
    JSON.stringify(replaySemantic(diagnosticPost.value))
  ) {
    throw new Error('the two independently identified runs did not reproduce the same result');
  }
  if (
    firstPost.value.runId !== controlledRepeat.firstRunId ||
    diagnosticPost.value.runId !== controlledRepeat.repeatedRunId
  ) {
    throw new Error('spawned replay output did not preserve the controller-issued run IDs');
  }
  repeatVerified = true;
}

const pairId = sha256(Buffer.from(JSON.stringify({
  schemaVersion: 'maxpower.visual-recognition-derived-report-pair/v1',
  baselineEvaluationSha256: sha256(baseline.bytes),
  postFixEvaluationSha256: sha256(firstPost.bytes),
  diagnosticEvaluationSha256: sha256(diagnosticPost.bytes),
  repeatExecution: controlledRepeat,
})));
const versionRelative = `${outputRelative}/versions/${pairId}`;
const aggregateRelative = `${versionRelative}/aggregate.json`;
const artifactRelative = `${versionRelative}/artifact.json`;
const manifestRelative = `${versionRelative}/manifest.json`;
const aggregatePath = resolve(governanceRoot, aggregateRelative);
const artifactPath = resolve(governanceRoot, artifactRelative);
const manifestPath = resolve(governanceRoot, manifestRelative);

const finiteDelta = (current, prior) =>
  Number.isFinite(current) && Number.isFinite(prior) ? current - prior : null;
const metricDelta = (field) => finiteDelta(after.aggregate[field], before.aggregate[field]);
const dispositions = after.structuralRuntime.repDispositionCounts;
const reasons = after.structuralRuntime.repEvidenceReasonCounts;
const candidateCount = Object.values(dispositions).reduce(
  (sum, value) => sum + value,
  0,
);
const rejectedCount = dispositions.Rejected;
const rejectionReasonRows = Object.entries(reasons)
  .filter(([reason]) => reason !== 'None' && reason !== 'ShortContinuityRecovery')
  .map(([reason, count]) => ({
    reason,
    count,
    shareOfCandidates: candidateCount === 0 ? null : count / candidateCount,
    shareOfRejected: rejectedCount === 0 ? null : count / rejectedCount,
  }))
  .sort((left, right) => right.count - left.count);

const actionRows = Object.entries(after.buckets.byAction)
  .map(([action, metrics]) => {
    const prior = before.buckets.byAction[action];
    return {
      action,
      truthReps: metrics.truthRepCount,
      predictedBefore: prior.predictedRepCount,
      predictedAfter: metrics.predictedRepCount,
      matchedBefore: prior.matchedRepCount,
      matchedAfter: metrics.matchedRepCount,
      precisionAfter: metrics.candidatePrecision,
      recallAfter: metrics.candidateRecall,
    };
  })
  .sort(
    (left, right) =>
      (right.recallAfter ?? -1) - (left.recallAfter ?? -1) ||
      left.action.localeCompare(right.action),
  );

function actionViewFunnel(metrics, actionView) {
  const funnel = metrics.recognitionFunnel;
  if (!funnel || typeof funnel !== 'object') {
    throw new Error(`${actionView} is missing the required action×view recognitionFunnel`);
  }
  for (const key of [
    'rawProposal',
    'confirmedOnly',
    'confirmedPlusNeedsReview',
    'rejected',
    'rejectionReasons',
    'candidateTruthMatches',
    'negativeWindowFalseTriggers',
    'streams',
  ]) {
    if (!(key in funnel)) {
      throw new Error(`${actionView} recognitionFunnel is missing ${key}`);
    }
  }
  if (funnel.schemaVersion !== 'maxpower.visual-recognition-funnel/v2') {
    throw new Error(`${actionView} must use the v2 multi-stream recognition funnel`);
  }
  for (const streamId of [
    'rawProposal',
    'confirmedOnly',
    'confirmedPlusNeedsReview',
    'rejectedDiagnostic',
  ]) {
    const stream = funnel.streams[streamId];
    if (!stream || typeof stream !== 'object') {
      throw new Error(`${actionView} is missing stream ${streamId}`);
    }
    for (const field of [
      'predicted',
      'matched',
      'falsePositive',
      'falseNegative',
      'precision',
      'recall',
      'candidateTruthMatches',
      'boundaryMetrics',
      'negativeWindowFalseTriggers',
    ]) {
      if (!(field in stream)) {
        throw new Error(`${actionView} ${streamId} is missing ${field}`);
      }
    }
  }
  return funnel;
}

const actionViewRows = Object.entries(after.buckets.byActionView)
  .map(([actionView, metrics]) => {
    const prior = before.buckets.byActionView[actionView];
    if (!prior) {
      throw new Error(`baseline is missing action×view bucket ${actionView}`);
    }
    const [action, view] = actionView.split('|');
    if (!action || !view) {
      throw new Error(`invalid action×view bucket key ${actionView}`);
    }
    const funnel = actionViewFunnel(metrics, actionView);
    const beforeFunnel = actionViewFunnel(prior, `${actionView} (baseline)`);
    return {
      action,
      view,
      actionView,
      truthReps: metrics.truthRepCount,
      predictedBefore: prior.predictedRepCount,
      predictedAfter: metrics.predictedRepCount,
      matchedBefore: prior.matchedRepCount,
      matchedAfter: metrics.matchedRepCount,
      falsePositiveAfter: metrics.falsePositiveCount,
      missedAfter: metrics.missedCount,
      precisionAfter: metrics.candidatePrecision,
      recallAfter: metrics.candidateRecall,
      exactSetRateAfter: metrics.exactSetRate,
      startMaeMsAfter: metrics.matchedStartMaeMs,
      turnaroundMaeMsAfter: metrics.matchedTurnaroundMaeMs,
      endMaeMsAfter: metrics.matchedEndMaeMs,
      meanIntervalIoUAfter: metrics.matchedMeanIntervalIoU,
      rawProposalBefore: beforeFunnel.rawProposal,
      rawProposalAfter: funnel.rawProposal,
      confirmedOnlyAfter: funnel.confirmedOnly,
      confirmedPlusNeedsReviewAfter: funnel.confirmedPlusNeedsReview,
      rejectedAfter: funnel.rejected,
      rejectionReasonsAfter: funnel.rejectionReasons,
      candidateTruthMatchesAfter: funnel.candidateTruthMatches,
      negativeWindowFalseTriggersAfter: funnel.negativeWindowFalseTriggers,
      streamsAfter: funnel.streams,
    };
  })
  .sort(
    (left, right) =>
      (left.recallAfter ?? -1) - (right.recallAfter ?? -1) ||
      left.actionView.localeCompare(right.actionView),
  );

const beforeAggregateFunnel = actionViewFunnel(
  before.aggregate,
  'aggregate (baseline)',
);
const afterAggregateFunnel = actionViewFunnel(
  after.aggregate,
  'aggregate (current)',
);
const streamOrder = [
  'rawProposal',
  'confirmedOnly',
  'confirmedPlusNeedsReview',
  'rejectedDiagnostic',
];
const streamLabels = {
  rawProposal: 'Raw proposal（候选诊断）',
  confirmedOnly: 'Confirmed-only（正式计次）',
  confirmedPlusNeedsReview: 'Confirmed+NeedsReview（人工复核诊断）',
  rejectedDiagnostic: 'Rejected overlap（拒绝诊断）',
};

for (const action of actionRows) {
  const actionViews = actionViewRows.filter((row) => row.action === action.action);
  const truthReps = actionViews.reduce((sum, row) => sum + row.truthReps, 0);
  if (truthReps !== action.truthReps) {
    throw new Error(`action×view truth does not reconcile for ${action.action}`);
  }
}

const aggregate = {
  schemaVersion:
    'maxpower.visual-recognition-threshold-layering-diagnostic/v0.1',
  generatedOn: '2026-08-16',
  evaluationClass: after.evaluationStatus,
  generalizationClaimAllowed: false,
  decision: 'current_known_video_regression_only',
  source: {
    baselineEvaluationSha256: sha256(baseline.bytes),
    postFixEvaluationSha256: sha256(firstPost.bytes),
    diagnosticEvaluationSha256: sha256(diagnosticPost.bytes),
    protocolSha256: after.protocolSha256,
    repeatRunCoreResultMatched: repeatVerified ? true : null,
    repeatExecution: controlledRepeat,
  },
  dataQuality: after.dataQuality,
  before: before.aggregate,
  after: after.aggregate,
  delta: {
    predictedRepCount: metricDelta('predictedRepCount'),
    matchedRepCount: metricDelta('matchedRepCount'),
    falsePositiveCount: metricDelta('falsePositiveCount'),
    missedCount: metricDelta('missedCount'),
    candidatePrecision: metricDelta('candidatePrecision'),
    candidateRecall: metricDelta('candidateRecall'),
    matchedStartMaeMs: metricDelta('matchedStartMaeMs'),
    matchedEndMaeMs: metricDelta('matchedEndMaeMs'),
    matchedMeanIntervalIoU: metricDelta('matchedMeanIntervalIoU'),
  },
  candidateAdmission: {
    candidateCount,
    confirmedCount: dispositions.Confirmed,
    needsReviewCount: dispositions.NeedsReview,
    rejectedCount,
    rejectionRate: candidateCount === 0 ? null : rejectedCount / candidateCount,
    rejectionReasons: rejectionReasonRows,
  },
  byAction: actionRows,
  byActionView: actionViewRows,
  observationPipeline: {
    poseInputRateHz: after.equipmentProvider.poseInputRateHz,
    equipmentVisualProcessingRateHz:
      after.equipmentProvider.visualProcessingRateHz,
    equipmentTrackerOutputRateHz: after.equipmentProvider.trackerOutputRateHz,
    equipmentTrackerOutputFrames:
      after.equipmentProvider.trackerOutputFrameCount,
    localEquipmentChannelFrames:
      after.structuralRuntime.equipmentChannelFrames,
    fusionStates: after.structuralRuntime.fusionStates,
    localStates: after.structuralRuntime.localStates,
    rigidBarPredictedRepCount:
      after.turnaroundEvaluation.rigidBarPredictedRepCount,
    equipmentFusedTurnaroundCount:
      after.turnaroundEvaluation.equipmentFusedTurnaroundCount,
  },
  qualityOutput: {
    dimensionStates: after.structuralRuntime.dimensionStates,
    accuracyStatus: after.unsupportedAccuracyClaims.techniqueQualityAccuracy,
  },
  diagnosis: [
    {
      priority: 1,
      finding: rejectionReasonRows[0]
        ? `${rejectionReasonRows[0].reason} is the largest typed rejection reason: ${rejectionReasonRows[0].count}/${rejectedCount} rejected candidates.`
        : 'No typed rejected candidate was emitted in this run.',
      interpretation:
        'Use the action×view stream metrics and candidate-to-truth overlaps to decide whether this reason is suppressing true Reps; a count alone is not an accuracy claim.',
    },
    {
      priority: 2,
      finding:
        `The formal Confirmed-only stream matched ${afterAggregateFunnel.streams.confirmedOnly.matched}/${after.aggregate.truthRepCount} truth Reps with ${afterAggregateFunnel.streams.confirmedOnly.falsePositive} false positives.`,
      interpretation:
        'Compare raw, Confirmed-only, Confirmed+NeedsReview and Rejected diagnostic streams before changing admission. Only Confirmed-only is formal volume; the other streams diagnose where evidence was lost.',
    },
    {
      priority: 3,
      finding:
        `Equipment tracking emitted ${after.equipmentProvider.trackerOutputFrameCount} frames; ${after.structuralRuntime.equipmentChannelFrames} entered the local equipment channel.`,
      interpretation:
        'Frame throughput and evidence admission are separate metrics. Only measured, subject-associated equipment may corroborate or drive a Rep according to the frozen action plan.',
    },
  ],
  recommendedSequence: [
    'Inspect raw-proposal recall first, then Confirmed-only precision, then Confirmed+NeedsReview and Rejected diagnostic streams; do not collapse these gates into one rate.',
    'Prioritize action×view contexts with high rejected-to-truth overlap and keep every threshold change inside that action plan.',
    'Keep equipment observations independent from wrists; improve measured subject/grip association only where the selected action plan requests an equipment provider.',
    'Re-run this exact governed benchmark after each isolated change. Protect precision and reviewed-negative-window triggers while first recovering candidate retention, then boundary accuracy, then quality calibration.',
  ],
  limitations: [
    'This is a known-participant, known-video regression set and cannot support a generalization claim.',
    'There is no admitted human truth for equipment tracks, turnaround points or technique-quality conclusions, so their accuracy remains not evaluable.',
    'A comparison is meaningful only when both inputs use the v2 four-stream schema; with one explicit current path used on both sides every delta is correctly zero.',
  ],
};

const percent = (value) => Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—';
const signedPercentPoints = (value) =>
  Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)} pp` : '—';
const signedInteger = (value) => `${value >= 0 ? '+' : ''}${value}`;
const metricTable = [
  '| 流 | 基线 P/M/FP/FN | 当前 P/M/FP/FN | 当前 Precision | 当前 Recall | Recall 变化 |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...streamOrder.map((streamId) => {
    const prior = beforeAggregateFunnel.streams[streamId];
    const current = afterAggregateFunnel.streams[streamId];
    return `| ${streamLabels[streamId]} | ${prior.predicted}/${prior.matched}/${prior.falsePositive}/${prior.falseNegative} | ${current.predicted}/${current.matched}/${current.falsePositive}/${current.falseNegative} | ${percent(current.precision)} | ${percent(current.recall)} | ${signedPercentPoints(finiteDelta(current.recall, prior.recall))} |`;
  }),
  `| Confirmed+NeedsReview 严格边界对齐 | ${percent(before.aggregate.strictBoundaryAlignedRate)} | ${percent(after.aggregate.strictBoundaryAlignedRate)} | — | — | ${signedPercentPoints(finiteDelta(after.aggregate.strictBoundaryAlignedRate, before.aggregate.strictBoundaryAlignedRate))} |`,
  `| Confirmed+NeedsReview 整组完全正确 | ${percent(before.aggregate.exactSetRate)} | ${percent(after.aggregate.exactSetRate)} | — | — | ${signedPercentPoints(finiteDelta(after.aggregate.exactSetRate, before.aggregate.exactSetRate))} |`,
].join('\n');
const reasonTable = [
  '| 拒绝原因 | 数量 | 占全部候选 | 占拒绝候选 |',
  '| --- | ---: | ---: | ---: |',
  ...rejectionReasonRows.map(
    (row) =>
      `| ${row.reason} | ${row.count} | ${percent(row.shareOfCandidates)} | ${percent(row.shareOfRejected)} |`,
  ),
].join('\n');
const actionTable = [
  '| 动作 | 人工 Rep | 修复前预测/匹配 | 修复后预测/匹配 | 修复后 Recall |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...actionRows.map(
    (row) =>
      `| ${row.action} | ${row.truthReps} | ${row.predictedBefore}/${row.matchedBefore} | ${row.predictedAfter}/${row.matchedAfter} | ${percent(row.recallAfter)} |`,
  ),
].join('\n');
const actionViewTable = [
  '| 动作 | 机位 | 人工 Rep | Raw P/M | Confirmed P/M（正式） | +NeedsReview P/M | Rejected P/M（诊断） | 正式 P/R |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...actionViewRows.map((row) => {
    const raw = row.streamsAfter.rawProposal;
    const confirmed = row.streamsAfter.confirmedOnly;
    const review = row.streamsAfter.confirmedPlusNeedsReview;
    const rejected = row.streamsAfter.rejectedDiagnostic;
    return `| ${row.action} | ${row.view} | ${row.truthReps} | ${raw.predicted}/${raw.matched} | ${confirmed.predicted}/${confirmed.matched} | ${review.predicted}/${review.matched} | ${rejected.predicted}/${rejected.matched} | ${percent(confirmed.precision)} / ${percent(confirmed.recall)} |`;
  }),
].join('\n');
const changedActions = actionRows.filter(
  (row) =>
    row.predictedBefore !== row.predictedAfter ||
    row.matchedBefore !== row.matchedAfter,
);
const repeatEvidenceText = repeatVerified
  ? `已验收两个独立回放（runId ${firstPost.value.runId} / ${diagnosticPost.value.runId}）；协议、实际 native runner、预测摘要与完整语义结果一致。`
  : '本次未显式提供独立重复回放 artifact；可复现性状态为未评估。';
const actionChangeSummary = changedActions.length === 0
  ? '本次输入未包含产生动作级差异的兼容基线，因此动作级变化全部为 0；不能从零变化报告推导旧版本修复收益。'
  : `发生变化的动作共 ${changedActions.length} 个：${changedActions.map((row) => `${row.action}（预测 ${signedInteger(row.predictedAfter - row.predictedBefore)}，匹配 ${signedInteger(row.matchedAfter - row.matchedBefore)}）`).join('；')}。`;
const rootCauseSummary = `## 当前召回瓶颈（仅由本次数据支持）\n\nRaw proposal 匹配 ${afterAggregateFunnel.streams.rawProposal.matched}/${after.aggregate.truthRepCount} 个真值（Recall ${percent(afterAggregateFunnel.streams.rawProposal.recall)}），说明主要损失在候选生成/局部坐标之前或之中；Confirmed-only 又降至 ${afterAggregateFunnel.streams.confirmedOnly.matched} 个匹配（Recall ${percent(afterAggregateFunnel.streams.confirmedOnly.recall)}），说明 admission 还有第二层损失。Rejected 诊断流与 ${afterAggregateFunnel.streams.rejectedDiagnostic.matched} 个真值重叠，可用于定位 action×view 参数或证据门槛，但本报告不把任何历史假说（固定正号、某个旧 reason 或单一动作收益）写成已证明根因。`;
const reasonSql = [
  'WITH rejection_reasons(reason, rejected_count, share_of_rejected) AS (',
  '  VALUES',
  rejectionReasonRows
    .map(
      (row, index) =>
        `    ('${row.reason}', ${row.count}, ${row.shareOfRejected})${index === rejectionReasonRows.length - 1 ? '' : ','}`,
    )
    .join('\n'),
  ')',
  'SELECT * FROM rejection_reasons ORDER BY rejected_count DESC;',
].join('\n');
const sqlCheck = spawnSync('sqlite3', [':memory:', reasonSql], {
  encoding: 'utf8',
});
if (sqlCheck.status !== 0) {
  throw new Error(`diagnostic SQL is not reproducible: ${sqlCheck.stderr}`);
}

const sourceId = 'threshold_layering_diagnostic';
const artifact = {
  surface: 'report',
  manifest: {
    version: 1,
    surface: 'report',
    title: '视觉识别 v0.1b 当前四流诊断',
    description:
      '治理回放上的 raw、Confirmed、NeedsReview 与 Rejected 分流及 Rep 准入诊断；可选传入同 schema 基线进行对比。',
    generatedAt: '2026-08-16T12:00:00+08:00',
    cards: [],
    charts: [
      {
        id: 'rejection_reasons',
        title: 'Rep 候选被拒绝的主要原因',
        subtitle: `${candidateCount} 个原始候选中 ${rejectedCount} 个被拒绝；柱状图严格来自当前冻结回放。`,
        type: 'bar',
        dataset: 'rejectionReasons',
        sourceId,
        valueFormat: 'number',
        encodings: {
          x: { field: 'reason', type: 'nominal', label: '拒绝原因' },
          y: {
            field: 'count',
            type: 'quantitative',
            label: '候选数量',
          },
          tooltip: [
            {
              field: 'shareOfRejected',
              type: 'quantitative',
              label: '占拒绝候选',
              format: 'percent',
            },
          ],
        },
      },
    ],
    tables: [],
    sources: [
      {
        id: sourceId,
        label: 'Rust v0.1 同协议四流聚合诊断',
        path: aggregateRelative,
        query: {
          engine: 'sqlite',
          sql: reasonSql,
          description:
            'Reproduces the rejection-reason chart from the aggregate diagnostic report.',
          executed_at: '2026-08-16T12:00:00+08:00',
          language: 'sql',
          tables_used: ['rejection_reasons'],
        },
      },
    ],
    blocks: [
      {
        id: 'title',
        type: 'markdown',
        body: '# 视觉识别 v0.1b 当前四流诊断',
      },
      {
        id: 'executive_summary',
        type: 'markdown',
        sourceId,
        body: `## Executive Summary\n\n- **正式计次流（Confirmed-only）：** Precision ${percent(afterAggregateFunnel.streams.confirmedOnly.precision)}，Recall ${percent(afterAggregateFunnel.streams.confirmedOnly.recall)}，匹配 ${afterAggregateFunnel.streams.confirmedOnly.matched}/${after.aggregate.truthRepCount}。\n- **人工复核诊断流（Confirmed+NeedsReview）：** Precision ${percent(afterAggregateFunnel.streams.confirmedPlusNeedsReview.precision)}，Recall ${percent(afterAggregateFunnel.streams.confirmedPlusNeedsReview.recall)}；不能计入正式训练量。\n- **门槛分层可审计：** 当前有 ${candidateCount} 个 raw proposal、${dispositions.Confirmed ?? 0} 个 Confirmed、${dispositions.NeedsReview ?? 0} 个 NeedsReview、${rejectedCount} 个 Rejected；四条流都独立计算匹配、FP/FN 与边界。\n- **最大拒绝原因：** ${rejectionReasonRows[0]?.reason ?? '无'}（${rejectionReasonRows[0]?.count ?? 0} 个）；是否属于过严拒绝要以 rejected-to-truth overlap 判断，不能仅看原因计数。\n- **器械链路：** Provider 输出 ${after.equipmentProvider.trackerOutputFrameCount} 帧，其中 ${after.structuralRuntime.equipmentChannelFrames} 帧进入局部器械通道；手腕不得替代器械。\n- **质量边界：** 没有治理后的质量人工真值时，只发布事实、TaskCompletion 与 CannotJudge，不发布通用“合格/偏差”。`,
      },
      {
        id: 'metric_comparison',
        type: 'markdown',
        sourceId,
        body: `## 基线与当前四流结果\n\n${metricTable}\n\n${repeatEvidenceText} 只传一个 current artifact 时按 current=current 计算，因此所有变化为 0；只有显式传入兼容 v2 基线时才解释差值。`,
      },
      {
        id: 'admission_diagnosis',
        type: 'markdown',
        sourceId,
        body: `## 召回率在哪里丢失\n\n候选总数 ${candidateCount}：Confirmed ${dispositions.Confirmed ?? 0}、NeedsReview ${dispositions.NeedsReview ?? 0}、Rejected ${rejectedCount}。请同时查看 raw、Confirmed-only、Confirmed+NeedsReview 与 Rejected-overlap 四条流，不能从总候选数直接推断损失都发生在准入。\n\n${reasonTable}`,
      },
      {
        id: 'reason_chart',
        type: 'chart',
        chartId: 'rejection_reasons',
        layout: 'full',
      },
      {
        id: 'root_cause',
        type: 'markdown',
        sourceId,
        body: rootCauseSummary,
      },
      {
        id: 'equipment_path',
        type: 'markdown',
        sourceId,
        body: `## 器械观测与证据准入\n\n器械 Provider 处理 ${after.equipmentProvider.visualProcessedFrameCount} 帧（${after.equipmentProvider.visualProcessingRateHz.toFixed(2)} Hz），输出 ${after.equipmentProvider.trackerOutputFrameCount} 帧轨迹（${after.equipmentProvider.trackerOutputRateHz.toFixed(2)} Hz），其中 ${after.structuralRuntime.equipmentChannelFrames} 帧进入局部器械通道。吞吐、独立器械测量、主体/握持关联和 Rep 准入必须分别报告；任何一层都不能用手腕轨迹补成器械。`,
      },
      {
        id: 'action_results',
        type: 'markdown',
        sourceId,
        body: `## 动作级结果\n\n${actionTable}\n\n${actionChangeSummary}`,
      },
      {
        id: 'action_view_results',
        type: 'markdown',
        sourceId,
        body: `## 动作×机位结果\n\n${actionViewTable}\n\n动作级平均值不能替代这里的明细：参数与可观察关系都以 exact action×view 为单位修复和验收。`,
      },
      {
        id: 'recommended_sequence',
        type: 'markdown',
        sourceId,
        body:
          '## 建议的修复顺序\n\n1. **先校准 action×view candidate。** 以隔离校准集调整主关系、局部坐标、幅度、滞回、返回容忍与 gap；不修改全局阈值。\n2. **再审查 admission 损失。** 优先检查 rejected-to-truth overlap 高的 exact context，并保持 Confirmed-only 为唯一正式计次流。\n3. **按动作计划改进器械证据。** 只增强真实 measured track 的主体/握持关联，手腕与器械相互约束但不互相替代。\n4. **最后优化边界和质量规则。** 先恢复 raw/Confirmed Recall 且不增加负窗口误触发，再优化边界 MAE/IoU，最后用人工质量真值校准 RulePack。',
      },
      {
        id: 'caveats',
        type: 'markdown',
        sourceId,
        body:
          `## 限制与口径\n\n本报告覆盖 53 组已知个人视频、455 个人工 Rep 和 237 个已复核负窗口；Pose sidecar 连接覆盖率为 100%。它是回归测试，不是新用户/新机位泛化率。器械轨迹、换向点和动作质量没有合格人工真值，所以只报告运行覆盖和拒绝原因，不声称准确率。${repeatEvidenceText} 旧 v0.1 输出没有 v2 四流 schema，不能伪造为可比较基线。`,
      },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt: '2026-08-16T12:00:00+08:00',
    status: 'ready',
    datasets: {
      rejectionReasons: rejectionReasonRows,
      actions: actionRows,
      actionViews: actionViewRows,
      summary: [
        {
          cohort: 'known personal videos',
          confirmedOnlyPrecisionBefore:
            beforeAggregateFunnel.streams.confirmedOnly.precision,
          confirmedOnlyPrecisionAfter:
            afterAggregateFunnel.streams.confirmedOnly.precision,
          confirmedOnlyRecallBefore:
            beforeAggregateFunnel.streams.confirmedOnly.recall,
          confirmedOnlyRecallAfter:
            afterAggregateFunnel.streams.confirmedOnly.recall,
          streams: afterAggregateFunnel.streams,
          candidateCount,
          rejectedCount,
        },
      ],
    },
  },
};

// The two report payloads are published as one immutable version directory.
// Readers follow only the atomic current pointer, so they can never observe a
// new aggregate paired with an older report artifact.
const aggregateBytes = Buffer.from(`${JSON.stringify(aggregate, null, 2)}\n`);
const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
const pairManifest = {
  schemaVersion: 'maxpower.visual-recognition-derived-report-pair/v1',
  pairId,
  versionDirectory: versionRelative,
  aggregate: {
    path: aggregateRelative,
    sha256: sha256(aggregateBytes),
  },
  artifact: {
    path: artifactRelative,
    sha256: sha256(artifactBytes),
  },
  repeatExecution: controlledRepeat,
};
const manifestBytes = Buffer.from(`${JSON.stringify(pairManifest, null, 2)}\n`);
const finalVersionPath = resolve(governanceRoot, versionRelative);
if (existsSync(finalVersionPath)) {
  for (const [path, expected] of [
    [aggregatePath, aggregateBytes],
    [artifactPath, artifactBytes],
    [manifestPath, manifestBytes],
  ]) {
    if (!readFileSync(path).equals(expected)) {
      throw new Error(`immutable derived-report version collision at ${path}`);
    }
  }
} else {
  const temporaryVersionPath = resolve(
    outputRoot,
    `.tmp-${pairId}-${process.pid}-${randomUUID()}`,
  );
  mkdirSync(temporaryVersionPath, { recursive: false });
  writeFileSync(resolve(temporaryVersionPath, 'aggregate.json'), aggregateBytes, { flag: 'wx' });
  writeFileSync(resolve(temporaryVersionPath, 'artifact.json'), artifactBytes, { flag: 'wx' });
  writeFileSync(resolve(temporaryVersionPath, 'manifest.json'), manifestBytes, { flag: 'wx' });
  mkdirSync(resolve(outputRoot, 'versions'), { recursive: true });
  renameSync(temporaryVersionPath, finalVersionPath);
}

const pointerPath = resolve(outputRoot, 'visual-recognition-v0.1b-current.json');
const pointerBytes = Buffer.from(`${JSON.stringify({
  schemaVersion: 'maxpower.visual-recognition-derived-report-pointer/v1',
  pairId,
  manifest: {
    path: manifestRelative,
    sha256: sha256(manifestBytes),
  },
}, null, 2)}\n`);
const temporaryPointerPath = resolve(
  outputRoot,
  `.visual-recognition-v0.1b-current.json.tmp-${process.pid}-${randomUUID()}`,
);
writeFileSync(temporaryPointerPath, pointerBytes, { flag: 'wx' });
renameSync(temporaryPointerPath, pointerPath);
process.stdout.write(
  `${JSON.stringify({ aggregatePath, artifactPath, manifestPath, pointerPath, pairId, repeatRunCoreResultMatched: repeatVerified ? true : null, candidateCount, rejectedCount })}\n`,
);
