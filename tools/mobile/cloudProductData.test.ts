import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { CoachApplication, InMemoryCoachLedger } from "../../src/coach";
import {
  CLOUD_CANONICAL_RESOURCE_KINDS,
  CloudConfirmedProductBridge,
  CloudProductDataClient,
  CloudProductDataCoordinator,
  CloudProductDataError,
  InMemoryCloudProductDataCache,
  createCloudPlanRecoverySnapshot,
  createCloudProfileRecoverySnapshot,
  hydrateCloudCanonicalProjection,
  projectCloudProductDataForProductShell,
  type CloudCanonicalProjection,
  type CloudProfile,
  type CloudPlan,
  type CloudResult,
  type CloudWorkoutSession,
} from "../../src/mobile/product-data";
import { SQLiteCloudProductDataCache } from "../../src/mobile/native/SQLiteCloudProductDataCache";

const PROFILE: CloudProfile = {
  accountId: "account-alice",
  data: {},
  displayName: "Alice",
  locale: "zh-CN",
  timeZone: "Asia/Shanghai",
  unitSystem: "metric",
  revision: 1,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
};

const PLAN: CloudPlan = {
  id: "plan-1",
  accountId: PROFILE.accountId,
  title: "力量计划",
  status: "draft",
  currentVersionId: "plan-version-1",
  publishedVersionId: null,
  revision: 1,
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
  versions: [{
    id: "plan-version-1",
    planId: "plan-1",
    number: 1,
    snapshot: { days: 3 },
    createdAt: "2026-08-10T00:00:00.000Z",
    publishedAt: null,
  }],
};

const WORKOUT: CloudWorkoutSession = {
  id: "workout-1",
  accountId: PROFILE.accountId,
  planId: PLAN.id,
  planVersionId: PLAN.currentVersionId,
  planSnapshot: { days: 3 },
  title: "推日",
  status: "in_progress",
  data: { sets: 4 },
  summary: null,
  notes: null,
  mediaReferences: [],
  startedAt: "2026-08-10T01:00:00.000Z",
  completedAt: null,
  revision: 1,
  createdAt: "2026-08-10T01:00:00.000Z",
  updatedAt: "2026-08-10T01:00:00.000Z",
};

const RESULT: CloudResult = {
  id: "result-1",
  accountId: PROFILE.accountId,
  kind: "set_summary",
  workoutSessionId: WORKOUT.id,
  payload: { completedSets: 4 },
  provenance: { source: "confirmed_user_input" },
  mediaReferences: [],
  occurredAt: "2026-08-10T02:00:00.000Z",
  revision: 1,
  createdAt: "2026-08-10T02:00:00.000Z",
  updatedAt: "2026-08-10T02:00:00.000Z",
};

test("startup rebuilds the complete canonical projection from authenticated cloud pages", async () => {
  const requests: RequestRecord[] = [];
  let token = "service-jwt-1";
  const responses = new Map<string, Response[]>([
    ["/v1/me", [json(PROFILE)]],
    ["/v1/plans?limit=100", [json({ data: [PLAN], nextCursor: "plans-page-2" })]],
    ["/v1/plans?limit=100&cursor=plans-page-2", [json({ data: [{ ...PLAN, id: "plan-2", title: "恢复计划" }], nextCursor: null })]],
    ["/v1/workout-sessions?limit=100", [json({ data: [WORKOUT], nextCursor: null })]],
    ["/v1/results?limit=100", [json({ data: [RESULT], nextCursor: null })]],
  ]);
  const client = clientWithResponses(responses, requests, () => token);
  const cache = new InMemoryCloudProductDataCache();
  const coordinator = new CloudProductDataCoordinator({ accountId: PROFILE.accountId, client, cache });

  const projection = await coordinator.bootstrap();
  token = "service-jwt-2";

  assert.equal(projection.profile.accountId, PROFILE.accountId);
  assert.deepEqual(projection.plans.map(({ id }) => id), ["plan-1", "plan-2"]);
  assert.deepEqual(projection.workoutSessions, [WORKOUT]);
  assert.deepEqual(projection.results, [RESULT]);
  assert.deepEqual(await cache.read(PROFILE.accountId), projection);
  assert.equal(coordinator.currentState().status, "ready");
  assert.ok(requests.every(({ init }) => new Headers(init.headers).get("authorization") === "Bearer service-jwt-1"));

  responses.set("/v1/me", [json({ ...PROFILE, revision: 2 })]);
  responses.set("/v1/plans?limit=100", [json({ data: [], nextCursor: null })]);
  responses.set("/v1/workout-sessions?limit=100", [json({ data: [], nextCursor: null })]);
  responses.set("/v1/results?limit=100", [json({ data: [], nextCursor: null })]);
  await coordinator.retry();
  assert.equal(new Headers(requests.at(-1)?.init.headers).get("authorization"), "Bearer service-jwt-2");
});

test("confirmed resource writes carry idempotency/revision and update cache only after server success", async () => {
  const requests: RequestRecord[] = [];
  const projection = canonicalProjection();
  const updatedProfile = { ...PROFILE, displayName: "Alice Chen", revision: 2 };
  const publishedPlan = { ...PLAN, status: "published" as const, publishedVersionId: PLAN.currentVersionId, revision: 2 };
  const completedWorkout = {
    ...WORKOUT,
    status: "completed" as const,
    summary: { totalSets: 4 },
    completedAt: "2026-08-10T03:00:00.000Z",
    revision: 2,
  };
  const updatedResult = { ...RESULT, payload: { completedSets: 4, confirmed: true }, revision: 2 };
  const responses = canonicalBootstrapResponses(projection);
  responses.set("/v1/me", [json(PROFILE), json(updatedProfile)]);
  responses.set(`/v1/plans/${PLAN.id}/publish`, [json(publishedPlan)]);
  responses.set(`/v1/workout-sessions/${WORKOUT.id}/complete`, [json(completedWorkout)]);
  responses.set(`/v1/results/${RESULT.id}`, [json(updatedResult)]);
  const cache = new InMemoryCloudProductDataCache();
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, requests),
    cache,
  });
  await coordinator.bootstrap();

  await coordinator.patchProfile({
    patch: { displayName: "Alice Chen" },
    expectedRevision: 1,
    idempotencyKey: "profile-name-1",
  });
  await coordinator.publishPlan({ planId: PLAN.id, expectedRevision: 1, idempotencyKey: "publish-1" });
  await coordinator.completeWorkoutSession({
    workoutSessionId: WORKOUT.id,
    summary: { totalSets: 4 },
    completedAt: "2026-08-10T03:00:00.000Z",
    expectedRevision: 1,
    idempotencyKey: "complete-1",
  });
  await coordinator.patchResult({
    resultId: RESULT.id,
    patch: { payload: { completedSets: 4, confirmed: true } },
    expectedRevision: 1,
    idempotencyKey: "result-confirm-1",
  });

  const writes = requests.filter(({ init }) => init.method !== "GET");
  assert.deepEqual(writes.map(({ path }) => path), [
    "/v1/me",
    "/v1/plans/plan-1/publish",
    "/v1/workout-sessions/workout-1/complete",
    "/v1/results/result-1",
  ]);
  assert.deepEqual(writes.map(({ init }) => new Headers(init.headers).get("idempotency-key")), [
    "profile-name-1",
    "publish-1",
    "complete-1",
    "result-confirm-1",
  ]);
  assert.ok(writes.every(({ init }) => new Headers(init.headers).get("if-match") === '"1"'));
  const cached = await cache.read(PROFILE.accountId);
  assert.equal(cached?.profile.revision, 2);
  assert.equal(cached?.plans[0]?.status, "published");
  assert.equal(cached?.workoutSessions[0]?.status, "completed");
  assert.deepEqual(cached?.results[0]?.payload, updatedResult.payload);
  assert.doesNotMatch(
    JSON.stringify(writes.map(({ init }) => init.body)),
    /CoachSession|Message|AgentRun|coachSessions|messages|agentRuns/,
  );
});

test("revision conflicts are explicit, preserve the last cache, and recover through a cloud rebuild", async () => {
  const projection = canonicalProjection();
  const cache = new InMemoryCloudProductDataCache();
  const requests: RequestRecord[] = [];
  const responses = canonicalBootstrapResponses(projection);
  responses.set(`/v1/plans/${PLAN.id}`, [
    json({ error: { code: "revision_conflict", message: "Expected revision 2." } }, 409),
  ]);
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, requests),
    cache,
  });
  await coordinator.bootstrap();

  await assert.rejects(
    () => coordinator.patchPlan({
      planId: PLAN.id,
      patch: { title: "本机旧编辑" },
      expectedRevision: 1,
      idempotencyKey: "stale-plan-edit",
    }),
    (cause) => cause instanceof CloudProductDataError && cause.code === "revision_conflict",
  );
  assert.deepEqual(await cache.read(PROFILE.accountId), projection);
  const failed = coordinator.currentState();
  assert.equal(failed.status, "recoverable_error");
  if (failed.status === "recoverable_error") assert.equal(failed.reason, "revision_conflict");

  const serverPlan = { ...PLAN, title: "云端较新编辑", revision: 2 };
  responses.set("/v1/me", [json(PROFILE)]);
  responses.set("/v1/plans?limit=100", [json({ data: [serverPlan], nextCursor: null })]);
  responses.set("/v1/workout-sessions?limit=100", [json({ data: [WORKOUT], nextCursor: null })]);
  responses.set("/v1/results?limit=100", [json({ data: [RESULT], nextCursor: null })]);
  const recovered = await coordinator.retry();
  assert.equal(recovered.plans[0]?.title, "云端较新编辑");
  assert.equal(coordinator.currentState().status, "ready");
});

test("network failures never become a successful local write", async () => {
  const cache = new InMemoryCloudProductDataCache();
  const projection = canonicalProjection();
  await cache.replace({ accountId: PROFILE.accountId, projection });
  const client = new CloudProductDataClient({
    baseUrl: "https://api.maxpower.example",
    accessToken: () => "service-jwt",
    fetch: async () => { throw new TypeError("network down"); },
  });
  const coordinator = new CloudProductDataCoordinator({ accountId: PROFILE.accountId, client, cache });

  await assert.rejects(
    () => coordinator.patchProfile({
      patch: { displayName: "Not Saved" },
      expectedRevision: 1,
      idempotencyKey: "offline-profile",
    }),
    (cause) => cause instanceof CloudProductDataError && cause.code === "network_unavailable",
  );
  assert.deepEqual(await cache.read(PROFILE.accountId), projection);
  assert.equal(coordinator.currentState().status, "recoverable_error");
});

test("cloud-first bridge never advances the local authoritative projection after an HTTP conflict", async () => {
  const projection = canonicalProjection();
  const responses = canonicalBootstrapResponses(projection);
  responses.set("/v1/me", [
    json(PROFILE),
    json({ error: { code: "revision_conflict", message: "Profile changed on another device." } }, 409),
  ]);
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, []),
    cache: new InMemoryCloudProductDataCache(),
  });
  await coordinator.bootstrap();
  const bridge = new CloudConfirmedProductBridge(coordinator);
  let localAuthoritativeRevision = 1;

  await assert.rejects(
    () => bridge.patchProfileThen({
      patch: { locale: "en-US" },
      idempotencyKey: "ui-profile-confirm",
      commitLocal: async () => { localAuthoritativeRevision = 2; },
    }),
    (cause) => cause instanceof CloudProductDataError && cause.code === "revision_conflict",
  );

  assert.equal(localAuthoritativeRevision, 1);
  assert.equal(coordinator.currentProjection()?.profile.revision, 1);
  assert.equal(coordinator.currentState().status, "recoverable_error");
});

test("同一计划复用的本地 set id 不会把新训练结果写回旧 workout", async () => {
  const firstWorkout = {
    ...WORKOUT,
    data: { localWorkoutId: "local-workout-a" },
  };
  const secondWorkout = {
    ...WORKOUT,
    id: "workout-2",
    data: { localWorkoutId: "local-workout-b" },
  };
  const firstResult = {
    ...RESULT,
    workoutSessionId: firstWorkout.id,
    payload: { localResultId: "shared-prescription-set", reps: 8 },
  };
  const secondResult = {
    ...RESULT,
    id: "result-2",
    workoutSessionId: secondWorkout.id,
    payload: { localResultId: "shared-prescription-set", reps: 10 },
  };
  const projection = canonicalProjection({
    workoutSessions: [firstWorkout, secondWorkout],
    results: [firstResult],
  });
  const requests: RequestRecord[] = [];
  const responses = canonicalBootstrapResponses(projection);
  responses.set("/v1/results", [json(secondResult, 201)]);
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, requests),
    cache: new InMemoryCloudProductDataCache(),
  });
  await coordinator.bootstrap();

  await new CloudConfirmedProductBridge(coordinator).confirmResultThen({
    localWorkoutId: "local-workout-b",
    localResultId: "shared-prescription-set",
    kind: "set_summary",
    payload: { reps: 10 },
    occurredAt: "2026-08-10T03:00:00.000Z",
    idempotencyKey: "result-workout-b",
    commitLocal: async () => undefined,
  });

  const write = requests.find(({ init }) => init.method === "POST");
  assert.equal(write?.path, "/v1/results");
  assert.equal(JSON.parse(String(write?.init.body)).workoutSessionId, secondWorkout.id);
  assert.deepEqual(coordinator.currentProjection()?.results.map(({ id }) => id), ["result-1", "result-2"]);
});

test("动作分析等独立结构化结果无需伪造 workout 关联即可跨设备保存", async () => {
  const projection = canonicalProjection({ results: [] });
  const analysisResult: CloudResult = {
    ...RESULT,
    id: "result-analysis",
    kind: "motion_analysis",
    workoutSessionId: null,
    payload: { localResultId: "analysis-local-1", repCount: 8, amplitude: "full" },
    provenance: { source: "confirmed_motion_analysis", schemaVersion: 1 },
  };
  const requests: RequestRecord[] = [];
  const responses = canonicalBootstrapResponses(projection);
  responses.set("/v1/results", [json(analysisResult, 201)]);
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, requests),
    cache: new InMemoryCloudProductDataCache(),
  });
  await coordinator.bootstrap();

  await new CloudConfirmedProductBridge(coordinator).confirmResultThen({
    localResultId: "analysis-local-1",
    kind: "motion_analysis",
    payload: { repCount: 8, amplitude: "full" },
    provenance: { source: "confirmed_motion_analysis", schemaVersion: 1 },
    occurredAt: analysisResult.occurredAt,
    idempotencyKey: "analysis-result",
    commitLocal: async () => undefined,
  });

  const write = requests.find(({ init }) => init.method === "POST");
  const body = JSON.parse(String(write?.init.body)) as Record<string, unknown>;
  assert.equal("workoutSessionId" in body, false);
  assert.deepEqual(projectCloudProductDataForProductShell(coordinator.currentProjection()!).results[0], {
    id: analysisResult.id,
    kind: analysisResult.kind,
    workoutSessionId: null,
    payload: analysisResult.payload,
    provenance: analysisResult.provenance,
    mediaReferences: [],
    occurredAt: analysisResult.occurredAt,
    revision: analysisResult.revision,
  });
});

test("并发确认的云写入都保留在 canonical cache 中", async () => {
  const projection = canonicalProjection();
  const updatedProfile = { ...PROFILE, displayName: "Alice Chen", revision: 2 };
  const additionalPlan = {
    ...PLAN,
    id: "plan-2",
    title: "恢复计划",
    currentVersionId: "plan-version-2",
    versions: [{ ...PLAN.versions[0]!, id: "plan-version-2", planId: "plan-2" }],
  };
  const responses = canonicalBootstrapResponses(projection);
  responses.set("/v1/me", [json(PROFILE), json(updatedProfile)]);
  responses.set("/v1/plans", [json(additionalPlan, 201)]);
  const cache = new InMemoryCloudProductDataCache();
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, []),
    cache,
  });
  await coordinator.bootstrap();

  await Promise.all([
    coordinator.patchProfile({
      patch: { displayName: "Alice Chen" },
      expectedRevision: 1,
      idempotencyKey: "profile-concurrent",
    }),
    coordinator.createPlan({
      title: "恢复计划",
      snapshot: { localPlanId: "local-plan-2" },
      idempotencyKey: "plan-concurrent",
    }),
  ]);

  const cached = await cache.read(PROFILE.accountId);
  assert.equal(cached?.profile.displayName, "Alice Chen");
  assert.deepEqual(cached?.plans.map(({ id }) => id), ["plan-1", "plan-2"]);
});

test("a cross-account cloud response is rejected before replacing the account cache", async () => {
  const cache = new InMemoryCloudProductDataCache();
  const responses = canonicalBootstrapResponses({
    ...canonicalProjection(),
    profile: { ...PROFILE, accountId: "account-bob" },
  });
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(responses, []),
    cache,
  });

  await assert.rejects(() => coordinator.bootstrap(), /cloud_product_account_mismatch/);
  assert.equal(await cache.read(PROFILE.accountId), null);
});

test("canonical cloud types expose only profile, plan, workout session, and result", () => {
  assert.deepEqual(CLOUD_CANONICAL_RESOURCE_KINDS, ["profile", "plan", "workout_session", "result"]);
  const serialized = JSON.stringify(canonicalProjection());
  assert.doesNotMatch(serialized, /CoachSession|Message|AgentRun|coachSessions|messages|agentRuns/);
});

test("native canonical projection cache is account-keyed SQLite, never a second source of truth", async () => {
  const database = new FakeCloudCacheDatabase();
  const cache = new SQLiteCloudProductDataCache(database);
  const projection = canonicalProjection();

  await cache.replace({ accountId: PROFILE.accountId, projection });
  assert.deepEqual(await cache.read(PROFILE.accountId), projection);
  assert.equal(await cache.read("account-bob"), null);
  await assert.rejects(
    () => cache.replace({ accountId: "account-bob", projection }),
    /account_mismatch/,
  );
  await cache.clear(PROFILE.accountId);
  assert.equal(await cache.read(PROFILE.accountId), null);
  assert.equal(database.initialized, true);
});

test("new-device bootstrap reaches the ProductShell-facing profile, plan, workout, and result projection", async () => {
  const projection = canonicalProjection();
  const coordinator = new CloudProductDataCoordinator({
    accountId: PROFILE.accountId,
    client: clientWithResponses(canonicalBootstrapResponses(projection), []),
    cache: new InMemoryCloudProductDataCache(),
  });
  const shell = projectCloudProductDataForProductShell(await coordinator.bootstrap());

  assert.deepEqual(shell.profile, {
    displayName: "Alice",
    locale: "zh-CN",
    timeZone: "Asia/Shanghai",
    unitSystem: "metric",
    revision: 1,
  });
  assert.deepEqual(shell.plans, [{ id: "plan-1", title: "力量计划", status: "draft", revision: 1 }]);
  assert.deepEqual(shell.workouts, [{
    id: "workout-1",
    title: "推日",
    status: "in_progress",
    startedAt: WORKOUT.startedAt,
    completedAt: null,
    revision: 1,
  }]);
  assert.deepEqual(shell.results, [{
    id: "result-1",
    kind: "set_summary",
    workoutSessionId: "workout-1",
    payload: RESULT.payload,
    provenance: RESULT.provenance,
    mediaReferences: [],
    occurredAt: RESULT.occurredAt,
    revision: 1,
  }]);
  assert.doesNotMatch(JSON.stringify(shell), /CoachSession|Message|AgentRun|messages|agentRuns/);

  const runtimeSource = readFileSync(resolve(process.cwd(), "src/mobile/runtime/createMobileAccountRuntime.ts"), "utf8");
  const appSource = readFileSync(resolve(process.cwd(), "src/mobile/ui/MaxPowerApp.tsx"), "utf8");
  const shellSource = readFileSync(resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8");
  assert.doesNotMatch(runtimeSource, /cloudProductData\.bootstrap/);
  assert.match(runtimeSource, /openWebMaxPowerPersistence/);
  assert.match(runtimeSource, /confirmedProduct: new LocalConfirmedProductBridge/);
  assert.match(appSource, /confirmedProduct=\{runtime\.confirmedProduct\}/);
  assert.doesNotMatch(shellSource, /projectCloudProductDataForProductShell/);
  assert.match(shellSource, /isEnergyRebalanceChoice/);
  assert.match(shellSource, /mobile-coach-preview:confirm/);
  for (const method of [
    "patchProfileThen",
    "publishPlanThen",
    "startWorkoutThen",
    "updateWorkoutThen",
    "completeWorkoutThen",
    "confirmResultThen",
  ]) assert.match(shellSource, new RegExp(`cloudConfirmed\\.${method}`));
});

test("a new device hydrates cloud canonical facts into the main Coach and ProductShell projection", async () => {
  let sourceSequence = 0;
  const sourceLedger = new InMemoryCoachLedger();
  const source = new CoachApplication(sourceLedger, {
    now: () => "2026-08-10T08:00:00.000Z",
    nextId: (prefix) => `${prefix}-source-${++sourceSequence}`,
  });
  await source.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: PROFILE.accountId,
      actor: { kind: "user", id: PROFILE.accountId },
      deviceId: "source-phone",
      occurredAt: "2026-08-10T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "source-bootstrap",
    },
    profile: {
      id: "profile-alice",
      trainingExperience: "beginner",
      locale: "zh-CN",
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{
        id: "home",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      }],
    },
    goalContract: {
      id: "goal-alice",
      primaryGoal: "hypertrophy",
      horizon: { startDate: "2026-08-10", endDate: "2026-11-01" },
      status: "active",
    },
    mandate: { id: "mandate-alice", mode: "collaborative" },
  });
  await source.executeDomainCommand({
    type: "equipment_profile.revise",
    meta: {
      userId: PROFILE.accountId,
      actor: { kind: "user", id: PROFILE.accountId },
      deviceId: "source-phone",
      occurredAt: "2026-08-10T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "source-equipment",
    },
    equipmentProfileId: "equipment-source",
    expectedRevision: 0,
    equipmentProfile: { id: "equipment-source", name: "Source gym", equipmentIds: ["barbell"] },
  });
  await source.executeDomainCommand({
    type: "safety_constraint.revise",
    meta: {
      userId: PROFILE.accountId,
      actor: { kind: "user", id: PROFILE.accountId },
      deviceId: "source-phone",
      occurredAt: "2026-08-10T08:00:00.000Z",
      timezoneOffsetMinutes: 0,
      idempotencyKey: "source-safety",
    },
    safetyConstraintId: "safety-source",
    expectedRevision: 0,
    safetyConstraint: {
      id: "safety-source",
      disposition: "clear",
      reasons: [],
      stopSignals: [],
      professionalConstraints: [],
    },
  });
  const proposal = await source.materializeGoalCycle({
    userId: PROFILE.accountId,
    currentDate: "2026-08-10",
    trigger: "initial_plan",
    idempotencyKey: "source-plan",
  });
  assert.equal(proposal.kind, "plan_proposal");
  if (proposal.kind !== "plan_proposal") throw new Error("plan proposal required");
  const sourceDomain = await source.readDomainProjection({ userId: PROFILE.accountId });
  assert.doesNotMatch(JSON.stringify(createCloudProfileRecoverySnapshot({
    ...sourceDomain,
    permissions: {
      revision: 1,
      value: {
        id: "source-device-permissions",
        camera: "granted",
        health: "granted",
        notifications: "granted",
        remoteLlm: "granted",
        cloudSync: "granted",
        mediaUpload: "granted",
      },
    },
  })), /source-device-permissions|permissions/);
  const session = proposal.planRevision.sessions.find((candidate) =>
    candidate.tasks.some((task) => task.sets.some((set) =>
      set.targetReps !== undefined || set.targetDuration !== undefined || set.targetDistance !== undefined
    ))
  );
  assert.ok(session);
  const prescribedSet = session.tasks[0]?.sets[0];
  assert.ok(prescribedSet);
  const recoverySnapshot = createCloudPlanRecoverySnapshot({
    artifactId: "preview-source",
    planningPreview: {
      status: "awaiting_confirmation",
      proposal,
      request: { currentDate: "2026-08-10", trigger: "initial_plan" },
    },
    domain: sourceDomain,
  });
  const historicalSession = {
    ...session,
    id: "historical-session",
    tasks: session.tasks.map((task, taskIndex) => ({
      ...task,
      id: `historical-task-${taskIndex}`,
      sets: task.sets.map((set, setIndex) => ({ ...set, id: `historical-set-${taskIndex}-${setIndex}` })),
    })),
  };
  const historicalSnapshot = createCloudPlanRecoverySnapshot({
    artifactId: "preview-historical",
    planningPreview: {
      status: "awaiting_confirmation",
      proposal: {
        ...proposal,
        planRevision: { ...proposal.planRevision, sessions: [historicalSession] },
      },
      request: { currentDate: "2026-08-03", trigger: "initial_plan" },
    },
    domain: sourceDomain,
  });
  const cloudPlan: CloudPlan = {
    ...PLAN,
    id: "cloud-plan-recovery",
    status: "published",
    currentVersionId: "cloud-plan-recovery-v1",
    publishedVersionId: "cloud-plan-recovery-v1",
    versions: [{
      id: "cloud-plan-recovery-v0",
      planId: "cloud-plan-recovery",
      number: 1,
      snapshot: historicalSnapshot,
      createdAt: "2026-08-03T08:01:00.000Z",
      publishedAt: "2026-08-03T08:01:00.000Z",
    }, {
      id: "cloud-plan-recovery-v1",
      planId: "cloud-plan-recovery",
      number: 2,
      snapshot: recoverySnapshot,
      createdAt: "2026-08-10T08:01:00.000Z",
      publishedAt: "2026-08-10T08:01:00.000Z",
    }],
  };
  const historicalWorkout: CloudWorkoutSession = {
    ...WORKOUT,
    id: "cloud-workout-historical",
    planId: cloudPlan.id,
    planVersionId: "cloud-plan-recovery-v0",
    planSnapshot: historicalSnapshot,
    status: "completed",
    data: {
      localWorkoutId: "local-workout-historical",
      sessionPrescriptionId: historicalSession.id,
      mode: "record_only",
    },
    summary: { status: "completed" },
    startedAt: "2026-08-03T09:00:00.000Z",
    completedAt: "2026-08-03T10:00:00.000Z",
  };
  const historicalResult: CloudResult = {
    ...RESULT,
    id: "cloud-result-historical",
    kind: "workout_set",
    workoutSessionId: historicalWorkout.id,
    payload: {
      localResultId: historicalSession.tasks[0]!.sets[0]!.id,
      prescriptionSetId: historicalSession.tasks[0]!.sets[0]!.id,
      confirmAsPlanned: true,
    },
    occurredAt: "2026-08-03T09:30:00.000Z",
  };
  const cloudWorkout: CloudWorkoutSession = {
    ...WORKOUT,
    id: "cloud-workout-recovery",
    planId: cloudPlan.id,
    planVersionId: cloudPlan.currentVersionId,
    planSnapshot: recoverySnapshot,
    status: "completed",
    data: {
      localWorkoutId: "local-workout-recovery",
      sessionPrescriptionId: session.id,
      mode: "record_only",
    },
    summary: { status: "completed" },
    startedAt: "2026-08-10T09:00:00.000Z",
    completedAt: "2026-08-10T10:00:00.000Z",
  };
  const cloudResult: CloudResult = {
    ...RESULT,
    id: "cloud-result-recovery",
    kind: "workout_set",
    workoutSessionId: cloudWorkout.id,
    payload: {
      localResultId: prescribedSet.id,
      prescriptionSetId: prescribedSet.id,
      confirmAsPlanned: true,
    },
    occurredAt: "2026-08-10T09:30:00.000Z",
  };
  const latestProfileDomain = {
    ...sourceDomain,
    profile: sourceDomain.profile
      ? {
          ...sourceDomain.profile,
          revision: sourceDomain.profile.revision + 1,
          value: { ...sourceDomain.profile.value, trainingExperience: "advanced" as const },
        }
      : undefined,
  };
  const projection: CloudCanonicalProjection = {
    accountId: PROFILE.accountId,
    profile: { ...PROFILE, data: createCloudProfileRecoverySnapshot(latestProfileDomain) },
    plans: [cloudPlan],
    workoutSessions: [historicalWorkout, cloudWorkout],
    results: [historicalResult, cloudResult],
    fetchedAt: "2026-08-10T11:00:00.000Z",
  };
  const restoredLedger = new InMemoryCoachLedger();

  await hydrateCloudCanonicalProjection({
    accountId: PROFILE.accountId,
    ledger: restoredLedger,
    projection,
  });

  const restored = new CoachApplication(restoredLedger, {
    now: () => "2026-08-10T11:00:00.000Z",
    nextId: (prefix) => `${prefix}-restored`,
  });
  const domain = await restored.readDomainProjection({ userId: PROFILE.accountId });
  assert.equal(domain.profile?.value.id, "profile-alice");
  assert.equal(domain.profile?.value.trainingExperience, "advanced");
  assert.equal(domain.plan?.value.id, proposal.planRevision.id);
  assert.deepEqual(domain.workouts.map((workout) => workout.id), [
    "local-workout-historical",
    "local-workout-recovery",
  ]);
  assert.equal(domain.workouts[0]?.setOutcomes[0]?.prescriptionSetId, historicalSession.tasks[0]!.sets[0]!.id);
  assert.equal(domain.workouts[1]?.setOutcomes[0]?.prescriptionSetId, prescribedSet.id);
  assert.ok(domain.workouts.every((workout) => workout.status === "completed"));
  const screen = await restored.readProductProjection({
    userId: PROFILE.accountId,
    date: "2026-08-10",
    timezoneOffsetMinutes: 0,
    calendarMode: "week",
    calendarAnchorDate: "2026-08-10",
  });
  assert.equal(screen.source.planId, proposal.planRevision.id);
  assert.ok(screen.plan.currentWeek.length > 0);
  assert.equal(screen.progress.completedWorkoutCount, 2);

  const deletedPlanLedger = new InMemoryCoachLedger();
  await hydrateCloudCanonicalProjection({
    accountId: PROFILE.accountId,
    ledger: deletedPlanLedger,
    projection: {
      ...projection,
      plans: [],
      workoutSessions: [historicalWorkout],
      results: [historicalResult],
    },
  });
  const afterPlanDeletion = new CoachApplication(deletedPlanLedger, {
    now: () => "2026-08-10T11:00:00.000Z",
    nextId: (prefix) => `${prefix}-deleted-plan`,
  });
  const deletedPlanDomain = await afterPlanDeletion.readDomainProjection({ userId: PROFILE.accountId });
  assert.equal(deletedPlanDomain.profile?.value.id, "profile-alice");
  assert.equal(deletedPlanDomain.plan, undefined);
  assert.equal(deletedPlanDomain.workouts[0]?.setOutcomes.length, 1);
  const deletedPlanScreen = await afterPlanDeletion.readProductProjection({
    userId: PROFILE.accountId,
    date: "2026-08-10",
    timezoneOffsetMinutes: 0,
    calendarMode: "week",
    calendarAnchorDate: "2026-08-10",
  });
  assert.equal(deletedPlanScreen.progress.completedWorkoutCount, 1);

  const profileOnlyLedger = new InMemoryCoachLedger();
  await hydrateCloudCanonicalProjection({
    accountId: PROFILE.accountId,
    ledger: profileOnlyLedger,
    projection: {
      ...projection,
      profile: {
        ...PROFILE,
        data: createCloudProfileRecoverySnapshot(sourceDomain),
      },
      plans: [],
      workoutSessions: [],
      results: [],
    },
  });
  const profileOnly = new CoachApplication(profileOnlyLedger, {
    now: () => "2026-08-10T11:00:00.000Z",
    nextId: (prefix) => `${prefix}-profile-only`,
  });
  const profileOnlyDomain = await profileOnly.readDomainProjection({ userId: PROFILE.accountId });
  assert.equal(profileOnlyDomain.profile?.value.id, "profile-alice");
  assert.equal(profileOnlyDomain.goalContract?.value.id, "goal-alice");
  assert.equal(profileOnlyDomain.mandate?.value.id, "mandate-alice");
  assert.equal(profileOnlyDomain.equipmentProfiles[0]?.value.id, "equipment-source");
  assert.equal(profileOnlyDomain.safetyConstraints[0]?.value.id, "safety-source");
  assert.equal(profileOnlyDomain.plan, undefined);
  assert.deepEqual(profileOnlyDomain.workouts, []);

  await hydrateCloudCanonicalProjection({
    accountId: PROFILE.accountId,
    ledger: sourceLedger,
    projection: {
      ...projection,
      profile: PROFILE,
      plans: [],
      workoutSessions: [],
      results: [],
    },
  });
  const clearedDomain = await source.readDomainProjection({ userId: PROFILE.accountId });
  assert.equal(clearedDomain.profile, undefined);
  assert.deepEqual(clearedDomain.equipmentProfiles, []);
  assert.deepEqual(clearedDomain.safetyConstraints, []);
});

interface RequestRecord {
  path: string;
  init: RequestInit;
}

function canonicalProjection(overrides: Partial<CloudCanonicalProjection> = {}): CloudCanonicalProjection {
  return {
    accountId: PROFILE.accountId,
    profile: PROFILE,
    plans: [PLAN],
    workoutSessions: [WORKOUT],
    results: [RESULT],
    fetchedAt: "2026-08-10T04:00:00.000Z",
    ...overrides,
  };
}

function canonicalBootstrapResponses(projection: CloudCanonicalProjection): Map<string, Response[]> {
  return new Map([
    ["/v1/me", [json(projection.profile)]],
    ["/v1/plans?limit=100", [json({ data: projection.plans, nextCursor: null })]],
    ["/v1/workout-sessions?limit=100", [json({ data: projection.workoutSessions, nextCursor: null })]],
    ["/v1/results?limit=100", [json({ data: projection.results, nextCursor: null })]],
  ]);
}

function clientWithResponses(
  responses: Map<string, Response[]>,
  requests: RequestRecord[],
  accessToken: () => string = () => "service-jwt",
): CloudProductDataClient {
  return new CloudProductDataClient({
    baseUrl: "https://api.maxpower.example",
    accessToken,
    now: () => "2026-08-10T04:00:00.000Z",
    fetch: async (url, init = {}) => {
      const parsed = new URL(url);
      requests.push({ path: `${parsed.pathname}${parsed.search}`, init });
      const response = responses.get(`${parsed.pathname}${parsed.search}`)?.shift();
      if (!response) throw new Error(`unexpected_request:${parsed.pathname}${parsed.search}`);
      return response;
    },
  });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

class FakeCloudCacheDatabase {
  initialized = false;
  private readonly payloads = new Map<string, string>();

  async execAsync(): Promise<void> {
    this.initialized = true;
  }

  async runAsync(source: string, ...params: readonly string[]): Promise<void> {
    if (source.includes("DELETE")) this.payloads.delete(String(params[0]));
    else this.payloads.set(String(params[0]), String(params[1]));
  }

  async getFirstAsync<T>(source: string, ...params: readonly string[]): Promise<T | null> {
    void source;
    const payload = this.payloads.get(String(params[0]));
    return payload === undefined ? null : ({ payload } as T);
  }
}
