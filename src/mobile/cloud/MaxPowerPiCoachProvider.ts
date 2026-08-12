import type { AssistantMessageEvent, Context, ToolCall } from "@mariozechner/pi-ai";

import type {
  LLMProvider,
  LLMProviderRequest,
  LLMProviderResolver,
  LLMProviderResumeRequest,
  ProviderEvent,
} from "../../coach/adapters/provider";
import { deterministicExecutionRoute } from "../../coach/adapters/provider";
import { ProviderServiceError } from "../../coach/adapters/provider";
import { remoteCoachContext } from "../../coach/adapters/remoteCoachContext";
import { stableHash } from "../../coach/stable";
import { maxPowerApiOrigin } from "./cloudServiceValidation";
import {
  MAXPOWER_PI_COACH_ALIAS,
  MaxPowerPiLlmProvider,
  type MaxPowerPiFetch,
} from "./MaxPowerPiLlmProvider";
import type { CloudServiceAccessTokenSource } from "./MaxPowerCloudLlmProvider";

export interface MaxPowerPiCoachProviderOptions {
  apiBaseUrl: string;
  allowInsecureHttp?: boolean;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  accountSignal?: AbortSignal;
  fetch?: MaxPowerPiFetch;
}

/** Adapts Pi stream semantics to the local Coach language seam. */
export class MaxPowerPiCoachProvider implements LLMProvider {
  readonly kind = "maxpower-pi-cloud";
  readonly usesNetwork = true;
  readonly model = MAXPOWER_PI_COACH_ALIAS;
  readonly configurationFingerprint: string;

  private readonly origin: string;

  constructor(private readonly options: MaxPowerPiCoachProviderOptions) {
    this.origin = maxPowerApiOrigin(options.apiBaseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.configurationFingerprint = stableHash({
      kind: this.kind,
      origin: this.origin,
      alias: this.model,
    });
  }

  stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    return this.invoke(request);
  }

  resume(request: LLMProviderResumeRequest): AsyncIterable<ProviderEvent> {
    return this.invoke(request);
  }

  private async *invoke(
    request: LLMProviderRequest | LLMProviderResumeRequest,
  ): AsyncIterable<ProviderEvent> {
    if (this.options.accountSignal?.aborted) throw new ProviderServiceError("account_switched");
    // Records and future-plan adjustments must follow the same deterministic
    // route on device and in the cloud-backed Coach. The remote model remains
    // responsible for normal language interaction only.
    if (!("continuation" in request)) {
      const route = deterministicExecutionRoute(request);
      if (route) {
        yield* route;
        return;
      }
    }
    const pi = new MaxPowerPiLlmProvider({
      apiBaseUrl: this.origin,
      ...(this.options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: this.options.allowInsecureHttp }),
      accountId: this.options.accountId,
      accessTokens: this.options.accessTokens,
      accountSignal: this.options.accountSignal,
      modelAlias: MAXPOWER_PI_COACH_ALIAS,
      invocationId: () => invocationId(this.options.accountId, request),
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    const stream = pi.streamFn(pi.model, toPiContext(request), {
      signal: request.signal,
      maxTokens: pi.model.maxTokens,
    });
    for await (const event of stream) {
      const mapped = providerEvent(event);
      if (mapped) yield mapped;
    }
  }
}

export type MaxPowerPiCoachProviderResolverOptions = MaxPowerPiCoachProviderOptions;

export class MaxPowerPiCoachProviderResolver implements LLMProviderResolver {
  private readonly provider: MaxPowerPiCoachProvider;

  constructor(private readonly options: MaxPowerPiCoachProviderResolverOptions) {
    this.provider = new MaxPowerPiCoachProvider(options);
  }

  async resolve(input: Parameters<LLMProviderResolver["resolve"]>[0]): Promise<LLMProvider> {
    if (input.userId !== this.options.accountId) throw new Error("cloud_llm_account_mismatch");
    if (input.prior && (
      input.prior.kind !== this.provider.kind
      || input.prior.configurationFingerprint !== this.provider.configurationFingerprint
    )) {
      throw new Error("cloud_llm_runtime_changed");
    }
    return this.provider;
  }
}

function toPiContext(request: LLMProviderRequest | LLMProviderResumeRequest): Context {
  const remote = remoteCoachContext(request);
  return {
    systemPrompt: remote.systemPrompt,
    messages: [{ role: "user", content: remote.userContent, timestamp: Date.now() }],
    tools: remote.toolManifest.map((tool) => ({
      name: tool.name,
      description: `MaxPower ${tool.accessClass} tool (${tool.name})`,
      parameters: tool.inputSchema as never,
    })),
  };
}

function providerEvent(event: AssistantMessageEvent): ProviderEvent | undefined {
  if (event.type === "text_delta") {
    return { type: "text-delta", delta: event.delta };
  }
  if (event.type === "toolcall_delta") {
    const call = event.partial.content[event.contentIndex];
    if (call?.type !== "toolCall" || !call.id || !call.name || !event.delta) return undefined;
    return {
      type: "tool-input-delta",
      toolCallId: call.id,
      toolName: call.name,
      delta: event.delta,
    };
  }
  if (event.type === "toolcall_end") return completedToolCall(event.toolCall);
  if (event.type === "done") return { type: "completed" };
  if (event.type === "error") {
    if (event.reason === "aborted") return { type: "cancelled", reason: "user" };
    throw serviceError(event.error.errorMessage);
  }
  return undefined;
}

function completedToolCall(call: ToolCall): ProviderEvent {
  return {
    type: "tool-call",
    toolCallId: call.id,
    toolName: call.name,
    input: call.arguments,
  };
}

function serviceError(code?: string): ProviderServiceError {
  if (code === "quota_exceeded" || code === "allowance_exhausted") {
    return new ProviderServiceError("allowance_exhausted");
  }
  if (code === "invalid_access_token" || code === "authentication_required") {
    return new ProviderServiceError("authentication_required");
  }
  if (code === "permission_denied" || code === "missing_scope") {
    return new ProviderServiceError("permission_denied");
  }
  if (code === "request_conflict") return new ProviderServiceError("request_conflict");
  return new ProviderServiceError("service_unavailable");
}

function invocationId(
  accountId: string,
  request: LLMProviderRequest | LLMProviderResumeRequest,
): string {
  return `coach-${stableHash({
    accountId,
    sessionId: request.sessionId,
    runId: request.runId,
    ...( "continuation" in request ? { continuation: request.continuation } : {}),
  })}`;
}
