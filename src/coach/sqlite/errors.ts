export const SQLITE_COACH_LEDGER_SCHEMA_VERSION = 7;

export class RecoverableCoachLedgerMigrationError extends Error {
  readonly code = "COACH_LEDGER_MIGRATION_RECOVERY_REQUIRED" as const;
  readonly recovery = "recreate_or_restore_local_ledger" as const;

  constructor(
    readonly foundVersion: number,
    readonly supportedVersion: number = SQLITE_COACH_LEDGER_SCHEMA_VERSION,
    options?: ErrorOptions,
  ) {
    super(
      `Coach ledger schema ${foundVersion} cannot be opened by schema ${supportedVersion}`,
      options,
    );
    this.name = "RecoverableCoachLedgerMigrationError";
  }
}
