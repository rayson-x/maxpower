import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import test from "node:test";

import type { DomainEvent } from "../../src/coach/domain";
import { stableHash } from "../../src/coach/stable";
import {
  HttpReplicaTransport,
  ReplicaTransportError,
  type ReplicaWireEnvelope,
} from "../../src/sync";

const event: DomainEvent = {
  id: "event-1", schemaVersion: 1, name: "user_profile.created", userId: "u1",
  aggregate: { kind: "user_profile", id: "profile-1", revision: 1 },
  actor: { kind: "user", id: "u1" }, deviceId: "phone-a",
  occurredAt: "2026-08-09T08:00:00.000+08:00", recordedAt: "2026-08-09T08:00:00.000+08:00", timezoneOffsetMinutes: 480,
  provenance: { source: "user", confidence: "confirmed" }, evidenceRefs: [], causationId: "cause-1", correlationId: "corr-1",
  payload: { id: "profile-1", trainingExperience: "beginner", locale: "zh-CN" },
};
const envelope: ReplicaWireEnvelope = {
  schemaVersion: 1, userId: "u1", replicaId: "replica-a", deviceId: "phone-a", event,
  payloadHash: stableHash(event), hlc: "2026-08-09T08:00:00.000+08:00:phone-a:event-1", causalParents: ["cause-1"], scope: "domain",
};

async function withServer(run: (endpoint: string, seen: { pushAuthorization?: string; idempotency?: string }) => Promise<void>): Promise<void> {
  const seen: { pushAuthorization?: string; idempotency?: string } = {};
  const server = createServer(async (request, response) => {
    if (request.method === "POST") {
      seen.pushAuthorization = request.headers.authorization;
      seen.idempotency = request.headers["idempotency-key"] as string | undefined;
      const body = await readRequest(request);
      const parsed = JSON.parse(body) as { envelopes: readonly ReplicaWireEnvelope[] };
      respond(response, 200, { acknowledgedEventIds: parsed.envelopes.map((item) => item.event.id), rejected: [], cursor: "push-1" });
      return;
    }
    respond(response, 200, { envelopes: [envelope], cursor: "pull-1", hasMore: false });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    await run(`http://127.0.0.1:${address.port}`, seen);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("HttpReplicaTransport 通过真实 HTTP 运输闭合 envelope，认证/幂等身份不泄漏到结果", async () => {
  await withServer(async (endpoint, seen) => {
    const transport = new HttpReplicaTransport({
      endpoint, accountId: "account-1", replicaId: "replica-a", deviceId: "phone-a", allowInsecureForTesting: true,
      credentials: { async readReplicaCredential() { return { accountId: "account-1", accessToken: "secret-token" }; } },
    });
    const pushed = await transport.push({ userId: "u1", envelopes: [envelope], idempotencyKey: "sync-1" });
    assert.deepEqual(pushed.acknowledgedEventIds, ["event-1"]);
    assert.equal(pushed.cursor, "push-1");
    const pulled = await transport.pull({ userId: "u1", cursor: "push-1", limit: 10 });
    assert.equal(pulled.envelopes[0]?.event.id, "event-1");
    assert.equal(seen.pushAuthorization, "Bearer secret-token");
    assert.equal(seen.idempotency, "sync-1");
    assert.equal("accessToken" in pushed, false);
  });
});

test("HttpReplicaTransport 拒绝不安全 endpoint、过期凭据与超大 payload，且不发起请求", async () => {
  assert.throws(() => new HttpReplicaTransport({
    endpoint: "http://sync.example.com", accountId: "a", replicaId: "r", deviceId: "d",
    credentials: { async readReplicaCredential() { return null; } },
  }), (error: unknown) => error instanceof ReplicaTransportError && error.code === "invalid_configuration");
  const transport = new HttpReplicaTransport({
    endpoint: "https://sync.example.com", accountId: "a", replicaId: "r", deviceId: "d", maxPayloadBytes: 10,
    credentials: { async readReplicaCredential() { return { accountId: "a", accessToken: "t", expiresAt: "2000-01-01T00:00:00.000Z" }; } },
  });
  await assert.rejects(
    transport.push({ userId: "u1", envelopes: [envelope], idempotencyKey: "large" }),
    (error: unknown) => error instanceof ReplicaTransportError && error.code === "credential_expired",
  );
  const oversized = new HttpReplicaTransport({
    endpoint: "https://sync.example.com", accountId: "a", replicaId: "r", deviceId: "d", maxPayloadBytes: 10,
    credentials: { async readReplicaCredential() { return { accountId: "a", accessToken: "t" }; } },
    fetch: async () => { throw new Error("network_must_not_run_for_oversized_payload"); },
  });
  await assert.rejects(
    oversized.push({ userId: "u1", envelopes: [envelope], idempotencyKey: "large" }),
    (error: unknown) => error instanceof ReplicaTransportError && error.code === "payload_too_large",
  );
});

function readRequest(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
