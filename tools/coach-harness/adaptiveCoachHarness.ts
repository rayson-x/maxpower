/**
 * Standalone adaptive-coach acceptance harness.
 *
 * It deliberately uses a scripted language provider only to select a
 * declared tool. Everything after selection is production code: local
 * capability assembly, AgentRuntime ToolResult continuation, ToolRegistry,
 * Timeline admission, risk evaluation, planner preview and confirmation.
 * The report contains references and closed outcomes, never prompt content or
 * model reasoning.
 */
import { ScriptedLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import type { Artifact, TimelineRiskEvaluationArtifact } from "../../src/coach/model";
import {
  BehaviorDecisionTraceRecorder,
  TraceRecorder,
  type TraceEnvelope,
} from "../../src/observability";

const NOW = "2026-08-13T08:00:00.000+08:00";

export type HarnessAgentAction = "show_today" | "record_recovery" | "energy_rebalance" | "recovery_adjustment";
export type HarnessGoalMode = "lean_mass_preserving_fat_loss" | "higher_body_mass_fat_loss" | "strength_priority_cut";

export interface AdaptiveCoachHarnessScenario {
  id: string;
  userText: string;
  agentAction: HarnessAgentAction;
  goalMode?: HarnessGoalMode;
  confirmation?: "none" | "confirm_latest" | "reject_latest";
}

export interface AdaptiveCoachHarnessReport {
  scenarioId: string;
  initialPlan: { confirmed: boolean; revision?: number };
  agent: {
    runStatus?: string;
    toolNames: readonly string[];
    artifactKinds: readonly string[];
    toolResultReturnedToSameRun: boolean;
  };
  timeline: {
    revision: number;
    factKinds: readonly string[];
    queuedOrCoalescedReasons: readonly string[];
  };
  risk: {
    latest?: {
      outcome: string;
      state?: string;
      reasonCodes: readonly string[];
      disposition: string;
    };
  };
  planChanges: {
    currentPlanChangedBeforeConfirmation: boolean;
    pendingFuturePreviews: number;
    confirmedFutureRevision: boolean;
    rejectedFutureRevision: boolean;
  };
  observability: { boundaries: readonly string[]; containsUserText: boolean };
}

export async function runAdaptiveCoachHarnessScenario(
  scenario: AdaptiveCoachHarnessScenario,
): Promise<AdaptiveCoachHarnessReport> {
  let sequence = 0;
  let now = NOW;
  const traces: TraceEnvelope[] = [];
  const ledger = new InMemoryCoachLedger();
  const provider = scriptedProvider(scenario.agentAction);
  const app = new CoachApplication({
    ledger,
    runtime: {
      now: () => now,
      nextId: (prefix) => `${scenario.id}:${prefix}:${++sequence}`,
    },
    llmProvider: provider,
    actionToolsEnabled: true,
    behaviorDecisionRecorder: new BehaviorDecisionTraceRecorder(new TraceRecorder([{
      name: "harness-memory",
      async write(envelope) { traces.push(envelope); },
    }])),
  });
  const userId = `harness:${scenario.id}`;
  await bootstrap(app, userId, scenario.goalMode ?? "lean_mass_preserving_fat_loss");
  const initial = await app.createPlanningPreview({
    userId,
    currentDate: now.slice(0, 10),
    trigger: "initial_plan",
    idempotencyKey: `${scenario.id}:initial-preview`,
  });
  if (!initial.planningPreview) throw new Error("harness_initial_plan_not_proposed");
  await app.confirmPlanningPreview({
    userId,
    previewId: initial.id,
    idempotencyKey: `${scenario.id}:initial-confirm`,
  });
  const initialRevision = (await app.readDomainProjection({ userId })).plan?.revision;
  if (!initialRevision) throw new Error("harness_initial_plan_not_confirmed");

  const session = await app.startSession({
    userId,
    context: { kind: "today", ref: now.slice(0, 10) },
  });
  await app.sendCoachTurn({ sessionId: session.id, text: scenario.userText });
  const turnTimeline = await app.readDomainProjection({ userId });
  if (turnTimeline.timeline.revision > 0) {
    now = "2026-08-13T09:00:00.000+08:00";
    await app.runScheduledTimelineRiskEvaluation({
      userId,
      idempotencyKey: `${scenario.id}:scheduled-risk`,
    });
  }
  const afterRisk = await ledger.read();
  const projectionBeforeDecision = await app.readDomainProjection({ userId });
  const latestPreview = latestFuturePreview(afterRisk.artifacts);
  let confirmedFutureRevision = false;
  let rejectedFutureRevision = false;
  if (latestPreview && scenario.confirmation === "confirm_latest") {
    await app.confirmPlanningPreview({
      userId,
      previewId: latestPreview.id,
      idempotencyKey: `${scenario.id}:confirm-latest`,
    });
    confirmedFutureRevision = (await app.readDomainProjection({ userId })).plan?.revision !== initialRevision;
  }
  if (latestPreview && scenario.confirmation === "reject_latest") {
    const rejected = await app.rejectPlanningPreview({
      userId,
      previewId: latestPreview.id,
      idempotencyKey: `${scenario.id}:reject-latest`,
    });
    rejectedFutureRevision = rejected.planningPreview?.status === "rejected" &&
      (await app.readDomainProjection({ userId })).plan?.revision === initialRevision;
  }

  const finalSnapshot = await ledger.read();
  const finalProjection = await app.readDomainProjection({ userId });
  const risks = await app.readTimelineRiskEvaluations({ userId });
  const toolCalls = finalSnapshot.toolCalls.filter((call) => call.userId === userId && call.status === "output_available");
  const run = finalSnapshot.runs.find((candidate) => candidate.id === session.runIds?.at(-1));
  const agentArtifacts = finalSnapshot.artifacts.filter((artifact) =>
    toolCalls.some((call) => call.artifactRef?.id === artifact.id),
  );
  const latestRisk = risks.at(-1);
  const artifactsBeforeDecision = afterRisk.artifacts.filter(isUserArtifact(userId));
  const pendingFuturePreviews = artifactsBeforeDecision.filter(
    (artifact) => artifact.kind === "evidence_brief" && artifact.planningPreview?.status === "awaiting_confirmation" && artifact.planningPreview.request.requestedScope === "future_plan",
  ).length;

  return {
    scenarioId: scenario.id,
    initialPlan: { confirmed: true, revision: initialRevision },
    agent: {
      runStatus: run?.status,
      toolNames: toolCalls.map((call) => call.toolName),
      artifactKinds: agentArtifacts.map((artifact) => artifact.kind),
      toolResultReturnedToSameRun: provider.resumeRequests.some((request) => "toolName" in request.continuation),
    },
    timeline: {
      revision: finalProjection.timeline.revision,
      factKinds: finalProjection.timeline.current.map((event) => event.fact.kind),
      queuedOrCoalescedReasons: risks
        .filter((risk) => risk.outcome === "queued" || risk.disposition === "coalesced")
        .flatMap((risk) => risk.reasonCodes),
    },
    risk: { latest: riskReport(latestRisk) },
    planChanges: {
      currentPlanChangedBeforeConfirmation: projectionBeforeDecision.plan?.revision !== initialRevision,
      pendingFuturePreviews,
      confirmedFutureRevision,
      rejectedFutureRevision,
    },
    observability: {
      boundaries: [...new Set(traces.map((trace) => String(trace.metadata?.decisionBoundary)))].sort(),
      containsUserText: traces.some((trace) => JSON.stringify(trace).includes(scenario.userText)),
    },
  };
}

function scriptedProvider(action: HarnessAgentAction): ScriptedLLMProvider {
  const call = action === "show_today"
    ? { toolCallId: "show-today", toolName: "plan.show_today", input: { date: "2026-08-13" } }
    : action === "record_recovery"
      ? { toolCallId: "record-recovery", toolName: "timeline.record_user_report", input: { kind: "recovery", summary: "昨晚睡眠不足，今天主观恢复一般", perceivedRecovery: 3 } }
    : action === "energy_rebalance"
      ? { toolCallId: "energy-rebalance", toolName: "plan.propose_energy_rebalance", input: { description: "用户确认聚餐超出计划", excessKcal: 700 } }
      : { toolCallId: "recovery-adjustment", toolName: "plan.adapt_from_user_report", input: { kind: "recovery", summary: "用户报告睡眠差且腿部酸痛", qualitativeAssessment: "poor_sleep_localized_lower_soreness", requestedTrainingFocus: "shoulders" } };
  return new ScriptedLLMProvider(
    [{ type: "tool-call", ...call }, { type: "completed" }],
    [],
    [[{ type: "text-delta", delta: "已根据本地工具结果完成核对。" }, { type: "completed" }]],
  );
}

async function bootstrap(app: CoachApplication, userId: string, targetMode: HarnessGoalMode): Promise<void> {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: "coach-harness",
      occurredAt: NOW,
      timezoneOffsetMinutes: 480,
      idempotencyKey: `${userId}:bootstrap`,
    },
    profile: {
      id: `${userId}:profile`, trainingExperience: "intermediate", locale: "zh-CN",
      demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 75 },
      locations: [{ id: "gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
    },
    goalContract: {
      id: `${userId}:goal`, primaryGoal: "fat_loss_preserve_lean_mass", goalType: "fat_loss",
      targetMode, executionTier: targetMode === "higher_body_mass_fat_loss" ? "balanced" : "protect_deadline",
      horizon: { startDate: "2026-08-13", endDate: targetMode === "higher_body_mass_fat_loss" ? "2026-12-13" : "2026-09-10" },
      measurementPlan: { requiredMeasurements: ["body_weight", "waist_circumference", "key_lift"] },
      aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength" },
    },
    mandate: { id: `${userId}:mandate`, mode: "collaborative" },
  });
}

function latestFuturePreview(artifacts: readonly Artifact[]) {
  return [...artifacts].reverse().find(
    (artifact): artifact is Extract<Artifact, { kind: "evidence_brief" }> =>
      artifact.kind === "evidence_brief" && artifact.planningPreview?.request.requestedScope === "future_plan" && artifact.planningPreview.status === "awaiting_confirmation",
  );
}

function riskReport(risk: TimelineRiskEvaluationArtifact | undefined): AdaptiveCoachHarnessReport["risk"]["latest"] {
  return risk ? {
    outcome: risk.outcome,
    state: risk.achievabilityState,
    reasonCodes: risk.reasonCodes,
    disposition: risk.disposition,
  } : undefined;
}

function isUserArtifact(userId: string): (artifact: Artifact) => artifact is Exclude<Artifact, { userId?: never }> {
  return (artifact): artifact is Exclude<Artifact, { userId?: never }> =>
    "userId" in artifact && artifact.userId === userId;
}
