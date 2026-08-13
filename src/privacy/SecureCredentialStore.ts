import type { ReplicaAccessCredential, ReplicaCredentialSource } from "../sync";
import {
  SecureCredentialError,
  type SecureCredentialKey,
  type SecureCredentialPort,
  type SecureCredentialReadResult,
} from "./model";

/** Deterministic fake with account/scope/name isolation for contract and domain tests. */
export class InMemorySecureCredentialPort implements SecureCredentialPort {
  private readonly values = new Map<string, string>();

  async put(input: { key: SecureCredentialKey; value: string }): Promise<void> {
    if (!input.value) throw new SecureCredentialError("write_failed");
    this.values.set(keyFor(input.key), input.value);
  }

  async get(input: { key: SecureCredentialKey }): Promise<SecureCredentialReadResult> {
    const value = this.values.get(keyFor(input.key));
    return value === undefined ? { status: "missing_or_invalidated" } : { status: "available", value };
  }

  async delete(input: { key: SecureCredentialKey }): Promise<void> {
    this.values.delete(keyFor(input.key));
  }

  async rotate(input: { key: SecureCredentialKey; value: string }): Promise<void> {
    await this.put(input);
  }
}

/**
 * Keeps the sync transport's opaque bearer credential in a separate secure
 * namespace. Bad or stale JSON becomes unavailable rather than being guessed.
 */
export class SecureReplicaCredentialSource implements ReplicaCredentialSource {
  constructor(private readonly credentials: SecureCredentialPort) {}

  async readReplicaCredential(input: { accountId: string }): Promise<ReplicaAccessCredential | null> {
    const result = await this.credentials.get({ key: replicaCredentialKey(input.accountId) });
    if (result.status !== "available") return null;
    try {
      const value = JSON.parse(result.value) as Partial<ReplicaAccessCredential>;
      if (!value.accessToken || value.accountId !== input.accountId) return null;
      return {
        accessToken: value.accessToken,
        accountId: value.accountId,
        ...(typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {}),
      };
    } catch {
      return null;
    }
  }

  async writeReplicaCredential(value: ReplicaAccessCredential): Promise<void> {
    await this.credentials.rotate({
      key: replicaCredentialKey(value.accountId),
      value: JSON.stringify(value),
    });
  }

  async deleteReplicaCredential(accountId: string): Promise<void> {
    await this.credentials.delete({ key: replicaCredentialKey(accountId) });
  }
}

export function replicaCredentialKey(accountId: string): SecureCredentialKey {
  return { accountId, scope: "sync", name: "replica_access" };
}

function keyFor(key: SecureCredentialKey): string {
  return `${key.accountId}\u0000${key.scope}\u0000${key.name}`;
}
