import {
  assertProductShellStateStoreUserId,
  type ProductShellStateClearRequest,
  type ProductShellStateRestoreRequest,
  type ProductShellStateSaveRequest,
  type ProductShellStateStore,
} from "../ui/ProductShellStateStore";
import {
  encodeProductShellState,
  resolveProductShellRecovery,
  type ProductShellRecovery,
} from "../ui/productNavigation";

/** The subset of Expo SQLite used by the presentation-state adapter. */
export interface ProductShellStateSqlDatabase {
  execAsync(source: string): Promise<void>;
  getFirstAsync<T>(source: string, ...params: readonly string[]): Promise<T | null>;
  runAsync(source: string, ...params: readonly string[]): Promise<unknown>;
}

interface ShellStateRow {
  payload: string;
}

const createSchema = `
  CREATE TABLE IF NOT EXISTS maxpower_product_shell_state (
    user_id TEXT PRIMARY KEY NOT NULL,
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * A small user-scoped table alongside the local Coach ledger. It deliberately
 * does not alter the ledger schema version: this state is recoverable UI
 * presentation, not a domain aggregate.
 */
export class SQLiteProductShellStateStore implements ProductShellStateStore {
  private initialization?: Promise<void>;

  constructor(private readonly database: ProductShellStateSqlDatabase, private readonly now = () => new Date().toISOString()) {}

  async restore(input: ProductShellStateRestoreRequest): Promise<ProductShellRecovery> {
    assertProductShellStateStoreUserId(input.userId);
    await this.initialize();
    const row = await this.database.getFirstAsync<ShellStateRow>(
      "SELECT payload FROM maxpower_product_shell_state WHERE user_id = ?",
      input.userId,
    );
    return resolveProductShellRecovery(row?.payload, input.fallbackDate);
  }

  async save(input: ProductShellStateSaveRequest): Promise<void> {
    assertProductShellStateStoreUserId(input.userId);
    await this.initialize();
    await this.database.runAsync(
      `INSERT INTO maxpower_product_shell_state (user_id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      input.userId,
      encodeProductShellState(input.state),
      this.now(),
    );
  }

  async clear(input: ProductShellStateClearRequest): Promise<void> {
    assertProductShellStateStoreUserId(input.userId);
    await this.initialize();
    await this.database.runAsync(
      "DELETE FROM maxpower_product_shell_state WHERE user_id = ?",
      input.userId,
    );
  }

  private async initialize(): Promise<void> {
    if (!this.initialization) this.initialization = this.database.execAsync(createSchema);
    await this.initialization;
  }
}
