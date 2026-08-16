import type { SecureCredentialKey } from "../../privacy/model";
import { namespaceDigest } from "./namespaceDigest";

export function secureCredentialStorageKey(key: SecureCredentialKey): string {
  return `mp.v2.${key.scope}.${namespaceDigest([key.accountId, key.name])}`;
}
