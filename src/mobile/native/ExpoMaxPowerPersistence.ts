import * as SQLite from "expo-sqlite";

import { createSQLiteCoachLedger } from "../../coach/sqlite";
import { accountDatabaseName } from "./accountDatabaseName";
import { assertAccountDatabaseOwner } from "./accountDatabaseOwner";
import { openIsolatedDatabaseConnection } from "./ExpoDatabaseConnections";
import { SQLiteProductShellStateStore } from "./SQLiteProductShellStateStore";

/**
 * Opens one local database file through isolated connections. Durable Coach
 * facts and fact-free ProductShell presentation state own separate tables;
 * keeping the connections separate prevents an unrelated page-state write
 * from joining the Ledger's async transaction.
 */
export async function openExpoMaxPowerPersistence(accountId: string) {
  const databaseName = accountDatabaseName(accountId);
  // expo-sqlite creates its parent directory lazily. Opening the same file in
  // parallel on a fresh install races that first directory creation on
  // Android (one connection can observe the path as a non-normal file).
  const ledgerDatabase = await openIsolatedDatabaseConnection(databaseName, SQLite.openDatabaseAsync);
  try {
    await assertAccountDatabaseOwner(ledgerDatabase, accountId);
  } catch (cause) {
    await ledgerDatabase.closeAsync();
    throw cause;
  }
  let productShellDatabase: SQLite.SQLiteDatabase;
  try {
    productShellDatabase = await openIsolatedDatabaseConnection(databaseName, SQLite.openDatabaseAsync);
  } catch (cause) {
    await ledgerDatabase.closeAsync();
    throw cause;
  }
  let disposed = false;
  return {
    accountId,
    databaseName,
    ledger: createSQLiteCoachLedger(ledgerDatabase),
    productShellStateStore: new SQLiteProductShellStateStore(productShellDatabase),
    async dispose() {
      if (disposed) return;
      disposed = true;
      await productShellDatabase.closeAsync();
      await ledgerDatabase.closeAsync();
    },
  };
}

export { accountDatabaseName } from "./accountDatabaseName";
