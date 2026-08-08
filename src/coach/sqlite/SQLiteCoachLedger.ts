import {
  applyAtomicCommitTransition,
  type AtomicCommit,
  type AtomicCommitResult,
  type CoachLedger,
} from "../ledger";
import type { LedgerSnapshot } from "../model";
import { clone } from "../stable";
import {
  RecoverableCoachLedgerMigrationError,
  SQLITE_COACH_LEDGER_SCHEMA_VERSION,
} from "./errors";
import type { SQLiteDatabaseLike } from "./types";

const EMPTY: LedgerSnapshot = {
  sessions: [],
  users: [],
  artifacts: [],
  presentations: [],
  runEvents: [],
  actionTokens: [],
  actionEvents: [],
  idempotency: [],
  pendingHumanActions: [],
  workingMemory: [],
};

const CREATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS coach_ledger_snapshot (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    payload TEXT NOT NULL
  );
`;

interface UserVersionRow {
  user_version: number;
}

interface SnapshotRow {
  payload: string;
}

export class SQLiteCoachLedger implements CoachLedger {
  private initialization?: Promise<void>;

  constructor(private readonly database: SQLiteDatabaseLike) {}

  async read(): Promise<LedgerSnapshot> {
    await this.initialize();
    return this.readInitialized();
  }

  async replace(snapshot: LedgerSnapshot): Promise<void> {
    await this.initialize();
    await this.transaction(async () => {
      await this.writeInitialized(snapshot);
    });
  }

  async commit(input: AtomicCommit): Promise<AtomicCommitResult> {
    await this.initialize();
    let result: AtomicCommitResult | undefined;
    await this.transaction(async () => {
      const current = await this.readInitialized();
      const applied = applyAtomicCommitTransition(current, input);
      result = applied.result;
      if (applied.snapshot !== current) {
        await this.writeInitialized(applied.snapshot);
      }
    });
    if (!result) throw new Error("SQLite transaction completed without an AtomicCommit result");
    return result;
  }

  private async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.initializeOnce();
    }
    return this.initialization;
  }

  private async initializeOnce(): Promise<void> {
    let foundVersion = 0;
    try {
      const row = await this.database.getFirstAsync<UserVersionRow>("PRAGMA user_version");
      foundVersion = Number(row?.user_version ?? 0);
      if (
        !Number.isInteger(foundVersion) ||
        foundVersion < 0 ||
        foundVersion > SQLITE_COACH_LEDGER_SCHEMA_VERSION
      ) {
        throw new RecoverableCoachLedgerMigrationError(foundVersion);
      }

      if (foundVersion === 0) {
        await this.transaction(async () => {
          await this.database.execAsync(CREATE_SCHEMA);
          await this.database.runAsync(
            "INSERT OR IGNORE INTO coach_ledger_snapshot (id, payload) VALUES (1, ?)",
            JSON.stringify(EMPTY),
          );
          await this.database.execAsync(
            `PRAGMA user_version = ${SQLITE_COACH_LEDGER_SCHEMA_VERSION}`,
          );
        });
        return;
      }

      await this.database.execAsync(CREATE_SCHEMA);
    } catch (error) {
      if (error instanceof RecoverableCoachLedgerMigrationError) throw error;
      throw new RecoverableCoachLedgerMigrationError(foundVersion, undefined, { cause: error });
    }
  }

  private async readInitialized(): Promise<LedgerSnapshot> {
    const row = await this.database.getFirstAsync<SnapshotRow>(
      "SELECT payload FROM coach_ledger_snapshot WHERE id = 1",
    );
    if (!row) return clone(EMPTY);
    return clone(normalizeSnapshot(JSON.parse(row.payload) as Partial<LedgerSnapshot>));
  }

  private async writeInitialized(snapshot: LedgerSnapshot): Promise<void> {
    await this.database.runAsync(
      `INSERT INTO coach_ledger_snapshot (id, payload) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload`,
      JSON.stringify(snapshot),
    );
  }

  private async transaction(task: () => Promise<void>): Promise<void> {
    if (this.database.withTransactionAsync) {
      await this.database.withTransactionAsync(task);
      return;
    }

    await this.database.execAsync("BEGIN IMMEDIATE");
    try {
      await task();
      await this.database.execAsync("COMMIT");
    } catch (error) {
      try {
        await this.database.execAsync("ROLLBACK");
      } catch {
        // Preserve the domain/storage error that caused the rollback.
      }
      throw error;
    }
  }
}

function normalizeSnapshot(snapshot: Partial<LedgerSnapshot>): LedgerSnapshot {
  return {
    sessions: snapshot.sessions ?? [],
    users: snapshot.users ?? [],
    artifacts: snapshot.artifacts ?? [],
    presentations: snapshot.presentations ?? [],
    runEvents: snapshot.runEvents ?? [],
    actionTokens: snapshot.actionTokens ?? [],
    actionEvents: snapshot.actionEvents ?? [],
    idempotency: snapshot.idempotency ?? [],
    pendingHumanActions: snapshot.pendingHumanActions ?? [],
    workingMemory: snapshot.workingMemory ?? [],
  };
}
