import type { GoalContractData, UserProfileData } from "../coach/domain";
import { AgentKnowledgeBackend } from "./AgentKnowledgeBackend";
import {
  AgentKnowledgePlanningModule,
  type AgentKnowledgeInitialPlan,
  type AgentKnowledgePlanningEvidence,
} from "./AgentKnowledgePlanningModule";
import { createInstalledAgentKnowledgeBackend } from "./installedRelease";
import type { ExclusiveKnowledgeSelection, KnowledgeVersionPin } from "./runtimeSelection";

/**
 * Narrow, standalone Harness for the new knowledge backend. The caller gives
 * it confirmed facts; it returns pinned knowledge results and never reads the
 * Legacy KnowledgePack or mutates Timeline/Plan state.
 */
export class AgentKnowledgeHarness {
  private readonly planner: AgentKnowledgePlanningModule;

  constructor(private readonly backend: AgentKnowledgeBackend) {
    this.planner = new AgentKnowledgePlanningModule(backend);
  }

  selection(): ExclusiveKnowledgeSelection {
    return {
      backend: "agent_knowledge",
      agentKnowledgeReleasePin: this.backend.releasePin(),
    };
  }

  inspect() {
    return this.backend.inspectPlanningReadiness();
  }

  search(input: { readonly query: string; readonly limit?: number }) {
    return this.backend.searchEvidence(input);
  }

  decide(input: { readonly scope: string; readonly facts: Readonly<Record<string, unknown>> }) {
    return this.backend.resolveDecision(input);
  }

  /**
   * Active decision artifacts that may declare inputs for dossier intake.
   * The onboarding layer binds these artifact identities to product-owned
   * field controls; it does not infer a questionnaire from goal keywords.
   */
  onboardingIntakeArtifacts() {
    return (["policy", "objective", "action", "calculator", "validator"] as const)
      .flatMap((kind) => this.backend.artifacts(kind))
      .filter((artifact) => artifact.status === "active" && artifact.scopes.includes("initial_plan"))
      .map((artifact) => ({
        artifactRef: {
          kind: artifact.kind,
          id: artifact.id,
          version: artifact.version,
          contentHash: artifact.contentHash,
        },
        title: artifact.title,
        tags: artifact.tags,
        sourceClaimRefs: artifact.sourceClaimRefs,
      }));
  }

  createInitialPlan(input: {
    readonly profile: UserProfileData;
    readonly goalContract: GoalContractData;
    readonly currentDate: string;
    readonly evidence?: AgentKnowledgePlanningEvidence;
  }): AgentKnowledgeInitialPlan {
    return this.planner.createInitialPlan(input);
  }

  /**
   * Version-pinned compiled decision artifacts selected from this release. A
   * release may express its planning rules as methods/actions/calculators and
   * validators rather than generic `rule` records, so the pin set follows the
   * exact decision-capable artifact kinds without consulting Legacy RulePacks.
   */
  planningRulePins(): readonly KnowledgeVersionPin[] {
    const selected = new Set([
      "method.initial-plan.chest-back-shoulders-legs",
      "action.initial-plan.select-split",
      "action.initial-plan.schedule-recovery",
      "action.initial-plan.schedule-aerobic",
      "action.initial-plan.allocate-dose",
      "action.initial-plan.resolve-exercises",
      "calculator.initial-plan.muscle-fatigue",
      "calculator.initial-plan.energy-budget",
      "validator.initial-plan.frequency",
      "validator.initial-plan.session-duration",
      "validator.initial-plan.major-regions",
      "validator.initial-plan.fatigue-adjacency",
      "validator.initial-plan.exercise-equipment",
      "validator.initial-plan.energy-transparency",
    ]);
    return [
      ...this.backend.artifacts("rule"),
      ...(["method", "action", "calculator", "validator"] as const).flatMap((kind) => this.backend.artifacts(kind)),
    ]
      .filter((artifact) => selected.has(artifact.id))
      .map((artifact) => ({ id: artifact.id, version: artifact.version, contentHash: artifact.contentHash }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }
}

export function createInstalledAgentKnowledgeHarness(): AgentKnowledgeHarness {
  return new AgentKnowledgeHarness(createInstalledAgentKnowledgeBackend());
}
