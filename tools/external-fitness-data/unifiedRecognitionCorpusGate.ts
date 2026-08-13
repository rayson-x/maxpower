import fs from "node:fs";
import path from "node:path";

interface MmFitRow {
  readonly sourceSequenceId: string;
  readonly split: string;
  readonly exerciseId: string;
  readonly expectedCount: number;
  readonly predictedCount: number | null;
  readonly status: string;
  readonly profileIdentity?: string;
  readonly profileSource?: string;
}

interface MmFitReport {
  readonly summary: CountSummary;
  readonly bySplit: Readonly<Record<string, CountSummary>>;
  readonly rows: readonly MmFitRow[];
}

interface ApprovedRow {
  readonly captureId: string;
  readonly truthCount: number;
  readonly predictedCount: number;
  readonly matchedCount: number;
  readonly falsePositiveCount: number;
  readonly exact: boolean;
}

interface ApprovedReport {
  readonly summary: {
    readonly captureCount: number;
    readonly exactCaptureCount: number;
    readonly truthRepCount: number;
    readonly predictedRepCount: number;
    readonly matchedRepCount: number;
  };
  readonly buckets: readonly {
    readonly key: string;
    readonly status: string;
    readonly profile?: { readonly identity: string };
    readonly rows?: readonly ApprovedRow[];
  }[];
}

interface CountSummary {
  readonly clipCount: number;
  readonly truthRepCount: number;
  readonly predictedRepCount: number;
  readonly exactCountRatio: number | null;
}

const round = (value: number): number => Math.round(value * 10_000) / 10_000;

const DEFAULT_MMFIT_REPORT = "docs/reports/mmfit-candidate-profile-benchmark-2026-08-09.json";
const DEFAULT_APPROVED_REPORT = "docs/reports/existing-video-profile-tuning-2026-08-09.json";
const DEFAULT_OUTPUT_REPORT = "docs/reports/unified-recognition-corpus-gate-2026-08-09.json";

export function parseUnifiedRecognitionCorpusGateArgs(argv: readonly string[]) {
  const enforce = argv.includes("--enforce");
  const positional = argv.filter((argument) => argument !== "--enforce");
  return {
    mmfitPath: positional[0] ?? DEFAULT_MMFIT_REPORT,
    approvedPath: positional[1] ?? DEFAULT_APPROVED_REPORT,
    outputPath: positional[2] ?? DEFAULT_OUTPUT_REPORT,
    enforce,
  };
}

export function buildUnifiedRecognitionCorpusReport(mmfit: MmFitReport, approved: ApprovedReport) {
  const mmfitRows = mmfit.rows.filter(
    (row): row is MmFitRow & { predictedCount: number } => row.status === "evaluated" && row.predictedCount !== null,
  );
  const approvedRows = approved.buckets.flatMap((bucket) => (bucket.rows ?? []).map((row) => ({
    ...row,
    bucketKey: bucket.key,
    profileIdentity: bucket.profile?.identity ?? null,
  })));
  const mmfitExact = mmfitRows.filter((row) => row.predictedCount === row.expectedCount);
  const approvedExact = approvedRows.filter((row) => row.exact);
  const exactSampleCount = mmfitExact.length + approvedExact.length;
  const totalSampleCount = mmfitRows.length + approvedRows.length;
  const truthRepCount = mmfitRows.reduce((sum, row) => sum + row.expectedCount, 0)
    + approvedRows.reduce((sum, row) => sum + row.truthCount, 0);
  const predictedRepCount = mmfitRows.reduce((sum, row) => sum + row.predictedCount, 0)
    + approvedRows.reduce((sum, row) => sum + row.predictedCount, 0);
  const approvedPhaseExact = approvedRows.filter((row) => (
    row.exact
    && row.matchedCount === row.truthCount
    && row.falsePositiveCount === 0
  ));
  const complete = mmfitRows.length === 616 && approvedRows.length === 11;
  const passed = complete
    && exactSampleCount === totalSampleCount
    && approvedPhaseExact.length === approvedRows.length;

  return {
    schemaVersion: "maxpower-unified-recognition-corpus-gate/v1",
    generatedAt: new Date().toISOString(),
    objective: "Every available MM-Fit set and every approved MaxPower capture must count exactly; captures with rep boundaries must also phase-match every rep without false positives.",
    passed,
    supervisionContract: {
      mmfit: {
        poseSource: "MM-Fit COCO-18 2D, exact joints mapped to BlazePose33 slots",
        annotationGranularity: "set_count",
        proves: ["whole-set exact count"],
        cannotProve: ["per-rep start/peak/end alignment", "mobile MediaPipe Heavy parity"],
      },
      approvedCaptures: {
        poseSource: "MaxPower MediaPipe Pose Landmarker Heavy",
        annotationGranularity: "per_rep_start_peak_end_with_notes",
        proves: ["whole-set exact count", "per-rep phase alignment"],
      },
    },
    aggregate: {
      complete,
      totalSampleCount,
      exactSampleCount,
      exactSampleRatio: totalSampleCount ? round(exactSampleCount / totalSampleCount) : 0,
      truthRepCount,
      predictedRepCount,
      repCountRatio: truthRepCount ? round(predictedRepCount / truthRepCount) : 0,
      approvedPhaseExactCaptureCount: approvedPhaseExact.length,
      approvedPhaseCaptureCount: approvedRows.length,
    },
    sources: {
      mmfit: {
        sampleCount: mmfitRows.length,
        exactSampleCount: mmfitExact.length,
        truthRepCount: mmfitRows.reduce((sum, row) => sum + row.expectedCount, 0),
        predictedRepCount: mmfitRows.reduce((sum, row) => sum + row.predictedCount, 0),
        bySplit: mmfit.bySplit,
      },
      approvedCaptures: {
        sampleCount: approvedRows.length,
        exactSampleCount: approvedExact.length,
        truthRepCount: approvedRows.reduce((sum, row) => sum + row.truthCount, 0),
        predictedRepCount: approvedRows.reduce((sum, row) => sum + row.predictedCount, 0),
        matchedRepCount: approvedRows.reduce((sum, row) => sum + row.matchedCount, 0),
        phaseExactSampleCount: approvedPhaseExact.length,
      },
    },
    failures: {
      mmfit: mmfitRows.filter((row) => row.predictedCount !== row.expectedCount).map((row) => ({
        sourceSequenceId: row.sourceSequenceId,
        split: row.split,
        exerciseId: row.exerciseId,
        expectedCount: row.expectedCount,
        predictedCount: row.predictedCount,
        delta: row.predictedCount - row.expectedCount,
        profileIdentity: row.profileIdentity ?? null,
        profileSource: row.profileSource ?? "initializer",
      })),
      approvedCaptures: approvedRows.filter((row) => !approvedPhaseExact.includes(row)).map((row) => ({
        captureId: row.captureId,
        bucketKey: row.bucketKey,
        expectedCount: row.truthCount,
        predictedCount: row.predictedCount,
        matchedCount: row.matchedCount,
        falsePositiveCount: row.falsePositiveCount,
        profileIdentity: row.profileIdentity,
      })),
    },
  };
}

function markdown(report: ReturnType<typeof buildUnifiedRecognitionCorpusReport>): string {
  const aggregate = report.aggregate;
  const mmfit = report.sources.mmfit;
  const approved = report.sources.approvedCaptures;
  return `# 完整骨架识别语料门禁\n\n` +
    `生成时间：${report.generatedAt}\n\n` +
    `## 结论\n\n` +
    `当前门禁：**${report.passed ? "通过" : "未通过"}**。这不是只验证人工录制视频，而是同时验证 MM-Fit 与 MaxPower 已批准视频。\n\n` +
    `| 语料 | 组/视频 | 整组完全对齐 | 真值 reps | 预测 reps | 逐 rep 相位 |\n` +
    `|---|---:|---:|---:|---:|---:|\n` +
    `| MM-Fit | ${mmfit.sampleCount} | ${mmfit.exactSampleCount} | ${mmfit.truthRepCount} | ${mmfit.predictedRepCount} | 无逐 rep 标签，不能评估 |\n` +
    `| 已批准视频 | ${approved.sampleCount} | ${approved.exactSampleCount} | ${approved.truthRepCount} | ${approved.predictedRepCount} | ${approved.phaseExactSampleCount}/${approved.sampleCount} 视频完全对齐 |\n` +
    `| 合计 | ${aggregate.totalSampleCount} | ${aggregate.exactSampleCount} (${(aggregate.exactSampleRatio * 100).toFixed(2)}%) | ${aggregate.truthRepCount} | ${aggregate.predictedRepCount} | 仅在有边界的语料上计算 |\n\n` +
    `## 门禁定义\n\n` +
    `通过必须同时满足：627/627 组整组次数完全一致；并且 11/11 条已批准视频的每个 start/peak/end 都匹配且没有假 rep。MM-Fit 只有组级次数，不能把“已知总数”反推成逐 rep 边界。\n\n` +
    `## 当前失败\n\n` +
    `- MM-Fit 未完全对齐：${report.failures.mmfit.length} 组。\n` +
    `- 已批准视频未完全相位对齐：${report.failures.approvedCaptures.length} 条。\n` +
    `- 失败明细保存在同名 JSON 中，包含 clip/capture ID、动作、真值、预测值和实际使用的 profile。\n`;
}

function main(): void {
  const args = parseUnifiedRecognitionCorpusGateArgs(process.argv.slice(2));
  const mmfitPath = path.resolve(args.mmfitPath);
  const approvedPath = path.resolve(args.approvedPath);
  const outputPath = path.resolve(args.outputPath);
  const report = buildUnifiedRecognitionCorpusReport(
    JSON.parse(fs.readFileSync(mmfitPath, "utf8")) as MmFitReport,
    JSON.parse(fs.readFileSync(approvedPath, "utf8")) as ApprovedReport,
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(outputPath.replace(/\.json$/, ".md"), markdown(report));
  process.stdout.write(`${JSON.stringify({ outputPath, passed: report.passed, aggregate: report.aggregate }, null, 2)}\n`);
  if (args.enforce && !report.passed) process.exitCode = 1;
}

if (require.main === module) main();
