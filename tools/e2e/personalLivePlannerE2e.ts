/** Personal profile live-provider run; all facts live only in an in-memory ledger. */
import { CoachApplication } from "../../src/coach/createCoachApplication";
import { InMemoryCoachLedger } from "../../src/coach/ledger";
import { MaxPowerPiCoachProviderResolver } from "../../src/mobile/cloud/MaxPowerPiCoachProvider";
import { writeFile } from "node:fs/promises";

const baseUrl = process.env.MAXPOWER_E2E_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.MAXPOWER_E2E_EMAIL ?? "";
const password = process.env.MAXPOWER_E2E_PASSWORD ?? "";
const now = "2026-08-12T10:00:00.000Z";

async function main() {
  if (!email || !password) throw new Error("MAXPOWER_E2E_EMAIL_and_PASSWORD_required");
  const login = await fetch(`${baseUrl}/v1/auth/login/password`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: { kind: "email", value: email }, password }),
  });
  if (!login.ok) throw new Error(`login_failed:${login.status}`);
  const auth = await login.json() as { accountId: string; accessToken: string };
  let sequence = 0;
  const ledger = new InMemoryCoachLedger();
  const app = new CoachApplication({
    ledger,
    runtime: { now: () => now, nextId: (prefix: string) => `personal-live:${prefix}-${++sequence}` },
    llmProviderResolver: new MaxPowerPiCoachProviderResolver({
      apiBaseUrl: baseUrl, allowInsecureHttp: baseUrl.startsWith("http://127.0.0.1"), accountId: auth.accountId,
      accessTokens: { accessTokenFor: () => auth.accessToken },
    }),
    knowledgeToolsEnabled: true,
    actionToolsEnabled: true,
  });
  await app.executeDomainCommand({
    type: "user.bootstrap",
    profile: {
      id: "personal-profile", locale: "zh-CN", adultConfirmed: true, trainingExperience: "intermediate", returningStatus: "consistent", dailyActivityLevel: "sedentary",
      demographics: { ageYears: 30, sex: "male", height: { value: 178, unit: "cm" }, currentWeight: { value: 75, unit: "kg" } },
      schedule: { weeklyFrequency: 4, sessionDurationMinutes: 90 },
      locations: [{ id: "personal-gym", kind: "gym", environment: { space: "large", noise: "any" }, availableEquipment: ["full_gym"] }],
      bodyDirection: "decrease_body_fat",
      trainingHistorySummary: { recentSplit: ["chest", "back", "legs", "shoulders"], weeklyVolume: [{ muscleGroup: "chest", sets: 10 }, { muscleGroup: "back", sets: 12 }, { muscleGroup: "quadriceps", sets: 10 }, { muscleGroup: "shoulders", sets: 12 }] },
      strengthBaseline: {
        squat: { value: 100, unit: "kg" }, squatReps: 3,
        benchPress: { value: 80, unit: "kg" }, benchPressReps: 5,
        deadlift: { value: 110, unit: "kg" }, deadliftReps: 4,
        measuredAt: "2026-08-01", source: "user_confirmed",
      },
      nutritionPreferences: ["严格控制饮食"],
    },
    goalContract: {
      id: "personal-goal", primaryGoal: "fat_loss_preserve_lean_mass", goalType: "fat_loss", status: "active",
      horizon: { startDate: "2026-08-12" }, targetWeeks: 12, pace: "standard", missedSessionPolicy: "shift",
      successMetrics: ["body_composition_trend", "strength_maintenance", "weekly_training_adherence"],
      targets: {
        // User estimate, not a measurement: product should retain it as the stated starting hypothesis.
        currentBodyFat: { value: 16.5, unit: "percent" }, targetBodyFat: { value: 12, unit: "percent" },
        targetWaist: { value: 78, unit: "cm" }, targetShoulderWaistRatio: 1.5,
        circumferences: { waist: { value: 86, unit: "cm" }, chest: { value: 101, unit: "cm" }, shoulders: { value: 113, unit: "cm" }, neck: { value: 44, unit: "cm" } },
      },
      emphasisMuscles: ["lateral_deltoid", "rear_deltoid"],
      aerobicPreference: { role: "fat_loss_acceleration", timingPreference: "after_strength", intensityPreference: "easy_moderate" },
      commitmentPreferences: { training: "high", nutrition: "strict", recovery: "standard" },
    },
    mandate: { id: "personal-mandate", mode: "collaborative" },
    meta: { userId: auth.accountId, actor: { kind: "user", id: auth.accountId }, deviceId: "personal-live-e2e", occurredAt: now, timezoneOffsetMinutes: 480, idempotencyKey: "personal-bootstrap" },
  });
  const session = await app.startSession({ userId: auth.accountId, context: { kind: "today", ref: now.slice(0, 10) }, title: "个人实时规划评估" });
  try {
    await app.sendCoachTurn({
      sessionId: session.id,
      text: "我 30 岁男，178cm、75kg，训练 1–3 年。目前体脂我自己估计 16–17%，腰 86、胸 101、肩 113、颈 44。目标是清晰腹肌和宽肩窄腰；每周 4 天、每次 60–90 分钟，在健身房，保持四分化。近期深蹲 100×3、卧推 80×5、硬拉 110×4。请按已确认资料给我解释当前计划重点。",
    });
  } catch { /* Provider answer is diagnostic only; deterministic planning remains the executable result. */ }
  const preview = await app.createPlanningPreview({ userId: auth.accountId, currentDate: now.slice(0, 10), trigger: "initial_plan", idempotencyKey: "personal-initial-preview" });
  if (!preview.planningPreview) throw new Error("personal_plan_not_proposed");
  await app.confirmPlanningPreview({ userId: auth.accountId, previewId: preview.id, idempotencyKey: "personal-initial-confirm" });
  const projection = await app.readDomainProjection({ userId: auth.accountId });
  const plan = projection.plan?.value;
  if (!plan) throw new Error("personal_plan_not_materialized");
  const snapshot = await ledger.read();
  const result = {
    provider: {
      toolCalls: snapshot.toolCalls.map((call) => ({ tool: call.toolName, status: call.status })),
      response: [...snapshot.messages].reverse().find((message) => message.role === "assistant")?.content,
    },
    plan: {
      revision: projection.plan?.revision,
      strategy: plan.strategySelection?.primary,
      nutrition: plan.nutritionGuidance,
      rollingEnergyAdjustment: plan.rollingEnergyAdjustment,
      nextSevenDays: plan.upcomingSevenDays?.map((day) => ({
        date: day.scheduledFor, title: day.title, kind: day.kind, estimatedMinutes: day.estimatedDuration?.value,
        aerobic: day.aerobicBlock ? { minutes: day.aerobicBlock.minutes, placement: day.aerobicBlock.placement, intensity: day.aerobicBlock.intensity } : undefined,
        tasks: day.tasks.map((task) => ({ exercise: task.exerciseVariantId, sets: task.sets.length, reps: task.sets[0]?.targetReps, rir: task.sets[0]?.targetRirRange ?? task.sets[0]?.targetRir })),
      })),
      reasonCodes: plan.reasonCodes,
    },
    boundary: "in_memory_only_no_client_or_cloud_user_data_written",
  };
  console.log("PERSONAL_LIVE_PLAN=" + JSON.stringify(result));
  if (process.env.MAXPOWER_E2E_REPORT_PATH) {
    await writeFile(process.env.MAXPOWER_E2E_REPORT_PATH, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
}

main().catch((error) => { console.error("PERSONAL_LIVE_PLAN_FAILED", error instanceof Error ? error.message : error); process.exit(1); });
