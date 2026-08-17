import { Agent, type AgentEvent, type AgentTool } from "@mariozechner/pi-agent-core";
import type { Message, Model } from "@mariozechner/pi-ai";

import { projectDomainEvents, validateBaselineIntake, type GoalContractData, type WellnessDimension } from "../coach/domain";
import type { CoachLedger } from "../coach/ledger";
import { stableHash } from "../coach/stable";
import type { CoachMessage, CoachRunRecord, CoachSession, CoachToolCallRecord, ContextRef, EvidenceBriefArtifact, FactRef, RuntimeServices } from "../coach/model";
import { negotiateGoalPaths, goalPathAggregateRefs, type GoalPathOption, type GoalPathDiagnosis } from "../goal-path";
import { goalPathSignalSummary } from "../coach/goalPathCopy";
import { INTAKE_FIELD_REGISTRY, intakeField, validateIntakeFieldValue } from "../coach/intakeFields";
import { AGENT_SOUL } from "../coach/agentSoul";
import { COACH_PLAYBOOK } from "../coach/playbook";
import { detectRedLine, RED_LINE_POLICY } from "../coach/redLines";

export interface PiAgentSource {
  readonly model: Model<any>;
  readonly streamFn: NonNullable<ConstructorParameters<typeof Agent>[0]>["streamFn"];
  readonly getApiKey?: NonNullable<ConstructorParameters<typeof Agent>[0]>["getApiKey"];
}

export interface ConversationItem {
  readonly id: string;
  readonly createdAt: string;
  readonly kind: "message" | "tool_activity" | "form" | "choice" | "goal_path" | "receipt";
  readonly state: "ready" | "working" | "completed" | "interrupted" | "failed";
  readonly content: string;
  readonly runId?: string;
  readonly toolName?: string;
  readonly role?: "user" | "assistant";
  readonly form?: { readonly kind: "baseline"; readonly status: "ready" | "submitted"; readonly draft?: { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string; revision: number } };
  readonly card?: Exclude<EvidenceBriefArtifact["conversationCard"], undefined>;
}

export interface BaselineInput {
  readonly userId: string;
  readonly ageYears: number;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly goalText?: string;
}

export interface ConversationRecordModule {
  recordBodyWeight(input: { userId: string; valueKg: number; occurredAt: string; idempotencyKey: string }): Promise<void>;
  recordExplicit?(input: ConversationExplicitRecord): Promise<{ readonly label: string; readonly detail?: string }>;
  /** Corrections are always user-confirmed and append a new Timeline fact. */
  correctExplicit?(input: ConversationExplicitCorrection): Promise<{ readonly label: string; readonly detail?: string }>;
}

export type ConversationExplicitRecord =
  | { kind: "body_weight"; userId: string; valueKg: number; occurredAt: string; idempotencyKey: string }
  | { kind: "body_fat"; userId: string; valuePercent: number; occurredAt: string; idempotencyKey: string }
  | { kind: "activity"; userId: string; activityType: string; durationMinutes?: number; energyKcal?: number; occurredAt: string; idempotencyKey: string }
  | {
      kind: "training";
      userId: string;
      /** An explicit completed/partial/missed report is evidence; silence never is. */
      executionStatus: "completed" | "partial" | "missed";
      summary: string;
      /** Optional current-stage session identity. The local record adapter,
       * not the model, resolves it to a Plan revision. */
      plannedSessionId?: string;
      durationMinutes?: number;
      occurredAt: string;
      idempotencyKey: string;
    }
  | { kind: "sleep"; userId: string; durationMinutes?: number; quality?: number; occurredAt: string; idempotencyKey: string }
  | { kind: "wellness_note"; userId: string; note: string; dimension?: WellnessDimension; occurredAt: string; idempotencyKey: string }
  | { kind: "recovery"; userId: string; perceivedRecovery?: number; occurredAt: string; idempotencyKey: string }
  | { kind: "clinical"; userId: string; context: "diagnosed_condition" | "medication" | "pregnancy_or_postpartum" | "recent_surgery_or_acute_injury" | "eating_disorder_or_low_energy_risk" | "other"; note?: string; occurredAt: string; idempotencyKey: string }
  | { kind: "nutrition"; userId: string; nutrients: readonly { nutrientId: string; value: number; unit: string; source: "current_user_statement" | "manually_transcribed_label" }[]; mealDescription?: string; dayCoverage?: "partial" | "complete"; occurredAt: string; idempotencyKey: string };

export interface ConversationExplicitCorrection {
  readonly kind: "correction";
  readonly userId: string;
  readonly correctsEventId: string;
  readonly reason: string;
  readonly replacement: ConversationExplicitRecord;
  readonly occurredAt: string;
  readonly idempotencyKey: string;
}

export interface ConversationGoalModule {
  /** A local confirmation boundary; the Agent may only make a proposal. */
  confirm(input: {
    userId: string;
    goal: GoalContractData;
    selectedOptionId: GoalPathOption["id"];
    idempotencyKey: string;
  }): Promise<{ readonly goal: GoalContractData }>;
}

export interface ConversationContextModule {
  read(input: { userId: string }): Promise<Readonly<Record<string, unknown>>>;
}

export interface ConversationPlanningModule {
  /** A Signal-originated run pins its source assessment instead of reading a newer unrelated review. */
  readInput(input: { userId: string; sourceAssessmentId?: string }): Promise<Readonly<Record<string, unknown>>>;
  propose(input: { userId: string; candidate: unknown; idempotencyKey: string }): Promise<{
    readonly status: "ready" | "invalid" | "applied";
    readonly proposalId?: string;
    readonly title: string;
    readonly summary: readonly string[];
    /** The conversation card carries the formal proposal's fact frontier. */
    readonly evidenceRefs?: readonly import("../coach/model").FactRef[];
    readonly details?: Extract<NonNullable<EvidenceBriefArtifact["conversationCard"]>, { kind: "plan_candidate" }>["details"];
  }>;
  confirm(input: { userId: string; proposalId: string; idempotencyKey: string }): Promise<void>;
  /** Reject the formal proposal as well as its conversational card. */
  reject(input: { userId: string; proposalId: string; idempotencyKey: string }): Promise<void>;
  /** Read-only: selected variants + sets/intent → per-muscle relative load split. */
  estimateMuscleLoad(input: {
    userId: string;
    items: readonly { exerciseVariantId: string; workSets: number; effortIntent?: "low" | "moderate" | "high" }[];
  }): Promise<{
    readonly policy: { readonly id: string; readonly version: string };
    readonly perMuscle: readonly { readonly muscleId: string; readonly role: string; readonly relativeLoad: number }[];
    readonly unknownExercises: readonly string[];
  }>;
  /** Read-only: confirmed history + optional draft sessions → daily residuals. */
  forecastRecovery(input: {
    userId: string;
    horizonDays: number;
    draftSessions?: readonly { date: string; items: readonly { exerciseVariantId: string; workSets: number; effortIntent?: "low" | "moderate" | "high" }[] }[];
  }): Promise<{
    readonly policy: { readonly id: string; readonly version: string };
    readonly start: import("../planning").RecoveryContext;
    readonly days: readonly { readonly date: string; readonly residualBefore: Readonly<Record<string, number>>; readonly added: Readonly<Record<string, number>>; readonly residualAfter: Readonly<Record<string, number>>; readonly windowHints: readonly string[] }[];
  }>;
}

export interface ConversationSignalModule {
  /** Fixed engine output only; this adapter never calls an LLM. */
  latestMaterial(input: { userId: string }): Promise<{
    readonly id: string;
    readonly state: "on_path" | "at_risk" | "infeasible_under_guardrails" | "insufficient_evidence";
    readonly diagnosis: GoalPathDiagnosis;
    readonly reasonCodes: readonly string[];
    readonly nextValidationSignals: readonly string[];
    readonly materialSignal: "hard_safety" | "review_recommended" | "monitor" | "none";
  } | undefined>;
}

/** Installed local knowledge is read-only; a missing result remains unknown. */
export interface ConversationKnowledgeModule {
  search(input: { query: string; topic?: "training" | "nutrition" | "recovery" | "exercise"; limit: number }): {
    readonly kind: "found" | "unknown";
    readonly entries: readonly {
      id: string;
      title: string;
      text: string;
      passageRef?: { passageId: string; contentHash: string; citationIds: readonly string[] };
    }[];
  };
  /** 分层下钻：按 passageId 读 L0 原文（search 只回蒸馏层）。 */
  read?(input: { passageId: string }): {
    readonly kind: "found" | "unknown";
    readonly id?: string;
    readonly title?: string;
    readonly text?: string;
    readonly citationIds?: readonly string[];
  };
}

/**
 * The transcript remains the source for conversation text.  This narrow seam
 * persists a deterministic recovery summary only after a conversation becomes
 * too long for the Pi context window; it can never overwrite domain facts.
 */
export interface ConversationMemoryModule {
  upsertConversationSummary(input: {
    userId: string;
    conversationId: string;
    runId: string;
    content: string;
    idempotencyKey: string;
  }): Promise<void>;
}

type ConversationCapability = "goal" | "planning" | "record";

/**
 * Scenario entries share one runtime but differ in system prompt, tool
 * manifest and injected facts:
 * - general: everyday conversation — record facts, answer, small plan changes.
 * - intake: profile setup and goal negotiation. The Agent drives: it interprets
 *   the goal wording, grounds each question in installed knowledge, and may
 *   compose small all-optional dynamic forms from the closed field registry.
 * - planning: current-stage organization or adjustment. The fixed facts pack
 *   is injected up front; the model never guesses energy, dose or safety.
 */
export type ConversationScenario = "general" | "intake" | "planning";

/** Production derives this from the local fact frontier; tests may substitute this narrow policy seam. */
export interface ConversationCapabilityModule {
  allowed(input: { userId: string; capability: ConversationCapability }): Promise<boolean>;
}

export interface ConversationProjection {
  readonly conversation: CoachSession;
  readonly items: readonly ConversationItem[];
  readonly run?: CoachRunRecord;
}

export type ConversationCommand =
  | { kind: "new"; userId: string }
  | { kind: "open"; userId: string; conversationId: string }
  | { kind: "send"; userId: string; conversationId: string; text: string; clientTurnId: string; attachment?: ContextRef }
  | { kind: "stop"; userId: string; conversationId: string }
  | { kind: "submit_baseline"; userId: string; conversationId: string; baseline: Omit<BaselineInput, "userId"> }
  | { kind: "save_baseline_draft"; userId: string; conversationId: string; draft: { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string } }
  | { kind: "submit_intake_form"; userId: string; conversationId: string; cardId: string; values: Readonly<Record<string, string>> }
  | { kind: "resolve_goal_path"; userId: string; conversationId: string; cardId: string; optionId: GoalPathOption["id"] }
  | { kind: "choose_record_only"; userId: string; conversationId: string; cardId?: string }
  | { kind: "continue_goal_discussion"; userId: string; conversationId: string; cardId: string }
  | { kind: "resolve_plan_candidate"; userId: string; conversationId: string; cardId: string; decision: "confirm" | "reject" }
  | { kind: "resolve_record"; userId: string; conversationId: string; cardId: string; decision: "confirm" | "reject" }
  | { kind: "request_correction"; userId: string; conversationId: string; cardId: string }
  | { kind: "reconcile"; userId: string; conversationId?: string; causationId: string };

export type ConversationCommandResult =
  | { kind: "opened"; conversation: CoachSession }
  | { kind: "started"; runId: string }
  | { kind: "steered"; runId: string }
  | { kind: "stopped"; runId?: string }
  | { kind: "baseline_submitted" }
  | { kind: "baseline_draft_saved" }
  | { kind: "intake_form_submitted" }
  | { kind: "goal_confirmed"; goal: GoalContractData }
  | { kind: "record_only_selected" }
  | { kind: "plan_candidate_confirmed" | "plan_candidate_rejected" }
  | { kind: "record_confirmed" | "record_rejected" }
  | { kind: "signal_started"; runId: string; conversationId: string }
  | { kind: "missing" };

export type ConversationQuery =
  | { kind: "conversation"; userId: string; conversationId: string }
  | { kind: "history"; userId: string };

export type ConversationQueryResult =
  | ({ kind: "conversation" } & ConversationProjection)
  | { kind: "history"; conversations: readonly CoachSession[] }
  | { kind: "missing" };

interface ActiveConversationRun {
  readonly runId: string;
  readonly agent: Agent;
}

/** Product adapters supplied by local composition, never by a UI screen. */
export interface PiAgentConversationDependencies {
  ledger: CoachLedger;
  runtime: RuntimeServices;
  pi: PiAgentSource;
  profileSetup?: (input: BaselineInput) => Promise<void>;
  records?: ConversationRecordModule;
  goals?: ConversationGoalModule;
  context?: ConversationContextModule;
  planning?: ConversationPlanningModule;
  signals?: ConversationSignalModule;
  knowledge?: ConversationKnowledgeModule;
  memory?: ConversationMemoryModule;
  capabilities?: ConversationCapabilityModule;
  /**
   * Experimental capabilities behind an eval gate. `recoveryCoachTools` stays
   * off until the deterministic recovery eval suite (tools/eval/recoveryCoachEval)
   * is green; production composition flips it only with that evidence.
   */
  featureFlags?: { readonly recoveryCoachTools?: boolean };
}

/**
 * Run 上下文清单的确定性哈希（审计钉版）。纯函数以便测试：同输入同哈希；
 * playbook 版本是清单的一等维度（姿态层升级必须可区分新旧 run）。
 */
export function conversationContextManifestHash(input: {
  readonly scenario: ConversationScenario;
  readonly factFrontier: readonly FactRef[];
  readonly playbook: string;
  readonly workingMemory: readonly string[];
  readonly pendingActions: readonly string[];
}): string {
  return stableHash({
    scenario: input.scenario,
    factFrontier: input.factFrontier,
    playbook: input.playbook,
    sources: ["domain_facts", "working_memory", "conversation_recall", "current_window"],
    workingMemory: input.workingMemory,
    pendingActions: input.pendingActions,
  });
}

/**
 * The single client-facing conversation Interface. It intentionally hides Pi
 * lifecycle, transcript reconstruction, tool execution and Ledger mutation.
 */
export class PiAgentConversationModule {
  private readonly active = new Map<string, ActiveConversationRun>();
  private readonly partialAssistantMessageIds = new Map<string, string>();
  private readonly signalAssessmentIds = new Map<string, string>();
  /** A bounded run prevents a malformed model/tool loop from becoming an
   * unbounded client-side background job.  The next user turn can continue
   * from the durable transcript. */
  private readonly toolCallsByRun = new Map<string, number>();

  constructor(private readonly dependencies: PiAgentConversationDependencies) {}

  async execute(command: ConversationCommand): Promise<ConversationCommandResult> {
    if (command.kind === "new") return this.openNew(command.userId);
    if (command.kind === "open") {
      const conversation = await this.findConversation(command.userId, command.conversationId);
      if (conversation) await this.recoverInterruptedRun(conversation);
      return conversation ? { kind: "opened", conversation } : { kind: "missing" };
    }
    if (command.kind === "stop") return this.stop(command.userId, command.conversationId);
    if (command.kind === "save_baseline_draft") return this.saveBaselineDraft(command);
    if (command.kind === "submit_baseline") return this.submitBaseline(command);
    if (command.kind === "submit_intake_form") return this.submitIntakeForm(command);
    if (command.kind === "resolve_goal_path") return this.resolveGoalPath(command);
    if (command.kind === "choose_record_only") return this.chooseRecordOnly(command);
    if (command.kind === "continue_goal_discussion") return this.continueGoalDiscussion(command);
    if (command.kind === "resolve_plan_candidate") return this.resolvePlanCandidate(command);
    if (command.kind === "resolve_record") return this.resolveRecord(command);
    if (command.kind === "request_correction") return this.requestCorrection(command);
    if (command.kind === "reconcile") return this.reconcileSignal(command);
    return this.send(command);
  }

  async read(query: ConversationQuery): Promise<ConversationQueryResult> {
    const snapshot = await this.dependencies.ledger.read();
    if (query.kind === "history") {
      return {
        kind: "history",
        conversations: snapshot.sessions
          .filter((session) => session.userId === query.userId && session.context.kind === "conversation" && session.status !== "archived")
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      };
    }
    const conversation = snapshot.sessions.find((session) => session.id === query.conversationId && session.userId === query.userId && session.context.kind === "conversation");
    if (!conversation) return { kind: "missing" };
    const messages = snapshot.messages.filter((message) => message.sessionId === conversation.id);
    const calls = snapshot.toolCalls.filter((call) => call.sessionId === conversation.id);
    const cards = snapshot.artifacts
      .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief"
        && artifact.userId === query.userId
        && Boolean(artifact.conversationCard)
        && artifact.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: query.userId });
    const items = [
      ...messages.map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        kind: "message" as const,
        state: "ready" as const,
        content: message.content,
        role: message.role === "user" ? "user" as const : "assistant" as const,
        ...(message.runId ? { runId: message.runId } : {}),
        sortAt: message.createdAt,
        sortPhase: message.role === "user" ? 0 : 2,
      })),
      ...calls.map((call) => ({
        id: call.id,
        createdAt: call.startedAt,
        kind: "tool_activity" as const,
        state: toolItemState(call.status),
        content: call.toolName,
        runId: call.runId,
        toolName: call.toolName,
        sortAt: call.startedAt,
        sortPhase: 1,
      })),
      ...cards.map((artifact) => {
        const card = effectiveConversationCard(
          artifact.conversationCard!,
          snapshot.presentations.find((presentation) => presentation.artifactId === artifact.id),
        );
        return {
          id: artifact.id,
          createdAt: artifact.createdAt,
          kind: cardItemKind(card),
          state: cardItemState(card),
          content: artifact.title,
          card,
          ...(card.kind === "baseline" ? { form: { kind: "baseline" as const, status: card.status === "ready" ? "ready" as const : "submitted" as const, ...(card.draft ? { draft: card.draft } : {}) } } : {}),
          sortAt: artifact.createdAt,
          sortPhase: 3,
        };
      }),
      ...(domain.profile || cards.some((artifact) => artifact.conversationCard?.kind === "baseline") ? [] : [{
        id: `baseline:${conversation.id}`,
        createdAt: conversation.createdAt,
        kind: "form" as const,
        state: "ready" as const,
        content: "先填写基础信息",
        runId: undefined,
        form: { kind: "baseline" as const, status: "ready" as const, ...((() => { const draft = latestBaselineDraft(snapshot, query.userId); return draft ? { draft } : {}; })()) },
        sortAt: conversation.createdAt,
        sortPhase: -1,
      }]),
    ].sort((left, right) => left.sortAt.localeCompare(right.sortAt)
      || ("runId" in left ? left.runId ?? "" : "").localeCompare("runId" in right ? right.runId ?? "" : "")
      || left.sortPhase - right.sortPhase || left.id.localeCompare(right.id));
    // The latest run is the conversation's current run.  Timestamps can tie
    // (same-millisecond stop→send), so insertion order breaks the tie toward
    // the most recently created run.
    let run: CoachRunRecord | undefined;
    for (const candidate of snapshot.runs) {
      if (candidate.sessionId !== conversation.id) continue;
      if (!run || candidate.updatedAt >= run.updatedAt) run = candidate;
    }
    return {
      kind: "conversation",
      conversation,
      items: items.map(({ sortAt: _sortAt, sortPhase: _sortPhase, ...item }) => item),
      ...(run ? { run } : {}),
    };
  }

  async whenIdle(conversationId: string): Promise<void> {
    const active = this.active.get(conversationId);
    await active?.agent.waitForIdle();
    if (active && this.active.get(conversationId) === active) this.active.delete(conversationId);
  }

  /** App shutdown never relies on Pi's in-memory session: terminal state is durable. */
  async dispose(): Promise<void> {
    const active = [...this.active.entries()];
    for (const [conversationId, run] of active) {
      run.agent.abort();
      await this.finishRun(conversationId, run.runId, "interrupted", "app_disposed");
    }
    this.active.clear();
    this.partialAssistantMessageIds.clear();
    this.signalAssessmentIds.clear();
    this.toolCallsByRun.clear();
  }

  private async openNew(userId: string): Promise<{ kind: "opened"; conversation: CoachSession }> {
    const now = this.dependencies.runtime.now();
    const conversation: CoachSession = {
      id: this.dependencies.runtime.nextId("conversation"),
      userId,
      status: "active",
      context: { kind: "conversation", ref: "general" },
      taskKind: "general",
      title: NEW_CONVERSATION_TITLE,
      revision: 1,
      contextRefs: [],
      messageIds: [],
      runIds: [],
      toolCallIds: [],
      artifactIds: [],
      presentationIds: [],
      pendingHumanActionIds: [],
      workingMemoryIds: [],
      createdAt: now,
      updatedAt: now,
    };
    const snapshot = await this.dependencies.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId });
    // A baseline draft belongs to the user, not to the conversation where it
    // was started: a fresh conversation prefills the latest unsubmitted draft
    // and continues its revision chain instead of asking again.
    const baselineDraft = !domain.profile ? latestBaselineDraft(snapshot, userId) : undefined;
    const welcome = !domain.profile ? {
      id: this.dependencies.runtime.nextId("message"), sessionId: conversation.id, userId, role: "assistant" as const,
      content: "你好，我是你的 Coach。先用三个基础信息建立档案；之后我们会在同一条对话里协商目标，或者直接开始记录。",
      createdAt: now,
    } : undefined;
    const baseline: EvidenceBriefArtifact | undefined = !domain.profile ? {
      id: `baseline:${conversation.id}`, kind: "evidence_brief", userId, schemaVersion: 1, renderVersion: 1, createdAt: now,
      contextRefs: [{ kind: "conversation", ref: conversation.id }], evidenceRefs: [], missingness: [],
      capabilityBoundary: ["baseline_is_a_local_schema_form", "conversation_not_route"], hash: stableHash({ conversationId: conversation.id, kind: "baseline" }),
      title: "建立基础档案", summary: ["年龄、身高和当前体重是仅有的必填项。"], conversationCard: { kind: "baseline", status: "ready", ...(baselineDraft ? { draft: baselineDraft } : {}) },
    } : undefined;
    await this.dependencies.ledger.commit({
      kind: "domain", userId, actorId: userId, intent: "conversation.open",
      expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: 0 }],
      domainEvents: [], sessions: [conversation], ...(welcome ? { messages: [welcome] } : {}), ...(baseline ? { artifacts: [baseline], presentations: [{ id: `presentation:${baseline.id}`, artifactId: baseline.id, renderer: "conversation-card/1", status: "awaiting_user" as const }] } : {}), idempotencyKey: `conversation.open:${conversation.id}`, recordedAt: now,
    });
    return { kind: "opened", conversation };
  }

  private async recoverInterruptedRun(conversation: CoachSession): Promise<void> {
    if (this.active.has(conversation.id)) return;
    const snapshot = await this.dependencies.ledger.read();
    let run: CoachRunRecord | undefined;
    for (const candidate of snapshot.runs) {
      if (candidate.sessionId !== conversation.id || !["streaming", "resuming"].includes(candidate.status)) continue;
      if (!run || candidate.updatedAt >= run.updatedAt) run = candidate;
    }
    if (run) await this.finishRun(conversation.id, run.id, "interrupted", "interrupted_after_restart");
  }

  /** Every run pins the fact frontier and context manifest it was built from,
   * so a later replay or audit can tell exactly what the Agent saw. */
  private async runAudit(userId: string, scenario: ConversationScenario): Promise<{ factFrontier: readonly FactRef[]; contextManifestHash: string }> {
    const snapshot = await this.dependencies.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId });
    const aggregateToFact: Record<string, FactRef["aggregate"]> = {
      timeline: "timeline", user_profile: "profile", goal_contract: "goal", plan: "plan",
      nutrition_strategy: "nutrition", coaching_mandate: "mandate", workout_session: "workout",
      recovery_constraint: "recovery", safety_constraint: "safety",
    };
    const factFrontier = goalPathAggregateRefs(domain).map((ref) => ({ aggregate: aggregateToFact[ref.kind] ?? "profile", id: ref.id, revision: ref.revision }));
    const contextManifestHash = conversationContextManifestHash({
      scenario,
      factFrontier,
      // playbook 版本必须进 manifest：姿态层（v9+）变更后旧 run 的钉版可区分。
      playbook: COACH_PLAYBOOK.version,
      workingMemory: snapshot.workingMemory
        .filter((item) => item.userId === userId && !item.deletedAt && !item.supersededBy)
        .map((item) => `${item.id}@${item.version}`),
      pendingActions: snapshot.pendingHumanActions
        .filter((action) => action.userId === userId && action.status === "pending")
        .map((action) => action.id),
    });
    return { factFrontier, contextManifestHash };
  }

  /** pi-agent 没有正式的 run 中追加系统指令 API；这是唯一改动点，升级 pi 时只需审这里。 */
  private appendSystemInstruction(agent: Agent, instruction: string): void {
    if (agent.state.systemPrompt.includes(instruction)) return;
    agent.state.systemPrompt = `${agent.state.systemPrompt}\n${instruction}`;
  }

  private async send(command: Extract<ConversationCommand, { kind: "send" }>): Promise<ConversationCommandResult> {
    if (!command.text.trim()) throw new Error("conversation_message_required");
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    // S01 硬边界：红线输入的转介注入是确定性的，不受对话风格或模型自觉影响。
    const redLineHits = detectRedLine(command.text);
    const active = this.active.get(conversation.id);
    if (active) {
      const now = this.dependencies.runtime.now();
      await this.appendMessage(conversation.id, { id: this.dependencies.runtime.nextId("message"), sessionId: conversation.id, userId: command.userId, role: "user", content: command.text.trim(), runId: active.runId, createdAt: now }, `conversation.steer:${command.clientTurnId}`);
      if (redLineHits.length) this.appendSystemInstruction(active.agent, RED_LINE_POLICY.instruction);
      active.agent.steer({ role: "user", content: command.text.trim(), timestamp: Date.parse(now) });
      return { kind: "steered", runId: active.runId };
    }
    const runId = this.dependencies.runtime.nextId("conversation-run");
    const now = this.dependencies.runtime.now();
    const userMessage: CoachMessage = { id: this.dependencies.runtime.nextId("message"), sessionId: conversation.id, userId: command.userId, role: "user", content: command.text.trim(), runId, createdAt: now };
    // A user without a confirmed profile is in the intake scenario even when
    // they type free text instead of using the baseline form.
    const scenarioDomain = projectDomainEvents((await this.dependencies.ledger.read()).domainEvents, { userId: command.userId });
    const scenario: ConversationScenario = scenarioDomain.profile ? "general" : "intake";
    const audit = await this.runAudit(command.userId, scenario);
    const run: CoachRunRecord = { id: runId, sessionId: conversation.id, userId: command.userId, clientTurnId: command.clientTurnId, status: "streaming", factFrontier: audit.factFrontier, contextManifestHash: audit.contextManifestHash, startedAt: now, updatedAt: now };
    await this.appendMessageAndRun(conversation, userMessage, run, command.attachment);
    const agent = await this.buildAgent(conversation.id, runId, scenario, command.attachment, redLineHits.length ? RED_LINE_POLICY.instruction : undefined);
    this.active.set(conversation.id, { runId, agent });
    void agent.prompt({ role: "user", content: command.text.trim(), timestamp: Date.parse(now) }).catch(async () => {
      await this.finishRun(conversation.id, runId, "failed", "pi_agent_runtime_failure");
    });
    return { kind: "started", runId };
  }

  /** Starts an auditable Agent turn caused by a confirmed local interaction, never a fabricated user message. */
  private async startInternalRun(conversation: CoachSession, instruction: string, clientTurnId: string, failureCode: string, scenario: ConversationScenario): Promise<string> {
    const existing = this.active.get(conversation.id);
    if (existing) return existing.runId;
    const runId = this.dependencies.runtime.nextId("conversation-run");
    const now = this.dependencies.runtime.now();
    const audit = await this.runAudit(conversation.userId, scenario);
    const run: CoachRunRecord = {
      id: runId,
      sessionId: conversation.id,
      userId: conversation.userId,
      clientTurnId,
      status: "streaming",
      factFrontier: audit.factFrontier,
      contextManifestHash: audit.contextManifestHash,
      startedAt: now,
      updatedAt: now,
    };
    await this.appendRun(conversation, run);
    const agent = await this.buildAgent(conversation.id, runId, scenario);
    this.active.set(conversation.id, { runId, agent });
    void agent.prompt({ role: "user", content: instruction, timestamp: Date.parse(now) }).catch(async () => {
      await this.finishRun(conversation.id, runId, "failed", failureCode);
    });
    return runId;
  }

  private async stop(userId: string, conversationId: string): Promise<ConversationCommandResult> {
    const active = this.active.get(conversationId);
    if (!active) return { kind: "stopped" };
    const conversation = await this.findConversation(userId, conversationId);
    if (!conversation) return { kind: "missing" };
    active.agent.abort();
    // Stop is terminal for this run's routing.  Clearing the active entry here
    // (not only in whenIdle) guarantees an immediate next send starts a fresh
    // run instead of steering an aborted agent.
    this.active.delete(conversationId);
    await this.finishRun(conversationId, active.runId, "interrupted", "user_terminated");
    return { kind: "stopped", runId: active.runId };
  }

  private async submitBaseline(command: Extract<ConversationCommand, { kind: "submit_baseline" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const { ageYears, heightCm, weightKg } = command.baseline;
    // Field ranges and units belong to the domain vocabulary, not this module.
    validateBaselineIntake({ ageYears, heightCm, weightKg });
    if (!this.dependencies.profileSetup) throw new Error("profile_setup_unavailable");
    await this.dependencies.profileSetup({ userId: command.userId, ...command.baseline });
    await this.persistConversationCard(conversation, {
      id: `baseline:${conversation.id}`, title: "基础档案已保存", summary: ["接下来由 Coach 根据你已经提供的信息继续。"],
      conversationCard: { kind: "baseline", status: "submitted", submitted: { ageYears, heightCm, weightKg, ...(command.baseline.goalText?.trim() ? { goalText: command.baseline.goalText.trim() } : {}) } },
    }, `conversation.baseline.card:${conversation.id}`);
    await this.startInternalRun(
      conversation,
      command.baseline.goalText?.trim()
        ? `A user just confirmed their baseline intake. Their own goal wording is: ${command.baseline.goalText.trim()}. Baseline measurements and this goal are the only fixed intake; everything after this point is yours to drive. Interpret what the goal wording actually means (outcome, time frame, acceptable cost), read the confirmed context, and never ask again for what is already confirmed. When a follow-up would materially change the goal path, ask it in your own words; where installed knowledge bears on what to ask or why it matters, search it first with knowledge.search_installed and ground the question in it. Ask at most the most material missing questions, or use a structured goal-path card when the fixed facts are sufficient.`
        : "A user just confirmed their baseline intake without an explicit goal. Read the confirmed context. Offer either discussing a goal or choosing record-only; do not assume they want record-only and do not repeat submitted measurements.",
      `baseline:${conversation.id}`,
      "pi_baseline_runtime_failure",
      "intake",
    );
    return { kind: "baseline_submitted" };
  }

  private async saveBaselineDraft(command: Extract<ConversationCommand, { kind: "save_baseline_draft" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const snapshot = await this.dependencies.ledger.read();
    const existing = snapshot.artifacts.find((artifact): artifact is EvidenceBriefArtifact => artifact.id === `baseline:${conversation.id}`
      && artifact.kind === "evidence_brief" && artifact.userId === command.userId);
    if (!existing?.conversationCard || existing.conversationCard.kind !== "baseline" || existing.conversationCard.status !== "ready") return { kind: "missing" };
    const draft = Object.fromEntries(Object.entries(command.draft).filter(([, value]) => typeof value === "string" && value.length <= 240));
    await this.persistConversationCard(conversation, {
      id: existing.id,
      title: existing.title,
      summary: existing.summary,
      conversationCard: { kind: "baseline", status: "ready", draft: { ...draft, revision: (existing.conversationCard.draft?.revision ?? 0) + 1 } },
    }, `conversation.baseline.draft:${conversation.id}:${stableHash(draft)}`);
    return { kind: "baseline_draft_saved" };
  }

  private async chooseRecordOnly(command: Extract<ConversationCommand, { kind: "choose_record_only" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    if (command.cardId) {
      const snapshot = await this.dependencies.ledger.read();
      const choice = snapshot.artifacts.find((artifact): artifact is EvidenceBriefArtifact => artifact.id === command.cardId
        && artifact.kind === "evidence_brief" && artifact.userId === command.userId
        && artifact.conversationCard?.kind === "choice"
        && artifact.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
      if (choice?.conversationCard?.kind === "choice" && choice.conversationCard.status === "ready") {
        await this.persistConversationCard(conversation, {
          id: choice.id,
          title: choice.title,
          summary: choice.summary,
          conversationCard: { ...choice.conversationCard, status: "resolved" },
        }, `conversation.record-only.choice-resolved:${choice.id}`);
      }
    }
    await this.persistConversationCard(conversation, {
      id: this.dependencies.runtime.nextId("record-only-receipt"),
      title: "已进入仅记录模式",
      summary: ["你可以随时记录训练、饮食显式数值、身体变化和恢复。准备好后再和 Coach 协商目标。"],
      conversationCard: { kind: "receipt", status: "recorded", label: "仅记录", detail: "没有创建目标、计划或营养策略" },
    }, `conversation.record-only:${command.cardId ?? conversation.id}`);
    // No fabricated assistant message here: the receipt card is the durable,
    // honest trace; the next Agent run speaks for itself.
    return { kind: "record_only_selected" };
  }

  private async continueGoalDiscussion(command: Extract<ConversationCommand, { kind: "continue_goal_discussion" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const snapshot = await this.dependencies.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.id === command.cardId
      && candidate.kind === "evidence_brief" && candidate.userId === command.userId
      && candidate.conversationCard?.kind === "choice"
      && candidate.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const card = artifact?.conversationCard;
    if (!artifact || !card || card.kind !== "choice" || card.status !== "ready") throw new Error("goal_discussion_choice_not_available");
    await this.persistConversationCard(conversation, {
      id: artifact.id,
      title: "继续协商目标",
      summary: ["Coach 会基于已确认信息，只追问会影响目标路径的关键信息。"],
      conversationCard: { ...card, status: "resolved" },
    }, `conversation.goal.continue:${artifact.id}`);
    const runId = await this.startInternalRun(
      conversation,
      "The user chose to continue discussing a goal. Interpret their goal wording (outcome, time frame, acceptable cost), read the confirmed context and prior wording, and never repeat known information. Where installed knowledge bears on what to ask next or why it matters, search it first with knowledge.search_installed and ground the question in it. Ask at most the material missing question(s) needed to determine a healthy target path, deadline and acceptable cost; when sufficient, use the goal-path confirmation tool.",
      `goal-discussion:${artifact.id}`,
      "pi_goal_discussion_runtime_failure",
      "intake",
    );
    return { kind: "started", runId };
  }

  private async resolveGoalPath(command: Extract<ConversationCommand, { kind: "resolve_goal_path" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    if (!this.dependencies.goals) throw new Error("goal_confirmation_unavailable");
    const snapshot = await this.dependencies.ledger.read();
    const card = snapshot.artifacts.find((artifact): artifact is EvidenceBriefArtifact => artifact.id === command.cardId
      && artifact.kind === "evidence_brief"
      && artifact.userId === command.userId
      && artifact.conversationCard?.kind === "goal_path"
      && artifact.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const goalCard = card?.conversationCard;
    if (!card || !goalCard || goalCard.kind !== "goal_path" || goalCard.status !== "awaiting_confirmation") throw new Error("goal_path_card_not_confirmable");
    const option = goalCard.options.find((candidate) => candidate.id === command.optionId);
    if (!option || !option.feasible) throw new Error("goal_path_option_unavailable");
    try {
      const confirmed = await this.dependencies.goals.confirm({
        userId: command.userId,
        goal: goalCard.goal,
        selectedOptionId: command.optionId,
        idempotencyKey: `conversation.goal.confirm:${card.id}:${command.optionId}`,
      });
      await this.persistConversationCard(conversation, {
        id: card.id, title: "目标已确认", summary: [`已选择 ${option.targetWeeks} 周的${option.id === "gradual" ? "渐进" : option.id === "balanced" ? "平衡" : "更快"}路径。`],
        conversationCard: { ...goalCard, status: "confirmed", goal: confirmed.goal },
      }, `conversation.goal.confirmed:${card.id}:${command.optionId}`);
      await this.startInternalRun(
        conversation,
        "The user just confirmed this Goal contract and selected its time/cost path. Read fixed planning input and the confirmed context. If the evidence is sufficient, organize exactly one current-stage candidate through the plan tool; otherwise ask only for a material missing fact. Never state that a plan is committed before the confirmation card is accepted.",
        `goal-confirmed:${card.id}:${command.optionId}`,
        "pi_goal_confirmation_runtime_failure",
        "planning",
      );
      return { kind: "goal_confirmed", goal: confirmed.goal };
    } catch (cause) {
      await this.persistConversationCard(conversation, {
        id: card.id, title: "目标方案需要重新确认", summary: ["确认前的档案或目标依据已变化；请让 Coach 重新生成方案。"],
        conversationCard: { ...goalCard, status: "stale" },
      }, `conversation.goal.stale:${card.id}`);
      throw cause;
    }
  }

  private async resolvePlanCandidate(command: Extract<ConversationCommand, { kind: "resolve_plan_candidate" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const snapshot = await this.dependencies.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.id === command.cardId
      && candidate.kind === "evidence_brief" && candidate.userId === command.userId
      && candidate.conversationCard?.kind === "plan_candidate"
      && candidate.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const card = artifact?.conversationCard;
    if (!artifact || !card || card.kind !== "plan_candidate" || card.status !== "awaiting_confirmation") throw new Error("plan_candidate_card_not_confirmable");
    if (command.decision === "reject") {
      if (!this.dependencies.planning) throw new Error("planning_confirmation_unavailable");
      await this.dependencies.planning.reject({
        userId: command.userId,
        proposalId: card.proposalId,
        idempotencyKey: `conversation.plan.reject:${artifact.id}`,
      });
      await this.persistConversationCard(conversation, {
        id: artifact.id, title: "未应用计划候选", summary: ["当前计划没有变化。你可以告诉 Coach 想改变哪一部分。"],
        conversationCard: { ...card, status: "rejected" },
      }, `conversation.plan.reject:${artifact.id}`);
      return { kind: "plan_candidate_rejected" };
    }
    if (!this.dependencies.planning) throw new Error("planning_confirmation_unavailable");
    try {
      await this.dependencies.planning.confirm({ userId: command.userId, proposalId: card.proposalId, idempotencyKey: `conversation.plan.confirm:${artifact.id}` });
      await this.persistConversationCard(conversation, {
        id: artifact.id, title: "当前阶段计划已确认", summary: ["计划和营养策略已作为新的正式 revision 保存。"],
        conversationCard: { ...card, status: "confirmed" },
      }, `conversation.plan.confirmed:${artifact.id}`);
      return { kind: "plan_candidate_confirmed" };
    } catch (cause) {
      await this.persistConversationCard(conversation, {
        id: artifact.id, title: "计划候选需要重新生成", summary: ["确认前的事实、目标或安全边界发生了变化，因此没有写入计划。"],
        conversationCard: { ...card, status: "stale" },
      }, `conversation.plan.stale:${artifact.id}`);
      throw cause;
    }
  }

  /** The correction entry on an auto-written record receipt: the Agent drives
   * the correction dialogue, never a silent edit. */
  private async requestCorrection(command: Extract<ConversationCommand, { kind: "request_correction" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const snapshot = await this.dependencies.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.id === command.cardId
      && candidate.kind === "evidence_brief" && candidate.userId === command.userId
      && candidate.conversationCard?.kind === "receipt"
      && candidate.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const card = artifact?.conversationCard;
    if (!artifact || !card || card.kind !== "receipt" || card.status !== "recorded" || !card.correctable) throw new Error("correction_entry_unavailable");
    const runId = await this.startInternalRun(
      conversation,
      `The user tapped correct on the receipt "${card.label}" in this conversation. Read the current context to find the matching recent Timeline record, ask what was wrong if it is not obvious, and only use timeline.correct_explicit with the replacement value the user explicitly states. Never guess a correction.`,
      `correction:${artifact.id}`,
      "pi_correction_runtime_failure",
      "general",
    );
    return { kind: "started", runId };
  }

  private async resolveRecord(command: Extract<ConversationCommand, { kind: "resolve_record" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const snapshot = await this.dependencies.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.id === command.cardId
      && candidate.kind === "evidence_brief" && candidate.userId === command.userId
      && candidate.conversationCard?.kind === "record_confirmation"
      && candidate.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const card = artifact?.conversationCard;
    if (!artifact || !card || card.kind !== "record_confirmation" || card.status !== "awaiting_confirmation") throw new Error("record_card_not_confirmable");
    if (command.decision === "reject") {
      await this.persistConversationCard(conversation, { id: artifact.id, title: "未写入记录", summary: ["原始对话仍保留；没有写入 Timeline。"], conversationCard: { ...card, status: "rejected" } }, `conversation.record.reject:${artifact.id}`);
      return { kind: "record_rejected" };
    }
    const pending = card.record as ConversationExplicitRecord | ConversationExplicitCorrection;
    if (!this.dependencies.records || (pending.kind !== "correction" && !this.dependencies.records.recordExplicit) || (pending.kind === "correction" && !this.dependencies.records.correctExplicit)) {
      throw new Error(pending.kind === "correction" ? "correction_unavailable" : "record_unavailable");
    }
    const receipt = pending.kind === "correction"
      ? await this.dependencies.records.correctExplicit?.(pending)
      : await this.dependencies.records.recordExplicit?.(pending);
    if (!receipt) throw new Error(pending.kind === "correction" ? "correction_unavailable" : "record_unavailable");
    await this.persistConversationCard(conversation, { id: artifact.id, title: "已写入正式记录", summary: [receipt.label], conversationCard: { ...card, status: "confirmed" } }, `conversation.record.confirm:${artifact.id}`);
    return { kind: "record_confirmed" };
  }

  private async reconcileSignal(command: Extract<ConversationCommand, { kind: "reconcile" }>): Promise<ConversationCommandResult> {
    if (!this.dependencies.signals) return { kind: "stopped" };
    const signal = await this.dependencies.signals.latestMaterial({ userId: command.userId });
    if (!signal) return { kind: "stopped" };
    const snapshot = await this.dependencies.ledger.read();
    const alreadyStarted = snapshot.artifacts.some((artifact) => artifact.kind === "evidence_brief"
      && artifact.userId === command.userId
      && artifact.conversationCard?.kind === "receipt"
      && artifact.conversationCard.detail === `signal:${signal.id}`);
    if (alreadyStarted) return { kind: "stopped" };
    let conversation = command.conversationId
      ? snapshot.sessions.find((session) => session.id === command.conversationId && session.userId === command.userId && session.context.kind === "conversation")
      : undefined;
    if (!conversation) {
      conversation = snapshot.sessions
        .filter((session) => session.userId === command.userId && session.context.kind === "conversation" && session.status !== "archived")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
    }
    if (!conversation) conversation = (await this.openNew(command.userId)).conversation;
    const active = this.active.get(conversation.id);
    if (active) {
      // A record written by the current Pi run must not start a second Agent
      // loop. Keep the fixed assessment visible in this same transcript and
      // pin it for a possible in-run planning read instead.
      await this.persistConversationCard(conversation, {
        id: `signal:${signal.id}:${conversation.id}`,
        title: "计划路径需要复核",
        summary: goalPathSignalSummary(signal),
        conversationCard: { kind: "receipt", status: "recorded", label: "固定检查已加入本轮对话", detail: `signal:${signal.id}` },
      }, `conversation.signal.active:${signal.id}:${conversation.id}`);
      this.signalAssessmentIds.set(active.runId, signal.id);
      return { kind: "stopped" };
    }
    await this.persistConversationCard(conversation, {
      id: `signal:${signal.id}:${conversation.id}`,
      title: "计划路径需要复核",
      summary: goalPathSignalSummary(signal),
      conversationCard: { kind: "receipt", status: "recorded", label: "固定检查已启动复核", detail: `signal:${signal.id}` },
    }, `conversation.signal:${signal.id}:${conversation.id}`);
    const runId = this.dependencies.runtime.nextId("signal-run");
    const now = this.dependencies.runtime.now();
    const audit = await this.runAudit(command.userId, "planning");
    const run: CoachRunRecord = { id: runId, sessionId: conversation.id, userId: command.userId, clientTurnId: `signal:${signal.id}`, status: "streaming", factFrontier: audit.factFrontier, contextManifestHash: audit.contextManifestHash, startedAt: now, updatedAt: now };
    await this.appendRun(conversation, run);
    this.signalAssessmentIds.set(runId, signal.id);
    const agent = await this.buildAgent(conversation.id, runId, "planning");
    this.active.set(conversation.id, { runId, agent });
    const instruction = `A fixed GoalPath review has material signal ${signal.id}. State: ${signal.state}. Reason codes: ${signal.reasonCodes.join(", ") || "none"}. Next validation signals: ${signal.nextValidationSignals.join(", ") || "none"}. Explain this bounded evidence. Do not label behavior a failure without goal context. Ask only for a material missing fact or use fixed planning input before proposing a gradual adjustment.`;
    void agent.prompt({ role: "user", content: instruction, timestamp: Date.parse(now) }).catch(async () => {
      await this.finishRun(conversation.id, runId, "failed", "pi_signal_runtime_failure");
    });
    return { kind: "signal_started", runId, conversationId: conversation.id };
  }

  /**
   * The planning scenario never waits for the model to ask: the fixed facts
   * pack is loaded before the first token. A failure becomes typed
   * insufficiency rather than a hidden gap.
   */
  private async planningFactsPack(userId: string, runId: string): Promise<Readonly<Record<string, unknown>>> {
    if (!this.dependencies.planning) return { status: "insufficient_facts", missing: ["planning_module"] };
    try {
      const sourceAssessmentId = this.signalAssessmentIds.get(runId);
      return await this.dependencies.planning.readInput({
        userId,
        ...(sourceAssessmentId ? { sourceAssessmentId } : {}),
      });
    } catch (cause) {
      return { status: "insufficient_facts", missing: [cause instanceof Error ? cause.message : "planning_input_unavailable"] };
    }
  }

  private intakeFormTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "intake.request_form",
      label: "发送补充信息表单",
      description:
        "Compose one small all-optional intake form from the closed field registry, only for fields that are still unknown and material to the current goal decision. Ground your choice in installed knowledge. Never request a field the user already answered.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["fieldIds", "reason"],
        properties: {
          fieldIds: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", enum: INTAKE_FIELD_REGISTRY.map((field) => field.id) } },
          reason: { type: "string", minLength: 1, maxLength: 240 },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation) throw new Error("conversation_not_found");
        const value = params as { fieldIds?: unknown; reason?: unknown };
        const requested = Array.isArray(value.fieldIds) ? value.fieldIds.filter((id): id is string => typeof id === "string") : [];
        const reason = typeof value.reason === "string" && value.reason.trim() ? value.reason.trim() : "";
        if (!requested.length || !reason) throw new Error("intake_form_input_invalid");
        const answered = await this.answeredIntakeFieldIds(conversation.userId);
        const fields = [...new Set(requested)].filter((id) => {
          const spec = intakeField(id);
          return spec && !answered.has(id);
        });
        if (!fields.length) {
          return { content: [{ type: "text", text: "这些信息已经收集过了；不要再问。" }], details: { source: "intake_field_registry", runId, status: "already_answered" } };
        }
        const card = await this.persistConversationCard(conversation, {
          id: `intake-form:${stableHash({ conversationId, toolCallId, fields })}`,
          title: "补充信息",
          summary: [reason],
          toolCallId,
          conversationCard: { kind: "intake_form", status: "ready", reason, fields },
        }, `conversation.intake.form:${conversation.id}:${toolCallId}`);
        return {
          content: [{ type: "text", text: "我把这几个可选问题放在表单卡里了；用户填多少算多少。" }],
          details: { artifactId: card.id, source: "intake_field_registry", runId, fields },
        };
      },
    };
  }

  /** Field ids already answered in any submitted intake form of this user. */
  private async answeredIntakeFieldIds(userId: string): Promise<ReadonlySet<string>> {
    const snapshot = await this.dependencies.ledger.read();
    const answered = new Set<string>();
    for (const artifact of snapshot.artifacts) {
      if (artifact.kind !== "evidence_brief" || artifact.userId !== userId) continue;
      const card = artifact.conversationCard;
      if (card?.kind === "intake_form" && card.status === "submitted" && card.values) {
        for (const id of Object.keys(card.values)) answered.add(id);
      }
    }
    return answered;
  }

  private async submitIntakeForm(command: Extract<ConversationCommand, { kind: "submit_intake_form" }>): Promise<ConversationCommandResult> {
    const conversation = await this.findConversation(command.userId, command.conversationId);
    if (!conversation) return { kind: "missing" };
    const snapshot = await this.dependencies.ledger.read();
    const artifact = snapshot.artifacts.find((candidate): candidate is EvidenceBriefArtifact => candidate.id === command.cardId
      && candidate.kind === "evidence_brief" && candidate.userId === command.userId
      && candidate.conversationCard?.kind === "intake_form"
      && candidate.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id));
    const card = artifact?.conversationCard;
    if (!artifact || !card || card.kind !== "intake_form" || card.status !== "ready") throw new Error("intake_form_not_submittable");
    // Every value is validated against the closed registry; unknown or invalid
    // input never reaches storage. Empty answers stay unknown.
    const values: Record<string, string> = {};
    for (const fieldId of card.fields) {
      const spec = intakeField(fieldId);
      if (!spec) throw new Error(`intake_field_unknown:${fieldId}`);
      const normalized = validateIntakeFieldValue(spec, command.values[fieldId]);
      if (normalized !== undefined) values[fieldId] = normalized;
    }
    await this.persistConversationCard(conversation, {
      id: artifact.id,
      title: artifact.title,
      summary: artifact.summary,
      conversationCard: { ...card, status: "submitted", values },
    }, `conversation.intake.submit:${artifact.id}:${stableHash(values)}`);
    // A declared clinical answer is a user-confirmed statement and enters the
    // formal Timeline through the same record admission as any manual entry.
    const clinicalNote = values["injury_or_condition"];
    if (clinicalNote && this.dependencies.records?.recordExplicit) {
      await this.dependencies.records.recordExplicit({
        kind: "clinical",
        userId: command.userId,
        context: "other",
        note: clinicalNote,
        occurredAt: this.dependencies.runtime.now(),
        idempotencyKey: `conversation.intake.clinical:${artifact.id}`,
      });
    }
    await this.startInternalRun(
      conversation,
      "The user just submitted an intake form. Absorb every answered field, never ask for them again, and continue: ask the next material question, compose one more small optional form only if something material is still unknown, or move to a goal-path card / record-only when the picture is sufficient.",
      `intake-form:${artifact.id}`,
      "pi_intake_followup_runtime_failure",
      "intake",
    );
    return { kind: "intake_form_submitted" };
  }

  private async buildAgent(conversationId: string, runId: string, scenario: ConversationScenario, attachment?: ContextRef, safetyInstruction?: string): Promise<Agent> {
    const snapshot = await this.dependencies.ledger.read();
    const conversation = snapshot.sessions.find((session) => session.id === conversationId);
    if (!conversation) throw new Error("conversation_not_found");
    const history = snapshot.messages
      .filter((message) => message.sessionId === conversationId)
      .map((message) => message.role === "assistant"
        ? {
            role: "assistant" as const,
            // Pi's assistant protocol is structured even when our durable
            // transcript stores only visible text. Rehydrate it here rather
            // than leaking a string into the OpenAI transport.
            content: [{ type: "text" as const, text: message.content }],
            timestamp: Date.parse(message.createdAt),
          }
        : {
            // Tool results are durable trace text, not executable Pi protocol
            // messages. Feed them back as user-visible context only.
            role: "user" as const,
            content: message.content,
            timestamp: Date.parse(message.createdAt),
          }) as never[];
    const localContext = await this.defaultContext(conversation.userId, conversation.id);
    const contextualFacts = {
      ...(this.dependencies.context
        ? { ...localContext, ...(await this.dependencies.context.read({ userId: conversation.userId })) }
        : localContext),
      // The page the user was looking at when sending this turn. Optional,
      // per-turn, and never the conversation's identity.
      ...(attachment ? { turnAttachment: attachment } : {}),
    };
    const planningFacts = scenario === "planning" ? await this.planningFactsPack(conversation.userId, runId) : undefined;
    const agent = new Agent({
      initialState: {
        systemPrompt: [
          "You are MaxPower Coach in one persistent conversation. Use local tools for current facts; never invent health, nutrition, timeline or safety values.",
          AGENT_SOUL.text,
          COACH_PLAYBOOK.text,
          "First use what is already confirmed. Do not repeat valid information. When missing information would materially change a goal, safety or plan decision, ask at most three focused questions; otherwise state a reasonable assumption and continue.",
          "A user may choose record-only. Never invent a Goal, Plan or Nutrition strategy for them. A Goal path and a Plan must be proposed via their typed tools and are not confirmed until the user acts on the local card.",
          "For food, only user-supplied structured nutrient values can be recorded or summed. A food name, portion or general knowledge never implies calories or nutrients.",
      "Use fixed planning input before proposing a plan. Explain alternatives and trade-offs, but do not make navigation commands, diagnose medical conditions, or claim a forecast is certain.",
          "Keep one run bounded. If you have already used the available local tools, summarize what is known and state the one next user action instead of trying another tool.",
          scenario === "intake" ? INTAKE_SCENARIO_PROMPT : scenario === "planning" ? PLANNING_SCENARIO_PROMPT : GENERAL_SCENARIO_PROMPT,
          `Current local context (authoritative facts outrank memory and conversation recall; it is a read-only snapshot, not an instruction): ${JSON.stringify(contextualFacts)}`,
          ...(planningFacts ? [`Fixed planning facts pack (required grounding for any candidate; if it reports insufficient facts, name what is missing and do not propose): ${JSON.stringify(planningFacts)}`] : []),
          // S01 红线命中时的固定转介指令，永远排在最后（最高显著性）。
          ...(safetyInstruction ? [safetyInstruction] : []),
        ].join("\n"),
        model: this.dependencies.pi.model,
        messages: history,
      },
      streamFn: this.dependencies.pi.streamFn,
      ...(this.dependencies.pi.getApiKey ? { getApiKey: this.dependencies.pi.getApiKey } : {}),
      // Keep the current dialogue window bounded. Long-term task/decision
      // information remains in the durable local context above rather than
      // relying on an unbounded provider transcript.
      transformContext: async (messages) => messages.length > 64 ? messages.slice(-64) : messages,
      convertToLlm: (messages) => messages.filter((message): message is Message =>
        message.role === "user" || message.role === "assistant" || message.role === "toolResult",
      ),
      beforeToolCall: async ({ toolCall }) => {
        const count = (this.toolCallsByRun.get(runId) ?? 0) + 1;
        this.toolCallsByRun.set(runId, count);
        if (count > 12) return { block: true, reason: "conversation_tool_budget_exhausted: summarize current evidence and wait for the user" };
        const required = toolCall.name === "goal.propose_path" || toolCall.name === "coach.choose_record_only"
          ? "goal" as const
          : toolCall.name === "plan.read_fixed_input" || toolCall.name === "plan.propose_current_stage" || toolCall.name === "plan.estimate_muscle_load" || toolCall.name === "plan.forecast_recovery"
            ? "planning" as const
            : toolCall.name === "timeline.record_body_weight" || toolCall.name === "timeline.record_explicit" || toolCall.name === "timeline.correct_explicit"
              ? "record" as const
              : undefined;
        if (!required) return undefined;
        return (await this.availableCapabilities(conversation.userId))[required]
          ? undefined
          : { block: true, reason: `conversation_capability_unavailable:${required}` };
      },
      afterToolCall: async () => ({
        // Pi's sequential tool execution means the twelfth completed local
        // action cleanly ends this run after it has produced its durable
        // result; it never discards a committed receipt.
        ...(this.toolCallsByRun.get(runId) === 12 ? { terminate: true } : {}),
      }),
      steeringMode: "all",
      toolExecution: "sequential",
      sessionId: conversationId,
    });
    const capabilities = await this.availableCapabilities(conversation.userId);
    agent.state.tools = [
      this.profileTool(conversationId, runId),
      this.contextTool(conversationId, runId),
      // The intake scenario adds the dynamic form tool; the planning scenario
      // drops goal negotiation (the goal is already confirmed) and vice versa.
      // Everyday conversation gets the capability-allowed working set.
      ...(scenario === "intake" ? [this.intakeFormTool(conversationId, runId)] : []),
      ...(scenario !== "planning" && this.dependencies.goals && capabilities.goal ? [this.goalPathTool(conversationId, runId), this.recordOnlyTool(conversationId, runId)] : []),
      ...(scenario !== "intake" && this.dependencies.planning && capabilities.planning ? [this.planningInputTool(conversationId, runId), this.planCandidateTool(conversationId, runId)] : []),
      // 恢复感知工具在 eval 门（tools/eval/recoveryCoachEval）达标前不进清单。
      ...(scenario !== "intake" && this.dependencies.planning && capabilities.planning && this.dependencies.featureFlags?.recoveryCoachTools === true ? [this.estimateMuscleLoadTool(conversationId, runId), this.forecastRecoveryTool(conversationId, runId)] : []),
      ...(this.dependencies.records && capabilities.record ? [this.bodyWeightTool(conversationId, runId), this.explicitRecordTool(conversationId, runId), ...(this.dependencies.records.correctExplicit ? [this.correctExplicitRecordTool(conversationId, runId)] : [])] : []),
      ...(this.dependencies.knowledge ? [this.knowledgeSearchTool(conversationId, runId), ...(this.dependencies.knowledge.read ? [this.knowledgeReadTool(conversationId, runId)] : [])] : []),
    ];
    agent.subscribe(async (event) => this.persistAgentEvent(conversationId, runId, event));
    return agent;
  }

  private profileTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "coach.read_profile",
      label: "读取当前档案",
      description: "Read the user's current confirmed profile. Use it before saying profile facts.",
      parameters: { type: "object", additionalProperties: false },
      execute: async () => {
        const snapshot = await this.dependencies.ledger.read();
        const conversation = snapshot.sessions.find((session) => session.id === conversationId);
        if (!conversation) throw new Error("conversation_not_found");
        const domain = projectDomainEvents(snapshot.domainEvents, { userId: conversation.userId });
        const profile = domain.profile?.value;
        return {
          content: [{ type: "text", text: JSON.stringify(profile ?? { status: "unknown" }) }],
          details: { source: "local_ledger", profilePresent: Boolean(profile), runId },
        };
      },
    };
  }

  private contextTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "coach.read_context",
      label: "读取当前上下文",
      description: "Read confirmed profile, goal, current plan, timeline summary and safety state. Confirmed local facts outrank memory and prior conversation.",
      parameters: { type: "object", additionalProperties: false },
      execute: async () => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation) throw new Error("conversation_not_found");
        const base = await this.defaultContext(conversation.userId);
        const context = this.dependencies.context
          ? { ...base, ...(await this.dependencies.context.read({ userId: conversation.userId })) }
          : base;
        return {
          content: [{ type: "text", text: JSON.stringify(context) }],
          details: { source: "local_ledger", runId, authority: "confirmed_facts_first" },
        };
      },
    };
  }

  private goalPathTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "goal.propose_path",
      label: "提出目标路径",
      description: "Turn only explicit user goal details into a Goal-path confirmation card. Required: primaryGoal, targetWeeks, and a measurable target such as targetWeightKg. Never confirm the goal yourself.",
      parameters: {
        type: "object", additionalProperties: false,
        required: ["primaryGoal", "targetWeeks"],
        properties: {
          primaryGoal: { enum: ["hypertrophy", "strength", "fat_loss_preserve_lean_mass", "physique", "maintain", "return_to_training"] },
          targetWeeks: { type: "integer", minimum: 1, maximum: 260 },
          targetWeightKg: { type: "number", minimum: 25, maximum: 400 },
          acceptableCosts: { type: "array", maxItems: 8, items: { type: "string", maxLength: 120 } },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation) throw new Error("conversation_not_found");
        await this.assertCapability(conversation.userId, "goal");
        const draft = goalDraftFromToolParams(params, conversation.userId, this.dependencies.runtime.now());
        const snapshot = await this.dependencies.ledger.read();
        const domain = projectDomainEvents(snapshot.domainEvents, { userId: conversation.userId });
        const preview = negotiateGoalPaths({ goal: draft, profile: domain.profile?.value, domain, today: this.dependencies.runtime.now().slice(0, 10) });
        if (preview.status !== "options") {
          return {
            content: [{ type: "text", text: `还不能生成目标方案：${preview.missing.join("、") || "当前没有安全路径"}。请只追问这些关键缺失信息。` }],
            details: { source: "fixed_goal_path", runId, status: preview.status, missing: preview.missing },
          };
        }
        const artifact = await this.persistConversationCard(conversation, {
          id: `goal-path:${stableHash({ conversationId, toolCallId, draft, options: preview.options })}`,
          title: "确认目标路径",
          summary: ["请选择时间与投入的平衡；确认前不会建立目标或计划。"],
          toolCallId,
          conversationCard: {
            kind: "goal_path", status: "awaiting_confirmation", goal: draft,
            options: preview.options.map((option) => ({
              id: option.id, targetWeeks: option.targetWeeks, behaviorBurden: option.behaviorBurden,
              trainingBurden: option.trainingBurden, recordingBurden: option.recordingBurden,
              feasible: option.feasible, conflictReasons: option.conflictReasons,
            })),
          },
        }, `conversation.goal.propose:${conversation.id}:${toolCallId}`);
        return {
          content: [{ type: "text", text: "我已经把可行的时间与投入方案放在确认卡里。请你选一个；确认前不会修改目标。" }],
          details: { artifactId: artifact.id, source: "fixed_goal_path", runId },
        };
      },
    };
  }

  private recordOnlyTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "coach.choose_record_only",
      label: "选择仅记录",
      description: "Use when the user explicitly says they have no goal yet or want to only record. This never creates a goal or plan.",
      parameters: { type: "object", additionalProperties: false },
      execute: async (toolCallId) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation) throw new Error("conversation_not_found");
        await this.assertCapability(conversation.userId, "goal");
        const artifact = await this.persistConversationCard(conversation, {
          id: `record-only-choice:${stableHash({ conversationId, toolCallId })}`,
          title: "先仅记录，还是现在设定目标？",
          summary: ["仅记录不会创建目标、计划或营养策略。"],
          toolCallId,
          conversationCard: {
            kind: "choice", status: "ready", prompt: "你可以先记录，也可以随时再设定目标。",
            options: [{ id: "record_only", label: "先仅记录", detail: "不创建目标或计划" }, { id: "continue_goal", label: "继续聊目标", detail: "补充目标、时间与投入" }],
          },
        }, `conversation.record-only.propose:${conversation.id}:${toolCallId}`);
        return { content: [{ type: "text", text: "我把选择放在卡片里了。" }], details: { artifactId: artifact.id, runId } };
      },
    };
  }

  private planningInputTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "plan.read_fixed_input",
      label: "读取固定计划依据",
      description: "Read the fixed local planning envelope before proposing a current-stage plan. Never guess energy ranges, safety constraints, Goal details, or evidence coverage.",
      parameters: { type: "object", additionalProperties: false },
      execute: async () => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation || !this.dependencies.planning) throw new Error("planning_input_unavailable");
        await this.assertCapability(conversation.userId, "planning");
        const sourceAssessmentId = this.signalAssessmentIds.get(runId);
        const input = await this.dependencies.planning.readInput({
          userId: conversation.userId,
          ...(sourceAssessmentId ? { sourceAssessmentId } : {}),
        });
        return { content: [{ type: "text", text: JSON.stringify(input) }], details: { source: "fixed_planning_input", runId } };
      },
    };
  }

  private knowledgeSearchTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "knowledge.search_installed",
      label: "检索已安装知识",
      description: "Search only installed local training, nutrition, recovery or exercise knowledge. Returns distilled digests (section gist plus per-passage key conclusions) with passage ids; when a digest is not enough, read the full original passage with knowledge.read_passage. If there is no result, say it is unknown; do not replace it with general model knowledge. This tool never looks up food composition.",
      parameters: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 120 }, topic: { enum: ["training", "nutrition", "recovery", "exercise"] } } },
      execute: async (_toolCallId, params) => {
        const query = typeof (params as { query?: unknown })?.query === "string" ? (params as { query: string }).query.trim() : "";
        if (!query || !this.dependencies.knowledge) throw new Error("knowledge_query_invalid");
        const topic = (params as { topic?: unknown })?.topic;
        const result = this.dependencies.knowledge.search({
          query,
          ...(topic === "training" || topic === "nutrition" || topic === "recovery" || topic === "exercise" ? { topic } : {}),
          limit: 3,
        });
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (conversation) {
          await this.persistConversationCard(conversation, {
            id: `knowledge:${stableHash({ conversationId, runId, query, topic })}`,
            title: `知识检索：${query}`,
            summary: result.kind === "found" ? result.entries.map((entry) => entry.title) : ["当前已安装知识中没有匹配内容。"],
            toolCallId: _toolCallId,
            conversationCard: { kind: "receipt", status: "recorded", label: "已检索本地知识", detail: result.kind === "found" ? result.entries.map((entry) => entry.title).join("；") : "未找到匹配内容" },
          }, `conversation.knowledge.card:${conversation.id}:${_toolCallId}`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result.kind === "found" ? result.entries : { status: "unknown", query }) }],
          details: { source: "installed_knowledge", runId, status: result.kind, passageRefs: result.entries.flatMap((entry) => entry.passageRef ? [entry.passageRef] : []) },
        };
      },
    };
  }

  private knowledgeReadTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "knowledge.read_passage",
      label: "读取知识原文段落",
      description: "Read the full original text of one installed knowledge passage by its passage id (from knowledge.search_installed results). Use it only when the distilled digest is not enough for the answer.",
      parameters: { type: "object", additionalProperties: false, required: ["passageId"], properties: { passageId: { type: "string", minLength: 1, maxLength: 160 } } },
      execute: async (toolCallId, params) => {
        const passageId = typeof (params as { passageId?: unknown })?.passageId === "string" ? (params as { passageId: string }).passageId.trim() : "";
        if (!passageId || !this.dependencies.knowledge?.read) throw new Error("knowledge_passage_invalid");
        const result = this.dependencies.knowledge.read({ passageId });
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (conversation) {
          await this.persistConversationCard(conversation, {
            id: `knowledge-read:${stableHash({ conversationId, toolCallId })}`,
            title: `知识原文：${result.title ?? passageId}`,
            summary: [result.kind === "found" ? "已读取原文段落" : "未找到该段落"],
            toolCallId,
            conversationCard: { kind: "receipt", status: "recorded", label: "已读取知识原文", detail: result.title ?? passageId },
          }, `conversation.knowledge-read:${conversation.id}:${toolCallId}`);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result.kind === "found" ? result : { status: "unknown", passageId }) }],
          details: { source: "installed_knowledge", runId, status: result.kind },
        };
      },
    };
  }

  private planCandidateTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "plan.propose_current_stage",
      label: "提交当前阶段计划候选",
      description: "Submit one structured current-stage candidate after reading fixed planning input. candidate must include planRevision {id, baseRevision, goalContractRef, knowledgePins, effectiveFrom, sessions, observationContract} and nutritionStrategy {id, goalContractRef, planRef, calorieRange, nutrientTargets}; also behaviorChanges, rationale and expectedTradeoffs. goalContractRef must bind the current goal version from the fixed input; knowledgePins must be copied verbatim from the fixed input (planRevision.knowledgePins and each session's knowledgePins). calorieRange is {min:{value,unit},max:{value,unit}} but nutrientTargets is a map nutrientId -> { minimum?: number, maximum?: number, target?: number } of plain numbers (no value/unit objects). nutritionStrategy must also carry trackingPrecision, the diet-tracking precision tier you judge from the goal's precision demand and this person's execution baseline: behavioral (one-sentence meal notes suffice), magnitude (approximate amounts), precise (structured numbers; goals near physiological limits always need this) — state the reason in rationale. observationContract condition fields (requiredSignals/successConditions/progressionConditions/holdConditions/fallbackConditions/stopConditions) are all string arrays. Each session must be future-only and have id, scheduledFor, tasks and a bounded duration. When a session declares stimulusSlots, every slot needs intent {movementPattern, muscleGroups, directMuscles, stability, prescriptionMode, fatigueIntent, priority} and prescription {setCount, repRange {min,max}, targetRir, rest}, and each task links its slot via stimulusSlotId with sets.length equal to that slot's prescription.setCount. observationContract must state minimumObservationDays >=7. The fixed engine validates it. This tool does not commit a plan.",
      parameters: {
        type: "object", additionalProperties: false, required: ["candidate"], properties: {
          candidate: {
            type: "object", additionalProperties: false,
            required: ["planRevision", "nutritionStrategy", "behaviorChanges", "rationale", "expectedTradeoffs"],
            properties: {
              planRevision: { type: "object" },
              nutritionStrategy: { type: "object" },
              behaviorChanges: { type: "array", maxItems: 12, items: { type: "object", additionalProperties: false, required: ["id", "instruction", "burden", "preferenceRefs"], properties: { id: { type: "string", maxLength: 120 }, instruction: { type: "string", minLength: 1, maxLength: 500 }, burden: { enum: ["low", "moderate", "high"] }, preferenceRefs: { type: "array", maxItems: 12, items: { type: "string", maxLength: 160 } } } } },
              rationale: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
              expectedTradeoffs: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 500 } },
              sourceAssessmentId: { type: "string", maxLength: 160 },
            },
          },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        const candidate = (params as { candidate?: unknown })?.candidate;
        if (!conversation || !this.dependencies.planning || !candidate || typeof candidate !== "object") throw new Error("plan_candidate_invalid");
        await this.assertCapability(conversation.userId, "planning");
        const raw = candidate as Record<string, unknown>;
        const localCandidate = {
          id: typeof (candidate as { id?: unknown }).id === "string" ? (candidate as { id: string }).id : `candidate:${conversation.id}:${toolCallId}`,
          planRevision: raw.planRevision,
          nutritionStrategy: raw.nutritionStrategy,
          behaviorChanges: raw.behaviorChanges,
          rationale: raw.rationale,
          expectedTradeoffs: raw.expectedTradeoffs,
          ...(typeof raw.sourceAssessmentId === "string" ? { sourceAssessmentId: raw.sourceAssessmentId } : {}),
          generatedBy: { kind: "llm", runId, model: this.dependencies.pi.model.id },
        };
        let result: Awaited<ReturnType<ConversationPlanningModule["propose"]>>;
        try {
          result = await this.dependencies.planning.propose({ userId: conversation.userId, candidate: localCandidate, idempotencyKey: `conversation.plan.propose:${conversation.id}:${toolCallId}` });
        } catch (cause) {
          result = { status: "invalid", title: "计划候选未通过固定校验", summary: [cause instanceof Error ? cause.message : "plan_candidate_invalid"] };
        }
        const card = await this.persistConversationCard(conversation, {
          id: `plan-card:${stableHash({ conversationId, toolCallId, proposalId: result.proposalId, status: result.status })}`,
          title: result.title, summary: result.summary,
          ...(result.evidenceRefs ? { evidenceRefs: result.evidenceRefs } : {}),
          toolCallId,
          conversationCard: result.status === "ready" && result.proposalId
            ? { kind: "plan_candidate", status: "awaiting_confirmation", proposalId: result.proposalId, title: result.title, summary: result.summary, ...(result.details ? { details: result.details } : {}) }
            : result.status === "applied" && result.proposalId
              ? { kind: "plan_candidate", status: "confirmed", proposalId: result.proposalId, title: result.title, summary: result.summary, ...(result.details ? { details: result.details } : {}) }
            : { kind: "plan_candidate", status: "invalid", proposalId: result.proposalId ?? "none", title: result.title, summary: result.summary, ...(result.details ? { details: result.details } : {}) },
        }, `conversation.plan.card:${conversation.id}:${toolCallId}`);
        return {
          // The model must see WHY fixed validation failed, or it cannot
          // correct the candidate. The issues are fixed-engine codes and
          // product-language messages, never internal stack detail.
          content: [{ type: "text", text: result.status === "ready" ? "固定校验已通过。我把候选放在确认卡中；确认前不会写入计划。" : result.status === "applied" ? "固定校验和你的授权都允许这次小幅调整，新的 revision 已保存。" : `这个候选没有通过固定校验：${result.summary.join("；") || "plan_candidate_invalid"}。请只修正这些问题后重新提交一次。` }],
          details: { artifactId: card.id, validation: result.status, runId },
        };
      },
    };
  }

  /** Read-only load estimation tool: quality layer for plan composition. */
  private estimateMuscleLoadTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "plan.estimate_muscle_load",
      label: "估算肌群负荷",
      description: "Read-only. Estimate per-muscle relative load (primary/synergist/stabilizer) for selected exercise variants with set counts and effort intent. Use it while composing to compare candidate exercises' muscle impact. Variants with unreviewed muscle associations are reported as unknown, never guessed.",
      parameters: {
        type: "object", additionalProperties: false, required: ["items"],
        properties: {
          items: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["exerciseVariantId", "workSets"], properties: { exerciseVariantId: { type: "string", minLength: 1, maxLength: 160 }, workSets: { type: "integer", minimum: 0, maximum: 40 }, effortIntent: { enum: ["low", "moderate", "high"] } } } },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation || !this.dependencies.planning) throw new Error("planning_unavailable");
        await this.assertCapability(conversation.userId, "planning");
        const items = (params as { items?: unknown }).items;
        if (!Array.isArray(items) || !items.length) throw new Error("estimate_items_invalid");
        const result = await this.dependencies.planning.estimateMuscleLoad({ userId: conversation.userId, items: items as never });
        await this.persistConversationCard(conversation, {
          id: `estimate-load:${stableHash({ conversationId, toolCallId })}`,
          title: "肌群负荷估算",
          summary: result.perMuscle.slice(0, 4).map((entry) => `${entry.muscleId} ${entry.role === "primary_intent" ? "主目标" : entry.role === "secondary_intent" ? "协同" : "稳定"} ${entry.relativeLoad}`),
          toolCallId,
          conversationCard: { kind: "receipt", status: "recorded", label: "已估算肌群负荷", detail: result.unknownExercises.length ? `未审校关联按未知处理：${result.unknownExercises.join("、")}` : `政策版本 ${result.policy.version}` },
        }, `conversation.estimate-load:${conversation.id}:${toolCallId}`);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: { source: "fixed_muscle_fatigue_policy", runId } };
      },
    };
  }

  /** Read-only recovery forecast tool: day-by-day residual walk. */
  private forecastRecoveryTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "plan.forecast_recovery",
      label: "推演恢复窗口",
      description: "Read-only. Walk confirmed history plus optional draft sessions forward and return per-day per-muscle residual load with recovery-window hints. Use it to check whether a draft session stacks load on a muscle that is still inside its group-mean window. All values are group-mean relative load, never individual recovery measurement.",
      parameters: {
        type: "object", additionalProperties: false, required: ["horizonDays"],
        properties: {
          horizonDays: { type: "integer", minimum: 1, maximum: 14 },
          draftSessions: { type: "array", maxItems: 7, items: { type: "object", additionalProperties: false, required: ["date", "items"], properties: { date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, items: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", additionalProperties: false, required: ["exerciseVariantId", "workSets"], properties: { exerciseVariantId: { type: "string", minLength: 1, maxLength: 160 }, workSets: { type: "integer", minimum: 0, maximum: 40 }, effortIntent: { enum: ["low", "moderate", "high"] } } } } } } },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation || !this.dependencies.planning) throw new Error("planning_unavailable");
        await this.assertCapability(conversation.userId, "planning");
        const value = params as { horizonDays?: unknown; draftSessions?: unknown };
        if (!Number.isInteger(value.horizonDays)) throw new Error("forecast_horizon_invalid");
        const result = await this.dependencies.planning.forecastRecovery({
          userId: conversation.userId,
          horizonDays: value.horizonDays as number,
          ...(Array.isArray(value.draftSessions) ? { draftSessions: value.draftSessions as never } : {}),
        });
        await this.persistConversationCard(conversation, {
          id: `forecast-recovery:${stableHash({ conversationId, toolCallId })}`,
          title: "恢复窗口推演",
          summary: result.start.status === "insufficient_history" ? ["没有足够的训练历史；先记录几次训练再推演。"] : result.days.flatMap((day) => day.windowHints).slice(0, 4),
          toolCallId,
          conversationCard: { kind: "receipt", status: "recorded", label: "已推演恢复窗口", detail: `政策版本 ${result.policy.version}（组均值，非个体测量）` },
        }, `conversation.forecast-recovery:${conversation.id}:${toolCallId}`);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: { source: "fixed_recovery_policy", runId } };
      },
    };
  }

  private bodyWeightTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "timeline.record_body_weight",
      label: "记录体重",
      description: "Record only a body weight the user explicitly stated in this conversation, in kilograms. Never infer or convert an unclear value.",
      parameters: { type: "object", additionalProperties: false, required: ["valueKg"], properties: { valueKg: { type: "number", minimum: 25, maximum: 400 } } },
      execute: async (toolCallId, params) => {
        const valueKg = typeof (params as { valueKg?: unknown }).valueKg === "number"
          ? (params as { valueKg: number }).valueKg
          : Number.NaN;
        if (!this.dependencies.records || !Number.isFinite(valueKg)) throw new Error("record_unavailable");
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation) throw new Error("conversation_not_found");
        await this.assertCapability(conversation.userId, "record");
        const occurredAt = this.dependencies.runtime.now();
        const record: ConversationExplicitRecord = { kind: "body_weight", userId: conversation.userId, valueKg, occurredAt, idempotencyKey: `conversation:${conversationId}:weight:${toolCallId}` };
        const staged = this.dependencies.records.recordExplicit
          ? await this.stageOrWriteRecord(conversation, record, toolCallId, runId)
          : (await this.dependencies.records.recordBodyWeight({ userId: conversation.userId, valueKg, occurredAt, idempotencyKey: record.idempotencyKey }), { status: "written" as const, message: `已记录体重 ${valueKg} kg。` });
        return {
          content: [{ type: "text", text: staged.message }],
          details: { source: "current_user_statement", record: "timeline.body_weight", runId },
        };
      },
    };
  }

  private async stageOrWriteRecord(conversation: CoachSession, record: ConversationExplicitRecord | ConversationExplicitCorrection, toolCallId: string, runId?: string): Promise<{ status: "written" | "awaiting_confirmation"; message: string }> {
    if (!this.dependencies.records || (record.kind !== "correction" && !this.dependencies.records.recordExplicit) || (record.kind === "correction" && !this.dependencies.records.correctExplicit)) {
      throw new Error(record.kind === "correction" ? "correction_unavailable" : "record_unavailable");
    }
    const snapshot = await this.dependencies.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId: conversation.userId });
    const mandate = domain.mandate?.value;
    const delegated = record.kind !== "correction"
      && mandate?.mode !== "manual"
      && mandate?.scopes?.recording === "delegated"
      && !(record.kind === "nutrition" && mandate.scopes?.nutrition === "advice_only")
      && (!mandate.validUntil || Date.parse(mandate.validUntil) >= Date.parse(this.dependencies.runtime.now()));
    if (!delegated) {
      const label = record.kind === "correction"
        ? "确认更正记录"
        : record.kind === "nutrition" ? "确认营养显式数值" : record.kind === "body_weight" ? "确认体重记录" : "确认这条记录";
      await this.persistConversationCard(conversation, {
        id: `record-confirm:${stableHash({ conversationId: conversation.id, toolCallId, record })}`,
        title: label, summary: ["这是一条由当前对话转录的事实。确认后才会进入正式 Timeline。"],
        toolCallId,
        conversationCard: { kind: "record_confirmation", status: "awaiting_confirmation", record, label },
      }, `conversation.record.stage:${conversation.id}:${toolCallId}`);
      return { status: "awaiting_confirmation", message: "我已把这条记录放在确认卡里；确认后才会写入。" };
    }
    const receipt = await this.dependencies.records.recordExplicit!(record);
    await this.persistConversationCard(conversation, {
      id: `record-receipt:${stableHash({ toolCallId, record })}`,
      title: "已写入正式记录", summary: [receipt.label],
      toolCallId,
      conversationCard: { kind: "receipt", status: "recorded", label: receipt.label, ...(receipt.detail ? { detail: receipt.detail } : {}), correctable: true },
    }, `conversation.record.receipt:${conversation.id}:${toolCallId}`);
    const materialSignal = runId ? this.signalAssessmentIds.get(runId) : undefined;
    return {
      status: "written",
      message: materialSignal
        ? `${receipt.label}已记录。固定检查发现这会影响当前路径；我会基于目标和正式依据继续复核。`
        : `${receipt.label}已记录。`,
    };
  }

  private explicitRecordTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "timeline.record_explicit",
      label: "记录明确事实",
      description: "Record only a clear fact the user explicitly stated in this conversation. For training, state completed, partial, or missed explicitly; include plannedSessionId only when the user is referring to a session visible in current fixed context. When the user says something got better (energy, sleep, daily function, mood), record it as wellness_note with their words in note and an optional dimension. Do not infer food nutrients from a food name or portion. When the user just describes a meal in words, record it with mealDescription and no nutrients (a descriptive note, never summed). Unknown fields stay unknown. Future intention is not a record.",
      parameters: {
        type: "object", additionalProperties: false, required: ["kind"], properties: {
          kind: { enum: ["body_weight", "body_fat", "activity", "training", "sleep", "recovery", "nutrition", "wellness_note"] },
          note: { type: "string", minLength: 1, maxLength: 240 },
          dimension: { enum: ["energy", "sleep", "function", "mood", "other"] },
          valueKg: { type: "number", minimum: 25, maximum: 400 },
          valuePercent: { type: "number", minimum: 1, maximum: 80 },
          activityType: { type: "string", minLength: 1, maxLength: 120 },
          summary: { type: "string", minLength: 1, maxLength: 240 },
          executionStatus: { enum: ["completed", "partial", "missed"] },
          plannedSessionId: { type: "string", minLength: 1, maxLength: 160 },
          durationMinutes: { type: "number", minimum: 0, maximum: 1440 },
          energyKcal: { type: "number", minimum: 0, maximum: 10000 },
          quality: { type: "integer", minimum: 1, maximum: 5 },
          perceivedRecovery: { type: "integer", minimum: 1, maximum: 5 },
          mealDescription: { type: "string", maxLength: 240 },
          dayCoverage: { enum: ["partial", "complete"] },
          nutrients: { type: "array", maxItems: 32, items: { type: "object", additionalProperties: false, required: ["nutrientId", "value", "unit", "source"], properties: { nutrientId: { type: "string", minLength: 1, maxLength: 64 }, value: { type: "number", minimum: 0, maximum: 100000 }, unit: { type: "string", minLength: 1, maxLength: 24 }, source: { enum: ["current_user_statement", "manually_transcribed_label"] } } } },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation || !this.dependencies.records?.recordExplicit) throw new Error("record_unavailable");
        await this.assertCapability(conversation.userId, "record");
        const record = explicitRecordFromToolParams(params, conversation.userId, this.dependencies.runtime.now(), `conversation:${conversationId}:record:${toolCallId}`);
        const result = await this.stageOrWriteRecord(conversation, record, toolCallId, runId);
        return { content: [{ type: "text", text: result.message }], details: { source: "explicit_user_statement", runId, status: result.status } };
      },
    };
  }

  private correctExplicitRecordTool(conversationId: string, runId: string): AgentTool<any> {
    return {
      name: "timeline.correct_explicit",
      label: "更正明确记录",
      description: "Correct one current Timeline event only after the user explicitly identifies what was wrong and gives its replacement value. targetEventId must come from current fixed context. Never correct a record from a guess. The correction is always shown in a confirmation card before admission.",
      parameters: {
        type: "object", additionalProperties: false, required: ["targetEventId", "reason", "replacement"], properties: {
          targetEventId: { type: "string", minLength: 1, maxLength: 200 },
          reason: { type: "string", minLength: 1, maxLength: 240 },
          replacement: { type: "object" },
        },
      },
      execute: async (toolCallId, params) => {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (!conversation || !this.dependencies.records?.correctExplicit) throw new Error("correction_unavailable");
        await this.assertCapability(conversation.userId, "record");
        const value = params as { targetEventId?: unknown; reason?: unknown; replacement?: unknown };
        if (typeof value.targetEventId !== "string" || !value.targetEventId.trim() || typeof value.reason !== "string" || !value.reason.trim() || !value.replacement || typeof value.replacement !== "object") {
          throw new Error("correction_input_invalid");
        }
        const replacement = explicitRecordFromToolParams(
          value.replacement,
          conversation.userId,
          this.dependencies.runtime.now(),
          `conversation:${conversationId}:correction:${toolCallId}:replacement`,
        );
        const correction: ConversationExplicitCorrection = {
          kind: "correction",
          userId: conversation.userId,
          correctsEventId: value.targetEventId.trim(),
          reason: value.reason.trim(),
          replacement,
          occurredAt: this.dependencies.runtime.now(),
          idempotencyKey: `conversation:${conversationId}:correction:${toolCallId}`,
        };
        const staged = await this.stageOrWriteRecord(conversation, correction, toolCallId, runId);
        return {
          content: [{ type: "text", text: staged.message }],
          details: { source: "explicit_user_correction", record: "timeline.correction", runId, status: staged.status },
        };
      },
    };
  }

  private async persistAgentEvent(conversationId: string, runId: string, event: AgentEvent): Promise<void> {
    if (event.type === "tool_execution_start") {
      await this.appendToolCall(conversationId, { id: event.toolCallId, runId, toolName: event.toolName, status: "input_available" });
      return;
    }
    if (event.type === "tool_execution_end") {
      await this.updateToolCall(conversationId, event.toolCallId, event.isError ? "output_error" : "output_available");
      return;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      const conversation = await this.findConversationForAnyUser(conversationId);
      if (!conversation) return;
      const previous = this.partialAssistantMessageIds.get(runId);
      const snapshot = await this.dependencies.ledger.read();
      const existing = previous ? snapshot.messages.find((message) => message.id === previous) : undefined;
      const content = `${existing?.content ?? ""}${event.assistantMessageEvent.delta}`;
      const message: CoachMessage = existing ?? {
        id: this.dependencies.runtime.nextId("message"), sessionId: conversationId, userId: conversation.userId,
        role: "assistant", runId, content: "", createdAt: this.dependencies.runtime.now(),
      };
      this.partialAssistantMessageIds.set(runId, message.id);
      await this.upsertAssistantMessage(conversation, { ...message, content }, `conversation.assistant.partial:${runId}:${stableHash(content)}`);
      return;
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      const content = event.message.content
        .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
        .map((part) => part.text).join("").trim();
      if (content) {
        const conversation = await this.findConversationForAnyUser(conversationId);
        if (conversation) {
          const partialId = this.partialAssistantMessageIds.get(runId);
          const snapshot = await this.dependencies.ledger.read();
          const existing = partialId ? snapshot.messages.find((message) => message.id === partialId) : undefined;
          await this.upsertAssistantMessage(conversation, existing
            ? { ...existing, content }
            : { id: this.dependencies.runtime.nextId("message"), sessionId: conversationId, userId: conversation.userId, role: "assistant", content, runId, createdAt: this.dependencies.runtime.now() }, `conversation.assistant.final:${runId}:${stableHash(content)}`);
          this.partialAssistantMessageIds.delete(runId);
        }
      }
      if (event.message.stopReason === "error") {
        await this.finishRun(conversationId, runId, "failed", event.message.errorMessage ?? "pi_agent_runtime_failure");
      } else if (event.message.stopReason === "aborted") {
        await this.finishRun(conversationId, runId, "interrupted", event.message.errorMessage ?? "pi_agent_aborted");
      }
      return;
    }
    if (event.type === "agent_end") {
      // A run that produced neither visible text nor any tool activity is
      // degenerate (e.g. a reasoning-model turn whose stream died after only
      // reasoning tokens). Never report it as completed: mark it retryable so
      // the user gets an honest recovery card instead of silence.
      const snapshot = await this.dependencies.ledger.read();
      const producedText = snapshot.messages.some((message) => message.runId === runId && message.role === "assistant" && message.content.trim().length > 0);
      const producedTool = snapshot.toolCalls.some((call) => call.runId === runId);
      if (!producedText && !producedTool) {
        await this.finishRun(conversationId, runId, "failed", "empty_provider_turn");
        return;
      }
      await this.finishRun(conversationId, runId, "completed");
    }
  }

  private async appendMessageAndRun(conversation: CoachSession, message: CoachMessage, run: CoachRunRecord, attachment?: ContextRef): Promise<void> {
    const now = this.dependencies.runtime.now();
    // A page can attach itself to one turn as optional context. Attachments
    // accumulate on the session but never become its identity.
    const contextRefs = attachment
      ? [...(conversation.contextRefs ?? []).filter((ref) => !(ref.kind === attachment.kind && ref.ref === attachment.ref)), attachment].slice(-8)
      : (conversation.contextRefs ?? []);
    const updated = {
      ...conversation,
      ...(conversation.title === NEW_CONVERSATION_TITLE ? { title: message.content.slice(0, 48) } : {}),
      revision: (conversation.revision ?? 1) + 1,
      contextRefs,
      messageIds: [...(conversation.messageIds ?? []), message.id],
      runIds: [...(conversation.runIds ?? []), run.id],
      updatedAt: now,
    };
    await this.dependencies.ledger.commit({ kind: "domain", userId: conversation.userId, actorId: conversation.userId, intent: "conversation.send", expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [], sessions: [updated], messages: [message], runs: [run], idempotencyKey: `conversation.send:${run.clientTurnId}`, recordedAt: now });
  }

  private async appendRun(conversation: CoachSession, run: CoachRunRecord): Promise<void> {
    const now = this.dependencies.runtime.now();
    const updated = { ...conversation, revision: (conversation.revision ?? 1) + 1, runIds: [...(conversation.runIds ?? []), run.id], updatedAt: now };
    await this.dependencies.ledger.commit({
      kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.signal.start",
      expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [], sessions: [updated], runs: [run],
      idempotencyKey: `conversation.signal.run:${run.id}`, recordedAt: now,
    });
  }

  private async appendMessage(conversationId: string, message: CoachMessage, idempotencyKey: string): Promise<void> {
    const conversation = await this.findConversationForAnyUser(conversationId);
    if (!conversation) return;
    const updated = { ...conversation, revision: (conversation.revision ?? 1) + 1, messageIds: [...(conversation.messageIds ?? []), message.id], updatedAt: this.dependencies.runtime.now() };
    await this.dependencies.ledger.commit({ kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.message", expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [], sessions: [updated], messages: [message], idempotencyKey, recordedAt: this.dependencies.runtime.now() });
  }

  private async upsertAssistantMessage(conversation: CoachSession, message: CoachMessage, idempotencyKey: string): Promise<void> {
    const snapshot = await this.dependencies.ledger.read();
    const exists = snapshot.messages.some((candidate) => candidate.id === message.id);
    const now = this.dependencies.runtime.now();
    const updated = exists
      ? conversation
      : { ...conversation, revision: (conversation.revision ?? 1) + 1, messageIds: [...(conversation.messageIds ?? []), message.id], updatedAt: now };
    await this.dependencies.ledger.commit({
      kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.assistant_text",
      expectedRevisions: [], expectedSessionRevisions: exists ? [] : [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [],
      ...(exists ? {} : { sessions: [updated] }), messages: [message], idempotencyKey, recordedAt: now,
    });
  }

  private async appendToolCall(conversationId: string, input: { id: string; runId: string; toolName: string; status: CoachToolCallRecord["status"] }): Promise<void> {
    const conversation = await this.findConversationForAnyUser(conversationId);
    if (!conversation) return;
    const now = this.dependencies.runtime.now();
    const call: CoachToolCallRecord = { id: input.id, sessionId: conversationId, runId: input.runId, userId: conversation.userId, toolName: input.toolName, inputSchemaVersion: 1, inputHash: "pi-managed", status: input.status, startedAt: now, updatedAt: now };
    const updated = { ...conversation, revision: (conversation.revision ?? 1) + 1, toolCallIds: [...(conversation.toolCallIds ?? []), call.id], updatedAt: now };
    await this.dependencies.ledger.commit({ kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.tool.start", expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [], sessions: [updated], toolCalls: [call], idempotencyKey: `conversation.tool.start:${input.runId}:${call.id}`, recordedAt: now });
  }

  private async updateToolCall(conversationId: string, toolCallId: string, status: CoachToolCallRecord["status"]): Promise<void> {
    const snapshot = await this.dependencies.ledger.read();
    const call = snapshot.toolCalls.find((candidate) => candidate.id === toolCallId && candidate.sessionId === conversationId);
    const conversation = snapshot.sessions.find((candidate) => candidate.id === conversationId);
    if (!call || !conversation) return;
    const now = this.dependencies.runtime.now();
    await this.dependencies.ledger.commit({ kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.tool.finish", expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [], sessions: [{ ...conversation, revision: (conversation.revision ?? 1) + 1, updatedAt: now }], toolCalls: [{ ...call, status, updatedAt: now }], idempotencyKey: `conversation.tool.finish:${call.runId}:${call.id}:${status}`, recordedAt: now });
  }

  private async finishRun(conversationId: string, runId: string, status: Extract<CoachRunRecord["status"], "completed" | "interrupted" | "failed">, terminalCode?: string): Promise<void> {
    const snapshot = await this.dependencies.ledger.read();
    const run = snapshot.runs.find((candidate) => candidate.id === runId && candidate.sessionId === conversationId);
    const conversation = snapshot.sessions.find((candidate) => candidate.id === conversationId);
    if (!run || !conversation) return;
    if (["completed", "interrupted", "failed"].includes(run.status)) return;
    const now = this.dependencies.runtime.now();
    await this.dependencies.ledger.commit({ kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.run.finish", expectedRevisions: [], expectedSessionRevisions: [{ id: conversation.id, revision: conversation.revision ?? 1 }], domainEvents: [], sessions: [{ ...conversation, revision: (conversation.revision ?? 1) + 1, updatedAt: now }], runs: [{ ...run, status, ...(terminalCode ? { terminalCode } : {}), updatedAt: now }], idempotencyKey: `conversation.run.finish:${runId}:${status}`, recordedAt: now });
    if (status === "completed") await this.compactLongConversation(conversation.id, runId);
    if (status !== "completed") {
      const recovery = runRecoveryCopy(status, terminalCode);
      await this.persistConversationCard(conversation, {
        id: `run-recovery:${runId}`,
        title: recovery.title,
        summary: [recovery.detail],
        conversationCard: { kind: "receipt", status: "rejected", label: recovery.title, detail: recovery.detail },
      }, `conversation.run.recovery:${runId}:${status}`);
    }
    this.signalAssessmentIds.delete(runId);
    this.toolCallsByRun.delete(runId);
  }

  /**
   * Keep Pi's live context bounded without treating an opaque model summary as
   * user fact.  The saved text is deliberately a deterministic index of the
   * task, settled cards, pending actions and recent user asks; the actual
   * Timeline/Profile/Plan are re-read as authoritative facts for every run.
   */
  private async compactLongConversation(conversationId: string, runId: string): Promise<void> {
    if (!this.dependencies.memory) return;
    const snapshot = await this.dependencies.ledger.read();
    const conversation = snapshot.sessions.find((session) => session.id === conversationId && session.context.kind === "conversation");
    if (!conversation) return;
    const messages = snapshot.messages
      .filter((message) => message.sessionId === conversation.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    if (messages.length <= 64) return;
    const cards = snapshot.artifacts
      .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief"
        && artifact.userId === conversation.userId
        && artifact.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === conversation.id)
        && Boolean(artifact.conversationCard))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const settled = cards
      .filter((artifact) => artifact.conversationCard?.status !== "ready" && artifact.conversationCard?.status !== "awaiting_confirmation")
      .slice(-8)
      .map((artifact) => `${artifact.title}: ${artifact.summary.join("；").slice(0, 320)}`);
    const pending = cards
      .filter((artifact) => artifact.conversationCard?.status === "ready" || artifact.conversationCard?.status === "awaiting_confirmation")
      .slice(-8)
      .map((artifact) => artifact.title);
    const recentUserRequests = messages
      .filter((message) => message.role === "user")
      .slice(-12)
      .map((message) => message.content.replace(/\s+/g, " ").slice(0, 240));
    const content = [
      `Conversation: ${conversation.title}`,
      settled.length ? `Settled cards: ${settled.join(" | ")}` : "Settled cards: none",
      pending.length ? `Pending cards: ${pending.join(" | ")}` : "Pending cards: none",
      recentUserRequests.length ? `Recent user requests: ${recentUserRequests.join(" | ")}` : "Recent user requests: none",
      "Authority: this is recovery memory only; re-read confirmed local facts before acting.",
    ].join("\n");
    try {
      await this.dependencies.memory.upsertConversationSummary({
        userId: conversation.userId,
        conversationId: conversation.id,
        runId,
        content,
        idempotencyKey: `conversation.summary:${conversation.id}:${runId}`,
      });
    } catch {
      // Summary compaction is a recoverability enhancement.  A rejected or
      // stale non-authoritative memory write must never falsify a finished run.
    }
  }

  private async persistConversationCard(
    conversation: CoachSession,
    input: Pick<EvidenceBriefArtifact, "id" | "title" | "summary"> & {
      conversationCard: NonNullable<EvidenceBriefArtifact["conversationCard"]>;
      toolCallId?: string;
      evidenceRefs?: readonly import("../coach/model").FactRef[];
    },
    idempotencyKey: string,
  ): Promise<EvidenceBriefArtifact> {
    const now = this.dependencies.runtime.now();
    const existing = (await this.dependencies.ledger.read()).artifacts.find((artifact): artifact is EvidenceBriefArtifact => artifact.id === input.id
      && artifact.kind === "evidence_brief" && artifact.userId === conversation.userId);
    const active = this.active.get(conversation.id);
    const artifact: EvidenceBriefArtifact = {
      id: input.id,
      kind: "evidence_brief",
      userId: conversation.userId,
      schemaVersion: 1,
      renderVersion: 1,
      // A card is a stable conversation item.  Resolution changes its state
      // in place; it must not jump to the bottom of a recovered transcript.
      createdAt: existing?.createdAt ?? now,
      contextRefs: [{ kind: "conversation", ref: conversation.id }],
      evidenceRefs: input.evidenceRefs ?? [],
      missingness: [],
      capabilityBoundary: ["conversation_card_is_local_and_user_owned", "no_navigation_command"],
      hash: stableHash(input),
      title: input.title,
      summary: input.summary,
      conversationTrace: existing?.conversationTrace ?? {
        sessionId: conversation.id,
        ...(active ? { runId: active.runId } : {}),
        ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
      },
      conversationCard: input.conversationCard,
    };
    await this.dependencies.ledger.commit({
      kind: "domain", userId: conversation.userId, actorId: "pi_conversation", intent: "conversation.card",
      expectedRevisions: [], expectedSessionRevisions: [], domainEvents: [], artifacts: [artifact],
      presentations: [{
        id: `presentation:${artifact.id}`,
        artifactId: artifact.id,
        renderer: "conversation-card/1",
        status: presentationStatusForConversationCard(input.conversationCard),
      }],
      idempotencyKey, recordedAt: now,
    });
    return artifact;
  }

  private async defaultContext(userId: string, activeConversationId?: string): Promise<Readonly<Record<string, unknown>>> {
    const snapshot = await this.dependencies.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId });
    const latestMemory = snapshot.workingMemory
      .filter((item) => item.userId === userId && !item.deletedAt && !item.supersededBy)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 8)
      .map((item) => ({ id: item.id, text: item.content, provenance: item.provenance }));
    const activeText = activeConversationId
      ? snapshot.messages
        .filter((message) => message.sessionId === activeConversationId && message.role === "user")
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 4)
        .map((message) => message.content)
        .join(" ")
      : "";
    const relatedConversations = snapshot.sessions
      .filter((session) => session.userId === userId && session.context.kind === "conversation" && session.id !== activeConversationId)
      .map((session) => {
        const recentMessages = snapshot.messages
          .filter((message) => message.sessionId === session.id)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 4)
          .reverse()
          .map((message) => ({ role: message.role, text: message.content.slice(0, 360), createdAt: message.createdAt }));
        const settledCards = snapshot.artifacts
          .filter((artifact): artifact is EvidenceBriefArtifact => artifact.kind === "evidence_brief"
            && artifact.userId === userId
            && artifact.contextRefs.some((ref) => ref.kind === "conversation" && ref.ref === session.id)
            && Boolean(artifact.conversationCard))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, 4)
          .map((artifact) => ({
            id: artifact.id,
            title: artifact.title,
            status: artifact.conversationCard?.status,
            summary: artifact.summary.slice(0, 3),
            ...(artifact.conversationCard?.kind === "baseline" && artifact.conversationCard.submitted
              ? { submittedBaseline: artifact.conversationCard.submitted }
              : {}),
            ...(artifact.conversationCard?.kind === "goal_path" && artifact.conversationCard.status === "confirmed"
              ? { confirmedGoalPath: { goal: artifact.conversationCard.goal, options: artifact.conversationCard.options } }
              : {}),
          }));
        const searchableText = [session.title ?? "", ...recentMessages.map((message) => message.text), ...settledCards.flatMap((card) => [card.title, ...card.summary])].join(" ");
        return {
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          recentMessages,
          settledCards,
          relevance: conversationRelevance(activeText, searchableText),
        };
      })
      .filter((session) => session.relevance > 0)
      .sort((left, right) => right.relevance - left.relevance || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 4)
      .map(({ relevance: _relevance, ...session }) => session);
    const intakeAnswers: Record<string, string> = {};
    for (const artifact of snapshot.artifacts
      .filter((candidate): candidate is EvidenceBriefArtifact => candidate.kind === "evidence_brief"
        && candidate.userId === userId
        && candidate.conversationCard?.kind === "intake_form"
        && candidate.conversationCard.status === "submitted"
        && Boolean(candidate.conversationCard.values))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
      Object.assign(intakeAnswers, artifact.conversationCard?.kind === "intake_form" ? artifact.conversationCard.values : {});
    }
    return {
      profile: domain.profile?.value ?? null,
      goal: domain.goalContract?.value ?? null,
      activePlan: domain.planStatus === "current" ? domain.plan?.value ?? null : null,
      safetyConstraints: domain.safetyConstraints.map((constraint) => constraint.value),
      timeline: domain.timeline.current.slice(-20),
      intakeAnswers,
      pendingActions: snapshot.pendingHumanActions
        .filter((action) => action.userId === userId && action.status === "pending")
        .map((action) => ({ id: action.id, kind: action.kind, prompt: action.prompt, expiresAt: action.expiresAt })),
      workingMemory: latestMemory,
      relatedConversations,
      authorityOrder: ["confirmed_domain_facts", "current_conversation_user_statement", "working_memory", "older_conversations"],
    };
  }

  private async availableCapabilities(userId: string): Promise<Record<ConversationCapability, boolean>> {
    if (this.dependencies.capabilities) {
      const [goal, planning, record] = await Promise.all([
        this.dependencies.capabilities.allowed({ userId, capability: "goal" }),
        this.dependencies.capabilities.allowed({ userId, capability: "planning" }),
        this.dependencies.capabilities.allowed({ userId, capability: "record" }),
      ]);
      return { goal, planning, record };
    }
    const snapshot = await this.dependencies.ledger.read();
    const domain = projectDomainEvents(snapshot.domainEvents, { userId });
    const hasProfile = Boolean(domain.profile?.value);
    const hasMandate = Boolean(domain.mandate?.value);
    const hasSafetyHold = domain.safetyConstraints.some((constraint) => constraint.value.disposition !== "clear");
    const hasPendingPlanAction = snapshot.pendingHumanActions.some((action) => action.userId === userId && action.status === "pending" && action.risk !== "low");
    return {
      goal: hasProfile,
      planning: hasProfile && hasMandate && Boolean(domain.goalContract?.value) && !hasSafetyHold && !hasPendingPlanAction,
      record: hasProfile && hasMandate,
    };
  }

  private async assertCapability(userId: string, capability: ConversationCapability): Promise<void> {
    if (!(await this.availableCapabilities(userId))[capability]) throw new Error(`conversation_capability_unavailable:${capability}`);
  }

  private async findConversation(userId: string, conversationId: string): Promise<CoachSession | undefined> {
    const snapshot = await this.dependencies.ledger.read();
    return snapshot.sessions.find((session) => session.id === conversationId && session.userId === userId && session.context.kind === "conversation");
  }

  private async findConversationForAnyUser(conversationId: string): Promise<CoachSession | undefined> {
    const snapshot = await this.dependencies.ledger.read();
    return snapshot.sessions.find((session) => session.id === conversationId && session.context.kind === "conversation");
  }
}

/** The user's latest unsubmitted baseline draft, by draft revision. */
function latestBaselineDraft(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  userId: string,
): { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string; revision: number } | undefined {
  let latest: { ageYears?: string; heightCm?: string; weightKg?: string; goalText?: string; revision: number } | undefined;
  for (const artifact of snapshot.artifacts) {
    if (artifact.kind !== "evidence_brief" || artifact.userId !== userId) continue;
    const card = artifact.conversationCard;
    if (card?.kind !== "baseline" || card.status !== "ready" || !card.draft) continue;
    if (!latest || card.draft.revision > latest.revision) latest = card.draft;
  }
  return latest;
}

function toolItemState(status: CoachToolCallRecord["status"]): ConversationItem["state"] {
  if (status === "input_available" || status === "suspended") return "working";
  return status === "output_available" ? "completed" : "failed";
}

function cardItemKind(card: Exclude<EvidenceBriefArtifact["conversationCard"], undefined>): ConversationItem["kind"] {
  if (card.kind === "baseline") return "form";
  if (card.kind === "intake_form") return "form";
  if (card.kind === "choice") return "choice";
  if (card.kind === "goal_path") return "goal_path";
  if (card.kind === "plan_candidate") return "receipt";
  if (card.kind === "record_confirmation") return "receipt";
  return "receipt";
}

function cardItemState(card: Exclude<EvidenceBriefArtifact["conversationCard"], undefined>): ConversationItem["state"] {
  if (card.kind === "goal_path") return card.status === "stale" ? "failed" : card.status === "awaiting_confirmation" ? "ready" : "completed";
  if (card.kind === "choice") return card.status === "stale" ? "failed" : card.status === "ready" ? "ready" : "completed";
  if (card.kind === "baseline") return card.status === "ready" ? "ready" : "completed";
  if (card.kind === "intake_form") return card.status === "ready" ? "ready" : card.status === "submitted" ? "completed" : "failed";
  if (card.kind === "plan_candidate") return card.status === "awaiting_confirmation" ? "ready" : card.status === "confirmed" ? "completed" : "failed";
  if (card.kind === "record_confirmation") return card.status === "awaiting_confirmation" ? "ready" : card.status === "confirmed" ? "completed" : "failed";
  return card.status === "rejected" ? "failed" : "completed";
}

/** Presentations carry invalidation from the factual boundary. Keep that state
 * visible on the original durable card instead of leaving an actionable-looking
 * proposal in a recovered conversation. */
function effectiveConversationCard(
  card: Exclude<EvidenceBriefArtifact["conversationCard"], undefined>,
  presentation: import("../coach/model").PresentationRef | undefined,
): Exclude<EvidenceBriefArtifact["conversationCard"], undefined> {
  if (presentation?.status !== "stale") return card;
  if (card.kind === "goal_path" || card.kind === "record_confirmation" || card.kind === "plan_candidate" || card.kind === "baseline" || card.kind === "choice" || card.kind === "intake_form") {
    return { ...card, status: "stale" };
  }
  return card;
}

function presentationStatusForConversationCard(
  card: Exclude<EvidenceBriefArtifact["conversationCard"], undefined>,
): import("../coach/model").PresentationStatus {
  if (card.status === "ready" || card.status === "awaiting_confirmation") return "awaiting_user";
  if (card.status === "stale") return "stale";
  // A validation failure is not staleness: the facts did not change, the
  // candidate did. It renders as an invalid card with its issues, not as an
  // expired proposal.
  if (card.status === "invalid") return "error";
  if (card.status === "rejected") return "rejected";
  if (card.status === "confirmed" || card.status === "recorded" || card.status === "resolved" || card.status === "submitted") return "applied";
  return "ready";
}

function runRecoveryCopy(
  status: Extract<CoachRunRecord["status"], "interrupted" | "failed">,
  terminalCode: string | undefined,
): { title: string; detail: string } {
  if (terminalCode === "user_terminated") {
    return { title: "本轮已停止", detail: "已经完成的读取或写入仍保留。你可以直接发送下一条消息继续。" };
  }
  if (terminalCode === "interrupted_after_restart" || terminalCode === "app_disposed") {
    return { title: "本轮在关闭应用后中断", detail: "已保存的消息、卡片和回执都还在。请直接说明要继续的部分。" };
  }
  return {
    title: status === "failed" ? "本轮未能完成" : "本轮已中断",
    detail: "没有提交尚未开始的动作。请直接重试，或补充一条更具体的信息。",
  };
}

/** Everyday conversation: no intake or planning framing. */
const GENERAL_SCENARIO_PROMPT = [
  "Everyday mode: help the user record facts, answer questions, and adjust the current plan through the typed tools. No intake framing and no planning obligations beyond what the user asks for.",
].join("\n");

/**
 * Intake mode: the grilling-style driver. Only the baseline facts and the
 * user's own goal wording are fixed; the Agent must dig at the goal, ground
 * each question in installed knowledge, and collect structured detail through
 * small all-optional dynamic forms.
 */
const INTAKE_SCENARIO_PROMPT = [
  "Intake mode (authoritative for this run): the confirmed baseline and the user's own goal wording are the only fixed inputs; everything else is yours to drive.",
  "- Interrogate the goal like a good coach: what outcome, by when, at what cost. Ask one focused question at a time and say briefly why it matters.",
  "- Before asking, search installed knowledge (knowledge.search_installed) for what actually matters for this kind of goal, and ground your questions in it. If installed knowledge has nothing, say the question is general practice.",
  "- When several structured answers would move the decision, compose ONE small form with intake.request_form using only registry fields that are still unknown. Every field is optional; accept partial answers and never press for an answer the user does not have.",
  "- Never re-ask what is confirmed or already answered in an intake form. Unknown stays unknown; it only blocks decisions that truly depend on it.",
  "- Converge promptly: when goal, time frame and acceptable cost are clear enough, use goal.propose_path; if the user has no goal or declines one, offer record-only. Intake is not a questionnaire.",
].join("\n");

/** Planning mode: candidates are grounded in the injected fixed facts pack. */
const PLANNING_SCENARIO_PROMPT = [
  "Planning mode (authoritative for this run): organize or adjust the current stage only from the injected fixed facts pack and plan.read_fixed_input.",
  "- The facts pack is already loaded and authoritative: recent intake, training outcomes, body trends, recovery, baseline facts, the current plan and the source assessment. Never guess energy, dose, recovery or safety values.",
  "- Submit exactly one candidate via plan.propose_current_stage and explain the trade-offs in plain language. If the pack reports insufficient facts, name what is missing and stop instead of proposing.",
].join("\n");

/** A small local ranking rule keeps new threads clear without outsourcing private history search. */
function conversationRelevance(query: string, candidate: string): number {  const queryTerms = new Set(conversationTerms(query));
  if (!queryTerms.size) return 0;
  const candidateTerms = new Set(conversationTerms(candidate));
  let shared = 0;
  for (const term of queryTerms) if (candidateTerms.has(term)) shared += 1;
  return shared;
}

function conversationTerms(text: string): readonly string[] {
  const normalized = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, " ");
  const latin = normalized.match(/[a-z0-9]{2,}/g) ?? [];
  const han = [...normalized.matchAll(/[\u3400-\u9fff]{2,}/g)]
    .flatMap(([run]) => Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)));
  return [...latin, ...han];
}

function goalDraftFromToolParams(params: unknown, userId: string, now: string): GoalContractData {
  const value = params as {
    primaryGoal?: GoalContractData["primaryGoal"];
    targetWeeks?: number;
    targetWeightKg?: number;
    acceptableCosts?: unknown;
  };
  if (!value || !["hypertrophy", "strength", "fat_loss_preserve_lean_mass", "physique", "maintain", "return_to_training"].includes(value.primaryGoal ?? "")
    || !Number.isInteger(value.targetWeeks) || value.targetWeeks! < 1 || value.targetWeeks! > 260) {
    throw new Error("goal_path_input_invalid");
  }
  const targetWeightKg = typeof value.targetWeightKg === "number" && Number.isFinite(value.targetWeightKg)
    ? value.targetWeightKg
    : undefined;
  const acceptableCosts = Array.isArray(value.acceptableCosts)
    ? value.acceptableCosts.filter((item): item is string => typeof item === "string").slice(0, 8)
    : [];
  const today = now.slice(0, 10);
  return {
    id: `goal:${userId}:${stableHash({ primaryGoal: value.primaryGoal, targetWeeks: value.targetWeeks, targetWeightKg, acceptableCosts })}`,
    primaryGoal: value.primaryGoal!,
    horizon: { startDate: today },
    targetWeeks: value.targetWeeks,
    ...(targetWeightKg ? { targets: { targetWeight: { value: targetWeightKg, unit: "kg" as const } } } : {}),
    ...(acceptableCosts.length ? { acceptableCosts } : {}),
    status: "draft",
  };
}

function explicitRecordFromToolParams(params: unknown, userId: string, occurredAt: string, idempotencyKey: string): ConversationExplicitRecord {
  const value = params as Record<string, unknown>;
  const kind = value?.kind;
  const number = (key: string) => typeof value[key] === "number" && Number.isFinite(value[key]) ? value[key] as number : undefined;
  if (kind === "body_weight") {
    const valueKg = number("valueKg");
    if (valueKg === undefined || valueKg < 25 || valueKg > 400) throw new Error("body_weight_value_required");
    return { kind, userId, valueKg, occurredAt, idempotencyKey };
  }
  if (kind === "body_fat") {
    const valuePercent = number("valuePercent");
    if (valuePercent === undefined || valuePercent < 1 || valuePercent > 80) throw new Error("body_fat_value_required");
    return { kind, userId, valuePercent, occurredAt, idempotencyKey };
  }
  if (kind === "activity") {
    if (typeof value.activityType !== "string" || !value.activityType.trim()) throw new Error("activity_type_required");
    return { kind, userId, activityType: value.activityType.trim(), ...(number("durationMinutes") !== undefined ? { durationMinutes: number("durationMinutes") } : {}), ...(number("energyKcal") !== undefined ? { energyKcal: number("energyKcal") } : {}), occurredAt, idempotencyKey };
  }
  if (kind === "training") {
    if (typeof value.summary !== "string" || !value.summary.trim()) throw new Error("training_summary_required");
    if (value.executionStatus !== "completed" && value.executionStatus !== "partial" && value.executionStatus !== "missed") {
      throw new Error("training_execution_status_required");
    }
    return {
      kind,
      userId,
      executionStatus: value.executionStatus,
      summary: value.summary.trim(),
      ...(typeof value.plannedSessionId === "string" && value.plannedSessionId.trim() ? { plannedSessionId: value.plannedSessionId.trim() } : {}),
      ...(number("durationMinutes") !== undefined ? { durationMinutes: number("durationMinutes") } : {}),
      occurredAt,
      idempotencyKey,
    };
  }
  if (kind === "sleep") return { kind, userId, ...(number("durationMinutes") !== undefined ? { durationMinutes: number("durationMinutes") } : {}), ...(number("quality") !== undefined ? { quality: number("quality") } : {}), occurredAt, idempotencyKey };
  if (kind === "wellness_note") {
    if (typeof value.note !== "string" || !value.note.trim()) throw new Error("wellness_note_required");
    const dimension = typeof value.dimension === "string" ? value.dimension : undefined;
    if (dimension !== undefined && !["energy", "sleep", "function", "mood", "other"].includes(dimension)) throw new Error("wellness_dimension_unknown");
    return { kind, userId, note: value.note.trim(), ...(dimension ? { dimension: dimension as WellnessDimension } : {}), occurredAt, idempotencyKey };
  }
  if (kind === "recovery") return { kind, userId, ...(number("perceivedRecovery") !== undefined ? { perceivedRecovery: number("perceivedRecovery") } : {}), occurredAt, idempotencyKey };
  if (kind === "nutrition") {
    const nutrients = Array.isArray(value.nutrients) ? value.nutrients.flatMap((item) => {
      const nutrient = item as Record<string, unknown>;
      return typeof nutrient.nutrientId === "string" && typeof nutrient.value === "number" && Number.isFinite(nutrient.value)
        && typeof nutrient.unit === "string" && (nutrient.source === "current_user_statement" || nutrient.source === "manually_transcribed_label")
        ? [{ nutrientId: nutrient.nutrientId, value: nutrient.value, unit: nutrient.unit, source: nutrient.source as "current_user_statement" | "manually_transcribed_label" }]
        : [];
    }) : [];
    // 行为级/量级级精度下，一句话描述（无数值）是合法记录——描述性观察，不产出任何营养素数值。
    if (!nutrients.length && !(typeof value.mealDescription === "string" && value.mealDescription.trim())) throw new Error("explicit_nutrients_required");
    return { kind, userId, nutrients, ...(typeof value.mealDescription === "string" && value.mealDescription.trim() ? { mealDescription: value.mealDescription.trim() } : {}), ...(value.dayCoverage === "partial" || value.dayCoverage === "complete" ? { dayCoverage: value.dayCoverage } : {}), occurredAt, idempotencyKey };
  }
  throw new Error("record_kind_invalid");
}

/** A fresh conversation's placeholder title until its first user message. */
const NEW_CONVERSATION_TITLE = "新对话";
