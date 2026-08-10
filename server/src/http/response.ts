import type { Context } from "hono";

import { ApiError } from "../kernel/api-error.js";

interface ErrorEnvelope {
  error: {
    message: string;
    type: string;
    code: string;
    param: null;
    details?: Record<string, unknown>;
  };
}

export function renderError(context: Context, error: unknown): Response {
  const apiError =
    error instanceof ApiError
      ? error
      : new ApiError(500, "internal_error", "An unexpected error occurred.");

  const body: ErrorEnvelope = {
    error: {
      message: apiError.message,
      type: errorType(apiError.status),
      code: apiError.code,
      param: null,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    },
  };

  return context.json(body, apiError.status as 400);
}

function errorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 429) return "insufficient_quota";
  if (status >= 500) return "server_error";
  return "invalid_request_error";
}
