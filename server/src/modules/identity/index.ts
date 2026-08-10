export {
  InMemoryIdentityAdapter,
  LOCAL_SERVICE_TOKEN_TTL_MS,
  LOCAL_TEST_ONLY_DEBUG_OTP,
  OTP_CHALLENGE_TTL_MS,
} from "./in-memory-adapter.js";
export type { InMemoryIdentityAdapterOptions } from "./in-memory-adapter.js";
export { DEFAULT_IDENTITY_SCOPES } from "./model.js";
export type {
  AuthenticatedIdentity,
  CompleteRegistrationInput,
  CompleteSocialOnboardingInput,
  IdentityChannel,
  IdentityIdentifier,
  IdentityModule,
  OtpChallengeStarted,
  RegistrationOtpResult,
  RegistrationRequired,
} from "./model.js";
