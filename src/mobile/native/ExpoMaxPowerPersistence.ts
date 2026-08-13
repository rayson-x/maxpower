import * as SQLite from "expo-sqlite";
import { File } from "expo-file-system";

import { createSQLiteCoachLedger } from "../../coach/sqlite";
import { accountDatabaseName, legacyAccountDatabaseName } from "./accountDatabaseName";
import { assertAccountDatabaseOwner } from "./accountDatabaseOwner";
import { SQLiteProductShellStateStore } from "./SQLiteProductShellStateStore";

/**
 * Opens one local database file through isolated connections. Durable Coach
 * facts and fact-free ProductShell presentation state own separate tables;
 * keeping the connections separate prevents an unrelated page-state write
 * from joining the Ledger's async transaction.
 */
export async function openExpoMaxPowerPersistence(accountId: string) {
  const databaseName = accountDatabaseName(accountId);
  await migrateLegacyDatabase(accountId, databaseName);
  // expo-sqlite creates its parent directory lazily. Opening the same file in
  // parallel on a fresh install races that first directory creation on
  // Android (one connection can observe the path as a non-normal file).
  const ledgerDatabase = await SQLite.openDatabaseAsync(databaseName);
  try {
    await assertAccountDatabaseOwner(ledgerDatabase, accountId);
  } catch (cause) {
    await ledgerDatabase.closeAsync();
    throw cause;
  }
  let productShellDatabase: SQLite.SQLiteDatabase;
  try {
    productShellDatabase = await SQLite.openDatabaseAsync(databaseName);
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

async function migrateLegacyDatabase(accountId: string, databaseName: string): Promise<void> {
  const directory = SQLite.defaultDatabaseDirectory;
  if (directory === null || directory === undefined) return;
  const legacyName = legacyAccountDatabaseName(accountId);
  if (legacyName === databaseName) return;
  // expo-sqlite exposes a native absolute path on Android, while the modern
  // expo-file-system File API accepts URI inputs. Passing `/data/...` directly
  // throws `URI is not absolute` before the first account database can open.
  const fileDirectory = absoluteFileUri(directory);
  const destination = new File(fileDirectory, databaseName);
  const legacy = new File(fileDirectory, legacyName);
  if (destination.exists || !legacy.exists) return;

  const legacyDatabase = await SQLite.openDatabaseAsync(legacyName);
  try {
    await legacyDatabase.execAsync("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    await legacyDatabase.closeAsync();
  }
  if (!destination.exists && legacy.exists) await legacy.move(destination);
}

function absoluteFileUri(directory: string): string {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(directory)) return directory;
  return `file://${directory.startsWith("/") ? "" : "/"}${directory}`;
}

export { accountDatabaseName } from "./accountDatabaseName";
