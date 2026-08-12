import {
  ContextAssembler,
  ProviderServiceError,
  type LLMProvider,
  type LLMProviderResolver,
  type LLMProviderRequest,
  type LLMProviderResumeRequest,
  type ProviderEvent,
} from "./adapters/provider";
import { buildLocalAgentModelInput } from "./agentModelInput";
import { resolveCoachCapabilities } from "./capabilityContract";
import type { HumanActionCoordinator, ResumeHumanActionInput } from "./hitl";
import { filterCoachOutput } from "./outputFilter";
import type { ForbiddenClaimRule } from "../knowledge/model";
import type { CoachLedger } from "./ledger";
import type { ProviderExecutionPolicy } from "./ports";
import type {
  CoachMessage,
  CoachRunEvent,
  CoachRunRecord,
  CoachSession,
  CoachToolCallRecord,
  RuntimeServices,
  ToolAuditRecord,
} from "./model";
import {
  BACKGROUND_TRACE_SESSION_ID,
  buildBehaviorDecisionRecord,
  traceShortCode,
  traceUserPseudonym,
  type BehaviorDecisionBoundary,
  type BehaviorDecisionOutcome,
  type BehaviorDecisionReasonCode,
  type BehaviorDecisionTraceRecorder,
} from "../observability";
import { stableHash } from "./stable";
import { redactDirectIdentifiers } from "./remoteRedaction";
import type { CoachToolCall, CoachToolRegistry } from "./toolRegistry";

const DEFAULT_PROVIDER_IDLE_TIMEOUT_MS = 45_000;
const MAX_TOOL_RESULT_CONTINUATIONS = 8;

class ProviderTimeoutError extends Error {
  readonly idleTimeoutMs: number;

  constructor(idleTimeoutMs: number) {
    super("Provider 未在限定时间内返回事件");
    this.name = "ProviderTimeoutError";
    this.idleTimeoutMs = idleTimeoutMs;
  }
}

class ProviderStreamCancelledError extends Error {
  constructor(readonly reason: "transport" | undefined) {
    super("Provider stream cancelled");
    this.name = "ProviderStreamCancelledError";
  }
}

/** Owns provider streaming and canonical event normalization; never commits domain facts. */
export class AgentRuntime {
  private remoteProviderRequests = 0;
  private readonly activeProviderRuns = new Map<string, AbortController>();
  private readonly providerIdleTimeoutMs: number;

  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly provider?: LLMProvider,
    private readonly contextAssembler = new ContextAssembler(),
    private readonly tools?: CoachToolRegistry,
    private readonly humanActions?: HumanActionCoordinator,
    providerExecutionPolicy?: ProviderExecutionPolicy,
    private readonly providerResolver?: LLMProviderResolver,
    /** 禁止声称输出过滤器规则（ticket 09），来自知识包安全词表；空数组=不启用。 */
    private readonly outputFilterRules: readonly ForbiddenClaimRule[] = [],
    /** Optional structured audit sink; never contains prompt text or CoT. */
    private readonly behaviorDecisionRecorder?: BehaviorDecisionTraceRecorder,
  ) {
    this.providerIdleTimeoutMs = providerIdleTimeout(providerExecutionPolicy?.idleTimeoutMs);
  }

  status(): { mode: "local-only" | "remote-provider"; remoteProviderRequests: number } {
    return {
      mode: this.provider?.usesNetwork || this.providerResolver ? "remote-provider" : "local-only",
      remoteProviderRequests: this.remoteProviderRequests,
    };
  }

  async sendTurn(input: { sessionId: string; text: string }): Promise<readonly CoachRunEvent[]> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${input.sessionId}`);
    if (session.status === "archived" || session.status === "completed") {
      throw new Error(`CoachSession is not writable: ${session.status}`);
    }
    const provider = await this.resolveProvider(session);
    const now = this.runtime.now();
    const runId = this.runtime.nextId("coach-run");
    const assembled = this.contextAssembler.assemble(snapshot, session.userId, session.id, {
      providerKind: provider?.kind ?? "none",
      ...(provider?.model ? { providerModel: provider.model } : {}),
      requestPurpose: `coach.${session.context.kind}`,
      assembledAt: now,
    });
    const providerText = provider?.usesNetwork
      ? redactDirectIdentifiers(input.text, "user_text")
      : { text: input.text, redactedPaths: [] as readonly string[] };
    const providerContextManifest = providerText.redactedPaths.length
      ? {
          ...assembled.contextManifest,
          redactedPaths: [...new Set([...assembled.contextManifest.redactedPaths, ...providerText.redactedPaths])],
        }
      : assembled.contextManifest;
    const message: CoachMessage = {
      id: this.runtime.nextId("message"),
      sessionId: session.id,
      userId: session.userId,
      role: "user",
      content: input.text,
      runId,
      createdAt: now,
    };
    const run: CoachRunRecord = {
      id: runId,
      sessionId: session.id,
      userId: session.userId,
      status: "streaming",
      factFrontier: manifestFactRefs(providerContextManifest.factRefs),
      contextManifestHash: stableHash(providerContextManifest),
      contextManifest: providerContextManifest,
      ...(provider ? {
        provider: {
          kind: provider.kind,
          ...(provider.model ? { model: provider.model } : {}),
          ...(provider.configurationFingerprint ? { configurationFingerprint: provider.configurationFingerprint } : {}),
        },
      } : {}),
      startedAt: now,
      updatedAt: now,
    };
    const updatedSession: CoachSession = {
      ...session,
      status: "active",
      revision: (session.revision ?? 1) + 1,
      messageIds: [...new Set([...(session.messageIds ?? []), message.id])],
      runIds: [...new Set([...(session.runIds ?? []), run.id])],
      updatedAt: now,
    };
    const toolManifest = resolveCoachCapabilities({
      snapshot,
      userId: session.userId,
      tools: this.tools,
    });
    const requestAudit = auditRecord(this.runtime, {
      userId: session.userId,
      sessionId: session.id,
      runId,
      phase: "provider_request",
      outcome: "started",
      metadata: {
        provider: provider?.kind ?? "none",
        network: provider?.usesNetwork ?? false,
        contextManifestHash: run.contextManifestHash,
        visibleToolCount: toolManifest.length,
        visibleToolNames: toolManifest.map((tool) => tool.name).join(","),
      },
    });
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: session.userId,
      intent: "coach_run.start",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      domainEvents: [],
      sessions: [updatedSession],
      messages: [message],
      runs: [run],
      toolAudit: [requestAudit],
      idempotencyKey: `run:start:${runId}`,
      recordedAt: now,
    });
    await this.recordBehaviorDecision({
      session,
      runId,
      boundary: "capability_visibility",
      outcome: "accepted",
      reasonCodes: ["capability_visible"],
      inputRefs: toolManifest.map((tool) => `tool:${tool.name}`),
      causationIds: [`coach_run:${runId}`],
      expectedSignal: "none",
    });

    if (!provider) {
      return this.finishLocalOnlyRun(session, runId, now, "当前未配置语言模型；本地计划、记录与撤销仍可使用。");
    }
    if (provider.usesNetwork) this.remoteProviderRequests += 1;
    const controller = new AbortController();
    this.activeProviderRuns.set(runId, controller);
    const request: LLMProviderRequest = {
      sessionId: session.id,
      runId,
      userText: providerText.text,
      ...assembled,
      contextManifest: providerContextManifest,
      toolManifest,
      modelInput: buildLocalAgentModelInput({
        userText: providerText.text,
        context: assembled.context,
        contextManifest: providerContextManifest,
      }),
      signal: controller.signal,
    };
    try {
      return await this.consumeProviderStream({
        session,
        runId,
        provider,
        stream: provider.stream(request),
        abortController: controller,
      });
    } catch (error) {
      return this.persistProviderFailure(session, runId, error);
    } finally {
      if (this.activeProviderRuns.get(runId) === controller) this.activeProviderRuns.delete(runId);
    }
  }

  async resumeHumanAction(input: ResumeHumanActionInput): Promise<{
    status: "resumed";
    output: ResumeHumanActionInput["output"];
    events: readonly CoachRunEvent[];
  }> {
    if (!this.humanActions) throw new Error("HumanActionCoordinator is not configured");
    const resumed = await this.humanActions.resume(input);
    const events = await this.continueRun(input.runId);
    return { status: "resumed", output: resumed.output, events: [resumed.event, ...events] };
  }

  async continueRun(runId: string): Promise<readonly CoachRunEvent[]> {
    const snapshot = await this.ledger.read();
    const run = snapshot.runs.find((candidate) => candidate.id === runId);
    if (!run) return [];
    if (run.status !== "resuming" || !run.resume) return [];
    const session = snapshot.sessions.find((candidate) => candidate.id === run.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${run.sessionId}`);
    let provider: LLMProvider | undefined;
    try {
      provider = await this.resolveProvider(session, run.provider);
    } catch (cause) {
      const failure: CoachRunEvent = {
        type: "run-error",
        sessionId: session.id,
        runId: run.id,
        code: "policy_rejected",
        message: "远程模型配置已变化；请从当前对话重新开始。",
        shortCode: traceShortCode({ traceId: run.id, sessionId: session.id }),
        occurredAt: this.runtime.now(),
      };
      await this.finishRun({ sessionId: session.id, runId: run.id, events: [failure], status: "terminated" });
      return [failure];
    }
    if (!provider?.resume) {
      const failure: CoachRunEvent = {
        type: "run-error",
        sessionId: session.id,
        runId: run.id,
        code: "terminal_failure",
        message: "Provider 不支持同 Run continuation",
        shortCode: traceShortCode({ traceId: run.id, sessionId: session.id }),
        occurredAt: this.runtime.now(),
      };
      await this.finishRun({ sessionId: session.id, runId: run.id, events: [failure], status: "failed" });
      return [failure];
    }
    const assembled = this.contextAssembler.assemble(snapshot, session.userId, session.id, {
      providerKind: provider.kind,
      ...(provider.model ? { providerModel: provider.model } : {}),
      requestPurpose: `coach.${session.context.kind}.resume`,
      assembledAt: this.runtime.now(),
    });
    if (provider.usesNetwork) this.remoteProviderRequests += 1;
    const retryAudit = auditRecord(this.runtime, {
      userId: session.userId,
      sessionId: session.id,
      runId: run.id,
      toolCallId: run.resume.toolCallId,
      phase: "retry",
      outcome: "started",
      metadata: { continuation: true, provider: provider.kind },
    });
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: "agent_runtime",
      intent: "coach_run.retry_continuation",
      expectedRevisions: [],
      domainEvents: [],
      toolAudit: [retryAudit],
      idempotencyKey: `retry:${run.id}:${retryAudit.id}`,
      recordedAt: retryAudit.occurredAt,
    });
    const controller = new AbortController();
    this.activeProviderRuns.set(run.id, controller);
    try {
      return await this.consumeProviderStream({
        session,
        runId: run.id,
        provider,
        stream: provider.resume({
          sessionId: session.id,
          runId: run.id,
          userText: "",
          ...assembled,
          toolManifest: resolveCoachCapabilities({ snapshot, userId: session.userId, tools: this.tools }),
          modelInput: buildLocalAgentModelInput({
            userText: "",
            context: assembled.context,
            contextManifest: assembled.contextManifest,
            continuation: run.resume,
          }),
          signal: controller.signal,
          continuation: run.resume,
        }),
        abortController: controller,
      });
    } catch (error) {
      return this.persistProviderFailure(session, run.id, error, "retryable");
    } finally {
      if (this.activeProviderRuns.get(run.id) === controller) this.activeProviderRuns.delete(run.id);
    }
  }

  async terminate(runId: string, terminalCode = "user_terminated"): Promise<void> {
    const snapshot = await this.ledger.read();
    const run = snapshot.runs.find((candidate) => candidate.id === runId);
    if (!run || ["completed", "terminated", "failed"].includes(run.status)) return;
    this.activeProviderRuns.get(runId)?.abort();
    this.activeProviderRuns.delete(runId);
    const now = this.runtime.now();
    await this.ledger.commit({
      kind: "domain",
      userId: run.userId,
      actorId: run.userId,
      intent: "coach_run.terminate",
      expectedRevisions: [],
      domainEvents: [],
      runs: [{ ...run, status: "terminated", terminalCode, updatedAt: now }],
      idempotencyKey: `terminate:${run.id}`,
      recordedAt: now,
    });
  }

  private async resolveProvider(
    session: CoachSession,
    prior?: CoachRunRecord["provider"],
  ): Promise<LLMProvider | undefined> {
    if (!this.providerResolver) return this.provider;
    return this.providerResolver.resolve({
      userId: session.userId,
      sessionId: session.id,
      ...(prior ? {
        prior: {
          kind: prior.kind,
          ...(prior.configurationFingerprint ? { configurationFingerprint: prior.configurationFingerprint } : {}),
        },
      } : {}),
    });
  }

  private async finishLocalOnlyRun(
    session: CoachSession,
    runId: string,
    occurredAt: string,
    message: string,
  ): Promise<readonly CoachRunEvent[]> {
    const events: CoachRunEvent[] = [
      { type: "text-delta", sessionId: session.id, runId, delta: message, occurredAt },
      { type: "run-completed", sessionId: session.id, runId, occurredAt },
    ];
    await this.finishRun({ sessionId: session.id, runId, events, text: message });
    return events;
  }

  private async consumeProviderStream(input: {
    session: CoachSession;
    runId: string;
    provider: LLMProvider;
    stream: AsyncIterable<ProviderEvent>;
    abortController: AbortController;
  }): Promise<readonly CoachRunEvent[]> {
    const events: CoachRunEvent[] = [];
    let text = "";
    let suspended = false;
    let stream = input.stream;
    let continuationCount = 0;
    let terminal = false;
    while (!suspended && !terminal) {
      const iterator = stream[Symbol.asyncIterator]();
      let toolContinuation: Extract<LLMProviderResumeRequest["continuation"], { toolName: string }> | undefined;
      try {
        while (true) {
          const next = await nextProviderEvent(iterator, input.abortController, this.providerIdleTimeoutMs);
          if (next.done) {
            terminal = true;
            break;
          }
          const providerEvent = next.value;
          // The timeout/cancel boundary is authoritative. A provider adapter
          // which races a late event after AbortSignal must not reach a tool,
          // Artifact or domain-adjacent commit.
          if (input.abortController.signal.aborted) return events;
          if (providerEvent.type === "text-delta") {
            text += providerEvent.delta;
            events.push({
              type: "text-delta",
              sessionId: input.session.id,
              runId: input.runId,
              delta: providerEvent.delta,
              occurredAt: this.runtime.now(),
            });
            continue;
          }
          if (providerEvent.type === "tool-input-delta") {
            events.push(await this.persistToolInputStreaming(input.session, input.runId, providerEvent));
            continue;
          }
          if (providerEvent.type === "cancelled") {
            if (providerEvent.reason === "user") {
              await this.terminate(input.runId);
              return events;
            }
            if (providerEvent.reason === "timeout") {
              throw new ProviderTimeoutError(this.providerIdleTimeoutMs);
            }
            throw new ProviderStreamCancelledError(providerEvent.reason);
          }
          if (providerEvent.type === "completed") {
            terminal = true;
            break;
          }
          const toolEvents = await this.handleToolCall(input.session, input.runId, providerEvent);
          events.push(...toolEvents.events);
          if (toolEvents.suspended) {
            suspended = true;
            break;
          }
          if (toolEvents.continuation) {
            toolContinuation = toolEvents.continuation;
            // Calls are intentionally serial. The next model turn sees the
            // authoritative result before it can select another capability.
            break;
          }
        }
      } finally {
        if (input.abortController.signal.aborted || toolContinuation) {
          // Do not await an uncooperative adapter here: the run has already
          // reached a terminal local state and it must not keep the UI blocked.
          void Promise.resolve(iterator.return?.()).catch(() => undefined);
        }
      }
      if (!toolContinuation) continue;
      continuationCount += 1;
      if (continuationCount > MAX_TOOL_RESULT_CONTINUATIONS) {
        events.push({
          type: "run-error",
          sessionId: input.session.id,
          runId: input.runId,
          code: "terminal_failure",
          message: "Agent 工具调用超过本轮上限",
          shortCode: traceShortCode({ traceId: input.runId, sessionId: input.session.id }),
          occurredAt: this.runtime.now(),
        });
        terminal = true;
        break;
      }
      stream = await this.resumeAfterToolResult({
        session: input.session,
        runId: input.runId,
        provider: input.provider,
        abortController: input.abortController,
        continuation: toolContinuation,
        continuationCount,
      });
    }
    if (input.abortController.signal.aborted) return events;
    const locallyPersistedTypes = new Set(["tool-started", "artifact-ready", "hitl-suspended"]);
    await this.finishRun({
      sessionId: input.session.id,
      runId: input.runId,
      events: events.filter((event) => !locallyPersistedTypes.has(event.type)),
      text,
      status: suspended ? "suspended" : undefined,
    });
    return events;
  }

  private async resumeAfterToolResult(input: {
    session: CoachSession;
    runId: string;
    provider: LLMProvider;
    abortController: AbortController;
    continuation: Extract<LLMProviderResumeRequest["continuation"], { toolName: string }>;
    continuationCount: number;
  }): Promise<AsyncIterable<ProviderEvent>> {
    if (!input.provider.resume) {
      throw new Error("provider_tool_result_continuation_unsupported");
    }
    const snapshot = await this.ledger.read();
    const assembled = this.contextAssembler.assemble(snapshot, input.session.userId, input.session.id, {
      providerKind: input.provider.kind,
      ...(input.provider.model ? { providerModel: input.provider.model } : {}),
      requestPurpose: `coach.${input.session.context.kind}.tool_result`,
      assembledAt: this.runtime.now(),
    });
    if (input.provider.usesNetwork) this.remoteProviderRequests += 1;
    const audit = auditRecord(this.runtime, {
      userId: input.session.userId,
      sessionId: input.session.id,
      runId: input.runId,
      toolCallId: input.continuation.toolCallId,
      toolName: input.continuation.toolName,
      phase: "provider_request",
      outcome: "started",
      metadata: {
        continuation: "tool_result",
        continuationCount: input.continuationCount,
        provider: input.provider.kind,
      },
    });
    await this.ledger.commit({
      kind: "domain",
      userId: input.session.userId,
      actorId: "agent_runtime",
      intent: "coach_run.tool_result_continuation",
      expectedRevisions: [],
      domainEvents: [],
      toolAudit: [audit],
      idempotencyKey: `tool-result-continuation:${input.runId}:${input.continuation.toolCallId}:${input.continuationCount}`,
      recordedAt: audit.occurredAt,
    });
    const request: LLMProviderResumeRequest = {
      sessionId: input.session.id,
      runId: input.runId,
      userText: "",
      ...assembled,
      toolManifest: resolveCoachCapabilities({ snapshot, userId: input.session.userId, tools: this.tools }),
      modelInput: buildLocalAgentModelInput({
        userText: "",
        context: assembled.context,
        contextManifest: assembled.contextManifest,
        continuation: input.continuation,
      }),
      signal: input.abortController.signal,
      continuation: input.continuation,
    };
    return input.provider.resume(request);
  }

  private async persistToolInputStreaming(
    session: CoachSession,
    runId: string,
    delta: Extract<ProviderEvent, { type: "tool-input-delta" }>,
  ): Promise<CoachRunEvent> {
    const event: CoachRunEvent = {
      type: "tool-state",
      sessionId: session.id,
      runId,
      toolCallId: delta.toolCallId,
      toolName: delta.toolName,
      state: "input-streaming",
      occurredAt: this.runtime.now(),
    };
    const snapshot = await this.ledger.read();
    const currentSession = snapshot.sessions.find((candidate) => candidate.id === session.id);
    if (!currentSession) throw new Error(`CoachSession not found: ${session.id}`);
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: "agent_runtime",
      intent: "tool.input_streaming",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: currentSession.id, revision: currentSession.revision ?? 1 }],
      domainEvents: [],
      sessions: [{
        ...currentSession,
        revision: (currentSession.revision ?? 1) + 1,
        updatedAt: this.runtime.now(),
      }],
      runEvents: [event],
      toolAudit: [
        auditRecord(this.runtime, {
          userId: session.userId,
          sessionId: session.id,
          runId,
          toolCallId: delta.toolCallId,
          toolName: delta.toolName,
          phase: "schema_validation",
          outcome: "started",
          metadata: { streamedInputBytes: delta.delta.length },
        }),
      ],
      idempotencyKey: `tool:streaming:${runId}:${delta.toolCallId}:${stableHash(delta.delta)}`,
      recordedAt: event.occurredAt,
    });
    return event;
  }

  private async handleToolCall(
    session: CoachSession,
    runId: string,
    call: CoachToolCall,
  ): Promise<{
    events: readonly CoachRunEvent[];
    suspended: boolean;
    continuation?: Extract<LLMProviderResumeRequest["continuation"], { toolName: string }>;
  }> {
    const snapshot = await this.ledger.read();
    const existing = snapshot.toolCalls.find((candidate) => candidate.id === call.toolCallId);
    if (existing?.runId === runId && existing.status === "output_available") {
      return {
        events: snapshot.runEvents.filter(
          (event) =>
            event.runId === runId &&
            "toolCallId" in event &&
            event.toolCallId === call.toolCallId,
        ),
        suspended: false,
        continuation: existing.artifactRef
          ? this.artifactToolContinuation(snapshot, call, existing.artifactRef)
          : undefined,
      };
    }
    if (existing && existing.runId !== runId) throw new Error("tool_call_identity_conflict");
    const now = this.runtime.now();
    const record: CoachToolCallRecord = {
      id: call.toolCallId,
      sessionId: session.id,
      runId,
      userId: session.userId,
      toolName: call.toolName,
      inputSchemaVersion: 1,
      inputHash: stableHash(call.input),
      status: "input_available",
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
    };
    const inputEvent: CoachRunEvent = {
      type: "tool-state",
      sessionId: session.id,
      runId,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      state: "input-available",
      occurredAt: now,
    };
    await this.recordBehaviorDecision({
      session,
      runId,
      boundary: "tool_selection",
      outcome: "accepted",
      reasonCodes: ["tool_selected"],
      inputRefs: [`tool:${call.toolName}`],
      causationIds: [`tool_call:${call.toolCallId}`],
      artifactRefs: [],
      expectedSignal: "none",
    });
    await this.persistToolState(session, record, inputEvent, "schema_validation", "passed");

    if (call.toolName === "ui.request_choice") {
      if (!this.humanActions) throw new Error("HumanActionCoordinator is not configured");
      const parsed = parseHumanChoice(call.input);
      const suspended = await this.humanActions.suspend({
        sessionId: session.id,
        runId,
        toolCallId: call.toolCallId,
        kind: "choose_option",
        ...parsed,
      });
      return { events: [inputEvent, suspended.event], suspended: true };
    }

    if (!this.tools) {
      return this.persistToolError(session, record, inputEvent, "unregistered_tool");
    }
    // A provider may only call a capability that was assembled from the
    // current local fact frontier and permissions. The manifest is not
    // descriptive prompt metadata: it is an authority boundary that is
    // rechecked immediately before every execution.
    const currentlyVisible = resolveCoachCapabilities({
      snapshot,
      userId: session.userId,
      tools: this.tools,
    }).some((tool) => tool.name === call.toolName);
    if (!currentlyVisible) {
      await this.recordBehaviorDecision({
        session,
        runId,
        boundary: "tool_validation",
        outcome: "rejected",
        reasonCodes: ["capability_hidden_by_mandate"],
        inputRefs: [`tool:${call.toolName}`],
        causationIds: [`tool_call:${call.toolCallId}`],
        expectedSignal: "none",
      });
      return this.persistToolError(session, record, inputEvent, "capability_not_available");
    }
    try {
      const toolEvents = await this.tools.invoke({ sessionId: session.id, runId, call });
      const artifactEvent = toolEvents.find((event) => event.type === "artifact-ready");
      const outputRecord: CoachToolCallRecord = {
        ...record,
        status: "output_available",
        ...(artifactEvent?.type === "artifact-ready" ? { artifactRef: artifactEvent.artifactRef } : {}),
        updatedAt: this.runtime.now(),
      };
      const outputEvent: CoachRunEvent = {
        type: "tool-state",
        sessionId: session.id,
        runId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        state: "output-available",
        occurredAt: this.runtime.now(),
      };
      await this.persistToolState(session, outputRecord, outputEvent, "tool_execution", "passed", toolEvents);
      await this.recordBehaviorDecision({
        session,
        runId,
        boundary: "tool_validation",
        outcome: "accepted",
        reasonCodes: ["tool_schema_valid", "tool_policy_allowed"],
        inputRefs: [`tool:${call.toolName}`],
        causationIds: [`tool_call:${call.toolCallId}`],
        artifactRefs: artifactEvent?.type === "artifact-ready" ? [artifactEvent.artifactRef.id] : [],
        expectedSignal: artifactEvent ? "timeline_change" : "none",
      });
      const continuation = artifactEvent?.type === "artifact-ready"
        ? this.artifactToolContinuation(
            await this.ledger.read(),
            call,
            artifactEvent.artifactRef,
            artifactEvent.presentation,
          )
        : undefined;
      return { events: [inputEvent, ...toolEvents, outputEvent], suspended: false, ...(continuation ? { continuation } : {}) };
    } catch (error) {
      await this.recordBehaviorDecision({
        session,
        runId,
        boundary: "tool_validation",
        outcome: "rejected",
        reasonCodes: ["tool_schema_invalid"],
        inputRefs: [`tool:${call.toolName}`],
        causationIds: [`tool_call:${call.toolCallId}`],
        expectedSignal: "none",
      });
      return this.persistToolError(
        session,
        record,
        inputEvent,
        error instanceof Error ? error.message : "invalid_tool_call",
      );
    }
  }

  private async recordBehaviorDecision(input: {
    session: CoachSession;
    runId: string;
    boundary: BehaviorDecisionBoundary;
    outcome: BehaviorDecisionOutcome;
    reasonCodes: readonly BehaviorDecisionReasonCode[];
    causationIds: readonly string[];
    inputRefs: readonly string[];
    artifactRefs?: readonly string[];
    expectedSignal: "none" | "timeline_change" | "user_confirmation" | "user_rejection" | "execution_observed" | "measurement_observed" | "notification_delivery";
  }): Promise<void> {
    if (!this.behaviorDecisionRecorder) return;
    try {
      await this.behaviorDecisionRecorder.record(buildBehaviorDecisionRecord({
        traceId: input.runId,
        sessionId: input.session.id || BACKGROUND_TRACE_SESSION_ID,
        occurredAt: this.runtime.now(),
        actor: "agent_runtime",
        userPseudonym: traceUserPseudonym(input.session.userId, stableHash),
        deviceId: "local-device",
        boundary: input.boundary,
        outcome: input.outcome,
        causationIds: input.causationIds,
        factFrontier: [],
        versionPins: {},
        inputRefs: input.inputRefs,
        ...(input.artifactRefs?.length ? { artifactRefs: input.artifactRefs } : {}),
        reasonCodes: input.reasonCodes,
        expectedSignal: input.expectedSignal,
      }), { userId: input.session.userId });
    } catch {
      // An audit sink cannot block a user-visible action or an explicit rejection.
    }
  }

  private artifactToolContinuation(
    snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
    call: CoachToolCall,
    artifactRef: NonNullable<CoachToolCallRecord["artifactRef"]>,
    presentation = snapshot.presentations.find((item) => item.artifactId === artifactRef.id),
  ): Extract<LLMProviderResumeRequest["continuation"], { toolName: string }> | undefined {
    if (!presentation) return undefined;
    return {
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      output: {
        kind: "artifact_ref",
        artifactRef,
        presentation: {
          id: presentation.id,
          artifactId: presentation.artifactId,
          renderer: presentation.renderer,
          status: presentation.status,
        },
      },
    };
  }

  private async persistToolState(
    session: CoachSession,
    record: CoachToolCallRecord,
    event: CoachRunEvent,
    phase: ToolAuditRecord["phase"],
    outcome: ToolAuditRecord["outcome"],
    sourceEvents: readonly CoachRunEvent[] = [],
  ): Promise<void> {
    const snapshot = await this.ledger.read();
    const currentSession = snapshot.sessions.find((candidate) => candidate.id === session.id);
    if (!currentSession) throw new Error(`CoachSession not found: ${session.id}`);
    const artifacts = sourceEvents.flatMap((item) =>
      item.type === "artifact-ready" ? [item.artifactRef.id] : [],
    );
    const presentations = sourceEvents.flatMap((item) =>
      item.type === "artifact-ready" ? [item.presentation.id] : [],
    );
    const updatedSession = {
      ...currentSession,
      revision: (currentSession.revision ?? 1) + 1,
      toolCallIds: [...new Set([...(currentSession.toolCallIds ?? []), record.id])],
      artifactIds: [...new Set([...(currentSession.artifactIds ?? []), ...artifacts])],
      presentationIds: [...new Set([...(currentSession.presentationIds ?? []), ...presentations])],
      updatedAt: this.runtime.now(),
    };
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: "agent_runtime",
      intent: `tool.${phase}`,
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: currentSession.id, revision: currentSession.revision ?? 1 }],
      domainEvents: [],
      sessions: [updatedSession],
      toolCalls: [record],
      runEvents: [event],
      toolAudit: [
        auditRecord(this.runtime, {
          userId: session.userId,
          sessionId: session.id,
          runId: record.runId,
          toolCallId: record.id,
          toolName: record.toolName,
          phase,
          outcome,
          metadata: { inputHash: record.inputHash, inputSchemaVersion: record.inputSchemaVersion },
        }),
      ],
      idempotencyKey: `${record.runId}:${record.id}:${record.status}`,
      recordedAt: this.runtime.now(),
    });
  }

  private async persistToolError(
    session: CoachSession,
    record: CoachToolCallRecord,
    inputEvent: CoachRunEvent,
    code: string,
  ): Promise<{ events: readonly CoachRunEvent[]; suspended: false }> {
    const errorEvent: CoachRunEvent = {
      type: "tool-state",
      sessionId: session.id,
      runId: record.runId,
      toolCallId: record.id,
      toolName: record.toolName,
      state: "output-error",
      errorCode: code,
      occurredAt: this.runtime.now(),
    };
    await this.persistToolState(
      session,
      { ...record, status: "output_error", updatedAt: this.runtime.now() },
      errorEvent,
      "internal_error",
      "failed",
    );
    const runError: CoachRunEvent = {
      type: "run-error",
      sessionId: session.id,
      runId: record.runId,
      code: "invalid_tool_call",
      message: code,
      shortCode: traceShortCode({ traceId: record.runId, sessionId: session.id }),
      occurredAt: this.runtime.now(),
    };
    return { events: [inputEvent, errorEvent, runError], suspended: false };
  }

  private async finishRun(input: {
    sessionId: string;
    runId: string;
    events: readonly CoachRunEvent[];
    text?: string;
    status?: CoachRunRecord["status"];
    terminalCode?: string;
    additionalToolAudit?: ToolAuditRecord;
  }): Promise<void> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    const run = snapshot.runs.find((candidate) => candidate.id === input.runId);
    if (!session || !run) return;
    if (["completed", "terminated", "failed"].includes(run.status)) return;
    const now = this.runtime.now();
    const terminalStatus =
      input.status ??
      (input.events.some((event) => event.type === "run-error") ? "failed" : "completed");
    // 输出过滤器（ticket 09）：禁止声称在落账前被拦截替换，拦截事件落审计。
    const filtered = input.text
      ? filterCoachOutput(input.text, this.outputFilterRules)
      : undefined;
    const assistantMessage: CoachMessage | undefined = filtered
      ? {
          id: this.runtime.nextId("message"),
          sessionId: session.id,
          userId: session.userId,
          role: "assistant",
          content: filtered.text,
          runId: run.id,
          createdAt: now,
        }
      : undefined;
    const filterAudit: ToolAuditRecord | undefined = filtered?.intercepted
      ? auditRecord(this.runtime, {
          userId: session.userId,
          sessionId: session.id,
          runId: run.id,
          phase: "policy_decision",
          outcome: "rejected",
          metadata: { outputFilter: "forbidden_claim", matchedRuleIds: filtered.matchedRuleIds.join(",") },
        })
      : undefined;
    const updatedSession = {
      ...session,
      revision: (session.revision ?? 1) + 1,
      ...(terminalStatus === "suspended" ? { status: "suspended" as const } : {}),
      messageIds: [
        ...new Set([...(session.messageIds ?? []), ...(assistantMessage ? [assistantMessage.id] : [])]),
      ],
      updatedAt: now,
    };
    const audit = auditRecord(this.runtime, {
      userId: session.userId,
      sessionId: session.id,
      runId: run.id,
      phase: "provider_response",
      outcome: terminalStatus === "failed" ? "failed" : "passed",
      metadata: { terminalStatus, eventCount: input.events.length },
    });
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: "agent_runtime",
      intent: "coach_run.finish",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      domainEvents: [],
      sessions: [updatedSession],
      ...(assistantMessage ? { messages: [assistantMessage] } : {}),
      runs: [{
        ...run,
        status: terminalStatus,
        ...(input.terminalCode ? { terminalCode: input.terminalCode } : {}),
        updatedAt: now,
      }],
      runEvents: input.events,
      toolAudit: [
        ...(input.additionalToolAudit ? [input.additionalToolAudit] : []),
        ...(filterAudit ? [filterAudit] : []),
        audit,
      ],
      idempotencyKey: `finish:${run.id}:${terminalStatus}:${stableHash(input.events)}`,
      recordedAt: now,
    });
  }

  private async persistProviderFailure(
    session: CoachSession,
    runId: string,
    error: unknown,
    code: "provider_error" | "retryable" = "provider_error",
  ): Promise<readonly CoachRunEvent[]> {
    const existing = (await this.ledger.read()).runs.find((run) => run.id === runId);
    if (existing?.status === "terminated") return [];
    const failure = providerFailureDetails(error);
    const events: CoachRunEvent[] = [
      {
        type: "run-error",
        sessionId: session.id,
        runId,
        code,
        message: failure.message,
        shortCode: traceShortCode({ traceId: runId, sessionId: session.id }),
        occurredAt: this.runtime.now(),
      },
      {
        type: "text-delta",
        sessionId: session.id,
        runId,
        delta: failure.userMessage,
        occurredAt: this.runtime.now(),
      },
    ];
    const failureAudit = auditRecord(this.runtime, {
      userId: session.userId,
      sessionId: session.id,
      runId,
      phase: "internal_error",
      outcome: code === "retryable" ? "retryable" : "failed",
      metadata: {
        failureCode: failure.terminalCode,
        retryable: code === "retryable",
        ...(failure.idleTimeoutMs !== undefined ? { idleTimeoutMs: failure.idleTimeoutMs } : {}),
      },
    });
    await this.finishRun({
      sessionId: session.id,
      runId,
      events,
      text: events[1].type === "text-delta" ? events[1].delta : "",
      status: code === "retryable" ? "resuming" : "failed",
      ...(code === "retryable" ? {} : { terminalCode: failure.terminalCode }),
      additionalToolAudit: failureAudit,
    });
    return events;
  }
}

function providerIdleTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PROVIDER_IDLE_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("invalid_provider_idle_timeout");
  }
  return value;
}

async function nextProviderEvent(
  iterator: AsyncIterator<ProviderEvent>,
  abortController: AbortController,
  idleTimeoutMs: number,
): Promise<IteratorResult<ProviderEvent>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let removeAbortListener: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => iterator.next()),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          abortController.abort();
          reject(new ProviderTimeoutError(idleTimeoutMs));
        }, idleTimeoutMs);
      }),
      new Promise<IteratorResult<ProviderEvent>>((resolve) => {
        const onAbort = () => {
          if (!timedOut) resolve({ done: true, value: undefined });
        };
        if (abortController.signal.aborted) {
          onAbort();
          return;
        }
        abortController.signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => abortController.signal.removeEventListener("abort", onAbort);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeAbortListener?.();
  }
}

function providerFailureDetails(error: unknown): {
  terminalCode: "provider_timeout" | "provider_transport_cancelled" | "provider_error";
  message: string;
  userMessage: string;
  idleTimeoutMs?: number;
} {
  if (error instanceof ProviderServiceError) {
    const userMessage: Record<typeof error.code, string> = {
      allowance_exhausted: "云端 AI 额度已用完，暂时无法继续使用 Agent。",
      authentication_required: "登录状态已失效，请重新登录后继续使用 Agent。",
      permission_denied: "当前账号暂时无法使用云端 AI 服务。",
      service_unavailable: "云端 AI 服务暂时不可用，请稍后重试。",
      request_conflict: "本次 Agent 请求状态冲突，请重新发起。",
      request_failed: "云端 AI 请求未被接受，请重新发起。",
      account_switched: "账号已切换，本次 Agent 请求已停止。",
      consent_required: "请先允许云端 AI 处理本次 Agent 请求。",
    };
    return {
      terminalCode: "provider_error",
      message: error.message,
      userMessage: userMessage[error.code],
    };
  }
  if (error instanceof ProviderTimeoutError) {
    return {
      terminalCode: "provider_timeout",
      message: "语言模型响应超时；本地计划仍可用。",
      userMessage: "云端 AI 响应超时，请稍后重试。",
      idleTimeoutMs: error.idleTimeoutMs,
    };
  }
  if (error instanceof ProviderStreamCancelledError) {
    return {
      terminalCode: "provider_transport_cancelled",
      message: "语言模型连接已中断；本地计划仍可用。",
      userMessage: "云端 AI 连接已中断，请重新发起。",
    };
  }
  return {
    terminalCode: "provider_error",
    message: error instanceof Error ? error.message : "Provider unavailable",
    userMessage: "云端 AI 服务暂时不可用，请稍后重试。",
  };
}

function parseHumanChoice(input: unknown): {
  prompt: string;
  options: readonly { id: string; label: string }[];
  risk: "low" | "review" | "high";
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_hitl_input");
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["prompt", "options", "risk"].includes(key)) ||
    typeof record.prompt !== "string" ||
    !Array.isArray(record.options) ||
    !["low", "review", "high"].includes(String(record.risk ?? "review"))
  ) {
    throw new Error("invalid_hitl_input");
  }
  const options = record.options.map((option) => {
    if (
      !option ||
      typeof option !== "object" ||
      typeof (option as Record<string, unknown>).id !== "string" ||
      typeof (option as Record<string, unknown>).label !== "string"
    ) {
      throw new Error("invalid_hitl_input");
    }
    return {
      id: (option as Record<string, string>).id,
      label: (option as Record<string, string>).label,
    };
  });
  return {
    prompt: record.prompt,
    options,
    risk: String(record.risk ?? "review") as "low" | "review" | "high",
  };
}

function manifestFactRefs(refs: readonly string[]): CoachRunRecord["factFrontier"] {
  return refs.flatMap((value) => {
    const parts = value.split(":");
    const aggregate = parts.shift();
    const revision = parts.pop();
    const id = parts.join(":");
    if (!aggregate || !id || !revision || !Number.isInteger(Number(revision))) return [];
    const normalized = aggregate === "profile" || aggregate === "plan" || aggregate === "timeline" ||
      aggregate === "workout" || aggregate === "memory" || aggregate === "mandate" ||
      aggregate === "safety" || aggregate === "recovery" || aggregate === "nutrition" ||
      aggregate === "equipment" || aggregate === "capability" || aggregate === "goal" ||
      aggregate === "permission" || aggregate === "exercise"
      ? aggregate
      : undefined;
    return normalized ? [{ aggregate: normalized, id, revision: Number(revision) }] : [];
  });
}

function auditRecord(
  runtime: RuntimeServices,
  input: {
    userId: string;
    sessionId: string;
    runId: string;
    toolCallId?: string;
    toolName?: string;
    phase: ToolAuditRecord["phase"];
    outcome: ToolAuditRecord["outcome"];
    metadata: ToolAuditRecord["metadata"];
  },
): ToolAuditRecord {
  return {
    id: runtime.nextId("tool-audit"),
    userPseudonym: `local-${stableHash({ userId: input.userId })}`,
    sessionId: input.sessionId,
    runId: input.runId,
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.toolName ? { toolName: input.toolName } : {}),
    phase: input.phase,
    outcome: input.outcome,
    metadata: input.metadata,
    occurredAt: runtime.now(),
  };
}
