import type { SetReport } from "../setReport";
import {
  defaultLensFacing,
  resolveMotionRuntimeCapability,
  resolveRecognitionCapability,
  type LensFacing,
} from "../exerciseRecognition";
import { recommendCapturePosition, type CapturePosition } from "../../pose/viewGating";
import type { CoachApplication } from "../../coach";
import type { DecodedMotionPacket } from "../../motion/motionPacket";
import type { MotionRepDisposition, MotionRepObservationFinding } from "../../motion/motionPacket";
import {
  buildCanonicalSetObservation,
  type CanonicalCaptureTelemetry,
} from "../../workout/CanonicalSetObservation";
import type { SetObservationData } from "../../coach/domain";
import { workoutSetRealtimeGate } from "./workoutRealtimeGate";

export type WorkoutSafetySignal =
  | "new_sharp_pain"
  | "chest_discomfort"
  | "dizziness_or_fainting"
  | "unusual_breathing_difficulty"
  | "known_constraint";

export interface WorkoutSetRealtimeCapability {
  available: boolean;
  capturePosition: CapturePosition;
  lensFacing: LensFacing;
  poseModel: "rtmpose-m-halpe26";
  profileIdentity: string | null;
  reasonCodes: readonly string[];
}

/**
 * Public WorkoutSession seam for the optional camera affordance. Availability
 * is bound to the exact exercise, view, lens, pose model, native bridge and
 * currently running native runtime; a catalog/profile name alone is never
 * sufficient.
 */
export function resolveWorkoutSetRealtimeCapability(input: {
  exerciseVariantId: string;
  platform: "android" | "ios" | "web" | "fixture";
  nativeRuntimeAvailable: boolean;
  capturePosition?: CapturePosition;
  lensFacing?: LensFacing;
  poseModel?: "rtmpose-m-halpe26";
}): WorkoutSetRealtimeCapability {
  const capturePosition = input.capturePosition
    ?? recommendCapturePosition(input.exerciseVariantId)?.position
    ?? "front";
  const lensFacing = input.lensFacing ?? defaultLensFacing(input.exerciseVariantId);
  const poseModel = input.poseModel ?? "rtmpose-m-halpe26";
  const recognition = resolveRecognitionCapability(
    input.exerciseVariantId,
    capturePosition,
    input.platform,
  );
  const runtime = resolveMotionRuntimeCapability({
    exerciseVariantId: input.exerciseVariantId,
    capturePosition,
    lensFacing,
    poseModel,
    platform: input.platform,
  });
  const available = workoutSetRealtimeGate({
    nativeRuntimeAvailable: input.nativeRuntimeAvailable,
    recognition,
    runtime,
  });
  return {
    available,
    capturePosition,
    lensFacing,
    poseModel,
    profileIdentity: available ? runtime.profileIdentity ?? null : null,
    reasonCodes: [
      ...(!input.nativeRuntimeAvailable ? ["native_runtime_unavailable"] : []),
      ...runtime.reasonCodes,
      ...(!recognition.canRunRustRecognition ? ["exact_recognition_profile_unavailable"] : []),
    ],
  };
}

/** Stable WorkoutSession context inherited by the optional current-set camera flow. */
export interface WorkoutSetRealtimeContext {
  workoutId: string;
  setId: string;
  exerciseVariantId: string;
  setIndex: number;
  targetReps?: number;
  executionLoad?: { value: number; unit: "kg" | "lb" };
  capabilityIdentity?: string;
}

/**
 * Immutable projection of Rust canonical dispositions for unified Set Review.
 * It deliberately contains no load, RIR, pain or performed value.
 */
export interface WorkoutSetObservation {
  context: WorkoutSetRealtimeContext;
  report: SetReport;
  observedAt: string;
  observation: SetObservationData;
  canonicalPackets: readonly DecodedMotionPacket[];
  captureTelemetry: CanonicalCaptureTelemetry;
}

export interface CanonicalRepRevisionPacket {
  subjectEpoch: bigint;
  completedReps: readonly {
    repId: bigint;
    revision: number;
    disposition: MotionRepDisposition;
    observationFindings: readonly MotionRepObservationFinding[];
  }[];
}

/**
 * Projects the latest sealed Rust revision for each logical rep. A later
 * rejected/needs-review revision replaces an earlier confirmed revision,
 * rather than creating a second UI count.
 */
export function projectLatestCanonicalRepRevisions(
  packets: readonly CanonicalRepRevisionPacket[],
): { confirmedCount: number; latestConfirmedFindings: readonly MotionRepObservationFinding[] } {
  const latest = new Map<string, {
    revision: number;
    disposition: MotionRepDisposition;
    observationFindings: readonly MotionRepObservationFinding[];
    order: number;
  }>();
  let order = 0;
  for (const packet of packets) {
    for (const rep of packet.completedReps) {
      order += 1;
      const key = `${packet.subjectEpoch}:${rep.repId}`;
      const current = latest.get(key);
      if (current && current.revision > rep.revision) continue;
      latest.set(key, {
        revision: rep.revision,
        disposition: rep.disposition,
        observationFindings: rep.observationFindings,
        order,
      });
    }
  }
  const confirmed = [...latest.values()]
    .filter((rep) => rep.disposition === "confirmed")
    .sort((left, right) => left.order - right.order);
  return {
    confirmedCount: confirmed.length,
    latestConfirmedFindings: confirmed.at(-1)?.observationFindings ?? [],
  };
}

/** Projects sealed Rust reps without creating another phase/rep counter. */
export function buildWorkoutSetObservation(input: {
  context: WorkoutSetRealtimeContext;
  packets: readonly DecodedMotionPacket[];
  report: SetReport;
  observedAt: string;
}): WorkoutSetObservation {
  const captureTelemetry = {
    processedFrames: input.report.processedFrames,
    validFrames: input.report.validFrames,
  };
  const observation = buildCanonicalSetObservation({
    context: input.context,
    packets: input.packets,
    telemetry: captureTelemetry,
    observedAt: input.observedAt,
  });
  return {
    context: input.context,
    report: input.report,
    observedAt: input.observedAt,
    observation,
    canonicalPackets: input.packets,
    captureTelemetry,
  };
}

/** Shared Android/iOS lossless exit boundary. */
export async function closeWorkoutSetRealtime(input: {
  application: CoachApplication;
  userId: string;
  workoutId: string;
  reason: "exit" | "permission_denied" | "observation_complete" | "recorded_video" | "unsupported";
  setId?: string;
  onClosed: () => void;
}): Promise<void> {
  try {
    await input.application.setWorkoutMonitoringMode({
      userId: input.userId,
      workoutId: input.workoutId,
      enabled: false,
      idempotencyKey: `mobile-workout:${input.workoutId}:monitor:${input.reason}:${input.setId ?? "current"}`,
    });
  } finally {
    input.onClosed();
  }
}

/** Shared native-adapter finish boundary: validate/persist, then close mode. */
export async function persistAndCloseWorkoutSetObservation(input: {
  application: CoachApplication;
  userId: string;
  workoutId: string;
  observation: WorkoutSetObservation;
  onReady: (observation: WorkoutSetObservation) => void;
}): Promise<void> {
  const saved = await input.application.saveCurrentSetObservation({
    userId: input.userId,
    workoutId: input.workoutId,
    context: input.observation.context,
    packets: input.observation.canonicalPackets,
    telemetry: input.observation.captureTelemetry,
    observedAt: input.observation.observedAt,
    idempotencyKey: `mobile-workout:${input.workoutId}:observation:${input.observation.observation.id}`,
  });
  await closeWorkoutSetRealtime({
    application: input.application,
    userId: input.userId,
    workoutId: input.workoutId,
    reason: "observation_complete",
    setId: input.observation.context.setId,
    onClosed: () => input.onReady({ ...input.observation, observation: saved }),
  });
}

/** Safety is available inside Realtime and returns through the same session. */
export async function pauseWorkoutSetRealtimeForSafety(input: {
  application: CoachApplication;
  userId: string;
  workoutId: string;
  signal: WorkoutSafetySignal;
  onPaused: () => void;
}): Promise<void> {
  await input.application.setWorkoutMonitoringMode({
    userId: input.userId,
    workoutId: input.workoutId,
    enabled: false,
    idempotencyKey: `mobile-workout:${input.workoutId}:monitor:safety-off:${input.signal}`,
  });
  await input.application.pauseWorkoutForSafety({
    userId: input.userId,
    workoutId: input.workoutId,
    signal: input.signal,
    idempotencyKey: `mobile-workout:${input.workoutId}:safety:${input.signal}:${Date.now().toString(36)}`,
  });
  input.onPaused();
}
