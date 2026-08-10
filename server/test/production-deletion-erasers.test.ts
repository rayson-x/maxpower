import assert from "node:assert/strict";
import test from "node:test";

import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
} from "@aws-sdk/client-s3";

import {
  PostgresPresignedUploadExpiryGuard,
  PostgresIdentityEraser,
  S3AccountMediaEraser,
} from "../src/runtime/production/deletion-erasers.js";

test("account media eraser removes every object version and delete marker under the private prefix", async () => {
  const commands: unknown[] = [];
  let page = 0;
  const eraser = new S3AccountMediaEraser({
    bucket: "private-media",
    client: {
      async send(command: unknown) {
        commands.push(command);
        if (command instanceof ListObjectVersionsCommand) {
          page += 1;
          return page === 1
            ? {
                Versions: [{ Key: "accounts/expected/a/file.mp4", VersionId: "v2" }],
                DeleteMarkers: [{ Key: "accounts/expected/a/file.mp4", VersionId: "v1" }],
                IsTruncated: true,
                NextKeyMarker: "accounts/expected/a/file.mp4",
                NextVersionIdMarker: "v1",
              }
            : { Versions: [], DeleteMarkers: [], IsTruncated: false };
        }
        if (command instanceof DeleteObjectsCommand) return { Errors: [] };
        throw new Error("unexpected command");
      },
    },
    accountPrefix(accountId) {
      assert.equal(accountId, "account_123");
      return "accounts/expected/";
    },
    guard: { async assertSafeToErase() {} },
  });

  await eraser.eraseAccountMedia("account_123");

  const listCommands = commands.filter((command) => command instanceof ListObjectVersionsCommand);
  const deleteCommand = commands.find((command) => command instanceof DeleteObjectsCommand);
  assert.equal(listCommands.length, 2);
  assert.deepEqual((listCommands[1] as ListObjectVersionsCommand).input, {
    Bucket: "private-media",
    Prefix: "accounts/expected/",
    KeyMarker: "accounts/expected/a/file.mp4",
    VersionIdMarker: "v1",
  });
  assert.deepEqual((deleteCommand as DeleteObjectsCommand).input.Delete?.Objects, [
    { Key: "accounts/expected/a/file.mp4", VersionId: "v2" },
    { Key: "accounts/expected/a/file.mp4", VersionId: "v1" },
  ]);
});

test("media erasure waits until every previously signed upload URL has expired", async () => {
  let ready = false;
  const guard = new PostgresPresignedUploadExpiryGuard({
    transferExpirySeconds: 900,
    pool: {
      async connect() {
        return {
          async query<Row = Record<string, unknown>>(sql: string, values?: unknown[]) {
            assert.match(sql, /MAX\(upload\.expires_at\)/);
            assert.match(sql, /GREATEST\(/);
            assert.match(sql, /deletion\.requested_at \+ \(\$2::integer \* interval '1 second'\)/);
            assert.deepEqual(values, ["account_123", 900]);
            return { rows: [{ ready }] as Row[] };
          },
          release() {},
        };
      },
    },
  });

  await assert.rejects(
    () => guard.assertSafeToErase("account_123"),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "presigned_uploads_live");
      return true;
    },
  );
  ready = true;
  await guard.assertSafeToErase("account_123");
});

test("identity eraser removes sessions/accounts before the user in one idempotent transaction", async () => {
  const operations: { sql: string; values?: unknown[] }[] = [];
  const eraser = new PostgresIdentityEraser({
    async connect() {
      return {
        async query<Row = Record<string, unknown>>(sql: string, values?: unknown[]) {
          operations.push(values === undefined ? { sql } : { sql, values });
          return { rows: [] as Row[] };
        },
        release() { operations.push({ sql: "release" }); },
      };
    },
  });

  await eraser.eraseIdentity("account_123");

  assert.deepEqual(operations.map((operation) => operation.sql), [
    "BEGIN",
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 91))",
    `DELETE FROM "verification" verification
        USING "user" identity_user
        WHERE identity_user.id = $1
          AND (
            verification.identifier = identity_user.email
            OR verification.identifier = COALESCE(identity_user."phoneNumber", '')
            OR CASE
              WHEN ltrim(verification.value) LIKE '{%'
              THEN (
                ltrim(verification.value)::jsonb ->> 'accountId' = identity_user.id
                OR ltrim(verification.value)::jsonb #>> '{identifier,value}' = identity_user.email
                OR ltrim(verification.value)::jsonb #>> '{identifier,value}' = COALESCE(identity_user."phoneNumber", '')
              )
              ELSE false
            END
          )`,
    "DELETE FROM \"session\" WHERE \"userId\" = $1",
    "DELETE FROM \"account\" WHERE \"userId\" = $1",
    "DELETE FROM \"user\" WHERE id = $1",
    "COMMIT",
    "release",
  ]);
  assert.deepEqual(operations.slice(1, 6).map((operation) => operation.values), [
    ["account_123"],
    ["account_123"],
    ["account_123"],
    ["account_123"],
    ["account_123"],
  ]);
});
