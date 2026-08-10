export type AccountStatus = "active" | "restricted" | "pending_deletion";

export interface Principal {
  accountId: string;
  sessionId: string;
  status: AccountStatus;
  scopes: ReadonlySet<string>;
}

export function hasScope(principal: Principal, scope: string): boolean {
  return principal.scopes.has(scope);
}
