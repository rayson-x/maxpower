import assert from "node:assert/strict";
import test from "node:test";

import { openIsolatedDatabaseConnection } from "../../src/mobile/native/ExpoDatabaseConnections";

test("Ledger and ProductShell own distinct Expo SQLite native connections", async () => {
  const cached = { id: "cached" };
  let sequence = 0;
  const calls: Array<{ databaseName: string; useNewConnection?: boolean }> = [];

  const open = async (databaseName: string, options?: { useNewConnection?: boolean }) => {
      calls.push({ databaseName, ...options });
      return options?.useNewConnection ? { id: `isolated-${++sequence}` } : cached;
  };
  const ledgerDatabase = await openIsolatedDatabaseConnection("maxpower-account.sqlite", open);
  const productShellDatabase = await openIsolatedDatabaseConnection("maxpower-account.sqlite", open);

  assert.notStrictEqual(ledgerDatabase, productShellDatabase);
  assert.deepEqual(calls, [
    { databaseName: "maxpower-account.sqlite", useNewConnection: true },
    { databaseName: "maxpower-account.sqlite", useNewConnection: true },
  ]);
});
