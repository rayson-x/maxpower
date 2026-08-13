import type { TraceEnvelope } from "./model";

/**
 * 远程上报的适配器端口。面向海外部署时换供应商只改部署配置，业务代码不变：
 * 配置里的 kind 决定装配哪个适配器，调用方永远只看见 TraceTransport。
 */
export interface TraceTransport {
  readonly kind: TraceTransportConfig["kind"];
  send(batch: readonly TraceEnvelope[]): Promise<TraceTransportResult>;
}

export type TraceTransportResult =
  /** 服务端已接收（at-least-once：服务端按 eventId 去重）。 */
  | { status: "accepted" }
  /** 请求本身不合法，重试不会变好——条目应被放弃而不是永久占用 outbox。 */
  | { status: "rejected"; code: string }
  /** 断网或服务端暂时不可用——条目留在 outbox 等下次补发。 */
  | { status: "unavailable"; code: string };

export type TraceTransportConfig =
  | { kind: "generic_http"; endpoint: string; headers?: Readonly<Record<string, string>> }
  | {
      kind: "cloudwatch_logs";
      endpoint: string;
      logGroupName: string;
      logStreamName: string;
      headers?: Readonly<Record<string, string>>;
    }
  | {
      kind: "aliyun_sls";
      endpoint: string;
      project: string;
      logstore: string;
      headers?: Readonly<Record<string, string>>;
    }
  | { kind: "otlp_http"; endpoint: string; headers?: Readonly<Record<string, string>> };

/** 只需要 fetch 的请求/响应形状；不引入平台 fetch 类型依赖。 */
export type TraceFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

/**
 * 按部署配置装配适配器。新增供应商 = 在这里加一个 case + 一个 body 形状，
 * 埋点与 outbox 调度都不需要知道。
 */
export function createTraceTransport(
  config: TraceTransportConfig,
  fetchLike: TraceFetch,
): TraceTransport {
  return {
    kind: config.kind,
    async send(batch) {
      if (!batch.length) return { status: "accepted" };
      const request = traceTransportRequest(config, batch);
      let response: { ok: boolean; status: number };
      try {
        response = await fetchLike(request.url, {
          method: "POST",
          headers: request.headers,
          body: request.body,
        });
      } catch {
        return { status: "unavailable", code: "transport_unreachable" };
      }
      if (response.ok) return { status: "accepted" };
      if (response.status >= 500 || response.status === 429) {
        return { status: "unavailable", code: `http_${response.status}` };
      }
      return { status: "rejected", code: `http_${response.status}` };
    },
  };
}

export interface TraceTransportRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** 导出为纯函数，便于对每个供应商的线上形状做断言。 */
export function traceTransportRequest(
  config: TraceTransportConfig,
  batch: readonly TraceEnvelope[],
): TraceTransportRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(config.headers ?? {}),
  };
  if (config.kind === "cloudwatch_logs") {
    return {
      url: config.endpoint,
      headers: { ...headers, "x-amz-target": "Logs_20140328.PutLogEvents" },
      body: JSON.stringify({
        logGroupName: config.logGroupName,
        logStreamName: config.logStreamName,
        logEvents: batch.map((envelope) => ({
          timestamp: Date.parse(envelope.occurredAt),
          message: JSON.stringify(envelope),
        })),
      }),
    };
  }
  if (config.kind === "aliyun_sls") {
    return {
      url: `${config.endpoint}/logstores/${config.logstore}/track`,
      headers: { ...headers, "x-log-apiversion": "0.6.0", "x-log-project": config.project },
      body: JSON.stringify({
        __logs__: batch.map((envelope) => ({
          ...envelope,
          __time__: Math.floor(Date.parse(envelope.occurredAt) / 1000),
        })),
      }),
    };
  }
  if (config.kind === "otlp_http") {
    return {
      url: `${config.endpoint}/v1/logs`,
      headers,
      body: JSON.stringify({
        resourceLogs: [
          {
            scopeLogs: [
              {
                scope: { name: "maxpower.observability" },
                logRecords: batch.map((envelope) => ({
                  timeUnixNano: `${Date.parse(envelope.occurredAt)}000000`,
                  attributes: otlpAttributes(envelope),
                })),
              },
            ],
          },
        ],
      }),
    };
  }
  return {
    url: config.endpoint,
    headers,
    body: JSON.stringify({ schemaVersion: batch[0]?.schemaVersion, events: batch }),
  };
}

/**
 * 字段命名对齐 OTel GenAI 语义（不接 OTel SDK、不上 OTLP 协议栈；
 * 将来要接 Collector 只加映射，不改事件模型）。
 */
function otlpAttributes(envelope: TraceEnvelope): readonly { key: string; value: { stringValue: string } }[] {
  const attributes: Record<string, string> = {
    "gen_ai.conversation.id": envelope.sessionId,
    "maxpower.trace.id": envelope.traceId,
    "maxpower.trace.event_id": envelope.eventId,
    "maxpower.trace.order_key": envelope.orderKey,
    "maxpower.trace.kind": envelope.kind,
    "maxpower.trace.name": envelope.name,
    "maxpower.trace.actor": envelope.actor,
    "enduser.pseudo.id": envelope.userPseudonym,
    "device.id": envelope.deviceId,
    ...(envelope.parentTraceId ? { "maxpower.trace.parent_id": envelope.parentTraceId } : {}),
    ...(envelope.outcome ? { "maxpower.trace.outcome": envelope.outcome } : {}),
    ...(envelope.decisionCodes?.length
      ? { "maxpower.trace.decision_codes": envelope.decisionCodes.join(",") }
      : {}),
  };
  for (const [key, value] of Object.entries(envelope.metadata ?? {})) {
    attributes[`maxpower.trace.metadata.${key}`] = String(value);
  }
  return Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: value } }));
}
