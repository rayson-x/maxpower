import type { CoachLedger } from "./ledger";
import type { HumanOption, PendingHumanAction, RuntimeServices } from "./model";
import { stableHash } from "./stable";
import type { ActionTokenPrimitive } from "./ports";

export class HumanActionError extends Error {
  constructor(
    readonly code:
      | "pending_action_not_found"
      | "pending_action_consumed"
      | "invalid_resume"
      | "invalid_output"
      | "stale",
  ) {
    super(code);
    this.name = "HumanActionError";
  }
}

export class HumanActionCoordinator {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly tokenPrimitive: ActionTokenPrimitive = {
      issue: (claims) => stableHash(claims),
    },
  ) {}

  async suspend(input: {
    sessionId: string;
    kind: "choose_option";
    prompt: string;
    options: readonly HumanOption[];
    runId?: string;
    toolCallId?: string;
  }): Promise<{ pending: PendingHumanAction; resumeToken: string }> {
    if (input.options.length < 2 || new Set(input.options.map((option) => option.id)).size !== input.options.length) {
      throw new HumanActionError("invalid_output");
    }
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new HumanActionError("pending_action_not_found");
    const user = snapshot.users.find((candidate) => candidate.userId === session.userId);
    if (!user) throw new Error(`User facts not found: ${session.userId}`);
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
      userId: user.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      expiresAt,
      nonce,
    })}`;
    const pending: PendingHumanAction = {
      id,
      userId: user.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      kind: input.kind,
      prompt: input.prompt,
      options: input.options,
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      resumeToken,
      status: "pending",
      createdAt: now,
      expiresAt,
    };
    await this.ledger.replace({
      ...snapshot,
      sessions: [
        ...snapshot.sessions.filter((candidate) => candidate.id !== session.id),
        { ...session, status: "suspended", updatedAt: now },
      ],
      pendingHumanActions: [...snapshot.pendingHumanActions, pending],
    });
    return { pending, resumeToken };
  }

  async resume(input: {
    pendingActionId: string;
    runId: string;
    toolCallId: string;
    resumeToken: string;
    output: { kind: "selected"; optionId: string };
  }): Promise<{ status: "resumed"; output: { kind: "selected"; optionId: string } }> {
    const snapshot = await this.ledger.read();
    const pending = snapshot.pendingHumanActions.find((candidate) => candidate.id === input.pendingActionId);
    if (!pending) throw new HumanActionError("pending_action_not_found");
    if (pending.status !== "pending") throw new HumanActionError("pending_action_consumed");
    if (
      pending.runId !== input.runId ||
      pending.toolCallId !== input.toolCallId ||
      pending.resumeToken !== input.resumeToken
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
    const user = snapshot.users.find((candidate) => candidate.userId === pending.userId);
    const stale =
      !user ||
      user.plan.revision !== pending.expectedPlanRevision ||
      user.mandate.revision !== pending.expectedMandateRevision;
    if (stale || new Date(pending.expiresAt).getTime() < new Date(now).getTime()) {
      const status = stale ? "stale" : "expired";
      await this.ledger.replace({
        ...snapshot,
        pendingHumanActions: [
          ...snapshot.pendingHumanActions.filter((candidate) => candidate.id !== pending.id),
          { ...pending, status },
        ],
      });
      throw new HumanActionError("stale");
    }
    const session = snapshot.sessions.find((candidate) => candidate.id === pending.sessionId);
    if (!session) throw new HumanActionError("pending_action_not_found");
    const resolved: PendingHumanAction = {
      ...pending,
      status: "resolved",
      resolvedAt: now,
      output: input.output,
    };
    await this.ledger.replace({
      ...snapshot,
      sessions: snapshot.sessions.map((candidate) => {
        if (candidate.id === session.id) return { ...session, status: "active", updatedAt: now };
        if (candidate.userId === session.userId && candidate.status === "active") {
          return { ...candidate, status: "suspended", updatedAt: now };
        }
        return candidate;
      }),
      pendingHumanActions: [
        ...snapshot.pendingHumanActions.filter((candidate) => candidate.id !== pending.id),
        resolved,
      ],
    });
    return { status: "resumed", output: input.output };
  }

  async listPending(userId: string): Promise<readonly PendingHumanAction[]> {
    const snapshot = await this.ledger.read();
    return snapshot.pendingHumanActions.filter(
      (pending) => pending.userId === userId && pending.status === "pending",
    );
  }
}
