import type { LedgerSnapshot } from "../model";
import { projectDomainEvents } from "../domain";
import { stableHash } from "../stable";
import { redactDirectIdentifiers } from "../remoteRedaction";
import { AGENT_SOUL } from "../agentSoul";
import { COACH_PLAYBOOK } from "../playbook";
import type { CoachToolManifest } from "../toolRegistry";
import { openAiCompatibleToolName } from "./openAiToolName";
import { projectOnboardingProgress } from "../../onboarding/OnboardingService";
import { goalDrivenOnboardingFrontier } from "../../onboarding/FieldCatalog";

export type ProviderEvent =
  | { type: "text-delta"; delta: string }
  /**
   * Raw provider arguments are deliberately opaque to the UI.  The runtime
   * turns this into a generic loading state and waits for the complete,
   * schema-validated tool-call before invoking anything.
   */
  | { type: "tool-input-delta"; toolCallId: string; toolName: string; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "cancelled"; reason?: "user" | "timeout" | "transport" }
  | { type: "completed" };

export interface ProviderContext {
  userPseudonym: string;
  profile: Record<string, unknown>;
  plan: Record<string, unknown>;
  timeline: Array<{
    id: string;
    occurredAt: string;
    kind: string;
    source: string;
    status: string;
    data: Record<string, unknown>;
  }>;
  workingMemory: Array<Record<string, unknown>>;
  activeConstraints: Array<Record<string, unknown>>;
  /** Versioned local strategy refs; the Provider never receives a write capability. */
  nutritionStrategies: Array<{ id: string; revision: number; value: Record<string, unknown> }>;
  goalCycles: Array<{ id: string; revision: number; value: Record<string, unknown> }>;
  canonicalEvidence: Array<Record<string, unknown>>;
  historicalSummaries: Array<Record<string, unknown>>;
  currentConversation: Array<Record<string, unknown>>;
  /** 窗口外对话按 run 分组的摘要；窗口内无内容时为空数组。 */
  conversationSummaries: Array<Record<string, unknown>>;
  /** Only present for a draft-scoped onboarding Coach session. Still a draft, never Profile truth. */
  onboardingDraft?: Record<string, unknown>;
}

export interface ContextManifest {
  schemaVersion: 1;
  userPseudonym: string;
  /** Provider implementation selected for this one request, not an account identifier. */
  providerKind: string;
  /** Optional user-selected model label; credentials and endpoint never enter the manifest. */
  providerModel?: string;
  /** Closed product purpose, derived from the task-scoped CoachSession. */
  requestPurpose: string;
  assembledAt: string;
  factRefs: readonly string[];
  redactedPaths: readonly string[];
  includes: readonly string[];
  priority: readonly ["authoritative_facts", "active_constraints", "working_memory", "conversation"];
  productionCompression: "none" | "fact_ref_hierarchical";
  retrievalFactRefs: readonly string[];
  summaryRefs: readonly string[];
  timeRange: { earliest?: string; latest?: string };
  /** Raw media is absent unless a separate, consented task explicitly adds it. */
  mediaAttachments: readonly { ref: string; purpose: string; consentRef: string }[];
  redactionPolicyVersion: "direct-identifiers-v1";
  /** Present only when a permission aggregate records the currently active grant. */
  remoteLlmConsentRef?: string;
  /** 场景 playbook 版本（ticket 06）：对话准则钉入 manifest，可追溯到当次生效版本。 */
  playbookVersion?: string;
  /** Stable interaction Soul assembled locally for this request. */
  agentSoulVersion?: string;
  /** 上下文预算与降级记录（ticket 04）；未触发降级时 conversation 为 verbatim。 */
  contextBudget?: {
    maxTokens: number;
    estimatedTokens: number;
    conversation: "verbatim" | "run_summary_window" | "summarized";
    droppedSections: readonly string[];
  };
}

export interface LLMProviderRequest {
  sessionId: string;
  runId: string;
  userText: string;
  context: ProviderContext;
  contextManifest: ContextManifest;
  /** Provider receives descriptions only; all execution stays in LocalCoachHarness. */
  toolManifest: readonly CoachToolManifest[];
  /**
   * Fully assembled by the local Agent Harness. Remote providers only serialize
   * this input to their LLM API; they must not append their own Coach context.
   */
  modelInput?: LLMModelInput;
  /**
   * Ephemeral local lifecycle control.  It is never persisted, sent as
   * semantic context, or exposed to an Agent tool.
   */
  signal?: AbortSignal;
}

/** Transport-neutral LLM input owned by the local Harness. */
export interface LLMModelInput {
  systemPrompt: string;
  userContent: string;
}

/**
 * The only tool output that is returned to the language layer. It is an
 * immutable local artifact reference, never a raw database record or a
 * provider-authored success claim.
 */
export interface ArtifactToolResult {
  kind: "artifact_ref";
  artifactRef: {
    id: string;
    kind: string;
    schemaVersion: number;
    hash: string;
  };
  presentation: {
    id: string;
    artifactId: string;
    renderer: string;
    status: string;
  };
}

export type LLMProviderContinuation =
  | {
      /** A human action is resumed from its durable pending-action record. */
      pendingActionId: string;
      toolCallId: string;
      output: Readonly<Record<string, unknown>>;
    }
  | {
      /** A local tool completed during this same Agent run. */
      toolCallId: string;
      toolName: string;
      output: ArtifactToolResult;
    };

export interface LLMProviderResumeRequest extends LLMProviderRequest {
  continuation: LLMProviderContinuation;
}

export interface LLMProvider {
  readonly kind: string;
  readonly usesNetwork: boolean;
  /** A display-only model label, never a secret or an external account identifier. */
  readonly model?: string;
  /** Stable only for one provider configuration; binds a resumable run to that configuration. */
  readonly configurationFingerprint?: string;
  stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent>;
  resume?(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent>;
}

export type ProviderServiceErrorCode =
  | "allowance_exhausted"
  | "authentication_required"
  | "permission_denied"
  | "service_unavailable"
  | "request_conflict"
  | "request_failed"
  | "account_switched"
  | "consent_required";

/**
 * Stable failure vocabulary for a first-party remote language service. Wire,
 * vendor and SDK errors stay behind the provider adapter.
 */
export class ProviderServiceError extends Error {
  constructor(readonly code: ProviderServiceErrorCode) {
    super(`provider_service_${code}`);
    this.name = "ProviderServiceError";
  }
}

/** Selects the language layer locally for an already-authorized local user. */
export interface LLMProviderResolver {
  resolve(input: {
    userId: string;
    sessionId: string;
    /** A continuation must not silently switch endpoint or model. */
    prior?: { kind: string; configurationFingerprint?: string };
  }): Promise<LLMProvider | undefined>;
}

const DIRECT_IDENTIFIER_KEYS = new Set([
  "name",
  "address",
  "email",
  "phone",
  "exactlocation",
  "latitude",
  "longitude",
  "externalaccountid",
  "accountid",
  "contact",
]);

function sanitizeRecord(
  value: Record<string, unknown>,
  path: string,
  redactedPaths: string[],
  remove: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase())) {
      redactedPaths.push(nestedPath);
      if (!remove) result[key] = "[redacted]";
      continue;
    }
    if (Array.isArray(nested)) {
      result[key] = nested.map((item, index) =>
        item && typeof item === "object"
          ? sanitizeRecord(item as Record<string, unknown>, `${nestedPath}[${index}]`, redactedPaths, false)
          : item,
      );
    } else if (nested && typeof nested === "object") {
      result[key] = sanitizeRecord(nested as Record<string, unknown>, nestedPath, redactedPaths, false);
    } else {
      result[key] = nested;
    }
  }
  return result;
}

/** 上下文预算常量（ticket 04）：均为产品默认值；chars/4 是工程近似，不是模型精确计量。 */
const DEFAULT_CONTEXT_TOKEN_BUDGET = 24_000;
const TOKENS_PER_CHAR_DIVISOR = 4;
const CONVERSATION_VERBATIM_WINDOW = 40;
const CONVERSATION_DEGRADED_WINDOW = 10;
const TIMELINE_VERBATIM_LIMIT = 200;
const TIMELINE_DEGRADED_LIMIT = 50;
const TIMELINE_MIN_LIMIT = 20;

export class ContextAssembler {
  assemble(
    snapshot: LedgerSnapshot,
    userId: string,
    sessionId?: string,
    options: { providerKind?: string; providerModel?: string; requestPurpose?: string; assembledAt?: string; maxContextTokens?: number } = {},
  ): {
    context: ProviderContext;
    contextManifest: ContextManifest;
  } {
    const user = snapshot.users.find((candidate) => candidate.userId === userId);
    const onboardingSession = sessionId
      ? snapshot.sessions.find((candidate) => candidate.id === sessionId && candidate.userId === userId && candidate.context.kind === "onboarding")
      : undefined;
    const onboardingDraft = onboardingSession
      ? projectOnboardingProgress(snapshot.onboardingDraftEvents, onboardingSession.context.ref)
      : undefined;
    const domain = projectDomainEvents(snapshot.domainEvents, { userId });
    if (!user && !domain.profile && !onboardingDraft) throw new Error(`User facts not found: ${userId}`);
    const redactedPaths: string[] = [];
    const userPseudonym = `local-${stableHash({ userId })}`;
    const profile = sanitizeRecord(
      (domain.profile?.value ?? user?.profile ?? {}) as unknown as Record<string, unknown>,
      "profile",
      redactedPaths,
      true,
    );
    const rawTimeline = domain.timeline.current.length
      ? domain.timeline.current.map((event) => ({
          id: event.eventId,
          occurredAt: event.occurredAt,
          kind: event.fact.kind,
          source: "domain_event",
          status: "confirmed",
          data: event.fact as unknown as Record<string, unknown>,
        }))
      : (user?.timeline ?? []).map((event) => ({
          id: event.id,
          occurredAt: event.occurredAt,
          kind: event.kind,
          source: event.source,
          status: event.status,
          data: event.data as Record<string, unknown>,
        }));
    // 上下文预算（ticket 04）：token 估算为工程近似（chars/4），预算是产品默认值，
    // 不是模型精确计量。降级顺序固定：对话历史 → 非置顶记忆 → 早期 timeline → 计划详情；
    // 系统准则、安全约束、近期事实永远不进入降级序列。
    const maxTokens = options.maxContextTokens ?? DEFAULT_CONTEXT_TOKEN_BUDGET;
    let timelineLimit = TIMELINE_VERBATIM_LIMIT;
    let conversationWindow = CONVERSATION_VERBATIM_WINDOW;
    let keepUnpinnedMemory = true;
    let trimPlanDetails = false;
    const droppedSections: string[] = [];

    const allConversation = snapshot.messages.filter(
      (message) => message.userId === userId && (!sessionId || message.sessionId === sessionId),
    );
    const allMemory = snapshot.workingMemory.filter(
      (item) => item.userId === userId && !item.deletedAt,
    );

    let visibleTimeline: typeof rawTimeline = [];
    let compressedTimeline: typeof rawTimeline = [];
    let visibleConversation: typeof allConversation = [];
    let summarizedConversation: Array<Record<string, unknown>> = [];
    let memoryForContext: typeof allMemory = [];
    let planForContext: Record<string, unknown> = {};

    const rebuild = () => {
      visibleTimeline = rawTimeline.slice(-timelineLimit);
      compressedTimeline = rawTimeline.slice(0, Math.max(0, rawTimeline.length - timelineLimit));
      visibleConversation =
        conversationWindow <= 0 ? [] : allConversation.slice(-conversationWindow);
      summarizedConversation = summarizeConversation(
        conversationWindow <= 0 ? allConversation : allConversation.slice(0, Math.max(0, allConversation.length - conversationWindow)),
      );
      memoryForContext = keepUnpinnedMemory ? allMemory : allMemory.filter((item) => item.pinned);
      const rawPlan = (domain.plan?.value ?? user?.plan ?? {}) as unknown as Record<string, unknown>;
      planForContext = trimPlanDetails
        ? {
            revision: rawPlan.revision,
            title: rawPlan.title,
            effectiveDate: rawPlan.effectiveDate,
            tasks_omitted: true,
          }
        : rawPlan;
    };

    const estimateTokens = () =>
      Math.ceil(
        JSON.stringify([
          profile,
          planForContext,
          visibleTimeline,
          memoryForContext,
          visibleConversation,
          summarizedConversation,
          summarizeTimeline(compressedTimeline),
        ]).length / TOKENS_PER_CHAR_DIVISOR,
      ) + Math.ceil(JSON.stringify([
        domain.safetyConstraints,
        domain.recoveryConstraints,
        domain.mandate ?? null,
        domain.nutritionStrategies,
        domain.goalCycles,
      ]).length / TOKENS_PER_CHAR_DIVISOR);

    rebuild();
    while (estimateTokens() > maxTokens) {
      if (conversationWindow > CONVERSATION_DEGRADED_WINDOW) {
        conversationWindow = CONVERSATION_DEGRADED_WINDOW;
      } else if (conversationWindow > 0) {
        conversationWindow = 0;
      } else if (keepUnpinnedMemory) {
        keepUnpinnedMemory = false;
        droppedSections.push("working_memory_unpinned");
      } else if (timelineLimit > TIMELINE_DEGRADED_LIMIT) {
        timelineLimit = TIMELINE_DEGRADED_LIMIT;
        droppedSections.push("timeline_history");
      } else if (timelineLimit > TIMELINE_MIN_LIMIT) {
        timelineLimit = TIMELINE_MIN_LIMIT;
      } else if (!trimPlanDetails) {
        trimPlanDetails = true;
        droppedSections.push("plan_details");
      } else {
        break;
      }
      rebuild();
    }

    const timeline = visibleTimeline.map((event) => ({
      ...event,
      data: sanitizeRecord({ ...event.data }, `timeline.${event.id}.data`, redactedPaths, false),
    }));
    const workingMemory = memoryForContext.map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content,
        evidenceRefs: item.evidenceRefs,
        provenance: item.provenance,
        authority: item.authority ?? "non_authoritative",
        version: item.version,
        confidence: item.confidence,
        sensitivity: item.sensitivity,
        pinned: item.pinned,
      }));
    const context: ProviderContext = {
      userPseudonym,
      profile,
      plan: planForContext,
      timeline,
      workingMemory,
      activeConstraints: [
        ...domain.safetyConstraints.map((item) => ({
          kind: "safety_constraint",
          revision: item.revision,
          value: item.value,
        })),
        ...domain.recoveryConstraints.map((item) => ({
          kind: "recovery_constraint",
          revision: item.revision,
          value: item.value,
        })),
        ...(domain.mandate
          ? [{ kind: "coaching_mandate", revision: domain.mandate.revision, value: domain.mandate.value }]
          : []),
      ],
      nutritionStrategies: domain.nutritionStrategies.map((item) => ({
        id: item.value.id,
        revision: item.revision,
        value: sanitizeRecord(item.value as unknown as Record<string, unknown>, `nutrition.${item.value.id}`, redactedPaths, false),
      })),
      goalCycles: domain.goalCycles.map((item) => ({
        id: item.value.id,
        revision: item.revision,
        value: sanitizeRecord(item.value as unknown as Record<string, unknown>, `goal_cycle.${item.value.id}`, redactedPaths, false),
      })),
      canonicalEvidence: snapshot.domainEvents
        .filter((event) => event.userId === userId)
        .flatMap((event) => event.evidenceRefs)
        .map((ref) => ({ ...ref })),
      historicalSummaries: summarizeTimeline(compressedTimeline),
      currentConversation: visibleConversation.map((message) => {
        const redacted = redactDirectIdentifiers(message.content, `conversation.${message.id}`);
        redactedPaths.push(...redacted.redactedPaths);
        return {
          id: message.id,
          role: message.role,
          content: redacted.text,
          createdAt: message.createdAt,
        };
      }),
      conversationSummaries: summarizedConversation,
      ...(onboardingDraft ? {
        onboardingDraft: sanitizeRecord({
          id: onboardingDraft.id,
          revision: onboardingDraft.revision,
          baseline: onboardingDraft.patch.baseline,
          goalCapture: onboardingDraft.patch.goalCapture,
          dynamicFields: onboardingDraft.patch.dynamicFields,
          trainingBackground: onboardingDraft.patch.trainingBackground,
          assessment: onboardingDraft.coachingLevelAssessments?.at(-1),
          baselineMissingFields: onboardingDraft.baselineMissingFields,
          questionFrontier: goalDrivenOnboardingFrontier(onboardingDraft),
        }, "onboarding_draft", redactedPaths, false),
      } : {}),
    };
    const retainedTimeline = [...compressedTimeline, ...visibleTimeline];
    const earliestTimelineEvent = retainedTimeline[0];
    const latestTimelineEvent = retainedTimeline.at(-1);
    const timeRange = {
      ...(earliestTimelineEvent?.occurredAt ? { earliest: earliestTimelineEvent.occurredAt } : {}),
      ...(latestTimelineEvent?.occurredAt ? { latest: latestTimelineEvent.occurredAt } : {}),
    };
    return {
      context,
      contextManifest: {
        schemaVersion: 1,
        userPseudonym,
        providerKind: options.providerKind ?? "local-unspecified",
        ...(options.providerModel ? { providerModel: options.providerModel } : {}),
        requestPurpose: options.requestPurpose ?? "coach.general",
        assembledAt: options.assembledAt ?? new Date(0).toISOString(),
        factRefs: [
          `profile:${domain.profile?.value.id ?? userId}:${domain.profile?.revision ?? user?.profileRevision ?? 0}`,
          `plan:${domain.plan?.value.id ?? userId}:${domain.plan?.revision ?? user?.plan.revision ?? 0}`,
          `timeline:${userId}:${domain.timeline.revision || user?.timelineRevision || 0}`,
          ...(domain.mandate
            ? [`mandate:${domain.mandate.value.id}:${domain.mandate.revision}`]
            : user
              ? [`mandate:${userId}:${user.mandate.revision}`]
              : []),
          ...domain.safetyConstraints.map(
            (item) => `safety:${item.value.id}:${item.revision}`,
          ),
          ...domain.recoveryConstraints.map(
            (item) => `recovery:${item.value.id}:${item.revision}`,
          ),
          ...domain.nutritionStrategies.map(
            (item) => `nutrition:${item.value.id}:${item.revision}`,
          ),
          ...domain.goalCycles.map(
            (item) => `goal:${item.value.id}:${item.revision}`,
          ),
          ...(domain.permissions
            ? [`permission:${domain.permissions.value.id}:${domain.permissions.revision}`]
            : []),
          ...snapshot.workingMemory
            .filter((item) => item.userId === userId && !item.deletedAt)
            .map((item) => `memory:${item.id}:${item.version}`),
        ],
        redactedPaths,
        includes: [
          "authoritative_profile",
          "authoritative_plan",
          "authoritative_timeline",
          "active_constraints",
          "nutrition_strategies",
          "goal_cycles",
          "canonical_evidence",
          "working_memory",
          "current_conversation",
          ...(onboardingDraft ? ["onboarding_draft"] : []),
        ],
        priority: ["authoritative_facts", "active_constraints", "working_memory", "conversation"],
        productionCompression: compressedTimeline.length ? "fact_ref_hierarchical" : "none",
        retrievalFactRefs: compressedTimeline.map((event) => `timeline_event:${event.id}`),
        summaryRefs: compressedTimeline.map((event) => `timeline_event:${event.id}`),
        timeRange,
        mediaAttachments: [],
        redactionPolicyVersion: "direct-identifiers-v1",
        playbookVersion: COACH_PLAYBOOK.version,
        agentSoulVersion: AGENT_SOUL.version,
        contextBudget: {
          maxTokens,
          estimatedTokens: estimateTokens(),
          conversation:
            conversationWindow <= 0
              ? "summarized"
              : allConversation.length > conversationWindow
                ? "run_summary_window"
                : "verbatim",
          droppedSections,
        },
        ...(domain.permissions?.value.remoteLlm === "granted"
          ? { remoteLlmConsentRef: `permission:${domain.permissions.value.id}:${domain.permissions.revision}` }
          : {}),
      },
    };
  }
}

function summarizeConversation(
  messages: readonly { id: string; runId?: string; role: string; createdAt: string }[],
): Array<Record<string, unknown>> {
  const groups = new Map<string, { messageCount: number; firstAt: string; lastAt: string; userMessages: number; assistantMessages: number }>();
  for (const message of messages) {
    const key = message.runId ?? "no-run";
    const group = groups.get(key) ?? {
      messageCount: 0,
      firstAt: message.createdAt,
      lastAt: message.createdAt,
      userMessages: 0,
      assistantMessages: 0,
    };
    group.messageCount += 1;
    if (message.createdAt < group.firstAt) group.firstAt = message.createdAt;
    if (message.createdAt > group.lastAt) group.lastAt = message.createdAt;
    if (message.role === "user") group.userMessages += 1;
    if (message.role === "assistant") group.assistantMessages += 1;
    groups.set(key, group);
  }
  return [...groups.entries()].map(([runId, group]) => ({ runId, ...group }));
}

function summarizeTimeline(
  events: readonly { id: string; occurredAt: string; kind: string }[],
): Array<Record<string, unknown>> {
  const groups = new Map<string, { count: number; first: string; last: string; factRefs: string[] }>();
  for (const event of events) {
    const group = groups.get(event.kind) ?? {
      count: 0,
      first: event.occurredAt,
      last: event.occurredAt,
      factRefs: [],
    };
    group.count += 1;
    group.first = group.first < event.occurredAt ? group.first : event.occurredAt;
    group.last = group.last > event.occurredAt ? group.last : event.occurredAt;
    group.factRefs.push(`timeline_event:${event.id}`);
    groups.set(event.kind, group);
  }
  return [...groups.entries()].map(([kind, value]) => ({ kind, ...value }));
}

export class ScriptedLLMProvider implements LLMProvider {
  readonly kind = "scripted";
  readonly usesNetwork = false;
  readonly requests: LLMProviderRequest[] = [];
  readonly resumeRequests: LLMProviderResumeRequest[] = [];
  private failure?: Error;
  private toolResultTurn = 0;

  constructor(
    private readonly events: readonly ProviderEvent[],
    private readonly resumeEvents: readonly ProviderEvent[] = [],
    private readonly toolResultEvents: readonly (readonly ProviderEvent[])[] = [],
  ) {}

  failWith(error: Error): void {
    this.failure = error;
  }

  clearFailure(): void {
    this.failure = undefined;
  }

  async *stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(cloneProviderRequest(request));
    if (this.failure) throw this.failure;
    for (const event of this.events) {
      if (request.signal?.aborted) {
        yield { type: "cancelled", reason: "user" };
        return;
      }
      yield structuredClone(event);
    }
  }

  async *resume(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    this.resumeRequests.push(cloneProviderRequest(request) as LLMProviderResumeRequest);
    if (this.failure) throw this.failure;
    const isToolResult = "toolName" in request.continuation;
    const events = isToolResult
      ? this.toolResultEvents[this.toolResultTurn++] ?? []
      : this.resumeEvents;
    for (const event of events) {
      if (request.signal?.aborted) {
        yield { type: "cancelled", reason: "user" };
        return;
      }
      yield structuredClone(event);
    }
  }
}

function cloneProviderRequest<T extends LLMProviderRequest>(request: T): T {
  const { signal: _signal, ...persistable } = request;
  return structuredClone(persistable) as T;
}

/**
 * Offline baseline for a fresh install. It is deliberately narrow: it can
 * explain which local facts are available and request a typed Today-plan card,
 * but never fabricates a plan change or writes a fact. A bundled on-device
 * model can replace this adapter through the same LLMProvider port.
 */
export class LocalCoachProvider implements LLMProvider {
  readonly kind = "local-rule-coach";
  readonly usesNetwork = false;

  async *stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    const onboarding = localOnboardingFrontier(request.context.onboardingDraft);
    if (onboarding) {
      if (onboarding.kind === "assess_training_context") {
        yield { type: "tool-call", toolCallId: `local-onboarding-assessment-${request.runId}`, toolName: "onboarding.assess_training_context", input: {} };
      } else if (onboarding.kind === "catalog_fields") {
        yield { type: "text-delta", delta: "我把下一步会影响这版目标安排的信息整理成一张小表。" };
        yield {
          type: "tool-call",
          toolCallId: `local-onboarding-form-${request.runId}`,
          toolName: "onboarding.request_form",
          input: {
            topic: onboarding.topic,
            fieldIds: onboarding.fieldIds,
            reasonCode: onboarding.reasonCode,
            requiredFor: onboarding.requiredFor,
          },
        };
      } else {
        yield { type: "text-delta", delta: "训练背景和目标相关信息已经够用，可以先看一遍档案摘要再确认。" };
      }
      yield { type: "completed" };
      return;
    }
    const text = request.userText.trim();
    const lower = text.toLowerCase();
    const motionEvidence = request.context.canonicalEvidence.filter(isTrainingExecutionEvidence);
    const asksAboutMotion = /动作|执行|技术|轨迹|计次|阶段|离心|向心|复盘|form|motion|rep|phase|tempo/.test(lower);
    if (motionEvidence.length > 0 && asksAboutMotion) {
      yield { type: "text-delta", delta: summarizeTrainingExecutionEvidence(motionEvidence) };
      yield { type: "completed" };
      return;
    }
    const date = extractIsoDate(text) ?? planDate(request.context.plan);
    const asksForTodayPlan = /今天|今日|计划|训练安排|workout|plan/.test(lower);
    const asksAboutSafety = /安全|疼痛|眩晕|胸部|呼吸困难|safety|dizzy|chest/.test(lower);
    const asksAboutRecovery = /恢复|睡眠|疲劳|状态|recovery|sleep/.test(lower);
    const asksAboutMesocycle = /周期|阶段|减量周|deload|mesocycle/.test(lower);
    const asksAboutProgress = /进展|趋势|体重|体脂|progress|weight/.test(lower);
    const asksForForecast = /目标路径|完成路径|预测|预期|forecast|roadmap/.test(lower);
    const asksAboutNutrition = /饮食|营养|碳水|蛋白|热量|nutrition|calorie|protein/.test(lower);
    const asksForPlanOverview = /完整计划|本周计划|训练计划|摄入计划|饮食计划|训练和饮食|训练与饮食|training plan|meal plan|intake plan/.test(lower);
    if (asksAboutSafety) {
      yield {
        type: "text-delta",
        delta: "我会先读取本机已确认的安全限制；它优先于普通训练建议，且不会诊断具体原因。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-safety-${request.runId}`,
        toolName: "safety.show_hold",
        input: {},
      };
      yield { type: "completed" };
      return;
    }

    if (asksForPlanOverview) {
      yield {
        type: "text-delta",
        delta: "我会读取同一版本下的本周训练计划与已确认摄入范围；未知热量或重量会明确保留为待校准。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-plan-overview-${request.runId}`,
        toolName: "plan.show_current",
        input: {},
      };
      yield { type: "completed" };
      return;
    }

    if (asksForTodayPlan && date && !asksAboutNutrition) {
      yield {
        type: "text-delta",
        delta: "我会按本地已确认的计划和记录整理这一日；卡片中的动作仍以当前版本为准。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-today-${request.runId}`,
        toolName: "plan.show_today",
        input: { date },
      };
      yield { type: "completed" };
      return;
    }

    if (asksAboutRecovery) {
      const hasCommittedRecoveryConstraint = request.context.activeConstraints.some(
        (constraint) => constraint.kind === "recovery_constraint",
      );
      yield {
        type: "text-delta",
        delta: hasCommittedRecoveryConstraint
          ? "我会先读取本地已确认的恢复约束；它只说明尚未执行部分的保守安排，不会自动改写计划。"
          : "我会用本地已确认的记录做一次保守复核；没有新的自检时，它不会写入恢复约束或自动改写计划。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-recovery-${request.runId}`,
        toolName: hasCommittedRecoveryConstraint ? "recovery.show_brief" : "recovery.evaluate_timeline",
        input: {},
      };
      yield { type: "completed" };
      return;
    }

    if (asksAboutMesocycle) {
      yield {
        type: "text-delta",
        delta: "我会读取当前周期内已确认的训练、恢复与饮食策略状态；周期回顾本身不会自动改写计划。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-mesocycle-${request.runId}`,
        toolName: "coach.show_mesocycle_review",
        input: {},
      };
      yield { type: "completed" };
      return;
    }

    if (asksAboutNutrition) {
      const strategyId = request.context.nutritionStrategies[0]?.id;
      const asksForPlanCoordination = /训练日|休息日|减量周|deload|漏训|恢复优先|配合|安排/.test(lower);
      yield {
        type: "text-delta",
        delta: asksForPlanCoordination && strategyId
          ? "我会用当前已物化的训练安排核对饮食日类型；不会因漏训或恢复状态自行改变热量目标。"
          : "我会读取当前已确认的本地饮食策略；范围是可复核的估算，不会把模型建议当成已记录的摄入。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-nutrition-${request.runId}`,
        toolName: asksForPlanCoordination && strategyId ? "nutrition.propose_plan_coordination" : "nutrition.show_strategy",
        input: asksForPlanCoordination && strategyId ? { nutritionStrategyId: strategyId } : {},
      };
      yield { type: "completed" };
      return;
    }

    if (asksForForecast) {
      yield {
        type: "text-delta",
        delta: "我会读取最近一次本地计划复核的情景路径；它只说明条件和不确定性，不会自行改写计划。",
      };
      yield {
        type: "tool-call",
        toolCallId: `local-forecast-${request.runId}`,
        toolName: "forecast.show_latest",
        input: {},
      };
      yield { type: "completed" };
      return;
    }

    const timeline = request.context.timeline;
    const trainingCount = timeline.filter((event) => event.kind === "training").length;
    const response = asksAboutProgress
        ? `当前本机有 ${trainingCount} 条已确认训练记录。趋势只会基于真实记录显示，不会自动改写你的计划。`
        : "我会使用本机已确认的计划、Timeline 和恢复约束回答。需要执行计划时，可以让我查看某天的安排；任何改动都会先以可确认的卡片给出。";
    yield { type: "text-delta", delta: response };
    yield { type: "completed" };
  }

  async *resume(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    if ("toolName" in request.continuation && request.continuation.toolName === "onboarding.request_form") {
      yield { type: "text-delta", delta: "填完这张卡继续，我会接着把已知和未知分开整理。" };
      yield { type: "completed" };
      return;
    }
    yield* this.stream(request);
  }
}

type LocalOnboardingFrontier =
  | { kind: "assess_training_context" }
  | { kind: "catalog_fields"; topic: string; reasonCode: string; requiredFor: string; fieldIds: readonly string[] }
  | { kind: "review_dossier" };

/** Reads only the local harness-owned frontier shape; malformed context falls back safely. */
function localOnboardingFrontier(value: Record<string, unknown> | undefined): LocalOnboardingFrontier | undefined {
  const raw = value?.questionFrontier;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const frontier = raw as Record<string, unknown>;
  if (frontier.kind === "assess_training_context" || frontier.kind === "review_dossier") return { kind: frontier.kind };
  if (
    frontier.kind === "catalog_fields"
    && typeof frontier.topic === "string"
    && typeof frontier.reasonCode === "string"
    && typeof frontier.requiredFor === "string"
    && Array.isArray(frontier.fieldIds)
    && frontier.fieldIds.length > 0
    && frontier.fieldIds.every((fieldId) => typeof fieldId === "string")
  ) {
    return { kind: "catalog_fields", topic: frontier.topic, reasonCode: frontier.reasonCode, requiredFor: frontier.requiredFor, fieldIds: frontier.fieldIds };
  }
  return undefined;
}

/** Narrow offline extraction, limited to facts explicitly written in this turn. */
function extractLocalTrainingBackground(text: string): Record<string, unknown> | undefined {
  if (/^The baseline dossier is now available/u.test(text)) return undefined;
  const input: Record<string, unknown> = {};
  const years = text.match(/练(?:了)?\s*(\d+(?:\.\d+)?)\s*年/u);
  const months = text.match(/练(?:了)?\s*(\d+)\s*个?月/u);
  if (years) {
    const value = Math.round(Number(years[1]) * 12);
    if (Number.isFinite(value) && value >= 0 && value <= 1200) input.cumulativeTrainingMonths = { minimum: value, maximum: value };
  } else if (months) {
    const value = Number(months[1]);
    if (Number.isFinite(value) && value >= 0 && value <= 1200) input.cumulativeTrainingMonths = { minimum: value, maximum: value };
  }
  const frequency = text.match(/(?:每周|一周)\s*(\d+)\s*(?:练|天)/u);
  const minutes = text.match(/每次\s*(\d+)\s*(?:分|分钟)/u);
  const hours = text.match(/每次\s*(\d+(?:\.\d+)?)\s*(?:小?时)/u);
  const duration = minutes ? Number(minutes[1]) : hours ? Math.round(Number(hours[1]) * 60) : undefined;
  if (frequency && duration && Number(frequency[1]) >= 1 && Number(frequency[1]) <= 14 && duration >= 10 && duration <= 360) {
    input.schedule = { weeklyFrequency: Number(frequency[1]), sessionDurationMinutes: duration };
  }
  if (/健身房/u.test(text)) input.environments = ["gym"];
  if (/胸.*背.*腿.*肩|胸背腿肩/u.test(text)) input.recentSplit = ["胸", "背", "腿", "肩"];
  if (/稳定|规律|坚持/u.test(text)) input.executionStability = "reported_consistent";
  return Object.keys(input).length ? input : undefined;
}

interface TrainingExecutionEvidenceRecord extends Record<string, unknown> {
  kind: "training_execution_assessment";
  captureId: string;
  rustOutcomes: {
    confirmed: number;
    needsReview: number;
    rejected: number;
    reasonCounts?: Record<string, number>;
  };
  assessment: {
    preset: {
      exerciseId: string;
      capturePosition: string;
    };
    dimensions: {
      task: { status: string; confirmedRepCount: number };
      phaseControl: {
        status: string;
        semantics?: { startToPeak: string; peakToEnd: string };
        reps?: Array<{ repIndex: number; firstPhaseMs: number; secondPhaseMs: number; totalMs: number }>;
      };
      supportStability?: {
        judgementStatus?: string;
        reps?: Array<{
          judgementStatus?: string;
          torsoCenterMaximumExcursionTorsoNorm?: number | null;
          torsoTiltRangeDeg?: number | null;
        }>;
      };
      bilateralCoordination?: {
        judgementStatus?: string;
        reps?: Array<{
          judgementStatus?: string;
          jointAngleDeltas?: Record<string, {
            p90AbsoluteAngleDeltaDeg?: number | null;
          }>;
        }>;
      };
      trajectoryControl?: {
        judgementStatus?: string;
        reps?: Array<{
          judgementStatus?: string;
          p90FrameStepTorsoNorm?: number | null;
          predictedOrRepairedPointRate?: number | null;
        }>;
        equipmentPath?: { judgementStatus?: string; reason?: string };
      };
      observationConfidence: {
        effectiveObservationFps: number;
        processedFrames?: number;
        emptyCandidateFrames: number;
        emptyCandidateFrameRate?: number | null;
        maximumInferenceMs: number;
      };
      [key: string]: unknown;
    };
    fiveLayers?: {
      effortAndDoseContext?: { cannotJudge?: readonly string[] };
    };
    reps?: Array<{
      repIndex: number;
      disposition: "confirmed" | "needs_review" | "rejected";
      startMs: number;
      turnaroundMs: number;
      endMs: number;
      observation?: {
        validFrameRate?: number | null;
        medianCanonicalQuality?: number | null;
      };
    }>;
  };
}

function isTrainingExecutionEvidence(value: Record<string, unknown>): value is TrainingExecutionEvidenceRecord {
  return value.kind === "training_execution_assessment"
    && typeof value.captureId === "string"
    && Boolean(value.assessment && typeof value.assessment === "object")
    && Boolean(value.rustOutcomes && typeof value.rustOutcomes === "object");
}

function summarizeTrainingExecutionEvidence(evidence: readonly TrainingExecutionEvidenceRecord[]): string {
  const lines = ["这次只根据客户端骨架进入 Rust SDK 后封口的证据复盘，不把视频置信度当作动作正确性。"];
  for (const item of evidence) {
    const assessment = item.assessment;
    const outcomes = item.rustOutcomes;
    const observation = assessment.dimensions.observationConfidence;
    const phaseReps = assessment.dimensions.phaseControl.reps ?? [];
    const emptyRate = observation.emptyCandidateFrameRate;
    const trajectoryReps = assessment.dimensions.trajectoryControl?.reps?.filter(
      (rep) => rep.judgementStatus === "observed",
    ) ?? [];
    const maximumPathStep = maximumFinite(trajectoryReps.map((rep) => rep.p90FrameStepTorsoNorm));
    const maximumPredictedRate = maximumFinite(trajectoryReps.map((rep) => rep.predictedOrRepairedPointRate));
    const timelineEvidenceRisk = outcomes.rejected > outcomes.confirmed
      || outcomes.needsReview > outcomes.confirmed;
    const observationRiskReasons = [
      typeof emptyRate === "number" && emptyRate > 0.05
        ? `空候选帧 ${(emptyRate * 100).toFixed(1)}%`
        : null,
      maximumPredictedRate !== null && maximumPredictedRate > 0.15
        ? `预测/修复点最高 ${(maximumPredictedRate * 100).toFixed(0)}%`
        : null,
      maximumPathStep !== null && maximumPathStep > 0.50
        ? `骨架步长 P90 最高 ${maximumPathStep.toFixed(3)} 个躯干长度`
        : null,
    ].filter((reason): reason is string => reason !== null);
    lines.push(
      `${assessment.preset.exerciseId}（${assessment.preset.capturePosition}）：确认 ${outcomes.confirmed} 次，待复核 ${outcomes.needsReview} 次，拒绝 ${outcomes.rejected} 次；客户端观测 ${observation.effectiveObservationFps.toFixed(1)} FPS${typeof emptyRate === "number" ? `，空候选帧 ${(emptyRate * 100).toFixed(1)}%` : ""}。`,
    );
    const perRep = (assessment.reps ?? []).map((rep) => {
      const firstPhaseMs = Math.max(0, rep.turnaroundMs - rep.startMs);
      const secondPhaseMs = Math.max(0, rep.endMs - rep.turnaroundMs);
      const quality = rep.observation;
      const confidence = typeof quality?.validFrameRate === "number"
        ? `，有效帧 ${(quality.validFrameRate * 100).toFixed(0)}%`
        : "";
      return `R${rep.repIndex} ${rep.disposition} ${rep.startMs}-${rep.turnaroundMs}-${rep.endMs}ms（两阶段 ${firstPhaseMs}/${secondPhaseMs}ms${confidence}）`;
    });
    if (perRep.length) {
      lines.push(`逐 rep 客户端封口结果：${perRep.join("；")}。这里的完成质量只表示周期证据与观测可信度，不表示技术标准度。`);
    }
    if (outcomes.needsReview > 0) {
      lines.push(`其中 ${outcomes.needsReview} 次周期被 Rust 标记为 needs_review，不计入正式训练量，需按对应 rep 的观测证据复核。`);
    }
    if (timelineEvidenceRisk) {
      const reasons = Object.entries(outcomes.reasonCounts ?? {})
        .filter(([reason, count]) => reason !== "none" && count > 0)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([reason, count]) => `${reason}×${count}`)
        .join("、");
      lines.push(`这组周期候选证据不稳定${reasons ? `（${reasons}）` : ""}，当前不应据此确认正式训练量。`);
    }
    if (observationRiskReasons.length > 0) {
      lines.push(`骨架观测不稳定（${observationRiskReasons.join("、")}）；这会降低动作技术判断可信度，但不会改写已经由 Rust 封口的 rep 与阶段，当前不能据此给出动作技术纠正。`);
    }
    if (phaseReps.length >= 2) {
      const first = phaseReps[0];
      const last = phaseReps.at(-1)!;
      const change = first.totalMs > 0 ? (last.totalMs - first.totalMs) / first.totalMs : 0;
      const semantics = assessment.dimensions.phaseControl.semantics;
      lines.push(
        `可观察到每次周期和${semantics ? `${semantics.startToPeak}/${semantics.peakToEnd}` : "两个阶段"}时长；末次相对首次总时长${change >= 0 ? "增加" : "减少"} ${Math.abs(change * 100).toFixed(0)}%。这只是可见速度变化，不等于 RPE、RIR、肌肉发力或借力结论。`,
      );
    }
    const supportReps = assessment.dimensions.supportStability?.reps?.filter(
      (rep) => rep.judgementStatus === "observed",
    ) ?? [];
    const maximumTorsoExcursion = maximumFinite(
      supportReps.map((rep) => rep.torsoCenterMaximumExcursionTorsoNorm),
    );
    const maximumTorsoTiltRange = maximumFinite(
      supportReps.map((rep) => rep.torsoTiltRangeDeg),
    );
    if (maximumTorsoExcursion !== null || maximumTorsoTiltRange !== null) {
      lines.push(
        `Rust 可见策略量：rep 内躯干中心最大位移${maximumTorsoExcursion === null ? "不可用" : `约 ${maximumTorsoExcursion.toFixed(2)} 个躯干长度`}，躯干倾角最大变化${maximumTorsoTiltRange === null ? "不可用" : `约 ${maximumTorsoTiltRange.toFixed(1)}°`}。这些是相机平面观测，尚未按该动作标准走廊评级。`,
      );
    }
    const bilateralDeltas = (assessment.dimensions.bilateralCoordination?.reps ?? []).flatMap(
      (rep) => Object.entries(rep.jointAngleDeltas ?? {}).flatMap(([joint, values]) =>
        typeof values.p90AbsoluteAngleDeltaDeg === "number"
          ? [{ joint, value: values.p90AbsoluteAngleDeltaDeg }]
          : []),
    );
    const largestBilateral = bilateralDeltas.sort((left, right) => right.value - left.value)[0];
    if (largestBilateral) {
      lines.push(`左右协调可观测量中，${largestBilateral.joint}角度差的较高分位最大约 ${largestBilateral.value.toFixed(1)}°；缺少该机位和变式的审核阈值，因此不能直接称为左右发力不一致。`);
    }
    if (maximumPathStep !== null) {
      lines.push(`骨架轨迹连续性已记录：相邻观测步长 P90 最大约 ${maximumPathStep.toFixed(3)} 个躯干长度${maximumPredictedRate === null ? "" : `，预测/修复点占比最高 ${(maximumPredictedRate * 100).toFixed(0)}%`}。这能提示观测是否抖动，但没有标准走廊时不等于动作不稳。`);
    }
  }
  lines.push("目前已能输出动作周期、阶段时长、识别 profile 相对行程、躯干可见位移、左右关节差、骨架路径连续性和观测可信度；这些观测量不会自动升级为技术正确、借力或刺激转移结论。器械轨迹需在对应动作预设中启用器械检测，技术与刺激判断仍需审核过的标准动作走廊；负重和 RPE/RIR 仍需用户或训练计划提供。产品不会输出一个掩盖原因的总分。");
  return lines.join("\n");
}

function maximumFinite(values: readonly (number | null | undefined)[]): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

/** Thin adapter for the existing provider call. SDK-specific types stay behind the injected function. */
export class FunctionLLMProvider implements LLMProvider {
  readonly kind = "remote-function";
  readonly usesNetwork = true;

  constructor(
    private readonly complete: (request: LLMProviderRequest) => Promise<string>,
  ) {}

  async *stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    const text = await this.complete(request);
    yield { type: "text-delta", delta: text };
    yield { type: "completed" };
  }


  async *resume(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    const text = await this.complete(request);
    yield { type: "text-delta", delta: text };
    yield { type: "completed" };
  }
}

export interface OpenAICompatibleFetchResponse {
  ok: boolean;
  status: number;
  body?: ReadableStream<Uint8Array> | null;
  json?(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}

export class OpenAICompatibleHttpError extends Error {
  constructor(readonly status: number, readonly wireCode?: string) {
    super(`remote_provider_http_${status}`);
    this.name = "OpenAICompatibleHttpError";
  }
}

export class OpenAICompatibleStreamError extends Error {
  constructor(readonly wireCode: string) {
    super(`remote_provider_stream_${wireCode}`);
    this.name = "OpenAICompatibleStreamError";
  }
}

export type OpenAICompatibleFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<OpenAICompatibleFetchResponse>;

export type OpenAICompatibleResumeFetch = (
  url: string,
  init: {
    method: "GET";
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  },
) => Promise<OpenAICompatibleFetchResponse>;

export interface OpenAICompatibleStreamResumeOptions {
  endpoint(invocationId: string): string;
  fetch?: OpenAICompatibleResumeFetch;
  maxAttempts?: number;
}

export interface OpenAICompatibleProviderOptions {
  /** A user-configured, OpenAI-compatible Chat Completions endpoint. */
  endpoint: string;
  model: string;
  /** Reads a device-only credential at request time; never persist it in a run or manifest. */
  authorizationHeader: () => Promise<string | undefined>;
  /** Adds first-party transport metadata such as idempotency and run IDs. */
  requestHeaders?: (
    request: LLMProviderRequest | LLMProviderResumeRequest,
  ) => Promise<Readonly<Record<string, string>>> | Readonly<Record<string, string>>;
  /** Optional first-party volatile SSE recovery endpoint. */
  streamResume?: OpenAICompatibleStreamResumeOptions;
  fetch?: OpenAICompatibleFetch;
}

/**
 * Thin streaming adapter for an explicitly configured OpenAI-compatible
 * endpoint.  It deliberately converts the wire protocol at the edge: the
 * rest of the client only sees our ProviderEvent and keeps tool execution,
 * plans, facts and tokens local.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly kind = "openai-compatible";
  readonly usesNetwork = true;
  readonly model: string;
  readonly configurationFingerprint: string;
  private readonly endpoint: string;
  private readonly authorizationHeader: () => Promise<string | undefined>;
  private readonly requestHeaders?: OpenAICompatibleProviderOptions["requestHeaders"];
  private readonly streamResume?: OpenAICompatibleStreamResumeOptions;
  private readonly resumeFetch?: OpenAICompatibleResumeFetch;
  private readonly fetchImpl: OpenAICompatibleFetch;

  constructor(options: OpenAICompatibleProviderOptions) {
    if (!/^https:\/\//.test(options.endpoint)) throw new Error("remote_provider_https_required");
    if (!options.model.trim()) throw new Error("remote_provider_model_required");
    this.endpoint = options.endpoint;
    this.model = options.model;
    this.configurationFingerprint = stableHash({ kind: this.kind, endpoint: this.endpoint, model: this.model });
    this.authorizationHeader = options.authorizationHeader;
    this.requestHeaders = options.requestHeaders;
    this.streamResume = options.streamResume;
    this.fetchImpl = options.fetch ?? (globalThis.fetch?.bind(globalThis) as unknown as OpenAICompatibleFetch);
    this.resumeFetch = options.streamResume?.fetch ?? (
      options.streamResume
        ? globalThis.fetch?.bind(globalThis) as unknown as OpenAICompatibleResumeFetch
        : undefined
    );
    if (!this.fetchImpl) throw new Error("remote_provider_fetch_unavailable");
  }

  stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    return this.streamRequest(request);
  }

  resume(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    return this.streamRequest(request);
  }

  private async *streamRequest(request: LLMProviderRequest | LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    const authorization = await this.authorizationHeader();
    if (!authorization) throw new Error("remote_provider_credential_unavailable");
    const requestHeaders = await this.requestHeaders?.(request) ?? {};
    assertSafeAdditionalHeaders(requestHeaders);
    const toolNamesByWireName = new Map<string, string>();
    let response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        ...requestHeaders,
        "content-type": "application/json",
        authorization,
      },
      body: JSON.stringify(openAiCompatibleRequest({ request, model: this.model, toolNamesByWireName })),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (!response.ok) {
      throw new OpenAICompatibleHttpError(response.status, await readOpenAiCompatibleErrorCode(response));
    }
    if (!response.body) throw new Error("remote_provider_stream_unavailable");

    let decoder = new TextDecoder();
    const toolCalls = new Map<number, { id?: string; name?: string; arguments: string }>();
    let buffer = "";
    let reader = response.body.getReader();
    let invocationId = response.headers?.get("x-maxpower-invocation-id") ?? undefined;
    let pendingEventId: string | undefined;
    let lastEventId = "0";
    let resumeAttempts = 0;
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (cause) {
        if (
          request.signal?.aborted ||
          !this.streamResume ||
          !this.resumeFetch ||
          !invocationId ||
          resumeAttempts >= (this.streamResume.maxAttempts ?? 2)
        ) {
          throw cause;
        }
        resumeAttempts += 1;
        const refreshedAuthorization = await this.authorizationHeader();
        if (!refreshedAuthorization) throw new Error("remote_provider_credential_unavailable");
        response = await this.resumeFetch(this.streamResume.endpoint(invocationId), {
          method: "GET",
          headers: {
            authorization: refreshedAuthorization,
            "last-event-id": lastEventId,
          },
          ...(request.signal ? { signal: request.signal } : {}),
        });
        if (!response.ok) {
          throw new OpenAICompatibleHttpError(response.status, await readOpenAiCompatibleErrorCode(response));
        }
        if (!response.body) throw new Error("remote_provider_stream_unavailable");
        invocationId = response.headers?.get("x-maxpower-invocation-id") ?? invocationId;
        reader = response.body.getReader();
        decoder = new TextDecoder();
        buffer = "";
        pendingEventId = undefined;
        continue;
      }
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const parsedEventId = parseOpenAiCompatibleEventId(line);
        if (parsedEventId !== undefined) {
          pendingEventId = parsedEventId;
          continue;
        }
        const event = parseOpenAiCompatibleSseLine(line);
        if (event === undefined) continue;
        if (event === null) throw new Error("remote_provider_malformed_stream");
        if (event !== "[DONE]") {
          assertOpenAiCompatibleWireSuccess(event);
          for (const providerEvent of openAiCompatibleDeltaEvents(event, toolCalls, toolNamesByWireName)) yield providerEvent;
        }
        if (pendingEventId !== undefined) {
          lastEventId = pendingEventId;
          pendingEventId = undefined;
        }
      }
    }
    const trailing = parseOpenAiCompatibleSseLine(buffer);
    if (trailing === null) throw new Error("remote_provider_malformed_stream");
    if (trailing && trailing !== "[DONE]") {
      assertOpenAiCompatibleWireSuccess(trailing);
      for (const providerEvent of openAiCompatibleDeltaEvents(trailing, toolCalls, toolNamesByWireName)) yield providerEvent;
    }
    for (const [index, call] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) {
      if (!call.id || !call.name) throw new Error("remote_provider_incomplete_tool_call");
      let input: unknown = null;
      try { input = call.arguments ? JSON.parse(call.arguments) : {}; } catch { input = null; }
      yield { type: "tool-call", toolCallId: call.id, toolName: call.name, input };
    }
    yield { type: "completed" };
  }
}

function parseOpenAiCompatibleEventId(line: string): string | undefined {
  const match = line.match(/^id:\s*(\d+)\s*$/i);
  return match?.[1];
}

function assertSafeAdditionalHeaders(headers: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.trim().toLowerCase();
    if (!normalized || normalized === "authorization" || normalized === "content-type") {
      throw new Error("remote_provider_reserved_header");
    }
    if (!value.trim() || /[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new Error("remote_provider_invalid_header");
    }
  }
}

function assertOpenAiCompatibleWireSuccess(payload: Record<string, unknown>): void {
  const raw = payload.error;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const code = typeof (raw as Record<string, unknown>).code === "string"
    ? (raw as Record<string, unknown>).code as string
    : "provider_error";
  const safeCode = code.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || "provider_error";
  throw new OpenAICompatibleStreamError(safeCode);
}

async function readOpenAiCompatibleErrorCode(response: OpenAICompatibleFetchResponse): Promise<string | undefined> {
  if (!response.json) return undefined;
  try {
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const error = (value as Record<string, unknown>).error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return undefined;
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" && code ? code : undefined;
  } catch {
    return undefined;
  }
}

function openAiCompatibleRequest(input: {
  request: LLMProviderRequest | LLMProviderResumeRequest;
  model: string;
  toolNamesByWireName: Map<string, string>;
}) {
  const modelInput = input.request.modelInput;
  if (!modelInput) throw new Error("local_harness_model_input_missing");
  return {
    model: input.model,
    stream: true,
    parallel_tool_calls: false,
    tools: input.request.toolManifest.map((tool) => {
      const wireName = openAiCompatibleToolName(tool.name);
      const existing = input.toolNamesByWireName.get(wireName);
      if (existing && existing !== tool.name) throw new Error("remote_provider_tool_name_collision");
      input.toolNamesByWireName.set(wireName, tool.name);
      return {
        type: "function",
        function: {
          name: wireName,
          description: tool.description ?? `MaxPower ${tool.accessClass} tool (${tool.name})`,
          parameters: tool.inputSchema,
        },
      };
    }),
    messages: [
      {
        role: "system",
        content: modelInput.systemPrompt,
      },
      {
        role: "user",
        content: modelInput.userContent,
      },
    ],
  };
}

function parseOpenAiCompatibleSseLine(line: string): Record<string, unknown> | "[DONE]" | undefined | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return undefined;
  const payload = trimmed.slice(5).trim();
  if (!payload) return undefined;
  if (payload === "[DONE]") return "[DONE]";
  try {
    const parsed: unknown = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function openAiCompatibleDeltaEvents(
  payload: Record<string, unknown>,
  toolCalls: Map<number, { id?: string; name?: string; arguments: string }>,
  toolNamesByWireName: ReadonlyMap<string, string>,
): ProviderEvent[] {
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined;
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) return [];
  const delta = (choice as Record<string, unknown>).delta;
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return [];
  const value = delta as Record<string, unknown>;
  const events: ProviderEvent[] = typeof value.content === "string" && value.content
    ? [{ type: "text-delta", delta: value.content }]
    : [];
  if (!Array.isArray(value.tool_calls)) return events;
  for (const raw of value.tool_calls) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const call = raw as Record<string, unknown>;
    const index = typeof call.index === "number" && Number.isInteger(call.index) ? call.index : 0;
    const previous = toolCalls.get(index) ?? { arguments: "" };
    const functionValue = call.function;
    const fn = functionValue && typeof functionValue === "object" && !Array.isArray(functionValue)
      ? functionValue as Record<string, unknown>
      : {};
    const toolCallId = typeof call.id === "string" ? call.id : previous.id;
    const wireToolName = typeof fn.name === "string" ? fn.name : undefined;
    const toolName = wireToolName
      ? toolNamesByWireName.get(wireToolName) ?? wireToolName
      : previous.name;
    const argumentDelta = typeof fn.arguments === "string" ? fn.arguments : "";
    toolCalls.set(index, { id: toolCallId, name: toolName, arguments: previous.arguments + argumentDelta });
    if (toolCallId && toolName && argumentDelta) {
      events.push({ type: "tool-input-delta", toolCallId, toolName, delta: argumentDelta });
    }
  }
  return events;
}

function extractIsoDate(value: string): string | undefined {
  return value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
}

function planDate(plan: Record<string, unknown>): string | undefined {
  const sessions = Array.isArray(plan.sessions) ? plan.sessions : [];
  const session = sessions.find(
    (item): item is { scheduledFor: unknown } => Boolean(item) && typeof item === "object" && !Array.isArray(item) && "scheduledFor" in item,
  );
  if (typeof session?.scheduledFor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(session.scheduledFor)) {
    return session.scheduledFor;
  }
  return typeof plan.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(plan.effectiveDate)
    ? plan.effectiveDate
    : undefined;
}
