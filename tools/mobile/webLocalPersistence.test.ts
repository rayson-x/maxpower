import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_LEDGER_SNAPSHOT } from "../../src/coach/ledger";
import {
  type AsyncLedgerSnapshotStore,
  WebIndexedDbCoachLedger,
  WebLocalStorageProductShellStateStore,
  type WebKeyValueStorage,
} from "../../src/mobile/runtime/WebLocalPersistence";
import { initialProductShellState } from "../../src/mobile/ui/productNavigation";

class MemoryStorage implements WebKeyValueStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota_exceeded");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class MemoryAsyncSnapshots implements AsyncLedgerSnapshotStore {
  readonly values = new Map<string, string>();
  failWrites = false;
  disposed = false;

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error("indexed_db_write_failed");
    this.values.set(key, value);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

test("浏览器页面状态独立持久化", async () => {
  const storage = new MemoryStorage();
  const shell = new WebLocalStorageProductShellStateStore(storage);
  const state = initialProductShellState("2026-08-13");
  await shell.save({ userId: "account-a", state });
  assert.deepEqual((await shell.restore({ userId: "account-a", fallbackDate: "2026-08-14" })).state, state);

});

test("IndexedDB 写入失败时回滚内存，不报告假成功", async () => {
  const snapshots = new MemoryAsyncSnapshots();
  const ledger = await WebIndexedDbCoachLedger.open({ accountId: "account-b", snapshots });
  snapshots.failWrites = true;
  await assert.rejects(() => ledger.replace({
    ...EMPTY_LEDGER_SNAPSHOT,
    workingMemory: [{
      id: "memory-2",
      userId: "account-b",
      kind: "preference",
      content: "不应留下",
      evidenceRefs: [],
      provenance: { actor: "user" },
      authority: "non_authoritative",
      confidence: 1,
      createdAt: "2026-08-13T08:00:00.000Z",
      updatedAt: "2026-08-13T08:00:00.000Z",
      version: 1,
      sensitivity: "normal",
      pinned: true,
    }],
  }), /indexed_db_write_failed/);
  assert.equal((await ledger.read()).workingMemory.length, 0);
});
