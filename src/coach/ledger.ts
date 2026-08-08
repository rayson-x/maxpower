import type {
  ActionEvent,
  ActionTokenRecord,
  Artifact,
  CoachRunEvent,
  CoachSession,
  LedgerSnapshot,
  PresentationRef,
  UserState,
} from "./model";
import { clone } from "./stable";

export interface CoachLedger {
  read(): Promise<LedgerSnapshot>;
  replace(snapshot: LedgerSnapshot): Promise<void>;
  commit(input: AtomicCommit): Promise<AtomicCommitResult>;
}

const EMPTY: LedgerSnapshot = {
  sessions: [],
  users: [],
  artifacts: [],
  presentations: [],
  runEvents: [],
  actionTokens: [],
  actionEvents: [],
  idempotency: [],
  pendingHumanActions: [],
  workingMemory: [],
};

export class InMemoryCoachLedger implements CoachLedger {
  private snapshot: LedgerSnapshot;

  constructor(seed: LedgerSnapshot = EMPTY) {
    this.snapshot = clone({ ...EMPTY, ...seed });
  }

  async read(): Promise<LedgerSnapshot> {
    return clone(this.snapshot);
  }

  async replace(snapshot: LedgerSnapshot): Promise<void> {
    this.snapshot = clone(snapshot);
  }

  async commit(input: AtomicCommit): Promise<AtomicCommitResult> {
    const applied = applyAtomicCommitTransition(this.snapshot, input);
    this.snapshot = applied.snapshot;
    return applied.result;
  }
}

export function applyAtomicCommitTransition(
  snapshot: LedgerSnapshot,
  input: AtomicCommit,
): { snapshot: LedgerSnapshot; result: AtomicCommitResult } {
  const duplicate = snapshot.idempotency.find(
    (record) => record.userId === input.userId && record.key === input.idempotencyKey,
  );
  if (duplicate) {
    return {
      snapshot,
      result: { status: "idempotent", resultArtifactId: duplicate.resultArtifactId },
    };
  }
  const user = snapshot.users.find((candidate) => candidate.userId === input.userId);
  if (!user || user.plan.revision !== input.expectedPlanRevision) {
    throw new LedgerConflictError("stale_plan");
  }
  if (user.mandate.revision !== input.expectedMandateRevision) {
    throw new LedgerConflictError("stale_mandate");
  }
  const token = snapshot.actionTokens.find((candidate) => candidate.token === input.consumeToken);
  if (!token || token.consumedAt || token.userId !== input.userId) {
    throw new LedgerConflictError("invalid_token");
  }
  const resultArtifact = input.artifacts.at(-1);
  if (!resultArtifact) throw new Error("AtomicCommit requires a result artifact");
  const nextUser: UserState = { ...user, plan: clone(input.plan) };
  const tokensToClose = new Set([input.consumeToken, ...(input.invalidateTokens ?? [])]);
  const closedTokens: ActionTokenRecord[] = snapshot.actionTokens
    .filter((candidate) => tokensToClose.has(candidate.token))
    .map((candidate) => ({ ...candidate, consumedAt: input.occurredAt }));
  const next = clone({
    ...snapshot,
    users: [...snapshot.users.filter((candidate) => candidate.userId !== user.userId), nextUser],
    artifacts: [
      ...snapshot.artifacts.filter(
        (existing) => !input.artifacts.some((artifact) => artifact.id === existing.id),
      ),
      ...input.artifacts,
    ],
    presentations: [
      ...snapshot.presentations.filter(
        (existing) => !input.presentations.some((item) => item.id === existing.id),
      ),
      ...input.presentations,
    ],
    runEvents: [...snapshot.runEvents, ...input.runEvents],
    actionTokens: [
      ...snapshot.actionTokens.filter((candidate) => !tokensToClose.has(candidate.token)),
      ...closedTokens,
      ...(input.issueTokens ?? []),
    ],
    actionEvents: [
      ...snapshot.actionEvents.filter(
        (existing) => !(input.updateActionEvents ?? []).some((event) => event.id === existing.id),
      ),
      ...(input.updateActionEvents ?? []),
      input.actionEvent,
    ],
    idempotency: [
      ...snapshot.idempotency,
      {
        key: input.idempotencyKey,
        userId: input.userId,
        resultArtifactId: resultArtifact.id,
        occurredAt: input.occurredAt,
      },
    ],
  });
  return {
    snapshot: next,
    result: { status: "committed", resultArtifactId: resultArtifact.id },
  };
}

export interface AtomicCommit {
  userId: string;
  expectedPlanRevision: number;
  expectedMandateRevision: number;
  plan: UserState["plan"];
  artifacts: readonly Artifact[];
  presentations: readonly PresentationRef[];
  runEvents: readonly CoachRunEvent[];
  actionEvent: ActionEvent;
  updateActionEvents?: readonly ActionEvent[];
  consumeToken: string;
  invalidateTokens?: readonly string[];
  issueTokens?: readonly ActionTokenRecord[];
  idempotencyKey: string;
  occurredAt: string;
}

export interface AtomicCommitResult {
  status: "committed" | "idempotent";
  resultArtifactId: string;
}

export class LedgerConflictError extends Error {
  constructor(readonly code: "stale_plan" | "stale_mandate" | "invalid_token") {
    super(code);
    this.name = "LedgerConflictError";
  }
}

export function upsertSession(snapshot: LedgerSnapshot, session: CoachSession): LedgerSnapshot {
  return {
    ...snapshot,
    sessions: [...snapshot.sessions.filter((item) => item.id !== session.id), session],
  };
}

export function upsertUser(snapshot: LedgerSnapshot, user: UserState): LedgerSnapshot {
  return {
    ...snapshot,
    users: [...snapshot.users.filter((item) => item.userId !== user.userId), user],
  };
}

export function appendRunResult(
  snapshot: LedgerSnapshot,
  artifact: Artifact,
  presentation: PresentationRef,
  events: readonly CoachRunEvent[],
): LedgerSnapshot {
  const artifacts: Artifact[] = [
    ...snapshot.artifacts.filter((item) => item.id !== artifact.id),
    artifact,
  ];
  return {
    ...snapshot,
    artifacts,
    presentations: [
      ...snapshot.presentations.filter((item) => item.id !== presentation.id),
      presentation,
    ],
    runEvents: [...snapshot.runEvents, ...events],
  };
}
