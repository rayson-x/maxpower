import { S3Client } from "@aws-sdk/client-s3";
import { Hono } from "hono";
import { Pool } from "pg";
import { createClient } from "redis";

import { createApp } from "../../app.js";
import {
  createProductionIdentityStack,
} from "../../adapters/auth/better-auth-runtime.js";
import { PostgresAccountDeletionAdapter } from "../../adapters/account-deletion/postgres-account-deletion.js";
import { PostgresLlmEntitlementAdapter } from "../../adapters/entitlements/postgres-entitlements.js";
import { PostgresLlmUsageAdapter } from "../../adapters/entitlements/postgres-usage.js";
import { OpenAiCompatibleLlmProviderAdapter } from "../../adapters/llm-provider/openai-compatible.js";
import { S3MediaLibraryAdapter } from "../../adapters/object-storage/s3-media-library.js";
import { createPostgresProductData } from "../../adapters/postgres/product-data.js";
import { RedisVolatileStreamBufferAdapter } from "../../adapters/stream-buffer/redis-volatile-stream-buffer.js";
import type { ProductionConfig } from "../../config/production-config.js";
import { ApiError } from "../../kernel/api-error.js";
import {
  AccountDeletionModule,
  type AccountDeletion,
} from "../../modules/account-deletion/index.js";
import { LlmGateway } from "../../modules/llm/llm-gateway.js";
import { PRODUCT_ALIASES } from "../../modules/llm/model.js";
import type { LlmInvocationLifecycleAdapter } from "../../modules/llm/ports.js";
import { mountReviewedBetterAuthHandler } from "../../http/better-auth-handler.js";
import { JsonLineRequestLogger } from "../../http/request-logger.js";
import { RedisFixedWindowRateLimiter } from "../../http/redis-rate-limiter.js";
import { renderError } from "../../http/response.js";
import { createRequestLoggerMiddleware } from "../../http/request-logger.js";
import { createSecurityMiddleware } from "../../http/security.js";
import {
  PostgresIdentityEraser,
  PostgresPresignedUploadExpiryGuard,
  S3AccountMediaEraser,
} from "./deletion-erasers.js";
import { MonthlyFreeGrantLlmGateway } from "./entitlement-grants.js";
import { HttpsOtpDelivery } from "./otp-delivery.js";
import { createInfrastructureReadiness } from "./readiness.js";

export interface ProductionRedisClient {
  sendCommand(command: string[]): Promise<unknown>;
  close(): Promise<void>;
}

export interface ProductionInfrastructure {
  postgres: Pool;
  rateLimitRedis: ProductionRedisClient;
  streamRedis: ProductionRedisClient;
  objectStorage: S3Client;
  close(): Promise<void>;
}

export interface ProductionRuntimeOptions {
  writeLogLine?: (line: string) => void;
}

export interface ProductionRuntime {
  app: Hono;
  port: number;
  deletion: AccountDeletion;
  llmRecovery: Pick<LlmInvocationLifecycleAdapter, "recoverExpired">;
  adapterKinds: {
    identity: "better-auth-postgres";
    productData: "postgres";
    media: "s3-private";
    entitlement: "postgres-ledger";
    llmProvider: "openai-compatible";
    streamBuffer: "redis-volatile";
    deletion: "postgres-worker";
  };
  initialize(): Promise<void>;
  close(): Promise<void>;
}

/** Pure composition over already-connected durable infrastructure. */
export function composeProductionRuntime(
  config: ProductionConfig,
  infrastructure: ProductionInfrastructure,
  options: ProductionRuntimeOptions = {},
): ProductionRuntime {
  const otpDelivery = new HttpsOtpDelivery({
    endpoint: config.auth.otpDelivery.endpoint,
    bearerToken: config.auth.otpDelivery.bearerToken,
  });
  const identityStack = createProductionIdentityStack({
    database: infrastructure.postgres,
    baseURL: config.auth.baseURL,
    secret: config.auth.secret,
    trustedOrigins: config.auth.trustedOrigins,
    nativeSchemes: config.auth.nativeSchemes,
    otpDelivery,
    phoneIdentityDomain: config.auth.phoneIdentityDomain,
    requiredTermsVersion: config.auth.requiredTermsVersion,
    serviceJwt: config.auth.serviceJwt,
    google: config.auth.google,
    apple: config.auth.apple,
  });
  const productData = createPostgresProductData({ pool: infrastructure.postgres });
  const media = new S3MediaLibraryAdapter({
    pool: infrastructure.postgres,
    client: infrastructure.objectStorage,
    bucket: config.objectStorage.bucket,
    transferExpirySeconds: config.media.transferExpirySeconds,
  });
  const entitlements = new PostgresLlmEntitlementAdapter(infrastructure.postgres);
  const usage = new PostgresLlmUsageAdapter(infrastructure.postgres, {
    routes: config.llm.usageRoutes,
  });
  const provider = new OpenAiCompatibleLlmProviderAdapter({
    routes: config.llm.routes,
  });
  const streamBuffers = new RedisVolatileStreamBufferAdapter({
    client: infrastructure.streamRedis,
    persistence: config.streamRedis.persistence,
  });
  const llm = new MonthlyFreeGrantLlmGateway({
    gateway: new LlmGateway({
      provider,
      entitlements,
      usage,
      lifecycle: usage,
      fingerprintSecret: config.llm.fingerprintSecret,
      streamBuffers,
      requestPolicies: config.llm.requestPolicies,
      accountStatus: {
        async isActive(accountId) {
          const result = await infrastructure.postgres.query<{ account_status: string }>(
            `SELECT "accountStatus" AS account_status FROM "user" WHERE id = $1`,
            [accountId],
          );
          return result.rows[0]?.account_status === "active";
        },
      },
    }),
    grants: entitlements,
    monthlyCredits: config.llm.monthlyFreeCredits,
  });

  const mediaEraser = new S3AccountMediaEraser({
    bucket: config.objectStorage.bucket,
    client: {
      send(command) {
        return infrastructure.objectStorage.send(command as never);
      },
    },
    guard: new PostgresPresignedUploadExpiryGuard({
      pool: infrastructure.postgres,
      transferExpirySeconds: config.media.transferExpirySeconds,
    }),
  });
  const deletion = new AccountDeletionModule({
    adapter: new PostgresAccountDeletionAdapter({
      pool: infrastructure.postgres,
      media: mediaEraser,
      identity: new PostgresIdentityEraser(infrastructure.postgres),
    }),
  });
  const readiness = createInfrastructureReadiness({
    postgres: infrastructure.postgres,
    rateLimitRedis: infrastructure.rateLimitRedis,
    streamRedis: infrastructure.streamRedis,
    objectStorage: {
      bucket: config.objectStorage.bucket,
      client: {
        send(command) {
          return infrastructure.objectStorage.send(command as never);
        },
      },
    },
  });
  const coreApp = createApp(
    {
      identity: identityStack.identity,
      socialAuth: identityStack.socialAuth,
      tokens: identityStack.identity,
      productData,
      media,
      llm,
      accountDeletion: deletion,
    },
    { readiness },
  );

  const app = new Hono();
  app.onError((error, context) => renderError(context, error));
  app.notFound((context) => renderError(
    context,
    new ApiError(404, "route_not_found", "The route was not found."),
  ));
  const logger = new JsonLineRequestLogger(options.writeLogLine);
  app.use("*", createRequestLoggerMiddleware(logger));
  app.use("*", createSecurityMiddleware({
    allowedOrigins: config.http.allowedOrigins,
    maxRequestBytes: config.http.maxRequestBytes,
    rateLimiter: new RedisFixedWindowRateLimiter({
      client: infrastructure.rateLimitRedis,
      limit: config.http.rateLimitRequests,
      windowSeconds: config.http.rateLimitWindowSeconds,
    }),
    strictTransportSecurity: true,
  }));
  mountReviewedBetterAuthHandler(app, identityStack.authHandler, {
    maxRequestBytes: config.http.maxRequestBytes,
  });
  app.route("/", coreApp);

  return {
    app,
    port: config.http.port,
    deletion,
    llmRecovery: usage,
    adapterKinds: {
      identity: "better-auth-postgres",
      productData: "postgres",
      media: "s3-private",
      entitlement: "postgres-ledger",
      llmProvider: "openai-compatible",
      streamBuffer: "redis-volatile",
      deletion: "postgres-worker",
    },
    async initialize() {
      const effectiveFrom = new Date(0).toISOString();
      await Promise.all(PRODUCT_ALIASES.map((alias) => usage.upsertPricing({
        ...config.llm.usageRoutes[alias],
        alias,
        inputCreditsPerMillionTokens: config.llm.routes[alias].inputCreditsPerMillionTokens,
        outputCreditsPerMillionTokens: config.llm.routes[alias].outputCreditsPerMillionTokens,
        inputCostMicrosPerMillionTokens:
          config.llm.providerCostRoutes[alias].inputMicrosPerMillionTokens,
        outputCostMicrosPerMillionTokens:
          config.llm.providerCostRoutes[alias].outputMicrosPerMillionTokens,
        effectiveFrom,
        effectiveTo: null,
      })));
    },
    close: infrastructure.close,
  };
}

/** Connects durable dependencies and initializes reviewed pricing metadata. */
export async function createProductionRuntime(config: ProductionConfig): Promise<ProductionRuntime> {
  const postgres = new Pool({
    connectionString: config.database.url,
    application_name: "maxpower-api",
    max: 20,
  });
  const nativeRateLimitRedis = createClient({ url: config.rateLimitRedis.url });
  const nativeStreamRedis = createClient({ url: config.streamRedis.url });
  nativeRateLimitRedis.on("error", () => writeDependencyError("rate_limit_redis"));
  nativeStreamRedis.on("error", () => writeDependencyError("stream_redis"));
  postgres.on("error", () => writeDependencyError("postgres"));
  const rateLimitRedis = redisFacade(nativeRateLimitRedis);
  const streamRedis = redisFacade(nativeStreamRedis);
  const objectStorage = new S3Client({
    endpoint: config.objectStorage.endpoint,
    region: config.objectStorage.region,
    forcePathStyle: config.objectStorage.forcePathStyle,
    ...(config.objectStorage.credentials
      ? { credentials: config.objectStorage.credentials }
      : {}),
  });
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([
      rateLimitRedis.close(),
      streamRedis.close(),
      postgres.end(),
    ]);
    objectStorage.destroy();
  };

  try {
    const connections = await Promise.allSettled([
      nativeRateLimitRedis.connect(),
      nativeStreamRedis.connect(),
      postgres.query("SELECT 1"),
    ]);
    if (connections.some((result) => result.status === "rejected")) {
      throw new Error("A production dependency did not connect.");
    }
    const runtime = composeProductionRuntime(config, {
      postgres,
      rateLimitRedis,
      streamRedis,
      objectStorage,
      close,
    });
    await runtime.initialize();
    return runtime;
  } catch {
    await close();
    throw new Error("Production infrastructure initialization failed.");
  }
}

function writeDependencyError(dependency: string): void {
  process.stderr.write(`${JSON.stringify({
    event: "production_dependency_error",
    dependency,
  })}\n`);
}

function redisFacade(client: {
  sendCommand(command: string[]): Promise<unknown>;
  readonly isOpen: boolean;
  quit(): Promise<unknown>;
}): ProductionRedisClient {
  return {
    sendCommand(command) {
      return client.sendCommand(command);
    },
    async close() {
      if (client.isOpen) await client.quit();
    },
  };
}
