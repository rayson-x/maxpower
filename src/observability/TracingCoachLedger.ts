import type {
  CoachLedger,
  CoachLedgerDiagnostics,
  DomainAtomicCommit,
  StagedLedgerRestore,
} from "../coach/ledger";
import type { DomainCommandResult, DomainProjection, DomainProjectionQuery } from "../coach/domain";
import type { LedgerSnapshot } from "../coach/model";
import { TRACE_DISPATCH_INTENT, TRACE_ENQUEUE_INTENT, type LedgerTraceUploadAuthorization } from "./TraceOutbox";
import {
  projectCommitTraceEnvelopes,
  type TraceProjectionContext,
  type TraceProjectionRecord,
} from "./traceProjection";
import type { TraceRecorder } from "./TraceRecorder";

/** flush 之后才算「远程侧已受理」；本地 sink 在 record 时就已经写完。 */
export interface TraceCommitFlusher {
  flush(): Promise<number>;
}

export interface TracingCoachLedgerOptions {
  recorder: TraceRecorder;
  context: TraceProjectionContext;
  /** 账本内 outbox 的批量落账端；未配置时只写本地。 */
  outbox?: TraceCommitFlusher;
  /** 权限变更后需要让授权缓存失效。 */
  authorization?: Pick<LedgerTraceUploadAuthorization, "invalidate">;
}

/**
 * 埋点的唯一接线点。
 *
 * 每个写入路径——provider 请求/响应、工具调用、policy 决策、输出过滤、
 * proposal/HITL、recipe 后台任务、同步、错误——最终都要经过账本 commit，
 * 所以在这里投影一次，就覆盖了全部行为，而不用把 recorder 穿进九千行应用代码。
 *
 * 顺序是「先落账后写 trace」：事件描述的是已提交事实，崩溃只会丢 trace，
 * 启动时的 TraceReconciler 能从账本原样补回来。
 */
export class TracingCoachLedger implements CoachLedger {
  constructor(
    private readonly inner: CoachLedger,
    private readonly options: TracingCoachLedgerOptions,
  ) {}

  read(): Promise<LedgerSnapshot> {
    return this.inner.read();
  }

  replace(snapshot: LedgerSnapshot): Promise<void> {
    this.options.authorization?.invalidate();
    return this.inner.replace(snapshot);
  }

  swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void> {
    this.options.authorization?.invalidate();
    return this.inner.swapRestoredSnapshot(input);
  }

  readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection> {
    return this.inner.readDomainProjection(query);
  }

  diagnose(): Promise<CoachLedgerDiagnostics> {
    return this.inner.diagnose();
  }

  async commit(input: DomainAtomicCommit): Promise<DomainCommandResult> {
    const result = await this.inner.commit(input);
    if (result.status === "committed") await this.recordCommit(input);
    return result;
  }

  async commitBatch(inputs: readonly DomainAtomicCommit[]): Promise<readonly DomainCommandResult[]> {
    const results = await this.inner.commitBatch(inputs);
    for (let index = 0; index < inputs.length; index += 1) {
      if (results[index]?.status === "committed") await this.recordCommit(inputs[index]!);
    }
    return results;
  }

  private async recordCommit(input: DomainAtomicCommit): Promise<void> {
    // trace 的入队/补发本身也是 commit；再投影一次会自我递归。
    if (input.intent === TRACE_ENQUEUE_INTENT || input.intent === TRACE_DISPATCH_INTENT) return;
    if (input.domainEvents.some((event) => event.name.startsWith("permission_set."))) {
      this.options.authorization?.invalidate(input.userId);
    }
    await this.record(() => projectCommitTraceEnvelopes(input, this.options.context));
  }

  private async record(project: () => readonly TraceProjectionRecord[]): Promise<void> {
    if (!this.options.recorder.enabled) return;
    try {
      for (const record of project()) {
        await this.options.recorder.writeEnvelope(record.envelope, { userId: record.userId });
      }
      await this.options.outbox?.flush();
    } catch {
      // 可观测性不能成为故障源：事实已经落账，trace 丢了由 reconcile 补。
    }
  }
}
