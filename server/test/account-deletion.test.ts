import assert from "node:assert/strict";
import test from "node:test";

import type { Principal } from "../src/kernel/principal.js";
import {
  AccountDeletionModule,
  InMemoryAccountDeletionAdapter,
} from "../src/modules/account-deletion/index.js";

const principal: Principal = {
  accountId: "account-delete-me",
  sessionId: "session-delete-me",
  status: "active",
  scopes: new Set(["account:delete"]),
};

test("account deletion stops service immediately and completes every owned cleanup step", async () => {
  const adapter = new InMemoryAccountDeletionAdapter();
  adapter.seedAccount(principal.accountId, {
    sessions: 3,
    productResources: 12,
    mediaObjects: 4,
    entitlementEnabled: true,
    identityExists: true,
  });
  const deletion = new AccountDeletionModule({ adapter });

  const requestKey = "a".repeat(64);
  const requested = await deletion.request(principal, {
    idempotencyKey: requestKey,
    confirmation: "DELETE",
  });
  assert.equal(requested.status, "pending");
  assert.notEqual(requested.deletionReceipt, requestKey);
  assert.equal(adapter.canUseService(principal.accountId), false);

  await deletion.processNext();

  const completed = await deletion.get(principal);
  assert.equal(completed.status, "completed");
  assert.equal((await deletion.getByReceipt(requested.deletionReceipt)).id, completed.id);
  await assert.rejects(() => deletion.getByReceipt(requestKey), /not found/i);
  assert.equal((await deletion.getByRequestKey(requestKey)).id, completed.id);
  assert.deepEqual(adapter.inspectAccount(principal.accountId), {
    sessions: 0,
    productResources: 0,
    mediaObjects: 0,
    entitlementEnabled: false,
    identityExists: false,
  });
});

test("account deletion request is idempotent and retryable after a cleanup failure", async () => {
  const adapter = new InMemoryAccountDeletionAdapter();
  adapter.seedAccount(principal.accountId, {
    sessions: 1,
    productResources: 1,
    mediaObjects: 1,
    entitlementEnabled: true,
    identityExists: true,
  });
  adapter.failNextCleanup();
  const deletion = new AccountDeletionModule({ adapter });

  const requestKey = "b".repeat(64);
  const first = await deletion.request(principal, {
    idempotencyKey: requestKey,
    confirmation: "DELETE",
  });
  const replay = await deletion.request(principal, {
    idempotencyKey: requestKey,
    confirmation: "DELETE",
  });
  assert.equal(replay.id, first.id);

  await assert.rejects(() => deletion.processNext(), /simulated cleanup failure/i);
  assert.equal((await deletion.get(principal)).status, "retryable");

  await deletion.processNext();
  assert.equal((await deletion.get(principal)).status, "completed");
});
