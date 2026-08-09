import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import type {
  CoachingMandateData,
  GoalContractData,
  UserProfileData,
} from "../../src/coach/domain";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { RuntimeServices } from "../../src/coach/model";
import {
  SQLiteCoachLedger,
  type SQLiteBindValue,
  type SQLiteDatabaseLike,
} from "../../src/coach/sqlite";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { GoalCyclePlanner, type PlannerFacts, type PlannerRequest } from "../../src/planning";

const registry = new KnowledgePackRegistry(createInstalledKnowledgePack());
const planner = new GoalCyclePlanner(registry);

class NodeSQLiteDatabase implements SQLiteDatabaseLike {
  constructor(private readonly database: DatabaseSync) {}
  async execAsync(source: string): Promise<void> { this.database.exec(source); }
  async getFirstAsync<T>(source: string, ...params: SQLiteBindValue[]): Promise<T | null> {
    return (this.database.prepare(source).get(...params) as T | undefined) ?? null;
  }
  async runAsync(source: string, ...params: SQLiteBindValue[]): Promise<unknown> {
    return this.database.prepare(source).run(...params);
  }
  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      await task();
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function runtime(): RuntimeServices {
  let id = 0;
  return {
    now: () => "2026-08-03T08:00:00.000Z",
    nextId: (prefix) => `${prefix}-${++id}`,
  };
}

function facts(overrides: Partial<PlannerFacts> = {}): PlannerFacts {
  const profile: UserProfileData = {
    id: "profile-1",
    trainingExperience: "beginner",
    locale: "zh-CN",
    schedule: { weeklyFrequency: 3, sessionDurationMinutes: 50 },
    locations: [
      {
        id: "home-main",
        kind: "home",
        environment: { space: "medium", noise: "quiet" },
        availableEquipment: ["bodyweight", "floor_space"],
      },
    ],
  };
  const goal: GoalContractData = {
    id: "goal-1",
    primaryGoal: "hypertrophy",
    modifiers: ["conditioning"],
    successMetrics: ["weekly_training_adherence", "confirmed_performance_trend"],
    horizon: { startDate: "2026-08-03", endDate: "2026-09-13" },
    maintenanceFloors: ["retain_lower_body_exposure"],
    status: "active",
  };
  const mandate: CoachingMandateData = { id: "mandate-1", mode: "collaborative" };
  return {
    userId: "user-1",
    profile: { revision: 1, value: profile },
    goalContract: { revision: 1, value: goal },
    mandate: { revision: 1, value: mandate },
    safetyConstraints: [],
    equipmentProfiles: [],
    recoveryConstraints: [],
    nutritionStrategies: [],
    timeline: [],
    ...overrides,
  };
}

function request(overrides: Partial<PlannerRequest> = {}): PlannerRequest {
  return {
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    facts: facts(),
    ...overrides,
  };
}

test("最小新手居家徒手生成完整 GoalCycle，但只物化当前周和下一周", () => {
  const decision = planner.plan(request());
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  const mesocycle = decision.goalCycle.phasePath?.[0];
  assert.equal(mesocycle?.weeklyIntents.length, 6);
  assert.deepEqual(
    mesocycle?.weeklyIntents.map((week) => week.materialization),
    ["materialized", "materialized", "intent_only", "intent_only", "intent_only", "intent_only"],
  );
  assert.equal(decision.planRevision.materializedWeeks?.length, 2);
  assert.equal(decision.planRevision.sessions.length, 14);
  assert.equal(decision.planRevision.sessions.filter((session) => session.kind === "rest").length, 8);
  assert.ok(
    decision.planRevision.sessions
      .flatMap((session) => session.tasks)
      .every((task) => task.sets.every((set) => set.targetLoadStatus === "unknown")),
  );
  assert.equal(decision.goalCycle.allocations?.filter((item) => item.role === "primary").length, 1);
  assert.ok((decision.goalCycle.allocations?.[0]?.budgetShare ?? 0) > 0.5);

  const lateStart = planner.plan(request({ currentDate: "2026-08-08" }));
  assert.equal(lateStart.kind, "plan_proposal");
  if (lateStart.kind === "plan_proposal") {
    assert.ok(
      lateStart.planRevision.sessions
        .filter((session) => session.scheduledFor < "2026-08-08")
        .every((session) => session.tasks.length === 0),
    );
  }
});

test("专业健身房精确变式历史可形成 predicted_target，但平替不复制 absolute load", () => {
  const bench = registry
    .search({ movementPattern: "horizontal_push", loadModes: ["barbell"] })
    .find((exercise) => exercise.identity.movement === "bench_press")!;
  const gymFacts = facts({
    profile: {
      revision: 2,
      value: {
        ...facts().profile.value,
        trainingExperience: "advanced",
        locations: [
          {
            id: "gym-main",
            kind: "gym",
            environment: { space: "large", noise: "any" },
            availableEquipment: ["full_gym"],
          },
        ],
      },
    },
  });
  const history = {
    exerciseVariantId: bench.id,
    occurredAt: "2026-08-06T10:00:00.000Z",
    load: { value: 80, unit: "kg" as const },
    reps: 6,
    rir: 2,
    confidence: "confirmed" as const,
    evidenceRef: "timeline:set-bench:r4",
  };
  const first = planner.plan(request({ facts: gymFacts, historicalPerformance: [history] }));
  assert.equal(first.kind, "plan_proposal");
  if (first.kind !== "plan_proposal") return;
  const anchored = first.planRevision.sessions
    .flatMap((session) => session.tasks)
    .find((task) => task.exerciseVariantId === bench.id);
  assert.equal(anchored?.sets[0]?.targetLoadStatus, "predicted_target");
  assert.equal(anchored?.sets[0]?.targetLoad?.value, 80);
  assert.equal(anchored?.sets[0]?.targetLoadBasis?.source, "exact_variant_history");

  const substituted = planner.plan(
    request({
      facts: gymFacts,
      historicalPerformance: [history],
      temporaryExerciseAvailability: [
        { exerciseVariantId: bench.id, status: "busy" },
      ],
    }),
  );
  assert.equal(substituted.kind, "plan_proposal");
  if (substituted.kind !== "plan_proposal") return;
  assert.equal(
    substituted.planRevision.sessions
      .flatMap((session) => session.tasks)
      .filter((task) => task.exerciseVariantId !== bench.id)
      .some((task) => task.sets.some((set) => set.targetLoad?.value === 80)),
    false,
  );
});

test("Safety 与动作硬约束不会被历史、偏好或 camera bonus 覆盖", () => {
  const unsafe = planner.plan(
    request({
      facts: facts({
        safetyConstraints: [
          {
            revision: 2,
            value: {
              id: "safety-1",
              disposition: "stop_and_seek_professional_guidance",
              reasons: ["new_significant_pain"],
              stopSignals: ["new_significant_pain"],
              professionalConstraints: [],
            },
          },
        ],
      }),
    }),
  );
  assert.equal(unsafe.kind, "infeasible_plan");
  if (unsafe.kind === "infeasible_plan") assert.deepEqual(unsafe.reasonCodes, ["safety_stop"]);

  const blockedPattern = planner.plan(
    request({
      facts: facts({
        profile: {
          revision: 2,
          value: {
            ...facts().profile.value,
            exerciseConstraints: [
              {
                kind: "cannot_do",
                movementPattern: "horizontal_push",
                reason: "professional restriction",
                priority: "hard",
                scope: "future_policy",
              },
            ],
          },
        },
      }),
    }),
  );
  assert.equal(blockedPattern.kind, "infeasible_plan");
});

test("酒店无器材、器械忙碌和锁冲突返回可解释结果", () => {
  const barbell = registry.search({ movementPattern: "squat", loadModes: ["barbell"] })[0]!;
  const decision = planner.plan(
    request({
      facts: facts({
        profile: {
          revision: 3,
          value: {
            ...facts().profile.value,
            locations: [
              {
                id: "hotel-room",
                kind: "hotel",
                environment: { space: "small", noise: "quiet" },
                availableEquipment: ["bodyweight", "floor_space"],
              },
            ],
          },
        },
      }),
      directChoices: [
        { stimulusSlotId: "session-0:slot-2", exerciseVariantId: barbell.id, scope: "lock" },
      ],
      temporaryExerciseAvailability: [{ exerciseVariantId: barbell.id, status: "busy" }],
    }),
  );
  assert.equal(decision.kind, "infeasible_plan");
  if (decision.kind !== "infeasible_plan") return;
  assert.ok(decision.hardConflicts.some((item) => item.includes("locked_exercise_unavailable")));
  assert.ok(decision.minimumRelaxations.some((item) => item.field === "exercise_lock"));
});

test("schedule infeasible 不会伪造完整 Session，短时容量删除低优先级刺激", () => {
  const impossible = planner.plan(request({ schedule: [] }));
  assert.equal(impossible.kind, "infeasible_plan");
  if (impossible.kind === "infeasible_plan") {
    assert.ok(impossible.minimumRelaxations.some((item) => item.field === "schedule"));
  }

  const bounded = planner.plan(
    request({
      schedule: [
        { weekday: 1, availableMinutes: 20, locationId: "home-main" },
        { weekday: 4, availableMinutes: 20, locationId: "home-main" },
      ],
      trigger: "repeated_missed_sessions",
      missedSessionDates: ["2026-08-03", "2026-08-05", "2026-08-07"],
    }),
  );
  assert.equal(bounded.kind, "plan_proposal");
  if (bounded.kind !== "plan_proposal") return;
  assert.ok(bounded.reasonCodes.includes("low_priority_stimulus_removed_for_capacity"));
  assert.ok(
    bounded.planRevision.sessions
      .filter((session) => session.kind !== "rest")
      .every((session) => (session.stimulusSlots?.length ?? 0) === 1),
  );
});

test("恢复降级、减脂保肌与休息日都使用统一 SessionPrescription", () => {
  const recovery = planner.plan(
    request({
      trigger: "recovery_downgraded",
      facts: facts({
        recoveryConstraints: [
          {
            revision: 1,
            value: {
              id: "recovery-1",
              level: "recovery_priority",
              validUntil: "2026-08-10",
            },
          },
        ],
      }),
    }),
  );
  assert.equal(recovery.kind, "plan_proposal");
  if (recovery.kind === "plan_proposal") {
    assert.ok(recovery.planRevision.sessions.some((session) => session.kind === "recovery"));
    assert.ok(recovery.planRevision.sessions.some((session) => session.kind === "rest"));
  }

  const fatLoss = planner.plan(
    request({
      facts: facts({
        goalContract: {
          revision: 2,
          value: {
            ...facts().goalContract.value,
            primaryGoal: "fat_loss_preserve_lean_mass",
          },
        },
      }),
    }),
  );
  assert.equal(fatLoss.kind, "plan_proposal");
  if (fatLoss.kind === "plan_proposal") {
    assert.ok(fatLoss.planRevision.sessions.some((session) => session.kind === "cardio"));
    assert.ok(fatLoss.planRevision.sessions.some((session) => session.kind === "bodyweight_reps"));
  }
});

test("闭环事件无 typed diff 时返回 no_change，不产生伪 revision", () => {
  const initial = planner.plan(request());
  assert.equal(initial.kind, "plan_proposal");
  if (initial.kind !== "plan_proposal") return;
  const unchanged = planner.plan(
    request({
      trigger: "session_completed",
      consecutiveDeviationCount: 1,
      facts: facts({ priorPlan: { revision: 1, value: initial.planRevision } }),
    }),
  );
  assert.equal(unchanged.kind, "no_change");
  if (unchanged.kind !== "no_change") return;
  assert.deepEqual(unchanged.reasonCodes, ["single_session_outcome_updates_forecast_only"]);
  assert.equal(unchanged.forecastUpdate?.shouldProposeAdjustment, false);
  assert.equal(unchanged.forecastUpdate?.scenarios.length, 3);
});

test("同一事实 frontier 重放结构等价，Proposal 含 diff、pins、缺失与三种预测场景", () => {
  const input = request({ trigger: "user_requested", requestedScope: "future_preference" });
  const left = planner.plan(input);
  const right = planner.plan(input);
  assert.deepEqual(left, right);
  assert.equal(left.kind, "plan_proposal");
  if (left.kind !== "plan_proposal") return;
  assert.equal(left.scope, "future_preference");
  assert.equal(left.requiresConfirmation, true);
  assert.ok(left.diff.length > 0);
  assert.ok(left.baseRevisions.length >= 3);
  assert.ok(left.missing.includes("exact_variant_load_history"));
  assert.deepEqual(left.forecasts.map((item) => item.scenario), ["conservative", "base", "aggressive"]);
  assert.ok(left.forecasts.every((item) => item.disclaimer === "directional_not_guaranteed"));
});

test("统一 Strategy Selection 根据结构化目标与历史 modifier 生成三档可解释 Forecast", () => {
  const decision = planner.plan(request({
    facts: facts({
      profile: {
        revision: 2,
        value: {
          ...facts().profile.value,
          demographics: {
            ageYears: 34,
            sex: "female",
            height: { value: 168, unit: "cm" },
            currentWeight: { value: 100, unit: "kg" },
          },
          bodyDirection: "decrease_body_fat",
          historyModifiers: {
            plateau: {
              durationWeeks: 12,
              executionAdherence: "high",
              recoveryChange: "stable",
              suspectedReasons: ["strategy_stagnation"],
            },
          },
        },
      },
      goalContract: {
        revision: 2,
        value: {
          ...facts().goalContract.value,
          primaryGoal: "fat_loss_preserve_lean_mass",
          goalType: "fat_loss",
          targets: {
            targetWeight: { value: 88, unit: "kg" },
            targetBodyFat: { value: 12, unit: "percent" },
          },
          unacceptableCosts: ["persistent_recovery_decline"],
        },
      },
    }),
  }));
  assert.equal(decision.kind, "plan_proposal");
  if (decision.kind !== "plan_proposal") return;
  assert.equal(decision.strategySelection?.primary, "maintenance_recomposition");
  assert.deepEqual(
    decision.adaptiveForecasts?.map((forecast) => forecast.scenario),
    ["strict_aggressive", "balanced", "flexible"],
  );
  assert.equal(decision.adaptiveForecasts?.[0]?.eligibility, "degraded");
  assert.ok(decision.adaptiveForecasts?.every((forecast) => forecast.guardrails.length > 0));
  assert.ok(decision.explanation?.userEvidence.some((item) => item === "plateau_history"));
  assert.ok(decision.explanation?.researchEvidence.every((citation) => citation.citationId === "maxpower.exercise-wiki.v1"));
  assert.equal(decision.planRevision.strategySelection?.primary, "maintenance_recomposition");
  assert.equal(decision.planRevision.nutritionStrategy?.energyApproach, "maintenance");
});

test("CoachApplication 在 InMemory 与 SQLite frontier 上得到结构等价 Planner 输出", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const applications = [
    new CoachApplication(new InMemoryCoachLedger(), runtime()),
    new CoachApplication(new SQLiteCoachLedger(new NodeSQLiteDatabase(sqlite)), runtime()),
  ];
  const baseFacts = facts();
  for (const app of applications) {
    await app.executeDomainCommand({
      type: "user.bootstrap",
      profile: baseFacts.profile.value,
      goalContract: baseFacts.goalContract.value,
      mandate: baseFacts.mandate.value,
      meta: {
        userId: "user-1",
        actor: { kind: "user", id: "user-1" },
        deviceId: "fixture-device",
        occurredAt: "2026-08-03T08:00:00.000Z",
        timezoneOffsetMinutes: 480,
        idempotencyKey: "bootstrap-planner-user",
      },
    });
  }
  const decisions = await Promise.all(
    applications.map((app) =>
      app.previewGoalCycle({
        userId: "user-1",
        trigger: "initial_plan",
        currentDate: "2026-08-03",
      }),
    ),
  );
  assert.deepEqual(decisions[0], decisions[1]);
  sqlite.close();
});

test("Planning preview 只生成可追溯 immutable artifact，确认后才原子物化 GoalCycle 与 PlanRevision", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  const base = facts();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: base.profile.value,
    goalContract: base.goalContract.value,
    mandate: base.mandate.value,
    meta: {
      userId: "preview-user",
      actor: { kind: "user", id: "preview-user" },
      deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "preview-bootstrap",
    },
  });
  const preview = await app.createPlanningPreview({
    userId: "preview-user",
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    idempotencyKey: "preview-create",
  });
  assert.equal(preview.kind, "evidence_brief");
  assert.equal(preview.planningPreview?.status, "awaiting_confirmation");
  assert.equal((await app.readDomainProjection({ userId: "preview-user" })).plan, undefined);
  assert.ok((await app.listActionLog("preview-user")).some((event) => event.intent === "planning.preview"));

  const confirmed = await app.confirmPlanningPreview({
    userId: "preview-user",
    previewId: preview.id,
    idempotencyKey: "preview-confirm",
  });
  assert.equal(confirmed.kind, "plan_proposal");
  const domain = await app.readDomainProjection({ userId: "preview-user" });
  assert.ok(domain.goalCycles.length > 0);
  assert.ok(domain.plan);
});

test("Planning preview 在事实变化后变 stale，拒绝只写审计事实而不物化计划", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  const base = facts();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: base.profile.value,
    goalContract: base.goalContract.value,
    mandate: base.mandate.value,
    meta: {
      userId: "preview-stale-user",
      actor: { kind: "user", id: "preview-stale-user" },
      deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "preview-stale-bootstrap",
    },
  });
  const preview = await app.createPlanningPreview({
    userId: "preview-stale-user",
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    idempotencyKey: "preview-stale-create",
  });
  await app.executeDomainCommand({
    type: "profile.revise",
    profileId: base.profile.value.id,
    expectedRevision: 1,
    profile: { ...base.profile.value, schedule: { weeklyFrequency: 2, sessionDurationMinutes: 40 } },
    meta: {
      userId: "preview-stale-user",
      actor: { kind: "user", id: "preview-stale-user" },
      deviceId: "fixture-device",
      occurredAt: "2026-08-03T09:00:00.000Z",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "preview-stale-profile-revise",
    },
  });
  await assert.rejects(
    app.confirmPlanningPreview({
      userId: "preview-stale-user",
      previewId: preview.id,
      idempotencyKey: "preview-stale-confirm",
    }),
    /planning_preview_stale/,
  );
  const rejectedPreview = await app.createPlanningPreview({
    userId: "preview-stale-user",
    trigger: "initial_plan",
    currentDate: "2026-08-03",
    idempotencyKey: "preview-reject-create",
  });
  const rejected = await app.rejectPlanningPreview({
    userId: "preview-stale-user",
    previewId: rejectedPreview.id,
    idempotencyKey: "preview-reject",
  });
  assert.equal(rejected.planningPreview?.status, "rejected");
  assert.equal((await app.readDomainProjection({ userId: "preview-stale-user" })).plan, undefined);
  const intents = (await app.listActionLog("preview-stale-user")).map((event) => event.intent);
  assert.ok(intents.includes("planning.preview.stale"));
  assert.ok(intents.includes("planning.preview.reject"));
});

test("CoachApplication 将注册的本地 trigger 交给确定性 Replanner，no_change 不伪造 Proposal", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  const baseFacts = facts();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: baseFacts.profile.value,
    goalContract: baseFacts.goalContract.value,
    mandate: baseFacts.mandate.value,
    meta: {
      userId: "user-1",
      actor: { kind: "user", id: "user-1" },
      deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap-replanner-user",
    },
  });
  const initial = await app.previewGoalCycle({
    userId: "user-1",
    trigger: "initial_plan",
    currentDate: "2026-08-03",
  });
  assert.equal(initial.kind, "plan_proposal");
  if (initial.kind !== "plan_proposal") return;
  await app.executeDomainCommand({
    type: "goal_cycle.revise",
    goalCycleId: initial.goalCycle.id,
    expectedRevision: 0,
    goalCycle: initial.goalCycle,
    meta: {
      userId: "user-1", actor: { kind: "rule_engine", id: "planner" }, deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "store-goal-cycle",
    },
  });
  await app.executeDomainCommand({
    type: "plan.revise",
    planId: initial.planRevision.id,
    expectedRevision: 0,
    revision: initial.planRevision,
    meta: {
      userId: "user-1", actor: { kind: "rule_engine", id: "planner" }, deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "store-initial-plan",
    },
  });

  const evaluation = await app.evaluateLocalReplan({
    userId: "user-1",
    currentDate: "2026-08-03",
    trigger: {
      id: "trigger-session-1", kind: "session_completed", actor: "rule_engine",
      occurredAt: "2026-08-03T08:00:00.000Z", causationId: "workout-1", idempotencyKey: "replan-session-1",
    },
    window: { start: "2026-08-03", end: "2026-08-09" },
  });
  assert.equal(evaluation.outcome, "no_change");
  assert.equal(evaluation.diff.changed, false);
  assert.deepEqual(evaluation.forecasts.map((item) => item.scenario), ["conservative", "base", "aggressive"]);
  assert.ok(evaluation.factFrontier.some((ref) => ref.kind === "plan"));
  const replay = await app.evaluateLocalReplan({
    userId: "user-1",
    currentDate: "2026-08-03",
    trigger: {
      id: "trigger-session-1", kind: "session_completed", actor: "rule_engine",
      occurredAt: "2026-08-03T08:00:00.000Z", causationId: "workout-1", idempotencyKey: "replan-session-1",
    },
    window: { start: "2026-08-03", end: "2026-08-09" },
  });
  assert.deepEqual(replay, evaluation);
  const persisted = await app.readReplanEvaluation("user-1", evaluation.id);
  assert.equal(persisted?.evaluation.id, evaluation.id);

  await app.executeDomainCommand({
    type: "goal_contract.revise",
    goalContractId: baseFacts.goalContract.value.id,
    expectedRevision: 1,
    goalContract: {
      ...baseFacts.goalContract.value,
      horizon: { startDate: "2026-08-03", endDate: "2026-10-04" },
    },
    meta: {
      userId: "user-1", actor: { kind: "user", id: "user-1" }, deviceId: "fixture-device",
      occurredAt: "2026-08-04T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "goal-change-replan",
    },
  });
  const afterGoalChange = await app.readLatestReplanEvaluation("user-1");
  assert.equal(afterGoalChange?.evaluation.trigger.kind, "goal_contract_revised");
  assert.equal(afterGoalChange?.evaluation.trigger.causationId, "goal_contract:goal-1:2");

  await app.executeDomainCommand({
    type: "equipment_profile.revise",
    equipmentProfileId: "home-equipment",
    expectedRevision: 0,
    equipmentProfile: {
      id: "home-equipment",
      name: "家用器材",
      locationKind: "home",
      equipmentIds: ["bodyweight", "floor_space"],
    },
    meta: {
      userId: "user-1", actor: { kind: "user", id: "user-1" }, deviceId: "fixture-device",
      occurredAt: "2026-08-05T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "equipment-change-replan",
    },
  });
  const afterEquipmentChange = await app.readLatestReplanEvaluation("user-1");
  assert.equal(afterEquipmentChange?.evaluation.trigger.kind, "equipment_changed");
  assert.equal(afterEquipmentChange?.evaluation.trigger.causationId, "equipment_profile:home-equipment:1");

  await app.executeDomainCommand({
    type: "profile.revise",
    profileId: baseFacts.profile.value.id,
    expectedRevision: 1,
    profile: {
      ...baseFacts.profile.value,
      schedule: { weeklyFrequency: 2, sessionDurationMinutes: 40 },
    },
    meta: {
      userId: "user-1", actor: { kind: "user", id: "user-1" }, deviceId: "fixture-device",
      occurredAt: "2026-08-06T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "schedule-change-replan",
    },
  });
  const afterScheduleChange = await app.readLatestReplanEvaluation("user-1");
  assert.equal(afterScheduleChange?.evaluation.trigger.kind, "schedule_changed");
  assert.equal(afterScheduleChange?.evaluation.trigger.causationId, "user_profile:profile-1:2");

  const weeklyReview = await app.runWeeklyReview({
    userId: "user-1",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-09",
    idempotencyKey: "weekly-report-2026w32",
  });
  const weekly = weeklyReview.report;
  assert.ok(weekly.report.plannedSetCount > 0);
  assert.equal(weekly.report.performedSetCount, 0);
  assert.equal(weekly.report.dataCoverage, "low");
  assert.ok(weekly.report.factRefs.some((ref) => ref.aggregate === "plan"));
  assert.equal(weeklyReview.evaluation?.trigger.kind, "weekly_review_due");
  assert.equal(weeklyReview.evaluation?.trigger.causationId, weekly.id);
  const weeklyReplay = await app.createWeeklyCoachReport({
    userId: "user-1",
    weekStart: "2026-08-03",
    weekEnd: "2026-08-09",
    idempotencyKey: "weekly-report-2026w32",
  });
  assert.deepEqual(weeklyReplay, weekly);
  const weeklyReviewReplay = await app.runWeeklyReview({
    userId: "user-1", weekStart: "2026-08-03", weekEnd: "2026-08-09", idempotencyKey: "weekly-report-2026w32",
  });
  assert.deepEqual(weeklyReviewReplay, weeklyReview);
});

test("Mesocycle review 与 Deload 结束只由已配置周期和本地事实驱动，并可重放", async () => {
  const app = new CoachApplication(new InMemoryCoachLedger(), runtime());
  const baseFacts = facts();
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: baseFacts.profile.value,
    goalContract: baseFacts.goalContract.value,
    mandate: baseFacts.mandate.value,
    meta: {
      userId: "user-1", actor: { kind: "user", id: "user-1" }, deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap-mesocycle-review",
    },
  });
  const initial = await app.previewGoalCycle({ userId: "user-1", trigger: "initial_plan", currentDate: "2026-08-03" });
  assert.equal(initial.kind, "plan_proposal");
  if (initial.kind !== "plan_proposal") return;
  await app.executeDomainCommand({
    type: "goal_cycle.revise",
    goalCycleId: initial.goalCycle.id,
    expectedRevision: 0,
    goalCycle: initial.goalCycle,
    meta: {
      userId: "user-1", actor: { kind: "rule_engine", id: "planner" }, deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "store-mesocycle-goal-cycle",
    },
  });
  await app.executeDomainCommand({
    type: "plan.revise",
    planId: initial.planRevision.id,
    expectedRevision: 0,
    revision: initial.planRevision,
    meta: {
      userId: "user-1", actor: { kind: "rule_engine", id: "planner" }, deviceId: "fixture-device",
      occurredAt: "2026-08-03T08:00:00.000Z", timezoneOffsetMinutes: 480, idempotencyKey: "store-mesocycle-plan",
    },
  });
  const mesocycle = initial.goalCycle.phasePath?.[0];
  assert.ok(mesocycle);
  if (!mesocycle) return;
  const review = await app.createMesocycleReview({ userId: "user-1", mesocycleId: mesocycle.id, idempotencyKey: "review-mesocycle-1" });
  assert.equal(review.kind, "mesocycle_review");
  assert.equal(review.status, "insufficient_data");
  assert.ok(review.missingness.includes("no_performed_set_outcomes"));
  const replay = await app.createMesocycleReview({ userId: "user-1", mesocycleId: mesocycle.id, idempotencyKey: "review-mesocycle-1" });
  assert.deepEqual(replay, review);
  assert.equal((await app.listActionLog("user-1")).some((event) => event.intent === "mesocycle.review"), true);

  const recoveryWeek = mesocycle.weeklyIntents.find((week) => week.ordinal === mesocycle.plannedRecoveryWindow.weekOrdinal);
  assert.ok(recoveryWeek);
  if (!recoveryWeek) return;
  await assert.rejects(
    () => app.evaluateDeloadEndedReplan({ userId: "user-1", mesocycleId: mesocycle.id, occurredOn: recoveryWeek.startDate, idempotencyKey: "deload-too-early" }),
    /deload_not_yet_ended/,
  );
  const evaluation = await app.evaluateDeloadEndedReplan({ userId: "user-1", mesocycleId: mesocycle.id, occurredOn: recoveryWeek.endDate, idempotencyKey: "deload-ended-1" });
  assert.equal(evaluation?.trigger.kind, "deload_ended");
  assert.equal(evaluation?.trigger.causationId, `${mesocycle.id}:${recoveryWeek.id}`);
  const evaluationReplay = await app.evaluateDeloadEndedReplan({ userId: "user-1", mesocycleId: mesocycle.id, occurredOn: recoveryWeek.endDate, idempotencyKey: "deload-ended-1" });
  assert.deepEqual(evaluationReplay, evaluation);
});
