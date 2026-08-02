import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { computeExerciseFeatures } from "../../src/pose/exerciseFeatures";
import { RULE_METRIC, type CameraView } from "../../src/pose/formRuleEngine";
import { classifyLocally } from "../../src/pose/localClassifier";
import { analyzePoseSet } from "../../src/pose/poseSetAnalysis";
import { diagnoseSignals, segmentRepsAuto } from "../../src/pose/repSegmenter";
import { computeTrajectoryFeatures } from "../../src/pose/trajectory";
import { loadPoseFixtures } from "./fixtureRepository";

/**
 * 离线回放 harness · 分析端
 *
 * 输入是 public/harness/capture.html 采集的关键点 fixtures(逐帧 seek,确定性抽样),
 * 输出是每个视频的信号诊断表 + 轨迹特征 + 本地识别结果,以及可直接画图的 CSV。
 *
 * 存在的意义:改一次阈值 → 跑一次 `npm run harness` → 秒级看到全部视频的结果,
 * 不用开浏览器、不用等采集、不用等 LLM。选型和调参的唯一裁判。
 */

// 编译产物在 .harness-build/ 下,__dirname 指不回源码目录;
// npm run 一定从项目根执行,所以以 cwd 为准。
const ROOT = process.cwd();
const FIXTURES = resolve(ROOT, "tools/harness/fixtures/fixtures.json");
const OUT_DIR = resolve(ROOT, "tools/harness/out");

function pad(s: string, n: number): string {
  const w = [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return s + " ".repeat(Math.max(0, n - w));
}

function table(rows: string[][]): string {
  const widths = rows[0].map((_, i) =>
    Math.max(...rows.map((r) => [...(r[i] ?? "")].reduce((a, c) => a + (c.charCodeAt(0) > 0x2e80 ? 2 : 1), 0))),
  );
  return rows
    .map((r) => r.map((c, i) => pad(c ?? "", widths[i])).join("  "))
    .join("\n");
}

function main(): void {
  if (!existsSync(FIXTURES)) {
    console.error(`找不到 ${FIXTURES}`);
    console.error("先用采集端生成:启动 dev server 后打开 /harness/capture.html,");
    console.error("点「开始采集」,把下载到的 fixtures.json 放到 tools/harness/fixtures/ 下。");
    process.exit(1);
  }

  const fixtures = loadPoseFixtures(FIXTURES);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const fx of fixtures) {
    const poses = fx.poses.filter((p) => p.landmarks.length > 0);
    console.log(`\n${"=".repeat(78)}`);
    console.log(`${fx.video}  ${fx.durationSec}s  step=${fx.stepMs}ms`);
    console.log(
      `采样 ${fx.poses.length} 帧,检出人体 ${poses.length} 帧 (${Math.round((poses.length / fx.poses.length) * 100)}%)`,
    );
    console.log("=".repeat(78));

    if (poses.length < 12) {
      console.log("检出帧太少,跳过");
      continue;
    }

    // ---- 信号诊断:每个候选都真跑一遍分期 ----
    const diags = diagnoseSignals(poses);
    console.log("\n【信号诊断】按分数排序;cycles 才是能不能分期的事实,score 只是先验");
    console.log(
      table([
        ["signal", "幅度", "周期s", "周期性", "score", "极值数", "cycles", "淘汰原因"],
        ...[...diags]
          .sort((a, b) => b.score - a.score)
          .map((d) => [
            d.signal,
            d.normRange.toFixed(3),
            d.periodSec === null ? "-" : d.periodSec.toFixed(2),
            d.strength.toFixed(3),
            d.score.toFixed(3),
            String(d.extremaCount),
            String(d.cycles.length),
            d.rejected ?? "",
          ]),
      ]),
    );

    // ---- 最终选择 ----
    const auto = segmentRepsAuto(poses);
    console.log(
      `\n【选中】${auto.signal ?? "无"}  周期 ${auto.periodSec ?? "-"}s  强度 ${auto.periodStrength ?? "-"}  循环数 ${auto.cycles.length}`,
    );
    if (auto.cycles.length > 0) {
      console.log(
        table([
          ["#", "start", "extreme", "end", "时长ms", "幅度"],
          ...auto.cycles.map((c) => [
            String(c.index),
            String(Math.round(c.startMs)),
            String(Math.round(c.extremeMs)),
            String(Math.round(c.endMs)),
            String(Math.round(c.durationMs)),
            c.amplitude.toFixed(3),
          ]),
        ]),
      );
    }

    // ---- 轨迹特征 + 本地识别 ----
    const traj = computeTrajectoryFeatures(poses, auto.cycles);
    const features = computeExerciseFeatures(poses);
    const local = classifyLocally({
      trajectory: traj,
      segmentation: auto,
      posture: features.posture,
    });

    console.log(
      `\n【轨迹】主导关节=${traj.dominantJoint}  手腕侧=${traj.wristSide}  ` +
        `主轴=${traj.wristPath?.principalAxisDeg}°  直线度=${traj.wristPath?.straightness}  ` +
        `身体位移占比=${traj.bodyTravelRatio}  躯干角=${traj.torsoAngle?.meanDeg}°`,
    );
    console.log(
      "关节 ROM: " +
        traj.jointRom
          .map((r) => `${r.joint}=${r.rangeDeg}°(原始 ${r.rawMinDeg}~${r.rawMaxDeg})`)
          .join("  "),
    );
    if (traj.consistency) {
      console.log(
        `逐 rep 一致性: reps=${traj.consistency.reps} 幅度CV=${traj.consistency.amplitudeCv} 路径偏差=${traj.consistency.pathDeviation}`,
      );
    }

    console.log(`\n【本地识别】${local.id} (${local.confidence}, 领先度 ${local.margin})`);
    for (const r of local.reasons) console.log("  ✓ " + r);
    for (const i of local.dataIssues) console.log("  ⚠ " + i);

    // ---- 逐 rep 指标提取 + 规则引擎打分 ----
    // fixture 目前不携带机位信息,这里用 oblique45 占位仅供本工具展示,不是契约的一部分。
    const cameraView: CameraView = "oblique45";
    // classifyLocally 的置信度是三档字符串,规则引擎要的是 0..1 数值门槛比较——
    // 这里的映射只是给 harness 一个可展示的近似值,不是任何地方的正式契约。
    const confidenceValue = { high: 0.9, medium: 0.6, low: 0.3 }[local.confidence];
    const analysis = analyzePoseSet({
      poses,
      cameraView,
      exercise: {
        mode: "auto",
        exerciseId: local.id === "unknown" ? null : local.id,
        confidence: confidenceValue,
      },
    });
    const extraction = analysis.extraction;
    const setScore = analysis.score;
    if (!extraction || !setScore) {
      console.log(`\n【逐 rep 评分】未运行：${analysis.reason ?? "当前动作不受支持"}`);
      continue;
    }

    console.log(
      `\n【逐 rep 评分】信号=${extraction.signal ?? "无"}  相位=${extraction.reps[0]?.phaseSemantics?.toExtreme ?? "-"}/${extraction.reps[0]?.phaseSemantics?.fromExtreme ?? "-"}  ` +
        `总分=${setScore.score ?? "-"}(${setScore.status})  profile=${analysis.versions.profile ?? "auto"}  ` +
        `阈值版本=${setScore.engineVersion}(${setScore.thresholdStatus},验证样本=${setScore.validationSampleSize})  ` +
        `覆盖=${analysis.coverage.eligibleEvaluations}/${analysis.coverage.totalEvaluations}`,
    );
    if (extraction.reps.length > 0) {
      console.log(
        table([
          ["#", "幅度", "不对称", "躯干漂移°", "→极点ms", "极点→ms", "分数", "状态", "扣分项"],
          ...setScore.reps.map((repScore) => {
            const rep = extraction.reps.find((r) => r.repIndex === repScore.repIndex)!;
            const val = (key: keyof typeof RULE_METRIC) => {
              const v = rep.metrics[RULE_METRIC[key]]?.value;
              return v === null || v === undefined ? "-" : v.toFixed(key === "amplitude" || key === "bilateralAsymmetryRatio" ? 3 : 0);
            };
            return [
              String(repScore.repIndex),
              val("amplitude"),
              val("bilateralAsymmetryRatio"),
              val("torsoDriftDeg"),
              val("toExtremeMs"),
              val("fromExtremeMs"),
              repScore.score === null ? "-" : String(repScore.score),
              repScore.status,
              repScore.deductions.map((d) => d.ruleId).join(",") || "-",
            ];
          }),
        ]),
      );
    }

    // ---- 导出信号 CSV,直接拖进 Numbers/Excel 就能画 ----
    const csvName = join(OUT_DIR, `${fx.video.replace(/\.\w+$/, "")}-signals.csv`);
    const times = diags.find((d) => d.samples.length > 0)?.samples.map((s) => s.t) ?? [];
    const header = ["t_ms", ...diags.map((d) => d.signal)].join(",");
    const lines = times.map((t, i) =>
      [t, ...diags.map((d) => (d.samples[i] ? d.samples[i].v.toFixed(4) : ""))].join(","),
    );
    writeFileSync(csvName, [header, ...lines].join("\n"));
    console.log(`\n信号序列已写出: ${csvName}`);
  }
}

main();
