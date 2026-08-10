import assert from "node:assert/strict";
import test from "node:test";

import { ApiError } from "../src/kernel/api-error.js";
import { parseExpectedRevision, revisionEtag } from "../src/kernel/revision.js";
import { optionalLimit } from "../src/http/request.js";

test("revision validators accept complete ETags and reject partial numeric input", () => {
  assert.equal(parseExpectedRevision("1"), 1);
  assert.equal(parseExpectedRevision('"12"'), 12);
  assert.equal(parseExpectedRevision('W/"7"'), 7);
  assert.equal(revisionEtag(12), '"12"');

  for (const invalid of ["1junk", '"1"junk', "0", "-1", "1.5", "*"]) {
    assert.throws(() => parseExpectedRevision(invalid), apiError("invalid_revision"));
  }
});

test("pagination limits reject partial numeric input", () => {
  assert.equal(optionalLimit(undefined), 50);
  assert.equal(optionalLimit("1"), 1);
  assert.equal(optionalLimit("100"), 100);
  for (const invalid of ["1junk", "0", "-1", "1.5", "101"]) {
    assert.throws(() => optionalLimit(invalid), apiError("invalid_limit"));
  }
});

function apiError(code: string): (error: unknown) => boolean {
  return (error) => error instanceof ApiError && error.code === code;
}
