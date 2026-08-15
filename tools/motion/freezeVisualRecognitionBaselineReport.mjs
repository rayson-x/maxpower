import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const governanceRoot = resolve(root, '../maxpower-training-data-governance');
const inputPath = resolve(
  governanceRoot,
  process.argv[2] ??
    'workspace/visual-recognition-v0.1/full-known-video-evaluation.json',
);
const aggregateRelative =
  'docs/reports/visual-recognition-v0.1-baseline-2026-08-15.json';
const artifactRelative =
  'docs/reports/visual-recognition-v0.1-report-artifact-2026-08-15.json';
const aggregatePath = resolve(root, aggregateRelative);
const artifactPath = resolve(root, artifactRelative);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const inputBytes = readFileSync(inputPath);
const full = JSON.parse(inputBytes);
if (
  full.schemaVersion !==
    'maxpower.visual-recognition-known-video-evaluation/v0.1' ||
  full.evaluationId !==
    'visual-recognition-v0.1-known-video-baseline-2026-08-15'
) {
  throw new Error('input is not the frozen v0.1 visual-recognition evaluation');
}
if (full.generalizationClaimAllowed !== false) {
  throw new Error('known-video baseline must forbid generalization claims');
}

const actionRows = Object.entries(full.buckets.byAction)
  .map(([action, metrics]) => ({
    action,
    records: metrics.recordCount,
    truthReps: metrics.truthRepCount,
    predictedReps: metrics.predictedRepCount,
    matchedReps: metrics.matchedRepCount,
    precision: metrics.candidatePrecision,
    recall: metrics.candidateRecall,
    exactSetRate: metrics.exactSetRate,
  }))
  .sort((left, right) =>
    (right.recall ?? -1) - (left.recall ?? -1) ||
    left.action.localeCompare(right.action),
  );
const recognizedRecordCount = full.rows.filter(
  (row) => row.predictedCount > 0,
).length;
const actionsWithPredictions = actionRows.filter(
  (row) => row.predictedReps > 0,
).length;
const fullEvaluationSha256 = sha256(inputBytes);

const aggregate = {
  schemaVersion: 'maxpower.visual-recognition-baseline-report/v0.1',
  baselineVersion: '0.1.0',
  generatedOn: '2026-08-15',
  catalogId: 'maxpower/visual-recognition-baseline/v0.1',
  evaluationId: full.evaluationId,
  evaluationClass: full.evaluationStatus,
  generalizationClaimAllowed: false,
  decision: 'not_ready_for_reliable_user_rep_counting',
  source: {
    fullEvaluationSha256,
    reportDigest: full.reportDigest,
    protocolSha256: full.protocolSha256,
    humanSupervisionAssetId: 'personal-human-rep-ranges-v2',
    poseFeatureAssetId: 'personal-native-rtmpose-halpe26-observations',
    rawVideoAssetId: 'personal-raw-capture-archive',
  },
  dataQuality: full.dataQuality,
  headline: {
    ...full.aggregate,
    recognizedRecordCount,
    recognizedRecordRate:
      recognizedRecordCount / full.aggregate.recordCount,
    actionCount: actionRows.length,
    actionsWithPredictions,
  },
  byAction: actionRows,
  equipmentObservation: full.equipmentProvider,
  motionLifecycle: full.structuralRuntime,
  turnaroundEvaluation: full.turnaroundEvaluation,
  qualityAccuracyStatus:
    full.unsupportedAccuracyClaims.techniqueQualityAccuracy,
  interpretation: {
    primaryFailure:
      'The plan-driven runtime usually cannot establish the TaskPrimary and required relation evidence needed to admit a Rep.',
    structuralCoverageMeaning:
      'Action assets, providers and trace roots install and execute, but structural execution is not accuracy evidence.',
    equipmentMeaning:
      'Provider output rate is measurable; track geometry, association, grip and turnaround accuracy are not evaluable without accepted human truth.',
  },
};
writeFileSync(aggregatePath, `${JSON.stringify(aggregate, null, 2)}\n`);

const summaryRows = [
  {
    cohort: 'known personal videos',
    precision: full.aggregate.candidatePrecision,
    recall: full.aggregate.candidateRecall,
    exactSetRate: full.aggregate.exactSetRate,
    recognizedRecordRate: recognizedRecordCount / full.aggregate.recordCount,
  },
];
const providerRows = [
  {
    stage: 'Pose input',
    frames: full.equipmentProvider.poseInputFrameCount,
    rateHz: full.equipmentProvider.poseInputRateHz,
  },
  {
    stage: 'Visual processed',
    frames: full.equipmentProvider.visualProcessedFrameCount,
    rateHz: full.equipmentProvider.visualProcessingRateHz,
  },
  {
    stage: 'Provider track output',
    frames: full.equipmentProvider.trackerOutputFrameCount,
    rateHz: full.equipmentProvider.trackerOutputRateHz,
  },
  {
    stage: 'Local equipment channel',
    frames: full.structuralRuntime.equipmentChannelFrames,
    rateHz: null,
  },
];
const percent = (value) =>
  value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const actionTable = [
  '| 动作 | 视频组 | 人工 Rep | 预测 Rep | 匹配 Rep | Precision | Recall | 整组正确率 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...actionRows.map(
    (row) =>
      `| ${row.action} | ${row.records} | ${row.truthReps} | ${row.predictedReps} | ${row.matchedReps} | ${percent(row.precision)} | ${percent(row.recall)} | ${percent(row.exactSetRate)} |`,
  ),
].join('\n');
const providerTable = [
  '| 阶段 | 帧数 | 频率 |',
  '| --- | ---: | ---: |',
  ...providerRows.map(
    (row) =>
      `| ${row.stage} | ${row.frames.toLocaleString('en-US')} | ${row.rateHz == null ? '—' : `${row.rateHz.toFixed(1)} Hz`} |`,
  ),
].join('\n');
const actionMetricsSql = [
  'WITH action_metrics(action, records, truth_reps, predicted_reps, matched_reps, precision, recall, exact_set_rate) AS (',
  '  VALUES',
  actionRows
    .map(
      (row, index) =>
        `    ('${row.action.replaceAll("'", "''")}', ${row.records}, ${row.truthReps}, ${row.predictedReps}, ${row.matchedReps}, ${row.precision ?? 'NULL'}, ${row.recall ?? 'NULL'}, ${row.exactSetRate ?? 'NULL'})${index === actionRows.length - 1 ? '' : ','}`,
    )
    .join('\n'),
  ')',
  'SELECT * FROM action_metrics ORDER BY recall DESC, action ASC;',
].join('\n');
const sqlCheck = spawnSync('sqlite3', [':memory:', actionMetricsSql], {
  encoding: 'utf8',
});
if (sqlCheck.status !== 0) {
  throw new Error(`action metric SQL is not reproducible: ${sqlCheck.stderr}`);
}

const sourceId = 'v0_1_baseline';
const artifact = {
  surface: 'report',
  manifest: {
    version: 1,
    surface: 'report',
    title: '视觉识别 v0.1 基线报告',
    description: '当前 Rust 视觉识别全链路在已知个人视频上的冻结基线。',
    generatedAt: '2026-08-15T12:00:00+08:00',
    cards: [],
    charts: [
      {
        id: 'action_recall',
        title: '各动作 Rep Recall',
        subtitle: '53 组已知视频、455 个人工 Rep；11/12 个动作当前 Recall 为 0。',
        type: 'bar',
        dataset: 'actions',
        sourceId,
        valueFormat: 'percent',
        encodings: {
          x: { field: 'action', type: 'nominal', label: '动作' },
          y: {
            field: 'recall',
            type: 'quantitative',
            label: 'Recall',
            format: 'percent',
          },
          tooltip: [
            { field: 'truthReps', type: 'quantitative', label: '人工 Rep' },
            { field: 'predictedReps', type: 'quantitative', label: '预测 Rep' },
            { field: 'matchedReps', type: 'quantitative', label: '匹配 Rep' },
          ],
        },
      },
    ],
    tables: [],
    sources: [
      {
        id: sourceId,
        label: 'Rust 视觉识别 v0.1 冻结聚合结果',
        path: aggregateRelative,
        query: {
          engine: 'sqlite',
          sql: actionMetricsSql,
          description: 'Reproduces the action-level chart snapshot from the frozen aggregate report.',
          executed_at: '2026-08-15T12:00:00+08:00',
          language: 'sql',
          tables_used: ['action_metrics'],
        },
      },
    ],
    blocks: [
      { id: 'title', type: 'markdown', body: '# 视觉识别 v0.1 基线报告' },
      {
        id: 'executive_summary',
        type: 'markdown',
        sourceId,
        body:
          '## Executive Summary\n\n- **当前版本还不能可靠用于用户计次。** 455 个人工 Rep 中只匹配到 15 个，Recall 为 3.3%；53 组视频没有一组整组次数完全正确。\n- **结构覆盖与识别效果出现明显断层。** 248 个动作资产可以安装、53 组都能产出完整 Trace，但只有 6 组产生非拒绝 Rep。\n- **器械 Provider 的吞吐不是主要瓶颈。** 视觉处理约 29.7 Hz、Provider 输出约 29.4 Hz；主要失败发生在器械/人体证据进入局部坐标、融合并满足动作所需关系之后。\n- **这份结果是已知视频回归基线，不是泛化率。** 器械轨迹、换向点和动作质量缺少人工真值，不能报告准确率。',
      },
      {
        id: 'headline_metrics',
        type: 'markdown',
        sourceId,
        body:
          '## 当前识别结果\n\n| 指标 | 结果 | 定义 |\n| --- | ---: | --- |\n| Candidate Precision | 50.0% | 匹配 Rep / 全部预测 Rep |\n| Candidate Recall | 3.3% | 匹配 Rep / 455 个人工 Rep |\n| 整组次数完全正确 | 0.0% | 预测次数与人工次数完全一致 |\n| 产生 Rep 的视频组 | 11.3% | 53 组中有 6 组产生非拒绝 Rep |',
      },
      {
        id: 'finding_gap',
        type: 'markdown',
        sourceId,
        body:
          '## 只有一个动作产生了可匹配 Rep\n\n单侧绳索侧平举产生 30 个预测 Rep，其中 15 个与人工区间匹配，动作内 Recall 为 22.1%。其余 11 个动作 Recall 都是 0。**这意味着下一轮应先修复通用 TaskPrimary/必要关系的证据建立与 Rep admission，而不是继续扩动作目录。**',
      },
      {
        id: 'action_table',
        type: 'markdown',
        sourceId,
        body: `## 动作级识别明细\n\n${actionTable}`,
      },
      { id: 'action_chart', type: 'chart', chartId: 'action_recall', layout: 'full' },
      {
        id: 'finding_provider',
        type: 'markdown',
        sourceId,
        body:
          '## Provider 有输出，但融合后的有效运动证据不足\n\n33 组请求了器械 Provider，视觉层处理了 30.8k 帧并输出 30.5k 个轨迹帧；但完整运行中只有 1,289 帧进入局部器械通道，所有刚性杠铃动作最终都没有产生 Rep。**因此问题不是简单提高 FPS，而是独立器械观测、握持/主体关联、局部坐标和 ActionObservationPlan required relation 之间尚未形成可用闭环。**',
      },
      {
        id: 'provider_table',
        type: 'markdown',
        sourceId,
        body: `## Provider 观测链路\n\n${providerTable}\n\n帧数与处理频率用于判断吞吐和证据进入情况，不代表器械坐标准确率。`,
      },
      {
        id: 'next_steps',
        type: 'markdown',
        body:
          '## 下一轮先恢复可识别闭环\n\n1. 为每个失败动作输出 Rep admission 拒绝原因分布，定位 TaskPrimary、关节关系、器械关联和返回端点分别在哪一步丢失。\n2. 先用卧推、划船、推举、固定器械推胸、哑铃侧平举建立 5 类端到端可识别样例，再验证通用引擎是否只靠动作资产扩展。\n3. 保留当前 v0.1 协议和输入哈希；后续版本必须在同一基线上同时报告 Precision、Recall、整组正确率、边界和负窗口触发。\n4. 在器械轨迹、握持、换向点和动作质量获得人工真值之前，只报告覆盖与拒绝原因，不声称准确率。',
      },
      {
        id: 'questions',
        type: 'markdown',
        body:
          '## 仍需回答的问题\n\n- 刚性杠铃轨迹为何有大量 Provider 输出，却没有任何 equipment-fused Rep？\n- 固定器械与哑铃的 point Provider 是否识别了真实器械，还是仅产生了高覆盖的候选轨迹？\n- ActionObservationPlan 的 required relation 是否对现有 Halpe-26 观测设置了无法满足的证据条件？',
      },
      {
        id: 'caveats',
        type: 'markdown',
        sourceId,
        body:
          '## 限制与口径\n\n这是同一位已知参与者、已知视频的回归测试；它不能证明新用户或新机位效果。Rep 计数与区间使用人工标注评价。器械坐标、主体关联、握持、换向点和质量结论没有合格人工真值，因此均标记为不可评价。3 个退化 Rep 区间和 1 个整组计数不一致记录按治理规则排除。',
      },
    ],
  },
  snapshot: {
    version: 1,
    generatedAt: '2026-08-15T12:00:00+08:00',
    status: 'ready',
    datasets: {
      summary: summaryRows,
      actions: actionRows,
      provider: providerRows,
    },
  },
};
writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ aggregatePath, artifactPath, fullEvaluationSha256, reportDigest: full.reportDigest, recognizedRecordCount, actionsWithPredictions })}\n`,
);
