import type { EvidenceBriefArtifact } from "../coach/model";
import type { NutritionStrategyData, PlanRevisionData } from "../coach/domain";
import type { LocalProductKernel } from "../coach/LocalProductKernel";
import type { AdaptivePlanCandidate } from "./AdaptivePlanning";

type PlanCandidateCardDetails = Extract<NonNullable<EvidenceBriefArtifact["conversationCard"]>, { kind: "plan_candidate" }>["details"];

/**
 * The only application adapter between a Pi plan tool and the fixed planning
 * kernel. It assembles immutable input, validates a model-supplied candidate,
 * and owns confirmation/rejection. The mobile composition root neither
 * chooses a plan nor maps a candidate itself.
 */
export class CurrentStagePlanningModule {
  constructor(private readonly kernel: LocalProductKernel) {}

  async readInput(input: { userId: string; sourceAssessmentId?: string }): Promise<Readonly<Record<string, unknown>>> {
    const domain = await this.kernel.readDomainProjection({ userId: input.userId });
    const mode = domain.planStatus === "current" ? "adjustment" as const : "first_plan" as const;
    // The model receives a typed insufficiency instead of a raw error, so a
    // missing fact can only produce an honest "evidence missing" reply.
    const missing = [
      ...(!domain.profile ? ["user_profile"] : []),
      ...(!domain.goalContract ? ["goal_contract"] : []),
      ...(!domain.mandate ? ["coaching_mandate"] : []),
    ];
    if (missing.length) return { status: "insufficient_facts", missing, mode };
    if (!input.sourceAssessmentId) return this.kernel.readPlanningInput({ userId: input.userId, mode });
    const artifact = (await this.kernel.readGoalPathAssessmentArtifacts({ userId: input.userId }))
      .find((candidate) => candidate.goalPathAssessment?.assessment.id === input.sourceAssessmentId);
    if (!artifact?.goalPathAssessment?.assessment) throw new Error("signal_assessment_not_found");
    return this.kernel.readPlanningInput({ userId: input.userId, mode, sourceAssessment: artifact.goalPathAssessment.assessment });
  }

  async propose(input: { userId: string; candidate: unknown; idempotencyKey: string }): Promise<{
    readonly status: "ready" | "invalid" | "applied";
    readonly proposalId?: string;
    readonly title: string;
    readonly summary: readonly string[];
    readonly evidenceRefs?: readonly import("../coach/model").FactRef[];
    readonly details?: PlanCandidateCardDetails;
  }> {
    const domainBefore = await this.kernel.readDomainProjection({ userId: input.userId });
    const candidate = input.candidate as AdaptivePlanCandidate;
    const proposed = await this.kernel.proposeAdaptivePlanCandidate({
      userId: input.userId,
      candidate,
      attempt: 1,
      idempotencyKey: input.idempotencyKey,
    });
    const details = planCandidateDetails(
      candidate,
      proposed.validation,
      domainBefore.plan?.value,
      domainBefore.nutritionStrategies
        .filter((strategy) => strategy.value.goalContractRef.id === domainBefore.goalContract?.value.id)
        .sort((left, right) => right.revision - left.revision)[0]?.value,
    );
    if (!proposed.artifact?.adaptivePlanProposal) {
      return {
        status: "invalid",
        title: "计划候选未通过固定校验",
        summary: proposed.validation.issues.map((issue) => `${issue.code}: ${issue.message}`),
        details,
      };
    }
    if (proposed.validation.resolution === "auto_apply_eligible" || proposed.validation.resolution === "auto_apply_once_eligible") {
      await this.kernel.confirmAdaptivePlanCandidate({
        userId: input.userId,
        proposalId: proposed.artifact.id,
        idempotencyKey: `${input.idempotencyKey}:authorized-apply`,
      });
      return {
        status: "applied",
        proposalId: proposed.artifact.id,
        title: "已应用小幅阶段调整",
        summary: proposed.artifact.summary,
        evidenceRefs: proposed.artifact.evidenceRefs,
        details,
      };
    }
    return {
      status: "ready",
      proposalId: proposed.artifact.id,
      title: proposed.artifact.title,
      summary: proposed.artifact.summary,
      evidenceRefs: proposed.artifact.evidenceRefs,
      details,
    };
  }

  async confirm(input: { userId: string; proposalId: string; idempotencyKey: string }): Promise<void> {
    await this.kernel.confirmAdaptivePlanCandidate(input);
  }

  async reject(input: { userId: string; proposalId: string; idempotencyKey: string }): Promise<void> {
    await this.kernel.rejectAdaptivePlanCandidate(input);
  }
}

function planCandidateDetails(
  candidate: AdaptivePlanCandidate,
  validation: { status: "valid" | "invalid"; impact: "low" | "high"; resolution: "confirmation_required" | "auto_apply_once_eligible" | "auto_apply_eligible"; issues: readonly { code: string; message: string }[] },
  previousPlan?: PlanRevisionData,
  previousNutrition?: NutritionStrategyData,
): PlanCandidateCardDetails {
  const nutrition = candidate.nutritionStrategy;
  const candidateSessions = candidate.planRevision.sessions;
  const sessions = candidateSessions.slice(0, 7).map((session) => ({
    date: session.scheduledFor,
    title: session.title,
    ...(session.estimatedDuration?.unit === "minutes"
      ? { durationMinutes: session.estimatedDuration.value }
      : session.durationBudget?.unit === "minutes" ? { durationMinutes: session.durationBudget.value } : {}),
    taskCount: session.tasks.length,
    setCount: (session.stimulusSlots ?? []).reduce((total, slot) => total + slot.prescription.setCount, 0),
  }));
  const macronutrients = nutrition?.macronutrientTargets
    ? [
      `蛋白质 ${nutrition.macronutrientTargets.proteinGrams.min}–${nutrition.macronutrientTargets.proteinGrams.max} g`,
      `脂肪下限 ${nutrition.macronutrientTargets.fatEnergyFloorPercent}% 能量`,
      ...(nutrition.macronutrientTargets.carbohydrateGrams
        ? [`碳水 ${nutrition.macronutrientTargets.carbohydrateGrams.min}–${nutrition.macronutrientTargets.carbohydrateGrams.max} g`]
        : []),
    ]
    : [];
  const nutrientTargets = Object.entries(nutrition?.nutrientTargets ?? {}).flatMap(([id, target]) => {
    if (!target) return [];
    const range = target.minimum !== undefined && target.maximum !== undefined
      ? `${target.minimum}–${target.maximum}`
      : target.target !== undefined ? `${target.target}`
        : target.minimum !== undefined ? `≥${target.minimum}`
          : target.maximum !== undefined ? `≤${target.maximum}` : "未定义";
    return [`${id}: ${range} ${target.unit}`];
  });
  const previousEnergy = previousNutrition?.calorieRange;
  const nextEnergy = nutrition?.calorieRange;
  const diff = previousPlan
    ? [
      `训练安排：${previousPlan.sessions.length} → ${candidateSessions.length} 次当前阶段训练`,
      ...(previousEnergy && nextEnergy
        ? [`能量目标：${previousEnergy.min.value}–${previousEnergy.max.value} → ${nextEnergy.min.value}–${nextEnergy.max.value} kcal`]
        : []),
    ]
    : ["建立首个当前阶段计划", `近期安排：${candidateSessions.length} 次训练`];
  return {
    sessions,
    ...(nutrition ? {
      nutrition: {
        ...(nutrition.calorieRange ? { calorieRange: { min: nutrition.calorieRange.min.value, max: nutrition.calorieRange.max.value, unit: "kcal" as const } } : {}),
        ...(macronutrients.length ? { macronutrients } : {}),
        ...(nutrientTargets.length ? { nutrientTargets } : {}),
        ...(nutrition.reviewWindow ? { reviewWindow: `${nutrition.reviewWindow.startsAt.slice(0, 10)} 至 ${nutrition.reviewWindow.endsAt.slice(0, 10)}，至少 ${nutrition.reviewWindow.minimumWeightObservations} 次体重记录` } : {}),
      },
    } : {}),
    behaviorChanges: candidate.behaviorChanges.map((change) => ({ instruction: change.instruction, burden: change.burden })),
    rationale: candidate.rationale,
    tradeoffs: candidate.expectedTradeoffs,
    observation: candidate.planRevision.observationContract
      ? [
        `最少观察 ${candidate.planRevision.observationContract.minimumObservationDays} 天`,
        ...candidate.planRevision.observationContract.requiredSignals,
        ...candidate.planRevision.observationContract.holdConditions.map((condition) => `保持条件：${condition}`),
        ...candidate.planRevision.observationContract.fallbackConditions.map((condition) => `回退条件：${condition}`),
      ]
      : [],
    diff,
    validation: {
      status: validation.status,
      impact: validation.impact,
      resolution: validation.resolution,
      issues: validation.issues.map((issue) => `${issue.code}: ${issue.message}`),
    },
  };
}
