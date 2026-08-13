type JsonSchema = Record<string, unknown>;
type Parameter = Record<string, unknown>;
type SecurityMode = "public" | "bearer" | "better-auth" | "deletion-receipt" | "deletion-recovery";

const bearerSecurity = [{ bearerAuth: [] }];
const betterAuthSecurity = [{ betterAuthSession: [] }];
const deletionReceiptSecurity = [{ bearerAuth: [] }, { deletionReceipt: [] }];
const deletionRecoverySecurity = [{ bearerAuth: [] }, { deletionRecoveryKey: [] }];

const jsonContent = (schema: JsonSchema) => ({
  "application/json": { schema },
});

const idParameter = (name: string): Parameter => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", minLength: 1 },
});

const paginationParameters: readonly Parameter[] = [
  {
    name: "limit",
    in: "query",
    required: false,
    description: "Maximum page size. Defaults to 50.",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
  {
    name: "cursor",
    in: "query",
    required: false,
    description: "Opaque cursor returned as nextCursor by the previous page.",
    schema: { type: "string", minLength: 1 },
  },
];

const idempotencyHeader: Parameter = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description: "Stable client-generated key. Replays return the original command result.",
  schema: { type: "string", minLength: 1, maxLength: 200 },
};

const deletionIdempotencyHeader: Parameter = {
  name: "Idempotency-Key",
  in: "header",
  required: true,
  description:
    "Random 32-byte hexadecimal recovery capability. The same value may replay a deletion request after its session is revoked.",
  schema: { type: "string", pattern: "^[a-f0-9]{64}$" },
};

const ifMatchHeader: Parameter = {
  name: "If-Match",
  in: "header",
  required: true,
  description: "Expected resource revision, accepted as an integer or quoted ETag.",
  schema: { type: "string", minLength: 1 },
};

const clientRunHeader: Parameter = {
  name: "X-Client-Run-Id",
  in: "header",
  required: true,
  description: "Ephemeral client correlation identifier. It is not persisted as conversation data.",
  schema: { type: "string", minLength: 1, maxLength: 200 },
};

const deletionReceiptHeader: Parameter = {
  name: "Deletion-Receipt",
  in: "header",
  required: false,
  description: "Server-generated deletion receipt for status lookup after logout.",
  schema: { type: "string", minLength: 1, maxLength: 200 },
};

const lastEventIdHeader: Parameter = {
  name: "Last-Event-ID",
  in: "header",
  required: false,
  description: "Last one-based SSE sequence received. Zero or omission replays from the start.",
  schema: { type: "integer", minimum: 0 },
};

const etagResponseHeader = { ETag: { $ref: "#/components/headers/ETag" } };
const locationAndEtagResponseHeaders = {
  Location: { $ref: "#/components/headers/Location" },
  ETag: { $ref: "#/components/headers/ETag" },
};
const invocationResponseHeader = {
  "X-MaxPower-Invocation-Id": { $ref: "#/components/headers/InvocationId" },
};

interface OperationOptions {
  operationId: string;
  tag: "Operations" | "Identity" | "ProductData" | "MediaLibrary" | "LlmGateway";
  security?: SecurityMode;
  parameters?: readonly Parameter[];
  requestSchema?: JsonSchema;
  requestRequired?: boolean;
  successStatus?: string;
  successDescription?: string;
  successSchema?: JsonSchema;
  successContent?: Record<string, unknown>;
  successHeaders?: Record<string, unknown>;
  errorSchema?: "Error" | "BetterAuthError";
}

function operation(options: OperationOptions) {
  const successStatus = options.successStatus ?? "200";
  const success = {
    description: options.successDescription ?? "Success.",
    ...(options.successHeaders === undefined ? {} : { headers: options.successHeaders }),
    ...(options.successContent === undefined
      ? options.successSchema === undefined
        ? {}
        : { content: jsonContent(options.successSchema) }
      : { content: options.successContent }),
  };
  return {
    operationId: options.operationId,
    tags: [options.tag],
    ...securityFor(options.security ?? "public"),
    ...(options.parameters === undefined || options.parameters.length === 0
      ? {}
      : { parameters: options.parameters }),
    ...(options.requestSchema === undefined
      ? {}
      : {
          requestBody: {
            required: options.requestRequired ?? true,
            content: jsonContent(options.requestSchema),
          },
        }),
    responses: {
      [successStatus]: success,
      ...errorResponses(options.errorSchema ?? "Error"),
    },
  };
}

function securityFor(mode: SecurityMode) {
  if (mode === "bearer") return { security: bearerSecurity };
  if (mode === "better-auth") return { security: betterAuthSecurity };
  if (mode === "deletion-receipt") return { security: deletionReceiptSecurity };
  if (mode === "deletion-recovery") return { security: deletionRecoverySecurity };
  return {};
}

function errorResponses(schema: "Error" | "BetterAuthError") {
  return {
    default: {
      description: "The request failed. Status and code identify the failure class.",
      headers: { "Retry-After": { $ref: "#/components/headers/RetryAfter" } },
      content: jsonContent({ $ref: `#/components/schemas/${schema}` }),
    },
  };
}

function identityOperation(
  operationId: string,
  requestSchema: JsonSchema,
  successStatus = "200",
  successSchema: JsonSchema = { $ref: "#/components/schemas/AuthenticatedIdentity" },
) {
  return operation({
    operationId,
    tag: "Identity",
    requestSchema,
    successStatus,
    successSchema,
  });
}

function protectedOperation(options: Omit<OperationOptions, "security">) {
  return operation({ ...options, security: "bearer" });
}

function betterAuthOperation(options: Omit<OperationOptions, "security" | "errorSchema"> & {
  public?: boolean;
}) {
  const { public: isPublic, ...operationOptions } = options;
  return operation({
    ...operationOptions,
    security: isPublic === true ? "public" : "better-auth",
    errorSchema: "BetterAuthError",
  });
}

function paginatedOperation(operationId: string, itemSchema: string) {
  return protectedOperation({
    operationId,
    tag: itemSchema === "MediaAsset" ? "MediaLibrary" : "ProductData",
    parameters: paginationParameters,
    successSchema: {
      allOf: [
        { $ref: "#/components/schemas/CursorPage" },
        {
          type: "object",
          properties: {
            data: { type: "array", items: { $ref: `#/components/schemas/${itemSchema}` } },
          },
        },
      ],
    },
  });
}

const sseContent = {
  "text/event-stream": {
    schema: { $ref: "#/components/schemas/LlmEventStream" },
    "x-sse-event-data-schemas": {
      message: { $ref: "#/components/schemas/OpenAiChatCompletionChunk" },
      error: { $ref: "#/components/schemas/LlmStreamErrorEvent" },
      terminal: { const: "[DONE]" },
    },
  },
};

const callbackOperation = (provider: "google" | "apple", method: "get" | "post") =>
  betterAuthOperation({
    operationId: `${method}BetterAuth${provider[0]?.toUpperCase()}${provider.slice(1)}Callback`,
    tag: "Identity",
    public: true,
    successStatus: "302",
    successDescription:
      "OAuth callback resolves the Better Auth session into private one-time server state and redirects to the MaxPower HTTPS handoff. Failed provider responses redirect to the HTTPS error handoff. No Better Auth session cookie is forwarded.",
    successHeaders: {
      Location: {
        description: "MaxPower HTTPS success or error handoff carrying only an opaque internal flow identifier.",
        schema: {
          type: "string",
          pattern: "^https://[^?#]+/v1/auth/social/(?:handoff|error)\\?flow=[A-Za-z0-9_-]+$",
        },
      },
    },
    ...(method === "post"
      ? { requestSchema: { $ref: "#/components/schemas/OAuthCallbackRequest" }, requestRequired: false }
      : {}),
  });

export const openApiDocument = {
  openapi: "3.1.0",
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  info: {
    title: "MaxPower Cloud Service",
    version: "1.0.0",
    description:
      "Authenticated cloud authority for confirmed product resources, optional private media, and metered LLM access. Coach conversations remain local.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Operations" },
    { name: "Identity" },
    { name: "ProductData" },
    { name: "MediaLibrary" },
    { name: "LlmGateway" },
  ],
  paths: {
    "/healthz": {
      get: operation({
        operationId: "health",
        tag: "Operations",
        successSchema: { $ref: "#/components/schemas/HealthStatus" },
      }),
    },
    "/readyz": {
      get: {
        operationId: "readiness",
        tags: ["Operations"],
        responses: {
          "200": {
            description: "All required production dependencies are ready.",
            content: jsonContent({ $ref: "#/components/schemas/ReadyStatus" }),
          },
          "503": {
            description: "At least one required dependency is unavailable.",
            content: jsonContent({ $ref: "#/components/schemas/NotReadyStatus" }),
          },
        },
      },
    },
    "/openapi.json": {
      get: operation({
        operationId: "openApiDocument",
        tag: "Operations",
        successSchema: { type: "object", additionalProperties: true },
      }),
    },

    "/api/auth/social/authorize": {
      get: betterAuthOperation({
        operationId: "authorizeSocialBrowser",
        tag: "Identity",
        public: true,
        parameters: [{
          name: "state",
          in: "query",
          required: true,
          description: "Opaque OAuth state returned only inside the HTTPS authorization URL.",
          schema: { type: "string", minLength: 16, maxLength: 512 },
        }],
        successStatus: "302",
        successDescription:
          "Sets the HttpOnly OAuth state cookie and redirects to the HTTPS Provider authorization URL.",
        successHeaders: { Location: { $ref: "#/components/headers/Location" } },
      }),
    },
    "/api/auth/callback/google": {
      get: callbackOperation("google", "get"),
      post: callbackOperation("google", "post"),
    },
    "/api/auth/callback/apple": {
      get: callbackOperation("apple", "get"),
      post: callbackOperation("apple", "post"),
    },
    "/api/auth/link-social": {
      post: betterAuthOperation({
        operationId: "betterAuthLinkSocial",
        tag: "Identity",
        requestSchema: { $ref: "#/components/schemas/SocialAuthRequest" },
        successSchema: { $ref: "#/components/schemas/SocialAuthResponse" },
      }),
    },
    "/api/auth/list-accounts": {
      get: betterAuthOperation({
        operationId: "betterAuthListAccounts",
        tag: "Identity",
        successSchema: {
          type: "array",
          items: { $ref: "#/components/schemas/LinkedIdentity" },
        },
      }),
    },
    "/api/auth/unlink-account": {
      post: betterAuthOperation({
        operationId: "betterAuthUnlinkAccount",
        tag: "Identity",
        requestSchema: { $ref: "#/components/schemas/UnlinkIdentityRequest" },
        successSchema: { type: "object", required: ["status"], properties: { status: { type: "boolean" } } },
      }),
    },
    "/api/auth/.well-known/jwks.json": {
      get: betterAuthOperation({
        operationId: "betterAuthJwks",
        tag: "Identity",
        public: true,
        successSchema: { $ref: "#/components/schemas/JsonWebKeySet" },
      }),
    },
    "/api/auth/error": {
      get: betterAuthOperation({
        operationId: "betterAuthErrorPage",
        tag: "Identity",
        public: true,
        successStatus: "302",
        successDescription: "Redirects to the configured public error page.",
        successHeaders: { Location: { $ref: "#/components/headers/Location" } },
      }),
    },
    "/v1/auth/config": {
      get: operation({
        operationId: "getIdentityConfiguration",
        tag: "Identity",
        successSchema: { $ref: "#/components/schemas/IdentityConfiguration" },
      }),
    },
    "/v1/auth/register/otp/start": {
      post: identityOperation(
        "startRegistrationOtp",
        { $ref: "#/components/schemas/StartOtpRequest" },
        "202",
        { $ref: "#/components/schemas/OtpChallenge" },
      ),
    },
    "/v1/auth/register/otp/verify": {
      post: identityOperation(
        "verifyRegistrationOtp",
        { $ref: "#/components/schemas/VerifyOtpRequest" },
        "200",
        { oneOf: [
          { $ref: "#/components/schemas/AuthenticatedIdentity" },
          { $ref: "#/components/schemas/RegistrationRequired" },
        ] },
      ),
    },
    "/v1/auth/register/complete": {
      post: identityOperation(
        "completeRegistration",
        { $ref: "#/components/schemas/CompleteRegistrationRequest" },
        "201",
      ),
    },
    "/v1/auth/login/otp/start": {
      post: identityOperation(
        "startLoginOtp",
        { $ref: "#/components/schemas/StartOtpRequest" },
        "202",
        { $ref: "#/components/schemas/OtpChallenge" },
      ),
    },
    "/v1/auth/login/otp/verify": {
      post: identityOperation("verifyLoginOtp", { $ref: "#/components/schemas/VerifyOtpRequest" }),
    },
    "/v1/auth/login/password": {
      post: identityOperation("loginWithPassword", { $ref: "#/components/schemas/PasswordLoginRequest" }),
    },
    "/v1/auth/refresh": {
      post: identityOperation("refreshSession", { $ref: "#/components/schemas/RefreshSessionRequest" }),
    },
    "/v1/auth/social/start": {
      post: identityOperation(
        "startSocialAuth",
        { $ref: "#/components/schemas/StartSocialAuthRequest" },
        "200",
        { $ref: "#/components/schemas/StartSocialAuthResponse" },
      ),
    },
    "/v1/auth/social/exchange": {
      post: identityOperation(
        "exchangeSocialAuth",
        { $ref: "#/components/schemas/ExchangeSocialAuthRequest" },
        "200",
        { $ref: "#/components/schemas/ExchangeSocialAuthResponse" },
      ),
    },
    "/v1/auth/social/handoff": {
      get: operation({
        operationId: "completeSocialBrowserHandoff",
        tag: "Identity",
        parameters: [{
          name: "flow",
          in: "query",
          required: true,
          description: "Opaque internal browser handoff identifier.",
          schema: { type: "string", minLength: 16, maxLength: 256 },
        }],
        successStatus: "302",
        successDescription:
          "After atomically consuming the authorized server-side handoff, redirects to the exact native callback with a short-lived one-time code.",
        successHeaders: {
          Location: {
            description: "Exact native callback URL with only code and state query parameters.",
            schema: { type: "string", pattern: "^[a-z][a-z0-9+.-]*://[^?#]+\\?code=[^&]+&state=[^&]+$" },
          },
        },
      }),
    },
    "/v1/auth/social/error": {
      get: operation({
        operationId: "failSocialBrowserHandoff",
        tag: "Identity",
        parameters: [{
          name: "flow",
          in: "query",
          required: true,
          description: "Opaque internal browser handoff identifier to invalidate.",
          schema: { type: "string", minLength: 16, maxLength: 256 },
        }],
        successStatus: "302",
        successDescription:
          "Invalidates the failed browser flow and returns to the exact native callback with only a stable error and exchange state.",
        successHeaders: {
          Location: {
            description: "Exact native callback URL with only error and state query parameters.",
            schema: {
              type: "string",
              pattern:
                "^[a-z][a-z0-9+.-]*://[^?#]+\\?error=social_callback_failed&state=[A-Za-z0-9_-]+$",
            },
          },
        },
      }),
    },
    "/v1/auth/social/complete": {
      post: identityOperation(
        "completeSocialOnboarding",
        { $ref: "#/components/schemas/CompleteSocialOnboardingRequest" },
        "201",
      ),
    },
    "/v1/auth/session": {
      get: protectedOperation({
        operationId: "readSession",
        tag: "Identity",
        successSchema: { $ref: "#/components/schemas/ServiceSession" },
      }),
    },
    "/v1/auth/logout": {
      post: operation({
        operationId: "logout",
        tag: "Identity",
        requestSchema: { $ref: "#/components/schemas/RefreshSessionRequest" },
        successStatus: "204",
        successDescription: "The opaque session credential has been revoked.",
      }),
    },

    "/v1/me": {
      get: protectedOperation({
        operationId: "getProfile",
        tag: "ProductData",
        successSchema: { $ref: "#/components/schemas/Profile" },
        successHeaders: etagResponseHeader,
      }),
      patch: protectedOperation({
        operationId: "patchProfile",
        tag: "ProductData",
        parameters: [idempotencyHeader, ifMatchHeader],
        requestSchema: { $ref: "#/components/schemas/PatchProfileRequest" },
        successSchema: { $ref: "#/components/schemas/Profile" },
        successHeaders: etagResponseHeader,
      }),
    },
    "/v1/plans": {
      get: paginatedOperation("listPlans", "Plan"),
      post: protectedOperation({
        operationId: "createPlan",
        tag: "ProductData",
        parameters: [idempotencyHeader],
        requestSchema: { $ref: "#/components/schemas/CreatePlanRequest" },
        successStatus: "201",
        successSchema: { $ref: "#/components/schemas/Plan" },
        successHeaders: locationAndEtagResponseHeaders,
      }),
    },
    "/v1/plans/{planId}": {
      get: protectedOperation({
        operationId: "getPlan",
        tag: "ProductData",
        parameters: [idParameter("planId")],
        successSchema: { $ref: "#/components/schemas/Plan" },
        successHeaders: etagResponseHeader,
      }),
      patch: protectedOperation({
        operationId: "patchPlan",
        tag: "ProductData",
        parameters: [idParameter("planId"), idempotencyHeader, ifMatchHeader],
        requestSchema: { $ref: "#/components/schemas/PatchPlanRequest" },
        successSchema: { $ref: "#/components/schemas/Plan" },
        successHeaders: etagResponseHeader,
      }),
      delete: protectedOperation({
        operationId: "deletePlan",
        tag: "ProductData",
        parameters: [idParameter("planId"), idempotencyHeader, ifMatchHeader],
        successStatus: "204",
        successDescription: "Plan deleted; frozen workout snapshots remain.",
      }),
    },
    "/v1/plans/{planId}/publish": {
      post: protectedOperation({
        operationId: "publishPlan",
        tag: "ProductData",
        parameters: [idParameter("planId"), idempotencyHeader, ifMatchHeader],
        successSchema: { $ref: "#/components/schemas/Plan" },
        successHeaders: etagResponseHeader,
      }),
    },
    "/v1/workout-sessions": {
      get: paginatedOperation("listWorkoutSessions", "WorkoutSession"),
      post: protectedOperation({
        operationId: "createWorkoutSession",
        tag: "ProductData",
        parameters: [idempotencyHeader],
        requestSchema: { $ref: "#/components/schemas/CreateWorkoutSessionRequest" },
        successStatus: "201",
        successSchema: { $ref: "#/components/schemas/WorkoutSession" },
        successHeaders: locationAndEtagResponseHeaders,
      }),
    },
    "/v1/workout-sessions/{workoutSessionId}": {
      get: protectedOperation({
        operationId: "getWorkoutSession",
        tag: "ProductData",
        parameters: [idParameter("workoutSessionId")],
        successSchema: { $ref: "#/components/schemas/WorkoutSession" },
        successHeaders: etagResponseHeader,
      }),
      patch: protectedOperation({
        operationId: "patchWorkoutSession",
        tag: "ProductData",
        parameters: [idParameter("workoutSessionId"), idempotencyHeader, ifMatchHeader],
        requestSchema: { $ref: "#/components/schemas/PatchWorkoutSessionRequest" },
        successSchema: { $ref: "#/components/schemas/WorkoutSession" },
        successHeaders: etagResponseHeader,
      }),
      delete: protectedOperation({
        operationId: "deleteWorkoutSession",
        tag: "ProductData",
        parameters: [idParameter("workoutSessionId"), idempotencyHeader, ifMatchHeader],
        successStatus: "204",
        successDescription: "Workout session deleted.",
      }),
    },
    "/v1/workout-sessions/{workoutSessionId}/complete": {
      post: protectedOperation({
        operationId: "completeWorkoutSession",
        tag: "ProductData",
        parameters: [idParameter("workoutSessionId"), idempotencyHeader, ifMatchHeader],
        requestSchema: { $ref: "#/components/schemas/CompleteWorkoutSessionRequest" },
        successSchema: { $ref: "#/components/schemas/WorkoutSession" },
        successHeaders: etagResponseHeader,
      }),
    },
    "/v1/results": {
      get: paginatedOperation("listResults", "Result"),
      post: protectedOperation({
        operationId: "createResult",
        tag: "ProductData",
        parameters: [idempotencyHeader],
        requestSchema: { $ref: "#/components/schemas/CreateResultRequest" },
        successStatus: "201",
        successSchema: { $ref: "#/components/schemas/Result" },
        successHeaders: locationAndEtagResponseHeaders,
      }),
    },
    "/v1/results/{resultId}": {
      get: protectedOperation({
        operationId: "getResult",
        tag: "ProductData",
        parameters: [idParameter("resultId")],
        successSchema: { $ref: "#/components/schemas/Result" },
        successHeaders: etagResponseHeader,
      }),
      patch: protectedOperation({
        operationId: "patchResult",
        tag: "ProductData",
        parameters: [idParameter("resultId"), idempotencyHeader, ifMatchHeader],
        requestSchema: { $ref: "#/components/schemas/PatchResultRequest" },
        successSchema: { $ref: "#/components/schemas/Result" },
        successHeaders: etagResponseHeader,
      }),
      delete: protectedOperation({
        operationId: "deleteResult",
        tag: "ProductData",
        parameters: [idParameter("resultId"), idempotencyHeader, ifMatchHeader],
        successStatus: "204",
        successDescription: "Result deleted.",
      }),
    },

    "/v1/media/uploads": {
      post: protectedOperation({
        operationId: "createMediaUpload",
        tag: "MediaLibrary",
        parameters: [idempotencyHeader],
        requestSchema: { $ref: "#/components/schemas/CreateMediaUploadRequest" },
        successStatus: "201",
        successSchema: { $ref: "#/components/schemas/CreatedMediaUpload" },
        successHeaders: locationAndEtagResponseHeaders,
      }),
    },
    "/v1/media/uploads/{uploadId}/complete": {
      post: protectedOperation({
        operationId: "completeMediaUpload",
        tag: "MediaLibrary",
        parameters: [idParameter("uploadId"), idempotencyHeader, ifMatchHeader],
        successSchema: { $ref: "#/components/schemas/CompletedMediaUpload" },
        successHeaders: etagResponseHeader,
      }),
    },
    "/v1/media": {
      get: paginatedOperation("listMedia", "MediaAsset"),
    },
    "/v1/media/{assetId}": {
      get: protectedOperation({
        operationId: "getMedia",
        tag: "MediaLibrary",
        parameters: [idParameter("assetId")],
        successSchema: { $ref: "#/components/schemas/MediaAsset" },
        successHeaders: etagResponseHeader,
      }),
      delete: protectedOperation({
        operationId: "deleteMedia",
        tag: "MediaLibrary",
        parameters: [idParameter("assetId"), idempotencyHeader, ifMatchHeader],
        successStatus: "202",
        successSchema: { $ref: "#/components/schemas/MediaDeletionAccepted" },
      }),
    },
    "/v1/media/{assetId}/download-url": {
      post: protectedOperation({
        operationId: "createMediaDownloadUrl",
        tag: "MediaLibrary",
        parameters: [idParameter("assetId")],
        successSchema: { $ref: "#/components/schemas/MediaDownloadTarget" },
      }),
    },

    "/v1/chat/completions": {
      post: protectedOperation({
        operationId: "createChatCompletion",
        tag: "LlmGateway",
        parameters: [idempotencyHeader, clientRunHeader],
        requestSchema: { $ref: "#/components/schemas/OpenAiChatCompletionRequest" },
        successContent: {
          ...jsonContent({ $ref: "#/components/schemas/OpenAiChatCompletion" }),
          ...sseContent,
        },
        successHeaders: invocationResponseHeader,
        successDescription:
          "OpenAI-compatible JSON or SSE. Only public MaxPower aliases and model names cross this boundary.",
      }),
    },
    "/v1/invocations/{invocationId}/events": {
      get: protectedOperation({
        operationId: "resumeLlmStream",
        tag: "LlmGateway",
        parameters: [idParameter("invocationId"), lastEventIdHeader],
        successContent: sseContent,
        successHeaders: invocationResponseHeader,
        successDescription: "Replays buffered SSE events after Last-Event-ID, then follows the live stream.",
      }),
    },
    "/v1/invocations/cancel": {
      post: protectedOperation({
        operationId: "cancelLlmInvocation",
        tag: "LlmGateway",
        requestSchema: { $ref: "#/components/schemas/CancelLlmInvocationRequest" },
        successStatus: "202",
        successSchema: { $ref: "#/components/schemas/CancelLlmInvocationResponse" },
      }),
    },
    "/v1/entitlements/me": {
      get: protectedOperation({
        operationId: "getMyEntitlement",
        tag: "LlmGateway",
        successSchema: { $ref: "#/components/schemas/PublicEntitlement" },
      }),
    },

    "/v1/me/deletion": {
      post: operation({
        operationId: "requestAccountDeletion",
        tag: "Identity",
        security: "deletion-recovery",
        parameters: [deletionIdempotencyHeader],
        requestSchema: { $ref: "#/components/schemas/RequestAccountDeletion" },
        successStatus: "202",
        successSchema: {
          oneOf: [
            { $ref: "#/components/schemas/AccountDeletionJob" },
            { $ref: "#/components/schemas/AccountDeletionReceiptRecovery" },
          ],
        },
      }),
      get: operation({
        operationId: "getAccountDeletion",
        tag: "Identity",
        security: "deletion-receipt",
        parameters: [deletionReceiptHeader],
        successSchema: {
          oneOf: [
            { $ref: "#/components/schemas/AccountDeletionJob" },
            { $ref: "#/components/schemas/AccountDeletionReceiptStatus" },
          ],
        },
      }),
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      betterAuthSession: {
        type: "http",
        scheme: "bearer",
        description: "Opaque Better Auth session credential for reviewed identity-only endpoints.",
      },
      deletionReceipt: {
        type: "apiKey",
        in: "header",
        name: "Deletion-Receipt",
        description: "Server-generated bearer receipt; valid only for deletion-status lookup.",
      },
      deletionRecoveryKey: {
        type: "apiKey",
        in: "header",
        name: "Idempotency-Key",
        description:
          "High-entropy deletion replay capability. It is accepted only for the exact already-created request.",
      },
    },
    headers: {
      ETag: {
        description: "Quoted current integer resource revision.",
        schema: { type: "string", pattern: "^\\\"[1-9][0-9]*\\\"$" },
      },
      Location: {
        description: "Canonical path of the created resource or redirect target.",
        schema: { type: "string" },
      },
      InvocationId: {
        description: "Public invocation identifier used for short-lived stream resumption.",
        schema: { type: "string", minLength: 1 },
      },
      RetryAfter: {
        description: "Seconds before a retry may be attempted, when applicable.",
        schema: { type: "integer", minimum: 1 },
      },
    },
    schemas: {
      HealthStatus: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: { status: { const: "ok" } },
      },
      ReadyStatus: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: { status: { const: "ready" } },
      },
      NotReadyStatus: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: { status: { const: "not_ready" } },
      },
      IdentityIdentifier: {
        oneOf: [
          {
            type: "object",
            required: ["kind", "value"],
            additionalProperties: false,
            properties: {
              kind: { const: "email" },
              value: { type: "string", format: "email", maxLength: 320 },
            },
          },
          {
            type: "object",
            required: ["kind", "value"],
            additionalProperties: false,
            properties: {
              kind: { const: "phone" },
              value: { type: "string", pattern: "^\\+[1-9][0-9]{6,14}$" },
            },
          },
        ],
      },
      IdentityConfiguration: {
        type: "object",
        required: ["realm", "requiredTermsVersion", "socialProviders"],
        additionalProperties: false,
        properties: {
          realm: { const: "global" },
          requiredTermsVersion: { type: "string" },
          socialProviders: {
            type: "array",
            prefixItems: [{ const: "google" }, { const: "apple" }],
            minItems: 2,
            maxItems: 2,
          },
        },
      },
      StartOtpRequest: {
        type: "object",
        required: ["identifier"],
        additionalProperties: false,
        properties: { identifier: { $ref: "#/components/schemas/IdentityIdentifier" } },
      },
      VerifyOtpRequest: {
        type: "object",
        required: ["challengeId", "code"],
        additionalProperties: false,
        properties: {
          challengeId: { type: "string", minLength: 1 },
          code: { type: "string", pattern: "^[0-9]{4,10}$" },
        },
      },
      OtpChallenge: {
        type: "object",
        required: ["challengeId", "identifier", "expiresAt"],
        additionalProperties: false,
        properties: {
          challengeId: { type: "string" },
          identifier: { $ref: "#/components/schemas/IdentityIdentifier" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      CompleteRegistrationRequest: {
        type: "object",
        required: ["registrationId", "displayName", "password", "termsVersion"],
        additionalProperties: false,
        properties: {
          registrationId: { type: "string", minLength: 1 },
          displayName: { type: "string", minLength: 1, maxLength: 80 },
          password: { type: "string", minLength: 8, maxLength: 256, writeOnly: true },
          termsVersion: { type: "string", minLength: 1, maxLength: 100 },
        },
      },
      PasswordLoginRequest: {
        type: "object",
        required: ["identifier", "password"],
        additionalProperties: false,
        properties: {
          identifier: { $ref: "#/components/schemas/IdentityIdentifier" },
          password: { type: "string", minLength: 1, maxLength: 256, writeOnly: true },
        },
      },
      RefreshSessionRequest: {
        type: "object",
        required: ["sessionToken"],
        additionalProperties: false,
        properties: { sessionToken: { type: "string", minLength: 1, maxLength: 2048, writeOnly: true } },
      },
      StartSocialAuthRequest: {
        type: "object",
        required: ["provider", "callbackUrl", "deviceBinding"],
        additionalProperties: false,
        properties: {
          provider: { type: "string", enum: ["google", "apple"] },
          callbackUrl: {
            type: "string",
            description: "Exact configured native callback, such as maxpower://auth/callback.",
          },
          deviceBinding: {
            type: "string",
            pattern: "^[a-fA-F0-9]{64}$",
            writeOnly: true,
            description: "Per-install 32-byte random proof. It is sent only over HTTPS and stored only as a digest.",
          },
        },
      },
      StartSocialAuthResponse: {
        type: "object",
        required: ["authorizationUrl", "exchangeState"],
        additionalProperties: false,
        properties: {
          authorizationUrl: { type: "string", format: "uri", pattern: "^https://" },
          exchangeState: { type: "string", minLength: 16, maxLength: 256 },
        },
      },
      ExchangeSocialAuthRequest: {
        type: "object",
        required: ["code", "state", "callbackUrl", "deviceBinding"],
        additionalProperties: false,
        properties: {
          code: { type: "string", minLength: 16, maxLength: 256, writeOnly: true },
          state: { type: "string", minLength: 16, maxLength: 256 },
          callbackUrl: { type: "string" },
          deviceBinding: {
            type: "string",
            pattern: "^[a-fA-F0-9]{64}$",
            writeOnly: true,
          },
        },
      },
      ExchangeSocialAuthResponse: {
        type: "object",
        required: ["sessionToken"],
        additionalProperties: false,
        properties: {
          sessionToken: { type: "string", minLength: 1, maxLength: 2048, writeOnly: true },
        },
      },
      CompleteSocialOnboardingRequest: {
        type: "object",
        required: ["sessionToken", "displayName", "termsVersion"],
        additionalProperties: false,
        properties: {
          sessionToken: { type: "string", minLength: 1, maxLength: 2048, writeOnly: true },
          displayName: { type: "string", minLength: 1, maxLength: 80 },
          termsVersion: { type: "string", minLength: 1, maxLength: 100 },
        },
      },
      AuthenticatedIdentity: {
        type: "object",
        required: ["status", "accountId", "sessionId", "displayName", "sessionToken", "accessToken", "expiresAt"],
        additionalProperties: false,
        properties: {
          status: { const: "authenticated" },
          accountId: { type: "string" },
          sessionId: { type: "string" },
          displayName: { type: "string" },
          sessionToken: { type: "string", writeOnly: true },
          accessToken: { type: "string", writeOnly: true },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      RegistrationRequired: {
        type: "object",
        required: ["status", "registrationId", "identifier", "expiresAt"],
        additionalProperties: false,
        properties: {
          status: { const: "registration_required" },
          registrationId: { type: "string" },
          identifier: { $ref: "#/components/schemas/IdentityIdentifier" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      ServiceSession: {
        type: "object",
        required: ["accountId", "sessionId", "status", "scopes"],
        additionalProperties: false,
        properties: {
          accountId: { type: "string" },
          sessionId: { type: "string" },
          status: { const: "active" },
          scopes: { type: "array", items: { type: "string" }, uniqueItems: true },
        },
      },
      SocialAuthRequest: {
        type: "object",
        required: ["provider"],
        properties: {
          provider: { type: "string", enum: ["google", "apple"] },
          callbackURL: { type: "string" },
          disableRedirect: { type: "boolean" },
          idToken: { type: "object", additionalProperties: true, writeOnly: true },
        },
        additionalProperties: true,
      },
      SocialAuthResponse: {
        type: "object",
        required: ["redirect"],
        properties: {
          url: { type: "string" },
          redirect: { type: "boolean" },
          status: { type: "boolean" },
        },
        additionalProperties: true,
      },
      OAuthCallbackRequest: {
        type: "object",
        properties: {
          code: { type: "string" },
          state: { type: "string" },
          error: { type: "string" },
        },
        additionalProperties: true,
      },
      LinkedIdentity: {
        type: "object",
        required: ["id", "providerId", "accountId", "userId", "scopes"],
        properties: {
          id: { type: "string" },
          providerId: { type: "string" },
          accountId: { type: "string" },
          userId: { type: "string" },
          scopes: { type: "array", items: { type: "string" } },
        },
        additionalProperties: true,
      },
      UnlinkIdentityRequest: {
        type: "object",
        required: ["providerId"],
        additionalProperties: false,
        properties: {
          providerId: { type: "string" },
          accountId: { type: "string" },
        },
      },
      JsonWebKeySet: {
        type: "object",
        required: ["keys"],
        additionalProperties: false,
        properties: {
          keys: {
            type: "array",
            items: {
              type: "object",
              required: ["kid", "kty", "alg"],
              properties: {
                kid: { type: "string" },
                kty: { type: "string" },
                alg: { type: "string" },
                crv: { type: "string" },
                x: { type: "string" },
              },
              additionalProperties: true,
            },
          },
        },
      },
      PatchProfileRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          displayName: { type: ["string", "null"], minLength: 1, maxLength: 100 },
          locale: { type: "string", minLength: 2, maxLength: 35 },
          timeZone: { type: "string", minLength: 1, maxLength: 100 },
          unitSystem: { type: "string", enum: ["metric", "imperial"] },
          data: { type: "object", additionalProperties: true },
        },
      },
      Profile: resourceSchema(["accountId", "data", "locale", "timeZone", "unitSystem", "revision"]),
      CreatePlanRequest: {
        type: "object",
        required: ["title", "snapshot"],
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          snapshot: { type: "object", additionalProperties: true },
        },
      },
      PatchPlanRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          snapshot: { type: "object", additionalProperties: true },
        },
      },
      Plan: resourceSchema(["id", "title", "status", "revision"]),
      CursorPage: {
        type: "object",
        required: ["data", "nextCursor"],
        properties: {
          data: { type: "array", items: {} },
          nextCursor: { type: ["string", "null"] },
        },
      },
      MediaEvidenceReference: {
        type: "object",
        required: ["assetId", "evidenceStatus", "evidenceDeletedAt"],
        additionalProperties: false,
        properties: {
          assetId: { type: "string" },
          evidenceStatus: { type: "string", enum: ["available", "evidence_deleted"] },
          evidenceDeletedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      MediaAssetIds: {
        type: "array",
        maxItems: 32,
        uniqueItems: true,
        items: { type: "string", minLength: 1, maxLength: 500 },
      },
      CreateWorkoutSessionRequest: {
        type: "object",
        required: ["title"],
        additionalProperties: false,
        properties: {
          planId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1, maxLength: 160 },
          data: { type: "object", additionalProperties: true },
          mediaAssetIds: { $ref: "#/components/schemas/MediaAssetIds" },
          startedAt: { type: "string", format: "date-time" },
        },
      },
      PatchWorkoutSessionRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 160 },
          data: { type: "object", additionalProperties: true },
          notes: { type: ["string", "null"], maxLength: 4_000 },
          mediaAssetIds: { $ref: "#/components/schemas/MediaAssetIds" },
          startedAt: { type: "string", format: "date-time" },
        },
      },
      CompleteWorkoutSessionRequest: {
        type: "object",
        required: ["summary"],
        additionalProperties: false,
        properties: {
          summary: { type: "object", additionalProperties: true },
          completedAt: { type: "string", format: "date-time" },
        },
      },
      WorkoutSession: resourceSchema(["id", "title", "status", "mediaReferences", "revision"]),
      CreateResultRequest: {
        type: "object",
        required: ["kind", "payload"],
        additionalProperties: false,
        properties: {
          kind: { type: "string", minLength: 1, maxLength: 100 },
          workoutSessionId: { type: "string", minLength: 1 },
          payload: { type: "object", additionalProperties: true },
          provenance: { type: "object", additionalProperties: true },
          mediaAssetIds: { $ref: "#/components/schemas/MediaAssetIds" },
          occurredAt: { type: "string", format: "date-time" },
        },
      },
      PatchResultRequest: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", minLength: 1, maxLength: 100 },
          payload: { type: "object", additionalProperties: true },
          provenance: { type: "object", additionalProperties: true },
          mediaAssetIds: { $ref: "#/components/schemas/MediaAssetIds" },
          occurredAt: { type: "string", format: "date-time" },
        },
      },
      Result: resourceSchema(["id", "kind", "payload", "provenance", "mediaReferences", "revision"]),
      CreateMediaUploadRequest: {
        type: "object",
        required: ["kind", "fileName", "contentType", "byteSize", "sha256"],
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["video", "canonical_packet", "keypoints", "nutrition_photo"],
          },
          fileName: { type: "string", minLength: 1, maxLength: 255 },
          contentType: { type: "string", minLength: 3, maxLength: 255 },
          byteSize: { type: "integer", minimum: 1, maximum: 5_368_709_120 },
          sha256: { type: "string", pattern: "^[a-fA-F0-9]{64}$" },
          parentAssetId: { type: "string", minLength: 1 },
        },
      },
      MediaAsset: resourceSchema(["id", "kind", "fileName", "contentType", "byteSize", "status", "revision"]),
      MediaUpload: resourceSchema(["id", "assetId", "status", "revision"]),
      MediaUploadTarget: {
        type: "object",
        required: ["kind", "url", "headers", "expiresAt"],
        properties: {
          kind: { type: "string", enum: ["presigned_put"] },
          url: { type: "string", format: "uri" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      CreatedMediaUpload: {
        type: "object",
        required: ["asset", "upload", "uploadTarget"],
        properties: {
          asset: { $ref: "#/components/schemas/MediaAsset" },
          upload: { $ref: "#/components/schemas/MediaUpload" },
          uploadTarget: { $ref: "#/components/schemas/MediaUploadTarget" },
        },
      },
      CompletedMediaUpload: {
        type: "object",
        required: ["asset", "upload"],
        properties: {
          asset: { $ref: "#/components/schemas/MediaAsset" },
          upload: { $ref: "#/components/schemas/MediaUpload" },
        },
      },
      MediaDownloadTarget: {
        type: "object",
        required: ["kind", "url", "expiresAt"],
        properties: {
          kind: { type: "string", enum: ["presigned_get"] },
          url: { type: "string", format: "uri" },
          expiresAt: { type: "string", format: "date-time" },
        },
      },
      MediaDeletionAccepted: {
        type: "object",
        required: ["status", "deletedAssetIds"],
        properties: {
          status: { const: "deleted" },
          deletedAssetIds: { type: "array", items: { type: "string" } },
        },
      },
      OpenAiChatCompletionRequest: {
        type: "object",
        required: ["model", "messages"],
        properties: {
          model: {
            type: "string",
            enum: ["maxpower/coach-v1", "maxpower/nutrition-vision-v1"],
          },
          messages: { type: "array", maxItems: 128, items: {} },
          stream: { type: "boolean", default: false },
          tools: { type: "array", maxItems: 128, items: {} },
          max_tokens: { type: "integer", minimum: 1 },
          max_completion_tokens: { type: "integer", minimum: 1 },
          parallel_tool_calls: { const: false },
          store: {
            const: false,
            description: "Accepted for Pi/OpenAI compatibility. Provider retention stays disabled.",
          },
          stream_options: {
            type: "object",
            required: ["include_usage"],
            additionalProperties: false,
            properties: { include_usage: { const: true } },
            description: "Accepted for Pi compatibility; usage remains server-internal.",
          },
          temperature: { type: "number", minimum: 0, maximum: 2 },
          tool_choice: {
            oneOf: [
              { type: "string", enum: ["auto", "none", "required"] },
              {
                type: "object",
                required: ["type", "function"],
                additionalProperties: false,
                properties: {
                  type: { const: "function" },
                  function: {
                    type: "object",
                    required: ["name"],
                    additionalProperties: false,
                    properties: { name: { type: "string", minLength: 1, maxLength: 128 } },
                  },
                },
              },
            ],
          },
          response_format: {
            type: "object",
            required: ["type"],
            additionalProperties: false,
            properties: { type: { const: "json_object" } },
          },
        },
        additionalProperties: false,
      },
      CancelLlmInvocationRequest: {
        type: "object",
        required: ["idempotencyKey"],
        additionalProperties: false,
        properties: {
          idempotencyKey: {
            type: "string",
            minLength: 1,
            maxLength: 200,
            pattern: ".*\\S.*",
          },
        },
      },
      CancelLlmInvocationResponse: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["cancel_requested", "already_terminal"] },
          invocationId: { type: "string" },
        },
      },
      OpenAiChatCompletion: {
        type: "object",
        required: ["id", "object", "model", "choices"],
        properties: {
          id: { type: "string", pattern: "^chatcmpl_" },
          object: { const: "chat.completion" },
          model: { const: "maxpower-cloud" },
          choices: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        not: { required: ["usage"] },
        additionalProperties: true,
      },
      OpenAiChatCompletionChunk: {
        type: "object",
        required: ["id", "object", "model", "choices"],
        properties: {
          id: { type: "string", pattern: "^chatcmpl_" },
          object: { const: "chat.completion.chunk" },
          model: { const: "maxpower-cloud" },
          choices: { type: "array", items: { type: "object", additionalProperties: true } },
        },
        not: { required: ["usage"] },
        additionalProperties: true,
      },
      LlmEventStream: {
        type: "string",
        contentMediaType: "text/event-stream",
        description:
          "SSE frames carry one-based id values and OpenAI chunk JSON in data. The terminal frame is data: [DONE]. Failures use event: error with LlmStreamErrorEvent JSON.",
      },
      LlmStreamErrorEvent: {
        allOf: [{ $ref: "#/components/schemas/Error" }],
        description: "JSON payload of an SSE event named error.",
      },
      PublicEntitlement: {
        type: "object",
        required: ["status"],
        additionalProperties: false,
        properties: {
          status: { type: "string", enum: ["available", "exhausted"] },
          resetAt: { type: "string", format: "date-time" },
        },
      },
      RequestAccountDeletion: {
        type: "object",
        required: ["confirmation"],
        additionalProperties: false,
        properties: { confirmation: { const: "DELETE" } },
      },
      AccountDeletionJob: {
        type: "object",
        required: ["id", "accountId", "deletionReceipt", "status", "requestedAt", "updatedAt", "attempts", "completedAt", "lastErrorCode"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          accountId: { type: "string" },
          deletionReceipt: {
            type: "string",
            minLength: 16,
            description: "Server-generated receipt; never derived from Idempotency-Key.",
          },
          status: { type: "string", enum: ["pending", "running", "retryable", "completed"] },
          requestedAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          attempts: { type: "integer", minimum: 0 },
          completedAt: { type: ["string", "null"], format: "date-time" },
          lastErrorCode: { type: ["string", "null"] },
        },
      },
      AccountDeletionReceiptStatus: {
        type: "object",
        required: ["id", "status", "requestedAt", "updatedAt", "attempts", "completedAt", "lastErrorCode"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["pending", "running", "retryable", "completed"] },
          requestedAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          attempts: { type: "integer", minimum: 0 },
          completedAt: { type: ["string", "null"], format: "date-time" },
          lastErrorCode: { type: ["string", "null"] },
        },
      },
      AccountDeletionReceiptRecovery: {
        allOf: [
          { $ref: "#/components/schemas/AccountDeletionReceiptStatus" },
          {
            type: "object",
            required: ["deletionReceipt"],
            properties: { deletionReceipt: { type: "string", minLength: 16 } },
          },
        ],
      },
      Error: {
        type: "object",
        required: ["error"],
        additionalProperties: false,
        properties: {
          error: {
            type: "object",
            required: ["message", "type", "code", "param"],
            additionalProperties: false,
            properties: {
              message: { type: "string" },
              type: {
                type: "string",
                enum: ["invalid_request_error", "authentication_error", "permission_error", "insufficient_quota", "server_error"],
              },
              code: { type: "string" },
              param: { type: ["string", "null"] },
              details: { type: "object", additionalProperties: true },
            },
          },
        },
      },
      BetterAuthError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                required: ["code", "message"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                },
                additionalProperties: true,
              },
            ],
          },
          code: { type: "string" },
          message: { type: "string" },
        },
        additionalProperties: true,
      },
    },
  },
} as const;

function resourceSchema(required: readonly string[]): JsonSchema {
  return {
    type: "object",
    required,
    properties: {
      accountId: { type: "string" },
      id: { type: "string" },
      title: { type: "string" },
      status: { type: "string" },
      kind: { type: "string" },
      fileName: { type: "string" },
      contentType: { type: "string" },
      byteSize: { type: "integer", minimum: 0 },
      assetId: { type: "string" },
      locale: { type: "string" },
      timeZone: { type: "string" },
      unitSystem: { type: "string", enum: ["metric", "imperial"] },
      data: { type: "object", additionalProperties: true },
      payload: { type: "object", additionalProperties: true },
      provenance: { type: "object", additionalProperties: true },
      mediaReferences: {
        type: "array",
        items: { $ref: "#/components/schemas/MediaEvidenceReference" },
      },
      revision: { type: "integer", minimum: 1 },
    },
    additionalProperties: true,
  };
}
