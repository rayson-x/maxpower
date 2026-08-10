import { ApiError } from "../../kernel/api-error.js";
import {
  PRODUCT_ALIASES,
  PUBLIC_MODEL_NAME,
  type OpenAiObject,
  type ProductAlias,
} from "../../modules/llm/model.js";
import type {
  LlmProviderAdapter,
  ProviderInvocationDispatch,
  ProviderInvocationInput,
  ProviderResult,
  ProviderUsage,
} from "../../modules/llm/ports.js";
import { ProviderInvocationCancelledError } from "../../modules/llm/ports.js";

export interface OpenAiProviderRoute {
  endpoint: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  inputCreditsPerMillionTokens: number;
  outputCreditsPerMillionTokens: number;
  inputCostMicrosPerMillionTokens?: number;
  outputCostMicrosPerMillionTokens?: number;
  headers?: Readonly<Record<string, string>>;
}

export interface OpenAiCompatibleLlmProviderOptions {
  routes: Readonly<Record<ProductAlias, OpenAiProviderRoute>>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
}

/**
 * OpenAI Chat Completions transport. It owns alias routing, credential use,
 * SSE parsing and normalized usage; upstream identity is removed before any
 * object crosses back into the Gateway.
 */
export class OpenAiCompatibleLlmProviderAdapter implements LlmProviderAdapter {
  readonly #routes: Readonly<Record<ProductAlias, OpenAiProviderRoute>>;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;

  constructor(options: OpenAiCompatibleLlmProviderOptions) {
    this.#routes = options.routes;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#timeoutMs = options.timeoutMs ?? 45_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new Error("timeoutMs must be a positive integer.");
    }
    for (const alias of PRODUCT_ALIASES) {
      const route = this.#routes[alias];
      if (route === undefined) throw new Error(`Provider route is missing for ${alias}.`);
      validateRoute(route);
    }
  }

  invoke(input: ProviderInvocationInput): ProviderInvocationDispatch {
    const started = deferred<void>();
    const result = this.dispatch(input, () => started.resolve(undefined));
    void result.catch(started.reject);
    return { started: started.promise, result };
  }

  private async dispatch(
    input: ProviderInvocationInput,
    markStarted: () => void,
  ): Promise<ProviderResult> {
    const route = this.#routes[input.alias];
    const controller = new AbortController();
    const relayAbort = (): void => controller.abort();
    if (input.signal.aborted) controller.abort();
    else input.signal.addEventListener("abort", relayAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    timeout.unref();
    const cleanup = (): void => {
      clearTimeout(timeout);
      input.signal.removeEventListener("abort", relayAbort);
    };
    const headers = new Headers(route.headers);
    headers.set("authorization", `Bearer ${route.apiKey}`);
    headers.set("content-type", "application/json");
    headers.set("accept", input.stream ? "text/event-stream" : "application/json");
    const requestedOutputTokens = Number.isSafeInteger(input.request.max_tokens)
      ? input.request.max_tokens as number
      : route.maxOutputTokens;
    const upstreamRequest: Record<string, unknown> = {
      model: route.model,
      messages: input.request.messages,
      stream: input.stream,
      store: false,
      max_tokens: Math.min(requestedOutputTokens, route.maxOutputTokens),
      ...(input.request.tools === undefined ? {} : { tools: input.request.tools }),
      ...(input.request.parallel_tool_calls === undefined
        ? {}
        : { parallel_tool_calls: input.request.parallel_tool_calls }),
      ...(input.request.temperature === undefined
        ? {}
        : { temperature: input.request.temperature }),
      ...(input.request.response_format === undefined
        ? {}
        : { response_format: input.request.response_format }),
      ...(input.stream
        ? {
            stream_options: {
              include_usage: true,
            },
          }
        : {}),
    };
    delete upstreamRequest.max_completion_tokens;
    const estimatedInputBytes = Buffer.byteLength(JSON.stringify({
      messages: upstreamRequest.messages,
      tools: upstreamRequest.tools,
    }), "utf8");

    let response: Response;
    try {
      const responsePromise = this.#fetch(route.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(upstreamRequest),
        signal: controller.signal,
      });
      markStarted();
      response = await responsePromise;
    } catch {
      cleanup();
      if (input.signal.aborted) {
        throw new ProviderInvocationCancelledError(
          estimateCancelledUsage(estimatedInputBytes, 0, route),
        );
      }
      throw unavailable();
    }

    if (!response.ok) {
      cleanup();
      await response.body?.cancel().catch(() => undefined);
      throw unavailable();
    }

    if (!input.stream) {
      try {
        const body: unknown = await response.json();
        if (!isObject(body)) throw invalidResponse();
        const usage = normalizeUsage(body.usage, route);
        return {
          kind: "complete",
          response: hideProviderIdentity(body, input.invocationId, usage),
          usage,
        };
      } catch (error) {
        if (input.signal.aborted) {
          throw new ProviderInvocationCancelledError(
            estimateCancelledUsage(estimatedInputBytes, 0, route),
          );
        }
        if (error instanceof ApiError) throw error;
        throw invalidResponse();
      } finally {
        cleanup();
      }
    }

    if (response.body === null) {
      cleanup();
      throw invalidResponse();
    }

    const usage = deferred<ProviderUsage>();
    let emittedContentBytes = 0;
    // A stream can fail before Gateway awaits final usage. Register a rejection
    // observer now while preserving the original promise for the caller.
    void usage.promise.catch(() => undefined);
    return {
      kind: "stream",
      chunks: streamChunks(
        response.body,
        input.invocationId,
        route,
        usage.resolve,
        usage.reject,
        cleanup,
        (chunk) => { emittedContentBytes += generatedContentBytes(chunk); },
      ),
      usage: usage.promise,
      estimateCancelledUsage: () => estimateCancelledUsage(
        estimatedInputBytes,
        emittedContentBytes,
        route,
      ),
    };
  }
}

async function* streamChunks(
  body: ReadableStream<Uint8Array>,
  invocationId: string,
  route: OpenAiProviderRoute,
  resolveUsage: (usage: ProviderUsage) => void,
  rejectUsage: (error: unknown) => void,
  cleanup: () => void,
  observeChunk: (chunk: OpenAiObject) => void,
): AsyncGenerator<OpenAiObject> {
  let finalUsage: ProviderUsage | undefined;
  try {
    for await (const data of sseData(body)) {
      if (data === "[DONE]") break;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        throw invalidResponse();
      }
      if (!isObject(parsed)) throw invalidResponse();
      if (parsed.error !== undefined) throw unavailable();
      observeChunk(parsed);
      let chunkUsage: ProviderUsage | undefined;
      if (parsed.usage !== undefined && parsed.usage !== null) {
        chunkUsage = normalizeUsage(parsed.usage, route);
        finalUsage = chunkUsage;
      }
      yield hideProviderIdentity(parsed, invocationId, chunkUsage);
    }
    if (finalUsage === undefined) {
      throw new ApiError(
        502,
        "upstream_usage_missing",
        "The upstream stream did not include terminal usage.",
      );
    }
    resolveUsage(finalUsage);
  } catch (error) {
    const safeError = error instanceof ApiError ? error : invalidResponse();
    rejectUsage(safeError);
    throw safeError;
  } finally {
    cleanup();
  }
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let dataLines: string[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = done ? "" : (lines.pop() ?? "");
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line === "") {
          if (dataLines.length > 0) {
            yield dataLines.join("\n");
            dataLines = [];
          }
        } else if (line === "data") {
          dataLines.push("");
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) break;
    }
    if (pending !== "") {
      const line = pending.endsWith("\r") ? pending.slice(0, -1) : pending;
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (dataLines.length > 0) yield dataLines.join("\n");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function normalizeUsage(value: unknown, route: OpenAiProviderRoute): ProviderUsage {
  if (!isObject(value)) throw invalidResponse();
  const inputTokens = tokenCount(value.prompt_tokens ?? value.input_tokens, "input tokens");
  const outputTokens = tokenCount(
    value.completion_tokens ?? value.output_tokens,
    "output tokens",
  );
  const promptDetails = asObject(value.prompt_tokens_details ?? value.input_tokens_details);
  const cachedInputTokens = optionalTokenCount(
    promptDetails.cached_tokens ?? value.cached_input_tokens,
  );
  const imageTokens = optionalTokenCount(
    promptDetails.image_tokens ?? value.image_tokens,
  );
  const credits = Math.ceil(
    (inputTokens * route.inputCreditsPerMillionTokens +
      outputTokens * route.outputCreditsPerMillionTokens) /
      1_000_000,
  );
  if (!Number.isSafeInteger(credits) || credits < 0) throw invalidResponse();
  const providerCostMicros = Math.ceil(
    (inputTokens * (route.inputCostMicrosPerMillionTokens ?? 0) +
      outputTokens * (route.outputCostMicrosPerMillionTokens ?? 0)) /
      1_000_000,
  );
  if (!Number.isSafeInteger(providerCostMicros) || providerCostMicros < 0) {
    throw invalidResponse();
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens,
    imageTokens,
    credits,
    providerCostMicros,
    usageBasis: "provider_reported",
  };
}

function estimateCancelledUsage(
  inputBytes: number,
  emittedOutputBytes: number,
  route: OpenAiProviderRoute,
): ProviderUsage {
  // UTF-8 bytes are a deliberately conservative upper bound for provider
  // tokenization when the upstream never returned authoritative usage.
  const inputTokens = Math.max(1, inputBytes);
  const outputTokens = Math.max(0, emittedOutputBytes);
  const credits = Math.ceil(
    (inputTokens * route.inputCreditsPerMillionTokens
      + outputTokens * route.outputCreditsPerMillionTokens) / 1_000_000,
  );
  const providerCostMicros = Math.ceil(
    (inputTokens * (route.inputCostMicrosPerMillionTokens ?? 0)
      + route.maxOutputTokens * (route.outputCostMicrosPerMillionTokens ?? 0)) / 1_000_000,
  );
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cachedInputTokens: 0,
    imageTokens: 0,
    credits,
    providerCostMicros,
    usageBasis: "conservative_estimate",
  };
}

function generatedContentBytes(chunk: OpenAiObject): number {
  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  let bytes = 0;
  for (const choice of choices) {
    if (!isObject(choice)) continue;
    const delta = asObject(choice.delta);
    for (const value of [delta.content, delta.refusal]) {
      if (typeof value === "string") bytes += Buffer.byteLength(value, "utf8");
    }
    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const toolCall of toolCalls) {
      const fn = isObject(toolCall) ? asObject(toolCall.function) : {};
      if (typeof fn.arguments === "string") {
        bytes += Buffer.byteLength(fn.arguments, "utf8");
      }
    }
  }
  return bytes;
}

function hideProviderIdentity(
  value: OpenAiObject,
  invocationId: string,
  _usage?: ProviderUsage,
): OpenAiObject {
  const publicValue: Record<string, unknown> = { ...value };
  delete publicValue.provider;
  delete publicValue.provider_name;
  delete publicValue.system_fingerprint;
  delete publicValue.cost;
  delete publicValue.usage_cost;
  delete publicValue.usage;
  publicValue.id = `chatcmpl_${invocationId}`;
  publicValue.model = PUBLIC_MODEL_NAME;
  return publicValue;
}

function validateRoute(route: OpenAiProviderRoute): void {
  try {
    const endpoint = new URL(route.endpoint);
    if (endpoint.protocol !== "https:") throw new Error("insecure");
  } catch {
    throw new Error("Provider endpoint must be an absolute HTTPS URL.");
  }
  if (route.apiKey.length < 1 || route.model.length < 1) {
    throw new Error("Provider route requires an API key and model.");
  }
  if (!Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 1) {
    throw new Error("Provider route maxOutputTokens must be a positive integer.");
  }
  for (const credits of [
    route.inputCreditsPerMillionTokens,
    route.outputCreditsPerMillionTokens,
    route.inputCostMicrosPerMillionTokens ?? 0,
    route.outputCostMicrosPerMillionTokens ?? 0,
  ]) {
    if (!Number.isSafeInteger(credits) || credits < 0) {
      throw new Error("Provider route pricing must use non-negative integer credits.");
    }
  }
}

function optionalTokenCount(value: unknown): number {
  if (value === undefined || value === null) return 0;
  return tokenCount(value, "detail tokens");
}

function tokenCount(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiError(502, "invalid_upstream_usage", `Upstream ${name} are invalid.`);
  }
  return value as number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asObject(value: unknown): Record<string, unknown> {
  return isObject(value) ? value : {};
}

function unavailable(): ApiError {
  return new ApiError(503, "provider_unavailable", "The cloud LLM is temporarily unavailable.");
}

function invalidResponse(): ApiError {
  return new ApiError(502, "invalid_upstream_response", "The upstream response is invalid.");
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  let rejectPromise: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
    reject: (reason) => rejectPromise?.(reason),
  };
}
