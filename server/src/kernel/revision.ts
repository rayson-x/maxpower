import { ApiError } from "./api-error.js";

export function parseExpectedRevision(value: string | undefined): number {
  if (value === undefined) {
    throw new ApiError(428, "revision_required", "If-Match is required.");
  }

  const match = /^(?:([1-9]\d*)|(?:W\/)?"([1-9]\d*)")$/.exec(value.trim());
  const revision = match === null ? Number.NaN : Number(match[1] ?? match[2]);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new ApiError(400, "invalid_revision", "If-Match must contain a revision number.");
  }
  return revision;
}

export function revisionEtag(revision: number): string {
  return `\"${revision}\"`;
}
