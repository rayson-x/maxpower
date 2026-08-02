import assert from "node:assert/strict";
import test from "node:test";

import {
  RULE_JOINT,
  RULE_METRIC,
  scoreFormSet,
  type CameraView,
  type ExerciseSelection,
  type RuleEngineRepMetrics,
} from "../../src/pose/formRuleEngine";
import type { PoseEstimate } from "../../src/pose/PoseEngine";
import { extractRepMetrics } from "../../src/pose/repMetricsExtractor";
import { loadPoseFixture } from "../harness/fixtureRepository";

/**
 * 主体断言用离线回放工具真实录制的关键点(带真实的跟丢、遮挡、抖动)。
 * 只在数据质量拒答那一条用了手写的合成数据——因为要对可见度做精确控制来验证
 * 拒答机制本身,真实素材里凑不出"恰好只有这一个关节被遮挡"的场景。
 */
function loadFixture(name: string): PoseEstimate[] {
  return loadPoseFixture(name).poses.filter((pose) => pose.landmarks.length > 0);
}

const PULL_UP_VIDEO = "ecc14b0bdcd3e1116465edfe08f33368.mp4";

const CAMERA_VIEW: CameraView = "oblique45";

const RULE_JOINT_IDS = new Set<string>(Object.values(RULE_JOINT));

function assertValidObservation(rep: RuleEngineRepMetrics, metric: keyof typeof RULE_METRIC, expectedUnit: string) {
  const observation = rep.metrics[RULE_METRIC[metric]];
  assert.ok(observation, `rep ${rep.repIndex} 缺少 ${metric} 观测值`);
  assert.equal(observation!.unit, expectedUnit, `${metric} 的单位应为 ${expectedUnit}`);
  assert.ok(observation!.requiredJoints.length > 0, `${metric} 应声明依赖的关节`);
  for (const joint of observation!.requiredJoints) {
    assert.ok(RULE_JOINT_IDS.has(joint), `${metric} 引用了不存在的关节 id: ${joint}`);
    assert.ok(
      observation!.jointVisibility[joint] !== undefined,
      `${metric} 的 requiredJoints 里有 ${joint},但 jointVisibility 没有它的可见率`,
    );
  }
  assert.ok(
    observation!.confidence >= 0 && observation!.confidence <= 1,
    `${metric} 的 confidence 必须落在 0..1`,
  );
  assert.ok(
    observation!.usableFrameRatio >= 0 && observation!.usableFrameRatio <= 1,
    `${metric} 的 usableFrameRatio 必须落在 0..1`,
  );
}

test("known exercise: produces monotonic reps with all five metrics correctly unit-tagged", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const exercise: ExerciseSelection = { mode: "user", exerciseId: "pull_up" };
  const result = extractRepMetrics(poses, { cameraView: CAMERA_VIEW, exercise });

  assert.equal(result.signal, "wrist_height");
  assert.ok(result.reps.length >= 2, "真实录制样本应能切出至少 2 个 rep");

  let previousStart = -Infinity;
  result.reps.forEach((rep, i) => {
    assert.equal(rep.repIndex, i + 1, "repIndex 应从 1 开始连续编号");
    assert.ok(rep.startMs < rep.extremeMs, "起点应早于极点");
    assert.ok(rep.extremeMs < rep.endMs, "极点应早于终点");
    assert.ok(rep.startMs > previousStart, "各 rep 的起点应严格递增");
    previousStart = rep.startMs;

    assertValidObservation(rep, "amplitude", "normalized");
    assertValidObservation(rep, "toExtremeMs", "ms");
    assertValidObservation(rep, "fromExtremeMs", "ms");
    assertValidObservation(rep, "torsoDriftDeg", "deg");
    assertValidObservation(rep, "bilateralAsymmetryRatio", "ratio");

    assert.deepEqual(
      rep.phaseSemantics,
      { toExtreme: "concentric", fromExtreme: "eccentric" },
      "已知动作时两段相位应互补且方向确定",
    );
  });
});

test("known exercise: toExtremeMs + fromExtremeMs sum to the rep duration", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const result = extractRepMetrics(poses, {
    cameraView: CAMERA_VIEW,
    exercise: { mode: "user", exerciseId: "pull_up" },
  });
  for (const rep of result.reps) {
    const toExtreme = rep.metrics[RULE_METRIC.toExtremeMs]!.value!;
    const fromExtreme = rep.metrics[RULE_METRIC.fromExtremeMs]!.value!;
    assert.equal(toExtreme + fromExtreme, rep.endMs - rep.startMs);
  }
});

test("known exercise: feeds scoreFormSet without error and scores at least one rep", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const result = extractRepMetrics(poses, {
    cameraView: CAMERA_VIEW,
    exercise: { mode: "user", exerciseId: "pull_up" },
  });
  const score = scoreFormSet(result.reps, result.context);
  assert.equal(score.totalRepCount, result.reps.length);
  assert.ok(
    score.status === "scored" || score.status === "partial",
    `真实样本不应整体 not_scored,实际状态: ${score.status}`,
  );
});

test("auto mode below confidence threshold: phase semantics are unknown and the engine refuses the eccentric rule", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const exercise: ExerciseSelection = {
    mode: "auto",
    exerciseId: "pull_up",
    confidence: 0.3,
  };
  const result = extractRepMetrics(poses, { cameraView: CAMERA_VIEW, exercise });
  assert.ok(result.reps.length > 0, "低置信度也应该走自动分期,不是直接放弃");

  for (const rep of result.reps) {
    assert.deepEqual(rep.phaseSemantics, { toExtreme: "unknown", fromExtreme: "unknown" });
  }

  const score = scoreFormSet(result.reps, result.context);
  const firstRep = score.reps[0];
  const eccentricEvaluation = firstRep.evaluations.find(
    (e) => e.ruleId === "relative_eccentric_acceleration",
  );
  // 引擎自己的置信度门(gateRule)在评估函数内部的"相位语义未知"判断之前就先拦下了——
  // 这是双重保险:context.exercise 的置信度本身不达标时,引擎独立地就会拒答这条规则,
  // 不需要依赖提取器把 phaseSemantics 标对。这里断言的是实际会走到的那句话,
  // 而不是"相位语义未知"(那句话只在 mode:"user" 但 phaseSemantics 仍未知的场景下才会出现,
  // 而本提取器的设计里 mode:"user" 恒定产出已知方向,不会触发那一支)。
  assert.equal(eccentricEvaluation?.status, "refused");
  assert.match(eccentricEvaluation?.reason ?? "", /自动动作识别置信度不足/);
});

test("auto mode at/above confidence threshold behaves like a known exercise", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const exercise: ExerciseSelection = {
    mode: "auto",
    exerciseId: "pull_up",
    confidence: 0.75,
  };
  const result = extractRepMetrics(poses, { cameraView: CAMERA_VIEW, exercise });
  assert.ok(result.reps.length > 0);
  for (const rep of result.reps) {
    assert.deepEqual(rep.phaseSemantics, { toExtreme: "concentric", fromExtreme: "eccentric" });
  }
});

test("auto mode with no recognized exercise falls back to direction-agnostic segmentation", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const exercise: ExerciseSelection = { mode: "auto", exerciseId: null, confidence: 0 };
  const result = extractRepMetrics(poses, { cameraView: CAMERA_VIEW, exercise });
  assert.ok(result.reps.length > 0, "即使没识别出动作,方向无关的自动分期也应该产出 rep");
  for (const rep of result.reps) {
    assert.deepEqual(rep.phaseSemantics, { toExtreme: "unknown", fromExtreme: "unknown" });
  }
});

test("auto recognition uses the rule engine's frozen confidence boundary", () => {
  const poses = loadFixture(PULL_UP_VIDEO);
  const justBelow = extractRepMetrics(poses, {
    cameraView: CAMERA_VIEW,
    exercise: { mode: "auto", exerciseId: "pull_up", confidence: 0.699 },
  });
  assert.deepEqual(justBelow.reps[0]?.phaseSemantics, {
    toExtreme: "unknown",
    fromExtreme: "unknown",
  });

  const atBoundary = extractRepMetrics(poses, {
    cameraView: CAMERA_VIEW,
    exercise: { mode: "auto", exerciseId: "pull_up", confidence: 0.7 },
  });
  assert.deepEqual(atBoundary.reps[0]?.phaseSemantics, {
    toExtreme: "concentric",
    fromExtreme: "eccentric",
  });
});

test("empty pose sequence produces no reps without throwing", () => {
  const result = extractRepMetrics([], {
    cameraView: CAMERA_VIEW,
    exercise: { mode: "user", exerciseId: "pull_up" },
  });
  assert.deepEqual(result, { context: result.context, reps: [], signal: null });
});

// ---------- 合成数据:只用于精确控制可见度来验证拒答机制本身 ----------

function syntheticPose(timestampMs: number, overrides: Partial<Record<number, number>> = {}): PoseEstimate {
  const landmarks = Array.from({ length: 33 }, (_, i) => ({
    x: 0.5 + 0.01 * Math.sin(i + timestampMs / 500),
    y: 0.5 + 0.01 * Math.cos(i + timestampMs / 500),
    z: 0,
    visibility: overrides[i] ?? 0.95,
  }));
  return { timestampMs, landmarks, worldLandmarks: [] };
}

/** 构造一段能被 segmentReps 切出至少一个 rep 的肘角周期信号(barbell_row 用 elbow_angle)。 */
function syntheticElbowCycle(count: number, periodMs: number, visibilityOverride?: (t: number) => Partial<Record<number, number>>): PoseEstimate[] {
  const SHOULDER_L = 11;
  const ELBOW_L = 13;
  const WRIST_L = 15;
  const poses: PoseEstimate[] = [];
  for (let i = 0; i < count; i += 1) {
    const t = i * 50;
    const phase = (t % periodMs) / periodMs;
    const angleDeg = 90 + 60 * Math.sin(phase * 2 * Math.PI); // 30..150度往返
    const rad = (angleDeg * Math.PI) / 180;
    const base = syntheticPose(t, visibilityOverride?.(t));
    // 摆一个肩(0,0)-肘(0,-1)-腕的三角形,腕的位置由角度决定,保证 angleDeg(shoulder,elbow,wrist) ≈ angleDeg
    base.landmarks[SHOULDER_L] = { x: 0, y: 0, z: 0, visibility: base.landmarks[SHOULDER_L].visibility };
    base.landmarks[ELBOW_L] = { x: 0, y: -1, z: 0, visibility: base.landmarks[ELBOW_L].visibility };
    base.landmarks[WRIST_L] = {
      x: Math.sin(rad),
      y: -1 + Math.cos(rad),
      z: 0,
      visibility: base.landmarks[WRIST_L].visibility,
    };
    poses.push(base);
  }
  return poses;
}

test("low visibility on a required joint drives usableFrameRatio down and the engine refuses that field", () => {
  const WRIST_L = 15;
  const WRIST_R = 16;
  const goodPoses = syntheticElbowCycle(400, 2000);
  // 两侧手腕都要一起退化——只退化一侧的话,resolveBestSideQuality 会诚实地
  // 切去可信度更高的另一侧(这是设计,见函数上的注释),观测到的可信度不会下降。
  // 完全遮住(可见度恒 < 0.5)也不行:extractSignal 本身要求手腕可见度 >= 0.5
  // 才会把这一帧计入信号,恒低可见度会导致一个样本都提取不到、直接切不出 rep。
  // 所以让可见度在阈值上下交替,既能让分期照常工作,又能让"可用帧比例"真实下降。
  const badPoses = syntheticElbowCycle(400, 2000, (t) => {
    const frameIndex = Math.round(t / 50);
    const alternating = frameIndex % 2 === 0 ? 0.3 : 0.9;
    return { [WRIST_L]: alternating, [WRIST_R]: alternating };
  });

  const exercise: ExerciseSelection = { mode: "user", exerciseId: "barbell_row" };
  const good = extractRepMetrics(goodPoses, { cameraView: CAMERA_VIEW, exercise });
  const bad = extractRepMetrics(badPoses, { cameraView: CAMERA_VIEW, exercise });

  assert.ok(good.reps.length > 0, "构造的合成信号应能被切出 rep(前置条件)");
  assert.ok(bad.reps.length > 0, "低可见度不应影响分期本身,只应影响观测值的可信度");

  const goodAmplitude = good.reps[0].metrics[RULE_METRIC.amplitude]!;
  const badAmplitude = bad.reps[0].metrics[RULE_METRIC.amplitude]!;
  assert.ok(
    badAmplitude.usableFrameRatio < goodAmplitude.usableFrameRatio,
    "手腕持续不可见时,依赖手腕的观测值可用帧比例应明显下降",
  );

  const score = scoreFormSet(bad.reps, bad.context);
  const amplitudeEvaluation = score.reps[0].evaluations.find(
    (e) => e.ruleId === "relative_amplitude_drop",
  );
  assert.equal(amplitudeEvaluation?.status, "refused", "引擎应因数据不可信而拒答,不是硬打分");
});
