import assert from "node:assert/strict";
import test from "node:test";

import {
  createInstalledAgentKnowledgeHarness,
} from "../../src/agent-knowledge";
import {
  PERSONAL_PLANNER_GOAL,
  PERSONAL_PLANNER_PROFILE,
} from "../e2e/personalPlannerFixture";

test("安装的新知识库以 active Release 排他加载并生成个人四分化计划", () => {
  const harness = createInstalledAgentKnowledgeHarness();
  const selection = harness.selection();
  assert.equal(selection.backend, "agent_knowledge");
  if (selection.backend !== "agent_knowledge") throw new Error("agent_knowledge_selection_expected");
  const pin = selection.agentKnowledgeReleasePin;

  assert.equal(pin.id, "knowledge_release.maxpower.planner.v2");
  assert.equal(pin.version, "2.0.0");
  assert.match(pin.contentHash, /^sha256:[a-f0-9]{64}$/);

  const plan = harness.createInitialPlan({
    profile: PERSONAL_PLANNER_PROFILE,
    goalContract: PERSONAL_PLANNER_GOAL,
    currentDate: PERSONAL_PLANNER_GOAL.horizon.startDate,
  });
  assert.deepEqual(plan.week.sessions.map((session) => session.id), [
    "chest",
    "back",
    "legs",
    "shoulders",
  ]);
  for (const session of plan.week.sessions) {
    assert.equal(
      new Set(session.exercises.map((exercise) => exercise.name)).size,
      session.exercises.length,
      `${session.focus} 不能向用户展示无法区分的重复动作`,
    );
  }
  assert.ok(plan.validationResults.every((result) => result.status === "passed"));
  assert.equal(plan.knowledgeReleasePin.id, pin.id);
  assert.ok(
    plan.reasons.some((reason) => reason.knowledgeRefs.includes("claim_projection.training.hypertrophy-frequency-distribution")),
    "计划理由必须引用新版产品批准的训练 Claim",
  );
  assert.ok(
    plan.reasons.some((reason) => reason.knowledgeRefs.includes("claim_projection.weight.niddk-realistic-initial-goal")),
    "能量与趋势理由必须引用新版产品批准的体重目标 Claim",
  );

  const trainingEvidence = harness.search({ query: "有训练经验每周四天，训练频率和训练量怎么分配" });
  assert.equal(trainingEvidence.disposition, "found");
  assert.ok(trainingEvidence.hits.some((hit) =>
    hit.sourceClaimRefs.includes("claim.training.hypertrophy-frequency-distribution")));

  const goalEvidence = harness.search({ query: "减脂目标应该定多快，如何判断目标是否现实" });
  assert.equal(goalEvidence.disposition, "found");
  assert.ok(goalEvidence.hits.some((hit) =>
    hit.sourceClaimRefs.includes("claim.weight.niddk-realistic-initial-goal")));

  const readiness = harness.inspect();
  assert.equal(readiness.artifactCounts.claim, 14);
});
