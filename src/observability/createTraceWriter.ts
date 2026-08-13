import type { CoachLedger } from "../coach/ledger";
import type { RuntimeServices } from "../coach/model";
import {
  LocalFileTraceSink,
  type LocalFileTraceSinkOptions,
  type TraceFileSystem,
} from "./LocalFileTraceSink";
import {
  createTraceTransport,
  type TraceFetch,
  type TraceTransportConfig,
} from "./RemoteTraceSink";
import {
  LedgerTraceOutboxSink,
  LedgerTraceUploadAuthorization,
  TraceOutboxDispatcher,
  type TraceDispatchResult,
} from "./TraceOutbox";
import {
  compositeTraceEventIndex,
  LedgerTraceEventIndex,
  LocalFileTraceEventIndex,
  TraceReconciler,
  type TraceEventIndex,
  type TraceReconcileResult,
} from "./TraceReconciler";
import { TraceRecorder, type TraceSink } from "./TraceRecorder";
import { TracingCoachLedger } from "./TracingCoachLedger";

/**
 * 部署配置。换日志供应商 = 改这个对象的 remote 字段，业务代码与埋点都不动。
 */
export interface TraceWriterConfig {
  /** 多设备 envelope 防撞号。 */
  deviceId: string;
  /** 本地 JSONL debug 开关：不配置就不装配本地 sink。 */
  localFile?: Omit<LocalFileTraceSinkOptions, "directory"> & { directory: string };
  /** 远程适配器：不配置就不装配远程 sink（也就不会有 outbox 条目）。 */
  remote?: TraceTransportConfig;
}

export interface TraceWriter {
  /** 装配了埋点的账本；未配置任何 sink 时就是原账本本身。 */
  ledger: CoachLedger;
  recorder: TraceRecorder;
  /** 启动时的崩溃窗口回填。 */
  reconcile(): Promise<TraceReconcileResult>;
  /** 网络恢复/退后台前的 outbox 补发。 */
  dispatch(userId: string): Promise<TraceDispatchResult>;
}

export interface CreateTraceWriterInput {
  ledger: CoachLedger;
  runtime: RuntimeServices;
  config: TraceWriterConfig;
  /** 本地 sink 需要；生产侧接 expo-file-system，测试接内存实现。 */
  files?: TraceFileSystem;
  /** 远程 sink 需要。 */
  fetch?: TraceFetch;
}

const NO_OP_RECONCILE: TraceReconcileResult = { backfilled: 0, skipped: 0 };
const NO_OP_DISPATCH: TraceDispatchResult = { status: "empty", sent: 0, remaining: 0 };

/**
 * 按配置装配写入侧全链路：本地 JSONL + 账本内 outbox + 远程适配器 + 回填。
 *
 * 一个 sink 都没配时返回原账本与空 recorder——可观测性关闭的代价就是零。
 */
export function createTraceWriter(input: CreateTraceWriterInput): TraceWriter {
  const context = { deviceId: input.config.deviceId };
  const sinks: TraceSink[] = [];
  const indexes: TraceEventIndex[] = [];

  let localSink: LocalFileTraceSink | undefined;
  if (input.config.localFile && input.files) {
    localSink = new LocalFileTraceSink(input.files, input.config.localFile);
    sinks.push(localSink);
    indexes.push(new LocalFileTraceEventIndex(input.files, localSink));
  }

  let dispatcher: TraceOutboxDispatcher | undefined;
  let outbox: LedgerTraceOutboxSink | undefined;
  let authorization: LedgerTraceUploadAuthorization | undefined;
  if (input.config.remote && input.fetch) {
    authorization = new LedgerTraceUploadAuthorization(input.ledger);
    outbox = new LedgerTraceOutboxSink(input.ledger, input.runtime, authorization);
    sinks.push(outbox);
    indexes.push(new LedgerTraceEventIndex(input.ledger));
    dispatcher = new TraceOutboxDispatcher(
      input.ledger,
      createTraceTransport(input.config.remote, input.fetch),
      input.runtime,
    );
  }

  if (!sinks.length) {
    return {
      ledger: input.ledger,
      recorder: new TraceRecorder(),
      async reconcile() {
        return NO_OP_RECONCILE;
      },
      async dispatch() {
        return NO_OP_DISPATCH;
      },
    };
  }

  const recorder = new TraceRecorder(sinks);
  const reconciler = new TraceReconciler(
    input.ledger,
    recorder,
    compositeTraceEventIndex(...indexes),
    context,
  );
  const queued = outbox;
  return {
    recorder,
    ledger: new TracingCoachLedger(input.ledger, {
      recorder,
      context,
      ...(queued ? { outbox: queued } : {}),
      ...(authorization ? { authorization } : {}),
    }),
    async reconcile() {
      const result = await reconciler.reconcile();
      await queued?.flush();
      return result;
    },
    async dispatch(userId: string) {
      if (!dispatcher) return NO_OP_DISPATCH;
      await queued?.flush();
      return dispatcher.dispatch(userId);
    },
  };
}
