import type { Context } from "hono";

import { forbidden, unauthorized } from "../kernel/api-error.js";
import { hasScope, type Principal } from "../kernel/principal.js";

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<Principal>;
}

export async function authenticate(
  context: Context,
  verifier: AccessTokenVerifier,
): Promise<Principal> {
  const authorization = context.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw unauthorized();
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw unauthorized();
  }
  return verifier.verifyAccessToken(token);
}

export function requireCapability(principal: Principal, scope: string): void {
  if (principal.status !== "active") {
    throw forbidden("account_unavailable", "The account is not active.");
  }
  if (!hasScope(principal, scope)) {
    throw forbidden("missing_scope", "The access token cannot perform this action.");
  }
}
