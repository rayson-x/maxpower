import type {
  PlannedExerciseSet,
  PlannedExerciseTask,
  PlannedSessionData,
  UpcomingWorkoutPlanChange,
} from "../coach/domain";
import { assertOnlyUpcomingPlannedSessionChanged } from "./WorkoutExecutionPolicy";

export type UpcomingWorkoutEditScope = "next_set" | "future_sets" | "future_tasks";

export interface ApplyUpcomingWorkoutPlanChangeInput {
  before: PlannedSessionData;
  change: UpcomingWorkoutPlanChange;
  completedPrescriptionSetIds: readonly string[];
  /** A saved draft means that set has started and is frozen. */
  draftedPrescriptionSetId?: string;
}

export interface AppliedUpcomingWorkoutPlanChange {
  frozenPrescription: PlannedSessionData;
  scope: UpcomingWorkoutEditScope;
}

/**
 * Produces the next frozen prescription from one small edit.  It deliberately
 * knows nothing about persistence, Agent policy or UI; its job is to make the
 * safe editing boundary executable and repeatable on every client.
 */
export function applyUpcomingWorkoutPlanChange(
  input: ApplyUpcomingWorkoutPlanChangeInput,
): AppliedUpcomingWorkoutPlanChange {
  assertPrescriptionShape(input.before);
  const lockedSetIds = new Set([
    ...input.completedPrescriptionSetIds,
    ...(input.draftedPrescriptionSetId ? [input.draftedPrescriptionSetId] : []),
  ]);
  const lockedTaskIndexes = input.before.tasks
    .map((task, index) => task.sets.some((set) => lockedSetIds.has(set.id)) ? index : -1)
    .filter((index) => index >= 0);
  const lastLockedTaskIndex = lockedTaskIndexes.length ? Math.max(...lockedTaskIndexes) : -1;
  const change = input.change;
  const taskIndex = (taskId: string): number => {
    const index = input.before.tasks.findIndex((task) => task.id === taskId);
    if (index < 0) throw new Error("workout_task_not_found");
    return index;
  };
  const assertTaskIsEditable = (index: number) => {
    if (input.before.tasks[index]!.sets.some((set) => lockedSetIds.has(set.id))) {
      throw new Error("workout_task_has_frozen_set");
    }
  };

  let tasks: readonly PlannedExerciseTask[];
  let scope: UpcomingWorkoutEditScope;
  switch (change.kind) {
    case "adjust_set": {
      const index = taskIndex(change.taskId);
      const task = input.before.tasks[index]!;
      const set = task.sets.find((candidate) => candidate.id === change.setId);
      if (!set) throw new Error("workout_set_not_found");
      if (lockedSetIds.has(set.id)) throw new Error("current_or_completed_set_is_frozen");
      const nextSet = applySetPatch(set, change.patch);
      tasks = input.before.tasks.map((candidate) => candidate.id !== task.id
        ? candidate
        : { ...candidate, sets: candidate.sets.map((item) => item.id === set.id ? nextSet : item) });
      const nextUnperformedSetId = input.before.tasks
        .flatMap((candidate) => candidate.sets)
        .find((candidate) => !input.completedPrescriptionSetIds.includes(candidate.id))?.id;
      scope = set.id === nextUnperformedSetId ? "next_set" : "future_sets";
      break;
    }
    case "add_task": {
      assertTaskShape(change.task);
      if (input.before.tasks.some((task) => task.id === change.task.id)) {
        throw new Error("duplicate_workout_task_id");
      }
      const existingSetIds = new Set(input.before.tasks.flatMap((task) => task.sets.map((set) => set.id)));
      if (change.task.sets.some((set) => existingSetIds.has(set.id))) {
        throw new Error("duplicate_workout_set_id");
      }
      const requested = change.index ?? input.before.tasks.length;
      if (!Number.isInteger(requested) || requested < 0 || requested > input.before.tasks.length) {
        throw new Error("invalid_workout_task_index");
      }
      if (requested <= lastLockedTaskIndex) throw new Error("cannot_insert_before_started_workout_task");
      tasks = [
        ...input.before.tasks.slice(0, requested),
        change.task,
        ...input.before.tasks.slice(requested),
      ];
      scope = "future_tasks";
      break;
    }
    case "remove_task": {
      const index = taskIndex(change.taskId);
      assertTaskIsEditable(index);
      tasks = input.before.tasks.filter((task) => task.id !== change.taskId);
      scope = "future_tasks";
      break;
    }
    case "replace_task_exercise": {
      const index = taskIndex(change.taskId);
      assertTaskIsEditable(index);
      if (!change.replacementExerciseVariantId.trim()) throw new Error("replacement_exercise_required");
      const task = input.before.tasks[index]!;
      const replacementSets = change.replacementSets ?? task.sets.map(clearTargetLoad);
      if (replacementSets.some((set) => set.targetLoad !== undefined || set.targetLoadStatus !== undefined || set.targetLoadBasis !== undefined)) {
        throw new Error("substitution_must_not_copy_target_load");
      }
      if (replacementSets.length !== task.sets.length) {
        throw new Error("replacement_task_set_count_must_be_explicit_session_edit");
      }
      if (replacementSets.some((set, setIndex) => set.id !== task.sets[setIndex]?.id)) {
        throw new Error("replacement_task_must_preserve_unstarted_set_ids");
      }
      replacementSets.forEach(assertSetShape);
      tasks = input.before.tasks.map((candidate) => candidate.id !== task.id
        ? candidate
        : {
            ...candidate,
            exerciseVariantId: change.replacementExerciseVariantId,
            sets: replacementSets,
          });
      scope = "future_tasks";
      break;
    }
    case "replace_remaining_task": {
      const index = taskIndex(change.taskId);
      const task = input.before.tasks[index]!;
      if (!change.replacementExerciseVariantId.trim()) throw new Error("replacement_exercise_required");
      if (!change.replacementTaskId.trim() || input.before.tasks.some((candidate) => candidate.id === change.replacementTaskId)) {
        throw new Error("duplicate_workout_task_id");
      }
      const lockedSets = task.sets.filter((set) => lockedSetIds.has(set.id));
      const remainingSets = task.sets.filter((set) => !lockedSetIds.has(set.id)).map(clearTargetLoad);
      if (!lockedSets.length) throw new Error("replace_remaining_requires_started_task");
      if (!remainingSets.length) throw new Error("workout_task_has_no_unresolved_set");
      const replacement: PlannedExerciseTask = {
        ...task,
        id: change.replacementTaskId,
        exerciseVariantId: change.replacementExerciseVariantId,
        sets: remainingSets,
      };
      tasks = [
        ...input.before.tasks.slice(0, index),
        { ...task, sets: lockedSets },
        replacement,
        ...input.before.tasks.slice(index + 1),
      ];
      scope = "future_tasks";
      break;
    }
    case "reorder_task": {
      const index = taskIndex(change.taskId);
      assertTaskIsEditable(index);
      if (!Number.isInteger(change.toIndex) || change.toIndex < 0 || change.toIndex >= input.before.tasks.length) {
        throw new Error("invalid_workout_task_index");
      }
      if (change.toIndex <= lastLockedTaskIndex) {
        throw new Error("cannot_move_task_before_started_workout_task");
      }
      const reordered = [...input.before.tasks];
      const [task] = reordered.splice(index, 1);
      reordered.splice(change.toIndex, 0, task!);
      tasks = reordered;
      scope = "future_tasks";
      break;
    }
  }

  const frozenPrescription = { ...input.before, tasks } satisfies PlannedSessionData;
  assertPrescriptionShape(frozenPrescription);
  assertOnlyUpcomingPlannedSessionChanged({
    before: input.before,
    after: frozenPrescription,
    completedPrescriptionSetIds: input.completedPrescriptionSetIds,
    currentSetId: input.draftedPrescriptionSetId,
  });
  return { frozenPrescription, scope };
}

function applySetPatch(
  set: PlannedExerciseSet,
  patch: Extract<UpcomingWorkoutPlanChange, { kind: "adjust_set" }> ["patch"],
): PlannedExerciseSet {
  const next: PlannedExerciseSet = { ...set };
  for (const [field, value] of Object.entries(patch) as [
    keyof typeof patch,
    (typeof patch)[keyof typeof patch],
  ][]) {
    if (value === undefined) continue;
    if (value === null) delete next[field];
    else Object.assign(next, { [field]: value });
  }
  assertSetShape(next);
  return next;
}

function clearTargetLoad(set: PlannedExerciseSet): PlannedExerciseSet {
  const { targetLoad: _targetLoad, targetLoadStatus: _targetLoadStatus, targetLoadBasis: _targetLoadBasis, ...rest } = set;
  return rest;
}

function assertPrescriptionShape(prescription: PlannedSessionData): void {
  const taskIds = new Set<string>();
  const setIds = new Set<string>();
  for (const task of prescription.tasks) {
    assertTaskShape(task);
    if (taskIds.has(task.id)) throw new Error("duplicate_workout_task_id");
    taskIds.add(task.id);
    for (const set of task.sets) {
      if (setIds.has(set.id)) throw new Error("duplicate_workout_set_id");
      setIds.add(set.id);
    }
  }
}

function assertTaskShape(task: PlannedExerciseTask): void {
  if (!task.id.trim() || !task.exerciseVariantId.trim()) throw new Error("invalid_workout_task");
  if (!task.sets.length) throw new Error("workout_task_requires_set");
  task.sets.forEach(assertSetShape);
}

function assertSetShape(set: PlannedExerciseSet): void {
  if (!set.id.trim()) throw new Error("invalid_workout_set");
  if (set.targetReps && (
    !Number.isInteger(set.targetReps.min) ||
    !Number.isInteger(set.targetReps.max) ||
    set.targetReps.min < 0 ||
    set.targetReps.max < set.targetReps.min
  )) throw new Error("invalid_workout_target_reps");
  if (set.targetRir !== undefined && (!Number.isFinite(set.targetRir) || set.targetRir < 0 || set.targetRir > 10)) {
    throw new Error("invalid_workout_target_rir");
  }
  if (set.targetLoad && (!Number.isFinite(set.targetLoad.value) || set.targetLoad.value < 0)) {
    throw new Error("invalid_workout_target_load");
  }
  if (set.rest && (!Number.isFinite(set.rest.value) || set.rest.value < 0)) {
    throw new Error("invalid_workout_target_rest");
  }
  if (set.targetDuration && (!Number.isFinite(set.targetDuration.value) || set.targetDuration.value < 0)) {
    throw new Error("invalid_workout_target_duration");
  }
  if (set.targetDistance && (!Number.isFinite(set.targetDistance.value) || set.targetDistance.value < 0)) {
    throw new Error("invalid_workout_target_distance");
  }
}
