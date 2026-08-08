import type { CoachLedger } from "../ledger";
import type {
  ArtifactCardModel,
  CoachRunEvent,
  RuntimeServices,
  SetSummaryArtifact,
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
    const existingCue = [...snapshot.runEvents]
      .reverse()
      .find((event) => event.type === "live-cue" && event.setId === input.setId);
    const presentationId =
      existingCue?.type === "live-cue"
        ? existingCue.presentationId
        : this.runtime.nextId("presentation");
    const now = this.runtime.now();
    validateCanonicalObservation(input.observation);
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
      runId: this.runtime.nextId("coach-run"),
      presentationId,
      setId: input.setId,
      message: supported
        ? `${confirmed.length} 次已确认${needsReview.length ? ` · ${needsReview.length} 次待复核` : ""}`
        : "当前动作语境未配置可执行识别 profile，请手动记录",
      occurredAt: now,
    };
    if (!input.observation.sealed) {
      await this.ledger.replace({ ...snapshot, runEvents: [...snapshot.runEvents, cue] });
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
    const presentation = {
      id: presentationId,
      artifactId: artifact.id,
      renderer: "set-summary/v1",
      status: "ready" as const,
    };
    const artifactEvent: CoachRunEvent = {
      type: "artifact-ready",
      sessionId: session.id,
      runId: cue.runId,
      toolCallId: this.runtime.nextId("tool-call"),
      artifactRef: {
        id: artifact.id,
        kind: artifact.kind,
        schemaVersion: artifact.schemaVersion,
        hash: artifact.hash,
      },
      presentation,
      occurredAt: now,
    };
    await this.ledger.replace({
      ...snapshot,
      artifacts: [...snapshot.artifacts, artifact],
      presentations: [
        ...snapshot.presentations.filter((item) => item.id !== presentationId),
        presentation,
      ],
      runEvents: [...snapshot.runEvents, cue, artifactEvent],
    });
    return {
      status: "sealed",
      presentationId,
      artifact,
      card: this.cards.render(artifact, "ready"),
    };
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
