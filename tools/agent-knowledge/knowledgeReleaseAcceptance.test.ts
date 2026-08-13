import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  AgentKnowledgeBackend,
  AgentKnowledgePlanningModule,
  createInstalledAgentKnowledgeHarness,
  type AgentKnowledgeArtifact,
  type AgentKnowledgeArtifactRef,
  type AgentKnowledgeRelease,
  type TriStateResult,
} from "../../src/agent-knowledge";
import {
  PERSONAL_PLANNER_CURRENT_DATE,
  PERSONAL_PLANNER_GOAL,
  PERSONAL_PLANNER_PROFILE,
} from "../e2e/personalPlannerFixture";

interface CorpusReleaseRecord {
  readonly schemaVersion: "wiki-corpus/v1";
  readonly recordType: "corpus_release";
  readonly id: string;
  readonly semanticVersion: string;
  readonly contentHash: string;
  readonly records: readonly { readonly id: string }[];
}

interface FixtureExpected {
  readonly evaluation: TriStateResult;
}

const WIKI_RELEASES = resolve(process.cwd(), "../wiki/records/releases");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function agentKnowledgeReleases(): readonly AgentKnowledgeRelease[] {
  return readdirSync(WIKI_RELEASES)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJson(resolve(WIKI_RELEASES, entry)))
    .filter((value): value is AgentKnowledgeRelease => (
      typeof value === "object"
      && value !== null
      && (value as { readonly schemaVersion?: string }).schemaVersion === "agent-knowledge/v1"
    ));
}

function corpusReleases(): ReadonlyMap<string, CorpusReleaseRecord> {
  const releases = readdirSync(WIKI_RELEASES)
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => readJson(resolve(WIKI_RELEASES, entry)))
    .filter((value): value is CorpusReleaseRecord => (
      typeof value === "object"
      && value !== null
      && (value as { readonly schemaVersion?: string }).schemaVersion === "wiki-corpus/v1"
      && (value as { readonly recordType?: string }).recordType === "corpus_release"
    ));
  return new Map(releases.map((release) => [release.id, release]));
}

function artifactValue<T>(artifact: AgentKnowledgeArtifact, key: string): T {
  return artifact[key] as T;
}

test("每条 Artifact Claim 都属于 Agent Release 固定的 Corpus Release", () => {
  const corpora = corpusReleases();
  const releases = agentKnowledgeReleases();
  assert.ok(releases.length > 0, "没有可验收的 Agent Knowledge Release");
  for (const release of releases) {
    const corpus = corpora.get(artifactValue<{ readonly id: string }>(release as unknown as AgentKnowledgeArtifact, "corpusReleasePin").id);
    assert.ok(corpus, `${release.releaseId} 缺少固定的 Corpus Release`);
    const pin = artifactValue<{
      readonly semanticVersion: string;
      readonly contentHash: string;
    }>(release as unknown as AgentKnowledgeArtifact, "corpusReleasePin");
    assert.equal(pin.semanticVersion, corpus.semanticVersion, `${release.releaseId} Corpus version pin 漂移`);
    assert.equal(pin.contentHash, corpus.contentHash, `${release.releaseId} Corpus hash pin 漂移`);

    const admitted = new Set(corpus.records.map((record) => record.id));
    for (const artifact of release.artifacts) {
      for (const claimRef of artifact.sourceClaimRefs) {
        assert.ok(
          admitted.has(claimRef),
          `${release.releaseId} 的 ${artifact.kind}:${artifact.id} 引用了未进入 pinned Corpus Release 的 ${claimRef}`,
        );
      }
    }
  }
});

test("每条 Rule 的 matched / not_matched / unknown fixture 都由真实运行时求值得到", () => {
  const releases = agentKnowledgeReleases().filter((candidate) => candidate.artifacts.some((artifact) => artifact.kind === "rule"));
  assert.ok(releases.length > 0, "没有含 Rule 的 Agent Knowledge Release");
  for (const release of releases) {
    const backend = AgentKnowledgeBackend.load(release, { mode: "offline_evaluation" });
    const rules = new Map(release.artifacts
      .filter((artifact) => artifact.kind === "rule")
      .map((artifact) => [artifact.id, artifact]));
    const coverage = new Map<string, Set<TriStateResult>>();

    for (const fixture of release.artifacts.filter((artifact) => artifact.kind === "fixture")) {
      const target = artifactValue<AgentKnowledgeArtifactRef>(fixture, "targetArtifactRef");
      const rule = target.kind === "rule" ? rules.get(target.id) : undefined;
      if (!rule) continue;
      assert.equal(target.contentHash, rule.contentHash, `${fixture.id} target hash 漂移`);
      const expected = artifactValue<FixtureExpected>(fixture, "expected").evaluation;
      const decision = backend.resolveDecision({
        scope: rule.scopes[0]!,
        facts: artifactValue<Readonly<Record<string, unknown>>>(fixture, "inputFacts"),
      });
      const actual = decision.evaluations.find((evaluation) => evaluation.ruleRef.id === rule.id)?.result;
      assert.equal(actual, expected, `${release.releaseId}/${fixture.id}`);
      const evaluations = coverage.get(rule.id) ?? new Set<TriStateResult>();
      evaluations.add(expected);
      coverage.set(rule.id, evaluations);
    }

    for (const rule of rules.values()) {
      assert.deepEqual(
        [...(coverage.get(rule.id) ?? [])].sort(),
        ["matched", "not_matched", "unknown"],
        `${release.releaseId}/${rule.id} 三值 fixture 不完整`,
      );
    }
  }
});

test("hard Constraint 不会被任意高权重 Objective 抵消", () => {
  const releases = agentKnowledgeReleases().filter((candidate) => candidate.artifacts.some((artifact) => artifact.kind === "rule"));
  assert.ok(releases.length > 0, "没有含 Rule 的 Agent Knowledge Release");
  for (const release of releases) {
    const amplified = structuredClone(release) as AgentKnowledgeRelease;
    for (const objective of amplified.artifacts.filter((artifact) => artifact.kind === "objective")) {
      (objective as { weight?: number }).weight = Number.MAX_SAFE_INTEGER;
    }
    const backend = AgentKnowledgeBackend.load(amplified, { mode: "offline_evaluation" });
    const constraints = new Map(amplified.artifacts
      .filter((artifact) => artifact.kind === "constraint")
      .map((artifact) => [artifact.id, artifact]));
    const fixtures = amplified.artifacts.filter((artifact) => (
      artifact.kind === "fixture"
      && artifactValue<FixtureExpected>(artifact, "expected").evaluation === "matched"
    ));
    let checked = 0;

    for (const rule of amplified.artifacts.filter((artifact) => artifact.kind === "rule")) {
      const hardTargets = artifactValue<readonly { readonly type: string; readonly targetRef: string }[]>(rule, "onMatched")
        .filter((effect) => {
          if (effect.type !== "emit_constraint") return false;
          const constraint = constraints.get(effect.targetRef);
          assert.ok(constraint, `${release.releaseId}/${rule.id} 引用了不存在的 Constraint ${effect.targetRef}`);
          return artifactValue<string>(constraint, "hardness") === "hard";
        })
        .map((effect) => effect.targetRef);
      if (!hardTargets.length) continue;
      const fixture = fixtures.find((candidate) => (
        artifactValue<AgentKnowledgeArtifactRef>(candidate, "targetArtifactRef").id === rule.id
      ));
      assert.ok(fixture, `${release.releaseId}/${rule.id} 缺 matched fixture`);
      const decision = backend.resolveDecision({
        scope: rule.scopes[0]!,
        facts: artifactValue<Readonly<Record<string, unknown>>>(fixture, "inputFacts"),
      });
      const emitted = new Set(decision.constraints.map((constraint) => constraint.id));
      for (const target of hardTargets) {
        assert.ok(emitted.has(target), `${release.releaseId}/${rule.id} 的 hard constraint 被 Objective 抵消`);
        checked += 1;
      }
    }
    assert.ok(checked > 0, `${release.releaseId} 没有实际验收任何 hard constraint`);
  }
});

test("active runtime 缺失知识时失败关闭，不能回退 Legacy", () => {
  const installed = createInstalledAgentKnowledgeHarness();
  const selection = installed.selection();
  assert.equal(selection.backend, "agent_knowledge");
  assert.equal("legacyPackPin" in selection, false);

  const active = agentKnowledgeReleases().find((release) => release.status === "active");
  assert.ok(active, "缺少 active Agent Knowledge Release");
  const incomplete: AgentKnowledgeRelease = {
    ...structuredClone(active),
    artifacts: active.artifacts.filter((artifact) => (
      artifact.id !== "action.initial-plan.resolve-exercises"
    )),
  };
  const backend = AgentKnowledgeBackend.load(incomplete, {
    mode: "client_active",
    appSchemaVersion: 1,
  });
  const planner = new AgentKnowledgePlanningModule(backend);
  assert.throws(
    () => planner.createInitialPlan({
      profile: PERSONAL_PLANNER_PROFILE,
      goalContract: PERSONAL_PLANNER_GOAL,
      currentDate: PERSONAL_PLANNER_CURRENT_DATE,
    }),
    /agent_knowledge_artifact_missing:action\.initial-plan\.resolve-exercises/,
  );
});
