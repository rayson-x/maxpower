import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { parseSetCookieHeader, splitSetCookieHeader } from "better-auth/cookies";

import { ApiError } from "../../kernel/api-error.js";
import { SystemClock, type Clock } from "../../kernel/clock.js";
import type {
  ExchangeSocialAuthInput,
  SocialAuthFlow,
  SocialAuthProvider,
  StartSocialAuthInput,
} from "../../modules/identity/model.js";

const SOCIAL_START_TTL_MS = 10 * 60_000;
const SOCIAL_HANDOFF_TTL_MS = 2 * 60_000;
const SOCIAL_EXCHANGE_TTL_MS = 2 * 60_000;

export interface BetterAuthSocialBridge {
  start(input: {
    provider: SocialAuthProvider;
    callbackUrl: string;
    errorCallbackUrl: string;
  }): Promise<{ authorizationUrl: string; stateCookie: string }>;
  handle(request: Request, stateCookie?: string): Promise<Response>;
  sessionTokenFromCallback(response: Response): Promise<string | null>;
}

export interface BetterAuthSocialServer {
  readonly api: {
    signInSocial(input: {
      body: {
        provider: SocialAuthProvider;
        callbackURL: string;
        errorCallbackURL: string;
        disableRedirect: true;
      };
      returnHeaders: true;
    }): Promise<{
      response: { url?: unknown };
      headers?: Headers;
    }>;
    getSession(input: {
      headers: Headers;
      query?: { disableCookieCache?: boolean; disableRefresh?: boolean };
    }): Promise<unknown>;
  };
  handler(request: Request): Promise<Response>;
}

/** Narrow wrapper around the pinned Better Auth server API. */
export class BetterAuthSocialBridgeAdapter implements BetterAuthSocialBridge {
  readonly #server: BetterAuthSocialServer;

  constructor(server: BetterAuthSocialServer) {
    this.#server = server;
  }

  async start(input: {
    provider: SocialAuthProvider;
    callbackUrl: string;
    errorCallbackUrl: string;
  }): Promise<{ authorizationUrl: string; stateCookie: string }> {
    const result = await this.#server.api.signInSocial({
      body: {
        provider: input.provider,
        callbackURL: input.callbackUrl,
        errorCallbackURL: input.errorCallbackUrl,
        disableRedirect: true,
      },
      returnHeaders: true,
    });
    if (typeof result.response.url !== "string" || !result.headers) throw invalidSocialFlow();
    const stateCookies = setCookieEntries(result.headers).filter((entry) =>
      /^(?:__Secure-)?better-auth[.-]state=/i.test(entry),
    );
    if (stateCookies.length !== 1) throw invalidSocialFlow();
    return {
      authorizationUrl: result.response.url,
      stateCookie: stateCookies[0] as string,
    };
  }

  handle(request: Request, stateCookie?: string): Promise<Response> {
    if (!stateCookie) return this.#server.handler(request);
    const headers = new Headers(request.headers);
    // A V1 callback is intentionally detached from any pre-existing browser
    // session. Better Auth receives only the state cookie generated at start.
    headers.set("cookie", requestCookieFromSetCookie(stateCookie));
    return this.#server.handler(new Request(request, { headers }));
  }

  async sessionTokenFromCallback(response: Response): Promise<string | null> {
    const cookies: string[] = [];
    for (const entry of setCookieEntries(response.headers)) {
      for (const [name, attributes] of parseSetCookieHeader(entry)) {
        cookies.push(`${name}=${attributes.value}`);
      }
    }
    if (cookies.length === 0) return null;
    return this.#sessionTokenFromHeaders(new Headers({ cookie: cookies.join("; ") }));
  }

  async #sessionTokenFromHeaders(headers: Headers): Promise<string | null> {
    const result = await this.#server.api.getSession({
      headers,
      query: { disableCookieCache: true, disableRefresh: true },
    });
    if (!result || typeof result !== "object") return null;
    const session = (result as { session?: unknown }).session;
    if (!session || typeof session !== "object") return null;
    const token = (session as { token?: unknown }).token;
    return typeof token === "string" && token.length > 0 ? token : null;
  }
}

export interface SocialAuthStartRecord {
  oauthStateDigest: string;
  handoffIdDigest: string;
  provider: SocialAuthProvider;
  callbackUrl: string;
  deviceBindingDigest: string;
  exchangeState: string;
  providerAuthorizationUrl: string;
  stateCookie: string;
  handoffUrl: string;
  errorCallbackUrl: string;
  expiresAt: string;
}

export interface SocialAuthExchangeRecord {
  codeDigest: string;
  provider: SocialAuthProvider;
  callbackUrl: string;
  deviceBindingDigest: string;
  exchangeStateDigest: string;
  sessionToken: string;
  expiresAt: string;
}

export interface SocialAuthHandoffRecord {
  handoffIdDigest: string;
  provider: SocialAuthProvider;
  callbackUrl: string;
  deviceBindingDigest: string;
  exchangeState: string;
  sessionToken: string;
  expiresAt: string;
}

export interface SocialAuthStateStore {
  saveStart(record: SocialAuthStartRecord): Promise<void>;
  findStart(oauthStateDigest: string): Promise<SocialAuthStartRecord | null>;
  consumeStart(oauthStateDigest: string): Promise<SocialAuthStartRecord | null>;
  findStartByHandoff(handoffIdDigest: string): Promise<SocialAuthStartRecord | null>;
  consumeStartByHandoff(handoffIdDigest: string): Promise<SocialAuthStartRecord | null>;
  saveHandoff(record: SocialAuthHandoffRecord): Promise<void>;
  consumeHandoff(handoffIdDigest: string): Promise<SocialAuthHandoffRecord | null>;
  saveExchange(record: SocialAuthExchangeRecord): Promise<void>;
  findExchange(codeDigest: string): Promise<SocialAuthExchangeRecord | null>;
  consumeExchange(codeDigest: string): Promise<SocialAuthExchangeRecord | null>;
}

interface VerificationValue {
  value: string;
}

export interface BetterAuthVerificationServer {
  readonly $context: Promise<{
    internalAdapter: {
      reserveVerificationValue(input: {
        identifier: string;
        value: string;
        expiresAt: Date;
      }): Promise<unknown>;
      findVerificationValue(identifier: string): Promise<VerificationValue | null>;
      consumeVerificationValue(identifier: string): Promise<VerificationValue | null>;
    };
  }>;
}

/** Cluster-safe social tickets backed by Better Auth's PostgreSQL verification table. */
export class BetterAuthVerificationSocialAuthStateStore implements SocialAuthStateStore {
  readonly #server: BetterAuthVerificationServer;

  constructor(server: BetterAuthVerificationServer) {
    this.#server = server;
  }

  async saveStart(record: SocialAuthStartRecord): Promise<void> {
    await this.#reserve(startKey(record.oauthStateDigest), record, record.expiresAt);
    try {
      await this.#reserve(handoffKey(record.handoffIdDigest), record, record.expiresAt);
    } catch (error) {
      const context = await this.#server.$context;
      await context.internalAdapter.consumeVerificationValue(startKey(record.oauthStateDigest));
      throw error;
    }
  }

  async findStart(oauthStateDigest: string): Promise<SocialAuthStartRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.findVerificationValue(
      startKey(oauthStateDigest),
    );
    return value ? parseStartRecord(value.value) : null;
  }

  async consumeStart(oauthStateDigest: string): Promise<SocialAuthStartRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.consumeVerificationValue(
      startKey(oauthStateDigest),
    );
    const record = value ? parseStartRecord(value.value) : null;
    if (record) {
      await context.internalAdapter.consumeVerificationValue(handoffKey(record.handoffIdDigest));
    }
    return record;
  }

  async findStartByHandoff(handoffIdDigest: string): Promise<SocialAuthStartRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.findVerificationValue(
      handoffKey(handoffIdDigest),
    );
    return value ? parseStartRecord(value.value) : null;
  }

  async consumeStartByHandoff(handoffIdDigest: string): Promise<SocialAuthStartRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.consumeVerificationValue(
      handoffKey(handoffIdDigest),
    );
    const record = value ? parseStartRecord(value.value) : null;
    if (record) {
      await context.internalAdapter.consumeVerificationValue(startKey(record.oauthStateDigest));
    }
    return record;
  }

  async saveExchange(record: SocialAuthExchangeRecord): Promise<void> {
    await this.#reserve(exchangeKey(record.codeDigest), record, record.expiresAt);
  }

  async saveHandoff(record: SocialAuthHandoffRecord): Promise<void> {
    await this.#reserve(authorizedHandoffKey(record.handoffIdDigest), record, record.expiresAt);
  }

  async consumeHandoff(handoffIdDigest: string): Promise<SocialAuthHandoffRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.consumeVerificationValue(
      authorizedHandoffKey(handoffIdDigest),
    );
    return value ? parseHandoffRecord(value.value) : null;
  }

  async findExchange(codeDigest: string): Promise<SocialAuthExchangeRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.findVerificationValue(exchangeKey(codeDigest));
    return value ? parseExchangeRecord(value.value) : null;
  }

  async consumeExchange(codeDigest: string): Promise<SocialAuthExchangeRecord | null> {
    const context = await this.#server.$context;
    const value = await context.internalAdapter.consumeVerificationValue(exchangeKey(codeDigest));
    return value ? parseExchangeRecord(value.value) : null;
  }

  async #reserve(
    identifier: string,
    record: SocialAuthStartRecord | SocialAuthHandoffRecord | SocialAuthExchangeRecord,
    expiresAt: string,
  ): Promise<void> {
    const context = await this.#server.$context;
    const reserved = await context.internalAdapter.reserveVerificationValue({
      identifier,
      value: JSON.stringify(record),
      expiresAt: new Date(expiresAt),
    });
    if (!reserved) throw new Error("A social authentication ticket collision occurred.");
  }
}

export interface BetterAuthSocialAuthFlowOptions {
  bridge: BetterAuthSocialBridge;
  store: SocialAuthStateStore;
  baseUrl: string;
  allowedCallbackUrls: readonly string[];
  clock?: Clock;
  randomToken?: () => string;
}

/**
 * Device-bound OAuth handoff. Provider callbacks create a short-lived opaque
 * exchange code; neither a Better Auth cookie nor its session token enters a
 * custom-scheme URL.
 */
export class BetterAuthSocialAuthFlow implements SocialAuthFlow {
  readonly #bridge: BetterAuthSocialBridge;
  readonly #store: SocialAuthStateStore;
  readonly #baseUrl: string;
  readonly #allowedCallbackUrls: ReadonlySet<string>;
  readonly #clock: Clock;
  readonly #randomToken: () => string;

  constructor(options: BetterAuthSocialAuthFlowOptions) {
    const baseUrl = new URL(options.baseUrl);
    if (baseUrl.protocol !== "https:" || baseUrl.origin !== options.baseUrl) {
      throw new Error("The social authentication baseUrl must be an exact HTTPS origin.");
    }
    if (options.allowedCallbackUrls.length === 0) {
      throw new Error("At least one exact social callback URL is required.");
    }
    for (const callbackUrl of options.allowedCallbackUrls) validateCallbackUrl(callbackUrl);
    this.#bridge = options.bridge;
    this.#store = options.store;
    this.#baseUrl = baseUrl.origin;
    this.#allowedCallbackUrls = new Set(options.allowedCallbackUrls);
    this.#clock = options.clock ?? new SystemClock();
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async start(input: StartSocialAuthInput): Promise<{
    authorizationUrl: string;
    exchangeState: string;
  }> {
    this.#assertAllowedCallback(input.callbackUrl);
    const handoffId = this.#randomToken();
    const exchangeState = this.#randomToken();
    const handoffUrl = this.#internalUrl("/v1/auth/social/handoff", handoffId);
    const errorCallbackUrl = this.#internalUrl("/v1/auth/social/error", handoffId);
    const started = await this.#bridge.start({
      provider: input.provider,
      callbackUrl: handoffUrl,
      errorCallbackUrl,
    });
    const providerAuthorizationUrl = secureAuthorizationUrl(started.authorizationUrl);
    const oauthState = requiredOAuthState(providerAuthorizationUrl);
    const stateCookie = safeStateCookie(started.stateCookie);
    const oauthStateDigest = digest(oauthState);
    await this.#store.saveStart({
      oauthStateDigest,
      handoffIdDigest: digest(handoffId),
      provider: input.provider,
      callbackUrl: input.callbackUrl,
      deviceBindingDigest: digest(input.deviceBinding),
      exchangeState,
      providerAuthorizationUrl: providerAuthorizationUrl.toString(),
      stateCookie,
      handoffUrl,
      errorCallbackUrl,
      expiresAt: new Date(this.#clock.now().getTime() + SOCIAL_START_TTL_MS).toISOString(),
    });
    const authorizationUrl = new URL("/api/auth/social/authorize", this.#baseUrl);
    authorizationUrl.searchParams.set("state", oauthState);
    return {
      authorizationUrl: authorizationUrl.toString(),
      exchangeState,
    };
  }

  async authorize(oauthState: string): Promise<Response> {
    const record = await this.#store.findStart(digest(oauthState));
    if (!record) throw invalidSocialFlow();
    if (this.#clock.now().getTime() >= Date.parse(record.expiresAt)) {
      await this.#store.consumeStart(record.oauthStateDigest);
      throw new ApiError(410, "social_auth_expired", "The social sign-in request has expired.");
    }
    return new Response(null, {
      status: 302,
      headers: { location: record.providerAuthorizationUrl },
    });
  }

  async handleProviderCallback(
    request: Request,
    provider: SocialAuthProvider,
  ): Promise<Response> {
    const oauthState = await oauthStateFromCallback(request);
    if (!oauthState) return this.#bridge.handle(request);
    const oauthStateDigest = digest(oauthState);
    const record = await this.#store.findStart(oauthStateDigest);
    // A callback without a MaxPower V1 start record may belong to the reviewed
    // explicit account-linking flow; Better Auth remains its authority.
    if (!record) return this.#bridge.handle(request);
    if (record.provider !== provider) {
      throw new ApiError(
        400,
        "invalid_social_callback",
        "The social sign-in callback is invalid.",
      );
    }
    if (this.#clock.now().getTime() >= Date.parse(record.expiresAt)) {
      await this.#store.consumeStart(oauthStateDigest);
      throw new ApiError(410, "social_auth_expired", "The social sign-in request has expired.");
    }

    let callbackResponse: Response;
    try {
      callbackResponse = await this.#bridge.handle(request, record.stateCookie);
    } catch {
      return privateRedirect(record.errorCallbackUrl);
    }
    const location = callbackResponse.headers.get("location");
    if (
      callbackResponse.status < 300 ||
      callbackResponse.status >= 400 ||
      location !== record.handoffUrl
    ) {
      return privateRedirect(record.errorCallbackUrl);
    }
    const sessionToken = await this.#bridge.sessionTokenFromCallback(callbackResponse);
    if (!sessionToken) {
      throw new ApiError(401, "social_callback_failed", "Social sign-in failed.");
    }
    const consumed = await this.#store.consumeStart(oauthStateDigest);
    if (!consumed) {
      throw new ApiError(409, "social_callback_used", "The social sign-in callback was already used.");
    }
    await this.#store.saveHandoff({
      handoffIdDigest: consumed.handoffIdDigest,
      provider: consumed.provider,
      callbackUrl: consumed.callbackUrl,
      deviceBindingDigest: consumed.deviceBindingDigest,
      exchangeState: consumed.exchangeState,
      sessionToken,
      expiresAt: new Date(Math.min(
        Date.parse(consumed.expiresAt),
        this.#clock.now().getTime() + SOCIAL_HANDOFF_TTL_MS,
      )).toISOString(),
    });
    // Do not forward Better Auth's Set-Cookie header. The session credential
    // remains in server-side state until the device-bound exchange succeeds.
    return privateRedirect(consumed.handoffUrl);
  }

  async handleBrowserHandoff(request: Request): Promise<Response> {
    const flowId = exactFlowQuery(request);
    const handoffIdDigest = digest(flowId);
    const record = await this.#store.consumeHandoff(handoffIdDigest);
    if (!record) throw new ApiError(409, "social_handoff_used", "The social handoff is invalid or was already used.");
    if (this.#clock.now().getTime() >= Date.parse(record.expiresAt)) {
      throw new ApiError(410, "social_auth_expired", "The social sign-in request has expired.");
    }
    const code = this.#randomToken();
    await this.#store.saveExchange({
      codeDigest: digest(code),
      provider: record.provider,
      callbackUrl: record.callbackUrl,
      deviceBindingDigest: record.deviceBindingDigest,
      exchangeStateDigest: digest(record.exchangeState),
      sessionToken: record.sessionToken,
      expiresAt: new Date(this.#clock.now().getTime() + SOCIAL_EXCHANGE_TTL_MS).toISOString(),
    });
    const redirect = new URL(record.callbackUrl);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", record.exchangeState);
    return new Response(null, { status: 302, headers: { location: redirect.toString() } });
  }

  async handleBrowserError(request: Request): Promise<Response> {
    const handoffIdDigest = digest(exactFlowQuery(request));
    const pending = await this.#store.consumeStartByHandoff(handoffIdDigest);
    const authorized = pending ? null : await this.#store.consumeHandoff(handoffIdDigest);
    const record = pending ?? authorized;
    if (!record) {
      throw new ApiError(
        409,
        "social_handoff_used",
        "The social handoff is invalid or was already used.",
      );
    }
    const redirect = new URL(record.callbackUrl);
    redirect.searchParams.set("error", "social_callback_failed");
    redirect.searchParams.set("state", record.exchangeState);
    return privateRedirect(redirect.toString());
  }

  async exchange(input: ExchangeSocialAuthInput): Promise<{ sessionToken: string }> {
    const codeDigest = digest(input.code);
    const record = await this.#store.findExchange(codeDigest);
    if (!record) throw socialExchangeUsed();
    if (this.#clock.now().getTime() >= Date.parse(record.expiresAt)) {
      await this.#store.consumeExchange(codeDigest);
      throw new ApiError(410, "social_exchange_expired", "The social exchange code has expired.");
    }
    if (
      input.callbackUrl !== record.callbackUrl ||
      !digestEqual(digest(input.state), record.exchangeStateDigest) ||
      !digestEqual(digest(input.deviceBinding), record.deviceBindingDigest)
    ) {
      throw new ApiError(
        401,
        "invalid_social_exchange",
        "The social exchange proof is invalid.",
      );
    }
    const consumed = await this.#store.consumeExchange(codeDigest);
    if (!consumed) throw socialExchangeUsed();
    return { sessionToken: consumed.sessionToken };
  }

  #assertAllowedCallback(callbackUrl: string): void {
    if (!this.#allowedCallbackUrls.has(callbackUrl)) {
      throw new ApiError(
        400,
        "social_callback_not_allowed",
        "The social sign-in callback is not allowed.",
      );
    }
  }

  #internalUrl(path: string, flow: string): string {
    const url = new URL(path, this.#baseUrl);
    url.searchParams.set("flow", flow);
    return url.toString();
  }
}

function secureAuthorizationUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidSocialFlow();
  }
  if (url.protocol !== "https:") throw invalidSocialFlow();
  return url;
}

function setCookieEntries(headers: Headers): string[] {
  const native = headers.getSetCookie();
  if (native.length > 0) return native;
  return splitSetCookieHeader(headers.get("set-cookie") ?? "");
}

function startKey(digestValue: string): string {
  return `maxpower:social:start:${requiredDigest(digestValue)}`;
}

function exchangeKey(digestValue: string): string {
  return `maxpower:social:exchange:${requiredDigest(digestValue)}`;
}

function handoffKey(digestValue: string): string {
  return `maxpower:social:handoff:${requiredDigest(digestValue)}`;
}

function authorizedHandoffKey(digestValue: string): string {
  return `maxpower:social:authorized-handoff:${requiredDigest(digestValue)}`;
}

function requiredDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("A SHA-256 digest is required.");
  return value.toLowerCase();
}

function parseStartRecord(value: string): SocialAuthStartRecord | null {
  const record = parseRecord(value);
  if (
    !record ||
    !isDigest(record.oauthStateDigest) ||
    !isDigest(record.handoffIdDigest) ||
    !isProvider(record.provider) ||
    typeof record.callbackUrl !== "string" ||
    !isDigest(record.deviceBindingDigest) ||
    typeof record.exchangeState !== "string" ||
    typeof record.providerAuthorizationUrl !== "string" ||
    typeof record.stateCookie !== "string" ||
    typeof record.handoffUrl !== "string" ||
    typeof record.errorCallbackUrl !== "string" ||
    !isDateString(record.expiresAt)
  ) return null;
  return {
    oauthStateDigest: record.oauthStateDigest,
    handoffIdDigest: record.handoffIdDigest,
    provider: record.provider,
    callbackUrl: record.callbackUrl,
    deviceBindingDigest: record.deviceBindingDigest,
    exchangeState: record.exchangeState,
    providerAuthorizationUrl: record.providerAuthorizationUrl,
    stateCookie: record.stateCookie,
    handoffUrl: record.handoffUrl,
    errorCallbackUrl: record.errorCallbackUrl,
    expiresAt: record.expiresAt,
  };
}

function parseExchangeRecord(value: string): SocialAuthExchangeRecord | null {
  const record = parseRecord(value);
  if (
    !record ||
    !isDigest(record.codeDigest) ||
    !isProvider(record.provider) ||
    typeof record.callbackUrl !== "string" ||
    !isDigest(record.deviceBindingDigest) ||
    !isDigest(record.exchangeStateDigest) ||
    typeof record.sessionToken !== "string" ||
    record.sessionToken.length === 0 ||
    !isDateString(record.expiresAt)
  ) return null;
  return {
    codeDigest: record.codeDigest,
    provider: record.provider,
    callbackUrl: record.callbackUrl,
    deviceBindingDigest: record.deviceBindingDigest,
    exchangeStateDigest: record.exchangeStateDigest,
    sessionToken: record.sessionToken,
    expiresAt: record.expiresAt,
  };
}

function parseHandoffRecord(value: string): SocialAuthHandoffRecord | null {
  const record = parseRecord(value);
  if (
    !record ||
    !isDigest(record.handoffIdDigest) ||
    !isProvider(record.provider) ||
    typeof record.callbackUrl !== "string" ||
    !isDigest(record.deviceBindingDigest) ||
    typeof record.exchangeState !== "string" ||
    typeof record.sessionToken !== "string" ||
    record.sessionToken.length === 0 ||
    !isDateString(record.expiresAt)
  ) return null;
  return {
    handoffIdDigest: record.handoffIdDigest,
    provider: record.provider,
    callbackUrl: record.callbackUrl,
    deviceBindingDigest: record.deviceBindingDigest,
    exchangeState: record.exchangeState,
    sessionToken: record.sessionToken,
    expiresAt: record.expiresAt,
  };
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isProvider(value: unknown): value is SocialAuthProvider {
  return value === "google" || value === "apple";
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateCallbackUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Social callback URLs must be exact native URLs.");
  }
  if (
    url.protocol === "http:" ||
    url.protocol === "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.toString() !== value
  ) {
    throw new Error("Social callback URLs must be exact native URLs without query or fragment.");
  }
}

async function oauthStateFromCallback(request: Request): Promise<string | null> {
  const url = new URL(request.url);
  const queryState = url.searchParams.get("state");
  if (queryState) return validOAuthState(queryState);
  if (request.method !== "POST") return null;
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/x-www-form-urlencoded")) {
      return validOAuthState(new URLSearchParams(await request.clone().text()).get("state"));
    }
    if (contentType.includes("application/json")) {
      const body: unknown = await request.clone().json();
      return validOAuthState(
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as { state?: unknown }).state
          : null,
      );
    }
  } catch {
    return null;
  }
  return null;
}

function validOAuthState(value: unknown): string | null {
  return typeof value === "string" && value.length >= 16 && value.length <= 512
    ? value
    : null;
}

function exactFlowQuery(request: Request): string {
  const url = new URL(request.url);
  const keys = [...url.searchParams.keys()];
  const flow = url.searchParams.get("flow");
  if (
    keys.length !== 1 ||
    keys[0] !== "flow" ||
    !flow ||
    flow.length < 16 ||
    flow.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(flow)
  ) throw invalidSocialFlow();
  return flow;
}

function requiredOAuthState(url: URL): string {
  const state = url.searchParams.get("state");
  if (!state || state.length < 16 || state.length > 512) throw invalidSocialFlow();
  return state;
}

function safeStateCookie(value: string): string {
  if (
    !value ||
    /[\r\n]/.test(value) ||
    /(?:^|[;\s])(?:__Secure-)?better-auth[.-]session_token=/i.test(value)
  ) throw invalidSocialFlow();
  requestCookieFromSetCookie(value);
  return value;
}

function requestCookieFromSetCookie(value: string): string {
  const stateCookies: string[] = [];
  for (const [name, attributes] of parseSetCookieHeader(value)) {
    if (/^(?:__Secure-)?better-auth[.-]state$/i.test(name)) {
      stateCookies.push(`${name}=${attributes.value}`);
    }
  }
  if (stateCookies.length !== 1) throw invalidSocialFlow();
  return stateCookies[0] as string;
}

function privateRedirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digestEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function invalidSocialFlow(): ApiError {
  return new ApiError(400, "invalid_social_flow", "The social sign-in request is invalid.");
}

function socialExchangeUsed(): ApiError {
  return new ApiError(
    409,
    "social_exchange_used",
    "The social exchange code is invalid or has already been used.",
  );
}

export const SOCIAL_AUTH_EXCHANGE_TTL_MS = SOCIAL_EXCHANGE_TTL_MS;
