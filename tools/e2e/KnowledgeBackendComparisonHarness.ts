import { CoachApplication } from "../../src/coach/createCoachApplication";
import type { GoalContractData, UserProfileData } from "../../src/coach/domain";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import {
  AgentKnowledgeBackend,
  AgentKnowledgePlanningModule,
  assertExclusiveKnowledgeSelection,
  type AgentKnowledgeDecisionPack,
  type KnowledgeVersionPin,
} from "../../src/agent-knowledge";
import type { KnowledgePackRegistry } from "../../src/knowledge";
import type { SessionWorkType } from "../../src/planning/sessionFueling";
import { matchFastedRules } from "../../src/planning/sessionFueling";

export interface KnowledgeComparisonScenario {
  readonly id: string;
  readonly query: string;
  readonly decision?: {
    readonly scope: string;
    readonly facts: Readonly<Record<string, unknown>>;
  };
}

export const DEFAULT_KNOWLEDGE_COMPARISON_SCENARIOS: readonly KnowledgeComparisonScenario[] = [
  { id: "creatine", query: "肌酸有效吗，安全吗" },
  { id: "adult-aerobic-volume", query: "成年人每周应该做多少有氧活动" },
  { id: "hypertrophy-volume-frequency", query: "增肌每周几组，训练频率怎么安排" },
  { id: "body-recomposition", query: "身体重组是不是所有人都适合" },
  { id: "weight-waist-plateau", query: "体重和腰围长期不变是不是平台期" },
  { id: "concurrent-order", query: "力量训练和有氧训练同一天应该怎么排序" },
  { id: "poor-sleep-session-change", query: "今天睡得不好，可以把训练换成肩吗" },
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
  {
    id: "fasted-unknown-safety",
    query: "空腹训练可以吗",
    decision: { scope: "pre_session", facts: {} },
  },
];

interface EvidenceMetrics {
  readonly disposition: "found" | "not_found";
  readonly hitCount: number;
  readonly authoritativeRefs: readonly string[];
  readonly limitationCount: number;
  readonly topResultRefs: readonly string[];
}

interface DecisionMetrics {
  readonly disposition: "ready" | "insufficient_evidence" | "unsupported";
  readonly constraintIds: readonly string[];
  readonly missingFactKeys: readonly string[];
  readonly reasonCodes: readonly string[];
}

interface BackendScenarioResult {
  readonly releasePin: KnowledgeVersionPin;
  readonly evidence: EvidenceMetrics;
  readonly decision?: DecisionMetrics;
}

interface PlanningReadinessMetrics {
  readonly status: "ready" | "unsupported";
  readonly missingCapabilities: readonly string[];
  readonly counts: Readonly<Record<string, number>>;
}

export interface KnowledgeBackendComparisonReport {
  readonly executionMode: "isolated_offline_replay";
  readonly runtimeMergeAllowed: false;
  readonly legacy: { readonly planningReadiness: PlanningReadinessMetrics };
  readonly agentKnowledge: { readonly planningReadiness: PlanningReadinessMetrics };
  readonly scenarios: readonly {
    readonly id: string;
    readonly query: string;
    readonly legacy: BackendScenarioResult;
    readonly agentKnowledge: BackendScenarioResult;
    readonly deltas: readonly string[];
  }[];
  readonly summary: {
    readonly completePlanOutputComparable: boolean;
    readonly reasonCodes: readonly string[];
  };
}

interface ComparablePlanSession {
  readonly focusId: string;
  readonly title: string;
  readonly scheduledFor: string;
  readonly exerciseIds: readonly string[];
  readonly aerobic?: { readonly minutes: number; readonly placement: string; readonly intensity: string };
}

interface ComparablePlanResult {
  readonly status: "ready" | "infeasible" | "no_change";
  readonly knowledgePin: KnowledgeVersionPin;
  readonly strategyRef?: string;
  readonly sessions: readonly ComparablePlanSession[];
  readonly reasonCodes: readonly string[];
  readonly validationResults: readonly { readonly id: string; readonly status: "passed" | "failed" }[];
  readonly nutrition?: Readonly<Record<string, unknown>>;
}

export interface SameProfilePlanComparisonReport {
  readonly executionMode: "isolated_same_profile_replay";
  readonly runtimeMergeAllowed: false;
  readonly input: {
    readonly profileId: string;
    readonly goalContractId: string;
    readonly currentDate: string;
  };
  readonly legacy: ComparablePlanResult;
  readonly agentKnowledge: ComparablePlanResult;
  readonly deltas: readonly string[];
}

/**
 * Offline A/B evaluator. Each backend receives the same immutable scenario in
 * a separate run. This class never participates in a client request and never
 * selects, merges, or falls back between backend results.
 */
export class KnowledgeBackendComparisonHarness {
  constructor(private readonly backends: {
    readonly legacy: KnowledgePackRegistry;
    readonly agentKnowledge: AgentKnowledgeBackend;
  }) {}

  run(scenarios: readonly KnowledgeComparisonScenario[]): KnowledgeBackendComparisonReport {
    const legacyPlanning = inspectLegacyPlanningReadiness(this.backends.legacy);
    const agentPlanning = this.backends.agentKnowledge.inspectPlanningReadiness();
    const agentPlanningMetrics: PlanningReadinessMetrics = {
      status: agentPlanning.status,
      missingCapabilities: agentPlanning.missingCapabilities,
      counts: agentPlanning.artifactCounts,
    };
    const compared = scenarios.map((scenario) => {
      const legacy = runLegacyScenario(this.backends.legacy, scenario);
      const agentKnowledge = runAgentKnowledgeScenario(this.backends.agentKnowledge, scenario);
      return {
        id: scenario.id,
        query: scenario.query,
        legacy,
        agentKnowledge,
        deltas: compareScenario(legacy, agentKnowledge),
      };
    });
    const completePlanOutputComparable = legacyPlanning.status === "ready"
      && agentPlanningMetrics.status === "ready";
    return {
      executionMode: "isolated_offline_replay",
      runtimeMergeAllowed: false,
      legacy: { planningReadiness: legacyPlanning },
      agentKnowledge: { planningReadiness: agentPlanningMetrics },
      scenarios: compared,
      summary: {
        completePlanOutputComparable,
        reasonCodes: completePlanOutputComparable
          ? []
          : agentPlanningMetrics.missingCapabilities.map(
            (capability) => `complete_plan_comparison_blocked.agent_knowledge_missing.${capability}`,
          ),
      },
    };
  }

  async runSameProfile(
    profile: UserProfileData,
    goalContract: GoalContractData,
  ): Promise<SameProfilePlanComparisonReport> {
    const currentDate = goalContract.horizon.startDate;
    const [legacy, agentKnowledge] = await Promise.all([
      runLegacyPlan(this.backends.legacy, profile, goalContract, currentDate),
      Promise.resolve(runAgentKnowledgePlan(this.backends.agentKnowledge, profile, goalContract, currentDate)),
    ]);
    return {
      executionMode: "isolated_same_profile_replay",
      runtimeMergeAllowed: false,
      input: { profileId: profile.id, goalContractId: goalContract.id, currentDate },
      legacy,
      agentKnowledge,
      deltas: comparePlans(legacy, agentKnowledge),
    };
  }
}

async function runLegacyPlan(
  backend: KnowledgePackRegistry,
  profile: UserProfileData,
  goalContract: GoalContractData,
  currentDate: string,
): Promise<ComparablePlanResult> {
  let sequence = 0;
  const userId = `same-profile:${profile.id}:legacy`;
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => `${currentDate}T10:00:00.000Z`,
      nextId: (prefix: string) => `${userId}:${prefix}-${++sequence}`,
    },
    knowledgeRegistry: backend,
  });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile,
    goalContract,
    mandate: { id: `${profile.id}:comparison-mandate`, mode: "collaborative" },
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: "same-profile-comparison",
      occurredAt: `${currentDate}T10:00:00.000Z`,
      timezoneOffsetMinutes: 480,
      idempotencyKey: `${profile.id}:legacy-bootstrap`,
    },
  });
  const decision = await app.previewGoalCycle({ userId, currentDate, trigger: "initial_plan" });
  const pin = backend.versionPins().knowledgePack;
  const knowledgePin = { id: pin.id, version: pin.semanticVersion, contentHash: pin.contentHash };
  if (decision.kind !== "plan_proposal") {
    return {
      status: decision.kind === "infeasible_plan" ? "infeasible" : "no_change",
      knowledgePin,
      sessions: [],
      reasonCodes: decision.reasonCodes,
      validationResults: [],
    };
  }
  const sessions = decision.planRevision.upcomingSevenDays
    ?? decision.planRevision.materializedWeeks?.[0]?.sessions
    ?? decision.planRevision.sessions;
  return {
    status: "ready",
    knowledgePin,
    strategyRef: decision.trace.splitSelection?.rotationId ?? decision.strategySelection?.primary,
    sessions: sessions
      .filter((session) => session.kind !== "rest" && session.kind !== "recovery")
      .map((session) => ({
        focusId: legacyFocusId(session.title),
        title: session.title,
        scheduledFor: session.scheduledFor,
        exerciseIds: session.tasks.map((task) => task.exerciseVariantId),
        ...(session.aerobicBlock ? {
          aerobic: {
            minutes: session.aerobicBlock.minutes,
            placement: session.aerobicBlock.placement,
            intensity: session.aerobicBlock.intensity,
          },
        } : {}),
      })),
    reasonCodes: decision.reasonCodes,
    validationResults: [],
    nutrition: decision.planRevision.nutritionGuidance as unknown as Readonly<Record<string, unknown>> | undefined,
  };
}

function runAgentKnowledgePlan(
  backend: AgentKnowledgeBackend,
  profile: UserProfileData,
  goalContract: GoalContractData,
  currentDate: string,
): ComparablePlanResult {
  const plan = new AgentKnowledgePlanningModule(backend).createInitialPlan({ profile, goalContract, currentDate });
  return {
    status: "ready",
    knowledgePin: plan.knowledgeReleasePin,
    strategyRef: plan.strategy.methodRef,
    sessions: plan.week.sessions.map((session) => ({
      focusId: session.id,
      title: session.focus,
      scheduledFor: session.scheduledFor,
      exerciseIds: session.exercises.map((exercise) => exercise.id),
      ...(session.aerobic ? { aerobic: session.aerobic } : {}),
    })),
    reasonCodes: plan.reasons.map((reason) => reason.code),
    validationResults: plan.validationResults.map((result) => ({
      id: result.validatorRef,
      status: result.status,
    })),
    nutrition: plan.nutrition,
  };
}

function legacyFocusId(title: string): string {
  if (/胸/.test(title)) return "chest";
  if (/背/.test(title)) return "back";
  if (/腿|下肢/.test(title)) return "legs";
  if (/肩/.test(title)) return "shoulders";
  if (/推/.test(title)) return "push";
  if (/拉/.test(title)) return "pull";
  return title;
}

function comparePlans(legacy: ComparablePlanResult, agentKnowledge: ComparablePlanResult): readonly string[] {
  const deltas: string[] = [];
  if (legacy.status !== agentKnowledge.status) deltas.push("plan_disposition_changed");
  if (canonicalStrategy(legacy.strategyRef) !== canonicalStrategy(agentKnowledge.strategyRef)) deltas.push("split_strategy_changed");
  if (legacy.sessions.length !== agentKnowledge.sessions.length) deltas.push("session_count_changed");
  if (legacy.sessions.filter((session) => session.aerobic).length !== agentKnowledge.sessions.filter((session) => session.aerobic).length) {
    deltas.push("aerobic_block_count_changed");
  }
  if (JSON.stringify(legacy.sessions.map((session) => session.focusId)) !== JSON.stringify(agentKnowledge.sessions.map((session) => session.focusId))) {
    deltas.push("session_focus_order_changed");
  }
  if (JSON.stringify(legacy.nutrition) !== JSON.stringify(agentKnowledge.nutrition)) deltas.push("nutrition_model_changed");
  return deltas;
}

function canonicalStrategy(value: string | undefined): string | undefined {
  return value?.replace(/^method\.legacy\.split\./, "").replace(/-/g, "_");
}

function runLegacyScenario(
  backend: KnowledgePackRegistry,
  scenario: KnowledgeComparisonScenario,
): BackendScenarioResult {
  const pin = backend.versionPins().knowledgePack;
  const releasePin: KnowledgeVersionPin = {
    id: pin.id,
    version: pin.semanticVersion,
    contentHash: pin.contentHash,
  };
  assertExclusiveKnowledgeSelection({ backend: "legacy", legacyPackPin: releasePin });
  const evidence = backend.searchKnowledge({ query: scenario.query, limit: 5 });
  const citations = evidence.hits.flatMap((hit) => hit.citations);
  return {
    releasePin,
    evidence: {
      disposition: evidence.hits.length ? "found" : "not_found",
      hitCount: evidence.hits.length,
      authoritativeRefs: [...new Set(citations
        .filter((citation) => citation.claimStatus === "curated" && citation.tier !== "U")
        .map((citation) => citation.id))],
      limitationCount: citations.reduce((count, citation) => count + citation.cannotSupportZh.length, 0),
      topResultRefs: evidence.hits.map((hit) => hit.passage.id),
    },
    ...(scenario.decision ? { decision: resolveLegacyDecision(backend, scenario.decision) } : {}),
  };
}

function runAgentKnowledgeScenario(
  backend: AgentKnowledgeBackend,
  scenario: KnowledgeComparisonScenario,
): BackendScenarioResult {
  const releasePin = backend.releasePin();
  assertExclusiveKnowledgeSelection({
    backend: "agent_knowledge",
    agentKnowledgeReleasePin: releasePin,
  });
  const evidence = backend.searchEvidence({ query: scenario.query, limit: 5 });
  return {
    releasePin,
    evidence: {
      disposition: evidence.disposition,
      hitCount: evidence.hits.length,
      authoritativeRefs: [...new Set(evidence.hits.flatMap((hit) => hit.sourceClaimRefs))],
      limitationCount: evidence.hits.reduce((count, hit) => count + hit.cannotSupport.length, 0),
      topResultRefs: evidence.hits.map((hit) => hit.artifactRef.id),
    },
    ...(scenario.decision
      ? { decision: decisionMetrics(backend.resolveDecision(scenario.decision)) }
      : {}),
  };
}

function resolveLegacyDecision(
  backend: KnowledgePackRegistry,
  input: NonNullable<KnowledgeComparisonScenario["decision"]>,
): DecisionMetrics {
  if (!["pre_session", "daily_adjustment"].includes(input.scope)) {
    return {
      disposition: "unsupported",
      constraintIds: [],
      missingFactKeys: [],
      reasonCodes: ["legacy_decision_scope_unsupported"],
    };
  }
  const workType = input.facts["session.workType"];
  const plannedMinutes = input.facts["session.plannedMinutes"];
  const missingFactKeys = [
    ...(typeof workType === "string" ? [] : ["session.workType"]),
    ...(typeof plannedMinutes === "number" ? [] : ["session.plannedMinutes"]),
  ];
  if (missingFactKeys.length) {
    return {
      disposition: "insufficient_evidence",
      constraintIds: [],
      missingFactKeys,
      reasonCodes: ["legacy_fasted_rule_input_missing"],
    };
  }
  const allowedWorkTypes: readonly SessionWorkType[] = [
    "strength", "high_intensity_aerobic", "low_intensity_aerobic", "walking",
  ];
  if (!allowedWorkTypes.includes(workType as SessionWorkType)) {
    return {
      disposition: "unsupported",
      constraintIds: [],
      missingFactKeys: [],
      reasonCodes: ["legacy_work_type_unsupported"],
    };
  }
  const healthFlags = Array.isArray(input.facts["user.healthFlags"])
    ? input.facts["user.healthFlags"].filter((item): item is string => typeof item === "string")
    : [];
  const profile: UserProfileData = {
    id: "knowledge-comparison-user",
    locale: "zh-CN",
    trainingExperience: "intermediate",
    ...(typeof input.facts["user.ageYears"] === "number"
      ? { demographics: { ageYears: input.facts["user.ageYears"] } }
      : {}),
    ...(typeof input.facts["user.adultConfirmed"] === "boolean"
      ? { adultConfirmed: input.facts["user.adultConfirmed"] }
      : {}),
    nutritionPreferences: healthFlags,
    ...(input.facts["user.professionalClearanceRequired"] === true
      ? {
          professionalConstraints: [{
            id: "comparison-clearance",
            sourceDescription: "comparison fixture",
            scope: ["training"],
            instruction: "requires clearance",
            requiresClearance: true,
          }],
        }
      : {}),
  };
  const matched = matchFastedRules({
    rules: backend.programStrategies()?.fastedTrainingRules ?? [],
    workType: workType as SessionWorkType,
    plannedMinutes: plannedMinutes as number,
    profile,
  }).filter((rule) => rule.severity === "block");
  return {
    disposition: "ready",
    constraintIds: matched.map((rule) => `legacy_constraint:${rule.id}`),
    missingFactKeys: [],
    reasonCodes: matched.map((rule) => `legacy.${rule.id}.matched`),
  };
}

function decisionMetrics(pack: AgentKnowledgeDecisionPack): DecisionMetrics {
  return {
    disposition: pack.disposition,
    constraintIds: pack.constraints.map((constraint) => constraint.id),
    missingFactKeys: pack.missingFactKeys,
    reasonCodes: pack.reasonCodes,
  };
}

function inspectLegacyPlanningReadiness(backend: KnowledgePackRegistry): PlanningReadinessMetrics {
  const inspected = backend.inspect();
  const strategies = backend.programStrategies();
  const counts = {
    exerciseVariants: inspected.exerciseCatalog.count,
    splitMethods: strategies?.splitRotations?.length ?? 0,
    executableRulePacks: inspected.executableRulePacks.length,
  };
  const missingCapabilities = [
    ...(counts.exerciseVariants ? [] : ["exercise_catalog"]),
    ...(counts.splitMethods ? [] : ["plan_methods"]),
    ...(counts.executableRulePacks ? [] : ["rule_packs"]),
  ];
  return {
    status: missingCapabilities.length ? "unsupported" : "ready",
    missingCapabilities,
    counts,
  };
}

function compareScenario(
  legacy: BackendScenarioResult,
  agentKnowledge: BackendScenarioResult,
): readonly string[] {
  const deltas: string[] = [];
  if (legacy.evidence.disposition !== agentKnowledge.evidence.disposition) deltas.push("evidence_disposition_changed");
  if (legacy.evidence.authoritativeRefs.length !== agentKnowledge.evidence.authoritativeRefs.length) {
    deltas.push("authoritative_reference_coverage_changed");
  }
  if (legacy.evidence.limitationCount !== agentKnowledge.evidence.limitationCount) {
    deltas.push("cannot_support_coverage_changed");
  }
  if (legacy.decision?.disposition !== agentKnowledge.decision?.disposition) deltas.push("decision_disposition_changed");
  if ((legacy.decision?.constraintIds.length ?? 0) !== (agentKnowledge.decision?.constraintIds.length ?? 0)) {
    deltas.push("constraint_count_changed");
  }
  return deltas;
}
