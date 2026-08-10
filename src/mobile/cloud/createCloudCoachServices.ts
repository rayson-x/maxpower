import { projectDomainEvents } from "../../coach/domain";
import type { CoachLedger } from "../../coach/ledger";
import type { MediaBlobStore } from "../../privacy";
import type { OpenAICompatibleFetch } from "../../coach/adapters/provider";
import type { OpenAICompatibleNutritionFetch } from "../../nutrition/OpenAICompatibleNutritionTransport";

import { CloudNutritionObservationProviderResolver } from "./CloudNutritionObservationProvider";
import {
  MaxPowerCloudLlmProviderResolver,
  type CloudServiceAccessTokenSource,
} from "./MaxPowerCloudLlmProvider";

export interface CreateCloudCoachServicesInput {
  apiBaseUrl: string;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  accountSignal: AbortSignal;
  ledger: CoachLedger;
  media: MediaBlobStore;
  coachFetch?: OpenAICompatibleFetch;
  nutritionFetch?: OpenAICompatibleNutritionFetch;
}

/** Creates both language surfaces from the same account/token/consent boundary. */
export function createCloudCoachServices(input: CreateCloudCoachServicesInput) {
  const readPermissions = async () => {
    const snapshot = await input.ledger.read();
    const value = projectDomainEvents(snapshot.domainEvents, { userId: input.accountId }).permissions?.value;
    return {
      remoteLlm: value?.remoteLlm === "granted" ? "granted" as const : "denied" as const,
      mediaUpload: value?.mediaUpload === "granted" ? "granted" as const : "denied" as const,
    };
  };
  return {
    llmProviderResolver: new MaxPowerCloudLlmProviderResolver({
      apiBaseUrl: input.apiBaseUrl,
      accountId: input.accountId,
      accessTokens: input.accessTokens,
      accountSignal: input.accountSignal,
      permission: async () => (await readPermissions()).remoteLlm,
      ...(input.coachFetch ? { fetch: input.coachFetch } : {}),
    }),
    nutritionObservationResolver: new CloudNutritionObservationProviderResolver({
      apiBaseUrl: input.apiBaseUrl,
      accountId: input.accountId,
      accessTokens: input.accessTokens,
      accountSignal: input.accountSignal,
      media: input.media,
      permission: readPermissions,
      ...(input.nutritionFetch ? { fetch: input.nutritionFetch } : {}),
    }),
  };
}
