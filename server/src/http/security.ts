import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import type { MiddlewareHandler } from "hono";

import { ApiError } from "../kernel/api-error.js";
import { setRequestBodyLimit } from "./request.js";

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, nowMs: number): Promise<RateLimitDecision>;
}

export interface HttpSecurityOptions {
  allowedOrigins: readonly string[];
  maxRequestBytes: number;
  rateLimiter?: RateLimiter;
  strictTransportSecurity?: boolean;
}

export function createSecurityMiddleware(options: HttpSecurityOptions): MiddlewareHandler {
  validateOptions(options);
  const origins = new Set(options.allowedOrigins);

  return async (context, next) => {
    setRequestBodyLimit(context.req.raw, options.maxRequestBytes);
    context.header("X-Request-Id", randomUUID());
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Cache-Control", "no-store");
    context.header("Cross-Origin-Resource-Policy", "same-site");
    if (options.strictTransportSecurity === true) {
      context.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    const origin = context.req.header("origin");
    if (origin !== undefined) {
      if (!origins.has(origin) && !isAppleFormPostCallback(context.req.method, context.req.path, origin)) {
        throw new ApiError(403, "origin_forbidden", "The request origin is not allowed.");
      }
      if (origins.has(origin)) {
        context.header("Access-Control-Allow-Origin", origin);
        context.header("Vary", "Origin");
        context.header("Access-Control-Allow-Credentials", "true");
        if (context.req.method === "OPTIONS") {
          context.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
          context.header(
            "Access-Control-Allow-Headers",
            "Authorization,Content-Type,Deletion-Receipt,Idempotency-Key,If-Match,Last-Event-ID,X-Client-Run-Id",
          );
          return context.body(null, 204);
        }
      }
    }

    const contentLength = context.req.header("content-length");
    if (contentLength !== undefined) {
      const bytes = Number.parseInt(contentLength, 10);
      if (!Number.isSafeInteger(bytes) || bytes < 0) {
        throw new ApiError(400, "invalid_content_length", "Content-Length is invalid.");
      }
      if (bytes > options.maxRequestBytes) {
        throw new ApiError(413, "request_too_large", "The request body is too large.");
      }
    }

    if (options.rateLimiter !== undefined && !isOperationalRoute(context.req.path)) {
      const decision = await options.rateLimiter.consume(rateLimitKey(context), Date.now());
      if (!decision.allowed) {
        context.header("Retry-After", String(decision.retryAfterSeconds));
        throw new ApiError(429, "rate_limit_exceeded", "Too many requests.", {
          canRetry: true,
        });
      }
    }

    await next();
  };
}

export interface InMemoryFixedWindowRateLimiterOptions {
  limit: number;
  windowMs: number;
}

interface WindowState {
  count: number;
  resetsAtMs: number;
}

/** Local/test adapter. Production uses a shared, atomic store. */
export class InMemoryFixedWindowRateLimiter implements RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #windows = new Map<string, WindowState>();

  constructor(options: InMemoryFixedWindowRateLimiterOptions) {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1) {
      throw new Error("Rate limit must be a positive integer.");
    }
    if (!Number.isSafeInteger(options.windowMs) || options.windowMs < 1) {
      throw new Error("Rate-limit window must be a positive integer.");
    }
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
  }

  async consume(key: string, nowMs: number): Promise<RateLimitDecision> {
    let state = this.#windows.get(key);
    if (state === undefined || nowMs >= state.resetsAtMs) {
      state = { count: 0, resetsAtMs: nowMs + this.#windowMs };
      this.#windows.set(key, state);
    }
    state.count += 1;
    return {
      allowed: state.count <= this.#limit,
      retryAfterSeconds: Math.max(1, Math.ceil((state.resetsAtMs - nowMs) / 1_000)),
    };
  }
}

function validateOptions(options: HttpSecurityOptions): void {
  if (!Number.isSafeInteger(options.maxRequestBytes) || options.maxRequestBytes < 1) {
    throw new Error("maxRequestBytes must be a positive integer.");
  }
  for (const origin of options.allowedOrigins) {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) {
      throw new Error("Allowed origins must be exact HTTPS origins.");
    }
  }
}

function isOperationalRoute(path: string): boolean {
  return path === "/healthz" || path === "/readyz" || path === "/openapi.json";
}

function rateLimitKey(context: Parameters<MiddlewareHandler>[0]): string {
  const identity = trustedIngressIdentity(context);
  const digest = createHash("sha256").update(identity).digest("base64url");
  return `${context.req.path}\u0000${digest}`;
}

function isAppleFormPostCallback(method: string, path: string, origin: string): boolean {
  return method === "POST" &&
    path === "/api/auth/callback/apple" &&
    origin === "https://appleid.apple.com";
}

function trustedIngressIdentity(context: Parameters<MiddlewareHandler>[0]): string {
  const forwarded = [
    context.req.header("cf-connecting-ip")?.trim(),
    context.req.header("x-real-ip")?.trim(),
  ].filter((value): value is string => value !== undefined && value.length > 0);
  if (forwarded.length !== 1 || isIP(forwarded[0] ?? "") === 0) return "anonymous";
  return forwarded[0] ?? "anonymous";
}
