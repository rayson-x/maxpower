import type { LedgerSnapshot } from "../model";
import { stableHash } from "../stable";

export type ProviderEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "completed" };

export interface ProviderContext {
  userPseudonym: string;
  profile: Record<string, unknown>;
  plan: Record<string, unknown>;
  timeline: Array<{
    id: string;
    occurredAt: string;
    kind: string;
    source: string;
    status: string;
    data: Record<string, unknown>;
  }>;
  workingMemory: Array<Record<string, unknown>>;
}

export interface ContextManifest {
  schemaVersion: 1;
  userPseudonym: string;
  factRefs: readonly string[];
  redactedPaths: readonly string[];
  includes: readonly string[];
  productionCompression: "not_implemented";
}

export interface LLMProviderRequest {
  sessionId: string;
  runId: string;
  userText: string;
  context: ProviderContext;
  contextManifest: ContextManifest;
}

export interface LLMProvider {
  readonly kind: string;
  readonly usesNetwork: boolean;
  stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent>;
}

const DIRECT_IDENTIFIER_KEYS = new Set([
  "name",
  "address",
  "email",
  "phone",
  "exactlocation",
  "latitude",
  "longitude",
  "externalaccountid",
  "accountid",
  "contact",
]);

function sanitizeRecord(
  value: Record<string, unknown>,
  path: string,
  redactedPaths: string[],
  remove: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (DIRECT_IDENTIFIER_KEYS.has(key.toLowerCase())) {
      redactedPaths.push(nestedPath);
      if (!remove) result[key] = "[redacted]";
      continue;
    }
    if (Array.isArray(nested)) {
      result[key] = nested.map((item, index) =>
        item && typeof item === "object"
          ? sanitizeRecord(item as Record<string, unknown>, `${nestedPath}[${index}]`, redactedPaths, false)
          : item,
      );
    } else if (nested && typeof nested === "object") {
      result[key] = sanitizeRecord(nested as Record<string, unknown>, nestedPath, redactedPaths, false);
    } else {
      result[key] = nested;
    }
  }
  return result;
}

export class ContextAssembler {
  assemble(snapshot: LedgerSnapshot, userId: string): {
    context: ProviderContext;
    contextManifest: ContextManifest;
  } {
    const user = snapshot.users.find((candidate) => candidate.userId === userId);
    if (!user) throw new Error(`User facts not found: ${userId}`);
    const redactedPaths: string[] = [];
    const userPseudonym = `local-${stableHash({ userId })}`;
    const profile = sanitizeRecord(
      user.profile as unknown as Record<string, unknown>,
      "profile",
      redactedPaths,
      true,
    );
    const timeline = user.timeline.map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      kind: event.kind,
      source: event.source,
      status: event.status,
      data: sanitizeRecord({ ...event.data }, `timeline.${event.id}.data`, redactedPaths, false),
    }));
    const workingMemory = snapshot.workingMemory
      .filter((item) => item.userId === userId && !item.deletedAt)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        content: item.content,
        evidenceRefs: item.evidenceRefs,
        confidence: item.confidence,
        sensitivity: item.sensitivity,
        pinned: item.pinned,
      }));
    const context: ProviderContext = {
      userPseudonym,
      profile,
      plan: user.plan as unknown as Record<string, unknown>,
      timeline,
      workingMemory,
    };
    return {
      context,
      contextManifest: {
        schemaVersion: 1,
        userPseudonym,
        factRefs: [
          `profile:${user.profileRevision}`,
          `plan:${user.plan.revision}`,
          `timeline:${user.timelineRevision}`,
          ...workingMemory.map((item) => `memory:${String(item.id)}`),
        ],
        redactedPaths,
        includes: ["profile", "plan", "timeline", "working_memory"],
        productionCompression: "not_implemented",
      },
    };
  }
}

export class ScriptedLLMProvider implements LLMProvider {
  readonly kind = "scripted";
  readonly usesNetwork = false;
  readonly requests: LLMProviderRequest[] = [];
  private failure?: Error;

  constructor(private readonly events: readonly ProviderEvent[]) {}

  failWith(error: Error): void {
    this.failure = error;
  }

  async *stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    if (this.failure) throw this.failure;
    for (const event of this.events) yield structuredClone(event);
  }
}

/** Thin adapter for the existing provider call. SDK-specific types stay behind the injected function. */
export class FunctionLLMProvider implements LLMProvider {
  readonly kind = "remote-function";
  readonly usesNetwork = true;

  constructor(
    private readonly complete: (request: LLMProviderRequest) => Promise<string>,
  ) {}

  async *stream(request: LLMProviderRequest): AsyncIterable<ProviderEvent> {
    const text = await this.complete(request);
    yield { type: "text-delta", delta: text };
    yield { type: "completed" };
  }
}
