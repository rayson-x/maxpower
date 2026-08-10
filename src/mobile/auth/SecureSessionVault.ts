import type { SecureCredentialKey, SecureCredentialPort } from "../../privacy/model";

import {
  OnlineAuthError,
  type AuthenticatedIdentity,
  type AccountDeletionRecovery,
  type ServiceAccessToken,
  type SessionCredential,
} from "./model";

const SESSION_STORAGE_VERSION = 1;
const DELETION_RECOVERY_VERSION = 1;

/** One active login per installed app; accountId is inside the protected value. */
export const activeSessionCredentialKey: SecureCredentialKey = {
  accountId: "maxpower-online-auth",
  scope: "device",
  name: "active-session-v1",
};

/** Install secret used only to bind one-time social exchanges to this app sandbox. */
export const socialExchangeBindingCredentialKey: SecureCredentialKey = {
  accountId: "maxpower-online-auth",
  scope: "device",
  name: "social-exchange-binding-v1",
};

export const accountDeletionRecoveryCredentialKey: SecureCredentialKey = {
  accountId: "maxpower-online-auth",
  scope: "device",
  name: "account-deletion-recovery-v1",
};

export class SecureSessionVault {
  constructor(private readonly credentials: SecureCredentialPort) {}

  async read(): Promise<SessionCredential | null> {
    const result = await this.credentials.get({ key: activeSessionCredentialKey });
    if (result.status === "unavailable") {
      throw new OnlineAuthError("secure_storage_unavailable", "Secure session storage is unavailable.");
    }
    if (result.status !== "available") return null;
    try {
      const value = JSON.parse(result.value) as unknown;
      if (!isRecord(value) || value.version !== SESSION_STORAGE_VERSION) throw new Error("invalid_session_record");
      const accountId = requiredText(value.accountId);
      const sessionToken = requiredText(value.sessionToken);
      return { accountId, sessionToken };
    } catch {
      // Fail closed: a partial/corrupt credential must never be guessed.
      await this.clear();
      return null;
    }
  }

  async write(value: SessionCredential): Promise<void> {
    const accountId = requiredText(value.accountId);
    const sessionToken = requiredText(value.sessionToken);
    await this.credentials.rotate({
      key: activeSessionCredentialKey,
      value: JSON.stringify({ version: SESSION_STORAGE_VERSION, accountId, sessionToken }),
    });
  }

  async clear(): Promise<void> {
    await this.credentials.delete({ key: activeSessionCredentialKey });
  }
}

export type RandomBytes = (length: number) => Uint8Array;

/**
 * A random install binding sent only over HTTPS at social start/exchange. It
 * never appears in the browser URL or app deep link, so another app that
 * claims the custom scheme cannot redeem a stolen one-time code.
 */
export class SocialExchangeBindingVault {
  private pending?: Promise<string>;

  constructor(
    private readonly credentials: SecureCredentialPort,
    private readonly randomBytes: RandomBytes = systemRandomBytes,
  ) {}

  readOrCreate(): Promise<string> {
    this.pending ??= this.loadOrCreate().catch((cause) => {
      this.pending = undefined;
      throw cause;
    });
    return this.pending;
  }

  private async loadOrCreate(): Promise<string> {
    const stored = await this.credentials.get({ key: socialExchangeBindingCredentialKey });
    if (stored.status === "unavailable") {
      throw new OnlineAuthError("secure_storage_unavailable", "Secure social login storage is unavailable.");
    }
    if (stored.status === "available" && /^[a-f0-9]{64}$/.test(stored.value)) return stored.value;
    const bytes = this.randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
      throw new OnlineAuthError("secure_storage_unavailable", "Secure random generation is unavailable.");
    }
    const binding = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    await this.credentials.rotate({ key: socialExchangeBindingCredentialKey, value: binding });
    return binding;
  }
}

/** Survives session revocation so an interrupted deletion response can be recovered safely. */
export class DeletionRecoveryVault {
  constructor(
    private readonly credentials: SecureCredentialPort,
    private readonly randomBytes: RandomBytes = systemRandomBytes,
  ) {}

  async read(): Promise<AccountDeletionRecovery | null> {
    const stored = await this.credentials.get({ key: accountDeletionRecoveryCredentialKey });
    if (stored.status === "unavailable") {
      throw new OnlineAuthError("secure_storage_unavailable", "Secure deletion recovery storage is unavailable.");
    }
    if (stored.status !== "available") return null;
    try {
      const value = JSON.parse(stored.value) as unknown;
      if (!isRecord(value) || value.version !== DELETION_RECOVERY_VERSION) throw new Error("invalid_record");
      const requestKey = requiredText(value.requestKey).toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(requestKey)) throw new Error("invalid_request_key");
      const receipt = value.receipt === null ? null : requiredText(value.receipt);
      return { requestKey, receipt };
    } catch {
      await this.clear();
      return null;
    }
  }

  async start(): Promise<AccountDeletionRecovery> {
    const bytes = this.randomBytes(32);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
      throw new OnlineAuthError("secure_storage_unavailable", "Secure random generation is unavailable.");
    }
    const recovery = {
      requestKey: Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(""),
      receipt: null,
    };
    await this.write(recovery);
    return recovery;
  }

  async saveReceipt(receipt: string): Promise<AccountDeletionRecovery> {
    const current = await this.read();
    if (!current) throw new OnlineAuthError("invalid_response", "Deletion recovery was not initialized.");
    const next = { ...current, receipt: requiredText(receipt) };
    await this.write(next);
    return next;
  }

  async clear(): Promise<void> {
    await this.credentials.delete({ key: accountDeletionRecoveryCredentialKey });
  }

  private async write(value: AccountDeletionRecovery): Promise<void> {
    await this.credentials.rotate({
      key: accountDeletionRecoveryCredentialKey,
      value: JSON.stringify({ version: DELETION_RECOVERY_VERSION, ...value }),
    });
  }
}

/** Deliberately has no persistence adapter. A process restart always empties it. */
export class MemoryServiceAccessTokenStore {
  private value: ServiceAccessToken | null = null;

  replace(identity: AuthenticatedIdentity): void {
    this.value = {
      accountId: requiredText(identity.accountId),
      sessionId: requiredText(identity.sessionId),
      accessToken: requiredText(identity.accessToken),
      expiresAt: requiredText(identity.expiresAt),
    };
  }

  current(): ServiceAccessToken | null {
    return this.value === null ? null : { ...this.value };
  }

  accessTokenFor(accountId: string): string {
    if (!this.value || this.value.accountId !== accountId) {
      throw new OnlineAuthError("not_authenticated", "No service access token exists for this account.");
    }
    return this.value.accessToken;
  }

  clear(): void {
    this.value = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OnlineAuthError("invalid_response", "Authentication credential is invalid.");
  }
  return value.trim();
}

function systemRandomBytes(length: number): Uint8Array {
  const crypto = globalThis.crypto;
  if (!crypto?.getRandomValues) {
    throw new OnlineAuthError("secure_storage_unavailable", "Secure random generation is unavailable.");
  }
  return crypto.getRandomValues(new Uint8Array(length));
}
