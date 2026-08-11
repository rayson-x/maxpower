import { ArtifactCardRegistry } from "./cards";
import type { CoachLedger } from "./ledger";
import { LedgerConflictError } from "./ledger";
import type {
  ActionReceiptArtifact,
  ActionTokenRecord,
  ArtifactCardModel,
  CoachSession,
  CoachRunEvent,
  PlanChangeProposalArtifact,
  PlanEditChange,
  PlanTask,
  RuntimeServices,
  ToolExecutionIdentity,
  UserState,
} from "./model";
import { stableHash } from "./stable";
import { PolicyGate } from "./policy";
import type { ActionTokenPrimitive } from "./ports";
import { decidePlanChangeProposal } from "./kernel";
import type { KnowledgeVersionPins } from "../knowledge/model";

export class ActionPolicyError extends Error {
  constructor(
    readonly code:
      | "invalid_change"
      | "safety_hold"
      | "advice_only"
      | "invalid_token"
      | "expired_token"
      | "stale",
  ) {
    super(code);
    this.name = "ActionPolicyError";
  }
}

const CHANGE_FIELDS = ["sets", "reps", "loadKg", "targetRir", "restSeconds"] as const;

function validateTask(task: PlanTask): void {
  if (
    !task.id ||
    !task.name.trim() ||
    !Number.isInteger(task.sets) ||
    task.sets < 1 ||
    task.sets > 20 ||
    !/^\d+(?:-\d+)?$/.test(task.reps)
  ) {
    throw new ActionPolicyError("invalid_change");
  }
}

function validateChange(change: PlanEditChange): void {
  if (change.kind === "add_task") {
    validateTask(change.task);
    if (change.index !== undefined && (!Number.isInteger(change.index) || change.index < 0)) {
      throw new ActionPolicyError("invalid_change");
    }
    return;
  }
  if (change.kind === "remove_task") {
    if (!change.taskId) throw new ActionPolicyError("invalid_change");
    return;
  }
  if (change.kind === "replace_task") {
    if (!change.taskId || typeof change.preserveStimulusIntent !== "boolean") {
      throw new ActionPolicyError("invalid_change");
    }
    validateTask(change.replacement);
    return;
  }
  if (change.kind === "reorder_task") {
    if (!change.taskId || !Number.isInteger(change.toIndex) || change.toIndex < 0) {
      throw new ActionPolicyError("invalid_change");
    }
    return;
  }
  const allowedKeys = new Set(["kind", "taskId", ...CHANGE_FIELDS]);
  allowedKeys.add("scope");
  if (
    change.kind !== "adjust_task" ||
    Object.keys(change).some((key) => !allowedKeys.has(key)) ||
    !change.taskId ||
    !CHANGE_FIELDS.some((field) => change[field] !== undefined)
  ) {
    throw new ActionPolicyError("invalid_change");
  }
  if (change.sets !== undefined && (!Number.isInteger(change.sets) || change.sets < 1 || change.sets > 20)) {
    throw new ActionPolicyError("invalid_change");
  }
  if (change.loadKg !== undefined && (!Number.isFinite(change.loadKg) || change.loadKg < 0 || change.loadKg > 1000)) {
    throw new ActionPolicyError("invalid_change");
  }
  if (change.targetRir !== undefined && (!Number.isInteger(change.targetRir) || change.targetRir < 0 || change.targetRir > 10)) {
    throw new ActionPolicyError("invalid_change");
  }
  if (change.restSeconds !== undefined && (!Number.isInteger(change.restSeconds) || change.restSeconds < 0 || change.restSeconds > 3600)) {
    throw new ActionPolicyError("invalid_change");
  }
  if (change.reps !== undefined && !/^\d+(?:-\d+)?$/.test(change.reps)) {
    throw new ActionPolicyError("invalid_change");
  }
}

function selectValues(task: PlanTask, change: Extract<PlanEditChange, { kind: "adjust_task" }>): Record<string, string | number | undefined> {
  return Object.fromEntries(
    CHANGE_FIELDS.filter((field) => change[field] !== undefined).map((field) => [field, task[field]]),
  );
}

function changedValues(change: Extract<PlanEditChange, { kind: "adjust_task" }>): Record<string, string | number | undefined> {
  return Object.fromEntries(
    CHANGE_FIELDS.filter((field) => change[field] !== undefined).map((field) => [field, change[field]]),
  );
}

function applyTaskChange(user: UserState, change: PlanEditChange, reason: string): UserState["plan"] {
  const tasks = [...user.plan.tasks];
  if (change.kind === "add_task") {
    const index = Math.min(change.index ?? tasks.length, tasks.length);
    tasks.splice(index, 0, change.task);
  } else {
    const index = tasks.findIndex((task) => task.id === change.taskId);
    if (index < 0) throw new ActionPolicyError("invalid_change");
    if (change.kind === "remove_task") tasks.splice(index, 1);
    else if (change.kind === "replace_task") tasks.splice(index, 1, change.replacement);
    else if (change.kind === "reorder_task") {
      const [task] = tasks.splice(index, 1);
      tasks.splice(Math.min(change.toIndex, tasks.length), 0, task!);
    } else {
      tasks[index] = { ...tasks[index]!, ...changedValues(change) };
    }
  }
  return {
    ...user.plan,
    revision: user.plan.revision + 1,
    previousRevision: user.plan.revision,
    reason,
    tasks,
  };
}

function actionRuleVersions(proposal: PlanChangeProposalArtifact): Record<string, string> {
  const pins = proposal.knowledgePins;
  if (!pins) return {};
  return {
    knowledgePack: pins.knowledgePack.contentHash,
    exerciseCatalog: pins.exerciseCatalog.contentHash,
    ...Object.fromEntries(pins.rulePacks.map((pin) => [`rulePack:${pin.id}`, pin.contentHash])),
  };
}

function sessionWithArtifactRefs(
  session: CoachSession,
  artifactId: string,
  presentationId: string,
  updatedAt: string,
): CoachSession {
  return {
    ...session,
    revision: (session.revision ?? 1) + 1,
    artifactIds: [...new Set([...(session.artifactIds ?? []), artifactId])],
    presentationIds: [...new Set([...(session.presentationIds ?? []), presentationId])],
    updatedAt,
  };
}

function sanitizeActionLogText(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
    .replace(/\b1\d{10}\b/g, "[redacted-phone]")
    .replace(/(?:姓名|地址|住址)[:：]\s*[^，。；;]+/g, "[redacted-direct-identity]");
}

export interface ProposePlanChangeInput {
  sessionId: string;
  change: PlanEditChange;
  reason: string;
  /** Active/completed tasks are frozen; only future work may be edited in-session. */
  protectedTaskIds?: readonly string[];
}

export interface PlanChangeProposalResult {
  artifact: PlanChangeProposalArtifact;
  card: ArtifactCardModel;
  actionToken: string;
  rejectActionToken: string;
  events: readonly CoachRunEvent[];
}

export type ArtifactActionResult =
  | {
      status: "applied";
      receipt: ActionReceiptArtifact;
      card: ArtifactCardModel;
      undoActionToken: string;
    }
  | { status: "idempotent"; receipt: ActionReceiptArtifact; card: ArtifactCardModel }
  | { status: "rejected"; receipt: ActionReceiptArtifact; card: ArtifactCardModel };

export interface UndoActionResult {
  status: "undone" | "idempotent";
  receipt: ActionReceiptArtifact;
  card: ArtifactCardModel;
}

export class ActionBroker {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly cards: ArtifactCardRegistry,
    private readonly knowledgePins: () => KnowledgeVersionPins,
    private readonly policy = new PolicyGate(),
    private readonly tokenPrimitive: ActionTokenPrimitive = {
      issue: (claims) => stableHash(claims),
    },
  ) {}

  async proposePlanChange(
    input: ProposePlanChangeInput,
    lineage?: { supersedesArtifactId: string },
    execution?: ToolExecutionIdentity,
  ): Promise<PlanChangeProposalResult> {
    validateChange(input.change);
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${input.sessionId}`);
    const user = snapshot.users.find((candidate) => candidate.userId === session.userId);
    if (!user) throw new Error(`User facts not found: ${session.userId}`);
    const policy = this.policy.proposal(user);
    if (policy.result === "deny") throw new ActionPolicyError(policy.reason);
    const targetId = input.change.kind === "add_task" ? undefined : input.change.taskId;
    const task = targetId ? user.plan.tasks.find((candidate) => candidate.id === targetId) : undefined;
    if (targetId && !task) throw new ActionPolicyError("invalid_change");
    if (targetId && input.protectedTaskIds?.includes(targetId)) {
      throw new ActionPolicyError("invalid_change");
    }
    const newTaskId = input.change.kind === "add_task" ? input.change.task.id : undefined;
    if (newTaskId && user.plan.tasks.some((candidate) => candidate.id === newTaskId)) {
      throw new ActionPolicyError("invalid_change");
    }

    const now = this.runtime.now();
    const runId = execution?.runId ?? this.runtime.nextId("coach-run");
    const toolCallId = execution?.toolCallId ?? this.runtime.nextId("tool-call");
    const artifactId = this.runtime.nextId("artifact");
    const presentationId = this.runtime.nextId("presentation");
    const artifact = decidePlanChangeProposal({
      artifactId,
      createdAt: now,
      context: session.context,
      user,
      change: input.change,
      reason: input.reason,
      executionPolicy: policy.executionPolicy,
      knowledgePins: this.knowledgePins(),
      ...(lineage ? { supersedesArtifactId: lineage.supersedesArtifactId } : {}),
    });
    const presentation = {
      id: presentationId,
      artifactId,
      renderer: "plan-change-proposal/v1",
      status: "awaiting_user" as const,
    };
    const nonce = this.runtime.nextId("nonce");
    const expiresAt = new Date(new Date(now).getTime() + 30 * 60_000).toISOString();
    const token = `${nonce}.${this.tokenPrimitive.issue({
      kind: "artifact_action",
      action: "apply",
      userId: user.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      artifactId,
      artifactHash: artifact.hash,
      artifactSchemaVersion: artifact.schemaVersion,
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      expiresAt,
      nonce,
    })}`;
    const tokenRecord: ActionTokenRecord = {
      token,
      userId: user.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      artifactId,
      artifactHash: artifact.hash,
      artifactSchemaVersion: artifact.schemaVersion,
      action: "apply",
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      expiresAt,
      nonce,
    };
    const rejectNonce = this.runtime.nextId("nonce");
    const rejectToken = `${rejectNonce}.${this.tokenPrimitive.issue({
      kind: "artifact_action",
      userId: user.userId,
      sessionId: session.id,
      runId,
      toolCallId,
      artifactId,
      artifactHash: artifact.hash,
      artifactSchemaVersion: artifact.schemaVersion,
      action: "reject",
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      expiresAt,
      nonce: rejectNonce,
    })}`;
    const rejectTokenRecord: ActionTokenRecord = {
      ...tokenRecord,
      token: rejectToken,
      action: "reject",
      nonce: rejectNonce,
    };
    const events: CoachRunEvent[] = [
      {
        type: "tool-started",
        sessionId: session.id,
        runId,
        toolCallId,
        toolName: "plan.propose_change",
        presentationId,
        occurredAt: now,
      },
      {
        type: "artifact-ready",
        sessionId: session.id,
        runId,
        toolCallId,
        artifactRef: { id: artifact.id, kind: artifact.kind, schemaVersion: 1, hash: artifact.hash },
        presentation,
        occurredAt: now,
      },
    ];
    const updatedSession = {
      ...session,
      revision: (session.revision ?? 1) + 1,
      runIds: [...new Set([...(session.runIds ?? []), runId])],
      toolCallIds: [...new Set([...(session.toolCallIds ?? []), toolCallId])],
      artifactIds: [...new Set([...(session.artifactIds ?? []), artifact.id])],
      presentationIds: [...new Set([...(session.presentationIds ?? []), presentation.id])],
      updatedAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: user.userId,
      actorId: "action_broker",
      intent: "plan.proposal.create",
      expectedRevisions: [],
      expectedSessionRevisions: [{ id: session.id, revision: session.revision ?? 1 }],
      domainEvents: [],
      sessions: [updatedSession],
      artifacts: [artifact],
      presentations: [presentation],
      runEvents: events,
      issueTokens: [tokenRecord, rejectTokenRecord],
      actionEvents: [
        {
          id: this.runtime.nextId("action"),
          userId: user.userId,
          occurredAt: now,
          actor: "agent",
          action: "proposal.created",
          targetType: "plan",
          targetId: user.userId,
          scope: "plan_revision",
          intent: sanitizeActionLogText(input.reason),
          beforeRevision: user.plan.revision,
          before: artifact.before,
          after: artifact.after,
          evidenceRefs: artifact.evidenceRefs,
          beforeRefs: [{ aggregate: "plan", id: user.userId, revision: user.plan.revision }],
          afterRefs: [{ aggregate: "plan", id: user.userId, revision: user.plan.revision }],
          ruleVersions: actionRuleVersions(artifact),
          mandateRevision: user.mandate.revision,
          result: "allowed",
          undoBoundary: "not_applicable",
          sessionId: session.id,
          runId,
          toolCallId,
          policyDecision:
            policy.executionPolicy === "confirm" ? "require_confirmation" : "allow",
          causationId: artifact.id,
          correlationId: session.id,
          reversible: false,
        },
      ],
      toolAudit: [
        {
          id: this.runtime.nextId("tool-audit"),
          userPseudonym: `local-${stableHash({ userId: user.userId })}`,
          sessionId: session.id,
          runId,
          toolCallId,
          phase: "policy_decision",
          toolName: "plan.propose_change",
          outcome: "passed",
          metadata: {
            policy: policy.executionPolicy,
            planRevision: user.plan.revision,
            mandateRevision: user.mandate.revision,
          },
          occurredAt: now,
        },
      ],
      idempotencyKey: `proposal:${artifact.id}`,
      recordedAt: now,
    });
    return {
      artifact,
      card: this.cards.render(artifact, "awaiting_user"),
      actionToken: token,
      rejectActionToken: rejectToken,
      events,
    };
  }

  async inspectArtifact(artifactId: string): Promise<{
    artifact: PlanChangeProposalArtifact;
    status: "awaiting_user" | "stale";
    card: ArtifactCardModel;
  }> {
    const snapshot = await this.ledger.read();
    const artifact = snapshot.artifacts.find((candidate) => candidate.id === artifactId);
    if (!artifact || artifact.kind !== "plan_change_proposal") {
      throw new Error(`PlanChangeProposal not found: ${artifactId}`);
    }
    const userId = artifact.evidenceRefs.find((ref) => ref.aggregate === "plan")?.id;
    const user = snapshot.users.find((candidate) => candidate.userId === userId);
    const stale =
      !user ||
      user.plan.revision !== artifact.basePlanRevision ||
      user.mandate.revision !== artifact.mandateRevision;
    const status = stale ? "stale" : "awaiting_user";
    const presentation = snapshot.presentations.find((item) => item.artifactId === artifact.id);
    if (presentation && presentation.status !== status) {
      await this.ledger.replace({
        ...snapshot,
        presentations: [
          ...snapshot.presentations.filter((item) => item.id !== presentation.id),
          { ...presentation, status },
        ],
      });
    }
    return { artifact, status, card: this.cards.render(artifact, status) };
  }

  async recomputePlanChange(input: {
    sessionId: string;
    staleArtifactId: string;
  }): Promise<PlanChangeProposalResult> {
    const inspected = await this.inspectArtifact(input.staleArtifactId);
    if (inspected.status !== "stale") throw new ActionPolicyError("invalid_change");
    return this.proposePlanChange(
      {
        sessionId: input.sessionId,
        change: inspected.artifact.change,
        reason: inspected.artifact.reason,
      },
      { supersedesArtifactId: inspected.artifact.id },
    );
  }

  async apply(input: {
    sessionId: string;
    artifactId: string;
    actionToken: string;
    idempotencyKey: string;
  }): Promise<ArtifactActionResult> {
    const snapshot = await this.ledger.read();
    const duplicateUserId = snapshot.sessions.find(
      (candidate) => candidate.id === input.sessionId,
    )?.userId;
    const duplicate = snapshot.idempotency.find(
      (record) => record.userId === duplicateUserId && record.key === input.idempotencyKey,
    );
    if (duplicate) {
      const receipt = snapshot.artifacts.find((artifact) => artifact.id === duplicate.resultArtifactId);
      if (!receipt || receipt.kind !== "action_receipt") throw new Error("Idempotent receipt missing");
      return { status: "idempotent", receipt, card: this.cards.render(receipt, "ready") };
    }
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    const proposal = snapshot.artifacts.find((artifact) => artifact.id === input.artifactId);
    const token = snapshot.actionTokens.find((candidate) => candidate.token === input.actionToken);
    if (!session || !proposal || proposal.kind !== "plan_change_proposal" || !token) {
      throw new ActionPolicyError("invalid_token");
    }
    if (
      token.sessionId !== session.id ||
      token.artifactId !== proposal.id ||
      token.artifactHash !== proposal.hash ||
      token.artifactSchemaVersion !== proposal.schemaVersion ||
      token.action !== "apply" ||
      token.consumedAt
    ) {
      throw new ActionPolicyError("invalid_token");
    }
    const now = this.runtime.now();
    if (new Date(token.expiresAt).getTime() < new Date(now).getTime()) {
      throw new ActionPolicyError("expired_token");
    }
    const user = snapshot.users.find((candidate) => candidate.userId === session.userId);
    if (!user) throw new Error(`User facts not found: ${session.userId}`);
    const policy = this.policy.apply(user, proposal);
    if (policy.result === "deny") throw new ActionPolicyError(policy.reason);
    const nextPlan = applyTaskChange(user, proposal.change, proposal.reason);
    const receiptId = this.runtime.nextId("artifact");
    const receiptSemantic = {
      kind: "action_receipt" as const,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      action: "apply" as const,
      targetArtifactId: proposal.id,
      result: "applied" as const,
      beforeRevision: user.plan.revision,
      afterRevision: nextPlan.revision,
      contextRefs: [session.context],
      evidenceRefs: proposal.evidenceRefs,
      missingness: proposal.missingness,
      capabilityBoundary: ["撤销会创建补偿版本，不删除历史"],
      knowledgePins: proposal.knowledgePins ?? this.knowledgePins(),
    };
    const receipt: ActionReceiptArtifact = Object.freeze({
      id: receiptId,
      createdAt: now,
      ...receiptSemantic,
      hash: stableHash(receiptSemantic),
    });
    const proposalPresentation = snapshot.presentations.find((item) => item.artifactId === proposal.id);
    if (!proposalPresentation) throw new Error("Proposal presentation missing");
    const receiptPresentation = {
      id: this.runtime.nextId("presentation"),
      artifactId: receipt.id,
      renderer: "action-receipt/v1",
      status: "ready" as const,
    };
    const actionEventId = this.runtime.nextId("action");
    const undoNonce = this.runtime.nextId("nonce");
    const undoExpiresAt = new Date(new Date(now).getTime() + 24 * 60 * 60_000).toISOString();
    const undoActionToken = `${undoNonce}.${this.tokenPrimitive.issue({
      kind: "artifact_action",
      action: "undo",
      userId: user.userId,
      sessionId: session.id,
      runId: token.runId,
      toolCallId: token.toolCallId,
      artifactId: receipt.id,
      artifactHash: receipt.hash,
      artifactSchemaVersion: receipt.schemaVersion,
      expectedPlanRevision: nextPlan.revision,
      expectedMandateRevision: user.mandate.revision,
      undoOf: actionEventId,
      expiresAt: undoExpiresAt,
      nonce: undoNonce,
    })}`;
    const undoTokenRecord: ActionTokenRecord = {
      token: undoActionToken,
      userId: user.userId,
      sessionId: session.id,
      runId: token.runId,
      toolCallId: token.toolCallId,
      artifactId: receipt.id,
      artifactHash: receipt.hash,
      artifactSchemaVersion: receipt.schemaVersion,
      action: "undo",
      expectedPlanRevision: nextPlan.revision,
      expectedMandateRevision: user.mandate.revision,
      expiresAt: undoExpiresAt,
      nonce: undoNonce,
    };
    const receiptRunEvent: CoachRunEvent = {
      type: "action-receipt",
      sessionId: session.id,
      runId: token.runId,
      toolCallId: token.toolCallId,
      artifactRef: {
        id: receipt.id,
        kind: receipt.kind,
        schemaVersion: receipt.schemaVersion,
        hash: receipt.hash,
      },
      occurredAt: now,
    };
    const updatedSession = sessionWithArtifactRefs(session, receipt.id, receiptPresentation.id, now);
    try {
      const committed = await this.ledger.commit({
        userId: user.userId,
        expectedPlanRevision: proposal.basePlanRevision,
        expectedMandateRevision: proposal.mandateRevision,
        plan: nextPlan,
        session: updatedSession,
        expectedSessionRevision: session.revision ?? 1,
        artifacts: [receipt],
        presentations: [{ ...proposalPresentation, status: "applied" }, receiptPresentation],
        runEvents: [receiptRunEvent],
        consumeToken: token.token,
        invalidateTokens: snapshot.actionTokens
          .filter(
            (candidate) =>
              candidate.artifactId === proposal.id &&
              candidate.token !== token.token &&
              !candidate.consumedAt,
          )
          .map((candidate) => candidate.token),
        issueTokens: [undoTokenRecord],
        idempotencyKey: input.idempotencyKey,
        occurredAt: now,
        actionEvent: {
          id: actionEventId,
          userId: user.userId,
          occurredAt: now,
          actor: proposal.executionPolicy === "managed" ? "agent" : "user",
          action: "plan.change.applied",
          targetType: "plan",
          targetId: user.userId,
          scope: "plan_revision",
          intent: sanitizeActionLogText(proposal.reason),
          beforeRevision: user.plan.revision,
          afterRevision: nextPlan.revision,
          before: proposal.before,
          after: proposal.after,
          evidenceRefs: proposal.evidenceRefs,
          beforeRefs: [{ aggregate: "plan", id: user.userId, revision: user.plan.revision }],
          afterRefs: [{ aggregate: "plan", id: user.userId, revision: nextPlan.revision }],
          ruleVersions: actionRuleVersions(proposal),
          mandateRevision: user.mandate.revision,
          result: "applied",
          undoBoundary: "compensating_revision",
          sessionId: session.id,
          runId: token.runId,
          toolCallId: token.toolCallId,
          policyDecision:
            proposal.executionPolicy === "managed" ? "allow" : "require_confirmation",
          ...(proposal.executionPolicy === "managed"
            ? {}
            : { humanDecision: "confirmed" as const }),
          causationId: proposal.id,
          correlationId: session.id,
          reversible: true,
        },
      });
      if (committed.status === "idempotent") {
        const latest = await this.ledger.read();
        const existing = latest.artifacts.find(
          (artifact) => artifact.id === committed.resultArtifactId && artifact.kind === "action_receipt",
        );
        if (!existing || existing.kind !== "action_receipt") throw new Error("Idempotent receipt missing");
        return { status: "idempotent", receipt: existing, card: this.cards.render(existing, "ready") };
      }
      return {
        status: "applied",
        receipt,
        card: this.cards.render(receipt, "ready"),
        undoActionToken,
      };
    } catch (error) {
      if (error instanceof LedgerConflictError) throw new ActionPolicyError("stale");
      throw error;
    }
  }

  async undo(input: {
    sessionId: string;
    receiptArtifactId: string;
    actionToken: string;
    idempotencyKey: string;
  }): Promise<UndoActionResult> {
    const snapshot = await this.ledger.read();
    const duplicateUserId = snapshot.sessions.find(
      (candidate) => candidate.id === input.sessionId,
    )?.userId;
    const duplicate = snapshot.idempotency.find(
      (record) => record.userId === duplicateUserId && record.key === input.idempotencyKey,
    );
    if (duplicate) {
      const duplicateReceipt = snapshot.artifacts.find((artifact) => artifact.id === duplicate.resultArtifactId);
      if (!duplicateReceipt || duplicateReceipt.kind !== "action_receipt") {
        throw new Error("Idempotent undo receipt missing");
      }
      return { status: "idempotent", receipt: duplicateReceipt, card: this.cards.render(duplicateReceipt, "ready") };
    }
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    const sourceReceipt = snapshot.artifacts.find((artifact) => artifact.id === input.receiptArtifactId);
    const token = snapshot.actionTokens.find((candidate) => candidate.token === input.actionToken);
    if (
      !session ||
      !sourceReceipt ||
      sourceReceipt.kind !== "action_receipt" ||
      sourceReceipt.result !== "applied" ||
      !token ||
      token.action !== "undo" ||
      token.sessionId !== session.id ||
      token.artifactId !== sourceReceipt.id ||
      token.artifactHash !== sourceReceipt.hash ||
      token.artifactSchemaVersion !== sourceReceipt.schemaVersion ||
      token.consumedAt
    ) {
      throw new ActionPolicyError("invalid_token");
    }
    const now = this.runtime.now();
    if (new Date(token.expiresAt).getTime() < new Date(now).getTime()) {
      throw new ActionPolicyError("expired_token");
    }
    const user = snapshot.users.find((candidate) => candidate.userId === session.userId);
    if (!user) throw new Error(`User facts not found: ${session.userId}`);
    if (user.plan.revision !== token.expectedPlanRevision || user.mandate.revision !== token.expectedMandateRevision) {
      throw new ActionPolicyError("stale");
    }
    const proposal = snapshot.artifacts.find(
      (artifact) => artifact.id === sourceReceipt.targetArtifactId && artifact.kind === "plan_change_proposal",
    );
    const sourceAction = snapshot.actionEvents.find(
      (event) => event.causationId === proposal?.id && event.action === "plan.change.applied",
    );
    if (!proposal || proposal.kind !== "plan_change_proposal" || !sourceAction || sourceAction.undoneBy) {
      throw new ActionPolicyError("stale");
    }
    const nextPlan = {
      ...user.plan,
      revision: user.plan.revision + 1,
      previousRevision: user.plan.revision,
      reason: `撤销：${proposal.reason}`,
      tasks: undoTaskChange(user.plan.tasks, proposal.change, proposal.before),
    };
    const receiptSemantic = {
      kind: "action_receipt" as const,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      action: "undo" as const,
      targetArtifactId: sourceReceipt.id,
      result: "undone" as const,
      beforeRevision: user.plan.revision,
      afterRevision: nextPlan.revision,
      contextRefs: [session.context],
      evidenceRefs: proposal.evidenceRefs,
      missingness: [] as string[],
      capabilityBoundary: ["补偿版本已创建；原计划与操作记录仍可查询"],
      knowledgePins: proposal.knowledgePins ?? this.knowledgePins(),
    };
    const receipt: ActionReceiptArtifact = Object.freeze({
      id: this.runtime.nextId("artifact"),
      createdAt: now,
      ...receiptSemantic,
      hash: stableHash(receiptSemantic),
    });
    const receiptPresentation = {
      id: this.runtime.nextId("presentation"),
      artifactId: receipt.id,
      renderer: "action-receipt/v1",
      status: "ready" as const,
    };
    const sourceReceiptPresentation = snapshot.presentations.find(
      (presentation) => presentation.artifactId === sourceReceipt.id,
    );
    if (!sourceReceiptPresentation) throw new Error("ActionReceipt presentation missing");
    const undoActionId = this.runtime.nextId("action");
    const receiptRunEvent: CoachRunEvent = {
      type: "action-receipt",
      sessionId: session.id,
      runId: token.runId,
      toolCallId: token.toolCallId,
      artifactRef: {
        id: receipt.id,
        kind: receipt.kind,
        schemaVersion: receipt.schemaVersion,
        hash: receipt.hash,
      },
      occurredAt: now,
    };
    const committed = await this.ledger.commit({
      userId: user.userId,
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      plan: nextPlan,
      session: sessionWithArtifactRefs(session, receipt.id, receiptPresentation.id, now),
      expectedSessionRevision: session.revision ?? 1,
      artifacts: [receipt],
      presentations: [{ ...sourceReceiptPresentation, status: "undone" }, receiptPresentation],
      runEvents: [receiptRunEvent],
      consumeToken: token.token,
      idempotencyKey: input.idempotencyKey,
      occurredAt: now,
      updateActionEvents: [{ ...sourceAction, undoneBy: undoActionId }],
      actionEvent: {
        id: undoActionId,
        userId: user.userId,
        occurredAt: now,
        actor: "user",
        action: "plan.change.undone",
        targetType: "plan",
        targetId: user.userId,
        scope: "plan_revision",
        intent: `undo:${sanitizeActionLogText(proposal.reason)}`,
        beforeRevision: user.plan.revision,
        afterRevision: nextPlan.revision,
        before: proposal.after,
        after: proposal.before,
        evidenceRefs: proposal.evidenceRefs,
        beforeRefs: [{ aggregate: "plan", id: user.userId, revision: user.plan.revision }],
        afterRefs: [{ aggregate: "plan", id: user.userId, revision: nextPlan.revision }],
        ruleVersions: actionRuleVersions(proposal),
        mandateRevision: user.mandate.revision,
        result: "undone",
        undoBoundary: "not_reversible",
        sessionId: session.id,
        runId: token.runId,
        toolCallId: token.toolCallId,
        policyDecision: "allow",
        humanDecision: "confirmed",
        causationId: sourceAction.id,
        correlationId: session.id,
        reversible: false,
      },
    });
    return {
      status: committed.status === "idempotent" ? "idempotent" : "undone",
      receipt,
      card: this.cards.render(receipt, "ready"),
    };
  }

  async reject(input: {
    sessionId: string;
    artifactId: string;
    actionToken: string;
    idempotencyKey: string;
  }): Promise<ArtifactActionResult> {
    const snapshot = await this.ledger.read();
    const duplicateUserId = snapshot.sessions.find(
      (candidate) => candidate.id === input.sessionId,
    )?.userId;
    const duplicate = snapshot.idempotency.find(
      (record) => record.userId === duplicateUserId && record.key === input.idempotencyKey,
    );
    if (duplicate) {
      const existing = snapshot.artifacts.find(
        (artifact) => artifact.id === duplicate.resultArtifactId && artifact.kind === "action_receipt",
      );
      if (!existing || existing.kind !== "action_receipt") throw new Error("Idempotent receipt missing");
      return { status: "idempotent", receipt: existing, card: this.cards.render(existing, "ready") };
    }
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    const proposal = snapshot.artifacts.find((artifact) => artifact.id === input.artifactId);
    const token = snapshot.actionTokens.find((candidate) => candidate.token === input.actionToken);
    if (
      !session ||
      !proposal ||
      proposal.kind !== "plan_change_proposal" ||
      !token ||
      token.action !== "reject" ||
      token.sessionId !== session.id ||
      token.artifactId !== proposal.id ||
      token.artifactHash !== proposal.hash ||
      token.artifactSchemaVersion !== proposal.schemaVersion ||
      token.consumedAt
    ) {
      throw new ActionPolicyError("invalid_token");
    }
    const now = this.runtime.now();
    if (new Date(token.expiresAt).getTime() < new Date(now).getTime()) {
      throw new ActionPolicyError("expired_token");
    }
    const user = snapshot.users.find((candidate) => candidate.userId === session.userId);
    if (
      !user ||
      user.plan.revision !== proposal.basePlanRevision ||
      user.mandate.revision !== proposal.mandateRevision
    ) {
      throw new ActionPolicyError("stale");
    }
    const semantic = {
      kind: "action_receipt" as const,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      action: "reject" as const,
      targetArtifactId: proposal.id,
      result: "rejected" as const,
      beforeRevision: user.plan.revision,
      afterRevision: user.plan.revision,
      contextRefs: [session.context],
      evidenceRefs: proposal.evidenceRefs,
      missingness: [] as string[],
      capabilityBoundary: ["原计划未发生变化"],
      knowledgePins: proposal.knowledgePins ?? this.knowledgePins(),
    };
    const receipt: ActionReceiptArtifact = Object.freeze({
      id: this.runtime.nextId("artifact"),
      createdAt: now,
      ...semantic,
      hash: stableHash(semantic),
    });
    const proposalPresentation = snapshot.presentations.find((item) => item.artifactId === proposal.id);
    if (!proposalPresentation) throw new Error("Proposal presentation missing");
    const presentation = {
      id: this.runtime.nextId("presentation"),
      artifactId: receipt.id,
      renderer: "action-receipt/v1",
      status: "ready" as const,
    };
    const receiptRunEvent: CoachRunEvent = {
      type: "action-receipt",
      sessionId: session.id,
      runId: token.runId,
      toolCallId: token.toolCallId,
      artifactRef: {
        id: receipt.id,
        kind: receipt.kind,
        schemaVersion: receipt.schemaVersion,
        hash: receipt.hash,
      },
      occurredAt: now,
    };
    const result = await this.ledger.commit({
      userId: user.userId,
      expectedPlanRevision: user.plan.revision,
      expectedMandateRevision: user.mandate.revision,
      plan: user.plan,
      session: sessionWithArtifactRefs(session, receipt.id, presentation.id, now),
      expectedSessionRevision: session.revision ?? 1,
      artifacts: [receipt],
      presentations: [{ ...proposalPresentation, status: "rejected" }, presentation],
      runEvents: [receiptRunEvent],
      consumeToken: token.token,
      invalidateTokens: snapshot.actionTokens
        .filter(
          (candidate) =>
            candidate.artifactId === proposal.id &&
            candidate.token !== token.token &&
            !candidate.consumedAt,
        )
        .map((candidate) => candidate.token),
      idempotencyKey: input.idempotencyKey,
      occurredAt: now,
      actionEvent: {
        id: this.runtime.nextId("action"),
        userId: user.userId,
        occurredAt: now,
        actor: "user",
        action: "plan.change.rejected",
        targetType: "plan",
        targetId: user.userId,
        scope: "plan_revision",
        intent: sanitizeActionLogText(proposal.reason),
        beforeRevision: user.plan.revision,
        before: proposal.before,
        after: proposal.before,
        evidenceRefs: proposal.evidenceRefs,
        beforeRefs: [{ aggregate: "plan", id: user.userId, revision: user.plan.revision }],
        afterRefs: [{ aggregate: "plan", id: user.userId, revision: user.plan.revision }],
        ruleVersions: actionRuleVersions(proposal),
        mandateRevision: user.mandate.revision,
        result: "rejected",
        undoBoundary: "not_reversible",
        sessionId: session.id,
        runId: token.runId,
        toolCallId: token.toolCallId,
        policyDecision: "allow",
        humanDecision: "rejected",
        causationId: proposal.id,
        correlationId: session.id,
        reversible: false,
      },
    });
    if (result.status === "idempotent") {
      const latest = await this.ledger.read();
      const existing = latest.artifacts.find(
        (artifact) => artifact.id === result.resultArtifactId && artifact.kind === "action_receipt",
      );
      if (!existing || existing.kind !== "action_receipt") throw new Error("Idempotent receipt missing");
      return { status: "idempotent", receipt: existing, card: this.cards.render(existing, "ready") };
    }
    return { status: "rejected", receipt, card: this.cards.render(receipt, "ready") };
  }
}

function undoTaskChange(
  currentTasks: readonly PlanTask[],
  change: PlanEditChange,
  before: Readonly<Record<string, unknown>>,
): readonly PlanTask[] {
  const tasks = [...currentTasks];
  if (change.kind === "add_task") {
    return tasks.filter((task) => task.id !== change.task.id);
  }
  if (change.kind === "remove_task") {
    const task = before.task as PlanTask | undefined;
    const index = Number(before.index);
    if (!task || !Number.isInteger(index)) throw new ActionPolicyError("stale");
    tasks.splice(Math.min(Math.max(index, 0), tasks.length), 0, task);
    return tasks;
  }
  if (change.kind === "replace_task") {
    const task = before.task as PlanTask | undefined;
    const index = tasks.findIndex((candidate) => candidate.id === change.replacement.id);
    if (!task || index < 0) throw new ActionPolicyError("stale");
    tasks.splice(index, 1, task);
    return tasks;
  }
  if (change.kind === "reorder_task") {
    const currentIndex = tasks.findIndex((candidate) => candidate.id === change.taskId);
    const priorIndex = Number(before.index);
    if (currentIndex < 0 || !Number.isInteger(priorIndex)) throw new ActionPolicyError("stale");
    const [task] = tasks.splice(currentIndex, 1);
    tasks.splice(Math.min(Math.max(priorIndex, 0), tasks.length), 0, task!);
    return tasks;
  }
  return tasks.map((task) =>
    task.id === change.taskId ? { ...task, ...before } : task,
  );
}
