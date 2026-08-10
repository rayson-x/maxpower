import {
  decodeCloudProjection,
  encodeCloudProjection,
  validCloudProductAccountId,
  type CloudCanonicalProjection,
  type CloudProductDataCache,
} from "../product-data";

export interface CloudProductCacheDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, ...params: readonly string[]): Promise<unknown>;
  getFirstAsync<T>(source: string, ...params: readonly string[]): Promise<T | null>;
}

const createSchema = `
CREATE TABLE IF NOT EXISTS cloud_product_projection_cache (
  account_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** One JSON projection in the account-specific DB; cloud remains authoritative. */
export class SQLiteCloudProductDataCache implements CloudProductDataCache {
  private initialization?: Promise<void>;

  constructor(private readonly database: CloudProductCacheDatabase) {}

  async read(accountIdInput: string): Promise<CloudCanonicalProjection | null> {
    const accountId = validCloudProductAccountId(accountIdInput);
    await this.initialize();
    const row = await this.database.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM cloud_product_projection_cache WHERE account_id = ? LIMIT 1",
      accountId,
    );
    return row ? decodeCloudProjection(row.payload) : null;
  }

  async replace(input: { accountId: string; projection: CloudCanonicalProjection }): Promise<void> {
    const accountId = validCloudProductAccountId(input.accountId);
    if (input.projection.accountId !== accountId) throw new Error("cloud_product_account_mismatch");
    const payload = encodeCloudProjection(input.projection);
    await this.initialize();
    await this.database.runAsync(
      `INSERT INTO cloud_product_projection_cache (account_id, payload, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      accountId,
      payload,
      new Date().toISOString(),
    );
  }

  async clear(accountIdInput: string): Promise<void> {
    const accountId = validCloudProductAccountId(accountIdInput);
    await this.initialize();
    await this.database.runAsync(
      "DELETE FROM cloud_product_projection_cache WHERE account_id = ?",
      accountId,
    );
  }

  private initialize(): Promise<void> {
    this.initialization ??= this.database.execAsync(createSchema);
    return this.initialization;
  }
}
