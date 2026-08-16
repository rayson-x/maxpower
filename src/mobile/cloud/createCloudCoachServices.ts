import type { CloudServiceAccessTokenSource } from "./CloudServiceAccessTokenSource";
import { MaxPowerPiLlmProvider, type MaxPowerPiFetch } from "./MaxPowerPiLlmProvider";

export interface CreateCloudCoachServicesInput {
  apiBaseUrl: string;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  accountSignal: AbortSignal;
  coachFetch?: MaxPowerPiFetch;
}

/** Creates the language Provider. Nutrition remains explicit local form input. */
export function createCloudCoachServices(input: CreateCloudCoachServicesInput) {
  const pi = new MaxPowerPiLlmProvider({
    apiBaseUrl: input.apiBaseUrl,
    accountId: input.accountId,
    accessTokens: input.accessTokens,
    accountSignal: input.accountSignal,
    ...(input.coachFetch ? { fetch: input.coachFetch } : {}),
  });
  return {
    /** Direct Pi Agent Core source. This is the only client conversation runtime. */
    pi,
  };
}
