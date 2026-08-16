import { Hono } from "hono";

import { ApiError } from "./kernel/api-error.js";
import type { IdentityModule, SocialAuthFlow } from "./modules/identity/model.js";
import type { LlmGatewayModule } from "./modules/llm/model.js";
import type { AccountDeletion } from "./modules/account-deletion/model.js";
import type { AccessTokenVerifier } from "./http/authenticate.js";
import { renderError } from "./http/response.js";
import { createIdentityRoutes } from "./http/routes/identity.js";
import { createLlmRoutes } from "./http/routes/llm.js";
import { createAccountDeletionRoutes } from "./http/routes/account-deletion.js";
import { openApiDocument } from "./openapi.js";
import {
  createSecurityMiddleware,
  type HttpSecurityOptions,
} from "./http/security.js";
import {
  createRequestLoggerMiddleware,
  type HttpRequestLogger,
} from "./http/request-logger.js";

export interface AppDependencies {
  identity: IdentityModule;
  socialAuth?: SocialAuthFlow;
  tokens: AccessTokenVerifier;
  llm: LlmGatewayModule;
  accountDeletion: AccountDeletion;
  localDebugOtp?: string;
}

export interface AppOptions {
  security?: HttpSecurityOptions;
  readiness?: () => Promise<boolean>;
  logger?: HttpRequestLogger;
}

export function createApp(dependencies: AppDependencies, options: AppOptions = {}): Hono {
  const app = new Hono();

  app.onError((error, context) => renderError(context, error));
  app.notFound((context) =>
    renderError(context, new ApiError(404, "route_not_found", "The route was not found.")),
  );

  if (options.logger !== undefined) {
    app.use("*", createRequestLoggerMiddleware(options.logger));
  }
  if (options.security !== undefined) {
    app.use("*", createSecurityMiddleware(options.security));
  }

  app.get("/healthz", (context) => context.json({ status: "ok" }));
  app.get("/readyz", async (context) => {
    const ready = await (options.readiness?.() ?? Promise.resolve(true));
    return ready
      ? context.json({ status: "ready" })
      : context.json({ status: "not_ready" }, 503);
  });
  app.get("/openapi.json", (context) => context.json(openApiDocument));

  app.route(
    "/v1",
    createIdentityRoutes({
      identity: dependencies.identity,
      ...(dependencies.socialAuth === undefined ? {} : { socialAuth: dependencies.socialAuth }),
      ...(dependencies.localDebugOtp === undefined
        ? {}
        : { localDebugOtp: dependencies.localDebugOtp }),
    }),
  );
  app.route(
    "/v1",
    createLlmRoutes({
      tokens: dependencies.tokens,
      llm: dependencies.llm,
    }),
  );
  app.route(
    "/v1",
    createAccountDeletionRoutes({
      tokens: dependencies.tokens,
      accountDeletion: dependencies.accountDeletion,
      llm: dependencies.llm,
    }),
  );

  return app;
}
