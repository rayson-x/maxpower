import { projectDomainEvents } from "./domain";
import type { CoachLedger } from "./ledger";
import { LedgerConflictError } from "./ledger";
import type {
  ActionTokenRecord,
  CoachRunEvent,
  FactRef,
  HumanOption,
  PendingHumanAction,
  PresentationRef,
  RuntimeServices,
} from "./model";
import { stableHash } from "./stable";
import type { ActionTokenPrimitive } from "./ports";

export class HumanActionError extends Error {
  constructor(
    readonly code:
      | "pending_action_not_found"
      | "pending_action_consumed"
      | "invalid_resume"
      | "invalid_output"
      | "stale"
      | "expired",
  ) {
    super(code);
    this.name = "HumanActionError";
  }
}

export interface SuspendHumanActionInput {
  sessionId: string;
  kind: "choose_option";
  prompt: string;
  options: readonly HumanOption[];
  runId?: string;
  toolCallId?: string;
  inputSchema?: Readonly<Record<string, unknown>>;
  factFrontier?: readonly FactRef[];
  evidenceRefs?: readonly FactRef[];
  capabilityVersions?: Readonly<Record<string, string>>;
  risk?: "low" | "review" | "high";
  presentationRef?: PresentationRef;
}

export interface ResumeHumanActionInput {
  pendingActionId: string;
  runId: string;
  toolCallId: string;
  resumeToken: string;
  output: { kind: "selected"; optionId: string };
}

export class HumanActionCoordinator {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly tokenPrimitive: ActionTokenPrimitive = {
      issue: (claims) => stableHash(claims),
    },
    private readonly currentCapabilityVersions: () => Readonly<Record<string, string>> = () => ({}),
  ) {}

  async suspend(input: SuspendHumanActionInput): Promise<{
    pending: PendingHumanAction;
    resumeToken: string;
    event: CoachRunEvent;
  }> {
    if (
      input.options.length < 2 ||
      new Set(input.options.map((option) => option.id)).size !== input.options.length
    ) {
      throw new HumanActionError("invalid_output");
    }
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new HumanActionError("pending_action_not_found");
    const frontier = resolveRuntimeFrontier(snapshot, session.userId);
    const now = this.runtime.now();
    const id = this.runtime.nextId("human-action");
    const runId = input.runId ?? this.runtime.nextId("coach-run");
    const toolCallId = input.toolCallId ?? this.runtime.nextId("tool-call");
    const nonce = this.runtime.nextId("nonce");
    const expiresAt = new Date(new Date(now).getTime() + 24 * 60 * 60_000).toISOString();
    const resumeToken = `${nonce}.${this.tokenPrimitive.issue({
      kind: "human_resume",
      action: "resume",
      pendingActionId: id,
      userId: session.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      expectedPlanRevision: frontier.planRevision,
      expectedMandateRevision: frontier.mandateRevision,
      expiresAt,
      nonce,
    })}`;
    const presentationRef = input.presentationRef ?? {
      id: this.runtime.nextId("presentation"),
      artifactId: id,
      renderer: "human-choice/v1",
      status: "awaiting_user",
    };
    const pending: PendingHumanAction = {
      id,
      userId: session.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      kind: input.kind,
      prompt: input.prompt,
      options: input.options,
      inputSchema: input.inputSchema ?? {
        type: "object",
        required: ["kind", "optionId"],
        properties: {
          kind: { const: "selected" },
          optionId: { enum: input.options.map((option) => option.id) },
        },
      },
      allowedChoices: input.options.map((option) => option.id),
      factFrontier: input.factFrontier ?? frontier.factRefs,
      evidenceRefs: input.evidenceRefs ?? [],
      capabilityVersions: input.capabilityVersions ?? this.currentCapabilityVersions(),
      risk: input.risk ?? "review",
      presentationRef,
      expectedPlanRevision: frontier.planRevision,
      expectedMandateRevision: frontier.mandateRevision,
      resumeToken,
      status: "pending",
      createdAt: now,
      expiresAt,
    };
    const token: ActionTokenRecord = {
      token: resumeToken,
      userId: session.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      artifactId: id,
      artifactHash: stableHash({
        prompt: pending.prompt,
        options: pending.options,
        inputSchema: pending.inputSchema,
      }),
      artifactSchemaVersion: 1,
      action: "resume",
      pendingActionId: id,
      expectedPlanRevision: frontier.planRevision,
      expectedMandateRevision: frontier.mandateRevision,
      expiresAt,
      nonce,
    };
    const updatedSession = {
      ...session,
      status: "suspended" as const,
      revision: (session.revision ?? 1) + 1,
      pendingHumanActionIds: [...new Set([...(session.pendingHumanActionIds ?? []), id])],
      toolCallIds: [...new Set([...(session.toolCallIds ?? []), toolCallId])],
      presentationIds: [...new Set([...(session.presentationIds ?? []), presentationRef.id])],
      runIds: [...new Set([...(session.runIds ?? []), runId])],
      updatedAt: now,
    };
    const existingRun = snapshot.runs.find((run) => run.id === runId);
    const existingTool = snapshot.toolCalls.find((call) => call.id === toolCallId);
    const event: CoachRunEvent = {
      type: "hitl-suspended",
      sessionId: session.id,
      runId,
      toolCallId,
      pendingActionId: id,
      presentationId: presentationRef.id,
      occurredAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: session.userId,
      actorId: "agent_runtime",
      intent: "hitl.suspend",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      expectedPendingHumanActionStatuses: [{ id, status: "missing" }],
      domainEvents: [],
      sessions: [updatedSession],
      presentations: [presentationRef],
      pendingHumanActions: [pending],
      issueTokens: [token],
      ...(existingRun
        ? { runs: [{ ...existingRun, status: "suspended", updatedAt: now }] }
        : {}),
      ...(existingTool
        ? { toolCalls: [{ ...existingTool, status: "suspended", updatedAt: now }] }
        : {}),
      runEvents: [event],
      idempotencyKey: `suspend:${id}`,
      recordedAt: now,
    });
    return { pending, resumeToken, event };
  }

  async resume(input: ResumeHumanActionInput): Promise<{
    status: "resumed";
    pending: PendingHumanAction;
    output: { kind: "selected"; optionId: string };
    event: CoachRunEvent;
  }> {
    const snapshot = await this.ledger.read();
    const pending = snapshot.pendingHumanActions.find(
      (candidate) => candidate.id === input.pendingActionId,
    );
    if (!pending) throw new HumanActionError("pending_action_not_found");
    if (pending.status !== "pending") throw new HumanActionError("pending_action_consumed");
    const token = snapshot.actionTokens.find((candidate) => candidate.token === input.resumeToken);
    if (
      pending.runId !== input.runId ||
      pending.toolCallId !== input.toolCallId ||
      pending.resumeToken !== input.resumeToken ||
      !token ||
      token.action !== "resume" ||
      token.pendingActionId !== pending.id ||
      token.artifactSchemaVersion !== 1 ||
      token.artifactHash !==
        stableHash({
          prompt: pending.prompt,
          options: pending.options,
          inputSchema: pending.inputSchema,
        }) ||
      token.consumedAt
    ) {
      throw new HumanActionError("invalid_resume");
    }
    if (
      input.output.kind !== "selected" ||
      !pending.options.some((option) => option.id === input.output.optionId)
    ) {
      throw new HumanActionError("invalid_output");
    }
    const now = this.runtime.now();
    const stale =
      isPendingStale(snapshot, pending) ||
      stableHash(pending.capabilityVersions ?? {}) !== stableHash(this.currentCapabilityVersions());
    if (stale || new Date(pending.expiresAt).getTime() < new Date(now).getTime()) {
      const status = stale ? "stale" : "expired";
      await this.ledger.commit({
        kind: "domain",
        userId: pending.userId,
        actorId: pending.userId,
        intent: "hitl.invalidate",
        expectedRevisions: [],
        expectedPendingHumanActionStatuses: [{ id: pending.id, status: "pending" }],
        domainEvents: [],
        pendingHumanActions: [{ ...pending, status }],
        ...(pending.presentationRef
          ? { presentations: [{ ...pending.presentationRef, status: "stale" }] }
          : {}),
        consumeTokens: [token.token],
        idempotencyKey: `invalidate:${pending.id}:${status}`,
        recordedAt: now,
      });
      throw new HumanActionError(stale ? "stale" : "expired");
    }
    const session = snapshot.sessions.find((candidate) => candidate.id === pending.sessionId);
    if (!session) throw new HumanActionError("pending_action_not_found");
    const resolved: PendingHumanAction = {
      ...pending,
      status: "resolved",
      resolvedAt: now,
      output: input.output,
    };
    const sessions = snapshot.sessions
      .filter(
        (candidate) =>
          candidate.id === session.id ||
          (candidate.userId === session.userId && candidate.status === "active"),
      )
      .map((candidate) => ({
        ...candidate,
        status: candidate.id === session.id ? ("active" as const) : ("suspended" as const),
        revision: (candidate.revision ?? 1) + 1,
        updatedAt: now,
      }));
    const run = snapshot.runs.find((candidate) => candidate.id === pending.runId);
    const tool = snapshot.toolCalls.find((candidate) => candidate.id === pending.toolCallId);
    const event: CoachRunEvent = {
      type: "hitl-resumed",
      sessionId: pending.sessionId,
      runId: pending.runId,
      toolCallId: pending.toolCallId,
      pendingActionId: pending.id,
      presentationId: pending.presentationRef?.id ?? `pending:${pending.id}`,
      occurredAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: pending.userId,
      actorId: pending.userId,
      intent: "hitl.resume",
      expectedRevisions: [],
      expectedSessionRevisions: sessions.map((candidate) => ({
        id: candidate.id,
        revision: (candidate.revision ?? 1) - 1,
      })),
      expectedPendingHumanActionStatuses: [{ id: pending.id, status: "pending" }],
      domainEvents: [],
      sessions,
      pendingHumanActions: [resolved],
      consumeTokens: [token.token],
      ...(run
        ? {
            runs: [
              {
                ...run,
                status: "resuming",
                resume: {
                  pendingActionId: pending.id,
                  toolCallId: pending.toolCallId,
                  output: input.output,
                },
                updatedAt: now,
              },
            ],
          }
        : {}),
      ...(tool
        ? { toolCalls: [{ ...tool, status: "output_available", updatedAt: now }] }
        : {}),
      runEvents: [event],
      idempotencyKey: `resume:${pending.id}:${stableHash(input.output)}`,
      recordedAt: now,
    });
    return { status: "resumed", pending: resolved, output: input.output, event };
  }

  async listPending(userId: string): Promise<readonly PendingHumanAction[]> {
    const snapshot = await this.ledger.read();
    return snapshot.pendingHumanActions.filter(
      (pending) => pending.userId === userId && pending.status === "pending",
    );
  }
}

function resolveRuntimeFrontier(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  userId: string,
): { planRevision: number; mandateRevision: number; factRefs: FactRef[] } {
  const legacy = snapshot.users.find((candidate) => candidate.userId === userId);
  const domain = projectDomainEvents(snapshot.domainEvents, { userId });
  const planRevision = domain.plan?.revision ?? legacy?.plan.revision ?? 0;
  const mandateRevision = domain.mandate?.revision ?? legacy?.mandate.revision ?? 0;
  return {
    planRevision,
    mandateRevision,
    factRefs: [
      ...(domain.profile
        ? [{ aggregate: "profile" as const, id: domain.profile.value.id, revision: domain.profile.revision }]
        : legacy
          ? [{ aggregate: "profile" as const, id: userId, revision: legacy.profileRevision }]
          : []),
      ...(domain.plan
        ? [{ aggregate: "plan" as const, id: domain.plan.value.id, revision: domain.plan.revision }]
        : legacy
          ? [{ aggregate: "plan" as const, id: userId, revision: legacy.plan.revision }]
          : []),
      { aggregate: "timeline", id: `timeline:${userId}`, revision: domain.timeline.revision || legacy?.timelineRevision || 0 },
      ...(domain.mandate
        ? [{ aggregate: "mandate" as const, id: domain.mandate.value.id, revision: domain.mandate.revision }]
        : legacy
          ? [{ aggregate: "mandate" as const, id: userId, revision: legacy.mandate.revision }]
          : []),
      ...domain.safetyConstraints.map((item) => ({
        aggregate: "safety" as const,
        id: item.value.id,
        revision: item.revision,
      })),
      ...domain.recoveryConstraints.map((item) => ({
        aggregate: "recovery" as const,
        id: item.value.id,
        revision: item.revision,
      })),
    ],
  };
}

function isPendingStale(
  snapshot: Awaited<ReturnType<CoachLedger["read"]>>,
  pending: PendingHumanAction,
): boolean {
  const frontier = resolveRuntimeFrontier(snapshot, pending.userId);
  if (
    frontier.planRevision !== pending.expectedPlanRevision ||
    frontier.mandateRevision !== pending.expectedMandateRevision
  ) {
    return true;
  }
  return (pending.factFrontier ?? []).some((expected) => {
    const current = frontier.factRefs.find(
      (candidate) => candidate.aggregate === expected.aggregate && candidate.id === expected.id,
    );
    if (expected.aggregate === "memory") {
      return !snapshot.workingMemory.some(
        (item) => item.id === expected.id && item.version === expected.revision && !item.deletedAt,
      );
    }
    return !current || current.revision !== expected.revision;
  });
}
