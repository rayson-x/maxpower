import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const governanceRoot = resolve(root, '../maxpower-training-data-governance');
const workspaceRoot = resolve(
  governanceRoot,
  'workspace/visual-recognition-v0.1',
);
const baselinePath = resolve(workspaceRoot, 'full-known-video-evaluation.json');
const firstPostPath = resolve(
  workspaceRoot,
  'post-threshold-layering-2026-08-15-evaluation.json',
);
const diagnosticPostPath = resolve(
  workspaceRoot,
  'post-threshold-layering-diagnostic-2026-08-15.json',
);
const aggregateRelative =
  'docs/reports/visual-recognition-v0.1-threshold-layering-diagnostic-2026-08-15.json';
const artifactRelative =
  'docs/reports/visual-recognition-v0.1-threshold-layering-report-artifact-2026-08-15.json';
const aggregatePath = resolve(root, aggregateRelative);
const artifactPath = resolve(root, artifactRelative);

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
const after = diagnosticPost.value;

const stableCore = (evaluation) => ({
  aggregate: evaluation.aggregate,
  buckets: evaluation.buckets,
  dataQuality: evaluation.dataQuality,
  equipmentProvider: evaluation.equipmentProvider,
  turnaroundEvaluation: evaluation.turnaroundEvaluation,
  localStates: evaluation.structuralRuntime.localStates,
  fusionStates: evaluation.structuralRuntime.fusionStates,
  dimensionStates: evaluation.structuralRuntime.dimensionStates,
});
if (
  JSON.stringify(stableCore(firstPost.value)) !==
  JSON.stringify(stableCore(diagnosticPost.value))
) {
  throw new Error('the two post-fix runs did not reproduce the same core result');
}

const metricDelta = (field) => after.aggregate[field] - before.aggregate[field];
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
    shareOfCandidates: count / candidateCount,
    shareOfRejected: count / rejectedCount,
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
    };
  })
  .sort(
    (left, right) =>
      (left.recallAfter ?? -1) - (right.recallAfter ?? -1) ||
      left.actionView.localeCompare(right.actionView),
  );

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
  generatedOn: '2026-08-15',
  evaluationClass: after.evaluationStatus,
  generalizationClaimAllowed: false,
  decision: 'recall_blocked_by_rep_admission_semantics',
  source: {
    baselineEvaluationSha256: sha256(baseline.bytes),
    postFixEvaluationSha256: sha256(firstPost.bytes),
    diagnosticEvaluationSha256: sha256(diagnosticPost.bytes),
    protocolSha256: after.protocolSha256,
    repeatRunCoreResultMatched: true,
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
    rejectionRate: rejectedCount / candidateCount,
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
      finding:
        'ActionPrimaryDirectionMismatch rejects half of all sealed Rep candidates and 59.5% of rejected candidates.',
      interpretation:
        'The local-coordinate validator requires a positive endpoint delta after Rep segmentation. That duplicates direction judgement and conflates real wrong-way motion with axis-sign or sampled-boundary disagreement.',
    },
    {
      priority: 2,
      finding:
        'RequiredJointLoss accounts for 34 rejected candidates even though the reason also covers coordinates that are not Frozen or signals that are temporarily ineligible.',
      interpretation:
        'The current reason is overloaded; it does not prove an anatomical joint was actually lost and prevents calibrated NeedsReview handling.',
    },
    {
      priority: 3,
      finding:
        'The equipment provider emits 30,520 track frames, but only 1,289 frames enter the local equipment channel and no rigid-bar Rep is produced.',
      interpretation:
        'Throughput is adequate. The bottleneck is subject/grip association, canonical local evidence and consensus admission—not FPS.',
    },
  ],
  recommendedSequence: [
    'Make TaskPrimary cycle validation sign-stable: validate departure-turnaround-return topology in the action-local frame, or bind an explicit expected sign from the action definition; do not require an arbitrary positive endpoint delta after segmentation.',
    'Split RequiredJointLoss into typed CoordinateNotFrozen, SignalUnavailable and TransitionEvidenceWeak outcomes; bounded uncertainty becomes NeedsReview while true identity-relation loss remains Rejected.',
    'Keep equipment observations independent from wrists, but improve continuous subject/grip association so measured tracks can enter the canonical local channel and Rep consensus.',
    'Re-run this exact governed benchmark after each isolated change. Protect precision and reviewed-negative-window triggers while first recovering candidate retention, then boundary accuracy, then quality calibration.',
  ],
  limitations: [
    'This is a known-participant, known-video regression set and cannot support a generalization claim.',
    'There is no admitted human truth for equipment tracks, turnaround points or technique-quality conclusions, so their accuracy remains not evaluable.',
    'The baseline fixture intentionally remains immutable; the ignored replay test reports a baseline-delta assertion after producing the complete post-fix output.',
  ],
};
writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);

const percent = (value) => `${(value * 100).toFixed(2)}%`;
const signedPercentPoints = (value) =>
  `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)} pp`;
const metricTable = [
  '| 指标 | 修复前 | 修复后 | 变化 |',
  '| --- | ---: | ---: | ---: |',
  `| Precision | ${percent(before.aggregate.candidatePrecision)} | ${percent(after.aggregate.candidatePrecision)} | ${signedPercentPoints(aggregate.delta.candidatePrecision)} |`,
  `| Recall | ${percent(before.aggregate.candidateRecall)} | ${percent(after.aggregate.candidateRecall)} | ${signedPercentPoints(aggregate.delta.candidateRecall)} |`,
  `| 匹配 Rep | ${before.aggregate.matchedRepCount} | ${after.aggregate.matchedRepCount} | +${aggregate.delta.matchedRepCount} |`,
  `| 误报 Rep | ${before.aggregate.falsePositiveCount} | ${after.aggregate.falsePositiveCount} | ${aggregate.delta.falsePositiveCount} |`,
  `| 漏检 Rep | ${before.aggregate.missedCount} | ${after.aggregate.missedCount} | ${aggregate.delta.missedCount} |`,
  `| 严格边界对齐 | ${percent(before.aggregate.strictBoundaryAlignedRate)} | ${percent(after.aggregate.strictBoundaryAlignedRate)} | 0.00 pp |`,
  `| 整组完全正确 | ${percent(before.aggregate.exactSetRate)} | ${percent(after.aggregate.exactSetRate)} | 0.00 pp |`,
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
  '| 动作 | 机位 | 人工 Rep | 修复后预测/匹配 | FP/FN | Recall | Start / Turnaround / End MAE | IoU |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...actionViewRows.map(
    (row) =>
      `| ${row.action} | ${row.view} | ${row.truthReps} | ${row.predictedAfter}/${row.matchedAfter} | ${row.falsePositiveAfter}/${row.missedAfter} | ${percent(row.recallAfter)} | ${row.startMaeMsAfter ?? '—'} / ${row.turnaroundMaeMsAfter ?? '—'} / ${row.endMaeMsAfter ?? '—'} | ${row.meanIntervalIoUAfter ?? '—'} |`,
  ),
].join('\n');
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
    title: '视觉识别 v0.1 门槛分层修复诊断',
    description:
      '同一治理基准上的修复前后 Precision/Recall 对比与 Rep 准入拒绝原因诊断。',
    generatedAt: '2026-08-15T22:00:00+08:00',
    cards: [],
    charts: [
      {
        id: 'rejection_reasons',
        title: 'Rep 候选被拒绝的主要原因',
        subtitle:
          '194 个封存的 Rep 候选中 163 个被拒绝；方向不匹配占拒绝候选的 59.5%。',
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
        label: 'Rust v0.1 同协议重复回放聚合诊断',
        path: aggregateRelative,
        query: {
          engine: 'sqlite',
          sql: reasonSql,
          description:
            'Reproduces the rejection-reason chart from the aggregate diagnostic report.',
          executed_at: '2026-08-15T22:00:00+08:00',
          language: 'sql',
          tables_used: ['rejection_reasons'],
        },
      },
    ],
    blocks: [
      {
        id: 'title',
        type: 'markdown',
        body: '# 视觉识别 v0.1 门槛分层修复诊断',
      },
      {
        id: 'executive_summary',
        type: 'markdown',
        sourceId,
        body:
          '## Executive Summary\n\n- **修复方向正确，但提升很小。** Precision 从 50.00% 升至 51.61%，Recall 从 3.30% 升至 3.52%；多匹配 1 个 Rep，误报没有增加。\n- **召回率低的主因不是没形成动作候选。** 运行时封存了 194 个 Rep 候选，但拒绝 163 个，拒绝率为 84.02%。\n- **最严重的问题是方向准入语义。** `ActionPrimaryDirectionMismatch` 拒绝 97 个候选，占全部拒绝的 59.51%；它混合了真实反向运动与局部坐标符号/端点取样不一致。\n- **FPS 不是主瓶颈。** 器械视觉与轨迹输出约 29.7/29.4 Hz，但进入局部器械通道的证据很少，刚性杠铃仍为 0 Rep。\n- **质量分析没有拖低 Recall。** 质量结论位于 Rep 之后，目前多数是 `CannotJudge`；低召回发生在 Rep admission，质量准确率仍因没有人工真值而不可评价。',
      },
      {
        id: 'metric_comparison',
        type: 'markdown',
        sourceId,
        body: `## 修复前后识别结果\n\n${metricTable}\n\n两次修复后全量回放的核心结果完全一致，说明这不是随机波动。`,
      },
      {
        id: 'admission_diagnosis',
        type: 'markdown',
        sourceId,
        body: `## 召回率在哪里丢失\n\n候选总数 194：Confirmed 26、NeedsReview 5、Rejected 163。也就是说，算法已经看到并分段出运动周期，主要损失发生在随后叠加的动作权威准入门槛。\n\n${reasonTable}`,
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
        body:
          '## 为什么新算法反而漏检更多\n\n新算法正确地移除了“手腕就是器械”和固定屏幕方向等捷径，因此不会轻易把噪声发布成正式 Rep；但随后又把**局部坐标必须冻结、主方向端点必须为正、必要关节必须持续可用、器械必须形成正式共识**同时作为硬拒绝条件。方向判断还在 RepEngine 已完成周期分段后再次检查固定正号，造成重复且不稳定的否决。结果是 Precision 只略升，Recall 被多重 fail-closed 门槛压垮。',
      },
      {
        id: 'equipment_path',
        type: 'markdown',
        sourceId,
        body:
          '## 器械链路不是帧率问题\n\n器械 Provider 处理 30,793 帧（29.67 Hz），输出 30,520 帧轨迹（29.40 Hz），但只有 1,289 帧进入局部器械通道；融合状态中 `CannotJudge` 为 10,164 帧，最终刚性杠铃 Rep 和 equipment-fused 换向点都为 0。应继续保持器械独立观测、禁止手腕替代器械，但需要修复连续主体/握持关联和 canonical local evidence 的进入条件。',
      },
      {
        id: 'action_results',
        type: 'markdown',
        sourceId,
        body: `## 动作级结果\n\n${actionTable}\n\n这次唯一新增的正确识别来自 rear_delt_fly（+1 matched Rep）；其余动作没有变化。因此刚修复的“可选协调关节不应阻断 Rep”确实有效，但不是主要召回瓶颈。`,
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
          '## 建议的修复顺序\n\n1. **先修 TaskPrimary 方向语义。** 在动作局部坐标中验证“离开起点—换向—返回”的拓扑，或由动作定义明确绑定期望符号；不要在已完成周期后再要求任意正号。\n2. **拆分 `RequiredJointLoss`。** 区分坐标未冻结、信号暂时缺失、转换证据弱和真正必要关系丢失；前三者在有完整候选时优先进入 NeedsReview，而不是统一 Rejected。\n3. **再修器械 canonical association。** 保持手腕与器械相互约束但不互相替代，让真实 measured track 连续进入局部器械通道与 Rep consensus。\n4. **最后优化边界和质量规则。** 先恢复 Recall 且不增加负窗口误触发，再优化换向 MAE/IoU，最后用人工质量标注校准 RulePack。每一步都使用同一冻结协议单独回放，避免多个门槛同时变化。',
      },
      {
        id: 'caveats',
        type: 'markdown',
        sourceId,
        body:
          '## 限制与口径\n\n本报告覆盖 53 组已知个人视频、455 个人工 Rep 和 237 个已复核负窗口；Pose sidecar 连接覆盖率为 100%。它是回归测试，不是新用户/新机位泛化率。器械轨迹、换向点和动作质量没有合格人工真值，所以只报告运行覆盖和拒绝原因，不声称准确率。旧 v0.1 基线保持不可变；回放测试在写完新结果后因检测到结构基线从 6 组变为 7 组而按预期报出版本差异。',
      },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt: '2026-08-15T22:00:00+08:00',
    status: 'ready',
    datasets: {
      rejectionReasons: rejectionReasonRows,
      actions: actionRows,
      actionViews: actionViewRows,
      summary: [
        {
          cohort: 'known personal videos',
          precisionBefore: before.aggregate.candidatePrecision,
          precisionAfter: after.aggregate.candidatePrecision,
          recallBefore: before.aggregate.candidateRecall,
          recallAfter: after.aggregate.candidateRecall,
          candidateCount,
          rejectedCount,
        },
      ],
    },
  },
};
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ aggregatePath, artifactPath, repeatRunCoreResultMatched: true, candidateCount, rejectedCount })}\n`,
);
