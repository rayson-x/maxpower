import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  const app = new CoachApplication(new InMemoryCoachLedger(), {
    now: () => "2026-08-09T12:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return app;
}

function fixtureWithLedger() {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication(ledger, {
    now: () => "2026-08-09T12:00:00.000+08:00",
    nextId: (prefix) => `${prefix}-${++sequence}`,
  });
  return { app, ledger };
}

async function bootstrapStrategy(app: CoachApplication, mode: "manual" | "collaborative" | "managed" = "collaborative") {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId: "u1",
      actor: { kind: "user", id: "u1" },
      deviceId: "phone-1",
      occurredAt: "2026-08-09T08:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: "bootstrap",
    },
    profile: {
      id: "profile-1", trainingExperience: "intermediate", locale: "zh-CN", adultConfirmed: true,
      schedule: { weeklyFrequency: 3, sessionDurationMinutes: 45 },
      locations: [{ id: "gym-1", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: "goal-1",
      primaryGoal: "fat_loss_preserve_lean_mass",
      horizon: { startDate: "2026-08-01", endDate: "2026-12-01" },
    },
    mandate: {
      id: "mandate-1",
      mode,
      scopes: {
        loadReps: "confirm",
        volume: "confirm",
        substitution: "confirm",
        schedule: "confirm",
        deload: "confirm",
        nutrition: mode === "manual" ? "advice_only" : "confirm",
      },
    },
  });
  const strategy = app.createNutritionStrategy({
    id: "nutrition-1",
    goalContractRef: { kind: "goal_contract", id: "goal-1", revision: 1 },
    phase: "fat_loss_preserve_lean_mass",
    bodyMassKg: 80,
    estimatedMaintenanceKcal: 2500,
    reviewWindow: { startsAt: "2026-08-01", endsAt: "2026-08-15", minimumWeightObservations: 3 },
    safety: { adultConfirmed: true },
  });
  await app.commitNutritionStrategy({ userId: "u1", strategy, idempotencyKey: "nutrition-initial" });
}

test("可靠趋势只生成待确认的营养 Proposal；确认和撤销均以补偿版本留下审计", async () => {
  const app = fixture();
  await bootstrapStrategy(app);

  const proposed = await app.proposeNutritionStrategyChangeArtifact({
    userId: "u1",
    nutritionStrategyId: "nutrition-1",
    observedDays: 14,
    comparableWeeks: 2,
    adherence: "reliable",
    trend: "too_high",
    safety: { adultConfirmed: true },
    idempotencyKey: "nutrition-review-1",
  });
  assert.equal(proposed.status, "proposal");
  if (proposed.status !== "proposal") return;
  assert.equal(proposed.artifact.kind, "nutrition_change_proposal");
  assert.equal(proposed.card.actions.find((action) => action.id === "apply")?.enabled, true);
  assert.equal((await app.readDomainProjection({ userId: "u1" })).nutritionStrategies[0]?.revision, 1);

  const applied = await app.invokeArtifactCardAction({
    userId: "u1",
    artifactId: proposed.artifact.id,
    action: "apply",
    idempotencyKey: "nutrition-apply-1",
  });
  assert.equal("status" in applied && applied.status, "applied");
  const afterApply = await app.readDomainProjection({ userId: "u1" });
  assert.equal(afterApply.nutritionStrategies[0]?.revision, 2);
  assert.ok(
    afterApply.nutritionStrategies[0]!.value.calorieRange!.max.value <
      proposed.artifact.proposal.before.calorieRange!.max.value,
  );

  const receiptId = "receipt" in applied ? applied.receipt.id : "";
  assert.ok(receiptId);
  const undone = await app.invokeArtifactCardAction({
    userId: "u1",
    artifactId: receiptId,
    action: "undo",
    idempotencyKey: "nutrition-undo-1",
  });
  assert.equal("status" in undone && undone.status, "undone");
  const afterUndo = await app.readDomainProjection({ userId: "u1" });
  assert.equal(afterUndo.nutritionStrategies[0]?.revision, 3);
  assert.equal(
    afterUndo.nutritionStrategies[0]?.value.calorieRange?.max.value,
    proposed.artifact.proposal.before.calorieRange?.max.value,
  );
  const actions = await app.listActionLog("u1");
  assert.deepEqual(
    actions.filter((event) => event.targetId === "nutrition-1").map((event) => event.action),
    ["fact.written", "nutrition.strategy.proposed", "nutrition.strategy.applied", "nutrition.strategy.undone"],
  );
});

test("营养 Proposal 在事实变动、风险或 advice-only mandate 下会保持不可应用", async () => {
  const app = fixture();
  await bootstrapStrategy(app);
  const proposed = await app.proposeNutritionStrategyChangeArtifact({
    userId: "u1",
    nutritionStrategyId: "nutrition-1",
    observedDays: 14,
    comparableWeeks: 2,
    adherence: "reliable",
    trend: "too_high",
    safety: { adultConfirmed: true },
    idempotencyKey: "nutrition-review-stale",
  });
  if (proposed.status !== "proposal") return assert.fail("expected a proposal");
  await app.commitNutritionStrategy({
    userId: "u1",
    strategy: { ...proposed.artifact.proposal.before, confidence: "trend_calibrated" },
    expectedRevision: 1,
    idempotencyKey: "nutrition-external-revision",
  });
  await assert.rejects(
    app.invokeArtifactCardAction({
      userId: "u1",
      artifactId: proposed.artifact.id,
      action: "apply",
      idempotencyKey: "nutrition-apply-stale",
    }),
    /nutrition_proposal_stale/,
  );
  const inspected = await app.inspectNutritionStrategyChangeProposal({ userId: "u1", artifactId: proposed.artifact.id });
  assert.equal(inspected.status, "stale");

  const manual = fixture();
  await bootstrapStrategy(manual, "manual");
  const adviceOnly = await manual.proposeNutritionStrategyChangeArtifact({
    userId: "u1",
    nutritionStrategyId: "nutrition-1",
    observedDays: 14,
    comparableWeeks: 2,
    adherence: "reliable",
    trend: "too_high",
    safety: { adultConfirmed: true },
    idempotencyKey: "nutrition-review-manual",
  });
  assert.equal(adviceOnly.status, "proposal");
  if (adviceOnly.status !== "proposal") return;
  assert.equal(adviceOnly.card.actions.find((action) => action.id === "apply")?.enabled, false);
  await assert.rejects(
    manual.invokeArtifactCardAction({
      userId: "u1",
      artifactId: adviceOnly.artifact.id,
      action: "apply",
      idempotencyKey: "nutrition-apply-manual",
    }),
    /nutrition_proposal_advice_only/,
  );
});

test("真实已物化计划只能经确认卡对齐 Nutrition day type，漏训不会自动削减饮食", async () => {
  const app = fixture();
  await bootstrapStrategy(app);
  const plan = await app.materializeGoalCycle({
    userId: "u1", trigger: "initial_plan", currentDate: "2026-08-10", idempotencyKey: "nutrition-coordination-plan",
  });
  assert.equal(plan.kind, "plan_proposal");
  const proposal = await app.proposeNutritionPlanCoordinationArtifact({
    userId: "u1", nutritionStrategyId: "nutrition-1", currentDate: "2026-08-10", idempotencyKey: "nutrition-coordination-proposal",
  });
  assert.equal(proposal.status, "proposal");
  if (proposal.status !== "proposal") return;
  assert.equal(proposal.artifact.proposal.changeKind, "day_type_coordination");
  assert.equal(proposal.artifact.proposal.expectedDirection, "hold");
  assert.deepEqual(proposal.artifact.proposal.before.calorieRange, proposal.artifact.proposal.after.calorieRange);
  assert.ok(proposal.artifact.evidenceRefs.some((ref) => ref.aggregate === "plan"));
  const before = await app.readDomainProjection({ userId: "u1" });
  assert.equal(before.nutritionStrategies[0]?.revision, 1);
  const applied = await app.invokeArtifactCardAction({
    userId: "u1", artifactId: proposal.artifact.id, action: "apply", idempotencyKey: "nutrition-coordination-apply",
  });
  assert.equal("status" in applied && applied.status, "applied");
  const after = await app.readDomainProjection({ userId: "u1" });
  assert.equal(after.nutritionStrategies[0]?.revision, 2);
  assert.equal(after.nutritionStrategies[0]?.value.dayTypes?.length! > 0, true);
  const missed = await app.proposeNutritionPlanCoordinationArtifact({
    userId: "u1", nutritionStrategyId: "nutrition-1", currentDate: "2026-08-10", idempotencyKey: "nutrition-coordination-missed",
  });
  assert.equal(missed.status, "no_change");
  if (missed.status === "no_change") assert.ok(missed.reasonCodes.includes("nutrition_day_types_already_aligned"));
});

test("后续已提交的计划修订自动创建营养日类型确认卡，但不直接改写策略", async () => {
  const { app, ledger } = fixtureWithLedger();
  await bootstrapStrategy(app);
  await app.materializeGoalCycle({
    userId: "u1", trigger: "initial_plan", currentDate: "2026-08-10", idempotencyKey: "nutrition-auto-initial-plan",
  });

  const initialSnapshot = await app.readDomainProjection({ userId: "u1" });
  assert.equal(
    initialSnapshot.nutritionStrategies.find((strategy) => strategy.value.id === "nutrition-1")?.revision,
    1,
  );
  assert.ok(initialSnapshot.profile, "fixture requires a profile");
  if (!initialSnapshot.profile) throw new Error("fixture requires a profile");

  await app.executeDomainCommand({
    type: "profile.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1",
      occurredAt: "2026-08-10T12:00:00.000+08:00", timezoneOffsetMinutes: 480,
      idempotencyKey: "nutrition-auto-plan-schedule-change",
    },
    profileId: initialSnapshot.profile.value.id,
    expectedRevision: initialSnapshot.profile.revision,
    profile: {
      ...initialSnapshot.profile.value,
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 45 },
    },
  });
  await app.materializeGoalCycle({
    userId: "u1", trigger: "schedule_changed", currentDate: "2026-08-10", idempotencyKey: "nutrition-auto-revised-plan",
  });

  const snapshot = await app.readDomainProjection({ userId: "u1" });
  const automaticProposals = (await ledger.read()).artifacts.filter(
    (artifact) => artifact.kind === "nutrition_change_proposal" && artifact.userId === "u1",
  );
  assert.equal(automaticProposals.length, 1);
  const proposal = automaticProposals[0];
  if (!proposal || proposal.kind !== "nutrition_change_proposal") throw new Error("expected nutrition proposal");
  assert.equal(proposal.proposal.changeKind, "day_type_coordination");
  assert.equal(proposal.proposal.requiresConfirmation, true);
  assert.deepEqual(proposal.proposal.before.calorieRange, proposal.proposal.after.calorieRange);
  assert.equal(snapshot.nutritionStrategies.find((strategy) => strategy.value.id === "nutrition-1")?.revision, 1);
  assert.equal((await app.inspectNutritionStrategyChangeProposal({ userId: "u1", artifactId: proposal.id })).status, "awaiting_user");
});

test("通用 PlanRevision 路径会失效旧营养协调卡并幂等地产生最新确认卡", async () => {
  const { app, ledger } = fixtureWithLedger();
  await bootstrapStrategy(app);
  await app.materializeGoalCycle({
    userId: "u1", trigger: "initial_plan", currentDate: "2026-08-10", idempotencyKey: "nutrition-generic-initial-plan",
  });
  const initial = await app.readDomainProjection({ userId: "u1" });
  assert.ok(initial.plan, "fixture requires a materialized plan");
  if (!initial.plan) throw new Error("fixture requires a materialized plan");

  const revise = (expectedRevision: number, key: string) => app.executeDomainCommand({
    type: "plan.revise",
    meta: {
      userId: "u1", actor: { kind: "user", id: "u1" }, deviceId: "phone-1",
      occurredAt: "2026-08-10T12:00:00.000+08:00", timezoneOffsetMinutes: 480, idempotencyKey: key,
    },
    planId: initial.plan!.value.id,
    expectedRevision,
    revision: {
      ...initial.plan!.value,
      reasonCodes: [...(initial.plan!.value.reasonCodes ?? []), `user_revision_${expectedRevision + 1}`],
    },
  });

  await revise(initial.plan.revision, "nutrition-generic-plan-2");
  await revise(initial.plan.revision, "nutrition-generic-plan-2");
  const first = (await ledger.read()).artifacts.filter(
    (artifact) => artifact.kind === "nutrition_change_proposal" && artifact.userId === "u1",
  );
  assert.equal(first.length, 1);
  const staleCandidate = first[0];
  if (!staleCandidate || staleCandidate.kind !== "nutrition_change_proposal") throw new Error("expected coordination proposal");

  const afterFirst = await app.readDomainProjection({ userId: "u1" });
  assert.ok(afterFirst.plan, "fixture requires revised plan");
  if (!afterFirst.plan) throw new Error("fixture requires revised plan");
  await revise(afterFirst.plan.revision, "nutrition-generic-plan-3");

  assert.equal(
    (await app.inspectNutritionStrategyChangeProposal({ userId: "u1", artifactId: staleCandidate.id })).status,
    "stale",
  );
  await assert.rejects(
    app.invokeArtifactCardAction({
      userId: "u1", artifactId: staleCandidate.id, action: "apply", idempotencyKey: "nutrition-generic-stale-apply",
    }),
    /nutrition_proposal_stale/,
  );
  const latest = (await ledger.read()).artifacts.filter(
    (artifact) => artifact.kind === "nutrition_change_proposal" && artifact.userId === "u1",
  );
  assert.equal(latest.length, 2);
  const strategy = await app.readDomainProjection({ userId: "u1" });
  assert.equal(strategy.nutritionStrategies.find((item) => item.value.id === "nutrition-1")?.revision, 1);
});
