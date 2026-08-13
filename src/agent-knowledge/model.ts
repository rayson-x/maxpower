import type { KnowledgeVersionPin } from "./runtimeSelection";

export type AgentKnowledgeArtifactKind =
  | "claim"
  | "policy"
  | "rule"
  | "method"
  | "constraint"
  | "objective"
  | "action"
  | "observation"
  | "calculator"
  | "validator"
  | "fixture";

export interface AgentKnowledgeArtifactRef {
  readonly kind: AgentKnowledgeArtifactKind;
  readonly id: string;
  readonly version: string;
  readonly contentHash: string;
}

export interface AgentKnowledgeArtifact extends AgentKnowledgeArtifactRef {
  readonly schemaVersion: "agent-knowledge-artifact/v1";
  readonly status: "draft" | "reviewed" | "shadow" | "active" | "deprecated" | "retired";
  readonly title: { readonly zh?: string; readonly en?: string };
  readonly scopes: readonly string[];
  readonly tags: readonly string[];
  readonly dependsOn: readonly AgentKnowledgeArtifactRef[];
  readonly sourceClaimRefs: readonly string[];
  readonly statement?: string;
  readonly cannotSupport?: readonly string[];
  readonly reasonCodes?: readonly string[];
  readonly when?: TriStateExpression;
  readonly onMatched?: readonly DecisionEffect[];
  readonly onUnknown?: readonly DecisionEffect[];
  readonly [key: string]: unknown;
}

export type TriStateExpression =
  | {
      readonly op: "compare";
      readonly factKey: string;
      readonly comparator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "includes" | "in" | "includes_any";
      readonly value: unknown;
    }
  | { readonly op: "all" | "any"; readonly args: readonly TriStateExpression[] }
  | { readonly op: "not"; readonly arg: TriStateExpression };

export interface DecisionEffect {
  readonly type: string;
  readonly targetRef: string;
  readonly reasonCode: string;
}

export interface AgentKnowledgeRelease {
  readonly schemaVersion: "agent-knowledge/v1";
  readonly releaseId: string;
  readonly semanticVersion: string;
  readonly contentHash: string;
  readonly status: "built" | "shadow" | "active" | "deprecated" | "rejected";
  readonly consumerContracts: {
    readonly minAppSchema: number;
    readonly maxAppSchema: number;
    readonly evaluatorContract: string;
    readonly plannerContract: string;
  };
  readonly domainCatalog: AgentKnowledgeDomainCatalog;
  readonly artifacts: readonly AgentKnowledgeArtifact[];
  readonly explanationIndex: {
    readonly gists: readonly unknown[];
    readonly keypoints: readonly unknown[];
    readonly passages: readonly unknown[];
  };
}

export interface AgentKnowledgeDomainExercise {
  readonly id: string;
  readonly displayName: { readonly zh: string; readonly en?: string };
  readonly aliases: readonly string[];
  readonly movementPattern: string;
  readonly equipment: {
    readonly loadMode: string;
    readonly requirement: Readonly<Record<string, unknown>>;
  };
  readonly primaryMuscleIntent: readonly string[];
  readonly secondaryMuscleIntent: readonly string[];
  readonly stabilizerIntent: readonly string[];
  readonly mechanic: "compound" | "isolation";
  readonly fatigueCost: "low" | "medium" | "high";
  readonly doseMode: "weighted_reps" | "bodyweight_reps" | "timed" | "distance";
  readonly supportedRange: {
    readonly min: number;
    readonly max: number;
    readonly unit: "reps" | "seconds" | "meters";
  };
  readonly performanceIdentity: string;
  readonly status: "active" | "deprecated" | "retired";
}

export interface AgentKnowledgeDomainCatalog {
  readonly schemaVersion: "agent-domain-catalog/v1";
  readonly contentHash: string;
  readonly exercises: readonly AgentKnowledgeDomainExercise[];
}

export interface AgentKnowledgeEvidenceHit {
  readonly artifactRef: AgentKnowledgeArtifactRef;
  readonly text: string;
  readonly sourceClaimRefs: readonly string[];
  readonly cannotSupport: readonly string[];
  readonly matchedTerms: readonly string[];
  readonly score: number;
}

export interface AgentKnowledgeEvidenceResult {
  readonly disposition: "found" | "not_found";
  readonly releasePin: KnowledgeVersionPin;
  readonly hits: readonly AgentKnowledgeEvidenceHit[];
  readonly missing: readonly string[];
}

export type TriStateResult = "matched" | "not_matched" | "unknown";

export interface AgentKnowledgeRuleEvaluation {
  readonly ruleRef: AgentKnowledgeArtifactRef;
  readonly result: TriStateResult;
  readonly inputFactKeys: readonly string[];
  readonly missingFactKeys: readonly string[];
  readonly effects: readonly DecisionEffect[];
}

export interface AgentKnowledgeDecisionPack {
  readonly disposition: "ready" | "insufficient_evidence";
  readonly releasePin: KnowledgeVersionPin;
  readonly scope: string;
  readonly evaluations: readonly AgentKnowledgeRuleEvaluation[];
  readonly constraints: readonly AgentKnowledgeArtifactRef[];
  readonly missingFactKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface AgentKnowledgePlanningReadiness {
  readonly status: "ready" | "unsupported";
  readonly missingCapabilities: readonly string[];
  readonly exerciseCatalogCount: number;
  readonly artifactCounts: Readonly<Record<AgentKnowledgeArtifactKind, number>>;
  readonly reasonCodes: readonly string[];
}
