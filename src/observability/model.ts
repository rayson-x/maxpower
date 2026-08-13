/**
 * Agent 全行为 trace 的统一事件模型（TraceEnvelope）。
 *
 * 两个 provider 分离：
 * - 写入（本目录）：生产代码路径，agent/planner 行为的统一事件源。
 * - 读取（后续单独实现）：开发调试用的日志分析器，按 traceId/sessionId 检索。
 *
 * ID 语义（设计共识）：
 * - traceId = runId（一次行动：一次用户对话/一次 proposal/一次 replan）
 * - sessionId = 长会话 id；后台场景用 BACKGROUND_TRACE_SESSION_ID
 * - parentTraceId = 行动内的子步骤（HITL 续跑、级联 replan）
 * - orderKey = dotted_order 式嵌套排序键，保证回填与乱序事件的回放顺序确定
 * - eventId = 内容稳定哈希，同一事实重复投影只产生一条事件
 *
 * 隐私不变量：事件只含元数据与引用（fact/artifact refs、决策码、版本钉），
 * 绝不写对话文本与直接标识符；远程适配器沿用同一约束。
 */
import { stableStringify } from "../coach/stable";

export const TRACE_ENVELOPE_SCHEMA_VERSION = 2 as const;

/** 非会话场景（recipe/sync/启动回填）的稳定 sessionId。 */
export const BACKGROUND_TRACE_SESSION_ID = "session:background";

/** kind 闭集，对齐 OTel GenAI / OpenInference 的 span 分类习惯。 */
export const TRACE_EVENT_KINDS = [
  "agent",
  "turn",
  "llm",
  "tool",
  "guardrail",
  "evaluator",
  "plan",
  "recipe",
  "sync",
  "error",
] as const;

export type TraceEventKind = (typeof TRACE_EVENT_KINDS)[number];

export type TraceOutcome = "started" | "ok" | "failed" | "rejected" | "degraded";

export type TraceMetadata = Readonly<Record<string, string | number | boolean>>;

/** metadata 字符串值上限：元数据是可索引的短值，不是自由文本的藏身处。 */
export const TRACE_METADATA_VALUE_MAX_LENGTH = 200;

const TRACE_EVENT_NAME_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;
/** 引用和版本钉只能是短的结构化标识，不能借 trace 偷塞原话。 */
const TRACE_STRUCTURED_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

export interface TraceEnvelope {
  schemaVersion: typeof TRACE_ENVELOPE_SCHEMA_VERSION;
  /** 内容稳定哈希；服务端与 outbox 都按它去重。 */
  eventId: string;
  /** = runId；一次行动的统一追踪 id。 */
  traceId: string;
  /** 长会话 id。 */
  sessionId: string;
  parentTraceId?: string;
  /** dotted_order 式嵌套排序键；字典序 = 回放顺序。 */
  orderKey: string;
  kind: TraceEventKind;
  /** 闭集之下的结构化事件名（`provider.request` 式），永远不是自由文本。 */
  name: string;
  occurredAt: string;
  /** 发起者：agent_runtime / rule_engine / planner / user / system。 */
  actor: string;
  /** 现有 userPseudonym 哈希；绝不是 userId。 */
  userPseudonym: string;
  /** 多设备防撞号。 */
  deviceId: string;
  outcome?: TraceOutcome;
  /** 结构化决策码（可检索）：reasonCodes / terminalCode / filter rule ids。 */
  decisionCodes?: readonly string[];
  /** 可回放行为决策的稳定身份；普通 trace 事件省略。 */
  decisionId?: string;
  /** 触发本决策的已提交事件或调度信号身份。 */
  causationIds?: readonly string[];
  /** 相关 artifact/fact 引用（只存 ref，不存内容）。 */
  artifactRefs?: readonly string[];
  factRefs?: readonly string[];
  /** 决策读取过的输入引用；与本次事实前沿分开，便于回放。 */
  inputRefs?: readonly string[];
  /** 目标、计划、规则、知识与策略等版本钉。 */
  versionPins?: Readonly<Record<string, string>>;
  durationMs?: number;
  metadata?: TraceMetadata;
}

export type TraceEnvelopeValidationCode =
  | "missing_identity"
  | "unknown_kind"
  | "invalid_event_name"
  | "invalid_order_key"
  | "direct_identifier"
  | "invalid_causation_id"
  | "invalid_trace_reference"
  | "invalid_version_pin"
  | "non_primitive_metadata"
  | "metadata_value_too_long";

export class TraceEnvelopeValidationError extends Error {
  constructor(readonly code: TraceEnvelopeValidationCode) {
    super(`trace_envelope_${code}`);
    this.name = "TraceEnvelopeValidationError";
  }
}

/** 假名前缀，与 ToolAuditRecord.userPseudonym 保持一致。 */
export const TRACE_PSEUDONYM_PREFIX = "local-";

export function traceUserPseudonym(userId: string, hash: (value: unknown) => string): string {
  return `${TRACE_PSEUDONYM_PREFIX}${hash({ userId })}`;
}

export function validateTraceEnvelope(envelope: TraceEnvelope): void {
  if (
    !envelope.eventId ||
    !envelope.traceId ||
    !envelope.sessionId ||
    !envelope.actor ||
    !envelope.deviceId ||
    !envelope.userPseudonym ||
    !envelope.occurredAt
  ) {
    throw new TraceEnvelopeValidationError("missing_identity");
  }
  if (!TRACE_EVENT_KINDS.includes(envelope.kind)) {
    throw new TraceEnvelopeValidationError("unknown_kind");
  }
  if (!TRACE_EVENT_NAME_PATTERN.test(envelope.name)) {
    throw new TraceEnvelopeValidationError("invalid_event_name");
  }
  if (!envelope.orderKey || !envelope.orderKey.includes("#")) {
    throw new TraceEnvelopeValidationError("invalid_order_key");
  }
  if (!envelope.userPseudonym.startsWith(TRACE_PSEUDONYM_PREFIX)) {
    throw new TraceEnvelopeValidationError("direct_identifier");
  }
  if (
    (envelope.decisionId !== undefined && !TRACE_STRUCTURED_IDENTIFIER_PATTERN.test(envelope.decisionId)) ||
    (envelope.causationIds ?? []).some((id) => !TRACE_STRUCTURED_IDENTIFIER_PATTERN.test(id))
  ) {
    throw new TraceEnvelopeValidationError("invalid_causation_id");
  }
  // factRefs/artifactRefs 早于这一版 trace，兼容它们的既有 opaque 格式；
  // inputRefs 是新增行为审计字段，因此从第一天起保持可安全索引。
  if ((envelope.inputRefs ?? []).some((ref) => !TRACE_STRUCTURED_IDENTIFIER_PATTERN.test(ref))) {
    throw new TraceEnvelopeValidationError("invalid_trace_reference");
  }
  if (
    Object.entries(envelope.versionPins ?? {}).some(
      ([key, value]) =>
        !TRACE_STRUCTURED_IDENTIFIER_PATTERN.test(key) || !TRACE_STRUCTURED_IDENTIFIER_PATTERN.test(value),
    )
  ) {
    throw new TraceEnvelopeValidationError("invalid_version_pin");
  }
  for (const value of Object.values(envelope.metadata ?? {})) {
    if (!["string", "number", "boolean"].includes(typeof value)) {
      throw new TraceEnvelopeValidationError("non_primitive_metadata");
    }
    if (typeof value === "string" && value.length > TRACE_METADATA_VALUE_MAX_LENGTH) {
      throw new TraceEnvelopeValidationError("metadata_value_too_long");
    }
  }
}

/** buildTraceEnvelope 的输入：eventId 与 orderKey 由内容派生，调用方不能伪造。 */
export type TraceEnvelopeInput = Omit<
  TraceEnvelope,
  "schemaVersion" | "eventId" | "orderKey"
> & {
  /** 父事件的 orderKey；缺省时挂在本次行动的根前缀下。 */
  parentOrderKey?: string;
};

/**
 * 由内容派生 eventId 与 orderKey 并校验。同一事实重复投影必得同一 envelope，
 * 因此崩溃回填与离线补发都是幂等的。
 */
export function buildTraceEnvelope(input: TraceEnvelopeInput): TraceEnvelope {
  const { parentOrderKey, ...core } = input;
  const eventId = traceEventId(core);
  const envelope: TraceEnvelope = {
    schemaVersion: TRACE_ENVELOPE_SCHEMA_VERSION,
    eventId,
    orderKey: traceOrderKey(
      parentOrderKey ?? traceRootOrderKey(core.traceId),
      core.occurredAt,
      eventId,
    ),
    ...core,
  };
  validateTraceEnvelope(envelope);
  return envelope;
}

export function traceEventId(core: Omit<TraceEnvelope, "schemaVersion" | "eventId" | "orderKey">): string {
  return `tev-${traceContentHash(core)}`;
}

export function traceOrderKey(parentOrderKey: string, occurredAt: string, eventId: string): string {
  return `${parentOrderKey}.${occurredAt}#${eventId.slice(-8)}`;
}

/**
 * 一次行动内所有事件共享的前缀段。它只由 traceId 决定，因此乱序到达、跨进程
 * 回填、离线补发都能算出同一个前缀——按 orderKey 字典序排序即可还原
 * 「按行动分组、组内按时间」的回放顺序。
 */
export function traceRootOrderKey(traceId: string): string {
  return `${compactTraceToken(traceId)}#0`;
}

/**
 * 用户报错时口播/粘贴的短码：traceId 前 8 位 + sessionId 前 4 位。
 * 先剥掉分隔符再取位，否则 `coach-run-1` 这类 id 的前 8 位没有区分度。
 */
export function traceShortCode(input: { traceId: string; sessionId: string }): string {
  return `${compactTraceToken(input.traceId).toUpperCase().slice(0, 8)}-${compactTraceToken(input.sessionId)
    .toUpperCase()
    .slice(0, 4)}`;
}

function compactTraceToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * 64 位 FNV-1a。共享的 stableHash 是 32 位，对 idempotencyKey 足够，但 trace 的
 * eventId 是全局去重键——一次碰撞会静默吞掉一条诊断事件，所以这里加宽。
 */
export function traceContentHash(value: unknown): string {
  const input = stableStringify(value);
  let high = 0x811c9dc5;
  let low = 0x01000193;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    high = Math.imul(high ^ code, 0x01000193);
    low = Math.imul(low ^ code, 0x85ebca6b);
  }
  return `${(high >>> 0).toString(16).padStart(8, "0")}${(low >>> 0).toString(16).padStart(8, "0")}`;
}

/** 远程上报的账本内 outbox 条目（复用 pendingEnvelope 模式）。 */
export interface TraceOutboxEntry {
  /** = eventId；插入去重键。 */
  id: string;
  userId: string;
  eventId: string;
  deviceId: string;
  kind: TraceEventKind;
  occurredAt: string;
  payloadHash: string;
  envelope: TraceEnvelope;
  status: "pending" | "sent" | "abandoned";
  attempts: number;
  createdAt: string;
  lastAttemptAt?: string;
  sentAt?: string;
}

/** 账本内 trace outbox 的保留上限；超出后先丢最旧的已发送条目。 */
export const TRACE_OUTBOX_RETENTION = 2000;
