import {
  encodeProductShellState,
  resolveProductShellRecovery,
  type ProductShellRecovery,
  type ProductShellState,
} from "./productNavigation";

/**
 * Owns only presentation state that is explicitly safe to restore. This port
 * never sees Timeline facts, plan payloads, draft field values, ActionTokens,
 * or provider data.
 */
export interface ProductShellStateStore {
  restore(input: ProductShellStateRestoreRequest): Promise<ProductShellRecovery>;
  save(input: ProductShellStateSaveRequest): Promise<void>;
  clear(input: ProductShellStateClearRequest): Promise<void>;
}

export interface ProductShellStateRestoreRequest {
  userId: string;
  fallbackDate: string;
}

export interface ProductShellStateSaveRequest {
  userId: string;
  state: ProductShellState;
}

export interface ProductShellStateClearRequest {
  userId: string;
}

/** Fixture/test adapter; production mobile composition injects SQLite. */
export class InMemoryProductShellStateStore implements ProductShellStateStore {
  private readonly payloadByUser = new Map<string, string>();

  async restore(input: ProductShellStateRestoreRequest): Promise<ProductShellRecovery> {
    assertUserId(input.userId);
    return resolveProductShellRecovery(this.payloadByUser.get(input.userId), input.fallbackDate);
  }

  async save(input: ProductShellStateSaveRequest): Promise<void> {
    assertUserId(input.userId);
    this.payloadByUser.set(input.userId, encodeProductShellState(input.state));
  }

  async clear(input: ProductShellStateClearRequest): Promise<void> {
    assertUserId(input.userId);
    this.payloadByUser.delete(input.userId);
  }
}

/** Shared validation keeps each storage adapter from accepting an unsafe key. */
export function assertProductShellStateStoreUserId(userId: string): void {
  assertUserId(userId);
}

function assertUserId(userId: string): void {
  if (!userId || userId.length > 512 || userId.includes("\u0000")) {
    throw new Error("Product shell state requires a valid local user identifier.");
  }
}
