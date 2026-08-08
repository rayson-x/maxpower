import { ArtifactCardRegistry } from "./cards";
import {
  ActionBroker,
  type ArtifactActionResult,
  type PlanChangeProposalResult,
  type ProposePlanChangeInput,
  type UndoActionResult,
} from "./actions";
import { decideTodayPlan } from "./kernel";
import { HumanActionCoordinator } from "./hitl";
import { MemoryCurator, type UpsertMemoryInput } from "./memory";
import {
  MotionCoordinator,
} from "./adapters/motion";
import { AgentRuntime } from "./agentRuntime";
import {
  appendRunResult,
  type CoachLedger,
  InMemoryCoachLedger,
  upsertSession,
  upsertUser,
} from "./ledger";
import type {
  ArtifactCardModel,
  CoachSession,
  ContextRef,
  PlanRevision,
  RuntimeServices,
  TimelineEvent,
  ToolExecutionIdentity,
  UserProfile,
} from "./model";
import {
  disabledSyncPort,
  type CoachApplicationPorts,
  type HealthDataPort,
  type MediaBlobStore,
  type NotificationPort,
  type SyncPort,
} from "./ports";
import { stableHash } from "./stable";
import { CoachToolRegistry } from "./toolRegistry";

export interface CoachApplicationDependencies extends CoachApplicationPorts {}

export interface StartSessionInput {
  userId: string;
  context: ContextRef;
}

export interface SeedUserStateInput {
  userId: string;
  profile: UserProfile;
  plan: PlanRevision;
  timeline?: readonly TimelineEvent[];
}

export interface ShowTodayPlanResult {
  artifact: ReturnType<typeof decideTodayPlan>;
  card: ArtifactCardModel;
  events: readonly import("./model").CoachRunEvent[];
}

export class CoachApplication {
  private readonly cards = new ArtifactCardRegistry();
  private readonly actions: ActionBroker;
  private readonly humanActions: HumanActionCoordinator;
  private readonly memory: MemoryCurator;
  private readonly ledger: CoachLedger;
  private readonly runtime: RuntimeServices;
  private readonly agentRuntime: AgentRuntime;
  private readonly motion: MotionCoordinator;
  private readonly health?: HealthDataPort;
  private readonly notifications?: NotificationPort;
  private readonly sync: SyncPort;
  private readonly media?: MediaBlobStore;

  constructor(ledger: CoachLedger, runtime: RuntimeServices);
  constructor(dependencies: CoachApplicationDependencies);
  constructor(first: CoachLedger | CoachApplicationDependencies, second?: RuntimeServices) {
    const dependencies: CoachApplicationDependencies = "ledger" in first
      ? first
      : { ledger: first, runtime: second ?? missingRuntime() };
    this.ledger = dependencies.ledger;
    this.runtime = dependencies.runtime;
    this.health = dependencies.health;
    this.notifications = dependencies.notifications;
    this.sync = dependencies.sync ?? disabledSyncPort;
    this.media = dependencies.media;
    const tokenPrimitive = dependencies.actionTokens ?? {
      issue: (claims: Parameters<NonNullable<CoachApplicationPorts["actionTokens"]>["issue"]>[0]) =>
        stableHash(claims),
    };
    this.actions = new ActionBroker(
      this.ledger,
      this.runtime,
      this.cards,
      undefined,
      tokenPrimitive,
    );
    this.humanActions = new HumanActionCoordinator(this.ledger, this.runtime, tokenPrimitive);
    this.memory = new MemoryCurator(this.ledger, this.runtime);
    this.motion = new MotionCoordinator(
      this.ledger,
      this.runtime,
      this.cards,
      dependencies.motionRuntime,
    );
    const tools = new CoachToolRegistry(
      {
        showToday: (input, execution) => this.showTodayPlan(input, execution),
        proposePlanChange: (input, execution) =>
          this.actions.proposePlanChange(input, undefined, execution),
      },
    );
    this.agentRuntime = new AgentRuntime(
      this.ledger,
      this.runtime,
      dependencies.llmProvider,
      undefined,
      tools,
    );
  }

  async startSession(input: StartSessionInput): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const now = this.runtime.now();
    const existingActive = snapshot.sessions.find(
      (session) => session.userId === input.userId && session.status === "active",
    );
    const nextSnapshot = existingActive
      ? upsertSession(snapshot, { ...existingActive, status: "suspended", updatedAt: now })
      : snapshot;
    const session: CoachSession = {
      id: this.runtime.nextId("coach-session"),
      userId: input.userId,
      status: "active",
      context: input.context,
      createdAt: now,
      updatedAt: now,
    };
    await this.ledger.replace(upsertSession(nextSnapshot, session));
    return session;
  }

  async seedUserState(input: SeedUserStateInput): Promise<void> {
    const snapshot = await this.ledger.read();
    await this.ledger.replace(
      upsertUser(snapshot, {
        userId: input.userId,
        profile: input.profile,
        profileRevision: 1,
        plan: input.plan,
        timeline: input.timeline ?? [],
        timelineRevision: input.timeline?.length ? 1 : 0,
        mandate: { mode: "collaborative", revision: 1 },
        safetyHold: false,
      }),
    );
  }

  async showTodayPlan(
    input: { sessionId: string; date: string },
    execution?: ToolExecutionIdentity,
  ): Promise<ShowTodayPlanResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((item) => item.id === input.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${input.sessionId}`);
    const user = snapshot.users.find((item) => item.userId === session.userId);
    if (!user) throw new Error(`User facts not found: ${session.userId}`);
    const now = this.runtime.now();
    const runId = execution?.runId ?? this.runtime.nextId("coach-run");
    const toolCallId = execution?.toolCallId ?? this.runtime.nextId("tool-call");
    const presentationId = this.runtime.nextId("presentation");
    const artifact = decideTodayPlan({
      artifactId: this.runtime.nextId("artifact"),
      createdAt: now,
      date: input.date,
      context: session.context,
      user,
    });
    const presentation = {
      id: presentationId,
      artifactId: artifact.id,
      renderer: "today-plan/v1",
      status: "ready" as const,
    };
    const events = [
      {
        type: "tool-started" as const,
        sessionId: session.id,
        runId,
        toolCallId,
        toolName: "plan.show_today",
        presentationId,
        occurredAt: now,
      },
      {
        type: "artifact-ready" as const,
        sessionId: session.id,
        runId,
        toolCallId,
        artifactRef: {
          id: artifact.id,
          kind: artifact.kind,
          schemaVersion: artifact.schemaVersion,
          hash: artifact.hash,
        },
        presentation,
        occurredAt: now,
      },
    ];
    await this.ledger.replace(appendRunResult(snapshot, artifact, presentation, events));
    return { artifact, card: this.cards.render(artifact, "ready"), events };
  }

  runtimeStatus(): {
    mode: "local-only" | "remote-provider";
    remoteProviderRequests: number;
  } {
    return this.agentRuntime.status();
  }

  proposePlanChange(input: ProposePlanChangeInput): Promise<PlanChangeProposalResult> {
    return this.actions.proposePlanChange(input);
  }

  inspectArtifact(artifactId: string) {
    return this.actions.inspectArtifact(artifactId);
  }

  recomputePlanChange(input: { sessionId: string; staleArtifactId: string }) {
    return this.actions.recomputePlanChange(input);
  }

  actOnArtifact(input: {
    sessionId: string;
    artifactId: string;
    action: "apply" | "reject";
    actionToken: string;
    idempotencyKey: string;
  }): Promise<ArtifactActionResult> {
    return input.action === "reject" ? this.actions.reject(input) : this.actions.apply(input);
  }

  undoPlanChange(input: {
    sessionId: string;
    receiptArtifactId: string;
    actionToken: string;
    idempotencyKey: string;
  }): Promise<UndoActionResult> {
    return this.actions.undo(input);
  }

  async readUserProjection(userId: string): Promise<{
    plan: PlanRevision;
    actionLog: readonly import("./model").ActionEvent[];
  }> {
    const snapshot = await this.ledger.read();
    const user = snapshot.users.find((candidate) => candidate.userId === userId);
    if (!user) throw new Error(`User facts not found: ${userId}`);
    return {
      plan: user.plan,
      actionLog: snapshot.actionEvents.filter((event) => event.userId === userId),
    };
  }

  async readSession(sessionId: string): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    return session;
  }

  async readSessionProjection(sessionId: string): Promise<{
    session: CoachSession;
    runEvents: readonly import("./model").CoachRunEvent[];
    presentations: readonly import("./model").PresentationRef[];
    pendingHumanActions: readonly import("./model").PendingHumanAction[];
  }> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    const artifactIds = new Set(
      snapshot.runEvents
        .filter((event) => event.sessionId === sessionId && event.type === "artifact-ready")
        .map((event) => (event.type === "artifact-ready" ? event.artifactRef.id : "")),
    );
    return {
      session,
      runEvents: snapshot.runEvents.filter((event) => event.sessionId === sessionId),
      presentations: snapshot.presentations.filter((item) => artifactIds.has(item.artifactId)),
      pendingHumanActions: snapshot.pendingHumanActions.filter(
        (pending) => pending.sessionId === sessionId,
      ),
    };
  }

  async setSessionStatus(
    sessionId: string,
    status: CoachSession["status"],
  ): Promise<CoachSession> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) throw new Error(`CoachSession not found: ${sessionId}`);
    const now = this.runtime.now();
    const updated = { ...session, status, updatedAt: now };
    const sessions = snapshot.sessions.map((candidate) => {
      if (candidate.id === session.id) return updated;
      if (status === "active" && candidate.userId === session.userId && candidate.status === "active") {
        return { ...candidate, status: "suspended" as const, updatedAt: now };
      }
      return candidate;
    });
    await this.ledger.replace({ ...snapshot, sessions });
    return updated;
  }

  async listActionLog(
    userId: string,
    options: { changesOnly?: boolean } = {},
  ): Promise<readonly import("./model").ActionEvent[]> {
    const snapshot = await this.ledger.read();
    const events = snapshot.actionEvents.filter((event) => event.userId === userId);
    return options.changesOnly ? events.filter((event) => event.afterRevision !== undefined) : events;
  }

  async setMandate(input: {
    userId: string;
    mode: "manual" | "collaborative" | "managed";
  }): Promise<void> {
    const snapshot = await this.ledger.read();
    const user = snapshot.users.find((candidate) => candidate.userId === input.userId);
    if (!user) throw new Error(`User facts not found: ${input.userId}`);
    await this.ledger.replace(
      upsertUser(snapshot, {
        ...user,
        mandate: { mode: input.mode, revision: user.mandate.revision + 1 },
      }),
    );
  }

  async setSafetyHold(input: { userId: string; enabled: boolean }): Promise<void> {
    const snapshot = await this.ledger.read();
    const user = snapshot.users.find((candidate) => candidate.userId === input.userId);
    if (!user) throw new Error(`User facts not found: ${input.userId}`);
    await this.ledger.replace(upsertUser(snapshot, { ...user, safetyHold: input.enabled }));
  }

  async executeManagedPlanChange(
    input: ProposePlanChangeInput & { idempotencyKey: string },
  ): Promise<ArtifactActionResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    const user = snapshot.users.find((candidate) => candidate.userId === session?.userId);
    if (!session || !user) throw new Error("CoachSession or user facts not found");
    if (user.mandate.mode !== "managed") throw new Error("managed_mode_required");
    const proposal = await this.proposePlanChange(input);
    return this.actOnArtifact({
      sessionId: input.sessionId,
      artifactId: proposal.artifact.id,
      action: "apply",
      actionToken: proposal.actionToken,
      idempotencyKey: input.idempotencyKey,
    });
  }

  suspendForHumanInput(input: Parameters<HumanActionCoordinator["suspend"]>[0]) {
    return this.humanActions.suspend(input);
  }

  resumeHumanInput(input: Parameters<HumanActionCoordinator["resume"]>[0]) {
    return this.humanActions.resume(input);
  }

  listPendingHumanActions(userId: string) {
    return this.humanActions.listPending(userId);
  }

  upsertMemory(input: UpsertMemoryInput) {
    return this.memory.upsert(input);
  }

  listMemory(userId: string) {
    return this.memory.list(userId);
  }

  forgetMemory(input: Parameters<MemoryCurator["forget"]>[0]) {
    return this.memory.forget(input);
  }

  async sendCoachTurn(input: {
    sessionId: string;
    text: string;
  }): Promise<readonly import("./model").CoachRunEvent[]> {
    return this.agentRuntime.sendTurn(input);
  }

  replayMotionRuntime(input: Parameters<MotionCoordinator["replay"]>[0]) {
    return this.motion.replay(input);
  }

  scheduleSetAdjustment(input: Parameters<MotionCoordinator["scheduleAdjustment"]>[0]) {
    return this.motion.scheduleAdjustment(input);
  }

  adapterCapabilities(): {
    health: boolean;
    notifications: boolean;
    sync: "disabled" | "enabled";
    media: boolean;
  } {
    return {
      health: Boolean(this.health),
      notifications: Boolean(this.notifications),
      sync: this.sync.mode,
      media: Boolean(this.media),
    };
  }

  readHealthFacts(userId: string, since: string) {
    if (!this.health) throw new Error("HealthDataPort is not configured");
    return this.health.readFacts(userId, since);
  }

  synchronize() {
    return this.sync.synchronize();
  }

  scheduleNotification(input: { id: string; at: string; title: string; body: string }) {
    if (!this.notifications) throw new Error("NotificationPort is not configured");
    return this.notifications.schedule(input);
  }

  putMedia(input: { id: string; mimeType: string; bytes: Uint8Array }) {
    if (!this.media) throw new Error("MediaBlobStore is not configured");
    return this.media.put(input);
  }
}

export function createInMemoryCoachApplication(runtime: RuntimeServices): CoachApplication {
  return new CoachApplication(new InMemoryCoachLedger(), runtime);
}

function missingRuntime(): never {
  throw new Error("RuntimeServices are required");
}
