import {
  DOMAIN_EVENT_SCHEMA_VERSION,
  type DomainActor,
  type DomainAggregateKind,
  type DomainAggregateRef,
  type DomainEvent,
  type DomainProjection,
  type ExerciseSetPrescription,
  type ExerciseTaskPrescription,
  type GoalContractData,
  type GoalCycleData,
  type PlanRevisionData,
  type Revisioned,
  type SessionPrescriptionData,
  type SetOutcomeData,
  type WorkoutExecutionMode,
} from "../../coach/domain";
import { InMemoryCoachLedger, type CoachLedger } from "../../coach/ledger";
import type { EvidenceBriefArtifact, LedgerSnapshot } from "../../coach/model";
import { stableHash } from "../../coach/stable";

import { CLOUD_PLAN_RECOVERY_SCHEMA_VERSION } from "./CloudPlanRecovery";
import type {
  CloudCanonicalProjection,
  CloudJsonObject,
  CloudPlan,
  CloudResult,
  CloudWorkoutSession,
} from "./model";

type PlanningPreview = NonNullable<EvidenceBriefArtifact["planningPreview"]>;

interface CloudRecoveryDomain {
  profile: NonNullable<DomainProjection["profile"]>;
  goalContract: Revisioned<GoalContractData>;
  mandate: NonNullable<DomainProjection["mandate"]>;
  equipmentProfiles: DomainProjection["equipmentProfiles"];
  recoveryConstraints: DomainProjection["recoveryConstraints"];
  nutritionStrategies: DomainProjection["nutritionStrategies"];
  customExercises: DomainProjection["customExercises"];
  safetyConstraints: DomainProjection["safetyConstraints"];
}

interface CloudPlanRecoveryEnvelope {
  kind: "maxpower_plan_recovery";
  schemaVersion: typeof CLOUD_PLAN_RECOVERY_SCHEMA_VERSION;
  artifactId: string;
  planningPreview: PlanningPreview;
  domain: CloudRecoveryDomain;
}

interface CloudProfileRecoveryEnvelope {
  kind: "maxpower_profile_recovery";
  schemaVersion: typeof CLOUD_PLAN_RECOVERY_SCHEMA_VERSION;
  domain: CloudRecoveryDomain;
}

export interface HydrateCloudCanonicalProjectionInput {
  accountId: string;
  ledger: CoachLedger;
  projection: CloudCanonicalProjection;
}

export interface CloudCanonicalHydrationResult {
  status: "hydrated" | "no_recovery_snapshot";
  planId?: string;
  workoutCount: number;
  resultCount: number;
}

interface RecoveryPlanVersion {
  envelope: CloudPlanRecoveryEnvelope;
  planRevision: PlanRevisionData;
  fingerprint: string;
  recoveredRevision: number;
  sortKey: string;
  current: boolean;
}

const CLOUD_OWNED_KINDS = new Set<DomainAggregateKind>([
  "user_profile",
  "goal_contract",
  "coaching_mandate",
  "goal_cycle",
  "plan",
  "workout_session",
  "nutrition_strategy",
  "equipment_profile",
  "recovery_constraint",
  "custom_exercise",
  "safety_constraint",
]);
const SYNC_ACTOR: DomainActor = { kind: "sync", id: "cloud-canonical-recovery" };

/**
 * Rebuilds the cloud-owned domain slice in a staging Ledger, then swaps it in
 * with CAS. Local conversations, Timeline facts, permissions and device-only
 * evidence remain untouched. No recovered event is added to the replica outbox.
 */
export async function hydrateCloudCanonicalProjection(
  input: HydrateCloudCanonicalProjectionInput,
): Promise<CloudCanonicalHydrationResult> {
  assertProjectionOwner(input.projection, input.accountId);
  const planRecovery = collectRecoveryPlanVersions(input.projection);
  const profileRecovery = recoveryProfileEnvelope(input.projection.profile.data);
  // Profile recovery is revision-aware current state. Plan envelopes are
  // immutable historical context and must not overwrite a later profile edit.
  const contextDomain = profileRecovery?.domain ?? planRecovery.contextEnvelope?.domain;
  const before = await input.ledger.read();
  const removedEventIds = new Set(
    before.domainEvents
      .filter((event) => event.userId === input.accountId && CLOUD_OWNED_KINDS.has(event.aggregate.kind))
      .map((event) => event.id),
  );
  const retained = stripCloudOwnedDomain(before, input.accountId, removedEventIds);
  if (!contextDomain) {
    await input.ledger.swapRestoredSnapshot({
      expectedSnapshotHash: stableHash(before),
      nextSnapshot: retained,
    });
    return { status: "no_recovery_snapshot", workoutCount: 0, resultCount: 0 };
  }
  const staging = new InMemoryCoachLedger(retained);
  const recordedAt = validTimestamp(input.projection.fetchedAt, "cloud_projection_fetched_at");
  const contextEvents = createContextEvents(
    input.accountId,
    contextDomain,
    planRecovery.contextEnvelope?.planningPreview.proposal.goalCycle,
    planRecovery.ordered,
    recordedAt,
    new Set(retained.aggregateRevisions
      .filter((state) => state.userId === input.accountId)
      .map((state) => `${state.kind}:${state.id}`)),
  );
  await commitRecoveryBatch(staging, input.accountId, "context", contextEvents, recordedAt);

  let workoutCount = 0;
  let resultCount = 0;
  for (const workout of [...input.projection.workoutSessions].sort(byStartedAt)) {
    const workoutEnvelope = recoveryEnvelope(workout.planSnapshot);
    if (!workoutEnvelope) continue;
    const recoveredPlan = planRecovery.byFingerprint.get(stableHash(workout.planSnapshot));
    if (!recoveredPlan) continue;
    const built = createWorkoutEvents({
      accountId: input.accountId,
      workout,
      results: input.projection.results.filter((result) => result.workoutSessionId === workout.id),
      planRevision: recoveredPlan.planRevision,
      planAggregateRevision: recoveredPlan.recoveredRevision,
      recordedAt,
    });
    if (built.events.length === 0) continue;
    await commitRecoveryBatch(staging, input.accountId, `workout:${workout.id}`, built.events, recordedAt);
    workoutCount += 1;
    resultCount += built.resultCount;
  }

  const archivedPlanEvents = planRecovery.aggregateRevisions
    .filter(({ id }) => id !== planRecovery.current?.planRevision.id)
    .map(({ id, revision }) => recoveryEvent(
      input.accountId,
      "aggregate.archived",
      "plan",
      id,
      { reason: "not_current_in_cloud" },
      recordedAt,
      recordedAt,
      revision + 1,
    ));
  if (archivedPlanEvents.length > 0) {
    await commitRecoveryBatch(
      staging,
      input.accountId,
      "archive-historical-plans",
      archivedPlanEvents,
      recordedAt,
      planRecovery.aggregateRevisions
        .filter(({ id }) => id !== planRecovery.current?.planRevision.id)
        .map(({ id, revision }) => ({ kind: "plan" as const, id, revision })),
    );
  }

  await input.ledger.swapRestoredSnapshot({
    expectedSnapshotHash: stableHash(before),
    nextSnapshot: await staging.read(),
  });
  return {
    status: "hydrated",
    ...(planRecovery.current ? { planId: planRecovery.current.planRevision.id } : {}),
    workoutCount,
    resultCount,
  };
}

function collectRecoveryPlanVersions(projection: CloudCanonicalProjection): {
  contextEnvelope?: CloudPlanRecoveryEnvelope;
  current?: RecoveryPlanVersion;
  ordered: readonly RecoveryPlanVersion[];
  byFingerprint: ReadonlyMap<string, RecoveryPlanVersion>;
  aggregateRevisions: readonly { id: string; revision: number }[];
} {
  const publishedPlans = projection.plans
    .filter((plan) => plan.status === "published" && plan.publishedVersionId !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const currentCloudPlan = publishedPlans[0];
  const currentVersionId = currentCloudPlan?.publishedVersionId;
  const raw: Omit<RecoveryPlanVersion, "planRevision" | "recoveredRevision" | "current">[] = [];
  const seen = new Set<string>();
  const add = (snapshot: CloudJsonObject | null | undefined, sortKey: string) => {
    const envelope = recoveryEnvelope(snapshot);
    if (!envelope || !snapshot) return;
    const fingerprint = stableHash(snapshot);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    raw.push({ envelope, fingerprint, sortKey });
  };
  for (const plan of projection.plans) {
    for (const version of [...plan.versions].sort((left, right) => left.number - right.number)) {
      if (version.publishedAt === null && version.id !== plan.publishedVersionId) continue;
      add(version.snapshot, `${version.createdAt}:${String(version.number).padStart(8, "0")}`);
    }
  }
  for (const workout of [...projection.workoutSessions].sort(byStartedAt)) {
    add(workout.planSnapshot, `${workout.startedAt}:workout:${workout.id}`);
  }
  const currentSnapshot = currentCloudPlan?.versions.find((version) => version.id === currentVersionId)?.snapshot;
  const currentFingerprint = currentSnapshot ? stableHash(currentSnapshot) : undefined;
  const contextEnvelope = raw.find((item) => item.fingerprint === currentFingerprint)?.envelope
    ?? [...raw].sort((left, right) => right.sortKey.localeCompare(left.sortKey))[0]?.envelope;
  if (!contextEnvelope) {
    return { ordered: [], byFingerprint: new Map(), aggregateRevisions: [] };
  }
  const grouped = new Map<string, typeof raw>();
  for (const item of raw) {
    const planId = item.envelope.planningPreview.proposal.planRevision.id;
    const group = grouped.get(planId) ?? [];
    group.push(item);
    grouped.set(planId, group);
  }
  const recovered: RecoveryPlanVersion[] = [];
  for (const [planId, versions] of grouped) {
    const sorted = versions.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
    sorted.forEach((item, index) => recovered.push({
      ...item,
      planRevision: normalizePlan(item.envelope, contextEnvelope),
      recoveredRevision: index + 1,
      current: item.fingerprint === currentFingerprint,
    }));
    if (!planId) throw new Error("cloud_plan_recovery_invalid");
  }
  const ordered = recovered.sort((left, right) => {
    if (left.current !== right.current) return left.current ? 1 : -1;
    return left.sortKey.localeCompare(right.sortKey);
  });
  const current = ordered.find((item) => item.current);
  const aggregateRevisions = [...grouped.keys()].map((id) => ({
    id,
    revision: recovered.filter((item) => item.planRevision.id === id).length,
  }));
  return {
    contextEnvelope,
    ...(current ? { current } : {}),
    ordered,
    byFingerprint: new Map(recovered.map((item) => [item.fingerprint, item])),
    aggregateRevisions,
  };
}

function recoveryEnvelope(snapshot: CloudJsonObject | null | undefined): CloudPlanRecoveryEnvelope | undefined {
  if (!snapshot || snapshot.kind !== "maxpower_plan_recovery") return undefined;
  const row = object(snapshot);
  if (row.schemaVersion !== CLOUD_PLAN_RECOVERY_SCHEMA_VERSION || typeof row.artifactId !== "string") {
    throw new Error("cloud_plan_recovery_schema_unsupported");
  }
  const preview = object(row.planningPreview);
  const proposal = object(preview.proposal);
  const planRevision = object(proposal.planRevision);
  const goalCycle = object(proposal.goalCycle);
  const domain = validateRecoveryDomain(row.domain);
  if (
    proposal.kind !== "plan_proposal"
    || typeof planRevision.id !== "string"
    || !Array.isArray(planRevision.sessions)
    || typeof goalCycle.id !== "string"
    || !Array.isArray(domain.equipmentProfiles)
    || !Array.isArray(domain.recoveryConstraints)
    || !Array.isArray(domain.nutritionStrategies)
    || !Array.isArray(domain.customExercises)
    || !Array.isArray(domain.safetyConstraints)
  ) {
    throw new Error("cloud_plan_recovery_invalid");
  }
  return clone(snapshot) as unknown as CloudPlanRecoveryEnvelope;
}

function recoveryProfileEnvelope(snapshot: CloudJsonObject): CloudProfileRecoveryEnvelope | undefined {
  if (snapshot.kind !== "maxpower_profile_recovery") return undefined;
  const row = object(snapshot);
  if (row.schemaVersion !== CLOUD_PLAN_RECOVERY_SCHEMA_VERSION) {
    throw new Error("cloud_profile_recovery_schema_unsupported");
  }
  validateRecoveryDomain(row.domain);
  return clone(snapshot) as unknown as CloudProfileRecoveryEnvelope;
}

function validateRecoveryDomain(value: unknown): CloudRecoveryDomain {
  const domain = object(value);
  assertRevisioned(domain.profile, "profile");
  assertRevisioned(domain.goalContract, "goal_contract");
  assertRevisioned(domain.mandate, "coaching_mandate");
  if (
    !Array.isArray(domain.equipmentProfiles)
    || !Array.isArray(domain.recoveryConstraints)
    || !Array.isArray(domain.nutritionStrategies)
    || !Array.isArray(domain.customExercises)
    || !Array.isArray(domain.safetyConstraints)
  ) {
    throw new Error("cloud_profile_recovery_invalid");
  }
  return clone(domain) as unknown as CloudRecoveryDomain;
}

function createContextEvents(
  accountId: string,
  domain: CloudRecoveryDomain,
  goalCycle: GoalCycleData | undefined,
  plans: readonly RecoveryPlanVersion[],
  recordedAt: string,
  retainedAggregates: ReadonlySet<string>,
): DomainEvent[] {
  const goal = domain.goalContract.value;
  const goalRef = ref("goal_contract", goal.id);
  const cycle = goalCycle ? { ...goalCycle, goalContractRef: goalRef } : undefined;
  const cycleRef = cycle ? ref("goal_cycle", cycle.id) : undefined;
  const events: DomainEvent[] = [
    recoveryEvent(accountId, "user_profile.created", "user_profile", domain.profile.value.id, domain.profile.value, recordedAt),
    recoveryEvent(accountId, "goal_contract.created", "goal_contract", goal.id, goal, recordedAt),
    recoveryEvent(accountId, "coaching_mandate.created", "coaching_mandate", domain.mandate.value.id, domain.mandate.value, recordedAt),
  ];
  for (const item of domain.equipmentProfiles) {
    if (!retainedAggregates.has(`equipment_profile:${item.value.id}`)) {
      events.push(recoveryEvent(accountId, "equipment_profile.created", "equipment_profile", item.value.id, item.value, recordedAt));
    }
  }
  for (const item of domain.recoveryConstraints) {
    if (!retainedAggregates.has(`recovery_constraint:${item.value.id}`)) {
      events.push(recoveryEvent(accountId, "recovery_constraint.created", "recovery_constraint", item.value.id, item.value, recordedAt));
    }
  }
  for (const item of domain.customExercises) {
    if (!retainedAggregates.has(`custom_exercise:${item.value.id}`)) {
      events.push(recoveryEvent(accountId, "custom_exercise.created", "custom_exercise", item.value.id, item.value, recordedAt));
    }
  }
  for (const item of domain.safetyConstraints) {
    if (!retainedAggregates.has(`safety_constraint:${item.value.id}`)) {
      events.push(recoveryEvent(accountId, "safety_constraint.created", "safety_constraint", item.value.id, item.value, recordedAt));
    }
  }
  if (cycle) {
    events.push(recoveryEvent(accountId, "goal_cycle.created", "goal_cycle", cycle.id, cycle, recordedAt));
  }
  for (const item of domain.nutritionStrategies) {
    const strategy = {
      ...item.value,
      goalContractRef: goalRef,
      ...(item.value.goalCycleRef && cycleRef ? { goalCycleRef: cycleRef } : { goalCycleRef: undefined }),
    };
    events.push(recoveryEvent(accountId, "nutrition_strategy.created", "nutrition_strategy", strategy.id, strategy, recordedAt));
  }
  for (const plan of plans) {
    events.push(recoveryEvent(
      accountId,
      "plan.revised",
      "plan",
      plan.planRevision.id,
      plan.planRevision,
      recordedAt,
      recordedAt,
      plan.recoveredRevision,
    ));
  }
  return events;
}

function normalizePlan(
  envelope: CloudPlanRecoveryEnvelope,
  contextEnvelope: CloudPlanRecoveryEnvelope,
): PlanRevisionData {
  const goal = contextEnvelope.domain.goalContract.value;
  const cycle = contextEnvelope.planningPreview.proposal.goalCycle;
  return {
    ...envelope.planningPreview.proposal.planRevision,
    goalContractRef: ref("goal_contract", goal.id),
    goalCycleRef: ref("goal_cycle", cycle.id),
  };
}

function createWorkoutEvents(input: {
  accountId: string;
  workout: CloudWorkoutSession;
  results: readonly CloudResult[];
  planRevision: PlanRevisionData;
  planAggregateRevision: number;
  recordedAt: string;
}): { events: DomainEvent[]; resultCount: number } {
  const sessionId = textProperty(input.workout.data, "sessionPrescriptionId");
  const session = input.planRevision.sessions.find((candidate) => candidate.id === sessionId);
  if (!session) return { events: [], resultCount: 0 };
  const workoutId = textProperty(input.workout.data, "localWorkoutId") ?? input.workout.id;
  const mode = workoutMode(input.workout.data.mode);
  const events: DomainEvent[] = [recoveryEvent(
    input.accountId,
    "workout.started",
    "workout_session",
    workoutId,
    {
      prescriptionRef: {
        planId: input.planRevision.id,
        planRevision: input.planAggregateRevision,
        sessionPrescriptionId: session.id,
      },
      frozenPrescription: session,
      state: activeWorkoutState(mode, input.workout.startedAt),
    },
    input.recordedAt,
    input.workout.startedAt,
    1,
  )];
  let revision = 1;
  let resultCount = 0;
  const completedSetIds = new Set<string>();
  const skippedSetIds = new Set<string>();
  for (const result of [...input.results].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const prescribed = prescribedSet(session, textProperty(result.payload, "prescriptionSetId"));
    if (!prescribed) continue;
    if (result.kind === "workout_set") {
      const outcome = setOutcome(result, prescribed.task, prescribed.set);
      if (!outcome) continue;
      revision += 1;
      events.push(recoveryEvent(
        input.accountId,
        "workout.set_recorded",
        "workout_session",
        workoutId,
        { outcome },
        input.recordedAt,
        result.occurredAt,
        revision,
      ));
      completedSetIds.add(prescribed.set.id);
      resultCount += 1;
    } else if (result.kind === "workout_set_skipped") {
      revision += 1;
      events.push(recoveryEvent(
        input.accountId,
        "workout.set_skipped",
        "workout_session",
        workoutId,
        {
          skipped: {
            id: result.id,
            prescriptionSetId: prescribed.set.id,
            exerciseVariantId: prescribed.task.exerciseVariantId,
            reason: textProperty(result.payload, "reason") ?? "user_skipped",
            skippedAt: result.occurredAt,
          },
        },
        input.recordedAt,
        result.occurredAt,
        revision,
      ));
      skippedSetIds.add(prescribed.set.id);
      resultCount += 1;
    }
  }
  if (input.workout.status === "completed" && input.workout.completedAt) {
    const allSetIds = session.tasks.flatMap((task) => task.sets.map((set) => set.id));
    const status = input.workout.summary?.status === "partial" ? "partial" : "completed";
    revision += 1;
    events.push(recoveryEvent(
      input.accountId,
      "workout.completed",
      "workout_session",
      workoutId,
      {
        status,
        completedAt: input.workout.completedAt,
        outcome: {
          status,
          completedAt: input.workout.completedAt,
          completedWorkSets: completedSetIds.size,
          directSets: completedSetIds.size,
          incompletePrescriptionSetIds: allSetIds.filter((id) => !completedSetIds.has(id) && !skippedSetIds.has(id)),
          skippedPrescriptionSetIds: [...skippedSetIds],
          motionPacketRefs: [],
          dataCompleteness: "manual_only",
        },
      },
      input.recordedAt,
      input.workout.completedAt,
      revision,
    ));
  }
  return { events, resultCount };
}

function setOutcome(
  result: CloudResult,
  task: ExerciseTaskPrescription,
  set: ExerciseSetPrescription,
): SetOutcomeData | undefined {
  const asPlanned = result.payload.confirmAsPlanned === true;
  const actualReps = asPlanned ? set.targetReps?.max : finiteInteger(result.payload.actualReps);
  const actualDuration = asPlanned ? set.targetDuration : duration(result.payload.actualDuration);
  const actualDistance = asPlanned ? set.targetDistance : distance(result.payload.actualDistance);
  if (actualReps === undefined && actualDuration === undefined && actualDistance === undefined) return undefined;
  const loadValue = asPlanned ? set.targetLoad?.value : finiteNumber(result.payload.actualLoad);
  const actualLoad = loadValue === undefined || !set.targetLoad
    ? undefined
    : { value: loadValue, unit: set.targetLoad.unit };
  const actualRir = asPlanned ? set.targetRir : finiteNumber(result.payload.actualRir);
  return {
    id: result.id,
    prescriptionSetId: set.id,
    exerciseVariantId: task.exerciseVariantId,
    ...(actualLoad ? { actualLoad } : {}),
    ...(actualReps !== undefined ? { actualReps } : {}),
    ...(actualDuration ? { actualDuration } : {}),
    ...(actualDistance ? { actualDistance } : {}),
    ...(actualRir !== undefined ? { actualRir } : {}),
    completedAs: asPlanned ? "confirmed_as_planned" : "user_edited",
    source: "user_confirmed",
  };
}

async function commitRecoveryBatch(
  ledger: CoachLedger,
  accountId: string,
  intent: string,
  events: readonly DomainEvent[],
  recordedAt: string,
  expectedRevisions = uniqueAggregateRefs(events),
): Promise<void> {
  await ledger.commit({
    kind: "domain",
    userId: accountId,
    actorId: SYNC_ACTOR.id,
    intent: `cloud_canonical_recovery:${intent}`,
    expectedRevisions,
    domainEvents: events,
    idempotencyKey: `cloud-canonical-recovery:${intent}`,
    recordedAt,
  });
}

function recoveryEvent(
  accountId: string,
  name: DomainEvent["name"],
  kind: DomainAggregateKind,
  aggregateId: string,
  payload: unknown,
  recordedAt: string,
  occurredAt = recordedAt,
  revision = 1,
): DomainEvent {
  const identity = `${name}:${aggregateId}:${revision}`;
  return {
    id: `cloud-recovery:${identity}`,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    name,
    userId: accountId,
    aggregate: { kind, id: aggregateId, revision },
    actor: SYNC_ACTOR,
    deviceId: "cloud-canonical",
    occurredAt: validTimestamp(occurredAt, "cloud_event_occurred_at"),
    recordedAt,
    timezoneOffsetMinutes: 0,
    provenance: { source: "sync", confidence: "confirmed" },
    evidenceRefs: [],
    causationId: `cloud-canonical:${identity}`,
    correlationId: `cloud-canonical:${aggregateId}`,
    payload,
  } as DomainEvent;
}

function stripCloudOwnedDomain(
  snapshot: LedgerSnapshot,
  accountId: string,
  removedEventIds: ReadonlySet<string>,
): LedgerSnapshot {
  return {
    ...snapshot,
    domainEvents: snapshot.domainEvents.filter((event) =>
      event.userId !== accountId || !CLOUD_OWNED_KINDS.has(event.aggregate.kind)
    ),
    aggregateRevisions: snapshot.aggregateRevisions.filter((state) =>
      state.userId !== accountId || !CLOUD_OWNED_KINDS.has(state.kind)
    ),
    domainIdempotency: snapshot.domainIdempotency.filter((record) =>
      record.userId !== accountId
      || !record.aggregateRevisions.some((aggregate) => CLOUD_OWNED_KINDS.has(aggregate.kind))
    ),
    outbox: snapshot.outbox.filter((entry) => !removedEventIds.has(entry.domainEventId)),
  };
}

function uniqueAggregateRefs(events: readonly DomainEvent[]): DomainAggregateRef[] {
  const refs = new Map<string, DomainAggregateRef>();
  for (const event of events) {
    const key = `${event.aggregate.kind}:${event.aggregate.id}`;
    if (!refs.has(key)) refs.set(key, { ...event.aggregate, revision: 0 });
  }
  return [...refs.values()];
}

function ref<K extends DomainAggregateKind>(kind: K, id: string): DomainAggregateRef<K> {
  return { kind, id, revision: 1 };
}

function activeWorkoutState(mode: WorkoutExecutionMode, startedAt: string) {
  return {
    status: "active" as const,
    mode,
    policy: { id: "cloud-recovery-policy", version: "1", resumeWindowHours: 24 },
    transitions: [{
      from: "planned" as const,
      to: "active" as const,
      reason: "cloud_canonical_recovery",
      actor: SYNC_ACTOR,
      occurredAt: startedAt,
      idempotencyKey: `cloud-recovery:start:${startedAt}`,
    }],
  };
}

function prescribedSet(
  session: SessionPrescriptionData,
  setId: string | undefined,
): { task: ExerciseTaskPrescription; set: ExerciseSetPrescription } | undefined {
  if (!setId) return undefined;
  for (const task of session.tasks) {
    const set = task.sets.find((candidate) => candidate.id === setId);
    if (set) return { task, set };
  }
  return undefined;
}

function workoutMode(value: unknown): WorkoutExecutionMode {
  return value === "coach_monitor" ? "coach_monitor" : "record_only";
}

function duration(value: unknown): ExerciseSetPrescription["targetDuration"] {
  const row = optionalObject(value);
  if (!row || typeof row.value !== "number") return undefined;
  if (row.unit !== "seconds" && row.unit !== "minutes" && row.unit !== "hours") return undefined;
  return { value: row.value, unit: row.unit };
}

function distance(value: unknown): ExerciseSetPrescription["targetDistance"] {
  const row = optionalObject(value);
  if (!row || typeof row.value !== "number") return undefined;
  if (row.unit !== "m" && row.unit !== "km") return undefined;
  return { value: row.value, unit: row.unit };
}

function assertProjectionOwner(projection: CloudCanonicalProjection, accountId: string): void {
  if (
    projection.accountId !== accountId
    || projection.profile.accountId !== accountId
    || projection.plans.some((plan) => plan.accountId !== accountId)
    || projection.workoutSessions.some((workout) => workout.accountId !== accountId)
    || projection.results.some((result) => result.accountId !== accountId)
  ) {
    throw new Error("cloud_product_account_mismatch");
  }
}

function assertRevisioned(value: unknown, label: string): void {
  const row = object(value);
  const payload = object(row.value);
  if (!Number.isInteger(row.revision) || (row.revision as number) < 1 || typeof payload.id !== "string") {
    throw new Error(`cloud_plan_recovery_invalid_${label}`);
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("cloud_plan_recovery_invalid");
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function textProperty(objectValue: CloudJsonObject, key: string): string | undefined {
  const value = objectValue[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  const number = finiteNumber(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function validTimestamp(value: string, code: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error(code);
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function byStartedAt(left: CloudWorkoutSession, right: CloudWorkoutSession): number {
  return left.startedAt.localeCompare(right.startedAt);
}
