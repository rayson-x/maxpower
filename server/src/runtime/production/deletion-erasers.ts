import type { PostgresPool } from "../../adapters/postgres/client.js";
import type {
  IdentityEraser,
} from "../../adapters/account-deletion/postgres-account-deletion.js";

/** Deletes Better Auth's user-linked rows; repeated execution is intentionally harmless. */
export class PostgresIdentityEraser implements IdentityEraser {
  readonly #pool: PostgresPool;

  constructor(pool: PostgresPool) {
    this.#pool = pool;
  }

  async eraseIdentity(accountId: string): Promise<void> {
    const id = requireAccountId(accountId);
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 91))", [id]);
      await client.query(`DELETE FROM "verification" verification
        USING "user" identity_user
        WHERE identity_user.id = $1
          AND (
            verification.identifier = identity_user.email
            OR verification.identifier = COALESCE(identity_user."phoneNumber", '')
            OR CASE
              WHEN ltrim(verification.value) LIKE '{%'
              THEN (
                ltrim(verification.value)::jsonb ->> 'accountId' = identity_user.id
                OR ltrim(verification.value)::jsonb #>> '{identifier,value}' = identity_user.email
                OR ltrim(verification.value)::jsonb #>> '{identifier,value}' = COALESCE(identity_user."phoneNumber", '')
              )
              ELSE false
            END
          )`, [id]);
      await client.query('DELETE FROM "session" WHERE "userId" = $1', [id]);
      await client.query('DELETE FROM "account" WHERE "userId" = $1', [id]);
      await client.query('DELETE FROM "user" WHERE id = $1', [id]);
      await client.query("COMMIT");
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the first cleanup failure for the retryable job.
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

function requireAccountId(value: string): string {
  const accountId = value.trim();
  if (!accountId) throw new Error("Account ID is required for deletion.");
  return accountId;
}
