export interface AccountOwnerDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  runAsync(sql: string, value: string): Promise<unknown>;
}

/** Binds a local SQLite file to exactly one canonical cloud account. */
export async function assertAccountDatabaseOwner(
  database: AccountOwnerDatabase,
  accountId: string,
): Promise<void> {
  await database.execAsync(
    `CREATE TABLE IF NOT EXISTS maxpower_account_namespace (
       singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
       account_id TEXT NOT NULL
     )`,
  );
  const owner = await database.getFirstAsync<{ account_id: string }>(
    "SELECT account_id FROM maxpower_account_namespace WHERE singleton = 1",
  );
  if (owner === null) {
    await database.runAsync(
      "INSERT INTO maxpower_account_namespace (singleton, account_id) VALUES (1, ?)",
      accountId,
    );
    return;
  }
  if (owner.account_id !== accountId) throw new Error("account_database_owner_mismatch");
}
