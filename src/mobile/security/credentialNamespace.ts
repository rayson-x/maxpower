import type { SecureCredentialKey } from "../../privacy/model";
import { stableHash } from "../../coach/stable";
import { namespaceDigest } from "./namespaceDigest";

export function secureCredentialStorageKey(key: SecureCredentialKey): string {
  return `mp.v2.${key.scope}.${namespaceDigest([key.accountId, key.name])}`;
}

/** Exact pre-v2 label used only for one-time credential migration. */
export function legacySecureCredentialStorageKey(key: SecureCredentialKey): string {
  return `mp.${key.scope}.${stableHash({ accountId: key.accountId, name: key.name })}`;
}
