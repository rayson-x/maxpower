import type { Principal } from "../../kernel/principal.js";

export const PRODUCT_ALIASES = [
  "maxpower/coach-v1",
  "maxpower/nutrition-vision-v1",
] as const;

export type ProductAlias = (typeof PRODUCT_ALIASES)[number];

export const PUBLIC_MODEL_NAME = "maxpower-cloud";

export type OpenAiObject = Readonly<Record<string, unknown>>;

export type OpenAiToolChoice =
  | "auto"
  | "none"
  | "required"
  | Readonly<{
      type: "function";
      function: Readonly<{ name: string }>;
    }>;

/** The intentionally small OpenAI Chat Completions subset accepted by the module. */
export interface OpenAiChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly unknown[];
  readonly stream?: boolean | undefined;
  readonly tools?: readonly unknown[] | undefined;
  readonly max_tokens?: number | undefined;
  readonly max_completion_tokens?: number | undefined;
  readonly parallel_tool_calls?: false | undefined;
  /** Pi/OpenAI compatibility input. Provider retention is always disabled by policy. */
  readonly store?: false | undefined;
  /** Accepted for Pi compatibility; public usage remains intentionally undisclosed. */
  readonly stream_options?: Readonly<{ include_usage: true }> | undefined;
  readonly temperature?: number | undefined;
  readonly tool_choice?: OpenAiToolChoice | undefined;
  readonly response_format?: Readonly<{ type: "json_object" }> | undefined;
}

export interface InvokeLlmInput {
  idempotencyKey: string;
  request: OpenAiChatCompletionRequest;
}

export interface ResumeLlmInput {
  invocationId: string;
  /** One-based event sequence last observed by the caller. Zero replays all buffered events. */
  afterSequence?: number;
}

export interface CancelLlmInput {
  idempotencyKey: string;
}

export interface CancelLlmResult {
  status: "cancel_requested" | "already_terminal";
  invocationId?: string;
}

export interface CompleteLlmResult {
  kind: "complete";
  invocationId: string;
  response: OpenAiObject;
}

export interface StreamLlmResult {
  kind: "stream";
  invocationId: string;
  chunks: AsyncIterable<OpenAiObject>;
}

export type LlmResult = CompleteLlmResult | StreamLlmResult;

export interface LlmEntitlementView {
  availableCredits: number;
  spentCredits: number;
  resetAt: string | null;
}

/** External interface. Routing, quota, idempotency, auditing and buffering stay behind it. */
export interface LlmGatewayModule {
  invoke(principal: Principal | undefined, input: InvokeLlmInput): Promise<LlmResult>;
  resume(
    principal: Principal | undefined,
    input: ResumeLlmInput,
  ): Promise<AsyncIterable<OpenAiObject>>;
  getEntitlement(principal: Principal | undefined): Promise<LlmEntitlementView>;
  cancel(principal: Principal | undefined, input: CancelLlmInput): Promise<CancelLlmResult>;
  /** Immediately aborts this node's in-flight upstream calls for an account. */
  cancelAccount?(accountId: string): Promise<number> | number;
}

export function isProductAlias(value: string): value is ProductAlias {
  return PRODUCT_ALIASES.some((alias) => alias === value);
}
