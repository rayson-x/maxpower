import {
  applyDomainAtomicCommitTransition,
  type CoachLedgerDiagnostics,
  type CoachLedger,
  type DomainAtomicCommit,
  type StagedLedgerRestore,
  EMPTY_LEDGER_SNAPSHOT,
  LedgerConflictError,
  normalizeLedgerSnapshot,
} from "../ledger";
import type { LedgerSnapshot } from "../model";
import type {
  DomainCommandResult,
  DomainProjection,
  DomainProjectionQuery,
} from "../domain";
import { projectDomainEvents } from "../domain";
import { clone, stableHash } from "../stable";
import {
  RecoverableCoachLedgerMigrationError,
  SQLITE_COACH_LEDGER_SCHEMA_VERSION,
} from "./errors";
import type { SQLiteDatabaseLike } from "./types";

const EMPTY: LedgerSnapshot = EMPTY_LEDGER_SNAPSHOT;

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

interface CoachLedgerMigration {
  from: number;
  to: number;
  run(ledger: SQLiteCoachLedger): Promise<void>;
}

const MIGRATIONS: readonly CoachLedgerMigration[] = [
  {
    from: 0,
    to: 1,
    async run(ledger) {
      await ledger.createSchemaForMigration();
      await ledger.insertEmptySnapshotForMigration();
    },
  },
  {
    from: 1,
    to: 2,
    async run(ledger) {
      await ledger.createSchemaForMigration();
      await ledger.normalizeSnapshotForMigration();
    },
  },
  {
    from: 2,
    to: 3,
    async run(ledger) {
      await ledger.createSchemaForMigration();
      await ledger.normalizeSnapshotForMigration();
    },
  },
  {
    from: 3,
    to: 4,
    async run(ledger) {
      await ledger.createSchemaForMigration();
      await ledger.normalizeSnapshotForMigration();
    },
  },
  {
    from: 4,
    to: 5,
    async run(ledger) {
      // Adds replica cursor/pending-envelope fields through canonical snapshot
      // normalization; no data is discarded during this additive migration.
      await ledger.createSchemaForMigration();
      await ledger.normalizeSnapshotForMigration();
    },
  },
  {
    from: 5,
    to: 6,
    async run(ledger) {
      // Adds device-local remote Provider selections through canonical
      // normalization. They intentionally remain outside replica/outbox data.
      await ledger.createSchemaForMigration();
      await ledger.normalizeSnapshotForMigration();
    },
  },
  {
    from: 6,
    to: 7,
    async run(ledger) {
      // Adds the trace upload outbox through canonical normalization. It stays
      // empty until the observability authorization is granted.
      await ledger.createSchemaForMigration();
      await ledger.normalizeSnapshotForMigration();
    },
  },
];

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

  async swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void> {
    await this.initialize();
    await this.transaction(async () => {
      const current = await this.readInitialized();
      if (stableHash(current) !== input.expectedSnapshotHash) {
        throw new LedgerConflictError("stale_snapshot");
      }
      await this.writeInitialized(input.nextSnapshot);
    });
  }

  async readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection> {
    const snapshot = await this.read();
    return projectDomainEvents(snapshot.domainEvents, query);
  }

  async diagnose(): Promise<CoachLedgerDiagnostics> {
    const { diagnoseLedgerSnapshot } = await import("../ledger");
    return diagnoseLedgerSnapshot(await this.read());
  }

  async commit(input: DomainAtomicCommit): Promise<DomainCommandResult> {
    await this.initialize();
    let result: DomainCommandResult | undefined;
    await this.transaction(async () => {
      const current = await this.readInitialized();
      const applied = applyDomainAtomicCommitTransition(current, input);
      result = applied.result;
      if (applied.snapshot !== current) {
        await this.writeInitialized(applied.snapshot);
      }
    });
    if (!result) throw new Error("SQLite transaction completed without a commit result");
    return result;
  }

  async commitBatch(inputs: readonly DomainAtomicCommit[]): Promise<readonly DomainCommandResult[]> {
    await this.initialize();
    const results: DomainCommandResult[] = [];
    await this.transaction(async () => {
      let next = await this.readInitialized();
      for (const input of inputs) {
        const applied = applyDomainAtomicCommitTransition(next, input);
        next = applied.snapshot;
        results.push(applied.result);
      }
      await this.writeInitialized(next);
    });
    return results;
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

      if (foundVersion < SQLITE_COACH_LEDGER_SCHEMA_VERSION) {
        await this.transaction(async () => {
          let version = foundVersion;
          while (version < SQLITE_COACH_LEDGER_SCHEMA_VERSION) {
            const migration = MIGRATIONS.find((candidate) => candidate.from === version);
            if (!migration) throw new RecoverableCoachLedgerMigrationError(version);
            await migration.run(this);
            version = migration.to;
            await this.database.execAsync(`PRAGMA user_version = ${version}`);
          }
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

  async createSchemaForMigration(): Promise<void> {
    await this.database.execAsync(CREATE_SCHEMA);
  }

  async insertEmptySnapshotForMigration(): Promise<void> {
    await this.database.runAsync(
      "INSERT OR IGNORE INTO coach_ledger_snapshot (id, payload) VALUES (1, ?)",
      JSON.stringify(EMPTY),
    );
  }

  async normalizeSnapshotForMigration(): Promise<void> {
    const row = await this.database.getFirstAsync<SnapshotRow>(
      "SELECT payload FROM coach_ledger_snapshot WHERE id = 1",
    );
    const migrated = normalizeLedgerSnapshot(
      row ? (JSON.parse(row.payload) as Partial<LedgerSnapshot>) : EMPTY,
    );
    await this.writeInitialized(migrated);
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
  return normalizeLedgerSnapshot(snapshot);
}
