import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { WebCryptoBackupCryptoPort } from "../../src/privacy";

function fixture(options: {
  authenticatedAccountId?: string;
  backup?: boolean;
} = {}) {
  let sequence = 0;
  const app = new LocalProductKernel({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-09T12:00:00.000+08:00",
      nextId: (prefix) => `${prefix}-${++sequence}`,
    },
    authenticatedAccountId: options.authenticatedAccountId ?? "u1",
    ...(options.backup ? { backupCrypto: new WebCryptoBackupCryptoPort() } : {}),
  });
  return app;
}

async function bootstrapPermissions(app: LocalProductKernel, input: {
  remoteLlm?: "not_configured" | "denied" | "granted";
}) {
  const meta = {
    userId: "u1",
    actor: { kind: "user" as const, id: "u1" },
    deviceId: "phone-1",
    occurredAt: "2026-08-09T12:00:00.000+08:00",
    timezoneOffsetMinutes: 480,
  };
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: { ...meta, idempotencyKey: "bootstrap" },
    profile: { id: "profile-1", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-09", endDate: "2026-12-09" } },
    mandate: { id: "mandate-1", mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
  await app.executeDomainCommand({
    type: "permission_set.revise",
    meta: { ...meta, idempotencyKey: "permissions" },
    permissionSetId: "permissions-1",
    expectedRevision: 0,
    permissionSet: {
      id: "permissions-1",
      camera: "not_configured",
      health: "not_configured",
      notifications: "not_configured",
      remoteLlm: input.remoteLlm ?? "not_configured",
    },
    authorization: { kind: "local_user_presence", verifiedAt: meta.occurredAt, nonce: "settings" },
  });
}

test("隐私设置概览反映 AuthRoot 已认证账号，不暴露产品内容", async () => {
  const app = fixture();
  await bootstrapPermissions(app, { remoteLlm: "denied" });

  const overview = await app.readPrivacySettingsOverview({ userId: "u1" });

  assert.deepEqual(overview.account, { availability: "available", state: "authenticated" });
  assert.equal(overview.remoteModel.authorization, "denied");
  assert.equal(overview.remoteModel.consent.status, "not_active");
  assert.equal(JSON.stringify(overview).includes("contentHash"), false);
});

test("隐私设置概览仅披露已授权远程模型的语义范围，隐藏账号标识", async () => {
  const app = fixture();
  await bootstrapPermissions(app, { remoteLlm: "not_configured" });
  await app.updatePermissionFromSettings({
    userId: "u1",
    expectedRevision: 1,
    changes: { remoteLlm: "granted" },
    authorization: { kind: "local_user_presence", verifiedAt: "2026-08-09T12:00:00.000+08:00", nonce: "remote-consent" },
    idempotencyKey: "remote-consent",
  });

  const overview = await app.readPrivacySettingsOverview({ userId: "u1" });

  assert.deepEqual(overview.account, { availability: "available", state: "authenticated" });
  assert.deepEqual(overview.remoteModel, {
    authorization: "granted",
    configuration: { status: "managed_cloud", service: "MaxPower Cloud" },
    consent: {
      status: "active",
      ref: "permission:permissions-1:2",
      grantedAt: "2026-08-09T12:00:00.000+08:00",
      includedCategories: ["身体", "训练表现", "饮食", "恢复与睡眠", "Timeline 经历"],
      removedDirectIdentityFields: ["姓名", "地址", "联系方式", "精确位置", "外部账号标识"],
    },
  });
  assert.equal(JSON.stringify(overview).includes("u1"), false);
});

test("设置概览仍保留已认证账号上下文", async () => {
  const app = fixture();
  await bootstrapPermissions(app, {});

  const overview = await app.readPrivacySettingsOverview({ userId: "u1" });

  assert.deepEqual(overview.account, { availability: "available", state: "authenticated" });
});

test("设置概览拒绝跨越 AuthRoot 的账号 namespace", async () => {
  const app = fixture({ authenticatedAccountId: "u1" });

  await assert.rejects(
    () => app.readPrivacySettingsOverview({ userId: "u2" }),
    /privacy_account_context_mismatch/,
  );
});

test("隐私设置明确披露可用的本机加密结构化备份", async () => {
  const app = fixture({ backup: true });
  await bootstrapPermissions(app, {});

  const overview = await app.readPrivacySettingsOverview({ userId: "u1" });

  assert.deepEqual(overview.backup, {
    capability: "available",
    encryption: "client_side",
    content: "structured_data_only",
  });
});

test("缺少设备加密能力时，设置不会把已注入的备份 Adapter 误报为可用", async () => {
  let unavailableSequence = 0;
  const unavailableCrypto = {
    async getAvailability() { return "unavailable" as const; },
    async randomBytes() { throw new Error("crypto unavailable"); },
    async deriveAes256Key() { throw new Error("crypto unavailable"); },
    async encryptAesGcm() { throw new Error("crypto unavailable"); },
    async decryptAesGcm() { throw new Error("crypto unavailable"); },
    async sha256() { throw new Error("crypto unavailable"); },
  };
  const app = new LocalProductKernel({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-09T12:00:00.000+08:00",
      nextId: (prefix) => `unavailable-${prefix}-${++unavailableSequence}`,
    },
    authenticatedAccountId: "u1",
    backupCrypto: unavailableCrypto,
  });
  await bootstrapPermissions(app, {});

  const overview = await app.readPrivacySettingsOverview({ userId: "u1" });
  assert.equal(overview.backup.capability, "unavailable");
  await assert.rejects(
    () => app.createClientSidePortableBackup({ userId: "u1", passphrase: "correct-horse-battery-staple" }),
    /client_side_backup_crypto_unavailable/,
  );
});
