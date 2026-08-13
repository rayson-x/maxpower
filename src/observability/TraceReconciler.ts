import type { CoachLedger } from "../coach/ledger";
import type { TraceEnvelope } from "./model";
import type { LocalFileTraceSink, TraceFileSystem } from "./LocalFileTraceSink";
import { projectLedgerTraceEnvelopes, type TraceProjectionContext } from "./traceProjection";
import type { TraceRecorder } from "./TraceRecorder";

/**
 * 「这条 trace 事件已经写过了吗」的持久化答案。
 *
 * 回填要幂等，就必须能跨进程回答这个问题；内存里的 Set 在崩溃后就没了，
 * 所以索引只能来自已经落盘的东西——本地 JSONL 与账本 outbox。
 */
export interface TraceEventIndex {
  knownEventIds(): Promise<ReadonlySet<string>>;
}

export const EMPTY_TRACE_EVENT_INDEX: TraceEventIndex = {
  async knownEventIds() {
    return new Set<string>();
  },
};

export function compositeTraceEventIndex(
  ...indexes: readonly TraceEventIndex[]
): TraceEventIndex {
  return {
    async knownEventIds() {
      const known = new Set<string>();
      for (const index of indexes) {
        for (const id of await index.knownEventIds()) known.add(id);
      }
      return known;
    },
  };
}

/** 账本 outbox 里出现过的 eventId（含已发送与已放弃）。 */
export class LedgerTraceEventIndex implements TraceEventIndex {
  constructor(private readonly ledger: Pick<CoachLedger, "read">) {}

  async knownEventIds(): Promise<ReadonlySet<string>> {
    const snapshot = await this.ledger.read();
    return new Set(snapshot.traceOutbox.map((entry) => entry.eventId));
  }
}

/** 本地 JSONL 文件里出现过的 eventId；损坏的行被跳过而不是让回填失败。 */
export class LocalFileTraceEventIndex implements TraceEventIndex {
  constructor(
    private readonly files: TraceFileSystem,
    private readonly sink: Pick<LocalFileTraceSink, "retainedPaths">,
  ) {}

  async knownEventIds(): Promise<ReadonlySet<string>> {
    const known = new Set<string>();
    for (const path of this.sink.retainedPaths()) {
      const content = await this.files.read(path);
      for (const line of content.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Partial<TraceEnvelope>;
          if (typeof parsed.eventId === "string") known.add(parsed.eventId);
        } catch {
          // 崩溃时写了半行是正常的；跳过它，宁可多回填一条也不要少一条。
        }
      }
    }
    return known;
  }
}

export interface TraceReconcileResult {
  backfilled: number;
  skipped: number;
}

/**
 * 启动时的崩溃窗口回填：账本里已提交的事实一定有对应 trace 事件。
 *
 * 「先落账后写 trace」意味着崩溃只会丢 trace、不会丢事实，所以从账本投影就能
 * 补全。投影是确定性的（eventId = 内容哈希），重放不产生重复事件。
 */
export class TraceReconciler {
  constructor(
    private readonly ledger: Pick<CoachLedger, "read">,
    private readonly recorder: TraceRecorder,
    private readonly index: TraceEventIndex,
    private readonly context: TraceProjectionContext,
  ) {}

  async reconcile(): Promise<TraceReconcileResult> {
    if (!this.recorder.enabled) return { backfilled: 0, skipped: 0 };
    const snapshot = await this.ledger.read();
    const projected = projectLedgerTraceEnvelopes(snapshot, this.context);
    const known = await this.index.knownEventIds();
    const missing = projected.filter((record) => !known.has(record.envelope.eventId));
    const ordered = [...missing].sort((left, right) =>
      left.envelope.orderKey.localeCompare(right.envelope.orderKey),
    );
    for (const record of ordered) {
      await this.recorder.writeEnvelope(record.envelope, { userId: record.userId });
    }
    return { backfilled: ordered.length, skipped: projected.length - ordered.length };
  }
}
