/**
 * Replays the field-capture fixture packages using the same pure analysis
 * modules the web client uses.  This intentionally consumes recorded canonical
 * poses; it does not run a different server-side model or alter the video.
 *
 * Usage:
 *   npx tsc --target ES2022 --module commonjs --moduleResolution node --esModuleInterop \
 *     --skipLibCheck --outDir .field-report-build --rootDir . tools/field-capture-replay-report.ts
 *   node .field-report-build/tools/field-capture-replay-report.js
 */
import fs from "node:fs";
import path from "node:path";

import type { CameraView } from "../src/pose/formRuleEngine";
import { analyzePoseSet } from "../src/pose/poseSetAnalysis";
import type { PoseEstimate } from "../src/pose/PoseEngine";
import { segmentRepsAuto } from "../src/pose/repSegmenter";
import { selectTrainingWindow } from "../src/pose/trainingWindow";

interface Fixture {
  video: string;
  durationSec: number;
  model: string;
  poses: PoseEstimate[];
}

interface Labels {
  exerciseId?: string;
  cameraView?: CameraView;
  labels?: unknown[];
}

interface Manifest {
  version: string;
  captures: Array<{ id: string; video: string; keypoints: string; labels: string }>;
}

interface CandidateResult {
  count: number | null;
  status: string;
  score: number | null;
  label: string | null;
  reason: string | null;
}

interface ReplayRow {
  id: string;
  durationSec: number;
  model: string;
  exerciseId: string | null;
  cameraView: CameraView;
  historicalRecordedCount: number | null;
  quality: {
    frameCount: number;
    posePercent: number;
    torsoPercent: number;
    stableFrameCount: number;
    excludedFrameCount: number;
    stableDurationSec: number;
  };
  currentRuleAllFrames: CandidateResult;
  currentRuleStableWindow: CandidateResult;
  automaticCycleCrossCheck: {
    count: number;
    signal: string | null;
    periodStrength: number | null;
    periodSec: number | null;
  };
  reviewPriority: "high" | "normal" | "low";
  reviewReason: string;
}

const projectRoot = path.resolve(__dirname, "../..");
const capturesRoot = path.join(projectRoot, "public", "field-captures");
const reportsRoot = path.join(projectRoot, "docs", "reports");

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

function percent(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 100);
}

function ruleCandidate(
  poses: PoseEstimate[],
  exerciseId: string | undefined,
  cameraView: CameraView,
): CandidateResult {
  if (!exerciseId) {
    return { count: null, status: "waiting_for_exercise", score: null, label: null, reason: "未指定动作，不能安全套用专项规则。" };
  }
  const result = analyzePoseSet({
    poses,
    cameraView,
    exercise: { mode: "user", exerciseId },
  });
  return {
    count: result.segments.length,
    status: result.status,
    score: result.score?.score ?? null,
    label: result.score?.label ?? null,
    reason: result.reason ?? null,
  };
}

function qualityOf(poses: PoseEstimate[]) {
  const present = poses.filter((pose) => pose.landmarks.length > 0).length;
  const torso = poses.filter((pose) =>
    [11, 12, 23, 24].every((index) => (pose.landmarks[index]?.visibility ?? 0) >= 0.5),
  ).length;
  return { posePercent: percent(present, poses.length), torsoPercent: percent(torso, poses.length) };
}

function priorityFor(row: Omit<ReplayRow, "reviewPriority" | "reviewReason">): Pick<ReplayRow, "reviewPriority" | "reviewReason"> {
  if (!row.exerciseId) return { reviewPriority: "high", reviewReason: "缺少动作标签；专项算法尚未运行。" };
  if (row.quality.posePercent < 90 || row.quality.torsoPercent < 85) {
    return { reviewPriority: "high", reviewReason: "骨架或躯干覆盖不足，不能把候选计数当作真值。" };
  }
  if (
    row.currentRuleStableWindow.count !== row.historicalRecordedCount ||
    row.currentRuleStableWindow.count !== row.automaticCycleCrossCheck.count
  ) {
    return { reviewPriority: "high", reviewReason: "当前专项规则、历史录制结果或动作无关周期交叉核验不一致。" };
  }
  if (row.quality.excludedFrameCount > 0) {
    return { reviewPriority: "normal", reviewReason: "稳定窗口已移除进出机位帧；请快速复核首尾分段。" };
  }
  return { reviewPriority: "low", reviewReason: "三种候选一致且关键点覆盖充足，仍需人工确认实际次数。" };
}

function displayCount(value: number | null): string {
  return value === null ? "—" : String(value);
}

function rowMarkdown(row: ReplayRow): string {
  const id = row.id.replace("field-capture-2026-08-02T", "").replace("Z", "");
  return `| ${id} | ${row.exerciseId ?? "未标"} | ${row.quality.posePercent}% / ${row.quality.torsoPercent}% | ${displayCount(row.historicalRecordedCount)} | ${displayCount(row.currentRuleAllFrames.count)} | ${displayCount(row.currentRuleStableWindow.count)} | ${row.automaticCycleCrossCheck.count} | ${row.reviewPriority === "high" ? "高" : row.reviewPriority === "normal" ? "中" : "低"} |`;
}

function reportMarkdown(rows: ReplayRow[], generatedAt: string): string {
  const labeled = rows.filter((row) => row.exerciseId);
  const high = rows.filter((row) => row.reviewPriority === "high");
  const stableChanged = rows.filter((row) => row.quality.excludedFrameCount > 0);
  const allAgree = rows.filter((row) =>
    row.exerciseId &&
    row.historicalRecordedCount === row.currentRuleStableWindow.count &&
    row.currentRuleStableWindow.count === row.automaticCycleCrossCheck.count,
  );
  return `# 训练录像算法重放报告\n\n生成时间：${generatedAt}\n\n## Executive Summary\n\n已对项目采集库中的 **${rows.length} 组**录像的已保存 canonical pose 序列重放当前 Web 客户端算法：\n\n- 最新专项规则（全帧）与同一规则的稳定训练窗口版本；\n- 动作无关的自动周期分割，仅作交叉核验；\n- 覆盖率与进出机位帧的质量检查。\n\n结论：目前数据足以进入人工审批，但**尚不足以声称计数准确率**。${high.length} 组需要优先看视频确认；${stableChanged.length} 组被稳定窗口移除了进出机位帧；仅 ${allAgree.length} 组在历史录制、当前专项规则和自动周期三者上完全一致。最重要的已知风险是：历史 pull_up 标签中至少有一段实际画面像划船，动作标签错误时专项规则必然产生错误计数。\n\n## Key findings\n\n| 采集时间 | 动作标签 | 骨架 / 躯干 | 历史 | 当前全帧 | 当前稳定段 | 自动周期 | 审核优先级 |\n| --- | --- | --- | ---: | ---: | ---: | ---: | --- |\n${rows.map(rowMarkdown).join("\n")}\n\n“历史”是录制时导出的 labels 分段数，并非人工确认的实际次数；“当前稳定段”是本报告建议你在审批台中优先查看的候选。\n\n## Recommendations\n\n1. 在 Web 审批台按“高”优先级逐组播放，并填写你实际做的次数；确认正确候选后点击“批准为本组真值”。\n2. 先纠正明显的动作标签错误，再比较专项规则；不要把不同动作的候选计数混为算法失败。\n3. 对骨架/躯干覆盖低的组，不自动修补长时间丢失的手臂；保留“不可判定”并用视频审核，避免生成虚假关节轨迹。\n4. 收集一批审批真值后，再以“候选计数与真值的绝对误差、漏计率、误计率”作为调参指标；当前报告不会把历史 labels 当真值。\n\n## Questions for approval\n\n- 对每组：实际次数是多少？其中哪一个候选（历史、当前全帧、当前稳定段、自动周期）最接近？\n- 是否确认该组动作和机位标签？若不同，请在面板中改正后再批准。\n- 对高优先级组：丢点发生在什么相位（开始、底部、顶点或结束）？\n\n## Caveats\n\n本次是对已保存的 pose 数据重放；它验证的是**当前分段/稳定窗口/评分链路**，不能重新推断当时已经丢失的关键点，也不能衡量新的逐解码帧推理修复在旧视频上的提升。之后新录制的组才会包含该修复后的 canonical 序列。所有数据和审批结果均保留在本机。\n`;
}

function main() {
  const manifest = readJson<Manifest>(path.join(capturesRoot, "manifest.json"));
  const rows = manifest.captures.map((entry): ReplayRow => {
    const fixture = readJson<Fixture[]>(path.join(capturesRoot, entry.keypoints))[0];
    if (!fixture) throw new Error(`Missing fixture content: ${entry.keypoints}`);
    const labels = entry.labels ? readJson<Labels>(path.join(capturesRoot, entry.labels)) : {};
    const cameraView = labels.cameraView ?? "oblique45";
    const stable = selectTrainingWindow(fixture.poses);
    const quality = qualityOf(fixture.poses);
    const automatic = segmentRepsAuto(stable.poses);
    const base = {
      id: entry.id,
      durationSec: fixture.durationSec,
      model: fixture.model,
      exerciseId: labels.exerciseId ?? null,
      cameraView,
      historicalRecordedCount: labels.labels?.length ?? null,
      quality: {
        frameCount: fixture.poses.length,
        posePercent: quality.posePercent,
        torsoPercent: quality.torsoPercent,
        stableFrameCount: stable.poses.length,
        excludedFrameCount: stable.excludedPoseCount,
        stableDurationSec: stable.poses.length > 1
          ? Number(((stable.poses.at(-1)!.timestampMs - stable.poses[0].timestampMs) / 1000).toFixed(3))
          : 0,
      },
      currentRuleAllFrames: ruleCandidate(fixture.poses, labels.exerciseId, cameraView),
      currentRuleStableWindow: ruleCandidate(stable.poses, labels.exerciseId, cameraView),
      automaticCycleCrossCheck: {
        count: automatic.cycles.length,
        signal: automatic.signal,
        periodStrength: automatic.periodStrength,
        periodSec: automatic.periodSec,
      },
    };
    return { ...base, ...priorityFor(base) };
  });
  const generatedAt = new Date().toISOString();
  const output = {
    version: "field-capture-algorithm-replay/v1",
    generatedAt,
    source: { manifest: "public/field-captures/manifest.json", algorithm: "pose-set-analysis/v1 + training-window/v1 + segment-reps-auto/v1" },
    rows,
  };
  fs.mkdirSync(reportsRoot, { recursive: true });
  fs.writeFileSync(path.join(reportsRoot, "field-capture-replay-2026-08-03.json"), `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(path.join(reportsRoot, "field-capture-replay-2026-08-03.md"), reportMarkdown(rows, generatedAt));
  console.log(JSON.stringify({ captureCount: rows.length, highPriority: rows.filter((row) => row.reviewPriority === "high").length, outputDirectory: reportsRoot }, null, 2));
}

main();
