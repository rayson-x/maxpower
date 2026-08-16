import type { GoalPathAssessment, GoalPathState } from "../goal-path";

/**
 * User-facing copy for fixed GoalPath outcomes. Internal reason codes stay in
 * the structured assessment for the Agent and the behavior trace; people see
 * product language only.
 */
export function goalPathStateLabel(state: GoalPathState): string {
  switch (state) {
    case "on_path": return "在路径上";
    case "at_risk": return "需要复核";
    case "infeasible_under_guardrails": return "需要调整";
    case "insufficient_evidence": return "待积累";
  }
}

/** The user-visible summary lines for a delivered GoalPath signal. */
export function goalPathSignalSummary(
  assessment: Pick<GoalPathAssessment, "state" | "materialSignal" | "diagnosis">,
): readonly string[] {
  if (assessment.materialSignal === "hard_safety") {
    return ["安全相关的信号需要立即处理；在确认前，相关自动安排保持暂停。"];
  }
  switch (assessment.state) {
    case "at_risk":
      if (assessment.diagnosis === "plan_friction" || assessment.diagnosis === "execution_failure") {
        return ["最近的完成度与当前安排存在差距，需要一起复核。"];
      }
      if (assessment.diagnosis === "recovery_limited") {
        return ["最近的恢复状态需要优先处理。"];
      }
      return ["固定检查发现当前路径与目标存在偏差，需要复核。"];
    case "insufficient_evidence":
      return ["记录还不足以判断当前路径；继续记录后再评估。"];
    case "on_path":
      return ["当前记录支持现有安排。"];
    case "infeasible_under_guardrails":
      return ["按当前安全边界这条路径不可行，需要重新协商目标或期限。"];
  }
}
