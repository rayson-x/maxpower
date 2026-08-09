import {
  NutritionRemoteTransportError,
  type NutritionRemoteTransport,
} from "./RemoteNutritionObservationProvider";

export interface OpenAICompatibleNutritionFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type OpenAICompatibleNutritionFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Readonly<Record<string, string>>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<OpenAICompatibleNutritionFetchResponse>;

export interface OpenAICompatibleNutritionTransportOptions {
  /** Full, user-configured OpenAI-compatible Chat Completions endpoint. */
  endpoint: string;
  model: string;
  fetch?: OpenAICompatibleNutritionFetch;
}

/**
 * A deliberately small OpenAI-compatible boundary for meal estimation. It
 * receives only the already-sanitized inputs from RemoteNutritionObservation-
 * Provider and turns the vendor response into the closed nutrition contract.
 * It neither accesses a Ledger nor records request/response bodies.
 */
export class OpenAICompatibleNutritionTransport implements NutritionRemoteTransport {
  private readonly fetchImpl: OpenAICompatibleNutritionFetch;

  constructor(private readonly options: OpenAICompatibleNutritionTransportOptions) {
    if (!/^https:\/\//.test(options.endpoint)) throw new Error("nutrition_remote_https_required");
    if (!options.model.trim()) throw new Error("nutrition_remote_model_required");
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as OpenAICompatibleNutritionFetch);
    if (!this.fetchImpl) throw new Error("nutrition_remote_fetch_unavailable");
  }

  async estimate(input: Parameters<NutritionRemoteTransport["estimate"]>[0]): Promise<Awaited<ReturnType<NutritionRemoteTransport["estimate"]>>> {
    try {
      const response = await this.fetchImpl(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${input.credential}`,
        },
        body: JSON.stringify(requestBody(this.options.model, input)),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      if (!response.ok) throw responseError(response.status);
      return parseResponse(await response.json());
    } catch (cause) {
      if (input.signal?.aborted) throw new NutritionRemoteTransportError("cancelled");
      if (cause instanceof NutritionRemoteTransportError) throw cause;
      if (cause instanceof Error && cause.message === "nutrition_remote_http_failure") throw cause;
      throw new NutritionRemoteTransportError("timeout");
    }
  }
}

function requestBody(
  model: string,
  input: Parameters<NutritionRemoteTransport["estimate"]>[0],
): Readonly<Record<string, unknown>> {
  const content: unknown[] = [{
    type: "text",
    text: [
      "Estimate this meal conservatively. Return JSON only.",
      "Schema: { candidates: [{ foodName, portionAssumption, energyRange?: { min: { value, unit: 'kcal' }, max: { value, unit: 'kcal' } }, proteinGramsRange?: { min, max }, fatGramsRange?: { min, max }, carbohydrateGramsRange?: { min, max }, assumptions: string[], confidence: 'low'|'medium'|'high' }], missing: string[] }.",
      "Use ranges, list uncertain portions/ingredients in assumptions or missing, and never claim laboratory precision.",
      input.text ? `User description: ${input.text}` : "No text description was supplied.",
    ].join("\n"),
  }];
  for (const photo of input.photos) {
    content.push({
      type: "image_url",
      image_url: {
        // The preceding provider has already verified MIME bytes and removed
        // upload metadata. No local path, filename or media id is exposed.
        url: `data:${photo.mimeType};base64,${encodeBase64(photo.bytes)}`,
        detail: "low",
      },
    });
  }
  return {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You return only the requested JSON object. Do not provide medical advice." },
      { role: "user", content },
    ],
  };
}

function parseResponse(value: unknown): Awaited<ReturnType<NutritionRemoteTransport["estimate"]>> {
  const content = objectAt(value, ["choices", 0, "message", "content"]);
  if (typeof content !== "string") throw new NutritionRemoteTransportError("unsupported_input");
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new NutritionRemoteTransportError("unsupported_input");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new NutritionRemoteTransportError("unsupported_input");
  }
  const candidate = (parsed as { candidates?: unknown }).candidates;
  const missing = (parsed as { missing?: unknown }).missing;
  if (!Array.isArray(candidate) || !Array.isArray(missing)) throw new NutritionRemoteTransportError("unsupported_input");
  return { candidates: candidate as Awaited<ReturnType<NutritionRemoteTransport["estimate"]>>["candidates"], missing: missing as string[] };
}

function objectAt(value: unknown, path: readonly (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
    } else {
      if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

function responseError(status: number): NutritionRemoteTransportError | Error {
  if (status === 429) return new NutritionRemoteTransportError("rate_limited");
  if (status === 408 || status === 504) return new NutritionRemoteTransportError("timeout");
  if (status === 400 || status === 415 || status === 422) return new NutritionRemoteTransportError("unsupported_input");
  if (status === 403) return new NutritionRemoteTransportError("content_rejected");
  // Authentication and provider-side errors are intentionally not presented
  // as a timeout. The outer provider maps this opaque transport failure to its
  // generic, safe-to-display `provider_failure` category.
  return new Error("nutrition_remote_http_failure");
}

function encodeBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    output += second === undefined ? "=" : alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    output += third === undefined ? "=" : alphabet[third & 63];
  }
  return output;
}
