import type { LocalProductKernel } from "../coach/LocalProductKernel";
import type { TimelineFact } from "../coach/domain";
import type { RecordModule } from "../records";
import { createManualMealObservation, type NutrientId, type NutrientUnit } from "../nutrition";
import { buildTimelineCorrectionRequest } from "../product/timelineCorrection";

import { CurrentStagePlanningModule } from "../planning";
import type {
  ConversationExplicitRecord,
  PiAgentConversationDependencies,
} from "./PiAgentConversationModule";


/**
 * The production adapter between the Pi conversation and local product
 * modules. It is deliberately the only place that translates a user-stated
 * conversational record into a closed Timeline fact. UI screens cannot
 * duplicate this work or select a different admission path.
 */
export function createLocalConversationAdapters(input: {
  readonly kernel: LocalProductKernel;
  readonly records: RecordModule;
}): Pick<
  PiAgentConversationDependencies,
  "profileSetup" | "records" | "goals" | "context" | "planning" | "signals" | "knowledge" | "memory"
> {
  const { kernel, records } = input;
  return {
    profileSetup: async (baseline) => {
      await kernel.executeDomainCommand({
        type: "user.bootstrap",
        meta: {
          userId: baseline.userId,
          actor: { kind: "user", id: baseline.userId },
          deviceId: `mobile:${baseline.userId}`,
          occurredAt: new Date().toISOString(),
          timezoneOffsetMinutes: new Date().getTimezoneOffset() * -1,
          idempotencyKey: `conversation-baseline:${baseline.userId}`,
        },
        profile: {
          id: `profile:${baseline.userId}`,
          locale: "zh-CN",
          adultConfirmed: true,
          demographics: {
            ageYears: baseline.ageYears,
            height: { value: baseline.heightCm, unit: "cm" },
            currentWeight: { value: baseline.weightKg, unit: "kg" },
          },
          ...(baseline.goalText?.trim()
            ? { fieldProvenance: { "goal.narrative": { source: "conversation", confidence: "confirmed", confirmedAt: new Date().toISOString() } } }
            : {}),
        },
        mandate: {
          id: `mandate:${baseline.userId}`,
          mode: "collaborative",
          planChangeAuthorization: "always_ask",
          scopes: { loadReps: "confirm", volume: "confirm", substitution: "confirm", schedule: "confirm", deload: "confirm", nutrition: "advice_only", recording: "confirm" },
        },
      });
    },
    records: {
      recordBodyWeight: async (record) => {
        await records.recordFact({
          userId: record.userId,
          idempotencyKey: record.idempotencyKey,
          occurredAt: record.occurredAt,
          source: "user_statement",
          fact: {
            kind: "body",
            measurement: { metric: "body_weight", quantity: { value: record.valueKg, unit: "kg" }, condition: "after_waking" },
            confidence: "confirmed",
          },
        });
      },
      recordExplicit: async (record) => {
        const fact = await explicitConversationFact(kernel, record);
        if (record.kind === "nutrition") {
          const nutrients = record.nutrients.map((nutrient) => ({
            nutrientId: nutrient.nutrientId as NutrientId,
            amount: nutrient.value,
            unit: nutrient.unit as NutrientUnit,
            source: { kind: nutrient.source, ref: record.idempotencyKey },
          }));
          const provenance = record.nutrients[0]?.source ?? "current_user_statement";
          if (record.nutrients.some((nutrient) => nutrient.source !== provenance)) {
            throw new Error("nutrition_source_must_be_uniform");
          }
          await records.recordNutrition({
            userId: record.userId,
            idempotencyKey: record.idempotencyKey,
            observation: createManualMealObservation({
              id: `conversation-nutrition:${record.idempotencyKey}`,
              occurredAt: record.occurredAt,
              description: record.mealDescription ?? "用户确认的营养数值",
              mode: "structured",
              provenance,
              nutrients,
              ...(record.dayCoverage ? { dayCoverage: record.dayCoverage } : {}),
            }),
          });
        } else {
          await records.recordFact({
            userId: record.userId,
            idempotencyKey: record.idempotencyKey,
            occurredAt: record.occurredAt,
            source: "user_statement",
            fact,
          });
        }
        const label = record.kind === "nutrition" ? "营养显式数值"
          : record.kind === "body_weight" ? "体重"
            : record.kind === "body_fat" ? "体脂"
              : record.kind === "activity" ? "活动"
                : record.kind === "training" ? "训练记录"
                  : record.kind === "sleep" ? "睡眠"
                    : record.kind === "clinical" ? "健康情况"
                      : record.kind === "wellness_note" ? "好变化" : "恢复反馈";
        return {
          label,
          ...(record.kind === "nutrition"
            ? { detail: "只汇总你明确提供的数值；未提供的营养素仍为未知。" }
            : {}),
        };
      },
      correctExplicit: async (correction) => {
        const domain = await kernel.readDomainProjection({ userId: correction.userId });
        const original = domain.timeline.events.find((event) => event.eventId === correction.correctsEventId && event.lifecycle === "active");
        if (!original) throw new Error("timeline_fact_not_found");
        const fact = await explicitConversationFact(kernel, correction.replacement);
        const request = buildTimelineCorrectionRequest({
          entry: { ...original, lifecycle: original.lifecycle ?? "active" },
          reason: correction.reason,
          actor: { kind: "user", id: correction.userId },
          recordedAt: correction.occurredAt,
          fact,
        });
        await records.correctFact({ userId: correction.userId, idempotencyKey: correction.idempotencyKey, ...request });
        return { label: "已更正正式记录", detail: "原记录保留为可追溯历史；依赖它的判断会重新复核。" };
      },
    },
    goals: {
      confirm: async (goalInput) => {
        const domain = await kernel.readDomainProjection({ userId: goalInput.userId });
        const confirmed = await kernel.confirmGoalNegotiation({
          userId: goalInput.userId,
          goal: goalInput.goal,
          selectedOptionId: goalInput.selectedOptionId,
          planChangeAuthorization: domain.mandate?.value.planChangeAuthorization ?? "always_ask",
          authorization: {
            kind: "local_user_presence",
            verifiedAt: new Date().toISOString(),
            nonce: goalInput.idempotencyKey,
          },
          idempotencyKey: goalInput.idempotencyKey,
        });
        return { goal: confirmed.goal };
      },
    },
    context: {
      read: async ({ userId }) => {
        const now = new Date();
        const date = localCalendarDate(now);
        const [dailyLedger, trends, recentWellnessNotes] = await Promise.all([
          kernel.readDailyHealthLedger({ userId, date, timezoneOffsetMinutes: now.getTimezoneOffset() * -1 }),
          kernel.readHealthTrends({
            userId,
            startDate: new Date(now.getTime() - 28 * 86_400_000).toISOString().slice(0, 10),
            endDate: date,
            timezoneOffsetMinutes: now.getTimezoneOffset() * -1,
          }),
          kernel.readRecentWellnessNotes({
            userId,
            sinceDate: new Date(now.getTime() - 28 * 86_400_000).toISOString().slice(0, 10),
            limit: 8,
          }),
        ]);
        // The Agent receives a decision summary, never the complete 28-day
        // projection. Full projections are intentionally available only via
        // typed local tools: they are large enough to exceed the text-model
        // request contract and would make the conversational context stale.
        return {
          today: compactDailyHealthLedger(dailyLedger),
          trends: {
            window: { startDate: trends.startDate, endDate: trends.endDate },
            calibration: {
              status: trends.calibration.status,
              evidenceWindow: trends.calibration.evidenceWindow,
              ...(trends.calibration.maintenanceRange ? { maintenanceRange: trends.calibration.maintenanceRange } : {}),
              missing: trends.calibration.missing,
            },
            recentWeeks: trends.weekly.slice(-4).map(compactHealthTrendBucket),
          },
          recentWellnessNotes: recentWellnessNotes.map((entry) => ({
            date: entry.occurredAt.slice(0, 10),
            note: entry.note,
            ...(entry.dimension ? { dimension: entry.dimension } : {}),
          })),
        };
      },
    },
    planning: new CurrentStagePlanningModule(kernel),
    signals: {
      latestMaterial: async ({ userId }) => {
        const artifacts = await kernel.readGoalPathAssessmentArtifacts({ userId });
        // A delivered hard-safety assessment outranks every conversational
        // consideration: it must reach the same ingress as a review signal.
        const assessment = artifacts
          .filter((artifact) => artifact.goalPathAssessment?.delivery !== "suppressed"
            && (artifact.goalPathAssessment?.assessment.materialSignal === "review_recommended"
              || artifact.goalPathAssessment?.assessment.materialSignal === "hard_safety"))
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]?.goalPathAssessment?.assessment;
        return assessment ? {
          id: assessment.id,
          state: assessment.state,
          diagnosis: assessment.diagnosis,
          reasonCodes: assessment.reasonCodes,
          nextValidationSignals: assessment.nextValidationSignals,
          materialSignal: assessment.materialSignal,
        } : undefined;
      },
    },
    knowledge: {
      search: ({ query, topic, limit }) => {
        const passages = kernel.searchInstalledKnowledge({ query, topic, limit });
        if (passages.kind === "found") return passages;
        const exercises = kernel.searchExerciseCatalog({ query, limit });
        return exercises.length
          ? {
              kind: "found" as const,
              entries: exercises.map((exercise) => ({
                id: exercise.id,
                title: exercise.displayName.zh,
                text: [exercise.movementPattern, ...exercise.aliases].join(" · "),
              })),
            }
          : passages;
      },
      read: ({ passageId }) => kernel.readInstalledKnowledgePassage({ passageId }),
    },
    memory: {
      upsertConversationSummary: async ({ userId, conversationId, runId, content, idempotencyKey }) => {
        const existing = (await kernel.listMemory(userId))
          .find((item) => item.id === `conversation-summary:${conversationId}`);
        await kernel.upsertMemory({
          id: `conversation-summary:${conversationId}`,
          expectedVersion: existing?.version ?? 0,
          userId,
          actor: "agent",
          sessionId: conversationId,
          runId,
          kind: "strategy_note",
          content,
          evidenceRefs: [],
          confidence: 0.7,
          sensitivity: "private",
          idempotencyKey,
        });
      },
    },
  };
}

async function trainingTimelineFact(
  kernel: LocalProductKernel,
  record: Extract<ConversationExplicitRecord, { kind: "training" }>,
): Promise<TimelineFact> {
  const domain = await kernel.readDomainProjection({ userId: record.userId });
  const plan = domain.plan;
  const plannedSession = record.plannedSessionId
    ? plan?.value.sessions.find((session) => session.id === record.plannedSessionId)
    : undefined;
  if (record.plannedSessionId && (!plan || !plannedSession)) {
    throw new Error("planned_session_not_in_current_plan");
  }
  return {
    kind: "training",
    reportedSession: {
      executionStatus: record.executionStatus,
      summary: record.summary,
      ...(plannedSession && plan ? {
        plannedSessionRef: {
          planId: plan.value.id,
          planRevision: plan.revision,
          sessionPrescriptionId: plannedSession.id,
        },
      } : {}),
      ...(record.durationMinutes === undefined ? {} : { duration: { value: record.durationMinutes, unit: "minutes" } }),
    },
    confidence: "confirmed",
  };
}

async function explicitConversationFact(
  kernel: LocalProductKernel,
  record: ConversationExplicitRecord,
): Promise<TimelineFact> {
  if (record.kind === "body_weight") {
    return { kind: "body", measurement: { metric: "body_weight", quantity: { value: record.valueKg, unit: "kg" }, condition: "manual" }, confidence: "confirmed" };
  }
  if (record.kind === "body_fat") {
    return { kind: "body", measurement: { metric: "body_fat_percentage", quantity: { value: record.valuePercent, unit: "percent" }, condition: "manual" }, confidence: "confirmed" };
  }
  if (record.kind === "activity") {
    return { kind: "activity", activityType: record.activityType, ...(record.durationMinutes === undefined ? {} : { duration: { value: record.durationMinutes, unit: "minutes" } }), ...(record.energyKcal === undefined ? {} : { energyExpenditure: { value: record.energyKcal, unit: "kcal" }, energyExpenditureSource: "manual" }), confidence: "confirmed" };
  }
  if (record.kind === "training") return trainingTimelineFact(kernel, record);
  if (record.kind === "sleep") {
    return { kind: "sleep", ...(record.durationMinutes === undefined ? {} : { duration: { value: record.durationMinutes, unit: "minutes" } }), ...(record.quality === undefined ? {} : { quality: record.quality }), confidence: "confirmed" };
  }
  if (record.kind === "recovery") {
    return { kind: "recovery", ...(record.perceivedRecovery === undefined ? {} : { perceivedRecovery: record.perceivedRecovery }), confidence: "confirmed" };
  }
  if (record.kind === "clinical") {
    return { kind: "clinical_context", context: record.context, ...(record.note ? { note: record.note } : {}), confidence: "confirmed" };
  }
  if (record.kind === "wellness_note") {
    return { kind: "wellness_note", note: record.note, ...(record.dimension ? { dimension: record.dimension } : {}), confidence: "confirmed" };
  }
  return {
    kind: "nutrition",
    observationId: `conversation-nutrition:${record.idempotencyKey}`,
    observationMode: "structured",
    ...(record.mealDescription ? { mealDescription: record.mealDescription } : {}),
    nutrients: record.nutrients.map((nutrient) => ({
      nutrientId: nutrient.nutrientId as NutrientId,
      amount: nutrient.value,
      unit: nutrient.unit as NutrientUnit,
      source: { kind: nutrient.source, ref: record.idempotencyKey },
    })),
    ...(record.dayCoverage ? { dayCoverage: record.dayCoverage } : {}),
    confidence: "confirmed",
  };
}

function localCalendarDate(now = new Date()): string {
  const shifted = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function compactDailyHealthLedger(ledger: Awaited<ReturnType<LocalProductKernel["readDailyHealthLedger"]>>) {
  return {
    date: ledger.date,
    coverage: ledger.coverage,
    energyBalance: ledger.energyBalance,
    nutrition: {
      coverage: ledger.nutrition.coverage,
      knownNutrients: Object.fromEntries(Object.entries(ledger.nutrition.nutrients)
        .filter(([, nutrient]) => nutrient?.intakeKnown)
        .map(([id, nutrient]) => [id, { amount: nutrient!.consumedLogged, unit: nutrient!.unit }])),
    },
    activity: ledger.activity,
    training: ledger.training,
    body: ledger.body,
    recovery: ledger.recovery,
  };
}

function compactHealthTrendBucket(bucket: Awaited<ReturnType<LocalProductKernel["readHealthTrends"]>>["weekly"][number]) {
  return {
    key: bucket.key,
    dayCount: bucket.dayCount,
    completeEnergyDays: bucket.completeEnergyDays,
    ...(bucket.energyBalance ? { energyBalance: bucket.energyBalance } : {}),
    activityMinutes: bucket.activityMinutes,
    trainingCompleted: bucket.trainingCompleted,
    trainingMissed: bucket.trainingMissed,
    bodyObservationCount: bucket.bodyObservationCount,
    recoveryObservationCount: bucket.recoveryObservationCount,
  };
}
