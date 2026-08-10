import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";

import { ApiError } from "../../kernel/api-error.js";
import type { LlmGatewayModule, OpenAiObject } from "../../modules/llm/model.js";
import { authenticate, type AccessTokenVerifier } from "../authenticate.js";
import { readJson, requireHeader } from "../request.js";

const chatCompletionSchema = z
  .object({
    model: z.string(),
    messages: z.array(z.unknown()).max(128),
    stream: z.boolean().optional(),
    tools: z.array(z.unknown()).max(128).optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    parallel_tool_calls: z.literal(false).optional(),
    temperature: z.number().min(0).max(2).optional(),
    response_format: z.object({ type: z.literal("json_object") }).strict().optional(),
  })
  .strict();

const cancellationSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict();

export interface LlmRouteDependencies {
  tokens: AccessTokenVerifier;
  llm: LlmGatewayModule;
}

export function createLlmRoutes(dependencies: LlmRouteDependencies): Hono {
  const routes = new Hono();

  routes.post("/chat/completions", async (context) => {
    const principal = await authenticate(context, dependencies.tokens);
    requireHeader(context, "X-Client-Run-Id");
    const body = await readJson(context, chatCompletionSchema);
    const result = await dependencies.llm.invoke(principal, {
      idempotencyKey: requireHeader(context, "Idempotency-Key"),
      request: body,
    });
    context.header("X-MaxPower-Invocation-Id", result.invocationId);

    if (result.kind === "complete") {
      return context.json(result.response);
    }
    return writeChunks(context, result.chunks, 0);
  });

  routes.get("/invocations/:invocationId/events", async (context) => {
    const principal = await authenticate(context, dependencies.tokens);
    const afterSequence = parseLastEventId(context.req.header("last-event-id"));
    const chunks = await dependencies.llm.resume(principal, {
      invocationId: context.req.param("invocationId"),
      afterSequence,
    });
    context.header("X-MaxPower-Invocation-Id", context.req.param("invocationId"));
    return writeChunks(context, chunks, afterSequence);
  });

  routes.post("/invocations/cancel", async (context) => {
    const principal = await authenticate(context, dependencies.tokens);
    const body = await readJson(context, cancellationSchema);
    const result = await dependencies.llm.cancel(principal, body);
    return context.json(result, 202);
  });

  routes.get("/entitlements/me", async (context) => {
    const principal = await authenticate(context, dependencies.tokens);
    const entitlement = await dependencies.llm.getEntitlement(principal);
    return context.json({
      status: entitlement.availableCredits > 0 ? "available" : "exhausted",
      ...(entitlement.resetAt === null ? {} : { resetAt: entitlement.resetAt }),
    });
  });

  return routes;
}

function writeChunks(
  context: Parameters<typeof streamSSE>[0],
  chunks: AsyncIterable<OpenAiObject>,
  afterSequence: number,
): Response {
  return streamSSE(context, async (stream) => {
    let sequence = afterSequence;
    try {
      for await (const chunk of chunks) {
        sequence += 1;
        await stream.writeSSE({ id: String(sequence), data: JSON.stringify(chunk) });
      }
      await stream.writeSSE({ data: "[DONE]" });
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError(503, "provider_unavailable", "The cloud LLM is unavailable.");
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({
          error: {
            message: apiError.message,
            type: "server_error",
            code: apiError.code,
            param: null,
          },
        }),
      });
    }
  });
}

function parseLastEventId(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return 0;
  const normalized = value.trim();
  const sequence = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new ApiError(400, "invalid_event_sequence", "Last-Event-ID must be zero or greater.");
  }
  return sequence;
}
