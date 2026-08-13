import { stableHash } from "../coach/stable";
import type { ReplicaPullResult, ReplicaPushResult, ReplicaTransportPort, ReplicaWireEnvelope } from "./model";

interface StoredEnvelope { sequence: number; envelope: ReplicaWireEnvelope; }

/** Deterministic transport fixture; production adapters must satisfy the same contract. */
export class InMemoryReplicaTransport implements ReplicaTransportPort {
  readonly mode = "enabled" as const;
  private readonly events: StoredEnvelope[] = [];
  private sequence = 0;

  constructor(readonly replicaId: string, readonly deviceId: string) {}

  async push(input: { userId: string; envelopes: readonly ReplicaWireEnvelope[]; idempotencyKey: string }): Promise<ReplicaPushResult> {
    const acknowledgedEventIds: string[] = [];
    const rejected: { eventId: string; code: "account_mismatch" | "unknown_schema" | "payload_hash_mismatch" | "replayed" }[] = [];
    for (const envelope of input.envelopes) {
      if (envelope.userId !== input.userId || envelope.event.userId !== input.userId) {
        rejected.push({ eventId: envelope.event.id, code: "account_mismatch" });
        continue;
      }
      if (envelope.schemaVersion !== 1 || stableHash(envelope.event) !== envelope.payloadHash) {
        rejected.push({ eventId: envelope.event.id, code: envelope.schemaVersion === 1 ? "payload_hash_mismatch" : "unknown_schema" });
        continue;
      }
      if (!this.events.some((item) => item.envelope.event.id === envelope.event.id)) {
        this.events.push({ sequence: ++this.sequence, envelope: structuredClone(envelope) });
      }
      acknowledgedEventIds.push(envelope.event.id);
    }
    return { acknowledgedEventIds, rejected, cursor: String(this.sequence) };
  }

  async pull(input: { userId: string; cursor?: string; limit: number }): Promise<ReplicaPullResult> {
    const after = Number.parseInt(input.cursor ?? "0", 10) || 0;
    const matching = this.events.filter((item) => item.sequence > after && item.envelope.userId === input.userId);
    const page = matching.slice(0, Math.max(1, input.limit));
    const last = page.at(-1)?.sequence ?? after;
    return {
      envelopes: page.map((item) => structuredClone(item.envelope)),
      cursor: String(last),
      hasMore: matching.length > page.length,
    };
  }
}
