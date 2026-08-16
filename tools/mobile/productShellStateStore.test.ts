import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  SQLiteProductShellStateStore,
  type ProductShellStateSqlDatabase,
} from "../../src/mobile/native/SQLiteProductShellStateStore";
import {
  attachCoachToProductShell,
  initialProductShellState,
  markProductFormOpen,
} from "../../src/mobile/ui/productNavigation";

class NodeSqliteDatabase implements ProductShellStateSqlDatabase {
  constructor(private readonly database: DatabaseSync) {}

  async execAsync(source: string): Promise<void> {
    this.database.exec(source);
  }

  async getFirstAsync<T>(source: string, ...params: readonly string[]): Promise<T | null> {
    return (this.database.prepare(source).get(...params) as T | undefined) ?? null;
  }

  async runAsync(source: string, ...params: readonly string[]): Promise<void> {
    this.database.prepare(source).run(...params);
  }
}

test("SQLite 壳状态按用户隔离，只恢复经过 schema 校验的对话引用", async () => {
  const database = new DatabaseSync(":memory:");
  const store = new SQLiteProductShellStateStore(new NodeSqliteDatabase(database));
  const state = attachCoachToProductShell(initialProductShellState("2026-08-09"), {
    sessionId: "conversation:9",
    foreground: "expanded",
  });

  await store.save({ userId: "user-a", state });

  assert.deepEqual(await store.restore({ userId: "user-a", fallbackDate: "2026-08-10" }), {
    state,
    formRecovery: { kind: "none" },
  });
  assert.deepEqual(await store.restore({ userId: "user-b", fallbackDate: "2026-08-10" }), {
    state: initialProductShellState("2026-08-10"),
    formRecovery: { kind: "none" },
  });
});

test("损坏或未知版本的快照 fail closed，且删除不影响其他本地用户", async () => {
  const database = new DatabaseSync(":memory:");
  const store = new SQLiteProductShellStateStore(new NodeSqliteDatabase(database));
  await store.save({ userId: "user-a", state: initialProductShellState("2026-08-09") });
  await store.save({ userId: "user-b", state: initialProductShellState("2026-08-08") });
  await database.prepare(
    "UPDATE maxpower_product_shell_state SET payload = ? WHERE user_id = ?",
  ).run('{"schemaVersion":99}', "user-a");

  assert.deepEqual(await store.restore({ userId: "user-a", fallbackDate: "2026-08-10" }), {
    state: initialProductShellState("2026-08-10"),
    formRecovery: { kind: "none" },
  });
  await store.clear({ userId: "user-a" });
  assert.deepEqual((await store.restore({ userId: "user-b", fallbackDate: "2026-08-10" })).state, initialProductShellState("2026-08-08"));
});

test("普通未提交表单保存后，在恢复时只报告丢弃而不保存输入内容", async () => {
  const database = new DatabaseSync(":memory:");
  const store = new SQLiteProductShellStateStore(new NodeSqliteDatabase(database));
  await store.save({
    userId: "user-a",
    state: markProductFormOpen(initialProductShellState("2026-08-09"), {
      kind: "activity_log",
      recovery: "discard_on_process_restore",
    }),
  });

  const recovered = await store.restore({ userId: "user-a", fallbackDate: "2026-08-10" });
  assert.deepEqual(recovered.state, initialProductShellState("2026-08-09"));
  assert.deepEqual(recovered.formRecovery, { kind: "discarded", formKind: "activity_log" });
});
