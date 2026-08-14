import { mobileT } from "../i18n";
const ERROR_COPY_KEYS: Readonly<Record<string, string>> = {
  provider_service_consent_required: "mobile.userfacingerror.d5a1b253b0",
  remote_llm_permission_required: "mobile.userfacingerror.1fb8d12cda",
  network_unavailable: "mobile.userfacingerror.97797a0fa0",
  not_authenticated: "mobile.userfacingerror.85b4aca4cc",
  request_failed: "mobile.userfacingerror.12b4b42c9a",
  timeout: "mobile.userfacingerror.02f25d97d0",
  configuration_error: "mobile.userfacingerror.e69b391b58",
  secure_storage_unavailable: "mobile.userfacingerror.984ef09e4c",
  account_mismatch: "mobile.userfacingerror.937107e193",
  conflict: "mobile.userfacingerror.9b654aab98",
  revision_conflict: "mobile.userfacingerror.eb1acf211b",
  stale_dossier_confirmation: "mobile.userfacingerror.f6ecc7f9d5",
  stale_plan_revision: "mobile.userfacingerror.fa89527413",
};

/**
 * Prevents internal error codes and provider messages from leaking into the
 * product UI. Known codes receive specific copy; already-readable Chinese
 * messages pass through; everything else uses the action-specific fallback.
 */
export function userFacingError(cause: unknown, fallback: string): string {
  const code = errorCode(cause);
  if (code && ERROR_COPY_KEYS[code]) return mobileT(ERROR_COPY_KEYS[code]);

  const message = errorMessage(cause);
  if (message && containsChinese(message) && !looksInternal(message)) return message;
  return fallback;
}

function errorCode(cause: unknown): string | undefined {
  if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  const message = errorMessage(cause);
  if (!message) return undefined;
  return message.trim().toLowerCase();
}

function errorMessage(cause: unknown): string | undefined {
  if (cause instanceof Error) return cause.message.trim() || undefined;
  if (typeof cause === "string") return cause.trim() || undefined;
  return undefined;
}

function containsChinese(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

function looksInternal(value: string): boolean {
  return /(?:^|\s|[（(])(canonical|packet|profile|provider|session|timeline|revision|rust|llm|https?)[\s_.)：:]|[a-z][a-z0-9]+_[a-z0-9_]+/iu.test(value);
}
