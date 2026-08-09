import { projectDomainEvents } from "../coach/domain";
import type { CoachLedger } from "../coach/ledger";
import {
  remoteLlmCredentialKey,
  validateRemoteLlmProviderConfiguration,
} from "../coach/adapters/configuredProvider";
import type { MediaBlobStore, SecureCredentialPort } from "../privacy";
import type {
  NutritionObservationPort,
  NutritionObservationProviderResolver,
  NutritionObservationRequest,
} from "./NutritionStrategyEngine";
import { OpenAICompatibleNutritionTransport, type OpenAICompatibleNutritionFetch } from "./OpenAICompatibleNutritionTransport";
import {
  NutritionObservationError,
  RemoteNutritionObservationProvider,
} from "./RemoteNutritionObservationProvider";

/**
 * Resolves an optional meal-estimation provider for one request at a time.
 * Endpoint/model selection remains device-local, credentials stay in secure
 * storage, and a missing grant is never turned into a network request.
 */
export class ConfiguredRemoteNutritionObservationProvider implements NutritionObservationProviderResolver {
  constructor(private readonly options: {
    ledger: CoachLedger;
    credentials: SecureCredentialPort;
    media: MediaBlobStore;
    fetch?: OpenAICompatibleNutritionFetch;
  }) {}

  async resolve(input: { userId: string; request: NutritionObservationRequest }): Promise<NutritionObservationPort | undefined> {
    const userId = input.userId;
    const snapshot = await this.options.ledger.read();
    const permissions = projectDomainEvents(snapshot.domainEvents, { userId }).permissions?.value;
    const configuration = permissions?.remoteLlm === "granted"
      ? snapshot.localRemoteLlmProviderSettings.find((item) => item.userId === userId)?.provider
      : undefined;
    if (!configuration) return undefined;
    if (input.request.localMediaRefs?.length && permissions?.mediaUpload !== "granted") {
      // The request's one-shot photo consent is necessary but not sufficient:
      // users also keep a separately revocable media-upload permission.
      throw new NutritionObservationError("media_consent_required");
    }
    const canonical = validateRemoteLlmProviderConfiguration(configuration);
    const credentialKey = remoteLlmCredentialKey(userId, canonical.credentialRef);
    const credential = await this.options.credentials.get({ key: credentialKey, requireUserPresence: false });
    if (credential.status !== "available") return undefined;

    return new RemoteNutritionObservationProvider({
      userId,
      providerId: "openai-compatible",
      modelVersion: canonical.model,
      credential: this.options.credentials,
      credentialKey: { accountId: credentialKey.accountId, name: credentialKey.name },
      media: this.options.media,
      transport: new OpenAICompatibleNutritionTransport({
        endpoint: canonical.endpoint,
        model: canonical.model,
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      }),
    });
  }
}
