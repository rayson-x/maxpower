import {
  buildTraceEnvelope,
  validateTraceEnvelope,
  TraceEnvelopeValidationError,
  type TraceEnvelope,
  type TraceEnvelopeInput,
} from "./model";

/** sink 写入时可用的本地上下文；envelope 本身绝不带 userId。 */
export interface TraceWriteContext {
  userId: string;
}

/** 写入端口：生产代码只依赖这个接口。 */
export interface TraceSink {
  readonly name: string;
  write(envelope: TraceEnvelope, context: TraceWriteContext): Promise<void>;
}

/** 无 sink 时的零成本 no-op（默认状态 = 不写）。 */
export const NULL_TRACE_SINK: TraceSink = {
  name: "null",
  async write() {},
};

export interface TraceRecorderStats {
  recorded: number;
  /** 校验不通过被丢弃的事件数。 */
  rejected: number;
  /** 因内容相同（同 eventId）被就地去重的事件数。 */
  duplicates: number;
  /** 按 sink 名统计的写入失败数；失败只计数不阻断业务。 */
  failures: Readonly<Record<string, number>>;
}

/**
 * 写入门面：校验后扇出到全部 sink。
 *
 * 可观测性不能成为故障源——任何 sink 抛错都只累加计数器，业务路径不受影响；
 * 没有配置 sink 时 record 直接返回，不做任何构造工作。
 */
/** 进程内最近写过的 eventId 保留数；只用于抑制同一事实的即时重复投影。 */
export const TRACE_RECENT_EVENT_MEMORY = 512;

export class TraceRecorder {
  private recorded = 0;
  private rejected = 0;
  private duplicates = 0;
  private readonly failures = new Map<string, number>();
  private readonly recent = new Set<string>();

  constructor(private readonly sinks: readonly TraceSink[] = []) {}

  get enabled(): boolean {
    return this.sinks.length > 0;
  }

  stats(): TraceRecorderStats {
    return {
      recorded: this.recorded,
      rejected: this.rejected,
      duplicates: this.duplicates,
      failures: Object.fromEntries(this.failures),
    };
  }

  /** 由内容派生 eventId/orderKey 后写入；返回落盘的 envelope（无 sink 时为 undefined）。 */
  async record(input: TraceEnvelopeInput, context: TraceWriteContext): Promise<TraceEnvelope | undefined> {
    if (!this.sinks.length) return undefined;
    let envelope: TraceEnvelope;
    try {
      envelope = buildTraceEnvelope(input);
    } catch (error) {
      if (error instanceof TraceEnvelopeValidationError) {
        this.rejected += 1;
        return undefined;
      }
      throw error;
    }
    await this.write(envelope, context);
    return envelope;
  }

  /** 写入已构造好的 envelope（回填与补发路径复用同一校验与扇出）。 */
  async writeEnvelope(envelope: TraceEnvelope, context: TraceWriteContext): Promise<void> {
    if (!this.sinks.length) return;
    try {
      validateTraceEnvelope(envelope);
    } catch (error) {
      if (error instanceof TraceEnvelopeValidationError) {
        this.rejected += 1;
        return;
      }
      throw error;
    }
    await this.write(envelope, context);
  }

  private async write(envelope: TraceEnvelope, context: TraceWriteContext): Promise<void> {
    // 同一条已提交事实会在多次 commit 里被重新投影（例如 run 记录被反复 upsert）。
    // eventId 是内容哈希，所以同一事实的重复投影在这里就被吃掉，本地日志不会
    // 出现重复行。跨进程的幂等仍由 TraceReconciler 的持久化索引负责。
    if (this.recent.has(envelope.eventId)) {
      this.duplicates += 1;
      return;
    }
    if (this.recent.size >= TRACE_RECENT_EVENT_MEMORY) {
      const oldest = this.recent.values().next().value;
      if (oldest !== undefined) this.recent.delete(oldest);
    }
    this.recent.add(envelope.eventId);
    this.recorded += 1;
    await Promise.all(
      this.sinks.map((sink) =>
        sink.write(envelope, context).catch(() => {
          this.failures.set(sink.name, (this.failures.get(sink.name) ?? 0) + 1);
        }),
      ),
    );
  }
}
