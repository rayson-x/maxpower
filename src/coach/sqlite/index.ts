import { SQLiteCoachLedger } from "./SQLiteCoachLedger";
import type { SQLiteDatabaseLike } from "./types";

export { SQLiteCoachLedger };
export {
  RecoverableCoachLedgerMigrationError,
  SQLITE_COACH_LEDGER_SCHEMA_VERSION,
} from "./errors";
export type { SQLiteBindValue, SQLiteDatabaseLike } from "./types";

/** Inject an Expo SQLite database (or compatible host) without coupling core to Expo. */
export function createSQLiteCoachLedger(database: SQLiteDatabaseLike): SQLiteCoachLedger {
  return new SQLiteCoachLedger(database);
}
