import type { CoachLedger } from "../ledger";
import type {
  ArtifactCardModel,
  CoachRunEvent,
  RuntimeServices,
  SetSummaryArtifact,
  ToolAuditRecord,
} from "../model";
import { ArtifactCardRegistry } from "../cards";
import { stableHash } from "../stable";
import type { MotionRepObservationFinding } from "../../motion/motionPacket";

export type RepDisposition = "confirmed" | "needs_review" | "rejected";

export interface CanonicalRepObservation {
  id: string;
  disposition: RepDisposition;
  findings: readonly MotionRepObservationFinding[];
}

export interface CanonicalSetObservation {
  source: "rust_canonical_packet";
  packetRef: {
    id: string;
    version: number;
    hash: string;
  };
  profileCode: number;
  profileIdentity?: string;
  exactExecutableProfile: boolean;
  exerciseId: string;
  sealed: boolean;
  reps: readonly CanonicalRepObservation[];
}

/**
 * The live layer may only describe stable evidence already emitted by the
 * canonical packet. It deliberately has no rep counter, phase model, or pose
 * coordinates of its own.
 */
export interface LiveSessionState {
  sessionId: string;
  setId: string;
  latestPacketRef: CanonicalSetObservation["packetRef"];
  /** Canonical finding ids that have been observed in at least two packets. */
  stableFindingIds: readonly string[];
  /** A cue is emitted once per stable finding per set, preventing live spam. */
  deliveredFindingIds: readonly string[];
}

export interface CanonicalTrainingFinalization {
  userId: string;
  sessionId: string;
  setId: string;
  observation: CanonicalSetObservation;
  confirmedReps: number;
  userReported?: { loadKg?: number; rir?: number };
  idempotencyKey: string;
}

/**
 * The adapter does not own Timeline persistence. The application supplies the
 * one Timeline admission seam, so a sealed camera result has the same
 * provenance, deduplication and risk-trigger behaviour as every other fact.
 */
export interface MotionTimelineFinalizationPort {
  finalize(input: CanonicalTrainingFinalization): Promise<"recorded" | "not_recordable">;
}

export interface MotionRuntime {
  readonly kind: string;
  observations(): AsyncIterable<CanonicalSetObservation>;
}

export class FixtureMotionRuntime implements MotionRuntime {
  readonly kind = "fixture";

  constructor(private readonly fixture: readonly CanonicalSetObservation[]) {}

  async *observations(): AsyncIterable<CanonicalSetObservation> {
    for (const observation of this.fixture) yield structuredClone(observation);
  }
}

export type ObserveSetResult =
  | { status: "live"; presentationId: string; event: CoachRunEvent }
  | {
      status: "sealed";
      presentationId: string;
      artifact: SetSummaryArtifact;
      card: ArtifactCardModel;
      timelineFinalization: "recorded" | "not_recordable";
    };

export class MotionCoordinator {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly cards: ArtifactCardRegistry,
    private readonly motionRuntime?: MotionRuntime,
    private readonly timelineFinalization?: MotionTimelineFinalizationPort,
  ) {}

  private readonly liveSessions = new Map<string, {
    sessionId: string;
    setId: string;
    latestPacketRef: CanonicalSetObservation["packetRef"];
    observationPacketsByFinding: Map<string, Set<string>>;
    deliveredFindingIds: Set<string>;
  }>();

  async replay(input: {
    sessionId: string;
    setId: string;
    userReported?: { loadKg?: number; rir?: number };
  }): Promise<readonly ObserveSetResult[]> {
    if (!this.motionRuntime) throw new Error("MotionRuntime is not configured");
    const results: ObserveSetResult[] = [];
    for await (const observation of this.motionRuntime.observations()) {
      results.push(await this.observe({ ...input, observation }));
    }
    return results;
  }

  private async observe(input: {
    sessionId: string;
    setId: string;
    observation: CanonicalSetObservation;
    userReported?: { loadKg?: number; rir?: number };
  }): Promise<ObserveSetResult> {
    const snapshot = await this.ledger.read();
    const session = snapshot.sessions.find((candidate) => candidate.id === input.sessionId);
    if (!session) throw new Error(`CoachSession not found: ${input.sessionId}`);
    validateCanonicalObservation(input.observation);
    const existingSummary = input.observation.sealed
      ? snapshot.artifacts.find(
          (artifact): artifact is SetSummaryArtifact =>
            artifact.kind === "set_summary" &&
            artifact.packetRef.id === input.observation.packetRef.id &&
            artifact.packetRef.version === input.observation.packetRef.version &&
            artifact.packetRef.hash === input.observation.packetRef.hash,
        )
      : undefined;
    if (existingSummary) {
      const presentation = snapshot.presentations.find(
        (candidate) => candidate.artifactId === existingSummary.id,
      );
      if (!presentation) throw new Error("SetSummary presentation missing");
      return {
        status: "sealed",
        presentationId: presentation.id,
        artifact: existingSummary,
        card: this.cards.render(existingSummary, presentation.status),
        timelineFinalization: await this.finalizeTimelineIfEligible({
          session,
          setId: input.setId,
          observation: input.observation,
          confirmedReps: input.observation.reps.filter((rep) => rep.disposition === "confirmed").length,
          userReported: input.userReported,
        }),
      };
    }
    const existingCue = [...snapshot.runEvents]
      .reverse()
      .find((event) => event.type === "live-cue" && event.setId === input.setId);
    const presentationId =
      existingCue?.type === "live-cue"
        ? existingCue.presentationId
        : `motion:${session.id}:${input.setId}`;
    const now = this.runtime.now();
    const supported =
      input.observation.profileCode !== 0 &&
      input.observation.exactExecutableProfile &&
      Boolean(input.observation.profileIdentity);
    const reps = supported ? input.observation.reps : [];
    const confirmed = reps.filter((rep) => rep.disposition === "confirmed");
    const needsReview = reps.filter((rep) => rep.disposition === "needs_review");
    const rejected = reps.filter((rep) => rep.disposition === "rejected");
    const findings = supported
      ? [...new Set(reps.flatMap((rep) => rep.findings))]
      : [];
    const liveAdvice = input.observation.sealed
      ? undefined
      : this.nextLiveAdvice({
        sessionId: session.id,
        setId: input.setId,
        observation: input.observation,
        supported,
        findings,
      });
    const cue: CoachRunEvent = {
      type: "live-cue",
      sessionId: session.id,
      runId: `motion:${session.id}:${input.setId}`,
      presentationId,
      setId: input.setId,
      message: supported
        ? liveAdvice?.message ?? `${confirmed.length} 次已确认${needsReview.length ? ` · ${needsReview.length} 次待复核` : ""}`
        : "当前动作语境未配置可执行识别 profile，请手动记录",
      occurredAt: now,
    };
    const idempotencyKey = [
      "motion-observation",
      session.id,
      input.setId,
      input.observation.packetRef.id,
      input.observation.packetRef.version,
      input.observation.packetRef.hash,
      input.observation.sealed ? "sealed" : "live",
    ].join(":");
    if (!input.observation.sealed) {
      await this.commitObservation({
        session,
        cue,
        idempotencyKey,
        metadata: {
          sealed: false,
          supported,
          confirmedReps: confirmed.length,
          needsReviewReps: needsReview.length,
          rejectedReps: rejected.length,
        },
      });
      return { status: "live", presentationId, event: cue };
    }
    const semantic = {
      kind: "set_summary" as const,
      schemaVersion: 1 as const,
      renderVersion: 1 as const,
      exerciseId: input.observation.exerciseId,
      packetRef: input.observation.packetRef,
      ...(input.observation.profileIdentity
        ? { profileIdentity: input.observation.profileIdentity }
        : {}),
      confirmedReps: confirmed.length,
      needsReviewReps: needsReview.length,
      rejectedReps: rejected.length,
      observationFindings: findings,
      ...(input.userReported ? { userReported: input.userReported } : {}),
      contextRefs: [session.context],
      evidenceRefs: [
        {
          aggregate: "workout" as const,
          id: input.observation.packetRef.id,
          revision: input.observation.packetRef.version,
        },
      ],
      missingness: [
        ...(input.userReported?.loadKg === undefined ? ["user_reported_load"] : []),
        ...(input.userReported?.rir === undefined ? ["user_reported_rir"] : []),
      ],
      capabilityBoundary: [
        "只有 confirmed 次数进入 camera-confirmed 训练量",
        "Needs-review 在用户确认前不进入正式训练量",
        "负重与 RIR 仅来自用户报告，不由骨架推断",
      ],
    };
    const artifact: SetSummaryArtifact = Object.freeze({
      id: this.runtime.nextId("artifact"),
      createdAt: now,
      ...semantic,
      hash: stableHash(semantic),
    });
    // The live cue owns one replace-in-place presentation for the current
    // set. A sealed packet is immutable and must receive its own presentation
    // identity so a later observation cannot overwrite an earlier summary.
    const sealedPresentationId = [
      "motion-summary",
      session.id,
      input.setId,
      input.observation.packetRef.id,
      input.observation.packetRef.version,
    ].join(":");
    const presentation = {
      id: sealedPresentationId,
      artifactId: artifact.id,
      renderer: "set-summary/v1" as const,
      status: "ready" as const,
    };
    const artifactEvent: CoachRunEvent = {
      type: "artifact-ready",
      sessionId: session.id,
      runId: cue.runId,
      toolCallId: `motion:${session.id}:${input.setId}:${input.observation.packetRef.id}`,
      artifactRef: {
        id: artifact.id,
        kind: artifact.kind,
        schemaVersion: artifact.schemaVersion,
        hash: artifact.hash,
      },
      presentation,
      occurredAt: now,
    };
    await this.commitObservation({
      session,
      cue,
      idempotencyKey,
      artifact,
      presentation,
      artifactEvent,
      metadata: {
        sealed: true,
        supported,
        confirmedReps: confirmed.length,
        needsReviewReps: needsReview.length,
        rejectedReps: rejected.length,
      },
    });
    const timelineFinalization = await this.finalizeTimelineIfEligible({
      session,
      setId: input.setId,
      observation: input.observation,
      confirmedReps: confirmed.length,
      userReported: input.userReported,
    });
    this.liveSessions.delete(liveSessionKey(session.id, input.setId));
    return {
      status: "sealed",
      presentationId: sealedPresentationId,
      artifact,
      card: this.cards.render(artifact, "ready"),
      timelineFinalization,
    };
  }

  /**
   * Ephemeral state for the active set. It is never written to Timeline and
   * therefore cannot change recovery, execution adherence, or a future plan.
   */
  readLiveSessionState(input: { sessionId: string; setId: string }): LiveSessionState | undefined {
    const state = this.liveSessions.get(liveSessionKey(input.sessionId, input.setId));
    if (!state) return undefined;
    return {
      sessionId: state.sessionId,
      setId: state.setId,
      latestPacketRef: structuredClone(state.latestPacketRef),
      stableFindingIds: [...state.observationPacketsByFinding]
        .filter(([, packetIds]) => packetIds.size >= 2)
        .map(([finding]) => finding)
        .sort(),
      deliveredFindingIds: [...state.deliveredFindingIds].sort(),
    };
  }

  private nextLiveAdvice(input: {
    sessionId: string;
    setId: string;
    observation: CanonicalSetObservation;
    supported: boolean;
    findings: readonly MotionRepObservationFinding[];
  }): { message: string } | undefined {
    if (!input.supported || input.findings.length === 0) return undefined;
    const key = liveSessionKey(input.sessionId, input.setId);
    const state = this.liveSessions.get(key) ?? {
      sessionId: input.sessionId,
      setId: input.setId,
      latestPacketRef: input.observation.packetRef,
      observationPacketsByFinding: new Map<string, Set<string>>(),
      deliveredFindingIds: new Set<string>(),
    };
    state.latestPacketRef = input.observation.packetRef;
    const packetIdentity = [
      input.observation.packetRef.id,
      input.observation.packetRef.version,
      input.observation.packetRef.hash,
    ].join(":");
    for (const finding of input.findings) {
      const packets = state.observationPacketsByFinding.get(finding) ?? new Set<string>();
      packets.add(packetIdentity);
      state.observationPacketsByFinding.set(finding, packets);
    }
    this.liveSessions.set(key, state);
    const finding = [...state.observationPacketsByFinding]
      .map(([id, packetIds]) => ({ id, occurrences: packetIds.size }))
      .filter((signal) =>
        !state.deliveredFindingIds.has(signal.id) &&
        (isImmediateSafetyFinding(signal.id) || signal.occurrences >= 2),
      )
      .sort((left, right) =>
        Number(isImmediateSafetyFinding(right.id)) - Number(isImmediateSafetyFinding(left.id)) ||
        right.occurrences - left.occurrences ||
        left.id.localeCompare(right.id),
      )[0];
    if (!finding) return undefined;
    state.deliveredFindingIds.add(finding.id);
    return { message: liveAdviceMessage(finding.id) };
  }

  private async finalizeTimelineIfEligible(input: {
    session: { id: string; userId: string };
    setId: string;
    observation: CanonicalSetObservation;
    confirmedReps: number;
    userReported?: { loadKg?: number; rir?: number };
  }): Promise<"recorded" | "not_recordable"> {
    const supported =
      input.observation.profileCode !== 0 &&
      input.observation.exactExecutableProfile &&
      Boolean(input.observation.profileIdentity);
    if (!this.timelineFinalization || !supported || input.confirmedReps < 1) return "not_recordable";
    return this.timelineFinalization.finalize({
      userId: input.session.userId,
      sessionId: input.session.id,
      setId: input.setId,
      observation: input.observation,
      confirmedReps: input.confirmedReps,
      ...(input.userReported ? { userReported: input.userReported } : {}),
      idempotencyKey: [
        "canonical-motion-finalization",
        input.session.userId,
        input.session.id,
        input.setId,
        input.observation.packetRef.id,
        input.observation.packetRef.version,
        input.observation.packetRef.hash,
      ].join(":"),
    });
  }

  /**
   * Motion never owns a second persistence path. A canonical observation is
   * immutable evidence, while its projection is an ordinary local runtime
   * mutation: it must therefore use the same idempotent ledger transaction as
   * cards, sessions and Agent operations.
   */
  private async commitObservation(input: {
    session: { id: string; userId: string };
    cue: CoachRunEvent;
    idempotencyKey: string;
    metadata: Readonly<Record<string, boolean | number>>;
    artifact?: SetSummaryArtifact;
    presentation?: { id: string; artifactId: string; renderer: "set-summary/v1"; status: "ready" };
    artifactEvent?: CoachRunEvent;
  }): Promise<void> {
    const now = this.runtime.now();
    const audit: ToolAuditRecord = {
      id: this.runtime.nextId("tool-audit"),
      userPseudonym: `local-${stableHash({ userId: input.session.userId })}`,
      sessionId: input.session.id,
      runId: input.cue.runId,
      ...(input.artifactEvent?.type === "artifact-ready"
        ? { toolCallId: input.artifactEvent.toolCallId }
        : {}),
      phase: "tool_execution",
      toolName: "motion.observe_canonical_packet",
      outcome: "passed",
      metadata: {
        ...input.metadata,
        packetHash: input.idempotencyKey,
      },
      occurredAt: now,
    };
    await this.ledger.commit({
      kind: "domain",
      userId: input.session.userId,
      actorId: "motion_runtime",
      intent: "motion.observe_canonical_packet",
      expectedRevisions: [],
      domainEvents: [],
      ...(input.artifact ? { artifacts: [input.artifact] } : {}),
      ...(input.presentation ? { presentations: [input.presentation] } : {}),
      runEvents: [input.cue, ...(input.artifactEvent ? [input.artifactEvent] : [])],
      toolAudit: [audit],
      idempotencyKey: input.idempotencyKey,
      recordedAt: now,
    });
  }

  scheduleAdjustment(input: {
    action: "stop" | "skip" | "safety_hold" | "change_load" | "change_reps" | "change_exercise";
  }): { appliesAt: "immediate" | "next_safe_boundary" } {
    return {
      appliesAt:
        input.action === "stop" || input.action === "skip" || input.action === "safety_hold"
          ? "immediate"
          : "next_safe_boundary",
    };
  }
}

function liveSessionKey(sessionId: string, setId: string): string {
  return `${sessionId}:${setId}`;
}

function isImmediateSafetyFinding(_finding: MotionRepObservationFinding): boolean {
  // The current Canonical packet contract has no safety-stop finding. Keep
  // this closed policy explicit so an arbitrary adapter string cannot invent
  // a medical/safety conclusion.
  return false;
}

function liveAdviceMessage(finding: MotionRepObservationFinding): string {
  if (finding.includes("range_below")) {
    return "动作幅度连续低于当前识别 profile 的参考范围；下一组开始前请确认动作路径和当前负重仍可控。";
  }
  if (finding.includes("faster_than")) {
    return "动作节奏连续快于当前识别 profile 的参考范围；下一组请先复核节奏是否仍然可控。";
  }
  return `当前动作连续出现「${finding}」观察；下一组开始前请复核动作设置。`;
}

function validateCanonicalObservation(observation: CanonicalSetObservation): void {
  if (
    observation.source !== "rust_canonical_packet" ||
    !observation.packetRef.id ||
    !Number.isInteger(observation.packetRef.version) ||
    observation.packetRef.version < 1 ||
    !observation.packetRef.hash ||
    !Number.isInteger(observation.profileCode) ||
    observation.profileCode < 0
  ) {
    throw new Error("invalid_canonical_motion_evidence");
  }
  if (
    observation.profileCode === 0 &&
    (observation.exactExecutableProfile || observation.profileIdentity || observation.reps.length > 0)
  ) {
    throw new Error("profile_code_zero_cannot_publish_reps");
  }
  if (
    observation.profileCode !== 0 &&
    (!observation.exactExecutableProfile || !observation.profileIdentity)
  ) {
    throw new Error("exact_executable_profile_required");
  }
}
