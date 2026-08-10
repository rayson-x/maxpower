import { AccountRuntimeCoordinator, RuntimeActivationSupersededError } from "./AccountRuntimeCoordinator";
import {
  DeletionRecoveryVault,
  MemoryServiceAccessTokenStore,
  SecureSessionVault,
} from "./SecureSessionVault";
import {
  OnlineAuthError,
  type AccountRuntime,
  type AccountDeletionRecovery,
  type AccountDeletionProgress,
  type AuthenticatedIdentity,
  type CompleteRegistrationInput,
  type CompleteSocialOnboardingInput,
  type IdentityIdentifier,
  type IdentityPublicConfiguration,
  type LinkedIdentity,
  type OnlineAuthApi,
  type OnlineAuthState,
  type OtpChallengeStarted,
  type ReachabilityPort,
  type RegistrationOtpResult,
  type SocialAuthorizationPort,
  type SocialProvider,
  type SocialSignInResult,
} from "./model";

export interface OnlineAuthControllerOptions<TRuntime extends AccountRuntime> {
  reachability: ReachabilityPort;
  auth: OnlineAuthApi;
  sessionVault: SecureSessionVault;
  deletionRecovery?: DeletionRecoveryVault;
  serviceAccessTokens: MemoryServiceAccessTokenStore;
  runtimes: AccountRuntimeCoordinator<TRuntime>;
}

export class OnlineAuthController<TRuntime extends AccountRuntime = AccountRuntime> {
  readonly serviceAccessTokens: MemoryServiceAccessTokenStore;

  private state: OnlineAuthState<TRuntime> = { status: "checking" };
  private readonly listeners = new Set<(state: OnlineAuthState<TRuntime>) => void>();
  private transitionGeneration = 0;
  private transition?: AbortController;

  private readonly reachability: ReachabilityPort;
  private readonly auth: OnlineAuthApi;
  private readonly sessionVault: SecureSessionVault;
  private readonly deletionRecovery?: DeletionRecoveryVault;
  private readonly runtimes: AccountRuntimeCoordinator<TRuntime>;

  constructor(options: OnlineAuthControllerOptions<TRuntime>) {
    this.reachability = options.reachability;
    this.auth = options.auth;
    this.sessionVault = options.sessionVault;
    this.deletionRecovery = options.deletionRecovery;
    this.serviceAccessTokens = options.serviceAccessTokens;
    this.runtimes = options.runtimes;
  }

  currentState(): OnlineAuthState<TRuntime> {
    return this.state;
  }

  subscribe(listener: (state: OnlineAuthState<TRuntime>) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  async bootstrap(): Promise<void> {
    const transition = this.beginTransition("checking");
    try {
      await this.reachability.assertReachable(transition.signal);
      if (!this.isCurrent(transition)) return;
      const recovery = await this.deletionRecovery?.read();
      if (!this.isCurrent(transition)) return;
      if (recovery) {
        await this.restoreDeletion(recovery, transition);
        return;
      }
      const stored = await this.sessionVault.read();
      if (!this.isCurrent(transition)) return;
      if (!stored) {
        this.setIfCurrent(transition, { status: "signed_out" });
        return;
      }
      const identity = await this.auth.refreshSession(stored.sessionToken, transition.signal);
      if (identity.accountId !== stored.accountId) {
        await this.clearAuthentication();
        this.setIfCurrent(transition, {
          status: "signed_out",
          error: new OnlineAuthError("account_mismatch", "Stored session belongs to a different account."),
        });
        return;
      }
      await this.activate(identity, transition);
    } catch (cause) {
      await this.handleFailure(cause, transition, true);
    }
  }

  async loginWithPassword(input: { identifier: IdentityIdentifier; password: string }): Promise<void> {
    await this.authenticate((signal) => this.auth.loginWithPassword(input, signal));
  }

  async getPublicConfiguration(): Promise<IdentityPublicConfiguration> {
    const controller = new AbortController();
    await this.reachability.assertReachable(controller.signal);
    return this.auth.getPublicConfiguration(controller.signal);
  }

  async startLoginOtp(input: { identifier: IdentityIdentifier }): Promise<OtpChallengeStarted> {
    return this.withReachability((signal) => this.auth.startLoginOtp(input, signal));
  }

  async verifyLoginOtp(input: { challengeId: string; code: string }): Promise<void> {
    await this.authenticate((signal) => this.auth.verifyLoginOtp(input, signal));
  }

  async startRegistrationOtp(input: { identifier: IdentityIdentifier }): Promise<OtpChallengeStarted> {
    return this.withReachability((signal) => this.auth.startRegistrationOtp(input, signal));
  }

  async verifyRegistrationOtp(input: { challengeId: string; code: string }): Promise<RegistrationOtpResult> {
    const result = await this.withReachability((signal) => this.auth.verifyRegistrationOtp(input, signal));
    if (result.status === "authenticated") await this.adoptAuthenticatedResult(result);
    return result;
  }

  async completeRegistration(input: CompleteRegistrationInput): Promise<void> {
    await this.authenticate((signal) => this.auth.completeRegistration(input, signal));
  }

  async completeSocialOnboarding(input: CompleteSocialOnboardingInput): Promise<void> {
    await this.authenticate((signal) => this.auth.completeSocialOnboarding(input, signal));
  }

  async signInWithSocial(
    provider: SocialProvider,
    authorization: SocialAuthorizationPort,
  ): Promise<SocialSignInResult> {
    if (!authorization.availableProviders().includes(provider)) {
      throw new OnlineAuthError("configuration_error", "Social provider is unavailable on this device.");
    }
    // Keep the credential screen mounted while the system browser owns focus;
    // a first-time account still needs local nickname/terms onboarding state.
    const transition = this.beginTransition(undefined);
    try {
      await this.reachability.assertReachable(transition.signal);
      const started = await this.auth.startSocialSignIn({
        provider,
        callbackUrl: authorization.callbackUrl,
      }, transition.signal);
      const browserResult = await authorization.authorize({
        authorizationUrl: started.authorizationUrl,
        signal: transition.signal,
      });
      if (browserResult.status === "cancelled") return { status: "cancelled" };
      const exchanged = await this.auth.exchangeSocialCallback({
        callbackUrl: browserResult.callbackUrl,
        expectedCallbackUrl: authorization.callbackUrl,
        expectedExchangeState: started.exchangeState,
      }, transition.signal);
      let identity: AuthenticatedIdentity;
      try {
        identity = await this.auth.refreshSession(exchanged.sessionToken, transition.signal);
      } catch (cause) {
        const error = asOnlineAuthError(cause);
        if (error.code === "not_authenticated") {
          this.setIfCurrent(transition, { status: "signed_out" });
          return { status: "onboarding_required", sessionToken: exchanged.sessionToken };
        }
        throw cause;
      }
      await this.activate(identity, transition);
      return { status: "authenticated" };
    } catch (cause) {
      await this.handleFailure(cause, transition, false);
      throw asOnlineAuthError(cause);
    }
  }

  async listLinkedIdentities(): Promise<readonly LinkedIdentity[]> {
    return this.withAuthenticatedSession((sessionToken, signal) =>
      this.auth.listLinkedIdentities(sessionToken, signal)
    );
  }

  async linkSocialIdentity(
    provider: SocialProvider,
    authorization: SocialAuthorizationPort,
  ): Promise<"linked" | "cancelled"> {
    if (!authorization.availableProviders().includes(provider)) {
      throw new OnlineAuthError("configuration_error", "Social provider is unavailable on this device.");
    }
    return this.withAuthenticatedSession(async (sessionToken, signal) => {
      const started = await this.auth.startSocialIdentityLink({
        sessionToken,
        provider,
        callbackUrl: authorization.callbackUrl,
      }, signal);
      const result = await authorization.authorize({ authorizationUrl: started.authorizationUrl, signal });
      if (result.status === "cancelled") return "cancelled";
      const identities = await this.auth.listLinkedIdentities(sessionToken, signal);
      if (!identities.some((identity) => identity.providerId === provider)) {
        throw new OnlineAuthError("request_failed", "The social identity was not linked.");
      }
      return "linked";
    });
  }

  async unlinkIdentity(identity: LinkedIdentity): Promise<readonly LinkedIdentity[]> {
    return this.withAuthenticatedSession(async (sessionToken, signal) => {
      const existing = await this.auth.listLinkedIdentities(sessionToken, signal);
      if (existing.length <= 1) {
        throw new OnlineAuthError("request_failed", "At least one login identity must remain linked.");
      }
      await this.auth.unlinkIdentity({
        sessionToken,
        providerId: identity.providerId,
        accountId: identity.accountId,
      }, signal);
      return this.auth.listLinkedIdentities(sessionToken, signal);
    });
  }

  async deleteAccount(): Promise<void> {
    if (!this.deletionRecovery) {
      throw new OnlineAuthError("configuration_error", "Account deletion recovery is not configured.");
    }
    const authenticated = this.state.status === "authenticated" ? this.state : undefined;
    if (!authenticated) throw new OnlineAuthError("not_authenticated");
    const accessToken = this.serviceAccessTokens.accessTokenFor(authenticated.identity.accountId);
    const recovery = await this.deletionRecovery.start();
    const transition = this.beginTransition("checking");
    try {
      await this.reachability.assertReachable(transition.signal);
      const deletion = await this.auth.requestAccountDeletion({
        accessToken,
        idempotencyKey: recovery.requestKey,
      }, transition.signal);
      const saved = await this.deletionRecovery.saveReceipt(requiredDeletionReceipt(deletion));
      await this.enterDeletion(deletion, saved, transition);
    } catch (cause) {
      if (!this.isCurrent(transition)) return;
      const error = asOnlineAuthError(cause);
      if (error.code === "network_unavailable") {
        await this.runtimes.stop();
        this.serviceAccessTokens.clear();
        this.setIfCurrent(transition, { status: "offline", error });
      } else {
        await this.deletionRecovery.clear();
        this.setIfCurrent(transition, authenticated);
      }
      throw error;
    }
  }

  async refreshDeletionStatus(): Promise<void> {
    if (this.state.status !== "deleting") return;
    const current = this.state;
    if (!current.recovery.receipt) throw new OnlineAuthError("invalid_response", "Deletion receipt is missing.");
    const deletion = await this.withReachability((signal) =>
      this.auth.getAccountDeletion(current.recovery.receipt!, signal)
    );
    if (this.state.status === "deleting" && this.state.recovery.requestKey === current.recovery.requestKey) {
      this.setState({ ...current, deletion });
    }
  }

  async acknowledgeCompletedDeletion(): Promise<void> {
    if (this.state.status !== "deleting" || this.state.deletion.status !== "completed") return;
    await this.deletionRecovery?.clear();
    await this.sessionVault.clear();
    this.setState({ status: "signed_out" });
  }

  /** Probe used by AuthRoot's foreground/interval guard. Network loss removes the product runtime. */
  async ensureReachable(): Promise<void> {
    if (this.state.status === "offline") {
      await this.bootstrap();
      return;
    }
    if (this.state.status !== "authenticated") return;
    const transition = this.beginTransition(undefined);
    try {
      await this.reachability.assertReachable(transition.signal);
      if (!this.isCurrent(transition)) return;
      const current = this.serviceAccessTokens.current();
      if (current && tokenNeedsRefresh(current.expiresAt)) {
        const stored = await this.sessionVault.read();
        if (!stored || stored.accountId !== current.accountId) {
          await this.clearAuthentication();
          this.setIfCurrent(transition, { status: "signed_out" });
          return;
        }
        const identity = await this.auth.refreshSession(stored.sessionToken, transition.signal);
        if (identity.accountId !== stored.accountId) throw new OnlineAuthError("account_mismatch");
        this.serviceAccessTokens.replace(identity);
        await this.sessionVault.write({ accountId: identity.accountId, sessionToken: identity.sessionToken });
        if (this.state.status === "authenticated") {
          this.setIfCurrent(transition, { ...this.state, identity });
        }
      }
    } catch (cause) {
      const error = asOnlineAuthError(cause);
      if (error.code === "network_unavailable") {
        await this.runtimes.stop();
        this.serviceAccessTokens.clear();
        this.setIfCurrent(transition, { status: "offline", error });
      } else if (error.code !== "request_aborted") {
        await this.handleFailure(error, transition, true);
      }
    }
  }

  async logout(): Promise<void> {
    const transition = this.beginTransition("checking");
    await this.runtimes.stop();
    this.serviceAccessTokens.clear();
    try {
      await this.reachability.assertReachable(transition.signal);
      const stored = await this.sessionVault.read();
      if (stored) await this.auth.signOut(stored.sessionToken, transition.signal);
      await this.sessionVault.clear();
      this.setIfCurrent(transition, { status: "signed_out" });
    } catch (cause) {
      if (!this.isCurrent(transition)) return;
      const error = asOnlineAuthError(cause);
      this.setIfCurrent(
        transition,
        error.code === "network_unavailable"
          ? { status: "offline", error }
          : { status: "error", error },
      );
    }
  }

  async dispose(): Promise<void> {
    this.transitionGeneration += 1;
    this.transition?.abort();
    this.transition = undefined;
    await this.runtimes.stop();
    this.serviceAccessTokens.clear();
    this.listeners.clear();
  }

  private async authenticate(action: (signal: AbortSignal) => Promise<AuthenticatedIdentity>): Promise<void> {
    const transition = this.beginTransition("authenticating");
    try {
      await this.reachability.assertReachable(transition.signal);
      const identity = await action(transition.signal);
      await this.activate(identity, transition);
    } catch (cause) {
      await this.handleFailure(cause, transition, false);
      if (this.isCurrent(transition)) throw asOnlineAuthError(cause);
    }
  }

  private async adoptAuthenticatedResult(identity: AuthenticatedIdentity): Promise<void> {
    const transition = this.beginTransition("authenticating");
    try {
      await this.activate(identity, transition);
    } catch (cause) {
      await this.handleFailure(cause, transition, false);
      if (this.isCurrent(transition)) throw asOnlineAuthError(cause);
    }
  }

  private async withReachability<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    try {
      await this.reachability.assertReachable(controller.signal);
      return await action(controller.signal);
    } catch (cause) {
      throw asOnlineAuthError(cause);
    }
  }

  private async withAuthenticatedSession<T>(
    action: (sessionToken: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.state.status !== "authenticated") throw new OnlineAuthError("not_authenticated");
    const accountId = this.state.identity.accountId;
    const transition = this.beginTransition(undefined);
    try {
      await this.reachability.assertReachable(transition.signal);
      const stored = await this.sessionVault.read();
      if (!stored || stored.accountId !== accountId) throw new OnlineAuthError("account_mismatch");
      return await action(stored.sessionToken, transition.signal);
    } catch (cause) {
      throw asOnlineAuthError(cause);
    }
  }

  private async restoreDeletion(
    recovery: AccountDeletionRecovery,
    transition: AbortController,
  ): Promise<void> {
    if (!this.deletionRecovery) throw new OnlineAuthError("configuration_error");
    let deletion: AccountDeletionProgress;
    if (recovery.receipt) {
      deletion = await this.auth.getAccountDeletion(recovery.receipt, transition.signal);
    } else {
      try {
        deletion = await this.auth.requestAccountDeletion({ idempotencyKey: recovery.requestKey }, transition.signal);
      } catch (cause) {
        const error = asOnlineAuthError(cause);
        if (error.status !== 401 && error.status !== 404) throw error;
        const stored = await this.sessionVault.read();
        if (!stored) throw error;
        const identity = await this.auth.refreshSession(stored.sessionToken, transition.signal);
        deletion = await this.auth.requestAccountDeletion({
          accessToken: identity.accessToken,
          idempotencyKey: recovery.requestKey,
        }, transition.signal);
      }
      recovery = await this.deletionRecovery.saveReceipt(requiredDeletionReceipt(deletion));
    }
    await this.enterDeletion(deletion, recovery, transition);
  }

  private async enterDeletion(
    deletion: AccountDeletionProgress,
    recovery: AccountDeletionRecovery,
    transition: AbortController,
  ): Promise<void> {
    await this.runtimes.stop();
    this.serviceAccessTokens.clear();
    // The server has already revoked the session. A transient SecureStore
    // deletion failure must not reactivate the account; bootstrap checks the
    // durable deletion recovery record before reading this stale credential.
    await this.sessionVault.clear().catch(() => undefined);
    this.setIfCurrent(transition, { status: "deleting", deletion, recovery });
  }

  private async activate(identity: AuthenticatedIdentity, transition: AbortController): Promise<void> {
    if (!this.isCurrent(transition)) throw new RuntimeActivationSupersededError();
    // The old account keeps its token only long enough for runtime disposal;
    // no new account credential is published before that boundary finishes.
    await this.runtimes.stop();
    if (!this.isCurrent(transition)) throw new RuntimeActivationSupersededError();
    this.serviceAccessTokens.clear();
    await this.sessionVault.write({ accountId: identity.accountId, sessionToken: identity.sessionToken });
    if (!this.isCurrent(transition)) throw new RuntimeActivationSupersededError();
    this.serviceAccessTokens.replace(identity);
    const runtime = await this.runtimes.activate({
      accountId: identity.accountId,
      accessToken: () => this.serviceAccessTokens.accessTokenFor(identity.accountId),
    });
    if (!this.isCurrent(transition)) {
      await runtime.dispose();
      throw new RuntimeActivationSupersededError();
    }
    this.setState({ status: "authenticated", identity, runtime });
  }

  private async handleFailure(cause: unknown, transition: AbortController, restoring: boolean): Promise<void> {
    if (!this.isCurrent(transition) || cause instanceof RuntimeActivationSupersededError) return;
    const error = asOnlineAuthError(cause);
    // Authentication failures often originate while constructing the native
    // account runtime (SQLite, secure storage, or the initial cloud rebuild).
    // Keep this diagnostic free of credentials while preserving the concrete
    // native error needed to diagnose release-only startup failures.
    console.error("maxpower_online_auth_failure", {
      code: error.code,
      message: error.message,
      restoring,
    });
    if (error.code === "request_aborted") return;
    await this.runtimes.stop();
    this.serviceAccessTokens.clear();
    if (error.code === "network_unavailable") {
      this.setIfCurrent(transition, { status: "offline", error });
      return;
    }
    if (error.code === "not_authenticated" || error.code === "account_mismatch") {
      await this.sessionVault.clear();
      this.setIfCurrent(transition, { status: "signed_out", error });
      return;
    }
    this.setIfCurrent(transition, restoring
      ? { status: "error", error }
      : { status: "signed_out", error });
  }

  private async clearAuthentication(): Promise<void> {
    await this.runtimes.stop();
    this.serviceAccessTokens.clear();
    await this.sessionVault.clear();
  }

  private beginTransition(nextStatus: "checking" | "authenticating" | undefined): AbortController {
    this.transitionGeneration += 1;
    this.transition?.abort();
    const transition = new AbortController();
    this.transition = transition;
    if (nextStatus) this.setState({ status: nextStatus });
    return transition;
  }

  private isCurrent(transition: AbortController): boolean {
    return this.transition === transition && !transition.signal.aborted;
  }

  private setIfCurrent(transition: AbortController, state: OnlineAuthState<TRuntime>): void {
    if (this.isCurrent(transition)) this.setState(state);
  }

  private setState(state: OnlineAuthState<TRuntime>): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function asOnlineAuthError(cause: unknown): OnlineAuthError {
  if (cause instanceof OnlineAuthError) return cause;
  if (cause instanceof Error && cause.name === "AbortError") return new OnlineAuthError("request_aborted");
  if (cause instanceof TypeError) return new OnlineAuthError("network_unavailable", "Cannot reach MaxPower service.");
  return new OnlineAuthError("request_failed", cause instanceof Error ? cause.message : "Authentication failed.");
}

function tokenNeedsRefresh(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry - now <= 60_000;
}

function requiredDeletionReceipt(deletion: AccountDeletionProgress): string {
  const receipt = deletion.deletionReceipt?.trim();
  if (!receipt) throw new OnlineAuthError("invalid_response", "Deletion response did not include a receipt.");
  return receipt;
}
