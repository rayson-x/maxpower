import { ApiError } from "./api-error.js";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export interface CursorPageInput {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface CursorPage<T> {
  data: readonly T[];
  nextCursor: string | null;
}

export interface CursorPosition {
  createdAt: string;
  id: string;
}

export function normalizeCursorPageInput(input: CursorPageInput = {}): {
  limit: number;
  position: CursorPosition | null;
} {
  const limit = input.limit ?? DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new ApiError(400, "invalid_limit", "limit must be between 1 and 100.");
  }
  return {
    limit,
    position: input.cursor === undefined ? null : decodeCursor(input.cursor),
  };
}

export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(JSON.stringify([position.createdAt, position.id]), "utf8").toString("base64url");
}

export function paginateByCreatedAt<T extends CursorPosition>(
  values: readonly T[],
  input: CursorPageInput = {},
): CursorPage<T> {
  const { limit, position } = normalizeCursorPageInput(input);
  const ordered = [...values].sort(newestFirst);
  const remaining = position === null
    ? ordered
    : ordered.filter((value) => newestFirst(value, position) > 0);
  const data = remaining.slice(0, limit);
  const hasMore = remaining.length > data.length;
  const last = data.at(-1);
  return {
    data,
    nextCursor: hasMore && last !== undefined
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}

function decodeCursor(value: string): CursorPosition {
  if (!value || value.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidCursor();
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) || parsed.length !== 2 ||
      typeof parsed[0] !== "string" || !Number.isFinite(Date.parse(parsed[0])) ||
      typeof parsed[1] !== "string" || !parsed[1] || parsed[1].length > 500
    ) throw invalidCursor();
    return { createdAt: new Date(parsed[0]).toISOString(), id: parsed[1] };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalidCursor();
  }
}

function newestFirst(left: CursorPosition, right: CursorPosition): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function invalidCursor(): ApiError {
  return new ApiError(400, "invalid_cursor", "cursor is invalid or expired.");
}
