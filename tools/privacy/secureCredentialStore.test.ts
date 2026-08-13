import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySecureCredentialPort,
  SecureReplicaCredentialSource,
  type SecureCredentialPort,
} from "../../src/privacy";

const accountA = { accountId: "account-a", scope: "sync" as const, name: "replica_access" };
const accountB = { accountId: "account-b", scope: "sync" as const, name: "replica_access" };

function credentialContract(port: SecureCredentialPort): void {
  test("secure credential port 隔离账号、支持轮换和删除，且缺失不伪装为可用", async () => {
    await port.put({ key: accountA, value: "one" });
    assert.deepEqual(await port.get({ key: accountA }), { status: "available", value: "one" });
    assert.deepEqual(await port.get({ key: accountB }), { status: "missing_or_invalidated" });
    await port.rotate({ key: accountA, value: "two" });
    assert.deepEqual(await port.get({ key: accountA }), { status: "available", value: "two" });
    await port.delete({ key: accountA });
    assert.deepEqual(await port.get({ key: accountA }), { status: "missing_or_invalidated" });
  });
}

credentialContract(new InMemorySecureCredentialPort());

test("sync credential source 不接受跨账号或损坏 JSON，删除后 transport 只能看到 unavailable", async () => {
  const port = new InMemorySecureCredentialPort();
  const source = new SecureReplicaCredentialSource(port);
  await source.writeReplicaCredential({ accountId: "account-a", accessToken: "secret", expiresAt: "2026-12-01T00:00:00.000Z" });
  assert.equal((await source.readReplicaCredential({ accountId: "account-a" }))?.accessToken, "secret");
  assert.equal(await source.readReplicaCredential({ accountId: "account-b" }), null);
  await source.deleteReplicaCredential("account-a");
  assert.equal(await source.readReplicaCredential({ accountId: "account-a" }), null);
});
