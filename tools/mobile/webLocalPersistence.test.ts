import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_LEDGER_SNAPSHOT } from "../../src/coach/ledger";
import { LocalConfirmedProductBridge } from "../../src/mobile/product-data";
import {
  type AsyncLedgerSnapshotStore,
  WebIndexedDbCoachLedger,
  WebLocalStorageCoachLedger,
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

test("浏览器本地 Ledger 按账号持久化并能在新 runtime 回读", async () => {
  const storage = new MemoryStorage();
  const first = new WebLocalStorageCoachLedger("account-a", storage);
  await first.replace({
    ...EMPTY_LEDGER_SNAPSHOT,
    workingMemory: [{
      id: "memory-1",
      userId: "account-a",
      kind: "preference",
      content: "四分化，每周四天",
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
  });

  const reloaded = new WebLocalStorageCoachLedger("account-a", storage);
  assert.equal((await reloaded.read()).workingMemory[0]?.content, "四分化，每周四天");
  assert.equal((await new WebLocalStorageCoachLedger("account-b", storage).read()).workingMemory.length, 0);
});

test("浏览器持久化失败时回滚内存写入，不报告假成功", async () => {
  const storage = new MemoryStorage();
  const ledger = new WebLocalStorageCoachLedger("account-a", storage);
  storage.failWrites = true;
  await assert.rejects(() => ledger.replace({
    ...EMPTY_LEDGER_SNAPSHOT,
    workingMemory: [{
      id: "memory-1",
      userId: "account-a",
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
  }), /quota_exceeded/);
  assert.equal((await ledger.read()).workingMemory.length, 0);
});

test("浏览器页面状态独立持久化，Local confirmation bridge 不访问产品云接口", async () => {
  const storage = new MemoryStorage();
  const shell = new WebLocalStorageProductShellStateStore(storage);
  const state = initialProductShellState("2026-08-13");
  await shell.save({ userId: "account-a", state });
  assert.deepEqual((await shell.restore({ userId: "account-a", fallbackDate: "2026-08-14" })).state, state);

  const bridge = new LocalConfirmedProductBridge();
  let commits = 0;
  const profile = await bridge.patchProfileThen({
    patch: { locale: "zh-CN" },
    idempotencyKey: "profile",
    commitLocal: async () => ++commits,
  });
  const plan = await bridge.publishPlanThen({
    localPlanId: "plan-1",
    title: "本地计划",
    snapshot: {},
    idempotencyKey: "plan",
    commitLocal: async () => ++commits,
  });
  assert.deepEqual([profile, plan, commits], [1, 2, 2]);
});

test("IndexedDB Ledger 一次性迁移旧 localStorage，成功后才删除旧副本", async () => {
  const legacy = new MemoryStorage();
  const snapshots = new MemoryAsyncSnapshots();
  const oldLedger = new WebLocalStorageCoachLedger("account-a", legacy);
  await oldLedger.replace({
    ...EMPTY_LEDGER_SNAPSHOT,
    workingMemory: [{
      id: "memory-1",
      userId: "account-a",
      kind: "preference",
      content: "四分化",
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
  });

  const migrated = await WebIndexedDbCoachLedger.open({ accountId: "account-a", snapshots, legacyStorage: legacy });
  assert.equal((await migrated.read()).workingMemory[0]?.content, "四分化");
  assert.equal([...legacy.values.keys()].some((key) => key.includes(":ledger:")), false);
  assert.equal(snapshots.values.size, 1);

  const reloaded = await WebIndexedDbCoachLedger.open({ accountId: "account-a", snapshots, legacyStorage: legacy });
  assert.equal((await reloaded.read()).workingMemory[0]?.content, "四分化");
});

test("IndexedDB 写入失败时不删除旧账本，普通写入也回滚内存", async () => {
  const legacy = new MemoryStorage();
  legacy.setItem("maxpower:ledger:v1:account-a", JSON.stringify(EMPTY_LEDGER_SNAPSHOT));
  const failedMigration = new MemoryAsyncSnapshots();
  failedMigration.failWrites = true;
  await assert.rejects(
    () => WebIndexedDbCoachLedger.open({ accountId: "account-a", snapshots: failedMigration, legacyStorage: legacy }),
    /indexed_db_write_failed/,
  );
  assert.ok(legacy.getItem("maxpower:ledger:v1:account-a"));

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
