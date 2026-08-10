import type { Context } from "hono";
import type { ZodType } from "zod";

import { ApiError } from "../kernel/api-error.js";

const DEFAULT_MAX_JSON_REQUEST_BYTES = 1_048_576;
const requestBodyLimits = new WeakMap<Request, number>();

/** Associates the HTTP boundary's validated byte limit with this request. */
export function setRequestBodyLimit(request: Request, maxBytes: number): void {
  requestBodyLimits.set(request, maxBytes);
}

export async function readJson<T>(context: Context, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = JSON.parse(
      await readBodyText(
        context.req.raw,
        requestBodyLimits.get(context.req.raw) ?? DEFAULT_MAX_JSON_REQUEST_BYTES,
      ),
    ) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", "The request is invalid.", {
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const body = request.body;
  if (body === null) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "request_too_large", "The request body is too large.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "The request body must be valid JSON.");
  } finally {
    reader.releaseLock();
  }
}

export function requireHeader(context: Context, name: string): string {
  const value = context.req.header(name)?.trim();
  if (!value) {
    throw new ApiError(400, "missing_header", `${name} is required.`, {
      header: name,
    });
  }
  return value;
}

export function optionalLimit(value: string | undefined, defaultValue = 50): number {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim();
  const limit = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, "invalid_limit", "limit must be between 1 and 100.");
  }
  return limit;
}
