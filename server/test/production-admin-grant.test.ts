import assert from "node:assert/strict";
import test from "node:test";

import { parseAdminGrantArguments } from "../src/runtime/production/admin-grant.js";

test("admin grant CLI accepts one account, positive credit amount, and operational reference", () => {
  assert.deepEqual(
    parseAdminGrantArguments(["account_123", "900", "support-case-456"]),
    { accountId: "account_123", credits: 900, sourceRef: "support-case-456" },
  );
  assert.throws(() => parseAdminGrantArguments(["account_123", "0", "case"]), /credits/i);
  assert.throws(() => parseAdminGrantArguments(["account_123", "900"]), /usage/i);
  assert.throws(
    () => parseAdminGrantArguments(["account_123", "900", "free form reason"]),
    /source/i,
  );
});
