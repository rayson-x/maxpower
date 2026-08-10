import { forbidden, unauthorized } from "../../kernel/api-error.js";
import { SystemClock, type Clock } from "../../kernel/clock.js";
import type { AccountStatus, Principal } from "../../kernel/principal.js";
import type { IdentityAccessTokenVerifier } from "./better-auth-identity-adapter.js";

export interface LiveIdentitySession {
  accountId: string;
  sessionId: string;
  expiresAt: Date;
  accountStatus: AccountStatus;
  scopes: ReadonlySet<string>;
}

/** Current Better Auth session and user authorization, read after JWT validation. */
export interface LiveIdentitySessionStore {
  findLiveSession(input: {
    accountId: string;
    sessionId: string;
  }): Promise<LiveIdentitySession | null>;
}

export interface LiveSessionAccessTokenVerifierOptions {
  signedTokens: IdentityAccessTokenVerifier;
  sessions: LiveIdentitySessionStore;
  clock?: Clock;
}

/**
 * Preserves short-lived, offline JWT validation while making session revocation
 * and account restrictions effective immediately on every protected request.
 */
export class LiveSessionAccessTokenVerifier implements IdentityAccessTokenVerifier {
  readonly #signedTokens: IdentityAccessTokenVerifier;
  readonly #sessions: LiveIdentitySessionStore;
  readonly #clock: Clock;

  constructor(options: LiveSessionAccessTokenVerifierOptions) {
    this.#signedTokens = options.signedTokens;
    this.#sessions = options.sessions;
    this.#clock = options.clock ?? new SystemClock();
  }

  async verifyAccessToken(token: string): Promise<Principal> {
    const signed = await this.#signedTokens.verifyAccessToken(token);
    const live = await this.#sessions.findLiveSession({
      accountId: signed.accountId,
      sessionId: signed.sessionId,
    });
    if (
      !live ||
      live.accountId !== signed.accountId ||
      live.sessionId !== signed.sessionId ||
      !Number.isFinite(live.expiresAt.getTime()) ||
      live.expiresAt.getTime() <= this.#clock.now().getTime()
    ) {
      throw unauthorized("The access token session is invalid or expired.");
    }
    if (live.accountStatus !== "active") {
      throw forbidden("account_unavailable", "The account is not available.");
    }
    return {
      accountId: live.accountId,
      sessionId: live.sessionId,
      status: live.accountStatus,
      scopes: new Set(live.scopes),
    };
  }
}
