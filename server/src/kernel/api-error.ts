export type ErrorDetails = Record<string, unknown>;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetails | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ErrorDetails,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function conflict(
  code: string,
  message: string,
  details?: ErrorDetails,
): ApiError {
  return new ApiError(409, code, message, details);
}

export function notFound(resource: string): ApiError {
  return new ApiError(404, "not_found", `${resource} was not found.`);
}

export function forbidden(code = "forbidden", message = "Access denied."): ApiError {
  return new ApiError(403, code, message);
}

export function unauthorized(message = "A valid access token is required."): ApiError {
  return new ApiError(401, "invalid_access_token", message);
}
