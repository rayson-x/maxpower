import { stableHash } from "../../coach/stable";
import { namespaceDigest } from "../security/namespaceDigest";

/** Hashes the cloud account identifier so filenames neither collide nor reveal identity. */
export function accountDatabaseName(accountId: string): string {
  if (!accountId.trim()) throw new Error("account_id_required");
  return `maxpower-account-${namespaceDigest([accountId.trim()])}.db`;
}

/** Upgrade-only name; never use for a newly created account database. */
export function legacyAccountDatabaseName(accountId: string): string {
  if (!accountId.trim()) throw new Error("account_id_required");
  return `maxpower-account-${stableHash({ accountId: accountId.trim() })}.db`;
}
