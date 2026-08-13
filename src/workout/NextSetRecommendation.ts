import type {
  PlannedExerciseSet,
  PlannedExerciseTask,
  UpcomingWorkoutPlanChange,
} from "../coach/domain";
import type { RuleDecision } from "../training-rules";

export interface WorkoutNextSetRecommendation {
  userId: string;
  workoutId: string;
  /** Reject applying a recommendation after the workout prescription has moved. */
  baseWorkoutRevision: number;
  sourceOutcomeId: string;
  nextTaskId?: string;
  nextSetId?: string;
  status: "proposal" | "no_change" | "blocked" | "unavailable";
  decision: RuleDecision;
  change?: Extract<UpcomingWorkoutPlanChange, { kind: "adjust_set" }>;
  reason: string;
}

/**
 * Converts a RulePack decision into an executable *next-set-only* edit.  The
 * RulePack remains responsible for deciding what is justified; this adapter
 * merely refuses anything that would cross an exercise identity, invent an
 * intermediate load, or produce a no-op card.
 */
export function toNextSetRecommendation(input: {
  userId: string;
  workoutId: string;
  baseWorkoutRevision: number;
  sourceOutcomeId: string;
  sourceExerciseVariantId: string;
  next?: { task: PlannedExerciseTask; set: PlannedExerciseSet };
  decision: RuleDecision;
}): WorkoutNextSetRecommendation {
  const base = {
    userId: input.userId,
    workoutId: input.workoutId,
    baseWorkoutRevision: input.baseWorkoutRevision,
    sourceOutcomeId: input.sourceOutcomeId,
    ...(input.next ? { nextTaskId: input.next.task.id, nextSetId: input.next.set.id } : {}),
    decision: input.decision,
  };
  if (input.decision.decision === "safety_stop") {
    return { ...base, status: "blocked", reason: "safety_or_local_constraint" };
  }
  if (input.decision.decision === "unavailable") {
    return { ...base, status: "unavailable", reason: input.decision.reasonCodes[0] ?? "rulepack_unavailable" };
  }
  if (!input.next) return { ...base, status: "no_change", reason: "no_unstarted_set" };
  if (input.next.task.exerciseVariantId !== input.sourceExerciseVariantId) {
    return { ...base, status: "no_change", reason: "next_set_has_different_exercise_context" };
  }
  if (input.decision.scope !== "next_unstarted_set") {
    return { ...base, status: "no_change", reason: "decision_scope_is_not_next_set" };
  }
  const patch = patchFromDecision(input.decision, input.next.set);
  if (!patch || Object.keys(patch).length === 0) {
    return { ...base, status: "no_change", reason: "decision_has_no_material_next_set_diff" };
  }
  return {
    ...base,
    status: "proposal",
    change: {
      kind: "adjust_set",
      taskId: input.next.task.id,
      setId: input.next.set.id,
      patch,
    },
    reason: "versioned_rulepack_next_set_diff",
  };
}

function patchFromDecision(
  decision: RuleDecision,
  next: PlannedExerciseSet,
): Extract<UpcomingWorkoutPlanChange, { kind: "adjust_set" }> ["patch"] | undefined {
  if (decision.decision === "reduce_load" || decision.decision === "increase_load") {
    const load = massQuantity(decision.after.load);
    if (!load || equalMass(load, next.targetLoad)) return undefined;
    const patch: Extract<UpcomingWorkoutPlanChange, { kind: "adjust_set" }> ["patch"] = {
      targetLoad: load,
    };
    const reps = integer(decision.after.reps);
    if (reps !== undefined && (!next.targetReps || next.targetReps.min !== reps || next.targetReps.max !== reps)) {
      patch.targetReps = { min: reps, max: reps };
    }
    return patch;
  }
  if (decision.decision === "add_rep") {
    const reps = integer(decision.after.reps);
    if (reps === undefined || !next.targetReps || next.targetReps.max === reps) return undefined;
    return { targetReps: { min: next.targetReps.min, max: reps } };
  }
  return undefined;
}

function massQuantity(value: unknown): { value: number; unit: "kg" | "lb" } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { value?: unknown; unit?: unknown };
  if ((candidate.unit !== "kg" && candidate.unit !== "lb") || typeof candidate.value !== "number" || !Number.isFinite(candidate.value) || candidate.value < 0) {
    return undefined;
  }
  return { value: candidate.value, unit: candidate.unit };
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function equalMass(
  left: { value: number; unit: "kg" | "lb" },
  right: { value: number; unit: "kg" | "lb" } | undefined,
): boolean {
  return Boolean(right && left.unit === right.unit && Math.abs(left.value - right.value) < 1e-8);
}
