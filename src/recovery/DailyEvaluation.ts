import type { RecoveryDecision } from "./RecoveryRulePack";
import type { NutritionDayLedger } from "../nutrition";

export type DailyEvaluationStatus = "CONTINUE" | "DAILY_ADJUST" | "REVIEW_PHASE" | "SAFETY_PAUSE";

export interface DailyEvaluation {
  id: string;
  date: string;
  status: DailyEvaluationStatus;
  adjustment: "keep" | "reduce_load" | "reduce_volume" | "extend_rest" | "recovery_day" | "pause_and_confirm";
  reasons: readonly string[];
  factRefs: readonly string[];
  missing: readonly string[];
  planBoundary: "current_day_only" | "next_safety_boundary" | "none";
  nextReviewAt: string;
}

/**
 * Closed daily state vocabulary. A check-in may adjust remaining work, but it
 * cannot silently become a phase switch or rewrite an already-started set.
 */
export function deriveDailyEvaluation(input: {
  id: string;
  date: string;
  recovery: RecoveryDecision;
  nutrition?: NutritionDayLedger;
  plannedSessionKind?: "weighted_reps" | "bodyweight_reps" | "cardio" | "recovery" | "rest";
  hasStartedSet: boolean;
  phaseReviewRequested?: boolean;
  factRefs?: readonly string[];
  nextReviewAt: string;
}): DailyEvaluation {
  const level = input.recovery.constraint.level;
  const safety = level === "pause_and_confirm";
  const normal = level === "normal";
  const phaseReview = Boolean(input.phaseReviewRequested);
  const restDay = input.plannedSessionKind === "rest" || input.plannedSessionKind === "recovery";
  const adjustment = safety
    ? "pause_and_confirm"
    : normal
      ? "keep"
      : restDay
        ? "recovery_day"
        : input.recovery.constraint.intentions?.some((item) => item.kind === "remove_optional_sets")
          ? "reduce_volume"
          : input.recovery.constraint.intentions?.some((item) => item.kind === "extend_rest")
            ? "extend_rest"
            : "reduce_load";
  return {
    id: input.id,
    date: input.date,
    status: safety ? "SAFETY_PAUSE" : phaseReview ? "REVIEW_PHASE" : normal ? "CONTINUE" : "DAILY_ADJUST",
    adjustment,
    reasons: input.recovery.constraint.evaluation?.reasonCodes ?? [],
    factRefs: [...new Set([...(input.factRefs ?? []), ...(input.recovery.constraint.evaluation?.triggeringFactRefs ?? [])])],
    missing: [
      ...(input.recovery.constraint.evaluation?.missingOrStale ?? []),
      ...(input.nutrition?.coverage === "no_log" ? ["nutrition_coverage_unknown"] : []),
    ],
    planBoundary: safety ? "next_safety_boundary" : input.hasStartedSet ? "next_safety_boundary" : "current_day_only",
    nextReviewAt: input.nextReviewAt,
  };
}
