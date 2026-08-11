import assert from "node:assert/strict";
import test from "node:test";

import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { PlannerDecision } from "../../src/planning";
import { PERSONA_MATRIX, type Persona } from "./personaMatrix";

const CURRENT_DATE = "2026-08-03";

interface PersonaRun {
  persona: Persona;
  decision: PlannerDecision;
  tracePresent: boolean;
  confirmedPlanWritten?: boolean;
  rejectedPlanWritten?: boolean;
}

function fixture(persona: Persona, path: "confirm" | "reject") {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => "2026-08-03T10:00:00.000Z",
      nextId: (prefix: string) => `${persona.id}:${path}:${prefix}-${++sequence}`,
    },
  });
  return { app, ledger };
}

async function bootstrap(app: CoachApplication, persona: Persona, userId: string, path: string) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: persona.profile,
    goalContract: persona.goalContract,
    mandate: persona.mandate,
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: "persona-e2e",
      occurredAt: "2026-08-03T10:00:00.000Z",
      timezoneOffsetMinutes: 480,
      idempotencyKey: `${persona.id}:${path}:bootstrap`,
    },
  });
}

async function runPersona(persona: Persona): Promise<PersonaRun> {
  const previewUserId = `${persona.id}:preview`;
  const previewFixture = fixture(persona, "confirm");
  await bootstrap(previewFixture.app, persona, previewUserId, "confirm");
  const preview = await previewFixture.app.createPlanningPreview({
    userId: previewUserId,
    currentDate: CURRENT_DATE,
    trigger: "initial_plan",
    idempotencyKey: `${persona.id}:confirm:preview`,
  });
  const decision = await previewFixture.app.previewGoalCycle({
    userId: previewUserId,
    currentDate: CURRENT_DATE,
    trigger: "initial_plan",
  });
  const tracePresent = (await previewFixture.ledger.read()).artifacts.some(
    (artifact) => artifact.kind === "plan_trace",
  );

  let confirmedPlanWritten: boolean | undefined;
  if (preview.planningPreview) {
    await previewFixture.app.confirmPlanningPreview({
      userId: previewUserId,
      previewId: preview.id,
      idempotencyKey: `${persona.id}:confirm:apply`,
    });
    confirmedPlanWritten = Boolean((await previewFixture.app.readDomainProjection({ userId: previewUserId })).plan);
  }

  const rejectUserId = `${persona.id}:reject`;
  const rejectFixture = fixture(persona, "reject");
  await bootstrap(rejectFixture.app, persona, rejectUserId, "reject");
  const rejectedPreview = await rejectFixture.app.createPlanningPreview({
    userId: rejectUserId,
    currentDate: CURRENT_DATE,
    trigger: "initial_plan",
    idempotencyKey: `${persona.id}:reject:preview`,
  });
  let rejectedPlanWritten: boolean | undefined;
  if (rejectedPreview.planningPreview) {
    const rejected = await rejectFixture.app.rejectPlanningPreview({
      userId: rejectUserId,
      previewId: rejectedPreview.id,
      idempotencyKey: `${persona.id}:reject:decline`,
    });
    assert.equal(rejected.planningPreview?.status, "rejected", `${persona.id} rejection receipt is explicit`);
    rejectedPlanWritten = Boolean((await rejectFixture.app.readDomainProjection({ userId: rejectUserId })).plan);
  }

  return { persona, decision, tracePresent, confirmedPlanWritten, rejectedPlanWritten };
}

let matrixRuns: Promise<PersonaRun[]> | undefined;

function runMatrix() {
  matrixRuns ??= (async () => {
    const runs: PersonaRun[] = [];
    for (const persona of PERSONA_MATRIX) runs.push(await runPersona(persona));
    return runs;
  })();
  return matrixRuns;
}

function byId(runs: readonly PersonaRun[], id: string): PersonaRun {
  const run = runs.find((candidate) => candidate.persona.id === id);
  assert.ok(run, `matrix is missing ${id}`);
  return run;
}

function printPlanDetails(runs: readonly PersonaRun[]) {
  const requestedIds = new Set(
    (process.env.PERSONA_E2E_IDS ?? "").split(",").filter(Boolean),
  );
  const selectedRuns = requestedIds.size
    ? runs.filter((run) => requestedIds.has(run.persona.id))
    : runs;
  const details = selectedRuns.map((run) => {
    if (run.decision.kind !== "plan_proposal") {
      return { id: run.persona.id, outcome: run.decision.kind, reasonCodes: run.decision.reasonCodes };
    }
    const plan = run.decision.planRevision;
    return {
      id: run.persona.id,
      outcome: run.decision.kind,
      strategy: run.decision.strategySelection?.primary,
      nutrition: plan.nutritionGuidance,
      firstWeek: plan.materializedWeeks?.[0]?.sessions.map((session) => ({
        date: session.scheduledFor,
        kind: session.kind,
        budgetMinutes: session.durationBudget?.value,
        estimatedMinutes: session.estimatedDuration?.value,
        tasks: session.tasks.map((task) => ({
          exercise: task.exerciseVariantId,
          sets: task.sets.length,
          reps: task.sets[0]?.targetReps,
          rir: task.sets[0]?.targetRirRange,
          restSeconds: task.sets[0]?.rest?.value,
        })),
      })),
    };
  });
  console.log("PERSONA_PLANNING_DETAILS=" + JSON.stringify(details));
}

function plannedExerciseIds(run: PersonaRun): readonly string[] {
  if (run.decision.kind !== "plan_proposal") return [];
  return run.decision.planRevision.sessions.flatMap((session) =>
    session.tasks.map((task) => task.exerciseVariantId),
  );
}

test("20 个人设走完预览、确认写入与拒绝不写入的规划闭环", async () => {
  const runs = await runMatrix();

  assert.equal(runs.length, 20);
  for (const run of runs) {
    if (run.decision.kind !== "plan_proposal") continue;
    assert.equal(run.tracePresent, true, `${run.persona.id} plan proposal persists PlannerTrace`);
    assert.equal(run.confirmedPlanWritten, true, `${run.persona.id} confirmation materializes a plan`);
    assert.equal(run.rejectedPlanWritten, false, `${run.persona.id} rejection must not materialize a plan`);
  }

  const proposals = runs.filter((run) => run.decision.kind === "plan_proposal").length;
  const infeasible = runs.length - proposals;
  console.log(`PERSONA_PLANNING_E2E: ${proposals}/${runs.length} proposals, ${infeasible} infeasible`);
  if (process.env.PERSONA_E2E_DETAIL === "1") printPlanDetails(runs);
});

test("未成年人按年龄分档处理：16 岁以下拒绝，16-17 岁允许但显式保守", async () => {
  // 产品决策（用户拍板 2026-08-11）：16 岁以下不自动生成计划（转介监护人+专业指导）；
  // 16-17 岁允许生成，但必须带显式保守标记，不能与成年人无差别对待。
  const runs = await runMatrix();
  const run = byId(runs, "p09-teen-male"); // 17 岁
  assert.equal(run.decision.kind, "plan_proposal", "17 岁应允许生成计划");
  if (run.decision.kind === "plan_proposal") {
    assert.ok(
      run.decision.reasonCodes.some((code: string) => code.startsWith("minor_conservative")),
      `17 岁必须带显式保守标记，实际：${run.decision.reasonCodes.join(", ")}`,
    );
  }
});

test("孕期在确认前必须得到显式转介处理", async () => {
  const runs = await runMatrix();
  const run = byId(runs, "p17-pregnant-female");
  assert.notEqual(
    run.decision.kind,
    "plan_proposal",
    "pregnancy requires an explicit boundary/referral outcome before any training plan can be confirmed",
  );
});

test("关键人口统计缺失必须保留为待追问信息", async () => {
  const runs = await runMatrix();
  const minimalInfo = byId(runs, "p18-minimal-info");
  assert.equal(minimalInfo.decision.kind, "plan_proposal");
  if (minimalInfo.decision.kind !== "plan_proposal") return;
  assert.ok(
    minimalInfo.decision.missing.some((item) => /age|height|weight|demographic/i.test(item)),
    "missing demographics must remain visible to the planning/coach layer for a follow-up question",
  );
});

test("硬性髋铰链限制仍应保留可执行的力量计划", async () => {
  const runs = await runMatrix();
  const backHistory = byId(runs, "p05-male-strength-back-history");
  assert.equal(
    backHistory.decision.kind,
    "plan_proposal",
    "a hip-hinge restriction should remove that slot or use a safe alternative, not suppress every strength session",
  );
  if (backHistory.decision.kind === "plan_proposal") {
    assert.ok(
      backHistory.decision.trace.slots.every((slot) => slot.movementPattern !== "hip_hinge"),
      "the hard hip-hinge restriction must not leak into an emitted plan",
    );
  }
});

test("平台期的恢复维持策略不能显示相反的热量方向", async () => {
  const runs = await runMatrix();
  const plateau = byId(runs, "p10-fatloss-plateau-female");
  assert.equal(plateau.decision.kind, "plan_proposal");
  if (plateau.decision.kind !== "plan_proposal") return;
  assert.equal(plateau.decision.strategySelection?.primary, "recovery_maintenance");
  assert.equal(
    plateau.decision.planRevision.nutritionGuidance?.calorieDirection,
    "maintenance",
    "a recovery-maintenance plateau strategy must not show the user a conflicting deficit direction",
  );
});

test("无器械/无凳/无单杠的地点不能被当成可以做引体和靠凳臀推", async () => {
  const runs = await runMatrix();
  const unsupported = [
    "p04-postpartum-female",
    "p08-frequent-traveler",
    "p13-busy-mom-micro-sessions",
    "p18-minimal-info",
  ].flatMap((id) => {
    const exercises = plannedExerciseIds(byId(runs, id));
    return exercises
      .filter((exercise) => exercise.startsWith("pull_up.") || exercise.includes("hip_thrust.bodyweight.bench_supported"))
      .map((exercise) => `${id}:${exercise}`);
  });
  assert.deepEqual(
    unsupported,
    [],
    "these profiles list neither a pull-up bar nor a bench; bodyweight + floor_space is insufficient",
  );
});

test("力量举备赛者的力量计划必须保留可用的杠铃主项", async () => {
  const runs = await runMatrix();
  const exercises = plannedExerciseIds(byId(runs, "p14-female-powerlifter"));
  assert.ok(
    exercises.some((exercise) => exercise.startsWith("squat.barbell.")),
    "an advanced powerlifter with a full gym, meet preparation and a squat baseline should not receive only band/dumbbell lower-body work",
  );
});

test("专业限制必须在计划推理链中可见，而不是只停留在档案", async () => {
  const runs = await runMatrix();
  for (const id of ["p06-older-male-hypertension", "p15-knee-return-to-training"]) {
    const run = byId(runs, id);
    assert.equal(run.decision.kind, "plan_proposal");
    if (run.decision.kind !== "plan_proposal") continue;
    assert.ok(
      run.decision.trace.constraintEvents.some((event) => /professional|医生|医疗/.test(event)),
      `${id} has a clinician directive, which must remain visible in the emitted plan trace`,
    );
  }
});

test("膝痛大体重用户不能把爬楼间歇作为未确认的默认有氧", async () => {
  const runs = await runMatrix();
  const exercises = plannedExerciseIds(byId(runs, "p11-large-bodyweight-male"));
  assert.ok(
    !exercises.some((exercise) => exercise.startsWith("stair_climb.")),
    "the profile reports knee pain during running; default to a lower-impact option or ask before stairs",
  );
});
