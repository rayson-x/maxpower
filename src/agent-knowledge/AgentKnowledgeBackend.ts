import type {
  AgentKnowledgeArtifact,
  AgentKnowledgeArtifactKind,
  AgentKnowledgeArtifactRef,
  AgentKnowledgeDecisionPack,
  AgentKnowledgeDomainCatalog,
  AgentKnowledgeEvidenceHit,
  AgentKnowledgeEvidenceResult,
  AgentKnowledgePlanningReadiness,
  AgentKnowledgeRelease,
  DecisionEffect,
  TriStateExpression,
  TriStateResult,
} from "./model";
import type { KnowledgeVersionPin } from "./runtimeSelection";

export interface AgentKnowledgeLoadOptions {
  readonly mode: "offline_evaluation" | "client_active";
  readonly appSchemaVersion?: number;
}

/**
 * Independent Agent Knowledge backend. It consumes only agent-knowledge/v1;
 * it neither imports nor projects the legacy KnowledgePack model.
 */
export class AgentKnowledgeBackend {
  private constructor(private readonly release: AgentKnowledgeRelease) {}

  static load(input: unknown, options: AgentKnowledgeLoadOptions): AgentKnowledgeBackend {
    const release = assertAgentKnowledgeRelease(input);
    const appSchemaVersion = options.appSchemaVersion ?? 1;
    if (
      appSchemaVersion < release.consumerContracts.minAppSchema
      || appSchemaVersion > release.consumerContracts.maxAppSchema
    ) {
      throw new Error("agent_knowledge_consumer_contract_mismatch");
    }
    if (options.mode === "client_active" && release.status !== "active") {
      throw new Error("agent_knowledge_release_not_active");
    }
    if (options.mode === "offline_evaluation" && !["built", "shadow", "active"].includes(release.status)) {
      throw new Error("agent_knowledge_release_not_evaluable");
    }
    return new AgentKnowledgeBackend(release);
  }

  releasePin(): KnowledgeVersionPin {
    return {
      id: this.release.releaseId,
      version: this.release.semanticVersion,
      contentHash: this.release.contentHash,
    };
  }

  domainCatalog(): AgentKnowledgeDomainCatalog {
    return this.release.domainCatalog;
  }

  artifacts(kind: AgentKnowledgeArtifactKind): readonly AgentKnowledgeArtifact[] {
    return this.release.artifacts.filter((artifact) => artifact.kind === kind);
  }

  artifact(kind: AgentKnowledgeArtifactKind, id: string): AgentKnowledgeArtifact | undefined {
    return this.release.artifacts.find((artifact) => artifact.kind === kind && artifact.id === id);
  }

  searchEvidence(input: { readonly query: string; readonly limit?: number }): AgentKnowledgeEvidenceResult {
    const queryTerms = termsOf(input.query);
    const queryProfile = profileQuery(input.query);
    const hits = this.release.artifacts
      .filter((artifact) => artifact.kind === "claim")
      .map((artifact) => scoreClaim(artifact, queryTerms, queryProfile))
      .filter((hit): hit is AgentKnowledgeEvidenceHit => hit !== undefined)
      .sort((left, right) => right.score - left.score || left.artifactRef.id.localeCompare(right.artifactRef.id))
      .slice(0, input.limit ?? 5);
    return {
      disposition: hits.length ? "found" : "not_found",
      releasePin: this.releasePin(),
      hits,
      missing: hits.length ? [] : ["no_reviewed_claim_matched"],
    };
  }

  resolveDecision(input: {
    readonly scope: string;
    readonly facts: Readonly<Record<string, unknown>>;
  }): AgentKnowledgeDecisionPack {
    const rules = this.release.artifacts.filter(
      (artifact) => artifact.kind === "rule"
        && artifact.scopes.includes(input.scope)
        && artifact.when !== undefined
        && !["deprecated", "retired"].includes(artifact.status),
    );
    const evaluations = rules.map((rule) => {
      const evaluated = evaluate(rule.when!, input.facts);
      const effects = evaluated.result === "matched"
        ? rule.onMatched ?? []
        : evaluated.result === "unknown"
          ? rule.onUnknown ?? []
          : [];
      return {
        ruleRef: refOf(rule),
        result: evaluated.result,
        inputFactKeys: evaluated.inputFactKeys,
        missingFactKeys: evaluated.missingFactKeys,
        effects,
      };
    });
    const constraintIds = new Set(
      evaluations.flatMap((evaluation) => evaluation.effects)
        .filter((effect) => effect.type === "emit_constraint")
        .map((effect) => effect.targetRef),
    );
    const constraints = this.release.artifacts
      .filter((artifact) => artifact.kind === "constraint" && constraintIds.has(artifact.id))
      .map(refOf);
    const missingFactKeys = [...new Set(evaluations.flatMap((evaluation) => evaluation.missingFactKeys))].sort();
    const reasonCodes = [...new Set(
      evaluations.flatMap((evaluation) => evaluation.effects.map((effect) => effect.reasonCode)),
    )].sort();
    return {
      disposition: missingFactKeys.length ? "insufficient_evidence" : "ready",
      releasePin: this.releasePin(),
      scope: input.scope,
      evaluations,
      constraints,
      missingFactKeys,
      reasonCodes,
    };
  }

  inspectPlanningReadiness(): AgentKnowledgePlanningReadiness {
    const kinds: readonly AgentKnowledgeArtifactKind[] = [
      "claim", "policy", "rule", "method", "constraint", "objective",
      "action", "observation", "calculator", "validator", "fixture",
    ];
    const artifactCounts = Object.fromEntries(
      kinds.map((kind) => [kind, this.release.artifacts.filter((artifact) => artifact.kind === kind).length]),
    ) as Record<AgentKnowledgeArtifactKind, number>;
    const missingCapabilities: string[] = [];
    const exerciseCatalogCount = this.release.domainCatalog.exercises.length;
    if (!exerciseCatalogCount) missingCapabilities.push("exercise_catalog");
    if (!artifactCounts.action) missingCapabilities.push("action_artifacts");
    if (!artifactCounts.validator) missingCapabilities.push("validator_artifacts");
    return {
      status: missingCapabilities.length ? "unsupported" : "ready",
      missingCapabilities,
      exerciseCatalogCount,
      artifactCounts,
      reasonCodes: missingCapabilities.map((capability) => `agent_knowledge_missing.${capability}`),
    };
  }
}

function assertAgentKnowledgeRelease(input: unknown): AgentKnowledgeRelease {
  if (!input || typeof input !== "object") throw new Error("agent_knowledge_release_invalid");
  const release = input as Partial<AgentKnowledgeRelease>;
  if (
    release.schemaVersion !== "agent-knowledge/v1"
    || typeof release.releaseId !== "string"
    || typeof release.semanticVersion !== "string"
    || typeof release.contentHash !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(release.contentHash)
    || !release.consumerContracts
    || !release.domainCatalog
    || release.domainCatalog.schemaVersion !== "agent-domain-catalog/v1"
    || !Array.isArray(release.domainCatalog.exercises)
    || !Array.isArray(release.artifacts)
  ) {
    throw new Error("agent_knowledge_release_invalid");
  }
  const keys = new Set<string>();
  for (const artifact of release.artifacts) {
    const key = `${artifact.kind}:${artifact.id}@${artifact.version}`;
    if (keys.has(key)) throw new Error("agent_knowledge_duplicate_artifact");
    keys.add(key);
  }
  return release as AgentKnowledgeRelease;
}

function termsOf(query: string): readonly string[] {
  const normalized = query.trim().toLocaleLowerCase();
  const terms = new Set(normalized.split(/[\s，,。？?！!：:；;、/|（）()]+/).filter((term) => term.length >= 2));
  for (const sequence of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    for (let index = 0; index < sequence.length - 1; index += 1) {
      terms.add(sequence.slice(index, index + 2));
    }
  }
  return [...terms];
}

function scoreClaim(
  artifact: AgentKnowledgeArtifact,
  queryTerms: readonly string[],
  queryProfile: QueryProfile,
): AgentKnowledgeEvidenceHit | undefined {
  if (!artifact.statement || !artifact.sourceClaimRefs.length) return undefined;
  const title = `${artifact.title.zh ?? ""} ${artifact.title.en ?? ""}`.toLocaleLowerCase();
  const tags = artifact.tags.join(" ").toLocaleLowerCase();
  const statement = artifact.statement.toLocaleLowerCase();
  const limitations = (artifact.cannotSupport ?? []).join(" ").toLocaleLowerCase();
  const positiveIdentity = `${artifact.id} ${title} ${tags} ${statement}`;
  const identity = `${positiveIdentity} ${limitations}`;
  if (queryProfile.requiredGroups.some((group) => !group.some((term) => identity.includes(term)))) {
    return undefined;
  }
  const matched = new Set<string>();
  let score = queryProfile.requiredGroups.length * 12;
  for (const group of queryProfile.coverageGroups) {
    if (group.some((term) => positiveIdentity.includes(term))) score += 18;
  }
  for (const group of queryProfile.bonusGroups) {
    // cannotSupport is a boundary, never positive evidence that the Claim
    // answers the requested intent (for example, safety).
    if (group.some((term) => positiveIdentity.includes(term))) score += 6;
  }
  for (const term of queryTerms) {
    if (title.includes(term)) { score += 5; matched.add(term); }
    if (tags.includes(term)) { score += 4; matched.add(term); }
    if (statement.includes(term)) { score += 3; matched.add(term); }
    if (limitations.includes(term)) { score += 1; matched.add(term); }
  }
  if (!score) return undefined;
  return {
    artifactRef: {
      kind: artifact.kind,
      id: artifact.id,
      version: artifact.version,
      contentHash: artifact.contentHash,
    },
    text: artifact.statement,
    sourceClaimRefs: artifact.sourceClaimRefs,
    cannotSupport: artifact.cannotSupport ?? [],
    matchedTerms: [...matched],
    score,
  };
}

interface QueryProfile {
  readonly requiredGroups: readonly (readonly string[])[];
  readonly coverageGroups: readonly (readonly string[])[];
  readonly bonusGroups: readonly (readonly string[])[];
}

function profileQuery(query: string): QueryProfile {
  const normalized = query.toLocaleLowerCase();
  const requiredGroups: string[][] = [];
  const coverageGroups: string[][] = [];
  const bonusGroups: string[][] = [];
  if (/肌酸|creatine/.test(normalized)) requiredGroups.push(["肌酸", "creatine"]);
  if (/咖啡因|caffeine/.test(normalized)) requiredGroups.push(["咖啡因", "caffeine"]);
  if (/空腹|fasted/.test(normalized)) requiredGroups.push(["空腹", "fasted"]);
  if (/增肌|肌肥大|hypertrophy/.test(normalized)) requiredGroups.push(["增肌", "肌肥大", "hypertrophy"]);
  if (/身体重组|body\s*recomposition|recomp/.test(normalized)) {
    requiredGroups.push(["身体重组", "body-recomposition", "body recomposition", "recomposition"]);
  }
  if (/平台期|减脂平台|plateau/.test(normalized)) requiredGroups.push(["平台期", "plateau"]);
  if (/睡得|睡眠|熬夜|sleep/.test(normalized)) requiredGroups.push(["睡眠", "sleep"]);
  if (
    /(同一天|排序|顺序|先.*后)/.test(normalized)
    && /(有氧|aerobic|cardio)/.test(normalized)
    && /(力量|阻力|resistance|strength)/.test(normalized)
  ) {
    requiredGroups.push(["并发", "concurrent"]);
  }
  if (/安全|副作用|不良|safe|safety/.test(normalized)) {
    bonusGroups.push(["安全", "safety", "有害", "副作用", "不良", "肾功能"]);
  }
  if (/有效|效果|作用|efficacy|effective/.test(normalized)) {
    bonusGroups.push(["有效", "efficacy", "提高", "增益", "改善"]);
  }
  if (/几组|组数|周量|volume/.test(normalized)) {
    coverageGroups.push(["周量", "组数", "weekly-volume", "training-volume"]);
  }
  if (/频率|几次|frequency/.test(normalized)) {
    coverageGroups.push(["频率", "frequency"]);
  }
  return { requiredGroups, coverageGroups, bonusGroups };
}

function refOf(artifact: AgentKnowledgeArtifact): AgentKnowledgeArtifactRef {
  return {
    kind: artifact.kind,
    id: artifact.id,
    version: artifact.version,
    contentHash: artifact.contentHash,
  };
}

interface EvaluatedExpression {
  readonly result: TriStateResult;
  readonly inputFactKeys: readonly string[];
  readonly missingFactKeys: readonly string[];
}

function evaluate(
  expression: TriStateExpression,
  facts: Readonly<Record<string, unknown>>,
): EvaluatedExpression {
  if (expression.op === "compare") {
    if (!Object.prototype.hasOwnProperty.call(facts, expression.factKey)) {
      return {
        result: "unknown",
        inputFactKeys: [expression.factKey],
        missingFactKeys: [expression.factKey],
      };
    }
    return {
      result: compare(facts[expression.factKey], expression.comparator, expression.value)
        ? "matched"
        : "not_matched",
      inputFactKeys: [expression.factKey],
      missingFactKeys: [],
    };
  }
  if (expression.op === "not") {
    const child = evaluate(expression.arg, facts);
    return {
      ...child,
      result: child.result === "unknown"
        ? "unknown"
        : child.result === "matched" ? "not_matched" : "matched",
    };
  }
  const children = expression.args.map((argument) => evaluate(argument, facts));
  const inputFactKeys = [...new Set(children.flatMap((child) => child.inputFactKeys))];
  if (expression.op === "all") {
    if (children.some((child) => child.result === "not_matched")) {
      return { result: "not_matched", inputFactKeys, missingFactKeys: [] };
    }
    const missingFactKeys = [...new Set(children.flatMap((child) => child.missingFactKeys))];
    return {
      result: missingFactKeys.length ? "unknown" : "matched",
      inputFactKeys,
      missingFactKeys,
    };
  }
  if (children.some((child) => child.result === "matched")) {
    return { result: "matched", inputFactKeys, missingFactKeys: [] };
  }
  const missingFactKeys = [...new Set(children.flatMap((child) => child.missingFactKeys))];
  return {
    result: missingFactKeys.length ? "unknown" : "not_matched",
    inputFactKeys,
    missingFactKeys,
  };
}

function compare(actual: unknown, comparator: string, expected: unknown): boolean {
  switch (comparator) {
    case "eq": return actual === expected;
    case "neq": return actual !== expected;
    case "gt": return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt": return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    case "includes": return Array.isArray(actual) && actual.includes(expected);
    case "in": return Array.isArray(expected) && expected.includes(actual);
    case "includes_any": return Array.isArray(actual) && Array.isArray(expected)
      && expected.some((candidate) => actual.includes(candidate));
    default: return false;
  }
}
