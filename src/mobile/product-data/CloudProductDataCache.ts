import {
  parseCloudCanonicalProjection,
  type CloudCanonicalProjection,
} from "./model";

export interface CloudProductDataCache {
  read(accountId: string): Promise<CloudCanonicalProjection | null>;
  replace(input: { accountId: string; projection: CloudCanonicalProjection }): Promise<void>;
  clear(accountId: string): Promise<void>;
}

/** Web/test adapter; native composition uses an account-specific SQLite file. */
export class InMemoryCloudProductDataCache implements CloudProductDataCache {
  private readonly values = new Map<string, string>();

  async read(accountId: string): Promise<CloudCanonicalProjection | null> {
    const payload = this.values.get(validAccountId(accountId));
    return payload === undefined ? null : decodeCloudProjection(payload);
  }

  async replace(input: { accountId: string; projection: CloudCanonicalProjection }): Promise<void> {
    const accountId = validAccountId(input.accountId);
    if (input.projection.accountId !== accountId) throw new Error("cloud_product_account_mismatch");
    this.values.set(accountId, encodeCloudProjection(input.projection));
  }

  async clear(accountId: string): Promise<void> {
    this.values.delete(validAccountId(accountId));
  }
}

export function encodeCloudProjection(projection: CloudCanonicalProjection): string {
  return JSON.stringify(parseCloudCanonicalProjection(projection));
}

export function decodeCloudProjection(payload: string): CloudCanonicalProjection {
  if (!payload || payload.length > 16 * 1024 * 1024) throw new Error("invalid_cloud_product_cache");
  try {
    return parseCloudCanonicalProjection(JSON.parse(payload) as unknown);
  } catch {
    throw new Error("invalid_cloud_product_cache");
  }
}

export function validCloudProductAccountId(accountId: string): string {
  return validAccountId(accountId);
}

function validAccountId(accountId: string): string {
  if (!accountId || accountId.length > 512 || /[\u0000-\u001F\u007F]/.test(accountId)) {
    throw new Error("invalid_cloud_product_account");
  }
  return accountId;
}
