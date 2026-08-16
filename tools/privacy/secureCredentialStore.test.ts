import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySecureCredentialPort,
  type SecureCredentialPort,
} from "../../src/privacy";

const accountA = { accountId: "account-a", scope: "remote_llm" as const, name: "access_token" };
const accountB = { accountId: "account-b", scope: "remote_llm" as const, name: "access_token" };

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
