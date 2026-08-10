import type { MiddlewareHandler } from "hono";

export interface HttpRequestLogEvent {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
}

export interface HttpRequestLogger {
  write(event: HttpRequestLogEvent): void | Promise<void>;
}

/** Logs a fixed metadata schema; request headers, query values and bodies cannot enter it. */
export function createRequestLoggerMiddleware(logger: HttpRequestLogger): MiddlewareHandler {
  return async (context, next) => {
    const startedAt = performance.now();
    try {
      await next();
    } finally {
      await logger.write({
        requestId: context.res.headers.get("x-request-id") ?? "unassigned",
        method: context.req.method,
        path: context.req.path,
        status: context.res.status,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      });
    }
  };
}

export class JsonLineRequestLogger implements HttpRequestLogger {
  readonly #writeLine: (line: string) => void;

  constructor(writeLine: (line: string) => void = (line) => process.stdout.write(`${line}\n`)) {
    this.#writeLine = writeLine;
  }

  write(event: HttpRequestLogEvent): void {
    this.#writeLine(JSON.stringify({ event: "http_request", ...event }));
  }
}
