export type SQLiteBindValue = string | number | null | Uint8Array;

/**
 * Smallest database surface required by the ledger. Expo SQLite databases can
 * be passed directly; tests and other hosts may provide an equivalent adapter.
 */
export interface SQLiteDatabaseLike {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string, ...params: SQLiteBindValue[]): Promise<T | null>;
  runAsync(source: string, ...params: SQLiteBindValue[]): Promise<unknown>;
  withTransactionAsync?(task: () => Promise<void>): Promise<void>;
}
