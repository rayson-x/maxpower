/**
 * Local-only browser E2E companion.  It exercises the same reviewed identity
 * and text-LLM HTTP contracts as the app, while replacing the upstream model
 * with a deterministic, non-network script.  It is never a product runtime.
 */
import { serve } from "@hono/node-server";

import { createApp } from "../../server/src/app.js";
import { AccountDeletionModule, InMemoryAccountDeletionAdapter } from "../../server/src/modules/account-deletion/index.js";
import { InMemoryIdentityAdapter, LOCAL_TEST_ONLY_DEBUG_OTP } from "../../server/src/modules/identity/index.js";
import { InMemoryLlmUsageAdapter, LlmGateway } from "../../server/src/modules/llm/index.js";
import {
  immediateProviderDispatch,
  type LlmEntitlementAdapter,
  type LlmEntitlementView,
  type LlmProviderAdapter,
  type ProviderInvocationInput,
  type ProviderUsage,
  type ReserveEntitlementResult,
  type SettleEntitlementResult,
} from "../../server/src/modules/llm/ports.js";
import { openAiCompatibleToolName } from "../../src/coach/adapters/openAiToolName.js";

class LocalBrowserEntitlements implements LlmEntitlementAdapter {
  async reserve(input: { invocationId: string }): Promise<ReserveEntitlementResult> {
    return { granted: true, reservationId: `e2e-reservation:${input.invocationId}`, reservedCredits: 100 };
  }

  async settle(_reservationId: string, actualCredits: number): Promise<SettleEntitlementResult> {
    return { chargedCredits: actualCredits };
  }

  async release(): Promise<void> {}

  async getAccount(): Promise<LlmEntitlementView> {
    return { availableCredits: 10_000, spentCredits: 0, resetAt: null };
  }
}

class LocalBrowserScenarioProvider implements LlmProviderAdapter {
  #turn = 0;

  invoke(input: ProviderInvocationInput) {
    this.#turn += 1;
    process.stdout.write(`local browser E2E LLM turn ${this.#turn}\n`);
    const reply = this.replyFor(this.#turn, input);
    return immediateProviderDispatch({
      kind: "stream",
      chunks: reply,
      usage: Promise.resolve({ inputTokens: 12, outputTokens: 16, totalTokens: 28, credits: 1 } satisfies ProviderUsage),
    });
  }

  private async *replyFor(turn: number, input: ProviderInvocationInput): AsyncIterable<Readonly<Record<string, unknown>>> {
    if (turn === 1) {
      yield* toolCall("e2e-goal-path", "goal.propose_path", {
        primaryGoal: "hypertrophy",
        targetWeeks: 12,
        targetWeightKg: 78,
        acceptableCosts: ["每周训练 3 次", "记录主要饮食数值"],
      });
      return;
    }
    if (turn === 2) {
      yield* textReply("我已根据你确认的基础信息生成目标路径。请选择你愿意投入的时间与节奏；确认前不会创建计划。");
      return;
    }
    if (turn === 3) {
      yield* toolCall("e2e-planning-input", "plan.read_fixed_input", {});
      return;
    }
    if (turn === 4) {
      const planningInput = planningInputFrom(input);
      yield* toolCall("e2e-plan-candidate", "plan.propose_current_stage", {
        candidate: firstStageCandidate(planningInput),
      });
      return;
    }
    yield* textReply("当前阶段候选已经通过固定安全校验，并放在确认卡中。确认前不会修改正式计划。");
  }
}

function firstStageCandidate(input: Record<string, unknown>): Record<string, unknown> {
  const goal = asObject(input.goalContract);
  const goalValue = asObject(goal.value);
  const goalId = text(goalValue.id, "goal_missing_in_planning_input");
  const goalRevision = integer(goal.revision, "goal_revision_missing_in_planning_input");
  const pins = asObject(input.knowledgePins);
  const effectiveFrom = tomorrow();
  const goalContractRef = { kind: "goal_contract", id: goalId, revision: goalRevision };
  return {
    planRevision: {
      id: "e2e-first-stage-plan",
      goalContractRef,
      effectiveFrom,
      knowledgePins: pins,
      sessions: [{
        id: "e2e-first-stage-session",
        title: "全身力量训练",
        scheduledFor: effectiveFrom,
        knowledgePins: pins,
        durationBudget: { value: 45, unit: "minutes" },
        tasks: [{
          id: "e2e-first-stage-task",
          exerciseVariantId: "dumbbell_bench_press.flat.standard",
          stimulusSlotId: "e2e-first-stage-push",
          mode: "weighted_reps",
          sets: ["1", "2", "3"].map((index) => ({ id: `e2e-first-stage-set-${index}`, targetReps: { min: 8, max: 12 }, targetRir: 3, rest: { value: 120, unit: "seconds" } })),
        }],
        stimulusSlots: [{
          id: "e2e-first-stage-push",
          intent: {
            movementPattern: "horizontal_push",
            muscleGroups: ["chest"],
            directMuscles: ["chest"],
            stability: "supported",
            prescriptionMode: "weighted_reps",
            fatigueIntent: "medium",
            priority: "primary",
          },
          prescription: { setCount: 3, repRange: { min: 8, max: 12 }, targetRir: 3, rest: { value: 120, unit: "seconds" } },
          exerciseSlot: {
            status: "resolved",
            exerciseVariantId: "dumbbell_bench_press.flat.standard",
            satisfiedContracts: [],
            deviatedContracts: [],
            requiredEquipment: ["dumbbell", "bench"],
            performanceComparability: "cold_start",
            coldStart: true,
            sessionTimeImpactMinutes: 0,
            fatigueImpact: "medium",
            cameraCapability: "manual_only",
            reasonCodes: [],
          },
          lockedFields: [],
        }],
      }],
      observationContract: {
        requiredSignals: ["weekly_body_data", "planned_training_outcome", "representative_numeric_intake"],
        minimumObservationDays: 14,
        trackingSilenceReviewDays: 7,
        reviewCadenceDays: 7,
        successConditions: ["small_surplus_and_training_completed"],
        progressionConditions: ["reps_progress_with_recovery"],
        holdConditions: ["window_incomplete"],
        fallbackConditions: ["execution_friction"],
        stopConditions: ["safety_hold_or_recovery_decline"],
      },
    },
    nutritionStrategy: {
      id: "e2e-first-stage-nutrition",
      goalContractRef,
      status: "active",
      phase: "hypertrophy",
      calorieRange: { min: { value: 2450, unit: "kcal" }, max: { value: 2650, unit: "kcal" } },
      reviewWindow: { startsAt: `${effectiveFrom}T00:00:00.000Z`, endsAt: `${plusDays(effectiveFrom, 14)}T00:00:00.000Z`, minimumWeightObservations: 3 },
      nutrientTargets: { sodium: { unit: "mg", maximum: 2300 }, potassium: { unit: "mg", minimum: 3500 }, fiber: { unit: "g", minimum: 25 } },
    },
    behaviorChanges: [{ id: "e2e-first-step", instruction: "先保持每天一个固定、容易完成的加餐步骤。", burden: "low", preferenceRefs: [] }],
    rationale: ["先以可持续的训练与小幅盈余建立趋势，再按真实记录调整。"],
    expectedTradeoffs: ["先建立稳定执行，进度以两周以上的真实趋势判断。"],
  };
}

function* toolCall(id: string, localName: string, argumentsValue: Record<string, unknown>): Iterable<Readonly<Record<string, unknown>>> {
  const name = openAiCompatibleToolName(localName);
  yield chunk({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(argumentsValue) } }] });
  yield chunk({}, "tool_calls");
}

function* textReply(value: string): Iterable<Readonly<Record<string, unknown>>> {
  yield chunk({ content: value });
  yield chunk({}, "stop");
}

function chunk(delta: Record<string, unknown>, finishReason: "stop" | "tool_calls" | null = null): Readonly<Record<string, unknown>> {
  return {
    id: "e2e-chat",
    object: "chat.completion.chunk",
    created: 1_786_000_000,
    model: "maxpower/coach-v1",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

function planningInputFrom(input: ProviderInvocationInput): Record<string, unknown> {
  const messages = input.request.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asObject(messages[index]);
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    try {
      const candidate = JSON.parse(message.content) as unknown;
      if (asObject(candidate).goalContract !== undefined) return asObject(candidate);
    } catch {
      // Other tool outputs are deliberately ignored.
    }
  }
  throw new Error("e2e_planning_input_not_found");
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("e2e_expected_object");
  return value as Record<string, unknown>;
}

function text(value: unknown, errorCode: string): string {
  if (typeof value !== "string" || !value) throw new Error(errorCode);
  return value;
}

function integer(value: unknown, errorCode: string): number {
  if (!Number.isInteger(value)) throw new Error(errorCode);
  return value as number;
}

function tomorrow(): string {
  return plusDays(new Date().toISOString().slice(0, 10), 1);
}

function plusDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function readPort(value: string | undefined): number {
  const port = value === undefined ? 8787 : Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("invalid_port");
  return port;
}

const port = readPort(process.env.PORT);
const identity = new InMemoryIdentityAdapter();
const app = createApp({
  identity,
  tokens: identity,
  llm: new LlmGateway({
    provider: new LocalBrowserScenarioProvider(),
    entitlements: new LocalBrowserEntitlements(),
    usage: new InMemoryLlmUsageAdapter(),
    fingerprintSecret: "local-browser-e2e-fingerprint-secret",
  }),
  accountDeletion: new AccountDeletionModule({ adapter: new InMemoryAccountDeletionAdapter() }),
  localDebugOtp: LOCAL_TEST_ONLY_DEBUG_OTP,
}, {
  security: {
    allowedOrigins: ["http://localhost:8081"],
    maxRequestBytes: 128 * 1024,
  },
});

serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`MaxPower local browser E2E server listening on ${info.port}; OTP ${LOCAL_TEST_ONLY_DEBUG_OTP}\n`);
});
