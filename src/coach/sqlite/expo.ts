import * as SQLite from "expo-sqlite";

import { createSQLiteCoachLedger } from "./index";

/** Expo 57 production composition helper. Tests inject a compatible database directly. */
export async function openExpoSQLiteCoachLedger(databaseName = "coach-ledger.db") {
  const database = await SQLite.openDatabaseAsync(databaseName);
  return createSQLiteCoachLedger(database);
}
