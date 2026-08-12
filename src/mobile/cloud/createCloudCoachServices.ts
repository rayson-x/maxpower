import { projectDomainEvents } from "../../coach/domain";
import type { CoachLedger } from "../../coach/ledger";
import type { MediaBlobStore } from "../../privacy";
import type { OpenAICompatibleNutritionFetch } from "../../nutrition/OpenAICompatibleNutritionTransport";

import { CloudNutritionObservationProviderResolver } from "./CloudNutritionObservationProvider";
import {
  type CloudServiceAccessTokenSource,
} from "./MaxPowerCloudLlmProvider";
import { MaxPowerPiCoachProviderResolver } from "./MaxPowerPiCoachProvider";
import type { MaxPowerPiFetch } from "./MaxPowerPiLlmProvider";

export interface CreateCloudCoachServicesInput {
  apiBaseUrl: string;
  allowInsecureHttp?: boolean;
  accountId: string;
  accessTokens: CloudServiceAccessTokenSource;
  accountSignal: AbortSignal;
  ledger: CoachLedger;
  media: MediaBlobStore;
  coachFetch?: MaxPowerPiFetch;
  nutritionFetch?: OpenAICompatibleNutritionFetch;
}

/** Creates both language surfaces from the same account/token/consent boundary. */
export function createCloudCoachServices(input: CreateCloudCoachServicesInput) {
  const readPermissions = async () => {
    const snapshot = await input.ledger.read();
    const value = projectDomainEvents(snapshot.domainEvents, { userId: input.accountId }).permissions?.value;
    return {
      mediaUpload: value?.mediaUpload === "granted" ? "granted" as const : "denied" as const,
    };
  };
  return {
    llmProviderResolver: new MaxPowerPiCoachProviderResolver({
      apiBaseUrl: input.apiBaseUrl,
      ...(input.allowInsecureHttp === undefined ? {} : { allowInsecureHttp: input.allowInsecureHttp }),
      accountId: input.accountId,
      accessTokens: input.accessTokens,
      accountSignal: input.accountSignal,
      ...(input.coachFetch ? { fetch: input.coachFetch } : {}),
    }),
    nutritionObservationResolver: new CloudNutritionObservationProviderResolver({
      apiBaseUrl: input.apiBaseUrl,
      ...(input.allowInsecureHttp === undefined ? {} : { allowInsecureHttp: input.allowInsecureHttp }),
      accountId: input.accountId,
      accessTokens: input.accessTokens,
      accountSignal: input.accountSignal,
      media: input.media,
      permission: readPermissions,
      ...(input.nutritionFetch ? { fetch: input.nutritionFetch } : {}),
    }),
  };
}
