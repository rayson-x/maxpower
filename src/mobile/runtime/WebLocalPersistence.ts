import type {
  AtomicCommit,
  AtomicCommitResult,
  CoachLedger,
  CoachLedgerDiagnostics,
  DomainAtomicCommit,
  StagedLedgerRestore,
} from "../../coach/ledger";
import { EMPTY_LEDGER_SNAPSHOT, InMemoryCoachLedger } from "../../coach/ledger";
import type { DomainCommandResult, DomainProjection, DomainProjectionQuery } from "../../coach/domain";
import type { LedgerSnapshot } from "../../coach/model";
import {
  assertProductShellStateStoreUserId,
  type ProductShellStateStore,
  type ProductShellStateRestoreRequest,
  type ProductShellStateSaveRequest,
  type ProductShellStateClearRequest,
} from "../ui/ProductShellStateStore";
import { encodeProductShellState, resolveProductShellRecovery, type ProductShellRecovery } from "../ui/productNavigation";

export interface WebKeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AsyncLedgerSnapshotStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  dispose(): Promise<void>;
}

/**
 * Durable Ledger used by the browser runtime. IndexedDB owns the large fact
 * snapshot; localStorage is consulted only once to migrate the previous MVP.
 */
export class WebIndexedDbCoachLedger implements CoachLedger {
  private readonly delegate: InMemoryCoachLedger;
  private mutationTail: Promise<void> = Promise.resolve();

  private constructor(
    private readonly key: string,
    private readonly snapshots: AsyncLedgerSnapshotStore,
    seed: LedgerSnapshot,
  ) {
    this.delegate = new InMemoryCoachLedger(seed);
  }

  static async open(input: {
    accountId: string;
    snapshots: AsyncLedgerSnapshotStore;
    legacyStorage?: WebKeyValueStorage;
  }): Promise<WebIndexedDbCoachLedger> {
    assertProductShellStateStoreUserId(input.accountId);
    const key = indexedDbLedgerKey(input.accountId);
    let serialized = await input.snapshots.read(key);
    if (!serialized && input.legacyStorage) {
      const legacyKey = storageKey("ledger", input.accountId);
      const legacy = input.legacyStorage.getItem(legacyKey);
      if (legacy && parseSnapshot(legacy)) {
        // The old copy is removed only after IndexedDB has committed it.
        await input.snapshots.write(key, legacy);
        input.legacyStorage.removeItem(legacyKey);
        serialized = legacy;
      }
    }
    return new WebIndexedDbCoachLedger(
      key,
      input.snapshots,
      serialized ? parseSnapshot(serialized) ?? EMPTY_LEDGER_SNAPSHOT : EMPTY_LEDGER_SNAPSHOT,
    );
  }

  async read(): Promise<LedgerSnapshot> {
    await this.mutationTail;
    return this.delegate.read();
  }

  replace(snapshot: LedgerSnapshot): Promise<void> {
    return this.mutate(async () => {
      const before = await this.delegate.read();
      try {
        await this.delegate.replace(snapshot);
        await this.persist();
      } catch (cause) {
        await this.delegate.replace(before);
        throw cause;
      }
    });
  }

  swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void> {
    return this.mutate(async () => {
      const before = await this.delegate.read();
      try {
        await this.delegate.swapRestoredSnapshot(input);
        await this.persist();
      } catch (cause) {
        await this.delegate.replace(before);
        throw cause;
      }
    });
  }

  async readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection> {
    await this.mutationTail;
    return this.delegate.readDomainProjection(query);
  }

  async diagnose(): Promise<CoachLedgerDiagnostics> {
    await this.mutationTail;
    return this.delegate.diagnose();
  }

  commit(input: AtomicCommit): Promise<AtomicCommitResult>;
  commit(input: DomainAtomicCommit): Promise<DomainCommandResult>;
  commit(input: AtomicCommit | DomainAtomicCommit): Promise<AtomicCommitResult | DomainCommandResult> {
    return this.mutate(async () => {
      const before = await this.delegate.read();
      try {
        const result = "kind" in input && input.kind === "domain"
          ? await this.delegate.commit(input)
          : await this.delegate.commit(input as AtomicCommit);
        await this.persist();
        return result;
      } catch (cause) {
        await this.delegate.replace(before);
        throw cause;
      }
    });
  }

  async dispose(): Promise<void> {
    await this.mutationTail;
    await this.snapshots.dispose();
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationTail.then(operation, operation);
    this.mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async persist(): Promise<void> {
    await this.snapshots.write(this.key, JSON.stringify(await this.delegate.read()));
  }
}

export async function openWebMaxPowerPersistence(accountId: string): Promise<{
  ledger: CoachLedger;
  productShellStateStore: ProductShellStateStore;
  dispose(): Promise<void>;
}> {
  const legacyStorage = browserStorage();
  const snapshots = await BrowserIndexedDbSnapshotStore.open();
  try {
    const ledger = await WebIndexedDbCoachLedger.open({ accountId, snapshots, legacyStorage });
    return {
      ledger,
      productShellStateStore: new WebLocalStorageProductShellStateStore(legacyStorage),
      dispose: () => ledger.dispose(),
    };
  } catch (cause) {
    await snapshots.dispose();
    throw cause;
  }
}

class BrowserIndexedDbSnapshotStore implements AsyncLedgerSnapshotStore {
  private constructor(private readonly database: IDBDatabase) {}

  static open(): Promise<BrowserIndexedDbSnapshotStore> {
    if (typeof globalThis.indexedDB === "undefined") {
      return Promise.reject(new Error("web_indexed_db_unavailable"));
    }
    return new Promise((resolve, reject) => {
      // Dedicated name avoids colliding with older experimental local DBs
      // whose version 1 may not contain the canonical Ledger store.
      const request = globalThis.indexedDB.open("maxpower-coach-ledger-v1", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("coach-ledger")) {
          request.result.createObjectStore("coach-ledger");
        }
      };
      request.onsuccess = () => resolve(new BrowserIndexedDbSnapshotStore(request.result));
      request.onerror = () => reject(request.error ?? new Error("web_indexed_db_open_failed"));
      request.onblocked = () => reject(new Error("web_indexed_db_open_blocked"));
    });
  }

  read(key: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction("coach-ledger", "readonly");
      const request = transaction.objectStore("coach-ledger").get(key);
      request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error("web_indexed_db_read_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("web_indexed_db_read_aborted"));
    });
  }

  write(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction("coach-ledger", "readwrite");
      transaction.objectStore("coach-ledger").put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("web_indexed_db_write_failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("web_indexed_db_write_aborted"));
    });
  }

  async dispose(): Promise<void> {
    this.database.close();
  }
}

/** Account-isolated durable Ledger for the browser MVP. */
export class WebLocalStorageCoachLedger implements CoachLedger {
  private readonly delegate: InMemoryCoachLedger;
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly key: string;

  constructor(accountId: string, private readonly storage: WebKeyValueStorage = browserStorage()) {
    this.key = storageKey("ledger", accountId);
    this.delegate = new InMemoryCoachLedger(readSnapshot(storage, this.key));
  }

  async read(): Promise<LedgerSnapshot> {
    await this.mutationTail;
    return this.delegate.read();
  }

  replace(snapshot: LedgerSnapshot): Promise<void> {
    return this.mutate(async () => {
      const before = await this.delegate.read();
      try {
        await this.delegate.replace(snapshot);
        await this.persist();
      } catch (cause) {
        await this.delegate.replace(before);
        throw cause;
      }
    });
  }

  swapRestoredSnapshot(input: StagedLedgerRestore): Promise<void> {
    return this.mutate(async () => {
      const before = await this.delegate.read();
      try {
        await this.delegate.swapRestoredSnapshot(input);
        await this.persist();
      } catch (cause) {
        await this.delegate.replace(before);
        throw cause;
      }
    });
  }

  async readDomainProjection(query: DomainProjectionQuery): Promise<DomainProjection> {
    await this.mutationTail;
    return this.delegate.readDomainProjection(query);
  }

  async diagnose(): Promise<CoachLedgerDiagnostics> {
    await this.mutationTail;
    return this.delegate.diagnose();
  }

  commit(input: AtomicCommit): Promise<AtomicCommitResult>;
  commit(input: DomainAtomicCommit): Promise<DomainCommandResult>;
  commit(input: AtomicCommit | DomainAtomicCommit): Promise<AtomicCommitResult | DomainCommandResult> {
    return this.mutate(async () => {
      const before = await this.delegate.read();
      try {
        const result = "kind" in input && input.kind === "domain"
          ? await this.delegate.commit(input)
          : await this.delegate.commit(input as AtomicCommit);
        await this.persist();
        return result;
      } catch (cause) {
        await this.delegate.replace(before);
        throw cause;
      }
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.mutationTail.then(operation, operation);
    this.mutationTail = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async persist(): Promise<void> {
    this.storage.setItem(this.key, JSON.stringify(await this.delegate.read()));
  }
}

/** Browser presentation state is durable but remains separate from facts. */
export class WebLocalStorageProductShellStateStore implements ProductShellStateStore {
  constructor(private readonly storage: WebKeyValueStorage = browserStorage()) {}

  async restore(input: ProductShellStateRestoreRequest): Promise<ProductShellRecovery> {
    assertProductShellStateStoreUserId(input.userId);
    return resolveProductShellRecovery(this.storage.getItem(storageKey("shell", input.userId)) ?? undefined, input.fallbackDate);
  }

  async save(input: ProductShellStateSaveRequest): Promise<void> {
    assertProductShellStateStoreUserId(input.userId);
    this.storage.setItem(storageKey("shell", input.userId), encodeProductShellState(input.state));
  }

  async clear(input: ProductShellStateClearRequest): Promise<void> {
    assertProductShellStateStoreUserId(input.userId);
    this.storage.removeItem(storageKey("shell", input.userId));
  }
}

function readSnapshot(storage: WebKeyValueStorage, key: string): LedgerSnapshot {
  const value = storage.getItem(key);
  if (!value) return EMPTY_LEDGER_SNAPSHOT;
  return parseSnapshot(value) ?? EMPTY_LEDGER_SNAPSHOT;
}

function parseSnapshot(value: string): LedgerSnapshot | undefined {
  try {
    const parsed = JSON.parse(value) as LedgerSnapshot;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function storageKey(kind: "ledger" | "shell", accountId: string): string {
  assertProductShellStateStoreUserId(accountId);
  return `maxpower:${kind}:v1:${encodeURIComponent(accountId)}`;
}

function indexedDbLedgerKey(accountId: string): string {
  return `ledger:v1:${encodeURIComponent(accountId)}`;
}

function browserStorage(): WebKeyValueStorage {
  if (typeof globalThis.localStorage === "undefined") throw new Error("web_local_storage_unavailable");
  return globalThis.localStorage;
}
