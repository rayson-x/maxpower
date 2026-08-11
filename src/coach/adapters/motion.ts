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

export type RepDisposition = "confirmed" | "needs_review" | "rejected";

export interface CanonicalRepObservation {
  id: string;
  disposition: RepDisposition;
  findings: readonly string[];
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
    };

export class MotionCoordinator {
  constructor(
    private readonly ledger: CoachLedger,
    private readonly runtime: RuntimeServices,
    private readonly cards: ArtifactCardRegistry,
    private readonly motionRuntime?: MotionRuntime,
  ) {}

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
    const cue: CoachRunEvent = {
      type: "live-cue",
      sessionId: session.id,
      runId: `motion:${session.id}:${input.setId}`,
      presentationId,
      setId: input.setId,
      message: supported
        ? `${confirmed.length} 次已确认${needsReview.length ? ` · ${needsReview.length} 次待复核` : ""}`
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
    return {
      status: "sealed",
      presentationId: sealedPresentationId,
      artifact,
      card: this.cards.render(artifact, "ready"),
    };
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
