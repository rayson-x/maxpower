/**
 * Deterministic form-quality scoring over per-rep kinematics.
 *
 * The extractor owns pose math. This module only consumes named observations,
 * gates unreliable fields, compares reps, and applies frozen deductions.
 */

export type RuleSeverity = "minor" | "moderate" | "major";
export type CameraView = "front" | "side" | "oblique45";
export type PhaseMeaning = "eccentric" | "concentric" | "unknown";
export type MetricUnit = "normalized" | "ratio" | "deg" | "ms";

export const RULE_JOINT = {
  leftShoulder: "leftShoulder",
  rightShoulder: "rightShoulder",
  leftElbow: "leftElbow",
  rightElbow: "rightElbow",
  leftWrist: "leftWrist",
  rightWrist: "rightWrist",
  leftHip: "leftHip",
  rightHip: "rightHip",
  leftKnee: "leftKnee",
  rightKnee: "rightKnee",
  leftAnkle: "leftAnkle",
  rightAnkle: "rightAnkle",
} as const;

export type RuleJointId = (typeof RULE_JOINT)[keyof typeof RULE_JOINT];

/** Stable registry id. The profile registry, not this engine, owns its vocabulary. */
export type RuleExerciseId = string;

export const RULE_METRIC = {
  amplitude: "amplitude",
  bilateralAsymmetryRatio: "bilateralAsymmetryRatio",
  torsoDriftDeg: "torsoDriftDeg",
  toExtremeMs: "toExtremeMs",
  fromExtremeMs: "fromExtremeMs",
} as const;

export type RuleMetricKey = (typeof RULE_METRIC)[keyof typeof RULE_METRIC];

export interface MetricObservation {
  definitionId?: string;
  value: number | null;
  unit: MetricUnit;
  /** Confidence in this derived field, 0..1. */
  confidence: number;
  /** Fraction of frames that supported this field, 0..1. */
  usableFrameRatio: number;
  /** Joints required to derive this field. */
  requiredJoints: readonly RuleJointId[];
  /** Per-joint visibility used by field-level refusal. */
  jointVisibility: Readonly<Partial<Record<RuleJointId, number>>>;
  refusalReason?: string;
}

export interface RuleEngineRepMetrics {
  repIndex: number;
  startMs: number;
  extremeMs: number;
  endMs: number;
  metrics: Partial<Record<RuleMetricKey, MetricObservation>>;
  phaseSemantics?: {
    toExtreme: PhaseMeaning;
    fromExtreme: PhaseMeaning;
  };
}

export type ExerciseSelection =
  | { mode: "user"; exerciseId: RuleExerciseId }
  | { mode: "auto"; exerciseId: RuleExerciseId | null; confidence: number };

export interface RuleEngineContext {
  cameraView: CameraView;
  exercise: ExerciseSelection;
}

export interface AbsoluteThresholdRule {
  id: string;
  metric: RuleMetricKey;
  /** Inclusive comparison against the observed value. */
  operator: "lt" | "lte" | "gt" | "gte";
  threshold: number;
  /** Required unit; a mismatched observation is refused rather than compared. */
  unit: MetricUnit;
  deduction: number;
  severity: RuleSeverity;
  message: string;
  requiresExercise: readonly RuleExerciseId[];
  supportedViews?: readonly CameraView[];
  approval: AbsoluteRuleApproval;
}

export type AbsoluteRuleApproval =
  | {
      /** Candidate rules are observable but never score. */
      status: "candidate";
      validationSampleSize: 0;
    }
  | {
      status: "validated";
      decision: "promote";
      model: "glm-5v-turbo";
      validationSampleSize: number;
      hallucinationRate: number;
      tuningDatasetId: string;
      validationDatasetId: string;
      evaluatedAt: string;
    };

interface LowerRatioTiers {
  moderateRatio: number;
  majorRatio: number;
  moderateDeduction: number;
  majorDeduction: number;
}

export interface FrozenThresholds {
  version: string;
  status: "experimental" | "validated";
  validationSampleSize: number;
  minFieldConfidence: number;
  minUsableFrameRatio: number;
  minJointVisibility: number;
  minAutoExerciseConfidence: number;
  minRelativeBaselineReps: number;
  relativeAmplitude: LowerRatioTiers;
  eccentricDuration: LowerRatioTiers;
}

/**
 * Frozen before the first field-validation session. These are engineering
 * hypotheses, not medical or biomechanical safety limits.
 */
export const EXPERIMENTAL_THRESHOLDS_V1: FrozenThresholds = {
  version: "form-rules-experimental-v1",
  status: "experimental",
  validationSampleSize: 0,
  minFieldConfidence: 0.7,
  minUsableFrameRatio: 0.7,
  minJointVisibility: 0.7,
  minAutoExerciseConfidence: 0.7,
  minRelativeBaselineReps: 3,
  relativeAmplitude: {
    moderateRatio: 0.8,
    majorRatio: 0.65,
    moderateDeduction: 8,
    majorDeduction: 15,
  },
  eccentricDuration: {
    moderateRatio: 0.7,
    majorRatio: 0.55,
    moderateDeduction: 6,
    majorDeduction: 10,
  },
};

/** Absolute hypotheses for field observation. They cannot score until promoted. */
export const CANDIDATE_ABSOLUTE_RULES_V1: readonly AbsoluteThresholdRule[] = [
  {
    id: "bilateral_asymmetry_major_candidate",
    metric: RULE_METRIC.bilateralAsymmetryRatio,
    operator: "gt",
    threshold: 0.25,
    unit: "ratio",
    deduction: 15,
    severity: "major",
    message: "左右动作幅度严重不对称",
    requiresExercise: [],
    supportedViews: ["front", "oblique45"],
    approval: { status: "candidate", validationSampleSize: 0 },
  },
  {
    id: "torso_compensation_major_candidate",
    metric: RULE_METRIC.torsoDriftDeg,
    operator: "gt",
    threshold: 18,
    unit: "deg",
    deduction: 15,
    severity: "major",
    message: "躯干角度变化很大，疑似明显借力",
    requiresExercise: [],
    supportedViews: ["side", "oblique45"],
    approval: { status: "candidate", validationSampleSize: 0 },
  },
];

export interface FormRuleEngineConfig {
  thresholds?: FrozenThresholds;
  absoluteRules?: readonly AbsoluteThresholdRule[];
}

export type RuleEvaluationStatus = "passed" | "deducted" | "refused" | "not_applicable";

export interface RuleDeduction {
  ruleId: string;
  severity: RuleSeverity;
  points: number;
  message: string;
  evidence: string;
}

export interface RuleEvaluation {
  ruleId: string;
  status: RuleEvaluationStatus;
  reason?: string;
  deduction?: RuleDeduction;
}

export interface RepScore {
  repIndex: number;
  status: "scored" | "partial" | "not_scored";
  score: number | null;
  label: string;
  deductions: RuleDeduction[];
  evaluations: RuleEvaluation[];
}

export interface SetScore {
  engineVersion: string;
  thresholdStatus: FrozenThresholds["status"];
  validationSampleSize: number;
  status: "scored" | "partial" | "not_scored";
  score: number | null;
  label: string;
  scoredRepCount: number;
  totalRepCount: number;
  lowestRepIndex: number | null;
  reps: RepScore[];
}

interface RelativeBaselines {
  amplitude: number | null;
  eccentricMs: number | null;
}

interface ObservationResult {
  observation: MetricObservation | null;
  reason?: string;
}

function usableObservation(
  rep: RuleEngineRepMetrics,
  metric: RuleMetricKey,
  thresholds: FrozenThresholds,
): ObservationResult {
  const observation = rep.metrics[metric];
  if (!observation || observation.value === null || !Number.isFinite(observation.value)) {
    return { observation: null, reason: observation?.refusalReason ?? `${metric} 缺失` };
  }
  const confidence = observation.confidence;
  const usableFrameRatio = observation.usableFrameRatio;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { observation: null, reason: `${metric} 置信度不是有效的 0..1 数值` };
  }
  if (!Number.isFinite(usableFrameRatio) || usableFrameRatio < 0 || usableFrameRatio > 1) {
    return { observation: null, reason: `${metric} 有效帧比例不是有效的 0..1 数值` };
  }
  if (confidence < thresholds.minFieldConfidence) {
    return {
      observation: null,
      reason: `${metric} 置信度 ${confidence.toFixed(2)} 低于 ${thresholds.minFieldConfidence.toFixed(2)}`,
    };
  }
  if (usableFrameRatio < thresholds.minUsableFrameRatio) {
    return {
      observation: null,
      reason: `${metric} 有效帧比例 ${usableFrameRatio.toFixed(2)} 低于 ${thresholds.minUsableFrameRatio.toFixed(2)}`,
    };
  }
  for (const joint of observation.requiredJoints) {
    const visibility = observation.jointVisibility[joint];
    if (visibility === undefined || !Number.isFinite(visibility)) {
      return { observation: null, reason: `${metric} 缺少 ${joint} 的可见率` };
    }
    if (visibility < 0 || visibility > 1) {
      return { observation: null, reason: `${metric} 的 ${joint} 可见率不是有效的 0..1 数值` };
    }
    if (visibility < thresholds.minJointVisibility) {
      return {
        observation: null,
        reason: `${metric} 的 ${joint} 可见率 ${visibility.toFixed(2)} 低于 ${thresholds.minJointVisibility.toFixed(2)}`,
      };
    }
  }
  return { observation };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function eccentricMetric(rep: RuleEngineRepMetrics): RuleMetricKey | null {
  if (rep.phaseSemantics?.toExtreme === "eccentric") return RULE_METRIC.toExtremeMs;
  if (rep.phaseSemantics?.fromExtreme === "eccentric") return RULE_METRIC.fromExtremeMs;
  return null;
}

function collectBaselines(
  reps: readonly RuleEngineRepMetrics[],
  thresholds: FrozenThresholds,
): RelativeBaselines {
  const amplitudes = reps.flatMap((rep) => {
    const result = usableObservation(rep, RULE_METRIC.amplitude, thresholds);
    return result.observation ? [result.observation.value!] : [];
  });
  const eccentricDurations = reps.flatMap((rep) => {
    const metric = eccentricMetric(rep);
    if (!metric) return [];
    const result = usableObservation(rep, metric, thresholds);
    return result.observation ? [result.observation.value!] : [];
  });
  const enough = (values: number[]) =>
    values.length >= thresholds.minRelativeBaselineReps ? median(values) : null;
  return {
    amplitude: enough(amplitudes),
    eccentricMs: enough(eccentricDurations),
  };
}

function finding(
  ruleId: string,
  severity: RuleSeverity,
  points: number,
  message: string,
  evidence: string,
): RuleEvaluation {
  return {
    ruleId,
    status: "deducted",
    deduction: { ruleId, severity, points: Math.max(0, points), message, evidence },
  };
}

function refused(ruleId: string, reason: string): RuleEvaluation {
  return { ruleId, status: "refused", reason };
}

function notApplicable(ruleId: string, reason: string): RuleEvaluation {
  return { ruleId, status: "not_applicable", reason };
}

function passed(ruleId: string): RuleEvaluation {
  return { ruleId, status: "passed" };
}

function evaluateLowerRatio(
  ruleId: string,
  value: number,
  baseline: number,
  tiers: LowerRatioTiers,
  messages: { moderate: string; major: string },
  evidence: (ratio: number) => string,
): RuleEvaluation {
  const ratio = value / baseline;
  if (ratio < tiers.majorRatio) {
    return finding(
      ruleId,
      "major",
      tiers.majorDeduction,
      messages.major,
      evidence(ratio),
    );
  }
  if (ratio < tiers.moderateRatio) {
    return finding(
      ruleId,
      "moderate",
      tiers.moderateDeduction,
      messages.moderate,
      evidence(ratio),
    );
  }
  return passed(ruleId);
}

function evaluateRelativeAmplitude(
  rep: RuleEngineRepMetrics,
  baseline: number | null,
  thresholds: FrozenThresholds,
): RuleEvaluation {
  const id = "relative_amplitude_drop";
  if (baseline === null || baseline <= 0) return refused(id, "可靠 rep 不足，无法建立组内幅度基线");
  const result = usableObservation(rep, RULE_METRIC.amplitude, thresholds);
  if (!result.observation) return refused(id, result.reason!);
  const value = result.observation.value!;
  return evaluateLowerRatio(
    id,
    value,
    baseline,
    thresholds.relativeAmplitude,
    {
      major: "动作幅度相对本组明显不足",
      moderate: "动作幅度低于本组稳定水平",
    },
    (ratio) =>
      `幅度 ${value.toFixed(3)}，为本组中位数 ${baseline.toFixed(3)} 的 ${(ratio * 100).toFixed(0)}%`,
  );
}

function evaluateEccentricDuration(
  rep: RuleEngineRepMetrics,
  baseline: number | null,
  thresholds: FrozenThresholds,
): RuleEvaluation {
  const id = "relative_eccentric_acceleration";
  const metric = eccentricMetric(rep);
  if (!metric) return refused(id, "相位语义未知，不能判断哪一段是离心");
  if (baseline === null || baseline <= 0) return refused(id, "可靠 rep 不足，无法建立组内离心时长基线");
  const result = usableObservation(rep, metric, thresholds);
  if (!result.observation) return refused(id, result.reason!);
  const value = result.observation.value!;
  return evaluateLowerRatio(
    id,
    value,
    baseline,
    thresholds.eccentricDuration,
    {
      major: "离心阶段相对本组明显加速",
      moderate: "离心阶段比本组稳定节奏更快",
    },
    (ratio) =>
      `离心 ${value.toFixed(0)}ms，为本组中位数 ${baseline.toFixed(0)}ms 的 ${(ratio * 100).toFixed(0)}%`,
  );
}

function compare(value: number, operator: AbsoluteThresholdRule["operator"], threshold: number): boolean {
  if (operator === "lt") return value < threshold;
  if (operator === "lte") return value <= threshold;
  if (operator === "gt") return value > threshold;
  return value >= threshold;
}

function evaluateAbsoluteRule(
  rep: RuleEngineRepMetrics,
  rule: AbsoluteThresholdRule,
  thresholds: FrozenThresholds,
): RuleEvaluation {
  const result = usableObservation(rep, rule.metric, thresholds);
  if (!result.observation) return refused(rule.id, result.reason!);
  if (result.observation.unit !== rule.unit) {
    return refused(
      rule.id,
      `${rule.metric} 单位 ${result.observation.unit} 与规则要求的 ${rule.unit} 不一致`,
    );
  }
  const value = result.observation.value!;
  if (!compare(value, rule.operator, rule.threshold)) return passed(rule.id);
  return finding(
    rule.id,
    rule.severity,
    rule.deduction,
    rule.message,
    `${rule.metric}=${value}${result.observation.unit}，阈值 ${rule.operator} ${rule.threshold}${rule.unit}`,
  );
}

interface ScoringRule {
  id: string;
  /** Empty means exercise-independent; otherwise this gate is mandatory. */
  requiresExercise: readonly RuleExerciseId[];
  /** Requires a recognized profile even when the rule is not action-specific. */
  requiresProfileSemantics?: boolean;
  supportedViews?: readonly CameraView[];
  approval?: AbsoluteThresholdRule["approval"];
  evaluate: () => RuleEvaluation;
}

function invalidApprovalReason(approval: AbsoluteRuleApproval): string | null {
  if (approval.status === "candidate") return null;
  if (approval.decision !== "promote") return "绝对规则没有明确的晋级决策";
  if (approval.model !== "glm-5v-turbo") return "绝对规则缺少指定模型的验证记录";
  if (!Number.isInteger(approval.validationSampleSize) || approval.validationSampleSize <= 0) {
    return "绝对规则的验证样本量无效";
  }
  if (
    !Number.isFinite(approval.hallucinationRate) ||
    approval.hallucinationRate < 0 ||
    approval.hallucinationRate > 1
  ) {
    return "绝对规则的幻觉率不是有效的 0..1 数值";
  }
  if (
    !approval.tuningDatasetId ||
    !approval.validationDatasetId ||
    approval.tuningDatasetId === approval.validationDatasetId
  ) {
    return "绝对规则没有可审计的独立调参与验证数据集";
  }
  if (!approval.evaluatedAt || Number.isNaN(Date.parse(approval.evaluatedAt))) {
    return "绝对规则缺少有效的验证时间";
  }
  return null;
}

function gateRule(
  rule: ScoringRule,
  context: RuleEngineContext,
  thresholds: FrozenThresholds,
): RuleEvaluation | null {
  if (rule.approval?.status === "candidate") {
    return notApplicable(
      rule.id,
      `候选绝对规则尚未晋级（验证样本量 ${rule.approval.validationSampleSize}）`,
    );
  }
  if (rule.approval) {
    const invalidReason = invalidApprovalReason(rule.approval);
    if (invalidReason) return refused(rule.id, invalidReason);
  }
  if (rule.supportedViews && !rule.supportedViews.includes(context.cameraView)) {
    return refused(rule.id, `${context.cameraView} 机位不支持此规则`);
  }
  if (rule.requiresExercise.length === 0 && !rule.requiresProfileSemantics) return null;
  const selection = context.exercise;
  if (selection.mode === "auto") {
    if (
      !Number.isFinite(selection.confidence) ||
      selection.confidence < 0 ||
      selection.confidence > 1
    ) {
      return refused(rule.id, "自动动作识别置信度不是有效的 0..1 数值，依赖动作的规则未判定");
    }
    if (!selection.exerciseId || selection.confidence < thresholds.minAutoExerciseConfidence) {
      return refused(
        rule.id,
        rule.requiresProfileSemantics
          ? "自动动作识别置信度不足，依赖 profile 语义的规则未判定"
          : "自动动作识别置信度不足，依赖动作的规则未判定",
      );
    }
    if (rule.requiresExercise.length === 0) return null;
    return rule.requiresExercise.includes(selection.exerciseId)
      ? null
      : notApplicable(rule.id, `规则不适用于 ${selection.exerciseId}`);
  }
  if (rule.requiresExercise.length === 0) return null;
  return rule.requiresExercise.includes(selection.exerciseId)
    ? null
    : notApplicable(rule.id, `规则不适用于 ${selection.exerciseId}`);
}

function scoreRep(
  rep: RuleEngineRepMetrics,
  context: RuleEngineContext,
  baselines: RelativeBaselines,
  thresholds: FrozenThresholds,
  absoluteRules: readonly AbsoluteThresholdRule[],
): RepScore {
  const rules: ScoringRule[] = [
    {
      id: "relative_amplitude_drop",
      requiresExercise: [],
      evaluate: () => evaluateRelativeAmplitude(rep, baselines.amplitude, thresholds),
    },
    {
      id: "relative_eccentric_acceleration",
      // The phase belongs to a profile. Auto mode must pass the confidence
      // gate before this rule can consume profile semantics.
      requiresExercise: [],
      requiresProfileSemantics: true,
      evaluate: () => evaluateEccentricDuration(rep, baselines.eccentricMs, thresholds),
    },
    ...absoluteRules.map((rule) => ({
      id: rule.id,
      requiresExercise: rule.requiresExercise,
      supportedViews: rule.supportedViews,
      approval: rule.approval,
      evaluate: () => evaluateAbsoluteRule(rep, rule, thresholds),
    })),
  ];
  const evaluations = rules.map((rule) => gateRule(rule, context, thresholds) ?? rule.evaluate());
  const evaluated = evaluations.filter(
    (evaluation) => evaluation.status === "passed" || evaluation.status === "deducted",
  );
  const refusals = evaluations.filter((evaluation) => evaluation.status === "refused");
  const deductions = evaluations.flatMap((evaluation) =>
    evaluation.deduction ? [evaluation.deduction] : [],
  );
  if (evaluated.length === 0) {
    return {
      repIndex: rep.repIndex,
      status: "not_scored",
      score: null,
      label: "数据不可信，未评分",
      deductions,
      evaluations,
    };
  }
  const score = Math.max(
    0,
    Math.min(100, 100 - deductions.reduce((sum, item) => sum + item.points, 0)),
  );
  if (refusals.length > 0) {
    return {
      repIndex: rep.repIndex,
      status: "partial",
      score: null,
      label: "部分指标未判定",
      deductions,
      evaluations,
    };
  }
  return {
    repIndex: rep.repIndex,
    status: "scored",
    score,
    label: deductions.length === 0 ? "未检出明显问题" : "检出可复核的动作偏差",
    deductions,
    evaluations,
  };
}

export function scoreFormSet(
  reps: readonly RuleEngineRepMetrics[],
  context: RuleEngineContext,
  config: FormRuleEngineConfig = {},
): SetScore {
  const thresholds = config.thresholds ?? EXPERIMENTAL_THRESHOLDS_V1;
  const absoluteRules = config.absoluteRules ?? [];
  const baselines = collectBaselines(reps, thresholds);
  const scoredReps = reps.map((rep) =>
    scoreRep(rep, context, baselines, thresholds, absoluteRules),
  );
  const valid = scoredReps.filter(
    (rep): rep is RepScore & { score: number } => rep.status === "scored" && rep.score !== null,
  );
  const hasPartial = scoredReps.some((rep) => rep.status === "partial");
  const hasUnscoredRep = scoredReps.some((rep) => rep.status === "not_scored");
  if (valid.length === 0) {
    return {
      engineVersion: thresholds.version,
      thresholdStatus: thresholds.status,
      validationSampleSize: thresholds.validationSampleSize,
      status: hasPartial ? "partial" : "not_scored",
      score: null,
      label: hasPartial ? "部分指标未判定，整组不出总分" : "数据不可信，整组未评分",
      scoredRepCount: 0,
      totalRepCount: reps.length,
      lowestRepIndex: null,
      reps: scoredReps,
    };
  }
  const score = Number((valid.reduce((sum, rep) => sum + rep.score, 0) / valid.length).toFixed(1));
  const lowest = valid.reduce((current, rep) => (rep.score < current.score ? rep : current));
  if (hasPartial || hasUnscoredRep) {
    return {
      engineVersion: thresholds.version,
      thresholdStatus: thresholds.status,
      validationSampleSize: thresholds.validationSampleSize,
      status: "partial",
      score: null,
      label: "部分指标未判定，整组不出总分",
      scoredRepCount: valid.length,
      totalRepCount: reps.length,
      lowestRepIndex: lowest.repIndex,
      reps: scoredReps,
    };
  }
  return {
    engineVersion: thresholds.version,
    thresholdStatus: thresholds.status,
    validationSampleSize: thresholds.validationSampleSize,
    status: "scored",
    score,
    label: valid.every((rep) => rep.deductions.length === 0)
      ? "未检出明显问题"
      : "检出可复核的动作偏差",
    scoredRepCount: valid.length,
    totalRepCount: reps.length,
    lowestRepIndex: lowest.repIndex,
    reps: scoredReps,
  };
}
