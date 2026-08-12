import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  OpenAICompletionsOptions,
  TextContent,
  ToolCall,
} from "@mariozechner/pi-ai";

import { openAiCompatibleToolName } from "../../coach/adapters/openAiToolName";
import { CloudInvocationCancellationClient } from "./CloudInvocationCancellationClient";
import type { CloudServiceAccessTokenSource } from "./MaxPowerCloudLlmProvider";
import { maxPowerApiOrigin, requiredCloudText } from "./cloudServiceValidation";
import { linkAbortSignals } from "./linkAbortSignals";

export const MAXPOWER_PI_PROVIDER = "maxpower";
export const MAXPOWER_PI_COACH_ALIAS = "maxpower/coach-v1";
export const MAXPOWER_PI_NUTRITION_VISION_ALIAS = "maxpower/nutrition-vision-v1";

export type MaxPowerPiModelAlias =
  | typeof MAXPOWER_PI_COACH_ALIAS
  | typeof MAXPOWER_PI_NUTRITION_VISION_ALIAS;

export interface MaxPowerPiFetchResponse {
  ok: boolean;
  status: number;
  body?: ReadableStream<Uint8Array> | null;
  json?(): Promise<unknown>;
  headers?: { get(name: string): string | null };
}

export interface MaxPowerPiFetch {
  (
    url: string,
    init: {
      method: "GET" | "POST";
      headers: Readonly<Record<string, string>>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<MaxPowerPiFetchResponse>;
}

export interface MaxPowerPiLlmProviderOptions {
  apiBaseUrl: string;
  allowInsecureHttp?: boolean;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  /** Selects a managed product capability, never a physical provider model. */
  modelAlias?: MaxPowerPiModelAlias;
  accountSignal?: AbortSignal;
  fetch?: MaxPowerPiFetch;
  /** Injectable only for deterministic tests. Values must be safe HTTP-header tokens. */
  invocationId?: () => string;
  cancellationAttemptTimeoutMs?: number;
  cancellationRetryDelayMs?: number;
  maxResumeAttempts?: number;
}

interface StreamState {
  readonly output: AssistantMessage;
  started: boolean;
  finished: boolean;
  textBlock?: TextContent;
  readonly toolCalls: Map<number, MutableToolCall>;
  readonly toolNamesByWireName: Map<string, string>;
}

interface MutableToolCall extends ToolCall {
  partialArguments: string;
}

interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

class TerminalPiStreamError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "TerminalPiStreamError";
  }
}

/**
 * Pi-facing cloud module. Callers spread `model`, `streamFn` and `getApiKey`
 * into a Pi Agent; JWT refresh, request identity, SSE recovery and durable
 * cancellation remain behind this interface.
 */
export class MaxPowerPiLlmProvider {
  readonly model: Model<"openai-completions">;
  readonly streamFn: (
    model: Model<any>,
    context: Context,
    options?: OpenAICompletionsOptions,
  ) => AssistantMessageEventStream;
  readonly getApiKey: (provider: string) => Promise<string | undefined>;

  private readonly origin: string;
  private readonly accountId: string;
  private readonly accessTokens: CloudServiceAccessTokenSource;
  private readonly accountSignal?: AbortSignal;
  private readonly fetchImpl: MaxPowerPiFetch;
  private readonly nextInvocationId: () => string;
  private readonly cancellations: CloudInvocationCancellationClient;
  private readonly maxResumeAttempts: number;

  constructor(options: MaxPowerPiLlmProviderOptions) {
    this.origin = maxPowerApiOrigin(options.apiBaseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.accountId = requiredCloudText(options.accountId, "pi_llm_account_required");
    this.accessTokens = options.accessTokens;
    this.accountSignal = options.accountSignal;
    this.fetchImpl = options.fetch
      ?? (globalThis.fetch?.bind(globalThis) as unknown as MaxPowerPiFetch);
    if (!this.fetchImpl) throw new Error("pi_llm_fetch_unavailable");
    this.nextInvocationId = options.invocationId ?? defaultInvocationId;
    this.maxResumeAttempts = nonNegativeInteger(options.maxResumeAttempts ?? 2);
    const alias = options.modelAlias ?? MAXPOWER_PI_COACH_ALIAS;
    const capability = PI_MODEL_CAPABILITIES[alias];
    const model: Model<"openai-completions"> = {
      id: alias,
      name: capability.name,
      api: "openai-completions",
      provider: MAXPOWER_PI_PROVIDER,
      baseUrl: new URL("/v1", this.origin).toString(),
      reasoning: false,
      input: [...capability.input],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: capability.contextWindow,
      maxTokens: capability.maxTokens,
      compat: {
        supportsStore: true,
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
        supportsUsageInStreaming: true,
        maxTokensField: "max_tokens",
        supportsStrictMode: false,
        sendSessionAffinityHeaders: false,
        supportsLongCacheRetention: false,
      },
    };
    this.model = Object.freeze(model);
    this.cancellations = new CloudInvocationCancellationClient({
      apiBaseUrl: this.origin,
      ...(options.allowInsecureHttp === undefined
        ? {}
        : { allowInsecureHttp: options.allowInsecureHttp }),
      accountId: this.accountId,
      accessTokens: this.accessTokens,
      fetch: (url, init) => this.fetchImpl(url, init),
      ...(options.cancellationAttemptTimeoutMs === undefined
        ? {}
        : { attemptTimeoutMs: options.cancellationAttemptTimeoutMs }),
      ...(options.cancellationRetryDelayMs === undefined
        ? {}
        : { retryDelayMs: options.cancellationRetryDelayMs }),
    });
    this.getApiKey = async (provider) => {
      if (provider !== MAXPOWER_PI_PROVIDER) return undefined;
      return requiredCloudText(
        await this.accessTokens.accessTokenFor(this.accountId),
        "pi_llm_access_token_required",
      );
    };
    this.streamFn = (model, context, streamOptions) =>
      this.startStream(model, context, streamOptions);
  }

  private startStream(
    model: Model<any>,
    context: Context,
    options?: OpenAICompletionsOptions,
  ): AssistantMessageEventStream {
    const events = new LocalPiEventStream();
    void this.run(events, model, context, options);
    return events.asPiStream();
  }

  private async run(
    events: LocalPiEventStream,
    model: Model<any>,
    context: Context,
    options?: OpenAICompletionsOptions,
  ): Promise<void> {
    const state = createStreamState(model);
    const linked = linkAbortSignals(options?.signal, this.accountSignal);
    const invocationToken = safeInvocationToken(this.nextInvocationId());
    const idempotencyKey = `pi-${invocationToken}`;
    let requestStarted = false;
    try {
      assertExpectedModel(model, this.model.id);
      if (linked.signal?.aborted) throw new Error("pi_llm_aborted_before_request");
      const token = requiredCloudText(
        options?.apiKey ?? await this.accessTokens.accessTokenFor(this.accountId),
        "pi_llm_access_token_required",
      );
      const headers = {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        "x-client-run-id": `pi-run-${invocationToken}`,
      };
      requestStarted = true;
      let response = await this.fetchImpl(
        new URL("/v1/chat/completions", this.origin).toString(),
        {
          method: "POST",
          headers,
          body: JSON.stringify(buildRequest(model, context, options, state.toolNamesByWireName)),
          ...(linked.signal ? { signal: linked.signal } : {}),
        },
      );
      await assertSuccessful(response);
      let invocationId = response.headers?.get("x-maxpower-invocation-id") ?? undefined;
      let lastEventId = "0";
      let resumeAttempts = 0;

      while (!state.finished) {
        try {
          if (!response.body) throw new Error("pi_llm_stream_unavailable");
          for await (const frame of readSseFrames(response.body)) {
            consumeFrame(events, state, frame);
            if (frame.id !== undefined) lastEventId = frame.id;
            if (state.finished) break;
          }
          if (!state.finished) throw new Error("pi_llm_stream_ended_without_done");
        } catch (error) {
          if (linked.signal?.aborted) throw error;
          if (error instanceof TerminalPiStreamError) throw error;
          if (!invocationId || resumeAttempts >= this.maxResumeAttempts) throw error;
          resumeAttempts += 1;
          const refreshed = requiredCloudText(
            await this.accessTokens.accessTokenFor(this.accountId),
            "pi_llm_access_token_required",
          );
          response = await this.fetchImpl(
            new URL(`/v1/invocations/${encodeURIComponent(invocationId)}/events`, this.origin)
              .toString(),
            {
              method: "GET",
              headers: {
                authorization: `Bearer ${refreshed}`,
                "last-event-id": lastEventId,
              },
              ...(linked.signal ? { signal: linked.signal } : {}),
            },
          );
          await assertSuccessful(response);
          invocationId = response.headers?.get("x-maxpower-invocation-id") ?? invocationId;
        }
      }
    } catch (error) {
      let cancellationError: unknown;
      if (linked.signal?.aborted && requestStarted) {
        try {
          await this.cancellations.cancel(idempotencyKey);
        } catch (cause) {
          cancellationError = cause;
        }
      }
      state.output.stopReason = linked.signal?.aborted ? "aborted" : "error";
      state.output.errorMessage = cancellationError === undefined
        ? publicErrorMessage(error)
        : "maxpower_pi_cancel_failed";
      events.push({
        type: "error",
        reason: state.output.stopReason,
        error: state.output,
      });
      events.end();
    } finally {
      linked.dispose();
    }
  }
}

function buildRequest(
  model: Model<any>,
  context: Context,
  options?: OpenAICompletionsOptions,
  toolNamesByWireName: Map<string, string> = new Map(),
): Record<string, unknown> {
  const tools = context.tools?.map((tool) => ({
    type: "function",
    function: {
      name: registerToolName(tool.name, toolNamesByWireName),
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
  return {
    model: model.id,
    messages: openAiMessages(model, context, toolNamesByWireName),
    stream: true,
    store: false,
    stream_options: { include_usage: true },
    max_tokens: options?.maxTokens ?? model.maxTokens,
    ...(options?.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(tools === undefined || tools.length === 0
      ? {}
      : { tools, parallel_tool_calls: false }),
    ...(options?.toolChoice === undefined
      ? {}
      : { tool_choice: wireToolChoice(options.toolChoice, toolNamesByWireName) }),
  };
}

function openAiMessages(
  model: Model<any>,
  context: Context,
  toolNamesByWireName: Map<string, string>,
): unknown[] {
  const messages: unknown[] = [];
  if (context.systemPrompt?.trim()) {
    messages.push({ role: "system", content: context.systemPrompt });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({
        role: "user",
        content: typeof message.content === "string"
          ? message.content
          : message.content.map((part) => part.type === "text"
            ? { type: "text", text: part.text }
            : {
                type: "image_url",
                image_url: { url: `data:${part.mimeType};base64,${part.data}` },
              }),
      });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content
        .filter((part): part is TextContent => part.type === "text")
        .map((part) => part.text)
        .join("");
      const toolCalls = message.content
        .filter((part): part is ToolCall => part.type === "toolCall")
        .map((part) => ({
          id: part.id,
          type: "function",
          function: {
            name: registerToolName(part.name, toolNamesByWireName),
            arguments: JSON.stringify(part.arguments),
          },
        }));
      if (!text && toolCalls.length === 0) continue;
      messages.push({
        role: "assistant",
        content: text || null,
        ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
      });
      continue;
    }
    const text = message.content
      .filter((part): part is TextContent => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const images = message.content.filter((part) => part.type === "image");
    messages.push({
      role: "tool",
      tool_call_id: message.toolCallId,
      content: text || "(see attached image)",
    });
    if (images.length > 0 && model.input.includes("image")) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: "Attached image(s) from tool result:" },
          ...images.map((part) => ({
            type: "image_url",
            image_url: { url: `data:${part.mimeType};base64,${part.data}` },
          })),
        ],
      });
    }
  }
  return messages;
}

function createStreamState(model: Model<any>): StreamState {
  return {
    output: {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    },
    started: false,
    finished: false,
    toolCalls: new Map(),
    toolNamesByWireName: new Map(),
  };
}

function consumeFrame(
  events: LocalPiEventStream,
  state: StreamState,
  frame: SseFrame,
): void {
  if (frame.data === "[DONE]") {
    finishBlocks(events, state);
    events.push({
      type: "done",
      reason: state.output.stopReason === "length"
        ? "length"
        : state.output.stopReason === "toolUse" ? "toolUse" : "stop",
      message: state.output,
    });
    state.finished = true;
    events.end();
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data) as unknown;
  } catch {
    throw new Error("pi_llm_invalid_sse_json");
  }
  if (!isObject(parsed)) throw new Error("pi_llm_invalid_sse_chunk");
  if (frame.event === "error" || isObject(parsed.error)) {
    throw new TerminalPiStreamError(openAiErrorCode(parsed) ?? "pi_llm_stream_error");
  }
  if (!state.started) {
    state.started = true;
    events.push({ type: "start", partial: state.output });
  }
  if (typeof parsed.id === "string" && !state.output.responseId) {
    state.output.responseId = parsed.id;
  }
  if (
    typeof parsed.model === "string"
    && parsed.model.length > 0
    && parsed.model !== state.output.model
    && !state.output.responseModel
  ) {
    state.output.responseModel = parsed.model;
  }
  const choice = Array.isArray(parsed.choices) ? parsed.choices[0] : undefined;
  if (!isObject(choice)) return;
  const finishReason = choice.finish_reason;
  if (finishReason === "tool_calls" || finishReason === "function_call") {
    state.output.stopReason = "toolUse";
  } else if (finishReason === "length") {
    state.output.stopReason = "length";
  } else if (finishReason === "stop") {
    state.output.stopReason = "stop";
  }
  const delta = choice.delta;
  if (!isObject(delta)) return;
  if (typeof delta.content === "string" && delta.content.length > 0) {
    if (!state.textBlock) {
      state.textBlock = { type: "text", text: "" };
      state.output.content.push(state.textBlock);
      events.push({
        type: "text_start",
        contentIndex: state.output.content.indexOf(state.textBlock),
        partial: state.output,
      });
    }
    state.textBlock.text += delta.content;
    events.push({
      type: "text_delta",
      contentIndex: state.output.content.indexOf(state.textBlock),
      delta: delta.content,
      partial: state.output,
    });
  }
  if (!Array.isArray(delta.tool_calls)) return;
  for (const candidate of delta.tool_calls) {
    if (!isObject(candidate) || !Number.isSafeInteger(candidate.index)) continue;
    const index = candidate.index as number;
    const wireFunction = isObject(candidate.function) ? candidate.function : undefined;
    let toolCall = state.toolCalls.get(index);
    if (!toolCall) {
      toolCall = {
        type: "toolCall",
        id: typeof candidate.id === "string" ? candidate.id : "",
        name: typeof wireFunction?.name === "string"
          ? state.toolNamesByWireName.get(wireFunction.name) ?? wireFunction.name
          : "",
        arguments: {},
        partialArguments: "",
      };
      state.toolCalls.set(index, toolCall);
      state.output.content.push(toolCall);
      events.push({
        type: "toolcall_start",
        contentIndex: state.output.content.indexOf(toolCall),
        partial: state.output,
      });
    }
    if (!toolCall.id && typeof candidate.id === "string") toolCall.id = candidate.id;
    if (!toolCall.name && typeof wireFunction?.name === "string") {
      toolCall.name = state.toolNamesByWireName.get(wireFunction.name) ?? wireFunction.name;
    }
    const argumentDelta = typeof wireFunction?.arguments === "string"
      ? wireFunction.arguments
      : "";
    toolCall.partialArguments += argumentDelta;
    toolCall.arguments = parseArguments(toolCall.partialArguments);
    events.push({
      type: "toolcall_delta",
      contentIndex: state.output.content.indexOf(toolCall),
      delta: argumentDelta,
      partial: state.output,
    });
  }
}

function finishBlocks(events: LocalPiEventStream, state: StreamState): void {
  for (const [contentIndex, block] of state.output.content.entries()) {
    if (block.type === "text") {
      events.push({
        type: "text_end",
        contentIndex,
        content: block.text,
        partial: state.output,
      });
      continue;
    }
    if (block.type !== "toolCall") continue;
    const mutable = block as MutableToolCall;
    mutable.arguments = parseArguments(mutable.partialArguments);
    delete (mutable as Partial<MutableToolCall>).partialArguments;
    events.push({
      type: "toolcall_end",
      contentIndex,
      toolCall: mutable,
      partial: state.output,
    });
  }
}

async function* readSseFrames(body: ReadableStream<Uint8Array>): AsyncIterable<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSseFrame(raw);
        if (frame) yield frame;
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    if (buffer.trim()) {
      const frame = parseSseFrame(buffer);
      if (frame) yield frame;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(raw: string): SseFrame | undefined {
  let id: string | undefined;
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("id:")) id = line.slice(3).trimStart();
    else if (line.startsWith("event:")) event = line.slice(6).trimStart();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  return {
    ...(id === undefined ? {} : { id }),
    ...(event === undefined ? {} : { event }),
    data: data.join("\n"),
  };
}

async function assertSuccessful(response: MaxPowerPiFetchResponse): Promise<void> {
  if (response.ok) return;
  let code = `pi_llm_http_${response.status}`;
  try {
    const body = await response.json?.();
    if (isObject(body) && isObject(body.error) && typeof body.error.code === "string") {
      code = body.error.code;
    }
  } catch {
    // Public status/code is enough; never include a provider response body.
  }
  throw new Error(code);
}

function assertExpectedModel(model: Model<any>, expectedAlias: string): void {
  if (
    model.api !== "openai-completions"
    || model.provider !== MAXPOWER_PI_PROVIDER
    || model.id !== expectedAlias
  ) {
    throw new Error("pi_llm_model_mismatch");
  }
}

const PI_MODEL_CAPABILITIES: Readonly<Record<
  MaxPowerPiModelAlias,
  {
    readonly name: string;
    readonly input: readonly ("text" | "image")[];
    readonly contextWindow: number;
    readonly maxTokens: number;
  }
>> = Object.freeze({
  [MAXPOWER_PI_COACH_ALIAS]: Object.freeze({
    name: "MaxPower Coach",
    input: ["text"] as const,
    contextWindow: 128_000,
    maxTokens: 4_096,
  }),
  [MAXPOWER_PI_NUTRITION_VISION_ALIAS]: Object.freeze({
    name: "MaxPower Nutrition Vision",
    input: ["text", "image"] as const,
    contextWindow: 1_048_576,
    maxTokens: 2_048,
  }),
});

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function registerToolName(name: string, toolNamesByWireName: Map<string, string>): string {
  const wireName = openAiCompatibleToolName(name);
  const existing = toolNamesByWireName.get(wireName);
  if (existing && existing !== name) throw new Error("pi_llm_tool_name_collision");
  toolNamesByWireName.set(wireName, name);
  return wireName;
}

function wireToolChoice(
  choice: NonNullable<OpenAICompletionsOptions["toolChoice"]>,
  toolNamesByWireName: Map<string, string>,
): NonNullable<OpenAICompletionsOptions["toolChoice"]> {
  if (typeof choice === "string") return choice;
  return {
    type: "function",
    function: { name: registerToolName(choice.function.name, toolNamesByWireName) },
  };
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function openAiErrorCode(value: Record<string, unknown>): string | undefined {
  const error = value.error;
  return isObject(error) && typeof error.code === "string" ? error.code : undefined;
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof Error && /^[a-z0-9_]+$/i.test(error.message)) return error.message;
  return "maxpower_pi_service_unavailable";
}

function safeInvocationToken(value: string): string {
  const token = requiredCloudText(value, "pi_llm_invocation_id_required");
  if (token.length > 128 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("pi_llm_invocation_id_invalid");
  }
  return token;
}

function defaultInvocationId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nonNegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("pi_llm_resume_attempts_invalid");
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime-structural Pi stream; no Provider SDK or Node-only code enters Expo. */
class LocalPiEventStream implements AsyncIterable<AssistantMessageEvent> {
  private readonly queue: AssistantMessageEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<AssistantMessageEvent>) => void> = [];
  private done = false;
  private readonly final: Promise<AssistantMessage>;
  private resolveFinal!: (message: AssistantMessage) => void;

  constructor() {
    this.final = new Promise((resolve) => { this.resolveFinal = resolve; });
  }

  push(event: AssistantMessageEvent): void {
    if (this.done) return;
    if (event.type === "done") this.resolveFinal(event.message);
    if (event.type === "error") this.resolveFinal(event.error);
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  end(): void {
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined, done: true });
    }
  }

  result(): Promise<AssistantMessage> {
    return this.final;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    while (true) {
      const queued = this.queue.shift();
      if (queued) {
        yield queued;
        continue;
      }
      if (this.done) return;
      const next = await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next.done) return;
      yield next.value;
    }
  }

  asPiStream(): AssistantMessageEventStream {
    return this as unknown as AssistantMessageEventStream;
  }
}
