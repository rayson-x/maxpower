import type { Hono } from "hono";

import { ApiError } from "../kernel/api-error.js";

export type ReviewedBetterAuthHandler = (request: Request) => Promise<Response>;

export interface BetterAuthHandlerMountOptions {
  maxRequestBytes?: number;
}

/** Mounts the reviewed wrapper, never Better Auth's raw handler. */
export function mountReviewedBetterAuthHandler(
  app: Hono,
  handler: ReviewedBetterAuthHandler,
  options: BetterAuthHandlerMountOptions = {},
): void {
  const maxRequestBytes = options.maxRequestBytes ?? 1_048_576;
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1) {
    throw new Error("Better Auth request limit must be a positive integer.");
  }
  app.all("/api/auth/*", async (context) => handler(
    await boundedRequest(context.req.raw, maxRequestBytes),
  ));
}

async function boundedRequest(request: Request, maxBytes: number): Promise<Request> {
  if (request.body === null) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ApiError(413, "request_too_large", "The request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}
