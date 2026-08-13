import type { PermissionSetData } from "../coach/domain";
import type { CoachLedger } from "../coach/ledger";
import type { RuntimeServices } from "../coach/model";
import { stableHash } from "../coach/stable";
import { type TraceEnvelope, type TraceOutboxEntry } from "./model";
import type { TraceTransport } from "./RemoteTraceSink";
import type { TraceSink, TraceWriteContext } from "./TraceRecorder";

export const TRACE_ENQUEUE_ACTOR_ID = "observability";
export const TRACE_ENQUEUE_INTENT = "observability.trace_enqueue";
export const TRACE_DISPATCH_INTENT = "observability.trace_dispatch";

/** 远程上报授权。诊断数据不搭 remoteLlm 的便车，两项都要显式授权。 */
export interface TraceUploadAuthorization {
  isAuthorized(userId: string): Promise<boolean>;
}

export function isTraceUploadAuthorized(permissions: PermissionSetData | undefined): boolean {
  return permissions?.observability === "granted" && permissions.remoteLlm === "granted";
}

/**
 * 从账本的 permission_set 投影读授权。按 userId 记忆，权限变更时由写入方
 * 调用 invalidate——否则每条 trace 都要重放一遍领域事件。
 */
export class LedgerTraceUploadAuthorization implements TraceUploadAuthorization {
  private readonly cache = new Map<string, boolean>();

  constructor(private readonly ledger: Pick<CoachLedger, "readDomainProjection">) {}

  invalidate(userId?: string): void {
    if (userId === undefined) this.cache.clear();
    else this.cache.delete(userId);
  }

  async isAuthorized(userId: string): Promise<boolean> {
    const known = this.cache.get(userId);
    if (known !== undefined) return known;
    const projection = await this.ledger.readDomainProjection({ userId });
    const authorized = isTraceUploadAuthorized(projection.permissions?.value);
    this.cache.set(userId, authorized);
    return authorized;
  }
}

/**
 * 远程 sink 的落地端：授权通过的事件先进账本内 outbox，再由调度器补发。
 *
 * 授权关闭时事件根本不入 outbox（只计数），所以「默认关」不是靠调度器不跑，
 * 而是靠队列里本来就没有东西。
 */
export class LedgerTraceOutboxSink implements TraceSink {
  readonly name = "ledger_outbox";

  private readonly buffered = new Map<string, TraceEnvelope[]>();
  private unauthorized = 0;

  constructor(
    private readonly ledger: Pick<CoachLedger, "commit">,
    private readonly runtime: RuntimeServices,
    private readonly authorization: TraceUploadAuthorization,
  ) {}

  stats(): { buffered: number; unauthorized: number } {
    return {
      buffered: [...this.buffered.values()].reduce((total, list) => total + list.length, 0),
      unauthorized: this.unauthorized,
    };
  }

  async write(envelope: TraceEnvelope, context: TraceWriteContext): Promise<void> {
    if (!(await this.authorization.isAuthorized(context.userId))) {
      this.unauthorized += 1;
      return;
    }
    const pending = this.buffered.get(context.userId) ?? [];
    pending.push(envelope);
    this.buffered.set(context.userId, pending);
  }

  /** 把缓冲的事件按用户批量落账；返回本次入队的条目数。 */
  async flush(): Promise<number> {
    let enqueued = 0;
    for (const [userId, envelopes] of [...this.buffered]) {
      this.buffered.delete(userId);
      if (!envelopes.length) continue;
      const createdAt = this.runtime.now();
      const entries: TraceOutboxEntry[] = envelopes.map((envelope) => ({
        id: envelope.eventId,
        userId,
        eventId: envelope.eventId,
        deviceId: envelope.deviceId,
        kind: envelope.kind,
        occurredAt: envelope.occurredAt,
        payloadHash: stableHash(envelope),
        envelope,
        status: "pending",
        attempts: 0,
        createdAt,
      }));
      await this.ledger.commit({
        kind: "domain",
        userId,
        actorId: TRACE_ENQUEUE_ACTOR_ID,
        intent: TRACE_ENQUEUE_INTENT,
        expectedRevisions: [],
        domainEvents: [],
        traceOutbox: entries,
        idempotencyKey: `trace:enqueue:${stableHash(entries.map((entry) => entry.eventId))}`,
        recordedAt: createdAt,
      });
      enqueued += entries.length;
    }
    return enqueued;
  }
}

export interface TraceDispatchResult {
  status: "sent" | "empty" | "deferred" | "rejected";
  sent: number;
  remaining: number;
  code?: string;
}

export const DEFAULT_TRACE_DISPATCH_BATCH_SIZE = 50;
/** 反复被服务端拒收的条目不再无限重试，避免 outbox 永久堵塞。 */
export const TRACE_DISPATCH_MAX_ATTEMPTS = 8;

/**
 * outbox 补发调度器：at-least-once，服务端按 eventId 去重。
 *
 * 断网只让条目留在队列里（attempts +1），下次恢复后原样补发；服务端明确拒收
 * 才把条目标为 abandoned——重试不会让一个非法请求变合法。
 */
export class TraceOutboxDispatcher {
  constructor(
    private readonly ledger: Pick<CoachLedger, "read" | "commit">,
    private readonly transport: TraceTransport,
    private readonly runtime: RuntimeServices,
    private readonly batchSize = DEFAULT_TRACE_DISPATCH_BATCH_SIZE,
  ) {}

  async dispatch(userId: string): Promise<TraceDispatchResult> {
    const snapshot = await this.ledger.read();
    const pending = snapshot.traceOutbox
      .filter((entry) => entry.userId === userId && entry.status === "pending")
      .sort((left, right) => left.envelope.orderKey.localeCompare(right.envelope.orderKey));
    if (!pending.length) return { status: "empty", sent: 0, remaining: 0 };
    const batch = pending.slice(0, this.batchSize);
    const result = await this.transport.send(batch.map((entry) => entry.envelope));
    const now = this.runtime.now();
    const settled: TraceOutboxEntry[] = batch.map((entry) => ({
      ...entry,
      attempts: entry.attempts + 1,
      lastAttemptAt: now,
      ...(result.status === "accepted" ? { status: "sent" as const, sentAt: now } : {}),
      ...(result.status === "rejected" ? { status: "abandoned" as const } : {}),
      ...(result.status === "unavailable" && entry.attempts + 1 >= TRACE_DISPATCH_MAX_ATTEMPTS
        ? { status: "abandoned" as const }
        : {}),
    }));
    await this.ledger.commit({
      kind: "domain",
      userId,
      actorId: TRACE_ENQUEUE_ACTOR_ID,
      intent: TRACE_DISPATCH_INTENT,
      expectedRevisions: [],
      domainEvents: [],
      updateTraceOutbox: settled,
      // 键覆盖「这次尝试把哪些条目推进到什么状态」，所以重复投递同一次尝试是
      // no-op，而下一次尝试（attempts 递增）仍能落账。
      idempotencyKey: `trace:dispatch:${stableHash(settled)}`,
      recordedAt: now,
    });
    const remaining = pending.length - settled.filter((entry) => entry.status !== "pending").length;
    if (result.status === "accepted") {
      return { status: "sent", sent: settled.length, remaining };
    }
    return {
      status: result.status === "rejected" ? "rejected" : "deferred",
      sent: 0,
      remaining,
      code: result.code,
    };
  }
}
