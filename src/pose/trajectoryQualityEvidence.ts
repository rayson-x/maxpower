import { LAT_PULLDOWN_QUALITY_FEATURE_GROUPS } from "./referenceTrajectory";

/**
 * Presentation-safe quality evidence derived from the immutable Rust
 * reference comparison. It deliberately turns corridor observations into
 * descriptive coaching evidence, never a form score or a medical claim.
 */

export type QualityEvidenceStatus =
  | "within_reference_band"
  | "deviation_observed"
  | "insufficient_observation"
  | "measured_not_judged"
  | "not_supported";

export interface ReferenceFeatureEvidenceInput {
  readonly feature: string;
  readonly comparableNodeCount: number;
  readonly unknownNodeCount: number;
  readonly outsideNodeCount: number;
  readonly outsideNodeRatio: number | null;
  readonly maximumConsecutiveOutsideNodes: number;
  readonly totalNormalizedExcess: number;
}

export interface ReferenceComparisonEvidenceInput {
  readonly status:
    | "comparison_available"
    | "insufficient_observation"
    | "profile_mismatch"
    | "invalid_profile";
  readonly reason: string | null;
  readonly features: readonly ReferenceFeatureEvidenceInput[];
}

export interface RepPhaseTimingInput {
  readonly toExtremeMs: number;
  readonly fromExtremeMs: number;
}

export interface QualityEvidenceCard {
  readonly id:
    | "trajectory_path"
    | "range_of_motion"
    | "shoulder_line"
    | "torso_stability"
    | "concentric_timing"
    | "eccentric_control";
  readonly status: QualityEvidenceStatus;
  readonly title: string;
  readonly detail: string;
  readonly evidence: string;
}

/**
 * This initial card set is intentionally conservative. The current Rust ABI
 * exposes aggregate corridor evidence but not endpoint direction or a timing
 * corridor, so range/tempo cards state exactly what remains unassessed.
 */
export function buildLatPulldownQualityEvidence(
  comparison: ReferenceComparisonEvidenceInput | null,
  timing: RepPhaseTimingInput | null,
): readonly QualityEvidenceCard[] {
  const commonUnavailable = comparison === null || comparison.status !== "comparison_available";
  const reason = comparison?.reason ?? "尚无可比较的严格同机位参考轨迹。";
  const cards: QualityEvidenceCard[] = commonUnavailable
    ? [
        unavailable("trajectory_path", "轨迹路径", reason),
        unavailable("range_of_motion", "动作行程", reason),
        unavailable("shoulder_line", "左右肩线", "当前参考 schema 尚未包含肩线特征。"),
        unavailable("torso_stability", "躯干稳定", reason),
      ]
    : [
        corridorCard(
          "trajectory_path",
          "轨迹路径",
          selected(comparison.features, LAT_PULLDOWN_QUALITY_FEATURE_GROUPS.trajectoryPath),
          "手腕高度与肘角相位轨迹",
        ),
        unsupported(
          "range_of_motion",
          "动作行程",
          "当前 Rust 证据只提供整段偏离汇总，未暴露顶部/底部端点方向；不能可靠区分“不到位”和“超出参考”。",
        ),
        unsupported(
          "shoulder_line",
          "左右肩线",
          "当前高位下拉参考 schema 未包含左右肩高度差；不能将手腕不对称误报为高低肩。",
        ),
        corridorCard(
          "torso_stability",
          "躯干稳定",
          selected(comparison.features, LAT_PULLDOWN_QUALITY_FEATURE_GROUPS.torsoStability),
          "躯干横移与侧倾轨迹",
        ),
      ];

  cards.push(timingCard(
    "concentric_timing",
    "向心时间",
    timing?.toExtremeMs ?? null,
    "当前 rep 的下拉阶段时长；尚无经过审核的节奏参考带，不能判定“收缩不足”。",
  ));
  cards.push(timingCard(
    "eccentric_control",
    "离心控制",
    timing?.fromExtremeMs ?? null,
    "当前 rep 的回程时长；尚无节奏带与速度/jerk 参考，不能仅凭时长判断“失控”。",
  ));
  return Object.freeze(cards.map((card) => Object.freeze(card)));
}

function selected(
  features: readonly ReferenceFeatureEvidenceInput[],
  names: readonly string[],
): readonly ReferenceFeatureEvidenceInput[] {
  return features.filter((feature) => names.includes(feature.feature));
}

function corridorCard(
  id: QualityEvidenceCard["id"],
  title: string,
  features: readonly ReferenceFeatureEvidenceInput[],
  label: string,
): QualityEvidenceCard {
  const comparable = features.reduce((sum, feature) => sum + feature.comparableNodeCount, 0);
  const unknown = features.reduce((sum, feature) => sum + feature.unknownNodeCount, 0);
  const outside = features.reduce((sum, feature) => sum + feature.outsideNodeCount, 0);
  const longestRun = features.reduce(
    (maximum, feature) => Math.max(maximum, feature.maximumConsecutiveOutsideNodes),
    0,
  );
  if (features.length === 0 || comparable === 0) {
    return unavailable(id, title, `${label}没有足够的可比较关键点。`);
  }
  if (outside === 0) {
    return {
      id,
      status: "within_reference_band",
      title,
      detail: `${label}在已观测节点内落入当前参考带。`,
      evidence: `可比较 ${comparable} 节点；缺失 ${unknown} 节点；带外 0 节点。`,
    };
  }
  return {
    id,
    status: "deviation_observed",
    title,
    detail: `${label}出现参考带外轨迹，需结合视频复核。`,
    evidence: `可比较 ${comparable} 节点；带外 ${outside} 节点；最长连续偏离 ${longestRun} 节点；缺失 ${unknown} 节点。`,
  };
}

function timingCard(
  id: "concentric_timing" | "eccentric_control",
  title: string,
  durationMs: number | null,
  detail: string,
): QualityEvidenceCard {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return unavailable(id, title, "当前 rep 没有可用的阶段边界。" );
  }
  return {
    id,
    status: "measured_not_judged",
    title,
    detail,
    evidence: `${Math.round(durationMs)}ms`,
  };
}

function unavailable(
  id: QualityEvidenceCard["id"],
  title: string,
  detail: string,
): QualityEvidenceCard {
  return { id, status: "insufficient_observation", title, detail, evidence: "未判定" };
}

function unsupported(
  id: "range_of_motion" | "shoulder_line",
  title: string,
  detail: string,
): QualityEvidenceCard {
  return { id, status: "not_supported", title, detail, evidence: "当前版本不可评估" };
}
