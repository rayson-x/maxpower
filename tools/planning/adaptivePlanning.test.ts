import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { CurrentStagePlanningModule, validateAdaptivePlanCandidate, type AdaptivePlanCandidate } from "../../src/planning";

async function setup(planChangeAuthorization: "ask_this_time" | "always_ask" | "allow_once" | "allow_similar_small" | "deny" = "always_ask") {
  let sequence = 0;
  const app = new LocalProductKernel(new InMemoryCoachLedger(), { now: () => "2026-08-15T20:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone", occurredAt: "2026-08-15T08:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: "bootstrap" },
    profile: { id: "profile", locale: "zh-CN", dailyActivityLevel: "lightly_active", demographics: { ageYears: 30, sex: "male", height: { value: 175, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } } },
    goalContract: { id: "goal", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-15", endDate: "2026-12-15" }, targets: { targetWeight: { value: 78, unit: "kg" } } },
    mandate: { id: "mandate", mode: "collaborative", planChangeAuthorization },
  });
  return app;
}

function candidate(app: LocalProductKernel): AdaptivePlanCandidate {
  const pins = app.getInstalledKnowledgeVersionPins();
  return {
    id: "llm-candidate-1",
    generatedBy: { kind: "llm", runId: "run-1", model: "fixture-llm" },
    planRevision: {
      id: "plan", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, effectiveFrom: "2026-08-16", knowledgePins: pins,
      sessions: [{ id: "session-1", title: "当前阶段全身训练", scheduledFor: "2026-08-16", knowledgePins: pins, tasks: [{ id: "task-1", exerciseVariantId: "dumbbell_bench_press.flat.standard", sets: [{ id: "set-1", targetReps: { min: 8, max: 12 }, targetRir: 3 }] }] }],
      observationContract: { requiredSignals: ["weekly_body_data", "planned_training_outcome", "representative_numeric_intake"], minimumObservationDays: 14, trackingSilenceReviewDays: 7, reviewCadenceDays: 7, successConditions: ["small_surplus_and_training_completed"], progressionConditions: ["reps_progress_with_recovery"], holdConditions: ["window_incomplete"], fallbackConditions: ["execution_friction"], stopConditions: ["safety_hold_or_recovery_decline"] },
    },
    nutritionStrategy: { id: "nutrition", goalContractRef: { kind: "goal_contract", id: "goal", revision: 1 }, status: "active", phase: "hypertrophy", calorieRange: { min: { value: 2450, unit: "kcal" }, max: { value: 2650, unit: "kcal" } }, reviewWindow: { startsAt: "2026-08-16T00:00:00.000+08:00", endsAt: "2026-08-30T00:00:00.000+08:00", minimumWeightObservations: 3 } },
    behaviorChanges: [{ id: "step-1", instruction: "先把当前常见进食量减少或增加一个可执行的小步骤，而不是一次替换全部习惯", burden: "low", preferenceRefs: [] }],
    rationale: ["根据已确认目标组织当前两周"],
    expectedTradeoffs: ["更低负担意味着需要用真实趋势再推进"],
  };
}

async function establishAtRiskPlan(app: LocalProductKernel) {
  const initial = candidate(app);
  initial.id = "initial-high-friction-stage";
  initial.planRevision = {
    ...initial.planRevision,
    effectiveFrom: "2026-08-01",
    sessions: ["morning", "evening"].map((id, index) => ({
      ...initial.planRevision.sessions[0]!,
      id,
      title: `${id} 长课`,
      scheduledFor: `2026-08-15T${index === 0 ? "09" : "18"}:00:00.000+08:00`,
      estimatedDuration: { value: 90, unit: "minutes" as const },
    })),
  };
  initial.nutritionStrategy = { ...initial.nutritionStrategy!, reviewWindow: { startsAt: "2026-08-01T00:00:00.000+08:00", endsAt: "2026-08-30T00:00:00.000+08:00", minimumWeightObservations: 3 } };
  const proposal = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: initial, attempt: 1, idempotencyKey: "initial-propose" });
  assert.equal(proposal.validation.resolution, "confirmation_required", "首个计划无论授权模式都必须确认");
  await app.confirmAdaptivePlanCandidate({ userId: "u1", proposalId: proposal.artifact!.id, idempotencyKey: "initial-confirm" });

  for (const [id, hour] of [["morning", "09"], ["evening", "18"]] as const) {
    await app.recordTimelineFact({
      userId: "u1",
      idempotencyKey: `miss:${id}`,
      fact: { kind: "training", confidence: "confirmed", reportedSession: { executionStatus: "missed", plannedSessionRef: { planId: "plan", planRevision: 1, sessionPrescriptionId: id }, summary: "用户确认没有完成" } },
      envelope: { time: { startedAt: `2026-08-15T${hour}:00:00.000+08:00`, timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
    });
  }
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.state, "at_risk");
  assert.equal(assessment.diagnosis, "plan_friction");
  return assessment;
}

async function frictionAdjustment(app: LocalProductKernel, durationMinutes: number, id: string): Promise<AdaptivePlanCandidate> {
  const domain = await app.readDomainProjection({ userId: "u1" });
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.ok(domain.plan);
  assert.ok(domain.nutritionStrategies[0]);
  return {
    id,
    generatedBy: { kind: "llm", runId: `run:${id}`, model: "fixture-llm" },
    sourceAssessmentId: assessment.id,
    planRevision: {
      ...domain.plan.value,
      baseRevision: domain.plan.revision,
      sessions: domain.plan.value.sessions.map((session) => ({ ...session, estimatedDuration: { value: durationMinutes, unit: "minutes" } })),
    },
    nutritionStrategy: { ...domain.nutritionStrategies[0].value },
    behaviorChanges: [{ id: `step:${id}`, instruction: "先把单次训练缩短到可以稳定完成", burden: "low", preferenceRefs: [] }],
    rationale: ["两次明确漏训且长课形成执行摩擦"],
    expectedTradeoffs: ["先降低单次负担，再根据完成率逐步增加"],
  };
}

test("LLM candidate is fixed-validated, persisted, and atomically commits Plan plus Nutrition revisions", async () => {
  const app = await setup();
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: candidate(app), attempt: 1, idempotencyKey: "propose" });
  assert.equal(proposed.validation.status, "valid");
  assert.equal(proposed.validation.resolution, "confirmation_required");
  assert.ok(proposed.artifact?.adaptivePlanProposal);
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan, undefined);

  const committed = await app.invokeArtifactCardAction({ userId: "u1", artifactId: proposed.artifact!.id, action: "apply", idempotencyKey: "confirm" });
  assert.equal(committed.status, "applied");
  if (committed.status !== "applied" || !("planRevision" in committed)) return;
  assert.equal(committed.planRevision, 1);
  assert.equal(committed.nutritionStrategyRevision, 1);
  const domain = await app.readDomainProjection({ userId: "u1" });
  assert.equal(domain.plan?.value.observationContract?.minimumObservationDays, 14);
  assert.equal(domain.nutritionStrategies[0]?.value.calorieRange?.min.value, 2450);
});

test("CurrentStagePlanningModule is the Pi-facing planning boundary, not mobile composition code", async () => {
  const app = await setup();
  const planning = new CurrentStagePlanningModule(app);
  const fixedInput = await planning.readInput({ userId: "u1" });
  assert.equal((fixedInput.goalContract as { value?: { id?: string } }).value?.id, "goal");

  const proposed = await planning.propose({ userId: "u1", candidate: candidate(app), idempotencyKey: "module-propose" });
  assert.equal(proposed.status, "ready");
  assert.ok(proposed.proposalId);
  assert.ok(proposed.details?.validation.issues.length === 0);
  await planning.confirm({ userId: "u1", proposalId: proposed.proposalId!, idempotencyKey: "module-confirm" });
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.revision, 1);
});

test("manual and Agent surfaces reject the same immutable adaptive Proposal without changing Plan", async () => {
  const app = await setup();
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: candidate(app), attempt: 1, idempotencyKey: "reject-propose" });
  const rejected = await app.invokeArtifactCardAction({ userId: "u1", artifactId: proposed.artifact!.id, action: "reject", idempotencyKey: "reject" });
  assert.equal(rejected.status, "rejected");
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan, undefined);
});

test("candidate without an observation contract cannot become a proposal", async () => {
  const app = await setup();
  const invalid = candidate(app);
  invalid.planRevision = { ...invalid.planRevision, observationContract: undefined };
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: invalid, attempt: 1, idempotencyKey: "invalid" });
  assert.equal(proposed.validation.status, "invalid");
  assert.equal(proposed.artifact, undefined);
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "observation_contract_missing"));
});

test("fixed validation rejects a displayed task dose that differs from its stimulus slot", async () => {
  const app = await setup();
  const invalid = candidate(app);
  invalid.planRevision = {
    ...invalid.planRevision,
    sessions: invalid.planRevision.sessions.map((session) => ({
      ...session,
      tasks: session.tasks.map((task) => ({ ...task, stimulusSlotId: "chest", sets: task.sets.slice(0, 1) })),
      stimulusSlots: [{
        id: "chest",
        intent: { movementPattern: "horizontal_push", muscleGroups: ["chest"], stability: "supported", prescriptionMode: "weighted_reps", fatigueIntent: "medium", priority: "primary" },
        prescription: { setCount: 3, repRange: { min: 8, max: 12 }, targetRir: 3 },
        exerciseSlot: { status: "resolved", exerciseVariantId: "dumbbell_bench_press.flat.standard", satisfiedContracts: [], deviatedContracts: [], requiredEquipment: [], performanceComparability: "cold_start", coldStart: true, sessionTimeImpactMinutes: 0, fatigueImpact: "medium", cameraCapability: "manual_only", reasonCodes: [] },
        lockedFields: [],
      }],
    })),
  };
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: invalid, attempt: 1, idempotencyKey: "dose-mismatch" });
  assert.equal(proposed.validation.status, "invalid");
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "stimulus_slot_task_set_mismatch"));
});

test("fixed safety rejects extreme training, restriction language, and micronutrient targets before proposal", async () => {
  const app = await setup();
  const unsafe = candidate(app);
  unsafe.planRevision = { ...unsafe.planRevision, sessions: unsafe.planRevision.sessions.map((session) => ({ ...session, estimatedDuration: { value: 240, unit: "minutes" as const } })) };
  unsafe.behaviorChanges = [{ id: "unsafe", instruction: "每天禁食并脱水", burden: "high", preferenceRefs: [] }];
  unsafe.nutritionStrategy = { ...unsafe.nutritionStrategy!, nutrientTargets: { sodium: { unit: "mg", target: 100_000 } } };
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: unsafe, attempt: 1, idempotencyKey: "unsafe" });
  assert.equal(proposed.validation.status, "invalid");
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "unsafe_behavior_instruction"));
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "plan_training_dose_outside_guardrail" || issue.code === "training_dose_outside_guardrail"));
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "plan_nutrient_target_outside_guardrail" || issue.code === "nutrient_target_outside_guardrail"));
});

test("managed-like permission cannot auto-apply high-impact or safety-blocked candidates", async () => {
  const app = await setup();
  const domain = await app.readDomainProjection({ userId: "u1" });
  const validation = validateAdaptivePlanCandidate({ candidate: { ...candidate(app), behaviorChanges: [{ id: "hard", instruction: "large change", burden: "high", preferenceRefs: [] }] }, goal: domain.goalContract!, profile: domain.profile!.value, mandate: { ...domain.mandate!.value, planChangeAuthorization: "allow_similar_small" }, today: "2026-08-15", safetyBlocked: false });
  assert.equal(validation.impact, "high");
  assert.equal(validation.resolution, "confirmation_required");
});

test("explicit allow-similar permission marks a fixed-validated low-impact candidate eligible before the product authority commits it", async () => {
  const app = await setup("allow_similar_small");
  await establishAtRiskPlan(app);
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: await frictionAdjustment(app, 45, "low-friction-stage"), attempt: 1, idempotencyKey: "auto-low" });
  assert.equal(proposed.validation.resolution, "auto_apply_eligible");
  assert.equal(proposed.autoApplied, false);
  const applied = await app.confirmAdaptivePlanCandidate({ userId: "u1", proposalId: proposed.artifact!.id, idempotencyKey: "product-authority:auto-low" });
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.value.lifecycle?.state, "active");
  assert.equal(applied.artifact.adaptivePlanProposal?.status, "applied");
  await app.undoAdaptivePlanCandidate({ userId: "u1", appliedArtifactId: applied.artifact.id, idempotencyKey: "undo-auto-low" });
  const restored = await app.readDomainProjection({ userId: "u1" });
  assert.equal(restored.plan?.revision, 3);
  assert.equal(restored.plan?.value.sessions[0]?.estimatedDuration?.value, 90, "撤销通过新 revision 恢复旧阶段，不改写历史");
});

test("allow-once is consumed atomically and the next candidate returns to confirmation", async () => {
  const app = await setup("allow_once");
  await establishAtRiskPlan(app);
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: await frictionAdjustment(app, 45, "once-adjustment"), attempt: 1, idempotencyKey: "auto-once" });
  assert.equal(proposed.validation.resolution, "auto_apply_once_eligible");
  assert.equal(proposed.autoApplied, false);
  await app.confirmAdaptivePlanCandidate({ userId: "u1", proposalId: proposed.artifact!.id, idempotencyKey: "product-authority:auto-once" });

  const domain = await app.readDomainProjection({ userId: "u1" });
  assert.equal(domain.plan?.value.lifecycle?.state, "active");
  assert.equal(domain.mandate?.value.planChangeAuthorization, "always_ask");
  assert.equal(domain.mandate?.revision, 2);

  const next = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: await frictionAdjustment(app, 30, "next-adjustment"), attempt: 1, idempotencyKey: "after-once" });
  assert.equal(next.validation.status, "invalid", "新 revision 尚无执行证据时不能连续自动调整");
  assert.ok(next.validation.issues.some((issue) => issue.code === "candidate_not_supported_by_evidence"));
  assert.equal(next.autoApplied, undefined, "invalid candidates never reach the apply decision");
});

test("ask-this-time is consumed after the user resolves exactly one proposal", async () => {
  const accepted = await setup("ask_this_time");
  const first = await accepted.proposeAdaptivePlanCandidate({ userId: "u1", candidate: candidate(accepted), attempt: 1, idempotencyKey: "ask-once-propose" });
  assert.equal(first.validation.resolution, "confirmation_required");
  await accepted.confirmAdaptivePlanCandidate({ userId: "u1", proposalId: first.artifact!.id, idempotencyKey: "ask-once-confirm" });
  assert.equal((await accepted.readDomainProjection({ userId: "u1" })).mandate?.value.planChangeAuthorization, "deny");

  const rejected = await setup("ask_this_time");
  const second = await rejected.proposeAdaptivePlanCandidate({ userId: "u1", candidate: candidate(rejected), attempt: 1, idempotencyKey: "ask-once-reject-propose" });
  await rejected.rejectAdaptivePlanCandidate({ userId: "u1", proposalId: second.artifact!.id, idempotencyKey: "ask-once-reject" });
  assert.equal((await rejected.readDomainProjection({ userId: "u1" })).mandate?.value.planChangeAuthorization, "deny");
});

test("调整候选不能更换 Plan identity 或省略当前 base revision", async () => {
  const app = await setup();
  await establishAtRiskPlan(app);
  const invalid = await frictionAdjustment(app, 45, "identity-break");
  invalid.planRevision = { ...invalid.planRevision, id: "replacement-plan", baseRevision: 0 };
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: invalid, attempt: 1, idempotencyKey: "identity-break" });
  assert.equal(proposed.validation.status, "invalid");
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "plan_identity_mismatch"));
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "plan_base_revision_mismatch"));
});

test("GoalPath delivery, outcome learning, pause, and reopen use one current Plan lifecycle", async () => {
  const app = await setup();
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: candidate(app), attempt: 1, idempotencyKey: "lifecycle-propose" });
  await app.confirmAdaptivePlanCandidate({ userId: "u1", proposalId: proposed.artifact!.id, idempotencyKey: "lifecycle-confirm" });

  const deliveredOnCommit = (await app.readGoalPathAssessmentArtifacts({ userId: "u1" })).some((artifact) => artifact.goalPathAssessment?.delivery !== "suppressed");
  const first = await app.reviewAndDeliverGoalPath({ userId: "u1", trigger: "daily", channel: "scheduled", idempotencyKey: "daily-1", timezoneOffsetMinutes: 480 });
  const repeated = await app.reviewAndDeliverGoalPath({ userId: "u1", trigger: "daily", channel: "scheduled", idempotencyKey: "daily-2", timezoneOffsetMinutes: 480 });
  assert.equal(deliveredOnCommit, true);
  assert.equal(first.delivered, false);
  assert.equal(repeated.delivered, false);
  assert.equal(repeated.artifact.goalPathAssessment?.suppressionReason, "duplicate");

  const outcome = await app.recordPlanOutcome({ userId: "u1", planId: "plan", planRevision: 1, observedFrom: "2026-08-15", observedThrough: "2026-08-15", timezoneOffsetMinutes: 480, burden: "acceptable", preferenceSignals: [{ behaviorId: "short_full_body", result: "repeated_and_acceptable", source: "confirmed_behavior_and_feedback" }], idempotencyKey: "outcome" });
  assert.equal(outcome.execution.failureDenominator, 0);
  const context = await app.readPlanningOutcomeContext({ userId: "u1" });
  assert.deepEqual(context.preferredBehaviorIds, ["short_full_body"]);

  await app.pausePlan({ userId: "u1", reason: "user_paused", idempotencyKey: "pause" });
  const paused = await app.readProductProjection({ userId: "u1", date: "2026-08-15", timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: "2026-08-15" });
  assert.equal(paused.today.state, "record_first");
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan?.value.lifecycle?.state, "paused");

  await app.reopenPlanning({ userId: "u1", idempotencyKey: "reopen" });
  const reopened = await app.readDomainProjection({ userId: "u1" });
  assert.equal(reopened.plan?.value.lifecycle?.state, "planning_required");
  assert.equal((await app.readProductProjection({ userId: "u1", date: "2026-08-15", timezoneOffsetMinutes: 480, calendarMode: "week", calendarAnchorDate: "2026-08-15" })).today.state, "record_first");
});

test("a fact-frontier change between propose and confirm makes the proposal stale without touching the active Plan", async () => {
  const app = await setup();
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: candidate(app), attempt: 1, idempotencyKey: "stale-propose" });
  assert.equal(proposed.validation.status, "valid");
  // The fact frontier advances after the proposal was validated.
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "stale-frontier-weight",
    fact: { kind: "body", confidence: "confirmed", measurement: { metric: "body_weight", quantity: { value: 75.2, unit: "kg" }, condition: "manual" } },
    envelope: { time: { startedAt: "2026-08-15T19:00:00.000+08:00", timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
  });
  await assert.rejects(
    app.confirmAdaptivePlanCandidate({ userId: "u1", proposalId: proposed.artifact!.id, idempotencyKey: "stale-confirm" }),
    (cause: unknown) => cause instanceof Error && cause.message.includes("adaptive_plan_proposal_stale"),
  );
  assert.equal((await app.readDomainProjection({ userId: "u1" })).plan, undefined);
});

test("a counterfactual that does not materially improve the current path is rejected even with allow-similar permission", async () => {
  const app = await setup("allow_similar_small");
  await establishAtRiskPlan(app);
  // Two 85-minute sessions against the current 2×90: below the fixed 10%
  // friction-reduction threshold, so the counterfactual cannot improve.
  const weak = await frictionAdjustment(app, 85, "weak-friction-stage");
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: weak, attempt: 1, idempotencyKey: "weak-adjustment" });
  assert.equal(proposed.validation.status, "invalid");
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "candidate_does_not_reduce_execution_friction"));
  assert.notEqual(proposed.validation.resolution, "auto_apply_eligible");
});

test("a hard safety signal blocks every authorization mode from applying a normal candidate", async () => {
  const app = await setup("allow_similar_small");
  await establishAtRiskPlan(app);
  await app.recordTimelineFact({
    userId: "u1",
    idempotencyKey: "hard-pain",
    fact: { kind: "symptom", symptom: "pain", area: "lower_back", severity: 8, confidence: "confirmed" },
    envelope: { time: { startedAt: "2026-08-15T19:30:00.000+08:00", timezoneOffsetMinutes: 480 }, provenance: { origin: "manual", recordingMethod: "manual_entry", dataStatus: "available", confidence: "confirmed" }, privacyClass: "sensitive", causalRefs: [], evidenceRefs: [], layer: "raw_observation" },
  });
  const assessment = await app.reviewGoalPath({ userId: "u1", trigger: "explicit_request" });
  assert.equal(assessment.materialSignal, "hard_safety");
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: await frictionAdjustment(app, 45, "safety-blocked-adjustment"), attempt: 1, idempotencyKey: "safety-blocked" });
  assert.equal(proposed.validation.status, "invalid");
  assert.ok(proposed.validation.issues.some((issue) => issue.code === "safety_hold_active"));
  assert.notEqual(proposed.validation.resolution, "auto_apply_eligible", "授权永远不能跨越硬安全处置");
  assert.equal(proposed.autoApplied, undefined);
});

test("recovery advisories are computed deterministically (zero tool calls) and never block resolution", async () => {
  const app = await setup();
  // 昨天 6 组高努力卧推：胸的残差负荷超过提示阈值。
  const pins = app.getInstalledKnowledgeVersionPins();
  await app.prepareFreestyleWorkoutSession({
    userId: "u1",
    workoutId: "heavy-chest",
    idempotencyKey: "heavy-chest-prepare",
    session: { id: "heavy-chest-session", title: "自由训练", scheduledFor: "2026-08-15", knowledgePins: pins, tasks: [{ id: "heavy-chest-task", exerciseVariantId: "bench_press.barbell.decline.close.bilateral.full_rom", sets: Array.from({ length: 6 }, (_, index) => ({ id: `heavy-set-${index}`, targetReps: { min: 6, max: 10 }, targetRir: 1 })) }] },
  });
  await app.activateWorkoutSession({ userId: "u1", workoutId: "heavy-chest", mode: "record_only", idempotencyKey: "heavy-chest-activate" });
  for (let index = 0; index < 6; index += 1) {
    await app.confirmCurrentSet({ userId: "u1", workoutId: "heavy-chest", confirmAsPlanned: true, idempotencyKey: `heavy-chest-set-${index}` });
  }
  await app.completeWorkoutSession({ userId: "u1", workoutId: "heavy-chest", idempotencyKey: "heavy-chest-complete" });

  const withSlots = candidate(app);
  withSlots.planRevision = {
    ...withSlots.planRevision,
    sessions: withSlots.planRevision.sessions.map((session) => ({
      ...session,
      tasks: session.tasks.map((task) => ({ ...task, stimulusSlotId: "chest-slot" })),
      stimulusSlots: [{
        id: "chest-slot",
        intent: { movementPattern: "horizontal_push" as const, muscleGroups: ["chest"], directMuscles: ["chest"], stability: "supported" as const, prescriptionMode: "weighted_reps" as const, fatigueIntent: "medium" as const, priority: "primary" as const },
        prescription: { setCount: 1, repRange: { min: 8, max: 12 }, targetRir: 3, rest: { value: 120, unit: "seconds" as const } },
        exerciseSlot: { status: "resolved" as const, exerciseVariantId: "dumbbell_bench_press.flat.standard", satisfiedContracts: [], deviatedContracts: [], requiredEquipment: ["dumbbell", "bench"], performanceComparability: "cold_start" as const, coldStart: true, sessionTimeImpactMinutes: 0, fatigueImpact: "medium" as const, cameraCapability: "manual_only" as const, reasonCodes: [] },
        lockedFields: [],
      }],
    })),
  };
  const proposed = await app.proposeAdaptivePlanCandidate({ userId: "u1", candidate: withSlots, attempt: 1, idempotencyKey: "advisory-propose" });
  assert.equal(proposed.validation.status, "valid", "恢复提示永不为 invalid");
  const advisories = proposed.validation.issues.filter((issue) => issue.severity === "advisory");
  assert.ok(advisories.some((issue) => issue.code === "recovery_overlap_elevated"), JSON.stringify(proposed.validation.issues));
  assert.ok(proposed.artifact?.adaptivePlanProposal, "advisory 不阻断候选成为可确认提案");
});

test("a candidate missing knowledgePins or goalContractRef is blocked with instructive issues (never a TypeError at confirm)", async () => {
  const app = await setup();
  const domain = await app.readDomainProjection({ userId: "u1" });
  const broken = candidate(app) as unknown as { planRevision: Record<string, unknown> };
  delete broken.planRevision.knowledgePins;
  delete broken.planRevision.goalContractRef;
  for (const session of (broken.planRevision.sessions ?? []) as Record<string, unknown>[]) delete session.knowledgePins;
  const validation = validateAdaptivePlanCandidate({ candidate: broken as unknown as AdaptivePlanCandidate, goal: domain.goalContract!, profile: domain.profile!.value, mandate: domain.mandate!.value, today: "2026-08-15", safetyBlocked: false });
  assert.equal(validation.status, "invalid");
  const codes = validation.issues.map((issue) => issue.code);
  assert.equal(codes.filter((code) => code === "knowledge_pins_missing").length, 2, "revision 级与 session 级各一条");
  assert.ok(codes.includes("goal_ref_mismatch"));
  assert.match(validation.issues.find((issue) => issue.code === "knowledge_pins_missing")?.message ?? "", /knowledgePins/);
});
