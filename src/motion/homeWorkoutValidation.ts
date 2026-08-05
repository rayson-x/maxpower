export const HOME_WORKOUT_ACTIONS = [
  "march_in_place", "side_step_touch", "alternating_knee_raise", "step_jack",
] as const;

export type HomeWorkoutAction = (typeof HOME_WORKOUT_ACTIONS)[number];

export interface OfflineRuntimeMetrics {
  readonly processedFrames: number;
  readonly validFrames: number;
  readonly processedFps: number;
  /** Null when the platform scheduler does not expose discarded-frame counts. */
  readonly droppedFrames: number | null;
  /** Latest-frame adapters have a hard upper bound of one pending frame. */
  readonly maxBacklogFrames: number;
}

export interface HomeWorkoutValidationRound extends OfflineRuntimeMetrics {
  readonly participantId: string;
  readonly action: HomeWorkoutAction;
  readonly round: 1 | 2 | 3;
  readonly durationMs: number;
  readonly manualRepCount: number;
  readonly recognizedRepCount: number;
  readonly startLatencyMs: number;
  readonly stopLatencyMs: number;
  readonly restDurationMs: number;
  readonly restFalseRepCount: number;
}

export interface MobilePerformanceRun extends OfflineRuntimeMetrics {
  readonly deviceId: string;
  readonly durationMs: number;
  readonly crashed: boolean;
  readonly sustainedBacklog: boolean;
}

export interface ValidationCriterion {
  readonly status: "pass" | "fail" | "unmeasured";
  readonly measured: number | null;
  readonly threshold: string;
}

export interface HomeWorkoutValidationReport {
  readonly status: "pass" | "fail" | "unmeasured";
  readonly participantCount: number;
  readonly coverageComplete: boolean;
  readonly perAction: Readonly<Record<HomeWorkoutAction, {
    readonly manualRepCount: number;
    readonly recognizedRepCount: number;
    readonly countErrorRate: number | null;
    readonly status: "pass" | "fail" | "unmeasured";
  }>>;
  readonly criteria: Readonly<Record<string, ValidationCriterion>>;
  readonly notes: readonly string[];
}

export function evaluateHomeWorkoutValidation(input: {
  readonly rounds: readonly HomeWorkoutValidationRound[];
  readonly performanceRuns: readonly MobilePerformanceRun[];
}): HomeWorkoutValidationReport {
  validateInput(input);
  const participants = new Set(input.rounds.map((round) => round.participantId));
  const expectedKeys = new Set<string>();
  for (const participantId of participants) {
    for (const action of HOME_WORKOUT_ACTIONS) {
      for (const round of [1, 2, 3]) expectedKeys.add(`${participantId}\0${action}\0${round}`);
    }
  }
  const observedKeys = new Set(input.rounds.map((round) => `${round.participantId}\0${round.action}\0${round.round}`));
  const coverageComplete = participants.size >= 5
    && [...expectedKeys].every((key) => observedKeys.has(key))
    && input.rounds.every((round) => round.durationMs >= 45_000);

  const perAction = Object.fromEntries(HOME_WORKOUT_ACTIONS.map((action) => {
    const rounds = input.rounds.filter((round) => round.action === action);
    const manualRepCount = sum(rounds.map((round) => round.manualRepCount));
    const recognizedRepCount = sum(rounds.map((round) => round.recognizedRepCount));
    const countErrorRate = manualRepCount > 0
      ? Math.abs(recognizedRepCount - manualRepCount) / manualRepCount : null;
    return [action, {
      manualRepCount, recognizedRepCount, countErrorRate,
      status: rounds.length === 0 || countErrorRate === null
        ? "unmeasured" : countErrorRate <= 0.10 ? "pass" : "fail",
    }];
  })) as unknown as HomeWorkoutValidationReport["perAction"];

  const totalProcessed = sum(input.rounds.map((round) => round.processedFrames));
  const totalValid = sum(input.rounds.map((round) => round.validFrames));
  const validFrameRatios = [
    totalProcessed > 0 ? totalValid / totalProcessed : null,
    ...input.performanceRuns.map((run) => run.processedFrames > 0
      ? run.validFrames / run.processedFrames
      : 0),
  ];
  const anySustainedBacklog = input.performanceRuns.some((run) => run.sustainedBacklog);
  const criteria = {
    participantCoverage: criterion(participants.size || null, (value) => value >= 5, ">= 5 participants"),
    roundCoverage: criterion(input.rounds.length || null, () => coverageComplete, "3 x 45s per action and participant"),
    countError: criterion(maxMeasured(HOME_WORKOUT_ACTIONS.map((action) => perAction[action].countErrorRate)), (value) => value <= 0.10, "<= 10% per action"),
    startLatency: criterion(maxMeasured(input.rounds.map((round) => round.startLatencyMs)), (value) => value <= 1_000, "<= 1000ms"),
    stopLatency: criterion(maxMeasured(input.rounds.map((round) => round.stopLatencyMs)), (value) => value <= 1_000, "<= 1000ms"),
    restFalseReps: criterion(maxMeasured(input.rounds.map((round) => round.restDurationMs > 0 ? round.restFalseRepCount * 30_000 / round.restDurationMs : null)), (value) => value <= 1, "<= 1 per 30s rest"),
    validFrameRatio: criterion(minMeasured(validFrameRatios), (value) => value >= 0.90, ">= 90% in field and device runs"),
    performanceDuration: criterion(minMeasured(input.performanceRuns.map((run) => run.durationMs)), (value) => value >= 480_000, ">= 8 minutes"),
    processedFps: criterion(minMeasured(input.performanceRuns.map((run) => run.processedFps)), (value) => value >= 15, ">= 15 FPS"),
    boundedBacklog: criterion(maxMeasured(input.performanceRuns.map((run) => run.maxBacklogFrames)), (value) => value <= 1 && !anySustainedBacklog, "latest-frame queue <= 1 and no sustained backlog"),
    crashFree: criterion(input.performanceRuns.length ? Number(input.performanceRuns.some((run) => run.crashed)) : null, (value) => value === 0, "no crash"),
  };
  const statuses = Object.values(criteria).map((entry) => entry.status);
  const status = statuses.includes("fail") ? "fail" : statuses.includes("unmeasured") ? "unmeasured" : "pass";
  const notes = [
    ...(input.rounds.length ? [] : ["Field accuracy is unmeasured; no labeled participant rounds were supplied."]),
    ...(input.performanceRuns.length ? [] : ["Physical-device performance is unmeasured; no eight-minute run was supplied."]),
    ...(input.performanceRuns.some((run) => run.droppedFrames === null)
      ? ["A scheduler did not expose discarded-frame counts; bounded backlog is reported separately."] : []),
  ];
  return Object.freeze({ status, participantCount: participants.size, coverageComplete, perAction, criteria, notes });
}

function validateInput(input: { readonly rounds: readonly HomeWorkoutValidationRound[]; readonly performanceRuns: readonly MobilePerformanceRun[] }): void {
  const seen = new Set<string>();
  for (const round of input.rounds) {
    if (!HOME_WORKOUT_ACTIONS.includes(round.action)) throw new Error(`Unsupported home-workout action: ${round.action}`);
    if (![1, 2, 3].includes(round.round)) throw new Error("Validation round must be 1, 2, or 3.");
    const key = `${round.participantId}\0${round.action}\0${round.round}`;
    if (!round.participantId.trim() || seen.has(key)) throw new Error("Validation rounds require unique participant/action/round identities.");
    seen.add(key);
    const values = [round.durationMs, round.manualRepCount, round.recognizedRepCount, round.startLatencyMs,
      round.stopLatencyMs, round.restDurationMs, round.restFalseRepCount, round.processedFrames,
      round.validFrames, round.processedFps, round.maxBacklogFrames];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Validation metrics must be finite and non-negative.");
    if (round.droppedFrames !== null && (!Number.isFinite(round.droppedFrames) || round.droppedFrames < 0)) {
      throw new Error("droppedFrames must be null or a finite non-negative number.");
    }
    if (round.validFrames > round.processedFrames) throw new Error("validFrames cannot exceed processedFrames.");
  }
  for (const run of input.performanceRuns) {
    if (!run.deviceId.trim()) throw new Error("Performance runs require a declared deviceId.");
    const values = [run.durationMs, run.processedFrames, run.validFrames, run.processedFps, run.maxBacklogFrames];
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("Performance metrics must be finite and non-negative.");
    if (run.droppedFrames !== null && (!Number.isFinite(run.droppedFrames) || run.droppedFrames < 0)) {
      throw new Error("droppedFrames must be null or a finite non-negative number.");
    }
    if (run.validFrames > run.processedFrames) throw new Error("validFrames cannot exceed processedFrames.");
  }
}

function criterion(measured: number | null, passes: (value: number) => boolean, threshold: string): ValidationCriterion {
  return Object.freeze({ status: measured === null ? "unmeasured" : passes(measured) ? "pass" : "fail", measured, threshold });
}
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function maxMeasured(values: readonly (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length ? Math.max(...measured) : null;
}
function minMeasured(values: readonly (number | null)[]): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length ? Math.min(...measured) : null;
}
