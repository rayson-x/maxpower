import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("cloud Coach is available to the signed-in product without a separate network approval flow", async () => {
  const conversation = await readFile(path.resolve(process.cwd(), "src/agent-conversation/PiAgentConversationModule.ts"), "utf8");
  assert.match(conversation, /new Agent/);
  assert.doesNotMatch(conversation, /assertRemoteProviderAllowed/);
});

test("cloud boundary contains identity and text Coach inference, never product state or media", async () => {
  const [runtime, shell, application, cloudCoach] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/mobile/runtime/createMobileAccountRuntime.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/coach/LocalProductKernel.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/cloud/createCloudCoachServices.ts"), "utf8"),
  ]);

  assert.match(cloudCoach, /MaxPowerPiLlmProvider/);
  for (const source of [runtime, shell, application]) {
    assert.doesNotMatch(source, /CloudProductData|confirmedProduct|stageConfirmedProductMutation|restoreConfirmed.*FromCloud|ReplicaSynchronizer|CloudMediaLibrary/);
  }
  assert.doesNotMatch(runtime, /createExpoMediaBlobStore|InMemoryMediaBlobStore/);
  assert.doesNotMatch(application, /MediaBlobStore|putMedia\(|getMedia\(|listMedia\(|deleteMedia\(/);
});

test("plan is a read-only confirmed workspace; candidate decisions exist only in Pi conversation cards", async () => {
  const [shell, conversation, drawer] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/agent-conversation/PiAgentConversationModule.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/coach/ui/CoachDrawer.tsx"), "utf8"),
  ]);
  const plan = shell.slice(shell.indexOf("function PlanScreen"), shell.indexOf("function PlanOverview"));

  assert.doesNotMatch(plan, /AdaptivePlanProposalScreen|invokeArtifactCardAction|latestAdaptivePlanProposal/);
  assert.doesNotMatch(shell, /NutritionObservationDraftSheet|nutrition_draft_review/);
  assert.match(conversation, /resolve_plan_candidate/);
  assert.match(drawer, /确认当前阶段/);
  assert.doesNotMatch(plan, /ExerciseManager/);
  assert.doesNotMatch(plan, /requestRebuild|createPhaseTransitionPreview/);
});

test("Coach is a conversation, not a page-context session", async () => {
  const [shell, drawer, conversation] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/coach/ui/CoachDrawer.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/agent-conversation/PiAgentConversationModule.ts"), "utf8"),
  ]);
  assert.doesNotMatch(shell, /routeContext\(|contextAcceptsRestoredCoach|sameCoachContext/);
  assert.doesNotMatch(shell, /coachAttachment\.context|attachment\.context/);
  assert.doesNotMatch(conversation, /context: \{ kind: "today"|context: \{ kind: "plan"/);
  assert.doesNotMatch(drawer, /使用当前页面作为上下文|本页 ·/);
  assert.match(drawer, /从已确认资料和相关历史继续/);
  assert.match(conversation, /context: \{ kind: "conversation", ref: "general" \}/);
});

test("manual and conversational records share one post-commit fixed Signal bridge", async () => {
  const [records, runtime, shell] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/records/RecordModule.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/runtime/createMobileAccountRuntime.ts"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8"),
  ]);
  assert.doesNotMatch(records, /afterCommitted/);
  assert.match(runtime, /afterFixedGoalPathReview: async/);
  assert.match(runtime, /kind: "reconcile"/);
  assert.match(await readFile(path.resolve(process.cwd(), "src/coach/LocalProductKernel.ts"), "utf8"), /notifyFixedGoalPathReview/);
  const recordFocus = shell.slice(shell.indexOf("<RecordFocus"), shell.indexOf("{timelineCorrection"));
  assert.match(recordFocus, /refreshAfterFormalWrite/);
  assert.doesNotMatch(recordFocus, /kind: "reconcile"/);
});

test("V1 product flow leaves training media and realtime outside every default destination", async () => {
  const [shell, coachDrawer, appDock, application] = await Promise.all([
    readFile(path.resolve(process.cwd(), "src/mobile/ui/ProductShell.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/coach/ui/CoachDrawer.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/mobile/ui-kit/AppDock.tsx"), "utf8"),
    readFile(path.resolve(process.cwd(), "src/coach/LocalProductKernel.ts"), "utf8"),
  ]);
  const plan = shell.slice(shell.indexOf("function PlanScreen"), shell.indexOf("function PlanOverview"));
  const profile = shell.slice(shell.indexOf("function ProfileScreen"), shell.indexOf("type PrivacySettingsOverviewValue"));

  assert.doesNotMatch(plan, /onOpenVideoLibrary|onOpenTrainingMedia/);
  assert.doesNotMatch(profile, /mobile\.profile\.trainingMedia\.title|onOpenTrainingMedia|VideoLibraryScreen|ReplayScreen/);
  assert.doesNotMatch(coachDrawer, /attachmentTray|voiceComposer|holdToTalk/);
  assert.doesNotMatch(appDock, /voiceButton|microphone/);
  assert.doesNotMatch(shell, /setObservations|nextSetRecommendation|persistedObservation/);
  assert.doesNotMatch(application, /saveCurrentSetObservation|recommendNextWorkoutSet|maybeProposeNextSetAdjustment/);
});
