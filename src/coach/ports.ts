import type { FactRef, RuntimeServices } from "./model";
import type { LLMProvider } from "./adapters/provider";
import type { MotionRuntime } from "./adapters/motion";
import type { CoachLedger } from "./ledger";

export interface HealthDataPort {
  readFacts(userId: string, since: string): Promise<readonly FactRef[]>;
}

export interface NotificationPort {
  schedule(input: { id: string; at: string; title: string; body: string }): Promise<void>;
  cancel(id: string): Promise<void>;
}

export interface SyncPort {
  readonly mode: "disabled" | "enabled";
  synchronize(): Promise<{ status: "disabled" | "synchronized" | "conflict" }>;
}

export interface MediaBlobStore {
  put(input: { id: string; mimeType: string; bytes: Uint8Array }): Promise<void>;
  get(id: string): Promise<{ mimeType: string; bytes: Uint8Array } | null>;
  delete(id: string): Promise<void>;
}

export type ActionTokenClaims =
  | {
      kind: "artifact_action";
      action: "apply" | "reject" | "undo";
      userId: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      artifactId: string;
      artifactHash: string;
      artifactSchemaVersion: number;
      expectedPlanRevision: number;
      expectedMandateRevision: number;
      expiresAt: string;
      nonce: string;
      undoOf?: string;
    }
  | {
      kind: "human_resume";
      action: "resume";
      pendingActionId: string;
      userId: string;
      sessionId: string;
      runId: string;
      toolCallId: string;
      expectedPlanRevision: number;
      expectedMandateRevision: number;
      expiresAt: string;
      nonce: string;
    };

export interface ActionTokenPrimitive {
  issue(claims: Readonly<ActionTokenClaims>): string;
}

export interface CoachApplicationPorts {
  ledger: CoachLedger;
  runtime: RuntimeServices;
  llmProvider?: LLMProvider;
  motionRuntime?: MotionRuntime;
  health?: HealthDataPort;
  notifications?: NotificationPort;
  sync?: SyncPort;
  media?: MediaBlobStore;
  actionTokens?: ActionTokenPrimitive;
}

export const disabledSyncPort: SyncPort = {
  mode: "disabled",
  async synchronize() {
    return { status: "disabled" };
  },
};
