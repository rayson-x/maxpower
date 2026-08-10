import { createHash } from "node:crypto";

import type {
  GrantEntitlementInput,
  GrantEntitlementResult,
} from "../../adapters/entitlements/postgres-entitlements.js";
import { hasScope, type Principal } from "../../kernel/principal.js";
import type {
  InvokeLlmInput,
  CancelLlmInput,
  CancelLlmResult,
  LlmEntitlementView,
  LlmGatewayModule,
  LlmResult,
  OpenAiObject,
  ResumeLlmInput,
} from "../../modules/llm/model.js";

export interface EntitlementGrantWriter {
  grant(input: GrantEntitlementInput): Promise<GrantEntitlementResult>;
}

export interface MonthlyFreeGrantLlmGatewayOptions {
  gateway: LlmGatewayModule;
  grants: EntitlementGrantWriter;
  monthlyCredits: number;
  now?: () => Date;
}

/** Ensures every valid account has the current UTC month's idempotent free grant. */
export class MonthlyFreeGrantLlmGateway implements LlmGatewayModule {
  readonly #gateway: LlmGatewayModule;
  readonly #grants: EntitlementGrantWriter;
  readonly #monthlyCredits: number;
  readonly #now: () => Date;

  constructor(options: MonthlyFreeGrantLlmGatewayOptions) {
    if (!Number.isSafeInteger(options.monthlyCredits) || options.monthlyCredits < 1) {
      throw new Error("Monthly free credits must be a positive integer.");
    }
    this.#gateway = options.gateway;
    this.#grants = options.grants;
    this.#monthlyCredits = options.monthlyCredits;
    this.#now = options.now ?? (() => new Date());
  }

  async invoke(principal: Principal | undefined, input: InvokeLlmInput): Promise<LlmResult> {
    await this.#grantForAuthorizedPrincipal(principal);
    return this.#gateway.invoke(principal, input);
  }

  resume(
    principal: Principal | undefined,
    input: ResumeLlmInput,
  ): Promise<AsyncIterable<OpenAiObject>> {
    return this.#gateway.resume(principal, input);
  }

  async getEntitlement(principal: Principal | undefined): Promise<LlmEntitlementView> {
    await this.#grantForAuthorizedPrincipal(principal);
    return this.#gateway.getEntitlement(principal);
  }

  cancel(principal: Principal | undefined, input: CancelLlmInput): Promise<CancelLlmResult> {
    return this.#gateway.cancel(principal, input);
  }

  cancelAccount(accountId: string): Promise<number> | number {
    return this.#gateway.cancelAccount?.(accountId) ?? 0;
  }

  async #grantForAuthorizedPrincipal(principal: Principal | undefined): Promise<void> {
    if (
      principal === undefined ||
      principal.status !== "active" ||
      !hasScope(principal, "llm:invoke")
    ) return;
    const now = this.#now();
    const month = utcMonth(now);
    await this.#grants.grant({
      grantId: grantId(principal.accountId, `monthly-free:${month}`),
      accountId: principal.accountId,
      kind: "free_monthly",
      credits: this.#monthlyCredits,
      resetAt: nextUtcMonth(now).toISOString(),
      sourceRef: `monthly-free:${month}`,
      createdAt: now.toISOString(),
    });
  }
}

export interface AdministrativeGrantOptions {
  grants: EntitlementGrantWriter;
  accountId: string;
  credits: number;
  sourceRef: string;
  now?: Date;
}

export function grantAdministrativeCredits(
  options: AdministrativeGrantOptions,
): Promise<GrantEntitlementResult> {
  const accountId = required(options.accountId, "accountId");
  const source = required(options.sourceRef, "sourceRef");
  if (source.length > 160 || !/^[a-zA-Z0-9_.:@/-]+$/.test(source)) {
    throw new Error("sourceRef must be a short operational reference without spaces.");
  }
  if (!Number.isSafeInteger(options.credits) || options.credits < 1) {
    throw new Error("credits must be a positive integer.");
  }
  const createdAt = (options.now ?? new Date()).toISOString();
  const sourceRef = `admin:${source}`;
  return options.grants.grant({
    grantId: grantId(accountId, sourceRef),
    accountId,
    kind: "admin",
    credits: options.credits,
    resetAt: null,
    sourceRef,
    createdAt,
  });
}

function utcMonth(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function nextUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 1));
}

function grantId(accountId: string, sourceRef: string): string {
  const digest = createHash("sha256")
    .update(accountId)
    .update("\0")
    .update(sourceRef)
    .digest("hex")
    .slice(0, 32);
  return `llmgrant_${digest}`;
}

function required(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}
