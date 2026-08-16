import assert from "node:assert/strict";
import test from "node:test";

import { LocalProductKernel } from "../../src/coach/LocalProductKernel";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import {
  ClientSidePortableBackupService,
  PortableDataService,
  WebCryptoBackupCryptoPort,
} from "../../src/privacy";

function fixture() {
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const runtime = {
    now: () => "2026-08-09T12:00:00.000+08:00",
    nextId: (prefix: string) => `${prefix}-${++sequence}`,
  };
  const crypto = new WebCryptoBackupCryptoPort();
  return {
    ledger,
    app: new LocalProductKernel({ ledger, runtime, backupCrypto: crypto }),
    backup: new ClientSidePortableBackupService(
      new PortableDataService(ledger, runtime),
      crypto,
    ),
  };
}

async function bootstrap(app: LocalProductKernel, userId: string) {
  await app.executeDomainCommand({
    type: "user.bootstrap",
    meta: {
      userId,
      actor: { kind: "user", id: userId },
      deviceId: "phone-1",
      occurredAt: "2026-08-09T12:00:00.000+08:00",
      timezoneOffsetMinutes: 480,
      idempotencyKey: `bootstrap-${userId}`,
    },
    profile: { id: `profile-${userId}`, locale: "zh-CN" },
    goalContract: { id: `goal-${userId}`, primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-09", endDate: "2026-12-09" } },
    mandate: { id: `mandate-${userId}`, mode: "collaborative", planChangeAuthorization: "always_ask" },
  });
}

test("client-side portable backup encrypts a structured bundle and verifies it before restore planning", async () => {
  const { app, backup } = fixture();
  await bootstrap(app, "u1");

  const archive = await backup.create({ userId: "u1", passphrase: "correct horse battery staple" });
  assert.equal(archive.manifest.encryption, "client_side");
  assert.equal(archive.manifest.kdf?.algorithm, "PBKDF2-SHA-256");
  assert.equal(archive.manifest.cipher?.algorithm, "AES-256-GCM");
  assert.doesNotMatch(archive.ciphertextBase64, /hypertrophy|beginner|profile-u1/);

  const bundle = await backup.open({ archive, passphrase: "correct horse battery staple" });
  assert.equal(bundle.manifest.userId, "u1");
  assert.equal(bundle.payload.domainEvents.length, 3);
});

test("client-side portable backup rejects a wrong passphrase and ciphertext tampering without yielding a bundle", async () => {
  const { app, backup } = fixture();
  await bootstrap(app, "u1");
  const archive = await backup.create({ userId: "u1", passphrase: "correct horse battery staple" });

  await assert.rejects(
    backup.open({ archive, passphrase: "not the right passphrase" }),
    /backup_decrypt_failed/,
  );
  const tampered = { ...archive, ciphertextBase64: `${archive.ciphertextBase64.slice(0, -2)}AA` };
  await assert.rejects(
    backup.open({ archive: tampered, passphrase: "correct horse battery staple" }),
    /backup_ciphertext_integrity_failed/,
  );
});

test("LocalProductKernel exposes encrypted backup lifecycle without placing key material in Action Log", async () => {
  const { app } = fixture();
  await bootstrap(app, "u1");
  const archive = await app.createClientSidePortableBackup({
    userId: "u1",
    passphrase: "correct horse battery staple",
  });
  assert.equal((await app.inspectClientSidePortableBackup({
    archive,
    passphrase: "correct horse battery staple",
  })).status, "ready");
  const action = (await app.listActionLog("u1")).find((event) => event.intent === "portable.backup.create");
  assert.deepEqual(action?.after, {
    structuredContentHash: archive.manifest.structuredContentHash,
    encryption: "client_side",
    kdf: "PBKDF2-SHA-256",
    cipher: "AES-256-GCM",
    mediaAvailability: "excluded",
  });
  assert.doesNotMatch(JSON.stringify(action), /correct horse|ciphertextBase64|saltBase64|ivBase64/);

  let restoreSequence = 0;
  const restored = new LocalProductKernel({
    ledger: new InMemoryCoachLedger(),
    runtime: {
      now: () => "2026-08-09T12:00:00.000+08:00",
      nextId: (prefix: string) => `restore-${prefix}-${++restoreSequence}`,
    },
    backupCrypto: new WebCryptoBackupCryptoPort(),
  });
  const plan = await restored.planClientSidePortableRestore({
    archive,
    passphrase: "correct horse battery staple",
    mode: "empty_profile",
  });
  assert.equal(plan.canRestore, true);
  await restored.restoreClientSidePortableBackup({
    archive,
    passphrase: "correct horse battery staple",
    mode: "empty_profile",
  });
  assert.equal((await restored.readDomainProjection({ userId: "u1" })).profile?.value.id, "profile-u1");
});
