import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture(options: { notifications?: { requestAuthorization?(): Promise<"granted" | "denied">; schedule(input: { id: string; at: string; title: string; body: string }): Promise<void>; cancel(id: string): Promise<void> } } = {}) {
  const ledger = new InMemoryCoachLedger();
  let sequence = 0;
  const runtime = {
    now: () => "2026-08-08T12:00:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  return { ledger, runtime, app: new CoachApplication({ ledger, runtime, notifications: options.notifications }) };
}

const basicPatch = {
  profile: {
    adultConfirmed: true,
    trainingExperience: "beginner" as const,
    returningStatus: "new" as const,
    schedule: { weeklyFrequency: 3, sessionDurationMinutes: 35 },
    locations: [
      {
        id: "home",
        kind: "home" as const,
        environment: { space: "small" as const, noise: "quiet" as const },
        availableEquipment: ["bodyweight", "floor_space"],
      },
    ],
    bodyDirection: "decrease_body_fat" as const,
    exerciseConstraints: [],
    nutritionPreferences: [],
    professionalConstraints: [],
  },
  goal: {
    primaryGoal: "fat_loss_preserve_lean_mass" as const,
    modifiers: ["health" as const],
    expectedDirection: "decrease_body_fat_preserve_performance" as const,
    successMetrics: ["weekly_weight_trend", "training_performance_maintained"],
    horizon: { startDate: "2026-08-08", endDate: "2026-12-08" },
    acceptableCosts: ["moderate_dietary_tracking"],
    measurementStrategy: ["weekly_weight_trend", "workout_performance"],
    maintenanceFloors: ["two_resistance_sessions_per_week"],
  },
  mandate: {
    mode: "collaborative" as const,
    scopes: {
      loadReps: "confirm" as const,
      volume: "confirm" as const,
      substitution: "confirm" as const,
      schedule: "confirm" as const,
      deload: "confirm" as const,
      nutrition: "advice_only" as const,
    },
    limits: { maxLoadIncreasePercent: 5, maxWeeklySetChange: 2 },
    locks: [],
  },
  permissions: {
    camera: "granted" as const,
    health: "not_configured" as const,
    notifications: "denied" as const,
    remoteLlm: "not_configured" as const,
    cloudSync: "not_configured" as const,
    mediaUpload: "denied" as const,
  },
  safety: {
    adultConfirmed: true,
    professionalRestriction: false,
    recentSurgeryOrAcuteInjury: false,
    pregnancyOrPostpartumSpecialConsideration: false,
    eatingDisorderOrLowEnergyRiskDeclared: false,
    stopSignals: [],
  },
};

test("基础建档完全离线保存、重启恢复，并只在确认后生成权威事实", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "user-1", depth: "basic" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "conversation",
    patch: basicPatch,
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: "basic-progress",
  });

  const beforeComplete = await state.app.readDomainProjection({ userId: "user-1" });
  assert.equal(beforeComplete.profile, undefined);
  const restarted = new CoachApplication(state.ledger, state.runtime);
  const resumed = await restarted.readOnboardingProgress(draft.id);
  assert.deepEqual(resumed.confirmedSections.sort(), [
    "goal",
    "mandate",
    "permissions",
    "profile",
    "safety",
  ]);

  const completed = await restarted.completeOnboarding({
    draftId: draft.id,
    idempotencyKey: "complete-basic",
  });
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.unknownFields, [
    "body_measurements",
    "nutrition_intake",
    "training_load_history",
  ]);
  const facts = await restarted.readDomainProjection({ userId: "user-1" });
  assert.equal(facts.profile?.value.trainingExperience, "beginner");
  assert.equal(facts.goalContract?.value.primaryGoal, "fat_loss_preserve_lean_mass");
  assert.equal(facts.mandate?.value.mode, "collaborative");
  assert.equal(facts.permissions?.value.notifications, "denied");
  assert.equal(facts.permissions?.value.health, "not_configured");
  assert.equal(facts.safetyConstraints[0]?.value.disposition, "clear");
  assert.equal(restarted.runtimeStatus().remoteProviderRequests, 0);
});

test("建档保留身体基线、目标约束、平台历史与体脂估算 provenance，不把未知字段补成事实", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "structured-profile", depth: "professional" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "form",
    patch: {
      ...basicPatch,
      profile: {
        ...basicPatch.profile,
        demographics: {
          ageYears: 34,
          sex: "female",
          height: { value: 168, unit: "cm" },
          currentWeight: { value: 100, unit: "kg" },
        },
      },
      goal: {
        ...basicPatch.goal,
        goalType: "fat_loss",
        targets: {
          targetWeight: { value: 88, unit: "kg" },
          targetBodyFat: { value: 12, unit: "percent" },
        },
        unacceptableCosts: ["persistent_recovery_decline"],
      },
      professional: {
        priorStrategies: ["aggressive_cut", "maintenance_phase"],
        majorWeightLossHistory: {
          lostWeight: { value: 35, unit: "kg" },
          maintenanceExperience: "established",
          reboundOrHunger: "present",
        },
        bodyObservations: [{
          occurredAt: "2026-08-08T07:00:00.000+08:00",
          metric: "body_fat_percentage",
          quantity: { value: 24, unit: "percent" },
          condition: "tape_measure",
        }],
        bodyFatEstimate: {
          formulaId: "navy_tape.v1",
          method: "navy_tape",
          measuredAt: "2026-08-08T07:00:00.000+08:00",
          inputs: {
            waist: { value: 92, unit: "cm" },
            neck: { value: 38, unit: "cm" },
            height: { value: 168, unit: "cm" },
          },
          estimateRange: {
            min: { value: 22, unit: "percent" },
            max: { value: 26, unit: "percent" },
          },
        },
        plateauHistory: {
          durationWeeks: 12,
          priorStrategies: ["calorie_tracking"],
          executionAdherence: "high",
          recoveryChange: "stable",
          suspectedReasons: ["strategy_stagnation"],
        },
        recoveryObservations: [{
          occurredAt: "2026-08-08T07:00:00.000+08:00",
          perceivedRecovery: 4,
          fatigue: 7,
          soreness: 5,
          sleepHours: 6,
        }],
      },
    },
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety", "professional"],
    idempotencyKey: "structured-profile-save",
  });
  await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "structured-profile-complete" });
  const projection = await state.app.readDomainProjection({ userId: "structured-profile" });
  assert.deepEqual(projection.profile?.value.demographics, {
    ageYears: 34,
    sex: "female",
    height: { value: 168, unit: "cm" },
    currentWeight: { value: 100, unit: "kg" },
  });
  assert.equal(projection.profile?.value.historyModifiers?.plateau?.durationWeeks, 12);
  assert.deepEqual(projection.profile?.value.historyModifiers?.priorStrategies, ["aggressive_cut", "maintenance_phase"]);
  assert.equal(projection.profile?.value.historyModifiers?.majorWeightLossHistory?.maintenanceExperience, "established");
  assert.equal(projection.goalContract?.value.goalType, "fat_loss");
  assert.equal(projection.goalContract?.value.targets?.targetBodyFat?.value, 12);
  const estimate = projection.timeline.current
    .map((event) => event.fact)
    .find((fact) => fact.kind === "body" && fact.measurement.metric === "body_fat_percentage");
  assert.equal(estimate?.kind, "body");
  if (estimate?.kind === "body" && estimate.measurement.metric === "body_fat_percentage") {
    assert.equal(estimate.confidence, "confirmed");
    assert.equal(estimate.measurement.estimate?.formulaId, "navy_tape.v1");
    assert.deepEqual(estimate.measurement.estimate?.range, {
      min: { value: 22, unit: "percent" },
      max: { value: 26, unit: "percent" },
    });
  }
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "recovery"));
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "sleep"));
  assert.ok(projection.timeline.current.some((event) => event.fact.kind === "symptom" && event.fact.symptom === "soreness"));
});

test("未确认的对话建议保持 draft；专业建档的历史重量、RIR、身体和营养进入 Timeline", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "pro-1", depth: "professional" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "conversation",
    patch: {
      goal: { ...basicPatch.goal, primaryGoal: "hypertrophy", expectedDirection: "gain_lean_mass" },
    },
    confirmedSections: [],
    idempotencyKey: "agent-goal-suggestion",
  });
  assert.equal((await state.app.readDomainProjection({ userId: "pro-1" })).goalContract, undefined);

  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "form",
    patch: {
      ...basicPatch,
      goal: { ...basicPatch.goal, primaryGoal: "hypertrophy", expectedDirection: "gain_lean_mass" },
      profile: { ...basicPatch.profile, trainingExperience: "advanced" },
      professional: {
        recentSplit: ["push", "pull", "legs"],
        weeklyVolume: [{ muscleGroup: "chest", sets: 12 }],
        setHistory: [
          {
            occurredAt: "2026-08-07T08:00:00.000+08:00",
            exerciseVariantId: "bench_press.barbell.flat.standard.bilateral.full_rom",
            load: { value: 100, unit: "kg" as const },
            reps: 5,
            rir: 2,
          },
        ],
        bodyObservations: [
          {
            occurredAt: "2026-08-08T07:00:00.000+08:00",
            metric: "body_weight" as const,
            quantity: { value: 82.5, unit: "kg" as const },
            condition: "after_waking",
          },
          {
            occurredAt: "2026-08-08T07:01:00.000+08:00",
            metric: "body_fat_percentage" as const,
            quantity: { value: 17.5, unit: "percent" as const },
            condition: "bioimpedance_after_waking",
          },
          {
            occurredAt: "2026-08-08T07:02:00.000+08:00",
            metric: "circumference" as const,
            site: "waist_at_navel",
            quantity: { value: 82, unit: "cm" as const },
            condition: "relaxed_after_exhale",
          },
        ],
        nutritionObservations: [
          {
            occurredAt: "2026-08-07T20:00:00.000+08:00",
            energy: { value: 2800, unit: "kcal" as const },
            source: "user_estimate" as const,
          },
        ],
        availableCustomExercises: [
          {
            name: "健身房自制胸托划船",
            movement: "horizontal_pull" as const,
            equipmentRequirement: { kind: "item" as const, id: "custom_chest_supported_row" },
          },
        ],
      },
    },
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety", "professional"],
    idempotencyKey: "professional-confirmed",
  });
  await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "complete-pro" });

  const facts = await state.app.readDomainProjection({ userId: "pro-1" });
  assert.equal(facts.timeline.current.length, 5);
  assert.deepEqual(
    facts.timeline.current.map((event) => event.fact.kind).sort(),
    ["body", "body", "body", "nutrition", "training"],
  );
  const training = facts.timeline.current.find((event) => event.fact.kind === "training");
  assert.equal(training?.fact.kind === "training" && training.fact.historicalSet?.load.value, 100);
  assert.equal(training?.fact.kind === "training" && training.fact.historicalSet?.rir, 2);
  const bodyFacts = facts.timeline.current.filter((event) => event.fact.kind === "body");
  assert.deepEqual(
    bodyFacts.map((event) => event.fact.kind === "body" && event.fact.measurement.metric),
    ["body_weight", "body_fat_percentage", "circumference"],
  );
  assert.deepEqual(facts.profile?.value.trainingHistorySummary, {
    recentSplit: ["push", "pull", "legs"],
    weeklyVolume: [{ muscleGroup: "chest", sets: 12 }],
  });
  assert.equal(facts.customExercises[0]?.value.name, "健身房自制胸托划船");
});

test("红旗信号形成不可绕过 SafetyConstraint，权限和 Mandate 只能由本地设置动作修订", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "user-1", depth: "basic" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "form",
    patch: {
      ...basicPatch,
      mandate: { ...basicPatch.mandate, mode: "managed" },
      safety: { ...basicPatch.safety, stopSignals: ["chest_pain", "new_significant_pain"] },
    },
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: "red-flag-profile",
  });
  await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "complete-red-flag" });
  const facts = await state.app.readDomainProjection({ userId: "user-1" });
  assert.equal(facts.safetyConstraints[0]?.value.disposition, "stop_and_seek_professional_guidance");
  assert.equal(facts.safetyConstraints[0]?.value.diagnosis, undefined);
  const boundary = await state.app.evaluateOnboardingPolicy("user-1");
  assert.equal(boundary.mandateMode, "managed");
  assert.equal(boundary.canGeneratePlan, false);
  assert.equal(boundary.canStartWorkout, false);
  assert.equal(boundary.orderedConstraints.every((item) => !item.bypassableByManagedMode), true);

  await assert.rejects(
    state.app.updateCoachingMandateFromSettings({
      userId: "user-1",
      mandateId: facts.mandate!.value.id,
      expectedRevision: 1,
      mandate: { ...facts.mandate!.value, mode: "managed" },
      authorization: { kind: "tool_output" as never, verifiedAt: "2026-08-08T12:00:00.000+08:00", nonce: "x" },
      idempotencyKey: "prompt-injection-mandate",
    }),
    /local_user_presence_required/,
  );
  await state.app.updatePermissionFromSettings({
    userId: "user-1",
    expectedRevision: 1,
    changes: { notifications: "granted" },
    authorization: {
      kind: "local_user_presence",
      verifiedAt: "2026-08-08T12:00:00.000+08:00",
      nonce: "settings-1",
    },
    idempotencyKey: "grant-notifications",
  });
  const updated = await state.app.readDomainProjection({ userId: "user-1" });
  assert.equal(updated.permissions?.revision, 2);
  assert.equal(updated.permissions?.value.notifications, "granted");
});

test("前台用户首次开启通知时才请求原生授权；拒绝不会写入错误的领域授权", async () => {
  const authorizationRequests: string[] = [];
  const state = fixture({
    notifications: {
      async requestAuthorization() {
        authorizationRequests.push("request");
        return "denied";
      },
      async schedule() {},
      async cancel() {},
    },
  });
  const draft = await state.app.startOnboarding({ userId: "permission-user", depth: "basic" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "form",
    patch: basicPatch,
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: "permission-user-onboarding",
  });
  await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "permission-user-complete" });
  const before = await state.app.readDomainProjection({ userId: "permission-user" });

  await assert.rejects(
    state.app.updatePermissionFromSettings({
      userId: "permission-user",
      expectedRevision: before.permissions!.revision,
      changes: { notifications: "granted" },
      authorization: { kind: "local_user_presence", verifiedAt: "2026-08-08T12:00:00.000+08:00", nonce: "permission-user-enable" },
      idempotencyKey: "permission-user-enable",
    }),
    /native_notification_permission_denied/,
  );
  assert.deepEqual(authorizationRequests, ["request"]);
  const after = await state.app.readDomainProjection({ userId: "permission-user" });
  assert.equal(after.permissions?.value.notifications, "denied");
  assert.equal(after.permissions?.revision, before.permissions?.revision);
});

test("表单和对话确认得到等价 RulePack 输入，输入方式只保留在字段 provenance", async () => {
  async function completed(mode: "form" | "conversation", userId: string) {
    const state = fixture();
    const draft = await state.app.startOnboarding({ userId, depth: "basic" });
    await state.app.saveOnboardingProgress({
      draftId: draft.id,
      inputMode: mode,
      patch: basicPatch,
      confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
      idempotencyKey: `${mode}-save`,
    });
    await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: `${mode}-complete` });
    return state.app.readDomainProjection({ userId });
  }
  const form = await completed("form", "form-user");
  const conversation = await completed("conversation", "conversation-user");
  const planningInput = (projection: typeof form) => ({
    profile: {
      ...projection.profile!.value,
      id: "profile",
      fieldProvenance: undefined,
    },
    goal: { ...projection.goalContract!.value, id: "goal" },
    mandate: { ...projection.mandate!.value, id: "mandate" },
    safety: projection.safetyConstraints.map((item) => ({ ...item.value, id: "safety" })),
  });
  assert.deepEqual(planningInput(form), planningInput(conversation));
  assert.equal(form.profile?.value.fieldProvenance?.trainingExperience?.source, "form");
  assert.equal(
    conversation.profile?.value.fieldProvenance?.trainingExperience?.source,
    "conversation",
  );
});

test("资料纠错保留 CorrectionEvent，归档不篡改历史；目标 revision 使旧计划 stale", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "user-1", depth: "basic" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "form",
    patch: basicPatch,
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: "save",
  });
  await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "complete" });
  const authorization = {
    kind: "local_user_presence" as const,
    verifiedAt: "2026-08-08T12:00:00.000+08:00",
    nonce: "settings-lifecycle",
  };
  const before = await state.app.readDomainProjection({ userId: "user-1" });
  const createEvent = (await state.ledger.read()).domainEvents.find(
    (event) => event.name === "user_profile.created" && event.userId === "user-1",
  )!;
  await state.app.correctProfileFromSettings({
    userId: "user-1",
    expectedRevision: 1,
    correctsEventId: createEvent.id,
    reason: "session duration was entered incorrectly",
    profile: {
      ...before.profile!.value,
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
    },
    authorization,
    idempotencyKey: "correct-profile",
  });
  const correctedEvent = (await state.ledger.read()).domainEvents.find(
    (event) => event.name === "user_profile.corrected",
  );
  assert.equal(
    correctedEvent?.name === "user_profile.corrected" && correctedEvent.payload.correctsEventId,
    createEvent.id,
  );

  await state.app.executeDomainCommand({
    type: "plan.revise",
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "local-device",
      occurredAt: "2026-08-08T12:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "seed-plan",
    },
    planId: "plan:user-1",
    expectedRevision: 0,
    revision: {
      id: "plan:user-1",
      goalContractRef: { kind: "goal_contract", id: "goal:user-1", revision: 1 },
      effectiveFrom: "2026-08-09",
      knowledgePins: state.app.getInstalledKnowledgeVersionPins(),
      sessions: [],
    },
  });
  assert.equal((await state.app.readDomainProjection({ userId: "user-1" })).planStatus, "current");
  await state.app.updateGoalContractFromSettings({
    userId: "user-1",
    expectedRevision: 1,
    goalContract: {
      ...before.goalContract!.value,
      primaryGoal: "strength",
      expectedDirection: "increase_max_strength",
    },
    authorization,
    idempotencyKey: "change-goal",
  });
  assert.equal(
    (await state.app.readDomainProjection({ userId: "user-1" })).planStatus,
    "stale_goal_contract",
  );

  await state.app.setOnboardingAggregateArchivedFromSettings({
    userId: "user-1",
    aggregate: { kind: "user_profile", id: "profile:user-1", revision: 2 },
    archived: true,
    reason: "user requested profile deletion",
    authorization,
    idempotencyKey: "archive-profile",
  });
  assert.equal((await state.app.readDomainProjection({ userId: "user-1" })).profile, undefined);
  assert.equal(
    (await state.app.readDataLifecycleStatus("user-1", {
      kind: "user_profile",
      id: "profile:user-1",
    })).structuredData,
    "archived",
  );
  assert.equal(
    (await state.ledger.read()).domainEvents.some((event) => event.id === createEvent.id),
    true,
  );
});

test("每项权限可独立拒绝、撤销与重新授权，远程 LLM 授权附带身份脱敏披露", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "user-1", depth: "basic" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "form",
    patch: basicPatch,
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: "save",
  });
  await state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "complete" });
  const authorization = {
    kind: "local_user_presence" as const,
    verifiedAt: "2026-08-08T12:00:00.000+08:00",
    nonce: "permission-settings",
  };
  await state.app.updatePermissionFromSettings({
    userId: "user-1",
    expectedRevision: 1,
    changes: { remoteLlm: "granted" },
    authorization,
    idempotencyKey: "grant-llm",
  });
  let permissions = (await state.app.readDomainProjection({ userId: "user-1" })).permissions!;
  assert.equal(
    permissions.value.remoteLlmDisclosure?.taskRelevantHealthTrainingNutritionSleepAndExperienceSent,
    true,
  );
  assert.deepEqual(permissions.value.remoteLlmDisclosure?.directIdentityFieldsRemoved, [
    "name",
    "address",
    "contact_details",
    "precise_location",
    "external_account_id",
  ]);
  await state.app.updatePermissionFromSettings({
    userId: "user-1",
    expectedRevision: 2,
    changes: { remoteLlm: "denied", notifications: "not_configured" },
    authorization,
    idempotencyKey: "revoke-llm",
  });
  await state.app.updatePermissionFromSettings({
    userId: "user-1",
    expectedRevision: 3,
    changes: { remoteLlm: "granted" },
    authorization,
    idempotencyKey: "regrant-llm",
  });
  permissions = (await state.app.readDomainProjection({ userId: "user-1" })).permissions!;
  assert.equal(permissions.revision, 4);
  assert.equal(permissions.value.remoteLlm, "granted");
  assert.equal(permissions.value.notifications, "not_configured");
});

test("冲突的主目标保持 draft，不生成伪完整 GoalContract", async () => {
  const state = fixture();
  const draft = await state.app.startOnboarding({ userId: "user-1", depth: "basic" });
  await state.app.saveOnboardingProgress({
    draftId: draft.id,
    inputMode: "conversation",
    patch: {
      ...basicPatch,
      goal: {
        ...basicPatch.goal,
        proposedPrimaryGoals: ["hypertrophy", "fat_loss_preserve_lean_mass"],
      },
    },
    confirmedSections: ["profile", "goal", "mandate", "permissions", "safety"],
    idempotencyKey: "conflicting-goals",
  });
  await assert.rejects(
    state.app.completeOnboarding({ draftId: draft.id, idempotencyKey: "complete-conflict" }),
    /primary_goal_conflict/,
  );
  assert.equal((await state.app.readDomainProjection({ userId: "user-1" })).goalContract, undefined);
});
