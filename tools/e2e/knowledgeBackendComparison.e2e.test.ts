import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AgentKnowledgeBackend,
  assertExclusiveKnowledgeSelection,
} from "../../src/agent-knowledge";
import { createInstalledKnowledgePack, KnowledgePackRegistry } from "../../src/knowledge";
import { KnowledgeBackendComparisonHarness } from "./KnowledgeBackendComparisonHarness";
import {
  PERSONAL_PLANNER_GOAL,
  PERSONAL_PLANNER_PROFILE,
} from "./personalPlannerFixture";

function loadAgentKnowledgeRelease(): unknown {
  return JSON.parse(readFileSync(resolve(
    process.cwd(),
    "../wiki/records/releases/generated.knowledge_release.maxpower.existing-knowledge.json",
  ), "utf8"));
}

test("活动知识选择拒绝在一次运行中同时接入 Legacy 与 Agent Knowledge", () => {
  assert.throws(
    () => assertExclusiveKnowledgeSelection({
      backend: "legacy",
      legacyPackPin: {
        id: "maxpower.core-fitness-knowledge",
        version: "1.0.0",
        contentHash: "fnv1a-2848d0b7",
      },
      agentKnowledgeReleasePin: {
        id: "knowledge_release.maxpower.existing-knowledge",
        version: "0.1.0",
        contentHash: `sha256:${"1".repeat(64)}`,
      },
    }),
    /knowledge_backend_not_exclusive/,
  );
});

test("shadow Agent Knowledge Release 不能冒充客户端 active Release", () => {
  assert.throws(
    () => AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), { mode: "client_active" }),
    /agent_knowledge_release_not_active/,
  );
});

test("待人工审核的 Wiki enrichment 不会越过编译门禁进入运行时 Release", () => {
  const release = loadAgentKnowledgeRelease() as {
    artifacts?: readonly { sourceClaimRefs?: readonly string[] }[];
  };
  const runtimeClaimRefs = new Set(
    (release.artifacts ?? []).flatMap((artifact) => artifact.sourceClaimRefs ?? []),
  );
  const forbiddenPrefixes = [
    "claim.nutrition.dgac-adult-",
    "claim.weight.niddk-model-",
    "claim.weight.niddk-pride-",
    "claim.weight.niddk-reduced-weight-",
    "claim.nutrition.china-dri-2023-",
    "claim.nutrition.efsa-adult-choline-",
  ];
  assert.deepEqual(
    [...runtimeClaimRefs].filter((claimRef) => forbiddenPrefixes.some((prefix) => claimRef.startsWith(prefix))),
    [],
  );
});

test("Agent Knowledge 从独立 Release 召回可追溯 Claim，不投影成旧 KnowledgePack", () => {
  const backend = AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
    mode: "offline_evaluation",
  });

  const result = backend.searchEvidence({ query: "肌酸", limit: 5 });

  assert.equal(result.disposition, "found");
  assert.equal(result.releasePin.id, "knowledge_release.maxpower.existing-knowledge");
  assert.ok(
    result.hits.some((hit) =>
      hit.artifactRef?.id === "claim_projection.supplements.issn-creatine-monohydrate-efficacy"
      && hit.sourceClaimRefs.includes("claim.supplements.issn-creatine-monohydrate-efficacy")
      && hit.cannotSupport.length > 0),
    "肌酸结果必须直接保留 Corpus Claim 与 cannotSupport，而不是退化成无权威文本",
  );
});

test("Agent Knowledge 召回必须命中领域锚点，不能用旁支 Claim 凑答案", () => {
  const backend = AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
    mode: "offline_evaluation",
  });

  const creatine = backend.searchEvidence({ query: "肌酸有效吗，安全吗", limit: 2 });
  const unsupportedRecomposition = backend.searchEvidence({
    query: "身体重组是不是所有人都适合",
    limit: 5,
  });

  assert.deepEqual(
    creatine.hits.map((hit) => hit.artifactRef.id),
    [
      "claim_projection.supplements.issn-creatine-monohydrate-efficacy",
      "claim_projection.supplements.issn-creatine-safety-healthy-adults",
    ],
  );
  assert.equal(unsupportedRecomposition.disposition, "not_found");
  assert.deepEqual(unsupportedRecomposition.hits, []);
});

test("复合问题必须覆盖各子意图，空腹与并发查询不能返回泛训练 Claim", () => {
  const backend = AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
    mode: "offline_evaluation",
  });

  const hypertrophy = backend.searchEvidence({
    query: "增肌每周几组，训练频率怎么安排",
    limit: 5,
  });
  const fasted = backend.searchEvidence({ query: "空腹力量训练可以吗", limit: 5 });
  const concurrent = backend.searchEvidence({
    query: "力量训练和有氧训练同一天应该怎么排序",
    limit: 5,
  });

  assert.ok(hypertrophy.hits.some((hit) =>
    hit.artifactRef.id === "claim_projection.training.hypertrophy-weekly-volume"));
  assert.ok(hypertrophy.hits.some((hit) =>
    hit.artifactRef.id === "claim_projection.training.hypertrophy-frequency-distribution"));
  assert.deepEqual(
    fasted.hits.map((hit) => hit.artifactRef.id),
    ["claim_projection.maxpower.citation.schoenfeld-2014-fasted-vs-fed"],
  );
  assert.deepEqual(
    concurrent.hits.map((hit) => hit.artifactRef.id),
    ["claim_projection.training.hypertrophy-concurrent-training"],
  );
});

test("Agent Knowledge 用三值规则生成 Decision Pack，缺失事实不会被当作未命中", () => {
  const backend = AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
    mode: "offline_evaluation",
  });

  const matched = backend.resolveDecision({
    scope: "pre_session",
    facts: {
      "session.workType": "strength",
      "session.plannedMinutes": 75,
      "user.ageYears": 30,
      "user.adultConfirmed": true,
      "user.healthFlags": [],
      "user.professionalClearanceRequired": false,
    },
  });
  const unknown = backend.resolveDecision({ scope: "pre_session", facts: {} });

  assert.equal(matched.disposition, "ready");
  assert.deepEqual(
    matched.constraints.map((constraint) => constraint.id),
    ["constraint.legacy.fasted-blocks-strength"],
  );
  assert.equal(
    matched.evaluations.find((item) => item.ruleRef.id === "rule.legacy.fasted-blocks-strength")?.result,
    "matched",
  );
  assert.equal(unknown.disposition, "insufficient_evidence");
  assert.ok(unknown.missingFactKeys.includes("session.workType"));
  assert.ok(unknown.evaluations.every((item) => item.result === "unknown"));
});

test("新 Release 具备独立生成初始计划所需的领域目录与可执行资产", () => {
  const backend = AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
    mode: "offline_evaluation",
  });

  const readiness = backend.inspectPlanningReadiness();

  assert.equal(readiness.status, "ready");
  assert.deepEqual(readiness.missingCapabilities, []);
  assert.ok(readiness.exerciseCatalogCount >= 300);
  assert.ok(readiness.artifactCounts.objective > 0);
  assert.ok(readiness.artifactCounts.action > 0);
  assert.ok(readiness.artifactCounts.observation > 0);
  assert.ok(readiness.artifactCounts.calculator > 0);
  assert.ok(readiness.artifactCounts.validator > 0);
});

test("离线 Harness 以相同输入独立运行两套后端并输出可解释差异", () => {
  const harness = new KnowledgeBackendComparisonHarness({
    legacy: new KnowledgePackRegistry(createInstalledKnowledgePack()),
    agentKnowledge: AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
      mode: "offline_evaluation",
    }),
  });

  const report = harness.run([
    { id: "creatine", query: "肌酸有效吗，安全吗" },
    {
      id: "fasted-strength",
      query: "空腹力量训练可以吗",
      decision: {
        scope: "pre_session",
        facts: {
          "session.workType": "strength",
          "session.plannedMinutes": 75,
          "user.ageYears": 30,
          "user.adultConfirmed": true,
          "user.healthFlags": [],
          "user.professionalClearanceRequired": false,
        },
      },
    },
  ]);

  assert.equal(report.executionMode, "isolated_offline_replay");
  assert.equal(report.runtimeMergeAllowed, false);
  assert.equal(report.summary.completePlanOutputComparable, true);
  assert.equal(report.legacy.planningReadiness.status, "ready");
  assert.equal(report.agentKnowledge.planningReadiness.status, "ready");
  const fasted = report.scenarios.find((scenario) => scenario.id === "fasted-strength");
  assert.ok(fasted);
  assert.equal(fasted.legacy.decision?.disposition, "ready");
  assert.ok(fasted.legacy.decision?.constraintIds.length);
  assert.equal(fasted.agentKnowledge.decision?.disposition, "ready");
  assert.ok(fasted.agentKnowledge.decision?.constraintIds.length);
  assert.notEqual(fasted.legacy.releasePin.id, fasted.agentKnowledge.releasePin.id);
});

test("同档案比较器分别运行旧 Planner 与 Agent Knowledge Planner", async () => {
  const harness = new KnowledgeBackendComparisonHarness({
    legacy: new KnowledgePackRegistry(createInstalledKnowledgePack()),
    agentKnowledge: AgentKnowledgeBackend.load(loadAgentKnowledgeRelease(), {
      mode: "offline_evaluation",
    }),
  });

  const report = await harness.runSameProfile(PERSONAL_PLANNER_PROFILE, PERSONAL_PLANNER_GOAL);

  assert.equal(report.executionMode, "isolated_same_profile_replay");
  assert.equal(report.runtimeMergeAllowed, false);
  assert.equal(report.input.profileId, "personal-profile");
  assert.equal(report.input.goalContractId, "personal-goal");
  assert.equal(report.legacy.status, "ready");
  assert.equal(report.agentKnowledge.status, "ready");
  assert.notEqual(report.legacy.knowledgePin.id, report.agentKnowledge.knowledgePin.id);
  assert.equal(report.agentKnowledge.sessions.length, 4);
  assert.deepEqual(report.agentKnowledge.sessions.map((session) => session.focusId), ["chest", "back", "legs", "shoulders"]);
  assert.ok(report.agentKnowledge.sessions.some((session) => session.focusId === "legs"));
  assert.ok(report.agentKnowledge.validationResults.every((result) => result.status === "passed"));
});
