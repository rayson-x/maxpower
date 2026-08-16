import type { DomainEvent, OutboxEntry } from "../coach/domain";
import type { DomainAtomicCommit } from "../coach/ledger";
import type {
  ActionEvent,
  CoachRunRecord,
  JobAttempt,
  LedgerSnapshot,
  ToolAuditRecord,
} from "../coach/model";
import { stableHash } from "../coach/stable";
import {
  BACKGROUND_TRACE_SESSION_ID,
  buildTraceEnvelope,
  TRACE_METADATA_VALUE_MAX_LENGTH,
  traceUserPseudonym,
  type TraceEnvelope,
  type TraceMetadata,
  type TraceOutcome,
} from "./model";

/**
 * 已提交事实 → trace 事件的唯一映射。
 *
 * 埋点不是散落在 9000 行应用代码里的 recorder 调用，而是这一组纯函数：
 * 生产路径在每次 commit 后按 commit 输入投影，启动 reconcile 按账本快照投影，
 * 两条路径共用同一批 mapper，所以「崩溃窗口回填」与「实时写入」必然一致。
 *
 * 隐私不变量：这里只读取元数据、引用与决策码。ActionEvent 的 before/after、
 * CoachMessage 的正文、工具入参出参都不进 envelope。
 */
export interface TraceProjectionContext {
  deviceId: string;
}

/** envelope 不带 userId（隐私），但本地写入端需要它来做账本作用域。 */
export interface TraceProjectionRecord {
  userId: string;
  envelope: TraceEnvelope;
}

export function projectCommitTraceEnvelopes(
  input: DomainAtomicCommit,
  context: TraceProjectionContext,
): readonly TraceProjectionRecord[] {
  const pseudonym = traceUserPseudonym(input.userId, stableHash);
  const owned = (envelope: TraceEnvelope): TraceProjectionRecord => ({ userId: input.userId, envelope });
  return [
    ...(input.toolAudit ?? []).map((record) => owned(toolAuditEnvelope(record, context))),
    ...(input.runs ?? []).map((run) => owned(runEnvelope(run, pseudonym, context))),
    ...(input.actionEvents ?? []).map((event) => owned(actionEventEnvelope(event, pseudonym, context))),
    ...(input.domainEvents ?? []).flatMap((event) => {
      const envelope = domainEventEnvelope(event, pseudonym, context);
      return envelope ? [owned(envelope)] : [];
    }),
    ...(input.jobAttempts ?? []).map((attempt) => owned(jobAttemptEnvelope(attempt, pseudonym, context))),
    ...(input.outbox ?? []).map((entry) => owned(replicaOutboxEnvelope(entry, pseudonym, context))),
  ];
}

export function projectLedgerTraceEnvelopes(
  snapshot: LedgerSnapshot,
  context: TraceProjectionContext,
): readonly TraceProjectionRecord[] {
  const pseudonymByUser = new Map<string, string>();
  const pseudonym = (userId: string): string => {
    const known = pseudonymByUser.get(userId);
    if (known) return known;
    const derived = traceUserPseudonym(userId, stableHash);
    pseudonymByUser.set(userId, derived);
    return derived;
  };
  const userBySession = new Map(snapshot.sessions.map((session) => [session.id, session.userId]));
  return [
    // ToolAuditRecord 只带假名，账本作用域通过它所属的会话解析。
    ...snapshot.toolAudit.flatMap((record) => {
      const userId = userBySession.get(record.sessionId);
      return userId ? [{ userId, envelope: toolAuditEnvelope(record, context) }] : [];
    }),
    ...snapshot.runs.map((run) => ({
      userId: run.userId,
      envelope: runEnvelope(run, pseudonym(run.userId), context),
    })),
    ...snapshot.actionEvents.map((event) => ({
      userId: event.userId,
      envelope: actionEventEnvelope(event, pseudonym(event.userId), context),
    })),
    ...snapshot.domainEvents.flatMap((event) => {
      const envelope = domainEventEnvelope(event, pseudonym(event.userId), context);
      return envelope ? [{ userId: event.userId, envelope }] : [];
    }),
    ...snapshot.jobAttempts.map((attempt) => ({
      userId: attempt.userId,
      envelope: jobAttemptEnvelope(attempt, pseudonym(attempt.userId), context),
    })),
    ...snapshot.outbox.map((entry) => ({
      userId: entry.userId,
      envelope: replicaOutboxEnvelope(entry, pseudonym(entry.userId), context),
    })),
  ];
}

const AUDIT_PHASE_MAPPING: Readonly<
  Record<ToolAuditRecord["phase"], { kind: TraceEnvelope["kind"]; name: string }>
> = {
  provider_request: { kind: "llm", name: "provider.request" },
  provider_response: { kind: "llm", name: "provider.response" },
  retry: { kind: "llm", name: "provider.retry" },
  schema_validation: { kind: "tool", name: "tool.schema_validation" },
  tool_execution: { kind: "tool", name: "tool.execution" },
  policy_decision: { kind: "guardrail", name: "policy.decision" },
  internal_error: { kind: "error", name: "runtime.error" },
};

const AUDIT_OUTCOME_MAPPING: Readonly<Record<ToolAuditRecord["outcome"], TraceOutcome>> = {
  started: "started",
  passed: "ok",
  rejected: "rejected",
  failed: "failed",
  retryable: "degraded",
};

/** metadata 里带决策语义的键，提升为可检索的 decisionCodes。 */
const DECISION_METADATA_KEYS = [
  "matchedRuleIds",
  "outputFilter",
  "failureCode",
  "terminalCode",
  "terminalStatus",
] as const;

function toolAuditEnvelope(record: ToolAuditRecord, context: TraceProjectionContext): TraceEnvelope {
  const mapping = AUDIT_PHASE_MAPPING[record.phase];
  return envelope({
    traceId: record.runId,
    sessionId: record.sessionId,
    kind: mapping.kind,
    name: mapping.name,
    occurredAt: record.occurredAt,
    actor: "agent_runtime",
    userPseudonym: record.userPseudonym,
    deviceId: context.deviceId,
    outcome: AUDIT_OUTCOME_MAPPING[record.outcome],
    decisionCodes: decisionCodesFromMetadata(record.metadata),
    ...(record.latencyMs !== undefined ? { durationMs: record.latencyMs } : {}),
    metadata: traceSafeMetadata({
      auditPhase: record.phase,
      ...(record.toolName ? { toolName: record.toolName } : {}),
      ...(record.toolCallId ? { toolCallId: record.toolCallId } : {}),
      ...record.metadata,
    }),
  });
}

/** Keep replay metadata indexable without copying large manifests or payload-like strings. */
function traceSafeMetadata(metadata: TraceMetadata): TraceMetadata {
  return Object.fromEntries(Object.entries(metadata).flatMap(([key, value]) => {
    if (typeof value !== "string" || value.length <= TRACE_METADATA_VALUE_MAX_LENGTH) {
      return [[key, value]];
    }
    return [[`${key}Hash`, stableHash(value)]];
  }));
}

function runEnvelope(
  run: CoachRunRecord,
  userPseudonym: string,
  context: TraceProjectionContext,
): TraceEnvelope {
  const durationMs = Date.parse(run.updatedAt) - Date.parse(run.startedAt);
  return envelope({
    traceId: run.id,
    sessionId: run.sessionId,
    kind: "turn",
    name: `run.${run.status}`,
    occurredAt: run.updatedAt,
    actor: "agent_runtime",
    userPseudonym,
    deviceId: context.deviceId,
    outcome: runOutcome(run.status),
    decisionCodes: run.terminalCode ? [run.terminalCode] : [],
    factRefs: run.factFrontier.map((ref) => `${ref.aggregate}:${ref.id}:${ref.revision}`),
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
    metadata: {
      status: run.status,
      contextManifestHash: run.contextManifestHash,
      ...(run.provider ? { providerKind: run.provider.kind } : {}),
      ...(run.provider?.model ? { providerModel: run.provider.model } : {}),
    },
  });
}

function runOutcome(status: CoachRunRecord["status"]): TraceOutcome {
  if (status === "completed") return "ok";
  if (status === "failed") return "failed";
  if (status === "interrupted") return "rejected";
  if (status === "streaming") return "started";
  return "degraded";
}

function actionEventEnvelope(
  event: ActionEvent,
  userPseudonym: string,
  context: TraceProjectionContext,
): TraceEnvelope {
  return envelope({
    traceId: event.runId ?? event.correlationId,
    sessionId: event.sessionId ?? BACKGROUND_TRACE_SESSION_ID,
    kind: event.policyDecision === "allow" ? "agent" : "guardrail",
    name: `action.${event.action}`,
    occurredAt: event.occurredAt,
    actor: event.actor,
    userPseudonym,
    deviceId: context.deviceId,
    outcome: actionOutcome(event.result),
    decisionCodes: [
      `policy:${event.policyDecision}`,
      `result:${event.result}`,
      `undo:${event.undoBoundary}`,
      ...(event.humanDecision ? [`human:${event.humanDecision}`] : []),
    ],
    factRefs: event.evidenceRefs.map((ref) => `${ref.aggregate}:${ref.id}:${ref.revision}`),
    metadata: {
      targetType: event.targetType,
      targetId: event.targetId,
      reversible: event.reversible,
      mandateRevision: event.mandateRevision,
      ...(event.toolCallId ? { toolCallId: event.toolCallId } : {}),
    },
  });
}

function actionOutcome(result: ActionEvent["result"]): TraceOutcome {
  if (result === "failed") return "failed";
  if (result === "rejected") return "rejected";
  if (result === "undone") return "degraded";
  return "ok";
}

/**
 * 只投影对「为什么计划变了」有解释力的领域事实。其余聚合事件由账本自身承载，
 * 重复进 trace 只会稀释检索。
 */
function domainEventEnvelope(
  event: DomainEvent,
  userPseudonym: string,
  context: TraceProjectionContext,
): TraceEnvelope | undefined {
  if (event.name !== "plan.revised") return undefined;
  return envelope({
    traceId: event.correlationId || event.id,
    sessionId: BACKGROUND_TRACE_SESSION_ID,
    kind: "plan",
    name: "plan.revised",
    occurredAt: event.occurredAt,
    actor: event.actor.kind,
    userPseudonym,
    deviceId: context.deviceId,
    outcome: "ok",
    factRefs: [`plan:${event.aggregate.id}:${event.aggregate.revision}`],
    metadata: {
      planRevision: event.aggregate.revision,
      sessionCount: event.payload.sessions.length,
      causationId: event.causationId,
    },
  });
}

function jobAttemptEnvelope(
  attempt: JobAttempt,
  userPseudonym: string,
  context: TraceProjectionContext,
): TraceEnvelope {
  const durationMs = attempt.finishedAt
    ? Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)
    : undefined;
  return envelope({
    traceId: attempt.correlationId || attempt.id,
    sessionId: BACKGROUND_TRACE_SESSION_ID,
    kind: "recipe",
    name: `recipe.${attempt.outcome}`,
    occurredAt: attempt.finishedAt ?? attempt.startedAt,
    actor: "rule_engine",
    userPseudonym,
    deviceId: context.deviceId,
    outcome: attempt.outcome === "failed" ? "failed" : attempt.outcome === "skipped" ? "rejected" : "ok",
    decisionCodes: [attempt.reason],
    factRefs: attempt.factFrontier.map((ref) => `${ref.aggregate}:${ref.id}:${ref.revision}`),
    ...(durationMs !== undefined && Number.isFinite(durationMs) && durationMs >= 0
      ? { durationMs }
      : {}),
    metadata: { jobId: attempt.jobId, attempt: attempt.attempt, causationId: attempt.causationId },
  });
}

function replicaOutboxEnvelope(
  entry: OutboxEntry,
  userPseudonym: string,
  context: TraceProjectionContext,
): TraceEnvelope {
  return envelope({
    traceId: entry.domainEventId,
    sessionId: BACKGROUND_TRACE_SESSION_ID,
    kind: "sync",
    name: `sync.${entry.status}`,
    occurredAt: entry.acknowledgedAt ?? entry.createdAt,
    actor: "sync",
    userPseudonym,
    deviceId: entry.deviceId,
    outcome: entry.status === "conflict" ? "rejected" : entry.status === "acknowledged" ? "ok" : "started",
    decisionCodes: entry.conflict ? [`conflict:${entry.conflict.code}`] : [],
    metadata: {
      replicaId: entry.replicaId,
      payloadHash: entry.payloadHash,
      projectionDeviceId: context.deviceId,
    },
  });
}

function decisionCodesFromMetadata(metadata: TraceMetadata): readonly string[] {
  return DECISION_METADATA_KEYS.flatMap((key) => {
    const value = metadata[key];
    if (typeof value !== "string" || !value) return [];
    return value.split(",").map((code) => `${key}:${code.trim()}`);
  });
}

const envelope = buildTraceEnvelope;
