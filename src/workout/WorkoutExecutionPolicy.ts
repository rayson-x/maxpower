import type {
  DomainActor,
  SessionOutcomeData,
  SessionPrescriptionData,
  WorkoutExecutionMode,
  WorkoutExecutionState,
  WorkoutProjection,
  WorkoutSessionPolicy,
  WorkoutSessionStatus,
} from "../coach/domain";

export function newWorkoutState(input: {
  status: WorkoutSessionStatus;
  mode: WorkoutExecutionMode;
  policy: WorkoutSessionPolicy;
  actor: DomainActor;
  occurredAt: string;
  idempotencyKey: string;
}): WorkoutExecutionState {
  return {
    status: input.status,
    mode: input.mode,
    policy: input.policy,
    transitions: input.status === "planned"
      ? []
      : [{
          from: "planned",
          to: input.status,
          reason: input.status === "active" ? "started" : "created",
          actor: input.actor,
          occurredAt: input.occurredAt,
          idempotencyKey: input.idempotencyKey,
        }],
  };
}

export function transitionWorkoutState(input: {
  current: WorkoutExecutionState;
  to: WorkoutSessionStatus;
  reason: string;
  actor: DomainActor;
  occurredAt: string;
  idempotencyKey: string;
  mode?: WorkoutExecutionMode;
  currentTaskId?: string;
  currentSetId?: string;
}): WorkoutExecutionState {
  if (!isWorkoutTransitionAllowed(input.current.status, input.to)) {
    throw new Error(`invalid_workout_transition:${input.current.status}:${input.to}`);
  }
  if (input.current.status === input.to) {
    return {
      ...input.current,
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.currentTaskId === undefined ? {} : { currentTaskId: input.currentTaskId }),
      ...(input.currentSetId === undefined ? {} : { currentSetId: input.currentSetId }),
    };
  }
  return {
    ...input.current,
    status: input.to,
    ...(input.mode ? { mode: input.mode } : {}),
    ...(input.currentTaskId === undefined ? {} : { currentTaskId: input.currentTaskId }),
    ...(input.currentSetId === undefined ? {} : { currentSetId: input.currentSetId }),
    ...(input.to === "paused" ? { pauseReason: pauseReason(input.reason) } : { pauseReason: undefined }),
    transitions: [
      ...input.current.transitions,
      {
        from: input.current.status,
        to: input.to,
        reason: input.reason,
        actor: input.actor,
        occurredAt: input.occurredAt,
        idempotencyKey: input.idempotencyKey,
      },
    ],
  };
}

export function isWorkoutTransitionAllowed(from: WorkoutSessionStatus, to: WorkoutSessionStatus): boolean {
  if (from === to) return true;
  const transitions: Record<WorkoutSessionStatus, readonly WorkoutSessionStatus[]> = {
    planned: ["active", "abandoned"],
    active: ["paused", "completed", "partial", "abandoned"],
    paused: ["active", "partial", "abandoned"],
    completed: [],
    partial: ["active", "abandoned"],
    abandoned: [],
  };
  return transitions[from].includes(to);
}

export function remainingRestSeconds(input: {
  deadlineMonotonicMs: number;
  deadlineMonotonicClockEpoch?: string;
  deadlineWallClockAt: string;
  nowMonotonicMs?: number;
  nowMonotonicClockEpoch?: string;
  nowWallClockAt: string;
}): number {
  const canUseMonotonic = input.nowMonotonicMs !== undefined &&
    (!input.deadlineMonotonicClockEpoch || input.deadlineMonotonicClockEpoch === input.nowMonotonicClockEpoch);
  const remainingMs = !canUseMonotonic
    ? Date.parse(input.deadlineWallClockAt) - Date.parse(input.nowWallClockAt)
    : input.deadlineMonotonicMs - input.nowMonotonicMs!;
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

export function hasExpiredRecoveryWindow(workout: WorkoutProjection, now: string): boolean {
  const last = workout.state.transitions.at(-1)?.occurredAt ?? now;
  const elapsedMs = Date.parse(now) - Date.parse(last);
  return Number.isFinite(elapsedMs) && elapsedMs > workout.state.policy.resumeWindowHours * 3_600_000;
}

export function deriveSessionOutcome(workout: WorkoutProjection, completedAt: string): SessionOutcomeData {
  const completedIds = new Set(workout.setOutcomes.map((outcome) => outcome.prescriptionSetId));
  const skippedIds = new Set((workout.skippedSets ?? []).map((skipped) => skipped.prescriptionSetId));
  const resolvedIds = new Set([...completedIds, ...skippedIds]);
  const allSets = workout.frozenPrescription.tasks.flatMap((task) => task.sets);
  const incomplete = allSets.filter((set) => !resolvedIds.has(set.id)).map((set) => set.id);
  const skipped = allSets.filter((set) => skippedIds.has(set.id)).map((set) => set.id);
  const packetRefs = workout.setOutcomes
    .flatMap((outcome) => outcome.packetRef ? [outcome.packetRef] : [])
    .filter((item, index, values) => values.findIndex((other) => other.id === item.id && other.hash === item.hash) === index);
  const dataCompleteness = incomplete.length || skipped.length
    ? "partial"
    : workout.setOutcomes.some((outcome) => outcome.source === "camera_confirmed")
      ? "complete"
      : "manual_only";
  return {
    status: incomplete.length || skipped.length ? "partial" : "completed",
    completedAt,
    completedWorkSets: workout.setOutcomes.length,
    directSets: workout.setOutcomes.length,
    incompletePrescriptionSetIds: incomplete,
    ...(skipped.length ? { skippedPrescriptionSetIds: skipped } : {}),
    motionPacketRefs: packetRefs,
    dataCompleteness,
  };
}

/** Current set and already committed outcomes are immutable execution history. */
export function assertOnlyUpcomingPrescriptionChanged(input: {
  before: SessionPrescriptionData;
  after: SessionPrescriptionData;
  completedPrescriptionSetIds: readonly string[];
  currentSetId?: string;
}): void {
  const locked = new Set([...input.completedPrescriptionSetIds, ...(input.currentSetId ? [input.currentSetId] : [])]);
  const beforeSets = new Map(input.before.tasks.flatMap((task) => task.sets.map((set) => [set.id, { task, set }] as const)));
  const afterSets = new Map(input.after.tasks.flatMap((task) => task.sets.map((set) => [set.id, { task, set }] as const)));
  for (const id of locked) {
    const before = beforeSets.get(id);
    const after = afterSets.get(id);
    // Do not compare the enclosing task's whole `sets` array: later sets in
    // the same task are intentionally editable, while the locked set and its
    // exercise identity are not.
    if (!before || !after || JSON.stringify(lockedSetSignature(before)) !== JSON.stringify(lockedSetSignature(after))) {
      throw new Error("current_or_completed_set_is_frozen");
    }
  }
}

function lockedSetSignature(input: {
  task: SessionPrescriptionData["tasks"][number];
  set: SessionPrescriptionData["tasks"][number]["sets"][number];
}) {
  return {
    taskId: input.task.id,
    exerciseVariantId: input.task.exerciseVariantId,
    stimulusSlotId: input.task.stimulusSlotId,
    mode: input.task.mode,
    set: input.set,
  };
}

function pauseReason(value: string): "user" | "safety" | "background" | "schedule" {
  if (value.includes("safety")) return "safety";
  if (value.includes("background")) return "background";
  if (value.includes("schedule")) return "schedule";
  return "user";
}
