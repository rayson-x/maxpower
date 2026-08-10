import type {
  ActionEvent,
  ActionTokenRecord,
  CoachRunRecord,
  LedgerSnapshot,
  PendingHumanAction,
  WorkingMemoryItem,
} from "./model";

/**
 * 过期/孤儿状态清扫（ticket 03）。
 *
 * 纯函数：给定账本快照与当前时间，产出需要落账的更新。调用方负责 commit。
 * 清扫语义刻意保守：
 * - streaming/resuming 的 run 只在进程丢失后才会残留（正常生命周期内它们会被
 *   推进到终态），因此加载到的非终态 run 一律视为崩溃孤儿，终态化为
 *   terminated(process_lost)；suspended 是合法的 HITL 驻留态，不动。
 * - pending human action / action token 的过期判定此前是惰性的（只在
 *   resume/apply 尝试时判定），这里把过期显式化：pending → expired，
 *   token → revokedAt（不标 consumedAt，避免与真实消费混淆）。
 * - working memory 的 expiresAt 到期走 forget（deletedAt + version 递增），
 *   与 MemoryCurator.forget 的语义一致。
 */
export interface CoachStateSweepPlan {
  runs: CoachRunRecord[];
  pendingHumanActions: PendingHumanAction[];
  actionTokens: ActionTokenRecord[];
  workingMemoryItems: WorkingMemoryItem[];
  actionEvents: ActionEvent[];
  expectedPendingHumanActionStatuses: readonly {
    id: string;
    status: PendingHumanAction["status"];
  }[];
  expectedWorkingMemoryVersions: readonly { id: string; version: number }[];
}

export function planCoachStateSweep(
  snapshot: LedgerSnapshot,
  userId: string,
  now: string,
): CoachStateSweepPlan {
  const runs = snapshot.runs
    .filter(
      (run) =>
        run.userId === userId &&
        (run.status === "streaming" || run.status === "resuming"),
    )
    .map((run) => ({
      ...run,
      status: "terminated" as const,
      terminalCode: "process_lost",
      updatedAt: now,
    }));

  const pendingHumanActions = snapshot.pendingHumanActions
    .filter(
      (action) =>
        action.userId === userId &&
        action.status === "pending" &&
        action.expiresAt <= now,
    )
    .map((action) => ({ ...action, status: "expired" as const }));

  const actionTokens = snapshot.actionTokens
    .filter(
      (token) =>
        token.userId === userId &&
        !token.consumedAt &&
        !token.revokedAt &&
        token.expiresAt <= now,
    )
    .map((token) => ({ ...token, revokedAt: now }));

  const workingMemoryItems = snapshot.workingMemory
    .filter(
      (item) =>
        item.userId === userId &&
        item.expiresAt !== undefined &&
        item.expiresAt <= now &&
        !item.deletedAt,
    )
    .map((item) => ({
      ...item,
      version: item.version + 1,
      deletedAt: now,
      updatedAt: now,
    }));

  const actionEvents: ActionEvent[] = [
    ...runs.map((run) =>
      sweepEvent({
        userId,
        now,
        targetType: "session",
        targetId: run.id,
        intent: "coach_run.process_lost",
        after: { status: run.status, terminalCode: run.terminalCode },
        sessionId: run.sessionId,
        runId: run.id,
      }),
    ),
    ...pendingHumanActions.map((action) =>
      sweepEvent({
        userId,
        now,
        targetType: "session",
        targetId: action.id,
        intent: "pending_human_action.expired",
        after: { status: action.status },
        sessionId: action.sessionId,
        runId: action.runId,
        toolCallId: action.toolCallId,
      }),
    ),
    ...actionTokens.map((token) =>
      sweepEvent({
        userId,
        now,
        targetType: "session",
        targetId: token.token,
        intent: "action_token.revoked",
        after: { revokedAt: token.revokedAt },
        sessionId: token.sessionId,
        runId: token.runId,
        toolCallId: token.toolCallId,
      }),
    ),
    ...workingMemoryItems.map((item) =>
      sweepEvent({
        userId,
        now,
        targetType: "memory",
        targetId: item.id,
        intent: "working_memory.expired",
        after: { deletedAt: item.deletedAt },
      }),
    ),
  ];

  return {
    runs,
    pendingHumanActions,
    actionTokens,
    workingMemoryItems,
    actionEvents,
    expectedPendingHumanActionStatuses: pendingHumanActions.map((action) => ({
      id: action.id,
      status: "pending" as const,
    })),
    expectedWorkingMemoryVersions: workingMemoryItems.map((item) => ({
      id: item.id,
      version: item.version - 1,
    })),
  };
}

function sweepEvent(input: {
  userId: string;
  now: string;
  targetType: ActionEvent["targetType"];
  targetId: string;
  intent: string;
  after: Readonly<Record<string, unknown>>;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
}): ActionEvent {
  return {
    id: `sweep-${input.intent}-${input.targetId}`,
    userId: input.userId,
    occurredAt: input.now,
    actor: "rule_engine",
    action: "data.lifecycle.changed",
    targetType: input.targetType,
    targetId: input.targetId,
    scope: "coach_state_sweep",
    intent: input.intent,
    before: {},
    after: input.after,
    evidenceRefs: [],
    beforeRefs: [],
    afterRefs: [],
    ruleVersions: {},
    mandateRevision: 0,
    result: "applied",
    undoBoundary: "not_reversible",
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    policyDecision: "allow",
    causationId: `sweep-${input.now}`,
    correlationId: `sweep-${input.now}`,
    reversible: false,
  };
}
