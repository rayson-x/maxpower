import assert from "node:assert/strict";
import test from "node:test";

import { FunctionLLMProvider } from "../../src/coach/adapters/provider";
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";

function fixture() {
  let sequence = 0;
  const requests: unknown[] = [];
  const provider = new FunctionLLMProvider(async (request) => {
    requests.push(request);
    return "远程模型回复";
  });
  const app = new CoachApplication({
    ledger: new InMemoryCoachLedger(),
    runtime: { now: () => "2026-08-08T12:00:00.000+08:00", nextId: (prefix) => `${prefix}-${++sequence}` },
    llmProvider: provider,
  });
  return { app, requests };
}

async function bootstrapWithRemotePermission(app: CoachApplication, remoteLlm: "granted" | "denied") {
  const meta = {
    userId: "u1", actor: { kind: "user" as const, id: "u1" }, deviceId: "phone-1",
    occurredAt: "2026-08-08T12:00:00.000+08:00", timezoneOffsetMinutes: 480,
  };
  await app.executeDomainCommand({
    type: "user.bootstrap", meta: { ...meta, idempotencyKey: "bootstrap" },
    profile: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
    goalContract: { id: "goal-1", primaryGoal: "hypertrophy", horizon: { startDate: "2026-08-08", endDate: "2026-12-08" } },
    mandate: { id: "mandate-1", mode: "collaborative" },
  });
  await app.executeDomainCommand({
    type: "permission_set.revise",
    meta: { ...meta, idempotencyKey: "permission" },
    permissionSetId: "permissions-1",
    expectedRevision: 0,
    permissionSet: {
      id: "permissions-1", camera: "not_configured", health: "not_configured", notifications: "not_configured",
      remoteLlm, cloudSync: "not_configured", mediaUpload: "not_configured",
    },
    authorization: { kind: "local_user_presence", verifiedAt: meta.occurredAt, nonce: "settings" },
  });
}

test("登录后的托管云 Provider 不受旧 remoteLlm 开关阻断", async () => {
  const state = fixture();
  await bootstrapWithRemotePermission(state.app, "denied");
  const session = await state.app.startSession({ userId: "u1", context: { kind: "today", ref: "2026-08-08" } });
  const events = await state.app.sendCoachTurn({ sessionId: session.id, text: "今天该怎么练？" });
  assert.equal(state.requests.length, 1);
  assert.equal(
    (state.requests[0] as { contextManifest: { remoteLlmConsentRef?: string } }).contextManifest.remoteLlmConsentRef,
    undefined,
  );
  assert.ok(events.some((event) => event.type === "text-delta" && event.delta === "远程模型回复"));
});

test("远程 Provider 只接收脱敏后的当轮自由输入，原始文本仍只保留在本机消息", async () => {
  const state = fixture();
  await bootstrapWithRemotePermission(state.app, "granted");
  const session = await state.app.startSession({ userId: "u1", context: { kind: "today", ref: "2026-08-08" } });
  const original = "姓名：王小明，邮箱 max@example.com，电话 13800138000，地址：上海市某路 1 号；今天怎么安排？";
  await state.app.sendCoachTurn({ sessionId: session.id, text: original });
  const sent = state.requests[0] as { userText: string; contextManifest: { redactedPaths: readonly string[] } };
  assert.equal(sent.userText.includes("王小明"), false);
  assert.equal(sent.userText.includes("max@example.com"), false);
  assert.equal(sent.userText.includes("13800138000"), false);
  assert.equal(sent.userText.includes("上海市某路"), false);
  assert.deepEqual([...sent.contextManifest.redactedPaths].sort(), [
    "user_text.address",
    "user_text.email",
    "user_text.name",
    "user_text.phone",
  ]);
  const persisted = await state.app.readSessionProjection(session.id);
  assert.equal(persisted.messages.find((message) => message.role === "user")?.content, original);
});
