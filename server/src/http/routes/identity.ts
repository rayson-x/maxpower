import { Hono } from "hono";
import { z } from "zod";

import { ApiError } from "../../kernel/api-error.js";
import type { IdentityModule, SocialAuthFlow } from "../../modules/identity/model.js";
import { readJson } from "../request.js";

const identifierSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("email"), value: z.email().max(320) }).strict(),
  z
    .object({ kind: z.literal("phone"), value: z.string().regex(/^\+[1-9]\d{6,14}$/) })
    .strict(),
]);

const startOtpSchema = z.object({ identifier: identifierSchema }).strict();
const verifyOtpSchema = z
  .object({
    challengeId: z.string().min(1),
    code: z.string().regex(/^\d{4,10}$/),
  })
  .strict();
const completeRegistrationSchema = z
  .object({
    registrationId: z.string().min(1),
    displayName: z.string().trim().min(1).max(80),
    password: z.string().min(8).max(256),
    termsVersion: z.string().trim().min(1).max(100),
  })
  .strict();
const passwordLoginSchema = z
  .object({
    identifier: identifierSchema,
    password: z.string().min(1).max(256),
  })
  .strict();
const refreshSessionSchema = z
  .object({ sessionToken: z.string().min(1).max(2048) })
  .strict();
const signOutSessionSchema = refreshSessionSchema;
const socialOnboardingSchema = z
  .object({
    sessionToken: z.string().min(1).max(2048),
    displayName: z.string().trim().min(1).max(80),
    termsVersion: z.string().trim().min(1).max(100),
  })
  .strict();
const deviceBindingSchema = z.string().regex(/^[a-f0-9]{64}$/i);
const opaqueSocialValueSchema = z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/);
const socialStartSchema = z
  .object({
    provider: z.enum(["google", "apple"]),
    callbackUrl: z.string().min(1).max(512),
    deviceBinding: deviceBindingSchema,
  })
  .strict();
const socialExchangeSchema = z
  .object({
    code: opaqueSocialValueSchema,
    state: opaqueSocialValueSchema,
    callbackUrl: z.string().min(1).max(512),
    deviceBinding: deviceBindingSchema,
  })
  .strict();

export interface IdentityRouteDependencies {
  identity: IdentityModule;
  socialAuth?: SocialAuthFlow;
  /** Must only be set by the explicitly selected memory runtime. */
  localDebugOtp?: string;
}

export function createIdentityRoutes(dependencies: IdentityRouteDependencies): Hono {
  const routes = new Hono();

  routes.get("/auth/config", async (context) =>
    context.json(await dependencies.identity.getPublicConfiguration()),
  );

  routes.post("/auth/register/otp/start", async (context) => {
    const body = await readJson(context, startOtpSchema);
    const challenge = await dependencies.identity.startRegistrationOtp(body);
    return context.json(withLocalDebugOtp(challenge, dependencies.localDebugOtp), 202);
  });

  routes.post("/auth/register/otp/verify", async (context) => {
    const body = await readJson(context, verifyOtpSchema);
    return context.json(await dependencies.identity.verifyRegistrationOtp(body));
  });

  routes.post("/auth/register/complete", async (context) => {
    const body = await readJson(context, completeRegistrationSchema);
    return context.json(await dependencies.identity.completeRegistration(body), 201);
  });

  routes.post("/auth/login/otp/start", async (context) => {
    const body = await readJson(context, startOtpSchema);
    const challenge = await dependencies.identity.startLoginOtp(body);
    return context.json(withLocalDebugOtp(challenge, dependencies.localDebugOtp), 202);
  });

  routes.post("/auth/login/otp/verify", async (context) => {
    const body = await readJson(context, verifyOtpSchema);
    return context.json(await dependencies.identity.verifyLoginOtp(body));
  });

  routes.post("/auth/login/password", async (context) => {
    const body = await readJson(context, passwordLoginSchema);
    return context.json(await dependencies.identity.loginWithPassword(body));
  });

  routes.post("/auth/social/start", async (context) => {
    const body = await readJson(context, socialStartSchema);
    return context.json(await requiredSocialAuth(dependencies).start(body));
  });

  routes.post("/auth/social/exchange", async (context) => {
    const body = await readJson(context, socialExchangeSchema);
    return context.json(await requiredSocialAuth(dependencies).exchange(body));
  });

  routes.get("/auth/social/handoff", (context) =>
    requiredSocialAuth(dependencies).handleBrowserHandoff(context.req.raw),
  );

  routes.get("/auth/social/error", (context) =>
    requiredSocialAuth(dependencies).handleBrowserError(context.req.raw),
  );

  routes.post("/auth/refresh", async (context) => {
    const body = await readJson(context, refreshSessionSchema);
    return context.json(await dependencies.identity.refreshSession(body.sessionToken));
  });

  routes.post("/auth/social/complete", async (context) => {
    const body = await readJson(context, socialOnboardingSchema);
    return context.json(await dependencies.identity.completeSocialOnboarding(body), 201);
  });

  routes.get("/auth/session", async (context) => {
    const token = bearerToken(context.req.header("authorization"));
    const principal = await dependencies.identity.verifyAccessToken(token);
    return context.json({
      accountId: principal.accountId,
      sessionId: principal.sessionId,
      status: principal.status,
      scopes: [...principal.scopes].sort(),
    });
  });

  routes.post("/auth/logout", async (context) => {
    const body = await readJson(context, signOutSessionSchema);
    await dependencies.identity.signOutSession(body.sessionToken);
    return context.body(null, 204);
  });

  return routes;
}

function requiredSocialAuth(dependencies: IdentityRouteDependencies): SocialAuthFlow {
  if (!dependencies.socialAuth) {
    throw new ApiError(503, "social_auth_unavailable", "Social sign-in is unavailable.");
  }
  return dependencies.socialAuth;
}

function bearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new ApiError(401, "invalid_access_token", "A valid access token is required.");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new ApiError(401, "invalid_access_token", "A valid access token is required.");
  }
  return token;
}

function withLocalDebugOtp<T extends object>(value: T, debugOtp: string | undefined): T & {
  debugOtp?: string;
} {
  return debugOtp === undefined ? value : { ...value, debugOtp };
}
