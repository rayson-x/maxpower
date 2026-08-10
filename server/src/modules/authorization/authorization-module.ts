import { forbidden } from "../../kernel/api-error.js";
import { hasScope, type AccountStatus, type Principal } from "../../kernel/principal.js";

export interface AuthorizationRequirement {
  scope: string;
  /** Defaults to active-only. Callers must opt in to any restricted status. */
  allowedStatuses?: readonly AccountStatus[];
}

/** A single, policy-focused interface for account status and token scope checks. */
export interface AuthorizationModule {
  authorize(principal: Principal, requirement: AuthorizationRequirement): Principal;
}

export class DefaultAuthorizationModule implements AuthorizationModule {
  authorize(principal: Principal, requirement: AuthorizationRequirement): Principal {
    const allowedStatuses = requirement.allowedStatuses ?? ["active"];
    if (!allowedStatuses.includes(principal.status)) {
      throw forbidden("account_unavailable", "The account is not available for this action.");
    }
    if (!requirement.scope.trim() || !hasScope(principal, requirement.scope)) {
      throw forbidden("missing_scope", "The access token cannot perform this action.");
    }
    return principal;
  }
}
