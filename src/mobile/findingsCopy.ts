import { getT, MOTION_COPY } from "../i18n";
import type {
  MotionRepDisposition,
  MotionRepObservationFinding,
  MotionRepPhase,
  MotionSetLifecycle,
} from "../motion/motionPacket";

/**
 * Rust packet 词汇 → UI 文案的唯一映射处。文案本身住在 i18n 资源表
 * （MOTION_COPY），这里只做 packet 词汇 → 键名的映射。
 * 原则（对齐产品哲学）：只陈述证据，不打分；无 finding 就是"未见异常"。
 */

const PHASE_KEYS: Record<MotionRepPhase, string> = {
  ready: "phase.ready",
  effort: "phase.effort",
  peak: "phase.peak",
  return: "phase.return",
  frozen: "phase.frozen",
};

const LIFECYCLE_KEYS: Record<MotionSetLifecycle, string> = {
  idle: "lifecycle.idle",
  arming: "lifecycle.arming",
  active: "lifecycle.active",
  paused: "lifecycle.paused",
  finished: "lifecycle.finished",
};

const DISPOSITION_KEYS: Record<MotionRepDisposition, string> = {
  confirmed: "disposition.confirmed",
  needs_review: "disposition.needsReview",
  rejected: "disposition.rejected",
};

const FINDING_KEYS: Record<MotionRepObservationFinding, { level: FindingLevel; key: string }> = {
  primary_range_below_expectation: { level: "warn", key: "finding.primaryRangeBelow" },
  secondary_range_below_expectation: { level: "warn", key: "finding.secondaryRangeBelow" },
  cycle_faster_than_expected: { level: "info", key: "finding.cycleFaster" },
  equipment_primary_boundary: { level: "info", key: "finding.equipmentPrimaryBoundary" },
  pose_equipment_turnaround_aligned: { level: "info", key: "finding.poseEquipmentTurnaroundAligned" },
  pose_unavailable_at_turnaround: { level: "warn", key: "finding.poseUnavailableAtTurnaround" },
  pose_equipment_turnaround_conflict: { level: "warn", key: "finding.poseEquipmentTurnaroundConflict" },
  equipment_path_coverage_low: { level: "warn", key: "finding.equipmentPathCoverageLow" },
};

/** rep 相位标签（locale 从用户档案传入；缺省英文）。 */
export function phaseLabel(phase: MotionRepPhase, locale?: string): string {
  return getT(MOTION_COPY, locale)(PHASE_KEYS[phase]);
}

/** 组生命周期标签。 */
export function lifecycleLabel(lifecycle: MotionSetLifecycle, locale?: string): string {
  return getT(MOTION_COPY, locale)(LIFECYCLE_KEYS[lifecycle]);
}

/** rep 处置标签。 */
export function dispositionLabel(disposition: MotionRepDisposition, locale?: string): string {
  return getT(MOTION_COPY, locale)(DISPOSITION_KEYS[disposition]);
}

export type FindingLevel = "warn" | "info";

export interface FindingCopy {
  finding: MotionRepObservationFinding;
  level: FindingLevel;
  title: string;
  detail: string;
}

export function mapFinding(finding: MotionRepObservationFinding, locale?: string): FindingCopy {
  const t = getT(MOTION_COPY, locale);
  const entry = FINDING_KEYS[finding];
  return {
    finding,
    level: entry.level,
    title: t(`${entry.key}.title`),
    detail: t(`${entry.key}.detail`),
  };
}

/** 实时便签条用的一行文案：取最新一个 confirmed rep 的首个 finding；无则给肯定陈述。 */
export function liveObservationLine(
  findings: readonly MotionRepObservationFinding[],
  locale?: string,
): string {
  if (findings.length === 0) return getT(MOTION_COPY, locale)("live.steady");
  return mapFinding(findings[0], locale).title;
}
