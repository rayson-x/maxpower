import fs from "node:fs";
import path from "node:path";

import type { PoseEstimate } from "../../src/pose/PoseEngine";
import { buildSimulatedLatPulldownReference } from "../../src/pose/simulatedLatPulldownReference";
import {
  extractNormalizedLatPulldownRep,
  matchLatPulldownTrajectory,
} from "../../src/pose/referenceTrajectory";
import type { CapturePosition } from "../../src/pose/viewGating";

interface Fixture { poses: PoseEstimate[]; }
interface Labels {
  exerciseId?: string;
  labels?: Array<{ repIndex: number; startMs: number; extremeMs: number; endMs: number }>;
}
interface ManifestEntry { id: string; keypoints: string; labels: string; }
interface Manifest { captures: ManifestEntry[]; }

// Run from the repository root so compilation into a temporary output folder
// never redirects report reads/writes into that build folder.
const projectRoot = process.cwd();
const archiveRoot = path.join(projectRoot, "public", "archives", "confirmed-captures");
const outputPath = path.join(projectRoot, "docs", "reports", "simulated-lat-pulldown-archive-comparison-2026-08-04.md");

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, "utf8")) as T;
}

function main(): void {
  const capturePosition = requiredCapturePosition();
  const identity = {
    exerciseId: "lat_pulldown" as const,
    capturePosition,
    variation: "front_bar_pronated",
    trainingSide: "bilateral" as const,
    equipment: "cable_lat_pulldown/straight_bar",
    coordinateSystem: "source-image/v1" as const,
    featureSchemaId: "lat_pulldown/source-image-piecewise-32/v2" as const,
    poseModelVersion: "mediapipe-pose-heavy",
  };
  const profile = buildSimulatedLatPulldownReference(identity);
  const manifest = readJson<Manifest>(path.join(archiveRoot, "manifest.json"));
  const rows: Array<{
    captureId: string;
    repIndex: number;
    status: string;
    comparable: number;
    outside: number;
    detail: string;
  }> = [];

  for (const entry of manifest.captures) {
    if (!entry.labels) continue;
    const labels = readJson<Labels>(path.join(archiveRoot, entry.labels));
    if (labels.exerciseId !== "lat_pulldown" || !labels.labels?.length) continue;
    const fixture = readJson<Fixture[]>(path.join(archiveRoot, entry.keypoints))[0];
    if (!fixture?.poses) throw new Error(`${entry.id} 缺少 pose fixture。`);
    for (const segment of labels.labels) {
      const extracted = extractNormalizedLatPulldownRep({
        captureId: entry.id,
        capturePosition,
        sourceStatus: "human_edited_draft",
        profileContext: identity,
        segment: { repIndex: segment.repIndex, startMs: segment.startMs, peakMs: segment.extremeMs, endMs: segment.endMs },
        poses: fixture.poses,
      });
      if (extracted.status !== "ready") {
        rows.push({ captureId: entry.id, repIndex: segment.repIndex, status: "refused", comparable: 0, outside: 0, detail: extracted.reason });
        continue;
      }
      const result = matchLatPulldownTrajectory(profile, extracted.rep);
      const compared = result.features.reduce((sum, feature) => sum + feature.comparableNodeCount, 0);
      const outside = result.features.reduce((sum, feature) => sum + feature.outsideNodeCount, 0);
      rows.push({
        captureId: entry.id,
        repIndex: segment.repIndex,
        status: result.status,
        comparable: compared,
        outside,
        detail: result.mismatchReason ?? "模拟参考带偏离证据；不是动作总分。",
      });
    }
  }

  const comparedRows = rows.filter((row) => row.status === "comparison_available");
  const markdown = [
    "# 高位下拉：模拟 profile × 已标注档案轨迹对照",
    "",
    "这份报告将已有人工 rep 边界的真实观测轨迹，与 `simulated_nominal` 高位下拉 profile 比较。它不使用用户动作生成标准，也不输出质量分数。",
    "",
    "## 固定假设",
    "",
    `- 实际机位：\`${capturePosition}\`。旧 labels 标为 \`front\`，与现场确认不一致，因此本次显式覆盖；未确认前不可将结果升级为校准依据。`,
    "- 器械/变式：直杆正握高位下拉；双侧；MediaPipe heavy。",
    "- 参考来源：模拟 phase-direction corridor，宽容差，未校准。",
    "",
    "## 汇总",
    "",
    `- 已读取人工标注 rep：${rows.length}`,
    `- 可比较 rep：${comparedRows.length}`,
    `- 被拒绝 rep：${rows.length - comparedRows.length}`,
    `- 可比较节点：${comparedRows.reduce((sum, row) => sum + row.comparable, 0)}`,
    `- 模拟带外节点：${comparedRows.reduce((sum, row) => sum + row.outside, 0)}`,
    "",
    "## 逐 rep 结果",
    "",
    "| 录像 | rep | 状态 | 可比较节点 | 带外节点 | 说明 |",
    "| --- | ---: | --- | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.captureId} | ${row.repIndex} | ${row.status} | ${row.comparable} | ${row.outside} | ${row.detail} |`),
    "",
    "## 如何用真实录像修正模拟基线",
    "",
    "1. 先在审核页确认每组实际八向机位、直杆变式和 rep 边界。",
    "2. 将可比较 rep 分成‘可作为校准样本’与‘仅挑战样本’；不得因为用户做得不标准就自动将其带外路径吸收为标准。",
    "3. 同一 identity 至少积累 6 个确认 rep 后，生成个人/器械/机位 corridor；保留 simulated baseline 以便追溯校准前后的差异。",
  ].join("\n");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${markdown}\n`);
  process.stdout.write(`${JSON.stringify({ outputPath, repCount: rows.length, comparableRepCount: comparedRows.length })}\n`);
}

function requiredCapturePosition(): "rear" | "rearLeft45" {
  const value = process.argv.find((argument) => argument.startsWith("--capture-position="))?.split("=")[1];
  if (value === "rear" || value === "rearLeft45") return value;
  throw new Error("Usage: --capture-position=rear|rearLeft45. Do not silently replace incorrect legacy metadata.");
}

main();
